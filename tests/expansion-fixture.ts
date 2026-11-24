// Deterministic expansion fixture and the scripted expansion mayor (docs/EXPANSION.md §10.4).
//
// expansionFixture(world) adds, with World mutators only (no actions.ts, so the sim tests never
// depend on the road / skyway tools): a 60-tile highway ring with 8 on-ramps, an avenue row and
// an alley column, 300 skyway tiles docked into anchors (arcologies, with ramps on streets), two
// academies, and one Seaport (on a bay it digs along the south edge), Airport and Spaceport.
// Apply it BEFORE creating the Simulation: SimGrid reads the terrain once.
//
// ExpansionMayor wraps ScriptedMayor (tests/helpers.ts) with the measurement options of §10.4
// (rich services, avenues, a highway ring, alleys, a seaport, an airport, lifted locks). New
// roads go in with World mutators and the mayor pays their list price; the scenario ports are
// granted (placed free, like a lifted lock), since a scripted city rarely saves 45,000 CR.
//
// Created by WP-1; Step 7 extends it.

import { applyAction, lockedReason } from '../src/game/actions';
import { BUILDINGS, ROAD_KINDS } from '../src/game/config';
import { shoreFacing, shoreSites } from '../src/game/ports';
import { Simulation } from '../src/game/sim';
import { SKY_E, SKY_N, SKY_RAMP, SKY_S, SKY_W, skyRampGround } from '../src/game/skyway';
import { DAYS_PER_MONTH, MAP_SIZE, MONTHS_PER_YEAR, RoadKind, Terrain, ZoneType, type Building, type BuildingType } from '../src/game/types';
import type { World } from '../src/game/world';
import { ScriptedMayor } from './helpers';

const N = MAP_SIZE;

// ── Mutator helpers ─────────────────────────────────────────────────────────

/** Clear a rectangle to bare land (zones, roads, rail, links; buildings touching it go whole). */
export function clearRect(w: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, y0); y <= Math.min(N - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) w.clearTile(x, y);
}

/** Lay a ground road of `kind` on (x, y): an existing road changes kind, anything else is cleared first. */
export function road(w: World, x: number, y: number, kind: RoadKind): void {
  const t = w.tileAt(x, y);
  if (!t) return;
  if (t.road) w.setRoadKind(x, y, kind);
  else {
    if (t.buildingId >= 0 || t.zone !== ZoneType.None) w.clearTile(x, y);
    w.setRoad(x, y, kind);
  }
}

/** Remove every non-anchor building under the path so a skyway may pass (§3.7). */
function clearForSky(w: World, pts: readonly [number, number][]): void {
  for (const [x, y] of pts) {
    const b = w.buildingAt(x, y);
    if (b && !BUILDINGS[b.type].skyAnchor) w.removeBuilding(b.id);
  }
}

/**
 * Lay a skyway along a 4-connected path of tiles, joining onto existing sky (masks OR-ed, both
 * directions). An endpoint left with exactly one link over a Street, Avenue or Ramp gets the
 * ramp bit; a tile that gains a second link loses it. Returns the number of new sky tiles.
 */
