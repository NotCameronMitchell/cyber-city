// ─────────────────────────────────────────────────────────────────────────────
// Shared data model. Every module builds against these types; change them only
// with care (save format, renderer and UI all depend on them).
//
// Story layer (docs/STORY.md §4.1, owner-approved): additive unions and
// optional fields only, so v1 saves keep loading.
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
  | 'memorial';

/** Every selectable tool. Zone tools are 'res' | 'com' | 'ind'. Building tools use the BuildingType id. */
export type ToolId = 'inspect' | 'bulldoze' | 'road' | 'res' | 'com' | 'ind' | BuildingType | 'skybridge' | 'rail';

/** Data-view overlays the renderer can draw. */
export type OverlayId = 'none' | 'power' | 'landValue' | 'crime' | 'pollution' | 'traffic' | 'services' | 'turf';

/** Coverage effect a service building radiates. */
export type ServiceEffect = 'security' | 'health' | 'net' | 'park' | 'transit' | 'prestige';

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
  /** Days of scaffolding left on the current stage; > 0 means still building. */
  buildDays?: number;
  /** Crown picked for stage 3. */
  crown?: CrownId;
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
}

export interface Selection {
  x: number;
  y: number;
}

/** Serialized save (JSON-safe). Version 1 (sandbox) and 2 (story) both load. */
export interface SaveData {
  /** 1 or 2. */
  version: number;
  cityName: string;
  seed: number;
  tick: number;
  funds: number;
  taxRate: number;
  maxPopulation: number;
  nextBuildingId: number;
  /** Run-length-free compact tile encoding, see World.serialize(). */
  tiles: number[];
  buildings: Building[];
  news: NewsItem[];
  history: number[];
  milestones: number[];
  savedAt: number;
  /** Story layer (v2). Optional: missing or undecodable → fresh story with flag `migrated`. */
  story?: StorySave;
}
