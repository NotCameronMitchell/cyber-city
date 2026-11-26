// ─────────────────────────────────────────────────────────────────────────────
// Shared context handed to every UI component, plus the modal stack, the
// desktop side layer and the side-panel host (docs/MEGACITY.md §14.1).
//
//   Modals       centred dialogs over a scrim (one visible, a stack)
//   SideLayer    the desktop layout's non-modal side layer: a dialog built with
//                buildDialog({ side: true }) (City report, Budget, City feed,
//                the ? sheet) opens here, docked right, without a scrim, when
//                the desktop layout is on; elsewhere it is today's dialog
//   SidePanels   one side panel at a time: opening a surface replaces the
//                current one; a story card parks the panel under it and gives
//                it back when it closes; a card opened from the Goals drawer or
//                COMMS shows Back. Surfaces are polled once a frame (cheap
//                flags), so their own open / close paths stay as they are.
// ─────────────────────────────────────────────────────────────────────────────

import type { GameEventMap } from '../game/events';
import type { Game } from '../game/game';
import type { Camera } from '../render/camera';
import { h, prefersReducedMotion, replayClass } from './dom';
import { icon } from './icons';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  /** Optional single-line text input (e.g. city name). */
  input?: { label: string; value: string; maxLength?: number; reroll?: () => string };
  onConfirm: (value: string) => void;
  onCancel?: () => void;
}

/** Cross-component actions, wired up by the UI root. */
export interface UIActions {
  openBudget(): void;
  openNews(): void;
  openReport(): void;
  /** Open the main menu, or straight on its Settings page (e.g. from the story pace line). */
  openMenu(view?: 'main' | 'settings'): void;
  confirm(opts: ConfirmOptions): void;
  /** Open the City map (MEGACITY §7.2), optionally on a slot (a pin, the 'map' toast). */
  openCityMap(slot?: number | null): void;
  /** City transfer (MEGACITY §13): Menu › Export city / Import city, and the storage-full toast's Export. */
  openTransfer(kind: 'export' | 'import'): void;
  /** Grow to 25 districts (§3.11): Settings' City line or the City map's edge line. */
  growRegion(from: 'settings' | 'map'): void;
  /** The ? sheet (MEGACITY §14.3): Menu › How to play › Keyboard shortcuts. */
  openShortcuts(): void;
  /** Open a toolbar tray by category id (used by the onboarding coach). */
  openTray(category: string): void;
  closeTray(): void;
}

export interface UIContext {
  readonly game: Game;
  readonly camera: Camera;
  readonly root: HTMLElement;
  readonly modals: Modals;
  readonly actions: UIActions;
  /** True on narrow (phone portrait) layouts: abbreviate figures, short labels. */
  compact: boolean;
  /**
   * The desktop layout (§14.1): DESK_QUERY matches (a mouse, at least 1024×600). Side panels, the compact dock rule and
   * the key hints follow it; phones, tablets and narrower windows never match.
   */
  desk: boolean;
  /** Fire a UI sound through the game's sfx bus. */
  sfx(kind: GameEventMap['sfx']): void;
}

/** The desktop layout (§14.1): a fine pointer that hovers, on a window of at least 1024×600. Watched live by ui.ts. */
export const DESK_QUERY = '(min-width: 1024px) and (min-height: 600px) and (hover: hover) and (pointer: fine)';

/** Input modality tracking (keyboard vs pointer) for focus decisions. */
let lastInputWasKeyboard = false;
/** The last input was a key press (any key), not a pointer: a panel opened now was opened from the keyboard. */
let lastInputKey = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) lastInputWasKeyboard = true;
    lastInputKey = true;
  }, true);
  window.addEventListener('pointerdown', () => {
    lastInputWasKeyboard = false;
    lastInputKey = false;
  }, true);
}

// ── Desktop geometry (§14.1; ui.css mirrors these numbers) ───────────────────

/** Side panel width: clamp(360px, 28vw, 440px) (360 at 1280, 403 at 1440, 440 at 1920). */
export function sidePanelWidth(W: number): number {
  return Math.round(Math.min(440, Math.max(360, W * 0.28)));
}

