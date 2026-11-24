// ─────────────────────────────────────────────────────────────────────────────
// Story layer shared contract ("Who Holds the Charter", docs/STORY.md §9–§10).
//
// Pure types only: no runtime code, so any module (sim, render, UI) may import
// from here without pulling in story logic. Changes after Step 0 must be
// additive and announced to every work package (docs/STORY-CONTRACT.md).
// ─────────────────────────────────────────────────────────────────────────────

import type { BuildingType, BudgetLine, DistrictKind, NewsItem, ServiceEffect, StoryPace } from '../types';

// ── Ids and small unions (§10.1) ────────────────────────────────────────────

/** The six factions. The Tuning starts hidden (§2.2). */
export type FactionId = 'board' | 'basalt' | 'nacre' | 'undertow' | 'kites' | 'tuning';
/** The two street gangs that hold turf (§3). */
export type GangId = 'undertow' | 'kites';
/** The two megacorps; one becomes `patron`, the other `rival` (§2.4). */
export type CorpId = 'basalt' | 'nacre';
/** The five endings (§6). Lamplight is a variant of `quiet`, not an id. */
export type EndingId = 'ironwork' | 'pearl' | 'lowcrown' | 'ledger' | 'quiet';
/** Stratablock crowns, picked when stage 3 starts (§4.2). */
export type CrownId = 'foundry' | 'glare' | 'nest' | 'commons' | 'salvage' | 'lamp';
/** Standing tiers: hostile ≤ −60, cold −59..−20, neutral −19..19, friendly 20..59, allied ≥ 60 (§2.1). */
export type Tier = 'hostile' | 'cold' | 'neutral' | 'friendly' | 'allied';
/** Comparison operators for metric conditions. */
export type Op = '>=' | '<=' | '>' | '<' | '==' | '!=';
/** Things a story effect (or a population fallback) can unlock (§5.0). */
export type Unlockable =
  | BuildingType
  | 'skybridge'
  | 'rail'
  | 'crowns'
  | 'crackdown'
  | 'pact'
  | 'factions'
  | 'comms'
  | 'deals'
  | 'turfOverlay';
/** Rules that pick a card's spot / `{district}` (§7.1). */
export type SpotRule =
  | 'industrial'
  | 'abandoned'
  | 'turf:undertow'
  | 'turf:kites'
  | 'waterfrontTurf'
  | 'seam'
  | 'skybridge'
  | 'random'
  // Expansion (docs/EXPANSION.md §2.2; WP-6 implements them in effects.ts):
  /** The developed Hab Block within 3 of a Highway tile with the highest noise. */
  | 'highway'
  /** The Alley tile with the highest Undertow turf strength, else the lowest-index Alley tile. */
  | 'alley'
  /** The developed Hab Block within 2 of water with the highest land value. */
  | 'shore';
/** Where an effect lands; resolves to a centre tile plus the effect's `r` (§10.1). */
export type Target =
  | 'city'
  | 'spot'
  | 'seam'
  | 'strongestTurf'
  | 'strongestTurf:undertow'
  | 'strongestTurf:kites'
  | 'largestAbandoned'
  | 'rail'
  /** Megacity (MEGACITY §8.4, WP-7): every tile of the turf effect's gang inside the owned slots of that kind. */
  | `slot:${DistrictKind}`;
/** A faction, or a reference resolved at apply time. `gangs` / `corps` fan out to both members. */
export type FactionRef = FactionId | 'patron' | 'rival' | 'gangs' | 'corps';
/** Values a story flag may hold. */
export type FlagValue = string | number | boolean;

// ── Conditions and metrics (§10.2) ──────────────────────────────────────────

