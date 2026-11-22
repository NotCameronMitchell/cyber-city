// ─────────────────────────────────────────────────────────────────────────────
// Faction standing, tiers, mood, visibility and power share (docs/STORY.md §2).
// Owner: WP-A. turf.ts, vertical.ts and actions.ts import standing / tier.
//
//   standing = clamp(round(favor + mood), floor, ceil)   (§2.1)
//     favor   story.favor, changed by choices, salt, deals, reactions, drift
//     mood    story.mood, recomputed monthly from the faction's drivers (±30)
//     floor / ceil   story floors / ceils joined with the current ending's
//                    rules (highest floor, lowest ceiling win; §6.4)
//   tier     from standing; a hidden faction (the Tuning before it activates)
//            counts as Neutral
//   power    Balance of Power share over the five non-wildcard factions (§2.4)
// ─────────────────────────────────────────────────────────────────────────────

import { FACTION_IDS, POWER_WEIGHTS, STANDING } from '../config';
import type { World } from '../world';
import { countOf, evalCond, metricSum, storyContent } from './conditions';
import type { CorpId, EndingRules, FactionId, FactionRef, MoodDriver, Tier } from './types';

/** Tier for a standing value (§2.1). */
export function tierOf(standing: number): Tier {
  if (standing <= STANDING.hostile) return 'hostile';
  if (standing <= STANDING.cold) return 'cold';
  if (standing >= STANDING.allied) return 'allied';
  if (standing >= STANDING.friendly) return 'friendly';
  return 'neutral';
}

/** Tier order, worst first. */
export const TIER_RANK: Record<Tier, number> = { hostile: 0, cold: 1, neutral: 2, friendly: 3, allied: 4 };

// ── Ending rules (read live, never cached: a Charter Review swap is clean) ──

/** Rules of the current ending, or null before an ending. */
export function endingRules(world: World): EndingRules | null {
  const id = world.story.ending;
  if (!id) return null;
  return storyContent().ending.get(id)?.rules ?? null;
}

/** Effective floor: story floors and the ending's, the highest wins. */
export function floorOf(world: World, f: FactionId): number {
  const a = world.story.floors[f];
  const b = endingRules(world)?.floors?.[f];
  let v: number = STANDING.min;
  if (typeof a === 'number' && a > v) v = a;
  if (typeof b === 'number' && b > v) v = b;
  return v;
}

/** Effective ceiling: story ceilings and the ending's, the lowest wins. */
export function ceilOf(world: World, f: FactionId): number {
  const a = world.story.ceils[f];
  const b = endingRules(world)?.ceils?.[f];
  let v: number = STANDING.max;
  if (typeof a === 'number' && a < v) v = a;
  if (typeof b === 'number' && b < v) v = b;
  return v;
}

/** Saved monthly mood (0 before the first monthly update). */
export function moodOf(world: World, f: FactionId): number {
  return world.story.mood?.[f] ?? 0;
}

/** standing = clamp(round(favor + mood), floor ?? −100, ceil ?? 100) (§2.1). */
export function standing(world: World, f: FactionId): number {
  const s = world.story;
  const v = Math.round((s.favor[f] ?? 0) + moodOf(world, f));
  const lo = floorOf(world, f);
  const hi = ceilOf(world, f);
  return Math.min(hi, Math.max(lo, v));
}

// ── Visibility and retirement ───────────────────────────────────────────────

/** Visible: the faction's `visible` condition (default: everyone but a dormant Tuning). */
export function isVisible(world: World, f: FactionId): boolean {
  const def = storyContent().factions[f];
  if (def?.visible) return evalCond(world, def.visible);
  return f !== 'tuning' || !!world.story.flags.tuningActive || world.story.revealed;
}

/** Faction panel row state: shown, a silhouette (the Tuning teaser), or hidden. */
export function shownState(world: World, f: FactionId): 'yes' | 'silhouette' | 'no' {
  if (isVisible(world, f)) return 'yes';
  const def = storyContent().factions[f];
  const teaser = def ? def.teaser : f === 'tuning' ? { m: 'trace' as const, op: '>=' as const, v: 25 } : undefined;
  return teaser && evalCond(world, teaser) ? 'silhouette' : 'no';
}

