// ─────────────────────────────────────────────────────────────────────────────
// Shared data model. Every module builds against these types; change them only
// with care (save format, renderer and UI all depend on them).
//
// Story layer (docs/STORY.md §4.1, owner-approved): additive unions and
// optional fields only, so v1 saves keep loading.
//
// Expansion "Roads, Wealth and Ports" (docs/EXPANSION.md §2.1): additive
// unions, `RoadKind`, `WealthTier`, two new Tile fields (saved in tile bits
// 15-19), new Fields / CityStats / ActionPlan members and SaveData v3.
// ─────────────────────────────────────────────────────────────────────────────

import type { CrownId, StorySave } from './story/types';

/** Map is MAP_SIZE × MAP_SIZE tiles. Index = y * MAP_SIZE + x. */
export const MAP_SIZE = 64;

/** Sim time: 1 tick = 1 day. */
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const START_YEAR = 2091;

export enum Terrain {
  Land = 0,
  Water = 1,
}

export enum ZoneType {
  None = 0,
  Residential = 1,
  Commercial = 2,
  Industrial = 3,
}

/**
 * Ground road kinds (EXPANSION §3.1). Stored in Tile.roadKind (save bits 15-17).
 * 0 must stay Street: old saves decode as 0.
 */
export enum RoadKind {
  Street = 0,
  Avenue = 1,
  Highway = 2,
  Alley = 3,
  /** On-ramp: joins a highway to the street grid. Created only by the drag rule (§3.4). */
  Ramp = 4,
}

/** Wealth tier of a zone tile: 0 = $, 1 = $$, 2 = $$$. Set by the sim only (§4). */
export type WealthTier = 0 | 1 | 2;

/** Placeable service / utility / landmark structures (multi-tile footprints). */
export type BuildingType =
  | 'solar'
  | 'reactor'
  | 'plaza'
  | 'precinct'
  | 'clinic'
  | 'datahub'
  | 'maglev'
  | 'spire'
  | 'arcology'
  // Story layer (§4.2, §4.5): vertical, faction and story buildings.
  /** Stratablock, 4×4 megablock raised in stages. */
  | 'stack'
  /** Foundry Spine (Basalt). */
  | 'foundry'
  /** Glarewall (Nacre). */
  | 'glarewall'
  /** Tidemarket (Undertow). */
  | 'tidemarket'
  /** Kite Roost (Glass Kites). */
  | 'roost'
  /** Commons Hall (Charter Board). */
  | 'commons'
  /** Sunk Memorial (story unlock). */
  | 'memorial'
  // Expansion (EXPANSION §2.8, §5, §6.1).
  /** Academy (X1): education coverage that lifts wealth. */
  | 'academy'
  /** Seaport: 4×4 on a straight shore. */
  | 'seaport'
  /** Airport: 6×6, loud, business district. */
  | 'airport'
  /** Spaceport: 6×6 late-game megaproject with a slow build. */
  | 'spaceport';

/**
 * Every selectable tool. Zone tools are 'res' | 'com' | 'ind'. Building tools use the BuildingType id.
 * 'road' stays the Street tool id (the Ch1 boot, the coach CTA and KeyR depend on it); 'avenue',
 * 'highway' and 'alley' lay the other ground kinds, 'skyway' the raised road (EXPANSION §2.1).
 */
export type ToolId =
  | 'inspect'
  | 'bulldoze'
  | 'road'
  | 'res'
  | 'com'
  | 'ind'
  | BuildingType
  | 'skybridge'
  | 'rail'
  | 'avenue'
  | 'highway'
  | 'alley'
  | 'skyway';

/** Data-view overlays the renderer can draw. 'wealth' and 'noise' are expansion views (§7.3). */
export type OverlayId = 'none' | 'power' | 'landValue' | 'crime' | 'pollution' | 'traffic' | 'services' | 'turf' | 'wealth' | 'noise';

