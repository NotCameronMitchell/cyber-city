// ─────────────────────────────────────────────────────────────────────────────
// Gangs and turf (docs/STORY.md §3). Owner: WP-C.
//
// Step 0 stub with the final C → A signatures the director calls. Inert.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../world';
import type { ModPatch } from './types';

/**
 * Monthly turf rules (§3.4) after the budget settles: hold, spread, seeding,
 * tagback and scatter; then rewrite world.layerParts.turf, world.turf.stats and
 * story.seam, call composeLayers and emit 'turf'. Uses the story RNG.
 */
export function update(_world: World): void {}

/** Rebuild derived turf data (turf.stats, layerParts.turf) without running any rules (load, crackdown). */
export function refreshStats(_world: World): void {}

/** resolveMods source 5: demand from turf counts (§3.5). */
export function turfPatch(_world: World): ModPatch {
  return {};
}
