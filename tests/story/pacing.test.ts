// Deck pacing and chapter flow (STORY.md §5.0, §7.1, §8.11, docs/PACING.md):
// the draw gates per story pace (deck gap, quiet window, beat gap, urgent
// system cards), eligibility, weights and the five draw steps; the no-answer
// default in sim days AND the pace's unpaused seconds; boot timing; beats
// (chained, delayed, conditional, the 360-day time-out, gestures) and which
// of them open by themselves or wait as messages; trigger fallbacks; goal
// waivers (after the floor); optional beats; the chapter floor per pace and
// its settle countdown; ⚑ cards in COMMS. Mechanics tests run on the 'brisk'
// pace (the original cadence) unless they test a pace.

import { beforeEach, describe, expect, it } from 'vitest';
import { STORY_PACE, STORY_PACING } from '../../src/game/config';
import type { Game } from '../../src/game/game';
import { Rng } from '../../src/game/rng';
import { storyContent, useStoryContent } from '../../src/game/story/conditions';
import { STORY_CONTENT } from '../../src/game/story/content';
import {
  cardEligible,
  cardWeight,
  cooldownOf,
  deckGate,
  deckGatesOpen,
  defaultChoice,
  drawCard,
  pendingExpired,
} from '../../src/game/story/pacing';
import type { Card } from '../../src/game/story/types';
import type { StoryPace } from '../../src/game/types';
import type { World } from '../../src/game/world';
import { flatWorld } from '../helpers';
import { headlessGame, readWaiting } from './harness';

useStoryContent(STORY_CONTENT);

const P = STORY_PACING;
const BRISK = STORY_PACE.brisk;
const RELAXED = STORY_PACE.relaxed;
const NORMAL = STORY_PACE.normal;
const card = (id: string): Card => storyContent().cards.get(id)!;

// ── Pure pacing ─────────────────────────────────────────────────────────────

describe('deck gates (§7.1, PACING.md)', () => {
  let w: World;
  beforeEach(() => {
    w = flatWorld(5);
    w.tick = 1000;
  });
  const gates = { open: false, pending: false, frontDue: false, sinceCardSec: 400, sinceFrontSec: 1e6, sinceStartSec: 1e6, pace: BRISK };

  it('brisk: nothing open or pending, 120 s since the last card, no beat open, due or recent', () => {
    expect(deckGatesOpen(w, gates)).toBe(true);
    expect(deckGatesOpen(w, { ...gates, open: true })).toBe(false);
    expect(deckGatesOpen(w, { ...gates, pending: true })).toBe(false);
    expect(deckGatesOpen(w, { ...gates, frontDue: true })).toBe(false);
    expect(deckGatesOpen(w, { ...gates, sinceCardSec: 119 })).toBe(false);
    expect(deckGatesOpen(w, { ...gates, sinceCardSec: 120 })).toBe(true);
    w.story.lastBeatTick = 975;
    expect(deckGatesOpen(w, gates)).toBe(false);
    w.story.lastBeatTick = 970;
    expect(deckGatesOpen(w, gates)).toBe(true);
  });

  it("each pace's deck gap, quiet window and card gap; urgent system cards only need 120 s", () => {
    for (const pace of [RELAXED, NORMAL, BRISK]) {
      const g = { ...gates, pace };
      expect(deckGate(w, { ...g, sinceCardSec: P.systemGapSec - 1 })).toBe('none');
      expect(deckGate(w, { ...g, sinceCardSec: pace.minActiveSecBetween - 1 })).toBe(pace.minActiveSecBetween > P.systemGapSec ? 'urgent' : 'none');
      expect(deckGate(w, { ...g, sinceCardSec: pace.minActiveSecBetween })).toBe('all');
      // The quiet build window after a chapter title: no faction cards, urgent ones still come.
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, sinceStartSec: Math.max(0, pace.quietSec - 1) })).toBe(pace.quietSec > 0 ? 'urgent' : 'all');
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, sinceStartSec: pace.quietSec })).toBe('all');
      // Cards stay the pace's beat gap apart from the last card closed.
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, sinceFrontSec: pace.beatGapSec - 1 })).toBe('urgent');
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, sinceFrontSec: pace.beatGapSec })).toBe('all');
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, frontDue: true })).toBe('none');
      // An unread story message (and any story card queued behind it) holds back everything
      // but the urgent cards: a message may wait as long as the player likes.
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, waiting: true })).toBe('urgent');
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, waiting: true, frontDue: true })).toBe('urgent');
      expect(deckGate(w, { ...g, sinceCardSec: P.systemGapSec - 1, waiting: true })).toBe('none');
      expect(deckGate(w, { ...g, sinceCardSec: 1e6, waiting: true, pending: true })).toBe('none');
    }
    expect(RELAXED.minActiveSecBetween).toBeGreaterThanOrEqual(360);
    expect(RELAXED.quietSec).toBeGreaterThanOrEqual(300);
    expect(NORMAL.minActiveSecBetween).toBeGreaterThanOrEqual(210);
    expect(NORMAL.quietSec).toBeGreaterThanOrEqual(180);
    expect(BRISK.minActiveSecBetween).toBe(120);
  });

  it('an urgent gate draws only the bailout or the Clip', () => {
    w.funds = -6000;
    w.story.flags.tuningActive = true;
    w.story.logs = Array.from({ length: 12 }, (_, k) => k + 1);
    w.story.chapter = 7; // coda.recall (a non-urgent system card) is eligible too
    const rng = new Rng(4);
    expect(drawCard(w, rng, true, 1, true).pick?.card.id).toBe('sys.bailout');
    w.funds = 0;
    expect(drawCard(w, rng, true, 1, true).pick).toBeNull();
    expect(drawCard(w, rng, true, 1, false).pick?.card.id).toBe('coda.recall');
  });
});

