// ─────────────────────────────────────────────────────────────────────────────
// Story bottom sheet: the shared chrome of the goal drawer, faction sheet and
// COMMS. Grab handle + title row on top, a scrolling body, an optional footer
// pinned in the thumb zone. Swipe down on the header (or the body when it is
// scrolled to the top) closes it; so do the scrim, Esc and the close button.
// Sizes: 'half' (50 %), 'tall' (60 %, expandable to full), 'full'.
// On the desktop layout (.cc-desk, MEGACITY §14.1) the same sheet is the side
// panel: docked right, full height, no scrim (story.css); the swipe stays a
// touch gesture there and the sheet is not modal.
// ─────────────────────────────────────────────────────────────────────────────

import { h, replayClass, setClass, setText } from '../dom';
import { icon } from '../icons';
import { swipeDown } from './gesture';

export type SheetSize = 'half' | 'tall' | 'full';

export class StorySheet {
  readonly el: HTMLElement;
  readonly head: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly subEl: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  readonly closeBtn: HTMLButtonElement;
  private expanded = false;
  private _open = false;
  /** Set by the story UI: called after the sheet closes. */
  onClosed: (() => void) | null = null;

  constructor(
    cls: string,
    title: string,
    readonly size: SheetSize,
    opts: { expandable?: boolean; footFirst?: boolean } = {},
  ) {
    this.titleEl = h('h2', { class: 'cc-ss-title', text: title });
    this.subEl = h('div', { class: 'cc-ss-sub' });
    this.closeBtn = h('button', { class: 'cc-iconbtn cc-ss-close', type: 'button', 'aria-label': 'Close', html: icon('close') });
    this.head = h(
      'header',
      { class: 'cc-ss-head' },
      h('span', { class: 'cc-ss-grab', 'aria-hidden': 'true' }),
      h('div', { class: 'cc-ss-titles' }, this.titleEl, this.subEl),
      opts.expandable ? h('button', { class: 'cc-iconbtn cc-ss-expand', type: 'button', 'aria-label': 'Expand', 'data-act': 'expand', html: icon('chevron') }) : null,
      this.closeBtn,
    );
    this.body = h('div', { class: 'cc-ss-body' });
    this.foot = h('footer', { class: 'cc-ss-foot', hidden: true });
    this.el = h(
      'section',
      { class: `cc-ss cc-panel ${cls}`, 'data-size': size, hidden: true, role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
      this.head,
      this.body,
      this.foot,
    );
    this.closeBtn.addEventListener('click', () => this.close());
    this.head.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="expand"]')) this.setExpanded(!this.expanded);
    });
    swipeDown(this.el, {
      canStart: (t, e) => {
        if (t.closest('button, input, a')) return false;
        // The side panel (§14.1): a mouse never drags it; touch keeps the swipe.
        if (e.pointerType === 'mouse' && this.el.closest('.cc-desk')) return false;
        if (this.head.contains(t)) return true;
        return this.body.contains(t) && this.body.scrollTop <= 0 && this.size !== 'full';
      },
      onSwipe: () => this.close(),
      threshold: 90,
    });
  }

  get isOpen(): boolean {
    return this._open;
  }

  setTitle(title: string, sub = ''): void {
    setText(this.titleEl, title);
    setText(this.subEl, sub);
    this.subEl.hidden = !sub;
  }

  setExpanded(on: boolean): void {
    this.expanded = on;
    setClass(this.el, 'is-expanded', on);
  }

  open(): void {
    if (this._open) return;
    this._open = true;
    this.setExpanded(false);
    // A side panel on the desktop layout is not modal: the city beside it stays live (§14.1).
    this.el.setAttribute('aria-modal', this.el.closest('.cc-desk') ? 'false' : 'true');
    this.el.hidden = false;
    replayClass(this.el, 'is-in');
    try {
      this.el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this.el.hidden = true;
    this.onClosed?.();
  }
}
