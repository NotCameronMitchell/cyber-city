// ─────────────────────────────────────────────────────────────────────────────
// The City map's link between input and UI (docs/MEGACITY.md §3.9, §7.2).
//
// Input never calls into the UI directly: the UI root installs `hooks` (open
// the City map on a pinch-out at minZoom or an annex pin, select a slot from an
// atlas tap, leave the map on a pinch-in), and input calls them. `flyIn` is the
// annex fly-in the UI started: a tap during it skips to its end.
// ─────────────────────────────────────────────────────────────────────────────

import type { SlotId } from '../game/types';

export interface CityMapHooks {
  /** The City map panel is open (camera.mapView is on while it is). */
  isOpen(): boolean;
  /** Open the City map (a pinch-out past minZoom in a multi-district city, an annex pin), optionally on `slot`. */
  open(slot?: SlotId): void;
  /** A tap on the atlas at canvas CSS px (sx, sy). */
  tap(sx: number, sy: number): void;
  /** Leave the map towards screen point (sx, sy): a pinch-in on the City map (§3.9). */
  leave(sx: number, sy: number): void;
}

export const mapBus: {
  hooks: CityMapHooks | null;
  /** The annex fly-in running now (§7.2: 1.2 s, a tap skips): the tile rect it eases to. */
  flyIn: { x0: number; y0: number; x1: number; y1: number } | null;
} = { hooks: null, flyIn: null };

/** Pinch-out past minZoom that snaps to the City map (a spread ratio below this, accumulated at minZoom). */
export const MAP_PINCH_OUT = 0.8;
/** Pinch-in on the City map at its largest zoom that leaves it (accumulated spread ratio above this). */
export const MAP_PINCH_IN = 1.25;

/**
 * May this pinch leave the City map? Only a pinch that began at the map's largest zoom: on a 5×5 handheld map (zoom
 * headroom 2×, §7.2) a pinch that zooms the atlas in stops at 2× and stays on the map, however far the fingers keep
 * spreading; a new pinch at 2× leaves. A 3×3 map has no headroom, so any pinch-in on it leaves (§3.9).
 */
export function pinchMayLeaveMap(startZoom: number, mapZoom: number, headroom: number): boolean {
  return startZoom >= mapZoom * Math.max(1, headroom) * 0.995;
}

/**
 * The skybridge tool's pill flash (§5.4 step 3): after a bridge builds, its payoff for 3 s ("SKYBRIDGE · 1,450 CR" /
 * "600 walkers · cars −20%"); after a tap on a level-2 tower, "Grows tall at level 3". Input writes it, the pill reads it.
 */
export const skyBus: { flash: { title: string; cost: string; note: string; tone: 'good' | 'info'; until: number } | null } = { flash: null };
/** How long a flash stays on the pill (ms). */
export const SKY_FLASH_MS = 3000;
