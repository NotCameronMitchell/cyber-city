// ─────────────────────────────────────────────────────────────────────────────
// Annex content per kind and variant (docs/MEGACITY.md §3.7, §3.8): ruins, frames,
// the pump hall, brownfield and reed ground, alley tangles, the apron families.
// WP-2. `World.annex` calls `placeAnnexContent` with per-tile events suspended
// (one 'tiles' touch for the slot rect follows) and an Rng of its own
// (`seed ^ ANNEX_SALT[ringKey]`), never world.rng. Structural only: no costs,
// no rules. The sites (pump hall, apron, runways) are pure functions of the
// slot's generated terrain, so the renderer can draw the pump hall in the fog
// and the story effects can find the apron again later.
// ─────────────────────────────────────────────────────────────────────────────

import { ANNEX_SALT, DISTRICTS } from '../config';
import { Rng, fbm, hash2 } from '../rng';
import { Ground, RoadKind, SLOT, Terrain, ZoneType, type SlotId, type Tile } from '../types';
import type { World } from '../world';
import { presetOf } from './layout';
import { ringKey, slotNeighbours, slotOffset, slotRect, slotX, slotY, type TileRect } from './slots';

/** Frames placed per Skeleton Row preset (§3.7). */
export const FRAME_COUNT: Record<string, number> = { v0: 5, frames4: 4, rows: 4 };
/** Share of land tiles that become ruins in the Sunk, and of the rest that become rubble ground (§3.7). */
export const SUNK_RUIN_SHARE = 0.35;
export const SUNK_RUBBLE_SHARE = 0.2;
/** The apron families: 24 Hab tiles at level 1, tier $ (§3.7). */
export const APRON_FAMILIES = 24;

const S2 = SLOT * SLOT;

/** The slot's terrain preset (variant 0 → 'v0'). */
export function slotPreset(world: World, slot: SlotId): string {
  const kind = world.districts.kinds[slot];
  return presetOf(DISTRICTS[kind]?.variants, world.variantOf(slot)) ?? 'v0';
}

/** Local → tile helpers. */
function tileOf(world: World, r: TileRect, lx: number, ly: number): Tile {
  return world.tiles[(r.y0 + ly) * world.N + r.x0 + lx];
}
function isLand(world: World, r: TileRect, lx: number, ly: number): boolean {
  if (lx < 0 || ly < 0 || lx >= SLOT || ly >= SLOT) return false;
  return tileOf(world, r, lx, ly).terrain === Terrain.Land;
}

/** Tile variant from art coordinates (a hash, so content never shifts with later rolls). */
function hashVariant(world: World, x: number, y: number, salt: number): number {
  return Math.floor(hash2(x, y, (world.seed ^ salt) >>> 0) * 256) & 255;
}

/**
 * Place a freshly annexed slot's content (§3.7). Called by `World.annex` with per-tile events suspended and an Rng
 * of its own, so a slot's content is the same on both regions and for the same annex order.
 */
export function placeAnnexContent(world: World, slot: SlotId, rng: Rng): void {
  const kind = world.districts.kinds[slot];
  const preset = slotPreset(world, slot);
  switch (kind) {
    case 'sunk':
      placeSunk(world, slot, rng);
      break;
    case 'flats':
      placeBrownfield(world, slot);
      break;
    case 'reedmere':
      placeReeds(world, slot);
      break;
    case 'skeleton':
      placeSkeleton(world, slot, rng, preset);
      break;
    case 'tarmac':
      placeTarmac(world, slot, rng, preset);
      break;
    case 'bazaar':
      placeBazaar(world, slot, rng, preset);
      break;
    default:
      // Charter Shore, the Shoals and the Terraces: the terrain is the content.
      break;
  }
}

// ── The Sunk ─────────────────────────────────────────────────────────────────

