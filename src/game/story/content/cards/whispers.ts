// ─────────────────────────────────────────────────────────────────────────────
// Whisper callbacks (docs/STORY.md §7.9): whisper-kind cards with no choices.
// The choice that sets the flag also queues the callback, which is delivered
// as a whisper (COMMS log + ticker) on its due day, without deck gates.
// ─────────────────────────────────────────────────────────────────────────────

import type { Card } from '../../types';
import { card } from '../dsl';

const whisper = (id: string, body: string): Card =>
  card({ id, kind: 'whisper', speaker: 'kites', name: 'lark', title: 'WHISPER', queuedOnly: true, body, choices: [] });

export const WHISPER_CARDS: readonly Card[] = [
  // kt.door, flag fen=jailed, +360 d.
  whisper('wh.fenJailed', "lark: 'visited fen today. he asked who locked the door. i didn't say.'"),
  // kt.door, flag fen=free, +180 d.
  whisper('wh.fenFree', "lark: 'fen's flying kites off the ribbon now. idiot. thank you.'"),
  // ch1.lark, flag clerkLie, +180 d.
  whisper('wh.clerk', "lark: 'board clerks don't ping back at 02:17, moth. nice try.'"),
];
