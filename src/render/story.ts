// ─────────────────────────────────────────────────────────────────────────────
// Story layer in the renderer (docs/STORY.md §3.7, §4, §9). Reads only
// world.turf / world.rail / world.links / world.vertical, buildingStats and
// game.story.visual (VisualState), once per frame.
//
//   depth-sorted extras  Ribbon Rail tiles, skybridge gap tiles, turf tags on
//                        facades, Tuning window candles (drawn inside the
//                        building sweep at each tile's x + y key)
//   ground fx            Trace lamp flicker, LURE's cold lamps, Undertow green
//                        lamps (after the ground, before buildings)
//   sky fx               crackdown searchlights + wasp drones, kite drones over
//                        Kites turf, MOTH's mark on holo towers once Revealed
//   tool fx              valid skybridge anchors glow while the tool is active
//   screen               ending palette grade (Ironwork sodium, Pearl pink …)
//
// Lookups (link segments per gap tile, tall anchors) are rebuilt only when the
// vertical cache version, the link list or the tiles change.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from '../game/config';
import { buildingStats } from '../game/buildingStats';
import type { Game } from '../game/game';
import { hash2 } from '../game/rng';
import type { BuildingStats, VisualState } from '../game/story/types';
import { MAP_SIZE, Terrain, ZoneType, type Tile } from '../game/types';
import type { World } from '../game/world';
import { MOTH_COLOR, sigilSprite } from './art/sigils';
import { drawRailTile, drawSkybridgeTile, type RailEnv } from './art/vertical';
import { serviceBuildingHeight, zoneBuildingHeight, LOD_ZOOM, type ArtEnv } from './buildings';
import { HALF_H, HALF_W } from './camera';
import type { Rect } from './ground';
import { css, glowSprite, type RGB } from './palette';

const N = MAP_SIZE;
const LIME: RGB = [182, 255, 46];
const LILAC: RGB = [201, 162, 255];
const CANDLE: RGB = [255, 222, 150];
const COLD: RGB = [230, 244, 255];
const WASP_BLUE: RGB = [80, 140, 255];
const WASP_RED: RGB = [255, 59, 92];

interface Seg {
  x: number;
  y: number;
  axisX: boolean;
  z: number;
  active: boolean;
  /** Index of the tile along the span (0..1 phase base for walking lights). */
  k: number;
  /** Span along the axis within this tile (end tiles reach into the anchors' insets). */
  a0: number;
  a1: number;
}

const statsTmp = {} as BuildingStats;

/** Lazily cached glow sprites (glowSprite builds a key string per call). */
let candleGlow: HTMLCanvasElement | null = null;
const candleSprite = () => (candleGlow ??= glowSprite(CANDLE, 32));

/** Is the tile a tall skybridge anchor (§4.3)? Mirrors the vertical rules for drawing only. */
function tallAt(world: World, x: number, y: number): boolean {
  const t = world.tiles[y * N + x];
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (!b) return false;
    if (BUILDINGS[b.type].tall) return true;
    return b.type === 'stack' && buildingStats(b, statsTmp).tall;
  }
  return (t.zone === ZoneType.Residential || t.zone === ZoneType.Commercial) && t.level >= 3 && !t.abandoned;
}

/** How far a tower's wall sits inside its footprint edge (tiles), so the tube meets the facade. */
function anchorInset(world: World, x: number, y: number): number {
  const t = world.tiles[y * N + x];
  if (t.buildingId < 0) return 0.12;
  const b = world.buildings.get(t.buildingId);
  if (!b) return 0;
  switch (b.type) {
    case 'stack':
      return 0.6;
    case 'glarewall':
      return 0.33;
    case 'spire':
      return 0.5;
    case 'arcology':
      return 1.1;
    default:
      return 0.2;
  }
}

/** Sweep key at which a footprint's building is drawn (its front corner). */
function frontKey(world: World, x: number, y: number): number {
  const t = world.tiles[y * N + x];
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (b) return b.x + b.size - 1 + b.y + b.size - 1;
  }
  return x + y;
}

