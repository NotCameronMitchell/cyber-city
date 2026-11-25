// ─────────────────────────────────────────────────────────────────────────────
// Street traffic: little hover-cars driving on the road network.
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
//  * Road kinds (docs/EXPANSION.md §3.11): spawn weight per visible tile ×
//    (Highway 1.6, Avenue 1.3, Street / Ramp 1, Back Alley 0.3); speed ×
//    ROAD_KINDS[k].speed; lanes Street ±0.15, Avenue ±0.12 / ±0.27, Highway
//    ±0.16 / ±0.36 (inner or outer lane by agent hash, kept on that kind);
//    alleys carry only bikes. 15% of spawns enter from visible border roads
//    heading inward, and a car whose only way on leads off the map fades out
//    there instead of U-turning (WP-3's boundary rule).
//  * Vehicle kinds (MEGACITY §6.4): buses on avenues (12% of avenue spawns, a
//    long lit body), delivery vans everywhere, cargo trucks beside Fab Yards and
//    Seaports (and 35% on highways), taxis near the Airport, stations and $$+
//    Market tiles, police cruisers near precincts (blue and red at night).
//  * R0 (MEGACITY §3.9): nothing walks the whole map. A 'tiles' event only
//    flags the 8×8 blocks of StreetIndex it touches; the visible rect is walked
//    every 0.5 s (and at most every 250 ms after a change in view), refreshing
//    its flagged blocks first, counted as 'view:traffic'. No street cars in the
//    skyline view or under the City map (§3.9).
//  * Pedestrians moved to art/crowds.ts (§6.4 crowds), which reads the same
//    StreetIndex.
// ─────────────────────────────────────────────────────────────────────────────

import { ROAD_KINDS } from '../../game/config';
import { RoadKind, ZoneType, type BuildingType } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import { css, glowSprite, mix, type RGB } from '../palette';
import { countPass } from '../passes';

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
/** Spawning only on the roads in view (rather than the renderer's box, about twice the screen): a busier street. */
const ON_SCREEN_DENSITY = 2.5;
/** Cars on screen at most (high quality): a wide desktop view fills up long before the old 260 over twice the area. */
const ON_SCREEN_CAP = 180;
/** Car speed multiplier per RoadKind (ROAD_KINDS[k].speed). */
const SPEED = ROAD_KINDS.map((d) => d.speed);
/** Share of spawns that enter from a visible border road (X2). */
const EDGE_SHARE = 0.15;
/** Direction vectors: 0 = N (y-1), 1 = E (x+1), 2 = S (y+1), 3 = W (x-1). Bit = 1 << d (World.roadMask). */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
/** Exported for art/crowds.ts (same compass). */
export { DX as STREET_DX, DY as STREET_DY };

/**
 * The direction (0 N, 1 E, 2 S, 3 W) from an owned tile to a neighbour off the owned land (the map edge or a locked
 * slot, MEGACITY §3.5), checked west, east, north, south as the 64 map's x = 0, x = N − 1, y = 0, y = N − 1 were; −1
 * when the tile is inside.
 */
function outward(world: World, x: number, y: number): number {
  if (!world.isOwned(x, y)) return -1;
  if (!world.isOwned(x - 1, y)) return 3;
  if (!world.isOwned(x + 1, y)) return 1;
  if (!world.isOwned(x, y - 1)) return 0;
  if (!world.isOwned(x, y + 1)) return 2;
  return -1;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}


/** The part of the world on screen this frame (world px; Effects reads it off the ground pass's transform). */
export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Is the centre of tile (x, y) on screen, within `mx` / `my` world px? The tile bounds the renderer hands over are an
 * axis-aligned box in tile space, about twice the screen's area: life layers pick their spots from what is on screen.
 */
export function tileOnScreen(r: ViewRect | null, x: number, y: number, mx = 40, my = 40): boolean {
  if (!r) return true;
  const px = (x - y) * HALF_W;
  const py = (x + y + 1) * HALF_H;
  return px >= r.x0 - mx && px <= r.x1 + mx && py >= r.y0 - my && py <= r.y1 + my;
}

// ── The street index (R0): what each road tile has beside it, refreshed per 8×8 block ──

