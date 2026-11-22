// ─────────────────────────────────────────────────────────────────────────────
// StoryDirector: chapter flow, deck, standing, Trace, deals, endings, view()
// and visual (docs/STORY.md §5–§7, §9, §10.9, §11). Owner: WP-A.
//
// Lifecycle: Game builds a new director whenever game.world is replaced (new
// city, load, restore), after the Simulation exists and before its first
// recomputeAll(). Never cache game.story across a 'world' event.
//
// Clocks: sim days (world.tick; onDay after each sim.step, onMonth on the
// rollover) and real seconds (update(dt)): `activeSec` counts unpaused
// seconds (deck gap, beat gap, no-answer timer), `realSec` all seconds (boot
// and title timers). Real-second timers are per session and restart on load,
// except story.chapterSec (the chapter floor), which is saved.
//
// Cards:
//   front cards (beats, Silt Logs, endings, chapter rewards) open blocking,
//     chained (right after a close, ≤ 3 in a row) or after the 10 s beat gap;
//   deck cards are drawn monthly (pacing.ts): faction cards wait in COMMS as
//     the pending card (‡ default after 20 d and 60 s), ⚑ and system cards
//     open at once; whisper cards only go to the COMMS log and the ticker.
// Everything that must survive a save lives in world.story.
// ─────────────────────────────────────────────────────────────────────────────

import { isUnlocked, lockedReason } from '../actions';
import {
  BUILDINGS,
  BUILD_REACTION_LIMIT,
  BUILD_REACTION_LIMIT_BY_TYPE,
  FACTION_BUILD_REACTIONS,
  FACTION_IDS,
  FACTION_LABELS,
  GALLERY_KEY,
  OTHER_REACTIONS,
  SALT,
  STORY_PACING,
  TRACE,
  UNLOCK_FALLBACK_POP,
} from '../config';
import { Rng } from '../rng';
import { storageGet, storageSet } from '../storage';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, START_YEAR, type BuildingType } from '../types';
import type { World } from '../world';
import {
  evalCond,
  findHold,
  firstMetric,
  formatMetric,
  formatMetricVs,
  logNumber,
  metric,
  metricFmt,
  storyContent,
  updateHolds,
  useStoryContent,
  type ContentIndex,
  type MetricFmt,
} from './conditions';
import {
  addTrace,
  applyEffects,
  applySurge,
  describePatch,
  districtOf,
  effectsText,
  fillTokens,
  findSpot,
  hintsFor,
  logId,
  signPactEffect,
  whisperBand,
  writeLocals,
  type EffectCtx,
  type EffectHost,
} from './effects';
import { pruneUnknownCards } from './encode';
import {
  changeFavor,
  driftFavor,
  endingRules,
  isActive,
  isRetired,
  isVisible,
  moodDrivers,
  patronOf,
  powerShare,
  shownState,
  standing,
  standings,
  tier,
  tierAtLeast,
  tierOf,
  updateMoods,
} from './factions';
import { STORY_CONTENT } from './content';
import { composeLayers } from './mods';
import { cardFaction, deckGatesOpen, defaultChoice, drawCard, FRONT_KINDS, pendingExpired } from './pacing';
import { resolveMods, tierPatches } from './resolve';
import { CHAPTER_NUMERALS, coherenceFor } from './state';
import * as turf from './turf';
import type {
  ActionView,
  Card,
  CardView,
  Chapter,
  Choice,
  Effect,
  Ending,
  EndingId,
  FactionId,
  FlagValue,
  GangId,
  Result,
  StoryState,
  StoryView,
  Tier,
  Unlockable,
  VisualState,
} from './types';
import * as vertical from './vertical';

// The story content (pure data) is registered once, when the director module loads.
// Tests may register other content with useStoryContent() before building a director.
useStoryContent(STORY_CONTENT);

const P = STORY_PACING;
/** Real seconds the chapter title card stays up before the trigger beat may open. */
const TITLE_SEC = 3;
/** Real seconds the incoming banner stays in the view. */
const BANNER_SEC = 6;
/** Choice indices recorded for the ending screen's key-choice icons. */
const KEY_CARDS: readonly string[] = ['ch1.lark', 'ch2.vote', 'ch3.pier', 'ch4.brine', 'ch5.choice'];
/** The Charter Claim each faction row shows in Ch6 (§8.6). */
const FACTION_ENDING: Record<FactionId, EndingId> = {
  board: 'ledger',
  basalt: 'ironwork',
  nacre: 'pearl',
  undertow: 'lowcrown',
  kites: 'lowcrown',
  tuning: 'quiet',
};
const CONTINUE: Choice = { label: 'Continue.', fx: [] };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const REWARD_PREFIX = 'reward.';

/** What the director needs from Game (Game satisfies it). */
export interface DirectorHost {
  readonly world: World;
  /** The in-progress gesture; beats wait while one is live. */
  readonly preview?: unknown;
}

/** Endings gallery kept across saves (§6.3), stored under GALLERY_KEY. */
export interface StoryGallery {
  v: 1;
  endings: EndingId[];
  lamplight: boolean;
  fullRecall: boolean;
}

/** Read the endings gallery (missing or unreadable storage → empty). */
export function readGallery(): StoryGallery {
  const empty: StoryGallery = { v: 1, endings: [], lamplight: false, fullRecall: false };
  try {
    const raw = storageGet(GALLERY_KEY);
    if (!raw) return empty;
    const g = JSON.parse(raw) as Partial<StoryGallery>;
    return {
      v: 1,
      endings: Array.isArray(g.endings) ? g.endings.filter((e): e is EndingId => typeof e === 'string') : [],
      lamplight: !!g.lamplight,
      fullRecall: !!g.fullRecall,
    };
  } catch {
    return empty;
  }
}

/** Read, patch and write the gallery (storage errors are swallowed by the helpers). */
function writeGallery(patch: (g: StoryGallery) => void): void {
  const g = readGallery();
  patch(g);
  storageSet(GALLERY_KEY, JSON.stringify(g));
}

const ENDING_IDS: readonly EndingId[] = ['ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet'];
const isEndingId = (v: unknown): v is EndingId => ENDING_IDS.includes(v as EndingId);

/** Story RNG that keeps its state in world.story.rng (turf.ts shares the same stream). */
class StoryRng extends Rng {
  constructor(private readonly world: World) {
    super(world.story.rng);
  }
  override next(): number {
    this.state = this.world.story.rng;
    const v = super.next();
    this.world.story.rng = this.state;
    return v;
  }
}

const dateOf = (tick: number) =>
  `${MONTHS[Math.floor(tick / DAYS_PER_MONTH) % MONTHS_PER_YEAR]} ${START_YEAR + Math.floor(tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR))}`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const round100 = (v: number) => Math.round(v / 100) * 100;
const short = (f: FactionId) => FACTION_LABELS[f].short;

export class StoryDirector implements EffectHost {
  /** Everything story-specific the renderer reads, once per frame (§9). Mutated in place. */
  readonly visual: VisualState = {
    presence: 0,
    traceFlicker: 0,
    palette: null,
    candles: 0,
    lureCold: false,
    revealed: false,
    mural: false,
    crackdowns: [],
  };

  /** Unpaused real seconds this session (not saved). */
  activeSec = 0;
  /** All real seconds this session, paused or not (boot and title timers). */
  realSec = 0;

  readonly world: World;
  readonly rng: Rng;
  private readonly host: DirectorHost;
  private readonly idx: ContentIndex;
  private cached: StoryView | null = null;

  // Session timers (not saved).
  private lastCardSec = 0;
  private lastCloseSec = -1e9;
  private justClosed = false;
  private chainLen = 0;
  private pendingSec = 0;
  private bootAt: number | null = null;
  private chapterStartSec = -1e9;
  private titleUntil = -1;
  private banner: { id: string; title: string; faction: FactionId; until: number } | null = null;
  private firstUpdate = true;
  private charterDue = false;
  /** The ending screen waits for the final card and Log 6 (mirrors story.flags.endingScreen, which is saved). */
  private endingDue: EndingId | null = null;
  private applying = 0;
  /** The Full Recall star was checked against the gallery this session. */
  private recallChecked = false;
  /** COMMS and Silt Log rows, rebuilt only when the log changes (stable identity for the UI). */
  private commsMemo: { key: string; rows: StoryView['comms'] } | null = null;
  private logsMemo: { key: string; rows: StoryView['logs'] } | null = null;

