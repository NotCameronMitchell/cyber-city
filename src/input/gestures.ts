// ─────────────────────────────────────────────────────────────────────────────
// Pure gesture math + tuning constants for the input layer.
//
// Nothing in here touches the DOM, so it is unit-testable under node
// (tests/input-gestures.test.ts). All screen values are CSS px in camera space
// (relative to the canvas' top-left corner), all times are milliseconds unless
// a name says otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { HALF_H, HALF_W, TILE_H, type Camera, type Vec } from '../render/camera';

// ── Tuning ───────────────────────────────────────────────────────────────────

/** Max finger travel (px) for a touch to still count as a tap. */
export const TAP_SLOP_TOUCH = 10;
/** Max cursor travel (px) for a mouse press to still count as a click. */
export const TAP_SLOP_MOUSE = 5;
/** Max touch duration for a tap. */
export const TAP_MAX_MS = 350;
/** Max mouse press duration for a click (mice are slower and more deliberate). */
export const CLICK_MAX_MS = 900;
/** Second tap must land within this time of the first to be a double-tap. */
export const DOUBLE_TAP_MS = 300;
/** …and within this distance (px) of it. */
export const DOUBLE_TAP_SLOP_TOUCH = 40;
export const DOUBLE_TAP_SLOP_MOUSE = 14;
/** Zoom multiplier of a double-tap (and divisor of a two-finger tap). */
export const DOUBLE_TAP_ZOOM = 2;
/** Hold still this long in a build tool to peek-inspect the tile instead. */
export const LONG_PRESS_MS = 450;

/** Double-tap-and-drag ("one-thumb zoom"): zoom factor per px of vertical drag. */
export const TAPZOOM_RATE = 0.0065;

/** A two-finger tap: both fingers down within this window of each other… */
export const TWO_FINGER_TAP_LAND_MS = 150;
/** …lifted within this time… */
export const TWO_FINGER_TAP_MAX_MS = 300;
/** …with the centroid moving less than this… */
export const TWO_FINGER_TAP_SLOP = 14;
/** …and the finger spread changing by less than this ratio. */
export const TWO_FINGER_TAP_SPREAD = 0.15;
/** Pinch spread is floored at this (px) so near-touching fingers can't explode the zoom factor. */
export const MIN_PINCH_SPREAD = 12;

/** Flings slower than this (px/s) are ignored. */
export const FLING_MIN_SPEED = 90;
/** Fling speed cap (px/s). */
export const FLING_MAX_SPEED = 3600;
/** Exponential friction of a fling (1/s). Higher = stops sooner. */
export const FLING_FRICTION = 3.6;
/** A fling below this speed (px/s) is stopped. */
export const FLING_STOP_SPEED = 8;
/** Touching down on a map moving faster than this "catches" it instead of tapping. */
export const FLING_CATCH_SPEED = 220;
/** Velocity estimate window and staleness (finger stopped before lifting). */
export const VELOCITY_WINDOW_MS = 100;
export const VELOCITY_STALE_MS = 70;

/** Build-drag edge auto-scroll: zone width (px) and top speed (px/s). */
export const EDGE_ZONE = 36;
export const EDGE_MAX_SPEED = 640;
/** Seconds for edge scrolling to ramp to full speed (avoids lurches). */
export const EDGE_RAMP_S = 0.35;

/** Smooth zoom easing rate (1/s) for wheel, keyboard and double-tap zooms. */
export const ZOOM_EASE = 14;
/** Mouse wheel: zoom factor per px of normalized wheel delta. */
export const WHEEL_ZOOM_RATE = 0.0018;
/** Trackpad pinch (ctrl+wheel): zoom factor per px of delta. */
export const PINCH_WHEEL_RATE = 0.011;
/** ctrl+wheel deltas at or above this are a real wheel held with ctrl, not a trackpad pinch. */
export const PINCH_WHEEL_MAX_DELTA = 40;
/** Keyboard zoom step. */
export const KEY_ZOOM_STEP = 1.25;

/** Keyboard pan speed (px/s, screen space) and its easing rate (1/s). */
export const KEY_PAN_SPEED = 760;
export const KEY_PAN_FAST = 2.2;
export const KEY_PAN_EASE = 11;

