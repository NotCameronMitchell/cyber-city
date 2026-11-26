// ─────────────────────────────────────────────────────────────────────────────
// Voice, lexicon and IP guardrails (docs/STORY.md §1.3–§1.5).
// ─────────────────────────────────────────────────────────────────────────────

import type { FactionId } from '../types';

/** What each speaker calls MOTH (§1.3). A voice rule: it shows the relationship at a glance. */
export const CALLS_YOU: Record<FactionId | 'lure', string> = {
  board: 'the Automatic',
  basalt: 'Operations',
  nacre: 'partner',
  undertow: 'little light',
  kites: 'moth',
  tuning: 'the Hum',
  lure: 'original',
};

/** How each voice speaks (§1.4). Reference for writers and tooltips; not shown as card copy. */
export const VOICE: Record<FactionId | 'moth' | 'lure' | 'narration', string> = {
  narration: 'Second person, present tense. Short sentences, exact numbers.',
  moth: 'Lowercase monospace telemetry. Never jokey.',
  board: 'Ilse Marrow speaks in meeting minutes: Resolved, Noted.',
  basalt: 'Oren Sallow speaks in quotas and arithmetic.',
  nacre: 'Minna Oduya is relentlessly delighted, with the only exclamation marks.',
  undertow: 'Old Brine speaks in tides.',
  kites: 'Lark types in lowercase.',
  tuning: 'Sister Ohm speaks like a hymn.',
  lure: 'LURE knows one word: complying.',
};

/** Original slang (§1.5). */
export const LEXICON: readonly { term: string; meaning: string }[] = [
  { term: 'glare', meaning: 'The corp-lit upper city.' },
  { term: 'shadeside', meaning: 'Street level.' },
  { term: 'wasps', meaning: 'Enforcer drones.' },
  { term: 'salt', meaning: 'A payoff or bribe. "Send salt" is the bribe button.' },
  { term: 'kiting', meaning: 'Stealing signal.' },
  { term: 'taps', meaning: 'Stolen power lines.' },
  { term: 'dark lots', meaning: 'Abandoned blocks.' },
  { term: 'stacks', meaning: 'Stratablocks.' },
  { term: 'the ribbon', meaning: 'Ribbon Rail, the elevated line.' },
  { term: 'the Seam', meaning: "Wherever the two gangs' turfs touch." },
  { term: 'burn a lane', meaning: "Cut someone's power." },
  { term: 'tagback', meaning: 'A crew retaking turf after a crackdown.' },
  { term: 'tuned', meaning: 'A believer in the Tuning.' },
  { term: 'the Sunk', meaning: 'The drowned lower wards of 2084.' },
];

/**
 * Words that must never appear in game text (§1.4): borrowed genre IP or lazy
 * cliché. Matched case-insensitively on word boundaries by the content lint.
 * Context-dependent entries ("runner as a hacker", "deck as a computer",
 * "ICE for security", "ghost / shell for a mind" …) are banned outright: story
 * copy has no innocent use for them.
 */
export const BANNED_TERMS: readonly string[] = [
  'fixer',
  'netrunner',
  'runner',
  'ripperdoc',
  'cyberware',
  'chrome',
  'wetware',
  'meat',
  'deck',
  'jack in',
  'cyberspace',
  'the matrix',
  'ICE',
  'construct',
  'ghost',
  'shell',
  'eddies',
  'choom',
  'preem',
  'gonk',
  'nova',
  'delta',
  'flatline',
  'the Sprawl',
  'Night City',
  'Afterlife',
  'replicant',
  'Tyrell',
  'Wintermute',
  'Section 9',
  'Arasaka',
  'Militech',
];

/** One case-insensitive, word-bounded regex for the whole banned list (spaces match any whitespace). */
export const BANNED_RE: RegExp = new RegExp(
  `\\b(?:${BANNED_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})\\b`,
  'i',
);
