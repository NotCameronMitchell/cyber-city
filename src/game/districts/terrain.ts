// ─────────────────────────────────────────────────────────────────────────────
// District terrain (docs/MEGACITY.md §3.6.1).
//
// The start generator (today's `generateTerrain`, moved here in slot-local
// coordinates, bit-identical to the 64×64 map for the same seed on either region,
// Step 0b), and the generators of the eight other kinds with their sixteen 5×5
// presets and border blending (WP-2). District generators use only exact
// arithmetic (rng.ts hashes and fbm, `sinP`), never Math.sin / cos / exp / pow
// (§3.6.1 rule 5).
// ─────────────────────────────────────────────────────────────────────────────

import { TERRAIN_SALT } from '../config';
import { Rng, fbm, hash2 } from '../rng';
import { Ground, SLOT, Terrain, type DistrictKind, type DistrictVariant, type FrameRegion, type SlotId, type Tile } from '../types';
import { ringKey, ringOf, slotNeighbours, slotOffset, slotX, slotY } from './slots';

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

// ── District generators (WP-2, §3.6.1, §3.7) ────────────────────────────────
//
// Each slot builds three per-tile arrays in slot-local coordinates:
//   pot   0..1 water potential (the kind's or preset's noise shape; higher = wetter),
//   force 0 none, 1 water, 2 land (canals, basins, sandbars, causeways, spits, river mouths),
//   elev  terrace steps (Highstep Terraces and its presets only).
// The tile is water when the blended value `w × p(k) + (1 − w) × own(k, d) > 0.5` (§3.6.1 step 3), where `own` is
// the potential scaled to 0..1 around a threshold `t` (forced tiles give 1 or 0) and `p(k)` the already generated
// neighbour's border tile smoothed over k ± 1. `t` is found by bisection so the slot's water share lands inside its
// kind's (preset's) range. Exact arithmetic only (hash2, fbm, sinP): the same land on every engine.

const S2 = SLOT * SLOT;
/** Scratch for one slot (§3.6.1: the noise field is computed once per slot and reused by the iterative rules). */
const pot = new Float32Array(S2);
const force = new Uint8Array(S2);
const elevS = new Uint8Array(S2);
const blendW = new Float32Array(S2);
const blendP = new Float32Array(S2);
const wet = new Uint8Array(S2);

const F_WATER = 1;
const F_LAND = 2;

/** Per-slot context the kind generators read. */
interface SlotCtx {
  /** Art-coordinate origin of the slot (slot origin − the art offset): noise is continuous and region-independent. */
  ax: number;
  ay: number;
  /** fbm seed: (seed % 10000) + 100 × ringKey, plus the salt's low bits. */
  ns: number;
  seed: number;
  rng: Rng;
  /** Unit vector from the start slot toward this slot (dx, dy). */
  dx: number;
  dy: number;
  /** Borders (0 N, 1 E, 2 S, 3 W) that face the start slot (the "shared border with the city"). */
  inward: number[];
  /** Borders that face away from the start slot. */
  outward: number[];
  /** River runs found on generated neighbours' borders: border, centre (local), width. */
  runs: { border: number; at: number; width: number }[];
}

/** 0 toward the city, 1 away from it, along the slot's outward direction. */
function outCoord(c: SlotCtx, x: number, y: number): number {
  const len = Math.abs(c.dx) + Math.abs(c.dy) || 1;
  return (((x - 31.5) * c.dx) / len + ((y - 31.5) * c.dy) / len) / 63 + 0.5;
}

/** Distance in tiles from the nearest border that faces the city (the hill rises away from it). */
function inwardDist(c: SlotCtx, x: number, y: number): number {
  let d = 64;
  for (const b of c.inward) d = Math.min(d, borderDist(b, x, y));
  return d;
}

function borderDist(b: number, x: number, y: number): number {
  return b === 0 ? y : b === 1 ? SLOT - 1 - x : b === 2 ? SLOT - 1 - y : x;
}