/**
 * The old pump hall's site (§3.7): a 3×3 all-land footprint in the Sunk touching a canal, nearest the start slot.
 * A pure function of the slot's (generated) terrain, so the renderer can draw the dark hall in the fog before annex.
 * Null when the slot holds no such site (never for a generated Sunk).
 */
export function pumpHallSite(world: World, slot: SlotId): { x: number; y: number } | null {
  const r = slotRect(world, slot);
  const st = slotRect(world, startSlotOf(world));
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let ly = 1; ly + 3 < SLOT; ly++)
    for (let lx = 1; lx + 3 < SLOT; lx++) {
      let ok = true;
      for (let k = 0; ok && k < 9; k++) ok = isLand(world, r, lx + (k % 3), ly + ((k / 3) | 0));
      if (!ok) continue;
      // On the water: a canal tile 4-adjacent to the footprint.
      let wet = false;
      for (let k = 0; !wet && k < 3; k++)
        wet =
          !isLand(world, r, lx + k, ly - 1) ||
          !isLand(world, r, lx + k, ly + 3) ||
          !isLand(world, r, lx - 1, ly + k) ||
          !isLand(world, r, lx + 3, ly + k);
      if (!wet) continue;
      const x = r.x0 + lx + 1;
      const y = r.y0 + ly + 1;
      const dx = x < st.x0 ? st.x0 - x : x > st.x1 ? x - st.x1 : 0;
      const dy = y < st.y0 ? st.y0 - y : y > st.y1 ? y - st.y1 : 0;
      const d = Math.max(dx, dy) + hash2(x, y, world.seed) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = { x: r.x0 + lx, y: r.y0 + ly };
      }
    }
  return best;
}

function startSlotOf(world: World): SlotId {
  return (world.region * world.region - 1) >> 1;
}

function placeSunk(world: World, slot: SlotId, rng: Rng): void {
  const site = pumpHallSite(world, slot);
  if (site) world.addBuilding('pumphall', site.x, site.y);
  const r = slotRect(world, slot);
  const salt = ringKey(world.region, slot) * 7919;
  for (let ly = 0; ly < SLOT; ly++)
    for (let lx = 0; lx < SLOT; lx++) {
      const x = r.x0 + lx;
      const y = r.y0 + ly;
      const t = world.tiles[y * world.N + x];
      if (t.terrain !== Terrain.Land || t.buildingId >= 0) continue;
      const roll = rng.next();
      if (roll < SUNK_RUIN_SHARE) {
        // A ruin: a zoned, abandoned lot on rubble (§3.3: counted as ruins, never as abandoned).
        const zone = rng.next() < 0.6 ? ZoneType.Residential : ZoneType.Commercial;
        const level = rng.next() < 0.7 ? 1 : 2;
        world.setZone(x, y, zone);
        world.setLevel(x, y, level, true, 0);
        world.setGround(x, y, Ground.Rubble);
        t.variant = hashVariant(world, x, y, salt);
      } else if (rng.next() < SUNK_RUBBLE_SHARE) world.setGround(x, y, Ground.Rubble);
    }
}

/** Is this tile a ruin (§3.2: a zoned, abandoned tile with ground Rubble)? */
export function isRuin(t: Tile): boolean {
  return t.zone !== ZoneType.None && t.abandoned && t.ground === Ground.Rubble;
}

// ── Kessel Flats ─────────────────────────────────────────────────────────────

/**
 * Where annexing lays brownfield (§3.7), as world tile indices: 60% of the land in blobs (the highest values of a
 * slow fbm) for Kessel Flats and Ironside Docks; a 7-tile band along an old rail line for Cokeworth Flats. A pure
 * function of the slot's terrain and the seed, so the "Clear 300 brownfield lots" goal can count what was laid.
 */
