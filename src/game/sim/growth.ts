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
// ─────────────────────────────────────────────────────────────────────────────

import { WEALTH, ZONES } from '../config';
import { MAP_SIZE, ZoneType, type Demand, type WealthTier } from '../types';
import * as Wealth from '../wealth';
import type { World } from '../world';
import type { SimGrid } from './grid';
import type { FieldSystem } from './fields';
import { zoneDraw, type PowerGrid } from './power';
import * as Tuning from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
const T = { ...Tuning };
const W = { ...Wealth };
const STREAK = WEALTH.streak;
const N = MAP_SIZE;
const AREA = N * N;
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;

/** Land value needed for level 2 and 3, index = ZoneType. */
const LEVEL_LV: readonly (readonly [number, number])[] = [
  [1, 1],
  ZONES.res.levelLandValue,
  ZONES.com.levelLandValue,
  ZONES.ind.levelLandValue,
];

export class GrowthSystem {
  /** Consecutive days each developed tile has gone without power. */
  readonly unpoweredDays = new Uint16Array(AREA);
  /** Flags set this tick when a tile reached (zone * 4 + level). Cleared by run(). */
  readonly reached = new Uint8Array(16);
  /** Flags set this tick when a tile stepped up to (zone * 3 + tier). Cleared by run(). */
  readonly reachedWealth = new Uint8Array(12);
  /** Tier steps during the last run (up and down). */
  tierSteps = 0;
  /** Level changes during the last run (for debugging / tests). */
  changes = 0;

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
    this.reached.fill(0);
    this.reachedWealth.fill(0);
    this.changes = 0;
    this.tierSteps = 0;

    for (let k = 0; k < g.zonedCount; k++) {
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

      // Abandoned shells: recover when the neighbourhood is livable again, or collapse.
      if (abandoned[i]) {
        if (
          road &&
          power.powered[i] &&
          d > T.RECOVER_MIN_DEMAND &&
          crime < T.RECOVER_MAX_CRIME &&
          (!isRes || pol < T.RECOVER_MAX_RES_POLLUTION) &&
          rng.chance(T.RECOVER_CHANCE) &&
          power.tryReserve(i, zoneDraw(z, l, 0, g.wealth[i]))
        ) {
          this.set(world, g, i, l, false);
        } else if (t.age > T.COLLAPSE_AGE && rng.chance(T.COLLAPSE_CHANCE)) {
          this.set(world, g, i, 0, false);
        }
        continue;
      }

      // Empty lots: need road, a healthy grid and demand. A new building latches its potential
      // tier, reserving that tier's draw and falling back to lower tiers if the grid can't.
      if (l === 0) {
        streak[i] = 0;
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
          if (dir < 0 || (power.canFeed(i) && power.tryReserve(i, zoneDraw(z, l, 0, to) - zoneDraw(z, l, 0, tier)))) {
            world.setWealth(i % N, (i / N) | 0, to as WealthTier);
            gw[i] = to;
            streak[i] = 0;
            this.tierSteps++;
            if (dir > 0) this.reachedWealth[z * 3 + to] = 1;
          }
        }
      }

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
        if (rng.chance(p * growMul) && power.tryReserve(i, zoneDraw(z, l + 1, 0, tl) - zoneDraw(z, l, 0, tl))) this.set(world, g, i, l + 1, false);
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
        world.setWealth(i % N, (i / N) | 0, t as WealthTier);
        gw[i] = t;
        world.wealthStreak[i] = 0;
      }
    }
    return steps;
  }

  private set(world: World, g: SimGrid, i: number, level: number, abandoned: boolean, tier?: WealthTier): void {
    world.setLevel(i % N, (i / N) | 0, level, abandoned, tier);
    g.level[i] = level;
    g.abandoned[i] = abandoned && level > 0 ? 1 : 0;
    g.wealth[i] = world.tiles[i].wealth;
    if (level === 0) world.wealthStreak[i] = 0;
    this.unpoweredDays[i] = 0;
    this.changes++;
    if (!abandoned && level > 0) this.reached[g.zone[i] * 4 + level] = 1;
  }
}
