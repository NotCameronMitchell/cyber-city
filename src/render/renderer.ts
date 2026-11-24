// ─────────────────────────────────────────────────────────────────────────────
// Renderer: composes one frame of the city.
//
//   screen  sky gradient · parallax skyline · horizon haze      (sky.ts)
//   world   under-map glow · map slab                            (sky.ts)
//           cached ground chunks                                 (ground.ts)
//           water shimmer · breathing street glow                (ground.ts)
//           data overlay                                         (overlay.ts)
//           shore-site hints · preview + selection (ground part) · map rim
//           Effects.drawGround (street traffic)
//           depth-sorted buildings, rail, skyway decks and skybridges
//           (faded while an overlay is on) · skyway light glows (one pass)
//           no-road + unpowered glyphs · Effects.drawSky
//           preview ghost + selection box (raised part)
//   screen  cost tag · Effects.drawScreen
//
// The renderer never caches `game.world`: it re-reads it every frame and
// drops every cache when the world is swapped.
// ─────────────────────────────────────────────────────────────────────────────

import { ANNEX } from '../game/config';
import type { Game } from '../game/game';
import { ZoneType, type Building, type Settings } from '../game/types';
import type { World } from '../game/world';
import { drawServiceBuilding, drawZoneBuilding, resetFrame, serviceBuildingHeight, zoneBuildingHeight, type ArtEnv } from './buildings';
import { HALF_H, HALF_W, type Camera } from './camera';
import { shipReach } from './art/ports';
import { SkywayLayer, resetSkywayFrame } from './art/skyway';
import { Effects } from './effects';
import { GroundCache, type Rect } from './ground';
import {
  OverlayLayer,
  RoadAccessMap,
  drawCostTag,
  drawNoRoad,
  drawPreviewGround,
  drawPreviewTop,
  drawSelectionGround,
  drawSelectionTop,
  drawToolHints,
  drawUnpowered,
} from './overlay';
import { Backdrop } from './sky';
import { StoryRender } from './story';

/** Tiles of margin so tall buildings whose base is off-screen still draw. */
const OBJECT_MARGIN = 10;
/** Alpha of buildings while a data overlay is shown. */
const OVERLAY_FADE = 0.35;

/**
 * Does a service building's depth-slot drawing reach into the view (x range vx0..vx1, already
 * widened by half a tile)? Its footprint box and height, plus an E or S Seaport's ship, which
 * is drawn in the port's slot out past its footprint (up to the full approach).
 */
export function buildingInView(bd: Building, vx0: number, vx1: number, view: Rect): boolean {
  const wx = (bd.x - bd.y) * HALF_W;
  const wy = (bd.x + bd.y) * HALF_H;
  const z = bd.size;
  const [rl, rr, rd] = shipReach(bd);
  return (
    !(wx + z * HALF_W + rr < vx0 || wx - z * HALF_W - rl > vx1) &&
    !(wy + z * 2 * HALF_H + rd < view.y0 || wy + z * HALF_H - serviceBuildingHeight(bd.type, bd) - 24 > view.y1)
  );
}

/** Identity tokens per World object, without keeping worlds alive. */
const worldIds = new WeakMap<World, number>();
let nextWorldId = 1;
function worldId(w: World): number {
  let id = worldIds.get(w);
  if (!id) {
    id = nextWorldId++;
    worldIds.set(w, id);
  }
  return id;
}

export class Renderer {
  readonly stats = { fps: 60, drawMs: 0 };

  private readonly ctx: CanvasRenderingContext2D;
  private readonly effects: Effects;
  private readonly ground = new GroundCache();
  private readonly overlay = new OverlayLayer();
  private readonly access = new RoadAccessMap();
  private readonly skyway = new SkywayLayer();
  private backdrop: Backdrop;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private framed = false;
  private worldToken = 0;
  private quality: Settings['quality'];
  private fade: HTMLCanvasElement | null = null;
  private fadeCtx: CanvasRenderingContext2D | null = null;
  private frameNo = 0;
  private unsubs: (() => void)[] = [];
  private readonly story: StoryRender;
  /** Coarse pointer (phones, tablets): the UI action pill already shows the cost, so the world tag is hidden. */
  private readonly touch: boolean;

