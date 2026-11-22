// ─────────────────────────────────────────────────────────────────────────────
// resolveMods: gathers every modifier source into one SimMods (STORY.md §10.4).
// Owner: WP-A. Step 0 stub with the final signature: identities plus active
// timed mods (source 1). WP-A adds sources 2–8 (deals, tiers, patron, turfPatch,
// verticalPatch, ending post) in the order §10.4 lists, then clampMods.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../world';
import { clampMods, cloneMods, combine } from './mods';
import { turfPatch } from './turf';
import type { SimMods } from './types';
import { verticalPatch } from './vertical';

/** A fresh, clamped SimMods for the world's current story state. The caller assigns it to `world.mods`. */
export function resolveMods(world: World): SimMods {
  const m = cloneMods();
  const tick = world.tick;
  // 1. Active timed mods (until −1 = permanent).
  for (const e of world.story.mods) if (e.until < 0 || e.until > tick) combine(m, e.mods);
  // TODO(WP-A): 2. active deals · 3. tier penalties and perks · 4. patron perk.
  // 5. demand from turf counts.
  combine(m, turfPatch(world));
  // 6–7. skybridge / cluster demand, Commons Hall, crowns.
  combine(m, verticalPatch(world));
  // TODO(WP-A): 8. the current ending's post patch (and Lamplight variant).
  clampMods(m);
  return m;
}
