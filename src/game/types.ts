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
// (Megacity, docs/MEGACITY.md §3.2: regions, districts, save v4. Additive; the map-size constant went in part 1.)

/**
 * The per-world frame (MEGACITY §3.1). There is no map-size constant: every World has its own
 * side `world.N` and tile count `world.area` (= N²), index = y * N + x, and every system reads
 * them from its world (copied at construction). Module-scope working arrays are per-size
 * (`scratchFor`, src/game/frame.ts), never sized from a constant.
 */
/** A district slot is SLOT × SLOT tiles (MEGACITY §3.1). */
export const SLOT = 64;
/** Map side of v1–v3 saves. */
export const LEGACY_SIZE = 64;
/** Region side in slots, chosen per city at New City (MEGACITY §3.11) and saved. */
export type Region = 3 | 5;
export const REGIONS: readonly Region[] = [3, 5];
/**
 * The legacy single-slot frame (64×64, today's map), a 1×1 "region": headless tests and
 * measurement of the v1–v3 sim only, until WP-1's owned-segment loops make a 3×3 world as cheap
 * to step as a 64 one (MEGACITY §2.3). Never offered at New City, never written by the game, and
 * a save that names it is a future save (Game) and fails `validateSaveShape`.
 */
export const LEGACY_REGION = 1;
/** What a World's frame can be: a city region (3 or 5) or the legacy test frame (1). */
export type FrameRegion = Region | typeof LEGACY_REGION;
/** Slot id = sy * region + sx, 0 .. region² − 1. */
export type SlotId = number;
/** The centre slot: 4 on a 3×3 region, 12 on a 5×5 (0 on the legacy frame). */
export const startSlot = (r: FrameRegion): SlotId => (r * r - 1) / 2;

export type DistrictKind = 'shore' | 'shoals' | 'sunk' | 'flats' | 'terraces' | 'reedmere' | 'skeleton' | 'tarmac' | 'bazaar';
export const DISTRICT_KINDS: readonly DistrictKind[] = ['shore', 'shoals', 'sunk', 'flats', 'terraces', 'reedmere', 'skeleton', 'tarmac', 'bazaar'];
/** Which repeat of its kind a slot is (§3.7): 0 = the kind's own district (every 3×3 slot), 1..3 = its 5×5 variants. */
export type DistrictVariant = 0 | 1 | 2 | 3;

/**
 * Ground feature of a land tile (tile bits 22-23). What it does depends on the district (§3.7).
 * A **ruin** is a zoned, abandoned tile with ground Rubble (the Sunk's annex content): it is counted
 * in `ruins`, not `abandoned`, never collapses, and turns Plain when it recovers (§3.3).
 */
export enum Ground {
  Plain = 0,
  Reed = 1,
  Brownfield = 2,
  Rubble = 3,
}
/**
 * The largest world side (a 5×5 region). Feeds the index-width assertions only.
 * SimGrid keeps tile indices in Uint32 / Int32 lists, and every index must stay a small
 * integer: MAX_MAP_SIZE² < 2³¹ (MEGACITY §3.1; Appendix C rejects larger frames).
 */
export const MAX_MAP_SIZE = SLOT * 5; // 320
if (!(MAX_MAP_SIZE ** 2 < 2 ** 31)) throw new Error('MAX_MAP_SIZE² must stay below 2³¹ (MEGACITY §3.1)');

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
  | 'spaceport'
  // Megacity (MEGACITY §6.3): services and utilities.
  | 'floodwatch'
  | 'pumphouse'
  | 'canopypark'
  | 'medtower'
  | 'reclaim'
  | 'metro'
  | 'markethall'
  | 'tidal'
  | 'geothermal'
  | 'datavault'
  // Landmarks, one each (§6.3).
  | 'charterhall'
  | 'hexworks'
  | 'pearlatrium'
  | 'hullhouse'
  | 'kitemast'
  | 'lampchoir'
  | 'beacon'
  | 'arena'
  | 'halolookout'
  | 'terminal'
  // Ending landmarks, one each, buildable only while that ending is current (§9.2).
  | 'gantry'
  | 'glasssmile'
  | 'breadpier'
  | 'recordtower'
  | 'stillsquare'
  // Fixed structures placed by annex content, never in a tray, never bulldozed.
  /** Skeleton Row's unfinished frames (inert until finished). */
  | 'frame'
  /** The Sunk's old pump hall (Pump Station 6, §3.7). */
  | 'pumphall';

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
export type ServiceEffect = 'security' | 'health' | 'net' | 'park' | 'transit' | 'prestige' | 'education' | 'resilience' | 'filter';

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
  /** Terrace step 0..3 (Highstep Terraces; 0 elsewhere and on water). Saved in bits 20-21 (MEGACITY §3.2). */
  elev: number;
  /** Ground feature (bits 22-23). Plain on water. */
  ground: Ground;
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
  // ── Megacity (MEGACITY §3.2, §6.2) ──
  /** Corp Spire only: who paid for it. Missing on old saves → 'nacre' (today's power weights and today's art). */
  sponsor?: 'basalt' | 'nacre' | 'none';
  /**
   * Faction building, crown, Spire or landmark design 0..3 (§6.2). **Look 0 is exactly today's art.**
   * Missing → 0 (every v1–v3 building keeps its look). A new placement that skips the picker gets a hash of its id.
   */
  look?: 0 | 1 | 2 | 3;
  /** Pump House only: reclamation days left (90 → 0), then it becomes a pump garden. */
  reclaim?: number;
}