/** StreetIndex.side bits of a road tile. */
export const SIDE_MARKET = 3; // bits 0-1: the highest level of a developed, lived-in Market tile beside it
export const SIDE_HAB = 4; // a developed Hab Block beside it
export const SIDE_FAB = 8; // a developed Fab Yard or a Seaport beside it (cargo trucks)
export const SIDE_RICH = 16; // a $$+ Market tile beside it (taxis)
export const SIDE_HUB = 32; // a station, Metro, Airport or terminal beside it (taxis, crowds)
export const SIDE_GATHER = 64; // a plaza, Market Hall, Arena or park beside it (groups gather)
export const SIDE_ROAD = 128; // the tile is a ground road

const HUBS = new Set<BuildingType>(['maglev', 'metro', 'airport', 'terminal', 'spaceport']);
const GATHER = new Set<BuildingType>(['plaza', 'markethall', 'arena', 'canopypark', 'commons', 'tidemarket', 'pearlatrium', 'stillsquare']);

/**
 * Per road tile, what stands beside it (§6.4 crowds, vehicles, reflections). A 'tiles' event flags the 8×8 blocks its
 * rect touches; `refresh(box)` recomputes the flagged blocks inside a box (the view), so nothing walks the whole map.
 */
export class StreetIndex {
  side = new Uint8Array(0);
  private world: World | null = null;
  private stale = new Uint8Array(0);
  private bw = 0;
  /** Blocks recomputed since construction (tests: R0). */
  refreshed = 0;

  /** Size to the world (a swap or first use): every block flagged. */
  private bind(world: World) {
    this.world = world;
    this.side = new Uint8Array(world.area);
    this.bw = (world.N + 7) >> 3;
    this.stale = new Uint8Array(this.bw * this.bw).fill(1);
  }

  /** Tiles changed in `r` (flag its blocks), or everything (no rect: a world swap, an annex). */
  invalidate(world: World, r?: Bounds) {
    if (world !== this.world || this.side.length !== world.area) {
      this.bind(world);
      return;
    }
    if (!r) {
      this.stale.fill(1);
      return;
    }
    const N = world.N;
    const bx0 = Math.max(0, r.x0) >> 3;
    const by0 = Math.max(0, r.y0) >> 3;
    const bx1 = Math.min(N - 1, r.x1) >> 3;
    const by1 = Math.min(N - 1, r.y1) >> 3;
    const bw = this.bw;
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) this.stale[by * bw + bx] = 1;
  }

  /** Recompute the flagged blocks that overlap `b` (tile bounds, inclusive). */
  refresh(world: World, b: Bounds) {
    if (world !== this.world || this.side.length !== world.area) this.bind(world);
    const N = world.N;
    const bw = this.bw;
    const bx0 = Math.max(0, b.x0) >> 3;
    const by0 = Math.max(0, b.y0) >> 3;
    const bx1 = Math.min(N - 1, Math.max(0, b.x1)) >> 3;
    const by1 = Math.min(N - 1, Math.max(0, b.y1)) >> 3;
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++) {
        const k = by * bw + bx;
        if (!this.stale[k]) continue;
        this.stale[k] = 0;
        this.refreshed++;
        this.block(world, bx << 3, by << 3);
      }
  }

  private block(world: World, x0: number, y0: number) {
    const N = world.N;
    const tiles = world.tiles;
    const side = this.side;
    const x1 = Math.min(N, x0 + 8);
    const y1 = Math.min(N, y0 + 8);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * N + x;
        const t = tiles[i];
        if (!t.road || !world.ownedAt(i)) {
          side[i] = 0;
          continue;
        }
        let v = SIDE_ROAD;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const n = tiles[ny * N + nx];
          if (n.road) continue;
          if (n.buildingId >= 0) {
            const bd = world.buildings.get(n.buildingId);
            if (bd) {
              if (HUBS.has(bd.type)) v |= SIDE_HUB;
              else if (GATHER.has(bd.type)) v |= SIDE_GATHER;
              else if (bd.type === 'seaport') v |= SIDE_FAB;
            }
            continue;
          }
          if (n.level < 1 || n.abandoned) continue;
          if (n.zone === ZoneType.Commercial) {
            if (n.level > (v & SIDE_MARKET)) v = (v & ~SIDE_MARKET) | n.level;
            if (n.wealth >= 1) v |= SIDE_RICH;
          } else if (n.zone === ZoneType.Residential) v |= SIDE_HAB;
          else if (n.zone === ZoneType.Industrial) v |= SIDE_FAB;
        }
        side[i] = v;
      }
  }
}

