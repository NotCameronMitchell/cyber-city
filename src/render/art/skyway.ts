// ─────────────────────────────────────────────────────────────────────────────
// Skyway art (docs/EXPANSION.md §3.7, §3.11, §10.1): raised car roads at
// SKYWAY.z (52 world px) above world.sky tiles.
//
//  * Every deck piece is drawn in tile space through one affine transform
//    (tile (u, v) → world px at the piece's height; a slope is still affine
//    because its height is linear along its axis), so the ground layer's road
//    shape paths give decks curved corners and junctions for free.
//  * Pieces are cached sprites keyed by (shape, pillar, night bucket, scale,
//    LOD) with model ids from SKY_BASE = 4000, above every building id. The
//    shape folds in the mask, the ramp role (a two-tile slope: 52 → 30 on the
//    straight neighbour, 30 → 6 on the ramp tile; otherwise one tile 52 → 6)
//    and whether a ramp is closed (no street below: red-and-white barrier).
//  * Look (never the cyan skybridge or the teal ribbon): a dark half-tile deck,
//    white lane dashes, magenta (#ff5fd2) edge strips, concrete pillars.
//  * Traffic: per visible tile round(skyTraffic × 3) cars (a lightly used deck
//    still shows one car on about a third of its tiles; one that lands nowhere
//    carries 0 and stays empty), each a pair of white headlights and red tail
//    lights, moving both ways. Lights are batched into
//    two fills per frame; their night glows are collected during the sweep and
//    drawn in ONE additive pass after the building sweep (cap 200, skipped
//    below zoom 0.5 and on low quality).
//  * Deferred segments: a piece on a building lower than the deck, or beside
//    any multi-tile building's +x / +y face, is drawn right after that building,
//    so the deck stays in front of the faces it passes; over a taller building
//    it draws first and the building hides it (it docks). A lit portal marks
//    where a deck enters a docked megastructure's visible face.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, SKYWAY } from '../../game/config';
import { skyRampGround } from '../../game/skyway';
import { scratchFor } from '../../game/frame';
import { ZoneType, type Building } from '../../game/types';
import type { World } from '../../game/world';
import { serviceBuildingHeight, zoneBuildingHeight, LOD_ZOOM, type ArtEnv } from '../buildings';
import { HALF_H, HALF_W } from '../camera';
import { roadOutlinePath, roadShapePath } from '../ground';
import { css, glowSprite, mix, type RGB } from '../palette';
import { NIGHT_STEPS, SpriteCache, nightBucket, nightOfBucket, scaleBucket, scaleOfBucket, type Sprite } from './sprites';

/** Model ids of skyway pieces start here (above every building model id, §10.1). */
export const SKY_BASE = 4000;
/** Deck height (world px) and the half-width of the deck (tile units, "about half a tile wide"). */
export const SKY_Z = SKYWAY.z;
const DECK = 0.25;
/** Ramp heights: a two-tile slope ends at MID on the straight neighbour; every ramp lands at FOOT. */
const MID = 30;
const FOOT = 6;
/** Deck thickness (world px). */
const THICK = 4;
/** A building lower than this lets the deck pass over it (deferred segments, §3.7). */
const LOW = SKY_Z - 4;
/** Night glow cap per frame. */
const GLOW_CAP = 200;

const DIR = [1, 2, 4, 8];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DEAD_K = [-1, 0, 1, -1, 2, -1, -1, -1, 3, -1, -1, -1, -1, -1, -1, -1];
const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

const SKY_RGB: RGB = [255, 95, 210];
const HEAD_RGB: RGB = [255, 246, 220];
const TAIL_RGB: RGB = [255, 40, 70];
const PORTAL_RGB: RGB = [255, 240, 214];

// ── Shapes ──────────────────────────────────────────────────────────────────

/**
 * Shape codes: 0..15 a flat piece with that link mask; 16 + d the straight
 * neighbour of a two-tile ramp, descending towards direction d; 20 + d·4 +
 * two·2 + closed a ramp tile whose one link points at d (two = the slope's
 * lower half, else a one-tile ramp; closed = no street below).
 */
export const SHAPE_SLOPE = 16;
export const SHAPE_RAMP = 20;
const SHAPES = 36;

/** Height (world px) at the ends of a sloped piece along its axis: [at the `d` edge, at the opposite edge]. */
function slopeEnds(shape: number): [number, number] {
  if (shape >= SHAPE_RAMP) {
    const two = ((shape - SHAPE_RAMP) >> 1) & 1;
    return [two ? MID : SKY_Z, FOOT];
  }
  return [MID, SKY_Z];
}

/** Direction the slope's `d` edge faces (towards the link for a ramp, towards the ramp for an upper slope). */
function slopeDir(shape: number): number {
  return shape >= SHAPE_RAMP ? (shape - SHAPE_RAMP) >> 2 : shape - SHAPE_SLOPE;
}

/** Deck height at the tile centre for a shape. */
function centreZ(shape: number): number {
  if (shape < SHAPE_SLOPE) return SKY_Z;
  const [a, b] = slopeEnds(shape);
  return (a + b) / 2;
}

