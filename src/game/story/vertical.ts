// ─────────────────────────────────────────────────────────────────────────────
// Stratablocks, skybridges and Ribbon Rail (docs/STORY.md §4). Owner: WP-C.
//
//   refresh(world)       tall checks, active links, live rail networks (BFS),
//                        world.vertical metrics and world.layerParts.vertical,
//                        then composeLayers and emit 'vertical'
//   onDay(world)         Stratablock scaffolding countdown (true = a stage completed)
//   upkeep(world)        monthly "Skybridges" / "Ribbon Rail" ledger amounts
//   verticalPatch(world) resolveMods sources 6 and 7
//   planSkybridge / planRail   validation + previews for actions.planAction
//
// Everything here is allocation-light: module scratch buffers are reused, and
// refresh() runs monthly and after rail / link / building changes only.
// ─────────────────────────────────────────────────────────────────────────────

import { buildingStats, completeStage } from '../buildingStats';
import { BUILDINGS, CROWNS, RIBBON, SKYBRIDGE, STACK_SHADESIDE, STACK_STAGES, TURF_OWNER } from '../config';
import { districtName } from '../news';
import { MAP_SIZE, Terrain, ZoneType, type ActionPlan, type Building, type Tile } from '../types';
import type { World } from '../world';
import { composeLayers, resetLayers } from './mods';
import type { BuildingStats, CrownId, GangId, ModPatch, SimLayers, SkyLink } from './types';

const N = MAP_SIZE;
const AREA = N * N;
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;

// ── Scratch (reused; never escapes a call) ──────────────────────────────────
const S: BuildingStats = {
  residents: 0,
  jobsCom: 0,
  jobsInd: 0,
  powerUse: 0,
  powerSupply: 0,
  upkeep: 0,
  effect: null,
  radius: 0,
  pollution: 0,
  trips: 0,
  tall: false,
  station: false,
};
const comp = new Int32Array(AREA);
const order = new Int32Array(AREA);
const prevLive = new Uint8Array(AREA);
const mark = new Uint8Array(AREA);
const compStations: number[] = [];

// ── Anchors ─────────────────────────────────────────────────────────────────

/** Level-3 Hab or Market tile that is not abandoned (a tall zone anchor, §4.3). */
export function isTallZoneTile(t: Tile): boolean {
  return !t.abandoned && t.level === 3 && (t.zone === RES || t.zone === COM);
}

/** True if a building counts as tall (Spire, Arcology, Glarewall, Stratablock at complete stage ≥ 2). */
export function isTallBuilding(b: Building): boolean {
  return buildingStats(b, S).tall;
}

/** Is (x, y) a tall skybridge anchor right now? */
export function isTallAt(world: World, x: number, y: number): boolean {
  const t = world.tileAt(x, y);
  if (!t) return false;
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    return !!b && isTallBuilding(b);
  }
  return isTallZoneTile(t);
}

/** Powered (and online) anchor at (x, y). */
export function anchorPowered(world: World, x: number, y: number): boolean {
  const t = world.tileAt(x, y);
  if (!t) return false;
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    return !!b && b.powered && b.offline <= 0;
  }
  return t.powered;
}

/**
 * Identity of the anchor at (x, y): the building id (≥ 1) for a building tile,
 * −(tile index + 1) for a zone tile, 0 off the map. Each anchor takes at most
 * SKYBRIDGE.maxPerAnchor bridges.
 */
export function anchorKey(world: World, x: number, y: number): number {
  const t = world.tileAt(x, y);
  if (!t) return 0;
  return t.buildingId >= 0 ? t.buildingId : -(y * N + x + 1);
}

/** Tiles strictly between a link's anchors. */
export function linkGap(l: SkyLink): number {
  return Math.max(0, Math.abs(l.bx - l.ax) + Math.abs(l.by - l.ay) - 1);
}

/** Calls fn(x, y) for every gap tile of a link. */
export function forEachGapTile(l: SkyLink, fn: (x: number, y: number) => void): void {
  const dx = Math.sign(l.bx - l.ax);
  const dy = Math.sign(l.by - l.ay);
  let x = l.ax + dx;
  let y = l.ay + dy;
  while (x !== l.bx || y !== l.by) {
    fn(x, y);
    x += dx;
    y += dy;
  }
}

