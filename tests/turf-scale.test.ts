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

describe('the seam on a big city (§3.3: the month end within budget)', () => {
  /** Layouts with more pairs than computeSeam compares one by one (its distance transform path). */
  let big = 0;
  /** Today's rule, every pair: the midpoint of the first pair (Undertow order, then Kites) at the smallest distance. */
  function seamByPairs(w: World): number | null {
    const N = w.N;
    const u: number[] = [];
    const k: number[] = [];
    for (let s = 0; s < w.segCount; s += 2)
      for (let i = w.segs[s]; i < w.segs[s + 1]; i++) {
        if (w.turf.owner[i] === 1) u.push(i);
        else if (w.turf.owner[i] === 2) k.push(i);
      }
    if (!u.length || !k.length) return null;
    if (u.length * k.length > 1 << 16) big++;
    let best = Infinity;
    let a = -1;
    let b = -1;
    for (const i of u) {
      for (const j of k) {
        const d = ((j % N) - (i % N)) ** 2 + (((j / N) | 0) - ((i / N) | 0)) ** 2;
        if (d < best) {
          best = d;
          a = i;
          b = j;
        }
      }
    }
    return Math.round((((a / N) | 0) + ((b / N) | 0)) / 2) * N + Math.round(((a % N) + (b % N)) / 2);
  }

  it.each([3, 5] as Region[])('%i×%i: random gang layouts (blobs far apart, touching, scattered) give the same seam as every pair', (region) => {
    const w = new World(17, 'Seam', undefined, region);
    for (let s = 0; s < region * region; s++) if (!w.slotOwned[s]) w.annex(s);
    const rng = new Rng(region * 101);
    const N = w.N;
    for (let trial = 0; trial < 12; trial++) {
      w.turf.owner.fill(0);
      const blobs = 1 + Math.floor(rng.next() * 4);
      for (const o of [1, 2]) {
        for (let b = 0; b < blobs; b++) {
          const cx = Math.floor(rng.next() * N);
          const cy = Math.floor(rng.next() * N);
          const r = 3 + Math.floor(rng.next() * 18);
          const sparse = trial % 3 === 2;
          for (let y = Math.max(0, cy - r); y <= Math.min(N - 1, cy + r); y++)
            for (let x = Math.max(0, cx - r); x <= Math.min(N - 1, cx + r); x++)
              if ((!sparse || rng.next() < 0.2) && !w.turf.owner[y * N + x]) w.turf.owner[y * N + x] = o;
        }
      }
      const want = seamByPairs(w);
      w.story.seam = null;
      expect([trial, turf.computeSeam(w)]).toEqual([trial, want]);
    }
    expect(big).toBeGreaterThanOrEqual(6);
  });
});
