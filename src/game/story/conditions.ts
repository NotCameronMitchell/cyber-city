// ─────────────────────────────────────────────────────────────────────────────
// Story conditions (docs/STORY.md §10.2): the content registry, the closed
// metric vocabulary, the condition evaluator and hold tracking. Owner: WP-A.
//
//   useStoryContent(c)   register the story content (chapters, cards, factions,
//                        endings, whispers, notes); indexed once
//   storyContent()       the current index (empty until registered: inert story)
//   metric(world, m)     one Metric, read from world.stats / turf / vertical / story
//   evalCond(world, c)   a Condition tree (`hold` reads story.holds)
//   updateHolds(world,c) daily: advance or reset every `hold` node in c
//
// Pure reads (no writes except updateHolds). Allocation-light: evaluated daily
// for goals and monthly for ~45 deck cards.
// ─────────────────────────────────────────────────────────────────────────────

import { completeStage } from '../buildingStats';
import { BUILDINGS, GANG_IDS } from '../config';
import type { BuildingType } from '../types';
import type { World } from '../world';
import { friendlyCount, patronOf, powerShare, rivalOf, standing } from './factions';
import * as turf from './turf';
import type {
  Card,
  Chapter,
  Condition,
  CrownId,
  Ending,
  EndingId,
  Faction,
  FactionId,
  GangId,
  Metric,
  Op,
} from './types';

// ── Content registry ────────────────────────────────────────────────────────

/** One faction's whisper lines by tier (§7.9), each ≤ 90 chars. */
export interface WhisperLines {
  warm: string;
  neutral: string;
  cold: string;
}

/** A MOTH ticker note (§7.9): first template (from story.noteIdx) whose `when` holds. */
export interface MothNote {
  /** Omitted = always. */
  when?: Condition;
  /** Also requires Silt Log `log` to be owned. */
  log?: number;
  /** Starts with '> '. Variables: {lit} {dark} {pop} {crime} {district} {trace} {n}. */
  text: string;
}

/**
 * Everything the director needs from `src/game/story/content/*` (pure data).
 * `cards` holds every card: beats, deck cards, ⚑ and system cards, Silt Log
 * cards (`log.01`..`log.12`, kind 'log'), ending cards, `ep.review`,
 * `coda.recall` and whisper callbacks. `factions` may be an array or a record.
 */
export interface StoryContent {
  factions: readonly Faction[] | Partial<Record<FactionId, Faction>>;
  chapters: readonly Chapter[];
  cards: readonly Card[];
  endings: readonly Ending[];
  whispers?: Partial<Record<FactionId, WhisperLines>>;
  notes?: readonly MothNote[];
  /** Unlock news lines (§5.0), keyed by Unlockable. */
  unlockNews?: Partial<Record<string, string>>;
}

/** Indexed content, built once by useStoryContent. */
export interface ContentIndex {
  readonly source: StoryContent;
  readonly cards: ReadonlyMap<string, Card>;
  readonly factions: Partial<Record<FactionId, Faction>>;
  readonly chapters: ReadonlyMap<number, Chapter>;
  /** Endings in content order (Charter Night rows). */
  readonly endings: readonly Ending[];
  readonly ending: ReadonlyMap<EndingId, Ending>;
  /** Beat card id → its chapter number. */
  readonly beatChapter: ReadonlyMap<string, number>;
  /** Optional beat card ids. */
  readonly optionalBeats: ReadonlySet<string>;
  /** Silt Log n → its log card. */
  readonly logCards: ReadonlyMap<number, Card>;
  /** Silt Log n (7..12) → the ★ card that owns it. */
  readonly starCards: ReadonlyMap<number, Card>;
  /** Drawable faction cards (step 5): kind 'faction', not queued-only, not seasonal. */
  readonly deck: readonly Card[];
  /** Seasonal cards (step 4). */
  readonly seasonal: readonly Card[];
  /** System cards with a `when` (step 2). */
  readonly system: readonly Card[];
  /** Each faction's ⚑ card. */
  readonly hostile: Partial<Record<FactionId, Card>>;
  readonly whispers: Partial<Record<FactionId, WhisperLines>>;
  readonly notes: readonly MothNote[];
  readonly unlockNews: Partial<Record<string, string>>;
}

const FACTION_KEYS: readonly FactionId[] = ['board', 'basalt', 'nacre', 'undertow', 'kites', 'tuning'];

