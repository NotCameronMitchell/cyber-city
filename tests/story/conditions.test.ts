// Conditions, metrics and factions (STORY.md §2.1, §2.4, §10.2): one test per
// metric of the closed vocabulary (coverage checked against content's
// METRIC_LIST), every condition node, hold tracking, standing, tiers, mood,
// visibility, patron / rival and power share.

import { beforeEach, describe, expect, it } from 'vitest';
import { STANDING } from '../../src/game/config';
import {
  compare,
  evalCond,
  findHold,
  firstMetric,
  flagsIn,
  formatMetric,
  isMetric,
  metric,
  metricFmt,
  metricsIn,
  storyContent,
  updateHolds,
  useStoryContent,
} from '../../src/game/story/conditions';
import { STORY_CONTENT } from '../../src/game/story/content';
import { METRIC_LIST } from '../../src/game/story/content/vocab';
import {
  ceilOf,
  changeFavor,
  computeMood,
  driftFavor,
  floorOf,
  friendlyCount,
  isActive,
  isRetired,
  isVisible,
  moodDrivers,
  patronOf,
  powerShare,
  powerWeight,
  resolveRef,
  rivalOf,
  shownState,
  standing,
  tier,
  tierOf,
  updateMoods,
} from '../../src/game/story/factions';
import type { Condition, Metric } from '../../src/game/story/types';
import { MAP_SIZE, ZoneType } from '../../src/game/types';
import type { World } from '../../src/game/world';
import { flatWorld } from '../helpers';

useStoryContent(STORY_CONTENT);

let w: World;
beforeEach(() => {
  w = flatWorld(77);
});

/** A developed zone tile with a given security (for security.avg / turfSecured). */
function dev(x: number, y: number, zone = ZoneType.Residential, level = 1) {
  w.setZone(x, y, zone);
  w.setLevel(x, y, level);
}

// ── One case per metric family ──────────────────────────────────────────────

