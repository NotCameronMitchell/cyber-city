import { ANNEX_SALT, BUILDINGS, DEFAULT_TAX, DISTRICTS, POP_SCALE, ROAD_ACCESS_RANGE, SAVE_VERSION, SAVE_VERSIONS_SUPPORTED, SPACEPORT, START_FUNDS } from './config';
import { placeAnnexContent } from './districts/annex';
import { presetOf, seedLayout } from './districts/layout';
import { BLOCK_TILES, decodeBlock, encodeBlock, upgradeSave, validateSaveShape } from './districts/migrate';
import { rebuildSegments, ringKey, slotX, slotY, validSlot, type TileRect } from './districts/slots';
import { generateRegionTerrain } from './districts/terrain';
import { Emitter, type GameEventMap } from './events';
import { shoreFacing } from './ports';
import { Rng, hash2 } from './rng';
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
  DISTRICT_KINDS,
  Ground,
  LEGACY_REGION,
  LEGACY_SIZE,
  MOMENT_IDS,
  SLOT,
  startSlot,
  type CityEventState,
  type DistrictKind,
  type DistrictSave,
  type DistrictVariant,
  type FrameRegion,
  type SlotId,
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

function makeFields(area: number): Fields {
  const f = () => new Float32Array(area);
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
    alleyNear: new Uint8Array(area),
    resilience: f(),
    filter: f(),
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
    districts: [],
    skyLobbies: { count: 0, largest: 0, visitors: 0 },
    ruins: 0,
    ruinsRestored: 0,
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
    elev: 0,
    ground: Ground.Plain,
  };
}

/** A fresh city's district state on a region: the seed's layout, only the start slot owned (annexed at tick 0). */
export function freshDistricts(seed: number, region: FrameRegion): DistrictSave {
  const layout = seedLayout(seed, region);
  const annexedAt = new Array(region * region).fill(-1);
  annexedAt[startSlot(region)] = 0;
  return {
    kinds: layout.kinds,
    variants: layout.variants,
    owned: [startSlot(region)],
    grants: 0,
    bought: 0,
    annexedAt,
    epilogueSec: 0,
    goalsDone: [],
    ruinsRestored: 0,
  };
}

/** Tile bits 0-23 (EXPANSION §2.3 + MEGACITY §3.10: 20-21 elev, 22-23 ground; both 0 on water). */
function tileBits(t: Tile): number {
  const land = t.terrain !== Terrain.Water;
  return (
    (t.terrain & 1) |
    ((t.road ? 1 : 0) << 1) |
    ((t.zone & 3) << 2) |
    ((t.level & 3) << 4) |
    ((t.abandoned ? 1 : 0) << 6) |
    ((t.variant & 255) << 7) |
    ((t.road ? t.roadKind & 7 : 0) << 15) |
    ((t.zone !== ZoneType.None && t.level >= 1 ? t.wealth & 3 : 0) << 18) |
    ((land ? t.elev & 3 : 0) << 20) |
    ((land ? t.ground & 3 : 0) << 22)
  );
}

/** Write tile bits 0-23 into a tile (sanitised: §2.3 road kinds, tiers only on developed lots, elev / ground 0 on water). */
function setTileBits(t: Tile, p: number): void {
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
  const land = t.terrain !== Terrain.Water;
  t.elev = land ? (p >> 20) & 3 : 0;
  t.ground = (land ? (p >> 22) & 3 : 0) as Ground;
}

