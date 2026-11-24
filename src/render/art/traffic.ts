// ─────────────────────────────────────────────────────────────────────────────
// Street traffic: little hover-cars driving on the road network, plus
// pedestrian specks on busy commercial sidewalks.
//
//  * Vehicles live on road tiles. Each holds its tile, entry heading and the
//    exit it picked; within a tile it follows a cubic Bézier from the entry lane
//    to the exit lane (right-hand traffic, lanes at ±LANE from the centre line),
//    so turns trace the same quarter circles the ground layer paints for road
//    corners. At the tile edge it moves on and chooses a new exit (straight
//    preferred, busier roads preferred, U-turn only at dead ends).
//  * Only the visible area is simulated: the target count is derived from the
//    traffic field and population of the visible road tiles, new vehicles spawn
//    there (fading in) and vehicles that leave the view are recycled.
//  * The road list is rebuilt lazily after a 'tiles' event.
//  * Road kinds (docs/EXPANSION.md §3.11): spawn weight per visible tile ×
//    (Highway 1.6, Avenue 1.3, Street / Ramp 1, Back Alley 0.3); speed ×
//    ROAD_KINDS[k].speed; lanes Street ±0.15, Avenue ±0.12 / ±0.27, Highway
//    ±0.16 / ±0.36 (inner or outer lane by agent hash, kept on that kind);
//    trucks are 35% of highway spawns; alleys carry only bikes (and walkers).
//    15% of spawns enter from visible border roads heading inward, and a car
//    whose only way on leads off the map fades out there instead of U-turning.
//  * The public API (reset, invalidate, update, draw) is frozen: Effects drives it.
// ─────────────────────────────────────────────────────────────────────────────

import { ROAD_KINDS } from '../../game/config';
import { RoadKind, ZoneType } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import { css, glowSprite, mix, type RGB } from '../palette';

const WALK = 0.41;
/** Lateral lane offsets per RoadKind: [inner, outer] (a street has one lane each way). */
const LANES: readonly (readonly [number, number])[] = [
  [0.15, 0.15],
  [0.12, 0.27],
  [0.16, 0.36],
  [0.07, 0.07],
  [0.15, 0.15],
];
/** Spawn weight per RoadKind (§3.11). */
const SPAWN_W = [1, 1.3, 1.6, 0.3, 1];
const SPAWN_W_MAX = 1.6;
/** Car speed multiplier per RoadKind (ROAD_KINDS[k].speed). */
const SPEED = ROAD_KINDS.map((d) => d.speed);
/** Share of spawns that enter from a visible border road (X2). */
const EDGE_SHARE = 0.15;
/** Direction vectors: 0 = N (y-1), 1 = E (x+1), 2 = S (y+1), 3 = W (x-1). Bit = 1 << d (World.roadMask). */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const enum Kind {
  Car = 0,
  Taxi = 1,
  Truck = 2,
  Bike = 3,
  Walker = 4,
}

interface Agent {
  x: number;
  y: number;
  din: number;
  dout: number;
  t: number;
  len: number;
  speed: number;
  kind: Kind;
  col: number;
  /** Seconds alive (fade in) / remaining (fade out when < 0 means dying). */
  age: number;
  dying: number;
  /** 0 inner / 1 outer lane on multi-lane roads (agent hash, kept while on that kind). */
  lane: number;
  /** Lateral offset the agent entered this tile at (continuity across kind changes). */
  loff: number;
  // Cached path control points (tile space).
  p0u: number;
  p0v: number;
  c1u: number;
  c1v: number;
  c2u: number;
  c2v: number;
  p1u: number;
  p1v: number;
}

const BODY_DAY: RGB[] = [
  [196, 200, 210],
  [60, 64, 78],
  [150, 40, 70],
  [40, 90, 140],
  [210, 210, 220],
  [90, 70, 120],
  [30, 140, 140],
];
const TAXI: RGB = [255, 206, 60];
const TRUCK: RGB = [150, 140, 120];
const UMBRELLA: RGB[] = [
  [255, 60, 180],
  [60, 220, 255],
  [255, 210, 60],
  [140, 90, 255],
  [230, 230, 240],
];

function rand(): number {
  return Math.random();
}

