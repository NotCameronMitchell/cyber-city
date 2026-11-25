// ─────────────────────────────────────────────────────────────────────────────
// Ground layer: terrain, water, zoned lots, building pads, roads and bridges.
//
// Everything on (or just below) the ground plane is static between edits, so
// it is painted once into chunk canvases and blitted every frame:
//
//  * Chunks are screen-aligned squares of CHUNK_PX device pixels at a
//    zoom-bucketed cache scale `s` (device px per world px, ladder 2^(k/4)).
//    Screen-aligned chunks waste no memory on the iso diamond's empty corners
//    and keep the cache cost per screen constant at any zoom.
//  * Tiles are painted in *tile space*: the canvas transform maps tile (u, v)
//    to world px, so a tile is the unit square and roads, markings, puddles and
//    light pools are plain rects / arcs that land correctly on the iso plane.
//  * Night is quantised into NIGHT_STEPS buckets and baked in; a stale chunk
//    keeps drawing until its re-render (time-budgeted per frame) lands.
//  * 'tiles' events mark a dirty world rect on affected chunks; those redraw
//    only the clipped dirty area, so sim growth stays cheap.
//  * A pinned whole-map "overview" bucket is the fallback for chunks that are
//    not ready yet (fast zooms), so the ground never pops to empty.
//  * The LRU cache is capped at ~24 MB (more only if the screen itself needs it).
//
// A small per-frame pass (`drawAnimated`) adds water shimmer and breathing
// street glow on top of the cached ground.
//
// Road kinds (docs/EXPANSION.md §3.11) are told apart by width and colour:
// Street 0.30 (amber centre dashes), Avenue 0.40 (blue edge lines, green
// median, cool lamps), Highway 0.46 (pale concrete by day / dark deck with
// sodium lamps by night, amber edge lines, barriers), Back Alley 0.16 (grimy,
// violet edge, wet sheen) and On-ramp 0.30 (white chevrons, gantry sign).
// Skyway decks leave a faint shadow strip on the ground (the drag target),
// active sky ramps paint a touchdown chevron, and four faint regional-road
// stubs mark border points where a road becomes a trade link (§3.10).
// ─────────────────────────────────────────────────────────────────────────────

import { ANNEX, BUILDINGS, EDGE_LINKS, ZONES } from '../game/config';
import { pumpHallSite, tarmacSites } from '../game/districts/annex';
import { slotNeighbours, slotRect, startSlotOf } from '../game/districts/slots';
import { shoreFacing } from '../game/ports';
import { fbm, hash2 } from '../game/rng';
import { skyRampGround } from '../game/skyway';
import { Ground, RoadKind, Terrain, ZoneType, type Building, type DistrictKind, type Tile } from '../game/types';
import type { World } from '../game/world';
import type { ArtEnv } from './buildings';
import { HALF_H, HALF_W } from './camera';
import { MATERIAL, NEON, css, glowSprite, hexToRgb, lit, mix, shade, type RGB } from './palette';
import { countPass } from './passes';

const TAU = Math.PI * 2;
const HP = Math.PI / 2;

/** World px measured perpendicular to a tile edge, per tile-space unit. */
const PERP = (2 * HALF_W * HALF_H) / Math.hypot(HALF_W, HALF_H);
/** Asphalt half-width of a road (tile units). Sidewalks fill the rest. */
export const ROAD_HALF = 0.3;
/** Asphalt half-width per RoadKind: Street, Avenue, Highway, Back Alley, On-ramp (§3.11). */
export const KIND_HALF: readonly number[] = [0.3, 0.4, 0.46, 0.16, 0.3];
/** Half-width of a road kind (unknown kinds read as Street). */
export function kindHalf(k: number): number {
  return KIND_HALF[k] ?? ROAD_HALF;
}
/** Bridge deck half-width of a kind: the asphalt plus 0.06 (a highway deck fills its tile). */
function deckHalf(k: number): number {
  return Math.min(0.5, kindHalf(k) + 0.06);
}
/** Avenue median half-width and lane dash offset; highway lane dash and edge line offsets (§3.11 lanes). */
const AV_MEDIAN = 0.03;
const AV_DASH = 0.195;
const HW_DASH = 0.26;
const HW_EDGE = 0.41;
/** How far water sits below the land (world px), as a tile-space diagonal offset. */
const WALL = 5 / (2 * HALF_H);
/** Max distance (world px) any tile's ground art reaches outside its diamond. */
const SPILL = 24;

/** Device px per chunk side, and padding that hides seams between chunks. */
const CHUNK_PX = 512;
const PAD = 2;
const CANVAS_PX = CHUNK_PX + PAD * 2;
const CHUNK_BYTES = CANVAS_PX * CANVAS_PX * 4;
const MEMORY_BUDGET = 24 * 1024 * 1024;
/** Chunk grid origin in world px, just outside the map's bounding box: x is per world (GroundCache.OX = −N·HALF_W − 32). */
const OY = -32;
/** Special bucket id: whole map at a tiny fixed scale, always kept. */
const OVERVIEW = -100;
const OVERVIEW_SCALE = 0.235;
const NIGHT_STEPS = 12;

/** Bit per direction, matching World.roadMask: N, E, S, W. */
const DIR = [1, 2, 4, 8];
const DX4 = [0, 1, 0, -1];
const DY4 = [-1, 0, 1, 0];
const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
/** Rotation (quarter turns from the canonical N+E corner) for 2-arm corner masks, else -1. */
const CORNER_K = [-1, -1, -1, 0, -1, -1, 1, -1, -1, 3, -1, -1, 2, -1, -1, -1];
/** Rotation for single-arm (dead end) masks: arm direction. */
const DEAD_K = [-1, 0, 1, -1, 2, -1, -1, -1, 3, -1, -1, -1, -1, -1, -1, -1];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GroundView {
  camX: number;
  camY: number;
  zoom: number;
  dpr: number;
  /** Viewport in CSS px. */
  width: number;
  height: number;
}

// ── Tile-space rotation helpers ────────────────────────────────────────────
// Road pieces are authored once for a canonical direction (arm pointing north,
// i.e. towards v = 0) and rotated by k quarter turns about the tile centre.
// Path helpers write into any CanvasPath (a context or a batched Path2D) and
// never call beginPath themselves.

function rx(k: number, p: number, q: number): number {
  return k === 0 ? p : k === 1 ? 1 - q : k === 2 ? 1 - p : q;
}
function ry(k: number, p: number, q: number): number {
  return k === 0 ? q : k === 1 ? p : k === 2 ? 1 - q : 1 - p;
}

/** Axis-aligned rect (p, q, w, h) in canonical tile space, rotated by k, offset to tile (x, y). */
function rrect(path: CanvasPath, x: number, y: number, k: number, p: number, q: number, w: number, h: number) {
  switch (k) {
    case 1:
      path.rect(x + 1 - q - h, y + p, h, w);
      break;
    case 2:
      path.rect(x + 1 - p - w, y + 1 - q - h, w, h);
      break;
    case 3:
      path.rect(x + q, y + 1 - p - w, h, w);
      break;
    default:
      path.rect(x + p, y + q, w, h);
  }
}

function circlePath(path: CanvasPath, cx: number, cy: number, r: number) {
  path.moveTo(cx + r, cy);
  path.arc(cx, cy, r, 0, TAU);
}

function ellipsePath(path: CanvasPath, cx: number, cy: number, rx_: number, ry_: number, rot: number) {
  path.moveTo(cx + Math.cos(rot) * rx_, cy + Math.sin(rot) * rx_);
  path.ellipse(cx, cy, rx_, ry_, rot, 0, TAU);
}

/** Line from canonical (p0, q0) to (p1, q1), rotated by k, offset to tile (x, y). */
function segLine(path: CanvasPath, x: number, y: number, k: number, p0: number, q0: number, p1: number, q1: number) {
  path.moveTo(x + rx(k, p0, q0), y + ry(k, p0, q0));
  path.lineTo(x + rx(k, p1, q1), y + ry(k, p1, q1));
}

/** Chevron pointing towards canonical north (arm k after rotation): apex at (0.5, q), wings `s` wide and deep. */
export function chevronPath(path: CanvasPath, x: number, y: number, k: number, q: number, s: number) {
  path.moveTo(x + rx(k, 0.5 - s, q + s * 0.85), y + ry(k, 0.5 - s, q + s * 0.85));
  path.lineTo(x + rx(k, 0.5, q), y + ry(k, 0.5, q));
  path.lineTo(x + rx(k, 0.5 + s, q + s * 0.85), y + ry(k, 0.5 + s, q + s * 0.85));
}

/**
 * Solid band parallel to the road centreline at offset `off` (tile units), `w` wide.
 * Straights run the full tile, corners follow the arc (radius 0.5 + off, so use
 * symmetric offset pairs), other shapes draw each arm up to `box` from the tile
 * edge (the junction box) or to the centre for a dead end.
 */
function bandPath(path: CanvasPath, x: number, y: number, mask: number, off: number, w: number, box: number) {
  const c = BITS[mask];
  if (c === 0) return;
  if (mask === 5 || mask === 10) {
    rrect(path, x, y, mask === 5 ? 0 : 1, 0.5 + off - w / 2, 0, w, 1);
    return;
  }
  const ck = CORNER_K[mask];
  if (ck >= 0) {
    const cx = x + rx(ck, 1, 0);
    const cy = y + ry(ck, 1, 0);
    const a0 = HP + ck * HP;
    const r0 = Math.max(0, 0.5 + off - w / 2);
    const r1 = 0.5 + off + w / 2;
    path.moveTo(cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1);
    path.arc(cx, cy, r1, a0, a0 + HP);
    path.arc(cx, cy, r0, a0 + HP, a0, true);
    path.closePath();
    return;
  }
  const len = c === 1 ? 0.5 : box;
  if (len <= 0.001) return;
  for (let k = 0; k < 4; k++) if (mask & DIR[k]) rrect(path, x, y, k, 0.5 + off - w / 2, 0, w, len);
}

/**
 * Paved area of a road tile with connectivity `mask` and half-width `h`.
 * Arms overshoot the tile edge by `ext` so neighbouring tiles overlap and no
 * anti-aliasing seam shows between them (use 0 for translucent fills).
 */
export function roadShapePath(path: CanvasPath, x: number, y: number, mask: number, h: number, ext = 0) {
  const a = 0.5 - h;
  const b = 0.5 + h;
  const c = BITS[mask];
  if (c === 0) {
    circlePath(path, x + 0.5, y + 0.5, Math.min(0.42, h + 0.06));
    return;
  }
  const ck = CORNER_K[mask];
  if (ck >= 0) {
    // Curved corner: quarter annulus around the corner shared by both arms.
    const cx = x + rx(ck, 1, 0);
    const cy = y + ry(ck, 1, 0);
    const a0 = HP + ck * HP;
    path.moveTo(cx + Math.cos(a0) * b, cy + Math.sin(a0) * b);
    path.arc(cx, cy, b, a0, a0 + HP);
    path.arc(cx, cy, a, a0 + HP, a0, true);
    path.closePath();
    if (ext > 0) for (let k = 0; k < 4; k++) if (mask & DIR[k]) rrect(path, x, y, k, a, -ext, 2 * h, ext * 2);
    return;
  }
  if (c === 1) circlePath(path, x + 0.5, y + 0.5, h);
  else path.rect(x + a, y + a, 2 * h, 2 * h);
  for (let k = 0; k < 4; k++) if (mask & DIR[k]) rrect(path, x, y, k, a, -ext, 2 * h, 0.5 + ext);
}

/** Visible edges (curbs / rails) of a road shape. */
export function roadOutlinePath(path: CanvasPath, x: number, y: number, mask: number, h: number) {
  const a = 0.5 - h;
  const b = 0.5 + h;
  const c = BITS[mask];
  if (c === 0) {
    circlePath(path, x + 0.5, y + 0.5, Math.min(0.42, h + 0.06));
    return;
  }
  const ck = CORNER_K[mask];
  if (ck >= 0) {
    const cx = x + rx(ck, 1, 0);
    const cy = y + ry(ck, 1, 0);
    const a0 = HP + ck * HP;
    path.moveTo(cx + Math.cos(a0) * b, cy + Math.sin(a0) * b);
    path.arc(cx, cy, b, a0, a0 + HP);
    path.moveTo(cx + Math.cos(a0) * a, cy + Math.sin(a0) * a);
    path.arc(cx, cy, a, a0, a0 + HP);
    return;
  }
  const line = (k: number, p0: number, q0: number, p1: number, q1: number) => {
    path.moveTo(x + rx(k, p0, q0), y + ry(k, p0, q0));
    path.lineTo(x + rx(k, p1, q1), y + ry(k, p1, q1));
  };
  if (mask === 5 || mask === 10) {
    const k = mask === 5 ? 0 : 1;
    line(k, a, 0, a, 1);
    line(k, b, 0, b, 1);
    return;
  }
  if (c === 1) {
    const k = DEAD_K[mask];
    path.moveTo(x + rx(k, b, 0), y + ry(k, b, 0));
    path.lineTo(x + rx(k, b, 0.5), y + ry(k, b, 0.5));
    path.arc(x + 0.5, y + 0.5, h, k * HP, Math.PI + k * HP);
    path.lineTo(x + rx(k, a, 0), y + ry(k, a, 0));
    return;
  }
  for (let k = 0; k < 4; k++) {
    if (mask & DIR[k]) {
      line(k, a, 0, a, a);
      line(k, b, 0, b, a);
    } else line(k, a, a, b, a);
  }
}

// ── Per-world static terrain info ──────────────────────────────────────────

/** Derived, immutable-per-world terrain data (terrain never changes after generation). */
export class TerrainInfo {
  /** 0..7 brightness / tint level of bare land. */
  readonly tone: Uint8Array;
  /** Water: 1..6 distance to land (1 = shoreline). Land: 0. */
  readonly depth: Uint8Array;
  /** Regional-road stubs (§3.10, art only, by seed hash): 0 = none, else 1 + the outward direction (0 N, 1 E, 2 S, 3 W). */
  readonly stub: Uint8Array;
  readonly seed: number;
  /** Art offset (MEGACITY §3.2 artXY): tile hashes use (x − o, y − o), so the start slot looks the same on either region. */
  readonly o: number;
  /**
   * Locked land (MEGACITY §3.9 fog): Chebyshev distance in tiles to the nearest owned tile, capped at 255; 0 on owned
   * land. The fog deepens past the peek margin (ANNEX.peek) so the edge of the city reads at any zoom.
   */
  readonly fogD: Uint8Array;
  /**
   * District ground decals (§3.9 district ground character), by tile: 0 none; DECO_RUNWAY / DECO_RUNWAY_END /
   * DECO_APRON on a Tarmac district's old runway strips and apron; DECO_HALL under the Sunk's old pump hall while
   * the Sunk is locked (a dark hall in the fog).
   */
  readonly deco: Uint8Array;

  constructor(world: World) {
    countPass('region:terrainInfo');
    const N = world.N;
    const o = (this.o = 64 * ((world.region - 1) >> 1));
    this.tone = new Uint8Array(world.area);
    this.depth = new Uint8Array(world.area);
    this.stub = new Uint8Array(world.area);
    this.seed = world.seed % 100000;
    const tiles = world.tiles;
    const queue: number[] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        // Large-scale variation + a patchwork of old 4×4 lots + per-tile noise.
        const v =
          fbm((x - o) * 0.09, (y - o) * 0.09, this.seed + 3, 3) * 0.62 +
          hash2((x - o) >> 2, (y - o) >> 2, this.seed + 9) * 0.12 +
          hash2(x - o, y - o, this.seed + 5) * 0.26;
        this.tone[i] = Math.max(0, Math.min(7, Math.floor(v * 8)));
        if (tiles[i].terrain !== Terrain.Water) continue;
        // The owned/locked border is a map edge for the water shading (MEGACITY §3.4, O1): owned water reads owned
        // land only, so a migrated bay keeps its open-sea depth along the slot edge.
        const own = world.isOwned(x, y);
        let shore = false;
        for (let dy = -1; dy <= 1 && !shore; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const t = world.tileAt(x + dx, y + dy);
            if (t && t.terrain === Terrain.Land && world.isOwned(x + dx, y + dy) === own) {
              shore = true;
              break;
            }
          }
        if (shore) {
          this.depth[i] = 1;
          queue.push(i);
        }
      }
    // BFS outwards through water for depth shading.
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const d = this.depth[i];
      if (d >= 6) continue;
      const x = i % N;
      const y = (i / N) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 1 ? 1 : k === 3 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 0 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || world.isOwned(nx, ny) !== world.isOwned(x, y)) continue;
        const j = ny * N + nx;
        if (tiles[j].terrain === Terrain.Water && this.depth[j] === 0) {
          this.depth[j] = d + 1;
          queue.push(j);
        }
      }
    }
    for (let i = 0; i < N * N; i++) if (tiles[i].terrain === Terrain.Water && this.depth[i] === 0) this.depth[i] = 6;
    this.fogD = new Uint8Array(world.area);
    this.deco = new Uint8Array(world.area);
    this.fogDistance(world);
    this.placeDeco(world);
    this.placeStubs(world);
  }

  /** Two-pass chamfer (Chebyshev) distance from owned land, once per frame of owned slots (an annex rebuilds it). */
  private fogDistance(world: World) {
    const N = world.N;
    const d = this.fogD;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d[y * N + x] = world.isOwned(x, y) ? 0 : 255;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        let v = d[i];
        if (!v) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
          v = Math.min(v, d[i - N] + 1);
          if (x > 0) v = Math.min(v, d[i - N - 1] + 1);
          if (x < N - 1) v = Math.min(v, d[i - N + 1] + 1);
        }
        d[i] = Math.min(255, v);
      }
    for (let y = N - 1; y >= 0; y--)
      for (let x = N - 1; x >= 0; x--) {
        const i = y * N + x;
        let v = d[i];
        if (!v) continue;
        if (x < N - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < N - 1) {
          v = Math.min(v, d[i + N] + 1);
          if (x < N - 1) v = Math.min(v, d[i + N + 1] + 1);
          if (x > 0) v = Math.min(v, d[i + N - 1] + 1);
        }
        d[i] = Math.min(255, v);
      }
  }

  /** Tarmac runways and aprons (owned or locked: the airfield shows in the fog too), the Sunk's hall while locked. */
  private placeDeco(world: World) {
    const N = world.N;
    const R = world.region;
    if (R === 1) return;
    for (let s = 0; s < R * R; s++) {
      const kind = world.districts.kinds[s];
      if (kind === 'tarmac') {
        const ts = tarmacSites(world, s);
        for (const r of ts.runways) {
          const alongX = r.x1 - r.x0 > r.y1 - r.y0;
          for (let y = r.y0; y <= r.y1; y++)
            for (let x = r.x0; x <= r.x1; x++) {
              const i = y * N + x;
              if (world.tiles[i].terrain !== Terrain.Land) continue;
              const a = alongX ? x - r.x0 : y - r.y0;
              const L = alongX ? r.x1 - r.x0 : r.y1 - r.y0;
              this.deco[i] = a < 3 || a > L - 3 ? DECO_RUNWAY_END : DECO_RUNWAY;
            }
        }
        const ap = ts.apron;
        if (ap)
          for (let y = ap.y0; y <= ap.y1; y++)
            for (let x = ap.x0; x <= ap.x1; x++) if (!this.deco[y * N + x] && world.tiles[y * N + x].terrain === Terrain.Land) this.deco[y * N + x] = DECO_APRON;
      } else if (kind === 'sunk' && !world.slotOwned[s]) {
        const h = pumpHallSite(world, s);
        if (h) for (let k = 0; k < 9; k++) this.deco[(h.y + ((k / 3) | 0)) * N + h.x + (k % 3)] = DECO_HALL;
      }
    }
  }

  /**
   * Pump House reclamation changed the terrain in `r` (the 'terrain' event): water depth and the shore flags around it
   * are recomputed locally (a depth never exceeds 6, so a 6-tile margin bounds what can change).
   */
  patch(world: World, r: { x0: number; y0: number; x1: number; y1: number }) {
    const N = world.N;
    const tiles = world.tiles;
    const m = 6;
    const x0 = Math.max(0, r.x0 - m);
    const y0 = Math.max(0, r.y0 - m);
    const x1 = Math.min(N - 1, r.x1 + m);
    const y1 = Math.min(N - 1, r.y1 + m);
    // Sources from a window one margin wider, so every path that ends inside [x0..x1] × [y0..y1] is seen.
    const wx0 = Math.max(0, x0 - m);
    const wy0 = Math.max(0, y0 - m);
    const wx1 = Math.min(N - 1, x1 + m);
    const wy1 = Math.min(N - 1, y1 + m);
    const W = wx1 - wx0 + 1;
    const H = wy1 - wy0 + 1;
    const dep = new Uint8Array(W * H);
    const queue: number[] = [];
    for (let y = wy0; y <= wy1; y++)
      for (let x = wx0; x <= wx1; x++) {
        if (tiles[y * N + x].terrain !== Terrain.Water) continue;
        const own = world.isOwned(x, y);
        let shore = false;
        for (let dy = -1; dy <= 1 && !shore; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const t = world.tileAt(x + dx, y + dy);
            if (t && t.terrain === Terrain.Land && world.isOwned(x + dx, y + dy) === own) {
              shore = true;
              break;
            }
          }
        if (shore) {
          dep[(y - wy0) * W + x - wx0] = 1;
          queue.push((y - wy0) * W + x - wx0);
        }
      }
    for (let qi = 0; qi < queue.length; qi++) {
      const j = queue[qi];
      const dv = dep[j];
      if (dv >= 6) continue;
      const lx = j % W;
      const ly = (j / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = lx + DX4[k];
        const ny = ly + DY4[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (world.isOwned(nx + wx0, ny + wy0) !== world.isOwned(lx + wx0, ly + wy0)) continue;
        const q = ny * W + nx;
        if (tiles[(ny + wy0) * N + nx + wx0].terrain === Terrain.Water && dep[q] === 0) {
          dep[q] = dv + 1;
          queue.push(q);
        }
      }
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * N + x;
        if (tiles[i].terrain !== Terrain.Water) this.depth[i] = 0;
        else this.depth[i] = dep[(y - wy0) * W + x - wx0] || 6;
      }
  }

  /**
   * Regional-road stubs (MEGACITY §3.5, art only, from the seed): each owned slot gets 2 on its outer boundary (the
   * sides that face the map edge or a locked slot), the start slot EDGE_LINKS.stubs (4) at today's hashed places, so a
   * one-district city shows the 64 map's four. Land tiles whose inward neighbour is land too; never stored in the save;
   * redrawn when the boundary moves (an annex rebuilds TerrainInfo).
   */
  private placeStubs(world: World) {
    const N = world.N;
    const R = world.region;
    const start = startSlotOf(world);
    const land = (x: number, y: number) => world.isOwned(x, y) && world.tileAt(x, y)?.terrain === Terrain.Land;
    for (const s of world.districts.owned) {
      const b = slotRect(world, s);
      // A side is outer when the slot beyond it is off the map or locked.
      const nb = slotNeighbours(R, s);
      const sx = s % R;
      const sy = (s / R) | 0;
      const beyond = (side: number) => {
        const tx = sx + DX4[side];
        const ty = sy + DY4[side];
        if (tx < 0 || ty < 0 || tx >= R || ty >= R) return -1;
        return nb.find((q) => q === ty * R + tx) ?? -1;
      };
      const outer = [0, 1, 2, 3].map((side) => {
        const q = beyond(side);
        return q < 0 || !world.slotOwned[q];
      });
      const want = s === start ? EDGE_LINKS.stubs : 2;
      // The start slot keeps today's hash keys (side, round); other slots salt them by slot.
      const salt = s === start ? 0 : 8 * (s + 1);
      const len = (side: number) => (side === 0 || side === 2 ? b.x1 - b.x0 + 1 : b.y1 - b.y0 + 1);
      const at = (side: number, p: number): [number, number] =>
        side === 0 ? [b.x0 + p, b.y0] : side === 1 ? [b.x1, b.y0 + p] : side === 2 ? [b.x0 + p, b.y1] : [b.x0, b.y0 + p];
      let placed = 0;
      for (let round = 0; round < 3 && placed < want; round++) {
        for (let side = 0; side < 4 && placed < want; side++) {
          if (!outer[side]) continue;
          const L = len(side);
          const p0 = 8 + Math.floor(hash2(side + salt, round, this.seed + 77) * (L - 16));
          for (let d = 0; d < L; d++) {
            const p = p0 + (d & 1 ? -((d + 1) >> 1) : d >> 1);
            if (p < 2 || p > L - 3) continue;
            const [x, y] = at(side, p);
            const i = y * N + x;
            // On the boundary: the tile beyond it is off the map or locked.
            if (this.stub[i] || !land(x, y) || !land(x - DX4[side], y - DY4[side]) || world.isOwned(x + DX4[side], y + DY4[side])) continue;
            // Keep stubs on one side apart.
            let near = false;
            for (let e = -6; e <= 6 && !near; e++) {
              const q = p + e;
              if (q < 0 || q >= L) continue;
              const [ax, ay] = at(side, q);
              if (this.stub[ay * N + ax]) near = true;
            }
            if (near) continue;
            this.stub[i] = side + 1;
            placed++;
            break;
          }
        }
      }
    }
  }
}