/** Closed metric vocabulary. Stats metrics read `world.stats`; story metrics read turf / vertical caches. */
export type Metric =
  | 'pop'
  | 'maxPop'
  | 'tick'
  | 'month'
  | 'funds'
  | 'tax'
  | 'approval'
  | 'unemployment'
  | 'avgCrime'
  | 'avgPollution'
  | 'avgLandValue'
  | 'avgTraffic'
  /** powerSupply / max(1, powerDemand) */
  | 'powerMargin'
  | 'unpowered'
  | 'abandoned'
  | 'dev.res'
  | 'dev.com'
  | 'dev.ind'
  | 'dev.all'
  | 'jobs.com'
  | 'jobs.ind'
  /** Buildings of that type, online or not. */
  | `count.${BuildingType}`
  /** Stratablocks whose complete stage (§4.1) is ≥ 2 / ≥ 3. `crowns` = `stacks.stage3`. */
  | 'stacks.stage2'
  | 'stacks.stage3'
  | 'crowns'
  /** Active skybridges. */
  | 'skybridges'
  | 'rail.tiles'
  /** Max powered stations on one live network. */
  | 'rail.maxStations'
  /** Tiles that gang owns. */
  | `turf.${GangId}`
  /** Turf tiles (both gangs) / land tiles. */
  | 'turf.share'
  /** Share (0..1) of that gang's tiles with security ≥ 0.5. */
  | `turfSecured.${GangId}`
  /** Rail tiles on that gang's turf. */
  | `railOnTurf.${GangId}`
  /** 1 while a pact (or the `permanentPacts` ending rule) holds, else 0. */
  | `pactActive.${GangId}`
  | `standing.${FactionId}`
  | 'standing.patron'
  | 'standing.rival'
  | `power.${FactionId}`
  | 'power.gangs'
  /** Visible, unretired factions with standing ≥ 20. */
  | 'friendlyCount'
  /** Complete crowns of that type. */
  | `crowns.${CrownId}`
  /** Mean security over developed tiles. */
  | 'security.avg'
  | 'trace'
  /** Silt Logs owned. */
  | 'logs'
  /** 1..6, 7 in the epilogue. */
  | 'chapter'
  | 'daysInChapter'
  | 'gangActions'
  /** tick − lastCrackdownTick, or 99,999 if there has never been one. */
  | 'daysSinceCrackdown'
  // Expansion (docs/EXPANSION.md §2.2):
  /** Share 0..1 of developed zone tiles (all zones) at $$$ / at $. */
  | 'wealth.high'
  | 'wealth.low'
  /** Ground road tiles of that kind (bridges included). */
  | 'roads.highway'
  | 'roads.alley'
  /** Skyway tiles. */
  | 'skyway.tiles'
  // Megacity (docs/MEGACITY.md §8.4):
  /** Owned districts. */
  | 'districts'
  /** Unspent land grants. */
  | 'grants'
  /** Districts of that kind owned (0/1 on a 3×3 region, 0..4 on a 5×5). */
  | `district.${Exclude<DistrictKind, 'shore'>}`
  /** The city's region side in slots (3 or 5). */
  | 'region'
  /** Ruins standing (stats.ruins). */
  | 'ruins'
  /** Sky Lobbies and the largest one's anchors (§5.5). */
  | 'skylobby.count'
  | 'skylobby.max';

/**
 * Condition tree. Text syntax in STORY.md maps 1:1: `a & b` → all, `a | b` → any,
 * `!flag` → not, `flag x=y` → `{ flag: 'x', eq: 'y' }`, `hold(c, Nd)` → hold.
 */
export type Condition =
  /** An array of metrics is summed before comparing. */
  | { m: Metric | Metric[]; op: Op; v: number }
  /** `eq` omitted = truthy. */
  | { flag: string; eq?: FlagValue }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  /** True after N consecutive days of `hold`; progress lives in `story.holds[key]`. */
  | { hold: Condition; days: number; key: string };

// ── Effects (§10.3) ─────────────────────────────────────────────────────────

/** Closed effect vocabulary. Effects in a choice apply left to right; an unresolvable target skips the effect. */
export type Effect =
  | { t: 'funds'; v: number }
  | { t: 'favor'; f: FactionRef; v: number }
  | { t: 'trace'; v: number }
  /** Timed (or permanent) modifier patch; stored in `story.mods`. */
  | { t: 'mod'; id: string; label: string; days: number | 'perm'; mods: ModPatch }
  /** Recurring budget line (`↻`). */
  | { t: 'income'; id: string; label: string; perMonth: number; months: number }
  /** Per-tile crime / land-value disc, written into `layerParts.local`. */
  | { t: 'local'; id: string; at: Target; r: number; days: number; crimeAdd?: number; lvAdd?: number }
  | {
      t: 'turf';
      gang: GangId | 'all';
      op: 'seed' | 'str' | 'clear' | 'flip' | 'freeze';
      at: Target;
      r?: number;
      v?: number;
      days?: number;
      to?: GangId;
    }
  /** Sets `building.offline = max(offline, days)`, capped at 30. */
  | {
      t: 'offline';
      what: BuildingType[] | 'plant' | 'rail' | 'district' | 'nearTurf';
      n: number | 'all';
      days: number;
      at?: Target;
      r?: number;
      gang?: GangId;
    }
  | { t: 'abandon'; at: Target; r: number; n: number; zone?: 'res' | 'com' | 'ind' }
  /** Abandoned zone tiles → level-0 lots. */
  | { t: 'renew'; at: Target; r: number }
  | { t: 'unlock'; what: Unlockable }
  /** The next n builds of that type cost × mul. `patronExclusive` → foundry (Basalt) or glarewall (Nacre). */
  | { t: 'credit'; what: BuildingType | 'patronExclusive'; n: number; mul: number }
  /** `'+1'` increments; `'$patron'` stores the patron as resolved now. */
  | { t: 'flag'; key: string; v: FlagValue | '+1' | '$patron' }
  | { t: 'floor' | 'ceil'; f: FactionId; v: number }
  | { t: 'pact'; gang: GangId; months: number }
  /** Schedule a beat (as a delayed beat) or a deck follow-up / whisper. `days: 0` = chained. */
  | { t: 'queue'; card: string; days: number }
  /** Show Silt Log n after the current card closes. */
  | { t: 'log'; n: number }
  | { t: 'reveal' }
  | { t: 'news'; text: string; kind: NewsItem['kind'] }
  /** gangActions +1; `crackdown` also sets lastCrackdownTick. */
  | { t: 'gangAction'; crackdown?: boolean }
  | { t: 'countdown'; days: number }
  /** Open the Charter Night screen (§6.1). */
  | { t: 'charterNight' }
  | { t: 'ending'; id: EndingId }
  /** Megacity (MEGACITY §8.2): add n land grants (districts.grants), emit `grant`. */
  | { t: 'grant'; n: number }
  | { t: 'if'; c: Condition; then: Effect[]; else?: Effect[] };

