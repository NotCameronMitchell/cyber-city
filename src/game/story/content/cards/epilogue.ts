// ─────────────────────────────────────────────────────────────────────────────
// Epilogue deck cards (docs/MEGACITY.md §9.4): callback cards that only draw in
// Chapter VII. Empty until WP-8 writes them; cards/index.ts already spreads this
// list into DECK (and so CARD_LIST), so WP-8 never edits the index (§12).
// ─────────────────────────────────────────────────────────────────────────────

import type { Card } from '../../types';

/** Deck cards for the epilogue (`when` includes chapter ≥ 7, `once`). Empty since Step 0b; WP-8 fills it. */
export const EPILOGUE_DECK: readonly Card[] = [];