/** Sealed: an anchor is no longer tall. Sealed bridges are dark, free and give nothing (§4.3). */
export function linkSealed(world: World, l: SkyLink): boolean {
  return !isTallAt(world, l.ax, l.ay) || !isTallAt(world, l.bx, l.by);
}

/** Active: both anchors tall and powered. */
export function linkActive(world: World, l: SkyLink): boolean {
  return (
    !linkSealed(world, l) && anchorPowered(world, l.ax, l.ay) && anchorPowered(world, l.bx, l.by)
  );
}

/** Number of bridges anchored on the anchor with this key. */
export function linksOnAnchor(world: World, key: number): number {
  if (!key) return 0;
  let n = 0;
  for (const l of world.links) {
    if (anchorKey(world, l.ax, l.ay) === key || anchorKey(world, l.bx, l.by) === key) n++;
  }
  return n;
}

/** Fill `out` with 1 on every tall anchor tile (zone tiles and building footprints). */
export function tallMask(world: World, out: Uint8Array): Uint8Array {
  out.fill(0);
  const tiles = world.tiles;
  for (let i = 0; i < AREA; i++) {
    const t = tiles[i];
    if (t.buildingId < 0 && isTallZoneTile(t)) out[i] = 1;
  }
  for (const b of world.buildings.values()) {
    if (!isTallBuilding(b)) continue;
    fillRect(out, b.x, b.y, b.x + b.size - 1, b.y + b.size - 1, 1);
  }
  return out;
}

/** Fill `out` with 1 on the anchor and gap tiles of every active skybridge. */
export function spanMask(world: World, out: Uint8Array): Uint8Array {
  out.fill(0);
  const active = world.vertical.activeLinks;
  for (const l of world.links) {
    if (!active.has(l.id)) continue;
    out[l.ay * N + l.ax] = 1;
    out[l.by * N + l.bx] = 1;
    forEachGapTile(l, (x, y) => (out[y * N + x] = 1));
  }
  return out;
}

// ── Stations and rail ───────────────────────────────────────────────────────

/** A building that can serve as a ribbon station now: Maglev, or a Stratablock whose Plinth is complete; powered and online. */
export function isLiveStation(b: Building): boolean {
  if (!BUILDINGS[b.type]?.station) return false;
  if (b.type === 'stack' && completeStage(b) < 1) return false;
  return b.powered && b.offline <= 0;
}

/** Track bits (N1 E2 S4 W8) actually joined to a neighbour that links back. */
function linkedNeighbours(rail: Uint8Array, i: number, out: Int32Array): number {
  const m = rail[i];
  const x = i % N;
  let n = 0;
  if (m & 1 && i >= N && rail[i - N] & 4) out[n++] = i - N;
  if (m & 2 && x < N - 1 && rail[i + 1] & 8) out[n++] = i + 1;
  if (m & 4 && i < AREA - N && rail[i + N] & 1) out[n++] = i + N;
  if (m & 8 && x > 0 && rail[i - 1] & 2) out[n++] = i - 1;
  return n;
}
const nb = new Int32Array(4);

/** Distinct powered stations touching rail tile i (under it or 4-adjacent), appended to compStations. */
function collectStations(world: World, i: number): void {
  const x = i % N;
  const tiles = world.tiles;
  for (let k = 0; k < 5; k++) {
    let j = i;
    if (k === 1) {
      if (i < N) continue;
      j = i - N;
    } else if (k === 2) {
      if (x >= N - 1) continue;
      j = i + 1;
    } else if (k === 3) {
      if (i >= AREA - N) continue;
      j = i + N;
    } else if (k === 4) {
      if (x <= 0) continue;
      j = i - 1;
    }
    const id = tiles[j].buildingId;
    if (id < 0 || compStations.includes(id)) continue;
    const b = world.buildings.get(id);
    if (b && isLiveStation(b)) compStations.push(id);
  }
}

function railOutActive(world: World, i: number): boolean {
  const out = world.story.railOut;
  if (!out.length) return false;
  const tick = world.tick;
  for (const o of out) if (o.i === i && o.until > tick) return true;
  return false;
}

