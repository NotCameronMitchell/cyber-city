// ─────────────────────────────────────────────────────────────────────────────
// Whisper callbacks (docs/STORY.md §7.9): whisper-kind cards with no choices.
// The choice that sets the flag also queues the callback, which is delivered
// as a whisper (COMMS log + ticker) on its due day, without deck gates.
// ─────────────────────────────────────────────────────────────────────────────

import type { Card } from '../../types';
import { card } from '../dsl';

/** `brief` is the plain-language line shown with the whisper in COMMS (≤ 220 chars). */
const whisper = (id: string, body: string, brief: string): Card =>
  card({ id, kind: 'whisper', speaker: 'kites', name: 'lark', title: 'WHISPER', queuedOnly: true, body, brief, choices: [] });

export const WHISPER_CARDS: readonly Card[] = [
  // kt.door, flag fen=jailed, +360 d.
  whisper(
    'wh.fenJailed',
    "lark: 'visited fen today. he asked who locked the door. i didn't say.'",
    "A note from Lark of the Glass Kites. Fen, the boy you left locked up, is still inside. He asked who kept the door shut, and she didn't tell him it was you.",
  ),
  // kt.door, flag fen=free, +180 d.
  whisper(
    'wh.fenFree',
    "lark: 'fen's flying kites off the ribbon now. idiot. thank you.'",
    'A note from Lark of the Glass Kites. Fen, the boy you freed, is out flying kites again. This is her way of saying thank you.',
  ),
  // ch1.lark, flag clerkLie, +180 d.
  whisper(
    'wh.clerk',
    "lark: 'board clerks don't ping back at 02:17, moth. nice try.'",
    'A note from Lark of the Glass Kites. She never believed you were a Board clerk: no clerk answers from the dead pump channel in the middle of the night.',
  ),
];
