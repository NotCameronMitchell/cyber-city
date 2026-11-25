// O3 (docs/MEGACITY.md §3.3, §11.5 WP-1): coverage is cached on (coverageVersion, slots, securityMul, the layer
// compose count, a building signature); toggling every input changes the cached fields exactly as an uncached pass.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/game/actions';
import { FieldSystem, EFFECTS } from '../src/game/sim/fields';
import { SimGrid } from '../src/game/sim/grid';
import { PowerGrid } from '../src/game/sim/power';
import { composeLayers } from '../src/game/story/mods';
import type { World } from '../src/game/world';
import { megacitySim, megacityWorld } from './megacity-fixture';

/** An uncached coverage pass over the same world (own grid, power and fields). */
function uncached(w: World): Record<string, Float32Array> {
  const g = new SimGrid(w);
  g.scan(w, true);
  // Power is not recomputed (buildings keep the powered flags the sim gave them); coverage reads those flags.
  const f = new FieldSystem(w);
  const saved: Record<string, Float32Array> = {};
  for (const e of EFFECTS) saved[e] = (w.fields[e] as Float32Array).slice();
  f.coverage(w, g);
  const out: Record<string, Float32Array> = {};
  for (const e of EFFECTS) {
    out[e] = (w.fields[e] as Float32Array).slice();
    (w.fields[e] as Float32Array).set(saved[e]);
  }
  void PowerGrid;
  return out;
}

function diff(w: World): string[] {
  const ref = uncached(w);
  const bad: string[] = [];
  for (const e of EFFECTS) {
    const a = w.fields[e] as Float32Array;
    const b = ref[e];
    for (let i = 0; i < a.length; i++)
      if (w.ownedAt(i) && a[i] !== b[i]) {
        bad.push(`${e} at ${i}: ${a[i]} vs ${b[i]}`);
        break;
      }
  }
  return bad;
}

describe('O3 coverage cache (§3.3)', () => {
  it('every input: add, remove, stage, crown, sponsor, look, offline, powered, securityMul, transitAdd, parkAdd, annex', () => {
    const w = megacityWorld(3, 2);
    const sim = megacitySim(w);
    sim.step();
    expect(diff(w)).toEqual([]);
    const services = () => [...w.buildings.values()].filter((b) => b.type === 'precinct' || b.type === 'clinic' || b.type === 'plaza');
    const cases: [string, () => void][] = [
      ['a quiet day (cache hit)', () => {}],
      ['a building added', () => {
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.clearTile(70 + dx, 70 + dy);
        w.addBuilding('clinic', 70, 70);
      }],
      ['a building removed', () => w.removeBuilding(services()[0].id)],
      ['offline', () => (services()[1].offline = 20)],
      ['back online', () => (services()[1].offline = 0)],
      ['look', () => (services()[2].look = 2)],
      ['sponsor', () => (services()[2].sponsor = 'nacre')],
      ['crown', () => (services()[2].crown = 'nest' as never)],
      ['stage', () => (services()[3].stage = 2)],
      ['unpowered (plants offline)', () => {
        for (const b of w.buildings.values()) if (b.type === 'reactor') b.offline = 40;
      }],
      ['powered again', () => {
        for (const b of w.buildings.values()) if (b.type === 'reactor') b.offline = 0;
      }],
      ['securityMul', () => (w.mods.securityMul = 1.4)],
      ['transitAdd layer', () => {
        w.layerParts.local.transitAdd.fill(0.3, 80 * w.N + 64, 80 * w.N + 120);
        composeLayers(w, true); // written in place, without a reset
      }],
      ['parkAdd district layer', () => {
        w.layerParts.district.parkAdd.fill(0.5, 90 * w.N + 64, 90 * w.N + 100);
        composeLayers(w, true);
      }],
      ['an annex', () => {
        w.annex(1);
        sim.recomputeAll();
      }],
      ['a service placed by a tool on the new land', () => {
        applyAction(w, 'res', { x: 90, y: 40 }, { x: 92, y: 42 });
        applyAction(w, 'precinct', { x: 95, y: 40 }, { x: 95, y: 40 });
      }],
    ];
    for (const [name, act] of cases) {
      act();
      sim.step();
      expect([name, diff(w)]).toEqual([name, []]);
    }
  });

  it('the cache holds on quiet days: coverage runs only when its key moves', () => {
    const w = megacityWorld(3, 1);
    const sim = megacitySim(w);
    let runs = 0;
    const f = (sim as unknown as { fields: FieldSystem }).fields;
    const orig = f.coverageUnit.bind(f);
    f.coverageUnit = function* (...a: Parameters<FieldSystem['coverageUnit']>) {
      runs++;
      yield* orig(...a);
    };
    for (let d = 0; d < 20; d++) sim.step();
    const quiet = runs;
    w.mods.securityMul = 1.2;
    sim.step();
    expect(runs).toBe(quiet + 1);
    expect(quiet).toBeLessThanOrEqual(3);
  });
});