export function brownfieldSites(world: World, slot: SlotId): number[] {
  const r = slotRect(world, slot);
  const preset = slotPreset(world, slot);
  const o = SLOT * ((world.region - 1) >> 1);
  const N = world.N;
  const out: number[] = [];
  if (preset === 'spur') {
    const key = ringKey(world.region, slot);
    const axis = hash2(key, 1, world.seed ^ 0x5b0e) < 0.5 ? 0 : 1;
    const at = 16 + Math.floor(hash2(key, 2, world.seed ^ 0x5b0e) * 31);
    for (let a = 0; a < SLOT; a++)
      for (let d = -3; d <= 3; d++) {
        const lx = axis === 0 ? a : at + d;
        const ly = axis === 0 ? at + d : a;
        if (isLand(world, r, lx, ly)) out.push((r.y0 + ly) * N + r.x0 + lx);
      }
    return out;
  }
  const vals: number[] = [];
  const cells: number[] = [];
  const ns = ((world.seed >>> 0) % 10000) + 31 * ringKey(world.region, slot);
  for (let ly = 0; ly < SLOT; ly++)
    for (let lx = 0; lx < SLOT; lx++) {
      if (!isLand(world, r, lx, ly)) continue;
      cells.push((r.y0 + ly) * N + r.x0 + lx);
      vals.push(fbm((r.x0 + lx - o) * 0.08, (r.y0 + ly - o) * 0.08, ns + 4000, 3));
    }
  const sorted = [...vals].sort((a, b) => b - a);
  const cut = sorted[Math.max(0, Math.floor(sorted.length * 0.6) - 1)] ?? 1;
  cells.forEach((c, k) => {
    if (vals[k] >= cut) out.push(c);
  });
  return out;
}

function placeBrownfield(world: World, slot: SlotId): void {
  const N = world.N;
  for (const i of brownfieldSites(world, slot)) world.setGround(i % N, (i / N) | 0, Ground.Brownfield);
}

// ── Reedmere Marsh ───────────────────────────────────────────────────────────

/** Land within this many tiles of water may carry reeds (§3.7). */
export const REED_REACH = 4;

/** Reed ground on half the land within 4 of water (the highest values of an fbm, §3.7). */
function placeReeds(world: World, slot: SlotId): void {
  const r = slotRect(world, slot);
  const dist = waterDistance(world, r, REED_REACH);
  const o = SLOT * ((world.region - 1) >> 1);
  const ns = ((world.seed >>> 0) % 10000) + 31 * ringKey(world.region, slot);
  const cells: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < S2; i++) {
    if (dist[i] === 0 || dist[i] > REED_REACH) continue;
    cells.push(i);
    vals.push(fbm((r.x0 + (i % SLOT) - o) * 0.1, (r.y0 + ((i / SLOT) | 0) - o) * 0.1, ns + 5000, 3));
  }
  const sorted = [...vals].sort((a, b) => b - a);
  const cut = sorted[Math.max(0, Math.floor(sorted.length * 0.5) - 1)] ?? 1;
  cells.forEach((c, k) => {
    if (vals[k] >= cut) world.setGround(r.x0 + (c % SLOT), r.y0 + ((c / SLOT) | 0), Ground.Reed);
  });
}

/**
 * Chebyshev distance to the nearest water tile, per slot tile (0 on water; capped at `cap` + 1), reading the
 * world's tiles (water just outside the slot counts too).
 */
export function waterDistance(world: World, r: TileRect, cap: number): Uint8Array {
  const out = new Uint8Array(S2).fill(cap + 1);
  for (let ly = 0; ly < SLOT; ly++)
    for (let lx = 0; lx < SLOT; lx++) {
      let best = cap + 1;
      for (let dy = -cap; dy <= cap && best > 0; dy++)
        for (let dx = -cap; dx <= cap; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d >= best) continue;
          const t = world.tileAt(r.x0 + lx + dx, r.y0 + ly + dy);
          if (t && t.terrain === Terrain.Water) best = d;
        }
      out[ly * SLOT + lx] = best;
    }
  return out;
}