  constructor(game: DirectorHost) {
    this.host = game;
    this.world = game.world;
    this.rng = new StoryRng(this.world);
    this.idx = storyContent();
    const w = this.world;
    pruneUnknownCards(w.story, (id) => this.knownCard(id));
    if (this.idx.endings.length) turf.setEndingRulesSource((world) => endingRules(world));
    // Derived on load (§10.8): turf stats, vertical caches, local layers, then mods, layers, ledger.
    // The turf layers read world.mods (turfCrimeMul) and standings, so they are written
    // again once the mods are resolved (resolveMods itself reads the turf counts).
    turf.refreshStats(w);
    vertical.refresh(w);
    writeLocals(w);
    this.refreshMods();
    turf.refreshStats(w);
    this.refreshLedger();
    this.refreshVisual();
    // Ch1 on a city that already has roads (migrated save, or saved before boot): 20 s after load.
    if (w.story.chapter === 1 && w.story.phase === 'waiting' && w.tiles.some((t) => t.road)) {
      this.bootAt = Math.max(0, P.bootLoadDelaySec - TITLE_SEC);
    }
    // An ending screen still owed when the game was saved (final card or Log 6 still up).
    const due = w.story.flags.endingScreen;
    if (isEndingId(due) && w.story.ending) this.endingDue = due;
    else delete w.story.flags.endingScreen;
  }

  /** A card is open (or Charter Night is up) and the sim must pause. */
  get blocking(): boolean {
    return this.world.story.open !== null || this.charterOpen;
  }