/** The panel's gap to the right edge, and the map area's gap to it (the camera's right inset is the width + 24). */
export const PANEL_GAP = 12;

/** Map area beside an open panel: 908 px at 1280×800, 1,025 at 1440×900, 1,468 at 1920×1080. */
export function mapAreaWidth(W: number): number {
  return W - sidePanelWidth(W) - PANEL_GAP;
}

/** The camera's right inset while a panel is open (§3.9, §14.1): the panel's width + 24 px. */
export function panelInset(W: number): number {
  return sidePanelWidth(W) + 2 * PANEL_GAP;
}

/** Toolbar buttons: 76 px, 60 px in the compact form, 2 px apart, 5 px padding each side (ui.css .cc-bar, .cc-tb). */
export const DOCK_BUTTON = 76;
export const DOCK_BUTTON_COMPACT = 60;

/** The toolbar's width with `n` buttons (9 × 76 ≈ 710 px; compact 9 × 60 ≈ 566). */
export function dockWidth(n: number, compact: boolean): number {
  return n * (compact ? DOCK_BUTTON_COMPACT : DOCK_BUTTON) + Math.max(0, n - 1) * 2 + 10;
}

/** The dock's room: 12 px from the left edge to 12 px from the right, or to the panel's width + 24 with a panel open. */
export function dockRoom(W: number, panel: boolean): number {
  return W - PANEL_GAP - (panel ? sidePanelWidth(W) + 2 * PANEL_GAP : PANEL_GAP);
}

/** The compact dock: only when the full one does not fit beside an open panel (windows under ≈ 1,110 px). */
export function dockCompact(W: number, n: number, panel: boolean): boolean {
  return panel && dockWidth(n, false) > dockRoom(W, true);
}

/** A panel opening now was opened from the keyboard (focus moves into it, §14.1). */
export function openedByKeyboard(): boolean {
  return lastInputKey;
}

interface ModalEntry {
  el: HTMLElement;
  onClose?: () => void;
  opener: HTMLElement | null;
}

/**
 * Stack of modal dialogs over a shared scrim. Dialog elements are persistent
 * (built once, shown/hidden); only the top one is visible. Tapping the scrim
 * or pressing Esc closes the top dialog.
 */
export class Modals {
  readonly layer: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly stack: ModalEntry[] = [];
  /** The desktop layout's side layer: side-capable dialogs open there while `desk` is on (§14.1). */
  readonly side: SideLayer;
  /** The desktop layout is on (set by the UI root). Turning it off closes a side dialog. */
  private _desk = false;
  /** Fired whenever the stack becomes empty / non-empty. */
  onChange: ((open: boolean) => void) | null = null;

  constructor(root: HTMLElement) {
    this.scrim = h('div', { class: 'cc-scrim' });
    this.layer = h('div', { class: 'cc-modal-layer', hidden: true }, this.scrim);
    this.scrim.addEventListener('click', () => this.closeTop());
    this.side = new SideLayer();
    root.append(this.side.layer, this.layer);
  }

  get desk(): boolean {
    return this._desk;
  }

  set desk(on: boolean) {
    if (on === this._desk) return;
    this._desk = on;
    // A side dialog lives in the side layer only on the desktop layout: leaving it closes the panel.
    if (!on) this.side.closeAll();
  }

  /** Modal dialogs open (a side dialog is not modal and is not counted). */
  get depth(): number {
    return this.stack.length;
  }

  isOpen(el: HTMLElement): boolean {
    return this.stack.some((m) => m.el === el) || this.side.isOpen(el);
  }

  isTop(el: HTMLElement): boolean {
    return this.stack.length > 0 && this.stack[this.stack.length - 1].el === el;
  }

