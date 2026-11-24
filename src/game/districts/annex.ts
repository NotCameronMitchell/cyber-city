// ─────────────────────────────────────────────────────────────────────────────
// Annex content per kind and variant (docs/MEGACITY.md §3.7, §3.8): ruins, frames,
// the pump hall, brownfield and reed ground, alley tangles, the apron families.
// WP-2 owns this file; Step 0b ships the hook with its final signature and no
// content, so `World.annex` already batches whatever it places.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rng } from '../rng';
import type { SlotId } from '../types';
import type { World } from '../world';

/**
 * Place a freshly annexed slot's content. Called by `World.annex` with per-tile events suspended (one 'tiles' touch
 * for the slot rect follows) and an Rng of its own (`seed ^ ANNEX_SALT[ringKey(slot)]`), never world.rng, so later
 * growth rolls don't shift and a slot's content is the same on both regions. Structural only: no costs, no rules.
 */
export function placeAnnexContent(_world: World, _slot: SlotId, _rng: Rng): void {
  // WP-2: content per kind and variant.
}
