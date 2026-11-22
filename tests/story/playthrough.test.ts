// Headless playthroughs and director features (STORY.md §13 "Playthrough",
// §2.5, §2.6, §6, §7.9, §9, §10.9), against the real content in
// src/game/story/content.
//
//   - a greedy builder with random choices plays 40 sim years without throwing,
//     reaches Ch6 through fallbacks and waivers, sees a ⚑ card and a bailout;
//     the Quiet Hand is always selectable; no faction card before COMMS; no ‡
//     default before 60 unpaused seconds
//   - a city that never passes 800 residents still reaches Ch6
//   - a run that picks Run Clean Glass completes Ch3
//   - endings, Charter Night, Recount, Charter Review, Lamplight, the gallery
//   - deals, pacts, salt, nudge, build reactions, signals, Trace, whispers,
//     notes, ledger, view(), visual, save and restore mid-story

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction } from '../../src/game/actions';
import { GALLERY_KEY, STORY_PACING } from '../../src/game/config';
import type { Game } from '../../src/game/game';
import { Rng } from '../../src/game/rng';
import { readGallery } from '../../src/game/story/director';
import { isRetired, standing } from '../../src/game/story/factions';
import * as turf from '../../src/game/story/turf';
import { ZoneType } from '../../src/game/types';
import { answerAll, headlessGame, playStory, spiteLowest, type RunLog } from './harness';

const P = STORY_PACING;

function days(g: Game, n: number, sec = 0) {
  for (let k = 0; k < n; k++) {
    if (sec) g.story.update(sec, false);
    g.sim.step();
    g.story.onDay();
  }
}
const openId = (g: Game) => g.world.story.open?.card ?? null;

let store: Map<string, string> | null = null;
function mockStorage() {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
  store = m;
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  store = null;
});

/** Common invariants of every headless run. */
function invariants(log: RunLog) {
  // No faction card before COMMS.
  expect(log.arrived.every((a) => a.comms)).toBe(true);
  // Reading budget (§7.1, §8.11): deck deliveries at least 120 unpaused seconds apart.
  for (let k = 1; k < log.deck.length; k++) expect(log.deck[k].sec - log.deck[k - 1].sec).toBeGreaterThanOrEqual(P.minActiveSecBetween - 1e-6);
  // No ‡ default before 60 unpaused seconds.
  for (const d of log.defaults) expect(d.waitedSec).toBeGreaterThanOrEqual(P.pendingMinSec - 1e-6);
}

const HOSTILE_CARDS = ['bd.freeze', 'ba.embargo', 'nc.blackout', 'ut.highwater', 'kt.string', 'tu.snuff'];

// ── The long runs ───────────────────────────────────────────────────────────

