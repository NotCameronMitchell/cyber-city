import { applyAction, crackdown, planAction, raiseStage, type Point } from './actions';
import {
  BUILDINGS,
  CURRENCY,
  DAY_CYCLE_SECONDS,
  MAX_TAX,
  MIN_TAX,
  SAVE_KEY,
  SETTINGS_KEY,
  SPEED_TICKS_PER_SEC,
  ZONES,
  isBuildingTool,
  zoneDefFor,
} from './config';
import { Emitter, type GameEventMap } from './events';
import { Simulation } from './sim';
import { StoryDirector } from './story/director';
import type { ActionResult, CrownId, EndingId, FactionId, GangId, InspectAction } from './story/types';
import { Terrain, ZoneType, type ActionPlan, type OverlayId, type SaveData, type Selection, type Settings, type ToolId } from './types';
import { World } from './world';

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: false,
  rain: true,
  dayNight: true,
  quality: 'high',
  showFps: false,
  events: true,
};

/** City names are capped at this many characters (§1.6; lint assumes 24). */
export const CITY_NAME_MAX = 24;

/** Safe localStorage wrappers: storage may be missing or throw (private mode, sandboxed frames). */
export function storageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
export function storageSet(key: string, value: string): boolean {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
export function storageRemove(key: string) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export interface TileInfo {
  title: string;
  subtitle: string;
  color: string;
  rows: [label: string, value: string][];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

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
  private tickAcc = 0;
  /** Speed to restore once a blocking story card closes (null = not paused by the story). */
  private storyResumeSpeed: number | null = null;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...this.readSettings() };
    const saved = this.readSave();
    let world: World | null = null;
    if (saved) {
      try {
        world = World.deserialize(saved, this.events);
      } catch (err) {
        console.warn('Save could not be loaded, starting fresh', err);
      }
    }
    this.world = world ?? World.generate(randomSeed(), undefined, this.events);
    this.attachSystems();
    if (!world) this.welcome();
  }

  // ── Tool / mode state ─────────────────────────────────────────────────────
  setTool(tool: ToolId) {
    if (this.tool === tool) return;
    this.tool = tool;
    this.preview = null;
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
    const same = sel && this.selected && sel.x === this.selected.x && sel.y === this.selected.y;
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
    this.story = new StoryDirector(this);
    sim.recomputeAll();
  }

  updateSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.sim.options.events = this.settings.events;
    storageSet(SETTINGS_KEY, JSON.stringify(this.settings));
    this.events.emit('settings');
  }

  toast(text: string, kind: 'info' | 'error' | 'good' = 'info') {
    this.events.emit('toast', { text, kind });
  }

  // ── Actions (called by input) ─────────────────────────────────────────────
  /** Preview the current tool over a drag from `from` to `to` (tile coords). */
  plan(from: Point, to: Point): ActionPlan {
    return planAction(this.world, this.tool, from, to);
  }

  /** Set (or clear) the live preview the renderer draws. */
  setPreview(plan: ActionPlan | null) {
    this.preview = plan;
  }

  /**
   * Apply the current tool over a gesture. For 'inspect' this selects the tile.
   * Emits sfx / toast / stats events. Returns the executed plan.
   */
  apply(from: Point, to: Point): ActionPlan {
    this.preview = null;
    if (this.tool === 'inspect') {
      this.select(this.world.inBounds(to.x, to.y) ? { x: to.x, y: to.y } : null);
      this.events.emit('sfx', 'click');
      return planAction(this.world, 'inspect', from, to);
    }
    const plan = applyAction(this.world, this.tool, from, to);
    if (!plan.valid) {
      if (plan.reason && plan.reason !== 'Nothing to change') this.toast(plan.reason, 'error');
      this.events.emit('sfx', 'error');
      return plan;
    }
    const kind =
      this.tool === 'bulldoze' ? 'bulldoze' : this.tool === 'road' ? 'road' : isBuildingTool(this.tool) ? 'build' : 'zone';
    this.events.emit('sfx', kind);
    if (isBuildingTool(this.tool)) this.toast(`${BUILDINGS[this.tool].name} built`, 'good');
    this.sim.recomputeAll();
    this.events.emit('stats');
    return plan;
  }

  // ── Frame update ──────────────────────────────────────────────────────────
  /** Advance by real seconds `dt` (clamped). Runs whole sim ticks according to speed. */
  update(dt: number) {
    dt = Math.min(Math.max(dt, 0), 0.25);
    this.story.update(dt, this.speed === 0);
    this.syncStoryPause();
    if (this.speed > 0) {
      this.clock += dt * (this.speed === 1 ? 1 : this.speed === 2 ? 1.6 : 2.4);
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
      this.syncStoryPause();
    }
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
  /** Answer the open story card. */
  choose(i: number) {
    this.story.choose(i);
  }
  openPending() {
    this.story.openPending();
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
  signPact(g: GangId): ActionResult {
    return this.afterStoryAction(this.story.signPact(g), 'money');
  }
  takeDeal(f: FactionId): ActionResult {
    return this.afterStoryAction(this.story.takeDeal(f), 'money');
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
   * Story buttons for the inspect panel at (x, y): crackdown on a precinct,
   * raise / crown on a Stratablock. TODO(WP-C): Step 0 returns none.
   */
  inspectActions(_x: number, _y: number): InspectAction[] {
    return [];
  }

  /** Common follow-up for story actions: feedback, and a refresh when something changed. */
  private afterStoryAction(r: ActionResult, sfx: GameEventMap['sfx']): ActionResult {
    if (!r.ok) {
      if (r.reason) this.toast(r.reason, 'error');
      this.events.emit('sfx', 'error');
      return r;
    }
    this.events.emit('sfx', sfx);
    this.story.markDirty();
    this.sim.recomputeAll();
    this.events.emit('stats');
    return r;
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
  newCity(name?: string, seed = randomSeed()) {
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

  save(): boolean {
    const ok = storageSet(SAVE_KEY, JSON.stringify(this.world.serialize()));
    return ok;
  }

  /** Reload the stored save. Returns false if there is none or it is unreadable. */
  load(): boolean {
    const data = this.readSave();
    if (!data) return false;
    try {
      this.world = World.deserialize(data, this.events);
    } catch {
      return false;
    }
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

  private readSave(): SaveData | null {
    const raw = storageGet(SAVE_KEY);
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
    this.world.addNews('Lay roads, zone Hab Blocks near Fab Districts, and power it all up.', 'info');
  }

  // ── Inspect info ──────────────────────────────────────────────────────────
  getTileInfo(x: number, y: number): TileInfo | null {
    const w = this.world;
    const t = w.tileAt(x, y);
    if (!t) return null;
    const i = w.idx(x, y);
    const f = w.fields;
    const common: [string, string][] = [
      ['Land value', pct(f.landValue[i])],
      ['Crime', pct(f.crime[i])],
      ['Pollution', pct(f.pollution[i])],
    ];
    if (t.buildingId >= 0) {
      const b = w.buildings.get(t.buildingId)!;
      const def = BUILDINGS[b.type];
      const rows: [string, string][] = [];
      if (def.powerSupply) rows.push(['Output', b.offline > 0 ? 'OFFLINE' : `${def.powerSupply} MW`]);
      else rows.push(['Power', b.powered ? 'Online' : 'NO POWER']);
      if (def.effect) rows.push(['Radius', `${def.radius} tiles`]);
      if (def.jobs) rows.push(['Jobs', `${def.jobs}`]);
      if (def.residents) rows.push(['Residents', `${def.residents}`]);
      rows.push(['Upkeep', `${def.upkeep} ${CURRENCY}/mo`]);
      if (b.offline > 0) rows.push(['Status', `Offline ${b.offline}d`]);
      return { title: def.name, subtitle: def.desc, color: def.color, rows };
    }
    if (t.road) {
      return {
        title: t.terrain === Terrain.Water ? 'Bridge' : 'Road',
        subtitle: t.terrain === Terrain.Water ? 'Elevated skyway over the water.' : 'Street grid. Zones within 3 tiles can develop.',
        color: '#9aa4c7',
        rows: [['Traffic', pct(f.traffic[i])], ['Pollution', pct(f.pollution[i])]],
      };
    }
    const zd = zoneDefFor(t.zone);
    if (zd) {
      const levelName = ['Empty lot', 'Low density', 'Mid density', 'High density'][t.level];
      const cap = zd.capacity[t.level];
      const rows: [string, string][] = [
        ['Status', t.abandoned ? 'ABANDONED' : levelName],
        [t.zone === ZoneType.Residential ? 'Residents' : 'Jobs', t.abandoned ? '0' : `${cap}`],
        ['Power', t.level === 0 ? '—' : t.powered ? 'Online' : 'NO POWER'],
        ['Road access', w.hasRoadAccess(x, y) ? 'Yes' : 'NO ROAD'],
        ...common,
      ];
      return { title: zd.name, subtitle: zd.desc, color: zd.color, rows };
    }
    if (t.terrain === Terrain.Water) {
      return { title: 'Bay water', subtitle: 'Black water. Roads can bridge it.', color: '#1b6c8a', rows: [['Pollution', pct(f.pollution[i])]] };
    }
    return { title: 'Open ground', subtitle: 'Unclaimed lot, ready to build.', color: '#6b6f8f', rows: common };
  }

  /** Short label + cost for a tool (for UI buttons). Base price, no modifiers. */
  static toolCost(tool: ToolId): number {
    if (isBuildingTool(tool)) return BUILDINGS[tool].cost;
    if (tool === 'res' || tool === 'com' || tool === 'ind') return ZONES[tool].cost;
    return 0;
  }

  /**
   * Current price of a tool with modifiers (buildCostMul × costMul[type]).
   * TODO(WP-C): credits and the Stratablock 1.15ⁿ scaling; skybridge / rail per-tile prices.
   */
  toolCost(tool: ToolId): number {
    const base = Game.toolCost(tool);
    if (!isBuildingTool(tool)) return base;
    const m = this.world.mods;
    return Math.round(base * m.buildCostMul * (m.costMul[tool] ?? 1));
  }
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
