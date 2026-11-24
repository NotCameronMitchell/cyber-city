// Effects (STORY.md §10.3): one test per member of the closed vocabulary (the
// table is typed Record<Effect['t'], …>, so a new effect kind without a test
// fails to compile), targets, spots, tokens, hint chips, effect text, the
// gangSurge turf rule, local layers, and resolveMods (§10.4 sources and clamps).

import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction } from '../../src/game/actions';
import { BUILDINGS, FACTION_LABELS } from '../../src/game/config';
import { districtName } from '../../src/game/news';
import { Rng } from '../../src/game/rng';
import { useStoryContent } from '../../src/game/story/conditions';
import { STORY_CONTENT } from '../../src/game/story/content';
import {
  addTrace,
  applyEffects,
  applySurge,
  describePatch,
  effectsText,
  fillTokens,
  findSpot,
  hintsFor,
  largestAbandoned,
  spotAvailable,
  targetCenter,
  unlockStory,
  writeLocals,
  type EffectHost,
} from '../../src/game/story/effects';
import { standing } from '../../src/game/story/factions';
import { resolveMods } from '../../src/game/story/resolve';
import * as turf from '../../src/game/story/turf';
import type { Effect, EndingId, FlagValue, SpotRule } from '../../src/game/story/types';
import * as vertical from '../../src/game/story/vertical';
import { MAP_SIZE, ZoneType, type Building } from '../../src/game/types';
import type { World } from '../../src/game/world';
import { flatWorld } from '../helpers';

useStoryContent(STORY_CONTENT);

const N = MAP_SIZE;
let w: World;
let calls: {
  queue: [string, number][];
  log: number[];
  flags: [string, FlagValue][];
  countdown: number[];
  charter: number;
  ending: EndingId[];
};
let host: EffectHost;

beforeEach(() => {
  w = flatWorld(31);
  calls = { queue: [], log: [], flags: [], countdown: [], charter: 0, ending: [] };
  host = {
    world: w,
    rng: new Rng(7),
    queue: (c, d) => void calls.queue.push([c, d]),
    log: (n) => void calls.log.push(n),
    flagSet: (k, v) => void calls.flags.push([k, v]),
    countdown: (d) => void calls.countdown.push(d),
    charterNight: () => void calls.charter++,
    ending: (id) => void calls.ending.push(id),
  };
});

const run = (fx: Effect[], spot = -1) => applyEffects(host, fx, { spot });
const at = (x: number, y: number) => y * N + x;

function own(x: number, y: number, code: 1 | 2, str = 60) {
  w.turf.owner[at(x, y)] = code;
  w.turf.str[at(x, y)] = str;
}
function ownRect(x0: number, y0: number, x1: number, y1: number, code: 1 | 2, str = 60) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) own(x, y, code, str);
  turf.refreshStats(w);
}
function dev(x: number, y: number, zone = ZoneType.Residential, level = 1) {
  w.setZone(x, y, zone);
  w.setLevel(x, y, level);
}
function powered(b: Building | null): Building {
  b!.powered = true;
  return b!;
}

// ── One case per effect kind ────────────────────────────────────────────────

