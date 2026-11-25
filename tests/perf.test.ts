import { describe, expect, it } from 'vitest';
import { fullyBuiltWorld, makeSim } from './helpers';
import { expansionFixture } from './expansion-fixture';
import { SLICE } from '../src/game/config';
import { cachedMegacity, megacitySim, megacityWorld } from './megacity-fixture';

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

  // MEGACITY §11.1 (WP-1): the sim at 1, 9 and 25 districts (the megacity fixture: §2.1's fill per owned slot). Whole-day
  // step() and recomputeAll() are best-of-batches (the container is shared, §2.1); recomputeAround is the median of 12
  // small actions' rects, best of 3 rounds. Locally the megacity rows get 1.5× (the suite runs files in parallel), CI 3×.
  const mega = (globalThis as any).process?.env?.CI ? 3 : 1.5;
  const ROWS: [string, 3 | 5, number, { step: number; all: number; around: number }][] = [
    ['1 district (3×3)', 3, 1, { step: 1.0, all: 2, around: 1.5 }],
    ['9 districts (3×3)', 3, 9, { step: 4.5, all: 12, around: 5 }],
    ['25 districts (5×5)', 5, 25, { step: 12, all: 30, around: 8 }],
  ];
  it.each(ROWS)('§11.1 %s: step(), recomputeAll() and recomputeAround() within budget', (_name, region, n, budget) => {
    const w = megacityWorld(region, n);
    // With the district daily hook, as Game installs it (MEGACITY §3.3): the game's real day.
    const sim = megacitySim(w, true);
    for (let i = 0; i < 40; i++) sim.step();
    const batch = n >= 25 ? 15 : 40;
    let stepMs = Infinity;
    for (let b = 0; b < 4; b++) {
      const t0 = performance.now();
      for (let i = 0; i < batch; i++) sim.step();
      stepMs = Math.min(stepMs, (performance.now() - t0) / batch);
    }
    let allMs = Infinity;
    for (let b = 0; b < 4; b++) {
      const t0 = performance.now();
      sim.recomputeAll();
      allMs = Math.min(allMs, performance.now() - t0);
    }
    // recomputeAround: the median of 12 small actions' rects, best of 3 rounds (a busy container slows whole rounds).
    const o = 64 * ((region - 1) >> 1);
    let aroundMs = Infinity;
    for (let round = 0; round < 3; round++) {
      const around: number[] = [];
      for (let k = 0; k < 12; k++) {
        const x = o + (((k + round * 12) * 13) % 56);
        const y = o + (((k + round * 12) * 29) % 56);
        const t0 = performance.now();
        sim.recomputeAround({ x0: x, y0: y, x1: x + 3, y1: y + 3 });
        around.push(performance.now() - t0);
      }
      around.sort((a, b) => a - b);
      aroundMs = Math.min(aroundMs, around[around.length >> 1]);
    }
    console.info(`[perf] ${_name}: step ${stepMs.toFixed(2)} ms · recomputeAll ${allMs.toFixed(2)} ms · recomputeAround ${aroundMs.toFixed(2)} ms`);
    expect(stepMs).toBeLessThan(budget.step * mega);
    expect(allMs).toBeLessThan(budget.all * mega);
    expect(aroundMs).toBeLessThan(budget.around * mega);
  }, 120_000);

  // MEGACITY §11.1 row 3, the sim's half: a speed-3 run (16 days a second at 60 fps) with a frame guard that spreads each
  // day over frames: a budget of Simulation.dayEstimate × days per frame × 1.1 (plus a quarter of any backlog past 1.5
  // days), capped at the device class's cap. The per-frame sim work (stepSlice units) then stays near the average.
  // Game's guard (WP-2) and story.onDay add their own share; the device rows are measured on the device (§11.6).
  const PACE: [string, 3 | 5, number, number, { p95: number; max: number }][] = [
    ['1 district', 3, 1, SLICE.capHandheldMs, { p95: 2, max: 4 }],
    ['9 districts (handheld cap, Node)', 3, 9, SLICE.capHandheldMs, { p95: 4, max: 6 }],
    ['25 districts (PC)', 5, 25, SLICE.capPcMs, { p95: 6, max: 10 }],
  ];
  it.each(PACE)('§11.1 a speed-3 run, %s: per-frame sim work p95 and max within budget, no day dropped', (_name, region, n, cap, budget) => {
    const w = cachedMegacity(region, n);
    const sim = megacitySim(w, true);
    for (let i = 0; i < 20; i++) sim.step();
    const perFrame = 16 / 60;
    let dropped = 0;
    // Two rounds; each figure is its better round (a preempted frame on a busy container rarely repeats).
    // (Alone, at 25 districts: p95 ≈ 4.4 ms, max ≈ 5.3 ms; WP-1 report.)
    let p95 = Infinity;
    let max = Infinity;
    for (let round = 0; round < 2; round++) {
      let due = 0;
      let days = 0;
      const frames: number[] = [];
      while (days < (n >= 25 ? 60 : 90)) {
        due += perFrame;
        const t0 = performance.now();
        const est = sim.dayEstimate;
        const want = est > 0 ? est * perFrame * 1.1 + (due > 1.5 ? est * (due - 1.5) * 0.25 : 0) : cap;
        const frameBudget = Math.min(cap, Math.max(0.5, want));
        let ran = false;
        while (due >= 1 || sim.midDay) {
          const spent = performance.now() - t0;
          if (ran && spent >= frameBudget) break;
          ran = true;
          if (!sim.stepSlice(Math.max(0, frameBudget - spent))) break;
          due = Math.max(0, due - 1);
          days++;
        }
        frames.push(performance.now() - t0);
        if (due > 4) {
          dropped += Math.floor(due);
          due = 0;
        }
      }
      frames.sort((a, b) => a - b);
      p95 = Math.min(p95, frames[Math.ceil(0.95 * frames.length) - 1]);
      // The worst frame but one: on a shared container a single preempted frame is not the sim's.
      max = Math.min(max, frames[frames.length - 2]);
    }
    console.info(`[perf] speed 3, ${_name}: frame p95 ${p95.toFixed(2)} ms · max ${max.toFixed(2)} ms · day ${sim.dayEstimate.toFixed(2)} ms · dropped ${dropped}`);
    expect(p95).toBeLessThan(budget.p95 * mega);
    expect(max).toBeLessThan((budget.max + SLICE.unitMaxNodeMs) * mega);
    expect(dropped).toBe(0);
  }, 120_000);

  it('§11.1 a sliced day at 25 districts never spends more than the PC cap plus one unit in a frame', () => {
    const w = megacityWorld(5, 25);
    const sim = megacitySim(w, true);
    for (let i = 0; i < 20; i++) sim.step();
    // The worst frame of 20 sliced days, best of 2 rounds: a real overrun shows in both, a preempted frame on a busy
    // container rarely does.
    let worst = Infinity;
    for (let round = 0; round < 2; round++) {
      let roundWorst = 0;
      for (let d = 0; d < 20; d++)
        for (;;) {
          const t0 = performance.now();
          const done = sim.stepSlice(SLICE.capPcMs);
          roundWorst = Math.max(roundWorst, performance.now() - t0);
          if (done) break;
        }
      worst = Math.min(worst, roundWorst);
    }
    console.info(`[perf] 25 districts, sliced at the PC cap: worst frame ${worst.toFixed(2)} ms`);
    expect(worst).toBeLessThan((SLICE.capPcMs + SLICE.unitMaxNodeMs) * mega);
  }, 120_000);
});
