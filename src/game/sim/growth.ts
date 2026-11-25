// ─────────────────────────────────────────────────────────────────────────────
// Zone growth, decline, abandonment and recovery. Each tick a random ~1/6 of
// zoned tiles is evaluated so the city fills in organically instead of in
// lock-step waves. All level changes go through world.setLevel() so the
// renderer hears about them.
//
// Story hooks (§10.6): grow and upgrade chances × mods.growthMul; every
// abandon or decline chance × mods.abandonMul × layers.abandonMul[i].
//
// Expansion (docs/EXPANSION.md §4.3): wealth tiers move only here, on the
// tiles already sampled, with a WEALTH.streak hysteresis per tile
// (world.wealthStreak) and a power reservation for an up-step; a new lot
// latches its potential tier (falling back while the grid can't feed it).
// No rng draws: tier logic never shifts the other rolls. settle() is the
// one-time batch for old saves (Simulation.settleWealth).
//
// Megacity districts (docs/MEGACITY.md §3.3, §3.7), per district of each kind:
// ruins (zoned, abandoned, ground Rubble) never collapse and recover at
// RECOVER_CHANCE × recoverMul, turning Plain, counting districts.ruinsRestored
// and paying restorePay (capped at RUINS.payCapMonth a month); floodplain
// tiles (land within 1 of water where floodplainMaxLevel is set) stop below
// level 3 while resilience is 0; brownfield clears (ground Plain) on a sampled
// tile developed for clearDays, or with park ≥ 0.3 or filter > 0 for
// parkClearDays. Every rule is a no-op (no extra rng draw) on plain ground.
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS, RUINS, WEALTH, ZONES } from '../config';
import { DAYS_PER_MONTH, Ground, ZoneType, type Demand, type WealthTier } from '../types';
import * as Wealth from '../wealth';
import type { World } from '../world';
import type { SimGrid } from './grid';
import { K, ZONED_CHUNK, drain, type Unit } from './slice';
import type { FieldSystem } from './fields';
import { zoneDraw, type PowerGrid } from './power';
import * as Tuning from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
const T = { ...Tuning };
const W = { ...Wealth };
const STREAK = WEALTH.streak;
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;
const RUBBLE = Ground.Rubble;
const BROWNFIELD = Ground.Brownfield;
/** Park coverage that clears brownfield early (MEGACITY §3.3). */
const BROWNFIELD_PARK = 0.3;

/** Land value needed for level 2 and 3, index = ZoneType. */
const LEVEL_LV: readonly (readonly [number, number])[] = [
  [1, 1],
  ZONES.res.levelLandValue,
  ZONES.com.levelLandValue,
  ZONES.ind.levelLandValue,
];

export class GrowthSystem {
  /** Consecutive days each developed tile has gone without power (Uint16Array(world.area)). */
  readonly unpoweredDays: Uint16Array;
  /** Flags set this tick when a tile reached (zone * 4 + level). Cleared by run(). */
  readonly reached = new Uint8Array(16);
  /** Flags set this tick when a tile stepped up to (zone * 3 + tier). Cleared by run(). */
  readonly reachedWealth = new Uint8Array(12);
  /** Tier steps during the last run (up and down). */
  tierSteps = 0;
  /** Level changes during the last run (for debugging / tests). */
  changes = 0;

  /** Per slot: the tick a level last changed there (O8: a slot may sleep after SLEEP.quietDays without one). */
  readonly levelTick: Int32Array;
  /** Ruin pay this month (MEGACITY §3.7) and the month it counts for. */
  private ruinPay = 0;
  private ruinPayMonth = -1;
  private readonly R: number;

  /** The per-world frame (MEGACITY §3.1): one counter per tile of `world`. */
  constructor(world: Pick<World, 'area'> & Partial<Pick<World, 'region'>>) {
    this.unpoweredDays = new Uint16Array(world.area);
    this.R = world.region ?? 1;
    this.levelTick = new Int32Array(this.R * this.R);
  }