/** The Silt Log number a log card id names (`log.07` → 7), or 0. */
export function logNumber(id: string): number {
  const m = /^log\.?0*(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

function buildIndex(src: StoryContent): ContentIndex {
  const cards = new Map<string, Card>();
  for (const c of src.cards ?? []) if (c && typeof c.id === 'string') cards.set(c.id, c);
  const factions: Partial<Record<FactionId, Faction>> = {};
  const list = Array.isArray(src.factions)
    ? (src.factions as readonly Faction[])
    : (Object.values(src.factions ?? {}) as Faction[]);
  for (const f of list) if (f && FACTION_KEYS.includes(f.id)) factions[f.id] = f;
  const chapters = new Map<number, Chapter>();
  const beatChapter = new Map<string, number>();
  const optionalBeats = new Set<string>();
  for (const ch of src.chapters ?? []) {
    chapters.set(ch.n, ch);
    for (const b of ch.beats ?? []) {
      beatChapter.set(b.card, ch.n);
      if (b.optional) optionalBeats.add(b.card);
    }
  }
  const endings = [...(src.endings ?? [])];
  const ending = new Map<EndingId, Ending>();
  for (const e of endings) ending.set(e.id, e);
  const logCards = new Map<number, Card>();
  const starCards = new Map<number, Card>();
  const deck: Card[] = [];
  const seasonal: Card[] = [];
  const system: Card[] = [];
  const hostile: Partial<Record<FactionId, Card>> = {};
  for (const c of cards.values()) {
    if (c.kind === 'log') {
      const n = logNumber(c.id);
      if (n > 0 && !logCards.has(n)) logCards.set(n, c);
    }
    if (c.star) starCards.set(c.star, c);
    if (c.kind === 'faction' && !c.queuedOnly && !beatChapter.has(c.id)) (c.seasonal ? seasonal : deck).push(c);
    if (c.kind === 'system' && !c.queuedOnly && c.when) system.push(c);
    if (c.kind === 'hostile' && FACTION_KEYS.includes(c.speaker as FactionId)) {
      hostile[c.speaker as FactionId] ??= c;
    }
  }
  for (const f of FACTION_KEYS) {
    const id = factions[f]?.hostile?.card;
    const c = id ? cards.get(id) : undefined;
    if (c) hostile[f] = c;
  }
  return {
    source: src,
    cards,
    factions,
    chapters,
    endings,
    ending,
    beatChapter,
    optionalBeats,
    logCards,
    starCards,
    deck,
    seasonal,
    system,
    hostile,
    whispers: src.whispers ?? {},
    notes: src.notes ?? [],
    unlockNews: src.unlockNews ?? {},
  };
}

/** No content: the director stays inert (Step 0 behaviour). */
export const EMPTY_CONTENT: StoryContent = { factions: [], chapters: [], cards: [], endings: [] };

let index: ContentIndex = buildIndex(EMPTY_CONTENT);

/** Register the story content (indexed once). Returns the index. Call before building a director. */
export function useStoryContent(c: StoryContent): ContentIndex {
  index = buildIndex(c);
  return index;
}

/** The registered content index (empty until useStoryContent). */
export function storyContent(): ContentIndex {
  return index;
}

// ── Metrics (§10.2) ─────────────────────────────────────────────────────────

const STAT_METRICS = new Set<string>([
  'pop', 'maxPop', 'tick', 'month', 'funds', 'tax', 'approval', 'unemployment', 'avgCrime', 'avgPollution',
  'avgLandValue', 'avgTraffic', 'powerMargin', 'unpowered', 'abandoned', 'dev.res', 'dev.com', 'dev.ind', 'dev.all',
  'jobs.com', 'jobs.ind', 'stacks.stage2', 'stacks.stage3', 'crowns', 'skybridges', 'rail.tiles', 'rail.maxStations',
  'turf.share', 'standing.patron', 'standing.rival', 'power.gangs', 'friendlyCount', 'security.avg', 'trace', 'logs',
  'chapter', 'daysInChapter', 'gangActions', 'daysSinceCrackdown',
  // Expansion (docs/EXPANSION.md §2.2).
  'wealth.high', 'wealth.low', 'roads.highway', 'roads.alley', 'skyway.tiles',
  // Megacity (docs/MEGACITY.md §8.4).
  'districts', 'grants', 'region', 'ruins', 'skylobby.count', 'skylobby.max',
  'district.shoals', 'district.sunk', 'district.flats', 'district.terraces', 'district.reedmere', 'district.skeleton',
  'district.tarmac', 'district.bazaar',
]);
const CROWN_KEYS: readonly CrownId[] = ['foundry', 'glare', 'nest', 'commons', 'salvage', 'lamp'];

/** True if `m` is a member of the closed Metric vocabulary (lint and tests). */
export function isMetric(m: string): m is Metric {
  if (STAT_METRICS.has(m)) return true;
  const dot = m.indexOf('.');
  if (dot < 0) return false;
  const p = m.slice(0, dot);
  const k = m.slice(dot + 1);
  switch (p) {
    case 'count':
      return k in BUILDINGS;
    case 'turf':
    case 'turfSecured':
    case 'railOnTurf':
    case 'pactActive':
      return (GANG_IDS as readonly string[]).includes(k);
    case 'standing':
    case 'power':
      return (FACTION_KEYS as readonly string[]).includes(k);
    case 'crowns':
      return (CROWN_KEYS as readonly string[]).includes(k);
    default:
      return false;
  }
}

// Per-tick building-count cache (count.* metrics).
const counts: Partial<Record<BuildingType, number>> = {};
let countsWorld: World | null = null;
let countsKey = '';

/** Buildings of a type (online or not), cached per tick and world version. */
export function countOf(world: World, type: BuildingType): number {
  const key = `${world.tick}:${world.version}:${world.buildings.size}`;
  if (countsWorld !== world || countsKey !== key) {
    for (const k of Object.keys(counts)) delete counts[k as BuildingType];
    for (const b of world.buildings.values()) counts[b.type] = (counts[b.type] ?? 0) + 1;
    countsWorld = world;
    countsKey = key;
  }
  return counts[type] ?? 0;
}

/** Stratablocks whose complete stage is at least `stage` (fresh count, no cache). */
export function stacksAtLeast(world: World, stage: number): number {
  let n = 0;
  for (const b of world.buildings.values()) if (b.type === 'stack' && completeStage(b) >= stage) n++;
  return n;
}

let secWorld: World | null = null;
let secTick = -1;
let secVal = 0;

/** Days in the current chapter (0 while waiting for its trigger). */
export function daysInChapter(world: World): number {
  const s = world.story;
  return s.phase === 'waiting' ? 0 : Math.max(0, world.tick - s.chapterTick);
}

/** Value of one metric (§10.2). Unknown metrics read 0. */
export function metric(world: World, m: Metric | string): number {
  const s = world.stats;
  const st = world.story;
  const vm = world.vertical.metrics;
  switch (m) {
    case 'pop':
      return s.population;
    case 'maxPop':
      return world.maxPopulation;
    case 'tick':
      return world.tick;
    case 'month':
      return world.month;
    case 'funds':
      return world.funds;
    case 'tax':
      return world.taxRate;
    case 'approval':
      return s.approval;
    case 'unemployment':
      return s.unemployment;
    case 'avgCrime':
      return s.avgCrime;
    case 'avgPollution':
      return s.avgPollution;
    case 'avgLandValue':
      return s.avgLandValue;
    case 'avgTraffic':
      return s.avgTraffic;
    case 'powerMargin':
      return s.powerSupply / Math.max(1, s.powerDemand);
    case 'unpowered':
      return s.unpoweredTiles;
    case 'abandoned':
      return s.abandonedTiles;
    case 'dev.res':
      return s.developed.res;
    case 'dev.com':
      return s.developed.com;
    case 'dev.ind':
      return s.developed.ind;
    case 'dev.all':
      return s.developed.res + s.developed.com + s.developed.ind;
    case 'jobs.com':
      return s.jobsCom;
    case 'jobs.ind':
      return s.jobsInd;
    case 'stacks.stage2':
      return vm.stacksStage2;
    case 'stacks.stage3':
    case 'crowns':
      return vm.stacksStage3;
    case 'skybridges':
      return vm.skybridges;
    case 'rail.tiles':
      return vm.railTiles;
    case 'rail.maxStations':
      return vm.railMaxStations;
    case 'turf.share': {
      const land = turf.landTiles(world);
      const t = world.turf.stats.tiles;
      return land > 0 ? (t.undertow + t.kites) / land : 0;
    }
    case 'standing.patron':
      return standing(world, patronOf(world));
    case 'standing.rival':
      return standing(world, rivalOf(world));
    case 'power.gangs':
      return powerShare(world, 'undertow') + powerShare(world, 'kites');
    case 'friendlyCount':
      return friendlyCount(world);
    case 'security.avg':
      if (secWorld !== world || secTick !== world.tick) {
        secVal = turf.securityAvg(world);
        secWorld = world;
        secTick = world.tick;
      }
      return secVal;
    case 'trace':
      return st.trace;
    case 'logs':
      return st.logs.length;
    case 'chapter':
      return st.chapter;
    case 'daysInChapter':
      return daysInChapter(world);
    case 'gangActions':
      return st.gangActions;
    case 'daysSinceCrackdown':
      return Math.min(99999, world.tick - st.lastCrackdownTick);
    // Expansion (docs/EXPANSION.md §2.2): shares of developed zone tiles (all zones) by tier, road counts.
    case 'wealth.high':
    case 'wealth.low': {
      const wt = s.wealth;
      const total = wt[0] + wt[1] + wt[2];
      return (m === 'wealth.high' ? wt[2] : wt[0]) / Math.max(1, total);
    }
    case 'roads.highway':
      return s.roads.highway;
    case 'roads.alley':
      return s.roads.alley;
    case 'skyway.tiles':
      return s.roads.skyway;
    // Megacity (MEGACITY §8.4).
    case 'districts':
      return world.districts.owned.length;
    case 'grants':
      return world.districts.grants;
    case 'region':
      return world.region;
    case 'ruins':
      return s.ruins;
    case 'skylobby.count':
      return s.skyLobbies.count;
    case 'skylobby.max':
      return s.skyLobbies.largest;
    case 'district.shoals':
    case 'district.sunk':
    case 'district.flats':
    case 'district.terraces':
    case 'district.reedmere':
    case 'district.skeleton':
    case 'district.tarmac':
    case 'district.bazaar': {
      const kind = m.slice(9);
      const d = world.districts;
      let n = 0;
      for (const slot of d.owned) if (d.kinds[slot] === kind) n++;
      return n;
    }
  }
  const dot = m.indexOf('.');
  if (dot < 0) return 0;
  const p = m.slice(0, dot);
  const k = m.slice(dot + 1);
  switch (p) {
    case 'count':
      return k in BUILDINGS ? countOf(world, k as BuildingType) : 0;
    case 'turf':
      return world.turf.stats.tiles[k as GangId] ?? 0;
    case 'turfSecured':
      return world.turf.stats.secured[k as GangId] ?? 0;
    case 'railOnTurf':
      return vm.railOnTurf[k as GangId] ?? 0;
    case 'pactActive':
      return (GANG_IDS as readonly string[]).includes(k) && turf.pactActive(world, k as GangId) ? 1 : 0;
    case 'standing':
      return (FACTION_KEYS as readonly string[]).includes(k) ? standing(world, k as FactionId) : 0;
    case 'power':
      return (FACTION_KEYS as readonly string[]).includes(k) ? powerShare(world, k as FactionId) : 0;
    case 'crowns':
      return vm.crowns[k as CrownId] ?? 0;
  }
  return 0;
}

/** Sum of one metric or an array of metrics. */
export function metricSum(world: World, m: Metric | readonly Metric[]): number {
  if (typeof m === 'string') return metric(world, m);
  let v = 0;
  for (const k of m) v += metric(world, k);
  return v;
}

export function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
  }
  return false;
}