const CASES: Record<Effect['t'], () => void> = {
  funds: () => {
    w.funds = 1000;
    run([{ t: 'funds', v: 500 }, { t: 'funds', v: -2000 }]);
    expect(w.funds).toBe(-500); // a CR cost may push funds below zero
  },
  favor: () => {
    const ev: string[] = [];
    w.events.on('standing', (e) => ev.push(`${e.faction}${e.delta}`));
    run([{ t: 'favor', f: 'board', v: 5 }]);
    expect(w.story.favor.board).toBe(15);
    w.story.flags.patron = 'nacre';
    run([{ t: 'favor', f: 'patron', v: 3 }, { t: 'favor', f: 'rival', v: -4 }]);
    expect(w.story.favor.nacre).toBe(3);
    expect(w.story.favor.basalt).toBe(-4);
    run([{ t: 'favor', f: 'gangs', v: -35 }, { t: 'favor', f: 'corps', v: 2 }]);
    expect(w.story.favor.undertow).toBe(-45);
    expect(w.story.favor.kites).toBe(-45);
    expect(w.story.favor.basalt).toBe(-2);
    run([{ t: 'favor', f: 'kites', v: -200 }]);
    expect(w.story.favor.kites).toBe(-100);
    expect(ev[0]).toBe('board5');
  },
  trace: () => {
    run([{ t: 'trace', v: 5 }]);
    expect(w.story.trace).toBe(5);
    expect(w.story.traceRaisedThisMonth).toBe(true);
    run([{ t: 'trace', v: -10 }]);
    expect(w.story.trace).toBe(0);
    w.story.flags.traceFrozen = true;
    run([{ t: 'trace', v: 12 }]);
    expect(w.story.trace).toBe(0);
    delete w.story.flags.traceFrozen;
    run([{ t: 'trace', v: 140 }]);
    expect(w.story.trace).toBe(100);
    run([{ t: 'trace', v: -30 }]); // locked at 100 (sys.revealed is due)
    expect(w.story.trace).toBe(100);
    w.story.trace = 50;
    w.story.revealed = true;
    expect(addTrace(w, 5)).toBe(0);
  },
  mod: () => {
    w.tick = 100;
    run([{ t: 'mod', id: 'm1', label: 'Test', days: 360, mods: { demandInd: 0.1 } }]);
    expect(w.story.mods).toEqual([{ id: 'm1', label: 'Test', until: 460, mods: { demandInd: 0.1 } }]);
    run([{ t: 'mod', id: 'm1', label: 'Test', days: 30, mods: { demandInd: 0.2 } }]); // same id refreshes
    expect(w.story.mods.length).toBe(1);
    expect(w.story.mods[0].until).toBe(130);
    run([{ t: 'mod', id: 'm2', label: 'Forever', days: 'perm', mods: { approvalAdd: 3 } }]);
    expect(w.story.mods[1].until).toBe(-1);
    applyEffects(host, [{ t: 'mod', id: 'm3', label: 'Deal', days: 'perm', mods: { trafficMul: 0.9 } }], { spot: -1, dealUntil: 460 });
    expect(w.story.mods[2].until).toBe(460);
    expect(resolveMods(w).demandInd).toBeCloseTo(0.2, 6);
  },
  income: () => {
    w.tick = 60;
    run([{ t: 'income', id: 'i1', label: 'Corner levy', perMonth: 250, months: 12 }]);
    expect(w.story.incomes).toEqual([{ id: 'i1', label: 'Corner levy', perMonth: 250, until: 60 + 360 }]);
    run([{ t: 'income', id: 'i1', label: 'Corner levy', perMonth: 250, months: 12 }]); // debts and levies stack
    expect(w.story.incomes.length).toBe(2);
  },
  local: () => {
    run([{ t: 'local', id: 'l1', at: 'spot', r: 3, days: 30, crimeAdd: 0.15 }], at(20, 20));
    expect(w.story.locals[0]).toMatchObject({ id: 'l1', x: 20.5, y: 20.5, r: 3, until: 30, crimeAdd: 0.15, lvAdd: 0 });
    expect(w.layerParts.local.crimeAdd[at(20, 20)]).toBeCloseTo(0.15, 6);
    expect(w.layers.crimeAdd[at(22, 20)]).toBeCloseTo(0.15, 6);
    expect(w.layers.crimeAdd[at(24, 20)]).toBe(0);
    // Unresolvable targets are skipped: no seam yet.
    run([{ t: 'local', id: 'l2', at: 'seam', r: 6, days: 30, lvAdd: 0.1 }]);
    expect(w.story.locals.length).toBe(1);
  },
  turf: () => {
    run([{ t: 'turf', gang: 'kites', op: 'seed', at: 'spot', v: 60 }], at(30, 30));
    expect(turf.gangTiles(w).kites).toBe(9);
    ownRect(10, 10, 14, 14, 1, 50);
    // `strongestTurf` inside a turf effect = that gang's strongest tile (10,10); r1 = 3 owned tiles.
    run([{ t: 'turf', gang: 'undertow', op: 'str', at: 'strongestTurf', r: 1, v: 20 }]);
    expect(w.turf.str[at(10, 10)]).toBe(70);
    expect(w.turf.str[at(11, 10)]).toBe(70);
    expect(w.turf.str[at(12, 12)]).toBe(50);
    run([{ t: 'turf', gang: 'all', op: 'str', at: 'city', v: -55 }]);
    expect(turf.gangTiles(w)).toEqual({ undertow: 3, kites: 9 });
    ownRect(40, 40, 42, 42, 1, 40);
    run([{ t: 'turf', gang: 'undertow', op: 'flip', at: 'strongestTurf:undertow', r: 8, to: 'kites' }]);
    expect(turf.gangTiles(w)).toEqual({ undertow: 3, kites: 18 });
    expect(w.turf.str[at(41, 41)]).toBe(40); // strength kept
    run([{ t: 'turf', gang: 'kites', op: 'clear', at: 'city' }]);
    expect(turf.gangTiles(w).kites).toBe(0);
    w.tick = 10;
    run([{ t: 'turf', gang: 'all', op: 'freeze', at: 'city', days: 720 }]);
    expect(w.turf.frozenUntil).toBe(730);
    // `turf seed all (city)` is the Ch3 force-seed (only gangs that never seeded).
    w.turf.seeded = { undertow: false, kites: false };
    dev(30, 30);
    run([{ t: 'turf', gang: 'all', op: 'seed', at: 'city' }]);
    expect(w.turf.seeded).toEqual({ undertow: true, kites: true });
  },
  offline: () => {
    const r1 = w.addBuilding('reactor', 2, 2)!;
    const r2 = w.addBuilding('solar', 8, 2)!;
    run([{ t: 'offline', what: 'plant', n: 1, days: 20 }]);
    expect([r1.offline, r2.offline].sort()).toEqual([0, 20]);
    const h1 = w.addBuilding('datahub', 20, 20)!;
    const h2 = w.addBuilding('datahub', 30, 20)!;
    run([{ t: 'offline', what: ['datahub'], n: 'all', days: 45 }]);
    expect([h1.offline, h2.offline]).toEqual([30, 30]); // capped at 30
    const p = w.addBuilding('plaza', 40, 40)!;
    run([{ t: 'offline', what: 'district', n: 'all', days: 20, at: 'spot', r: 3 }], at(41, 41));
    expect(p.offline).toBe(20);
    const c = w.addBuilding('clinic', 50, 50)!;
    own(52, 55, 1);
    run([{ t: 'offline', what: 'nearTurf', n: 1, days: 30, gang: 'undertow' }]);
    expect(c.offline).toBe(30);
    // Rail: no live line → skipped; with one, the line is cut.
    run([{ t: 'offline', what: 'rail', n: 1, days: 30 }]);
    expect(w.story.railOut).toEqual([]);
    w.funds = 1e6;
    w.story.unlocks.push('rail');
    powered(w.addBuilding('maglev', 10, 30));
    powered(w.addBuilding('maglev', 20, 30));
    applyAction(w, 'rail', { x: 12, y: 30 }, { x: 19, y: 30 });
    vertical.refresh(w);
    expect(w.vertical.railLive[at(15, 30)]).toBe(1);
    run([{ t: 'offline', what: 'rail', n: 1, days: 30 }]);
    expect(w.story.railOut.length).toBe(1);
    expect(w.vertical.railLive[at(15, 30)]).toBe(0);
  },
  abandon: () => {
    for (let x = 10; x < 15; x++) dev(x, 10);
    for (let x = 10; x < 15; x++) dev(x, 11, ZoneType.Commercial);
    run([{ t: 'abandon', at: 'spot', r: 3, n: 3, zone: 'res' }], at(12, 10));
    expect(w.tiles.filter((t) => t.abandoned).length).toBe(3);
    expect(w.tiles.filter((t) => t.abandoned && t.zone !== ZoneType.Residential).length).toBe(0);
    run([{ t: 'abandon', at: 'spot', r: 3, n: 50 }], at(12, 10));
    expect(w.tiles.filter((t) => t.abandoned).length).toBe(10);
  },
  renew: () => {
    for (let x = 10; x < 14; x++) {
      dev(x, 10, ZoneType.Residential, 2);
      w.setLevel(x, 10, 2, true);
    }
    run([{ t: 'renew', at: 'largestAbandoned', r: 4 }]);
    expect(w.tiles.some((t) => t.abandoned)).toBe(false);
    expect(w.tiles[at(11, 10)].level).toBe(0);
    expect(w.tiles[at(11, 10)].zone).toBe(ZoneType.Residential);
  },
  unlock: () => {
    const got: string[] = [];
    w.events.on('unlock', (u) => got.push(u.what));
    run([{ t: 'unlock', what: 'memorial' }, { t: 'unlock', what: 'memorial' }]);
    expect(w.story.unlocks).toEqual(['memorial']);
    expect(got).toEqual(['memorial']);
    expect(w.news.at(-1)?.text).toBe('Unlocked: Sunk Memorial. Eleven thousand names.');
    expect(unlockStory(w, 'memorial')).toBe(false);
  },
  credit: () => {
    run([{ t: 'credit', what: 'stack', n: 1, mul: 0 }]);
    expect(w.story.credits).toEqual([{ what: 'stack', n: 1, mul: 0 }]);
    w.story.flags.patron = 'nacre';
    run([{ t: 'credit', what: 'patronExclusive', n: 1, mul: 0.5 }]);
    expect(w.story.credits[1]).toEqual({ what: 'glarewall', n: 1, mul: 0.5 });
  },
  flag: () => {
    run([{ t: 'flag', key: 'larkKnows', v: true }, { t: 'flag', key: 'fen', v: 'free' }]);
    expect(w.story.flags.larkKnows).toBe(true);
    expect(w.story.flags.fen).toBe('free');
    run([{ t: 'flag', key: 'branded', v: '+1' }, { t: 'flag', key: 'branded', v: '+1' }]);
    expect(w.story.flags.branded).toBe(2);
    w.story.favor.nacre = 30;
    run([{ t: 'flag', key: 'patron', v: '$patron' }]);
    expect(w.story.flags.patron).toBe('nacre');
    expect(calls.flags.map((f) => f[0])).toEqual(['larkKnows', 'fen', 'branded', 'branded', 'patron']);
  },
  floor: () => {
    w.story.favor.board = -50;
    run([{ t: 'floor', f: 'board', v: 0 }, { t: 'floor', f: 'board', v: -20 }]);
    expect(w.story.floors.board).toBe(0); // the highest floor wins
    expect(standing(w, 'board')).toBe(0);
  },
  ceil: () => {
    w.story.favor.basalt = 80;
    run([{ t: 'ceil', f: 'basalt', v: 20 }, { t: 'ceil', f: 'basalt', v: 40 }]);
    expect(w.story.ceils.basalt).toBe(20); // the lowest ceiling wins
    expect(standing(w, 'basalt')).toBe(20);
  },
  pact: () => {
    w.tick = 30;
    run([{ t: 'pact', gang: 'undertow', months: 12 }]);
    expect(w.story.pacts).toEqual([{ gang: 'undertow', until: 390 }]);
    expect(w.story.gangActions).toBe(1);
    expect(turf.pactActive(w, 'undertow')).toBe(true);
    w.tick = 300;
    run([{ t: 'pact', gang: 'undertow', months: 12 }]); // renewing extends
    expect(w.story.pacts).toEqual([{ gang: 'undertow', until: 660 }]);
    w.story.ending = 'ledger'; // Open Ledger locks pacts
    run([{ t: 'pact', gang: 'kites', months: 12 }]);
    expect(w.story.pacts.some((p) => p.gang === 'kites')).toBe(false);
  },
  queue: () => {
    run([{ t: 'queue', card: 'kt.probe', days: 90 }, { t: 'queue', card: 'ch3.winner', days: 0 }]);
    expect(calls.queue).toEqual([
      ['kt.probe', 90],
      ['ch3.winner', 0],
    ]);
  },
  log: () => {
    run([{ t: 'log', n: 7 }]);
    expect(calls.log).toEqual([7]);
  },
  reveal: () => {
    w.story.trace = 30;
    run([{ t: 'reveal' }]);
    expect(w.story.revealed).toBe(true);
    expect(w.story.flags.revealed).toBe(true);
    run([{ t: 'trace', v: 10 }]);
    expect(w.story.trace).toBe(30); // Trace is ignored once revealed
  },
  news: () => {
    run([{ t: 'news', text: 'Lights out in {city}.', kind: 'bad' }]);
    expect(w.news.at(-1)).toMatchObject({ text: 'Lights out in Testopolis.', kind: 'bad' });
    // {plant} / {district} follow the last offline effect.
    w.addBuilding('reactor', 2, 2);
    run([{ t: 'offline', what: 'plant', n: 1, days: 20 }, { t: 'news', text: 'A {plant} offline in {district}.', kind: 'bad' }]);
    expect(w.news.at(-1)!.text).toBe(`A ${BUILDINGS.reactor.name} offline in ${districtName(2, 2, w.seed)}.`);
  },
  gangAction: () => {
    w.tick = 77;
    run([{ t: 'gangAction' }]);
    expect(w.story.gangActions).toBe(1);
    expect(w.story.lastCrackdownTick).toBeLessThan(0);
    run([{ t: 'gangAction', crackdown: true }]);
    expect(w.story.gangActions).toBe(2);
    expect(w.story.lastCrackdownTick).toBe(77);
  },
  countdown: () => {
    run([{ t: 'countdown', days: 360 }]);
    expect(calls.countdown).toEqual([360]);
  },
  charterNight: () => {
    run([{ t: 'charterNight' }]);
    expect(calls.charter).toBe(1);
  },
  ending: () => {
    run([{ t: 'ending', id: 'quiet' }]);
    expect(calls.ending).toEqual(['quiet']);
  },
  if: () => {
    w.story.flags.leashed = true;
    const fx: Effect[] = [{ t: 'if', c: { flag: 'leashed' }, then: [{ t: 'favor', f: 'board', v: -20 }], else: [{ t: 'favor', f: 'board', v: 20 }] }];
    run(fx);
    expect(w.story.favor.board).toBe(-10);
    delete w.story.flags.leashed;
    run(fx);
    expect(w.story.favor.board).toBe(10);
    run([{ t: 'if', c: { flag: 'nope' }, then: [{ t: 'funds', v: 1 }] }]); // no else: nothing
    expect(w.funds).toBe(25000);
  },
};