/** TerrainInfo.deco codes (district ground decals, §3.9). */
export const DECO_RUNWAY = 1;
export const DECO_RUNWAY_END = 2;
export const DECO_APRON = 3;
export const DECO_HALL = 4;

// ── Palette per night bucket ───────────────────────────────────────────────

const ZONE_RGB: Record<number, RGB> = {
  [ZoneType.None]: [128, 128, 128],
  [ZoneType.Residential]: hexToRgb(ZONES.res.color),
  [ZoneType.Commercial]: hexToRgb(ZONES.com.color),
  [ZoneType.Industrial]: hexToRgb(ZONES.ind.color),
};
const BUILDING_RGB = new Map<string, RGB>(Object.values(BUILDINGS).map((d) => [d.type, hexToRgb(d.color)]));

const WARM: RGB = [255, 196, 128];
const COOL: RGB = [150, 205, 255];
/** Signature colours of the road kinds and the skyway (ROAD_KINDS[k].color, SKYWAY.color). */
const AVENUE_RGB: RGB = [111, 155, 255];
const HIGHWAY_RGB: RGB = [255, 181, 71];
const ALLEY_RGB: RGB = [160, 124, 255];
const SKY_RGB: RGB = [255, 95, 210];
/** Avenue lamps (cool white) and highway sodium lamps (amber) in the night glow pass. */
const AV_LAMP: RGB = [200, 225, 255];
const SODIUM: RGB = [255, 168, 60];

/** Neon colour a lit tile casts onto wet ground / water, or null if dark. */
function lightColor(world: World, x: number, y: number): RGB | null {
  const t = world.tileAt(x, y);
  if (!t) return null;
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    return b ? BUILDING_RGB.get(b.type) ?? null : null;
  }
  if (t.zone !== ZoneType.None && t.level > 0 && !t.abandoned) return ZONE_RGB[t.zone];
  return null;
}

interface GroundPal {
  n: number;
  land: string[];
  landDark: string;
  landLight: string;
  grid: string;
  gridFar: string;
  gridMajor: string;
  slab: string;
  scrub: string;
  puddle: string;
  lot: string;
  pad: string;
  padAbandoned: string;
  bpad: string;
  bpadLine: string;
  asphalt: string[];
  patch: string;
  sidewalk: string;
  seam: string;
  curb: string;
  lane: string;
  edge: string;
  zebra: string;
  water: string[];
  ripple: string;
  waterShadow: string;
  wallFace: string;
  wallDark: string;
  lip: string;
  quay: string;
  deck: string;
  deckFace: string;
  deckAsphalt: string;
  rail: string;
  pillarA: string;
  pillarB: string;
  lamp: string;
  zoneTint: string[];
  zoneLine: string[];
  zoneRim: string[];
  zoneFar: string[];
  /** Gang turf colour wash, [owner][strength level 0..3] (docs/STORY.md §3.7). */
  turfWash: string[][];
  rubble: string;
  /** Shallow-water gradient bands: [fades towards +v, +u, -v, -u] (N, W, S, E shores). */
  shallow: HTMLCanvasElement[];
  /** Lazily filled per-building stripe colours. */
  stripes: Map<string, string>;
  gGlintC: string;
  gGlintM: string;
  // Additive glow colours (only used when n > 0).
  gGrid: string;
  gGridMajor: string;
  gLane: string;
  gCurb: string;
  gZebra: string;
  gShore: string;
  gRailA: string;
  gRailB: string;
  gZone: string[];
  gZoneCore: string[];
  // ── Road kinds (§3.11) ──
  avAsphalt: string;
  avEdge: string;
  avMedian: string;
  avPlanter: string;
  laneW: string;
  hwDeck: string;
  hwDeckBridge: string;
  hwDeckFace: string;
  hwVerge: string;
  hwEdge: string;
  barrier: string;
  barrierShade: string;
  hwLane: string;
  grime: string;
  grimeDark: string;
  alleyAsph: string;
  alleyEdge: string;
  sheen: string;
  dumpster: string;
  vent: string;
  chev: string;
  gantry: string;
  sign: string;
  signRim: string;
  skyShadow: string;
  touch: string;
  touchCore: string;
  stubAsph: string;
  stubLine: string;
  stubChev: string;
  gAvEdge: string;
  gHwEdge: string;
  gAlley: string;
  gChev: string;
  gTouch: string;
  // ── Port aprons and the academy courtyard ──
  quayConc: string;
  portLane: string;
  bollard: string;
  steel: string;
  sleeper: string;
  grass: string;
  runway: string;
  runwayLine: string;
  taxiLine: string;
  apron: string;
  runwayLamp: string;
  scorch: string;
  scorchDark: string;
  hazardY: string;
  hazardK: string;
  lawn: string;
  paving: string;
  gRunway: string;
  gPortLane: string;
  // ── Megacity (MEGACITY §3.9) ──
  /** Fog over locked land by band (0 inside the peek margin, 1 just past it, 2 far), land by tone, water by depth. */
  fogLand: string[][];
  fogWater: string[][];
  /** The Sunk's old pump hall in the fog: a dark hall on the water. */
  fogHall: string;
  fogHallRoof: string;
  /** District ground character: a wash over land, lots, pads and sidewalks per kind (none for Charter Shore). */
  kindWash: Partial<Record<DistrictKind, string>>;
  /** Terraces: contour light per step (index = elev), the contour line, retaining-wall face, its dark joints and lip. */
  elevLight: string[];
  contour: string;
  retWall: string;
  retJoint: string;
  retLip: string;
  stair: string;
  /** Building bases darken by step (index = elev). */
  elevBase: string[];
  /** Ground features: reeds, brownfield, rubble ground. */
  reedBase: string;
  reed: string;
  reedDark: string;
  brownBase: string;
  brownSheen: string;
  rubbleBase: string;
  rubbleLight: string;
  /** Shoals boardwalk timber, Sunk canal brick and mooring rings, Kessel rails, Skeleton cones, Bazaar lantern string. */
  board: string;
  boardGap: string;
  brick: string;
  ring: string;
  cone: string;
  lanternCord: string;
  lantern: string;
  /** Skyline view (zoom below streetMinZoom): roof tints per zone and palette, abandoned roofs, lit-window dots. */
  roofTint: string[][];
  roofAbandoned: string;
  roofWin: string;
  gRoofWin: string;
}

/** District washes by kind (§3.9 district ground character): pavement and land tints, low alpha. */
const KIND_WASH: Partial<Record<DistrictKind, RGB>> = {
  shoals: [236, 226, 196],
  sunk: [58, 100, 82],
  flats: [52, 44, 40],
  terraces: [200, 176, 138],
  reedmere: [86, 132, 70],
  skeleton: [158, 158, 164],
  tarmac: [60, 62, 74],
  bazaar: [118, 176, 142],
};
/** Wall colours of the zone bodies (art/zones.ts' RES / COM / IND walls), for the skyline view's roof tints. */
const ROOF_RGB: RGB[][] = [
  [],
  [[142, 116, 140], [150, 130, 128], [112, 126, 136], [128, 122, 142], [158, 150, 144]],
  [[98, 116, 140], [150, 154, 168], [84, 92, 112], [124, 136, 150]],
  [[128, 96, 76], [106, 108, 88], [146, 124, 76], [112, 114, 120]],
];

/** Four tiny gradient canvases (colour → transparent) used for shallow water along shores. */
function makeShallowBands(c: RGB, alpha: number): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let k = 0; k < 4; k++) {
    const cv = document.createElement('canvas');
    const horiz = k === 1 || k === 3;
    cv.width = horiz ? 32 : 1;
    cv.height = horiz ? 1 : 32;
    const g = cv.getContext('2d')!;
    const grad = horiz
      ? g.createLinearGradient(k === 1 ? 0 : 32, 0, k === 1 ? 32 : 0, 0)
      : g.createLinearGradient(0, k === 0 ? 0 : 32, 0, k === 0 ? 32 : 0);
    grad.addColorStop(0, css(c, alpha));
    grad.addColorStop(0.45, css(c, alpha * 0.35));
    grad.addColorStop(1, css(c, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, cv.width, cv.height);
    out.push(cv);
  }
  return out;
}

function buildPal(n: number): GroundPal {
  const day = 1 - n;
  const g0 = lit(MATERIAL.ground, n);
  const g1 = lit(MATERIAL.groundAlt, n);
  const lot = lit(MATERIAL.lot, n);
  const asph = lit(MATERIAL.asphalt, n);
  const conc = lit(MATERIAL.concrete, n);
  const wall = lit(MATERIAL.wall, n);
  const water = lit(MATERIAL.water, n);
  const shallow = mix(mix([32, 84, 100], [10, 28, 54], n), water, 0.2);
  const deep = mix(shade(water, 0.7), [16, 40, 60], 0.3 * (1 - n));
  const zoneList = [ZoneType.None, ZoneType.Residential, ZoneType.Commercial, ZoneType.Industrial];
  return {
    n,
    land: Array.from({ length: 8 }, (_, k) => css(shade(mix(g0, g1, k / 7), 0.87 + k * 0.037))),
    landDark: css(shade(g0, 0.62), 0.85),
    landLight: css(mix(g1, conc, 0.55), 0.75),
    grid: css(mix([12, 14, 24], [84, 70, 180], n), 0.15 + 0.05 * n),
    gridFar: css(mix([12, 14, 24], [92, 74, 200], n), 0.08 + 0.08 * n),
    gridMajor: css(mix([10, 12, 22], [108, 88, 230], n), 0.22 + 0.06 * n),
    slab: css(shade(mix(g1, conc, 0.3), 0.95)),
    scrub: css(mix([62, 78, 56], [20, 34, 34], n), 0.85),
    puddle: css(mix([118, 140, 150], [34, 20, 64], n), 0.6 + 0.2 * n),
    lot: css(lot),
    pad: css(shade(lot, 0.78)),
    padAbandoned: css(mix(shade(lot, 0.72), [70, 56, 40], 0.18)),
    bpad: css(shade(mix(conc, lot, 0.55), 0.82)),
    bpadLine: css(shade(conc, 0.6), 0.8),
    asphalt: [css(asph), css(shade(asph, 1.07)), css(shade(asph, 0.93))],
    patch: css(shade(asph, 0.8), 0.9),
    sidewalk: css(shade(conc, 0.8)),
    seam: css(shade(conc, 0.6), 0.6),
    curb: css(mix(conc, [255, 255, 255], 0.12 * day), 0.95),
    lane: css(mix([214, 192, 112], [255, 186, 84], n), 0.85),
    edge: css(mix([196, 198, 206], [110, 130, 200], n), 0.55),
    zebra: css(mix([206, 206, 212], [126, 136, 196], n), 0.7),
    water: Array.from({ length: 7 }, (_, d) => css(mix(mix(shallow, deep, 0.55), deep, Math.min(1, Math.max(0, (d - 2) / 4)) * 0.6))),
    ripple: css(mix([180, 225, 235], [70, 120, 200], n), 0.1 + 0.05 * n),
    waterShadow: css([0, 0, 8], 0.22 + 0.1 * n),
    wallFace: css(shade(wall, 0.92)),
    wallDark: css(shade(wall, 0.55)),
    lip: css(mix(conc, [255, 255, 255], 0.1)),
    quay: css(shade(conc, 0.92)),
    deck: css(shade(conc, 0.78)),
    deckFace: css(shade(wall, 0.62)),
    deckAsphalt: css(shade(asph, 1.12)),
    rail: css(mix(conc, [235, 240, 255], 0.25)),
    pillarA: css(shade(wall, 0.72)),
    pillarB: css(shade(wall, 0.5)),
    lamp: css(mix([210, 210, 200], [255, 244, 214], n)),
    zoneTint: zoneList.map((z) => css(ZONE_RGB[z], 0.14 * day + 0.07 * n)),
    // Empty-lot dashes stay legible but quiet over large zoned areas.
    zoneLine: zoneList.map((z) => css(mix(shade(ZONE_RGB[z], 0.8), ZONE_RGB[z], n), 0.42 + 0.12 * n)),
    zoneRim: zoneList.map((z) => css(ZONE_RGB[z], 0.22 + 0.1 * n)),
    zoneFar: zoneList.map((z) => css(ZONE_RGB[z], 0.2 + 0.12 * n)),
    turfWash: [
      [],
      [0, 1, 2, 3].map((l) => css(mix([150, 220, 40], [182, 255, 46], n), (0.05 + l * 0.04) * (0.8 + 0.5 * n))),
      [0, 1, 2, 3].map((l) => css(mix([170, 130, 230], [201, 162, 255], n), (0.05 + l * 0.04) * (0.8 + 0.5 * n))),
    ],
    stripes: new Map(),
    gGlintC: css(NEON.cyan, 0.8 * n),
    gGlintM: css(NEON.magenta, 0.8 * n),
    shallow: makeShallowBands(mix(mix([58, 132, 140], [18, 60, 96], n), shallow, 0.2), 0.55 + 0.1 * n),
    rubble: css(mix([96, 90, 84], [40, 36, 48], n), 0.9),
    gGrid: css(NEON.violet, 0.04 * n),
    gGridMajor: css(NEON.violet, 0.045 * n),
    gLane: css(NEON.amber, 0.13 * n),
    gCurb: css(NEON.cyan, 0.07 * n),
    gZebra: css(NEON.white, 0.08 * n),
    gShore: css(NEON.cyan, 0.2 * n),
    gRailA: css(NEON.cyan, 0.3 * n),
    gRailB: css(NEON.magenta, 0.3 * n),
    gZone: zoneList.map((z) => css(ZONE_RGB[z], 0.06 * n)),
    gZoneCore: zoneList.map((z) => css(ZONE_RGB[z], 0.2 * n)),
    avAsphalt: css(mix(shade(asph, 0.96), mix([30, 40, 72], [8, 10, 26], n), 0.18)),
    avEdge: css(AVENUE_RGB, 0.72 + 0.2 * n),
    avMedian: css(mix(shade(conc, 0.95), [40, 46, 70], n * 0.5)),
    avPlanter: css(mix([64, 142, 74], [40, 176, 104], n), 0.95),
    laneW: css(mix([224, 228, 236], [150, 162, 214], n), 0.85),
    hwDeck: css(mix([168, 170, 176], [34, 36, 50], n)),
    hwDeckBridge: css(mix([136, 138, 146], [26, 28, 40], n)),
    hwDeckFace: css(mix([72, 74, 84], [12, 12, 22], n)),
    hwVerge: css(mix([74, 78, 70], [16, 18, 26], n)),
    hwEdge: css(mix(HIGHWAY_RGB, [255, 168, 56], n), 0.92),
    barrier: css(mix([222, 222, 226], [96, 98, 118], n)),
    barrierShade: css(mix([120, 122, 132], [30, 30, 44], n)),
    hwLane: css(mix([244, 244, 248], [176, 182, 206], n), 0.9),
    grime: css(mix([54, 52, 60], [14, 12, 22], n)),
    grimeDark: css(mix([30, 28, 34], [6, 5, 12], n), 0.85),
    alleyAsph: css(mix([34, 30, 42], [8, 6, 16], n)),
    alleyEdge: css(ALLEY_RGB, 0.5 + 0.3 * n),
    sheen: css(mix([150, 160, 190], [110, 80, 190], n), 0.16 + 0.12 * n),
    dumpster: css(mix([42, 86, 64], [14, 28, 24], n)),
    vent: css(mix([112, 114, 122], [40, 40, 58], n)),
    chev: css(mix([250, 252, 255], [226, 234, 255], n), 0.95),
    gantry: css(mix([66, 68, 78], [24, 24, 34], n)),
    sign: css(mix([255, 176, 46], [255, 170, 60], n)),
    signRim: css(mix([248, 248, 252], [210, 214, 230], n)),
    skyShadow: css([4, 2, 14], 0.17 + 0.08 * n),
    touch: css(SKY_RGB, 0.85),
    touchCore: css([255, 236, 250], 0.9),
    stubAsph: css(shade(asph, 1.1), 0.42),
    stubLine: css(mix([200, 205, 225], [120, 140, 220], n), 0.5),
    stubChev: css(mix([255, 190, 80], [255, 180, 70], n), 0.62),
    gAvEdge: css(AVENUE_RGB, 0.24 * n),
    gHwEdge: css(NEON.amber, 0.26 * n),
    gAlley: css(ALLEY_RGB, 0.2 * n),
    gChev: css(NEON.white, 0.2 * n),
    gTouch: css(SKY_RGB, 0.35 * n),
    quayConc: css(mix(shade(conc, 1.02), [120, 124, 134], 0.2 * (1 - n))),
    portLane: css(mix([232, 200, 64], [255, 196, 70], n), 0.88),
    bollard: css(mix([40, 40, 46], [10, 10, 16], n)),
    steel: css(mix([170, 172, 182], [70, 74, 96], n)),
    sleeper: css(mix([86, 72, 60], [26, 22, 24], n)),
    grass: css(mix([70, 98, 62], [16, 30, 24], n)),
    runway: css(mix([50, 52, 60], [12, 12, 20], n)),
    runwayLine: css(mix([244, 244, 248], [186, 192, 214], n), 0.92),
    taxiLine: css(mix([240, 206, 60], [255, 200, 70], n), 0.9),
    apron: css(mix(shade(conc, 0.92), [52, 54, 70], n * 0.4)),
    runwayLamp: css(mix([236, 238, 246], [255, 236, 190], n)),
    scorch: css([18, 14, 16], 0.42 + 0.12 * n),
    scorchDark: css([8, 6, 8], 0.5),
    hazardY: css(mix([236, 196, 40], [255, 190, 50], n)),
    hazardK: css(mix([28, 28, 32], [8, 8, 12], n)),
    lawn: css(mix([78, 128, 70], [20, 48, 36], n)),
    paving: css(mix([150, 140, 126], [42, 38, 48], n)),
    gRunway: css([255, 244, 220], 0.4 * n),
    gPortLane: css(NEON.amber, 0.14 * n),
    ...megacityPal(n, g0, g1, shallow, deep, wall),
  };
}

