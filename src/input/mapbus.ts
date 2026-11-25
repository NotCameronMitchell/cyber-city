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
