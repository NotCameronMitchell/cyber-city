// ─────────────────────────────────────────────────────────────────────────────
// Everything drawn *over* the map that is not terrain or a building:
//
//  * OverlayLayer: data views (heatmaps, power grid, service coverage). The
//    field data is written into a 64×64 image, one pixel per tile, and drawn
//    with the iso tile transform, so the whole map costs one drawImage.
//  * Tool previews (tile diamonds, ghost roads, building ghost + radius),
//    selection highlight, unpowered / no-road glyphs and the world-anchored
//    cost tag (drawn in screen space so it stays readable at any zoom).
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, CURRENCY, ROAD_ACCESS_RANGE, isBuildingTool } from '../game/config';
import type { Game } from '../game/game';
import { MAP_SIZE, ZoneType, type ActionPlan, type OverlayId, type ServiceEffect, type Tile } from '../game/types';
import type { World } from '../game/world';
import { drawRailTile, drawSkybridgeTile, type RailEnv } from './art/vertical';
import { drawBuildingGhost, serviceBuildingHeight, zoneBuildingHeight, LOD_ZOOM, type ArtEnv } from './buildings';
import { HALF_H, HALF_W, type Camera } from './camera';
import { ROAD_HALF, roadOutlinePath, roadShapePath, type Rect } from './ground';
import { highlight } from './highlight';
import { anchorHeight } from './story';
import { NEON, css, glowSprite, heat, hexToRgb, type RGB } from './palette';

const N = MAP_SIZE;
const PERP = (2 * HALF_W * HALF_H) / Math.hypot(HALF_W, HALF_H);
const SQRT2 = Math.SQRT2;

const EFFECT_RGB: Record<ServiceEffect, RGB> = {
  security: NEON.blue,
  health: NEON.red,
  net: NEON.cyan,
  park: NEON.green,
  transit: NEON.yellow,
  prestige: NEON.magenta,
};
const EFFECTS = Object.keys(EFFECT_RGB) as ServiceEffect[];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Apply the tile-space transform (tile (u, v) → world px) on top of the current world transform. */
function toTileSpace(ctx: CanvasRenderingContext2D) {
  ctx.transform(HALF_W, HALF_H, -HALF_W, HALF_H, 0, 0);
}

// ── Data overlays ──────────────────────────────────────────────────────────

export class OverlayLayer {
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private dirty = true;
  private lastBuild = -1e9;
  private builtFor: OverlayId = 'none';
  private lut: Uint8ClampedArray;

