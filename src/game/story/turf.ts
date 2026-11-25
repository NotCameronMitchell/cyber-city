// ─────────────────────────────────────────────────────────────────────────────
// Gangs and turf (docs/STORY.md §3). Owner: WP-C.
//
//   update(world)        monthly rules: seeding, hold, spread, tagback, scatter
//                        (story RNG, deterministic), then refreshStats
//   refreshStats(world)  turf.stats, story.seam, layerParts.turf, composeLayers, 'turf'
//   turfPatch(world)     resolveMods source 5 (turf demand) plus the pacts' city-wide mods
//   ops                  seedGang / addStrength / clearTurf / flipTurf / freezeTurf /
//                        forceSeed for the director's `turf` effects (each refreshes)
//
// world.turf is plain data the sim may read (gangSurge); only this module and
// World.addBuilding (footprint clear) write it. Budget: update + vertical
// refresh ≤ 2 ms on a full map; every buffer here is reused.
// ─────────────────────────────────────────────────────────────────────────────

import { artOffset } from '../districts/slots';
import { completeStage } from '../buildingStats';
import { BUILDINGS, CROWNS, GANG_IDS, GANG_NEWS_NAME, REGION, RIBBON, STANDING, TURF, TURF_OWNER } from '../config';
import { capitalizeFirst, districtName } from '../news';
import { Rng } from '../rng';
import { scratchFor } from '../frame';
import { DAYS_PER_MONTH, RoadKind, Terrain, ZoneType, type Building, type BuildingType, type DistrictKind } from '../types';
import type { World } from '../world';
import { standing, tier } from './factions';
import { composeLayers, onMonthBands, resetLayers } from './mods';
import type { EndingRules, GangId, ModPatch } from './types';
import { isTallBuilding, isTallZoneTile, spanMask } from './vertical';

const WATER = Terrain.Water;
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;
const IND = ZoneType.Industrial;
const U = 1; // TURF_OWNER.undertow
const K = 2; // TURF_OWNER.kites
/** Building types whose footprint keeps turf (§3.1; Skeleton Row's frames too, MEGACITY §3.7, as world.ts TURF_KEEPING). */
const KEEPS_TURF: ReadonlySet<BuildingType> = new Set<BuildingType>(['tidemarket', 'roost', 'frame']);

// ── Scratch (module-level, reused; one set per frame size, MEGACITY §3.1) ───

/**
 * One set of turf maps (MEGACITY §3.3, O6): the per-tile inputs of one pass over the owned tiles (indicators and the
 * typed tile mirror the affinity terms read) and the maps the monthly rules read. The shared scratch holds one for
 * the whole-map path; each world banding its month (`bandStep`) has its own.
 */
interface MapSet {
  /** Owned land (no water); `elig` is this minus building footprints. */
  eligBase: Uint8Array;
  elig: Uint8Array;
  nearCity: Uint8Array;
  affU: Float32Array;
  affK: Float32Array;
  protU: Uint8Array;
  protK: Uint8Array;
  pactBlock: Uint8Array;
  // Indicators (dilated in place by the affinity steps).
  mA: Uint8Array;
  mB: Uint8Array;
  mC: Uint8Array;
  mD: Uint8Array;
  mAlley: Uint8Array;
  mAlleyK: Uint8Array;
  mSea: Uint8Array;
  mSky: Uint8Array;
  mGlare: Uint8Array;
  mTall: Uint8Array;
  mSpan: Uint8Array;
  mFrame: Uint8Array;
  /** Tile mirror: zone, and flags (1 Fab, 2 dense Market / Hab, 4 Highway or Ramp road). */
  tz: Uint8Array;
  tf: Uint8Array;
  tmp: Uint8Array;
  /** Set tiles per indicator from the tile pass (a dilation of nothing is skipped): abandoned, water, ribbon, alley, deck, city. */
  n: Int32Array;
}
const NA = 0;
const NB = 1;
const NC = 2;
const NALLEY = 3;
const NSKY = 4;
const ND = 5;
const makeMapSet = (area: number): MapSet => ({
  eligBase: new Uint8Array(area),
  elig: new Uint8Array(area),
  nearCity: new Uint8Array(area),
  affU: new Float32Array(area),
  affK: new Float32Array(area),
  protU: new Uint8Array(area),
  protK: new Uint8Array(area),
  pactBlock: new Uint8Array(area),
  mA: new Uint8Array(area),
  mB: new Uint8Array(area),
  mC: new Uint8Array(area),
  mD: new Uint8Array(area),
  mAlley: new Uint8Array(area),
  mAlleyK: new Uint8Array(area),
  mSea: new Uint8Array(area),
  mSky: new Uint8Array(area),
  mGlare: new Uint8Array(area),
  mTall: new Uint8Array(area),
  mSpan: new Uint8Array(area),
  mFrame: new Uint8Array(area),
  tz: new Uint8Array(area),
  tf: new Uint8Array(area),
  tmp: new Uint8Array(area),
  n: new Int32Array(6),
});
const scratch = scratchFor((area) => ({
  ...makeMapSet(area),
  crack: new Uint8Array(area),
  list: new Int32Array(area),
}));
const count = [0, 0, 0];

const gangCode = (g: GangId): 1 | 2 => TURF_OWNER[g];
const gangOf = (o: number): GangId => (o === U ? 'undertow' : 'kites');

// ── Ending rules hook ───────────────────────────────────────────────────────

/** Spec defaults (§6.1) until the director registers the real ending table. */
const DEFAULT_RULES: Partial<Record<string, EndingRules>> = {
  lowcrown: { permanentPacts: true, pactNoLimits: true },
  ledger: { lockPacts: true, endOffLedger: true },
};
let rulesSource: (world: World) => EndingRules | null = (w) =>
  (w.story.ending ? DEFAULT_RULES[w.story.ending] : null) ?? null;

/**
 * Let the director supply the current ending's rules (read live, never cached):
 * `turf.setEndingRulesSource((w) => ENDINGS[w.story.ending]?.rules ?? null)`.
 */
export function setEndingRulesSource(fn: (world: World) => EndingRules | null): void {
  rulesSource = fn;
}

function rules(world: World): EndingRules | null {
  return world.story.ending ? rulesSource(world) : null;
}

/** A pact (story.pacts entry, or the ending's permanentPacts) holds for this gang (§3.6). */
export function pactActive(world: World, gang: GangId): boolean {
  const tick = world.tick;
  for (const p of world.story.pacts) if (p.gang === gang && p.until > tick) return true;
  return !!rules(world)?.permanentPacts;
}

/** Remove the gang's pact entries (crackdown). Returns true if one was active. Posts the news line. */
export function breakPact(world: World, gang: GangId): boolean {
  const tick = world.tick;
  const pacts = world.story.pacts;
  let had = false;
  for (let k = pacts.length - 1; k >= 0; k--) {
    if (pacts[k].gang !== gang) continue;
    if (pacts[k].until > tick) had = true;
    pacts.splice(k, 1);
  }
  if (had) world.addNews(`${capitalizeFirst(GANG_NEWS_NAME[gang])}: pact broken. Expect company.`, 'bad');
  return had;
}

// ── Maps ────────────────────────────────────────────────────────────────────

/**
 * Binary Chebyshev dilation (separable sliding window) on an N×N map. `src` may equal `out`; `tmp` may not. With `box`
 * (inclusive; MEGACITY O6) only that rectangle is read and written, every tile outside it counting as 0: exact on the
 * box when `src` is 0 outside it (turf indicators are 0 off the owned land), and `out` keeps its old values outside.
 * The vertical half slides a row window (column counts), so both halves stream rows.
 */
