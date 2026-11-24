// The density pass measured (docs/MEGACITY.md §4.1 step 2, §11.3 S2 and S4); read by
// tests/megacity-scale.test.ts.
//
//   DemandMayor         S4's demand-led mayor: a 15 × 15 grid of 3 × 3 blocks on a 4-tile road
//                       pitch (the whole 64 × 64 district); power with 25% headroom and the services
//                       a player after land value builds (parks, safety, health, the net, transit;
//                       small ones share a utility block); each month up to two blocks of the zone
//                       with the highest demand (> 0.05) that has fewer than 5 empty lots. Homes
//                       and shops fill from the centre out, fabs from the south rows up, so the
//                       land use is the demand's, not a plan's.
//   demandLedRun        S4's 12-year run with a snapshot each year end: developed land by zone and
//                       level, unemployment, traffic, the Balance of Power. `landValueAdd` lifts
//                       every tile (a downtown where homes and shops reach L3).
//   scriptedMayorYears  S2's run: tests/helpers.ts' ScriptedMayor (events on, as the pinned v3
//                       baseline ran it), one snapshot per year; `diceShift` draws the world's
//                       rng that many times after the opening (the same city with other dice:
//                       the run-to-run noise S2's bands are read against).
//   unitsOnly(fn)       runs fn with Market and Fab capacities at v3 × 10 (the density pass undone
//                       in ZONES and the sim's flat tables), then restores them. With it, the
//                       ScriptedMayor replays the pinned v3 baseline exactly: the counterfactual
//                       every comparison here is made against.

import { applyAction, lockedReason, type Point } from '../src/game/actions';
import { BUILDINGS, FACTION_IDS, ZONES } from '../src/game/config';
import type { Simulation } from '../src/game/sim';
import { CAP_T } from '../src/game/sim/tiers';
import { powerShare } from '../src/game/story/factions';
import type { FactionId } from '../src/game/story/types';
import { DAYS_PER_MONTH, MAP_SIZE, MONTHS_PER_YEAR, ZoneType, type BuildingType } from '../src/game/types';
import { zoneCapacity } from '../src/game/wealth';
import type { World } from '../src/game/world';
import { ScriptedMayor, act, flatWorld, makeSim } from './helpers';

type Zone = 'res' | 'com' | 'ind';

interface Block {
  bx: number;
  by: number;
  /** Top-left interior tile. */
  x: number;
  y: number;
  util: boolean;
  used: boolean;
}

const SPAN = 15;
const ORIGIN = Math.floor((MAP_SIZE - SPAN * 4) / 2);

/** Grows a district on demand alone (see the file header). */
export class DemandMayor {
  readonly blocks: Block[] = [];
  private readonly hub: Point;
  lowestFunds = Infinity;
  /** Blocks zoned per zone type, in order. */
  readonly zoned: Record<Zone, number> = { res: 0, com: 0, ind: 0 };

  constructor(
    readonly world: World,
    readonly sim: Simulation,
  ) {
    const c = Math.floor((SPAN - 1) / 2);
    this.hub = { x: ORIGIN + c * 4, y: ORIGIN + c * 4 };
    for (let by = 0; by < SPAN; by++)
      for (let bx = 0; bx < SPAN; bx++) {
        const x = ORIGIN + bx * 4 + 1;
        const y = ORIGIN + by * 4 + 1;
        if (x + 3 >= MAP_SIZE || y + 3 >= MAP_SIZE) continue;
        this.blocks.push({ bx, by, x, y, util: bx % 3 === 1 && by % 3 === 1, used: false });
      }
    // Nearest the centre first (power and services take the nearest free utility block).
    this.blocks.sort((a, b) => this.dist(a) - this.dist(b) || a.by - b.by || a.bx - b.bx);
  }

  private dist(b: Block): number {
    const c = (SPAN - 1) / 2;
    return Math.hypot(b.bx - c, b.by - c);
  }

