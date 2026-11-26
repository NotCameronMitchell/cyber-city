// ─────────────────────────────────────────────────────────────────────────────
// Boats (docs/MEGACITY.md §6.4): water taxis and barges on the canals and
// channels of owned water (the Sunk, Reedmere, Saltglass Shoals, the harbour),
// and ferries between the Shoals' islands.
//
//  * Navigable water: an owned Water tile with no bridge deck and no rail on
//    it, kept per tile and refreshed per 8×8 block (a 'tiles' event flags the
//    blocks it touches; a block is recomputed when a route or the view needs
//    it), so nothing walks the whole map (R0).
//  * Each boat is routed: from a visible navigable tile, a breadth-first search
//    inside its district picks a destination 8-40 tiles of water away and the
//    boat follows the path tile centre to tile centre, easing round corners.
//    Taxis are quick and lit, barges long and slow with cargo, ferries (Shoals)
//    run between two landings and wait at each. A short wake trails behind.
//  * ≤ 24 visible (≤ 8 in lower detail; none at low quality, Effects decides);
//    budget ≤ 0.2 ms.
// ─────────────────────────────────────────────────────────────────────────────

import { slotRect } from '../../game/districts/slots';
import { Terrain } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import { css, glowSprite, mix, type RGB } from '../palette';
import { RECOUNT_MIN_FRAMES, tileOnScreen, type Bounds, type ViewRect } from './traffic';

/** Visible boats at most (§6.4), and in lower detail (§3.11). */
export const BOAT_CAP = 24;
export const BOAT_CAP_LOW_DETAIL = 8;

const enum BoatKind {
  Taxi = 0,
  Barge = 1,
  Ferry = 2,
}

const LEN = [0.24, 0.42, 0.36];
const WID = [0.085, 0.13, 0.12];
/** The hull outline (bow, two shoulders, stern corners) in boat units: along × LEN, across × WID. */
const HULL_SHAPE = [1.15, 0, 0.45, 1, -1, 0.9, -1, -0.9, 0.45, -1];
const HULL_PTS = 5;
const SPEED = [0.95, 0.32, 0.55];
const HULL: RGB[] = [
  [236, 196, 60],
  [150, 74, 52],
  [226, 230, 238],
];
const DECK: RGB[] = [
  [40, 44, 62],
  [96, 60, 44],
  [60, 120, 170],
];
const CARGO: RGB[] = [
  [190, 70, 60],
  [60, 120, 170],
  [210, 160, 50],
  [70, 150, 100],
];

interface Boat {
  kind: BoatKind;
  /** Path as tile indices; `k` the segment (from path[k] to path[k + 1]), `t` 0..1 along it. */
  path: Int32Array;
  k: number;
  t: number;
  speed: number;
  /** Seconds waiting at a landing (ferries). */
  wait: number;
  age: number;
  dying: number;
  col: number;
  /** Ferries: legs left before it fades. */
  legs: number;
  /** Smoothed heading (tile space). */
  hu: number;
  hv: number;
  /** Position (tile space) this frame. */
  u: number;
  v: number;
}

function rand(): number {
  return Math.random();
}

export class Boats {
  private nav = new Uint8Array(0);
  private stale = new Uint8Array(0);
  private bw = 0;
  private world: World | null = null;
  private list: Boat[] = [];
  private visWater: number[] = [];
  private recount = 0;
  /** The bounds and view of the last visible-water scan, and whether the water changed since (a scan only when either did). */
  private visKey = '';
  private navDirty = true;
  /** Frames since the last recount (RECOUNT_MIN_FRAMES). */
  private sinceCount = RECOUNT_MIN_FRAMES;
  private cap = BOAT_CAP;
  private N = 0;
  /** BFS scratch (per slot). */
  private dist = new Int16Array(0);
  private prev = new Int32Array(0);
  private queue = new Int32Array(0);
  private nightB = -1;
  private hullCss: string[] = [];
  private deckCss: string[] = [];
  private cargoCss: string[] = CARGO.map((c) => css(c));
  private glow: HTMLCanvasElement | null = null;
  private sideCss: string[] = [];
  /** Hull outline points of each boat this frame (screen-space x, y; HULL_PTS a boat) and its alpha. */
  private hulls = new Float32Array(0);
  private alphas = new Float32Array(0);
  /** Boats drawn last frame (tests). */
  drawn = 0;
  /** Blocks recomputed since construction (tests: R0). */
  refreshed = 0;

