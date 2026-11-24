// ─────────────────────────────────────────────────────────────────────────────
// Wealth tiers $ / $$ / $$$ (docs/EXPANSION.md §4): the city decides. One table
// (config WEALTH) drives every consumer through these helpers; the score is a
// pure function of world.fields and the tile, so the sim, the inspect panel and
// the lens all read the same number. Frozen after Step 0.
//
//   zoneCapacity / zoneTaxMul / zonePowerMul / zonePollution   per-tier effects (§4.4)
//   wealthScoreAt / wealthTerms                                the score (§4.2)
//   tierCap / potentialTier / stepTarget                       caps and hysteresis (§4.2, §4.3)
//   wealthInfo                                                 the inspect meter and notes (§4.5)
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, NOISE, POP_SCALE, WEALTH, zoneDefFor } from './config';
import { ZoneType, type WealthTier } from './types';
import type { World } from './world';

/** Display labels per tier. Never prefixed with a zone letter (§0 "IP and copy"). */
export const TIER_LABEL: readonly ['$', '$$', '$$$'] = ['$', '$$', '$$$'];

const tierOf = (t: number): WealthTier => (t >= 2 ? 2 : t >= 1 ? 1 : 0);
/** WEALTH.up / down as plain arrays (indexed by tier). */
const UP: readonly number[] = WEALTH.up;
const DOWN: readonly number[] = WEALTH.down;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Residents (Hab Blocks) or jobs (Market / Fab) a tile holds at this level and tier,
 * rounded to whole tens of people (POP_SCALE: the v3 build's whole people, so the Megacity
 * unit change is exact, MEGACITY §4.1; "1,430" not "1,425"). `affordable` (a $ Hab Block with an alley within 1, §4.4)
 * multiplies by WEALTH.affordable. At tier 0 without an alley this equals the old table.
 */
export function zoneCapacity(zone: ZoneType, level: number, tier: WealthTier | number, affordable = false): number {
  const zd = zoneDefFor(zone);
  if (!zd) return 0;
  const l = level < 0 ? 0 : level > 3 ? 3 : level | 0;
  const t = tierOf(tier);
  let mul = WEALTH.capacity[zone][t];
  if (affordable && zone === ZoneType.Residential && t === 0) mul *= WEALTH.affordable;
  return Math.round((zd.capacity[l] * mul) / POP_SCALE) * POP_SCALE;
}

/** Tax per resident / job multiplier. */
export function zoneTaxMul(zone: ZoneType, tier: WealthTier | number): number {
  return zone >= 1 && zone <= 3 ? WEALTH.tax[zone][tierOf(tier)] : 1;
}

/** Power draw multiplier. */
export function zonePowerMul(zone: ZoneType, tier: WealthTier | number): number {
  return zone >= 1 && zone <= 3 ? WEALTH.power[zone][tierOf(tier)] : 1;
}

/** Pollution a zone tile emits at this level and tier (only Fab Yards clean up with tier). */
export function zonePollution(zone: ZoneType, level: number, tier: WealthTier | number): number {
  const zd = zoneDefFor(zone);
  if (!zd) return 0;
  const l = level < 0 ? 0 : level > 3 ? 3 : level | 0;
  return zd.pollution[l] * WEALTH.pollution[zone][tierOf(tier)];
}

/** The signed parts of a tile's wealth score (§4.5): they sum to the unclamped score. */
export interface WealthTerms {
  /** Fab Yards' base (0.20); 0 for homes and shops. */
  base: number;
  /** Land value with its noise part moved into `noise` (homes and shops only). */
  landValue: number;
  education: number;
  transit: number;
  /** Airport business district (shops). */
  hub: number;
  /** Seaport trade (Fab). */
  sea: number;
  /** Data Hub coverage (Fab). */
  net: number;
  /** Score weight plus NOISE.lv (the land-value part), negative. */
  noise: number;
  /** Crime (Fab), negative. */
  crime: number;
}

export function blankTerms(): WealthTerms {
  return { base: 0, landValue: 0, education: 0, transit: 0, hub: 0, sea: 0, net: 0, noise: 0, crime: 0 };
}

/**
 * Break the score of tile `i` into signed parts (§4.2 / §4.5). Non-zone tiles get all zeros.
 * Homes:  landValue + 0.10·education + 0.06·transit − 0.20·noise
 * Shops:  landValue + 0.08·education + 0.08·transit + 0.12·hub − 0.10·noise
 * Fab:    0.20 + 0.35·education + 0.20·net + 0.12·transit + 0.10·sea − 0.30·crime
 * For homes and shops the land-value field already carries −NOISE.lv·noise; that part is
 * reported under `noise` so the parts still sum to the score.
 */