/** Retired by the current ending (§6.4): no cards, no salt, no tier effects. */
export function isRetired(world: World, f: FactionId): boolean {
  return !!endingRules(world)?.retire?.includes(f);
}

/** Visible and not retired: draws cards, whispers, has tier effects. */
export function isActive(world: World, f: FactionId): boolean {
  return isVisible(world, f) && !isRetired(world, f);
}

/** Current tier of a faction. A hidden faction counts as Neutral (§2.1). */
export function tier(world: World, f: FactionId): Tier {
  if (!isVisible(world, f)) return 'neutral';
  return tierOf(standing(world, f));
}

/** Is the faction at `need` or better? */
export function tierAtLeast(world: World, f: FactionId, need: Tier): boolean {
  return TIER_RANK[tier(world, f)] >= TIER_RANK[need];
}

// ── Mood (§2.1) ─────────────────────────────────────────────────────────────

/** Value of one mood driver right now. */
export function driverValue(world: World, d: MoodDriver): number {
  if ('when' in d) return evalCond(world, d.when) ? d.value : 0;
  const v = (metricSum(world, d.m) - (d.offset ?? 0)) * d.mul;
  return (v < d.min ? d.min : v > d.max ? d.max : v) + 0; // + 0 turns −0 into 0
}

/** Every mood driver of a faction with its current value (unrounded). */
export function moodDrivers(world: World, f: FactionId): { label: string; value: number }[] {
  const def = storyContent().factions[f];
  if (!def) return [];
  return def.mood.map((d) => ({ label: d.label, value: driverValue(world, d) }));
}

/** Mood now: drivers summed, clamped ±moodCap. */
export function computeMood(world: World, f: FactionId): number {
  const def = storyContent().factions[f];
  if (!def) return 0;
  let sum = 0;
  for (const d of def.mood) sum += driverValue(world, d);
  const cap = STANDING.moodCap;
  return sum < -cap ? -cap : sum > cap ? cap : sum;
}

/** Monthly: recompute and store every faction's mood. */
export function updateMoods(world: World): void {
  const m = (world.story.mood ??= {});
  for (const f of FACTION_IDS) m[f] = Math.round(computeMood(world, f) * 100) / 100;
}

// ── Patron and rival (§2.4) ─────────────────────────────────────────────────

/** The `patron` flag, if a chapter has set it. */
export function patronFlag(world: World): CorpId | null {
  const p = world.story.flags.patron;
  return p === 'basalt' || p === 'nacre' ? p : null;
}

/** The patron: the flag, or the higher-standing corp (Basalt on a tie). */
export function patronOf(world: World): CorpId {
  const p = patronFlag(world);
  if (p) return p;
  return standing(world, 'nacre') > standing(world, 'basalt') ? 'nacre' : 'basalt';
}

/** The other corp. */
export function rivalOf(world: World): CorpId {
  return patronOf(world) === 'basalt' ? 'nacre' : 'basalt';
}

/** Expand a FactionRef: patron / rival resolve now; gangs and corps fan out. */
export function resolveRef(world: World, ref: FactionRef): FactionId[] {
  switch (ref) {
    case 'patron':
      return [patronOf(world)];
    case 'rival':
      return [rivalOf(world)];
    case 'gangs':
      return ['undertow', 'kites'];
    case 'corps':
      return ['basalt', 'nacre'];
    default:
      return [ref];
  }
}

// ── Power share (§2.4) ──────────────────────────────────────────────────────

/** Factions in the Balance of Power bar. */
export const POWER_FACTIONS: readonly FactionId[] = ['board', 'basalt', 'nacre', 'undertow', 'kites'];

