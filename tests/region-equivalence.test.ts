// The legacy 64 frame and the start slot of a region run the same city (docs/MEGACITY.md §3.3 O1, §11.5): a one-district
// city on a 3×3 or 5×5 region computes exactly what the 64 map computes, month for month. This is why the size-grep test
// files may stay on the legacy frame (LEGACY_REGION) while fields, ports-sim and wealth run on both.

import { describe, expect, it } from 'vitest';
import '../src/game/story/turf'; // the banded turf month, as the game registers it
import { LEGACY_REGION, type FrameRegion } from '../src/game/types';
import { World } from '../src/game/world';
import { ScriptedMayor, makeSim } from './helpers';

interface Month {
  population: number;
  jobsCom: number;
  jobsInd: number;
  funds: number;
  approval: number;
  powerDemand: number;
  edgeLinks: number;
  avgLandValue: number;
  avgTraffic: number;
  avgPollution: number;
  avgCrime: number;
  income: number;
  expenses: number;
}

/** A ScriptedMayor city (centred, so on a region it builds in the start slot), `years` of monthly readings. */
function play(region: FrameRegion, years: number, events: boolean): Month[] {
  const w = new World(2091, 'Twin', undefined, region);
  const sim = makeSim(w, events);
  const mayor = new ScriptedMayor(w, sim);
  mayor.opening();
  const out: Month[] = [];
  for (let d = 1; d <= years * 360; d++) {
    sim.step();
    if (w.tick % 30 === 0) {
      mayor.turn();
      const s = w.stats;
      out.push({
        population: s.population,
        jobsCom: s.jobsCom,
        jobsInd: s.jobsInd,
        funds: w.funds,
        approval: s.approval,
        powerDemand: s.powerDemand,
        edgeLinks: s.edgeLinks,
        avgLandValue: s.avgLandValue,
        avgTraffic: s.avgTraffic,
        avgPollution: s.avgPollution,
        avgCrime: s.avgCrime,
        income: w.budget.income,
        expenses: w.budget.expenses,
      });
    }
  }
  return out;
}

describe('one district on any frame (§3.3 O1)', () => {
  it('a ScriptedMayor city, 3 sim years with events: the 64 frame and the start slot of a 3×3 and a 5×5 region read the same every month', () => {
    const legacy = play(LEGACY_REGION, 3, true);
    expect(legacy[legacy.length - 1].population).toBeGreaterThan(50_000);
    for (const region of [3, 5] as const) {
      const r = play(region, 3, true);
      for (let m = 0; m < legacy.length; m++) expect([region, m, r[m]]).toEqual([region, m, legacy[m]]);
    }
  }, 120_000);
});
