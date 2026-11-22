// ─────────────────────────────────────────────────────────────────────────────
// Sky layer: flying cars on a few altitude lanes, searchlight beams sweeping
// from the tallest towers at night, and the occasional advertising blimp or
// drone carrying an animated holo panel. Everything scales with population:
// an empty city has an empty sky.
// ─────────────────────────────────────────────────────────────────────────────

import { hash2 } from '../../game/rng';
import { MAP_SIZE, ZoneType } from '../../game/types';
import type { World } from '../../game/world';
import { serviceBuildingHeight, zoneBuildingHeight } from '../buildings';
import { HALF_H, HALF_W } from '../camera';
import { css, glowSprite, mix, type RGB } from '../palette';
import { GLYPHS } from './painter';
import type { Bounds } from './traffic';

const N = MAP_SIZE;

interface Lane {
  /** 0: runs along u at v = c; 1: runs along v at u = c. */
  axis: number;
  c: number;
  z: number;
}

interface Flyer {
  lane: number;
  s: number;
  speed: number;
  col: number;
  ph: number;
  dying: number;
  age: number;
}

interface Light {
  x: number;
  y: number;
  ph: number;
  col: number;
  twin: boolean;
}

interface Blimp {
  axis: number;
  c: number;
  z: number;
  s: number;
  speed: number;
  drone: boolean;
  ph: number;
}

const FLYER_COLS: RGB[] = [
  [90, 230, 255],
  [255, 70, 200],
  [255, 190, 80],
  [235, 240, 255],
];
const BEAM_COLS: RGB[] = [
  [200, 220, 255],
  [120, 230, 255],
  [255, 120, 220],
];