/**
 * Per-tile scalar fields, all Float32Array(world.area) with values in 0..1.
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
  // ── Megacity (MEGACITY §3.2). All zeros until the sim fills them (WP-1). ──
  /** 0..1 Floodwatch coverage (cancels king tides and floodplain caps). */
  resilience: Float32Array;
  /** 0..1 Reclaim Works coverage (pollution × (1 − 0.25 × filter)). */
  filter: Float32Array;
}

/** One owned district's census (MEGACITY §3.2, §3.3). */
export interface DistrictCensus {
  slot: SlotId;
  kind: DistrictKind;
  variant: DistrictVariant;
  residents: number;
  jobs: number;
  developed: number;
  avgLandValue: number;
  ruins: number;
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
  // ── Megacity (MEGACITY §3.2). Empty / zeros until the sim fills them (WP-1). ──
  /** Owned districts, in annex order. */
  districts: DistrictCensus[];
  /** Skybridge clusters of ≥ 3 anchors (§5.5). */
  skyLobbies: { count: number; largest: number; visitors: number };
  /** Ruins standing (zoned, abandoned, ground Rubble); not part of `abandoned`. */
  ruins: number;
  /** Ruins that came back as homes or shops (district goal, §3.7); copied from `districts.ruinsRestored`. */
  ruinsRestored: number;
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
  /**
   * Lower-detail mode for a 5×5 city (MEGACITY §3.11). Missing until the first 5×5 city loads on this device; then
   * written once from the device class (on for a handheld, off for a PC), so it never flips mid-session. Ignored on a 3×3 region.
   */
  lowerDetail?: boolean;
  /**
   * Weather (MEGACITY §6.4, §7.6): Full / Light / Off. Missing reads from `rain` (true → 'full', false → 'off');
   * `rain` is still written (weather !== 'off') for older builds. Read it through `weatherOf` (game/settings.ts).
   */
  weather?: 'full' | 'light' | 'off';
  /** Crowds on the streets (§6.4). Missing reads as on at high quality, off at low (`crowdsOn`). */
  crowds?: boolean;
  /** City life happenings' visuals and ticker lines (§6.4.1). Missing reads as on (`cityLifeOn`). */
  cityLife?: boolean;
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
  // ── Megacity (MEGACITY §3.4, §5.4, §5.5) ──
  /** Skybridge: what this bridge pays (§5.5). */
  bridge?: BridgePayoff;
  /** Skybridge: a two-bridge route through this tower (§5.4). */
  route?: { via: { x: number; y: number }; second: { ax: number; ay: number; bx: number; by: number; gap: number } };
  /** The first locked slot the plan touched (the pill's "Map" action, §3.4). */
  slot?: SlotId;
}

/** What a skybridge pays (MEGACITY §5.5). */
export interface BridgePayoff {
  /** People a day walking the bridge: 0.2 × (residents + jobs of both anchors; a parcel counts all its members). */
  walkers: number;
  /** Car trips a day the two towers no longer make (20%, 25% inside a Sky Lobby). */
  tripsCut: number;
  /** Tiles that gain +5% land value. */
  lvTiles: number;
  /** The Sky Lobby this bridge forms or joins (k ≥ 3 anchors), else null. */
  lobby: { k: number; name: string; visitors: number } | null;
}

/** A merged parcel (MEGACITY §6.1): a pure function of tiles and seed, computed by `src/game/parcels.ts`. */
export interface Parcel {
  /** Head tile (the front corner): the parcel's skybridge anchor key and sort key. */
  hx: number;
  hy: number;
  /** Footprint origin and size: 2×2, 2×1 or 1×2. */
  x: number;
  y: number;
  w: 1 | 2;
  h: 1 | 2;
  /** Drawn level and tier: the lowest among its members. */
  level: number;
  tier: number;
}

