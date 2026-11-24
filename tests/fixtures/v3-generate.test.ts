// Generator of the pinned v3 fixtures (docs/MEGACITY.md §11.2, §11.3 S1/S2, §12 Step 0a).
//
// Run ONLY in the v3 build (before the Megacity unit change), and only on purpose:
//   GEN_V3=1 npx vitest run tests/fixtures/v3-generate.test.ts
// It writes, next to this file:
//   v3-expansion.json            fullyBuiltWorld() + expansionFixture(), 3 months, as a v3 save
//   v3-mayor-<seed>-y<3|8>.json  the story harness (Game + director + ScriptedMayor, generated
//                                terrain, brisk pace, 2 s a day) at sim years 3 and 8, seeds 2091, 7, 31
//   v3-ending.json               a post-ending city (the relaxed speed-1 playthrough, seed 2091)
//   v3-baseline.json             what the v3 build measured: measureSave() of every fixture
//                                (S1), the plain ScriptedMayor's 8-year monthly trajectory, and
//                                the story harness's chapter starts and yearly population on
//                                every pace, seeds 2091, 7, 31, run to the ending (S2)
// After the unit change it refuses to run (POP_SCALE exists), so the pinned files stay v3.

import { describe, expect, it } from 'vitest';
import * as config from '../../src/game/config';
import type { Game } from '../../src/game/game';
import { Simulation } from '../../src/game/sim';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, type SaveData, type StoryPace } from '../../src/game/types';
import type { World } from '../../src/game/world';
import { expansionFixture } from '../expansion-fixture';
import { ScriptedMayor, flatWorld, fullyBuiltWorld, makeSim } from '../helpers';
import { measureSave, type S1Result } from '../megacity-s1';
import { playStory } from '../story/harness';

const env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const GEN = env.GEN_V3 === '1';
const SEEDS = [2091, 7, 31] as const;
const PACES: readonly StoryPace[] = ['relaxed', 'normal', 'brisk'];
const YEAR = MONTHS_PER_YEAR * DAYS_PER_MONTH;
/** savedAt is wall time in a real save; pinned so a regeneration is byte-identical. */
const SAVED_AT = Date.UTC(2026, 10, 24);

function save(w: World): SaveData {
  const d = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
  d.savedAt = SAVED_AT;
  return d;
}

async function writeJson(name: string, data: unknown): Promise<void> {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { writeFileSync(p: URL, s: string): void };
  fs.writeFileSync(new URL(`./${name}`, import.meta.url), `${JSON.stringify(data)}\n`);
}

/** The plain ScriptedMayor (balance.test.ts' playthrough, events on): monthly numbers. */
function mayorRun(seed: number, years: number) {
  const w = flatWorld(seed);
  const sim = makeSim(w, true);
  const mayor = new ScriptedMayor(w, sim);
  mayor.opening();
  const months: { pop: number; jobsCom: number; jobsInd: number; funds: number; net: number; approval: number }[] = [];
  for (let m = 0; m < years * MONTHS_PER_YEAR; m++) {
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      sim.step();
      mayor.observe();
    }
    mayor.turn();
    const s = w.stats;
    months.push({ pop: s.population, jobsCom: s.jobsCom, jobsInd: s.jobsInd, funds: Math.round(w.funds), net: w.budget.history.at(-1) ?? 0, approval: s.approval });
  }
  return { months, lowestFunds: mayor.lowestFunds, maxPopulation: w.maxPopulation, milestones: [...w.milestones] };
}

