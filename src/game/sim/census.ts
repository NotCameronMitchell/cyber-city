// ─────────────────────────────────────────────────────────────────────────────
// Census: head-counts (residents, jobs, workforce), development tallies,
// field averages, approval and RCI demand. Everything here is a pure function
// of the grid + fields, so recomputeAll() can rebuild it at any time.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, ZONES } from '../config';
import { ZoneType, type CityStats, type Demand } from '../types';
import type { World } from '../world';
import type { SimGrid } from './grid';
import type { FieldSystem } from './fields';
import type { PowerGrid } from './power';
import * as Tuning from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
const T = { ...Tuning };
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;

const CAPACITY: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  ZONES.res.capacity,
  ZONES.com.capacity,
  ZONES.ind.capacity,
];

const clampDemand = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

export class Census {
  population = 0;
  jobsCom = 0;
  jobsInd = 0;
  workforce = 0;
  employed = 0;
  unemployment = 0;
  /** Share of zone jobs that are filled (0..1); drives commercial/industrial tax. */
  jobFill = 1;
  /** Unemployment weighted by city size (see UNEMPLOYMENT_FULL_POP): what crime and approval react to. */
  joblessPressure = 0;
  /** Developed (occupied) tiles by ZoneType. */
  readonly developed = [0, 0, 0, 0];
  /** Empty level-0 lots by ZoneType, and how many of those have road access. */
  readonly lots = [0, 0, 0, 0];
  readonly lotsWithRoad = [0, 0, 0, 0];
  /** Zoned tiles (any level) with no road in range. */
  noRoad = 0;
  abandoned = 0;
  /** Count of tiles per zone × level (index zone * 4 + level, occupied only). */
  readonly levelCount = new Int32Array(16);
  avgLandValue = 0;
  avgCrime = 0;
  avgPollution = 0;
  avgTraffic = 0;
  /** Mean service coverage (security, health, park) over developed tiles, 0..1. */
  serviceCoverage = 0;

