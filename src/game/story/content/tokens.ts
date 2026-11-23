// ─────────────────────────────────────────────────────────────────────────────
// Text tokens in story copy (docs/STORY.md §0, §7.9, §7.10) and their
// worst-case lengths, used by the content lint and by the director's view().
// ─────────────────────────────────────────────────────────────────────────────

/** Card / chapter tokens and their longest values (§0): city names ≤ 24, districts ≤ 15, corp names ≤ 19. */
export const CARD_TOKEN_MAX = { city: 24, district: 15, patron: 19, rival: 19, year: 4, coherence: 3 } as const;
export type CardToken = keyof typeof CARD_TOKEN_MAX;

/**
 * MOTH note variables (§7.9): `{lit}` road tiles, `{dark}` unpowered developed tiles,
 * `{pop}` population, `{crime}` %, `{district}`, `{trace}`, `{n}` = 150 × active skybridges.
 * Lengths are formatted worst cases ('4,096', '9,999,999', '100').
 */
export const NOTE_TOKEN_MAX = { lit: 5, dark: 5, pop: 9, crime: 3, district: 15, trace: 3, n: 6 } as const;

/**
 * System-line variables (§7.10): `{gang}` ≤ 15 ('the Glass Kites'), `{stage}` a stage or
 * crown name ('Kite Nest Crown'), `{n}` stations, `{plant}` / `{building}` building names,
 * `{faction}` faction names.
 */
export const LINE_TOKEN_MAX = { district: 15, gang: 15, stage: 15, n: 3, plant: 17, building: 17, faction: 19 } as const;

/** Hard copy limits (§0, §2.6, §7.9, §7.10). */
export const COPY_LIMITS = {
  body: 280,
  label: 40,
  title: 28,
  sys: 48,
  /** Ticker lines: whispers, system lines, unlock news. */
  ticker: 90,
  /** MOTH notes (§8.11). */
  note: 60,
  dealBlurb: 60,
  rewardSys: 48,
  lockedHint: 40,
  /** Clarity pass: a card's plain-language brief, after token fill. */
  brief: 220,
  /** Clarity pass: a chapter's (or the epilogue's) intro summary. */
  chapterSummary: 240,
  /** Clarity pass: a chapter's one-line recap for "Story so far". */
  chapterRecap: 160,
  /** Clarity pass: a faction's "who is this?" line. */
  factionAbout: 160,
  /** Clarity pass: a glossary entry's text. */
  glossary: 200,
} as const;

const TOKEN_RE = /\{([a-zA-Z]+)\}/g;

/** Every `{token}` name in a string, in order. */
export function tokensIn(text: string): string[] {
  const out: string[] = [];
  for (const mt of text.matchAll(TOKEN_RE)) out.push(mt[1]);
  return out;
}

/** Replace `{key}` with `values[key]`; unknown keys are left as they are. */
export function fillTokens(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(TOKEN_RE, (all, k: string) => (k in values ? String(values[k]) : all));
}

/** Fill every known token with a placeholder of its maximum length (lint). */
export function worstCase(text: string, max: Readonly<Record<string, number>>): string {
  return text.replace(TOKEN_RE, (all, k: string) => (k in max ? 'W'.repeat(max[k]) : all));
}
