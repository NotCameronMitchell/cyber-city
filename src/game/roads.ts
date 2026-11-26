// ─────────────────────────────────────────────────────────────────────────────
// Road kinds (docs/EXPANSION.md §3): links, access, drag results, prices and
// the highway lost-access check. Pure game-side helpers with no story imports;
// frozen after Step 0 (shared by the sim, actions, World and the renderer).
//
//   roadLinks(a, b)      do two 4-adjacent ground roads connect? (§3.2)
//   computeAccess(...)   the one access rule (§3.3): SimGrid, RoadAccessMap and
//                        World.hasRoadAccess agree with it
//   dragResult(t, c)     what a drag of kind `t` makes of an existing road (§3.4)
//   lostAccess(...)      lots and needsRoad buildings a highway drag would strand
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, ROAD_ACCESS_RANGE, ROAD_KINDS, type RoadKindDef } from './config';
import { scratchFor } from './frame';
import { RoadKind, Terrain, ZoneType, type ToolId } from './types';
import type { World } from './world';

/** The four ground road tools. 'road' stays the Street tool id. */
export type RoadTool = 'road' | 'avenue' | 'highway' | 'alley';

/** The kind each road tool lays. */
export const ROAD_TOOL_KIND: Record<RoadTool, RoadKind> = {
  road: RoadKind.Street,
  avenue: RoadKind.Avenue,
  highway: RoadKind.Highway,
  alley: RoadKind.Alley,
};

/** Road tools in tray order (Street, Back Alley, Avenue, Highway; §7.2). */
export const ROAD_TOOLS: readonly RoadTool[] = ['road', 'alley', 'avenue', 'highway'];

/** "No road" marker in a kinds array (fillKinds / computeAccess). */
export const KIND_NONE = 255;

export function isRoadTool(t: ToolId | string): t is RoadTool {
  return t === 'road' || t === 'avenue' || t === 'highway' || t === 'alley';
}

/** Definition row of a kind (out-of-range kinds read as Street). */
export function roadDef(k: RoadKind | number): RoadKindDef {
  return ROAD_KINDS[k] ?? ROAD_KINDS[RoadKind.Street];
}

/**
 * Two 4-adjacent ground road tiles connect unless exactly one of them is a
 * Highway and the other is not a Ramp (§3.2).
 */
export function roadLinks(a: RoadKind | number, b: RoadKind | number): boolean {
  const ha = a === RoadKind.Highway;
  const hb = b === RoadKind.Highway;
  if (ha === hb) return true; // both highway, or neither
  return (ha ? b : a) === RoadKind.Ramp; // highway ↔ ramp only
}

/** Can lots front onto this kind (develop from it, send trips to it)? Everything but the Highway. */
export function frontable(k: RoadKind | number): boolean {
  return roadDef(k).access > 0;
}

/** Chebyshev range within which lots can develop from this kind (0 = none). */
export function accessRange(k: RoadKind | number): number {
  return roadDef(k).access;
}

/** Price of one tile of this kind, before buildCostMul; null where it can't be (alleys and ramps on water). */
export function roadPrice(k: RoadKind | number, water: boolean): number | null {
  const d = roadDef(k);
  return water ? d.bridgeCost : d.cost;
}

/** Upkeep per tile per month (bridge upkeep on water). */
export function roadUpkeep(k: RoadKind | number, water: boolean): number {
  const d = roadDef(k);
  return water ? d.bridgeUpkeep : d.upkeep;
}

/**
 * What a drag laying `toolKind` (or a Ramp at a ramp position) makes of an
 * existing road of kind `current`, or null for "no change" (§3.4 table).
 * Smaller kinds never shrink a road; a Highway is passed through by everything
 * but a highway drag.
 *
 * | target \ current | Alley  | Street | Avenue | Highway | Ramp    |
 * | Alley            | –      | –      | –      | –       | –       |
 * | Street           | Street | –      | –      | –       | –       |
 * | Avenue           | Avenue | Avenue | –      | –       | –       |
 * | Highway          | Hwy    | Hwy    | Hwy    | –       | Hwy     |
 * | Ramp             | Ramp   | Ramp   | Ramp   | –       | –       |
 */
