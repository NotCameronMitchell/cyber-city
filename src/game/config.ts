import type { BuildingType, ServiceEffect, StoryPace, ToolId } from './types';
import { ZoneType } from './types';
import type { BuildingGate, CorpId, CrownId, FactionId, GangId, ModPatch, Unlockable } from './story/types';

// ─────────────────────────────────────────────────────────────────────────────
// Balance + content definitions. All gameplay numbers live here so tuning is
// one file. Monetary unit is credits ("CR").
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENCY = 'CR';
export const START_FUNDS = 25000;
export const DEFAULT_TAX = 9; // percent
export const MIN_TAX = 0;
export const MAX_TAX = 20;

export const ROAD_COST = 15;
export const BRIDGE_COST = 90;
export const ROAD_UPKEEP = 0.6; // per road tile per month
export const BRIDGE_UPKEEP = 3;
export const BULLDOZE_COST = 5; // per non-empty tile; buildings refund nothing
/** Zoned tiles need a road within this many tiles (Chebyshev distance) to develop. */
export const ROAD_ACCESS_RANGE = 3;

export interface ZoneDef {
  zone: ZoneType;
  tool: 'res' | 'com' | 'ind';
  name: string;
  short: string;
  cost: number; // per tile
  /** Residents (res) or jobs (com/ind) at levels 0..3. */
  capacity: [number, number, number, number];
  /** Power draw at levels 0..3. */
  power: [number, number, number, number];
  /** Pollution emitted at levels 0..3 (0..1 scale, before diffusion). */
  pollution: [number, number, number, number];
  /** Minimum land value (0..1) to reach level 2 and 3. */
  levelLandValue: [number, number];
  /** Signature neon colour used by renderer + UI. */
  color: string;
  desc: string;
}

export const ZONES: Record<'res' | 'com' | 'ind', ZoneDef> = {
  res: {
    zone: ZoneType.Residential,
    tool: 'res',
    name: 'Hab Blocks',
    short: 'R',
    cost: 20,
    capacity: [0, 14, 48, 150],
    power: [0, 1, 3, 8],
    pollution: [0, 0, 0.02, 0.05],
    levelLandValue: [0.35, 0.6],
    color: '#ff2bd6',
    desc: 'Residential zone. Stacks of capsule homes that grow into hab towers.',
  },
  com: {
    zone: ZoneType.Commercial,
    tool: 'com',
    name: 'Market Strip',
    short: 'C',
    cost: 30,
    capacity: [0, 8, 28, 90],
    power: [0, 2, 5, 12],
    pollution: [0, 0.02, 0.05, 0.08],
    levelLandValue: [0.4, 0.65],
    color: '#22e5ff',
    desc: 'Commercial zone. Noodle bars, implant clinics and holo-ad towers.',
  },
  ind: {
    zone: ZoneType.Industrial,
    tool: 'ind',
    name: 'Fab District',
    short: 'I',
    cost: 25,
    capacity: [0, 12, 34, 75],
    power: [0, 3, 7, 14],
    pollution: [0, 0.35, 0.6, 0.85],
    levelLandValue: [0, 0],
    color: '#ffb02e',
    desc: 'Industrial zone. Drone fabs and synth-protein vats. Pollutes.',
  },
};