describe('headless playthroughs (§13)', () => {
  it('a greedy builder with random choices plays 40 years: Ch6, an ending, ⚑ cards, a bailout', () => {
    const quietAlways: boolean[] = [];
    const random = (choices: { locked?: string }[], rng: Rng) => {
      const open = choices.map((c, k) => (c.locked ? -1 : k)).filter((k) => k >= 0);
      return open[Math.floor(rng.next() * open.length)] ?? 0;
    };
    const { game, log } = playStory({
      seed: 2091,
      years: 40,
      answerPending: 0.5,
      // Random choices, half of them leaning against whoever is already lowest (a player with a grudge).
      pick: (id, choices, rng, d) => (rng.next() < 0.5 ? spiteLowest()(id, choices, rng, d) : random(choices, rng)),
      ending: (ok, rng) => {
        quietAlways.push(ok.includes('quiet'));
        return ok[Math.floor(rng.next() * ok.length)];
      },
      each: (g, day) => {
        // An overspend in year 7: a megaproject the city can't pay for.
        if (day === 7 * 360) g.world.funds = -60000;
        // The greedy builder sends the wasps whenever a precinct can.
        if (day % 30 === 0) for (const b of g.world.buildings.values()) if (b.type === 'precinct') g.crackdown(b.id);
      },
    });
    const w = game.world;
    expect(log.maxChapter).toBeGreaterThanOrEqual(6);
    expect(w.story.chapter).toBe(7);
    expect(log.endings.length).toBeGreaterThanOrEqual(1);
    expect(log.opened.some((id) => HOSTILE_CARDS.includes(id))).toBe(true);
    expect(log.opened).toContain('sys.bailout');
    expect(w.funds).toBeGreaterThan(-5000); // no losing: the city recovered
    expect(quietAlways.length).toBeGreaterThan(0);
    expect(quietAlways.every(Boolean)).toBe(true);
    for (let n = 1; n <= 6; n++) expect(w.story.logs).toContain(n); // every chapter reward and Log 6
    invariants(log);
    expect(log.arrived.length).toBeGreaterThan(0);
    // §2.3: a faction's ⚑ repeats at most every 180 d, and city-wide at most one ⚑ per 60 d.
    const flags = log.deck.filter((d) => d.kind === 'hostile');
    for (let k = 1; k < flags.length; k++) {
      expect(flags[k].tick - flags[k - 1].tick).toBeGreaterThanOrEqual(P.hostileGap);
      const prev = flags.slice(0, k).reverse().find((f) => f.id === flags[k].id);
      if (prev) expect(flags[k].tick - prev.tick).toBeGreaterThanOrEqual(P.hostileEvery);
    }
    // Story overhead stays small next to the sim.
    expect(log.storyMs / (40 * 360)).toBeLessThan(0.5);
    expect(Number.isFinite(w.funds)).toBe(true);
    expect(JSON.parse(JSON.stringify(w.story))).toEqual(w.story);
  }, 120000);

  it('a city that never passes 800 residents still reaches Ch6 (1,440-day fallbacks, beat time-outs, waivers)', () => {
    const { game, log } = playStory({ seed: 77, years: 40, builder: 'low', answerPending: 0.3 });
    expect(game.world.maxPopulation).toBeLessThanOrEqual(800);
    expect(log.maxChapter).toBeGreaterThanOrEqual(6);
    expect(game.world.story.chapter).toBe(7); // and an ending was held
    expect(log.endings).toContain('quiet');
    invariants(log);
  }, 120000);

  it('a run that picks Run Clean Glass completes Ch3', () => {
    let pier = -1;
    const { game, log } = playStory({
      seed: 5,
      years: 15,
      pick: (id, choices, rng, d) => {
        if (id === 'ch3.pier') return (pier = d.view().card!.choices.findIndex((c) => c.label === 'Run Clean Glass.'));
        const open = choices.map((c, k) => (c.locked ? -1 : k)).filter((k) => k >= 0);
        return open[Math.floor(rng.next() * open.length)];
      },
      each: (g) => g.world.story.chapter >= 4,
    });
    expect(pier).toBe(0);
    expect(game.world.story.keyChoices['ch3.pier']).toBe(0);
    expect(game.world.story.flags.cleanGlass).toBe(true);
    expect(game.world.story.gangActions).toBeGreaterThanOrEqual(1); // Clean Glass counts as a crackdown
    expect(game.world.story.chapter).toBe(4);
    expect(game.world.story.logs).toContain(3);
    invariants(log);
  }, 60000);

  it('saving and loading mid-story continues the same story', () => {
    const { game } = playStory({ seed: 9, years: 5, answerPending: 0.5 });
    const save = JSON.parse(JSON.stringify(game.world.serialize()));
    expect(save.story.story.chapter).toBe(game.world.story.chapter);
    const a = headlessGame(1);
    const b = headlessGame(2);
    expect(a.restore(JSON.parse(JSON.stringify(save)))).toBe(true);
    expect(b.restore(JSON.parse(JSON.stringify(save)))).toBe(true);
    expect(a.world.story).toEqual(game.world.story);
    // Two loads of one save play out the same.
    for (const g of [a, b]) {
      const r = new Rng(4);
      const log: RunLog = { deck: [], storyMs: 0, worstDayMs: 0, opened: [], arrived: [], defaults: [], chapters: [], endings: [], charterNights: 0, cardSecs: [], maxChapter: 1 };
      for (let d = 0; d < 720; d++) {
        g.story.update(0.5, false);
        answerAll(g, r, log, { years: 0 });
        g.sim.step();
        g.story.onDay();
        answerAll(g, r, log, { years: 0 });
      }
    }
    expect(a.world.story.log).toEqual(b.world.story.log);
    expect(a.world.story.favor).toEqual(b.world.story.favor);
  }, 60000);
});

