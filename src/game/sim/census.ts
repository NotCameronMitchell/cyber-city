// ─────────────────────────────────────────────────────────────────────────────
// Census: head-counts (residents, jobs, workforce), development tallies,
// field averages, approval and RCI demand. Everything here is a pure function
// of the grid + fields, so recomputeAll() can rebuild it at any time.
//
// Expansion (docs/EXPANSION.md §4.4, §5, §6): capacity by wealth tier (and the
// affordable quarter beside alleys), tier counts and their effect against an
// all-$ city, noise averages, road counts, approval terms (prosperity, noise)
// and the demand adds from ports, regional links and visitors.
// ─────────────────────────────────────────────────────────────────────────────

import { blankStats, buildingStats } from '../buildingStats';
import { NOISE, POP_SCALE, WEALTH } from '../config';
import { Ground, ZoneType, type CityStats, type Demand, type DistrictKind, type SlotId } from '../types';
import type { World } from '../world';
import type { SimGrid } from './grid';
import type { FieldSystem } from './fields';
import { K, ZONED_CHUNK, drain, type Unit } from './slice';
import type { PowerGrid } from './power';
import * as Tiers from './tiers';
import * as Tuning from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
const T = { ...Tuning };
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;

const CAP_T = Tiers.CAP_T;
const CAP_AFF = Tiers.CAP_AFF;
const PROSPERITY = WEALTH.approval.prosperity;
const NOISE_APPROVAL = NOISE.approval;

const clampDemand = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
const RUBBLE = Ground.Rubble;

