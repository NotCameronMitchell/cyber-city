// ─────────────────────────────────────────────────────────────────────────────
// District terrain (docs/MEGACITY.md §3.6.1).
//
// Step 0b: the start generator (today's `generateTerrain`, moved here in slot-local
// coordinates, bit-identical to the 64×64 map for the same seed on either region)
// and plain-noise stubs with the final signatures for the eight other kinds and
// their 5×5 presets. WP-2 replaces the stubs with the real generators, presets
// and border blending. District generators use only exact arithmetic (rng.ts
// hashes and fbm, `sinP`), never Math.sin / cos / exp / pow (§3.6.1 rule 5).
// ─────────────────────────────────────────────────────────────────────────────

import { TERRAIN_SALT } from '../config';
import { Rng, fbm, hash2 } from '../rng';
import { Ground, SLOT, Terrain, type DistrictKind, type DistrictVariant, type FrameRegion, type SlotId, type Tile } from '../types';
import { ringKey, ringOf, slotOffset, slotX, slotY } from './slots';

/** The start map's layout parameters, read from the seed exactly as the generator reads them. */
export interface StartParams {
  /** Bay edge: 0 north, 1 east, 2 south, 3 west. */
  side: number;
  /** River runs along x (crossing the west and east edges) when 0, along y (north and south) when 1. */
  riverAxis: number;
  /** The edges the river crosses (directions as `side`). */
  riverExits: number[];
}

export function startParams(seed: number): StartParams {
  const rng = new Rng(seed >>> 0);
  const side = rng.int(0, 3);
  const riverAxis = rng.int(0, 1);
  return { side, riverAxis, riverExits: riverAxis === 0 ? [3, 1] : [0, 2] };
}

/**
 * Today's start map (EXPANSION-era `World.generateTerrain`), written into a frame of side `N` at slot origin
 * (ox, oy). Slot-local coordinates throughout (the bay edge, the river, the lakes, the drained core and the tile
 * variants), so the 64×64 block is bit-identical to the old map for the same seed wherever it is placed.
 */
export function generateStart(tiles: Tile[], N: number, ox: number, oy: number, seed: number): void {
  const S = SLOT;
  const rng = new Rng(seed >>> 0);
  const side = rng.int(0, 3); // which edge has the bay
  const riverAxis = rng.int(0, 1); // river runs along x or y
  const riverPhase = rng.next() * Math.PI * 2;
  const riverOffset = rng.int(18, 46);
  const s = (seed >>> 0) % 10000;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = tiles[(oy + y) * N + ox + x];
      // Bay along one edge with a noisy coastline.
      const edgeDist = [y, S - 1 - x, S - 1 - y, x][side];
      const along = side % 2 === 0 ? x : y;
      const coast = 5 + fbm(along * 0.09, 3.7, s + 11) * 9;
      let water = edgeDist < coast;

      // Meandering river from the bay inland.
      const u = riverAxis === 0 ? x : y; // along
      const v = riverAxis === 0 ? y : x; // across
      const center = riverOffset + Math.sin(u * 0.11 + riverPhase) * 6 + (fbm(u * 0.05, 9.1, s + 23) - 0.5) * 10;
      const width = 1.2 + fbm(u * 0.08, 1.3, s + 37) * 1.6;
      if (Math.abs(v - center) < width) water = true;

      // A few lakes / flooded lots.
      const lake = fbm(x * 0.07, y * 0.07, s + 51, 3);
      if (lake > 0.76) water = true;

      t.terrain = water ? Terrain.Water : Terrain.Land;
      t.variant = Math.floor(hash2(x, y, seed >>> 0) * 256);
      t.elev = 0;
      t.ground = Ground.Plain;
    }
  }

  // Keep a generous buildable core near the slot centre (lakes there are drained): 22..41.
  const c0 = (S >> 1) - 10;
  const c1 = (S >> 1) + 10;
  for (let y = c0; y < c1; y++)
    for (let x = c0; x < c1; x++) {
      const t = tiles[(oy + y) * N + ox + x];
      const lake = fbm(x * 0.07, y * 0.07, s + 51, 3);
      if (t.terrain === Terrain.Water && lake > 0.76) t.terrain = Terrain.Land;
    }
}

/**
 * A polynomial sine (exact arithmetic only, the same on every engine, §3.6.1 rule 5): Bhaskara-style
 * approximation over one period, |error| < 0.002. For district generators' meanders.
 */
export function sinP(x: number): number {
  const TAU = 6.283185307179586;
  let t = x - Math.floor(x / TAU) * TAU; // 0..2π
  let sign = 1;
  if (t > 3.141592653589793) {
    t -= 3.141592653589793;
    sign = -1;
  }
  const p = t * (3.141592653589793 - t);
  return (sign * (16 * p)) / (49.34802200544679 - 4 * p);
}

/** Target water share per kind (variant 0) and per 5×5 preset (§3.7). The stubs hit the middle of the range. */
export const KIND_WATER: Record<DistrictKind, [number, number]> = {
  shore: [0.05, 0.45],
  shoals: [0.45, 0.6],
  sunk: [0.25, 0.35],
  flats: [0.08, 0.15],
  terraces: [0.03, 0.08],
  reedmere: [0.25, 0.4],
  skeleton: [0.05, 0.1],
  tarmac: [0.05, 0.15],
  bazaar: [0.05, 0.12],
};
export const PRESET_WATER: Record<string, [number, number]> = {
  banks: [0.4, 0.55],
  isles: [0.55, 0.65],
  strand: [0.4, 0.55],
  steep: [0.02, 0.05],
  ridges: [0.02, 0.05],
  gentle: [0.04, 0.08],
  fen: [0.3, 0.4],
  mouth: [0.3, 0.45],
  docks: [0.12, 0.18],
  spur: [0.03, 0.08],
  frames4: [0.05, 0.1],
  rows: [0.05, 0.1],
  freight: [0.05, 0.12],
  headland: [0.15, 0.25],
  arcade: [0.03, 0.08],
  canal: [0.08, 0.14],
};