  constructor() {
    this.lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const c = heat(i / 255);
      this.lut[i * 3] = c[0];
      this.lut[i * 3 + 1] = c[1];
      this.lut[i * 3 + 2] = c[2];
    }
  }

  /** Field data / tiles changed (cheap: rebuild is throttled). */
  invalidate() {
    this.dirty = true;
  }

  /** World replaced. */
  reset() {
    this.dirty = true;
    this.builtFor = 'none';
  }

  private ensure(): boolean {
    if (this.canvas) return true;
    if (typeof document === 'undefined') return false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = N;
    this.canvas.height = N;
    this.g = this.canvas.getContext('2d');
    if (!this.g) return false;
    this.img = this.g.createImageData(N, N);
    return true;
  }

  private build(world: World, overlay: OverlayId) {
    const d = this.img!.data;
    const tiles = world.tiles;
    const f = world.fields;
    const lut = this.lut;
    for (let i = 0; i < N * N; i++) {
      const t = tiles[i];
      const o = i * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      switch (overlay) {
        case 'landValue':
        case 'crime':
        case 'pollution':
        case 'traffic': {
          const v = Math.max(0, Math.min(1, f[overlay][i]));
          const li = Math.round(v * 255) * 3;
          r = lut[li];
          g = lut[li + 1];
          b = lut[li + 2];
          a = t.terrain === 1 ? 70 : 150 + v * 70;
          if (overlay === 'traffic' && !t.road) a *= 0.45;
          break;
        }
        case 'power': {
          const c = powerColor(world, t);
          if (c) {
            r = c[0];
            g = c[1];
            b = c[2];
            a = c[3];
          }
          break;
        }
        case 'turf': {
          const owner = world.turf.owner[i];
          if (owner === 1 || owner === 2) {
            const c = owner === 1 ? TURF_LIME : TURF_LILAC;
            const st = world.turf.str[i];
            r = c[0];
            g = c[1];
            b = c[2];
            a = 50 + st * 1.6;
          } else if (t.terrain !== 1) {
            a = 0;
          }
          break;
        }
        case 'services': {
          let best = 0;
          let which: ServiceEffect = 'park';
          for (const e of EFFECTS) {
            const v = f[e][i];
            if (v > best) {
              best = v;
              which = e;
            }
          }
          if (best > 0.01) {
            const c = EFFECT_RGB[which];
            r = c[0];
            g = c[1];
            b = c[2];
            a = 40 + Math.min(1, best) * 170;
          }
          break;
        }
        default:
          break;
      }
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = a;
    }
    this.g!.putImageData(this.img!, 0, 0);
  }

  /** Draw the active data overlay. World transform expected. */
  draw(ctx: CanvasRenderingContext2D, world: World, overlay: OverlayId, time: number, bounds: Rect, zoom: number) {
    if (overlay === 'none' || !this.ensure()) return;
    const t = now();
    if (overlay !== this.builtFor || (this.dirty && t - this.lastBuild > 120)) {
      this.build(world, overlay);
      this.builtFor = overlay;
      this.dirty = false;
      this.lastBuild = t;
    }
    ctx.save();
    toTileSpace(ctx);
    // Darken the map so the data reads, then lay the data image over it.
    ctx.fillStyle = 'rgba(4,3,14,0.55)';
    ctx.fillRect(0, 0, N, N);
    ctx.imageSmoothingEnabled = overlay !== 'power' && overlay !== 'turf';
    ctx.drawImage(this.canvas!, 0, 0, N, N);
    ctx.imageSmoothingEnabled = true;
    if (overlay === 'turf') this.turfPatterns(ctx, world, time, bounds, zoom);
    // Thin tile grid on top keeps tiles countable on the smooth heatmaps.
    if (overlay !== 'power' && zoom > 0.45) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      const th = 1 / (zoom * PERP);
      for (let y = bounds.y0; y <= bounds.y1 + 1; y++) ctx.fillRect(bounds.x0, y, bounds.x1 - bounds.x0 + 1, th);
      for (let x = bounds.x0; x <= bounds.x1 + 1; x++) ctx.fillRect(x, bounds.y0, th, bounds.y1 - bounds.y0 + 1);
    }
    if (overlay === 'power') this.conduits(ctx, world, time, bounds, zoom);
    ctx.restore();
  }

  /**
   * Turf patterns (§3.7) so the overlay works without colour: Undertow lime
   * diagonal hatching, Kites lilac dots; contested tiles flicker red. Tile space.
   */
  private turfPatterns(ctx: CanvasRenderingContext2D, world: World, time: number, b: Rect, zoom: number) {
    const own = world.turf.owner;
    const con = world.turf.contested;
    const px = 1 / (zoom * PERP);
    const lw = Math.max(0.03, 1.3 * px);
    const hatch = new Path2D();
    const dots = new Path2D();
    const contested = new Path2D();
    let any = false;
    const ds = Math.max(0.05, 2.2 * px);
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * N + x;
        const o = own[i];
        if (!o) continue;
        any = true;
        if (o === 1) {
          // Lines along the tile u axis read as screen diagonals on the iso map.
          for (let k = 0; k < 3; k++) {
            const d = (k + 0.5) / 3;
            hatch.moveTo(x, y + d);
            hatch.lineTo(x + 1, y + d);
          }
        } else {
          for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) dots.rect(x + (a + 0.5) / 3 - ds / 2, y + (c + 0.5) / 3 - ds / 2, ds, ds);
        }
        if (con[i] > 0) contested.rect(x, y, 1, 1);
      }
    if (!any) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = css(TURF_LIME, 0.75);
    ctx.lineWidth = lw;
    ctx.stroke(hatch);
    ctx.fillStyle = css(TURF_LILAC, 0.9);
    ctx.fill(dots);
    ctx.globalCompositeOperation = 'source-over';
    const f = 0.5 + 0.5 * Math.sin(time * 9);
    ctx.fillStyle = css(NEON.red, 0.12 + 0.32 * f);
    ctx.fill(contested);
    ctx.restore();
  }

  /** Animated energy flow along powered roads (tile space, additive). */
  private conduits(ctx: CanvasRenderingContext2D, world: World, time: number, b: Rect, zoom: number) {
    ctx.globalCompositeOperation = 'lighter';
    const px = 1 / (zoom * PERP);
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const t = world.tiles[y * N + x];
        if (!t.road) continue;
        const mask = world.roadMask(x, y);
        const flow = 0.5 + 0.5 * Math.sin(time * 5 - (x + y) * 0.9);
        const c = t.powered ? NEON.cyan : NEON.red;
        for (const [w, a] of [
          [Math.max(0.1, 6 * px), t.powered ? 0.16 + 0.12 * flow : 0.1],
          [Math.max(0.03, 1.6 * px), t.powered ? 0.55 + 0.4 * flow : 0.4],
        ]) {
          ctx.fillStyle = css(c, a);
          const h = w / 2;
          ctx.fillRect(x + 0.5 - h, y + 0.5 - h, w, w);
          if (mask & 1) ctx.fillRect(x + 0.5 - h, y, w, 0.5 - h);
          if (mask & 4) ctx.fillRect(x + 0.5 - h, y + 0.5 + h, w, 0.5 - h);
          if (mask & 8) ctx.fillRect(x, y + 0.5 - h, 0.5 - h, w);
          if (mask & 2) ctx.fillRect(x + 0.5 + h, y + 0.5 - h, 0.5 - h, w);
        }
      }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** RGBA (0..255) for the power overlay, or null for "no data". */