/** One owned district's tallies (MEGACITY §3.3): the census per slot, plus the demand rules' tile counts. */
export interface DistrictTally {
  slot: SlotId;
  kind: DistrictKind;
  residents: number;
  jobs: number;
  /** Developed (occupied) zone tiles. */
  developed: number;
  ruins: number;
  /** Developed Fab tiles (the Flats demand add) and Market tiles (Bazaar visitors). */
  fabTiles: number;
  marketTiles: number;
  /** Σ land value over developed tiles (averages()). */
  lvSum: number;
}
/** Scratch stats object reused for every building (no per-tick allocation). */
const STATS = blankStats();
const blankTally = (): DistrictTally => ({ slot: 0, kind: 'shore', residents: 0, jobs: 0, developed: 0, ruins: 0, fabTiles: 0, marketTiles: 0, lvSum: 0 });

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
  // ── Expansion ──
  /** Developed tiles by zone and tier (index zone * 3 + tier). */
  readonly tierCount = new Int32Array(12);
  /** Residents tiers add against an all-$ city (negative = fewer; affordable quarters included). */
  tierResidents = 0;
  /** Mean noise over developed tiles, and over developed Hab Blocks. */
  avgNoise = 0;
  avgNoiseRes = 0;
  /** Ground road tiles by kind and skyway tiles (copied from the grid by count()). */
  readonly roads = { street: 0, avenue: 0, highway: 0, alley: 0, ramp: 0, skyway: 0 };
  edgeLinks = 0;
  /** Demand-target adds set by the simulation before demandTarget(): ports, regional links, visitors (§5, §6). */
  tradeInd = 0;
  tradeCom = 0;
  /** Ruins standing (MEGACITY §3.7: zoned, abandoned, ground Rubble), counted apart from `abandoned`. */
  ruins = 0;
  /** Per owned district, in `districts.owned` order (count() with a world). */
  readonly byDistrict: DistrictTally[] = [];
  /** Slot → index in byDistrict (−1 unowned). */
  private slotIndex = new Int32Array(0);
  /** A count in progress (countUnit): accumulators and the per-slot sums, published in its last step. */
  private readonly acc = {
    dev: [0, 0, 0, 0],
    lots: [0, 0, 0, 0],
    lotsRoad: [0, 0, 0, 0],
    lc: new Int32Array(16),
    tc: new Int32Array(12),
    tierRes: 0,
    pop: 0,
    jobsCom: 0,
    jobsInd: 0,
    noRoad: 0,
    aband: 0,
    ruins: 0,
    // Per slot (index SlotId), summed in tile order: typed arrays keep the hot loop free of object writes.
    sDev: new Int32Array(1),
    sRuins: new Int32Array(1),
    sFab: new Int32Array(1),
    sMkt: new Int32Array(1),
    sRes: new Float64Array(1),
    sJobs: new Float64Array(1),
  };
  /** Σ land value over developed tiles per slot (averages()), copied into byDistrict[k].lvSum. */
  private lvBySlot = new Float64Array(1);

  /**
   * Count heads, jobs and development from the grid (no field reads). With `world`, also the per-district tallies
   * (MEGACITY §3.3). Ruins (ground Rubble) count in `ruins`, never in `abandoned`. Whole pass.
   */
  count(g: SimGrid, world?: World): void {
    drain(this.countUnit(g, world, false));
  }

  /**
   * The count as a resumable unit (MEGACITY §3.3 A1 / C1): the zoned list in chunks of ZONED_CHUNK tiles into private
   * accumulators, then the buildings; the public numbers and the tallies change only in the last step, so a reader
   * between two steps sees the previous count whole.
   */
  *countUnit(g: SimGrid, world: World | undefined, banded: boolean): Unit {
    const acc = this.acc;
    acc.dev.fill(0);
    acc.lots.fill(0);
    acc.lotsRoad.fill(0);
    acc.lc.fill(0);
    acc.tc.fill(0);
    acc.tierRes = 0;
    acc.pop = 0;
    acc.jobsCom = 0;
    acc.jobsInd = 0;
    acc.noRoad = 0;
    acc.aband = 0;
    acc.ruins = 0;
    const R = world ? world.region : 1;
    const slots = R * R;
    if (acc.sDev.length !== slots) {
      acc.sDev = new Int32Array(slots);
      acc.sRuins = new Int32Array(slots);
      acc.sFab = new Int32Array(slots);
      acc.sMkt = new Int32Array(slots);
      acc.sRes = new Float64Array(slots);
      acc.sJobs = new Float64Array(slots);
    } else {
      acc.sDev.fill(0);
      acc.sRuins.fill(0);
      acc.sFab.fill(0);
      acc.sMkt.fill(0);
      acc.sRes.fill(0);
      acc.sJobs.fill(0);
    }
    const zc = g.zonedCount;
    const step = banded ? ZONED_CHUNK : zc + 1;
    for (let k0 = 0; k0 < zc; k0 += step) {
      yield K.Census;
      this.countZoned(g, k0, Math.min(zc, k0 + step));
    }
    yield K.Census;
    // Stage-aware (Stratablocks count complete, powered stages only; §4.2).
    const st = STATS;
    let pop = acc.pop;
    let jobsCom = acc.jobsCom;
    let jobsInd = acc.jobsInd;
    const sRes = acc.sRes;
    const sJobs = acc.sJobs;
    for (const b of g.buildings) {
      buildingStats(b, st);
      pop += st.residents;
      jobsCom += st.jobsCom;
      jobsInd += st.jobsInd;
      const s = (b.y >> 6) * R + (b.x >> 6);
      if (s >= 0 && s < slots) {
        sRes[s] += st.residents;
        sJobs[s] += st.jobsCom + st.jobsInd;
      }
    }
    // Publish.
    this.developed.splice(0, 4, acc.dev[0], acc.dev[1], acc.dev[2], acc.dev[3]);
    this.lots.splice(0, 4, acc.lots[0], acc.lots[1], acc.lots[2], acc.lots[3]);
    this.lotsWithRoad.splice(0, 4, acc.lotsRoad[0], acc.lotsRoad[1], acc.lotsRoad[2], acc.lotsRoad[3]);
    this.levelCount.set(acc.lc);
    this.tierCount.set(acc.tc);
    if (world) this.publishTallies(world);
    this.ruins = acc.ruins;
    this.tierResidents = acc.tierRes;
    const r = this.roads;
    r.street = g.kindTiles(0);
    r.avenue = g.kindTiles(1);
    r.highway = g.kindTiles(2);
    r.alley = g.kindTiles(3);
    r.ramp = g.kindTiles(4);
    r.skyway = g.skyCount;
    this.edgeLinks = g.edgePoints;
    this.population = pop;
    this.jobsCom = jobsCom;
    this.jobsInd = jobsInd;
    this.noRoad = acc.noRoad;
    this.abandoned = acc.aband;
    // Whole tens of people (POP_SCALE), like every head count: the unit change stays exact (MEGACITY §4.1).
    const workforce = Math.round((pop * T.WORKFORCE_SHARE) / POP_SCALE) * POP_SCALE;
    const jobs = jobsCom + jobsInd;
    this.workforce = workforce;
    this.employed = Math.min(workforce, jobs);
    this.unemployment = workforce > 0 ? 1 - this.employed / workforce : 0;
    this.jobFill = jobs > 0 ? this.employed / jobs : 1;
    const scale = Math.min(1, Math.max(T.UNEMPLOYMENT_FLOOR, pop / T.UNEMPLOYMENT_FULL_POP));
    this.joblessPressure = this.unemployment * scale;
  }

  /** Zoned entries k0..k1 of the grid into the accumulators (and the per-slot tallies). */
  private countZoned(g: SimGrid, k0: number, k1: number): void {
    const acc = this.acc;
    const slotOf = g.layout.slot;
    const ground = g.ground;
    const { zone, level, abandoned, wealth, alleyNear, zoned } = g;
    const { dev, lots, lc, tc, sDev, sRuins, sFab, sMkt, sRes, sJobs } = acc;
    const lotsRoad = acc.lotsRoad;
    let tierRes = acc.tierRes;
    let pop = acc.pop;
    let jobsCom = acc.jobsCom;
    let jobsInd = acc.jobsInd;
    let noRoad = acc.noRoad;
    let aband = acc.aband;
    let ruins = acc.ruins;
    for (let k = k0; k < k1; k++) {
      const i = zoned[k];
      const z = zone[i];
      const l = level[i];
      const road = g.hasRoad(i);
      if (!road) noRoad++;
      if (abandoned[i]) {
        if (ground[i] === RUBBLE) {
          ruins++;
          sRuins[slotOf[i]]++;
        } else aband++;
        continue;
      }
      if (l === 0) {
        lots[z]++;
        if (road) lotsRoad[z]++;
        continue;
      }
      dev[z]++;
      lc[z * 4 + l]++;
      const t = wealth[i];
      tc[z * 3 + t]++;
      const cap = z === RES && t === 0 && alleyNear[i] ? CAP_AFF[l] : CAP_T[z * 12 + l * 3 + t];
      const s = slotOf[i];
      sDev[s]++;
      if (z === RES) {
        pop += cap;
        tierRes += cap - CAP_T[z * 12 + l * 3];
        sRes[s] += cap;
      } else {
        sJobs[s] += cap;
        if (z === COM) {
          jobsCom += cap;
          sMkt[s]++;
        } else {
          jobsInd += cap;
          sFab[s]++;
        }
      }
    }
    acc.tierRes = tierRes;
    acc.pop = pop;
    acc.jobsCom = jobsCom;
    acc.jobsInd = jobsInd;
    acc.noRoad = noRoad;
    acc.aband = aband;
    acc.ruins = ruins;
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
    let no = 0;
    let noRes = 0;
    let nRes = 0;
    const noise = f.noise;
    const tally = this.byDistrict;
    const slotOf = g.layout.slot;
    const slots = world.region * world.region;
    if (this.lvBySlot.length !== slots) this.lvBySlot = new Float64Array(slots);
    const lvs = this.lvBySlot;
    lvs.fill(0);
    const { zoned, level, abandoned, zone } = g;
    const { landValue, crime, pollution, security, health, park } = f;
    const local = fields.localTraffic;
    for (let k = 0, zc = g.zonedCount; k < zc; k++) {
      const i = zoned[k];
      // Developed: a zoned entry with a level and not abandoned (SimGrid.developed, inlined).
      if (level[i] === 0 || abandoned[i] !== 0) continue;
      n++;
      const l = landValue[i];
      lv += l;
      lvs[slotOf[i]] += l;
      cr += crime[i];
      po += pollution[i];
      tr += local[i];
      sv += (security[i] + health[i] + park[i]) / 3;
      const v = noise[i];
      no += v;
      if (zone[i] === RES) {
        nRes++;
        noRes += v;
      }
    }
    for (const d of tally) d.lvSum = d.slot >= 0 && d.slot < slots ? lvs[d.slot] : 0;
    const inv = n > 0 ? 1 / n : 0;
    this.avgNoise = no * inv;
    this.avgNoiseRes = nRes > 0 ? noRes / nRes : 0;
    this.avgLandValue = lv * inv;
    this.avgCrime = cr * inv;
    this.avgPollution = po * inv;
    this.avgTraffic = tr * inv;
    this.serviceCoverage = sv * inv;
  }

  /**
   * Citizen approval 0..100 from taxes, crime, pollution, jobs, power, traffic and services, plus
   * `mods.approvalAdd`; expansion: + prosperity × share of developed Hab Blocks at $$ or $$$,
   * − NOISE.approval × avgNoise (§4.4). An all-$, quiet city reads exactly as before.
   */
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
      Math.min(1, this.serviceCoverage * 2.5) * T.APPROVAL_SERVICES +
      world.mods.approvalAdd +
      this.prosperity() * PROSPERITY -
      this.avgNoise * NOISE_APPROVAL +
      // City life (MEGACITY §6.4.1): a happening's approval term while it has sim days left.
      (world.cityEvent && world.cityEvent.daysLeft > 0 ? world.cityEvent.approval : 0) +
      landmarkTerms(world).approval;
    return Math.max(0, Math.min(100, v));
  }

  /** Share 0..1 of developed Hab Blocks at $$ or $$$. */
  prosperity(): number {
    const tc = this.tierCount;
    const all = tc[RES * 3] + tc[RES * 3 + 1] + tc[RES * 3 + 2];
    return all > 0 ? (tc[RES * 3 + 1] + tc[RES * 3 + 2]) / all : 0;
  }

  /**
   * Unsmoothed RCI demand. Residents follow jobs (plus a starter wave of
   * settlers); commerce follows shoppers and industrial output; industry
   * follows the workforce plus an export base. Tax and approval shift all three.
   * Story mods (§10.6): the tax term × `taxDemandMul`; `demandRes/Com/Ind` add last.
   * Expansion: `tradeInd` / `tradeCom` (ports, regional links, visitors) raise the targets.
   */
  demandTarget(world: World, approval: number, comBoost: number, out: Demand): Demand {
    const pop = this.population;
    const jobs = this.jobsCom + this.jobsInd;
    const m = world.mods;
    const tax = (T.TAX_NEUTRAL - world.taxRate) * T.TAX_DEMAND * m.taxDemandMul;
    const mood = (approval - T.APPROVAL_NEUTRAL) * T.APPROVAL_DEMAND;

    const resTarget = (jobs / T.WORKFORCE_SHARE) * T.RES_PER_JOB + T.RES_STARTER;
    const res = (resTarget - pop) / Math.max(T.RES_DEMAND_FLOOR, pop * 0.3);

    const comTarget = pop * T.COM_PER_RES + this.jobsInd * T.COM_PER_IND + T.COM_BASE + this.tradeCom;
    const com = (comTarget - this.jobsCom) / Math.max(T.JOB_DEMAND_FLOOR, comTarget * 0.35);

    const indTarget = this.workforce * T.IND_PER_WORKER + T.IND_EXPORT_BASE + this.tradeInd;
    const ind = (indTarget - this.jobsInd) / Math.max(T.JOB_DEMAND_FLOOR, indTarget * 0.35);

    out.res = clampDemand(clampDemand(res) + tax + mood + m.demandRes);
    // City life (MEGACITY §6.4.1): a happening's Market demand term while it has sim days left.
    const life = world.cityEvent && world.cityEvent.daysLeft > 0 ? world.cityEvent.demandCom : 0;
    out.com = clampDemand(clampDemand(com) + tax * 0.8 + mood * 0.5 + comBoost + m.demandCom + life + landmarkTerms(world).demandCom);
    out.ind = clampDemand(clampDemand(ind) + tax + m.demandInd);
    return out;
  }

  /** The finished per-slot sums become `byDistrict`, one row per owned slot in annex order (lvSum from averages()). */
  private publishTallies(world: World): void {
    const acc = this.acc;
    const R = world.region;
    if (this.slotIndex.length !== R * R) this.slotIndex = new Int32Array(R * R);
    this.slotIndex.fill(-1);
    if (this.lvBySlot.length !== R * R) this.lvBySlot = new Float64Array(R * R);
    const owned = world.districts.owned;
    const out = this.byDistrict;
    out.length = owned.length;
    for (let k = 0; k < owned.length; k++) {
      const s = owned[k];
      let d = out[k];
      if (!d) d = out[k] = blankTally();
      d.slot = s;
      d.kind = world.districts.kinds[s] ?? 'shore';
      const ok = s >= 0 && s < R * R;
      if (ok) this.slotIndex[s] = k;
      d.residents = ok ? acc.sRes[s] : 0;
      d.jobs = ok ? acc.sJobs[s] : 0;
      d.developed = ok ? acc.sDev[s] : 0;
      d.ruins = ok ? acc.sRuins[s] : 0;
      d.fabTiles = ok ? acc.sFab[s] : 0;
      d.marketTiles = ok ? acc.sMkt[s] : 0;
      d.lvSum = ok ? this.lvBySlot[s] : 0;
    }
  }

  /** world.stats.districts (one row per owned district, reused), ruins and ruinsRestored (MEGACITY §3.3). */
  writeDistricts(world: World): void {
    const stats = world.stats;
    const out = stats.districts;
    const list = this.byDistrict;
    out.length = list.length;
    for (let k = 0; k < list.length; k++) {
      const d = list[k];
      let o = out[k];
      if (!o) o = out[k] = { slot: d.slot, kind: d.kind, variant: 0, residents: 0, jobs: 0, developed: 0, avgLandValue: 0, ruins: 0 };
      o.slot = d.slot;
      o.kind = d.kind;
      o.variant = world.variantOf(d.slot);
      o.residents = d.residents;
      o.jobs = d.jobs;
      o.developed = d.developed;
      o.avgLandValue = d.developed > 0 ? d.lvSum / d.developed : 0;
      o.ruins = d.ruins;
    }
    stats.ruins = this.ruins;
    stats.ruinsRestored = world.districts.ruinsRestored ?? 0;
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
    const tc = this.tierCount;
    stats.wealth[0] = tc[3] + tc[6] + tc[9];
    stats.wealth[1] = tc[4] + tc[7] + tc[10];
    stats.wealth[2] = tc[5] + tc[8] + tc[11];
    stats.tierEffect.residents = Math.round(this.tierResidents);
    stats.avgNoise = this.avgNoise;
    const r = stats.roads;
    r.street = this.roads.street;
    r.avenue = this.roads.avenue;
    r.highway = this.roads.highway;
    r.alley = this.roads.alley;
    r.ramp = this.roads.ramp;
    r.skyway = this.roads.skyway;
    stats.edgeLinks = this.edgeLinks;
  }
}

