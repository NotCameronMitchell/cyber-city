// ─────────────────────────────────────────────────────────────────────────────
// Port placement helpers (docs/EXPANSION.md §5): the shore rule, valid shore
// sites, berths and the noise reach a ghost shows. Pure reads of the world;
// frozen after Step 0.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, SEAPORT, type BuildingDef } from './config';
import { MAP_SIZE, Terrain, ZoneType, type Building, type BuildingType } from './types';
import type { World } from './world';

const N = MAP_SIZE;

/** Facing → unit step out of the footprint: 0 = N (y−1), 1 = E (x+1), 2 = S (y+1), 3 = W (x−1). */
const FACE_DX = [0, 1, 0, -1] as const;
const FACE_DY = [-1, 0, 1, 0] as const;
/** Sides in the order they are tested (§5.1): S, E, N, W. */
const FACE_ORDER = [2, 1, 0, 3] as const;

/** Open water: in bounds, water, no road (bridge) and no rail. */
function openWater(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const i = y * N + x;
  const t = world.tiles[i];
  return t.terrain === Terrain.Water && !t.road && world.rail[i] === 0;
}

/** The `size` tiles along side `face` of a size×size footprint at (x, y), stepped `d` tiles out. */
function sideTile(x: number, y: number, size: number, face: number, k: number, d: number): [number, number] {
  switch (face) {
    case 0:
      return [x + k, y - d];
    case 1:
      return [x + size - 1 + d, y + k];
    case 2:
      return [x + k, y + size - 1 + d];
    default:
      return [x - d, y + k];
  }
}

/**
 * The side of a size×size footprint at top-left (x, y) that faces open water (§5.1):
 * sides are tested S, E, N, W; a side qualifies when, for each of its `size` tiles, the
 * tiles 1..SEAPORT.berthDepth beyond it are in-bounds water with no bridge and no rail.
 * Returns 0 N, 1 E, 2 S, 3 W, or −1 when no side qualifies. The footprint itself is not checked.
 */
export function shoreFacing(world: World, x: number, y: number, size: number): 0 | 1 | 2 | 3 | -1 {
  for (const face of FACE_ORDER) {
    let ok = true;
    for (let k = 0; k < size && ok; k++)
      for (let d = 1; d <= SEAPORT.berthDepth; d++) {
        const [bx, by] = sideTile(x, y, size, face, k, d);
        if (!openWater(world, bx, by)) {
          ok = false;
          break;
        }
      }
    if (ok) return face as 0 | 1 | 2 | 3;
  }
  return -1;
}

/** Can a building of this def stand on every footprint tile (clear land, no developed zone, no rail or skyway)? */
function siteClear(world: World, def: BuildingDef, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + def.size > N || y + def.size > N) return false;
  for (let dy = 0; dy < def.size; dy++)
    for (let dx = 0; dx < def.size; dx++) {
      const i = (y + dy) * N + x + dx;
      const t = world.tiles[i];
      if (t.terrain !== Terrain.Land || t.road || t.buildingId >= 0) return false;
      if (t.zone !== ZoneType.None && t.level > 0) return false;
      if (world.rail[i] !== 0 || world.sky[i] !== 0) return false;
    }
  return true;
}

/**
 * Mark every valid Seaport top-left in `out` (Uint8Array(4096), 1 = valid; cleared first)
 * and return how many (§5.1): the 4×4 footprint is clear land (no road, building, developed
 * lot, rail or skyway) and one side faces open water. Road access is not required here (the
 * player can lay a street after); planAction checks it. A few thousand cheap checks (< 1 ms).
 */
export function shoreSites(world: World, out: Uint8Array): number {
  out.fill(0);
  const def = BUILDINGS.seaport;
  const s = def.size;
  let n = 0;
  for (let y = 0; y + s <= N; y++)
    for (let x = 0; x + s <= N; x++) {
      if (!siteClear(world, def, x, y)) continue;
      if (shoreFacing(world, x, y, s) < 0) continue;
      out[y * N + x] = 1;
      n++;
    }
  return n;
}

