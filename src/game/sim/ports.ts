// ─────────────────────────────────────────────────────────────────────────────
// PortSystem (docs/EXPANSION.md §5, §6.3): seaport / airport / spaceport
// counts, visitors, trade, the spaceport countdown and opening moments.
//
// Step 0: the frozen `PortView` interface plus a stub that reports zeros, so
// Game, the inspect panel and the art can read `sim.ports` while WP-1 fills
// the body. `buildProgress` is already real (a pure function of the building).
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, SPACEPORT } from '../config';
import type { World } from '../world';

/** Read-only port numbers for Game, inspect and art (`Simulation.ports`). Frozen after Step 0. */
export interface PortView {
  /** Visitors per month (X3). */
  readonly visitors: number;
  /** Fab jobs the counted seaports add to industrial demand. */
  readonly exportJobs: number;
  /** Market jobs the airport and a complete spaceport add to commercial demand. */
  readonly comJobs: number;
  /** Fab jobs a complete spaceport adds to industrial demand. */
  readonly indJobs: number;
  /** "Port trade" credits per month of seaport `id` (0 for other buildings). */
  tradeFor(id: number): number;
  /** 0..1 construction progress of building `id`: the Spaceport combines days and waitSec; anything else reads 1. */
  buildProgress(id: number): number;
}

export class PortSystem implements PortView {
  visitors = 0;
  exportJobs = 0;
  comJobs = 0;
  indJobs = 0;

  constructor(private readonly world: World) {}

  tradeFor(_id: number): number {
    return 0;
  }

  /**
   * min((D − buildDays) / D, (S − waitSec) / S) for a Spaceport (D = its buildDays,
   * S = SPACEPORT.minBuildSec); 1 for every other existing building, 0 for an unknown id.
   */
  buildProgress(id: number): number {
    const b = this.world.buildings.get(id);
    if (!b) return 0;
    if (b.type !== 'spaceport') return 1;
    const D = BUILDINGS.spaceport.buildDays ?? 0;
    const S = SPACEPORT.minBuildSec;
    const days = D > 0 ? (D - Math.min(D, Math.max(0, b.buildDays ?? 0))) / D : 1;
    const secs = S > 0 ? (S - Math.min(S, Math.max(0, b.waitSec ?? 0))) / S : 1;
    return Math.min(days, secs);
  }
}
