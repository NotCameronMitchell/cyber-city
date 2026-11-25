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
// recomputeAll() runs everything at once without advancing time or touching
// funds; recomputeAround(rect) the local version after a player action.
//
// Story layer (docs/STORY.md §10.6): the systems read world.mods,
// world.layers and world.ledger (identities by default) and push
// world.signals; the sim never imports story logic. Monthly, the tax rate is
// clamped to mods.taxCap before the month settles.
//
// Expansion (docs/EXPANSION.md): road kinds, skyways, noise / hub / sea, the
// wealth score, tier steps inside growth only, ports and visitors. Tiers
// never move inside recomputeAll; settleWealth() is the one-time batch Game
// runs for old saves.
//
// Megacity (docs/MEGACITY.md §3.3): the day is a sequence of resumable units
// (sim/slice.ts) in a fixed order:
//   A1 scan (row bands; the tile ages ride along), incidents, decay, ports;
//   A2 power (cached labels, banded sweep, resumable relabel and BFS, O2);
//   A3 day counters, coverage only when its key changed (O3), the census;
//   B  this day's field phase (O4: fieldStagger 4 from FIELD_STAGGER_FROM
//      owned districts, 2 below; sim/tuning.ts says why), one pass per unit,
//      banded, with resting districts' rows skipped (O8);
//   C1 averages, approval, trade, demand, growth, the district daily hook;
//   C2 highlights, stats, the budget (projected every 3rd day and fresh on the
//      month end, O7), settlement, milestones, incidents, advice.
// step() drains a whole day; stepSlice(budgetMs) runs the next steps within
// the budget and returns true when the day completed. Stats and the sim's own
// events publish in C2, so the UI never sees half a day.
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS, EDGE_LINKS, LOW_DETAIL, MAX_TAX, REGION, SLEEP, SLICE, TOURISM } from './config';
import { DAYS_PER_MONTH, type Demand, type SlotId } from './types';
import type { World } from './world';
import { composeLayers, layersVersion, monthBandHooks } from './story/mods';
import { Advisor } from './sim/advisor';
import { projectBudget, projectUnit, settleMonth } from './sim/budget';
import { Census } from './sim/census';
import { FieldSystem, type Win } from './sim/fields';
import { SimGrid } from './sim/grid';
import { GrowthSystem } from './sim/growth';
import { IncidentSystem } from './sim/incidents';
import { ChunkList, buildChunks } from './sim/owned';
import { PortSystem, type PortView } from './sim/ports';
import { PowerGrid } from './sim/power';
import { CostBook, K, drain, type Unit } from './sim/slice';
import { DEMAND_SMOOTH, FIELD_STAGGER, FIELD_STAGGER_FROM, FIELD_STAGGER_SMALL } from './sim/tuning';

export interface SimOptions {
  /** Random city events (grid hacks, gang surges, corp investments). */
  events: boolean;
}

