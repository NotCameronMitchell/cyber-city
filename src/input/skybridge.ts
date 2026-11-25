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
  /** Draw depth (x + y of the gap tile) and the tube's bottom (world px), to weigh against a tower in front. */
  depth: number;
  bottom: number;
}

export function pickTube(world: World, u: number, v: number): TubeHit | null {
  let best: TubeHit | null = null;
  for (const l of world.links) {
    const { top, bottom } = vertical.tubeOf(vertical.linkRoof(world, l));
    const b = Math.max(0, bottom) / TILE_H;
    const t = Math.max(0, top) / TILE_H;
    vertical.forEachGapTile(l, (gx, gy) => {
      const enter = Math.max(gx - u, gy - v, b);
      const exit = Math.min(gx + 1 - u, gy + 1 - v, t);
      if (enter >= exit) return;
      const depth = gx + gy;
      if (!best || depth > best.depth) best = { link: l.id, x: gx, y: gy, depth, bottom };
    });
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

/**
 * The view that shows anchor A and its 10-tile reach (§5.4 step 2): A's centre in the uncovered area at the zoom that
 * fits A ± 10 tiles, never zooming in and never below REACH_MIN_ZOOM (or the street view's floor).
 */
export function reachView(
  cam: Pick<Camera, 'zoom' | 'width' | 'height' | 'insets' | 'streetMinZoom' | 'minZoom'>,
  a: { x0: number; y0: number; x1: number; y1: number },
  reach = 10,
): { x: number; y: number; zoom: number } {
  const w = a.x1 - a.x0 + 1 + 2 * reach;
  const h = a.y1 - a.y0 + 1 + 2 * reach;
  const ins = cam.insets;
  const vw = Math.max(1, cam.width - ins.left - ins.right);
  const vh = Math.max(1, cam.height - ins.top - ins.bottom);
  const fit = Math.min(vw / (((w + h) / 2) * HALF_W * 2), vh / (((w + h) / 2) * HALF_H * 2));
  const floor = Math.max(REACH_MIN_ZOOM, cam.streetMinZoom, cam.minZoom);
  const zoom = Math.min(cam.zoom, Math.max(floor, fit));
  const cx = (a.x0 + a.x1 + 1) / 2;
  const cy = (a.y0 + a.y1 + 1) / 2;
  const dx = (ins.left - ins.right) / 2;
  const dy = (ins.top - ins.bottom) / 2;
  return { x: (cx - cy) * HALF_W - dx / zoom, y: (cx + cy) * HALF_H - dy / zoom, zoom };
}

/** How many green partners the source has (the pill's "3 in reach"). */
export function inReach(partners: readonly vertical.Partner[]): number {
  let n = 0;
  for (const p of partners) if (p.ok && !p.route) n++;
  return n;
}
