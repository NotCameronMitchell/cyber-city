import { MAP_SIZE } from '../game/types';

// ─────────────────────────────────────────────────────────────────────────────
// Isometric projection + camera. Shared by renderer and input.
//
// World space (px at zoom 1): tile (tx, ty)'s TOP corner sits at
//   wx = (tx - ty) * TILE_W / 2,   wy = (tx + ty) * TILE_H / 2
// so a tile's diamond spans wx ± TILE_W/2 and wy .. wy + TILE_H.
// Its centre is (wx, wy + TILE_H / 2). Height (elevation) goes up = -wy.
// Screen space is CSS pixels (the renderer multiplies by devicePixelRatio).
// ─────────────────────────────────────────────────────────────────────────────

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

export interface Vec {
  x: number;
  y: number;
}

/** World position of a tile's top corner. */
export function tileToWorld(tx: number, ty: number): Vec {
  return { x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H };
}

/** World position of a tile's centre. */
export function tileCenterWorld(tx: number, ty: number): Vec {
  return { x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H + HALF_H };
}

/** Fractional tile coords under a world point (ground plane, ignores elevation). */
export function worldToTileF(wx: number, wy: number): Vec {
  const a = wx / HALF_W;
  const b = wy / HALF_H;
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

export class Camera {
  /** World point shown at the centre of the viewport. */
  x = 0;
  y = MAP_SIZE * HALF_H;
  zoom = 1;
  minZoom = 0.25;
  maxZoom = 3;
  /** Viewport size in CSS px. */
  width = 1;
  height = 1;

  setViewport(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.clamp();
  }

  worldToScreen(wx: number, wy: number): Vec {
    return {
      x: (wx - this.x) * this.zoom + this.width / 2,
      y: (wy - this.y) * this.zoom + this.height / 2,
    };
  }

  screenToWorld(sx: number, sy: number): Vec {
    return {
      x: (sx - this.width / 2) / this.zoom + this.x,
      y: (sy - this.height / 2) / this.zoom + this.y,
    };
  }

  /** Integer tile under a screen point (may be out of map bounds — check with world.inBounds). */
  screenToTile(sx: number, sy: number): Vec {
    const w = this.screenToWorld(sx, sy);
    const t = worldToTileF(w.x, w.y);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  /** Screen position of a tile's centre. */
  tileToScreen(tx: number, ty: number): Vec {
    const w = tileCenterWorld(tx, ty);
    return this.worldToScreen(w.x, w.y);
  }

  /** Pan by a screen-space delta (finger moved by dx, dy → map follows the finger). */
  panBy(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  /** Multiply zoom by `factor`, keeping the world point under screen (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  centerOnTile(tx: number, ty: number) {
    const c = tileCenterWorld(tx, ty);
    this.x = c.x;
    this.y = c.y;
    this.clamp();
  }

  /** Keep the view centre inside the map diamond (with a little slack). */
  clamp() {
    const t = worldToTileF(this.x, this.y);
    const slack = 2;
    const cx = Math.max(-slack, Math.min(MAP_SIZE + slack, t.x));
    const cy = Math.max(-slack, Math.min(MAP_SIZE + slack, t.y));
    if (cx !== t.x || cy !== t.y) {
      this.x = (cx - cy) * HALF_W;
      this.y = (cx + cy) * HALF_H;
    }
  }

  /**
   * Inclusive tile range whose diamonds may be visible, expanded by `marginTiles`
   * (use a larger margin to catch tall buildings whose base is below the screen).
   * Clipped to the map.
   */
  visibleTileBounds(marginTiles = 2): { x0: number; y0: number; x1: number; y1: number } {
    const corners = [
      this.screenToWorld(0, 0),
      this.screenToWorld(this.width, 0),
      this.screenToWorld(0, this.height),
      this.screenToWorld(this.width, this.height),
    ].map((w) => worldToTileF(w.x, w.y));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - marginTiles),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - marginTiles),
      x1: Math.min(MAP_SIZE - 1, Math.ceil(Math.max(...xs)) + marginTiles),
      y1: Math.min(MAP_SIZE - 1, Math.ceil(Math.max(...ys)) + marginTiles),
    };
  }

  /** Zoom so the whole map fits the viewport. */
  fitMap() {
    const mapW = MAP_SIZE * TILE_W;
    const mapH = MAP_SIZE * TILE_H;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min(this.width / mapW, this.height / mapH) * 1.1));
    this.x = 0;
    this.y = MAP_SIZE * HALF_H;
  }
}
