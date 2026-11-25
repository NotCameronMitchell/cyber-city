// ─────────────────────────────────────────────────────────────────────────────
// World + screen effects layered around the building pass (life and
// atmosphere, docs/MEGACITY.md §6.4):
//
//   drawGround  street traffic (art/traffic.ts), crowds (art/crowds.ts), boats
//               (art/boats.ts), rain ripples, neon reflections and ground fog
//               (art/weather.ts), City life on the ground (art/festival.ts),
//               ships behind their quay, taxiing planes (art/ports.ts)
//   drawSky     flying cars, searchlights, ad blimps, delivery drones
//               (art/skytraffic.ts), City life in the sky, airborne planes and
//               launches (art/ports.ts)
//   drawScreen  weather (rain, storm gloom, lightning, fog bands, haze),
//               vignette, scanlines (art/weather.ts)
//
// What runs (§6.4, §3.11): Settings › Weather Full / Light / Off, Crowds,
// City life; low quality turns crowds, boats and fog patches off; lower detail
// (a 5×5 city on a handheld) turns weather, crowds and drones off, caps boats
// at 8 and hides City life's visuals (its gameplay terms still apply). Street
// cars, crowds, boats and ripples run only in the street view (§3.9: none in
// the skyline view or under the City map). Budget ≤ 1.5 ms a frame together.
//
// Port FX run on the visual clock: ships and planes advance by dt ×
// game.clockRate (frozen while paused); a launch is a 14 s cut-scene in
// unpaused real seconds that starts only on Game's 'liftoff' event.
//
// The game's world object is replaced on new game / load, so nothing caches
// it: 'world' resets every layer; a 'tiles' event only flags the blocks of its
// rect in the street index and the water graph (R0, §3.9).
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS } from '../game/config';
import type { Game } from '../game/game';
import { shoreFacing } from '../game/ports';
import { hash2 } from '../game/rng';
import { cityLifeOn, crowdsOn, weatherOf } from '../game/settings';
import type { DistrictKind } from '../game/types';
import type { ArtEnv } from './buildings';
import { HALF_H, HALF_W } from './camera';
import { BOAT_CAP, BOAT_CAP_LOW_DETAIL, Boats } from './art/boats';
import { CROWD_MIN_ZOOM, Crowds, type CrowdFrame } from './art/crowds';
import { Festival } from './art/festival';
import { PortFx, setSeaportGhostFacing } from './art/ports';
import { SkyTraffic } from './art/skytraffic';
import { StreetIndex, StreetTraffic, type ViewRect } from './art/traffic';
import { fogMorning, GroundWeather, ScreenFx, Sky, type GroundWeatherFrame, type WeatherLevel } from './art/weather';

export interface TileBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The renderer's view band (renderer.view): street, skyline (§3.9) or the City map. */
export interface ViewBand {
  band: 'street' | 'skyline' | 'map';
}

/** Which life and atmosphere layers run this frame (Effects.levers; tests). */
export interface LifeLevers {
  weather: WeatherLevel;
  crowds: boolean;
  boats: number;
  drones: boolean;
  fogPatches: boolean;
  reflections: boolean;
  cityLife: boolean;
  /** Street cars, crowds, boats and ripples: the street view only. */
  street: boolean;
}

/**
 * The life levers of §6.4 and §3.11 from the settings, lower detail and the view band. `quality` is the player's
 * setting (low turns crowds, boats and fog patches off), not the renderer's, which lower detail forces to low: lower
 * detail has its own levers (weather, crowds and drones off, boats ≤ 8, City life visuals off).
 */
export function lifeLevers(settings: Game['settings'], quality: 'low' | 'high', lowerDetail: boolean, band: ViewBand['band']): LifeLevers {
  const w = weatherOf(settings);
  const weather: WeatherLevel = lowerDetail || w === 'off' ? 0 : w === 'light' ? 0.5 : 1;
  const street = band === 'street';
  return {
    weather,
    crowds: street && !lowerDetail && quality === 'high' && crowdsOn(settings),
    boats: !street || quality === 'low' ? 0 : lowerDetail ? BOAT_CAP_LOW_DETAIL : BOAT_CAP,
    drones: !lowerDetail && band !== 'map',
    fogPatches: weather > 0 && quality === 'high' && band !== 'map',
    reflections: weather > 0 && street,
    cityLife: !lowerDetail && cityLifeOn(settings) && band !== 'map',
    street,
  };
}

