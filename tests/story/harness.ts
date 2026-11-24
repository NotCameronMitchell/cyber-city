// Headless story harness for the WP-A tests: a Game on a deterministic map,
// driven day by day with simulated real seconds, a scripted builder and a
// choice policy that answers every card the way a (random) player would.
// Story messages that wait (docs/PACING.md) are opened after `readDelaySec`
// unpaused seconds, like a player finishing what they were doing.

import { Game } from '../../src/game/game';
import { Rng } from '../../src/game/rng';
import { storyContent } from '../../src/game/story/conditions';
import type { StoryDirector } from '../../src/game/story/director';
import type { EndingId } from '../../src/game/story/types';
import { DAYS_PER_MONTH, type StoryPace } from '../../src/game/types';
import { World } from '../../src/game/world';
import { ScriptedMayor, flatWorld } from '../helpers';

export interface RunLog {
  /** Milliseconds spent inside director.update + onDay (story overhead). */
  storyMs: number;
  /** Worst single onDay (ms). */
  worstDayMs: number;
  /** Card ids in the order they opened (beats, ⚑, system, logs, endings, opened faction cards). */
  opened: string[];
  /** Deck cards (faction, ⚑, other system) that arrived as pending, with the tick and whether comms was unlocked then. */
  arrived: { id: string; tick: number; comms: boolean }[];
  /** Story messages (beats, logs, rewards) that arrived waiting, with the unpaused second. */
  messages: { id: string; tick: number; sec: number }[];
  /** Cards that opened by themselves (not from a banner / COMMS / the goal chip). */
  forced: string[];
  /** The same, with when they opened and whether it was right after a card closed (a reply or chain). */
  forcedAt: { id: string; sec: number; afterClose: boolean }[];
  /** Pending defaults that fired, with the unpaused seconds the card had waited. */
  defaults: { id: string; tick: number; waitedSec: number }[];
  chapters: { n: number; tick: number }[];
  endings: EndingId[];
  charterNights: number;
  /** activeSec when each card opened or arrived (reading budget). */
  cardSecs: number[];
  /** Deck deliveries (faction arrivals, ⚑ and system cards) with tick and unpaused seconds. */
  deck: { id: string; kind: string; tick: number; sec: number }[];
  /** Chapter starts with their unpaused second. */
  chapterSecs: { n: number; sec: number }[];
  maxChapter: number;
}

/** An empty run log. */
export function newRunLog(): RunLog {
  return { deck: [], storyMs: 0, worstDayMs: 0, opened: [], arrived: [], messages: [], forced: [], forcedAt: [], defaults: [], chapters: [], chapterSecs: [], endings: [], charterNights: 0, cardSecs: [], maxChapter: 1 };
}

export interface RunOptions {
  seed?: number;
  /** Flat map (default) or generated terrain. */
  terrain?: boolean;
  years: number;
  /** Real seconds per sim day (0.5 = speed 1). */
  secPerDay?: number;
  /** 'greedy' grows like the balance mayor; 'low' stops building early (pop stays small). */
  builder?: 'greedy' | 'low' | 'none';
  /** Pick a choice index for an open card (default: random among unlocked). */
  pick?: (id: string, choices: { locked?: string; hints?: { k: string; f?: string; dir?: number; pips?: number }[] }[], rng: Rng, d: StoryDirector) => number;
  /** Chance the player opens a pending card when it arrives (else it waits for the default). */
  answerPending?: number;
  /** Ending policy on Charter Night (default: random selectable). */
  ending?: (ok: EndingId[], rng: Rng) => EndingId | 'recount';
  /** Called once a day after onDay. Return true to stop early. */
  each?: (g: Game, day: number) => boolean | void;
  /** Story pace (default: the game's default, 'relaxed'). */
  pace?: StoryPace;
  /** Unpaused seconds before the player opens a waiting story message (default 10). */
  readDelaySec?: number;
}

/** A Game whose world is a fresh deterministic map (and, optionally, a story pace). */
export function headlessGame(seed = 2091, terrain = false, pace?: StoryPace): Game {
  const g = new Game();
  if (pace) g.settings.storyPace = pace;
  const w = terrain ? World.generate(seed, 'Harness Bay') : flatWorld(seed, 'Harness Bay');
  if (!g.restore(JSON.parse(JSON.stringify(w.serialize())))) throw new Error('restore failed');
  return g;
}

/** Open the waiting story message, if any (a player tapping the banner or goal chip). */
export function readWaiting(g: Game): boolean {
  const st = g.world.story;
  const id = st.waiting?.card;
  if (!id || st.open) return false;
  g.openWaiting();
  return (st.open as { card: string } | null)?.card === id;
}

/**
 * A choice policy that spites one faction: the unlocked choice whose hints push
 * `f` down the most (ties and cards without `f` go random).
 */
export function spite(f: string) {
  return (_id: string, choices: { locked?: string; hints?: { k: string; f?: string; dir?: number; pips?: number }[] }[], rng: Rng): number => {
    let best = -1;
    let score = Infinity;
    choices.forEach((c, k) => {
      if (c.locked) return;
      let s = 0;
      for (const h of c.hints ?? []) if (h.k === 'favor' && h.f === f) s += (h.dir ?? 0) * (h.pips ?? 0);
      if (s < score || (s === score && rng.next() < 0.5)) {
        score = s;
        best = k;
      }
    });
    return best < 0 ? 0 : best;
  };
}

/** Spite whichever visible faction stands lowest right now (drives one toward Hostile). */
export function spiteLowest() {
  return (id: string, choices: Parameters<ReturnType<typeof spite>>[1], rng: Rng, d: StoryDirector): number => {
    const rows = d.view().factions.filter((f) => f.shown === 'yes');
    rows.sort((a, b) => a.standing - b.standing);
    return spite(rows[0]?.id ?? 'kites')(id, choices, rng);
  };
}