export function zoneDefFor(zone: ZoneType): ZoneDef | null {
  switch (zone) {
    case ZoneType.Residential:
      return ZONES.res;
    case ZoneType.Commercial:
      return ZONES.com;
    case ZoneType.Industrial:
      return ZONES.ind;
    default:
      return null;
  }
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  desc: string;
  /** `vertical` (Stratablock) and `faction` (exclusive buildings) are story-layer categories. */
  category: 'power' | 'services' | 'landmarks' | 'vertical' | 'faction';
  size: number;
  cost: number;
  upkeep: number; // per month
  /** Power supplied (plants only). */
  powerSupply: number;
  powerUse: number;
  /** Coverage effect + radius in tiles (Euclidean, from footprint centre). */
  effect?: ServiceEffect;
  radius: number;
  /** Pollution emitted at the footprint (0..1). */
  pollution: number;
  /** Extra residents / jobs the structure houses. */
  residents: number;
  jobs: number;
  /** City population required to unlock (story-gated entries use 0 plus `gate`). */
  unlockPop: number;
  /** Signature colour. */
  color: string;
  /** Story / faction gate (§4.5): (unlock OR faction tier OR maxPop ≥ fallbackPop) AND the turf rule. */
  gate?: BuildingGate;
  /** Counts as a tall skybridge anchor (§4.3). Stratablocks are tall from complete stage 2. */
  tall?: boolean;
  /** Counts as a Ribbon Rail station (§4.4). */
  station?: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  solar: {
    type: 'solar',
    name: 'Solar Farm',
    desc: 'Clean but modest power. 100 MW.',
    category: 'power',
    size: 2,
    cost: 1500,
    upkeep: 30,
    powerSupply: 100,
    powerUse: 0,
    radius: 0,
    pollution: 0,
    residents: 0,
    jobs: 0,
    unlockPop: 0,
    color: '#4dff9a',
  },
  reactor: {
    type: 'reactor',
    name: 'Fusion Reactor',
    desc: 'Massive output. 1200 MW, some thermal pollution.',
    category: 'power',
    size: 3,
    cost: 8000,
    upkeep: 220,
    powerSupply: 1200,
    powerUse: 0,
    radius: 0,
    pollution: 0.5,
    residents: 0,
    jobs: 40,
    unlockPop: 600,
    color: '#7b5cff',
  },
  plaza: {
    type: 'plaza',
    name: 'Neon Plaza',
    desc: 'Holo-garden. Raises land value, filters smog.',
    category: 'services',
    size: 1,
    cost: 250,
    upkeep: 10,
    powerSupply: 0,
    powerUse: 1,
    effect: 'park',
    radius: 6,
    pollution: 0,
    residents: 0,
    jobs: 0,
    unlockPop: 0,
    color: '#4dff9a',
  },
  precinct: {
    type: 'precinct',
    name: 'Enforcer Precinct',
    desc: 'Drone patrols suppress crime nearby.',
    category: 'services',
    size: 2,
    cost: 2200,
    upkeep: 110,
    powerSupply: 0,
    powerUse: 6,
    effect: 'security',
    radius: 13,
    pollution: 0,
    residents: 0,
    jobs: 20,
    unlockPop: 150,
    color: '#3d7bff',
  },
  clinic: {
    type: 'clinic',
    name: 'Med Clinic',
    desc: 'Street-level medtech. Residents grow faster nearby.',
    category: 'services',
    size: 2,
    cost: 2600,
    upkeep: 120,
    powerSupply: 0,
    powerUse: 8,
    effect: 'health',
    radius: 12,
    pollution: 0,
    residents: 0,
    jobs: 25,
    unlockPop: 400,
    color: '#ff3b5c',
  },
  datahub: {
    type: 'datahub',
    name: 'Data Hub',
    desc: 'Net uplink. Boosts land value and commerce.',
    category: 'services',
    size: 1,
    cost: 1800,
    upkeep: 90,
    powerSupply: 0,
    powerUse: 10,
    effect: 'net',
    radius: 9,
    pollution: 0,
    residents: 0,
    jobs: 10,
    unlockPop: 1000,
    color: '#22e5ff',
  },
  maglev: {
    type: 'maglev',
    name: 'Maglev Station',
    desc: 'Mass transit. Cuts traffic in its radius.',
    category: 'services',
    size: 2,
    cost: 3500,
    upkeep: 150,
    powerSupply: 0,
    powerUse: 12,
    effect: 'transit',
    radius: 11,
    pollution: 0,
    residents: 0,
    jobs: 15,
    unlockPop: 2000,
    color: '#ffe14d',
    station: true,
  },
  spire: {
    type: 'spire',
    name: 'Corp Spire',
    desc: 'Megacorp HQ. 600 office jobs, huge prestige.',
    category: 'landmarks',
    size: 2,
    cost: 25000,
    upkeep: 400,
    powerSupply: 0,
    powerUse: 60,
    effect: 'prestige',
    radius: 16,
    pollution: 0,
    residents: 0,
    jobs: 600,
    unlockPop: 5000,
    color: '#ff2bd6',
    tall: true,
  },
  arcology: {
    type: 'arcology',
    name: 'Arcology',
    desc: 'Self-contained mega-hab for 3000 residents.',
    category: 'landmarks',
    size: 3,
    cost: 60000,
    upkeep: 700,
    powerSupply: 0,
    powerUse: 220,
    effect: 'prestige',
    radius: 12,
    pollution: 0.05,
    residents: 3000,
    jobs: 120,
    unlockPop: 12000,
    color: '#ffb02e',
    tall: true,
  },

  // ── Story layer (§4.2, §4.5) ─────────────────────────────────────────────
  // Gated entries use unlockPop 0; lockedReason() reads `gate` instead.
  stack: {
    type: 'stack',
    name: 'Stratablock',
    desc: 'Homes, shops and jobs, stacked. Raise it stage by stage.',
    category: 'vertical',
    size: 4,
    cost: 12000, // stage 1 (Plinth); later stages are charged by raiseStage (STACK_STAGES)
    upkeep: 120,
    powerSupply: 0,
    powerUse: 40,
    radius: 0,
    pollution: 0,
    residents: 0,
    jobs: 400, // 300 Market + 100 Fab at stage 1; buildingStats() splits them
    unlockPop: 0,
    color: '#a9b8ff',
    gate: { unlock: 'stack', fallbackPop: 8000 },
    station: true,
  },
  foundry: {
    type: 'foundry',
    name: 'Foundry Spine',
    desc: "Basalt's furnace column. 1000 MW and 250 Fab jobs, with smoke.",
    category: 'power',
    size: 3,
    cost: 10000,
    upkeep: 200,
    powerSupply: 1000,
    powerUse: 0,
    radius: 0,
    pollution: 0.5,
    residents: 0,
    jobs: 250,
    unlockPop: 0,
    color: '#ff7b2e',
    gate: { unlock: 'foundry', faction: 'basalt', tier: 'friendly' },
  },
  glarewall: {
    type: 'glarewall',
    name: 'Glarewall',
    desc: "Nacre's light tower. Prestige, brighter corners, fewer muggings.",
    category: 'faction',
    size: 1,
    cost: 3000,
    upkeep: 40,
    powerSupply: 0,
    powerUse: 15,
    effect: 'prestige',
    radius: 6,
    pollution: 0,
    residents: 0,
    jobs: 10,
    unlockPop: 0,
    color: '#ffc6f1',
    gate: { unlock: 'glarewall', faction: 'nacre', tier: 'friendly' },
    tall: true,
  },
  tidemarket: {
    type: 'tidemarket',
    name: 'Tidemarket',
    desc: 'Salvage stalls on Undertow turf. Off-ledger cash, rougher streets.',
    category: 'faction',
    size: 2,
    cost: 2000,
    upkeep: 0,
    powerSupply: 0,
    powerUse: 4,
    radius: 0,
    pollution: 0,
    residents: 0,
    jobs: 150, // untaxed
    unlockPop: 0,
    color: '#b6ff2e',
    gate: { faction: 'undertow', tier: 'friendly', turf: 'undertow', minTurfTiles: 3 },
  },
  roost: {
    type: 'roost',
    name: 'Kite Roost',
    desc: 'Rooftop relay on Kites turf. Free signal for the block.',
    category: 'faction',
    size: 1,
    cost: 900,
    upkeep: 0,
    powerSupply: 0,
    powerUse: 3,
    effect: 'net',
    radius: 8,
    pollution: 0,
    residents: 0,
    jobs: 0,
    unlockPop: 0,
    color: '#c9a2ff',
    gate: { faction: 'kites', tier: 'friendly', turf: 'kites', minTurfTiles: 1 },
  },
  commons: {
    type: 'commons',
    name: 'Commons Hall',
    desc: 'A public hall with the doors left open. Parks and goodwill.',
    category: 'faction',
    size: 2,
    cost: 6000,
    upkeep: 80,
    powerSupply: 0,
    powerUse: 6,
    effect: 'park',
    radius: 8,
    pollution: 0,
    residents: 0,
    jobs: 30,
    unlockPop: 0,
    color: '#cfe3ff',
    gate: { faction: 'board', tier: 'friendly' },
  },
  memorial: {
    type: 'memorial',
    name: 'Sunk Memorial',
    desc: 'Eleven thousand names, lit from below.',
    category: 'landmarks',
    size: 1,
    cost: 2500,
    upkeep: 10,
    powerSupply: 0,
    powerUse: 1,
    effect: 'park',
    radius: 6,
    pollution: 0,
    residents: 0,
    jobs: 0,
    unlockPop: 0,
    color: '#8fe3ff',
    gate: { unlock: 'memorial' },
  },
};

