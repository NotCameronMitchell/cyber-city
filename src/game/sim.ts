// STUB — to be replaced by the full simulation implementation (see docs/CONTRACTS.md §Simulation).
import type { World } from './world';

export interface SimOptions {
  /** Random city events (grid hacks, gang surges, corp investments). */
  events: boolean;
}

export class Simulation {
  options: SimOptions = { events: true };
  constructor(public world: World) {}
  /** Advance one day. */
  step(): void {
    this.world.tick++;
  }
  /** Recompute every derived field/stat from scratch (after load / new game / player action). Must not advance time or money. */
  recomputeAll(): void {}
}
