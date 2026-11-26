// ─────────────────────────────────────────────────────────────────────────────
// Device class and the region default (docs/MEGACITY.md §3.11). Interface frozen
// after Step 0b.
//
// One device class everywhere, computed once a session and memoized: plugging in
// or removing a mouse mid-session changes nothing. It decides the region default,
// the lower-detail default, the sim's frame cap, streetMinZoom, the skyline cap,
// the atlas budget, O8's 3×3 trigger, the New City warning and the import notice.
// Only the desktop *layout* (§14.1) follows a live media query.
// ─────────────────────────────────────────────────────────────────────────────

import { storageGet, storageSet } from './storage';
import type { Region } from './types';

export interface DeviceProfile {
  /** A hovering mouse or trackpad is the primary pointer: matchMedia('(hover: hover) and (pointer: fine)'). */
  finePointer: boolean;
  /**
   * A phone or tablet operating system, even with a mouse, trackpad or keyboard attached: iPhone, iPad (iPadOS reports
   * a Mac platform with maxTouchPoints > 1) or Android (navigator.userAgentData?.platform, else 'Android' in the user
   * agent: the one place the game reads the user agent, and only for this default).
   */
  mobileOS: boolean;
  /** Shorter side of the screen (screen.width / screen.height, not the window), CSS px. */
  shortSide: number;
  /** navigator.hardwareConcurrency, 4 when missing. */
  cores: number;
  /** navigator.deviceMemory (Chromium only, bucketed, ≤ 8), else null. */
  memoryGB: number | null;
  /** Micro-benchmark factor (device ms ÷ Node ms), null until measured or when the timer is too coarse; cached per device. */
  benchFactor: number | null;
}

export type DeviceClass = 'pc' | 'handheld';

/** localStorage key of the cached micro-benchmark factor (30 days). */
export const BENCH_KEY = 'cybercity.device.v1';
export const BENCH_TTL_MS = 30 * 24 * 3600 * 1000;
/**
 * The micro-benchmark's reference time in Node (ms per run of `benchWork` as `measureBench` times it, in a fresh
 * process), fixed by Step 0b's device check on the dev container (Node 22, 4 shared cores): median 3.5 ms over 12 fresh
 * processes (2.85–4.29). §3.11's planned ≈ 6 ms was an estimate (MEGACITY §11.6).
 */
export const BENCH_NODE_MS = 3.5;
/** Above this timer step (ms) the benchmark returns null and the cores and memory rule decides. */
export const BENCH_MAX_TIMER_MS = 1;
/** Each timed run repeats the work until it lasts at least this long (ms); the median of 3 runs counts. */
export const BENCH_MIN_RUN_MS = 50;
/**
 * Untimed warm-up before the runs (ms): the JIT tiers up on every engine first, so the factor compares warm code with
 * warm code (the device check measured a cold first run at ≈ 1.5× the warm time in Node, Step 0b, §11.6).
 */
export const BENCH_WARM_MS = 30;

type Nav = {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string; mobile?: boolean };
};

/** Read the profile from the environment (no memo). Missing APIs read as a plain desktop with 4 cores. */
export function readProfile(): DeviceProfile {
  const g = globalThis as {
    navigator?: Nav;
    screen?: { width?: number; height?: number };
    matchMedia?: (q: string) => { matches: boolean };
  };
  const nav: Nav = g.navigator ?? {};
  let finePointer = false;
  try {
    finePointer = !!g.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  } catch {
    finePointer = false;
  }
  const uaPlatform = nav.userAgentData?.platform ?? '';
  const ua = nav.userAgent ?? '';
  const touch = Number(nav.maxTouchPoints) || 0;
  const iPad = /Mac/i.test(nav.platform ?? '') && touch > 1;
  const mobileOS = /Android|iOS|iPadOS/i.test(uaPlatform) || /Android|iPhone|iPad|iPod/i.test(ua) || iPad || nav.userAgentData?.mobile === true;
  const w = Number(g.screen?.width) || 0;
  const h = Number(g.screen?.height) || 0;
  const shortSide = w > 0 && h > 0 ? Math.min(w, h) : Math.max(w, h);
  const cores = Number(nav.hardwareConcurrency) > 0 ? Number(nav.hardwareConcurrency) : 4;
  const memoryGB = Number(nav.deviceMemory) > 0 ? Number(nav.deviceMemory) : null;
  return { finePointer, mobileOS, shortSide, cores, memoryGB, benchFactor: cachedBench() };
}

let memo: DeviceProfile | null = null;

/** Computed once per session and memoized: plugging in or removing a mouse mid-session changes nothing. */
export function deviceProfile(): DeviceProfile {
  if (!memo) memo = readProfile();
  return memo;
}

/** Test hook: forget the memoized profile (or set one). */
export function resetDeviceProfile(p: DeviceProfile | null = null): void {
  memo = p;
}

/** PC-like: a fine primary pointer, not a phone or tablet OS, and a screen whose shorter side is ≥ 600 CSS px. */
export function isPcLike(p: DeviceProfile): boolean {
  return p.finePointer && !p.mobileOS && p.shortSide >= 600;
}

/** Capable of a 5×5 default: ≥ 4 cores, ≥ 4 GB where known, and a bench factor ≤ 2.0 where measured. */
export function isCapable(p: DeviceProfile): boolean {
  return p.cores >= 4 && (p.memoryGB === null || p.memoryGB >= 4) && (p.benchFactor === null || p.benchFactor <= 2.0);
}

