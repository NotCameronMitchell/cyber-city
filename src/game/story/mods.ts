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
import { MAP_SIZE } from '../types';
import type { World } from '../world';
import type {
  AdditiveModKey,
  LayerParts,
  ModPatch,
  MultiplicativeModKey,
  SimLayers,
  SimMods,
} from './types';

const AREA = MAP_SIZE * MAP_SIZE;

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

// ── Layers ──────────────────────────────────────────────────────────────────

/** A layer set at identities: additive layers 0, multiplicative layers 1. */
export function makeLayers(): SimLayers {
  return {
    crimeAdd: new Float32Array(AREA),
    lvAdd: new Float32Array(AREA),
    transitAdd: new Float32Array(AREA),
    tripMul: new Float32Array(AREA).fill(1),
    abandonMul: new Float32Array(AREA).fill(1),
    taxMul: new Float32Array(AREA).fill(1),
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
}

/** Fresh `world.layerParts`. */
export function makeLayerParts(): LayerParts {
  return { turf: makeLayers(), vertical: makeLayers(), local: makeLayers() };
}

/**
 * Merge the three partial sets into `world.layers` (in place, no allocation):
 * crimeAdd / lvAdd add, transitAdd takes the max, tripMul / abandonMul /
 * taxMul multiply. Results are kept sane: additive layers ±1, transitAdd 0..1,
 * multipliers ≥ 0. Call after any owner rewrites its part (~0.1 ms).
 */
export function composeLayers(world: Pick<World, 'layers' | 'layerParts'>): void {
  const out = world.layers;
  const { turf: a, vertical: b, local: c } = world.layerParts;
  const n = out.crimeAdd.length;
  const oc = out.crimeAdd;
  const ol = out.lvAdd;
  const ot = out.transitAdd;
  const otr = out.tripMul;
  const oab = out.abandonMul;
  const otx = out.taxMul;
  const ac = a.crimeAdd, bc = b.crimeAdd, cc = c.crimeAdd;
  const al = a.lvAdd, bl = b.lvAdd, cl = c.lvAdd;
  const at = a.transitAdd, bt = b.transitAdd, ct = c.transitAdd;
  const atr = a.tripMul, btr = b.tripMul, ctr = c.tripMul;
  const aab = a.abandonMul, bab = b.abandonMul, cab = c.abandonMul;
  const atx = a.taxMul, btx = b.taxMul, ctx = c.taxMul;
  for (let i = 0; i < n; i++) {
    const cr = ac[i] + bc[i] + cc[i];
    oc[i] = cr < -1 ? -1 : cr > 1 ? 1 : cr;
    const lv = al[i] + bl[i] + cl[i];
    ol[i] = lv < -1 ? -1 : lv > 1 ? 1 : lv;
    let t = at[i];
    if (bt[i] > t) t = bt[i];
    if (ct[i] > t) t = ct[i];
    ot[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    const tr = atr[i] * btr[i] * ctr[i];
    otr[i] = tr > 0 ? tr : 0;
    const ab = aab[i] * bab[i] * cab[i];
    oab[i] = ab > 0 ? ab : 0;
    const tx = atx[i] * btx[i] * ctx[i];
    otx[i] = tx > 0 ? tx : 0;
  }
}