  /** Advance per-tile counters. Call once per tick after the power pass. */
  countDays(g: SimGrid, power: PowerGrid): void {
    const days = this.unpoweredDays;
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      if (g.developed(i) && !power.powered[i]) {
        if (days[i] < 65535) days[i]++;
      } else days[i] = 0;
    }
  }

  run(world: World, g: SimGrid, power: PowerGrid, fields: FieldSystem, demand: Demand): void {
    drain(this.runUnit(world, g, power, fields, demand, false));
  }

  /**
   * Growth as a resumable unit (MEGACITY §3.3 C1): the zoned list in chunks of ZONED_CHUNK, in order, so the rolls are
   * the whole pass's. Not restartable (it changes tiles): `stop()` returning true between chunks (a player action
   * re-scanned the grid mid-day) ends this day's growth there.
   */
  *runUnit(world: World, g: SimGrid, power: PowerGrid, fields: FieldSystem, demand: Demand, banded: boolean, stop?: () => boolean): Unit {
    this.reached.fill(0);
    this.reachedWealth.fill(0);
    this.changes = 0;
    this.tierSteps = 0;
    const zc = g.zonedCount;
    const step = banded ? ZONED_CHUNK : zc + 1;
    for (let k0 = 0; k0 < zc; k0 += step) {
      yield K.Growth;
      if (stop && stop()) return;
      this.runRange(world, g, power, fields, demand, k0, Math.min(zc, k0 + step));
    }
  }

  private runRange(world: World, g: SimGrid, power: PowerGrid, fields: FieldSystem, demand: Demand, k0: number, k1: number): void {
    const rng = world.rng;
    const tiles = world.tiles;
    const f = world.fields;
    const { zone, level, abandoned } = g;
    const days = this.unpoweredDays;
    const growMul = world.mods.growthMul;
    const abandonMul = world.mods.abandonMul;
    const abandonLayer = world.layers.abandonMul;
    const score = f.wealth;
    const streak = world.wealthStreak;
    const gw = g.wealth;
    const ground = g.ground;
    const floodCap = g.floodCap;
    const N = world.N;
    for (let k = k0; k < k1; k++) {
      if (rng.next() >= T.GROWTH_SAMPLE) continue;
      const i = g.zoned[k];
      const z = zone[i];
      const l = level[i];
      const t = tiles[i];
      const d = z === RES ? demand.res : z === COM ? demand.com : demand.ind;
      const road = g.hasRoad(i);
      const crime = f.crime[i];
      const pol = f.pollution[i];
      const isRes = z === RES;

      // Abandoned shells: recover when the neighbourhood is livable again, or collapse. A ruin (ground Rubble)
      // recovers at its district's recoverMul and never collapses.
      if (abandoned[i]) {
        const ruin = ground[i] === RUBBLE;
        const mods = ruin ? DISTRICTS[world.kindAt(i % N, (i / N) | 0)]?.mods : undefined;
        if (
          road &&
          power.powered[i] &&
          d > T.RECOVER_MIN_DEMAND &&
          crime < T.RECOVER_MAX_CRIME &&
          (!isRes || pol < T.RECOVER_MAX_RES_POLLUTION) &&
          rng.chance(ruin ? T.RECOVER_CHANCE * (mods?.recoverMul ?? 1) : T.RECOVER_CHANCE) &&
          power.tryReserve(i, zoneDraw(z, l, 0, g.wealth[i]))
        ) {
          this.set(world, g, i, l, false);
          if (ruin) this.restoreRuin(world, g, i, mods?.restorePay ?? 0);
        } else if (!ruin && t.age > T.COLLAPSE_AGE && rng.chance(T.COLLAPSE_CHANCE)) {
          this.set(world, g, i, 0, false);
        }
        continue;
      }

      // Empty lots: need road, a healthy grid and demand. A new building latches its potential
      // tier, reserving that tier's draw and falling back to lower tiers if the grid can't.
      if (l === 0) {
        streak[i] = 0;
        if (ground[i] === BROWNFIELD) this.clearBrownfield(world, i, -1, f.park[i], f.filter[i]);
        if (road && d > 0.02 && power.canFeed(i) && rng.chance((T.GROW_BASE + T.GROW_SLOPE * d) * growMul)) {
          const pot = W.potentialTier(z, score[i], W.tierCap(z, crime, f.noise[i], pol, f.alleyNear[i]));
          for (let tier = pot; tier >= 0; tier--) {
            if (power.tryReserve(i, zoneDraw(z, 1, 0, tier))) {
              this.set(world, g, i, 1, false, tier as WealthTier);
              if (tier > 0) this.reachedWealth[z * 3 + tier] = 1;
              break;
            }
          }
        }
        continue;
      }

      // Wealth tier (§4.3): hysteresis over sampled evaluations, before the decline checks.
      const tier = gw[i];
      const dir = W.stepTarget(z, tier, score[i], W.tierCap(z, crime, f.noise[i], pol, f.alleyNear[i]));
      if (dir === 0) streak[i] = 0;
      else {
        const sv = streak[i];
        const next = (sv > 0 ? 1 : sv < 0 ? -1 : 0) === dir ? sv + dir : dir;
        streak[i] = next > 127 ? 127 : next < -127 ? -127 : next;
        if ((next < 0 ? -next : next) >= STREAK) {
          const to = tier + dir;
          // Reserve whenever the new tier draws more, either way: a $$$ Fab stepping down to $$ does.
          // Otherwise (a cheaper down-step) it steps at once. Waiting keeps the streak: it retries next sample.
          const extra = zoneDraw(z, l, 0, to) - zoneDraw(z, l, 0, tier);
          if ((dir < 0 && extra <= 0) || (power.canFeed(i) && power.tryReserve(i, extra))) {
            world.setWealth(i % world.N, (i / world.N) | 0, to as WealthTier);
            gw[i] = to;
            streak[i] = 0;
            this.tierSteps++;
            if (dir > 0) this.reachedWealth[z * 3 + to] = 1;
          }
        }
      }

      // Brownfield clears under development or parks (MEGACITY §3.3): no rng draw.
      if (ground[i] === BROWNFIELD) this.clearBrownfield(world, i, t.age, f.park[i], f.filter[i]);

      // Developed: decline first, then try to upgrade.
      const am = abandonMul * abandonLayer[i];
      if (!road) {
        if (rng.chance(T.ABANDON_NO_ROAD * am)) this.set(world, g, i, l, true);
        continue;
      }
      if (days[i] > T.UNPOWERED_GRACE_DAYS) {
        if (rng.chance(T.ABANDON_UNPOWERED * am)) this.set(world, g, i, l, true);
        continue;
      }
      if (crime > T.ABANDON_CRIME && rng.chance((crime - T.ABANDON_CRIME) * 1.5 * am)) {
        this.set(world, g, i, l, true);
        continue;
      }
      if (isRes && pol > T.ABANDON_RES_POLLUTION && rng.chance((pol - T.ABANDON_RES_POLLUTION) * 1.5 * am)) {
        this.set(world, g, i, l, true);
        continue;
      }
      if (d < T.DECLINE_DEMAND && t.age > T.DECLINE_MIN_AGE) {
        if (rng.chance((0.04 + (T.DECLINE_DEMAND - d) * 0.4) * am)) {
          if (l > 1) this.set(world, g, i, l - 1, false);
          else this.set(world, g, i, 1, true);
        }
        continue;
      }
      if (l >= 3) continue;
      // Floodplain (Reedmere): level 2 at most while no Floodwatch covers the tile.
      if (l >= floodCap[i] && f.resilience[i] <= 0) continue;
      if (
        t.age >= T.UPGRADE_MIN_AGE[l] &&
        d > T.UPGRADE_MIN_DEMAND[l] &&
        f.landValue[i] >= LEVEL_LV[z][l - 1] &&
        crime < T.UPGRADE_MAX_CRIME &&
        pol < T.UPGRADE_MAX_POLLUTION[z] &&
        fields.localTraffic[i] < T.UPGRADE_MAX_TRAFFIC &&
        power.canFeed(i)
      ) {
        const p = T.UPGRADE_BASE[l] + T.UPGRADE_SLOPE[l] * d + (isRes ? f.health[i] * T.HEALTH_GROWTH_BONUS : 0);
        const tl = gw[i];
        if (rng.chance(p * growMul) && power.tryReserve(i, zoneDraw(z, l + 1, 0, tl) - zoneDraw(z, l, 0, tl)))
          this.set(world, g, i, l + 1, false);
      }
    }
  }

  /**
   * One-time settle for old saves (EXPANSION §4.3, Simulation.settleWealth): every developed,
   * non-abandoned zone tile in index order steps up one tier at a time toward its potential
   * tier while the grid accepts the extra draw. No rng, no streaks. Returns the steps taken.
   * Call after recomputeAll (fields and the power pass must be current).
   */
  settle(world: World, g: SimGrid, power: PowerGrid): number {
    const f = world.fields;
    const gw = g.wealth;
    let steps = 0;
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      if (!g.developed(i)) continue;
      const z = g.zone[i];
      const l = g.level[i];
      const target = W.potentialTier(z, f.wealth[i], W.tierCap(z, f.crime[i], f.noise[i], f.pollution[i], f.alleyNear[i]));
      let t = gw[i];
      while (t < target && power.tryReserve(i, zoneDraw(z, l, 0, t + 1) - zoneDraw(z, l, 0, t))) {
        t++;
        steps++;
      }
      if (t !== gw[i]) {
        world.setWealth(i % world.N, (i / world.N) | 0, t as WealthTier);
        gw[i] = t;
        world.wealthStreak[i] = 0;
      }
    }
    return steps;
  }

  /** A ruin came back (MEGACITY §3.7): ground Plain, one more restored, the district's pay up to the monthly cap. */
  private restoreRuin(world: World, g: SimGrid, i: number, pay: number): void {
    const N = world.N;
    world.setGround(i % N, (i / N) | 0, Ground.Plain);
    g.ground[i] = Ground.Plain;
    g.blightW[i] = 0;
    world.districts.ruinsRestored = (world.districts.ruinsRestored ?? 0) + 1;
    if (pay <= 0) return;
    const month = Math.floor(world.tick / DAYS_PER_MONTH);
    if (month !== this.ruinPayMonth) {
      this.ruinPayMonth = month;
      this.ruinPay = 0;
    }
    const p = Math.min(pay, RUINS.payCapMonth - this.ruinPay);
    if (p <= 0) return;
    this.ruinPay += p;
    world.funds += p;
  }

  /**
   * Brownfield on a sampled tile clears when its district's rule says so: developed for clearDays (`age` −1 for a
   * lot), or park ≥ 0.3 or filter > 0 for parkClearDays.
   */
  private clearBrownfield(world: World, i: number, age: number, park: number, filter: number): void {
    const N = world.N;
    const x = i % N;
    const y = (i / N) | 0;
    const bf = DISTRICTS[world.kindAt(x, y)]?.mods.brownfield;
    if (!bf) return;
    const tAge = world.tiles[i].age;
    const clear = (age >= 0 && age >= bf.clearDays) || ((park >= BROWNFIELD_PARK || filter > 0) && tAge >= bf.parkClearDays);
    if (clear) world.setGround(x, y, Ground.Plain);
  }

  private set(world: World, g: SimGrid, i: number, level: number, abandoned: boolean, tier?: WealthTier): void {
    const N = world.N;
    this.levelTick[(((i / N) | 0) >> 6) * this.R + ((i % N) >> 6)] = world.tick;
    world.setLevel(i % world.N, (i / world.N) | 0, level, abandoned, tier);
    g.level[i] = level;
    g.abandoned[i] = abandoned && level > 0 ? 1 : 0;
    g.wealth[i] = world.tiles[i].wealth;
    if (level === 0) world.wealthStreak[i] = 0;
    this.unpoweredDays[i] = 0;
    this.changes++;
    if (!abandoned && level > 0) this.reached[g.zone[i] * 4 + level] = 1;
  }
}
