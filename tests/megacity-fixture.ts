// The megacity fixture (docs/MEGACITY.md §11.4, WP-1; Step 9 extends it): a world of either region with n slots
// owned and built, centre first, then ring 1, then ring 2, with World mutators only (so it does not depend on
// WP-2's tools). Each slot is §2.1's fill: a road every 4 tiles, 3×3 blocks zoned at levels 1–3 with tiers, a
// reactor every 9th block and a service every 7th; generated water is left as it is.

import { ringOf, slotNeighbours, slotRect } from '../src/game/districts/slots';
import { Simulation } from '../src/game/sim';
import { Terrain, type BuildingType, type DistrictKind, type Region, type SlotId, type WealthTier } from '../src/game/types';
import { World } from '../src/game/world';
import { ScriptedMayor } from './helpers';

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

/** The kind order MegaMayor annexes candidates in (§11.3 D1: "candidates in a fixed kind order"). */
export const MEGA_KIND_ORDER: readonly DistrictKind[] = ['flats', 'bazaar', 'terraces', 'reedmere', 'shoals', 'skeleton', 'tarmac', 'sunk'];

/**
 * The MegaMayor (MEGACITY §11.4, WP-1; Step 9 adds the PACING harness, grants and the buyer): a ScriptedMayor per owned
 * district, each on its own grid centred in its slot and counting only its own lots and services, plus annexing. `annex`
 * performs an annex and says whether it happened (default: the structural World.annex; a Game passes
 * `(s) => game.annex(s, lease).ok`), `opens` filters candidates (the Sunk opens after `ch4.brine`, a story rule).
 */
export class MegaMayor {
  readonly mayors = new Map<SlotId, ScriptedMayor>();
  private readonly annexFn: (slot: SlotId) => boolean;
  private readonly opens: (slot: SlotId) => boolean;

  constructor(
    readonly world: World,
    readonly sim: Simulation,
    opts: { annex?: (slot: SlotId) => boolean; opens?: (slot: SlotId) => boolean } = {},
  ) {
    this.annexFn =
      opts.annex ??
      ((s) => {
        this.world.annex(s);
        return this.world.slotOwned[s] === 1;
      });
    this.opens = opts.opens ?? ((s) => this.world.districts.kinds[s] !== 'sunk');
  }

  /** The mayor of a slot, its grid centred in the slot (the 64 map's offset: 10 tiles in). */
  private mayorOf(slot: SlotId): ScriptedMayor {
    let m = this.mayors.get(slot);
    if (!m) {
      const r = slotRect(this.world, slot);
      m = new ScriptedMayor(this.world, this.sim, { ox: r.x0 + 10, oy: r.y0 + 10, ownGrid: true });
      this.mayors.set(slot, m);
    }
    return m;
  }

  /** Open every owned district (each mayor's opening: a power plant and a few blocks). */
  opening(): void {
    for (const s of this.world.districts.owned) if (!this.mayors.has(s)) this.mayorOf(s).opening();
  }

  /** Locked slots next to owned land that may open, in MEGA_KIND_ORDER, lowest slot first within a kind. */
  candidates(): SlotId[] {
    const w = this.world;
    const R = w.region as Region;
    const out = new Set<SlotId>();
    for (const s of w.districts.owned) for (const n of slotNeighbours(R, s)) if (!w.slotOwned[n] && this.opens(n)) out.add(n);
    const rank = (s: SlotId) => {
      const k = MEGA_KIND_ORDER.indexOf(w.districts.kinds[s]);
      return k < 0 ? MEGA_KIND_ORDER.length : k;
    };
    return [...out].sort((a, b) => rank(a) - rank(b) || a - b);
  }

  /** Annex the first candidate and open it (its mayor's opening). Returns the slot, or −1 when none could be annexed. */
  annexNext(): SlotId {
    for (const s of this.candidates()) {
      if (!this.annexFn(s)) continue;
      this.mayorOf(s).opening();
      return s;
    }
    return -1;
  }

  /** One planning turn of every district's mayor (call monthly). */
  turn(): void {
    for (const s of this.world.districts.owned) this.mayorOf(s).turn();
  }
}