  /** Count heads, jobs and development from the grid (no field reads). */
  count(g: SimGrid): void {
    const { zone, level, abandoned } = g;
    const dev = this.developed;
    const lots = this.lots;
    const lotsRoad = this.lotsWithRoad;
    const lc = this.levelCount;
    dev.fill(0);
    lots.fill(0);
    lotsRoad.fill(0);
    lc.fill(0);
    let pop = 0;
    let jobsCom = 0;
    let jobsInd = 0;
    let noRoad = 0;
    let aband = 0;
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      const z = zone[i];
      const l = level[i];
      const road = g.hasRoad(i);
      if (!road) noRoad++;
      if (abandoned[i]) {
        aband++;
        continue;
      }
      if (l === 0) {
        lots[z]++;
        if (road) lotsRoad[z]++;
        continue;
      }
      dev[z]++;
      lc[z * 4 + l]++;
      const cap = CAPACITY[z][l];
      if (z === RES) pop += cap;
      else if (z === COM) jobsCom += cap;
      else jobsInd += cap;
    }
    for (const b of g.buildings) {
      const def = BUILDINGS[b.type];
      pop += def.residents;
      if (def.category === 'power') jobsInd += def.jobs;
      else jobsCom += def.jobs;
    }
    this.population = pop;
    this.jobsCom = jobsCom;
    this.jobsInd = jobsInd;
    this.noRoad = noRoad;
    this.abandoned = aband;
    const workforce = Math.round(pop * T.WORKFORCE_SHARE);
    const jobs = jobsCom + jobsInd;
    this.workforce = workforce;
    this.employed = Math.min(workforce, jobs);
    this.unemployment = workforce > 0 ? 1 - this.employed / workforce : 0;
    this.jobFill = jobs > 0 ? this.employed / jobs : 1;
    const scale = Math.min(1, Math.max(T.UNEMPLOYMENT_FLOOR, pop / T.UNEMPLOYMENT_FULL_POP));
    this.joblessPressure = this.unemployment * scale;
  }

  /** Averages over developed tiles (call after fields are up to date). */
  averages(world: World, g: SimGrid, fields: FieldSystem): void {
    const f = world.fields;
    let n = 0;
    let lv = 0;
    let cr = 0;
    let po = 0;
    let tr = 0;
    let sv = 0;
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      if (!g.developed(i)) continue;
      n++;
      lv += f.landValue[i];
      cr += f.crime[i];
      po += f.pollution[i];
      tr += fields.localTraffic[i];
      sv += (f.security[i] + f.health[i] + f.park[i]) / 3;
    }
    const inv = n > 0 ? 1 / n : 0;
    this.avgLandValue = lv * inv;
    this.avgCrime = cr * inv;
    this.avgPollution = po * inv;
    this.avgTraffic = tr * inv;
    this.serviceCoverage = sv * inv;
  }

  /** Citizen approval 0..100 from taxes, crime, pollution, jobs, power, traffic and services. */
  approval(world: World, power: PowerGrid): number {
    const devTiles = this.developed[1] + this.developed[2] + this.developed[3];
    if (devTiles === 0 && this.population === 0) return 60;
    const unpoweredShare = devTiles > 0 ? Math.min(1, power.unpoweredTiles / devTiles) : 0;
    const v =
      T.APPROVAL_BASE +
      (8 - world.taxRate) * T.APPROVAL_TAX -
      this.avgCrime * T.APPROVAL_CRIME -
      this.avgPollution * T.APPROVAL_POLLUTION -
      this.joblessPressure * T.APPROVAL_UNEMPLOYMENT -
      unpoweredShare * T.APPROVAL_POWER -
      this.avgTraffic * T.APPROVAL_TRAFFIC +
      Math.min(1, this.serviceCoverage * 2.5) * T.APPROVAL_SERVICES;
    return Math.max(0, Math.min(100, v));
  }

  /**
   * Unsmoothed RCI demand. Residents follow jobs (plus a starter wave of
   * settlers); commerce follows shoppers and industrial output; industry
   * follows the workforce plus an export base. Tax and approval shift all three.
   */
  demandTarget(world: World, approval: number, comBoost: number, out: Demand): Demand {
    const pop = this.population;
    const jobs = this.jobsCom + this.jobsInd;
    const tax = (T.TAX_NEUTRAL - world.taxRate) * T.TAX_DEMAND;
    const mood = (approval - T.APPROVAL_NEUTRAL) * T.APPROVAL_DEMAND;

    const resTarget = (jobs / T.WORKFORCE_SHARE) * T.RES_PER_JOB + T.RES_STARTER;
    const res = (resTarget - pop) / Math.max(160, pop * 0.3);

    const comTarget = pop * T.COM_PER_RES + this.jobsInd * T.COM_PER_IND + T.COM_BASE;
    const com = (comTarget - this.jobsCom) / Math.max(60, comTarget * 0.35);

    const indTarget = this.workforce * T.IND_PER_WORKER + T.IND_EXPORT_BASE;
    const ind = (indTarget - this.jobsInd) / Math.max(60, indTarget * 0.35);

    out.res = clampDemand(clampDemand(res) + tax + mood);
    out.com = clampDemand(clampDemand(com) + tax * 0.8 + mood * 0.5 + comBoost);
    out.ind = clampDemand(clampDemand(ind) + tax);
    return out;
  }

  /** Copy into the shared CityStats object (mutated in place so UI references stay valid). */
  writeStats(stats: CityStats, power: PowerGrid, demand: Demand, approval: number): void {
    stats.population = this.population;
    stats.jobsCom = this.jobsCom;
    stats.jobsInd = this.jobsInd;
    stats.employed = this.employed;
    stats.unemployment = this.unemployment;
    stats.demand.res = demand.res;
    stats.demand.com = demand.com;
    stats.demand.ind = demand.ind;
    stats.powerSupply = power.supply;
    stats.powerDemand = power.demand;
    stats.unpoweredTiles = power.unpoweredTiles;
    stats.avgLandValue = this.avgLandValue;
    stats.avgCrime = this.avgCrime;
    stats.avgPollution = this.avgPollution;
    stats.avgTraffic = this.avgTraffic;
    stats.approval = Math.round(approval);
    stats.developed.res = this.developed[ZoneType.Residential];
    stats.developed.com = this.developed[ZoneType.Commercial];
    stats.developed.ind = this.developed[ZoneType.Industrial];
    stats.abandonedTiles = this.abandoned;
  }
}

