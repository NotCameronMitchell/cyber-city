import {
  applyAction,
  buildingCost,
  crackdown,
  crackdownStatus,
  crownOptions,
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
  SAVE_KEY,
  SAVE_VERSION,
  SAVE_VERSIONS_SUPPORTED,
  SEAPORT,
  SETTINGS_KEY,
  SKYBRIDGE,
  SKYWAY,
  SPACEPORT,
  SPEED_TICKS_PER_SEC,
  STACK_STAGES,
  ZONES,
  isBuildingTool,
  isZoneTool,
  paceOf,
  zoneDefFor,
} from './config';
import { Emitter, type GameEventMap, type ToastAction } from './events';
import { ROAD_TOOL_KIND, isRoadTool, roadDef, roadLinks } from './roads';
import { Simulation } from './sim';
import type { PortView } from './sim/ports';
import { SKY_RAMP, skyRampGround } from './skyway';
import { storageGet, storageRemove, storageSet } from './storage';
import { storyContent } from './story/conditions';
import { StoryDirector } from './story/director';
import * as turf from './story/turf';
import type { ActionResult, CrownId, EndingId, FactionId, GangId, InspectAction } from './story/types';
import * as vertical from './story/vertical';
import {
  MAP_SIZE,
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

/** Backup slot: "New City" moves the city it replaces here, so the menu can offer "Restore previous city". */
export const PREV_SAVE_KEY = `${SAVE_KEY}.prev`;

// ── Save safety (docs/EXPANSION.md §2.5) ─────────────────────────────────────
/** Raw copy of a save written by a newer build (written once, if empty). While it is the stored save, autosave is blocked. */
export const FUTURE_SAVE_KEY = `${SAVE_KEY}.future`;
/** Raw copy of a stored save that failed to load for any other reason, taken before the fresh city starts. */
export const UNREADABLE_SAVE_KEY = `${SAVE_KEY}.unreadable`;
/** Raw copy of the first v1 / v2 save loaded by a v3 build (once; never overwritten), so a downgrade can recover it. */
export const V2_SAVE_KEY = `${SAVE_KEY}.v2`;
/**
 * Mirror of the last save a v3+ build wrote (same string as SAVE_KEY). A pre-expansion build cannot read a
 * v3 save, starts a fresh city and autosaves it over SAVE_KEY; it never touches this key, so the next v3+
 * load finds an older-version main next to a v3+ mirror and restores the mirror (Step 7, §2.5).
 */
export const MIRROR_SAVE_KEY = `${SAVE_KEY}.mirror`;
/** Raw copy of the older-version save that replaced the city, kept when the mirror is restored. */
export const STALE_SAVE_KEY = `${SAVE_KEY}.stale`;
/** Shown once when the stored city came from a newer build. */
export const FUTURE_SAVE_TEXT = 'This city was saved by a newer version. Reload to update.';
/** Shown once when an older version had saved over the city and the mirror brought it back. */
export const RESTORED_SAVE_TEXT = 'An older version saved over your city. It is back as you left it.';

/** Visual clock rate by speed (index 0..3): frozen while paused, ×1 / ×1.6 / ×2.4 (EXPANSION §1.3, §2.7). */
const CLOCK_RATE = [0, 1, 1.6, 2.4] as const;

/** Safe localStorage wrappers (storage may be missing or throw); they live in a leaf module so story code can share them. */
export { storageGet, storageRemove, storageSet } from './storage';

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
  private notices: { text: string; kind: 'info' | 'error' | 'good' }[] = [];
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

  constructor() {
    const stored = this.readSettings();
    // Older stored settings have no storyPace (or an unknown one): they read as 'relaxed'.
    this.settings = { ...DEFAULT_SETTINGS, ...stored, storyPace: paceOf(stored.storyPace) };
    const world = this.loadStored();
    this.world = world ?? World.generate(randomSeed(), undefined, this.events);
    this.attachSystems();
    if (!world) this.welcome();
  }

  // ── Tool / mode state ─────────────────────────────────────────────────────
  setTool(tool: ToolId) {
    if (this.tool === tool) return;
    this.tool = tool;
    this.preview = null;
    this.pendingConfirm = null;
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
    // Refresh demand + budget projection now, so it moves even while paused.
    this.sim.recomputeAll();
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
    this.sim = sim;
    this.storyResumeSpeed = null;
    // Session-only expansion state belongs to the world it was made in (EXPANSION §7.7, §5.3).
    this.pendingConfirm = null;
    this.undoSnap = null;
    this.placed.clear();
    this.launchClock.clear();
    this.launchBuilding.clear();
    this.lead = null; // a pending launch is dropped with the world
    this.story = new StoryDirector(this);
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
    // Refunded buildings' demolition fees are waived, not charged and credited back.
    const plan = applyAction(w, tool, from, to, refund?.ids.length ? { ...opts, waive: new Set(refund.ids) } : opts);
    if (!plan.valid) {
      if (plan.reason && plan.reason !== 'Nothing to change') this.toast(plan.reason, 'error');
      this.events.emit('sfx', 'error');
      return plan;
    }
    // Any action replaces the one-step undo; only road, skyway and zone drags make a new one.
    this.undoSnap = before ? this.makeUndo(tool, before, plan.cost) : null;
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
    else if (tool === 'skybridge') this.toast('Skybridge built', 'good');
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
    this.sim.recomputeAll();
    if (storyTool(tool)) {
      // Power was just recomputed: re-evaluate links and stations now, not next month.
      vertical.refresh(this.world);
      this.story.markDirty();
    }
    this.events.emit('stats');
    return plan;
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
    for (const t of u.tiles) w.restoreTile(t.before.i, t.before);
    w.funds += u.spent;
    this.cancelPending(); // a plan waiting for ✓ goes with its ghost
    this.events.emit('sfx', 'click');
    this.toast('Undone', 'info');
    this.sim.recomputeAll();
    if (storyTool(u.tool)) {
      vertical.refresh(w);
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
  /** Advance by real seconds `dt` (clamped). Runs whole sim ticks according to speed. */
  update(dt: number) {
    dt = Math.min(Math.max(dt, 0), 0.25);
    if (this.notices.length) {
      const n = this.notices.splice(0);
      for (const t of n) this.toast(t.text, t.kind);
    }
    this.story.update(dt, this.speed === 0);
    this.syncStoryPause();
    if (this.speed > 0) {
      this.clock += dt * this.clockRate;
      this.tickAcc += dt * SPEED_TICKS_PER_SEC[this.speed];
      let steps = 0;
      while (this.tickAcc >= 1 && steps < 8) {
        this.tickAcc -= 1;
        steps++;
        this.sim.step();
        this.story.onDay();
        if (this.story.blocking) {
          this.tickAcc = 0; // a card opened: stop now and drop the backlog
          break;
        }
      }
      if (steps > 0) this.events.emit('stats');
      if (this.tickAcc > 4) this.tickAcc = 0; // drop backlog on slow devices
      this.updateSpaceports(dt);
      this.syncStoryPause();
    }
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
  raiseStage(id: number, crown?: CrownId): ActionResult {
    return this.afterStoryAction(raiseStage(this.world, id, crown), 'build');
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
  inspectActions(x: number, y: number, sky = false): InspectAction[] {
    const w = this.world;
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
    const plan = applyAction(w, 'bulldoze', { x, y }, { x, y });
    if (!plan.valid) {
      if (plan.reason) this.toast(plan.reason, 'error');
      this.events.emit('sfx', 'error');
      return { ok: false, reason: plan.reason ?? 'Nothing to demolish', cost: 0 };
    }
    this.undoSnap = null;
    this.cancelPending();
    this.events.emit('sfx', 'bulldoze');
    if (this.selected?.sky && this.selected.x === x && this.selected.y === y) this.select(null);
    this.sim.recomputeAll();
    vertical.refresh(w);
    this.story.markDirty();
    this.events.emit('stats');
    return { ok: true, cost: plan.cost };
  }

  /** Common follow-up for story actions: feedback, and a refresh when something changed. */
  private afterStoryAction(r: ActionResult, sfx: GameEventMap['sfx'], refreshTurf = false): ActionResult {
    if (!r.ok) {
      if (r.reason) this.toast(r.reason, 'error');
      this.events.emit('sfx', 'error');
      return r;
    }
    // Any other action ends the one-step undo (EXPANSION §7.7).
    this.undoSnap = null;
    this.events.emit('sfx', sfx);
    if (refreshTurf) turf.refreshStats(this.world);
    this.story.markDirty();
    this.sim.recomputeAll();
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
  /** Start a fresh city. The city it replaces is kept in the backup slot (see loadPrevious). */
  newCity(name?: string, seed = randomSeed()) {
    this.backupCurrent();
    // An explicit New City is the only thing that lifts the newer-save block (its copy stays in FUTURE_SAVE_KEY);
    // the "saved by a newer version" notice no longer applies.
    this.saveBlocked = false;
    this.notices.length = 0;
    const clean = name?.trim().slice(0, CITY_NAME_MAX);
    this.world = World.generate(seed, clean || randomCityName(seed), this.events);
    this.attachSystems();
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
    this.save();
  }

  /** Write the city to storage. Returns false (writing nothing) while saveBlocked (a newer build's save is stored). */
  save(): boolean {
    if (this.saveBlocked) return false;
    const raw = JSON.stringify(this.world.serialize());
    const ok = storageSet(SAVE_KEY, raw);
    if (ok) storageSet(MIRROR_SAVE_KEY, raw);
    return ok;
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

  /** Name, peak population and save time of the backup city (for the menu row), or null. */
  previousSaveInfo(): { cityName: string; maxPopulation: number; savedAt: number } | null {
    const data = this.readSave(PREV_SAVE_KEY);
    if (!data) return null;
    // A v3 backup counts v3 people: show it in today's units, as loading it would (MEGACITY §4.4).
    const peak = Math.max(0, Math.floor(Number(data.maxPopulation) || 0)) * savePopScale(data);
    return { cityName: String(data.cityName ?? ''), maxPopulation: Math.round(peak), savedAt: Number(data.savedAt) || 0 };
  }

  /**
   * Restore the city "New City" replaced. The current city (if it has any
   * progress) takes its place in the backup slot, so the swap can be undone.
   * Returns false when there is no readable backup.
   */
  loadPrevious(): boolean {
    const raw = storageGet(PREV_SAVE_KEY);
    const data = this.readSave(PREV_SAVE_KEY);
    if (!data || raw === null) return false;
    let world: World;
    try {
      world = World.deserialize(data, this.events);
    } catch {
      return false;
    }
    this.keepOldSave(raw, world);
    const current = worthKeeping(this.world) ? JSON.stringify(this.world.serialize()) : null;
    if (this.saveBlocked) {
      // An explicit replacement, like New City: it lifts the newer-save block (the newer city keeps
      // its copy in FUTURE_SAVE_KEY), so the restored city can be saved.
      const main = storageGet(SAVE_KEY);
      if (main !== null && storageGet(FUTURE_SAVE_KEY) === null) storageSet(FUTURE_SAVE_KEY, main);
      this.saveBlocked = false;
      for (let k = this.notices.length - 1; k >= 0; k--) if (this.notices[k].text === FUTURE_SAVE_TEXT) this.notices.splice(k, 1);
    }
    this.world = world;
    this.attachSystems();
    this.selected = null;
    this.preview = null;
    // Save the restored city first; only then does the backup slot take the city it replaced (or empty).
    // If the save fails the slot keeps the restored city, so a reload loses nothing it held.
    if (this.save() && (current === null || !storageSet(PREV_SAVE_KEY, current))) storageRemove(PREV_SAVE_KEY);
    this.events.emit('world');
    this.events.emit('stats');
    return true;
  }

  /** Copy the current city into the backup slot (skipped for an untouched city). */
  private backupCurrent(): void {
    if (!worthKeeping(this.world)) return;
    storageSet(PREV_SAVE_KEY, JSON.stringify(this.world.serialize()));
  }

  /** Serialize current state (also used by the artifact hot-reload snapshot). */
  snapshot(): SaveData {
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
    this.events.emit('world');
    this.events.emit('stats');
    return true;
  }

  /**
   * Load the stored city at startup with the save-safety rules (EXPANSION §2.5): a newer
   * build's save is copied to FUTURE_SAVE_KEY (if empty) and blocks saving; any other failure
   * copies the raw string to UNREADABLE_SAVE_KEY; the first v1 / v2 save is copied to V2_SAVE_KEY.
   * Returns null (start a fresh city) unless the save loaded.
   */
  private loadStored(): World | null {
    this.restoreMirror();
    const raw = storageGet(SAVE_KEY);
    if (raw === null) return null;
    let data: SaveData | null = null;
    try {
      data = JSON.parse(raw) as SaveData;
    } catch {
      data = null;
    }
    if (isFutureSave(data)) {
      if (storageGet(FUTURE_SAVE_KEY) === null) storageSet(FUTURE_SAVE_KEY, raw);
      this.saveBlocked = true;
      this.notices.push({ text: FUTURE_SAVE_TEXT, kind: 'error' });
      return null;
    }
    try {
      if (!data) throw new Error('Unreadable save');
      const world = World.deserialize(data, this.events);
      this.keepOldSave(raw, world);
      return world;
    } catch (err) {
      console.warn('Save could not be loaded, starting fresh', err);
      storageSet(UNREADABLE_SAVE_KEY, raw);
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
    const mirror = storageGet(MIRROR_SAVE_KEY);
    if (raw === null || mirror === null || raw === mirror) return;
    const version = (s: string): number => {
      try {
        const v = Number((JSON.parse(s) as { version?: unknown } | null)?.version);
        return Number.isFinite(v) ? v : NaN;
      } catch {
        return NaN;
      }
    };
    const main = version(raw);
    if (!(main < 3) || !(version(mirror) >= 3)) return;
    storageSet(STALE_SAVE_KEY, raw);
    if (storageSet(SAVE_KEY, mirror)) this.notices.push({ text: RESTORED_SAVE_TEXT, kind: 'info' });
  }

  /** The first v1 / v2 save a v3 build loads is kept raw in V2_SAVE_KEY (never overwritten). */
  private keepOldSave(raw: string, world: World): void {
    if (world.loadedVersion < SAVE_VERSION && storageGet(V2_SAVE_KEY) === null) storageSet(V2_SAVE_KEY, raw);
  }

  private readSave(key = SAVE_KEY): SaveData | null {
    const raw = storageGet(key);
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
   * Inspect rows for tile (x, y) (EXPANSION §7.4: standard rows ≤ 12-character values, long
   * lines as `notes`). `sky` = the player tapped the skyway deck over the tile: the skyway sheet.
   */
  getTileInfo(x: number, y: number, sky = false): TileInfo | null {
    const w = this.world;
    const t = w.tileAt(x, y);
    if (!t) return null;
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
      info = { title: zd.name, subtitle: zd.desc, color: zd.color, rows };
    } else if (t.terrain === Terrain.Water) {
      info = { title: 'Bay water', subtitle: 'Black water. Roads can bridge it.', color: '#1b6c8a', rows: [['Pollution', pct(f.pollution[i])]] };
    } else {
      info = { title: 'Open ground', subtitle: 'Unclaimed lot, ready to build.', color: '#6b6f8f', rows: common };
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
    if (links > 0 || vertical.isTallAt(w, x, y)) rows.push(['Skybridges', `${links}/${SKYBRIDGE.maxPerAnchor}`]);
  }

  /** Short label + cost for a tool (for UI buttons). Base price, no modifiers. */
  static toolCost(tool: ToolId): number {
    if (isBuildingTool(tool)) return BUILDINGS[tool].cost;
    if (tool === 'res' || tool === 'com' || tool === 'ind') return ZONES[tool].cost;
    if (tool === 'skybridge') return SKYBRIDGE.base + SKYBRIDGE.perTile * SKYBRIDGE.minGap;
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
  const N = MAP_SIZE;
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
 * Regional link points of a border road (EXPANSION §3.10): on land on the map edge, with its
 * inward neighbour (perpendicular to that edge; either one at a corner) a road it links to.
 * Street 1, Avenue 2, Highway 3; 0 otherwise.
 */
function regionalLink(world: World, x: number, y: number): number {
  const N = MAP_SIZE;
  const t = world.tileAt(x, y);
  if (!t || !t.road || t.terrain !== Terrain.Land) return 0;
  const inward: [number, number][] = [];
  if (x === 0) inward.push([1, y]);
  if (x === N - 1) inward.push([N - 2, y]);
  if (y === 0) inward.push([x, 1]);
  if (y === N - 1) inward.push([x, N - 2]);
  if (!inward.some(([ix, iy]) => {
    const n = world.tileAt(ix, iy);
    return !!n && n.road && roadLinks(t.roadKind, n.roadKind);
  })) return 0;
  return t.roadKind === RoadKind.Street ? EDGE_LINKS.street : t.roadKind === RoadKind.Avenue ? EDGE_LINKS.avenue : t.roadKind === RoadKind.Highway ? EDGE_LINKS.highway : 0;
}

/** A save written by a newer build (its version is above every supported one). */
function isFutureSave(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const v = Number((data as { version?: unknown }).version);
  return Number.isFinite(v) && v > Math.max(...SAVE_VERSIONS_SUPPORTED);
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