const isKind = (k: unknown): k is DistrictKind => typeof k === 'string' && (DISTRICT_KINDS as readonly string[]).includes(k);
const nonNegInt = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

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
  /**
   * The per-world frame (MEGACITY §3.1): side in tiles and tile count, fixed for this World.
   * Index = y * N + x. Every system copies these at construction instead of a module constant.
   */
  readonly N: number;
  readonly area: number;
  /**
   * Region side in slots (MEGACITY §3.1): 3 or 5, fixed for this World (1 = the legacy 64×64 test frame,
   * types.ts LEGACY_REGION). N = SLOT × region. Growing a 3×3 city builds a new World from `upgradeRegion(save)`.
   */
  readonly region: FrameRegion;
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
  fields: Fields;
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
  turf: TurfMap;
  /** Ribbon Rail connection bitmask per tile (N1 E2 S4 W8), Uint8Array(area). Mutate via setRail/clearRail. */
  rail: Uint8Array;
  /** Skybridges. Mutate via addLink/removeLinksAt. */
  links: SkyLink[] = [];
  nextLinkId = 1;
  /** Resolved city-wide modifiers the sim reads (resolveMods → world.mods). Identities by default. */
  mods: SimMods = cloneMods();
  /** Composed per-tile layers the sim reads (composeLayers). Identities by default. */
  layers: SimLayers;
  /** Partial layer sets, one per owner (turf.ts, vertical.ts, director), merged by composeLayers. */
  layerParts: LayerParts;
  /** Story budget lines the monthly budget appends (amounts positive). Written by the director. */
  ledger: StoryLedger = emptyLedger();
  /** Reports from sim and actions to the director; drained by director.onDay(). Push via pushSignal(). */
  signals: StorySignal[] = [];
  /** Derived vertical caches (active links, live rail, metrics). Written by story/vertical.ts. */
  vertical: VerticalCache;

  // ── Expansion (docs/EXPANSION.md §2.1, §2.4). ──
  /** Skyway bits per tile: 0-3 link mask (N1 E2 S4 W8), bit 4 = ramp. Uint8Array(area). Mutate via setSky/clearSky. Saved (v3). */
  sky: Uint8Array;
  /** ++ on every sky mutation (not saved). SimGrid compares it to rebuild its sky caches. */
  skyVersion = 0;
  /** Wealth hysteresis streak per tile (GrowthSystem writes, wealthInfo reads the sign for ▲/▼). Not saved. */
  wealthStreak: Int8Array;
  /** Save version this world was decoded from (SAVE_VERSION for a new world). Game reads it once (settleWealth, §4.3). */
  loadedVersion = SAVE_VERSION;
  /** Once-per-city moments already shown (§5.4). Saved as SaveData.moments. */
  moments = new Set<MomentId>();

  // ── Megacity districts (docs/MEGACITY.md §3.2). ──
  /** District state (saved as SaveData.districts). Written by world.annex() and Game only. */
  districts: DistrictSave;
  /** 1 = owned, index SlotId. */
  slotOwned: Uint8Array;
  /** Owned row segments as [start, end) index pairs, ascending; owned slots side by side in a row merge into one segment. */
  segs: Int32Array;
  /** Number of ints used in `segs` (2 per segment). */
  segCount = 0;
  /** ++ on every annex (renderer, SimGrid and turf compare it). */
  slotsVersion = 0;
  /** ++ when road / zone / building presence changes (power labels, O2). setLevel and setWealth do not bump it. */
  conductorVersion = 0;
  /**
   * ++ when anything coverage reads changes (O3): building add / remove / stage / crown here; offline, powered,
   * sponsor, look, the Metro network flag and Sky Lobby membership by their writers (WP-1, WP-2).
   */
  coverageVersion = 0;
  /** ++ on every setTerrain (Pump House reclamation); the 'terrain' event carries the rect. */
  terrainVersion = 0;
  /** Tile rect of the owned slots (inclusive). */
  ownedBox: TileRect = { x0: 0, y0: 0, x1: -1, y1: -1 };
  /** Shoals king tide: days left (0 = none). Not saved. */
  tide = 0;
  /** The City life happening in progress (§6.4.1; WP-6), read by the sim while daysLeft > 0. Not saved. */
  cityEvent: CityEventState | null = null;
  /** While set, touch() only grows this rect (World.annex batches its content into one 'tiles' event). */
  private batchRect: TileRect | null = null;

  /**
   * `region` is the region side in slots (MEGACITY §3.1): 3 or 5 for a city, LEGACY_REGION (1) for the 64×64
   * test frame. A fresh World owns only the start slot, with the seed's district layout; its land is blank
   * (World.generate adds terrain).
   */
  constructor(seed: number, cityName = 'Lanthorn Bay', events?: Emitter<GameEventMap>, region: FrameRegion = 3) {
    if (!(region === 3 || region === 5 || region === LEGACY_REGION)) throw new Error(`World region ${region} is not 3, 5 or the legacy frame`);
    const side = SLOT * region;
    const area = side * side;
    this.N = side;
    this.area = area;
    this.region = region;
    this.seed = seed >>> 0;
    this.cityName = cityName;
    this.events = events ?? new Emitter<GameEventMap>();
    this.rng = new Rng(this.seed ^ 0xa5a5a5a5);
    this.tiles = Array.from({ length: area }, blankTile);
    this.fields = makeFields(area);
    this.turf = emptyTurf(area);
    this.rail = new Uint8Array(area);
    this.layers = makeLayers(area);
    this.layerParts = makeLayerParts(area);
    this.vertical = emptyVertical(area);
    this.sky = new Uint8Array(area);
    this.wealthStreak = new Int8Array(area);
    this.story = newStoryState(this.seed);
    this.districts = freshDistricts(this.seed, region);
    this.slotOwned = new Uint8Array(region * region);
    this.slotOwned[startSlot(region)] = 1;
    this.segs = new Int32Array(region * side * 2);
    rebuildSegments(this);
  }

  /**
   * Create a fresh world with generated terrain (`region` as in the constructor): the start slot with today's
   * generator (bit-identical to the 64×64 map for the same seed on either region), every other slot with its kind's.
   */
  static generate(seed: number, cityName?: string, events?: Emitter<GameEventMap>, region: FrameRegion = 3): World {
    const w = new World(seed, cityName, events, region);
    w.generateTerrain();
    return w;
  }

  // ── Indexing ──────────────────────────────────────────────────────────────
  idx(x: number, y: number): number {
    return y * this.N + x;
  }
  inBounds(x: number, y: number): boolean {
    const N = this.N;
    return x >= 0 && y >= 0 && x < N && y < N;
  }
  tileAt(x: number, y: number): Tile | null {
    return this.inBounds(x, y) ? this.tiles[y * this.N + x] : null;
  }

  // ── Districts (MEGACITY §3.2) ─────────────────────────────────────────────
  /** In bounds and its slot is owned. */
  isOwned(x: number, y: number): boolean {
    const N = this.N;
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    return this.slotOwned[(y >> 6) * this.region + (x >> 6)] === 1;
  }
  /** Tile index i is on an owned slot. */
  ownedAt(i: number): boolean {
    if (!(i >= 0 && i < this.area)) return false;
    const N = this.N;
    return this.slotOwned[(((i / N) | 0) >> 6) * this.region + ((i % N) >> 6)] === 1;
  }
  /** The slot of a tile, (y >> 6) * region + (x >> 6); −1 off the map. */
  slotAt(x: number, y: number): SlotId {
    if (!this.inBounds(x, y)) return -1;
    return (y >> 6) * this.region + (x >> 6);
  }
  /** The district kind of a tile's slot ('shore' off the map). */
  kindAt(x: number, y: number): DistrictKind {
    const s = this.slotAt(x, y);
    return s < 0 ? 'shore' : this.districts.kinds[s] ?? 'shore';
  }
  /** The variant of a slot's kind (0 = the kind's own district). */
  variantOf(s: SlotId): DistrictVariant {
    return this.districts.variants?.[s] ?? 0;
  }

  /**
   * Structural annex (§3.2): mark owned, place the district's content (districts/annex.ts) with per-tile events
   * suspended, rebuild segs and ownedBox, then emit one 'tiles' touch for the slot rect and 'annex'. No cost, no
   * rules (Game.annex checks and pays). Content draws from `new Rng(seed ^ ANNEX_SALT[ringKey(slot)])`, never
   * world.rng. A slot already owned or out of range is ignored.
   */
  annex(slot: SlotId): void {
    if (!validSlot(this.region, slot) || this.slotOwned[slot]) return;
    this.slotOwned[slot] = 1;
    this.districts.owned.push(slot);
    this.districts.annexedAt[slot] = this.tick;
    rebuildSegments(this);
    this.slotsVersion++;
    const x0 = slotX(this.region, slot) * SLOT;
    const y0 = slotY(this.region, slot) * SLOT;
    this.batchRect = { x0, y0, x1: x0 + SLOT - 1, y1: y0 + SLOT - 1 };
    try {
      placeAnnexContent(this, slot, new Rng((this.seed ^ ANNEX_SALT[ringKey(this.region, slot)]) >>> 0));
    } finally {
      const r = this.batchRect;
      this.batchRect = null;
      this.conductorVersion++;
      this.coverageVersion++;
      this.touch(r.x0, r.y0, r.x1, r.y1);
    }
    this.events.emit('annex', { slot, kind: this.districts.kinds[slot], variant: this.variantOf(slot) });
  }

  /**
   * Pump House reclamation (§3.2): water → land (or back) on an **owned** tile only. A bridge becomes a road of its
   * kind on land (Alley / Ramp rules hold through storedKind); land → water clears zone, building and ground.
   * Bumps conductorVersion and terrainVersion and emits 'terrain'.
   */
  setTerrain(x: number, y: number, terrain: Terrain) {
    if (!this.isOwned(x, y)) return;
    const t = this.tiles[y * this.N + x];
    if (t.terrain === terrain) return;
    if (terrain === Terrain.Water) {
      if (t.buildingId >= 0) this.removeBuilding(t.buildingId);
      t.zone = ZoneType.None;
      t.level = 0;
      t.abandoned = false;
      t.wealth = 0;
      t.elev = 0;
      t.ground = Ground.Plain;
    }
    t.terrain = terrain;
    if (t.road) t.roadKind = storedKind(t.roadKind, terrain);
    this.conductorVersion++;
    this.terrainVersion++;
    this.touch(x, y, x, y);
    this.events.emit('terrain', { x0: x, y0: y, x1: x, y1: y });
  }

  /** Set a land tile's ground feature (§3.2). Plain on water; ignored on locked tiles. */
  setGround(x: number, y: number, g: Ground) {
    if (!this.isOwned(x, y)) return;
    const t = this.tiles[y * this.N + x];
    const v = (t.terrain === Terrain.Water ? Ground.Plain : g & 3) as Ground;
    if (t.ground === v) return;
    t.ground = v;
    this.touch(x, y, x, y);
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
    const b = this.batchRect;
    if (b) {
      // Batched (World.annex): grow the pending rect; one event at the end.
      b.x0 = Math.min(b.x0, x0);
      b.y0 = Math.min(b.y0, y0);
      b.x1 = Math.max(b.x1, x1);
      b.y1 = Math.max(b.y1, y1);
      return;
    }
    // Expand by 1 so neighbours (road masks, building occlusion) redraw too.
    this.events.emit('tiles', {
      x0: Math.max(0, x0 - 1),
      y0: Math.max(0, y0 - 1),
      x1: Math.min(this.N - 1, x1 + 1),
      y1: Math.min(this.N - 1, y1 + 1),
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
    if (!this.isOwned(x, y)) return;
    const t = this.tiles[y * this.N + x];
    if (t.buildingId >= 0) return;
    if (!t.road) this.conductorVersion++;
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
    if (!this.isOwned(x, y)) return;
    const t = this.tiles[y * this.N + x];
    if (!t.road) return;
    const k = storedKind(kind, t.terrain);
    if (t.roadKind === k) return;
    t.roadKind = k;
    this.touch(x, y, x, y);
  }

  setZone(x: number, y: number, zone: ZoneType) {
    if (!this.isOwned(x, y)) return;
    const t = this.tiles[y * this.N + x];
    if (t.terrain === Terrain.Water || t.buildingId >= 0) return;
    if (t.road || t.zone !== zone) this.conductorVersion++;
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
    if (t.road || t.zone !== ZoneType.None) this.conductorVersion++;
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
    const N = this.N;
    if (!(i >= 0 && i < this.area)) return;
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
    if (!this.ownedAt(i)) {
      // Locked land holds nothing (§3.2): only the sky bits above were written back, and they are cleared too.
      if (this.sky[i]) {
        this.sky[i] = 0;
        this.skyVersion++;
      }
      return;
    }
    this.conductorVersion++;
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
    if (!this.isOwned(x, y)) return;
    const i = y * this.N + x;
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
    const N = this.N;
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
        if (!t || t.terrain === Terrain.Water || t.buildingId >= 0 || !this.isOwned(x + dx, y + dy)) return null;
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
    this.conductorVersion++;
    this.coverageVersion++;
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
    this.conductorVersion++;
    this.coverageVersion++;
    this.touch(b.x, b.y, b.x + b.size - 1, b.y + b.size - 1);
  }

  // ── Story-layer mutators (§11). Structural only: no costs, no rule checks. ──

  /** Set the rail connection mask (N1 E2 S4 W8) of a tile; 0 removes it. Callers keep neighbours consistent. */
  setRail(x: number, y: number, mask: number) {
    if (!this.isOwned(x, y)) return;
    const i = y * this.N + x;
    const m = mask & 15;
    if (this.rail[i] === m) return;
    this.rail[i] = m;
    this.touch(x, y, x, y);
  }

  /** Remove rail from a tile and unhook the neighbours that pointed at it. */
  clearRail(x: number, y: number) {
    if (!this.inBounds(x, y)) return;
    const N = this.N;
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
    // No anchor on a locked tile (§3.2): the link is returned but not stored.
    if (!this.isOwned(link.ax, link.ay) || !this.isOwned(link.bx, link.by)) return link;
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
    this.coverageVersion++;
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
  /** Generate every slot's terrain (districts/terrain.ts): the start slot bit-identical to today's map. */
  private generateTerrain(only?: (s: SlotId) => boolean) {
    const d = this.districts;
    generateRegionTerrain(
      this.tiles,
      this.N,
      this.region,
      this.seed,
      d.kinds,
      d.variants ?? [],
      (k, v) => presetOf(DISTRICTS[k]?.variants, v),
      only,
    );
    this.version++;
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  /**
   * Save version 4 (MEGACITY §3.10): `region`, `size`, `scale`, `districts` and one base64 tile block per owned slot
   * in `districts.owned` order (4096 tiles × 3 bytes, bits 0-23 little-endian, row-major inside the slot). Locked
   * slots are not saved (they regenerate from the seed). Buildings, sky, turf, rail and links are in world coordinates.
   */
  serialize(): SaveData {
    const N = this.N;
    const vals = new Int32Array(BLOCK_TILES);
    const tileBlocks = this.districts.owned.map((s) => {
      const ox = slotX(this.region, s) * SLOT;
      const oy = slotY(this.region, s) * SLOT;
      for (let y = 0; y < SLOT; y++) {
        const row = (oy + y) * N + ox;
        for (let x = 0; x < SLOT; x++) vals[y * SLOT + x] = tileBits(this.tiles[row + x]);
      }
      return encodeBlock(vals);
    });
    const d = this.districts;
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
      buildings: [...this.buildings.values()].map((b) => ({ ...b })),
      news: this.news.slice(-20),
      history: this.budget.history.slice(-12),
      milestones: [...this.milestones],
      savedAt: Date.now(),
      story: encodeStory(this),
      sky: encodeRle(this.sky),
      moments: [...this.moments],
      region: this.region,
      size: N,
      districts: {
        kinds: [...d.kinds],
        variants: [...(d.variants ?? [])],
        owned: [...d.owned],
        grants: d.grants,
        bought: d.bought,
        annexedAt: [...d.annexedAt],
        ...(d.leases ? { leases: { ...d.leases } } : {}),
        epilogueSec: d.epilogueSec ?? 0,
        goalsDone: [...(d.goalsDone ?? [])],
        ruinsRestored: d.ruinsRestored ?? 0,
      },
      tileBlocks,
    };
  }

  /**
   * Load a save (§10.8, MEGACITY §3.10). Accepts every version in SAVE_VERSIONS_SUPPORTED and throws
   * "Incompatible save" for others or a malformed shape. v1–v3 go through `upgradeSave` first (a 3×3 region with the
   * old map in the start slot); `loadedVersion` keeps the original version. A v4 save: `validateSaveShape` (blocks,
   * owned slots, region and size; the legacy 1×1 test frame is accepted here, never by Game's future-save gate or by
   * Import), then the locked slots are generated from the seed and the owned blocks decoded over them. District
   * state is sanitised (unknown or wrong-length kinds → the seed's layout, negative grants → 0, a lease on an unowned
   * or wrong district dropped), and nothing is kept on a locked tile.
   *
   * A v1 save, or a v2 save whose `story` is missing or fails to decode, gets a fresh story with flag `migrated`.
   * Megacity units: `maxPopulation` and `milestones` of a save without `scale` are × POP_SCALE (savePopScale).
   */
  static deserialize(raw: SaveData, events?: Emitter<GameEventMap>, opts?: DecodeOptions): World {
    if (!raw || !SAVE_VERSIONS_SUPPORTED.includes(raw.version)) throw new Error('Incompatible save');
    const loadedVersion = raw.version;
    if (raw.version <= 3 && !(Array.isArray(raw.tiles) && raw.tiles.length === LEGACY_SIZE * LEGACY_SIZE)) throw new Error('Incompatible save');
    const data = raw.version <= 3 ? upgradeSave(raw) : raw;
    const { region } = validateSaveShape(data, { allowLegacy: true });
    const w = new World(data.seed, data.cityName, events, region);
    w.tick = data.tick | 0;
    w.funds = Number(data.funds) || 0;
    w.taxRate = Math.max(0, Math.min(20, Number(data.taxRate) || DEFAULT_TAX));
    // Megacity units (MEGACITY §4.1, §4.4): a save without `scale` counts v3 people (×1).
    const popMul = savePopScale(data);
    w.maxPopulation = Math.round(wholeCount(data.maxPopulation) * popMul);
    w.nextBuildingId = data.nextBuildingId | 0 || 1;
    w.loadedVersion = loadedVersion;
    w.decodeDistricts(data);
    // Locked slots regenerate from the seed; owned slots come from their blocks.
    w.generateTerrain((s) => !w.slotOwned[s]);
    const vals = new Int32Array(BLOCK_TILES);
    const N = w.N;
    data.tileBlocks!.forEach((block, k) => {
      if (!decodeBlock(block, vals)) throw new Error('Incompatible save');
      const s = w.districts.owned[k];
      const ox = slotX(region, s) * SLOT;
      const oy = slotY(region, s) * SLOT;
      for (let y = 0; y < SLOT; y++) {
        const row = (oy + y) * N + ox;
        for (let x = 0; x < SLOT; x++) setTileBits(w.tiles[row + x], vals[y * SLOT + x]);
      }
    });
    const needFacing: Building[] = [];
    for (const b of data.buildings ?? []) {
      if (!b || !BUILDINGS[b.type]) continue;
      const nb: Building = { ...b, size: BUILDINGS[b.type].size, offline: b.offline | 0, powered: !!b.powered };
      // Nothing stands on locked land or off the map (§3.2).
      let inside = Number.isInteger(nb.x) && Number.isInteger(nb.y);
      for (let dy = 0; inside && dy < nb.size; dy++) for (let dx = 0; inside && dx < nb.size; dx++) inside = w.isOwned(nb.x + dx, nb.y + dy);
      if (!inside) continue;
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
      // Megacity fields (§3.2): sponsor on Spires, look 0..3, reclaim on Pump Houses; malformed → dropped.
      if (nb.type !== 'spire' || !(nb.sponsor === 'basalt' || nb.sponsor === 'nacre' || nb.sponsor === 'none')) delete nb.sponsor;
      if (!(nb.look === 0 || nb.look === 1 || nb.look === 2 || nb.look === 3)) delete nb.look;
      if (nb.type !== 'pumphouse') delete nb.reclaim;
      else if (nb.reclaim !== undefined) nb.reclaim = Math.min(90, nonNegInt(nb.reclaim));
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
    // Story (§10.8): v2+ decodes data.story; v1, or a missing / undecodable block, keeps the
    // constructor's fresh story (empty turf, rail, links) and is marked migrated.
    if (!(loadedVersion >= 2 && decodeStory(data.story, w, opts))) {
      // The story starts now, not at tick 0: chapter fallbacks, waivers and the
      // ambient timers count from the load, so an old city doesn't chain-fire Ch1.
      const st = w.story;
      st.flags.migrated = true;
      st.waitingSince = st.chapterTick = st.lastWhisperTick = st.lastNoteTick = w.tick;
    }
    w.clearLocked();
    // Expansion (§2.5): skyways and once-per-city moments (v3+). Missing or malformed → empty.
    if (loadedVersion >= 3) {
      if (decodeRle(data.sky, w.sky, 31)) {
        for (let i = 0; i < w.area; i++) if (w.sky[i] && !w.ownedAt(i)) w.sky[i] = 0;
        w.sanitizeSky();
      }
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

  /** Decode and sanitise SaveData.districts into this world (owned slots were checked by validateSaveShape). */
  private decodeDistricts(data: SaveData): void {
    const R = this.region;
    const n = R * R;
    const raw = (data.districts ?? {}) as Partial<DistrictSave>;
    const seed = seedLayout(this.seed, R);
    const kindsOk = Array.isArray(raw.kinds) && raw.kinds.length === n && raw.kinds.every(isKind) && raw.kinds[startSlot(R)] === 'shore';
    const kinds = kindsOk ? [...(raw.kinds as DistrictKind[])] : seed.kinds;
    const varsOk =
      kindsOk &&
      Array.isArray(raw.variants) &&
      raw.variants.length === n &&
      raw.variants.every((v) => v === 0 || v === 1 || v === 2 || v === 3);
    const variants = varsOk ? [...(raw.variants as DistrictVariant[])] : kindsOk ? seed.variants.map((v, s) => (kinds[s] === seed.kinds[s] ? v : 0)) : seed.variants;
    const owned = [...(raw.owned as SlotId[])];
    const annexedAt = new Array(n).fill(-1);
    if (Array.isArray(raw.annexedAt) && raw.annexedAt.length === n)
      raw.annexedAt.forEach((t, s) => (annexedAt[s] = Number.isFinite(Number(t)) ? Math.trunc(Number(t)) : -1));
    for (let s = 0; s < n; s++) if (!owned.includes(s)) annexedAt[s] = -1;
    for (const s of owned) if (annexedAt[s] < 0) annexedAt[s] = 0;
    const d: DistrictSave = {
      kinds,
      variants,
      owned,
      grants: nonNegInt(raw.grants),
      bought: nonNegInt(raw.bought),
      annexedAt,
      epilogueSec: Number.isFinite(Number(raw.epilogueSec)) ? Math.max(0, Number(raw.epilogueSec)) : 0,
      goalsDone: Array.isArray(raw.goalsDone) ? raw.goalsDone.filter((g) => typeof g === 'string') : [],
      ruinsRestored: nonNegInt(raw.ruinsRestored),
    };
    // The lease belongs to an owned Tarmac Reach (variant 0) only.
    const lease = raw.leases?.tarmac;
    if ((lease === 'nacre' || lease === 'basalt') && owned.some((s) => kinds[s] === 'tarmac' && (variants[s] ?? 0) === 0)) d.leases = { tarmac: lease };
    this.districts = d;
    this.slotOwned.fill(0);
    for (const s of owned) this.slotOwned[s] = 1;
    rebuildSegments(this);
  }

  /** Drop anything on locked land (§3.2 invariants): roads, zones, rail, sky, turf and link anchors. */
  private clearLocked(): void {
    const N = this.N;
    for (let i = 0; i < this.area; i++) {
      if (this.ownedAt(i)) continue;
      const t = this.tiles[i];
      t.road = false;
      t.roadKind = RoadKind.Street;
      t.zone = ZoneType.None;
      t.level = 0;
      t.abandoned = false;
      t.wealth = 0;
      t.buildingId = -1;
      this.rail[i] = 0;
      this.sky[i] = 0;
      this.turf.owner[i] = 0;
      this.turf.str[i] = 0;
      this.turf.contested[i] = 0;
    }
    if (this.links.length) this.links = this.links.filter((l) => this.isOwned(l.ax, l.ay) && this.isOwned(l.bx, l.by));
    // Rail links into locked land go too.
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const m = this.rail[i];
        if (!m) continue;
        let k = m;
        if (m & 1 && !this.isOwned(x, y - 1)) k &= ~1;
        if (m & 2 && !this.isOwned(x + 1, y)) k &= ~2;
        if (m & 4 && !this.isOwned(x, y + 1)) k &= ~4;
        if (m & 8 && !this.isOwned(x - 1, y)) k &= ~8;
        this.rail[i] = k;
      }
  }

  /**
   * One pass over world.sky (§2.5): clear link bits that point off the map or at a neighbour
   * that doesn't link back; keep the ramp bit only with exactly one link (the ground is not
   * checked: an inactive ramp stays a ramp); a tile left with no link is cleared.
   */
  private sanitizeSky() {
    const s = this.sky;
    const N = this.N;
    // Links first (judged against the decoded bits), then the ramp / empty rule.
    const linked = new Uint8Array(this.area);
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
    for (let i = 0; i < this.area; i++) s[i] = saneSky(linked[i]);
    this.skyVersion++;
  }
}