/** A story flag's value; `revealed` mirrors story.revealed. */
export function flagValue(world: World, key: string): string | number | boolean | undefined {
  if (key === 'revealed') return world.story.revealed || !!world.story.flags.revealed;
  return world.story.flags[key];
}

/** Evaluate a condition tree. `undefined` holds. */
export function evalCond(world: World, c: Condition | undefined | null): boolean {
  if (!c) return true;
  if ('m' in c) return compare(metricSum(world, c.m as Metric | Metric[]), c.op, c.v);
  if ('flag' in c) {
    const v = flagValue(world, c.flag);
    if (c.eq === undefined) return !!v;
    return v === c.eq;
  }
  if ('all' in c) {
    for (const k of c.all) if (!evalCond(world, k)) return false;
    return true;
  }
  if ('any' in c) {
    for (const k of c.any) if (evalCond(world, k)) return true;
    return false;
  }
  if ('not' in c) return !evalCond(world, c.not);
  if ('hold' in c) return (world.story.holds[c.key] ?? 0) >= c.days;
  return false;
}

/**
 * Daily: every `hold` node in `c` counts one more day while its inner
 * condition holds, else resets to 0 (story.holds[key]). Call once per day.
 */
export function updateHolds(world: World, c: Condition | undefined | null): void {
  if (!c) return;
  if ('hold' in c) {
    updateHolds(world, c.hold);
    const h = world.story.holds;
    h[c.key] = evalCond(world, c.hold) ? Math.min(99999, (h[c.key] ?? 0) + 1) : 0;
    return;
  }
  if ('all' in c) for (const k of c.all) updateHolds(world, k);
  else if ('any' in c) for (const k of c.any) updateHolds(world, k);
  else if ('not' in c) updateHolds(world, c.not);
}