function dilate(src: Uint8Array, r: number, out: Uint8Array, tmp: Uint8Array, N: number, box?: TileBox): Uint8Array {
  const x0 = box ? box.x0 : 0;
  const x1 = box ? box.x1 : N - 1;
  const y0 = box ? box.y0 : 0;
  const y1 = box ? box.y1 : N - 1;
  if (x1 < x0 || y1 < y0) return out;
  if (r <= 0) {
    if (out !== src) for (let y = y0; y <= y1; y++) out.set(src.subarray(y * N + x0, y * N + x1 + 1), y * N + x0);
    return out;
  }
  for (let y = y0; y <= y1; y++) {
    const row = y * N;
    let c = 0;
    for (let x = x0; x <= x0 + r && x <= x1; x++) c += src[row + x];
    for (let x = x0; x <= x1; x++) {
      tmp[row + x] = c > 0 ? 1 : 0;
      const xo = x - r;
      if (xo >= x0) c -= src[row + xo];
      const xi = x + r + 1;
      if (xi <= x1) c += src[row + xi];
    }
  }
  const w = x1 - x0 + 1;
  const cols = colScratch(w);
  cols.fill(0);
  for (let y = y0; y <= y0 + r && y <= y1; y++) {
    const row = y * N + x0;
    for (let x = 0; x < w; x++) cols[x] += tmp[row + x];
  }
  for (let y = y0; y <= y1; y++) {
    const row = y * N + x0;
    for (let x = 0; x < w; x++) out[row + x] = cols[x] > 0 ? 1 : 0;
    const yo = y - r;
    if (yo >= y0) {
      const ro = yo * N + x0;
      for (let x = 0; x < w; x++) cols[x] -= tmp[ro + x];
    }
    const yi = y + r + 1;
    if (yi <= y1) {
      const ri = yi * N + x0;
      for (let x = 0; x < w; x++) cols[x] += tmp[ri + x];
    }
  }
  return out;
}
let colBuf = new Int32Array(0);
function colScratch(n: number): Int32Array {
  if (colBuf.length < n) colBuf = new Int32Array(n);
  return colBuf.subarray(0, n);
}
interface TileBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Is any tile of `a` set inside the box? (A dilation of nothing is nothing: skip the pass, MEGACITY O6.) */
function anyIn(a: Uint8Array, N: number, box: TileBox): boolean {
  for (let y = box.y0; y <= box.y1; y++) {
    const row = y * N;
    for (let i = row + box.x0, e = row + box.x1; i <= e; i++) if (a[i]) return true;
  }
  return false;
}
/**
 * dilate() over the owned box, or clear the box when the source holds nothing there (`count`: the source's set tiles
 * when the tile pass counted them, so the empty case costs no scan; an in-place empty source is already clear).
 */
function dilateOwned(world: World, src: Uint8Array, r: number, out: Uint8Array, tmp: Uint8Array, count = -1): void {
  const N = world.N;
  const box = world.ownedBox;
  if (box.x1 < box.x0) return;
  if (count === 0 && out === src) return;
  if (count === 0 || (count < 0 && !anyIn(src, N, box))) {
    for (let y = box.y0; y <= box.y1; y++) out.fill(0, y * N + box.x0, y * N + box.x1 + 1);
    return;
  }
  dilate(src, r, out, tmp, N, box);
}

function fillRect(a: Uint8Array, x0: number, y0: number, x1: number, y1: number, N: number): void {
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > N - 1) x1 = N - 1;
  if (y1 > N - 1) y1 = N - 1;
  for (let y = y0; y <= y1; y++) a.fill(1, y * N + x0, y * N + x1 + 1);
}

/**
 * Eligible turf tile: owned land, no building except a Tidemarket or Kite Roost (§3.1). A locked district is off the
 * map for turf (MEGACITY §3.4 "Turf never forms there", the O1 rule): never eligible, never counted as land.
 */
function eligibleAt(world: World, i: number): boolean {
  const t = world.tiles[i];
  if (t.terrain === WATER || !world.ownedAt(i)) return false;
  if (t.buildingId < 0) return true;
  const b = world.buildings.get(t.buildingId);
  return !!b && KEEPS_TURF.has(b.type);
}

/**
 * Rebuild eligibility, the near-city mask, both affinity maps (§3.3), the protection masks and the pact spread block
 * into the shared scratch: every step of MAP_STEPS in order (MEGACITY O6; the banded month runs the same steps over
 * several days into its own set).
 */
function computeMaps(world: World): void {
  const M = scratch(world.area);
  for (let k = 0; k < MAP_STEPS; k++) mapStep(world, M, k);
}

/**
 * Steps of one map rebuild, each ≤ ≈ 0.6 ms in Node at 25 districts (MEGACITY O6): 5 row bands of the tile pass, the
 * near-city dilation, buildings, the abandoned and water dilations, the Undertow's small ones, its affinity in two row
 * halves, the tall dilation, the Kites' other dilations, their affinity in two row halves.
 */
const MAP_STEPS = 16;

function mapStep(world: World, M: MapSet, k: number): void {
  const N = world.N;
  const au = TURF.affinity.undertow;
  const ak = TURF.affinity.kites;
  // Two steps a day on a 5×5 region pair one full-map dilation with a light step: (rows, rows) (rows, rows)
  // (rows, near-city) (buildings, ribbon + alley) (abandoned, water) (Undertow ×2) (tall, span + sky) (Kites ×2).
  if (k < 5) tileRows(world, M, ((N * k) / 5) | 0, ((N * (k + 1)) / 5) | 0);
  else if (k === 5) dilateOwned(world, M.mD, 3, M.nearCity, M.tmp, M.n[ND]);
  else if (k === 6) buildingMaps(world, M);
  else if (k === 7) undertowMasks(world, M);
  else if (k === 8) dilateOwned(world, M.mA, au.abandonedRadius, M.mA, M.tmp, M.n[NA]);
  else if (k === 9) dilateOwned(world, M.mB, au.waterRadius, M.mB, M.tmp, M.n[NB]);
  else if (k === 10) undertowAffinity(world, M, 0, N >> 1);
  else if (k === 11) undertowAffinity(world, M, N >> 1, N);
  else if (k === 12) dilateOwned(world, M.mTall, ak.tallRadius, M.mTall, M.tmp);
  else if (k === 13) kitesMasks(world, M);
  else if (k === 14) kitesAffinity(world, M, 0, N >> 1);
  else kitesAffinity(world, M, N >> 1, N);
}

/**
 * The one pass over Tile objects, rows y0..y1 − 1: owned land, the indicators and the tile mirror. A locked tile is
 * off the map (MEGACITY §3.4, O1): every indicator 0, never eligible, and its water is not "water near" an owned tile.
 */
function tileRows(world: World, M: MapSet, y0: number, y1: number): void {
  const N = world.N;
  const R = world.region;
  const tiles = world.tiles;
  const rail = world.rail;
  const sky = world.sky;
  const own = world.slotOwned;
  const { eligBase, mA, mB, mC, mD, mAlley, mSky, mTall, tz, tf } = M;
  const HW = RoadKind.Highway;
  const RAMP = RoadKind.Ramp;
  const ALLEY = RoadKind.Alley;
  const cnt = M.n;
  if (y0 === 0) cnt.fill(0);
  let nA = 0;
  let nB = 0;
  let nC = 0;
  let nAl = 0;
  let nSky = 0;
  let nD = 0;
  for (let y = y0; y < y1; y++) {
    const srow = (y >> 6) * R;
    for (let sx = 0; sx * 64 < N; sx++) {
      const a = y * N + sx * 64;
      const b = a + 64;
      if (!own[srow + sx]) {
        eligBase.fill(0, a, b);
        mA.fill(0, a, b);
        mB.fill(0, a, b);
        mC.fill(0, a, b);
        mD.fill(0, a, b);
        mAlley.fill(0, a, b);
        mSky.fill(0, a, b);
        mTall.fill(0, a, b);
        tz.fill(0, a, b);
        tf.fill(0, a, b);
        continue;
      }
      for (let i = a; i < b; i++) {
        const t = tiles[i];
        const water = t.terrain === WATER;
        eligBase[i] = water ? 0 : 1;
        const vb = water ? 1 : 0;
        mB[i] = vb;
        nB += vb;
        const ab = t.abandoned;
        const va = ab ? 1 : 0;
        mA[i] = va;
        nA += va;
        const vc = rail[i] ? 1 : 0;
        mC[i] = vc;
        nC += vc;
        const z = t.zone;
        const road = t.road;
        const vd = road || (z !== 0 && t.level > 0) || t.buildingId >= 0 ? 1 : 0;
        mD[i] = vd;
        nD += vd;
        const rk = t.roadKind;
        const val = road && rk === ALLEY ? 1 : 0;
        mAlley[i] = val;
        nAl += val;
        const vs = sky[i] !== 0 ? 1 : 0;
        mSky[i] = vs;
        nSky += vs;
        // vertical.tallMask's tile half (tall zone tiles off buildings); buildingMaps adds the tall buildings.
        mTall[i] = t.buildingId < 0 && tallZoneTile(t) ? 1 : 0;
        tz[i] = z;
        let f = z === IND ? 1 : 0;
        if (!ab && ((z === COM && t.level >= 2) || (z === RES && t.level === 3))) f |= 2;
        if (road && (rk === HW || rk === RAMP)) f |= 4;
        tf[i] = f;
      }
    }
  }
  cnt[NA] += nA;
  cnt[NB] += nB;
  cnt[NC] += nC;
  cnt[NALLEY] += nAl;
  cnt[NSKY] += nSky;
  cnt[ND] += nD;
}
/** vertical.isTallZoneTile, bound once (an imported binding read per tile is a getter call under the test transform). */
const tallZoneTile = isTallZoneTile;