/** Minimum gap between drag haptic ticks. */
export const HAPTIC_TICK_GAP_MS = 45;
/** Re-plan the live preview this often (s) so it tracks funds and growth. */
export const REPLAN_INTERVAL_S = 0.3;
/** Tallest object (world px) the height-aware tap picking needs to reach. */
export const MAX_PICK_HEIGHT = 420;

// ── Small helpers ────────────────────────────────────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Frame-rate independent smoothing weight: lerp(a, b, damp(rate, dt)). */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Hermite smoothstep on 0..1. */
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

// ── Coordinates ──────────────────────────────────────────────────────────────

/**
 * Fractional ground-plane tile coords under a screen point, written into `out`
 * (allocation-free twin of camera.screenToTile, before flooring).
 */
export function screenToTileF(camera: Camera, sx: number, sy: number, out: Vec): Vec {
  const wx = (sx - camera.width / 2) / camera.zoom + camera.x;
  const wy = (sy - camera.height / 2) / camera.zoom + camera.y;
  const a = wx / HALF_W;
  const b = wy / HALF_H;
  out.x = (b + a) / 2;
  out.y = (b - a) / 2;
  return out;
}

/** Integer tile under a screen point, written into `out` (matches camera.screenToTile). */
export function screenToTileInto(camera: Camera, sx: number, sy: number, out: Vec): Vec {
  screenToTileF(camera, sx, sy, out);
  out.x = Math.floor(out.x);
  out.y = Math.floor(out.y);
  return out;
}

/**
 * Clamp the tile under the finger so the tool's footprint stays on the map.
 * `size` 1 = plain tile tools; for buildings the footprint is centred on the
 * finger tile with origin offset floor((size-1)/2) (see actions.footprintOrigin).
 */
export function clampToolTile(t: Vec, mapSize: number, size = 1): Vec {
  const off = Math.floor((size - 1) / 2);
  const lo = off;
  const hi = mapSize - size + off;
  t.x = clamp(t.x, lo, hi);
  t.y = clamp(t.y, lo, hi);
  return t;
}

// ── Multi-touch ──────────────────────────────────────────────────────────────

export interface Centroid {
  x: number;
  y: number;
  /** Mean distance of the points from the centroid (half the finger gap for two fingers). */
  spread: number;
  count: number;
}

/** Centroid + spread of any number of points (so finger-count changes rebase cleanly). */
export function centroidSpread(points: ArrayLike<Vec>, out: Centroid): Centroid {
  const n = points.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += points[i].x;
    sy += points[i].y;
  }
  out.count = n;
  if (n === 0) {
    out.x = out.y = out.spread = 0;
    return out;
  }
  const cx = sx / n;
  const cy = sy / n;
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.hypot(points[i].x - cx, points[i].y - cy);
  out.x = cx;
  out.y = cy;
  out.spread = d / n;
  return out;
}

/** Zoom factor between two pinch spreads, with the near-zero floor applied. */
export function pinchFactor(prevSpread: number, spread: number): number {
  return Math.max(spread, MIN_PINCH_SPREAD) / Math.max(prevSpread, MIN_PINCH_SPREAD);
}

/** Classify a finished two-finger touch as a quick "two-finger tap" (zoom out). */
export function isTwoFingerTap(durationMs: number, maxFingers: number, travelPx: number, minRatio: number, maxRatio: number): boolean {
  return (
    maxFingers === 2 &&
    durationMs <= TWO_FINGER_TAP_MAX_MS &&
    travelPx <= TWO_FINGER_TAP_SLOP &&
    minRatio >= 1 - TWO_FINGER_TAP_SPREAD &&
    maxRatio <= 1 + TWO_FINGER_TAP_SPREAD
  );
}

// ── Velocity / fling ─────────────────────────────────────────────────────────

const VT_SIZE = 16;

/**
 * Ring buffer of recent (time, x, y) samples → release velocity in px/s.
 * Feed it a *continuous* quantity (accumulated pan offset) so finger-count
 * changes mid-gesture never produce a bogus spike.
 */
