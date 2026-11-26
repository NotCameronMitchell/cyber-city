// ─────────────────────────────────────────────────────────────────────────────
// Which district goes where (docs/MEGACITY.md §3.6.2). Frozen after Step 0b.
//
// Ring 1 (both regions) places each kind once around the start slot from the
// start map's bay side and river; ring 2 (5×5 only) fills the outer sixteen
// slots by quota, each taking its parent's kind where it can. Ring 2 is
// callable on its own (`assignRing2`) so `upgradeRegion` gives a grown city the
// ring 2 a native 5×5 city of the same seed has.
// ─────────────────────────────────────────────────────────────────────────────

import { Rng } from '../rng';
import { startSlot, type DistrictKind, type DistrictVariant, type FrameRegion, type SlotId } from '../types';
import { slotId } from './slots';
import { startParams } from './terrain';

export interface Layout {
  /** Length region², by SlotId; the start slot is 'shore'. */
  kinds: DistrictKind[];
  /** Length region², by SlotId: each slot's order among the slots of its kind (0 = the kind's own district). */
  variants: DistrictVariant[];
}

/** Direction (0 N, 1 E, 2 S, 3 W) → slot offset. */
const DIR: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
/** Ring-1 corners in §3.6.1 order: NW, NE, SW, SE. */
const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
/** Ring 2 in §3.6.1 order: straight-out N, E, S, W; off-axis clockwise from north; outer corners NW, NE, SW, SE. */
export const RING2_ORDER: readonly (readonly [number, number])[] = [
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
/** Ring-1 order (edges N, E, S, W, then corners NW, NE, SW, SE): the variant numbering walks it first. */
const RING1_ORDER: readonly (readonly [number, number])[] = [...DIR, ...CORNERS];

/** Ring-2 quotas on a 5×5 region (ring 1 already placed one of each non-start kind). */
export const RING2_QUOTA: Readonly<Record<Exclude<DistrictKind, 'shore' | 'sunk'>, number>> = {
  shoals: 3,
  terraces: 3,
  reedmere: 2,
  flats: 2,
  skeleton: 2,
  tarmac: 2,
  bazaar: 2,
};
/** The 24 non-start slots of a 5×5 region (§3.6.2): Sunk 1, Shoals 4, Terraces 4, the five others 3 each. */
export const REGION5_QUOTA: Readonly<Record<Exclude<DistrictKind, 'shore'>, number>> = {
  sunk: 1,
  shoals: 4,
  terraces: 4,
  reedmere: 3,
  flats: 3,
  skeleton: 3,
  tarmac: 3,
  bazaar: 3,
};

const at = (region: FrameRegion, dx: number, dy: number): SlotId => {
  const c = (region - 1) >> 1;
  return slotId(region, c + dx, c + dy);
};

/**
 * §3.6.2 for a region. `baySide` and `riverAxis` are the start map's (StartParams); `riverExits` the edges the river
 * crosses. The legacy 1×1 frame is just the start slot.
 */
export function assignKinds(seed: number, region: FrameRegion, baySide: number, riverAxis: number, riverExits: readonly number[]): Layout {
  const R = region;
  const kinds: (DistrictKind | null)[] = new Array(R * R).fill(null);
  kinds[startSlot(R)] = 'shore';
  if (R >= 3) assignRing1(seed, R, kinds, baySide, riverAxis, riverExits);
  if (R >= 5) assignRing2(seed, R, kinds);
  return { kinds: kinds.map((k) => k ?? 'flats'), variants: numberVariants(R, kinds as DistrictKind[]) };
}

/** The seed's own layout (the start map's bay and river read from the seed). */
export function seedLayout(seed: number, region: FrameRegion): Layout {
  const p = startParams(seed);
  return assignKinds(seed, region, p.side, p.riverAxis, p.riverExits);
}

function assignRing1(
  seed: number,
  R: FrameRegion,
  kinds: (DistrictKind | null)[],
  baySide: number,
  _riverAxis: number,
  riverExits: readonly number[],
): void {
  const rng = new Rng((seed ^ 0x6d454741) >>> 0);
  const edge = (dir: number): SlotId => at(R, DIR[dir][0], DIR[dir][1]);
  const free = (s: SlotId) => s >= 0 && kinds[s] === null;
  const cornersOf = (dir: number): SlotId[] => {
    const [ex, ey] = DIR[dir];
    // The two corners flanking an edge slot, in NW, NE, SW, SE order.
    return CORNERS.filter(([cx, cy]) => (ex !== 0 && cx === ex) || (ey !== 0 && cy === ey)).map(([cx, cy]) => at(R, cx, cy));
  };
  const pick = <T>(arr: T[]): T => arr[rng.int(0, arr.length - 1)];

  // 1. The edge slot across the bay → Saltglass Shoals.
  const shoals = edge(baySide);
  kinds[shoals] = 'shoals';
  // 2. One of the two corners flanking it → The Sunk.
  kinds[pick(cornersOf(baySide))] = 'sunk';
  // 3. The river-exit edge slot that is not the Shoals (rng if two) → Reedmere Marsh.
  const exits = riverExits.map(edge).filter((s) => s !== shoals && free(s));
  if (exits.length) kinds[exits.length > 1 ? pick(exits) : exits[0]] = 'reedmere';
  // 4. The edge slot opposite the bay, if free, else a free corner on that side → Highstep Terraces.
  const opp = (baySide + 2) % 4;
  if (free(edge(opp))) kinds[edge(opp)] = 'terraces';
  else {
    const c = cornersOf(opp).filter(free);
    if (c.length) kinds[c.length > 1 ? pick(c) : c[0]] = 'terraces';
  }
  // 5. A free slot touching the bay side if any, else any free slot → Kessel Flats.
  const ring1 = RING1_ORDER.map(([dx, dy]) => at(R, dx, dy));
  const baySideFree = [edge(baySide), ...cornersOf(baySide)].filter(free);
  const anyFree = ring1.filter(free);
  if (baySideFree.length) kinds[baySideFree.length > 1 ? pick(baySideFree) : baySideFree[0]] = 'flats';
  else if (anyFree.length) kinds[pick(anyFree)] = 'flats';
  // 6. The rest → Skeleton Row, Tarmac Reach, Verdigris Bazaar, shuffled (any kind ring 1 missed fills in first).
  const missing = (['shoals', 'sunk', 'reedmere', 'terraces', 'flats'] as DistrictKind[]).filter((k) => !kinds.includes(k));
  const rest: DistrictKind[] = [...missing, 'skeleton', 'tarmac', 'bazaar'];
  const tail = rest.slice(missing.length);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  const fill = [...rest.slice(0, missing.length), ...tail];
  for (const s of ring1) if (free(s)) kinds[s] = fill.shift() ?? 'skeleton';
}

/**
 * Ring 2 of a 5×5 region (§3.6.2), given ring 1 (`kinds` by SlotId, ring 2 entries null or ignored). Own Rng
 * `seed ^ 0x6d454742`, so ring 1 stays the 3×3 layout of the same seed. Writes ring 2 into `kinds` in place.
 */
export function assignRing2(seed: number, region: FrameRegion, kinds: (DistrictKind | null)[]): void {
  if (region < 5) return;
  const R = region;
  const rng = new Rng((seed ^ 0x6d454742) >>> 0);
  const quota: Record<string, number> = { ...RING2_QUOTA };
  for (const [dx, dy] of RING2_ORDER) kinds[at(R, dx, dy)] = null;
  for (const [dx, dy] of RING2_ORDER) {
    const s = at(R, dx, dy);
    // Parent: the ring-1 slot it shares an edge with, or for an outer corner the ring-1 corner diagonal to it.
    const px = Math.abs(dx) === 2 ? Math.sign(dx) : dx;
    const py = Math.abs(dy) === 2 ? Math.sign(dy) : dy;
    const parent = kinds[at(R, px, py)];
    const propose = parent === 'sunk' ? 'shoals' : parent;
    let k: string | null = propose && (quota[propose] ?? 0) > 0 ? propose : null;
    if (!k) {
      const sx = ((R - 1) >> 1) + dx;
      const sy = ((R - 1) >> 1) + dy;
      const near = new Set<string>();
      for (const [nx, ny] of DIR) {
        const n = slotId(R, sx + nx, sy + ny);
        const nk = n >= 0 ? kinds[n] : null;
        if (nk) near.add(nk);
      }
      k = mostLeft(quota, rng, (q) => !near.has(q)) ?? mostLeft(quota, rng, () => true);
    }
    if (!k) k = 'flats';
    kinds[s] = k as DistrictKind;
    quota[k] = Math.max(0, (quota[k] ?? 0) - 1);
  }
}

/** The kind with the most quota left among those passing `ok` (ties by rng), or null. */
function mostLeft(quota: Record<string, number>, rng: Rng, ok: (k: string) => boolean): string | null {
  let best = 0;
  let pool: string[] = [];
  for (const k of Object.keys(quota)) {
    const q = quota[k];
    if (q <= 0 || !ok(k)) continue;
    if (q > best) {
      best = q;
      pool = [k];
    } else if (q === best) pool.push(k);
  }
  if (!pool.length) return null;
  return pool.length === 1 ? pool[0] : pool[rng.int(0, pool.length - 1)];
}

/** Each slot's variant: its order among the slots of its kind, ring 1 first, then ring 2's order (§3.6.2). */
export function numberVariants(region: FrameRegion, kinds: readonly DistrictKind[]): DistrictVariant[] {
  const out: DistrictVariant[] = new Array(region * region).fill(0);
  const seen: Record<string, number> = {};
  const walk = [...RING1_ORDER, ...RING2_ORDER];
  for (const [dx, dy] of walk) {
    const s = at(region, dx, dy);
    if (s < 0) continue;
    const k = kinds[s];
    const n = seen[k] ?? 0;
    out[s] = Math.min(3, n) as DistrictVariant;
    seen[k] = n + 1;
  }
  return out;
}

/** The 5×5 terrain preset of a slot's kind and variant (variant 0 = the kind's own generator, no preset). */
export function presetOf(variants: readonly { terrain: string }[] | undefined, variant: DistrictVariant): string | undefined {
  return variant > 0 ? variants?.[variant - 1]?.terrain : undefined;
}
