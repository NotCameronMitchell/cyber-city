// ─────────────────────────────────────────────────────────────────────────────
// Skybridge tool input (docs/MEGACITY.md §5.4, §7.4), as pure geometry so the
// tests can drive it without a browser:
//
//   pickAnchor   the first tap hit-tests tall anchors against their whole
//                sprite silhouette (footprint diamond extruded to the drawn
//                top), the nearest within 24 px wins, the front-most on a tie
//   badgeAt      partner badges are hit in screen space: a green 44 px badge,
//                a red dot that draws at 16 px but takes a 44 px tap
//   snapPartner  a drag snaps to the nearest green partner within 2 tiles of
//                the finger
//   pickTube     a built tube is pickable at its height (a slab between its
//                bottom and top, like the skyway deck), for inspect
//   reachView    the camera target that shows A and its 10-tile reach
// ─────────────────────────────────────────────────────────────────────────────

import { heightOf } from '../game/heights';
import * as vertical from '../game/story/vertical';
import type { World } from '../game/world';
import { HALF_H, HALF_W, TILE_H, type Camera } from '../render/camera';
import type { PartnerBadge } from '../render/overlay';
import { anchorInset, frontKey } from '../render/story';

/** The first tap takes the nearest tall anchor within this many CSS px of the finger (§7.4). */
export const ANCHOR_SLOP_PX = 24;
/** Every badge takes at least a 44 px tap (§7.4: a red dot draws at 16 px). */
export const BADGE_TAP_R = 22;
/** A drag snaps to a valid partner within this many tiles of the finger (§5.4 step 6). */
export const SNAP_TILES = 2;
/** The ease that frames A and its reach never zooms out below this (the street view stays readable). */
export const REACH_MIN_ZOOM = 0.45;

export interface AnchorHit {
  x: number;
  y: number;
  key: number;
  /** Screen distance from the finger to the silhouette (0 inside). */
  d: number;
}

type Cam = Pick<Camera, 'screenToWorld' | 'worldToScreen' | 'zoom'>;

/** Distance (CSS px) from screen point (sx, sy) to an anchor's extruded silhouette; 0 inside. */
export function silhouetteDistance(cam: Cam, a: { x0: number; y0: number; x1: number; y1: number }, top: number, sx: number, sy: number): number {
  const P = (x: number, y: number) => cam.worldToScreen((x - y) * HALF_W, (x + y) * HALF_H);
  const T = P(a.x0, a.y0);
  const R = P(a.x1 + 1, a.y0);
  const B = P(a.x1 + 1, a.y1 + 1);
  const L = P(a.x0, a.y1 + 1);
  const H = top * cam.zoom;
  const x = Math.max(L.x, Math.min(R.x, sx));
  const dx = sx - x;
  // The diamond's lower edge (L → B → R) and upper edge (L → T → R) at x; the silhouette spans upper − H .. lower.
  const lerp = (p: { x: number; y: number }, q: { x: number; y: number }) => (q.x === p.x ? Math.max(p.y, q.y) : p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y));
  const lower = x <= B.x ? lerp(L, B) : lerp(B, R);
  const upper = (x <= T.x ? lerp(L, T) : lerp(T, R)) - H;
  const dy = sy < upper ? upper - sy : sy > lower ? sy - lower : 0;
  return Math.hypot(dx, dy);
}

/**
 * The tall anchor the player meant (§7.4): every anchor whose silhouette comes within `slop` px of the finger, the
 * nearest first, the front-most (largest x + y) on a tie. Candidate tiles lie along the diagonal ray below the
 * finger (a tower's base is below its body on screen), widened by the slop.
 */
export function pickAnchor(world: World, cam: Cam, sx: number, sy: number, slop = ANCHOR_SLOP_PX): AnchorHit | null {
  const w = cam.screenToWorld(sx, sy);
  const u = (w.y / HALF_H + w.x / HALF_W) / 2;
  const v = (w.y / HALF_H - w.x / HALF_W) / 2;
  const slopT = slop / (cam.zoom * TILE_H) + 1;
  const dMax = 440 / TILE_H + slopT;
  const seen = new Set<number>();
  let best: AnchorHit | null = null;
  let bestDepth = -Infinity;
  for (let d = -slopT; d <= dMax; d += 0.5)
    for (let e = -slopT; e <= slopT; e += 0.5) {
      const tx = Math.floor(u + d + e);
      const ty = Math.floor(v + d - e);
      if (!world.inBounds(tx, ty)) continue;
      const t = world.tiles[ty * world.N + tx];
      if (t.buildingId < 0 && t.level < 3) continue;
      const a = vertical.anchorAt(world, tx, ty);
      if (!a || seen.has(a.key)) continue;
      seen.add(a.key);
      const top = Math.max(a.roof, heightOf(world, a.x0, a.y0), heightOf(world, a.i % world.N, (a.i / world.N) | 0));
      const dist = silhouetteDistance(cam, a, top, sx, sy);
      if (dist > slop) continue;
      const depth = a.x1 + a.y1;
      if (!best || dist < best.d - 0.5 || (Math.abs(dist - best.d) <= 0.5 && depth > bestDepth)) {
        best = { x: a.i % world.N, y: (a.i / world.N) | 0, key: a.key, d: dist };
        bestDepth = depth;
      }
    }
  return best;
}