function powerColor(world: World, t: Tile): [number, number, number, number] | null {
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (!b) return null;
    const def = BUILDINGS[b.type];
    if (def.powerSupply > 0) return b.offline > 0 ? [255, 59, 92, 220] : [77, 255, 154, 210];
    return b.powered && b.offline <= 0 ? [34, 229, 255, 170] : [255, 59, 92, 220];
  }
  if (t.road) return t.powered ? [34, 229, 255, 60] : [90, 60, 90, 60];
  if (t.zone !== ZoneType.None) {
    if (t.level === 0) return t.powered ? [34, 229, 255, 55] : [140, 140, 170, 40];
    if (t.abandoned) return [120, 110, 120, 110];
    return t.powered ? [34, 229, 255, 125] : [255, 59, 92, 215];
  }
  return null;
}

// ── Shared outline helpers ─────────────────────────────────────────────────

/** Path of the outer boundary of a set of tiles (tile space). */
function boundaryPath(ctx: CanvasRenderingContext2D, tiles: { x: number; y: number }[], set: Set<number>) {
  ctx.beginPath();
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && set.has(y * N + x);
  for (const { x, y } of tiles) {
    if (!has(x, y - 1)) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1, y);
    }
    if (!has(x + 1, y)) {
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + 1, y + 1);
    }
    if (!has(x, y + 1)) {
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + 1, y + 1);
    }
    if (!has(x - 1, y)) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 1);
    }
  }
}

/** Neon glow stroke of the current path: wide faint halo + bright core (tile space). */
function glowStroke(ctx: CanvasRenderingContext2D, c: RGB, zoom: number, strength = 1) {
  const px = 1 / (zoom * PERP);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = css(c, 0.18 * strength);
  ctx.lineWidth = 7 * px;
  ctx.stroke();
  ctx.strokeStyle = css(c, 0.35 * strength);
  ctx.lineWidth = 3.5 * px;
  ctx.stroke();
  ctx.strokeStyle = css(c, 0.95 * strength);
  ctx.lineWidth = 1.5 * px;
  ctx.stroke();
  ctx.globalCompositeOperation = prev;
}

/** Dashed iso ellipse for a coverage radius (r tiles) around tile-space point (cx, cy). World transform. */
function radiusRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: RGB, zoom: number, time: number) {
  const wx = (cx - cy) * HALF_W;
  const wy = (cx + cy) * HALF_H;
  const rx = r * HALF_W * SQRT2;
  const ry = r * HALF_H * SQRT2;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(wx, wy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(c, 0.07);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(c, 0.2);
  ctx.lineWidth = 5 / zoom;
  ctx.stroke();
  ctx.setLineDash([10 / zoom, 7 / zoom]);
  ctx.lineDashOffset = -time * 24 / zoom;
  ctx.strokeStyle = css(c, 0.85);
  ctx.lineWidth = 1.6 / zoom;
  ctx.stroke();
  ctx.restore();
}

// ── Previews ───────────────────────────────────────────────────────────────

const OK: RGB = NEON.green;
const BAD: RGB = NEON.red;
const DEMOLISH: RGB = [255, 120, 50];
const TURF_LIME: RGB = [182, 255, 46];
const TURF_LILAC: RGB = [201, 162, 255];
const previewEnv: RailEnv = { time: 0, night: 0, zoom: 1, lod: false, quality: 'high' };

/** Height of a tile's roof, for skybridge previews (same rule as the drawn bridges). */
function tileTop(world: World, x: number, y: number): number {
  return world.inBounds(x, y) ? anchorHeight(world, x, y) : 40;
}

/** Ground-level part of the tool preview (before buildings). World transform expected. */
export function drawPreviewGround(ctx: CanvasRenderingContext2D, game: Game, time: number, zoom: number) {
  const plan = game.preview;
  if (!plan || !plan.tiles.length) return;
  const world = game.world;
  ctx.save();
  if (plan.tool === 'road') {
    roadGhost(ctx, world, plan, time, zoom);
  } else if (plan.tool === 'inspect') {
    const t = plan.tiles[0];
    if (world.inBounds(t.x, t.y)) {
      toTileSpace(ctx);
      ctx.beginPath();
      ctx.rect(t.x, t.y, 1, 1);
      glowStroke(ctx, NEON.cyan, zoom, 0.7);
    }
  } else {
    const isBuild = isBuildingTool(plan.tool);
    const bulldoze = plan.tool === 'bulldoze';
    const pulse = 0.85 + 0.15 * Math.sin(time * 6);
    toTileSpace(ctx);
    const okTiles = plan.tiles.filter((t) => t.ok && world.inBounds(t.x, t.y));
    const badTiles = plan.tiles.filter((t) => !t.ok && world.inBounds(t.x, t.y));
    // With a failing plan (no money, locked) every tile reads as blocked.
    const okColor = !plan.valid && isBuild ? BAD : bulldoze ? DEMOLISH : OK;
    const fillGroup = (list: { x: number; y: number }[], c: RGB, a: number) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const t of list) ctx.rect(t.x + 0.05, t.y + 0.05, 0.9, 0.9);
      ctx.fillStyle = css(c, a * pulse);
      ctx.fill();
    };
    fillGroup(okTiles, okColor, 0.26);
    fillGroup(badTiles, bulldoze ? [200, 200, 220] : BAD, bulldoze ? 0.06 : 0.3);
    const groups: [typeof okTiles, RGB][] = [
      [okTiles, okColor],
      [badTiles, bulldoze ? [160, 160, 190] : BAD],
    ];
    for (const [list, c] of groups) {
      if (!list.length) continue;
      const set = new Set(list.map((t) => t.y * N + t.x));
      boundaryPath(ctx, list, set);
      glowStroke(ctx, c, zoom, bulldoze && c !== okColor ? 0.35 : 1);
    }
    if (isBuild && plan.footprint) {
      const def = BUILDINGS[plan.tool as keyof typeof BUILDINGS];
      const fp = plan.footprint;
      ctx.restore();
      ctx.save();
      if (def.radius > 0) radiusRing(ctx, fp.x + fp.size / 2, fp.y + fp.size / 2, def.radius, hexToRgb(def.color), zoom, time);
    }
  }
  ctx.restore();
}

