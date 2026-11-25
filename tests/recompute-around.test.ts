// O5 (docs/MEGACITY.md §3.3, §11.5 WP-1): after a player action, recomputeAround(rect) recomputes power, coverage
// and traffic in full and the local fields on rect ⊕ 12. On a freshly recomputed world, the fields inside
// rect ⊕ (12 − the largest stencil radius) equal a whole recomputeAll's within 1e-6, and the census matches.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/game/actions';
import { slotRect } from '../src/game/districts/slots';
import { Rng } from '../src/game/rng';
import { Simulation } from '../src/game/sim';
import type { ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { cachedMegacity, fillSlot } from './megacity-fixture';

/** Pollution's three blur passes reach 3 tiles; the neighbourhood blurs 2. */
const STENCIL = 3;
const AROUND = 12;
const KEYS = ['pollution', 'noise', 'landValue', 'crime', 'wealth', 'traffic', 'security', 'health', 'park', 'transit', 'education'] as const;

function sims(w: World): Simulation {
  const s = new Simulation(w);
  s.options.events = false;
  s.recomputeAll();
  return s;
}

describe('recomputeAround (§3.3, O5)', () => {
  it('random actions on a 4-district city (10 compared): fields inside rect ⊕ 9 equal recomputeAll, and the census matches', () => {
    const w = cachedMegacity(3, 4);
    const sim = sims(w);
    const rng = new Rng(41);
    const tools: ToolId[] = ['road', 'bulldoze', 'res', 'com', 'ind', 'precinct', 'clinic', 'plaza'];
    let compared = 0;
    let applied = 0;
    for (let k = 0; k < 400 && compared < 10; k++) {
      const box = w.ownedBox;
      const x = box.x0 + Math.floor(rng.next() * (box.x1 - box.x0 - 6));
      const y = box.y0 + Math.floor(rng.next() * (box.y1 - box.y0 - 6));
      const tool = tools[Math.floor(rng.next() * tools.length)];
      const to = { x: x + Math.floor(rng.next() * 5), y: y + Math.floor(rng.next() * 5) };
      // recomputeAll iterates land value and crime twice from the fields it finds, so the reference starts from the
      // same pre-action fields as the local recompute does.
      const pre: Record<string, Float32Array> = {};
      for (const [name, a] of Object.entries(w.fields)) pre[name] = (a as Float32Array).slice();
      if (!applyAction(w, tool, { x, y }, to).valid) continue;
      const rect = { x0: Math.min(x, to.x), y0: Math.min(y, to.y), x1: Math.max(x, to.x) + 2, y1: Math.max(y, to.y) + 2 };
      sim.recomputeAround(rect);
      // Every 4th applied action: the reference is the same city recomputed whole.
      if (++applied % 3 !== 0) {
        sim.recomputeAll();
        continue;
      }
      const ref = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
      for (const [name, a] of Object.entries(pre)) (ref.fields[name as keyof World['fields']] as Float32Array).set(a);
      sims(ref);
      const m = AROUND - STENCIL;
      const N = w.N;
      for (const key of KEYS) {
        const a = w.fields[key] as Float32Array;
        const b = ref.fields[key] as Float32Array;
        for (let yy = Math.max(0, rect.y0 - m); yy <= Math.min(N - 1, rect.y1 + m); yy++)
          for (let xx = Math.max(0, rect.x0 - m); xx <= Math.min(N - 1, rect.x1 + m); xx++) {
            const i = yy * N + xx;
            if (!w.ownedAt(i)) continue;
            if (Math.abs(a[i] - b[i]) > 1e-6) throw new Error(`action ${k} (${tool}): ${key} at ${xx},${yy}: ${a[i]} vs ${b[i]}`);
          }
      }
      for (const s of ['population', 'jobsCom', 'jobsInd', 'powerSupply', 'powerDemand', 'edgeLinks'] as const)
        expect([k, s, w.stats[s]]).toEqual([k, s, ref.stats[s]]);
      compared++;
      sim.recomputeAll();
    }
    expect(compared).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it('recomputeEconomy (the tax sliders) moves the budget and approval with the rate, no field changes', () => {
    const w = cachedMegacity(3, 1);
    const sim = sims(w);
    const lv = w.fields.landValue.slice();
    const before = w.budget.income;
    w.taxRate = Math.max(1, w.taxRate - 3);
    sim.recomputeEconomy();
    expect(w.budget.income).toBeLessThan(before);
    expect(Array.from(w.fields.landValue)).toEqual(Array.from(lv));
  });
});

describe('the partial scan after an action (§11.1: only rows a tile event touched)', () => {
  it('after random actions and sim days, scanChanged mirrors exactly what a whole scan does (arrays, counts, the zoned list, road caches)', () => {
    const w = cachedMegacity(3, 4);
    const sim = sims(w);
    const rng = new Rng(7);
    const tools: ToolId[] = ['road', 'bulldoze', 'res', 'ind', 'avenue' as ToolId, 'alley' as ToolId, 'precinct'];
    const keys = ['zone', 'level', 'abandoned', 'road', 'kind', 'wealth', 'water', 'bld', 'ground', 'blightW', 'roadDist', 'nearestRoad', 'linkMask', 'alleyNear', 'roadLv'] as const;
    for (let k = 0; k < 30; k++) {
      const box = w.ownedBox;
      const x = box.x0 + Math.floor(rng.next() * (box.x1 - box.x0 - 6));
      const y = box.y0 + Math.floor(rng.next() * (box.y1 - box.y0 - 6));
      applyAction(w, tools[k % tools.length], { x, y }, { x: x + Math.floor(rng.next() * 5), y });
      if (k % 3 === 0) sim.step();
      // An annex mid-way: the owned frame grows (the new slot's rows rescan, every other row keeps its shares).
      if (k === 15) {
        const s = [0, 1, 2, 3, 5, 6, 7, 8].find((q) => !w.slotOwned[q])!;
        w.annex(s);
      }
      const g = (sim as unknown as { grid: import('../src/game/sim/grid').SimGrid }).grid;
      g.scanChanged(w);
      const ref = new Simulation(w);
      const r = (ref as unknown as { grid: import('../src/game/sim/grid').SimGrid }).grid;
      r.scan(w, true);
      for (const key of keys) {
        const a = g[key] as ArrayLike<number>;
        const b = r[key] as ArrayLike<number>;
        let bad = -1;
        for (let i = 0; i < a.length && bad < 0; i++) if (a[i] !== b[i]) bad = i;
        expect(bad, `${key} after action ${k}`).toBe(-1);
      }
      expect([g.zonedCount, g.roadCount, g.bridgeCount, Array.from(g.kindCount)]).toEqual([r.zonedCount, r.roadCount, r.bridgeCount, Array.from(r.kindCount)]);
      expect(Array.from(g.zoned.subarray(0, g.zonedCount))).toEqual(Array.from(r.zoned.subarray(0, r.zonedCount)));
    }
  }, 60_000);
});

describe('recomputeAll keeps its caches only while their keys hold (§11.1: ≤ 30 ms at 25 districts)', () => {
  /** The SimGrid's road caches and the coverage fields a whole recompute writes. */
  const ROAD_ARRAYS = ['roadDist', 'nearestRoad', 'linkMask', 'alleyNear', 'hwComp', 'hwReach'] as const;
  const COVER = ['security', 'health', 'park', 'transit', 'education', 'resilience', 'filter'] as const;
  type Grid = Record<(typeof ROAD_ARRAYS)[number], ArrayLike<number>> & { edgePoints: number };
  const grid = (s: Simulation) => (s as unknown as { grid: Grid }).grid;
  function same(a: Simulation, b: Simulation, w: World, cover: Record<string, Float32Array>): void {
    for (const k of ROAD_ARRAYS) expect([k, Array.from(grid(a)[k])]).toEqual([k, Array.from(grid(b)[k])]);
    expect(grid(a).edgePoints).toBe(grid(b).edgePoints);
    for (const k of COVER) expect([k, Array.from(cover[k])]).toEqual([k, Array.from(w.fields[k] as Float32Array)]);
  }

  it('an annex rebuilds the road caches (access reaches the new land) and coverage, as a fresh Simulation does', () => {
    const w = new World(77, 'Caches', undefined, 3);
    w.funds = 1e9;
    w.maxPopulation = 1e9;
    fillSlot(w, 4);
    const sim = sims(w);
    for (let d = 0; d < 20; d++) sim.step();
    // Annex the slot east of the start: no new road, but access and regional links now see across the old border.
    w.annex(5);
    sim.recomputeAll();
    const cover: Record<string, Float32Array> = {};
    for (const k of COVER) cover[k] = (w.fields[k] as Float32Array).slice();
    const fresh = sims(w);
    same(sim, fresh, w, cover);
    // A clinic in the new slot (coverageVersion) and nothing else: the next recomputeAll follows it too.
    const r = slotRect(w, 5);
    let placed = false;
    for (let y = r.y0 + 2; y < r.y1 - 4 && !placed; y++)
      for (let x = r.x0 + 2; x < r.x1 - 4 && !placed; x++) placed = !!w.addBuilding('clinic', x, y);
    expect(placed).toBe(true);
    sim.recomputeAll();
    for (const k of COVER) cover[k] = (w.fields[k] as Float32Array).slice();
    same(sim, sims(w), w, cover);
  });

  it('with nothing changed, a recomputeAll equals a fresh Simulation (roads, links and coverage)', () => {
    const w = cachedMegacity(3, 2);
    const sim = sims(w);
    for (let d = 0; d < 12; d++) sim.step();
    sim.recomputeAll();
    const cover: Record<string, Float32Array> = {};
    for (const k of COVER) cover[k] = (w.fields[k] as Float32Array).slice();
    same(sim, sims(w), w, cover);
  });
});
