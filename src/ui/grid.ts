// ─────────────────────────────────────────────────────────────────────────────
// Read-only power-grid checks for the UI (coach, placement pill, warnings).
// Mirrors the sim's conductor rule (roads, zone tiles and building tiles carry
// power to their 4 neighbours) but runs on demand, so it also answers while
// the game is paused, before the next sim tick has re-labelled the grid.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from '../game/config';
import { scratchFor } from '../game/frame';
import { ZoneType, type Tile } from '../game/types';
import type { World } from '../game/world';

/** Flood-fill scratch, one set per frame size (MEGACITY §3.1). */
const scratch = scratchFor((area) => ({ queue: new Int32Array(area), seen: new Uint8Array(area) }));
type Scratch = ReturnType<typeof scratch>;

function conducts(t: Tile): boolean {
  return t.road || t.zone !== ZoneType.None || t.buildingId >= 0;
}

export interface GridLink {
  /** Power plants on the map (online or not). */
  plants: number;
  /** Name of the first plant (for messages). */
  plantName: string;
  /** Any zoned tile at all. */
  zoned: boolean;
  /** Some zoned tile is wired to a plant through touching roads / zones / buildings. */
  linked: boolean;
}

/** Does any plant reach a zoned tile? Cheap: one flood fill from the plants, early exit. */
export function gridLink(w: World): GridLink {
  const tiles = w.tiles;
  const N = w.N;
  const AREA = w.area;
  const sc = scratch(AREA);
  const { queue, seen } = sc;
  let zoned = false;
  for (let i = 0; i < AREA; i++) {
    const t = tiles[i];
    if (t.zone !== ZoneType.None) {
      zoned = true;
      // A zone tile the sim already lit is proof enough.
      if (t.powered) return { plants: countPlants(w), plantName: firstPlant(w), zoned: true, linked: true };
    }
  }
  let plants = 0;
  let plantName = '';
  let head = 0;
  let tail = 0;
  seen.fill(0);
  for (const b of w.buildings.values()) {
    const def = BUILDINGS[b.type];
    if (!(def.powerSupply > 0)) continue;
    plants++;
    if (!plantName) plantName = def.name;
    for (let dy = 0; dy < b.size; dy++)
      for (let dx = 0; dx < b.size; dx++) {
        const i = (b.y + dy) * N + b.x + dx;
        if (i >= 0 && i < AREA && !seen[i]) {
          seen[i] = 1;
          queue[tail++] = i;
        }
      }
  }
  if (!plants || !zoned) return { plants, plantName, zoned, linked: false };
  while (head < tail) {
    const i = queue[head++];
    if (tiles[i].zone !== ZoneType.None) return { plants, plantName, zoned, linked: true };
    const x = i % N;
    if (x > 0) tail = visit(sc, tiles, i - 1, tail);
    if (x < N - 1) tail = visit(sc, tiles, i + 1, tail);
    if (i >= N) tail = visit(sc, tiles, i - N, tail);
    if (i < AREA - N) tail = visit(sc, tiles, i + N, tail);
  }
  return { plants, plantName, zoned, linked: false };
}

function visit(sc: Scratch, tiles: Tile[], i: number, tail: number): number {
  const { seen, queue } = sc;
  if (seen[i] || !conducts(tiles[i])) return tail;
  seen[i] = 1;
  queue[tail] = i;
  return tail + 1;
}

function countPlants(w: World): number {
  let n = 0;
  for (const b of w.buildings.values()) if (BUILDINGS[b.type].powerSupply > 0) n++;
  return n;
}

function firstPlant(w: World): string {
  for (const b of w.buildings.values()) if (BUILDINGS[b.type].powerSupply > 0) return BUILDINGS[b.type].name;
  return '';
}

/** Would a building footprint touch any conductor (road, zone, other building) on its 4 sides? */
export function footprintTouchesGrid(w: World, x: number, y: number, size: number): boolean {
  for (let k = 0; k < size; k++) {
    for (const [tx, ty] of [
      [x + k, y - 1],
      [x + k, y + size],
      [x - 1, y + k],
      [x + size, y + k],
    ]) {
      const t = w.tileAt(tx, ty);
      if (t && conducts(t)) return true;
    }
  }
  return false;
}
