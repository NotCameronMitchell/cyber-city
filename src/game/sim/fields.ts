// ─────────────────────────────────────────────────────────────────────────────
// Scalar fields: service coverage, traffic, pollution, land value and crime.
// Every pass writes straight into world.fields (Float32Array, 0..1) using a
// handful of scratch buffers owned by FieldSystem, so nothing big is allocated
// per tick.
//
// Story hooks (docs/STORY.md §10.6): every pass reads world.mods and
// world.layers (identities by default, so the sandbox is unchanged) and takes
// per-building numbers from buildingStats() (stage-aware Stratablocks).
//
// Expansion (docs/EXPANSION.md §3.8, §3.9, §4.2, §6.1): capacity-aware traffic
// (per-kind capacity, highway and skyway diversion, docks), road pollution by
// volume, noise / hub / sea fields, Academy education coverage, road and noise
// terms in land value and crime, and the wealth score. With streets only and
// every tile at $ the numbers equal the pre-expansion ones.
// ─────────────────────────────────────────────────────────────────────────────

import { blankStats, buildingStats } from '../buildingStats';
import { AIRPORT, BUILDINGS, NOISE, ROAD_FLOW, SEAPORT, SKYWAY, WEALTH } from '../config';
import { ZoneType, type Building, type ServiceEffect } from '../types';
import type { World } from '../world';
import { KIND_CAPACITY, KIND_POLLUTION, type SimGrid } from './grid';
import * as Tiers from './tiers';
import * as Tuning from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops. The frame (N, area) is per world (MEGACITY
// §3.1): copied at construction and into locals per pass.
const T = { ...Tuning };
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;
const IND = ZoneType.Industrial;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// Flat tier tables (sim/tiers.ts), copied into locals.
const CAP_T = Tiers.CAP_T;
const POL_T = Tiers.POL_T;
const CAP_AFF = Tiers.CAP_AFF;

/**
 * Utilisation is carried in street units (u × TRAFFIC_SCALE, so u = 1 reads one street at ~63%):
 * STREET_EQ[k] = TRAFFIC_SCALE / capacity turns trips into that unit (exactly 1 for a Street, so a
 * streets-only city is bit-identical to the pre-expansion maths), INV_SCALE turns it back into
 * congestion, and VOL_K[k] = capacity / TRAFFIC_SCALE² gives the volume against a street.
 */
const STREET_EQ = KIND_CAPACITY.map((c) => Tuning.TRAFFIC_SCALE / c);
const INV_SCALE = 1 / Tuning.TRAFFIC_SCALE;
const VOL_K = KIND_CAPACITY.map((c) => c / (Tuning.TRAFFIC_SCALE * Tuning.TRAFFIC_SCALE));
const VOL_STREET = KIND_CAPACITY.map((c) => c === Tuning.TRAFFIC_SCALE);
const KPOL = [...KIND_POLLUTION];
const HW_DIVERT = ROAD_FLOW.highwayDivert;
const HW_INV = 1 / (ROAD_FLOW.highwayReach + 1);
const SKY = { ...SKYWAY };
const SKY_INV = 1 / (SKYWAY.reach + 1);
const NOISE_LV = NOISE.lv;
const HUB = { ...AIRPORT };
const SEA_R = SEAPORT.indScoreRadius;
const WS_RES = { ...WEALTH.score.res };
const WS_COM = { ...WEALTH.score.com };
const WS_IND = { ...WEALTH.score.ind };
/** Noise def per building type (§3.9), undefined for quiet ones. */
const NOISE_OF: Record<string, { v: number; r: number } | undefined> = {};
for (const def of Object.values(BUILDINGS)) NOISE_OF[def.type] = def.noise;

/** Airport business district by Chebyshev distance to the footprint (§3.9). */
const hubAt = (d: number): number =>
  d < HUB.hubNear ? 0 : d <= HUB.hubFar ? 1 : d < HUB.hubFade ? (HUB.hubFade - d) / (HUB.hubFade - HUB.hubFar) : 0;
/** Seaport proximity (§3.9). */
const seaAt = (d: number): number => (d < SEA_R ? 1 - d / SEA_R : 0);

const EFFECTS: readonly ServiceEffect[] = ['security', 'health', 'net', 'park', 'transit', 'prestige', 'education'];

/** Chebyshev distance from (x, y) to the footprint of b (0 inside). */
function footDist(b: Building, x: number, y: number): number {
  const dx = x < b.x ? b.x - x : x > b.x + b.size - 1 ? x - (b.x + b.size - 1) : 0;
  const dy = y < b.y ? b.y - y : y > b.y + b.size - 1 ? y - (b.y + b.size - 1) : 0;
  return dx > dy ? dx : dy;
}

/**
 * In-place separable 3×3 box blur (edges average only in-bounds samples) of an N×N field.
 * `tmp` must be a different buffer from `field`.
 */
export function blur3(field: Float32Array, tmp: Float32Array, N: number): void {
  const AREA = N * N;
  for (let y = 0; y < N; y++) {
    const row = y * N;
    tmp[row] = (field[row] + field[row + 1]) * 0.5;
    for (let x = 1; x < N - 1; x++) {
      const i = row + x;
      tmp[i] = (field[i - 1] + field[i] + field[i + 1]) * (1 / 3);
    }
    tmp[row + N - 1] = (field[row + N - 2] + field[row + N - 1]) * 0.5;
  }
  for (let x = 0; x < N; x++) {
    field[x] = (tmp[x] + tmp[x + N]) * 0.5;
    const last = (N - 1) * N + x;
    field[last] = (tmp[last] + tmp[last - N]) * 0.5;
  }
  for (let i = N; i < AREA - N; i++) field[i] = (tmp[i - N] + tmp[i] + tmp[i + N]) * (1 / 3);
}

export class FieldSystem {
  /** The frame (MEGACITY §3.1): side and tile count of the world these fields belong to. */
  readonly N: number;
  readonly area: number;
  /** Traffic each tile "feels": its nearest road's congestion (0 when no road in range). */
  readonly localTraffic: Float32Array;
  /** Blurred development density (0..1). */
  readonly density: Float32Array;
  /** Blurred abandonment around each tile (0..1). */
  readonly blight: Float32Array;
  /** Temporary crime from events (decays each tick). */
  readonly crimeBoost: Float32Array;
  /** Temporary city-wide smog intensity from events (0..1). */
  smog = 0;

  /** Road traffic volume against Street capacity (pollution source, §3.8 step 7). */
  readonly volume: Float32Array;
  /** Trips moved onto each highway / skyway component during the last traffic pass. */
  readonly hwPool: Float64Array;
  readonly skyPool: Float64Array;

  private readonly tmpA: Float32Array;
  private readonly tmpB: Float32Array;
  /** Scratch for buildingStats() (no per-tick allocation). */
  private readonly st = blankStats();

  constructor(world: Pick<World, 'N' | 'area'>) {
    const area = world.area;
    this.N = world.N;
    this.area = area;
    this.localTraffic = new Float32Array(area);
    this.density = new Float32Array(area);
    this.blight = new Float32Array(area);
    this.crimeBoost = new Float32Array(area);
    this.volume = new Float32Array(area);
    this.hwPool = new Float64Array(area >> 1);
    this.skyPool = new Float64Array(area >> 1);
    this.tmpA = new Float32Array(area);
    this.tmpB = new Float32Array(area);
  }

  // ── Coverage ──────────────────────────────────────────────────────────────
  /**
   * value = max(existing, 1 - dist/radius) from every powered, online service building.
   * Then security × mods.securityMul (clamped to 1) and transit = max(transit, layers.transitAdd).
   */
  coverage(world: World, g: SimGrid): void {
    const { N, area } = this;
    const f = world.fields;
    const st = this.st;
    for (const e of EFFECTS) f[e].fill(0);
    for (const b of g.buildings) {
      if (b.offline > 0 || !b.powered) continue;
      buildingStats(b, st);
      if (!st.effect || st.radius <= 0) continue;
      const field = f[st.effect];
      const r = st.radius;
      const cx = b.x + b.size / 2;
      const cy = b.y + b.size / 2;
      const xa = Math.max(0, Math.floor(cx - r));
      const xb = Math.min(N - 1, Math.ceil(cx + r));
      const ya = Math.max(0, Math.floor(cy - r));
      const yb = Math.min(N - 1, Math.ceil(cy + r));
      const inv = 1 / r;
      for (let y = ya; y <= yb; y++) {
        const dy = y + 0.5 - cy;
        const row = y * N;
        for (let x = xa; x <= xb; x++) {
          const dx = x + 0.5 - cx;
          const v = 1 - Math.sqrt(dx * dx + dy * dy) * inv;
          if (v > field[row + x]) field[row + x] = v;
        }
      }
    }
    const sm = world.mods.securityMul;
    if (sm !== 1) {
      const sec = f.security;
      for (let i = 0; i < area; i++) {
        const v = sec[i] * sm;
        sec[i] = v > 1 ? 1 : v;
      }
    }
    // Ribbon Rail (live track and station discs) raises transit: max-combined.
    const ta = world.layers.transitAdd;
    const tr = f.transit;
    for (let i = 0; i < area; i++) if (ta[i] > tr[i]) tr[i] = ta[i];
  }

  // ── Traffic ───────────────────────────────────────────────────────────────
  /**
   * Capacity-aware traffic (§3.8). Trips from developed zones land on their claiming road
   * (computeAccess `near`), buildings on their access tile (perimeter for size ≥ 3); docked
   * anchors send SKYWAY.anchorShare to their deck. Highways take a share of every street within
   * ROAD_FLOW.highwayReach road steps of an on-ramp, skyways a share near their active ramps.
   * Utilisation u = trips / kind capacity, smoothed along linked roads, traffic = 1 − e^−u.
   * Each trip source × mods.trafficMul × layers.tripMul[source tile].
   */
  traffic(world: World, g: SimGrid): void {
    const { N, area } = this;
    const f = world.fields;
    const tm = world.mods.trafficMul;
    const tripMul = world.layers.tripMul;
    const st = this.st;
    const out = f.traffic;
    const raw = this.tmpA;
    const tmp = this.tmpB;
    const volume = this.volume;
    const transit = f.transit;
    const { zone, level, abandoned, road, kind, wealth, nearestRoad, roadDist, linkMask, alleyNear } = g;
    const hwPool = this.hwPool;
    const skyPool = this.skyPool;
    raw.fill(0);
    for (let c = 0; c < g.hwCompCount; c++) hwPool[c] = 0;
    for (let c = 0; c < g.skyCompCount; c++) skyPool[c] = 0;

    // 1. Zone trips.
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      const lv = level[i];
      if (lv === 0 || abandoned[i]) continue;
      const r = nearestRoad[i];
      if (r < 0) continue;
      const z = zone[i];
      const cap = z === RES && wealth[i] === 0 && alleyNear[i] ? CAP_AFF[lv] : CAP_T[z * 12 + lv * 3 + wealth[i]];
      raw[r] += cap * T.TRIPS_PER_UNIT[z] * (1 - T.TRANSIT_TRIP_CUT * transit[i]) * tm * tripMul[i];
    }
    // 2. Building trips (already include BUILDING_TRIPS and a Stratablock's internal-life cut).
    const docks = g.dockOf.size > 0;
    for (const b of g.buildings) {
      const trips = buildingStats(b, st).trips;
      if (trips <= 0) continue;
      const c = (b.y + (b.size >> 1)) * N + b.x + (b.size >> 1);
      let t = trips * (1 - T.TRANSIT_TRIP_CUT * transit[c]) * tm * tripMul[c];
      if (docks) {
        const sc = g.dockOf.get(b.id);
        if (sc !== undefined) {
          const up = t * SKY.anchorShare;
          skyPool[sc] += up;
          t -= up;
        }
      }
      const r = g.accessRoad(b);
      if (r >= 0) raw[r] += t;
    }

    // 3. Highway diversion: streets near an on-ramp hand a share of their trips to that highway.
    if (g.hwCompCount > 0) {
      const { hwReach, hwDepth, hwReachList, hwComp, hwList, hwTiles } = g;
      for (let k = 0; k < g.hwReachLen; k++) {
        const j = hwReachList[k];
        const take = raw[j] * HW_DIVERT * (1 - hwDepth[j] * HW_INV);
        raw[j] -= take;
        hwPool[hwReach[j]] += take;
      }
      for (let k = 0; k < g.hwListLen; k++) {
        const h = hwList[k];
        const c = hwComp[h];
        raw[h] += hwPool[c] / hwTiles[c];
      }
    }
    // 4. Sky diversion from what is left, near each active sky ramp.
    if (g.skyReachLen > 0) {
      const { skyReach, skyDepth, skyReachList } = g;
      for (let k = 0; k < g.skyReachLen; k++) {
        const j = skyReachList[k];
        const take = raw[j] * SKY.divert * (1 - skyDepth[j] * SKY_INV);
        raw[j] -= take;
        skyPool[skyReach[j]] += take;
      }
    }

    // 5. Utilisation against each kind's capacity (in street units; ×1 on a street).
    for (let i = 0; i < area; i++) if (road[i]) raw[i] *= STREET_EQ[kind[i]];

    // 6. Spread congestion along linked roads (roadLinks: a highway only joins highways and ramps).
    for (let pass = 0; pass < T.TRAFFIC_SMOOTH_PASSES; pass++) {
      for (let i = 0; i < area; i++) {
        if (!road[i]) {
          tmp[i] = 0;
          continue;
        }
        const m = linkMask[i];
        let s = 0;
        let n = 0;
        if (m & 8) {
          s += raw[i - 1];
          n++;
        }
        if (m & 2) {
          s += raw[i + 1];
          n++;
        }
        if (m & 1) {
          s += raw[i - N];
          n++;
        }
        if (m & 4) {
          s += raw[i + N];
          n++;
        }
        tmp[i] = n > 0 ? raw[i] * 0.5 + (s / n) * 0.5 : raw[i];
      }
      raw.set(tmp);
    }

    // 7. Congestion 1 − e^−u, and volume against a street (the pollution source).
    for (let i = 0; i < area; i++) {
      if (road[i]) {
        const us = raw[i];
        const k = kind[i];
        out[i] = 1 - Math.exp(-us * INV_SCALE);
        volume[i] = VOL_STREET[k] ? out[i] : 1 - Math.exp(-us * VOL_K[k]);
      } else volume[i] = 0;
    }
    const skyT = f.skyTraffic;
    skyT.fill(0);
    if (g.skyCount > 0) {
      const { skyList, skyComp, skyTiles } = g;
      for (let k = 0; k < g.skyCount; k++) {
        const i = skyList[k];
        const c = skyComp[i];
        if (!g.skyLive(c)) continue;
        skyT[i] = 1 - Math.exp(-(skyPool[c] / skyTiles[c]) / SKY.capacity);
      }
    }

    // 8. Non-road tiles: a faint spill for the overlay, and the "felt" traffic for land value.
    const local = this.localTraffic;
    for (let i = 0; i < area; i++) {
      const r = nearestRoad[i];
      const v = r >= 0 ? out[r] : 0;
      local[i] = v;
      if (!road[i]) {
        const d = roadDist[i];
        out[i] = d < T.TRAFFIC_SPILL.length ? v * T.TRAFFIC_SPILL[d] : 0;
      }
    }
  }

  // ── Pollution ─────────────────────────────────────────────────────────────
  /** Sources diffuse, parks filter, smog thickens; the final value × mods.pollutionMul before the clamp. Call after traffic(). */
  pollution(world: World, g: SimGrid): void {
    const { N, area } = this;
    const f = world.fields;
    const st = this.st;
    const out = f.pollution;
    const src = this.tmpA;
    const { zone, level, abandoned, road, kind, wealth } = g;
    src.fill(0);
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      if (abandoned[i]) continue;
      src[i] = POL_T[zone[i] * 12 + level[i] * 3 + wealth[i]];
    }
    for (const b of g.buildings) {
      if (b.offline > 0) continue;
      const p = buildingStats(b, st).pollution;
      if (p <= 0) continue;
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) src[(b.y + dy) * N + b.x + dx] += p;
    }
    // Road source: volume × ROAD_POLLUTION × the kind's multiplier (§3.8; a street is unchanged).
    const volume = this.volume;
    for (let i = 0; i < area; i++) if (road[i]) src[i] += volume[i] * T.ROAD_POLLUTION * KPOL[kind[i]];

    out.set(src);
    for (let p = 0; p < T.POLLUTION_BLUR_PASSES; p++) blur3(out, this.tmpB, this.N);

    const park = f.park;
    const pm = world.mods.pollutionMul;
    const smog = this.smog;
    const smogMul = 1 + 0.8 * smog;
    const smogAdd = 0.05 * smog;
    for (let i = 0; i < area; i++) {
      let v = out[i] * T.POLLUTION_GAIN + src[i] * T.POLLUTION_SOURCE_KEEP;
      v *= 1 - T.PARK_FILTER * park[i];
      if (smog > 0.01 && v > 0.01) v = v * smogMul + smogAdd;
      out[i] = clamp01(v * pm);
    }
  }

  // ── Noise, hub, sea (§3.9) ────────────────────────────────────────────────
  /**
   * noise = max(static highway / skyway noise, every noisy building that is not offline (a
   * Spaceport only once complete): v·(1 − d/(r + 1)) for Chebyshev d ≤ r from its footprint).
   * hub (online, powered Airport): 0 within hubNear, 1 out to hubFar, fading to 0 at hubFade.
   * sea (online, powered Seaport): max(0, 1 − d / SEAPORT.indScoreRadius).
   */
  noise(world: World, g: SimGrid): void {
    const f = world.fields;
    const out = f.noise;
    out.set(g.roadNoise);
    const hub = f.hub;
    const sea = f.sea;
    hub.fill(0);
    sea.fill(0);
    for (const b of g.buildings) {
      const nd = NOISE_OF[b.type];
      if (nd && b.offline <= 0 && (b.buildDays ?? 0) <= 0) this.stamp(b, nd.r, 0, nd.v, out);
      if (b.offline > 0 || !b.powered) continue;
      if (b.type === 'airport') this.stamp(b, HUB.hubFade, 1, 1, hub);
      else if (b.type === 'seaport') this.stamp(b, SEA_R, 2, 1, sea);
    }
  }

  /**
   * Max-combine a falloff into `out` for every tile within Chebyshev r of b's footprint (d = 0
   * inside). mode 0: noise v·(1 − d/(r + 1)); 1: the airport business district; 2: seaport proximity.
   */
  private stamp(b: Building, r: number, mode: 0 | 1 | 2, v: number, out: Float32Array): void {
    const { N } = this;
    const x0 = Math.max(0, b.x - r);
    const x1 = Math.min(N - 1, b.x + b.size - 1 + r);
    const y0 = Math.max(0, b.y - r);
    const y1 = Math.min(N - 1, b.y + b.size - 1 + r);
    const inv = 1 / (r + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = footDist(b, x, y);
        if (d > r) continue;
        const n = mode === 0 ? v * (1 - d * inv) : mode === 1 ? hubAt(d) : seaAt(d);
        const i = y * N + x;
        if (n > out[i]) out[i] = n;
      }
  }

  // ── Wealth score (§4.2) ───────────────────────────────────────────────────
  /**
   * One pass over the zoned tiles (call after land value and crime): the same formula as
   * wealth.wealthScoreAt, so the sim, the inspect meter and the lens agree. Non-zone tiles 0.
   */
  wealthScore(world: World, g: SimGrid): void {
    const f = world.fields;
    const out = f.wealth;
    const { landValue, education, transit, noise, hub, net, sea, crime } = f;
    const zone = g.zone;
    out.fill(0);
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      const z = zone[i];
      let s: number;
      if (z === RES) s = landValue[i] + WS_RES.edu * education[i] + WS_RES.transit * transit[i] + WS_RES.noise * noise[i];
      else if (z === COM)
        s = landValue[i] + WS_COM.edu * education[i] + WS_COM.transit * transit[i] + WS_COM.hub * hub[i] + WS_COM.noise * noise[i];
      else if (z === IND)
        s = WS_IND.base + WS_IND.edu * education[i] + WS_IND.net * net[i] + WS_IND.transit * transit[i] + WS_IND.port * sea[i] + WS_IND.crime * crime[i];
      else continue;
      out[i] = clamp01(s);
    }
  }

  // ── Neighbourhood (density + blight), used by land value and crime ───────
  neighbourhood(g: SimGrid): void {
    const { N, area } = this;
    const dens = this.density;
    const blight = this.blight;
    const { zone, level, abandoned } = g;
    dens.fill(0);
    blight.fill(0);
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      if (abandoned[i]) blight[i] = 1;
      else if (level[i] > 0) dens[i] = (level[i] / 3) * (zone[i] === 3 ? 0.6 : 1);
    }
    blur3(dens, this.tmpB, N);
    blur3(blight, this.tmpB, N);
    blur3(blight, this.tmpB, N);
    for (let i = 0; i < area; i++) {
      const b = blight[i] * 2.5;
      blight[i] = b > 1 ? 1 : b;
    }
  }

  // ── Land value ────────────────────────────────────────────────────────────
  /**
   * Terrain, density, services and nuisances, + mods.landValueAdd + layers.lvAdd[i] before the clamp,
   * + the static road terms (g.roadLv) − NOISE.lv × noise (§3.8).
   */
  landValue(world: World, g: SimGrid): void {
    const { area } = this;
    const f = world.fields;
    const lvAdd = world.mods.landValueAdd;
    const lvLayer = world.layers.lvAdd;
    const out = f.landValue;
    const { park, net, prestige, health, security, pollution, crime } = f;
    const water = g.water;
    const terrain = g.terrainValue;
    const dens = this.density;
    const local = this.localTraffic;
    const roadLv = g.roadLv;
    const noise = f.noise;
    for (let i = 0; i < area; i++) {
      if (water[i]) {
        out[i] = 0;
        continue;
      }
      const v =
        T.LV_BASE +
        terrain[i] +
        dens[i] * T.LV_DENSITY +
        park[i] * T.LV_PARK +
        net[i] * T.LV_NET +
        prestige[i] * T.LV_PRESTIGE +
        health[i] * T.LV_HEALTH +
        security[i] * T.LV_SECURITY -
        pollution[i] * T.LV_POLLUTION -
        crime[i] * T.LV_CRIME -
        local[i] * T.LV_TRAFFIC;
      out[i] = clamp01(v + lvAdd + lvLayer[i] + roadLv[i] - noise[i] * NOISE_LV);
    }
  }

  // ── Crime ─────────────────────────────────────────────────────────────────
  /**
   * `jobless` = size-weighted unemployment (Census.joblessPressure).
   * v = v·town·crimeMul + crimeAdd + layers.crimeAdd[i] + road kinds (g.roadCrime, §3.8), then the
   * empty-land factor, then + event boost.
   */
  crime(world: World, g: SimGrid, jobless: number, population: number): void {
    const { area } = this;
    const f = world.fields;
    const crimeMul = world.mods.crimeMul;
    const crimeAdd = world.mods.crimeAdd;
    const crimeLayer = world.layers.crimeAdd;
    const out = f.crime;
    const { landValue, security } = f;
    const { zone, road, bld, water } = g;
    const dens = this.density;
    const blight = this.blight;
    const boost = this.crimeBoost;
    const roadCrime = g.roadCrime;
    const city = T.CRIME_CITY * Math.min(1, population / T.CRIME_CITY_POP);
    const shared = T.CRIME_BASE + jobless * T.CRIME_UNEMPLOYMENT + city;
    const town = T.CRIME_TOWN_SCALE + (1 - T.CRIME_TOWN_SCALE) * Math.min(1, population / T.CRIME_TOWN_POP);
    for (let i = 0; i < area; i++) {
      if (water[i] && !road[i]) {
        out[i] = 0;
        continue;
      }
      let v =
        shared +
        dens[i] * T.CRIME_DENSITY +
        (1 - landValue[i]) * T.CRIME_POVERTY +
        blight[i] * T.CRIME_ABANDONMENT -
        security[i] * T.SECURITY_SUPPRESS;
      v = v * town * crimeMul + crimeAdd + crimeLayer[i] + roadCrime[i];
      if (!(zone[i] || road[i] || bld[i] >= 0)) v *= T.CRIME_EMPTY_LAND;
      out[i] = clamp01(v + boost[i]);
    }
  }

  /** Per-tick decay of event effects. */
  decay(): void {
    const { area } = this;
    const b = this.crimeBoost;
    if (this.smog > 0) this.smog = this.smog < 0.01 ? 0 : this.smog * T.SMOG_DECAY;
    for (let i = 0; i < area; i++) {
      const v = b[i];
      if (v !== 0) b[i] = v < 0.005 ? 0 : v * T.CRIME_BOOST_DECAY;
    }
  }

  /** Add a temporary crime hotspot (gang surge). */
  addCrimeHotspot(cx: number, cy: number, radius: number, strength: number): void {
    const { N } = this;
    const b = this.crimeBoost;
    for (let y = Math.max(0, cy - radius); y <= Math.min(N - 1, cy + radius); y++)
      for (let x = Math.max(0, cx - radius); x <= Math.min(N - 1, cx + radius); x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        const v = strength * (1 - d / (radius + 1));
        const i = y * N + x;
        if (v > b[i]) b[i] = v;
      }
  }
}