/** Building footprints (eligibility), the protection masks, the pact spread block and the building indicators. */
function buildingMaps(world: World, M: MapSet): void {
  const N = world.N;
  const { elig, eligBase, protU, protK, pactBlock, mSea, mGlare, mFrame } = M;
  elig.set(eligBase);
  protU.fill(0);
  protK.fill(0);
  pactBlock.fill(0);
  mSea.fill(0);
  mGlare.fill(0);
  mFrame.fill(0);
  const P = TURF.protect;
  const rSea = TURF.affinity.undertow.seaportRadius;
  const rGlare = TURF.affinity.kites.glarewallRadius;
  const rFrame = TURF.affinity.kites.frameRadius;
  for (const b of world.buildings.values()) {
    const x1 = b.x + b.size - 1;
    const y1 = b.y + b.size - 1;
    if (!KEEPS_TURF.has(b.type)) for (let y = b.y; y <= y1; y++) elig.fill(0, y * N + b.x, y * N + x1 + 1);
    if (b.type === 'tidemarket') fillRect(protU, b.x - P.tidemarket, b.y - P.tidemarket, x1 + P.tidemarket, y1 + P.tidemarket, N);
    else if (b.type === 'roost') fillRect(protK, b.x - P.roost, b.y - P.roost, x1 + P.roost, y1 + P.roost, N);
    else if (b.type === 'stack' && completeStage(b) >= 3) {
      const r = TURF.pact.noSpreadRadius;
      fillRect(pactBlock, b.x - r, b.y - r, x1 + r, y1 + r, N);
      if (b.crown === 'nest') {
        const n = CROWNS.nest.turfProtect ?? P.nest;
        fillRect(protK, b.x - n, b.y - n, x1 + n, y1 + n, N);
      } else if (b.crown === 'salvage') {
        // A Salvage crown shelters Undertow turf (MEGACITY §6.2: r2), as a Kite Nest shelters the Kites'.
        const n = CROWNS.salvage.turfProtect ?? P.nest;
        fillRect(protU, b.x - n, b.y - n, x1 + n, y1 + n, N);
      }
    } else if (b.type === 'spire' || b.type === 'arcology') {
      const r = TURF.pact.noSpreadRadius;
      fillRect(pactBlock, b.x - r, b.y - r, x1 + r, y1 + r, N);
    } else if (b.type === 'seaport') fillRect(mSea, b.x - rSea, b.y - rSea, x1 + rSea, y1 + rSea, N);
    // A footprint grown by r is its Chebyshev dilation: stamped dilated, no map pass (MEGACITY O6).
    if (TALL_TYPES.has(b.type) && isTallBuilding(b)) fillRect(M.mTall, b.x, b.y, x1, y1, N);
    if (b.type === 'glarewall') fillRect(mGlare, b.x - rGlare, b.y - rGlare, x1 + rGlare, y1 + rGlare, N);
    else if (b.type === 'frame') fillRect(mFrame, b.x - rFrame, b.y - rFrame, x1 + rFrame, y1 + rFrame, N);
  }
  const lvBlock = TURF.pact.noSpreadLandValue;
  const lv = world.fields.landValue;
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) if (lv[i] >= lvBlock) pactBlock[i] = 1;
  });
}

/**
 * Building types that can count as tall (vertical.isTallBuilding true at some stage): the rest skip its buildingStats
 * call in the map rebuild.
 */
const TALL_TYPES: ReadonlySet<string> = new Set(
  Object.values(BUILDINGS)
    .filter((d) => [1, 2, 3].some((stage) => isTallBuilding({ id: 0, type: d.type, x: 0, y: 0, size: d.size, offline: 0, powered: true, stage: stage as 1 | 2 | 3, buildDays: 0 } as Building)))
    .map((d) => d.type),
);

/** Per-slot affinity bonus of a district kind (MEGACITY §8.4: the Bazaar for both gangs, the Sunk for the Undertow). */
function slotBonus(world: World, gang: GangId): Float32Array {
  const R = world.region;
  const out = new Float32Array(R * R);
  const A = TURF.affinity[gang] as { bazaar?: number; sunk?: number };
  for (let s = 0; s < R * R; s++) {
    if (!world.slotOwned[s]) continue;
    const kind = world.districts.kinds[s];
    if (kind === 'bazaar' && A.bazaar) out[s] = A.bazaar;
    else if (kind === 'sunk' && A.sunk) out[s] = A.sunk;
  }
  return out;
}

/** The Undertow's dilations besides the near-city mask (each skipped when its indicator is empty). */
function undertowMasks(world: World, M: MapSet): void {
  const au = TURF.affinity.undertow;
  const { mC, mAlley, tmp } = M;
  // Abandoned within 1 (mA), water within 3 (mB), ribbon within 1 (mC), alley within 1 (mAlley); the seaport
  // footprint within 6 (mSea) is stamped already dilated by buildingMaps. Every map is read only on owned land: the
  // dilations run over the owned box (MEGACITY O6).
  // (Abandoned within 1, mA, and water within 3, mB, are steps of their own.)
  dilateOwned(world, mC, au.ribbonRadius, mC, tmp, M.n[NC]);
  // The Kites' alley term reads mAlleyK: the same dilation unless the radii differ (both 1, TURF.affinity).
  const nAl = M.n[NALLEY];
  if (TURF.affinity.kites.alleyRadius !== au.alleyRadius) dilateOwned(world, mAlley, TURF.affinity.kites.alleyRadius, M.mAlleyK, tmp, nAl);
  dilateOwned(world, mAlley, au.alleyRadius, mAlley, tmp, nAl);
  if (TURF.affinity.kites.alleyRadius === au.alleyRadius) M.mAlleyK.set(mAlley);
}