// ── Endings (§6) ────────────────────────────────────────────────────────────

/** A game whose Charter Night is about to open (Ch6, countdown ending tomorrow). */
function charterEve(seed = 60): Game {
  const g = headlessGame(seed);
  const st = g.world.story;
  st.unlocks.push('factions', 'comms');
  st.chapter = 6;
  st.phase = 'countdown';
  st.chapterTick = 0;
  st.beatsShown = ['ch6.eve'];
  st.seen['ch6.eve'] = 0;
  st.logs = [1, 2, 3, 4, 5];
  g.world.tick = 400;
  st.countdownEnd = 401;
  return g;
}

function openCount(g: Game): void {
  days(g, 1);
  g.story.update(11, false);
  expect(openId(g)).toBe('ch6.count');
  g.choose(0);
}

describe('Charter Night and endings (§6)', () => {
  beforeEach(() => mockStorage());

  it('the count opens Charter Night; claims are checked live; the Quiet Hand is always selectable', () => {
    const g = charterEve();
    let opened = 0;
    g.world.events.on('charterNight', () => opened++);
    openCount(g);
    expect(opened).toBe(1);
    expect(g.story.blocking).toBe(true);
    const claims = g.story.view().claims;
    expect(claims.map((c) => c.id)).toEqual(['ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet']);
    expect(claims.find((c) => c.id === 'quiet')!.ok).toBe(true);
    const iron = claims.find((c) => c.id === 'ironwork')!;
    expect(iron.ok).toBe(false);
    expect(iron.rows[0]).toEqual({ label: 'Basalt standing 60+', ok: false, gap: '0 / 60' });
    const r = g.story.chooseEnding('ironwork');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Claim not met: Basalt standing 60+');
    expect(g.story.view().factions.find((f) => f.id === 'basalt')!.claim).toBe('Ironwork: Basalt standing 60+ 0 / 60');
  });

  it('holding the charter: final card, Log 6, then the ending screen; the epilogue keeps the derived rules', () => {
    const g = charterEve();
    const endings: string[] = [];
    g.world.events.on('ending', (e) => endings.push(e.id));
    openCount(g);
    expect(g.story.chooseEnding('quiet').ok).toBe(true);
    expect(openId(g)).toBe('end.quiet');
    expect(g.story.view().card!.body).toContain('Harness Bay sleeps.');
    expect(endings).toEqual([]);
    g.choose(0);
    expect(openId(g)).toBe('reward.6');
    expect(g.story.view().card!.sys).toBe('> charter held · coherence 52%');
    g.choose(0);
    expect(endings).toEqual(['quiet']);
    const st = g.world.story;
    expect(st.chapter).toBe(7);
    expect(st.phase).toBe('ended');
    expect(st.logs).toContain(6);
    expect(g.story.view().chapter).toMatchObject({ numeral: 'VII', title: 'Epilogue' });
    expect(g.world.mods.cardRateMul).toBeCloseTo(1.3, 6);
    expect(readGallery().endings).toEqual(['quiet']);
    expect(JSON.parse(store!.get(GALLERY_KEY)!).endings).toEqual(['quiet']);
    expect(g.story.blocking).toBe(false);
    // Nudge: once per 360 d under the Quiet Hand.
    expect(g.story.nudge('kites').ok).toBe(true);
    expect(st.favor.kites).toBe(-10 + P.nudgeFavor);
    expect(g.story.nudge('board').reason).toBe(`Cooldown ${P.nudgeEvery}d`);
    expect(g.story.view().factions.find((f) => f.id === 'board')!.nudge).toMatchObject({ enabled: false, cooldownDays: 360 });
  });

  it('Lamplight: the Quiet Hand with a lit Tuning at 50+', () => {
    const g = charterEve();
    const st = g.world.story;
    st.flags.tuningActive = true;
    st.favor.tuning = 60;
    openCount(g);
    g.story.chooseEnding('quiet');
    expect(st.endingVariant).toBe('lamplight');
    expect(g.story.view().card!.body).toContain('In ten thousand windows');
    expect(g.story.visual.palette).toBe('lamplight');
    expect(g.story.visual.candles).toBe(1);
    expect(g.world.mods.approvalAdd).toBe(5);
    expect(readGallery().lamplight).toBe(true);
  });

  it('Recount adds six months and reopens the count', () => {
    const g = charterEve();
    let opened = 0;
    g.world.events.on('charterNight', () => opened++);
    openCount(g);
    g.story.recount();
    const st = g.world.story;
    expect(st.flags.charterNightOpen).toBe(false);
    expect(st.phase).toBe('countdown');
    expect(g.story.view().countdownDays).toBe(180);
    days(g, 179);
    expect(opened).toBe(1);
    days(g, 1);
    expect(opened).toBe(2);
    expect(g.story.blocking).toBe(true);
  });

  it('a Charter Review swaps the ending and every derived rule with it', () => {
    const g = charterEve();
    openCount(g);
    g.story.chooseEnding('quiet');
    g.choose(0);
    g.choose(0);
    const st = g.world.story;
    expect(st.nextReview).toBe(g.world.tick + P.reviewEvery);
    // Make Ironwork's claims hold.
    st.favor.basalt = 100;
    st.flags.patron = 'basalt';
    g.world.tick = st.nextReview! - 1;
    g.story.update(200, false);
    days(g, 1);
    for (let k = 0; k < 40 && openId(g) !== 'ep.review'; k++) days(g, 1);
    expect(openId(g)).toBe('ep.review');
    g.choose(1); // Open a new count
    expect(st.flags.charterNightOpen).toBe(true);
    g.world.stats.approval = 0; // shrink the Board's share so Basalt holds 30%
    g.world.stats.jobsInd = 4000;
    expect(g.story.view().claims.find((c) => c.id === 'ironwork')!.ok).toBe(true);
    expect(g.story.chooseEnding('ironwork').ok).toBe(true);
    expect(st.ending).toBe('ironwork');
    expect(openId(g)).toBe('end.ironwork');
    g.choose(0);
    expect(isRetired(g.world, 'board')).toBe(true);
    expect(g.world.mods.demandInd).toBeGreaterThanOrEqual(0.15);
    expect(g.world.mods.taxCap).toBe(15);
    expect(g.world.mods.cardRateMul).toBe(1); // the Quiet Hand's rule is gone
    expect(g.story.view().factions.find((f) => f.id === 'board')!.retiredLabel).toBe('Absorbed into Basalt');
    expect(g.story.sendSalt('board').ok).toBe(false);
    expect(readGallery().endings).toEqual(['quiet', 'ironwork']);
  });
});