export interface Selection {
  x: number;
  y: number;
  /** The player tapped the skyway deck over this tile, not the ground (EXPANSION §3.7). */
  sky?: true;
  /** A skybridge tube was tapped (MEGACITY §5.4): the link id. */
  link?: number;
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

/** City life happenings (MEGACITY §6.4.1, WP-6). */
export type CityEventId = 'nightmarket' | 'lanterns' | 'stormwatch' | 'arenanight' | 'kiteday' | 'parade';

/**
 * The City life happening in progress (MEGACITY §6.4.1), `world.cityEvent`; not saved (a happening in progress
 * ends on reload). The sim reads its terms only while `daysLeft > 0`: census approval adds `approval`, PortSystem raw
 * visitors add `visitors` (a monthly rate), the Market demand target adds `demandCom`.
 */
export interface CityEventState {
  id: CityEventId;
  /** Unpaused real seconds of visuals left. */
  until: number;
  /** Sim days its gameplay terms still apply (≤ CITY_LIFE.capDays). */
  daysLeft: number;
  visitors: number;
  approval: number;
  demandCom: number;
  slot?: SlotId;
}

/** Once-per-city moments (EXPANSION §5.4), saved in SaveData.moments. */
export type MomentId = 'seaport' | 'airport' | 'spaceport' | 'launch' | 'region';
/** + 'region' (MEGACITY §3.8): the once-per-city "region is whole" banner. */
export const MOMENT_IDS: readonly MomentId[] = ['seaport', 'airport', 'spaceport', 'launch', 'region'];

/** District state of a city (MEGACITY §3.2), saved as SaveData.districts. */
export interface DistrictSave {
  /** Length region², indexed by SlotId. */
  kinds: DistrictKind[];
  /** Length region², indexed by SlotId: each slot's variant of its kind (§3.6.2). Missing or malformed → the seed's layout. */
  variants?: DistrictVariant[];
  /** Owned slots in annex order (the start slot first). */
  owned: SlotId[];
  /** Unspent land grants. */
  grants: number;
  /** Districts bought with credits. */
  bought: number;
  /** Length region², indexed by SlotId: the tick the slot was annexed, −1 while locked. */
  annexedAt: number[];
  /** The annex-sheet lease (Tarmac Reach, variant 0, only, §3.7). */
  leases?: { tarmac?: 'nacre' | 'basalt' };
  /** Unpaused real seconds since the ending or the last epilogue grant (§3.8). Missing → 0. */
  epilogueSec?: number;
  /** District goals completed (§3.7), as `goalId@slot` (goals are per district). Missing → none. */
  goalsDone?: string[];
  /** Ruins restored since annex (§3.7). Missing → 0. */
  ruinsRestored?: number;
}

/** Serialized save (JSON-safe). Version 1 (sandbox), 2 (story), 3 (expansion) and 4 (megacity) all load. */
export interface SaveData {
  /** 1, 2, 3 or 4. */
  version: number;
  cityName: string;
  seed: number;
  tick: number;
  funds: number;
  taxRate: number;
  maxPopulation: number;
  /**
   * People per v3 person in this save's head counts (MEGACITY §4.1): POP_SCALE (10) when written
   * by a Megacity build. Missing (every v1–v3 save of the earlier builds) → ×POP_SCALE at load.
   */
  scale?: number;
  nextBuildingId: number;
  /**
   * v1–v3: the whole 64×64 map as tile numbers (v3: bits 15-17 roadKind, 18-19 wealth). v4 saves have
   * no `tiles` (they store `tileBlocks`); migration turns `tiles` into the start slot's block.
   */
  tiles?: number[];
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
  // ── Megacity, v4 (MEGACITY §3.10) ──
  /**
   * v4: the region side in slots, 3 or 5. Missing on v1–v3 (migrated as 3, §3.10); any other value on a v4 save →
   * a future save. `upgradeRegion` turns a 3 into a 5 (§3.11).
   */
  region?: number;
  /** World side, 64 × region (192 or 320). Missing on v1–v3; a v4 save whose size is not 64 × region → a future save. */
  size?: number;
  /** v4 district state. */
  districts?: DistrictSave;
  /**
   * v4: one base64 block per owned slot, in districts.owned order: 4096 tiles × 3 bytes (bits 0-23, little-endian),
   * row-major inside the slot. v4 saves have no `tiles`.
   */
  tileBlocks?: string[];
}
