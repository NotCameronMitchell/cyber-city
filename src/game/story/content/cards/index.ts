// ─────────────────────────────────────────────────────────────────────────────
// Card registry: every story card by id, and the faction deck: STORY.md §7's 43 cards
// plus the 11 expansion cards (docs/EXPANSION.md §8.3).
// ─────────────────────────────────────────────────────────────────────────────

import type { Card, FactionId } from '../../types';
import { BASALT_CARDS } from './basalt';
import { BEAT_CARDS } from './beats';
import { BOARD_CARDS } from './board';
import { ENDING_CARDS, EPILOGUE_CARDS } from './endings';
import { EXPANSION_CARDS } from './expansion';
import { KITES_CARDS } from './kites';
import { LOG_CARDS } from './logs';
import { MULTI_CARDS, SYSTEM_CARDS } from './multi';
import { NACRE_CARDS } from './nacre';
import { TUNING_CARDS } from './tuning';
import { UNDERTOW_CARDS } from './undertow';
import { WHISPER_CARDS } from './whispers';

export { BASALT_CARDS, BEAT_CARDS, BOARD_CARDS, ENDING_CARDS, EPILOGUE_CARDS, EXPANSION_CARDS, KITES_CARDS, LOG_CARDS };
export { MULTI_CARDS, NACRE_CARDS, SYSTEM_CARDS, TUNING_CARDS, UNDERTOW_CARDS, WHISPER_CARDS };
export { SILT_LOGS, logCardId } from './logs';
export type { SiltLog } from './logs';

/** Single-faction deck cards by faction (§7.2–§7.7). The expansion cards are not in here (EXPANSION §8.3). */
export const FACTION_DECKS: Record<FactionId, readonly Card[]> = {
  board: BOARD_CARDS,
  basalt: BASALT_CARDS,
  nacre: NACRE_CARDS,
  undertow: UNDERTOW_CARDS,
  kites: KITES_CARDS,
  tuning: TUNING_CARDS,
};

/**
 * The faction deck (§7): 43 cards plus the 11 expansion cards (EXPANSION §8.3), kinds
 * `faction` | `hostile` | `system`. Includes the queued-only follow-ups (`nc.fake`,
 * `kt.probe`, `tu.hymn`): the draw must skip `queuedOnly` cards. Excludes beats, logs,
 * endings, `ep.review` and the coda.
 */
export const DECK: readonly Card[] = [
  ...BOARD_CARDS,
  ...BASALT_CARDS,
  ...NACRE_CARDS,
  ...UNDERTOW_CARDS,
  ...KITES_CARDS,
  ...TUNING_CARDS,
  ...MULTI_CARDS,
  ...SYSTEM_CARDS,
  ...EXPANSION_CARDS,
];

/** Every card in the game, in a stable order (beats, deck, logs, endings, epilogue, whispers). */
export const CARD_LIST: readonly Card[] = [...BEAT_CARDS, ...DECK, ...LOG_CARDS, ...ENDING_CARDS, ...EPILOGUE_CARDS, ...WHISPER_CARDS];

/** Card by id. */
export const CARDS: Readonly<Record<string, Card>> = Object.fromEntries(CARD_LIST.map((c) => [c.id, c]));

/** The card with this id, or undefined (e.g. content removed in a later build). */
export function getCard(id: string): Card | undefined {
  return Object.prototype.hasOwnProperty.call(CARDS, id) ? CARDS[id] : undefined;
}

/** ★ card id for each Silt Log 7..12. */
export const STAR_CARD: Readonly<Record<number, string>> = Object.fromEntries(
  CARD_LIST.filter((c) => c.star !== undefined).map((c) => [c.star as number, c.id]),
);
