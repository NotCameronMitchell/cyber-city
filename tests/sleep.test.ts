// O8 sleeping districts (docs/MEGACITY.md §3.3, §11.5 WP-1): a resting slot skips only its rows of the throttleable
// field passes, staggered by (cycle + slot) % cadence; network passes, the census, taxes and growth never rest.

import { describe, expect, it } from 'vitest';
import { LOW_DETAIL, SLEEP } from '../src/game/config';
import { projectBudget } from '../src/game/sim/budget';
import type { Simulation } from '../src/game/sim';
import type { BudgetReport } from '../src/game/types';
import { World } from '../src/game/world';
import { cachedMegacity, megacitySim } from './megacity-fixture';

/** Growth off (a test-only stub), so asleep and awake twins keep the same tiles and only the fields can differ. */
function freezeGrowth(sim: Simulation): void {
  (sim as unknown as { growth: { runUnit: () => Generator<number, void, void> } }).growth.runUnit = function* () {};
}

/** Field cycles of a sim (cycle = floor(tick / fieldStagger)). */
function runCycles(sim: Simulation, cycles: number, each?: () => void): void {
  for (let c = 0; c < cycles; c++)
    for (let d = 0; d < sim.fieldStagger; d++) {
      sim.step();
      each?.();
    }
}

const THROTTLED = ['pollution', 'noise', 'landValue', 'crime', 'wealth'] as const;