describe('eligibility and weight', () => {
  let w: World;
  beforeEach(() => {
    w = flatWorld(6);
    w.tick = 2000;
  });

  it('when, once and cooldowns (default 360, ★ retry 240)', () => {
    const census = card('nc.census'); // when pop >= 30,000, once
    expect(cardEligible(w, census)).toBe(false);
    w.stats.population = 30000;
    expect(cardEligible(w, census)).toBe(true);
    w.story.seen['nc.census'] = 10;
    expect(cardEligible(w, census)).toBe(false); // once
    expect(cardEligible(w, census, true)).toBe(true); // a queued follow-up skips once / cooldown
    const feeds = card('nc.feeds'); // approval <= 55 & chapter >= 2, cd 360
    w.stats.approval = 50;
    w.story.chapter = 2;
    expect(cardEligible(w, feeds)).toBe(true);
    w.story.seen['nc.feeds'] = 2000 - 359;
    expect(cardEligible(w, feeds)).toBe(false);
    w.story.seen['nc.feeds'] = 2000 - 360;
    expect(cardEligible(w, feeds)).toBe(true);
    expect(cooldownOf(feeds)).toBe(P.defaultCooldown);
    expect(cooldownOf(card('bd.archive'))).toBe(P.starRetryDays);
    expect(cooldownOf(card('sys.bailout'))).toBe(P.bailoutCooldown);
  });

  it('★ cards stay eligible until their Log is owned', () => {
    const archive = card('bd.archive'); // when standing.board >= 30, star 7
    w.story.favor.board = 30;
    expect(cardEligible(w, archive)).toBe(true);
    w.story.seen['bd.archive'] = 2000 - 200; // declined: waits 240 d
    expect(cardEligible(w, archive)).toBe(false);
    w.story.seen['bd.archive'] = 2000 - 240;
    expect(cardEligible(w, archive)).toBe(true);
    w.story.logs.push(7);
    expect(cardEligible(w, archive)).toBe(false);
  });

  it('hidden and retired factions draw nothing; a card whose spot is missing is ineligible', () => {
    w.story.flags.tuningActive = false;
    const lamps = card('tu.lamps');
    expect(cardEligible(w, lamps)).toBe(false);
    w.story.flags.tuningActive = true;
    w.stats.developed = { res: 1, com: 0, ind: 0 };
    expect(cardEligible(w, lamps)).toBe(true);
    w.story.favor.board = 40;
    w.story.ending = 'ironwork'; // Board retired
    expect(cardEligible(w, card('bd.archive'))).toBe(false);
    const shift = card('ba.shift'); // dev.ind >= 40, spot industrial
    w.stats.developed = { res: 0, com: 0, ind: 40 };
    expect(cardEligible(w, shift)).toBe(true);
    w.stats.developed = { res: 0, com: 0, ind: 0 };
    expect(cardEligible(w, shift)).toBe(false);
  });

  it('weight = w × (1 + |standing|/50) × 0.5 if the same faction spoke last × 1.5 for ★', () => {
    w.story.favor.kites = -50;
    expect(cardWeight(w, card('kt.relay'))).toBeCloseTo(10 * 2, 6);
    w.story.lastSpeaker = 'kites';
    expect(cardWeight(w, card('kt.relay'))).toBeCloseTo(10, 6);
    w.story.lastSpeaker = null;
    w.story.favor.kites = 0;
    expect(cardWeight(w, card('kt.heartbeat'))).toBeCloseTo(15, 6);
    w.story.favor.basalt = 25;
    w.story.favor.nacre = -50; // two-faction card: the larger |standing|
    expect(cardWeight(w, card('x.rooftop'))).toBeCloseTo(10 * 2, 6);
    expect(cardWeight(w, card('sys.bailout'))).toBe(0);
  });
});

