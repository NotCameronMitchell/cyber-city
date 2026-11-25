// ─────────────────────────────────────────────────────────────────────────────
// Weather (docs/MEGACITY.md §6.4). Screen space (ScreenFx): clear / drizzle /
// storm spans of in-game time with lightning, angled rain streak layers, two
// drifting fog bands (fog mornings and storms), a warm pollution haze, a soft
// violet vignette + colour grade and faint scanlines. World space
// (GroundWeather): ground fog patches over water and reeds, and neon
// reflections on wet roads beside lit Market tiles at night.
//
// Settings › Weather: Full, Light (half the rain, half the fog alpha, no
// lightning) or Off (no rain, fog or lightning; the sky's spans still run so a
// storm watch can follow them). District bias: Reedmere and the Sunk fog on 60%
// of mornings (config DISTRICTS[kind].fog), Kessel Flats' haze ×1.5, the
// Shoals' rain driven at a steeper slant. Everything is pre-rendered into
// small canvases and blitted / pattern-filled, so the per-frame cost is a
// handful of fills (≤ 0.5 ms with the ground parts).
// ─────────────────────────────────────────────────────────────────────────────

import { DAY_CYCLE_SECONDS } from '../../game/config';
import { hash2 } from '../../game/rng';
import { Ground, Terrain, ZoneType } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import type { RGB } from '../palette';
import { SIDE_MARKET, SIDE_ROAD, tileOnScreen, type Bounds, type StreetIndex, type ViewRect } from './traffic';

export const enum Sky {
  Clear = 0,
  Drizzle = 1,
  Storm = 2,
}

const TILE = 192;

/** Weather setting as a strength: Full 1, Light 0.5, Off 0. */
export type WeatherLevel = 0 | 0.5 | 1;

/** Rain slant (x per y) of the usual rain and of the Shoals' wind-driven rain. */
const SLANT = 0.24;
const SLANT_STEEP = 0.5;
/** Fog band alpha at Full and Light (§6.4). */
export const FOG_ALPHA = { full: 0.25, light: 0.12 } as const;
/** Haze alpha at most (§6.4). */
export const HAZE_MAX = 0.15;

/**
 * Fog this morning (0..1): the visual clock between 05:00 and 09:00, on a share `chance` of visual days (the
 * district in view, config DISTRICTS[kind].fog: 0.6 in Reedmere and the Sunk, 0.25 elsewhere), easing in and out.
 */
export function fogMorning(clock: number, tod: number, chance: number, seed: number): number {
  const a = 5 / 24;
  const b = 9 / 24;
  if (tod < a || tod > b) return 0;
  const day = Math.floor(clock / DAY_CYCLE_SECONDS);
  if (hash2(day, 41, seed) >= chance) return 0;
  const edge = 0.025;
  return Math.min(1, (tod - a) / edge, (b - tod) / edge);
}

function rainTile(count: number, len0: number, len1: number, width: number, alpha: number, slant = SLANT): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  // Deterministic layout so the pattern is identical every session.
  for (let i = 0; i < count; i++) {
    const x = hash2(i, 1, 77) * TILE;
    const y = hash2(i, 2, 77) * TILE;
    const len = len0 + hash2(i, 3, 77) * (len1 - len0);
    const a = alpha * (0.45 + 0.55 * hash2(i, 4, 77));
    g.strokeStyle = `rgba(178,196,255,${a.toFixed(3)})`;
    g.lineWidth = width;
    // Draw wrapped copies so streaks tile seamlessly.
    for (const ox of [-TILE, 0, TILE])
      for (const oy of [-TILE, 0, TILE]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox - len * slant, y + oy + len);
        g.stroke();
      }
  }
  return c;
}


