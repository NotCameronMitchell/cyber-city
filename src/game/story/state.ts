// ─────────────────────────────────────────────────────────────────────────────
// Default story state and empty runtime caches (docs/STORY.md §10.8).
// A leaf module: only config and types, so world.ts can build its defaults
// without importing director, turf or vertical logic.
// Owner: WP-B (save). decodeStory deep-merges saved state over newStoryState().
// ─────────────────────────────────────────────────────────────────────────────

import { COHERENCE, START_FAVOR } from '../config';
import { MAP_SIZE } from '../types';
import type { StoryLedger, StoryState, StoryView, TurfMap, TurfStats, VerticalCache, VerticalMetrics } from './types';

const AREA = MAP_SIZE * MAP_SIZE;

/** Sentinel for "never happened" ticks: `tick − NEVER_TICK` is always ≥ 99,999. */
export const NEVER_TICK = -100000;

/** Chapter numerals for display (index = chapter number; 7 = epilogue). */
export const CHAPTER_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/** Fresh story for a new city (or a migrated v1 save): chapter 1, waiting. */
export function newStoryState(seed: number): StoryState {
  return {
    v: 1,
    chapter: 1,
    phase: 'waiting',
    chapterTick: 0,
    waitingSince: 0,
    beatsShown: [],
    goalsDone: [],
    goalsWaived: [],
    holds: {},
    favor: { ...START_FAVOR },
    floors: {},
    ceils: {},
    trace: 0,
    revealed: false,
    traceRaisedThisMonth: false,
    logs: [],
    flags: {},
    unlocks: [],
    seen: {},
    queue: [],
    pending: null,
    open: null,
    mods: [],
    incomes: [],
    locals: [],
    credits: [],
    pacts: [],
    deals: {},
    crackdowns: [],
    precinctReady: {},
    saltReady: {},
    builtCounts: {},
    lastCardTick: NEVER_TICK,
    lastHostileTick: NEVER_TICK,
    lastHostileBy: {},
    lastPulseBy: {},
    lastSpeaker: null,
    lastBeatTick: NEVER_TICK,
    gangActions: 0,
    lastCrackdownTick: NEVER_TICK,
    railOut: [],
    countdownEnd: null,
    ending: null,
    endingVariant: null,
    endingTick: null,
    nextReview: null,
    nudgeReady: 0,
    keyChoices: {},
    whisperSnap: {},
    lastWhisperTick: 0,
    lastNoteTick: 0,
    noteIdx: 0,
    log: [],
    rng: ((seed >>> 0) ^ 0x5eed5107) >>> 0 || 0x9e3779b9,
    seam: null,
  };
}

export function emptyTurfStats(): TurfStats {
  return {
    tiles: { undertow: 0, kites: 0 },
    secured: { undertow: 0, kites: 0 },
    strongest: { undertow: -1, kites: -1 },
    contested: 0,
  };
}

/** No turf, nobody seeded. */
export function emptyTurf(): TurfMap {
  return {
    owner: new Uint8Array(AREA),
    str: new Uint8Array(AREA),
    contested: new Uint8Array(AREA),
    frozenUntil: 0,
    seeded: { undertow: false, kites: false },
    lowSince: { undertow: -1, kites: -1 },
    stats: emptyTurfStats(),
  };
}

export function emptyVerticalMetrics(): VerticalMetrics {
  return {
    stacksStage2: 0,
    stacksStage3: 0,
    crowns: { foundry: 0, glare: 0, nest: 0, commons: 0 },
    skybridges: 0,
    railTiles: 0,
    railMaxStations: 0,
    railOnTurf: { undertow: 0, kites: 0 },
  };
}

/** No live rail, no active links. */
export function emptyVertical(): VerticalCache {
  return {
    version: 0,
    activeLinks: new Set(),
    railLive: new Uint8Array(AREA),
    liveStations: new Set(),
    metrics: emptyVerticalMetrics(),
  };
}

export function emptyLedger(): StoryLedger {
  return { income: [], expense: [] };
}

/** Coherence % for a number of owned Silt Logs (§1.3). */
export function coherenceFor(logs: number): number {
  return Math.min(COHERENCE.max, COHERENCE.base + COHERENCE.perLog * logs);
}

/** A valid StoryView with nothing in it (stub director, tests, UI previews). */
export function emptyStoryView(story?: Pick<StoryState, 'chapter' | 'phase' | 'trace' | 'revealed' | 'logs'>): StoryView {
  const n = story?.chapter ?? 1;
  return {
    chapter: { n, numeral: CHAPTER_NUMERALS[n] ?? '', title: '', question: '', phase: story?.phase ?? 'waiting' },
    goals: [],
    countdownDays: null,
    claims: [],
    factions: [],
    trace: { value: story?.trace ?? 0, revealed: story?.revealed ?? false, frozen: false, retired: false },
    card: null,
    pending: null,
    banner: null,
    comms: [],
    logs: [],
    coherence: coherenceFor(story?.logs.length ?? 0),
    unlocked: { factions: false, comms: false, turfOverlay: false },
    ending: null,
    titleCard: null,
  };
}
