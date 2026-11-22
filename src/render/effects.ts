// ─────────────────────────────────────────────────────────────────────────────
// World + screen effects layered around the building pass:
//
//   drawGround  street traffic (art/traffic.ts) + rain ripples on the ground
//   drawSky     flying cars, searchlights, ad blimps (art/skytraffic.ts)
//   drawScreen  weather (rain, storm gloom, lightning), vignette, scanlines
//               (art/weather.ts)
//
// The game's world object is replaced on new game / load, so nothing caches
// it: 'world' resets every layer, 'tiles' invalidates the road graph.
// ─────────────────────────────────────────────────────────────────────────────

import type { Game } from '../game/game';
import { hash2 } from '../game/rng';
import type { ArtEnv } from './buildings';
import { HALF_H, HALF_W } from './camera';
import { SkyTraffic } from './art/skytraffic';
import { StreetTraffic } from './art/traffic';
import { ScreenFx } from './art/weather';

export interface TileBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Effects {
  private street = new StreetTraffic();
  private sky = new SkyTraffic();
  private screen = new ScreenFx();
  private bounds: TileBounds | null = null;
  private night = 1;
  private unsubs: (() => void)[] = [];

  constructor(public game: Game) {
    this.screen.reset(game.world.seed);
    this.unsubs.push(
      game.events.on('world', () => this.reset()),
      game.events.on('tiles', () => this.street.invalidate()),
    );
  }

  /** Detach listeners (hot reload / tests). */
  destroy() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private reset() {
    this.street.reset();
    this.sky.reset();
    this.screen.reset(this.game.world.seed);
  }

  /** 0..1 rain intensity of the current weather (0 when rain is disabled). */
  get rain(): number {
    return this.screen.rain;
  }

  update(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const game = this.game;
    const world = game.world;
    const q = game.settings.quality;
    this.street.update(dt, world, q);
    this.sky.update(dt, world, q, this.bounds, this.night);
    this.screen.update(dt, game.clock, game.settings.rain);
  }

  /** Street-level vehicles etc., world space, drawn after ground, before buildings. */
  drawGround(ctx: CanvasRenderingContext2D, bounds: TileBounds, env: ArtEnv): void {
    const b = (this.bounds ??= { x0: 0, y0: 0, x1: 0, y1: 0 });
    b.x0 = bounds.x0;
    b.y0 = bounds.y0;
    b.x1 = bounds.x1;
    b.y1 = bounds.y1;
    this.night = env.night;
    const rain = this.screen.rain;
    if (rain > 0.05 && env.quality === 'high' && env.zoom >= 0.5) this.ripples(ctx, bounds, env, rain);
    this.street.draw(ctx, bounds, env.zoom, env.night, env.quality, rain);
  }

  /** Flying vehicles, searchlights etc., world space, drawn after buildings. */
  drawSky(ctx: CanvasRenderingContext2D, bounds: TileBounds, env: ArtEnv): void {
    this.sky.draw(ctx, bounds, env.time, env.night, env.zoom, env.quality);
  }

  /** Screen-space FX (rain, vignette), identity transform scaled by DPR; width/height in CSS px. */
  drawScreen(ctx: CanvasRenderingContext2D, width: number, height: number, env: ArtEnv): void {
    this.screen.draw(ctx, width, height, env.night, env.quality);
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