export function wealthTerms(world: World, i: number, out: WealthTerms = blankTerms()): WealthTerms {
  const f = world.fields;
  const z = world.tiles[i]?.zone ?? ZoneType.None;
  out.base = out.landValue = out.education = out.transit = out.hub = out.sea = out.net = out.noise = out.crime = 0;
  const noise = f.noise[i];
  if (z === ZoneType.Residential) {
    const s = WEALTH.score.res;
    out.landValue = f.landValue[i] + NOISE.lv * noise;
    out.education = s.edu * f.education[i];
    out.transit = s.transit * f.transit[i];
    out.noise = (s.noise - NOISE.lv) * noise;
  } else if (z === ZoneType.Commercial) {
    const s = WEALTH.score.com;
    out.landValue = f.landValue[i] + NOISE.lv * noise;
    out.education = s.edu * f.education[i];
    out.transit = s.transit * f.transit[i];
    out.hub = s.hub * f.hub[i];
    out.noise = (s.noise - NOISE.lv) * noise;
  } else if (z === ZoneType.Industrial) {
    const s = WEALTH.score.ind;
    out.base = s.base;
    out.education = s.edu * f.education[i];
    out.net = s.net * f.net[i];
    out.transit = s.transit * f.transit[i];
    out.sea = s.port * f.sea[i];
    out.crime = s.crime * f.crime[i];
  }
  return out;
}

const scratch = blankTerms();

/** Wealth score 0..1 of tile `i` (§4.2), from world.fields and the tile only. Non-zone tiles: 0. */
export function wealthScoreAt(world: World, i: number): number {
  const t = wealthTerms(world, i, scratch);
  return clamp01(t.base + t.landValue + t.education + t.transit + t.hub + t.sea + t.net + t.noise + t.crime);
}

/**
 * Highest tier the conditions allow (§4.2). Homes and shops: ≤ $ while crime ≥ midMaxCrime;
 * ≤ $$ while crime ≥ highMaxCrime, noise ≥ highMaxNoise or pollution ≥ highMaxPollution;
 * homes beside an alley ≤ $$ (affordable quarter). Fab: ≤ $$ while crime ≥ indHighMaxCrime.
 */
export function tierCap(zone: ZoneType, crime: number, noise: number, pollution: number, alleyNear: boolean | number): WealthTier {
  const c = WEALTH.caps;
  if (zone === ZoneType.Industrial) return crime >= c.indHighMaxCrime ? 1 : 2;
  if (zone !== ZoneType.Residential && zone !== ZoneType.Commercial) return 0;
  if (crime >= c.midMaxCrime) return 0;
  let cap: WealthTier = 2;
  if (crime >= c.highMaxCrime || noise >= c.highMaxNoise || pollution >= c.highMaxPollution) cap = 1;
  if (zone === ZoneType.Residential && alleyNear && cap > c.alleyMaxTier) cap = c.alleyMaxTier as WealthTier;
  return cap;
}

/** Tier the score alone points at (no hysteresis), capped: lots and the lens (§4.2). */
export function potentialTier(zone: ZoneType, score: number, cap: WealthTier | number): WealthTier {
  if (zone === ZoneType.None) return 0;
  const p = score >= WEALTH.up[1] ? 2 : score >= WEALTH.up[0] ? 1 : 0;
  return tierOf(Math.min(p, cap));
}

/**
 * Direction a developed tile's tier wants to move this evaluation (§4.3): +1 when the score
 * clears the next tier's `up` threshold and the cap allows it, −1 when it falls below the
 * `down` threshold or the cap no longer allows the current tier, else 0 (inside the band).
 */
export function stepTarget(zone: ZoneType, tier: WealthTier | number, score: number, cap: WealthTier | number): -1 | 0 | 1 {
  if (zone === ZoneType.None) return 0;
  const t = tierOf(tier);
  if (t < 2 && score >= UP[t] && cap > t) return 1;
  if (t > 0 && (score < DOWN[t - 1] || cap < t)) return -1;
  return 0;
}

/** The cap of tile `i` from the live fields. */
export function tierCapAt(world: World, i: number): WealthTier {
  const f = world.fields;
  return tierCap(world.tiles[i].zone, f.crime[i], f.noise[i], f.pollution[i], f.alleyNear[i]);
}

/** Inspect data for a zone tile (§4.5). */
export interface WealthInfo {
  tier: WealthTier;
  potential: WealthTier;
  /** An empty zoned lot (level 0): the row reads "opens $$". */
  lot: boolean;
  /** 0..1 */
  score: number;
  /** WEALTH.up, drawn as ticks on the meter. */
  ticks: readonly [number, number];
  /** Sign of world.wealthStreak[i]: ▲ rising, ▼ slipping. */
  dir: -1 | 0 | 1;
  /** A $ Hab Block in an affordable quarter (alley within 1): +10% residents. */
  affordable: boolean;
  /** What would lift it next (≤ 40 chars); null at $$$. */
  next: string | null;
  /** The biggest lift besides land value (≤ 24 chars); null if none ≥ 2 points. */
  lifted: string | null;
}