function makeBeam(c: RGB): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 48;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, css(c, 0.55));
  grad.addColorStop(0.35, css(c, 0.22));
  grad.addColorStop(1, css(c, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(22, 256);
  g.lineTo(26, 256);
  g.lineTo(48, 0);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();
  // Brighter core.
  const core = g.createLinearGradient(0, 256, 0, 0);
  core.addColorStop(0, css(c, 0.5));
  core.addColorStop(0.5, css(c, 0.08));
  core.addColorStop(1, css(c, 0));
  g.fillStyle = core;
  g.beginPath();
  g.moveTo(23, 256);
  g.lineTo(25, 256);
  g.lineTo(30, 0);
  g.lineTo(18, 0);
  g.closePath();
  g.fill();
  return cv;
}

function makeBlimpBody(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 32;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 2, 0, 30);
  grad.addColorStop(0, '#8a8ea4');
  grad.addColorStop(0.45, '#4a4c60');
  grad.addColorStop(1, '#1c1c28');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(48, 16, 46, 13, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#26262f';
  g.fillRect(40, 27, 16, 4);
  // Fins.
  g.fillStyle = '#3a3a4c';
  g.beginPath();
  g.moveTo(4, 16);
  g.lineTo(-2, 6);
  g.lineTo(12, 12);
  g.closePath();
  g.fill();
  return cv;
}

export class SkyTraffic {
  private lanes: Lane[] = [];
  private flyers: Flyer[] = [];
  private lights: Light[] = [];
  private scan = 0;
  private blimp: Blimp | null = null;
  private blimpTimer = 20;
  private worldRef: World | null = null;
  private target = 0;
  private flyerCss: string[] = FLYER_COLS.map((c) => css(c));
  private flyerGlow: HTMLCanvasElement[] | null = null;
  private beams: HTMLCanvasElement[] | null = null;
  private blimpBody: HTMLCanvasElement | null = null;
  private ramp: string[] = [];
  private redGlow: HTMLCanvasElement | null = null;
  private greenGlow: HTMLCanvasElement | null = null;

  constructor() {
    for (let i = 0; i < 24; i++) {
      const h = (i / 24) * 6;
      const f = (n: number) => {
        const k = (n + h) % 6;
        return 255 * (1 - Math.max(0, Math.min(1, Math.min(k, 4 - k))));
      };
      this.ramp.push(css(mix([f(5), f(3), f(1)], [255, 255, 255], 0.1)));
    }
  }

  reset() {
    this.flyers.length = 0;
    this.lights.length = 0;
    this.blimp = null;
    this.blimpTimer = 20;
    this.worldRef = null;
  }

  private setup(world: World) {
    this.worldRef = world;
    this.lanes = [];
    const seed = world.seed;
    const count = 6;
    for (let i = 0; i < count; i++) {
      this.lanes.push({
        axis: i % 2,
        c: 8 + Math.floor(hash2(i, 1, seed) * 48),
        z: 110 + Math.floor(hash2(i, 2, seed) * 140) + (i % 3) * 20,
      });
    }
  }

  update(dt: number, world: World, quality: 'low' | 'high', b: Bounds | null, night: number) {
    if (world !== this.worldRef) this.setup(world);
    const pop = world.stats.population;
    const popK = Math.pow(Math.min(1, pop / 3000), 0.8);
    this.target = Math.round(popK * (quality === 'low' ? 14 : 40));
    // Advance flyers.
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.s += f.speed * dt;
      f.age += dt;
      if (f.dying > 0) f.dying -= dt;
      if (f.s < -8 || f.s > N + 8 || (f.dying > 0 && f.dying <= dt)) {
        this.flyers[i] = this.flyers[this.flyers.length - 1];
        this.flyers.pop();
      }
    }
    let spawn = Math.min(2, this.target - this.flyers.length);
    while (spawn-- > 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const fresh = this.flyers.length < this.target * 0.5;
      this.flyers.push({
        lane: (Math.random() * this.lanes.length) | 0,
        // Fill the sky immediately at first, then enter from the edges.
        s: fresh ? Math.random() * N : dir > 0 ? -6 : N + 6,
        speed: dir * (2.4 + Math.random() * 2.2),
        col: (Math.random() * FLYER_COLS.length) | 0,
        ph: Math.random(),
        dying: 0,
        age: fresh ? 0 : 1,
      });
    }
    if (this.flyers.length > this.target + 2) {
      const f = this.flyers.find((x) => x.dying <= 0);
      if (f) f.dying = 0.8;
    }
    // Blimp / ad drone.
    if (this.blimp) {
      this.blimp.s += this.blimp.speed * dt;
      if (this.blimp.s < -12 || this.blimp.s > N + 12) this.blimp = null;
    } else if (pop > 600) {
      this.blimpTimer -= dt;
      if (this.blimpTimer <= 0) {
        this.blimpTimer = 35 + Math.random() * 40;
        const dir = Math.random() < 0.5 ? 1 : -1;
        const drone = Math.random() < 0.4;
        this.blimp = {
          axis: Math.random() < 0.5 ? 0 : 1,
          c: 14 + Math.random() * 36,
          z: drone ? 150 : 250,
          s: dir > 0 ? -10 : N + 10,
          speed: dir * (drone ? 1.6 : 0.7),
          drone,
          ph: Math.random(),
        };
      }
    }
    // Rescan searchlight sources now and then.
    this.scan -= dt;
    if (this.scan <= 0 && b) {
      this.scan = 1.5;
      this.findLights(world, b, quality, night);
    }
  }

  private findLights(world: World, b: Bounds, quality: 'low' | 'high', night: number) {
    this.lights.length = 0;
    if (quality === 'low' || night < 0.3) return;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const cand: { d: number; l: Light }[] = [];
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const t = world.tiles[y * N + x];
        if (t.buildingId >= 0) {
          const bd = world.buildings.get(t.buildingId);
          if (!bd || bd.x !== x || bd.y !== y) continue;
          if ((bd.type !== 'spire' && bd.type !== 'arcology') || !bd.powered) continue;
          const s = bd.size / 2;
          const h = bd.type === 'spire' ? 236 : serviceBuildingHeight(bd.type) - 50;
          cand.push({ d: -1000, l: { x: (x + s - (y + s)) * HALF_W, y: (x + s + y + s) * HALF_H - h, ph: hash2(x, y, 3), col: bd.type === 'spire' ? 2 : 0, twin: true } });
        } else if (t.zone !== ZoneType.None && t.level === 3 && !t.abandoned && t.powered && (t.variant & 7) % 4 === 0 && t.age > 30) {
          const h = zoneBuildingHeight(t);
          cand.push({
            d: Math.hypot(x - cx, y - cy),
            l: { x: (x - y) * HALF_W, y: (x + y) * HALF_H + HALF_H - h, ph: hash2(x, y, 5), col: t.zone === ZoneType.Commercial ? 1 : 0, twin: false },
          });
        }
      }
    cand.sort((a, c) => a.d - c.d);
    for (let i = 0; i < Math.min(7, cand.length); i++) this.lights.push(cand[i].l);
  }

  draw(ctx: CanvasRenderingContext2D, b: Bounds, time: number, night: number, zoom: number, quality: 'low' | 'high') {
    if (!this.flyerGlow) {
      this.flyerGlow = FLYER_COLS.map((c) => glowSprite(c, 64));
      this.redGlow = glowSprite([255, 59, 92], 64);
      this.greenGlow = glowSprite([77, 255, 154], 64);
    }
    // View rect in world px (tile bounds already include a margin).
    const vx0 = (b.x0 - b.y1) * HALF_W - 40;
    const vx1 = (b.x1 - b.y0 + 1) * HALF_W + 40;
    const vy0 = (b.x0 + b.y0) * HALF_H - 40;
    const vy1 = (b.x1 + b.y1 + 2) * HALF_H + 40;

    // Searchlights first (behind the traffic).
    if (this.lights.length && night > 0.3 && quality === 'high') {
      if (!this.beams) this.beams = BEAM_COLS.map(makeBeam);
      ctx.globalCompositeOperation = 'lighter';
      const fade = Math.min(1, (night - 0.3) / 0.3);
      for (const l of this.lights) {
        for (let k = 0; k < (l.twin ? 2 : 1); k++) {
          const a = Math.sin(time * (0.35 + l.ph * 0.2) + l.ph * 10 + k * 2.1) * 0.55 + (k ? 0.25 : -0.15);
          ctx.save();
          ctx.translate(l.x, l.y);
          ctx.rotate(a);
          ctx.globalAlpha = 0.32 * fade;
          ctx.drawImage(this.beams[l.col], -24, -300, 48, 300);
          ctx.restore();
        }
      }
    }

    // Flying cars.
    const far = zoom < 0.45;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flyers) {
      const L = this.lanes[f.lane];
      if (!L) continue;
      const u = L.axis === 0 ? f.s : L.c;
      const v = L.axis === 0 ? L.c : f.s;
      const x = (u - v) * HALF_W;
      const y = (u + v) * HALF_H - L.z;
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const alpha = Math.min(1, f.age * 1.5) * (f.dying > 0 ? f.dying / 0.8 : 1);
      // Direction on screen.
      const dir = f.speed > 0 ? 1 : -1;
      const dxs = (L.axis === 0 ? HALF_W : -HALF_W) * dir;
      const dys = HALF_H * dir;
      const nl = Math.hypot(dxs, dys);
      const ux = dxs / nl;
      const uy = dys / nl;
      // Light trail.
      ctx.strokeStyle = this.flyerCss[f.col];
      ctx.lineCap = 'round';
      const trail = far ? 14 : 22;
      for (let s = 0; s < 3; s++) {
        ctx.globalAlpha = alpha * (0.32 - s * 0.09) * (0.5 + 0.5 * night);
        ctx.lineWidth = far ? 1.4 : 1.1 - s * 0.2;
        ctx.beginPath();
        ctx.moveTo(x - ux * (2 + (trail * s) / 3), y - uy * (2 + (trail * s) / 3));
        ctx.lineTo(x - ux * (2 + (trail * (s + 1)) / 3), y - uy * (2 + (trail * (s + 1)) / 3));
        ctx.stroke();
      }
      if (far) continue;
      // Body.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = night > 0.5 ? '#1a1826' : '#3c3e50';
      ctx.fillRect(x - 2.5, y - 1, 5, 2);
      ctx.fillStyle = '#5a5e74';
      ctx.fillRect(x - 1.2, y - 1.8, 2.4, 0.9);
      ctx.globalCompositeOperation = 'lighter';
      // Headlight + blinking nav lights.
      ctx.globalAlpha = alpha * (0.4 + 0.6 * night);
      ctx.drawImage(this.flyerGlow[f.col], x + ux * 3 - 5, y + uy * 3 - 5, 10, 10);
      const blink = (time * 1.6 + f.ph) % 1 < 0.25;
      if (blink) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.redGlow!, x - ux * 2.5 - 1.5 - 3, y - uy * 2.5 - 1.5 - 3 + 1, 6, 6);
        ctx.drawImage(this.greenGlow!, x - ux * 2.5 + 1.5 - 3, y - uy * 2.5 + 1.5 - 3 - 1, 6, 6);
      }
    }

    // Blimp / ad drone.
    const bl = this.blimp;
    if (bl) {
      const u = bl.axis === 0 ? bl.s : bl.c;
      const v = bl.axis === 0 ? bl.c : bl.s;
      const x = (u - v) * HALF_W;
      const y = (u + v) * HALF_H - bl.z;
      if (x > vx0 - 80 && x < vx1 + 80 && y > vy0 - 40 && y < vy1 + 40) this.drawBlimp(ctx, bl, x, y, time, night);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawBlimp(ctx: CanvasRenderingContext2D, bl: Blimp, x: number, y: number, time: number, night: number) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const bob = Math.sin(time * 0.8 + bl.ph * 6) * 1.5;
    y += bob;
    let pw = 34;
    let ph = 16;
    let px = x - pw / 2;
    let py = y + 10;
    if (bl.drone) {
      // Quad drone with a hanging panel.
      ctx.fillStyle = '#22222e';
      ctx.fillRect(x - 9, y - 1.5, 18, 3);
      ctx.fillRect(x - 11, y - 3, 4, 1.2);
      ctx.fillRect(x + 7, y - 3, 4, 1.2);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y + 1.5);
      ctx.lineTo(x - 10, y + 8);
      ctx.moveTo(x + 6, y + 1.5);
      ctx.lineTo(x + 10, y + 8);
      ctx.stroke();
      pw = 22;
      ph = 13;
      px = x - pw / 2;
      py = y + 8;
    } else {
      if (!this.blimpBody) this.blimpBody = makeBlimpBody();
      ctx.drawImage(this.blimpBody, x - 48, y - 16, 96, 32);
      px = x - pw / 2 - 4;
      py = y - 8;
      pw = 44;
      ph = 14;
    }
    // Holo panel: colour field + scrolling invented glyphs.
    const R = this.ramp;
    const hi = Math.floor(time * 3 + bl.ph * 24) % R.length;
    ctx.globalAlpha = 0.55 + 0.35 * night;
    ctx.fillStyle = R[hi];
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#0a0716';
    const cell = ph / 6;
    const scroll = (time * 10) % (cell * 4);
    let gi = Math.floor(time * 10 / (cell * 4));
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    for (let gx = px - scroll + pw; gx > px - cell * 4; gx -= cell * 4, gi++) {
      const gm = GLYPHS[(gi + Math.floor(bl.ph * 16)) % GLYPHS.length];
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) if (gm & (1 << (r * 3 + c))) ctx.fillRect(gx + c * cell, py + cell + r * cell, cell * 0.85, cell * 0.85);
    }
    ctx.restore();
    // Panel glow + nav lights.
    ctx.globalCompositeOperation = 'lighter';
    if (night > 0.2) {
      ctx.globalAlpha = night * 0.35;
      ctx.drawImage(this.flyerGlow![bl.drone ? 0 : 1], px - pw * 0.4, py - ph, pw * 1.8, ph * 3);
    }
    const blink = (time * 1.2 + bl.ph) % 1 < 0.2;
    if (blink) {
      ctx.globalAlpha = 1;
      ctx.drawImage(this.redGlow!, x - (bl.drone ? 14 : 48), y - 4, 8, 8);
      ctx.drawImage(this.greenGlow!, x + (bl.drone ? 6 : 40), y - 4, 8, 8);
    }
  }
}