/** The Undertow's affinity map on owned tiles of rows y0..y1 − 1 (elsewhere untouched). */
function undertowAffinity(world: World, M: MapSet, y0: number, y1: number): void {
  const N = world.N;
  const au = TURF.affinity.undertow;
  const { mA, mB, mC, mSea, mAlley, affU, tz } = M;
  const f = world.fields;
  const crime = f.crime;
  const pol = f.pollution;
  const lv = f.landValue;
  const sec = f.security;
  const bonus = slotBonus(world, 'undertow');
  const R = world.region;
  // A segment can span several owned slots in its row: the district bonus is read per 64-tile chunk.
  forOwnedRows(world, y0, y1, (a0, e0) => {
    for (let a = a0; a < e0; a += 64) {
    const e = a + 64;
    const extra = bonus[(((a / N) | 0) >> 6) * R + ((a % N) >> 6)];
    for (let i = a; i < e; i++) {
      const v =
        au.base +
        au.crime * crime[i] +
        au.pollution * pol[i] +
        au.lowLandValue * (1 - lv[i]) +
        au.abandonedNear * mA[i] +
        au.waterNear * mB[i] +
        (tz[i] === IND ? au.fab : 0) +
        au.security * sec[i] +
        au.ribbonNear * mC[i] +
        au.alleyNear * mAlley[i] +
        au.seaportNear * mSea[i] +
        extra;
      affU[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    }
  });
}

/** The Kites' masks and dilations: tall anchor within 3 or active span within 1, Glarewall within 4, frames within 2. */
function kitesMasks(world: World, M: MapSet): void {
  const N = world.N;
  const ak = TURF.affinity.kites;
  const { mSpan, mSky, tmp } = M;
  void N;
  // mTall (vertical.tallMask's map, built by tileRows and buildingMaps) is dilated in its own step.
  spanMask(world, mSpan);
  dilateOwned(world, mSpan, ak.spanRadius, mSpan, tmp);
  // Glarewalls and frames are stamped already dilated by buildingMaps (a footprint grown by r is its dilation).
  dilateOwned(world, mSky, ak.skywayRadius, mSky, tmp, M.n[NSKY]);
}

/** The Kites' affinity map on owned tiles of rows y0..y1 − 1 (elsewhere untouched). */
function kitesAffinity(world: World, M: MapSet, y0: number, y1: number): void {
  const N = world.N;
  const ak = TURF.affinity.kites;
  const { mTall, mSpan, mGlare, mAlleyK, mSky, mFrame, tf, affK } = M;
  const f = world.fields;
  const crime = f.crime;
  const traffic = f.traffic;
  const net = f.net;
  const sec = f.security;
  const bonus = slotBonus(world, 'kites');
  const R = world.region;
  forOwnedRows(world, y0, y1, (a0, e0) => {
    for (let a = a0; a < e0; a += 64) {
    const e = a + 64;
    const extra = bonus[(((a / N) | 0) >> 6) * R + ((a % N) >> 6)];
    for (let i = a; i < e; i++) {
      const fl = tf[i];
      // Highways and their ramps carry the city's through traffic: no Kites magnet there (§8.4).
      const busy = fl & 4 ? 0 : traffic[i];
      const v =
        ak.base +
        ak.crime * crime[i] +
        ak.traffic * busy +
        ak.net * net[i] +
        ak.dense * (fl & 2 ? 1 : 0) +
        ak.tallNear * (mTall[i] | mSpan[i]) +
        ak.security * sec[i] +
        ak.glarewallNear * mGlare[i] +
        ak.alleyNear * mAlleyK[i] +
        ak.skywayNear * mSky[i] +
        ak.frameNear * mFrame[i] +
        extra;
      affK[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    }
  });
}

/** fn(a, e) for every owned segment of rows y0..y1 − 1 (a segment never spans two rows). */
function forOwnedRows(world: World, y0: number, y1: number, fn: (a: number, e: number) => void): void {
  const segs = world.segs;
  const N = world.N;
  const lo = y0 * N;
  const hi = y1 * N;
  for (let s = 0; s < world.segCount; s += 2) {
    const a = segs[s];
    if (a < lo) continue;
    if (a >= hi) break;
    fn(a, segs[s + 1]);
  }
}

/** fn(a, e) for every owned segment [a, e) in index order (world.segs, MEGACITY §3.3 O1). */
function forOwned(world: World, fn: (a: number, e: number) => void): void {
  const segs = world.segs;
  for (let s = 0; s < world.segCount; s += 2) fn(segs[s], segs[s + 1]);
}

// ── The banded month (MEGACITY §3.3, O6) ────────────────────────────────────

/** A world's banded map rebuild: its own map set, the steps done and what it was built against. */
interface Bands {
  M: MapSet;
  /** Steps done (MAP_STEPS = complete). */
  done: number;
  /** The month-end tick the bands are for. */
  monthEnd: number;
  slots: number;
  terrain: number;
}
const bandsOf = new WeakMap<World, Bands>();

/**
 * Run this day's share of next month end's map rebuild (the sim calls it once a day, unit C2). The last
 * `REGION[R].turfBands` days before a month end share MAP_STEPS steps into the world's own map set, so
 * `update` at the month end only copies them in (it rebuilds whole when the bands are missing or an annex or a terrain
 * change came between). Nothing runs while turf cannot form yet (no gang seeded or due, no turf). Returns the steps run.
 */
export function bandStep(world: World): number {
  const bands = REGION[world.region].turfBands;
  const day = world.tick % DAYS_PER_MONTH;
  const d = day - (DAYS_PER_MONTH - bands);
  if (d < 0) return 0;
  if (!mapsNeeded(world)) return 0;
  let B = bandsOf.get(world);
  if (!B || B.M.elig.length !== world.area) {
    B = { M: makeMapSet(world.area), done: 0, monthEnd: -1, slots: -1, terrain: -1 };
    bandsOf.set(world, B);
  }
  const monthEnd = world.tick - day + DAYS_PER_MONTH;
  if (d === 0 || B.monthEnd !== monthEnd || B.slots !== world.slotsVersion || B.terrain !== world.terrainVersion) {
    B.done = 0;
    B.monthEnd = monthEnd;
    B.slots = world.slotsVersion;
    B.terrain = world.terrainVersion;
  }
  // Day d of the window runs steps [⌊d · S / bands⌋, ⌊(d + 1) · S / bands⌋): 2 steps a day on 8 bands, 4 on 4.
  const until = Math.min(MAP_STEPS, Math.floor(((d + 1) * MAP_STEPS) / bands));
  let n = 0;
  while (B.done < until) {
    mapStep(world, B.M, B.done++);
    n++;
  }
  return n;
}

onMonthBands((world) => void bandStep(world));

/**
 * The month end's maps: the banded set when it is complete for this month end and nothing structural changed (its
 * affinity and near-city maps then read the city as of the band days; eligibility, protection and the pact block are
 * rebuilt now from today's buildings), else a whole rebuild.
 */
function monthMaps(world: World): void {
  const B = bandsOf.get(world);
  if (
    !B ||
    B.done < MAP_STEPS ||
    B.monthEnd !== world.tick ||
    B.slots !== world.slotsVersion ||
    B.terrain !== world.terrainVersion ||
    B.M.elig.length !== world.area
  ) {
    computeMaps(world);
    return;
  }
  const S = scratch(world.area);
  S.eligBase.set(B.M.eligBase);
  S.nearCity.set(B.M.nearCity);
  S.affU.set(B.M.affU);
  S.affK.set(B.M.affK);
  buildingMaps(world, S);
  B.done = 0;
}

/** Turf can form or exists: a gang seeded, a gang's seed population reached, or tiles held. */
function mapsNeeded(world: World): boolean {
  const tk = world.turf;
  if (tk.seeded.undertow || tk.seeded.kites) return true;
  for (const g of GANG_IDS) if (world.maxPopulation >= TURF.seedPop[g]) return true;
  return tk.stats.tiles.undertow + tk.stats.tiles.kites > 0;
}

/** Crackdown zones still hitting this month (tick ≤ until), as a tile mask. */
function computeCrack(world: World): boolean {
  const { crack } = scratch(world.area);
  crack.fill(0);
  const tick = world.tick;
  let any = false;
  for (const c of world.story.crackdowns) {
    if (tick > c.until) continue;
    any = true;
    markDisc(crack, c.x, c.y, c.r, world.N);
  }
  return any;
}

function markDisc(a: Uint8Array, cx: number, cy: number, r: number, N: number): void {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(N - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(N - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = ya; y <= yb; y++) {
    const dy = y + 0.5 - cy;
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) a[y * N + x] = 1;
    }
  }
}

function countTiles(world: World): void {
  const owner = world.turf.owner;
  count[0] = count[1] = count[2] = 0;
  // Owned land only (turf never forms on a locked tile); count[0] (unowned tiles) is read by nothing.
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) count[owner[i]]++;
  });
}