  constructor(
    public readonly canvas: HTMLCanvasElement,
    public readonly game: Game,
    public readonly camera: Camera,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    this.effects = new Effects(game);
    this.story = new StoryRender(game);
    this.touch = typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches;
    this.quality = game.settings.quality;
    this.worldToken = worldId(game.world);
    camera.setMapSize(game.world.N);
    this.applyFrame();
    this.backdrop = new Backdrop(game.world.seed % 997);
    const ev = game.events;
    this.unsubs.push(
      // Megacity: an annex grows the owned box (bounds, minZoom, fit rect, the ground's box).
      ev.on('annex', () => {
        this.applyFrame();
        this.overlay.invalidate();
        this.access.invalidate();
      }),
      ev.on('tiles', (r) => {
        this.ground.invalidate(r);
        this.overlay.invalidate();
        this.access.invalidate();
      }),
      ev.on('world', () => this.onWorldChanged()),
      ev.on('stats', () => this.overlay.invalidate()),
      ev.on('overlay', () => this.overlay.invalidate()),
      // Turf changed (monthly / crackdown): the colour wash is baked into the ground chunks.
      ev.on('turf', () => {
        const n = this.game.world.N;
        this.ground.invalidate({ x0: 0, y0: 0, x1: n - 1, y1: n - 1 });
        this.overlay.invalidate();
      }),
      ev.on('vertical', () => this.overlay.invalidate()),
      ev.on('settings', () => {
        if (this.game.settings.quality !== this.quality) {
          this.quality = this.game.settings.quality;
          this.ground.reset();
          this.resize();
        }
      }),
    );
    this.resize();
  }

