// Tick slicing (docs/MEGACITY.md §3.3, §11.5 WP-1): a sliced day equals a whole step() exactly, wherever the units
// stop; stats and the sim's events publish only when C2 completes; every atomic step stays small at 25 districts.

import { describe, expect, it } from 'vitest';
import { SLICE } from '../src/game/config';
import { FIELD_STAGGER, FIELD_STAGGER_FROM, FIELD_STAGGER_SMALL } from '../src/game/sim/tuning';
import { Simulation } from '../src/game/sim';
import { Rng } from '../src/game/rng';
import '../src/game/story/turf'; // registers the banded turf month (O6), as the game does
import { World } from '../src/game/world';
import { cachedMegacity, megacitySim } from './megacity-fixture';
import { ScriptedMayor, flatWorld } from './helpers';

// Step kinds of sim/slice.ts K (a const enum, so its values are spelled out here): TrafficRows, PolSrc, LvRows, CrimeRows.
const K_TRAFFIC = 18;
const K_POL = 21; // PolSrc (the neighbourhood blur shares PolBlur)
const K_LV = 31;
const K_CRIME = 32;

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

describe('the field stagger follows the city size (§3.3, O4)', () => {
  it('2 on a one-district city (today\'s phases), 4 from FIELD_STAGGER_FROM districts; a set value wins until null', () => {
    const w = new World(5, 'Stagger', undefined, 3);
    const sim = new Simulation(w);
    expect(w.districts.owned.length).toBe(1);
    expect(sim.fieldStagger).toBe(FIELD_STAGGER_SMALL);
    w.annex(5);
    expect(w.districts.owned.length).toBeGreaterThanOrEqual(FIELD_STAGGER_FROM);
    expect(sim.fieldStagger).toBe(FIELD_STAGGER);
    sim.fieldStagger = 2;
    expect(sim.fieldStagger).toBe(2);
    sim.fieldStagger = null;
    expect(sim.fieldStagger).toBe(4);
    // A legacy 64 frame is one district.
    expect(new Simulation(new World(5, 'Legacy', undefined, 1)).fieldStagger).toBe(2);
  });

  it('at stagger 4 each field pass runs once every 4 days, in O4\'s phase order', () => {
    const w = cachedMegacity(3, 3);
    const sim = megacitySim(w);
    expect(sim.fieldStagger).toBe(4);
    const seen: string[][] = [];
    for (let d = 0; d < 8; d++) {
      const kinds = new Set<number>();
      for (;;) {
        const done = sim.stepSlice(0);
        kinds.add(sim.lastSlice.maxKind);
        if (done) break;
      }
      const phase: string[] = [];
      if (kinds.has(K_TRAFFIC)) phase.push('traffic');
      if (kinds.has(K_POL)) phase.push('pollution');
      if (kinds.has(K_LV)) phase.push('landValue');
      if (kinds.has(K_CRIME)) phase.push('crime');
      seen.push(phase);
    }
    const order = seen.map((p) => p.join('+'));
    const start = order.indexOf('traffic');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(order.slice(start, start + 4)).toEqual(['traffic', 'pollution', 'landValue', 'crime']);
  });
});

describe('unit sizes (§3.3: SLICE.unitMaxNodeMs at 25 districts)', () => {
  it('every step kind of a sliced day on the 25-district fixture: median ≤ unitMaxNodeMs (with the suite slack), p90 within twice that', () => {
    const w = cachedMegacity(5, 25);
    const sim = megacitySim(w);
    // A month first, so every step kind (the turf bands included) has run warm once.
    for (let d = 0; d < 30; d++) while (!sim.stepSlice(0));
    // Best of 3 rounds (the perf tests' best-of-batches): a round is a sliced month (its 8 turf band days included),
    // and a kind's figure is its median in its best round.
    const book = sim.costBook;
    const add = book.add.bind(book);
    let samples = new Map<number, number[]>();
    book.add = (k, ms) => {
      let a = samples.get(k);
      if (!a) samples.set(k, (a = []));
      a.push(ms);
      add(k, ms);
    };
    const best = new Map<number, { med: number; p90: number; n: number }>();
    for (let round = 0; round < 3; round++) {
      samples = new Map();
      for (let d = 0; d < 30; d++) while (!sim.stepSlice(0));
      for (const [k, a] of samples) {
        a.sort((x, y) => x - y);
        const med = a[a.length >> 1];
        const p90 = a[Math.floor(a.length * 0.9)];
        const b = best.get(k);
        // Each figure is its best round's (the p90 of a kind with 8 samples a month is its slowest one).
        if (!b) best.set(k, { med, p90, n: a.length });
        else best.set(k, { med: Math.min(b.med, med), p90: Math.min(b.p90, p90), n: a.length });
      }
    }
    // The suite runs files in parallel on a shared container: medians get 1.5× (CI 3×, EXPANSION's slack), the p90
    // twice that. Alone, every kind's median is ≤ 1.5 ms (WP-1 report).
    const slack = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.CI ? 3 : 1.5;
    const rows: string[] = [];
    for (const [k, b] of best)
      if (b.med > SLICE.unitMaxNodeMs * slack || b.p90 > SLICE.unitMaxNodeMs * 2 * slack)
        rows.push(`kind ${k}: median ${b.med.toFixed(2)} p90 ${b.p90.toFixed(2)} ms (n ${b.n})`);
    expect(rows).toEqual([]);
  }, 120_000);
});