/** The Megacity ground colours of one night bucket (fog, district character, terraces, roof tints; §3.9). */
function megacityPal(n: number, g0: RGB, g1: RGB, shallow: RGB, deep: RGB, wall: RGB) {
  const landRGB = (k: number) => shade(mix(g0, g1, k / 7), 0.87 + k * 0.037);
  const waterRGB = (d: number) => mix(mix(shallow, deep, 0.55), deep, Math.min(1, Math.max(0, (d - 2) / 4)) * 0.6);
  // §3.9's fog (terrain × 0.45 mixed 30% toward violet) reads as a void by day on a phone, so the day fog is a lighter
  // violet haze over a less darkened terrain (still well below owned land); night keeps the spec's numbers, with a
  // faint violet glow so the edge of the city reads after dark too.
  const fogC: RGB = mix([92, 78, 138], [52, 34, 92], n);
  const bands: [number, number][] = [
    [0.45 + 0.25 * (1 - n), 0.3 + 0.08 * (1 - n)],
    [0.4 + 0.2 * (1 - n), 0.42 + 0.06 * (1 - n)],
    [0.34 + 0.16 * (1 - n), 0.55],
  ];
  const fogOf = (c: RGB, b: number) => css(mix(shade(c, bands[b][0]), fogC, bands[b][1]));
  const day = 1 - n;
  const kindWash: Partial<Record<DistrictKind, string>> = {};
  for (const k of Object.keys(KIND_WASH) as DistrictKind[]) kindWash[k] = css(KIND_WASH[k]!, 0.13 * day + 0.06 * n);
  return {
    fogLand: [0, 1, 2].map((b) => Array.from({ length: 8 }, (_, k) => fogOf(landRGB(k), b))),
    fogWater: [0, 1, 2].map((b) => Array.from({ length: 7 }, (_, d) => fogOf(waterRGB(d), b))),
    fogHall: css(mix([22, 20, 28], [6, 6, 12], n)),
    fogHallRoof: css(mix([46, 44, 54], [16, 18, 26], n)),
    kindWash,
    elevLight: [0, 1, 2, 3].map((e) => css(mix([255, 246, 226], [150, 130, 230], n), (0.045 * day + 0.035 * n) * e)),
    contour: css(mix([40, 34, 30], [6, 4, 12], n), 0.55),
    retWall: css(mix([132, 120, 104], [34, 30, 40], n)),
    retJoint: css(mix([84, 76, 66], [16, 14, 22], n), 0.9),
    retLip: css(mix([196, 186, 166], [70, 64, 92], n), 0.9),
    stair: css(mix([214, 206, 188], [92, 86, 120], n), 0.85),
    elevBase: [0, 1, 2, 3].map((e) => css([0, 0, 0], 0.045 * e)),
    reedBase: css(mix([88, 104, 66], [22, 30, 24], n), 0.55),
    reed: css(mix([134, 150, 84], [40, 58, 40], n), 0.95),
    reedDark: css(mix([70, 86, 52], [16, 24, 18], n), 0.9),
    brownBase: css(mix([62, 48, 40], [16, 12, 14], n), 0.55),
    brownSheen: css(mix([96, 80, 120], [60, 30, 110], n), 0.35 + 0.15 * n),
    rubbleBase: css(mix([92, 88, 84], [30, 28, 36], n), 0.5),
    rubbleLight: css(mix([150, 146, 140], [56, 54, 66], n), 0.85),
    board: css(mix([132, 104, 74], [40, 30, 28], n)),
    boardGap: css(mix([82, 62, 44], [20, 14, 14], n), 0.9),
    brick: css(mix([104, 70, 58], [30, 20, 22], n)),
    ring: css(mix([60, 62, 70], [120, 140, 130], n), 0.9),
    cone: css(mix([255, 126, 40], [200, 90, 30], n)),
    lanternCord: css(mix([40, 34, 30], [20, 16, 18], n), 0.8),
    lantern: css(mix([230, 90, 60], [255, 150, 80], n)),
    roofTint: [0, 1, 2, 3].map((z) => (ROOF_RGB[z] ?? []).map((c) => css(shade(mix(c, wall, 0.25), 0.92 - 0.25 * n)))),
    roofAbandoned: css(mix([70, 64, 60], [20, 18, 22], n)),
    roofWin: css(mix([255, 226, 160], [255, 214, 140], n), 0.15 + 0.7 * n),
    gRoofWin: css([255, 210, 140], 0.5 * n),
  };
}

// ── Batching ───────────────────────────────────────────────────────────────

interface StrokeBatch {
  path: Path2D;
  color: string;
  width: number;
  cap: CanvasLineCap;
  dash: number[] | null;
}

/**
 * Collects geometry per style so a whole chunk layer costs one fill / stroke
 * per style instead of one call per primitive. Paths are built in tile space
 * and transformed by the context's matrix when flushed.
 */
class Batch {
  private fills = new Map<string, Path2D>();
  private strokes = new Map<string, StrokeBatch>();
  private images: [CanvasImageSource, number, number, number, number][] = [];

  /** Pre-insert styles so they flush in this order (fills flush in first-use order). */
  prime(colors: string[]) {
    for (const c of colors) this.f(c);
  }
  f(color: string): Path2D {
    let p = this.fills.get(color);
    if (!p) {
      p = new Path2D();
      this.fills.set(color, p);
    }
    return p;
  }
  s(color: string, width: number, cap: CanvasLineCap = 'butt', dash: number[] | null = null): Path2D {
    const key = `${color}|${width}|${cap}|${dash ? dash.join(',') : ''}`;
    let b = this.strokes.get(key);
    if (!b) {
      b = { path: new Path2D(), color, width, cap, dash };
      this.strokes.set(key, b);
    }
    return b.path;
  }
  image(img: CanvasImageSource, x: number, y: number, w: number, h: number) {
    this.images.push([img, x, y, w, h]);
  }
  /** Draw everything (images, then fills, then strokes) and reset. */
  flush(ctx: CanvasRenderingContext2D) {
    for (const [img, x, y, w, h] of this.images) ctx.drawImage(img, x, y, w, h);
    for (const [color, path] of this.fills) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    for (const b of this.strokes.values()) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width;
      ctx.lineCap = b.cap;
      ctx.setLineDash(b.dash ?? []);
      ctx.stroke(b.path);
    }
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    this.fills.clear();
    this.strokes.clear();
    this.images.length = 0;
  }
}

const LANE_DASH = [0.17, 0.12];

// ── Painter ────────────────────────────────────────────────────────────────

/**
 * Paints ground tiles into layered batches. `base()` / `glowTile()` queue
 * geometry; `flushBase()` / `flushGlow()` draw it. Expects the context
 * transform to map tile (u, v) to target pixels, except `glowWorld()` which
 * expects world px.
 */
export class GroundPainter {
  ctx!: CanvasRenderingContext2D;
  world!: World;
  info!: TerrainInfo;
  pal!: GroundPal;
  /** Tile units per device px (perpendicular to tile edges). */
  px = 0.02;
  /** Fine details: puddles, rubble, crosswalk stripes, lamp pools. */
  detail = true;
  /** Thin lines: grid, lane dashes, lot outlines, curbs. */
  lines = true;
  /** Extra-fine details for close zoom: edge lines, sidewalk seams. */
  fine = true;
  /** Empty-lot dashed outlines (fade out when zoomed far out). */
  lotLines = true;
  /**
   * Skyline view chunks (MEGACITY §3.9, zoom below streetMinZoom with more than one district): every developed zone
   * tile also gets a flat roof diamond in its body's wall colour, so the L1–L2 bodies the sweep skips (and L3 bodies
   * past the sprite cap) still read as blocks.
   */
  skyline = false;

  private palCache = new Map<number, GroundPal>();
  /** Layers: base fills → surface details → structures → markings; then glow. */
  private b0 = new Batch();
  private b1 = new Batch();
  private b2 = new Batch();
  private b3 = new Batch();
  /** Over everything else, after the bridges: skyway shadow strips, touchdown chevrons, regional stubs. */
  private b4 = new Batch();
  private gl = new Batch();
  private bridges: number[] = [];
  /** Side of the world being painted (its N, MEGACITY §3.1); set by begin(). */
  private N = 0;

  begin(ctx: CanvasRenderingContext2D, world: World, info: TerrainInfo, nightBucket: number, scale: number, skyline = false) {
    this.skyline = skyline;
    this.ctx = ctx;
    this.world = world;
    this.N = world.N;
    this.info = info;
    let pal = this.palCache.get(nightBucket);
    if (!pal) {
      pal = buildPal(nightBucket / NIGHT_STEPS);
      this.palCache.set(nightBucket, pal);
    }
    this.pal = pal;
    this.px = 1 / (scale * PERP);
    this.detail = scale >= 0.6;
    this.lines = scale >= 0.25;
    this.fine = scale >= 1.1;
    this.lotLines = scale >= 0.42;
    this.bridges.length = 0;
    const P = pal;
    this.b2.prime([P.hwDeck, P.avAsphalt, P.alleyAsph, ...P.asphalt, P.patch, P.wallFace, P.wallDark]);
    // The highway's ramp-gap cover (street asphalt) flushes before every marking.
    this.b3.prime([P.asphalt[1], P.grid, P.gridFar, P.gridMajor, P.quay, P.lip, P.edge, P.lane, P.zebra]);
    this.b4.prime([P.skyShadow, P.stubAsph]);
  }

  /** Release references to the world / context once a chunk is painted. */
  end() {
    this.world = null as unknown as World;
    this.ctx = null as unknown as CanvasRenderingContext2D;
  }

  /** Thickness in tile units for a line `d` device px wide (never thinner than ~0.7px). */
  lw(d: number): number {
    return Math.max(d, 0.7) * this.px;
  }

  private h(x: number, y: number, salt: number): number {
    return hash2(x - this.info.o, y - this.info.o, this.info.seed * 31 + salt);
  }

  /** Tile-filling rect, overshooting by ~half a device pixel so neighbours leave no AA seam. */
  private tileRect(path: Path2D, x: number, y: number) {
    const e = this.px * 0.6;
    path.rect(x - e, y - e, 1 + 2 * e, 1 + 2 * e);
  }

  private isWater(x: number, y: number): boolean {
    const t = this.world.tileAt(x, y);
    return !!t && t.terrain === Terrain.Water;
  }

  private isLand(x: number, y: number): boolean {
    const t = this.world.tileAt(x, y);
    return !!t && t.terrain === Terrain.Land;
  }

  // ── Base pass ─────────────────────────────────────────────────────────────

  base(x: number, y: number) {
    const { N } = this;
    const i = y * N + x;
    const t = this.world.tiles[i];
    if (!this.world.ownedAt(i)) {
      this.fog(x, y, t, i);
      return;
    }
    const sky = this.world.sky[i];
    if (t.terrain === Terrain.Water) {
      this.water(x, y);
      if (t.road) this.bridges.push(i);
      if (sky) this.skyShadow(x, y, sky, t);
      return;
    }
    if (t.road) this.road(x, y, t);
    else if (t.buildingId >= 0) this.buildingPad(x, y, t);
    else if (t.zone !== ZoneType.None) this.lot(x, y, t);
    else this.land(x, y);
    this.character(x, y, t, i);
    if (this.lines) this.quay(x, y);
    // Gang turf: a colour wash over the street, by strength (§3.7).
    const owner = this.world.turf.owner[i];
    if (owner === 1 || owner === 2) {
      const st = this.world.turf.str[i];
      this.b1.f(this.pal.turfWash[owner][st >= 75 ? 3 : st >= 50 ? 2 : st >= 25 ? 1 : 0]).rect(x, y, 1, 1);
    }
    if (sky) this.skyShadow(x, y, sky, t);
    const stub = this.info.stub[i];
    if (stub && !t.road && t.buildingId < 0 && (t.zone === ZoneType.None || t.level === 0)) this.stub(x, y, stub - 1);
  }

  /** Draw all queued base geometry, then bridges (which need strict per-tile order), then the top layer. */
  flushBase() {
    const { N } = this;
    const ctx = this.ctx;
    this.b0.flush(ctx);
    this.b1.flush(ctx);
    this.b2.flush(ctx);
    this.b3.flush(ctx);
    for (const i of this.bridges) this.bridge(i % N, (i / N) | 0);
    this.bridges.length = 0;
    this.b4.flush(ctx);
  }

  /**
   * Drawn link mask of a road tile: World.roadMask, plus an arm off the map for a dead
   * end on the map border that points inward (a regional road runs off the edge, §3.10).
   */
  private mask(x: number, y: number): number {
    const { N } = this;
    const m = this.world.roadMask(x, y);
    if (BITS[m] !== 1) return m;
    if (x === 0 && m === 2) return m | 8;
    if (x === N - 1 && m === 8) return m | 2;
    if (y === 0 && m === 4) return m | 1;
    if (y === N - 1 && m === 1) return m | 4;
    // The owned boundary is a map edge too (MEGACITY §3.5): a dead end pointing inward runs on into the fog.
    const w = this.world;
    if (m === 2 && !w.isOwned(x - 1, y)) return m | 8;
    if (m === 8 && !w.isOwned(x + 1, y)) return m | 2;
    if (m === 4 && !w.isOwned(x, y - 1)) return m | 1;
    if (m === 1 && !w.isOwned(x, y + 1)) return m | 4;
    return m;
  }

  /** Road kind of the 4-neighbour of (x, y) in direction d, or −1 when it is not a road. */
  private kindAt(x: number, y: number, d: number): number {
    const t = this.world.tileAt(x + DX4[d], y + DY4[d]);
    return t && t.road ? t.roadKind : -1;
  }

  /** Arms of `mask` whose neighbour is a Highway or off the map (the rest of a highway's arms are ramps). */
  private highwayArms(x: number, y: number, mask: number): number {
    let m = 0;
    for (let d = 0; d < 4; d++) {
      if (!(mask & DIR[d])) continue;
      if (this.kindAt(x, y, d) === RoadKind.Highway || !this.world.inBounds(x + DX4[d], y + DY4[d])) m |= DIR[d];
    }
    return m;
  }

  /**
   * Faint shadow strip (0.5 tile wide) under a skyway deck along its links, and the
   * touchdown chevron of an active ramp (§3.7, §3.11). Repainted through the normal
   * 'tiles' event that setSky / clearSky emit.
   */
  private skyShadow(x: number, y: number, sky: number, t: Tile) {
    const P = this.pal;
    const m = sky & 15;
    roadShapePath(this.b4.f(P.skyShadow), x, y, m, 0.25, 0);
    if (!(sky & 16) || !skyRampGround(t) || !this.lines) return;
    // Touchdown: chevrons on the street pointing along the deck's one link (the way up).
    const k = DEAD_K[m];
    if (k < 0) return;
    const w = this.lw(this.detail ? 2.2 : 1.6);
    const p = this.b4.s(P.touch, w * 1.8, 'round');
    chevronPath(p, x, y, k, 0.2, 0.17);
    chevronPath(p, x, y, k, 0.5, 0.17);
    if (this.detail) {
      const c = this.b4.s(P.touchCore, w * 0.7, 'round');
      chevronPath(c, x, y, k, 0.2, 0.17);
      chevronPath(c, x, y, k, 0.5, 0.17);
    }
  }

  /** A faint regional-road stub running off the map edge (direction `d`), with outward chevrons (§3.10). */
  private stub(x: number, y: number, d: number) {
    const P = this.pal;
    // Canonical arm `d` points at the map edge: asphalt from the edge to the centre, dashed edges.
    rrect(this.b4.f(P.stubAsph), x, y, d, 0.5 - ROAD_HALF, 0, ROAD_HALF * 2, 0.62);
    if (!this.lines) return;
    const th = this.lw(1);
    const dl = this.b4.f(P.stubLine);
    for (let k = 0; k < 3; k++) {
      rrect(dl, x, y, d, 0.5 - ROAD_HALF, 0.04 + k * 0.2, th, 0.1);
      rrect(dl, x, y, d, 0.5 + ROAD_HALF - th, 0.04 + k * 0.2, th, 0.1);
    }
    const c = this.b4.s(P.stubChev, this.lw(this.detail ? 2 : 1.4), 'round');
    chevronPath(c, x, y, d, 0.1, 0.14);
    chevronPath(c, x, y, d, 0.32, 0.14);
  }

  /** Is this tile bare land (no road, zone or building)? */
  private isBare(x: number, y: number): boolean {
    const t = this.world.tileAt(x, y);
    return !!t && t.terrain === Terrain.Land && !t.road && t.zone === ZoneType.None && t.buildingId < 0;
  }

  /** Old poured-concrete foundations occupy hashed 2×2 blocks of bare land. */
  private isSlab(x: number, y: number): boolean {
    return hash2((x - this.info.o) >> 1, (y - this.info.o) >> 1, this.info.seed * 31 + 120) < 0.16 && this.isBare(x, y);
  }