describe('effects (§10.3)', () => {
  for (const [kind, fn] of Object.entries(CASES)) it(kind, () => fn());

  it('a bad effect is skipped, never thrown; later effects still apply', () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      run([{ t: 'offline', what: ['nope' as never], n: 1, days: 5 }, { t: 'funds', v: 7 }, { t: 'turf', gang: 'kites', op: 'str', at: 'seam', r: 4, v: 10 }]);
    } finally {
      console.warn = warn;
    }
    expect(w.funds).toBe(25007);
  });
});

// ── Targets, spots, surge, locals ───────────────────────────────────────────

describe('targets and spots (§7.1, §10.1)', () => {
  it('resolves targets, −1 when there is nothing to aim at', () => {
    expect(targetCenter(w, 'spot', -1)).toBe(-1);
    expect(targetCenter(w, 'spot', 99)).toBe(99);
    expect(targetCenter(w, 'seam', -1)).toBe(-1);
    w.story.seam = at(5, 6);
    expect(targetCenter(w, 'seam', -1)).toBe(at(5, 6));
    expect(targetCenter(w, 'strongestTurf', -1)).toBe(-1); // only meaningful inside a turf effect
    own(3, 3, 2, 80);
    own(9, 9, 2, 40);
    turf.refreshStats(w);
    expect(targetCenter(w, 'strongestTurf:kites', -1)).toBe(at(3, 3));
    expect(targetCenter(w, 'strongestTurf', -1, 'kites')).toBe(at(3, 3));
    expect(targetCenter(w, 'largestAbandoned', -1)).toBe(-1);
  });

  it('largestAbandoned picks the biggest cluster near its centre', () => {
    for (let x = 10; x < 15; x++) {
      dev(x, 10);
      w.setLevel(x, 10, 1, true);
    }
    dev(40, 40);
    w.setLevel(40, 40, 1, true);
    expect(largestAbandoned(w)).toBe(at(12, 10));
  });

  it('each spot rule finds a tile, or reports none', () => {
    const rules: SpotRule[] = ['industrial', 'abandoned', 'turf:undertow', 'turf:kites', 'waterfrontTurf', 'seam', 'skybridge', 'random'];
    for (const r of rules) expect(spotAvailable(w, r), r).toBe(false);
    dev(5, 5, ZoneType.Industrial);
    w.stats.developed = { res: 0, com: 0, ind: 1 };
    expect(findSpot(w, 'industrial', host.rng)).toBe(at(5, 5));
    expect(findSpot(w, 'random', host.rng)).toBe(at(5, 5));
    own(20, 20, 1, 70);
    own(30, 30, 2, 50);
    turf.refreshStats(w);
    expect(findSpot(w, 'turf:undertow', host.rng)).toBe(at(20, 20));
    expect(findSpot(w, 'turf:kites', host.rng)).toBe(at(30, 30));
    expect(findSpot(w, 'waterfrontTurf', host.rng)).toBe(at(20, 20)); // no water: falls back to turf:undertow
    expect(spotAvailable(w, 'seam')).toBe(true); // both gangs hold turf now
    expect(findSpot(w, 'seam', host.rng)).toBe(w.story.seam);
    expect(findSpot(w, 'skybridge', host.rng)).toBe(-1);
  });

  it('gangSurge: +30 in a 5×5, claiming unowned eligible tiles at 30', () => {
    own(10, 10, 1, 40);
    turf.refreshStats(w);
    const n = applySurge(w, 'undertow', 10, 10);
    expect(n).toBe(25);
    expect(w.turf.str[at(10, 10)]).toBe(70);
    expect(w.turf.str[at(12, 12)]).toBe(30);
    expect(w.turf.owner[at(13, 10)]).toBe(0);
  });

  it('writeLocals skips expired discs and keeps the rest', () => {
    w.tick = 100;
    w.story.locals.push({ id: 'a', x: 5.5, y: 5.5, r: 2, until: 50, crimeAdd: 0.2, lvAdd: 0 });
    w.story.locals.push({ id: 'b', x: 20.5, y: 20.5, r: 2, until: 200, crimeAdd: 0, lvAdd: 0.05 });
    writeLocals(w);
    expect(w.layers.crimeAdd[at(5, 5)]).toBe(0);
    expect(w.layers.lvAdd[at(20, 20)]).toBeCloseTo(0.05, 6);
  });
});

