import {
  applyAction,
  buildingCost,
  crackdown,
  crackdownStatus,
  crownOptions,
  planAction,
  raiseStage,
  stageStatus,
  type Point,
} from './actions';
import { buildingStats } from './buildingStats';
import {
  BUILDINGS,
  BULLDOZE_COST,
  CURRENCY,
  DAY_CYCLE_SECONDS,
  FACTION_LABELS,
  MAX_TAX,
  MIN_TAX,
  RIBBON,
  ROAD_COST,
  SAVE_KEY,
  SETTINGS_KEY,
  SKYBRIDGE,
  SPEED_TICKS_PER_SEC,
  STACK_STAGES,
  ZONES,
  isBuildingTool,
  zoneDefFor,
} from './config';
import { Emitter, type GameEventMap } from './events';
import { Simulation } from './sim';
import { storageGet, storageRemove, storageSet } from './storage';
import { StoryDirector } from './story/director';
import * as turf from './story/turf';
import type { ActionResult, CrownId, EndingId, FactionId, GangId, InspectAction } from './story/types';
import * as vertical from './story/vertical';
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

/** Backup slot: "New City" moves the city it replaces here, so the menu can offer "Restore previous city". */
export const PREV_SAVE_KEY = `${SAVE_KEY}.prev`;

/** Safe localStorage wrappers (storage may be missing or throw); they live in a leaf module so story code can share them. */
export { storageGet, storageRemove, storageSet } from './storage';