/**
 * Tile-space → world-px transform (relative to the tile's top corner) for a shape:
 * [a, b, c, d, e, f] with x = a·u + c·v + e, y = b·u + d·v + f.
 */
function shapeMatrix(shape: number, out: number[]): number[] {
  if (shape < SHAPE_SLOPE) {
    out[0] = HALF_W;
    out[1] = HALF_H;
    out[2] = -HALF_W;
    out[3] = HALF_H;
    out[4] = 0;
    out[5] = -SKY_Z;
    return out;
  }
  const d = slopeDir(shape);
  const [zd, zo] = slopeEnds(shape);
  // Height linear along the axis of d: at the d edge zd, at the opposite edge zo.
  out[0] = HALF_W;
  out[1] = HALF_H;
  out[2] = -HALF_W;
  out[3] = HALF_H;
  out[4] = 0;
  out[5] = 0;
  if (d === 0) {
    // d edge at v = 0: z = zd + (zo − zd)·v.
    out[3] = HALF_H - (zo - zd);
    out[5] = -zd;
  } else if (d === 2) {
    // d edge at v = 1: z = zo + (zd − zo)·v.
    out[3] = HALF_H - (zd - zo);
    out[5] = -zo;
  } else if (d === 3) {
    // d edge at u = 0: z = zd + (zo − zd)·u.
    out[1] = HALF_H - (zo - zd);
    out[5] = -zd;
  } else {
    // d edge at u = 1.
    out[1] = HALF_H - (zd - zo);
    out[5] = -zo;
  }
  return out;
}

/** Link mask a shape draws (sloped pieces are straight along their axis). */
function shapeMask(shape: number): number {
  if (shape < SHAPE_SLOPE) return shape;
  return slopeDir(shape) & 1 ? 10 : 5;
}

// ── Colours ─────────────────────────────────────────────────────────────────

interface DeckCols {
  top: string;
  side: string;
  edge: string;
  edgeGlow: string;
  lane: string;
  pillarL: string;
  pillarR: string;
  cap: string;
  barrierR: string;
  barrierW: string;
}

const colCache = new Map<number, DeckCols>();
function deckCols(nb: number): DeckCols {
  let c = colCache.get(nb);
  if (c) return c;
  const n = nightOfBucket(nb);
  c = {
    top: css(mix([62, 62, 76], [18, 16, 30], n)),
    side: css(mix([40, 40, 52], [9, 8, 18], n)),
    edge: css(mix([232, 72, 188], SKY_RGB, n)),
    edgeGlow: css(SKY_RGB, 0.32 * n),
    lane: css(mix([238, 238, 246], [205, 205, 232], n), 0.92),
    pillarL: css(mix([96, 96, 110], [22, 22, 36], n)),
    pillarR: css(mix([132, 132, 146], [34, 34, 52], n)),
    cap: css(mix([150, 150, 164], [44, 44, 64], n)),
    barrierR: css([235, 48, 64]),
    barrierW: css(mix([246, 246, 250], [220, 222, 236], n)),
  };
  colCache.set(nb, c);
  return c;
}

/** Ghost colours: translucent hologram in the deck's look (ok) or red (blocked). */
const GHOST_OK: DeckCols = {
  top: 'rgba(255,95,210,0.28)',
  side: 'rgba(120,30,100,0.35)',
  edge: 'rgba(255,140,230,0.95)',
  edgeGlow: 'rgba(255,95,210,0.25)',
  lane: 'rgba(255,255,255,0.8)',
  pillarL: 'rgba(160,120,170,0.35)',
  pillarR: 'rgba(200,160,210,0.35)',
  cap: 'rgba(220,190,230,0.4)',
  barrierR: 'rgba(255,60,90,0.95)',
  barrierW: 'rgba(255,255,255,0.9)',
};
const GHOST_BAD: DeckCols = {
  ...GHOST_OK,
  top: 'rgba(255,59,92,0.3)',
  side: 'rgba(120,20,40,0.35)',
  edge: 'rgba(255,90,120,0.95)',
  edgeGlow: 'rgba(255,59,92,0.25)',
};

// ── Painting one piece ──────────────────────────────────────────────────────

const M = [0, 0, 0, 0, 0, 0];

/**
 * Paint one deck piece with the tile's top corner at the current origin (world px).
 * `lod` drops the lane dashes and thickens the edges for far zoom.
 */