  get size(): number {
    return this.list.length;
  }

  /** Boats of each kind (tests). */
  kindCounts(): number[] {
    const out = [0, 0, 0];
    for (const b of this.list) out[b.kind]++;
    return out;
  }

  reset() {
    this.list.length = 0;
    this.recount = 0;
    this.sinceCount = RECOUNT_MIN_FRAMES;
    this.world = null;
  }

  private bind(world: World) {
    this.world = world;
    this.N = world.N;
    this.nav = new Uint8Array(world.area);
    this.bw = (world.N + 7) >> 3;
    this.stale = new Uint8Array(this.bw * this.bw).fill(1);
    this.list.length = 0;
    this.navDirty = true;
  }

  /** Tiles changed in `r` (a bridge, rail, a pumped canal): flag its blocks. */
  invalidate(world: World, r?: Bounds) {
    if (world !== this.world || this.nav.length !== world.area) {
      this.bind(world);
      return;
    }
    this.navDirty = true;
    if (!r) {
      this.stale.fill(1);
      return;
    }
    const N = world.N;
    const bw = this.bw;
    const bx0 = Math.max(0, r.x0) >> 3;
    const by0 = Math.max(0, r.y0) >> 3;
    const bx1 = Math.min(N - 1, r.x1) >> 3;
    const by1 = Math.min(N - 1, r.y1) >> 3;
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) this.stale[by * bw + bx] = 1;
  }

  private refresh(world: World, x0: number, y0: number, x1: number, y1: number) {
    const N = world.N;
    const bw = this.bw;
    const nav = this.nav;
    for (let by = Math.max(0, y0) >> 3; by <= Math.min(N - 1, y1) >> 3; by++)
      for (let bx = Math.max(0, x0) >> 3; bx <= Math.min(N - 1, x1) >> 3; bx++) {
        const k = by * bw + bx;
        if (!this.stale[k]) continue;
        this.stale[k] = 0;
        this.refreshed++;
        const ex = Math.min(N, (bx + 1) << 3);
        const ey = Math.min(N, (by + 1) << 3);
        for (let y = by << 3; y < ey; y++)
          for (let x = bx << 3; x < ex; x++) {
            const i = y * N + x;
            const t = world.tiles[i];
            nav[i] = t.terrain === Terrain.Water && !t.road && world.rail[i] === 0 && world.ownedAt(i) ? 1 : 0;
          }
      }
  }

  /** One frame. `cap`: visible boats allowed (0 = off). */
  update(dt: number, world: World, b: Bounds | null, cap: number, view: ViewRect | null = null) {
    if (world !== this.world || this.nav.length !== world.area) this.bind(world);
    this.cap = cap;
    if (cap <= 0 || !b) {
      this.list.length = 0;
      return;
    }
    const N = this.N;
    this.recount -= dt;
    this.sinceCount++;
    if (this.recount <= 0 && this.sinceCount >= RECOUNT_MIN_FRAMES) {
      this.recount = 1;
      this.sinceCount = 0;
      const x0 = Math.max(0, b.x0);
      const y0 = Math.max(0, b.y0);
      const x1 = Math.min(N - 1, b.x1);
      const y1 = Math.min(N - 1, b.y1);
      // The same view over the same water: the last scan still holds (a still camera costs nothing a second).
      const key = view ? `${x0},${y0},${x1},${y1},${Math.round(view.x0 / 16)},${Math.round(view.y0 / 16)},${Math.round(view.x1 / 16)},${Math.round(view.y1 / 16)}` : `${x0},${y0},${x1},${y1}`;
      const fresh = key !== this.visKey || this.navDirty;
      this.visKey = key;
      this.navDirty = false;
      if (fresh) this.visWater.length = 0;
      if (fresh && x1 >= x0 && y1 >= y0) {
        this.refresh(world, x0, y0, x1, y1);
        // A navigable tile with water ahead in a line (a channel, not a puddle), every other tile.
        for (let y = y0; y <= y1; y++)
          for (let x = x0 + (y & 1); x <= x1; x += 2) {
            const i = y * N + x;
            if (this.nav[i] && this.degree(x, y) >= 2 && tileOnScreen(view, x, y, 0, 0)) this.visWater.push(i);
          }
      }
      // Drop boats whose path crosses water that is no longer navigable (a new bridge).
      if (fresh)
        this.list = this.list.filter((bt) => {
        for (let k = bt.k; k < bt.path.length; k++) if (!this.nav[bt.path[k]]) return false;
        return true;
      });
    }
    const list = this.list;
    const m = 4;
    for (let i = list.length - 1; i >= 0; i--) {
      const bt = list[i];
      bt.age += dt;
      if (bt.dying > 0) {
        bt.dying -= dt;
        if (bt.dying <= 0) {
          list[i] = list[list.length - 1];
          list.pop();
          continue;
        }
      }
      if (bt.wait > 0) {
        bt.wait -= dt;
        if (bt.wait <= 0) {
          // A ferry turns round for its next leg.
          bt.path.reverse();
          bt.k = 0;
          bt.t = 0;
        }
      } else {
        bt.t += bt.speed * dt;
        while (bt.t >= 1 && bt.wait <= 0) {
          bt.t -= 1;
          bt.k++;
          if (bt.k >= bt.path.length - 1) {
            bt.k = bt.path.length - 1;
            bt.t = 0;
            if (bt.kind === BoatKind.Ferry && bt.legs-- > 0) bt.wait = 3 + rand() * 2;
            else if (bt.dying <= 0) bt.dying = 1.2;
            break;
          }
        }
      }
      this.place(bt, dt);
      const ux = bt.u;
      const vy = bt.v;
      if (ux < b.x0 - m || ux > b.x1 + m || vy < b.y0 - m || vy > b.y1 + m) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
    // Spawn towards a target from the visible water (one a frame).
    const target = Math.min(cap, Math.round(this.visWater.length / 18));
    if (list.length < target && this.visWater.length) this.spawn(world);
    while (list.length > cap) list.pop();
  }

  private degree(x: number, y: number): number {
    const N = this.N;
    const nav = this.nav;
    let d = 0;
    if (x > 0 && nav[y * N + x - 1]) d++;
    if (x < N - 1 && nav[y * N + x + 1]) d++;
    if (y > 0 && nav[(y - 1) * N + x]) d++;
    if (y < N - 1 && nav[(y + 1) * N + x]) d++;
    return d;
  }

  /** Is a water tile beside land (a landing)? */
  private landing(world: World, x: number, y: number): boolean {
    for (let d = 0; d < 4; d++) {
      const t = world.tileAt(x + [0, 1, 0, -1][d], y + [-1, 0, 1, 0][d]);
      if (t && t.terrain === Terrain.Land) return true;
    }
    return false;
  }

  private spawn(world: World) {
    const N = this.N;
    const start = this.visWater[(rand() * this.visWater.length) | 0];
    const sx = start % N;
    const sy = (start / N) | 0;
    const slot = world.slotAt(sx, sy);
    if (slot < 0) return;
    const kind = world.districts.kinds[slot];
    const r = rand();
    const k: BoatKind =
      kind === 'shoals' ? (r < 0.4 ? BoatKind.Ferry : r < 0.9 ? BoatKind.Taxi : BoatKind.Barge) : kind === 'sunk' || kind === 'reedmere' ? (r < 0.6 ? BoatKind.Taxi : BoatKind.Barge) : r < 0.5 ? BoatKind.Taxi : BoatKind.Barge;
    const path = this.route(world, slot, start, k === BoatKind.Ferry);
    if (!path) return;
    const bt: Boat = {
      kind: k,
      path,
      k: 0,
      t: rand() * 0.5,
      speed: SPEED[k] * (0.85 + rand() * 0.3),
      wait: 0,
      age: 0,
      dying: 0,
      col: (rand() * 1000) | 0,
      legs: k === BoatKind.Ferry ? 3 : 0,
      hu: 1,
      hv: 0,
      u: sx + 0.5,
      v: sy + 0.5,
    };
    this.place(bt, 1);
    this.list.push(bt);
  }

  /** A route through the district's water from `start`: a destination 8-40 tiles away (a landing for a ferry). */
  private route(world: World, slot: number, start: number, ferry: boolean): Int32Array | null {
    const N = this.N;
    const r = slotRect(world, slot);
    this.refresh(world, r.x0, r.y0, r.x1, r.y1);
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    const area = w * h;
    if (this.dist.length < area) {
      this.dist = new Int16Array(area);
      this.prev = new Int32Array(area);
      this.queue = new Int32Array(area);
    }
    const dist = this.dist;
    const prev = this.prev;
    const q = this.queue;
    dist.fill(-1, 0, area);
    const s0 = (((start / N) | 0) - r.y0) * w + ((start % N) - r.x0);
    dist[s0] = 0;
    prev[s0] = -1;
    let qh = 0;
    let qt = 0;
    q[qt++] = s0;
    let pick = -1;
    let seen = 0;
    const nav = this.nav;
    while (qh < qt) {
      const c = q[qh++];
      const cx = (c % w) + r.x0;
      const cy = ((c / w) | 0) + r.y0;
      const d = dist[c];
      if (d >= 8 && d <= 40 && (!ferry || this.landing(world, cx, cy))) {
        // Reservoir pick among the candidates.
        seen++;
        if (rand() * seen < 1) pick = c;
      }
      if (d >= 40) continue;
      for (let k = 0; k < 4; k++) {
        const nx = cx + [0, 1, 0, -1][k];
        const ny = cy + [-1, 0, 1, 0][k];
        if (nx < r.x0 || nx > r.x1 || ny < r.y0 || ny > r.y1) continue;
        if (!nav[ny * N + nx]) continue;
        const l = (ny - r.y0) * w + (nx - r.x0);
        if (dist[l] >= 0) continue;
        dist[l] = d + 1;
        prev[l] = c;
        q[qt++] = l;
      }
    }
    if (pick < 0) return null;
    const len = dist[pick] + 1;
    const out = new Int32Array(len);
    for (let c = pick, k = len - 1; c >= 0 && k >= 0; c = prev[c], k--) out[k] = (Math.floor(c / w) + r.y0) * N + (c % w) + r.x0;
    return out;
  }

  /** Position and smoothed heading (tile space) on the path; corners eased by blending the two segments. */
  private place(bt: Boat, dt: number) {
    const N = this.N;
    const p = bt.path;
    const a = p[Math.min(bt.k, p.length - 1)];
    const c = p[Math.min(bt.k + 1, p.length - 1)];
    const au = (a % N) + 0.5;
    const av = ((a / N) | 0) + 0.5;
    const cu = (c % N) + 0.5;
    const cv = ((c / N) | 0) + 0.5;
    const t = bt.t;
    bt.u = au + (cu - au) * t;
    bt.v = av + (cv - av) * t;
    const du = cu - au;
    const dv = cv - av;
    if (du || dv) {
      const k = Math.min(1, dt * 4);
      bt.hu += (du - bt.hu) * k;
      bt.hv += (dv - bt.hv) * k;
      const l = Math.hypot(bt.hu, bt.hv) || 1;
      bt.hu /= l;
      bt.hv /= l;
    }
  }

  private colours(night: number) {
    const b = Math.round(night * 8);
    if (b === this.nightB) return;
    this.nightB = b;
    const dark: RGB = [12, 14, 26];
    this.hullCss = HULL.map((c) => css(mix(c, mix(dark, c, 0.45), night)));
    this.sideCss = HULL.map((c) => css(mix(mix(c, dark, 0.45), mix(dark, c, 0.25), night)));
    this.deckCss = DECK.map((c) => css(mix(c, mix(dark, c, 0.5), night)));
  }

  /** World-space draw (on the water, after the ground). */
  draw(ctx: CanvasRenderingContext2D, zoom: number, night: number, quality: 'low' | 'high') {
    this.drawn = 0;
    if (this.cap <= 0 || !this.list.length || zoom < 0.35) return;
    this.colours(night);
    this.glow ??= glowSprite([255, 236, 190], 32);
    const far = zoom < 0.6;
    // Each boat's hull outline once (screen-space points in `hulls`), then the parts batched across the boats: the
    // wakes in one stroke, the shadows in one fill, the side and the deck per kind, the cabins by colour, the lights
    // under one composite switch. A boat fading in or out (alpha < 1) keeps its own alpha (drawn apart).
    const list = this.list;
    const n = list.length;
    if (this.hulls.length < n * HULL_PTS * 2) this.hulls = new Float32Array(Math.max(n, BOAT_CAP) * HULL_PTS * 2);
    if (this.alphas.length < n) this.alphas = new Float32Array(Math.max(n, BOAT_CAP));
    const H = this.hulls;
    const A = this.alphas;
    for (let i = 0; i < n; i++) {
      const bt = list[i];
      const alpha = Math.min(1, bt.age * 1.5) * (bt.dying > 0 ? Math.min(1, bt.dying / 1.2) : 1);
      A[i] = alpha;
      if (alpha <= 0.02) continue;
      this.drawn++;
      const L = LEN[bt.kind];
      const W = WID[bt.kind];
      for (let k = 0; k < HULL_PTS; k++) {
        const a = HULL_SHAPE[k * 2] * L;
        const b = HULL_SHAPE[k * 2 + 1] * W;
        const pu = bt.u + bt.hu * a - bt.hv * b;
        const pv = bt.v + bt.hv * a + bt.hu * b;
        H[(i * HULL_PTS + k) * 2] = (pu - pv) * HALF_W;
        H[(i * HULL_PTS + k) * 2 + 1] = (pu + pv) * HALF_H;
      }
    }
    // Draw the boats with alpha `full` (1) or each fading boat on its own (full = false, one boat a call).
    const pass = (from: number, to: number, solid: boolean) => {
      const pick = (i: number) => (solid ? A[i] >= 0.99 : A[i] > 0.02 && A[i] < 0.99);
      // Wake: a V spreading back from the stern (brighter the faster the boat).
      ctx.strokeStyle = night > 0.5 ? '#8fb2ff' : '#f2f8ff';
      ctx.lineWidth = far ? 0.9 : 0.7;
      ctx.globalAlpha = (solid ? 1 : A[from]) * (far ? 0.35 : 0.55);
      ctx.beginPath();
      let any = false;
      for (let i = from; i < to; i++) {
        const bt = list[i];
        if (!pick(i) || bt.wait > 0 || bt.dying > 0) continue;
        any = true;
        const L = LEN[bt.kind];
        const su = bt.u - bt.hu * L;
        const sv = bt.v - bt.hv * L;
        const spread = 0.1 + 0.12 * bt.speed;
        const back = 0.35 + 0.45 * bt.speed;
        for (let sd = -1; sd <= 1; sd += 2) {
          const eu = su - bt.hu * back - bt.hv * spread * sd;
          const ev = sv - bt.hv * back + bt.hu * spread * sd;
          ctx.moveTo((su - sv) * HALF_W, (su + sv) * HALF_H);
          ctx.lineTo((eu - ev) * HALF_W, (eu + ev) * HALF_H);
        }
      }
      if (any) ctx.stroke();
      // Hull: a pointed slab (bow, two shoulders, stern corners) with a darker side below the deck line.
      ctx.globalAlpha = solid ? 1 : A[from];
      ctx.fillStyle = 'rgba(4,10,20,0.45)';
      this.hullPath(ctx, from, to, pick, -1, 0.6);
      for (let kind = 0; kind < 3; kind++) {
        ctx.fillStyle = this.sideCss[kind];
        this.hullPath(ctx, from, to, pick, kind, -0.4);
        ctx.fillStyle = this.hullCss[kind];
        this.hullPath(ctx, from, to, pick, kind, -1.6);
      }
      if (!far) {
        for (let i = from; i < to; i++) {
          if (!pick(i)) continue;
          const bt = list[i];
          const L = LEN[bt.kind];
          if (bt.kind === BoatKind.Barge) {
            // Containers in a row along the deck.
            for (let c = 0; c < 3; c++) {
              const off = L * (0.55 - c * 0.55);
              const cu = bt.u + bt.hu * off;
              const cv = bt.v + bt.hv * off;
              ctx.fillStyle = this.cargoCss[(bt.col + c) % this.cargoCss.length];
              ctx.fillRect((cu - cv) * HALF_W - 2.4, (cu + cv) * HALF_H - 4.2, 4.8, 2.6);
            }
          } else {
            // A cabin aft of the middle; a ferry's is long with a row of windows.
            const off = bt.kind === BoatKind.Ferry ? -L * 0.15 : -L * 0.25;
            const cu = bt.u + bt.hu * off;
            const cv = bt.v + bt.hv * off;
            const px = (cu - cv) * HALF_W;
            const py = (cu + cv) * HALF_H - 1.6;
            const cw = bt.kind === BoatKind.Ferry ? 9 : 4.4;
            const ch = bt.kind === BoatKind.Ferry ? 3.6 : 2.8;
            ctx.fillStyle = this.deckCss[bt.kind];
            ctx.fillRect(px - cw / 2, py - ch, cw, ch);
            ctx.fillStyle = night > 0.35 ? '#ffe7a6' : '#bfe4ff';
            ctx.fillRect(px - cw / 2 + 0.8, py - ch + 0.8, cw - 1.6, 0.9);
          }
        }
      }
      // Lights at night: a warm cabin glow and a mast light.
      if (night > 0.3) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (solid ? 1 : A[from]) * night * (quality === 'high' ? 0.8 : 0.5);
        for (let i = from; i < to; i++) {
          if (!pick(i)) continue;
          const bt = list[i];
          ctx.drawImage(this.glow!, (bt.u - bt.v) * HALF_W - 5, (bt.u + bt.v) * HALF_H - 8, 10, 10);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
    pass(0, n, true);
    for (let i = 0; i < n; i++) if (A[i] > 0.02 && A[i] < 0.99) pass(i, i + 1, false);
    ctx.globalAlpha = 1;
  }

  /** The hull outlines of the picked boats (of `kind`, or all with −1), lifted by dy, in one path and one fill. */
  private hullPath(ctx: CanvasRenderingContext2D, from: number, to: number, pick: (i: number) => boolean, kind: number, dy: number) {
    const H = this.hulls;
    let any = false;
    for (let i = from; i < to; i++) {
      if (!pick(i) || (kind >= 0 && this.list[i].kind !== kind)) continue;
      if (!any) ctx.beginPath();
      any = true;
      const o = i * HULL_PTS * 2;
      ctx.moveTo(H[o], H[o + 1] + dy);
      for (let k = 1; k < HULL_PTS; k++) ctx.lineTo(H[o + k * 2], H[o + k * 2 + 1] + dy);
      ctx.closePath();
    }
    if (any) ctx.fill();
  }

}