export interface TileInfo {
  title: string;
  subtitle: string;
  color: string;
  rows: [label: string, value: string][];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');

/** Tools whose result changes story sources (vertical caches, turf eligibility, build counts). */
const storyTool = (tool: ToolId) => tool === 'bulldoze' || tool === 'skybridge' || tool === 'rail' || isBuildingTool(tool);

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
    const tool = this.tool;
    const kind =
      tool === 'bulldoze'
        ? 'bulldoze'
        : tool === 'road'
          ? 'road'
          : isBuildingTool(tool) || tool === 'skybridge' || tool === 'rail'
            ? 'build'
            : 'zone';
    this.events.emit('sfx', kind);
    if (isBuildingTool(tool)) this.toast(`${BUILDINGS[tool].name} built`, 'good');
    else if (tool === 'skybridge') this.toast('Skybridge built', 'good');
    this.sim.recomputeAll();
    if (storyTool(tool)) {
      // Power was just recomputed: re-evaluate links and stations now, not next month.
      vertical.refresh(this.world);
      this.story.markDirty();
    }
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
  /** Answer the open story card. Choices can move pacts and tiers, so turf layers are re-derived. */
  choose(i: number) {
    this.story.choose(i);
    turf.refreshStats(this.world);
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
  inspectActions(x: number, y: number): InspectAction[] {
    const w = this.world;
    const b = w.buildingAt(x, y);
    if (!b) return [];
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

  /** Common follow-up for story actions: feedback, and a refresh when something changed. */
  private afterStoryAction(r: ActionResult, sfx: GameEventMap['sfx'], refreshTurf = false): ActionResult {
    if (!r.ok) {
      if (r.reason) this.toast(r.reason, 'error');
      this.events.emit('sfx', 'error');
      return r;
    }
    this.events.emit('sfx', sfx);
    if (refreshTurf) turf.refreshStats(this.world);
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
  /** Start a fresh city. The city it replaces is kept in the backup slot (see loadPrevious). */
  newCity(name?: string, seed = randomSeed()) {
    this.backupCurrent();
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

  /** True when "New City" left a previous city in the backup slot. */
  hasPreviousSave(): boolean {
    return storageGet(PREV_SAVE_KEY) !== null;
  }

  /** Name, peak population and save time of the backup city (for the menu row), or null. */
  previousSaveInfo(): { cityName: string; maxPopulation: number; savedAt: number } | null {
    const data = this.readSave(PREV_SAVE_KEY);
    if (!data) return null;
    return { cityName: String(data.cityName ?? ''), maxPopulation: data.maxPopulation | 0, savedAt: Number(data.savedAt) || 0 };
  }

  /**
   * Restore the city "New City" replaced. The current city (if it has any
   * progress) takes its place in the backup slot, so the swap can be undone.
   * Returns false when there is no readable backup.
   */
  loadPrevious(): boolean {
    const data = this.readSave(PREV_SAVE_KEY);
    if (!data) return false;
    let world: World;
    try {
      world = World.deserialize(data, this.events);
    } catch {
      return false;
    }
    const current = worthKeeping(this.world) ? JSON.stringify(this.world.serialize()) : null;
    this.world = world;
    this.attachSystems();
    this.selected = null;
    this.preview = null;
    if (current === null || !storageSet(PREV_SAVE_KEY, current)) storageRemove(PREV_SAVE_KEY);
    this.events.emit('world');
    this.events.emit('stats');
    this.save();
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
    let info: TileInfo;
    if (t.buildingId >= 0) {
      const b = w.buildings.get(t.buildingId)!;
      const def = BUILDINGS[b.type];
      const s = buildingStats(b);
      const rows: [string, string][] = [];
      if (def.powerSupply) rows.push(['Output', b.offline > 0 ? 'OFFLINE' : `${s.powerSupply} MW`]);
      else rows.push(['Power', b.powered ? 'Online' : 'NO POWER']);
      if (b.type === 'stack') rows.push(['Stage', this.stageLabel(b)]);
      if (s.effect) rows.push(['Radius', `${s.radius} tiles`]);
      const jobs = s.jobsCom + s.jobsInd;
      if (jobs || def.jobs) rows.push(['Jobs', `${jobs}`]);
      if (s.residents || def.residents) rows.push(['Residents', `${s.residents}`]);
      rows.push(['Upkeep', `${s.upkeep} ${CURRENCY}/mo`]);
      if (b.offline > 0) rows.push(['Status', `Offline ${b.offline}d`]);
      info = { title: def.name, subtitle: def.desc, color: def.color, rows };
    } else if (t.road) {
      info = {
        title: t.terrain === Terrain.Water ? 'Bridge' : 'Road',
        subtitle: t.terrain === Terrain.Water ? 'Elevated skyway over the water.' : 'Street grid. Zones within 3 tiles can develop.',
        color: '#9aa4c7',
        rows: [['Traffic', pct(f.traffic[i])], ['Pollution', pct(f.pollution[i])]],
      };
    } else if (zoneDefFor(t.zone)) {
      const zd = zoneDefFor(t.zone)!;
      const levelName = ['Empty lot', 'Low density', 'Mid density', 'High density'][t.level];
      const cap = zd.capacity[t.level];
      const rows: [string, string][] = [
        ['Status', t.abandoned ? 'ABANDONED' : levelName],
        [t.zone === ZoneType.Residential ? 'Residents' : 'Jobs', t.abandoned ? '0' : `${cap}`],
        ['Power', t.level === 0 ? '—' : t.powered ? 'Online' : 'NO POWER'],
        ['Road access', w.hasRoadAccess(x, y) ? 'Yes' : 'NO ROAD'],
        ...common,
      ];
      info = { title: zd.name, subtitle: zd.desc, color: zd.color, rows };
    } else if (t.terrain === Terrain.Water) {
      info = { title: 'Bay water', subtitle: 'Black water. Roads can bridge it.', color: '#1b6c8a', rows: [['Pollution', pct(f.pollution[i])]] };
    } else {
      info = { title: 'Open ground', subtitle: 'Unclaimed lot, ready to build.', color: '#6b6f8f', rows: common };
    }
    this.storyRows(x, y, info.rows);
    return info;
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
    if (tool === 'road') return ROAD_COST;
    if (tool === 'bulldoze') return BULLDOZE_COST;
    return 0;
  }

  /**
   * Current price of a tool with every modifier: buildings use buildCostMul ×
   * costMul[type] × the next credit × the Stratablock 1.15ⁿ scaling; zones, the
   * shortest skybridge, one rail or road tile and the cheapest bulldoze use
   * buildCostMul (as planAction prices them).
   */
  toolCost(tool: ToolId): number {
    if (isBuildingTool(tool)) return buildingCost(this.world, tool);
    const base = Game.toolCost(tool);
    if (base > 0) return Math.round(base * this.world.mods.buildCostMul);
    return base;
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
