import { describe, expect, it } from 'vitest';
import { fullyBuiltWorld, makeSim } from './helpers';

// Budgets from the module contract (Node, fully developed 64×64 map):
// step() < 2 ms on average, recomputeAll() < 10 ms.
describe('performance', () => {
  it('step() and recomputeAll() stay inside their budgets on a fully built map', () => {
    const w = fullyBuiltWorld();
    const sim = makeSim(w, true);
    expect(w.stats.population).toBeGreaterThan(20000);
    expect(w.buildings.size).toBeGreaterThan(30);

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

    console.info(`[perf] step ${stepMs.toFixed(3)} ms · recomputeAll ${recomputeMs.toFixed(3)} ms`);
    expect(stepMs).toBeLessThan(2);
    expect(recomputeMs).toBeLessThan(10);
  });
});