/** One connected track component: its tiles (BFS order), distinct powered stations and whether it is live. */
export interface RailNetwork {
  tiles: number[];
  stations: number;
  live: boolean;
  /** Knocked out by an `offline rail` effect. */
  out: boolean;
}

/** The network containing tile (x, y), or null when there is no rail there. For inspect and story effects. */
export function railNetworkAt(world: World, x: number, y: number): RailNetwork | null {
  if (!world.inBounds(x, y)) return null;
  const start = y * N + x;
  const rail = world.rail;
  if (!rail[start]) return null;
  comp.fill(-1);
  return bfsNetwork(world, start, 0, comp);
}

function bfsNetwork(world: World, start: number, id: number, seen: Int32Array): RailNetwork {
  const rail = world.rail;
  let head = 0;
  let tail = 0;
  order[tail++] = start;
  seen[start] = id;
  compStations.length = 0;
  let out = false;
  while (head < tail) {
    const i = order[head++];
    collectStations(world, i);
    if (!out && railOutActive(world, i)) out = true;
    const n = linkedNeighbours(rail, i, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if (seen[j] !== -1) continue;
      seen[j] = id;
      order[tail++] = j;
    }
  }
  const tiles = Array.from(order.subarray(0, tail));
  const stations = compStations.length;
  return { tiles, stations, out, live: !out && stations >= RIBBON.minStations };
}

/** Every connected network (one BFS pass). Allocates per network: for effects and tests, not per tick. */
export function railNetworks(world: World): RailNetwork[] {
  const rail = world.rail;
  comp.fill(-1);
  const nets: RailNetwork[] = [];
  for (let i = 0; i < AREA; i++) {
    if (!rail[i] || comp[i] !== -1) continue;
    nets.push(bfsNetwork(world, i, nets.length, comp));
  }
  return nets;
}

/**
 * Target for an `offline rail` effect (§10.3): a tile of the live network with the most
 * tiles on `gang`'s turf (the largest live network when no gang is given or none touches it).
 * Returns −1 when nothing is live. The caller pushes `{ i, until }` into story.railOut and
 * calls refresh().
 */
export function railOutTarget(world: World, gang?: GangId): number {
  const code = gang ? TURF_OWNER[gang] : 0;
  const owner = world.turf.owner;
  let best = -1;
  let bestScore = -1;
  for (const net of railNetworks(world)) {
    if (!net.live) continue;
    let onTurf = 0;
    if (code) for (const i of net.tiles) if (owner[i] === code) onTurf++;
    const score = onTurf * AREA + net.tiles.length;
    if (score > bestScore) {
      bestScore = score;
      best = net.tiles[0];
    }
  }
  return best;
}

/** Tile indices for the `rail` effect target: every rail tile, widened by Chebyshev r (r1 = plus neighbours). */
export function railArea(world: World, r = 0): number[] {
  const rail = world.rail;
  mark.fill(0);
  const rr = Math.max(0, Math.floor(r));
  for (let i = 0; i < AREA; i++) {
    if (!rail[i]) continue;
    const x = i % N;
    const y = (i / N) | 0;
    fillRect(mark, x - rr, y - rr, x + rr, y + rr, 1);
  }
  const out: number[] = [];
  for (let i = 0; i < AREA; i++) if (mark[i]) out.push(i);
  return out;
}

// ── Refresh ─────────────────────────────────────────────────────────────────

function fillRect(a: Uint8Array, x0: number, y0: number, x1: number, y1: number, bit: number): void {
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > N - 1) x1 = N - 1;
  if (y1 > N - 1) y1 = N - 1;
  for (let y = y0; y <= y1; y++) {
    const row = y * N;
    for (let x = x0; x <= x1; x++) a[row + x] |= bit;
  }
}

/** Flat disc (Euclidean from (cx, cy), tile centres) marked with `bit`. */
function markDisc(a: Uint8Array, cx: number, cy: number, r: number, bit: number): void {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(N - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(N - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = ya; y <= yb; y++) {
    const dy = y + 0.5 - cy;
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) a[y * N + x] |= bit;
    }
  }
}

