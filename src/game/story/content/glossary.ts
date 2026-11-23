// ─────────────────────────────────────────────────────────────────────────────
// Glossary (clarity pass, docs/PACING.md): plain-language meanings of the story's
// in-world terms, shown from the story rail's "?" and linked from cards.
// The content package owns the entries; keep each text ≤ 200 chars.
// ─────────────────────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  /** The term as it appears in game text, e.g. 'Trace'. */
  term: string;
  /** Plain-language meaning, ≤ 200 chars. */
  text: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { term: 'MOTH', text: 'You. The city\'s hidden operations AI. Nobody knows you are making the choices.' },
  { term: 'Trace', text: 'How close anyone is to discovering that MOTH is acting on its own. Bribes and dirty deals raise it.' },
];