/** Raw power weight of a faction (0 for the Tuning). */
export function powerWeight(world: World, f: FactionId): number {
  const st = world.story;
  const s = world.stats;
  const flags = st.flags;
  const crowns = world.vertical.metrics.crowns;
  const tiles = world.turf.stats.tiles;
  const W = POWER_WEIGHTS;
  const patron = patronFlag(world);
  switch (f) {
    case 'board':
      return (
        W.board.approval * s.approval +
        W.board.perPrecinct * countOf(world, 'precinct') +
        W.board.perClinic * countOf(world, 'clinic') +
        (flags.honestTie ? W.board.honestTie : 0)
      );
    case 'basalt': {
      const branded = typeof flags.branded === 'number' ? flags.branded : flags.branded ? 1 : 0;
      return (
        s.jobsInd / W.basalt.jobsIndDiv +
        W.basalt.perReactor * countOf(world, 'reactor') +
        W.basalt.perFoundry * countOf(world, 'foundry') +
        W.basalt.perCrownFoundry * crowns.foundry +
        W.basalt.branded * branded +
        (patron === 'basalt' ? W.basalt.patron : 0)
      );
    }
    case 'nacre':
      return (
        s.jobsCom / W.nacre.jobsComDiv +
        W.nacre.perDatahub * countOf(world, 'datahub') +
        W.nacre.perSpire * countOf(world, 'spire') +
        W.nacre.perGlarewall * countOf(world, 'glarewall') +
        W.nacre.perCrownGlare * crowns.glare +
        (patron === 'nacre' ? W.nacre.patron : 0)
      );
    case 'undertow':
      return (
        W.undertow.perTurfTile * tiles.undertow +
        W.undertow.perTidemarket * countOf(world, 'tidemarket') +
        (flags.oneTide === 'undertow' ? W.undertow.oneTide : 0)
      );
    case 'kites':
      return (
        W.kites.perTurfTile * tiles.kites +
        W.kites.perRoost * countOf(world, 'roost') +
        W.kites.perCrownNest * crowns.nest +
        (flags.oneTide === 'kites' ? W.kites.oneTide : 0)
      );
    default:
      return 0;
  }
}

/** power.f = 100 × weight_f / Σ weights (0 for the Tuning, or when nothing has weight). */
export function powerShare(world: World, f: FactionId): number {
  if (!POWER_FACTIONS.includes(f)) return 0;
  let sum = 0;
  let mine = 0;
  for (const g of POWER_FACTIONS) {
    const w = Math.max(0, powerWeight(world, g));
    sum += w;
    if (g === f) mine = w;
  }
  return sum > 0 ? (100 * mine) / sum : 0;
}

/** Visible, unretired factions with standing ≥ 20 (§10.2). */
export function friendlyCount(world: World): number {
  let n = 0;
  for (const f of FACTION_IDS) if (isActive(world, f) && standing(world, f) >= STANDING.friendly) n++;
  return n;
}

// ── Favor writes ────────────────────────────────────────────────────────────

/**
 * Change a faction's favor (clamped ±100). Emits 'standing' when the standing
 * moved (unless `quiet`). Returns the standing delta.
 */
export function changeFavor(world: World, f: FactionId, v: number, quiet = false): number {
  if (!v || !Number.isFinite(v)) return 0;
  const s = world.story;
  const before = standing(world, f);
  const next = Math.max(STANDING.min, Math.min(STANDING.max, (s.favor[f] ?? 0) + v));
  s.favor[f] = Math.round(next * 100) / 100;
  const after = standing(world, f);
  if (after !== before && !quiet) world.events.emit('standing', { faction: f, delta: after - before, value: after });
  return after - before;
}

/** Monthly favor drift (|favor| > 30 moves 1 toward 0) plus `favorMonthly`. No events. */
export function driftFavor(world: World, monthly: Partial<Record<FactionId, number>>): void {
  const fav = world.story.favor;
  for (const f of FACTION_IDS) {
    let v = fav[f] ?? 0;
    if (Math.abs(v) > STANDING.driftAbove) v -= Math.sign(v) * STANDING.drift;
    const add = monthly[f];
    if (typeof add === 'number' && Number.isFinite(add)) v += add;
    fav[f] = Math.max(STANDING.min, Math.min(STANDING.max, Math.round(v * 100) / 100));
  }
}

/** Every faction's standing right now (snapshots for monthly events and whispers). */
export function standings(world: World, out: Partial<Record<FactionId, number>> = {}): Record<FactionId, number> {
  for (const f of FACTION_IDS) out[f] = standing(world, f);
  return out as Record<FactionId, number>;
}
