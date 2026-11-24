// Story pace and clarity (docs/PACING.md): the Settings.storyPace setting
// (default, old stored settings, applied at once), the quiet build window after
// a chapter title, story messages that wait instead of pausing the game, which
// cards may still open by themselves, the clarity view fields (brief, faction
// intro on first meeting, chapter summary, "story so far", messages) and save
// continuity of the new clocks (old v2 saves without them keep loading).

import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_KEY, STORY_PACE, STORY_PACING, paceOf } from '../../src/game/config';
import { DEFAULT_SETTINGS, Game } from '../../src/game/game';
import { storyContent } from '../../src/game/story/conditions';
import { LONG_AGO_SEC } from '../../src/game/story/state';
import type { SaveData } from '../../src/game/types';
import { headlessGame, readWaiting } from './harness';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function days(g: Game, n: number, sec = 0) {
  for (let k = 0; k < n; k++) {
    if (sec) g.story.update(sec, false);
    g.sim.step();
    g.story.onDay();
  }
}

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
  return m;
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

// ── The setting ─────────────────────────────────────────────────────────────

describe('Settings.storyPace', () => {
  it("defaults to 'relaxed'; old stored settings without it (or with junk) read as 'relaxed'", () => {
    expect(DEFAULT_SETTINGS.storyPace).toBe('relaxed');
    memStorage({ [SETTINGS_KEY]: JSON.stringify({ sound: false, music: true, rain: true, dayNight: true, quality: 'low', showFps: false, events: true }) });
    const g = new Game();
    expect(g.settings.storyPace).toBe('relaxed');
    expect(g.settings.sound).toBe(false); // the rest of the old settings are kept
    expect(g.story.view().pace).toBe('relaxed');
    memStorage({ [SETTINGS_KEY]: JSON.stringify({ storyPace: 'warp' }) });
    expect(new Game().settings.storyPace).toBe('relaxed');
    memStorage({ [SETTINGS_KEY]: JSON.stringify({ storyPace: 'brisk' }) });
    expect(new Game().settings.storyPace).toBe('brisk');
    expect(paceOf(undefined)).toBe('relaxed');
    expect(paceOf('normal')).toBe('normal');
  });

  it('is stored, and a change applies at once (view, floors, timers) without touching the sim speed', () => {
    const m = memStorage();
    const g = new Game();
    g.setSpeed(3);
    let changes = 0;
    g.events.on('settings', () => changes++);
    g.updateSettings({ storyPace: 'normal' });
    expect(changes).toBe(1);
    expect(JSON.parse(m.get(SETTINGS_KEY)!).storyPace).toBe('normal');
    expect(g.story.view().pace).toBe('normal');
    expect(g.story.pace).toBe(STORY_PACE.normal);
    expect(g.speed).toBe(3);
    g.updateSettings({ storyPace: 'nonsense' as never });
    expect(g.settings.storyPace).toBe('relaxed');
  });

  it('slower paces hold every story clock longer; brisk is the original cadence', () => {
    const { relaxed: r, normal: n, brisk: b } = STORY_PACE;
    for (const k of ['chapterMinSec', 'quietSec', 'minActiveSecBetween', 'beatGapSec', 'pendingMinSec'] as const) {
      expect(r[k]).toBeGreaterThanOrEqual(n[k]);
      expect(n[k]).toBeGreaterThanOrEqual(b[k]);
    }
    expect(b).toMatchObject({ chapterMinSec: 600, minActiveSecBetween: 120, beatGapSec: 10, pendingMinSec: 60, quietSec: 0 });
    expect(b.maxChain).toBe(2);
    expect(r.maxChain).toBe(1);
    expect(n.maxChain).toBe(1);
  });
});

// ── The quiet window and the deck ───────────────────────────────────────────

/** Chapter 3 just started (through the real trigger), COMMS open, a faction card eligible. */
function freshChapter3(pace: 'relaxed' | 'normal'): Game {
  const g = headlessGame(51, false, pace);
  const st = g.world.story;
  st.unlocks.push('factions', 'comms');
  st.chapter = 3;
  st.phase = 'waiting';
  st.waitingSince = -2000; // the hard fallback: Ch3 starts on the next day
  st.deckSec = 1e5;
  st.frontSec = 1e5;
  g.world.funds = 1e6;
  return g;
}