/** First `hold` node in a condition (goal drawers show "12/20 days"). */
export function findHold(c: Condition | undefined | null): { key: string; days: number } | null {
  if (!c) return null;
  if ('hold' in c) return { key: c.key, days: c.days };
  if ('all' in c) for (const k of c.all) {
    const h = findHold(k);
    if (h) return h;
  }
  if ('any' in c) for (const k of c.any) {
    const h = findHold(k);
    if (h) return h;
  }
  if ('not' in c) return findHold(c.not);
  return null;
}

/** First simple metric comparison in a condition (goal and claim gaps). */
export function firstMetric(c: Condition | undefined | null): { m: Metric; op: Op; v: number } | null {
  if (!c) return null;
  if ('m' in c) return typeof c.m === 'string' ? { m: c.m, op: c.op, v: c.v } : null;
  if ('all' in c) for (const k of c.all) {
    const h = firstMetric(k);
    if (h) return h;
  }
  if ('any' in c) for (const k of c.any) {
    const h = firstMetric(k);
    if (h) return h;
  }
  return null;
}

/** Every flag key a condition reads (lint: claims must not reference unknown flags). */
export function flagsIn(c: Condition | undefined | null, out: Set<string> = new Set()): Set<string> {
  if (!c) return out;
  if ('flag' in c) out.add(c.flag);
  else if ('all' in c) for (const k of c.all) flagsIn(k, out);
  else if ('any' in c) for (const k of c.any) flagsIn(k, out);
  else if ('not' in c) flagsIn(c.not, out);
  else if ('hold' in c) flagsIn(c.hold, out);
  return out;
}

