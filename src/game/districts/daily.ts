// ─────────────────────────────────────────────────────────────────────────────
// The district daily hook (docs/MEGACITY.md §3.3, §3.7; WP-2), called by the
// sim once per day after growth (`Simulation.districtDaily`, unit C1): Pump
// House reclamation, king tides, the district layer part (at most once a day)
// and, on the month tick, the district goals.
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS } from '../config';
import { isBerthTile } from '../ports';
import { DAYS_PER_MONTH, Terrain, type Building } from '../types';
import type { World } from '../world';
import { ownsTideDistrict, updateDistrictLayers } from './effects';
import { checkDistrictGoals } from './goals';

/** Pump House (§6.3): 90 days of reclamation, one ring every 30, then a pump garden. */
export const PUMP = { days: 90, ringDays: 30, rings: 3, maxPerDistrict: 16, hallRadius: 6, landReach: 3 } as const;

/** The squared-distance band of each ring within r2 (Chebyshev 2): 1–2, 4–5, 8. */
const RING_D2: readonly (readonly [number, number])[] = [
  [1, 2],
  [4, 5],
  [8, 8],
];

/** Rings a Pump House has raised so far (0..3). */
export function pumpRings(b: Pick<Building, 'reclaim'>): number {
  const left = b.reclaim ?? 0;
  return Math.max(0, Math.min(PUMP.rings, Math.floor((PUMP.days - left) / PUMP.ringDays)));
}

/**
 * Raise one ring of owned water around a Pump House (§6.3): never a berth, a bridge, rail, a locked tile or water
 * more than 3 tiles from land. Returns tiles raised.
 */
export function raiseRing(world: World, b: Building, ring: number): number {
  const [lo, hi] = RING_D2[ring - 1] ?? [0, -1];
  const N = world.N;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 < lo || d2 > hi) continue;
      const x = b.x + dx;
      const y = b.y + dy;
      if (!world.isOwned(x, y)) continue;
      const i = y * N + x;
      const t = world.tiles[i];
      if (t.terrain !== Terrain.Water || t.road || world.rail[i] || t.buildingId >= 0) continue;
      if (isBerthTile(world, x, y)) continue;
      if (!nearLand(world, x, y, PUMP.landReach)) continue;
      world.setTerrain(x, y, Terrain.Land);
      n++;
    }
  return n;
}

function nearLand(world: World, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const t = world.tileAt(x + dx, y + dy);
      if (t && t.terrain === Terrain.Land) return true;
    }
  return false;
}

/** One day of every Pump House: powered ones count down and raise a ring every 30 days. */
export function pumpHouses(world: World): number {
  let raised = 0;
  for (const b of world.buildings.values()) {
    if (b.type !== 'pumphouse' || !(b.reclaim! > 0) || !b.powered) continue;
    const before = pumpRings(b);
    b.reclaim = b.reclaim! - 1;
    const after = pumpRings(b);
    if (after > before) raised += raiseRing(world, b, after);
    // A finished pump house is a pump garden (park r3, §6.3): coverage reads it.
    if (b.reclaim === 0) world.coverageVersion++;
  }
  return raised;
}

/** King tides (§3.7): 20 days from the first day of the listed months, while a Shoals district is owned. */
export function kingTides(world: World): boolean {
  let changed = false;
  if (world.tide > 0) {
    world.tide--;
    if (world.tide === 0) changed = true;
  }
  const tide = DISTRICTS.shoals.mods.kingTide;
  if (tide && world.tide === 0 && world.tick % DAYS_PER_MONTH === 1 && tide.months.includes(world.month) && ownsTideDistrict(world)) {
    world.tide = tide.days;
    changed = true;
  }
  return changed;
}

/** The hook Game installs as `sim.districtDaily`. */
export function districtDaily(world: World, monthEnd: boolean): void {
  pumpHouses(world);
  const tideChanged = kingTides(world);
  updateDistrictLayers(world, tideChanged);
  if (monthEnd) checkDistrictGoals(world);
}