  private get charterOpen(): boolean {
    return !!this.world.story.flags.charterNightOpen;
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  /** Per frame: real-time gates, boot / title / banner timers, the no-answer default, front cards. */
  update(dt: number, paused: boolean): void {
    if (!(dt > 0)) dt = 0;
    const w = this.world;
    const st = w.story;
    this.realSec += dt;
    if (!paused) {
      this.activeSec += dt;
      if (st.chapter <= 6) st.chapterSec = (st.chapterSec ?? 0) + dt;
      if (st.pending && st.open?.card !== st.pending.card) this.pendingSec += dt;
      // The settle countdown (view.chapter.closesInSec) runs in real seconds, not sim days:
      // rebuild the view when its whole second changes (at most once a second).
      const c = this.cached?.chapter.closesInSec;
      if (c !== undefined && this.closesIn() !== c) this.cached = null;
    }
    if (this.firstUpdate) {
      this.firstUpdate = false;
      if (st.open) w.events.emit('card', { id: st.open.card });
      if (st.pending) w.events.emit('pending', { id: st.pending.card });
      if (this.charterOpen) w.events.emit('charterNight');
      if (this.endingDue && !st.open && !this.endingCardsQueued()) this.emitEnding();
    }
    if (st.chapter === 1 && st.phase === 'waiting') {
      if (this.bootAt === null && this.roadPlaced()) this.bootAt = this.realSec + Math.max(0, P.bootDelaySec - TITLE_SEC);
      if (this.bootAt !== null && this.realSec >= this.bootAt && !st.open) this.startChapter(1);
    }
    if (this.banner && this.realSec >= this.banner.until) {
      this.banner = null;
      this.cached = null;
    }
    if (this.titleUntil >= 0 && this.realSec >= this.titleUntil) {
      this.titleUntil = -1;
      this.cached = null;
    }
    this.checkPending();
    this.tryOpenFront();
    // MOTH breathing: presence eases toward 1 while a MOTH-speaker card is open.
    let target = 0;
    if (st.open) {
      const id = st.open.card;
      const c = id.startsWith(REWARD_PREFIX) ? null : this.idx.cards.get(id);
      target = !c || c.speaker === 'moth' || c.kind === 'log' ? 1 : 0; // chapter rewards are Silt Logs
    }
    const v = this.visual;
    v.presence += (target - v.presence) * Math.min(1, dt * 1.5);
    if (Math.abs(v.presence - target) < 0.001) v.presence = target;
  }

  private roadPlaced(): boolean {
    for (const s of this.world.signals) if (s.t === 'action' && s.tool === 'road') return true;
    return false;
  }

  // ── Daily ─────────────────────────────────────────────────────────────────

  /** After each sim.step(): signals, holds, goals, triggers, queue, pending timeout; onMonth on rollover. */
  onDay(): void {
    const w = this.world;
    if (vertical.onDay(w)) this.markDirty(); // a stage completed: crown mods resolve
    // Timed mods, incomes, locals, pacts and rail cuts end on their day, not at the
    // next rollover: an income runs exactly its months, a 60 d mod 60 days.
    if (this.expireTimed()) this.markDirty();
    this.drainSignals();
    this.fallbackUnlocks();
    this.checkTuning();
    this.stepChapter();
    this.deliverWhispers();
    this.checkPending();
    this.checkCountdown();
    this.checkReviews();
    this.ambient();
    if (w.tick % DAYS_PER_MONTH === 0) this.onMonth();
    this.checkComplete();
    this.refreshVisual();
    this.cached = null; // live numbers (goals, countdown, pending) changed
  }

  /** Month rollover, after the sim's settleMonth (§11 onMonth order). */
  onMonth(): void {
    const w = this.world;
    const st = w.story;
    // 1. Expire mods, incomes, locals, pacts and rail cuts (onDay already did; deal records
    //    are kept for cooldowns). turf.update owns story.crackdowns' lifetime.
    this.expireTimed(true);
    st.credits = st.credits.filter((c) => c.n > 0);
    // 2–3. Turf, then vertical.
    turf.update(w);
    vertical.refresh(w);
    // 4. Mood, standings, drift, favorMonthly; tier events and pulses.
    const before = standings(w);
    updateMoods(w);
    driftFavor(w, w.mods.favorMonthly);
    for (const f of FACTION_IDS) {
      const now = standing(w, f);
      if (now !== before[f]) w.events.emit('standing', { faction: f, delta: now - before[f], value: now });
    }
    this.pulses();
    // 5. Trace: −1 if nothing raised it this month, then traceMonthly.
    this.monthlyTrace();
    // 6. Mods, layers, ledger.
    writeLocals(w);
    this.refreshMods();
    this.refreshLedger();
    this.outages();
    // 7. Goals and triggers run daily; the card draw runs here.
    this.drawDeck();
    this.refreshVisual();
    this.cached = null;
  }

  /**
   * Drop timed mods, incomes, locals, pacts and rail cuts whose `until` has come.
   * Returns true if anything ended. A pact ending re-derives the turf layers and a
   * rail cut ending the live network, unless `monthly` (onMonth refreshes both).
   */
  private expireTimed(monthly = false): boolean {
    const w = this.world;
    const st = w.story;
    const tick = w.tick;
    const timed = (m: { until: number }) => m.until < 0 || m.until > tick;
    const live = (m: { until: number }) => m.until > tick;
    const n = st.mods.length + st.incomes.length + st.locals.length;
    if (st.mods.some((m) => !timed(m))) st.mods = st.mods.filter(timed);
    if (st.incomes.some((m) => !live(m))) st.incomes = st.incomes.filter(live);
    if (st.locals.some((m) => !timed(m))) st.locals = st.locals.filter(timed);
    let any = st.mods.length + st.incomes.length + st.locals.length !== n;
    if (st.pacts.some((p) => !live(p))) {
      st.pacts = st.pacts.filter(live);
      if (!monthly) turf.refreshStats(w);
      any = true;
    }
    if (st.railOut.some((r) => !live(r))) {
      st.railOut = st.railOut.filter(live);
      if (!monthly) vertical.refresh(w);
      any = true;
    }
    return any;
  }

  private drainSignals(): void {
    const w = this.world;
    const st = w.story;
    if (!w.signals.length) return;
    for (const s of w.signals) {
      switch (s.t) {
        case 'action':
          if (s.tool === 'road' && st.chapter === 1 && st.phase === 'waiting' && this.bootAt === null) {
            this.bootAt = this.realSec + Math.max(0, P.bootDelaySec - TITLE_SEC);
          }
          break;
        case 'built':
          this.buildReaction(s.type);
          break;
        case 'bulldozed':
          if (s.fabTiles >= OTHER_REACTIONS.bulldozeFab.fabTiles) this.favorMap(OTHER_REACTIONS.bulldozeFab.favor);
          break;
        case 'milestone':
          this.favorMap(OTHER_REACTIONS.milestone);
          break;
        case 'gangSurge':
          applySurge(w, s.gang, s.x, s.y);
          break;
        case 'corpGrant':
          changeFavor(w, standing(w, 'nacre') > standing(w, 'basalt') ? 'nacre' : 'basalt', OTHER_REACTIONS.corpGrant);
          break;
      }
    }
    w.signals.length = 0;
  }

  private favorMap(m: Partial<Record<FactionId, number>>): void {
    for (const [f, v] of Object.entries(m) as [FactionId, number][]) changeFavor(this.world, f, v);
  }

  /** One-off build reactions (§2.6): only the first N of a type count. The first memorial adds approval +3 for good. */
  private buildReaction(type: BuildingType): void {
    const st = this.world.story;
    const limit = BUILD_REACTION_LIMIT_BY_TYPE[type] ?? BUILD_REACTION_LIMIT;
    const n = st.builtCounts[type] ?? 0;
    st.builtCounts[type] = n + 1;
    if (n >= limit) return;
    const r = FACTION_BUILD_REACTIONS[type];
    if (r) this.favorMap(r);
    if (type === 'memorial' && n === 0 && !st.mods.some((m) => m.id === 'memorial')) {
      st.mods.push({ id: 'memorial', label: 'Sunk Memorial', until: -1, mods: { approvalAdd: 3 } });
      this.refreshMods();
    }
  }

  /** Population fallbacks (§5.0) become explicit unlocks, with their news line and 'unlock' event. */
  private fallbackUnlocks(): void {
    const w = this.world;
    for (const [what, pop] of Object.entries(UNLOCK_FALLBACK_POP) as [Unlockable, number][]) {
      if (w.maxPopulation >= pop && !w.story.unlocks.includes(what)) this.unlockNow(what);
    }
  }

  private unlockNow(what: Unlockable): void {
    applyEffects(this, [{ t: 'unlock', what }], { spot: -1 });
    this.cached = null;
  }

  /** The Tuning wakes at Trace ≥ 40 or when revealed (Ch4 Publish sets the flag itself). */
  private checkTuning(): void {
    const st = this.world.story;
    if (!st.flags.tuningActive && (st.trace >= TRACE.tuningActive || st.revealed)) {
      st.flags.tuningActive = true;
      this.flagSet('tuningActive', true);
    }
  }

  // ── Chapters (§5.0) ───────────────────────────────────────────────────────

  private chapterDef(): Chapter | undefined {
    return this.idx.chapters.get(this.world.story.chapter);
  }

  private stepChapter(): void {
    const w = this.world;
    const st = w.story;
    const tick = w.tick;
    if (st.phase === 'waiting') {
      const ch = this.chapterDef();
      if (!ch || st.open || this.frontDue()) return;
      const waited = tick - st.waitingSince;
      if (st.chapter === 1) {
        // Ch1 opens from the boot timer (update); the day fallbacks apply only while it is
        // unarmed (no road yet), so an old city still gets its load delay.
        if (this.bootAt !== null) return;
        if (waited >= P.hardFallbackDays || (waited >= P.fallbackDays && evalCond(w, ch.fallback))) this.startChapter(1);
        return;
      }
      if (evalCond(w, ch.trigger) || (waited >= P.fallbackDays && evalCond(w, ch.fallback)) || waited >= P.hardFallbackDays) {
        this.startChapter(st.chapter);
      }
      return;
    }
    if (st.phase !== 'active' && st.phase !== 'countdown') return;
    const ch = this.chapterDef();
    if (!ch) return;
    let changed = false;
    for (const g of ch.goals) {
      if (st.goalsDone.includes(g.id) || st.goalsWaived.includes(g.id)) continue;
      updateHolds(w, g.cond);
      if (evalCond(w, g.cond)) {
        st.goalsDone.push(g.id);
        w.events.emit('goal', { id: g.id, done: true });
        changed = true;
      }
    }
    // Waivers: after 720 d, one unmet goal per 360 d counts as done.
    const days = tick - st.chapterTick;
    if (days >= P.waiverAfterDays) {
      const allowed = 1 + Math.floor((days - P.waiverAfterDays) / P.waiverEveryDays);
      while (st.goalsWaived.length < allowed) {
        const g = ch.goals.find((k) => !st.goalsDone.includes(k.id) && !st.goalsWaived.includes(k.id));
        if (!g) break;
        st.goalsWaived.push(g.id);
        w.addNews(`${g.label}: the city moved on without it.`, 'info');
        w.events.emit('toast', { text: 'The city moved on without it.', kind: 'info' });
        w.events.emit('goal', { id: g.id, done: true });
        changed = true;
      }
    }
    if (changed) this.markChanged();
  }

  private startChapter(n: number): void {
    const w = this.world;
    const st = w.story;
    const ch = this.idx.chapters.get(n);
    if (!ch) return;
    st.chapter = n;
    st.phase = 'active';
    st.chapterTick = w.tick;
    st.beatsShown = [];
    st.goalsDone = [];
    st.goalsWaived = [];
    for (const g of ch.goals) {
      const h = findHold(g.cond);
      if (h) st.holds[h.key] = 0;
    }
    this.bootAt = null;
    if (n === 1) st.chapterSec = 0; // the boot counts as a completion: Ch1 gets the floor too
    this.chapterStartSec = this.realSec;
    this.titleUntil = this.realSec + TITLE_SEC;
    if (n === 3) turf.forceSeed(w); // §5 Ch3 on start: both gangs seed, the Seam is set
    applyEffects(this, ch.onStart, { spot: -1 });
    w.events.emit('chapter', { n, title: ch.title });
    this.markChanged();
  }

  /** The chapter's next required beat if it is due now (or null). */
  private nextBeat(): string | null {
    const w = this.world;
    const st = w.story;
    if (st.phase !== 'active' && st.phase !== 'countdown') return null;
    const ch = this.chapterDef();
    if (!ch) return null;
    let prevTick = st.chapterTick;
    for (const b of ch.beats) {
      if (b.optional) continue;
      if (st.beatsShown.includes(b.card)) {
        prevTick = st.seen[b.card] ?? prevTick;
        continue;
      }
      if (!this.idx.cards.has(b.card)) continue; // missing content never strands a chapter
      if (b.after === 'trigger') return b.card;
      if (st.countdownEnd !== null) return w.tick >= st.countdownEnd ? b.card : null;
      if (b.after === 'chain') return b.card;
      if ('days' in b.after) return w.tick >= prevTick + b.after.days ? b.card : null;
      const due = evalCond(w, b.after.cond) || w.tick - st.chapterTick >= P.beatFallbackDays;
      return due ? b.card : null;
    }
    return null;
  }

  /** Every required beat of the chapter has been shown. */
  private beatsDone(ch: Chapter): boolean {
    const st = this.world.story;
    for (const b of ch.beats) {
      if (b.optional || !this.idx.cards.has(b.card)) continue;
      if (!st.beatsShown.includes(b.card)) return false;
    }
    return true;
  }

  private checkComplete(): void {
    const w = this.world;
    const st = w.story;
    if (st.phase !== 'active' || st.chapter >= 6) return;
    const ch = this.chapterDef();
    if (!ch || st.open || this.charterOpen || this.frontDue()) return;
    for (const g of ch.goals) if (!st.goalsDone.includes(g.id) && !st.goalsWaived.includes(g.id)) return;
    if (!this.beatsDone(ch)) return;
    // Optional beats count once queued: wait for any still in the queue.
    for (const q of st.queue) if (this.idx.beatChapter.get(q.card) === ch.n) return;
    if (!this.chapterSettled()) return;
    this.completeChapter(ch);
  }

  /** The chapter floor (§5.0): chapterMinSec unpaused seconds since the last chapter closed. */
  private chapterSettled(): boolean {
    return (this.world.story.chapterSec ?? 0) >= P.chapterMinSec;
  }

  private completeChapter(ch: Chapter): void {
    const w = this.world;
    const st = w.story;
    st.chapterSec = 0;
    applyEffects(
      this,
      ch.reward.filter((e) => !(e.t === 'log' && e.n === ch.log)),
      { spot: -1 },
    );
    this.ownLog(ch.log);
    st.queue.push({ card: `${REWARD_PREFIX}${ch.n}`, tick: w.tick });
    st.chapter = ch.n + 1;
    st.phase = 'waiting';
    st.waitingSince = w.tick;
    this.markChanged();
  }

  // ── Front cards (beats, logs, endings, rewards) ───────────────────────────

  /** Is a front card due (queued and due, or the chapter's next beat)? */
  private frontDue(): boolean {
    return this.nextFront() !== null;
  }

  private nextFront(): { card: string; queueIndex: number } | null {
    const st = this.world.story;
    const tick = this.world.tick;
    for (let k = 0; k < st.queue.length; k++) {
      const q = st.queue[k];
      if (q.tick > tick) continue;
      if (q.card.startsWith(REWARD_PREFIX)) return { card: q.card, queueIndex: k };
      const c = this.idx.cards.get(q.card);
      if (c && (FRONT_KINDS.has(c.kind) || this.idx.beatChapter.has(c.id))) return { card: q.card, queueIndex: k };
    }
    const b = this.nextBeat();
    return b ? { card: b, queueIndex: -1 } : null;
  }

  /** Open the next due front card if the gates allow (chain, gesture, beat gap, title card). */
  private tryOpenFront(): void {
    const st = this.world.story;
    const chained = this.justClosed && this.chainLen < P.maxChain;
    this.justClosed = false;
    if (st.open || this.charterOpen || this.applying) return;
    if (this.host.preview) return;
    const next = this.nextFront();
    if (!next) return;
    if (!chained && this.activeSec - this.lastCloseSec < P.beatGapSec) return;
    if (this.realSec - this.chapterStartSec < TITLE_SEC && this.idx.beatChapter.get(next.card) === st.chapter) return;
    if (next.queueIndex >= 0) st.queue.splice(next.queueIndex, 1);
    this.chainLen = chained ? this.chainLen + 1 : 1;
    this.openFront(next.card);
  }

  private openFront(id: string): void {
    const w = this.world;
    const st = w.story;
    const card = this.cardFor(id);
    if (!card) return;
    if (this.idx.beatChapter.has(id)) {
      if (!st.beatsShown.includes(id)) st.beatsShown.push(id);
      st.lastBeatTick = w.tick;
      if (st.countdownEnd !== null && w.tick >= st.countdownEnd) st.countdownEnd = null;
    }
    const spot = card.spot ? findSpot(w, card.spot, this.rng) : -1;
    st.seen[id] = w.tick;
    st.open = { card: id, spot };
    this.titleUntil = -1;
    this.applying++;
    applyEffects(this, card.onShow, { spot });
    this.applying--;
    w.events.emit('card', { id });
    this.markChanged();
  }

  // ── Deck (§7.1) ───────────────────────────────────────────────────────────

  private drawDeck(): void {
    const w = this.world;
    const st = w.story;
    const gates = deckGatesOpen(w, {
      open: this.blocking,
      pending: st.pending !== null,
      frontDue: this.frontDue(),
      activeSec: this.activeSec,
      lastCardSec: this.lastCardSec,
    });
    if (!gates) return;
    const { pick, drop } = drawCard(w, this.rng, isUnlocked(w, 'comms'), w.mods.cardRateMul);
    const remove = [...drop];
    if (pick?.queueIndex !== undefined) remove.push(pick.queueIndex);
    remove.sort((a, b) => b - a);
    for (const k of remove) st.queue.splice(k, 1);
    if (pick) this.deliver(pick.card);
  }

  /** Deliver a deck card: faction → pending (banner); ⚑ / system → open now. */
  private deliver(card: Card): void {
    const w = this.world;
    const st = w.story;
    const tick = w.tick;
    const spot = card.spot ? findSpot(w, card.spot, this.rng) : -1;
    st.seen[card.id] = tick;
    st.lastCardTick = tick;
    this.lastCardSec = this.activeSec;
    const f = cardFaction(w, card);
    if (f) st.lastSpeaker = f;
    if (card.kind === 'hostile' && f) {
      st.lastHostileBy[f] = tick;
      st.lastHostileTick = tick;
    }
    this.applying++;
    applyEffects(this, card.onShow, { spot });
    this.applying--;
    if (card.kind === 'faction') {
      st.pending = { card: card.id, tick, spot };
      this.pendingSec = 0;
      if (f) this.banner = { id: card.id, title: fillTokens(w, card.title, spot), faction: f, until: this.realSec + BANNER_SEC };
      w.events.emit('incoming', { id: card.id });
      w.events.emit('pending', { id: card.id });
    } else {
      st.open = { card: card.id, spot };
      this.chainLen = 1;
      w.events.emit('card', { id: card.id });
    }
    this.markChanged();
  }

  /** No-answer default (§7.1): 20 sim days AND 60 unpaused seconds, never while the card is open. */
  private checkPending(): void {
    const w = this.world;
    const st = w.story;
    const p = st.pending;
    // Never while any card is open (the player may be reading it, or a beat holds the screen).
    if (!p || st.open || this.applying) return;
    if (!pendingExpired(w, p.tick, this.pendingSec)) return;
    const card = this.idx.cards.get(p.card);
    st.pending = null;
    w.events.emit('pending', null);
    if (!card) return;
    const i = defaultChoice(w, card);
    this.resolve(card, p.card, i, p.spot, true);
    const f = cardFaction(w, card);
    w.events.emit('toast', { text: `No answer. ${f ? short(f) : 'The city'} took that as a yes.`, kind: 'info' });
  }

  // ── Player choices ────────────────────────────────────────────────────────

  /** Answer the open card. A locked choice only toasts its reason. */
  choose(choiceIndex: number): void {
    const w = this.world;
    const st = w.story;
    const open = st.open;
    if (!open || this.applying) return;
    const card = this.cardFor(open.card);
    if (!card) {
      st.open = null;
      w.events.emit('card', null);
      return;
    }
    const choices = this.choicesOf(card);
    const ch = choices[choiceIndex];
    if (!ch) return;
    if (ch.requires && !evalCond(w, ch.requires)) {
      w.events.emit('toast', { text: fillTokens(w, ch.lockedHint ?? 'Not available', open.spot), kind: 'error' });
      return;
    }
    const wasPending = st.pending?.card === open.card;
    st.open = null;
    if (wasPending) {
      st.pending = null;
      w.events.emit('pending', null);
    }
    this.resolve(card, open.card, choiceIndex, open.spot, false);
  }

  /** Apply a choice, log it, close the card and run the follow-ups (chains, Charter Night, ending). */
  private resolve(card: Card, id: string, i: number, spot: number, auto: boolean): void {
    const w = this.world;
    const st = w.story;
    const choices = this.choicesOf(card);
    const ch = choices[i] ?? CONTINUE;
    const ctx: EffectCtx = { spot };
    this.applying++;
    applyEffects(this, ch.fx, ctx);
    this.applying--;
    st.log.push({ tick: w.tick, card: id, choice: card.choices.length ? i : null, ...(auto ? { auto: true } : {}) });
    if (st.log.length > P.logKeep) st.log.splice(0, st.log.length - P.logKeep);
    if (KEY_CARDS.includes(id)) st.keyChoices[id] = i;
    if (!auto) {
      // The card was on screen: it closes now, and the next front card may chain.
      this.lastCloseSec = this.activeSec;
      this.justClosed = true;
      w.events.emit('card', null);
    }
    this.afterClose();
    // Completion first, so a chapter's reward card chains right after its last beat.
    this.checkComplete();
    if (!auto) this.tryOpenFront();
  }

  private afterClose(): void {
    const w = this.world;
    writeLocals(w);
    this.refreshMods();
    this.refreshLedger();
    this.refreshVisual();
    if (this.charterDue && !w.story.open) {
      this.charterDue = false;
      w.events.emit('charterNight');
    }
    // The ending screen follows the final card and Log 6 (§6.1).
    if (this.endingDue && !w.story.open && !this.endingCardsQueued()) this.emitEnding();
    this.markChanged();
    w.events.emit('stats');
  }

  /** Show the ending screen now (once); the saved reminder goes with it. */
  private emitEnding(): void {
    const id = this.endingDue;
    this.endingDue = null;
    delete this.world.story.flags.endingScreen;
    if (id) this.world.events.emit('ending', { id });
  }

  private endingCardsQueued(): boolean {
    for (const q of this.world.story.queue) {
      if (q.card.startsWith(REWARD_PREFIX)) return true;
      const k = this.idx.cards.get(q.card)?.kind;
      if (k === 'ending' || k === 'log') return true;
    }
    return false;
  }

  /** Open the pending COMMS card. */
  openPending(): void {
    const w = this.world;
    const st = w.story;
    if (!st.pending || st.open || this.charterOpen) return;
    st.open = { card: st.pending.card, spot: st.pending.spot };
    this.banner = null;
    this.chainLen = 1;
    w.events.emit('card', { id: st.pending.card });
    this.markChanged();
  }

  /** Send the open faction card back to COMMS (keeps its no-answer timer). */
  later(): void {
    const w = this.world;
    const st = w.story;
    if (!st.open || st.pending?.card !== st.open.card) return;
    st.open = null;
    this.lastCloseSec = this.activeSec;
    w.events.emit('card', null);
    this.markChanged();
  }

  // ── Deals, pacts, salt, nudge (§2.6, §3.6, §6.1) ──────────────────────────

  private dealReason(f: FactionId): string | null {
    const w = this.world;
    const st = w.story;
    const deal = this.idx.factions[f]?.deal;
    if (!deal) return 'No deal on offer';
    if (!isVisible(w, f)) return 'Not available';
    if (isRetired(w, f)) return endingRules(w)?.retiredLabel ?? 'Not available';
    const gang = f === 'undertow' || f === 'kites';
    if (gang) {
      if (endingRules(w)?.lockPacts) return 'Pacts are closed';
      if (!isUnlocked(w, 'pact')) return `Locked: reach ${num(UNLOCK_FALLBACK_POP.pact ?? 0)} residents`;
    } else if (!isUnlocked(w, 'deals')) return `Locked: reach ${num(UNLOCK_FALLBACK_POP.deals ?? 0)} residents`;
    const need = deal.minTier === 'allied' ? 'allied' : 'friendly';
    if (!tierAtLeast(w, f, need)) return `Needs ${short(f)} ${need === 'allied' ? 'Allied' : 'Friendly'}`;
    if (!gang) {
      const d = st.deals[deal.id];
      if (d && d.until > w.tick) return `Active · ${d.until - w.tick}d left`;
      if (d && d.cooldownUntil > w.tick) return `Cooldown ${d.cooldownUntil - w.tick}d`;
    }
    const cost = this.dealCost(deal.fx);
    if (cost > 0 && w.funds < cost) return `Not enough credits (need ${num(cost)})`;
    return null;
  }

  private dealCost(fx: readonly Effect[]): number {
    let c = 0;
    for (const e of fx) if (e.t === 'funds' && e.v < 0) c -= e.v;
    return c;
  }

  /** Take a Friendly faction's deal. For the gangs the deal is the pact. */
  takeDeal(f: FactionId): Result {
    if (f === 'undertow' || f === 'kites') return this.signPact(f);
    const w = this.world;
    const reason = this.dealReason(f);
    if (reason) return { ok: false, reason, cost: 0 };
    const deal = this.idx.factions[f]!.deal!;
    const until = w.tick + deal.months * DAYS_PER_MONTH;
    const funds = w.funds;
    applyEffects(this, deal.fx, { spot: -1, dealUntil: until });
    w.story.deals[deal.id] = { until, cooldownUntil: w.tick + deal.cooldownDays };
    this.afterAction();
    return { ok: true, cost: Math.max(0, Math.round(funds - w.funds)) };
  }

  /** Sign (or renew) a gang's pact (§3.6): Friendly or better, no cooldown. */
  signPact(g: GangId): Result {
    const w = this.world;
    const deal = this.idx.factions[g]?.deal;
    let reason = deal ? this.dealReason(g) : null;
    if (!deal) {
      if (endingRules(w)?.lockPacts) reason = 'Pacts are closed';
      else if (!isUnlocked(w, 'pact')) reason = `Locked: reach ${num(UNLOCK_FALLBACK_POP.pact ?? 0)} residents`;
      else if (!tierAtLeast(w, g, 'friendly')) reason = `Needs ${short(g)} Friendly`;
    }
    if (reason) return { ok: false, reason, cost: 0 };
    const months = deal?.months ?? 12;
    const until = w.tick + months * DAYS_PER_MONTH;
    const funds = w.funds;
    if (deal) {
      const fx = deal.fx.some((e) => e.t === 'pact') ? deal.fx : [{ t: 'pact', gang: g, months } as Effect, ...deal.fx];
      applyEffects(this, fx, { spot: -1, dealUntil: until });
      w.story.deals[deal.id] = { until, cooldownUntil: w.tick };
    } else signPactEffect(w, g, months);
    this.afterAction();
    return { ok: true, cost: Math.max(0, Math.round(funds - w.funds)) };
  }

  /** Salt cost now: round100(600 + 0.08 × pop + 0.02 × treasury), so it still stings in a rich city. */
  saltCost(): number {
    const w = this.world;
    return round100(SALT.base + SALT.perPop * w.stats.population + SALT.perFunds * Math.max(0, w.funds));
  }

  private saltReason(f: FactionId): string | null {
    const w = this.world;
    if (!isUnlocked(w, 'factions')) return `Locked: reach ${num(UNLOCK_FALLBACK_POP.factions ?? 0)} residents`;
    const def = this.idx.factions[f];
    if (f === 'tuning' || (def && !def.salt)) return f === 'tuning' ? "The Tuning won't take salt." : `${short(f)} won't take salt.`;
    if (!isVisible(w, f)) return 'Not available';
    if (isRetired(w, f)) return endingRules(w)?.retiredLabel ?? 'Not available';
    if (endingRules(w)?.lockSalt) return 'The Ledger is open: no more salt';
    const ready = w.story.saltReady[f] ?? 0;
    if (ready > w.tick) return `Cooldown ${ready - w.tick}d`;
    const cost = this.saltCost();
    if (w.funds < cost) return `Not enough credits (need ${num(cost)})`;
    return null;
  }

  /** Send salt (§2.6): favor +8, Trace +3, 90 d cooldown per faction. */
  sendSalt(f: FactionId): Result {
    const w = this.world;
    const reason = this.saltReason(f);
    if (reason) return { ok: false, reason, cost: 0 };
    const cost = this.saltCost();
    w.funds -= cost;
    changeFavor(w, f, SALT.favor);
    addTrace(w, SALT.trace);
    w.story.saltReady[f] = w.tick + SALT.cooldown;
    w.events.emit('toast', { text: `Salt sent. ${short(f)} remembers.`, kind: 'good' });
    this.afterAction();
    return { ok: true, cost };
  }

  private nudgeReason(f: FactionId): string | null {
    const w = this.world;
    if (!endingRules(w)?.nudge) return 'Not available';
    if (!isActive(w, f)) return 'Not available';
    if (w.story.nudgeReady > w.tick) return `Cooldown ${w.story.nudgeReady - w.tick}d`;
    return null;
  }

  /** Quiet Hand Nudge: +15 favor to one faction, once per 360 d. */
  nudge(f: FactionId): Result {
    const w = this.world;
    const reason = this.nudgeReason(f);
    if (reason) return { ok: false, reason, cost: 0 };
    changeFavor(w, f, P.nudgeFavor);
    w.story.nudgeReady = w.tick + P.nudgeEvery;
    this.afterAction();
    return { ok: true, cost: 0 };
  }

  private afterAction(): void {
    writeLocals(this.world);
    this.refreshMods();
    this.refreshLedger();
    this.refreshVisual();
    this.markChanged();
  }

  // ── Endings (§6) ──────────────────────────────────────────────────────────

  private claimsHold(e: Ending): boolean {
    if (e.id === 'quiet') return true;
    return e.claims.every((c) => evalCond(this.world, c.cond));
  }

  /** Hold the charter for an ending (Charter Night). The Quiet Hand is always allowed. */
  chooseEnding(id: EndingId): Result {
    const w = this.world;
    if (!this.charterOpen) return { ok: false, reason: 'The count is not open', cost: 0 };
    const e = this.idx.ending.get(id);
    if (!e) return { ok: false, reason: 'Unknown ending', cost: 0 };
    if (!this.claimsHold(e)) {
      const miss = e.claims.find((c) => !evalCond(w, c.cond));
      return { ok: false, reason: miss ? `Claim not met: ${miss.label}` : 'Claims not met', cost: 0 };
    }
    if (w.story.ending === id) {
      // Charter Review: keep the charter as it is.
      w.story.flags.charterNightOpen = false;
      w.story.nextReview = w.tick + P.reviewEvery;
      this.afterAction();
      return { ok: true, cost: 0 };
    }
    this.setEnding(e);
    return { ok: true, cost: 0 };
  }

  private setEnding(e: Ending): void {
    const w = this.world;
    const st = w.story;
    const v = e.rules.variant;
    st.ending = e.id;
    st.endingTick = w.tick;
    st.endingVariant = v && evalCond(w, v.when) ? v.id : null;
    st.nextReview = w.tick + P.reviewEvery;
    st.flags.charterNightOpen = false;
    this.charterDue = false;
    st.countdownEnd = null;
    st.chapter = 7;
    st.phase = 'ended';
    if (this.idx.cards.has(e.card)) st.queue.push({ card: e.card, tick: w.tick });
    if (!st.logs.includes(6)) {
      this.ownLog(6);
      st.queue.push({ card: `${REWARD_PREFIX}6`, tick: w.tick });
    }
    writeGallery((g) => {
      if (!g.endings.includes(e.id)) g.endings.push(e.id);
      if (st.endingVariant === 'lamplight') g.lamplight = true;
    });
    // Saved too, so a reload while the final card or Log 6 is up still ends on the screen.
    this.endingDue = e.id;
    st.flags.endingScreen = e.id;
    this.justClosed = true; // the final card follows the confirm at once
    turf.refreshStats(w);
    this.afterAction();
    this.tryOpenFront();
    if (!st.open && !this.endingCardsQueued()) this.emitEnding();
  }

  /** Charter Night: six more months. */
  recount(): void {
    const w = this.world;
    const st = w.story;
    if (!this.charterOpen) return;
    st.flags.charterNightOpen = false;
    st.countdownEnd = w.tick + 180;
    if (st.chapter === 6) st.phase = 'countdown';
    this.markChanged();
  }

  /** Countdown ended with no beat left to show: the count reopens (Recount). */
  private checkCountdown(): void {
    const w = this.world;
    const st = w.story;
    if (st.countdownEnd === null || w.tick < st.countdownEnd) return;
    const ch = this.chapterDef();
    if (ch && !this.beatsDone(ch)) return; // the chapter's count beat opens instead
    st.countdownEnd = null;
    this.charterNight();
  }

  /** Charter Review every 1,080 d after an ending, and the Full Recall coda (§6.3). */
  private checkReviews(): void {
    const w = this.world;
    const st = w.story;
    if (!st.ending) return;
    if (st.nextReview !== null && w.tick >= st.nextReview) {
      st.nextReview = w.tick + P.reviewEvery;
      if (this.idx.cards.has('ep.review') && !st.queue.some((q) => q.card === 'ep.review')) this.queue('ep.review', 0);
    }
    // The coda draws itself (system card, `when` logs ≥ 12 & chapter ≥ 7); queue it only if the content gives no `when`.
    const coda = this.idx.cards.get('coda.recall');
    if (coda && !coda.when && st.logs.length >= 12 && !st.flags.fullRecall && st.seen['coda.recall'] === undefined) {
      if (!st.queue.some((q) => q.card === 'coda.recall')) this.queue('coda.recall', 0);
    }
    // A save that earned Full Recall elsewhere (or before storage worked): star it once per session.
    if (st.flags.fullRecall && !this.recallChecked) {
      this.recallChecked = true;
      if (!readGallery().fullRecall) writeGallery((g) => (g.fullRecall = true));
    }
  }

  // ── EffectHost ────────────────────────────────────────────────────────────

  /** Schedule a card (beat, deck follow-up, whisper or log) `days` from now. */
  queue(card: string, days: number): void {
    const st = this.world.story;
    if (!this.knownCard(card)) return;
    const tick = this.world.tick + Math.max(0, days);
    if (st.queue.some((q) => q.card === card && q.tick === tick)) return;
    st.queue.push({ card, tick });
  }

  /** Own Silt Log n and show its card next. */
  log(n: number): void {
    if (this.ownLog(n) && this.idx.logCards.has(n)) this.queue(this.idx.logCards.get(n)!.id, 0);
  }

  private ownLog(n: number): boolean {
    const st = this.world.story;
    if (!(n >= 1 && n <= 12) || st.logs.includes(n)) return false;
    st.logs.push(n);
    this.world.events.emit('log', { n });
    return true;
  }

  flagSet(key: string, v: FlagValue): void {
    const st = this.world.story;
    if (key === 'tuningActive' && v && !st.flags.hymnQueued) {
      st.flags.hymnQueued = true;
      this.queue('tu.hymn', 15);
    }
    if (key === 'fullRecall' && v) {
      this.recallChecked = true;
      writeGallery((g) => (g.fullRecall = true));
    }
  }

  countdown(days: number): void {
    const st = this.world.story;
    st.countdownEnd = this.world.tick + days;
    if (st.chapter === 6) st.phase = 'countdown';
  }

  charterNight(): void {
    this.world.story.flags.charterNightOpen = true;
    if (this.world.story.open || this.applying) this.charterDue = true;
    else this.world.events.emit('charterNight');
    this.markChanged();
  }

  ending(id: EndingId): void {
    const e = this.idx.ending.get(id);
    if (e) this.setEnding(e);
  }

  // ── Monthly helpers ───────────────────────────────────────────────────────

  /** Hostile pulses: each Hostile faction's pulse fx every pulseEvery days (the clock starts on entering Hostile). */
  private pulses(): void {
    const w = this.world;
    const st = w.story;
    for (const f of FACTION_IDS) {
      const def = this.idx.factions[f];
      const hostile = isActive(w, f) && tierOf(standing(w, f)) === 'hostile';
      if (!hostile || !def?.hostile.pulse?.length || !def.hostile.pulseEvery) {
        delete st.lastPulseBy[f];
        continue;
      }
      const last = st.lastPulseBy[f];
      if (last === undefined) {
        st.lastPulseBy[f] = w.tick;
        continue;
      }
      if (w.tick - last < def.hostile.pulseEvery) continue;
      st.lastPulseBy[f] = w.tick;
      applyEffects(this, def.hostile.pulse, { spot: -1 });
    }
  }

  private monthlyTrace(): void {
    const w = this.world;
    const st = w.story;
    if (!st.traceRaisedThisMonth) addTrace(w, -TRACE.monthlyDecay);
    const tm = w.mods.traceMonthly;
    if (tm) addTrace(w, tm);
    st.traceRaisedThisMonth = false;
  }

  /** `outageChance` (Go to ground): each service building may go offline 10 d each month. */
  private outages(): void {
    const w = this.world;
    const p = w.mods.outageChance;
    if (!(p > 0)) return;
    let news = false;
    for (const b of w.buildings.values()) {
      if (BUILDINGS[b.type]?.category !== 'services' || b.offline > 0) continue;
      if (this.rng.next() >= p) continue;
      b.offline = 10;
      w.markChanged(b.x, b.y, b.x + b.size - 1, b.y + b.size - 1);
      if (!news) {
        news = true;
        w.addNews(`Lamps stutter in ${districtOf(w, b.y * 64 + b.x)}. Something else is in the wires.`, 'bad');
      }
    }
  }

  /** world.ledger: story incomes by label, the Off-ledger take, skybridge and rail upkeep (§11 onMonth 6). */
  private refreshLedger(): void {
    const w = this.world;
    const st = w.story;
    const L = w.ledger;
    L.income.length = 0;
    L.expense.length = 0;
    const byLabel = new Map<string, number>();
    for (const inc of st.incomes) if (inc.until > w.tick) byLabel.set(inc.label, (byLabel.get(inc.label) ?? 0) + inc.perMonth);
    if (!endingRules(w)?.endOffLedger) {
      let off = turf.pactCut(w);
      for (const b of w.buildings.values()) if (b.type === 'tidemarket' && b.powered && b.offline <= 0) off += 250;
      if (off > 0) byLabel.set('Off-ledger', (byLabel.get('Off-ledger') ?? 0) + off);
    }
    for (const [label, v] of byLabel) {
      const amount = Math.round(Math.abs(v));
      if (!amount) continue;
      (v > 0 ? L.income : L.expense).push({ label, amount });
    }
    const up = vertical.upkeep(w);
    if (up.skybridges > 0) L.expense.push({ label: 'Skybridges', amount: Math.round(up.skybridges) });
    if (up.rail > 0) L.expense.push({ label: 'Ribbon Rail', amount: Math.round(up.rail) });
  }

  // ── Whispers, callbacks and MOTH notes (§7.9) ─────────────────────────────

  private deliverWhispers(): void {
    const w = this.world;
    const st = w.story;
    for (let k = st.queue.length - 1; k >= 0; k--) {
      const q = st.queue[k];
      if (q.tick > w.tick) continue;
      const c = this.idx.cards.get(q.card);
      if (!c || c.kind !== 'whisper') continue;
      st.queue.splice(k, 1);
      st.seen[c.id] = w.tick;
      st.log.push({ tick: w.tick, card: c.id, choice: null });
      w.addNews(fillTokens(w, c.body), 'flavor');
      this.markChanged();
    }
    if (st.log.length > P.logKeep) st.log.splice(0, st.log.length - P.logKeep);
  }

  private ambient(): void {
    const w = this.world;
    const st = w.story;
    const awake = st.chapter > 1 || st.phase !== 'waiting';
    if (!awake) return;
    // Whispers every 60 d: the visible faction whose standing moved most since the last one.
    if (w.tick - st.lastWhisperTick >= P.whisperEvery && isUnlocked(w, 'comms')) {
      st.lastWhisperTick = w.tick;
      let best: FactionId | null = null;
      let move = -1;
      const now = standings(w);
      for (const f of FACTION_IDS) {
        if (!isActive(w, f) || !this.idx.whispers[f]) continue;
        const d = Math.abs(now[f] - (st.whisperSnap[f] ?? 0));
        if (d > move) {
          move = d;
          best = f;
        }
      }
      st.whisperSnap = { ...now };
      if (best) {
        const band = whisperBand(now[best]);
        const line = this.idx.whispers[best]![band];
        if (line) {
          st.log.push({ tick: w.tick, card: `wh:${best}:${band}`, choice: null });
          if (st.log.length > P.logKeep) st.log.splice(0, st.log.length - P.logKeep);
          w.addNews(fillTokens(w, line), 'flavor');
          this.markChanged();
        }
      }
    }
    // MOTH notes every 45 d, rotating from noteIdx.
    const notes = this.idx.notes;
    if (notes.length && w.tick - st.lastNoteTick >= P.noteEvery) {
      st.lastNoteTick = w.tick;
      for (let k = 0; k < notes.length; k++) {
        const j = (st.noteIdx + k) % notes.length;
        const note = notes[j];
        if (!evalCond(w, note.when) || (note.log !== undefined && !st.logs.includes(note.log))) continue;
        st.noteIdx = (j + 1) % notes.length;
        w.addNews(this.fillNote(note.text), 'flavor');
        break;
      }
    }
  }

  private fillNote(text: string): string {
    const w = this.world;
    let lit = 0;
    let worst = -1;
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i];
      if (t.road) lit++;
      if (t.zone && t.level > 0 && !t.abandoned && (worst < 0 || w.fields.crime[i] > w.fields.crime[worst])) worst = i;
    }
    return fillTokens(w, text, worst, {
      lit: num(lit),
      dark: num(w.stats.unpoweredTiles),
      pop: num(w.stats.population),
      crime: String(Math.round((worst >= 0 ? w.fields.crime[worst] : 0) * 100)),
      trace: String(Math.round(w.story.trace)),
      n: num(150 * w.vertical.metrics.skybridges),
    });
  }

  // ── Mods, visual, dirty ───────────────────────────────────────────────────

  /** Re-resolve mods and rebuild the view (WP-C calls it after a crackdown, pact or stage change). */
  markDirty(): void {
    writeLocals(this.world);
    this.refreshMods();
    this.refreshLedger();
    this.refreshVisual();
    this.markChanged();
  }

  /** The view changed: drop the cache and tell the UI. */
  private markChanged(): void {
    this.cached = null;
    this.world.events.emit('story');
  }

  /** world.mods ← resolveMods; world.layers ← composeLayers(layerParts). */
  private refreshMods(): void {
    this.world.mods = resolveMods(this.world);
    composeLayers(this.world);
  }

  private refreshVisual(): void {
    const w = this.world;
    const st = w.story;
    const v = this.visual;
    const rules = endingRules(w);
    v.traceFlicker = st.flags.traceFrozen || rules?.retireTrace ? 0 : Math.max(0, Math.min(1, st.trace / TRACE.max));
    v.palette = st.ending ? (st.endingVariant ?? st.ending) : null;
    v.candles =
      st.endingVariant === 'lamplight' ? 1 : st.flags.tuningActive ? Math.max(0, Math.min(1, standing(w, 'tuning') / 60)) : 0;
    v.lureCold = st.flags.lure === 'running';
    v.revealed = st.revealed;
    v.mural = !!st.flags.mural;
    let n = 0;
    for (const c of st.crackdowns) {
      if (c.until < w.tick) continue;
      const z = v.crackdowns[n] ?? (v.crackdowns[n] = { x: 0, y: 0, r: 0 });
      z.x = c.x;
      z.y = c.y;
      z.r = c.r;
      n++;
    }
    v.crackdowns.length = n;
  }

  // ── Content helpers ───────────────────────────────────────────────────────

  private knownCard(id: string): boolean {
    if (id.startsWith(REWARD_PREFIX)) return this.idx.chapters.has(Number(id.slice(REWARD_PREFIX.length)));
    return this.idx.cards.has(id);
  }

  /** The card for an open / queued id (chapter rewards resolve to their Silt Log card). */
  private cardFor(id: string): Card | undefined {
    if (id.startsWith(REWARD_PREFIX)) {
      const ch = this.idx.chapters.get(Number(id.slice(REWARD_PREFIX.length)));
      const log = ch ? this.idx.logCards.get(ch.log) : undefined;
      if (!ch) return undefined;
      return log
        ? { ...log, id, sys: ch.rewardSys || log.sys }
        : { id, kind: 'log', speaker: 'moth', title: ch.title, sys: ch.rewardSys, body: ch.epigraph, choices: [] };
    }
    return this.idx.cards.get(id);
  }

  private choicesOf(card: Card): readonly Choice[] {
    return card.choices.length ? card.choices : [CONTINUE];
  }

  // ── View (§10.9) ──────────────────────────────────────────────────────────

  /** Cached plain-data view for the UI, every token filled. */
  view(): StoryView {
    return (this.cached ??= this.buildView());
  }

  private buildView(): StoryView {
    const w = this.world;
    const st = w.story;
    const ch = this.chapterDef();
    const rules = endingRules(w);
    return {
      chapter: this.chapterView(ch),
      goals: this.goalsView(ch),
      countdownDays: st.countdownEnd !== null ? Math.max(0, st.countdownEnd - w.tick) : null,
      claims: st.chapter >= 6 || this.charterOpen ? this.claimsView() : [],
      factions: FACTION_IDS.map((f) => this.factionView(f)),
      trace: {
        value: Math.round(st.trace),
        revealed: st.revealed,
        frozen: !!st.flags.traceFrozen,
        retired: !!rules?.retireTrace,
      },
      card: st.open ? this.cardView(st.open.card, st.open.spot) : null,
      pending: this.pendingView(),
      banner: this.banner ? { id: this.banner.id, title: this.banner.title, faction: this.banner.faction } : null,
      comms: this.commsView(),
      logs: this.logsView(),
      coherence: coherenceFor(st.logs.length),
      unlocked: {
        factions: isUnlocked(w, 'factions'),
        comms: isUnlocked(w, 'comms'),
        turfOverlay: isUnlocked(w, 'turfOverlay'),
      },
      ending: st.ending
        ? {
            id: st.ending,
            variant: st.endingVariant,
            keyChoices: Object.entries(st.keyChoices).map(([card, choice]) => ({ card, choice })),
          }
        : null,
      titleCard:
        this.titleUntil >= 0 && ch
          ? {
              numeral: CHAPTER_NUMERALS[st.chapter] ?? '',
              title: ch.title,
              epigraph: fillTokens(w, ch.epigraph),
              question: ch.question,
              coherence: coherenceFor(st.logs.length),
            }
          : null,
    };
  }

  private chapterView(ch: Chapter | undefined): StoryView['chapter'] {
    const st = this.world.story;
    const out: StoryView['chapter'] = {
      n: st.chapter,
      numeral: CHAPTER_NUMERALS[st.chapter] ?? '',
      title: ch?.title ?? (st.chapter >= 7 ? 'Epilogue' : ''),
      question: ch?.question ?? '',
      phase: st.phase,
    };
    // Settling: every goal, required beat and queued optional beat done, only the
    // chapter floor holds it open (the same gates as checkComplete, in that order).
    if (ch && st.phase === 'active' && st.chapter < 6 && !this.chapterSettled() && this.beatsDone(ch)) {
      const goalsDone = ch.goals.every((g) => st.goalsDone.includes(g.id) || st.goalsWaived.includes(g.id));
      const owed = st.queue.some((q) => this.idx.beatChapter.get(q.card) === ch.n);
      if (goalsDone && !owed) out.closesInSec = this.closesIn();
    }
    return out;
  }

  /** Whole unpaused seconds until the chapter floor lets the chapter close (≥ 1). */
  private closesIn(): number {
    return Math.max(1, Math.ceil(P.chapterMinSec - (this.world.story.chapterSec ?? 0)));
  }

  /** Memo key for rows that only change with the log (and the patron, which titles may name). */
  private memoKey(n: number, head?: { tick: number; card: string }, last?: { tick: number; card: string; choice?: number | null; auto?: boolean }): string {
    const tail = last ? `${last.tick}|${last.card}|${last.choice ?? ''}|${last.auto ? 1 : 0}` : '';
    return `${n}|${head ? `${head.tick}|${head.card}` : ''}|${tail}|${patronOf(this.world)}`;
  }

  private commsView(): StoryView['comms'] {
    const log = this.world.story.log;
    const key = this.memoKey(log.length, log[0], log[log.length - 1]);
    if (this.commsMemo?.key !== key) this.commsMemo = { key, rows: log.map((e) => this.commsRow(e)) };
    return this.commsMemo.rows;
  }

  private logsView(): StoryView['logs'] {
    const logs = this.world.story.logs;
    const key = `${logs.join(',')}|${patronOf(this.world)}|${this.world.cityName}`;
    if (this.logsMemo?.key !== key) this.logsMemo = { key, rows: Array.from({ length: 12 }, (_, k) => this.logRow(k + 1)) };
    return this.logsMemo.rows;
  }

  private goalsView(ch: Chapter | undefined): StoryView['goals'] {
    if (!ch || this.world.story.phase === 'waiting') return [];
    const w = this.world;
    const st = w.story;
    return ch.goals.map((g) => {
      const done = st.goalsDone.includes(g.id);
      const waived = st.goalsWaived.includes(g.id);
      const out = { id: g.id, label: g.label, done: done || waived, waived, now: '', need: '', progress: 0 };
      const hold = findHold(g.cond);
      const simple = firstMetric(g.cond);
      if (hold && !g.show) {
        const held = Math.min(hold.days, st.holds[hold.key] ?? 0);
        out.now = `${held}/${hold.days} days`;
        out.need = `${hold.days} days`;
        out.progress = held / hold.days;
      } else if (g.show || simple) {
        const m = g.show?.m ?? simple!.m;
        const target = g.show?.target ?? simple!.v;
        const fmt: MetricFmt = g.show?.fmt ?? metricFmt(m);
        const op = simple && simple.m === m ? simple.op : '>=';
        const v = metric(w, m);
        const atMost = op === '<=' || op === '<';
        out.now = formatMetricVs(v, target, fmt, atMost);
        out.need = `${atMost ? '≤' : '≥'} ${formatMetric(target, fmt)}`;
        out.progress = atMost ? (v <= target ? 1 : target > 0 ? Math.max(0, Math.min(1, target / v)) : 0) : target > 0 ? Math.max(0, Math.min(1, v / target)) : 1;
      } else {
        out.now = done ? '✓' : '✗';
      }
      if (done || waived) out.progress = 1;
      if (waived) out.now = 'waived';
      return out;
    });
  }

  private claimsView(): StoryView['claims'] {
    const w = this.world;
    return this.idx.endings.map((e) => {
      const rows = e.claims.map((c) => {
        const ok = evalCond(w, c.cond);
        const row: { label: string; ok: boolean; gap?: string } = { label: fillTokens(w, c.label), ok };
        if (c.show) {
          const fmt = metricFmt(c.show.m);
          row.gap = `${formatMetricVs(metric(w, c.show.m), c.show.target, fmt)} / ${formatMetric(c.show.target, fmt)}`;
        }
        return row;
      });
      return { id: e.id, title: e.title, becomes: e.becomes, ok: e.id === 'quiet' || rows.every((r) => r.ok), rows };
    });
  }

  private factionView(f: FactionId): StoryView['factions'][number] {
    const w = this.world;
    const st = w.story;
    const def = this.idx.factions[f];
    const shown = shownState(w, f);
    const s = standing(w, f);
    const t: Tier = tier(w, f);
    const visible = shown === 'yes';
    const retired = isRetired(w, f);
    const rules = endingRules(w);
    const row: StoryView['factions'][number] = {
      id: f,
      name: visible ? (def?.name ?? FACTION_LABELS[f].name) : '???',
      leader: visible ? (def?.leader ?? '') : shown === 'silhouette' ? 'lamps in windows' : '',
      callsYou: visible ? (def?.callsYou ?? '') : '',
      shown,
      tier: t,
      standing: visible ? s : 0,
      power: f === 'tuning' || (def && !def.inPowerBar) ? null : Math.round(powerShare(w, f)),
      drivers: visible
        ? moodDrivers(w, f)
            .map((d) => ({ label: d.label, value: Math.round(d.value) + 0 }))
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        : [],
      deal: visible && def?.deal ? this.dealView(f) : null,
      salt: visible ? this.saltView(f) : null,
      nudge: visible && rules?.nudge ? this.actionView('Nudge', 0, this.nudgeReason(f), [{ k: 'favor', f, dir: 1, pips: 2 }], st.nudgeReady - w.tick) : null,
      exclusive: null,
      penalties: visible ? this.penalties(f) : [],
    };
    if (visible && def?.exclusive) {
      const reason = lockedReason(w, def.exclusive);
      row.exclusive = { type: def.exclusive, buildable: !reason, ...(reason ? { reason } : {}) };
    }
    if (retired) row.retiredLabel = rules?.retiredLabel ?? 'Retired';
    if (st.chapter >= 6 && visible) {
      const e = this.idx.ending.get(FACTION_ENDING[f]);
      if (e) {
        const miss = e.id === 'quiet' ? undefined : e.claims.find((c) => !evalCond(w, c.cond));
        let gap = '';
        if (miss?.show) gap = ` ${formatMetricVs(metric(w, miss.show.m), miss.show.target, metricFmt(miss.show.m))} / ${formatMetric(miss.show.target, metricFmt(miss.show.m))}`;
        row.claim = miss ? `${e.title}: ${fillTokens(w, miss.label)}${gap}` : `${e.title}: every claim holds`;
      }
    }
    return row;
  }

  private actionView(label: string, cost: number, reason: string | null, hints: ActionView['hints'], cooldown = 0): ActionView {
    const v: ActionView = { label, cost, enabled: !reason, hints };
    if (reason) v.reason = reason;
    if (cooldown > 0) v.cooldownDays = cooldown;
    return v;
  }

  private dealView(f: FactionId): ActionView {
    const w = this.world;
    const deal = this.idx.factions[f]!.deal!;
    const d = w.story.deals[deal.id];
    const cd = d && d.cooldownUntil > w.tick && d.until <= w.tick ? d.cooldownUntil - w.tick : 0;
    const v = this.actionView(fillTokens(w, deal.name), this.dealCost(deal.fx), this.dealReason(f), hintsFor(w, deal.fx), cd);
    return v;
  }

  private saltView(f: FactionId): ActionView {
    const w = this.world;
    const ready = w.story.saltReady[f] ?? 0;
    return this.actionView(
      'Send salt',
      this.saltCost(),
      this.saltReason(f),
      [
        { k: 'favor', f, dir: 1, pips: 1 },
        { k: 'trace', v: SALT.trace },
      ],
      ready - w.tick,
    );
  }

  /** Active penalty chips, e.g. "Cold: build costs ×1.15". */
  private penalties(f: FactionId): string[] {
    const out: string[] = [];
    const gang = f === 'undertow' || f === 'kites';
    for (const t of tierPatches(this.world)) {
      if (t.f !== f || t.kind === 'perk') continue;
      const text = describePatch(t.patch);
      if (t.kind === 'cold') out.push(`Cold: ${text || (gang ? 'turf spreads ×1.5' : 'no deals')}`);
      else if (text) out.push(`Hostile: ${text}`);
    }
    return out;
  }

  private cardView(id: string, spot: number): CardView | null {
    const w = this.world;
    const st = w.story;
    const card = this.cardFor(id);
    if (!card) return null;
    const f = cardFaction(w, card);
    let body = fillTokens(w, card.body, spot);
    if (card.kind === 'ending' && st.endingVariant === 'lamplight') {
      const v = this.idx.ending.get(st.ending ?? 'quiet')?.rules.variant;
      const extra = v && v.card !== card.id ? this.idx.cards.get(v.card) : undefined;
      if (extra && this.idx.ending.get(st.ending!)?.card === card.id) body += `\n\n${fillTokens(w, extra.body, spot)}`;
    }
    const pending = st.pending?.card === id ? st.pending : null;
    const view: CardView = {
      id,
      kind: card.kind,
      faction: f,
      speakerName: this.speakerName(card, f),
      title: fillTokens(w, card.title, spot),
      body,
      canLater: card.kind === 'faction' && !!pending,
      choices: this.choicesOf(card).map((c) => {
        const locked = c.requires && !evalCond(w, c.requires) ? fillTokens(w, c.lockedHint ?? 'Not available', spot) : undefined;
        return {
          label: fillTokens(w, c.label, spot),
          hints: hintsFor(w, c.fx),
          effectsText: effectsText(w, c.fx),
          ...(locked ? { locked } : {}),
          isDefault: !!c.default,
        };
      }),
    };
    if (card.with) view.with = card.with;
    if (card.sys) view.sys = fillTokens(w, card.sys, spot);
    if (pending) {
      view.autoInDays = Math.max(0, P.pendingDays - (w.tick - pending.tick));
      view.autoInSec = Math.max(0, Math.ceil(P.pendingMinSec - this.pendingSec));
    }
    return view;
  }

  private speakerName(card: Card, f: FactionId | null): string {
    if (card.name) return fillTokens(this.world, card.name);
    if (f) return this.idx.factions[f]?.leader ?? FACTION_LABELS[f].name;
    if (card.speaker === 'moth') return 'MOTH';
    if (card.speaker === 'lure') return 'LURE';
    return 'System';
  }

  private pendingView(): StoryView['pending'] {
    const w = this.world;
    const p = w.story.pending;
    if (!p) return null;
    const card = this.idx.cards.get(p.card);
    if (!card) return null;
    return {
      id: p.card,
      title: fillTokens(w, card.title, p.spot),
      faction: cardFaction(w, card) ?? 'board',
      daysLeft: Math.max(0, P.pendingDays - (w.tick - p.tick)),
      secLeft: Math.max(0, Math.ceil(P.pendingMinSec - this.pendingSec)),
    };
  }

  private commsRow(e: StoryState['log'][number]): StoryView['comms'][number] {
    const w = this.world;
    const row: StoryView['comms'][number] = { tick: e.tick, date: dateOf(e.tick), card: e.card, title: '', choice: null, auto: !!e.auto };
    if (e.card.startsWith('wh:')) {
      const [, f, band] = e.card.split(':') as [string, FactionId, 'warm' | 'neutral' | 'cold'];
      row.title = FACTION_LABELS[f]?.short ?? f;
      row.whisper = fillTokens(w, this.idx.whispers[f]?.[band] ?? '');
      return row;
    }
    const card = this.cardFor(e.card);
    if (!card) return row;
    row.title = fillTokens(w, card.title);
    if (card.kind === 'whisper') {
      row.whisper = fillTokens(w, card.body);
      return row;
    }
    if (e.choice !== null && card.choices[e.choice]) row.choice = fillTokens(w, card.choices[e.choice].label);
    return row;
  }

  private logRow(n: number): StoryView['logs'][number] {
    const w = this.world;
    const owned = w.story.logs.includes(n);
    const card = this.idx.logCards.get(n);
    let source = `Chapter ${CHAPTER_NUMERALS[n] ?? n}`;
    if (n > 6) {
      const star = this.idx.starCards.get(n);
      const f = star ? cardFaction(w, star) : null;
      source = f ? `${short(f)} ★` : '★';
    }
    const row: StoryView['logs'][number] = {
      n,
      owned,
      source,
      title: card ? fillTokens(w, card.title) : `SILT LOG ${String(n).padStart(2, '0')}`,
    };
    if (owned && card) row.body = fillTokens(w, card.body);
    return row;
  }

  /** Tick a log card id would carry (for tests and tools). */
  static logCardId(n: number): string {
    return logId(n);
  }
}

/** Silt Log number from a card id (`log.07` → 7). Re-exported for UI convenience. */
export { logNumber };