/** Coverage effect a service building radiates. 'education' is the Academy's (X1, feeds only the wealth score). */
export type ServiceEffect = 'security' | 'health' | 'net' | 'park' | 'transit' | 'prestige' | 'education';

export interface Tile {
  terrain: Terrain;
  /** Road (on water it is a bridge). A road tile never has a zone or building. */
  road: boolean;
  zone: ZoneType;
  /** Zone development: 0 = empty zoned lot, 1..3 = low/mid/high density. Always 0 when zone = None. */
  level: number;
  /** 0..255 random value re-rolled whenever the tile is (re)built; drives visual variety. */
  variant: number;
  /** A developed zone that has been abandoned (dark windows, no residents/jobs). */
  abandoned: boolean;
  /** Id of the service building covering this tile, or -1. Mutually exclusive with road/zone. */
  buildingId: number;
  /** Set by the simulation's power pass every tick. */
  powered: boolean;
  /** Ticks since this tile last changed level/state (renderer uses it for construction animation). */
  age: number;
  /** Ground road kind (EXPANSION §3). Always RoadKind.Street (0) when `road` is false. */
  roadKind: RoadKind;
  /** Wealth tier (EXPANSION §4). Always 0 when zone = None or level = 0. Abandonment keeps it. */
  wealth: WealthTier;
}

export interface Building {
  id: number;
  type: BuildingType;
  /** Top-left (min x, min y) tile of the footprint. */
  x: number;
  y: number;
  /** Footprint is size × size (from config). */
  size: number;
  /** Tick it was built. */
  builtTick: number;
  /** Ticks remaining offline due to an event (e.g. grid hack). 0 = operating. */
  offline: number;
  /** Whether the building currently receives power (set by sim). Power plants are always powered. */
  powered: boolean;
  // ── Stratablock stage fields (optional; survive the save round trip) ──
  /** Highest stage *started* (1 Plinth, 2 Hab Core, 3 Crown). Complete stage = buildDays > 0 ? stage − 1 : stage. */
  stage?: 1 | 2 | 3;
  /**
   * Days of construction left; > 0 means still building. Stratablocks: the current stage's
   * scaffolding. Spaceport (EXPANSION §5.3): the build countdown (no effects until 0).
   */
  buildDays?: number;
  /** Crown picked for stage 3. */
  crown?: CrownId;
  // ── Expansion port fields (optional; survive the save round trip, EXPANSION §2.5) ──
  /** Seaport only: the side that faces open water. 0 = N (y−1), 1 = E (x+1), 2 = S (y+1), 3 = W (x−1). */
  facing?: 0 | 1 | 2 | 3;
  /** Spaceport only: unpaused real seconds of construction still required (§5.3). Saved. */
  waitSec?: number;
  /** Spaceport only: launches seen so far (0 = the next one is the first). Saved. */
  launches?: number;
}

/**
 * Per-tile scalar fields, all Float32Array(MAP_SIZE*MAP_SIZE) with values in 0..1.
 * Recomputed by the simulation; NOT saved (rebuilt after load via Simulation.recomputeAll()).
 */
export interface Fields {
  landValue: Float32Array;
  pollution: Float32Array;
  crime: Float32Array;
  traffic: Float32Array;
  /** Coverage per service effect, 0..1 (1 = at the building, falling off to 0 at its radius). */
  security: Float32Array;
  health: Float32Array;
  net: Float32Array;
  park: Float32Array;
  transit: Float32Array;
  prestige: Float32Array;
  // ── Expansion (EXPANSION §2.1, §3.9, §4.2). All zeros until the sim fills them. ──
  /** 0..1, from highways, skyways and noisy buildings (§3.9). */
  noise: Float32Array;
  /** 0..1, Academy coverage (X1; all zeros when X1 is cut). */
  education: Float32Array;
  /** 0..1, congestion of the skyway network over each skyway tile, 0 elsewhere. */
  skyTraffic: Float32Array;
  /** 0..1, the wealth score of each zone tile (§4.2), 0 elsewhere. */
  wealth: Float32Array;
  /** 0..1, Airport business-district proximity (§3.9). */
  hub: Float32Array;
  /** 0..1, Seaport proximity (§3.9). */
  sea: Float32Array;
  /** 1 where a Back Alley lies within Chebyshev 1 (§4.4), else 0. */
  alleyNear: Uint8Array;
}