export function skyPath(w: World, pts: readonly [number, number][]): number {
  clearForSky(w, pts);
  let fresh = 0;
  const bits = new Map<number, number>();
  const get = (x: number, y: number) => bits.get(y * N + x) ?? w.sky[y * N + x];
  for (const [x, y] of pts) if (w.sky[y * N + x] === 0) fresh++;
  for (let k = 0; k < pts.length; k++) {
    const [x, y] = pts[k];
    let m = get(x, y) & 15;
    for (const j of [k - 1, k + 1]) {
      if (j < 0 || j >= pts.length) continue;
      const [nx, ny] = pts[j];
      if (nx === x && ny === y - 1) m |= SKY_N;
      else if (nx === x + 1 && ny === y) m |= SKY_E;
      else if (nx === x && ny === y + 1) m |= SKY_S;
      else if (nx === x - 1 && ny === y) m |= SKY_W;
    }
    bits.set(y * N + x, m);
  }
  // Neighbours of the path that the path now links into gain the opposite bit.
  for (const [i, m] of [...bits]) {
    const x = i % N;
    const y = (i / N) | 0;
    const link = (dx: number, dy: number, mine: number, theirs: number) => {
      if (!(m & mine)) return;
      const j = (y + dy) * N + x + dx;
      if (!bits.has(j)) bits.set(j, (w.sky[j] & 15) | theirs);
      else bits.set(j, bits.get(j)! | theirs);
    };
    link(0, -1, SKY_N, SKY_S);
    link(1, 0, SKY_E, SKY_W);
    link(0, 1, SKY_S, SKY_N);
    link(-1, 0, SKY_W, SKY_E);
  }
  for (const [i, m] of bits) {
    const x = i % N;
    const y = (i / N) | 0;
    const links = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    const ramp = links === 1 && skyRampGround(w.tiles[i]) && (i === pts[0][1] * N + pts[0][0] || i === pts.at(-1)![1] * N + pts.at(-1)![0]);
    w.setSky(x, y, m | (ramp ? SKY_RAMP : 0));
  }
  return fresh;
}

/** Tiles of a straight horizontal (or vertical) run, inclusive. */
export function run(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    x += dx;
    y += dy;
  }
  return out;
}

/** Clear the footprint and place a building (mutators only). Returns null if it doesn't fit. */
export function placeBuilding(w: World, type: BuildingType, x: number, y: number): Building | null {
  const size = BUILDINGS[type].size;
  clearRect(w, x, y, x + size - 1, y + size - 1);
  return w.addBuilding(type, x, y);
}

// ── The fixture ─────────────────────────────────────────────────────────────

export interface ExpansionFixture {
  /** Highway ring tile indices (60) and the 8 on-ramps. */
  highway: number[];
  ramps: number[];
  /** Skyway tiles laid (300) and sky ramps (on streets). */
  sky: number;
  skyRamps: number;
  anchors: Building[];
  academies: Building[];
  seaport: Building;
  airport: Building;
  spaceport: Building;
}

export interface FixtureOptions {
  /** Days the Spaceport still has to build (0 = complete, the default). */
  spaceportDays?: number;
}

/**
 * Add every expansion structure to `w` with World mutators only (positions suit fullyBuiltWorld's
 * 4-tile road grid, and work on any 64×64 world). Deterministic: same world in, same world out.
 */
export function expansionFixture(w: World, opts: FixtureOptions = {}): ExpansionFixture {
  // A bay along the south edge (y ≥ 60) for the Seaport.
  clearRect(w, 0, 60, N - 1, N - 1);
  for (let y = 60; y < N; y++) for (let x = 0; x < N; x++) w.tiles[y * N + x].terrain = Terrain.Water;

  // Highway ring: the 16×16 square x 20..35, y 20..35 (60 tiles), and 8 on-ramps on the cross streets.
  const highway: number[] = [];
  for (let y = 20; y <= 35; y++)
    for (let x = 20; x <= 35; x++) {
      if (x !== 20 && x !== 35 && y !== 20 && y !== 35) continue;
      w.clearTile(x, y);
      w.setRoad(x, y, RoadKind.Highway);
      highway.push(y * N + x);
    }
  const ramps: number[] = [];
  for (const [x, y] of [
    [24, 19], [32, 19], [24, 36], [32, 36], [19, 24], [19, 32], [36, 24], [36, 32],
  ] as [number, number][]) {
    road(w, x, y, RoadKind.Ramp);
    ramps.push(y * N + x);
  }

  // An avenue row (y = 40) and an alley column behind homes (x = 58, y 21..39).
  for (let x = 0; x < N; x++) road(w, x, 40, RoadKind.Avenue);
  for (let y = 21; y <= 39; y++) road(w, 58, y, RoadKind.Alley);

  // Two academies, the Airport and the Spaceport.
  const academies = [placeBuilding(w, 'academy', 13, 13)!, placeBuilding(w, 'academy', 49, 37)!];
  const airport = placeBuilding(w, 'airport', 41, 9)!;
  const spaceport = placeBuilding(w, 'spaceport', 49, 45)!;
  if (opts.spaceportDays && opts.spaceportDays > 0) spaceport.buildDays = opts.spaceportDays;

  // The Seaport on the bay, facing south onto open water.
  const seaport = placeBuilding(w, 'seaport', 8, 56)!;
  const face = shoreFacing(w, 8, 56, 4);
  seaport.facing = face === -1 ? 2 : face;

  // Anchors: an arcology on each deck row.
  const rows = [6, 18, 30, 42, 54];
  const anchorX = [9, 53, 45, 13, 25];
  const anchors = rows.map((y, k) => placeBuilding(w, 'arcology', anchorX[k], y - 1)!);

  // 300 skyway tiles: five decks x 4..60 (ramps on the street columns at both ends), a connector
  // at x = 10 joining the first two decks, and a 4-tile spur south of the third.
  let sky = 0;
  for (const y of rows) sky += skyPath(w, run(4, y, 60, y));
  sky += skyPath(w, run(10, 6, 10, 18));
  sky += skyPath(w, run(50, 30, 50, 34));
  let skyRamps = 0;
  for (let i = 0; i < N * N; i++) if (w.sky[i] & SKY_RAMP) skyRamps++;
  return { highway, ramps, sky, skyRamps, anchors, academies, seaport, airport, spaceport };
}