// ── Vehicles ──

const enum Kind {
  Car = 0,
  Taxi = 1,
  Truck = 2,
  Bike = 3,
  Bus = 4,
  Van = 5,
  Police = 6,
}

/** Footprint half-length, half-width (tiles) and height (px) per Kind. */
const DIM_L = [0.1, 0.1, 0.15, 0.065, 0.21, 0.12, 0.1];
const DIM_W = [0.05, 0.05, 0.06, 0.025, 0.06, 0.052, 0.05];
const DIM_H = [3, 3, 5, 2.2, 4.6, 4, 3];

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
/** Bus liveries (teal, magenta, amber) and van colours (white, orange, steel). */
const BUS: RGB[] = [
  [30, 150, 160],
  [170, 40, 120],
  [200, 140, 40],
];
const VAN: RGB[] = [
  [228, 228, 232],
  [220, 120, 40],
  [120, 130, 150],
];
const POLICE: RGB = [34, 40, 70];

function rand(): number {
  return Math.random();
}

/** Where the city's precincts are (police cruisers spawn within POLICE_R of one). */
const POLICE_R = 7;

export class StreetTraffic {
  private cars: Agent[] = [];
  /** Side of the world the agents drive (its N, MEGACITY §3.1). */
  private N = 0;
  private visRoads: number[] = [];
  /** Visible border road tiles (regional traffic enters here). */
  private visEdge: number[] = [];
  /** Precinct centres in view (tile coords, pairs). */
  private precincts: number[] = [];
  private targetCars = 0;
  private recount = 0;
  /** A 'tiles' event arrived since the last agent check / recount (R0: checked at most every 250 ms). */
  private changed = false;
  private sinceCheck = 0;
  private bounds: Bounds | null = null;
  /** The screen in world px (Effects): cars spawn on the roads in view, not across the renderer's wider tile box. */
  private view: ViewRect | null = null;
  private quality: 'low' | 'high' = 'high';
  /** Off in the skyline view and under the City map (§3.9). */
  private active = true;
  private nightB = -1;
  private bodyCss: string[] = [];
  private taxiCss = '';
  private truckCss = '';
  private busCss: string[] = [];
  private vanCss: string[] = [];
  private policeCss = '';
  private roofCss: string[] = [];
  private shadowCss = 'rgba(0,0,0,0.35)';
  private headGlow: HTMLCanvasElement | null = null;
  private tailGlow: HTMLCanvasElement | null = null;
  private blueGlow: HTMLCanvasElement | null = null;
  /** Scratch exit weights (chooseExit). */
  private w = [0, 0, 0, 0];
  /** Scratch outputs of pos() / heading() (avoids per-agent allocations). */
  private pu = 0;
  private pv = 0;
  private cu = new Float64Array(4);
  private cv = new Float64Array(4);
  private hu = 1;
  private hv = 0;
  /** Visible-rect walks since construction (tests: R0). */
  counts = 0;
  /** Rain on the road this frame (head and tail lights reflect on the wet road at night, MEGACITY §6.4). */
  private wet = 0;
  /** The zoom of the last draw (the on-screen cap). */
  private zoom = 1;

  constructor(private readonly index: StreetIndex = new StreetIndex()) {}

  /** Live vehicles (tests, diagnostics). */
  get size(): number {
    return this.cars.length;
  }

  /** Vehicles of each kind (tests: the §6.4 kinds). */
  kindCounts(): number[] {
    const out = [0, 0, 0, 0, 0, 0, 0];
    for (const a of this.cars) out[a.kind]++;
    return out;
  }

  reset() {
    this.cars.length = 0;
    this.recount = 0;
    this.changed = false;
  }

  /** Tiles changed (a 'tiles' event's rect; none: everything). The index flags the blocks; agents are checked later. */
  invalidate(world?: World, r?: Bounds) {
    if (world) this.index.invalidate(world, r);
    this.changed = true;
  }