  /**
   * Show `el` (a .cc-dialog) on top of the stack. Re-opening an open dialog brings it to the top. A dialog built with
   * `side: true` opens in the side layer instead while the desktop layout is on (no scrim, the city stays live).
   */
  open(el: HTMLElement, onClose?: () => void): void {
    if (this._desk && el.dataset.side === '1') {
      this.side.open(el, onClose);
      return;
    }
    if (el.parentElement !== this.layer) this.layer.append(el);
    const existing = this.stack.findIndex((m) => m.el === el);
    if (existing >= 0) this.stack.splice(existing, 1);
    const prevTop = this.stack[this.stack.length - 1];
    if (prevTop) prevTop.el.classList.add('is-under');
    const active = document.activeElement as HTMLElement | null;
    this.stack.push({ el, onClose, opener: active && active !== document.body ? active : null });
    el.classList.remove('is-under', 'is-out');
    el.hidden = false;
    this.layer.hidden = false;
    replayClass(el, 'is-in');
    // Move focus into the dialog. Keyboard users land on its primary control;
    // touch / mouse users get the container (no stray focus ring).
    const focusTarget = (lastInputWasKeyboard ? el.querySelector<HTMLElement>('[data-autofocus]') : null) ?? el;
    try {
      focusTarget.focus({ preventScroll: true });
    } catch {
      /* old browsers */
    }
    if (this.stack.length === 1) this.onChange?.(true);
  }

  /** Close a specific dialog (no-op when it is not open). */
  close(el: HTMLElement): void {
    if (this.side.isOpen(el)) {
      this.side.close(el);
      return;
    }
    const i = this.stack.findIndex((m) => m.el === el);
    if (i < 0) return;
    const [entry] = this.stack.splice(i, 1);
    const finish = () => {
      if (!this.isOpen(el)) {
        el.hidden = true;
        el.classList.remove('is-out');
      }
    };
    el.classList.remove('is-in');
    if (prefersReducedMotion()) finish();
    else {
      el.classList.add('is-out');
      window.setTimeout(finish, 150);
    }
    const top = this.stack[this.stack.length - 1];
    if (top) {
      top.el.classList.remove('is-under');
      replayClass(top.el, 'is-in');
    } else {
      this.layer.hidden = true;
      this.onChange?.(false);
    }
    try {
      entry.opener?.focus({ preventScroll: true });
    } catch {
      /* element gone */
    }
    entry.onClose?.();
  }

  /** Close the top dialog. Returns false when nothing was open. */
  closeTop(): boolean {
    const top = this.stack[this.stack.length - 1];
    if (!top) return false;
    this.close(top.el);
    return true;
  }

  /** Close every dialog, the side panel's dialog too (Main menu, New City, the City map, a world swap). */
  closeAll(): void {
    while (this.closeTop()) {
      /* drain */
    }
    this.side.closeAll();
  }
}

/**
 * Standard dialog chrome: header with title, optional subtitle + close button, scrollable body, optional footer.
 * `side`: on the desktop layout the dialog opens as the side panel (Modals routes it to the side layer, §14.1).
 */
export function buildDialog(opts: { id: string; title: string; icon?: string; wide?: boolean; side?: boolean }): {
  el: HTMLElement;
  head: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  closeBtn: HTMLButtonElement;
} {
  const title = h('h2', { class: 'cc-dlg-title', id: `${opts.id}-title`, text: opts.title });
  const sub = h('div', { class: 'cc-dlg-sub' });
  const closeBtn = h('button', { class: 'cc-iconbtn cc-dlg-close', type: 'button', 'aria-label': 'Close', 'data-close': true, html: icon('close') });
  const head = h(
    'header',
    { class: 'cc-dlg-head' },
    opts.icon ? h('span', { class: 'cc-dlg-icon', html: opts.icon }) : null,
    h('div', { class: 'cc-dlg-titles' }, title, sub),
    closeBtn,
  );
  const body = h('div', { class: 'cc-dlg-body' });
  const foot = h('footer', { class: 'cc-dlg-foot', hidden: true });
  const el = h(
    'section',
    {
      class: `cc-dialog cc-panel${opts.wide ? ' is-wide' : ''}`,
      id: opts.id,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': `${opts.id}-title`,
      tabindex: '-1',
      hidden: true,
      'data-side': opts.side ? '1' : undefined,
    },
    head,
    body,
    foot,
  );
  return { el, head, title, sub, body, foot, closeBtn };
}