export interface Demand {
  /** Each in -1..1. Positive = growth pressure. */
  res: number;
  com: number;
  ind: number;
}

export interface CityStats {
  population: number;
  /** Jobs filled+open in commercial and industrial zones (plus landmark jobs). */
  jobsCom: number;
  jobsInd: number;
  /** Workers who have a job. */
  employed: number;
  /** 0..1 */
  unemployment: number;
  demand: Demand;
  powerSupply: number;
  powerDemand: number;
  /** Count of developed tiles that are unpowered. */
  unpoweredTiles: number;
  /** Averages over developed tiles, 0..1. */
  avgLandValue: number;
  avgCrime: number;
  avgPollution: number;
  avgTraffic: number;
  /** 0..100 citizen approval. */
  approval: number;
  /** Counts by zone of developed (level ≥ 1, not abandoned) tiles. */
  developed: { res: number; com: number; ind: number };
  abandonedTiles: number;
  // ── Expansion (EXPANSION §2.1). Zeros until the sim fills them. ──
  /** Developed (level ≥ 1, not abandoned) zone tiles by tier, all zones: [$, $$, $$$]. */
  wealth: [number, number, number];
  /** What tiers change against an all-$ city: residents (negative = fewer) and tax CR per month. */
  tierEffect: { residents: number; tax: number };
  /** Mean noise over developed tiles. */
  avgNoise: number;
  /** Ground road tiles by kind (bridges included) and skyway tiles. */
  roads: { street: number; avenue: number; highway: number; alley: number; ramp: number; skyway: number };
  /** Regional link points (X2; 0 when cut). */
  edgeLinks: number;
  /** Visitors per month (X3; 0 when cut). */
  visitors: number;
}

export interface BudgetLine {
  label: string;
  amount: number;
}

export interface BudgetReport {
  /** Projected/last full month figures. */
  income: number;
  expenses: number;
  incomeLines: BudgetLine[];
  expenseLines: BudgetLine[];
  /** Net cash flow of the last 12 months, oldest first (for a sparkline). */
  history: number[];
}

/** News ticker entry. */
export interface NewsItem {
  tick: number;
  text: string;
  kind: 'flavor' | 'info' | 'warn' | 'good' | 'bad';
}

export interface Settings {
  sound: boolean;
  music: boolean;
  rain: boolean;
  /** Animated day/night cycle. When false the city is locked to night. */
  dayNight: boolean;
  /** Render quality: 'low' disables some particles and caps DPR at 1.5 (auto-picked on weak devices). */
  quality: 'low' | 'high';
  showFps: boolean;
  /** Random city events (grid hacks, gang surges, corp investments…). */
  events: boolean;
  /**
   * How often story messages arrive (docs/PACING.md). 'relaxed' (default) leaves
   * the most room to build between chapters; 'brisk' is the original cadence.
   * Older stored settings without it read as 'relaxed'. Never changes sim speed.
   */
  storyPace: StoryPace;
}

/** Story pace setting (docs/PACING.md). */
export type StoryPace = 'relaxed' | 'normal' | 'brisk';
export const STORY_PACES: readonly StoryPace[] = ['relaxed', 'normal', 'brisk'];

