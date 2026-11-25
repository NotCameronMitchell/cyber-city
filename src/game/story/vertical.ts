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

import { artOffset } from '../districts/slots';
import { buildingStats, completeStage } from '../buildingStats';
import { BUILDINGS, CROWNS, RIBBON, SKYBRIDGE, STACK_SHADESIDE, STACK_STAGES, TURF_OWNER } from '../config';
import { heightOf, roofOf } from '../heights';
import { districtName } from '../news';
import { parcelAt } from '../parcels';
import { scratchFor } from '../frame';
import { tierCapacity } from '../sim/tiers';
import { TRIPS_PER_UNIT } from '../sim/tuning';
import { Terrain, ZoneType, type ActionPlan, type BridgePayoff, type Building, type MomentId, type Tile } from '../types';
import type { World } from '../world';
import { composeLayers, resetLayers } from './mods';
import type { BuildingStats, CrownId, GangId, ModPatch, SimLayers, SkyLink } from './types';

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
/** Per-tile scratch, one set per frame size (MEGACITY §3.1). */
const scratch = scratchFor((area) => ({
  comp: new Int32Array(area),
  order: new Int32Array(area),
  prevLive: new Uint8Array(area),
  mark: new Uint8Array(area),
}));
const compStations: number[] = [];
/** Lobby land value per tile (max-combined between lobbies), scratch for writeLayers. */
const lobbyLvAt = new Map<number, number>();

// ── Anchors ─────────────────────────────────────────────────────────────────

/** Level-3 Hab or Market tile that is not abandoned (a tall zone anchor, §4.3). */
export function isTallZoneTile(t: Tile): boolean {
  return !t.abandoned && t.level === 3 && (t.zone === RES || t.zone === COM);
}

/** True if a building counts as tall (Spire, Arcology, Glarewall, Stratablock at complete stage ≥ 2). */
export function isTallBuilding(b: Building): boolean {
  return buildingStats(b, S).tall;
}

/** Is (x, y) a tall skybridge anchor right now (MEGACITY §5.3: owned, and a tall tile, an L3 parcel or a tall building)? */
export function isTallAt(world: World, x: number, y: number): boolean {
  return anchorAt(world, x, y) !== null;
}

// ── Skybridge v2 anchors (MEGACITY §5.3, §6.1) ──────────────────────────────

/** A skybridge anchor: a tall zone tile, an L3 parcel (one anchor, keyed on its head) or a tall building. */
export interface Anchor {
  /** anchorKey: the building id, else −(head tile index + 1). */
  key: number;
  /** The anchor tile index (Sky Lobby anchors): the parcel head, the zone tile, or a building's top-left. */
  i: number;
  /** Footprint, inclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  building: Building | null;
  parcel: boolean;
  /** Bridges it takes (§5.3 rule 6). */
  limit: number;
  /** Facade top a tube attaches under (heights.ts roofOf). */
  roof: number;
}

/** The anchor at (x, y), or null (not tall, or on locked land). */
export function anchorAt(world: World, x: number, y: number): Anchor | null {
  if (!world.isOwned(x, y)) return null;
  const N = world.N;
  const t = world.tiles[y * N + x];
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (!b || !isTallBuilding(b)) return null;
    return {
      key: b.id,
      i: b.y * N + b.x,
      x0: b.x,
      y0: b.y,
      x1: b.x + b.size - 1,
      y1: b.y + b.size - 1,
      building: b,
      parcel: false,
      limit: b.type === 'kitemast' ? SKYBRIDGE.maxPerMast : SKYBRIDGE.maxPerBuilding,
      roof: roofOf(world, b.x, b.y),
    };
  }
  if (t.abandoned || (t.zone !== RES && t.zone !== COM)) return null;
  const p = parcelAt(world, x, y);
  if (p) {
    // A parcel is one anchor at its drawn (lowest) level: an L3 tile inside an L2 parcel is not tall.
    if (p.level !== 3) return null;
    return { key: -(p.hy * N + p.hx + 1), i: p.hy * N + p.hx, x0: p.x, y0: p.y, x1: p.x + p.w - 1, y1: p.y + p.h - 1, building: null, parcel: true, limit: SKYBRIDGE.maxPerParcel, roof: roofOf(world, p.hx, p.hy) };
  }
  if (!isTallZoneTile(t)) return null;
  return { key: -(y * N + x + 1), i: y * N + x, x0: x, y0: y, x1: x, y1: y, building: null, parcel: false, limit: SKYBRIDGE.maxPerAnchor, roof: roofOf(world, x, y) };
}

/** Heads (residents + jobs) of an anchor: a parcel counts every member (§5.5). */
export function anchorHeads(world: World, a: Anchor): number {
  if (a.building) {
    const st = buildingStats(a.building, S);
    return st.residents + st.jobsCom + st.jobsInd;
  }
  let n = 0;
  const N = world.N;
  const alley = world.fields.alleyNear;
  for (let y = a.y0; y <= a.y1; y++)
    for (let x = a.x0; x <= a.x1; x++) {
      const i = y * N + x;
      const t = world.tiles[i];
      if (t.zone === ZoneType.None || t.level < 1 || t.abandoned) continue;
      n += tierCapacity(t.zone, t.level, t.wealth, alley[i]);
    }
  return n;
}