/** Noise in art coordinates (continuous across slots, the same on both regions). */
function noise(c: SlotCtx, x: number, y: number, freq: number, salt: number, oct = 4): number {
  return fbm((c.ax + x) * freq, (c.ay + y) * freq, c.ns + salt, oct);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Carve a meandering channel. `axis` 0: it runs along x (u = x, v = y); 1: along y. `v0` is the lateral centre at
 * u = 0 (the entry), `width` its width in tiles; the meander (sinP + fbm, as the start river) ramps in over 16 tiles
 * so a continued river mouth keeps its place on the border. `reverse` runs u from the far edge.
 */
function carve(c: SlotCtx, axis: number, v0: number, width: number, salt: number, amp = 6, reverse = false, u1 = SLOT): void {
  const phase = hash2(salt, 3, c.ns) * 6.283185307179586;
  const half = width / 2;
  for (let k = 0; k < u1; k++) {
    const u = reverse ? SLOT - 1 - k : k;
    const ramp = Math.min(1, k / 16);
    const centre = v0 + ramp * (sinP(k * 0.11 + phase) * amp + (fbm(k * 0.05, 9.1 + salt, c.ns + salt) - 0.5) * 10);
    const lo = Math.ceil(centre - half - 0.001);
    const hi = Math.max(lo, Math.floor(centre + half - 0.001));
    for (let v = lo; v <= hi; v++) {
      if (v < 0 || v >= SLOT) continue;
      const x = axis === 0 ? u : v;
      const y = axis === 0 ? v : u;
      force[y * SLOT + x] = F_WATER;
    }
  }
}

/** The local axis a channel entering through border b runs along, and whether it runs from the far edge. */
function axisOfBorder(b: number): { axis: number; reverse: boolean } {
  // North / south borders: the channel runs along y; east / west: along x.
  return { axis: b === 0 || b === 2 ? 1 : 0, reverse: b === 1 || b === 2 };
}

/** Continue the river mouths found on generated neighbours' borders (at most `max`, widest first). */
function continueRivers(c: SlotCtx, maxWidth: number, max: number): number {
  const runs = [...c.runs].sort((a, b) => b.width - a.width || a.border - b.border || a.at - b.at).slice(0, max);
  runs.forEach((r, i) => {
    const { axis, reverse } = axisOfBorder(r.border);
    carve(c, axis, r.at, Math.max(2, Math.min(maxWidth, r.width)), 40 + i, 6, reverse);
  });
  return runs.length;
}

/** Saltglass Shoals and its presets: islands from fbm, sandbars on a second field's contour, a spit and lagoon. */
function genShoals(c: SlotCtx, preset?: string): void {
  const freq = preset === 'isles' ? 0.035 : 0.06;
  const bar = preset === 'banks' ? 0.03 : preset === 'isles' ? 0.022 : 0.02;
  for (let y = 0; y < SLOT; y++)
    for (let x = 0; x < SLOT; x++) {
      const i = y * SLOT + x;
      const f = noise(c, x, y, freq, 0);
      // Water by default: land where the noise is high (islands). A slight pull toward land on the city side keeps
      // a shore to build from.
      pot[i] = clamp01(1 - f + (outCoord(c, x, y) - 0.5) * 0.12);
      // Sandbars: one-tile strips on the contours of two slow fields, joining islands into chains.
      const f2 = noise(c, x, y, 0.035, 500, 3);
      const f3 = noise(c, x, y, 0.035, 600, 3);
      if ((Math.abs(f2 - 0.5) < bar || Math.abs(f3 - 0.5) < bar) && f > 0.3) force[i] = F_LAND;
    }
  if (preset === 'strand') {
    // A 6–10-tile sand band along the outer edge, a lagoon behind it.
    for (let y = 0; y < SLOT; y++)
      for (let x = 0; x < SLOT; x++) {
        const i = y * SLOT + x;
        let d = 64;
        for (const b of c.outward) d = Math.min(d, borderDist(b, x, y));
        const band = 6 + Math.floor(noise(c, x, y, 0.08, 700, 2) * 5);
        force[i] = d < band ? F_LAND : 0;
        const o = outCoord(c, x, y);
        pot[i] = (d < band + 14 ? 0.9 : 0.25 + o * 0.6) + (noise(c, x, y, 0.06, 0) - 0.5) * 0.3;
      }
  }
}

/**
 * The Sunk: the old street grid flooded. Canals on every 8th local row and column (offset by a hash of the seed),
 * 2 tiles wide; 30% of the canal segments survive as land causeways, chosen by growing a tree of blocks from the
 * block nearest the city (so the wards that remain hang together and the slot stays buildable); 3–5 sunken plazas
 * (3×3 pools). More segments survive while the water would pass the kind's range.
 */
function genSunk(c: SlotCtx, hi: number): void {
  const off = Math.floor(hash2(7, 11, c.ns) * 8);
  const canal = (v: number) => (v + off) % 8 < 2;
  // Block index of a coordinate: blocks lie between canals; -1 on a canal line.
  const blk = (v: number) => (canal(v) ? -1 : Math.floor((v + off) / 8));
  const nb = Math.floor((SLOT - 1 + off) / 8) + 1; // blocks per axis (some partial at the edges)
  for (let i = 0; i < S2; i++) {
    const x = i % SLOT;
    const y = (i / SLOT) | 0;
    pot[i] = noise(c, x, y, 0.07, 0) * 0.4;
    if (canal(x) || canal(y)) force[i] = F_WATER;
  }
  // Segments: between block (bx, by) and its east / south neighbour.
  // A block cut by the slot edge holds less land: links into it come last.
  const full = (b: number) => b * 8 - off + 2 >= 0 && b * 8 - off + 7 < SLOT;
  const segs: { a: number; b: number; h: number }[] = [];
  for (let by = 0; by < nb; by++)
    for (let bx = 0; bx < nb; bx++) {
      const edge = full(bx) && full(by) ? 0 : 1;
      if (bx + 1 < nb) segs.push({ a: by * nb + bx, b: by * nb + bx + 1, h: hash2(bx * 2 + 1, by * 2, c.ns + 77) + edge + (full(bx + 1) ? 0 : 1) });
      if (by + 1 < nb) segs.push({ a: by * nb + bx, b: (by + 1) * nb + bx, h: hash2(bx * 2, by * 2 + 1, c.ns + 77) + edge + (full(by + 1) ? 0 : 1) });
    }
  const want = Math.round(segs.length * 0.3);
  // Root: the block nearest the city side.
  let root = 0;
  let best = Infinity;
  for (let by = 0; by < nb; by++)
    for (let bx = 0; bx < nb; bx++) {
      const o = outCoord(c, bx * 8 - off + 4, by * 8 - off + 4);
      const v = o + hash2(bx, by, c.ns + 5) * 0.01;
      if (v < best) {
        best = v;
        root = by * nb + bx;
      }
    }
  const inTree = new Uint8Array(nb * nb);
  inTree[root] = 1;
  const kept = new Uint8Array(segs.length);
  const keep = (k: number) => {
    kept[k] = 1;
    const sg = segs[k];
    const horiz = sg.b === sg.a + 1;
    const bx = sg.a % nb;
    const by = (sg.a / nb) | 0;
    // The canal between the two blocks: a vertical canal (2 columns) for an east link, else a horizontal one.
    const lo = (horiz ? bx + 1 : by + 1) * 8 - off; // first canal line
    const span0 = (horiz ? by : bx) * 8 - off + 2;
    for (let a = span0; a < span0 + 6; a++)
      for (let d = lo; d < lo + 2; d++) {
        const x = horiz ? d : a;
        const y = horiz ? a : d;
        if (x >= 0 && y >= 0 && x < SLOT && y < SLOT) force[y * SLOT + x] = F_LAND;
      }
  };
  let n = 0;
  // Grow the tree: always take the lowest-hash segment joining the tree to a new block.
  while (n < want) {
    let pick = -1;
    for (let k = 0; k < segs.length; k++) {
      if (kept[k]) continue;
      const sg = segs[k];
      if (inTree[sg.a] === inTree[sg.b]) continue;
      if (pick < 0 || sg.h < segs[pick].h) pick = k;
    }
    if (pick < 0) break;
    keep(pick);
    inTree[segs[pick].a] = 1;
    inTree[segs[pick].b] = 1;
    n++;
  }
  // 3–5 sunken plazas (3×3 pools) in the middle of land blocks.
  const plazas = 3 + Math.floor(hash2(13, 5, c.ns) * 3);
  for (let p = 0; p < plazas; p++) {
    const x0 = Math.floor(hash2(p, 21, c.ns) * 8) * 8 - off + 4;
    const y0 = Math.floor(hash2(p, 22, c.ns) * 8) * 8 - off + 4;
    for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) if (x >= 0 && y >= 0 && x < SLOT && y < SLOT && blk(x) >= 0 && blk(y) >= 0) force[y * SLOT + x] = F_WATER;
  }
  // Over the range: more causeways, lowest hash first, until the water (blended, non-forced as land) fits.
  const order = segs.map((_, k) => k).filter((k) => !kept[k]).sort((a, b) => segs[a].h - segs[b].h || a - b);
  for (const k of order) {
    if (minShare() <= hi - 0.012) break;
    keep(k);
  }
}

