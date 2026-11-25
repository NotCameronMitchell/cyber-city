// ─────────────────────────────────────────────────────────────────────────────
// Tick slicing (docs/MEGACITY.md §3.3): the day is a sequence of atomic steps.
// Each pass is a generator that yields the kind of its next step *before*
// doing it, so the scheduler can check that step's running cost estimate
// against the frame budget; resuming runs exactly that step. step() drains the
// same generators, so a sliced day equals a whole day by construction.
//
// Step kinds keep the mean of their last 8 runs (`CostBook`). A step starts
// only while spent + estimate ≤ budget, and at least one step runs per call.
// ─────────────────────────────────────────────────────────────────────────────

/** Atomic step kinds (one estimate each). */
export const enum K {
  Begin,
  ScanBand,
  ScanEnd,
  Roads,
  Sky,
  Misc,
  DecayBand,
  Label,
  Sweep,
  SweepBld,
  Classify,
  Brown,
  Flags,
  CovStamp,
  CovRows,
  Census,
  TrafficZone,
  TrafficBld,
  TrafficRows,
  TrafficSmooth,
  TrafficOut,
  PolSrc,
  PolZone,
  PolBld,
  PolBlur,
  PolOut,
  NoiseRows,
  NoiseStamp,
  NbhZone,
  NbhRows,
  NbhBlur,
  LvRows,
  CrimeRows,
  WealthZone,
  Copy,
  Pre,
  Growth,
  Post,
  Budget,
  End,
  /** One day's share of the banded turf maps (O6). */
  Turf,
  Count,
}

/** A resumable unit of work: yields the kind of its next atomic step before running it. */
export type Unit = Generator<K, void, void>;

/**
 * Zoned-list entries per step of the banded zoned sweeps (power's demand sweep, the census count, growth, the budget
 * projection): ≈ 0.25 ms at Node speed, so a 25-district city's 45,000 zoned tiles take 5–6 steps (MEGACITY §3.3).
 */
export const ZONED_CHUNK = 8192;

/** Run a unit to completion (whole-day and recompute paths). */
export function drain(u: Unit): void {
  for (let r = u.next(); !r.done; r = u.next());
}

/** Running cost estimates per step kind: the mean of the last 8 runs (ms). */
export class CostBook {
  private readonly ring = new Float64Array(K.Count * 8);
  private readonly n = new Uint8Array(K.Count);
  private readonly at = new Uint8Array(K.Count);
  /** Largest single step seen per kind since the last reset (ms), for the unit bound. */
  readonly max = new Float64Array(K.Count);

  estimate(k: K): number {
    const n = this.n[k];
    if (n === 0) return 0;
    let s = 0;
    const o = k * 8;
    for (let j = 0; j < n; j++) s += this.ring[o + j];
    return s / n;
  }

  add(k: K, ms: number): void {
    const o = k * 8;
    this.ring[o + this.at[k]] = ms;
    this.at[k] = (this.at[k] + 1) & 7;
    if (this.n[k] < 8) this.n[k]++;
    if (ms > this.max[k]) this.max[k] = ms;
  }

  resetMax(): void {
    this.max.fill(0);
  }
}

/** Rows of the owned box in bands of `rows` (MEGACITY §3.3: SLICE.bandRows). */
export function* bands(y0: number, y1: number, rows: number): Generator<number, void, void> {
  for (let y = y0; y <= y1; y += rows) yield y;
}