/** Owned land (non-water) tiles: the cap and `turf.share` denominators (a locked district is off the map, §3.4). */
export function landTiles(world: World): number {
  const c = landCache.get(world);
  // Land changes only with the owned slots or the terrain (MEGACITY §3.3: Pump House reclamation bumps terrainVersion).
  if (c && c.slots === world.slotsVersion && c.terrain === world.terrainVersion) return c.n;
  let n = 0;
  const tiles = world.tiles;
  const segs = world.segs;
  for (let s = 0; s < world.segCount; s += 2) for (let i = segs[s]; i < segs[s + 1]; i++) if (tiles[i].terrain !== WATER) n++;
  landCache.set(world, { slots: world.slotsVersion, terrain: world.terrainVersion, n });
  return n;
}
const landCache = new WeakMap<World, { slots: number; terrain: number; n: number }>();

/** Most tiles one gang may hold (§3.1). */
export function capFor(world: World): number {
  return Math.floor(TURF.capShare * landTiles(world));
}

function free(world: World, i: number): void {
  const t = world.turf;
  count[t.owner[i]]--;
  t.owner[i] = 0;
  t.str[i] = 0;
  t.contested[i] = 0;
}

/** Mean security over developed tiles (the `security.avg` metric). */
export function securityAvg(world: World): number {
  const tiles = world.tiles;
  const sec = world.fields.security;
  let s = 0;
  let n = 0;
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) {
      const t = tiles[i];
      if (t.zone === 0 || t.level === 0 || t.abandoned) continue;
      s += sec[i];
      n++;
    }
  });
  return n ? s / n : 0;
}

// ── Seeding ─────────────────────────────────────────────────────────────────

/**
 * Best seed tile for a gang: the highest-affinity unowned eligible tile near the
 * city (a road or development within 3), else anywhere. Ties keep the lowest
 * index. `skip(i)` excludes tiles (scatter: the crackdown zone). Needs computeMaps.
 */
function bestTileIn(world: World, gang: GangId, owner: Uint8Array, skip?: (i: number) => boolean, kind?: DistrictKind): number {
  const { elig, nearCity, affU, affK } = scratch(world.area);
  const aff = gang === 'undertow' ? affU : affK;
  let best = -1;
  let bestA = -1;
  let any = -1;
  let anyA = -1;
  // Owned land only (MEGACITY §3.3, O1: eligibility is 0 on locked tiles), in index order, so ties keep the lowest index.
  const segs = world.segs;
  const N = world.N;
  const R = world.region;
  const kinds = world.districts.kinds;
  for (let s = 0; s < world.segCount; s += 2) {
    const e = segs[s + 1];
    // A segment runs over adjacent owned slots of one row: walk it slot by slot (64 tiles) for the kind filter.
    for (let c = segs[s]; c < e; c += 64) {
      if (kind !== undefined && kinds[(((c / N) | 0) >> 6) * R + ((c % N) >> 6)] !== kind) continue;
      for (let i = c, ce = Math.min(e, c + 64); i < ce; i++) {
        if (!elig[i] || owner[i]) continue;
        if (skip && skip(i)) continue;
        const a = aff[i];
        if (a > anyA) {
          anyA = a;
          any = i;
        }
        if (nearCity[i] && a > bestA) {
          bestA = a;
          best = i;
        }
      }
    }
  }
  return best >= 0 ? best : any;
}

/** The Undertow's first seed prefers an owned Sunk's best tile (MEGACITY §3.7), else the best tile anywhere. */
function seedTile(world: World, gang: GangId, owner: Uint8Array): number {
  if (gang === 'undertow' && world.districts.owned.some((s) => world.districts.kinds[s] === 'sunk')) {
    const c = bestTileIn(world, gang, owner, undefined, 'sunk');
    if (c >= 0) return c;
  }
  return bestTileIn(world, gang, owner);
}

/**
 * The gang's affinity map (0..1 per tile, §3.3 plus the expansion terms of EXPANSION §8.4),
 * recomputed now. Shared scratch: valid until the next turf call. For tests and debug views.
 */
export function affinity(world: World, gang: GangId): Float32Array {
  const { affU, affK } = scratch(world.area);
  computeMaps(world);
  return gang === 'undertow' ? affU : affK;
}

/** Best seed tile for a gang now (−1 if none). Recomputes the affinity maps. */
export function bestTile(world: World, gang: GangId): number {
  computeMaps(world);
  return bestTileIn(world, gang, world.turf.owner);
}

/** Claim a 3×3 patch at `strength` around tile c (unowned or own tiles only, cap respected). */
function seedPatch(world: World, gang: GangId, c: number, strength: number, cap: number): number {
  const N = world.N;
  const { elig } = scratch(world.area);
  const t = world.turf;
  const code = gangCode(gang);
  const cx = c % N;
  const cy = (c / N) | 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      if (!elig[i]) continue;
      const o = t.owner[i];
      if (o === code) {
        if (t.str[i] < strength) t.str[i] = strength;
        n++;
      } else if (o === 0 && count[code] < cap) {
        t.owner[i] = code;
        t.str[i] = strength;
        count[code]++;
        n++;
      }
    }
  t.seeded[gang] = true;
  return n;
}

const SEED_NEWS: Record<GangId, string> = {
  undertow: 'Fresh tags in {d}: a hook and a wave.',
  kites: 'Fresh tags in {d}: a diamond kite, drawn in one line.',
};

function seedNews(world: World, gang: GangId, i: number, tagback: boolean): void {
  const N = world.N;
  const d = districtName(i % N, (i / N) | 0, world.seed, artOffset(world));
  const text = tagback
    ? `Tagback in ${d}: ${GANG_NEWS_NAME[gang]} paint over the wasps' work.`
    : SEED_NEWS[gang].replace('{d}', d);
  world.addNews(text, 'bad');
}

// ── Monthly update (§3.4) ───────────────────────────────────────────────────

/**
 * Monthly turf rules after the budget settles: contested decay, seeding, hold,
 * spread (skipped while frozen), tagback, scatter and crackdown expiry; then
 * refreshStats (layers, stats, seam, 'turf'). Uses and advances story.rng.
 */
export function update(world: World): void {
  const N = world.N;
  const { elig } = scratch(world.area);
  const tk = world.turf;
  const st = world.story;
  const tick = world.tick;
  const T = TURF;
  const owner = tk.owner;
  const con = tk.contested;
  const rng = new Rng(st.rng);
  // Before turf can form, nothing below reads the maps (no owner, no seeding, no tagback, no scatter).
  if (mapsNeeded(world)) monthMaps(world);
  countTiles(world);
  const cap = capFor(world);

  // Housekeeping: turf on tiles that stopped being eligible; contested countdown (owned land only: turf never forms
  // on a locked tile, MEGACITY §3.4).
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) {
      if (owner[i] && !elig[i]) free(world, i);
      if (con[i]) con[i] = con[i] > DAYS_PER_MONTH ? con[i] - DAYS_PER_MONTH : 0;
    }
  });

  // Seeding (§3.2).
  for (const g of GANG_IDS) {
    if (tk.seeded[g] || world.maxPopulation < T.seedPop[g]) continue;
    const c = seedTile(world, g, owner);
    if (c < 0) continue;
    seedPatch(world, g, c, T.seedStr, cap);
    seedNews(world, g, c, false);
  }

  if (!(tk.frozenUntil > tick)) {
    hold(world);
    spread(world, rng, cap);
  }

  // Tagback (§3.2): a seeded gang under reseedBelow tiles for reseedDays re-seeds.
  for (const g of GANG_IDS) {
    if (!tk.seeded[g]) continue;
    const code = gangCode(g);
    if (count[code] >= T.reseedBelow) {
      tk.lowSince[g] = -1;
      continue;
    }
    if (tk.lowSince[g] < 0) tk.lowSince[g] = tick;
    else if (tick - tk.lowSince[g] >= T.reseedDays) {
      const c = bestTileIn(world, g, owner);
      if (c >= 0) {
        seedPatch(world, g, c, T.seedStr, cap);
        seedNews(world, g, c, true);
      }
      tk.lowSince[g] = -1;
    }
  }

  // Scatter (§3.6) and crackdown expiry (turf.ts owns story.crackdowns' lifetime).
  const C = T.crackdown;
  const cds = st.crackdowns;
  let secAvg = -1;
  for (const c of cds) {
    if (c.scatterAt < 0 || c.scatterAt > tick) continue;
    c.scatterAt = -1;
    if (secAvg < 0) secAvg = securityAvg(world);
    if (secAvg >= C.scatterSecurity) continue;
    const r2 = c.r * c.r;
    const inZone = (i: number) => {
      const dx = (i % N) + 0.5 - c.x;
      const dy = ((i / N) | 0) + 0.5 - c.y;
      return dx * dx + dy * dy <= r2;
    };
    for (const g of c.hit) {
      const lost = (c.base?.[g] ?? 0) - count[gangCode(g)];
      if (lost < C.scatterLoss) continue;
      const at = bestTileIn(world, g, owner, inZone);
      if (at < 0) continue;
      seedPatch(world, g, at, C.scatterStr, cap);
      seedNews(world, g, at, true);
    }
  }
  for (let k = cds.length - 1; k >= 0; k--) {
    const c = cds[k];
    if (c.until < tick && c.scatterAt < 0) cds.splice(k, 1);
  }

  st.rng = rng.state;
  refreshStats(world);
}