/** The badge under the finger (§7.4): screen space, each at least a 44 px target; the nearest wins. */
export function badgeAt(badges: readonly PartnerBadge[], sx: number, sy: number): PartnerBadge | null {
  let best: PartnerBadge | null = null;
  let bd = Infinity;
  for (const b of badges) {
    const d = Math.hypot(sx - b.x, sy - b.y);
    if (d <= Math.max(b.r, BADGE_TAP_R) && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** The nearest valid partner (a green one, not a route) within SNAP_TILES of tile (tx, ty), or null (§5.4 step 6). */
export function snapPartner(partners: readonly vertical.Partner[], tx: number, ty: number, within = SNAP_TILES): vertical.Partner | null {
  let best: vertical.Partner | null = null;
  let bd = Infinity;
  for (const p of partners) {
    if (!p.ok || p.route) continue;
    const d = Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty));
    if (d <= within && d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** The tube under a tap (§7.4, §5.5): its link and gap tile, picked as a slab between the tube's bottom and top. */
export interface TubeHit {
  link: number;
  x: number;
  y: number;
  /**
   * The sweep key the tube draws at (render/story.ts: the gap tile's x + y, or the back anchor's front corner when
   * that sorts later, so the tube draws over its own tower), to weigh against what pickTile found in front of it.
   */
  depth: number;
  /** The tube's bottom (world px). */
  bottom: number;
}

/**
 * The tube a screen ray at ground point (u, v) crosses (§7.4): the slab over each gap tile between the tube's bottom
 * and top, reaching into the anchors' footprints as far as the art draws the tube and its collars (`anchorInset`).
 * The front-most tube wins.
 */
export function pickTube(world: World, u: number, v: number): TubeHit | null {
  let best: TubeHit | null = null;
  for (const l of world.links) {
    if (!world.inBounds(l.ax, l.ay) || !world.inBounds(l.bx, l.by)) continue;
    const { top, bottom } = vertical.tubeOf(vertical.linkRoof(world, l));
    const b = Math.max(0, bottom) / TILE_H;
    const t = Math.max(0, top) / TILE_H;
    const axisX = l.ay === l.by;
    // A = the back anchor (smaller coordinate along the axis), as render/story.ts draws the tube.
    const flip = axisX ? l.bx < l.ax : l.by < l.ay;
    const ax = flip ? l.bx : l.ax;
    const ay = flip ? l.by : l.ay;
    const bx = flip ? l.ax : l.bx;
    const by = flip ? l.ay : l.by;
    const n = Math.abs(bx - ax) + Math.abs(by - ay);
    const eA = anchorInset(world, ax, ay);
    const eB = anchorInset(world, bx, by);
    const after = frontKey(world, ax, ay);
    for (let k = 1; k < n; k++) {
      const gx = axisX ? ax + k : ax;
      const gy = axisX ? ay : ay + k;
      const s0 = k === 1 ? -eA : 0;
      const s1 = k === n - 1 ? 1 + eB : 1;
      const x0 = axisX ? gx + s0 : gx;
      const x1 = axisX ? gx + s1 : gx + 1;
      const y0 = axisX ? gy : gy + s0;
      const y1 = axisX ? gy + 1 : gy + s1;
      const enter = Math.max(x0 - u, y0 - v, b);
      const exit = Math.min(x1 - u, y1 - v, t);
      if (enter >= exit) continue;
      const depth = Math.max(gx + gy, after);
      if (!best || depth > best.depth) best = { link: l.id, x: gx, y: gy, depth, bottom };
    }
  }
  return best;
}

/** A zone tower's drawn body fills about this share of its tile's width (the kit bodies sit inside the diamond). */
export const TOWER_BODY_SHARE = 0.6;

/**
 * Does a tap that crosses a tube's slab select the tube rather than what pickTile found in front of it (§7.4)? The
 * tube wins when that thing sorts behind the tube, stands lower than the tube's bottom, or is a single-tile zone tower
 * whose narrower body leaves the tube visible where the finger is (the outer part of the tile's width).
 */
export function tubeBeatsFront(
  cam: Pick<Camera, 'worldToScreen' | 'zoom'>,
  front: { x: number; y: number; size: number; depth: number; height: number; zone: boolean },
  tube: Pick<TubeHit, 'depth' | 'bottom'>,
  sx: number,
): boolean {
  if (front.depth <= tube.depth || front.height < tube.bottom) return true;
  if (!front.zone || front.size !== 1) return false;
  const cx = front.x + 0.5;
  const cy = front.y + 0.5;
  const c = cam.worldToScreen((cx - cy) * HALF_W, (cx + cy) * HALF_H);
  return Math.abs(sx - c.x) > HALF_W * cam.zoom * TOWER_BODY_SHARE;
}

/** Screen px a green badge stands above its roof point (its centre 26 px up, plus its 22 px radius), §5.4. */
const BADGE_HEAD_PX = 48;
/** Screen px a badge reaches to either side of its tower's centre line. */
const BADGE_SIDE_PX = 24;

/**
 * The view that shows anchor A and its reach (§5.4 step 2) inside `frame`, the map area the HUD, ticker, pill and
 * toolbar leave open (CSS px; the camera insets when null). With partner roof points (`tops`: the tile and its roof
 * height), it fits A and the badges that stand above them, so none lands under the pill or the HUD; without, A ±
 * `reach` tiles. Never zooms in and never below REACH_MIN_ZOOM (or the street view's floor); when the floor wins, the
 * fit's centre moves only as far as keeps A itself in the frame.
 */
export function reachView(
  cam: Pick<Camera, 'zoom' | 'width' | 'height' | 'insets' | 'streetMinZoom' | 'minZoom'>,
  a: { x0: number; y0: number; x1: number; y1: number },
  reach = 10,
  frame?: { x0: number; y0: number; x1: number; y1: number } | null,
  tops?: readonly { x: number; y: number; roof: number }[],
): { x: number; y: number; zoom: number } {
  const ins = cam.insets;
  const f = frame ?? { x0: ins.left, y0: ins.top, x1: cam.width - ins.right, y1: cam.height - ins.bottom };
  const vw = Math.max(1, f.x1 - f.x0);
  const vh = Math.max(1, f.y1 - f.y0);
  const P = (x: number, y: number) => ({ x: (x - y) * HALF_W, y: (x + y) * HALF_H });
  // World-px box of what must show; `head` is the extra screen px above its top (a badge over the highest roof).
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const add = (p: { x: number; y: number }) => {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  };
  const r = tops && tops.length ? 0 : reach;
  for (const [x, y] of [
    [a.x0 - r, a.y0 - r],
    [a.x1 + 1 + r, a.y0 - r],
    [a.x1 + 1 + r, a.y1 + 1 + r],
    [a.x0 - r, a.y1 + 1 + r],
  ])
    add(P(x, y));
  let head = 0;
  let side = 0;
  if (tops && tops.length) {
    head = BADGE_HEAD_PX;
    side = BADGE_SIDE_PX;
    for (const t of tops) {
      const c = P(t.x + 0.5, t.y + 0.5);
      add({ x: c.x, y: c.y - t.roof });
      add(c);
    }
  }
  const fit = Math.min((vw - 2 * side) / Math.max(1, x1 - x0), (vh - head) / Math.max(1, y1 - y0));
  const floor = Math.max(REACH_MIN_ZOOM, cam.streetMinZoom, cam.minZoom);
  const zoom = Math.min(cam.zoom, Math.max(floor, fit));
  // The box (with its head room) centred in the frame.
  const fcx = (f.x0 + f.x1) / 2;
  const fcy = (f.y0 + f.y1) / 2;
  let x = (x0 + x1) / 2 - (fcx - cam.width / 2) / zoom;
  let y = (y0 + y1) / 2 - (head / 2) / zoom - (fcy - cam.height / 2) / zoom;
  // A's footprint centre stays in the frame (60 px in from its edges) when the box did not fit.
  const ac = P((a.x0 + a.x1 + 1) / 2, (a.y0 + a.y1 + 1) / 2);
  const sxA = (ac.x - x) * zoom + cam.width / 2;
  const syA = (ac.y - y) * zoom + cam.height / 2;
  const m = 60;
  const cx = Math.max(f.x0 + Math.min(m, vw / 2), Math.min(f.x1 - Math.min(m, vw / 2), sxA));
  const cy = Math.max(f.y0 + Math.min(m, vh / 2), Math.min(f.y1 - Math.min(m, vh / 2), syA));
  x += (sxA - cx) / zoom;
  y += (syA - cy) / zoom;
  return { x, y, zoom };
}

/** How many green partners the source has (the pill's "3 in reach"). */
export function inReach(partners: readonly vertical.Partner[]): number {
  let n = 0;
  for (const p of partners) if (p.ok && !p.route) n++;
  return n;
}
