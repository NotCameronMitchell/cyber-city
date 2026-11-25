import {
  NOT_ANNEXED,
  applyAction,
  buildingCost,
  crackdown,
  crackdownStatus,
  crownOptions,
  finishFrame,
  frameStatus,
  planAction,
  raiseStage,
  skywayNetwork,
  stageStatus,
  type PlanOpts,
  type Point,
} from './actions';
import { buildingStats } from './buildingStats';
import {
  AIRPORT,
  ANNEX,
  BUILDINGS,
  BULLDOZE_COST,
  CURRENCY,
  DAY_CYCLE_SECONDS,
  EDGE_LINKS,
  FACTION_LABELS,
  MAX_TAX,
  MIN_TAX,
  RIBBON,
  SAFETY,
  DISTRICTS,
  LOW_DETAIL,
  REGION,
  SAVE_KEY,
  SAVE_VERSIONS_SUPPORTED,
  SEAPORT,
  SETTINGS_KEY,
  SKYBRIDGE,
  SKYWAY,
  SPACEPORT,
  SPEED_TICKS_PER_SEC,
  STACK_STAGES,
  STORY_PACE,
  ZONES,
  SLEEP,
  districtPrice,
  milestonesFor,
  isBuildingTool,
  isZoneTool,
  paceOf,
  zoneDefFor,
} from './config';
import { CityEvents } from './cityEvents';
import { deviceClass } from './device';
import { districtDayUnit, pumpRings } from './districts/daily';
import { isFloodplain, updateDistrictLayers, isWildReed } from './districts/effects';
import { districtShort, districtTitle, goalViews, type GoalView } from './districts/goals';
import { adjacentLocked, slotRect, validSlot } from './districts/slots';
import { isRuin } from './districts/annex';
import { FrameGuard, frameCapMs } from './frameGuard';
import { heightOf } from './heights';
import { parcelAt } from './parcels';
import { isFutureSave } from './districts/migrate';
import { Emitter, type GameEventMap, type ToastAction } from './events';
import { Ground, type BridgePayoff, type DistrictKind, type DistrictVariant, type Region, type SlotId } from './types';
import {
  FUTURE_SAVE_KEY,
  MIRROR_SAVE_KEY,
  PREV_SAVE_KEY,
  STALE_SAVE_KEY,
  STORAGE_FULL_TEXT,
  UNREADABLE_SAVE_KEY,
  V2_SAVE_KEY,
  V3_SAVE_KEY,
  isFutureHeader,
  keepNewerSave,
  readHeader,
  readPlain,
  restoreKey,
  snapshotKey,
  tickMirrorClock,
  writeMainSave,
  writePrev,
} from './saveStore';
import { ROAD_TOOL_KIND, isRoadTool, roadDef, roadLinks } from './roads';
import { Simulation } from './sim';
import type { PortView } from './sim/ports';
import { SKY_RAMP, skyRampGround } from './skyway';
import { storageGet, storageRemove, storageSet } from './storage';
import { evalCond, storyContent } from './story/conditions';
import { StoryDirector } from './story/director';
import * as turf from './story/turf';
import type { ActionResult, CrownId, EndingId, FactionId, GangId, InspectAction } from './story/types';
import * as vertical from './story/vertical';
import {
  RoadKind,
  Terrain,
  ZoneType,
  type ActionPlan,
  type Building,
  type BuildingType,
  type OverlayId,
  type SaveData,
  type Selection,
  type Settings,
  type TileSnap,
  type ToolId,
} from './types';
import { TIER_LABEL, wealthInfo, zoneCapacity } from './wealth';
import { World, savePopScale } from './world';

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: false,
  rain: true,
  dayNight: true,
  quality: 'high',
  showFps: false,
  events: true,
  storyPace: 'relaxed',
};

/** City names are capped at this many characters (§1.6; lint assumes 24). */
export const CITY_NAME_MAX = 24;

// ── Save safety (docs/EXPANSION.md §2.5, MEGACITY §3.10). The keys and the storage plan live in saveStore.ts. ──
export { FUTURE_SAVE_KEY, MIRROR_SAVE_KEY, PREV_SAVE_KEY, STALE_SAVE_KEY, UNREADABLE_SAVE_KEY, V2_SAVE_KEY, V3_SAVE_KEY };
/** Shown once per city per device when a 5×5 city opens in lower detail (MEGACITY §3.11). */
export const LOW_DETAIL_TEXT = 'Big city, small screen: lower detail is on to keep it smooth. Settings › Lower detail.';
/** localStorage key of the cities (by seed) that have shown the lower-detail notice on this device. */
export const LOW_DETAIL_NOTICE_KEY = 'cybercity.ui.lowdetail.v1';
/** Shown once when the stored city came from a newer build. */
export const FUTURE_SAVE_TEXT = 'This city was saved by a newer version. Reload to update.';
/** Shown once when an older version had saved over the city and the mirror brought it back. */
export const RESTORED_SAVE_TEXT = 'An older version saved over your city. It is back as you left it.';

/** Days of backlog the frame loop may carry; more is dropped (MEGACITY §3.3: today's 4). */
const BACKLOG_DAYS = 4;

/** Visual clock rate by speed (index 0..3): frozen while paused, ×1 / ×1.6 / ×2.4 (EXPANSION §1.3, §2.7). */
const CLOCK_RATE = [0, 1, 1.6, 2.4] as const;

/** Safe localStorage wrappers (storage may be missing or throw); they live in a leaf module so story code can share them. */
export { storageGet, storageRemove, storageSet } from './storage';

/** One slot on the City map (§7.2), as Game.districtView() gives it. */
export interface DistrictSlotView {
  slot: SlotId;
  kind: DistrictKind;
  variant: DistrictVariant;
  /** The district's own name (a 5×5 repeat by its variant's name) and short name. */
  name: string;
  short: string;
  /** The kind's name ("Kessel Flats"): the census line of a variant names it ("Ironside Docks · Flats"). */
  kindName: string;
  tagline: string;
  color: string;
  /** owned · candidate (annexable now) · notAdjacent ("Not next to the city yet") · notOpen ("Still flooded: opens later"). */
  state: 'owned' | 'candidate' | 'notAdjacent' | 'notOpen';
  /** Share of the slot that is land (the sheet's terrain line). */
  land: number;
  perks: string[];
  hazards: string[];
  /** Lobbyists and their lines (§8.2; the hidden Tuning never, its fallback speaks before it is active). */
  lobby: { faction: FactionId; quote: string }[];
  /** Annexing it now (candidates): favor per faction (§8.2), lease aside. */
  reactions: { f: FactionId; v: number }[];
  /** Regional links on the city's border with it that annexing turns into city streets (§3.5). */
  linksInternal: number;
  /** Owned: its goals with their state and pay (§3.7). */
  goals: GoalView[];
  /** Owned: its census (WP-1's per-district census; missing until the sim fills stats.districts). */
  census?: { residents: number; jobs: number; developed: number; avgLandValue: number; ruins: number };
  /** Tarmac Reach (variant 0) as a candidate: the lease choice; Annex waits for it. */
  lease: { options: ['nacre', 'basalt']; prompt: string } | null;
  /** The price line: a grant, credits (after an ending) or the wait (§7.2). */
  price: { grants: number; credits: number; text: string };
  /** A candidate the player can annex right now (a grant, or credits enough after an ending). */
  canAnnex: boolean;
}