export function dragResult(toolKind: RoadKind | number, current: RoadKind | number): RoadKind | null {
  if (toolKind === current) return null;
  switch (toolKind) {
    case RoadKind.Street:
      return current === RoadKind.Alley ? RoadKind.Street : null;
    case RoadKind.Avenue:
      return current === RoadKind.Alley || current === RoadKind.Street ? RoadKind.Avenue : null;
    case RoadKind.Highway:
      return RoadKind.Highway;
    case RoadKind.Ramp:
      return current === RoadKind.Alley || current === RoadKind.Street || current === RoadKind.Avenue ? RoadKind.Ramp : null;
    default:
      return null;
  }
}

/** kinds[i] = the road kind of tile i, or KIND_NONE where there is no ground road. */
export function fillKinds(world: World, out: Uint8Array): Uint8Array {
  const tiles = world.tiles;
  const area = world.area;
  for (let i = 0; i < area; i++) {
    const t = tiles[i];
    out[i] = t.road ? t.roadKind : KIND_NONE;
  }
  return out;
}

/**
 * The access rule (§3.3), the only implementation. Writes `dist` (Chebyshev
 * steps to the claiming road, 255 = no access) and `near` (that road's tile
 * index, −1 = none) for a world of side `N` (every array holds N² entries; MEGACITY
 * §3.1: the frame is per world). `queue` is scratch (Int32Array(N²)).
 *
 * Pass A (range ROAD_ACCESS_RANGE): seed every Avenue, then every Ramp, then
 * every Street tile (each group in ascending index) at dist 0; multi-source
 * 8-neighbour BFS, first claim wins, no expansion past the range. Highways are
 * never seeds. Pass B (alleys fill gaps only): each Alley tile (ascending)
 * claims itself and its unclaimed 8-neighbours at dist 0 / 1.
 *
 * With streets only, `near` is exactly the pre-expansion SimGrid result.
 */
export function computeAccess(kinds: Uint8Array, dist: Uint8Array, near: Int32Array, queue: Int32Array, N: number): void {
  const RANGE = ROAD_ACCESS_RANGE;
  const AREA = N * N;
  dist.fill(255);
  near.fill(-1);
  let head = 0;
  let tail = 0;
  const seed = (k: number) => {
    for (let i = 0; i < AREA; i++) {
      if (kinds[i] === k) {
        dist[i] = 0;
        near[i] = i;
        queue[tail++] = i;
      }
    }
  };
  seed(RoadKind.Avenue);
  seed(RoadKind.Ramp);
  seed(RoadKind.Street);
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= RANGE) continue;
    const x = i % N;
    const y = (i / N) | 0;
    const src = near[i];
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= N) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= N || (dx === 0 && dy === 0)) continue;
        const j = ny * N + nx;
        if (dist[j] !== 255) continue;
        dist[j] = d + 1;
        near[j] = src;
        queue[tail++] = j;
      }
    }
  }
  // Pass B: alleys reach 1 tile and only where nothing else does.
  for (let a = 0; a < AREA; a++) {
    if (kinds[a] !== RoadKind.Alley) continue;
    if (dist[a] === 255) {
      dist[a] = 0;
      near[a] = a;
    }
    const x = a % N;
    const y = (a / N) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= N) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= N || (dx === 0 && dy === 0)) continue;
        const j = ny * N + nx;
        if (dist[j] === 255) {
          dist[j] = 1;
          near[j] = a;
        }
      }
    }
  }
}

// ── Lost access (highway drags, §3.4) ───────────────────────────────────────

/** Scratch marks with a generation stamp (no clearing, no allocation per call), one set per frame size. */
const stamps = scratchFor((area) => ({ conv: new Uint32Array(area), seen: new Uint32Array(area), gen: 0 }));
const bldSeen = new Set<number>();

type Stamps = ReturnType<typeof stamps>;

function nextGen(st: Stamps): number {
  st.gen = (st.gen + 1) >>> 0;
  if (st.gen === 0) {
    st.conv.fill(0);
    st.seen.fill(0);
    st.gen = 1;
  }
  return st.gen;
}

/**
 * Local access test with the stamped tiles read as Highway (`g` = the current
 * stamp, or 0 to read the map as it is). The same rule as World.hasRoadAccess.
 */