export class Effects {
  /** What each road tile has beside it (crowds, vehicle kinds, reflections, City life), refreshed per block (R0). */
  readonly streets = new StreetIndex();
  private street = new StreetTraffic(this.streets);
  private crowds = new Crowds(this.streets);
  private boats = new Boats();
  private sky = new SkyTraffic();
  private screen = new ScreenFx();
  private groundFx = new GroundWeather();
  private festival = new Festival();
  /** Ships, planes and launches (art/ports.ts). */
  readonly ports = new PortFx();
  private bounds: TileBounds | null = null;
  private night = 1;
  private zoom = 1;
  private quality: 'low' | 'high' | null = null;
  private unsubs: (() => void)[] = [];
  /** This frame's levers (tests, diagnostics). */
  levers: LifeLevers = lifeLevers({} as Game['settings'], 'high', false, 'street');
  /** The screen in world px, read off the ground pass's transform (null until the first draw, or without one). */
  private viewRect: ViewRect | null = null;
  private gf: GroundWeatherFrame = { zoom: 1, night: 0, rain: 0, fog: 0, patches: false, reflections: false, time: 0, view: null };
  private cf: CrowdFrame = { tod: 0.5, boostSlot: -1, boostHubs: false, view: null };
  /** This frame's fog morning strength for the district in view (tests, captures). */
  fogTarget = 0;
  /** Per-layer ms of the last update + draws (tests, the §11.1 life budget). */
  readonly ms = { update: 0, ground: 0, sky: 0, screen: 0 };

  constructor(
    public game: Game,
    private readonly view?: ViewBand,
  ) {
    this.screen.reset(game.world.seed);
    this.unsubs.push(
      game.events.on('world', () => this.reset()),
      game.events.on('tiles', (r) => {
        const w = this.game.world;
        this.street.invalidate(w, r);
        this.boats.invalidate(w, r);
        this.crowds.invalidate();
        this.groundFx.invalidate();
        this.ports.invalidate();
      }),
      game.events.on('liftoff', (e) => this.ports.liftoff(this.game.world, e.id, e.first)),
    );
  }

  /** Detach listeners (hot reload / tests). */
  destroy() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private reset() {
    this.street.reset();
    this.crowds.reset();
    this.boats.reset();
    this.sky.reset();
    this.ports.reset();
    this.groundFx.reset();
    this.festival.reset();
    this.streets.invalidate(this.game.world);
    this.screen.reset(this.game.world.seed);
  }

  /** 0..1 rain intensity of the current weather (0 when the weather is off). */
  get rain(): number {
    return this.screen.rain;
  }

  /** Counts of the life layers (tests, the FPS readout). */
  lifeStats() {
    return {
      cars: this.street.size,
      carKinds: this.street.kindCounts(),
      crowds: this.crowds.size,
      crowdsDrawn: this.crowds.drawn,
      boats: this.boats.size,
      boatKinds: this.boats.kindCounts(),
      boatsDrawn: this.boats.drawn,
      drones: this.sky.droneCount,
      reflections: this.groundFx.reflectionsDrawn,
      fogPatches: this.groundFx.patchesDrawn,
      fog: this.screen.fogAlpha,
      haze: this.screen.haze,
      rain: this.screen.rain,
      sky: this.screen.kind,
      festival: this.festival.active,
      festivalDrawn: this.festival.drawn,
      skyLanterns: this.festival.lanterns,
    };
  }

  /** The district at the middle of the view (weather bias, fog chance), or the start's kind. */
  private viewKind(): DistrictKind {
    const b = this.bounds;
    const w = this.game.world;
    if (!b) return 'shore';
    const s = w.slotAt((b.x0 + b.x1) >> 1, (b.y0 + b.y1) >> 1);
    return (s >= 0 && w.districts.kinds[s]) || 'shore';
  }

  update(dt: number): void {
    const t0 = performance.now();
    dt = Math.min(Math.max(dt, 0), 0.1);
    const game = this.game;
    const world = game.world;
    const q = this.quality ?? game.settings.quality;
    const band = this.view?.band ?? 'street';
    const lv = (this.levers = lifeLevers(game.settings, game.settings.quality, game.lowerDetail, band));
    const b = this.bounds;
    this.street.update(dt, world, q, band);
    // Weather: the setting, the fog morning of the district in view, the haze and the Shoals' slant.
    const kind = this.viewKind();
    const tod = game.timeOfDay;
    const fog = (this.fogTarget = game.settings.dayNight ? fogMorning(game.clock, tod, DISTRICTS[kind]?.fog ?? 0.25, world.seed) : 0);
    this.screen.update(dt, game.clock, {
      level: lv.weather,
      fog,
      pollution: world.stats.avgPollution,
      hazeMul: kind === 'flats' ? 1.5 : 1,
      steep: kind === 'shoals',
    });
    // A storm the player can see makes a storm watch eligible (City life).
    game.cityEvents.noteSky(lv.weather > 0 && this.screen.kind === Sky.Storm ? 2 : lv.weather > 0 && this.screen.kind === Sky.Drizzle ? 1 : 0);
    // Crowds (City life doubles them in its district: Market streets on a night market, stations on an arena night).
    const ev = world.cityEvent;
    this.cf.tod = tod;
    this.cf.boostSlot = ev && (ev.id === 'nightmarket' || ev.id === 'arenanight') && lv.cityLife ? (ev.slot ?? -1) : -1;
    this.cf.boostHubs = ev?.id === 'arenanight';
    this.cf.view = this.viewRect;
    this.crowds.update(dt, world, b, lv.crowds && this.zoom >= CROWD_MIN_ZOOM, this.cf);
    this.boats.update(dt, world, b, lv.boats, this.viewRect);
    this.sky.update(dt, world, q, b, this.night, lv.drones);
    const gf = this.gf;
    gf.zoom = this.zoom;
    gf.night = this.night;
    gf.rain = this.screen.rain;
    gf.fog = this.screen.fog;
    gf.patches = lv.fogPatches;
    gf.reflections = lv.reflections;
    gf.view = this.viewRect;
    this.groundFx.update(dt, world, b, this.streets, gf);
    this.festival.update(dt, world, ev, b, this.streets, lv.cityLife);
    this.ports.update(dt, game.clockRate, world);
    // The Seaport placement ghost shows the side that would face the water.
    const plan = game.preview;
    if (plan?.tool === 'seaport' && plan.footprint) setSeaportGhostFacing(shoreFacing(world, plan.footprint.x, plan.footprint.y, plan.footprint.size));
    this.ms.update = performance.now() - t0;
  }

