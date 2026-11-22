// ─────────────────────────────────────────────────────────────────────────────
// Incoming banner (docs/STORY.md §8.3): a 44 px strip that slides up from the
// story rail when a faction card arrives. Tap opens the card; swipe down (or
// the 6 s timeout) leaves it waiting in COMMS. One banner at a time.
// ─────────────────────────────────────────────────────────────────────────────

import type { FactionId } from '../../game/story/types';
import type { UIContext } from '../context';
import { h, prefersReducedMotion, replayClass, setHtml, setStyle, setText } from '../dom';
import { icon } from '../icons';
import { swipeDown } from './gesture';
import { factionColor, factionShort, factionSigil } from './sigils';

const SHOW_MS = 6000;

export class IncomingBanner {
  readonly el: HTMLElement;
  private readonly sig: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private timer = 0;
  private hideTimer = 0;
  /** Id of the card on the banner (null = hidden). */
  id: string | null = null;

  constructor(
    private readonly ctx: UIContext,
    private readonly placeAbove: () => number | null,
  ) {
    this.sig = h('span', { class: 'cc-inc-sig' });
    this.kicker = h('span', { class: 'cc-inc-kicker' });
    this.title = h('span', { class: 'cc-inc-title' });
    this.el = h(
      'button',
      { class: 'cc-incoming cc-chipglass', type: 'button', hidden: true, 'aria-live': 'polite' },
      this.sig,
      h('span', { class: 'cc-inc-text' }, this.kicker, this.title),
      h('span', { class: 'cc-inc-go', html: icon('chevron') }),
    );
    this.el.addEventListener('click', () => {
      if (!this.id) return;
      this.hide(true);
      this.ctx.game.openPending();
    });
    swipeDown(this.el, { onSwipe: () => this.hide(false), threshold: 30 });
  }

  get isOpen(): boolean {
    return this.id !== null;
  }

  show(id: string, title: string, faction: FactionId): void {
    this.id = id;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.hideTimer);
    setStyle(this.el, '--accent', factionColor(faction));
    setHtml(this.sig, factionSigil(faction, 28));
    setText(this.kicker, `Incoming · ${factionShort(faction)}`);
    setText(this.title, title);
    const top = this.placeAbove();
    setStyle(this.el, 'bottom', top !== null ? `${Math.round(window.innerHeight - top + 8)}px` : '');
    this.el.classList.remove('is-out');
    this.el.hidden = false;
    replayClass(this.el, 'is-in');
    this.timer = window.setTimeout(() => this.hide(false), SHOW_MS);
  }

  /** Hide; `instant` skips the slide-out. */
  hide(instant: boolean): void {
    if (!this.id) return;
    this.id = null;
    window.clearTimeout(this.timer);
    if (instant || prefersReducedMotion()) {
      this.el.hidden = true;
      return;
    }
    this.el.classList.add('is-out');
    this.hideTimer = window.setTimeout(() => {
      if (!this.id) this.el.hidden = true;
      this.el.classList.remove('is-out');
    }, 220);
  }
}
