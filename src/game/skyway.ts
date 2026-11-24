// ─────────────────────────────────────────────────────────────────────────────
// Skyways (docs/EXPANSION.md §3.7): raised roads in world.sky (bits 0-3 link
// mask N1 E2 S4 W8, bit 4 ramp). Docks are derived, never stored; a ramp
// carries traffic only while the ground under it is a Street, Avenue or Ramp.
// Helpers are frozen after Step 0; planSkyway's body belongs to WP-2.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, SKYWAY } from './config';
import { scratchFor } from './frame';
import { RoadKind, type ActionPlan, type Building, type Tile } from './types';
import type { Point } from './actions';
import type { World } from './world';

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

/** Neighbour index of tile `i` in direction `dir` (a link bit) on a world of side `N`, or −1 off the map. */
export function skyNeighbour(i: number, dir: number, N: number): number {
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
 * (in bounds and carrying the opposite bit)? Tile i's own bit is not checked. `N` is the side.
 */
export function skyLinksBack(sky: Uint8Array, i: number, dir: number, N: number): boolean {
  const j = skyNeighbour(i, dir, N);
  return j >= 0 && (sky[j] & skyOpposite(dir)) !== 0;
}

// Scratch for skywayDocks and landsNowhere (stamped, no allocation per call), one set per frame size.
const scratch = scratchFor((area) => ({
  stamp: new Uint32Array(area),
  queue: new Int32Array(area),
  /** Overlay of world.sky with a plan's masks (the "lands nowhere" check). */
  overlay: new Uint8Array(area),
  gen: 0,
}));

/** The next stamp generation of a scratch set (clears the stamps on wrap). */
function nextGen(s: ReturnType<typeof scratch>): number {
  s.gen = (s.gen + 1) >>> 0;
  if (s.gen === 0) {
    s.stamp.fill(0);
    s.gen = 1;
  }
  return s.gen;
}

/**
 * Is building `b` docked by a skyway, and how many active ramps does that network have?
 * A pure BFS over world.sky (mutual links only) from the sky tiles on b's footprint
 * (§3.7). Buildings without `skyAnchor` never dock. Used by actions.stackConnected.
 */
export function skywayDocks(world: World, b: Building): { docked: boolean; ramps: number } {
  const res = { docked: false, ramps: 0 };
  if (!BUILDINGS[b.type]?.skyAnchor) return res;
  const sky = world.sky;
  const N = world.N;
  const sc = scratch(world.area);
  const { stamp, queue } = sc;
  const gen = nextGen(sc);
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
      const j = skyNeighbour(i, d, N);
      if (j < 0 || stamp[j] === gen || (sky[j] & skyOpposite(d)) === 0) continue;
      stamp[j] = gen;
      queue[tail++] = j;
    }
  }
  return res;
}

const popcount4 = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** Is (x, y) a gap tile (strictly between the anchors) of any skybridge? */
function skybridgeGapAt(world: World, x: number, y: number): boolean {
  for (const l of world.links) {
    if (l.ay === l.by) {
      if (y === l.ay && x > Math.min(l.ax, l.bx) && x < Math.max(l.ax, l.bx)) return true;
    } else if (x === l.ax && y > Math.min(l.ay, l.by) && y < Math.max(l.ay, l.by)) return true;
  }
  return false;
}

/**
 * Would the network through `pts` (with `masks` written over world.sky) have neither an
 * active ramp nor a dock? A BFS over mutual links in the overlay.
 */
function landsNowhere(world: World, pts: readonly Point[], masks: readonly number[]): boolean {
  const N = world.N;
  const sc = scratch(world.area);
  const { stamp, queue, overlay } = sc;
  overlay.set(world.sky);
  for (let k = 0; k < pts.length; k++) overlay[pts[k].y * N + pts[k].x] = masks[k];
  const gen = nextGen(sc);
  let head = 0;
  let tail = 0;
  const s0 = pts[0].y * N + pts[0].x;
  stamp[s0] = gen;
  queue[tail++] = s0;
  while (head < tail) {
    const i = queue[head++];
    const m = overlay[i];
    if ((m & SKY_RAMP) !== 0 && skyRampGround(world.tiles[i])) return false;
    if (world.tiles[i].buildingId >= 0 && isSkyAnchorAt(world, i % N, (i / N) | 0)) return false;
    for (let d = 1; d <= 8; d <<= 1) {
      if ((m & d) === 0) continue;
      const j = skyNeighbour(i, d, N);
      if (j < 0 || stamp[j] === gen || (overlay[j] & skyOpposite(d)) === 0) continue;
      stamp[j] = gen;
      queue[tail++] = j;
    }
  }
  return true;
}