  /** Homes and shops: the free block nearest the centre. Fabs: the southernmost free row, nearest the centre column. */
  private pick(zone: Zone): Block | undefined {
    const free = this.blocks.filter((b) => !b.used && !b.util);
    if (zone === 'ind') {
      const c = (SPAN - 1) / 2;
      free.sort((a, b) => b.by - a.by || Math.abs(a.bx - c) - Math.abs(b.bx - c));
    } else free.sort((a, b) => this.dist(a) - this.dist(b) || a.by - b.by || a.bx - b.bx);
    return free[0];
  }

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
    }
    return ok;
  }

  private zoneBlock(zone: Zone, reserve: number): boolean {
    const b = this.pick(zone);
    if (!b || this.world.funds < 600 + reserve) return false;
    if (!this.roadsAround(b)) return false;
    b.used = true;
    const ok = act(this.world, zone, { x: b.x, y: b.y }, { x: b.x + 2, y: b.y + 2 });
    if (ok) this.zoned[zone]++;
    return ok;
  }

  /**
   * Place a building in a utility block: the nearest one to the centre that still has room
   * (several small buildings share a block); a block where nothing fits is closed.
   */
  private place(type: BuildingType, reserve: number): boolean {
    const def = BUILDINGS[type];
    if (lockedReason(this.world, type) || this.world.funds < def.cost + reserve) return false;
    for (const b of this.blocks) {
      if (b.used || !b.util) continue;
      if (!this.roadsAround(b)) return false;
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
          if (act(this.world, type, { x: b.x + dx, y: b.y + dy })) return true;
        }
      // Nothing fits: close it unless it is simply too small for this type.
      if (def.size === 1) b.used = true;
    }
    return false;
  }

  private count(type: BuildingType): number {
    let n = 0;
    for (const b of this.world.buildings.values()) if (b.type === type) n++;
    return n;
  }

  private emptyLots(zone: Zone): number {
    const z = zone === 'res' ? ZoneType.Residential : zone === 'com' ? ZoneType.Commercial : ZoneType.Industrial;
    let n = 0;
    for (const t of this.world.tiles) if (t.zone === z && t.level === 0 && !t.abandoned) n++;
    return n;
  }

  opening(): void {
    this.place('solar', 0);
    this.zoneBlock('res', 0);
    this.zoneBlock('res', 0);
    this.zoneBlock('ind', 0);
    this.zoneBlock('com', 0);
    this.sim.recomputeAll();
  }

  /** One monthly turn. */
  turn(): void {
    const w = this.world;
    const s = w.stats;
    const pop = s.population;
    if (s.powerSupply === 0 || s.powerDemand > s.powerSupply * 0.75) {
      if (!lockedReason(w, 'reactor') && w.funds > 9000) this.place('reactor', 800);
      else if (s.powerSupply < 600 || lockedReason(w, 'reactor')) this.place('solar', 300);
    }
    // Services, generously (a player after land value, so homes and shops can reach L2–L3):
    // parks, safety, health, the net and transit, each a share of the population (×10 units).
    if (pop >= 1500 && this.count('precinct') < 1 + Math.floor(pop / 25000)) this.place('precinct', 2000);
    if (pop >= 4000 && this.count('clinic') < 1 + Math.floor(pop / 25000)) this.place('clinic', 2000);
    if (this.count('plaza') < 2 + Math.floor(pop / 2500)) this.place('plaza', 1000);
    if (pop >= 10000 && this.count('datahub') < 1 + Math.floor(pop / 20000)) this.place('datahub', 2000);
    if (pop >= 20000 && this.count('maglev') < Math.floor(pop / 40000) + 1) this.place('maglev', 3000);
    // Zoning: whichever zone has the highest demand, up to two blocks a month.
    for (let k = 0; k < 2; k++) {
      const d = s.demand;
      const want = (['res', 'com', 'ind'] as const)
        .map((z) => [z, d[z]] as const)
        .filter(([z, v]) => v > 0.05 && this.emptyLots(z) < 5)
        .sort((a, b) => b[1] - a[1])[0];
      if (!want || !this.zoneBlock(want[0], 800)) break;
    }
    this.sim.recomputeAll();
  }

  observe(): void {
    if (this.world.funds < this.lowestFunds) this.lowestFunds = this.world.funds;
  }
}

export interface S4Year {
  year: number;
  pop: number;
  jobsCom: number;
  jobsInd: number;
  /** Developed tiles by zone. */
  dev: { res: number; com: number; ind: number };
  /** Share of developed zone land, 0..1. */
  share: { res: number; com: number; ind: number };
  /** Developed tiles by zone and level 1..3. */
  levels: { res: number[]; com: number[]; ind: number[] };
  unemployment: number;
  avgTraffic: number;
  avgPollution: number;
  avgLandValue: number;
  approval: number;
  funds: number;
  net: number;
  demand: { res: number; com: number; ind: number };
  power: Record<FactionId, number>;
}

export interface S4Run {
  seed: number;
  years: S4Year[];
  lowestFunds: number;
  zoned: Record<Zone, number>;
}