// ── Modifiers (§10.4) ───────────────────────────────────────────────────────

/**
 * City-wide modifiers the sim reads (`world.mods`). Resolved by `resolveMods`
 * (story/resolve.ts) from every story source, then `clampMods`.
 */
export interface SimMods {
  // additive (identity 0)
  demandRes: number;
  demandCom: number;
  demandInd: number;
  crimeAdd: number;
  landValueAdd: number;
  approvalAdd: number;
  /** Trace added each month by the director. */
  traceMonthly: number;
  /** Monthly chance of a LURE-style outage (director). */
  outageChance: number;
  // multiplicative (identity 1)
  crimeMul: number;
  turfCrimeMul: number;
  pollutionMul: number;
  trafficMul: number;
  securityMul: number;
  taxIncomeMul: number;
  taxDemandMul: number;
  upkeepMul: number;
  buildCostMul: number;
  powerSupplyMul: number;
  powerDemandMul: number;
  growthMul: number;
  abandonMul: number;
  eventRateMul: number;
  cardRateMul: number;
  turfSpreadMul: number;
  // min-combined (identity MAX_TAX = 20)
  taxCap: number;
  // keyed
  /** Multiplicative per type (missing = 1). */
  costMul: Partial<Record<BuildingType, number>>;
  /** Multiplicative per type (missing = 1). */
  upkeepMulType: Partial<Record<BuildingType, number>>;
  /** Additive favor per faction per month (missing = 0). */
  favorMonthly: Partial<Record<FactionId, number>>;
}

/** Any SimMods key. "The closed ModKey list" of §0 / §10.4. */
export type ModKey = keyof SimMods;
/** Keys combined by addition. */
export type AdditiveModKey =
  | 'demandRes'
  | 'demandCom'
  | 'demandInd'
  | 'crimeAdd'
  | 'landValueAdd'
  | 'approvalAdd'
  | 'traceMonthly'
  | 'outageChance';
/** Keys combined by multiplication. */
export type MultiplicativeModKey =
  | 'crimeMul'
  | 'turfCrimeMul'
  | 'pollutionMul'
  | 'trafficMul'
  | 'securityMul'
  | 'taxIncomeMul'
  | 'taxDemandMul'
  | 'upkeepMul'
  | 'buildCostMul'
  | 'powerSupplyMul'
  | 'powerDemandMul'
  | 'growthMul'
  | 'abandonMul'
  | 'eventRateMul'
  | 'cardRateMul'
  | 'turfSpreadMul';
/** Scalar (non-keyed) keys. */
export type ScalarModKey = AdditiveModKey | MultiplicativeModKey | 'taxCap';
/** Keyed (per type / per faction) keys. */
export type KeyedModKey = 'costMul' | 'upkeepMulType' | 'favorMonthly';

/** A partial set of modifiers; combined into SimMods by `combine()` (story/mods.ts). */
export type ModPatch = Partial<Omit<SimMods, KeyedModKey>> & {
  costMul?: SimMods['costMul'];
  upkeepMulType?: SimMods['upkeepMulType'];
  favorMonthly?: SimMods['favorMonthly'];
};

// ── Per-tile layers (§10.5) ─────────────────────────────────────────────────

/** Per-tile modifier layers, each Float32Array(world.area). The sim reads `world.layers`. */
export interface SimLayers {
  /** Additive crime (identity 0). */
  crimeAdd: Float32Array;
  /** Additive land value (identity 0). */
  lvAdd: Float32Array;
  /** Max-combined into fields.transit (identity 0). */
  transitAdd: Float32Array;
  /** Multiplicative trip factor (identity 1). */
  tripMul: Float32Array;
  /** Multiplicative abandon / decline chance factor (identity 1). */
  abandonMul: Float32Array;
  /** Multiplicative per-tile tax yield (identity 1). */
  taxMul: Float32Array;
}

/**
 * The three partial layer sets, each written only by its owner, then merged
 * into `world.layers` by `composeLayers(world)`:
 * `turf` → story/turf.ts, `vertical` → story/vertical.ts, `local` → the director.
 */
export interface LayerParts {
  turf: SimLayers;
  vertical: SimLayers;
  local: SimLayers;
}

/** Extra budget lines the story appends to the monthly budget (`world.ledger`). Amounts are positive. */
export interface StoryLedger {
  income: BudgetLine[];
  expense: BudgetLine[];
}

// ── Content types (§10.7) ───────────────────────────────────────────────────

/** A faction mood driver: a ramp over a metric, or a step while a condition holds. */
export type MoodDriver =
  /** `clamp((metric − offset) × mul, min, max)`. */
  | { label: string; m: Metric | Metric[]; offset?: number; mul: number; min: number; max: number }
  /** `value` while `when` holds, else 0. */
  | { label: string; when: Condition; value: number };