/**
 * The §6.3 landmark terms the census applies (MEGACITY): Charter Hall +3 and Lamp Choir +2 approval while they stand
 * (complete), each live (online, powered) Market Hall +0.5 approval (cap +2) and +0.01 Market demand (cap +0.05).
 * Counted from the buildings once per day, world version and coverage version (a power flip moves the last).
 */
export function landmarkTerms(world: World): { approval: number; demandCom: number } {
  const key = `${world.tick}|${world.version}|${world.coverageVersion}`;
  const c = LANDMARK_TERMS.get(world);
  if (c && c.key === key) return c;
  let charter = 0;
  let choir = 0;
  let halls = 0;
  for (const b of world.buildings.values()) {
    if (b.type !== 'charterhall' && b.type !== 'lampchoir' && b.type !== 'markethall') continue;
    if ((b.buildDays ?? 0) > 0) continue;
    if (b.type === 'charterhall') charter = 1;
    else if (b.type === 'lampchoir') choir = 1;
    else if (b.offline <= 0 && b.powered) halls++;
  }
  const out = {
    key,
    approval:
      charter * T.CHARTER_HALL_APPROVAL + choir * T.LAMP_CHOIR_APPROVAL + Math.min(T.MARKET_HALL_APPROVAL_CAP, halls * T.MARKET_HALL_APPROVAL),
    demandCom: Math.min(T.MARKET_HALL_DEMAND_CAP, halls * T.MARKET_HALL_DEMAND),
  };
  LANDMARK_TERMS.set(world, out);
  return out;
}
const LANDMARK_TERMS = new WeakMap<World, { key: string; approval: number; demandCom: number }>();