/** Car trips a day an anchor makes (the traffic pass's per-head rates; a building its own trips). */
function anchorTrips(world: World, a: Anchor): number {
  if (a.building) return buildingStats(a.building, S).trips;
  let n = 0;
  const N = world.N;
  const alley = world.fields.alleyNear;
  for (let y = a.y0; y <= a.y1; y++)
    for (let x = a.x0; x <= a.x1; x++) {
      const i = y * N + x;
      const t = world.tiles[i];
      if (t.zone === ZoneType.None || t.level < 1 || t.abandoned) continue;
      n += tierCapacity(t.zone, t.level, t.wealth, alley[i]) * (TRIPS_PER_UNIT[t.zone] ?? 0);
    }
  return n;
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
  const N = world.N;
  const t = world.tileAt(x, y);
  if (!t) return 0;
  if (t.buildingId >= 0) return t.buildingId;
  // A parcel is one anchor keyed on its head (MEGACITY §6.1).
  const p = parcelAt(world, x, y);
  return p ? -(p.hy * N + p.hx + 1) : -(y * N + x + 1);
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

/** Sealed ("dark" on screen, MEGACITY §5.3 rule 9): an anchor is no longer tall. Dark bridges are free and give nothing. */
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
  const N = world.N;
  const area = world.area;
  out.fill(0);
  const tiles = world.tiles;
  for (let i = 0; i < area; i++) {
    const t = tiles[i];
    if (t.buildingId < 0 && isTallZoneTile(t)) out[i] = 1;
  }
  for (const b of world.buildings.values()) {
    if (!isTallBuilding(b)) continue;
    fillRect(out, b.x, b.y, b.x + b.size - 1, b.y + b.size - 1, 1, N);
  }
  return out;
}

