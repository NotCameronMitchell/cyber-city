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
//   ports     seaport / airport / spaceport demand, trade, visitors, countdown
//
// step() runs the cheap systems every tick and staggers the heavier field
// passes across FIELD_STAGGER ticks. recomputeAll() runs everything at once
// without advancing time or touching funds.
//
// Story layer (docs/STORY.md §10.6): the systems read world.mods,
// world.layers and world.ledger (identities by default) and push
// world.signals; the sim never imports story logic. Monthly, the tax rate is
// clamped to mods.taxCap before the month settles.
//
// Expansion (docs/EXPANSION.md): road kinds, skyways, noise / hub / sea, the
// wealth score (phase 1, and after the second land-value pass in
// recomputeAll), tier steps inside growth only, ports and visitors. Tiers
// never move inside recomputeAll; settleWealth() is the one-time batch Game
// runs for old saves.
// ─────────────────────────────────────────────────────────────────────────────

import { EDGE_LINKS, MAX_TAX, TOURISM } from './config';
import { DAYS_PER_MONTH, type Demand } from './types';
import type { World } from './world';
import { Advisor } from './sim/advisor';
import { projectBudget, settleMonth } from './sim/budget';
import { Census } from './sim/census';
import { FieldSystem } from './sim/fields';
import { SimGrid } from './sim/grid';
import { GrowthSystem } from './sim/growth';
import { IncidentSystem } from './sim/incidents';
import { PortSystem, type PortView } from './sim/ports';
import { PowerGrid } from './sim/power';
import { DEMAND_SMOOTH, FIELD_STAGGER } from './sim/tuning';

export interface SimOptions {
  /** Random city events (grid hacks, gang surges, corp investments). */
  events: boolean;
}

export class Simulation {
  options: SimOptions = { events: true };
  readonly world: World;

  private readonly grid: SimGrid;
  private readonly power: PowerGrid;
  private readonly fields: FieldSystem;
  private readonly census = new Census();
  private readonly growth: GrowthSystem;
  private readonly incidents = new IncidentSystem();
  private readonly advisor = new Advisor();
  /** Ports (EXPANSION §5). Read through `ports`. */
  private readonly portSystem: PortSystem;
  /** Smoothed demand (what the UI shows and growth reacts to). */
  private readonly demand: Demand = { res: 0, com: 0, ind: 0 };
  private readonly target: Demand = { res: 0, com: 0, ind: 0 };
  private approval = 60;
  private primed = false;

  // ── Megacity hooks (docs/MEGACITY.md §3.3), frozen in Step 0b; WP-1 fills them. ──
  /**
   * O8 sleeping districts: 'off', 'auto' (a PC under strain) or 'forced' (lower detail). Set by Game. Step 0b: read by
   * nothing yet (every slot is always awake).
   */
  sleep: 'off' | 'auto' | 'forced' = 'off';
  /**
   * The district daily hook (unit C1, after growth): WP-2's districts/daily.ts (Pump Houses, king tides, frame crime,
   * district goals on the month tick). Called once per sim day with the world and whether this day ends a month.
   */
  districtDaily: ((world: World, monthEnd: boolean) => void) | null = null;

  constructor(world: World) {
    this.world = world;
    // The frame is the world's (MEGACITY §3.1): every system sizes its arrays from world.area.
    this.grid = new SimGrid(world);
    this.power = new PowerGrid(world);
    this.fields = new FieldSystem(world);
    this.growth = new GrowthSystem(world);
    this.portSystem = new PortSystem(world);
  }

  /** Read-only port numbers (visitors, trade, demand adds, spaceport progress; EXPANSION §2.7). */
  get ports(): PortView {
    return this.portSystem;
  }

  /**
   * Old saves settle their wealth tiers once (EXPANSION §4.3): Game calls this exactly once,
   * after the first recomputeAll of a world whose loadedVersion < 3, then recomputeAll again.
   * Returns the number of tier steps taken. Deterministic (no rng); never lowers a tier.
   */
  settleWealth(): number {
    if (!this.primed) this.recomputeAll();
    const steps = this.growth.settle(this.world, this.grid, this.power);
    if (steps > 0) {
      // The settled tiers count as present at load: their "first $$" highlights never replay.
      this.census.count(this.grid);
      this.advisor.primeWealth(this.census);
    }
    return steps;
  }