export class StreetTraffic {
  private cars: Agent[] = [];
  private walkers: Agent[] = [];
  private roads: number[] = [];
  /** Side of the world the agents walk (its N, MEGACITY §3.1); set by rebuild(). */
  private N = 0;
  /** Road kind per tile (valid where a road is), sized from the world's frame. */
  private kinds = new Uint8Array(0);
  /** Road tiles next to dense commercial lots (pedestrian spawn points). */
  private walkRoads: number[] = [];
  private dirty = true;
  private visRoads: number[] = [];
  private visWalk: number[] = [];
  /** Visible border road tiles (regional traffic enters here). */
  private visEdge: number[] = [];
  private targetCars = 0;
  private targetWalkers = 0;
  private recount = 0;
  private bounds: Bounds | null = null;
  private quality: 'low' | 'high' = 'high';
  private nightB = -1;
  private bodyCss: string[] = [];
  private taxiCss = '';
  private truckCss = '';
  private roofCss: string[] = [];
  private shadowCss = 'rgba(0,0,0,0.35)';
  private umbrellaCss = UMBRELLA.map((c) => css(c));
  private headGlow: HTMLCanvasElement | null = null;
  private tailGlow: HTMLCanvasElement | null = null;
  /** Scratch exit weights (chooseExit). */
  private w = [0, 0, 0, 0];
  /** Scratch outputs of pos() / heading() (avoids per-agent allocations). */
  private pu = 0;
  private pv = 0;
  private cu = new Float64Array(4);
  private cv = new Float64Array(4);
  private hu = 1;
  private hv = 0;

  reset() {
    this.cars.length = 0;
    this.walkers.length = 0;
    this.dirty = true;
    this.recount = 0;
  }

  invalidate() {
    this.dirty = true;
  }