// ── Deals, pacts, salt (§2.6, §3.6) ─────────────────────────────────────────

describe('deals, pacts and salt', () => {
  function midGame(): Game {
    const g = headlessGame(70);
    const st = g.world.story;
    st.unlocks.push('factions', 'comms');
    st.chapter = 4;
    st.phase = 'waiting';
    st.waitingSince = 0;
    g.world.stats.population = 5000;
    return g;
  }

  it('a deal needs the unlock, Friendly, no active deal and no cooldown', () => {
    const g = midGame();
    const st = g.world.story;
    expect(g.story.takeDeal('board').reason).toBe('Locked: reach 8,000 residents');
    st.unlocks.push('deals');
    expect(g.story.takeDeal('board').reason).toBe('Needs Board Friendly');
    st.favor.board = 25;
    const funds = g.world.funds;
    expect(g.story.takeDeal('board').ok).toBe(true);
    expect(g.world.funds).toBe(funds + 10000);
    expect(g.world.ledger.expense).toContainEqual({ label: 'Civic bond', amount: 450 });
    expect(g.story.takeDeal('board').reason).toBe('Active · 900d left');
    g.world.tick += 901;
    expect(g.story.takeDeal('board').reason).toBe('Cooldown 179d');
    // Foundry Contract: cheaper reactors, Trace +2, Board −3.
    st.favor.basalt = 30;
    expect(g.story.takeDeal('basalt').ok).toBe(true);
    expect(g.world.mods.costMul.reactor).toBeCloseTo(0.8, 6);
    expect(st.trace).toBe(2);
    expect(st.favor.board).toBe(22);
  });

  it('a pact is the gang deal: Friendly, renewable, no cooldown; the String Pact eases traffic', () => {
    const g = midGame();
    const st = g.world.story;
    expect(g.story.signPact('kites').reason).toBe('Locked: reach 6,000 residents');
    st.unlocks.push('pact');
    expect(g.story.signPact('kites').reason).toBe('Needs Kites Friendly');
    st.favor.kites = 25;
    expect(g.story.signPact('kites').ok).toBe(true);
    expect(turf.pactActive(g.world, 'kites')).toBe(true);
    expect(st.gangActions).toBe(1);
    expect(g.world.mods.trafficMul).toBeCloseTo(0.92, 6);
    expect(g.world.mods.traceMonthly).toBe(1);
    expect(g.story.takeDeal('kites').ok).toBe(true); // the deal button is the pact; renewing is allowed
    expect(st.pacts.length).toBe(1);
    // Off-ledger: your 40% cut of the street take.
    st.favor.undertow = 25;
    expect(g.story.signPact('undertow').ok).toBe(true);
    for (let x = 10; x < 20; x++) {
      g.world.setZone(x, 10, ZoneType.Residential);
      g.world.setLevel(x, 10, 2);
      g.world.turf.owner[g.world.idx(x, 10)] = 1;
      g.world.turf.str[g.world.idx(x, 10)] = 100;
    }
    g.story.markDirty();
    expect(g.world.ledger.income).toContainEqual({ label: 'Off-ledger', amount: 16 });
  });

  it('salt: cost by population only, favor +8, Trace +3, 90 d cooldown; never the Tuning', () => {
    const g = midGame();
    const st = g.world.story;
    const toasts: string[] = [];
    g.world.events.on('toast', (t) => toasts.push(t.text));
    g.world.funds = 0;
    expect(g.story.saltCost()).toBe(1000); // round100(600 + 0.08 × 5,000)
    g.world.funds = 250000;
    expect(g.story.saltCost()).toBe(1000); // a rich treasury doesn't raise the price: money is the reward
    g.world.funds = -9000;
    expect(g.story.saltCost()).toBe(1000); // debt doesn't make it cheaper
    g.world.funds = 20000;
    expect(g.story.sendSalt('nacre')).toEqual({ ok: true, cost: 1000 });
    expect(st.favor.nacre).toBe(8);
    expect(st.trace).toBe(3);
    expect(toasts).toContain('Salt sent. Nacre remembers.');
    expect(g.story.sendSalt('nacre').reason).toBe('Cooldown 90d');
    expect(g.story.sendSalt('tuning').reason).toBe("The Tuning won't take salt.");
    expect(g.story.view().factions.find((f) => f.id === 'basalt')!.salt).toMatchObject({ label: 'Send salt', cost: 1000, enabled: true });
    g.world.funds = 500;
    expect(g.story.sendSalt('basalt').reason).toBe('Not enough credits (need 1,000)');
    st.ending = 'ledger';
    g.world.funds = 1e6;
    expect(g.story.sendSalt('basalt').reason).toBe('The Ledger is open: no more salt');
  });
});