// ── Skeleton Row ─────────────────────────────────────────────────────────────

/** Can a 4×4 frame stand at local (lx, ly): all land, one terrace step, 2 tiles from the slot edge (terrain only)? */
function frameFits(world: World, r: TileRect, lx: number, ly: number): boolean {
  if (lx < 2 || ly < 2 || lx + 4 > SLOT - 2 || ly + 4 > SLOT - 2) return false;
  const e = tileOf(world, r, lx, ly).elev;
  for (let k = 0; k < 16; k++) {
    const t = tileOf(world, r, lx + (k % 4), ly + ((k / 4) | 0));
    if (t.terrain !== Terrain.Land || t.elev !== e) return false;
  }
  return true;
}

/** Gap in tiles between two 4×4 footprints (Chebyshev, 0 when they touch or overlap). */
function frameGap(a: { lx: number; ly: number }, b: { lx: number; ly: number }): number {
  const gx = Math.max(0, Math.abs(a.lx - b.lx) - 4);
  const gy = Math.max(0, Math.abs(a.ly - b.ly) - 4);
  return Math.max(gx, gy);
}

/** A Skeleton Row district's frame sites (world top-left corners) and, for Concrete Grove, its avenue. */
export interface FramePlan {
  frames: { x: number; y: number }[];
  /** Concrete Grove's broken avenue beside the row: axis 0 runs along x at local row `at`, 1 along y. */
  avenue: { axis: number; at: number } | null;
}

/**
 * Where annexing stands the frames (§3.7): 5 on flat land ≥ 10 tiles apart (Skeleton Row), 4 with rubble on 20%
 * (Halfway Towers), 4 in a row along a broken avenue (Concrete Grove). A pure function of the slot's terrain and the
 * seed (its own Rng), so the "Finish 2 frames" goals can find the sites again.
 */
export function framePlan(world: World, slot: SlotId): FramePlan {
  const r = slotRect(world, slot);
  const preset = slotPreset(world, slot);
  const want = FRAME_COUNT[preset] ?? 5;
  const rng = new Rng((world.seed ^ ANNEX_SALT[ringKey(world.region, slot)] ^ 0x46524d45) >>> 0);
  const placed: { lx: number; ly: number }[] = [];
  let avenue: FramePlan['avenue'] = null;
  if (preset === 'rows') {
    const axis = rng.int(0, 1);
    for (let tries = 0; tries < 40 && placed.length < want; tries++) {
      placed.length = 0;
      const at = rng.int(10, 44);
      const start = rng.int(2, 6);
      for (let k = 0; k < want; k++) {
        const along = start + k * 14;
        const lx = axis === 0 ? along : at;
        const ly = axis === 0 ? at : along;
        if (frameFits(world, r, lx, ly)) placed.push({ lx, ly });
      }
      if (placed.length === want) avenue = { axis, at: at + 5 };
    }
    if (placed.length < want) placed.length = 0;
  }
  for (let tries = 0; tries < 600 && placed.length < want; tries++) {
    const lx = rng.int(2, SLOT - 6);
    const ly = rng.int(2, SLOT - 6);
    if (!frameFits(world, r, lx, ly)) continue;
    if (placed.some((p) => frameGap(p, { lx, ly }) < 10)) continue;
    placed.push({ lx, ly });
  }
  return { frames: placed.map((p) => ({ x: r.x0 + p.lx, y: r.y0 + p.ly })), avenue };
}

/** The frame sites of a Skeleton Row district (cached per terrain version). */
export function framesOf(world: World, slot: SlotId): { x: number; y: number }[] {
  if (world.districts.kinds[slot] !== 'skeleton') return [];
  let m = FRAMES.get(world);
  if (!m) FRAMES.set(world, (m = new Map()));
  const key = `${slot}|${world.terrainVersion}`;
  let f = m.get(key);
  if (!f) m.set(key, (f = framePlan(world, slot).frames));
  return f;
}
const FRAMES = new WeakMap<World, Map<string, { x: number; y: number }[]>>();