export class VelocityTracker {
  private readonly ts = new Float64Array(VT_SIZE);
  private readonly xs = new Float64Array(VT_SIZE);
  private readonly ys = new Float64Array(VT_SIZE);
  private head = 0;
  private count = 0;

  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  add(t: number, x: number, y: number): void {
    this.ts[this.head] = t;
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.head = (this.head + 1) % VT_SIZE;
    if (this.count < VT_SIZE) this.count++;
  }

  /** Velocity over the last `windowMs`; zero if the pointer stopped `staleMs` before `now`. */
  velocity(now: number, out: Vec, windowMs = VELOCITY_WINDOW_MS, staleMs = VELOCITY_STALE_MS): Vec {
    out.x = 0;
    out.y = 0;
    if (this.count < 2) return out;
    const newest = (this.head - 1 + VT_SIZE) % VT_SIZE;
    const tNew = this.ts[newest];
    if (now - tNew > staleMs) return out;
    let oldest = newest;
    for (let i = 1; i < this.count; i++) {
      const j = (newest - i + VT_SIZE) % VT_SIZE;
      if (tNew - this.ts[j] > windowMs) break;
      oldest = j;
    }
    const dt = (tNew - this.ts[oldest]) / 1000;
    if (dt < 0.008) return out;
    out.x = (this.xs[newest] - this.xs[oldest]) / dt;
    out.y = (this.ys[newest] - this.ys[oldest]) / dt;
    return out;
  }
}

/** Clamp a velocity vector's length to [0, max]; returns its (clamped) speed. */
export function capSpeed(v: Vec, max: number): number {
  const s = Math.hypot(v.x, v.y);
  if (s > max) {
    v.x *= max / s;
    v.y *= max / s;
    return max;
  }
  return s;
}

/**
 * Exact displacement over `dt` of a velocity decaying as v·e^(−k·t):
 * ∫ v e^(−kt) dt = v (1 − e^(−k dt)) / k. Frame-rate independent.
 */
export function flingDisplacement(v: number, friction: number, dt: number): number {
  return (v * (1 - Math.exp(-friction * dt))) / friction;
}

// ── Edge auto-scroll ─────────────────────────────────────────────────────────

function edgeRamp(dist: number, zone: number): number {
  if (dist >= zone) return 0;
  if (dist <= 0) return 1;
  return smoothstep(1 - dist / zone);
}

/**
 * Screen-space scroll velocity (px/s) for a pointer near the viewport edges:
 * +x = reveal more to the right (the pointer hugs the right edge). Zero in the
 * interior; ramps smoothly to `maxSpeed` at (or beyond) the edge.
 */
export function edgeScrollVelocity(x: number, y: number, width: number, height: number, zone: number, maxSpeed: number, out: Vec): Vec {
  out.x = maxSpeed * (edgeRamp(width - x, zone) - edgeRamp(x, zone));
  out.y = maxSpeed * (edgeRamp(height - y, zone) - edgeRamp(y, zone));
  return out;
}

// ── Wheel ────────────────────────────────────────────────────────────────────

/** WheelEvent delta → px (DOM_DELTA_LINE ≈ 16 px, DOM_DELTA_PAGE = one page). */
export function wheelDeltaPx(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * pageSize;
  return delta;
}

// ── Height-aware picking ─────────────────────────────────────────────────────

/** An object standing on the map: square footprint + height in world px. */
export interface PickFootprint {
  x: number;
  y: number;
  size: number;
  /** Top of the silhouette (world px above the ground). */
  height: number;
  /** Bottom of the silhouette (world px, default 0): a skyway deck is a slab from `base` to `height` (EXPANSION §3.7). */
  base?: number;
}

/**
 * Fill `out` with the object occupying tile (tx, ty); false if none (or off-map). `layer` 0 asks
 * for the ground object (a building or zone tower), 1 for the skyway slab over the tile.
 */
export type FootprintLookup = (tx: number, ty: number, out: PickFootprint, layer: 0 | 1) => boolean;

/** pickTile's answer: the tile, and (when sky picking was asked for) whether the skyway slab over it won. */
export interface PickHit extends Vec {
  sky?: boolean;
}