// ── The expansion mayor (§10.4 M1–M7) ───────────────────────────────────────

export interface ExpansionMayorOptions {
  /** M2: academies, plazas, clinics and precincts as they unlock, well beyond the plain mayor. */
  richServices?: boolean;
  /** M3: widen the two central cross streets into avenues from 15,000 residents. */
  avenues?: boolean;
  /** M4: a highway ring on the grid with 4 on-ramps from 50,000 residents (`rampless` leaves the ramps out). */
  highwayRing?: boolean | 'rampless';
  /**
   * M5: back alleys behind homes (from 12,000 residents): the street between two residential
   * blocks becomes an alley (intersections stay streets, so every lot keeps a street within 3).
   */
  alleys?: boolean;
  /** M6: a Seaport on the first valid shore site from 50,000 residents. */
  seaport?: boolean;
  /** M7: an Airport at the start of this year index (e.g. 3), on the first clear site by a road. */
  airport?: number;
  /** Raise world.maxPopulation to `pop` at the start of year index `year` (unlocks a flat city never reaches). */
  liftLocks?: { year: number; pop: number }[];
}

/** M2's service rates: one per this many residents (maglevPer 0 = none; ×10 units, MEGACITY §4). Step 7 tunes them with §10.3. */
export const RICH = { academyPer: 25000, plazaPer: 2500, clinicPer: 25000, precinctPer: 30000, maglevPer: 0, reserve: 7000 };

/** ScriptedMayor plus the §10.4 options. Call opening() once, then turn() monthly (like ScriptedMayor). */
export class ExpansionMayor {
  readonly base: ScriptedMayor;
  private months = 0;
  private ring = false;
  private port = false;
  private air = false;
  /** Grid geometry of ScriptedMayor (span 11, centred): roads every 4 tiles from `o`. */
  private readonly o = Math.floor((MAP_SIZE - 44) / 2);

  constructor(
    readonly world: World,
    readonly sim: Simulation,
    readonly opts: ExpansionMayorOptions = {},
  ) {
    this.base = new ScriptedMayor(world, sim);
  }

  opening(): void {
    this.base.opening();
  }

  observe(): void {
    this.base.observe();
  }