function placeSkeleton(world: World, slot: SlotId, rng: Rng, preset: string): void {
  const r = slotRect(world, slot);
  const plan = framePlan(world, slot);
  for (const f of plan.frames) world.addBuilding('frame', f.x, f.y);
  if (plan.avenue) {
    // Concrete Grove: the broken avenue beside the row (60% of its 6-tile segments survive).
    const { axis, at } = plan.avenue;
    for (let a = 0; a < SLOT; a += 6) {
      if (rng.next() >= 0.6) continue;
      for (let k = a; k < Math.min(SLOT, a + 6); k++) {
        const lx = axis === 0 ? k : at;
        const ly = axis === 0 ? at : k;
        if (isLand(world, r, lx, ly) && tileOf(world, r, lx, ly).buildingId < 0) world.setRoad(r.x0 + lx, r.y0 + ly, RoadKind.Avenue);
      }
    }
  } else brokenGrid(world, r, rng, 6, preset === 'frames4' ? 0.3 : 0.4, RoadKind.Street);
  rubble(world, r, rng, preset === 'frames4' ? 0.2 : 0.15);
}

/** Roads on `share` of a `step`-tile grid's segments (land only, never on a building). */
function brokenGrid(world: World, r: TileRect, rng: Rng, step: number, share: number, kind: RoadKind, core?: TileRect): void {
  const off = rng.int(0, step - 1);
  const inCore = (lx: number, ly: number) => !core || (lx >= core.x0 && lx <= core.x1 && ly >= core.y0 && ly <= core.y1);
  for (let line = off; line < SLOT; line += step)
    for (let a = off; a < SLOT; a += step) {
      // A horizontal segment along row `line` from column a, and a vertical one along column `line` from row a.
      for (const horiz of [true, false]) {
        if (rng.next() >= share) continue;
        for (let k = 0; k <= step; k++) {
          const lx = horiz ? a + k : line;
          const ly = horiz ? line : a + k;
          if (lx >= SLOT || ly >= SLOT || !isLand(world, r, lx, ly) || !inCore(lx, ly)) continue;
          const t = tileOf(world, r, lx, ly);
          if (t.buildingId >= 0 || t.zone !== ZoneType.None) continue;
          world.setRoad(r.x0 + lx, r.y0 + ly, kind);
        }
      }
    }
}

/** Rubble ground on `share` of the empty land (§3.7). */
function rubble(world: World, r: TileRect, rng: Rng, share: number): void {
  for (let ly = 0; ly < SLOT; ly++)
    for (let lx = 0; lx < SLOT; lx++) {
      const t = tileOf(world, r, lx, ly);
      if (t.terrain !== Terrain.Land || t.road || t.buildingId >= 0 || t.zone !== ZoneType.None) continue;
      if (rng.next() < share) world.setGround(r.x0 + lx, r.y0 + ly, Ground.Rubble);
    }
}

// ── Tarmac Reach ─────────────────────────────────────────────────────────────

/** A strip of ground art (world rect, inclusive). */
export interface Strip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The Tarmac sites of a slot (§3.7): runway strips, the apron and (variant 0 only) the apron families' block. */
export interface TarmacSites {
  runways: Strip[];
  apron: Strip | null;
  /** The families' 6×5 block: 24 Hab tiles and a Back Alley along its middle row. Variant 0 only. */
  families: Strip | null;
  /** The alley row inside `families` (world y when the block lies along x, else world x). */
  alleyAt: number;
  /** 0: the block's rows run along x; 1: along y. */
  axis: number;
}

/** Share of a strip's tiles that are land. */
function landShare(world: World, s: Strip): number {
  let land = 0;
  let n = 0;
  for (let y = s.y0; y <= s.y1; y++)
    for (let x = s.x0; x <= s.x1; x++) {
      n++;
      const t = world.tileAt(x, y);
      if (t && t.terrain === Terrain.Land) land++;
    }
  return n ? land / n : 0;
}

