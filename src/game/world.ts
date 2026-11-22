import { BUILDINGS, DEFAULT_TAX, ROAD_ACCESS_RANGE, SAVE_VERSION, SAVE_VERSIONS_SUPPORTED, START_FUNDS } from './config';
import { Emitter, type GameEventMap } from './events';
import { Rng, fbm, hash2 } from './rng';
import { cloneMods, makeLayerParts, makeLayers } from './story/mods';
import { emptyLedger, emptyTurf, emptyVertical, newStoryState } from './story/state';
import type {
  CrownId,
  LayerParts,
  SimLayers,
  SimMods,
  SkyLink,
  StoryLedger,
  StorySignal,
  StoryState,
  TurfMap,
  VerticalCache,
} from './story/types';
import {
  MAP_SIZE,
  Terrain,
  ZoneType,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  START_YEAR,
  type Building,
  type BuildingType,
  type BudgetReport,
  type CityStats,
  type Fields,
  type NewsItem,
  type SaveData,
  type Tile,
} from './types';

const N = MAP_SIZE;
/** world.signals keeps at most this many (oldest dropped) when nothing drains it, e.g. headless sim tests. */
const MAX_SIGNALS = 256;
/** Building types whose footprint keeps the turf under it (§3.1). */
const TURF_KEEPING: ReadonlySet<BuildingType> = new Set<BuildingType>(['tidemarket', 'roost']);

function makeFields(): Fields {
  const f = () => new Float32Array(N * N);
  return {
    landValue: f(),
    pollution: f(),
    crime: f(),
    traffic: f(),
    security: f(),
    health: f(),
    net: f(),
    park: f(),
    transit: f(),
    prestige: f(),
  };
}

export function emptyStats(): CityStats {
  return {
    population: 0,
    jobsCom: 0,
    jobsInd: 0,
    employed: 0,
    unemployment: 0,
    demand: { res: 0.6, com: 0.2, ind: 0.4 },
    powerSupply: 0,
    powerDemand: 0,
    unpoweredTiles: 0,
    avgLandValue: 0,
    avgCrime: 0,
    avgPollution: 0,
    avgTraffic: 0,
    approval: 60,
    developed: { res: 0, com: 0, ind: 0 },
    abandonedTiles: 0,
  };
}

function emptyBudget(): BudgetReport {
  return { income: 0, expenses: 0, incomeLines: [], expenseLines: [], history: [] };
}

function blankTile(): Tile {
  return {
    terrain: Terrain.Land,
    road: false,
    zone: ZoneType.None,
    level: 0,
    variant: 0,
    abandoned: false,
    buildingId: -1,
    powered: false,
    age: 9999,
  };
}

/**
 * The whole city state. Low-level mutators here do NOT charge money and do
 * NOT validate gameplay rules beyond structural integrity; see actions.ts for
 * the player-facing rules and costs.
 */
export class World {
  readonly size = N;
  readonly events: Emitter<GameEventMap>;
  cityName: string;
  seed: number;
  tick = 0;
  funds = START_FUNDS;
  /** Percent, 0..20. */
  taxRate = DEFAULT_TAX;
  /** Highest population ever reached (drives unlocks so they never re-lock). */
  maxPopulation = 0;
  tiles: Tile[];
  buildings = new Map<number, Building>();
  nextBuildingId = 1;
  fields: Fields = makeFields();
  stats: CityStats = emptyStats();
  budget: BudgetReport = emptyBudget();
  news: NewsItem[] = [];
  /** Population milestones already awarded. */
  milestones: number[] = [];
  rng: Rng;
  /** Increments on every tile mutation; renderers can compare to detect change. */
  version = 0;