describe('the five draw steps', () => {
  let w: World;
  let rng: Rng;
  beforeEach(() => {
    w = flatWorld(7);
    w.tick = 3000;
    rng = new Rng(3);
  });

  it('before COMMS only system cards come (the bailout)', () => {
    w.funds = -6000;
    w.story.queue.push({ card: 'nc.fake', tick: 0 });
    expect(drawCard(w, rng, false, 1).pick?.card.id).toBe('sys.bailout');
    w.funds = 0;
    expect(drawCard(w, rng, false, 1).pick).toBeNull();
  });

  it('1. a due queued follow-up beats everything; ineligible due entries are dropped', () => {
    w.funds = -6000;
    w.story.flags.larkKnows = true; // kt.probe needs !larkKnows
    w.story.queue.push({ card: 'kt.probe', tick: 100 }, { card: 'nc.fake', tick: 3000 }, { card: 'tu.hymn', tick: 4000 });
    const r = drawCard(w, rng, true, 1);
    expect(r.pick).toMatchObject({ step: 'queue', queueIndex: 1 });
    expect(r.pick!.card.id).toBe('nc.fake');
    expect(r.drop).toEqual([0]);
  });

  it('2. system cards before ⚑; 3. ⚑ every 360 d per faction and 60 d city-wide', () => {
    w.funds = -6000;
    w.story.favor.kites = -80;
    expect(drawCard(w, rng, true, 1).pick!.card.id).toBe('sys.bailout');
    w.funds = 0;
    expect(drawCard(w, rng, true, 1).pick).toMatchObject({ step: 'hostile' });
    expect(drawCard(w, rng, true, 1).pick!.card.id).toBe('kt.string');
    w.story.lastHostileBy.kites = 3000 - (P.hostileEvery - 1);
    expect(drawCard(w, rng, true, 0).pick).toBeNull();
    w.story.lastHostileBy.kites = 3000 - P.hostileEvery;
    w.story.lastHostileTick = 3000 - 59;
    expect(drawCard(w, rng, true, 0).pick).toBeNull();
    w.story.lastHostileTick = 3000 - 60;
    expect(drawCard(w, rng, true, 0).pick!.card.id).toBe('kt.string');
    // The most hostile faction goes first.
    w.story.favor.basalt = -95;
    expect(drawCard(w, rng, true, 0).pick!.card.id).toBe('ba.embargo');
  });

  it('3. a ⚑ never takes two deck slots running: a faction that stays Hostile leaves room for the deck', () => {
    w.stats.population = 30000; // nc.census eligible for the random draw
    w.story.favor.kites = -80;
    w.story.favor.basalt = -95;
    // The last deck delivery was Basalt's ⚑, long ago: both ⚑ are due again, but the slot goes to the deck.
    w.story.lastHostileBy.basalt = 3000 - 2 * P.hostileEvery;
    w.story.lastHostileTick = w.story.lastCardTick = 3000 - 2 * P.hostileEvery;
    expect(drawCard(w, rng, true, 0).pick).toBeNull(); // the chance roll failed: nothing, not a ⚑
    expect(drawCard(w, rng, true, 100).pick).toMatchObject({ step: 'random' });
    // A faction card came in between: the ⚑ wins the next slot again.
    w.story.lastCardTick = 3000 - P.hostileEvery;
    expect(drawCard(w, rng, true, 0).pick).toMatchObject({ step: 'hostile' });
    expect(drawCard(w, rng, true, 0).pick!.card.id).toBe('ba.embargo');
  });

  it('4. a seasonal card never takes a slot it took in the last 3 deck cards (slow paces open slots in the same month)', () => {
    w.tick = 30 * 10 + 360 * 8; // a November
    w.stats.population = 30000;
    w.story.chapter = 3;
    w.story.lastCardTick = w.tick - 720;
    w.story.seen['bd.ballot'] = w.tick - 720;
    w.story.log.push({ tick: w.tick - 720, card: 'bd.ballot', choice: 0 });
    expect(drawCard(w, rng, true, 0).pick).toBeNull(); // the chance roll failed and the seasonal step passed
    w.story.log.push({ tick: w.tick - 400, card: 'nc.feeds', choice: 0 }, { tick: w.tick - 300, card: 'ba.shift', choice: 0 }, { tick: w.tick - 200, card: 'ut.salt', choice: 0 });
    expect(drawCard(w, rng, true, 0).pick).toMatchObject({ step: 'seasonal' });
  });

  it('4. a seasonal card skips the chance roll but not the 60-day gap; 300 d between showings', () => {
    w.tick = 30 * 10 + 360 * 8; // a November
    w.stats.population = 30000;
    w.story.chapter = 3;
    w.story.lastCardTick = w.tick - 59;
    expect(drawCard(w, rng, true, 0).pick).toBeNull();
    w.story.lastCardTick = w.tick - 60;
    expect(drawCard(w, rng, true, 0).pick).toMatchObject({ step: 'seasonal' });
    w.story.seen['bd.ballot'] = w.tick - 299;
    expect(drawCard(w, rng, true, 0).pick).toBeNull();
  });

  it('5. a weighted random draw at 0.35 × cardRateMul, only 60 d after the last card', () => {
    w.stats.population = 30000; // nc.census eligible
    expect(drawCard(w, rng, true, 0).pick).toBeNull(); // rate 0: never
    const r = drawCard(w, rng, true, 100);
    expect(r.pick).toMatchObject({ step: 'random' });
    w.story.lastCardTick = w.tick - 10;
    expect(drawCard(w, rng, true, 100).pick).toBeNull();
    // Deterministic for a seed.
    w.story.lastCardTick = -1e5;
    const a = drawCard(w, new Rng(9), true, 100).pick!.card.id;
    expect(drawCard(w, new Rng(9), true, 100).pick!.card.id).toBe(a);
  });

  it("no-answer default needs 20 sim days AND the pace's unpaused seconds; ‡ picks the default", () => {
    w.tick = 100;
    expect(pendingExpired(w, 80, 59, BRISK)).toBe(false);
    expect(pendingExpired(w, 81, 600, BRISK)).toBe(false);
    expect(pendingExpired(w, 80, 60, BRISK)).toBe(true);
    // Relaxed: several minutes, so a player busy building is never rushed.
    expect(RELAXED.pendingMinSec).toBeGreaterThanOrEqual(180);
    expect(pendingExpired(w, 80, RELAXED.pendingMinSec - 1, RELAXED)).toBe(false);
    expect(pendingExpired(w, 80, RELAXED.pendingMinSec, RELAXED)).toBe(true);
    expect(defaultChoice(w, card('bd.audit'))).toBe(1);
    expect(defaultChoice(w, card('ch1.boot'))).toBe(0);
  });
});

