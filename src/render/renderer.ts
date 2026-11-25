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
import { ZoneType, type Building, type Parcel, type Settings, type SlotId, type Tile } from '../game/types';
import type { World } from '../game/world';
import { buildingCacheStats, drawServiceBuilding, drawZone, prepaintZone, resetFrame, serviceBuildingHeight, setSpriteLimits, zoneBuildingHeight, type ArtEnv } from './buildings';
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
/** Row bands of the turf diff, one a frame (§3.9 R0). */
const TURF_BANDS = 8;
/** Fog lift after an annex (§1.4: 1.5 s). */
const FOG_LIFT_SEC = ANNEX.fogLiftSec;


/**
 * The render-side parcel cache (§6.1, WP-3): parcels.ts' map bits. A 'tiles' event only marks the aligned 2×2 blocks
 * it touches stale (§3.9 R0: a speed-3 frame on a 25-district city carries up to ~1,700 of them, almost all off
 * screen); `sync` refills the stale blocks inside the drawn box before the sweep, plus a bounded number elsewhere, and
 * `get` refills every stale block. Filled whole on a world swap or an annex.
 */
export class ParcelCache {
  map = new Uint8Array(0);
  private world: World | null = null;
  /** Stale 2×2 blocks: a flag per block and the list of flagged ones (block index = (y >> 1) × (N >> 1) + (x >> 1)). */
  private stale = new Uint8Array(0);
  private list = new Int32Array(0);
  private n = 0;
  /** Blocks refilled since the last whole fill (tests: R0). */
  partial = 0;

  private ensure(world: World): void {
    if (world !== this.world || this.map.length !== world.area) {
      this.world = world;
      this.map = new Uint8Array(world.area);
      const bw = world.N >> 1;
      this.stale = new Uint8Array(bw * bw);
      this.list = new Int32Array(bw * bw);
      this.n = 0;
      countPass('region:parcels');
      fillParcelMap(world, this.map);
    }
  }

  /** The map for `world` with every stale block refilled (filled whole when the world changed). */
  get(world: World): Uint8Array {
    this.ensure(world);
    if (this.n) this.drain(world, null, Infinity);
    return this.map;
  }

  /**
   * The map for `world`, exact inside the tile box `box` (the sweep's), with up to `budget` stale blocks elsewhere
   * refilled oldest first, so the backlog drains while the camera looks elsewhere.
   */
  sync(world: World, box: { x0: number; y0: number; x1: number; y1: number }, budget = 384): Uint8Array {
    this.ensure(world);
    if (this.n) this.drain(world, box, budget);
    return this.map;
  }

  /** Blocks still stale (tests). */
  get pending(): number {
    return this.n;
  }

  private drain(world: World, box: { x0: number; y0: number; x1: number; y1: number } | null, budget: number): void {
    const bw = world.N >> 1;
    const list = this.list;
    const stale = this.stale;
    let m = 0;
    for (let k = 0; k < this.n; k++) {
      const b = list[k];
      const x = (b % bw) << 1;
      const y = ((b / bw) | 0) << 1;
      const inBox = box !== null && x + 1 >= box.x0 && x <= box.x1 && y + 1 >= box.y0 && y <= box.y1;
      if (inBox || budget > 0) {
        if (!inBox) budget--;
        stale[b] = 0;
        fillParcelMap(world, this.map, x, y, x + 1, y + 1);
        this.partial++;
      } else list[m++] = b;
    }
    this.n = m;
  }