/** Result of planning an action without executing it (used for previews and execution). */
export interface ActionPlan {
  tool: ToolId;
  /** Tiles the action touches, with per-tile validity. */
  tiles: { x: number; y: number; ok: boolean }[];
  /** For building tools: the footprint top-left and size. */
  footprint?: { x: number; y: number; size: number };
  /** Total credits the valid part of the action costs (bulldoze can be > 0). */
  cost: number;
  /** True if at least one tile would change and the city can afford it. */
  valid: boolean;
  /** Human-readable reason when invalid (or when some tiles are skipped). */
  reason?: string;
  /**
   * Skybridge preview (tool 'skybridge', story layer): the anchor tiles the bridge
   * would join (normalised to the facing footprint edges) and the gap tiles between.
   */
  span?: { ax: number; ay: number; bx: number; by: number; gap: number };
  /**
   * Ribbon Rail preview (tool 'rail', story layer): the resulting connection mask
   * (N1 E2 S4 W8, joined onto existing track) of each entry in `tiles`, in path order.
   */
  railMasks?: number[];
  // ── Expansion (EXPANSION §2.1, §3.4–§3.7, §5.4, §7.5, §7.7) ──
  /** Road tools: the resulting RoadKind of each entry in `tiles` (ramps included), for the ghost. */
  roadKinds?: number[];
  /** Road tools: tiles that change kind (not new). */
  upgrades?: number;
  /** Road tools: on-ramp tiles this plan creates or converts. */
  ramps?: number;
  /** Skyway: the resulting sky bits (mask | ramp << 4) of each entry in `tiles`. */
  skyMasks?: number[];
  /** Highway drags: developed lots and needsRoad buildings that would lose road access (§3.4). */
  lostAccess?: number;
  /** Highway drags: the tile indices of those lots and building footprints, for the ghost. */
  lostTiles?: number[];
  /** Noisy buildings: developed Hab Block tiles inside the noise reach (§5.4). */
  loudTiles?: number[];
  /** Bulldoze: which layer this drag works on (§3.6). */
  layer?: 'ground' | 'sky';
  /** Bulldoze: credits returned for buildings placed under SAFETY.refundSec ago (Game fills it, §7.7). */
  refund?: number;
  /** The player must tap ✓ before this plan builds (costly building or lost access, §7.7). */
  confirm?: boolean;
  /** A non-blocking note for the action pill, ≤ SAFETY.noteMax (32) characters. `reason` stays for invalid or skipped tiles. */
  note?: string;
}

export interface Selection {
  x: number;
  y: number;
  /** The player tapped the skyway deck over this tile, not the ground (EXPANSION §3.7). */
  sky?: true;
}

/**
 * One tile's undo snapshot (EXPANSION §7.7): the structural fields a road, skyway or
 * zone drag can change. `i` is the tile index; `sky` the skyway bits (mask | ramp << 4).
 */
export interface TileSnap {
  i: number;
  road: boolean;
  roadKind: RoadKind;
  zone: ZoneType;
  level: number;
  sky: number;
}

/** Once-per-city moments (EXPANSION §5.4), saved in SaveData.moments. */
export type MomentId = 'seaport' | 'airport' | 'spaceport' | 'launch';
export const MOMENT_IDS: readonly MomentId[] = ['seaport', 'airport', 'spaceport', 'launch'];

/** Serialized save (JSON-safe). Version 1 (sandbox), 2 (story) and 3 (expansion) all load. */
export interface SaveData {
  /** 1, 2 or 3. */
  version: number;
  cityName: string;
  seed: number;
  tick: number;
  funds: number;
  taxRate: number;
  maxPopulation: number;
  nextBuildingId: number;
  /** Run-length-free compact tile encoding, see World.serialize() (v3: bits 15-17 roadKind, 18-19 wealth). */
  tiles: number[];
  buildings: Building[];
  news: NewsItem[];
  history: number[];
  milestones: number[];
  savedAt: number;
  /** Story layer (v2). Optional: missing or undecodable → fresh story with flag `migrated`. */
  story?: StorySave;
  /** v3: world.sky as [value, run] RLE pairs (story/encode.ts encodeRle), values 0..31. Missing → no skyways. */
  sky?: number[];
  /** v3: once-per-city moments already shown ('seaport', 'airport', 'spaceport', 'launch'). Missing → none. */
  moments?: string[];
}
