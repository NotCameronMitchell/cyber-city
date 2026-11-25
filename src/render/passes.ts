// ─────────────────────────────────────────────────────────────────────────────
// Render-cache pass counters (docs/MEGACITY.md §3.9 R0, test R1). Every render
// cache that walks the whole region or the whole owned area counts itself
// here, so a canvas-mock speed-3 growth run can assert how often they run:
// whole-region passes only on a world swap or an annex, owned-area passes at
// most once per FULL_PASS_MS each.
// ─────────────────────────────────────────────────────────────────────────────

/** Pass counts by name since the last reset (tests and diagnostics only; a few increments a second at most). */
export const renderPasses: Record<string, number> = {};

/** Count one pass of `name` ('region:…' for a whole-region walk, 'owned:…' for an owned-area walk). */
export function countPass(name: string): void {
  renderPasses[name] = (renderPasses[name] ?? 0) + 1;
}

export function resetPasses(): void {
  for (const k of Object.keys(renderPasses)) delete renderPasses[k];
}