  /** Street-level vehicles etc., world space, drawn after ground, before buildings. */
  drawGround(ctx: CanvasRenderingContext2D, bounds: TileBounds, env: ArtEnv): void {
    const t0 = performance.now();
    const b = (this.bounds ??= { x0: 0, y0: 0, x1: 0, y1: 0 });
    b.x0 = bounds.x0;
    b.y0 = bounds.y0;
    b.x1 = bounds.x1;
    b.y1 = bounds.y1;
    this.night = env.night;
    this.zoom = env.zoom;
    this.quality = env.quality;
    // The screen in world px: the inverse of the world transform over the canvas.
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (m && m.a > 0 && m.d > 0 && ctx.canvas) {
      const vr = (this.viewRect ??= { x0: 0, y0: 0, x1: 0, y1: 0 });
      vr.x0 = -m.e / m.a;
      vr.y0 = -m.f / m.d;
      vr.x1 = (ctx.canvas.width - m.e) / m.a;
      vr.y1 = (ctx.canvas.height - m.f) / m.d;
    }
    const lv = this.levers;
    const rain = this.screen.rain;
    const world = this.game.world;
    if (lv.street && rain > 0.05 && env.quality === 'high' && env.zoom >= 0.5) this.ripples(ctx, bounds, env, rain);
    this.gf.time = env.time;
    this.groundFx.draw(ctx, world, this.gf);
    this.boats.draw(ctx, env.zoom, env.night, env.quality);
    this.ports.drawGround(ctx, env);
    this.street.draw(ctx, bounds, env.zoom, env.night, env.quality, rain);
    this.crowds.draw(ctx, env.night, rain, env.time);
    this.festival.drawGround(ctx, world, env.time, env.night, env.zoom);
    this.ms.ground = performance.now() - t0;
  }

  /** Flying vehicles, searchlights, planes and launches, world space, drawn after buildings. */
  drawSky(ctx: CanvasRenderingContext2D, bounds: TileBounds, env: ArtEnv): void {
    const t0 = performance.now();
    this.sky.draw(ctx, bounds, env.time, env.night, env.zoom, env.quality);
    this.festival.drawSky(ctx, this.game.world, env.time, env.night, env.zoom);
    this.ports.drawSky(ctx, env);
    this.ms.sky = performance.now() - t0;
  }

  /** Screen-space FX (rain, fog, haze, vignette), identity transform scaled by DPR; width/height in CSS px. */
  drawScreen(ctx: CanvasRenderingContext2D, width: number, height: number, env: ArtEnv): void {
    const t0 = performance.now();
    this.screen.draw(ctx, width, height, env.night, env.quality);
    this.ms.screen = performance.now() - t0;
  }

  /** Stateless expanding rings where raindrops hit the ground. */
  private ripples(ctx: CanvasRenderingContext2D, b: TileBounds, env: ArtEnv, rain: number) {
    const count = Math.round(70 * rain);
    const w = b.x1 - b.x0 + 1;
    const h = b.y1 - b.y0 + 1;
    const t = env.time;
    ctx.globalCompositeOperation = env.night > 0.4 ? 'lighter' : 'source-over';
    ctx.strokeStyle = env.night > 0.4 ? '#7fa8ff' : '#c8d4ee';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < count; i++) {
      const cyc = t * 1.6 + i * 0.618;
      const k = cyc % 1;
      const n = Math.floor(cyc);
      const u = b.x0 + hash2(i, n, 11) * w;
      const v = b.y0 + hash2(i, n, 12) * h;
      const x = (u - v) * HALF_W;
      const y = (u + v) * HALF_H;
      const r = 0.6 + k * 3.2;
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
