import { describe, expect, it } from 'vitest';
import { BUILDINGS, MILESTONES, ROAD_UPKEEP, START_FUNDS } from '../src/game/config';
import { DAYS_PER_MONTH, ZoneType } from '../src/game/types';
import { Simulation } from '../src/game/sim';
import type { World } from '../src/game/world';
import { flatWorld, makeSim, run } from './helpers';

/** Small powered street with a few developed homes (stays under the first milestone). */
function hamlet(homes = 4): World {
  const w = flatWorld(5);
  for (let x = 10; x < 30; x++) w.setRoad(x, 10);
  w.addBuilding('solar', 8, 10);
  for (let i = 0; i < homes; i++) {
    w.setZone(12 + i, 11, ZoneType.Residential);
    w.setLevel(12 + i, 11, 1);
  }
  return w;
}

describe('monthly budget', () => {
  it('projects income and expenses before the first month', () => {
    const w = hamlet();
    makeSim(w);
    expect(w.budget.expenses).toBe(Math.round(20 * ROAD_UPKEEP) + BUILDINGS.solar.upkeep);
    expect(w.budget.income).toBeGreaterThan(0);
    const labels = w.budget.expenseLines.map((l) => l.label);
    expect(labels).toContain('Roads');
    expect(labels).not.toContain('Skyways'); // only once a skyway exists
    expect(labels).toContain('Power plants');
    expect(w.budget.incomeLines.length).toBe(3);
    expect(w.budget.history).toEqual([]);
  });

  it('recomputeAll never moves time or money', () => {
    const w = hamlet();
    const sim = makeSim(w);
    const funds = w.funds;
    const tick = w.tick;
    for (let i = 0; i < 5; i++) sim.recomputeAll();
    expect(w.funds).toBe(funds);
    expect(w.tick).toBe(tick);
  });

  it('settles once per month: funds change by the net and history records it', () => {
    const w = hamlet();
    const sim = makeSim(w);
    let months = 0;
    w.events.on('month', () => months++);
    const start = w.funds;
    run(sim, DAYS_PER_MONTH - 1);
    expect(w.funds).toBe(start);
    expect(months).toBe(0);
    sim.step();
    expect(months).toBe(1);
    expect(w.budget.history.length).toBe(1);
    const net = w.budget.history[0];
    expect(net).toBe(w.budget.income - w.budget.expenses);
    expect(w.funds).toBe(start + net);
  });

  it('keeps 12 months of history', () => {
    const w = hamlet();
    const sim = makeSim(w);
    run(sim, DAYS_PER_MONTH * 14);
    expect(w.budget.history.length).toBe(12);
  });

  it('higher tax raises income', () => {
    const w = hamlet(8);
    const sim = makeSim(w);
    w.taxRate = 5;
    sim.recomputeAll();
    const low = w.budget.income;
    w.taxRate = 15;
    sim.recomputeAll();
    expect(w.budget.income).toBeGreaterThan(low * 2);
  });

  it('tax above the neutral rate suppresses demand', () => {
    const w = hamlet();
    const sim = makeSim(w);
    w.taxRate = 2;
    run(sim, 40);
    const cheap = w.stats.demand.res;
    w.taxRate = 18;
    run(sim, 40);
    expect(w.stats.demand.res).toBeLessThan(cheap - 0.2);
  });

  it('reckless service spending runs a deficit', () => {
    const w = hamlet(8);
    w.maxPopulation = 5000;
    for (let k = 0; k < 4; k++) w.addBuilding('precinct', 12 + k * 2, 12);
    for (let k = 0; k < 3; k++) w.addBuilding('clinic', 12 + k * 2, 14);
    makeSim(w);
    expect(w.budget.expenses).toBeGreaterThan(w.budget.income * 3);
    expect(w.budget.expenseLines.map((l) => l.label)).toEqual(
      expect.arrayContaining(['Enforcer Precincts', 'Med Clinics']),
    );
  });
});

describe('milestones', () => {
  it('awards each population milestone exactly once', () => {
    const w = hamlet(10); // 1,400 residents > first milestone (1,000)
    const sim = makeSim(w);
    const fired: number[] = [];
    const sfx: string[] = [];
    w.events.on('milestone', (m) => fired.push(m.pop));
    w.events.on('sfx', (s) => sfx.push(s));
    const funds = w.funds;
    sim.step();
    expect(fired).toEqual([MILESTONES[0].pop]);
    expect(sfx).toContain('milestone');
    expect(w.milestones).toEqual([MILESTONES[0].pop]);
    expect(w.funds).toBe(funds + MILESTONES[0].grant);
    expect(w.news.some((n) => n.kind === 'good' && n.text.includes(MILESTONES[0].title))).toBe(true);
    run(sim, 20);
    expect(fired).toEqual([MILESTONES[0].pop]);
    expect(w.funds).toBe(funds + MILESTONES[0].grant);
  });

  it('tracks the population high-water mark for unlocks', () => {
    const w = hamlet(10);
    const sim = makeSim(w);
    expect(w.maxPopulation).toBe(1400);
    for (let i = 0; i < 10; i++) w.clearTile(12 + i, 11);
    sim.recomputeAll();
    expect(w.stats.population).toBe(0);
    expect(w.maxPopulation).toBe(1400);
  });

  it('does not grant milestones from recomputeAll', () => {
    const w = hamlet(10);
    const sim = new Simulation(w);
    sim.recomputeAll();
    expect(w.funds).toBe(START_FUNDS);
    expect(w.milestones).toEqual([]);
  });
});
