// UI-side grid checks (src/ui/grid.ts): the first-run coach, the placement pill
// and the "isn't connected" warning must agree with the sim's conductor rule.

import { describe, expect, it } from 'vitest';
import { footprintTouchesGrid, gridLink } from '../src/ui/grid';
import { act, flatWorld, makeSim } from './helpers';

function starter() {
  const w = flatWorld(77);
  w.funds = 1e6;
  expect(act(w, 'road', { x: 10, y: 20 }, { x: 24, y: 20 })).toBe(true);
  expect(act(w, 'res', { x: 10, y: 21 }, { x: 14, y: 22 })).toBe(true);
  expect(act(w, 'ind', { x: 16, y: 21 }, { x: 20, y: 22 })).toBe(true);
  return w;
}

describe('ui grid checks', () => {
  it('no plant: nothing linked', () => {
    const g = gridLink(starter());
    expect(g).toMatchObject({ plants: 0, zoned: true, linked: false });
  });

  it('a plant one tile off the road is stranded, and the pill check says so', () => {
    const w = starter();
    // Solar (2×2) at y 17–18 leaves row 19 empty between it and the road.
    expect(footprintTouchesGrid(w, 12, 17, 2)).toBe(false);
    expect(act(w, 'solar', { x: 12, y: 17 })).toBe(true);
    const g = gridLink(w);
    expect(g.plants).toBe(1);
    expect(g.plantName.length).toBeGreaterThan(0);
    expect(g.linked).toBe(false);
    // The sim agrees: no zone tile gets power.
    makeSim(w);
    expect(w.tiles.some((t) => t.zone !== 0 && t.powered)).toBe(false);
  });

  it('a plant touching the road reaches the zones (also before any sim tick)', () => {
    const w = starter();
    expect(footprintTouchesGrid(w, 12, 18, 2)).toBe(true);
    expect(act(w, 'solar', { x: 12, y: 18 })).toBe(true);
    expect(gridLink(w).linked).toBe(true);
    makeSim(w);
    expect(w.tiles.some((t) => t.zone !== 0 && t.powered)).toBe(true);
    expect(gridLink(w).linked).toBe(true);
  });

  it('a plant touching only a zone also counts', () => {
    const w = starter();
    expect(footprintTouchesGrid(w, 10, 23, 2)).toBe(true);
    expect(act(w, 'solar', { x: 10, y: 23 })).toBe(true);
    expect(gridLink(w).linked).toBe(true);
  });
});