const pts = (v: number) => Math.round(Math.abs(v) * 100);

/**
 * Inspect data for tile (x, y) (§4.5): tier, potential, score, meter ticks, trend, and the
 * "Next" and "Lifted by" notes from the same formula the sim uses. Non-zone tiles return
 * a zero record with null notes.
 */
export function wealthInfo(world: World, x: number, y: number): WealthInfo {
  const ticks = WEALTH.up as unknown as readonly [number, number];
  const info: WealthInfo = { tier: 0, potential: 0, lot: false, score: 0, ticks, dir: 0, affordable: false, next: null, lifted: null };
  const t = world.tileAt(x, y);
  if (!t || t.zone === ZoneType.None) return info;
  const i = world.idx(x, y);
  const f = world.fields;
  const z = t.zone;
  const terms = wealthTerms(world, i, blankTerms());
  const score = clamp01(terms.base + terms.landValue + terms.education + terms.transit + terms.hub + terms.sea + terms.net + terms.noise + terms.crime);
  const cap = tierCapAt(world, i);
  const tier: WealthTier = t.level > 0 ? t.wealth : 0;
  info.tier = tier;
  info.lot = t.level === 0;
  info.score = score;
  info.potential = potentialTier(z, score, cap);
  const st = world.wealthStreak[i];
  info.dir = st > 0 ? 1 : st < 0 ? -1 : 0;
  info.affordable = z === ZoneType.Residential && f.alleyNear[i] === 1 && tier === 0;

  // Lifted by: the largest positive part other than land value (and Fab's base), ≥ 2 points.
  const lifts: [number, string][] = [
    [terms.education, 'Academy'],
    [terms.transit, 'Transit'],
    [terms.hub, 'Airport district'],
    [terms.sea, 'Seaport'],
    [terms.net, 'Data Hub'],
  ];
  let best: [number, string] | null = null;
  for (const l of lifts) if (l[0] >= 0.02 && (!best || l[0] > best[0])) best = l;
  info.lifted = best ? `${best[1]} +${pts(best[0])}%` : null;

  if (tier >= 2) return info;
  // Next: a cap that blocks the next step; else rising; else the biggest drag; else the biggest missing lift.
  if (cap <= tier) {
    const c = WEALTH.caps;
    const crime = f.crime[i];
    if (z === ZoneType.Industrial || crime >= c.highMaxCrime) info.next = 'Crime holds it back: add a Precinct';
    else if (f.noise[i] >= c.highMaxNoise) info.next = z === ZoneType.Residential ? 'Too noisy for $$$: keep homes back' : 'Too noisy for $$$: quieter roads help';
    else if (f.pollution[i] >= c.highMaxPollution) info.next = 'Smog holds it back';
    else if (z === ZoneType.Residential && f.alleyNear[i]) info.next = 'Beside an alley: rents stay low';
    else info.next = 'Held back: see the notes';
    return info;
  }
  if (score >= UP[tier]) {
    info.next = info.lot ? `Opens at ${TIER_LABEL[info.potential]}` : 'Rising: steps up soon';
    return info;
  }
  const drags: [number, string][] = [
    [terms.noise, z === ZoneType.Residential ? `Noise −${pts(terms.noise)}%: keep homes back` : `Noise −${pts(terms.noise)}%: quieter roads help`],
    [terms.crime, `Crime −${pts(terms.crime)}%: add a Precinct`],
  ];
  let worst: [number, string] | null = null;
  for (const d of drags) if (d[0] <= -0.03 && (!worst || d[0] < worst[0])) worst = d;
  if (worst) {
    info.next = worst[1];
    return info;
  }
  const academyOpen = world.maxPopulation >= BUILDINGS.academy.unlockPop;
  if (z === ZoneType.Industrial) {
    const s = WEALTH.score.ind;
    const missing = s.edu * (1 - f.education[i]) + s.net * (1 - f.net[i]) + s.transit * (1 - f.transit[i]);
    if (missing >= 0.02) {
      info.next = academyOpen ? 'Needs an Academy, Data Hub or transit' : 'Needs a Data Hub or transit';
      return info;
    }
  } else {
    const s = z === ZoneType.Residential ? WEALTH.score.res : WEALTH.score.com;
    const eduGap = academyOpen ? s.edu * (1 - f.education[i]) : 0;
    const transitGap = s.transit * (1 - f.transit[i]);
    if (eduGap >= 0.02 && eduGap >= transitGap) {
      info.next = `An Academy nearby adds up to +${pts(s.edu)}%`;
      return info;
    }
    if (transitGap >= 0.02) {
      info.next = `Transit adds up to +${pts(s.transit)}%`;
      return info;
    }
  }
  info.next = 'Needs land value: parks and services';
  return info;
}