/** Add `v` inside a flat disc. */
function addDisc(layer: Float32Array, cx: number, cy: number, r: number, v: number): void {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(N - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(N - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = ya; y <= yb; y++) {
    const dy = y + 0.5 - cy;
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) layer[y * N + x] += v;
    }
  }
}

/** Max-combine a coverage-style disc (1 at the centre, 0 at the edge). */
function maxDisc(layer: Float32Array, cx: number, cy: number, r: number): void {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(N - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(N - 1, Math.ceil(cy + r));
  const inv = 1 / r;
  for (let y = ya; y <= yb; y++) {
    const dy = y + 0.5 - cy;
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      const v = 1 - Math.sqrt(dx * dx + dy * dy) * inv;
      const i = y * N + x;
      if (v > layer[i]) layer[i] = v;
    }
  }
}

const centreX = (b: Building) => b.x + b.size / 2;
const centreY = (b: Building) => b.y + b.size / 2;

/**
 * Tall checks, active links, live rail networks (BFS), world.vertical metrics
 * and world.layerParts.vertical; then composeLayers and emit 'vertical'.
 * Run monthly, on load, and after any rail, link, bulldoze or building change.
 * The first refresh of a world (load) is quiet: no news; `quiet` forces that.
 */
export function refresh(world: World, opts?: { quiet?: boolean }): void {
  const v = world.vertical;
  const quiet = v.version === 0 || !!opts?.quiet;
  const m = v.metrics;
  const rail = world.rail;

  // Stacks and crowns.
  m.stacksStage2 = 0;
  m.stacksStage3 = 0;
  m.crowns.foundry = 0;
  m.crowns.glare = 0;
  m.crowns.nest = 0;
  m.crowns.commons = 0;
  for (const b of world.buildings.values()) {
    if (b.type !== 'stack') continue;
    const s = completeStage(b);
    if (s >= 2) m.stacksStage2++;
    if (s >= 3) {
      m.stacksStage3++;
      if (b.crown && b.crown in m.crowns) m.crowns[b.crown]++;
    }
  }

  // Skybridges: active = both anchors tall and powered.
  let sealedNews = false;
  const active = v.activeLinks;
  const wasActive = active.size ? [...active] : null;
  active.clear();
  for (const l of world.links) {
    const sealed = linkSealed(world, l);
    if (!sealed && anchorPowered(world, l.ax, l.ay) && anchorPowered(world, l.bx, l.by)) active.add(l.id);
    else if (sealed && !quiet && !sealedNews && wasActive?.includes(l.id)) {
      sealedNews = true;
      world.addNews('Skybridge sealed: an anchor dropped below the skyline.', 'warn');
    }
  }
  m.skybridges = active.size;

  // Rail: connected components, powered stations, live networks.
  prevLive.set(v.railLive);
  const live = v.railLive;
  live.fill(0);
  v.liveStations.clear();
  comp.fill(-1);
  let railTiles = 0;
  let maxStations = 0;
  let liveNews = false;
  let deadNews = false;
  const code = TURF_OWNER;
  const owner = world.turf.owner;
  m.railOnTurf.undertow = 0;
  m.railOnTurf.kites = 0;
  let compId = 0;
  for (let s = 0; s < AREA; s++) {
    if (!rail[s] || comp[s] !== -1) continue;
    // Inline BFS (bfsNetwork without the per-network allocation).
    let head = 0;
    let tail = 0;
    order[tail++] = s;
    comp[s] = compId;
    compStations.length = 0;
    let out = false;
    while (head < tail) {
      const i = order[head++];
      collectStations(world, i);
      if (!out && railOutActive(world, i)) out = true;
      const n = linkedNeighbours(rail, i, nb);
      for (let k = 0; k < n; k++) {
        const j = nb[k];
        if (comp[j] !== -1) continue;
        comp[j] = compId;
        order[tail++] = j;
      }
    }
    compId++;
    railTiles += tail;
    const isLive = !out && compStations.length >= RIBBON.minStations;
    let wasLive = false;
    for (let k = 0; k < tail; k++) {
      const i = order[k];
      if (prevLive[i]) wasLive = true;
      if (isLive) live[i] = 1;
      const o = owner[i];
      if (o === code.undertow) m.railOnTurf.undertow++;
      else if (o === code.kites) m.railOnTurf.kites++;
    }
    if (isLive) {
      for (const id of compStations) v.liveStations.add(id);
      if (compStations.length > maxStations) maxStations = compStations.length;
      if (!wasLive && !quiet && !liveNews) {
        liveNews = true;
        world.addNews(`Ribbon live: ${compStations.length} stations joined by light.`, 'good');
      }
    } else if (wasLive && !out && !quiet && !deadNews) {
      deadNews = true;
      const i = order[0];
      world.addNews(
        `Ribbon line dark near ${districtName(i % N, (i / N) | 0, world.seed)}. It needs ${RIBBON.minStations} powered stations.`,
        'warn',
      );
    }
  }
  m.railTiles = railTiles;
  m.railMaxStations = maxStations;

  writeLayers(world, world.layerParts.vertical);
  composeLayers(world);
  v.version++;
  world.events.emit('vertical');
}

