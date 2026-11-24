// ─────────────────────────────────────────────────────────────────────────────
// Merged parcels (docs/MEGACITY.md §6.1). Rules and interface frozen after Step 0b;
// WP-3 caches and sorts them, WP-4 draws them.
//
// A pure function of the tiles and the seed, with no saved state. For each 2×2
// block aligned to even world coordinates: if all four tiles are the same zone,
// developed (level ≥ 1), not abandoned (so never a ruin), on the same terrace
// step, with no building, and a hash of the block's art coordinates < 0.5, the
// block is one 2×2 parcel. Otherwise each aligned pair along x, then along y,
// passing the same rule with its own hash < 0.5, is a 2×1 or 1×2 parcel.
// Otherwise single tiles. Level and tier do not take part: a parcel draws at the
// lowest level and tier among its members, so levelling up never merges or
// unmerges it. The head is the front corner (largest x + y): the parcel's
// skybridge anchor key and its sort key.
// ─────────────────────────────────────────────────────────────────────────────

import { hash2 } from './rng';
import { ZoneType, type Parcel, type Tile } from './types';
import type { World } from './world';

const QUAD_SALT = 0x51a7c0de;
const PAIR_X_SALT = 0x2b1d3e57;
const PAIR_Y_SALT = 0x6e0f9a13;
/** The merge chance of each step (quad, then pairs). */
export const PARCEL_CHANCE = 0.5;

/** parcelMap bits: 0-1 shape (0 single, 1 = 2×1, 2 = 1×2, 3 = 2×2), bit 2 head, bit 3 member of a parcel. */
export const PARCEL_SHAPE = 3;
export const PARCEL_HEAD = 4;
export const PARCEL_MEMBER = 8;

/** Can this tile join a parcel at all? */
function mergeable(t: Tile, bld = t.buildingId): boolean {
  return t.zone !== ZoneType.None && t.level >= 1 && !t.abandoned && bld < 0 && !t.road;
}
function same(a: Tile, b: Tile): boolean {
  return mergeable(a) && mergeable(b) && a.zone === b.zone && a.elev === b.elev;
}

const artO = (world: Pick<World, 'region'>) => 64 * ((world.region - 1) >> 1);

/**
 * The shapes of the aligned 2×2 block at even (bx, by), as up to two rects [x, y, w, h] (world coordinates).
 * Empty when every tile is single. Out-of-map or locked tiles never merge (they hold no zone).
 */
function blockParcels(world: World, bx: number, by: number, out: number[]): number {
  const N = world.N;
  if (bx + 1 >= N || by + 1 >= N) return 0;
  const T = world.tiles;
  const a = T[by * N + bx];
  const b = T[by * N + bx + 1];
  const c = T[(by + 1) * N + bx];
  const d = T[(by + 1) * N + bx + 1];
  const o = artO(world);
  const ax = bx - o;
  const ay = by - o;
  const seed = world.seed;
  if (same(a, b) && same(a, c) && same(a, d) && hash2(ax >> 1, ay >> 1, seed ^ QUAD_SALT) < PARCEL_CHANCE) {
    out[0] = bx;
    out[1] = by;
    out[2] = 2;
    out[3] = 2;
    return 1;
  }
  let n = 0;
  let used = 0; // bits: 1 a, 2 b, 4 c, 8 d
  // Pairs along x: the top row, then the bottom row.
  if (same(a, b) && hash2(ax, ay, seed ^ PAIR_X_SALT) < PARCEL_CHANCE) {
    out[n * 4] = bx;
    out[n * 4 + 1] = by;
    out[n * 4 + 2] = 2;
    out[n * 4 + 3] = 1;
    n++;
    used |= 3;
  }
  if (same(c, d) && hash2(ax, ay + 1, seed ^ PAIR_X_SALT) < PARCEL_CHANCE) {
    out[n * 4] = bx;
    out[n * 4 + 1] = by + 1;
    out[n * 4 + 2] = 2;
    out[n * 4 + 3] = 1;
    n++;
    used |= 12;
  }
  // Then along y, for tiles not merged yet: the left column, then the right.
  if (!(used & 5) && same(a, c) && hash2(ax, ay, seed ^ PAIR_Y_SALT) < PARCEL_CHANCE) {
    out[n * 4] = bx;
    out[n * 4 + 1] = by;
    out[n * 4 + 2] = 1;
    out[n * 4 + 3] = 2;
    n++;
    used |= 5;
  }
  if (!(used & 10) && same(b, d) && hash2(ax + 1, ay, seed ^ PAIR_Y_SALT) < PARCEL_CHANCE) {
    out[n * 4] = bx + 1;
    out[n * 4 + 1] = by;
    out[n * 4 + 2] = 1;
    out[n * 4 + 3] = 2;
    n++;
  }
  return n;
}