  /** One planning turn (monthly). */
  turn(): void {
    const w = this.world;
    const year = Math.floor(this.months / MONTHS_PER_YEAR);
    if (this.months % MONTHS_PER_YEAR === 0)
      for (const l of this.opts.liftLocks ?? []) if (l.year === year && w.maxPopulation < l.pop) w.maxPopulation = l.pop;
    this.months++;
    this.base.turn();
    const pop = w.stats.population;
    if (this.opts.richServices) this.richServices(pop);
    if (this.opts.avenues && w.maxPopulation >= ROAD_KINDS[RoadKind.Avenue].unlockPop) this.widenCentre();
    if (this.opts.highwayRing && !this.ring && w.maxPopulation >= ROAD_KINDS[RoadKind.Highway].unlockPop) this.highwayRing();
    if (this.opts.alleys && w.maxPopulation >= ROAD_KINDS[RoadKind.Alley].unlockPop) this.alleys();
    if (this.opts.seaport && !this.port && w.maxPopulation >= BUILDINGS.seaport.unlockPop) this.seaport();
    if (this.opts.airport !== undefined && !this.air && year >= this.opts.airport && w.maxPopulation >= BUILDINGS.airport.unlockPop) this.airport();
    this.sim.recomputeAll();
  }

  private count(type: BuildingType): number {
    let n = 0;
    for (const b of this.world.buildings.values()) if (b.type === type) n++;
    return n;
  }

  private pay(cost: number): boolean {
    if (this.world.funds < cost) return false;
    this.world.funds -= cost;
    return true;
  }

  /**
   * M2's services, on top of the plain mayor's: academies, extra plazas, clinics and precincts as
   * they unlock, packed into the free cells of service blocks (the plain mayor puts one building
   * per 3×3 block, so most of a plaza block stays empty). A new block is taken only when no
   * service block has room, so M2 zones about the same land as M1 (§10.4).
   */
  private richServices(pop: number): void {
    const w = this.world;
    const want: [BuildingType, number, number][] = [];
    if (w.maxPopulation >= BUILDINGS.academy.unlockPop) want.push(['academy', 1 + Math.floor(pop / RICH.academyPer), RICH.reserve]);
    if (pop >= 2000) want.push(['plaza', Math.floor(pop / RICH.plazaPer), RICH.reserve]);
    if (pop >= 4000) want.push(['clinic', 1 + Math.floor(pop / RICH.clinicPer), RICH.reserve]);
    if (pop >= 2000) want.push(['precinct', 1 + Math.floor(pop / RICH.precinctPer), RICH.reserve]);
    if (RICH.maglevPer > 0 && w.maxPopulation >= BUILDINGS.maglev.unlockPop) want.push(['maglev', Math.floor(pop / RICH.maglevPer), RICH.reserve]);
    for (const [type, n, reserve] of want) if (this.count(type) < n) this.pack(type, reserve);
  }