// ── Director flow (headless Game) ───────────────────────────────────────────

/** n sim days, each after `sec` real seconds. */
function days(g: Game, n: number, sec = 0) {
  for (let k = 0; k < n; k++) {
    if (sec) g.story.update(sec, false);
    g.sim.step();
    g.story.onDay();
  }
}
const openId = (g: Game) => g.world.story.open?.card ?? null;

describe('chapter I boot (§5 Ch1)', () => {
  it('opens 8 real seconds after the first road', () => {
    const g = headlessGame(11);
    const chapters: number[] = [];
    g.world.events.on('chapter', (c) => chapters.push(c.n));
    g.story.update(30, true); // nothing before any road
    expect(chapters).toEqual([]);
    g.setTool('road');
    expect(g.apply({ x: 20, y: 20 }, { x: 30, y: 20 }).valid).toBe(true);
    g.story.update(0.1, false);
    g.story.update(4.8, false);
    expect(chapters).toEqual([]);
    g.story.update(0.2, false); // 5 s: the chapter title card
    expect(chapters).toEqual([1]);
    expect(g.story.view().titleCard?.numeral).toBe('I');
    g.story.update(2.8, false);
    expect(openId(g)).toBeNull();
    g.story.update(0.3, false); // ~8 s: the boot beat
    expect(openId(g)).toBe('ch1.boot');
    expect(g.story.blocking).toBe(true);
    expect(g.story.view().card?.sys).toBe('> power 0.4% · coherence 4% · id: M.O.T.H.');
  });

  it('while the story UI still shows the chapter title, the boot waits for it (one modal at a time), at most 20 s', () => {
    for (const release of [true, false]) {
      const g = headlessGame(11);
      g.world.events.on('chapter', () => g.story.holdTitle(true)); // as the story UI does when it shows the title
      g.setTool('road');
      expect(g.apply({ x: 20, y: 20 }, { x: 30, y: 20 }).valid).toBe(true);
      g.story.update(0.1, false);
      g.story.update(5, false); // the title card
      expect(g.world.story.phase).toBe('active');
      g.story.update(12, false); // a summary takes a while to read: still no card under it
      expect(openId(g)).toBeNull();
      if (release) {
        g.story.holdTitle(false); // tapped, or its timer ran out
        g.story.update(0.1, false);
        expect(openId(g)).toBe('ch1.boot');
      } else {
        g.story.update(7.5, false); // a title the UI never released can't hold the story past 20 s
        expect(openId(g)).toBeNull();
        g.story.update(0.6, false);
        expect(openId(g)).toBe('ch1.boot');
      }
    }
  });

  it('a city loaded with roads (saved before boot) boots 20 s after load', () => {
    const g = headlessGame(12);
    g.setTool('road');
    g.apply({ x: 20, y: 20 }, { x: 30, y: 20 });
    g.world.signals.length = 0;
    expect(g.restore(JSON.parse(JSON.stringify(g.world.serialize())))).toBe(true);
    g.story.update(16.5, false);
    expect(g.world.story.phase).toBe('waiting');
    g.story.update(0.6, false);
    expect(g.world.story.phase).toBe('active');
    g.story.update(3.1, false);
    expect(openId(g)).toBe('ch1.boot');
  });

  it('Game pauses while a card blocks and restores the speed after the choice', () => {
    const g = headlessGame(13);
    g.setTool('road');
    g.apply({ x: 20, y: 20 }, { x: 30, y: 20 });
    g.setSpeed(2);
    for (let k = 0; k < 60 && !g.story.blocking; k++) g.update(0.2);
    expect(openId(g)).toBe('ch1.boot');
    expect(g.speed).toBe(0);
    g.choose(0);
    g.update(0.1);
    expect(g.speed).toBe(2);
    expect(g.world.story.log.at(-1)).toMatchObject({ card: 'ch1.boot', choice: 0 });
  });
});

/** A game sitting in `chapter`, active since tick `since`, with the given beats shown (brisk unless told). */
function inChapter(n: number, beats: string[], since = 0, pace: StoryPace = 'brisk'): Game {
  const g = headlessGame(20 + n, false, pace);
  const st = g.world.story;
  st.chapter = n;
  st.phase = 'active';
  st.chapterTick = since;
  st.beatsShown = [...beats];
  for (const b of beats) st.seen[b] = since;
  return g;
}

