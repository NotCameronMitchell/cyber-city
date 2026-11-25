// ─────────────────────────────────────────────────────────────────────────────
// Shared context handed to every UI component, plus the modal stack.
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
  /** Fire a UI sound through the game's sfx bus. */
  sfx(kind: GameEventMap['sfx']): void;
}

/** Input modality tracking (keyboard vs pointer) for focus decisions. */
let lastInputWasKeyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) lastInputWasKeyboard = true;
  }, true);
  window.addEventListener('pointerdown', () => (lastInputWasKeyboard = false), true);
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
  /** Fired whenever the stack becomes empty / non-empty. */
  onChange: ((open: boolean) => void) | null = null;

  constructor(root: HTMLElement) {
    this.scrim = h('div', { class: 'cc-scrim' });
    this.layer = h('div', { class: 'cc-modal-layer', hidden: true }, this.scrim);
    this.scrim.addEventListener('click', () => this.closeTop());
    root.append(this.layer);
  }

  get depth(): number {
    return this.stack.length;
  }

  isOpen(el: HTMLElement): boolean {
    return this.stack.some((m) => m.el === el);
  }

  isTop(el: HTMLElement): boolean {
    return this.stack.length > 0 && this.stack[this.stack.length - 1].el === el;
  }

  /** Show `el` (a .cc-dialog) on top of the stack. Re-opening an open dialog brings it to the top. */
  open(el: HTMLElement, onClose?: () => void): void {
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

  closeAll(): void {
    while (this.closeTop()) {
      /* drain */
    }
  }
}

/** Standard dialog chrome: header with title, optional subtitle + close button, scrollable body, optional footer. */
export function buildDialog(opts: { id: string; title: string; icon?: string; wide?: boolean }): {
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
    },
    head,
    body,
    foot,
  );
  return { el, head, title, sub, body, foot, closeBtn };
}