export const BUILDING_ORDER: BuildingType[] = [
  'solar',
  'reactor',
  'plaza',
  'precinct',
  'clinic',
  'datahub',
  'maglev',
  'spire',
  'arcology',
  'stack',
  'foundry',
  'glarewall',
  'tidemarket',
  'roost',
  'commons',
  'memorial',
];

export function isBuildingTool(tool: ToolId): tool is BuildingType {
  return tool in BUILDINGS;
}

export function isZoneTool(tool: ToolId): tool is 'res' | 'com' | 'ind' {
  return tool === 'res' || tool === 'com' || tool === 'ind';
}

/** Population milestones: each fires a news item + bonus grant once. */
export const MILESTONES: { pop: number; title: string; grant: number }[] = [
  { pop: 100, title: 'Settlement', grant: 1000 },
  { pop: 500, title: 'Outpost', grant: 2000 },
  { pop: 1500, title: 'Boomtown', grant: 4000 },
  { pop: 5000, title: 'Neon Metro', grant: 8000 },
  { pop: 12000, title: 'Megacity', grant: 15000 },
  { pop: 30000, title: 'Thousand Lamps', grant: 30000 },
];

/** Simulation speeds: ticks (days) per real second, index = speed setting 0..3. */
export const SPEED_TICKS_PER_SEC = [0, 2, 6, 16];

