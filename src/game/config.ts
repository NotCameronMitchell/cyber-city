import type { BuildingType, ServiceEffect, StoryPace, ToolId } from './types';
import { RoadKind, ZoneType } from './types';
import type { BuildingGate, CorpId, CrownId, FactionId, GangId, ModPatch, Unlockable } from './story/types';

// ─────────────────────────────────────────────────────────────────────────────
// Balance + content definitions. All gameplay numbers live here so tuning is
// one file. Monetary unit is credits ("CR").
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENCY = 'CR';

// ── Megacity scale (docs/MEGACITY.md §4) ─────────────────────────────────────
/**
 * People per v3 person: every head count (residents and jobs of every zone level, building,
 * stage and crown; every population threshold) is × this, every per-head rate ÷ this, so
 * everything per tile and per building (tax, traffic, power, growth, upkeep, prices) is
 * unchanged (§4.1). Saves carry it as SaveData.scale; one without it is × this at load.
 * On top of the units, the density pass raises Market and Fab jobs per tile at L2–L3 and the
 * megastructure premium raises the Hab Core, Crown, Commons crown, Arcology and Corp Spire
 * (§4.1 step 2, §4.2), so a balanced city is about 60% homes; demand per head, tax per job and
 * power per zone tile stay as they were.
 */
export const POP_SCALE = 10;
/**
 * Every price × this (§0, "How price is rescaled"): 1 = per-building parity, the owner's
 * reading to confirm at Step 9. No price reads it yet; a later costOf / upkeepOf will.
 */
export const CR_SCALE = 1;
export const START_FUNDS = 25000;
export const DEFAULT_TAX = 9; // percent
export const MIN_TAX = 0;
export const MAX_TAX = 20;

