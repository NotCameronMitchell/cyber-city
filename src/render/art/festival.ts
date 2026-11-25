// ─────────────────────────────────────────────────────────────────────────────
// City life visuals (docs/MEGACITY.md §6.4.1): what a happening in
// world.cityEvent looks like while its visual time runs (game/cityEvents.ts
// runs the clocks, the ticker line and the gameplay terms).
//
//   nightmarket  paper lanterns strung over that district's Market streets,
//                stalls on the sidewalks (crowds ×2 there: art/crowds.ts)
//   lanterns     sky lanterns (≤ 60) rising from parks and plazas
//   stormwatch   flood barriers rising on the district's shore, Floodwatch
//                beacons turning, the barriers' warning lights flickering
//   arenanight   searchlights over the Arena (crowds from the stations)
//   kiteday      diamond kites over the Glass Kites' turf
//   parade       floats and confetti along the longest avenue
//
// Everything is prepared once when a happening starts (its slot's tiles),
// culled to the view and capped; budget ≤ 0.4 ms while one runs. Off with
// Settings › City life (nothing runs) and in lower detail (visuals only).
// ─────────────────────────────────────────────────────────────────────────────

import { CITY_LIFE_DEFS, longestAvenue } from '../../game/cityEvents';
import { slotRect } from '../../game/districts/slots';
import { heightOf } from '../../game/heights';
import { hash2 } from '../../game/rng';
import { Terrain, type BuildingType, type CityEventId, type CityEventState } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import { css, glowSprite, type RGB } from '../palette';
import { SIDE_GATHER, SIDE_HAB, SIDE_MARKET, SIDE_ROAD, tileOnScreen, type Bounds, type StreetIndex, type ViewRect } from './traffic';

/** Caps (§6.4.1 and the 0.4 ms budget). */
export const SKY_LANTERN_CAP = 60;
const STRING_CAP = 70;
/** Night market string spans drawn at most (three lanterns each). */
const SPAN_CAP = 96;
const BARRIER_CAP = 160;
const KITE_CAP = 20;
const CONFETTI_CAP = 80;
const FLOATS = 4;

const WARM: RGB[] = [
  [255, 120, 60],
  [255, 200, 90],
  [255, 70, 90],
];
const BRIGHT: RGB[] = [
  [255, 60, 190],
  [60, 220, 255],
  [255, 210, 60],
  [140, 255, 120],
  [170, 110, 255],
  [255, 120, 60],
];
const GATHER = new Set<BuildingType>(['plaza', 'canopypark', 'markethall', 'commons', 'stillsquare', 'pearlatrium', 'memorial']);

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  c: number;
}

function rand(): number {
  return Math.random();
}

