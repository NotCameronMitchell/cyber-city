// ─────────────────────────────────────────────────────────────────────────────
// Skyways (docs/EXPANSION.md §3.7): raised roads in world.sky (bits 0-3 link
// mask N1 E2 S4 W8, bit 4 ramp). Docks are derived, never stored; a ramp
// carries traffic only while the ground under it is a Street, Avenue or Ramp.
// Helpers are frozen after Step 0; planSkyway's body belongs to WP-2.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from './config';
import { MAP_SIZE, RoadKind, type ActionPlan, type Building, type Tile } from './types';
import type { Point } from './actions';
import type { World } from './world';

const N = MAP_SIZE;
const AREA = N * N;

/** Link bits (N1 E2 S4 W8) and the ramp bit. */
export const SKY_N = 1;
export const SKY_E = 2;
export const SKY_S = 4;
export const SKY_W = 8;
export const SKY_MASK = 15;
export const SKY_RAMP = 16;

/** The opposite link bit (N↔S, E↔W). */
export function skyOpposite(dir: number): number {
  return dir === SKY_N ? SKY_S : dir === SKY_S ? SKY_N : dir === SKY_E ? SKY_W : dir === SKY_W ? SKY_E : 0;
}

/** Neighbour index of tile `i` in direction `dir` (a link bit), or −1 off the map. */
export function skyNeighbour(i: number, dir: number): number {
  const x = i % N;
  const y = (i / N) | 0;
  switch (dir) {
    case SKY_N:
      return y > 0 ? i - N : -1;
    case SKY_E:
      return x < N - 1 ? i + 1 : -1;
    case SKY_S:
      return y < N - 1 ? i + N : -1;
    case SKY_W:
      return x > 0 ? i - 1 : -1;
    default:
      return -1;
  }
}

/** Does the building on (x, y) take skyway docks (`skyAnchor`: Stratablock, Spire, Arcology, Airport)? */
export function isSkyAnchorAt(world: World, x: number, y: number): boolean {
  const b = world.buildingAt(x, y);
  return !!b && !!BUILDINGS[b.type]?.skyAnchor;
}

/** Ground a sky ramp can touch down on: a Street, Avenue or Ramp road. */
export function skyRampGround(t: Pick<Tile, 'road' | 'roadKind'>): boolean {
  return t.road && (t.roadKind === RoadKind.Street || t.roadKind === RoadKind.Avenue || t.roadKind === RoadKind.Ramp);
}

/** A ramp that carries traffic: the ramp bit is set and the ground qualifies (the bit stays when it doesn't, §2.4). */
export function skyRampActive(world: World, i: number): boolean {
  return (world.sky[i] & SKY_RAMP) !== 0 && skyRampGround(world.tiles[i]);
}

/**
 * Does the neighbour of tile `i` in direction `dir` (a link bit, 1/2/4/8) link back to it
 * (in bounds and carrying the opposite bit)? Tile i's own bit is not checked.
 */
export function skyLinksBack(sky: Uint8Array, i: number, dir: number): boolean {
  const j = skyNeighbour(i, dir);
  return j >= 0 && (sky[j] & skyOpposite(dir)) !== 0;
}

// Scratch for skywayDocks (stamped, no allocation per call).
const stamp = new Uint32Array(AREA);
const queue = new Int32Array(AREA);
let gen = 0;

/**
 * Is building `b` docked by a skyway, and how many active ramps does that network have?
 * A pure BFS over world.sky (mutual links only) from the sky tiles on b's footprint
 * (§3.7). Buildings without `skyAnchor` never dock. Used by actions.stackConnected.
 */
export function skywayDocks(world: World, b: Building): { docked: boolean; ramps: number } {
  const res = { docked: false, ramps: 0 };
  if (!BUILDINGS[b.type]?.skyAnchor) return res;
  const sky = world.sky;
  gen = (gen + 1) >>> 0;
  if (gen === 0) {
    stamp.fill(0);
    gen = 1;
  }
  let head = 0;
  let tail = 0;
  for (let dy = 0; dy < b.size; dy++)
    for (let dx = 0; dx < b.size; dx++) {
      const x = b.x + dx;
      const y = b.y + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      if ((sky[i] & SKY_MASK) === 0 || stamp[i] === gen) continue;
      stamp[i] = gen;
      queue[tail++] = i;
    }
  if (tail === 0) return res;
  res.docked = true;
  while (head < tail) {
    const i = queue[head++];
    const m = sky[i];
    if ((m & SKY_RAMP) !== 0 && skyRampGround(world.tiles[i])) res.ramps++;
    for (let d = 1; d <= 8; d <<= 1) {
      if ((m & d) === 0) continue;
      const j = skyNeighbour(i, d);
      if (j < 0 || stamp[j] === gen || (sky[j] & skyOpposite(d)) === 0) continue;
      stamp[j] = gen;
      queue[tail++] = j;
    }
  }
  return res;
}

/**
 * Plan a skyway drag along `path` into `plan` (tiles, skyMasks, cost, note, reason) and
 * return the number of tiles that change. **Step 0 stub**: marks the path invalid with the
 * reason "Not yet" and returns 0. WP-2 fills it (§3.7: 24-tile cap, anchors only, gap
 * tiles refused, endpoint ramps, joins onto existing sky like planRail).
 */
export function planSkyway(world: World, path: readonly Point[], plan: ActionPlan): number {
  for (const p of path) if (world.inBounds(p.x, p.y)) plan.tiles.push({ x: p.x, y: p.y, ok: false });
  plan.reason = 'Not yet';
  return 0;
}
