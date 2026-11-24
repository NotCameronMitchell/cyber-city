// S1, the invariance of the unit change (docs/MEGACITY.md §4.1, §11.3): measure a saved city
// the same way in the v3 build (tests/fixtures/v3-generate.test.ts pins the numbers in
// tests/fixtures/v3-baseline.json) and in every later build (tests/megacity-scale.test.ts
// compares). Keep this procedure unchanged: the pinned numbers were measured with it.
//
//   measureSave(save)  restore the save in a headless Game, snapshot the derived stats
//                      ('load'), run one month of days (sim.step + story.onDay, no player),
//                      snapshot again ('month') and return both with the settled month's net.

import { FACTION_IDS } from '../src/game/config';
import { Game } from '../src/game/game';
import { powerShare } from '../src/game/story/factions';
import type { FactionId } from '../src/game/story/types';
import { DAYS_PER_MONTH, type SaveData } from '../src/game/types';

/** Derived numbers of a city at one moment. Head counts are in the build's own units. */
export interface S1Snapshot {
  tick: number;
  funds: number;
  maxPopulation: number;
  milestones: number[];
  pop: number;
  jobsCom: number;
  jobsInd: number;
  unemployment: number;
  avgTraffic: number;
  avgPollution: number;
  avgLandValue: number;
  avgCrime: number;
  /** The sim's smoothed approval (unrounded) and the HUD's rounded value. */
  approval: number;
  approvalShown: number;
  powerSupply: number;
  powerDemand: number;
  demand: { res: number; com: number; ind: number };
  visitors: number;
  /** This month's budget projection. */
  income: number;
  expenses: number;
  incomeLines: Record<string, number>;
  expenseLines: Record<string, number>;
  /** Salt price now (round100(base + perPop × pop)). */
  salt: number;
  /** Balance of Power shares, 0..100 per faction. */
  power: Record<FactionId, number>;
}

export interface S1Result {
  load: S1Snapshot;
  month: S1Snapshot;
  /** Net of the month settled during the run (last budget history entry). */
  net: number;
}

function lines(list: readonly { label: string; amount: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of list) out[l.label] = (out[l.label] ?? 0) + l.amount;
  return out;
}

/** Snapshot the derived numbers of a Game's current world. */
export function snapshot(g: Game): S1Snapshot {
  const w = g.world;
  const s = w.stats;
  const power = {} as Record<FactionId, number>;
  for (const f of FACTION_IDS) power[f] = powerShare(w, f);
  return {
    tick: w.tick,
    funds: w.funds,
    maxPopulation: w.maxPopulation,
    milestones: [...w.milestones],
    pop: s.population,
    jobsCom: s.jobsCom,
    jobsInd: s.jobsInd,
    unemployment: s.unemployment,
    avgTraffic: s.avgTraffic,
    avgPollution: s.avgPollution,
    avgLandValue: s.avgLandValue,
    avgCrime: s.avgCrime,
    approval: (g.sim as unknown as { approval: number }).approval,
    approvalShown: s.approval,
    powerSupply: s.powerSupply,
    powerDemand: s.powerDemand,
    demand: { res: s.demand.res, com: s.demand.com, ind: s.demand.ind },
    visitors: s.visitors,
    income: w.budget.income,
    expenses: w.budget.expenses,
    incomeLines: lines(w.budget.incomeLines),
    expenseLines: lines(w.budget.expenseLines),
    salt: g.story.saltCost(),
    power,
  };
}

/** Restore `save` (deep-copied) in a fresh headless Game, snapshot, run one month, snapshot. */
export function measureSave(save: SaveData): S1Result {
  const g = new Game();
  if (!g.restore(JSON.parse(JSON.stringify(save)) as SaveData)) throw new Error('restore failed');
  const load = snapshot(g);
  for (let d = 0; d < DAYS_PER_MONTH; d++) {
    g.sim.step();
    g.story.onDay();
  }
  const month = snapshot(g);
  return { load, month, net: g.world.budget.history.at(-1) ?? 0 };
}
