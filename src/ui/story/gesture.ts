// ─────────────────────────────────────────────────────────────────────────────
// Small pointer helpers for the story surfaces: swipe-down-to-dismiss with a
// rubber-band drag, edge-swipe-right for "Back", and long-press detection.
// Everything is pointer-event based (touch, pen and mouse alike).
// ─────────────────────────────────────────────────────────────────────────────

import { prefersReducedMotion } from '../dom';

export interface SwipeOpts {
  /** Return false to ignore a press that starts on this target (e.g. a button or scrolled list). */
  canStart?: (target: HTMLElement, e: PointerEvent) => boolean;
  /** Swiped down far enough. */
  onSwipe: () => void;
  /** Pixels of downward travel that dismiss. */
  threshold?: number;
}

/** Drag `el` down with the finger; release past the threshold calls onSwipe, else it springs back. */
export function swipeDown(el: HTMLElement, opts: SwipeOpts): () => void {
  const threshold = opts.threshold ?? 80;
  let id = -1;
  let y0 = 0;
  let x0 = 0;
  let dy = 0;
  let dragging = false;
  const reset = () => {
    el.style.transform = '';
    el.style.transition = '';
    id = -1;
    dragging = false;
    dy = 0;
  };
  const down = (e: PointerEvent) => {
    if (id !== -1 || e.button > 0) return;
    const t = e.target as HTMLElement;
    if (opts.canStart && !opts.canStart(t, e)) return;
    id = e.pointerId;
    y0 = e.clientY;
    x0 = e.clientX;
    dy = 0;
    dragging = false;
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const ddy = e.clientY - y0;
    const ddx = e.clientX - x0;
    if (!dragging) {
      if (ddy > 10 && ddy > Math.abs(ddx) * 1.3) {
        dragging = true;
        try {
          el.setPointerCapture(id);
        } catch {
          /* ignore */
        }
      } else if (Math.abs(ddx) > 14 || ddy < -10) {
        id = -1;
        return;
      } else return;
    }
    dy = Math.max(0, ddy);
    el.style.transition = 'none';
    el.style.transform = `translate3d(0, ${dy}px, 0)`;
    e.preventDefault();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const done = dragging && dy > threshold;
    if (dragging) {
      el.style.transition = prefersReducedMotion() ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.9, 0.25, 1)';
      el.style.transform = done ? `translate3d(0, ${Math.max(dy, 240)}px, 0)` : '';
      window.setTimeout(() => {
        el.style.transition = '';
        if (done) el.style.transform = '';
      }, 240);
    }
    id = -1;
    dragging = false;
    if (done) opts.onSwipe();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => reset());
  return reset;
}

/** Edge swipe right (starting within 28 px of the left edge of `el`) → onBack. */
export function edgeSwipeRight(el: HTMLElement, onBack: () => void, isActive: () => boolean): void {
  let id = -1;
  let x0 = 0;
  let y0 = 0;
  el.addEventListener('pointerdown', (e) => {
    if (!isActive()) return;
    const r = el.getBoundingClientRect();
    if (e.clientX - r.left > 28) return;
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id) return;
    id = -1;
    const dx = e.clientX - x0;
    if (dx > 70 && Math.abs(e.clientY - y0) < dx * 0.6) onBack();
  });
  el.addEventListener('pointercancel', () => (id = -1));
}

/**
 * Long-press on elements matching `selector` inside `root`. `onPress(el)` fires
 * after `ms`; the click that follows the release is swallowed. `onRelease`
 * fires when the finger lifts after a long press.
 */
export function longPress(
  root: HTMLElement,
  selector: string,
  ms: number,
  onPress: (el: HTMLElement) => void,
  onRelease?: (el: HTMLElement) => void,
): void {
  let timer = 0;
  let target: HTMLElement | null = null;
  let fired = false;
  let x0 = 0;
  let y0 = 0;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  root.addEventListener('pointerdown', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (!t || !root.contains(t)) return;
    target = t;
    fired = false;
    x0 = e.clientX;
    y0 = e.clientY;
    cancel();
    timer = window.setTimeout(() => {
      fired = true;
      onPress(t);
    }, ms);
  });
  root.addEventListener('pointermove', (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) cancel();
  });
  const end = () => {
    cancel();
    if (fired && target) onRelease?.(target);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('pointerleave', end);
  // Swallow the click produced by a long press.
  root.addEventListener(
    'click',
    (e) => {
      if (!fired) return;
      fired = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
  root.addEventListener('contextmenu', (e) => {
    if ((e.target as HTMLElement).closest(selector)) e.preventDefault();
  });
}

/**
 * Tracks a press inside `el` so a sheet can hold off replacing its HTML under
 * a finger: re-rendering between pointerdown and click (the sim ticks daily
 * while sheets are open) would retarget or drop the tap. `down` clears just
 * after the click, then `onRelease` runs so the skipped render can catch up.
 */
export function pressGuard(el: HTMLElement, onRelease: () => void): { readonly down: boolean } {
  let down = false;
  const up = () => {
    if (!down) return;
    window.setTimeout(() => {
      down = false;
      onRelease();
    }, 0);
  };
  el.addEventListener('pointerdown', () => (down = true), true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  return {
    get down() {
      return down;
    },
  };
}