/** Rule 1, hold: str += round((aff − 0.35) × 40), security / ribbon / crackdown hits, protection floor. */
function hold(world: World): void {
  const { affU, affK, protU, protK, crack } = scratch(world.area);
  const tk = world.turf;
  const owner = tk.owner;
  const str = tk.str;
  const sec = world.fields.security;
  const rail = world.rail;
  const T = TURF;
  const pivot = T.holdPivot;
  const gain = T.holdGain;
  const secHard = T.securityHard;
  const secPen = T.securityPenalty;
  const railHit = RIBBON.turfHit;
  const floor = T.protectFloor;
  const crackHit = T.crackdown.monthly;
  const anyCrack = computeCrack(world);
  const segs = world.segs;
  for (let sg = 0; sg < world.segCount; sg += 2)
  for (let i = segs[sg], e = segs[sg + 1]; i < e; i++) {
    const o = owner[i];
    if (!o) continue;
    const s0 = str[i];
    let d = Math.round(((o === U ? affU[i] : affK[i]) - pivot) * gain);
    if (sec[i] >= secHard) d -= secPen;
    if (o === U && rail[i]) d -= railHit;
    let v = s0 + d;
    if (d < 0 && (o === U ? protU[i] : protK[i])) {
      const f = s0 < floor ? s0 : floor;
      if (v < f) v = f;
    }
    if (anyCrack && crack[i]) v -= crackHit; // a crackdown still hits protected tiles
    if (v <= 0) free(world, i);
    else str[i] = v > 100 ? 100 : v;
  }
}

/** Rule 2, spread: tiles with str ≥ 50, in shuffled order, each try one random 4-neighbour. */
function spread(world: World, rng: Rng, cap: number): void {
  const N = world.N;
  const area = world.area;
  const { elig, affU, affK, pactBlock, list } = scratch(world.area);
  const tk = world.turf;
  const owner = tk.owner;
  const str = tk.str;
  const con = tk.contested;
  const rail = world.rail;
  const T = TURF;
  const spreadMin = T.spreadMin;
  let n = 0;
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) if (owner[i] && str[i] >= spreadMin) list[n++] = i;
  });
  if (!n) return;
  for (let k = n - 1; k > 0; k--) {
    const j = Math.floor(rng.next() * (k + 1));
    const t = list[k];
    list[k] = list[j];
    list[j] = t;
  }
  const base = world.mods.turfSpreadMul;
  const chance = [0, 0, 0];
  const limited = [false, false, false];
  const noLimits = !!rules(world)?.pactNoLimits;
  for (const g of GANG_IDS) {
    const code = gangCode(g);
    const tr = tier(world, g);
    const mul = base * (tr === 'cold' || tr === 'hostile' ? T.coldSpreadMul : 1);
    chance[code] = Math.min(1, T.claimChance * mul);
    limited[code] = !noLimits && pactActive(world, g);
  }
  const claimAff = T.claimAff;
  const claimStr = T.claimStr;
  for (let k = 0; k < n; k++) {
    const i = list[k];
    const o = owner[i];
    if (!o || str[i] < spreadMin) continue;
    const x = i % N;
    const dir = rng.int(0, 3);
    let j: number;
    if (dir === 0) j = i >= N ? i - N : -1;
    else if (dir === 1) j = x < N - 1 ? i + 1 : -1;
    else if (dir === 2) j = i < area - N ? i + N : -1;
    else j = x > 0 ? i - 1 : -1;
    if (j < 0) continue;
    const oj = owner[j];
    if (oj === 0) {
      if (!elig[j] || rail[j]) continue;
      if ((o === U ? affU[j] : affK[j]) < claimAff) continue;
      if (count[o] >= cap) continue;
      if (limited[o] && pactBlock[j]) continue;
      if (rng.next() >= chance[o]) continue;
      owner[j] = o;
      str[j] = claimStr;
      count[o]++;
    } else if (oj !== o) {
      // Contested: the defender loses 15, the source 5; at ≤ 0 the tile flips at 20.
      const sv = str[i] - T.contestCost;
      str[i] = sv > 0 ? sv : 1;
      con[j] = T.contestDays;
      const dv = str[j] - T.contestHit;
      if (dv > 0) str[j] = dv;
      else if (count[o] < cap) {
        count[oj]--;
        owner[j] = o;
        str[j] = T.flipStr;
        count[o]++;
      } else free(world, j);
    }
  }
}

// ── Derived data ────────────────────────────────────────────────────────────

/**
 * Rebuild derived turf data without running any rules: turf.stats, story.seam,
 * world.layerParts.turf (§3.5), then composeLayers and emit 'turf'. Call after
 * load, crackdowns, pacts and any direct turf edit.
 */
export function refreshStats(world: World): void {
  const tk = world.turf;
  const owner = tk.owner;
  const str = tk.str;
  const con = tk.contested;
  const sec = world.fields.security;
  const st = tk.stats;
  const securedAt = TURF.securedAt;
  let tu = 0;
  let tkit = 0;
  let su = 0;
  let sk = 0;
  let bu = -1;
  let bk = -1;
  let contested = 0;
  const segs = world.segs;
  for (let sg = 0; sg < world.segCount; sg += 2)
  for (let i = segs[sg], e = segs[sg + 1]; i < e; i++) {
    const o = owner[i];
    if (!o) continue;
    const secured = sec[i] >= securedAt;
    if (con[i]) contested++;
    if (o === U) {
      tu++;
      if (secured) su++;
      if (bu < 0 || str[i] > str[bu]) bu = i;
    } else {
      tkit++;
      if (secured) sk++;
      if (bk < 0 || str[i] > str[bk]) bk = i;
    }
  }
  st.tiles.undertow = tu;
  st.tiles.kites = tkit;
  st.secured.undertow = tu ? su / tu : 0;
  st.secured.kites = tkit ? sk / tkit : 0;
  st.strongest.undertow = bu;
  st.strongest.kites = bk;
  st.contested = contested;
  if (tu && tkit) computeSeam(world);
  writeLayers(world);
  composeLayers(world);
  world.events.emit('turf');
}

