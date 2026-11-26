// ─────────────────────────────────────────────────────────────────────────────
// Crowds (docs/MEGACITY.md §6.4): small figures on the sidewalks of the visible
// road tiles beside developed Market and Hab tiles.
//
//  * A figure is a body (2 px wide, 2 tall) and a head dot, in one of six
//    colours; in rain it carries an umbrella (a 3 px arc).
//  * Density: per visible sidewalk tile by the Market level beside it (Hab-only
//    streets get a trickle), × the time of day (an evening peak), × the city's
//    population; ≤ 300 figures. City life can double it in its district.
//  * Walkers keep to the sidewalk (0.41 tiles off the road's centre line, on
//    their right) at about 0.3 tiles/s and turn at corners: a right turn hugs
//    the block corner, a left turn crosses the street.
//  * Groups gather beside plazas, Market Halls, stations and the Arena: 3-6
//    figures standing together for a while before they walk off.
//  * Only at zoom ≥ 0.8, high quality, Crowds on and not in lower detail
//    (Effects decides); budget ≤ 0.6 ms. Figures are batched by colour: one
//    path and one fill per colour, so 300 figures cost ~15 fills.
// ─────────────────────────────────────────────────────────────────────────────

import { RoadKind } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import { css, mix, type RGB } from '../palette';
import { SIDE_GATHER, SIDE_HAB, SIDE_HUB, SIDE_MARKET, SIDE_ROAD, STREET_DX as DX, STREET_DY as DY, tileOnScreen, type Bounds, type StreetIndex, type ViewRect } from './traffic';

/** The crowd cap (§6.4). */
export const CROWD_CAP = 300;
/** Crowds draw from this zoom up (§6.4). */
export const CROWD_MIN_ZOOM = 0.8;
const SIDEWALK = 0.41;
/** Figures per unit of sidewalk weight at the evening peak. */
const DENSITY = 7;

const BODY: RGB[] = [
  [232, 64, 150],
  [48, 196, 226],
  [246, 206, 72],
  [236, 236, 244],
  [150, 98, 240],
  [250, 128, 60],
];
const HEAD: RGB = [226, 190, 160];
const UMBRELLA: RGB[] = [
  [255, 60, 180],
  [60, 220, 255],
  [255, 210, 60],
  [140, 90, 255],
  [230, 230, 240],
  [255, 110, 70],
];

interface Walker {
  x: number;
  y: number;
  din: number;
  dout: number;
  t: number;
  len: number;
  speed: number;
  col: number;
  age: number;
  dying: number;
  /** Seconds left standing in a group (0 = walking). */
  stand: number;
  /** Offset inside the group (tile space). */
  ou: number;
  ov: number;
  p0u: number;
  p0v: number;
  c1u: number;
  c1v: number;
  c2u: number;
  c2v: number;
  p1u: number;
  p1v: number;
}

/** What Effects tells the crowds each frame. */
export interface CrowdFrame {
  /** Visual time of day 0..1 (0.75 dusk). */
  tod: number;
  /** The screen in world px (spots off screen are not used). */
  view: ViewRect | null;
  /**
   * City life in this slot (−1: none): double the crowds beside Market tiles (night market) or beside stations and
   * gathering places (arena night); a parade lines its avenues (×3, standing groups).
   */
  boostSlot: number;
  boostHubs: boolean;
  boostAvenue?: boolean;
}

function rand(): number {
  return Math.random();
}

/** Set bits in a 4-bit road mask. */
function bits(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
}

/** The direction of the k-th set bit of a 4-bit road mask. */
function nthBit(m: number, k: number): number {
  for (let d = 0; d < 4; d++) if (m & (1 << d) && k-- === 0) return d;
  return 0;
}

/** Fade levels a figure's alpha snaps to while it fades in or out (each a batched fill per colour). */
const FADE_STEPS = 4;

/** People out at this time of day: an evening peak, a busy day, a quiet night. */
export function crowdTime(tod: number): number {
  if (tod >= 0.7 && tod < 0.9) return 1;
  if (tod >= 0.3 && tod < 0.7) return 0.8 + 0.15 * Math.max(0, (tod - 0.55) / 0.15);
  if (tod >= 0.24 && tod < 0.3) return 0.45;
  if (tod >= 0.9 && tod < 0.97) return 0.55;
  return 0.25;
}