/**
 * Plan a skyway drag along `path` (actions.roadPath) into `plan` and return the number of
 * tiles that change (§3.7). Fills `tiles`, `skyMasks` (mask | ramp << 4 per tile, joined onto
 * existing sky like planRail), the base cost (perTile per new tile + rampCost per new ramp;
 * the caller applies buildCostMul and the funds check), `ramps` (new ramp bits), `reason`
 * and `note`.
 *
 * - At most SKYWAY.maxDrag tiles ("Max 24 tiles per drag"), at least 2 ("Drag to lay a skyway").
 * - Land, water, any ground road, zone tiles at any level and rail are fine; building tiles only
 *   where the building has `skyAnchor` ("Blocked by buildings"); never a skybridge gap tile
 *   ("Skybridge in the way"). A blocked tile refuses the whole drag, like rail.
 * - A path endpoint gets the ramp bit when its ground is a Street, Avenue or Ramp and its mask
 *   has exactly one link; extending through a ramp gives it a second link, which clears the bit.
 *   A ramp the drag does not change keeps its bit (an inactive ramp stays a ramp, §2.4).
 * - Note "Lands nowhere" when the finished network has neither an active ramp nor a dock.
 */
export function planSkyway(world: World, path: readonly Point[], plan: ActionPlan): number {
  const SW = SKYWAY;
  const N = world.N;
  let pts = path.filter((p) => world.inBounds(p.x, p.y));
  let truncated = false;
  if (pts.length > SW.maxDrag) {
    pts = pts.slice(0, SW.maxDrag);
    truncated = true;
  }
  const sky = world.sky;
  const masks: number[] = [];
  plan.skyMasks = masks;
  if (pts.length < 2) {
    for (const p of pts) {
      plan.tiles.push({ x: p.x, y: p.y, ok: true });
      masks.push(sky[p.y * N + p.x]);
    }
    plan.reason = 'Drag to lay a skyway';
    return 0;
  }
  const last = pts.length - 1;
  let blocked: string | null = null;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const i = p.y * N + p.x;
    const t = world.tiles[i];
    let m = sky[i] & SKY_MASK;
    for (const q of [pts[k - 1], pts[k + 1]]) {
      if (!q) continue;
      if (q.y < p.y) m |= SKY_N;
      else if (q.x > p.x) m |= SKY_E;
      else if (q.y > p.y) m |= SKY_S;
      else if (q.x < p.x) m |= SKY_W;
    }
    let ramp = false;
    if (popcount4(m) === 1) {
      if ((k === 0 || k === last) && skyRampGround(t)) ramp = true;
      else if ((sky[i] & SKY_RAMP) !== 0 && (sky[i] & SKY_MASK) === m) ramp = true;
    }
    masks.push(m | (ramp ? SKY_RAMP : 0));
    let ok = true;
    if (t.buildingId >= 0 && !isSkyAnchorAt(world, p.x, p.y)) {
      ok = false;
      blocked ??= 'Blocked by buildings';
    } else if (skybridgeGapAt(world, p.x, p.y)) {
      ok = false;
      blocked ??= 'Skybridge in the way';
    }
    plan.tiles.push({ x: p.x, y: p.y, ok });
  }
  if (blocked) {
    plan.reason = blocked;
    return 0;
  }
  let changes = 0;
  let cost = 0;
  let ramps = 0;
  for (let k = 0; k < pts.length; k++) {
    const i = pts[k].y * N + pts[k].x;
    const before = sky[i];
    if (masks[k] === before) continue;
    changes++;
    if (before === 0) cost += SW.perTile;
    if ((masks[k] & SKY_RAMP) !== 0 && (before & SKY_RAMP) === 0) {
      cost += SW.rampCost;
      ramps++;
    }
  }
  plan.cost = cost;
  plan.ramps = ramps;
  if (truncated) plan.reason = `Max ${SW.maxDrag} tiles per drag`;
  if (changes > 0 && landsNowhere(world, pts, masks)) plan.note = 'Lands nowhere';
  return changes;
}