/** The slot's water share if every unforced tile were land (the blend applied): the lower bound the threshold can reach. */
function minShare(): number {
  let n = 0;
  for (let i = 0; i < S2; i++) {
    const own = force[i] === F_WATER ? 1 : 0;
    const w = blendW[i];
    if (w * blendP[i] + (1 - w) * own > 0.5) n++;
  }
  return n / S2;
}

/** While the lowest reachable share (forced water, blended) exceeds `share`, turn forced water to land in 8-tile runs, by hash order. */
function capForced(c: SlotCtx, share: number): void {
  if (minShare() <= share) return;
  const cand: number[] = [];
  for (let i = 0; i < S2; i++) if (force[i] === F_WATER) cand.push(i);
  cand.sort((a, b) => hash2(a >> 3, 1, c.ns) - hash2(b >> 3, 1, c.ns) || a - b);
  for (let k = 0; k < cand.length; k += 64) {
    for (let j = k; j < Math.min(cand.length, k + 64); j++) force[cand[j]] = F_LAND;
    if (minShare() <= share) return;
  }
}

/** Kessel Flats and its presets: almost all land, straight dock basins along the far edge, or a dry spur. */
function genFlats(c: SlotCtx, preset?: string): void {
  for (let i = 0; i < S2; i++) {
    const x = i % SLOT;
    const y = (i / SLOT) | 0;
    pot[i] = noise(c, x, y, 0.07, 0) * 0.7 + outCoord(c, x, y) * 0.3;
  }
  if (preset === 'spur') {
    continueRivers(c, 2, 1);
    return;
  }
  // The far edge: the outward border (a corner slot picks one of its two).
  const far = c.outward.length ? c.outward[c.rng.int(0, c.outward.length - 1)] : 2;
  const basins = preset === 'docks' ? [9, 23] : [9];
  for (const inset of basins) dockBasin(far, inset, c.rng.int(6, 10));
  continueRivers(c, 2, 1);
}