// ── Desktop side layer (§14.1) ───────────────────────────────────────────────

/**
 * The desktop layout's side layer: one side dialog at a time, docked right (CSS), non-modal (no scrim; the city stays
 * live, pannable and buildable). The dialog reads as a complementary region there, not a dialog; it gets focus only
 * when it was opened from the keyboard, and gives focus back (to the page, so the game's keys work) when it closes.
 */
export class SideLayer {
  readonly layer: HTMLElement;
  private cur: { el: HTMLElement; onClose?: () => void } | null = null;

  constructor() {
    this.layer = h('div', { class: 'cc-side-layer' });
  }

  get current(): HTMLElement | null {
    return this.cur?.el ?? null;
  }

  isOpen(el: HTMLElement): boolean {
    return this.cur?.el === el;
  }

  open(el: HTMLElement, onClose?: () => void): void {
    if (this.cur && this.cur.el !== el) this.close(this.cur.el);
    if (this.cur?.el === el) return;
    if (el.parentElement !== this.layer) this.layer.append(el);
    this.cur = { el, onClose };
    el.classList.add('is-side');
    el.classList.remove('is-under', 'is-out');
    el.setAttribute('role', 'complementary');
    el.removeAttribute('aria-modal');
    el.hidden = false;
    replayClass(el, 'is-in');
    if (openedByKeyboard()) {
      try {
        (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus({ preventScroll: true });
      } catch {
        /* old browsers */
      }
    }
  }

  close(el: HTMLElement): void {
    const c = this.cur;
    if (!c || c.el !== el) return;
    this.cur = null;
    el.hidden = true;
    el.classList.remove('is-in', 'is-side');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    // Back to the canvas (the page): the game's keys go to the window again.
    const a = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (a && el.contains(a)) a.blur();
    c.onClose?.();
  }

  closeAll(): void {
    if (this.cur) this.close(this.cur.el);
  }
}

// ── Side panels (§14.1) ──────────────────────────────────────────────────────

/** Every surface that opens as the side panel on the desktop layout. */
export type PanelId = 'inspect' | 'card' | 'goals' | 'factions' | 'comms' | 'report' | 'budget' | 'news' | 'shortcuts' | 'citymap';

/** One side-panel surface, as the host polls and drives it (its own open and close paths stay its own). */
export interface PanelSurface {
  /** Open now (a parked card still counts as open). */
  isOpen(): boolean;
  /** Close it because another surface took the panel. */
  close(): void;
  /** Open it again: the panel that replaced it closed (Back, or the story card was answered). */
  reopen(): void;
  /** The story card cannot be closed by another panel: it parks (hides, stays open) and comes back. */
  park?(on: boolean): void;
}

/** Surfaces that may open a story card from inside them: the card then shows Back (§14.1, one level). */
const NESTS_CARD: ReadonlySet<PanelId> = new Set<PanelId>(['goals', 'comms', 'factions']);

/**
 * The side-panel host (§14.1): one surface at a time on the desktop layout. Polled once a frame by the UI root:
 *
 * - a surface that opens replaces the current one (closing it); the story card cannot be closed, so it parks under
 *   the new panel and comes back when that one closes;
 * - a story card takes the panel and the panel it replaced returns when the card closes;
 * - a card opened from the Goals drawer or COMMS (the sheet closed as the card opened) is nested: Back shows, and the
 *   sheet returns when the card closes;
 * - the City map replaces any panel and gives nothing back.
 *
 * Off the desktop layout it does nothing (phones keep their sheets and dialogs as they are).
 */
export class SidePanels {
  private _desk = false;
  /** The surface showing as the side panel now. */
  current: PanelId | null = null;
  /** The panel that returns when the current one closes (one level). */
  ret: PanelId | null = null;
  /** The current panel was opened from inside `ret`: Back shows in its header. */
  nested = false;
  /** The story card parked under the current panel. */
  parked: PanelId | null = null;
  private readonly surfaces = new Map<PanelId, PanelSurface>();
  private was = new Set<PanelId>();
  /** Fired when the current panel, its return or its Back changes. */
  onChange: (() => void) | null = null;

