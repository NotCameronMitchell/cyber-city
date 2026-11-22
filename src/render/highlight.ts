// ─────────────────────────────────────────────────────────────────────────────
// Transient map highlights requested by the UI (drawn by the renderer):
// the crackdown zone while its confirm button is up (docs/STORY.md §8.8).
// Plain mutable state: the UI writes, overlay.ts reads once per frame.
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoneHighlight {
  /** Centre in tile units (may be fractional). */
  x: number;
  y: number;
  /** Radius in tiles. */
  r: number;
  color: [number, number, number];
}

export const highlight: { zone: ZoneHighlight | null } = { zone: null };