function beam(c: RGB): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 40;
  cv.height = 220;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 220, 0, 0);
  grad.addColorStop(0, css(c, 0.5));
  grad.addColorStop(0.4, css(c, 0.18));
  grad.addColorStop(1, css(c, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(18, 220);
  g.lineTo(22, 220);
  g.lineTo(40, 0);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();
  return cv;
}

export class Festival {
  private key = '';
  private id: CityEventId | null = null;
  /** Prepared tiles of the happening (indices), and for barriers their water side (0 N, 1 E, 2 S, 3 W). */
  private tiles: number[] = [];
  private dirs: number[] = [];
  /** Points (tile coords, pairs): lantern sources, Floodwatch stations, the Arena, kite anchors. */
  private points: number[] = [];
  private avenue: { x0: number; y0: number; x1: number; y1: number; len: number } | null = null;
  private parts: Particle[] = [];
  private confetti: Particle[] = [];
  private spawnAcc = 0;
  private glows: HTMLCanvasElement[] | null = null;
  private brightGlows: HTMLCanvasElement[] | null = null;
  private beams: HTMLCanvasElement[] | null = null;
  private brightCss = BRIGHT.map((c) => css(c));
  private warmCss = WARM.map((c) => css(c));
  private on = false;
  private ev: CityEventState | null = null;
  private bounds: Bounds | null = null;
  private view: ViewRect | null = null;
  /** Scratch: the night market's visible street tiles and its string spans (u0, v0, u1, v1). */
  private vis: number[] = [];
  private spans: number[] = [];
  /** Night market street tiles behind a tall body (lanterns there would float over its roof), memoised per happening. */
  private behind = new Map<number, boolean>();
  /** Things drawn last frame (tests). */
  drawn = 0;

  get active(): CityEventId | null {
    return this.on ? this.id : null;
  }

  /** Sky lanterns aloft (tests). */
  get lanterns(): number {
    return this.id === 'lanterns' ? this.parts.length : 0;
  }

  reset() {
    this.key = '';
    this.id = null;
    this.parts.length = 0;
    this.confetti.length = 0;
  }

  /** One frame. `on`: City life visuals allowed (Settings › City life, not lower detail). */
  update(dt: number, world: World, ev: CityEventState | null, b: Bounds | null, index: StreetIndex, on: boolean, view: ViewRect | null = null) {
    this.on = on && !!ev && !!b;
    this.ev = ev;
    this.bounds = b;
    this.view = view;
    if (!this.on || !ev || !b) {
      this.parts.length = 0;
      this.confetti.length = 0;
      if (!ev) this.key = '';
      return;
    }
    const key = `${ev.id}@${ev.slot ?? -1}@${world.seed}@${world.N}`;
    if (key !== this.key) {
      this.key = key;
      this.prepare(world, ev, index);
    }
    const t = this.elapsed(ev);
    if (ev.id === 'lanterns') this.stepLanterns(dt, world, b, ev);
    if (ev.id === 'parade') this.stepConfetti(dt, t);
  }

  private elapsed(ev: CityEventState): number {
    return CITY_LIFE_DEFS[ev.id].sec - ev.until;
  }

  /** 0 → 1 over the first 4 s, back to 0 over the last 4 s. */
  private envelope(ev: CityEventState): number {
    return Math.max(0, Math.min(1, this.elapsed(ev) / 4, ev.until / 4));
  }

  private prepare(world: World, ev: CityEventState, index: StreetIndex) {
    this.id = ev.id;
    this.behind.clear();
    this.tiles.length = 0;
    this.dirs.length = 0;
    this.points.length = 0;
    this.parts.length = 0;
    this.confetti.length = 0;
    this.avenue = null;
    const N = world.N;
    const slot = ev.slot ?? -1;
    const r = slot >= 0 ? slotRect(world, slot) : world.ownedBox;
    switch (ev.id) {
      case 'nightmarket': {
        index.refresh(world, r);
        const side = index.side;
        for (let y = r.y0; y <= r.y1; y++)
          for (let x = r.x0; x <= r.x1; x++) {
            const i = y * N + x;
            // The district's lived-in streets and alleys: Market streets first, then the rest.
            if (side[i] & SIDE_ROAD && side[i] & (SIDE_MARKET | SIDE_HAB | SIDE_GATHER)) (side[i] & SIDE_MARKET ? this.tiles : this.dirs).push(i);
          }
        // Market streets first (dirs held the others for a moment).
        for (const i of this.dirs) this.tiles.push(i);
        this.dirs.length = 0;
        break;
      }
      case 'lanterns': {
        for (const bd of world.buildings.values()) if (GATHER.has(bd.type)) this.points.push(bd.x + bd.size / 2, bd.y + bd.size / 2);
        break;
      }
      case 'stormwatch': {
        for (let y = r.y0; y <= r.y1; y++)
          for (let x = r.x0; x <= r.x1; x++) {
            const t = world.tiles[y * N + x];
            if (t.terrain !== Terrain.Land || !world.isOwned(x, y)) continue;
            for (let d = 0; d < 4; d++) {
              const n = world.tileAt(x + [0, 1, 0, -1][d], y + [-1, 0, 1, 0][d]);
              if (n && n.terrain === Terrain.Water && !n.road) {
                this.tiles.push(y * N + x);
                this.dirs.push(d);
                break;
              }
            }
          }
        for (const bd of world.buildings.values()) if (bd.type === 'floodwatch' && world.slotAt(bd.x, bd.y) === slot) this.points.push(bd.x + bd.size / 2, bd.y + bd.size / 2);
        break;
      }
      case 'arenanight': {
        for (const bd of world.buildings.values()) if (bd.type === 'arena') this.points.push(bd.x + bd.size / 2, bd.y + bd.size / 2, bd.size);
        break;
      }
      case 'kiteday': {
        const owner = world.turf?.owner;
        if (owner) {
          let seen = 0;
          for (let y = r.y0; y <= r.y1; y++)
            for (let x = r.x0; x <= r.x1; x++)
              if (owner[y * N + x] === 2 && (x & 1) === 0 && (y & 1) === 0) {
                // Reservoir sample of anchors.
                seen++;
                if (this.points.length < KITE_CAP * 6 * 2) this.points.push(x, y);
                else if (rand() * seen < KITE_CAP * 6) {
                  const k = ((rand() * KITE_CAP * 6) | 0) * 2;
                  this.points[k] = x;
                  this.points[k + 1] = y;
                }
              }
        }
        break;
      }
      case 'parade':
        // The longest avenue run in the parade's district (one district's walk; the whole city's is City life's).
        this.avenue = longestAvenue(world, r);
        break;
    }
  }

  /**
   * Is the street tile `i` hidden behind a body in front of it (south and east on screen)? Its lanterns hang 12 px up:
   * a neighbour in front over 24 px, or the one two tiles in front over 56 px, would cover them.
   */
  private hidden(world: World, i: number): boolean {
    let h = this.behind.get(i);
    if (h === undefined) {
      const N = world.N;
      const x = i % N;
      const y = (i / N) | 0;
      h = heightOf(world, x + 1, y + 1) > 24 || heightOf(world, x + 1, y) > 30 || heightOf(world, x, y + 1) > 30 || heightOf(world, x + 2, y + 2) > 56;
      this.behind.set(i, h);
    }
    return h;
  }

  /** On screen (the view rect, `m` tiles of margin), else inside the tile bounds. */
  private visible(u: number, v: number, m = 2): boolean {
    if (this.view) return tileOnScreen(this.view, u, v, m * HALF_W, m * HALF_H * 2);
    const b = this.bounds!;
    return u >= b.x0 - m && u <= b.x1 + m && v >= b.y0 - m && v <= b.y1 + m;
  }

  private stepLanterns(dt: number, world: World, b: Bounds, ev: CityEventState) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      p.y += p.vy * dt;
      p.x += Math.sin(p.age * 0.8 + p.c) * 3 * dt + p.vx * dt;
      if (p.age >= p.life) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
      }
    }
    if (ev.until < 8) return;
    // A first flight of lanterns, then a steady trickle.
    this.spawnAcc += dt * (this.elapsed(ev) < 6 ? 9 : 3);
    while (this.spawnAcc >= 1 && ps.length < SKY_LANTERN_CAP) {
      this.spawnAcc -= 1;
      // From a park or plaza in view, else from the water's edge or any owned tile in view.
      let u = -1;
      let v = -1;
      const pts = this.points;
      for (let k = 0; k < 6 && u < 0 && pts.length; k++) {
        const j = ((rand() * (pts.length / 2)) | 0) * 2;
        if (this.visible(pts[j], pts[j + 1], 0)) {
          u = pts[j] + (rand() - 0.5) * 2;
          v = pts[j + 1] + (rand() - 0.5) * 2;
        }
      }
      for (let k = 0; k < 6 && u < 0; k++) {
        const x = b.x0 + ((rand() * (b.x1 - b.x0 + 1)) | 0);
        const y = b.y0 + ((rand() * (b.y1 - b.y0 + 1)) | 0);
        if (!world.isOwned(x, y) || !this.visible(x, y, 0)) continue;
        u = x + 0.5;
        v = y + 0.5;
      }
      if (u < 0) continue;
      ps.push({ x: (u - v) * HALF_W, y: (u + v) * HALF_H - 4, vx: (rand() - 0.5) * 4, vy: -(7 + rand() * 7), age: 0, life: 14 + rand() * 8, c: (rand() * 100) | 0 });
    }
    if (this.spawnAcc > 1) this.spawnAcc = 1;
  }

  private stepConfetti(dt: number, t: number) {
    const cs = this.confetti;
    for (let i = cs.length - 1; i >= 0; i--) {
      const p = cs[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 18 * dt;
      if (p.age >= p.life) {
        cs[i] = cs[cs.length - 1];
        cs.pop();
      }
    }
    const a = this.avenue;
    if (!a) return;
    for (let f = 0; f < FLOATS && cs.length < CONFETTI_CAP; f++) {
      if (rand() > dt * 12) continue;
      const [u, v] = this.floatAt(a, t, f);
      if (!this.visible(u, v)) continue;
      cs.push({ x: (u - v) * HALF_W + (rand() - 0.5) * 10, y: (u + v) * HALF_H - 14, vx: (rand() - 0.5) * 14, vy: -6 - rand() * 10, age: 0, life: 1.8 + rand(), c: (rand() * BRIGHT.length) | 0 });
    }
  }

  /** A float's position (tile space) along the avenue: from its middle (the place the ticker names) they ride end to end and back, a few tiles apart. */
  private floatAt(a: { x0: number; y0: number; x1: number; y1: number; len: number }, t: number, f: number): [number, number] {
    const span = Math.max(1, a.len - 1);
    const s = (t * 0.35 - f * 2.4 + span * 4.5) % (span * 2);
    const k = s <= span ? s : span * 2 - s;
    const horiz = a.y0 === a.y1;
    return horiz ? [a.x0 + 0.5 + k, a.y0 + 0.5] : [a.x0 + 0.5, a.y0 + 0.5 + k];
  }

  /** Ground part (after the ground, before the buildings): lantern strings and stalls, flood barriers, parade floats. */
  drawGround(ctx: CanvasRenderingContext2D, world: World, time: number, night: number, zoom: number) {
    this.drawn = 0;
    const ev = this.ev;
    if (!this.on || !ev || zoom < 0.45) return;
    this.glows ??= WARM.map((c) => glowSprite(c, 32));
    this.brightGlows ??= BRIGHT.map((c) => glowSprite(c, 32));
    const env = this.envelope(ev);
    if (env <= 0.01) return;
    const N = world.N;
    if (ev.id === 'nightmarket') {
      // Stalls: an awning on the sidewalk of some Market streets (the strings of lanterns hang in the sky pass).
      let n = 0;
      for (const i of this.tiles) {
        if (n >= STRING_CAP) break;
        const x = i % N;
        const y = (i / N) | 0;
        if (!this.visible(x, y, 1)) continue;
        n++;
        const h = hash2(x, y, 61);
        if (h >= 0.3) continue;
        const su = x + 0.15 + h;
        const sv = y + 0.85;
        const px = (su - sv) * HALF_W;
        const py = (su + sv) * HALF_H;
        ctx.globalAlpha = env;
        ctx.fillStyle = this.brightCss[((h * 60) | 0) % BRIGHT.length];
        ctx.fillRect(px - 2.5, py - 4, 5, 1.5);
        ctx.fillStyle = '#2a2030';
        ctx.fillRect(px - 2.2, py - 2.5, 4.4, 2.5);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = env * (0.3 + 0.5 * night);
        ctx.drawImage(this.glows[1], px - 5, py - 5, 10, 8);
        ctx.globalCompositeOperation = 'source-over';
        this.drawn++;
      }
    } else if (ev.id === 'stormwatch') {
      // Barriers rise along the water-facing edge of each shore tile in view.
      const rise = 9 * env;
      let n = 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = night > 0.5 ? '#8a6a2a' : '#c8962e';
      ctx.beginPath();
      const lights: number[] = [];
      const lightsAt: number[] = [];
      for (let k = 0; k < this.tiles.length && n < BARRIER_CAP; k++) {
        const i = this.tiles[k];
        const x = i % N;
        const y = (i / N) | 0;
        if (!this.visible(x, y, 1)) continue;
        n++;
        const d = this.dirs[k];
        const e = [
          [x, y, x + 1, y],
          [x + 1, y, x + 1, y + 1],
          [x, y + 1, x + 1, y + 1],
          [x, y, x, y + 1],
        ][d];
        const ax = (e[0] - e[1]) * HALF_W;
        const ay = (e[0] + e[1]) * HALF_H;
        const bx = (e[2] - e[3]) * HALF_W;
        const by = (e[2] + e[3]) * HALF_H;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx, by - rise);
        ctx.lineTo(ax, ay - rise);
        ctx.closePath();
        lights.push((ax + bx) / 2, (ay + by) / 2 - rise);
        lightsAt.push(k);
      }
      ctx.fill();
      // A dark band along the foot and a bright cap along the top of each barrier.
      ctx.strokeStyle = night > 0.5 ? '#ffcf5a' : '#ffe08a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let k = 0; k < lights.length; k += 2) {
        const i = this.tiles[lightsAt[k / 2]];
        const d = this.dirs[lightsAt[k / 2]];
        const x = i % N;
        const y = (i / N) | 0;
        const e = [
          [x, y, x + 1, y],
          [x + 1, y, x + 1, y + 1],
          [x, y + 1, x + 1, y + 1],
          [x, y, x, y + 1],
        ][d];
        ctx.moveTo((e[0] - e[1]) * HALF_W, (e[0] + e[1]) * HALF_H - rise);
        ctx.lineTo((e[2] - e[3]) * HALF_W, (e[2] + e[3]) * HALF_H - rise);
      }
      ctx.stroke();
      // Amber caps and warning lights that flicker.
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < lights.length; k += 2) {
        const on = Math.sin(time * 6 + k * 0.9) > -0.2;
        if (!on) continue;
        ctx.globalAlpha = env * (0.5 + 0.5 * night);
        ctx.drawImage(this.glows[1], lights[k] - 2.5, lights[k + 1] - 2.5, 5, 5);
      }
      this.drawn += lights.length / 2;
      ctx.globalCompositeOperation = 'source-over';
    } else if (ev.id === 'parade' && this.avenue) {
      const t = this.elapsed(ev);
      for (let f = 0; f < FLOATS; f++) {
        const [u, v] = this.floatAt(this.avenue, t, f);
        if (!this.visible(u, v)) continue;
        const x = (u - v) * HALF_W;
        const y = (u + v) * HALF_H;
        const c = (f * 2 + 1) % BRIGHT.length;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = env;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x - 9, y - 2, 18, 4);
        ctx.fillStyle = this.brightCss[c];
        ctx.fillRect(x - 8, y - 9, 16, 7);
        ctx.fillStyle = this.brightCss[(c + 2) % BRIGHT.length];
        ctx.fillRect(x - 5, y - 15, 10, 6);
        ctx.fillRect(x - 0.4, y - 21, 0.8, 6);
        ctx.fillStyle = this.brightCss[(c + 4) % BRIGHT.length];
        ctx.fillRect(x + 0.4, y - 21, 4, 2.4);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = env * (0.35 + 0.5 * night);
        ctx.drawImage(this.brightGlows[c], x - 12, y - 22, 24, 24);
        this.drawn++;
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const p of this.confetti) {
        ctx.globalAlpha = env * Math.min(1, (p.life - p.age) * 2);
        ctx.fillStyle = this.brightCss[p.c];
        ctx.fillRect(p.x, p.y, 1.2, 0.8);
        this.drawn++;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Sky part (after the buildings): sky lanterns, beacons, searchlights, kites. */
  drawSky(ctx: CanvasRenderingContext2D, world: World, time: number, night: number, zoom: number) {
    const ev = this.ev;
    if (!this.on || !ev) return;
    this.glows ??= WARM.map((c) => glowSprite(c, 32));
    this.brightGlows ??= BRIGHT.map((c) => glowSprite(c, 32));
    const env = this.envelope(ev);
    if (env <= 0.01) return;
    const N = world.N;
    if (ev.id === 'nightmarket') {
      // Paper lanterns on strings that follow the district's streets from tile to tile (a festoon along each run,
      // sagging between the tile edges), three lanterns a tile; every few tiles a string crosses the street. Drawn in
      // the sky pass so the building just behind a street does not hide them; a street behind a tall body is skipped.
      const vis = this.vis;
      vis.length = 0;
      for (const i of this.tiles) {
        if (vis.length >= STRING_CAP) break;
        const x = i % N;
        const y = (i / N) | 0;
        if (this.visible(x, y, 1) && !this.hidden(world, i)) vis.push(i);
      }
      const spans = this.spans;
      spans.length = 0;
      for (const i of vis) {
        if (spans.length >= SPAN_CAP * 4) break;
        const x = i % N;
        const y = (i / N) | 0;
        const mask = world.roadMask(x, y);
        const ew = (mask & 10) !== 0;
        const ns = (mask & 5) !== 0;
        // Along the street: east-west runs at mid v, north-south runs at mid u (both at a crossing).
        if (ew || !ns) spans.push(x, y + 0.5, x + 1, y + 0.5);
        if (ns) spans.push(x + 0.5, y, x + 0.5, y + 1);
        // Across the street now and then.
        if (hash2(x, y, 67) < 0.22) {
          if (ew && !ns) spans.push(x + 0.5, y + 0.05, x + 0.5, y + 0.95);
          else if (ns && !ew) spans.push(x + 0.05, y + 0.5, x + 0.95, y + 0.5);
        }
      }
      const LIFT = 12;
      const SAG = 3;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = env * 0.8;
      ctx.strokeStyle = night > 0.5 ? '#a0705a' : '#3a2a34';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let k = 0; k < spans.length; k += 4) {
        const ax = (spans[k] - spans[k + 1]) * HALF_W;
        const ay = (spans[k] + spans[k + 1]) * HALF_H - LIFT;
        const bx = (spans[k + 2] - spans[k + 3]) * HALF_W;
        const by = (spans[k + 2] + spans[k + 3]) * HALF_H - LIFT;
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + SAG * 2, bx, by);
      }
      ctx.stroke();
      // Glows first (one composite switch), then the paper bodies batched by colour.
      ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 1 + WARM.length; pass++) {
        if (pass === 1) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = env;
        }
        if (pass > 0) ctx.beginPath();
        for (let k = 0; k < spans.length; k += 4) {
          const u0 = spans[k];
          const v0 = spans[k + 1];
          const du = spans[k + 2] - u0;
          const dv = spans[k + 3] - v0;
          const seed = ((u0 * 7) | 0) + ((v0 * 13) | 0);
          for (let j = 0; j < 3; j++) {
            const f = (j + 0.5) / 3;
            const u = u0 + du * f;
            const v = v0 + dv * f;
            const px = (u - v) * HALF_W;
            const py = (u + v) * HALF_H - LIFT + SAG * 4 * f * (1 - f);
            const c = (seed + j) % WARM.length;
            if (pass === 0) {
              const flick = 0.8 + 0.2 * Math.sin(time * 3 + seed * 1.7 + j);
              ctx.globalAlpha = env * (0.45 + 0.55 * night) * flick;
              ctx.drawImage(this.glows[c], px - 5, py - 4.5, 10, 10);
            } else if (c === pass - 1) {
              ctx.rect(px - 1, py - 1.2, 2, 2.6);
              this.drawn++;
            }
          }
        }
        if (pass > 0) {
          ctx.fillStyle = this.warmCss[pass - 1];
          ctx.fill();
        }
      }
    } else if (ev.id === 'lanterns') {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.parts) {
        const fade = Math.min(1, p.age / 1.5, (p.life - p.age) / 3);
        ctx.globalAlpha = env * fade * (0.6 + 0.4 * night);
        ctx.drawImage(this.glows[p.c % 2], p.x - 8, p.y - 8, 16, 16);
        ctx.globalAlpha = env * fade;
        ctx.fillStyle = '#ffd890';
        ctx.fillRect(p.x - 1.1, p.y - 1.6, 2.2, 2.8);
        this.drawn++;
      }
    } else if (ev.id === 'stormwatch' || ev.id === 'arenanight') {
      this.beams ??= [beam([255, 190, 80]), beam([255, 80, 200]), beam([90, 220, 255]), beam([235, 240, 255])];
      const pts = this.points;
      const step = ev.id === 'arenanight' ? 3 : 2;
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < pts.length; k += step) {
        const u = pts[k];
        const v = pts[k + 1];
        if (!this.visible(u, v, 6)) continue;
        const x = (u - v) * HALF_W;
        const y = (u + v) * HALF_H;
        if (ev.id === 'stormwatch') {
          // A Floodwatch beacon turning: one amber beam swinging round, a pulse at its foot.
          const a = time * 1.8 + k;
          ctx.save();
          ctx.translate(x, y - 30);
          ctx.rotate(Math.sin(a) * 1.3);
          ctx.globalAlpha = env * 0.5;
          ctx.drawImage(this.beams[0], -20, -160, 40, 160);
          ctx.restore();
          ctx.globalAlpha = env * (0.6 + 0.4 * Math.sin(time * 7));
          ctx.drawImage(this.glows[1], x - 6, y - 36, 12, 12);
        } else {
          // Arena searchlights: four beams from the roof rim.
          const s = pts[k + 2] ?? 4;
          for (let j = 0; j < 4; j++) {
            const a = Math.sin(time * (0.5 + j * 0.13) + j * 1.7) * 0.7 + (j - 1.5) * 0.25;
            const ox = (j - 1.5) * s * 6;
            ctx.save();
            ctx.translate(x + ox, y - 26);
            ctx.rotate(a);
            ctx.globalAlpha = env * (0.35 + 0.35 * night);
            ctx.drawImage(this.beams[1 + (j % 3)], -26, -260, 52, 260);
            ctx.restore();
          }
          ctx.globalAlpha = env * 0.5 * (0.7 + 0.3 * Math.sin(time * 4));
          ctx.drawImage(this.brightGlows[1], x - 30, y - 50, 60, 40);
        }
        this.drawn++;
      }
    } else if (ev.id === 'kiteday' && zoom >= 0.45) {
      const pts = this.points;
      const kites: number[] = [];
      for (let k = 0; k < pts.length && kites.length < KITE_CAP * 2; k += 6) {
        if (this.visible(pts[k], pts[k + 1], 3)) kites.push(pts[k], pts[k + 1]);
      }
      if (!kites.length) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = env * 0.6;
      ctx.strokeStyle = night > 0.5 ? '#8a86a0' : '#f4f0e8';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      const pos: number[] = [];
      for (let k = 0; k < kites.length; k += 2) {
        const u = kites[k] + 0.5;
        const v = kites[k + 1] + 0.5;
        const gx = (u - v) * HALF_W;
        const gy = (u + v) * HALF_H;
        const h = hash2(kites[k], kites[k + 1], 71);
        const kx = gx + 14 + Math.sin(time * 0.9 + h * 9) * 4;
        const ky = gy - 46 - h * 26 + Math.cos(time * 1.3 + h * 7) * 2;
        ctx.moveTo(gx, gy - 2);
        ctx.quadraticCurveTo(gx + 10, gy - 20, kx, ky + 4);
        pos.push(kx, ky, h);
      }
      ctx.stroke();
      for (let k = 0; k < pos.length; k += 3) {
        const kx = pos[k];
        const ky = pos[k + 1];
        const c = ((pos[k + 2] * 60) | 0) % BRIGHT.length;
        const tilt = Math.sin(time * 1.1 + pos[k + 2] * 5) * 0.25;
        ctx.globalAlpha = env;
        ctx.fillStyle = this.brightCss[c];
        ctx.beginPath();
        ctx.moveTo(kx + tilt * 4, ky - 5);
        ctx.lineTo(kx + 3.5, ky);
        ctx.lineTo(kx - tilt * 4, ky + 5);
        ctx.lineTo(kx - 3.5, ky);
        ctx.closePath();
        ctx.fill();
        // A ribbon tail.
        ctx.strokeStyle = this.brightCss[(c + 3) % BRIGHT.length];
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(kx, ky + 5);
        ctx.quadraticCurveTo(kx - 3 + Math.sin(time * 4 + k) * 2, ky + 9, kx - 1, ky + 13);
        ctx.stroke();
        this.drawn++;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
