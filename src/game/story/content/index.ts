// ─────────────────────────────────────────────────────────────────────────────
// Story content ("Who Holds the Charter", docs/STORY.md) as typed data.
// Pure data: no story logic, no side effects. Register it with the director:
//
//   import { STORY_CONTENT } from './content';
//   useStoryContent(STORY_CONTENT);        // story/conditions.ts
//
// tests/story/content-lint.test.ts checks every rule of §13 against it.
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_LIST } from './cards';
import { CHAPTERS } from './chapters';
import { ENDING_LIST } from './endings';
import { FACTIONS } from './factions';
import { UNLOCK_NEWS } from './lines';
import { MOTH_NOTES, WHISPERS } from './whispers';

export * from './cards';
export * from './chapters';
export * from './endings';
export * from './factions';
export * from './glossary';
export * from './lexicon';
export * from './lines';
export * from './tokens';
export * from './whispers';
export { ALWAYS } from './dsl';
export { METRICS, METRIC_LIST, isMetric } from './vocab';

/**
 * Everything the director indexes (matches `StoryContent` in story/conditions.ts):
 * all cards (beats, deck, ⚑, system, logs, endings, epilogue, whispers), the six
 * faction sheets, chapters I–VI, the five endings in Charter Night order, whisper
 * lines, MOTH notes and unlock news.
 */
export const STORY_CONTENT = {
  factions: FACTIONS,
  chapters: CHAPTERS,
  cards: CARD_LIST,
  endings: ENDING_LIST,
  whispers: WHISPERS,
  notes: MOTH_NOTES,
  unlockNews: UNLOCK_NEWS,
} as const;