  register(id: PanelId, s: PanelSurface): void {
    this.surfaces.set(id, s);
  }

  get desk(): boolean {
    return this._desk;
  }

  set desk(on: boolean) {
    if (on === this._desk) return;
    this._desk = on;
    if (!on) this.reset();
  }

  /** Forget the panel state (a world swap, the layout leaving the desktop): a parked card shows again. */
  reset(): void {
    if (this.parked) this.surfaces.get(this.parked)?.park?.(false);
    const changed = this.current !== null || this.ret !== null;
    this.current = null;
    this.ret = null;
    this.nested = false;
    this.parked = null;
    this.was = new Set();
    if (changed) this.onChange?.();
  }

  /** Back (or Esc on a nested panel): close the current panel; the one it came from returns. */
  back(): boolean {
    if (!this.current || !this.ret) return false;
    this.surfaces.get(this.current)?.close();
    this.update();
    return true;
  }

  /** Close the current panel (Esc, ✕): its return (a parked card, the panel a card replaced) comes back. */
  closeCurrent(): boolean {
    if (!this.current) return false;
    this.surfaces.get(this.current)?.close();
    this.update();
    return true;
  }

  /** Once a frame: notice surfaces that opened or closed and keep one panel showing. */
  update(): void {
    if (!this._desk) return;
    const open = new Set<PanelId>();
    for (const [id, s] of this.surfaces) if (s.isOpen()) open.add(id);
    let changed = false;
    // A parked card answered meanwhile (it cannot be, hidden, but a world swap or the game may close it).
    if (this.parked && !open.has(this.parked)) {
      this.surfaces.get(this.parked)?.park?.(false);
      if (this.ret === this.parked) this.ret = null;
      this.parked = null;
      changed = true;
    }
    const fresh: PanelId[] = [];
    for (const id of open) if (!this.was.has(id) && id !== this.parked) fresh.push(id);
    if (fresh.length) {
      // Two at once (rare): the card wins, then the City map, then the first.
      const id = fresh.includes('card') ? 'card' : fresh.includes('citymap') ? 'citymap' : fresh[0];
      const prev = this.current;
      if (prev !== id) {
        let ret: PanelId | null = null;
        let nested = false;
        if (prev && open.has(prev) && prev !== this.parked) {
          const s = this.surfaces.get(prev);
          if (s?.park) {
            // The card parks under the new panel and comes back when it closes.
            s.park(true);
            this.parked = prev;
            ret = prev;
          } else {
            s?.close();
            open.delete(prev);
            if (id === 'card') ret = prev;
          }
        } else if (prev && id === 'card' && NESTS_CARD.has(prev)) {
          // The sheet closed as the card opened (a message read from the Goals drawer or COMMS): Back returns to it.
          ret = prev;
          nested = true;
        }
        if (!ret && this.parked && this.parked !== id) ret = this.parked;
        if (id === 'citymap') {
          // The City map replaces everything and gives nothing back (a parked card waits on).
          ret = this.parked;
        }
        this.current = id;
        this.ret = ret;
        this.nested = nested;
        changed = true;
      }
      for (const f of fresh) {
        if (f === id || !open.has(f)) continue;
        this.surfaces.get(f)?.close();
        open.delete(f);
      }
    }
    if (this.current && !open.has(this.current)) {
      const r = this.ret;
      this.current = null;
      this.ret = null;
      this.nested = false;
      changed = true;
      if (r && r === this.parked) {
        this.surfaces.get(r)?.park?.(false);
        this.parked = null;
        this.current = r;
      } else if (r) {
        this.surfaces.get(r)?.reopen();
        // It shows as fresh on the next poll (or now, when it opened synchronously).
        if (this.surfaces.get(r)?.isOpen()) {
          this.current = r;
          open.add(r);
          if (this.parked && this.parked !== r) this.ret = this.parked;
        }
      } else if (this.parked) {
        this.surfaces.get(this.parked)?.park?.(false);
        this.current = this.parked;
        this.parked = null;
      }
    }
    this.was = open;
    if (changed) this.onChange?.();
  }
}
