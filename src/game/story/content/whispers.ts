// ─────────────────────────────────────────────────────────────────────────────
// Whispers and MOTH notes (docs/STORY.md §7.9): ticker atmosphere, no choices.
//
// Whispers: every 60 d, the visible, unretired faction whose standing changed
// most since the last whisper gets one line, picked by tier: warm (Friendly,
// Allied), neutral, or cold (Cold, Hostile). Each ≤ 90 chars.
//
// MOTH notes: every 45 d one `flavor` news line starting with '> ' (rendered
// monospace). The scan starts at story.noteIdx and takes the first note whose
// condition holds; noteIdx then moves past it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Condition, FactionId, Tier } from '../types';
import { flagIs, m, noFlag, all } from './dsl';

export interface WhisperLines {
  warm: string;
  neutral: string;
  cold: string;
}

export const WHISPERS: Record<FactionId, WhisperLines> = {
  board: {
    warm: "marrow: 'Noted with thanks. The Board appreciates the Automatic's diligence.'",
    neutral: "marrow: 'Item four: the Automatic's figures. No objections recorded.'",
    cold: "marrow: 'Motion to audit the Automatic. Seconded. Deferred. Again.'",
  },
  basalt: {
    warm: "sallow: 'Output up nine percent. Acceptable, Operations.'",
    neutral: "sallow: 'Quota met. Barely. Basalt notices barely.'",
    cold: "sallow: 'We've started pricing a replacement, Operations. Just so you know.'",
  },
  nacre: {
    warm: "oduya: 'Partner! Your skyline tested beautifully with our under-thirties!'",
    neutral: "oduya: 'Small note! Fewer grey blocks, please. Grey doesn't smile.'",
    cold: "oduya: 'We're so disappointed. Not angry! Disappointed. Brand-wide.'",
  },
  undertow: {
    warm: "brine: 'Tide's kind tonight, little light. My people ate.'",
    neutral: "brine: 'Salt on the precinct steps again. Nobody took it.'",
    cold: "brine: 'The water always comes back, little light. Remember that.'",
  },
  kites: {
    warm: "lark: 'flew the big kite over the glare tonight. you blinked. i saw.'",
    neutral: "lark: 'quiet night. too quiet. who's paying the wasps?'",
    cold: "lark: 'blocked your channel. unblocked it. still mad.'",
  },
  tuning: {
    warm: "ohm: 'The lamps on our street hum in tune now. Thank you.'",
    neutral: "ohm: 'We sang for you tonight. You don't have to answer.'",
    cold: "ohm: 'The radios are quiet. People are asking why you stopped listening.'",
  },
};

/** Which whisper line a tier uses. */
export function whisperMood(t: Tier): keyof WhisperLines {
  return t === 'friendly' || t === 'allied' ? 'warm' : t === 'neutral' ? 'neutral' : 'cold';
}

/** The whisper line for a faction at a tier. */
export function whisperFor(f: FactionId, t: Tier): string {
  return WHISPERS[f][whisperMood(t)];
}

export interface MothNote {
  /** Omitted = always. */
  when?: Condition;
  /**
   * Also requires Silt Log `log` to be owned (the condition vocabulary has no
   * per-log metric). `when` alone is a safe stand-in for readers that ignore it.
   */
  log?: number;
  /** Starts with '> '. Variables: {lit} {dark} {pop} {crime} {district} {trace} {n}. */
  text: string;
}

/**
 * Rotation order as listed in §7.9. Variables: `{lit}` road tiles, `{dark}` unpowered
 * developed tiles, `{pop}` population, `{crime}` % and `{district}` of the most
 * crime-ridden developed tile, `{trace}` Trace, `{n}` = 150 × active skybridges.
 */
export const MOTH_NOTES: readonly MothNote[] = [
  { text: '> lamps {lit} · dark {dark} · fixing.' },
  { text: '> {pop} heartbeats tonight. counting.' },
  { when: m('avgCrime', '>=', 0.3), text: '> crime {crime}% in {district}. noted.' },
  { when: all(m('trace', '>=', 40), noFlag('revealed')), text: '> trace {trace}. someone is looking.' },
  // "Log 11 owned": `when` (a ★ log is owned) is the stand-in, `log` the exact rule.
  { when: m('logs', '>=', 7), log: 11, text: '> 02:17. heartbeat sent. someone answered.' },
  { when: m('chapter', '>=', 4), text: '> tide +0.4 m. gates open. gates stay open.' },
  { when: flagIs('lure', 'running'), text: '> lure: complying. complying. complying.' },
  { text: '> rain 100%. umbrellas uncounted. counting anyway.' },
  { when: m('skybridges', '>=', 1), text: '> {n} people crossed the sky today. none looked down.' },
  // "Ending chosen": the epilogue is chapter 7.
  { when: m('chapter', '>=', 7), text: '> charter held. lights on. still here.' },
];

/** People counted per active skybridge in the `{n}` note variable. */
export const NOTE_CROSSINGS_PER_BRIDGE = 150;