/** Each case sets state and checks the metric. Keys: an exact metric, or `prefix.*`. */
const CASES: Record<string, () => void> = {
  pop: () => {
    w.stats.population = 1234;
    expect(metric(w, 'pop')).toBe(1234);
  },
  maxPop: () => {
    w.maxPopulation = 5555;
    expect(metric(w, 'maxPop')).toBe(5555);
  },
  tick: () => {
    w.tick = 77;
    expect(metric(w, 'tick')).toBe(77);
  },
  month: () => {
    w.tick = 30 * 10 + 4; // NOV of year one (0-based month 10)
    expect(metric(w, 'month')).toBe(10);
    w.tick = 30 * 12 * 3 + 30 * 2;
    expect(metric(w, 'month')).toBe(2);
  },
  funds: () => {
    w.funds = -6100;
    expect(metric(w, 'funds')).toBe(-6100);
  },
  tax: () => {
    w.taxRate = 13;
    expect(metric(w, 'tax')).toBe(13);
  },
  approval: () => {
    w.stats.approval = 61;
    expect(metric(w, 'approval')).toBe(61);
  },
  unemployment: () => {
    w.stats.unemployment = 0.12;
    expect(metric(w, 'unemployment')).toBe(0.12);
  },
  avgCrime: () => {
    w.stats.avgCrime = 0.31;
    expect(metric(w, 'avgCrime')).toBe(0.31);
  },
  avgPollution: () => {
    w.stats.avgPollution = 0.2;
    expect(metric(w, 'avgPollution')).toBe(0.2);
  },
  avgLandValue: () => {
    w.stats.avgLandValue = 0.45;
    expect(metric(w, 'avgLandValue')).toBe(0.45);
  },
  avgTraffic: () => {
    w.stats.avgTraffic = 0.4;
    expect(metric(w, 'avgTraffic')).toBe(0.4);
  },
  powerMargin: () => {
    w.stats.powerSupply = 300;
    w.stats.powerDemand = 200;
    expect(metric(w, 'powerMargin')).toBe(1.5);
    w.stats.powerDemand = 0; // max(1, demand)
    expect(metric(w, 'powerMargin')).toBe(300);
  },
  unpowered: () => {
    w.stats.unpoweredTiles = 9;
    expect(metric(w, 'unpowered')).toBe(9);
  },
  abandoned: () => {
    w.stats.abandonedTiles = 15;
    expect(metric(w, 'abandoned')).toBe(15);
  },
  'dev.res': () => {
    w.stats.developed = { res: 10, com: 4, ind: 6 };
    expect(metric(w, 'dev.res')).toBe(10);
  },
  'dev.com': () => {
    w.stats.developed = { res: 10, com: 4, ind: 6 };
    expect(metric(w, 'dev.com')).toBe(4);
  },
  'dev.ind': () => {
    w.stats.developed = { res: 10, com: 4, ind: 6 };
    expect(metric(w, 'dev.ind')).toBe(6);
  },
  'dev.all': () => {
    w.stats.developed = { res: 10, com: 4, ind: 6 };
    expect(metric(w, 'dev.all')).toBe(20);
  },
  'jobs.com': () => {
    w.stats.jobsCom = 800;
    expect(metric(w, 'jobs.com')).toBe(800);
  },
  'jobs.ind': () => {
    w.stats.jobsInd = 640;
    expect(metric(w, 'jobs.ind')).toBe(640);
  },
  'stacks.stage2': () => {
    w.vertical.metrics.stacksStage2 = 2;
    expect(metric(w, 'stacks.stage2')).toBe(2);
  },
  'stacks.stage3': () => {
    w.vertical.metrics.stacksStage3 = 1;
    expect(metric(w, 'stacks.stage3')).toBe(1);
  },
  crowns: () => {
    w.vertical.metrics.stacksStage3 = 3;
    expect(metric(w, 'crowns')).toBe(3);
  },
  skybridges: () => {
    w.vertical.metrics.skybridges = 4;
    expect(metric(w, 'skybridges')).toBe(4);
  },
  'rail.tiles': () => {
    w.vertical.metrics.railTiles = 30;
    expect(metric(w, 'rail.tiles')).toBe(30);
  },
  'rail.maxStations': () => {
    w.vertical.metrics.railMaxStations = 3;
    expect(metric(w, 'rail.maxStations')).toBe(3);
  },
  'turf.share': () => {
    w.turf.stats.tiles = { undertow: 100, kites: 60 };
    expect(metric(w, 'turf.share')).toBeCloseTo(160 / (MAP_SIZE * MAP_SIZE), 6);
  },
  'standing.patron': () => {
    w.story.favor.nacre = 30;
    expect(metric(w, 'standing.patron')).toBe(30); // the higher-standing corp stands in
    w.story.flags.patron = 'basalt';
    expect(metric(w, 'standing.patron')).toBe(standing(w, 'basalt'));
  },
  'standing.rival': () => {
    w.story.favor.nacre = 30;
    w.story.favor.basalt = -5;
    expect(metric(w, 'standing.rival')).toBe(-5);
  },
  'power.gangs': () => {
    w.turf.stats.tiles = { undertow: 50, kites: 25 };
    expect(metric(w, 'power.gangs')).toBeCloseTo(powerShare(w, 'undertow') + powerShare(w, 'kites'), 6);
    expect(metric(w, 'power.gangs')).toBeGreaterThan(0);
  },
  friendlyCount: () => {
    w.story.favor.board = 25;
    w.story.favor.basalt = 20;
    w.story.favor.tuning = 50; // hidden: does not count
    expect(metric(w, 'friendlyCount')).toBe(2);
    w.story.flags.tuningActive = true;
    expect(metric(w, 'friendlyCount')).toBe(3);
  },
  'security.avg': () => {
    dev(1, 1);
    dev(2, 1);
    w.fields.security[w.idx(1, 1)] = 0.8;
    w.fields.security[w.idx(2, 1)] = 0.2;
    w.tick = 5; // cached per tick
    expect(metric(w, 'security.avg')).toBeCloseTo(0.5, 6);
  },
  trace: () => {
    w.story.trace = 42;
    expect(metric(w, 'trace')).toBe(42);
  },
  logs: () => {
    w.story.logs = [1, 2, 7];
    expect(metric(w, 'logs')).toBe(3);
  },
  chapter: () => {
    w.story.chapter = 4;
    expect(metric(w, 'chapter')).toBe(4);
  },
  daysInChapter: () => {
    w.tick = 500;
    w.story.chapterTick = 380;
    w.story.phase = 'active';
    expect(metric(w, 'daysInChapter')).toBe(120);
    w.story.phase = 'waiting';
    expect(metric(w, 'daysInChapter')).toBe(0);
  },
  gangActions: () => {
    w.story.gangActions = 2;
    expect(metric(w, 'gangActions')).toBe(2);
  },
  daysSinceCrackdown: () => {
    expect(metric(w, 'daysSinceCrackdown')).toBe(99999);
    w.tick = 400;
    w.story.lastCrackdownTick = 250;
    expect(metric(w, 'daysSinceCrackdown')).toBe(150);
  },
  // Expansion metrics (docs/EXPANSION.md §2.2): shares of developed tiles by tier, road and skyway counts.
  'wealth.high': () => {
    expect(metric(w, 'wealth.high')).toBe(0); // no developed tiles: max(1, Σ) guards the division
    w.stats.wealth = [60, 25, 15];
    expect(metric(w, 'wealth.high')).toBeCloseTo(0.15, 6);
    expect(metricFmt('wealth.high')).toBe('pct');
  },
  'wealth.low': () => {
    w.stats.wealth = [60, 25, 15];
    expect(metric(w, 'wealth.low')).toBeCloseTo(0.6, 6);
    expect(metricFmt('wealth.low')).toBe('pct');
  },
  'roads.highway': () => {
    w.stats.roads.highway = 42;
    expect(metric(w, 'roads.highway')).toBe(42);
  },
  'roads.alley': () => {
    w.stats.roads.alley = 31;
    expect(metric(w, 'roads.alley')).toBe(31);
  },
  'skyway.tiles': () => {
    w.stats.roads.skyway = 20;
    expect(metric(w, 'skyway.tiles')).toBe(20);
  },
  'count.*': () => {
    w.addBuilding('plaza', 5, 5);
    w.addBuilding('plaza', 8, 5);
    w.addBuilding('precinct', 20, 20);
    expect(metric(w, 'count.plaza')).toBe(2);
    expect(metric(w, 'count.precinct')).toBe(1);
    expect(metric(w, 'count.stack')).toBe(0);
    w.addBuilding('stack', 30, 30);
    expect(metric(w, 'count.stack')).toBe(1); // the cache follows world.version
  },
  'turf.*': () => {
    w.turf.stats.tiles = { undertow: 44, kites: 12 };
    expect(metric(w, 'turf.undertow')).toBe(44);
    expect(metric(w, 'turf.kites')).toBe(12);
  },
  'turfSecured.*': () => {
    w.turf.stats.secured = { undertow: 0.25, kites: 0.5 };
    expect(metric(w, 'turfSecured.undertow')).toBe(0.25);
    expect(metric(w, 'turfSecured.kites')).toBe(0.5);
  },
  'railOnTurf.*': () => {
    w.vertical.metrics.railOnTurf = { undertow: 6, kites: 1 };
    expect(metric(w, 'railOnTurf.undertow')).toBe(6);
    expect(metric(w, 'railOnTurf.kites')).toBe(1);
  },
  'pactActive.*': () => {
    expect(metric(w, 'pactActive.undertow')).toBe(0);
    w.story.pacts.push({ gang: 'undertow', until: w.tick + 100 });
    expect(metric(w, 'pactActive.undertow')).toBe(1);
    expect(metric(w, 'pactActive.kites')).toBe(0);
    w.story.ending = 'lowcrown'; // permanentPacts
    expect(metric(w, 'pactActive.kites')).toBe(1);
  },
  'standing.*': () => {
    w.story.favor.kites = -35;
    expect(metric(w, 'standing.kites')).toBe(-35);
    expect(metric(w, 'standing.board')).toBe(10);
  },
  'power.*': () => {
    w.stats.approval = 50;
    w.turf.stats.tiles = { undertow: 25, kites: 0 };
    const sum = (['board', 'basalt', 'nacre', 'undertow', 'kites'] as const).reduce((a, f) => a + metric(w, `power.${f}`), 0);
    expect(sum).toBeCloseTo(100, 6);
    expect(metric(w, 'power.tuning')).toBe(0);
  },
  'crowns.*': () => {
    w.vertical.metrics.crowns = { foundry: 1, glare: 2, nest: 0, commons: 1 };
    expect(metric(w, 'crowns.glare')).toBe(2);
    expect(metric(w, 'crowns.commons')).toBe(1);
  },
};