describe('beats (§5.0)', () => {
  it('brisk: a story message waits for a tap; chained beats follow it in place; key choices open by themselves', () => {
    const g = inChapter(2, []);
    const st = g.world.story;
    const incoming: string[] = [];
    g.world.events.on('incoming', (e) => incoming.push(e.id));
    g.story.update(5, false);
    expect(openId(g)).toBeNull(); // the trigger beat is not a key choice: it waits as a message
    expect(st.waiting?.card).toBe('ch2.sallow');
    expect(incoming).toEqual(['ch2.sallow']);
    expect(g.story.blocking).toBe(false); // the game keeps running
    expect(g.story.view().messages).toMatchObject([{ id: 'ch2.sallow', slot: 'story', required: true }]);
    expect(st.beatsShown).toEqual([]); // not shown until read
    expect(readWaiting(g)).toBe(true);
    expect(st.beatsShown).toEqual(['ch2.sallow']);
    expect(g.story.view().card).toMatchObject({ id: 'ch2.sallow', canLater: true, fromMessage: true });
    g.choose(0);
    expect(st.waiting).toBeNull();
    expect(openId(g)).toBe('ch2.oduya'); // chained (brisk chains 2), opens in place
    g.choose(0);
    expect(openId(g)).toBeNull();
    days(g, 29, 1);
    expect(openId(g)).toBeNull();
    days(g, 1);
    g.story.update(0.1, false);
    expect(openId(g)).toBe('ch2.vote'); // a key choice: 30 d after ch2.oduya it opens by itself
    expect(g.story.blocking).toBe(true);
    expect(g.story.view().card?.canLater).toBe(false);
  });

  it('relaxed: beats never chain; each waits the 90 s gap and one message at a time', () => {
    const g = inChapter(2, [], 0, 'relaxed');
    const st = g.world.story;
    expect(RELAXED.maxChain).toBe(1);
    g.story.update(5, false);
    expect(st.waiting?.card).toBe('ch2.sallow');
    g.story.update(600, false); // unread: nothing else comes, the chapter waits for it
    days(g, 40);
    expect(st.waiting?.card).toBe('ch2.sallow');
    expect(st.beatsShown).toEqual([]);
    readWaiting(g);
    g.choose(0);
    expect(openId(g)).toBeNull(); // no chain on a relaxed pace
    expect(st.waiting).toBeNull();
    g.story.update(RELAXED.beatGapSec - 1, false);
    expect(st.waiting).toBeNull();
    g.story.update(1, false);
    expect(st.waiting?.card).toBe('ch2.oduya'); // the gap since the last close
    // Later sends a story message back to wait; reopening does not show it twice.
    readWaiting(g);
    g.story.later();
    expect(openId(g)).toBeNull();
    expect(st.waiting?.card).toBe('ch2.oduya');
    expect(st.beatsShown.filter((b) => b === 'ch2.oduya')).toHaveLength(1);
    readWaiting(g);
    g.choose(0);
    days(g, 30);
    g.story.update(RELAXED.beatGapSec, false);
    expect(openId(g)).toBe('ch2.vote'); // the key choice still opens by itself
  });

  it('a direct reply to a choice follows it at once on any pace', () => {
    const g = inChapter(3, ['ch3.clash'], 0, 'relaxed');
    const st = g.world.story;
    g.story.update(RELAXED.beatGapSec, false);
    expect(openId(g)).toBe('ch3.pier'); // a key choice
    const k = g.story.view().card!.choices.findIndex((c) => c.label === 'Let one tide win.');
    g.choose(k); // queues ch3.winner +0d: a reply
    expect(openId(g)).toBe('ch3.winner');
    expect(st.waiting).toBeNull();
  });

  it('a beat waits while a gesture is in progress', () => {
    const g = inChapter(2, []);
    g.preview = { tool: 'road', tiles: [], cost: 0, valid: true };
    g.story.update(30, false);
    expect(g.world.story.waiting).toBeNull();
    g.preview = null;
    g.story.update(0.1, false);
    expect(g.world.story.waiting?.card).toBe('ch2.sallow');
  });

  it('a conditional beat fires once its chapter has run 360 d', () => {
    const g = inChapter(1, ['ch1.boot', 'ch1.minutes']);
    g.world.tick = 358;
    days(g, 1); // tick 359, pop 0: ch1.lark (pop >= 3,000) not due
    g.story.update(11, false);
    expect(openId(g)).toBeNull();
    days(g, 1); // tick 360
    g.story.update(0.1, false);
    expect(openId(g)).toBe('ch1.lark');
  });

  it('an optional beat counts only once queued, and then must show before the chapter ends', () => {
    const g = inChapter(2, ['ch2.sallow', 'ch2.oduya', 'ch2.vote']);
    const st = g.world.story;
    st.goalsDone = ['c2.pop', 'c2.jobs', 'c2.power'];
    st.queue.push({ card: 'ch2.tiebreak', tick: g.world.tick + 90 });
    g.story.update(BRISK.chapterMinSec, false);
    days(g, 30);
    expect(st.chapter).toBe(2);
    days(g, 60, 0.5);
    g.story.update(11, false);
    expect(st.waiting?.card).toBe('ch2.tiebreak');
    days(g, 5);
    expect(st.chapter).toBe(2); // unread, it still holds the chapter
    readWaiting(g);
    expect(openId(g)).toBe('ch2.tiebreak');
    g.choose(0); // the last owed beat closes: the chapter completes and its reward card follows (a reply)
    expect(st.chapter).toBe(3);
    expect(st.phase).toBe('waiting');
    expect(st.logs).toContain(2);
    expect(openId(g)).toBe('reward.2');
    expect(g.story.view().card?.sys).toBe('> +5,000 CR · new: stratablock, deals');
    expect(st.unlocks).toEqual(expect.arrayContaining(['stack', 'deals']));
  });

  it('brisk: at most one chapter completes per 600 unpaused seconds; the view counts the settle down', () => {
    const F = BRISK.chapterMinSec;
    expect(F).toBe(600);
    const g = inChapter(3, ['ch3.clash', 'ch3.pier']);
    const st = g.world.story;
    st.goalsDone = ['c3.crime', 'c3.pop', 'c3.gang'];
    g.story.update(F - 1, false);
    days(g, 1);
    expect(st.chapter).toBe(3); // every goal and beat done: only the floor holds it
    expect(g.story.view().chapter.closesInSec).toBe(1);
    g.story.update(5, true); // paused seconds don't count
    days(g, 1);
    expect(st.chapter).toBe(3);
    g.story.update(1, false);
    days(g, 1);
    expect(st.chapter).toBe(4);
    expect(st.chapterSec).toBe(0);
    expect(g.story.view().chapter.closesInSec).toBeUndefined();
    g.story.update(11, false);
    expect(st.waiting?.card).toBe('reward.3'); // completed on a day, not by a choice: a message
    readWaiting(g);
    expect(openId(g)).toBe('reward.3');
    g.choose(0);
    // Ch4 starts and is completed at once on paper; it must still wait out the floor.
    st.chapter = 4;
    st.phase = 'active';
    st.beatsShown = ['ch4.drain', 'ch4.logs', 'ch4.brine'];
    st.goalsDone = ['c4.pop', 'c4.core', 'c4.link'];
    g.story.update(300, false);
    days(g, 1);
    expect(st.chapter).toBe(4);
    expect(g.story.view().chapter.closesInSec).toBe(F - 311);
    g.story.update(F - 311, false);
    days(g, 1);
    expect(st.chapter).toBe(5);
  });

  it('each pace has its own chapter floor, and changing the pace applies at once', () => {
    expect(RELAXED.chapterMinSec).toBeGreaterThanOrEqual(1200);
    expect(NORMAL.chapterMinSec).toBeGreaterThanOrEqual(720);
    const g = inChapter(3, ['ch3.clash', 'ch3.pier'], 0, 'relaxed');
    const st = g.world.story;
    st.goalsDone = ['c3.crime', 'c3.pop', 'c3.gang'];
    g.story.update(700, false);
    days(g, 1);
    expect(st.chapter).toBe(3);
    expect(g.story.view().chapter.closesInSec).toBe(RELAXED.chapterMinSec - 700);
    g.updateSettings({ storyPace: 'brisk' }); // 700 s ≥ brisk's 600: it closes on the next day
    expect(g.story.view().pace).toBe('brisk');
    expect(g.story.view().chapter.closesInSec).toBeUndefined();
    days(g, 1);
    expect(st.chapter).toBe(4);
  });

  it('the chapter floor is saved: a reload neither resets nor skips it', () => {
    const g = inChapter(3, ['ch3.clash', 'ch3.pier']);
    const st = g.world.story;
    st.goalsDone = ['c3.crime', 'c3.pop', 'c3.gang'];
    g.story.update(400, false);
    days(g, 1);
    expect(st.chapter).toBe(3);
    const h = headlessGame(1, false, 'brisk');
    expect(h.restore(JSON.parse(JSON.stringify(g.world.serialize())))).toBe(true);
    expect(h.world.story.chapterSec).toBeCloseTo(400, 6);
    h.story.update(150, false);
    days(h, 1);
    expect(h.world.story.chapter).toBe(3);
    h.story.update(50, false);
    days(h, 1);
    expect(h.world.story.chapter).toBe(4);
  });

  it('the settle countdown ticks in real seconds between sim days, and waits for a queued optional beat', () => {
    const g = inChapter(2, ['ch2.sallow', 'ch2.oduya', 'ch2.vote']);
    const st = g.world.story;
    st.chapterSec = 0;
    days(g, 1);
    expect(g.story.view().chapter.closesInSec).toBeUndefined(); // goals not met: nothing to count
    st.goalsDone = ['c2.pop', 'c2.jobs', 'c2.power'];
    days(g, 1);
    const F = BRISK.chapterMinSec;
    const v0 = g.story.view();
    expect(v0.chapter.closesInSec).toBe(F);
    g.story.update(0.4, false); // same whole second: the cached view stays
    expect(g.story.view()).toBe(v0);
    g.story.update(0.7, false); // no sim day passes, the countdown still moves
    expect(g.story.view().chapter.closesInSec).toBe(F - 1);
    g.story.update(30, true); // paused seconds don't count
    expect(g.story.view().chapter.closesInSec).toBe(F - 1);
    g.story.update(65, false);
    expect(g.story.view().chapter.closesInSec).toBe(F - 66);
    // A queued optional beat is still owed: the chapter waits on it, not on the floor.
    st.queue.push({ card: 'ch2.tiebreak', tick: g.world.tick + 90 });
    days(g, 1);
    expect(g.story.view().chapter.closesInSec).toBeUndefined();
    st.queue = st.queue.filter((q) => q.card !== 'ch2.tiebreak');
    days(g, 1);
    expect(g.story.view().chapter.closesInSec).toBe(F - 66);
    expect(st.chapter).toBe(2);
  });

  it('the boot counts as a completion: Ch1 closes no sooner than 600 s after it opens (brisk)', () => {
    const g = headlessGame(19, false, 'brisk');
    const st = g.world.story;
    st.chapterSec = 5000; // time before the boot doesn't count
    g.setTool('road');
    expect(g.apply({ x: 20, y: 20 }, { x: 30, y: 20 }).valid).toBe(true);
    g.story.update(0.1, false);
    g.story.update(P.bootDelaySec, false); // the chapter opens (title card)
    expect(st.chapter).toBe(1);
    expect(st.phase).toBe('active');
    g.story.update(3.1, false);
    expect(openId(g)).toBe('ch1.boot');
    expect(st.chapterSec).toBeCloseTo(3.1, 6);
    g.choose(0);
    st.beatsShown = ['ch1.boot', 'ch1.minutes', 'ch1.lark'];
    st.goalsDone = ['c1.pop', 'c1.lit', 'c1.plaza'];
    g.story.update(BRISK.chapterMinSec - 10, false);
    days(g, 1);
    expect(st.chapter).toBe(1);
    g.story.update(10, false);
    days(g, 1);
    expect(st.chapter).toBe(2);
  });
});