  /** Tiles changed in a rect: mark the aligned blocks it touches stale (refilled by `sync` / `get`). */
  touch(world: World, r: { x0: number; y0: number; x1: number; y1: number }) {
    if (world !== this.world) return;
    const N = world.N;
    const bw = N >> 1;
    const bx0 = Math.max(0, r.x0) >> 1;
    const by0 = Math.max(0, r.y0) >> 1;
    const bx1 = Math.min(N - 1, r.x1) >> 1;
    const by1 = Math.min(N - 1, r.y1) >> 1;
    const stale = this.stale;
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * bw + bx;
        if (stale[b]) continue;
        stale[b] = 1;
        this.list[this.n++] = b;
      }
  }

  reset() {
    this.world = null;
    this.n = 0;
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

/** A tile's street-view ground signature (Renderer.groundChanged): everything the ground chunks read of it. */
function groundSig(t: Tile, sky: number): number {
  return (
    t.terrain |
    ((t.elev & 3) << 2) |
    ((t.road ? 1 : 0) << 4) |
    ((t.roadKind & 7) << 5) |
    ((t.zone & 3) << 8) |
    ((t.level > 0 ? 1 : 0) << 10) |
    ((t.abandoned ? 1 : 0) << 11) |
    ((t.ground & 7) << 12) |
    ((sky & 255) << 15)
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

/** Bodies the centre-first pass visits at most in a frame (each costs a body pick and a cache lookup, ≈ 0.6 µs). */
const PREPAINT_VISITS = 3000;

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
  /** The atlas scale the City map was last opened at. */
  private mapScale = 0;
  private lastTime = 0;
  private readonly memberParcel: Parcel = { hx: 0, hy: 0, x: 0, y: 0, w: 1, h: 1, level: 0, tier: 0 };
  /** Sweep scratch: which tiles of the current diagonal were drawn in its heads-first pass. */
  private sweepDone = new Uint8Array(0);
  /** Turf wash levels the ground chunks were painted with (diffed on 'turf', §3.9 R0). */
  private turfSeen = new Uint8Array(0);
  private turfWorld: World | null = null;
  /** The turf diff in progress: the next row band (-1 = none), and whether a 'turf' event came during the sweep. */
  private turfBand = -1;
  private turfAgain = false;
  private turfBox = new Int32Array(0);
  /** Ground signatures per tile (groundChanged): street view, building id, skyline roof tint. */
  private sigWorld: World | null = null;
  private sigStreet = new Uint32Array(0);
  private sigBuilding = new Int32Array(0);
  private sigSkyline = new Uint8Array(0);
  /** The pins drawn this frame (CSS px; input reads the same geometry through districts.annexPins). */
  pins: AnnexPin[] = [];
  /** Diagnostics (tests, the browser checks): the band drawn, sprites the skyline sweep drew and dropped. */
  readonly view = {
    band: 'street' as 'street' | 'skyline' | 'map',
    streetMinZoom: 0.25,
    skylineDrawn: 0,
    skylineDropped: 0,
    limits: null as SpriteLimits | null,
    /** The building sweep's time this frame (ms, painting included) and the sprite cache after it (V1 desktop rows). */
    sweepMs: 0,
    sprites: { bytes: 0, built: 0, fallbacks: 0 },
  };

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
        this.seedTurf();
        this.seedGroundSig();
        // The fog lifts off the new district (§1.4: 1.5 s).
        this.lift = { slot: e.slot, t0: this.lastTime };
      }),
      ev.on('tiles', (r) => this.onTiles(r)),
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
    this.seedTurf();
    this.seedGroundSig();
    this.resize();
  }

  /**
   * A 'tiles' event (§3.9 R0): growth sends one per changed tile, up to ~1,700 in one speed-3 frame on a 25-district
   * city. Each cache only marks what it must: chunk dirty rects (by index range), parcel and access blocks (refilled
   * or checked lazily, near the view first), the atlas slot, the skyway layout only near a deck.
   */
  onTiles(r: { x0: number; y0: number; x1: number; y1: number }): void {
    const w = this.game.world;
    const g = this.groundChanged(w, r);
    if (g) this.ground.invalidate(r, g === 1);
    this.overlay.invalidate();
    this.access.invalidate(r, w);
    this.parcels.touch(w, r);
    this.atlas.invalidate(w, r);
    this.skyway.invalidate(w, r);
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
   * the slots where they changed, instead of every chunk on the map. The diff runs in TURF_BANDS row bands, one a frame
   * (a 25-district city has 102,400 owned tiles; the wash lands a few frames later, which nobody sees). A 'turf' event
   * during a sweep finishes it, then sweeps again.
   */
  private turfChanged() {
    if (this.turfBand < 0) this.turfBand = 0;
    else this.turfAgain = true;
  }

  /** One band of the turf diff (called each frame while a sweep runs). */
  private turfStep() {
    const w = this.game.world;
    const turf = w.turf;
    if (this.turfWorld !== w || this.turfSeen.length !== w.area) this.seedTurf();
    const seen = this.turfSeen;
    const N = w.N;
    const R = w.region;
    const band = this.turfBand;
    if (band === 0) countPass('owned:turf');
    const rows = Math.ceil(N / TURF_BANDS);
    const lo = band * rows * N;
    const hi = Math.min(N, (band + 1) * rows) * N;
    const box = this.turfBox.length === R * R * 4 ? this.turfBox.fill(-1) : (this.turfBox = new Int32Array(R * R * 4).fill(-1));
    const owner = turf.owner;
    const str = turf.str;
    for (let s = 0; s < w.segCount; s += 2) {
      const a = Math.max(lo, w.segs[s]);
      const e = Math.min(hi, w.segs[s + 1]);
      for (let i = a; i < e; i++) {
        const o = owner[i];
        const st = str[i];
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
          if (x < box[k]) box[k] = x;
          if (y < box[k + 1]) box[k + 1] = y;
          if (x > box[k + 2]) box[k + 2] = x;
          if (y > box[k + 3]) box[k + 3] = y;
        }
      }
    }
    for (let k = 0; k < box.length; k += 4) if (box[k] >= 0) this.ground.invalidate({ x0: box[k], y0: box[k + 1], x1: box[k + 2], y1: box[k + 3] });
    this.turfBand = band + 1;
    if (this.turfBand >= TURF_BANDS) {
      this.turfBand = this.turfAgain ? 0 : -1;
      this.turfAgain = false;
    }
  }

  /**
   * What the ground chunks paint of a tile (§3.9 R0): the street view reads terrain, step, road and kind, zone,
   * developed or not, abandoned, the building, the ground kind and the deck mask; the skyline view's roof tints also
   * read the level and the body's variant. Growth sends a 'tiles' event per level change, which most of the time
   * changes neither: 0 = nothing to repaint, 1 = the skyline chunks only, 2 = every bucket.
   */
  private groundChanged(w: World, r: { x0: number; y0: number; x1: number; y1: number }): 0 | 1 | 2 {
    if (this.sigWorld !== w || this.sigStreet.length !== w.area) this.seedGroundSig();
    const N = w.N;
    const tiles = w.tiles;
    const sky = w.sky;
    const st = this.sigStreet;
    const bid = this.sigBuilding;
    const sl = this.sigSkyline;
    let out: 0 | 1 | 2 = 0;
    // World.touch widens the changed rect by one tile on each side (inside the map) so the neighbours redraw: only the
    // core can have changed, so only the core is compared (the ring still repaints with the rect).
    const x0 = r.x0 <= 0 ? 0 : r.x0 + 1;
    const y0 = r.y0 <= 0 ? 0 : r.y0 + 1;
    const x1 = r.x1 >= N - 1 ? N - 1 : r.x1 - 1;
    const y1 = r.y1 >= N - 1 ? N - 1 : r.y1 - 1;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * N + x;
        const t = tiles[i];
        const a = groundSig(t, sky[i]);
        const k = t.level | ((t.variant & 63) << 2);
        if (a !== st[i] || t.buildingId !== bid[i]) {
          st[i] = a;
          bid[i] = t.buildingId;
          sl[i] = k;
          out = 2;
        } else if (k !== sl[i]) {
          sl[i] = k;
          if (out === 0) out = 1;
        }
      }
    return out;
  }

  /** The ground signatures as the chunks paint them now (a new world, an annex: every chunk repaints anyway). */
  private seedGroundSig() {
    const w = this.game.world;
    countPass('region:groundSig');
    this.sigWorld = w;
    if (this.sigStreet.length !== w.area) {
      this.sigStreet = new Uint32Array(w.area);
      this.sigBuilding = new Int32Array(w.area);
      this.sigSkyline = new Uint8Array(w.area);
    }
    const tiles = w.tiles;
    const sky = w.sky;
    for (let i = 0; i < w.area; i++) {
      const t = tiles[i];
      this.sigStreet[i] = groundSig(t, sky[i]);
      this.sigBuilding[i] = t.buildingId;
      this.sigSkyline[i] = t.level | ((t.variant & 63) << 2);
    }
  }

  /**
   * The wash levels the ground chunks paint with now (a new world, or an annex, which repaints every chunk): the next
   * 'turf' diff then repaints only what moved, instead of every tile with turf on the first month after a load.
   */
  private seedTurf() {
    const w = this.game.world;
    if (this.turfWorld !== w || this.turfSeen.length !== w.area) {
      this.turfWorld = w;
      this.turfSeen = new Uint8Array(w.area);
    }
    countPass('owned:turfSeed');
    this.turfBand = -1;
    this.turfAgain = false;
    const seen = this.turfSeen;
    const owner = w.turf.owner;
    const str = w.turf.str;
    for (let s = 0; s < w.segCount; s += 2)
      for (let i = w.segs[s], e = w.segs[s + 1]; i < e; i++) {
        const o = owner[i];
        const st = str[i];
        seen[i] = o === 1 || o === 2 ? o * 4 + (st >= 75 ? 3 : st >= 50 ? 2 : st >= 25 ? 1 : 0) : 0;
      }
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
    this.seedTurf();
    this.seedGroundSig();
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
    if (this.turfBand >= 0) this.turfStep();
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
      const scale = atlasScale(cam.mapView ? cam.mapZoom : cam.mapFitZoom(), dpr, world.region, this.cls, lowerDetail);
      // Opened, or refitted while open (a resize or rotation moves cam.mapZoom): the atlas at the new scale, painted
      // progressively; the old pictures keep drawing at their own scale meanwhile.
      if (!this.mapOpen || (cam.mapView && Math.abs(scale - this.mapScale) > 1e-6)) {
        this.mapOpen = true;
        this.mapScale = scale;
        this.atlas.open(world, scale);
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
    // The slab under the map, its rim and the sky's parallax follow the owned box ± the peek margin when it is square
    // (one district, MEGACITY §3.9: today's view, the sky and the distant skyline round the city; the ground paints fog
    // only in that margin): a migrated start slot sits 64 tiles in, and the backdrop reads its camera as on that map.
    // With more districts the whole region is the slab (locked land is fog on it).
    const ob = world.ownedBox;
    const pk = ANNEX.peek;
    const sx0 = Math.max(0, ob.x0 - pk);
    const sy0 = Math.max(0, ob.y0 - pk);
    const sx1 = Math.min(world.N - 1, ob.x1 + pk);
    const sy1 = Math.min(world.N - 1, ob.y1 + pk);
    const square = !multi && sx1 - sx0 === sy1 - sy0 && sx0 === sy0;
    const slabN = square ? sx1 - sx0 + 1 : world.N;
    const slabDy = square ? 2 * sx0 * HALF_H : 0;
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
    // Parcels: the stale blocks under the sweep refill now, a bounded number elsewhere (§3.9 R0).
    this.parcels.sync(world, tilesObj);
    const band: SkylineBand = { on: skyline, maxD2: Infinity };
    if (skyline) this.skylineBudget(world, tilesObj, view, band, skylineCap(this.cls, quality, lowerDetail));
    const ts = performance.now();
    // Bodies still showing a fallback last frame: spend this frame's paint budget from the screen centre outward.
    if (this.view.sprites.fallbacks > 0) this.prepaintCentre(target, world, tilesObj, view, env, band);
    this.drawObjects(target, world, tilesObj, view, env, band, lanes);
    this.view.sweepMs = performance.now() - ts;
    const cs = buildingCacheStats();
    this.view.sprites.bytes = cs.bytes;
    this.view.sprites.built = cs.builtThisFrame;
    this.view.sprites.fallbacks = cs.fallbacks;
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
    if (zoom >= 0.45) drawNoRoad(ctx, world, this.access.get(world, tilesObj), tilesObj, time, zoom, view);
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
    const pmap = this.parcels.map;
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

  /**
   * Centre-first painting (§11.1, V1 fallback frames after a pan): visit the zone bodies of the clipped box in square
   * rings round the tile under the screen centre and paint the missing ones within the frame's paint budget, so the
   * middle of the screen shows its real bodies first and the cross-family fallbacks stay at the edges. Only while the
   * last frame drew a fallback; at most PREPAINT_VISITS bodies a frame.
   */
  private prepaintCentre(ctx: CanvasRenderingContext2D, world: World, b: Rect, view: Rect, env: ArtEnv, band: SkylineBand) {
    const N = world.N;
    const c = this.camera.screenToTile(this.cssW / 2, this.cssH / 2);
    const cx = Math.max(b.x0, Math.min(b.x1, Math.round(c.x)));
    const cy = Math.max(b.y0, Math.min(b.y1, Math.round(c.y)));
    const pmap = this.parcels.map;
    const head = this.prepaintParcel;
    const tiles = world.tiles;
    const R = Math.max(cx - b.x0, b.x1 - cx, cy - b.y0, b.y1 - cy);
    let visits = 0;
    const visit = (x: number, y: number): boolean => {
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return true;
      const i = y * N + x;
      const t = tiles[i];
      if (t.zone === ZoneType.None || t.level < 1 || t.buildingId >= 0) return true;
      const bits = pmap[i];
      if (bits & PARCEL_MEMBER && !(bits & PARCEL_HEAD)) return true;
      const p = bits & PARCEL_MEMBER ? parcelFromMap(world, pmap, x, y, head) : null;
      if (band.on && (p ? p.level : t.level) < 3) return true;
      // On screen only (the sweep's cull): the clipped box's corners lie off the screen's sides.
      const wide = p ? HALF_W : 0;
      const wx = (x - y) * HALF_W;
      const wy = (x + y) * HALF_H;
      if (wx + HALF_W + wide < view.x0 || wx - HALF_W - wide > view.x1) return true;
      if (wy + 2 * HALF_H < view.y0 || wy + HALF_H - zoneBuildingHeight(t, p) - 24 > view.y1) return true;
      if (++visits > PREPAINT_VISITS) return false;
      return prepaintZone(ctx, t, p, env, x, y);
    };
    if (!visit(cx, cy)) return;
    for (let r = 1; r <= R; r++) {
      for (let x = cx - r; x <= cx + r; x++) if (!visit(x, cy - r) || !visit(x, cy + r)) return;
      for (let y = cy - r + 1; y <= cy + r - 1; y++) if (!visit(cx - r, y) || !visit(cx + r, y)) return;
    }
  }
  private readonly prepaintParcel: Parcel = { hx: 0, hy: 0, x: 0, y: 0, w: 1, h: 1, level: 0, tier: 0 };

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
   * Zone and service buildings back-to-front: ascending x+y, then within a
   * diagonal the multi-tile heads first, then the other tiles, each by x. A
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
    const pmap = this.parcels.map;
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
    /** Everything the sweep draws at tile (x, y): rail, deck, the body (service or zone), the after-pass. */
    const visit = (x: number, y: number): void => {
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
      if (!onScreenX) return;
      if (mask !== 0 && !railFirst) story.drawRail(ctx, world, x, y, mask);
      if (deck && !deckDone) skyway.drawTile(ctx, world, x, y);
      story.drawAfter(ctx, world, x, y, t, env);
    };
    const done = this.sweepDone.length >= N ? this.sweepDone : (this.sweepDone = new Uint8Array(N));
    for (let s = b.x0 + b.y0; s <= b.x1 + b.y1; s++) {
      const xa = Math.max(b.x0, s - b.y1);
      const xb = Math.min(b.x1, s - b.y0);
      // Multi-tile heads first (buildings of size ≥ 2, then parcels): a body drawn at its head spreads left over
      // (hx − 1, hy + 1) and right over (hx + 1, hy − 1), the only tiles of this diagonal it touches, and both stand in
      // front of a member, so they must draw after the body (a 2×1 parcel would otherwise paint its left facade over
      // the tower at (hx − 1, hy + 1)). Parcels sit on even-aligned blocks, so no parcel head stands in front of another
      // on its diagonal; a building's front-left neighbour can be a 2×1 parcel head, so buildings go first.
      let heads = 0;
      let parcelHeads = 0;
      for (let x = xa; x <= xb; x++) {
        const y = s - x;
        const i = y * N + x;
        let h = 0;
        if (pmap[i] & PARCEL_HEAD) {
          h = 2;
          parcelHeads++;
        } else {
          const id = tiles[i].buildingId;
          if (id >= 0) {
            const bd = world.buildings.get(id);
            if (bd && bd.size > 1 && bd.x + bd.size - 1 === x && bd.y + bd.size - 1 === y) h = 1;
          }
        }
        done[x - xa] = h;
        if (h) heads++;
        if (h === 1) visit(x, y);
      }
      if (parcelHeads) for (let x = xa; x <= xb; x++) if (done[x - xa] === 2) visit(x, s - x);
      for (let x = xa; x <= xb; x++) if (heads === 0 || done[x - xa] === 0) visit(x, s - x);
      story.drawSkybridges(ctx, s);
    }
    if (anySky) skyway.flushCars(ctx);
    this.view.skylineDrawn = drawn;
  }
}