/** The City map's model (§7.2). */
export interface DistrictView {
  region: number;
  owned: number;
  total: number;
  grants: number;
  /** An ending was chosen: districts can be bought. */
  ended: boolean;
  /** The next district's price after an ending (districtPrice(owned)), else 0. */
  price: number;
  /** "Next land grant: finish Chapter III" while no grant waits, else null. */
  nextGrant: string | null;
  /** Every slot is owned. */
  whole: boolean;
  edgeLine: string | null;
  /** A whole 3×3 region shows the Grow to 25 districts button (§3.11; WP-9's growRegion). */
  canGrow: boolean;
  slots: DistrictSlotView[];
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Corp Spire designs by sponsor (§6.2; look 0 is today's art). */
const SPIRE_LOOKS: Record<'basalt' | 'nacre' | 'none', readonly string[]> = {
  nacre: ['Facet', 'Spiral', 'Pearl Drop', 'Halo Atrium'],
  basalt: ['Hex Column', 'Crucible', 'Gantry Spine'],
  none: ['Needle', 'Twin Blade', 'Lattice'],
};
/** Crown designs (§6.2; look 0 of the four old crowns is today's, "Classic"). */
const CROWN_LOOK_NAMES: Record<CrownId, readonly string[]> = {
  foundry: ['Classic', 'Crucible', 'Hex Column'],
  glare: ['Classic', 'Pearl Drop', 'Halo Atrium'],
  nest: ['Classic', 'Antenna Forest', 'Sail Canopy'],
  commons: ['Classic', 'Stepped Tower', 'Open Belfry'],
  salvage: ['Hull Stack', 'Net Loft', 'Crane Hab'],
  lamp: ['Lamp Chapel', 'Coil Belfry', 'Choir Ring'],
};
/** Ending names for the ending landmarks' note (§9.2). */
const ENDING_NAMES: Record<EndingId, string> = { ironwork: 'Ironwork', pearl: 'Pearlescence', lowcrown: 'the Low Crown', ledger: 'Open Ledger', quiet: 'the Quiet Hand' };
const SLOT_TILES = 64 * 64;

export interface TileInfo {
  title: string;
  subtitle: string;
  color: string;
  /** Standard rows: values ≤ 12 characters (EXPANSION §7.4 layout rule). */
  rows: [label: string, value: string][];
  /** Full-width, wrapping lines under the rows (≤ 60 chars each; at most two lines at 360 px). Expansion. */
  notes?: { text: string; tone?: 'good' | 'warn' | 'bad' }[];
  /** Ticks (0..1) drawn on the percent meter of row index `row` (the Wealth row). Expansion. */
  meter?: { row: number; ticks: number[] };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Tools whose result changes story sources (vertical caches, turf eligibility, build counts).
 * Road kinds and the skyway count too (EXPANSION §8.4): the alley mood driver, the alley and
 * skyway power terms and turf eligibility update right after a drag.
 */
const storyTool = (tool: ToolId) =>
  tool === 'bulldoze' || tool === 'skybridge' || tool === 'rail' || tool === 'skyway' || isRoadTool(tool) || isBuildingTool(tool);

/** A tile rect (inclusive), as the 'tiles' event and Simulation.recomputeAround take it. */
type TileRectLike = { x0: number; y0: number; x1: number; y1: number };

/** `r` grown to hold tile (x, y) (a new rect when r is null). */
function growRect(r: TileRectLike | null, x: number, y: number): TileRectLike {
  if (!r) return { x0: x, y0: y, x1: x, y1: y };
  return { x0: Math.min(r.x0, x), y0: Math.min(r.y0, y), x1: Math.max(r.x1, x), y1: Math.max(r.y1, y) };
}

/** Tools whose last drag can be undone for SAFETY.undoSec (EXPANSION §7.7). */
const undoableTool = (tool: ToolId) => isRoadTool(tool) || tool === 'skyway' || isZoneTool(tool);

/** A plan waiting for ✓ (EXPANSION §7.7): the tool, the gesture's points and the plan the ghost shows. */
export interface PendingConfirm {
  tool: ToolId;
  from: Point;
  to: Point;
  plan: ActionPlan;
}

/** One tile of the undo snapshot: before and after the drag, and whether a building stood there after it. */
interface UndoTile {
  before: TileSnap;
  after: TileSnap;
  building: boolean;
}

/** The one-step undo (EXPANSION §7.7): changed tiles, credits spent and the wall time. */
interface UndoSnapshot {
  tool: ToolId;
  tiles: UndoTile[];
  spent: number;
  at: number;
}

/** A Spaceport's launch state for the inspect sheet (EXPANSION §5.3, §7.4). */
export interface LaunchStatus {
  /** 0..1 construction progress (days and real seconds combined). */
  progress: number;
  complete: boolean;
  /** Complete, online and powered: its launch clock runs. */
  active: boolean;
  /** Unpaused seconds until the gap since the last launch has passed (0 = waiting only for night). */
  gapLeft: number;
  /** Seconds left of the first launch's announced lead, or null. */
  lead: number | null;
  /** Launches seen so far. */
  launches: number;
}

/** Rotating news line posted at each visible liftoff (EXPANSION Appendix B). */
const LAUNCH_NEWS = [
  'Launch night: a cargo lifter climbs out of {city} on a column of light.',
  'Another launch. Half of shadeside is on the roofs to watch it go.',
  "The spaceport lights the low clouds orange for eleven seconds. Then it's gone.",
] as const;

/** Inspect subtitles by road kind (EXPANSION §7.4). */
const ROAD_SUBTITLE: Record<RoadKind, string> = {
  [RoadKind.Street]: 'Lots within 3 tiles can grow here.',
  [RoadKind.Avenue]: "A wide, lit boulevard: twice a street's traffic.",
  [RoadKind.Highway]: 'Five streets of traffic. Streets join it at on-ramps.',
  [RoadKind.Alley]: 'Narrow and cheap. Crews like the dark.',
  [RoadKind.Ramp]: 'Joins the street grid to the highway.',
};

/** The on-demand launch-rights card (EXPANSION §8.3; content by WP-6). */
const RIGHTS_CARD = 'ex.rights';

/** Launch-rights holder (story flag `launchRights`) → the inspect row value. */
const RIGHTS_LABEL: Record<string, string> = { board: 'Public', basalt: 'Basalt', nacre: 'Nacre', kites: 'Kites' };

const snapOf = (world: World, i: number): TileSnap => {
  const t = world.tiles[i];
  return { i, road: t.road, roadKind: t.roadKind, zone: t.zone, level: t.level, sky: world.sky[i] };
};
const sameSnap = (a: TileSnap, b: TileSnap) =>
  a.road === b.road && a.roadKind === b.roadKind && a.zone === b.zone && a.level === b.level && a.sky === b.sky;

/** The inspect sheet's Demolish: a ground bulldoze, never the deck over a docked anchor's roof. */
const GROUND_ONLY: PlanOpts = { layer: 'ground' };

/** A story build credit a placement used (EXPANSION §7.7: a refund gives it back). */
type UsedCredit = { what: BuildingType; mul: number };

/** Give a build credit back: the next building of its type uses it again. */
function returnCredit(world: World, c: UsedCredit): void {
  const credits = world.story.credits;
  const k = credits.findIndex((e) => e.what === c.what && e.mul === c.mul);
  if (k >= 0) credits[k].n++;
  else credits.unshift({ what: c.what, n: 1, mul: c.mul });
}

/** A city with any progress (worth a backup before it is replaced). */
function worthKeeping(world: World): boolean {
  if (world.tick > 0 || world.buildings.size > 0) return true;
  for (const t of world.tiles) if (t.road || t.zone !== ZoneType.None) return true;
  return false;
}

/**
 * Top-level controller: owns the world + simulation, the current tool/speed/
 * overlay, the live action preview and settings. UI, input and renderer all
 * talk to the game through this object and its `events` bus.
 */
export class Game {
  readonly events = new Emitter<GameEventMap>();
  world: World;
  sim!: Simulation;
  /** Story director (docs/STORY.md §11). Replaced together with world and sim: never cache it. */
  story!: StoryDirector;
  tool: ToolId = 'inspect';
  /** 0 = paused, 1..3. */
  speed = 1;
  overlay: OverlayId = 'none';
  selected: Selection | null = null;
  /** Live preview of the in-progress gesture, set by input, drawn by renderer. */
  preview: ActionPlan | null = null;
  settings: Settings;
  /** Visual clock in seconds (advances with sim speed; drives the day/night cycle). */
  clock = DAY_CYCLE_SECONDS * 0.85;
  /**
   * The stored save came from a newer build (EXPANSION §2.5): this session plays a fresh city in
   * memory and save() writes nothing, so a stale build never overwrites a newer city. Only an
   * explicit New City clears it.
   */
  saveBlocked = false;
  /** Toasts raised before the UI exists (constructor); emitted on the first update(). */
  private notices: { text: string; kind: 'info' | 'error' | 'good'; action?: ToastAction }[] = [];
  /** City life (MEGACITY §6.4.1, WP-6): driven by update(dt) on unpaused seconds. */
  readonly cityEvents: CityEvents = new CityEvents(this);
  /** The storage-full toast shows once a session (§3.10). */
  private storageFullShown = false;
  /**
   * The name of the city a New City / Restore could not keep in `.prev` (storage full, §3.10): nothing changed and
   * the UI offers Export and Replace without a copy (newCity's `replaceWithoutCopy`). Null otherwise.
   */
  keepCopyFailed: string | null = null;
  /**
   * The last main-save write failed even after the quota drops (§3.10). A Restore that couldn't save the restored
   * city changes nothing and leaves this set, so the UI doesn't call the backup unreadable.
   */
  lastSaveFailed = false;
  private tickAcc = 0;
  /** Speed to restore once a blocking story card closes (null = not paused by the story). */
  private storyResumeSpeed: number | null = null;

  // ── Expansion: confirm, undo, refund and launches (docs/EXPANSION.md §5.3, §7.7) ──
  /**
   * Wall clock in seconds for the undo and refund windows (SAFETY.undoSec / refundSec). Tests
   * swap in a fake clock. Launches do not use it: they run on unpaused frame time (update dt).
   */
  now: () => number = () => Date.now() / 1000;
  /**
   * A costly or lossy plan waiting for ✓ (set by commit(), cleared by confirmPending(),
   * cancelPending(), setTool(), apply() and any world swap). Input keeps the ghost while it is set.
   */
  pendingConfirm: PendingConfirm | null = null;
  /** The last road, skyway or zone drag, undoable for SAFETY.undoSec (one step, no history). */
  private undoSnap: UndoSnapshot | null = null;
  /** Buildings placed this session: credits paid, any build credit used and wall time, for the SAFETY.refundSec refund. Not saved. */
  private placed = new Map<number, { at: number; paid: number; credit?: UsedCredit }>();
  /** Unpaused real seconds since each complete Spaceport's last liftoff. Not saved. */
  private launchClock = new Map<number, number>();
  /** Spaceports seen under construction in this world (their first launch waits only for night). */
  private launchBuilding = new Set<number>();
  /** The first launch's announced lead: spaceport id and seconds left. */
  private lead: { id: number; left: number } | null = null;

  // ── Megacity: the frame guard, skybridges, the City map (MEGACITY §3.3, §3.11, §5.4; WP-2) ──
  /**
   * Milliseconds clock the frame guard and the sim's slices read (tests swap in a fake one; each new Simulation
   * gets it in attachSystems).
   */
  msClock: () => number = () => performance.now();
  /** Sim work in the last frame (ms) and whether a slice ran in it (main.ts autosaves only in a frame without one). */
  simMsThisFrame = 0;
  simRanThisFrame = false;
  /** Days the backlog guard dropped since the world loaded (tests, the FPS readout). */
  droppedDays = 0;
  /** Strain detector for 'auto' sleeping districts (§3.11). Its cap is the frame cap of this device class. */
  readonly guard = new FrameGuard(frameCapMs(deviceClass()));
  /** The skybridge tool's selected tower (§5.4: tap a tower, tap a partner; the partner becomes the next source). */
  bridgeSource: { x: number; y: number } | null = null;
  /** The last skybridge build, undoable for SAFETY.undoSec (EXPANSION §7.7 extended, §5.3 rule 8). */
  private bridgeUndo: { ids: number[]; spent: number; at: number } | null = null;
  /** The locked slot the last refused plan touched: the "Map" toast action opens the City map on it (§3.4). */
  mapSlot: SlotId | null = null;
  /** The tile at the view centre (main.ts sets it each frame): 'forced' sleep keeps that district's ring awake. */
  private viewSlot: SlotId = -1;

  constructor() {
    const stored = this.readSettings();
    // Older stored settings have no storyPace (or an unknown one): they read as 'relaxed'.
    this.settings = { ...DEFAULT_SETTINGS, ...stored, storyPace: paceOf(stored.storyPace) };
    const world = this.loadStored();
    this.world = world ?? World.generate(randomSeed(), undefined, this.events);
    this.attachSystems();
    if (!world) this.welcome();
    else this.adoptCity();
  }

  // ── Megacity: region, lower detail, story pace (MEGACITY §3.10, §3.11) ─────
  /**
   * Lower-detail mode (§3.11): true for a 5×5 city when `settings.lowerDetail` is true; a 3×3 city ignores it.
   * WP-1 (forced sleep), WP-2 (speed cap, autosave interval), WP-3 and WP-6 read it.
   */
  get lowerDetail(): boolean {
    return this.world.region === 5 && this.settings.lowerDetail === true;
  }

  /**
   * A stored city just became the current one (Continue, Restore previous city, the kept city, later Import and
   * Grow): apply its saved story pace to Settings, write the lower-detail default once for the first 5×5 city on this
   * device (from the device class), and queue the lower-detail notice once per city per device.
   */
  private adoptCity(): void {
    const pace = this.world.story.pace;
    if (pace && paceOf(pace) === pace && pace !== this.settings.storyPace) {
      this.settings = { ...this.settings, storyPace: pace };
      storageSet(SETTINGS_KEY, JSON.stringify(this.settings));
    }
    if (!this.world.story.pace) this.world.story.pace = this.settings.storyPace;
    this.noteRegion();
  }

  /** The 5×5 parts of adoptCity (also run by New City): the one-time lower-detail default and its notice. */
  private noteRegion(): void {
    if (this.world.region !== 5) return;
    if (this.settings.lowerDetail === undefined) {
      this.settings = { ...this.settings, lowerDetail: deviceClass() === 'handheld' };
      storageSet(SETTINGS_KEY, JSON.stringify(this.settings));
    }
    if (!this.lowerDetail) return;
    let seen: number[] = [];
    try {
      const v = JSON.parse(storageGet(LOW_DETAIL_NOTICE_KEY) ?? '[]') as unknown;
      if (Array.isArray(v)) seen = v.filter((x): x is number => typeof x === 'number');
    } catch {
      seen = [];
    }
    if (seen.includes(this.world.seed)) return;
    seen.push(this.world.seed);
    storageSet(LOW_DETAIL_NOTICE_KEY, JSON.stringify(seen.slice(-50)));
    this.notices.push({ text: LOW_DETAIL_TEXT, kind: 'info' });
  }

  // ── Tool / mode state ─────────────────────────────────────────────────────
  setTool(tool: ToolId) {
    if (this.tool === tool) return;
    this.tool = tool;
    this.preview = null;
    this.pendingConfirm = null;
    // Leaving the Skybridge tool deselects its tower (§5.4 step 5: the tool chip's ✕ leaves the tool).
    if (tool !== 'skybridge') this.bridgeSource = null;
    if (tool !== 'inspect') this.select(null);
    this.events.emit('tool', tool);
  }

  setSpeed(speed: number) {
    const s = Math.max(0, Math.min(3, Math.round(speed)));
    if (s === this.speed) return;
    this.speed = s;
    this.events.emit('speed', s);
  }

  setOverlay(overlay: OverlayId) {
    if (this.overlay === overlay) return;
    this.overlay = overlay;
    this.events.emit('overlay', overlay);
  }

  select(sel: Selection | null) {
    if (sel && !this.world.inBounds(sel.x, sel.y)) sel = null;
    // The skyway deck and the ground under it are different selections (EXPANSION §3.7).
    const same = sel && this.selected && sel.x === this.selected.x && sel.y === this.selected.y && !!sel.sky === !!this.selected.sky;
    if (same || (!sel && !this.selected)) return;
    this.selected = sel;
    this.events.emit('select', sel);
  }

  setTax(rate: number) {
    const cap = Math.min(MAX_TAX, this.world.mods.taxCap);
    this.world.taxRate = Math.max(MIN_TAX, Math.min(cap, Math.round(rate)));
    // Refresh demand + budget projection now, so it moves even while paused (census and budget only, O5).
    this.sim.recomputeEconomy();
    this.events.emit('stats');
  }

  /**
   * Build the simulation and story director for the current world. The director
   * derives its caches (mods, layers) before the sim's first recomputeAll, so
   * that pass already sees them.
   */
  private attachSystems(): void {
    const sim = new Simulation(this.world);
    sim.options.events = this.settings.events;
    // Megacity (§3.3): the district daily hook (Pump Houses, king tides, the district part, goals on the month tick),
    // as steps of unit C1 (no step over SLICE.unitMaxNodeMs).
    sim.districtUnit = districtDayUnit;
    sim.clock = () => this.msClock();
    this.sim = sim;
    this.storyResumeSpeed = null;
    this.guard.reset();
    this.bridgeSource = null;
    this.bridgeUndo = null;
    this.mapSlot = null;
    this.droppedDays = 0;
    // Session-only expansion state belongs to the world it was made in (EXPANSION §7.7, §5.3).
    this.pendingConfirm = null;
    this.undoSnap = null;
    this.placed.clear();
    this.launchClock.clear();
    this.launchBuilding.clear();
    this.lead = null; // a pending launch is dropped with the world
    this.story = new StoryDirector(this);
    // The district layer part (§3.3) is derived: built before the first recompute so its fields see it.
    updateDistrictLayers(this.world, true);
    sim.recomputeAll();
    // A v1 / v2 city takes its wealth tiers once, in one batch, at load (EXPANSION §4.3).
    if (this.world.loadedVersion < 3 && sim.settleWealth() > 0) sim.recomputeAll();
    // Tile power is only known after the first recompute (it is not saved): re-check
    // zone-anchored skybridges and stations now instead of at the next month.
    const m = this.world.vertical.metrics;
    const before = m.skybridges * 4096 + m.railMaxStations;
    vertical.refresh(this.world, { quiet: true });
    if (m.skybridges * 4096 + m.railMaxStations !== before) {
      this.story.markDirty();
      sim.recomputeAll();
    }
    // Security is only known after the first recompute too: re-derive turf stats
    // (the secured shares the faction sheet and mood drivers read) from real fields.
    turf.refreshStats(this.world);
    this.story.markDirty();
  }

  updateSettings(patch: Partial<Settings>) {
    const pace = this.settings.storyPace;
    this.settings = { ...this.settings, ...patch };
    this.settings.storyPace = paceOf(this.settings.storyPace);
    // The story pace travels with the city (MEGACITY §3.10): written on every change.
    this.world.story.pace = this.settings.storyPace;
    this.sim.options.events = this.settings.events;
    storageSet(SETTINGS_KEY, JSON.stringify(this.settings));
    // The director reads the pace live: a change applies at once (floors, gaps, timers, the view).
    if (this.settings.storyPace !== pace) this.story.markDirty();
    this.events.emit('settings');
  }

  /** Show a toast; `action` adds a 44 px button for `action.sec` seconds (Undo, Watch; EXPANSION §2.9). */
  toast(text: string, kind: 'info' | 'error' | 'good' = 'info', action?: ToastAction) {
    this.events.emit('toast', action ? { text, kind, action } : { text, kind });
  }

  // ── Actions (called by input) ─────────────────────────────────────────────
  /**
   * Preview the current tool over a drag from `from` to `to` (tile coords). A ground bulldoze
   * also carries `refund`: what bulldozing buildings placed under SAFETY.refundSec ago returns.
   */
  plan(from: Point, to: Point): ActionPlan {
    return this.planTool(this.tool, from, to);
  }

  /**
   * planAction as apply() runs it: a ground bulldoze over buildings placed under SAFETY.refundSec
   * ago waives their demolition fee (the refund is in full, so a low treasury never blocks it).
   */
  private planTool(tool: ToolId, from: Point, to: Point, opts?: PlanOpts): ActionPlan {
    const plan = planAction(this.world, tool, from, to, opts);
    if (tool !== 'bulldoze' || plan.layer === 'sky') return plan;
    const r = this.refundFor(plan);
    if (!r.ids.length) return plan;
    const waived = planAction(this.world, tool, from, to, { ...opts, waive: new Set(r.ids) });
    if (r.total > 0) waived.refund = r.total;
    return waived;
  }

  /**
   * The inspect sheet's Demolish (EXPANSION §7.7): a ground bulldoze of the building at `at`. On a
   * docked anchor it never takes the skyway deck over the roof instead. planDemolish prices it.
   */
  planDemolish(at: Point): ActionPlan {
    return this.planTool('bulldoze', at, at, GROUND_ONLY);
  }

  demolish(at: Point): ActionPlan {
    // The normal tool path, so costs, refunds, sfx, toasts and the sim recompute all apply.
    this.setTool('bulldoze');
    const plan = this.apply(at, at, GROUND_ONLY);
    this.setTool('inspect');
    return plan;
  }

  /**
   * Confirm-aware commit for input (EXPANSION §7.7): a valid plan with `confirm` (a costly
   * building, or a highway that strands lots) is not built; it becomes `pendingConfirm` and
   * the preview keeps its ghost until confirmPending() or cancelPending(). Anything else is
   * applied at once, exactly like apply().
   */
  commit(from: Point, to: Point): ActionPlan {
    if (this.tool !== 'inspect') {
      const plan = this.plan(from, to);
      if (plan.valid && plan.confirm) {
        this.pendingConfirm = { tool: this.tool, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, plan };
        this.preview = plan;
        return plan;
      }
    }
    return this.apply(from, to);
  }

  /**
   * ✓ on the pending plan: re-plans from the same points and applies (a plan that is no longer
   * valid, e.g. funds changed, toasts its reason). Returns the executed plan, or null when
   * nothing was pending (or the tool changed since).
   */
  confirmPending(): ActionPlan | null {
    const p = this.pendingConfirm;
    this.pendingConfirm = null;
    if (!p || p.tool !== this.tool) return null;
    return this.apply(p.from, p.to);
  }

  /** ✕ / Esc / a new drag: drop the pending plan and its ghost. */
  cancelPending(): void {
    if (!this.pendingConfirm) return;
    this.pendingConfirm = null;
    this.preview = null;
  }

  /** Set (or clear) the live preview the renderer draws. */
  setPreview(plan: ActionPlan | null) {
    this.preview = plan;
  }

  /**
   * Apply the current tool over a gesture. For 'inspect' this selects the tile.
   * Emits sfx / toast / stats events. Returns the executed plan.
   */
  apply(from: Point, to: Point, opts?: PlanOpts): ActionPlan {
    this.preview = null;
    this.pendingConfirm = null;
    if (this.tool === 'inspect') {
      this.select(this.world.inBounds(to.x, to.y) ? { x: to.x, y: to.y } : null);
      this.events.emit('sfx', 'click');
      return planAction(this.world, 'inspect', from, to);
    }
    const tool = this.tool;
    const w = this.world;
    // Read what the drag will touch before it changes anything: undo before-states, refunds.
    const pre = undoableTool(tool) || tool === 'bulldoze' ? planAction(w, tool, from, to, opts) : null;
    const before = pre && undoableTool(tool) ? this.snapBefore(tool, pre) : null;
    const refund = pre && tool === 'bulldoze' && pre.layer !== 'sky' ? this.refundFor(pre) : null;
    // The story build credit a placement uses (applyAction consumes it): a refund gives it back.
    const c = isBuildingTool(tool) ? w.story.credits.find((e) => e.what === tool && e.n > 0) : undefined;
    const credit: UsedCredit | undefined = c ? { what: c.what, mul: c.mul } : undefined;
    const linkMark = w.nextLinkId;
    // Refunded buildings' demolition fees are waived, not charged and credited back. The tiles it changes bound the
    // recompute after it (O5).
    const touched = this.touching(() => applyAction(w, tool, from, to, refund?.ids.length ? { ...opts, waive: new Set(refund.ids) } : opts));
    const plan = touched.out;
    if (!plan.valid) {
      if (plan.slot !== undefined && plan.reason === NOT_ANNEXED) {
        // Locked land (MEGACITY §3.4): name the district; the Map action opens the City map on it.
        this.mapSlot = plan.slot;
        this.toast(`${districtTitle(w, plan.slot)} isn't part of the city yet`, 'error', { id: 'map', label: 'Map', sec: 6 });
      } else if (plan.reason && plan.reason !== 'Nothing to change') this.toast(plan.reason, 'error');
      this.events.emit('sfx', 'error');
      return plan;
    }
    // Any action replaces the one-step undo; only road, skyway and zone drags (and skybridges) make a new one.
    this.undoSnap = before ? this.makeUndo(tool, before, plan.cost) : null;
    this.bridgeUndo = null;
    const kind: GameEventMap['sfx'] =
      tool === 'bulldoze'
        ? 'bulldoze'
        : isRoadTool(tool)
          ? 'road'
          : isBuildingTool(tool) || tool === 'skybridge' || tool === 'rail' || tool === 'skyway'
            ? 'build'
            : isZoneTool(tool)
              ? 'zone'
              : 'click';
    this.events.emit('sfx', kind);
    if (isBuildingTool(tool)) this.placedBuilding(tool, plan, credit);
    else if (tool === 'skybridge') this.builtSkybridge(plan, linkMark);
    if (refund?.ids.length) {
      // In full: the price paid and any build credit used come back (the demolition fee was waived).
      w.funds += refund.total;
      for (const id of refund.ids) this.placed.delete(id);
      for (const used of refund.credits) returnCredit(w, used);
      if (refund.total > 0) {
        plan.refund = refund.total;
        this.toast(`Refunded ${num(refund.total)} ${CURRENCY}`, 'good');
      } else if (refund.credits.length) this.toast(`Refunded: next ${BUILDINGS[refund.credits[0].what].name} free`, 'good');
    }
    if (this.undoSnap) this.toast(this.undoText(tool, plan), 'info', { id: 'undo', label: 'Undo', sec: SAFETY.undoSec });
    const rect = growRect(growRect(touched.rect, from.x, from.y), to.x, to.y);
    const fp = plan.footprint;
    this.recomputeAround(fp ? growRect(growRect(rect, fp.x, fp.y), fp.x + fp.size - 1, fp.y + fp.size - 1) : rect);
    if (storyTool(tool)) {
      // Power was just recomputed: re-evaluate links and stations now, not next month (only when one of them moved).
      if (tool === 'skybridge' || tool === 'rail') vertical.refresh(this.world);
      else vertical.refreshIfMoved(this.world);
      this.story.markDirty();
    }
    this.events.emit('stats');
    return plan;
  }

  /**
   * The local recompute after a player action (MEGACITY §3.3, O5): fields on the touched rect ⊕ 12, power, coverage
   * and traffic as needed, census and budget; it also keeps the action's districts awake (O8).
   */
  private recomputeAround(rect: TileRectLike | null): void {
    if (rect) this.sim.recomputeAround(rect);
    else this.sim.recomputeAll();
  }

  /** Run `fn` and collect the union of the 'tiles' rects it emitted (null when it changed no tile). */
  private touching<T>(fn: () => T): { out: T; rect: TileRectLike | null } {
    let rect: TileRectLike | null = null;
    const off = this.events.on('tiles', (r) => {
      rect = rect ? { x0: Math.min(rect.x0, r.x0), y0: Math.min(rect.y0, r.y0), x1: Math.max(rect.x1, r.x1), y1: Math.max(rect.y1, r.y1) } : { ...r };
    });
    try {
      return { out: fn(), rect };
    } finally {
      off();
    }
  }

  /** After a building is placed: the toast, its refund record and (Spaceport) the real-time floor. */
  private placedBuilding(tool: ToolId, plan: ActionPlan, credit?: UsedCredit): void {
    if (!isBuildingTool(tool)) return;
    const def = BUILDINGS[tool];
    const fp = plan.footprint;
    const b = fp ? this.world.buildingAt(fp.x, fp.y) : null;
    if (b) {
      this.placed.set(b.id, credit ? { at: this.now(), paid: plan.cost, credit } : { at: this.now(), paid: plan.cost });
      // §5.3: 240 days AND at least 4 minutes of play; Game counts waitSec down per unpaused frame.
      if (b.type === 'spaceport') b.waitSec = SPACEPORT.minBuildSec;
    }
    this.toast(def.buildDays ? `${def.name} rising: ${def.buildDays} days` : `${def.name} built`, 'good');
  }

  // ── Undo (EXPANSION §7.7) ─────────────────────────────────────────────────

  /** Before-states of every tile a road, skyway or zone plan can change (skyways: their neighbours too). */
  private snapBefore(tool: ToolId, plan: ActionPlan): Map<number, TileSnap> {
    const w = this.world;
    const out = new Map<number, TileSnap>();
    const add = (x: number, y: number) => {
      if (!w.inBounds(x, y)) return;
      const i = w.idx(x, y);
      if (!out.has(i)) out.set(i, snapOf(w, i));
    };
    for (const p of plan.tiles) {
      add(p.x, p.y);
      if (tool === 'skyway') {
        add(p.x, p.y - 1);
        add(p.x + 1, p.y);
        add(p.x, p.y + 1);
        add(p.x - 1, p.y);
      }
    }
    return out;
  }

  /** The undo snapshot after an apply: the tiles that changed, or null when none did. */
  private makeUndo(tool: ToolId, before: Map<number, TileSnap>, spent: number): UndoSnapshot | null {
    const w = this.world;
    const tiles: UndoTile[] = [];
    for (const [i, b] of before) {
      const a = snapOf(w, i);
      if (!sameSnap(a, b)) tiles.push({ before: b, after: a, building: w.tiles[i].buildingId >= 0 });
    }
    return tiles.length ? { tool, tiles, spent, at: this.now() } : null;
  }

  /** "Street ×12", "Zoned 24 lots", "Skyway ×6". */
  private undoText(tool: ToolId, plan: ActionPlan): string {
    const n = this.undoSnap?.tiles.length ?? 0;
    if (isZoneTool(tool)) return `Zoned ${num(n)} ${n === 1 ? 'lot' : 'lots'}`;
    if (tool === 'skyway') return `Skyway ×${num(n)}`;
    if (isRoadTool(tool)) {
      const ramps = plan.ramps ?? 0;
      return `${roadDef(ROAD_TOOL_KIND[tool]).name} ×${num(n)}${ramps ? ` · ${ramps} ${ramps === 1 ? 'ramp' : 'ramps'}` : ''}`;
    }
    return 'Done';
  }

  /** Seconds left to undo the last road, skyway or zone drag (0 = nothing to undo). */
  undoLeft(): number {
    const b = this.bridgeUndo;
    if (b) {
      const left = SAFETY.undoSec - (this.now() - b.at);
      return left > 0 ? left : 0;
    }
    const u = this.undoSnap;
    if (!u) return 0;
    const left = SAFETY.undoSec - (this.now() - u.at);
    return left > 0 ? left : 0;
  }

  /**
   * Undo the last road, skyway or zone drag (EXPANSION §7.7): only inside SAFETY.undoSec and only
   * while every changed tile is still as the drag left it (a lot that developed meanwhile, or a
   * building placed on it, blocks it: "Too late to undo"). Writes the before-states back, refunds
   * the credits spent, recomputes and toasts "Undone". Returns true when it undid something.
   */
  undo(): boolean {
    if (this.bridgeUndo) return this.undoSkybridge();
    const u = this.undoSnap;
    if (!u) return false;
    const w = this.world;
    this.undoSnap = null;
    let ok = this.now() - u.at <= SAFETY.undoSec;
    for (const t of u.tiles) {
      if (!ok) break;
      const i = t.after.i;
      if (!sameSnap(snapOf(w, i), t.after) || (w.tiles[i].buildingId >= 0) !== t.building) ok = false;
    }
    if (!ok) {
      this.toast('Too late to undo', 'error');
      this.events.emit('sfx', 'error');
      return false;
    }
    const touched = this.touching(() => {
      for (const t of u.tiles) w.restoreTile(t.before.i, t.before);
    });
    w.funds += u.spent;
    this.cancelPending(); // a plan waiting for ✓ goes with its ghost
    this.events.emit('sfx', 'click');
    this.toast('Undone', 'info');
    let rect = touched.rect;
    for (const t of u.tiles) rect = growRect(rect, t.before.i % w.N, (t.before.i / w.N) | 0);
    this.recomputeAround(rect);
    if (storyTool(u.tool)) {
      if (u.tool === 'rail') vertical.refresh(w);
      else vertical.refreshIfMoved(w);
      this.story.markDirty();
    }
    this.events.emit('stats');
    return true;
  }

  // ── Refund (EXPANSION §7.7) ───────────────────────────────────────────────

  /**
   * Credits paid (and build credits used) for the buildings a ground bulldoze plan removes that were
   * placed under SAFETY.refundSec ago; `ids` are the buildings whose demolition fee is waived.
   */
  private refundFor(plan: ActionPlan): { total: number; ids: number[]; credits: UsedCredit[] } {
    const w = this.world;
    const out = { total: 0, ids: [] as number[], credits: [] as UsedCredit[] };
    if (!this.placed.size) return out;
    const now = this.now();
    const seen = new Set<number>();
    for (const p of plan.tiles) {
      if (!p.ok) continue;
      const id = w.tileAt(p.x, p.y)?.buildingId ?? -1;
      if (id < 0 || seen.has(id)) continue;
      seen.add(id);
      const rec = this.placed.get(id);
      const b = w.buildings.get(id);
      if (rec && b && now - rec.at < SAFETY.refundSec) {
        out.total += rec.paid;
        if (rec.credit) out.credits.push(rec.credit);
        out.ids.push(id);
      }
    }
    return out;
  }

  /** Seconds left of building `id`'s full refund (0 = none: placed earlier, or not this session). */
  refundLeft(id: number): number {
    const rec = this.placed.get(id);
    if (!rec) return 0;
    const left = SAFETY.refundSec - (this.now() - rec.at);
    return left > 0 ? left : 0;
  }

  // ── Frame update ──────────────────────────────────────────────────────────
  /**
   * Advance by real seconds `dt` (clamped). The sim runs in slices (MEGACITY §3.3): `Simulation.stepSlice` within the
   * frame cap of this device class (6 ms handheld, 10 ms PC), a day's units over one or more frames; days are due at
   * the speed's rate (capped at LOW_DETAIL.maxDaysPerSec in lower detail, §3.11), a backlog over 4 days is dropped,
   * and the frame guard switches far districts to resting under strain ('auto', §3.11).
   */
  update(dt: number) {
    dt = Math.min(Math.max(dt, 0), 0.25);
    this.simMsThisFrame = 0;
    this.simRanThisFrame = false;
    if (this.notices.length) {
      const n = this.notices.splice(0);
      for (const t of n) this.toast(t.text, t.kind, t.action);
    }
    this.story.update(dt, this.speed === 0);
    if (this.speed > 0) {
      tickMirrorClock(dt);
      this.cityEvents.update(dt);
      this.tickEpilogue(dt);
    }
    this.syncStoryPause();
    if (this.speed > 0) {
      this.clock += dt * this.clockRate;
      this.tickAcc += dt * this.daysPerSec;
      const sim = this.sim;
      const cap = this.guard.cap;
      const t0 = this.msClock();
      let days = 0;
      while (this.tickAcc >= 1 || sim.midDay) {
        const spent = this.msClock() - t0;
        if (this.simRanThisFrame && spent >= cap) break;
        this.simRanThisFrame = true;
        // A step starts only while it fits; at least one runs per call, so the sim never stalls.
        const done = sim.stepSlice(Math.max(0, cap - spent));
        if (!done) break;
        this.tickAcc = Math.max(0, this.tickAcc - 1);
        days++;
        this.story.onDay();
        if (this.story.blocking) {
          this.tickAcc = 0; // a card opened: stop now and drop the backlog
          break;
        }
      }
      this.simMsThisFrame = this.msClock() - t0;
      if (days > 0) this.events.emit('stats');
      let dropped = false;
      if (this.tickAcc > BACKLOG_DAYS) {
        // Drop the backlog on slow devices: a hitch never turns into seconds of saturated catch-up.
        this.droppedDays += Math.floor(this.tickAcc);
        this.tickAcc = 0;
        dropped = true;
      }
      this.guard.record(dt, this.simMsThisFrame, this.speed, dropped);
      this.syncSleep();
      this.updateSpaceports(dt);
      this.syncStoryPause();
    }
  }

  /**
   * Finish a sliced day in flight (MEGACITY §3.3) before the city is written or annexed: the day's first unit already
   * advanced `w.tick`, so a save taken mid-day would store the new day with the rest of it (a month end's settlement,
   * 'month' event, goals and the story's month tick) skipped for good. Runs the story's day as Game.update would.
   */
  private finishDay(): void {
    if (!this.sim?.finishDay()) return;
    this.tickAcc = Math.max(0, this.tickAcc - 1);
    this.story.onDay();
    this.events.emit('stats');
  }

  /** Days a second at the current speed: SPEED_TICKS_PER_SEC, capped at LOW_DETAIL.maxDaysPerSec in lower detail (§3.11). */
  get daysPerSec(): number {
    const rate = SPEED_TICKS_PER_SEC[this.speed] ?? 0;
    return this.lowerDetail ? Math.min(rate, LOW_DETAIL.maxDaysPerSec) : rate;
  }

  /** The speed tooltip's line in lower detail (§3.11: "the speed tooltip and the warning say so"), else null. */
  get speedCapNote(): string | null {
    return this.lowerDetail ? `Lower detail: up to ${LOW_DETAIL.maxDaysPerSec} days a second` : null;
  }

  /** Unpaused seconds between autosaves (§3.3, §3.11): REGION[R].autosaveMinSec, LOW_DETAIL.autosaveMinSec in lower detail. */
  get autosaveMinSec(): number {
    if (this.lowerDetail) return LOW_DETAIL.autosaveMinSec;
    return REGION[this.world.region as Region]?.autosaveMinSec ?? REGION[3].autosaveMinSec;
  }

  /**
   * How far districts rest (O8, §3.3, §3.11): 'forced' in lower detail; on a 5×5 city (and a 3×3 city on a handheld
   * device while SLEEP.region3Handheld is 'auto') they rest only while the frame guard sees strain; else never.
   */
  get sleepMode(): 'off' | 'auto' | 'forced' {
    if (this.lowerDetail) return 'forced';
    const r = this.world.region;
    const adaptive = r === 5 || (r === 3 && deviceClass() === 'handheld' && SLEEP.region3Handheld === 'auto');
    return adaptive && this.guard.engaged ? 'auto' : 'off';
  }

  private syncSleep(): void {
    this.sim.sleep = this.sleepMode;
    this.sim.sleepFocus = this.viewSlot;
  }

  /** The tile at the centre of the view (main.ts, each frame): its district stays awake in lower detail. */
  setViewCentre(x: number, y: number): void {
    this.viewSlot = this.world.inBounds(x, y) ? this.world.slotAt(x, y) : -1;
  }

  // ── Spaceport construction floor and launches (EXPANSION §5.3) ───────────

  /**
   * Every unpaused frame (any speed): count each Spaceport's waitSec down by `dt`, run the
   * launch clock of each complete, online, powered one, and lift off when it is night
   * (daylight < SPACEPORT.nightBelow) and at least launchGapSec have passed since its last
   * launch. The first launch is announced SPACEPORT.firstLeadSec ahead with a Watch toast.
   */
  private updateSpaceports(dt: number): void {
    const w = this.world;
    const S = SPACEPORT;
    for (const b of w.buildings.values()) {
      if (b.type !== 'spaceport') continue;
      if ((b.waitSec ?? 0) > 0) b.waitSec = Math.max(0, (b.waitSec ?? 0) - dt);
      if ((b.buildDays ?? 0) > 0 || (b.waitSec ?? 0) > 0) {
        this.launchBuilding.add(b.id);
        continue;
      }
      const c = this.launchClockOf(b) + (b.offline <= 0 && b.powered ? dt : 0);
      this.launchClock.set(b.id, c);
      if (this.lead || b.offline > 0 || !b.powered) continue;
      if (c < S.launchGapSec || this.daylight >= S.nightBelow) continue;
      if ((b.launches ?? 0) === 0) {
        this.lead = { id: b.id, left: S.firstLeadSec };
        this.toast(`First launch in ${S.firstLeadSec} s`, 'info', { id: 'watch', label: 'Watch', sec: S.firstLeadSec });
      } else this.liftoff(b, false);
    }
    const lead = this.lead;
    if (lead) {
      const b = w.buildings.get(lead.id);
      if (!b || b.type !== 'spaceport') this.lead = null;
      else {
        lead.left -= dt;
        if (lead.left <= 0) {
          this.lead = null;
          this.liftoff(b, true);
        }
      }
    }
  }

  /**
   * Test and harness hook: make every complete Spaceport's next launch due at the next night
   * (its launch clock jumps to the full gap), instead of waiting out half a gap after a load.
   */
  readyLaunches(): void {
    for (const b of this.world.buildings.values())
      if (b.type === 'spaceport' && !((b.buildDays ?? 0) > 0) && !((b.waitSec ?? 0) > 0)) this.launchClock.set(b.id, SPACEPORT.launchGapSec);
  }

  /** A Spaceport's launch clock: a launch gap once it completes in this world, half a gap after a load or swap. */
  private launchClockOf(b: Building): number {
    const c = this.launchClock.get(b.id);
    if (c !== undefined) return c;
    return this.launchBuilding.has(b.id) ? SPACEPORT.launchGapSec : SPACEPORT.launchGapSec / 2;
  }

  /** A visible launch starts now: event, one rotating news line, the count, the clock; the first gets its banner. */
  private liftoff(b: Building, first: boolean): void {
    const w = this.world;
    const n = b.launches ?? 0;
    b.launches = n + 1;
    this.launchClock.set(b.id, 0);
    this.events.emit('liftoff', { id: b.id, first });
    w.addNews(LAUNCH_NEWS[n % LAUNCH_NEWS.length].replace('{city}', w.cityName), 'info');
    if (first && !w.moments.has('launch')) {
      w.moments.add('launch');
      this.events.emit('moment', { id: 'launch', title: 'FIRST LAUNCH', sub: `Every roof in ${w.cityName} is watching` });
    }
  }

  /** The first launch's announced lead (the Watch toast's target): the pad, and seconds left; else null. */
  get launchLead(): { id: number; x: number; y: number; left: number } | null {
    const l = this.lead;
    if (!l) return null;
    const b = this.world.buildings.get(l.id);
    if (!b) return null;
    return { id: b.id, x: b.x + b.size / 2, y: b.y + b.size / 2, left: Math.max(0, l.left) };
  }

  /** Launch state of Spaceport `id` for the inspect sheet, or null for anything else. */
  launchStatus(id: number): LaunchStatus | null {
    const b = this.world.buildings.get(id);
    if (!b || b.type !== 'spaceport') return null;
    const complete = (b.buildDays ?? 0) <= 0 && (b.waitSec ?? 0) <= 0;
    const clock = this.launchClockOf(b);
    return {
      progress: this.sim.ports.buildProgress(id),
      complete,
      active: complete && b.offline <= 0 && b.powered,
      gapLeft: complete ? Math.max(0, SPACEPORT.launchGapSec - clock) : SPACEPORT.launchGapSec,
      lead: this.lead?.id === id ? Math.max(0, this.lead.left) : null,
      launches: b.launches ?? 0,
    };
  }

  /** Read-only port numbers: visitors, trade per seaport, demand adds, spaceport progress (EXPANSION §2.7). */
  get ports(): PortView {
    return this.sim.ports;
  }

  /** Pause while a blocking story card is open; restore the previous speed after it closes. */
  private syncStoryPause() {
    if (this.story.blocking) {
      if (this.speed > 0) {
        this.storyResumeSpeed = this.speed;
        this.setSpeed(0);
      }
    } else if (this.storyResumeSpeed !== null) {
      const s = this.storyResumeSpeed;
      this.storyResumeSpeed = null;
      if (this.speed === 0) this.setSpeed(s);
    }
  }

  // ── Story (docs/STORY.md §11): thin forwards to the director and actions ──
  /** Answer the open story card. Choices can move pacts and tiers, so turf layers are re-derived. */
  choose(i: number) {
    this.story.choose(i);
    turf.refreshStats(this.world);
  }
  openPending() {
    this.story.openPending();
  }
  /** Open the story message waiting on the goal chip / banner (a beat, Silt Log or chapter reward). */
  openWaiting() {
    this.story.openWaiting();
  }
  later() {
    this.story.later();
  }
  /** Raise a Stratablock (crown required when starting stage 3). */
  raiseStage(id: number, crown?: CrownId, look?: 0 | 1 | 2 | 3): ActionResult {
    return this.afterStoryAction(raiseStage(this.world, id, crown, look), 'build', false, this.buildingRect(id));
  }

  /** A building's footprint as a rect (the local recompute after a building-only story action), or null. */
  private buildingRect(id: number): TileRectLike | null {
    const b = this.world.buildings.get(id);
    return b ? { x0: b.x, y0: b.y, x1: b.x + b.size - 1, y1: b.y + b.size - 1 } : null;
  }
  crackdown(precinctId: number): ActionResult {
    return this.afterStoryAction(crackdown(this.world, precinctId), 'alert');
  }
  /** Pact hook: a new pact changes the gang's turf crime, tax skim and spread (§3.6), so turf is re-derived. */
  signPact(g: GangId): ActionResult {
    return this.afterStoryAction(this.story.signPact(g), 'money', true);
  }
  /** Gang deals are pacts, so turf is re-derived after any deal. */
  takeDeal(f: FactionId): ActionResult {
    return this.afterStoryAction(this.story.takeDeal(f), 'money', true);
  }
  sendSalt(f: FactionId): ActionResult {
    return this.afterStoryAction(this.story.sendSalt(f), 'money');
  }
  nudge(f: FactionId): ActionResult {
    return this.afterStoryAction(this.story.nudge(f), 'click');
  }
  chooseEnding(id: EndingId): ActionResult {
    return this.afterStoryAction(this.story.chooseEnding(id), 'milestone');
  }
  recount() {
    this.story.recount();
  }

  /**
   * Story buttons for the inspect panel at (x, y) (§8.8): Crackdown on a precinct
   * (radius for the map preview), Raise / Crown on a Stratablock (crown picker
   * rows on 'crown'). Disabled rows carry their reason. Empty elsewhere.
   */
  inspectActions(x: number, y: number, sky = false, link?: number): InspectAction[] {
    const w = this.world;
    if (link !== undefined) {
      // A skybridge tube (MEGACITY §5.5): remove it (no refund once the 10 s undo has passed).
      if (!w.links.some((l) => l.id === link)) return [];
      return [{ id: 'bridgeRemove', label: 'Remove skybridge', cost: 0, enabled: true, buildingId: -1, x, y }];
    }
    if (w.inBounds(x, y) && !w.isOwned(x, y)) {
      // A locked district (§3.4): its preview opens the City map on it.
      return [{ id: 'map', label: 'Open City map', cost: 0, enabled: true, buildingId: -1, x, y }];
    }
    if (sky) {
      // Skyway sheet (EXPANSION §7.4): demolish this segment (one tile, a sky-layer bulldoze).
      if (!w.inBounds(x, y) || w.sky[w.idx(x, y)] === 0) return [];
      const cost = planAction(w, 'bulldoze', { x, y }, { x, y }).cost;
      const a: InspectAction = { id: 'skyway', label: `Demolish segment · ${num(cost)} ${CURRENCY}`, cost, enabled: w.funds >= cost, buildingId: -1, x, y };
      if (w.funds < cost) a.reason = `Not enough credits (need ${num(cost)} ${CURRENCY})`;
      return [a];
    }
    const b = w.buildingAt(x, y);
    if (!b) return [];
    if (b.type === 'frame') {
      // Skeleton Row (§3.7): finish it as a Stratablock with its Plinth done, for 60% of the plinth.
      const st = frameStatus(w, b.id);
      const a: InspectAction = { id: 'frame', label: `Finish frame · ${num(st.cost)} ${CURRENCY}`, cost: st.cost, enabled: !st.reason, buildingId: b.id };
      if (st.reason) a.reason = st.reason;
      return [a];
    }
    if (b.type === 'spaceport') {
      // Launch rights (EXPANSION §5.3): chosen when the player is ready, from placement on.
      if (w.story.flags.launchRights) return [];
      const a: InspectAction = { id: 'rights', label: 'Launch rights · Choose', cost: 0, enabled: true, buildingId: b.id };
      if (!storyContent().cards.get(RIGHTS_CARD)) {
        a.enabled = false;
        a.reason = 'Not available yet';
      } else if (this.story.blocking) {
        a.enabled = false;
        a.reason = 'Answer the open message first';
      }
      return [a];
    }
    if (b.type === 'precinct') {
      const st = crackdownStatus(w, b.id);
      const label = st.endsTruce ? 'Crackdown · ends the Truce' : `Crackdown · ${num(st.cost)} ${CURRENCY}`;
      const a: InspectAction = { id: 'crackdown', label, cost: st.cost, enabled: !st.reason, buildingId: b.id, radius: st.r };
      if (st.reason) a.reason = st.reason;
      return [a];
    }
    if (b.type === 'stack') {
      const st = stageStatus(w, b);
      if (st.next === null) {
        if (st.building <= 0) return [];
        const name = vertical.stageName(3, b.crown);
        return [{ id: 'raise', label: `${name} · building ${st.building}d`, cost: 0, enabled: false, reason: st.reason ?? undefined, buildingId: b.id, days: st.building }];
      }
      const name = STACK_STAGES[st.next - 1].name;
      const a: InspectAction = {
        id: st.next === 3 ? 'crown' : 'raise',
        label: `Raise to ${name} · ${num(st.cost)} ${CURRENCY} · ${st.days} d`,
        cost: st.cost,
        enabled: !st.reason,
        buildingId: b.id,
        days: st.days,
      };
      if (st.reason) a.reason = st.reason;
      if (st.next === 3) a.crowns = crownOptions(w);
      return [a];
    }
    return [];
  }

  /**
   * Open the launch-rights card for Spaceport `buildingId` (EXPANSION §5.3, §8.3 `ex.rights`)
   * through director.openOnDemand: no deck slot, not an interruption. It blocks like any
   * open card (the game pauses). Refused while another card is open or once rights are given.
   */
  openLaunchRights(buildingId: number): ActionResult {
    const b = this.world.buildings.get(buildingId);
    let r: ActionResult;
    if (!b || b.type !== 'spaceport') r = { ok: false, reason: 'Not a Spaceport', cost: 0 };
    else if (this.world.story.flags.launchRights) r = { ok: false, reason: 'Launch rights are already granted', cost: 0 };
    else r = this.story.openOnDemand(RIGHTS_CARD);
    if (!r.ok) {
      if (r.reason) this.toast(r.reason, 'error');
      this.events.emit('sfx', 'error');
      return r;
    }
    this.events.emit('sfx', 'click');
    this.syncStoryPause();
    return r;
  }

  /**
   * Demolish the skyway segment on (x, y) (the skyway sheet's action, EXPANSION §7.4): a
   * sky-layer bulldoze of that one tile (SKYWAY.bulldozeCost); ground, zones and buildings stay.
   */
  demolishSkySegment(x: number, y: number): ActionResult {
    const w = this.world;
    if (!w.inBounds(x, y) || w.sky[w.idx(x, y)] === 0) {
      this.events.emit('sfx', 'error');
      return { ok: false, reason: 'No skyway here', cost: 0 };
    }
    const touched = this.touching(() => applyAction(w, 'bulldoze', { x, y }, { x, y }));
    const plan = touched.out;
    if (!plan.valid) {
      if (plan.reason) this.toast(plan.reason, 'error');
      this.events.emit('sfx', 'error');
      return { ok: false, reason: plan.reason ?? 'Nothing to demolish', cost: 0 };
    }
    this.undoSnap = null;
    this.cancelPending();
    this.events.emit('sfx', 'bulldoze');
    if (this.selected?.sky && this.selected.x === x && this.selected.y === y) this.select(null);
    this.recomputeAround(growRect(touched.rect, x, y));
    vertical.refreshIfMoved(w);
    this.story.markDirty();
    this.events.emit('stats');
    return { ok: true, cost: plan.cost };
  }

  // ── Skybridges v2 (MEGACITY §5.4, §5.5; WP-2) ─────────────────────────────
  /**
   * Tap a tower with the Skybridge tool (§5.4): the tall anchor at (x, y) becomes the source and its partners come
   * back (green ones build, red ones carry their reason, blue routes are two bridges). Null (and no source) when
   * (x, y) is not a tall tower in the city; tapping the source again deselects.
   */
  skybridgeSource(x: number, y: number): vertical.Partner[] | null {
    const w = this.world;
    const a = vertical.anchorAt(w, x, y);
    const cur = this.bridgeSource ? vertical.anchorAt(w, this.bridgeSource.x, this.bridgeSource.y) : null;
    if (!a || (cur && cur.key === a.key)) {
      this.bridgeSource = null;
      return null;
    }
    this.bridgeSource = { x, y };
    return vertical.skybridgePartners(w, x, y);
  }

  /** The current source's partners (recomputed on every call: the UI asks again on 'tiles' events). */
  skybridgePartners(): vertical.Partner[] {
    const src = this.bridgeSource;
    if (!src) return [];
    return vertical.skybridgePartners(this.world, src.x, src.y);
  }

  /** The current source's lanes (the overlay's ghost tubes and see-through bands, §5.4). */
  skybridgeLanes(): ReturnType<typeof vertical.laneBands> {
    const src = this.bridgeSource;
    return src ? vertical.laneBands(this.world, src.x, src.y) : [];
  }

  /** Plan a bridge (or a two-bridge route) from the source to (x, y): payoff, price, reason (§5.3, §5.5). */
  planSkybridge(x: number, y: number): ActionPlan {
    const src = this.bridgeSource;
    if (!src) return { tool: 'skybridge', tiles: [], cost: 0, valid: false, reason: 'Start on a tall tower' };
    return planAction(this.world, 'skybridge', src, { x, y });
  }

  /**
   * Build the planned bridge from the source to (x, y) (§5.4 step 3): with the Undo toast (10 s) and the payoff; the
   * far tower becomes the next source, so a Sky Lobby takes one tap per bridge. A two-bridge route confirms first:
   * pass `confirmed` once the player tapped ✓ (the plan comes back with `confirm` until then).
   */
  applySkybridge(x: number, y: number, confirmed = false): ActionPlan {
    const src = this.bridgeSource;
    const plan = this.planSkybridge(x, y);
    if (!src || !plan.valid || (plan.confirm && !confirmed)) {
      if (!plan.valid && plan.reason && src) this.toast(plan.reason, 'error');
      return plan;
    }
    if (this.tool !== 'skybridge') this.setTool('skybridge');
    const out = this.apply(src, { x, y });
    return out;
  }

  /** After a bridge (or route) was built: the payoff toast with Undo, and the far tower as the next source. */
  private builtSkybridge(plan: ActionPlan, linkMark: number): void {
    const w = this.world;
    const ids = w.links.filter((l) => l.id >= linkMark).map((l) => l.id);
    this.bridgeUndo = ids.length ? { ids, spent: plan.cost, at: this.now() } : null;
    const p = plan.bridge;
    const n = ids.length;
    const head = n > 1 ? `${n} skybridges` : 'Skybridge';
    const pay = p ? ` · ${num(p.walkers)} walkers · cars −${p.lobby ? 25 : 20}%` : '';
    this.toast(`${head} built${pay}`, 'good', { id: 'undo', label: 'Undo', sec: SAFETY.undoSec });
    const far = plan.route?.second ?? plan.span;
    const next = far ? { x: far.bx, y: far.by } : null;
    this.bridgeSource = next && vertical.anchorAt(w, next.x, next.y) ? next : null;
  }

  /** Undo the last skybridge build inside SAFETY.undoSec: the links go and their price comes back (§5.3 rule 8). */
  private undoSkybridge(): boolean {
    const u = this.bridgeUndo;
    this.bridgeUndo = null;
    if (!u) return false;
    const w = this.world;
    if (this.now() - u.at > SAFETY.undoSec || !u.ids.every((id) => w.links.some((l) => l.id === id))) {
      this.toast('Too late to undo', 'error');
      this.events.emit('sfx', 'error');
      return false;
    }
    let rect: TileRectLike | null = null;
    for (const id of u.ids) {
      const l = w.links.find((k) => k.id === id);
      if (l) rect = growRect(growRect(rect, l.ax, l.ay), l.bx, l.by);
      removeLink(w, id);
    }
    w.funds += u.spent;
    this.cancelPending();
    this.events.emit('sfx', 'click');
    this.toast('Undone', 'info');
    // The links' layers are rewritten first (vertical), then the fields around their towers.
    vertical.refresh(w);
    this.recomputeAround(rect);
    this.story.markDirty();
    this.events.emit('stats');
    return true;
  }

  /** The inspect sheet's "Remove skybridge" (§5.5): the link goes, no refund (the 10 s undo already passed). */
  removeSkybridge(linkId: number): ActionResult {
    const w = this.world;
    if (!w.links.some((l) => l.id === linkId)) {
      this.events.emit('sfx', 'error');
      return { ok: false, reason: 'No skybridge here', cost: 0 };
    }
    const l = w.links.find((k) => k.id === linkId)!;
    const rect = growRect(growRect(null, l.ax, l.ay), l.bx, l.by);
    removeLink(w, linkId);
    if (this.selected?.link === linkId) this.select(null);
    this.events.emit('sfx', 'bulldoze');
    this.cancelPending();
    this.undoSnap = null;
    this.bridgeUndo = null;
    vertical.refresh(w);
    this.recomputeAround(rect);
    this.story.markDirty();
    this.events.emit('stats');
    return { ok: true, cost: 0 };
  }

  /** What one built bridge pays now (§5.5), for inspect and the UI. */
  skybridgePayoff(linkId: number): BridgePayoff | null {
    const l = this.world.links.find((k) => k.id === linkId);
    return l ? vertical.skybridgePayoff(this.world, { x: l.ax, y: l.ay }, { x: l.bx, y: l.by }) : null;
  }

  /**
   * Inspect a skybridge tube (Selection.link, §5.5): walkers a day, cars saved, land, its lobby, upkeep; the lobby
   * note, the dark note. Null when the link is gone.
   */
  linkInfo(linkId: number): TileInfo | null {
    const w = this.world;
    const l = w.links.find((k) => k.id === linkId);
    if (!l) return null;
    const p = vertical.skybridgePayoff(w, { x: l.ax, y: l.ay }, { x: l.bx, y: l.by });
    const active = w.vertical.activeLinks.has(l.id);
    const gap = vertical.linkGap(l);
    const rows: [string, string][] = [
      ['Walkers', active ? `${num(p.walkers)}/day` : '0/day'],
      ['Cars', active ? `−${p.lobby ? 25 : 20}%` : '—'],
      ['Land', active ? '+5%' : '—'],
    ];
    if (p.lobby && active) rows.push(['Lobby', `${p.lobby.k} towers`]);
    rows.push(['Upkeep', active ? `${SKYBRIDGE.upkeepBase + SKYBRIDGE.upkeepPerTile * gap}/mo` : '0/mo']);
    const notes: NonNullable<TileInfo['notes']> = [];
    if (p.lobby && active) notes.push({ text: `Part of Sky Lobby ${p.lobby.name}: +${num(p.lobby.visitors)} visitors a month`, tone: 'good' });
    if (vertical.linkSealed(w, l)) notes.push({ text: 'Dark: a tower here is no longer tall', tone: 'warn' });
    else if (!active) notes.push({ text: 'Dark: a tower here has no power', tone: 'warn' });
    return { title: 'Skybridge', subtitle: 'A walkway for people. Skyways carry cars.', color: '#7fe8ff', rows, ...(notes.length ? { notes } : {}) };
  }

  // ── Skeleton Row frames (MEGACITY §3.7) ──────────────────────────────────
  /** Finish a frame into a Stratablock with its Plinth done (the inspect action 'frame'). */
  finishFrame(id: number): ActionResult {
    const rect = this.buildingRect(id);
    const r = finishFrame(this.world, id);
    return this.afterStoryAction(r, 'build', true, rect);
  }

  /**
   * Common follow-up for story actions: feedback, and a refresh when something changed. A building-only action passes
   * its `rect` (a local recompute, O5); deals, pacts and endings move city-wide mods, so they recompute everything.
   */
  private afterStoryAction(r: ActionResult, sfx: GameEventMap['sfx'], refreshTurf = false, rect: TileRectLike | null = null): ActionResult {
    if (!r.ok) {
      if (r.reason) this.toast(r.reason, 'error');
      this.events.emit('sfx', 'error');
      return r;
    }
    // Any other action ends the one-step undo (EXPANSION §7.7).
    this.undoSnap = null;
    this.bridgeUndo = null;
    this.events.emit('sfx', sfx);
    if (refreshTurf) turf.refreshStats(this.world);
    this.story.markDirty();
    this.recomputeAround(rect);
    this.events.emit('stats');
    return r;
  }

  /**
   * Rate of the visual clock (day / night): 0 while paused, else ×1 / ×1.6 / ×2.4 at speeds
   * 1 / 2 / 3 (EXPANSION §2.7). "Clock-scaled" FX (ships, planes) advance by dt × clockRate.
   */
  get clockRate(): number {
    return CLOCK_RATE[this.speed] ?? 0;
  }

  /**
   * Visual time of day in [0, 1): 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
   * Locked to 0.92 (late evening) when the day/night cycle is off.
   */
  get timeOfDay(): number {
    if (!this.settings.dayNight) return 0.92;
    return ((this.clock / DAY_CYCLE_SECONDS) % 1 + 1) % 1;
  }

  /**
   * Ambient daylight 0 (deep night) .. 1 (full day). Nights are long: the city
   * spends roughly 60% of the cycle in darkness or dusk, since neon is the point.
   */
  get daylight(): number {
    const t = this.timeOfDay;
    const sun = Math.sin((t - 0.25) * Math.PI * 2); // -1 midnight, 1 noon
    const v = (sun - 0.15) / 0.55;
    return Math.max(0, Math.min(1, v));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /**
   * Start a fresh city on a region (MEGACITY §3.11: the New City sheet's choice, the device default until WP-5 adds the
   * control). Synchronous, as `found()` expects. The city it replaces is kept in `.prev` first, plain and synchronously
   * (§3.10), unless saveBlocked (the city in memory is then a stand-in) or it is untouched. If even after the quota
   * drops it doesn't fit, nothing changes: `keepCopyFailed` names the city and the UI offers Export and
   * "Replace without a copy" (`opts.replaceWithoutCopy`).
   */
  newCity(name?: string, seed = randomSeed(), region: Region = 3, opts: { replaceWithoutCopy?: boolean } = {}) {
    if (this.backupCurrent(opts.replaceWithoutCopy === true) === null) return;
    // An explicit New City is the only thing that lifts the newer-save block (its copy stays in FUTURE_SAVE_KEY);
    // the "saved by a newer version" notice no longer applies.
    this.saveBlocked = false;
    this.notices.length = 0;
    const clean = name?.trim().slice(0, CITY_NAME_MAX);
    this.world = World.generate(seed, clean || randomCityName(seed), this.events, region === 5 ? 5 : 3);
    this.world.story.pace = this.settings.storyPace;
    this.attachSystems();
    this.noteRegion();
    this.selected = null;
    this.preview = null;
    this.tool = 'inspect';
    this.speed = 1;
    this.clock = DAY_CYCLE_SECONDS * 0.85;
    this.welcome();
    this.events.emit('world');
    this.events.emit('tool', this.tool);
    this.events.emit('speed', this.speed);
    this.events.emit('stats');
    this.save(true);
  }

  // ── Districts (MEGACITY §3.4, §3.8, §7.2; WP-2) ──────────────────────────
  /**
   * Annex a slot (§3.8): a locked slot 4-adjacent to the city whose `opensWhen` holds. It costs one land grant while
   * the city holds any; with none left, after an ending only, `districtPrice(owned)` credits (as buyDistrict). Tarmac
   * Reach (variant 0 only) needs its lease picked. Structural annex (one batched 'tiles' event), the district layer
   * part, the lobbyists' reactions (repeat districts of a kind react less), a full recompute, the banners and a save.
   * Not undoable (confirmed on the sheet, §7.2).
   */
  annex(slot: SlotId, lease?: 'nacre' | 'basalt'): ActionResult {
    const w = this.world;
    const why = this.annexBlock(slot, lease);
    if (why) return { ok: false, reason: why, cost: 0 };
    if (w.districts.grants <= 0) return this.buyDistrict(slot, lease);
    w.districts.grants--;
    this.doAnnex(slot, lease);
    return { ok: true, cost: 0 };
  }

  /**
   * Buy a district with credits (§3.8): after an ending only, at districtPrice(owned): a fixed rule by districts owned,
   * never scaled with funds. Buying never resets the epilogue grant clock.
   */
  buyDistrict(slot: SlotId, lease?: 'nacre' | 'basalt'): ActionResult {
    const w = this.world;
    const why = this.annexBlock(slot, lease);
    if (why) return { ok: false, reason: why, cost: 0 };
    if (!w.story.ending) return { ok: false, reason: this.nextGrantText(), cost: 0 };
    const price = districtPrice(w.districts.owned.length);
    if (w.funds < price) return { ok: false, reason: `Not enough credits (need ${num(price)} ${CURRENCY})`, cost: 0 };
    w.funds -= price;
    w.districts.bought++;
    this.doAnnex(slot, lease);
    return { ok: true, cost: price };
  }

  /** Why a slot can't be annexed now (its state and the lease), or null. Payment is checked by the caller. */
  private annexBlock(slot: SlotId, lease?: 'nacre' | 'basalt'): string | null {
    const w = this.world;
    if (this.saveBlocked) return 'Reload to update first';
    if (!validSlot(w.region, slot) || w.slotOwned[slot]) return 'Not a district to annex';
    const def = DISTRICTS[w.districts.kinds[slot]];
    if (def?.opensWhen && !evalCond(w, def.opensWhen)) return 'Still flooded: opens later';
    if (!adjacentLocked(w).includes(slot)) return 'Not next to the city yet';
    if (this.needsLease(slot) && lease !== 'nacre' && lease !== 'basalt') return 'Pick who leases the old apron';
    return null;
  }

  /** Tarmac Reach itself (variant 0, never its repeats) asks who leases the apron (§3.7). */
  private needsLease(slot: SlotId): boolean {
    const w = this.world;
    return w.districts.kinds[slot] === 'tarmac' && w.variantOf(slot) === 0 && !!DISTRICTS.tarmac.lease;
  }

  private doAnnex(slot: SlotId, lease?: 'nacre' | 'basalt'): void {
    // The annex lands between two days, never inside a sliced one (its save below must not store half a day).
    this.finishDay();
    const w = this.world;
    const kind = w.districts.kinds[slot];
    const repeat = w.districts.owned.some((s) => w.districts.kinds[s] === kind);
    const leased = this.needsLease(slot) ? lease : undefined;
    if (leased) w.districts.leases = { ...w.districts.leases, tarmac: leased };
    // Rivals: the lobbyists of the other current candidates (director.onAnnex skips kinds already owned).
    const rivals = adjacentLocked(w)
      .filter((s) => s !== slot)
      .filter((s) => {
        const d = DISTRICTS[w.districts.kinds[s]];
        return !d?.opensWhen || evalCond(w, d.opensWhen);
      })
      .map((s) => w.districts.kinds[s]);
    this.cancelPending();
    this.undoSnap = null;
    this.bridgeUndo = null;
    w.annex(slot);
    updateDistrictLayers(w, true);
    this.story.onAnnex(kind, leased, repeat, rivals);
    this.sim.recomputeAll();
    vertical.refresh(w, { quiet: true });
    this.seedOnAnnex(slot, kind);
    turf.refreshStats(w);
    const name = districtTitle(w, slot);
    w.addNews(`${w.cityName} grows: ${name} joins the city.`, 'good');
    // The once-per-kind banner (§3.8): the first district of a kind only; repeats post the news line alone.
    if (!repeat) {
      const def = DISTRICTS[kind];
      this.events.emit('moment', { id: 'region', title: `DISTRICT ANNEXED · ${name.toUpperCase()}`, sub: def?.perks[0] ?? def?.tagline ?? '' });
    }
    this.regionWhole();
    this.events.emit('stats');
    this.save();
  }

  /**
   * The gangs move in on annex (§3.7): the Undertow seeds in the Sunk and the Kites by a Skeleton Row frame, each only
   * once it has seeded in the city (before that it seeds at its normal time). One 3×3 patch at its best free tile
   * there; for the Kites the best tile on or next to a frame (turf stands on a frame once turf.ts keeps it, WP-1).
   */
  private seedOnAnnex(slot: SlotId, kind: DistrictKind): number {
    const w = this.world;
    const gang: GangId | null = kind === 'sunk' ? 'undertow' : kind === 'skeleton' ? 'kites' : null;
    if (!gang || !w.turf.seeded[gang]) return 0;
    const r = slotRect(w, slot);
    const frames: Building[] = [];
    if (gang === 'kites') for (const b of w.buildings.values()) if (b.type === 'frame' && w.slotAt(b.x, b.y) === slot) frames.push(b);
    const nearFrame = (x: number, y: number) => frames.some((b) => x >= b.x - 1 && x <= b.x + b.size && y >= b.y - 1 && y <= b.y + b.size);
    const aff = turf.affinity(w, gang);
    let best = -1;
    let bestA = -Infinity;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        if (!turf.isEligible(w, x, y) || turf.ownerAt(w, x, y)) continue;
        if (gang === 'kites' && !nearFrame(x, y)) continue;
        const a = aff[y * w.N + x];
        if (a > bestA) {
          bestA = a;
          best = y * w.N + x;
        }
      }
    if (best < 0) return 0;
    return turf.seedGang(w, gang, best % w.N, (best / w.N) | 0);
  }

  /** The annex that makes every slot owned queues the "region is whole" banner once (again at 25 after growing, §3.8). */
  private regionWhole(): void {
    const w = this.world;
    const total = w.region * w.region;
    if (w.districts.owned.length < total) return;
    const flag = `regionWhole${total}`;
    if (w.story.flags[flag]) return;
    w.story.flags[flag] = true;
    w.moments.add('region');
    this.events.emit('moment', { id: 'region', title: 'THE REGION IS WHOLE', sub: `All ${total} districts are part of ${w.cityName}.` });
    w.addNews('The city reaches the edge of the region.', 'info');
  }

  /** "Next land grant: finish Chapter III" (§7.2 price line), or the epilogue grant's wait. */
  nextGrantText(): string {
    const w = this.world;
    const st = w.story;
    if (st.ending) {
      if (!adjacentLocked(w).length && w.districts.owned.length >= w.region * w.region) return 'The city reaches the edge of the region.';
      const left = Math.max(0, this.epilogueGrantSec() - (w.districts.epilogueSec ?? 0));
      return `Next land grant in ${Math.max(1, Math.ceil(left / 60))} min`;
    }
    const ch = Math.max(1, st.chapter | 0);
    if (ch >= 6) return 'Next land grant: Charter Night';
    return `Next land grant: finish Chapter ${ROMAN[ch] ?? ch}`;
  }

  /** Unpaused seconds between epilogue grants (§3.8): the pace's chapter floor × REGION[R].epilogueGrantMul. */
  epilogueGrantSec(): number {
    const pace = STORY_PACE[this.settings.storyPace] ?? STORY_PACE.relaxed;
    const mul = REGION[this.world.region as Region]?.epilogueGrantMul ?? 1;
    return pace.chapterMinSec * mul;
  }

  /**
   * The epilogue grant clock (§3.8, §9.5): after an ending, unpaused real seconds count in `districts.epilogueSec`
   * (saved) while a slot is locked and no grant is unspent; every epilogueGrantSec() one grant arrives with one ticker
   * line. Never while paused, never while a grant waits, never once every slot is owned. Buying never resets it.
   */
  private tickEpilogue(dt: number): void {
    const w = this.world;
    const d = w.districts;
    if (!w.story.ending || d.grants > 0 || d.owned.length >= w.region * w.region) return;
    d.epilogueSec = (d.epilogueSec ?? 0) + dt;
    if (d.epilogueSec < this.epilogueGrantSec()) return;
    d.epilogueSec = 0;
    d.grants++;
    this.events.emit('grant', { grants: d.grants, why: 'epilogue' });
    w.addNews('A land grant arrives: the city may annex again.', 'good');
  }

  /**
   * The City map's model (§7.2): every slot with its state (owned, candidate, not next to the city, not open yet),
   * names (variants by their own), perks, hazards, lobbyists and their lines, the reactions annexing brings, the
   * regional links that would become streets, the price line, the lease and, for owned districts, the census and goals.
   */
  districtView(): DistrictView {
    const w = this.world;
    const d = w.districts;
    const R = w.region;
    const total = R * R;
    const cands = new Set(adjacentLocked(w));
    const ended = !!w.story.ending;
    const price = districtPrice(d.owned.length);
    const slots: DistrictSlotView[] = [];
    for (let s = 0; s < total; s++) {
      const kind = d.kinds[s];
      const def = DISTRICTS[kind];
      const v = w.variantOf(s);
      const vd = v > 0 ? def?.variants[v - 1] : undefined;
      const owned = w.slotOwned[s] === 1;
      const open = !def?.opensWhen || evalCond(w, def.opensWhen);
      const state: DistrictSlotView['state'] = owned ? 'owned' : !open ? 'notOpen' : cands.has(s) ? 'candidate' : 'notAdjacent';
      const r = slotRect(w, s);
      let water = 0;
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (w.tiles[y * w.N + x].terrain === Terrain.Water) water++;
      const name = vd?.name ?? def?.name ?? 'District';
      const view: DistrictSlotView = {
        slot: s,
        kind,
        variant: v,
        name,
        short: vd?.short ?? def?.short ?? name,
        kindName: def?.name ?? name,
        tagline: state === 'notOpen' ? 'Still flooded: opens later' : vd?.tagline ?? def?.tagline ?? '',
        color: vd?.accent ?? def?.color ?? '#7f8aa8',
        state,
        land: 1 - water / (SLOT_TILES),
        perks: state === 'notOpen' ? [] : [...(def?.perks ?? [])],
        hazards: state === 'notOpen' ? [] : [...(def?.hazards ?? [])],
        lobby: state === 'notOpen' ? [] : this.lobbyLines(s),
        reactions: state === 'candidate' ? this.annexReactions(s) : [],
        linksInternal: state === 'candidate' ? this.linksOnBorder(s) : 0,
        goals: owned ? goalViews(w, s) : [],
        lease: state === 'candidate' && this.needsLease(s) && DISTRICTS.tarmac.lease ? { options: ['nacre', 'basalt'], prompt: DISTRICTS.tarmac.lease.prompt } : null,
        price: { grants: 0, credits: 0, text: '' },
        canAnnex: false,
      };
      if (owned) {
        const c = w.stats.districts?.find((x) => x.slot === s);
        view.census = c
          ? { residents: c.residents, jobs: c.jobs, developed: c.developed, avgLandValue: c.avgLandValue, ruins: c.ruins }
          : undefined;
      }
      if (state === 'candidate') {
        if (d.grants > 0) view.price = { grants: 1, credits: 0, text: `Uses 1 land grant (${d.grants - 1} left)` };
        else if (ended) view.price = { grants: 0, credits: price, text: `${num(price)} ${CURRENCY} · or wait for the next grant` };
        else view.price = { grants: 0, credits: 0, text: this.nextGrantText() };
        view.canAnnex = !this.saveBlocked && (d.grants > 0 || (ended && w.funds >= price));
      } else if (state === 'notAdjacent') view.price = { grants: 0, credits: 0, text: 'Not next to the city yet' };
      else if (state === 'notOpen') view.price = { grants: 0, credits: 0, text: 'Still flooded: opens later' };
      slots.push(view);
    }
    const whole = d.owned.length >= total;
    return {
      region: R,
      owned: d.owned.length,
      total,
      grants: d.grants,
      ended,
      price: ended ? price : 0,
      nextGrant: d.grants > 0 ? null : this.nextGrantText(),
      whole,
      edgeLine: whole ? 'The city reaches the edge of the region.' : null,
      canGrow: whole && R === 3,
      slots,
    };
  }

  /** Lobbyists of a slot with their lines (§8.2): the Tuning only once active (its fallback speaks before), variant lines first. */
  private lobbyLines(slot: SlotId): { faction: FactionId; quote: string }[] {
    const w = this.world;
    const def = DISTRICTS[w.districts.kinds[slot]];
    if (!def) return [];
    const v = w.variantOf(slot);
    const vq = v > 0 ? def.variants[v - 1]?.quote : undefined;
    const out: { faction: FactionId; quote: string }[] = [];
    for (const f0 of def.lobby) {
      const f = f0 === 'tuning' && !w.story.flags.tuningActive ? def.lobbyFallback : f0;
      if (!f || out.some((o) => o.faction === f)) continue;
      const quote = vq?.[f] ?? def.quote[f] ?? '';
      out.push({ faction: f, quote });
    }
    return out;
  }

  /** What annexing this candidate does to the factions (§8.2), as the choice summary shows it. */
  annexReactions(slot: SlotId, lease?: 'nacre' | 'basalt'): { f: FactionId; v: number }[] {
    const w = this.world;
    const d = w.districts;
    const kind = d.kinds[slot];
    const repeat = d.owned.some((s) => d.kinds[s] === kind);
    const ownedKinds = new Set(d.owned.map((s) => d.kinds[s]));
    const lobbyOf = (k: DistrictKind): FactionId[] => {
      const def = DISTRICTS[k];
      if (!def) return [];
      return def.lobby.flatMap((f) => (f === 'tuning' && !w.story.flags.tuningActive ? (def.lobbyFallback ? [def.lobbyFallback] : []) : [f]));
    };
    const out = new Map<FactionId, number>();
    const add = (f: FactionId, v: number) => out.set(f, (out.get(f) ?? 0) + v);
    const mine = new Set(lobbyOf(kind));
    for (const f of mine) add(f, repeat ? ANNEX.repeatLobbyFavor : ANNEX.lobbyFavor);
    const hit = new Set<FactionId>();
    for (const s of adjacentLocked(w)) {
      if (s === slot) continue;
      const k = d.kinds[s];
      const def = DISTRICTS[k];
      if (k === kind || ownedKinds.has(k) || (def?.opensWhen && !evalCond(w, def.opensWhen))) continue;
      for (const f of lobbyOf(k)) if (!mine.has(f)) hit.add(f);
    }
    for (const f of hit) add(f, repeat ? ANNEX.repeatRivalLobbyFavor : ANNEX.rivalLobbyFavor);
    if (lease && this.needsLease(slot)) {
      add(lease, ANNEX.leaseFavor);
      add(lease === 'nacre' ? 'basalt' : 'nacre', ANNEX.leaseRivalFavor);
    }
    return [...out].map(([f, v]) => ({ f, v }));
  }

  /** Regional links on the city's border with this slot: annexing turns them into city streets (§3.5). */
  linksOnBorder(slot: SlotId): number {
    const w = this.world;
    const r = slotRect(w, slot);
    let n = 0;
    for (let y = r.y0 - 1; y <= r.y1 + 1; y++)
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
        const inside = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
        const corner = (x === r.x0 - 1 || x === r.x1 + 1) && (y === r.y0 - 1 || y === r.y1 + 1);
        if (inside || corner || !w.isOwned(x, y)) continue;
        if (regionalLink(w, x, y) > 0) n++;
      }
    return n;
  }

  /** The milestones this city's region counts (§4.5): Electric Tide and Glass Horizon only on a 5×5 region. */
  milestones(): { pop: number; title: string; reward: number; reached: boolean }[] {
    const w = this.world;
    return milestonesFor(w.region).map((m) => ({ pop: m.pop, title: m.title, reward: m.grant, reached: w.milestones.includes(m.pop) }));
  }

  /**
   * Write the city to storage (§3.10): the main save plain and synchronous with the quota rule, then the mirror
   * (plain up to 300 K characters, else a compressed envelope at most every mirrorEverySec, or now with `forceMirror`).
   * Returns false (writing nothing) while saveBlocked (a newer build's save is stored). A main save that still fails
   * after the drops toasts once a session with an Export action.
   */
  save(forceMirror = false): boolean {
    if (this.saveBlocked) return false;
    this.finishDay();
    this.world.story.pace = this.settings.storyPace;
    const data = this.world.serialize();
    return this.writeSave(data, JSON.stringify(data), this.world.region, forceMirror);
  }

  /** The main save and mirror write behind save() and the restore paths (the quota rule and the toast, §3.10). */
  private writeSave(data: SaveData, raw: string, region: number, forceMirror: boolean, loud = false): boolean {
    const low = region === 5 && this.settings.lowerDetail === true;
    const every = low ? LOW_DETAIL.mirrorEverySec : REGION[region as Region]?.mirrorEverySec || REGION[5].mirrorEverySec;
    const r = writeMainSave(raw, data, { mirrorEverySec: every, force: forceMirror });
    this.lastSaveFailed = !r.ok;
    if (!r.ok && (loud || !this.storageFullShown)) {
      this.storageFullShown = true;
      this.toast(STORAGE_FULL_TEXT, 'error', { id: 'export', label: 'Export', sec: 12 });
    }
    return r.ok;
  }

  /** Reload the stored save. Returns false if there is none, it is unreadable or it came from a newer build. */
  load(): boolean {
    const raw = storageGet(SAVE_KEY);
    const data = this.readSave();
    if (!data || raw === null) return false;
    if (isFutureSave(data)) return false;
    try {
      this.world = World.deserialize(data, this.events);
    } catch {
      return false;
    }
    this.keepOldSave(raw, this.world);
    this.attachSystems();
    this.adoptCity();
    this.selected = null;
    this.preview = null;
    this.events.emit('world');
    this.events.emit('stats');
    return true;
  }

  hasSave(): boolean {
    return storageGet(SAVE_KEY) !== null;
  }

  /** True when "New City" left a previous city in the backup slot. */
  hasPreviousSave(): boolean {
    return storageGet(PREV_SAVE_KEY) !== null;
  }

  /**
   * Name, peak population, save time and region of the backup city (for the menu row), or null. Read from an envelope's
   * header without unpacking it (§3.10); a v1–v3 backup shows ×10 numbers and region 3.
   */
  previousSaveInfo(): { cityName: string; maxPopulation: number; savedAt: number; region: number } | null {
    return this.cityInfo(PREV_SAVE_KEY);
  }

  private cityInfo(key: string): { cityName: string; maxPopulation: number; savedAt: number; region: number } | null {
    const h = readHeader(storageGet(key));
    if (!h) return null;
    // A v3 backup counts v3 people: show it in today's units, as loading it would (MEGACITY §4.4).
    const peak = Math.max(0, Math.floor(h.maxPopulation)) * savePopScale({ scale: h.scale || undefined });
    const region = Number.isFinite(h.region) ? h.region : 3;
    return { cityName: h.cityName, maxPopulation: Math.round(peak), savedAt: h.savedAt, region };
  }

  /**
   * The newer city a stale build kept aside in `.future` (§3.10), when this build can read it (an envelope unpacked
   * at boot, a supported version, not itself a future save): the title offers it back ("A newer city was kept: …").
   * Null otherwise, or while it is still the stored main save (the block is in force).
   */
  keptCityInfo(): { cityName: string; maxPopulation: number; savedAt: number; region: number } | null {
    if (this.saveBlocked) return null;
    const plain = readPlain(FUTURE_SAVE_KEY);
    if (!plain) return null;
    let data: SaveData | null = null;
    try {
      data = JSON.parse(plain) as SaveData;
    } catch {
      return null;
    }
    if (!data || !SAVE_VERSIONS_SUPPORTED.includes(Number(data.version)) || isFutureSave(data)) return null;
    return this.cityInfo(FUTURE_SAVE_KEY);
  }

  /**
   * Restore the kept newer city (§3.10): the loadPrevious path from `.future`. The current city goes to `.prev`
   * (unless saveBlocked or untouched), the kept one becomes the city, and `.future` is removed only once the restored
   * city is the stored main save. `replaceWithoutCopy`: the second confirm after a failed copy (keepCopyFailed).
   */
  restoreKept(opts: { replaceWithoutCopy?: boolean } = {}): boolean {
    if (!this.keptCityInfo()) return false;
    const plain = readPlain(FUTURE_SAVE_KEY)!;
    const ok = this.replaceWith(plain, FUTURE_SAVE_KEY, opts);
    if (ok) storageRemove(FUTURE_SAVE_KEY);
    return ok;
  }

  /**
   * Restore the city "New City" replaced. The current city (if it has any progress) takes its place in the backup
   * slot, so the swap can be undone. False when there is no readable backup, or nothing could change: the current city
   * doesn't fit in the backup slot (keepCopyFailed, the Export toast; `replaceWithoutCopy` is the second confirm), or
   * the restored city couldn't be saved (lastSaveFailed, the storage-full toast).
   */
  loadPrevious(opts: { replaceWithoutCopy?: boolean } = {}): boolean {
    const raw = readPlain(PREV_SAVE_KEY);
    if (raw === null) return false;
    return this.replaceWith(raw, PREV_SAVE_KEY, opts);
  }

  /**
   * Swap the current city for a stored one (Restore previous city, the kept city; WP-9's Import and Grow reuse it).
   * Every city stays stored at every step (§3.10):
   * 1. the city being replaced goes to `.prev` first, plain and synchronously (never while saveBlocked: it is a
   *    stand-in; then the stored newer city must be safe in `.future` instead). If it doesn't fit, nothing changes;
   * 2. the restored city is written as the main save before anything in memory changes. If that fails, `.prev` is
   *    put back as it was and nothing changes (the restored text never left its slot);
   * 3. only then does the world swap, and a restored `.prev` slot is emptied when it isn't holding the replaced city.
   * True only when the restored city is the stored main save.
   */
  private replaceWith(raw: string, from: string, opts: { replaceWithoutCopy?: boolean } = {}): boolean {
    let data: SaveData | null = null;
    try {
      data = JSON.parse(raw) as SaveData;
    } catch {
      return false;
    }
    if (!data || isFutureSave(data)) return false;
    let world: World;
    try {
      world = World.deserialize(data, this.events);
    } catch {
      return false;
    }
    const prevBefore = snapshotKey(PREV_SAVE_KEY);
    const backup = this.backupCurrent(opts.replaceWithoutCopy === true);
    if (backup === null) return false;
    // The pace the restored city will save with once adopted (adoptCity, then save()).
    const pace = world.story.pace;
    world.story.pace = pace && paceOf(pace) === pace ? pace : this.settings.storyPace;
    const saved = world.serialize();
    const json = JSON.stringify(saved);
    if (!this.writeSave(saved, json, world.region, true, true)) {
      if (backup === 'prev') restoreKey(prevBefore);
      return false;
    }
    if (from === PREV_SAVE_KEY && backup !== 'prev') storageRemove(PREV_SAVE_KEY);
    this.keepOldSave(raw, world);
    if (this.saveBlocked) {
      // An explicit replacement, like New City, lifts the newer-save block: the newer city is safe in FUTURE_SAVE_KEY.
      this.saveBlocked = false;
      for (let k = this.notices.length - 1; k >= 0; k--) if (this.notices[k].text === FUTURE_SAVE_TEXT) this.notices.splice(k, 1);
    }
    this.world = world;
    this.attachSystems();
    this.adoptCity();
    this.selected = null;
    this.preview = null;
    this.events.emit('world');
    this.events.emit('stats');
    return true;
  }

  /**
   * Keep what a New City / Restore / Import / Grow is about to replace (§3.10). The current city goes into `.prev`,
   * plain and synchronously, unless it is untouched or `withoutCopy` (the player's "Replace without a copy"). While
   * saveBlocked the city in memory is a stand-in and never goes to `.prev`; instead the stored newer city must be in
   * `.future` before SAVE_KEY is written. Returns 'prev' when `.prev` now holds the current city, 'none' when nothing
   * needed keeping, and null when the copy didn't fit (or `.future` holds another city): nothing changed,
   * `keepCopyFailed` names the city and a toast offers Export.
   */
  private backupCurrent(withoutCopy = false): 'prev' | 'none' | null {
    this.keepCopyFailed = null;
    if (withoutCopy) return 'none';
    if (this.saveBlocked) {
      const r = keepNewerSave();
      if (r === 'kept') return 'none';
      this.refuseReplace(readHeader(storageGet(SAVE_KEY))?.cityName || 'the newer city', r);
      return null;
    }
    if (!worthKeeping(this.world)) return 'none';
    this.finishDay();
    if (writePrev(JSON.stringify(this.world.serialize()))) return 'prev';
    this.refuseReplace(this.world.cityName, 'full');
    return null;
  }

  /** A replacement that couldn't keep a copy (§3.10): nothing changed; name the city and offer Export. */
  private refuseReplace(name: string, why: 'full' | 'taken'): void {
    this.keepCopyFailed = name;
    const reason = why === 'full' ? 'storage is full' : 'another city is already kept aside';
    this.toast(`Couldn't keep a copy of ${name}: ${reason}. Export it first.`, 'error', { id: 'export', label: 'Export', sec: 12 });
  }

  /** Serialize current state (also used by the artifact hot-reload snapshot). */
  snapshot(): SaveData {
    this.finishDay();
    return this.world.serialize();
  }

  /** Replace the world from save data (e.g. hot-reload). */
  restore(data: SaveData): boolean {
    try {
      this.world = World.deserialize(data, this.events);
    } catch {
      return false;
    }
    this.attachSystems();
    this.adoptCity();
    this.events.emit('world');
    this.events.emit('stats');
    return true;
  }

  /**
   * Load the stored city at startup with the save-safety rules (EXPANSION §2.5, MEGACITY §3.10): a newer
   * build's save (plain, or an envelope whose header says so) is copied raw to FUTURE_SAVE_KEY (keepNewerSave)
   * and blocks saving; any other failure, an envelope that boot couldn't unpack included, copies the raw string
   * to UNREADABLE_SAVE_KEY; the first v1 / v2 save is copied to V2_SAVE_KEY, the first v3 to V3_SAVE_KEY.
   * Returns null (start a fresh city) unless the save loaded.
   */
  private loadStored(): World | null {
    this.restoreMirror();
    const stored = storageGet(SAVE_KEY);
    if (stored === null) return null;
    // An envelope boot couldn't unpack has no plain text; its readable header still says whose save it is.
    const raw = readPlain(SAVE_KEY);
    let data: SaveData | null = null;
    if (raw !== null)
      try {
        data = JSON.parse(raw) as SaveData;
      } catch {
        data = null;
      }
    if (raw === null ? isFutureHeader(readHeader(stored)) : isFutureSave(data)) {
      // A raw copy in FUTURE_SAVE_KEY (an older copy of the same city is refreshed; another kept city is never
      // overwritten). The block lifts only once it holds the stored save (backupCurrent).
      keepNewerSave();
      this.saveBlocked = true;
      this.notices.push({ text: FUTURE_SAVE_TEXT, kind: 'error' });
      return null;
    }
    try {
      if (!data || raw === null) throw new Error('Unreadable save');
      const world = World.deserialize(data, this.events);
      this.keepOldSave(raw, world);
      return world;
    } catch (err) {
      console.warn('Save could not be loaded, starting fresh', err);
      storageSet(UNREADABLE_SAVE_KEY, stored);
      return null;
    }
  }

  /**
   * An older build (SAVE_VERSION < 3) saved over a city a v3+ build had saved: only v3+ builds write
   * MIRROR_SAVE_KEY, so an older-version main beside a v3+ mirror means the main was overwritten
   * (a pre-expansion tab, or a stale cached page). The mirror goes back into SAVE_KEY and the
   * overwriting save is kept raw in STALE_SAVE_KEY. A plain v1 / v2 save (no mirror yet) loads as before.
   */
  private restoreMirror(): void {
    const raw = storageGet(SAVE_KEY);
    const stored = storageGet(MIRROR_SAVE_KEY);
    if (raw === null || stored === null || raw === stored) return;
    const version = (s: string): number => Number(readHeader(s)?.version);
    const main = version(raw);
    if (!(main < 3) || !(version(stored) >= 3)) return;
    // A compressed mirror (§3.10) was unpacked by readStoredSave at boot; one this session couldn't unpack waits.
    const mirror = readPlain(MIRROR_SAVE_KEY);
    if (mirror === null) return;
    storageSet(STALE_SAVE_KEY, raw);
    if (storageSet(SAVE_KEY, mirror)) this.notices.push({ text: RESTORED_SAVE_TEXT, kind: 'info' });
  }

  /**
   * Backups by source version (§3.10): the first v1 or v2 save this build loads is kept raw in `.v2`, the first v3
   * save in `.v3`; each written once and never overwritten.
   */
  private keepOldSave(raw: string, world: World): void {
    const v = world.loadedVersion;
    if (v <= 2 && storageGet(V2_SAVE_KEY) === null) storageSet(V2_SAVE_KEY, raw);
    else if (v === 3 && storageGet(V3_SAVE_KEY) === null) storageSet(V3_SAVE_KEY, raw);
  }

  private readSave(key = SAVE_KEY): SaveData | null {
    const raw = readPlain(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SaveData;
    } catch {
      return null;
    }
  }

  private readSettings(): Partial<Settings> {
    const raw = storageGet(SETTINGS_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private welcome() {
    this.world.addNews(`Charter granted: ${this.world.cityName} is open for settlers.`, 'good');
    this.world.addNews('Lay roads, zone Hab Blocks near Fab Yards, and power it all up.', 'info');
  }

  // ── Inspect info ──────────────────────────────────────────────────────────
  /**
   * Inspect on a locked tile (§3.4): the district preview (name, tagline, perks, hazards, lobbyists; the sheet's action
   * is "Open City map", inspectActions 'map'), or only its name and "Still flooded: opens later" while its `opensWhen`
   * doesn't hold (no reason given).
   */
  private lockedInfo(x: number, y: number): TileInfo {
    const w = this.world;
    const s = w.slotAt(x, y);
    const def = DISTRICTS[w.districts.kinds[s]];
    const v = w.variantOf(s);
    const vd = v > 0 ? def?.variants[v - 1] : undefined;
    const name = vd?.name ?? def?.name ?? 'Unclaimed district';
    const color = vd?.accent ?? def?.color ?? '#7f8aa8';
    if (def?.opensWhen && !evalCond(w, def.opensWhen)) return { title: name, subtitle: 'Still flooded: opens later', color, rows: [] };
    const tagline = vd?.tagline ?? def?.tagline;
    const notes: NonNullable<TileInfo['notes']> = [];
    if (tagline) notes.push({ text: tagline });
    for (const p of def?.perks ?? []) notes.push({ text: `+ ${p}`, tone: 'good' });
    for (const h of def?.hazards ?? []) notes.push({ text: `! ${h}`, tone: 'warn' });
    for (const l of this.lobbyLines(s)) if (l.quote) notes.push({ text: `${FACTION_LABELS[l.faction].short}: "${l.quote}"` });
    const adjacent = adjacentLocked(w).includes(s);
    return { title: name, subtitle: adjacent ? 'Not annexed yet' : 'Not next to the city yet', color, rows: [], ...(notes.length ? { notes } : {}) };
  }

  /** Zone tile forms by zone and level (§4.6: the subtitle names the form; the kit's own form names are WP-4's art). */
  private static readonly FORMS: Record<number, readonly string[]> = {
    [ZoneType.Residential]: ['Empty lot', 'Walk-up', 'Mid-rise', 'Point tower'],
    [ZoneType.Commercial]: ['Empty lot', 'Corner shop', 'Shop block', 'Office tower'],
    [ZoneType.Industrial]: ['Empty lot', 'Workshop', 'Works', 'Factory'],
  };

  /** Floors of a body from its top (§4.6: max(1, round(top / 6.5)), heights.ts, the art's own number). */
  private floorsAt(x: number, y: number): number {
    return Math.max(1, Math.round(heightOf(this.world, x, y) / 6.5));
  }

  /** District rows and notes every owned tile can carry (§7.5): the district, terraces, ground, floodplain. */
  private districtNotes(x: number, y: number, rows: [string, string][], notes: NonNullable<TileInfo['notes']>): void {
    const w = this.world;
    const t = w.tiles[y * w.N + x];
    const s = w.slotAt(x, y);
    if (w.districts.owned.length > 1) rows.push(['District', districtShort(w, s)]);
    const mods = DISTRICTS[w.districts.kinds[s]]?.mods;
    if (t.terrain !== Terrain.Land || !mods) return;
    if (mods.lvPerElev && t.elev > 0) notes.push({ text: `Terrace ${t.elev}: views +${Math.round(mods.lvPerElev * t.elev * 1000) / 10}%`, tone: 'good' });
    if (t.ground === Ground.Brownfield && mods.brownfield) notes.push({ text: 'Brownfield: smog until the soil clears', tone: 'warn' });
    if (t.ground === Ground.Reed && isWildReed(w, y * w.N + x)) notes.push({ text: 'Reedbed: a free park while unbuilt', tone: 'good' });
    if (isFloodplain(w, x, y) && !(w.fields.resilience[y * w.N + x] > 0)) notes.push({ text: 'Floodplain: level 2 at most without a Floodwatch', tone: 'warn' });
  }

  /**
   * Inspect rows for tile (x, y) (EXPANSION §7.4: standard rows ≤ 12-character values, long
   * lines as `notes`). `sky` = the player tapped the skyway deck over the tile: the skyway sheet.
   */
  getTileInfo(x: number, y: number, sky = false): TileInfo | null {
    const w = this.world;
    const t = w.tileAt(x, y);
    if (!t) return null;
    // A locked district (MEGACITY §3.4): nothing is built or simulated there, so no lot rows.
    if (!w.isOwned(x, y)) return this.lockedInfo(x, y);
    const i = w.idx(x, y);
    const f = w.fields;
    if (sky && w.sky[i] !== 0) return this.skywayInfo(x, y);
    const common: [string, string][] = [
      ['Land value', pct(f.landValue[i])],
      ['Crime', pct(f.crime[i])],
      ['Pollution', pct(f.pollution[i])],
    ];
    const notes: NonNullable<TileInfo['notes']> = [];
    let meter: TileInfo['meter'];
    let info: TileInfo;
    if (t.buildingId >= 0) {
      const b = w.buildings.get(t.buildingId)!;
      const def = BUILDINGS[b.type];
      const s = buildingStats(b);
      const rows: [string, string][] = [];
      if (def.powerSupply) rows.push(['Output', b.offline > 0 ? 'OFFLINE' : `${s.powerSupply} MW`]);
      // Under construction it draws nothing yet (buildingStats zeroes it), so "NO POWER" would be a false alarm.
      else if ((b.buildDays ?? 0) > 0 || (b.waitSec ?? 0) > 0) rows.push(['Power', '—']);
      else rows.push(['Power', b.powered ? 'Online' : 'NO POWER']);
      if (b.type === 'stack') rows.push(['Stage', this.stageLabel(b)]);
      if (s.effect) rows.push(['Radius', `${s.radius} tiles`]);
      const jobs = s.jobsCom + s.jobsInd;
      // Head counts in ×10 units read grouped ("30,000", MEGACITY §4.6).
      if (jobs || def.jobs) rows.push(['Jobs', num(jobs)]);
      if (s.residents || def.residents) rows.push(['Residents', num(s.residents)]);
      rows.push(['Upkeep', `${s.upkeep} ${CURRENCY}/mo`]);
      if (b.offline > 0) rows.push(['Status', `Offline ${b.offline}d`]);
      this.portRows(b, rows, notes);
      info = { title: def.name, subtitle: def.desc, color: def.color, rows };
      this.megacityBuilding(b, info, notes);
    } else if (t.road) {
      info = this.roadInfo(x, y, notes);
    } else if (zoneDefFor(t.zone)) {
      const zd = zoneDefFor(t.zone)!;
      const levelName = ['Empty lot', 'Low density', 'Mid density', 'High density'][t.level];
      const wi = wealthInfo(w, x, y);
      const cap = zoneCapacity(t.zone, t.level, t.level > 0 ? t.wealth : 0, wi.affordable);
      const access = w.hasRoadAccess(x, y);
      const highwayOnly = !access && highwayNear(w, x, y);
      const arrow = wi.dir > 0 ? ' ▲' : wi.dir < 0 ? ' ▼' : '';
      const rows: [string, string][] = [
        ['Status', t.abandoned ? 'ABANDONED' : levelName],
        ['Wealth', wi.lot ? `opens ${TIER_LABEL[wi.potential]}` : `${TIER_LABEL[wi.tier]}${arrow} ${pct(wi.score)}`],
        [t.zone === ZoneType.Residential ? 'Residents' : 'Jobs', t.abandoned ? '0' : num(cap)],
        ['Power', t.level === 0 ? '—' : t.powered ? 'Online' : 'NO POWER'],
        ['Road access', access ? 'Yes' : highwayOnly ? 'none' : 'NO ROAD'],
        ...common,
      ];
      if (!wi.lot) meter = { row: 1, ticks: [...wi.ticks] };
      if (f.noise[i] > 0.02) rows.push(['Noise', pct(f.noise[i])]);
      if (f.education[i] > 0.02) rows.push(['Education', pct(f.education[i])]);
      if (wi.next) notes.push({ text: `Next: ${wi.next}`, ...(wi.next.startsWith('Rising') || wi.next.startsWith('Opens') ? { tone: 'good' as const } : {}) });
      if (wi.lifted) notes.push({ text: `Lifted by: ${wi.lifted}`, tone: 'good' });
      if (wi.affordable) notes.push({ text: 'Affordable quarter: +10% residents', tone: 'good' });
      if (highwayOnly) notes.push({ text: 'Highway only: lots need a street or avenue', tone: 'warn' });
      // Megacity (§4.6, §7.5): the form and floors, homes, the parcel's sum, ruins.
      let subtitle = zd.desc;
      if (t.level > 0 && !t.abandoned) {
        subtitle = `${Game.FORMS[t.zone]?.[t.level] ?? zd.name} · ${this.floorsAt(x, y)} floors`;
        if (t.zone === ZoneType.Residential) rows.splice(3, 0, ['Homes', num(cap / 2.4)]);
        const p = parcelAt(w, x, y);
        if (p) {
          let heads = 0;
          for (let py = p.y; py < p.y + p.h; py++)
            for (let px = p.x; px < p.x + p.w; px++) {
              const m = w.tiles[py * w.N + px];
              if (m.zone !== ZoneType.None && m.level > 0 && !m.abandoned) heads += zoneCapacity(m.zone, m.level, m.wealth, wealthInfo(w, px, py).affordable);
            }
          notes.push({ text: `Part of a ${p.w}×${p.h} tower: ${num(heads)} ${t.zone === ZoneType.Residential ? 'residents' : 'jobs'}` });
        }
      }
      this.districtNotes(x, y, rows, notes);
      const lobby = this.lobbyNote(x, y);
      if (lobby) notes.push({ text: lobby, tone: 'good' });
      let title = zd.name;
      if (isRuin(t)) {
        title = 'Ruin';
        notes.push({ text: 'Comes back as homes with a road and power', tone: 'good' });
        const pay = DISTRICTS[w.kindAt(x, y)]?.mods.restorePay;
        if (pay) notes.push({ text: `Restoring it pays ${pay} ${CURRENCY}`, tone: 'good' });
      }
      info = { title, subtitle, color: zd.color, rows };
    } else if (t.terrain === Terrain.Water) {
      info = { title: 'Bay water', subtitle: 'Black water. Roads can bridge it.', color: '#1b6c8a', rows: [['Pollution', pct(f.pollution[i])]] };
    } else {
      const rows = [...common];
      this.districtNotes(x, y, rows, notes);
      const ruble = t.ground === Ground.Rubble;
      info = { title: ruble ? 'Rubble lot' : 'Open ground', subtitle: 'Unclaimed lot, ready to build.', color: '#6b6f8f', rows };
    }
    if (w.sky[i] !== 0) notes.push({ text: 'Skyway overhead: tap the deck' });
    this.storyRows(x, y, info.rows);
    if (notes.length) info.notes = notes;
    if (meter) info.meter = meter;
    return info;
  }

  /** A ground road tile: its kind, bridge, ramps and regional-link notes (EXPANSION §7.4). */
  private roadInfo(x: number, y: number, notes: NonNullable<TileInfo['notes']>): TileInfo {
    const w = this.world;
    const i = w.idx(x, y);
    const t = w.tiles[i];
    const f = w.fields;
    const k = t.roadKind;
    const def = roadDef(k);
    const water = t.terrain === Terrain.Water;
    const rows: [string, string][] = [['Traffic', pct(f.traffic[i])]];
    if (k === RoadKind.Street || k === RoadKind.Avenue) rows.push(['Pollution', pct(f.pollution[i])]);
    else if (k === RoadKind.Highway) {
      const ramps = highwayRamps(w, i);
      rows.push(['Noise', pct(f.noise[i])], ['Ramps', `${ramps}`]);
      if (ramps === 0) notes.push({ text: 'No on-ramps: nothing can use it', tone: 'warn' });
    } else if (k === RoadKind.Alley) {
      rows.push(['Crime', pct(f.crime[i])]);
      notes.push({ text: 'Homes beside it stay affordable' });
    }
    const link = regionalLink(w, x, y);
    if (link > 0) notes.push({ text: `Regional link: +${link} trade`, tone: 'good' });
    return {
      title: water ? `${def.name} bridge` : def.name,
      subtitle: water ? 'A road on piers over the water.' : ROAD_SUBTITLE[k],
      color: k === RoadKind.Street ? '#9aa4c7' : def.color,
      rows,
    };
  }

  /** The skyway sheet (a tap on the deck, Selection.sky): load, ramps, docks and its warnings. */
  private skywayInfo(x: number, y: number): TileInfo {
    const w = this.world;
    const i = w.idx(x, y);
    const net = skywayNetwork(w, i);
    const notes: NonNullable<TileInfo['notes']> = [];
    if (net.ramps === 0 && net.docks === 0) notes.push({ text: 'Lands nowhere: add a ramp or dock', tone: 'warn' });
    if ((w.sky[i] & SKY_RAMP) !== 0 && !skyRampGround(w.tiles[i])) notes.push({ text: 'Ramp closed: needs a street below', tone: 'warn' });
    const info: TileInfo = {
      title: 'Skyway',
      subtitle: 'A raised road. Ramps land on streets; docks join megastructures.',
      color: SKYWAY.color,
      rows: [
        ['Load', pct(w.fields.skyTraffic[i])],
        ['Ramps', `${net.ramps}`],
        ['Docks', `${net.docks}`],
      ],
    };
    if (notes.length) info.notes = notes;
    return info;
  }

  /** Seaport, Airport, Spaceport and Academy rows and notes (EXPANSION §7.4). */
  private portRows(b: Building, rows: [string, string][], notes: NonNullable<TileInfo['notes']>): void {
    const ports = this.sim.ports;
    const noise = BUILDINGS[b.type].noise;
    if (b.type === 'seaport') {
      rows.push(['Trade', `+${num(ports.tradeFor(b.id))}/mo`], ['Exports', `+${num(SEAPORT.exportJobs)} jobs`]);
      if (noise) rows.push(['Noise', `${noise.r} tiles`]);
    } else if (b.type === 'airport') {
      rows.push(['Visitors', `${num(ports.visitors)}/mo`], ['Business', `+${num(AIRPORT.comJobs)} jobs`]);
      if (noise) rows.push(['Noise', `${noise.r} tiles`]);
      notes.push({ text: 'Shops 8-16 tiles out do better business' });
    } else if (b.type === 'spaceport') {
      const st = this.launchStatus(b.id)!;
      if (!st.complete) {
        rows.unshift(['Building', pct(st.progress)]);
        notes.push({ text: 'Takes 240 days and at least 4 minutes of play.' });
      } else {
        let next: string;
        if (st.lead !== null) next = `${Math.ceil(st.lead)} s`;
        else if (!st.active) next = 'On hold';
        else if (st.gapLeft > 0) next = `${Math.max(1, Math.ceil(st.gapLeft / 60))} min`;
        else next = 'Tonight';
        rows.unshift(['Next launch', next]);
        rows.push(['Visitors', `${num(ports.visitors)}/mo`]);
      }
      if (noise) rows.push(['Noise', `${noise.r} tiles`]);
      const holder = this.world.story.flags.launchRights;
      rows.push(['Rights', typeof holder === 'string' ? (RIGHTS_LABEL[holder] ?? 'Open') : 'Open']);
    } else if (b.type === 'academy') {
      notes.push({ text: 'Lifts nearby blocks toward $$ and $$$' });
    }
  }

  /** "Plinth · building 34d", "Hab Core", "Glare Crown" (§8.8). */
  private stageLabel(b: { stage?: 1 | 2 | 3; buildDays?: number; crown?: CrownId }): string {
    const stage = b.stage ?? 1;
    const name = vertical.stageName(stage, b.crown);
    return (b.buildDays ?? 0) > 0 ? `${name} · building ${b.buildDays}d` : name;
  }

  /** Turf, ribbon and skybridge rows for the inspect panel (§8.8). */
  private storyRows(x: number, y: number, rows: [string, string][]): void {
    const w = this.world;
    const i = w.idx(x, y);
    const g = turf.ownerAt(w, x, y);
    if (g) {
      const contested = w.turf.contested[i] > 0 ? ' · contested' : '';
      rows.push(['Turf', `${FACTION_LABELS[g].short} ${w.turf.str[i]}%${contested}`]);
    }
    if (w.rail[i]) {
      const net = vertical.railNetworkAt(w, x, y);
      let v: string;
      if (w.vertical.railLive[i]) v = `live · ${net?.stations ?? 0} stations`;
      else if (net?.out) v = 'dead: line cut';
      else v = `dead: needs ${RIBBON.minStations} powered stations`;
      rows.push(['Ribbon Rail', v]);
    }
    const key = vertical.anchorKey(w, x, y);
    const links = vertical.linksOnAnchor(w, key);
    const a = vertical.anchorAt(w, x, y);
    if (links > 0 || a) rows.push(['Skybridges', `${links}/${a?.limit ?? SKYBRIDGE.maxPerAnchor}`]);
  }

  /** The Sky Lobby an anchor at (x, y) belongs to (§5.5), for the anchor's inspect note. */
  private lobbyNote(x: number, y: number): string | null {
    const w = this.world;
    const a = vertical.anchorAt(w, x, y);
    if (!a) return null;
    for (const l of w.vertical.lobbies) {
      if (!l.anchors.includes(a.i)) continue;
      // §5.5's note, as the tube's inspect words it: "Part of Sky Lobby Glass Steps: +3,000 visitors a month".
      return `Part of Sky Lobby ${vertical.lobbyName(w, l.anchors[0])}: +${num(l.visitors)} visitors a month`;
    }
    return null;
  }

  /** Megacity building rows and notes (§6.2, §6.3, §7.5, §9.2): sponsor, looks, floors, frames, pumps, landmarks. */
  private megacityBuilding(b: Building, info: TileInfo, notes: NonNullable<TileInfo['notes']>): void {
    const w = this.world;
    const def = BUILDINGS[b.type];
    if (vertical.isTallBuilding(b)) info.subtitle = `${def.name} · ${this.floorsAt(b.x, b.y)} floors`;
    if (b.type === 'spire') {
      const sp = b.sponsor ?? 'nacre';
      info.rows.push(['Sponsor', sp === 'none' ? 'Independent' : sp === 'basalt' ? 'Basalt' : 'Nacre']);
      info.rows.push(['Look', SPIRE_LOOKS[sp][b.look ?? 0] ?? SPIRE_LOOKS[sp][0]]);
    } else if (b.type === 'stack' && b.crown && (b.stage ?? 1) >= 3) {
      info.rows.push(['Look', CROWN_LOOK_NAMES[b.crown]?.[b.look ?? 0] ?? 'Classic']);
    } else if (b.type === 'frame') {
      info.title = 'Unfinished frame';
      info.subtitle = 'Finish it as a Stratablock with its Plinth done.';
      info.rows = [];
    } else if (b.type === 'pumphall') {
      info.title = 'Old pump hall';
      info.subtitle = 'A dark hall on the water.';
      info.rows = [];
    } else if (b.type === 'pumphouse') {
      info.rows.push(['Reclaim', (b.reclaim ?? 0) > 0 ? `${pumpRings(b)}/3 rings` : 'Pump garden']);
    } else if (b.type === 'floodwatch') {
      notes.push({ text: 'Stops king tides and the floodplain limit nearby', tone: 'good' });
    } else if (b.type === 'halolookout') {
      const inLobby = !!this.lobbyNote(b.x, b.y);
      notes.push({ text: 'Works only while bridged into a Sky Lobby', ...(inLobby ? {} : { tone: 'warn' as const }) });
    }
    const end = def.gate?.ending;
    if (end) {
      notes.push({ text: `Built under ${ENDING_NAMES[end]}` });
      if (w.story.ending !== end) notes.push({ text: 'Dormant: its ending is not current', tone: 'warn' });
    }
    const lobby = this.lobbyNote(b.x, b.y);
    if (lobby && b.type !== 'halolookout') notes.push({ text: lobby, tone: 'good' });
  }

  /** Short label + cost for a tool (for UI buttons). Base price, no modifiers. */
  static toolCost(tool: ToolId): number {
    if (isBuildingTool(tool)) return BUILDINGS[tool].cost;
    if (tool === 'res' || tool === 'com' || tool === 'ind') return ZONES[tool].cost;
    // Skybridges v2 (MEGACITY §5.3): the shortest bridge, 1,200 + 250 for its one gap tile.
    if (tool === 'skybridge') return vertical.bridgeCost(SKYBRIDGE.v2.minGap);
    if (tool === 'rail') return RIBBON.perTile;
    // Road kinds: one land tile of the kind (Street 15, Back Alley 6, Avenue 40, Highway 90).
    if (isRoadTool(tool)) return roadDef(ROAD_TOOL_KIND[tool]).cost;
    if (tool === 'skyway') return SKYWAY.perTile;
    if (tool === 'bulldoze') return BULLDOZE_COST;
    return 0;
  }

  /**
   * Current price of a tool with every modifier: buildings use buildCostMul ×
   * costMul[type] × the next credit × the Stratablock 1.15ⁿ scaling; zones, the
   * shortest skybridge, one rail, road or skyway tile and the cheapest bulldoze use
   * buildCostMul (as planAction prices them).
   */
  toolCost(tool: ToolId): number {
    if (isBuildingTool(tool)) return buildingCost(this.world, tool);
    const base = Game.toolCost(tool);
    if (base > 0) return Math.round(base * this.world.mods.buildCostMul);
    return base;
  }
}

/** Is a Highway within ROAD_ACCESS_RANGE (3) of (x, y)? (The "highway only" inspect note.) */
function highwayNear(world: World, x: number, y: number): boolean {
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const t = world.tileAt(x + dx, y + dy);
      if (t && t.road && t.roadKind === RoadKind.Highway) return true;
    }
  return false;
}

/** On-ramps joined to the highway network through tile `i` (4-neighbour Highway tiles; distinct Ramp tiles). */
function highwayRamps(world: World, i: number): number {
  const N = world.N;
  const tiles = world.tiles;
  const seen = new Set<number>([i]);
  const ramps = new Set<number>();
  const queue = [i];
  while (queue.length) {
    const j = queue.pop()!;
    const x = j % N;
    const y = (j / N) | 0;
    for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = ny * N + nx;
      const t = tiles[n];
      if (!t.road) continue;
      if (t.roadKind === RoadKind.Ramp) ramps.add(n);
      else if (t.roadKind === RoadKind.Highway && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return ramps.size;
}

/**
 * Regional link points of a boundary road (EXPANSION §3.10, MEGACITY §3.5): on owned land whose outward 4-neighbour
 * is off the map or in a locked slot, with its inward neighbour (opposite that one; any of them at a corner) a road it
 * links to. Street 1, Avenue 2, Highway 3; 0 otherwise. The same rule as SimGrid's edge points.
 */
function regionalLink(world: World, x: number, y: number): number {
  const t = world.tileAt(x, y);
  if (!t || !t.road || t.terrain !== Terrain.Land || !world.isOwned(x, y)) return 0;
  const inward: [number, number][] = [];
  if (!world.isOwned(x - 1, y)) inward.push([x + 1, y]);
  if (!world.isOwned(x + 1, y)) inward.push([x - 1, y]);
  if (!world.isOwned(x, y - 1)) inward.push([x, y + 1]);
  if (!world.isOwned(x, y + 1)) inward.push([x, y - 1]);
  if (!inward.some(([ix, iy]) => {
    const n = world.tileAt(ix, iy);
    return !!n && n.road && roadLinks(t.roadKind, n.roadKind);
  })) return 0;
  return t.roadKind === RoadKind.Street ? EDGE_LINKS.street : t.roadKind === RoadKind.Avenue ? EDGE_LINKS.avenue : t.roadKind === RoadKind.Highway ? EDGE_LINKS.highway : 0;
}

/**
 * Remove one skybridge by id (World has no single-link mutator, only removeLinksAt): the other links on its first
 * anchor tile are put back with their ids, so every change goes through World's own events.
 */
function removeLink(world: World, id: number): void {
  const l = world.links.find((k) => k.id === id);
  if (!l) return;
  const keep = world.links.filter((k) => k.id !== id && ((k.ax === l.ax && k.ay === l.ay) || (k.bx === l.ax && k.by === l.ay)));
  world.removeLinksAt(l.ax, l.ay);
  for (const k of keep) world.addLink({ id: k.id, ax: k.ax, ay: k.ay, bx: k.bx, by: k.by });
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

const NAME_A = ['New', 'Neo', 'Port', 'Lower', 'Upper', 'East', 'West', 'Old'];
const NAME_B = ['Lanthorn', 'Meridian', 'Halcyon', 'Umbral', 'Cobalt', 'Sable', 'Ionia', 'Helix', 'Obsidian', 'Lumen', 'Kestrel', 'Tessellate'];
const NAME_C = ['Bay', 'Shoals', 'Heights', 'Harbor', 'Grid', 'Reach', 'Basin', 'Point', 'Verge', 'Arc'];

export function randomCityName(seed: number): string {
  const a = NAME_A[seed % NAME_A.length];
  const b = NAME_B[Math.floor(seed / 7) % NAME_B.length];
  const c = NAME_C[Math.floor(seed / 97) % NAME_C.length];
  return `${a} ${b} ${c}`;
}
