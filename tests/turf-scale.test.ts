// O6 (docs/MEGACITY.md §3.3, §11.5 WP-1): turf maps from one pass over owned land, banded over the last
// REGION[R].turfBands days before the month end; the month's rules then equal a whole-map rebuild exactly.

import { describe, expect, it } from 'vitest';
import { REGION } from '../src/game/config';
import { Rng } from '../src/game/rng';
import * as turf from '../src/game/story/turf';
import type { Region } from '../src/game/types';
import { World } from '../src/game/world';
import { megacitySim, megacityWorld } from './megacity-fixture';

/** A city with both gangs seeded and a few months of spread, as a save. */
function turfCity(seed: number, region: Region, slots: number): string {
  const w = megacityWorld(region, slots, seed);
  const sim = megacitySim(w);
  const rng = new Rng(seed);
  // Some abandoned lots and crime, so the Undertow has somewhere to go.
  for (let k = 0; k < 200; k++) {
    const i = w.segs[0] + Math.floor(rng.next() * (w.segs[w.segCount - 1] - w.segs[0]));
    const t = w.tiles[i];
    if (w.ownedAt(i) && t.zone && t.level > 0) w.setLevel(i % w.N, (i / w.N) | 0, t.level, true);
  }
  sim.recomputeAll();
  turf.forceSeed(w);
  for (let m = 0; m < 4; m++) {
    w.tick += 30;
    turf.update(w);
  }
  return JSON.stringify(w.serialize());
}

function settle(json: string, banded: boolean): World {
  const w = World.deserialize(JSON.parse(json));
  megacitySim(w);
  const end = w.tick - (w.tick % 30) + 30;
  if (banded) {
    const bands = REGION[w.region].turfBands;
    for (let d = 0; d < bands; d++) {
      w.tick = end - bands + d;
      turf.bandStep(w);
    }
  }
  w.tick = end;
  turf.update(w);
  return w;
}

describe('O6 banded turf (§3.3)', () => {
  it('20 cities on both regions: the banded month equals the whole-map rebuild (owners, strength, contested, stats, story rng)', () => {
    let tiles = 0;
    for (let k = 0; k < 20; k++) {
      const region: Region = k % 4 === 3 ? 5 : 3;
      const json = turfCity(300 + k, region, region === 5 ? 1 + (k % 9) : 1 + (k % 6));
      const a = settle(json, true);
      const b = settle(json, false);
      expect(Array.from(a.turf.owner)).toEqual(Array.from(b.turf.owner));
      expect(Array.from(a.turf.str)).toEqual(Array.from(b.turf.str));
      expect(Array.from(a.turf.contested)).toEqual(Array.from(b.turf.contested));
      expect(a.turf.stats).toEqual(b.turf.stats);
      expect(a.story.rng).toBe(b.story.rng);
      tiles += a.turf.stats.tiles.undertow + a.turf.stats.tiles.kites;
    }
    expect(tiles).toBeGreaterThan(200);
  }, 120_000);

  it('turf never forms on a locked tile, and the cap counts owned land only', () => {
    const w = World.deserialize(JSON.parse(turfCity(77, 3, 1)));
    for (let i = 0; i < w.area; i++) if (!w.ownedAt(i)) expect(w.turf.owner[i]).toBe(0);
    let land = 0;
    for (let i = 0; i < w.area; i++) if (w.ownedAt(i) && w.tiles[i].terrain !== 1) land++;
    expect(turf.landTiles(w)).toBe(land);
  });

  it('the banded month is skipped before turf can form (no gang seeded or due, no turf)', () => {
    const w = new World(5, 'Quiet', undefined, 3);
    w.maxPopulation = 100;
    let steps = 0;
    for (let d = 0; d < 30; d++) {
      w.tick = 30 + d;
      steps += turf.bandStep(w);
    }
    expect(steps).toBe(0);
  });
});