/**
 * A straight dock basin 4 tiles wide, parallel to border `far` at `inset` tiles from it, 46 tiles long, with a 4-wide
 * mouth to that edge at one end: ≥ 3 Seaport sites along its inner bank (the basin is ≥ 40 tiles straight).
 */
function dockBasin(far: number, inset: number, from: number): void {
  for (let a = from; a < from + 46; a++)
    for (let d = inset; d < inset + 4; d++) setByBorder(far, a, d, F_WATER);
  for (let a = from; a < from + 4; a++) for (let d = 0; d < inset; d++) setByBorder(far, a, d, F_WATER);
}

/** Write `force` at position `a` along border b and depth d from it. */
function setByBorder(b: number, a: number, d: number, v: number): void {
  if (a < 0 || a >= SLOT || d < 0 || d >= SLOT) return;
  const x = b === 0 || b === 2 ? a : b === 1 ? SLOT - 1 - d : d;
  const y = b === 0 ? d : b === 2 ? SLOT - 1 - d : a;
  force[y * SLOT + x] = v;
}

/** Highstep Terraces and its presets: steps rising away from the city, a stream. */
function genTerraces(c: SlotCtx, preset?: string): void {
  const mul = preset === 'steep' ? 8 : preset === 'gentle' ? 4 : 6;
  const ridgeAxis = c.rng.int(0, 1);
  for (let y = 0; y < SLOT; y++)
    for (let x = 0; x < SLOT; x++) {
      const i = y * SLOT + x;
      pot[i] = noise(c, x, y, 0.09, 300) * 0.8;
      const d = inwardDist(c, x, y);
      let f: number;
      if (preset === 'ridges') {
        const along = ridgeAxis === 0 ? x : y;
        const across = ridgeAxis === 0 ? y : x;
        f = fbm((along + (ridgeAxis === 0 ? c.ax : c.ay)) * 0.015, (across + (ridgeAxis === 0 ? c.ay : c.ax)) * 0.09, c.ns + 900, 3);
      } else f = noise(c, x, y, preset === 'gentle' ? 0.03 : 0.05, 900);
      let e = Math.floor((f - 0.3) * mul + d / 24);
      if (preset === 'steep') e = d < 4 ? 0 : Math.max(1, e);
      elevS[i] = e < 0 ? 0 : e > 3 ? 3 : e;
    }
  if (!continueRivers(c, 2, 1)) {
    // One stream across the slot, away from the city side.
    const axis = c.rng.int(0, 1);
    carve(c, axis, c.rng.int(20, 44), preset === 'gentle' ? 2 : 1.5, 60, 5);
  }
}

