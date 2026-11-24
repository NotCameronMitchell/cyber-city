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

import { completeStage } from '../buildingStats';
import { CROWNS, GANG_IDS, GANG_NEWS_NAME, RIBBON, STANDING, TURF, TURF_OWNER } from '../config';
import { capitalizeFirst, districtName } from '../news';
import { Rng } from '../rng';
import { scratchFor } from '../frame';
import { DAYS_PER_MONTH, RoadKind, Terrain, ZoneType, type BuildingType } from '../types';
import type { World } from '../world';
import { standing, tier } from './factions';
import { composeLayers, resetLayers } from './mods';
import type { EndingRules, GangId, ModPatch } from './types';
import { spanMask, tallMask } from './vertical';

const WATER = Terrain.Water;
const RES = ZoneType.Residential;
const COM = ZoneType.Commercial;
const IND = ZoneType.Industrial;
const U = 1; // TURF_OWNER.undertow
const K = 2; // TURF_OWNER.kites
/** Building types whose footprint keeps turf (§3.1). */
const KEEPS_TURF: ReadonlySet<BuildingType> = new Set<BuildingType>(['tidemarket', 'roost']);

// ── Scratch (module-level, reused; one set per frame size, MEGACITY §3.1) ───
const scratch = scratchFor((area) => ({
  elig: new Uint8Array(area),
  nearCity: new Uint8Array(area),
  affU: new Float32Array(area),
  affK: new Float32Array(area),
  protU: new Uint8Array(area),
  protK: new Uint8Array(area),
  pactBlock: new Uint8Array(area),
  crack: new Uint8Array(area),
  mA: new Uint8Array(area),
  mB: new Uint8Array(area),
  mC: new Uint8Array(area),
  mD: new Uint8Array(area),
  /** Expansion indicators (EXPANSION §8.4): back alley, seaport footprint, skyway deck. */
  mAlley: new Uint8Array(area),
  mSea: new Uint8Array(area),
  mSky: new Uint8Array(area),
  tmp: new Uint8Array(area),
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

/** Binary Chebyshev dilation (separable sliding window, O(area)) on an N×N map. `src` may equal `out`; `tmp` may not. */
function dilate(src: Uint8Array, r: number, out: Uint8Array, tmp: Uint8Array, N: number): Uint8Array {
  if (r <= 0) {
    if (out !== src) out.set(src);
    return out;
  }
  for (let y = 0; y < N; y++) {
    const row = y * N;
    let c = 0;
    for (let x = 0; x <= r && x < N; x++) c += src[row + x];
    for (let x = 0; x < N; x++) {
      tmp[row + x] = c > 0 ? 1 : 0;
      const xo = x - r;
      if (xo >= 0) c -= src[row + xo];
      const xi = x + r + 1;
      if (xi < N) c += src[row + xi];
    }
  }
  for (let x = 0; x < N; x++) {
    let c = 0;
    for (let y = 0; y <= r && y < N; y++) c += tmp[y * N + x];
    for (let y = 0; y < N; y++) {
      out[y * N + x] = c > 0 ? 1 : 0;
      const yo = y - r;
      if (yo >= 0) c -= tmp[yo * N + x];
      const yi = y + r + 1;
      if (yi < N) c += tmp[yi * N + x];
    }
  }
  return out;
}

function fillRect(a: Uint8Array, x0: number, y0: number, x1: number, y1: number, N: number): void {
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > N - 1) x1 = N - 1;
  if (y1 > N - 1) y1 = N - 1;
  for (let y = y0; y <= y1; y++) a.fill(1, y * N + x0, y * N + x1 + 1);
}

/** Eligible turf tile: land, no building except a Tidemarket or Kite Roost (§3.1). */
function eligibleAt(world: World, i: number): boolean {
  const t = world.tiles[i];
  if (t.terrain === WATER) return false;
  if (t.buildingId < 0) return true;
  const b = world.buildings.get(t.buildingId);
  return !!b && KEEPS_TURF.has(b.type);
}

/**
 * Rebuild eligibility, the near-city mask, both affinity maps (§3.3), the
 * protection masks and the pact spread block. ~0.3 ms on a full map.
 */
function computeMaps(world: World): void {
  const N = world.N;
  const area = world.area;
  const { elig, nearCity, affU, affK, protU, protK, pactBlock, mA, mB, mC, mD, mAlley, mSea, mSky, tmp } = scratch(world.area);
  const tiles = world.tiles;
  const f = world.fields;
  const rail = world.rail;
  const sky = world.sky;
  const A = TURF.affinity;
  const au = A.undertow;
  const ak = A.kites;
  // Indicators. mA abandoned, mB water, mC ribbon, mD city presence; mAlley back alley,
  // mSky skyway deck, mSea seaport footprint (expansion, §8.4).
  mSea.fill(0);
  for (let i = 0; i < area; i++) {
    const t = tiles[i];
    const water = t.terrain === WATER;
    elig[i] = water ? 0 : 1;
    mA[i] = t.abandoned ? 1 : 0;
    mB[i] = water ? 1 : 0;
    mC[i] = rail[i] ? 1 : 0;
    mD[i] = t.road || (t.zone !== 0 && t.level > 0) || t.buildingId >= 0 ? 1 : 0;
    mAlley[i] = t.road && t.roadKind === RoadKind.Alley ? 1 : 0;
    mSky[i] = sky[i] !== 0 ? 1 : 0;
  }
  dilate(mD, 3, nearCity, tmp, N);
  protU.fill(0);
  protK.fill(0);
  pactBlock.fill(0);
  const P = TURF.protect;
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
      }
    } else if (b.type === 'spire' || b.type === 'arcology') {
      const r = TURF.pact.noSpreadRadius;
      fillRect(pactBlock, b.x - r, b.y - r, x1 + r, y1 + r, N);
    } else if (b.type === 'seaport') fillRect(mSea, b.x, b.y, x1, y1, N);
  }
  const lvBlock = TURF.pact.noSpreadLandValue;
  for (let i = 0; i < area; i++) if (f.landValue[i] >= lvBlock) pactBlock[i] = 1;

  // Undertow: abandoned within 1 (mA), water within 3 (mB), ribbon within 1 (mC),
  // alley within 1 (mAlley) and a seaport footprint within 6 (mSea).
  dilate(mA, au.abandonedRadius, mA, tmp, N);
  dilate(mB, au.waterRadius, mB, tmp, N);
  dilate(mC, au.ribbonRadius, mC, tmp, N);
  dilate(mSea, au.seaportRadius, mSea, tmp, N);
  // The alley indicator is dilated once at the Undertow radius; the Kites' radius is the same
  // (both 1, TURF.affinity), and if they ever differ the Kites term re-dilates below.
  dilate(mAlley, au.alleyRadius, mAlley, tmp, N);
  const crime = f.crime;
  const pol = f.pollution;
  const lv = f.landValue;
  const sec = f.security;
  for (let i = 0; i < area; i++) {
    const t = tiles[i];
    let v =
      au.base +
      au.crime * crime[i] +
      au.pollution * pol[i] +
      au.lowLandValue * (1 - lv[i]) +
      au.abandonedNear * mA[i] +
      au.waterNear * mB[i] +
      (t.zone === IND ? au.fab : 0) +
      au.security * sec[i] +
      au.ribbonNear * mC[i] +
      au.alleyNear * mAlley[i] +
      au.seaportNear * mSea[i];
    affU[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // Kites: tall anchor within 3 or active span within 1 (mA), Glarewall within 4 (mB).
  tallMask(world, mA);
  dilate(mA, ak.tallRadius, mA, tmp, N);
  spanMask(world, mC);
  dilate(mC, ak.spanRadius, mC, tmp, N);
  mB.fill(0);
  for (const b of world.buildings.values()) {
    if (b.type === 'glarewall') fillRect(mB, b.x, b.y, b.x + b.size - 1, b.y + b.size - 1, N);
  }
  dilate(mB, ak.glarewallRadius, mB, tmp, N);
  // Alley within 1 (mAlley; re-dilated only if the radii differ) and a skyway deck within 1 (mSky).
  if (ak.alleyRadius !== au.alleyRadius) {
    for (let i = 0; i < area; i++) {
      const t = tiles[i];
      mAlley[i] = t.road && t.roadKind === RoadKind.Alley ? 1 : 0;
    }
    dilate(mAlley, ak.alleyRadius, mAlley, tmp, N);
  }
  dilate(mSky, ak.skywayRadius, mSky, tmp, N);
  const traffic = f.traffic;
  const net = f.net;
  for (let i = 0; i < area; i++) {
    const t = tiles[i];
    const dense = !t.abandoned && ((t.zone === COM && t.level >= 2) || (t.zone === RES && t.level === 3)) ? 1 : 0;
    // Highways and their ramps carry the city's through traffic: no Kites magnet there (§8.4).
    const busy = t.road && (t.roadKind === RoadKind.Highway || t.roadKind === RoadKind.Ramp) ? 0 : traffic[i];
    let v =
      ak.base +
      ak.crime * crime[i] +
      ak.traffic * busy +
      ak.net * net[i] +
      ak.dense * dense +
      ak.tallNear * (mA[i] | mC[i]) +
      ak.security * sec[i] +
      ak.glarewallNear * mB[i] +
      ak.alleyNear * mAlley[i] +
      ak.skywayNear * mSky[i];
    affK[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
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
  const area = world.area;
  const owner = world.turf.owner;
  count[0] = count[1] = count[2] = 0;
  for (let i = 0; i < area; i++) count[owner[i]]++;
}

/** Land (non-water) tiles: the cap and `turf.share` denominators. */
export function landTiles(world: World): number {
  const area = world.area;
  let n = 0;
  const tiles = world.tiles;
  for (let i = 0; i < area; i++) if (tiles[i].terrain !== WATER) n++;
  return n;
}

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
  const area = world.area;
  const tiles = world.tiles;
  const sec = world.fields.security;
  let s = 0;
  let n = 0;
  for (let i = 0; i < area; i++) {
    const t = tiles[i];
    if (t.zone === 0 || t.level === 0 || t.abandoned) continue;
    s += sec[i];
    n++;
  }
  return n ? s / n : 0;
}

// ── Seeding ─────────────────────────────────────────────────────────────────

/**
 * Best seed tile for a gang: the highest-affinity unowned eligible tile near the
 * city (a road or development within 3), else anywhere. Ties keep the lowest
 * index. `skip(i)` excludes tiles (scatter: the crackdown zone). Needs computeMaps.
 */
function bestTileIn(world: World, gang: GangId, owner: Uint8Array, skip?: (i: number) => boolean): number {
  const area = world.area;
  const { elig, nearCity, affU, affK } = scratch(world.area);
  const aff = gang === 'undertow' ? affU : affK;
  let best = -1;
  let bestA = -1;
  let any = -1;
  let anyA = -1;
  for (let i = 0; i < area; i++) {
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
  return best >= 0 ? best : any;
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
  const d = districtName(i % N, (i / N) | 0, world.seed);
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
  const area = world.area;
  const { elig } = scratch(world.area);
  const tk = world.turf;
  const st = world.story;
  const tick = world.tick;
  const T = TURF;
  const owner = tk.owner;
  const con = tk.contested;
  const rng = new Rng(st.rng);
  computeMaps(world);
  countTiles(world);
  const cap = capFor(world);

  // Housekeeping: turf on tiles that stopped being eligible; contested countdown.
  for (let i = 0; i < area; i++) {
    if (owner[i] && !elig[i]) free(world, i);
    if (con[i]) con[i] = con[i] > DAYS_PER_MONTH ? con[i] - DAYS_PER_MONTH : 0;
  }

  // Seeding (§3.2).
  for (const g of GANG_IDS) {
    if (tk.seeded[g] || world.maxPopulation < T.seedPop[g]) continue;
    const c = bestTileIn(world, g, owner);
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
  const area = world.area;
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
  for (let i = 0; i < area; i++) {
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
  for (let i = 0; i < area; i++) if (owner[i] && str[i] >= spreadMin) list[n++] = i;
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
  const area = world.area;
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
  for (let i = 0; i < area; i++) {
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
  const area = world.area;
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
  for (let i = 0; i < area; i++) {
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
  const area = world.area;
  const { list } = scratch(world.area);
  const owner = world.turf.owner;
  let nu = 0;
  let nk = 0;
  for (let i = 0; i < area; i++) {
    if (owner[i] === U) list[nu++] = i;
  }
  if (!nu) return world.story.seam;
  // Kites tiles go after the Undertow ones in the same scratch list.
  for (let i = 0; i < area; i++) if (owner[i] === K) list[nu + nk++] = i;
  if (!nk) return world.story.seam;
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
  const mx = Math.round(((a % N) + (b % N)) / 2);
  const my = Math.round((((a / N) | 0) + ((b / N) | 0)) / 2);
  world.story.seam = my * N + mx;
  return world.story.seam;
}

/** Street take (§3.5): 4 CR × s per developed turf tile per month, for one gang. */
export function streetTake(world: World, gang: GangId): number {
  const area = world.area;
  const owner = world.turf.owner;
  const str = world.turf.str;
  const tiles = world.tiles;
  const code = gangCode(gang);
  let s = 0;
  for (let i = 0; i < area; i++) {
    if (owner[i] !== code) continue;
    const t = tiles[i];
    if (t.zone === 0 || t.level === 0 || t.abandoned) continue;
    s += str[i];
  }
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
  const per = TURF.demandPer100;
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