/** Real seconds for one full visual day/night cycle at speed 1 (scaled by speed, paused at 0). */
export const DAY_CYCLE_SECONDS = 240;

/** Unchanged from v1 so old saves are found and migrated in place. */
export const SAVE_KEY = 'cybercity.save.v1';
export const SETTINGS_KEY = 'cybercity.settings.v1';
/** Endings gallery, kept across saves (§6.3). */
export const GALLERY_KEY = 'cybercity.gallery.v1';
/** 2 = story layer. World.deserialize accepts 1 and 2. */
export const SAVE_VERSION = 2;
/** Every save version World.deserialize accepts. */
export const SAVE_VERSIONS_SUPPORTED: readonly number[] = [1, 2];


// ─────────────────────────────────────────────────────────────────────────────
// Story layer tables ("Who Holds the Charter", docs/STORY.md §2–§5, §14).
// Numbers are tuning knobs; keep the export names and shapes.
// ─────────────────────────────────────────────────────────────────────────────

/** Display labels and colours for every faction (content/factions.ts holds the full sheets). */
export const FACTION_LABELS: Record<FactionId, { name: string; short: string; color: string }> = {
  board: { name: 'Charter Board', short: 'Board', color: '#cfe3ff' },
  basalt: { name: 'Basalt Consolidated', short: 'Basalt', color: '#ff7b2e' },
  nacre: { name: 'Nacre', short: 'Nacre', color: '#ffc6f1' },
  undertow: { name: 'The Undertow', short: 'Undertow', color: '#b6ff2e' },
  kites: { name: 'The Glass Kites', short: 'Kites', color: '#c9a2ff' },
  tuning: { name: 'The Tuning', short: 'Tuning', color: '#fff3c4' },
};

/** Faction ids in display order. */
export const FACTION_IDS: readonly FactionId[] = ['board', 'basalt', 'nacre', 'undertow', 'kites', 'tuning'];
export const GANG_IDS: readonly GangId[] = ['undertow', 'kites'];
export const CORP_IDS: readonly CorpId[] = ['basalt', 'nacre'];
/** `world.turf.owner` codes: 0 = none. */
export const TURF_OWNER: Record<GangId, 1 | 2> = { undertow: 1, kites: 2 };
/** Reverse of TURF_OWNER, indexed by owner code. */
export const TURF_GANG: readonly (GangId | null)[] = [null, 'undertow', 'kites'];
/** News name of each gang ("the Undertow" / "the Glass Kites"), ≤ 15 chars. */
export const GANG_NEWS_NAME: Record<GangId, string> = { undertow: 'the Undertow', kites: 'the Glass Kites' };