/** Reedmere Marsh and its presets: braided channels from the river (or the slot's edges), a wide mouth, fen channels. */
function genReedmere(c: SlotCtx, preset?: string): void {
  for (let i = 0; i < S2; i++) {
    const x = i % SLOT;
    const y = (i / SLOT) | 0;
    pot[i] = noise(c, x, y, 0.08, 0);
  }
  const run = c.runs.length ? [...c.runs].sort((a, b) => b.width - a.width)[0] : null;
  const { axis, reverse } = run ? axisOfBorder(run.border) : { axis: c.rng.int(0, 1), reverse: false };
  const v0 = run ? run.at : c.rng.int(24, 40);
  if (preset === 'mouth') {
    // One wide river mouth with reed islands: the channel widens from the entry to the far edge.
    const phase = hash2(5, 5, c.ns) * 6.28;
    for (let k = 0; k < SLOT; k++) {
      const u = reverse ? SLOT - 1 - k : k;
      const centre = v0 + ((v0 < 32 ? 14 : 50) - v0) * Math.min(1, k / 40) + Math.min(1, k / 16) * sinP(k * 0.07 + phase) * 4;
      const half = 2 + k * 0.16;
      for (let v = Math.ceil(centre - half); v <= Math.floor(centre + half); v++) {
        if (v < 0 || v >= SLOT) continue;
        const x = axis === 0 ? u : v;
        const y = axis === 0 ? v : u;
        const i = y * SLOT + x;
        force[i] = noise(c, x, y, 0.12, 600, 3) > 0.62 ? F_LAND : F_WATER;
      }
    }
    return;
  }
  const n = preset === 'fen' ? c.rng.int(5, 7) : c.rng.int(3, 5);
  const spread = preset === 'fen' ? 3.5 : 4.5;
  // The braids drift toward the nearer side of the slot as they cross it, so the far bank stays one wide piece.
  const drift = (v0 < 32 ? 12 : 52) - v0;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * spread;
    const width = preset === 'fen' ? 1 : 1 + (hash2(k, 9, c.ns) < 0.5 ? 0 : 1);
    carveBraid(c, axis, v0, off, width, 80 + k, reverse, drift);
  }
}