  // ── Story layer (docs/STORY.md §10–§11). Safe to ignore: all default to inert identities. ──
  /** Director state (saved in SaveData.story). Written by the director only. */
  story: StoryState;
  /** Gang turf (plain data; the sim may read it). Written by story/turf.ts. */
  turf: TurfMap = emptyTurf();
  /** Ribbon Rail connection bitmask per tile (N1 E2 S4 W8), Uint8Array(4096). Mutate via setRail/clearRail. */
  rail = new Uint8Array(N * N);
  /** Skybridges. Mutate via addLink/removeLinksAt. */
  links: SkyLink[] = [];
  nextLinkId = 1;
  /** Resolved city-wide modifiers the sim reads (resolveMods → world.mods). Identities by default. */
  mods: SimMods = cloneMods();
  /** Composed per-tile layers the sim reads (composeLayers). Identities by default. */
  layers: SimLayers = makeLayers();
  /** Partial layer sets, one per owner (turf.ts, vertical.ts, director), merged by composeLayers. */
  layerParts: LayerParts = makeLayerParts();
  /** Story budget lines the monthly budget appends (amounts positive). Written by the director. */
  ledger: StoryLedger = emptyLedger();
  /** Reports from sim and actions to the director; drained by director.onDay(). Push via pushSignal(). */
  signals: StorySignal[] = [];
  /** Derived vertical caches (active links, live rail, metrics). Written by story/vertical.ts. */
  vertical: VerticalCache = emptyVertical();

  constructor(seed: number, cityName = 'Lanthorn Bay', events?: Emitter<GameEventMap>) {
    this.seed = seed >>> 0;
    this.cityName = cityName;
    this.events = events ?? new Emitter<GameEventMap>();
    this.rng = new Rng(this.seed ^ 0xa5a5a5a5);
    this.tiles = Array.from({ length: N * N }, blankTile);
    this.story = newStoryState(this.seed);
  }

  /** Create a fresh world with generated terrain. */
  static generate(seed: number, cityName?: string, events?: Emitter<GameEventMap>): World {
    const w = new World(seed, cityName, events);
    w.generateTerrain();
    return w;
  }