  private land(x: number, y: number) {
    const { N } = this;
    const P = this.pal;
    const slab = this.isSlab(x, y);
    this.tileRect(this.b0.f(slab ? P.slab : P.land[this.info.tone[y * N + x]]), x, y);
    if (slab && this.lines) {
      // Seams where the slab meets ordinary ground, plus faint bolt rows.
      const th = this.lw(1.2);
      const p = this.b1.f(P.landDark);
      if (!this.isSlab(x, y - 1)) p.rect(x, y, 1, th);
      if (!this.isSlab(x, y + 1)) p.rect(x, y + 1 - th, 1, th);
      if (!this.isSlab(x - 1, y)) p.rect(x, y, th, 1);
      if (!this.isSlab(x + 1, y)) p.rect(x + 1 - th, y, th, 1);
      if (this.fine) {
        const q = this.b1.f(P.landLight);
        const d = this.lw(1.6);
        for (let k = 0; k < 3; k++) q.rect(x + 0.2 + k * 0.3, y + 0.5, d, d);
      }
    }
    if (this.detail) {
      const h = this.h(x, y, 1);
      if (h < 0.07 && !slab) {
        // Rain puddle: two overlapping ellipses read as an irregular pool.
        const r = 0.1 + this.h(x, y, 4) * 0.12;
        const cx = x + 0.32 + this.h(x, y, 2) * 0.36;
        const cy = y + 0.32 + this.h(x, y, 3) * 0.36;
        const rot = this.h(x, y, 5) * Math.PI;
        const p = this.b1.f(P.puddle);
        ellipsePath(p, cx, cy, r * 1.5, r, rot);
        ellipsePath(p, cx + Math.cos(rot) * r, cy + Math.sin(rot) * r * 0.6, r * 0.9, r * 0.6, rot + 0.6);
      } else if (h < 0.24 && !slab) {
        // Cracks across old asphalt.
        const p = this.b1.f(P.landDark);
        const th = this.lw(0.9);
        const q = 0.3 + this.h(x, y, 6) * 0.4;
        p.rect(x + q, y + 0.1, th, 0.4 + this.h(x, y, 7) * 0.4);
        p.rect(x + 0.1, y + 1 - q, 0.3 + this.h(x, y, 8) * 0.4, th);
      } else if (h < 0.36) {
        // Scattered rubble specks.
        const dark = this.b1.f(P.landDark);
        const light = this.b1.f(P.landLight);
        for (let k = 0; k < 6; k++) {
          const s = 0.025 + this.h(x, y, 30 + k) * 0.045;
          (k & 1 ? light : dark).rect(x + 0.12 + this.h(x, y, 10 + k) * 0.76, y + 0.12 + this.h(x, y, 20 + k) * 0.76, s, s);
        }
      } else if (h < 0.44 && !slab) {
        // Scrub: clumps of hardy weeds pushing through.
        const p = this.b1.f(P.scrub);
        for (let k = 0; k < 4; k++) {
          const r = 0.04 + this.h(x, y, 100 + k) * 0.05;
          ellipsePath(p, x + 0.2 + this.h(x, y, 104 + k) * 0.6, y + 0.2 + this.h(x, y, 108 + k) * 0.6, r * 1.3, r, 0);
        }
      } else if (h < 0.49) {
        // Oil stain.
        ellipsePath(this.b1.f(P.landDark), x + 0.5, y + 0.5, 0.2, 0.13, this.h(x, y, 7) * Math.PI);
      } else if (h < 0.53 && this.fine) {
        // Utility hatch.
        const p = this.b1.f(P.landLight);
        const th = this.lw(1);
        const u = x + 0.35 + this.h(x, y, 8) * 0.2;
        const v = y + 0.35 + this.h(x, y, 9) * 0.2;
        p.rect(u, v, 0.14, th);
        p.rect(u, v + 0.14, 0.14, th);
        p.rect(u, v, th, 0.14);
        p.rect(u + 0.14, v, th, 0.14 + th);
      }
    }
    if (this.lines) {
      // Planning grid: minor lines per tile, brighter major lines every 4 tiles.
      const th = this.lw(1);
      const minor = this.b3.f(this.detail ? P.grid : P.gridFar);
      const major = this.b3.f(P.gridMajor);
      (y % 4 === 0 ? major : minor).rect(x, y, 1, th);
      (x % 4 === 0 ? major : minor).rect(x, y, th, 1);
    }
  }

  // ── Megacity: fog, district character, terraces, roof tints (MEGACITY §3.7, §3.9) ──────

  /**
   * A locked tile (§3.9): terrain colour × 0.45 mixed 30% toward violet (deeper past the peek margin), no props and no
   * roads; the Sunk's old pump hall shows as a dark hall on the water. Terrace steps tint the fogged land.
   */
  private fog(x: number, y: number, t: Tile, i: number) {
    const P = this.pal;
    const info = this.info;
    const d = info.fogD[i];
    const band = d <= ANNEX.peek ? 0 : d <= ANNEX.peek + 8 ? 1 : 2;
    if (info.deco[i] === DECO_HALL) {
      this.tileRect(this.b0.f(P.fogHall), x, y);
      this.b1.f(P.fogHallRoof).rect(x + 0.12, y + 0.12, 0.76, 0.76);
      return;
    }
    if (t.terrain === Terrain.Water) this.tileRect(this.b0.f(P.fogWater[band][info.depth[i]]), x, y);
    else this.tileRect(this.b0.f(P.fogLand[band][Math.min(7, info.tone[i] + t.elev * 2)]), x, y);
  }

  /** District ground character, ground features and terrace steps over an owned land tile (§3.7, §3.9). */
  private character(x: number, y: number, t: Tile, i: number) {
    const P = this.pal;
    const kind = this.world.kindAt(x, y);
    const wash = P.kindWash[kind];
    if (wash && !(t.road && t.roadKind === RoadKind.Highway)) this.b1.f(wash).rect(x, y, 1, 1);
    if (t.ground !== Ground.Plain) this.groundFeature(x, y, t);
    if (t.elev > 0 || kind === 'terraces') this.terrace(x, y, t);
    const deco = this.info.deco[i];
    if (deco && !t.road && t.buildingId < 0 && t.zone === ZoneType.None) this.tarmacDeco(x, y, deco);
    if (!this.detail) return;
    switch (kind) {
      case 'skeleton':
        // Traffic cones left on the empty plots.
        if (!t.road && t.zone === ZoneType.None && t.buildingId < 0 && this.h(x, y, 150) < 0.06) {
          const p = this.b2.f(P.cone);
          const u = x + 0.3 + this.h(x, y, 151) * 0.4;
          const v = y + 0.3 + this.h(x, y, 152) * 0.4;
          for (let k = 0; k < 3; k++) circlePath(p, u + k * 0.09, v + k * 0.05, 0.035);
        }
        break;
      case 'bazaar':
        // Paper lantern strings across the alleys (they glow in the animated pass).
        if (t.road && t.roadKind === RoadKind.Alley && this.lines) {
          const cord = this.b3.s(P.lanternCord, this.lw(0.8));
          const lamp = this.b3.f(P.lantern);
          const across = (this.world.roadMask(x, y) & 5) !== 0; // the alley runs along y: strings cross along x
          for (let k = 0; k < 2; k++) {
            const q = 0.3 + k * 0.4;
            if (across) {
              cord.moveTo(x + 0.15, y + q);
              cord.lineTo(x + 0.85, y + q);
              for (let j = 0; j < 3; j++) circlePath(lamp, x + 0.3 + j * 0.2, y + q, 0.04);
            } else {
              cord.moveTo(x + q, y + 0.15);
              cord.lineTo(x + q, y + 0.85);
              for (let j = 0; j < 3; j++) circlePath(lamp, x + q, y + 0.3 + j * 0.2, 0.04);
            }
          }
        }
        break;
    }
  }

  /** Reeds, brownfield and rubble ground (§3.7): a base tint and their marks. */
  private groundFeature(x: number, y: number, t: Tile) {
    const P = this.pal;
    if (t.ground === Ground.Reed) {
      this.b1.f(P.reedBase).rect(x, y, 1, 1);
      if (!this.detail || t.road) return;
      const p = this.b1.s(P.reed, this.lw(1.1), 'round');
      const q = this.b1.s(P.reedDark, this.lw(1.1), 'round');
      for (let k = 0; k < 7; k++) {
        const u = x + 0.1 + this.h(x, y, 160 + k) * 0.8;
        const v = y + 0.1 + this.h(x, y, 170 + k) * 0.8;
        const path = k & 1 ? q : p;
        path.moveTo(u, v);
        path.lineTo(u - 0.07, v - 0.07);
        path.moveTo(u + 0.03, v);
        path.lineTo(u + 0.01, v - 0.09);
      }
    } else if (t.ground === Ground.Brownfield) {
      this.b1.f(P.brownBase).rect(x, y, 1, 1);
      if (!this.detail) return;
      if (this.h(x, y, 180) < 0.35) ellipsePath(this.b1.f(P.brownSheen), x + 0.5, y + 0.5, 0.26, 0.14, this.h(x, y, 181) * Math.PI);
      // Old rail-yard tracks on Kessel brownfield: rails along the lot's axis by a coarse hash.
      if (this.world.kindAt(x, y) === 'flats' && !t.road && t.buildingId < 0 && t.level === 0 && hash2((x - this.info.o) >> 3, (y - this.info.o) >> 3, this.info.seed + 190) < 0.5) {
        const alongX = hash2((x - this.info.o) >> 3, (y - this.info.o) >> 3, this.info.seed + 191) < 0.5;
        const sl = this.b1.f(P.sleeper);
        const st = this.b2.f(P.steel);
        const th = this.lw(1);
        for (let k = 0; k < 4; k++) {
          const a = 0.06 + k * 0.25;
          if (alongX) sl.rect(x + a, y + 0.34, 0.08, 0.32);
          else sl.rect(x + 0.34, y + a, 0.32, 0.08);
        }
        if (alongX) {
          st.rect(x, y + 0.4, 1, th);
          st.rect(x, y + 0.6, 1, th);
        } else {
          st.rect(x + 0.4, y, th, 1);
          st.rect(x + 0.6, y, th, 1);
        }
      }
    } else if (t.ground === Ground.Rubble) {
      this.b1.f(P.rubbleBase).rect(x, y, 1, 1);
      if (!this.detail) return;
      const dark = this.b1.f(P.landDark);
      const light = this.b1.f(P.rubbleLight);
      for (let k = 0; k < 8; k++) {
        const sz = 0.035 + this.h(x, y, 200 + k) * 0.06;
        (k & 1 ? light : dark).rect(x + 0.08 + this.h(x, y, 210 + k) * 0.8, y + 0.08 + this.h(x, y, 220 + k) * 0.8, sz, sz * 0.8);
      }
    }
  }

  /**
   * Highstep Terraces (§3.7, painted first): contour light per step, a contour line where the step changes, painted
   * retaining-wall faces on the +x / +y sides where the neighbour is lower, stairs on Streets between steps and
   * building bases darkened by step. Nothing is raised (elevOffset is 0).
   */
  private terrace(x: number, y: number, t: Tile) {
    const P = this.pal;
    const e = t.elev;
    if (e > 0) this.b1.f(P.elevLight[e]).rect(x, y, 1, 1);
    if (e > 0 && (t.buildingId >= 0 || (t.zone !== ZoneType.None && t.level > 0))) this.b1.f(P.elevBase[e]).rect(x + 0.08, y + 0.08, 0.84, 0.84);
    const w = this.world;
    const elevAt = (dx: number, dy: number) => {
      const n = w.tileAt(x + dx, y + dy);
      return n && n.terrain === Terrain.Land && w.isOwned(x + dx, y + dy) ? n.elev : -1;
    };
    const th = this.lw(1.2);
    for (let d = 0; d < 4; d++) {
      const ne = elevAt(DX4[d], DY4[d]);
      if (ne < 0 || ne === e) continue;
      // Contour line on this tile's side of the edge.
      if (this.lines) {
        const c = this.b3.f(P.contour);
        if (d === 0) c.rect(x, y, 1, th);
        else if (d === 1) c.rect(x + 1 - th, y, th, 1);
        else if (d === 2) c.rect(x, y + 1 - th, 1, th);
        else c.rect(x, y, th, 1);
      }
      // A visible retaining wall: the face drops from this (higher) tile's +x / +y edge onto the lower neighbour.
      if (ne < e && (d === 1 || d === 2)) {
        const depth = Math.min(0.42, 0.16 * (e - ne));
        const face = this.b2.f(P.retWall);
        if (d === 1) face.rect(x + 1, y, depth, 1);
        else face.rect(x, y + 1, 1, depth);
        if (this.lines) {
          const lip = this.b3.f(P.retLip);
          const joint = this.b3.f(P.retJoint);
          if (d === 1) {
            lip.rect(x + 1, y, th, 1);
            for (let k = 1; k < 4; k++) joint.rect(x + 1, y + k * 0.25, depth, th * 0.7);
            joint.rect(x + 1 + depth * 0.5, y, th * 0.7, 1);
          } else {
            lip.rect(x, y + 1, 1, th);
            for (let k = 1; k < 4; k++) joint.rect(x + k * 0.25, y + 1, th * 0.7, depth);
            joint.rect(x, y + 1 + depth * 0.5, 1, th * 0.7);
          }
        }
      }
      // Stairs where a Street steps down to a road on another step.
      if (t.road && this.lines && (w.roadMask(x, y) & DIR[d]) && ne !== e) {
        const st = this.b3.f(P.stair);
        for (let k = 0; k < 3; k++) {
          const q = 0.06 + k * 0.1;
          if (d === 0) st.rect(x + 0.3, y + q, 0.4, th);
          else if (d === 1) st.rect(x + 1 - q, y + 0.3, th, 0.4);
          else if (d === 2) st.rect(x + 0.3, y + 1 - q, 0.4, th);
          else st.rect(x + q, y + 0.3, th, 0.4);
        }
      }
    }
  }

  /** Tarmac Reach's old airfield painted on the ground (§3.7): runway with centre dashes and threshold bars, apron. */
  private tarmacDeco(x: number, y: number, deco: number) {
    const P = this.pal;
    if (deco === DECO_APRON) {
      this.b1.f(P.apron).rect(x, y, 1, 1);
      if (this.lines && this.h(x, y, 230) < 0.25) this.b3.f(P.taxiLine).rect(x + 0.1, y + 0.48, 0.8, this.lw(1.2));
      return;
    }
    this.b1.f(P.runway).rect(x, y, 1, 1);
    if (!this.lines) return;
    const th = this.lw(1.6);
    const runway = (dx: number, dy: number) => this.info.deco[(y + dy) * this.N + x + dx] === DECO_RUNWAY || this.info.deco[(y + dy) * this.N + x + dx] === DECO_RUNWAY_END;
    const alongX = runway(-1, 0) || runway(1, 0);
    const p = this.b3.f(P.runwayLine);
    if (deco === DECO_RUNWAY_END) {
      // Threshold bars (the faded runway numbers read as bars at this scale).
      for (let k = 0; k < 3; k++) {
        if (alongX) p.rect(x + 0.2 + k * 0.25, y + 0.15, 0.1, 0.7);
        else p.rect(x + 0.15, y + 0.2 + k * 0.25, 0.7, 0.1);
      }
      return;
    }
    if (alongX ? x % 2 === 0 : y % 2 === 0) {
      if (alongX) p.rect(x + 0.1, y + 0.47, 0.6, th);
      else p.rect(x + 0.47, y + 0.1, th, 0.6);
    }
  }

  /** The skyline view's roof tint of a developed zone tile (§3.9): a flat roof diamond in its body's wall colour. */
  private roofTint(x: number, y: number, t: Tile) {
    const P = this.pal;
    const list = P.roofTint[t.zone];
    if (!list || !list.length) return;
    const c = t.abandoned ? P.roofAbandoned : list[t.variant % list.length];
    const i = t.level >= 3 ? 0.08 : t.level === 2 ? 0.12 : 0.18;
    this.b2.f(c).rect(x + i, y + i, 1 - 2 * i, 1 - 2 * i);
    if (!t.abandoned && t.level >= 2 && this.h(x, y, 140) < 0.7) this.b3.f(P.roofWin).rect(x + 0.42, y + 0.42, 0.16, 0.16);
  }

  /** Concrete quay lip along edges that border water. */
  private quay(x: number, y: number) {
    const n = this.isWater(x, y - 1);
    const e = this.isWater(x + 1, y);
    const s = this.isWater(x, y + 1);
    const w = this.isWater(x - 1, y);
    if (!(n || e || s || w)) return;
    const q = this.b3.f(this.pal.quay);
    const d = 0.07;
    if (n) q.rect(x, y, 1, d);
    if (e) q.rect(x + 1 - d, y, d, 1);
    if (s) q.rect(x, y + 1 - d, 1, d);
    if (w) q.rect(x, y, d, 1);
    const lip = this.b3.f(this.pal.lip);
    const th = this.lw(1);
    if (n) lip.rect(x, y, 1, th);
    if (w) lip.rect(x, y, th, 1);
    if (!this.detail) return;
    const kind = this.world.kindAt(x, y);
    const t = this.world.tiles[y * this.N + x];
    if (kind === 'shoals' && !t.road && t.buildingId < 0) {
      // Boardwalk along the water, planks and rope bollards.
      const P = this.pal;
      const b = this.b2.f(P.board);
      const gap = this.b3.f(P.boardGap);
      const bw = 0.26;
      if (n) b.rect(x, y + d, 1, bw);
      if (e) b.rect(x + 1 - d - bw, y, bw, 1);
      if (s) b.rect(x, y + 1 - d - bw, 1, bw);
      if (w) b.rect(x + d, y, bw, 1);
      for (let k = 1; k < 5; k++) {
        const q = k * 0.2;
        if (n) gap.rect(x + q, y + d, th, bw);
        if (s) gap.rect(x + q, y + 1 - d - bw, th, bw);
        if (e) gap.rect(x + 1 - d - bw, y + q, bw, th);
        if (w) gap.rect(x + d, y + q, bw, th);
      }
      if (this.h(x, y, 240) < 0.5) {
        const bo = this.b3.f(P.bollard);
        if (n) circlePath(bo, x + 0.5, y + d + 0.03, 0.035);
        if (s) circlePath(bo, x + 0.5, y + 1 - d - 0.03, 0.035);
      }
    } else if (kind === 'sunk') {
      // Canal walls of old brick and iron mooring rings.
      const P = this.pal;
      const br = this.b2.f(P.brick);
      const bw = 0.1;
      if (n) br.rect(x, y + d, 1, bw);
      if (e) br.rect(x + 1 - d - bw, y, bw, 1);
      if (s) br.rect(x, y + 1 - d - bw, 1, bw);
      if (w) br.rect(x + d, y, bw, 1);
      if (this.h(x, y, 241) < 0.4) {
        const r = this.b3.s(P.ring, this.lw(1.2));
        if (n) circlePath(r, x + 0.3 + this.h(x, y, 242) * 0.4, y + d + 0.05, 0.05);
        if (w) circlePath(r, x + d + 0.05, y + 0.3 + this.h(x, y, 243) * 0.4, 0.05);
      }
    }
  }

  private lot(x: number, y: number, t: Tile) {
    const P = this.pal;
    const z = t.zone;
    if (t.level === 0) {
      this.tileRect(this.b0.f(P.lot), x, y);
      this.b1.f(this.lines ? P.zoneTint[z] : P.zoneFar[z]).rect(x, y, 1, 1);
      if (this.lotLines) this.dashedOutline(this.b3.f(P.zoneLine[z]), x, y, this.lw(0.9));
      return;
    }
    this.tileRect(this.b0.f(t.abandoned ? P.padAbandoned : P.pad), x, y);
    if (this.skyline) this.roofTint(x, y, t);
    else if (!this.lines && !t.abandoned) this.b1.f(P.zoneFar[z]).rect(x, y, 1, 1);
    if (this.lines) {
      const th = this.lw(1);
      const i = 0.04;
      const p = this.b3.f(t.abandoned ? P.rubble : P.zoneRim[z]);
      p.rect(x + i, y + i, 1 - 2 * i, th);
      p.rect(x + i, y + 1 - i - th, 1 - 2 * i, th);
      p.rect(x + i, y + i, th, 1 - 2 * i);
      p.rect(x + 1 - i - th, y + i, th, 1 - 2 * i);
    }
    if (t.abandoned && this.detail) {
      const p = this.b1.f(P.rubble);
      for (let k = 0; k < 6; k++) {
        const s = 0.03 + this.h(x, y, 40 + k) * 0.05;
        p.rect(x + 0.1 + this.h(x, y, 50 + k) * 0.8, y + 0.1 + this.h(x, y, 60 + k) * 0.8, s, s);
      }
    }
  }

  /** Dashed inset outline of a zoned empty lot. */
  private dashedOutline(p: CanvasPath, x: number, y: number, th: number) {
    const i = 0.08;
    const len = 1 - 2 * i;
    const dash = 0.1;
    const gap = (len - dash * 5) / 4;
    for (let k = 0; k < 5; k++) {
      const o = i + k * (dash + gap);
      p.rect(x + o, y + i, dash, th);
      p.rect(x + o, y + 1 - i - th, dash, th);
      p.rect(x + i, y + o, th, dash);
      p.rect(x + 1 - i - th, y + o, th, dash);
    }
  }

  private buildingPad(x: number, y: number, t: Tile) {
    const P = this.pal;
    const b = this.world.buildings.get(t.buildingId);
    switch (b?.type) {
      case 'seaport':
        this.quayApron(x, y, b);
        return;
      case 'airport':
        this.airfield(x, y, b);
        return;
      case 'spaceport':
        this.blastPad(x, y, b);
        this.padStripe(x, y, b);
        return;
      case 'academy':
        this.courtyard(x, y, b);
        this.padStripe(x, y, b);
        return;
    }
    this.tileRect(this.b0.f(P.bpad), x, y);
    if (!this.lines || !b) return;
    this.padStripe(x, y, b);
  }