/** The skyway slab a tap can pick: the deck is drawn at SKYWAY.z 52, picked from z 46 to z 56 (EXPANSION §3.7). */
export const SKY_PICK_BASE = 46;
export const SKY_PICK_TOP = 56;
/** A ramp slopes down to its street: its slab reaches lower. */
export const SKY_PICK_RAMP_BASE = 24;
/** Ground objects lower than SKYWAY.z − 4 draw before a deck over or beside them, so the deck wins the tap. */
export const SKY_PICK_LOW = 48;

const scratchFp: PickFootprint = { x: 0, y: 0, size: 1, height: 0, base: 0 };

/**
 * Which tile did the player mean? A tall tower drawn in front of the ground
 * point under the finger visually covers it, so tapping the tower's body
 * should pick the tower, not the street behind it.
 *
 * Moving a screen point *down* by t world px moves it by (t/TILE_H, t/TILE_H)
 * in tile space, so the point is inside an object's extruded silhouette iff
 * the diagonal ray (u+d, v+d), d ∈ [base/TILE_H, height/TILE_H], enters its
 * footprint. We walk that ray through the grid and keep the front-most
 * (largest draw depth) hit. Falls back to the ground tile. (u, v) = fractional
 * tile coords.
 *
 * With `sky`, each tile is also asked for its skyway slab (layer 1). The slab
 * wins over the front-most ground hit when that object is lower than the deck
 * (it draws first) or sits behind the slab; a taller object in front keeps the
 * tap, as it hides the deck. `out.sky` then says which won.
 */
export function pickTile(u: number, v: number, lookup: FootprintLookup, out: PickHit, maxHeight = MAX_PICK_HEIGHT, sky = false): PickHit {
  let tx = Math.floor(u);
  let ty = Math.floor(v);
  out.x = tx;
  out.y = ty;
  const dMax = maxHeight / TILE_H;
  let nextX = tx + 1 - u; // ray parameter where it crosses into column tx+1
  let nextY = ty + 1 - v;
  let bestDepth = -Infinity;
  let bestHeight = 0;
  let skyDepth = -Infinity;
  let skyX = 0;
  let skyY = 0;
  const fp = scratchFp;
  for (let guard = 0; guard < 64; guard++) {
    fp.base = 0;
    if (lookup(tx, ty, fp, 0)) {
      const depth = fp.x + fp.y + 2 * (fp.size - 1);
      if (depth > bestDepth && silhouetteHit(u, v, fp)) {
        bestDepth = depth;
        bestHeight = fp.height;
        out.x = tx;
        out.y = ty;
      }
    }
    if (sky) {
      fp.base = 0;
      if (lookup(tx, ty, fp, 1)) {
        const depth = fp.x + fp.y + 2 * (fp.size - 1);
        if (depth > skyDepth && silhouetteHit(u, v, fp)) {
          skyDepth = depth;
          skyX = tx;
          skyY = ty;
        }
      }
    }
    const d = Math.min(nextX, nextY);
    if (d > dMax) break;
    if (nextX < nextY) {
      tx++;
      nextX += 1;
    } else if (nextY < nextX) {
      ty++;
      nextY += 1;
    } else {
      tx++;
      ty++;
      nextX += 1;
      nextY += 1;
    }
  }
  if (sky) {
    const won = skyDepth > -Infinity && (bestDepth === -Infinity || bestHeight < SKY_PICK_LOW || skyDepth > bestDepth);
    if (won) {
      out.x = skyX;
      out.y = skyY;
    }
    out.sky = won;
  }
  return out;
}

/** Does the diagonal ray from (u, v) meet `fp`'s extruded silhouette between its base and its top? */
function silhouetteHit(u: number, v: number, fp: PickFootprint): boolean {
  const enter = Math.max(fp.x - u, fp.y - v, 0, (fp.base ?? 0) / TILE_H);
  const exit = Math.min(fp.x + fp.size - u, fp.y + fp.size - v);
  return enter < exit && enter * TILE_H <= fp.height;
}

/**
 * Pointer activity the UI must not cover (EXPANSION §7.6 tips): true while a build drag or a
 * long-press peek is in progress. Written by InputController; read by the UI root.
 */
export const pointerActivity = { building: false };