/** Start favor (§2.1). */
export const START_FAVOR: Record<FactionId, number> = { board: 10, basalt: 0, nacre: 0, undertow: -10, kites: -10, tuning: 0 };

/** Standing, tiers, mood and drift (§2.1). */
export const STANDING = {
  min: -100,
  max: 100,
  /** Tier lower bounds: hostile ≤ −60, cold ≤ −20, friendly ≥ 20, allied ≥ 60. */
  hostile: -60,
  cold: -20,
  friendly: 20,
  allied: 60,
  /** Mood is summed then clamped to ±moodCap. */
  moodCap: 30,
  /** Monthly drift: if |favor| > driftAbove, favor moves `drift` toward 0. */
  driftAbove: 30,
  drift: 1,
} as const;

/** Trace thresholds (§2.5). */
export const TRACE = {
  max: 100,
  /** Falls by this much in a month nothing raised it. */
  monthlyDecay: 1,
  /** Audit cards eligible; Tuning silhouette row. */
  audit: 25,
  /** Tuning activates; kt.file eligible. */
  tuningActive: 40,
  /** Ch5 may trigger early. */
  earlyCh5: 70,
} as const;

/** Coherence = min(max, base + perLog × Silt Logs) (§1.3). */
export const COHERENCE = { base: 4, perLog: 8, max: 100 } as const;

/** Card, beat and chapter pacing (§5.0, §7.1). Seconds are unpaused real seconds. */
export const STORY_PACING = {
  cardChance: 0.35,
  minDaysBetween: 60,
  /** Unpaused seconds between deck deliveries for urgent system cards (bailout, the Clip); faction cards use the pace. */
  systemGapSec: 120,
  beatMuteDays: 30,
  pendingDays: 20,
  /** A Hostile faction's ⚑ repeats at most this often; never in two deck slots running (pacing.ts). */
  hostileEvery: 360,
  hostileGap: 60,
  seasonalGapDays: 300,
  starRetryDays: 240,
  defaultCooldown: 360,
  defaultWeight: 10,
  fallbackDays: 720,
  hardFallbackDays: 1440,
  beatFallbackDays: 360,
  /** Goal waivers start once the chapter has run this many days AND its real-time floor is met. */
  waiverAfterDays: 720,
  waiverEveryDays: 360,
  bootDelaySec: 8,
  bootLoadDelaySec: 20,
  whisperEvery: 60,
  noteEvery: 45,
  reviewEvery: 1080,
  nudgeEvery: 360,
  nudgeFavor: 15,
  bailoutFunds: -5000,
  bailoutCooldown: 360,
  logKeep: 60,
} as const;

/**
 * Per-pace story pacing (Settings.storyPace, docs/PACING.md). Every clock here is
 * unpaused real seconds at any sim speed, so speed 3 never compresses the story.
 */
export interface PaceTuning {
  /** Unpaused seconds between chapter completions (the boot counts as one); also holds Ch6's first count. */
  chapterMinSec: number;
  /** Quiet build window after a chapter title: no faction / ⚑ cards (urgent system cards still come). */
  quietSec: number;
  /** Unpaused seconds between faction deck deliveries. */
  minActiveSecBetween: number;
  /** Unpaused seconds between story cards (counted from the last close); direct replies to a choice skip it. */
  beatGapSec: number;
  /** Cards that may open in a row after a close (1 = no chains; direct replies always follow). */
  maxChain: number;
  /** Unpaused seconds a COMMS card waits before its ‡ default (and pendingDays sim days). */
  pendingMinSec: number;
  /** Multiplier on cardChance for the weighted random draw (§7.1 step 5). */
  cardChanceMul: number;
}

export const STORY_PACE: Record<StoryPace, PaceTuning> = {
  // ≥ 24 min a chapter, 5 quiet minutes after each title, a faction card at most every 15 min:
  // about 12 cards an hour in all (a chapter's own beats and logs are ~10 of them).
  relaxed: { chapterMinSec: 1440, quietSec: 300, minActiveSecBetween: 900, beatGapSec: 90, maxChain: 1, pendingMinSec: 300, cardChanceMul: 0.5 },
  // ≥ 14 min a chapter, 3 quiet minutes, a faction card at most every 9 min: about 20 cards an hour.
  normal: { chapterMinSec: 840, quietSec: 180, minActiveSecBetween: 540, beatGapSec: 45, maxChain: 1, pendingMinSec: 180, cardChanceMul: 0.6 },
  // The original cadence: one chapter per 10 min, a faction card every 2 min, chains of 2 (~40 cards an hour).
  brisk: { chapterMinSec: 600, quietSec: 0, minActiveSecBetween: 120, beatGapSec: 10, maxChain: 2, pendingMinSec: 60, cardChanceMul: 1 },
};