function paintPiece(g: CanvasRenderingContext2D, shape: number, pillar: boolean, c: DeckCols, lod: boolean, glow: boolean) {
  const mask = shapeMask(shape);
  // Pillar from the ground at the tile centre up under the deck.
  if (pillar) {
    const zc = centreZ(shape);
    const y0 = HALF_H;
    const top = HALF_H - zc + 2;
    const w = 3.2;
    g.fillStyle = c.pillarL;
    g.fillRect(-w, top, w, y0 - top);
    g.fillStyle = c.pillarR;
    g.fillRect(0, top, w, y0 - top);
    g.fillStyle = c.cap;
    g.beginPath();
    g.moveTo(-7, top);
    g.lineTo(0, top + 3.5);
    g.lineTo(7, top);
    g.lineTo(0, top - 3.5);
    g.closePath();
    g.fill();
  }
  const m = shapeMatrix(shape, M);
  const base = g.getTransform();
  // Side faces: the top shape pushed down by the deck thickness.
  g.fillStyle = c.side;
  for (const dz of [THICK, THICK / 2]) {
    g.setTransform(base);
    g.transform(m[0], m[1], m[2], m[3], m[4], m[5] + dz);
    g.beginPath();
    roadShapePath(g, 0, 0, mask, DECK, 0.01);
    g.fill();
  }
  g.setTransform(base);
  g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  g.beginPath();
  roadShapePath(g, 0, 0, mask, DECK, 0.01);
  g.fillStyle = c.top;
  g.fill();
  // Magenta edge strips (with a soft baked glow at night).
  const px = 1 / HALF_H;
  if (glow) {
    g.beginPath();
    roadOutlinePath(g, 0, 0, mask, DECK - 0.02);
    g.strokeStyle = c.edgeGlow;
    g.lineWidth = px * 4.5;
    g.stroke();
  }
  g.beginPath();
  roadOutlinePath(g, 0, 0, mask, DECK - 0.02);
  g.strokeStyle = c.edge;
  g.lineWidth = px * (lod ? 2.6 : 1.7);
  g.stroke();
  // White lane dashes down the middle (two-way traffic).
  if (!lod) {
    g.fillStyle = c.lane;
    const w = px * 1.1;
    if (mask === 5 || mask === 10) {
      for (const q of [0.1, 0.6]) {
        if (mask === 5) g.fillRect(0.5 - w / 2, q, w, 0.28);
        else g.fillRect(q, 0.5 - w / 2, 0.28, w);
      }
    } else if (BITS[mask] >= 1) {
      for (let k = 0; k < 4; k++) {
        if (!(mask & DIR[k])) continue;
        if (k === 0) g.fillRect(0.5 - w / 2, 0.06, w, 0.22);
        else if (k === 2) g.fillRect(0.5 - w / 2, 0.72, w, 0.22);
        else if (k === 3) g.fillRect(0.06, 0.5 - w / 2, 0.22, w);
        else g.fillRect(0.72, 0.5 - w / 2, 0.22, w);
      }
    }
  }
  // A closed ramp: red-and-white barrier across its foot (the edge opposite the link).
  if (shape >= SHAPE_RAMP && (shape - SHAPE_RAMP) & 1) {
    const d = slopeDir(shape);
    const t = 0.1;
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k & 1 ? c.barrierW : c.barrierR;
      const a = 0.5 - DECK - 0.04 + k * ((DECK * 2 + 0.08) / 4);
      const len = (DECK * 2 + 0.08) / 4;
      if (d === 0) g.fillRect(a, 1 - t - 0.04, len, t);
      else if (d === 2) g.fillRect(a, 0.04, len, t);
      else if (d === 3) g.fillRect(1 - t - 0.04, a, t, len);
      else g.fillRect(0.04, a, t, len);
    }
  }
  g.setTransform(base);
}

// ── Sprite cache (own instance: buildings.ts keeps its cache private) ───────

const cache = new SpriteCache();
cache.capBytes = 6 * 1024 * 1024;
cache.budgetMs = 1.5;
const OX = -36;
const OY = -62;
const SW = 72;
const SH = 102;
const MAX_SCALE = 3.2;
const SETTLE = 0.2;

let frameTime = NaN;
let frameNb = 0;
let frameScale = 1;
let frameScaleCode = 0;
let lastScale = 0;
let lastScaleChange = -1e9;
let tA = 1;
let tE = 0;
let tF = 0;

/** Start of a Renderer frame: the next draw re-reads the transform even at an unchanged time (the still title). */
export function resetSkywayFrame(): void {
  frameTime = NaN;
}

/** New frame: refresh the transform, scale and night bucket once (the sweep keeps the world transform). */
function syncFrame(ctx: CanvasRenderingContext2D, env: ArtEnv) {
  if (env.time === frameTime) return;
  frameTime = env.time;
  cache.newFrame();
  const t = ctx.getTransform();
  tA = t.a;
  tE = t.e;
  tF = t.f;
  const scale = Math.hypot(t.a, t.b);
  if (Math.abs(scale - lastScale) > 1e-6) {
    if (lastScale !== 0) lastScaleChange = env.time;
    lastScale = scale;
  }
  if (env.time - lastScaleChange >= SETTLE || env.time < lastScaleChange) {
    frameScale = Math.min(scale, MAX_SCALE);
    frameScaleCode = 64 + Math.round(frameScale * 256);
  } else {
    const b = scaleBucket(scale);
    frameScale = scaleOfBucket(b);
    frameScaleCode = b;
  }
  frameNb = nightBucket(env.night);
}