/** Rewrite world.layerParts.vertical from the caches refresh() just built. */
function writeLayers(world: World, L: SimLayers): void {
  resetLayers(L);
  const v = world.vertical;
  const tiles = world.tiles;
  const SB = SKYBRIDGE;
  const RB = RIBBON;

  // 1. Active skybridges: lv near each end, trips × 0.8 on the anchor tiles (once per anchor).
  if (v.activeLinks.size) {
    mark.fill(0);
    for (const l of world.links) {
      if (!v.activeLinks.has(l.id)) continue;
      for (let e = 0; e < 2; e++) {
        const x = e ? l.bx : l.ax;
        const y = e ? l.by : l.ay;
        markDisc(mark, x + 0.5, y + 0.5, SB.lvRadius, 1);
        const t = tiles[y * N + x];
        const b = t.buildingId >= 0 ? world.buildings.get(t.buildingId) : undefined;
        if (b) fillRect(mark, b.x, b.y, b.x + b.size - 1, b.y + b.size - 1, 2);
        else mark[y * N + x] |= 2;
      }
    }
    for (let i = 0; i < AREA; i++) {
      const k = mark[i];
      if (!k) continue;
      if (k & 1) L.lvAdd[i] += SB.lv;
      if (k & 2) L.tripMul[i] *= SB.tripMul;
    }
  }

  // 2. Live ribbon: transit on and near the track, fewer trips nearby, station discs.
  const live = v.railLive;
  if (v.liveStations.size) {
    mark.fill(0);
    for (let i = 0; i < AREA; i++) {
      if (!live[i]) continue;
      const x = i % N;
      const y = (i / N) | 0;
      fillRect(mark, x - 1, y - 1, x + 1, y + 1, 1);
      fillRect(mark, x - RB.tripRadius, y - RB.tripRadius, x + RB.tripRadius, y + RB.tripRadius, 2);
      const t = tiles[i];
      if (t.zone === RES && t.buildingId < 0) L.lvAdd[i] += RB.underResLv;
    }
    for (const id of v.liveStations) {
      const b = world.buildings.get(id);
      if (!b) continue;
      const r = b.type === 'stack' ? RB.stackStationRadius : buildingStats(b, S).radius + RB.stationRadiusAdd;
      if (r > 0) maxDisc(L.transitAdd, centreX(b), centreY(b), r);
      markDisc(mark, centreX(b), centreY(b), RB.stationLvRadius, 4);
    }
    const ta = L.transitAdd;
    for (let i = 0; i < AREA; i++) {
      const k = mark[i];
      if (!k) continue;
      if (k & 1 && ta[i] < RB.transit) ta[i] = RB.transit;
      if (k & 2) L.tripMul[i] *= RB.tripMul;
      if (k & 4) L.lvAdd[i] += RB.stationLv;
    }
  }

  // 3–5. Buildings: Glarewall crime cut, shadeside around Hab Cores, Glare crowns.
  let shade = false;
  for (const b of world.buildings.values()) {
    const on = b.powered && b.offline <= 0;
    if (b.type === 'glarewall') {
      if (on) addDisc(L.crimeAdd, centreX(b), centreY(b), 4, -0.05);
    } else if (b.type === 'stack') {
      const s = completeStage(b);
      if (s >= 2) {
        if (!shade) {
          shade = true;
          mark.fill(0);
        }
        const r = STACK_SHADESIDE.radius;
        fillRect(mark, b.x - r, b.y - r, b.x + b.size - 1 + r, b.y + b.size - 1 + r, 1);
      }
      if (s >= 3 && b.crown === 'glare' && on) {
        const c = CROWNS.glare;
        addDisc(L.lvAdd, centreX(b), centreY(b), c.lvRadius ?? 8, c.lvAdd ?? 0);
      }
    }
  }
  if (shade) {
    for (let i = 0; i < AREA; i++) {
      if (!mark[i]) continue;
      const t = tiles[i];
      if (t.buildingId >= 0 || t.level === 0) continue;
      if (t.zone === RES) L.lvAdd[i] += STACK_SHADESIDE.resLv;
      else if (t.zone === COM) L.lvAdd[i] += STACK_SHADESIDE.comLv;
    }
  }
}