/** The water range of a slot's kind and variant (the preset's for a 5×5 repeat). */
export function waterRange(kind: DistrictKind, variant: DistrictVariant, preset?: string): [number, number] {
  if (variant > 0 && preset && PRESET_WATER[preset]) return PRESET_WATER[preset];
  return KIND_WATER[kind];
}

/** Scratch for one slot's noise field (§3.6.1: computed once per slot, reused by iterative rules). One slot is 64² tiles on every region. */
const field = new Float32Array(4096);
const order = new Float32Array(4096);

/**
 * Step 0b stub generator for a non-start slot (WP-2 replaces it per kind and preset): water on the side facing away
 * from the start slot plus fbm, thresholded at the quantile that gives the middle of the kind's (preset's) water
 * share, so land shares are in range and the land stays one piece near the city. Elev 0, ground Plain, tile variants
 * from art-coordinate hashes. Deterministic from the seed and `ringKey` only.
 */
export function generateSlot(
  tiles: Tile[],
  N: number,
  region: FrameRegion,
  slot: SlotId,
  seed: number,
  kind: DistrictKind,
  variant: DistrictVariant,
  preset?: string,
): void {
  const key = ringKey(region, slot);
  const salt = TERRAIN_SALT[key] ?? 0;
  const ox = slotX(region, slot) * SLOT;
  const oy = slotY(region, slot) * SLOT;
  const [dx, dy] = slotOffset(region, slot);
  const o = SLOT * ((region - 1) >> 1);
  const nseed = ((seed >>> 0) % 10000) + 100 * key;
  // Outward direction (away from the start slot): water gathers on that side.
  const len = Math.abs(dx) + Math.abs(dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  for (let y = 0; y < SLOT; y++)
    for (let x = 0; x < SLOT; x++) {
      const out = ((x - 31.5) * ux + (y - 31.5) * uy) / 63 + 0.5; // 0 toward the city, 1 away from it
      // Art coordinates (x + ox − o): the same slot offset from the start generates the same land on both regions.
      const n = fbm((x + ox - o) * 0.06, (y + oy - o) * 0.06, nseed + (salt & 1023), 4);
      field[y * SLOT + x] = out * 0.6 + n * 0.4;
    }
  const [lo, hi] = waterRange(kind, variant, preset);
  const share = (lo + hi) / 2;
  order.set(field);
  order.sort();
  const k = Math.min(SLOT * SLOT - 1, Math.max(0, Math.floor((1 - share) * SLOT * SLOT)));
  const cut = order[k];
  for (let y = 0; y < SLOT; y++)
    for (let x = 0; x < SLOT; x++) {
      const t = tiles[(oy + y) * N + ox + x];
      t.terrain = field[y * SLOT + x] >= cut ? Terrain.Water : Terrain.Land;
      t.variant = Math.floor(hash2(x + ox - o, y + oy - o, seed >>> 0) * 256);
      t.elev = 0;
      t.ground = Ground.Plain;
    }
}

/**
 * The generation order of §3.6.1: the start slot, ring 1's edge slots (N, E, S, W) then corners (NW, NE, SW, SE),
 * then on a 5×5 region ring 2's straight-out slots (N, E, S, W), the eight off-axis slots clockwise from north and the
 * four outer corners (NW, NE, SW, SE). Returned as offsets (dx, dy) from the start slot.
 */
export const GEN_ORDER: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [0, -2],
  [2, 0],
  [0, 2],
  [-2, 0],
  [1, -2],
  [2, -1],
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
  [-2, -1],
  [-1, -2],
  [-2, -2],
  [2, -2],
  [-2, 2],
  [2, 2],
];

/** Slots of a region in generation order. */
export function generationOrder(region: FrameRegion): SlotId[] {
  const c = (region - 1) >> 1;
  const out: SlotId[] = [];
  for (const [dx, dy] of GEN_ORDER) {
    const sx = c + dx;
    const sy = c + dy;
    if (sx >= 0 && sy >= 0 && sx < region && sy < region) out.push(sy * region + sx);
  }
  return out;
}

/**
 * Generate the terrain of a region's slots in §3.6.1 order: the start slot with the start generator, every other slot
 * with its kind's generator. `only` limits it to those slots (deserialize generates locked slots only).
 */
export function generateRegionTerrain(
  tiles: Tile[],
  N: number,
  region: FrameRegion,
  seed: number,
  kinds: readonly DistrictKind[],
  variants: readonly DistrictVariant[],
  presetOf: (kind: DistrictKind, variant: DistrictVariant) => string | undefined,
  only?: (s: SlotId) => boolean,
): void {
  for (const s of generationOrder(region)) {
    if (only && !only(s)) continue;
    if (ringOf(region, s) === 0) {
      generateStart(tiles, N, slotX(region, s) * SLOT, slotY(region, s) * SLOT, seed);
      continue;
    }
    const kind = kinds[s] ?? 'flats';
    const variant = variants[s] ?? 0;
    generateSlot(tiles, N, region, s, seed, kind, variant, presetOf(kind, variant));
  }
}