describe('the quiet build window after a chapter title', () => {
  for (const pace of ['relaxed', 'normal'] as const) {
    it(`${pace}: no faction card for ${STORY_PACE[pace].quietSec} s after the title; then the deck draws again`, () => {
      const g = freshChapter3(pace);
      const st = g.world.story;
      const T = STORY_PACE[pace];
      const arrived: { id: string; sec: number }[] = [];
      let titleAt = -1;
      g.world.events.on('chapter', () => (titleAt = st.sinceStartSec === 0 ? g.story.activeSec : titleAt));
      g.world.events.on('incoming', (e) => arrived.push({ id: e.id, sec: g.story.activeSec }));
      days(g, 1);
      expect(st.phase).toBe('active');
      expect(st.sinceStartSec).toBe(0);
      expect(titleAt).toBe(0);
      // Read story messages as they come; keep everything else waiting.
      for (let d = 0; d < 2400 && !arrived.some((a) => st.pending?.card === a.id); d++) {
        g.story.update(0.5, false);
        if (readWaiting(g)) g.choose(0);
        for (let k = 0; k < 5 && g.story.blocking; k++) g.choose(0);
        g.sim.step();
        g.story.onDay();
        for (let k = 0; k < 5 && g.story.blocking; k++) g.choose(0);
      }
      const deck = arrived.filter((a) => st.pending?.card === a.id);
      expect(deck.length).toBe(1);
      expect(deck[0].sec - titleAt).toBeGreaterThanOrEqual(T.quietSec);
    }, 30000);
  }

  it('an urgent system card (the bailout) still comes inside the quiet window', () => {
    const g = freshChapter3('relaxed');
    const st = g.world.story;
    days(g, 1);
    expect(st.sinceStartSec).toBe(0);
    g.world.funds = -9000;
    g.story.update(STORY_PACING.systemGapSec, false);
    expect(st.sinceStartSec).toBeLessThan(STORY_PACE.relaxed.quietSec);
    for (let d = 0; d < 31 && st.open?.card !== 'sys.bailout'; d++) {
      // Keep the chapter's own messages out of the way: this checks the deck alone.
      st.waiting = null;
      st.beatsShown = ['ch3.clash', 'ch3.pier'];
      g.world.funds = -9000;
      days(g, 1);
    }
    expect(st.open?.card).toBe('sys.bailout');
    expect(g.story.blocking).toBe(true); // urgent: it opens by itself and pauses
  });

  it('an unread story message never holds back the bailout (a message may wait for ever)', () => {
    const g = freshChapter3('relaxed');
    const st = g.world.story;
    days(g, 1);
    // Ch3's first beat arrives as a story message; leave it unread.
    for (let d = 0; d < 400 && !st.waiting; d++) {
      g.story.update(0.5, false);
      g.sim.step();
      g.story.onDay();
    }
    const msg = st.waiting?.card;
    expect(msg).toBeTruthy();
    expect(st.waiting?.read).toBeFalsy();
    let opened = -1;
    for (let d = 0; d < 120 && opened < 0; d++) {
      g.world.funds = -9000;
      g.story.update(0.5, false);
      g.sim.step();
      g.story.onDay();
      if (st.open?.card === 'sys.bailout') opened = d;
    }
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(st.waiting?.card).toBe(msg); // still waiting, still unread
    // Answering the bailout leaves the message waiting for the player.
    g.choose(0);
    expect(st.open).toBeNull();
    expect(st.waiting?.card).toBe(msg);
    expect(g.story.view().messages.some((m) => m.id === msg && m.slot === 'story')).toBe(true);
  });
});

// ── Messages instead of interruptions ───────────────────────────────────────