/**
 * Seaport footprints the map's shape allows (§5.1), ignoring what stands on them: 4×4 all-land
 * footprints with one side facing open water. Roads, buildings and lots do not count, so a
 * built-up waterfront still has shore here while shoreSites finds no clear site.
 */
export function shoreGeometry(world: World): number {
  const s = BUILDINGS.seaport.size;
  let n = 0;
  for (let y = 0; y + s <= N; y++)
    for (let x = 0; x + s <= N; x++) {
      let land = true;
      for (let dy = 0; dy < s && land; dy++)
        for (let dx = 0; dx < s; dx++)
          if (world.tiles[(y + dy) * N + x + dx].terrain !== Terrain.Land) {
            land = false;
            break;
          }
      if (land && shoreFacing(world, x, y, s) >= 0) n++;
    }
  return n;
}

/**
 * The berth of a Seaport: the size × SEAPORT.berthDepth water tiles beyond its `facing`
 * side (tile indices, in-bounds only). Empty for other buildings or a seaport without facing.
 */
export function berthTiles(b: Pick<Building, 'type' | 'x' | 'y' | 'size' | 'facing'>): number[] {
  const out: number[] = [];
  if (b.type !== 'seaport' || b.facing === undefined) return out;
  for (let k = 0; k < b.size; k++)
    for (let d = 1; d <= SEAPORT.berthDepth; d++) {
      const [x, y] = sideTile(b.x, b.y, b.size, b.facing, k, d);
      if (x >= 0 && y >= 0 && x < N && y < N) out.push(y * N + x);
    }
  return out;
}

/** Is (x, y) on any Seaport's berth (no bridges there, §5.1)? */
export function isBerthTile(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  for (const b of world.buildings.values()) {
    if (b.type !== 'seaport' || b.facing === undefined) continue;
    const f = b.facing;
    // Distance out of the facing side, and position along it.
    let out: number;
    let along: number;
    switch (f) {
      case 0:
        out = b.y - y;
        along = x - b.x;
        break;
      case 1:
        out = x - (b.x + b.size - 1);
        along = y - b.y;
        break;
      case 2:
        out = y - (b.y + b.size - 1);
        along = x - b.x;
        break;
      default:
        out = b.x - x;
        along = y - b.y;
    }
    if (out >= 1 && out <= SEAPORT.berthDepth && along >= 0 && along < b.size) return true;
  }
  return false;
}

/** Noise a building type makes (`v` at the footprint, 0 at `r` tiles out), or null. */
export function noiseDef(type: BuildingType): { v: number; r: number } | null {
  return BUILDINGS[type]?.noise ?? null;
}

/**
 * Developed Hab Block tiles (level ≥ 1, not abandoned) inside the noise reach of a building
 * of `type` with its footprint top-left at (x, y): Chebyshev distance to the nearest footprint
 * tile ≤ r (§5.4). Fills `out` (cleared first) with their tile indices; returns the count.
 * At most (size + 2r)² tiles are visited.
 */
export function noiseReach(world: World, type: BuildingType, x: number, y: number, out: number[]): number {
  out.length = 0;
  const nd = noiseDef(type);
  const def = BUILDINGS[type];
  if (!nd || !def) return 0;
  const r = nd.r;
  const x0 = Math.max(0, x - r);
  const x1 = Math.min(N - 1, x + def.size - 1 + r);
  const y0 = Math.max(0, y - r);
  const y1 = Math.min(N - 1, y + def.size - 1 + r);
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      // Inside the footprint the site is cleared anyway; skip it.
      if (xx >= x && xx < x + def.size && yy >= y && yy < y + def.size) continue;
      const t = world.tiles[yy * N + xx];
      if (t.zone !== ZoneType.Residential || t.level < 1 || t.abandoned) continue;
      out.push(yy * N + xx);
    }
  return out.length;
}

/** The unit step out of a facing side (for art and ship approach paths). */
export function facingStep(face: 0 | 1 | 2 | 3): [number, number] {
  return [FACE_DX[face], FACE_DY[face]];
}