/** Every metric a condition reads. */
export function metricsIn(c: Condition | undefined | null, out: Set<string> = new Set()): Set<string> {
  if (!c) return out;
  if ('m' in c) for (const m of typeof c.m === 'string' ? [c.m] : c.m) out.add(m);
  else if ('all' in c) for (const k of c.all) metricsIn(k, out);
  else if ('any' in c) for (const k of c.any) metricsIn(k, out);
  else if ('not' in c) metricsIn(c.not, out);
  else if ('hold' in c) metricsIn(c.hold, out);
  return out;
}

// ── Display formats ─────────────────────────────────────────────────────────

/** Metric display format: share-type metrics (0..1) as %, power as % of 100, margins as ×. */
export type MetricFmt = 'int' | 'pct' | 'x' | 'share';

const PCT_METRICS = new Set<string>([
  'unemployment', 'avgCrime', 'avgPollution', 'avgLandValue', 'avgTraffic', 'turf.share', 'security.avg',
  // Expansion shares.
  'wealth.high', 'wealth.low',
]);

/** The natural display format of a metric. */
export function metricFmt(m: string): MetricFmt {
  if (PCT_METRICS.has(m) || m.startsWith('turfSecured.')) return 'pct';
  if (m.startsWith('power.')) return 'share';
  if (m === 'powerMargin') return 'x';
  return 'int';
}

/** Format a metric value for the goal drawer and Charter Claims. */
export function formatMetric(v: number, fmt: MetricFmt): string {
  switch (fmt) {
    case 'pct':
      return `${Math.round(v * 100)}%`;
    case 'share':
      return `${Math.round(v)}%`;
    case 'x':
      return `${(Math.round(v * 100) / 100).toFixed(2)}×`;
    default:
      return Math.round(v).toLocaleString('en-US');
  }
}

/**
 * Format `v` for display next to `target`, so that rounding never makes an
 * unmet comparison look met (e.g. 24.7% shown as "25% / 25%" with a ✗).
 * When the comparison fails but the rounded value equals the rounded target,
 * the value is rounded away from the target instead (down for ≥, up for ≤).
 */
export function formatMetricVs(v: number, target: number, fmt: MetricFmt, atMost = false): string {
  const shown = formatMetric(v, fmt);
  const met = atMost ? v <= target : v >= target;
  if (met || !Number.isFinite(v) || shown !== formatMetric(target, fmt)) return shown;
  const scale = fmt === 'pct' ? 100 : fmt === 'x' ? 100 : 1;
  const r = atMost ? Math.ceil(v * scale - 1e-9) : Math.floor(v * scale + 1e-9);
  // If that still equals the target (v just below an integer target), step one unit away.
  const t = Math.round(target * scale);
  const adj = r === t ? (atMost ? t + 1 : t - 1) : r;
  return formatMetric(adj / scale, fmt);
}
