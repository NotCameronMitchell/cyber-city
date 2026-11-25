// ─────────────────────────────────────────────────────────────────────────────
// Scalar fields: service coverage, traffic, pollution, land value and crime.
// Every pass writes world.fields (Float32Array, 0..1) through a small pool of
// scratch buffers owned by FieldSystem, so nothing big is allocated per tick.
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
//
// Megacity (docs/MEGACITY.md §3.3):
//   O1  every loop walks owned 64-tile chunks (sim/owned.ts) and every stencil
//       (blur3, coverage stamps) treats a locked neighbour as the map edge, so a
//       v3 city in the start slot computes exactly what it did on the 64 map;
//   O3  coverage is cached by the Simulation (it calls coverage only when its
//       key changed);
//   O4  each pass is a resumable unit (a generator yielding its next step's
//       kind, sim/slice.ts) banded by SLICE.bandRows rows; a pass writes a
//       back buffer and copies it into world.fields when it completes, so no
//       reader sees a half-written field;
//   O5  the local passes take a window (recomputeAround): each blur stage runs
//       on a window one ring wider than the next, so the result inside the
//       window equals a whole-map pass;
//   O8  the throttleable passes (pollution, noise, neighbourhood, land value,
//       crime, wealth score) walk the active chunk list; a stencil reads a
//       resting neighbour's last values from the front field.
// District rules: coverage max-combines layers.parkAdd into park, pollution
// adds layers.pollutionAdd to its sources and scales the diffused field by
// 1 − 0.25 × filter; resilience and filter are ordinary coverage effects.
// ─────────────────────────────────────────────────────────────────────────────

import { blankStats, buildingStats } from '../buildingStats';
import { AIRPORT, BUILDINGS, NOISE, ROAD_FLOW, SEAPORT, SKYWAY, SLICE, WEALTH } from '../config';
import { ZoneType, type Building, type ServiceEffect } from '../types';
import type { World } from '../world';
import { KIND_CAPACITY, KIND_POLLUTION, type SimGrid } from './grid';
import { C_D, C_DA, C_L, C_LA, C_R, C_RA, C_U, C_UA, type ChunkList, type OwnedLayout } from './owned';
import { K, drain, type Unit } from './slice';
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
const BAND = SLICE.bandRows;
const FL = C_L;
const FR = C_R;
const FU = C_U;
const FD = C_D;
const FLA = C_LA;
const FRA = C_RA;
const FUA = C_UA;
const FDA = C_DA;

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
/** Pollution kept after the diffused field meets full filter coverage (MEGACITY §3.3): × (1 − FILTER_CUT × filter). */
const FILTER_CUT = 0.25;
/** Noise def per building type (§3.9), undefined for quiet ones. */
const NOISE_OF: Record<string, { v: number; r: number } | undefined> = {};
for (const def of Object.values(BUILDINGS)) NOISE_OF[def.type] = def.noise;

/** Airport business district by Chebyshev distance to the footprint (§3.9). */
const hubAt = (d: number): number =>
  d < HUB.hubNear ? 0 : d <= HUB.hubFar ? 1 : d < HUB.hubFade ? (HUB.hubFade - d) / (HUB.hubFade - HUB.hubFar) : 0;
/** Seaport proximity (§3.9). */
const seaAt = (d: number): number => (d < SEA_R ? 1 - d / SEA_R : 0);

/** Every coverage effect (MEGACITY §3.3 adds resilience and filter). */
export const EFFECTS: readonly ServiceEffect[] = [
  'security',
  'health',
  'net',
  'park',
  'transit',
  'prestige',
  'education',
  'resilience',
  'filter',
];
const EFFECT_INDEX: Record<string, number> = {};
EFFECTS.forEach((e, k) => (EFFECT_INDEX[e] = k));
/** Buildings stamped per coverage step. */
const STAMP_CHUNK = 48;

/** Chebyshev distance from (x, y) to the footprint of b (0 inside). */
function footDist(b: Building, x: number, y: number): number {
  const dx = x < b.x ? b.x - x : x > b.x + b.size - 1 ? x - (b.x + b.size - 1) : 0;
  const dy = y < b.y ? b.y - y : y > b.y + b.size - 1 ? y - (b.y + b.size - 1) : 0;
  return dx > dy ? dx : dy;
}

/**
 * In-place separable 3×3 box blur (edges average only in-bounds samples) of an N×N field with no locked land.
 * `tmp` must be a different buffer from `field`. (The sim's own passes use the owned-chunk blur below.)
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

/** A tile window, inclusive (recomputeAround); the passes clip it to the map. */
export interface Win {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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

  /**
   * The owned frame (shared with the Simulation; a standalone FieldSystem owns one) and the chunk list the
   * throttleable passes walk (all owned chunks, or the running ones while districts sleep, O8).
   */
  layout: OwnedLayout | null = null;
  active: ChunkList | null = null;