/** One braid of a marsh: leaves the entry, wanders `off` tiles to the side and drifts back (channels rejoin). */
function carveBraid(c: SlotCtx, axis: number, v0: number, off: number, width: number, salt: number, reverse: boolean, drift: number): void {
  const phase = hash2(salt, 3, c.ns) * 6.283185307179586;
  const half = width / 2 + 0.25;
  let prev = v0;
  for (let k = 0; k < SLOT; k++) {
    const u = reverse ? SLOT - 1 - k : k;
    const ramp = Math.min(1, k / 12);
    const centre =
      v0 + drift * Math.min(1, k / 40) + ramp * (off * (0.75 + 0.25 * sinP(k * 0.05 + phase)) + sinP(k * 0.13 + phase) * 2 + (fbm(k * 0.06, salt, c.ns + salt) - 0.5) * 4);
    // Fill between the previous and this centre so a steep wander stays one 4-connected channel.
    const a = Math.min(prev, centre) - half;
    const b = Math.max(prev, centre) + half;
    for (let v = Math.ceil(a); v <= Math.floor(b); v++) {
      if (v < 0 || v >= SLOT) continue;
      const x = axis === 0 ? u : v;
      const y = axis === 0 ? v : u;
      force[y * SLOT + x] = F_WATER;
    }
    prev = centre;
  }
}

/** Skeleton Row, Tarmac Reach, Verdigris Bazaar and their presets: mostly land with a canal, a shore or a lagoon. */
function genLand(c: SlotCtx, kind: DistrictKind, preset?: string): void {
  let lagoon = -1;
  let lx = 0;
  let ly = 0;
  if (kind === 'tarmac' && preset !== 'headland' && c.rng.chance(0.5)) {
    lagoon = 1;
    lx = c.rng.int(16, 48);
    ly = c.rng.int(16, 48);
  }
  for (let y = 0; y < SLOT; y++)
    for (let x = 0; x < SLOT; x++) {
      const i = y * SLOT + x;
      const n = noise(c, x, y, 0.07, 0);
      let p = n * 0.6;
      if (kind === 'tarmac') {
        if (preset === 'headland') {
          // A headland: water on the far side and both flanks near it.
          let far = 64;
          for (const b of c.outward) far = Math.min(far, borderDist(b, x, y));
          const o = outCoord(c, x, y);
          const lat = Math.abs(((c.dy !== 0 ? x : y) - 31.5) / 31.5);
          p = o * 0.8 + lat * o * 0.6 + n * 0.25 - (far > 24 ? 0.3 : 0);
        } else if (lagoon > 0) {
          const d = Math.sqrt((x - lx) * (x - lx) + (y - ly) * (y - ly)) / 16;
          p = 1 - d + n * 0.4;
        } else p = outCoord(c, x, y) * 0.8 + n * 0.3;
      }
      pot[i] = p;
    }
  const rivers = continueRivers(c, kind === 'tarmac' && preset === 'headland' ? 4 : 2, 1);
  if (kind === 'skeleton' && !rivers) carve(c, c.rng.int(0, 1), c.rng.int(14, 50), 2, 70, 3, false, c.rng.int(30, 64));
  if (kind === 'bazaar' && !rivers) carve(c, c.rng.int(0, 1), c.rng.int(18, 46), preset === 'canal' ? 3 : 2, 71, preset === 'canal' ? 9 : 6);
}

/** Collect water runs of 2–6 tiles (land on both sides) on the generated neighbours' borders facing this slot. */
function findRuns(tiles: Tile[], N: number, region: FrameRegion, slot: SlotId, ox: number, oy: number, out: SlotCtx['runs'], gen: Uint8Array): void {
  const sx = slotX(region, slot);
  const sy = slotY(region, slot);
  const dirs: [number, number, number][] = [
    [0, 0, -1],
    [1, 1, 0],
    [2, 0, 1],
    [3, -1, 0],
  ];
  for (const [b, ddx, ddy] of dirs) {
    const nx = sx + ddx;
    const ny = sy + ddy;
    if (nx < 0 || ny < 0 || nx >= region || ny >= region || !gen[ny * region + nx]) continue;
    // The neighbour's border line adjacent to this slot.
    const at = (a: number): boolean => {
      const x = b === 0 || b === 2 ? ox + a : b === 1 ? ox + SLOT : ox - 1;
      const y = b === 1 || b === 3 ? oy + a : b === 0 ? oy - 1 : oy + SLOT;
      return tiles[y * N + x].terrain === Terrain.Water;
    };
    let a = 0;
    while (a < SLOT) {
      if (!at(a)) {
        a++;
        continue;
      }
      let e = a;
      while (e < SLOT && at(e)) e++;
      const len = e - a;
      // A river mouth: bounded by land on both sides, away from the slot's corners.
      if (a > 2 && e < SLOT - 2 && len >= 2 && len <= 6) out.push({ border: b, at: (a + e - 1) / 2, width: len });
      a = e;
    }
  }
}

