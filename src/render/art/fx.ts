// ─────────────────────────────────────────────────────────────────────────────
// Live building effects: the animated parts drawn every frame on top of the
// cached building sprites (blinking beacons, billboards, smoke, strobes...).
//
// Recipes register these anchors during their RECORD pass (see painter.ts);
// coordinates are world px relative to the footprint's top corner. Everything
// here is allocation-free in the hot path: colour strings and glow sprites are
// resolved once per effect and cached on the object.
// ─────────────────────────────────────────────────────────────────────────────

import { css, glowSprite, mix, type RGB } from '../palette';
import { GLYPHS } from './painter';

interface FxBase {
  /** Cached css colour (lazily resolved). */
  cs?: string;
  /** Cached glow sprite (lazily resolved). */
  spr?: HTMLCanvasElement;
  /** Phase offset 0..1. */
  ph: number;
}

export type Fx =
  | (FxBase & { k: 'blink'; x: number; y: number; c: RGB; period: number; size: number; lodOk: boolean })
  | (FxBase & { k: 'smoke'; x: number; y: number; r: number })
  /** Billboard on a face plane: origin (bottom-left), edge vector, height. */
  | (FxBase & { k: 'board'; ox: number; oy: number; ex: number; ey: number; h: number; style: number; c1: RGB; c2: RGB })
  /** Scrolling ticker band on a face plane. */
  | (FxBase & { k: 'ticker'; ox: number; oy: number; ex: number; ey: number; h: number; c1: RGB })
  /** Heartbeat line sign on a face plane. */
  | (FxBase & { k: 'ecg'; ox: number; oy: number; ex: number; ey: number; h: number; c1: RGB })
  | (FxBase & { k: 'strobe'; x: number; y: number; w: number })
  /** A window that flickers at night (quad corners). */
  | (FxBase & { k: 'flicker'; q: number[]; c: RGB; tv: boolean })
  | (FxBase & { k: 'beam'; x: number; y: number; h: number; c: RGB })
  | (FxBase & { k: 'pulse'; x: number; y: number; size: number; c: RGB; period: number })
  | (FxBase & { k: 'holo'; x: number; y: number; h: number })
  | (FxBase & { k: 'ring'; x: number; y: number; rx: number; ry: number; c: RGB })
  | (FxBase & { k: 'rails'; x0: number; y0: number; x1: number; y1: number; c: RGB })
  | (FxBase & { k: 'flame'; x: number; y: number })
  | (FxBase & { k: 'drone'; x: number; y: number; r: number })
  | (FxBase & { k: 'warn'; x: number; y: number });

export interface FxState {
  time: number;
  night: number;
  /** Powered and operating (zone: powered, not abandoned). */
  lit: boolean;
  /** Service building offline / unpowered: red warning blink instead. */
  offline: boolean;
  lod: boolean;
  /** Per-building phase 0..1 (from tile coords). */
  phase: number;
}

// ── Shared, lazily built resources ─────────────────────────────────────────

const RAMP_N = 36;
let ramp: string[] | null = null;
let rampRGB: RGB[] | null = null;
let rampGlow: HTMLCanvasElement[] | null = null;
function hueRGB(h: number): RGB {
  // Neon-biased hue wheel: saturated, bright.
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(1, Math.min(k, 4 - k))));
  };
  const c: RGB = [f(5), f(3), f(1)];
  return mix(c, [255, 255, 255], 0.12);
}
function hueRamp(): string[] {
  if (!ramp) {
    rampRGB = [];
    ramp = [];
    for (let i = 0; i < RAMP_N; i++) {
      const c = hueRGB(i / RAMP_N);
      rampRGB.push(c);
      ramp.push(css(c));
    }
  }
  return ramp;
}
function hueGlow(i: number): HTMLCanvasElement {
  if (!rampGlow) {
    hueRamp();
    rampGlow = [];
    for (let j = 0; j < 12; j++) rampGlow.push(glowSprite(rampRGB![j * 3], 64));
  }
  return rampGlow[Math.floor(i / 3) % 12];
}

let puffDay: HTMLCanvasElement | null = null;
let puffNight: HTMLCanvasElement | null = null;
function puff(night: boolean): HTMLCanvasElement {
  if (!puffDay || !puffNight) {
    const make = (inner: string, outer: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.55, outer);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      return c;
    };
    puffDay = make('rgba(214,212,220,0.9)', 'rgba(190,188,200,0.45)');
    puffNight = make('rgba(92,78,102,0.9)', 'rgba(60,48,74,0.45)');
  }
  return night ? puffNight : puffDay;
}