/** Answer every blocking surface (cards, Charter Night). */
export function answerAll(g: Game, rng: Rng, log: RunLog, opts: RunOptions): void {
  const d = g.story;
  for (let guard = 0; guard < 40 && d.blocking; guard++) {
    const st = g.world.story;
    if (st.flags.charterNightOpen && !st.open) {
      log.charterNights++;
      const v = d.view();
      const ok = v.claims.filter((c) => c.ok).map((c) => c.id);
      const choice = opts.ending ? opts.ending(ok, rng) : ok[Math.floor(rng.next() * ok.length)];
      if (choice === 'recount') d.recount();
      else if (!d.chooseEnding(choice).ok) d.chooseEnding('quiet');
      continue;
    }
    const v = d.view().card;
    if (!v) break;
    const choices = v.choices;
    let i: number;
    if (opts.pick) i = opts.pick(v.id, choices, rng, d);
    else {
      const open = choices.map((c, k) => (c.locked ? -1 : k)).filter((k) => k >= 0);
      i = open[Math.floor(rng.next() * open.length)] ?? 0;
    }
    d.choose(i);
  }
}

/** Play `years` sim years headless. */
export function playStory(opts: RunOptions): { game: Game; log: RunLog } {
  const g = headlessGame(opts.seed ?? 2091, opts.terrain, opts.pace);
  const w = g.world;
  const d = g.story;
  const rng = new Rng((opts.seed ?? 2091) ^ 0x51a7);
  const log = newRunLog();
  const delivered = new Set<string>();
  let closedAt = -1;
  let closedTick = -1;
  w.events.on('card', (c) => {
    if (!c) {
      closedAt = g.story.activeSec;
      closedTick = w.tick;
      return;
    }
    if (c) {
      log.opened.push(c.id);
      if (delivered.delete(c.id)) return; // arrived earlier with a banner
      log.forced.push(c.id);
      log.forcedAt.push({ id: c.id, sec: g.story.activeSec, afterClose: closedAt === g.story.activeSec && closedTick === w.tick });
      log.cardSecs.push(g.story.activeSec);
      const kind = storyContent().cards.get(c.id)?.kind ?? '';
      if (kind === 'hostile' || kind === 'system') log.deck.push({ id: c.id, kind, tick: w.tick, sec: g.story.activeSec });
    }
  });
  w.events.on('incoming', (c) => {
    delivered.add(c.id);
    log.cardSecs.push(g.story.activeSec);
    if (w.story.waiting?.card === c.id) {
      log.messages.push({ id: c.id, tick: w.tick, sec: g.story.activeSec });
      return;
    }
    const kind = storyContent().cards.get(c.id)?.kind ?? 'faction';
    log.arrived.push({ id: c.id, tick: w.tick, comms: g.story.view().unlocked.comms });
    log.deck.push({ id: c.id, kind, tick: w.tick, sec: g.story.activeSec });
  });
  w.events.on('chapter', (c) => {
    log.chapters.push({ n: c.n, tick: w.tick });
    log.chapterSecs.push({ n: c.n, sec: g.story.activeSec });
    log.maxChapter = Math.max(log.maxChapter, c.n);
  });
  w.events.on('ending', (e) => log.endings.push(e.id));
  let pendingSince = -1;
  let pendingId = '';
  let answerThis = false;
  w.events.on('pending', (p) => {
    if (p) {
      pendingId = p.id;
      pendingSince = g.story.activeSec;
      answerThis = rng.next() < (opts.answerPending ?? 0);
    }
  });
  w.events.on('toast', (t) => {
    if (t.text.startsWith('No answer.')) log.defaults.push({ id: pendingId, tick: w.tick, waitedSec: g.story.activeSec - pendingSince });
  });

  const builder = opts.builder ?? 'greedy';
  const mayor = builder === 'none' ? null : new ScriptedMayor(w, g.sim);
  mayor?.opening();
  const dt = opts.secPerDay ?? 0.5;
  const days = Math.round(opts.years * 12 * DAYS_PER_MONTH);
  const readDelay = opts.readDelaySec ?? 10;
  let msgSince = -1;
  let msgId = '';
  for (let day = 0; day < days; day++) {
    // Real time passes in frames; the day ticks after it, as in Game.update.
    let t = performance.now();
    d.update(dt, false);
    log.storyMs += performance.now() - t;
    answerAll(g, rng, log, opts);
    // A story message waits: the player finishes what they were doing, then reads it.
    const wt = w.story.waiting;
    if (wt && wt.card !== msgId) {
      msgId = wt.card;
      msgSince = d.activeSec;
    } else if (!wt) msgId = '';
    if (wt && !w.story.open && d.activeSec - msgSince >= readDelay) {
      d.openWaiting();
      answerAll(g, rng, log, opts);
    }
    const pend = w.story.pending;
    if (pend && !w.story.open && answerThis) {
      d.openPending();
      answerAll(g, rng, log, opts);
    }
    g.sim.step();
    t = performance.now();
    d.onDay();
    const dd = performance.now() - t;
    log.storyMs += dd;
    if (dd > log.worstDayMs) log.worstDayMs = dd;
    answerAll(g, rng, log, opts);
    if (mayor && w.tick % DAYS_PER_MONTH === 0) {
      if (builder === 'greedy' || w.stats.population < 4500) mayor.turn();
      mayor.observe();
    }
    if (opts.each?.(g, day)) break;
    log.maxChapter = Math.max(log.maxChapter, w.story.chapter);
  }
  return { game: g, log };
}
