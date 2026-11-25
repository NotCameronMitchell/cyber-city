// O5 (docs/MEGACITY.md §3.3, §11.5 WP-1): after a player action, recomputeAround(rect) recomputes power, coverage
// and traffic in full and the local fields on rect ⊕ 12. On a freshly recomputed world, the fields inside
// rect ⊕ (12 − the largest stencil radius) equal a whole recomputeAll's within 1e-6, and the census matches.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/game/actions';
import { Rng } from '../src/game/rng';
import { Simulation } from '../src/game/sim';
import type { ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { cachedMegacity } from './megacity-fixture';

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
