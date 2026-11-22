// ─────────────────────────────────────────────────────────────────────────────
// SimGrid: a typed-array mirror of the world's tiles plus derived lookups
// (road distance, nearest road, static terrain value). Refreshed once per tick
// by scan(); every other system reads these flat arrays instead of chasing
// Tile objects, which keeps the hot loops cache-friendly and allocation-free.
// ─────────────────────────────────────────────────────────────────────────────

import { ROAD_ACCESS_RANGE } from '../config';
import { fbm } from '../rng';
import { MAP_SIZE, Terrain, ZoneType, type Building } from '../types';
import type { World } from '../world';
import { LV_NOISE, LV_WATER, WATER_VIEW_RANGE } from './tuning';

// Imported bindings are copied into module locals: under Vite's SSR/test
// transform every imported identifier becomes a getter call, which is very
// slow inside hot per-tile loops.
export const N = MAP_SIZE;
export const AREA = N * N;
const RANGE = ROAD_ACCESS_RANGE;
const WATER = Terrain.Water;
const NONE = ZoneType.None;
/** roadDist value for tiles farther than ROAD_ACCESS_RANGE from any road. */
export const NO_ROAD = 255;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class SimGrid {
  /** ZoneType per tile. */
  readonly zone = new Uint8Array(AREA);
  /** Development level 0..3. */
  readonly level = new Uint8Array(AREA);
  /** 1 = abandoned developed zone. */
  readonly abandoned = new Uint8Array(AREA);
  /** 1 = road / bridge. */
  readonly road = new Uint8Array(AREA);
  /** 1 = water terrain. */
  readonly water = new Uint8Array(AREA);
  /** Building id covering the tile, -1 = none. */
  readonly bld = new Int32Array(AREA);
  /** Chebyshev distance to the nearest road, NO_ROAD beyond ROAD_ACCESS_RANGE. */
  readonly roadDist = new Uint8Array(AREA);
  /** Index of the nearest road tile within range, -1 if none. */
  readonly nearestRoad = new Int32Array(AREA);
  /** Indices of every zoned tile (any level); first `zonedCount` entries are valid. */
  readonly zoned = new Int32Array(AREA);
  zonedCount = 0;
  roadCount = 0;
  bridgeCount = 0;
  /** Static land value contribution from terrain (water views + gentle noise). */
  readonly terrainValue = new Float32Array(AREA);
  /** Snapshot of world.buildings (array reused between ticks). */
  readonly buildings: Building[] = [];

  private roadSig = 0x7fffffff;
  private readonly queue = new Int32Array(AREA);

  constructor(world: World) {
    this.computeTerrainValue(world);
  }

  /** Mirror world tiles into the typed arrays. `forceRoads` rebuilds road distances even if roads look unchanged. */
  scan(world: World, forceRoads = false): void {
    const tiles = world.tiles;
    const { zone, level, abandoned, road, water, bld, zoned } = this;
    let sig = 0;
    let roads = 0;
    let bridges = 0;
    let zc = 0;
    for (let i = 0; i < AREA; i++) {
      const t = tiles[i];
      const z = t.zone;
      zone[i] = z;
      level[i] = t.level;
      abandoned[i] = t.abandoned ? 1 : 0;
      water[i] = t.terrain === WATER ? 1 : 0;
      bld[i] = t.buildingId;
      if (t.road) {
        road[i] = 1;
        roads++;
        if (t.terrain === WATER) bridges++;
        // Order-independent fingerprint of the road set.
        sig = (sig + Math.imul(i + 1, 0x9e3779b1)) | 0;
      } else road[i] = 0;
      if (z !== NONE) zoned[zc++] = i;
    }
    this.zonedCount = zc;
    this.roadCount = roads;
    this.bridgeCount = bridges;
    sig = (sig ^ Math.imul(roads, 0x85ebca6b)) | 0;

    const list = this.buildings;
    list.length = 0;
    for (const b of world.buildings.values()) list.push(b);

    if (forceRoads || sig !== this.roadSig) {
      this.roadSig = sig;
      this.computeRoadDistance();
    }
  }

  /** Developed (level ≥ 1) and occupied zone tile? */
  developed(i: number): boolean {
    return this.level[i] > 0 && this.zone[i] !== NONE && this.abandoned[i] === 0;
  }

  /** True if (index) has a road within ROAD_ACCESS_RANGE. */
  hasRoad(i: number): boolean {
    return this.roadDist[i] <= RANGE;
  }

  /**
   * Multi-source 8-neighbour BFS from every road tile. On an obstacle-free grid
   * 8-connected BFS depth equals Chebyshev distance, matching World.hasRoadAccess.
   */
  private computeRoadDistance(): void {
    const dist = this.roadDist;
    const near = this.nearestRoad;
    const q = this.queue;
    const road = this.road;
    dist.fill(NO_ROAD);
    near.fill(-1);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < AREA; i++) {
      if (road[i]) {
        dist[i] = 0;
        near[i] = i;
        q[tail++] = i;
      }
    }
    while (head < tail) {
      const i = q[head++];
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
          if (dist[j] !== NO_ROAD) continue;
          dist[j] = d + 1;
          near[j] = src;
          q[tail++] = j;
        }
      }
    }
  }

  /** Terrain never changes after generation, so its land-value term is computed once. */
  private computeTerrainValue(world: World): void {
    const q = this.queue;
    const dist = new Uint8Array(AREA).fill(NO_ROAD);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < AREA; i++) {
      if (world.tiles[i].terrain === Terrain.Water) {
        dist[i] = 0;
        q[tail++] = i;
      }
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
          if (dist[j] !== NO_ROAD) continue;
          dist[j] = d + 1;
          q[tail++] = j;
        }
      }
    }
    const seed = (world.seed % 10007) + 77;
    for (let i = 0; i < AREA; i++) {
      const d = dist[i];
      let v = 0;
      if (d > 0 && d <= WATER_VIEW_RANGE) v += LV_WATER * (1 - (d - 1) / WATER_VIEW_RANGE);
      const x = i % N;
      const y = (i / N) | 0;
      v += (fbm(x * 0.11, y * 0.11, seed, 3) - 0.5) * 2 * LV_NOISE;
      this.terrainValue[i] = v;
    }
  }
}
