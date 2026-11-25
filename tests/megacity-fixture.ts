// The megacity fixture (docs/MEGACITY.md §11.4, WP-1; Step 9 extends it): a world of either region with n slots
// owned and built, centre first, then ring 1, then ring 2, with World mutators only (so it does not depend on
// WP-2's tools). Each slot is §2.1's fill: a road every 4 tiles, 3×3 blocks zoned at levels 1–3 with tiers, a
// reactor every 9th block and a service every 7th; generated water is left as it is.

import { ringOf, slotRect } from '../src/game/districts/slots';
import { Simulation } from '../src/game/sim';
import { Terrain, type BuildingType, type Region, type SlotId, type WealthTier } from '../src/game/types';
import { World } from '../src/game/world';

const SERVICES: BuildingType[] = ['precinct', 'clinic', 'datahub', 'maglev', 'plaza', 'spire'];

/** Slots of a region in fixture order: the centre, then ring 1, then ring 2, lowest id first within a ring. */
export function fixtureOrder(region: Region): SlotId[] {
  return Array.from({ length: region * region }, (_, s) => s).sort((a, b) => ringOf(region, a) - ringOf(region, b) || a - b);
}

/** Build one 64×64 slot with §2.1's fill (`salt` varies the block pattern per slot). */
export function fillSlot(w: World, slot: SlotId, salt = 0): void {
  const r = slotRect(w, slot);
  const x0 = r.x0;
  const y0 = r.y0;
  for (let y = y0; y < y0 + 64; y++)
    for (let x = x0; x < x0 + 64; x++) if ((x - x0) % 4 === 0 || (y - y0) % 4 === 0) w.setRoad(x, y);
  let k = salt;
  for (let by = 0; by < 16; by++)
    for (let bx = 0; bx < 16; bx++) {
      const x = x0 + bx * 4 + 1;
      const y = y0 + by * 4 + 1;
      if (x + 2 >= x0 + 64 || y + 2 >= y0 + 64) continue;
      k++;
      if (k % 9 === 0) {
        w.addBuilding('reactor', x, y);
        continue;
      }
      if (k % 7 === 0) {
        w.addBuilding(SERVICES[k % SERVICES.length], x, y);
        continue;
      }
      const zone = k % 3 === 0 ? 3 : k % 3 === 1 ? 1 : 2;
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
          const t = w.tileAt(x + dx, y + dy);
          if (!t || t.terrain !== Terrain.Land || t.buildingId >= 0) continue;
          w.setZone(x + dx, y + dy, zone);
          w.setLevel(x + dx, y + dy, 1 + ((dx + dy + k) % 3), false, ((dx * 7 + dy * 3 + k) % 3) as WealthTier);
        }
    }
}

/** Own and build `n` slots of `world` in fixture order (annexing the ones it does not own yet). Returns the slots. */
export function megacityFixture(world: World, n: number): SlotId[] {
  const pick = fixtureOrder(world.region as Region).slice(0, n);
  world.funds = 1e9;
  world.maxPopulation = 1e9;
  for (const s of pick) if (!world.slotOwned[s]) world.annex(s);
  pick.forEach((s, i) => fillSlot(world, s, i * 3));
  return pick;
}

/** A fresh world of the region with `n` built slots (seed 99, as the device bench). */
export function megacityWorld(region: Region, n: number, seed = 99): World {
  const w = new World(seed, 'Megacity', undefined, region);
  megacityFixture(w, n);
  return w;
}

/** A Simulation over the world, random events off, recomputed. */
export function megacitySim(w: World): Simulation {
  const sim = new Simulation(w);
  sim.options.events = false;
  sim.recomputeAll();
  return sim;
}

/** Cache of built fixtures per file run (a 25-district world takes ≈ 0.3 s to build and recompute). */
const cache = new Map<string, string>();
/** A world built once per (region, n) and handed out as a fresh copy (serialize → deserialize). */
export function cachedMegacity(region: Region, n: number): World {
  const key = `${region}:${n}`;
  let json = cache.get(key);
  if (!json) {
    json = JSON.stringify(megacityWorld(region, n).serialize());
    cache.set(key, json);
  }
  return World.deserialize(JSON.parse(json));
}
