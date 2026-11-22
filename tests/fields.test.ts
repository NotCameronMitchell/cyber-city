import { describe, expect, it } from 'vitest';
import { Terrain, ZoneType, type Fields } from '../src/game/types';
import type { World } from '../src/game/world';
import { flatWorld, makeSim } from './helpers';

/** Powered road along y = 30 (x 5..58) with a reactor at its west end. */
function street(): World {
  const w = flatWorld(11);
  w.addBuilding('reactor', 2, 29);
  for (let x = 5; x <= 58; x++) w.setRoad(x, 30);
  return w;
}

function block(w: World, z: ZoneType, level: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      w.setZone(x, y, z);
      w.setLevel(x, y, level);
    }
}

const at = (w: World, f: keyof Fields, x: number, y: number) => w.fields[f][w.idx(x, y)];

describe('fields', () => {
  it('pollution peaks at heavy industry, diffuses outward and is filtered by parks', () => {
    const make = (park: boolean) => {
      const w = street();
      block(w, ZoneType.Industrial, 3, 20, 31, 25, 34);
      if (park) w.addBuilding('plaza', 26, 32);
      makeSim(w);
      return w;
    };
    const w = make(false);
    const core = at(w, 'pollution', 22, 32);
    expect(core).toBeGreaterThan(0.5);
    expect(at(w, 'pollution', 28, 32)).toBeLessThan(core);
    expect(at(w, 'pollution', 45, 45)).toBeLessThan(0.02);
    const parked = make(true);
    expect(at(parked, 'pollution', 27, 32)).toBeLessThan(at(w, 'pollution', 27, 32));
  });

  it('dense zones load their nearest roads; transit coverage cuts the trips', () => {
    const make = (transit: boolean) => {
      const w = street();
      block(w, ZoneType.Residential, 3, 30, 31, 34, 33);
      block(w, ZoneType.Commercial, 3, 30, 27, 34, 29);
      if (transit) w.addBuilding('maglev', 36, 31);
      makeSim(w);
      return w;
    };
    const w = make(false);
    const busy = at(w, 'traffic', 32, 30);
    expect(busy).toBeGreaterThan(0.3);
    expect(at(w, 'traffic', 55, 30)).toBeLessThan(busy);
    // Lots beside the road only carry a faint spill for the overlay.
    expect(at(w, 'traffic', 32, 31)).toBeLessThan(busy * 0.5);
    const t = make(true);
    expect(at(t, 'traffic', 32, 30)).toBeLessThan(busy - 0.1);
  });

  it('a precinct suppresses crime around it', () => {
    const make = (precinct: boolean) => {
      const w = street();
      block(w, ZoneType.Residential, 2, 20, 31, 40, 33);
      block(w, ZoneType.Commercial, 2, 20, 27, 40, 29);
      if (precinct) w.addBuilding('precinct', 41, 31);
      makeSim(w);
      return w;
    };
    const plain = make(false);
    const patrolled = make(true);
    expect(at(plain, 'crime', 38, 32)).toBeGreaterThan(0.15);
    expect(at(patrolled, 'crime', 38, 32)).toBeLessThan(at(plain, 'crime', 38, 32) - 0.15);
    expect(patrolled.stats.avgCrime).toBeLessThan(plain.stats.avgCrime);
  });

  it('water views raise land value, smog lowers it', () => {
    const w = street();
    for (let y = 50; y < 64; y++) for (let x = 0; x < 64; x++) w.tiles[w.idx(x, y)].terrain = Terrain.Water;
    block(w, ZoneType.Industrial, 3, 20, 31, 25, 34);
    // Rebuild the sim so the static water term sees the new shoreline.
    makeSim(w);
    expect(at(w, 'landValue', 40, 49)).toBeGreaterThan(at(w, 'landValue', 40, 40) + 0.08);
    expect(at(w, 'landValue', 22, 32)).toBeLessThan(at(w, 'landValue', 40, 40));
    expect(at(w, 'landValue', 40, 55)).toBe(0); // water itself
  });

  it('every field stays within 0..1', () => {
    const w = street();
    block(w, ZoneType.Industrial, 3, 5, 31, 58, 40);
    block(w, ZoneType.Residential, 3, 5, 20, 58, 29);
    const sim = makeSim(w);
    for (let i = 0; i < 20; i++) sim.step();
    for (const [name, f] of Object.entries(w.fields)) {
      for (const v of f as Float32Array) {
        if (!(v >= 0 && v <= 1)) throw new Error(`${name} out of range: ${v}`);
      }
    }
  });
});
