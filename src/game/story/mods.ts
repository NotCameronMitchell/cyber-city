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
 * month maps), registered by the story module that owns it, so the sim calls it without importing story logic. A hook
 * that returns true did one piece of work and has more due today: the sim ends the atomic step and calls it again.
 */
export type MonthBandHook = (world: World) => boolean | void;
const bandHooks: MonthBandHook[] = [];

/** Register a month-band hook (idempotent). */
export function onMonthBands(fn: MonthBandHook): void {
  if (!bandHooks.includes(fn)) bandHooks.push(fn);
}

/** The registered month-band hooks (the sim's unit C2 calls each on a band day, again while it returns true). */
export function monthBandHooks(): readonly MonthBandHook[] {
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

/** Reset counter per layer set: every owner resets its part before rewriting it, so composeLayers can tell what moved. */
const resetEpochs = new WeakMap<SimLayers, number>();
let resetClock = 0;

/** What a world's layers were last merged from: each part's reset epoch and the owned segments. */
interface Composed {
  turf: number;
  vertical: number;
  local: number;
  district: number;
  segs: Int32Array | null;
  segCount: number;
}
const composed = new WeakMap<SimLayers, Composed>();

/** Reset a layer set to identities in place (owners call this before rewriting their part). */
export function resetLayers(l: SimLayers): void {
  resetEpochs.set(l, ++resetClock);
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
 *
 * The merge runs only when something it reads moved since the last one: a part was
 * reset (every owner calls resetLayers before rewriting its part), the owned
 * segments changed, or `force` (a caller that wrote a part in place without a
 * reset). A repeated call costs nothing (the month end called it three times,
 * ≈ 2.3 ms each at 25 districts) and leaves layersVersion, so the coverage cache
 * (O3) holds.
 */
export function composeLayers(
  world: Pick<World, 'layers' | 'layerParts'> & Partial<Pick<World, 'segs' | 'segCount'>>,
  force = false,
): void {
  const out = world.layers;
  const { turf: a, vertical: b, local: c, district: d } = world.layerParts;
  const segs = world.segs;
  const sc = world.segCount ?? 0;
  const ea = resetEpochs.get(a) ?? 0;
  const eb = resetEpochs.get(b) ?? 0;
  const ec = resetEpochs.get(c) ?? 0;
  const ed = resetEpochs.get(d) ?? 0;
  const last = composed.get(out);
  if (!force && last && last.turf === ea && last.vertical === eb && last.local === ec && last.district === ed && sameSegs(last, segs, sc))
    return;
  if (last) {
    last.turf = ea;
    last.vertical = eb;
    last.local = ec;
    last.district = ed;
    last.segCount = sc;
    last.segs = segs ? (last.segs && last.segs.length >= sc ? last.segs : new Int32Array(segs.length)) : null;
    if (segs && last.segs) last.segs.set(segs.subarray(0, sc));
  } else
    composed.set(out, { turf: ea, vertical: eb, local: ec, district: ed, segCount: sc, segs: segs ? segs.slice() : null });
  layerVersions.set(out, layersVersion(out) + 1);
  const n = out.crimeAdd.length;
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

/**
 * Merge the owned tiles of one rect only (MEGACITY §3.3, §11.1): the district part is rebuilt slot by slot inside the
 * sim day, so its merge is too (a whole compose is ≈ 3 ms at 25 districts). A writer that changed a part in place
 * inside `rect` (without resetLayers) calls this; a part changed outside it still needs a whole compose with `force`.
 * Moves layersVersion only when an output the coverage cache reads (transitAdd, parkAdd) changed. Returns whether it
 * did.
 */
export function composeLayersRect(
  world: Pick<World, 'layers' | 'layerParts' | 'N' | 'region' | 'slotOwned'>,
  rect: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const out = world.layers;
  const { turf: a, vertical: b, local: c, district: d } = world.layerParts;
  const N = world.N;
  const R = world.region;
  const x0 = Math.max(0, rect.x0);
  const y0 = Math.max(0, rect.y0);
  const x1 = Math.min(N - 1, rect.x1);
  const y1 = Math.min(N - 1, rect.y1);
  let moved = false;
  for (let y = y0; y <= y1; y++) {
    const sy = (y >> 6) * R;
    for (let sx = x0 >> 6; sx <= x1 >> 6; sx++) {
      if (world.slotOwned[sy + sx] !== 1) continue;
      const lo = y * N + Math.max(x0, sx << 6);
      const hi = y * N + Math.min(x1, (sx << 6) + 63) + 1;
      add4(out.crimeAdd, a.crimeAdd, b.crimeAdd, c.crimeAdd, d.crimeAdd, lo, hi);
      add4(out.lvAdd, a.lvAdd, b.lvAdd, c.lvAdd, d.lvAdd, lo, hi);
      if (max4c(out.transitAdd, a.transitAdd, b.transitAdd, c.transitAdd, d.transitAdd, lo, hi)) moved = true;
      mul4(out.tripMul, a.tripMul, b.tripMul, c.tripMul, d.tripMul, lo, hi);
      mul4(out.abandonMul, a.abandonMul, b.abandonMul, c.abandonMul, d.abandonMul, lo, hi);
      mul4(out.taxMul, a.taxMul, b.taxMul, c.taxMul, d.taxMul, lo, hi);
      if (max4c(out.parkAdd, a.parkAdd, b.parkAdd, c.parkAdd, d.parkAdd, lo, hi)) moved = true;
      add4(out.pollutionAdd, a.pollutionAdd, b.pollutionAdd, c.pollutionAdd, d.pollutionAdd, lo, hi);
    }
  }
  if (moved) layerVersions.set(out, layersVersion(out) + 1);
  return moved;
}

/** max4, reporting whether any output value changed. */
function max4c(o: Float32Array, a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array, lo: number, hi: number): boolean {
  let moved = false;
  for (let i = lo; i < hi; i++) {
    let t = a[i];
    if (b[i] > t) t = b[i];
    if (c[i] > t) t = c[i];
    if (d[i] > t) t = d[i];
    const v = t < 0 ? 0 : t > 1 ? 1 : t;
    if (o[i] !== v) {
      o[i] = v;
      moved = true;
    }
  }
  return moved;
}

/** Were the layers last merged over these owned segments? */
function sameSegs(last: Composed, segs: Int32Array | undefined, sc: number): boolean {
  if (!segs) return last.segs === null;
  if (!last.segs || last.segCount !== sc) return false;
  const p = last.segs;
  for (let k = 0; k < sc; k++) if (p[k] !== segs[k]) return false;
  return true;
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