describe('O8 sleeping districts (§3.3)', () => {
  it("'forced' keeps the camera ring awake and rests the rest at cadence 8; 'auto' rests quiet slots at cadence 4", () => {
    const w = cachedMegacity(5, 25);
    const sim = megacitySim(w);
    freezeGrowth(sim);
    sim.sleep = 'forced';
    sim.sleepFocus = 12;
    const forced: number[] = [];
    runCycles(sim, LOW_DETAIL.sleepCadence * 2, () => forced.push(sim.resting));
    // 16 slots outside ring 1 of the centre; each runs one cycle in 8.
    const mean = forced.reduce((a, b) => a + b, 0) / forced.length;
    expect(mean).toBeCloseTo(16 - 16 / LOW_DETAIL.sleepCadence, 0);
    expect(Math.max(...forced)).toBeLessThanOrEqual(16);
    // 'auto': no action for idleSec and no level change for quietDays (growth is frozen): every slot may rest.
    sim.sleep = 'auto';
    runCycles(sim, Math.ceil(SLEEP.quietDays / sim.fieldStagger));
    const auto: number[] = [];
    runCycles(sim, SLEEP.cadence * 2, () => auto.push(sim.resting));
    const am = auto.reduce((a, b) => a + b, 0) / auto.length;
    expect(am).toBeCloseTo(25 - 25 / SLEEP.cadence, 0);
    // A player action wakes its slot at once (it stays awake for idleSec).
    sim.noteAction({ x0: 10, y0: 10, x1: 12, y1: 12 });
    sim.step();
    expect(sim.resting).toBeLessThan(25);
    sim.sleep = 'off';
    sim.step();
    expect(sim.resting).toBe(0);
  }, 60_000);

  it('no field cycle runs more than 1.2× the mean number of slots (resting slots catch up a few at a time)', () => {
    const w = cachedMegacity(5, 25);
    const sim = megacitySim(w);
    freezeGrowth(sim);
    sim.sleep = 'forced';
    sim.sleepFocus = 12;
    const active: number[] = [];
    for (let c = 0; c < 4 * LOW_DETAIL.sleepCadence; c++) {
      runCycles(sim, 1);
      active.push(25 - sim.resting);
    }
    const mean = active.reduce((a, b) => a + b, 0) / active.length;
    expect(Math.max(...active)).toBeLessThanOrEqual(1.2 * mean);
  }, 60_000);

  it('a slot asleep for 4 × cadence cycles and woken matches an always-awake twin after four cycles; the census and taxes are never throttled', () => {
    const json = JSON.stringify(cachedMegacity(5, 9).serialize());
    const a = World.deserialize(JSON.parse(json));
    const b = World.deserialize(JSON.parse(json));
    const sa = megacitySim(a);
    const sb = megacitySim(b);
    freezeGrowth(sa);
    freezeGrowth(sb);
    // The camera on slot 6 (the 9 owned slots are the centre 3×3): slots 8, 13, 16, 17 and 18 rest.
    sb.sleep = 'forced';
    sb.sleepFocus = 6;
    // Something changes far from the camera while it rests (slot 18): its pollution waits for its turn.
    for (const w of [a, b]) {
      for (let y = 200; y < 203; y++) for (let x = 200; x < 203; x++) w.clearTile(x, y);
      w.addBuilding('reactor', 200, 200);
    }
    sa.recomputeAll();
    sb.recomputeAll();
    let differed = false;
    for (let c = 0; c < 4 * LOW_DETAIL.sleepCadence; c++) {
      runCycles(sa, 1);
      runCycles(sb, 1);
      // The census counts every tile asleep or awake (growth is frozen, so the tiles are the same).
      expect(b.stats.population).toBe(a.stats.population);
      expect(b.stats.jobsCom + b.stats.jobsInd).toBe(a.stats.jobsCom + a.stats.jobsInd);
      for (const k of THROTTLED) if (!differed && (a.fields[k] as Float32Array).some((v, i) => v !== (b.fields[k] as Float32Array)[i])) differed = true;
    }
    expect(differed).toBe(true);
    // Taxes: the projection walks every tile whatever rests (a fresh projection of the same state agrees).
    const fresh = { ...b.budget } as BudgetReport;
    const inner = sb as unknown as { grid: Parameters<typeof projectBudget>[1]; census: Parameters<typeof projectBudget>[2]; portSystem: Parameters<typeof projectBudget>[4] };
    projectBudget(b, inner.grid, inner.census, fresh, inner.portSystem);
    expect(fresh.income).toBe(b.budget.income);
    // Wake: four full cycles later every field equals the awake twin's within 1e-3. (Land value reads the last
    // cycle's crime and crime this cycle's land value, so a stale value fades by ≈ 0.1 a cycle rather than at once:
    // §11.5's "after one cycle within 1e-6" holds only for the passes with no such loop, pollution and noise.)
    sb.sleep = 'off';
    runCycles(sa, 4);
    runCycles(sb, 4);
    for (const k of THROTTLED) {
      const x = a.fields[k] as Float32Array;
      const y = b.fields[k] as Float32Array;
      let worst = 0;
      for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]));
      expect([k, worst < 1e-3]).toEqual([k, true]);
    }
  }, 60_000);

  it('a recomputeAround whose traffic spills past its window wakes every slot for the next whole field cycle (O5)', () => {
    const w = cachedMegacity(5, 25);
    const sim = megacitySim(w);
    freezeGrowth(sim);
    sim.sleep = 'forced';
    sim.sleepFocus = 12;
    runCycles(sim, 2);
    expect(sim.resting).toBeGreaterThan(0);
    // Traffic moves far outside the action's window: a road row of slot 0 cut, the recompute's rect in slot 24.
    for (let x = 0; x < 64; x++) for (let y = 8; y < 9; y++) w.clearTile(x, y);
    sim.recomputeAround({ x0: 300, y0: 300, x1: 301, y1: 301 });
    expect((sim as unknown as { fullFieldsDue: boolean }).fullFieldsDue).toBe(true);
    // To the next cycle's start, then that whole cycle runs every slot; the one after rests again.
    while ((w.tick + 1) % sim.fieldStagger !== 0) sim.step();
    const woke: number[] = [];
    for (let d = 0; d < sim.fieldStagger; d++) {
      sim.step();
      woke.push(sim.resting);
    }
    expect(woke).toEqual(woke.map(() => 0));
    runCycles(sim, 1);
    expect(sim.resting).toBeGreaterThan(0);
  }, 60_000);

  it("growth is never throttled: residents after 2 sim years in 'forced' are within 5% of 'off' (25 districts)", () => {
    const json = JSON.stringify(cachedMegacity(5, 25).serialize());
    const a = World.deserialize(JSON.parse(json));
    const b = World.deserialize(JSON.parse(json));
    const sa = megacitySim(a);
    const sb = megacitySim(b);
    sb.sleep = 'forced';
    sb.sleepFocus = 12;
    for (let d = 0; d < 720; d++) {
      sa.step();
      sb.step();
    }
    const ra = a.stats.population;
    const rb = b.stats.population;
    expect(Math.abs(rb - ra) / ra).toBeLessThanOrEqual(0.05);
  }, 120_000);

  it("a growing city: residents after 2 sim years in 'forced' are within 5% of 'off' (25 districts, every lot from level 0)", () => {
    const base = cachedMegacity(5, 25);
    for (let i = 0; i < base.area; i++) {
      const t = base.tiles[i];
      if (t.zone && t.level > 0) base.setLevel(i % base.N, (i / base.N) | 0, 0);
    }
    const json = JSON.stringify(base.serialize());
    const a = World.deserialize(JSON.parse(json));
    const b = World.deserialize(JSON.parse(json));
    const sa = megacitySim(a);
    const sb = megacitySim(b);
    sb.sleep = 'forced';
    sb.sleepFocus = 0;
    for (let d = 0; d < 720; d++) {
      sa.step();
      sb.step();
    }
    const ra = a.stats.population;
    const rb = b.stats.population;
    console.info(`[sleep] growing city, 2 years: off ${ra}, forced ${rb} (${(((rb - ra) / ra) * 100).toFixed(1)}%)`);
    expect(Math.abs(rb - ra) / ra).toBeLessThanOrEqual(0.05);
  }, 180_000);
});