export interface Deal {
  id: string;
  name: string;
  /** ≤ 60 chars, shown on the deal button. */
  blurb: string;
  minTier: Tier;
  months: number;
  cooldownDays: number;
  fx: Effect[];
}

export interface Faction {
  id: FactionId;
  name: string;
  short: string;
  kind: 'civic' | 'corp' | 'gang' | 'wildcard';
  color: string;
  sigil: 'ninering' | 'hexcolumn' | 'spiral' | 'hookwave' | 'kite' | 'window';
  leader: string;
  callsYou: string;
  /**
   * Plain-language intro (≤ 160 chars): who they are, what they control and what
   * they want from MOTH. Shown the first time they speak and on "who is this?".
   * Clarity pass addition (docs/PACING.md).
   */
  about?: string;
  startFavor: number;
  visible: Condition;
  teaser?: Condition;
  inPowerBar: boolean;
  /** Summed, clamped ±30. */
  mood: MoodDriver[];
  deal?: Deal;
  exclusive?: BuildingType;
  salt: boolean;
  perk: ModPatch;
  cold: ModPatch;
  /** `pulse` fx run every `pulseEvery` days while Hostile. */
  hostile: { mods: ModPatch; card: string; pulseEvery?: number; pulse?: Effect[] };
}

export interface Choice {
  /** ≤ 40 chars after token fill; ends in a period. */
  label: string;
  requires?: Condition;
  lockedHint?: string;
  fx: Effect[];
  /** ‡ default (exactly one per faction card). */
  default?: true;
}

export interface Card {
  id: string;
  kind: 'beat' | 'faction' | 'hostile' | 'system' | 'log' | 'ending' | 'whisper';
  speaker: FactionId | 'moth' | 'system' | 'lure' | 'patron' | 'rival';
  /** Second faction on a two-faction card (both sigils shown). */
  with?: FactionId;
  /** e.g. 'Oren Sallow'. */
  name?: string;
  /** ≤ 28 chars. */
  title: string;
  /** ≤ 48 chars, monospace. */
  sys?: string;
  /** ≤ 280 chars after token fill. */
  body: string;
  /**
   * Plain-language "What's going on" line (≤ 220 chars after token fill): the
   * situation, who is asking and what is at stake, with no unexplained jargon.
   * The body stays in-voice; this explains it. Clarity pass addition.
   */
  brief?: string;
  when?: Condition;
  spot?: SpotRule;
  weight?: number;
  cooldown?: number;
  once?: boolean;
  /** ★ card: the Silt Log id (7..12) it owns. */
  star?: number;
  /** §7.1 step 4. */
  seasonal?: boolean;
  queuedOnly?: boolean;
  /**
   * The player may open this card from a button (director.openOnDemand, EXPANSION §2.2 / §8.3):
   * no deck slot, no pacing clock moves. It can still come through the deck as usual.
   */
  onDemand?: boolean;
  onShow?: Effect[];
  /** 1..4; 0 for whisper; log and ending cards get an implicit 'Continue.'. */
  choices: Choice[];
}

export interface Goal {
  id: string;
  label: string;
  cond: Condition;
  /** Omitted: hold goals show 'n/N days', others ✓/✗. */
  show?: { m: Metric; target: number; fmt: 'int' | 'pct' | 'x' };
}

export interface Beat {
  card: string;
  after: 'trigger' | 'chain' | { days: number } | { cond: Condition };
  /** §5.0: counts toward completion only once queued. */
  optional?: true;
}

export interface Chapter {
  n: number;
  title: string;
  epigraph: string;
  question: string;
  /**
   * Plain-language chapter intro (≤ 240 chars): what is happening in the city
   * now and what the player should work toward. Clarity pass addition.
   */
  summary?: string;
  /** One-line recap once the chapter is done (≤ 160 chars), for "Story so far". */
  recap?: string;
  trigger: Condition;
  /** Evaluated once daysWaiting ≥ 720; at ≥ 1440 the trigger fires anyway. */
  fallback: Condition;
  onStart?: Effect[];
  beats: Beat[];
  goals: Goal[];
  reward: Effect[];
  log: number;
  /** ≤ 48 chars, e.g. '> +8,000 CR · new: skybridge, ribbon'. */
  rewardSys: string;
}

/** Ending rules, read live while the ending is current (§6.4). */
export interface EndingRules {
  floors?: Partial<Record<FactionId, number>>;
  ceils?: Partial<Record<FactionId, number>>;
  retire?: FactionId[];
  /** e.g. 'Absorbed into Basalt'. */
  retiredLabel?: string;
  permanentPacts?: boolean;
  pactNoLimits?: boolean;
  lockSalt?: boolean;
  lockPacts?: boolean;
  endOffLedger?: boolean;
  retireTrace?: boolean;
  nudge?: boolean;
  /** Checked once, at selection. */
  variant?: { when: Condition; id: 'lamplight'; post: ModPatch; card: string };
}

export interface Ending {
  id: EndingId;
  title: string;
  becomes: string;
  claims: { label: string; cond: Condition; show?: { m: Metric; target: number } }[];
  card: string;
  post: ModPatch;
  rules: EndingRules;
}