describe('triggers, fallbacks and waivers (§5.0)', () => {
  it('a trigger fires, or its fallback after 720 d, or anyway after 1,440 d', () => {
    const g = headlessGame(31);
    const st = g.world.story;
    st.chapter = 2;
    st.phase = 'waiting';
    st.waitingSince = 0;
    g.world.tick = 718;
    g.world.stats.population = 12000; // fallback gate: pop >= 10,000
    g.story.onDay();
    expect(st.phase).toBe('waiting');
    g.world.tick = 720;
    // The sim republishes stats on step; drive the director directly.
    g.story.onDay();
    expect(st.phase).toBe('active');
    expect(st.chapterTick).toBe(720);

    const h = headlessGame(32);
    const s2 = h.world.story;
    s2.chapter = 4;
    s2.phase = 'waiting';
    s2.waitingSince = 0;
    h.world.tick = 1439;
    h.story.onDay();
    expect(s2.phase).toBe('waiting');
    h.world.tick = 1440; // pop 0 still: the hard fallback
    h.story.onDay();
    expect(s2.phase).toBe('active');
  });

  it('after 720 d (and the floor) one unmet goal per 360 d is waived (counts as done)', () => {
    const g = inChapter(2, ['ch2.sallow', 'ch2.oduya', 'ch2.vote']);
    const st = g.world.story;
    st.chapterSec = BRISK.chapterMinSec; // the real-time floor is met: only the waivers matter here
    const goals: string[] = [];
    g.world.events.on('goal', (e) => goals.push(e.id));
    for (const [tick, n] of [
      [719, 0],
      [720, 1],
      [1079, 1],
      [1080, 2],
    ] as const) {
      g.world.tick = tick;
      g.world.stats.population = 0;
      g.world.stats.powerSupply = 0;
      g.story.onDay();
      expect(st.goalsWaived.length, `tick ${tick}`).toBe(n);
    }
    const v = g.story.view().goals;
    expect(v.map((x) => [x.id, x.done, x.waived])).toEqual([
      ['c2.pop', true, true],
      ['c2.jobs', true, true],
      ['c2.power', false, false],
    ]);
    expect(v[0].now).toBe('waived');
    expect(v[2]).toMatchObject({ now: '0%', need: '≥ 120%' });
    g.world.tick = 1440;
    g.story.onDay();
    expect(goals).toEqual(['c2.pop', 'c2.jobs', 'c2.power']);
    expect(st.chapter).toBe(3); // every goal done or waived: the chapter completes
  });

  it('no goal is waived while the chapter floor still holds; then one per 360 d', () => {
    const g = inChapter(2, ['ch2.sallow', 'ch2.oduya', 'ch2.vote'], 0, 'relaxed');
    const st = g.world.story;
    const at = (tick: number) => {
      g.world.tick = tick;
      g.world.stats.population = 0;
      g.world.stats.powerSupply = 0;
      g.story.onDay();
      return st.goalsWaived.length;
    };
    expect(at(800)).toBe(0); // 720 d in, but the floor (relaxed: 24 min) still holds
    expect(at(1500)).toBe(0);
    g.story.update(RELAXED.chapterMinSec, false);
    expect(at(1600)).toBe(1); // the floor is met: the first waiver, the clock starts here
    expect(at(1959)).toBe(1);
    expect(at(1960)).toBe(2);
    expect(st.waiveFrom).toBe(1600);
  });
});