  /** Scratch pool: traffic raw / smoothing, pollution sources / work / blur tmp, and back buffers. */
  private readonly tmpA: Float32Array;
  private readonly tmpB: Float32Array;
  private readonly p0: Float32Array;
  private readonly p1: Float32Array;
  private readonly p2: Float32Array;
  /** Scratch for buildingStats() (no per-tick allocation). */
  private readonly st = blankStats();
  /** Coverage stamps by effect: building index lists (rebuilt per coverage pass). */
  private readonly covList: Building[][] = EFFECTS.map(() => []);
  private readonly covRadius: number[][] = EFFECTS.map(() => []);

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
    this.p0 = new Float32Array(area);
    this.p1 = new Float32Array(area);
    this.p2 = new Float32Array(area);
  }

  // ── Frame helpers ─────────────────────────────────────────────────────────

  /** The owned layout of `g` (the Simulation binds it; a standalone grid's own otherwise). */
  private lay(g: SimGrid): OwnedLayout {
    return this.layout ?? g.layout;
  }
  private list(g: SimGrid, throttled: boolean): ChunkList {
    return throttled && this.active ? this.active : this.lay(g).all;
  }
  /** The rows and columns a pass covers: the window clipped to the map, or the owned box. */
  private span(g: SimGrid, win: Win | null, grow = 0): Win {
    const L = this.lay(g);
    const N = this.N;
    if (!win) return { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 };
    return {
      x0: Math.max(0, win.x0 - grow),
      y0: Math.max(0, win.y0 - grow),
      x1: Math.min(N - 1, win.x1 + grow),
      y1: Math.min(N - 1, win.y1 + grow),
    };
  }

  /** Copy `src` into `dst` on the chunks of `list` inside the rows / columns of `w`. */
  private copyRows(src: Float32Array, dst: Float32Array, list: ChunkList, w: Win): void {
    const N = this.N;
    const { ck, rowAt } = list;
    if (w.y1 < w.y0) return;
    const full = w.x0 === 0 && w.x1 === N - 1;
    for (let y = w.y0; y <= w.y1; y++) {
      const base = y * N;
      for (let c = rowAt[y]; c < rowAt[y + 1]; c += 3) {
        let a = ck[c];
        let b = ck[c + 1];
        if (!full) {
          if (a < base + w.x0) a = base + w.x0;
          if (b > base + w.x1 + 1) b = base + w.x1 + 1;
          if (a >= b) continue;
        }
        dst.set(src.subarray(a, b), a);
      }
    }
  }

  /**
   * Horizontal half of the owned-chunk 3×3 box blur on rows y0..y1 and columns x0..x1: tmp ← mean of src over the
   * in-bounds horizontal neighbours, where a locked neighbour is out of bounds (the map edge) and a resting one
   * (O8) is read from `fb`. A window clip inside a chunk reads src beyond it (the caller keeps it valid there).
   */
  private blurH(src: Float32Array, tmp: Float32Array, fb: Float32Array, list: ChunkList, w: Win): void {
    const N = this.N;
    const { ck, rowAt } = list;
    for (let y = w.y0; y <= w.y1; y++) {
      const base = y * N;
      const lo = base + w.x0;
      const hi = base + w.x1 + 1;
      for (let c = rowAt[y]; c < rowAt[y + 1]; c += 3) {
        let a = ck[c];
        let b = ck[c + 1];
        const f = ck[c + 2];
        // left / right: 0 = out of bounds, 1 = src, 2 = fb (resting neighbour)
        let left = f & FL ? (f & FLA ? 1 : 2) : 0;
        let right = f & FR ? (f & FRA ? 1 : 2) : 0;
        if (a < lo) {
          a = lo;
          left = 1;
        }
        if (b > hi) {
          b = hi;
          right = 1;
        }
        if (a >= b) continue;
        const l = b - 1;
        if (a === l) {
          // One column of a clipped window.
          const lv = left === 1 ? src[a - 1] : left === 2 ? fb[a - 1] : 0;
          const rv = right === 1 ? src[a + 1] : right === 2 ? fb[a + 1] : 0;
          const n = 1 + (left ? 1 : 0) + (right ? 1 : 0);
          tmp[a] = n === 3 ? (lv + src[a] + rv) * (1 / 3) : n === 2 ? (left ? lv + src[a] : src[a] + rv) * 0.5 : src[a];
          continue;
        }
        tmp[a] = left === 0 ? (src[a] + src[a + 1]) * 0.5 : ((left === 1 ? src[a - 1] : fb[a - 1]) + src[a] + src[a + 1]) * (1 / 3);
        for (let i = a + 1; i < l; i++) tmp[i] = (src[i - 1] + src[i] + src[i + 1]) * (1 / 3);
        tmp[l] = right === 0 ? (src[l - 1] + src[l]) * 0.5 : (src[l - 1] + src[l] + (right === 1 ? src[l + 1] : fb[l + 1])) * (1 / 3);
      }
    }
  }

  /** Vertical half: dst ← mean of tmp over the in-bounds vertical neighbours (a resting one read from `fb`). */
  private blurV(tmp: Float32Array, dst: Float32Array, fb: Float32Array, list: ChunkList, w: Win): void {
    const N = this.N;
    const { ck, rowAt } = list;
    for (let y = w.y0; y <= w.y1; y++) {
      const base = y * N;
      const lo = base + w.x0;
      const hi = base + w.x1 + 1;
      for (let c = rowAt[y]; c < rowAt[y + 1]; c += 3) {
        let a = ck[c];
        let b = ck[c + 1];
        const f = ck[c + 2];
        if (a < lo) a = lo;
        if (b > hi) b = hi;
        if (a >= b) continue;
        const up = f & FU ? (f & FUA ? tmp : fb) : null;
        const dn = f & FD ? (f & FDA ? tmp : fb) : null;
        if (up && dn) for (let i = a; i < b; i++) dst[i] = (up[i - N] + tmp[i] + dn[i + N]) * (1 / 3);
        else if (dn) for (let i = a; i < b; i++) dst[i] = (tmp[i] + dn[i + N]) * 0.5;
        else if (up) for (let i = a; i < b; i++) dst[i] = (tmp[i] + up[i - N]) * 0.5;
        else for (let i = a; i < b; i++) dst[i] = tmp[i];
      }
    }
  }

  /** One full blur of `buf` in place, banded: the horizontal sweep over every band, then the vertical sweep. */
  private *blurPass(buf: Float32Array, fb: Float32Array, list: ChunkList, w: Win, banded: boolean): Unit {
    const tmp = this.tmpB;
    const step = banded ? BAND : w.y1 - w.y0 + 1;
    // H needs one row beyond the window for V (clipped to the map; locked rows have no chunks).
    const hy0 = Math.max(0, w.y0 - 1);
    const hy1 = Math.min(this.N - 1, w.y1 + 1);
    for (let y = hy0; y <= hy1; y += step) {
      yield K.PolBlur;
      this.blurH(buf, tmp, fb, list, {
        x0: w.x0,
        x1: w.x1,
        y0: y,
        y1: Math.min(hy1, y + step - 1),
      });
    }
    for (let y = w.y0; y <= w.y1; y += step) {
      yield K.PolBlur;
      this.blurV(tmp, buf, fb, list, {
        x0: w.x0,
        x1: w.x1,
        y0: y,
        y1: Math.min(w.y1, y + step - 1),
      });
    }
  }

  // ── Coverage ──────────────────────────────────────────────────────────────
  /**
   * value = max(existing, 1 - dist/radius) from every powered, online service building, per effect.
   * Then security × mods.securityMul (clamped to 1), transit = max(transit, layers.transitAdd) and
   * park = max(park, layers.parkAdd) (the district part, MEGACITY §3.3). Whole pass (tests, recomputeAll).
   */
  coverage(world: World, g: SimGrid): void {
    drain(this.coverageUnit(world, g, false));
  }

  /** Coverage as a resumable unit: per effect, stamps in building chunks into a back buffer, then the copy. */
  *coverageUnit(world: World, g: SimGrid, banded: boolean): Unit {
    const st = this.st;
    const lists = this.covList;
    const radii = this.covRadius;
    for (let k = 0; k < EFFECTS.length; k++) {
      lists[k].length = 0;
      radii[k].length = 0;
    }
    for (const b of g.buildings) {
      if (b.offline > 0 || !b.powered) continue;
      buildingStats(b, st);
      if (!st.effect || st.radius <= 0) continue;
      const k = EFFECT_INDEX[st.effect];
      if (k === undefined) continue;
      lists[k].push(b);
      radii[k].push(st.radius);
    }
    const L = this.lay(g);
    const all = L.all;
    const box: Win = { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 };
    const f = world.fields;
    const back = this.p0;
    for (let k = 0; k < EFFECTS.length; k++) {
      const e = EFFECTS[k];
      const list = lists[k];
      yield K.CovRows;
      this.zeroRows(back, all, box);
      for (let j = 0; j < list.length; j += STAMP_CHUNK) {
        if (banded) yield K.CovStamp;
        this.stampCoverage(back, list, radii[k], j, Math.min(list.length, j + STAMP_CHUNK), box);
      }
      yield K.CovRows;
      this.finishCoverage(world, e, back, all, box);
      this.copyRows(back, f[e] as Float32Array, all, box);
    }
  }

  private zeroRows(buf: Float32Array, list: ChunkList, w: Win): void {
    const N = this.N;
    const { ck, rowAt } = list;
    for (let y = w.y0; y <= w.y1; y++) {
      const base = y * N;
      for (let c = rowAt[y]; c < rowAt[y + 1]; c += 3) {
        let a = ck[c];
        let b = ck[c + 1];
        if (a < base + w.x0) a = base + w.x0;
        if (b > base + w.x1 + 1) b = base + w.x1 + 1;
        if (a < b) buf.fill(0, a, b);
      }
    }
  }

  private stampCoverage(out: Float32Array, list: Building[], radii: number[], j0: number, j1: number, box: Win): void {
    const N = this.N;
    for (let j = j0; j < j1; j++) {
      const b = list[j];
      const r = radii[j];
      const cx = b.x + b.size / 2;
      const cy = b.y + b.size / 2;
      // Clipped to the owned box (stamps into locked land inside it are never copied out).
      const xa = Math.max(box.x0, Math.floor(cx - r));
      const xb = Math.min(box.x1, N - 1, Math.ceil(cx + r));
      const ya = Math.max(box.y0, Math.floor(cy - r));
      const yb = Math.min(box.y1, N - 1, Math.ceil(cy + r));
      const inv = 1 / r;
      for (let y = ya; y <= yb; y++) {
        const dy = y + 0.5 - cy;
        const row = y * N;
        for (let x = xa; x <= xb; x++) {
          const dx = x + 0.5 - cx;
          const v = 1 - Math.sqrt(dx * dx + dy * dy) * inv;
          if (v > out[row + x]) out[row + x] = v;
        }
      }
    }
  }

  private finishCoverage(world: World, e: ServiceEffect, buf: Float32Array, list: ChunkList, w: Win): void {
    const N = this.N;
    const { ck, rowAt } = list;
    let add: Float32Array | null = null;
    let mul = 1;
    if (e === 'security') mul = world.mods.securityMul;
    else if (e === 'transit') add = world.layers.transitAdd;
    else if (e === 'park') add = world.layers.parkAdd ?? null;
    if (mul === 1 && !add) return;
    for (let y = w.y0; y <= w.y1; y++) {
      for (let c = rowAt[y]; c < rowAt[y + 1]; c += 3) {
        const a = ck[c];
        const b = ck[c + 1];
        if (mul !== 1)
          for (let i = a; i < b; i++) {
            const v = buf[i] * mul;
            buf[i] = v > 1 ? 1 : v;
          }
        if (add) for (let i = a; i < b; i++) if (add[i] > buf[i]) buf[i] = add[i];
      }
    }
    void N;
  }

  // ── Traffic ───────────────────────────────────────────────────────────────
  /**
   * Capacity-aware traffic (§3.8). Trips from developed zones land on their claiming road
   * (computeAccess `near`), buildings on their access tile (perimeter for size ≥ 3); docked
   * anchors send SKYWAY.anchorShare to their deck. Highways take a share of every street within
   * ROAD_FLOW.highwayReach road steps of an on-ramp, skyways a share near their active ramps.
   * Utilisation u = trips / kind capacity, smoothed along linked roads, traffic = 1 − e^−u.
   * Each trip source × mods.trafficMul × layers.tripMul[source tile]. Whole pass.
   */
  traffic(world: World, g: SimGrid): void {
    drain(this.trafficUnit(world, g, false));
  }

  /** Traffic as a resumable unit (network-wide, never throttled). */
  *trafficUnit(world: World, g: SimGrid, banded: boolean): Unit {
    const { N } = this;
    const L = this.lay(g);
    const all = L.all;
    const box: Win = { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 };
    const step = banded ? BAND : N;
    const f = world.fields;
    const tm = world.mods.trafficMul;
    const tripMul = world.layers.tripMul;
    const st = this.st;
    const raw = this.tmpA;
    const tmp = this.tmpB;
    const out = this.p0;
    const skyBack = this.p1;
    const transit = f.transit;
    const { zone, level, abandoned, wealth, nearestRoad, alleyNear } = g;
    const hwPool = this.hwPool;
    const skyPool = this.skyPool;

    yield K.TrafficRows;
    this.zeroRows(raw, all, box);
    for (let c = 0; c < g.hwCompCount; c++) hwPool[c] = 0;
    for (let c = 0; c < g.skyCompCount; c++) skyPool[c] = 0;

    // 1. Zone trips (the zoned list in bands of ~step × N entries).
    const zc = g.zonedCount;
    const zl = g.zoned;
    const zstep = banded ? step * N : zc + 1;
    for (let k0 = 0; k0 < zc; k0 += zstep) {
      yield K.TrafficZone;
      const k1 = Math.min(zc, k0 + zstep);
      for (let k = k0; k < k1; k++) {
        const i = zl[k];
        const lv = level[i];
        if (lv === 0 || abandoned[i]) continue;
        const r = nearestRoad[i];
        if (r < 0) continue;
        const z = zone[i];
        const cap = z === RES && wealth[i] === 0 && alleyNear[i] ? CAP_AFF[lv] : CAP_T[z * 12 + lv * 3 + wealth[i]];
        raw[r] += cap * T.TRIPS_PER_UNIT[z] * (1 - T.TRANSIT_TRIP_CUT * transit[i]) * tm * tripMul[i];
      }
    }
    // 2. Building trips (already include BUILDING_TRIPS and a Stratablock's internal-life cut), then diversions.
    yield K.TrafficBld;
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
    for (let y = box.y0; y <= box.y1; y += step) {
      yield K.TrafficRows;
      this.trafficUtil(g, raw, all, {
        x0: box.x0,
        x1: box.x1,
        y0: y,
        y1: Math.min(box.y1, y + step - 1),
      });
    }
    // 6. Spread congestion along linked roads (roadLinks: a highway only joins highways and ramps). Passes
    //    alternate raw → tmp → raw…; the result ends in `raw` either way.
    let from = raw;
    let to = tmp;
    for (let pass = 0; pass < T.TRAFFIC_SMOOTH_PASSES; pass++) {
      for (let y = box.y0; y <= box.y1; y += step) {
        yield K.TrafficSmooth;
        this.trafficSmooth(g, from, to, all, {
          x0: box.x0,
          x1: box.x1,
          y0: y,
          y1: Math.min(box.y1, y + step - 1),
        });
      }
      const t = from;
      from = to;
      to = t;
    }
    const u = from;
    // 7. Congestion 1 − e^−u, and volume against a street (the pollution source).
    for (let y = box.y0; y <= box.y1; y += step) {
      yield K.TrafficOut;
      this.trafficCongestion(g, u, out, all, {
        x0: box.x0,
        x1: box.x1,
        y0: y,
        y1: Math.min(box.y1, y + step - 1),
      });
    }
    yield K.TrafficBld;
    this.zeroRows(skyBack, all, box);
    if (g.skyCount > 0) {
      const { skyList, skyComp, skyTiles } = g;
      for (let k = 0; k < g.skyCount; k++) {
        const i = skyList[k];
        const c = skyComp[i];
        if (!g.skyLive(c)) continue;
        skyBack[i] = 1 - Math.exp(-(skyPool[c] / skyTiles[c]) / SKY.capacity);
      }
    }
    // 8. Non-road tiles: a faint spill for the overlay, and the "felt" traffic for land value.
    for (let y = box.y0; y <= box.y1; y += step) {
      yield K.TrafficOut;
      this.trafficSpill(g, out, all, {
        x0: box.x0,
        x1: box.x1,
        y0: y,
        y1: Math.min(box.y1, y + step - 1),
      });
    }
    yield K.Copy;
    this.copyRows(out, f.traffic, all, box);
    this.copyRows(skyBack, f.skyTraffic, all, box);
  }

  private trafficUtil(g: SimGrid, raw: Float32Array, list: ChunkList, w: Win): void {
    const { road, kind } = g;
    const { ck, rowAt } = list;
    for (let c = rowAt[w.y0]; c < rowAt[w.y1 + 1]; c += 3)
      for (let i = ck[c], b = ck[c + 1]; i < b; i++) if (road[i]) raw[i] *= STREET_EQ[kind[i]];
  }

  private trafficSmooth(g: SimGrid, raw: Float32Array, tmp: Float32Array, list: ChunkList, w: Win): void {
    const N = this.N;
    const { road, linkMask } = g;
    const { ck, rowAt } = list;
    for (let c = rowAt[w.y0]; c < rowAt[w.y1 + 1]; c += 3)
      for (let i = ck[c], b = ck[c + 1]; i < b; i++) {
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
  }

  private trafficCongestion(g: SimGrid, u: Float32Array, out: Float32Array, list: ChunkList, w: Win): void {
    const { road, kind } = g;
    const volume = this.volume;
    const { ck, rowAt } = list;
    for (let c = rowAt[w.y0]; c < rowAt[w.y1 + 1]; c += 3)
      for (let i = ck[c], b = ck[c + 1]; i < b; i++) {
        if (road[i]) {
          const us = u[i];
          const k = kind[i];
          out[i] = 1 - Math.exp(-us * INV_SCALE);
          volume[i] = VOL_STREET[k] ? out[i] : 1 - Math.exp(-us * VOL_K[k]);
        } else volume[i] = 0;
      }
  }

  private trafficSpill(g: SimGrid, out: Float32Array, list: ChunkList, w: Win): void {
    const { road, nearestRoad, roadDist } = g;
    const local = this.localTraffic;
    const spill = T.TRAFFIC_SPILL;
    const { ck, rowAt } = list;
    for (let c = rowAt[w.y0]; c < rowAt[w.y1 + 1]; c += 3)
      for (let i = ck[c], b = ck[c + 1]; i < b; i++) {
        const r = nearestRoad[i];
        const v = r >= 0 ? out[r] : 0;
        local[i] = v;
        if (!road[i]) {
          const d = roadDist[i];
          out[i] = d < spill.length ? v * spill[d] : 0;
        }
      }
  }

  // ── Pollution ─────────────────────────────────────────────────────────────
  /**
   * Sources (+ layers.pollutionAdd) diffuse, parks and Reclaim Works filter, smog thickens; the final value ×
   * mods.pollutionMul before the clamp. Call after traffic(). Whole pass.
   */
  pollution(world: World, g: SimGrid): void {
    drain(this.pollutionUnit(world, g, false, null));
  }

  /**
   * Pollution as a resumable unit (throttleable). With a window (recomputeAround) the sources run on the window
   * ⊕ 3, each blur on a window one ring smaller, so the window itself equals a whole-map pass.
   */
  *pollutionUnit(world: World, g: SimGrid, banded: boolean, win: Win | null): Unit {
    const { N } = this;
    const f = world.fields;
    const list = win ? this.lay(g).all : this.list(g, true);
    const passes = T.POLLUTION_BLUR_PASSES;
    const outer = this.span(g, win, win ? passes : 0);
    const inner = this.span(g, win, 0);
    const step = banded ? BAND : N;
    const src = this.p1;
    const work = this.p2;
    const back = this.tmpA;
    const front = f.pollution;
    const { zone, level, abandoned, wealth } = g;
    // 1. Zone sources (assigned), building sources (added), road sources and the district layer (added).
    for (let y = outer.y0; y <= outer.y1; y += step) {
      yield K.PolZone;
      const w: Win = {
        x0: outer.x0,
        x1: outer.x1,
        y0: y,
        y1: Math.min(outer.y1, y + step - 1),
      };
      this.eachChunk(list, w, (a, b) => {
        for (let i = a; i < b; i++) src[i] = zone[i] !== 0 && !abandoned[i] ? POL_T[zone[i] * 12 + level[i] * 3 + wealth[i]] : 0;
      });
    }
    yield K.PolBld;
    const st = this.st;
    for (const b of g.buildings) {
      if (b.offline > 0) continue;
      const p = buildingStats(b, st).pollution;
      if (p <= 0) continue;
      for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) src[(b.y + dy) * N + b.x + dx] += p;
    }
    const volume = this.volume;
    const { road, kind } = g;
    const add = world.layers.pollutionAdd;
    for (let y = outer.y0; y <= outer.y1; y += step) {
      yield K.PolSrc;
      const w: Win = {
        x0: outer.x0,
        x1: outer.x1,
        y0: y,
        y1: Math.min(outer.y1, y + step - 1),
      };
      this.eachChunk(list, w, (a, b) => {
        // Road source: volume × ROAD_POLLUTION × the kind's multiplier (§3.8; a street is unchanged).
        for (let i = a; i < b; i++) if (road[i]) src[i] += volume[i] * T.ROAD_POLLUTION * KPOL[kind[i]];
        if (add) for (let i = a; i < b; i++) if (add[i] !== 0) src[i] += add[i];
        work.set(src.subarray(a, b), a);
      });
    }
    // 2. Blur passes, each on a window one ring smaller (whole box without a window).
    for (let p = 0; p < passes; p++) {
      const w = win ? this.span(g, win, passes - 1 - p) : inner;
      yield* this.blurPass(work, front, list, w, banded);
    }
    // 3. Gain, source keep, parks and filters, smog, pollutionMul.
    const park = f.park;
    const filter = f.filter;
    const pm = world.mods.pollutionMul;
    const smog = this.smog;
    const smogMul = 1 + 0.8 * smog;
    const smogAdd = 0.05 * smog;
    for (let y = inner.y0; y <= inner.y1; y += step) {
      yield K.PolOut;
      const w: Win = {
        x0: inner.x0,
        x1: inner.x1,
        y0: y,
        y1: Math.min(inner.y1, y + step - 1),
      };
      this.eachChunk(list, w, (a, b) => {
        for (let i = a; i < b; i++) {
          let v = work[i] * T.POLLUTION_GAIN + src[i] * T.POLLUTION_SOURCE_KEEP;
          v *= 1 - T.PARK_FILTER * park[i];
          const fl = filter[i];
          if (fl > 0) v *= 1 - FILTER_CUT * fl;
          if (smog > 0.01 && v > 0.01) v = v * smogMul + smogAdd;
          back[i] = clamp01(v * pm);
        }
      });
    }
    yield K.Copy;
    this.copyRows(back, front, list, inner);
  }

  /** Call fn(a, b) for every chunk of `list` in the rows / columns of `w` (clipped). */
  private eachChunk(list: ChunkList, w: Win, fn: (a: number, b: number) => void): void {
    const N = this.N;
    const { ck, rowAt } = list;
    if (w.y1 < w.y0) return;
    const full = w.x0 === 0 && w.x1 === N - 1;
    for (let y = w.y0; y <= w.y1; y++) {
      const base = y * N;
      for (let c = rowAt[y]; c < rowAt[y + 1]; c += 3) {
        let a = ck[c];
        let b = ck[c + 1];
        if (!full) {
          if (a < base + w.x0) a = base + w.x0;
          if (b > base + w.x1 + 1) b = base + w.x1 + 1;
          if (a >= b) continue;
        }
        fn(a, b);
      }
    }
  }

  // ── Noise, hub, sea (§3.9) ────────────────────────────────────────────────
  /**
   * noise = max(static highway / skyway noise, every noisy building that is not offline (a
   * Spaceport only once complete): v·(1 − d/(r + 1)) for Chebyshev d ≤ r from its footprint).
   * hub (online, powered Airport): 0 within hubNear, 1 out to hubFar, fading to 0 at hubFade.
   * sea (online, powered Seaport): max(0, 1 − d / SEAPORT.indScoreRadius). Whole pass.
   */
  noise(world: World, g: SimGrid): void {
    drain(this.noiseUnit(world, g, false, null));
  }

  /** Noise, hub and sea as a resumable unit (throttleable). */
  *noiseUnit(world: World, g: SimGrid, banded: boolean, win: Win | null): Unit {
    const f = world.fields;
    const list = win ? this.lay(g).all : this.list(g, true);
    const w0 = this.span(g, win, 0);
    const out = this.p0;
    const hub = this.p1;
    const sea = this.p2;
    const rn = g.roadNoise;
    const step = banded ? BAND : this.N;
    for (let y = w0.y0; y <= w0.y1; y += step) {
      yield K.NoiseRows;
      const w: Win = {
        x0: w0.x0,
        x1: w0.x1,
        y0: y,
        y1: Math.min(w0.y1, y + step - 1),
      };
      this.eachChunk(list, w, (a, b) => {
        out.set(rn.subarray(a, b), a);
        hub.fill(0, a, b);
        sea.fill(0, a, b);
      });
    }
    yield K.NoiseStamp;
    for (const b of g.buildings) {
      const nd = NOISE_OF[b.type];
      if (nd && b.offline <= 0 && (b.buildDays ?? 0) <= 0) this.stamp(b, nd.r, 0, nd.v, out, w0);
      if (b.offline > 0 || !b.powered) continue;
      if (b.type === 'airport') this.stamp(b, HUB.hubFade, 1, 1, hub, w0);
      else if (b.type === 'seaport') this.stamp(b, SEA_R, 2, 1, sea, w0);
    }
    yield K.Copy;
    this.copyRows(out, f.noise, list, w0);
    this.copyRows(hub, f.hub, list, w0);
    this.copyRows(sea, f.sea, list, w0);
  }

  /**
   * Max-combine a falloff into `out` for every tile within Chebyshev r of b's footprint (d = 0
   * inside), clipped to `clip`. mode 0: noise v·(1 − d/(r + 1)); 1: the airport business district; 2: seaport proximity.
   */
  private stamp(b: Building, r: number, mode: 0 | 1 | 2, v: number, out: Float32Array, clip: Win): void {
    const { N } = this;
    const x0 = Math.max(clip.x0, b.x - r);
    const x1 = Math.min(clip.x1, N - 1, b.x + b.size - 1 + r);
    const y0 = Math.max(clip.y0, b.y - r);
    const y1 = Math.min(clip.y1, N - 1, b.y + b.size - 1 + r);
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
   * wealth.wealthScoreAt, so the sim, the inspect meter and the lens agree. Non-zone tiles 0. Whole pass.
   */
  wealthScore(world: World, g: SimGrid): void {
    drain(this.wealthUnit(world, g, false, null));
  }

  /** The wealth score as a resumable unit (throttleable). */
  *wealthUnit(world: World, g: SimGrid, banded: boolean, win: Win | null): Unit {
    const f = world.fields;
    const list = win ? this.lay(g).all : this.list(g, true);
    const w0 = this.span(g, win, 0);
    const back = this.p0;
    const { landValue, education, transit, noise, hub, net, sea, crime } = f;
    const zone = g.zone;
    const step = banded ? BAND : this.N;
    for (let y = w0.y0; y <= w0.y1; y += step) {
      yield K.WealthZone;
      const w: Win = {
        x0: w0.x0,
        x1: w0.x1,
        y0: y,
        y1: Math.min(w0.y1, y + step - 1),
      };
      this.eachChunk(list, w, (a, b) => {
        for (let i = a; i < b; i++) {
          const z = zone[i];
          let s: number;
          if (z === RES) s = landValue[i] + WS_RES.edu * education[i] + WS_RES.transit * transit[i] + WS_RES.noise * noise[i];
          else if (z === COM)
            s = landValue[i] + WS_COM.edu * education[i] + WS_COM.transit * transit[i] + WS_COM.hub * hub[i] + WS_COM.noise * noise[i];
          else if (z === IND)
            s =
              WS_IND.base +
              WS_IND.edu * education[i] +
              WS_IND.net * net[i] +
              WS_IND.transit * transit[i] +
              WS_IND.port * sea[i] +
              WS_IND.crime * crime[i];
          else {
            back[i] = 0;
            continue;
          }
          back[i] = clamp01(s);
        }
      });
    }
    yield K.Copy;
    this.copyRows(back, f.wealth, list, w0);
  }

  // ── Neighbourhood (density + blight), used by land value and crime ───────
  /** Whole pass. */
  neighbourhood(g: SimGrid): void {
    drain(this.neighbourhoodUnit(g, false, null));
  }

  /**
   * Density (one blur) and blight (two blurs, × 2.5, clamped) as a resumable unit (throttleable); in place, so a
   * resting slot keeps its last values for its neighbours' stencils. With a window: sources on window ⊕ 2.
   * Ruins (MEGACITY §3.7, ground Rubble) blight at RUINS.blightWeight (`g.blightW`).
   */
  *neighbourhoodUnit(g: SimGrid, banded: boolean, win: Win | null): Unit {
    const N = this.N;
    const list = win ? this.lay(g).all : this.list(g, true);
    // Whole map: in place. A window works in scratch and copies only the window back, so nothing outside it changes.
    const dens = win ? this.p1 : this.density;
    const blight = win ? this.p2 : this.blight;
    const { zone, level, abandoned } = g;
    const bw = g.blightW;
    const step = banded ? BAND : N;
    const outer = this.span(g, win, win ? 2 : 0);
    for (let y = outer.y0; y <= outer.y1; y += step) {
      yield K.NbhZone;
      const w: Win = {
        x0: outer.x0,
        x1: outer.x1,
        y0: y,
        y1: Math.min(outer.y1, y + step - 1),
      };
      this.eachChunk(list, w, (a, b) => {
        for (let i = a; i < b; i++) {
          const z = zone[i];
          if (z === 0) {
            dens[i] = 0;
            blight[i] = 0;
          } else if (abandoned[i]) {
            dens[i] = 0;
            blight[i] = bw[i];
          } else {
            dens[i] = level[i] > 0 ? (level[i] / 3) * (z === 3 ? 0.6 : 1) : 0;
            blight[i] = 0;
          }
        }
      });
    }
    const w0 = win ? this.span(g, win, 0) : outer;
    const w1 = win ? this.span(g, win, 1) : outer;
    yield* this.blurPass(dens, this.density, list, w0, banded);
    yield* this.blurPass(blight, this.blight, list, w1, banded);
    yield* this.blurPass(blight, this.blight, list, w0, banded);
    for (let y = w0.y0; y <= w0.y1; y += step) {
      yield K.NbhRows;
      const w: Win = {
        x0: w0.x0,
        x1: w0.x1,
        y0: y,
        y1: Math.min(w0.y1, y + step - 1),
      };
      this.eachChunk(list, w, (a, b) => {
        for (let i = a; i < b; i++) {
          const v = blight[i] * 2.5;
          blight[i] = v > 1 ? 1 : v;
        }
      });
    }
    if (win) {
      yield K.Copy;
      this.copyRows(dens, this.density, list, w0);
      this.copyRows(blight, this.blight, list, w0);
    }
  }

  // ── Land value ────────────────────────────────────────────────────────────
  /**
   * Terrain, density, services and nuisances, + mods.landValueAdd + layers.lvAdd[i] before the clamp,
   * + the static road terms (g.roadLv) − NOISE.lv × noise (§3.8). Whole pass.
   */
  landValue(world: World, g: SimGrid): void {
    drain(this.landValueUnit(world, g, false, null));
  }

  /** Land value as a resumable unit (throttleable). */
  *landValueUnit(world: World, g: SimGrid, banded: boolean, win: Win | null): Unit {
    const f = world.fields;
    const list = win ? this.lay(g).all : this.list(g, true);
    const w0 = this.span(g, win, 0);
    const back = this.p0;
    const step = banded ? BAND : this.N;
    for (let y = w0.y0; y <= w0.y1; y += step) {
      yield K.LvRows;
      this.lvRows(world, g, back, list, {
        x0: w0.x0,
        x1: w0.x1,
        y0: y,
        y1: Math.min(w0.y1, y + step - 1),
      });
    }
    yield K.Copy;
    this.copyRows(back, f.landValue, list, w0);
  }

  private lvRows(world: World, g: SimGrid, out: Float32Array, list: ChunkList, w: Win): void {
    const f = world.fields;
    const lvAdd = world.mods.landValueAdd;
    const lvLayer = world.layers.lvAdd;
    const { park, net, prestige, health, security, pollution, crime } = f;
    const water = g.water;
    const terrain = g.terrainValue;
    const dens = this.density;
    const local = this.localTraffic;
    const roadLv = g.roadLv;
    const noise = f.noise;
    this.eachChunk(list, w, (a, b) => {
      for (let i = a; i < b; i++) {
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
    });
  }

  // ── Crime ─────────────────────────────────────────────────────────────────
  /**
   * `jobless` = size-weighted unemployment (Census.joblessPressure).
   * v = v·town·crimeMul + crimeAdd + layers.crimeAdd[i] + road kinds (g.roadCrime, §3.8), then the
   * empty-land factor, then + event boost. Whole pass.
   */
  crime(world: World, g: SimGrid, jobless: number, population: number): void {
    drain(this.crimeUnit(world, g, jobless, population, false, null));
  }

  /** Crime as a resumable unit (throttleable). */
  *crimeUnit(world: World, g: SimGrid, jobless: number, population: number, banded: boolean, win: Win | null): Unit {
    const f = world.fields;
    const list = win ? this.lay(g).all : this.list(g, true);
    const w0 = this.span(g, win, 0);
    const back = this.p0;
    const step = banded ? BAND : this.N;
    for (let y = w0.y0; y <= w0.y1; y += step) {
      yield K.CrimeRows;
      this.crimeRows(world, g, jobless, population, back, list, {
        x0: w0.x0,
        x1: w0.x1,
        y0: y,
        y1: Math.min(w0.y1, y + step - 1),
      });
    }
    yield K.Copy;
    this.copyRows(back, f.crime, list, w0);
  }

  private crimeRows(world: World, g: SimGrid, jobless: number, population: number, out: Float32Array, list: ChunkList, w: Win): void {
    const f = world.fields;
    const crimeMul = world.mods.crimeMul;
    const crimeAdd = world.mods.crimeAdd;
    const crimeLayer = world.layers.crimeAdd;
    const { landValue, security } = f;
    const { zone, road, bld, water } = g;
    const dens = this.density;
    const blight = this.blight;
    const boost = this.crimeBoost;
    const roadCrime = g.roadCrime;
    const city = T.CRIME_CITY * Math.min(1, population / T.CRIME_CITY_POP);
    const shared = T.CRIME_BASE + jobless * T.CRIME_UNEMPLOYMENT + city;
    const town = T.CRIME_TOWN_SCALE + (1 - T.CRIME_TOWN_SCALE) * Math.min(1, population / T.CRIME_TOWN_POP);
    this.eachChunk(list, w, (a, b) => {
      for (let i = a; i < b; i++) {
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
    });
  }

  /** Per-tick decay of event effects (owned land; boosts never land elsewhere that is read). */
  decay(g?: SimGrid): void {
    const b = this.crimeBoost;
    if (this.smog > 0) this.smog = this.smog < 0.01 ? 0 : this.smog * T.SMOG_DECAY;
    if (!g) {
      for (let i = 0; i < this.area; i++) {
        const v = b[i];
        if (v !== 0) b[i] = v < 0.005 ? 0 : v * T.CRIME_BOOST_DECAY;
      }
      return;
    }
    const L = this.lay(g);
    this.decayRows(L.all, { x0: L.x0, x1: L.x1, y0: L.y0, y1: L.y1 });
  }

  /** Crime boost decay on rows of `w` (banded by the Simulation). */
  decayRows(list: ChunkList, w: Win): void {
    const b = this.crimeBoost;
    const { ck, rowAt } = list;
    if (w.y1 < w.y0) return;
    for (let c = rowAt[w.y0]; c < rowAt[w.y1 + 1]; c += 3)
      for (let i = ck[c], e = ck[c + 1]; i < e; i++) {
        const v = b[i];
        if (v !== 0) b[i] = v < 0.005 ? 0 : v * T.CRIME_BOOST_DECAY;
      }
  }

  /** Smog decay only (the banded day decays the crime boost by rows). */
  decaySmog(): void {
    if (this.smog > 0) this.smog = this.smog < 0.01 ? 0 : this.smog * T.SMOG_DECAY;
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
