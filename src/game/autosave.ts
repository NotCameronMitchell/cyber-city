// When the autosave runs (docs/MEGACITY.md §3.3, §3.11; WP-2): off the month tick. The month handler only marks a save
// due; it runs in an idle callback queued after a frame that ran no sim slice (or after `waitMs` anyway, so a city at
// top speed still saves), at most every max(`everyMonths` sim months, the game's autosaveMinSec unpaused seconds: 60,
// or 120 in lower detail). main.ts drives it with the frame clock; tests drive it with a fake one.

/** Sim months between autosaves at least (§3.3). */
export const AUTOSAVE_MONTHS = 3;
/** A due autosave waits this long (ms) for a frame without a sim slice, then is queued anyway. */
export const AUTOSAVE_WAIT_MS = 500;

export class AutosaveClock {
  private months = 0;
  private play = 0;
  private dueAt = 0;
  private isDue = false;
  /** An idle callback is queued and has not fired yet. */
  queued = false;

  constructor(
    readonly everyMonths = AUTOSAVE_MONTHS,
    readonly waitMs = AUTOSAVE_WAIT_MS,
  ) {}

  /** A save is due (both intervals passed) and has not run yet. */
  get due(): boolean {
    return this.isDue;
  }

  /** Unpaused seconds played since the last save. */
  get playSec(): number {
    return this.play;
  }

  /** A save ran (any reason) or a new city started: both counts start again. */
  saved(): void {
    this.months = 0;
    this.play = 0;
    this.isDue = false;
    this.dueAt = 0;
  }

  /** The sim month ended (the 'month' event): the save may become due, nothing more. */
  month(nowMs: number, minSec: number): void {
    this.months++;
    this.mark(nowMs, minSec);
  }

  /**
   * End of a frame. `dt` counts as play only while the game ran (speed > 0); `simRan` says the frame ran a sim slice.
   * True when the save should be queued for idle time now: it is due, nothing is queued, and the frame ran no slice
   * (or the save has waited `waitMs`).
   */
  frame(nowMs: number, dt: number, running: boolean, simRan: boolean, minSec: number): boolean {
    if (running) {
      this.play += dt;
      this.mark(nowMs, minSec);
    }
    if (!this.isDue || this.queued) return false;
    if (simRan && nowMs - this.dueAt < this.waitMs) return false;
    this.queued = true;
    return true;
  }

  /** The idle callback fired: true when the save should run now (still due: no other save ran meanwhile). */
  idle(): boolean {
    this.queued = false;
    return this.isDue;
  }

  private mark(nowMs: number, minSec: number): void {
    if (this.isDue || this.months < this.everyMonths || this.play < minSec) return;
    this.isDue = true;
    this.dueAt = nowMs;
  }
}