// ── Daily, monthly, mods ────────────────────────────────────────────────────

/** Display name of a stack stage, crown-aware ("Hab Core", "Glare Crown"). */
export function stageName(stage: number, crown?: CrownId): string {
  if (stage >= 3 && crown) return `${CROWNS[crown].name} Crown`;
  return STACK_STAGES[Math.max(0, Math.min(2, stage - 1))].name;
}

/**
 * Daily: count down Stratablock buildDays; completion posts news, refreshes the
 * caches and emits 'vertical'. Returns true when a stage completed (the
 * director should then markDirty() so crown mods resolve).
 */
export function onDay(world: World): boolean {
  let done = false;
  for (const b of world.buildings.values()) {
    if (b.type !== 'stack') continue;
    const d = b.buildDays ?? 0;
    if (d <= 0) continue;
    if (d > 1) {
      b.buildDays = d - 1; // no tile event: the scaffolding look only changes on completion
      continue;
    }
    const stage = b.stage ?? 1;
    world.setStage(b, stage, 0);
    const where = districtName(b.x + (b.size >> 1), b.y + (b.size >> 1), world.seed);
    world.addNews(`${stageName(stage, b.crown)} complete in ${where}. The skyline steps up.`, 'good');
    done = true;
  }
  if (done) refresh(world);
  return done;
}

/** Monthly ledger amounts (positive CR) for the "Skybridges" and "Ribbon Rail" expense lines. */
export function upkeep(world: World): { skybridges: number; rail: number } {
  let sky = 0;
  for (const l of world.links) {
    if (linkSealed(world, l)) continue; // sealed bridges cost nothing
    sky += SKYBRIDGE.upkeepBase + SKYBRIDGE.upkeepPerTile * linkGap(l);
  }
  let n = 0;
  const rail = world.rail;
  for (let i = 0; i < AREA; i++) if (rail[i]) n++;
  return { skybridges: sky, rail: n * RIBBON.upkeep };
}

/**
 * resolveMods sources 6 and 7 (§4.2, §4.3, §4.5): skybridge and cluster demand,
 * Commons Hall approval (+2 each, max +4), and the Glare / Commons / Kite Nest
 * crown patches (per complete, powered crown).
 */