  /** Detach event listeners (not needed for the app's lifetime renderer, handy for tests / hot reload). */
  destroy() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.story.destroy();
    this.ground.reset();
  }

  /**
   * The minimal render frame (MEGACITY §3.9, Step 0b): camera bounds = the owned box ± ANNEX.peek (clipped to the map),
   * `fitMap` frames the owned box, minZoom 0.25 for one district and 0.22 otherwise. WP-3 adds the view bands.
   */
  private applyFrame() {
    const w = this.game.world;
    const b = w.ownedBox;
    const p = ANNEX.peek;
    const N = w.N;
    const cam = this.camera;
    cam.fitRect = { ...b };
    cam.minZoom = w.districts.owned.length > 1 ? 0.22 : 0.25;
    if (cam.zoom < cam.minZoom) cam.zoom = cam.minZoom;
    cam.setBounds({ x0: Math.max(0, b.x0 - p), y0: Math.max(0, b.y0 - p), x1: Math.min(N - 1, b.x1 + p), y1: Math.min(N - 1, b.y1 + p) });
  }

  /** The visible tile range clipped to the owned box (the sweep and the per-tile passes visit only owned land). */
  private clipOwned(r: { x0: number; y0: number; x1: number; y1: number }) {
    const b = this.game.world.ownedBox;
    return { x0: Math.max(r.x0, b.x0), y0: Math.max(r.y0, b.y0), x1: Math.min(r.x1, b.x1), y1: Math.min(r.y1, b.y1) };
  }

  private onWorldChanged() {
    this.worldToken = worldId(this.game.world);
    this.camera.setMapSize(this.game.world.N);
    this.applyFrame();
    this.ground.reset();
    this.overlay.reset();
    this.access.invalidate();
    this.backdrop = new Backdrop(this.game.world.seed % 997);
  }

  // ── Sizing ────────────────────────────────────────────────────────────────

  resize(): void {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    let w = rect.width || c.clientWidth;
    let h = rect.height || c.clientHeight;
    if (!(w > 1 && h > 1)) {
      w = typeof window !== 'undefined' ? window.innerWidth : 800;
      h = typeof window !== 'undefined' ? window.innerHeight : 600;
    }
    const cap = this.game.settings.quality === 'low' ? 1.5 : 2;
    const dpr = Math.max(1, Math.min(cap, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    this.cssW = w;
    this.cssH = h;
    this.dpr = bw / w;
    this.camera.setViewport(w, h);
    if (this.fade) {
      this.fade.width = bw;
      this.fade.height = bh;
    }
    if (!this.framed && w > 10 && h > 10) {
      this.framed = true;
      this.frameInitialView();
    }
  }

  /** First layout: if the camera is untouched, frame the developed area (or map centre) at a tappable zoom. */
  private frameInitialView() {
    const cam = this.camera;
    const world = this.game.world;
    const N = world.N;
    const isDefault = cam.x === 0 && cam.y === cam.mapSize * HALF_H && cam.zoom === 1;
    if (!isDefault) return;
    let x0 = N;
    let y0 = N;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const t = world.tiles[y * N + x];
        if (!t.road && t.zone === ZoneType.None && t.buildingId < 0) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    const phone = Math.min(this.cssW, this.cssH) < 640;
    const [zmin, zmax] = phone ? [0.8, 1.0] : [0.7, 1.25];
    if (x1 < 0) {
      cam.zoom = phone ? 0.9 : 1;
      cam.centerOnTile(N / 2, N / 2);
      return;
    }
    // World extent of the developed bounding box.
    const ww = (x1 - x0 + 1 + (y1 - y0 + 1)) * HALF_W;
    const wh = (x1 - x0 + 1 + (y1 - y0 + 1)) * HALF_H + 120;
    const fit = Math.min(this.cssW / (ww + 80), this.cssH / (wh + 80));
    cam.zoom = Math.max(zmin, Math.min(zmax, fit));
    const cx = (x0 + x1 + 1) / 2;
    const cy = (y0 + y1 + 1) / 2;
    cam.x = (cx - cy) * HALF_W;
    cam.y = (cx + cy) * HALF_H;
    cam.clamp();
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  render(dt: number, time: number): void {
    const t0 = performance.now();
    this.frameNo++;
    // Sprite blits cache the world transform per frame, keyed on time: the still title renders
    // at one fixed time while a rotation or reframe moves the camera, so start each frame fresh.
    resetFrame();
    resetSkywayFrame();
    if (dt > 0 && dt < 1) {
      const inst = 1 / dt;
      this.stats.fps += (inst - this.stats.fps) * 0.08;
    }
    // Cheap self-heal if the canvas (or the display's DPR) changed without a resize() call.
    if ((this.frameNo & 31) === 0) {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const cap = this.game.settings.quality === 'low' ? 1.5 : 2;
      const dpr = Math.max(1, Math.min(cap, window.devicePixelRatio || 1));
      const sized = w > 1 && h > 1 && (Math.abs(w - this.cssW) > 0.5 || Math.abs(h - this.cssH) > 0.5);
      if (sized || Math.abs(dpr - this.dpr) > 0.05) this.resize();
    }

    const game = this.game;
    const world = game.world;
    if (worldId(world) !== this.worldToken) this.onWorldChanged();
    const cam = this.camera;
    const ctx = this.ctx;
    const dpr = this.dpr;
    const zoom = cam.zoom;
    const night = 1 - game.daylight;
    const quality = game.settings.quality;
    const env: ArtEnv = { time, night, zoom, quality };

    this.effects.update(dt);
    this.story.prepare(world, env);
    const visual = this.story.visual;

    const hw = this.cssW / 2 / zoom;
    const hh = this.cssH / 2 / zoom;
    const view: Rect = { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
    const tilesVis = this.clipOwned(cam.visibleTileBounds(1));
    const tilesObj = this.clipOwned(cam.visibleTileBounds(OBJECT_MARGIN));

    // 1. Backdrop (screen space).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    // The slab under the map, its rim and the sky's parallax follow the owned box when it is square (one district,
    // MEGACITY §3.9): a migrated start slot sits 64 tiles in, and the backdrop reads its camera as on the 64 map.
    const ob = world.ownedBox;
    const square = ob.x1 - ob.x0 === ob.y1 - ob.y0 && ob.x0 === ob.y0;
    const slabN = square ? ob.x1 - ob.x0 + 1 : world.N;
    const slabDy = square ? 2 * ob.x0 * HALF_H : 0;
    this.backdrop.drawSky(ctx, this.cssW, this.cssH, dpr, cam.x, cam.y - slabDy, zoom, night, time);

    // 2. World space from here on.
    const wa = dpr * zoom;
    const we = (this.cssW / 2 - cam.x * zoom) * dpr;
    const wf = (this.cssH / 2 - cam.y * zoom) * dpr;
    const setWorld = (c: CanvasRenderingContext2D) => c.setTransform(wa, 0, 0, wa, we, wf);
    setWorld(ctx);
    if (slabDy) ctx.translate(0, slabDy);
    this.backdrop.drawUnderMap(ctx, night, time, zoom, slabDy ? { ...view, y0: view.y0 - slabDy, y1: view.y1 - slabDy } : view, slabN);
    if (slabDy) setWorld(ctx);

    // 3. Cached ground.
    this.ground.draw(
      ctx,
      world,
      { camX: cam.x, camY: cam.y, zoom, dpr, width: this.cssW, height: this.cssH },
      night,
      quality === 'low' ? 3 : 5,
    );
    setWorld(ctx);
    ctx.globalAlpha = 1;

    // 4. Animated ground bits (+ MOTH's breathing street glow) and story ground mood.
    this.ground.drawAnimated(ctx, world, tilesVis, env, view, visual?.presence ?? 0);
    this.story.drawGroundFx(ctx, world, tilesVis, env, view);

    // 5. Data overlay.
    if (game.overlay !== 'none') this.overlay.draw(ctx, world, game.overlay, time, tilesVis, zoom);
    if (slabDy) ctx.translate(0, slabDy);
    this.backdrop.drawRim(ctx, night, zoom, slabN);
    if (slabDy) setWorld(ctx);

    // 6. Ground-level interaction feedback (shore sites while the Seaport tool is active).
    drawToolHints(ctx, game, time, zoom, tilesVis);
    drawSelectionGround(ctx, game, time, zoom);
    drawPreviewGround(ctx, game, time, zoom);

    // 7. Street-level effects.
    ctx.save();
    this.effects.drawGround(ctx, tilesVis, env);
    ctx.restore();
    setWorld(ctx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 8. Buildings, depth sorted. Faded through an offscreen layer under overlays.
    const fading = game.overlay !== 'none';
    let target = ctx;
    if (fading) {
      const fc = this.fadeLayer();
      if (fc) {
        fc.setTransform(1, 0, 0, 1, 0, 0);
        fc.clearRect(0, 0, this.canvas.width, this.canvas.height);
        setWorld(fc);
        target = fc;
      }
    }
    this.skyway.prepare(world, env);
    this.drawObjects(target, world, tilesObj, view, env);
    if (target !== ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = OVERLAY_FADE;
      ctx.drawImage(this.fade!, 0, 0);
      ctx.globalAlpha = 1;
      setWorld(ctx);
    }
    // Skyway headlight / tail-light glows: one additive pass after the sweep (§3.11).
    this.skyway.drawGlows(ctx);
    // Wealth lens pips over the faded buildings (§4.5).
    if (game.overlay !== 'none') this.overlay.drawTop(ctx, world, game.overlay, tilesVis, zoom, view);

    // 9. Status glyphs + sky effects.
    if (game.tool === 'skybridge') this.story.drawAnchors(ctx, world, tilesObj, env);
    drawNoRoad(ctx, world, this.access.get(world), tilesObj, time, zoom, view);
    drawUnpowered(ctx, world, tilesObj, time, zoom, view);
    ctx.globalAlpha = 1;
    ctx.save();
    this.effects.drawSky(ctx, tilesVis, env);
    ctx.restore();
    setWorld(ctx);
    ctx.save();
    this.story.drawSkyFx(ctx, world, tilesObj, env, view);
    ctx.restore();
    setWorld(ctx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 10. Raised interaction feedback.
    drawSelectionTop(ctx, game, time, zoom);
    drawPreviewTop(ctx, game, env);

    // 11. Screen space.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (!this.touch) drawCostTag(ctx, game, cam, dpr);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.story.drawGrade(ctx, this.cssW, this.cssH, night);
    this.effects.drawScreen(ctx, this.cssW, this.cssH, env);
    ctx.restore();

    const ms = performance.now() - t0;
    this.stats.drawMs += (ms - this.stats.drawMs) * 0.1;
  }

  private fadeLayer(): CanvasRenderingContext2D | null {
    if (!this.fade) {
      this.fade = document.createElement('canvas');
      this.fade.width = this.canvas.width;
      this.fade.height = this.canvas.height;
      this.fadeCtx = this.fade.getContext('2d');
    }
    if (this.fade.width !== this.canvas.width || this.fade.height !== this.canvas.height) {
      this.fade.width = this.canvas.width;
      this.fade.height = this.canvas.height;
    }
    return this.fadeCtx;
  }

  /**
   * Zone and service buildings back-to-front: ascending x+y, then x. A
   * multi-tile building draws once, when the sweep reaches its front corner.
   * Ribbon Rail, skyway decks, skybridge segments, turf tags and window
   * candles join the same sweep at their tile's key. Same tile: rail first,
   * then the skyway; a zone tower taller than the rail (or the deck) draws
   * after it, so the tower hides it. A deck over (or beside the +x / +y face
   * of) a building lower than the deck is drawn right after that building
   * (SkywayLayer.afterBuilding), which also lights the dock portals (§3.7).
   */
  private drawObjects(ctx: CanvasRenderingContext2D, world: World, b: Rect, view: Rect, env: ArtEnv) {
    const N = world.N;
    const tiles = world.tiles;
    const rail = world.rail;
    const sky = world.sky;
    const skyway = this.skyway;
    const anySky = skyway.any;
    const story = this.story;
    const vx0 = view.x0 - HALF_W;
    const vx1 = view.x1 + HALF_W;
    const visibleX = (wx: number) => wx + HALF_W >= vx0 && wx - HALF_W <= vx1;
    for (let s = b.x0 + b.y0; s <= b.x1 + b.y1; s++) {
      const xa = Math.max(b.x0, s - b.y1);
      const xb = Math.min(b.x1, s - b.y0);
      for (let x = xa; x <= xb; x++) {
        const y = s - x;
        const i = y * N + x;
        const t = tiles[i];
        const wx0 = (x - y) * HALF_W;
        const onScreenX = wx0 + HALF_W >= vx0 && wx0 - HALF_W <= vx1;
        const mask = rail[i];
        const railFirst = mask !== 0 && onScreenX && story.railBefore(t);
        if (railFirst) story.drawRail(ctx, world, x, y, mask);
        const deck = anySky && sky[i] !== 0 && onScreenX && !skyway.isDeferred(i);
        let deckDone = false;
        if (t.buildingId >= 0) {
          // A deck over a taller building draws first: the building hides it (it docks).
          if (deck) {
            skyway.drawTile(ctx, world, x, y);
            deckDone = true;
          }
          const bd = world.buildings.get(t.buildingId);
          if (bd && bd.x + bd.size - 1 === x && bd.y + bd.size - 1 === y) {
            const wx = (bd.x - bd.y) * HALF_W;
            const wy = (bd.x + bd.y) * HALF_H;
            const z = bd.size;
            const visible = buildingInView(bd, vx0, vx1, view);
            if (anySky) skyway.flushIfUnder(ctx, wx - z * HALF_W, wy + z * HALF_H - serviceBuildingHeight(bd.type, bd) - 24, wx + z * HALF_W, wy + z * 2 * HALF_H);
            if (visible) drawServiceBuilding(ctx, wx, wy, bd, env);
            if (anySky) skyway.afterBuilding(ctx, world, bd, visibleX);
          }
        } else if (t.zone !== ZoneType.None && onScreenX) {
          if (deck && skyway.beforeZone(world, i)) {
            skyway.drawTile(ctx, world, x, y);
            deckDone = true;
          }
          const wy = (x + y) * HALF_H;
          const zh = zoneBuildingHeight(t);
          if (!(wy + 2 * HALF_H < view.y0 || wy + HALF_H - zh - 24 > view.y1)) {
            // Cars queued on decks behind this tower are drawn before it, so it hides them.
            if (anySky) skyway.flushIfUnder(ctx, wx0 - HALF_W, wy + HALF_H - zh - 8, wx0 + HALF_W, wy + 2 * HALF_H);
            drawZoneBuilding(ctx, wx0, wy, t, x, y, env);
          }
        }
        if (!onScreenX) continue;
        if (mask !== 0 && !railFirst) story.drawRail(ctx, world, x, y, mask);
        if (deck && !deckDone) skyway.drawTile(ctx, world, x, y);
        story.drawAfter(ctx, world, x, y, t, env);
      }
      story.drawSkybridges(ctx, s);
    }
    if (anySky) skyway.flushCars(ctx);
  }
}