/** Translucent hologram road segments for a road drag. Tile space inside. */
function roadGhost(ctx: CanvasRenderingContext2D, world: World, plan: ActionPlan, time: number, zoom: number) {
  toTileSpace(ctx);
  const set = new Set<number>();
  for (const t of plan.tiles) if (t.ok) set.add(t.y * N + t.x);
  const isRoad = (x: number, y: number) => world.inBounds(x, y) && (set.has(y * N + x) || world.isRoad(x, y));
  const px = 1 / (zoom * PERP);
  const c: RGB = plan.valid ? NEON.cyan : BAD;
  const flow = time * 2;
  for (const t of plan.tiles) {
    if (!world.inBounds(t.x, t.y)) continue;
    if (!t.ok) {
      ctx.beginPath();
      ctx.rect(t.x + 0.05, t.y + 0.05, 0.9, 0.9);
      ctx.fillStyle = css(BAD, 0.3);
      ctx.fill();
      glowStroke(ctx, BAD, zoom);
      continue;
    }
    const mask =
      (isRoad(t.x, t.y - 1) ? 1 : 0) | (isRoad(t.x + 1, t.y) ? 2 : 0) | (isRoad(t.x, t.y + 1) ? 4 : 0) | (isRoad(t.x - 1, t.y) ? 8 : 0);
    ctx.beginPath();
    roadShapePath(ctx, t.x, t.y, mask, ROAD_HALF);
    ctx.fillStyle = css(c, 0.28);
    ctx.fill();
    ctx.beginPath();
    roadOutlinePath(ctx, t.x, t.y, mask, ROAD_HALF);
    glowStroke(ctx, c, zoom, 0.6);
    // Bright travelling centre dot.
    const ph = (flow - (t.x + t.y) * 0.35) % 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = css(NEON.white, 0.35 + 0.35 * Math.max(0, Math.sin(ph * Math.PI * 2)));
    const s = Math.max(0.05, 3 * px);
    ctx.fillRect(t.x + 0.5 - s / 2, t.y + 0.5 - s / 2, s, s);
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Raised part of the preview (after buildings): building ghost, skybridge span, ribbon. World transform expected. */
export function drawPreviewTop(ctx: CanvasRenderingContext2D, game: Game, env: ArtEnv) {
  const plan = game.preview;
  if (!plan) return;
  if (plan.tool === 'skybridge' || plan.tool === 'rail') {
    drawStoryPreview(ctx, game, plan, env);
    return;
  }
  if (!plan.footprint || !isBuildingTool(plan.tool)) return;
  const fp = plan.footprint;
  const wx = (fp.x - fp.y) * HALF_W;
  const wy = (fp.x + fp.y) * HALF_H;
  const ok = plan.valid && plan.tiles.every((t) => t.ok);
  ctx.save();
  drawBuildingGhost(ctx, wx, wy, plan.tool, ok, { ...env, ghost: true });
  ctx.restore();
  // Footprint outline again on top so it reads through the ghost.
  ctx.save();
  toTileSpace(ctx);
  ctx.beginPath();
  ctx.rect(fp.x, fp.y, fp.size, fp.size);
  glowStroke(ctx, ok ? OK : BAD, env.zoom, 0.5);
  ctx.restore();
}

/** Skybridge span tube / Ribbon Rail ghost along the planned tiles (§8.9). */
function drawStoryPreview(ctx: CanvasRenderingContext2D, game: Game, plan: ActionPlan, env: ArtEnv) {
  const world = game.world;
  const e = previewEnv;
  e.time = env.time;
  e.night = env.night;
  e.zoom = env.zoom;
  e.lod = env.zoom < LOD_ZOOM;
  e.quality = env.quality;
  ctx.save();
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * (0.75 + 0.2 * Math.sin(env.time * 5));
  if (plan.tool === 'skybridge' && plan.span) {
    const sp = plan.span;
    const ok = plan.valid && plan.tiles.every((t) => t.ok);
    const axisX = sp.ay === sp.by;
    const z = Math.max(30, Math.min(tileTop(world, sp.ax, sp.ay), tileTop(world, sp.bx, sp.by)) - 10);
    const dx = Math.sign(sp.bx - sp.ax);
    const dy = Math.sign(sp.by - sp.ay);
    const n = Math.abs(sp.bx - sp.ax) + Math.abs(sp.by - sp.ay);
    const order: number[] = [];
    for (let k = 1; k < n; k++) order.push(k);
    if (dx + dy < 0) order.reverse();
    for (const k of order) {
      const x = sp.ax + dx * k;
      const y = sp.ay + dy * k;
      drawSkybridgeTile(ctx, (x - y) * HALF_W, (x + y) * HALF_H, axisX, z, true, false, k / n, e, ok ? 1 : 2);
    }
    // Anchor beacons.
    const g = glowSprite(ok ? OK : BAD, 64);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y] of [
      [sp.ax, sp.ay],
      [sp.bx, sp.by],
    ]) {
      const wx = (x - y) * HALF_W;
      const wy = (x + y) * HALF_H + HALF_H;
      ctx.drawImage(g, wx - 18, wy - z - 18, 36, 36);
    }
  } else if (plan.tool === 'rail' && plan.railMasks) {
    const idx = plan.tiles.map((_, k) => k).sort((a, b) => plan.tiles[a].x + plan.tiles[a].y - (plan.tiles[b].x + plan.tiles[b].y));
    for (const k of idx) {
      const t = plan.tiles[k];
      if (!world.inBounds(t.x, t.y)) continue;
      const land = world.tiles[t.y * N + t.x].terrain === 0;
      drawRailTile(ctx, (t.x - t.y) * HALF_W, (t.x + t.y) * HALF_H, plan.railMasks[k] ?? 0, plan.valid && t.ok, land, t.x + t.y, e, true);
    }
  }
  ctx.restore();
}