export function verticalPatch(world: World): ModPatch {
  const p: ModPatch = {};
  const SB = SKYBRIDGE;
  const active = world.vertical.activeLinks;
  if (active.size) {
    let com = Math.min(SB.comCap, SB.comPer * active.size);
    // Clusters: connected components of anchors joined by active bridges.
    const parent = new Map<number, number>();
    const find = (k: number): number => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = k;
      while (c !== r) {
        const nx = parent.get(c)!;
        parent.set(c, r);
        c = nx;
      }
      return r;
    };
    for (const l of world.links) {
      if (!active.has(l.id)) continue;
      const a = anchorKey(world, l.ax, l.ay);
      const b = anchorKey(world, l.bx, l.by);
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    const size = new Map<number, number>();
    for (const k of parent.keys()) {
      const r = find(k);
      size.set(r, (size.get(r) ?? 0) + 1);
    }
    let cluster = 0;
    for (const k of size.values()) if (k >= 3) cluster += SB.clusterPer * (k - 2);
    com += Math.min(SB.clusterCap, cluster);
    if (com) p.demandCom = com;
  }

  let commons = 0;
  let approval = 0;
  let taxMul = 1;
  let trace = 0;
  for (const b of world.buildings.values()) {
    const on = b.powered && b.offline <= 0;
    if (!on) continue;
    if (b.type === 'commons') commons++;
    else if (b.type === 'stack' && b.crown && completeStage(b) >= 3) {
      const mods = CROWNS[b.crown]?.mods;
      if (!mods) continue;
      approval += mods.approvalAdd ?? 0;
      taxMul *= mods.taxIncomeMul ?? 1;
      trace += mods.traceMonthly ?? 0;
    }
  }
  approval += Math.min(4, commons * 2);
  if (approval) p.approvalAdd = approval;
  if (taxMul !== 1) p.taxIncomeMul = taxMul;
  if (trace) p.traceMonthly = trace;
  return p;
}

// ── Tool planning (called by actions.planAction) ────────────────────────────

interface Pt {
  x: number;
  y: number;
}

/**
 * Normalise a drag end on a building to the footprint edge tile facing the
 * other end along the drag axis; a zone tile is its own anchor.
 */
function edgeAnchor(world: World, at: Pt, toward: Pt, axisX: boolean): Pt {
  const b = world.buildingAt(at.x, at.y);
  if (!b) return { x: at.x, y: at.y };
  if (axisX) {
    const dir = Math.sign(toward.x - at.x);
    return { x: dir > 0 ? b.x + b.size - 1 : b.x, y: at.y };
  }
  const dir = Math.sign(toward.y - at.y);
  return { x: at.x, y: dir > 0 ? b.y + b.size - 1 : b.y };
}

/** Does any existing bridge use (x, y) as a gap tile? */
function gapUsed(world: World, x: number, y: number): boolean {
  for (const l of world.links) {
    const minX = Math.min(l.ax, l.bx);
    const maxX = Math.max(l.ax, l.bx);
    const minY = Math.min(l.ay, l.by);
    const maxY = Math.max(l.ay, l.by);
    if (l.ay === l.by) {
      if (y === l.ay && x > minX && x < maxX) return true;
    } else if (x === l.ax && y > minY && y < maxY) return true;
  }
  return false;
}

/**
 * Skybridge plan (§4.3): a straight drag from one tall anchor to another, 2..8
 * gap tiles, at most 2 bridges per anchor, no shared gap tiles. Fills `plan`
 * (tiles, span, base cost, reason) and returns the number of changes (0 or 1).
 * The caller applies cost multipliers and the funds check.
 */
