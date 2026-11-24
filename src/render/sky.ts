// ─────────────────────────────────────────────────────────────────────────────
// Backdrop: everything behind and below the map so it reads as one floating
// district of a bigger city rather than a board in a void.
//
//  * Screen space: sky gradient that follows daylight, two parallax skyline
//    silhouette bands (far haze + near towers with lit windows and neon), a
//    faint sprawl of lights far below, and horizon haze.
//  * World space: a soft city-glow haze under the map, and the map "slab"
//    (front faces with substructure lights and a neon rim).
//
// Skyline strips are cached per night bucket and re-baked only when the
// bucket or the viewport changes.
// ─────────────────────────────────────────────────────────────────────────────

import { Rng, hash2 } from '../game/rng';
import { HALF_H, HALF_W } from './camera';
import { MATERIAL, NEON, css, glowSprite, lit, mix, shade, type RGB } from './palette';

const STRIP_W = 960; // CSS px, tiles horizontally
const FAR_H = 130;
const NEAR_H = 190;
const DEEP_H = 220;
const SKY_STEPS = 16;
const SLAB = 64; // map slab depth, world px

interface Tower {
  x: number;
  w: number;
  h: number;
  /** 0 flat, 1 stepped, 2 spire, 3 antenna */
  roof: number;
  seed: number;
}

function makeTowers(seed: number, count: number, minH: number, maxH: number, minW: number, maxW: number): Tower[] {
  const rng = new Rng(seed);
  const out: Tower[] = [];
  let x = -10;
  while (x < STRIP_W && out.length < count) {
    const w = rng.int(minW, maxW);
    const tall = rng.next();
    const h = Math.round(minH + (maxH - minH) * Math.pow(tall, 1.8));
    out.push({ x, w, h, roof: rng.int(0, 3), seed: rng.int(1, 1 << 30) });
    x += Math.round(w * (0.55 + rng.next() * 0.6));
  }
  return out;
}

export class Backdrop {
  private far: HTMLCanvasElement | null = null;
  private near: HTMLCanvasElement | null = null;
  private deep: HTMLCanvasElement | null = null;
  private key = '';
  private farTowers: Tower[];
  private nearTowers: Tower[];
  private beacons: { x: number; y: number; ph: number }[] = [];

  constructor(seed = 7) {
    this.farTowers = makeTowers(seed * 3 + 1, 120, 24, FAR_H - 10, 10, 34);
    this.nearTowers = makeTowers(seed * 5 + 2, 90, 30, NEAR_H - 8, 16, 46);
    for (const t of this.nearTowers) {
      if (t.roof >= 2 && t.h > NEAR_H * 0.55) this.beacons.push({ x: t.x + t.w / 2, y: NEAR_H - t.h - (t.roof === 2 ? 18 : 14), ph: (t.seed % 100) / 16 });
    }
  }

  // ── Screen space ──────────────────────────────────────────────────────────