/** Structural roof height of a skybridge anchor (no antennas, halos or flames). */
const ROOF_Z: Partial<Record<string, number>> = { spire: 222, arcology: 150, glarewall: 120 };
export function anchorHeight(world: World, x: number, y: number): number {
  const t = world.tiles[y * N + x];
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (!b) return 60;
    if (b.type === 'stack') {
      const done = (b.buildDays ?? 0) > 0 ? (b.stage ?? 1) - 1 : (b.stage ?? 1);
      return done >= 2 ? 146 : 56;
    }
    return ROOF_Z[b.type] ?? serviceBuildingHeight(b.type, b) * 0.85;
  }
  return t.zone !== ZoneType.None && t.level > 0 ? zoneBuildingHeight(t) * 0.82 : 40;
}

// ── Tag sprites (spray-painted gang marks) ────────────────────────────────

let tagSprites: HTMLCanvasElement[] | null = null;
function tags(): HTMLCanvasElement[] {
  if (tagSprites) return tagSprites;
  const make = (draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 32;
    const g = c.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    draw(g);
    return c;
  };
  const hook = make((g) => {
    g.strokeStyle = css(LIME, 0.9);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(26, 3);
    g.lineTo(26, 16);
    g.arc(20, 16, 6, 0, Math.PI * 0.95);
    g.stroke();
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const x = 6 + i * 2.3;
      const y = 26 + Math.sin(i * 0.8) * 2.4;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
  const kite = make((g) => {
    g.strokeStyle = css(LILAC, 0.95);
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(24, 2);
    g.lineTo(33, 12);
    g.lineTo(24, 22);
    g.lineTo(15, 12);
    g.closePath();
    g.moveTo(24, 22);
    g.bezierCurveTo(30, 26, 18, 28, 26, 31);
    g.stroke();
  });
  tagSprites = [hook, kite];
  return tagSprites;
}

/** Diamond kite light for the sky drones. */
let kiteGlow: HTMLCanvasElement | null = null;
function kiteSprite(): HTMLCanvasElement {
  if (kiteGlow) return kiteGlow;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = css(LILAC, 0.25);
  g.beginPath();
  g.arc(16, 16, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css([240, 225, 255], 0.95);
  g.beginPath();
  g.moveTo(16, 7);
  g.lineTo(22, 15);
  g.lineTo(16, 25);
  g.lineTo(10, 15);
  g.closePath();
  g.fill();
  kiteGlow = c;
  return c;
}

export class StoryRender {
  /** Skybridge pieces by the sweep key they draw at (after that diagonal's buildings). */
  private segs = new Map<number, Seg[]>();
  private readonly segKey = [-1, -1, -1, -1];
  private segDirty = true;
  private tall = new Uint8Array(N * N);
  private tallDirty = true;
  private readonly railEnv: RailEnv = { time: 0, night: 0, zoom: 1, lod: false, quality: 'high' };
  private unsubs: (() => void)[] = [];
  private readonly seen = new Set<number>();
  /** Current VisualState (refreshed every frame in prepare). */
  visual: VisualState | null = null;

  constructor(private readonly game: Game) {
    const ev = game.events;
    this.unsubs.push(
      ev.on('tiles', () => {
        this.segDirty = true;
        this.tallDirty = true;
      }),
      ev.on('vertical', () => {
        this.segDirty = true;
        this.tallDirty = true;
      }),
      ev.on('world', () => {
        this.segDirty = true;
        this.tallDirty = true;
        this.segs.clear();
      }),
    );
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** Per frame, before the building sweep. */
  prepare(world: World, env: ArtEnv): void {
    this.visual = this.game.story?.visual ?? null;
    const e = this.railEnv;
    e.time = env.time;
    e.night = env.night;
    e.zoom = env.zoom;
    e.lod = env.zoom < LOD_ZOOM;
    e.quality = env.quality;
    let idSum = 0;
    for (const l of world.links) idSum += l.id * 31 + l.ax + l.by * 7;
    const k = this.segKey;
    const vv = world.vertical.version;
    const n = world.links.length;
    const act = world.vertical.activeLinks.size;
    if (this.segDirty || k[0] !== vv || k[1] !== n || k[2] !== idSum || k[3] !== act) {
      k[0] = vv;
      k[1] = n;
      k[2] = idSum;
      k[3] = act;
      this.segDirty = false;
      this.rebuildSegs(world);
    }
  }

  private rebuildSegs(world: World): void {
    this.segs.clear();
    for (const l of world.links) {
      if (!world.inBounds(l.ax, l.ay) || !world.inBounds(l.bx, l.by)) continue;
      const axisX = l.ay === l.by;
      // A = the back anchor (smaller coordinate along the axis), B = the front one.
      const flip = axisX ? l.bx < l.ax : l.by < l.ay;
      const ax = flip ? l.bx : l.ax;
      const ay = flip ? l.by : l.ay;
      const bx = flip ? l.ax : l.bx;
      const by = flip ? l.ay : l.by;
      const z = Math.max(30, Math.min(anchorHeight(world, ax, ay), anchorHeight(world, bx, by)) - 10);
      const active = world.vertical.activeLinks.has(l.id);
      const n = Math.abs(bx - ax) + Math.abs(by - ay);
      // The back anchor may sort after the first gap tiles (multi-tile footprint): draw the tube after it.
      const after = frontKey(world, ax, ay);
      const eA = anchorInset(world, ax, ay);
      const eB = anchorInset(world, bx, by);
      for (let k = 1; k < n; k++) {
        const x = axisX ? ax + k : ax;
        const y = axisX ? ay : ay + k;
        const key = Math.max(x + y, after);
        const seg: Seg = { x, y, axisX, z, active, k: k / Math.max(1, n), a0: k === 1 ? -eA : 0, a1: k === n - 1 ? 1 + eB : 1 };
        const list = this.segs.get(key);
        if (list) list.push(seg);
        else this.segs.set(key, [seg]);
      }
    }
  }

  /** Skybridge pieces scheduled at sweep key `s` (call after that diagonal's buildings). */
  drawSkybridges(ctx: CanvasRenderingContext2D, s: number): void {
    if (!this.segs.size) return;
    const list = this.segs.get(s);
    if (!list) return;
    const mural = !!this.visual?.mural;
    for (const g of list) drawSkybridgeTile(ctx, (g.x - g.y) * HALF_W, (g.x + g.y) * HALF_H, g.axisX, g.z, g.active, mural, g.k, this.railEnv, 0, g.a0, g.a1);
  }

  /** Should the rail on this tile draw before the tile's own building (tall building hides it)? */
  railBefore(t: Tile): boolean {
    return t.buildingId < 0 && t.zone !== ZoneType.None && t.level > 0 && zoneBuildingHeight(t) > 30;
  }

  /** Rail segment of tile (x, y) (call inside the sweep). */
  drawRail(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, mask: number): void {
    const i = y * N + x;
    const live = world.vertical.railLive[i] === 1;
    const land = world.tiles[i].terrain === Terrain.Land;
    drawRailTile(ctx, (x - y) * HALF_W, (x + y) * HALF_H, mask, live, land, x + y, this.railEnv);
  }

  /** Depth-sorted extras after the tile's own building: skybridge piece, turf tag, candles. */
  drawAfter(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, t: Tile, env: ArtEnv): void {
    const i = y * N + x;
    if (env.zoom < 0.45 || t.buildingId >= 0 || t.zone === ZoneType.None || t.level === 0) return;
    const owner = world.turf.owner[i];
    const v = this.visual;
    const low = v?.palette === 'lowcrown' ? 2 : 1;
    if (owner && world.turf.str[i] >= 60 && hash2(x, y, 41) < 0.32 * low) {
      // Tag on the building's left facade, near the street.
      const spr = tags()[owner - 1];
      const wx = (x - y) * HALF_W - 14;
      const wy = (x + y) * HALF_H + 17 - (hash2(x, y, 42) * 6) - (owner === 2 && t.level >= 2 ? Math.min(zoneBuildingHeight(t) - 16, 30) : 0);
      ctx.save();
      ctx.globalAlpha = (0.65 + 0.35 * env.night) * (t.abandoned ? 0.75 : 1);
      ctx.transform(1, -0.5, 0, 1, wx, wy);
      if (env.night > 0.3) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(spr, -11, -10, 22, 15);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(spr, -10, -9, 20, 13.5);
      ctx.restore();
    }
    // Tuning candles in Hab windows.
    const candles = v?.candles ?? 0;
    if (candles > 0.01 && env.night > 0.3 && t.zone === ZoneType.Residential && !t.abandoned && t.powered && hash2(x, y, 51) < candles * 0.65) {
      const h = Math.max(8, zoneBuildingHeight(t) - 6);
      const g = candleSprite();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        if (hash2(x, y, 60 + k) > 0.4 + candles * 0.6) continue;
        const u = 0.25 + hash2(x, y, 70 + k) * 0.55;
        const side = k % 2 === 0;
        const wx = (x - y) * HALF_W + (side ? (u - 0.9) * HALF_W : (0.9 - u) * HALF_W);
        const wy = (x + y) * HALF_H + (u + 0.9) * HALF_H - 6 - hash2(x, y, 80 + k) * (h - 6);
        const flick = 0.75 + 0.25 * Math.sin(env.time * (5 + k) + x * 3.1 + y);
        ctx.globalAlpha = env.night * 0.8 * flick;
        ctx.drawImage(g, wx - 4, wy - 4, 8, 8);
        ctx.fillStyle = css(CANDLE, 0.95);
        ctx.fillRect(wx - 0.6, wy - 0.8, 1.2, 1.6);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Ground-level mood: Trace flicker, LURE's cold lamps, Undertow green lamps. World transform. */
  drawGroundFx(ctx: CanvasRenderingContext2D, world: World, b: Rect, env: ArtEnv, view: Rect): void {
    const v = this.visual;
    const n = env.night;
    if (n < 0.2 || env.zoom < 0.35) return;
    const flicker = v ? v.traceFlicker : 0;
    const lure = !!v?.lureCold;
    const turfOn = world.turf.seeded.undertow || world.turf.seeded.kites;
    if (flicker < 0.02 && !lure && !turfOn) return;
    const slot = Math.floor(env.time * 6);
    // Per-lamp chance per 1/6 s slot so a lamp flickers at ≈ trace/100 × 0.3 per second.
    const pFlick = (flicker * 0.3) / 6;
    const dark = glowSprite([0, 0, 0], 32);
    const cold = glowSprite(COLD, 64);
    const warm = glowSprite(CANDLE, 64);
    const lime = glowSprite(LIME, 64);
    const lv = world.fields.landValue;
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * N + x;
        const t = world.tiles[i];
        const wx = (x - y) * HALF_W;
        const wy = (x + y) * HALF_H + HALF_H;
        if (wx + HALF_W < view.x0 || wx - HALF_W > view.x1 || wy + HALF_H < view.y0 || wy - HALF_H > view.y1) continue;
        if (t.road) {
          if (pFlick > 0 && hash2(x * 7 + slot, y, 91) < pFlick) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 0.55 * n;
            ctx.drawImage(dark, wx - 24, wy - 12, 48, 24);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.5 * n;
            ctx.drawImage(cold, wx - 6 + hash2(x, y, slot) * 12, wy - 10, 8, 8);
          }
          if (lure && lv[i] >= 0.5 && ((x + y) & 1) === 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.16 * n;
            ctx.drawImage(cold, wx - 30, wy - 15, 60, 30);
          }
          if (turfOn && world.turf.owner[i] === 1 && hash2(x, y, 33) < 0.5) {
            // Undertow streets: green-tinted lamps.
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.34 * n * (0.4 + 0.6 * (world.turf.str[i] / 100));
            ctx.drawImage(lime, wx - 30, wy - 15, 60, 30);
          }
        } else if (lure && t.zone !== ZoneType.None && t.level > 0 && !t.powered && !t.abandoned) {
          // MOTH's dark blocks flicker warm.
          const a = 0.5 + 0.5 * Math.sin(env.time * 3 + x * 1.7 + y * 2.3);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.18 * n * a;
          ctx.drawImage(warm, wx - 22, wy - 11, 44, 22);
        }
      }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Searchlights + wasp drones over crackdown zones, kite drones over Kites turf, MOTH on holo towers. */
  drawSkyFx(ctx: CanvasRenderingContext2D, world: World, b: Rect, env: ArtEnv, view: Rect): void {
    const v = this.visual;
    const t = env.time;
    if (v && v.crackdowns.length) {
      for (let c = 0; c < v.crackdowns.length; c++) {
        const z = v.crackdowns[c];
        const cx = (z.x - z.y) * HALF_W;
        const cy = (z.x + z.y) * HALF_H;
        if (cx < view.x0 - 600 || cx > view.x1 + 600 || cy < view.y0 - 500 || cy > view.y1 + 500) continue;
        this.searchlights(ctx, z.x, z.y, z.r, t + c * 7.3, env.night);
        this.wasps(ctx, z.x, z.y, z.r, t + c * 3.1);
      }
    }
    if (env.night > 0.35 && world.turf.stats.tiles.kites > 0) this.kiteDrones(ctx, world, t, env.night);
    if (v?.revealed && env.night > 0.2) this.mothMarks(ctx, world, b, t);
  }

  private searchlights(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, night: number): void {
    const a0 = 0.18 + 0.32 * night;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) {
      const gx = x + Math.cos(t * (0.33 + k * 0.11) + k * 2.1) * r * 0.55;
      const gy = y + Math.sin(t * (0.27 + k * 0.13) + k) * r * 0.55;
      const wx = (gx - gy) * HALF_W;
      const wy = (gx + gy) * HALF_H + HALF_H;
      const sx = (x - y) * HALF_W + (k ? 90 : -70);
      const sy = (x + y) * HALF_H - 260;
      const rx = 34;
      const grad = ctx.createLinearGradient(sx, sy, wx, wy);
      grad.addColorStop(0, css([200, 220, 255], 0));
      grad.addColorStop(0.35, css([200, 220, 255], a0 * 0.35));
      grad.addColorStop(1, css([220, 235, 255], a0 * 0.55));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy);
      ctx.lineTo(wx - rx, wy);
      ctx.lineTo(wx + rx, wy);
      ctx.lineTo(sx + 3, sy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css([230, 240, 255], a0 * 0.45);
      ctx.beginPath();
      ctx.ellipse(wx, wy, rx, rx / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private wasps(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) {
      const ang = t * (0.5 + k * 0.07) + k * 1.05;
      const rr = r * (0.35 + 0.1 * (k % 3));
      const gx = x + Math.cos(ang) * rr;
      const gy = y + Math.sin(ang) * rr;
      const wx = (gx - gy) * HALF_W;
      const wy = (gx + gy) * HALF_H - 70 - (k % 3) * 18 + Math.sin(t * 2 + k) * 4;
      const blue = (Math.floor(t * 4 + k) & 1) === 0;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(glowSprite(blue ? WASP_BLUE : WASP_RED, 32), wx - 6, wy - 6, 12, 12);
      ctx.fillStyle = blue ? '#cfe0ff' : '#ffd0d8';
      ctx.fillRect(wx - 1, wy - 1, 2, 2);
    }
    ctx.restore();
  }

  private kiteDrones(ctx: CanvasRenderingContext2D, world: World, t: number, night: number): void {
    const s = world.turf.stats.strongest.kites;
    if (s < 0) return;
    const sx = s % N;
    const sy = (s / N) | 0;
    const spr = kiteSprite();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const gx = sx + Math.cos(t * 0.21 + k * 1.6) * (2 + k);
      const gy = sy + Math.sin(t * 0.17 + k * 2.2) * (2 + k * 0.7);
      const wx = (gx - gy) * HALF_W;
      const wy = (gx + gy) * HALF_H - 130 - k * 14 + Math.sin(t * 1.3 + k) * 6;
      ctx.globalAlpha = night * (0.55 + 0.25 * Math.sin(t * 2 + k));
      ctx.drawImage(spr, wx - 7, wy - 7, 14, 14);
    }
    ctx.restore();
  }

  private mothMarks(ctx: CanvasRenderingContext2D, world: World, b: Rect, t: number): void {
    // MOTH's mark on holo towers about 10% of the time.
    const spr = sigilSprite('moth', MOTH_COLOR, 64);
    if (!spr) return;
    for (const bd of world.buildings.values()) {
      if (bd.type !== 'spire' && bd.type !== 'arcology' && bd.type !== 'glarewall' && !(bd.type === 'stack' && bd.crown === 'glare')) continue;
      if (bd.x + bd.size < b.x0 || bd.x > b.x1 || bd.y + bd.size < b.y0 || bd.y > b.y1) continue;
      const slot = Math.floor(t / 1.6 + bd.id * 0.37);
      if (hash2(slot, bd.id, 7) > 0.1) continue;
      const cx = bd.x + bd.size / 2;
      const cy = bd.y + bd.size / 2;
      const wx = (cx - cy) * HALF_W;
      const wy = (cx + cy) * HALF_H - serviceBuildingHeight(bd.type, bd) * 0.62;
      const ph = ((t / 1.6 + bd.id * 0.37) % 1) * Math.PI;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.sin(ph) * 0.9;
      ctx.drawImage(spr, wx - 18, wy - 18, 36, 36);
      ctx.restore();
    }
  }

  /** While the skybridge tool is active: every valid tall anchor glows. World transform. */
  drawAnchors(ctx: CanvasRenderingContext2D, world: World, b: Rect, env: ArtEnv): void {
    if (this.tallDirty) {
      this.tallDirty = false;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) this.tall[y * N + x] = tallAt(world, x, y) ? 1 : 0;
    }
    const c: RGB = [143, 227, 255];
    const g = glowSprite(c, 64);
    const pulse = 0.65 + 0.35 * Math.sin(env.time * 4);
    const lw = 1.6 / env.zoom;
    const seen = this.seen;
    seen.clear();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * N + x;
        if (!this.tall[i]) continue;
        const t = world.tiles[i];
        let size = 1;
        let cx = x + 0.5;
        let cy = y + 0.5;
        if (t.buildingId >= 0) {
          if (seen.has(t.buildingId)) continue;
          seen.add(t.buildingId);
          const bd = world.buildings.get(t.buildingId)!;
          cx = bd.x + bd.size / 2;
          cy = bd.y + bd.size / 2;
          size = bd.size;
        }
        const h = anchorHeight(world, x, y);
        const wx = (cx - cy) * HALF_W;
        const wy = (cx + cy) * HALF_H - h;
        // Roof ring + a short beacon beam: "you can start or end a skybridge here".
        const rx = Math.min(size, 2) * HALF_W * 0.55;
        ctx.globalAlpha = 0.85 * pulse;
        ctx.strokeStyle = css(c, 0.9);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.ellipse(wx, wy, rx, rx / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        const beam = ctx.createLinearGradient(0, wy, 0, wy - 70);
        beam.addColorStop(0, css(c, 0.55 * pulse));
        beam.addColorStop(1, css(c, 0));
        ctx.globalAlpha = 1;
        ctx.fillStyle = beam;
        ctx.fillRect(wx - lw * 1.5, wy - 70, lw * 3, 70);
        ctx.globalAlpha = 0.6 * pulse;
        ctx.drawImage(g, wx - rx * 1.3, wy - rx * 0.65, rx * 2.6, rx * 1.3);
      }
    ctx.restore();
  }

  /** Ending palette grade over the whole screen (identity × DPR transform, CSS px size). */
  drawGrade(ctx: CanvasRenderingContext2D, w: number, h: number, night: number): void {
    const p = this.visual?.palette;
    if (!p || p === 'quiet') return;
    ctx.save();
    if (p === 'ironwork') {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = css([255, 150, 50], 0.22 + 0.12 * night);
      ctx.fillRect(0, 0, w, h);
    } else if (p === 'pearl') {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = css([255, 198, 241], 0.24);
      ctx.fillRect(0, 0, w, h);
    } else if (p === 'lowcrown') {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, css(LIME, 0.035 * night));
      g.addColorStop(1, css(LILAC, 0.05 * night));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (p === 'ledger') {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = css([150, 220, 255], 0.14);
      ctx.fillRect(0, 0, w, h);
    } else if (p === 'lamplight') {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = css([255, 236, 190], 0.2 + 0.1 * night);
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}