  /** Recompute the visible road subset and target populations (a walk of the visible rect, R0). */
  private count(world: World, b: Bounds) {
    const N = this.N;
    const m = 2;
    this.visRoads.length = 0;
    this.visEdge.length = 0;
    const x0 = Math.max(0, b.x0 - m);
    const y0 = Math.max(0, b.y0 - m);
    const x1 = Math.min(N - 1, b.x1 + m);
    const y1 = Math.min(N - 1, b.y1 + m);
    if (x1 < x0 || y1 < y0) {
      this.targetCars = 0;
      return;
    }
    this.counts++;
    countPass('view:traffic');
    this.index.refresh(world, { x0, y0, x1, y1 });
    const side = this.index.side;
    const traffic = world.fields.traffic;
    const tiles = world.tiles;
    let sum = 0;
    const view = this.view;
    for (let y = y0; y <= y1; y++) {
      let i = y * N + x0;
      for (let x = x0; x <= x1; x++, i++) {
        if (!(side[i] & SIDE_ROAD)) continue;
        // A boundary road (MEGACITY §3.5): owned land beside the map edge or a locked slot.
        if (tiles[i].terrain === 0 && outward(world, x, y) >= 0) this.visEdge.push(i);
        // Spawns and the target come from the roads on screen (a tile's margin), where they are seen.
        if (!tileOnScreen(view, x, y, 40, 40)) continue;
        this.visRoads.push(i);
        sum += (0.05 + traffic[i] * 0.85) * SPAWN_W[tiles[i].roadKind];
      }
    }
    // Precincts near the view (police cruisers).
    this.precincts.length = 0;
    for (const bd of world.buildings.values()) {
      if (bd.type !== 'precinct') continue;
      const cx = bd.x + (bd.size >> 1);
      const cy = bd.y + (bd.size >> 1);
      if (cx < x0 - POLICE_R || cx > x1 + POLICE_R || cy < y0 - POLICE_R || cy > y1 + POLICE_R) continue;
      this.precincts.push(cx, cy);
    }
    const pop = world.stats.population;
    const popK = Math.pow(Math.min(1, pop / 12000), 0.7); // ×10 units (MEGACITY §4.4)
    // On screen the cap follows the zoom: below 1 the cars are small and a wide view holds many more roads.
    const cap = this.quality === 'low' ? 90 : view ? Math.round(ON_SCREEN_CAP * Math.min(1, Math.max(0.5, this.zoom))) : 260;
    this.targetCars = Math.min(cap, Math.round(sum * popK * (view ? ON_SCREEN_DENSITY : 1)));
  }