/** The turf partial layers (§3.5) plus the Tidemarket crime disc. */
function writeLayers(world: World): void {
  const N = world.N;
  const L = world.layerParts.turf;
  resetLayers(L);
  const tk = world.turf;
  const owner = tk.owner;
  const str = tk.str;
  const con = tk.contested;
  const tiles = world.tiles;
  const T = TURF;
  const tcm = world.mods.turfCrimeMul;
  const crimeMul = [0, 0, 0];
  const skim = [0, 0, 0];
  const abandon = [1, 1, 1];
  for (const g of GANG_IDS) {
    const code = gangCode(g);
    const pact = pactActive(world, g);
    const s = standing(world, g);
    const allied = s >= STANDING.allied;
    crimeMul[code] = T.crimePerStr * tcm * (pact ? T.pactCrimeMul : 1) * (allied ? T.alliedCrimeMul : 1);
    skim[code] = pact ? 0 : T.taxSkim;
    abandon[code] = allied ? T.abandon.allied : s < STANDING.friendly ? T.abandon.notFriendly : 1;
  }
  const contestCrime = T.contestCrime;
  const resLv = T.resLvPerStr;
  const segs = world.segs;
  for (let sg = 0; sg < world.segCount; sg += 2)
  for (let i = segs[sg], e = segs[sg + 1]; i < e; i++) {
    const o = owner[i];
    if (!o) continue;
    const s = str[i] / 100;
    L.crimeAdd[i] = crimeMul[o] * s + (con[i] ? contestCrime : 0);
    if (tiles[i].zone === RES) L.lvAdd[i] = resLv * s;
    if (skim[o]) L.taxMul[i] = 1 - skim[o] * s;
    L.abandonMul[i] = abandon[o];
  }
  // Tidemarket: crimeAdd +0.1 r5 (flat disc from the footprint centre).
  for (const b of world.buildings.values()) {
    if (b.type !== 'tidemarket') continue;
    const cx = b.x + b.size / 2;
    const cy = b.y + b.size / 2;
    const r = 5;
    const xa = Math.max(0, Math.floor(cx - r));
    const xb = Math.min(N - 1, Math.ceil(cx + r));
    const ya = Math.max(0, Math.floor(cy - r));
    const yb = Math.min(N - 1, Math.ceil(cy + r));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) L.crimeAdd[y * N + x] += 0.1;
      }
  }
}

/**
 * story.seam ← the midpoint tile of the closest Undertow–Kites tile pair.
 * Keeps the last value when either gang has no tiles. Returns the seam.
 */
export function computeSeam(world: World): number | null {
  const N = world.N;
  const { list } = scratch(world.area);
  const owner = world.turf.owner;
  let nu = 0;
  let nk = 0;
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) if (owner[i] === U) list[nu++] = i;
  });
  if (!nu) return world.story.seam;
  // Kites tiles go after the Undertow ones in the same scratch list.
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) if (owner[i] === K) list[nu + nk++] = i;
  });
  if (!nk) return world.story.seam;
  // The seam is the midpoint of the first pair (Undertow order, then Kites order) at the smallest squared distance.
  // Small cities compare every pair; big ones (MEGACITY: two gangs of 8,000 tiles are 64 M pairs) find the smallest
  // distance with an exact squared distance transform of the Kites tiles, then that pair: the same answer.
  const pair = nu * nk <= SEAM_PAIRS ? seamPairs(list, nu, nk, N) : seamTransform(world, list, nu, nk);
  const a = pair[0];
  const b = pair[1];
  const mx = Math.round(((a % N) + (b % N)) / 2);
  const my = Math.round((((a / N) | 0) + ((b / N) | 0)) / 2);
  world.story.seam = my * N + mx;
  return world.story.seam;
}

/** Pair counts up to which computeSeam compares every pair (≈ 0.1 ms in Node). */
const SEAM_PAIRS = 1 << 16;
const SEAM_OUT: [number, number] = [-1, -1];

/** Every pair, in order: the first pair at the smallest squared distance (two tiles are at least 1 apart). */
function seamPairs(list: Int32Array, nu: number, nk: number, N: number): [number, number] {
  let best = Infinity;
  let a = -1;
  let b = -1;
  for (let p = 0; p < nu; p++) {
    const i = list[p];
    const ix = i % N;
    const iy = (i / N) | 0;
    for (let q = nu; q < nu + nk; q++) {
      const j = list[q];
      const dx = (j % N) - ix;
      const dy = ((j / N) | 0) - iy;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        a = i;
        b = j;
        if (d <= 1) break;
      }
    }
    if (best <= 1) break;
  }
  SEAM_OUT[0] = a;
  SEAM_OUT[1] = b;
  return SEAM_OUT;
}

/** Squared distance transform scratch (one per frame size). */
const seamScratch = scratchFor((area) => {
  const n = Math.round(Math.sqrt(area));
  return { g: new Float64Array(area), f: new Float64Array(n), v: new Int32Array(n), z: new Float64Array(n + 1), d: new Float64Array(n) };
});
const FAR = 1e9;

/**
 * The same pair as seamPairs: the exact squared Euclidean distance from every tile of the owned box to the nearest
 * Kites tile (Felzenszwalb and Huttenlocher's lower envelope, columns then rows; integer inputs keep it exact), the
 * first Undertow tile at the smallest of those, then the first Kites tile at that distance from it.
 */
