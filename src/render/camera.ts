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
  /**
   * Side in tiles of the map this camera frames: the shown world's `N` (MEGACITY §3.1, the frame is
   * per world). Set at construction and by `setMapSize` when the shown world changes.
   */
  mapSize: number;
  /** World point shown at the centre of the viewport. */
  x = 0;
  y: number;
  zoom = 1;
  minZoom = 0.25;
  maxZoom = 3;
  /** Viewport size in CSS px. */
  width = 1;
  height = 1;
  /**
   * Megacity (MEGACITY §3.9, additive): the tile rect (inclusive) `clamp()` keeps the view centre in instead of the
   * whole map: the owned box ± ANNEX.peek, set by the Renderer. Null = the whole map (today's rule).
   */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** The tile rect `fitMap()` frames (the owned box); null = the whole map. */
  fitRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Screen px the UI covers (§3.9, §14.1): fitBox, fitMap and centerOnTile use the uncovered area. */
  insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /**
   * Megacity view bands (§3.9, set by the Renderer each frame): the smallest zoom of the street view. Below it (and
   * above `minZoom`) a multi-district city draws the skyline view. Input and UI may read it; only the Renderer writes it.
   */
  streetMinZoom = 0.25;
  /**
   * The City map (§3.9): a separate view of the whole region, reached only through `snapToMap()` and left through
   * `snapFromMap()`. While it is on, the Renderer draws the atlas instead of the world, `clamp()` keeps the centre on the
   * map, and zooms stay inside [`mapZoom`, `mapZoom × mapHeadroom`].
   */
  mapView = false;
  /** The City map's fitted zoom (set by `snapToMap`). */
  mapZoom = 0.03;
  /** How far the City map may zoom past its fit (2 for a 5×5 region on a handheld device, else 1; §7.2). */
  mapHeadroom = 1;
  /** The bottom sheet `snapToMap` fitted the map above (CSS px), kept so a resize or rotation refits the same way. */
  private mapInsetBottom = 0;
  /** A running ease (§3.9 snaps, §5.4's 0.3 s eases): from → to over `dur` seconds, smoothstep. */
  private anim: { t: number; dur: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null = null;

  /** A camera on a map of `mapSize` tiles a side, centred on the map at zoom 1. */
  constructor(mapSize: number) {
    this.mapSize = mapSize;
    this.y = mapSize * HALF_H;
  }

  /** The shown world changed side: keep the view, clamped to the new map. */
  setMapSize(mapSize: number) {
    if (mapSize === this.mapSize) return;
    this.mapSize = mapSize;
    this.clamp();
  }

  setViewport(width: number, height: number) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const changed = w !== this.width || h !== this.height;
    this.width = w;
    this.height = h;
    if (changed) this.refitMap();
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
    this.anim = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  /** Multiply zoom by `factor`, keeping the world point under screen (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number) {
    this.anim = null;
    const before = this.screenToWorld(sx, sy);
    const lo = this.mapView ? this.mapZoom : this.minZoom;
    const hi = this.mapView ? this.mapZoom * this.mapHeadroom : this.maxZoom;
    this.zoom = Math.max(lo, Math.min(hi, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  /** Show tile (tx, ty) at the centre of the area the UI leaves uncovered (`insets`; MEGACITY §3.9). */
  centerOnTile(tx: number, ty: number) {
    this.anim = null;
    const c = tileCenterWorld(tx, ty);
    const ins = this.insets;
    this.x = c.x - (ins.left - ins.right) / 2 / this.zoom;
    this.y = c.y - (ins.top - ins.bottom) / 2 / this.zoom;
    this.clamp();
  }

  // ── Eases and the City map snap (MEGACITY §3.9, §5.4) ─────────────────────

  /** True while an ease or a snap runs (the Renderer advances it with `update(dt)`). */
  get animating(): boolean {
    return this.anim !== null;
  }

  /** Ease the view to world point (x, y) at `zoom` over `sec` seconds (0 = at once). Any pan or zoom cancels it. */
  easeTo(x: number, y: number, zoom: number, sec = 0.3) {
    if (!(sec > 0)) {
      this.anim = null;
      this.x = x;
      this.y = y;
      this.zoom = zoom;
      this.clamp();
      return;
    }
    this.anim = { t: 0, dur: sec, x0: this.x, y0: this.y, z0: this.zoom, x1: x, y1: y, z1: zoom };
  }

  /**
   * Ease so a tile rect fits the uncovered area above a bottom sheet (§5.4: the source tower and its reach fit above
   * the pill), at a zoom inside [minZoom, maxZoom].
   */
  easeToBox(r: { x0: number; y0: number; x1: number; y1: number }, insetBottomPx = 0, sec = 0.3) {
    const t = this.target(r, insetBottomPx, 1);
    this.easeTo(t.x, t.y, Math.max(this.minZoom, Math.min(this.maxZoom, t.zoom)), sec);
  }

  /** Advance a running ease by `dt` seconds. Returns true while it still runs. */
  update(dt: number): boolean {
    const a = this.anim;
    if (!a) return false;
    a.t = Math.min(a.dur, a.t + Math.max(0, dt));
    const u = a.t / a.dur;
    const k = u * u * (3 - 2 * u);
    // Zoom eases geometrically, so a tenfold snap does not race through the near half.
    this.zoom = a.z0 * Math.pow(a.z1 / a.z0, k);
    this.x = a.x0 + (a.x1 - a.x0) * k;
    this.y = a.y0 + (a.y1 - a.y0) * k;
    if (a.t >= a.dur) {
      this.anim = null;
      this.clamp();
      return false;
    }
    return true;
  }

  /** The centre and zoom that frame a tile rect in the uncovered area, scaled by `fill` (1 = the rect just fits). */
  private target(r: { x0: number; y0: number; x1: number; y1: number }, insetBottomPx: number, fill: number) {
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    const ins = this.insets;
    const vw = Math.max(1, this.width - ins.left - ins.right);
    const vh = Math.max(1, this.height - ins.top - ins.bottom - insetBottomPx);
    const zoom = Math.min(vw / (((w + h) / 2) * TILE_W), vh / (((w + h) / 2) * TILE_H)) * fill;
    const cx = r.x0 + w / 2;
    const cy = r.y0 + h / 2;
    const dx = (ins.left - ins.right) / 2;
    const dy = (ins.top - ins.bottom - insetBottomPx) / 2;
    return { zoom, x: (cx - cy) * HALF_W - dx / zoom, y: (cx + cy) * HALF_H - dy / zoom };
  }

  /**
   * The City map's fitted zoom for this viewport: the whole region (the map) inside the uncovered area with a little
   * margin, above a bottom sheet of `insetBottomPx` (§3.9: ≈ 0.03–0.05 for 3×3 on a phone).
   */
  mapFitZoom(insetBottomPx = 0): number {
    const n = this.mapSize;
    return this.target({ x0: 0, y0: 0, x1: n - 1, y1: n - 1 }, insetBottomPx, 0.94).zoom;
  }

  /**
   * Snap to the City map (§3.9): animated over 0.3 s to the whole region fitted in the uncovered area (above a bottom
   * sheet of `insetBottomPx`). WP-5 calls it on a continued pinch-out at `minZoom`, the map button, Data → City map and
   * the M key; WP-9 on a new wheel gesture past `minZoom`. `headroom` is how far the map may then zoom in (2 for a 5×5
   * region on a handheld device, §7.2).
   */
  snapToMap(insetBottomPx = 0, headroom = 1, sec = 0.3) {
    const n = this.mapSize;
    const t = this.target({ x0: 0, y0: 0, x1: n - 1, y1: n - 1 }, insetBottomPx, 0.94);
    this.mapView = true;
    this.mapZoom = t.zoom;
    this.mapHeadroom = Math.max(1, headroom);
    this.mapInsetBottom = insetBottomPx;
    this.easeTo(t.x, t.y, t.zoom, sec);
  }

  /**
   * The viewport or the insets changed while the City map is open (a resize, a rotation, the side panel): fit the
   * region again (§3.9, §7.2), so a map opened in landscape still shows every district after a turn to portrait. A view
   * at the fit (or a snap still easing to it) moves to the new fit; a view zoomed in keeps its centre and its zoom
   * relative to the fit, inside the new [mapZoom, mapZoom × mapHeadroom].
   */
  private refitMap() {
    if (!this.mapView) return;
    const n = this.mapSize;
    const t = this.target({ x0: 0, y0: 0, x1: n - 1, y1: n - 1 }, this.mapInsetBottom, 0.94);
    const old = this.mapZoom;
    if (!(t.zoom > 0) || !(old > 0)) return;
    this.mapZoom = t.zoom;
    const a = this.anim;
    if (a && Math.abs(a.z1 - old) <= 1e-9 * old) {
      // The snap is still easing to the old fit: retarget it.
      a.x1 = t.x;
      a.y1 = t.y;
      a.z1 = t.zoom;
      return;
    }
    if (this.zoom <= old * 1.001) {
      this.anim = null;
      this.x = t.x;
      this.y = t.y;
      this.zoom = t.zoom;
      return;
    }
    this.zoom = Math.max(t.zoom, Math.min(t.zoom * this.mapHeadroom, (this.zoom * t.zoom) / old));
  }

  /**
   * Leave the City map (§3.9): pinching in, or tapping an owned slot, snaps back to `minZoom` centred on the world
   * point under screen point (sx, sy) (CSS px; where the fingers are), animated over 0.3 s.
   */
  snapFromMap(sx: number, sy: number, sec = 0.3) {
    const w = this.screenToWorld(sx, sy);
    this.mapView = false;
    const t = worldToTileF(w.x, w.y);
    const b = this.bounds;
    // The centre lands inside the camera bounds (owned box ± peek), as clamp() would put it.
    const cx = b ? Math.max(b.x0, Math.min(b.x1 + 1, t.x)) : Math.max(0, Math.min(this.mapSize, t.x));
    const cy = b ? Math.max(b.y0, Math.min(b.y1 + 1, t.y)) : Math.max(0, Math.min(this.mapSize, t.y));
    this.easeTo((cx - cy) * HALF_W, (cx + cy) * HALF_H, this.minZoom, sec);
  }

  /** Megacity: set (or clear) the tile rect the view centre stays in (§3.9). */
  setBounds(r: { x0: number; y0: number; x1: number; y1: number } | null) {
    this.bounds = r ? { ...r } : null;
    this.clamp();
  }

  /** Megacity: the screen px the UI covers (§3.9; the desktop side panel sets `right`, §14.1). */
  setInsets(i: Partial<{ top: number; right: number; bottom: number; left: number }>) {
    const was = this.insets;
    this.insets = { ...was, ...i };
    const now = this.insets;
    if (this.mapView && (now.top !== was.top || now.right !== was.right || now.bottom !== was.bottom || now.left !== was.left)) {
      this.refitMap();
      this.clamp();
    }
  }

  /** Keep the view centre inside the map diamond, or `bounds` when set (with a little slack). */
  clamp() {
    // On the City map the centre that stays on the map is the uncovered area's (header, sheet: insets), not the canvas's.
    const ox = this.mapView ? (this.insets.left - this.insets.right) / 2 / this.zoom : 0;
    const oy = this.mapView ? (this.insets.top - this.insets.bottom - this.mapInsetBottom) / 2 / this.zoom : 0;
    const t = worldToTileF(this.x + ox, this.y + oy);
    const slack = 2;
    const n = this.mapSize;
    // The City map frames the whole region: the centre stays on the map, not in the owned box.
    const b = this.mapView ? null : this.bounds;
    const lo = b ? b.x0 : 0;
    const hi = b ? b.x1 + 1 : n;
    const loY = b ? b.y0 : 0;
    const hiY = b ? b.y1 + 1 : n;
    const cx = Math.max(lo - slack, Math.min(hi + slack, t.x));
    const cy = Math.max(loY - slack, Math.min(hiY + slack, t.y));
    if (cx !== t.x || cy !== t.y) {
      this.x = (cx - cy) * HALF_W - ox;
      this.y = (cx + cy) * HALF_H - oy;
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
      x1: Math.min(this.mapSize - 1, Math.ceil(Math.max(...xs)) + marginTiles),
      y1: Math.min(this.mapSize - 1, Math.ceil(Math.max(...ys)) + marginTiles),
    };
  }

  /** Zoom so the whole map fits the viewport: the owned box (`fitRect`) when set (MEGACITY §3.9). */
  fitMap() {
    const n = this.mapSize;
    this.fitBox(this.fitRect ?? { x0: 0, y0: 0, x1: n - 1, y1: n - 1 });
  }

  /**
   * Frame a tile rect (inclusive) in the area the UI leaves uncovered (`insets`, plus `insetBottomPx` for a bottom
   * sheet): the zoom that fits it × 1.1 (clamped), its centre at the uncovered area's centre (§3.9).
   */
  fitBox(r: { x0: number; y0: number; x1: number; y1: number }, insetBottomPx = 0) {
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    const ins = this.insets;
    const vw = Math.max(1, this.width - ins.left - ins.right);
    const vh = Math.max(1, this.height - ins.top - ins.bottom - insetBottomPx);
    const boxW = ((w + h) / 2) * TILE_W;
    const boxH = ((w + h) / 2) * TILE_H;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min(vw / boxW, vh / boxH) * 1.1));
    const cx = r.x0 + w / 2;
    const cy = r.y0 + h / 2;
    // The box centre shows at the centre of the uncovered area.
    const dx = (ins.left - ins.right) / 2;
    const dy = (ins.top - ins.bottom - insetBottomPx) / 2;
    this.x = (cx - cy) * HALF_W - dx / this.zoom;
    this.y = (cx + cy) * HALF_H - dy / this.zoom;
  }
}