describe('story messages wait; the game keeps running', () => {
  it('a waiting message never pauses the sim; reading it pauses, Later resumes at the same speed', () => {
    const g = headlessGame(52, false, 'relaxed');
    const st = g.world.story;
    st.chapter = 2;
    st.phase = 'active';
    st.chapterTick = g.world.tick;
    g.setSpeed(2);
    for (let k = 0; k < 40 && !st.waiting; k++) g.update(0.25);
    expect(st.waiting?.card).toBe('ch2.sallow');
    const tick = g.world.tick;
    for (let k = 0; k < 20; k++) g.update(0.25);
    expect(g.speed).toBe(2);
    expect(g.world.tick).toBeGreaterThan(tick); // the city keeps growing
    // The goal chip and the drawer list it; the chapter waits for it.
    expect(g.story.view().messages).toEqual([expect.objectContaining({ id: 'ch2.sallow', slot: 'story', required: true, kind: 'beat', from: 'Oren Sallow' })]);
    g.openWaiting();
    g.update(0.1);
    expect(g.speed).toBe(0);
    expect(g.story.view().card?.canLater).toBe(true);
    g.later();
    g.update(0.1);
    expect(g.speed).toBe(2);
    expect(st.waiting?.card).toBe('ch2.sallow');
    g.openWaiting();
    g.choose(0);
    g.update(0.1);
    expect(g.speed).toBe(2);
    expect(st.waiting).toBeNull();
    expect(st.beatsShown).toEqual(['ch2.sallow']);
    expect(st.log.at(-1)).toMatchObject({ card: 'ch2.sallow', choice: 0 });
  });

  it('a waiting reward holds the next chapter until it is read', () => {
    const g = headlessGame(53, false, 'relaxed');
    const st = g.world.story;
    st.chapter = 2;
    st.phase = 'active';
    st.beatsShown = ['ch2.sallow', 'ch2.oduya', 'ch2.vote'];
    st.goalsDone = ['c2.pop', 'c2.jobs', 'c2.power'];
    g.story.update(STORY_PACE.relaxed.chapterMinSec, false);
    g.world.stats.population = 5000;
    days(g, 1);
    expect(st.chapter).toBe(3);
    expect(st.phase).toBe('waiting');
    g.story.update(1, false);
    expect(st.waiting?.card).toBe('reward.2');
    st.waitingSince = g.world.tick - 5000; // Ch3's hard fallback is due
    days(g, 30);
    expect(st.phase).toBe('waiting'); // ...but Ch3 waits for the log to be read
    readWaiting(g);
    g.choose(0);
    days(g, 1);
    expect(st.chapter).toBe(3);
    expect(st.phase).toBe('active');
  });

  it('only the boot, key choices, the count, endings and urgent system cards open by themselves', () => {
    const g = headlessGame(54, false, 'relaxed');
    const st = g.world.story;
    st.chapter = 1;
    st.phase = 'active';
    st.chapterTick = g.world.tick - 400; // the conditional beats' 360-day time-out has passed
    g.story.update(5, false);
    expect(st.open?.card).toBe('ch1.boot'); // the story's first card
    g.choose(0);
    g.story.update(STORY_PACE.relaxed.beatGapSec, false);
    days(g, 1);
    g.story.update(0.1, false);
    expect(st.open).toBeNull();
    expect(st.waiting?.card).toBe('ch1.minutes'); // not a key choice: a message
    readWaiting(g);
    g.choose(0);
    g.story.update(STORY_PACE.relaxed.beatGapSec, false);
    days(g, 1);
    g.story.update(0.1, false);
    expect(st.open?.card).toBe('ch1.lark'); // a key choice opens by itself
  });
});

// ── Clarity view ────────────────────────────────────────────────────────────

describe('clarity: brief, who is this, summary, story so far', () => {
  it("a card's brief is in its view with tokens filled; a faction's first card opens its intro once", () => {
    const g = headlessGame(55, false, 'brisk');
    const idx = storyContent();
    const audit = idx.cards.get('bd.audit')!;
    const board = idx.factions.board!;
    const was = { brief: audit.brief, about: board.about };
    audit.brief = 'The Board wants a screwdriver audit of {city}.';
    board.about = 'The elected council. It writes the permits.';
    try {
      const st = g.world.story;
      st.unlocks.push('factions', 'comms');
      st.pending = { card: 'bd.audit', tick: g.world.tick, spot: -1 };
      g.openPending();
      const v = g.story.view();
      expect(v.card?.brief).toBe('The Board wants a screwdriver audit of Harness Bay.');
      expect(v.card?.firstMeet).toBe(true);
      expect(v.factions.find((f) => f.id === 'board')?.about).toBe('The elected council. It writes the permits.');
      expect(st.met).toEqual(['board']);
      g.later();
      g.openPending();
      expect(g.story.view().card?.firstMeet).toBeUndefined(); // only the first time
      // Saved: a reload does not show the intro again.
      const h = headlessGame(56, false, 'brisk');
      expect(h.restore(clone(g.world.serialize()))).toBe(true);
      expect(h.world.story.met).toEqual(['board']);
    } finally {
      audit.brief = was.brief;
      board.about = was.about;
    }
  });

  it('the chapter summary reaches the title card and the drawer; finished chapters list their recap and key choice', () => {
    const g = headlessGame(57, false, 'brisk');
    const ch1 = storyContent().chapters.get(1)!;
    const ch2 = storyContent().chapters.get(2)!;
    const was = { s1: ch1.summary, r1: ch1.recap, s2: ch2.summary };
    ch1.recap = 'You woke under {city}.';
    ch2.summary = 'Two corporations bid for {city}.';
    try {
      const st = g.world.story;
      st.chapter = 2;
      st.phase = 'waiting';
      st.waitingSince = -2000;
      st.keyChoices['ch1.lark'] = 0;
      g.story.markDirty();
      // Not before its title card: a chapter waiting to start keeps its summary to itself.
      expect(g.story.view().chapter.n).toBe(2);
      expect(g.story.view().chapter.summary).toBeUndefined();
      // The story UI reads the view inside the 'chapter' handler: the title card and summary are there already.
      let atTitle: ReturnType<typeof g.story.view> | null = null;
      g.world.events.on('chapter', () => (atTitle = g.story.view()));
      days(g, 1);
      expect(atTitle!.titleCard?.summary).toBe('Two corporations bid for Harness Bay.');
      expect(atTitle!.chapter.summary).toBe('Two corporations bid for Harness Bay.');
      const v = g.story.view();
      expect(st.phase).toBe('active');
      expect(v.titleCard?.summary).toBe('Two corporations bid for Harness Bay.');
      expect(v.chapter.summary).toBe('Two corporations bid for Harness Bay.');
      expect(v.storySoFar).toHaveLength(1);
      expect(v.storySoFar[0]).toMatchObject({ n: 1, numeral: 'I', recap: 'You woke under Harness Bay.' });
      expect(v.storySoFar[0].choices).toEqual([storyContent().cards.get('ch1.lark')!.choices[0].label]);
    } finally {
      ch1.summary = was.s1;
      ch1.recap = was.r1;
      ch2.summary = was.s2;
    }
  });
});