  /**
   * Fill the whole canvas with the sky + skyline. Context transform must be
   * identity (device px); `w`/`h` are CSS px.
   */
  drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, camX: number, camY: number, zoom: number, night: number, time: number) {
    const n = night;
    const top = mix(lit(MATERIAL.skyTop, n), [70, 98, 108], 0.35 * (1 - n));
    const horizon = lit(MATERIAL.skyHorizon, n);
    const haze = mix([214, 168, 118], [86, 18, 96], n);
    const abyss = mix([104, 92, 86], [10, 5, 20], n);

    // Horizon sits behind the map's back corner, with parallax.
    const hy = h / 2 + (110 - camY) * zoom * 0.8;
    const H = h * dpr;
    const W = w * dpr;
    const hyD = hy * dpr;
    const g = ctx.createLinearGradient(0, Math.min(0, hyD - H), 0, Math.max(H, hyD + H * 0.6));
    const span = Math.max(H, hyD + H * 0.6) - Math.min(0, hyD - H);
    const at = (y: number) => Math.max(0, Math.min(1, (y - Math.min(0, hyD - H)) / span));
    g.addColorStop(0, css(top));
    g.addColorStop(at(hyD - 220 * dpr), css(mix(top, horizon, 0.45)));
    g.addColorStop(at(hyD - 10 * dpr), css(horizon));
    g.addColorStop(at(hyD + 30 * dpr), css(mix(horizon, haze, 0.5)));
    g.addColorStop(at(hyD + 260 * dpr), css(mix(haze, abyss, 0.65)));
    g.addColorStop(1, css(abyss));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    this.bake(dpr, night);
    const scrollFar = (((-camX * zoom * 0.25) % STRIP_W) + STRIP_W) % STRIP_W;
    const scrollNear = (((-camX * zoom * 0.45) % STRIP_W) + STRIP_W) % STRIP_W;
    const scrollDeep = (((-camX * zoom * 0.6) % STRIP_W) + STRIP_W) % STRIP_W;

    // Distant sprawl lights far below the horizon (night only).
    if (this.deep && n > 0.05) {
      // Repeated downwards (offset each band) so the sprawl reaches the screen bottom.
      let band = 0;
      for (let y = hy + 20; y < h && band < 6; y += DEEP_H * 0.9, band++) {
        ctx.globalAlpha = Math.min(1, n * 1.1) * Math.max(0.35, 1 - band * 0.18);
        this.tile(ctx, this.deep, (scrollDeep + band * 317) % STRIP_W, y, w, dpr);
      }
      ctx.globalAlpha = 1;
    }
    if (this.far) this.tile(ctx, this.far, scrollFar, hy - FAR_H + 6, w, dpr);
    // Haze between layers.
    const hz = ctx.createLinearGradient(0, (hy - 90) * dpr, 0, (hy + 40) * dpr);
    hz.addColorStop(0, css(haze, 0));
    hz.addColorStop(0.7, css(mix(horizon, haze, 0.5), 0.55));
    hz.addColorStop(1, css(haze, 0));
    ctx.fillStyle = hz;
    ctx.fillRect(0, (hy - 90) * dpr, W, 130 * dpr);
    if (this.near) this.tile(ctx, this.near, scrollNear, hy - NEAR_H + 26, w, dpr);
    // Ground haze swallowing the base of the near towers.
    const hz2 = ctx.createLinearGradient(0, (hy - 30) * dpr, 0, (hy + 70) * dpr);
    hz2.addColorStop(0, css(haze, 0));
    hz2.addColorStop(0.55, css(mix(horizon, haze, 0.6), 0.85));
    hz2.addColorStop(1, css(mix(haze, abyss, 0.5), 0));
    ctx.fillStyle = hz2;
    ctx.fillRect(0, (hy - 30) * dpr, W, 100 * dpr);

    // Aircraft-warning beacons on the near spires.
    if (n > 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      const spr = glowSprite(NEON.red, 32);
      for (const b of this.beacons) {
        const on = Math.sin(time * 2.2 + b.ph * 6) > 0.4;
        if (!on) continue;
        const by = hy - NEAR_H + 26 + b.y;
        for (let x = b.x - scrollNear - STRIP_W; x < w + 20; x += STRIP_W) {
          if (x < -20) continue;
          ctx.globalAlpha = n * 0.9;
          ctx.drawImage(spr, (x - 5) * dpr, (by - 5) * dpr, 10 * dpr, 10 * dpr);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Draw a horizontally tiling strip so it covers the viewport. */
  private tile(ctx: CanvasRenderingContext2D, strip: HTMLCanvasElement, scroll: number, y: number, w: number, dpr: number) {
    const sw = strip.width;
    const sh = strip.height;
    if (y * dpr > ctx.canvas.height || y * dpr + sh < 0) return;
    for (let x = -scroll * dpr; x < w * dpr; x += sw) {
      if (x + sw < 0) continue;
      ctx.drawImage(strip, Math.round(x), Math.round(y * dpr));
    }
  }

  /** (Re)bake skyline strips when the night bucket or DPR changes. */
  private bake(dpr: number, night: number) {
    const nb = Math.round(night * SKY_STEPS);
    const key = `${nb}|${dpr}`;
    if (key === this.key) return;
    this.key = key;
    const n = nb / SKY_STEPS;
    this.far = this.bakeLayer(this.far, this.farTowers, FAR_H, dpr, n, false);
    this.near = this.bakeLayer(this.near, this.nearTowers, NEAR_H, dpr, n, true);
    this.deep = this.bakeDeep(this.deep, dpr);
  }

  private bakeLayer(cv: HTMLCanvasElement | null, towers: Tower[], H: number, dpr: number, n: number, near: boolean): HTMLCanvasElement {
    const c = cv ?? document.createElement('canvas');
    c.width = Math.round(STRIP_W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, STRIP_W, H);
    const horizon = lit(MATERIAL.skyHorizon, n);
    const top = lit(MATERIAL.skyTop, n);
    const body: RGB = near ? mix(mix([92, 92, 100], [11, 8, 22], n), top, 0.15) : mix(mix(horizon, top, 0.42), [130, 118, 112], 0.3 * (1 - n));
    const edge: RGB = near ? mix(body, horizon, 0.35) : mix(body, horizon, 0.3);
    const winColors: RGB[] = [[255, 200, 140], NEON.cyan, NEON.magenta, [255, 236, 200], NEON.violet];
    // Draw twice so towers crossing the right edge wrap seamlessly.
    for (const off of [0, -STRIP_W]) {
      for (const t of towers) {
        const x = t.x + off;
        if (x + t.w < 0 || x > STRIP_W) continue;
        const y = H - t.h;
        g.fillStyle = css(body);
        g.fillRect(x, y, t.w, t.h);
        // Roof shapes.
        if (t.roof === 1) g.fillRect(x + t.w * 0.2, y - t.h * 0.08, t.w * 0.6, t.h * 0.08 + 1);
        else if (t.roof === 2) {
          g.beginPath();
          g.moveTo(x + t.w * 0.25, y);
          g.lineTo(x + t.w * 0.5, y - 18);
          g.lineTo(x + t.w * 0.75, y);
          g.fill();
        } else if (t.roof === 3) g.fillRect(x + t.w * 0.5 - 0.75, y - 14, 1.5, 14);
        // Rim light on the left edge from the haze.
        g.fillStyle = css(edge, 0.7);
        g.fillRect(x, y, 1, t.h);
        if (n < 0.08) continue;
        // Windows.
        const rng = new Rng(t.seed);
        const cols = Math.max(1, Math.floor((t.w - 4) / (near ? 4 : 3)));
        const rows = Math.floor((t.h - 6) / (near ? 5 : 4));
        const density = near ? 0.28 : 0.2;
        for (let r = 0; r < rows; r++) {
          for (let q = 0; q < cols; q++) {
            if (rng.next() > density) continue;
            const wc = winColors[rng.next() < 0.7 ? 0 : rng.int(1, 4)];
            g.fillStyle = css(wc, (near ? 0.75 : 0.45) * n * (0.5 + rng.next() * 0.5));
            g.fillRect(x + 2 + q * (near ? 4 : 3), y + 4 + r * (near ? 5 : 4), near ? 2 : 1.4, near ? 1.6 : 1.2);
          }
        }
        // Neon signage on some near towers.
        if (near && rng.next() < 0.3 && t.h > 50) {
          const nc = [NEON.magenta, NEON.cyan, NEON.amber, NEON.violet][rng.int(0, 3)];
          const sx = x + (rng.next() < 0.5 ? 1 : t.w - 4);
          const sy = y + 8 + rng.next() * (t.h * 0.3);
          const sh = 14 + rng.next() * 22;
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = css(nc, 0.25 * n);
          g.fillRect(sx - 2, sy - 2, 7, sh + 4);
          g.fillStyle = css(nc, 0.9 * n);
          g.fillRect(sx, sy, 3, sh);
          g.globalCompositeOperation = 'source-over';
        }
      }
    }
    return c;
  }

  /** Scattered lights of the sprawl far below the floating district. */
  private bakeDeep(cv: HTMLCanvasElement | null, dpr: number): HTMLCanvasElement {
    const c = cv ?? document.createElement('canvas');
    const W = Math.round(STRIP_W * dpr);
    const H = Math.round(DEEP_H * dpr);
    if (c.width === W && c.height === H && cv) return c;
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, STRIP_W, DEEP_H);
    const rng = new Rng(991);
    const cols: RGB[] = [[255, 190, 120], [255, 160, 90], NEON.cyan, NEON.magenta, [255, 230, 190]];
    // Light "highways": short faint dashed streaks.
    for (let k = 0; k < 10; k++) {
      const y = 20 + rng.next() * (DEEP_H - 40);
      const x0 = rng.next() * STRIP_W;
      const len = 60 + rng.next() * 180;
      g.fillStyle = css(cols[rng.int(0, 1)], 0.08 + rng.next() * 0.1);
      for (let x = x0; x < x0 + len; x += 5) g.fillRect(x % STRIP_W, y, 3, 1);
    }
    for (let k = 0; k < 700; k++) {
      const y = Math.pow(rng.next(), 0.8) * DEEP_H;
      const x = rng.next() * STRIP_W;
      const fade = 1 - y / DEEP_H;
      const col = cols[rng.next() < 0.65 ? rng.int(0, 1) : rng.int(2, 4)];
      g.fillStyle = css(col, (0.25 + rng.next() * 0.55) * (0.35 + fade * 0.65));
      const s = rng.next() < 0.1 ? 1.6 : 1;
      g.fillRect(x, y, s, s);
    }
    return c;
  }

  // ── World space ───────────────────────────────────────────────────────────

  /** City glow under the map and the map slab, for a map `mapSize` tiles a side (the world's N). World transform expected. */
  drawUnderMap(
    ctx: CanvasRenderingContext2D,
    night: number,
    time: number,
    zoom: number,
    view: { x0: number; y0: number; x1: number; y1: number },
    mapSize: number,
  ) {
    const n = night;
    const S = mapSize;
    const L = { x: -S * HALF_W, y: S * HALF_H };
    const B = { x: 0, y: S * 2 * HALF_H };
    const R = { x: S * HALF_W, y: S * HALF_H };
    const T = { x: 0, y: 0 };
    // Nothing of the slab/haze is visible if the view is well inside the map.
    const below = view.y1 > L.y - 40;
    if (!below && view.y0 > T.y + 200) return;

    // Under-glow: the city lights bouncing off smog beneath the district.
    ctx.globalCompositeOperation = 'lighter';
    // The hue steps in 1/32 of the night value (a bounded set of cached glow sprites); the
    // alpha below keeps the smooth value.
    const nq = Math.round(n * 32) / 32;
    const glowA: RGB = mix([230, 160, 96], [200, 40, 190], nq);
    const glowB: RGB = mix([200, 170, 120], [90, 60, 255], nq);
    const a = 0.22 + 0.25 * n;
    const pulse = 1 + Math.sin(time * 0.35) * 0.06;
    ctx.globalAlpha = a;
    ctx.drawImage(glowSprite(glowA, 128), B.x - 1900 * pulse, B.y - 380, 3800 * pulse, 1100);
    ctx.globalAlpha = a * 0.8;
    ctx.drawImage(glowSprite(glowB, 128), L.x - 900, L.y - 300, 1800, 900);
    ctx.drawImage(glowSprite(glowB, 128), R.x - 900, R.y - 300, 1800, 900);
    ctx.globalAlpha = a * 0.5;
    ctx.drawImage(glowSprite(glowA, 128), T.x - 1600, T.y - 500, 3200, 900);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Slab faces (left = shaded, right = lit).
    const wall = lit(MATERIAL.wall, n);
    const faceL = shade(wall, 0.62);
    const faceR = shade(wall, 0.85);
    const face = (p: { x: number; y: number }, q: { x: number; y: number }, c: RGB) => {
      const g = ctx.createLinearGradient(0, Math.min(p.y, q.y), 0, Math.max(p.y, q.y) + SLAB);
      g.addColorStop(0, css(c));
      g.addColorStop(1, css(shade(c, 0.55)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(q.x, q.y + SLAB);
      ctx.lineTo(p.x, p.y + SLAB);
      ctx.closePath();
      ctx.fill();
    };
    if (below) {
      face(L, B, faceL);
      face(B, R, faceR);
      // Substructure: service-deck stripes and lit portholes.
      const lw = Math.max(1, 1.2 / zoom);
      ctx.lineWidth = lw;
      for (const [depth, col, al] of [
        [14, NEON.cyan, 0.5],
        [36, NEON.magenta, 0.35],
      ] as [number, RGB, number][]) {
        ctx.strokeStyle = css(mix(shade(wall, 1.2), col, n), 0.25 + al * n);
        ctx.beginPath();
        ctx.moveTo(L.x, L.y + depth);
        ctx.lineTo(B.x, B.y + depth);
        ctx.lineTo(R.x, R.y + depth);
        ctx.stroke();
      }
      if (n > 0.05 && zoom > 0.2) {
        const lights: RGB[] = [[255, 196, 128], NEON.cyan, [255, 230, 200]];
        for (let side = 0; side < 2; side++) {
          const p = side === 0 ? L : B;
          const q = side === 0 ? B : R;
          for (let k = 0; k < 90; k++) {
            const h = hash2(k, side, 77);
            if (h > 0.55) continue;
            const t = (k + 0.5) / 90;
            const x = p.x + (q.x - p.x) * t;
            const y = p.y + (q.y - p.y) * t + 22 + (h < 0.25 ? 0 : 20);
            const on = Math.sin(time * 0.7 + k * 1.7) > -0.7;
            if (!on) continue;
            ctx.fillStyle = css(lights[k % 3], 0.75 * n);
            ctx.fillRect(x - 3, y, 6, 2.5);
          }
        }
      }
      // Fade the slab bottom into the haze.
      const fog = mix([170, 140, 120], [40, 10, 60], n);
      ctx.fillStyle = css(fog, 0.35);
      ctx.beginPath();
      ctx.moveTo(L.x, L.y + SLAB * 0.7);
      ctx.lineTo(B.x, B.y + SLAB * 0.7);
      ctx.lineTo(R.x, R.y + SLAB * 0.7);
      ctx.lineTo(R.x, R.y + SLAB);
      ctx.lineTo(B.x, B.y + SLAB);
      ctx.lineTo(L.x, L.y + SLAB);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Neon rim along the edge of a map `mapSize` tiles a side (drawn over the ground). World transform expected. */
  drawRim(ctx: CanvasRenderingContext2D, night: number, zoom: number, mapSize: number) {
    const S = mapSize;
    const L = { x: -S * HALF_W, y: S * HALF_H };
    const B = { x: 0, y: S * 2 * HALF_H };
    const R = { x: S * HALF_W, y: S * HALF_H };
    const T = { x: 0, y: 0 };
    const n = night;
    ctx.globalCompositeOperation = 'lighter';
    const front: RGB = mix([200, 220, 230], NEON.cyan, n);
    for (const [w, al] of [
      [6, 0.08],
      [2.5, 0.25],
      [1, 0.8],
    ] as [number, number][]) {
      ctx.lineWidth = w / zoom;
      ctx.strokeStyle = css(front, al * (0.35 + 0.65 * n));
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.lineTo(B.x, B.y);
      ctx.lineTo(R.x, R.y);
      ctx.stroke();
      ctx.strokeStyle = css(NEON.violet, al * 0.55 * (0.3 + 0.7 * n));
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.lineTo(T.x, T.y);
      ctx.lineTo(R.x, R.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
