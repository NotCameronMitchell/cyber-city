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
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, ZONES } from '../game/config';
import { fbm, hash2 } from '../game/rng';
import { MAP_SIZE, Terrain, ZoneType, type Tile } from '../game/types';
import type { World } from '../game/world';
import type { ArtEnv } from './buildings';
import { HALF_H, HALF_W } from './camera';
import { MATERIAL, NEON, css, glowSprite, hexToRgb, lit, mix, shade, type RGB } from './palette';

const N = MAP_SIZE;
const TAU = Math.PI * 2;
const HP = Math.PI / 2;

/** World px measured perpendicular to a tile edge, per tile-space unit. */
const PERP = (2 * HALF_W * HALF_H) / Math.hypot(HALF_W, HALF_H);
/** Asphalt half-width of a road (tile units). Sidewalks fill the rest. */
export const ROAD_HALF = 0.3;
/** Bridge deck half-width (tile units). */
const DECK_HALF = 0.36;
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
/** Chunk grid origin in world px (just outside the map's bounding box). */
const OX = -N * HALF_W - 32;
const OY = -32;
/** Special bucket id: whole map at a tiny fixed scale, always kept. */
const OVERVIEW = -100;
const OVERVIEW_SCALE = 0.235;
const NIGHT_STEPS = 12;