/**
 * Where the runways, the apron and the apron families lie (a pure function of the slot's terrain and the seed, so
 * `apron rehouse` / `apron clear` can find the families again, §8.3). The strip runs along the slot's longer dry
 * axis; the apron sits beside its middle; the families' block on the apron's far edge.
 */
export function tarmacSites(world: World, slot: SlotId): TarmacSites {
  const r = slotRect(world, slot);
  const preset = slotPreset(world, slot);
  const h = (k: number) => hash2(k, ringKey(world.region, slot), world.seed ^ 0x7a2c);
  const len = preset === 'headland' ? 24 : 40;
  const strips = preset === 'freight' ? 2 : 1;
  // Try both axes and a few offsets; keep the driest layout.
  let best: TarmacSites | null = null;
  let bestScore = -1;
  for (let axis = 0; axis < 2; axis++)
    for (let k = 0; k < 6; k++) {
      const lat = 8 + Math.floor(h(axis * 10 + k) * (SLOT - 34 - (strips - 1) * 12));
      const along0 = 4 + Math.floor(h(axis * 10 + k + 50) * (SLOT - len - 8));
      const runways: Strip[] = [];
      for (let s = 0; s < strips; s++) {
        const a = lat + s * 12;
        runways.push(
          axis === 0
            ? { x0: r.x0 + along0, y0: r.y0 + a, x1: r.x0 + along0 + len - 1, y1: r.y0 + a + 5 }
            : { x0: r.x0 + a, y0: r.y0 + along0, x1: r.x0 + a + 5, y1: r.y0 + along0 + len - 1 },
        );
      }
      const last = lat + (strips - 1) * 12;
      const amid = along0 + (len >> 1) - 6;
      const apron: Strip =
        axis === 0
          ? { x0: r.x0 + amid, y0: r.y0 + last + 7, x1: r.x0 + amid + 11, y1: r.y0 + last + 18 }
          : { x0: r.x0 + last + 7, y0: r.y0 + amid, x1: r.x0 + last + 18, y1: r.y0 + amid + 11 };
      // The families' block: 6 along × 5 across, just past the apron's far edge.
      const fam: Strip =
        axis === 0
          ? { x0: apron.x0 + 3, y0: apron.y1 + 1, x1: apron.x0 + 8, y1: apron.y1 + 5 }
          : { x0: apron.x1 + 1, y0: apron.y0 + 3, x1: apron.x1 + 5, y1: apron.y0 + 8 };
      const inside = (s: Strip) => s.x0 >= r.x0 && s.y0 >= r.y0 && s.x1 <= r.x1 && s.y1 <= r.y1;
      if (![...runways, apron, fam].every(inside)) continue;
      // The families' block must be all land (24 Hab tiles and the alley); then the driest strips and apron.
      const famLand = landShare(world, fam);
      const score = runways.reduce((acc, s) => acc + landShare(world, s), 0) / runways.length + landShare(world, apron) + (famLand === 1 ? 10 : famLand);
      if (score > bestScore) {
        bestScore = score;
        best = { runways, apron, families: fam, alleyAt: axis === 0 ? fam.y0 + 2 : fam.x0 + 2, axis };
      }
    }
  if (!best) return { runways: [], apron: null, families: null, alleyAt: -1, axis: 0 };
  if (preset !== 'v0') best.families = null;
  if (preset === 'freight' || preset === 'headland') best.apron = preset === 'freight' ? best.apron : null;
  return best;
}