  /**
   * One frame. `band`: the renderer's view band (§3.9): street cars only in the street view; the skyline view and the
   * City map drop them.
   */
  update(dt: number, world: World, quality: 'low' | 'high', band: 'street' | 'skyline' | 'map' = 'street', view: ViewRect | null = null) {
    this.quality = quality;
    this.view = view;
    if (this.N !== world.N) {
      // A world of another side: nothing carries over.
      this.N = world.N;
      this.cars.length = 0;
      this.recount = 0;
    }
    this.active = band === 'street';
    if (!this.active) {
      this.cars.length = 0;
      this.recount = 0;
      return;
    }
    const b = this.bounds;
    if (!b) return;
    this.sinceCheck += dt;
    this.recount -= dt;
    // A change: agents on tiles that are no longer roads drop, and the view recounts (at most every 250 ms).
    if (this.changed && this.sinceCheck >= 0.25) {
      this.changed = false;
      this.sinceCheck = 0;
      this.cars = this.cars.filter((a) => world.isRoad(a.x, a.y));
      if (this.recount > 0.25) this.recount = 0;
    }
    if (this.recount <= 0) {
      this.recount = 0.5;
      this.count(world, b);
    }
    this.step(this.cars, dt, world, b);
    // Spawn towards the target (a few per frame so they trickle in).
    let spawn = Math.min(6, this.targetCars - this.cars.length);
    while (spawn-- > 0 && this.visRoads.length) this.spawn(world, this.visRoads);
    this.thin(this.cars, this.targetCars);
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

  private step(list: Agent[], dt: number, world: World, b: Bounds) {
    const { N } = this;
    const m = 3;
    const traffic = world.fields.traffic;
    const tiles = world.tiles;
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
      const jam = (1 - 0.45 * traffic[ti]) * SPEED[tiles[ti].roadKind];
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
        a.dout = this.chooseExit(world, nx, ny, a.din, a.kind === Kind.Bike);
        // Heading off the map (a regional road's end): fade out over this tile.
        if (!world.inBounds(nx + DX[a.dout], ny + DY[a.dout]) && a.dying <= 0) a.dying = Math.max(0.3, Math.min(0.6, a.len / Math.max(0.05, a.speed)));
        this.path(a, world);
      }
    }
  }

  private chooseExit(world: World, x: number, y: number, din: number, bike = false): number {
    const { N } = this;
    const mask = world.roadMask(x, y);
    const back = (din + 2) & 3;
    let total = 0;
    const w = this.w;
    w[0] = w[1] = w[2] = w[3] = 0;
    const traffic = world.fields.traffic;
    const tiles = world.tiles;
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d)) || d === back) continue;
      const ni = (y + DY[d]) * N + (x + DX[d]);
      // Back alleys carry only bikes.
      if (!bike && tiles[ni].roadKind === RoadKind.Alley) continue;
      let k = d === din ? 2.2 : 1;
      k *= 0.35 + traffic[ni];
      w[d] = k;
      total += k;
    }
    if (total <= 0) {
      // Dead end. A road running off the owned land (the map edge or a locked slot): drive on and fade out.
      if (!world.isOwned(x + DX[din], y + DY[din])) return din;
      return back; // U-turn
    }
    let r = rand() * total;
    for (let d = 0; d < 4; d++) {
      r -= w[d];
      if (r <= 0 && w[d] > 0) return d;
    }
    return din;
  }

  /** Lane offset of an agent on tile i (its kind's inner or outer lane; buses keep the outer lane). */
  private laneOff(a: Agent, i: number, world: World): number {
    const l = LANES[world.tiles[i].roadKind] ?? LANES[0];
    return l[a.kind === Kind.Bus ? 1 : a.lane];
  }

  /** Set the in-tile Bézier path for the agent's (din → dout). */
  private path(a: Agent, world: World) {
    const { N } = this;
    const exit = this.laneOff(a, a.y * N + a.x, world);
    const off = a.loff || exit;
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
  private pick(pool: number[], world: World): number {
    const tiles = world.tiles;
    let i = pool[(rand() * pool.length) | 0];
    for (let k = 0; k < 4 && rand() * SPAWN_W_MAX > SPAWN_W[tiles[i].roadKind]; k++) i = pool[(rand() * pool.length) | 0];
    return i;
  }

  /** Is the tile within POLICE_R of a precinct in view? */
  private nearPrecinct(x: number, y: number): boolean {
    const p = this.precincts;
    for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) <= POLICE_R && Math.abs(p[k + 1] - y) <= POLICE_R) return true;
    return false;
  }

  /** The vehicle kind for a spawn on tile i (§6.4: buses, vans, trucks, taxis, police). */
  private kindFor(world: World, i: number, x: number, y: number): Kind {
    const k = world.tiles[i].roadKind;
    if (k === RoadKind.Alley) return Kind.Bike;
    const side = this.index.side[i];
    const r = rand();
    if (k === RoadKind.Highway) return r < 0.35 ? Kind.Truck : r < 0.45 ? Kind.Taxi : r < 0.53 ? Kind.Van : Kind.Car;
    // Avenues: 12% buses, then the street mix.
    if (k === RoadKind.Avenue && r < 0.12) return Kind.Bus;
    const q = rand();
    if (this.precincts.length && q < 0.16 && this.nearPrecinct(x, y)) return Kind.Police;
    const taxi = side & (SIDE_RICH | SIDE_HUB) ? 0.24 : 0.05;
    const truck = side & SIDE_FAB ? 0.3 : 0.04;
    const s = rand();
    if (s < taxi) return Kind.Taxi;
    if (s < taxi + truck) return Kind.Truck;
    if (s < taxi + truck + 0.11) return Kind.Van;
    if (s < taxi + truck + 0.21) return Kind.Bike;
    return Kind.Car;
  }

  private spawn(world: World, pool: number[]) {
    const { N } = this;
    const traffic = world.fields.traffic;
    const tiles = world.tiles;
    let i: number;
    let fromEdge = -1;
    if (this.visEdge.length && rand() < EDGE_SHARE) {
      // Regional traffic: enter from a visible border road, heading inward.
      i = this.visEdge[(rand() * this.visEdge.length) | 0];
      // Heading inward, away from the boundary (west edge → east, east → west, north → south, south → north).
      fromEdge = (outward(world, i % N, (i / N) | 0) + 2) & 3;
    } else {
      // Pick the busier of two (kind-weighted) random candidates.
      i = this.pick(pool, world);
      const j = this.pick(pool, world);
      if (traffic[j] * SPAWN_W[tiles[j].roadKind] > traffic[i] * SPAWN_W[tiles[i].roadKind]) i = j;
    }
    const x = i % N;
    const y = (i / N) | 0;
    if (!tiles[i].road) return;
    const mask = world.roadMask(x, y);
    if (!mask) return;
    const kind = this.kindFor(world, i, x, y);
    const dirs: number[] = [];
    const motor = kind !== Kind.Bike;
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      // Motor traffic never heads into an alley.
      if (motor && tiles[(y + DY[d]) * N + x + DX[d]].roadKind === RoadKind.Alley) continue;
      dirs.push(d);
    }
    if (!dirs.length) return;
    let din: number;
    let dout: number;
    if (fromEdge >= 0) {
      din = fromEdge;
      dout = this.chooseExit(world, x, y, din, kind === Kind.Bike);
    } else {
      dout = dirs[(rand() * dirs.length) | 0];
      // Enter from another connected side (or from the exit side at a dead end → U-turn).
      const others = dirs.filter((d) => d !== dout);
      const side = others.length ? others[(rand() * others.length) | 0] : dout;
      din = (side + 2) & 3;
    }
    const speed =
      kind === Kind.Truck
        ? 0.45 + rand() * 0.15
        : kind === Kind.Bus
          ? 0.42 + rand() * 0.1
          : kind === Kind.Van
            ? 0.55 + rand() * 0.2
            : kind === Kind.Bike
              ? 0.8 + rand() * 0.3
              : kind === Kind.Police
                ? 0.75 + rand() * 0.25
                : 0.6 + rand() * 0.3;
    const a: Agent = {
      x,
      y,
      din,
      dout,
      t: fromEdge >= 0 ? 0 : rand(),
      len: 1,
      speed,
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
    this.path(a, world);
    this.cars.push(a);
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
    this.busCss = BUS.map((c) => css(mix(c, mix(dark, c, 0.4), k)));
    this.vanCss = VAN.map((c) => css(mix(c, mix(dark, c, 0.3), k)));
    this.policeCss = css(mix(POLICE, mix(dark, POLICE, 0.6), k));
    this.shadowCss = `rgba(0,0,0,${(0.3 - 0.15 * k).toFixed(2)})`;
  }

  /** World-space draw. `rain` 0..1: at night the head and tail lights streak on the wet road (umbrellas: art/crowds.ts). */
  draw(ctx: CanvasRenderingContext2D, b: Bounds, zoom: number, night: number, quality: 'low' | 'high', rain: number) {
    this.bounds = b;
    this.zoom = zoom;
    this.wet = quality === 'high' && zoom >= 0.6 ? rain : 0;
    if (!this.active || !this.cars.length) return;
    this.colours(night);
    if (!this.headGlow) {
      this.headGlow = glowSprite([255, 240, 200], 64);
      this.tailGlow = glowSprite([255, 40, 70], 64);
      this.blueGlow = glowSprite([60, 120, 255], 64);
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
    // Pass 2: lights.
    if (lights || quality === 'high') {
      ctx.globalCompositeOperation = 'lighter';
      const t = performance.now() / 1000;
      for (let i = 0; i < cars.length; i++) {
        const a = cars[i];
        const alpha = Math.min(1, a.age * 2) * (a.dying > 0 ? a.dying / 0.6 : 1);
        if (alpha <= 0.02) continue;
        this.drawLights(ctx, a, far, night, alpha, quality, t);
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

  private bodyColour(a: Agent): string {
    switch (a.kind) {
      case Kind.Taxi:
        return this.taxiCss;
      case Kind.Truck:
        return this.truckCss;
      case Kind.Bus:
        return this.busCss[a.col % this.busCss.length];
      case Kind.Van:
        return this.vanCss[a.col % this.vanCss.length];
      case Kind.Police:
        return this.policeCss;
      default:
        return this.bodyCss[a.col % this.bodyCss.length];
    }
  }

  private drawBody(ctx: CanvasRenderingContext2D, a: Agent, far: boolean) {
    this.pos(a);
    const u = this.pu;
    const v = this.pv;
    const x = (u - v) * HALF_W;
    const y = (u + v) * HALF_H;
    const col = this.bodyColour(a);
    if (far) {
      ctx.fillStyle = col;
      if (a.kind === Kind.Bus) ctx.fillRect(x - 2, y - 2, 4, 2);
      else ctx.fillRect(x - 1.2, y - 1.6, 2.4, 1.6);
      return;
    }
    this.heading(a);
    const hu = this.hu;
    const hv = this.hv;
    const L = DIM_L[a.kind];
    const W = DIM_W[a.kind];
    const H = DIM_H[a.kind];
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
    // Cabin / roof highlight (trucks and vans: a cab at the front; buses: the whole roof, a light stripe).
    const cab = a.kind === Kind.Truck || a.kind === Kind.Van;
    const r = a.kind === Kind.Truck ? 0.45 : a.kind === Kind.Van ? 0.5 : a.kind === Kind.Bus ? 0.85 : 0.6;
    ctx.fillStyle =
      a.kind === Kind.Truck
        ? this.bodyCss[1]
        : a.kind === Kind.Police
          ? this.bodyCss[4]
          : a.kind === Kind.Bus || a.kind === Kind.Van
            ? this.roofCss[4]
            : this.roofCss[a.col % this.roofCss.length];
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const ku = u + (cu[k] - u) * r + (cab ? fu * 0.45 * (a.kind === Kind.Truck ? -1 : 1) : 0);
      const kv = v + (cv[k] - v) * r + (cab ? fv * 0.45 * (a.kind === Kind.Truck ? -1 : 1) : 0);
      const px = (ku - kv) * HALF_W;
      const py = (ku + kv) * HALF_H - lift - H;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.fill();
  }

  private drawLights(ctx: CanvasRenderingContext2D, a: Agent, far: boolean, night: number, alpha: number, quality: 'low' | 'high', time: number) {
    this.pos(a);
    this.heading(a);
    const u = this.pu;
    const v = this.pv;
    const hu = this.hu;
    const hv = this.hv;
    const L = DIM_L[a.kind];
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
      // On a wet road the lights run down in long streaks.
      if (this.wet > 0.15) {
        ctx.globalAlpha = alpha * n * Math.min(1, this.wet * 1.3) * 0.7;
        ctx.drawImage(this.headGlow!, x + fx - 1.6, y + fy + 0.6, 3.2, 11);
        ctx.drawImage(this.tailGlow!, x - fx - 1.4, y - fy + 0.6, 2.8, 8);
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
      // A bus's lit windows: a warm strip along its side.
      if (a.kind === Kind.Bus) {
        ctx.globalAlpha = alpha * n * 0.8;
        ctx.strokeStyle = '#ffe6a8';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x + fx * 0.8, y + fy * 0.8 - 1.2);
        ctx.lineTo(x - fx * 0.8, y - fy * 0.8 - 1.2);
        ctx.stroke();
      }
    }
    // Police: a roof bar, blue and red in turn (brighter at night).
    if (a.kind === Kind.Police) {
      const on = ((time * 3 + a.col * 0.37) | 0) & 1;
      ctx.globalAlpha = alpha * (0.35 + 0.65 * n);
      ctx.fillStyle = on ? '#3c78ff' : '#ff3048';
      ctx.fillRect(x - 0.8, y - 3, 1.6, 0.9);
      if (n > 0.25) {
        ctx.globalAlpha = alpha * n * 0.7;
        ctx.drawImage(on ? this.blueGlow! : this.tailGlow!, x - 4.5, y - 7, 9, 9);
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
