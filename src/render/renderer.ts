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
import { deviceClass } from '../game/device';
import { artOffset, slotRect } from '../game/districts/slots';
import type { Game } from '../game/game';
import { PARCEL_HEAD, PARCEL_MEMBER, PARCEL_SHAPE, fillParcelMap } from '../game/parcels';
import { ZoneType, type Building, type Parcel, type Settings, type SlotId } from '../game/types';
import type { World } from '../game/world';
import { drawServiceBuilding, drawZone, resetFrame, serviceBuildingHeight, setSpriteLimits, zoneBuildingHeight, type ArtEnv } from './buildings';
import { HALF_H, HALF_W, type Camera } from './camera';
import { Atlas } from './atlas';
import {
  DistrictLabel,
  annexPins,
  atlasScale,
  boundaryRuns,
  drawBoundary,
  drawPins,
  skylineCap,
  spriteLimits,
  streetMinZoom,
  type AnnexPin,
  type DeviceKind,
  type SpriteLimits,
} from './districts';
import { css } from './palette';
import { countPass } from './passes';
import { shipReach } from './art/ports';
import { SkywayLayer, resetSkywayFrame } from './art/skyway';
import { Effects } from './effects';
import { GroundCache, type Rect } from './ground';
import {
  OverlayLayer,
  RoadAccessMap,
  drawCostTag,
  drawLaneBands,
  drawPartnerBadges,
  drawSkybridgeGhosts,
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
/** Fog lift after an annex (§1.4: 1.5 s). */
const FOG_LIFT_SEC = ANNEX.fogLiftSec;


/**
 * The render-side parcel cache (§6.1, WP-3): parcels.ts' map bits, refilled for the aligned blocks a 'tiles' event
 * touches (fillParcelMap with its rect) and whole on a world swap or an annex.
 */
export class ParcelCache {
  map = new Uint8Array(0);
  private world: World | null = null;
  /** Blocks refilled since the last whole fill (tests: R0). */
  partial = 0;

  /** The map for `world`, filled whole when the world changed. */
  get(world: World): Uint8Array {
    if (world !== this.world || this.map.length !== world.area) {
      this.world = world;
      this.map = new Uint8Array(world.area);
      countPass('region:parcels');
      fillParcelMap(world, this.map);
    }
    return this.map;
  }

  /** Tiles changed in a rect: refill the aligned blocks it touches. */
  touch(world: World, r: { x0: number; y0: number; x1: number; y1: number }) {
    if (world !== this.world) return;
    fillParcelMap(world, this.map, r.x0, r.y0, r.x1, r.y1);
    this.partial++;
  }

  reset() {
    this.world = null;
  }
}

/**
 * The parcel a tile belongs to, from the cached map bits (or null for a single tile): its rect, its head (front
 * corner, the sort key) and the lowest level and tier of its members (parcels.ts' rule). `out` is reused.
 */
export function parcelFromMap(world: World, map: Uint8Array, x: number, y: number, out: Parcel): Parcel | null {
  const N = world.N;
  const bits = map[y * N + x];
  if (!(bits & PARCEL_MEMBER)) return null;
  const shape = bits & PARCEL_SHAPE;
  const w = shape === 1 || shape === 3 ? 2 : 1;
  const h = shape === 2 || shape === 3 ? 2 : 1;
  const px = w === 2 ? x & ~1 : x;
  const py = h === 2 ? y & ~1 : y;
  let level = 3;
  let tier = 2;
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      const t = world.tiles[(py + dy) * N + px + dx];
      level = Math.min(level, t.level);
      tier = Math.min(tier, t.wealth);
    }
  out.x = px;
  out.y = py;
  out.w = w;
  out.h = h;
  out.hx = px + w - 1;
  out.hy = py + h - 1;
  out.level = level;
  out.tier = tier;
  return out;
}