function paintSprite(shape: number, pillar: boolean, nb: number, scale: number, lod: boolean): Sprite | null {
  if (typeof document === 'undefined') return null;
  const cw = Math.max(1, Math.ceil(SW * scale));
  const ch = Math.max(1, Math.ceil(SH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(scale, 0, 0, scale, -OX * scale, -OY * scale);
  paintPiece(g, shape, pillar, deckCols(nb), lod, nb >= 3 && !lod);
  return { canvas, ox: OX, oy: OY, w: cw / scale, h: ch / scale, scale, bytes: cw * ch * 4, used: 0, key: 0, family: 0 };
}

function pieceSprite(shape: number, pillar: boolean, lod: boolean): Sprite | null {
  const model = SKY_BASE + shape * 2 + (pillar ? 1 : 0);
  const key = ((model * NIGHT_STEPS + frameNb) * 4096 + frameScaleCode) * 2 + (lod ? 1 : 0);
  return cache.get(key, model * 2 + (lod ? 1 : 0), () => paintSprite(shape, pillar, frameNb, frameScale, lod));
}

function blit(ctx: CanvasRenderingContext2D, s: Sprite, wx: number, wy: number) {
  if (Math.abs(s.scale - tA) < tA * 0.004) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(s.canvas, Math.round(tA * (wx + s.ox) + tE), Math.round(tA * (wy + s.oy) + tF));
    ctx.setTransform(tA, 0, 0, tA, tE, tF);
  } else ctx.drawImage(s.canvas, wx + s.ox, wy + s.oy, s.w, s.h);
}

// ── Per-world derived layout ────────────────────────────────────────────────

/** Is a skyway tile (bits) a ramp tile (ramp bit with exactly one link)? */
function isRampBits(bits: number): boolean {
  return (bits & 16) !== 0 && BITS[bits & 15] === 1;
}

/**
 * Shape of every sky tile from a sky array (world.sky, or a plan overlay) and the ground:
 * ramps pick a two-tile slope when their neighbour is a plain straight piece that no
 * other ramp claims. Writes `shapes` (255 = no deck) for the given tile indices.
 */
export function computeShapes(world: World, sky: Uint8Array, list: ArrayLike<number>, count: number, shapes: Uint8Array): void {
  const N = world.N;
  for (let n = 0; n < count; n++) {
    const i = list[n];
    const bits = sky[i];
    shapes[i] = bits ? bits & 15 : 255;
  }
  for (let n = 0; n < count; n++) {
    const i = list[n];
    const bits = sky[i];
    if (!isRampBits(bits)) continue;
    const d = DEAD_K[bits & 15];
    const x = i % N;
    const y = (i / N) | 0;
    const nx = x + DX[d];
    const ny = y + DY[d];
    const closed = !skyRampGround(world.tiles[i]) ? 1 : 0;
    let two = 0;
    if (nx >= 0 && ny >= 0 && nx < N && ny < N) {
      const j = ny * N + nx;
      const nm = sky[j] & 15;
      const straight = (nm === 5 || nm === 10) && !(sky[j] & 16);
      if (straight && shapes[j] === nm) {
        // The neighbour's far side must not be another ramp pointing back at it.
        const fx = nx + DX[d];
        const fy = ny + DY[d];
        const far = fx >= 0 && fy >= 0 && fx < N && fy < N ? sky[fy * N + fx] : 0;
        const farRamp = isRampBits(far) && DEAD_K[far & 15] === ((d + 2) & 3);
        if (!farRamp) {
          two = 1;
          // The neighbour descends towards the ramp (the side opposite d, seen from it).
          shapes[j] = SHAPE_SLOPE + ((d + 2) & 3);
        }
      }
    }
    shapes[i] = SHAPE_RAMP + d * 4 + two * 2 + closed;
  }
}

const pickList = new Int32Array(5);
/** deckShapeAt's shape scratch, one per frame size (MEGACITY §3.1). */
const pickScratch = scratchFor((area) => new Uint8Array(area).fill(255));

/**
 * Shape of the deck on tile (x, y) as the layer draws it (255 = no deck): a ramp or the upper
 * half of a two-tile slope resolved from its neighbours, for overlays drawn over one piece.
 */
export function deckShapeAt(world: World, x: number, y: number): number {
  const N = world.N;
  if (!world.inBounds(x, y)) return 255;
  const sky = world.sky;
  const pickShapes = pickScratch(world.area);
  let n = 0;
  pickList[n++] = y * N + x;
  for (let k = 0; k < 4; k++) {
    const nx = x + DX[k];
    const ny = y + DY[k];
    if (nx >= 0 && ny >= 0 && nx < N && ny < N && sky[ny * N + nx]) pickList[n++] = ny * N + nx;
  }
  computeShapes(world, sky, pickList, n, pickShapes);
  return pickShapes[y * N + x];
}

/**
 * A deck shape on tile (x, y) for overlays: writes `out`, the tile-local (u, v in 0..1) →
 * world-px transform the piece is painted with (a ramp or slope follows its incline), and
 * returns the link mask its outline uses.
 */
export function deckPieceTransform(shape: number, x: number, y: number, out: number[]): number {
  shapeMatrix(shape, out);
  out[4] += (x - y) * HALF_W;
  out[5] += (x + y) * HALF_H;
  return shapeMask(shape);
}

/** Pillar rule (§3.7): straight pieces on even tiles and every junction, over open ground, water or a road. */
function wantsPillar(world: World, x: number, y: number, shape: number, rampTile: boolean): boolean {
  const N = world.N;
  if (rampTile) return false;
  const mask = shapeMask(shape);
  const straight = mask === 5 || mask === 10;
  if (!((straight && ((x + y) & 1) === 0) || BITS[mask] >= 3)) return false;
  const i = y * N + x;
  if (world.rail[i] !== 0) return false;
  const t = world.tiles[i];
  if (t.road) return true;
  if (t.terrain !== 0) return true;
  return t.buildingId < 0 && !(t.zone !== ZoneType.None && t.level >= 2);
}

/** Is tile (x, y) on a building lower than the deck (the deck passes over it)? Airport: its runway rows. */
function lowBuildingAt(b: Building, x: number, y: number): boolean {
  if (b.type === 'airport') return y - b.y <= 3;
  return serviceBuildingHeight(b.type, b) < LOW;
}

// ── The layer ───────────────────────────────────────────────────────────────

export class SkywayLayer {
  /** Per-tile layout of the shown world, sized from its frame (MEGACITY §3.1) on rebuild. */
  private shapes = new Uint8Array(0);
  private pillars = new Uint8Array(0);
  /** Building id a tile's piece is deferred to (drawn right after it), or −1. */
  private deferTo = new Int32Array(0);
  private deferred = new Map<number, number[]>();
  /** Docked megastructures: building id → portal positions [u, v, face (1 = +x, 2 = +y)]. */
  private portals = new Map<number, number[]>();
  private list: number[] = [];
  private builtVersion = -1;
  private builtSky = -1;
  private builtWorld: World | null = null;
  // Per-frame car lights: two batched paths and the glow buffer.
  private heads: Path2D | null = null;
  private tails: Path2D | null = null;
  private bodies: Path2D | null = null;
  /** World-px box of the queued car lights (flushIfUnder tests occluders against it). */
  private cx0 = 0;
  private cy0 = 0;
  private cx1 = 0;
  private cy1 = 0;
  private glow = new Float32Array(GLOW_CAP * 3);
  private glowN = 0;
  private env: ArtEnv = { time: 0, night: 0, zoom: 1, quality: 'high' };
  private lightsOn = false;
  private glowOn = false;

  /** Any sky at all (cheap test for the renderer). */
  get any(): boolean {
    return this.list.length > 0;
  }

  /** Rebuild the derived layout when tiles or sky changed. Call once per frame before the sweep. */
  prepare(world: World, env: ArtEnv): void {
    this.env = env;
    if (world !== this.builtWorld || world.version !== this.builtVersion || world.skyVersion !== this.builtSky) this.rebuild(world);
    this.heads = null;
    this.tails = null;
    this.bodies = null;
    this.glowN = 0;
    this.lightsOn = env.zoom >= 0.45;
    this.glowOn = env.night > 0.3 && env.zoom >= 0.5 && env.quality === 'high';
  }

  private rebuild(world: World) {
    const N = world.N;
    this.builtWorld = world;
    this.builtVersion = world.version;
    this.builtSky = world.skyVersion;
    const sky = world.sky;
    const list = this.list;
    if (this.shapes.length !== world.area) {
      this.shapes = new Uint8Array(world.area).fill(255);
      this.pillars = new Uint8Array(world.area);
      this.deferTo = new Int32Array(world.area).fill(-1);
    } else
      for (const i of list) {
        this.shapes[i] = 255;
        this.pillars[i] = 0;
        this.deferTo[i] = -1;
      }
    list.length = 0;
    for (let i = 0; i < N * N; i++) if (sky[i] & 15) list.push(i);
    this.deferred.clear();
    this.portals.clear();
    if (!list.length) return;
    computeShapes(world, sky, list, list.length, this.shapes);
    for (const i of list) {
      const x = i % N;
      const y = (i / N) | 0;
      const shape = this.shapes[i];
      this.pillars[i] = wantsPillar(world, x, y, shape, shape >= SHAPE_RAMP) ? 1 : 0;
      // Deferral: on a low building's footprint, or beside any building's +x / +y face while the
      // tile sorts before its front corner: the deck is in front of the faces it passes.
      let host: Building | null = world.buildingAt(x, y);
      if (host && !lowBuildingAt(host, x, y)) host = null;
      if (!host && !world.buildingAt(x, y)) {
        for (const [ox, oy] of [
          [-1, 0],
          [0, -1],
        ]) {
          const b = world.buildingAt(x + ox, y + oy);
          if (!b || b.size < 2) continue;
          // Only tiles that sort before the building's front corner need it.
          if (x + y <= b.x + b.y + 2 * b.size - 2) {
            host = b;
            break;
          }
        }
      }
      if (host) {
        this.deferTo[i] = host.id;
        const l = this.deferred.get(host.id);
        if (l) l.push(i);
        else this.deferred.set(host.id, [i]);
      }
    }
    // Keep each deferred list in sweep order.
    for (const l of this.deferred.values()) l.sort((a, b) => (a % N) + ((a / N) | 0) - ((b % N) + ((b / N) | 0)) || (a % N) - (b % N));
    // Portals: a deck leaving a docked anchor's footprint through its visible (+x / +y) face.
    for (const i of list) {
      const x = i % N;
      const y = (i / N) | 0;
      const b = world.buildingAt(x, y);
      if (!b || !BUILDINGS[b.type]?.skyAnchor || lowBuildingAt(b, x, y)) continue;
      const m = sky[i] & 15;
      if (m & 2 && x === b.x + b.size - 1) this.addPortal(b.id, x + 1, y + 0.5, 1);
      if (m & 4 && y === b.y + b.size - 1) this.addPortal(b.id, x + 0.5, y + 1, 2);
    }
  }

  private addPortal(id: number, u: number, v: number, face: number) {
    const l = this.portals.get(id);
    if (l) l.push(u, v, face);
    else this.portals.set(id, [u, v, face]);
  }

  /** Is this tile's piece drawn after a building instead of at its own sweep key? */
  isDeferred(i: number): boolean {
    return this.deferTo[i] >= 0;
  }

  /** Should the piece on a zone tile draw before its tower (a tower taller than the deck threads in front)? */
  beforeZone(world: World, i: number): boolean {
    const t = world.tiles[i];
    return t.zone !== ZoneType.None && t.level > 0 && zoneBuildingHeight(t) > LOW;
  }

  /** Draw the piece on tile (x, y), plus its cars. World transform expected. */
  drawTile(ctx: CanvasRenderingContext2D, world: World, x: number, y: number): void {
    const N = world.N;
    const i = y * N + x;
    const shape = this.shapes[i];
    if (shape === 255) return;
    const env = this.env;
    syncFrame(ctx, env);
    const wx = (x - y) * HALF_W;
    const wy = (x + y) * HALF_H;
    const lod = env.zoom < LOD_ZOOM;
    const s = pieceSprite(shape, this.pillars[i] === 1, lod);
    if (s) blit(ctx, s, wx, wy);
    if (this.lightsOn) this.cars(world, i, x, y, shape, wx, wy);
  }

  /** Pieces deferred to building `b` and its dock portals; call right after drawing it. */
  afterBuilding(ctx: CanvasRenderingContext2D, world: World, b: Building, visibleX: (wx: number) => boolean): void {
    const N = world.N;
    const l = this.deferred.get(b.id);
    if (l) {
      for (const i of l) {
        const x = i % N;
        const y = (i / N) | 0;
        if (visibleX((x - y) * HALF_W)) this.drawTile(ctx, world, x, y);
      }
    }
    const p = this.portals.get(b.id);
    if (p) this.drawPortals(ctx, p);
  }

  /** Lit portals on a docked building's facade at deck height. */
  private drawPortals(ctx: CanvasRenderingContext2D, p: number[]) {
    const env = this.env;
    const n = env.night;
    for (let k = 0; k < p.length; k += 3) {
      const u = p[k];
      const v = p[k + 1];
      const face = p[k + 2];
      // Face plane: +x face → points (u, v ± s); +y face → (u ± s, v).
      const s = 0.26;
      const a = face === 1 ? [u, v - s] : [u - s, v];
      const b = face === 1 ? [u, v + s] : [u + s, v];
      const z0 = SKY_Z - 3;
      const z1 = SKY_Z + 9;
      const P = (q: number[], z: number) => [(q[0] - q[1]) * HALF_W, (q[0] + q[1]) * HALF_H - z];
      const quad = (inset: number, za: number, zb: number) => {
        const qa = [a[0] + (b[0] - a[0]) * inset, a[1] + (b[1] - a[1]) * inset];
        const qb = [b[0] + (a[0] - b[0]) * inset, b[1] + (a[1] - b[1]) * inset];
        const p0 = P(qa, za);
        const p1 = P(qb, za);
        const p2 = P(qb, zb);
        const p3 = P(qa, zb);
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
      };
      quad(0, z0 - 2, z1 + 2);
      ctx.fillStyle = css(mix([220, 70, 180], SKY_RGB, n));
      ctx.fill();
      quad(0.14, z0, z1);
      ctx.fillStyle = css(mix([236, 226, 210], PORTAL_RGB, n));
      ctx.fill();
      if (n > 0.3 && env.zoom >= 0.5) {
        const c = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], (z0 + z1) / 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 * n;
        ctx.drawImage(glowSprite(PORTAL_RGB, 32), c[0] - 14, c[1] - 10, 28, 20);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  /** Queue this tile's cars into the batched light paths (and glows). */
  private cars(world: World, i: number, x: number, y: number, shape: number, wx: number, wy: number) {
    const load = world.fields.skyTraffic[i];
    let count = Math.round(load * 3);
    // A deck that carries anything at all shows a sparse car now and then (a network that lands
    // nowhere carries 0 and stays empty, which is its tell).
    if (count === 0 && load > 0.002 && ((i * 40503) & 1023) / 1024 < 0.3 + load * 4) count = 1;
    if (count <= 0) return;
    const mask = shapeMask(shape);
    // Path through the tile: along a straight axis, or arm a → centre → arm b.
    let a = -1;
    let b = -1;
    if (mask === 5 || mask === 10) {
      a = mask === 5 ? 0 : 3;
      b = mask === 5 ? 2 : 1;
    } else {
      for (let k = 0; k < 4; k++) {
        if (!(mask & DIR[k])) continue;
        if (a < 0) a = k;
        else if (b < 0) b = k;
      }
    }
    if (a < 0) return;
    // Tile-space → world transform of this piece (flat or sloped), offset to the tile.
    const m = shapeMatrix(shape, M);
    const ma = m[0];
    const mb = m[1];
    const mc = m[2];
    const md = m[3];
    const me = wx + m[4];
    const mf = wy + m[5] - 1.6;
    const env = this.env;
    const seed = (((i * 2654435761) >>> 0) % 1000) / 1000;
    if (!this.heads) {
      this.heads = new Path2D();
      this.tails = new Path2D();
      this.bodies = new Path2D();
      this.cx0 = this.cy0 = Infinity;
      this.cx1 = this.cy1 = -Infinity;
    }
    const heads = this.heads;
    const tails = this.tails!;
    const bodies = this.bodies!;
    // The whole tile's deck (plus a margin) bounds its cars.
    if (wx - HALF_W < this.cx0) this.cx0 = wx - HALF_W;
    if (wx + HALF_W > this.cx1) this.cx1 = wx + HALF_W;
    if (wy - SKY_Z - 4 < this.cy0) this.cy0 = wy - SKY_Z - 4;
    if (wy + 2 * HALF_H > this.cy1) this.cy1 = wy + 2 * HALF_H;
    const night = env.night;
    for (let j = 0; j < count; j++) {
      const back = (j & 1) === 1;
      let t = (env.time * (0.32 + 0.05 * j) + j / count + seed) % 1;
      if (back) t = 1 - t;
      // Points along the path (tile units): from arm a's edge midpoint through the centre to arm b's.
      const P0u = 0.5 + DX[a] * 0.5;
      const P0v = 0.5 + DY[a] * 0.5;
      const P1u = b >= 0 ? 0.5 + DX[b] * 0.5 : 0.5;
      const P1v = b >= 0 ? 0.5 + DY[b] * 0.5 : 0.5;
      let u: number;
      let v: number;
      let hu: number;
      let hv: number;
      if (b < 0) {
        // Dead end: along the one arm, edge to centre.
        u = P0u + (0.5 - P0u) * t;
        v = P0v + (0.5 - P0v) * t;
        hu = 0.5 - P0u;
        hv = 0.5 - P0v;
      } else if (t < 0.5) {
        const k = t * 2;
        u = P0u + (0.5 - P0u) * k;
        v = P0v + (0.5 - P0v) * k;
        hu = 0.5 - P0u;
        hv = 0.5 - P0v;
      } else {
        const k = (t - 0.5) * 2;
        u = 0.5 + (P1u - 0.5) * k;
        v = 0.5 + (P1v - 0.5) * k;
        hu = P1u - 0.5;
        hv = P1v - 0.5;
      }
      const l = Math.hypot(hu, hv) || 1;
      hu /= l;
      hv /= l;
      if (back) {
        hu = -hu;
        hv = -hv;
      }
      // Right-hand lane offset.
      const lo = 0.1;
      u += -hv * lo;
      v += hu * lo;
      const cx = ma * u + mc * v + me;
      const cy = mb * u + md * v + mf;
      // Head / tail offsets along the heading (0.07 tile each way).
      const ox = (ma * hu + mc * hv) * 0.07;
      const oy = (mb * hu + md * hv) * 0.07;
      bodies.rect(cx - 1.6, cy - 1.1, 3.2, 1.8);
      heads.rect(cx + ox - 1.1, cy + oy - 0.6, 2.2, 1.1);
      tails.rect(cx - ox - 1.1, cy - oy - 0.6, 2.2, 1.1);
      if (this.glowOn && this.glowN < GLOW_CAP - 1 && night > 0.3) {
        const g = this.glow;
        let o = this.glowN * 3;
        g[o] = cx + ox;
        g[o + 1] = cy + oy;
        g[o + 2] = 0;
        o += 3;
        g[o] = cx - ox;
        g[o + 1] = cy - oy;
        g[o + 2] = 1;
        this.glowN += 2;
      }
    }
  }

  /**
   * Flush the queued car lights if an object about to be drawn over the world-px box
   * (x0, y0)-(x1, y1) could cover them, so later buildings still hide the cars behind them.
   */
  flushIfUnder(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    if (!this.heads || x1 < this.cx0 || x0 > this.cx1 || y1 < this.cy0 || y0 > this.cy1) return;
    this.flushCars(ctx);
  }

  /** Flush the batched car lights (call at the end of the sweep, before drawGlows). */
  flushCars(ctx: CanvasRenderingContext2D): void {
    if (!this.heads) return;
    const n = this.env.night;
    ctx.globalAlpha = 1;
    ctx.fillStyle = n > 0.5 ? '#1a1a26' : '#3c3e4a';
    ctx.fill(this.bodies!);
    ctx.fillStyle = css(mix([255, 250, 236], HEAD_RGB, n));
    ctx.fill(this.heads);
    ctx.fillStyle = css(mix([220, 40, 60], TAIL_RGB, n));
    ctx.fill(this.tails!);
    this.heads = null;
    this.tails = null;
    this.bodies = null;
  }

  /** The one additive pass of headlight and tail-light glows (after the building sweep). World transform. */
  drawGlows(ctx: CanvasRenderingContext2D): void {
    if (!this.glowN) return;
    const n = this.env.night;
    const head = glowSprite(HEAD_RGB, 32);
    const tail = glowSprite(TAIL_RGB, 32);
    const g = this.glow;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.55 * n);
    for (let k = 0; k < this.glowN; k++) {
      const o = k * 3;
      if (g[o + 2] === 0) ctx.drawImage(head, g[o] - 5, g[o + 1] - 3.5, 10, 7);
      else ctx.drawImage(tail, g[o] - 3.5, g[o + 1] - 2.5, 7, 5);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.glowN = 0;
  }
}

// ── Ghost (planning preview) ────────────────────────────────────────────────

/** The ghost's overlay, shapes and tile list, one set per frame size (MEGACITY §3.1). */
const ghostScratch = scratchFor((area) => ({
  ghostSky: new Uint8Array(area),
  ghostShapes: new Uint8Array(area),
  ghostList: new Int32Array(area),
}));

/**
 * Skyway drag preview (§7.5): raised translucent pieces at deck height along the
 * planned tiles (their resulting masks over the existing sky), sloped ramp ends,
 * a ring at docked ends, closed ramps red. World transform expected; drawn back
 * to front. `ok[k]` per planned tile; `valid` false tints the whole ghost red.
 */
export function drawSkywayGhost(
  ctx: CanvasRenderingContext2D,
  world: World,
  tiles: readonly { x: number; y: number; ok: boolean }[],
  masks: readonly number[],
  valid: boolean,
  env: ArtEnv,
): void {
  if (!tiles.length) return;
  const N = world.N;
  const { ghostSky, ghostShapes, ghostList } = ghostScratch(world.area);
  ghostSky.set(world.sky);
  let count = 0;
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    if (!world.inBounds(t.x, t.y)) continue;
    const i = t.y * N + t.x;
    ghostSky[i] = (masks[k] ?? 0) & 31;
    ghostList[count++] = i;
  }
  // Neighbours whose links the plan joins: give them their extra link too (shape only).
  computeShapes(world, ghostSky, ghostList, count, ghostShapes);
  const order = Array.from(ghostList.subarray(0, count)).sort((a, b) => (a % N) + ((a / N) | 0) - ((b % N) + ((b / N) | 0)));
  const okAt = new Set<number>();
  for (const t of tiles) if (t.ok && world.inBounds(t.x, t.y)) okAt.add(t.y * N + t.x);
  const pulse = 0.75 + 0.2 * Math.sin(env.time * 5);
  const a0 = ctx.globalAlpha;
  const base = ctx.getTransform();
  for (const i of order) {
    const shape = ghostShapes[i];
    if (shape === 255) continue;
    const x = i % N;
    const y = (i / N) | 0;
    const wx = (x - y) * HALF_W;
    const wy = (x + y) * HALF_H;
    const good = valid && okAt.has(i);
    const closed = shape >= SHAPE_RAMP && ((shape - SHAPE_RAMP) & 1) === 1;
    ctx.globalAlpha = a0 * pulse;
    ctx.setTransform(base);
    ctx.translate(wx, wy);
    paintPiece(ctx, shape, false, good && !closed ? GHOST_OK : GHOST_BAD, env.zoom < LOD_ZOOM, false);
    ctx.setTransform(base);
    // Dock end: a ring at deck height over an anchor.
    if (world.buildingAt(x, y) && BUILDINGS[world.buildingAt(x, y)!.type]?.skyAnchor) {
      ctx.globalAlpha = a0;
      ctx.strokeStyle = good ? 'rgba(255,140,230,0.95)' : 'rgba(255,90,120,0.95)';
      ctx.lineWidth = 1.6 / env.zoom;
      ctx.beginPath();
      ctx.ellipse(wx, wy + HALF_H - SKY_Z, HALF_W * 0.55, HALF_H * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = a0;
}

/** Number of distinct deck shapes (tests). */
export const SKY_SHAPES = SHAPES;
