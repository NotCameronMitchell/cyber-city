// ─────────────────────────────────────────────────────────────────────────────
// Screen-space FX: weather (clear / drizzle / storm spans of in-game time with
// lightning), angled rain streak layers, a soft violet vignette + colour grade
// and faint scanlines. Everything is pre-rendered into small canvases and
// blitted / pattern-filled, so the per-frame cost is a handful of fills.
// ─────────────────────────────────────────────────────────────────────────────

import { hash2 } from '../../game/rng';

export const enum Sky {
  Clear = 0,
  Drizzle = 1,
  Storm = 2,
}

const TILE = 192;

function rainTile(count: number, len0: number, len1: number, width: number, alpha: number): HTMLCanvasElement {
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
        g.lineTo(x + ox - len * 0.24, y + oy + len);
        g.stroke();
      }
  }
  return c;
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
  private flash = 0;
  private flashT = 0;
  private nextFlash = 6;
  private t = 0;
  private far: CanvasPattern | null = null;
  private near: CanvasPattern | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private scan: CanvasPattern | null = null;
  private patCtx: CanvasRenderingContext2D | null = null;

  reset(seed: number) {
    this.seed = seed;
    this.spanEnd = -1;
    this.span = 0;
    this.kind = Sky.Clear;
  }

  /** `clock` = the game's visual clock (seconds of in-game time, scaled by speed). */
  update(dt: number, clock: number, enabled: boolean) {
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
    const target = !enabled ? 0 : this.kind === Sky.Storm ? 1 : this.kind === Sky.Drizzle ? 0.45 : 0;
    this.rain += (target - this.rain) * Math.min(1, dt * 0.35);
    const st = enabled && this.kind === Sky.Storm ? 1 : 0;
    this.storm += (st - this.storm) * Math.min(1, dt * 0.3);
    // Lightning: double-flicker flashes during storms.
    if (this.flash > 0) {
      this.flashT += dt;
      const k = this.flashT;
      this.flash = k < 0.08 ? 1 : k < 0.14 ? 0.25 : k < 0.22 ? 0.85 : Math.max(0, 0.85 - (k - 0.22) * 2.2);
    }
    if (this.storm > 0.7) {
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

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, night: number, quality: 'low' | 'high') {
    if (typeof document === 'undefined') return;
    if (!this.patCtx) this.init(ctx);
    ctx.globalCompositeOperation = 'source-over';

    // Storm gloom.
    if (this.storm > 0.02) {
      ctx.globalAlpha = 0.22 * this.storm;
      ctx.fillStyle = '#080a1c';
      ctx.fillRect(0, 0, w, h);
    }
    // Rain layers.
    if (this.rain > 0.02 && this.far && this.near) {
      const t = this.t;
      const layer = (pat: CanvasPattern, speed: number, alpha: number, scale: number) => {
        const oy = (t * speed) % (TILE * scale);
        const ox = (-t * speed * 0.24) % (TILE * scale);
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pat;
        const pad = TILE;
        ctx.fillRect(-pad, -pad, w / scale + pad * 2, h / scale + pad * 2);
        ctx.restore();
      };
      layer(this.far, 520, Math.min(1, this.rain * 1.4) * (0.55 + 0.25 * night), 1);
      if (quality === 'high' || this.rain > 0.6) layer(this.near, 900, this.rain * 0.5, 1.5);
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