export class Crowds {
  private list: Walker[] = [];
  private pool: number[] = [];
  private gather: number[] = [];
  private target = 0;
  private recount = 0.25;
  private N = 0;
  private nightB = -1;
  private bodyCss: string[] = [];
  private headCss = '';
  private umbCss = UMBRELLA.map((c) => css(c));
  private on = false;
  private w = [0, 0, 0, 0];
  private pu = 0;
  private pv = 0;
  /** Figures drawn last frame (tests, diagnostics). */
  drawn = 0;
  /** Screen spots and colour × fade buckets of this frame's figures (draw scratch). */
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private key = new Int16Array(0);
  private order = new Int16Array(0);
  private bucketStart = new Int32Array(BODY.length * (FADE_STEPS + 1) + 1);
  private bucketFill = new Int32Array(BODY.length * (FADE_STEPS + 1));

  constructor(private readonly index: StreetIndex) {}

  get size(): number {
    return this.list.length;
  }

  get targetCount(): number {
    return this.target;
  }

  reset() {
    this.list.length = 0;
    // Half a recount out of step with the street cars' (both every 0.5 s), so their walks never share a frame.
    this.recount = 0.25;
  }

  /** Tiles changed: recount soon (walkers on a tile that is no longer a road drop at the next recount). */
  invalidate() {
    if (this.recount > 0.25) this.recount = 0.25;
  }

