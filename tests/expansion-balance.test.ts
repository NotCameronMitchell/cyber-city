// Expansion balance in the regular suite (docs/EXPANSION.md §10.3, §10.5): the targets that are
// cheap enough to run every time, on one seed. The full three-seed tables come from
// tests/expansion-measure.test.ts (MEASURE=1); §10.5 records them.
//
// B4 is the one §10.3 names for this file: a well-served city (M2: academies, plazas, clinics,
// precincts) must not trail the plain scripted mayor (M1) in population or chapter timing, so a
// player who follows the Wealth advice never watches the population fall. The same two runs
// also hold B2, B3 and B10 for this seed. B13 (capped power terms) costs nothing.

import { describe, expect, it } from 'vitest';
import { POWER_WEIGHTS } from '../src/game/config';
import { powerWeight } from '../src/game/story/factions';
import { World } from '../src/game/world';
import { fabUpShare, playScenario, resComSplit, type ScenarioResult } from './expansion-fixture';
import { flatWorld } from './helpers';

const SEED = 2091;
const YEARS = 8;

let cache: { m1: ScenarioResult; m2: ScenarioResult } | null = null;
function runs(): { m1: ScenarioResult; m2: ScenarioResult } {
  if (!cache) cache = { m1: playScenario(flatWorld(SEED), YEARS, {}), m2: playScenario(flatWorld(SEED), YEARS, { richServices: true }) };
  return cache;
}

describe(`expansion balance, flat seed ${SEED}, ${YEARS} years (§10.3)`, () => {
  it('B4: the well-served city (M2) keeps up with the plain mayor (M1): population, chapter goals, money, approval', { timeout: 120_000 }, () => {
    const { m1, m2 } = runs();
    // Population ≥ M1 − 3%.
    expect(m2.pop).toBeGreaterThanOrEqual(Math.floor(m1.pop * 0.97));
    // Every chapter population goal M1 reaches (3,000 and 7,000 on a flat map), M2 reaches no more than 30 days later.
    for (const goal of [3000, 7000]) {
      expect(m1.reach[goal], `M1 reaches ${goal}`).toBeGreaterThan(0);
      expect(m2.reach[goal], `M2 reaches ${goal}`).toBeGreaterThan(0);
      expect(m2.reach[goal] - m1.reach[goal], `days behind M1 at ${goal}`).toBeLessThanOrEqual(30);
    }
    // Money is the reward: net monthly income ≥ +20%; approval ≥ M1 − 2.
    expect(m2.net).toBeGreaterThanOrEqual(m1.net * 1.2);
    expect(m2.approval).toBeGreaterThanOrEqual(m1.approval - 2);
  });

  it('B2 / B3: the plain city is mostly $, the well-served one mostly $$ with a $$$ core and upgraded Fab', { timeout: 120_000 }, () => {
    const { m1, m2 } = runs();
    const [a1, b1, c1] = resComSplit(m1);
    expect(a1).toBeGreaterThanOrEqual(55);
    expect(a1).toBeLessThanOrEqual(80);
    expect(b1).toBeGreaterThanOrEqual(20);
    expect(b1).toBeLessThanOrEqual(40);
    expect(c1).toBeLessThanOrEqual(8);
    const [a2, b2, c2] = resComSplit(m2);
    expect(a2).toBeLessThanOrEqual(45);
    expect(b2).toBeGreaterThanOrEqual(35);
    expect(b2).toBeLessThanOrEqual(60);
    expect(c2).toBeGreaterThanOrEqual(12);
    expect(c2).toBeLessThanOrEqual(30);
    expect(fabUpShare(m2)).toBeGreaterThanOrEqual(25);
  });

  it('B10: at steady state no tile changes tier more than 4 times in the last 2 years', { timeout: 120_000 }, () => {
    const { m1, m2 } = runs();
    expect(m1.maxTierChanges2y).toBeLessThanOrEqual(4);
    expect(m2.maxTierChanges2y).toBeLessThanOrEqual(4);
  });

  it('B13: alleys never add more than 60 Undertow weight, skyways never more than 100 Kites weight', () => {
    const w = new World(5);
    const u0 = powerWeight(w, 'undertow');
    const k0 = powerWeight(w, 'kites');
    w.stats.roads.alley = 100_000;
    w.stats.roads.skyway = 100_000;
    expect(powerWeight(w, 'undertow') - u0).toBeCloseTo(POWER_WEIGHTS.undertow.alleyMax, 6);
    expect(powerWeight(w, 'kites') - k0).toBeCloseTo(POWER_WEIGHTS.kites.skywayMax, 6);
    expect(POWER_WEIGHTS.undertow.alleyMax).toBeLessThanOrEqual(60);
    expect(POWER_WEIGHTS.kites.skywayMax).toBeLessThanOrEqual(100);
  });
});