/** Rows per band of the day's banded units (SLICE.bandRows). */
const BAND = SLICE.bandRows;
/** The budget projection runs every this many days, and always on the month end (O7). */
const PROJECT_EVERY = 3;
/** recomputeAround's window: the action rect ⊕ this many tiles (O5). */
export const AROUND = 12;
/** Traffic change outside the window, as a share of a tile's volume, that schedules a full field pass (O5). */
const AROUND_SPILL = 0.02;

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

  // ── Megacity hooks (docs/MEGACITY.md §3.3), frozen in Step 0b. ──
  /**
   * O8 sleeping districts. 'off': every slot runs every field cycle. 'auto' (Game sets it while a 5×5 city on a PC
   * is under strain, and back to 'off' once it recovers, §3.11): a slot rests when it had no player action for
   * SLEEP.idleSec and no level change for SLEEP.quietDays. 'forced' (lower detail): every slot farther than
   * LOW_DETAIL.awakeRing from `sleepFocus` rests unless it had an action in the last SLEEP.idleSec. A resting slot
   * runs its rows of the throttleable field passes only when (cycle + slot) % cadence == 0 (SLEEP.cadence 4, or
   * LOW_DETAIL.sleepCadence 8 when forced). Growth, tile ages, tiers and the network passes never rest.
   */
  sleep: 'off' | 'auto' | 'forced' = 'off';
  /**
   * The district daily hook (unit C1, after growth): WP-2's districts/daily.ts (Pump Houses, king tides, frame crime,
   * district goals on the month tick). Called once per sim day with the world and whether this day ends a month.
   */
  districtDaily: ((world: World, monthEnd: boolean) => void) | null = null;
  /**
   * A ruin recovered (MEGACITY §3.7): Game installs actions.ruinRestored here (ground Plain, districts.ruinsRestored,
   * restorePay with the monthly cap shared with the player's restores). Unset, the sim applies the same rule itself.
   */
  get ruinRestored(): ((world: World, x: number, y: number) => number) | null {
    return this.growth.onRuinRestored;
  }
  set ruinRestored(fn: ((world: World, x: number, y: number) => number) | null) {
    this.growth.onRuinRestored = fn;
  }
  /**
   * Field passes per cycle (MEGACITY §3.3, O4): by the city's size unless set (sim/tuning.ts): 2 (today's latency) while
   * fewer than FIELD_STAGGER_FROM districts are owned, else FIELD_STAGGER 4 (a quarter of the field work a day, field
   * latency 4 days). Setting it forces a stagger (tests, the measure harness); `null` returns to the size rule. Sleep
   * cycles count in it (cycle = floor(tick / fieldStagger)).
   */
  get fieldStagger(): 2 | 4 {
    return this.staggerSet ?? (this.world.districts.owned.length >= FIELD_STAGGER_FROM ? FIELD_STAGGER : FIELD_STAGGER_SMALL);
  }
  set fieldStagger(v: 2 | 4 | null) {
    this.staggerSet = v;
  }
  private staggerSet: 2 | 4 | null = null;
  /** The slot under the camera centre ('forced' sleep keeps its ring awake); −1 = the start slot. Game sets it. */
  sleepFocus: SlotId = -1;
  /** Slots resting in the current field cycle (the FPS readout's "· resting N"). */
  resting = 0;
  /** Milliseconds clock for stepSlice budgets and sleep idleness (tests inject a fake one). */
  clock: () => number = () => performance.now();

  // ── Slicing state ──
  private readonly costs = new CostBook();
  private day: Unit | null = null;
  private nextKind: K = K.Begin;
  /** ++ on every recomputeAll / recomputeAround: an in-flight pass restarts on its next step. */
  private gen = 0;
  /** Steps run and the largest step (ms) of the last stepSlice call (tests, the frame guard). */
  lastSlice = { steps: 0, spent: 0, maxStep: 0, maxKind: K.Begin as K };
  /** Sim ms of the sliced day in progress, and of the last 8 completed sliced days (dayEstimate). */
  private dayMs = 0;
  private readonly dayRing = new Float64Array(8);
  private dayCount = 0;
  /** world.slotsVersion the layers were last composed for (recomputeAll re-composes after an annex). */
  private composedSlots = -1;
  /** A full field pass is due (recomputeAround saw traffic change outside its window): runs on the next days. */
  private fullFieldsDue = false;

  // ── Coverage cache key (O3) ──
  private covVersion = -1;
  private covSlots = -1;
  private covSecurity = NaN;
  private covLayers = -1;
  private covSig = 0;

  // ── Sleep (O8) ──
  /** Per slot: last player action (clock ms) and the last tick a level changed there. */
  private readonly lastAction: Float64Array;
  private readonly act: Uint8Array;
  private readonly activeList: ChunkList;

  constructor(world: World) {
    this.world = world;
    // The frame is the world's (MEGACITY §3.1): every system sizes its arrays from world.area.
    this.grid = new SimGrid(world);
    this.power = new PowerGrid(world);
    this.grid.powered = this.power.powered;
    this.fields = new FieldSystem(world);
    this.fields.layout = this.grid.layout;
    this.growth = new GrowthSystem(world);
    this.portSystem = new PortSystem(world);
    const slots = world.region * world.region;
    this.lastAction = new Float64Array(slots).fill(-Infinity);
    this.act = new Uint8Array(slots);
    this.activeList = new ChunkList(world.N, world.region);
    this.composedSlots = world.slotsVersion;
  }

  /** Read-only port numbers (visitors, trade, demand adds, spaceport progress; EXPANSION §2.7). */
  get ports(): PortView {
    return this.portSystem;
  }

  /** Running cost estimates and the largest step per kind (tests, the measure harness). */
  get costBook(): CostBook {
    return this.costs;
  }

  /** True while a sliced day is in progress (some of its units ran). */
  get midDay(): boolean {
    return this.day !== null;
  }

  /**
   * The mean sim ms of the last 8 days run through stepSlice (0 before the first). A frame guard spreads the day over
   * frames with it (MEGACITY §3.3): a budget of about dayEstimate × days per frame, capped, keeps the per-frame p95 near
   * the average instead of at the cap.
   */
  get dayEstimate(): number {
    const n = Math.min(this.dayCount, 8);
    if (n === 0) return 0;
    let s = 0;
    for (let k = 0; k < n; k++) s += this.dayRing[k];
    return s / n;
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
      this.census.count(this.grid, this.world);
      this.advisor.primeWealth(this.census);
    }
    return steps;
  }

  /** Advance one day (finishing a sliced day in progress, if any). */
  step(): void {
    if (!this.primed) this.recomputeAll();
    const d = this.day ?? this.dayUnit(false);
    this.day = null;
    this.dayMs = 0;
    drain(d);
  }

  /**
   * Run the current day's next units within `budgetMs` of sim time (MEGACITY §3.3, signature frozen in Step 0b).
   * Returns true when a day completed (stats and events published). A step starts only while the time spent plus
   * its kind's running estimate fits the budget, and at least one step runs per call; a sliced day equals a whole
   * step() exactly.
   */
  stepSlice(budgetMs: number): boolean {
    if (!this.primed) this.recomputeAll();
    const now = this.clock;
    const t0 = now();
    const ls = this.lastSlice;
    ls.steps = 0;
    ls.maxStep = 0;
    if (!this.day) {
      this.day = this.dayUnit(true);
      this.nextKind = this.day.next().value as K;
    }
    const day = this.day;
    for (;;) {
      const k = this.nextKind;
      const t = now();
      if (ls.steps > 0 && t - t0 + this.costs.estimate(k) > budgetMs) {
        ls.spent = t - t0;
        return false;
      }
      const r = day.next();
      const e = now();
      const ms = e - t;
      this.costs.add(k, ms);
      ls.steps++;
      if (ms > ls.maxStep) {
        ls.maxStep = ms;
        ls.maxKind = k;
      }
      this.dayMs += ms;
      if (r.done) {
        this.day = null;
        ls.spent = e - t0;
        this.dayRing[this.dayCount++ & 7] = this.dayMs;
        this.dayMs = 0;
        return true;
      }
      this.nextKind = r.value;
    }
  }

  /** A pass that restarts from scratch when a recompute ran between two of its steps. */
  private *guard(make: () => Unit): Unit {
    for (;;) {
      const gen = this.gen;
      const u = make();
      let again = false;
      for (let r = u.next(); !r.done; r = u.next()) {
        yield r.value;
        if (this.gen !== gen) {
          again = true;
          break;
        }
      }
      if (!again) return;
    }
  }

  /** One day as resumable units (see the header). `banded`: cut the passes into row bands (stepSlice). */
  private *dayUnit(banded: boolean): Unit {
    const w = this.world;
    const g = this.grid;
    const f = this.fields;
    yield K.Begin;
    w.tick++;

    // ── A1: scan (with the day's tile ages), incidents, decay, ports ──
    let aged = false;
    yield* this.guard(() => this.scanUnit(banded, !aged, () => (aged = true)));
    yield K.Misc;
    // Event upkeep first so a restored plant powers up this very tick.
    this.incidents.tick(w, g);
    f.decaySmog();
    // Spaceport countdown before the power pass, so a finished port draws power this tick.
    this.portSystem.tick(w);
    yield* this.guard(() => this.decayUnit(banded));

    // ── A2: power ──
    yield* this.guard(() => this.power.computeUnit(w, g, banded));

    // ── A3: day counters, coverage (cached), census ──
    yield K.Census;
    this.growth.countDays(g, this.power);
    if (this.coverageStale()) yield* this.guard(() => this.coverageUnit(banded));
    yield* this.guard(() => this.census.countUnit(g, w, banded));

    // ── B: this day's field phase ──
    const stagger = this.fieldStagger;
    const phase = w.tick % stagger;
    this.updateSleep(Math.floor(w.tick / stagger));
    if (this.fullFieldsDue && phase === 0) this.fullFieldsDue = false;
    const jp = this.census.joblessPressure;
    const pop = this.census.population;
    if (stagger === 2) {
      if (phase === 0) {
        yield* this.guard(() => f.trafficUnit(w, g, banded));
        yield* this.guard(() => f.pollutionUnit(w, g, banded, null));
        yield* this.guard(() => f.noiseUnit(w, g, banded, null));
      } else {
        yield* this.guard(() => f.neighbourhoodUnit(g, banded, null));
        yield* this.guard(() => f.landValueUnit(w, g, banded, null));
        yield* this.guard(() => f.crimeUnit(w, g, jp, pop, banded, null));
        yield* this.guard(() => f.wealthUnit(w, g, banded, null));
      }
    } else if (phase === 0) yield* this.guard(() => f.trafficUnit(w, g, banded));
    else if (phase === 1) {
      yield* this.guard(() => f.pollutionUnit(w, g, banded, null));
      yield* this.guard(() => f.noiseUnit(w, g, banded, null));
    } else if (phase === 2) {
      yield* this.guard(() => f.neighbourhoodUnit(g, banded, null));
      yield* this.guard(() => f.landValueUnit(w, g, banded, null));
    } else {
      yield* this.guard(() => f.crimeUnit(w, g, jp, pop, banded, null));
      yield* this.guard(() => f.wealthUnit(w, g, banded, null));
    }
    f.active = null;

    // ── C1: demand and growth ──
    yield K.Pre;
    // Demand moves smoothly toward its target; growth reacts to the smoothed value.
    this.census.averages(w, g, f);
    this.approval += (this.census.approval(w, this.power) - this.approval) * 0.1;
    this.portSystem.refresh(w, g, this.census, this.approval);
    this.setTrade();
    this.census.demandTarget(w, this.approval, this.incidents.comBoost, this.target);
    const d = this.demand;
    d.res += (this.target.res - d.res) * DEMAND_SMOOTH;
    d.com += (this.target.com - d.com) * DEMAND_SMOOTH;
    d.ind += (this.target.ind - d.ind) * DEMAND_SMOOTH;
    // Growth changes tiles, so it is never restarted: a recompute between two of its chunks ends this day's growth.
    const gen = this.gen;
    yield* this.growth.runUnit(w, g, this.power, f, d, banded, () => this.gen !== gen);
    if (this.growth.changes > 0 || this.growth.tierSteps > 0) yield* this.guard(() => this.census.countUnit(g, w, banded));
    yield K.Post;
    const monthEnd = w.tick % DAYS_PER_MONTH === 0;
    if (this.districtDaily) this.districtDaily(w, monthEnd);

    // ── C2: the turf band, the budget projection, then the publish ──
    // O6: next month end's turf maps, banded over its last REGION[R].turfBands days (turf.update copies them in).
    if (w.tick % DAYS_PER_MONTH >= DAYS_PER_MONTH - REGION[w.region].turfBands) {
      const hooks = monthBandHooks();
      if (hooks.length) {
        yield K.Turf;
        for (const h of hooks) h(w);
      }
    }
    const capTax = () => {
      if (!monthEnd) return;
      const cap = Math.min(MAX_TAX, w.mods.taxCap);
      if (w.taxRate > cap) w.taxRate = cap;
    };
    // Everything the UI and the story read changes in this one last step (stats, the budget, settlement, the sim's
    // own events), so no frame ever sees half a day (§3.3).
    const finish = () => {
      this.advisor.highlights(w, this.growth.reached);
      this.advisor.wealthHighlights(w, this.growth.reachedWealth);
      this.portSystem.announce(w);
      this.publish();
      if (monthEnd) {
        settleMonth(w);
        w.events.emit('month');
        w.events.emit('sfx', 'money');
      }
      this.advisor.milestones(w, this.census.population);
      this.incidents.update(w, g, f, this.census, this.options.events);
      this.advisor.flavor(w, this.census.population);
      this.advisor.warnings(w, this.census, this.power, d, g);
      // City life terms count down one sim day at a time (MEGACITY §6.4.1): speed never multiplies them.
      if (w.cityEvent && w.cityEvent.daysLeft > 0) w.cityEvent.daysLeft--;
    };
    // O7: the projection runs every PROJECT_EVERY days and always fresh on the month end, in zoned chunks; its last
    // chunk's step also writes it and publishes the day.
    if (monthEnd || w.tick % PROJECT_EVERY === 0) {
      yield* this.guard(() => projectUnit(w, g, this.census, w.budget, this.portSystem, banded, capTax, finish));
    } else {
      yield K.End;
      finish();
    }
  }

  /** A1's scan in row bands; `ages` counts the day's tile ages (only on the first attempt of the day). */
  private *scanUnit(banded: boolean, ages: boolean, aged: () => void): Unit {
    const w = this.world;
    const g = this.grid;
    yield K.ScanBand;
    g.scanBegin(w);
    const L = g.layout;
    const step = banded ? BAND : L.y1 - L.y0 + 1;
    let first = true;
    for (let y = L.y0; y <= L.y1; y += step) {
      if (!first) yield K.ScanBand;
      first = false;
      g.scanRows(w, y, Math.min(L.y1, y + step - 1), ages);
    }
    if (ages) aged();
    yield K.ScanEnd;
    if (g.scanFinish(w, false)) {
      yield K.Roads;
      g.scanCaches(w, false);
    }
  }

  /** The crime boost decay in row bands. */
  private *decayUnit(banded: boolean): Unit {
    const L = this.grid.layout;
    const step = banded ? BAND * 4 : L.y1 - L.y0 + 1;
    for (let y = L.y0; y <= L.y1; y += step) {
      yield K.DecayBand;
      this.fields.decayRows(L.all, { x0: 0, x1: this.world.N - 1, y0: y, y1: Math.min(L.y1, y + step - 1) });
    }
  }

  private *coverageUnit(banded: boolean): Unit {
    this.noteCoverage();
    yield* this.fields.coverageUnit(this.world, this.grid, banded);
  }

  // ── Coverage cache (O3) ───────────────────────────────────────────────────

  /**
   * A signature of what coverage reads per building beyond coverageVersion (O3): offline, powered, built, stage, crown,
   * sponsor, look and a Pump House's reclaim countdown, so a writer that forgets to bump coverageVersion is still seen.
   */
  private buildingSig(): number {
    let h = this.grid.buildings.length | 0;
    for (const b of this.grid.buildings) {
      const f =
        (b.offline > 0 ? 1 : 0) |
        (b.powered ? 2 : 0) |
        ((b.buildDays ?? 0) > 0 ? 4 : 0) |
        ((b.stage ?? 0) << 3) |
        ((b.look ?? 0) << 5) |
        (b.sponsor === 'basalt' ? 128 : b.sponsor === 'nacre' ? 256 : 0) |
        ((b.reclaim ?? 0) > 0 ? 512 : 0);
      h = (Math.imul(h ^ (b.id * 1024 + f), 0x9e3779b1) + f + (b.crown ? strHash(b.crown) : 0)) | 0;
    }
    return h;
  }

  /** Has anything coverage reads changed since it last ran? (coverageVersion, slots, securityMul, layers, buildings) */
  private coverageStale(): boolean {
    const w = this.world;
    return (
      w.coverageVersion !== this.covVersion ||
      w.slotsVersion !== this.covSlots ||
      w.mods.securityMul !== this.covSecurity ||
      layersVersion(w.layers) !== this.covLayers ||
      this.buildingSig() !== this.covSig
    );
  }

  private noteCoverage(): void {
    const w = this.world;
    this.covVersion = w.coverageVersion;
    this.covSlots = w.slotsVersion;
    this.covSecurity = w.mods.securityMul;
    this.covLayers = layersVersion(w.layers);
    this.covSig = this.buildingSig();
  }

  /** Coverage now, whatever its key (load, recompute). */
  private coverageNow(): void {
    this.noteCoverage();
    drain(this.fields.coverageUnit(this.world, this.grid, false));
  }

  // ── Sleep (O8) ────────────────────────────────────────────────────────────

  /** The running set for this field cycle: every owned slot unless sleep is on (see `sleep`). */
  private updateSleep(cycle: number): void {
    const w = this.world;
    const f = this.fields;
    this.resting = 0;
    if (this.sleep === 'off') {
      f.active = null;
      return;
    }
    const R = w.region;
    const own = w.slotOwned;
    const act = this.act;
    const now = this.clock();
    const idleMs = SLEEP.idleSec * 1000;
    const forced = this.sleep === 'forced';
    const k = forced ? LOW_DETAIL.sleepCadence : SLEEP.cadence;
    const focus = this.sleepFocus >= 0 && this.sleepFocus < R * R ? this.sleepFocus : (R * R - 1) >> 1;
    const fx = focus % R;
    const fy = (focus / R) | 0;
    const quiet = this.growth.levelTick;
    let resting = 0;
    for (let s = 0; s < R * R; s++) {
      act[s] = 0;
      if (!own[s]) continue;
      const recent = now - this.lastAction[s] < idleMs;
      let rest: boolean;
      if (forced) rest = !recent && Math.max(Math.abs((s % R) - fx), Math.abs(((s / R) | 0) - fy)) > LOW_DETAIL.awakeRing;
      else rest = !recent && w.tick - quiet[s] >= SLEEP.quietDays;
      if (rest && (cycle + s) % k !== 0) {
        resting++;
        continue;
      }
      act[s] = 1;
    }
    this.resting = resting;
    if (resting === 0) {
      f.active = null;
      return;
    }
    buildChunks(w.N, R, own, act, this.activeList);
    f.active = this.activeList;
  }

  // ── Recompute ─────────────────────────────────────────────────────────────

  /**
   * Recompute after a player action around a tile rect (MEGACITY §3.3, O5): power (relabel only if conductors
   * changed), coverage (if its key changed), traffic in full (highway and sky pools are network-wide), then
   * pollution, noise, neighbourhood, land value, crime and wealth score on rect ⊕ 12 (owned land), then census,
   * averages and the budget. When traffic outside the window moved by more than 2% of a tile's volume, the next
   * field cycle runs every pass in full. Records the action for O8 (its slots stay awake).
   */
  recomputeAround(rect: { x0: number; y0: number; x1: number; y1: number }): void {
    if (!this.primed) {
      this.recomputeAll();
      return;
    }
    const w = this.world;
    const g = this.grid;
    const f = this.fields;
    const N = w.N;
    this.gen++;
    this.noteAction(rect);
    g.scan(w);
    this.power.compute(w, g);
    if (this.coverageStale()) this.coverageNow();
    this.census.count(g, w);
    const before = f.volume.slice();
    drain(f.trafficUnit(w, g, false));
    const win: Win = {
      x0: Math.max(0, Math.min(rect.x0, rect.x1) - AROUND),
      y0: Math.max(0, Math.min(rect.y0, rect.y1) - AROUND),
      x1: Math.min(N - 1, Math.max(rect.x0, rect.x1) + AROUND),
      y1: Math.min(N - 1, Math.max(rect.y0, rect.y1) + AROUND),
    };
    if (this.spilled(before, f.volume, win)) this.fullFieldsDue = true;
    drain(f.pollutionUnit(w, g, false, win));
    drain(f.noiseUnit(w, g, false, win));
    drain(f.neighbourhoodUnit(g, false, win));
    // Land value and crime feed each other: settle them with a second pass (as recomputeAll).
    const c = this.census;
    drain(f.landValueUnit(w, g, false, win));
    drain(f.crimeUnit(w, g, c.joblessPressure, c.population, false, win));
    drain(f.landValueUnit(w, g, false, win));
    drain(f.crimeUnit(w, g, c.joblessPressure, c.population, false, win));
    drain(f.wealthUnit(w, g, false, win));
    this.finishRecompute();
  }

  /** Did traffic volume move by more than AROUND_SPILL anywhere outside the window? */
  private spilled(before: Float32Array, after: Float32Array, win: Win): boolean {
    const N = this.world.N;
    const { ck, rowAt } = this.grid.layout.all;
    for (let c = 0; c < rowAt[N]; c += 3)
      for (let i = ck[c], e = ck[c + 1]; i < e; i++) {
        const d = after[i] - before[i];
        if (d <= AROUND_SPILL && d >= -AROUND_SPILL) continue;
        const x = i % N;
        const y = (i / N) | 0;
        if (x < win.x0 || x > win.x1 || y < win.y0 || y > win.y1) return true;
      }
    return false;
  }

  /** Record a player action on the slots a rect touches (O8: they stay awake for SLEEP.idleSec). */
  noteAction(rect: { x0: number; y0: number; x1: number; y1: number }): void {
    const w = this.world;
    const R = w.region;
    const now = this.clock();
    const sx0 = Math.max(0, Math.min(R - 1, Math.min(rect.x0, rect.x1) >> 6));
    const sx1 = Math.max(0, Math.min(R - 1, Math.max(rect.x0, rect.x1) >> 6));
    const sy0 = Math.max(0, Math.min(R - 1, Math.min(rect.y0, rect.y1) >> 6));
    const sy1 = Math.max(0, Math.min(R - 1, Math.max(rect.y0, rect.y1) >> 6));
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) this.lastAction[y * R + x] = now;
  }

  /**
   * Census and budget only (MEGACITY §3.3, O5): the tax and budget sliders call this instead of recomputeAll.
   * No field changes; approval, demand targets and the projection follow the new tax rate.
   */
  recomputeEconomy(): void {
    if (!this.primed) {
      this.recomputeAll();
      return;
    }
    this.census.count(this.grid, this.world);
    this.publish();
    projectBudget(this.world, this.grid, this.census, this.world.budget, this.portSystem);
  }

  /**
   * Recompute every derived field/stat from scratch (after load / new game /
   * annex). Does not advance time or change funds.
   */
  recomputeAll(): void {
    const w = this.world;
    const g = this.grid;
    const f = this.fields;
    this.gen++;
    // An annex grew the owned land: the layers there were never composed (composeLayers merges owned tiles only).
    if (w.slotsVersion !== this.composedSlots) {
      this.composedSlots = w.slotsVersion;
      composeLayers(w);
    }
    f.active = null;
    // The road caches rebuild when the road signature or the owned layout changed (an annex), and always on the first
    // recompute; forcing them every time cost ≈ 6.7 ms at 25 districts (MEGACITY §11.1's ≤ 30 ms).
    g.scan(w, !this.primed);
    this.power.compute(w, g);
    // Coverage follows its cache key (O3), and always runs on the first recompute.
    if (!this.primed || this.coverageStale()) this.coverageNow();
    this.census.count(g, w);
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
    this.finishRecompute();
  }

  private finishRecompute(): void {
    const w = this.world;
    const g = this.grid;
    this.census.averages(w, g, this.fields);
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

  /**
   * Demand adds from ports, regional links and visitors (§5, §6.2, §6.3), and the district demand rules
   * (MEGACITY §3.3): +2,000 Fab jobs per owned Flats district below 400 developed Fab tiles, the Tarmac lease's
   * 2,000 Market or Fab jobs, and each Bazaar district's visitors (already in the port visitors).
   */
  private setTrade(): void {
    const p = this.portSystem;
    const edges = this.grid.edgePoints;
    const c = this.census;
    let ind = 0;
    let com = 0;
    const w = this.world;
    const dc = c.byDistrict;
    for (let k = 0; k < dc.length; k++) {
      const m = DISTRICTS[dc[k].kind]?.mods;
      const di = m?.demandInd;
      if (di && dc[k].fabTiles < di.whileFabBelow) ind += di.jobs;
    }
    const lease = w.districts.leases?.tarmac;
    if (lease) {
      const tarmacJobs = LEASE_JOBS;
      if (lease === 'nacre') com += tarmacJobs;
      else ind += tarmacJobs;
    }
    c.tradeInd = p.exportJobs + p.indJobs + edges * EDGE_LINKS.ind + ind;
    c.tradeCom = p.comJobs + edges * EDGE_LINKS.com + p.visitors * TOURISM.comPerVisitor + com;
  }

  /** Write census results into world.stats and track the population high-water mark. */
  private publish(): void {
    const w = this.world;
    this.census.writeStats(w.stats, this.power, this.demand, this.approval);
    this.census.writeDistricts(w);
    w.stats.visitors = this.portSystem.visitors;
    if (this.census.population > w.maxPopulation) w.maxPopulation = this.census.population;
  }
}

/** A small string hash (crown ids in the coverage signature). */
function strHash(t: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h;
}

/** The Tarmac lease's demand add (MEGACITY §3.7): +2,000 Market (Nacre) or Fab (Basalt) jobs. */
const LEASE_JOBS = 2_000;