/** The pace for a stored value (anything unknown reads as the default, 'relaxed'). */
export function paceOf(v: unknown): StoryPace {
  return v === 'normal' || v === 'brisk' ? v : 'relaxed';
}

/** Population fallbacks for story unlocks (§5.0); others are story or faction only. */
export const UNLOCK_FALLBACK_POP: Partial<Record<Unlockable, number>> = {
  // Above the Ch2 trigger (1,500), so the deck stays shut in Ch1 unless it stalls.
  factions: 3000,
  comms: 3000,
  stack: 8000,
  deals: 8000,
  crackdown: 6000,
  pact: 6000,
  turfOverlay: 6000,
  skybridge: 9000,
  rail: 9000,
  crowns: 20000,
};

/** Gangs and turf (§3). */
export const TURF = {
  /** Each gang holds at most this share of land tiles. */
  capShare: 0.08,
  seedPop: { undertow: 1200, kites: 2500 } as Record<GangId, number>,
  seedStr: 60,
  seedMinAff: 0.55,
  holdPivot: 0.35,
  holdGain: 40,
  securityHard: 0.6,
  securityPenalty: 20,
  /** Security level that counts a tile as "secured" (turfSecured metric, mood drivers). */
  securedAt: 0.5,
  spreadMin: 50,
  claimAff: 0.45,
  claimStr: 30,
  claimChance: 0.6,
  contestHit: 15,
  contestCost: 5,
  flipStr: 20,
  contestDays: 30,
  reseedBelow: 9,
  reseedDays: 180,
  crimePerStr: 0.18,
  contestCrime: 0.12,
  resLvPerStr: -0.04,
  taxSkim: 0.3,
  streetTake: 4,
  pactCut: 0.4,
  pactCrimeMul: 0.6,
  alliedCrimeMul: 0.5,
  coldSpreadMul: 1.5,
  /** abandonMul by the gang's standing: < friendly → notFriendly, allied → allied, else 1. */
  abandon: { notFriendly: 1.5, allied: 0.5 },
  demandPer100: 0.04,
  /** Protected radius per anchor; protected tiles can't drop below protectFloor from the hold rule. */
  protect: { tidemarket: 4, roost: 3, nest: 2 },
  protectFloor: 50,
  /** Pact spread limits (§3.6). */
  pact: { months: 12, noSpreadLandValue: 0.5, noSpreadRadius: 4, traceMonthly: 1, favorDrift: 1 },
  /** gangSurge incident (§3.2). */
  surge: { str: 30, radius: 2, claimStr: 30, searchRadius: 8 },
  /** Affinity coefficients (§3.3); `[...]` terms are 0/1 indicators. */
  affinity: {
    undertow: {
      base: 0.25,
      crime: 0.5,
      pollution: 0.3,
      lowLandValue: 0.3,
      abandonedNear: 0.3,
      abandonedRadius: 1,
      waterNear: 0.15,
      waterRadius: 3,
      fab: 0.15,
      security: -0.9,
      ribbonNear: -0.3,
      ribbonRadius: 1,
    },
    kites: {
      base: 0.15,
      crime: 0.5,
      traffic: 0.25,
      net: 0.25,
      dense: 0.2,
      tallNear: 0.2,
      tallRadius: 3,
      spanRadius: 1,
      security: -0.9,
      glarewallNear: -0.3,
      glarewallRadius: 4,
    },
  },
  crackdown: {
    cost: 2000,
    hit: 60,
    monthly: 30,
    days: 60,
    crime: 0.08,
    cooldown: 90,
    scatterDays: 90,
    scatterLoss: 30,
    scatterSecurity: 0.4,
    scatterStr: 50,
    /** A gang with ≥ minTiles in the zone takes favorHit and loses its pact (pactBreak more). */
    minTiles: 5,
    favorHit: -15,
    pactBreak: -25,
    board: 6,
    tuning: -5,
    tuningMoodDays: 180,
    trace: 1,
    approvalCrime: 0.35,
    approval: 2,
    approvalDays: 90,
  },
  /** The Seam Truce (Ch3). */
  truce: { days: 720, turfCrimeMul: 0.6 },
};

