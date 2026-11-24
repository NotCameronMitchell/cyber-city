import { describe, expect, it } from 'vitest';
import { fullyBuiltWorld, makeSim } from './helpers';
import { expansionFixture } from './expansion-fixture';
import { toV3 } from './legacy-save';
import { World } from '../src/game/world';

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
      for (let i = 0; i < w.area; i++) w.setWealth(i % w.N, (i / w.N) | 0, 0);
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

  // MEGACITY Step 0b (§12 perf note): a one-district 3×3 city still pays the empty area of its locked slots (§2.3) until
  // WP-1's owned-segment loops (O1) skip them. Temporary budgets: step < 5 ms, recomputeAll < 15 ms. WP-1 restores §11.1
  // (≤ 1.0 ms a step for one district) and replaces this case.
  it('a fully built start slot on a 3×3 region (temporary Step 0b budgets until WP-1)', () => {
    const legacy = fullyBuiltWorld();
    const w = World.deserialize(toV3(JSON.parse(JSON.stringify(legacy.serialize()))));
    expect([w.region, w.N]).toEqual([3, 192]);
    const sim = makeSim(w, true);
    const { stepMs, recomputeMs } = measure(sim);
    console.info(`[perf] 3×3, one district: step ${stepMs.toFixed(3)} ms · recomputeAll ${recomputeMs.toFixed(3)} ms`);
    expect(w.stats.population).toBeGreaterThan(200_000);
    expect(stepMs).toBeLessThan(5 * slack);
    expect(recomputeMs).toBeLessThan(15 * slack);
  });
});
