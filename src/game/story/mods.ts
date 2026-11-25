// ─────────────────────────────────────────────────────────────────────────────
// Modifier algebra (docs/STORY.md §10.4–§10.5). Pure: no story imports beyond
// types, so world.ts and the sim can use it without pulling in story logic.
//
//   DEFAULT_MODS   identities (frozen; clone before mutating)
//   combine        fold a ModPatch into a SimMods (add / multiply / min / keyed)
//   clampMods      the final clamps of §10.4
//   composeLayers  merge world.layerParts.{turf,vertical,local} into world.layers
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_TAX } from '../config';
import type { World } from '../world';
import type {
  AdditiveModKey,
  LayerParts,
  ModPatch,
  MultiplicativeModKey,
  SimLayers,
  SimMods,
} from './types';

/** Keys combined by addition (identity 0). */
export const ADDITIVE_MOD_KEYS: readonly AdditiveModKey[] = [
  'demandRes',
  'demandCom',
  'demandInd',
  'crimeAdd',
  'landValueAdd',
  'approvalAdd',
  'traceMonthly',
  'outageChance',
];

/** Keys combined by multiplication (identity 1). */
export const MULTIPLICATIVE_MOD_KEYS: readonly MultiplicativeModKey[] = [
  'crimeMul',
  'turfCrimeMul',
  'pollutionMul',
  'trafficMul',
  'securityMul',
  'taxIncomeMul',
  'taxDemandMul',
  'upkeepMul',
  'buildCostMul',
  'powerSupplyMul',
  'powerDemandMul',
  'growthMul',
  'abandonMul',
  'eventRateMul',
  'cardRateMul',
  'turfSpreadMul',
];

/** Final clamps (§10.4). Exported so tests and hint text agree with the code. */
export const MOD_CLAMPS = {
  demand: 0.5,
  crimeAdd: 0.3,
  landValueAdd: 0.3,
  approvalAdd: 20,
  mulMin: 0.25,
  mulMax: 4,
  taxCapMin: 5,
  taxCapMax: MAX_TAX,
} as const;

function identityMods(): SimMods {
  return {
    demandRes: 0,
    demandCom: 0,
    demandInd: 0,
    crimeAdd: 0,
    landValueAdd: 0,
    approvalAdd: 0,
    traceMonthly: 0,
    outageChance: 0,
    crimeMul: 1,
    turfCrimeMul: 1,
    pollutionMul: 1,
    trafficMul: 1,
    securityMul: 1,
    taxIncomeMul: 1,
    taxDemandMul: 1,
    upkeepMul: 1,
    buildCostMul: 1,
    powerSupplyMul: 1,
    powerDemandMul: 1,
    growthMul: 1,
    abandonMul: 1,
    eventRateMul: 1,
    cardRateMul: 1,
    turfSpreadMul: 1,
    taxCap: MAX_TAX,
    costMul: {},
    upkeepMulType: {},
    favorMonthly: {},
  };
}

/** Identity modifiers. Frozen (keyed maps too): use cloneMods() for a mutable copy. */
export const DEFAULT_MODS: Readonly<SimMods> = (() => {
  const m = identityMods();
  Object.freeze(m.costMul);
  Object.freeze(m.upkeepMulType);
  Object.freeze(m.favorMonthly);
  return Object.freeze(m);
})();

/** A fresh mutable copy of `src` (default: identities), with its own keyed maps. */
export function cloneMods(src: Readonly<SimMods> = DEFAULT_MODS): SimMods {
  return {
    ...src,
    costMul: { ...src.costMul },
    upkeepMulType: { ...src.upkeepMulType },
    favorMonthly: { ...src.favorMonthly },
  };
}