/** 'pc' when PC-like, else 'handheld'. Memoized with the profile (pass a profile to evaluate it instead). */
export function deviceClass(p?: DeviceProfile): DeviceClass {
  return isPcLike(p ?? deviceProfile()) ? 'pc' : 'handheld';
}

/** 5 for a PC that can carry it, else 3. */
export function defaultRegion(p?: DeviceProfile): Region {
  const q = p ?? deviceProfile();
  return isPcLike(q) && isCapable(q) ? 5 : 3;
}

// ── Micro-benchmark ─────────────────────────────────────────────────────────

/** The cached factor, if fresh (null otherwise). */
function cachedBench(): number | null {
  const raw = storageGet(BENCH_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { factor?: unknown; at?: unknown };
    const f = Number(v.factor);
    const at = Number(v.at);
    if (!Number.isFinite(f) || f <= 0 || !Number.isFinite(at) || Date.now() - at > BENCH_TTL_MS) return null;
    return f;
  } catch {
    return null;
  }
}

/**
 * The work unit (§3.11): three passes of a separable 3-tap blur and one typed-array BFS over a 320×320 grid. Returns a
 * checksum so nothing is optimised away. Allocates its arrays per call (they are not module scope: frame test).
 */
export function benchWork(): number {
  const N = 320;
  const a = new Float32Array(N * N);
  const b = new Float32Array(N * N);
  for (let i = 0; i < a.length; i++) a[i] = ((i * 2654435761) >>> 0) / 4294967296;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < N; y++) {
      const r = y * N;
      b[r] = (a[r] + a[r + 1]) * 0.5;
      for (let x = 1; x < N - 1; x++) b[r + x] = (a[r + x - 1] + a[r + x] + a[r + x + 1]) / 3;
      b[r + N - 1] = (a[r + N - 2] + a[r + N - 1]) * 0.5;
    }
    for (let x = 0; x < N; x++) {
      a[x] = (b[x] + b[x + N]) * 0.5;
      for (let y = 1; y < N - 1; y++) a[y * N + x] = (b[(y - 1) * N + x] + b[y * N + x] + b[(y + 1) * N + x]) / 3;
      a[(N - 1) * N + x] = (b[(N - 2) * N + x] + b[(N - 1) * N + x]) * 0.5;
    }
  }
  const dist = new Int32Array(N * N).fill(-1);
  const q = new Int32Array(N * N);
  let head = 0;
  let tail = 0;
  const start = (N >> 1) * N + (N >> 1);
  dist[start] = 0;
  q[tail++] = start;
  while (head < tail) {
    const i = q[head++];
    const x = i % N;
    const d = dist[i] + 1;
    if (x > 0 && dist[i - 1] < 0 && a[i - 1] > 0.2) (dist[i - 1] = d), (q[tail++] = i - 1);
    if (x < N - 1 && dist[i + 1] < 0 && a[i + 1] > 0.2) (dist[i + 1] = d), (q[tail++] = i + 1);
    if (i >= N && dist[i - N] < 0 && a[i - N] > 0.2) (dist[i - N] = d), (q[tail++] = i - N);
    if (i < N * (N - 1) && dist[i + N] < 0 && a[i + N] > 0.2) (dist[i + N] = d), (q[tail++] = i + N);
  }
  return a[start] + tail;
}

/** The smallest non-zero step between successive clock readings (ms). */
export function timerResolution(now: () => number, samples = 50): number {
  let best = Infinity;
  for (let k = 0; k < samples; k++) {
    const t0 = now();
    let t1 = now();
    let guard = 0;
    while (t1 === t0 && guard++ < 1e6) t1 = now();
    if (t1 > t0) best = Math.min(best, t1 - t0);
  }
  return best;
}

/**
 * Measure the factor (device ms ÷ BENCH_NODE_MS) with a clock and a work function (both injectable for tests):
 * null when the timer step is above BENCH_MAX_TIMER_MS; otherwise, after BENCH_WARM_MS of untimed warm-up, each of 3 runs repeats the work until it lasts
 * ≥ BENCH_MIN_RUN_MS, and the median per-work time counts, so a 1 ms clamp costs at most 2%.
 */
export function measureBench(now: () => number, work: () => unknown = benchWork, nodeMs = BENCH_NODE_MS): number | null {
  if (timerResolution(now) > BENCH_MAX_TIMER_MS) return null;
  const w0 = now();
  let warm = 0;
  do work();
  while (now() - w0 < BENCH_WARM_MS && ++warm < 10000);
  const runs: number[] = [];
  for (let r = 0; r < 3; r++) {
    let reps = 0;
    const t0 = now();
    let t = t0;
    do {
      work();
      reps++;
      t = now();
    } while (t - t0 < BENCH_MIN_RUN_MS && reps < 10000);
    runs.push((t - t0) / reps);
  }
  runs.sort((x, y) => x - y);
  return runs[1] / nodeMs;
}

/**
 * Sim-like work in an idle callback (≈ 150–250 ms in all); cached in localStorage BENCH_KEY for 30 days. Updates the
 * memoized profile's benchFactor. Never needed on a handheld device (it defaults to 3 anyway).
 */
export function runMicroBench(): Promise<number | null> {
  const cached = cachedBench();
  if (cached !== null) {
    deviceProfile().benchFactor = cached;
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    const go = () => {
      const perf = (globalThis as { performance?: { now(): number } }).performance;
      const factor = perf ? measureBench(() => perf.now()) : null;
      if (factor !== null) storageSet(BENCH_KEY, JSON.stringify({ factor, at: Date.now() }));
      deviceProfile().benchFactor = factor;
      resolve(factor);
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(go, { timeout: 1000 });
    else setTimeout(go, 0);
  });
}