function caseFor(m: string): string | null {
  if (m in CASES) return m;
  const p = `${m.slice(0, m.indexOf('.'))}.*`;
  return p in CASES ? p : null;
}

describe('metrics (§10.2)', () => {
  it('every member of the closed vocabulary is known and has a unit test', () => {
    for (const m of METRIC_LIST) {
      expect(isMetric(m), m).toBe(true);
      expect(caseFor(m), m).not.toBeNull();
    }
    expect(isMetric('nope')).toBe(false);
    expect(isMetric('count.nope')).toBe(false);
    expect(metric(w, 'nope' as Metric)).toBe(0);
  });

  for (const [name, fn] of Object.entries(CASES)) {
    it(name, () => {
      fn();
    });
  }

  it('an array of metrics is summed', () => {
    w.stats.developed = { res: 10, com: 4, ind: 6 };
    expect(evalCond(w, { m: ['dev.res', 'dev.com'], op: '==', v: 14 })).toBe(true);
  });
});

// ── Condition nodes ─────────────────────────────────────────────────────────

describe('conditions', () => {
  it('compares with every operator', () => {
    expect(compare(3, '>=', 3)).toBe(true);
    expect(compare(3, '>', 3)).toBe(false);
    expect(compare(2, '<=', 3)).toBe(true);
    expect(compare(3, '<', 3)).toBe(false);
    expect(compare(3, '==', 3)).toBe(true);
    expect(compare(3, '!=', 3)).toBe(false);
    w.stats.population = 600;
    expect(evalCond(w, { m: 'pop', op: '>=', v: 600 })).toBe(true);
    expect(evalCond(w, { m: 'pop', op: '<', v: 600 })).toBe(false);
  });

  it('flags: truthy, eq, missing, and revealed mirrors the state', () => {
    expect(evalCond(w, { flag: 'larkKnows' })).toBe(false);
    w.story.flags.larkKnows = true;
    expect(evalCond(w, { flag: 'larkKnows' })).toBe(true);
    w.story.flags.patron = 'nacre';
    expect(evalCond(w, { flag: 'patron', eq: 'nacre' })).toBe(true);
    expect(evalCond(w, { flag: 'patron', eq: 'basalt' })).toBe(false);
    w.story.flags.branded = 2;
    expect(evalCond(w, { flag: 'branded', eq: 2 })).toBe(true);
    w.story.flags.off = false;
    expect(evalCond(w, { flag: 'off' })).toBe(false);
    expect(evalCond(w, { flag: 'off', eq: false })).toBe(true);
    expect(evalCond(w, { flag: 'revealed' })).toBe(false);
    w.story.revealed = true;
    expect(evalCond(w, { flag: 'revealed' })).toBe(true);
  });

  it('all / any / not, including empty lists; undefined holds', () => {
    const yes: Condition = { m: 'tick', op: '>=', v: 0 };
    const no: Condition = { m: 'tick', op: '<', v: 0 };
    expect(evalCond(w, { all: [] })).toBe(true);
    expect(evalCond(w, { any: [] })).toBe(false);
    expect(evalCond(w, { all: [yes, no] })).toBe(false);
    expect(evalCond(w, { any: [no, yes] })).toBe(true);
    expect(evalCond(w, { not: no })).toBe(true);
    expect(evalCond(w, undefined)).toBe(true);
  });

  it('hold counts consecutive days and resets', () => {
    const c: Condition = { hold: { m: 'unpowered', op: '==', v: 0 }, days: 3, key: 'g' };
    for (let d = 0; d < 2; d++) updateHolds(w, c);
    expect(w.story.holds.g).toBe(2);
    expect(evalCond(w, c)).toBe(false);
    updateHolds(w, c);
    expect(evalCond(w, c)).toBe(true);
    w.stats.unpoweredTiles = 1;
    updateHolds(w, c);
    expect(w.story.holds.g).toBe(0);
    expect(evalCond(w, c)).toBe(false);
    // Nested inside all / any / not too.
    w.stats.unpoweredTiles = 0;
    updateHolds(w, { all: [{ not: c }] });
    expect(w.story.holds.g).toBe(1);
  });

  it('inspection helpers find holds, first metrics, flags and metrics', () => {
    const goal = STORY_CONTENT.chapters[0].goals.find((g) => g.id === 'c1.lit')!;
    expect(findHold(goal.cond)).toEqual({ key: 'c1.lit', days: 20 });
    expect(firstMetric({ all: [{ m: 'avgCrime', op: '<=', v: 0.3 }] })).toEqual({ m: 'avgCrime', op: '<=', v: 0.3 });
    expect([...flagsIn({ any: [{ flag: 'truce' }, { not: { flag: 'leashed' } }] })]).toEqual(['truce', 'leashed']);
    expect([...metricsIn({ all: [{ m: ['dev.res', 'dev.com'], op: '>', v: 1 }, { m: 'pop', op: '>', v: 1 }] })]).toEqual([
      'dev.res',
      'dev.com',
      'pop',
    ]);
  });

  it('formats metrics for goals and claims', () => {
    expect(metricFmt('avgCrime')).toBe('pct');
    expect(metricFmt('power.basalt')).toBe('share');
    expect(metricFmt('powerMargin')).toBe('x');
    expect(metricFmt('pop')).toBe('int');
    expect(formatMetric(0.342, 'pct')).toBe('34%');
    expect(formatMetric(24.4, 'share')).toBe('24%');
    expect(formatMetric(1.234, 'x')).toBe('1.23×');
    expect(formatMetric(12000, 'int')).toBe('12,000');
  });

  it('indexes the registered content', () => {
    const idx = storyContent();
    expect(idx.chapters.size).toBe(6);
    expect(idx.logCards.size).toBe(12);
    expect(idx.starCards.size).toBe(6);
    expect(idx.hostile.basalt?.id).toBe('ba.embargo');
    expect(idx.beatChapter.get('ch3.pier')).toBe(3);
    expect(idx.optionalBeats.has('ch2.tiebreak')).toBe(true);
    expect(idx.deck.every((c) => c.kind === 'faction' && !c.queuedOnly && !c.seasonal)).toBe(true);
    expect(idx.seasonal.map((c) => c.id)).toContain('bd.ballot');
    expect(idx.system.map((c) => c.id)).toEqual(expect.arrayContaining(['sys.bailout', 'sys.revealed']));
  });
});