function toParcel(world: World, x: number, y: number, w: 1 | 2, h: 1 | 2): Parcel {
  const N = world.N;
  let level = 3;
  let tier = 2;
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      const t = world.tiles[(y + dy) * N + x + dx];
      level = Math.min(level, t.level);
      tier = Math.min(tier, t.wealth);
    }
  return { hx: x + w - 1, hy: y + h - 1, x, y, w, h, level, tier };
}

const scratch: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

/** The parcel tile (x, y) belongs to, or null for a single tile (or a non-zone tile). Pure. */
export function parcelAt(world: World, x: number, y: number): Parcel | null {
  if (!world.inBounds(x, y)) return null;
  const bx = x & ~1;
  const by = y & ~1;
  const n = blockParcels(world, bx, by, scratch);
  for (let k = 0; k < n; k++) {
    const px = scratch[k * 4];
    const py = scratch[k * 4 + 1];
    const w = scratch[k * 4 + 2] as 1 | 2;
    const h = scratch[k * 4 + 3] as 1 | 2;
    if (x >= px && x < px + w && y >= py && y < py + h) return toParcel(world, px, py, w, h);
  }
  return null;
}

/** Shape code of a parcel for parcelMap: 1 = 2×1, 2 = 1×2, 3 = 2×2. */
const shapeCode = (w: number, h: number) => (w === 2 && h === 2 ? 3 : w === 2 ? 1 : 2);

/**
 * Write the parcel map of the aligned blocks covering tile rect [x0..x1] × [y0..y1] into `out` (Uint8Array(area)):
 * bits 0-1 shape, bit 2 head, bit 3 member. Tiles outside any parcel get 0.
 */
export function fillParcelMap(world: World, out: Uint8Array, x0 = 0, y0 = 0, x1 = world.N - 1, y1 = world.N - 1): void {
  const N = world.N;
  const bx0 = Math.max(0, x0 & ~1);
  const by0 = Math.max(0, y0 & ~1);
  const bx1 = Math.min(N - 2, x1 & ~1);
  const by1 = Math.min(N - 2, y1 & ~1);
  for (let by = by0; by <= by1; by += 2)
    for (let bx = bx0; bx <= bx1; bx += 2) {
      const i = by * N + bx;
      out[i] = out[i + 1] = out[i + N] = out[i + N + 1] = 0;
      const n = blockParcels(world, bx, by, scratch);
      for (let k = 0; k < n; k++) {
        const px = scratch[k * 4];
        const py = scratch[k * 4 + 1];
        const w = scratch[k * 4 + 2];
        const h = scratch[k * 4 + 3];
        const s = shapeCode(w, h);
        for (let dy = 0; dy < h; dy++)
          for (let dx = 0; dx < w; dx++) {
            const head = dx === w - 1 && dy === h - 1;
            out[(py + dy) * N + px + dx] = s | PARCEL_MEMBER | (head ? PARCEL_HEAD : 0);
          }
      }
    }
}

const maps = new WeakMap<World, { version: number; map: Uint8Array }>();

/**
 * The cached parcel map of a world (a Uint8Array(area): bits 0-1 shape, bit 2 head, bit 3 member). Step 0b rebuilds
 * it whole when world.version changed since the last call; WP-3 rebuilds only the aligned blocks a `tiles` event
 * touches (fillParcelMap with the event's rect) and on `world` / `annex`.
 */
export function parcelMap(world: World): Uint8Array {
  let c = maps.get(world);
  if (!c) {
    c = { version: -1, map: new Uint8Array(world.area) };
    maps.set(world, c);
  }
  if (c.version !== world.version) {
    fillParcelMap(world, c.map);
    c.version = world.version;
  }
  return c.map;
}