let beamTex: HTMLCanvasElement | null = null;
function beamSprite(): HTMLCanvasElement {
  if (!beamTex) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 128;
    const g = c.getContext('2d')!;
    const v = g.createLinearGradient(0, 128, 0, 0);
    v.addColorStop(0, 'rgba(120,240,255,0.9)');
    v.addColorStop(0.4, 'rgba(60,200,255,0.35)');
    v.addColorStop(1, 'rgba(40,160,255,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, 16, 128);
    // Fade the sides.
    g.globalCompositeOperation = 'destination-in';
    const hgrad = g.createLinearGradient(0, 0, 16, 0);
    hgrad.addColorStop(0, 'rgba(0,0,0,0)');
    hgrad.addColorStop(0.5, 'rgba(0,0,0,1)');
    hgrad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hgrad;
    g.fillRect(0, 0, 16, 128);
    beamTex = c;
  }
  return beamTex;
}

const RED: RGB = [255, 59, 92];
const BLUE: RGB = [61, 123, 255];
const TV: RGB = [140, 190, 255];
let redGlow: HTMLCanvasElement | null = null;
let blueGlow: HTMLCanvasElement | null = null;
let amberGlow: HTMLCanvasElement | null = null;
let yellowGlow: HTMLCanvasElement | null = null;
let cyanGlow: HTMLCanvasElement | null = null;
function glows() {
  if (!redGlow) {
    redGlow = glowSprite(RED, 64);
    blueGlow = glowSprite(BLUE, 64);
    amberGlow = glowSprite([255, 150, 40], 64);
    yellowGlow = glowSprite([255, 230, 120], 64);
    cyanGlow = glowSprite([90, 230, 255], 64);
  }
}

/** Cheap deterministic flicker in 0..1 from time. */
function flick(t: number, seed: number): number {
  const a = Math.sin(t * 13.1 + seed * 40) * Math.sin(t * 7.3 + seed * 11) + Math.sin(t * 29.7 + seed * 3) * 0.4;
  return a > 0.25 ? 1 : a > -0.3 ? 0.55 : 0.1;
}

const ECG = [0, 0, 0.08, 0, 0.11, 0.18, 0.14, -0.15, 0.17, 1, 0.2, -0.35, 0.23, 0, 0.32, 0.12, 0.38, 0, 1, 0];

/**
 * Draw a building's live effects. `ox, oy` = world px of the footprint top
 * corner. Leaves globalAlpha = 1 and composite 'source-over'.
 */
