import { describe, expect, it } from 'vitest';
import { MAP_SIZE } from '../src/game/types';
import { fullyBuiltWorld, makeSim } from './helpers';
import { expansionFixture } from './expansion-fixture';

// Budgets from the module contract (Node, fully developed 64×64 map):
// step() < 2 ms on average, recomputeAll() < 10 ms; with the expansion fixture
// (docs/EXPANSION.md §10.1) the same budgets, and settleWealth() < 5 ms.
// Shared CI runners are slower and noisier than a dev machine: allow 3× there
// so a busy runner cannot block a deploy (the contract budgets apply locally).
const slack = (globalThis as any).process?.env?.CI ? 3 : 1;

function measure(sim: ReturnType<typeof makeSim>) {
  for (let i = 0; i < 150; i++) sim.step(); // warm up the JIT
  const steps = 600;
  let t0 = performance.now();
  for (let i = 0; i < steps; i++) sim.step();
  const stepMs = (performance.now() - t0) / steps;

  for (let i = 0; i < 10; i++) sim.recomputeAll();
  const runs = 60;
  t0 = performance.now();
  for (let i = 0; i < runs; i++) sim.recomputeAll();
  const recomputeMs = (performance.now() - t0) / runs;
  return { stepMs, recomputeMs };
}

describe('performance', () => {
  it('step() and recomputeAll() stay inside their budgets on a fully built map', () => {
    const w = fullyBuiltWorld();
    const sim = makeSim(w, true);
    expect(w.stats.population).toBeGreaterThan(200_000);
    expect(w.buildings.size).toBeGreaterThan(30);
    const { stepMs, recomputeMs } = measure(sim);
    console.info(`[perf] step ${stepMs.toFixed(3)} ms · recomputeAll ${recomputeMs.toFixed(3)} ms`);
    expect(stepMs).toBeLessThan(2 * slack);
    expect(recomputeMs).toBeLessThan(10 * slack);
  });

  it('the same budgets hold with the expansion fixture; settleWealth() < 5 ms (§10.1)', () => {
    const w = fullyBuiltWorld();
    const fx = expansionFixture(w);
    const sim = makeSim(w, true);
    expect(fx.sky).toBe(300);
    expect(w.stats.roads.highway).toBe(60);
    const { stepMs, recomputeMs } = measure(sim);
    // An old save settling: every tier back to $, then one batch.
    let settleMs = Infinity;
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) w.setWealth(i % MAP_SIZE, (i / MAP_SIZE) | 0, 0);
      sim.recomputeAll();
      const t0 = performance.now();
      sim.settleWealth();
      settleMs = Math.min(settleMs, performance.now() - t0);
    }
    console.info(`[perf] expansion: step ${stepMs.toFixed(3)} ms · recomputeAll ${recomputeMs.toFixed(3)} ms · settleWealth ${settleMs.toFixed(3)} ms`);
    expect(stepMs).toBeLessThan(2 * slack);
    expect(recomputeMs).toBeLessThan(10 * slack);
    expect(settleMs).toBeLessThan(5 * slack);
  });
});