/** Fill `out` with 1 on the anchor and gap tiles of every active skybridge. */
export function spanMask(world: World, out: Uint8Array): Uint8Array {
  const N = world.N;
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
function linkedNeighbours(rail: Uint8Array, i: number, out: Int32Array, N: number): number {
  const area = rail.length;
  const m = rail[i];
  const x = i % N;
  let n = 0;
  if (m & 1 && i >= N && rail[i - N] & 4) out[n++] = i - N;
  if (m & 2 && x < N - 1 && rail[i + 1] & 8) out[n++] = i + 1;
  if (m & 4 && i < area - N && rail[i + N] & 1) out[n++] = i + N;
  if (m & 8 && x > 0 && rail[i - 1] & 2) out[n++] = i - 1;
  return n;
}
const nb = new Int32Array(4);

/** Distinct powered stations touching rail tile i (under it or 4-adjacent), appended to compStations. */
function collectStations(world: World, i: number): void {
  const N = world.N;
  const area = world.area;
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
      if (i >= area - N) continue;
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
  const N = world.N;
  const { comp } = scratch(world.area);
  if (!world.inBounds(x, y)) return null;
  const start = y * N + x;
  const rail = world.rail;
  if (!rail[start]) return null;
  comp.fill(-1);
  return bfsNetwork(world, start, 0, comp);
}

function bfsNetwork(world: World, start: number, id: number, seen: Int32Array): RailNetwork {
  const { order } = scratch(world.area);
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
    const n = linkedNeighbours(rail, i, nb, world.N);
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
  const area = world.area;
  const { comp } = scratch(world.area);
  const rail = world.rail;
  comp.fill(-1);
  const nets: RailNetwork[] = [];
  for (let i = 0; i < area; i++) {
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
  const area = world.area;
  const code = gang ? TURF_OWNER[gang] : 0;
  const owner = world.turf.owner;
  let best = -1;
  let bestScore = -1;
  for (const net of railNetworks(world)) {
    if (!net.live) continue;
    let onTurf = 0;
    if (code) for (const i of net.tiles) if (owner[i] === code) onTurf++;
    const score = onTurf * area + net.tiles.length;
    if (score > bestScore) {
      bestScore = score;
      best = net.tiles[0];
    }
  }
  return best;
}

/** Tile indices for the `rail` effect target: every rail tile, widened by Chebyshev r (r1 = plus neighbours). */
export function railArea(world: World, r = 0): number[] {
  const N = world.N;
  const area = world.area;
  const { mark } = scratch(world.area);
  const rail = world.rail;
  mark.fill(0);
  const rr = Math.max(0, Math.floor(r));
  for (let i = 0; i < area; i++) {
    if (!rail[i]) continue;
    const x = i % N;
    const y = (i / N) | 0;
    fillRect(mark, x - rr, y - rr, x + rr, y + rr, 1, N);
  }
  const out: number[] = [];
  for (let i = 0; i < area; i++) if (mark[i]) out.push(i);
  return out;
}

// ── Refresh ─────────────────────────────────────────────────────────────────

function fillRect(a: Uint8Array, x0: number, y0: number, x1: number, y1: number, bit: number, N: number): void {
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
function markDisc(a: Uint8Array, cx: number, cy: number, r: number, bit: number, N: number): void {
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
function addDisc(layer: Float32Array, cx: number, cy: number, r: number, v: number, N: number): void {
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
function maxDisc(layer: Float32Array, cx: number, cy: number, r: number, N: number): void {
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
  const N = world.N;
  const area = world.area;
  const { comp, order, prevLive } = scratch(world.area);
  const v = world.vertical;
  const quiet = v.version === 0 || !!opts?.quiet;
  const m = v.metrics;
  const rail = world.rail;

  // Stacks and crowns.
  m.stacksStage2 = 0;
  m.stacksStage3 = 0;
  for (const k of Object.keys(m.crowns) as CrownId[]) m.crowns[k] = 0;
  for (const b of world.buildings.values()) {
    if (b.type !== 'stack') continue;
    const s = completeStage(b);
    if (s >= 2) m.stacksStage2++;
    if (s >= 3) {
      m.stacksStage3++;
      if (b.crown && b.crown in m.crowns) m.crowns[b.crown]++;
    }
  }

  // Skybridges: active = both anchors tall and powered; "dark" on screen when an end stops being tall (§5.3 rule 9).
  let sealedNews = false;
  const active = v.activeLinks;
  const wasActive = active.size ? [...active] : null;
  active.clear();
  for (const l of world.links) {
    const sealed = linkSealed(world, l);
    if (!sealed && anchorPowered(world, l.ax, l.ay) && anchorPowered(world, l.bx, l.by)) active.add(l.id);
    else if (sealed && !quiet && !sealedNews && wasActive?.includes(l.id)) {
      sealedNews = true;
      world.addNews('Skybridge dark: an anchor dropped below the skyline.', 'warn');
    }
  }
  m.skybridges = active.size;
  refreshLobbies(world, quiet);

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
  for (let s = 0; s < area; s++) {
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
      const n = linkedNeighbours(rail, i, nb, world.N);
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
        `Ribbon line dark near ${districtName(i % N, (i / N) | 0, world.seed, artOffset(world))}. It needs ${RIBBON.minStations} powered stations.`,
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

/** Number words for the lobby news line (§5.5, Appendix B). */
const WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** Lobby group keys and their anchors, as last refreshed (for "new lobby" detection), per world. */
const LOBBY_STATE = new WeakMap<World, { keys: Set<number> }>();

/**
 * Sky Lobbies (§5.5): connected groups of k ≥ 3 anchors joined by active bridges (a parcel counts once). Writes
 * world.vertical.lobbies (anchor tile indices, visitors) and lobbyVisitors (capped city-wide), world.stats.skyLobbies,
 * and announces a new lobby: the city's first with the moment banner, later ones with one news line.
 */
function refreshLobbies(world: World, quiet: boolean): void {
  const v = world.vertical;
  const L = SKYBRIDGE.lobby;
  const lobbies: { anchors: number[]; visitors: number }[] = [];
  let total = 0;
  let largest = 0;
  const keys = new Set<number>();
  const fresh: { anchors: number[]; k: number }[] = [];
  const prev = LOBBY_STATE.get(world);
  for (const g of anchorGroups(world).values()) {
    if (g.length < L.min) continue;
    const anchors = g.map((a) => a.i).sort((a, b) => a - b);
    const visitors = lobbyVisitors(g.length);
    lobbies.push({ anchors, visitors });
    total += visitors;
    largest = Math.max(largest, g.length);
    keys.add(anchors[0]);
    if (prev && !prev.keys.has(anchors[0]) && !anchors.some((a) => prev.keys.has(a))) fresh.push({ anchors, k: g.length });
  }
  const before = v.lobbies.length;
  v.lobbies = lobbies;
  v.lobbyVisitors = Math.min(L.cityCap, total);
  world.stats.skyLobbies = { count: lobbies.length, largest, visitors: v.lobbyVisitors };
  // Lobby membership feeds coverage (the Halo Lookout works only while bridged into one, O3).
  if (lobbies.length !== before) world.coverageVersion++;
  LOBBY_STATE.set(world, { keys: new Set(lobbies.flatMap((l) => l.anchors)) });
  if (quiet || !prev) return;
  const N = world.N;
  for (const f of fresh) {
    const name = lobbyName(world, f.anchors[0]);
    if (!world.story.flags.firstSkyLobby) {
      world.story.flags.firstSkyLobby = true;
      // MomentId has no 'lobby' (frozen types.ts): the banner rides the 'moment' event under 'region'; it is not recorded.
      world.events.emit('moment', { id: 'region' as MomentId, title: `SKY LOBBY · ${name.toUpperCase()}`, sub: `${f.k} towers linked: visitors and land value` });
    } else {
      const at = f.anchors[0];
      const where = districtName(at % N, (at / N) | 0, world.seed, artOffset(world));
      world.addNews(`${WORDS[f.k] ?? f.k} towers in ${where} are one Sky Lobby now: ${name}.`, 'good');
    }
  }
}

/** Rewrite world.layerParts.vertical from the caches refresh() just built. */
function writeLayers(world: World, L: SimLayers): void {
  const N = world.N;
  const area = world.area;
  const { mark } = scratch(world.area);
  resetLayers(L);
  const v = world.vertical;
  const tiles = world.tiles;
  const SB = SKYBRIDGE;
  const RB = RIBBON;

  // 1. Active skybridges: lv near each end, trips × 0.8 on the anchors' footprints (once per anchor; a parcel is one
  //    anchor). In a Sky Lobby (§5.5) its towers' trips are × 0.75 instead, and land value on and within 2 of each of
  //    them gains +0.02 × min(k, 4) on top.
  if (v.activeLinks.size) {
    mark.fill(0);
    for (const l of world.links) {
      if (!v.activeLinks.has(l.id)) continue;
      for (let e = 0; e < 2; e++) {
        const x = e ? l.bx : l.ax;
        const y = e ? l.by : l.ay;
        markDisc(mark, x + 0.5, y + 0.5, SB.lvRadius, 1, N);
        const a = anchorAt(world, x, y);
        if (a) fillRect(mark, a.x0, a.y0, a.x1, a.y1, 2, N);
        else mark[y * N + x] |= 2;
      }
    }
    const LB = SB.lobby;
    if (v.lobbies.length) {
      for (const lob of v.lobbies) {
        const k = lob.anchors.length;
        for (const ai of lob.anchors) {
          const a = anchorAt(world, ai % N, (ai / N) | 0);
          if (!a) continue;
          fillRect(mark, a.x0, a.y0, a.x1, a.y1, 4, N);
          const lv = lobbyLv(k);
          const x0 = Math.max(0, a.x0 - LB.lvRadius);
          const y0 = Math.max(0, a.y0 - LB.lvRadius);
          const x1 = Math.min(N - 1, a.x1 + LB.lvRadius);
          const y1 = Math.min(N - 1, a.y1 + LB.lvRadius);
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.ownedAt(y * N + x)) lobbyLvAt.set(y * N + x, Math.max(lobbyLvAt.get(y * N + x) ?? 0, lv));
        }
      }
      for (const [i, lv] of lobbyLvAt) L.lvAdd[i] += lv;
      lobbyLvAt.clear();
    }
    for (let i = 0; i < area; i++) {
      const k = mark[i];
      if (!k) continue;
      if (k & 1) L.lvAdd[i] += SB.lv;
      if (k & 4) L.tripMul[i] *= LB.tripMul;
      else if (k & 2) L.tripMul[i] *= SB.tripMul;
    }
  }

  // 2. Live ribbon: transit on and near the track, fewer trips nearby, station discs.
  const live = v.railLive;
  if (v.liveStations.size) {
    mark.fill(0);
    for (let i = 0; i < area; i++) {
      if (!live[i]) continue;
      const x = i % N;
      const y = (i / N) | 0;
      fillRect(mark, x - 1, y - 1, x + 1, y + 1, 1, N);
      fillRect(mark, x - RB.tripRadius, y - RB.tripRadius, x + RB.tripRadius, y + RB.tripRadius, 2, N);
      const t = tiles[i];
      if (t.zone === RES && t.buildingId < 0) L.lvAdd[i] += RB.underResLv;
    }
    for (const id of v.liveStations) {
      const b = world.buildings.get(id);
      if (!b) continue;
      const r = b.type === 'stack' ? RB.stackStationRadius : buildingStats(b, S).radius + RB.stationRadiusAdd;
      if (r > 0) maxDisc(L.transitAdd, centreX(b), centreY(b), r, N);
      markDisc(mark, centreX(b), centreY(b), RB.stationLvRadius, 4, N);
    }
    const ta = L.transitAdd;
    for (let i = 0; i < area; i++) {
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
      if (on) addDisc(L.crimeAdd, centreX(b), centreY(b), 4, -0.05, N);
    } else if (b.type === 'stack') {
      const s = completeStage(b);
      if (s >= 2) {
        if (!shade) {
          shade = true;
          mark.fill(0);
        }
        const r = STACK_SHADESIDE.radius;
        fillRect(mark, b.x - r, b.y - r, b.x + b.size - 1 + r, b.y + b.size - 1 + r, 1, N);
      }
      if (s >= 3 && b.crown === 'glare' && on) {
        const c = CROWNS.glare;
        addDisc(L.lvAdd, centreX(b), centreY(b), c.lvRadius ?? 8, c.lvAdd ?? 0, N);
      }
    }
  }
  if (shade) {
    for (let i = 0; i < area; i++) {
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
    const where = districtName(b.x + (b.size >> 1), b.y + (b.size >> 1), world.seed, artOffset(world));
    world.addNews(`${stageName(stage, b.crown)} complete in ${where}. The skyline steps up.`, 'good');
    done = true;
  }
  if (done) refresh(world);
  return done;
}

/** Monthly ledger amounts (positive CR) for the "Skybridges" and "Ribbon Rail" expense lines. */
export function upkeep(world: World): { skybridges: number; rail: number } {
  let sky = 0;
  const active = world.vertical.activeLinks;
  for (const l of world.links) {
    // A dark bridge (an end no longer tall or without power) costs nothing (MEGACITY §5.3 rule 9).
    if (!active.has(l.id)) continue;
    sky += SKYBRIDGE.upkeepBase + SKYBRIDGE.upkeepPerTile * linkGap(l);
  }
  let n = 0;
  const rail = world.rail;
  const area = world.area;
  for (let i = 0; i < area; i++) if (rail[i]) n++;
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

/** Does any existing bridge use (x, y) as a gap tile? Returns that link, else null. */
function gapLinkAt(world: World, x: number, y: number): SkyLink | null {
  for (const l of world.links) {
    const minX = Math.min(l.ax, l.bx);
    const maxX = Math.max(l.ax, l.bx);
    const minY = Math.min(l.ay, l.by);
    const maxY = Math.max(l.ay, l.by);
    if (l.ay === l.by) {
      if (y === l.ay && x > minX && x < maxX) return l;
    } else if (x === l.ax && y > minY && y < maxY) return l;
  }
  return null;
}

/** The roof a link's tube hangs under: the lower anchor's (§5.3 rule 4). */
export function linkRoof(world: World, l: Pick<SkyLink, 'ax' | 'ay' | 'bx' | 'by'>): number {
  return Math.min(roofOf(world, l.ax, l.ay), roofOf(world, l.bx, l.by));
}

/** A tube's top and bottom in world px for a roof R (§5.3 rule 4): top R − 6, bottom R − 23. */
export function tubeOf(roof: number): { top: number; bottom: number; clear: number } {
  const top = roof - SKYBRIDGE.tubeBelowRoof;
  const bottom = top - SKYBRIDGE.tubeHeight;
  return { top, bottom, clear: bottom - SKYBRIDGE.clearance };
}

/** v2 numbers (§5.3, §5.7): gap 1..10, 250 a gap tile. */
export const SKY_V2 = SKYBRIDGE.v2;

/** The price of a bridge over `gap` tiles (§5.3 rule 8). */
export function bridgeCost(gap: number): number {
  return SKYBRIDGE.base + SKY_V2.perTile * gap;
}

/** A candidate bridge between two anchors: where it runs, what it costs, and why it can't (null when it can). */
export interface SpanCheck {
  /** Lined up along a row (axis x) or a column (axis y); null when the footprints share no row or column. */
  axis: 'x' | 'y' | null;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  gap: number;
  roof: number;
  cost: number;
  reason: string | null;
  /** The gap tile that blocked, when one did. */
  block: { x: number; y: number } | null;
}

const NOT_ANNEXED = 'Not annexed yet';

/** "This tower has its 2 bridges" / "This tower has its 3 bridges" / "This building has 4 bridges" (§5.3). */
export function limitReason(a: Anchor): string {
  return a.building ? `This building has ${a.limit} bridges` : `This tower has its ${a.limit} bridges`;
}

/**
 * Check a bridge between anchors A and B (§5.3): lined up (a row or column of one footprint meets the other's), gap
 * 1..10 between the facing edges, every gap tile lower than the tube's clearance (anything lower passes under; the
 * row tried first is the middle of the shared band, then outward), crossings ≥ 20 px apart, the anchors' limits, not
 * already linked. Skyways, rail and roads pass under.
 */
export function checkSpan(world: World, A: Anchor, B: Anchor): SpanCheck {
  const out: SpanCheck = { axis: null, ax: 0, ay: 0, bx: 0, by: 0, gap: 0, roof: Math.min(A.roof, B.roof), cost: 0, reason: null, block: null };
  const rowsMeet = A.y0 <= B.y1 && B.y0 <= A.y1;
  const colsMeet = A.x0 <= B.x1 && B.x0 <= A.x1;
  let lo: number;
  let hi: number;
  if (rowsMeet && !colsMeet) {
    out.axis = 'x';
    lo = Math.max(A.y0, B.y0);
    hi = Math.min(A.y1, B.y1);
    out.gap = B.x0 > A.x1 ? B.x0 - A.x1 - 1 : A.x0 - B.x1 - 1;
  } else if (colsMeet && !rowsMeet) {
    out.axis = 'y';
    lo = Math.max(A.x0, B.x0);
    hi = Math.min(A.x1, B.x1);
    out.gap = B.y0 > A.y1 ? B.y0 - A.y1 - 1 : A.y0 - B.y1 - 1;
  } else {
    out.reason = 'Not lined up with this tower';
    return out;
  }
  out.cost = bridgeCost(out.gap);
  if (out.gap < SKY_V2.minGap) {
    out.reason = 'Towers touch: no gap';
    return out;
  }
  if (out.gap > SKY_V2.maxGap) {
    out.reason = `Too far: ${SKY_V2.maxGap} tiles at most`;
    return out;
  }
  for (const l of world.links) {
    const ka = anchorKey(world, l.ax, l.ay);
    const kb = anchorKey(world, l.bx, l.by);
    if ((ka === A.key && kb === B.key) || (ka === B.key && kb === A.key)) {
      out.reason = 'Already linked';
      return out;
    }
  }
  if (linksOnAnchor(world, A.key) >= A.limit) {
    out.reason = limitReason(A);
    return out;
  }
  if (linksOnAnchor(world, B.key) >= B.limit) {
    out.reason = limitReason(B);
    return out;
  }
  const tube = tubeOf(out.roof);
  // Rows (or columns) of the shared band, middle first.
  const lanes: number[] = [];
  const mid = (lo + hi) >> 1;
  for (let d = 0; d <= hi - lo; d++) {
    if (mid - d >= lo) lanes.push(mid - d);
    if (d > 0 && mid + d <= hi) lanes.push(mid + d);
  }
  let first: { reason: string; block: { x: number; y: number } } | null = null;
  for (const lane of lanes) {
    const fwd = out.axis === 'x' ? B.x0 > A.x1 : B.y0 > A.y1;
    const ax = out.axis === 'x' ? (fwd ? A.x1 : A.x0) : lane;
    const ay = out.axis === 'x' ? lane : fwd ? A.y1 : A.y0;
    const bx = out.axis === 'x' ? (fwd ? B.x0 : B.x1) : lane;
    const by = out.axis === 'x' ? lane : fwd ? B.y0 : B.y1;
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    let why: string | null = null;
    let at: { x: number; y: number } | null = null;
    for (let k = 1; k <= out.gap && !why; k++) {
      const x = ax + dx * k;
      const y = ay + dy * k;
      if (!world.isOwned(x, y)) why = NOT_ANNEXED;
      else if (heightOf(world, x, y) > tube.clear) why = 'A taller building is in the way';
      else {
        const other = gapLinkAt(world, x, y);
        if (other && Math.abs(linkRoof(world, other) - out.roof) < SKYBRIDGE.crossGap) why = 'Another skybridge crosses here';
      }
      if (why) at = { x, y };
    }
    if (!why) {
      out.ax = ax;
      out.ay = ay;
      out.bx = bx;
      out.by = by;
      return out;
    }
    first ??= { reason: why, block: at! };
  }
  out.reason = first?.reason ?? 'A taller building is in the way';
  out.block = first?.block ?? null;
  // Report the middle lane's ends so the pill can show where it would run.
  const fwd = out.axis === 'x' ? B.x0 > A.x1 : B.y0 > A.y1;
  out.ax = out.axis === 'x' ? (fwd ? A.x1 : A.x0) : mid;
  out.ay = out.axis === 'x' ? mid : fwd ? A.y1 : A.y0;
  out.bx = out.axis === 'x' ? (fwd ? B.x0 : B.x1) : mid;
  out.by = out.axis === 'x' ? mid : fwd ? B.y0 : B.y1;
  return out;
}

/** A partner badge (§5.4): the partner's anchor tile, whether it builds, why not, its price, and a two-bridge route. */
export interface Partner {
  x: number;
  y: number;
  ok: boolean;
  reason?: string;
  cost: number;
  route?: { via: { x: number; y: number } };
}

/** Scan the lanes of an anchor (each footprint row and column, out to maxGap + 1 tiles) for other anchors. */
function lanePartners(world: World, A: Anchor, out: Map<number, Anchor>): void {
  const reach = SKY_V2.maxGap + 1;
  const add = (x: number, y: number) => {
    if (!world.inBounds(x, y)) return;
    const t = world.tiles[y * world.N + x];
    if (t.buildingId < 0 && t.zone === ZoneType.None) return;
    const B = anchorAt(world, x, y);
    if (B && B.key !== A.key && !out.has(B.key)) out.set(B.key, B);
  };
  for (let y = A.y0; y <= A.y1; y++)
    for (let d = 1; d <= reach; d++) {
      add(A.x1 + d, y);
      add(A.x0 - d, y);
    }
  for (let x = A.x0; x <= A.x1; x++)
    for (let d = 1; d <= reach; d++) {
      add(x, A.y1 + d);
      add(x, A.y0 - d);
    }
}

/** Distance between two anchors' footprints (Chebyshev gap). */
function anchorDist(a: Anchor, b: Anchor): number {
  const gx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
  const gy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
  return Math.max(gx, gy);
}

/**
 * Every partner of the anchor at (ax, ay) (§5.4): anchors in its lanes (green when a bridge builds, a red dot with the
 * reason otherwise), nearest first; then two-bridge routes (blue "2") to tall towers within 10 tiles that don't line up,
 * through a valid partner. A few hundred tile checks; recomputed on tap and on 'tiles' events while a source is selected.
 */
export function skybridgePartners(world: World, ax: number, ay: number): Partner[] {
  const A = anchorAt(world, ax, ay);
  if (!A) return [];
  const N = world.N;
  const lane = new Map<number, Anchor>();
  lanePartners(world, A, lane);
  const out: Partner[] = [];
  const direct = [...lane.values()].sort((p, q) => anchorDist(A, p) - anchorDist(A, q) || p.i - q.i);
  const valid: Anchor[] = [];
  for (const B of direct) {
    const c = checkSpan(world, A, B);
    out.push({ x: B.i % N, y: (B.i / N) | 0, ok: c.reason === null, ...(c.reason ? { reason: c.reason } : {}), cost: c.cost });
    if (!c.reason) valid.push(B);
  }
  // Routes: tall towers within reach that don't line up with A, through one valid partner.
  const seen = new Set<number>([A.key, ...lane.keys()]);
  for (const V of valid) {
    const second = new Map<number, Anchor>();
    lanePartners(world, V, second);
    for (const C of second.values()) {
      if (seen.has(C.key) || anchorDist(A, C) > SKY_V2.maxGap) continue;
      const c2 = checkSpan(world, V, C);
      if (c2.reason) continue;
      seen.add(C.key);
      const c1 = checkSpan(world, A, V);
      out.push({ x: C.i % N, y: (C.i / N) | 0, ok: true, cost: c1.cost + c2.cost, route: { via: { x: V.i % N, y: (V.i / N) | 0 } } });
    }
  }
  return out;
}

/** The lane rects of an anchor (§5.4: what the overlay draws and dims), with the direction (0 N, 1 E, 2 S, 3 W). */
export function laneBands(world: World, ax: number, ay: number): { x0: number; y0: number; x1: number; y1: number; dir: number; roof: number }[] {
  const A = anchorAt(world, ax, ay);
  if (!A) return [];
  const N = world.N;
  const r = SKY_V2.maxGap;
  const clip = (v: number) => Math.max(0, Math.min(N - 1, v));
  const out = [
    { x0: A.x0, y0: clip(A.y0 - r), x1: A.x1, y1: A.y0 - 1, dir: 0, roof: A.roof },
    { x0: A.x1 + 1, y0: A.y0, x1: clip(A.x1 + r), y1: A.y1, dir: 1, roof: A.roof },
    { x0: A.x0, y0: A.y1 + 1, x1: A.x1, y1: clip(A.y1 + r), dir: 2, roof: A.roof },
    { x0: clip(A.x0 - r), y0: A.y0, x1: A.x0 - 1, y1: A.y1, dir: 3, roof: A.roof },
  ];
  return out.filter((b) => b.x0 <= b.x1 && b.y0 <= b.y1);
}

/** Sky Lobby name (§5.5): "{A} {B}" by a hash of the lobby's lowest anchor tile. */
const LOBBY_A = ['Glass', 'Prism', 'Neon', 'High', 'Copper', 'Pearl', 'Hex', 'Cloud', 'Signal', 'Tide', 'Amber', 'Halo'];
const LOBBY_B = ['Steps', 'Gallery', 'Walk', 'Arcade', 'Rise', 'Loop', 'Concourse', 'Crossing', 'Terrace', 'Promenade'];
export function lobbyName(world: World, lowest: number): string {
  let h = Math.imul(lowest ^ world.seed, 0x9e3779b1) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  return `${LOBBY_A[h % LOBBY_A.length]} ${LOBBY_B[(h >>> 8) % LOBBY_B.length]}`;
}

/** Sky Lobby terms (§5.5) for k towers: visitors a month (per-lobby cap), the land value add. */
export function lobbyVisitors(k: number): number {
  const L = SKYBRIDGE.lobby;
  return k >= L.min ? Math.min(L.visitorsCap, L.visitorsPer * (k - 2)) : 0;
}
export function lobbyLv(k: number): number {
  const L = SKYBRIDGE.lobby;
  return k >= L.min ? Math.min(L.lvCap, L.lvPer * Math.min(k, 4)) : 0;
}

/**
 * Groups of anchors joined by active bridges (union by anchorKey), with each group's anchors. `extra` adds a planned
 * bridge (the plan's lobby preview).
 */
function anchorGroups(world: World, extra?: [Anchor, Anchor]): Map<number, Anchor[]> {
  const parent = new Map<number, number>();
  const anchors = new Map<number, Anchor>();
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
  const join = (a: Anchor, b: Anchor) => {
    for (const x of [a, b]) {
      if (!parent.has(x.key)) parent.set(x.key, x.key);
      anchors.set(x.key, x);
    }
    const ra = find(a.key);
    const rb = find(b.key);
    if (ra !== rb) parent.set(ra, rb);
  };
  const active = world.vertical.activeLinks;
  for (const l of world.links) {
    if (!active.has(l.id)) continue;
    const a = anchorAt(world, l.ax, l.ay);
    const b = anchorAt(world, l.bx, l.by);
    if (a && b) join(a, b);
  }
  if (extra) join(extra[0], extra[1]);
  const groups = new Map<number, Anchor[]>();
  for (const [k, a] of anchors) {
    const r = find(k);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(a);
  }
  return groups;
}

/**
 * What a bridge between the anchors at a and b pays (§5.5): walkers a day (0.2 × the heads of both anchors), the car
 * trips a day the two towers no longer make (20%, 25% in a Sky Lobby), the tiles that gain +5% land value, and the
 * Sky Lobby it forms or joins.
 */
export function skybridgePayoff(world: World, a: { x: number; y: number }, b: { x: number; y: number }): BridgePayoff {
  const A = anchorAt(world, a.x, a.y);
  const B = anchorAt(world, b.x, b.y);
  if (!A || !B) return { walkers: 0, tripsCut: 0, lvTiles: 0, lobby: null };
  const walkers = Math.round(SKYBRIDGE.walkerShare * (anchorHeads(world, A) + anchorHeads(world, B)));
  let lobby: BridgePayoff['lobby'] = null;
  for (const g of anchorGroups(world, [A, B]).values()) {
    if (!g.some((x) => x.key === A.key)) continue;
    if (g.length >= SKYBRIDGE.lobby.min) {
      const lowest = Math.min(...g.map((x) => x.i));
      lobby = { k: g.length, name: lobbyName(world, lowest), visitors: lobbyVisitors(g.length) };
    }
  }
  const share = 1 - (lobby ? SKYBRIDGE.lobby.tripMul : SKYBRIDGE.tripMul);
  const tripsCut = Math.round(share * (anchorTrips(world, A) + anchorTrips(world, B)));
  // Land value: tiles within lvRadius of either end tile that face each other.
  const c = checkSpan(world, A, B);
  const ends = c.axis ? [[c.ax, c.ay], [c.bx, c.by]] : [[a.x, a.y], [b.x, b.y]];
  const N = world.N;
  const seen = new Set<number>();
  const r = SKYBRIDGE.lvRadius;
  for (const [ex, ey] of ends)
    for (let y = ey - r; y <= ey + r; y++)
      for (let x = ex - r; x <= ex + r; x++) {
        const dx = x - ex;
        const dy = y - ey;
        if (dx * dx + dy * dy > r * r || !world.isOwned(x, y)) continue;
        if (world.tiles[y * N + x].terrain !== Terrain.Land) continue;
        seen.add(y * N + x);
      }
  return { walkers, tripsCut, lvTiles: seen.size, lobby };
}

/**
 * People a day walking every active skybridge (Σ BridgePayoff.walkers, ×10 units, MEGACITY §4.4): the number the
 * whisper note "{n} people crossed the sky today" should show instead of NOTE_CROSSINGS_PER_BRIDGE × bridges, so the
 * note matches inspect. (director.fillNote is not WP-2's file: handed over.)
 */
export function walkersToday(world: World): number {
  let n = 0;
  const active = world.vertical.activeLinks;
  for (const l of world.links) if (active.has(l.id)) n += skybridgePayoff(world, { x: l.ax, y: l.ay }, { x: l.bx, y: l.by }).walkers;
  return n;
}

/**
 * Skybridge v2 plan (MEGACITY §5.3, §5.4): from the anchor at `from` to the anchor at `to` (a tap, a tap; or a drag
 * whose end snaps to the nearest valid partner within 2 tiles). Fills `plan.tiles`, `span`, `bridge` (the payoff) and,
 * when the towers don't line up but a valid partner of A lines up with B, `route` (two bridges; the plan confirms).
 * Returns the number of bridges it builds (0, 1 or 2). The caller applies cost multipliers and the funds check.
 */
export function planSkybridge(world: World, from: Pt, to: Pt, plan: ActionPlan): number {
  const fail = (reason: string, pts: Pt[]) => {
    for (const p of pts) if (world.inBounds(p.x, p.y)) plan.tiles.push({ x: p.x, y: p.y, ok: false });
    plan.reason = reason;
    return 0;
  };
  if (!world.inBounds(from.x, from.y) || !world.inBounds(to.x, to.y)) return fail('Off the map', [from, to]);
  if (!world.isOwned(from.x, from.y)) {
    plan.slot = world.slotAt(from.x, from.y);
    return fail(NOT_ANNEXED, [from]);
  }
  const A = anchorAt(world, from.x, from.y);
  if (!A) return fail('Start on a tall tower', [from]);
  if (!world.isOwned(to.x, to.y)) {
    plan.slot = world.slotAt(to.x, to.y);
    return fail(NOT_ANNEXED, [from, to]);
  }
  let B = anchorAt(world, to.x, to.y);
  if (B && B.key === A.key) return fail('Tap another tall tower', [from]);
  // A drag that ends off a tower snaps to the nearest valid partner within 2 tiles of the finger (§5.4 step 6).
  if (!B) {
    let best: Anchor | null = null;
    let bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const C = anchorAt(world, to.x + dx, to.y + dy);
        if (!C || C.key === A.key || checkSpan(world, A, C).reason) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = C;
        }
      }
    if (best) B = best;
  }
  if (!B) return fail('End on a tall tower', [from, to]);
  const c = checkSpan(world, A, B);
  if (c.axis === null) {
    // Not lined up: a two-bridge route through a valid partner of A that lines up with B (§5.4).
    const route = skybridgePartners(world, from.x, from.y).find((p) => p.route && anchorAt(world, p.x, p.y)?.key === B!.key);
    if (route?.route) {
      const V = anchorAt(world, route.route.via.x, route.route.via.y)!;
      const c1 = checkSpan(world, A, V);
      const c2 = checkSpan(world, V, B);
      pushSpanTiles(plan, c1, true);
      pushSpanTiles(plan, c2, true);
      plan.span = { ax: c1.ax, ay: c1.ay, bx: c1.bx, by: c1.by, gap: c1.gap };
      plan.route = { via: { x: route.route.via.x, y: route.route.via.y }, second: { ax: c2.ax, ay: c2.ay, bx: c2.bx, by: c2.by, gap: c2.gap } };
      plan.cost = c1.cost + c2.cost;
      plan.confirm = true;
      plan.bridge = skybridgePayoff(world, { x: c1.ax, y: c1.ay }, { x: c1.bx, y: c1.by });
      return 2;
    }
    return fail(c.reason ?? 'Not lined up with this tower', [from, to]);
  }
  plan.span = { ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, gap: Math.max(0, c.gap) };
  pushSpanTiles(plan, c, c.reason === null);
  plan.cost = c.cost;
  if (c.reason) {
    plan.reason = c.reason;
    plan.cost = 0;
    if (c.block) for (const t of plan.tiles) if (t.x === c.block.x && t.y === c.block.y) t.ok = false;
    if (c.reason !== 'A taller building is in the way' && c.reason !== 'Another skybridge crosses here') for (const t of plan.tiles) t.ok = false;
    return 0;
  }
  plan.bridge = skybridgePayoff(world, { x: c.ax, y: c.ay }, { x: c.bx, y: c.by });
  return 1;
}

/** The anchor, gap and far-anchor tiles of a checked span. */
function pushSpanTiles(plan: ActionPlan, c: SpanCheck, ok: boolean): void {
  const dx = Math.sign(c.bx - c.ax);
  const dy = Math.sign(c.by - c.ay);
  plan.tiles.push({ x: c.ax, y: c.ay, ok });
  for (let k = 1; k <= c.gap; k++) plan.tiles.push({ x: c.ax + dx * k, y: c.ay + dy * k, ok });
  plan.tiles.push({ x: c.bx, y: c.by, ok });
}

/** The refusal when a rail or skyway span changes terrace step (MEGACITY §3.7 Terraces). */
export const STEP_REASON = "Can't cross a terrace step";

/**
 * The index in `pts` of the first tile whose terrace step differs from the tile before it along the path, both land
 * (MEGACITY §3.7: "a skyway or rail span may not change step"; only Highstep Terraces have steps), else −1.
 */
export function stepChangeAt(world: World, pts: readonly Pt[]): number {
  for (let k = 1; k < pts.length; k++) {
    const a = world.tileAt(pts[k - 1].x, pts[k - 1].y);
    const b = world.tileAt(pts[k].x, pts[k].y);
    if (a && b && a.terrain === Terrain.Land && b.terrain === Terrain.Land && a.elev !== b.elev) return k;
  }
  return -1;
}

/**
 * Ribbon Rail plan (§4.4) along an L-path (from actions.roadPath), up to
 * RIBBON.maxDrag tiles. Land, water, roads and zone tiles are allowed; building
 * tiles only on station footprints. Joins onto existing track. Fills `plan`
 * (tiles, railMasks, base cost, reason) and returns the number of changed tiles.
 */
export function planRail(world: World, path: readonly Pt[], plan: ActionPlan): number {
  const N = world.N;
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
  let lockedAt: number | null = null;
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
    if (!world.isOwned(p.x, p.y)) {
      // Locked land (MEGACITY §3.4): no rail there.
      ok = false;
      lockedAt ??= world.slotAt(p.x, p.y);
    } else if (t.buildingId >= 0) {
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
  if (lockedAt !== null) {
    plan.slot = lockedAt;
    plan.reason = NOT_ANNEXED;
    return 0;
  }
  if (blocked) {
    plan.reason = 'Blocked by buildings';
    return 0;
  }
  const step = stepChangeAt(world, pts);
  if (step >= 0) {
    plan.tiles[step].ok = false;
    plan.reason = STEP_REASON;
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