export function drawFx(ctx: CanvasRenderingContext2D, list: Fx[], ox: number, oy: number, st: FxState) {
  const t = st.time;
  const n = st.night;
  glows();
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    switch (f.k) {
      case 'blink': {
        if (st.lod && !f.lodOk) break;
        if (!st.lit && !st.offline) break;
        const ph = ((t / f.period + f.ph + st.phase) % 1 + 1) % 1;
        if (ph > 0.16) break;
        const a = 1 - ph / 0.16;
        const x = ox + f.x;
        const y = oy + f.y;
        f.spr ??= glowSprite(f.c, 64);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * (0.35 + 0.65 * n);
        const s = f.size * (0.6 + n * 0.6);
        ctx.drawImage(st.offline ? redGlow! : f.spr, x - s / 2, y - s / 2, s, s);
        ctx.globalAlpha = a;
        ctx.fillStyle = st.offline ? '#ff8aa0' : (f.cs ??= css(mix(f.c, [255, 255, 255], 0.5)));
        ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
        break;
      }
      case 'smoke': {
        if (st.lod || !st.lit) break;
        const K = 5;
        const x = ox + f.x;
        const y = oy + f.y;
        const sp = puff(n > 0.55);
        ctx.globalCompositeOperation = 'source-over';
        for (let p = 0; p < K; p++) {
          const a = (t * 0.16 + f.ph + p / K) % 1;
          const px = x + a * a * 16 + Math.sin(a * 5 + p * 1.7 + f.ph * 9) * 2.2;
          const py = y - a * 38 - 1;
          const s = f.r * (1.1 + a * 3.4);
          ctx.globalAlpha = (1 - a) * Math.min(1, a * 8) * 0.55;
          ctx.drawImage(sp, px - s / 2, py - s / 2, s, s);
        }
        if (n > 0.2) {
          // Furnace glow lighting the plume from below.
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = n * 0.35;
          ctx.drawImage(amberGlow!, x - f.r * 2.5, y - f.r * 3.5, f.r * 5, f.r * 5);
        }
        break;
      }
      case 'board':
        if (st.lod || !st.lit) break;
        drawBoard(ctx, f, ox, oy, t, n, st.phase);
        break;
      case 'ticker': {
        if (st.lod || !st.lit) break;
        const R = hueRamp();
        ctx.save();
        ctx.transform(f.ex, f.ey, 0, -1, ox + f.ox, oy + f.oy);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.6 + 0.4 * n;
        ctx.fillStyle = f.cs ??= css(f.c1);
        // Scrolling dashes = ticker text blocks.
        const off = (t * 0.22 + f.ph) % 1;
        for (let j = 0; j < 9; j++) {
          const a = ((j / 9 + off) % 1) * 1.1 - 0.05;
          const w = 0.03 + ((j * 7) % 5) * 0.012;
          const a0 = Math.max(0, a);
          const a1 = Math.min(1, a + w);
          if (a1 > a0) ctx.fillRect(a0, f.h * 0.2, a1 - a0, f.h * 0.6);
        }
        ctx.fillStyle = R[Math.floor((t * 3 + f.ph * RAMP_N) % RAMP_N)];
        const sx = (t * 0.5 + f.ph) % 1;
        ctx.fillRect(sx, 0, 0.025, f.h);
        ctx.restore();
        break;
      }
      case 'ecg': {
        if (st.lod || !st.lit) break;
        const x0 = ox + f.ox;
        const y0 = oy + f.oy;
        const head = (t * 0.6 + f.ph) % 1;
        ctx.globalCompositeOperation = 'lighter';
        f.cs ??= css(f.c1);
        ctx.strokeStyle = f.cs;
        ctx.lineJoin = 'round';
        // Draw the trace in two passes: faint full trace + bright head segment.
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          let first = true;
          for (let s = 0; s <= 40; s++) {
            const u = s / 40;
            if (pass === 1 && (u > head || u < head - 0.35)) {
              first = true;
              continue;
            }
            // ECG shape repeats twice across the sign.
            const lu = (u * 2) % 1;
            let v = 0;
            for (let e = 0; e < ECG.length - 2; e += 2) {
              if (lu >= ECG[e] && lu <= ECG[e + 2]) {
                const k = (lu - ECG[e]) / (ECG[e + 2] - ECG[e] || 1);
                v = ECG[e + 1] + (ECG[e + 3] - ECG[e + 1]) * k;
                break;
              }
            }
            const px = x0 + f.ex * (0.06 + u * 0.88);
            const py = y0 + f.ey * (0.06 + u * 0.88) - f.h * (0.4 + v * 0.42);
            if (first) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            first = false;
          }
          ctx.globalAlpha = pass === 0 ? 0.25 + 0.2 * n : 0.95;
          ctx.lineWidth = pass === 0 ? 0.6 : 1.1;
          ctx.stroke();
        }
        break;
      }
      case 'strobe': {
        if (st.lod || !st.lit) break;
        const q = Math.floor(t * 7 + f.ph * 4) % 6;
        if (q === 2 || q === 5) break;
        const red = q < 2;
        const x = ox + f.x + (red ? -f.w : f.w);
        const y = oy + f.y;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 + 0.45 * n;
        const s = 16 + 22 * n;
        ctx.drawImage(red ? redGlow! : blueGlow!, x - s / 2, y - s / 2, s, s);
        ctx.globalAlpha = 1;
        ctx.fillStyle = red ? '#ff8aa0' : '#a8c4ff';
        ctx.fillRect(x - 1.4, y - 0.8, 2.8, 1.6);
        break;
      }
      case 'flicker': {
        if (st.lod || !st.lit || n < 0.35) break;
        const k = f.tv ? 0.45 + 0.55 * Math.abs(Math.sin(t * 9 + f.ph * 20) * Math.sin(t * 2.3 + f.ph)) : flick(t, f.ph);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k * n * 0.9;
        ctx.fillStyle = f.cs ??= css(f.tv ? TV : f.c);
        const q = f.q;
        ctx.beginPath();
        ctx.moveTo(ox + q[0], oy + q[1]);
        ctx.lineTo(ox + q[2], oy + q[3]);
        ctx.lineTo(ox + q[4], oy + q[5]);
        ctx.lineTo(ox + q[6], oy + q[7]);
        ctx.fill();
        break;
      }
      case 'beam': {
        if (st.lod || !st.lit) break;
        const x = ox + f.x;
        const y = oy + f.y;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25 + 0.5 * n;
        ctx.drawImage(beamSprite(), x - 3, y - f.h, 6, f.h);
        ctx.fillStyle = '#d8fbff';
        for (let p = 0; p < 3; p++) {
          const a = (t * 0.55 + f.ph + p / 3) % 1;
          const py = y - a * f.h;
          ctx.globalAlpha = (1 - a) * (0.5 + 0.5 * n);
          ctx.fillRect(x - 0.8, py - 5, 1.6, 5);
          ctx.drawImage(cyanGlow!, x - 6, py - 8, 12, 12);
        }
        break;
      }
      case 'pulse': {
        if (st.lod || !st.lit) break;
        const k = 0.55 + 0.45 * Math.sin((t / f.period + f.ph) * Math.PI * 2);
        f.spr ??= glowSprite(f.c, 64);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.35 + 0.65 * n) * k;
        const s = f.size * (0.85 + 0.15 * k);
        ctx.drawImage(f.spr, ox + f.x - s / 2, oy + f.y - s / 2, s, s);
        break;
      }
      case 'holo':
        if (st.lod || !st.lit) break;
        drawHolo(ctx, f, ox, oy, t, n);
        break;
      case 'ring': {
        if (st.lod || !st.lit) break;
        const x = ox + f.x;
        const y = oy + f.y;
        const a = (t * 1.4 + f.ph * 6) % (Math.PI * 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = f.cs ??= css(f.c);
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.25 + 0.35 * n;
        ctx.beginPath();
        ctx.ellipse(x, y, f.rx, f.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.7 + 0.3 * n;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(x, y, f.rx, f.ry, 0, a, a + 1.1);
        ctx.stroke();
        break;
      }
      case 'rails': {
        if (st.lod || !st.lit) break;
        ctx.globalCompositeOperation = 'lighter';
        f.spr ??= glowSprite(f.c, 64);
        for (let p = 0; p < 3; p++) {
          const a = (t * 0.7 + f.ph + p / 3) % 1;
          const x = f.x0 + (f.x1 - f.x0) * a;
          const y = f.y0 + (f.y1 - f.y0) * a;
          ctx.globalAlpha = 0.5 + 0.5 * n;
          ctx.drawImage(f.spr, ox + x - 7, oy + y - 4, 14, 8);
        }
        break;
      }
      case 'flame': {
        if (st.lod || !st.lit) break;
        const x = ox + f.x;
        const y = oy + f.y;
        ctx.globalCompositeOperation = 'lighter';
        for (let p = 0; p < 3; p++) {
          const j = Math.sin(t * (11 + p * 3) + f.ph * 17 + p) * 1.2;
          const s = 7 + p * 3 + Math.sin(t * 17 + p) * 1.5;
          ctx.globalAlpha = 0.5 + 0.3 * n;
          ctx.drawImage(p === 0 ? yellowGlow! : amberGlow!, x + j - s / 2, y - 3 - p * 2.5 - s / 2, s, s * 1.3);
        }
        break;
      }
      case 'drone': {
        if (st.lod || !st.lit) break;
        const a = t * 0.9 + f.ph * 6;
        const x = ox + f.x + Math.cos(a) * f.r;
        const y = oy + f.y + Math.sin(a) * f.r * 0.5 - Math.sin(t * 2.1) * 1.5;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#20202c';
        ctx.fillRect(x - 2.2, y - 0.8, 4.4, 1.6);
        ctx.fillRect(x - 0.6, y - 1.6, 1.2, 1.2);
        ctx.globalCompositeOperation = 'lighter';
        const on = Math.floor(t * 4 + f.ph * 4) % 2 === 0;
        ctx.globalAlpha = 0.6 + 0.4 * n;
        ctx.drawImage(on ? blueGlow! : redGlow!, x - 5, y - 5, 10, 10);
        break;
      }
      case 'warn': {
        if (!st.offline) break;
        const on = (t * 1.4 + f.ph) % 1 < 0.45;
        if (!on) break;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.7;
        ctx.drawImage(redGlow!, ox + f.x - 9, oy + f.y - 9, 18, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff6a80';
        ctx.fillRect(ox + f.x - 1, oy + f.y - 1, 2, 2);
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Animated holographic billboard content. Board space: t 0..1 across, z 0..h up. */
function drawBoard(ctx: CanvasRenderingContext2D, f: Extract<Fx, { k: 'board' }>, ox: number, oy: number, t: number, n: number, phase: number) {
  const R = hueRamp();
  const h = f.h;
  const cyc = t * 0.07 + f.ph + phase;
  const hi = Math.floor(((cyc % 1) + 1) * RAMP_N) % RAMP_N;
  ctx.save();
  ctx.transform(f.ex, f.ey, 0, -1, ox + f.ox, oy + f.oy);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.72 + 0.28 * n;
  const slot = Math.floor(t / 4 + f.ph * 7 + phase * 3);
  switch ((f.style + slot) % 4) {
    case 0: {
      // Colour-cycling field with invented lettering.
      ctx.fillStyle = R[hi];
      ctx.fillRect(0, 0, 1, h);
      ctx.fillStyle = '#0a0716';
      const ew = Math.hypot(f.ex, f.ey);
      const cell = Math.min(h / 14, ew / 14);
      const ct = cell / ew;
      const seed = slot * 7 + Math.floor(f.ph * 50);
      for (let gch = 0; gch < 3; gch++) {
        const gm = GLYPHS[(seed + gch * 5) % GLYPHS.length];
        const t0 = 0.5 - ct * 6 + gch * ct * 4;
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 3; c++) if (gm & (1 << (r * 3 + c))) ctx.fillRect(t0 + c * ct, h * 0.62 - (r + 1) * cell, ct * 0.9, cell * 0.9);
      }
      ctx.fillRect(0.12, h * 0.18, 0.76, cell * 0.8);
      break;
    }
    case 1: {
      // Scrolling diagonal-ish stripes in two colours.
      ctx.fillStyle = '#07060f';
      ctx.fillRect(0, 0, 1, h);
      const off = (t * 0.35 + f.ph) % 0.25;
      ctx.fillStyle = f.cs ??= css(f.c1);
      for (let s = -0.25; s < 1; s += 0.25) {
        const a = Math.max(0, s + off);
        const b = Math.min(1, s + off + 0.12);
        if (b > a) ctx.fillRect(a, 0, b - a, h);
      }
      ctx.fillStyle = R[(hi + 18) % RAMP_N];
      const sweep = (t * 0.8 + f.ph) % 1;
      ctx.fillRect(0, h * sweep, 1, h * 0.06);
      break;
    }
    case 2: {
      // Vertical glyph column scrolling upward.
      ctx.fillStyle = css(f.c2, 1);
      ctx.globalAlpha *= 0.35;
      ctx.fillRect(0, 0, 1, h);
      ctx.globalAlpha = 0.85 + 0.15 * n;
      ctx.fillStyle = R[hi];
      const cell = Math.min(h / 18, 2.2);
      const ct = cell / Math.hypot(f.ex, f.ey);
      const rowsH = cell * 5;
      const scroll = (t * 9) % rowsH;
      const count = Math.ceil(h / rowsH) + 1;
      for (let gi = 0; gi < count; gi++) {
        const base = gi * rowsH - scroll;
        if (base < 0 || base + cell * 4 > h) continue;
        const gm = GLYPHS[(gi + Math.floor(t * 9 / rowsH) + Math.floor(f.ph * 16)) % GLYPHS.length];
        const t0 = 0.5 - ct * 1.5;
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 3; c++) if (gm & (1 << (r * 3 + c))) ctx.fillRect(t0 + c * ct, base + (3 - r) * cell, ct * 0.9, cell * 0.9);
      }
      break;
    }
    default: {
      // Pulsing emblem on a two-tone ground (an invented logo).
      ctx.fillStyle = '#0b0818';
      ctx.fillRect(0, 0, 1, h);
      ctx.fillStyle = R[(hi + 6) % RAMP_N];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, 0, 1, h * 0.35);
      ctx.globalAlpha = 0.9;
      const k = 0.75 + 0.25 * Math.sin(t * 3 + f.ph * 6);
      ctx.fillStyle = R[hi];
      const cz = h * 0.6;
      const ew = Math.hypot(f.ex, f.ey);
      const r = Math.min(h * 0.22, ew * 0.4) * k;
      const rt = r / ew;
      ctx.beginPath();
      ctx.moveTo(0.5, cz + r);
      ctx.lineTo(0.5 + rt, cz);
      ctx.lineTo(0.5, cz - r);
      ctx.lineTo(0.5 - rt, cz);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0b0818';
      ctx.fillRect(0.5 - rt * 0.3, cz - r * 0.3, rt * 0.6, r * 0.6);
      break;
    }
  }
  // Display texture: a few dark scan bands + lit top / bottom edges.
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#05030c';
  const bands = Math.min(12, Math.max(3, Math.floor(h / 4)));
  const off = (t * 6) % (h / bands);
  for (let i = 0; i < bands; i++) ctx.fillRect(0, i * (h / bands) + off, 1, h / bands / 3);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#f4f0ff';
  ctx.fillRect(0, h - 0.6, 1, 0.6);
  ctx.fillRect(0, 0, 1, 0.5);
  ctx.restore();
  // Light spill around the panel at night.
  if (n > 0.1) {
    const cx = ox + f.ox + f.ex * 0.5;
    const cy = oy + f.oy + f.ey * 0.5 - h * 0.5;
    const s = Math.max(h, Math.hypot(f.ex, f.ey)) * 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = n * 0.22;
    ctx.drawImage(hueGlow(hi), cx - s / 2, cy - s / 2, s, s);
  }
}

/** Holographic light-tree for plazas: stacked rotating rings + orbiting motes. */
function drawHolo(ctx: CanvasRenderingContext2D, f: Extract<Fx, { k: 'holo' }>, ox: number, oy: number, t: number, n: number) {
  const R = hueRamp();
  const x = ox + f.x;
  const y = oy + f.y;
  const h = f.h;
  ctx.globalCompositeOperation = 'lighter';
  const base = Math.floor((t * 0.1 + f.ph) * RAMP_N);
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 6; i++) {
    const a = i / 6;
    const r = (1 - a) * 11 + 2;
    const yy = y - 6 - a * (h - 10);
    ctx.strokeStyle = R[(base + i * 4) % RAMP_N];
    ctx.globalAlpha = (0.35 + 0.4 * n) * (0.75 + 0.25 * Math.sin(t * 3 + i));
    ctx.beginPath();
    ctx.ellipse(x, yy, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.45 + 0.35 * n;
  ctx.fillStyle = R[(base + 12) % RAMP_N];
  ctx.fillRect(x - 0.5, y - h + 2, 1, h - 6);
  for (let m = 0; m < 8; m++) {
    const a = t * (0.8 + (m % 3) * 0.3) + m * 0.8;
    const lvl = (m / 8 + t * 0.05) % 1;
    const r = (1 - lvl) * 10 + 2;
    const px = x + Math.cos(a) * r;
    const py = y - 6 - lvl * (h - 10) + Math.sin(a) * r * 0.5;
    ctx.fillStyle = R[(base + m * 5) % RAMP_N];
    ctx.fillRect(px - 0.7, py - 0.7, 1.4, 1.4);
  }
  ctx.globalAlpha = 0.3 * (0.4 + n);
  ctx.drawImage(hueGlow(base % RAMP_N), x - h * 0.6, y - h * 0.9, h * 1.2, h * 1.1);
}

/** A single erratic squatter's light in an abandoned building (uses its first flicker anchor). */
export function drawAbandonedLight(ctx: CanvasRenderingContext2D, list: Fx[], ox: number, oy: number, t: number, n: number, seed: number) {
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.k !== 'flicker') continue;
    const k = flick(t * 0.7, seed + 0.37);
    if (k < 0.2) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k * n * 0.75;
    ctx.fillStyle = '#ffb060';
    const q = f.q;
    ctx.beginPath();
    ctx.moveTo(ox + q[0], oy + q[1]);
    ctx.lineTo(ox + q[2], oy + q[3]);
    ctx.lineTo(ox + q[4], oy + q[5]);
    ctx.lineTo(ox + q[6], oy + q[7]);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
}