/**
 * Generate one non-start slot (§3.6.1, §3.7): its kind's generator with its variant's preset, blended against every
 * 4-neighbour generated before it in §3.6.1's order, thresholded so its water share is inside the kind's (preset's)
 * range. Deterministic from the seed and `ringKey` (salts) only, so a slot's land is the same on both regions and at
 * every load. Writes terrain, tile variant, elev (Terraces) and ground (Plain) into `tiles`.
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
  // Which neighbours come before this slot in the generation order (only those blend, §3.6.1 step 3).
  const order = generationOrder(region);
  const gen = new Uint8Array(region * region);
  for (const s of order) {
    if (s === slot) break;
    gen[s] = 1;
  }
  const inward: number[] = [];
  const outward: number[] = [];
  if (dy > 0) inward.push(0);
  if (dx < 0) inward.push(1);
  if (dy < 0) inward.push(2);
  if (dx > 0) inward.push(3);
  if (dy < 0) outward.push(0);
  if (dx > 0) outward.push(1);
  if (dy > 0) outward.push(2);
  if (dx < 0) outward.push(3);
  const len = Math.abs(dx) + Math.abs(dy) || 1;
  const c: SlotCtx = {
    ax: ox - o,
    ay: oy - o,
    ns: ((seed >>> 0) % 10000) + 100 * key + (salt & 1023),
    seed: seed >>> 0,
    rng: new Rng((seed ^ salt) >>> 0),
    dx: dx / len,
    dy: dy / len,
    inward,
    outward,
    runs: [],
  };
  pot.fill(0);
  force.fill(0);
  elevS.fill(0);
  findRuns(tiles, N, region, slot, ox, oy, c.runs, gen);
  // Border blending (§3.6.1 step 3): per tile the neighbour with the larger weight (corners take the larger of two).
  blendW.fill(0);
  blendP.fill(0);
  const sx = slotX(region, slot);
  const sy = slotY(region, slot);
  const nbr: [number, number, number][] = [
    [0, 0, -1],
    [1, 1, 0],
    [2, 0, 1],
    [3, -1, 0],
  ];
  for (const [b, ddx, ddy] of nbr) {
    const nx = sx + ddx;
    const ny = sy + ddy;
    if (nx < 0 || ny < 0 || nx >= region || ny >= region || !gen[ny * region + nx]) continue;
    const wetAt = (a: number): number => {
      const aa = a < 0 ? 0 : a >= SLOT ? SLOT - 1 : a;
      const x = b === 0 || b === 2 ? ox + aa : b === 1 ? ox + SLOT : ox - 1;
      const y = b === 1 || b === 3 ? oy + aa : b === 0 ? oy - 1 : oy + SLOT;
      return tiles[y * N + x].terrain === Terrain.Water ? 1 : 0;
    };
    for (let a = 0; a < SLOT; a++) {
      const p = (wetAt(a - 1) + wetAt(a) + wetAt(a + 1)) / 3;
      for (let d = 0; d < 6; d++) {
        const w = (6 - d) / 6;
        const x = b === 0 || b === 2 ? a : b === 1 ? SLOT - 1 - d : d;
        const y = b === 1 || b === 3 ? a : b === 0 ? d : SLOT - 1 - d;
        const i = y * SLOT + x;
        if (w > blendW[i]) {
          blendW[i] = w;
          blendP[i] = p;
        }
      }
    }
  }

  const [lo, hi] = waterRange(kind, variant, preset);
  switch (kind) {
    case 'shoals':
      genShoals(c, preset);
      break;
    case 'sunk':
      genSunk(c, hi);
      break;
    case 'flats':
      genFlats(c, preset);
      break;
    case 'terraces':
      genTerraces(c, preset);
      break;
    case 'reedmere':
      genReedmere(c, preset);
      break;
    default:
      genLand(c, kind, preset);
  }
  if (kind !== 'sunk') capForced(c, hi - 0.01);

  // Threshold by bisection so the share lands inside the range (aim: a hashed point in its middle 30%).
  const target = lo + (hi - lo) * (0.35 + 0.3 * hash2(key, 17, seed >>> 0));
  const shareAt = (t: number): number => {
    let n = 0;
    for (let i = 0; i < S2; i++) {
      const f = force[i];
      const own = f === F_WATER ? 1 : f === F_LAND ? 0 : clamp01(0.5 + (pot[i] - t) * 4);
      const w = blendW[i];
      const v = w * blendP[i] + (1 - w) * own;
      wet[i] = v > 0.5 ? 1 : 0;
      n += wet[i];
    }
    return n / S2;
  };
  // Bisection over the potential's own range (it is continuous: no flat plateau flips at once).
  let tLo = Infinity;
  let tHi = -Infinity;
  for (let i = 0; i < S2; i++) {
    if (pot[i] < tLo) tLo = pot[i];
    if (pot[i] > tHi) tHi = pot[i];
  }
  tLo -= 0.2;
  tHi += 0.2;
  for (let k = 0; k < 18; k++) {
    const t = (tLo + tHi) / 2;
    if (shareAt(t) > target) tLo = t;
    else tHi = t;
  }
  shareAt(tHi);

  // Terrace steps: cells of a step smaller than 3×3 merge into the lower step (§3.7); water is step 0.
  if (kind === 'terraces') {
    for (let i = 0; i < S2; i++) if (wet[i]) elevS[i] = 0;
    for (let e = 3; e >= 1; e--) mergeSmallSteps(e);
  }
  for (let y = 0; y < SLOT; y++)
    for (let x = 0; x < SLOT; x++) {
      const i = y * SLOT + x;
      const t = tiles[(oy + y) * N + ox + x];
      t.terrain = wet[i] ? Terrain.Water : Terrain.Land;
      t.variant = Math.floor(hash2(x + ox - o, y + oy - o, seed >>> 0) * 256);
      t.elev = wet[i] ? 0 : elevS[i];
      t.ground = Ground.Plain;
    }
}

/** Lower every tile of step ≥ e that no all-≥ e 3×3 window covers to e − 1. */
function mergeSmallSteps(e: number): void {
  const cover = new Uint8Array(S2);
  for (let y = 0; y + 2 < SLOT; y++)
    for (let x = 0; x + 2 < SLOT; x++) {
      let all = true;
      for (let k = 0; all && k < 9; k++) all = elevS[(y + ((k / 3) | 0)) * SLOT + x + (k % 3)] >= e;
      if (!all) continue;
      for (let k = 0; k < 9; k++) cover[(y + ((k / 3) | 0)) * SLOT + x + (k % 3)] = 1;
    }
  for (let i = 0; i < S2; i++) if (elevS[i] >= e && !cover[i]) elevS[i] = e - 1;
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
 * with its kind's generator, blended against the neighbours generated before it. `only` limits the output to those
 * slots (deserialize generates locked slots only): every slot an `only` slot blends against is generated too (its
 * tiles are overwritten by the save's blocks afterwards), so a locked slot regenerates identically at every load and
 * blends against *generated* land, never edited land.
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
  const order = generationOrder(region);
  const need = new Uint8Array(region * region);
  // Walk the order backwards: a needed slot needs its 4-neighbours that come before it.
  const pos = new Int32Array(region * region).fill(-1);
  order.forEach((s, k) => (pos[s] = k));
  for (let k = order.length - 1; k >= 0; k--) {
    const s = order[k];
    if (!only || only(s)) need[s] = 1;
    if (!need[s]) continue;
    for (const n of slotNeighbours(region, s)) if (pos[n] < k) need[n] = 1;
  }
  for (const s of order) {
    if (!need[s]) continue;
    if (ringOf(region, s) === 0) {
      generateStart(tiles, N, slotX(region, s) * SLOT, slotY(region, s) * SLOT, seed);
      continue;
    }
    const kind = kinds[s] ?? 'flats';
    const variant = variants[s] ?? 0;
    generateSlot(tiles, N, region, s, seed, kind, variant, presetOf(kind, variant));
  }
}