  /** Slab joints and the painted perimeter stripe in the building's signature colour. */
  private padStripe(x: number, y: number, b: Building) {
    if (!this.lines) return;
    const P = this.pal;
    const lx = x - b.x;
    const ly = y - b.y;
    const last = b.size - 1;
    const th = this.lw(1);
    // Inner slab joints.
    const j = this.b3.f(P.bpadLine);
    if (ly > 0) j.rect(x, y, 1, th);
    if (lx > 0) j.rect(x, y, th, 1);
    // Painted perimeter stripe in the building's signature colour.
    const p = this.b3.f(stripeColor(P, b.type, false));
    const w = 0.05;
    const i = 0.04;
    if (ly === 0) p.rect(x, y + i, 1, w);
    if (ly === last) p.rect(x, y + 1 - i - w, 1, w);
    if (lx === 0) p.rect(x + i, y, w, 1);
    if (lx === last) p.rect(x + 1 - i - w, y, w, 1);
  }

  /** Add the part of the absolute tile-space rect [u0,u1]×[v0,v1] that lies on tile (x, y). */
  private clipRect(path: CanvasPath, x: number, y: number, u0: number, v0: number, u1: number, v1: number) {
    const a = Math.max(x, u0);
    const b = Math.min(x + 1, u1);
    const c = Math.max(y, v0);
    const d = Math.min(y + 1, v1);
    if (b > a && d > c) path.rect(a, c, b - a, d - c);
  }

  /** Seaport facing (stored; recomputed for a malformed building). */
  private facingOf(b: Building): 0 | 1 | 2 | 3 {
    if (b.facing !== undefined) return b.facing;
    const f = shoreFacing(this.world, b.x, b.y, b.size);
    return f < 0 ? 2 : (f as 0 | 1 | 2 | 3);
  }

  /**
   * Band of the seaport yard between depths d0..d1 from the water edge and positions
   * a0..a1 along it (tile units), clipped to tile (x, y).
   */
  private quayBand(path: CanvasPath, x: number, y: number, b: Building, f: number, d0: number, d1: number, a0 = 0, a1 = b.size) {
    const S = b.size;
    switch (f) {
      case 0:
        this.clipRect(path, x, y, b.x + a0, b.y + d0, b.x + a1, b.y + d1);
        break;
      case 2:
        this.clipRect(path, x, y, b.x + a0, b.y + S - d1, b.x + a1, b.y + S - d0);
        break;
      case 1:
        this.clipRect(path, x, y, b.x + S - d1, b.y + a0, b.x + S - d0, b.y + a1);
        break;
      default:
        this.clipRect(path, x, y, b.x + d0, b.y + a0, b.x + d1, b.y + a1);
    }
  }

  /** Seaport quay apron (§5.1): concrete, a yellow quay edge, bollards, crane rails, yellow lanes and a rail spur. */
  private quayApron(x: number, y: number, b: Building) {
    const P = this.pal;
    this.tileRect(this.b0.f(P.quayConc), x, y);
    if (!this.lines) return;
    const f = this.facingOf(b);
    const S = b.size;
    const th = this.lw(1.3);
    this.quayBand(this.b3.f(P.portLane), x, y, b, f, 0.02, 0.08);
    const steel = this.b3.f(P.steel);
    this.quayBand(steel, x, y, b, f, 0.3 - th / 2, 0.3 + th / 2);
    this.quayBand(steel, x, y, b, f, 1.15 - th / 2, 1.15 + th / 2);
    const lane = this.b3.f(P.portLane);
    this.quayBand(lane, x, y, b, f, 1.6 - th / 2, 1.6 + th / 2);
    this.quayBand(lane, x, y, b, f, 2.4 - th / 2, 2.4 + th / 2);
    // Rail spur along the back: sleepers, then two rails.
    if (this.detail) {
      const sl = this.b2.f(P.sleeper);
      for (let a = 0.05; a < S; a += 0.18) this.quayBand(sl, x, y, b, f, 3.22, 3.58, a, a + 0.07);
      const bo = this.b3.f(P.bollard);
      for (let a = 0.25; a < S; a += 0.5) this.quayBand(bo, x, y, b, f, 0.1, 0.17, a - 0.035, a + 0.035);
    }
    this.quayBand(steel, x, y, b, f, 3.3 - th / 2, 3.3 + th / 2);
    this.quayBand(steel, x, y, b, f, 3.5 - th / 2, 3.5 + th / 2);
  }

  /**
   * Airport ground art (§5.2), rows by dy: 0 grass and taxiway, 1-2 runway (edge lines,
   * centreline dashes, threshold stripes at dx 0 and 5, edge lights), 3 taxiway, 4-5 apron.
   */
  private airfield(x: number, y: number, b: Building) {
    const P = this.pal;
    const dx = x - b.x;
    const dy = y - b.y;
    const last = b.size - 1;
    const th = this.lw(1.4);
    if (dy === 0) {
      this.tileRect(this.b0.f(P.grass), x, y);
      this.b1.f(P.runway).rect(x, y + 0.5, 1, 0.5 + this.px * 0.6);
      if (this.lines) this.b3.f(P.taxiLine).rect(x, y + 0.75 - th / 2, 1, th);
      return;
    }
    if (dy === 1 || dy === 2) {
      this.tileRect(this.b0.f(P.runway), x, y);
      if (!this.lines) return;
      const line = this.b3.f(P.runwayLine);
      // Edge line on the outer side of each runway row.
      if (dy === 1) line.rect(x, y + 0.06, 1, th);
      else line.rect(x, y + 0.94 - th, 1, th);
      // Centreline dashes on the boundary between the two rows (drawn from row 1).
      if (dy === 1 && dx > 0 && dx < last) {
        const w = this.lw(2);
        line.rect(x + 0.1, y + 1 - w / 2, 0.3, w);
        line.rect(x + 0.6, y + 1 - w / 2, 0.3, w);
      }
      if (dx === 0 || dx === last) {
        // Threshold bar and piano keys at both ends.
        const u0 = dx === 0 ? 0.16 : 0.32;
        line.rect(x + (dx === 0 ? 0.06 : 0.9), y, 0.04, 1);
        if (this.detail) for (const v of [0.18, 0.38, 0.58, 0.78]) line.rect(x + u0, y + v, 0.5, 0.09);
      }
      if (this.detail) {
        const s = this.lw(2.2);
        const lamp = this.b3.f(P.runwayLamp);
        const v = dy === 1 ? 0.02 : 0.98 - s;
        lamp.rect(x + 0.25 - s / 2, y + v, s, s);
        lamp.rect(x + 0.75 - s / 2, y + v, s, s);
      }
      return;
    }
    if (dy === 3) {
      this.tileRect(this.b0.f(P.runway), x, y);
      if (!this.lines) return;
      const yl = this.b3.f(P.taxiLine);
      yl.rect(x, y + 0.5 - th / 2, 1, th);
      if (this.detail) {
        yl.rect(x, y + 0.1, 1, this.lw(0.9));
        yl.rect(x, y + 0.9 - this.lw(0.9), 1, this.lw(0.9));
      }
      // Lead-in lines up to the runway at both ends of the terminal.
      if (dx === 1 || dx === last - 1) yl.rect(x + 0.5 - th / 2, y, th, 0.5);
      return;
    }
    this.tileRect(this.b0.f(P.apron), x, y);
    if (!this.lines) return;
    // Stand lead-in lines on the apron.
    if (dy === 4 && dx > 0 && dx < last) this.b3.f(P.taxiLine).rect(x + 0.5 - th / 2, y, th, 0.6);
    if (dy === 4) this.b3.f(P.taxiLine).rect(x, y + 0.04, 1, this.lw(0.9));
  }

  /** Spaceport blast pad (§5.3): scorched concrete, concentric scorch rings, a service road loop, hazard chevrons at the edge. */
  private blastPad(x: number, y: number, b: Building) {
    const P = this.pal;
    this.tileRect(this.b0.f(P.apron), x, y);
    if (!this.lines) return;
    const cx = b.x + b.size / 2;
    const cy = b.y + b.size / 2;
    // Every footprint tile adds the whole ring set to the same paths; a path's fill is the
    // union of its subpaths, so overlap never darkens and partial chunk redraws stay whole.
    const ring = (path: CanvasPath, r0: number, r1: number) => {
      path.moveTo(cx + r1, cy);
      path.arc(cx, cy, r1, 0, TAU);
      path.moveTo(cx + r0, cy);
      path.arc(cx, cy, r0, 0, TAU, true);
    };
    ring(this.b1.f(P.runway), 2.2, 2.55);
    circlePath(this.b1.f(P.scorch), cx, cy, 1.6);
    ring(this.b2.f(P.scorchDark), 0.95, 1.08);
    ring(this.b2.f(P.scorchDark), 1.45, 1.55);
    if (this.detail) ring(this.b3.f(P.taxiLine), 2.37, 2.39 + this.px);
    // Hazard band along the outer edge: yellow with black blocks.
    const lx = x - b.x;
    const ly = y - b.y;
    const last = b.size - 1;
    const w = 0.12;
    const yb = this.b2.f(P.hazardY);
    const kb = this.b3.f(P.hazardK);
    const band = (k: number) => {
      rrect(yb, x, y, k, 0, 0, 1, w);
      if (this.detail) for (let j = 0; j < 4; j++) rrect(kb, x, y, k, j * 0.25 + 0.06, 0, 0.1, w);
    };
    if (ly === 0) band(0);
    if (lx === last) band(1);
    if (ly === last) band(2);
    if (lx === 0) band(3);
  }

  /** Academy courtyard: warm paving, a lawn split by cross paths, planters at its corners. */
  private courtyard(x: number, y: number, b: Building) {
    const P = this.pal;
    this.tileRect(this.b0.f(P.paving), x, y);
    if (!this.lines) return;
    const S = b.size;
    const mid = 0.07;
    const cu = b.x + S / 2;
    const cv = b.y + S / 2;
    const lawn = this.b1.f(P.lawn);
    for (const [u0, u1] of [[b.x + 0.18, cu - mid], [cu + mid, b.x + S - 0.18]])
      for (const [v0, v1] of [[b.y + 0.18, cv - mid], [cv + mid, b.y + S - 0.18]]) this.clipRect(lawn, x, y, u0, v0, u1, v1);
    if (this.detail) {
      const g = this.b2.f(P.avPlanter);
      for (const [u, v] of [[b.x + 0.18, b.y + 0.18], [b.x + S - 0.18, b.y + 0.18], [b.x + 0.18, b.y + S - 0.18], [b.x + S - 0.18, b.y + S - 0.18]])
        if (u >= x && u < x + 1 && v >= y && v < y + 1) circlePath(g, u, v, 0.06);
    }
  }

  private road(x: number, y: number, t: Tile) {
    switch (t.roadKind) {
      case RoadKind.Avenue:
        this.avenue(x, y);
        return;
      case RoadKind.Highway:
        this.highway(x, y);
        return;
      case RoadKind.Alley:
        this.alley(x, y);
        return;
      default:
        this.street(x, y, t.roadKind === RoadKind.Ramp);
    }
  }

  /** Sidewalk fill plus paving joints (fine LOD). */
  private sidewalk(x: number, y: number) {
    const P = this.pal;
    this.tileRect(this.b0.f(P.sidewalk), x, y);
    if (this.fine) {
      // Sidewalk paving joints (covered by asphalt where the road runs).
      const th = this.lw(0.8);
      const p = this.b1.f(P.seam);
      p.rect(x + 0.1, y, th, 1);
      p.rect(x + 0.9, y, th, 1);
      p.rect(x, y + 0.1, 1, th);
      p.rect(x, y + 0.9, 1, th);
    }
  }

  /** Curb closures where a linked neighbour of a narrower kind meets this tile's wider arm. */
  private steps(path: CanvasPath, x: number, y: number, mask: number, h: number) {
    for (let k = 0; k < 4; k++) {
      if (!(mask & DIR[k])) continue;
      const nk = this.kindAt(x, y, k);
      if (nk < 0) continue;
      const hn = kindHalf(nk);
      if (hn >= h - 1e-3) continue;
      segLine(path, x, y, k, 0.5 - h, 0, 0.5 - hn, 0);
      segLine(path, x, y, k, 0.5 + hn, 0, 0.5 + h, 0);
    }
  }

  /** Street (unchanged look) or On-ramp: street art plus white chevrons towards the highway and a gantry sign. */
  private street(x: number, y: number, ramp: boolean) {
    const P = this.pal;
    const mask = this.mask(x, y);
    this.sidewalk(x, y);
    const hv = this.h(x, y, 70);
    roadShapePath(this.b2.f(P.asphalt[Math.floor(hv * 3)]), x, y, mask, ROAD_HALF, this.px * 0.6);
    const hwArms = ramp ? this.highwayArms(x, y, mask) : 0;
    if (this.detail && hv < 0.3 && !hwArms) {
      // Asphalt repair patch / manhole.
      const p = this.b2.f(P.patch);
      if (hv < 0.15) circlePath(p, x + 0.5 + (this.h(x, y, 71) - 0.5) * 0.3, y + 0.5 + (this.h(x, y, 72) - 0.5) * 0.3, 0.06);
      else p.rect(x + 0.32 + this.h(x, y, 73) * 0.2, y + 0.25 + this.h(x, y, 74) * 0.3, 0.16, 0.22);
    }
    if (!this.lines) {
      // Far LOD: a single centre stripe keeps the network readable (white on a ramp).
      this.laneMarks(this.b3, hwArms ? P.chev : P.lane, x, y, mask, this.lw(1.2), true);
      return;
    }
    const curb = this.b3.s(P.curb, this.lw(1.2), 'square');
    roadOutlinePath(curb, x, y, mask, ROAD_HALF);
    this.steps(curb, x, y, mask, ROAD_HALF);
    if (this.fine) this.edgeLines(this.b3, P.edge, x, y, mask, this.lw(0.8), ROAD_HALF);
    if (hwArms) {
      this.rampMarks(x, y, mask, hwArms);
      return;
    }
    this.laneMarks(this.b3, P.lane, x, y, mask, this.lw(1.4), false);
    if (this.detail && BITS[mask] >= 3) this.crosswalks(this.b3.f(P.zebra), x, y, mask, ROAD_HALF);
  }

  /** On-ramp markings: white chevrons pointing at each highway arm, and an amber-and-white gantry sign behind them. */
  private rampMarks(x: number, y: number, mask: number, hwArms: number) {
    const P = this.pal;
    const w = this.lw(this.detail ? 2.2 : 1.6);
    const c = this.b3.s(P.chev, w, 'round');
    for (let k = 0; k < 4; k++) {
      if (!(hwArms & DIR[k])) continue;
      chevronPath(c, x, y, k, 0.06, 0.15);
      chevronPath(c, x, y, k, 0.27, 0.15);
      if (!this.detail) continue;
      // Gantry: a dark beam across the road with an amber sign in a white rim.
      rrect(this.b3.f(P.gantry), x, y, k, 0.5 - ROAD_HALF - 0.04, 0.6, ROAD_HALF * 2 + 0.08, 0.045);
      rrect(this.b3.f(P.signRim), x, y, k, 0.36, 0.575, 0.28, 0.095);
      rrect(this.b3.f(P.sign), x, y, k, 0.375, 0.59, 0.25, 0.065);
    }
    // Centre dashes on the street side only.
    const rest = mask & ~hwArms;
    if (rest && BITS[mask] === 2 && (mask === 5 || mask === 10)) {
      const k = DEAD_K[rest];
      if (k >= 0) rrect(this.b3.f(P.lane), x, y, k, 0.5 - this.lw(1.4) / 2, 0.08, this.lw(1.4), 0.26);
    }
  }

  /** Avenue: 0.40 asphalt, blue edge lines, a planted median with lamps, two lanes each way, crosswalks. */
  private avenue(x: number, y: number) {
    const P = this.pal;
    const h = KIND_HALF[RoadKind.Avenue];
    const mask = this.mask(x, y);
    this.sidewalk(x, y);
    roadShapePath(this.b2.f(P.avAsphalt), x, y, mask, h, this.px * 0.6);
    const box = 0.5 - h;
    if (!this.lines) {
      // Far LOD: blue edges read as a boulevard.
      bandPath(this.b3.f(P.avEdge), x, y, mask, -(h - 0.06), this.lw(1.4), box);
      bandPath(this.b3.f(P.avEdge), x, y, mask, h - 0.06, this.lw(1.4), box);
      return;
    }
    const curb = this.b3.s(P.curb, this.lw(1.2), 'square');
    roadOutlinePath(curb, x, y, mask, h);
    this.steps(curb, x, y, mask, h);
    const ew = this.lw(this.detail ? 1.6 : 1.3);
    const edge = this.b3.f(P.avEdge);
    bandPath(edge, x, y, mask, -(h - 0.05), ew, box);
    bandPath(edge, x, y, mask, h - 0.05, ew, box);
    // Median (a raised planted strip) and lane dashes.
    bandPath(this.b3.f(P.avMedian), x, y, mask, 0, AV_MEDIAN * 2, box);
    this.dashes(this.b3, P.laneW, x, y, mask, AV_DASH, this.lw(1.2));
    if (!this.detail) return;
    if (mask === 5 || mask === 10) {
      const k = mask === 5 ? 0 : 1;
      const g = this.b3.f(P.avPlanter);
      for (const q of [0.14, 0.38, 0.62, 0.86]) circlePath(g, x + rx(k, 0.5, q), y + ry(k, 0.5, q), 0.022);
      if (((x + y) & 1) === 0) {
        const s = this.lw(2.4);
        this.b3.f(P.lamp).rect(x + 0.5 - s / 2, y + 0.5 - s / 2, s, s);
      }
    }
    if (BITS[mask] >= 3) this.crosswalks(this.b3.f(P.zebra), x, y, mask, h);
  }

  /**
   * Highway: 0.46 deck (pale concrete by day, dark by night), no sidewalk, jersey
   * barriers and a median barrier, amber edge lines, two lanes each way. Arms to
   * on-ramps get a narrow slip lane through a gap in the barrier.
   */
  private highway(x: number, y: number) {
    const P = this.pal;
    const H = KIND_HALF[RoadKind.Highway];
    const mask = this.mask(x, y);
    const hw = this.highwayArms(x, y, mask);
    const ramps = mask & ~hw;
    this.tileRect(this.b0.f(P.hwVerge), x, y);
    roadShapePath(this.b2.f(P.hwDeck), x, y, hw, H, this.px * 0.6);
    const slip = 0.5 - H + 0.05;
    for (let k = 0; k < 4; k++) if (ramps & DIR[k]) rrect(this.b2.f(P.asphalt[1]), x, y, k, 0.5 - ROAD_HALF, -this.px * 0.6, ROAD_HALF * 2, slip);
    const box = 0.5 - H;
    if (!this.lines) {
      bandPath(this.b3.f(P.hwEdge), x, y, hw, 0, this.lw(1.8), box);
      return;
    }
    // Barriers along the deck edge (structures layer), then gaps where ramps join.
    roadOutlinePath(this.b2.s(P.barrier, this.lw(this.detail ? 2 : 1.5)), x, y, hw, H - 0.015);
    for (let k = 0; k < 4; k++) if (ramps & DIR[k]) rrect(this.b3.f(P.asphalt[1]), x, y, k, 0.5 - ROAD_HALF + 0.02, 0, ROAD_HALF * 2 - 0.04, slip);
    const edge = this.b3.f(P.hwEdge);
    const ew = this.lw(this.detail ? 1.7 : 1.4);
    bandPath(edge, x, y, hw, -HW_EDGE, ew, box);
    bandPath(edge, x, y, hw, HW_EDGE, ew, box);
    // Median barrier: a light concrete strip with a shaded core.
    bandPath(this.b3.f(P.barrier), x, y, hw, 0, Math.max(0.035, this.lw(2.4)), box);
    if (this.detail) bandPath(this.b3.f(P.barrierShade), x, y, hw, 0, this.lw(0.9), box);
    this.dashes(this.b3, P.hwLane, x, y, hw, HW_DASH, this.lw(1.3));
    if (this.detail) {
      // Slip lanes: white gore lines flaring from the barrier gap into the deck.
      const g = this.b3.s(P.hwLane, this.lw(1.3), 'round');
      for (let k = 0; k < 4; k++) {
        if (!(ramps & DIR[k])) continue;
        segLine(g, x, y, k, 0.5 - ROAD_HALF + 0.02, slip, 0.5 - ROAD_HALF - 0.16, 0.36);
        segLine(g, x, y, k, 0.5 + ROAD_HALF - 0.02, slip, 0.5 + ROAD_HALF + 0.16, 0.36);
      }
      // Sodium lamp posts on the median every second tile.
      if ((hw === 5 || hw === 10) && ((x + y) & 1) === 0) {
        const s = this.lw(2.6);
        this.b3.f(P.lamp).rect(x + 0.5 - s / 2, y + 0.5 - s / 2, s, s);
      }
    }
  }

