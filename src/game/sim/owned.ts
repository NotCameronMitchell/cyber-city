// ─────────────────────────────────────────────────────────────────────────────
// The owned frame of a world, as the sim's loops walk it (docs/MEGACITY.md
// §3.3, O1). A locked tile is out of bounds for every loop and stencil: loops
// visit owned 64-tile chunks (one per owned slot per row, in index order), and
// each chunk carries which of its four sides open onto owned land, so a
// stencil treats a locked neighbour exactly like today's map edge. A v3 city
// in the start slot therefore computes what it computed on the 64 map.
//
// Sleep (O8): a second chunk list holds only the chunks of slots that run this
// field cycle; its side flags also say whether the owned neighbour across a
// side runs (a stencil reads a resting neighbour's last values, never scratch).
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../world';

/** Chunk side flags: the 4-neighbour across that side is owned. */
export const C_L = 1;
export const C_R = 2;
export const C_U = 4;
export const C_D = 8;
/** …and runs this cycle (only differs from the owned flags in an active list with resting slots). */
export const C_LA = 16;
export const C_RA = 32;
export const C_UA = 64;
export const C_DA = 128;

/** A list of row chunks: triples [start, end, flags] in index order, with the first triple of each row. */
export class ChunkList {
  /** [start, end) tile index and side flags, 3 ints per chunk. */
  ck: Int32Array;
  /** rowAt[y] = index (in ints) of row y's first triple; rowAt[N] = the end. */
  readonly rowAt: Int32Array;
  /** Number of chunks. */
  count = 0;
  constructor(N: number, R: number) {
    this.ck = new Int32Array(N * R * 3);
    this.rowAt = new Int32Array(N + 1);
  }
}

/**
 * Fill `out` with the chunks of the slots where `own[s] && act[s]`. Side flags: owned (C_L…) from `own`, running
 * (C_LA…) from `own && act`.
 */
export function buildChunks(N: number, R: number, own: Uint8Array, act: Uint8Array | null, out: ChunkList): void {
  const ck = out.ck;
  const rowAt = out.rowAt;
  let n = 0;
  for (let y = 0; y < N; y++) {
    rowAt[y] = n;
    const sy = y >> 6;
    const ly = y & 63;
    const base = y * N;
    for (let sx = 0; sx < R; sx++) {
      const s = sy * R + sx;
      if (!own[s] || (act && !act[s])) continue;
      const on = (t: number) => own[t] === 1;
      const run = (t: number) => own[t] === 1 && (!act || act[t] === 1);
      let f = 0;
      if (sx > 0 && on(s - 1)) f |= C_L | (run(s - 1) ? C_LA : 0);
      if (sx < R - 1 && on(s + 1)) f |= C_R | (run(s + 1) ? C_RA : 0);
      if (ly > 0) f |= C_U | C_UA;
      else if (sy > 0 && on(s - R)) f |= C_U | (run(s - R) ? C_UA : 0);
      if (ly < 63) f |= C_D | C_DA;
      else if (sy < R - 1 && on(s + R)) f |= C_D | (run(s + R) ? C_DA : 0);
      ck[n] = base + (sx << 6);
      ck[n + 1] = base + (sx << 6) + 64;
      ck[n + 2] = f;
      n += 3;
    }
  }
  rowAt[N] = n;
  out.count = n / 3;
}

/**
 * The owned frame: a per-tile mask, the owned chunk list and the owned rows. `sync(world)` rebuilds it when the world
 * annexed (slotsVersion); it is cheap (≤ 1,600 chunks and one mask fill).
 */
export class OwnedLayout {
  readonly N: number;
  readonly R: number;
  readonly area: number;
  /** 1 = the tile's slot is owned. */
  readonly mask: Uint8Array;
  /** Every owned chunk. */
  readonly all: ChunkList;
  /** Owned rows and columns (inclusive); y1 < y0 when nothing is owned. */
  y0 = 0;
  y1 = -1;
  x0 = 0;
  x1 = -1;
  /** world.slotsVersion this layout was built for (−1: never). */
  version = -1;
  /** world.slotOwned (live). */
  own: Uint8Array;

  constructor(world: Pick<World, 'N' | 'area' | 'region' | 'slotOwned'>) {
    this.N = world.N;
    this.R = world.region;
    this.area = world.area;
    this.mask = new Uint8Array(world.area);
    this.all = new ChunkList(world.N, world.region);
    this.own = world.slotOwned;
  }

  /** Rebuild when the owned slots changed. Returns true when it did. */
  sync(world: Pick<World, 'slotsVersion' | 'slotOwned'>): boolean {
    if (world.slotsVersion === this.version && world.slotOwned === this.own) return false;
    this.version = world.slotsVersion;
    this.own = world.slotOwned;
    const { N, R, mask } = this;
    buildChunks(N, R, this.own, null, this.all);
    mask.fill(0);
    let y0 = N;
    let y1 = -1;
    let x0 = N;
    let x1 = -1;
    for (let s = 0; s < R * R; s++) {
      if (!this.own[s]) continue;
      const sx = (s % R) << 6;
      const sy = ((s / R) | 0) << 6;
      for (let y = sy; y < sy + 64; y++) mask.fill(1, y * N + sx, y * N + sx + 64);
      if (sy < y0) y0 = sy;
      if (sy + 63 > y1) y1 = sy + 63;
      if (sx < x0) x0 = sx;
      if (sx + 63 > x1) x1 = sx + 63;
    }
    this.y0 = y0;
    this.y1 = y1;
    this.x0 = x0;
    this.x1 = x1;
    return true;
  }

  /** Slot of tile index i. */
  slotOf(i: number): number {
    const N = this.N;
    return (((i / N) | 0) >> 6) * this.R + ((i % N) >> 6);
  }
}

/** Rows [y0, y1) of a band, clipped to the owned rows. */
export interface Band {
  y0: number;
  y1: number;
}