function seamTransform(world: World, list: Int32Array, nu: number, nk: number): [number, number] {
  const N = world.N;
  const box = world.ownedBox;
  const owner = world.turf.owner;
  const S = seamScratch(world.area);
  const { g, f, v, z, d } = S;
  // Columns: the distance to the nearest Kites tile above or below, squared.
  for (let x = box.x0; x <= box.x1; x++) {
    let last = -FAR;
    for (let y = box.y0; y <= box.y1; y++) {
      const i = y * N + x;
      if (owner[i] === K) last = y;
      g[i] = y - last;
    }
    last = FAR;
    for (let y = box.y1; y >= box.y0; y--) {
      const i = y * N + x;
      if (owner[i] === K) last = y;
      const u = Math.min(g[i], last - y);
      g[i] = u >= FAR / 2 ? FAR : u * u;
    }
  }
  // Rows: the lower envelope of the column parabolas, written back into g.
  const w = box.x1 - box.x0 + 1;
  for (let y = box.y0; y <= box.y1; y++) {
    const row = y * N + box.x0;
    let k = -1;
    for (let q = 0; q < w; q++) {
      const fq = g[row + q];
      f[q] = fq;
      if (fq >= FAR) continue;
      if (k < 0) {
        k = 0;
        v[0] = q;
        z[0] = -Infinity;
        z[1] = Infinity;
        continue;
      }
      let s = (fq + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
      while (s <= z[k]) {
        k--;
        s = (fq + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    if (k < 0) {
      for (let q = 0; q < w; q++) g[row + q] = FAR;
      continue;
    }
    let j = 0;
    for (let q = 0; q < w; q++) {
      while (z[j + 1] < q) j++;
      const p = v[j];
      d[q] = (q - p) * (q - p) + f[p];
    }
    for (let q = 0; q < w; q++) g[row + q] = d[q];
  }
  let best = Infinity;
  let a = -1;
  for (let p = 0; p < nu; p++) {
    const t = g[list[p]];
    if (t < best) {
      best = t;
      a = list[p];
      if (t <= 1) break;
    }
  }
  const ax = a % N;
  const ay = (a / N) | 0;
  for (let q = nu; q < nu + nk; q++) {
    const j = list[q];
    const dx = (j % N) - ax;
    const dy = ((j / N) | 0) - ay;
    if (dx * dx + dy * dy === best) {
      SEAM_OUT[0] = a;
      SEAM_OUT[1] = j;
      return SEAM_OUT;
    }
  }
  // Unreachable with exact arithmetic; keep the plain answer if it ever happens.
  return seamPairs(list, nu, nk, N);
}

/** Street take (§3.5): 4 CR × s per developed turf tile per month, for one gang. */
export function streetTake(world: World, gang: GangId): number {
  const owner = world.turf.owner;
  const str = world.turf.str;
  const tiles = world.tiles;
  const code = gangCode(gang);
  let s = 0;
  forOwned(world, (a, e) => {
    for (let i = a; i < e; i++) {
      if (owner[i] !== code) continue;
      const t = tiles[i];
      if (t.zone === 0 || t.level === 0 || t.abandoned) continue;
      s += str[i];
    }
  });
  return (TURF.streetTake * s) / 100;
}

/**
 * Your 40% cut of the street take of every gang under a pact (§3.6), for the
 * director's monthly "Off-ledger" income line. 0 under an `endOffLedger` ending.
 */
export function pactCut(world: World): number {
  if (rules(world)?.endOffLedger) return 0;
  let c = 0;
  for (const g of GANG_IDS) if (pactActive(world, g)) c += streetTake(world, g) * TURF.pactCut;
  return c;
}

/**
 * resolveMods source 5 (§3.5): per 100 Undertow tiles demandInd +0.04, per 100
 * Kites tiles demandCom +0.04. Also each active pact's city-wide mods (§3.6):
 * traceMonthly +1, and favor drift Board −1/mo (Salt Pact) / Nacre −1/mo (String
 * Pact). The String Pact's trafficMul is a timed mod in its deal, not here.
 */
export function turfPatch(world: World): ModPatch {
  const t = world.turf.stats.tiles;
  // Per owned district (MEGACITY §3.3): one district is unchanged, a gang at its cap over nine adds what it does today.
  const per = TURF.demandPer100 / Math.max(1, world.districts.owned.length);
  const p: ModPatch = {};
  if (t.undertow > 0) p.demandInd = (per * t.undertow) / 100;
  if (t.kites > 0) p.demandCom = (per * t.kites) / 100;
  const P = TURF.pact;
  let trace = 0;
  if (pactActive(world, 'undertow')) {
    trace += P.traceMonthly;
    p.favorMonthly = { ...p.favorMonthly, board: -P.favorDrift };
  }
  if (pactActive(world, 'kites')) {
    trace += P.traceMonthly;
    p.favorMonthly = { ...p.favorMonthly, nacre: -P.favorDrift };
  }
  if (trace) p.traceMonthly = trace;
  return p;
}

// ── Ops for story effects (§10.3 `turf`). Each refreshes derived data. ──────

/** Where a turf op lands: a disc around a tile (Euclidean, tile centres), the whole city, or explicit tiles. */
export type TurfArea = { x: number; y: number; r: number } | 'city' | readonly number[];

function forArea(world: World, where: TurfArea, fn: (i: number) => void): void {
  const N = world.N;
  const area = world.area;
  if (where === 'city') {
    for (let i = 0; i < area; i++) fn(i);
    return;
  }
  if (Array.isArray(where)) {
    for (const i of where as readonly number[]) if (i >= 0 && i < area) fn(i);
    return;
  }
  const { x, y, r } = where as { x: number; y: number; r: number };
  if (!(r >= 0) || r >= N * 2) {
    for (let i = 0; i < area; i++) fn(i);
    return;
  }
  const xa = Math.max(0, Math.floor(x - r));
  const xb = Math.min(N - 1, Math.ceil(x + r));
  const ya = Math.max(0, Math.floor(y - r));
  const yb = Math.min(N - 1, Math.ceil(y + r));
  const r2 = r * r;
  for (let yy = ya; yy <= yb; yy++)
    for (let xx = xa; xx <= xb; xx++) {
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy <= r2) fn(yy * N + xx);
    }
}

const matches = (o: number, gang: GangId | 'all') => (gang === 'all' ? o !== 0 : o === gangCode(gang));

/** `turf seed`: claim a 3×3 patch at `strength` around (x, y) for the gang. Returns tiles held. */
export function seedGang(world: World, gang: GangId, x: number, y: number, strength: number = TURF.seedStr): number {
  const N = world.N;
  if (!world.inBounds(x, y)) return 0;
  computeMaps(world);
  countTiles(world);
  const n = seedPatch(world, gang, y * N + x, Math.max(1, Math.min(100, Math.round(strength))), capFor(world));
  refreshStats(world);
  return n;
}

/** `turf str`: add `v` (may be negative) to that gang's tiles (or both) in the area. Freed at ≤ 0. */
export function addStrength(world: World, gang: GangId | 'all', area: TurfArea, v: number, refresh = true): number {
  const tk = world.turf;
  countTiles(world);
  let n = 0;
  forArea(world, area, (i) => {
    const o = tk.owner[i];
    if (!matches(o, gang)) return;
    n++;
    const s = tk.str[i] + Math.round(v);
    if (s <= 0) free(world, i);
    else tk.str[i] = s > 100 ? 100 : s;
  });
  if (refresh && n) refreshStats(world);
  return n;
}

/** `turf clear`: free that gang's tiles (or both) in the area. */
export function clearTurf(world: World, gang: GangId | 'all', area: TurfArea): number {
  const tk = world.turf;
  countTiles(world);
  let n = 0;
  forArea(world, area, (i) => {
    if (!matches(tk.owner[i], gang)) return;
    free(world, i);
    n++;
  });
  if (n) refreshStats(world);
  return n;
}

/** `turf flip`: hand `from`'s tiles in the area to `to`, keeping strength (tiles over `to`'s cap are freed). */
export function flipTurf(world: World, from: GangId, to: GangId, area: TurfArea): number {
  if (from === to) return 0;
  const tk = world.turf;
  const a = gangCode(from);
  const b = gangCode(to);
  countTiles(world);
  const cap = capFor(world);
  let n = 0;
  forArea(world, area, (i) => {
    if (tk.owner[i] !== a) return;
    if (count[b] >= cap) {
      free(world, i);
      return;
    }
    count[a]--;
    tk.owner[i] = b;
    count[b]++;
    n++;
  });
  if (n) tk.seeded[to] = true;
  refreshStats(world);
  return n;
}

/** `turf freeze`: the Seam Truce. Rules 1 and 2 are skipped until tick + days. */
export function freezeTurf(world: World, days: number): void {
  world.turf.frozenUntil = Math.max(world.turf.frozenUntil, world.tick + Math.max(0, Math.round(days)));
}

/** Ch3 start: seed any gang that hasn't seeded yet, at its best tile. Returns the gangs seeded. */
export function forceSeed(world: World): GangId[] {
  const tk = world.turf;
  const out: GangId[] = [];
  computeMaps(world);
  countTiles(world);
  const cap = capFor(world);
  for (const g of GANG_IDS) {
    if (tk.seeded[g]) continue;
    const c = bestTileIn(world, g, tk.owner);
    if (c < 0) continue;
    seedPatch(world, g, c, TURF.seedStr, cap);
    seedNews(world, g, c, false);
    out.push(g);
  }
  refreshStats(world);
  return out;
}

/** Tiles of each gang within a disc (crackdown preview / zone counts). */
export function tilesInDisc(world: World, cx: number, cy: number, r: number): Record<GangId, number> {
  const N = world.N;
  const owner = world.turf.owner;
  const out = { undertow: 0, kites: 0 };
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(N - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(N - 1, Math.ceil(cy + r));
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const o = owner[y * N + x];
      if (o === U) out.undertow++;
      else if (o === K) out.kites++;
    }
  return out;
}

/** Hit every turf tile in a disc by `v` (crackdown: hits protected tiles too). No refresh. */
export function hitDisc(world: World, cx: number, cy: number, r: number, v: number): number {
  const N = world.N;
  const tk = world.turf;
  countTiles(world);
  let n = 0;
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(N - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(N - 1, Math.ceil(cy + r));
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const i = y * N + x;
      if (!tk.owner[i]) continue;
      n++;
      const s = tk.str[i] - v;
      if (s <= 0) free(world, i);
      else tk.str[i] = s;
    }
  return n;
}

/** Tiles each gang holds (fresh count, independent of turf.stats). */
export function gangTiles(world: World): Record<GangId, number> {
  countTiles(world);
  return { undertow: count[U], kites: count[K] };
}

/** Owner gang of a tile, or null. */
export function ownerAt(world: World, x: number, y: number): GangId | null {
  const N = world.N;
  if (!world.inBounds(x, y)) return null;
  const o = world.turf.owner[y * N + x];
  return o ? gangOf(o) : null;
}

/** Is this tile eligible to hold turf (§3.1)? */
export function isEligible(world: World, x: number, y: number): boolean {
  const N = world.N;
  return world.inBounds(x, y) && eligibleAt(world, y * N + x);
}