/** Gate on a faction / story building (§4.5). Parts are OR-ed; `turf` is AND-ed with the rest. */
export interface BuildingGate {
  unlock?: Unlockable;
  faction?: FactionId;
  tier?: 'friendly' | 'allied';
  turf?: GangId;
  /** Footprint tiles that must sit on `turf` (default 1). */
  minTurfTiles?: number;
  fallbackPop?: number;
  // Megacity (MEGACITY §6.3, §9.2): further AND terms of the gate (WP-2 evaluates them).
  /** That district kind owned, and the footprint inside it. */
  district?: DistrictKind;
  /** A Sky Lobby of at least n towers. */
  lobby?: number;
  /** Districts owned. */
  districts?: number;
  /** Chapters completed. */
  chapter?: number;
  /** The current ending (§9.2). */
  ending?: EndingId;
}

// ── Saved state (§10.8) ─────────────────────────────────────────────────────

/** The whole director state; saved inside `SaveData.story.story`. JSON-safe. */
export interface StoryState {
  v: 1;
  /** 1..6; 7 = epilogue. */
  chapter: number;
  phase: 'waiting' | 'active' | 'countdown' | 'ended';
  chapterTick: number;
  waitingSince: number;
  beatsShown: string[];
  goalsDone: string[];
  goalsWaived: string[];
  /** Hold-condition key → consecutive days held. */
  holds: Record<string, number>;
  favor: Record<FactionId, number>;
  /**
   * Monthly mood per faction (§2.1), saved so standing is continuous across a
   * load (stats are not known until the first sim pass). WP-A addition; missing = 0.
   */
  mood?: Partial<Record<FactionId, number>>;
  floors: Partial<Record<FactionId, number>>;
  ceils: Partial<Record<FactionId, number>>;
  trace: number;
  revealed: boolean;
  traceRaisedThisMonth: boolean;
  /** Silt Log ids owned (1..12). */
  logs: number[];
  flags: Record<string, FlagValue>;
  /** Owned Unlockables (strings so removed content still loads). */
  unlocks: string[];
  /** Card id → tick last shown. */
  seen: Record<string, number>;
  queue: { card: string; tick: number }[];
  pending: { card: string; tick: number; spot: number } | null;
  open: { card: string; spot: number } | null;
  /** until −1 = permanent. */
  mods: { id: string; label: string; until: number; mods: ModPatch }[];
  incomes: { id: string; label: string; perMonth: number; until: number }[];
  locals: { id: string; x: number; y: number; r: number; until: number; crimeAdd: number; lvAdd: number }[];
  credits: { what: BuildingType; n: number; mul: number }[];
  pacts: { gang: GangId; until: number }[];
  deals: Record<string, { until: number; cooldownUntil: number }>;
  /**
   * Active crackdown zones (§3.6), owned by turf.ts (it expires them). `scatterAt` −1 = scatter
   * handled. `base` (WP-C addition, optional): each hit gang's total tiles at the crackdown,
   * for the scatter rule's "lost ≥ 30 tiles".
   */
  crackdowns: {
    x: number;
    y: number;
    r: number;
    until: number;
    scatterAt: number;
    hit: GangId[];
    base?: Partial<Record<GangId, number>>;
  }[];
  /** Precinct building id → tick its crackdown is ready again. */
  precinctReady: Record<number, number>;
  saltReady: Partial<Record<FactionId, number>>;
  /** Build-reaction cap counter. */
  builtCounts: Partial<Record<BuildingType, number>>;
  lastCardTick: number;
  lastHostileTick: number;
  lastHostileBy: Partial<Record<FactionId, number>>;
  lastPulseBy: Partial<Record<FactionId, number>>;
  lastSpeaker: FactionId | null;
  lastBeatTick: number;
  gangActions: number;
  lastCrackdownTick: number;
  /** Offline rail: a tile on the dead network, until tick. */
  railOut: { i: number; until: number }[];
  countdownEnd: number | null;
  ending: EndingId | null;
  endingVariant: 'lamplight' | null;
  endingTick: number | null;
  nextReview: number | null;
  nudgeReady: number;
  /** ch1.lark, ch2.vote, ch3.pier, ch4.brine, ch5.choice → choice index (ending screen icons). */
  keyChoices: Record<string, number>;
  whisperSnap: Partial<Record<FactionId, number>>;
  lastWhisperTick: number;
  lastNoteTick: number;
  noteIdx: number;
  /** Last 60 entries. */
  log: { tick: number; card: string; choice: number | null; auto?: boolean }[];
  /** Own Rng.state, independent of world.rng. */
  rng: number;
  /** Tile index of the Seam, null before both gangs first seed. */
  seam: number | null;
  /**
   * Unpaused real seconds since the last chapter closed (or Ch1 opened): the
   * pace's chapterMinSec floor (STORY_PACE) reads it. Saved so a reload can't reset
   * the floor. WP-A addition; missing = 0.
   */
  chapterSec?: number;
  // ── Pacing pass (docs/PACING.md): saved unpaused clocks, so a reload neither resets nor skips them ──
  /** Unpaused seconds since the current chapter started (the quiet build window). Missing = long ago. */
  sinceStartSec?: number;
  /** Unpaused seconds since the last deck delivery (the deck gap). Missing = 0 (one gap after an old save loads). */
  deckSec?: number;
  /** Unpaused seconds since the last card closed or a story message arrived (the beat gap). Missing = long ago. */
  frontSec?: number;
  /**
   * The story message waiting for the player (a beat, Silt Log or chapter reward that
   * does not open by itself, docs/PACING.md). `read` once it has been opened (its onShow
   * ran and it counts as shown). Chapter progress waits until it is answered. Missing = none.
   */
  waiting?: { card: string; tick: number; spot: number; read?: boolean } | null;
  /** Factions whose intro ("who is this?") the player has seen on a card. Missing = none. */
  met?: FactionId[];
  /** Tick goal waivers started counting in this chapter (720 d in AND the floor met), null before. */
  waiveFrom?: number | null;
  // ── Megacity (MEGACITY §9.6, §3.10). Optional; missing reads as the default. ──
  /**
   * Each ending the city has held and for how long (≤ 32 entries; a review that keeps the ending adds nothing).
   * Missing: a save with an ending reads as one entry `{ id: ending, variant: endingVariant, from: endingTick, to: null }`.
   */
  endingHistory?: { id: EndingId; variant: 'lamplight' | null; from: number; to: number | null }[];
  /** Charter Review callback line ids used (≤ 64). Missing → []. */
  callbacks?: string[];
  /** The story pace this city was last played at (§3.10, §13.2). Missing → the device's pace is kept. */
  pace?: StoryPace;
}