/** A soft fog band (512 × 256): overlapping pale blobs, denser in the middle row. Deterministic per `salt`. */
function fogBand(salt: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  // Blobs stay inside the band's height (no hard top or bottom edge); they wrap left to right.
  for (let i = 0; i < 30; i++) {
    const x = hash2(i, 1, salt) * 512;
    const y = 128 + (hash2(i, 2, salt) - 0.5) * 70;
    const r = 40 + hash2(i, 3, salt) * (126 - 40 - Math.abs(y - 128));
    // Wrapped copies so the band tiles seamlessly left to right.
    for (const ox of [-512, 0, 512]) {
      const grad = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      grad.addColorStop(0, 'rgba(206,210,230,0.34)');
      grad.addColorStop(1, 'rgba(206,210,230,0)');
      g.fillStyle = grad;
      g.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  }
  return c;
}

/** What Effects tells the screen weather each frame. */
export interface WeatherFrame {
  /** Settings › Weather (lower detail: 0). */
  level: WeatherLevel;
  /** Fog morning strength 0..1 for the district in view (fogMorning). */
  fog: number;
  /** City pollution 0..1 (stats.avgPollution) and the haze multiplier of the district in view (Kessel 1.5). */
  pollution: number;
  hazeMul: number;
  /** The district in view drives its rain at a steeper slant (Saltglass Shoals). */
  steep: boolean;
}

export class ScreenFx {
  /** Current kind and the visual-clock time at which the span ends. */
  kind: Sky = Sky.Clear;
  private spanEnd = -1;
  private span = 0;
  private seed = 0;
  /** Smoothed rain intensity 0..1 and storm darkness 0..1. */
  rain = 0;
  private storm = 0;
  /** Smoothed fog 0..1 (fog mornings, storms) and haze alpha. */
  fog = 0;
  haze = 0;
  private level: WeatherLevel = 1;
  private steep = 0;
  private flash = 0;
  private flashT = 0;
  private nextFlash = 6;
  private t = 0;
  private far: CanvasPattern | null = null;
  private near: CanvasPattern | null = null;
  private farSteep: CanvasPattern | null = null;
  private nearSteep: CanvasPattern | null = null;
  private bands: HTMLCanvasElement[] = [];
  private vignette: HTMLCanvasElement | null = null;
  private scan: CanvasPattern | null = null;
  private patCtx: CanvasRenderingContext2D | null = null;

  reset(seed: number) {
    this.seed = seed;
    this.spanEnd = -1;
    this.span = 0;
    this.kind = Sky.Clear;
  }

  /**
   * `clock` = the game's visual clock (seconds of in-game time, scaled by speed). `w`: the weather setting and the
   * district bias (a boolean is the old rain toggle: true = Full, false = Off).
   */
  update(dt: number, clock: number, w: WeatherFrame | boolean) {
    const f: WeatherFrame = typeof w === 'boolean' ? { level: w ? 1 : 0, fog: 0, pollution: 0, hazeMul: 1, steep: false } : w;
    const level = f.level;
    this.level = level;
    this.t += dt;
    if (this.spanEnd < 0) {
      // A new city always opens on a clear sky.
      this.spanEnd = clock + 70;
      this.kind = Sky.Clear;
    }
    let guard = 0;
    while (clock >= this.spanEnd && guard++ < 16) {
      this.span++;
      const r = hash2(this.span, 7, this.seed);
      this.kind = r < 0.5 ? Sky.Clear : r < 0.8 ? Sky.Drizzle : Sky.Storm;
      this.spanEnd += 60 + hash2(this.span, 9, this.seed) * 110;
    }
    if (clock < this.spanEnd - 400) this.spanEnd = clock + 60; // clock jumped back (load)
    const on = level > 0;
    const target = !on ? 0 : (this.kind === Sky.Storm ? 1 : this.kind === Sky.Drizzle ? 0.45 : 0) * (level === 1 ? 1 : 0.55);
    const ease = Math.min(1, dt * 0.35);
    this.rain += (target - this.rain) * ease;
    const st = on && this.kind === Sky.Storm ? level : 0;
    this.storm += (st - this.storm) * Math.min(1, dt * 0.3);
    // Fog: a fog morning, or a storm's murk.
    const fogT = on ? Math.max(f.fog, this.kind === Sky.Storm ? 0.8 : 0) : 0;
    this.fog += (fogT - this.fog) * Math.min(1, dt * 0.25);
    // Haze: a warm grade with the city's pollution, at most HAZE_MAX (off with the weather).
    const hazeT = on ? Math.min(HAZE_MAX, f.pollution * 0.45 * f.hazeMul) : 0;
    this.haze += (hazeT - this.haze) * Math.min(1, dt * 0.5);
    this.steep += ((f.steep ? 1 : 0) - this.steep) * Math.min(1, dt * 0.8);
    // Lightning: double-flicker flashes during storms (Full only).
    if (this.flash > 0) {
      this.flashT += dt;
      const k = this.flashT;
      this.flash = k < 0.08 ? 1 : k < 0.14 ? 0.25 : k < 0.22 ? 0.85 : Math.max(0, 0.85 - (k - 0.22) * 2.2);
    }
    if (this.storm > 0.7 && level === 1) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.nextFlash = 5 + Math.random() * 10;
        this.flash = 1;
        this.flashT = 0;
      }
    }
  }

  /** Strength 0..1 of the current lightning flash (for other layers). */
  get lightning(): number {
    return this.flash;
  }

  /** The fog band alpha this frame (0 when there is none; tests). */
  get fogAlpha(): number {
    return this.fog * (this.level === 1 ? FOG_ALPHA.full : this.level === 0.5 ? FOG_ALPHA.light : 0);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, night: number, quality: 'low' | 'high') {
    if (typeof document === 'undefined') return;
    if (!this.patCtx) this.init(ctx);
    ctx.globalCompositeOperation = 'source-over';

    // Haze: a warm grey grade over the city.
    if (this.haze > 0.004) {
      ctx.globalAlpha = this.haze;
      ctx.fillStyle = night > 0.5 ? '#5a4a44' : '#9c8a78';
      ctx.fillRect(0, 0, w, h);
    }
    // Storm gloom.
    if (this.storm > 0.02) {
      ctx.globalAlpha = 0.22 * this.storm;
      ctx.fillStyle = '#080a1c';
      ctx.fillRect(0, 0, w, h);
    }
    // Fog bands drifting across the screen.
    const fa = this.fogAlpha;
    if (fa > 0.004 && this.bands.length) {
      const t = this.t;
      const bw = Math.max(512, w * 0.9);
      const bh = Math.max(256, h * 0.45);
      for (let k = 0; k < 2; k++) {
        const band = this.bands[k];
        const speed = k ? 9 : 5;
        const off = ((t * speed + k * 311) % bw) - bw;
        const y = k ? h * 0.42 : h * 0.08;
        ctx.globalAlpha = Math.min(1, fa * (1 - 0.3 * night) * 2);
        for (let x = off; x < w; x += bw) ctx.drawImage(band, x, y, bw, bh);
      }
    }
    // Rain layers (the Shoals' slant cross-fades in).
    if (this.rain > 0.02 && this.far && this.near) {
      const t = this.t;
      const layer = (pat: CanvasPattern, speed: number, alpha: number, scale: number, slant: number) => {
        if (alpha <= 0.004) return;
        const oy = (t * speed) % (TILE * scale);
        const ox = (-t * speed * slant) % (TILE * scale);
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pat;
        const pad = TILE;
        ctx.fillRect(-pad, -pad, w / scale + pad * 2, h / scale + pad * 2);
        ctx.restore();
      };
      const s = this.steep;
      const farA = Math.min(1, this.rain * 1.4) * (0.55 + 0.25 * night);
      layer(this.far, 520, farA * (1 - s), 1, SLANT);
      if (this.farSteep) layer(this.farSteep, 560, farA * s, 1, SLANT_STEEP);
      if (quality === 'high' || this.rain > 0.6) {
        layer(this.near, 900, this.rain * 0.5 * (1 - s), 1.5, SLANT);
        if (this.nearSteep) layer(this.nearSteep, 960, this.rain * 0.5 * s, 1.5, SLANT_STEEP);
      }
    }
    // Lightning flash.
    if (this.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.32;
      ctx.fillStyle = '#b8c4ff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Vignette + colour grade.
    if (this.vignette) {
      ctx.globalAlpha = 0.65 + 0.35 * night;
      ctx.drawImage(this.vignette, 0, 0, w, h);
    }
    // Scanlines.
    if (quality === 'high' && this.scan) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = this.scan;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  }

  private init(ctx: CanvasRenderingContext2D) {
    this.patCtx = ctx;
    this.far = ctx.createPattern(rainTile(70, 8, 14, 0.8, 0.5), 'repeat');
    this.near = ctx.createPattern(rainTile(26, 16, 26, 1.1, 0.42), 'repeat');
    this.farSteep = ctx.createPattern(rainTile(70, 9, 16, 0.8, 0.5, SLANT_STEEP), 'repeat');
    this.nearSteep = ctx.createPattern(rainTile(26, 18, 28, 1.1, 0.42, SLANT_STEEP), 'repeat');
    this.bands = [fogBand(17), fogBand(53)];
    // Vignette: radial darkening to deep violet + a faint magenta-top / teal-bottom grade.
    const v = document.createElement('canvas');
    v.width = v.height = 256;
    const g = v.getContext('2d')!;
    const lin = g.createLinearGradient(0, 0, 0, 256);
    lin.addColorStop(0, 'rgba(110,20,140,0.09)');
    lin.addColorStop(0.45, 'rgba(0,0,0,0)');
    lin.addColorStop(1, 'rgba(10,70,100,0.08)');
    g.fillStyle = lin;
    g.fillRect(0, 0, 256, 256);
    const rad = g.createRadialGradient(128, 128, 60, 128, 128, 182);
    rad.addColorStop(0, 'rgba(6,2,18,0)');
    rad.addColorStop(0.65, 'rgba(6,2,18,0.18)');
    rad.addColorStop(1, 'rgba(4,0,12,0.55)');
    g.fillStyle = rad;
    g.fillRect(0, 0, 256, 256);
    this.vignette = v;
    const s = document.createElement('canvas');
    s.width = 4;
    s.height = 3;
    const sg = s.getContext('2d')!;
    sg.fillStyle = 'rgba(0,0,0,0.09)';
    sg.fillRect(0, 0, 4, 1);
    this.scan = ctx.createPattern(s, 'repeat');
  }
}