// ── Signals, reactions, Trace, ambience, ledger, view, visual ───────────────

describe('director systems', () => {
  it('build reactions count the first 5 of a type; the first memorial adds approval +3 for good', () => {
    const g = headlessGame(80);
    const w = g.world;
    w.funds = 1e7;
    w.maxPopulation = 1e6;
    w.story.unlocks.push('memorial');
    for (let k = 0; k < 7; k++) applyAction(w, 'precinct', { x: 4 + k * 4, y: 4 }, { x: 4 + k * 4, y: 4 });
    g.story.onDay();
    expect(w.story.favor.board).toBe(10 + 5 * 2);
    expect(w.story.favor.undertow).toBe(-10 - 5 * 2);
    applyAction(w, 'memorial', { x: 40, y: 40 }, { x: 40, y: 40 });
    applyAction(w, 'memorial', { x: 44, y: 40 }, { x: 44, y: 40 });
    g.story.onDay();
    expect(w.story.favor.tuning).toBe(5);
    expect(w.mods.approvalAdd).toBe(3);
  });

  it('signals: milestones, Fab bulldozing, corp grants, gang surges', () => {
    const g = headlessGame(81);
    const w = g.world;
    w.tick = 1; // not a month rollover
    w.pushSignal({ t: 'milestone', pop: 500 });
    w.pushSignal({ t: 'bulldozed', fabTiles: 12 });
    w.pushSignal({ t: 'bulldozed', fabTiles: 3 });
    w.story.favor.nacre = 5;
    w.pushSignal({ t: 'corpGrant', amount: 3000 });
    w.turf.owner[w.idx(20, 20)] = 2;
    w.turf.str[w.idx(20, 20)] = 40;
    w.pushSignal({ t: 'gangSurge', x: 20, y: 20, gang: 'kites' });
    g.story.onDay();
    expect(w.story.favor.board).toBe(13);
    expect(w.story.favor.basalt).toBe(-3);
    expect(w.story.favor.nacre).toBe(7);
    expect(w.turf.str[w.idx(20, 20)]).toBe(70);
    expect(w.signals.length).toBe(0);
  });

  it('Trace: −1 in a quiet month, + traceMonthly; 40 wakes the Tuning (tu.hymn +15 d); 100 reveals', () => {
    const g = headlessGame(82);
    const w = g.world;
    const st = w.story;
    st.unlocks.push('factions', 'comms');
    st.chapter = 3;
    st.phase = 'waiting';
    st.waitingSince = 0;
    st.trace = 10;
    w.tick = 29;
    days(g, 1);
    expect(st.trace).toBe(9);
    st.trace = 40;
    days(g, 1);
    expect(st.flags.tuningActive).toBe(true);
    expect(st.queue).toContainEqual({ card: 'tu.hymn', tick: w.tick + 15 });
    expect(g.story.view().factions.find((f) => f.id === 'tuning')!.shown).toBe('yes');
    st.queue.length = 0;
    st.trace = 100;
    g.story.update(130, false);
    w.tick = 89;
    days(g, 1);
    expect(openId(g)).toBe('sys.revealed');
    expect(st.revealed).toBe(true); // onShow
    expect(g.story.view().trace).toMatchObject({ value: 100, revealed: true });
  });

  it('whispers every 60 d and MOTH notes every 45 d go to the ticker (and whispers to COMMS)', () => {
    const g = headlessGame(83);
    const w = g.world;
    const st = w.story;
    st.unlocks.push('factions', 'comms');
    st.chapter = 2;
    st.phase = 'waiting';
    st.waitingSince = 0;
    st.favor.kites = 40;
    days(g, 60);
    expect(st.log.find((e) => e.card.startsWith('wh:'))?.card).toBe('wh:kites:warm');
    const row = g.story.view().comms.find((c) => c.card === 'wh:kites:warm')!;
    expect(row.whisper).toBe("lark: 'flew the big kite over the glare tonight. you blinked. i saw.'");
    expect(w.news.some((n) => n.text.startsWith('> '))).toBe(true);
    // A queued whisper callback arrives on its day, without gates.
    st.queue.push({ card: 'wh.fenFree', tick: w.tick + 2 });
    days(g, 2);
    expect(st.log.at(-1)?.card).toBe('wh.fenFree');
    expect(w.news.at(-1)?.text).toContain('fen');
  });

  it('Hostile pulses: Basalt takes a plant down every 90 d while Hostile', () => {
    const g = headlessGame(84);
    const w = g.world;
    const plant = w.addBuilding('solar', 10, 10)!;
    w.story.favor.basalt = -95;
    w.tick = 29;
    days(g, 1); // enters Hostile: the pulse clock starts
    expect(plant.offline).toBe(0);
    for (let k = 0; k < 90; k++) days(g, 1);
    expect(plant.offline).toBeGreaterThan(0);
    expect(standing(w, 'basalt')).toBeLessThanOrEqual(-60);
  });

  it('the view fills tokens, lists six factions (the Tuning hidden), twelve logs and COMMS rows', () => {
    const g = headlessGame(85);
    const st = g.world.story;
    st.chapter = 1;
    st.phase = 'active';
    g.story.update(11, false);
    expect(openId(g)).toBe('ch1.boot');
    g.choose(0);
    const v = g.story.view();
    expect(v.factions.map((f) => f.id)).toEqual(['board', 'basalt', 'nacre', 'undertow', 'kites', 'tuning']);
    expect(v.factions[5]).toMatchObject({ shown: 'no', name: '???', power: null });
    expect(v.factions[1]).toMatchObject({ name: 'Basalt Consolidated', leader: 'Oren Sallow', callsYou: 'Operations', tier: 'neutral' });
    expect(v.factions[1].deal).toMatchObject({ label: 'Foundry Contract', enabled: false });
    expect(v.factions[0].exclusive).toMatchObject({ type: 'commons', buildable: false, reason: 'Locked: Board Friendly' });
    expect(v.logs.map((l) => l.source)).toEqual([
      'Chapter I',
      'Chapter II',
      'Chapter III',
      'Chapter IV',
      'Chapter V',
      'Chapter VI',
      'Board ★',
      'Basalt ★',
      'Nacre ★',
      'Undertow ★',
      'Kites ★',
      'Tuning ★',
    ]);
    expect(v.comms.at(-1)).toMatchObject({ card: 'ch1.boot', title: 'COLD BOOT', choice: 'Listen.', auto: false });
    expect(v.goals.map((x) => x.id)).toEqual(['c1.pop', 'c1.lit', 'c1.plaza']);
    expect(v.goals[1].now).toBe('0/20 days');
    expect(v.chapter).toMatchObject({ n: 1, numeral: 'I', title: 'COLD BOOT', question: '> query: what am I?' });
    // A card view: speaker, hints, locked choice and the ‡ default.
    st.open = { card: 'bd.audit', spot: -1 };
    g.story.markDirty();
    const c = g.story.view().card!;
    expect(c).toMatchObject({ faction: 'board', speakerName: 'Ilse Marrow', canLater: false });
    expect(c.choices[3].locked).toBeDefined();
    expect(c.choices[1].isDefault).toBe(true);
    expect(c.choices[0].hints).toContainEqual({ k: 'cr', v: -800 });
  });

  it('visual state follows Trace, LURE, the mural and crackdowns; presence eases in on MOTH cards', () => {
    const g = headlessGame(86);
    const st = g.world.story;
    st.trace = 50;
    st.flags.lure = 'running';
    st.flags.mural = true;
    st.crackdowns.push({ x: 10, y: 10, r: 13, until: 100, scatterAt: 90, hit: [] });
    days(g, 1);
    const v = g.story.visual;
    expect(v.traceFlicker).toBeCloseTo(0.5, 6);
    expect(v.lureCold).toBe(true);
    expect(v.mural).toBe(true);
    expect(v.crackdowns).toEqual([{ x: 10, y: 10, r: 13 }]);
    st.flags.traceFrozen = true;
    days(g, 1);
    expect(v.traceFlicker).toBe(0);
    st.chapter = 1;
    st.phase = 'active';
    g.story.update(11, false);
    expect(openId(g)).toBe('ch1.boot');
    for (let k = 0; k < 40; k++) g.story.update(0.1, true);
    expect(v.presence).toBeGreaterThan(0.9);
  });

  it('outages (Go to ground): each service building may go dark for 10 d each month', () => {
    const g = headlessGame(87);
    const w = g.world;
    const c = w.addBuilding('clinic', 10, 10)!;
    w.story.mods.push({ id: 'lure', label: 'LURE', until: -1, mods: { outageChance: 1 } });
    w.tick = 29;
    days(g, 1);
    expect(c.offline).toBeGreaterThan(0);
    expect(w.news.some((n) => n.text.includes('Something else is in the wires.'))).toBe(true);
  });
});