function snapshot(w: World, sim: Simulation, year: number): S4Year {
  const s = w.stats;
  const dev = { res: s.developed.res, com: s.developed.com, ind: s.developed.ind };
  const all = dev.res + dev.com + dev.ind || 1;
  const lc = (sim as unknown as { census: { levelCount: Int32Array } }).census.levelCount;
  const lv = (z: number) => [lc[z * 4 + 1], lc[z * 4 + 2], lc[z * 4 + 3]];
  const power = {} as Record<FactionId, number>;
  for (const f of FACTION_IDS) power[f] = powerShare(w, f);
  return {
    year,
    pop: s.population,
    jobsCom: s.jobsCom,
    jobsInd: s.jobsInd,
    dev,
    share: { res: dev.res / all, com: dev.com / all, ind: dev.ind / all },
    levels: { res: lv(1), com: lv(2), ind: lv(3) },
    unemployment: s.unemployment,
    avgTraffic: s.avgTraffic,
    avgPollution: s.avgPollution,
    avgLandValue: s.avgLandValue,
    approval: s.approval,
    funds: Math.round(w.funds),
    net: w.budget.history.at(-1) ?? 0,
    demand: { ...s.demand },
    power,
  };
}

/**
 * The S4 run: a flat district, events off, `years` sim years (12 for S4), a snapshot each year
 * end. `landValueAdd` lifts every tile's land value (a downtown whose homes and shops can all
 * reach L3, the "balanced L3 city" of §4.1); 0 is the plain district.
 */
export function demandLedRun(seed: number, years = 12, landValueAdd = 0): S4Run {
  const w = flatWorld(seed, 'Demand City');
  w.mods.landValueAdd = landValueAdd;
  const sim = makeSim(w, false);
  const mayor = new DemandMayor(w, sim);
  mayor.opening();
  const out: S4Year[] = [];
  for (let m = 0; m < years * MONTHS_PER_YEAR; m++) {
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      sim.step();
      mayor.observe();
    }
    mayor.turn();
    if ((m + 1) % MONTHS_PER_YEAR === 0) out.push(snapshot(w, sim, (m + 1) / MONTHS_PER_YEAR));
  }
  return { seed, years: out, lowestFunds: mayor.lowestFunds, zoned: { ...mayor.zoned } };
}

export interface S2Year {
  pop: number;
  jobs: number;
  funds: number;
  net: number;
  unemployment: number;
  avgTraffic: number;
  power: Record<FactionId, number>;
}

/** S2's run: the ScriptedMayor for `years` sim years, a snapshot at each year end. */
export function scriptedMayorYears(seed: number, years = 8, diceShift = 0): S2Year[] {
  const w = flatWorld(seed);
  const sim = makeSim(w, true);
  const mayor = new ScriptedMayor(w, sim);
  mayor.opening();
  for (let i = 0; i < diceShift; i++) w.rng.next();
  const out: S2Year[] = [];
  for (let m = 0; m < years * MONTHS_PER_YEAR; m++) {
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      sim.step();
      mayor.observe();
    }
    mayor.turn();
    if ((m + 1) % MONTHS_PER_YEAR !== 0) continue;
    const s = w.stats;
    const power = {} as Record<FactionId, number>;
    for (const f of FACTION_IDS) power[f] = powerShare(w, f);
    out.push({ pop: s.population, jobs: s.jobsCom + s.jobsInd, funds: Math.round(w.funds), net: w.budget.history.at(-1) ?? 0, unemployment: s.unemployment, avgTraffic: s.avgTraffic, power });
  }
  return out;
}

/** Market and Fab capacities by units alone (v3 × 10): what the density pass replaced. */
const UNITS_ONLY: Record<'com' | 'ind', [number, number, number, number]> = { com: [0, 80, 280, 900], ind: [0, 120, 340, 750] };

/** Rebuild the sim's capacity table rows for Market and Fab from ZONES (as sim/tiers.ts does at load). */
function refreshCapacity(): void {
  for (const z of [ZoneType.Commercial, ZoneType.Industrial])
    for (let l = 0; l <= 3; l++) for (let t = 0; t <= 2; t++) CAP_T[z * 12 + l * 3 + t] = zoneCapacity(z, l, t);
}

/** Run `fn` with the density pass undone (Market and Fab at v3 × 10), then restore today's tables. */
export function unitsOnly<T>(fn: () => T): T {
  const keep = { com: [...ZONES.com.capacity] as [number, number, number, number], ind: [...ZONES.ind.capacity] as [number, number, number, number] };
  try {
    ZONES.com.capacity = [...UNITS_ONLY.com];
    ZONES.ind.capacity = [...UNITS_ONLY.ind];
    refreshCapacity();
    return fn();
  } finally {
    ZONES.com.capacity = keep.com;
    ZONES.ind.capacity = keep.ind;
    refreshCapacity();
  }
}