/** One Stratablock stage (§4.2). Capacity, power and upkeep count once complete. */
export interface StackStageDef {
  name: string;
  cost: number;
  days: number;
  res: number;
  jobsCom: number;
  jobsInd: number;
  power: number;
  upkeep: number;
  /** Footprint average land value needed to start the stage. */
  minLandValue?: number;
  /** Prestige coverage radius once complete. */
  prestigeRadius?: number;
  /** Story unlock needed to start the stage (fallback in UNLOCK_FALLBACK_POP). */
  unlock?: Unlockable;
}

/** Stage 1 Plinth, 2 Hab Core, 3 Crown. Index = stage − 1. */
export const STACK_STAGES: readonly StackStageDef[] = [
  { name: 'Plinth', cost: 12000, days: 60, res: 0, jobsCom: 300, jobsInd: 100, power: 40, upkeep: 120, unlock: 'stack' },
  { name: 'Hab Core', cost: 16000, days: 90, res: 1600, jobsCom: 0, jobsInd: 0, power: 80, upkeep: 180, minLandValue: 0.4 },
  { name: 'Crown', cost: 22000, days: 120, res: 400, jobsCom: 300, jobsInd: 0, power: 80, upkeep: 220, prestigeRadius: 10, unlock: 'crowns' },
];
/** Each existing stack multiplies the plinth cost by this. */
export const STACK_COST_SCALE = 1.15;
/** Share of matched residents who work inside and make no road trips. */
export const STACK_INTERNAL = 0.6;
/** Shadeside effect around a Hab Core (§4.2). */
export const STACK_SHADESIDE = { radius: 2, resLv: -0.04, comLv: 0.03 } as const;

/** A Stratablock crown (§4.2). Building-level numbers feed buildingStats(); layers and mods feed vertical.ts. */
export interface CrownDef {
  id: CrownId;
  name: string;
  /** Effect summary for the crown picker. */
  summary: string;
  jobsInd?: number;
  residents?: number;
  /** Pollution at the footprint. */
  pollution?: number;
  lvAdd?: number;
  lvRadius?: number;
  /** City-wide patch per complete crown of this type. */
  mods?: ModPatch;
  /** Kites turf protection radius. */
  turfProtect?: number;
  /** One-time favor when picked. */
  favor: Partial<Record<FactionId, number>>;
  /** Power-share weight it adds (display; POWER_WEIGHTS holds the live numbers). */
  power?: { f: FactionId; v: number };
  /** Standing needed to pick it. */
  requires?: { f: FactionId; standing: number };
}

export const CROWNS: Record<CrownId, CrownDef> = {
  foundry: {
    id: 'foundry',
    name: 'Foundry',
    summary: '+250 Fab jobs, smoke at the top.',
    jobsInd: 250,
    pollution: 0.15,
    favor: { basalt: 8 },
    power: { f: 'basalt', v: 80 },
  },
  glare: {
    id: 'glare',
    name: 'Glare',
    summary: 'Land value +8% nearby, tax income ×1.02.',
    lvAdd: 0.08,
    lvRadius: 8,
    mods: { taxIncomeMul: 1.02 },
    favor: { nacre: 8, kites: -5 },
    power: { f: 'nacre', v: 80 },
  },
  nest: {
    id: 'nest',
    name: 'Kite Nest',
    summary: 'Shelters Kites turf, Trace −1 a month.',
    turfProtect: 2,
    mods: { traceMonthly: -1 },
    favor: { kites: 10, nacre: -8 },
    power: { f: 'kites', v: 80 },
    requires: { f: 'kites', standing: 20 },
  },
  commons: {
    id: 'commons',
    name: 'Commons',
    summary: '+600 affordable homes, approval +3.',
    residents: 600,
    mods: { approvalAdd: 3 },
    favor: { board: 8, tuning: 4 },
  },
};