export function planSkybridge(world: World, from: Pt, to: Pt, plan: ActionPlan): number {
  const SB = SKYBRIDGE;
  const fail = (reason: string, pts: Pt[]) => {
    for (const p of pts) if (world.inBounds(p.x, p.y)) plan.tiles.push({ x: p.x, y: p.y, ok: false });
    plan.reason = reason;
    return 0;
  };
  if (!world.inBounds(from.x, from.y) || !world.inBounds(to.x, to.y)) return fail('Off the map', [from, to]);
  if (!isTallAt(world, from.x, from.y)) return fail('Start on a tall tower', [from]);
  const keyA0 = anchorKey(world, from.x, from.y);
  if (from.x === to.x && from.y === to.y) return fail('Drag to another tall tower', [from]);
  if (from.x !== to.x && from.y !== to.y) return fail('Skybridges run in a straight line', [from, to]);
  if (anchorKey(world, to.x, to.y) === keyA0) return fail('Drag to another tall tower', [from, to]);

  const axisX = from.y === to.y;
  const a = edgeAnchor(world, from, to, axisX);
  const b = edgeAnchor(world, to, from, axisX);
  const gap = Math.abs(b.x - a.x) + Math.abs(b.y - a.y) - 1;
  const span = { ax: a.x, ay: a.y, bx: b.x, by: b.y, gap: Math.max(0, gap) };
  plan.span = span;
  plan.tiles.push({ x: a.x, y: a.y, ok: true });
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  let blocked: string | null = null;
  for (let k = 1; k <= gap; k++) {
    const x = a.x + dx * k;
    const y = a.y + dy * k;
    let ok = true;
    if (isTallAt(world, x, y)) {
      ok = false;
      blocked ??= 'A tower is in the way';
    } else if (gapUsed(world, x, y)) {
      ok = false;
      blocked ??= 'Another skybridge crosses here';
    }
    plan.tiles.push({ x, y, ok });
  }
  const endOk = isTallAt(world, b.x, b.y);
  plan.tiles.push({ x: b.x, y: b.y, ok: endOk });
  plan.cost = SB.base + SB.perTile * span.gap;

  const bad = (reason: string) => {
    plan.reason = reason;
    for (const t of plan.tiles) t.ok = false;
    plan.cost = 0;
    return 0;
  };
  if (!endOk) return bad('End on a tall tower');
  if (gap < SB.minGap) return bad(`Gap ${span.gap}: min ${SB.minGap}`);
  if (gap > SB.maxGap) return bad(`Gap ${gap}: max ${SB.maxGap}`);
  const keyA = anchorKey(world, a.x, a.y);
  const keyB = anchorKey(world, b.x, b.y);
  for (const l of world.links) {
    const ka = anchorKey(world, l.ax, l.ay);
    const kb = anchorKey(world, l.bx, l.by);
    if ((ka === keyA && kb === keyB) || (ka === keyB && kb === keyA)) return bad('Already linked');
  }
  if (linksOnAnchor(world, keyA) >= SB.maxPerAnchor || linksOnAnchor(world, keyB) >= SB.maxPerAnchor) {
    return bad(`A tower takes at most ${SB.maxPerAnchor} skybridges`);
  }
  if (blocked) {
    plan.reason = blocked;
    plan.cost = 0;
    return 0;
  }
  return 1;
}

/**
 * Ribbon Rail plan (§4.4) along an L-path (from actions.roadPath), up to
 * RIBBON.maxDrag tiles. Land, water, roads and zone tiles are allowed; building
 * tiles only on station footprints. Joins onto existing track. Fills `plan`
 * (tiles, railMasks, base cost, reason) and returns the number of changed tiles.
 */
export function planRail(world: World, path: readonly Pt[], plan: ActionPlan): number {
  const RB = RIBBON;
  let pts = path.filter((p) => world.inBounds(p.x, p.y));
  let truncated = false;
  if (pts.length > RB.maxDrag) {
    pts = pts.slice(0, RB.maxDrag);
    truncated = true;
  }
  const rail = world.rail;
  const masks: number[] = [];
  let blocked = false;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const i = p.y * N + p.x;
    let mask = rail[i];
    for (const q of [pts[k - 1], pts[k + 1]]) {
      if (!q) continue;
      if (q.y < p.y) mask |= 1;
      else if (q.x > p.x) mask |= 2;
      else if (q.y > p.y) mask |= 4;
      else if (q.x < p.x) mask |= 8;
    }
    masks.push(mask);
    const t = world.tiles[i];
    let ok = true;
    if (t.buildingId >= 0) {
      const b = world.buildings.get(t.buildingId);
      ok = !!b && !!BUILDINGS[b.type].station;
    }
    if (!ok) blocked = true;
    plan.tiles.push({ x: p.x, y: p.y, ok });
  }
  plan.railMasks = masks;
  if (pts.length < 2) {
    plan.reason = 'Drag to lay track';
    return 0;
  }
  if (blocked) {
    plan.reason = 'Blocked by buildings';
    return 0;
  }
  let changes = 0;
  let cost = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const i = p.y * N + p.x;
    if (masks[k] === rail[i]) continue;
    changes++;
    if (!rail[i]) cost += world.tiles[i].terrain === Terrain.Water ? RB.perWaterTile : RB.perTile;
  }
  plan.cost = cost;
  if (truncated) plan.reason = `Max ${RB.maxDrag} tiles per drag`;
  return changes;
}
