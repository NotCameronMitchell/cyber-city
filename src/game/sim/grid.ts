// ─────────────────────────────────────────────────────────────────────────────
// SimGrid: a typed-array mirror of the world's tiles plus derived lookups
// (road access, nearest road, static terrain value). Refreshed once per tick
// by scan(); every other system reads these flat arrays instead of chasing
// Tile objects, which keeps the hot loops cache-friendly and allocation-free.
//
// Expansion (docs/EXPANSION.md §3.3, §3.7–§3.10): road kinds and the access
// rule (roads.computeAccess), per-kind counts, highway components and their
// ramp reach, the skyway network (components, tile list, active-ramp reach,
// docks re-derived every scan), static road neighbourhood terms (roadLv,
// roadCrime, alleyNear, highway / skyway noise) and regional edge links.
// The road caches rebuild only when the road signature (index, kind) changes;
// the sky caches when world.skyVersion or the road signature changes.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, DISTRICTS, EDGE_LINKS, NOISE, ROAD_ACCESS_RANGE, ROAD_EFFECTS, ROAD_FLOW, ROAD_KINDS, RUINS, SKYWAY } from '../config';
import { fbm } from '../rng';
import { KIND_NONE } from '../roads';
import { Ground, RoadKind, Terrain, ZoneType, type Building } from '../types';
import type { World } from '../world';
import { OwnedLayout } from './owned';
import { LV_NOISE, LV_WATER, WATER_VIEW_RANGE } from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops. The frame (N, area) is per world (MEGACITY
// §3.1): each method copies this.N / this.area into locals.
const RANGE = ROAD_ACCESS_RANGE;
const WATER = Terrain.Water;
const NONE = ZoneType.None;
const K_NONE = KIND_NONE;
const STREET = RoadKind.Street;
const AVENUE = RoadKind.Avenue;
const HIGHWAY = RoadKind.Highway;
const ALLEY = RoadKind.Alley;
const RAMP = RoadKind.Ramp;
const HW_REACH = ROAD_FLOW.highwayReach;
const SKY_REACH = SKYWAY.reach;
const FX = { ...ROAD_EFFECTS };
const SKY = { ...SKYWAY };
const NZ = { ...NOISE };
const EDGE = { ...EDGE_LINKS };
/** Building types a skyway can dock into (`skyAnchor`). */
const ANCHOR: Record<string, boolean> = {};
for (const def of Object.values(BUILDINGS)) ANCHOR[def.type] = !!def.skyAnchor;
/** Edge-link points per road kind (§3.10): Street 1, Avenue 2, Highway 3, Alley and Ramp 0. */
const EDGE_POINTS = [EDGE.street, EDGE.avenue, EDGE.highway, 0, 0];
/** No component (the sentinel above every component id; ids are < area / 2). */
const NO_COMP = 0x7fffffff;
/** Sky bits (world.sky): links N1 E2 S4 W8, ramp 16. */
const SKY_LINKS = 15;
const SKY_RAMP = 16;
/** roadDist value for tiles with no road access (computeAccess's "none"). */
export const NO_ROAD = 255;
/** Access seeds in order (roads.computeAccess): every Avenue, then every Ramp, then every Street. */
const SEED_KINDS = [RoadKind.Avenue, RoadKind.Ramp, RoadKind.Street];

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Is this kind a ground road lots can front onto (everything but the Highway, and not "no road")? */
const frontableKind = (k: number): boolean => k !== K_NONE && k !== HIGHWAY;
/** Can a sky ramp touch down on this ground kind (Street, Avenue, Ramp)? */
const rampGround = (k: number): boolean => k === STREET || k === AVENUE || k === RAMP;
/** roads.roadLinks on a kinds array (K_NONE never links). */
const links = (a: number, b: number): boolean => {
  if (a === K_NONE || b === K_NONE) return false;
  const ha = a === HIGHWAY;
  const hb = b === HIGHWAY;
  if (ha === hb) return true;
  return (ha ? b : a) === RAMP;
};

export class SimGrid {
  /** ZoneType per tile. */
  readonly zone: Uint8Array;
  /** Development level 0..3. */
  readonly level: Uint8Array;
  /** 1 = abandoned developed zone. */
  readonly abandoned: Uint8Array;
  /** 1 = road / bridge (any kind). */
  readonly road: Uint8Array;
  /** Ground road kind per tile, KIND_NONE (255) where there is no ground road. */
  readonly kind: Uint8Array;
  /** Wealth tier per tile (0..2; growth keeps it in sync within a tick). */
  readonly wealth: Uint8Array;
  /** 1 = water terrain. */
  readonly water: Uint8Array;
  /** Building id covering the tile, -1 = none. */
  readonly bld: Int32Array;
  /** Access distance (§3.3): Chebyshev steps to the claiming road, NO_ROAD without access. */
  readonly roadDist: Uint8Array;
  /** Index of the claiming road tile (a frontable road, or an alley for alley-only lots), -1 if none. */
  readonly nearestRoad: Int32Array;
  /** Indices of every zoned tile (any level), ascending; first `zonedCount` entries are valid. */
  readonly zoned: Int32Array;
  zonedCount = 0;
  /**
   * The power grid's tile flags (PowerGrid.powered: 1 where Tile.powered is true after every compute), linked by the
   * Simulation, so the hot zoned sweeps read a typed array instead of the Tile objects. Null on a bare grid.
   */
  powered: Uint8Array | null = null;
  roadCount = 0;
  bridgeCount = 0;
  /** Ground road tiles by kind and terrain: index kind * 2 + (water ? 1 : 0). */
  readonly kindCount = new Int32Array(10);
  /** Static land value contribution from terrain (water views + gentle noise). */
  readonly terrainValue: Float32Array;
  /** Snapshot of world.buildings (array reused between ticks). */
  readonly buildings: Building[] = [];
  // ── Megacity (MEGACITY §3.3) ──────────────────────────────────────────────
  /** Ground per tile (Ground: Plain, Reed, Brownfield, Rubble), owned land only. */
  readonly ground: Uint8Array;
  /**
   * Blight weight of an abandoned tile (1; a ruin, ground Rubble, RUINS.blightWeight), 0 elsewhere. The
   * neighbourhood pass reads it, so an all-Plain city is unchanged.
   */
  readonly blightW: Float32Array;
  /**
   * Highest level a zone tile may reach (MEGACITY §3.3 floodplain): a district kind's floodplainMaxLevel on land
   * within 1 of water (Reedmere), 3 elsewhere. Growth caps it only while resilience is 0.
   */
  readonly floodCap: Uint8Array;
  /** The owned frame every loop and stencil here walks (O1). The Simulation shares it with its other systems. */
  readonly layout: OwnedLayout;
  /** The static noise term of terrainValue (art coordinates), per owned slot once (−1 slots not yet computed). */
  private readonly lvNoise: Float64Array;
  private readonly noiseDone: Uint8Array;
  /** slotsVersion / terrainVersion terrainValue was computed for. */
  private terrainSeen = -1;
  private terrainSlots = -1;
  /** world.conductorVersion as of the last scanBegin: the power labels are cached on it (O2). */
  conductorSeen = -1;
  /** Scan accumulators (banded scans run over several calls). */
  private scanSig = 0;
  private scanRoads = 0;
  private scanBridges = 0;
  private scanZc = 0;

  // ── Road caches (rebuilt when the road signature changes) ─────────────────
  /** Linked 4-neighbours of each ground road tile (N1 E2 S4 W8, roadLinks), 0 elsewhere. */
  readonly linkMask: Uint8Array;
  /** 1 where an Alley lies within ROAD_EFFECTS.radius (affordable quarter, §4.4). */
  readonly alleyNear: Uint8Array;
  /** Static land value from road kinds and skyways (§3.8): avenue +, alley −, under a deck −, near an active sky ramp +. */
  readonly roadLv: Float32Array;
  /** Static crime from road kinds (§3.8): alley +, avenue −. */
  readonly roadCrime: Float32Array;
  /** Static noise from highways and skyways, max-combined (§3.9). Buildings add theirs per pass. */
  readonly roadNoise: Float32Array;
  /** Highway component of each Highway tile (4-neighbour), -1 elsewhere. */
  readonly hwComp: Int32Array;
  /** Highway tiles per component, and Ramp tiles touching it. */
  readonly hwTiles: Int32Array;
  readonly hwRamps: Int32Array;
  hwCompCount = 0;
  /** Every Highway tile index (ascending). */
  readonly hwList: Uint32Array;
  hwListLen = 0;
  /** Frontable road tiles within ROAD_FLOW.highwayReach road steps of an on-ramp: the highway component they divert into, -1 elsewhere. */
  readonly hwReach: Int32Array;
  /** Road steps from that on-ramp (0 at the ramp). */
  readonly hwDepth: Uint8Array;
  /** Tiles with hwReach ≥ 0 (BFS order). */
  readonly hwReachList: Uint32Array;
  hwReachLen = 0;
  /** Regional link points (§3.10, MEGACITY §3.5: on the owned boundary), capped at 12 + 4 per district after the first. */
  edgePoints = 0;
  /** world.slotsVersion the edge points were counted for (an annex moves the boundary). */
  private slotsSeen = -1;

  // ── Sky caches (rebuilt when world.skyVersion or the road signature changes) ──
  /** Skyway component of each sky tile (mutual links), -1 elsewhere. */
  readonly skyComp: Int32Array;
  /** Sky tiles per component, and active ramps on it. */
  readonly skyTiles: Int32Array;
  readonly skyRamps: Int32Array;
  skyCompCount = 0;
  /** Every sky tile index (ascending). */
  readonly skyList: Uint32Array;
  skyCount = 0;
  /** Frontable ground roads within SKYWAY.reach road steps of an active sky ramp: the sky component they divert into, -1 elsewhere. */
  readonly skyReach: Int32Array;
  readonly skyDepth: Uint8Array;
  readonly skyReachList: Uint32Array;
  skyReachLen = 0;

  // ── Docks (re-derived every scan, O(sky tiles)) ───────────────────────────
  /** Docked skyAnchor buildings per sky component this scan. */
  readonly skyDocks: Int32Array;
  /** Building id → the sky component docking it (the lowest-index deck tile's). */
  readonly dockOf = new Map<number, number>();

  private roadSig = 0x7fffffff;
  /** layout.version the road caches were built for: an annex rebuilds them (access may now reach the new land). */
  private roadsLayout = -1;
  /** world.skyVersion the sky caches were built for (−1: never, so a deserialized world always builds them). */
  private skySeen = -1;
  private readonly queue: Int32Array;
  private readonly mark: Uint8Array;

  /** The frame this grid mirrors (MEGACITY §3.1): the world's side and tile count. */
  readonly N: number;
  readonly area: number;

  constructor(world: World) {
    const area = world.area;
    // At most this many components of one kind (a 4-neighbour checkerboard).
    const maxComp = area >> 1;
    this.N = world.N;
    this.area = area;
    this.zone = new Uint8Array(area);
    this.level = new Uint8Array(area);
    this.abandoned = new Uint8Array(area);
    this.road = new Uint8Array(area);
    this.kind = new Uint8Array(area);
    this.wealth = new Uint8Array(area);
    this.water = new Uint8Array(area);
    this.bld = new Int32Array(area);
    this.roadDist = new Uint8Array(area);
    this.nearestRoad = new Int32Array(area);
    this.zoned = new Int32Array(area);
    this.terrainValue = new Float32Array(area);
    this.linkMask = new Uint8Array(area);
    this.alleyNear = new Uint8Array(area);
    this.roadLv = new Float32Array(area);
    this.roadCrime = new Float32Array(area);
    this.roadNoise = new Float32Array(area);
    this.hwComp = new Int32Array(area);
    this.hwTiles = new Int32Array(maxComp);
    this.hwRamps = new Int32Array(maxComp);
    this.hwList = new Uint32Array(area);
    this.hwReach = new Int32Array(area);
    this.hwDepth = new Uint8Array(area);
    this.hwReachList = new Uint32Array(area);
    this.skyComp = new Int32Array(area);
    this.skyTiles = new Int32Array(maxComp);
    this.skyRamps = new Int32Array(maxComp);
    this.skyList = new Uint32Array(area);
    this.skyReach = new Int32Array(area);
    this.skyDepth = new Uint8Array(area);
    this.skyReachList = new Uint32Array(area);
    this.skyDocks = new Int32Array(maxComp);
    this.queue = new Int32Array(area);
    this.mark = new Uint8Array(area);
    this.ground = new Uint8Array(area);
    this.blightW = new Float32Array(area);
    this.floodCap = new Uint8Array(area).fill(3);
    this.lvNoise = new Float64Array(area);
    this.noiseDone = new Uint8Array(world.region * world.region);
    // Locked land is never scanned (O1): it reads as no road, no building, no access, no component.
    this.kind.fill(K_NONE);
    this.bld.fill(-1);
    this.nearestRoad.fill(-1);
    this.roadDist.fill(NO_ROAD);
    this.hwComp.fill(-1);
    this.hwReach.fill(-1);
    this.skyComp.fill(-1);
    this.skyReach.fill(-1);
    this.layout = new OwnedLayout(world);
    this.layout.sync(world);
    this.syncTerrain(world);
  }

  /**
   * Mirror world tiles into the typed arrays (owned land only, O1). `forceRoads` rebuilds the road and sky caches
   * even if they look unchanged. The whole scan; the Simulation's day runs it in row bands (scanBegin, scanRows,
   * scanEnd), which compute exactly the same.
   */
  scan(world: World, forceRoads = false): void {
    this.scanBegin(world);
    this.scanRows(world, this.layout.y0, this.layout.y1, false);
    this.scanEnd(world, forceRoads);
  }

  /** Start a scan: the owned frame and terrain value follow annexes and terrain changes; the accumulators reset. */
  scanBegin(world: World): void {
    if (this.layout.sync(world)) this.slotsSeen = -1;
    this.conductorSeen = world.conductorVersion;
    this.syncTerrain(world);
    this.scanSig = 0;
    this.scanRoads = 0;
    this.scanBridges = 0;
    this.scanZc = 0;
    this.kindCount.fill(0);
  }

  /**
   * Mirror owned rows y0..y1 (inclusive; call in ascending row order after scanBegin). `ages`: count the day's
   * tile ages here (zoned, road and building tiles, MEGACITY §3.3), so the day reads each Tile once.
   */
  scanRows(world: World, y0: number, y1: number, ages: boolean): void {
    const tiles = world.tiles;
    const { zone, level, abandoned, road, kind, wealth, water, bld, zoned, kindCount, ground, blightW, area } = this;
    const { ck, rowAt } = this.layout.all;
    if (y1 < y0) return;
    // Road fingerprint stride: kind × 2·area keeps (index, kind) → value one-to-one at any size.
    const kStride = area * 2;
    const ruinW = RUINS.blightWeight;
    let sig = this.scanSig;
    let roads = this.scanRoads;
    let bridges = this.scanBridges;
    let zc = this.scanZc;
    for (let c = rowAt[y0]; c < rowAt[y1 + 1]; c += 3)
      for (let i = ck[c], e = ck[c + 1]; i < e; i++) {
        const t = tiles[i];
        const z = t.zone;
        zone[i] = z;
        level[i] = t.level;
        const ab = t.abandoned ? 1 : 0;
        abandoned[i] = ab;
        wealth[i] = t.wealth;
        const w = t.terrain === WATER ? 1 : 0;
        water[i] = w;
        const id = t.buildingId;
        bld[i] = id;
        const gr = t.ground;
        ground[i] = gr;
        blightW[i] = ab ? (gr === Ground.Rubble ? ruinW : 1) : 0;
        if (t.road) {
          const k = t.roadKind;
          road[i] = 1;
          kind[i] = k;
          kindCount[k * 2 + w]++;
          roads++;
          if (w) bridges++;
          // Order-independent fingerprint of the road set and kinds.
          sig = (sig + Math.imul(i + 1 + k * kStride, 0x9e3779b1)) | 0;
          if (ages && t.age < 9999) t.age++;
        } else {
          road[i] = 0;
          kind[i] = K_NONE;
          if (ages && (z !== NONE || id >= 0) && t.age < 9999) t.age++;
        }
        if (z !== NONE) zoned[zc++] = i;
      }
    this.scanSig = sig;
    this.scanRoads = roads;
    this.scanBridges = bridges;
    this.scanZc = zc;
  }

  /** Finish a scan: counts, the building snapshot, and the road / sky caches when they changed. */
  scanEnd(world: World, forceRoads = false): void {
    if (this.scanFinish(world, forceRoads)) this.scanCaches(world, forceRoads);
  }

  /**
   * The cheap half of scanEnd (counts, the building snapshot, the road signature, docks when nothing changed).
   * Returns true when the road or sky caches must rebuild: then call scanCaches (the day runs it as its own step).
   */
  scanFinish(world: World, forceRoads: boolean): boolean {
    this.zonedCount = this.scanZc;
    this.roadCount = this.scanRoads;
    this.bridgeCount = this.scanBridges;
    const sig = (this.scanSig ^ Math.imul(this.scanRoads, 0x85ebca6b)) | 0;
    this.scanSig = sig;
    const list = this.buildings;
    list.length = 0;
    for (const b of world.buildings.values()) list.push(b);
    const roadsChanged = forceRoads || sig !== this.roadSig || this.layout.version !== this.roadsLayout;
    const pending = roadsChanged || world.slotsVersion !== this.slotsSeen || world.skyVersion !== this.skySeen;
    if (!pending) this.findDocks(world);
    return pending;
  }

  /** The heavy half of scanEnd: access, road caches, edge links, sky caches, docks (only when something changed). */
  scanCaches(world: World, forceRoads: boolean): void {
    const sig = this.scanSig;
    let roadsChanged = false;
    if (forceRoads || sig !== this.roadSig || this.layout.version !== this.roadsLayout) {
      this.roadSig = sig;
      this.roadsLayout = this.layout.version;
      roadsChanged = true;
      this.computeAccessOwned();
      this.buildRoadCaches();
    }
    if (roadsChanged || world.slotsVersion !== this.slotsSeen) this.computeEdgePoints(world);
    if (roadsChanged || world.skyVersion !== this.skySeen) {
      this.skySeen = world.skyVersion;
      this.buildSkyCaches(world);
      this.buildStaticTerms(world);
    }
    this.findDocks(world);
    // The affordable-quarter flag is a world field so wealth.ts and the inspect panel can read it.
    if (roadsChanged) world.fields.alleyNear.set(this.alleyNear);
  }

  /**
   * The access rule (EXPANSION §3.3, roads.computeAccess) on owned land: a locked tile is off the map (MEGACITY
   * §3.3, O1), so the BFS never steps through a locked district. On one district (or any convex owned land with
   * no locked corner) it equals roads.computeAccess exactly.
   */
  private computeAccessOwned(): void {
    const { kind, roadDist: dist, nearestRoad: near, queue, N, layout } = this;
    const mask = layout.mask;
    const { ck, rowAt } = layout.all;
    const end = rowAt[N];
    dist.fill(NO_ROAD);
    near.fill(-1);
    let head = 0;
    let tail = 0;
    for (const k of SEED_KINDS)
      for (let c = 0; c < end; c += 3)
        for (let i = ck[c], e = ck[c + 1]; i < e; i++)
          if (kind[i] === k) {
            dist[i] = 0;
            near[i] = i;
            queue[tail++] = i;
          }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= RANGE) continue;
      const x = i % N;
      const y = (i / N) | 0;
      const src = near[i];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= N) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= N || (dx === 0 && dy === 0)) continue;
          const j = ny * N + nx;
          if (dist[j] !== NO_ROAD || !mask[j]) continue;
          dist[j] = d + 1;
          near[j] = src;
          queue[tail++] = j;
        }
      }
    }
    // Pass B: alleys reach 1 tile and only where nothing else does.
    for (let c = 0; c < end; c += 3)
      for (let a = ck[c], e = ck[c + 1]; a < e; a++) {
        if (kind[a] !== ALLEY) continue;
        if (dist[a] === NO_ROAD) {
          dist[a] = 0;
          near[a] = a;
        }
        const x = a % N;
        const y = (a / N) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= N) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= N || (dx === 0 && dy === 0)) continue;
            const j = ny * N + nx;
            if (dist[j] === NO_ROAD && mask[j]) {
              dist[j] = 1;
              near[j] = a;
            }
          }
        }
      }
  }

  /** Developed (level ≥ 1) and occupied zone tile? */
  developed(i: number): boolean {
    return this.level[i] > 0 && this.zone[i] !== NONE && this.abandoned[i] === 0;
  }

  /** True if (index) has road access (§3.3: a street, avenue or ramp within 3, or an alley within 1). */
  hasRoad(i: number): boolean {
    return this.roadDist[i] <= RANGE;
  }

  /** Ground road tiles of a kind (bridges included). */
  kindTiles(k: RoadKind): number {
    return this.kindCount[k * 2] + this.kindCount[k * 2 + 1];
  }

  /**
   * The road tile a building's trips land on (§3.8): the centre's claiming road for size ≤ 2;
   * for size ≥ 3 the footprint perimeter tile with the smallest access distance (ties: lowest
   * index). -1 when the building has no access.
   */
  accessRoad(b: Building): number {
    const N = this.N;
    const near = this.nearestRoad;
    if (b.size <= 2) return near[(b.y + (b.size >> 1)) * N + b.x + (b.size >> 1)];
    const dist = this.roadDist;
    let best = -1;
    let bestD = 256;
    const x0 = b.x;
    const y0 = b.y;
    const x1 = b.x + b.size - 1;
    const y1 = b.y + b.size - 1;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= N) continue;
      const edgeRow = y === y0 || y === y1;
      for (let x = x0; x <= x1; x += edgeRow ? 1 : x1 - x0) {
        if (x < 0 || x >= N) continue;
        const i = y * N + x;
        const d = dist[i];
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best >= 0 && bestD !== NO_ROAD ? near[best] : -1;
  }

  // ── Road caches ───────────────────────────────────────────────────────────

  /** Link masks, alley flags, highway components and ramp reach, edge points (§3.2, §3.8, §3.10). */
  private buildRoadCaches(): void {
    const { kind, linkMask, alleyNear, hwComp, hwTiles, hwRamps, hwList, hwReach, hwDepth, hwReachList, queue, N, area } = this;
    // Owned land only (O1): locked tiles hold no road, so their link mask stays 0 and they seed nothing.
    const { ck, rowAt } = this.layout.all;
    const end = rowAt[N];

    // Link masks (roadLinks).
    for (let c = 0; c < end; c += 3)
      for (let i = ck[c], e = ck[c + 1]; i < e; i++) {
        const k = kind[i];
        if (k === K_NONE) {
          linkMask[i] = 0;
          continue;
        }
        const x = i % N;
        let m = 0;
        if (i >= N && links(k, kind[i - N])) m |= 1;
        if (x < N - 1 && links(k, kind[i + 1])) m |= 2;
        if (i < area - N && links(k, kind[i + N])) m |= 4;
        if (x > 0 && links(k, kind[i - 1])) m |= 8;
        linkMask[i] = m;
      }

    // Alley within ROAD_EFFECTS.radius.
    alleyNear.fill(0);
    const R = FX.radius;
    for (let c = 0; c < end; c += 3)
      for (let a = ck[c], e = ck[c + 1]; a < e; a++) {
        if (kind[a] !== ALLEY) continue;
        const ax = a % N;
        const ay = (a / N) | 0;
        for (let y = Math.max(0, ay - R); y <= Math.min(N - 1, ay + R); y++)
          for (let x = Math.max(0, ax - R); x <= Math.min(N - 1, ax + R); x++) alleyNear[y * N + x] = 1;
      }

    // Highway components (4-neighbour over Highway tiles only).
    hwComp.fill(-1);
    let comps = 0;
    let hl = 0;
    for (let c0 = 0; c0 < end; c0 += 3)
      for (let s = ck[c0], e = ck[c0 + 1]; s < e; s++) {
        if (kind[s] !== HIGHWAY) continue;
        hwList[hl++] = s;
        if (hwComp[s] !== -1) continue;
        const c = comps++;
        hwTiles[c] = 0;
        hwRamps[c] = 0;
        let head = 0;
        let tail = 0;
        queue[tail++] = s;
        hwComp[s] = c;
        while (head < tail) {
          const i = queue[head++];
          hwTiles[c]++;
          const x = i % N;
          if (i >= N) tail = this.joinHw(i - N, c, tail);
          if (x < N - 1) tail = this.joinHw(i + 1, c, tail);
          if (i < area - N) tail = this.joinHw(i + N, c, tail);
          if (x > 0) tail = this.joinHw(i - 1, c, tail);
        }
      }
    this.hwCompCount = comps;
    this.hwListLen = hl;

    // Ramp reach: multi-source BFS over frontable ground roads from every Ramp that touches a
    // highway (carrying that highway's component; the lowest id if it touches two).
    hwReach.fill(-1);
    hwDepth.fill(255);
    let head = 0;
    let tail = 0;
    for (let c0 = 0; c0 < end; c0 += 3)
      for (let i = ck[c0], e = ck[c0 + 1]; i < e; i++) {
        if (kind[i] !== RAMP) continue;
        const x = i % N;
        let c = NO_COMP;
        if (i >= N && hwComp[i - N] >= 0 && hwComp[i - N] < c) c = hwComp[i - N];
        if (x < N - 1 && hwComp[i + 1] >= 0 && hwComp[i + 1] < c) c = hwComp[i + 1];
        if (i < area - N && hwComp[i + N] >= 0 && hwComp[i + N] < c) c = hwComp[i + N];
        if (x > 0 && hwComp[i - 1] >= 0 && hwComp[i - 1] < c) c = hwComp[i - 1];
        if (c === NO_COMP) continue;
        hwReach[i] = c;
        hwDepth[i] = 0;
        queue[tail++] = i;
      }
    // Ramps per highway component (every ramp touching it counts once for each component it touches).
    for (let c0 = 0; c0 < end; c0 += 3)
      for (let i = ck[c0], e = ck[c0 + 1]; i < e; i++) {
        if (kind[i] !== RAMP) continue;
        const x = i % N;
        const a = i >= N ? hwComp[i - N] : -1;
        const b = x < N - 1 ? hwComp[i + 1] : -1;
        const cc = i < area - N ? hwComp[i + N] : -1;
        const d = x > 0 ? hwComp[i - 1] : -1;
        if (a >= 0) hwRamps[a]++;
        if (b >= 0 && b !== a) hwRamps[b]++;
        if (cc >= 0 && cc !== a && cc !== b) hwRamps[cc]++;
        if (d >= 0 && d !== a && d !== b && d !== cc) hwRamps[d]++;
      }
    this.hwReachLen = this.reachBfs(hwReach, hwDepth, hwReachList, head, tail, HW_REACH);
  }

  /**
   * Regional links (EXPANSION §3.10 with "map border" read as the owned boundary, MEGACITY §3.5): a land road on an
   * owned tile whose outward 4-neighbour is off the map or in a locked slot, and whose inward neighbour (opposite it)
   * is a road it links to. Points per kind, capped at 12 + 4 per district after the first. On a one-district city
   * the boundary is the start slot's edge, so a migrated v3 city keeps exactly its links.
   */
  private computeEdgePoints(world: World): void {
    this.slotsSeen = world.slotsVersion;
    const { N, kind, water } = this;
    const segs = world.segs;
    const open = (x: number, y: number) => !world.isOwned(x, y);
    let pts = 0;
    for (let s = 0; s < world.segCount; s += 2)
      for (let i = segs[s]; i < segs[s + 1]; i++) {
        const k = kind[i];
        if (k === K_NONE || water[i]) continue;
        const x = i % N;
        const y = (i / N) | 0;
        if (
          (open(x, y - 1) && y + 1 < N && links(k, kind[i + N])) ||
          (open(x, y + 1) && y > 0 && links(k, kind[i - N])) ||
          (open(x - 1, y) && x + 1 < N && links(k, kind[i + 1])) ||
          (open(x + 1, y) && x > 0 && links(k, kind[i - 1]))
        )
          pts += EDGE_POINTS[k] ?? 0;
      }
    const cap = EDGE.cap + EDGE.perDistrict * Math.max(0, world.districts.owned.length - 1);
    this.edgePoints = pts > cap ? cap : pts;
  }

  private joinHw(j: number, c: number, tail: number): number {
    if (this.kind[j] !== HIGHWAY || this.hwComp[j] !== -1) return tail;
    this.hwComp[j] = c;
    this.queue[tail] = j;
    return tail + 1;
  }

  /**
   * Continue a seeded multi-source BFS (queue[head..tail) already holds depth-0 seeds with
   * `comp` set) over frontable ground roads, 4-neighbour, first claim wins, depth ≤ `reach`.
   * Fills `list` with every claimed tile in BFS order and returns its length.
   */
  private reachBfs(comp: Int32Array, depth: Uint8Array, list: Uint32Array, head: number, tail: number, reach: number): number {
    const { N, area } = this;
    const q = this.queue;
    const kind = this.kind;
    let n = 0;
    while (head < tail) {
      const i = q[head++];
      list[n++] = i;
      const d = depth[i];
      if (d >= reach) continue;
      const c = comp[i];
      const x = i % N;
      for (let s = 0; s < 4; s++) {
        let j: number;
        if (s === 0) {
          if (i < N) continue;
          j = i - N;
        } else if (s === 1) {
          if (x >= N - 1) continue;
          j = i + 1;
        } else if (s === 2) {
          if (i >= area - N) continue;
          j = i + N;
        } else {
          if (x <= 0) continue;
          j = i - 1;
        }
        if (comp[j] !== -1 || !frontableKind(kind[j])) continue;
        comp[j] = c;
        depth[j] = d + 1;
        q[tail++] = j;
      }
    }
    return n;
  }

  // ── Sky caches ────────────────────────────────────────────────────────────

  /** Sky components (mutual links), the sky tile list, active ramps and their ground reach (§3.7). */
  private buildSkyCaches(world: World): void {
    const sky = world.sky;
    const { kind, skyComp, skyTiles, skyRamps, skyList, skyReach, skyDepth, skyReachList, queue, N, area } = this;
    skyComp.fill(-1);
    let comps = 0;
    let n = 0;
    const { ck, rowAt } = this.layout.all;
    const end = rowAt[N];
    for (let c0 = 0; c0 < end; c0 += 3)
      for (let s = ck[c0], e = ck[c0 + 1]; s < e; s++) {
        if ((sky[s] & SKY_LINKS) === 0) continue;
        skyList[n++] = s;
        if (skyComp[s] !== -1) continue;
        const c = comps++;
        skyTiles[c] = 0;
        skyRamps[c] = 0;
        let head = 0;
        let tail = 0;
        queue[tail++] = s;
        skyComp[s] = c;
        while (head < tail) {
          const i = queue[head++];
          skyTiles[c]++;
          const m = sky[i];
          if ((m & SKY_RAMP) !== 0 && rampGround(kind[i])) skyRamps[c]++;
          const x = i % N;
          if (m & 1 && i >= N && sky[i - N] & 4 && skyComp[i - N] === -1) {
            skyComp[i - N] = c;
            queue[tail++] = i - N;
          }
          if (m & 2 && x < N - 1 && sky[i + 1] & 8 && skyComp[i + 1] === -1) {
            skyComp[i + 1] = c;
            queue[tail++] = i + 1;
          }
          if (m & 4 && i < area - N && sky[i + N] & 1 && skyComp[i + N] === -1) {
            skyComp[i + N] = c;
            queue[tail++] = i + N;
          }
          if (m & 8 && x > 0 && sky[i - 1] & 2 && skyComp[i - 1] === -1) {
            skyComp[i - 1] = c;
            queue[tail++] = i - 1;
          }
        }
      }
    this.skyCompCount = comps;
    this.skyCount = n;

    // Active-ramp reach: BFS over frontable ground roads from the ground under each active ramp.
    skyReach.fill(-1);
    skyDepth.fill(255);
    let tail = 0;
    for (let k = 0; k < n; k++) {
      const i = skyList[k];
      if ((sky[i] & SKY_RAMP) === 0 || !rampGround(kind[i])) continue;
      skyReach[i] = skyComp[i];
      skyDepth[i] = 0;
      queue[tail++] = i;
    }
    this.skyReachLen = this.reachBfs(skyReach, skyDepth, skyReachList, 0, tail, SKY_REACH);
  }

  /** roadLv, roadCrime and the static road / skyway noise (§3.8, §3.9). */
  private buildStaticTerms(world: World): void {
    const { kind, roadLv, roadCrime, roadNoise, alleyNear, mark, skyList, skyCount, N } = this;
    const sky = world.sky;
    const { ck, rowAt } = this.layout.all;
    const end = rowAt[N];
    // Avenue within the effect radius (mark = 1).
    mark.fill(0);
    const R = FX.radius;
    for (let c = 0; c < end; c += 3)
      for (let a = ck[c], e = ck[c + 1]; a < e; a++) {
        if (kind[a] !== AVENUE) continue;
        const ax = a % N;
        const ay = (a / N) | 0;
        for (let y = Math.max(0, ay - R); y <= Math.min(N - 1, ay + R); y++)
          for (let x = Math.max(0, ax - R); x <= Math.min(N - 1, ax + R); x++) mark[y * N + x] = 1;
      }
    for (let c = 0; c < end; c += 3)
      for (let i = ck[c], e = ck[c + 1]; i < e; i++) {
        const av = mark[i];
        const al = alleyNear[i];
        roadLv[i] = (av ? FX.avenueLv : 0) + (al ? FX.alleyLv : 0) + (sky[i] & SKY_LINKS ? SKY.lvUnder : 0);
        roadCrime[i] = (av ? FX.avenueCrime : 0) + (al ? FX.alleyCrime : 0);
      }
    // Active sky ramps lift land value within lvRampRadius (once per tile).
    mark.fill(0);
    const RR = SKY.lvRampRadius;
    for (let k = 0; k < skyCount; k++) {
      const r = skyList[k];
      if ((sky[r] & SKY_RAMP) === 0 || !rampGround(kind[r])) continue;
      const rx = r % N;
      const ry = (r / N) | 0;
      for (let y = Math.max(0, ry - RR); y <= Math.min(N - 1, ry + RR); y++)
        for (let x = Math.max(0, rx - RR); x <= Math.min(N - 1, rx + RR); x++) mark[y * N + x] = 1;
    }
    for (let c = 0; c < end; c += 3) for (let i = ck[c], e = ck[c + 1]; i < e; i++) if (mark[i]) roadLv[i] += SKY.lvRamp;

    // Noise: highways v·(1 − d/(r+1)) for d ≤ r, skyways likewise; max-combined.
    roadNoise.fill(0);
    if (this.hwListLen > 0) this.stampNoise(this.hwList, this.hwListLen, NZ.highway, NZ.highwayRadius);
    if (skyCount > 0) this.stampNoise(skyList, skyCount, SKY.noise, SKY.noiseRadius);
  }

  private stampNoise(list: Uint32Array, len: number, v: number, r: number): void {
    const N = this.N;
    const out = this.roadNoise;
    const inv = 1 / (r + 1);
    for (let k = 0; k < len; k++) {
      const s = list[k];
      const sx = s % N;
      const sy = (s / N) | 0;
      for (let y = Math.max(0, sy - r); y <= Math.min(N - 1, sy + r); y++) {
        const dy = y > sy ? y - sy : sy - y;
        for (let x = Math.max(0, sx - r); x <= Math.min(N - 1, sx + r); x++) {
          const dx = x > sx ? x - sx : sx - x;
          const d = dx > dy ? dx : dy;
          const n = v * (1 - d * inv);
          const j = y * N + x;
          if (n > out[j]) out[j] = n;
        }
      }
    }
  }

  /** Docks: every sky tile over a skyAnchor building's footprint docks it into that tile's component (§3.7). */
  private findDocks(world: World): void {
    const docks = this.skyDocks;
    const dockOf = this.dockOf;
    dockOf.clear();
    for (let c = 0; c < this.skyCompCount; c++) docks[c] = 0;
    if (this.skyCount === 0) return;
    const { skyList, skyComp, bld } = this;
    for (let k = 0; k < this.skyCount; k++) {
      const i = skyList[k];
      const id = bld[i];
      if (id < 0 || dockOf.has(id)) continue;
      const b = world.buildings.get(id);
      if (!b || !ANCHOR[b.type]) continue;
      const c = skyComp[i];
      dockOf.set(id, c);
      docks[c]++;
    }
  }

  /** Does sky component `c` carry anything (an active ramp or a dock)? */
  skyLive(c: number): boolean {
    return c >= 0 && c < this.skyCompCount && (this.skyRamps[c] > 0 || this.skyDocks[c] > 0);
  }

  /**
   * The static terrain term of land value (water views + gentle noise), on owned land (O1): only owned water gives a
   * view and the view's BFS never crosses a locked tile, so the start slot reads exactly what the 64 map did.
   * Recomputed when the owned land grows (annex) or terrain changes (Pump House reclamation, MEGACITY §3.3); the
   * noise term is computed once per slot. Public for tests; scanBegin calls it.
   */
  syncTerrain(world: World): void {
    if (world.slotsVersion === this.terrainSlots && world.terrainVersion === this.terrainSeen) return;
    this.terrainSlots = world.slotsVersion;
    this.terrainSeen = world.terrainVersion;
    this.computeTerrainValue(world);
  }

  private computeTerrainValue(world: World): void {
    const { N, layout } = this;
    const R = layout.R;
    const mask = layout.mask;
    const { ck, rowAt } = layout.all;
    const end = rowAt[N];
    const q = this.queue;
    const dist = this.mark;
    dist.fill(NO_ROAD);
    let head = 0;
    let tail = 0;
    const tiles = world.tiles;
    for (let c = 0; c < end; c += 3)
      for (let i = ck[c], e = ck[c + 1]; i < e; i++)
        if (tiles[i].terrain === Terrain.Water) {
          dist[i] = 0;
          q[tail++] = i;
        }
    while (head < tail) {
      const i = q[head++];
      const d = dist[i];
      if (d >= WATER_VIEW_RANGE) continue;
      const x = i % N;
      const y = (i / N) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= N) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= N) continue;
          const j = ny * N + nx;
          if (dist[j] !== NO_ROAD || !mask[j]) continue;
          dist[j] = d + 1;
          q[tail++] = j;
        }
      }
    }
    // The noise term, once per owned slot. Art coordinates (MEGACITY §3.2 artXY): the same on the start slot of
    // either region as on the 64 map.
    const seed = (world.seed % 10007) + 77;
    const o = 64 * ((world.region - 1) >> 1);
    const nz = this.lvNoise;
    for (let s = 0; s < R * R; s++) {
      if (!layout.own[s] || this.noiseDone[s]) continue;
      this.noiseDone[s] = 1;
      const sx = (s % R) << 6;
      const sy = ((s / R) | 0) << 6;
      for (let y = sy; y < sy + 64; y++)
        for (let x = sx; x < sx + 64; x++) nz[y * N + x] = (fbm((x - o) * 0.11, (y - o) * 0.11, seed, 3) - 0.5) * 2 * LV_NOISE;
    }
    const tv = this.terrainValue;
    for (let c = 0; c < end; c += 3)
      for (let i = ck[c], e = ck[c + 1]; i < e; i++) {
        const d = dist[i];
        let v = 0;
        if (d > 0 && d <= WATER_VIEW_RANGE) v += LV_WATER * (1 - (d - 1) / WATER_VIEW_RANGE);
        v += nz[i];
        tv[i] = v;
      }
    // Floodplain caps (land within 1 of owned water in a district with floodplainMaxLevel).
    const fc = this.floodCap;
    fc.fill(3);
    for (let s = 0; s < R * R; s++) {
      if (!layout.own[s]) continue;
      const cap = DISTRICTS[world.districts.kinds[s]]?.mods.floodplainMaxLevel;
      if (cap === undefined) continue;
      const sx = (s % R) << 6;
      const sy = ((s / R) | 0) << 6;
      for (let y = sy; y < sy + 64; y++)
        for (let x = sx; x < sx + 64; x++) {
          const i = y * N + x;
          if (dist[i] === 1) fc[i] = cap;
        }
    }
  }
}

/** Capacity (trips at ~63% congestion) per road kind, indexed by RoadKind (§3.1). */
export const KIND_CAPACITY: readonly number[] = ROAD_KINDS.map((d) => d.capacity);
/** ROAD_POLLUTION multiplier per road kind. */
export const KIND_POLLUTION: readonly number[] = ROAD_KINDS.map((d) => d.pollution);
