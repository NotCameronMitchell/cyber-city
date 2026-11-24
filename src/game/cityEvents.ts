// ─────────────────────────────────────────────────────────────────────────────
// City life (docs/MEGACITY.md §6.4.1). WP-6 fills this; Step 0b ships the
// final signature as a no-op so Game.update already drives it.
//
// Real-time and never interrupting: happenings run on unpaused real seconds
// (CITY_LIFE in config), post one ticker line at their start, and write their
// small gameplay terms into world.cityEvent (read by the sim while daysLeft > 0).
// ─────────────────────────────────────────────────────────────────────────────

import type { Settings } from './types';
import type { World } from './world';

/** What City life reads from Game. */
export interface CityEventsHost {
  readonly world: World;
  readonly settings: Settings;
  /** 0 = paused (an open story card pauses the sim too). */
  readonly speed: number;
}

export class CityEvents {
  constructor(private readonly host: CityEventsHost) {}

  /**
   * Called by Game.update every frame with the frame's dt (s). Frozen while paused (dt counts only when speed > 0).
   * WP-6: the gap clock, the happenings, their ticker lines and world.cityEvent. Step 0b: nothing.
   */
  update(dt: number): void {
    void dt;
    void this.host;
  }

  /** Forget the running happening and the clocks (a world swap: New City, load, restore, import, grow). */
  reset(): void {
    if (this.host.world) this.host.world.cityEvent = null;
  }
}
