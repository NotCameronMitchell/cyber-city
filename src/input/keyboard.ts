// ─────────────────────────────────────────────────────────────────────────────
// Keyboard controls (desktop, and any device with a hardware keyboard).
//
//   WASD / arrows   pan (smooth; Shift = fast)
//   + / =  and  -   zoom in / out around the screen centre
//   Space           pause ↔ previous speed
//   1 2 3           sim speed
//   Esc             cancel a plan waiting for ✓; else back to inspect, clear preview + selection
//   Enter           ✓ on a plan waiting for confirmation (EXPANSION §7.7)
//   B               bulldoze                   (press again → inspect)
//   R               street; again: the next unlocked road kind in tray order (EXPANSION §7.2)
//   Z X C           zone hab / market / fab    (press again → inspect)
//   E V T F         Infra, Civic, Sky and Deals trays (again: close)   (MEGACITY §14.3)
//   O               cycle data overlays (Shift+O backwards)
//   M               City map, open and close
//   G               Goals drawer (once the story has started)
//   ?               the shortcut sheet
//   U, Ctrl/Cmd+Z   Undo, while an Undo toast shows
//
// Layout rules (§14.3): the clusters (pan, B R Z X C, E V T F, O, the digits) go by the physical
// key code, so they stay in place on any layout; mnemonic keys and symbols go by the character
// (`e.key`), because on QWERTZ `?` is Shift + the key whose code is Minus (the zoom-out key) and on
// AZERTY Shift + the key whose code is KeyM, and Ctrl+Z sits on code KeyY (QWERTZ) or KeyW (AZERTY).
// resolveKey() checks, in order: (1) Ctrl / Cmd+Z by `e.key` (code KeyZ only when `e.key` is not a
// Latin letter), before the modifier rule; (2) `?`; (3) pan and zoom; (4) M, G, U by `e.key`, by the
// code when `e.key` is a letter of another script (a Cyrillic layout); (5) the code clusters.
//
// Keys are ignored while focus is in a text field / select, when a modifier (Ctrl / Cmd / Alt) is
// held (browser shortcuts win; Ctrl / Cmd+Z is the one combination the game takes), and when
// another handler already called preventDefault (the UI can claim a key, e.g. Esc in a dialog).
// SHORTCUTS is the table the ? sheet prints: every row names keys resolveKey binds.
// ─────────────────────────────────────────────────────────────────────────────

import { lockedReason } from '../game/actions';
import type { Game } from '../game/game';
import type { OverlayId, ToolId } from '../game/types';
import type { Vec } from '../render/camera';
import { nextRoadTool } from '../ui/tools';
import { KEY_PAN_EASE, KEY_PAN_FAST, KEY_PAN_SPEED, KEY_ZOOM_STEP, damp } from './gestures';

/** Overlay cycle order for the O key (the Data tray's order, EXPANSION §7.3; Turf is story-gated and left out). */
export const OVERLAY_CYCLE: readonly OverlayId[] = ['none', 'wealth', 'landValue', 'traffic', 'noise', 'power', 'crime', 'pollution', 'services'];

/** What a key press asks for (resolveKey). 'pan' keys are held and integrated in step(). */
export type KeyAction =
  | 'pan'
  | 'zoomIn'
  | 'zoomOut'
  | 'pause'
  | 'speed1'
  | 'speed2'
  | 'speed3'
  | 'escape'
  | 'confirm'
  | 'bulldoze'
  | 'road'
  | 'res'
  | 'com'
  | 'ind'
  | 'infra'
  | 'civic'
  | 'sky'
  | 'deals'
  | 'overlay'
  | 'overlayBack'
  | 'map'
  | 'goals'
  | 'shortcuts'
  | 'undo';

