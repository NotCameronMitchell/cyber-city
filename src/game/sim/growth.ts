// ─────────────────────────────────────────────────────────────────────────────
// Zone growth, decline, abandonment and recovery. Each tick a random ~1/6 of
// zoned tiles is evaluated so the city fills in organically instead of in
// lock-step waves. All level changes go through world.setLevel() so the
// renderer hears about them.
// ─────────────────────────────────────────────────────────────────────────────

import { ZONES } from '../config';
import { MAP_SIZE, ZoneType, type Demand } from '../types';
import type { World } from '../world';
import type { SimGrid } from './grid';
import type { FieldSystem } from './fields';
import type { PowerGrid } from './power';
import * as Tuning from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
const T = { ...Tuning };
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
    this.reached.fill(0);
    this.changes = 0;

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
          rng.chance(T.RECOVER_CHANCE)
        ) {
          this.set(world, g, i, l, false);
        } else if (t.age > T.COLLAPSE_AGE && rng.chance(T.COLLAPSE_CHANCE)) {
          this.set(world, g, i, 0, false);
        }
        continue;
      }

      // Empty lots: need road, a healthy grid and demand.
      if (l === 0) {
        if (road && d > 0.02 && power.canFeed(i) && rng.chance(T.GROW_BASE + T.GROW_SLOPE * d)) {
          this.set(world, g, i, 1, false);
        }
        continue;
      }

      // Developed: decline first, then try to upgrade.
      if (!road) {
        if (rng.chance(T.ABANDON_NO_ROAD)) this.set(world, g, i, l, true);
        continue;
      }
      if (days[i] > T.UNPOWERED_GRACE_DAYS) {
        if (rng.chance(T.ABANDON_UNPOWERED)) this.set(world, g, i, l, true);
        continue;
      }
      if (crime > T.ABANDON_CRIME && rng.chance((crime - T.ABANDON_CRIME) * 1.5)) {
        this.set(world, g, i, l, true);
        continue;
      }
      if (isRes && pol > T.ABANDON_RES_POLLUTION && rng.chance((pol - T.ABANDON_RES_POLLUTION) * 1.5)) {
        this.set(world, g, i, l, true);
        continue;
      }
      if (d < T.DECLINE_DEMAND && t.age > T.DECLINE_MIN_AGE) {
        if (rng.chance(0.04 + (T.DECLINE_DEMAND - d) * 0.4)) {
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
        if (rng.chance(p)) this.set(world, g, i, l + 1, false);
      }
    }
  }

  private set(world: World, g: SimGrid, i: number, level: number, abandoned: boolean): void {
    world.setLevel(i % N, (i / N) | 0, level, abandoned);
    g.level[i] = level;
    g.abandoned[i] = abandoned && level > 0 ? 1 : 0;
    this.unpoweredDays[i] = 0;
    this.changes++;
    if (!abandoned && level > 0) this.reached[g.zone[i] * 4 + level] = 1;
  }
}