// ── Tokens, hints and text (§0, §8.2) ───────────────────────────────────────

describe('tokens, hints and effect text', () => {
  it('fills every token; unknown tokens stay', () => {
    w.story.logs = [1, 2, 3];
    w.tick = 360 * 2;
    const s = fillTokens(w, '{city}|{district}|{patron}|{rival}|{year}|{coherence}|{nope}', at(9, 9));
    expect(s).toBe(`Testopolis|${districtName(9, 9, w.seed)}|${FACTION_LABELS.basalt.name}|Nacre|2093|28|{nope}`);
    expect(fillTokens(w, '{district}', -1)).toBe(districtName(32, 32, w.seed)); // map centre
  });

  it('hint chips: favor pips by size, CR, Trace, timed, unlock, log, maybe', () => {
    const fx: Effect[] = [
      { t: 'favor', f: 'board', v: 5 },
      { t: 'favor', f: 'board', v: 10 },
      { t: 'favor', f: 'gangs', v: -35 },
      { t: 'funds', v: -800 },
      { t: 'trace', v: 4 },
      { t: 'mod', id: 'x', label: 'x', days: 180, mods: { approvalAdd: 2 } },
      { t: 'unlock', what: 'memorial' },
      { t: 'log', n: 7 },
      { t: 'if', c: { flag: 'x' }, then: [] },
    ];
    expect(hintsFor(w, fx)).toEqual([
      { k: 'favor', f: 'board', dir: 1, pips: 2 },
      { k: 'favor', f: 'undertow', dir: -1, pips: 3 },
      { k: 'favor', f: 'kites', dir: -1, pips: 3 },
      { k: 'cr', v: -800 },
      { k: 'trace', v: 4 },
      { k: 'timed', months: 6 },
      { k: 'unlock' },
      { k: 'log' },
      { k: 'maybe' },
    ]);
    expect(hintsFor(w, [])).toEqual([]);
  });

  it('hint chips: buildings offline, emptied blocks, Charter Night and a follow-up card (never a whisper)', () => {
    expect(
      hintsFor(w, [
        { t: 'queue', card: 'ch3.winner', days: 0 },
        { t: 'offline', what: 'plant', n: 1, days: 20 },
        { t: 'abandon', at: 'spot', r: 3, n: 4 },
        { t: 'charterNight' },
      ]),
    ).toEqual([{ k: 'offline' }, { k: 'abandon' }, { k: 'charter' }, { k: 'follow' }]);
    expect(hintsFor(w, [{ t: 'queue', card: 'wh.clerk', days: 180 }])).toEqual([]); // the ticker only
    expect(effectsText(w, [{ t: 'queue', card: 'ch3.winner', days: 0 }])).toBe('a follow-up next');
    expect(effectsText(w, [{ t: 'queue', card: 'kt.probe', days: 90 }])).toBe('a follow-up later');
    expect(effectsText(w, [{ t: 'queue', card: 'wh.clerk', days: 180 }])).toBe('No effect.');
  });

  it('the hidden Tuning is never named on a choice (chips, summary or exact effects) until it shows itself', () => {
    const fx: Effect[] = [{ t: 'favor', f: 'tuning', v: -5 }, { t: 'favor', f: 'board', v: 5 }];
    expect(hintsFor(w, fx)).toEqual([{ k: 'favor', f: 'board', dir: 1, pips: 1 }]);
    expect(effectsText(w, fx)).toBe('Board +5');
    w.story.flags.tuningActive = true;
    expect(hintsFor(w, fx).map((x) => (x.k === 'favor' ? x.f : x.k))).toEqual(['board', 'tuning']);
    expect(effectsText(w, fx)).toBe('Tuning −5 · Board +5');
  });

  it('every story choice that does something says so under its label (no "no visible effect" over a real effect)', () => {
    // Effects a player can't see on the choice line, and that do nothing visible on their own.
    const silent = new Set<Effect['t']>(['flag', 'news']);
    w.story.flags.tuningActive = true; // the Tuning's own cards only come once it shows itself
    const bad: string[] = [];
    for (const c of STORY_CONTENT.cards) {
      if (c.choices.length < 2) continue; // a lone "Continue." shows no summary
      c.choices.forEach((ch, i) => {
        const fx = ch.fx ?? [];
        if (hintsFor(w, fx).length) return;
        const loud = fx.filter((e) => !silent.has(e.t) && !(e.t === 'queue' && STORY_CONTENT.cards.find((k) => k.id === e.card)?.kind === 'whisper'));
        if (loud.length) bad.push(`${c.id} [${i}] "${ch.label}": ${loud.map((e) => e.t).join(', ')}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('effect text reads like the spec notation', () => {
    expect(effectsText(w, [{ t: 'favor', f: 'board', v: 5 }, { t: 'trace', v: -2 }, { t: 'funds', v: 3000 }])).toBe(
      'Board +5 · Trace −2 · +3,000 CR',
    );
    expect(effectsText(w, [{ t: 'mod', id: 'x', label: 'x', days: 720, mods: { demandInd: 0.1 } }])).toBe('Fab demand +0.1 for 24 mo');
    expect(effectsText(w, [])).toBe('No effect.');
    expect(describePatch({ buildCostMul: 1.15, costMul: { glarewall: 0 }, favorMonthly: { kites: -1 } })).toBe(
      'build costs ×1.15 · Glarewall free · Kites −1 a month',
    );
  });
});

// ── resolveMods (§10.4) ─────────────────────────────────────────────────────

describe('resolveMods: every source, then the clamps', () => {
  it('timed mods count until they expire; permanent ones always', () => {
    w.tick = 100;
    w.story.mods.push({ id: 'a', label: 'a', until: 100, mods: { demandRes: 0.2 } });
    w.story.mods.push({ id: 'b', label: 'b', until: 101, mods: { demandRes: 0.1 } });
    w.story.mods.push({ id: 'c', label: 'c', until: -1, mods: { approvalAdd: 3 } });
    const m = resolveMods(w);
    expect(m.demandRes).toBeCloseTo(0.1, 6);
    expect(m.approvalAdd).toBe(3);
  });

  it('tier penalties and perks: Cold, Hostile (= Cold + hostile), Allied; nothing for the hidden Tuning', () => {
    w.story.favor.basalt = -30;
    expect(resolveMods(w).buildCostMul).toBeCloseTo(1.15, 6);
    w.story.favor.kites = -70;
    const m = resolveMods(w);
    expect(m.taxIncomeMul).toBeCloseTo(0.97, 6);
    expect(m.traceMonthly).toBe(2);
    w.story.favor.board = 70;
    expect(resolveMods(w).approvalAdd).toBe(5);
    w.story.favor.tuning = -90;
    expect(resolveMods(w).securityMul).toBe(1);
    w.story.flags.tuningActive = true;
    expect(resolveMods(w).securityMul).toBeCloseTo(0.85, 6);
  });

  it('the patron perk needs the flag and a standing of at least 0', () => {
    w.story.favor.basalt = 40; // a resolved stand-in gets nothing
    expect(resolveMods(w).costMul.reactor).toBeUndefined();
    w.story.flags.patron = 'basalt';
    expect(resolveMods(w).costMul.reactor).toBeCloseTo(0.75, 6);
    w.story.favor.basalt = -10;
    expect(resolveMods(w).costMul.reactor).toBeUndefined();
  });

  it("the current ending's post patch (and the Lamplight variant), read live", () => {
    w.story.ending = 'ironwork';
    let m = resolveMods(w);
    expect(m.demandInd).toBeCloseTo(0.15, 6);
    expect(m.taxCap).toBe(15);
    w.story.ending = 'quiet';
    m = resolveMods(w);
    expect(m.cardRateMul).toBeCloseTo(1.3, 6);
    expect(m.taxCap).toBe(20);
    expect(m.approvalAdd).toBe(0);
    w.story.endingVariant = 'lamplight';
    expect(resolveMods(w).approvalAdd).toBe(5);
  });

  it('clamps the result', () => {
    w.story.mods.push({ id: 'x', label: 'x', until: -1, mods: { approvalAdd: 50, buildCostMul: 10, demandCom: -2, taxCap: 1 } });
    const m = resolveMods(w);
    expect(m.approvalAdd).toBe(20);
    expect(m.buildCostMul).toBe(4);
    expect(m.demandCom).toBe(-0.5);
    expect(m.taxCap).toBe(5);
  });
});
