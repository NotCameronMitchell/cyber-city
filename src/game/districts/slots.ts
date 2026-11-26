// ─────────────────────────────────────────────────────────────────────────────
// District slots (docs/MEGACITY.md §3.1, §3.2). Frozen after Step 0b.
//
// A world is a region of R×R slots of SLOT×SLOT tiles (R = 3 or 5; 1 is the
// legacy 64×64 test frame). Slot id = sy * R + sx. The start slot is the
// centre one. Everything here takes the world or its region: there is no
// per-tile table.
// ─────────────────────────────────────────────────────────────────────────────

import { SLOT, startSlot, type FrameRegion, type SlotId } from '../types';

/** What the helpers read from a World (kept structural so tests can pass plain objects). */
export interface SlotFrame {
  readonly region: FrameRegion;
  readonly N: number;
  readonly slotOwned: Uint8Array;
}

/** Inclusive tile rect. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Index of the centre slot column / row. */
export const slotCentre = (region: FrameRegion): number => (region - 1) >> 1;

export function slotX(region: FrameRegion, s: SlotId): number {
  return s % region;
}
export function slotY(region: FrameRegion, s: SlotId): number {
  return (s / region) | 0;
}
export function slotId(region: FrameRegion, sx: number, sy: number): SlotId {
  return sx < 0 || sy < 0 || sx >= region || sy >= region ? -1 : sy * region + sx;
}
export function validSlot(region: FrameRegion, s: unknown): s is SlotId {
  return typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < region * region;
}

/** The slot's tile rect (inclusive). */
export function slotRect(world: Pick<SlotFrame, 'region'>, s: SlotId): TileRect {
  const x0 = slotX(world.region, s) * SLOT;
  const y0 = slotY(world.region, s) * SLOT;
  return { x0, y0, x1: x0 + SLOT - 1, y1: y0 + SLOT - 1 };
}

/** 4-adjacent slots, in N, E, S, W order (only those inside the region). */
export function slotNeighbours(region: FrameRegion, s: SlotId): SlotId[] {
  const sx = slotX(region, s);
  const sy = slotY(region, s);
  const out: SlotId[] = [];
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    const n = slotId(region, sx + dx, sy + dy);
    if (n >= 0) out.push(n);
  }
  return out;
}

/** The slot's offset from the start slot (dx, dy), each in −2..2. */
export function slotOffset(region: FrameRegion, s: SlotId): [dx: number, dy: number] {
  const c = slotCentre(region);
  return [slotX(region, s) - c, slotY(region, s) - c];
}

/** Chebyshev ring around the start slot: 0 the start, 1 the eight around it, 2 a 5×5 region's outer sixteen. */
export function ringOf(region: FrameRegion, s: SlotId): number {
  const [dx, dy] = slotOffset(region, s);
  return Math.max(Math.abs(dx), Math.abs(dy));
}

/**
 * The slot's offset from the start slot as `(dy + 2) * 5 + (dx + 2)`, 0..24: the same number for the same place
 * on both regions (12 is the start). Generator salts and annex content key on it (§3.2, §3.6.1).
 */
export function ringKey(region: FrameRegion, s: SlotId): number {
  const [dx, dy] = slotOffset(region, s);
  return (dy + 2) * 5 + (dx + 2);
}

/** Inverse of ringKey: the slot at that offset on this region, or −1 when the region has no such slot. */
export function slotAtRingKey(region: FrameRegion, key: number): SlotId {
  const c = slotCentre(region);
  return slotId(region, (key % 5) - 2 + c, ((key / 5) | 0) - 2 + c);
}

/** Locked slots 4-adjacent to an owned slot (the annex candidates, before `opensWhen`), ascending. */
export function adjacentLocked(world: Pick<SlotFrame, 'region' | 'slotOwned'>): SlotId[] {
  const R = world.region;
  const out: SlotId[] = [];
  for (let s = 0; s < R * R; s++) {
    if (world.slotOwned[s]) continue;
    if (slotNeighbours(R, s).some((n) => world.slotOwned[n])) out.push(s);
  }
  return out;
}

/** Owned-segment state a World keeps (MEGACITY §3.2): [start, end) index pairs, ascending. */
export interface SegmentFrame extends SlotFrame {
  segs: Int32Array;
  segCount: number;
  ownedBox: TileRect;
}

/**
 * Rebuild `segs` (owned row segments; owned slots side by side in a row merge into one) and `ownedBox`
 * (the tile rect of the owned slots, inclusive) from `slotOwned`.
 */
export function rebuildSegments(world: SegmentFrame): void {
  const R = world.region;
  const N = world.N;
  const segs = world.segs;
  let n = 0;
  let bx0 = N;
  let by0 = N;
  let bx1 = -1;
  let by1 = -1;
  for (let sy = 0; sy < R; sy++) {
    for (let r = 0; r < SLOT; r++) {
      const y = sy * SLOT + r;
      const row = y * N;
      let open = -1;
      for (let sx = 0; sx <= R; sx++) {
        const owned = sx < R && world.slotOwned[sy * R + sx] === 1;
        if (owned && open < 0) open = sx;
        if (!owned && open >= 0) {
          segs[n++] = row + open * SLOT;
          segs[n++] = row + sx * SLOT;
          open = -1;
        }
      }
    }
    for (let sx = 0; sx < R; sx++) {
      if (!world.slotOwned[sy * R + sx]) continue;
      bx0 = Math.min(bx0, sx * SLOT);
      by0 = Math.min(by0, sy * SLOT);
      bx1 = Math.max(bx1, sx * SLOT + SLOT - 1);
      by1 = Math.max(by1, sy * SLOT + SLOT - 1);
    }
  }
  world.segCount = n;
  world.ownedBox = bx1 < 0 ? { x0: 0, y0: 0, x1: -1, y1: -1 } : { x0: bx0, y0: by0, x1: bx1, y1: by1 };
}

/**
 * The art offset `o = 64 × (region − 1) / 2` (64 on a 3×3 region, 128 on a 5×5, 0 on the legacy frame): one global
 * offset, so art coordinates are continuous across slot borders and equal today's coordinates on the start slot of
 * either region. Render hashes, the terrain-value noise, ground hashes, `skylineLang` and the start slot's
 * neighbourhood names use art coordinates, so a migrated or grown city keeps its look (§3.2).
 */
export function artOffset(world: Pick<SlotFrame, 'region'>): number {
  return SLOT * slotCentre(world.region);
}

/** Art coordinates of a tile: (x − o, y − o). */
export function artXY(world: Pick<SlotFrame, 'region'>, x: number, y: number): { x: number; y: number } {
  const o = artOffset(world);
  return { x: x - o, y: y - o };
}

/** The start slot of a world's region. */
export function startSlotOf(world: Pick<SlotFrame, 'region'>): SlotId {
  return startSlot(world.region);
}