/** Reset `m` to identities in place (keeps the object identity). Returns `m`. */
export function resetMods(m: SimMods): SimMods {
  Object.assign(m, identityMods());
  return m;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Fold patch `p` into `into`: additive keys add, multiplicative keys multiply,
 * `taxCap` takes the minimum, `costMul` / `upkeepMulType` multiply per type and
 * `favorMonthly` adds per faction. Non-finite patch values are ignored.
 */
export function combine(into: SimMods, p: ModPatch): void {
  for (const k of ADDITIVE_MOD_KEYS) {
    const v = p[k];
    if (finite(v)) into[k] += v;
  }
  for (const k of MULTIPLICATIVE_MOD_KEYS) {
    const v = p[k];
    if (finite(v)) into[k] *= v;
  }
  if (finite(p.taxCap) && p.taxCap < into.taxCap) into.taxCap = p.taxCap;
  if (p.costMul) {
    for (const [t, v] of Object.entries(p.costMul) as [keyof SimMods['costMul'], number][]) {
      if (finite(v)) into.costMul[t] = (into.costMul[t] ?? 1) * v;
    }
  }
  if (p.upkeepMulType) {
    for (const [t, v] of Object.entries(p.upkeepMulType) as [keyof SimMods['upkeepMulType'], number][]) {
      if (finite(v)) into.upkeepMulType[t] = (into.upkeepMulType[t] ?? 1) * v;
    }
  }
  if (p.favorMonthly) {
    for (const [f, v] of Object.entries(p.favorMonthly) as [keyof SimMods['favorMonthly'], number][]) {
      if (finite(v)) into.favorMonthly[f] = (into.favorMonthly[f] ?? 0) + v;
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Apply the final clamps in place (§10.4): demand adds ±0.5, crimeAdd and
 * landValueAdd ±0.3, approvalAdd ±20, every multiplier (and each
 * upkeepMulType entry) [0.25, 4], each costMul ≥ 0, taxCap [5, 20].
 * Extras: outageChance [0, 1]; any non-finite value resets to its identity.
 */
export function clampMods(m: SimMods): void {
  const C = MOD_CLAMPS;
  for (const k of ADDITIVE_MOD_KEYS) if (!finite(m[k])) m[k] = 0;
  for (const k of MULTIPLICATIVE_MOD_KEYS) m[k] = finite(m[k]) ? clamp(m[k], C.mulMin, C.mulMax) : 1;
  m.demandRes = clamp(m.demandRes, -C.demand, C.demand);
  m.demandCom = clamp(m.demandCom, -C.demand, C.demand);
  m.demandInd = clamp(m.demandInd, -C.demand, C.demand);
  m.crimeAdd = clamp(m.crimeAdd, -C.crimeAdd, C.crimeAdd);
  m.landValueAdd = clamp(m.landValueAdd, -C.landValueAdd, C.landValueAdd);
  m.approvalAdd = clamp(m.approvalAdd, -C.approvalAdd, C.approvalAdd);
  m.outageChance = clamp(m.outageChance, 0, 1);
  m.taxCap = finite(m.taxCap) ? clamp(m.taxCap, C.taxCapMin, C.taxCapMax) : C.taxCapMax;
  for (const t of Object.keys(m.costMul) as (keyof SimMods['costMul'])[]) {
    const v = m.costMul[t]!;
    m.costMul[t] = finite(v) ? Math.max(0, v) : 1;
  }
  for (const t of Object.keys(m.upkeepMulType) as (keyof SimMods['upkeepMulType'])[]) {
    const v = m.upkeepMulType[t]!;
    m.upkeepMulType[t] = finite(v) ? clamp(v, C.mulMin, C.mulMax) : 1;
  }
  for (const f of Object.keys(m.favorMonthly) as (keyof SimMods['favorMonthly'])[]) {
    if (!finite(m.favorMonthly[f])) delete m.favorMonthly[f];
  }
}

// ── Sim hooks ───────────────────────────────────────────────────────────────

/**
 * Story upkeep the sim runs on the last REGION[R].turfBands days of each month (MEGACITY §3.3, O6: turf's banded
 * month maps), registered by the story module that owns it, so the sim calls it without importing story logic.
 */
const bandHooks: ((world: World) => void)[] = [];

/** Register a month-band hook (idempotent). */
export function onMonthBands(fn: (world: World) => void): void {
  if (!bandHooks.includes(fn)) bandHooks.push(fn);
}

/** The registered month-band hooks (the sim's unit C2 calls each on a band day). */
export function monthBandHooks(): readonly ((world: World) => void)[] {
  return bandHooks;
}

// ── Layers ──────────────────────────────────────────────────────────────────

/** Compose counter per composed layer set (MEGACITY §3.3, O3: the sim's coverage cache keys on it). */
const layerVersions = new WeakMap<SimLayers, number>();

/** How many times `l` (world.layers) has been composed: coverage reads transitAdd and parkAdd, so it re-runs when this moves. */
export function layersVersion(l: SimLayers): number {
  return layerVersions.get(l) ?? 0;
}

/** A layer set at identities (additive layers 0, multiplicative layers 1) for a world of `area` tiles. */
export function makeLayers(area: number): SimLayers {
  return {
    crimeAdd: new Float32Array(area),
    lvAdd: new Float32Array(area),
    transitAdd: new Float32Array(area),
    tripMul: new Float32Array(area).fill(1),
    abandonMul: new Float32Array(area).fill(1),
    taxMul: new Float32Array(area).fill(1),
    parkAdd: new Float32Array(area),
    pollutionAdd: new Float32Array(area),
  };
}

/** Reset a layer set to identities in place (owners call this before rewriting their part). */
export function resetLayers(l: SimLayers): void {
  l.crimeAdd.fill(0);
  l.lvAdd.fill(0);
  l.transitAdd.fill(0);
  l.tripMul.fill(1);
  l.abandonMul.fill(1);
  l.taxMul.fill(1);
  l.parkAdd.fill(0);
  l.pollutionAdd.fill(0);
}

/** Fresh `world.layerParts` for a world of `area` tiles. */
export function makeLayerParts(area: number): LayerParts {
  return { turf: makeLayers(area), vertical: makeLayers(area), local: makeLayers(area), district: makeLayers(area) };
}

/**
 * Merge the four partial sets into `world.layers` (in place, no allocation):
 * crimeAdd / lvAdd / pollutionAdd add, transitAdd / parkAdd take the max,
 * tripMul / abandonMul / taxMul multiply. Results are kept sane: additive layers
 * ±1, transitAdd and parkAdd 0..1, multipliers ≥ 0. The district part (MEGACITY
 * §3.3) merges like the story parts; at identity it changes nothing. Call after
 * any owner rewrites its part. With the world's owned segments (MEGACITY §3.3,
 * O1) only owned tiles are merged: a locked tile is off the map for the sim, and
 * an annex re-composes. One loop per output layer (streams better than one fused
 * loop: ≈ 3.3 against 4.2 ms for 102,400 tiles in Node).
 */
export function composeLayers(world: Pick<World, 'layers' | 'layerParts'> & Partial<Pick<World, 'segs' | 'segCount'>>): void {
  const out = world.layers;
  layerVersions.set(out, layersVersion(out) + 1);
  const { turf: a, vertical: b, local: c, district: d } = world.layerParts;
  const n = out.crimeAdd.length;
  const segs = world.segs;
  const sc = world.segCount ?? 0;
  const one = !segs || sc <= 0;
  for (let k = 0; k < (one ? 2 : sc); k += 2) {
    const lo = one ? 0 : segs![k];
    const hi = one ? n : segs![k + 1];
    add4(out.crimeAdd, a.crimeAdd, b.crimeAdd, c.crimeAdd, d.crimeAdd, lo, hi);
    add4(out.lvAdd, a.lvAdd, b.lvAdd, c.lvAdd, d.lvAdd, lo, hi);
    max4(out.transitAdd, a.transitAdd, b.transitAdd, c.transitAdd, d.transitAdd, lo, hi);
    mul4(out.tripMul, a.tripMul, b.tripMul, c.tripMul, d.tripMul, lo, hi);
    mul4(out.abandonMul, a.abandonMul, b.abandonMul, c.abandonMul, d.abandonMul, lo, hi);
    mul4(out.taxMul, a.taxMul, b.taxMul, c.taxMul, d.taxMul, lo, hi);
    max4(out.parkAdd, a.parkAdd, b.parkAdd, c.parkAdd, d.parkAdd, lo, hi);
    add4(out.pollutionAdd, a.pollutionAdd, b.pollutionAdd, c.pollutionAdd, d.pollutionAdd, lo, hi);
  }
}

/** o = clamp(a + b + c + d, −1, 1) on [lo, hi). */
function add4(o: Float32Array, a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array, lo: number, hi: number): void {
  for (let i = lo; i < hi; i++) {
    const v = a[i] + b[i] + c[i] + d[i];
    o[i] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
}

/** o = clamp(max(a, b, c, d), 0, 1) on [lo, hi). */
function max4(o: Float32Array, a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array, lo: number, hi: number): void {
  for (let i = lo; i < hi; i++) {
    let t = a[i];
    if (b[i] > t) t = b[i];
    if (c[i] > t) t = c[i];
    if (d[i] > t) t = d[i];
    o[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
}

/** o = max(a · b · c · d, 0) on [lo, hi). */
function mul4(o: Float32Array, a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array, lo: number, hi: number): void {
  for (let i = lo; i < hi; i++) {
    const v = a[i] * b[i] * c[i] * d[i];
    o[i] = v > 0 ? v : 0;
  }
}