/** Screen-space cost / reason tag for the current preview. Identity×DPR transform is set inside. */
export function drawCostTag(ctx: CanvasRenderingContext2D, game: Game, camera: Camera, dpr: number) {
  const plan = game.preview;
  if (!plan || plan.tool === 'inspect' || !plan.tiles.length) return;
  if (plan.cost <= 0 && (plan.valid || !plan.reason || plan.reason === 'Nothing to change')) return;
  // Anchor: end of the drag (road), footprint centre (buildings) or the front tile.
  let ax: number;
  let ay: number;
  if (plan.footprint) {
    ax = plan.footprint.x + plan.footprint.size / 2;
    ay = plan.footprint.y + plan.footprint.size / 2;
  } else if (plan.tool === 'road') {
    const t = plan.tiles[plan.tiles.length - 1];
    ax = t.x + 0.5;
    ay = t.y + 0.5;
  } else {
    let best = plan.tiles[0];
    for (const t of plan.tiles) if (t.x + t.y > best.x + best.y || (t.x + t.y === best.x + best.y && t.x > best.x)) best = t;
    ax = best.x + 0.5;
    ay = best.y + 0.5;
  }
  const s = camera.worldToScreen((ax - ay) * HALF_W, (ax + ay) * HALF_H);
  const main = plan.cost > 0 ? `-${Math.round(plan.cost).toLocaleString('en-US')} ${CURRENCY}` : plan.reason ?? '';
  const sub = plan.cost > 0 && plan.reason && plan.reason !== 'Nothing to change' ? plan.reason : '';
  const bad = !plan.valid;
  const col: RGB = bad ? BAD : sub ? NEON.amber : NEON.cyan;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '600 13px "Chakra Petch", "Share Tech Mono", ui-monospace, monospace';
  const w1 = ctx.measureText(main).width;
  let w2 = 0;
  if (sub) {
    ctx.font = '500 10px "Chakra Petch", "Share Tech Mono", ui-monospace, monospace';
    w2 = ctx.measureText(sub).width;
  }
  const bw = Math.max(w1, w2) + 18;
  const bh = sub ? 34 : 22;
  let x = s.x - bw / 2;
  let y = s.y - 58 - bh;
  x = Math.max(6, Math.min(camera.width - bw - 6, x));
  y = Math.max(6, Math.min(camera.height - bh - 6, y));
  // Leader line to the tile.
  ctx.strokeStyle = css(col, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.max(x + 6, Math.min(x + bw - 6, s.x)), y + bh);
  ctx.lineTo(s.x, s.y - 6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(7,5,18,0.86)';
  roundRect(ctx, x, y, bw, bh, 5);
  ctx.fill();
  ctx.strokeStyle = css(col, 0.9);
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(col, 0.25);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 13px "Chakra Petch", "Share Tech Mono", ui-monospace, monospace';
  ctx.fillStyle = bad ? css([255, 120, 140]) : css([235, 250, 255]);
  ctx.fillText(main, x + bw / 2, y + 11.5);
  if (sub) {
    ctx.font = '500 10px "Chakra Petch", "Share Tech Mono", ui-monospace, monospace';
    ctx.fillStyle = css(col, 0.95);
    ctx.fillText(sub, x + bw / 2, y + 25);
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Selection ──────────────────────────────────────────────────────────────

interface SelectionShape {
  x: number;
  y: number;
  size: number;
  height: number;
  color: RGB;
  radius: number;
}

function selectionShape(game: Game): SelectionShape | null {
  const sel = game.selected;
  if (!sel) return null;
  const world = game.world;
  const t = world.tileAt(sel.x, sel.y);
  if (!t) return null;
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (b) {
      const def = BUILDINGS[b.type];
      return { x: b.x, y: b.y, size: b.size, height: serviceBuildingHeight(b.type, b), color: hexToRgb(def.color), radius: def.effect ? def.radius : 0 };
    }
  }
  const h = t.zone !== ZoneType.None && t.level > 0 ? zoneBuildingHeight(t) : 0;
  return { x: sel.x, y: sel.y, size: 1, height: h, color: NEON.cyan, radius: 0 };
}

/** Ground outline + coverage radius of the selection (before buildings). World transform. */
export function drawSelectionGround(ctx: CanvasRenderingContext2D, game: Game, time: number, zoom: number) {
  const hz = highlight.zone;
  if (hz) {
    // Crackdown confirm (§8.8): the zone the wasps will sweep.
    ctx.save();
    radiusRing(ctx, hz.x, hz.y, hz.r, hz.color, zoom, time);
    radiusRing(ctx, hz.x, hz.y, hz.r * (0.25 + 0.75 * ((time * 0.6) % 1)), hz.color, zoom, time);
    ctx.restore();
  }
  const s = selectionShape(game);
  if (!s) return;
  const pulse = 0.7 + 0.3 * Math.sin(time * 4);
  ctx.save();
  if (s.radius > 0) radiusRing(ctx, s.x + s.size / 2, s.y + s.size / 2, s.radius, s.color, zoom, time);
  toTileSpace(ctx);
  ctx.beginPath();
  ctx.rect(s.x, s.y, s.size, s.size);
  ctx.fillStyle = css(NEON.cyan, 0.1 * pulse);
  ctx.fill();
  glowStroke(ctx, NEON.cyan, zoom, pulse);
  ctx.restore();
}

/** Holographic wireframe box around the selection (after buildings). World transform. */
export function drawSelectionTop(ctx: CanvasRenderingContext2D, game: Game, time: number, zoom: number) {
  const s = selectionShape(game);
  if (!s) return;
  const pulse = 0.6 + 0.4 * Math.sin(time * 4);
  const top = (s.x - s.y) * HALF_W;
  const ty = (s.x + s.y) * HALF_H;
  const z = s.size;
  const R = { x: top + z * HALF_W, y: ty + z * HALF_H };
  const B = { x: top, y: ty + z * 2 * HALF_H };
  const L = { x: top - z * HALF_W, y: ty + z * HALF_H };
  const h = Math.max(10, s.height + 6);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  // Faint vertical light curtain on the two front faces.
  const g = ctx.createLinearGradient(0, B.y, 0, B.y - h);
  g.addColorStop(0, css(NEON.cyan, 0.16 * pulse));
  g.addColorStop(1, css(NEON.cyan, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(L.x, L.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(R.x, R.y);
  ctx.lineTo(R.x, R.y - h);
  ctx.lineTo(B.x, B.y - h);
  ctx.lineTo(L.x, L.y - h);
  ctx.closePath();
  ctx.fill();
  // Corner posts.
  for (const p of [L, B, R]) {
    const pg = ctx.createLinearGradient(0, p.y, 0, p.y - h);
    pg.addColorStop(0, css(NEON.cyan, 0.9 * pulse));
    pg.addColorStop(1, css(NEON.cyan, 0));
    ctx.strokeStyle = pg;
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - h);
    ctx.stroke();
  }
  // Front ground edges on top of the building so the selection always reads.
  ctx.strokeStyle = css(NEON.cyan, 0.45 * pulse);
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  ctx.moveTo(L.x, L.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(R.x, R.y);
  ctx.stroke();
  ctx.restore();
}

// ── Unpowered glyphs ───────────────────────────────────────────────────────

let boltSprite: HTMLCanvasElement | null = null;

function getBolt(): HTMLCanvasElement {
  if (boltSprite) return boltSprite;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // Hex badge.
  g.translate(S / 2, S / 2);
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const r = 26;
    if (k === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = 'rgba(16,6,20,0.92)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = css(NEON.red);
  g.stroke();
  // Bolt.
  g.beginPath();
  g.moveTo(4, -18);
  g.lineTo(-10, 3);
  g.lineTo(-1, 3);
  g.lineTo(-5, 19);
  g.lineTo(11, -4);
  g.lineTo(2, -4);
  g.lineTo(7, -18);
  g.closePath();
  g.fillStyle = css(NEON.yellow);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.stroke();
  boltSprite = c;
  return c;
}

/** Days a block must sit dark before it earns a badge (fresh growth waits for the grid). */
const UNPOWERED_DAYS = 6;

interface DarkState {
  world: World | null;
  tick: number;
  /** Tick each developed tile was first seen unpowered, −1 = powered / not developed. */
  since: Int32Array;
  buildings: Map<number, number>;
}
const dark: DarkState = { world: null, tick: -1, since: new Int32Array(N * N).fill(-1), buildings: new Map() };

/** Track how long each developed tile / service building has been dark (once per sim tick). */
function darkState(world: World): DarkState {
  if (dark.world !== world) {
    dark.world = world;
    dark.tick = -1;
    dark.since.fill(-1);
    dark.buildings.clear();
  }
  if (dark.tick === world.tick) return dark;
  dark.tick = world.tick;
  const since = dark.since;
  const tiles = world.tiles;
  for (let i = 0; i < N * N; i++) {
    const t = tiles[i];
    const off = t.zone !== ZoneType.None && t.level > 0 && !t.abandoned && !t.powered && t.buildingId < 0;
    if (!off) since[i] = -1;
    else if (since[i] < 0) since[i] = world.tick;
  }
  for (const bd of world.buildings.values()) {
    const def = BUILDINGS[bd.type];
    const off = def.powerSupply <= 0 && def.powerUse > 0 && !bd.powered;
    if (!off) dark.buildings.delete(bd.id);
    else if (!dark.buildings.has(bd.id)) dark.buildings.set(bd.id, world.tick);
  }
  for (const id of dark.buildings.keys()) if (!world.buildings.has(id)) dark.buildings.delete(id);
  return dark;
}

/**
 * Gentle "no power" badges over blocks that have been dark for a few days.
 * Close up: one per tile. Zoomed out (< 0.6): one per 4 × 4 cluster (6 × 6 below
 * 0.35), so a browned-out district reads as a few markers, not a carpet.
 * World transform expected.
 */
export function drawUnpowered(ctx: CanvasRenderingContext2D, world: World, b: Rect, time: number, zoom: number, view: Rect) {
  const st = darkState(world);
  const tick = world.tick;
  const blink = 0.62 + 0.22 * Math.sin(time * 2.2);
  const sizeCss = 19 * Math.max(0.55, Math.min(1, zoom / 0.8));
  const size = sizeCss / zoom;
  const bob = Math.sin(time * 1.6) * 1.2;
  const bolt = getBolt();
  const halo = glowSprite(NEON.red, 64);
  const draw = (x: number, y: number) => {
    if (x < view.x0 - size || x > view.x1 + size || y < view.y0 - size || y > view.y1 + size) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.28 * blink;
    ctx.drawImage(halo, x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = blink;
    ctx.drawImage(bolt, x - size / 2, y - size / 2, size, size);
  };
  const longDark = (i: number) => st.since[i] >= 0 && tick - st.since[i] >= UNPOWERED_DAYS;
  ctx.save();
  const cell = zoom < 0.35 ? 6 : zoom < 0.6 ? 4 : 1;
  if (cell === 1) {
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * N + x;
        if (!longDark(i)) continue;
        const t = world.tiles[i];
        const wx = (x - y) * HALF_W;
        const wy = (x + y) * HALF_H + HALF_H;
        draw(wx, wy - zoneBuildingHeight(t) - size * 0.6 + bob);
      }
  } else {
    const cx0 = Math.floor(b.x0 / cell) * cell;
    const cy0 = Math.floor(b.y0 / cell) * cell;
    for (let cy = cy0; cy <= b.y1; cy += cell)
      for (let cx = cx0; cx <= b.x1; cx += cell) {
        // One badge per cluster, on its darkest-for-longest tile.
        let best = -1;
        let bestSince = Infinity;
        let count = 0;
        for (let y = cy; y < cy + cell && y < N; y++)
          for (let x = cx; x < cx + cell && x < N; x++) {
            const i = y * N + x;
            if (!longDark(i)) continue;
            count++;
            if (st.since[i] < bestSince) {
              bestSince = st.since[i];
              best = i;
            }
          }
        if (best < 0 || count < (cell >= 6 ? 2 : 1)) continue;
        const x = best % N;
        const y = (best / N) | 0;
        const t = world.tiles[best];
        draw((x - y) * HALF_W, (x + y) * HALF_H + HALF_H - zoneBuildingHeight(t) - size * 0.6 + bob);
      }
  }
  for (const bd of world.buildings.values()) {
    const s0 = st.buildings.get(bd.id);
    if (s0 === undefined || tick - s0 < UNPOWERED_DAYS) continue;
    if (bd.x + bd.size - 1 < b.x0 || bd.x > b.x1 || bd.y + bd.size - 1 < b.y0 || bd.y > b.y1) continue;
    const cx = bd.x + bd.size / 2;
    const cy = bd.y + bd.size / 2;
    draw((cx - cy) * HALF_W, (cx + cy) * HALF_H - serviceBuildingHeight(bd.type, bd) - size * 0.6 + bob);
  }
  ctx.restore();
}

// ── "No road access" glyphs ────────────────────────────────────────────────

let noRoadSprite: HTMLCanvasElement | null = null;

function getNoRoad(): HTMLCanvasElement {
  if (noRoadSprite) return noRoadSprite;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  // Rounded square badge.
  g.beginPath();
  g.moveTo(-18, -24);
  g.lineTo(18, -24);
  g.quadraticCurveTo(24, -24, 24, -18);
  g.lineTo(24, 18);
  g.quadraticCurveTo(24, 24, 18, 24);
  g.lineTo(-18, 24);
  g.quadraticCurveTo(-24, 24, -24, 18);
  g.lineTo(-24, -18);
  g.quadraticCurveTo(-24, -24, -18, -24);
  g.closePath();
  g.fillStyle = 'rgba(14,8,20,0.92)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = css(NEON.amber);
  g.stroke();
  // Road in perspective with a dashed centre line.
  g.fillStyle = 'rgba(200,205,225,0.9)';
  g.beginPath();
  g.moveTo(-5, -15);
  g.lineTo(5, -15);
  g.lineTo(13, 15);
  g.lineTo(-13, 15);
  g.closePath();
  g.fill();
  g.fillStyle = css(NEON.amber);
  for (let k = 0; k < 3; k++) g.fillRect(-1.2, -12 + k * 10, 2.4, 5);
  // Slash.
  g.strokeStyle = css(NEON.red);
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-15, -15);
  g.lineTo(15, 15);
  g.stroke();
  noRoadSprite = c;
  return c;
}

/**
 * Which tiles have a road within ROAD_ACCESS_RANGE (Chebyshev), as a dilated
 * road mask. Rebuilt lazily after tile changes: two separable passes, ~8k ops.
 */
export class RoadAccessMap {
  private data = new Uint8Array(N * N);
  private tmp = new Uint8Array(N * N);
  private dirty = true;

  invalidate() {
    this.dirty = true;
  }

  get(world: World): Uint8Array {
    if (!this.dirty) return this.data;
    this.dirty = false;
    const r = ROAD_ACCESS_RANGE;
    const tiles = world.tiles;
    const tmp = this.tmp;
    const out = this.data;
    for (let y = 0; y < N; y++) {
      // Sliding count of roads in the horizontal window.
      let count = 0;
      for (let x = 0; x < Math.min(N, r); x++) if (tiles[y * N + x].road) count++;
      for (let x = 0; x < N; x++) {
        const add = x + r;
        const sub = x - r - 1;
        if (add < N && tiles[y * N + add].road) count++;
        if (sub >= 0 && tiles[y * N + sub].road) count--;
        tmp[y * N + x] = count > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < N; x++) {
      let count = 0;
      for (let y = 0; y < Math.min(N, r); y++) count += tmp[y * N + x];
      for (let y = 0; y < N; y++) {
        const add = y + r;
        const sub = y - r - 1;
        if (add < N) count += tmp[add * N + x];
        if (sub >= 0) count -= tmp[sub * N + x];
        out[y * N + x] = count > 0 ? 1 : 0;
      }
    }
    return out;
  }
}

/** Small amber "no road" badges over zoned tiles that cannot develop for lack of road access. */
export function drawNoRoad(ctx: CanvasRenderingContext2D, world: World, access: Uint8Array, b: Rect, time: number, zoom: number, view: Rect) {
  if (zoom < 0.45) return;
  // Mid zoom: a checkerboard of badges is enough to flag the area.
  const sparse = zoom < 0.7;
  const size = 17 / zoom;
  const sprite = getNoRoad();
  ctx.save();
  ctx.globalAlpha = 0.65 + 0.3 * Math.sin(time * 2.4);
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * N + x;
      const t = world.tiles[i];
      if (t.zone === ZoneType.None || access[i]) continue;
      if (sparse && ((x + y) & 1)) continue;
      const wx = (x - y) * HALF_W;
      const wy = (x + y) * HALF_H + HALF_H - (t.level > 0 ? zoneBuildingHeight(t) : 0) - size * 0.7;
      if (wx < view.x0 - size || wx > view.x1 + size || wy < view.y0 - size || wy > view.y1 + size) continue;
      ctx.drawImage(sprite, wx - size / 2, wy - size / 2, size, size);
    }
  ctx.restore();
}