  /** Back Alley: 0.16 grimy lane, violet edge, wet sheen, a dumpster or steam vent by hash. */
  private alley(x: number, y: number) {
    const P = this.pal;
    const h = KIND_HALF[RoadKind.Alley];
    const mask = this.mask(x, y);
    this.tileRect(this.b0.f(P.grime), x, y);
    roadShapePath(this.b2.f(P.alleyAsph), x, y, mask, h, this.px * 0.6);
    if (!this.lines) {
      this.laneMarks(this.b3, P.alleyEdge, x, y, mask, this.lw(1.1), true);
      return;
    }
    roadOutlinePath(this.b3.s(P.alleyEdge, this.lw(1.3), 'square'), x, y, mask, h);
    if (!this.detail) return;
    // Grime specks on the pavement either side.
    const d = this.b1.f(P.grimeDark);
    for (let k = 0; k < 5; k++) {
      const s = 0.025 + this.h(x, y, 140 + k) * 0.04;
      d.rect(x + 0.06 + this.h(x, y, 150 + k) * 0.85, y + 0.06 + this.h(x, y, 160 + k) * 0.85, s, s);
    }
    // Wet sheen down the middle.
    if (mask === 5 || mask === 10) rrect(this.b3.f(P.sheen), x, y, mask === 5 ? 0 : 1, 0.47, 0.06, 0.06, 0.88);
    const hv = this.h(x, y, 170);
    if (hv < 0.45 && (mask === 5 || mask === 10)) {
      // Beside the lane: a dumpster, or a steam vent grate.
      const k = mask === 5 ? 0 : 1;
      const side = this.h(x, y, 171) < 0.5 ? 0.5 - h - 0.2 : 0.5 + h + 0.04;
      if (hv < 0.25) rrect(this.b2.f(P.dumpster), x, y, k, side, 0.3, 0.16, 0.26);
      else {
        rrect(this.b2.f(P.vent), x, y, k, side + 0.02, 0.4, 0.12, 0.12);
        const g = this.b3.f(P.grimeDark);
        const th = this.lw(0.8);
        for (let j = 0; j < 3; j++) rrect(g, x, y, k, side + 0.04 + j * 0.035, 0.42, th, 0.08);
      }
    }
  }

  /** Two lane dashes per tile at ±off on straights, dashed arcs on corners; junction boxes stay clear. */
  private dashes(b: Batch, color: string, x: number, y: number, mask: number, off: number, w: number) {
    if (mask === 5 || mask === 10) {
      const k = mask === 5 ? 0 : 1;
      const p = b.f(color);
      for (const o of [-off, off]) {
        rrect(p, x, y, k, 0.5 + o - w / 2, 0.08, w, 0.26);
        rrect(p, x, y, k, 0.5 + o - w / 2, 0.58, w, 0.26);
      }
      return;
    }
    const ck = CORNER_K[mask];
    if (ck < 0) return;
    const cx = x + rx(ck, 1, 0);
    const cy = y + ry(ck, 1, 0);
    const a0 = HP + ck * HP;
    const p = b.s(color, w, 'butt', LANE_DASH);
    for (const r of [0.5 - off, 0.5 + off]) {
      p.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
      p.arc(cx, cy, r, a0, a0 + HP);
    }
  }

  /** Centre-line dashes (or one solid line at far LOD). */
  private laneMarks(b: Batch, color: string, x: number, y: number, mask: number, w: number, solid: boolean) {
    const c = BITS[mask];
    if (mask === 5 || mask === 10) {
      const k = mask === 5 ? 0 : 1;
      const p = b.f(color);
      if (solid) rrect(p, x, y, k, 0.5 - w / 2, 0, w, 1);
      else {
        rrect(p, x, y, k, 0.5 - w / 2, 0.08, w, 0.26);
        rrect(p, x, y, k, 0.5 - w / 2, 0.58, w, 0.26);
      }
      return;
    }
    const ck = CORNER_K[mask];
    if (ck >= 0) {
      const cx = x + rx(ck, 1, 0);
      const cy = y + ry(ck, 1, 0);
      const a0 = HP + ck * HP;
      const p = b.s(color, w, 'butt', solid ? null : LANE_DASH);
      p.moveTo(cx + Math.cos(a0) * 0.5, cy + Math.sin(a0) * 0.5);
      p.arc(cx, cy, 0.5, a0, a0 + HP);
      return;
    }
    if (c === 1) {
      rrect(b.f(color), x, y, DEAD_K[mask], 0.5 - w / 2, solid ? 0 : 0.08, w, solid ? 0.5 : 0.26);
      return;
    }
    if (c === 0) {
      circlePath(b.s(color, w), x + 0.5, y + 0.5, 0.2);
      return;
    }
    if (solid) {
      const p = b.f(color);
      for (let k = 0; k < 4; k++) if (mask & DIR[k]) rrect(p, x, y, k, 0.5 - w / 2, 0, w, 0.5);
    }
  }

  /** Solid edge lines just inside the curbs (straights and corners only). */
  private edgeLines(b: Batch, color: string, x: number, y: number, mask: number, w: number, h: number) {
    const a = 0.5 - h + 0.045;
    const bb = 0.5 + h - 0.045;
    if (mask === 5 || mask === 10) {
      const k = mask === 5 ? 0 : 1;
      const p = b.f(color);
      rrect(p, x, y, k, a, 0, w, 1);
      rrect(p, x, y, k, bb - w, 0, w, 1);
      return;
    }
    const ck = CORNER_K[mask];
    if (ck >= 0) {
      const cx = x + rx(ck, 1, 0);
      const cy = y + ry(ck, 1, 0);
      const a0 = HP + ck * HP;
      const p = b.s(color, w);
      p.moveTo(cx + Math.cos(a0) * bb, cy + Math.sin(a0) * bb);
      p.arc(cx, cy, bb, a0, a0 + HP);
      p.moveTo(cx + Math.cos(a0) * a, cy + Math.sin(a0) * a);
      p.arc(cx, cy, a, a0, a0 + HP);
    }
  }

  /** Zebra crossings on every arm of a junction (asphalt half-width h). */
  private crosswalks(p: CanvasPath, x: number, y: number, mask: number, h: number) {
    const a = 0.5 - h;
    // Streets keep their original five stripes; wider roads add stripes at the same rhythm.
    const n = h === ROAD_HALF ? 5 : Math.round((2 * h - 0.04) / 0.12);
    const step = h === ROAD_HALF ? 0.12 : (2 * h - 0.04) / n;
    const w = h === ROAD_HALF ? 0.065 : step * 0.54;
    for (let k = 0; k < 4; k++) {
      if (!(mask & DIR[k])) continue;
      for (let s = 0; s < n; s++) rrect(p, x, y, k, a + 0.02 + s * step, 0.03, w, Math.max(0.05, a - 0.06));
    }
  }

  private water(x: number, y: number) {
    const { N } = this;
    const P = this.pal;
    this.tileRect(this.b0.f(P.water[this.info.depth[y * N + x]]), x, y);
    if (this.detail) {
      // Static ripple lines (animated sparkles are added per frame).
      const p = this.b1.f(P.ripple);
      const th = this.lw(1);
      for (let k = 0; k < 2; k++) {
        p.rect(x + 0.15 + this.h(x, y, 80 + k) * 0.5, y + 0.2 + this.h(x, y, 82 + k) * 0.6, 0.18 + this.h(x, y, 84 + k) * 0.15, th);
      }
    }
    const nLand = this.isLand(x, y - 1);
    const wLand = this.isLand(x - 1, y);
    const sLand = this.isLand(x, y + 1);
    const eLand = this.isLand(x + 1, y);
    if (this.lines) {
      // Shallows: soft lighter bands fading away from each shore edge.
      const sb = P.shallow;
      const bw = 0.55;
      if (nLand) this.b1.image(sb[0], x, y, 1, bw);
      if (wLand) this.b1.image(sb[1], x, y, bw, 1);
      if (sLand) this.b1.image(sb[2], x, y + 1 - bw, 1, bw);
      if (eLand) this.b1.image(sb[3], x + 1 - bw, y, bw, 1);
    }
    // Land in front (E/S) hides the strip of water right behind its edge.
    if (eLand || sLand) {
      const p = this.b1.f(P.waterShadow);
      if (eLand) p.rect(x + 1 - 0.12, y, 0.12, 1);
      if (sLand) p.rect(x, y + 1 - 0.12, 1, 0.12);
    }
    // Seawall faces of the land behind (N/W) drop down to the water.
    if (nLand || wLand) {
      const p = this.b2.f(P.wallFace);
      if (nLand) {
        p.moveTo(x, y);
        p.lineTo(x + 1, y);
        p.lineTo(x + 1 + WALL, y + WALL);
        p.lineTo(x + WALL, y + WALL);
        p.closePath();
      }
      if (wLand) {
        p.moveTo(x, y);
        p.lineTo(x + WALL, y + WALL);
        p.lineTo(x + WALL, y + 1 + WALL);
        p.lineTo(x, y + 1);
        p.closePath();
      }
      if (this.lines) {
        const th = this.lw(1.2);
        const d = this.b2.f(P.wallDark);
        if (nLand) d.rect(x + WALL, y + WALL - th, 1, th);
        if (wLand) d.rect(x + WALL - th, y + WALL, th, 1);
      }
    }
  }

  /**
   * Bridge deck, pillars and rails at the kind's width (deck = asphalt + 0.06).
   * Highway bridges are darker and heavier, with two pillar columns. Drawn
   * directly (after the batched layers), in tile order.
   */
  private bridge(x: number, y: number) {
    const { N } = this;
    const ctx = this.ctx;
    const P = this.pal;
    const t = this.world.tiles[y * N + x];
    const kind = t.roadKind;
    const hwy = kind === RoadKind.Highway;
    const av = kind === RoadKind.Avenue;
    const full = this.mask(x, y);
    // A highway deck spans only its highway arms; arms to ramps are narrow street decks.
    const mask = hwy ? this.highwayArms(x, y, full) : full;
    const narrow = full & ~mask;
    const h = kindHalf(kind);
    const dh = deckHalf(kind);
    const c = BITS[mask];
    // Pillars under straight runs (every other tile) and under stubs; two columns for a highway.
    if (((mask === 5 || mask === 10) && ((x + y) & 1) === 0) || c <= 1) {
      const e = 16 / (2 * HALF_H);
      const cols = hwy && (mask === 5 || mask === 10) ? [-0.25, 0.25] : [0];
      const pw = hwy ? 0.09 : 0.07;
      for (const o of cols) {
        const cu = 0.5 + (mask === 5 ? o : 0);
        const cv = 0.5 + (mask === 10 ? o : 0);
        const p0u = cu - pw;
        const p1u = cu + pw;
        const p0v = cv - pw;
        const p1v = cv + pw;
        ctx.fillStyle = P.pillarA;
        ctx.beginPath();
        ctx.moveTo(x + p1u, y + p0v);
        ctx.lineTo(x + p1u, y + p1v);
        ctx.lineTo(x + p1u + e, y + p1v + e);
        ctx.lineTo(x + p1u + e, y + p0v + e);
        ctx.fill();
        ctx.fillStyle = P.pillarB;
        ctx.beginPath();
        ctx.moveTo(x + p0u, y + p1v);
        ctx.lineTo(x + p1u, y + p1v);
        ctx.lineTo(x + p1u + e, y + p1v + e);
        ctx.lineTo(x + p0u + e, y + p1v + e);
        ctx.fill();
      }
    }
    const ext = this.px * 0.6;
    // Deck thickness: the shape stacked downwards (cheap extrusion), then the top.
    const dd = (hwy ? 6 : 4) / (2 * HALF_H);
    const deckPath = (path: CanvasPath, ox: number, oy: number, half: number) => {
      roadShapePath(path, x + ox, y + oy, mask, half, ext);
      for (let k = 0; k < 4; k++) if (narrow & DIR[k]) rrect(path, x + ox, y + oy, k, 0.5 - deckHalf(RoadKind.Street), -ext, deckHalf(RoadKind.Street) * 2, 0.5 - half + 0.06);
    };
    ctx.fillStyle = hwy ? P.hwDeckFace : P.deckFace;
    ctx.beginPath();
    for (const f of hwy ? [1, 0.75, 0.5, 0.25] : [1, 0.66, 0.33]) deckPath(ctx, dd * f, dd * f, dh);
    ctx.fill();
    ctx.fillStyle = hwy ? P.hwDeckFace : P.deck;
    ctx.beginPath();
    deckPath(ctx, 0, 0, dh);
    ctx.fill();
    ctx.fillStyle = hwy ? P.hwDeckBridge : av ? P.avAsphalt : P.deckAsphalt;
    ctx.beginPath();
    roadShapePath(ctx, x, y, mask, h - 0.02, ext);
    for (let k = 0; k < 4; k++) if (narrow & DIR[k]) rrect(ctx, x, y, k, 0.5 - ROAD_HALF + 0.02, -ext, ROAD_HALF * 2 - 0.04, 0.5 - h + 0.06);
    ctx.fill();
    const b = this.b3;
    if (hwy) {
      if (this.lines) {
        const box = 0.5 - h;
        bandPath(b.f(P.hwEdge), x, y, mask, -HW_EDGE + 0.01, this.lw(1.5), box);
        bandPath(b.f(P.hwEdge), x, y, mask, HW_EDGE - 0.01, this.lw(1.5), box);
        bandPath(b.f(P.barrier), x, y, mask, 0, Math.max(0.035, this.lw(2.4)), box);
        if (this.detail) this.dashes(b, P.hwLane, x, y, mask, HW_DASH, this.lw(1.3));
      } else bandPath(b.f(P.hwEdge), x, y, mask, 0, this.lw(1.8), 0);
    } else if (av) {
      if (this.lines) {
        const box = 0.5 - h;
        bandPath(b.f(P.avEdge), x, y, mask, -(h - 0.07), this.lw(1.4), box);
        bandPath(b.f(P.avEdge), x, y, mask, h - 0.07, this.lw(1.4), box);
        bandPath(b.f(P.avMedian), x, y, mask, 0, AV_MEDIAN * 2, box);
        if (this.detail) this.dashes(b, P.laneW, x, y, mask, AV_DASH - 0.01, this.lw(1.2));
      } else bandPath(b.f(P.avEdge), x, y, mask, 0, this.lw(1.4), 0);
    } else {
      if (this.lines) this.laneMarks(b, P.lane, x, y, mask, this.lw(1.4), !this.detail);
      if (this.fine) this.edgeLines(b, P.edge, x, y, mask, this.lw(0.8), ROAD_HALF - 0.02);
    }
    // Raised side rails.
    if (this.lines) {
      const r = 3 / (2 * HALF_H);
      roadOutlinePath(b.s(hwy ? P.barrier : P.rail, this.lw(hwy ? 1.8 : 1.3)), x - r, y - r, mask, dh - 0.025);
      if (this.detail) {
        const s = this.lw(2.2);
        const p = b.f(P.lamp);
        for (const [u, v] of bridgeLamps(mask, dh)) p.rect(x + u - r - s / 2, y + v - r - s / 2, s, s);
      }
    }
    b.flush(ctx);
  }

  // ── Additive glow pass (tile space) ───────────────────────────────────────

  glowTile(x: number, y: number) {
    const { N } = this;
    const t = this.world.tiles[y * N + x];
    if (!this.world.ownedAt(y * N + x)) return;
    if (this.skyline && t.zone !== ZoneType.None && t.level >= 2 && !t.abandoned && t.buildingId < 0 && this.h(x, y, 140) < 0.7) {
      // Lit windows on the skyline view's roof tints.
      this.gl.f(this.pal.gRoofWin).rect(x + 0.42, y + 0.42, 0.16, 0.16);
    }
    const P = this.pal;
    const g = this.gl;
    if (t.terrain === Terrain.Water) {
      // Neon waterline at the foot of the seawall.
      const th = this.lw(2.2);
      const n = this.isLand(x, y - 1);
      const w = this.isLand(x - 1, y);
      if (n || w) {
        const p = g.f(P.gShore);
        if (n) p.rect(x + WALL, y + WALL - th / 2, 1, th);
        if (w) p.rect(x + WALL - th / 2, y + WALL, th, 1);
      }
      if (t.road) this.bridgeGlow(x, y);
      return;
    }
    if (t.road) this.roadGlow(x, y, t);
    else if (t.buildingId >= 0) this.padGlow(x, y, t);
    else if (t.zone !== ZoneType.None) this.lotGlow(x, y, t);
    else this.landGlow(x, y);
    // Touchdown chevron of an active sky ramp.
    const sky = this.world.sky[y * N + x];
    if (sky & 16 && this.lines && skyRampGround(t)) {
      const k = DEAD_K[sky & 15];
      if (k >= 0) {
        const p = g.s(P.gTouch, this.lw(5), 'round');
        chevronPath(p, x, y, k, 0.2, 0.17);
        chevronPath(p, x, y, k, 0.5, 0.17);
      }
    }
    // Quay edge glow.
    if (this.lines) {
      const n = this.isWater(x, y - 1);
      const e = this.isWater(x + 1, y);
      const s = this.isWater(x, y + 1);
      const ww = this.isWater(x - 1, y);
      if (n || e || s || ww) {
        const w = this.lw(2.5);
        const p = g.f(P.gShore);
        if (n) p.rect(x, y, 1, w);
        if (e) p.rect(x + 1 - w, y, w, 1);
        if (s) p.rect(x, y + 1 - w, 1, w);
        if (ww) p.rect(x, y, w, 1);
      }
    }
  }

  flushGlow() {
    this.gl.flush(this.ctx);
  }

  private landGlow(x: number, y: number) {
    const P = this.pal;
    if (this.detail) {
      const th = this.lw(3);
      const p = this.gl.f(P.gGrid);
      p.rect(x, y - th / 2, 1, th);
      p.rect(x - th / 2, y, th, 1);
      if (y % 4 === 0 || x % 4 === 0) {
        const m = this.gl.f(P.gGridMajor);
        const tm = this.lw(5);
        if (y % 4 === 0) m.rect(x, y - tm / 2, 1, tm);
        if (x % 4 === 0) m.rect(x - tm / 2, y, tm, 1);
      }
      if (this.h(x, y, 95) < 0.035) {
        // Rare glint of broken neon in the rubble.
        const cyan = this.h(x, y, 96) < 0.5;
        const u = x + 0.2 + this.h(x, y, 97) * 0.6;
        const v = y + 0.2 + this.h(x, y, 98) * 0.6;
        this.sprite(cyan ? NEON.cyan : NEON.magenta, u, v, 0.12, 0.6 * P.n);
        this.gl.f(cyan ? P.gGlintC : P.gGlintM).rect(u - 0.03, v - 0.01, 0.06, this.lw(1.2));
      }
      if (this.h(x, y, 1) < 0.07 && !this.isSlab(x, y)) {
        // Puddle catches a neon reflection.
        const r = 0.1 + this.h(x, y, 4) * 0.12;
        this.sprite(this.h(x, y, 90) < 0.5 ? NEON.magenta : NEON.cyan, x + 0.32 + this.h(x, y, 2) * 0.36, y + 0.32 + this.h(x, y, 3) * 0.36, r * 1.7, 0.26 * P.n);
      }
    }
  }

  private lotGlow(x: number, y: number, t: Tile) {
    const P = this.pal;
    if (t.level === 0) {
      if (!this.lotLines) return;
      const o = this.lw(0.8);
      this.dashedOutline(this.gl.f(P.gZone[t.zone]), x - o, y - o, this.lw(2.6));
      this.dashedOutline(this.gl.f(P.gZoneCore[t.zone]), x, y, this.lw(0.9));
      return;
    }
    if (t.abandoned) return;
    // Light spilling from the building onto its pad.
    this.sprite(ZONE_RGB[t.zone], x + 0.5, y + 0.5, 0.75, 0.16 * P.n);
  }