/** Cached turf counts, derived (not saved). Written by story/turf.ts after every update. */
export interface TurfStats {
  /** Tiles owned per gang. */
  tiles: Record<GangId, number>;
  /** Share (0..1) of that gang's tiles with security ≥ 0.5. */
  secured: Record<GangId, number>;
  /** Tile index of the gang's strongest tile, −1 if none. */
  strongest: Record<GangId, number>;
  /** Tiles currently contested. */
  contested: number;
}

/** Gang turf on World (`world.turf`). Plain data so the sim can read it without story imports (§3.1). */
export interface TurfMap {
  /** Uint8Array(world.area): 0 = none, 1 = Undertow, 2 = Kites. */
  owner: Uint8Array;
  /** Uint8Array(world.area): strength 0..100. */
  str: Uint8Array;
  /** Uint8Array(world.area): days left on a contested flag (not saved). */
  contested: Uint8Array;
  /** Seam Truce: rules 1 and 2 are skipped while frozenUntil > tick. */
  frozenUntil: number;
  seeded: Record<GangId, boolean>;
  /** Tick the gang dropped under `TURF.reseedBelow` tiles, −1 when not low. */
  lowSince: Record<GangId, number>;
  /** Derived counts (Step 0 addition; not saved, rebuilt by turf.ts). */
  stats: TurfStats;
}