  /** Place `type` in the first free cells of a service block (blocks with a building), else on a new block. */
  private pack(type: BuildingType, reserve: number): boolean {
    const w = this.world;
    const def = BUILDINGS[type];
    if (lockedReason(w, type) || w.funds < def.cost + reserve) return false;
    const size = def.size;
    const free = (x: number, y: number) => {
      for (let dy = 0; dy < size; dy++)
        for (let dx = 0; dx < size; dx++) {
          const t = w.tileAt(x + dx, y + dy);
          if (!t || t.terrain !== Terrain.Land || t.road || t.buildingId >= 0 || t.zone !== ZoneType.None || w.sky[(y + dy) * N + x + dx]) return false;
        }
      return true;
    };
    const tryBlock = (b: { x: number; y: number }) => {
      for (let oy = 0; oy + size <= 3; oy++)
        for (let ox = 0; ox + size <= 3; ox++) {
          if (!free(b.x + ox, b.y + oy)) continue;
          const off = Math.floor((size - 1) / 2);
          const at = { x: b.x + ox + off, y: b.y + oy + off };
          if (applyAction(w, type, at, at).valid) return true;
        }
      return false;
    };
    // Land parity with M1: while M2 has fewer service blocks than the plain mayor would have used
    // for its own services at this population, take a new block; otherwise fill free cells first.
    const pop = w.stats.population;
    const parity =
      (pop >= 3000 ? Math.floor(pop / 4000) : 0) +
      (pop >= 5000 ? Math.floor(pop / 30000) + 1 : 0) +
      (pop >= 2000 ? Math.floor(pop / 35000) + 1 : 0) +
      (pop >= 12000 ? Math.floor(pop / 50000) + 1 : 0);
    let serviceBlocks = 0;
    for (const b of this.base.blocks) if (b.used && b.building && !BUILDINGS[b.building].powerSupply) serviceBlocks++;
    // Where the service is missing: the block with the most zoned tiles in its radius whose
    // coverage of this service is still under half (ties: the earlier block, centre first).
    const field = def.effect ? w.fields[def.effect] : null;
    const r = def.radius;
    const need = (b: { x: number; y: number }) => {
      if (!field || r <= 0) return 0;
      let n = 0;
      const cx = b.x + 1;
      const cy = b.y + 1;
      for (let y = Math.max(0, cy - r); y <= Math.min(N - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(N - 1, cx + r); x++) {
          const i = y * N + x;
          const z = w.tiles[i].zone;
          // Schools matter most to Fab Yards (their score weight is 3.5× a home's, §4.2).
          if (z !== ZoneType.None && field[i] < 0.5) n += def.effect === 'education' && z === ZoneType.Industrial ? 3 : 1;
        }
      return n;
    };
    const best = <T extends { x: number; y: number }>(list: T[]): T[] => {
      const scored = list.map((b, k) => ({ b, k, n: need(b) }));
      scored.sort((a, c) => c.n - a.n || a.k - c.k);
      return scored.map((e) => e.b);
    };
    if (serviceBlocks >= parity) for (const b of best(this.base.blocks.filter((k) => k.used && k.building))) if (tryBlock(b)) return true;
    // A new block, the way the plain mayor takes one (utility blocks first, then the outermost),
    // picked by the same need among the first few candidates.
    const placer = this.base as unknown as { roadsAround(b: unknown): boolean };
    const util = this.base.blocks.filter((k) => !k.used && k.role === 'util');
    const pool = util.length ? util : [...this.base.blocks].reverse().filter((k) => !k.used).slice(0, 6);
    const nb = best(pool)[0];
    if (!nb || !placer.roadsAround(nb)) return false;
    nb.used = true;
    nb.building = type;
    return tryBlock(nb);
  }

  /** Grid line coordinate k (0..11) of ScriptedMayor's road grid. */
  private line(k: number): number {
    return this.o + k * 4;
  }

  private widenCentre(): void {
    const w = this.world;
    const c = this.line(5);
    const diff = ROAD_KINDS[RoadKind.Avenue].cost - ROAD_KINDS[RoadKind.Street].cost;
    for (let k = 0; k < N; k++)
      for (const [x, y] of [
        [c, k],
        [k, c],
      ] as [number, number][]) {
        const t = w.tileAt(x, y)!;
        if (!t.road || t.roadKind !== RoadKind.Street || t.terrain !== Terrain.Land) continue;
        if (!this.pay(diff)) return;
        w.setRoadKind(x, y, RoadKind.Avenue);
      }
  }

  /** A highway ring on grid lines 1 and 9 (the inner ring of blocks), with 4 ramps on its west side's cross streets. */
  private highwayRing(): void {
    const w = this.world;
    const a = this.line(1);
    const b = this.line(9);
    const hw = ROAD_KINDS[RoadKind.Highway];
    const tiles: [number, number][] = [];
    for (let k = a; k <= b; k++) tiles.push([k, a], [k, b], [a, k], [b, k]);
    const cost = tiles.length * (hw.cost - ROAD_KINDS[RoadKind.Street].cost) + 4 * ROAD_KINDS[RoadKind.Ramp].cost;
    if (!this.pay(cost)) return;
    this.ring = true;
    for (const [x, y] of tiles) road(this.world, x, y, RoadKind.Highway);
    if (this.opts.highwayRing === 'rampless') return;
    // Ramps where the cross streets meet the ring: outside the north and south sides, two each.
    for (const [x, y] of [
      [this.line(3), a - 1],
      [this.line(7), a - 1],
      [this.line(3), b + 1],
      [this.line(7), b + 1],
    ] as [number, number][]) {
      if (w.inBounds(x, y)) road(w, x, y, RoadKind.Ramp);
    }
  }

  /** The street segment between two vertically adjacent residential blocks becomes a back alley. */
  private alleys(): void {
    const w = this.world;
    const res = new Set<string>();
    for (const blk of this.base.blocks) if (blk.used && blk.role === 'res') res.add(`${blk.bx},${blk.by}`);
    for (const blk of this.base.blocks) {
      if (!blk.used || blk.role !== 'res' || !res.has(`${blk.bx},${blk.by + 1}`)) continue;
      const y = blk.y + 3;
      for (let dx = 0; dx < 3; dx++) {
        const t = w.tileAt(blk.x + dx, y);
        if (t && t.road && t.roadKind === RoadKind.Street && t.terrain === Terrain.Land) w.setRoadKind(blk.x + dx, y, RoadKind.Alley);
      }
    }
  }

  /** First valid shore site (shoreSites), with a street laid toward the nearest road if it has none in reach. */
  private seaport(): void {
    const w = this.world;
    const marks = new Uint8Array(N * N);
    if (shoreSites(w, marks) === 0) {
      this.port = true; // flat map: no shore
      return;
    }
    const i = marks.indexOf(1);
    const x = i % N;
    const y = (i / N) | 0;
    this.port = true;
    const b = w.addBuilding('seaport', x, y)!;
    const f = shoreFacing(w, x, y, 4);
    b.facing = f === -1 ? 2 : f;
    this.connect(b);
  }

  private airport(): void {
    const w = this.world;
    const size = BUILDINGS.airport.size;
    for (let y = 0; y + size <= N; y++)
      for (let x = 0; x + size <= N; x++) {
        if (!this.clearSite(x, y, size)) continue;
        if (!this.touchesRoad(x, y, size)) continue; // touching a road: road access and power
        this.air = true;
        w.addBuilding('airport', x, y);
        return;
      }
  }

  private clearSite(x: number, y: number, size: number): boolean {
    const w = this.world;
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const t = w.tileAt(x + dx, y + dy);
        if (!t || t.terrain !== Terrain.Land || t.road || t.buildingId >= 0 || t.zone !== ZoneType.None || w.sky[(y + dy) * N + x + dx]) return false;
      }
    return true;
  }

