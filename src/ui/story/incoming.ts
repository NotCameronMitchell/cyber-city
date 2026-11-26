// ─────────────────────────────────────────────────────────────────────────────
// Incoming banner (docs/STORY.md §8.3, docs/PACING.md): a 44 px strip that
// slides up from the story rail when a message arrives: a faction card (it
// waits in COMMS) or a story message (beat, Silt Log, chapter reward: it waits
// on the goal chip). The game keeps running. Tap opens it; swipe down (or the
// 6 s timeout) leaves it waiting. One banner at a time.
// ─────────────────────────────────────────────────────────────────────────────

import type { Card, FactionId } from '../../game/story/types';
import type { UIContext } from '../context';
import { h, prefersReducedMotion, replayClass, setHtml, setStyle, setText } from '../dom';
import { icon } from '../icons';
import { swipeDown } from './gesture';
import { MOTH_COLOR, SYSTEM_COLOR, factionColor, factionShort, factionSigil, sigilImg } from './sigils';

/** What arrived, for the banner's kicker and its tap. */
export interface BannerMessage {
  id: string;
  title: string;
  faction: FactionId | null;
  kind?: Card['kind'];
  /** Speaker line ('MOTH', 'Ilse Marrow' …). */
  from?: string;
  /** 'story' opens with game.openWaiting(), 'comms' with game.openPending(). */
  slot: 'story' | 'comms';
}

/** "Incoming · Basalt", "Ultimatum · Kites", "Message · MOTH", "Silt Log recovered". */
export function bannerKicker(m: Pick<BannerMessage, 'faction' | 'kind' | 'from'>): string {
  const who = m.faction ? factionShort(m.faction) : m.from || 'MOTH';
  if (m.kind === 'log') return 'Silt Log recovered';
  if (m.kind === 'hostile') return `Ultimatum · ${who}`;
  if (m.kind === 'system') return `Notice · ${m.from || 'System'}`;
  if (m.kind === 'beat') return `Message · ${who}`;
  return `Incoming · ${who}`;
}

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
  private slot: BannerMessage['slot'] = 'comms';

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
      const slot = this.slot;
      this.hide(true);
      if (slot === 'story') this.ctx.game.openWaiting();
      else this.ctx.game.openPending();
    });
    swipeDown(this.el, { onSwipe: () => this.hide(false), threshold: 30 });
  }

  get isOpen(): boolean {
    return this.id !== null;
  }

  show(m: BannerMessage): void {
    this.id = m.id;
    this.slot = m.slot;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.hideTimer);
    const system = m.kind === 'system' && !m.faction;
    const color = m.faction ? factionColor(m.faction) : system ? SYSTEM_COLOR : MOTH_COLOR;
    setStyle(this.el, '--accent', color);
    setHtml(this.sig, m.faction ? factionSigil(m.faction, 28) : sigilImg(system ? 'system' : 'moth', color, 28));
    setText(this.kicker, bannerKicker(m));
    setText(this.title, m.title);
    this.el.setAttribute('aria-label', `${bannerKicker(m)}: ${m.title}. Tap to read.`);
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