// ── Save continuity ─────────────────────────────────────────────────────────

describe('save continuity of the pacing clocks', () => {
  it('a v2 save from before the pacing pass (no new fields) loads with safe defaults', () => {
    const g = headlessGame(58, false, 'relaxed');
    const st = g.world.story;
    st.chapter = 3;
    st.phase = 'active';
    st.chapterSec = 300;
    const data = clone(g.world.serialize()) as SaveData;
    const raw = data.story!.story as unknown as Record<string, unknown>;
    for (const k of ['sinceStartSec', 'deckSec', 'frontSec', 'waiting', 'met', 'waiveFrom']) delete raw[k];
    const h = headlessGame(59, false, 'relaxed');
    expect(h.restore(data)).toBe(true);
    const s2 = h.world.story;
    expect(s2.chapterSec).toBe(300);
    expect(s2.sinceStartSec).toBe(LONG_AGO_SEC); // the quiet window is long over
    expect(s2.frontSec).toBe(LONG_AGO_SEC);
    expect(s2.deckSec).toBe(0); // one deck gap after loading, as before
    expect(s2.waiting).toBeNull();
    expect(s2.met).toEqual([]);
    expect(s2.waiveFrom).toBeNull();
    expect(h.story.view().messages).toEqual([]);
  });

  it('a save from before story.met counts each faction already heard from as met (no "new contact" mid-story)', () => {
    const g = headlessGame(62, false, 'relaxed');
    const st = g.world.story;
    st.chapter = 3;
    st.phase = 'active';
    st.seen['bd.audit'] = 10; // answered
    st.log.push({ tick: 10, card: 'bd.audit', choice: 0 });
    st.seen['ba.shift'] = 40; // defaulted unopened long ago: still heard from
    st.seen['nc.feeds'] = 90; // the COMMS card still waiting unread
    st.pending = { card: 'nc.feeds', tick: 90, spot: -1 };
    const data = clone(g.world.serialize()) as SaveData;
    delete (data.story!.story as unknown as Record<string, unknown>).met;
    const h = headlessGame(63, false, 'relaxed');
    expect(h.restore(data)).toBe(true);
    expect(h.world.story.met).toEqual(['board', 'basalt']);
    // Its first card still opens Nacre's intro.
    h.openPending();
    expect(h.story.view().card?.firstMeet).toBe(true);
    expect(h.world.story.met).toEqual(['board', 'basalt', 'nacre']);
  });

  it('a waiting message whose card no longer exists is dropped on load; bad clocks are clamped', () => {
    const g = headlessGame(60, false, 'relaxed');
    const data = clone(g.world.serialize()) as SaveData;
    const raw = data.story!.story as unknown as Record<string, unknown>;
    raw.waiting = { card: 'gone.card', tick: 0, spot: -1 };
    raw.deckSec = -50;
    raw.frontSec = 'soon';
    const h = headlessGame(61);
    expect(h.restore(data)).toBe(true);
    expect(h.world.story.waiting).toBeNull();
    expect(h.world.story.deckSec).toBe(0);
    expect(h.world.story.frontSec).toBe(LONG_AGO_SEC);
  });
});
