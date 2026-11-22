// ─────────────────────────────────────────────────────────────────────────────
// Keyboard controls (desktop). Physical key codes are used so the WASD /
// ZXC clusters stay in the same place on any layout.
//
//   WASD / arrows   pan (smooth; Shift = fast)
//   + / =  and  -   zoom in / out around the screen centre
//   Space           pause ↔ previous speed
//   1 2 3           sim speed
//   Esc             back to inspect, clear preview + selection
//   B R             bulldoze / road            (press again → inspect)
//   Z X C           zone hab / market / fab    (press again → inspect)
//   O               cycle data overlays (Shift+O backwards)
//
// Keys are ignored while focus is in a text field / select, when a modifier
// (Ctrl / Cmd / Alt) is held (browser shortcuts win), and when another handler
// already called preventDefault (the UI can claim a key, e.g. Esc in a dialog).
// ─────────────────────────────────────────────────────────────────────────────

import type { Game } from '../game/game';
import type { OverlayId, ToolId } from '../game/types';
import type { Vec } from '../render/camera';
import { KEY_PAN_EASE, KEY_PAN_FAST, KEY_PAN_SPEED, KEY_ZOOM_STEP, damp } from './gestures';

/** Overlay cycle order for the O key. */
export const OVERLAY_CYCLE: readonly OverlayId[] = ['none', 'power', 'landValue', 'crime', 'pollution', 'traffic', 'services'];

/** Tool hotkeys by KeyboardEvent.code. */
const TOOL_KEYS: Record<string, ToolId> = {
  KeyB: 'bulldoze',
  KeyR: 'road',
  KeyZ: 'res',
  KeyX: 'com',
  KeyC: 'ind',
};

const PAN_UP = new Set(['ArrowUp', 'KeyW']);
const PAN_DOWN = new Set(['ArrowDown', 'KeyS']);
const PAN_LEFT = new Set(['ArrowLeft', 'KeyA']);
const PAN_RIGHT = new Set(['ArrowRight', 'KeyD']);

/** What the keyboard needs from the pointer controller. */
export interface KeyboardHooks {
  /** Animated zoom by `factor` around the viewport centre (accumulates on repeat). */
  zoomStep(factor: number): void;
  /** Abort any in-progress pointer gesture without applying it. */
  cancelGesture(): void;
}

/** True when keyboard focus is somewhere typing should go. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class KeyboardInput {
  /** Physical codes currently held (pan keys only matter here). */
  private readonly held = new Set<string>();
  private shift = false;
  /** Smoothed pan velocity, screen px/s (+x = view moves right). */
  private vx = 0;
  private vy = 0;
  /** Speed to restore when Space un-pauses. */
  private resumeSpeed: number;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly game: Game,
    private readonly hooks: KeyboardHooks,
  ) {
    this.resumeSpeed = game.speed > 0 ? game.speed : 1;
    this.offs.push(
      game.events.on('speed', (s) => {
        if (s > 0) this.resumeSpeed = s;
      }),
    );
    const opts: AddEventListenerOptions = { passive: false };
    window.addEventListener('keydown', this.onKeyDown, opts);
    window.addEventListener('keyup', this.onKeyUp, opts);
    window.addEventListener('blur', this.releaseAll);
    this.offs.push(() => {
      window.removeEventListener('keydown', this.onKeyDown, opts);
      window.removeEventListener('keyup', this.onKeyUp, opts);
      window.removeEventListener('blur', this.releaseAll);
    });
  }

  /**
   * Advance the eased pan velocity by `dt` seconds and write it to `out`
   * (screen px/s). Returns false when the keyboard is idle and at rest.
   */
  step(dt: number, out: Vec): boolean {
    let tx = 0;
    let ty = 0;
    if (this.held.size > 0) {
      if (this.anyHeld(PAN_RIGHT)) tx += 1;
      if (this.anyHeld(PAN_LEFT)) tx -= 1;
      if (this.anyHeld(PAN_DOWN)) ty += 1;
      if (this.anyHeld(PAN_UP)) ty -= 1;
      if (tx !== 0 && ty !== 0) {
        tx *= Math.SQRT1_2;
        ty *= Math.SQRT1_2;
      }
      const speed = KEY_PAN_SPEED * (this.shift ? KEY_PAN_FAST : 1);
      tx *= speed;
      ty *= speed;
    }
    const k = damp(KEY_PAN_EASE, dt);
    this.vx += (tx - this.vx) * k;
    this.vy += (ty - this.vy) * k;
    if (tx === 0 && ty === 0 && Math.abs(this.vx) < 4 && Math.abs(this.vy) < 4) {
      this.vx = this.vy = 0;
    }
    out.x = this.vx;
    out.y = this.vy;
    return this.vx !== 0 || this.vy !== 0;
  }

  destroy(): void {
    for (const off of this.offs.splice(0)) off();
    this.held.clear();
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private readonly releaseAll = () => {
    this.held.clear();
    this.shift = false;
  };

  private anyHeld(codes: Set<string>): boolean {
    for (const c of codes) if (this.held.has(c)) return true;
    return false;
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.shift = e.shiftKey;
    this.held.delete(e.code);
    if (e.code === 'Space' && !isTypingTarget(e.target)) e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.shift = e.shiftKey;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    const code = e.code;
    const game = this.game;

    // Continuous pan keys: just track state; update() integrates.
    if (PAN_UP.has(code) || PAN_DOWN.has(code) || PAN_LEFT.has(code) || PAN_RIGHT.has(code)) {
      this.held.add(code);
      e.preventDefault(); // arrows would scroll the page
      return;
    }

    // Zoom keys repeat while held.
    const key = e.key;
    if (key === '+' || key === '=' || code === 'NumpadAdd' || code === 'Equal') {
      this.hooks.zoomStep(KEY_ZOOM_STEP);
      e.preventDefault();
      return;
    }
    if (key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus') {
      this.hooks.zoomStep(1 / KEY_ZOOM_STEP);
      e.preventDefault();
      return;
    }

    if (e.repeat) {
      // Toggles must not machine-gun while a key is held.
      if (code === 'Space') e.preventDefault();
      return;
    }

    switch (code) {
      case 'Space':
        e.preventDefault(); // also stops a focused button from "clicking"
        game.setSpeed(game.speed > 0 ? 0 : this.resumeSpeed);
        return;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Numpad1':
      case 'Numpad2':
      case 'Numpad3':
        game.setSpeed(Number(code.charAt(code.length - 1)));
        e.preventDefault();
        return;
      case 'Escape':
        this.hooks.cancelGesture();
        game.setTool('inspect');
        game.setPreview(null);
        game.select(null);
        return;
      case 'KeyO': {
        const i = OVERLAY_CYCLE.indexOf(game.overlay);
        const n = OVERLAY_CYCLE.length;
        const next = e.shiftKey ? (i - 1 + n) % n : (i + 1) % n;
        game.setOverlay(OVERLAY_CYCLE[next]);
        e.preventDefault();
        return;
      }
    }

    const tool = TOOL_KEYS[code];
    if (tool) {
      this.hooks.cancelGesture();
      game.setTool(game.tool === tool ? 'inspect' : tool);
      e.preventDefault();
    }
  };
}