  private padGlow(x: number, y: number, t: Tile) {
    const b = this.world.buildings.get(t.buildingId);
    if (!b) return;
    const n = this.pal.n;
    if (b.type === 'airport') {
      // Runway edge lights (the blink is in the animated pass) and apron floodlight.
      const dy = y - b.y;
      if (this.detail && (dy === 1 || dy === 2)) {
        const v = dy === 1 ? 0.03 : 0.97;
        this.sprite(NEON.white, x + 0.25, y + v, 0.1, 0.55 * n);
        this.sprite(NEON.white, x + 0.75, y + v, 0.1, 0.55 * n);
      }
      if (dy >= 4) this.sprite([255, 236, 200], x + 0.5, y + 0.5, 0.6, 0.12 * n);
      return;
    }
    if (b.type === 'seaport' && this.detail) {
      // Mast floodlight pools over the yard, and the yellow quay edge.
      this.sprite([255, 236, 200], x + 0.5, y + 0.5, 0.65, 0.16 * n);
      this.quayBand(this.gl.f(this.pal.gPortLane), x, y, b, this.facingOf(b), 0, 0.1);
    }
    const c = BUILDING_RGB.get(b.type) ?? NEON.cyan;
    // One soft pool per footprint, drawn from the footprint's origin tile.
    if (x === b.x && y === b.y) this.sprite(c, b.x + b.size / 2, b.y + b.size / 2, b.size * 0.7, 0.2 * this.pal.n);
    if (!this.lines) return;
    const lx = x - b.x;
    const ly = y - b.y;
    const last = b.size - 1;
    const w = this.lw(3);
    const i = 0.04;
    const p = this.gl.f(stripeColor(this.pal, b.type, true));
    if (ly === 0) p.rect(x, y + i, 1, w);
    if (ly === last) p.rect(x, y + 1 - i - w, 1, w);
    if (lx === 0) p.rect(x + i, y, w, 1);
    if (lx === last) p.rect(x + 1 - i - w, y, w, 1);
  }

  private roadGlow(x: number, y: number, t: Tile) {
    const P = this.pal;
    const mask = this.mask(x, y);
    const n = P.n;
    switch (t.roadKind) {
      case RoadKind.Avenue: {
        // Blue edge glow and cool-white lamps on the median every second tile.
        const h = KIND_HALF[RoadKind.Avenue];
        const w = this.lw(this.lines ? 4.5 : 3);
        bandPath(this.gl.f(P.gAvEdge), x, y, mask, -(h - 0.05), w, 0.5 - h);
        bandPath(this.gl.f(P.gAvEdge), x, y, mask, h - 0.05, w, 0.5 - h);
        if (!this.detail) return;
        if (BITS[mask] >= 3) this.crosswalks(this.gl.f(P.gZebra), x, y, mask, h);
        if ((mask === 5 || mask === 10) && ((x + y) & 1) === 0) {
          this.sprite(AV_LAMP, x + 0.5, y + 0.5, 0.42, 0.42 * n);
          this.sprite(NEON.white, x + 0.5, y + 0.5, 0.1, 0.5 * n);
        }
        return;
      }
      case RoadKind.Highway: {
        // Amber edge lines and sodium lamps on the median every second tile.
        const hw = this.highwayArms(x, y, mask);
        const w = this.lw(this.lines ? 5 : 3.5);
        const box = 0.5 - KIND_HALF[RoadKind.Highway];
        bandPath(this.gl.f(P.gHwEdge), x, y, hw, -HW_EDGE, w, box);
        bandPath(this.gl.f(P.gHwEdge), x, y, hw, HW_EDGE, w, box);
        if (!this.detail) return;
        if ((hw === 5 || hw === 10) && ((x + y) & 1) === 0) {
          this.sprite(SODIUM, x + 0.5, y + 0.5, 0.5, 0.5 * n);
          this.sprite(NEON.amber, x + 0.5, y + 0.5, 0.12, 0.6 * n);
        }
        return;
      }
      case RoadKind.Alley:
        // A faint violet edge; the flickering sign lives in the animated pass.
        if (this.lines) roadOutlinePath(this.gl.s(P.gAlley, this.lw(3)), x, y, mask, KIND_HALF[RoadKind.Alley]);
        return;
    }
    const ramp = t.roadKind === RoadKind.Ramp ? this.highwayArms(x, y, mask) : 0;
    // Lane glow + curb glow.
    if (!ramp) this.laneMarks(this.gl, P.gLane, x, y, mask, this.lw(this.lines ? 5 : 3), !this.lines);
    if (!this.lines) return;
    roadOutlinePath(this.gl.s(P.gCurb, this.lw(3.5)), x, y, mask, ROAD_HALF);
    if (ramp) {
      const c = this.gl.s(P.gChev, this.lw(5), 'round');
      for (let k = 0; k < 4; k++) {
        if (!(ramp & DIR[k])) continue;
        chevronPath(c, x, y, k, 0.06, 0.15);
        chevronPath(c, x, y, k, 0.27, 0.15);
        if (this.detail) this.sprite(NEON.amber, x + rx(k, 0.5, 0.62), y + ry(k, 0.5, 0.62), 0.16, 0.45 * n);
      }
    }
    if (!this.detail) return;
    if (BITS[mask] >= 3) this.crosswalks(this.gl.f(P.gZebra), x, y, mask, ROAD_HALF);
    // Street-lamp light pools on the sidewalk.
    const hv = this.h(x, y, 91);
    const col = hv < 0.7 ? WARM : hv < 0.9 ? COOL : NEON.magenta;
    if (mask === 5 || mask === 10) {
      const k = mask === 5 ? 0 : 1;
      const side = (x + y) & 1 ? 0.07 : 0.93;
      this.sprite(col, x + rx(k, side, 0.5), y + ry(k, side, 0.5), 0.36, 0.34 * n);
    } else if (BITS[mask] >= 3) {
      this.sprite(col, x + 0.08, y + 0.08, 0.34, 0.3 * n);
      this.sprite(col, x + 0.92, y + 0.92, 0.34, 0.3 * n);
    } else if (CORNER_K[mask] >= 0) {
      const ck = CORNER_K[mask];
      this.sprite(col, x + rx(ck, 0.12, 0.88), y + ry(ck, 0.12, 0.88), 0.34, 0.3 * n);
    } else {
      this.sprite(col, x + 0.5, y + 0.5, 0.3, 0.25 * n);
    }
  }

  private bridgeGlow(x: number, y: number) {
    const { N } = this;
    const P = this.pal;
    const t = this.world.tiles[y * N + x];
    const full = this.mask(x, y);
    const hwy = t.roadKind === RoadKind.Highway;
    const mask = hwy ? this.highwayArms(x, y, full) : full;
    const dh = deckHalf(t.roadKind);
    if (hwy || t.roadKind === RoadKind.Avenue) {
      const h = kindHalf(t.roadKind);
      const off = hwy ? HW_EDGE - 0.01 : h - 0.07;
      const g = this.gl.f(hwy ? P.gHwEdge : P.gAvEdge);
      const w = this.lw(this.lines ? 4.5 : 3);
      bandPath(g, x, y, mask, -off, w, 0.5 - h);
      bandPath(g, x, y, mask, off, w, 0.5 - h);
    } else this.laneMarks(this.gl, P.gLane, x, y, mask, this.lw(this.lines ? 5 : 3), !this.lines);
    if (!this.lines) return;
    const r = 3 / (2 * HALF_H);
    roadOutlinePath(this.gl.s((x + y) & 1 ? P.gRailA : P.gRailB, this.lw(3.5)), x - r, y - r, mask, dh - 0.025);
  }

