// ─────────────────────────────────────────────────────────────────────────────
// The frame guard (docs/MEGACITY.md §3.3, §3.11; WP-2). Game.update runs the sim
// through `Simulation.stepSlice` within a per-frame cap (6 ms on a handheld
// device, 10 ms on a PC) and feeds this guard each frame's sim time and whether
// the backlog guard dropped days. Over a SLEEP.strainWindowSec window at speed 2
// or 3, a dropped backlog or a per-frame p95 above SLEEP.strainCapShare of the
// cap is strain: far districts may then rest (sim.sleep 'auto'), and they wake
// again after SLEEP.recoverSec without strain. Pure and clock-driven, so tests
// run it on fake time.
// ─────────────────────────────────────────────────────────────────────────────

import { SLEEP, SLICE } from './config';

/** Frame cap in ms of sim work by device class (§3.3). */
export function frameCapMs(cls: 'pc' | 'handheld'): number {
  return cls === 'pc' ? SLICE.capPcMs : SLICE.capHandheldMs;
}

/** Fewest speed-2/3 frames in the window before its p95 counts (a burst of two frames is not strain). */
export const STRAIN_MIN_FRAMES = 30;

export class FrameGuard {
  /** Unpaused seconds this guard has seen (its own clock). */
  private t = 0;
  /** Speed-2/3 frames inside the window: time and sim ms, oldest first. */
  private readonly at: number[] = [];
  private readonly ms: number[] = [];
  /** When the backlog guard last dropped days (guard clock). */
  private droppedAt = -Infinity;
  /** When strain was last seen. */
  private strainAt = -Infinity;
  /** Far districts may rest (sim.sleep 'auto'). */
  engaged = false;
  /** The window's last p95 (ms), for tests and the FPS readout. */
  p95 = 0;
  /** Seconds until the next p95 evaluation (the sort is done at most four times a second). */
  private evalIn = 0;

  constructor(public cap: number) {}

  /** Forget the window (a new world, a speed drop to 1 or a pause keeps it; only a world swap resets). */
  reset(): void {
    this.at.length = 0;
    this.ms.length = 0;
    this.droppedAt = -Infinity;
    this.strainAt = -Infinity;
    this.engaged = false;
    this.p95 = 0;
    this.evalIn = 0;
  }

  /**
   * One unpaused frame: `dt` real seconds, `simMs` of sim work in it, the speed (strain only counts at 2 or 3) and
   * whether the backlog guard dropped days. Returns whether far districts may rest after this frame.
   */
  record(dt: number, simMs: number, speed: number, dropped: boolean): boolean {
    this.t += Math.max(0, dt);
    const t = this.t;
    const fast = speed >= 2;
    if (fast) {
      this.at.push(t);
      this.ms.push(simMs);
      if (dropped) this.droppedAt = t;
    }
    const from = t - SLEEP.strainWindowSec;
    let k = 0;
    while (k < this.at.length && this.at[k] < from) k++;
    if (k) {
      this.at.splice(0, k);
      this.ms.splice(0, k);
    }
    this.evalIn -= dt;
    if (this.evalIn <= 0) {
      this.evalIn = 0.25;
      this.p95 = this.ms.length >= STRAIN_MIN_FRAMES ? p95Of(this.ms) : 0;
    }
    const strain = fast && (this.droppedAt >= from || this.p95 > SLEEP.strainCapShare * this.cap);
    if (strain) {
      this.strainAt = t;
      this.engaged = true;
    } else if (this.engaged && t - this.strainAt >= SLEEP.recoverSec) this.engaged = false;
    return this.engaged;
  }
}

/** The 95th percentile of a sample (nearest rank). */
export function p95Of(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