  /** Does a 4-neighbour of the size×size footprint at (x, y) carry a road (access and power)? */
  private touchesRoad(x: number, y: number, size: number): boolean {
    const w = this.world;
    for (let k = 0; k < size; k++)
      if (w.isRoad(x + k, y - 1) || w.isRoad(x + k, y + size) || w.isRoad(x - 1, y + k) || w.isRoad(x + size, y + k)) return true;
    return false;
  }

  /** Lay an L-shaped street from the building's edge to the closest existing road, unless one already touches it. */
  private connect(b: Building): void {
    const w = this.world;
    if (this.touchesRoad(b.x, b.y, b.size)) return;
    let best = -1;
    let bestD = Infinity;
    const cx = b.x + (b.size >> 1);
    const cy = b.y + (b.size >> 1);
    for (let i = 0; i < N * N; i++) {
      if (!w.tiles[i].road) continue;
      const d = Math.abs((i % N) - cx) + Math.abs(((i / N) | 0) - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    const tx = best % N;
    const ty = (best / N) | 0;
    // Start on the 4-neighbour of the footprint facing the target (never a diagonal corner).
    let sx: number;
    let sy: number;
    if (tx >= b.x && tx < b.x + b.size) {
      sx = tx;
      sy = ty < b.y ? b.y - 1 : b.y + b.size;
    } else {
      sx = tx < b.x ? b.x - 1 : b.x + b.size;
      sy = Math.max(b.y, Math.min(b.y + b.size - 1, ty));
    }
    for (const [x, y] of [...run(sx, sy, tx, sy), ...run(tx, sy, tx, ty)]) {
      const t = w.tileAt(x, y);
      if (!t || t.road || t.buildingId >= 0) continue;
      if (!this.pay(t.terrain === Terrain.Water ? ROAD_KINDS[0].bridgeCost! : ROAD_KINDS[0].cost)) return;
      w.setRoad(x, y);
    }
  }
}

/** Play `years` with an ExpansionMayor; returns it with the sim. Funds are observed every tick. */
export function playExpansion(world: World, years: number, opts: ExpansionMayorOptions = {}, events = false) {
  const sim = new Simulation(world);
  sim.options.events = events;
  sim.recomputeAll();
  const mayor = new ExpansionMayor(world, sim, opts);
  mayor.opening();
  for (let m = 0; m < years * MONTHS_PER_YEAR; m++) {
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      sim.step();
      mayor.observe();
    }
    mayor.turn();
  }
  return { sim, mayor };
}

// ── Scenario measurement (§10.3 / §10.4; Step 7) ────────────────────────────

/** What one scenario run measured (the §10.4 columns plus what §10.3's checks need). */
export interface ScenarioResult {
  pop: number;
  approval: number;
  avgTraffic: number;
  avgNoise: number;
  avgCrime: number;
  avgLandValue: number;
  /** Developed tiles by zone (res, com, ind) and tier: split[zone - 1][tier]. */
  split: [number, number, number][];
  jobsInd: number;
  jobsCom: number;
  /** Mean of the last 12 monthly nets. */
  net: number;
  visitors: number;
  /** Mean traffic over Highway tiles (0 with none). */
  highwayLoad: number;
  /** Mean skyTraffic over skyway tiles (0 with none). */
  skyLoad: number;
  /** Tier changes per developed tile per year over the last two years, and the most any one tile changed there. */
  tierChangesPerTileYear: number;
  maxTierChanges2y: number;
  tierEffect: { residents: number; tax: number };
  /** Day the population first reached each chapter goal (−1 = never). */
  reach: Record<number, number>;
  /** Mean crime over developed tiles within 1 of an alley (−1 with none). */
  alleyCrime: number;
  /** Income lines of the last month by label. */
  income: Record<string, number>;
  /** Stats at the end of each month (index = month). */
  monthly: { pop: number; jobsInd: number; jobsCom: number; trade: number; net: number }[];
  /** Month the scenario's port went down (−1 = none). */
  portMonth: number;
}

/** res + com developed share by tier, in percent. */
export function resComSplit(r: ScenarioResult): [number, number, number] {
  const s = [0, 1, 2].map((t) => r.split[0][t] + r.split[1][t]);
  const tot = s[0] + s[1] + s[2] || 1;
  return [(100 * s[0]) / tot, (100 * s[1]) / tot, (100 * s[2]) / tot];
}

/** Share (percent) of developed Fab tiles at $$ or better. */
export function fabUpShare(r: ScenarioResult): number {
  const f = r.split[2];
  return (100 * (f[1] + f[2])) / (f[0] + f[1] + f[2] || 1);
}

/** Play `years` with an ExpansionMayor and measure. Deterministic for the same world and options. */
export function playScenario(world: World, years: number, opts: ExpansionMayorOptions = {}, goals: readonly number[] = [30000, 70000]): ScenarioResult & { sim: Simulation; mayor: ExpansionMayor } {
  const sim = new Simulation(world);
  sim.options.events = false;
  sim.recomputeAll();
  const mayor = new ExpansionMayor(world, sim, opts);
  mayor.opening();
  const reach: Record<number, number> = {};
  for (const g of goals) reach[g] = -1;
  const changes = new Uint16Array(N * N);
  const prev = new Uint8Array(N * N);
  const monthly: ScenarioResult['monthly'] = [];
  let portMonth = -1;
  let day = 0;
  const watchFrom = (years - 2) * MONTHS_PER_YEAR * DAYS_PER_MONTH;
  for (let m = 0; m < years * MONTHS_PER_YEAR; m++) {
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      sim.step();
      mayor.observe();
      day++;
      const pop = world.stats.population;
      for (const g of goals) if (reach[g] < 0 && pop >= g) reach[g] = day;
      if (day > watchFrom) {
        for (let i = 0; i < N * N; i++) {
          const t = world.tiles[i];
          const v = t.level > 0 && !t.abandoned ? t.wealth : 255;
          if (v !== prev[i] && v !== 255 && prev[i] !== 255) changes[i]++;
          prev[i] = v;
        }
      } else if (day === watchFrom) {
        for (let i = 0; i < N * N; i++) {
          const t = world.tiles[i];
          prev[i] = t.level > 0 && !t.abandoned ? t.wealth : 255;
        }
      }
    }
    const hadPort = portMonth >= 0;
    mayor.turn();
    if (!hadPort) for (const b of world.buildings.values()) if (b.type === 'seaport' || b.type === 'airport') portMonth = m;
    const trade = world.budget.incomeLines.find((l) => l.label === 'Port trade')?.amount ?? 0;
    monthly.push({ pop: world.stats.population, jobsInd: world.stats.jobsInd, jobsCom: world.stats.jobsCom, trade, net: world.budget.history.at(-1) ?? 0 });
  }
  return { ...measureWorld(world, changes, years, reach, monthly, portMonth), sim, mayor };
}

