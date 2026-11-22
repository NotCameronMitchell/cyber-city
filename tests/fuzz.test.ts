import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/game/actions';
import { Rng } from '../src/game/rng';
import type { ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { makeSim } from './helpers';

const TOOLS: ToolId[] = [
  'road', 'road', 'road', 'res', 'res', 'com', 'ind', 'bulldoze',
  'solar', 'reactor', 'plaza', 'precinct', 'clinic', 'datahub', 'maglev', 'spire', 'arcology',
];

describe('fuzz', () => {
  it('survives random player actions interleaved with simulation', () => {
    const w = World.generate(777, 'Chaos Quay');
    w.funds = 5e6;
    w.maxPopulation = 1e6; // unlock everything
    const sim = makeSim(w, true);
    const rng = new Rng(4);
    const p = () => ({ x: rng.int(-2, 65), y: rng.int(-2, 65) });
    for (let tick = 0; tick < 1500; tick++) {
      if (rng.chance(0.4)) {
        const a = p();
        const b = rng.chance(0.5) ? a : { x: a.x + rng.int(-8, 8), y: a.y + rng.int(-8, 8) };
        applyAction(w, rng.pick(TOOLS), a, b);
        sim.recomputeAll();
      }
      if (rng.chance(0.01)) w.taxRate = rng.int(0, 20);
      sim.step();
    }
    const s = w.stats;
    for (const v of [s.population, s.jobsCom, s.jobsInd, s.powerSupply, s.powerDemand, s.approval, w.funds]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(s.demand.res).toBeGreaterThanOrEqual(-1);
    expect(s.demand.res).toBeLessThanOrEqual(1);
    for (const [name, f] of Object.entries(w.fields)) {
      for (const v of f as Float32Array) if (!(v >= 0 && v <= 1)) throw new Error(`${name} out of range: ${v}`);
    }
    for (const t of w.tiles) {
      expect(t.level).toBeGreaterThanOrEqual(0);
      expect(t.level).toBeLessThanOrEqual(3);
      if (t.zone === 0) expect(t.level).toBe(0);
    }
  });
});
