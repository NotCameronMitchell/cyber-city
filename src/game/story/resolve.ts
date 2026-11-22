// ─────────────────────────────────────────────────────────────────────────────
// resolveMods: gathers every modifier source into one SimMods (STORY.md §10.4).
// Owner: WP-A. Sources, in order:
//
//   1. active timed mods (story.mods; until −1 = permanent)
//   2. active deals: a deal's modifiers are timed mods written by its effects
//      (bounded by the deal's months), so they already sit in source 1
//   3. faction tier penalties and perks (Cold, Hostile = Cold + hostile mods,
//      Allied) for visible, unretired factions
//   4. the patron perk (flag `patron` set and the patron's standing ≥ 0)
//   5. turf demand and pact mods (turfPatch)
//   6–7. skybridge / cluster demand, Commons Hall, crowns (verticalPatch)
//   8. the current ending's post patch, plus its variant's (Lamplight)
//
// then clampMods. Read live every time: a Charter Review swap is clean (§6.4).
// ─────────────────────────────────────────────────────────────────────────────

import { FACTION_IDS, PATRON_PERK } from '../config';
import type { World } from '../world';
import { storyContent } from './conditions';
import { isActive, patronFlag, standing, tierOf } from './factions';
import { clampMods, cloneMods, combine } from './mods';
import { turfPatch } from './turf';
import type { ModPatch, SimMods } from './types';
import { verticalPatch } from './vertical';

/** The tier patches that apply to a faction right now (in order), for resolveMods and the penalty chips. */
export function tierPatches(world: World): { f: (typeof FACTION_IDS)[number]; kind: 'cold' | 'hostile' | 'perk'; patch: ModPatch }[] {
  const out: { f: (typeof FACTION_IDS)[number]; kind: 'cold' | 'hostile' | 'perk'; patch: ModPatch }[] = [];
  const idx = storyContent();
  for (const f of FACTION_IDS) {
    const def = idx.factions[f];
    if (!def || !isActive(world, f)) continue;
    const t = tierOf(standing(world, f));
    if (t === 'cold' || t === 'hostile') out.push({ f, kind: 'cold', patch: def.cold });
    if (t === 'hostile') out.push({ f, kind: 'hostile', patch: def.hostile.mods });
    if (t === 'allied') out.push({ f, kind: 'perk', patch: def.perk });
  }
  return out;
}

/** A fresh, clamped SimMods for the world's current story state. The caller assigns it to `world.mods`. */
export function resolveMods(world: World): SimMods {
  const m = cloneMods();
  const st = world.story;
  const tick = world.tick;
  // 1–2. Active timed mods (deal modifiers included).
  for (const e of st.mods) if (e.until < 0 || e.until > tick) combine(m, e.mods);
  // 3. Tier penalties and perks.
  for (const t of tierPatches(world)) if (t.patch) combine(m, t.patch);
  // 4. Patron perk: only once the flag is set (a resolved stand-in gets none).
  const p = patronFlag(world);
  if (p && standing(world, p) >= 0) combine(m, PATRON_PERK[p]);
  // 5. Turf demand (and pact mods).
  combine(m, turfPatch(world));
  // 6–7. Skybridges, clusters, Commons Hall, crowns.
  combine(m, verticalPatch(world));
  // 8. The current ending (derived, never applied as a one-off).
  if (st.ending) {
    const e = storyContent().ending.get(st.ending);
    if (e) {
      combine(m, e.post);
      const v = e.rules.variant;
      if (v && st.endingVariant === v.id) combine(m, v.post);
    }
  }
  clampMods(m);
  return m;
}
