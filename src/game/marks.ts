// ─────────────────────────────────────────────────────────────────────────────
// Choices that last: marks (docs/MEGACITY.md §9). Interface frozen after Step 0b;
// WP-8 fills it. Marks are derived, never saved: deriveMarks recomputes them on
// load and after story changes. skylineLang is read by the kit's pickForm (§6.1).
// ─────────────────────────────────────────────────────────────────────────────

import type { EndingId, Marks } from './story/types';
import type { World } from './world';

/** The marks the city's choices have left (§9.3). Step 0b: none. */
export function deriveMarks(_world: World): Marks {
  return { list: [], version: 0 };
}

/**
 * The faction language an eligible L3 body at art coordinates (x, y) draws in under the skyline takeover rule (§9.2),
 * or null for its district style. Step 0b: always null.
 */
export function skylineLang(_x: number, _y: number): EndingId | null {
  return null;
}