/** The skyline view's sprite budget for one frame (§3.9): draw tall zone bodies nearest the screen centre first. */
interface SkylineBand {
  on: boolean;
  /** Squared world-px distance from the view centre beyond which tall zone bodies drop to their roof tint. */
  maxD2: number;
}
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
  /** MEGACITY §3.9: the device class (once a session), the City map atlas, the parcel cache, pins, label, boundary. */
  private readonly cls: DeviceKind;
  private readonly atlas = new Atlas();
  private readonly parcels = new ParcelCache();
  private readonly label = new DistrictLabel();
  private runs: number[] = [];
  private runsKey = -1;
  private lift: { slot: SlotId; t0: number } | null = null;
  private mapOpen = false;
  private lastTime = 0;
  private readonly memberParcel: Parcel = { hx: 0, hy: 0, x: 0, y: 0, w: 1, h: 1, level: 0, tier: 0 };
  /** Turf wash levels the ground chunks were painted with (diffed on 'turf', §3.9 R0). */
  private turfSeen = new Uint8Array(0);
  private turfWorld: World | null = null;
  /** The pins drawn this frame (CSS px; input reads the same geometry through districts.annexPins). */
  pins: AnnexPin[] = [];
  /** Diagnostics (tests, the browser checks): the band drawn, sprites the skyline sweep drew and dropped. */
  readonly view = { band: 'street' as 'street' | 'skyline' | 'map', streetMinZoom: 0.25, skylineDrawn: 0, skylineDropped: 0, limits: null as SpriteLimits | null };

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
    this.cls = deviceClass();
    this.quality = this.effectiveQuality();
    this.worldToken = worldId(game.world);
    camera.setMapSize(game.world.N);
    this.applyFrame();
    this.backdrop = new Backdrop(game.world.seed % 997);
    const ev = game.events;
    this.unsubs.push(
      // Megacity: an annex grows the owned box (bounds, minZoom, fit rect, the ground's box).
      ev.on('annex', (e) => {
        this.applyFrame();
        this.overlay.invalidate();
        this.access.invalidate();
        this.parcels.reset();
        const w = this.game.world;
        this.atlas.invalidate(w, slotRect(w, e.slot));
        // The fog lifts off the new district (§1.4: 1.5 s).
        this.lift = { slot: e.slot, t0: this.lastTime };
      }),
      ev.on('tiles', (r) => {
        const w = this.game.world;
        this.ground.invalidate(r);
        this.overlay.invalidate();
        this.access.invalidate(r, w);
        this.parcels.touch(w, r);
        this.atlas.invalidate(w, r);
        this.skyway.invalidate(w, r);
      }),
      // Pump House reclamation: water depth is patched locally (§3.9 R0).
      ev.on('terrain', (r) => this.ground.patchTerrain(this.game.world, r)),
      ev.on('world', () => this.onWorldChanged()),
      ev.on('stats', () => this.overlay.invalidate()),
      ev.on('overlay', () => this.overlay.invalidate()),
      // Turf changed (monthly / crackdown): the colour wash is baked into the ground chunks; repaint where it moved.
      ev.on('turf', () => {
        this.turfChanged();
        this.overlay.invalidate();
      }),
      ev.on('vertical', () => this.overlay.invalidate()),
      ev.on('settings', () => this.qualityMaybeChanged()),
    );
    this.resize();
  }

  /** Detach event listeners (not needed for the app's lifetime renderer, handy for tests / hot reload). */
  destroy() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.story.destroy();
    this.ground.reset();
    this.atlas.reset();
  }

  /** The quality the renderer draws at: Low in lower detail (§3.11: sprite cache 20 MB, DPR cap 1.5), else Settings'. */
  private effectiveQuality(): Settings['quality'] {
    return this.game.lowerDetail ? 'low' : this.game.settings.quality;
  }

  private qualityMaybeChanged() {
    const q = this.effectiveQuality();
    if (q !== this.quality) {
      this.quality = q;
      this.ground.reset();
      this.resize();
    }
  }

  /**
   * Turf moved (§3.9 R0): diff the wash levels the chunks were painted with over the owned segments and repaint only
   * the slots where they changed, instead of every chunk on the map.
   */
  private turfChanged() {
    const w = this.game.world;
    const turf = w.turf;
    if (this.turfWorld !== w || this.turfSeen.length !== w.area) {
      this.turfWorld = w;
      this.turfSeen = new Uint8Array(w.area);
    }
    const seen = this.turfSeen;
    const N = w.N;
    const R = w.region;
    countPass('owned:turf');
    const box = new Int32Array(R * R * 4).fill(-1);
    for (let s = 0; s < w.segCount; s += 2)
      for (let i = w.segs[s]; i < w.segs[s + 1]; i++) {
        const o = turf.owner[i];
        const st = turf.str[i];
        const lv = o === 1 || o === 2 ? o * 4 + (st >= 75 ? 3 : st >= 50 ? 2 : st >= 25 ? 1 : 0) : 0;
        if (lv === seen[i]) continue;
        seen[i] = lv;
        const x = i % N;
        const y = (i / N) | 0;
        const k = ((y >> 6) * R + (x >> 6)) * 4;
        if (box[k] < 0) {
          box[k] = x;
          box[k + 1] = y;
          box[k + 2] = x;
          box[k + 3] = y;
        } else {
          box[k] = Math.min(box[k], x);
          box[k + 1] = Math.min(box[k + 1], y);
          box[k + 2] = Math.max(box[k + 2], x);
          box[k + 3] = Math.max(box[k + 3], y);
        }
      }
    for (let k = 0; k < box.length; k += 4) if (box[k] >= 0) this.ground.invalidate({ x0: box[k], y0: box[k + 1], x1: box[k + 2], y1: box[k + 3] });
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
    this.parcels.reset();
    this.atlas.reset();
    this.turfWorld = null;
    this.lift = null;
    this.runsKey = -1;
    this.qualityMaybeChanged();
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
    const cap = this.quality === 'low' ? 1.5 : 2;
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
    const ob = world.ownedBox;
    for (let y = ob.y0; y <= ob.y1; y++)
      for (let x = ob.x0; x <= ob.x1; x++) {
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
      cam.centerOnTile((ob.x0 + ob.x1 + 1) / 2, (ob.y0 + ob.y1 + 1) / 2);
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
    this.lastTime = time;
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
      const cap = this.quality === 'low' ? 1.5 : 2;
      const dpr = Math.max(1, Math.min(cap, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
      const sized = w > 1 && h > 1 && (Math.abs(w - this.cssW) > 0.5 || Math.abs(h - this.cssH) > 0.5);
      if (sized || Math.abs(dpr - this.dpr) > 0.05) this.resize();
    }

    const game = this.game;
    const world = game.world;
    if (worldId(world) !== this.worldToken) this.onWorldChanged();
    if ((this.frameNo & 15) === 0) this.qualityMaybeChanged();
    const cam = this.camera;
    // Eases and the City map snap (§3.9) advance on the frame clock.
    cam.update(dt);
    const ctx = this.ctx;
    const dpr = this.dpr;
    const night = 1 - game.daylight;
    const quality = this.quality;
    const lowerDetail = game.lowerDetail;
    // View bands (§3.9): one district keeps today's street view down to minZoom.
    const multi = world.districts.owned.length > 1;
    const smz = multi ? streetMinZoom(this.cssW, this.cssH, this.cls, lowerDetail) : cam.minZoom;
    cam.streetMinZoom = smz;
    this.view.streetMinZoom = smz;
    // The building sprite cache sized to the canvas and the frame's sim work (§3.9 PC budgets; WP-4's setter).
    const limits = spriteLimits(this.cls, quality, this.canvas.width * this.canvas.height, game.simMsThisFrame, lowerDetail);
    this.view.limits = limits;
    setSpriteLimits(limits);

    // The City map (§3.9): the atlas instead of the world, while it is open and during the snaps below minZoom.
    if (cam.mapView || cam.zoom < cam.minZoom - 1e-6) {
      if (!this.mapOpen) {
        this.mapOpen = true;
        this.atlas.open(world, atlasScale(cam.mapView ? cam.mapZoom : cam.mapFitZoom(), dpr, world.region, this.cls, lowerDetail));
      }
      this.view.band = 'map';
      this.pins = [];
      this.atlas.draw(ctx, world, cam, dpr, night, time);
      const ms = performance.now() - t0;
      this.stats.drawMs += (ms - this.stats.drawMs) * 0.1;
      return;
    }
    this.mapOpen = false;

    const zoom = cam.zoom;
    const skyline = multi && zoom < smz - 1e-6;
    this.view.band = skyline ? 'skyline' : 'street';
    // WP-4 reads the world for district styles, accents, faction standing and the ending (ArtEnv.world).
    const env: ArtEnv = { time, night, zoom, quality, artOffset: artOffset(world), world };

    this.effects.update(dt);
    this.skyway.prepare(world, env);
    this.story.prepare(world, env, this.skyway);
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
    // With more districts the whole region is the slab (locked land is fog on it).
    const ob = world.ownedBox;
    const square = !multi && ob.x1 - ob.x0 === ob.y1 - ob.y0 && ob.x0 === ob.y0;
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

    // 3. Cached ground (the skyline view bakes roof tints into its own chunks).
    this.ground.draw(ctx, world, { camX: cam.x, camY: cam.y, zoom, dpr, width: this.cssW, height: this.cssH }, night, quality === 'low' ? 3 : 5, skyline);
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
    // The owned / locked border (§3.9) and the fog lifting off a new district.
    if (multi || world.region !== 1) {
      if (this.runsKey !== world.slotsVersion) {
        this.runsKey = world.slotsVersion;
        this.runs = boundaryRuns(world);
      }
      drawBoundary(ctx, this.runs, zoom, night, time);
      this.drawFogLift(ctx, world, time, night);
    }

    // 6. Ground-level interaction feedback (shore sites while the Seaport tool is active).
    drawToolHints(ctx, game, time, zoom, tilesVis);
    drawSelectionGround(ctx, game, time, zoom);
    drawPreviewGround(ctx, game, time, zoom);
    // Skybridge lanes on the ground while a source tower is selected (§5.4).
    const lanes = game.tool === 'skybridge' && game.bridgeSource ? game.skybridgeLanes() : [];
    if (lanes.length) drawLaneBands(ctx, lanes, time, zoom);

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
    const band: SkylineBand = { on: skyline, maxD2: Infinity };
    if (skyline) this.skylineBudget(world, tilesObj, view, band, skylineCap(this.cls, quality, lowerDetail));
    this.drawObjects(target, world, tilesObj, view, env, band, lanes);
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
    if (game.tool === 'skybridge') {
      this.story.drawAnchors(ctx, world, tilesObj, env);
      if (game.bridgeSource) drawSkybridgeGhosts(ctx, game, env, lanes);
    }
    if (zoom >= 0.45) drawNoRoad(ctx, world, this.access.get(world), tilesObj, time, zoom, view);
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
    if (game.tool === 'skybridge' && game.bridgeSource) drawPartnerBadges(ctx, game, cam);
    if (!this.touch) drawCostTag(ctx, game, cam, dpr);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.story.drawGrade(ctx, this.cssW, this.cssH, night);
    this.effects.drawScreen(ctx, this.cssW, this.cssH, env);
    ctx.restore();
    // Annex pins and the district label over everything (§3.9).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.pins = annexPins(world, cam);
    drawPins(ctx, this.pins, time, night);
    this.label.update(world, cam, time, game.preview !== null);
    this.label.draw(ctx, cam);

    const ms = performance.now() - t0;
    this.stats.drawMs += (ms - this.stats.drawMs) * 0.1;
  }

  /** The fog over a just-annexed district fades out over FOG_LIFT_SEC (world transform). */
  private drawFogLift(ctx: CanvasRenderingContext2D, world: World, time: number, night: number) {
    const l = this.lift;
    if (!l) return;
    const u = (time - l.t0) / FOG_LIFT_SEC;
    if (u >= 1 || u < 0) {
      this.lift = null;
      return;
    }
    const r = slotRect(world, l.slot);
    const a = (1 - u) * (1 - u) * 0.85;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = css(night > 0.5 ? [28, 18, 52] : [52, 40, 84]);
    ctx.beginPath();
    ctx.moveTo((r.x0 - r.y0) * HALF_W, (r.x0 + r.y0) * HALF_H);
    ctx.lineTo((r.x1 + 1 - r.y0) * HALF_W, (r.x1 + 1 + r.y0) * HALF_H);
    ctx.lineTo((r.x1 - r.y1) * HALF_W, (r.x1 + r.y1 + 2) * HALF_H);
    ctx.lineTo((r.x0 - r.y1 - 1) * HALF_W, (r.x0 + r.y1 + 1) * HALF_H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * The skyline view's sprite cap (§3.9): count the tall zone bodies whose tiles are on screen; past the cap, keep the
   * nearest the screen centre (a 32-bin histogram of squared distances, O(n)), the rest drop to their roof tints.
   * Buildings (Spires, crowns, Arcologies, landmarks) always draw.
   */
  private skylineBudget(world: World, b: Rect, view: Rect, band: SkylineBand, cap: number) {
    const N = world.N;
    const tiles = world.tiles;
    const pmap = this.parcels.get(world);
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const r2max = ((view.x1 - view.x0) ** 2 + (view.y1 - view.y0) ** 2) / 4 + 1;
    const BINS = 32;
    const hist = new Int32Array(BINS);
    let n = 0;
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const t = tiles[y * N + x];
        if (t.zone === ZoneType.None || t.buildingId >= 0 || t.level < 3) continue;
        const bits = pmap[y * N + x];
        if (bits & PARCEL_MEMBER && !(bits & PARCEL_HEAD)) continue;
        const wx = (x - y) * HALF_W;
        const wy = (x + y) * HALF_H;
        if (wx < view.x0 - HALF_W || wx > view.x1 + HALF_W || wy > view.y1 || wy < view.y0 - 320) continue;
        const d2 = (wx - cx) ** 2 + (wy - cy) ** 2;
        hist[Math.min(BINS - 1, Math.floor((d2 / r2max) * BINS))]++;
        n++;
      }
    this.view.skylineDropped = 0;
    if (n <= cap) return;
    let acc = 0;
    for (let k = 0; k < BINS; k++) {
      if (acc + hist[k] > cap) {
        band.maxD2 = (k / BINS) * r2max;
        this.view.skylineDropped = n - acc;
        return;
      }
      acc += hist[k];
    }
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
   * multi-tile building draws once, when the sweep reaches its front corner;
   * a merged parcel likewise (MEGACITY §6.1: drawZone is called for every
   * member with its parcel; the head, its front corner, draws the body and the
   * other members draw nothing). Ribbon Rail, skyway decks, skybridge
   * segments, turf tags and window candles join the same sweep at their
   * tile's key. Same tile: rail first, then the skyway; a zone tower taller
   * than the rail (or the deck) draws after it, so the tower hides it. A deck
   * over (or beside the +x / +y face of) a building lower than the deck is
   * drawn right after that building (SkywayLayer.afterBuilding), which also
   * lights the dock portals (§3.7).
   *
   * Skyline view (§3.9): zone bodies below level 3 are roof tints in the
   * ground chunks and are skipped here; tall ones past the cap (band.maxD2)
   * too. While a skybridge source is selected, every building standing in one
   * of its lanes draws see-through (alpha 0.35, §5.4).
   */
  private drawObjects(ctx: CanvasRenderingContext2D, world: World, b: Rect, view: Rect, env: ArtEnv, band: SkylineBand, lanes: readonly Rect[]) {
    const N = world.N;
    const tiles = world.tiles;
    const rail = world.rail;
    const sky = world.sky;
    const skyway = this.skyway;
    const anySky = skyway.any;
    const story = this.story;
    const pmap = this.parcels.get(world);
    const member = this.memberParcel;
    const head: Parcel = { hx: 0, hy: 0, x: 0, y: 0, w: 1, h: 1, level: 0, tier: 0 };
    const at = { wx: 0, wy: 0, x: 0, y: 0 };
    const vx0 = view.x0 - HALF_W;
    const vx1 = view.x1 + HALF_W;
    const visibleX = (wx: number) => wx + HALF_W >= vx0 && wx - HALF_W <= vx1;
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    const inLane = (x0: number, y0: number, x1: number, y1: number) => {
      for (const l of lanes) if (x1 >= l.x0 && x0 <= l.x1 && y1 >= l.y0 && y0 <= l.y1) return true;
      return false;
    };
    const seeThrough = lanes.length > 0;
    let drawn = 0;
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
            if (visible) {
              const ghost = seeThrough && inLane(bd.x, bd.y, x, y);
              if (ghost) ctx.globalAlpha = 0.35;
              drawServiceBuilding(ctx, wx, wy, bd, env);
              if (ghost) ctx.globalAlpha = 1;
            }
            if (anySky) skyway.afterBuilding(ctx, world, bd, visibleX);
          }
        } else if (t.zone !== ZoneType.None) {
          const bits = pmap[i];
          const p = bits & PARCEL_MEMBER ? parcelFromMap(world, pmap, x, y, bits & PARCEL_HEAD ? head : member) : null;
          const isHead = !!p && (bits & PARCEL_HEAD) !== 0;
          // A parcel body spreads over its members: widen the cull by its footprint and height (pairs ×1.3, quads ×1.6).
          const wide = isHead ? HALF_W : 0;
          if (onScreenX || (isHead && wx0 + HALF_W + wide >= vx0 && wx0 - HALF_W - wide <= vx1)) {
            if (deck && skyway.beforeZone(world, i)) {
              skyway.drawTile(ctx, world, x, y);
              deckDone = true;
            }
            const level = p ? p.level : t.level;
            const wy = (x + y) * HALF_H;
            let skip = band.on && t.level > 0 && level < 3;
            if (!skip && band.on && t.level > 0 && band.maxD2 !== Infinity) skip = (wx0 - cx) ** 2 + (wy - cy) ** 2 > band.maxD2;
            if (!skip) {
              // A parcel head's body is the whole parcel's (taller on bigger lots, §6.1).
              const zh = zoneBuildingHeight(t, isHead ? p : null);
              if (!(wy + 2 * HALF_H < view.y0 || wy + HALF_H - zh - 24 > view.y1)) {
                // Cars queued on decks behind this tower are drawn before it, so it hides them.
                if (anySky) skyway.flushIfUnder(ctx, wx0 - HALF_W - wide, wy + HALF_H - zh - 8, wx0 + HALF_W + wide, wy + 2 * HALF_H);
                const ghost = seeThrough && (p ? inLane(p.x, p.y, p.hx, p.hy) : inLane(x, y, x, y));
                if (ghost) ctx.globalAlpha = 0.35;
                at.wx = wx0;
                at.wy = wy;
                at.x = x;
                at.y = y;
                drawZone(ctx, t, p, env, at);
                if (ghost) ctx.globalAlpha = 1;
                if (band.on) drawn++;
              }
            }
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
    this.view.skylineDrawn = drawn;
  }
}