// ── World space: ground fog patches and neon reflections ──

/** Caps and zoom floors of §6.4. */
export const FOG_PATCH_CAP = 40;
export const FOG_PATCH_MIN_ZOOM = 0.5;
export const REFLECTION_CAP = 120;
export const REFLECTION_MIN_ZOOM = 0.6;

const NEON: RGB[] = [
  [255, 60, 190],
  [60, 220, 255],
  [255, 200, 70],
  [150, 90, 255],
  [80, 255, 170],
  [255, 90, 90],
];

/** What Effects tells the ground weather each frame. */
export interface GroundWeatherFrame {
  zoom: number;
  night: number;
  rain: number;
  fog: number;
  /** Fog patches allowed (high quality, weather on). */
  patches: boolean;
  /** Reflections allowed (weather on). */
  reflections: boolean;
  time: number;
  /** The screen in world px. */
  view: ViewRect | null;
}

/** A wet-road reflection: a thin vertical neon streak, bright at the top and fading down (8 × 48). */
function streak(c: RGB): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 8;
  cv.height = 48;
  const g = cv.getContext('2d')!;
  const cols: [number, number, number][] = [
    [0, 8, 0.18],
    [2, 4, 0.45],
    [3, 2, 0.9],
  ];
  for (const [x, w, a] of cols) {
    const grad = g.createLinearGradient(0, 0, 0, 48);
    grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
    grad.addColorStop(0.35, `rgba(${c[0]},${c[1]},${c[2]},${(a * 0.55).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(x, 0, w, 48);
  }
  return cv;
}

export class GroundWeather {
  /** Visible fog patch tiles and reflection tiles (tile indices), refreshed every second. */
  private patches: number[] = [];
  private refl: number[] = [];
  private recount = 0;
  private fogSprite: HTMLCanvasElement | null = null;
  private neon: HTMLCanvasElement[] | null = null;
  /** Drawn last frame (tests). */
  patchesDrawn = 0;
  reflectionsDrawn = 0;

  reset() {
    this.patches.length = 0;
    this.refl.length = 0;
    this.recount = 0;
  }

  invalidate() {
    if (this.recount > 0.25) this.recount = 0.25;
  }

  update(dt: number, world: World, b: Bounds | null, index: StreetIndex, f: GroundWeatherFrame) {
    this.recount -= dt;
    if (this.recount > 0 || !b) return;
    this.recount = 1;
    this.patches.length = 0;
    this.refl.length = 0;
    const wantPatches = f.patches && f.fog > 0.02 && f.zoom >= FOG_PATCH_MIN_ZOOM;
    const wantRefl = f.reflections && f.rain > 0.05 && f.night > 0.35 && f.zoom >= REFLECTION_MIN_ZOOM;
    if (!wantPatches && !wantRefl) return;
    const N = world.N;
    const x0 = Math.max(0, b.x0);
    const y0 = Math.max(0, b.y0);
    const x1 = Math.min(N - 1, b.x1);
    const y1 = Math.min(N - 1, b.y1);
    if (x1 < x0 || y1 < y0) return;
    if (wantRefl) index.refresh(world, { x0, y0, x1, y1 });
    const side = index.side;
    const tiles = world.tiles;
    const seed = world.seed;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * N + x;
        if (wantRefl && side[i] & SIDE_ROAD && (side[i] & SIDE_MARKET) >= 2 && tileOnScreen(f.view, x, y, 16, 40) && this.litBeside(world, x, y)) this.refl.push(i);
        if (wantPatches && !(x & 1) && !(y & 1) && tileOnScreen(f.view, x + 1, y + 1, 100, 40)) {
          const t = tiles[i];
          if ((t.terrain === Terrain.Water || t.ground === Ground.Reed) && world.ownedAt(i) && hash2(x >> 1, y >> 1, seed ^ 0x2f0) < 0.16) this.patches.push(i);
        }
      }
    // Over the cap: keep the ones nearest the middle of the view.
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const near = (list: number[], cap: number) => {
      if (list.length <= cap) return;
      const d = (i: number) => Math.abs((i % N) - cx) + Math.abs(((i / N) | 0) - cy);
      list.sort((a, b) => d(a) - d(b));
      list.length = cap;
    };
    near(this.refl, Math.floor(REFLECTION_CAP / 1.5));
    near(this.patches, FOG_PATCH_CAP);
  }

  /** A lit Market tile (L2+, powered, lived in) beside the road tile. */
  private litBeside(world: World, x: number, y: number): boolean {
    for (let d = 0; d < 4; d++) {
      const t = world.tileAt(x + [0, 1, 0, -1][d], y + [-1, 0, 1, 0][d]);
      if (t && t.zone === ZoneType.Commercial && t.level >= 2 && t.powered && !t.abandoned) return true;
    }
    return false;
  }

  /** World-space draw, after the ground. */
  draw(ctx: CanvasRenderingContext2D, world: World, f: GroundWeatherFrame) {
    this.patchesDrawn = 0;
    this.reflectionsDrawn = 0;
    if (typeof document === 'undefined') return;
    const N = world.N;
    const t = f.time;
    if (this.refl.length && f.reflections && f.rain > 0.05 && f.night > 0.35 && f.zoom >= REFLECTION_MIN_ZOOM) {
      this.neon ??= NEON.map((c) => streak(c));
      ctx.globalCompositeOperation = 'lighter';
      const base = Math.min(1, f.rain * 1.6) * Math.min(1, (f.night - 0.35) * 2.5) * 0.6;
      for (const i of this.refl) {
        const x = i % N;
        const y = (i / N) | 0;
        const n = 1 + (hash2(x, y, 91) < 0.6 ? 1 : 0);
        for (let k = 0; k < n && this.reflectionsDrawn < REFLECTION_CAP; k++) {
          const h = hash2(x * 3 + k, y, 92);
          const u = x + 0.25 + 0.5 * h;
          const v = y + 0.25 + 0.5 * hash2(x, y * 3 + k, 93);
          const px = (u - v) * HALF_W;
          const py = (u + v) * HALF_H;
          ctx.globalAlpha = base * (0.65 + 0.35 * Math.sin(t * 2.3 + h * 20));
          ctx.drawImage(this.neon[((h * 977) | 0) % NEON.length], px - 2.5, py - 3, 5, 22);
          this.reflectionsDrawn++;
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.patches.length && f.patches && f.fog > 0.02 && f.zoom >= FOG_PATCH_MIN_ZOOM) {
      if (!this.fogSprite) {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        const g = c.getContext('2d')!;
        const grad = g.createRadialGradient(64, 32, 0, 64, 32, 62);
        grad.addColorStop(0, 'rgba(214,220,236,0.55)');
        grad.addColorStop(0.6, 'rgba(214,220,236,0.22)');
        grad.addColorStop(1, 'rgba(214,220,236,0)');
        g.fillStyle = grad;
        g.save();
        g.scale(1, 0.5);
        g.fillRect(0, 0, 128, 128);
        g.restore();
        this.fogSprite = c;
      }
      const a = f.fog * (1 - 0.4 * f.night);
      for (const i of this.patches) {
        const x = i % N;
        const y = (i / N) | 0;
        const h = hash2(x, y, 94);
        const u = x + 1 + Math.sin(t * 0.07 + h * 9) * 0.6;
        const v = y + 1 + Math.cos(t * 0.05 + h * 7) * 0.4;
        const px = (u - v) * HALF_W;
        const py = (u + v) * HALF_H;
        ctx.globalAlpha = a * (0.55 + 0.25 * Math.sin(t * 0.3 + h * 13));
        ctx.drawImage(this.fogSprite, px - 96, py - 30, 192, 60);
        this.patchesDrawn++;
      }
    }
    ctx.globalAlpha = 1;
  }
}
