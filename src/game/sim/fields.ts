// ─────────────────────────────────────────────────────────────────────────────
// Scalar fields: service coverage, traffic, pollution, land value and crime.
// Every pass writes straight into world.fields (Float32Array, 0..1) using a
// handful of scratch buffers owned by FieldSystem, so nothing big is allocated
// per tick.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, ZONES } from '../config';
import { MAP_SIZE, type ServiceEffect } from '../types';
import type { World } from '../world';
import type { SimGrid } from './grid';
import * as Tuning from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
const T = { ...Tuning };
const N = MAP_SIZE;
const AREA = N * N;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const ZONE_POLLUTION: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  ZONES.res.pollution,
  ZONES.com.pollution,
  ZONES.ind.pollution,
];
const ZONE_CAPACITY: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  ZONES.res.capacity,
  ZONES.com.capacity,
  ZONES.ind.capacity,
];

const EFFECTS: readonly ServiceEffect[] = ['security', 'health', 'net', 'park', 'transit', 'prestige'];

/**
 * In-place separable 3×3 box blur (edges average only in-bounds samples).
 * `tmp` must be a different buffer from `field`.
 */
export function blur3(field: Float32Array, tmp: Float32Array): void {
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
  /** Traffic each tile "feels": its nearest road's congestion (0 when no road in range). */
  readonly localTraffic = new Float32Array(AREA);
  /** Blurred development density (0..1). */
  readonly density = new Float32Array(AREA);
  /** Blurred abandonment around each tile (0..1). */
  readonly blight = new Float32Array(AREA);
  /** Temporary crime from events (decays each tick). */
  readonly crimeBoost = new Float32Array(AREA);
  /** Temporary city-wide smog intensity from events (0..1). */
  smog = 0;

  private readonly tmpA = new Float32Array(AREA);
  private readonly tmpB = new Float32Array(AREA);

  // ── Coverage ──────────────────────────────────────────────────────────────
  /** value = max(existing, 1 - dist/radius) from every powered, online service building. */
  coverage(world: World, g: SimGrid): void {
    const f = world.fields;
    for (const e of EFFECTS) f[e].fill(0);
    for (const b of g.buildings) {
      const def = BUILDINGS[b.type];
      if (!def.effect || def.radius <= 0 || b.offline > 0 || !b.powered) continue;
      const field = f[def.effect];
      const r = def.radius;
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
  }

  // ── Traffic ───────────────────────────────────────────────────────────────
  /** Trips from developed zones land on their nearest road, spread along the network, then saturate. */
  traffic(world: World, g: SimGrid): void {
    const f = world.fields;
    const out = f.traffic;
    const raw = this.tmpA;
    const tmp = this.tmpB;
    const transit = f.transit;
    const { zone, level, abandoned, road, nearestRoad, roadDist } = g;
    raw.fill(0);

    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      const lv = level[i];
      if (lv === 0 || abandoned[i]) continue;
      const r = nearestRoad[i];
      if (r < 0) continue;
      const z = zone[i];
      raw[r] += ZONE_CAPACITY[z][lv] * T.TRIPS_PER_UNIT[z] * (1 - T.TRANSIT_TRIP_CUT * transit[i]);
    }
    for (const b of g.buildings) {
      const def = BUILDINGS[b.type];
      const people = def.jobs + def.residents;
      if (people <= 0) continue;
      const c = (b.y + (b.size >> 1)) * N + b.x + (b.size >> 1);
      const r = nearestRoad[c];
      if (r >= 0) raw[r] += people * T.BUILDING_TRIPS * (1 - T.TRANSIT_TRIP_CUT * transit[c]);
    }

    // Spread congestion along connected roads.
    for (let pass = 0; pass < T.TRAFFIC_SMOOTH_PASSES; pass++) {
      for (let i = 0; i < AREA; i++) {
        if (!road[i]) {
          tmp[i] = 0;
          continue;
        }
        const x = i % N;
        let s = 0;
        let n = 0;
        if (x > 0 && road[i - 1]) {
          s += raw[i - 1];
          n++;
        }
        if (x < N - 1 && road[i + 1]) {
          s += raw[i + 1];
          n++;
        }
        if (i >= N && road[i - N]) {
          s += raw[i - N];
          n++;
        }
        if (i < AREA - N && road[i + N]) {
          s += raw[i + N];
          n++;
        }
        tmp[i] = n > 0 ? raw[i] * 0.5 + (s / n) * 0.5 : raw[i];
      }
      raw.set(tmp);
    }

    const inv = 1 / T.TRAFFIC_SCALE;
    for (let i = 0; i < AREA; i++) if (road[i]) out[i] = 1 - Math.exp(-raw[i] * inv);
    // Non-road tiles: a faint spill for the overlay, and the "felt" traffic for land value.
    const local = this.localTraffic;
    for (let i = 0; i < AREA; i++) {
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
  pollution(world: World, g: SimGrid): void {
    const f = world.fields;
    const out = f.pollution;
    const src = this.tmpA;
    const { zone, level, abandoned, road } = g;
    src.fill(0);
    for (let k = 0; k < g.zonedCount; k++) {
      const i = g.zoned[k];
      if (abandoned[i]) continue;
      src[i] = ZONE_POLLUTION[zone[i]][level[i]];
    }
    for (const b of g.buildings) {
      const p = BUILDINGS[b.type].pollution;
      if (p <= 0 || b.offline > 0) continue;
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) src[(b.y + dy) * N + b.x + dx] += p;
    }
    const traffic = f.traffic;
    for (let i = 0; i < AREA; i++) if (road[i]) src[i] += traffic[i] * T.ROAD_POLLUTION;

    out.set(src);
    for (let p = 0; p < T.POLLUTION_BLUR_PASSES; p++) blur3(out, this.tmpB);

    const park = f.park;
    const smog = this.smog;
    const smogMul = 1 + 0.8 * smog;
    const smogAdd = 0.05 * smog;
    for (let i = 0; i < AREA; i++) {
      let v = out[i] * T.POLLUTION_GAIN + src[i] * T.POLLUTION_SOURCE_KEEP;
      v *= 1 - T.PARK_FILTER * park[i];
      if (smog > 0.01 && v > 0.01) v = v * smogMul + smogAdd;
      out[i] = clamp01(v);
    }
  }

  // ── Neighbourhood (density + blight), used by land value and crime ───────
  neighbourhood(g: SimGrid): void {
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
    blur3(dens, this.tmpB);
    blur3(blight, this.tmpB);
    blur3(blight, this.tmpB);
    for (let i = 0; i < AREA; i++) {
      const b = blight[i] * 2.5;
      blight[i] = b > 1 ? 1 : b;
    }
  }

  // ── Land value ────────────────────────────────────────────────────────────
  landValue(world: World, g: SimGrid): void {
    const f = world.fields;
    const out = f.landValue;
    const { park, net, prestige, health, security, pollution, crime } = f;
    const water = g.water;
    const terrain = g.terrainValue;
    const dens = this.density;
    const local = this.localTraffic;
    for (let i = 0; i < AREA; i++) {
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
      out[i] = clamp01(v);
    }
  }

  // ── Crime ─────────────────────────────────────────────────────────────────
  /** `jobless` = size-weighted unemployment (Census.joblessPressure). */
  crime(world: World, g: SimGrid, jobless: number, population: number): void {
    const f = world.fields;
    const out = f.crime;
    const { landValue, security } = f;
    const { zone, road, bld, water } = g;
    const dens = this.density;
    const blight = this.blight;
    const boost = this.crimeBoost;
    const city = T.CRIME_CITY * Math.min(1, population / T.CRIME_CITY_POP);
    const shared = T.CRIME_BASE + jobless * T.CRIME_UNEMPLOYMENT + city;
    const town = T.CRIME_TOWN_SCALE + (1 - T.CRIME_TOWN_SCALE) * Math.min(1, population / T.CRIME_TOWN_POP);
    for (let i = 0; i < AREA; i++) {
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
      v *= town;
      if (!(zone[i] || road[i] || bld[i] >= 0)) v *= T.CRIME_EMPTY_LAND;
      out[i] = clamp01(v + boost[i]);
    }
  }

  /** Per-tick decay of event effects. */
  decay(): void {
    const b = this.crimeBoost;
    if (this.smog > 0) this.smog = this.smog < 0.01 ? 0 : this.smog * T.SMOG_DECAY;
    for (let i = 0; i < AREA; i++) {
      const v = b[i];
      if (v !== 0) b[i] = v < 0.005 ? 0 : v * T.CRIME_BOOST_DECAY;
    }
  }

  /** Add a temporary crime hotspot (gang surge). */
  addCrimeHotspot(cx: number, cy: number, radius: number, strength: number): void {
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