/** Skybridge between two anchor tiles. Occupies no tiles (`world.links`). */
export interface SkyLink {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Story save block (`SaveData.story`). */
export interface StorySave {
  story: StoryState;
  /** RLE pairs [value, run], value = owner * 128 + str. */
  turf: number[];
  turfMeta: { frozenUntil: number; seeded: Record<GangId, boolean>; lowSince: Record<GangId, number> };
  /** RLE pairs of the rail bitmask. */
  rail: number[];
  links: SkyLink[];
}

/** Things the sim and actions report to the director (`world.signals`, drained by `director.onDay`). */
export type StorySignal =
  | { t: 'action'; tool: string; x: number; y: number }
  | { t: 'built'; type: BuildingType; id: number }
  | { t: 'bulldozed'; fabTiles: number }
  | { t: 'milestone'; pop: number }
  | { t: 'gangSurge'; x: number; y: number; gang: GangId }
  | { t: 'corpGrant'; amount: number };

// ── Vertical caches (derived; Step 0 addition, owner story/vertical.ts) ─────

/** Story metrics refreshed by `vertical.refresh()` (§10.2). */
export interface VerticalMetrics {
  /** Stratablocks with complete stage ≥ 2. */
  stacksStage2: number;
  /** Stratablocks with complete stage ≥ 3 (= `crowns`). */
  stacksStage3: number;
  /** Complete crowns per type. */
  crowns: Record<CrownId, number>;
  /** Active skybridges. */
  skybridges: number;
  railTiles: number;
  /** Max powered stations on one live network. */
  railMaxStations: number;
  railOnTurf: Record<GangId, number>;
}

/** `world.vertical`: derived on load and after rail / link / building changes. Never saved. */
export interface VerticalCache {
  /** Bumped by every refresh, so renderers can tell when to rebuild. */
  version: number;
  /** Ids of links whose anchors are both tall and powered. Others are sealed (drawn dark). */
  activeLinks: Set<number>;
  /** Uint8Array(world.area): 1 = rail tile on a live network. */
  railLive: Uint8Array;
  /** Building ids of stations on a live network. */
  liveStations: Set<number>;
  metrics: VerticalMetrics;
  /** Sky Lobbies (MEGACITY §5.5, WP-2): clusters of ≥ 3 anchors, each its anchor keys (tile indices) and visitors. Empty until WP-2. */
  lobbies: { anchors: number[]; visitors: number }[];
  /** Visitors a month all Sky Lobbies draw (PortSystem adds them to raw visitors, WP-1). */
  lobbyVisitors: number;
}

// ── Building stats (src/game/buildingStats.ts) ──────────────────────────────

/** Stage- and crown-aware per-building numbers (sim, UI and story use these instead of BUILDINGS[type]). */
export interface BuildingStats {
  residents: number;
  jobsCom: number;
  jobsInd: number;
  powerUse: number;
  powerSupply: number;
  upkeep: number;
  effect: ServiceEffect | null;
  radius: number;
  pollution: number;
  /** Road trips the building generates before transit and trip multipliers. */
  trips: number;
  /** Counts as a tall skybridge anchor. */
  tall: boolean;
  /** Counts as a Ribbon Rail station. */
  station: boolean;
}

// ── Results and inspect actions (§11 Game / director API) ──────────────────

/** Result of a player-facing story action (deal, salt, pact, crackdown, raise …). */
export interface ActionResult {
  ok: boolean;
  /** Why it failed (shown as a toast). */
  reason?: string;
  /** Credits charged (0 on failure). */
  cost: number;
}
/** Alias used by the director API in STORY.md §11. */
export type Result = ActionResult;

/** One crown row in the crown picker (§8.8). */
export interface CrownOption {
  id: CrownId;
  name: string;
  /** Effect summary line. */
  summary: string;
  favor: { f: FactionId; v: number }[];
  enabled: boolean;
  reason?: string;
}

/** A button in the inspect panel, from `game.inspectActions(x, y)` (§8.8). */
export interface InspectAction {
  /** Expansion: 'rights' (Spaceport: open the launch-rights card), 'skyway' (skyway sheet: demolish this segment). */
  id: 'crackdown' | 'raise' | 'crown' | 'rights' | 'skyway' | 'frame' | 'bridgeRemove' | 'map';
  label: string;
  cost: number;
  enabled: boolean;
  reason?: string;
  /** The building the action applies to (pass to game.crackdown / game.raiseStage). −1 for 'skyway' (a tile, see x / y). */
  buildingId: number;
  /** Crackdown radius, for the map preview. */
  radius?: number;
  /** Build days of the stage ('raise' / 'crown'). */
  days?: number;
  /** Crown picker rows ('crown' only). */
  crowns?: CrownOption[];
  /** 'skyway' only (expansion): the skyway tile whose segment the action demolishes. */
  x?: number;
  y?: number;
}

// ── View types for UI (§10.9) ───────────────────────────────────────────────

/** Hint chips under a choice / action button. 'maybe' = inside an `if`. */
export type Hint =
  | { k: 'favor'; f: FactionId; dir: 1 | -1; pips: 1 | 2 | 3 }
  | { k: 'cr'; v: number }
  | { k: 'trace'; v: number }
  | { k: 'timed'; months: number }
  | { k: 'unlock' }
  | { k: 'log' }
  | { k: 'maybe' }
  /** Knocks buildings offline (an `offline` effect). */
  | { k: 'offline' }
  /** Empties blocks (an `abandon` effect). */
  | { k: 'abandon' }
  /** Leads to another card (a `queue` of a beat, faction or system card; whispers don't count). */
  | { k: 'follow' }
  /** Opens Charter Night (a `charterNight` effect). */
  | { k: 'charter' };

export interface ActionView {
  label: string;
  cost: number;
  enabled: boolean;
  reason?: string;
  hints: Hint[];
  cooldownDays?: number;
}

export interface CardView {
  id: string;
  kind: Card['kind'];
  faction: FactionId | null;
  with?: FactionId;
  speakerName: string;
  title: string;
  sys?: string;
  body: string;
  canLater: boolean;
  autoInDays?: number;
  /**
   * Unpaused seconds the ‡ default still waits for (it needs autoInDays = 0 AND
   * this = 0), so "auto in 0d" can read as seconds instead. WP-A addition.
   */
  autoInSec?: number;
  choices: { label: string; hints: Hint[]; effectsText: string; locked?: string; isDefault: boolean }[];
  /** Card.brief with tokens filled: the plain-language "What's going on" (clarity pass). */
  brief?: string;
  /** The first card this faction speaks on in this city: show its intro (Faction.about) open. */
  firstMeet?: boolean;
  /** Opened by the player from a banner / the goal chip / COMMS (not forced): it may go back with Later. */
  fromMessage?: boolean;
}

/** A message waiting for the player (pacing pass, docs/PACING.md). */
export interface MessageView {
  id: string;
  /** 'story': a beat, Silt Log or chapter reward (game.openWaiting); 'comms': the pending COMMS card (game.openPending). */
  slot: 'story' | 'comms';
  kind: Card['kind'];
  title: string;
  faction: FactionId | null;
  /** Speaker line, e.g. 'Ilse Marrow' or 'MOTH'. */
  from: string;
  /** Chapter progress waits until it is read (story messages). */
  required: boolean;
}

/** One finished chapter in the goal drawer's "Story so far" (clarity pass). */
export interface ChapterRecapView {
  n: number;
  numeral: string;
  title: string;
  /** Chapter.recap ('' when the content has none). */
  recap: string;
  /** The key choice made in it, as its label (e.g. 'Project a Basalt win.'), if any. */
  choices: string[];
}

/** Plain data for the UI, every token already filled. Cached; rebuilt on story events. */
export interface StoryView {
  chapter: {
    n: number;
    numeral: string;
    title: string;
    question: string;
    phase: StoryState['phase'];
    /**
     * Every goal, required beat and queued optional beat is done but the chapter
     * is still settling (the pace's chapterMinSec of unpaused play since the
     * last chapter closed): whole unpaused seconds left before it closes (≥ 1).
     * Absent otherwise. The director rebuilds the view when this whole second
     * changes, so it ticks between sim days. The goal chip and drawer show it
     * as "closes in m:ss". WP-A addition.
     */
    closesInSec?: number;
    /** Chapter.summary, tokens filled: what is happening now and what to work toward (clarity pass). Absent while the chapter waits to start. */
    summary?: string;
  };
  goals: { id: string; label: string; done: boolean; waived: boolean; now: string; need: string; progress: number }[];
  countdownDays: number | null;
  /** Ch6 drawer and Charter Night. */
  claims: {
    id: EndingId;
    title: string;
    becomes: string;
    ok: boolean;
    rows: { label: string; ok: boolean; gap?: string }[];
  }[];
  factions: {
    id: FactionId;
    name: string;
    leader: string;
    callsYou: string;
    shown: 'yes' | 'silhouette' | 'no';
    tier: Tier;
    standing: number;
    power: number | null;
    drivers: { label: string; value: number }[];
    deal: ActionView | null;
    salt: ActionView | null;
    nudge: ActionView | null;
    exclusive: { type: BuildingType; buildable: boolean; reason?: string } | null;
    penalties: string[];
    retiredLabel?: string;
    claim?: string;
    /** Faction.about (plain-language intro), once visible (clarity pass). */
    about?: string;
  }[];
  trace: { value: number; revealed: boolean; frozen: boolean; retired: boolean };
  /** The open card. */
  card: CardView | null;
  pending: {
    id: string;
    title: string;
    faction: FactionId;
    daysLeft: number;
    secLeft: number;
    /** The pace's full unpaused wait (for the countdown ring). Pacing pass addition. */
    secTotal?: number;
    /** 'faction', 'hostile' (⚑) or 'system'. Pacing pass addition. */
    kind?: Card['kind'];
  } | null;
  /**
   * The arrival cue for the newest message (faction card in COMMS, or a story message):
   * `faction` is null for MOTH, LURE and system speakers. Pacing pass: was faction-only.
   */
  banner: { id: string; title: string; faction: FactionId | null; kind?: Card['kind']; from?: string; slot?: 'story' | 'comms' } | null;
  /** Messages waiting for the player, the story message first (pacing pass). */
  messages: MessageView[];
  /** Finished chapters, oldest first, with their recaps and key choices (clarity pass). */
  storySoFar: ChapterRecapView[];
  /** The story pace in effect (Settings.storyPace). */
  pace: 'relaxed' | 'normal' | 'brisk';
  comms: {
    tick: number;
    date: string;
    card: string;
    title: string;
    choice: string | null;
    auto: boolean;
    whisper?: string;
  }[];
  logs: { n: number; owned: boolean; source: string; title: string; body?: string }[];
  coherence: number;
  unlocked: { factions: boolean; comms: boolean; turfOverlay: boolean };
  ending: { id: EndingId; variant: 'lamplight' | null; keyChoices: { card: string; choice: number }[] } | null;
  titleCard: { numeral: string; title: string; epigraph: string; question: string; coherence: number; summary?: string } | null;
}

/**
 * One mark a story choice left on the map (MEGACITY §9.3): a named place, a plaque line and the decal
 * that draws it. Derived by `marks.ts` `deriveMarks(world)` on load and after story changes; never saved.
 */
export interface Mark {
  /** Stable id, e.g. 'truceWall' (the §9.3 row). */
  id: string;
  /** Tile rect the mark covers (world coordinates). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Plaque line shown in inspect and the Keepsakes list (≤ 90 chars). */
  plaque: string;
  /** Decal id `art/marks.ts` draws (WP-8). */
  decal: string;
}

/** The derived set of marks (`VisualState.marks`). `version` bumps when the set changes. */
export interface Marks {
  list: Mark[];
  version: number;
}

/** Everything story-specific the renderer reads, once per frame (§9). */
export interface VisualState {
  /** 0..1, eases to 1 while a MOTH-speaker card is open. */
  presence: number;
  /** 0..1, = trace / 100 (0 while traceFrozen or after Open Ledger). */
  traceFlicker: number;
  /** The current ending's palette. */
  palette: EndingId | 'lamplight' | null;
  /** 0..1 window-candle density; 1 under Lamplight. */
  candles: number;
  /** flag lure=running. */
  lureCold: boolean;
  revealed: boolean;
  /** flag mural (kt.paint). */
  mural: boolean;
  /** Active crackdown zones, for searchlights. */
  crackdowns: { x: number; y: number; r: number }[];
  /** The derived marks of choices that last (MEGACITY §9, marks.ts deriveMarks; empty until WP-8). */
  marks: Marks;
}