  /** Advance one day. */
  step(): void {
    if (!this.primed) this.recomputeAll();
    const w = this.world;
    const g = this.grid;
    w.tick++;
    const tiles = w.tiles;
    const area = w.area;
    for (let i = 0; i < area; i++) {
      const t = tiles[i];
      if (t.age < 9999) t.age++;
    }

    // Event upkeep first so a restored plant powers up this very tick.
    g.scan(w);
    this.incidents.tick(w, g);
    this.fields.decay();
    // Spaceport countdown before the power pass, so a finished port draws power this tick.
    this.portSystem.tick(w);

    this.power.compute(w, g);
    this.growth.countDays(g, this.power);
    this.fields.coverage(w, g);
    this.census.count(g);

    // Heavy field passes, staggered.
    const phase = w.tick % FIELD_STAGGER;
    if (phase === 0) {
      this.fields.traffic(w, g);
      this.fields.pollution(w, g);
      this.fields.noise(w, g);
    }
    if (phase === FIELD_STAGGER - 1) {
      this.fields.neighbourhood(g);
      this.fields.landValue(w, g);
      this.fields.crime(w, g, this.census.joblessPressure, this.census.population);
      this.fields.wealthScore(w, g);
    }

    // Demand moves smoothly toward its target; growth reacts to the smoothed value.
    this.census.averages(w, g, this.fields);
    this.approval += (this.census.approval(w, this.power) - this.approval) * 0.1;
    this.portSystem.refresh(w, g, this.census, this.approval);
    this.setTrade();
    this.census.demandTarget(w, this.approval, this.incidents.comBoost, this.target);
    const d = this.demand;
    d.res += (this.target.res - d.res) * DEMAND_SMOOTH;
    d.com += (this.target.com - d.com) * DEMAND_SMOOTH;
    d.ind += (this.target.ind - d.ind) * DEMAND_SMOOTH;

    this.growth.run(w, g, this.power, this.fields, d);
    if (this.growth.changes > 0 || this.growth.tierSteps > 0) this.census.count(g);
    if (this.districtDaily) this.districtDaily(w, w.tick % DAYS_PER_MONTH === 0);
    this.advisor.highlights(w, this.growth.reached);
    this.advisor.wealthHighlights(w, this.growth.reachedWealth);
    this.portSystem.announce(w);

    this.publish();
    const monthEnd = w.tick % DAYS_PER_MONTH === 0;
    if (monthEnd) {
      const cap = Math.min(MAX_TAX, w.mods.taxCap);
      if (w.taxRate > cap) w.taxRate = cap;
    }
    projectBudget(w, g, this.census, w.budget, this.portSystem);

    if (monthEnd) {
      settleMonth(w);
      w.events.emit('month');
      w.events.emit('sfx', 'money');
    }

    this.advisor.milestones(w, this.census.population);
    this.incidents.update(w, g, this.fields, this.census, this.options.events);
    this.advisor.flavor(w, this.census.population);
    this.advisor.warnings(w, this.census, this.power, d, g);
    // City life terms count down one sim day at a time (MEGACITY §6.4.1): speed never multiplies them.
    if (w.cityEvent && w.cityEvent.daysLeft > 0) w.cityEvent.daysLeft--;
  }

  /**
   * Run the current day's next units within `budgetMs` of sim time (MEGACITY §3.3, signature frozen in Step 0b).
   * Returns true when a day completed (stats and events published). Step 0b: runs one whole day, whatever the
   * budget; WP-1 cuts it into the resumable units of §3.3, so a sliced day equals a whole step() exactly.
   */
  stepSlice(budgetMs: number): boolean {
    void budgetMs;
    this.step();
    return true;
  }

  /**
   * Recompute after a player action around a tile rect (MEGACITY §3.3, O5). Step 0b: a full recomputeAll; WP-1
   * recomputes power, coverage and traffic in full and the local fields on rect ⊕ 12 only.
   */
  recomputeAround(rect: { x0: number; y0: number; x1: number; y1: number }): void {
    void rect;
    this.recomputeAll();
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
    f.noise(w, g);
    f.neighbourhood(g);
    // Land value and crime feed each other: settle them with a second pass.
    f.landValue(w, g);
    f.crime(w, g, this.census.joblessPressure, this.census.population);
    f.landValue(w, g);
    f.crime(w, g, this.census.joblessPressure, this.census.population);
    // The wealth score moves at once (inspect meter, lens pips); tiers only step in growth.
    f.wealthScore(w, g);
    this.census.averages(w, g, f);

    const approval = this.census.approval(w, this.power);
    this.portSystem.refresh(w, g, this.census, this.primed ? this.approval : approval);
    this.setTrade();
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
    projectBudget(w, g, this.census, w.budget, this.portSystem);
  }

  /** Demand adds from ports, regional links and visitors (§5, §6.2, §6.3) for demandTarget. */
  private setTrade(): void {
    const p = this.portSystem;
    const edges = this.grid.edgePoints;
    this.census.tradeInd = p.exportJobs + p.indJobs + edges * EDGE_LINKS.ind;
    this.census.tradeCom = p.comJobs + edges * EDGE_LINKS.com + p.visitors * TOURISM.comPerVisitor;
  }

  /** Write census results into world.stats and track the population high-water mark. */
  private publish(): void {
    const w = this.world;
    this.census.writeStats(w.stats, this.power, this.demand, this.approval);
    w.stats.visitors = this.portSystem.visitors;
    if (this.census.population > w.maxPopulation) w.maxPopulation = this.census.population;
  }
}