function measureWorld(
  w: World,
  changes: Uint16Array,
  years: number,
  reach: Record<number, number>,
  monthly: ScenarioResult['monthly'],
  portMonth: number,
): ScenarioResult {
  const s = w.stats;
  const f = w.fields;
  const split: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let developed = 0;
  let totalChanges = 0;
  let maxCh = 0;
  let hw = 0;
  let hwSum = 0;
  let sky = 0;
  let skySum = 0;
  let nearAlley = 0;
  let nearAlleySum = 0;
  for (let i = 0; i < N * N; i++) {
    const t = w.tiles[i];
    if (t.road && t.roadKind === RoadKind.Highway) {
      hw++;
      hwSum += f.traffic[i];
    }
    if (w.sky[i] & 15) {
      sky++;
      skySum += f.skyTraffic[i];
    }
    if (t.zone === ZoneType.None || t.level === 0 || t.abandoned) continue;
    developed++;
    split[t.zone - 1][t.wealth]++;
    totalChanges += changes[i];
    if (changes[i] > maxCh) maxCh = changes[i];
    const x = i % N;
    const y = (i / N) | 0;
    let alley = false;
    for (let dy = -1; dy <= 1 && !alley; dy++)
      for (let dx = -1; dx <= 1 && !alley; dx++) {
        const n = w.tileAt(x + dx, y + dy);
        if (n && n.road && n.roadKind === RoadKind.Alley) alley = true;
      }
    if (alley) {
      nearAlley++;
      nearAlleySum += f.crime[i];
    }
  }
  const hist = w.budget.history.slice(-12);
  const income: Record<string, number> = {};
  for (const l of w.budget.incomeLines) income[l.label] = l.amount;
  return {
    pop: s.population,
    approval: s.approval,
    avgTraffic: s.avgTraffic,
    avgNoise: s.avgNoise,
    avgCrime: s.avgCrime,
    avgLandValue: s.avgLandValue,
    split,
    jobsInd: s.jobsInd,
    jobsCom: s.jobsCom,
    net: hist.reduce((a, b) => a + b, 0) / Math.max(1, hist.length),
    visitors: s.visitors,
    highwayLoad: hw ? hwSum / hw : 0,
    skyLoad: sky ? skySum / sky : 0,
    tierChangesPerTileYear: developed ? totalChanges / developed / Math.min(2, years) : 0,
    maxTierChanges2y: maxCh,
    tierEffect: { ...s.tierEffect },
    reach,
    alleyCrime: nearAlley ? nearAlleySum / nearAlley : -1,
    income,
    monthly,
    portMonth,
  };
}
