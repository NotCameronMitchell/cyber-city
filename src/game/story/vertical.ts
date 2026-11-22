// ─────────────────────────────────────────────────────────────────────────────
// Stratablocks, skybridges and Ribbon Rail (docs/STORY.md §4). Owner: WP-C.
//
// Step 0 stub with the final C → A signatures the director calls. Inert.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../world';
import type { ModPatch } from './types';

/**
 * Tall checks, active links, live rail networks (BFS), world.vertical metrics
 * and world.layerParts.vertical; then composeLayers and emit 'vertical'.
 * Run monthly, on load, and after any rail, link, bulldoze or building change.
 */
export function refresh(_world: World): void {}

/** Daily: count down Stratablock buildDays; completion posts news and emits 'vertical'. */
export function onDay(_world: World): void {}

/** Monthly ledger amounts (positive CR) for the "Skybridges" and "Ribbon Rail" expense lines. */
export function upkeep(_world: World): { skybridges: number; rail: number } {
  return { skybridges: 0, rail: 0 };
}

/** resolveMods sources 6 and 7: skybridge / cluster demand, Commons Hall approval, crown mods (§4.2, §4.3). */
export function verticalPatch(_world: World): ModPatch {
  return {};
}
