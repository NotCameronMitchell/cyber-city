import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/game/actions';
import { Rng } from '../src/game/rng';
import type { ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { makeSim } from './helpers';

const TOOLS: ToolId[] = [
  'road', 'road', 'road', 'res', 'res', 'com', 'ind', 'bulldoze',
  'solar', 'reactor', 'plaza', 'precinct', 'clinic', 'datahub', 'maglev', 'spire', 'arcology',
  // Expansion (EXPANSION §3, §5, §6.1).
  'avenue', 'highway', 'alley', 'alley', 'skyway', 'bulldoze', 'academy', 'seaport', 'airport', 'spaceport',
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
      // Expansion invariants (§2.1).
      if (!t.road) expect(t.roadKind).toBe(0);
      if (t.zone === 0 || t.level === 0) expect(t.wealth).toBe(0);
      if (t.terrain === 1) expect(t.roadKind === 3 || t.roadKind === 4).toBe(false);
    }
    // Every skyway link is mutual; at most one airport and one spaceport, two seaports.
    for (let i = 0; i < 4096; i++) {
      const m = w.sky[i] & 15;
      if (m & 1) expect(w.sky[i - 64] & 4).toBe(4);
      if (m & 2) expect(w.sky[i + 1] & 8).toBe(8);
      if (m & 4) expect(w.sky[i + 64] & 1).toBe(1);
      if (m & 8) expect(w.sky[i - 1] & 2).toBe(2);
    }
    const count = (t: string) => [...w.buildings.values()].filter((b) => b.type === t).length;
    expect(count('airport')).toBeLessThanOrEqual(1);
    expect(count('spaceport')).toBeLessThanOrEqual(1);
    expect(count('seaport')).toBeLessThanOrEqual(2);
  });
});
