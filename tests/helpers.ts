// Shared test helpers: tiny world builders and a scripted "mayor" that grows a
// city the way a sensible player would (road grid, mixed zones, power and
// services as they unlock). Used by the balance and perf tests.

import { applyAction, lockedReason, type Point } from '../src/game/actions';
import { BUILDINGS } from '../src/game/config';
import { Simulation } from '../src/game/sim';
import { Terrain, type BuildingType, type ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { LEGACY_REGION } from '../src/game/types';

/** A flat, all-land world (no generated water) for deterministic tests. */
export function flatWorld(seed = 1234, name = 'Testopolis'): World {
  return new World(seed, name, undefined, LEGACY_REGION);
}

/** A simulation with random events off unless asked. */
export function makeSim(world: World, events = false): Simulation {
  const sim = new Simulation(world);
  sim.options.events = events;
  sim.recomputeAll();
  return sim;
}

/** Apply a tool and return whether it did anything. */
export function act(world: World, tool: ToolId, from: Point, to: Point = from): boolean {
  return applyAction(world, tool, from, to).valid;
}

/** Run n ticks, calling `each` after every step. */
export function run(sim: Simulation, n: number, each?: (sim: Simulation) => void): void {
  for (let i = 0; i < n; i++) {
    sim.step();
    each?.(sim);
  }
}

type Role = 'res' | 'com' | 'ind' | 'util';

interface Block {
  bx: number;
  by: number;
  /** Top-left interior tile. */
  x: number;
  y: number;
  role: Role;
  used: boolean;
  /** Utility blocks: what was placed. */
  building?: BuildingType;
}

/**
 * Grows a city on a 4-tile road grid (3×3 blocks). Each month it adds power
 * when the grid runs hot, services as they unlock and money allows, and new
 * blocks of whichever zone has demand and no spare lots.
 */
export class ScriptedMayor {
  readonly blocks: Block[] = [];
  private readonly ox: number;
  private readonly oy: number;
  /** Grid intersection at the centre: every block's ring road is linked to it. */
  private readonly hub: Point;
  /** Lowest funds seen (checked every tick by the balance test). */
  lowestFunds = Infinity;
  actions = 0;
  /** Whether the mayor builds services at all (off = stress test). */
  private readonly services: boolean;

  constructor(
    readonly world: World,
    readonly sim: Simulation,
    opts: { ox?: number; oy?: number; span?: number; services?: boolean } = {},
  ) {
    this.services = opts.services ?? true;
    const span = opts.span ?? 11;
    const N = world.N;
    this.ox = opts.ox ?? Math.floor((N - span * 4) / 2);
    this.oy = opts.oy ?? Math.floor((N - span * 4) / 2);
    const c = Math.floor((span - 1) / 2);
    this.hub = { x: this.ox + c * 4, y: this.oy + c * 4 };
    for (let by = 0; by < span; by++)
      for (let bx = 0; bx < span; bx++) {
        const x = this.ox + bx * 4 + 1;
        const y = this.oy + by * 4 + 1;
        if (x + 3 >= N || y + 3 >= N) continue;
        let role: Role;
        if (by >= span - 2) role = (bx % 4 === 1 ? 'util' : 'ind');
        else if (by === span - 3 && bx % 3 === 0) role = 'util';
        else if ((bx + by * 2) % 4 === 0) role = 'com';
        else if (bx % 3 === 1 && by % 3 === 1) role = 'util';
        else role = 'res';
        this.blocks.push({ bx, by, x, y, role, used: false });
      }
    // Expand outward from the centre (industry hugs the south edge of the grid).
    this.blocks.sort((a, b) => Math.hypot(a.bx - c, a.by - c) - Math.hypot(b.bx - c, b.by - c));
  }

  /** Lay the four roads around a block plus a link to the hub (existing road tiles cost nothing). */
  private roadsAround(b: Block): boolean {
    const x0 = b.x - 1;
    const y0 = b.y - 1;
    const x1 = b.x + 3;
    const y1 = b.y + 3;
    let ok = true;
    for (const [a, c] of [
      [{ x: x0, y: y0 }, { x: x1, y: y0 }],
      [{ x: x0, y: y1 }, { x: x1, y: y1 }],
      [{ x: x0, y: y0 }, { x: x0, y: y1 }],
      [{ x: x1, y: y0 }, { x: x1, y: y1 }],
      [{ x: x0, y: y0 }, this.hub],
    ] as [Point, Point][]) {
      const plan = applyAction(this.world, 'road', a, c);
      if (!plan.valid && plan.reason?.startsWith('Not enough')) ok = false;
      if (plan.valid) this.actions++;
    }
    return ok;
  }

  private zoneBlock(role: 'res' | 'com' | 'ind', reserve: number): boolean {
    const b = this.blocks.find((k) => !k.used && k.role === role);
    if (!b || this.world.funds < 600 + reserve) return false;
    if (!this.roadsAround(b)) return false;
    const ok = act(this.world, role, { x: b.x, y: b.y }, { x: b.x + 2, y: b.y + 2 });
    // A block that can't be zoned (e.g. under water) is skipped for good.
    b.used = true;
    if (ok) this.actions++;
    return ok;
  }

  private place(type: BuildingType, reserve: number): boolean {
    const def = BUILDINGS[type];
    if (lockedReason(this.world, type) || this.world.funds < def.cost + reserve) return false;
    // Prefer utility blocks; fall back to the outermost free block when they run out.
    let b = this.blocks.find((k) => !k.used && k.role === 'util');
    if (!b) b = [...this.blocks].reverse().find((k) => !k.used);
    if (!b) return false;
    if (!this.roadsAround(b)) return false;
    // footprintOrigin centres on the tapped tile: offset so the footprint starts at the block corner.
    const off = Math.floor((def.size - 1) / 2);
    const ok = act(this.world, type, { x: b.x + off, y: b.y + off });
    if (ok) {
      b.used = true;
      b.building = type;
      this.actions++;
    } else if (this.world.funds >= def.cost) b.used = true; // blocked site: skip it
    return ok;
  }

  private count(type: BuildingType): number {
    let n = 0;
    for (const b of this.world.buildings.values()) if (b.type === type) n++;
    return n;
  }

  private emptyLots(role: 'res' | 'com' | 'ind'): number {
    const zone = role === 'res' ? 1 : role === 'com' ? 2 : 3;
    let n = 0;
    for (const t of this.world.tiles) if (t.zone === zone && t.level === 0 && !t.abandoned) n++;
    return n;
  }

  /** The opening: a power plant and a handful of mixed blocks. */
  opening(): void {
    this.zoneBlock('res', 0);
    this.zoneBlock('ind', 0);
    this.place('solar', 0);
    this.zoneBlock('res', 0);
    this.zoneBlock('com', 0);
    this.zoneBlock('ind', 0);
    this.sim.recomputeAll();
  }

  /** One planning turn (call monthly). */
  turn(): void {
    const w = this.world;
    const s = w.stats;
    const pop = s.population;

    // Power first: keep 25% headroom.
    if (s.powerSupply === 0 || s.powerDemand > s.powerSupply * 0.75) {
      if (!lockedReason(w, 'reactor') && w.funds > 9000) this.place('reactor', 800);
      else if (s.powerSupply < 600 || lockedReason(w, 'reactor')) this.place('solar', 300);
    }
    // Services as the city grows (only when comfortably funded). Head counts in ×10 units (MEGACITY §4).
    if (this.services && pop >= 2000 && this.count('precinct') < 1 + Math.floor(pop / 35000)) this.place('precinct', 3000);
    if (this.services && pop >= 5000 && this.count('clinic') < Math.floor(pop / 30000) + 1) this.place('clinic', 4000);
    if (this.services && pop >= 3000 && this.count('plaza') < Math.floor(pop / 4000)) this.place('plaza', 2500);
    if (this.services && pop >= 12000 && this.count('datahub') < Math.floor(pop / 50000) + 1) this.place('datahub', 5000);

    // Zones: add a block where demand is positive and spare lots run low.
    const d = s.demand;
    const order: ['res' | 'com' | 'ind', number][] = [
      ['res', d.res],
      ['com', d.com],
      ['ind', d.ind],
    ];
    order.sort((a, b) => b[1] - a[1]);
    for (const [role, dem] of order) {
      if (dem > 0.05 && this.emptyLots(role) < 5) this.zoneBlock(role, 800);
    }
    this.sim.recomputeAll();
  }

  /** Track the funds low-water mark. */
  observe(): void {
    if (this.world.funds < this.lowestFunds) this.lowestFunds = this.world.funds;
  }
}

/**
 * A fully built 64×64 map for perf tests: a road grid every 4 tiles, every
 * block zoned and developed to high density, with plants and services sprinkled in.
 */
export function fullyBuiltWorld(seed = 99): World {
  const w = new World(seed, 'Perf City', undefined, LEGACY_REGION);
  w.funds = 1e9;
  w.maxPopulation = 1e9;
  const N = w.N;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (x % 4 === 0 || y % 4 === 0) w.setRoad(x, y);
    }
  const services: BuildingType[] = ['precinct', 'clinic', 'datahub', 'maglev', 'plaza', 'spire'];
  let k = 0;
  for (let by = 0; by < 16; by++)
    for (let bx = 0; bx < 16; bx++) {
      const x = bx * 4 + 1;
      const y = by * 4 + 1;
      if (x + 2 >= N || y + 2 >= N) continue;
      k++;
      if (k % 9 === 0) {
        w.addBuilding('reactor', x, y);
        continue;
      }
      if (k % 7 === 0) {
        w.addBuilding(services[k % services.length], x, y);
        continue;
      }
      const zone = k % 3 === 0 ? 3 : k % 3 === 1 ? 1 : 2;
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
          const t = w.tileAt(x + dx, y + dy)!;
          if (t.terrain !== Terrain.Land || t.buildingId >= 0) continue;
          w.setZone(x + dx, y + dy, zone);
          w.setLevel(x + dx, y + dy, 1 + ((dx + dy + k) % 3));
        }
    }
  return w;
}