  /** One frame. `on`: crowds allowed now (setting, quality, lower detail, the street view, zoom ≥ 0.8). */
  update(dt: number, world: World, b: Bounds | null, on: boolean, f: CrowdFrame) {
    if (this.N !== world.N) {
      this.N = world.N;
      this.list.length = 0;
    }
    this.on = on;
    if (!on || !b) {
      this.list.length = 0;
      this.recount = 0.25;
      return;
    }
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.5;
      this.count(world, b, f);
      // Walkers on a tile that is no longer a road drop (in place: no new array every recount).
      const list = this.list;
      let n = 0;
      for (let i = 0; i < list.length; i++) if (world.isRoad(list[i].x, list[i].y)) list[n++] = list[i];
      list.length = n;
    }
    this.step(dt, world, b);
    let spawn = Math.min(8, this.target - this.list.length);
    while (spawn-- > 0 && this.pool.length) this.spawn(world);
    // Thin out when over target.
    let excess = this.list.length - this.target;
    for (let i = 0; i < this.list.length && excess > 0; i++) {
      const a = this.list[i];
      if (a.dying > 0) {
        excess--;
        continue;
      }
      if (rand() < 0.04) {
        a.dying = 0.8;
        excess--;
      }
    }
  }

  private count(world: World, b: Bounds, f: CrowdFrame) {
    const N = this.N;
    this.pool.length = 0;
    this.gather.length = 0;
    const x0 = Math.max(0, b.x0);
    const y0 = Math.max(0, b.y0);
    const x1 = Math.min(N - 1, b.x1);
    const y1 = Math.min(N - 1, b.y1);
    if (x1 < x0 || y1 < y0) {
      this.target = 0;
      return;
    }
    this.index.refresh(world, { x0, y0, x1, y1 });
    const side = this.index.side;
    const tiles = world.tiles;
    let sum = 0;
    const boost = f.boostSlot;
    for (let y = y0; y <= y1; y++) {
      let i = y * N + x0;
      for (let x = x0; x <= x1; x++, i++) {
        const s = side[i];
        if (!(s & SIDE_ROAD)) continue;
        const m = s & SIDE_MARKET;
        const hub = s & (SIDE_GATHER | SIDE_HUB);
        if (!m && !(s & SIDE_HAB) && !hub && !(f.boostAvenue && boost >= 0)) continue;
        if (!tileOnScreen(f.view, x, y, 24, 24)) continue;
        // Busy Market streets fill up; tower blocks of homes keep a steady trickle.
        let w = m === 3 ? 2 : m === 2 ? 1.25 : m === 1 ? 0.6 : 0.3;
        if (hub) {
          w += 0.6;
          this.gather.push(i);
        }
        if (boost >= 0 && world.slotAt(x, y) === boost) {
          if (f.boostAvenue) {
            if (tiles[i].roadKind === RoadKind.Avenue) {
              w = w * 3 + 0.6;
              this.gather.push(i);
            }
          } else if (f.boostHubs ? hub : m) w *= 2;
        }
        sum += w;
        this.pool.push(i);
      }
    }
    const popK = Math.pow(Math.min(1, world.stats.population / 15000), 0.6); // ×10 units
    this.target = Math.min(CROWD_CAP, Math.round(sum * DENSITY * crowdTime(f.tod) * popK));
  }

  private step(dt: number, world: World, b: Bounds) {
    const list = this.list;
    const m = 2;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      a.age += dt;
      if (a.dying > 0) {
        a.dying -= dt;
        if (a.dying <= 0) {
          list[i] = list[list.length - 1];
          list.pop();
          continue;
        }
      }
      if (a.stand > 0) {
        a.stand -= dt;
        continue;
      }
      a.t += (a.speed * dt) / a.len;
      while (a.t >= 1) {
        a.t -= 1;
        const nx = a.x + DX[a.dout];
        const ny = a.y + DY[a.dout];
        if (!world.isRoad(nx, ny) || nx < b.x0 - m || nx > b.x1 + m || ny < b.y0 - m || ny > b.y1 + m) {
          list[i] = list[list.length - 1];
          list.pop();
          break;
        }
        a.x = nx;
        a.y = ny;
        a.din = a.dout;
        a.dout = this.exit(world, nx, ny, a.din);
        this.path(a);
      }
    }
  }

  private exit(world: World, x: number, y: number, din: number): number {
    const mask = world.roadMask(x, y);
    const back = (din + 2) & 3;
    const w = this.w;
    let total = 0;
    for (let d = 0; d < 4; d++) {
      w[d] = mask & (1 << d) && d !== back ? (d === din ? 2 : 1) : 0;
      total += w[d];
    }
    if (total <= 0) return back;
    let r = rand() * total;
    for (let d = 0; d < 4; d++) {
      r -= w[d];
      if (r <= 0 && w[d] > 0) return d;
    }
    return din;
  }

  /** The in-tile path on the right-hand sidewalk (entry and exit 0.41 off the centre line). */
  private path(a: Walker) {
    const off = SIDEWALK;
    const cu = a.x + 0.5;
    const cv = a.y + 0.5;
    const di = a.din;
    const dout = a.dout;
    a.p0u = cu - DX[di] * 0.5 - DY[di] * off;
    a.p0v = cv - DY[di] * 0.5 + DX[di] * off;
    a.p1u = cu + DX[dout] * 0.5 - DY[dout] * off;
    a.p1v = cv + DY[dout] * 0.5 + DX[dout] * off;
    let k: number;
    if (dout === di) {
      k = 1 / 3;
      a.len = 1;
    } else if (dout === ((di + 2) & 3)) {
      k = 0.45;
      a.len = Math.PI * off + 0.3;
    } else {
      const right = dout === ((di + 1) & 3);
      const r = right ? 0.5 - off : 0.5 + off;
      k = 0.5523 * r;
      a.len = Math.max(0.15, (Math.PI / 2) * r);
    }
    a.c1u = a.p0u + DX[di] * k;
    a.c1v = a.p0v + DY[di] * k;
    a.c2u = a.p1u - DX[dout] * k;
    a.c2v = a.p1v - DY[dout] * k;
  }

  private spawn(world: World) {
    const N = this.N;
    // A group by a gathering place (a quarter of spawns where there is one), else a walker on the busiest of two picks.
    const grp = this.gather.length > 0 && rand() < 0.25;
    const i = grp ? this.gather[(rand() * this.gather.length) | 0] : this.pick();
    const x = i % N;
    const y = (i / N) | 0;
    const mask = world.roadMask(x, y);
    if (!mask) return;
    const n = grp ? 3 + ((rand() * 4) | 0) : 1;
    const dout = nthBit(mask, (rand() * bits(mask)) | 0);
    const others = mask & ~(1 << dout);
    const sideIn = others ? nthBit(others, (rand() * bits(others)) | 0) : dout;
    const t0 = rand();
    const stand = grp ? 8 + rand() * 14 : 0;
    for (let k = 0; k < n && this.list.length < CROWD_CAP; k++) {
      const a: Walker = {
        x,
        y,
        din: (sideIn + 2) & 3,
        dout,
        t: grp ? Math.min(0.95, Math.max(0.05, t0 + (rand() - 0.5) * 0.35)) : t0,
        len: 1,
        speed: 0.22 + rand() * 0.16,
        col: (rand() * 600) | 0,
        age: 0,
        dying: 0,
        stand: stand * (0.7 + rand() * 0.3),
        ou: grp ? (rand() - 0.5) * 0.16 : 0,
        ov: grp ? (rand() - 0.5) * 0.16 : 0,
        p0u: 0,
        p0v: 0,
        c1u: 0,
        c1v: 0,
        c2u: 0,
        c2v: 0,
        p1u: 0,
        p1v: 0,
      };
      this.path(a);
      this.list.push(a);
    }
  }

  /** A pool tile, the busier (by Market level) of two random picks. */
  private pick(): number {
    const pool = this.pool;
    const side = this.index.side;
    const i = pool[(rand() * pool.length) | 0];
    const j = pool[(rand() * pool.length) | 0];
    return (side[j] & SIDE_MARKET) > (side[i] & SIDE_MARKET) ? j : i;
  }

  private colours(night: number) {
    const b = Math.round(night * 8);
    if (b === this.nightB) return;
    this.nightB = b;
    // Under the street lights and the signs at night: the colours stay bright (a touch toward neon), never lost on the
    // dark asphalt.
    const neon: RGB = [255, 150, 230];
    this.bodyCss = BODY.map((c) => css(mix(c, mix(c, neon, 0.18), night)));
    this.headCss = css(mix(HEAD, [244, 214, 190], night));
  }

  private pos(a: Walker) {
    const t = a.t;
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    this.pu = b0 * a.p0u + b1 * a.c1u + b2 * a.c2u + b3 * a.p1u + a.ou;
    this.pv = b0 * a.p0v + b1 * a.c1v + b2 * a.c2v + b3 * a.p1v + a.ov;
  }

  /** World-space draw (after the ground, before the buildings). */
  draw(ctx: CanvasRenderingContext2D, night: number, rain: number, time: number) {
    this.drawn = 0;
    const list = this.list;
    const n = list.length;
    if (!this.on || !n) return;
    this.colours(night);
    ctx.globalCompositeOperation = 'source-over';
    const nc = BODY.length;
    // Each figure's screen spot once a frame, and its bucket: colour × fade step (fading figures snap to one of
    // FADE_STEPS alphas), so the whole crowd costs ≤ nc × (FADE_STEPS + 1) body fills plus the heads.
    if (this.px.length < n) {
      const m = Math.max(n, CROWD_CAP);
      this.px = new Float32Array(m);
      this.py = new Float32Array(m);
      this.key = new Int16Array(m);
      this.order = new Int16Array(m);
    }
    const px = this.px;
    const py = this.py;
    const key = this.key;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      this.pos(a);
      px[i] = (this.pu - this.pv) * HALF_W;
      py[i] = (this.pu + this.pv) * HALF_H;
      const alpha = Math.min(1, a.age * 1.5) * (a.dying > 0 ? a.dying / 0.8 : 1);
      const step = alpha >= 0.99 ? FADE_STEPS : Math.round(alpha * FADE_STEPS);
      key[i] = step <= 0 ? -1 : (a.col % nc) * (FADE_STEPS + 1) + step;
    }
    // Counting sort by bucket, then one fill per run of a bucket.
    const nk = nc * (FADE_STEPS + 1);
    const start = this.bucketStart;
    start.fill(0);
    for (let i = 0; i < n; i++) if (key[i] >= 0) start[key[i] + 1]++;
    for (let k = 0; k < nk; k++) start[k + 1] += start[k];
    const order = this.order;
    const fillAt = this.bucketFill;
    fillAt.set(start.subarray(0, nk));
    for (let i = 0; i < n; i++) if (key[i] >= 0) order[fillAt[key[i]]++] = i;
    for (let k = 0; k < nk; k++) {
      const a0 = start[k];
      const a1 = start[k + 1];
      if (a1 <= a0) continue;
      const step = k % (FADE_STEPS + 1);
      ctx.globalAlpha = step / FADE_STEPS;
      ctx.beginPath();
      for (let j = a0; j < a1; j++) {
        const i = order[j];
        const a = list[i];
        const bob = a.stand > 0 ? Math.sin(time * 1.3 + a.col) * 0.15 : Math.abs(Math.sin(time * 9 + a.col)) * 0.35;
        ctx.rect(px[i] - 1, py[i] - 2 - bob, 2, 2);
      }
      ctx.fillStyle = this.bodyCss[(k / (FADE_STEPS + 1)) | 0];
      ctx.fill();
      this.drawn += a1 - a0;
    }
    ctx.globalAlpha = 1;
    // Heads (or umbrellas in rain), batched.
    if (rain > 0.2) {
      const nu = this.umbCss.length;
      for (let c = 0; c < nu; c++) {
        let any = false;
        for (let i = 0; i < n; i++) {
          if (key[i] < 0 || list[i].col % nu !== c) continue;
          if (!any) ctx.beginPath();
          any = true;
          const x = px[i];
          const y = py[i] - 3.1;
          ctx.moveTo(x + 1.5, y);
          ctx.arc(x, y, 1.5, 0, Math.PI, true);
          ctx.closePath();
        }
        if (any) {
          ctx.fillStyle = this.umbCss[c];
          ctx.fill();
        }
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < n; i++) if (key[i] >= 0) ctx.rect(px[i] - 0.55, py[i] - 3.1, 1.1, 1.1);
      ctx.fillStyle = this.headCss;
      ctx.fill();
    }
  }
}