  // ── Indexing ──────────────────────────────────────────────────────────────
  idx(x: number, y: number): number {
    return y * N + x;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < N && y < N;
  }
  tileAt(x: number, y: number): Tile | null {
    return this.inBounds(x, y) ? this.tiles[y * N + x] : null;
  }
  buildingAt(x: number, y: number): Building | null {
    const t = this.tileAt(x, y);
    if (!t || t.buildingId < 0) return null;
    return this.buildings.get(t.buildingId) ?? null;
  }
  isRoad(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return !!t && t.road;
  }
  /** 4-bit road connectivity mask: 1 = north (y-1), 2 = east (x+1), 4 = south (y+1), 8 = west (x-1). */
  roadMask(x: number, y: number): number {
    return (
      (this.isRoad(x, y - 1) ? 1 : 0) |
      (this.isRoad(x + 1, y) ? 2 : 0) |
      (this.isRoad(x, y + 1) ? 4 : 0) |
      (this.isRoad(x - 1, y) ? 8 : 0)
    );
  }
  /** True if a road lies within ROAD_ACCESS_RANGE (Chebyshev) of (x, y). */
  hasRoadAccess(x: number, y: number, range = ROAD_ACCESS_RANGE): boolean {
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (this.isRoad(x + dx, y + dy)) return true;
      }
    }
    return false;
  }

  // ── Calendar ──────────────────────────────────────────────────────────────
  get day(): number {
    return (this.tick % DAYS_PER_MONTH) + 1;
  }
  get month(): number {
    return Math.floor(this.tick / DAYS_PER_MONTH) % MONTHS_PER_YEAR; // 0..11
  }
  get year(): number {
    return START_YEAR + Math.floor(this.tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  }
  dateLabel(): string {
    const m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][this.month];
    return `${m} ${this.year}`;
  }

  // ── Low-level mutators ────────────────────────────────────────────────────
  private touch(x0: number, y0: number, x1: number, y1: number) {
    this.version++;
    // Expand by 1 so neighbours (road masks, building occlusion) redraw too.
    this.events.emit('tiles', {
      x0: Math.max(0, x0 - 1),
      y0: Math.max(0, y0 - 1),
      x1: Math.min(N - 1, x1 + 1),
      y1: Math.min(N - 1, y1 + 1),
    });
  }

  /** Mark a rectangle as changed (for systems that mutate tiles directly, e.g. sim growth). */
  markChanged(x0: number, y0: number, x1 = x0, y1 = y0) {
    this.touch(x0, y0, x1, y1);
  }

  private reroll(t: Tile, x: number, y: number) {
    t.variant = Math.floor(hash2(x, y, this.seed + this.version * 7919 + this.tick) * 256) & 255;
    t.age = 0;
  }

  setRoad(x: number, y: number) {
    const t = this.tileAt(x, y);
    if (!t || t.buildingId >= 0) return;
    t.road = true;
    t.zone = ZoneType.None;
    t.level = 0;
    t.abandoned = false;
    this.reroll(t, x, y);
    this.touch(x, y, x, y);
  }

  setZone(x: number, y: number, zone: ZoneType) {
    const t = this.tileAt(x, y);
    if (!t || t.terrain === Terrain.Water || t.buildingId >= 0) return;
    t.road = false;
    t.zone = zone;
    t.level = 0;
    t.abandoned = false;
    this.reroll(t, x, y);
    this.touch(x, y, x, y);
  }

  /** Set a zone tile's development level (sim growth). */
  setLevel(x: number, y: number, level: number, abandoned = false) {
    const t = this.tileAt(x, y);
    if (!t || t.zone === ZoneType.None) return;
    if (t.level === level && t.abandoned === abandoned) return;
    t.level = Math.max(0, Math.min(3, level));
    t.abandoned = abandoned && t.level > 0;
    this.reroll(t, x, y);
    this.touch(x, y, x, y);
  }

  /** Clear a single tile (road/zone). Buildings must be removed via removeBuilding. */
  clearTile(x: number, y: number) {
    const t = this.tileAt(x, y);
    if (!t) return;
    if (t.buildingId >= 0) {
      this.removeBuilding(t.buildingId);
      return;
    }
    t.road = false;
    t.zone = ZoneType.None;
    t.level = 0;
    t.abandoned = false;
    t.age = 0;
    this.clearRail(x, y);
    this.removeLinksAt(x, y);
    this.touch(x, y, x, y);
  }

  addBuilding(type: BuildingType, x: number, y: number): Building | null {
    const size = BUILDINGS[type].size;
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const t = this.tileAt(x + dx, y + dy);
        if (!t || t.terrain === Terrain.Water || t.buildingId >= 0) return null;
      }
    const b: Building = {
      id: this.nextBuildingId++,
      type,
      x,
      y,
      size,
      builtTick: this.tick,
      offline: 0,
      powered: BUILDINGS[type].powerSupply > 0,
    };
    this.buildings.set(b.id, b);
    const keepTurf = TURF_KEEPING.has(type);
    const turf = this.turf;
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const i = this.idx(x + dx, y + dy);
        const t = this.tiles[i];
        t.road = false;
        t.zone = ZoneType.None;
        t.level = 0;
        t.abandoned = false;
        t.buildingId = b.id;
        if (!keepTurf && turf.owner[i]) {
          turf.owner[i] = 0;
          turf.str[i] = 0;
          turf.contested[i] = 0;
        }
        this.reroll(t, x + dx, y + dy);
      }
    this.touch(x, y, x + size - 1, y + size - 1);
    return b;
  }

  removeBuilding(id: number) {
    const b = this.buildings.get(id);
    if (!b) return;
    this.buildings.delete(id);
    for (let dy = 0; dy < b.size; dy++)
      for (let dx = 0; dx < b.size; dx++) {
        const t = this.tileAt(b.x + dx, b.y + dy);
        if (t && t.buildingId === id) {
          t.buildingId = -1;
          t.powered = false;
          t.age = 0;
        }
        this.clearRail(b.x + dx, b.y + dy);
        this.removeLinksAt(b.x + dx, b.y + dy);
      }
    this.touch(b.x, b.y, b.x + b.size - 1, b.y + b.size - 1);
  }

  // ── Story-layer mutators (§11). Structural only: no costs, no rule checks. ──

  /** Set the rail connection mask (N1 E2 S4 W8) of a tile; 0 removes it. Callers keep neighbours consistent. */
  setRail(x: number, y: number, mask: number) {
    if (!this.inBounds(x, y)) return;
    const i = y * N + x;
    const m = mask & 15;
    if (this.rail[i] === m) return;
    this.rail[i] = m;
    this.touch(x, y, x, y);
  }

  /** Remove rail from a tile and unhook the neighbours that pointed at it. */
  clearRail(x: number, y: number) {
    if (!this.inBounds(x, y)) return;
    const r = this.rail;
    const i = y * N + x;
    if (!r[i]) return;
    r[i] = 0;
    if (y > 0) r[i - N] &= ~4; // north neighbour loses its south link
    if (x < N - 1) r[i + 1] &= ~8; // east neighbour loses its west link
    if (y < N - 1) r[i + N] &= ~1; // south neighbour loses its north link
    if (x > 0) r[i - 1] &= ~2; // west neighbour loses its east link
    this.touch(x, y, x, y);
  }

  /** Add a skybridge between two anchor tiles. Returns the stored link (with its new id). */
  addLink(l: Omit<SkyLink, 'id'> & { id?: number }): SkyLink {
    const link: SkyLink = { id: l.id ?? this.nextLinkId, ax: l.ax, ay: l.ay, bx: l.bx, by: l.by };
    if (link.id >= this.nextLinkId) this.nextLinkId = link.id + 1;
    this.links.push(link);
    this.touchLink(link);
    return link;
  }

  /** Drop every skybridge anchored on tile (x, y). Returns how many were removed. */
  removeLinksAt(x: number, y: number): number {
    if (this.links.length === 0) return 0;
    let removed = 0;
    for (let k = this.links.length - 1; k >= 0; k--) {
      const l = this.links[k];
      if ((l.ax === x && l.ay === y) || (l.bx === x && l.by === y)) {
        this.links.splice(k, 1);
        this.touchLink(l);
        removed++;
      }
    }
    return removed;
  }

  /** Set a Stratablock's stage fields (stage started, scaffolding days left, crown). */
  setStage(b: Building, stage: 1 | 2 | 3, buildDays: number, crown?: CrownId) {
    b.stage = stage;
    b.buildDays = Math.max(0, Math.round(buildDays));
    if (crown) b.crown = crown;
    this.touch(b.x, b.y, b.x + b.size - 1, b.y + b.size - 1);
  }

  /** Queue a report for the director (capped so undrained headless runs stay bounded). */
  pushSignal(s: StorySignal) {
    this.signals.push(s);
    if (this.signals.length > MAX_SIGNALS) this.signals.splice(0, this.signals.length - MAX_SIGNALS);
  }

  private touchLink(l: SkyLink) {
    this.touch(Math.min(l.ax, l.bx), Math.min(l.ay, l.by), Math.max(l.ax, l.bx), Math.max(l.ay, l.by));
  }

  addNews(text: string, kind: NewsItem['kind'] = 'info') {
    const item: NewsItem = { tick: this.tick, text, kind };
    this.news.push(item);
    if (this.news.length > 40) this.news.splice(0, this.news.length - 40);
    this.events.emit('news', item);
  }

  // ── Terrain generation ────────────────────────────────────────────────────
  private generateTerrain() {
    const rng = new Rng(this.seed);
    const side = rng.int(0, 3); // which edge has the bay
    const riverAxis = rng.int(0, 1); // river runs along x or y
    const riverPhase = rng.next() * Math.PI * 2;
    const riverOffset = rng.int(18, 46);
    const s = this.seed % 10000;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const t = this.tiles[y * N + x];
        // Bay along one edge with a noisy coastline.
        const edgeDist = [y, N - 1 - x, N - 1 - y, x][side];
        const along = side % 2 === 0 ? x : y;
        const coast = 5 + fbm(along * 0.09, 3.7, s + 11) * 9;
        let water = edgeDist < coast;

        // Meandering river from the bay inland.
        const u = riverAxis === 0 ? x : y; // along
        const v = riverAxis === 0 ? y : x; // across
        const center = riverOffset + Math.sin(u * 0.11 + riverPhase) * 6 + (fbm(u * 0.05, 9.1, s + 23) - 0.5) * 10;
        const width = 1.2 + fbm(u * 0.08, 1.3, s + 37) * 1.6;
        if (Math.abs(v - center) < width) water = true;

        // A few lakes / flooded lots.
        const lake = fbm(x * 0.07, y * 0.07, s + 51, 3);
        if (lake > 0.76) water = true;

        t.terrain = water ? Terrain.Water : Terrain.Land;
        t.variant = Math.floor(hash2(x, y, this.seed) * 256);
      }
    }

    // Keep a generous buildable core near the map centre (lakes there are drained).
    for (let y = 22; y < 42; y++)
      for (let x = 22; x < 42; x++) {
        const t = this.tiles[y * N + x];
        const lake = fbm(x * 0.07, y * 0.07, s + 51, 3);
        if (t.terrain === Terrain.Water && lake > 0.76) t.terrain = Terrain.Land;
      }
    this.version++;
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  serialize(): SaveData {
    const tiles = this.tiles.map(
      (t) =>
        (t.terrain & 1) |
        ((t.road ? 1 : 0) << 1) |
        ((t.zone & 3) << 2) |
        ((t.level & 3) << 4) |
        ((t.abandoned ? 1 : 0) << 6) |
        ((t.variant & 255) << 7),
    );
    return {
      version: SAVE_VERSION,
      cityName: this.cityName,
      seed: this.seed,
      tick: this.tick,
      funds: Math.round(this.funds),
      taxRate: this.taxRate,
      maxPopulation: this.maxPopulation,
      nextBuildingId: this.nextBuildingId,
      tiles,
      buildings: [...this.buildings.values()].map((b) => ({ ...b })),
      news: this.news.slice(-20),
      history: this.budget.history.slice(-12),
      milestones: [...this.milestones],
      savedAt: Date.now(),
    };
  }

  static deserialize(data: SaveData, events?: Emitter<GameEventMap>): World {
    if (
      !data ||
      !SAVE_VERSIONS_SUPPORTED.includes(data.version) ||
      !Array.isArray(data.tiles) ||
      data.tiles.length !== N * N
    ) {
      throw new Error('Incompatible save');
    }
    const w = new World(data.seed, data.cityName, events);
    w.tick = data.tick | 0;
    w.funds = Number(data.funds) || 0;
    w.taxRate = Math.max(0, Math.min(20, Number(data.taxRate) || DEFAULT_TAX));
    w.maxPopulation = data.maxPopulation | 0;
    w.nextBuildingId = data.nextBuildingId | 0 || 1;
    for (let i = 0; i < N * N; i++) {
      const p = data.tiles[i] | 0;
      const t = w.tiles[i];
      t.terrain = (p & 1) as Terrain;
      t.road = ((p >> 1) & 1) === 1;
      t.zone = ((p >> 2) & 3) as ZoneType;
      t.level = (p >> 4) & 3;
      t.abandoned = ((p >> 6) & 1) === 1;
      t.variant = (p >> 7) & 255;
      t.age = 9999;
    }
    for (const b of data.buildings ?? []) {
      if (!BUILDINGS[b.type]) continue;
      const nb: Building = { ...b, size: BUILDINGS[b.type].size, offline: b.offline | 0, powered: !!b.powered };
      // Stage fields are optional; keep them only when well-formed.
      if (nb.stage !== undefined && !(nb.stage === 1 || nb.stage === 2 || nb.stage === 3)) delete nb.stage;
      if (nb.buildDays !== undefined) nb.buildDays = Math.max(0, Number(nb.buildDays) | 0);
      w.buildings.set(nb.id, nb);
      for (let dy = 0; dy < nb.size; dy++)
        for (let dx = 0; dx < nb.size; dx++) {
          const t = w.tileAt(nb.x + dx, nb.y + dy);
          if (t) t.buildingId = nb.id;
        }
      if (nb.id >= w.nextBuildingId) w.nextBuildingId = nb.id + 1;
    }
    w.news = Array.isArray(data.news) ? data.news.slice(-20) : [];
    w.budget.history = Array.isArray(data.history) ? data.history.slice(-12) : [];
    w.milestones = Array.isArray(data.milestones) ? data.milestones.slice() : [];
    // Story (§10.8): decoding data.story (v2) is WP-B's encode.ts. Until then, and for v1
    // saves, the world keeps its fresh story; a save without one is marked migrated.
    if (!data.story) w.story.flags.migrated = true;
    w.version++;
    return w;
  }
}