/** Skybridges (§4.3). */
export const SKYBRIDGE = {
  base: 1200,
  perTile: 300,
  upkeepBase: 15,
  upkeepPerTile: 3,
  minGap: 2,
  maxGap: 8,
  maxPerAnchor: 2,
  lv: 0.05,
  lvRadius: 3,
  tripMul: 0.8,
  comPer: 0.01,
  comCap: 0.08,
  clusterPer: 0.02,
  clusterCap: 0.06,
  /** Kites affinity bonus within spanRadius of a span. */
  kitesAffinity: 0.2,
} as const;

/** Ribbon Rail (§4.4). */
export const RIBBON = {
  perTile: 110,
  perWaterTile: 330,
  upkeep: 1.2,
  maxDrag: 32,
  transit: 0.5,
  stationRadiusAdd: 3,
  stackStationRadius: 7,
  tripMul: 0.8,
  tripRadius: 2,
  stationLv: 0.04,
  stationLvRadius: 3,
  underResLv: -0.02,
  turfHit: 10,
  /** Live line needs this many distinct powered stations. */
  minStations: 2,
  bulldozeCost: 5,
} as const;

/**
 * Salt (bribe), per faction row (§2.6). Cost = round100(base + perPop × pop).
 * Owner decision: late-game money is the reward for a well-built city, so the
 * price never scales with the treasury. Trace and the cooldown are the limits.
 */
export const SALT = { base: 600, perPop: 0.08, favor: 8, trace: 3, cooldown: 90 } as const;

/** Patron perk while flag `patron` is set and the patron's standing ≥ 0 (§2.4). */
export const PATRON_PERK: Record<CorpId, ModPatch> = {
  basalt: { costMul: { reactor: 0.75, stack: 0.75 } },
  nacre: { costMul: { datahub: 0.75, glarewall: 0.75 } },
};

/** Balance-of-power weights (§2.4): power.f = 100 × weight_f / Σ weights. */
export const POWER_WEIGHTS = {
  board: { approval: 3, perPrecinct: 40, perClinic: 40, honestTie: 100 },
  basalt: { jobsIndDiv: 8, perReactor: 60, perFoundry: 80, perCrownFoundry: 80, branded: 80, patron: 300 },
  nacre: { jobsComDiv: 8, perDatahub: 50, perSpire: 120, perGlarewall: 60, perCrownGlare: 80, patron: 300 },
  undertow: { perTurfTile: 2, perTidemarket: 100, oneTide: 150 },
  kites: { perTurfTile: 2, perRoost: 100, perCrownNest: 80, oneTide: 150 },
} as const;

/** One-off favor when the player places a building (§2.6). Only the first BUILD_REACTION_LIMIT of a type count. */
export const FACTION_BUILD_REACTIONS: Partial<Record<BuildingType, Partial<Record<FactionId, number>>>> = {
  reactor: { basalt: 2, tuning: -1 },
  solar: { tuning: 1 },
  precinct: { board: 2, undertow: -2, kites: -2 },
  clinic: { board: 1, tuning: 2 },
  plaza: { tuning: 1 },
  datahub: { nacre: 2, kites: 1 },
  maglev: { board: 1 },
  spire: { nacre: 6, basalt: 2, undertow: -2 },
  arcology: { board: 3, nacre: 2 },
  stack: { basalt: 3 },
  glarewall: { nacre: 3, kites: -3 },
  foundry: { basalt: 5, tuning: -2 },
  tidemarket: { undertow: 5, board: -3 },
  roost: { kites: 5, nacre: -3 },
  commons: { board: 5 },
  memorial: { undertow: 10, tuning: 5 },
};
export const BUILD_REACTION_LIMIT = 5;
/** Per-type overrides of BUILD_REACTION_LIMIT (the memorial reacts once). */
export const BUILD_REACTION_LIMIT_BY_TYPE: Partial<Record<BuildingType, number>> = { memorial: 1 };
/** Other favor reactions (§2.6). */
export const OTHER_REACTIONS = {
  /** Bulldozing ≥ fabTiles developed Fab tiles in one gesture. */
  bulldozeFab: { fabTiles: 10, favor: { basalt: -3 } as Partial<Record<FactionId, number>> },
  /** Each population milestone. */
  milestone: { board: 3 } as Partial<Record<FactionId, number>>,
  /** Each random corp grant: + this to the higher-standing corp. */
  corpGrant: 2,
} as const;
