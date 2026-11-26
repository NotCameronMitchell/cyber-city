// ─────────────────────────────────────────────────────────────────────────────
// Runtime copies of the closed story vocabularies (docs/STORY.md §10.1–§10.3).
// The content lint (tests/story/content-lint.test.ts) checks every condition
// and effect against these lists; the compile-time checks below fail the build
// if story/types.ts gains a member these lists do not carry.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, CROWNS, FACTION_IDS, GANG_IDS } from '../../config';
import type { BuildingType } from '../../types';
import type { CrownId, Effect, FactionId, FactionRef, GangId, Metric, SpotRule, Target, Unlockable } from '../types';

/** `[Missing] extends [never]` → true, else the missing members (shown in the compile error). */
type Complete<Missing> = [Missing] extends [never] ? true : Missing;

// ── Metrics (§10.2) ─────────────────────────────────────────────────────────

type TemplatedMetric =
  | `count.${BuildingType}`
  | `turf.${GangId}`
  | `turfSecured.${GangId}`
  | `railOnTurf.${GangId}`
  | `pactActive.${GangId}`
  | `standing.${FactionId}`
  | `power.${FactionId}`
  | `crowns.${CrownId}`;
type PlainMetric = Exclude<Metric, TemplatedMetric>;

const PLAIN_METRICS = [
  'pop',
  'maxPop',
  'tick',
  'month',
  'funds',
  'tax',
  'approval',
  'unemployment',
  'avgCrime',
  'avgPollution',
  'avgLandValue',
  'avgTraffic',
  'powerMargin',
  'unpowered',
  'abandoned',
  'dev.res',
  'dev.com',
  'dev.ind',
  'dev.all',
  'jobs.com',
  'jobs.ind',
  'stacks.stage2',
  'stacks.stage3',
  'crowns',
  'skybridges',
  'rail.tiles',
  'rail.maxStations',
  'turf.share',
  'standing.patron',
  'standing.rival',
  'power.gangs',
  'friendlyCount',
  'security.avg',
  'trace',
  'logs',
  'chapter',
  'daysInChapter',
  'gangActions',
  'daysSinceCrackdown',
  // Expansion (docs/EXPANSION.md §2.2).
  'wealth.high',
  'wealth.low',
  'roads.highway',
  'roads.alley',
  'skyway.tiles',
  // Megacity (docs/MEGACITY.md §8.4).
  'districts',
  'grants',
  'district.shoals',
  'district.sunk',
  'district.flats',
  'district.terraces',
  'district.reedmere',
  'district.skeleton',
  'district.tarmac',
  'district.bazaar',
  'region',
  'ruins',
  'skylobby.count',
  'skylobby.max',
] as const satisfies readonly PlainMetric[];
/** Compile-time: every non-templated Metric is listed. */
export type PlainMetricsComplete = Complete<Exclude<PlainMetric, (typeof PLAIN_METRICS)[number]>>;
export const PLAIN_METRICS_COMPLETE: PlainMetricsComplete = true;

const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];
const CROWN_IDS = Object.keys(CROWNS) as CrownId[];

/** Every metric of the closed vocabulary, as a runtime list. */
export const METRIC_LIST: readonly Metric[] = [
  ...PLAIN_METRICS,
  ...BUILDING_TYPES.map((t) => `count.${t}` as const),
  ...GANG_IDS.flatMap((g) => [`turf.${g}`, `turfSecured.${g}`, `railOnTurf.${g}`, `pactActive.${g}`] as const),
  ...FACTION_IDS.flatMap((f) => [`standing.${f}`, `power.${f}`] as const),
  ...CROWN_IDS.map((c) => `crowns.${c}` as const),
];
export const METRICS: ReadonlySet<string> = new Set<string>(METRIC_LIST);
export function isMetric(s: string): s is Metric {
  return METRICS.has(s);
}

// ── Effects (§10.3) ─────────────────────────────────────────────────────────

const EFFECT_KIND_LIST = [
  'funds',
  'favor',
  'trace',
  'mod',
  'income',
  'local',
  'turf',
  'offline',
  'abandon',
  'renew',
  'unlock',
  'credit',
  'flag',
  'floor',
  'ceil',
  'pact',
  'queue',
  'log',
  'reveal',
  'news',
  'gangAction',
  'countdown',
  'charterNight',
  'ending',
  'if',
  // Megacity (docs/MEGACITY.md §8.2).
  'grant',
] as const satisfies readonly Effect['t'][];
export type EffectKindsComplete = Complete<Exclude<Effect['t'], (typeof EFFECT_KIND_LIST)[number]>>;
export const EFFECT_KINDS_COMPLETE: EffectKindsComplete = true;
export const EFFECT_KINDS: ReadonlySet<string> = new Set<string>(EFFECT_KIND_LIST);

// ── Targets, spot rules, faction refs, unlockables (§10.1) ─────────────────

const TARGET_LIST = [
  'city',
  'spot',
  'seam',
  'strongestTurf',
  'strongestTurf:undertow',
  'strongestTurf:kites',
  'largestAbandoned',
  'rail',
  // Megacity (docs/MEGACITY.md §8.4; WP-7 resolves them in story/effects.ts).
  'slot:shore',
  'slot:shoals',
  'slot:sunk',
  'slot:flats',
  'slot:terraces',
  'slot:reedmere',
  'slot:skeleton',
  'slot:tarmac',
  'slot:bazaar',
] as const satisfies readonly Target[];
export type TargetsComplete = Complete<Exclude<Target, (typeof TARGET_LIST)[number]>>;
export const TARGETS_COMPLETE: TargetsComplete = true;
export const TARGETS: ReadonlySet<string> = new Set<string>(TARGET_LIST);

const SPOT_RULE_LIST = [
  'industrial',
  'abandoned',
  'turf:undertow',
  'turf:kites',
  'waterfrontTurf',
  'seam',
  'skybridge',
  'random',
  // Expansion (docs/EXPANSION.md §2.2): WP-6 implements them in effects.ts (spotAvailable / findSpot).
  'highway',
  'alley',
  'shore',
] as const satisfies readonly SpotRule[];
export type SpotRulesComplete = Complete<Exclude<SpotRule, (typeof SPOT_RULE_LIST)[number]>>;
export const SPOT_RULES_COMPLETE: SpotRulesComplete = true;
export const SPOT_RULES: ReadonlySet<string> = new Set<string>(SPOT_RULE_LIST);

export const FACTION_REFS: ReadonlySet<string> = new Set<FactionRef>([...FACTION_IDS, 'patron', 'rival', 'gangs', 'corps']);

type NonBuildingUnlockable = Exclude<Unlockable, BuildingType>;
const NON_BUILDING_UNLOCKS = [
  'skybridge',
  'rail',
  'crowns',
  'crackdown',
  'pact',
  'factions',
  'comms',
  'deals',
  'turfOverlay',
] as const satisfies readonly NonBuildingUnlockable[];
export type UnlockablesComplete = Complete<Exclude<NonBuildingUnlockable, (typeof NON_BUILDING_UNLOCKS)[number]>>;
export const UNLOCKABLES_COMPLETE: UnlockablesComplete = true;
export const UNLOCKABLES: ReadonlySet<string> = new Set<Unlockable>([...BUILDING_TYPES, ...NON_BUILDING_UNLOCKS]);

export const BUILDING_TYPE_SET: ReadonlySet<string> = new Set<string>(BUILDING_TYPES);