// The Street row of ROAD_KINDS (expansion); kept for old callers. A contract test pins them equal.
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
    capacity: [0, 140, 480, 1500],
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
    // Density pass (MEGACITY §4.1 step 2, §4.2): offices are denser than v3's ×10 (280 / 900).
    capacity: [0, 80, 380, 1250],
    power: [0, 2, 5, 12],
    pollution: [0, 0.02, 0.05, 0.08],
    levelLandValue: [0.4, 0.65],
    color: '#22e5ff',
    desc: 'Commercial zone. Noodle bars, implant clinics and holo-ad towers.',
  },
  ind: {
    zone: ZoneType.Industrial,
    tool: 'ind',
    name: 'Fab Yards',
    short: 'I',
    cost: 25,
    // Density pass (MEGACITY §4.1 step 2, §4.2): modern fabs are denser than v3's ×10 (340 / 750).
    capacity: [0, 120, 450, 1200],
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
  /**
   * `vertical` (Stratablock) and `faction` (exclusive buildings) are story-layer categories;
   * `transport` (Seaport, Airport, Spaceport) is the expansion's (taxed jobs like landmarks).
   */
  category: 'power' | 'services' | 'landmarks' | 'vertical' | 'faction' | 'transport';
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
  // ── Expansion (docs/EXPANSION.md §2.8). All optional; absent = the old behaviour. ──
  /** Fab share of `jobs`; the rest are Market jobs. Default: all Fab for 'power', none otherwise. */
  jobsInd?: number;
  /** At most this many on the map ("One Airport per city"). */
  maxCount?: number;
  /** 'shore': one full side must face open water (EXPANSION §5.1). */
  site?: 'shore';
  /** Noise `v` at the footprint, falling to 0 at `r` tiles from its edge (§3.9). */
  noise?: { v: number; r: number };
  /** Days under construction after placement; no effects until done (Spaceport, §5.3). */
  buildDays?: number;
  /** Needs a frontable road within ROAD_ACCESS_RANGE of a footprint tile (replaces the `tool === 'stack'` special case). */
  needsRoad?: boolean;
  /** A skyway may pass over and dock into it (§3.7). */
  skyAnchor?: boolean;
  /** Budget line plural ("Academies"); default name + 's'. */
  plural?: string;
  /** Tray card meta line on phones (≤ 22 chars), replacing the generic size · jobs line. */
  meta?: string;
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
    jobs: 400,
    unlockPop: 6000,
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
    jobs: 200,
    unlockPop: 1500,
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
    jobs: 250,
    unlockPop: 4000,
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
    jobs: 100,
    unlockPop: 10000,
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
    jobs: 150,
    unlockPop: 20000,
    color: '#ffe14d',
    station: true,
  },
  spire: {
    type: 'spire',
    name: 'Corp Spire',
    desc: 'Megacorp HQ. 8,000 office jobs, huge prestige.',
    category: 'landmarks',
    size: 2,
    cost: 25000,
    upkeep: 400,
    powerSupply: 0,
    powerUse: 80, // density premium (MEGACITY §4.2): 60 → 80 with 8,000 jobs
    effect: 'prestige',
    radius: 16,
    pollution: 0,
    residents: 0,
    jobs: 8000, // density premium (MEGACITY §4.2): v3 600 × 10 = 6,000 → 8,000
    unlockPop: 50000,
    color: '#ff2bd6',
    tall: true,
    skyAnchor: true,
  },
  arcology: {
    type: 'arcology',
    name: 'Arcology',
    desc: 'Self-contained mega-hab for 40,000 residents.',
    category: 'landmarks',
    size: 3,
    cost: 60000,
    upkeep: 700,
    powerSupply: 0,
    powerUse: 290, // density premium (MEGACITY §4.2): 220 → 290 with 40,000 residents
    effect: 'prestige',
    radius: 12,
    pollution: 0.05,
    residents: 40000, // density premium (MEGACITY §4.2): v3 3,000 × 10 = 30,000 → 40,000
    jobs: 1200,
    unlockPop: 120_000,
    color: '#ffb02e',
    tall: true,
    skyAnchor: true,
  },

  // ── Expansion (docs/EXPANSION.md §2.8, §5, §6.1). Unlocks sit on the population milestones. ──
  academy: {
    type: 'academy',
    name: 'Academy',
    desc: 'Night classes and drone labs. Lifts nearby blocks toward $$ and $$$.',
    category: 'services',
    size: 2,
    cost: 3200,
    upkeep: 140,
    powerSupply: 0,
    powerUse: 8,
    effect: 'education',
    radius: 12,
    pollution: 0,
    residents: 0,
    jobs: 300,
    jobsInd: 0,
    unlockPop: 15000,
    color: '#ffd0a0',
    plural: 'Academies',
    meta: '2×2 · schools',
  },
  seaport: {
    type: 'seaport',
    name: 'Seaport',
    desc: 'Cranes, containers and night ships. Fab trade, some noise, and a back door.',
    category: 'transport',
    size: 4,
    cost: 18000,
    upkeep: 280,
    powerSupply: 0,
    powerUse: 30,
    radius: 0,
    pollution: 0.3,
    residents: 0,
    jobs: 2400,
    jobsInd: 2400,
    unlockPop: 50000,
    color: '#38c8ff',
    site: 'shore',
    maxCount: 2,
    needsRoad: true,
    noise: { v: 0.5, r: 6 },
    meta: '4×4 · shore only',
  },
  airport: {
    type: 'airport',
    name: 'Airport',
    desc: 'Runway and terminal. Business and visitors pour in. So does the noise.',
    category: 'transport',
    size: 6,
    cost: 45000,
    upkeep: 650,
    powerSupply: 0,
    powerUse: 80,
    radius: 0,
    pollution: 0.15,
    residents: 0,
    jobs: 3200,
    jobsInd: 0,
    unlockPop: 120_000,
    color: '#e9f0ff',
    maxCount: 1,
    needsRoad: true,
    skyAnchor: true,
    noise: { v: 0.9, r: 10 },
    meta: '6×6 · loud',
  },
  spaceport: {
    type: 'spaceport',
    name: 'Spaceport',
    desc: 'A launch tower that takes minutes to raise. Then night launches and huge prestige.',
    category: 'transport',
    size: 6,
    cost: 150000,
    upkeep: 1800,
    powerSupply: 0,
    powerUse: 300,
    effect: 'prestige',
    radius: 20,
    pollution: 0.2,
    residents: 0,
    jobs: 5500,
    jobsInd: 2500,
    unlockPop: 300_000,
    color: '#ff8f6b',
    maxCount: 1,
    needsRoad: true,
    buildDays: 240,
    // Step 7 tuning (§10.5, B11): 0.7 r12 cancelled the prestige it brings; the ring is now the pad crews.
    noise: { v: 0.5, r: 8 },
    meta: '6×6 · slow build',
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
    jobs: 4000, // 3,000 Market + 1,000 Fab at stage 1; buildingStats() splits them
    unlockPop: 0,
    color: '#a9b8ff',
    gate: { unlock: 'stack', fallbackPop: 80000 },
    station: true,
    needsRoad: true,
    skyAnchor: true,
  },
  foundry: {
    type: 'foundry',
    name: 'Foundry Spine',
    desc: "Basalt's furnace column. 1000 MW and 2,500 Fab jobs, with smoke.",
    category: 'power',
    size: 3,
    cost: 10000,
    upkeep: 200,
    powerSupply: 1000,
    powerUse: 0,
    radius: 0,
    pollution: 0.5,
    residents: 0,
    jobs: 2500,
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
    jobs: 100,
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
    jobs: 1500, // untaxed
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
    jobs: 300,
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
  // Expansion (EXPANSION §2.8): before 'stack', so slice(-7) stays the story types.
  'academy',
  'seaport',
  'airport',
  'spaceport',
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

/**
 * Population milestones (MEGACITY §4.5): each fires a news item and pays a Board bonus once
 * (`grant` is the bonus in CR; on screen "grant" means only the land grant). The last four
 * need more than one district.
 */
export const MILESTONES: { pop: number; title: string; grant: number }[] = [
  { pop: 1000, title: 'Settlement', grant: 1000 },
  { pop: 5000, title: 'Outpost', grant: 2000 },
  { pop: 15000, title: 'Boomtown', grant: 4000 },
  { pop: 50000, title: 'Neon Metro', grant: 8000 },
  { pop: 120_000, title: 'Megacity', grant: 15000 },
  { pop: 300_000, title: 'Thousand Lamps', grant: 30000 },
  { pop: 600_000, title: 'Night Harbour', grant: 45000 },
  { pop: 1_000_000, title: 'Million Windows', grant: 60000 },
  { pop: 2_000_000, title: 'Neon Coast', grant: 90000 },
  { pop: 4_000_000, title: 'Endless City', grant: 150_000 },
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
/** 3 = expansion (road kinds, wealth tiers, skyways, ports; docs/EXPANSION.md §2.5). World.deserialize accepts 1, 2 and 3. */
export const SAVE_VERSION = 3;
/** Every save version World.deserialize accepts. A higher version is a newer build's save (Game blocks autosave over it). */
export const SAVE_VERSIONS_SUPPORTED: readonly number[] = [1, 2, 3];


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
  // Above the Ch2 trigger (15,000), so the deck stays shut in Ch1 unless it stalls.
  factions: 30000,
  comms: 30000,
  stack: 80000,
  deals: 80000,
  crackdown: 60000,
  pact: 60000,
  turfOverlay: 60000,
  skybridge: 90000,
  rail: 90000,
  crowns: 200_000,
};

/** Gangs and turf (§3). */
export const TURF = {
  /** Each gang holds at most this share of land tiles. */
  capShare: 0.08,
  seedPop: { undertow: 12000, kites: 25000 } as Record<GangId, number>,
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
      // Expansion (EXPANSION §8.4): back alleys and seaports draw the Undertow.
      alleyNear: 0.2,
      alleyRadius: 1,
      seaportNear: 0.2,
      seaportRadius: 6,
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
      // Expansion (EXPANSION §8.4): alleys and skyway decks draw the Kites.
      alleyNear: 0.1,
      alleyRadius: 1,
      skywayNear: 0.15,
      skywayRadius: 1,
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

/**
 * Stage 1 Plinth, 2 Hab Core, 3 Crown. Index = stage − 1. Density premium (MEGACITY §4.2): the
 * Hab Core houses 32,000 (v3 ×10: 16,000; power 80 → 150, upkeep 180 → 260 so the running cost
 * per resident stays near a Hab L3 tile's) and the Crown 6,000 (×10: 4,000), so a full block of
 * 16 tiles houses 38,000 against 24,000 for 16 plain L3 Hab tiles.
 */
export const STACK_STAGES: readonly StackStageDef[] = [
  { name: 'Plinth', cost: 12000, days: 60, res: 0, jobsCom: 3000, jobsInd: 1000, power: 40, upkeep: 120, unlock: 'stack' },
  { name: 'Hab Core', cost: 16000, days: 90, res: 32000, jobsCom: 0, jobsInd: 0, power: 150, upkeep: 260, minLandValue: 0.4 },
  { name: 'Crown', cost: 22000, days: 120, res: 6000, jobsCom: 3000, jobsInd: 0, power: 80, upkeep: 220, prestigeRadius: 10, unlock: 'crowns' },
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
    summary: '+2,500 Fab jobs, smoke at the top.',
    jobsInd: 2500,
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
    summary: '+10,000 residents in cheap floors, approval +3.',
    residents: 10000, // density premium (MEGACITY §4.2): v3 600 × 10 = 6,000 → 10,000
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
export const SALT = { base: 600, perPop: 0.008, favor: 8, trace: 3, cooldown: 90 } as const;

/** Patron perk while flag `patron` is set and the patron's standing ≥ 0 (§2.4). */
export const PATRON_PERK: Record<CorpId, ModPatch> = {
  basalt: { costMul: { reactor: 0.75, stack: 0.75 } },
  nacre: { costMul: { datahub: 0.75, glarewall: 0.75 } },
};

/** Balance-of-power weights (§2.4): power.f = 100 × weight_f / Σ weights. */
export const POWER_WEIGHTS = {
  // Expansion terms (EXPANSION §8.2): launchRights (+150 to the holder), seaports, airports, and
  // the capped alley / skyway terms (weight = min(count × per, max)).
  board: { approval: 3, perPrecinct: 40, perClinic: 40, honestTie: 100, launchRights: 150 },
  basalt: { jobsIndDiv: 80, perReactor: 60, perFoundry: 80, perCrownFoundry: 80, branded: 80, patron: 300, perSeaport: 60, launchRights: 150 },
  nacre: { jobsComDiv: 80, perDatahub: 50, perSpire: 120, perGlarewall: 60, perCrownGlare: 80, patron: 300, perAirport: 80, launchRights: 150 },
  undertow: { perTurfTile: 2, perTidemarket: 100, oneTide: 150, perAlley: 0.25, alleyMax: 60 },
  kites: { perTurfTile: 2, perRoost: 100, perCrownNest: 80, oneTide: 150, perSkywayTile: 0.5, skywayMax: 100, launchRights: 150 },
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
  // Expansion (EXPANSION §2.8, §8.1).
  academy: { board: 2, tuning: 2 },
  seaport: { basalt: 4, undertow: 3 },
  airport: { nacre: 5, board: 2, kites: -3 },
  spaceport: { nacre: 4, basalt: 4, board: 3, kites: 2, tuning: -2 },
};
export const BUILD_REACTION_LIMIT = 5;
/** Per-type overrides of BUILD_REACTION_LIMIT (the memorial reacts once; ports as many times as they can exist). */
export const BUILD_REACTION_LIMIT_BY_TYPE: Partial<Record<BuildingType, number>> = { memorial: 1, seaport: 2, airport: 1, spaceport: 1 };
/** Other favor reactions (§2.6). */
export const OTHER_REACTIONS = {
  /** Bulldozing ≥ fabTiles developed Fab tiles in one gesture. */
  bulldozeFab: { fabTiles: 10, favor: { basalt: -3 } as Partial<Record<FactionId, number>> },
  /** Each population milestone. */
  milestone: { board: 3 } as Partial<Record<FactionId, number>>,
  /** Each random corp grant: + this to the higher-standing corp. */
  corpGrant: 2,
} as const;


// ─────────────────────────────────────────────────────────────────────────────
// Expansion "Roads, Wealth and Ports" (docs/EXPANSION.md §2.8). Numbers are
// tuning knobs (WP-1, then the integration step); names and shapes are contract.
// Every cadence is in unpaused real seconds (§1.3).
// ─────────────────────────────────────────────────────────────────────────────

export interface RoadKindDef {
  kind: RoadKind;
  /** Tool that lays it; null for ramps (made by the drag rule, §3.4). */
  tool: 'road' | 'avenue' | 'highway' | 'alley' | null;
  name: string;
  /** CR per tile on land. */
  cost: number;
  /** CR per tile on water (a bridge); null = can't be on water. */
  bridgeCost: number | null;
  /** CR per tile per month on land / on water. */
  upkeep: number;
  bridgeUpkeep: number;
  /** Trips at which the road reads ~63% congested (replaces the single TRAFFIC_SCALE per tile). */
  capacity: number;
  /** Car speed multiplier (art only). */
  speed: number;
  /** Lots within this Chebyshev range can develop from it; 0 = no frontage. */
  access: number;
  /** Drag-upgrade order (bigger rank replaces smaller); −1 = never by drag. */
  rank: number;
  /** Multiplier on ROAD_POLLUTION. */
  pollution: number;
  unlockPop: number;
  color: string;
  /** Tray card meta line on phones (≤ 22 chars). */
  meta: string;
  desc: string;
}

/** Indexed by RoadKind (ROAD_KINDS[k].kind === k). */
export const ROAD_KINDS: readonly RoadKindDef[] = [
  { kind: RoadKind.Street, tool: 'road', name: 'Street', cost: 15, bridgeCost: 90, upkeep: 0.6, bridgeUpkeep: 3, capacity: 220, speed: 1, access: 3, rank: 1, pollution: 1, unlockPop: 0, color: '#c8d0f0', meta: 'Lots ≤ 3 tiles', desc: 'Streets carry traffic and power. Lots within 3 tiles can grow.' },
  { kind: RoadKind.Avenue, tool: 'avenue', name: 'Avenue', cost: 40, bridgeCost: 200, upkeep: 1.4, bridgeUpkeep: 6, capacity: 480, speed: 1.25, access: 3, rank: 2, pollution: 1, unlockPop: 15000, color: '#6f9bff', meta: '2× traffic · widens', desc: "Wide and lit: twice a street's traffic. Drag over a street to widen it." },
  { kind: RoadKind.Highway, tool: 'highway', name: 'Highway', cost: 90, bridgeCost: 360, upkeep: 3.5, bridgeUpkeep: 12, capacity: 1100, speed: 1.8, access: 0, rank: 3, pollution: 1.4, unlockPop: 50000, color: '#ffb547', meta: '5× traffic · no lots', desc: 'Five streets of traffic, but no lot can use it. Cross it with a street for on-ramps.' },
  { kind: RoadKind.Alley, tool: 'alley', name: 'Back Alley', cost: 6, bridgeCost: null, upkeep: 0.2, bridgeUpkeep: 0, capacity: 90, speed: 0.55, access: 1, rank: 0, pollution: 0.6, unlockPop: 12000, color: '#a07cff', meta: 'Cheap homes · crime', desc: 'Narrow and cheap. Homes beside it stay affordable and hold more people. Crews like the dark.' },
  { kind: RoadKind.Ramp, tool: null, name: 'On-ramp', cost: 60, bridgeCost: null, upkeep: 1.5, bridgeUpkeep: 0, capacity: 480, speed: 1, access: 3, rank: -1, pollution: 1, unlockPop: 50000, color: '#f4f7ff', meta: '', desc: 'Joins the street grid to a highway.' },
];

/** Highway load: trips from frontable roads within `reach` (road steps) of an on-ramp move onto that highway (§3.8). */
export const ROAD_FLOW = { highwayReach: 6, highwayDivert: 0.55 } as const;

/** Static road neighbourhood effects within `radius` (Chebyshev) of the road tile (§3.8). */
export const ROAD_EFFECTS = { radius: 1, avenueLv: 0.03, avenueCrime: -0.03, alleyLv: -0.04, alleyCrime: 0.06 } as const;

/** Skyways (§3.7). */
export const SKYWAY = {
  perTile: 160,
  rampCost: 120,
  upkeep: 3,
  maxDrag: 24,
  bulldozeCost: 5,
  unlockPop: 120_000,
  /** Deck height in world px (rail is 28). Pick slab z 46..56 (§3.7). */
  z: 52,
  capacity: 700,
  reach: 5,
  divert: 0.4,
  /** Share of a docked building's trips that use the skyway. */
  anchorShare: 0.5,
  lvUnder: -0.03,
  lvRamp: 0.04,
  lvRampRadius: 2,
  noise: 0.12,
  noiseRadius: 1,
  color: '#ff5fd2',
  /** Tray card meta line on phones (≤ 22 chars). */
  meta: 'Cars · ramps',
  desc: 'A raised road for cars. Land it on a street, or dock it into a megastructure.',
} as const;

/** Noise effects (§3.9): land value −lv × noise, approval −approval × avgNoise; highway source. */
export const NOISE = { lv: 0.18, approval: 10, highway: 0.45, highwayRadius: 2 } as const;

/** Wealth tiers (§4). Tables are indexed [ZoneType][tier]; row 0 (ZoneType.None) is unused. */
export const WEALTH = {
  /** Score needed to step $→$$ and $$→$$$ (measured start points, §4.2; Step 7 tunes). */
  up: [0.32, 0.46],
  /** Score below which $$→$ and $$$→$$. */
  down: [0.27, 0.4],
  /** Consecutive sampled evaluations (~6 d apart) before a step (≈ 30 d, §1.3). */
  streak: 5,
  capacity: [[1, 1, 1], [1, 0.95, 0.9], [1, 1, 0.95], [1, 0.95, 0.9]],
  tax: [[1, 1, 1], [1, 1.25, 1.6], [1, 1.25, 1.6], [1, 1.3, 1.8]],
  power: [[1, 1, 1], [1, 1.1, 1.3], [1, 1.1, 1.3], [1, 1, 0.9]],
  pollution: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 0.7, 0.35]],
  /** Residents × for a $ Hab Block with alleyNear ("affordable quarter"). */
  affordable: 1.1,
  /**
   * Caps. res/com: ≤ $$ while crime ≥ highMaxCrime, noise ≥ highMaxNoise or pollution ≥ highMaxPollution;
   * ≤ $ while crime ≥ midMaxCrime. res with alleyNear: ≤ $$ (alleyMaxTier). ind: ≤ $$ while crime ≥ indHighMaxCrime.
   */
  caps: { midMaxCrime: 0.5, highMaxCrime: 0.35, highMaxNoise: 0.5, highMaxPollution: 0.3, indHighMaxCrime: 0.45, alleyMaxTier: 1 },
  /** Score weights (§4.2): res/com add to land value; ind has its own base. */
  score: {
    res: { edu: 0.1, transit: 0.06, noise: -0.2 },
    com: { edu: 0.08, transit: 0.08, hub: 0.12, noise: -0.1 },
    ind: { base: 0.22, edu: 0.35, net: 0.2, transit: 0.12, port: 0.1, crime: -0.3 },
  },
  /** Approval + prosperity × share of res developed at $$ or $$$ (no squeeze term; Appendix C). */
  approval: { prosperity: 6 },
  /** Lens swatches $ / $$ / $$$. */
  colors: ['#8a93b8', '#22e5ff', '#ffd84d'],
} as const;

/** Costly or destructive actions (§7.7): confirm at or above confirmCost, undo and refund windows (wall seconds). */
export const SAFETY = { confirmCost: 10000, undoSec: 10, refundSec: 30, noteMax: 32 } as const;

/** X2 regional links (§3.10): points per border road kind, cap, demand per point, art stubs. */
export const EDGE_LINKS = { street: 1, avenue: 2, highway: 3, cap: 12, ind: 250, com: 120, stubs: 4 } as const;

/** X3 tourism (§6.3). */
export const TOURISM = {
  airport: 12000,
  spaceport: 30000,
  perHighCom: 30,
  perEdgePoint: 400,
  landmark: { spire: 1500, arcology: 1000, memorial: 2000 } as Partial<Record<BuildingType, number>>,
  /** CR per visitor a month (MEGACITY §4.3: ÷ POP_SCALE with the visitors, so "Tourism" is unchanged). */
  spend: 0.035,
  comPerVisitor: 0.06,
  crimeHit: 0.8,
  approvalRef: 60,
  moodMin: 0.5,
  moodMax: 1.3,
} as const;

/** Seaport (§5.1). */
export const SEAPORT = { exportJobs: 2600, maxCounted: 2, tradeRate: 0.012, tradeCap: 2000, berthDepth: 2, indScoreRadius: 12, shipCycleSec: 80, snapRadius: 2 } as const;
/** Airport (§5.2). */
/** comJobs: Market demand the Airport adds (Step 7 tuning, §10.5 B9: 240 → 320, the terminal's own job count; ×10 units). */
export const AIRPORT = { comJobs: 3200, hubNear: 6, hubFar: 16, hubFade: 20, planeCycleSec: 36 } as const;
/** Spaceport (§5.3). */
export const SPACEPORT = {
  indJobs: 2000,
  comJobs: 3000,
  income: 1200,
  /** Construction needs both buildDays and this many unpaused real seconds (§5.3). */
  minBuildSec: 240,
  /** Launches: at night (daylight below nightBelow) and at least launchGapSec unpaused seconds apart. */
  launchGapSec: 180,
  nightBelow: 0.3,
  /** The first launch is announced this many seconds ahead, with a Watch button. */
  firstLeadSec: 10,
} as const;