// ── Factions: standing, tiers, mood, power (§2) ─────────────────────────────

describe('standing and tiers (§2.1)', () => {
  it('tier boundaries', () => {
    expect(tierOf(-60)).toBe('hostile');
    expect(tierOf(-59)).toBe('cold');
    expect(tierOf(-20)).toBe('cold');
    expect(tierOf(-19)).toBe('neutral');
    expect(tierOf(19)).toBe('neutral');
    expect(tierOf(20)).toBe('friendly');
    expect(tierOf(59)).toBe('friendly');
    expect(tierOf(60)).toBe('allied');
  });

  it('standing = round(favor + mood) within the highest floor and lowest ceiling', () => {
    w.story.favor.board = 10.4;
    w.story.mood = { board: 5.3 };
    expect(standing(w, 'board')).toBe(16);
    w.story.favor.board = -80;
    w.story.floors.board = 0; // Leash the Board
    expect(standing(w, 'board')).toBe(0);
    expect(floorOf(w, 'board')).toBe(0);
    // Ending rules join: Low Crown ceils Basalt at 20 and floors the gangs at 20.
    w.story.favor.basalt = 70;
    w.story.ending = 'lowcrown';
    expect(standing(w, 'basalt')).toBe(20);
    expect(ceilOf(w, 'basalt')).toBe(20);
    w.story.favor.undertow = -50;
    expect(standing(w, 'undertow')).toBe(20);
    w.story.floors.undertow = 30; // highest floor wins
    expect(standing(w, 'undertow')).toBe(30);
    w.story.ceils.basalt = 10; // lowest ceiling wins
    expect(standing(w, 'basalt')).toBe(10);
  });

  it('the hidden Tuning is tracked but Neutral; silhouette from Trace 25', () => {
    w.story.favor.tuning = -80;
    expect(standing(w, 'tuning')).toBe(-80);
    expect(tier(w, 'tuning')).toBe('neutral');
    expect(isVisible(w, 'tuning')).toBe(false);
    expect(shownState(w, 'tuning')).toBe('no');
    w.story.trace = 25;
    expect(shownState(w, 'tuning')).toBe('silhouette');
    w.story.flags.tuningActive = true;
    expect(shownState(w, 'tuning')).toBe('yes');
    expect(tier(w, 'tuning')).toBe('hostile');
  });

  it('retired factions are inactive (Ironwork retires the Board)', () => {
    expect(isActive(w, 'board')).toBe(true);
    w.story.ending = 'ironwork';
    expect(isRetired(w, 'board')).toBe(true);
    expect(isActive(w, 'board')).toBe(false);
  });

  it('changeFavor clamps ±100 and emits standing on change', () => {
    const seen: number[] = [];
    w.events.on('standing', (e) => seen.push(e.delta));
    changeFavor(w, 'nacre', 150);
    expect(w.story.favor.nacre).toBe(100);
    changeFavor(w, 'nacre', -250);
    expect(w.story.favor.nacre).toBe(-100);
    w.story.floors.nacre = -10;
    changeFavor(w, 'nacre', 5); // standing pinned at the floor: no event
    expect(seen).toEqual([100, -200]);
  });

  it('monthly drift moves |favor| > 30 one toward 0, plus favorMonthly', () => {
    w.story.favor.board = 40;
    w.story.favor.kites = -31;
    w.story.favor.nacre = 30;
    driftFavor(w, { nacre: -1 });
    expect(w.story.favor.board).toBe(39);
    expect(w.story.favor.kites).toBe(-30);
    expect(w.story.favor.nacre).toBe(29);
  });

  it('mood: ramp and step drivers, summed and clamped to ±30', () => {
    w.stats.approval = 85; // (85 − 55) × 0.4 = 12 (cap 12)
    w.stats.avgCrime = 0; // −40 × (0 − 0.25) = 10
    w.addBuilding('precinct', 2, 2);
    w.addBuilding('clinic', 10, 2); // +2 each
    const d = moodDrivers(w, 'board');
    expect(d.map((x) => Math.round(x.value))).toEqual([12, 10, 4, 0]);
    expect(computeMood(w, 'board')).toBe(26);
    for (let k = 0; k < 4; k++) w.addBuilding('precinct', 2 + k * 4, 20);
    expect(computeMood(w, 'board')).toBe(30); // 12 + 10 + 8 capped at 30
    // Step driver: Nacre −10 while avgPollution > 0.3.
    w.stats.avgLandValue = 0.35;
    w.stats.avgPollution = 0.4;
    expect(computeMood(w, 'nacre')).toBe(-10);
    updateMoods(w);
    expect(w.story.mood!.board).toBe(30);
    expect(standing(w, 'board')).toBe(40);
  });

  it('patron and rival resolve from the flag, else the higher corp (Basalt on a tie)', () => {
    expect(patronOf(w)).toBe('basalt');
    expect(rivalOf(w)).toBe('nacre');
    w.story.favor.nacre = 5;
    expect(patronOf(w)).toBe('nacre');
    w.story.flags.patron = 'basalt';
    expect(patronOf(w)).toBe('basalt');
    expect(resolveRef(w, 'rival')).toEqual(['nacre']);
    expect(resolveRef(w, 'gangs')).toEqual(['undertow', 'kites']);
    expect(resolveRef(w, 'corps')).toEqual(['basalt', 'nacre']);
    expect(resolveRef(w, 'tuning')).toEqual(['tuning']);
  });

  it('power weights follow §2.4 and shares sum to 100', () => {
    w.stats.approval = 50;
    w.stats.jobsInd = 800;
    w.addBuilding('reactor', 4, 4);
    w.story.flags.honestTie = true;
    w.story.flags.patron = 'basalt';
    w.story.flags.branded = 2;
    expect(powerWeight(w, 'board')).toBe(3 * 50 + 100);
    expect(powerWeight(w, 'basalt')).toBe(800 / 8 + 60 + 2 * 80 + 300);
    w.turf.stats.tiles = { undertow: 10, kites: 0 };
    w.story.flags.oneTide = 'undertow';
    expect(powerWeight(w, 'undertow')).toBe(20 + 150);
    expect(powerWeight(w, 'tuning')).toBe(0);
    const total = (['board', 'basalt', 'nacre', 'undertow', 'kites'] as const).reduce((a, f) => a + powerShare(w, f), 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it('expansion power terms: launch rights, ports, and the capped alley and skyway terms (§8.2)', () => {
    const base = (['board', 'basalt', 'nacre', 'undertow', 'kites'] as const).map((f) => powerWeight(w, f));
    // 1,000 alley tiles add exactly 60 Undertow weight; 400 sky tiles exactly 100 Kites weight.
    w.stats.roads.alley = 1000;
    w.stats.roads.skyway = 400;
    expect(powerWeight(w, 'undertow') - base[3]).toBe(60);
    expect(powerWeight(w, 'kites') - base[4]).toBe(100);
    w.stats.roads.alley = 100;
    w.stats.roads.skyway = 100;
    expect(powerWeight(w, 'undertow') - base[3]).toBe(25);
    expect(powerWeight(w, 'kites') - base[4]).toBe(50);
    w.stats.roads.alley = 0;
    w.stats.roads.skyway = 0;
    // Ports: Basalt per Seaport, Nacre per Airport.
    w.addBuilding('seaport', 2, 2);
    w.addBuilding('seaport', 10, 2);
    w.addBuilding('airport', 20, 2);
    expect(powerWeight(w, 'basalt') - base[1]).toBe(120);
    expect(powerWeight(w, 'nacre') - base[2]).toBe(80);
    // Launch rights: +150 to the holder only.
    const before = (['board', 'basalt', 'nacre', 'undertow', 'kites'] as const).map((f) => powerWeight(w, f));
    for (const [holder, k] of [['board', 0], ['basalt', 1], ['nacre', 2], ['kites', 4]] as const) {
      w.story.flags.launchRights = holder;
      (['board', 'basalt', 'nacre', 'undertow', 'kites'] as const).forEach((f, j) =>
        expect(powerWeight(w, f) - before[j]).toBe(j === k ? 150 : 0),
      );
    }
  });

  it('friendlyCount counts visible, unretired factions at 20+', () => {
    w.story.favor.board = STANDING.friendly;
    w.story.favor.nacre = STANDING.friendly;
    expect(friendlyCount(w)).toBe(2);
    w.story.ending = 'ironwork';
    expect(friendlyCount(w)).toBe(1);
  });
});
