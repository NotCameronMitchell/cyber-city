// ─────────────────────────────────────────────────────────────────────────────
// Simulation: one tick = one day. Orchestrates the systems in src/game/sim/:
//
//   grid      typed-array mirror of tiles, road distances, terrain value
//   power     conductor components + BFS brownout allocation
//   fields    coverage, traffic, pollution, land value, crime
//   census    residents/jobs, averages, approval, RCI demand
//   growth    develop / upgrade / decline / abandon / recover
//   budget    live projection + monthly settlement
//   incidents random events (grid hacks, crew surges, grants, smog, booms)
//   advisor   warnings, highlights, milestones, unlocks, flavor news
//
// step() runs the cheap systems every tick and staggers the heavier field
// passes across FIELD_STAGGER ticks. recomputeAll() runs everything at once
// without advancing time or touching funds.
// ─────────────────────────────────────────────────────────────────────────────

import { DAYS_PER_MONTH, MAP_SIZE, type Demand } from './types';
import type { World } from './world';
import { Advisor } from './sim/advisor';
import { projectBudget, settleMonth } from './sim/budget';
import { Census } from './sim/census';
import { FieldSystem } from './sim/fields';
import { SimGrid } from './sim/grid';
import { GrowthSystem } from './sim/growth';
import { IncidentSystem } from './sim/incidents';
import { PowerGrid } from './sim/power';
import { DEMAND_SMOOTH, FIELD_STAGGER } from './sim/tuning';

const AREA = MAP_SIZE * MAP_SIZE;

export interface SimOptions {
  /** Random city events (grid hacks, gang surges, corp investments). */
  events: boolean;
}

export class Simulation {
  options: SimOptions = { events: true };
  readonly world: World;

  private readonly grid: SimGrid;
  private readonly power = new PowerGrid();
  private readonly fields = new FieldSystem();
  private readonly census = new Census();
  private readonly growth = new GrowthSystem();
  private readonly incidents = new IncidentSystem();
  private readonly advisor = new Advisor();
  /** Smoothed demand (what the UI shows and growth reacts to). */
  private readonly demand: Demand = { res: 0, com: 0, ind: 0 };
  private readonly target: Demand = { res: 0, com: 0, ind: 0 };
  private approval = 60;
  private primed = false;

  constructor(world: World) {
    this.world = world;
    this.grid = new SimGrid(world);
  }

  /** Advance one day. */
  step(): void {
    if (!this.primed) this.recomputeAll();
    const w = this.world;
    const g = this.grid;
    w.tick++;
    const tiles = w.tiles;
    for (let i = 0; i < AREA; i++) {
      const t = tiles[i];
      if (t.age < 9999) t.age++;
    }

    // Event upkeep first so a restored plant powers up this very tick.
    g.scan(w);
    this.incidents.tick(w, g);
    this.fields.decay();

    this.power.compute(w, g);
    this.growth.countDays(g, this.power);
    this.fields.coverage(w, g);
    this.census.count(g);

    // Heavy field passes, staggered.
    const phase = w.tick % FIELD_STAGGER;
    if (phase === 0) {
      this.fields.traffic(w, g);
      this.fields.pollution(w, g);
    }
    if (phase === FIELD_STAGGER - 1) {
      this.fields.neighbourhood(g);
      this.fields.landValue(w, g);
      this.fields.crime(w, g, this.census.joblessPressure, this.census.population);
    }

    // Demand moves smoothly toward its target; growth reacts to the smoothed value.
    this.census.averages(w, g, this.fields);
    this.approval += (this.census.approval(w, this.power) - this.approval) * 0.1;
    this.census.demandTarget(w, this.approval, this.incidents.comBoost, this.target);
    const d = this.demand;
    d.res += (this.target.res - d.res) * DEMAND_SMOOTH;
    d.com += (this.target.com - d.com) * DEMAND_SMOOTH;
    d.ind += (this.target.ind - d.ind) * DEMAND_SMOOTH;

    this.growth.run(w, g, this.power, this.fields, d);
    if (this.growth.changes > 0) this.census.count(g);
    this.advisor.highlights(w, this.growth.reached);

    this.publish();
    projectBudget(w, g, this.census, w.budget);

    if (w.tick % DAYS_PER_MONTH === 0) {
      settleMonth(w);
      w.events.emit('month');
      w.events.emit('sfx', 'money');
    }

    this.advisor.milestones(w, this.census.population);
    this.incidents.update(w, g, this.fields, this.census, this.options.events);
    this.advisor.flavor(w, this.census.population);
    this.advisor.warnings(w, this.census, this.power, d);
  }

  /**
   * Recompute every derived field/stat from scratch (after load / new game /
   * player action). Does not advance time or change funds.
   */
  recomputeAll(): void {
    const w = this.world;
    const g = this.grid;
    const f = this.fields;
    g.scan(w, true);
    this.power.compute(w, g);
    f.coverage(w, g);
    this.census.count(g);
    f.traffic(w, g);
    f.pollution(w, g);
    f.neighbourhood(g);
    // Land value and crime feed each other: settle them with a second pass.
    f.landValue(w, g);
    f.crime(w, g, this.census.joblessPressure, this.census.population);
    f.landValue(w, g);
    f.crime(w, g, this.census.joblessPressure, this.census.population);
    this.census.averages(w, g, f);

    const approval = this.census.approval(w, this.power);
    if (!this.primed) {
      // First run (new game / load): snap smoothed values instead of easing in.
      this.approval = approval;
      this.census.demandTarget(w, approval, this.incidents.comBoost, this.target);
      this.demand.res = this.target.res;
      this.demand.com = this.target.com;
      this.demand.ind = this.target.ind;
      this.advisor.prime(w, this.census);
      this.primed = true;
    }
    this.publish();
    projectBudget(w, g, this.census, w.budget);
  }

  /** Write census results into world.stats and track the population high-water mark. */
  private publish(): void {
    const w = this.world;
    this.census.writeStats(w.stats, this.power, this.demand, this.approval);
    if (this.census.population > w.maxPopulation) w.maxPopulation = this.census.population;
  }
}
