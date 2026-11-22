// ─────────────────────────────────────────────────────────────────────────────
// Subtle haptic feedback. navigator.vibrate is missing on iOS and desktop and
// may be blocked by permissions policy inside iframes, so every call is
// guarded and failures are silent.
// ─────────────────────────────────────────────────────────────────────────────

let lastPulse = -Infinity;

/** Tiny tick while dragging across tiles. */
export const HAPTIC_TICK_MS = 8;
/** Confirmation pulse when an action lands. */
export const HAPTIC_CONFIRM_MS = 15;

/**
 * Vibrate for `ms` milliseconds unless another pulse fired less than
 * `minGapMs` ago (keeps rapid tile ticks from turning into a buzz).
 */
export function haptic(ms: number, minGapMs = 0): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const now = performance.now();
  if (now - lastPulse < minGapMs) return;
  lastPulse = now;
  try {
    navigator.vibrate(ms);
  } catch {
    /* blocked (no user activation / permissions policy) — haptics are optional */
  }
}