  private rebuild(world: World) {
    this.dirty = false;
    if (this.N !== world.N) {
      // A world of another side: nothing carries over.
      this.N = world.N;
      this.kinds = new Uint8Array(world.area);
      this.cars.length = 0;
      this.walkers.length = 0;
    }
    const N = this.N;
    this.roads.length = 0;
    this.walkRoads.length = 0;
    const tiles = world.tiles;
    for (let i = 0; i < tiles.length; i++) {
      if (!tiles[i].road) continue;
      this.roads.push(i);
      this.kinds[i] = tiles[i].roadKind;
      const x = i % N;
      const y = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const t = world.tileAt(x + DX[d], y + DY[d]);
        if (t && t.zone === ZoneType.Commercial && t.level >= 2 && !t.abandoned) {
          this.walkRoads.push(i);
          break;
        }
      }
    }
    // Drop agents standing on tiles that are no longer roads.
    const keep = (a: Agent) => world.isRoad(a.x, a.y);
    this.cars = this.cars.filter(keep);
    this.walkers = this.walkers.filter(keep);
    this.recount = 0;
  }

  /** Recompute the visible road subset and target populations. */
  private count(world: World, b: Bounds) {
    const { N } = this;
    const m = 2;
    this.visRoads.length = 0;
    this.visWalk.length = 0;
    this.visEdge.length = 0;
    const traffic = world.fields.traffic;
    const kinds = this.kinds;
    let sum = 0;
    for (const i of this.roads) {
      const x = i % N;
      const y = (i / N) | 0;
      if (x < b.x0 - m || x > b.x1 + m || y < b.y0 - m || y > b.y1 + m) continue;
      this.visRoads.push(i);
      sum += (0.05 + traffic[i] * 0.85) * SPAWN_W[kinds[i]];
      if ((x === 0 || y === 0 || x === N - 1 || y === N - 1) && world.tiles[i].terrain === 0) this.visEdge.push(i);
    }
    for (const i of this.walkRoads) {
      const x = i % N;
      const y = (i / N) | 0;
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      this.visWalk.push(i);
    }
    const pop = world.stats.population;
    const popK = Math.pow(Math.min(1, pop / 12000), 0.7); // ×10 units (MEGACITY §4.4)
    const cap = this.quality === 'low' ? 90 : 260;
    this.targetCars = Math.min(cap, Math.round(sum * popK));
    this.targetWalkers = this.quality === 'low' ? 0 : Math.min(140, Math.round(this.visWalk.length * 1.6 * popK));
  }

  update(dt: number, world: World, quality: 'low' | 'high') {
    this.quality = quality;
    if (this.dirty || this.N !== world.N) this.rebuild(world);
    const b = this.bounds;
    if (!b) return;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.5;
      this.count(world, b);
    }
    this.step(this.cars, dt, world, b, false);
    this.step(this.walkers, dt, world, b, true);
    // Spawn towards the targets (a few per frame so they trickle in).
    let spawn = Math.min(6, this.targetCars - this.cars.length);
    while (spawn-- > 0 && this.visRoads.length) this.spawn(world, this.visRoads, false);
    spawn = Math.min(4, this.targetWalkers - this.walkers.length);
    while (spawn-- > 0 && this.visWalk.length) this.spawn(world, this.visWalk, true);
    // Thin out when over target.
    this.thin(this.cars, this.targetCars);
    this.thin(this.walkers, this.targetWalkers);
  }

  private thin(list: Agent[], target: number) {
    let excess = list.length - target;
    for (let i = 0; i < list.length && excess > 0; i++) {
      if (list[i].dying > 0) {
        excess--;
        continue;
      }
      if (rand() < 0.05) {
        list[i].dying = 0.6;
        excess--;
      }
    }
  }

  private step(list: Agent[], dt: number, world: World, b: Bounds, walk: boolean) {
    const { N } = this;
    const m = 3;
    const traffic = world.fields.traffic;
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
      const ti = a.y * N + a.x;
      const jam = walk ? 1 : (1 - 0.45 * traffic[ti]) * SPEED[this.kinds[ti]];
      a.t += (a.speed * jam * dt) / a.len;
      while (a.t >= 1) {
        a.t -= 1;
        const nx = a.x + DX[a.dout];
        const ny = a.y + DY[a.dout];
        if (!world.isRoad(nx, ny) || nx < b.x0 - m || nx > b.x1 + m || ny < b.y0 - m || ny > b.y1 + m) {
          // Left the network or the view: recycle.
          list[i] = list[list.length - 1];
          list.pop();
          break;
        }
        a.x = nx;
        a.y = ny;
        a.din = a.dout;
        a.dout = this.chooseExit(world, nx, ny, a.din, walk, a.kind === Kind.Bike);
        // Heading off the map (a regional road's end): fade out over this tile.
        if (!walk && !world.inBounds(nx + DX[a.dout], ny + DY[a.dout]) && a.dying <= 0) a.dying = Math.max(0.3, Math.min(0.6, a.len / Math.max(0.05, a.speed)));
        this.path(a, walk);
      }
    }
  }

  private chooseExit(world: World, x: number, y: number, din: number, walk: boolean, bike = false): number {
    const { N } = this;
    const mask = world.roadMask(x, y);
    const back = (din + 2) & 3;
    let total = 0;
    const w = this.w;
    w[0] = w[1] = w[2] = w[3] = 0;
    const traffic = world.fields.traffic;
    const kinds = this.kinds;
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d)) || d === back) continue;
      const ni = (y + DY[d]) * N + (x + DX[d]);
      // Back alleys carry only bikes and walkers.
      if (!walk && !bike && kinds[ni] === RoadKind.Alley) continue;
      let k = d === din ? 2.2 : 1;
      if (!walk) k *= 0.35 + traffic[ni];
      w[d] = k;
      total += k;
    }
    if (total <= 0) {
      // Dead end. A road running off the map edge: drive on and fade out (regional traffic).
      if (!walk && !world.inBounds(x + DX[din], y + DY[din])) return din;
      return back; // U-turn
    }
    let r = rand() * total;
    for (let d = 0; d < 4; d++) {
      r -= w[d];
      if (r <= 0 && w[d] > 0) return d;
    }
    return din;
  }

  /** Lane offset of an agent on tile i (its kind's inner or outer lane). */
  private laneOff(a: Agent, i: number): number {
    const l = LANES[this.kinds[i]] ?? LANES[0];
    return l[a.lane];
  }

  /** Set the in-tile Bézier path for the agent's (din → dout). */
  private path(a: Agent, walk: boolean) {
    const { N } = this;
    const exit = walk ? WALK : this.laneOff(a, a.y * N + a.x);
    const off = walk ? WALK : (a.loff || exit);
    a.loff = exit;
    const cu = a.x + 0.5;
    const cv = a.y + 0.5;
    const di = a.din;
    const dout = a.dout;
    // Right-hand normal of a heading (dx, dy) is (-dy, dx). Entry at the lane it arrived in, exit in this tile's lane.
    a.p0u = cu - DX[di] * 0.5 - DY[di] * off;
    a.p0v = cv - DY[di] * 0.5 + DX[di] * off;
    a.p1u = cu + DX[dout] * 0.5 - DY[dout] * exit;
    a.p1v = cv + DY[dout] * 0.5 + DX[dout] * exit;
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

  /** A pool tile weighted by its kind's spawn weight (rejection sampling, a few tries). */
  private pick(pool: number[]): number {
    const kinds = this.kinds;
    let i = pool[(rand() * pool.length) | 0];
    for (let k = 0; k < 4 && rand() * SPAWN_W_MAX > SPAWN_W[kinds[i]]; k++) i = pool[(rand() * pool.length) | 0];
    return i;
  }

  private spawn(world: World, pool: number[], walk: boolean) {
    const { N } = this;
    const traffic = world.fields.traffic;
    const kinds = this.kinds;
    let i: number;
    let fromEdge = -1;
    if (!walk && this.visEdge.length && rand() < EDGE_SHARE) {
      // Regional traffic: enter from a visible border road, heading inward.
      i = this.visEdge[(rand() * this.visEdge.length) | 0];
      const x = i % N;
      const y = (i / N) | 0;
      fromEdge = x === 0 ? 1 : x === N - 1 ? 3 : y === 0 ? 2 : 0;
    } else {
      // Pick the busier of two (kind-weighted) random candidates.
      i = this.pick(pool);
      const j = this.pick(pool);
      if (!walk && traffic[j] * SPAWN_W[kinds[j]] > traffic[i] * SPAWN_W[kinds[i]]) i = j;
    }
    const x = i % N;
    const y = (i / N) | 0;
    const mask = world.roadMask(x, y);
    if (!mask) return;
    const r = rand();
    const k = kinds[i];
    // Alleys: bikes only. Highways: 35% trucks. Elsewhere the usual mix.
    const kind = walk
      ? Kind.Walker
      : k === RoadKind.Alley
        ? Kind.Bike
        : k === RoadKind.Highway
          ? r < 0.35 ? Kind.Truck : r < 0.45 ? Kind.Taxi : Kind.Car
          : r < 0.12 ? Kind.Taxi : r < 0.24 ? Kind.Truck : r < 0.36 ? Kind.Bike : Kind.Car;
    const dirs: number[] = [];
    const motor = !walk && kind !== Kind.Bike;
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      // Motor traffic never heads into an alley.
      if (motor && kinds[(y + DY[d]) * N + x + DX[d]] === RoadKind.Alley) continue;
      dirs.push(d);
    }
    if (!dirs.length) return;
    let din: number;
    let dout: number;
    if (fromEdge >= 0) {
      din = fromEdge;
      dout = this.chooseExit(world, x, y, din, false, kind === Kind.Bike);
    } else {
      dout = dirs[(rand() * dirs.length) | 0];
      // Enter from another connected side (or from the exit side at a dead end → U-turn).
      const others = dirs.filter((d) => d !== dout);
      const side = others.length ? others[(rand() * others.length) | 0] : dout;
      din = (side + 2) & 3;
    }
    const a: Agent = {
      x,
      y,
      din,
      dout,
      t: fromEdge >= 0 ? 0 : rand(),
      len: 1,
      speed: walk ? 0.1 + rand() * 0.08 : kind === Kind.Truck ? 0.45 + rand() * 0.15 : kind === Kind.Bike ? 0.8 + rand() * 0.3 : 0.6 + rand() * 0.3,
      kind,
      col: (rand() * 1000) | 0,
      age: fromEdge >= 0 ? -0.15 : 0,
      dying: 0,
      lane: rand() < 0.5 ? 0 : 1,
      loff: 0,
      p0u: 0,
      p0v: 0,
      c1u: 0,
      c1v: 0,
      c2u: 0,
      c2v: 0,
      p1u: 0,
      p1v: 0,
    };
    this.path(a, walk);
    (walk ? this.walkers : this.cars).push(a);
  }

  private colours(n: number) {
    const b = Math.round(n * 8);
    if (b === this.nightB) return;
    this.nightB = b;
    const k = n;
    const dark: RGB = [16, 16, 26];
    this.bodyCss = BODY_DAY.map((c) => css(mix(c, mix(dark, c, 0.25), k)));
    this.roofCss = BODY_DAY.map((c) => css(mix(mix(c, [255, 255, 255], 0.25), mix(dark, c, 0.35), k)));
    this.taxiCss = css(mix(TAXI, mix(dark, TAXI, 0.5), k));
    this.truckCss = css(mix(TRUCK, mix(dark, TRUCK, 0.3), k));
    this.shadowCss = `rgba(0,0,0,${(0.3 - 0.15 * k).toFixed(2)})`;
  }

  /** World-space draw. `rain` 0..1 (umbrellas). */
  draw(ctx: CanvasRenderingContext2D, b: Bounds, zoom: number, night: number, quality: 'low' | 'high', rain: number) {
    this.bounds = b;
    if (!this.cars.length && !this.walkers.length) return;
    this.colours(night);
    if (!this.headGlow) {
      this.headGlow = glowSprite([255, 240, 200], 64);
      this.tailGlow = glowSprite([255, 40, 70], 64);
    }
    const far = zoom < 0.45;
    const lights = night > 0.25;
    const cars = this.cars;
    ctx.globalCompositeOperation = 'source-over';

    // Pass 1: bodies.
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      const alpha = Math.min(1, a.age * 2) * (a.dying > 0 ? a.dying / 0.6 : 1);
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha;
      this.drawBody(ctx, a, far);
    }
    // Pedestrians (close zoom only).
    if (zoom >= 0.8 && this.walkers.length) {
      const ws = this.walkers;
      for (let i = 0; i < ws.length; i++) {
        const a = ws[i];
        const alpha = Math.min(1, a.age * 2) * (a.dying > 0 ? a.dying / 0.6 : 1);
        if (alpha <= 0.02) continue;
        ctx.globalAlpha = alpha;
        this.pos(a);
        const x = (this.pu - this.pv) * HALF_W;
        const y = (this.pu + this.pv) * HALF_H;
        ctx.fillStyle = night > 0.5 ? '#3a3448' : '#26242e';
        ctx.fillRect(x - 0.45, y - 2.6, 0.9, 2.6);
        if (rain > 0.2) {
          ctx.fillStyle = this.umbrellaCss[a.col % this.umbrellaCss.length];
          ctx.beginPath();
          ctx.ellipse(x, y - 2.9, 1.5, 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = this.umbrellaCss[a.col % this.umbrellaCss.length];
          ctx.fillRect(x - 0.4, y - 3.2, 0.8, 0.7);
        }
      }
    }
    // Pass 2: lights.
    if (lights || quality === 'high') {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < cars.length; i++) {
        const a = cars[i];
        const alpha = Math.min(1, a.age * 2) * (a.dying > 0 ? a.dying / 0.6 : 1);
        if (alpha <= 0.02) continue;
        this.drawLights(ctx, a, far, night, alpha, quality);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Position on the in-tile path → this.pu / this.pv (tile space). */
  private pos(a: Agent) {
    const t = a.t;
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    this.pu = b0 * a.p0u + b1 * a.c1u + b2 * a.c2u + b3 * a.p1u;
    this.pv = b0 * a.p0v + b1 * a.c1v + b2 * a.c2v + b3 * a.p1v;
  }

  /** Unit heading on the in-tile path → this.hu / this.hv. */
  private heading(a: Agent) {
    const t = Math.min(0.999, Math.max(0.001, a.t));
    const s = 1 - t;
    const hu = 3 * s * s * (a.c1u - a.p0u) + 6 * s * t * (a.c2u - a.c1u) + 3 * t * t * (a.p1u - a.c2u);
    const hv = 3 * s * s * (a.c1v - a.p0v) + 6 * s * t * (a.c2v - a.c1v) + 3 * t * t * (a.p1v - a.c2v);
    const l = Math.hypot(hu, hv) || 1;
    this.hu = hu / l;
    this.hv = hv / l;
  }

  private drawBody(ctx: CanvasRenderingContext2D, a: Agent, far: boolean) {
    this.pos(a);
    const u = this.pu;
    const v = this.pv;
    const x = (u - v) * HALF_W;
    const y = (u + v) * HALF_H;
    const col = a.kind === Kind.Taxi ? this.taxiCss : a.kind === Kind.Truck ? this.truckCss : this.bodyCss[a.col % this.bodyCss.length];
    if (far) {
      ctx.fillStyle = col;
      ctx.fillRect(x - 1.2, y - 1.6, 2.4, 1.6);
      return;
    }
    this.heading(a);
    const hu = this.hu;
    const hv = this.hv;
    const L = a.kind === Kind.Truck ? 0.15 : a.kind === Kind.Bike ? 0.065 : 0.1;
    const W = a.kind === Kind.Truck ? 0.06 : a.kind === Kind.Bike ? 0.025 : 0.05;
    const H = a.kind === Kind.Truck ? 5 : a.kind === Kind.Bike ? 2.2 : 3;
    const lift = 1.6; // hover height
    // Footprint corners in tile space: front-left, front-right, back-right, back-left.
    const fu = hu * L;
    const fv = hv * L;
    const su = -hv * W;
    const sv = hu * W;
    const cu = this.cu;
    const cv = this.cv;
    cu[0] = u + fu - su;
    cu[1] = u + fu + su;
    cu[2] = u - fu + su;
    cu[3] = u - fu - su;
    cv[0] = v + fv - sv;
    cv[1] = v + fv + sv;
    cv[2] = v - fv + sv;
    cv[3] = v - fv - sv;
    // Shadow on the road.
    ctx.fillStyle = this.shadowCss;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const px = (cu[k] - cv[k]) * HALF_W;
      const py = (cu[k] + cv[k]) * HALF_H;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.fill();
    // Body slab (side) then roof.
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const px = (cu[k] - cv[k]) * HALF_W;
      const py = (cu[k] + cv[k]) * HALF_H - lift;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let k = 3; k >= 0; k--) {
      const px = (cu[k] - cv[k]) * HALF_W;
      const py = (cu[k] + cv[k]) * HALF_H - lift - H * 0.6;
      ctx.lineTo(px, py);
    }
    ctx.fill();
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const px = (cu[k] - cv[k]) * HALF_W;
      const py = (cu[k] + cv[k]) * HALF_H - lift - H * 0.6;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.fill();
    // Cabin / roof highlight.
    const r = a.kind === Kind.Truck ? 0.45 : 0.6;
    ctx.fillStyle = a.kind === Kind.Truck ? this.bodyCss[1] : this.roofCss[a.col % this.roofCss.length];
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const ku = u + (cu[k] - u) * r - (a.kind === Kind.Truck ? fu * 0.45 : 0);
      const kv = v + (cv[k] - v) * r - (a.kind === Kind.Truck ? fv * 0.45 : 0);
      const px = (ku - kv) * HALF_W;
      const py = (ku + kv) * HALF_H - lift - H;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.fill();
  }

  private drawLights(ctx: CanvasRenderingContext2D, a: Agent, far: boolean, night: number, alpha: number, quality: 'low' | 'high') {
    this.pos(a);
    this.heading(a);
    const u = this.pu;
    const v = this.pv;
    const hu = this.hu;
    const hv = this.hv;
    const L = a.kind === Kind.Truck ? 0.15 : a.kind === Kind.Bike ? 0.065 : 0.1;
    const x = (u - v) * HALF_W;
    const y = (u + v) * HALF_H - 2.4;
    const fx = (hu - hv) * HALF_W * L;
    const fy = (hu + hv) * HALF_H * L;
    if (far) {
      if (night < 0.3) return;
      ctx.globalAlpha = alpha * night;
      ctx.fillStyle = '#fff2c8';
      ctx.fillRect(x + fx - 0.6, y + fy - 0.6, 1.2, 1.2);
      ctx.fillStyle = '#ff3050';
      ctx.fillRect(x - fx - 0.5, y - fy - 0.5, 1, 1);
      return;
    }
    const n = night;
    if (n > 0.25) {
      // Headlight pool ahead on the road.
      if (quality === 'high') {
        ctx.globalAlpha = alpha * n * 0.55;
        const bx = x + fx * 3.4;
        const by = y + fy * 3.4 + 2;
        ctx.drawImage(this.headGlow!, bx - 9, by - 5, 18, 10);
      }
      ctx.globalAlpha = alpha * n;
      ctx.fillStyle = '#fff4d0';
      ctx.fillRect(x + fx - 0.7, y + fy - 0.7, 1.4, 1.4);
      ctx.fillStyle = '#ff2a48';
      ctx.fillRect(x - fx - 0.6, y - fy - 0.6, 1.2, 1.2);
      if (quality === 'high') {
        ctx.globalAlpha = alpha * n * 0.5;
        ctx.drawImage(this.tailGlow!, x - fx - 3, y - fy - 3, 6, 6);
      }
    }
    // Neon underglow on taxis and bikes (day and night).
    if (quality === 'high' && (a.kind === Kind.Taxi || a.kind === Kind.Bike)) {
      ctx.globalAlpha = alpha * (0.2 + 0.4 * n);
      const g = a.kind === Kind.Taxi ? this.headGlow! : this.tailGlow!;
      ctx.drawImage(g, x - 5, y - 1, 10, 5);
    }
  }
}