describe('faction cards: pending, Later, the no-answer default (§7.1)', () => {
  function withPending(pace: StoryPace = 'brisk'): Game {
    const g = headlessGame(41, false, pace);
    const st = g.world.story;
    st.unlocks.push('factions', 'comms');
    st.chapter = 2;
    st.phase = 'waiting';
    st.waitingSince = g.world.tick;
    st.pending = { card: 'bd.audit', tick: g.world.tick, spot: -1 };
    return g;
  }

  it('fires the ‡ default only after 20 sim days AND 60 unpaused seconds', () => {
    const g = withPending();
    const st = g.world.story;
    const toasts: string[] = [];
    g.world.events.on('toast', (t) => toasts.push(t.text));
    days(g, 30, 1); // 30 days, 30 s
    expect(st.pending).not.toBeNull();
    g.story.update(200, true); // paused seconds don't count
    expect(st.pending).not.toBeNull();
    g.story.update(29, false);
    expect(st.pending).not.toBeNull();
    g.story.update(1.1, false);
    expect(st.pending).toBeNull();
    expect(st.log.at(-1)).toMatchObject({ card: 'bd.audit', choice: 1, auto: true });
    expect(toasts).toContain('No answer. Board took that as a yes.');
  });

  it('relaxed: the ‡ default waits several minutes of play, so a busy builder is never forced', () => {
    const g = withPending('relaxed');
    const st = g.world.story;
    days(g, 30, 1);
    g.story.update(RELAXED.pendingMinSec - 31, false);
    expect(st.pending).not.toBeNull();
    expect(g.story.view().pending).toMatchObject({ secLeft: 1, secTotal: RELAXED.pendingMinSec });
    g.story.update(1.1, false);
    expect(st.pending).toBeNull();
  });

  it('Later sends the card back and keeps its timer; time spent reading does not count', () => {
    const g = withPending();
    const st = g.world.story;
    g.story.update(50, false);
    g.story.openPending();
    expect(openId(g)).toBe('bd.audit');
    expect(g.story.view().card).toMatchObject({ canLater: true, autoInDays: 20 });
    days(g, 25);
    g.story.update(100, false); // the card is open: no default
    expect(st.pending).not.toBeNull();
    g.story.later();
    expect(openId(g)).toBeNull();
    g.story.update(9, false);
    expect(st.pending).not.toBeNull();
    g.story.update(1.5, false); // 50 + 10 s waiting, 25 days
    expect(st.pending).toBeNull();
  });

  it('the real-second timer restarts on load', () => {
    const g = withPending();
    days(g, 25);
    g.story.update(59, false);
    expect(g.restore(JSON.parse(JSON.stringify(g.world.serialize())))).toBe(true);
    expect(g.world.story.pending?.card).toBe('bd.audit');
    g.story.update(30, false);
    expect(g.world.story.pending).not.toBeNull();
    g.story.update(31, false);
    expect(g.world.story.pending).toBeNull();
  });

  it('a ⚑ card waits in COMMS like a faction card (no forced pause); the make-good repairs standing', () => {
    const g = headlessGame(42, false, 'brisk');
    const st = g.world.story;
    st.unlocks.push('factions', 'comms');
    st.chapter = 3;
    st.phase = 'waiting';
    st.waitingSince = 0;
    st.favor.kites = -90;
    const incoming: string[] = [];
    g.world.events.on('incoming', (e) => incoming.push(e.id));
    g.story.update(121, false);
    g.world.tick = 29;
    days(g, 1); // month rollover: the draw
    expect(openId(g)).toBeNull();
    expect(g.story.blocking).toBe(false);
    expect(st.pending?.card).toBe('kt.string');
    expect(incoming).toEqual(['kt.string']);
    expect(g.story.view().pending).toMatchObject({ kind: 'hostile', faction: 'kites' });
    expect(g.story.view().banner).toMatchObject({ id: 'kt.string', kind: 'hostile', slot: 'comms' });
    g.story.openPending();
    const v = g.story.view().card!;
    expect(v.canLater).toBe(true);
    const k = v.choices.findIndex((c) => c.label === 'Make it right with Lark.');
    g.choose(k);
    expect(st.favor.kites).toBe(-69); // −90, monthly drift −1 toward 0, then +20
    expect(st.lastHostileBy.kites).toBe(30);
  });

  it('cards arrive no more than once per 120 unpaused seconds', () => {
    const g = headlessGame(43);
    const st = g.world.story;
    st.unlocks.push('factions', 'comms');
    st.chapter = 3;
    st.phase = 'waiting';
    st.waitingSince = 0;
    g.world.funds = -9000; // the bailout is always eligible
    g.story.update(130, false);
    g.world.tick = 29;
    days(g, 1);
    expect(openId(g)).toBe('sys.bailout');
    g.choose(1); // patron credit: +15,000
    g.world.funds = -9000;
    st.seen['sys.bailout'] = -1000; // ignore its own cooldown for this check
    g.world.tick = 59;
    g.story.update(60, false);
    days(g, 1);
    expect(openId(g)).toBeNull(); // 60 s since the last card
    g.world.tick = 89;
    g.story.update(61, false);
    days(g, 1);
    expect(openId(g)).toBe('sys.bailout');
  });

  it('no faction card before COMMS', () => {
    const g = headlessGame(44);
    const st = g.world.story;
    st.chapter = 1;
    st.phase = 'active';
    st.beatsShown = ['ch1.boot', 'ch1.minutes', 'ch1.lark'];
    g.world.stats.population = 30000;
    g.world.maxPopulation = 14000; // below the comms fallback
    g.story.update(500, false);
    for (let m = 1; m <= 24; m++) {
      g.world.tick = m * 30 - 1;
      g.world.stats.population = 30000;
      g.story.update(200, false);
      g.story.onDay();
      g.world.tick++;
      g.story.onDay();
    }
    expect(st.pending).toBeNull();
    expect(st.seen['nc.census']).toBeUndefined();
  });
});
