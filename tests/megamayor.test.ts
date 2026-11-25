// The megacity fixture's mayor (docs/MEGACITY.md §11.4, WP-1; Step 9 runs D1 / D1-5 with it under the PACING harness):
// a ScriptedMayor per district on its own grid, annexing in a fixed kind order. On both regions each annexed district
// grows (D5's reading: its first blocks develop within 60 days of getting road and power), the city keeps growing and
// the run is deterministic.

import { describe, expect, it } from 'vitest';
import { slotRect } from '../src/game/districts/slots';
import { Simulation } from '../src/game/sim';
import type { Region } from '../src/game/types';
import { World } from '../src/game/world';
import { MEGA_KIND_ORDER, MegaMayor } from './megacity-fixture';

function city(region: Region) {
  const w = World.generate(2091, 'Mega', undefined, region);
  // D5 is about growth, not money (the PACING harness and the grants are Step 9's).
  w.funds = 5_000_000;
  const sim = new Simulation(w);
  sim.options.events = false;
  sim.recomputeAll();
  const mm = new MegaMayor(w, sim);
  mm.opening();
  return { w, sim, mm };
}

describe.each([
  ['3×3', 3],
  ['5×5', 5],
] as [string, Region][])('MegaMayor on a %s region', (_name, region) => {
  it('annexes in the fixed kind order, every new district develops within 60 days, and the run repeats exactly', () => {
    const run = () => {
      const { w, sim, mm } = city(region);
      const grew: number[] = [];
      let pop4 = 0;
      for (let m = 1; m <= 16; m++) {
        if (m === 4) pop4 = w.stats.population;
        if (m % 4 === 0) {
          const cand = mm.candidates();
          const s = mm.annexNext();
          expect(s).toBe(cand[0]);
          expect(MEGA_KIND_ORDER.indexOf(w.districts.kinds[s])).toBeGreaterThanOrEqual(0);
          // D5: the new mayor's blocks (its grid, 10 tiles into the slot; annex content aside) develop within 60 days.
          const r = slotRect(w, s);
          const built = () => {
            let n = 0;
            for (let y = r.y0 + 10; y <= r.y0 + 54; y++)
              for (let x = r.x0 + 10; x <= r.x0 + 54; x++) {
                const t = w.tileAt(x, y)!;
                if (t.zone && t.level > 0 && !t.abandoned) n++;
              }
            return n;
          };
          const before = built();
          let first = -1;
          for (let d = 1; d <= 60 && first < 0; d++) {
            sim.step();
            if (built() > before) first = d;
          }
          grew.push(first);
        } else for (let d = 0; d < 30; d++) sim.step();
        mm.turn();
      }
      return { w, grew, pop4, json: JSON.stringify({ ...w.serialize(), savedAt: 0 }) };
    };
    const a = run();
    console.info(`[megamayor] ${_name}: first development after ${a.grew.join(', ')} days; ${a.w.stats.population} residents; owned ${a.w.districts.owned.map((s) => a.w.districts.kinds[s]).join(' ')}`);
    expect(a.w.districts.owned.length).toBe(5);
    expect(a.grew.every((d) => d > 0 && d <= 60)).toBe(true);
    expect(a.w.stats.population).toBeGreaterThan(1.5 * a.pop4);
    for (const d of a.w.stats.districts) expect([d.slot, d.developed > 0]).toEqual([d.slot, true]);
    const b = run();
    expect(b.json).toBe(a.json);
  }, 120_000);
});
