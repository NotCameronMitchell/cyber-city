import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, ZoneType } from '../src/game/types';
import { World } from '../src/game/world';
import { ScriptedMayor, act, flatWorld, makeSim, run } from './helpers';
import { LEGACY_REGION } from '../src/game/types';

/** Play `years` with the scripted mayor; funds are sampled every tick. */
function playthrough(world: World, years: number, events: boolean) {
  const sim = makeSim(world, events);
  const mayor = new ScriptedMayor(world, sim);
  mayor.opening();
  const months = years * MONTHS_PER_YEAR;
  for (let m = 0; m < months; m++) {
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      sim.step();
      mayor.observe();
    }
    mayor.turn();
  }
  return { sim, mayor };
}

describe('balance', () => {
  it('a sensible starter city at 9% tax is mildly profitable', () => {
    const w = flatWorld(31);
    const sim = makeSim(w);
    // A small street grid, ~40 zoned lots split R/C/I, and a solar farm.
    act(w, 'road', { x: 20, y: 20 }, { x: 36, y: 20 });
    act(w, 'road', { x: 20, y: 24 }, { x: 36, y: 24 });
    act(w, 'road', { x: 20, y: 20 }, { x: 20, y: 28 });
    act(w, 'road', { x: 28, y: 20 }, { x: 28, y: 24 });
    act(w, 'res', { x: 21, y: 21 }, { x: 27, y: 23 }); // 21 lots
    act(w, 'com', { x: 29, y: 21 }, { x: 32, y: 23 }); // 12 lots
    act(w, 'ind', { x: 21, y: 25 }, { x: 24, y: 27 }); // 12 lots, south of the homes
    act(w, 'solar', { x: 35, y: 22 });
    sim.recomputeAll();
    const spent = 25000 - w.funds;
    expect(spent).toBeLessThan(4000);
    run(sim, DAYS_PER_MONTH * 4);
    const last = w.budget.history.at(-1)!;
    expect(w.stats.population).toBeGreaterThan(1500); // ×10 units (MEGACITY §4)
    expect(last).toBeGreaterThan(0);
    // "Mildly": the city is not a money printer.
    expect(last).toBeLessThan(400);
  });

  it('five scripted years on a flat map: grows past 10,000 without going broke', () => {
    const w = flatWorld(2091);
    const { mayor } = playthrough(w, 5, true);
    expect(w.stats.population).toBeGreaterThan(10000);
    expect(mayor.lowestFunds).toBeGreaterThan(-2000);
    expect(w.milestones.length).toBeGreaterThanOrEqual(3);
    // A healthy city mixes all three zones and some density.
    expect(w.stats.developed.res).toBeGreaterThan(50);
    expect(w.stats.developed.com).toBeGreaterThan(20);
    expect(w.stats.developed.ind).toBeGreaterThan(15);
    expect(w.tiles.some((t) => t.zone === ZoneType.Residential && t.level >= 2)).toBe(true);
    expect(w.stats.approval).toBeGreaterThan(20);
  });

  it('five scripted years on generated terrain, events on, no exceptions', () => {
    for (const seed of [42, 1337]) {
      const w = World.generate(seed, 'Balance Bay', undefined, LEGACY_REGION);
      const { mayor } = playthrough(w, 5, true);
      expect(w.stats.population).toBeGreaterThan(10000);
      expect(mayor.lowestFunds).toBeGreaterThan(-2000);
      expect(Number.isFinite(w.funds)).toBe(true);
      for (const v of w.fields.landValue) expect(v >= 0 && v <= 1).toBe(true);
      expect(w.news.length).toBeGreaterThan(10);
    }
  });

  it('with events on, incidents happen every few months but never in the first quarter', () => {
    const w = flatWorld(8);
    const firsts: { tick: number; text: string }[] = [];
    w.events.on('news', (n) => {
      if (n.kind === 'bad' || n.text.includes('treasury') || n.text.includes('city account') || n.text.includes('city hall'))
        firsts.push({ tick: n.tick, text: n.text });
    });
    playthrough(w, 3, true);
    expect(firsts.length).toBeGreaterThan(3);
    expect(firsts.every((f) => f.tick >= 90)).toBe(true);
  });

  it('with events off, no incidents fire', () => {
    const w = flatWorld(8);
    let bad = 0;
    w.events.on('news', (n) => {
      if (n.kind === 'bad') bad++;
    });
    playthrough(w, 2, false);
    expect(bad).toBe(0);
    for (const b of w.buildings.values()) expect(b.offline).toBe(0);
  });
});
