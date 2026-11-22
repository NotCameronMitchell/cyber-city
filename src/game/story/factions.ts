// ─────────────────────────────────────────────────────────────────────────────
// Faction standing, tiers, mood and power share (docs/STORY.md §2). Owner: WP-A.
//
// Step 0 stub with the final A → C signatures (turf.ts, actions.ts and
// vertical.ts import standing / tier). Simple working version: standing =
// favor clamped by floors and ceilings; WP-A adds mood and ending rules.
// ─────────────────────────────────────────────────────────────────────────────

import { STANDING } from '../config';
import type { World } from '../world';
import type { FactionId, Tier } from './types';

/** Tier for a standing value (§2.1). */
export function tierOf(standing: number): Tier {
  if (standing <= STANDING.hostile) return 'hostile';
  if (standing <= STANDING.cold) return 'cold';
  if (standing >= STANDING.allied) return 'allied';
  if (standing >= STANDING.friendly) return 'friendly';
  return 'neutral';
}

/** standing = clamp(round(favor + mood), floor ?? −100, ceil ?? 100) (§2.1). Step 0: mood = 0. */
export function standing(world: World, f: FactionId): number {
  const s = world.story;
  const lo = s.floors[f] ?? STANDING.min;
  const hi = s.ceils[f] ?? STANDING.max;
  const v = Math.round(s.favor[f] ?? 0);
  return v < lo ? lo : v > hi ? hi : v;
}

/** Current tier of a faction. */
export function tier(world: World, f: FactionId): Tier {
  return tierOf(standing(world, f));
}