describe.skipIf(!GEN)('v3 fixtures (generator, GEN_V3=1 only)', () => {
  it('writes the pinned v3 saves and the v3 baseline', async () => {
    // Refuse to run in a build that already has the Megacity units.
    expect('POP_SCALE' in config).toBe(false);
    expect(config.SAVE_VERSION).toBe(3);

    const fixtures: Record<string, SaveData> = {};

    // The expansion fixture: fullyBuiltWorld + every expansion structure, settled and run 3 months.
    {
      const w = fullyBuiltWorld();
      expansionFixture(w);
      const sim = new Simulation(w);
      sim.options.events = false;
      sim.recomputeAll();
      sim.settleWealth();
      sim.recomputeAll();
      for (let d = 0; d < 3 * DAYS_PER_MONTH; d++) sim.step();
      fixtures['v3-expansion'] = save(w);
    }

    // The story harness on generated terrain (brisk pace, 2 s of play a sim day, half the
    // COMMS cards answered): saves at years 3 (Ch3-4) and 8 (Ch4-5) per seed.
    type RunRecord = { chapters: { n: number; tick: number }[]; chapterSecs: { n: number; sec: number }[]; endings: string[]; yearly: { tick: number; pop: number; funds: number; chapter: number }[] };
    const record = (opts: Parameters<typeof playStory>[0], keep?: (g: Game) => boolean | void): RunRecord => {
      const yearly: RunRecord['yearly'] = [];
      const { log } = playStory({
        ...opts,
        each: (g) => {
          const w = g.world;
          if (w.tick % YEAR === 0) yearly.push({ tick: w.tick, pop: w.stats.population, funds: Math.round(w.funds), chapter: w.story.chapter });
          return keep?.(g);
        },
      });
      return { chapters: log.chapters, chapterSecs: log.chapterSecs, endings: log.endings, yearly };
    };
    const fixtureRuns: Record<number, RunRecord> = {};
    for (const seed of SEEDS) {
      fixtureRuns[seed] = record({ seed, years: 8, terrain: true, pace: 'brisk', secPerDay: 2, answerPending: 0.5 }, (g) => {
        const w = g.world;
        if (w.tick === 3 * YEAR) fixtures[`v3-mayor-${seed}-y3`] = save(w);
        if (w.tick === 8 * YEAR) fixtures[`v3-mayor-${seed}-y8`] = save(w);
      });
    }
    // A post-ending city (not in the spec's list; for Step 0b's migration rows): the relaxed
    // speed-1 playthrough of tests/story/playthrough.test.ts, saved once the ending has settled.
    const done = (g: Game) => g.world.story.chapter >= 7 && !g.story.blocking && !g.world.story.waiting;
    record({ seed: 2091, years: 62, pace: 'relaxed', answerPending: 0.5, readDelaySec: 20 }, (g) => {
      if (!done(g)) return false;
      fixtures['v3-ending'] = save(g.world);
      return true;
    });
    // S2: the story harness as the pace tests run it (flat map, speed 1), every pace, to the ending.
    const harness: Record<string, Record<number, RunRecord>> = {};
    for (const pace of PACES) {
      harness[pace] = {};
      for (const seed of SEEDS) harness[pace][seed] = record({ seed, years: pace === 'relaxed' ? 62 : 40, pace, answerPending: 0.5, readDelaySec: 20 }, done);
    }

    const measured: Record<string, S1Result> = {};
    for (const [name, data] of Object.entries(fixtures)) {
      expect(data.version).toBe(3);
      measured[name] = measureSave(data);
      await writeJson(`${name}.json`, data);
    }
    expect(Object.keys(fixtures).sort()).toEqual(
      ['v3-expansion', 'v3-ending', ...SEEDS.flatMap((s) => [`v3-mayor-${s}-y3`, `v3-mayor-${s}-y8`])].sort(),
    );

    const mayor: Record<number, ReturnType<typeof mayorRun>> = {};
    for (const seed of SEEDS) mayor[seed] = mayorRun(seed, 8);

    await writeJson('v3-baseline.json', {
      note: 'Measured by the v3 build (tests/fixtures/v3-generate.test.ts). Head counts are in v3 units (x1).',
      s1: measured,
      mayor,
      fixtureRuns,
      harness,
    });
  }, 1_800_000);
});