/** Bit per direction, matching World.roadMask: N, E, S, W. */
const DIR = [1, 2, 4, 8];
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
  readonly tone = new Uint8Array(N * N);
  /** Water: 1..6 distance to land (1 = shoreline). Land: 0. */
  readonly depth = new Uint8Array(N * N);
  readonly seed: number;

  constructor(world: World) {
    this.seed = world.seed % 100000;
    const tiles = world.tiles;
    const queue: number[] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        // Large-scale variation + a patchwork of old 4×4 lots + per-tile noise.
        const v =
          fbm(x * 0.09, y * 0.09, this.seed + 3, 3) * 0.62 +
          hash2(x >> 2, y >> 2, this.seed + 9) * 0.12 +
          hash2(x, y, this.seed + 5) * 0.26;
        this.tone[i] = Math.max(0, Math.min(7, Math.floor(v * 8)));
        if (tiles[i].terrain !== Terrain.Water) continue;
        let shore = false;
        for (let dy = -1; dy <= 1 && !shore; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const t = world.tileAt(x + dx, y + dy);
            if (t && t.terrain === Terrain.Land) {
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
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (tiles[j].terrain === Terrain.Water && this.depth[j] === 0) {
          this.depth[j] = d + 1;
          queue.push(j);
        }
      }
    }
    for (let i = 0; i < N * N; i++) if (tiles[i].terrain === Terrain.Water && this.depth[i] === 0) this.depth[i] = 6;
  }
}

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
}

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

  private palCache = new Map<number, GroundPal>();
  /** Layers: base fills → surface details → structures → markings; then glow. */
  private b0 = new Batch();
  private b1 = new Batch();
  private b2 = new Batch();
  private b3 = new Batch();
  private gl = new Batch();
  private bridges: number[] = [];

  begin(ctx: CanvasRenderingContext2D, world: World, info: TerrainInfo, nightBucket: number, scale: number) {
    this.ctx = ctx;
    this.world = world;
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
    this.b2.prime([...P.asphalt, P.patch, P.wallFace, P.wallDark]);
    this.b3.prime([P.grid, P.gridFar, P.gridMajor, P.quay, P.lip, P.edge, P.lane, P.zebra]);
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
    return hash2(x, y, this.info.seed * 31 + salt);
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
    const t = this.world.tiles[y * N + x];
    if (t.terrain === Terrain.Water) {
      this.water(x, y);
      if (t.road) this.bridges.push(y * N + x);
      return;
    }
    if (t.road) this.road(x, y);
    else if (t.buildingId >= 0) this.buildingPad(x, y, t);
    else if (t.zone !== ZoneType.None) this.lot(x, y, t);
    else this.land(x, y);
    if (this.lines) this.quay(x, y);
    // Gang turf: a colour wash over the street, by strength (§3.7).
    const i = y * N + x;
    const owner = this.world.turf.owner[i];
    if (owner === 1 || owner === 2) {
      const st = this.world.turf.str[i];
      this.b1.f(this.pal.turfWash[owner][st >= 75 ? 3 : st >= 50 ? 2 : st >= 25 ? 1 : 0]).rect(x, y, 1, 1);
    }
  }

  /** Draw all queued base geometry, then bridges (which need strict per-tile order). */
  flushBase() {
    const ctx = this.ctx;
    this.b0.flush(ctx);
    this.b1.flush(ctx);
    this.b2.flush(ctx);
    this.b3.flush(ctx);
    for (const i of this.bridges) this.bridge(i % N, (i / N) | 0);
    this.bridges.length = 0;
  }

  /** Is this tile bare land (no road, zone or building)? */
  private isBare(x: number, y: number): boolean {
    const t = this.world.tileAt(x, y);
    return !!t && t.terrain === Terrain.Land && !t.road && t.zone === ZoneType.None && t.buildingId < 0;
  }

  /** Old poured-concrete foundations occupy hashed 2×2 blocks of bare land. */
  private isSlab(x: number, y: number): boolean {
    return hash2(x >> 1, y >> 1, this.info.seed * 31 + 120) < 0.16 && this.isBare(x, y);
  }

  private land(x: number, y: number) {
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
    if (!this.lines && !t.abandoned) this.b1.f(P.zoneFar[z]).rect(x, y, 1, 1);
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
    this.tileRect(this.b0.f(P.bpad), x, y);
    if (!this.lines) return;
    const b = this.world.buildings.get(t.buildingId);
    if (!b) return;
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

  private road(x: number, y: number) {
    const P = this.pal;
    const mask = this.world.roadMask(x, y);
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
    const hv = this.h(x, y, 70);
    roadShapePath(this.b2.f(P.asphalt[Math.floor(hv * 3)]), x, y, mask, ROAD_HALF, this.px * 0.6);
    if (this.detail && hv < 0.3) {
      // Asphalt repair patch / manhole.
      const p = this.b2.f(P.patch);
      if (hv < 0.15) circlePath(p, x + 0.5 + (this.h(x, y, 71) - 0.5) * 0.3, y + 0.5 + (this.h(x, y, 72) - 0.5) * 0.3, 0.06);
      else p.rect(x + 0.32 + this.h(x, y, 73) * 0.2, y + 0.25 + this.h(x, y, 74) * 0.3, 0.16, 0.22);
    }
    if (!this.lines) {
      // Far LOD: a single centre stripe keeps the network readable.
      this.laneMarks(this.b3, P.lane, x, y, mask, this.lw(1.2), true);
      return;
    }
    roadOutlinePath(this.b3.s(P.curb, this.lw(1.2), 'square'), x, y, mask, ROAD_HALF);
    if (this.fine) this.edgeLines(this.b3, P.edge, x, y, mask, this.lw(0.8), ROAD_HALF);
    this.laneMarks(this.b3, P.lane, x, y, mask, this.lw(1.4), false);
    if (this.detail && BITS[mask] >= 3) this.crosswalks(this.b3.f(P.zebra), x, y, mask);
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

  /** Zebra crossings on every arm of a junction. */
  private crosswalks(p: CanvasPath, x: number, y: number, mask: number) {
    const a = 0.5 - ROAD_HALF;
    for (let k = 0; k < 4; k++) {
      if (!(mask & DIR[k])) continue;
      for (let s = 0; s < 5; s++) rrect(p, x, y, k, a + 0.02 + s * 0.12, 0.03, 0.065, a - 0.06);
    }
  }

  private water(x: number, y: number) {
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

  /** Bridge deck, pillar and rails. Drawn directly (after the batched layers), in tile order. */
  private bridge(x: number, y: number) {
    const ctx = this.ctx;
    const P = this.pal;
    const mask = this.world.roadMask(x, y);
    const c = BITS[mask];
    // Pillar under straight runs (every other tile) and under stubs.
    if (((mask === 5 || mask === 10) && ((x + y) & 1) === 0) || c <= 1) {
      const p0 = 0.43;
      const p1 = 0.57;
      const e = 16 / (2 * HALF_H);
      ctx.fillStyle = P.pillarA;
      ctx.beginPath();
      ctx.moveTo(x + p1, y + p0);
      ctx.lineTo(x + p1, y + p1);
      ctx.lineTo(x + p1 + e, y + p1 + e);
      ctx.lineTo(x + p1 + e, y + p0 + e);
      ctx.fill();
      ctx.fillStyle = P.pillarB;
      ctx.beginPath();
      ctx.moveTo(x + p0, y + p1);
      ctx.lineTo(x + p1, y + p1);
      ctx.lineTo(x + p1 + e, y + p1 + e);
      ctx.lineTo(x + p0 + e, y + p1 + e);
      ctx.fill();
    }
    const ext = this.px * 0.6;
    // Deck thickness: the shape stacked downwards (cheap extrusion), then the top.
    const dd = 4 / (2 * HALF_H);
    ctx.fillStyle = P.deckFace;
    ctx.beginPath();
    for (const f of [1, 0.66, 0.33]) roadShapePath(ctx, x + dd * f, y + dd * f, mask, DECK_HALF, ext);
    ctx.fill();
    ctx.fillStyle = P.deck;
    ctx.beginPath();
    roadShapePath(ctx, x, y, mask, DECK_HALF, ext);
    ctx.fill();
    ctx.fillStyle = P.deckAsphalt;
    ctx.beginPath();
    roadShapePath(ctx, x, y, mask, ROAD_HALF - 0.02, ext);
    ctx.fill();
    const b = this.b3;
    if (this.lines) this.laneMarks(b, P.lane, x, y, mask, this.lw(1.4), !this.detail);
    if (this.fine) this.edgeLines(b, P.edge, x, y, mask, this.lw(0.8), ROAD_HALF - 0.02);
    // Raised side rails.
    if (this.lines) {
      const r = 3 / (2 * HALF_H);
      roadOutlinePath(b.s(P.rail, this.lw(1.3)), x - r, y - r, mask, DECK_HALF - 0.025);
      if (this.detail) {
        const s = this.lw(2.2);
        const p = b.f(P.lamp);
        for (const [u, v] of bridgeLamps(mask)) p.rect(x + u - r - s / 2, y + v - r - s / 2, s, s);
      }
    }
    b.flush(ctx);
  }

  // ── Additive glow pass (tile space) ───────────────────────────────────────

  glowTile(x: number, y: number) {
    const t = this.world.tiles[y * N + x];
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
    if (t.road) this.roadGlow(x, y);
    else if (t.buildingId >= 0) this.padGlow(x, y, t);
    else if (t.zone !== ZoneType.None) this.lotGlow(x, y, t);
    else this.landGlow(x, y);
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

  private roadGlow(x: number, y: number) {
    const P = this.pal;
    const mask = this.world.roadMask(x, y);
    // Lane glow + curb glow.
    this.laneMarks(this.gl, P.gLane, x, y, mask, this.lw(this.lines ? 5 : 3), !this.lines);
    if (!this.lines) return;
    roadOutlinePath(this.gl.s(P.gCurb, this.lw(3.5)), x, y, mask, ROAD_HALF);
    if (!this.detail) return;
    if (BITS[mask] >= 3) this.crosswalks(this.gl.f(P.gZebra), x, y, mask);
    // Street-lamp light pools on the sidewalk.
    const n = P.n;
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
    const P = this.pal;
    const mask = this.world.roadMask(x, y);
    this.laneMarks(this.gl, P.gLane, x, y, mask, this.lw(this.lines ? 5 : 3), !this.lines);
    if (!this.lines) return;
    const r = 3 / (2 * HALF_H);
    roadOutlinePath(this.gl.s((x + y) & 1 ? P.gRailA : P.gRailB, this.lw(3.5)), x - r, y - r, mask, DECK_HALF - 0.025);
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
    const t = this.world.tiles[y * N + x];
    if (!t.road && t.terrain !== Terrain.Water) return;
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
      const mask = this.world.roadMask(x, y);
      const r = 3 / (2 * HALF_H);
      for (const [u, v] of bridgeLamps(mask)) {
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

/** Lamp positions (tile space, before rail lift) along a bridge deck. */
function bridgeLamps(mask: number): [number, number][] {
  const a = 0.5 - DECK_HALF + 0.025;
  const b = 0.5 + DECK_HALF - 0.025;
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

/** Owns the chunk canvases and draws the cached ground every frame. */
export class GroundCache {
  private chunks = new Map<string, Chunk>();
  private pool: HTMLCanvasElement[] = [];
  private painter = new GroundPainter();
  private info: TerrainInfo | null = null;
  private frame = 0;
  private bucket = 0;
  private prevBucket = 0;
  private tileBuf = new Int32Array(N * N);
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
    this.info = null;
  }

  /** Tiles changed: mark the affected world rect dirty on every rendered chunk. */
  invalidate(tiles: Rect) {
    const r = tileRectToWorld(tiles);
    for (const c of this.chunks.values()) {
      if (!c.rendered || c.empty) continue;
      if (!intersects(r, this.chunkRect(c))) continue;
      c.dirty = c.dirty
        ? { x0: Math.min(c.dirty.x0, r.x0), y0: Math.min(c.dirty.y0, r.y0), x1: Math.max(c.dirty.x1, r.x1), y1: Math.max(c.dirty.y1, r.y1) }
        : r;
    }
  }

  terrain(world: World): TerrainInfo {
    if (!this.info) this.info = new TerrainInfo(world);
    return this.info;
  }

  /** Padded world rect a chunk canvas covers. */
  private chunkRect(c: Chunk): Rect {
    const s = scaleOf(c.k);
    const W = CHUNK_PX / s;
    const p = PAD / s;
    const x0 = OX + c.i * W;
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

  private getChunk(k: number, i: number, j: number): Chunk {
    const key = `${k}:${i}:${j}`;
    let c = this.chunks.get(key);
    if (!c) {
      c = { k, i, j, canvas: null, ctx: null, empty: false, rendered: false, night: -1, dirty: null, used: 0 };
      c.empty = this.collectTiles(this.chunkRect(c)) === 0;
      this.chunks.set(key, c);
    }
    return c;
  }

  /** Fill tileBuf with tile indices (draw order) whose ground art may touch `r`. Returns count. */
  private collectTiles(r: Rect): number {
    const ax0 = r.x0 - HALF_W - SPILL;
    const ax1 = r.x1 + HALF_W + SPILL;
    const ay0 = r.y0 - 2 * HALF_H - SPILL;
    const ay1 = r.y1 + SPILL;
    const tx = (wx: number, wy: number) => (wy / HALF_H + wx / HALF_W) / 2;
    const ty = (wx: number, wy: number) => (wy / HALF_H - wx / HALF_W) / 2;
    const x0 = Math.max(0, Math.floor(tx(ax0, ay0)));
    const x1 = Math.min(N - 1, Math.ceil(tx(ax1, ay1)));
    const y0 = Math.max(0, Math.floor(ty(ax1, ay0)));
    const y1 = Math.min(N - 1, Math.ceil(ty(ax0, ay1)));
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
    const ox = OX + c.i * W;
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
    P.begin(ctx, world, info, nightBucket, s);
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
    const W = CHUNK_PX / scaleOf(k);
    const maxI = Math.floor((N * HALF_W + SPILL - OX) / W);
    const maxJ = Math.floor((N * 2 * HALF_H + SPILL - OY) / W);
    return {
      i0: Math.max(0, Math.floor((v.x0 - OX) / W)),
      i1: Math.min(maxI, Math.floor((v.x1 - OX) / W)),
      j0: Math.max(0, Math.floor((v.y0 - OY) / W)),
      j1: Math.min(maxJ, Math.floor((v.y1 - OY) / W)),
    };
  }

  /**
   * Draw the cached ground for the current view. Leaves the context transform
   * in an unspecified state (caller resets it).
   */
  draw(ctx: CanvasRenderingContext2D, world: World, view: GroundView, night: number, budgetMs: number) {
    this.frame++;
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
    // The overview is always kept ready as a fallback.
    const ov: Chunk[] = [];
    if (k !== OVERVIEW) {
      const orr = this.range(OVERVIEW, { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 });
      for (let j = orr.j0; j <= orr.j1; j++)
        for (let i = orr.i0; i <= orr.i1; i++) {
          const c = this.getChunk(OVERVIEW, i, j);
          if (!c.empty) ov.push(c);
        }
    }

    // ── Render work, most urgent first, within the frame budget ──
    const t0 = now();
    const spent = () => now() - t0;
    for (const c of ov) if (!c.rendered) this.renderChunk(c, world, nightBucket, null);
    const fallbackReady = k === OVERVIEW || ov.every((c) => c.rendered);
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
    const dist = (c: Chunk) => Math.abs(OX + (c.i + 0.5) * W - ccx) + Math.abs(OY + (c.j + 0.5) * W - ccy);
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
    const missing = vis.some((c) => !c.rendered);
    if (missing) {
      this.blit(ctx, ov, view);
      if (this.prevBucket !== k && this.prevBucket !== OVERVIEW) {
        const prev: Chunk[] = [];
        const pr = this.range(this.prevBucket, vr);
        for (let j = pr.j0; j <= pr.j1; j++)
          for (let i = pr.i0; i <= pr.i1; i++) {
            const c = this.chunks.get(`${this.prevBucket}:${i}:${j}`);
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
    this.evict(vis.length + ov.length);
  }

  private blit(ctx: CanvasRenderingContext2D, list: Chunk[], view: GroundView) {
    if (!list.length) return;
    const k = list[0].k;
    const s = scaleOf(k);
    const f = (view.zoom * view.dpr) / s;
    // Shared transform for every chunk of the bucket: cache px → device px.
    const tx = Math.round(((OX - view.camX) * view.zoom + view.width / 2) * view.dpr);
    const ty = Math.round(((OY - view.camY) * view.zoom + view.height / 2) * view.dpr);
    ctx.setTransform(f, 0, 0, f, tx, ty);
    ctx.imageSmoothingEnabled = true;
    for (const c of list) {
      if (!c.rendered || !c.canvas) continue;
      ctx.drawImage(c.canvas, c.i * CHUNK_PX - PAD, c.j * CHUNK_PX - PAD);
    }
  }

  /** LRU eviction down to the memory budget (never below what this frame needs). */
  private evict(needed: number) {
    const maxChunks = Math.max(Math.floor(MEMORY_BUDGET / CHUNK_BYTES), needed + 4);
    let live = 0;
    for (const [key, c] of this.chunks) {
      if (c.canvas) live++;
      // Forget bookkeeping for long-unused canvas-less chunks (old zoom buckets).
      else if (c.k !== this.bucket && c.k !== OVERVIEW && this.frame - c.used > 600) this.chunks.delete(key);
    }
    if (live <= maxChunks) return;
    const list = [...this.chunks.values()].filter((c) => c.canvas && c.k !== OVERVIEW && c.used !== this.frame);
    list.sort((a, b) => a.used - b.used);
    for (const c of list) {
      if (live <= maxChunks) break;
      this.release(c);
      this.chunks.delete(`${c.k}:${c.i}:${c.j}`);
      live--;
    }
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
    if (env.zoom < 0.3) return;
    const breath = presence > 0.01 ? 1 + presence * (1.2 + 1.6 * (0.5 + 0.5 * Math.sin((env.time * Math.PI * 2) / 4))) : 1;
    const info = this.terrain(world);
    const n = env.night;
    const time = env.time;
    const low = env.quality === 'low';
    const sparkle = this.sparkleSprite();
    const pulseOn = n > 0.15 && (!low || presence > 0.01) && (env.zoom >= 0.6 || presence > 0.01);
    // Fewer sparkles when zoomed out (they are tiny there anyway) or on low quality.
    const density = (low ? 0.5 : 1) * (env.zoom < 0.6 ? 0.45 : 1);
    const halo = env.zoom >= 0.6;
    const pulse = glowSprite(mix(NEON.amber, NEON.magenta, 0.35), 64);
    const tint = mix([255, 255, 255], [120, 220, 255], n);
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
          const h = hash2(x, y, info.seed + 11);
          if (h > density) continue;
          const ph = time * (0.9 + h * 0.8) + h * 40;
          const wave = Math.sin(ph);
          if (wave <= 0.55) continue;
          const a = (wave - 0.55) * 2.2 * (0.35 + 0.45 * n) * (info.depth[y * N + x] > 1 ? 1 : 0.7);
          const drift = Math.sin(time * 0.4 + h * 9) * 5;
          const cx = wx + (hash2(x, y, 3) - 0.5) * 30 + drift;
          const cy = wy + 16 + (hash2(x, y, 4) - 0.5) * 12;
          const w = 10 + h * 10;
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(sparkle, cx - w / 2, cy - 1.5, w, 3);
          if (halo) {
            ctx.globalAlpha = Math.min(1, a * 0.5);
            ctx.drawImage(sparkTint, cx - w * 0.6, cy - 4, w * 1.2, 8);
          }
        } else if (pulseOn && t.road) {
          const a = n * 0.11 * breath * (0.5 + 0.5 * Math.sin(time * 1.4 - (x + y) * 0.42));
          if (a < 0.01) continue;
          ctx.globalAlpha = a;
          ctx.drawImage(pulse, wx - 30, wy + 1, 60, 30);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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