  /** Soft radial glow sprite on the ground plane (tile space, additive; drawn immediately). */
  private sprite(c: RGB, cx: number, cy: number, r: number, alpha: number) {
    if (alpha < 0.01) return;
    const ctx = this.ctx;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(glowSprite(c, 64), cx - r, cy - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  // ── Additive glow pass (world space) ──────────────────────────────────────

  /** Vertical reflections of lit neighbours on water / wet asphalt and bridge lamp halos. */
  glowWorld(x: number, y: number) {
    const { N } = this;
    const t = this.world.tiles[y * N + x];
    if (!t.road && t.terrain !== Terrain.Water) return;
    if (!this.world.ownedAt(y * N + x)) return;
    if (!this.detail) return;
    const ctx = this.ctx;
    const n = this.pal.n;
    const wx = (x - y) * HALF_W;
    const wy = (x + y) * HALF_H;
    const water = t.terrain === Terrain.Water;
    // Light sources sitting "above" this tile on screen: NW (straight up), N (up-right), W (up-left).
    for (let k = 0; k < 3; k++) {
      const sx = k === 1 ? x : x - 1;
      const sy = k === 2 ? y : y - 1;
      const ox = k === 0 ? 0 : k === 1 ? 15 : -15;
      const c = lightColor(this.world, sx, sy);
      if (!c) continue;
      if (water) this.waterStreak(c, wx + ox, wy + (ox === 0 ? 3 : 9), x * 7 + y * 13 + ox, n);
      else {
        ctx.globalAlpha = 0.2 * n;
        ctx.drawImage(glowSprite(c, 32), wx + ox - 5, wy + (ox === 0 ? 4 : 8), 10, 18);
        ctx.globalAlpha = 1;
      }
    }
    if (water && t.road) {
      // Bridge lamp halos and their reflections.
      const full = this.mask(x, y);
      const mask = t.roadKind === RoadKind.Highway ? this.highwayArms(x, y, full) : full;
      const r = 3 / (2 * HALF_H);
      for (const [u, v] of bridgeLamps(mask, deckHalf(t.roadKind))) {
        const lu = x + u - r;
        const lv = y + v - r;
        const px = (lu - lv) * HALF_W;
        const py = (lu + lv) * HALF_H;
        const c = (x + y) & 1 ? NEON.cyan : NEON.magenta;
        ctx.globalAlpha = 0.55 * n;
        ctx.drawImage(glowSprite(NEON.white, 32), px - 4, py - 4, 8, 8);
        ctx.globalAlpha = 0.35 * n;
        ctx.drawImage(glowSprite(c, 32), px - 9, py - 9, 18, 18);
        ctx.globalAlpha = 1;
        this.waterStreak(c, px, py + 7, x * 3 + y * 5 + u * 10, n * 0.8);
      }
    }
  }

  /** Broken horizontal dashes fading downwards: a light's reflection on rippling water. */
  private waterStreak(c: RGB, cx: number, top: number, seed: number, n: number) {
    const ctx = this.ctx;
    ctx.fillStyle = css(c, 1);
    for (let k = 0; k < 4; k++) {
      const w = 8 - k * 1.4 + (hash2(seed, k, 3) - 0.5) * 3;
      const off = (hash2(seed, k, 5) - 0.5) * 3;
      ctx.globalAlpha = (0.42 - k * 0.09) * n;
      ctx.fillRect(cx - w / 2 + off, top + k * 3.6, w, 1.3);
    }
    ctx.globalAlpha = 0.22 * n;
    ctx.drawImage(glowSprite(c, 32), cx - 7, top - 3, 14, 20);
    ctx.globalAlpha = 1;
  }
}

/** Lamp positions (tile space, before rail lift) along a bridge deck of half-width `dh`. */
function bridgeLamps(mask: number, dh: number): [number, number][] {
  const a = 0.5 - dh + 0.025;
  const b = 0.5 + dh - 0.025;
  if (mask === 5) return [[a, 0.5], [b, 0.5]];
  if (mask === 10) return [[0.5, a], [0.5, b]];
  return [];
}

/** Cached CSS for a building's pad stripe (base or glow) at the palette's night level. */
function stripeColor(P: GroundPal, type: string, glow: boolean): string {
  const key = glow ? `g:${type}` : type;
  let s = P.stripes.get(key);
  if (!s) {
    const c = BUILDING_RGB.get(type) ?? NEON.cyan;
    s = glow ? css(c, 0.22 * P.n) : css(c, 0.32 + 0.2 * P.n);
    P.stripes.set(key, s);
  }
  return s;
}

// ── Chunk cache ────────────────────────────────────────────────────────────

interface Chunk {
  k: number;
  /** Skyline view chunk (roof tints baked in, MEGACITY §3.9): a separate bucket of the same scale. */
  sky: boolean;
  i: number;
  j: number;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  /** No map tile touches this chunk: nothing to draw, ever. */
  empty: boolean;
  /** Holds valid (possibly stale) content. */
  rendered: boolean;
  /** Night bucket the content was baked with. */
  night: number;
  /** World rect that changed since the last render (partial redraw), or null. */
  dirty: Rect | null;
  /** Frame stamp of last use (LRU). */
  used: number;
}

function scaleOf(k: number): number {
  return k === OVERVIEW ? OVERVIEW_SCALE : Math.pow(2, k / 4);
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** World rect covered by an inclusive tile rect, expanded by the ground spill. */
export function tileRectToWorld(r: Rect): Rect {
  return {
    x0: (r.x0 - r.y1 - 1) * HALF_W - SPILL,
    x1: (r.x1 + 1 - r.y0) * HALF_W + SPILL,
    y0: (r.x0 + r.y0) * HALF_H - SPILL,
    y1: (r.x1 + r.y1 + 2) * HALF_H + SPILL,
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The overview fallback's memory cap (§3.9: within 4 MB, unless the view itself needs more chunks). */
const OVERVIEW_BUDGET = 4 * 1024 * 1024;
const chunkKey = (k: number, sky: boolean, i: number, j: number) => `${k}:${sky ? 1 : 0}:${i}:${j}`;

/** Owns the chunk canvases and draws the cached ground every frame. */
export class GroundCache {
  private chunks = new Map<string, Chunk>();
  private pool: HTMLCanvasElement[] = [];
  private painter = new GroundPainter();
  private info: TerrainInfo | null = null;
  private frame = 0;
  private bucket = 0;
  private prevBucket = 0;
  /** Skyline-view chunks are drawn (and the previous frame's mode, for the fallback while the new mode paints). */
  private sky = false;
  private prevSky = false;
  /** The frame of the world the chunks show (MEGACITY §3.1): side, chunk-grid x origin, tile buffer. Set by bind(). */
  private N = 0;
  private OX = 0;
  private tileBuf = new Int32Array(0);
  private sparkle: HTMLCanvasElement | null = null;
  private lastZoom = 0;
  private zoomMovedAt = -1e9;
  private overviewNightAt = -1e9;
  /** Rough cost of the last full chunk render (ms), for diagnostics / budgeting. */
  lastChunkMs = 0;

  /** Drop everything (world replaced / quality change). */
  reset() {
    for (const c of this.chunks.values()) this.release(c);
    this.chunks.clear();
    this.buckets.clear();
    this.info = null;
  }

  /**
   * Pump House reclamation changed the terrain in `r` (the 'terrain' event, MEGACITY §3.9 R0): water depth is patched
   * locally and the chunks around it repaint, instead of a whole-map TerrainInfo rebuild.
   */
  patchTerrain(world: World, r: Rect) {
    if (this.info && this.N === world.N) this.info.patch(world, r);
    const m = 7;
    this.invalidate({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
  }

  /**
   * Tiles changed: mark the affected world rect dirty on the rendered chunks it touches. MEGACITY §3.9 R0: the chunks
   * are looked up by index range in each bucket in use (a growth event touches one to four per bucket), not by a walk
   * over every chunk, so dozens of 'tiles' events a frame at speed 3 stay cheap.
   */
  invalidate(tiles: Rect) {
    if (!this.N) return;
    const r = tileRectToWorld(tiles);
    for (const b of this.buckets.values()) {
      const rg = this.range(b.k, r);
      for (let j = rg.j0; j <= rg.j1; j++)
        for (let i = rg.i0; i <= rg.i1; i++) {
          const c = this.chunks.get(chunkKey(b.k, b.sky, i, j));
          if (!c || !c.rendered || c.empty) continue;
          if (!intersects(r, this.chunkRect(c))) continue;
          c.dirty = c.dirty
            ? { x0: Math.min(c.dirty.x0, r.x0), y0: Math.min(c.dirty.y0, r.y0), x1: Math.max(c.dirty.x1, r.x1), y1: Math.max(c.dirty.y1, r.y1) }
            : r;
        }
    }
  }

  /** The (bucket, view band) pairs that hold chunks: invalidate looks only there. */
  private buckets = new Map<string, { k: number; sky: boolean }>();

  terrain(world: World): TerrainInfo {
    if (!this.info) this.info = new TerrainInfo(world);
    return this.info;
  }

  /**
   * Bind the chunk grid to `world`'s frame; a different side drops every chunk. MEGACITY §3.9: the ground paints the
   * whole region, locked slots as fog (deeper past the peek margin), so there is no hole at any zoom; the overview
   * fallback covers the visible part of the owned box ± the peek margin. An annex moves the boundary (fog, stubs,
   * water shading), so it rebuilds TerrainInfo and every chunk.
   */
  private box = { x0: 0, y0: 0, x1: -1, y1: -1 };
  /** The owned box ± ANNEX.peek: the overview's reach. */
  private peekBox = { x0: 0, y0: 0, x1: -1, y1: -1 };
  private boxKey = '';

  private bind(world: World) {
    const b = world.ownedBox;
    const key = `${b.x0},${b.y0},${b.x1},${b.y1},${world.slotsVersion}`;
    if (world.N === this.N && key === this.boxKey) return;
    this.reset();
    this.N = world.N;
    this.OX = -world.N * HALF_W - 32;
    this.tileBuf = new Int32Array(world.area);
    const N = world.N;
    this.box = { x0: 0, y0: 0, x1: N - 1, y1: N - 1 };
    const p = ANNEX.peek;
    this.peekBox = { x0: Math.max(0, b.x0 - p), y0: Math.max(0, b.y0 - p), x1: Math.min(N - 1, b.x1 + p), y1: Math.min(N - 1, b.y1 + p) };
    this.boxKey = key;
  }

  /** Padded world rect a chunk canvas covers. */
  private chunkRect(c: Chunk): Rect {
    const s = scaleOf(c.k);
    const W = CHUNK_PX / s;
    const p = PAD / s;
    const x0 = this.OX + c.i * W;
    const y0 = OY + c.j * W;
    return { x0: x0 - p, y0: y0 - p, x1: x0 + W + p, y1: y0 + W + p };
  }

  private release(c: Chunk) {
    if (c.canvas && this.pool.length < 6) this.pool.push(c.canvas);
    c.canvas = null;
    c.ctx = null;
    c.rendered = false;
  }

  /**
   * Cache scale bucket for a device-px-per-world-px `scale`. Keeps the current
   * bucket while it is a good match (hysteresis), and much longer while the
   * zoom is moving so a pinch doesn't trigger a re-render storm; once the zoom
   * settles the ideal (crisp) bucket takes over.
   */
  private pickBucket(scale: number, moving: boolean): number {
    if (scale <= 0.27 && !(moving && this.bucket !== OVERVIEW && scaleOf(this.bucket) <= scale * 1.6)) return OVERVIEW;
    const cur = scaleOf(this.bucket);
    if (this.bucket !== OVERVIEW) {
      if (cur >= scale * 0.94 && cur <= scale * 1.3) return this.bucket;
      if (moving && cur >= scale * 0.7 && cur <= scale * 1.6) return this.bucket;
    } else if (moving && cur >= scale * 0.7) return this.bucket;
    return Math.min(12, Math.ceil(4 * Math.log2(scale * 0.94)));
  }

  private getChunk(k: number, i: number, j: number, sky = this.sky): Chunk {
    const key = chunkKey(k, sky, i, j);
    let c = this.chunks.get(key);
    if (!c) {
      const bk = `${k}:${sky ? 1 : 0}`;
      if (!this.buckets.has(bk)) this.buckets.set(bk, { k, sky });
      c = { k, sky, i, j, canvas: null, ctx: null, empty: false, rendered: false, night: -1, dirty: null, used: 0 };
      c.empty = this.collectTiles(this.chunkRect(c)) === 0;
      this.chunks.set(key, c);
    }
    return c;
  }

  /** Fill tileBuf with tile indices (draw order) whose ground art may touch `r`. Returns count. */
  private collectTiles(r: Rect): number {
    const { N } = this;
    const ax0 = r.x0 - HALF_W - SPILL;
    const ax1 = r.x1 + HALF_W + SPILL;
    const ay0 = r.y0 - 2 * HALF_H - SPILL;
    const ay1 = r.y1 + SPILL;
    const tx = (wx: number, wy: number) => (wy / HALF_H + wx / HALF_W) / 2;
    const ty = (wx: number, wy: number) => (wy / HALF_H - wx / HALF_W) / 2;
    const bx = this.box;
    const x0 = Math.max(0, bx.x0, Math.floor(tx(ax0, ay0)));
    const x1 = Math.min(N - 1, bx.x1, Math.ceil(tx(ax1, ay1)));
    const y0 = Math.max(0, bx.y0, Math.floor(ty(ax1, ay0)));
    const y1 = Math.min(N - 1, bx.y1, Math.ceil(ty(ax0, ay1)));
    let n = 0;
    if (x0 > x1 || y0 > y1) return 0;
    for (let s = x0 + y0; s <= x1 + y1; s++) {
      const xa = Math.max(x0, s - y1);
      const xb = Math.min(x1, s - y0);
      for (let x = xa; x <= xb; x++) {
        const y = s - x;
        const wx = (x - y) * HALF_W;
        const wy = (x + y) * HALF_H;
        if (wx + HALF_W + SPILL < r.x0 || wx - HALF_W - SPILL > r.x1) continue;
        if (wy + 2 * HALF_H + SPILL < r.y0 || wy - SPILL > r.y1) continue;
        this.tileBuf[n++] = y * N + x;
      }
    }
    return n;
  }

  /** Paint a chunk (fully, or only `clip` in world px). */
  private renderChunk(c: Chunk, world: World, nightBucket: number, clip: Rect | null) {
    const N = world.N;
    const t0 = now();
    if (!c.canvas) {
      c.canvas = this.pool.pop() ?? document.createElement('canvas');
      c.canvas.width = CANVAS_PX;
      c.canvas.height = CANVAS_PX;
      c.ctx = c.canvas.getContext('2d');
      clip = null;
    }
    const ctx = c.ctx;
    if (!ctx) return;
    const s = scaleOf(c.k);
    const W = CHUNK_PX / s;
    const ox = this.OX + c.i * W;
    const oy = OY + c.j * W;
    const full = this.chunkRect(c);
    let r = full;
    let px0 = 0;
    let py0 = 0;
    let px1 = CANVAS_PX;
    let py1 = CANVAS_PX;
    if (clip) {
      px0 = Math.max(0, Math.floor((clip.x0 - ox) * s + PAD));
      py0 = Math.max(0, Math.floor((clip.y0 - oy) * s + PAD));
      px1 = Math.min(CANVAS_PX, Math.ceil((clip.x1 - ox) * s + PAD));
      py1 = Math.min(CANVAS_PX, Math.ceil((clip.y1 - oy) * s + PAD));
      if (px1 <= px0 || py1 <= py0) return;
      r = { x0: (px0 - PAD) / s + ox, y0: (py0 - PAD) / s + oy, x1: (px1 - PAD) / s + ox, y1: (py1 - PAD) / s + oy };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px0, py0, px1 - px0, py1 - py0);
      ctx.clip();
    }
    ctx.clearRect(px0, py0, px1 - px0, py1 - py0);
    const count = this.collectTiles(r);
    const info = this.terrain(world);
    const P = this.painter;
    P.begin(ctx, world, info, nightBucket, s, c.sky);
    const tx = PAD - ox * s;
    const ty = PAD - oy * s;
    // Base pass in tile space.
    ctx.setTransform(s, 0, 0, s, tx, ty);
    ctx.transform(HALF_W, HALF_H, -HALF_W, HALF_H, 0, 0);
    const buf = this.tileBuf;
    for (let n = 0; n < count; n++) P.base(buf[n] % N, (buf[n] / N) | 0);
    P.flushBase();
    // Night glow passes (additive; order independent).
    if (nightBucket > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (let n = 0; n < count; n++) P.glowTile(buf[n] % N, (buf[n] / N) | 0);
      P.flushGlow();
      ctx.setTransform(s, 0, 0, s, tx, ty);
      for (let n = 0; n < count; n++) P.glowWorld(buf[n] % N, (buf[n] / N) | 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    P.end();
    if (clip) ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    c.dirty = null;
    if (!clip) {
      c.rendered = true;
      c.night = nightBucket;
      this.lastChunkMs = now() - t0;
    }
  }

  /** Visible chunk index range of bucket k for a world rect. */
  private range(k: number, v: Rect) {
    const { N } = this;
    const W = CHUNK_PX / scaleOf(k);
    const maxI = Math.floor((N * HALF_W + SPILL - this.OX) / W);
    const maxJ = Math.floor((N * 2 * HALF_H + SPILL - OY) / W);
    return {
      i0: Math.max(0, Math.floor((v.x0 - this.OX) / W)),
      i1: Math.min(maxI, Math.floor((v.x1 - this.OX) / W)),
      j0: Math.max(0, Math.floor((v.y0 - OY) / W)),
      j1: Math.min(maxJ, Math.floor((v.y1 - OY) / W)),
    };
  }

  /**
   * Draw the cached ground for the current view. Leaves the context transform
   * in an unspecified state (caller resets it).
   */
  draw(ctx: CanvasRenderingContext2D, world: World, view: GroundView, night: number, budgetMs: number, skyline = false) {
    this.bind(world);
    this.frame++;
    if (skyline !== this.sky) {
      this.prevSky = this.sky;
      this.sky = skyline;
      this.prevBucket = this.bucket;
    }
    const frame = this.frame;
    const nightBucket = Math.round(Math.max(0, Math.min(1, night)) * NIGHT_STEPS);
    const scale = view.zoom * view.dpr;
    const t = now();
    if (Math.abs(view.zoom - this.lastZoom) > 1e-4) {
      this.lastZoom = view.zoom;
      this.zoomMovedAt = t;
    }
    const k = this.pickBucket(scale, t - this.zoomMovedAt < 180);
    if (k !== this.bucket) {
      this.prevBucket = this.bucket;
      this.bucket = k;
    }
    const hw = view.width / 2 / view.zoom;
    const hh = view.height / 2 / view.zoom;
    const vr: Rect = { x0: view.camX - hw, y0: view.camY - hh, x1: view.camX + hw, y1: view.camY + hh };

    // Collect visible chunks of the current bucket.
    const vis: Chunk[] = [];
    const rg = this.range(k, vr);
    for (let j = rg.j0; j <= rg.j1; j++)
      for (let i = rg.i0; i <= rg.i1; i++) {
        const c = this.getChunk(k, i, j);
        if (c.empty) continue;
        c.used = frame;
        vis.push(c);
      }
    // The overview fallback (MEGACITY §3.9): the visible part of the owned box ± peek (plus a margin for pans), at
    // OVERVIEW_SCALE, built progressively as the camera moves, within OVERVIEW_BUDGET.
    const ov: Chunk[] = [];
    const ovView: Chunk[] = [];
    if (k !== OVERVIEW) {
      const b = this.peekBox;
      const ob: Rect = {
        x0: (b.x0 - b.y1 - 1) * HALF_W - SPILL,
        y0: (b.x0 + b.y0) * HALF_H - SPILL,
        x1: (b.x1 - b.y0 + 1) * HALF_W + SPILL,
        y1: (b.x1 + b.y1 + 2) * HALF_H + SPILL,
      };
      const mx = (vr.x1 - vr.x0) * 0.25;
      const my = (vr.y1 - vr.y0) * 0.25;
      const want: Rect = { x0: Math.max(ob.x0, vr.x0 - mx), y0: Math.max(ob.y0, vr.y0 - my), x1: Math.min(ob.x1, vr.x1 + mx), y1: Math.min(ob.y1, vr.y1 + my) };
      if (want.x0 < want.x1 && want.y0 < want.y1) {
        const orr = this.range(OVERVIEW, want);
        const Wo = CHUNK_PX / OVERVIEW_SCALE;
        for (let j = orr.j0; j <= orr.j1; j++)
          for (let i = orr.i0; i <= orr.i1; i++) {
            const c = this.getChunk(OVERVIEW, i, j);
            if (c.empty) continue;
            ov.push(c);
            const cx0 = this.OX + i * Wo;
            const cy0 = OY + j * Wo;
            if (cx0 < vr.x1 && cx0 + Wo > vr.x0 && cy0 < vr.y1 && cy0 + Wo > vr.y0) ovView.push(c);
          }
      }
    }

    // ── Render work, most urgent first, within the frame budget ──
    const t0 = now();
    const spent = () => now() - t0;
    const ccx0 = view.camX;
    const ccy0 = view.camY;
    const Wov = CHUNK_PX / OVERVIEW_SCALE;
    const ovDist = (c: Chunk) => Math.abs(this.OX + (c.i + 0.5) * Wov - ccx0) + Math.abs(OY + (c.j + 0.5) * Wov - ccy0);
    // Missing overview chunks in view: one a frame at least, nearest first (the current bucket is the real picture).
    const ovMissing = ov.filter((c) => !c.rendered);
    if (ovMissing.length > 1) ovMissing.sort((a, b) => (ovView.includes(a) ? 0 : 1) - (ovView.includes(b) ? 0 : 1) || ovDist(a) - ovDist(b));
    let ovDid = 0;
    for (const c of ovMissing) {
      if (ovDid > 0 && spent() > budgetMs * 0.4) break;
      this.renderChunk(c, world, nightBucket, null);
      ovDid++;
    }
    const fallbackReady = k === OVERVIEW || ovView.every((c) => c.rendered);
    // 1) partial redraws of visible chunks (edits must show immediately)
    //    (in the chunk's own night bucket so a stale chunk stays self-consistent)
    for (const c of vis) if (c.rendered && c.dirty) this.renderChunk(c, world, c.night, c.dirty);
    let did = 0;
    // Most of a chunk's cost is rasterisation, which the browser defers to the
    // blit, so besides the time budget the number of full renders per frame is
    // capped. Chunks nearest the screen centre sharpen first.
    const cap = budgetMs < 4 ? 1 : 2;
    const ccx = view.camX;
    const ccy = view.camY;
    const W = CHUNK_PX / scaleOf(k);
    const dist = (c: Chunk) => Math.abs(this.OX + (c.i + 0.5) * W - ccx) + Math.abs(OY + (c.j + 0.5) * W - ccy);
    const pending = vis.filter((c) => !c.rendered || c.night !== nightBucket);
    if (pending.length > 1) pending.sort((a, b) => (a.rendered ? 1 : 0) - (b.rendered ? 1 : 0) || dist(a) - dist(b));
    // 2) missing chunks, then 3) night-stale chunks (the stale copy keeps drawing meanwhile)
    for (const c of pending) {
      const mustRender = !c.rendered && !fallbackReady;
      if (!mustRender && did > 0 && (did >= cap || spent() > budgetMs)) break;
      this.renderChunk(c, world, nightBucket, null);
      did++;
    }
    // 4) keep the fallback overview reasonably fresh: edits whenever there is
    //    time; night changes only on otherwise idle frames, at most every 1.5 s.
    for (const c of ov) {
      if (c.rendered && c.dirty && spent() < budgetMs * 0.5) this.renderChunk(c, world, c.night, c.dirty);
      if (c.night !== nightBucket && did === 0 && spent() < 1 && now() - this.overviewNightAt > 1500) {
        this.renderChunk(c, world, nightBucket, null);
        this.overviewNightAt = now();
        did++;
      }
    }

    // ── Blit ──
    const missing = vis.some((c) => !c.rendered || c.sky !== this.sky);
    if (missing) {
      this.blit(ctx, ov, view);
      // The previous bucket (or the other view band's chunks at this scale) while the new ones paint.
      const pk = this.prevBucket;
      const pSky = this.prevSky;
      if ((pk !== k || pSky !== this.sky) && pk !== OVERVIEW) {
        const prev: Chunk[] = [];
        const pr = this.range(pk, vr);
        for (let j = pr.j0; j <= pr.j1; j++)
          for (let i = pr.i0; i <= pr.i1; i++) {
            const c = this.chunks.get(chunkKey(pk, pSky, i, j)) ?? this.chunks.get(chunkKey(pk, !pSky, i, j));
            if (c && c.rendered) {
              c.used = frame;
              prev.push(c);
            }
          }
        this.blit(ctx, prev, view);
      }
    }
    this.blit(ctx, vis, view);
    for (const c of ov) c.used = frame;
    this.evict(vis.length + ov.length, ov.length);
  }

  private blit(ctx: CanvasRenderingContext2D, list: Chunk[], view: GroundView) {
    if (!list.length) return;
    const k = list[0].k;
    const s = scaleOf(k);
    const f = (view.zoom * view.dpr) / s;
    // Shared transform for every chunk of the bucket: cache px → device px.
    const tx = Math.round(((this.OX - view.camX) * view.zoom + view.width / 2) * view.dpr);
    const ty = Math.round(((OY - view.camY) * view.zoom + view.height / 2) * view.dpr);
    ctx.setTransform(f, 0, 0, f, tx, ty);
    ctx.imageSmoothingEnabled = true;
    for (const c of list) {
      if (!c.rendered || !c.canvas) continue;
      ctx.drawImage(c.canvas, c.i * CHUNK_PX - PAD, c.j * CHUNK_PX - PAD);
    }
  }

  /**
   * LRU eviction down to the memory budget (never below what this frame needs): the overview's chunks within
   * OVERVIEW_BUDGET (or what the view needs of them), the rest within MEMORY_BUDGET.
   */
  private evict(needed: number, ovNeeded = 0) {
    const maxChunks = Math.max(Math.floor(MEMORY_BUDGET / CHUNK_BYTES), needed + 4);
    const maxOv = Math.max(Math.floor(OVERVIEW_BUDGET / CHUNK_BYTES), ovNeeded);
    let live = 0;
    let liveOv = 0;
    for (const [key, c] of this.chunks) {
      if (c.canvas) {
        if (c.k === OVERVIEW) liveOv++;
        else live++;
      }
      // Forget bookkeeping for long-unused canvas-less chunks (old zoom buckets, the overview's old views).
      else if (c.k !== this.bucket && this.frame - c.used > 600) this.chunks.delete(key);
    }
    const drop = (ov: boolean, max: number, n: number) => {
      if (n <= max) return;
      const list = [...this.chunks.values()].filter((c) => c.canvas && (c.k === OVERVIEW) === ov && c.used !== this.frame);
      list.sort((a, b) => a.used - b.used);
      for (const c of list) {
        if (n <= max) break;
        this.release(c);
        this.chunks.delete(chunkKey(c.k, c.sky, c.i, c.j));
        n--;
      }
    };
    drop(false, maxChunks, live);
    drop(true, maxOv, liveOv);
  }

  /** Live chunk counts (tests, diagnostics): the current buckets and the overview. */
  get chunkCounts(): { live: number; overview: number } {
    let live = 0;
    let overview = 0;
    for (const c of this.chunks.values()) if (c.canvas) c.k === OVERVIEW ? overview++ : live++;
    return { live, overview };
  }

  /** Approximate bytes held by chunk canvases (for diagnostics). */
  get memoryBytes(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.canvas) n++;
    return n * CHUNK_BYTES;
  }

  // ── Per-frame animated ground bits ───────────────────────────────────────

  /**
   * Water sparkles and the slow "breathing" glow of the street grid at night.
   * World-space transform expected. Cheap: one sprite per tile at most.
   */
  /** `presence` (0..1, VisualState): while a MOTH card is open the street glow breathes on a slow 4 s cycle. */
  drawAnimated(ctx: CanvasRenderingContext2D, world: World, b: Rect, env: ArtEnv, view: Rect, presence = 0) {
    const N = world.N;
    if (env.zoom < 0.3) return;
    const breath = presence > 0.01 ? 1 + presence * (1.2 + 1.6 * (0.5 + 0.5 * Math.sin((env.time * Math.PI * 2) / 4))) : 1;
    const info = this.terrain(world);
    const o = info.o;
    const n = env.night;
    const time = env.time;
    const low = env.quality === 'low';
    const sparkle = this.sparkleSprite();
    const pulseOn = n > 0.15 && (!low || presence > 0.01) && (env.zoom >= 0.6 || presence > 0.01);
    // Fewer sparkles when zoomed out (they are tiny there anyway) or on low quality.
    const density = (low ? 0.5 : 1) * (env.zoom < 0.6 ? 0.45 : 1);
    const halo = env.zoom >= 0.6;
    const pulse = glowSprite(mix(NEON.amber, NEON.magenta, 0.35), 64);
    const flicker = n > 0.2 && !low && env.zoom >= 0.45;
    const violet = glowSprite(ALLEY_RGB, 32);
    const lanterns = n > 0.25 && env.zoom >= 0.4;
    const lantern = glowSprite([255, 150, 70], 32);
    // Stepped by 1/32 of the night value: a bounded set of cached glow sprites at dusk and dawn.
    const tint = mix([255, 255, 255], [120, 220, 255], Math.round(n * 32) / 32);
    const sparkTint = glowSprite(tint as RGB, 32);
    const tiles = world.tiles;
    ctx.globalCompositeOperation = 'lighter';
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const wx = (x - y) * HALF_W;
        const wy = (x + y) * HALF_H;
        if (wx + HALF_W < view.x0 || wx - HALF_W > view.x1 || wy + 2 * HALF_H < view.y0 || wy > view.y1) continue;
        const t = tiles[y * N + x];
        if (t.terrain === Terrain.Water && !t.road) {
          const h = hash2(x - o, y - o, info.seed + 11);
          if (h > density) continue;
          const ph = time * (0.9 + h * 0.8) + h * 40;
          const wave = Math.sin(ph);
          if (wave <= 0.55) continue;
          const a = (wave - 0.55) * 2.2 * (0.35 + 0.45 * n) * (info.depth[y * N + x] > 1 ? 1 : 0.7);
          const drift = Math.sin(time * 0.4 + h * 9) * 5;
          const cx = wx + (hash2(x - o, y - o, 3) - 0.5) * 30 + drift;
          const cy = wy + 16 + (hash2(x - o, y - o, 4) - 0.5) * 12;
          const w = 10 + h * 10;
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(sparkle, cx - w / 2, cy - 1.5, w, 3);
          if (halo) {
            ctx.globalAlpha = Math.min(1, a * 0.5);
            ctx.drawImage(sparkTint, cx - w * 0.6, cy - 4, w * 1.2, 8);
          }
        } else if (t.road) {
          if (lanterns && t.roadKind === RoadKind.Alley && world.kindAt(x, y) === 'bazaar') {
            // Verdigris Bazaar's paper lanterns over the alleys (§3.9 district ground character), swaying warm.
            const h = hash2(x - o, y - o, info.seed + 31);
            ctx.globalAlpha = Math.min(1, n * (0.45 + 0.2 * Math.sin(time * (1.3 + h) + h * 20)));
            ctx.drawImage(lantern, wx - 14, wy + 6, 28, 18);
          }
          if (flicker && t.roadKind === RoadKind.Alley && hash2(x - o, y - o, info.seed + 23) < 0.26) {
            // A violet sign over the alley, buzzing on and off.
            const h = hash2(x - o, y - o, info.seed + 29);
            const on = Math.sin(time * (7 + h * 5) + h * 30) + Math.sin(time * 2.3 + h * 11) > -0.4 ? 1 : 0.15;
            const side = h < 0.5 ? -9 : 9;
            ctx.globalAlpha = Math.min(1, n * 0.55 * on);
            ctx.drawImage(violet, wx + side - 10, wy + 4, 20, 16);
          }
          if (!pulseOn) continue;
          const a = n * 0.11 * breath * (0.5 + 0.5 * Math.sin(time * 1.4 - (x + y) * 0.42));
          if (a < 0.01) continue;
          ctx.globalAlpha = a;
          ctx.drawImage(pulse, wx - 30, wy + 1, 60, 30);
        }
      }
    }
    if (env.zoom >= 0.45) this.runwayLights(ctx, world, b, env, view);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Runway edge lights running towards the touchdown end (§5.2), brighter at night. Additive, world space. */
  private runwayLights(ctx: CanvasRenderingContext2D, world: World, b: Rect, env: ArtEnv, view: Rect) {
    const g = glowSprite(NEON.white, 32);
    const amp = 0.25 + 0.75 * env.night;
    for (const bd of world.buildings.values()) {
      if (bd.type !== 'airport') continue;
      if (bd.x > b.x1 + 1 || bd.x + bd.size < b.x0 - 1 || bd.y > b.y1 + 1 || bd.y + bd.size < b.y0 - 1) continue;
      const n = bd.size * 2;
      for (const v of [bd.y + 1.03, bd.y + 2.97]) {
        for (let k = 0; k < n; k++) {
          const u = bd.x + 0.25 + k * 0.5;
          const ph = (((k - env.time * 7) % n) + n) % n;
          const a = amp * (0.25 + 0.75 * Math.max(0, 1 - ph / 2.5));
          const wx = (u - v) * HALF_W;
          const wy = (u + v) * HALF_H;
          if (wx < view.x0 - 8 || wx > view.x1 + 8 || wy < view.y0 - 8 || wy > view.y1 + 8) continue;
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(g, wx - 4, wy - 3, 8, 6);
        }
      }
    }
  }

  private sparkleSprite(): HTMLCanvasElement {
    if (this.sparkle) return this.sparkle;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 8;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 4, 0, 16, 4, 16);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(210,240,255,0.45)');
    grad.addColorStop(1, 'rgba(160,220,255,0)');
    g.setTransform(1, 0, 0, 0.25, 0, 3);
    g.fillStyle = grad;
    g.fillRect(0, -16, 32, 32);
    this.sparkle = c;
    return c;
  }
}

