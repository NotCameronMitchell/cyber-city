import { BUILDINGS, DEFAULT_TAX, POP_SCALE, ROAD_ACCESS_RANGE, SAVE_VERSION, SAVE_VERSIONS_SUPPORTED, SPACEPORT, START_FUNDS } from './config';
import { Emitter, type GameEventMap } from './events';
import { shoreFacing } from './ports';
import { Rng, fbm, hash2 } from './rng';
import { accessRange, roadLinks, storedKind } from './roads';
import { decodeRle, decodeStory, encodeRle, encodeStory, isCrownId, type DecodeOptions } from './story/encode';
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
  MOMENT_IDS,
  RoadKind,
  Terrain,
  ZoneType,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  START_YEAR,
  type Building,
  type MomentId,
  type TileSnap,
  type WealthTier,
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

/** Skyway bits: link mask N1 E2 S4 W8 and the ramp bit (EXPANSION §2.4). */
const SKY_LINKS = 15;
const SKY_RAMP = 16;
/** Link bit → [dx, dy, opposite bit]. */
const SKY_DIRS: readonly [number, number, number, number][] = [
  [1, 0, -1, 4],
  [2, 1, 0, 8],
  [4, 0, 1, 1],
  [8, -1, 0, 2],
];

const tierOf = (v: number): WealthTier => (v >= 2 ? 2 : v >= 1 ? 1 : 0);
const popcount4 = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** Skyway bits a tile may keep (EXPANSION §2.5): ramp only with exactly one link; no links → nothing. */
function saneSky(bits: number): number {
  const m = bits & SKY_LINKS;
  if (m === 0) return 0;
  return (bits & SKY_RAMP) !== 0 && popcount4(m) === 1 ? m | SKY_RAMP : m;
}

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
    noise: f(),
    education: f(),
    skyTraffic: f(),
    wealth: f(),
    hub: f(),
    sea: f(),
    alleyNear: new Uint8Array(N * N),
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
    wealth: [0, 0, 0],
    tierEffect: { residents: 0, tax: 0 },
    avgNoise: 0,
    roads: { street: 0, avenue: 0, highway: 0, alley: 0, ramp: 0, skyway: 0 },
    edgeLinks: 0,
    visitors: 0,
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
    roadKind: RoadKind.Street,
    wealth: 0,
  };
}

/** A stored head count as a whole number ≥ 0 (no int32 wrap: a 25-district city passes 10 M). */
function wholeCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * What a save's head counts (maxPopulation, milestones) are multiplied by at load (MEGACITY
 * §4.4): POP_SCALE for a save without `scale` (every v1–v3 save counts v3 people), 1 for one
 * written in today's units (`scale: POP_SCALE`, never multiplied again).
 */