function accessAt(world: World, x: number, y: number, g: number, convStamp: Uint32Array): boolean {
  const tiles = world.tiles;
  const N = world.N;
  const R = ROAD_ACCESS_RANGE;
  const x0 = x - R < 0 ? 0 : x - R;
  const x1 = x + R >= N ? N - 1 : x + R;
  const y0 = y - R < 0 ? 0 : y - R;
  const y1 = y + R >= N ? N - 1 : y + R;
  for (let yy = y0; yy <= y1; yy++) {
    const dy = yy > y ? yy - y : y - yy;
    for (let xx = x0; xx <= x1; xx++) {
      const j = yy * N + xx;
      const t = tiles[j];
      if (!t.road) continue;
      const k = g !== 0 && convStamp[j] === g ? RoadKind.Highway : t.roadKind;
      const r = accessRange(k);
      if (r <= 0) continue;
      const dx = xx > x ? xx - x : x - xx;
      if ((dx > dy ? dx : dy) <= r) return true;
    }
  }
  return false;
}

/**
 * Developed zone tiles (level ≥ 1, not abandoned) and `needsRoad` buildings within
 * Chebyshev ROAD_ACCESS_RANGE of a `converted` tile (indices of tiles a highway drag
 * turns into Highway) that have road access now and would not with those tiles read
 * as Highway. Returns lots + buildings (a building counts once) and fills `out`
 * (cleared first) with the lots' tile indices and every footprint tile of a lost
 * building. Pure: never mutates the world.
 */
export function lostAccess(world: World, converted: readonly number[], out: number[]): number {
  out.length = 0;
  if (!converted.length) return 0;
  const N = world.N;
  const AREA = world.area;
  const st = stamps(AREA);
  const { conv: convStamp, seen: seenStamp } = st;
  const g = nextGen(st);
  for (const i of converted) if (i >= 0 && i < AREA) convStamp[i] = g;
  const tiles = world.tiles;
  const R = ROAD_ACCESS_RANGE;
  let lost = 0;
  bldSeen.clear();
  for (const c of converted) {
    if (c < 0 || c >= AREA) continue;
    const cx = c % N;
    const cy = (c / N) | 0;
    for (let y = Math.max(0, cy - R); y <= Math.min(N - 1, cy + R); y++)
      for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) {
        const j = y * N + x;
        if (seenStamp[j] === g) continue;
        seenStamp[j] = g;
        const t = tiles[j];
        if (t.buildingId >= 0) {
          bldSeen.add(t.buildingId);
          continue;
        }
        if (t.zone === ZoneType.None || t.level < 1 || t.abandoned || t.road) continue;
        if (accessAt(world, x, y, 0, convStamp) && !accessAt(world, x, y, g, convStamp)) {
          lost++;
          out.push(j);
        }
      }
  }
  for (const id of bldSeen) {
    const b = world.buildings.get(id);
    if (!b || !BUILDINGS[b.type]?.needsRoad) continue;
    let before = false;
    let after = false;
    for (let dy = 0; dy < b.size && !after; dy++)
      for (let dx = 0; dx < b.size; dx++) {
        const x = b.x + dx;
        const y = b.y + dy;
        if (!world.inBounds(x, y)) continue;
        if (!before && accessAt(world, x, y, 0, convStamp)) before = true;
        if (accessAt(world, x, y, g, convStamp)) {
          after = true;
          break;
        }
      }
    if (before && !after) {
      lost++;
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) if (world.inBounds(b.x + dx, b.y + dy)) out.push((b.y + dy) * N + b.x + dx);
    }
  }
  return lost;
}

/** True where Alley and Ramp may not sit (they are written as Street there, §2.1). */
export function landOnly(k: RoadKind | number): boolean {
  return k === RoadKind.Alley || k === RoadKind.Ramp;
}

/** The kind a road of kind `k` must be stored as on this terrain (Alley / Ramp on water → Street; bad values → Street). */
export function storedKind(k: number, terrain: Terrain): RoadKind {
  if (!(k >= 0 && k <= 4) || (k | 0) !== k) return RoadKind.Street;
  if (terrain === Terrain.Water && landOnly(k)) return RoadKind.Street;
  return k as RoadKind;
}