function placeTarmac(world: World, slot: SlotId, _rng: Rng, preset: string): void {
  const sites = tarmacSites(world, slot);
  const paint = (s: Strip) => {
    for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) {
      const t = world.tileAt(x, y);
      if (t && t.terrain === Terrain.Land) world.setGround(x, y, Ground.Brownfield);
    }
  };
  sites.runways.forEach(paint);
  if (sites.apron) paint(sites.apron);
  if (preset !== 'v0' || !sites.families) return;
  const f = sites.families;
  const salt = ringKey(world.region, slot) * 104729;
  for (let y = f.y0; y <= f.y1; y++)
    for (let x = f.x0; x <= f.x1; x++) {
      const t = world.tileAt(x, y);
      if (!t || t.terrain !== Terrain.Land) continue;
      const alley = sites.axis === 0 ? y === sites.alleyAt : x === sites.alleyAt;
      if (alley) world.setRoad(x, y, RoadKind.Alley);
      else {
        world.setZone(x, y, ZoneType.Residential);
        world.setLevel(x, y, 1, false, 0);
        t.variant = hashVariant(world, x, y, salt);
      }
    }
}

// ── Verdigris Bazaar ─────────────────────────────────────────────────────────

/**
 * A Back Alley tangle (§3.7): Saffron Arcade a dense 2-tile grid in the core, Moonbrass Bazaar strung along its canal,
 * Verdigris a jittered 3-tile grid over ≈ 18% of the land; two Streets entering from each border shared with the city;
 * 1×1 empty squares at some alley crossings.
 */
function placeBazaar(world: World, slot: SlotId, rng: Rng, preset: string): void {
  const r = slotRect(world, slot);
  if (preset === 'arcade') brokenGrid(world, r, rng, 2, 0.55, RoadKind.Alley, { x0: 16, y0: 16, x1: 47, y1: 47 });
  else if (preset === 'canal') {
    const dist = waterDistance(world, r, 3);
    for (let i = 0; i < S2; i++) {
      const lx = i % SLOT;
      const ly = (i / SLOT) | 0;
      if (dist[i] === 2 && rng.next() < 0.8) world.setRoad(r.x0 + lx, r.y0 + ly, RoadKind.Alley);
    }
    brokenGrid(world, r, rng, 3, 0.18, RoadKind.Alley, { x0: 4, y0: 4, x1: 59, y1: 59 });
  } else brokenGrid(world, r, rng, 3, 0.3, RoadKind.Alley, { x0: 3, y0: 3, x1: 60, y1: 60 });
  // Squares: some crossings stay open (1×1).
  for (let ly = 1; ly < SLOT - 1; ly++)
    for (let lx = 1; lx < SLOT - 1; lx++) {
      const t = tileOf(world, r, lx, ly);
      if (!t.road) continue;
      let n = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (tileOf(world, r, lx + dx, ly + dy).road) n++;
      if (n >= 4 && hash2(r.x0 + lx, r.y0 + ly, world.seed ^ 0x51) < 0.35) world.clearTile(r.x0 + lx, r.y0 + ly);
    }
  // Two Streets in from each border shared with an owned slot.
  const [sx, sy] = [slotX(world.region, slot), slotY(world.region, slot)];
  for (const n of slotNeighbours(world.region, slot)) {
    if (!world.slotOwned[n] || n === slot) continue;
    const nx = slotX(world.region, n) - sx;
    const ny = slotY(world.region, n) - sy;
    for (const at of [21, 42]) {
      for (let d = 0; d < 18; d++) {
        const lx = nx === 1 ? SLOT - 1 - d : nx === -1 ? d : at;
        const ly = ny === 1 ? SLOT - 1 - d : ny === -1 ? d : at;
        if (!isLand(world, r, lx, ly)) break;
        const t = tileOf(world, r, lx, ly);
        if (t.buildingId >= 0) break;
        world.setRoad(r.x0 + lx, r.y0 + ly, RoadKind.Street);
      }
    }
  }
}

/** The slot's offset from the start slot (re-exported for content helpers and tests). */
export function annexOffset(world: World, slot: SlotId): [number, number] {
  return slotOffset(world.region, slot);
}