/** The fields of a KeyboardEvent resolveKey reads (tests pass plain objects). */
export interface KeyLike {
  key: string;
  code: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Tool hotkeys by KeyboardEvent.code (KeyR is the road cycle). */
const TOOL_KEYS: Record<string, ToolId> = {
  KeyB: 'bulldoze',
  KeyZ: 'res',
  KeyX: 'com',
  KeyC: 'ind',
};

/** The code clusters (step 5): tools, trays, the data views, time and the two plan keys. */
const CODE_ACTIONS: Record<string, KeyAction> = {
  KeyB: 'bulldoze',
  KeyR: 'road',
  KeyZ: 'res',
  KeyX: 'com',
  KeyC: 'ind',
  KeyE: 'infra',
  KeyV: 'civic',
  KeyT: 'sky',
  KeyF: 'deals',
  KeyO: 'overlay',
  Space: 'pause',
  Digit1: 'speed1',
  Digit2: 'speed2',
  Digit3: 'speed3',
  Numpad1: 'speed1',
  Numpad2: 'speed2',
  Numpad3: 'speed3',
  Escape: 'escape',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
};

/** The mnemonic letters (step 4), by character. */
const LETTER_ACTIONS: Record<string, KeyAction> = { m: 'map', g: 'goals', u: 'undo' };

const PAN_UP = new Set(['ArrowUp', 'KeyW']);
const PAN_DOWN = new Set(['ArrowDown', 'KeyS']);
const PAN_LEFT = new Set(['ArrowLeft', 'KeyA']);
const PAN_RIGHT = new Set(['ArrowRight', 'KeyD']);

/** One Latin letter a–z (either case). */
function isLatinLetter(key: string): boolean {
  return key.length === 1 && ((key >= 'a' && key <= 'z') || (key >= 'A' && key <= 'Z'));
}

/** One letter of another script (Cyrillic, Greek…): the mnemonic keys then fall back to the physical code. */
function isOtherLetter(key: string): boolean {
  return key.length === 1 && !isLatinLetter(key) && key.toLowerCase() !== key.toUpperCase();
}

/** Is `code` one of the held pan keys (WASD or the arrows)? */
export function isPanCode(code: string): boolean {
  return PAN_UP.has(code) || PAN_DOWN.has(code) || PAN_LEFT.has(code) || PAN_RIGHT.has(code);
}

/**
 * What a key press means (§14.3's order), or null. Pure: the US, AZERTY and QWERTZ `key` / `code` pairs all land on
 * the same action (tests/shortcuts.test.ts). Ctrl / Cmd+Z is the only modifier combination that resolves.
 */
export function resolveKey(e: KeyLike): KeyAction | null {
  const key = e.key ?? '';
  const code = e.code ?? '';
  // (1) Ctrl / Cmd+Z: by the character; the physical KeyZ only when the character is not a Latin letter.
  if (e.ctrlKey || e.metaKey) {
    if (e.altKey || e.shiftKey) return null;
    if (key === 'z' || key === 'Z' || (code === 'KeyZ' && !isLatinLetter(key))) return 'undo';
    return null;
  }
  if (e.altKey) return null;
  // (2) ? before the zoom keys: on QWERTZ it is Shift + the key whose code is Minus.
  if (key === '?') return 'shortcuts';
  // (3) Pan and zoom.
  if (isPanCode(code)) return 'pan';
  if (key === '+' || key === '=' || code === 'NumpadAdd' || code === 'Equal') return 'zoomIn';
  if (key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus') return 'zoomOut';
  // (4) M, G, U by the character; a letter of another script by the code.
  const lower = key.toLowerCase();
  if (isLatinLetter(key)) {
    const a = LETTER_ACTIONS[lower];
    if (a) return a;
  } else if (isOtherLetter(key)) {
    const a = code === 'KeyM' ? 'map' : code === 'KeyG' ? 'goals' : code === 'KeyU' ? 'undo' : null;
    if (a) return a;
  }
  // (5) The code clusters.
  const a = CODE_ACTIONS[code];
  if (a === 'overlay' && e.shiftKey) return 'overlayBack';
  return a ?? null;
}

/**
 * A key press from a hardware keyboard (§14.3): not in a typing target, with a non-empty `code` and a `key` that is not
 * 'Unidentified' (virtual keyboards on iOS and Android fire keydown while the player types a city name; Android's say
 * 'Unidentified'). One such press shows the key hints for the session.
 */
export function isHardwareKey(e: KeyLike & { target?: EventTarget | null }): boolean {
  if (!e.code || !e.key || e.key === 'Unidentified' || e.key === 'Process') return false;
  return !isTypingTarget(e.target ?? null);
}

/** A group of the ? sheet. */
export type ShortcutGroup = 'Camera' | 'Time' | 'Build' | 'Panels';

/** One row of the ? sheet: the keys as printed and what they do. `codes` are the physical keys a keycap reads. */
export interface Shortcut {
  group: ShortcutGroup;
  /** Keys as printed (US labels; the sheet maps `codes` through the player's layout where the browser can tell). */
  keys: readonly string[];
  /**
   * Physical codes behind `keys`, in order, for the keycap to read through the player's layout ('' prints the key as
   * written: a key bound by its character, a digit or symbol, or not a key at all).
   */
  codes: readonly string[];
  label: string;
  /** The actions the row stands for (tests check each is bound by resolveKey or the pointer). */
  actions: readonly (KeyAction | 'wheel' | 'rightDrag' | 'fast')[];
}

/**
 * Every key the game binds, as the ? sheet lists it (§14.3), generated from the same tables resolveKey reads, so the
 * sheet can never list a key that does nothing.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { group: 'Camera', keys: ['W', 'A', 'S', 'D'], codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], label: 'Pan (or the arrow keys)', actions: ['pan'] },
  { group: 'Camera', keys: ['Shift'], codes: [''], label: 'Pan fast (hold while panning)', actions: ['fast'] },
  { group: 'Camera', keys: ['+', '−'], codes: ['', ''], label: 'Zoom in and out', actions: ['zoomIn', 'zoomOut'] },
  { group: 'Camera', keys: ['Wheel'], codes: [''], label: 'Zoom at the cursor; keep going out for the City map', actions: ['wheel'] },
  { group: 'Camera', keys: ['Right-drag'], codes: [''], label: 'Move the map', actions: ['rightDrag'] },
  { group: 'Camera', keys: ['M'], codes: [''], label: 'City map, open and close', actions: ['map'] },
  { group: 'Time', keys: ['Space'], codes: ['Space'], label: 'Pause and resume', actions: ['pause'] },
  { group: 'Time', keys: ['1', '2', '3'], codes: ['', '', ''], label: 'Normal, fast, fastest', actions: ['speed1', 'speed2', 'speed3'] },
  { group: 'Build', keys: ['Esc'], codes: ['Escape'], label: 'Inspect (drop the tool)', actions: ['escape'] },
  { group: 'Build', keys: ['B'], codes: ['KeyB'], label: 'Bulldoze (again: Inspect)', actions: ['bulldoze'] },
  { group: 'Build', keys: ['R'], codes: ['KeyR'], label: 'Street; again: the next road kind', actions: ['road'] },
  { group: 'Build', keys: ['Z', 'X', 'C'], codes: ['KeyZ', 'KeyX', 'KeyC'], label: 'Hab Blocks, Market Strip, Fab Yards', actions: ['res', 'com', 'ind'] },
  { group: 'Build', keys: ['E', 'V', 'T', 'F'], codes: ['KeyE', 'KeyV', 'KeyT', 'KeyF'], label: 'Infra, Civic, Sky and Deals trays', actions: ['infra', 'civic', 'sky', 'deals'] },
  { group: 'Build', keys: ['Enter'], codes: ['Enter'], label: '✓ on a plan waiting for it', actions: ['confirm'] },
  { group: 'Build', keys: ['Esc'], codes: ['Escape'], label: '✕ on a plan waiting for ✓', actions: ['escape'] },
  { group: 'Build', keys: ['U'], codes: [''], label: 'Undo while the Undo note shows (or Ctrl / Cmd+Z)', actions: ['undo'] },
  { group: 'Panels', keys: ['G'], codes: [''], label: 'Goals', actions: ['goals'] },
  { group: 'Panels', keys: ['O'], codes: ['KeyO'], label: 'Next data view (Shift+O: back)', actions: ['overlay', 'overlayBack'] },
  { group: 'Panels', keys: ['?'], codes: [''], label: 'This list', actions: ['shortcuts'] },
  { group: 'Panels', keys: ['Esc'], codes: ['Escape'], label: 'Close the panel', actions: ['escape'] },
];

/** The trays the category keys open (§14.3), by action. */
export const TRAY_KEYS: Readonly<Partial<Record<KeyAction, 'power' | 'services' | 'sky' | 'deals'>>> = {
  infra: 'power',
  civic: 'services',
  sky: 'sky',
  deals: 'deals',
};

/** What the keyboard needs from the UI (installed by the UI root; null on screens without it). */
export interface KeyUIHooks {
  /** Toggle a toolbar tray (E V T F). False when it cannot open (Deals before the factions). */
  toggleTray(cat: 'power' | 'services' | 'sky' | 'deals'): boolean;
  /** M: the City map, open and close. False when this city has none. */
  toggleMap(): boolean;
  /** G: the Goals drawer. False before the story starts. */
  toggleGoals(): boolean;
  /** ?: the shortcut sheet. */
  toggleShortcuts(): boolean;
}

/**
 * The keyboard's link to the UI (like mapBus): the UI root installs `ui`; `hardware` turns true on the session's first
 * hardware key press (isHardwareKey) and `onHardware` tells the UI to show the key hints.
 */
export const keyBus: { ui: KeyUIHooks | null; hardware: boolean; onHardware: (() => void) | null } = {
  ui: null,
  hardware: false,
  onHardware: null,
};

/** What the keyboard needs from the pointer controller. */
export interface KeyboardHooks {
  /** Animated zoom by `factor` around the viewport centre (accumulates on repeat). */
  zoomStep(factor: number): void;
  /** Abort any in-progress pointer gesture without applying it. */
  cancelGesture(): void;
  /** ✓ on the plan waiting for confirmation (the same path as the pill's ✓). */
  confirmPending(): void;
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
    // A hardware key press (any screen, even one that claims the key) shows the key hints for the session (§14.3).
    if (!keyBus.hardware && isHardwareKey(e)) {
      keyBus.hardware = true;
      keyBus.onHardware?.();
    }
    if (e.defaultPrevented) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    const action = resolveKey(e);
    if (!action) return;
    const code = e.code;
    const game = this.game;

    // Continuous pan keys: just track state; update() integrates.
    if (action === 'pan') {
      this.held.add(code);
      e.preventDefault(); // arrows would scroll the page
      return;
    }
    // Zoom keys repeat while held.
    if (action === 'zoomIn' || action === 'zoomOut') {
      this.hooks.zoomStep(action === 'zoomIn' ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP);
      e.preventDefault();
      return;
    }
    if (e.repeat) {
      // Toggles must not machine-gun while a key is held.
      if (code === 'Space' || action === 'undo' || action === 'shortcuts') e.preventDefault();
      return;
    }

    const ui = keyBus.ui;
    switch (action) {
      case 'undo':
        // U or Ctrl / Cmd+Z: only while an Undo toast shows (EXPANSION §7.7's 10 s undo).
        if (game.undoLeft() > 0) {
          game.undo();
          e.preventDefault();
        }
        return;
      case 'shortcuts':
        if (ui?.toggleShortcuts()) e.preventDefault();
        return;
      case 'map':
        if (ui?.toggleMap()) e.preventDefault();
        return;
      case 'goals':
        if (ui?.toggleGoals()) e.preventDefault();
        return;
      case 'infra':
      case 'civic':
      case 'sky':
      case 'deals':
        if (ui?.toggleTray(TRAY_KEYS[action]!)) {
          this.hooks.cancelGesture();
          e.preventDefault();
        }
        return;
      case 'pause':
        e.preventDefault(); // also stops a focused button from "clicking"
        game.setSpeed(game.speed > 0 ? 0 : this.resumeSpeed);
        return;
      case 'speed1':
      case 'speed2':
      case 'speed3':
        game.setSpeed(Number(action.charAt(5)));
        e.preventDefault();
        return;
      case 'escape':
        // A plan waiting for ✓ is cancelled first; the tool stays (EXPANSION §7.7).
        if (game.pendingConfirm) {
          game.cancelPending();
          e.preventDefault();
          return;
        }
        this.hooks.cancelGesture();
        game.setTool('inspect');
        game.setPreview(null);
        game.select(null);
        return;
      case 'confirm':
        if (game.pendingConfirm) {
          this.hooks.confirmPending();
          e.preventDefault();
        }
        return;
      case 'road':
        // Street; again while a road tool is active: the next unlocked road kind (wraps to Street).
        this.hooks.cancelGesture();
        game.setTool(nextRoadTool(game.tool, (t) => !lockedReason(game.world, t)));
        e.preventDefault();
        return;
      case 'overlay':
      case 'overlayBack': {
        const i = OVERLAY_CYCLE.indexOf(game.overlay);
        const n = OVERLAY_CYCLE.length;
        const next = action === 'overlayBack' ? (i - 1 + n) % n : (i + 1) % n;
        game.setOverlay(OVERLAY_CYCLE[next]);
        e.preventDefault();
        return;
      }
      default:
        break;
    }

    const tool = TOOL_KEYS[code];
    if (tool) {
      this.hooks.cancelGesture();
      game.setTool(game.tool === tool ? 'inspect' : tool);
      e.preventDefault();
    }
  };
}