export function savePopScale(data: { scale?: unknown }): number {
  const s = Number(data.scale);
  return Number.isFinite(s) && s > 0 ? POP_SCALE / s : POP_SCALE;
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

  // ── Expansion (docs/EXPANSION.md §2.1, §2.4). ──
  /** Skyway bits per tile: 0-3 link mask (N1 E2 S4 W8), bit 4 = ramp. Uint8Array(4096). Mutate via setSky/clearSky. Saved (v3). */
  sky = new Uint8Array(N * N);
  /** ++ on every sky mutation (not saved). SimGrid compares it to rebuild its sky caches. */
  skyVersion = 0;
  /** Wealth hysteresis streak per tile (GrowthSystem writes, wealthInfo reads the sign for ▲/▼). Not saved. */
  wealthStreak = new Int8Array(N * N);
  /** Save version this world was decoded from (SAVE_VERSION for a new world). Game reads it once (settleWealth, §4.3). */
  loadedVersion = SAVE_VERSION;
  /** Once-per-city moments already shown (§5.4). Saved as SaveData.moments. */
  moments = new Set<MomentId>();

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
  /**
   * 4-bit road connectivity mask: 1 = north (y-1), 2 = east (x+1), 4 = south (y+1), 8 = west (x-1).
   * On a road tile a bit is set only when the neighbour is a road it links to (EXPANSION §3.2:
   * a highway joins only highways and ramps). On a non-road tile it is roadAdjMask (any road).
   */
  roadMask(x: number, y: number): number {
    const t = this.tileAt(x, y);
    if (!t || !t.road) return this.roadAdjMask(x, y);
    const k = t.roadKind;
    let m = 0;
    let n = this.tileAt(x, y - 1);
    if (n && n.road && roadLinks(k, n.roadKind)) m |= 1;
    n = this.tileAt(x + 1, y);
    if (n && n.road && roadLinks(k, n.roadKind)) m |= 2;
    n = this.tileAt(x, y + 1);
    if (n && n.road && roadLinks(k, n.roadKind)) m |= 4;
    n = this.tileAt(x - 1, y);
    if (n && n.road && roadLinks(k, n.roadKind)) m |= 8;
    return m;
  }
  /** Raw 4-bit adjacency of any ground road, whatever its kind (power conducts between any two roads). */
  roadAdjMask(x: number, y: number): number {
    return (
      (this.isRoad(x, y - 1) ? 1 : 0) |
      (this.isRoad(x + 1, y) ? 2 : 0) |
      (this.isRoad(x, y + 1) ? 4 : 0) |
      (this.isRoad(x - 1, y) ? 8 : 0)
    );
  }
  /**
   * Road access (EXPANSION §3.3): true iff a Street, Avenue or Ramp lies within `range`
   * (ROAD_ACCESS_RANGE, Chebyshev) of (x, y), or a Back Alley within 1. A Highway never counts.
   */
  hasRoadAccess(x: number, y: number, range = ROAD_ACCESS_RANGE): boolean {
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const t = this.tileAt(x + dx, y + dy);
        if (!t || !t.road) continue;
        const a = accessRange(t.roadKind);
        if (a <= 0) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (d <= Math.min(a, range)) return true;
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

  /**
   * Lay a new ground road of `kind` (default Street, so `setRoad(x, y)` is unchanged).
   * Alley and Ramp can't sit on water: they are written as Street there.
   */
  setRoad(x: number, y: number, kind: RoadKind = RoadKind.Street) {
    const t = this.tileAt(x, y);
    if (!t || t.buildingId >= 0) return;
    t.road = true;
    t.roadKind = storedKind(kind, t.terrain);
    t.zone = ZoneType.None;
    t.level = 0;
    t.abandoned = false;
    t.wealth = 0;
    this.reroll(t, x, y);
    this.touch(x, y, x, y);
  }

  /**
   * Change the kind of an existing road (widening, ramps, highway conversion): no variant
   * reroll, no age reset. No-op on a non-road tile. Alley / Ramp on water are written as Street.
   */
  setRoadKind(x: number, y: number, kind: RoadKind) {
    const t = this.tileAt(x, y);
    if (!t || !t.road) return;
    const k = storedKind(kind, t.terrain);
    if (t.roadKind === k) return;
    t.roadKind = k;
    this.touch(x, y, x, y);
  }

  setZone(x: number, y: number, zone: ZoneType) {
    const t = this.tileAt(x, y);
    if (!t || t.terrain === Terrain.Water || t.buildingId >= 0) return;
    t.road = false;
    t.roadKind = RoadKind.Street;
    t.zone = zone;
    t.level = 0;
    t.abandoned = false;
    t.wealth = 0;
    this.reroll(t, x, y);
    this.touch(x, y, x, y);
  }

  /**
   * Set a zone tile's development level (sim growth). `wealth` (EXPANSION §4.3) sets the tier
   * at the same time (the latch when a lot develops); omitted, the tier is kept. Level 0 always
   * resets the tier to $; abandonment keeps it.
   */
  setLevel(x: number, y: number, level: number, abandoned = false, wealth?: WealthTier) {
    const t = this.tileAt(x, y);
    if (!t || t.zone === ZoneType.None) return;
    if (t.level === level && t.abandoned === abandoned) {
      if (wealth !== undefined) this.setWealth(x, y, wealth);
      return;
    }
    t.level = Math.max(0, Math.min(3, level));
    t.abandoned = abandoned && t.level > 0;
    t.wealth = t.level === 0 ? 0 : wealth !== undefined ? tierOf(wealth) : t.wealth;
    this.reroll(t, x, y);
    this.touch(x, y, x, y);
  }

  /**
   * Set a developed zone tile's wealth tier (EXPANSION §4.3). Forced to $ on a lot or a
   * non-zone tile. Emits no 'tiles' event and does not reroll or reset age: tier art lives
   * in the zone sprite, so gentrification never dirties ground chunks.
   */
  setWealth(x: number, y: number, tier: WealthTier) {
    const t = this.tileAt(x, y);
    if (!t) return;
    t.wealth = t.zone === ZoneType.None || t.level === 0 ? 0 : tierOf(tier);
  }

  /**
   * Clear a single tile's ground (road / zone, rail, skybridge anchors). Buildings must be
   * removed via removeBuilding (a building tile removes the whole building). The skyway over
   * the tile stays unless `withSky` (a ground bulldoze leaves decks spanning the cleared site,
   * EXPANSION §3.6; a sky bulldoze uses clearSky).
   */
  clearTile(x: number, y: number, withSky = false) {
    const t = this.tileAt(x, y);
    if (!t) return;
    if (withSky) this.clearSky(x, y);
    if (t.buildingId >= 0) {
      this.removeBuilding(t.buildingId);
      return;
    }
    t.road = false;
    t.roadKind = RoadKind.Street;
    t.zone = ZoneType.None;
    t.level = 0;
    t.abandoned = false;
    t.wealth = 0;
    t.age = 0;
    this.clearRail(x, y);
    this.removeLinksAt(x, y);
    this.touch(x, y, x, y);
  }

  /**
   * Undo only (EXPANSION §7.7): write a tile's snapshot back (road, road kind, zone, level,
   * sky bits) and touch it. On a building tile only the sky bits are written (a skyway docked
   * into an anchor crosses its roof). Keeps the §2.1 invariants: a lot or non-zone tile is $,
   * a non-road tile is Street, Alley / Ramp never on water.
   */
  restoreTile(i: number, snap: TileSnap) {
    if (!(i >= 0 && i < N * N)) return;
    const t = this.tiles[i];
    const x = i % N;
    const y = (i / N) | 0;
    const sky = snap.sky & 31;
    if (this.sky[i] !== sky) {
      this.sky[i] = sky;
      this.skyVersion++;
    }
    if (t.buildingId >= 0) {
      this.touch(x, y, x, y);
      return;
    }
    t.road = !!snap.road;
    t.roadKind = t.road ? storedKind(snap.roadKind, t.terrain) : RoadKind.Street;
    const zone = t.road || t.terrain === Terrain.Water ? ZoneType.None : snap.zone;
    t.zone = zone >= 0 && zone <= 3 ? zone : ZoneType.None;
    t.level = t.zone === ZoneType.None ? 0 : Math.max(0, Math.min(3, snap.level | 0));
    if (t.level === 0) {
      t.abandoned = false;
      t.wealth = 0;
    }
    this.touch(x, y, x, y);
  }

  /** Set a tile's skyway bits (mask | ramp << 4; 0 removes). Callers keep neighbours consistent (like setRail). */
  setSky(x: number, y: number, bits: number) {
    if (!this.inBounds(x, y)) return;
    const i = y * N + x;
    const v = bits & 31;
    if (this.sky[i] === v) return;
    this.sky[i] = v;
    this.skyVersion++;
    this.touch(x, y, x, y);
  }

  /**
   * Remove the skyway from a tile and unhook the neighbours that linked to it (like clearRail).
   * A neighbour left with no link is cleared too, and one left with a ramp bit and other than
   * exactly one link loses the ramp bit (the same rule the save decoder applies, §2.5).
   */
  clearSky(x: number, y: number) {
    if (!this.inBounds(x, y)) return;
    const s = this.sky;
    const i = y * N + x;
    if (!s[i]) return;
    s[i] = 0;
    for (const [, dx, dy, opp] of SKY_DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if ((s[j] & opp) === 0) continue;
      s[j] = saneSky(s[j] & ~opp);
    }
    this.skyVersion++;
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
        t.roadKind = RoadKind.Street;
        t.zone = ZoneType.None;
        t.level = 0;
        t.abandoned = false;
        t.wealth = 0;
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
    // Tile bits (EXPANSION §2.3): 0 terrain, 1 road, 2-3 zone, 4-5 level, 6 abandoned,
    // 7-14 variant, 15-17 roadKind (0 without a road), 18-19 wealth (0 on lots), 20+ zero.
    const tiles = this.tiles.map(
      (t) =>
        (t.terrain & 1) |
        ((t.road ? 1 : 0) << 1) |
        ((t.zone & 3) << 2) |
        ((t.level & 3) << 4) |
        ((t.abandoned ? 1 : 0) << 6) |
        ((t.variant & 255) << 7) |
        ((t.road ? t.roadKind & 7 : 0) << 15) |
        ((t.zone !== ZoneType.None && t.level >= 1 ? t.wealth & 3 : 0) << 18),
    );
    return {
      version: SAVE_VERSION,
      cityName: this.cityName,
      seed: this.seed,
      tick: this.tick,
      funds: Math.round(this.funds),
      taxRate: this.taxRate,
      maxPopulation: this.maxPopulation,
      scale: POP_SCALE,
      nextBuildingId: this.nextBuildingId,
      tiles,
      buildings: [...this.buildings.values()].map((b) => ({ ...b })),
      news: this.news.slice(-20),
      history: this.budget.history.slice(-12),
      milestones: [...this.milestones],
      savedAt: Date.now(),
      story: encodeStory(this),
      sky: encodeRle(this.sky),
      moments: [...this.moments],
    };
  }

  /**
   * Load a save (§10.8). Accepts every version in SAVE_VERSIONS_SUPPORTED and
   * throws for others. A v1 save, or a v2 save whose `story` is missing or
   * fails to decode, gets a fresh story with flag `migrated` and empty turf,
   * rail and links. Derived state (mods, layers, ledger, vertical, turf.stats)
   * is rebuilt by the director on construction.
   *
   * Expansion (EXPANSION §2.3, §2.5): tile bits 15-19 decode for every version
   * (old saves read all-Street, all-$); `sky` and `moments` decode for v3 (missing
   * or malformed → empty, never a throw); port fields are sanitised per type.
   *
   * Megacity units (MEGACITY §4.4): `maxPopulation` and `milestones` of a save without `scale`
   * are × POP_SCALE (savePopScale); serialize() writes `scale: POP_SCALE`.
   */
  static deserialize(data: SaveData, events?: Emitter<GameEventMap>, opts?: DecodeOptions): World {
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
    // Megacity units (MEGACITY §4.1, §4.4): a save without `scale` counts v3 people (×1).
    const popMul = savePopScale(data);
    w.maxPopulation = Math.round(wholeCount(data.maxPopulation) * popMul);
    w.nextBuildingId = data.nextBuildingId | 0 || 1;
    w.loadedVersion = data.version;
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
      // §2.3: kind 0 without a road or out of range; Alley / Ramp never on water.
      t.roadKind = t.road ? storedKind((p >> 15) & 7, t.terrain) : RoadKind.Street;
      const tier = (p >> 18) & 3;
      t.wealth = t.zone === ZoneType.None || t.level === 0 ? 0 : tierOf(tier);
    }
    const needFacing: Building[] = [];
    for (const b of data.buildings ?? []) {
      if (!BUILDINGS[b.type]) continue;
      const nb: Building = { ...b, size: BUILDINGS[b.type].size, offline: b.offline | 0, powered: !!b.powered };
      // Stage fields are optional and Stratablock-only; keep them only when well-formed.
      if (nb.type !== 'stack') {
        delete nb.stage;
        delete nb.crown;
        if (nb.type !== 'spaceport') delete nb.buildDays;
      } else {
        if (nb.stage !== undefined && !(nb.stage === 1 || nb.stage === 2 || nb.stage === 3)) delete nb.stage;
        if (nb.buildDays !== undefined) nb.buildDays = Math.max(0, Number(nb.buildDays) | 0);
        if (nb.crown !== undefined && !isCrownId(nb.crown)) delete nb.crown;
      }
      // Expansion port fields (§2.5): facing on seaports only; build timers and launches on the spaceport only.
      if (nb.type === 'seaport') {
        const f = nb.facing as unknown;
        if (!(f === 0 || f === 1 || f === 2 || f === 3)) {
          delete nb.facing;
          needFacing.push(nb); // recomputed once rail is decoded (a berth needs open water)
        }
      } else delete nb.facing;
      if (nb.type === 'spaceport') {
        const maxDays = BUILDINGS.spaceport.buildDays ?? 0;
        if (nb.buildDays !== undefined) nb.buildDays = Math.min(maxDays, Math.max(0, Number(nb.buildDays) | 0));
        if (nb.waitSec !== undefined) {
          const v = Number(nb.waitSec);
          nb.waitSec = Number.isFinite(v) ? Math.min(SPACEPORT.minBuildSec, Math.max(0, v)) : 0;
        }
        if (nb.launches !== undefined) {
          const v = nb.launches as unknown;
          nb.launches = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
        }
      } else {
        delete nb.waitSec;
        delete nb.launches;
      }
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
    // v3 milestones ×10 are exactly today's first six thresholds (§4.5).
    w.milestones = Array.isArray(data.milestones)
      ? [...new Set(data.milestones.map((p) => Math.round(wholeCount(p) * popMul)).filter((p) => p > 0))]
      : [];
    // Story (§10.8): v2 decodes data.story; v1, or a missing / undecodable block, keeps the
    // constructor's fresh story (empty turf, rail, links) and is marked migrated.
    if (!(data.version >= 2 && decodeStory(data.story, w, opts))) {
      // The story starts now, not at tick 0: chapter fallbacks, waivers and the
      // ambient timers count from the load, so an old city doesn't chain-fire Ch1.
      const st = w.story;
      st.flags.migrated = true;
      st.waitingSince = st.chapterTick = st.lastWhisperTick = st.lastNoteTick = w.tick;
    }
    // Expansion (§2.5): skyways and once-per-city moments (v3). Missing or malformed → empty.
    if (data.version >= 3) {
      if (decodeRle(data.sky, w.sky, 31)) w.sanitizeSky();
      if (Array.isArray(data.moments))
        for (const m of data.moments) if ((MOMENT_IDS as readonly unknown[]).includes(m)) w.moments.add(m as MomentId);
    }
    // A seaport without a valid facing takes the first side that faces open water (else S).
    for (const b of needFacing) {
      const f = shoreFacing(w, b.x, b.y, b.size);
      b.facing = f === -1 ? 2 : f;
    }
    w.version++;
    return w;
  }

  /**
   * One pass over world.sky (§2.5): clear link bits that point off the map or at a neighbour
   * that doesn't link back; keep the ramp bit only with exactly one link (the ground is not
   * checked: an inactive ramp stays a ramp); a tile left with no link is cleared.
   */
  private sanitizeSky() {
    const s = this.sky;
    // Links first (judged against the decoded bits), then the ramp / empty rule.
    const linked = new Uint8Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const v = s[i];
        if (!v) continue;
        let m = 0;
        for (const [bit, dx, dy, opp] of SKY_DIRS) {
          if ((v & bit) === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          if ((s[ny * N + nx] & opp) !== 0) m |= bit;
        }
        linked[i] = m | (v & SKY_RAMP);
      }
    for (let i = 0; i < N * N; i++) s[i] = saneSky(linked[i]);
    this.skyVersion++;
  }
}
