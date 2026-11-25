// Tick slicing (docs/MEGACITY.md §3.3, §11.5 WP-1): a sliced day equals a whole step() exactly, wherever the units
// stop; stats and the sim's events publish only when C2 completes; every atomic step stays small at 25 districts.

import { describe, expect, it } from 'vitest';
import { SLICE } from '../src/game/config';
import { Simulation } from '../src/game/sim';
import { Rng } from '../src/game/rng';
import '../src/game/story/turf'; // registers the banded turf month (O6), as the game does
import { World } from '../src/game/world';
import { cachedMegacity, megacitySim } from './megacity-fixture';
import { ScriptedMayor, flatWorld } from './helpers';

/** A save without its wall-clock stamp. */
function snapshot(w: World): string {
  const d = w.serialize() as unknown as Record<string, unknown>;
  delete d.savedAt;
  return JSON.stringify(d);
}

function fieldsEqual(a: World, b: World): string[] {
  const bad: string[] = [];
  for (const k of Object.keys(a.fields) as (keyof World['fields'])[]) {
    const x = a.fields[k] as Float32Array;
    const y = b.fields[k] as Float32Array;
    for (let i = 0; i < x.length; i++)
      if (x[i] !== y[i]) {
        bad.push(`${k} at ${i}`);
        break;
      }
  }
  return bad;
}

/** Two copies of the same world, each with its own sim. */
function twins(make: () => World): [World, Simulation, World, Simulation] {
  // Both from the same save: a fresh world and its deserialized copy differ in world.version, which seeds the
  // variant rolls of later placements.
  const json = JSON.stringify(make().serialize());
  const a = World.deserialize(JSON.parse(json));
  const b = World.deserialize(JSON.parse(json));
  const sa = new Simulation(a);
  const sb = new Simulation(b);
  sa.options.events = sb.options.events = true;
  sa.recomputeAll();
  sb.recomputeAll();
  return [a, sa, b, sb];
}

describe('a sliced day equals a whole step() (§3.3)', () => {
  it('a growing city, 1.5 sim years: units stopped at random steps (budgets 0–0.3 ms) end in the identical save and fields', () => {
    const [a, sa, b, sb] = twins(() => flatWorld(2091));
    const ma = new ScriptedMayor(a, sa);
    const mb = new ScriptedMayor(b, sb);
    ma.opening();
    mb.opening();
    const rng = new Rng(5);
    let calls = 0;
    for (let d = 0; d < 540; d++) {
      sa.step();
      for (;;) {
        calls++;
        if (sb.stepSlice(rng.next() < 0.5 ? 0 : rng.next() * 0.3)) break;
      }
      if (a.tick % 30 === 0) {
        ma.turn();
        ma.observe();
        mb.turn();
        mb.observe();
      }
    }
    expect(calls).toBeGreaterThan(540 * 4);
    expect(a.stats.population).toBeGreaterThan(20000);
    expect(fieldsEqual(a, b)).toEqual([]);
    expect(snapshot(b)).toBe(snapshot(a));
  }, 60_000);

  it('a 3×3 city with several districts (cross-border grids), sliced one step per call: identical after 90 days', () => {
    const [a, sa, b, sb] = twins(() => cachedMegacity(3, 4));
    for (let d = 0; d < 90; d++) {
      sa.step();
      while (!sb.stepSlice(0));
      // Player actions between days (a road cut, a new road: a relabel resumed across steps next day).
      if (d === 30 || d === 60) {
        for (const w of [a, b]) {
          w.clearTile(100, 70 + (d % 7));
          w.setRoad(101, 90);
        }
      }
    }
    expect(fieldsEqual(a, b)).toEqual([]);
    expect(snapshot(b)).toBe(snapshot(a));
  }, 60_000);

  it('stats, the budget and the month event publish only when the day completes (unit C2)', () => {
    const w = cachedMegacity(3, 1);
    const sim = megacitySim(w);
    const to = w.tick - (w.tick % 30) + 29;
    while (w.tick < to) sim.step();
    // The next day ends the month.
    const months: number[] = [];
    w.events.on('month', () => months.push(w.tick));
    const pop = w.stats.population;
    const income = w.budget.income;
    const before = JSON.stringify(w.stats);
    let steps = 0;
    while (!sim.stepSlice(0)) {
      steps++;
      expect(JSON.stringify(w.stats)).toBe(before);
      expect(w.budget.income).toBe(income);
      expect(months).toEqual([]);
      expect(sim.midDay).toBe(true);
    }
    expect(steps).toBeGreaterThan(10);
    expect(months).toEqual([w.tick]);
    expect(sim.midDay).toBe(false);
    void pop;
  });
});

describe('unit sizes (§3.3: SLICE.unitMaxNodeMs at 25 districts)', () => {
  it('every step kind of a sliced day on the 25-district fixture: median ≤ unitMaxNodeMs (with the suite's slack), p90 within twice that', () => {
    const w = cachedMegacity(5, 25);
    const sim = megacitySim(w);
    // A month first, so every step kind (the turf bands included) has run warm once.
    for (let d = 0; d < 30; d++) while (!sim.stepSlice(0));
    const samples = new Map<number, number[]>();
    const book = sim.costBook;
    const add = book.add.bind(book);
    book.add = (k, ms) => {
      let a = samples.get(k);
      if (!a) samples.set(k, (a = []));
      a.push(ms);
      add(k, ms);
    };
    for (let d = 0; d < 34; d++) while (!sim.stepSlice(0));
    // The suite runs files in parallel on a shared container: medians get 1.5× (CI 3×, EXPANSION's slack), the p90
    // twice that. Alone, every kind's median is ≤ 1.5 ms (WP-1 report).
    const slack = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.CI ? 3 : 1.5;
    const rows: string[] = [];
    for (const [k, a] of samples) {
      a.sort((x, y) => x - y);
      const med = a[a.length >> 1];
      const p90 = a[Math.floor(a.length * 0.9)];
      if (med > SLICE.unitMaxNodeMs * slack || p90 > SLICE.unitMaxNodeMs * 2 * slack) rows.push(`kind ${k}: median ${med.toFixed(2)} p90 ${p90.toFixed(2)} ms (n ${a.length})`);
    }
    expect(rows).toEqual([]);
  }, 120_000);
});
