// ─────────────────────────────────────────────────────────────────────────────
// Story card (docs/STORY.md §8.2): the bottom sheet for beats, faction cards,
// ⚑ cards, system cards, Silt Logs and ending cards.
//
//   3 px faction edge · 56 px header (48 px sigil, speaker, faction)
//   sys line · title · body (typewriter, scrolls if needed)
//   up to 4 choices (52 px; 68 px when the label wraps) with hint chips
//   footer: Later (faction cards) · "auto in 14d" ("auto soon" on the last day)
//
// When the body overflows its area a chevron and edge glow say "more below".
// The first card with hint chips carries a one-time legend line for them.
//
// Press-and-hold anywhere that is not a button fades the card to 15% so the
// player can peek at the map. Swipe down = Later (faction cards only).
// Long-press a choice for its exact effects; a tap on a locked choice shakes
// it and repeats the reason as a toast. Choices ignore taps for 600 ms.
// ─────────────────────────────────────────────────────────────────────────────

import { storageGet, storageSet } from '../../game/game';
import type { CardView, Hint } from '../../game/story/types';
import type { UIContext } from '../context';
import { esc, h, prefersReducedMotion, replayClass, setClass, setHidden, setStyle, setText } from '../dom';
import { icon } from '../icons';
import { longPress, swipeDown } from './gesture';
import { hintRow } from './hints';
import { factionColor, factionName, factionSigil, sigilImg, speakerMark } from './sigils';

const CPS = 60;
const ARM_MS = 600;
const PEEK_MS = 300;
const LEGEND_KEY = 'cybercity.ui.hintlegend.v1';

/** "auto in 14d", or "auto soon" once the days have run out (the real-time floor still holds it). */
export function autoLabel(days: number): string {
  return days >= 1 ? `auto in ${Math.ceil(days)}d` : 'auto soon';
}

const KIND_LABEL: Record<CardView['kind'], string> = {
  beat: 'Transmission',
  faction: 'Incoming',
  hostile: 'Ultimatum',
  system: 'System',
  log: 'Silt Log',
  ending: 'Ending',
  whisper: 'Whisper',
};

export class StoryCard {
  readonly el: HTMLElement;
  private readonly edge: HTMLElement;
  private readonly sig: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly faction: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly sys: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly shown: HTMLElement;
  private readonly rest: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly more: HTMLElement;
  private readonly legend: HTMLElement;
  private legendSeen: boolean;
  private moreAt = 0;
  private readonly foot: HTMLElement;
  private readonly laterBtn: HTMLButtonElement;
  private readonly auto: HTMLElement;
  private readonly pop: HTMLElement;

  /** Card currently on screen (null = hidden). */
  card: CardView | null = null;
  private text = '';
  private typed = 0;
  private typeStart = 0;
  private armedAt = 0;
  private busy = false;
  private busyAt = 0;
  private peekTimer = 0;
  /** Called when the card wants the scrim to fade for a peek. */
  onPeek: ((on: boolean) => void) | null = null;
  /** Last ending card body seen (the ending screen shows it again). */
  lastEndingBody = '';

  constructor(private readonly ctx: UIContext) {
    this.edge = h('span', { class: 'cc-scard-edge' });
    this.sig = h('span', { class: 'cc-scard-sig' });
    this.speaker = h('span', { class: 'cc-scard-speaker' });
    this.faction = h('span', { class: 'cc-scard-faction' });
    this.kind = h('span', { class: 'cc-scard-kind' });
    this.sys = h('div', { class: 'cc-scard-sys' });
    this.title = h('h2', { class: 'cc-scard-title', id: 'cc-scard-title' });
    this.shown = h('span');
    this.rest = h('span', { class: 'cc-tw-rest', 'aria-hidden': 'true' });
    this.body = h('p', { class: 'cc-scard-body' }, this.shown, this.rest);
    this.scroll = h('div', { class: 'cc-scard-scroll' }, this.sys, this.title, this.body);
    this.choices = h('div', { class: 'cc-scard-choices', role: 'group', 'aria-label': 'Choices' });
    this.more = h('div', { class: 'cc-scard-more', 'aria-hidden': 'true', html: icon('chevron') });
    this.legendSeen = storageGet(LEGEND_KEY) === '1';
    this.legend = h(
      'div',
      { class: 'cc-scard-legend', hidden: true },
      h('span', { class: 'cc-scard-legend-row' }, h('span', { class: 'cc-scard-legend-k', html: '<b class="is-up">▲</b><b class="is-down">▼</b>' }), h('span', { text: 'How a faction will feel' })),
      h('span', { class: 'cc-scard-legend-row' }, h('span', { class: 'cc-scard-legend-k', html: icon('eye') }), h('span', { text: 'Trace: how close anyone is to finding you' })),
      h('span', { class: 'cc-scard-legend-tip', text: 'Hold a choice to see exactly what it does.' }),
    );
    this.laterBtn = h('button', { class: 'cc-scard-later', type: 'button', 'data-act': 'later' }, h('span', { html: icon('comms') }), h('span', { text: 'Later' }));
    this.auto = h('span', { class: 'cc-scard-auto' });
    this.foot = h('footer', { class: 'cc-scard-foot' }, this.laterBtn, this.auto);
    this.pop = h('div', { class: 'cc-scard-pop', hidden: true, role: 'tooltip' });
    this.el = h(
      'section',
      { class: 'cc-scard cc-panel', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cc-scard-title', tabindex: '-1' },
      this.edge,
      h('header', { class: 'cc-scard-head' }, this.sig, h('div', { class: 'cc-scard-who' }, this.speaker, this.faction), this.kind),
      this.scroll,
      this.more,
      this.legend,
      this.choices,
      this.foot,
      this.pop,
    );
    this.scroll.addEventListener('scroll', () => this.checkMore(), { passive: true });

    this.el.addEventListener('click', this.onClick);
    this.body.addEventListener('click', () => this.finishTyping());

    // Long-press a choice: exact effects popover.
    longPress(
      this.choices,
      '.cc-choice',
      400,
      (btn) => this.showEffects(btn),
      () => setHidden(this.pop, true),
    );

    // Hold anything that is not a button: peek at the map.
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      window.clearTimeout(this.peekTimer);
      this.peekTimer = window.setTimeout(() => this.setPeek(true), PEEK_MS);
    });
    const endPeek = () => {
      window.clearTimeout(this.peekTimer);
      this.setPeek(false);
    };
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) this.el.addEventListener(t, endPeek);

    swipeDown(this.el, {
      canStart: (t) => !!this.card?.canLater && !t.closest('button') && !(this.scroll.contains(t) && this.scroll.scrollTop > 0),
      onSwipe: () => this.later(),
    });
  }

  get isOpen(): boolean {
    return this.card !== null;
  }

  /** Show (or replace) the open card. */
  show(card: CardView): void {
    const same = this.card?.id === card.id;
    this.card = card;
    this.busy = false;
    if (card.kind === 'ending') this.lastEndingBody = card.body;
    const mark = speakerMark(card);
    const color = card.faction ? factionColor(card.faction) : mark.color;
    setStyle(this.el, '--accent', color);
    setStyle(this.el, '--fc', color);
    this.el.dataset.kind = card.kind;
    let sig = sigilImg(mark.kind, mark.color, 48, 'cc-scard-sigimg');
    if (card.with) sig += factionSigil(card.with, 30, 'cc-scard-sigwith');
    this.sig.innerHTML = sig;
    setText(this.speaker, card.speakerName || (card.faction ? factionName(card.faction) : 'MOTH'));
    const fname = card.faction ? factionName(card.faction) + (card.with ? ` · ${factionName(card.with)}` : '') : card.kind === 'log' ? 'Pump Station 6' : '';
    setText(this.faction, fname);
    setHidden(this.faction, !fname);
    this.kind.innerHTML = (card.kind === 'hostile' ? icon('flag') : '') + `<span>${esc(KIND_LABEL[card.kind])}</span>`;
    setText(this.sys, card.sys ?? '');
    setHidden(this.sys, !card.sys);
    setText(this.title, card.title);
    if (!same) {
      this.text = card.body;
      this.typed = prefersReducedMotion() ? card.body.length : 0;
      this.typeStart = performance.now();
      this.armedAt = performance.now() + ARM_MS;
      this.renderTyping();
      this.scroll.scrollTop = 0;
    }
    this.renderChoices(card);
    // One-time legend for the hint chips, on the first card that has favor or Trace chips.
    const legend = !this.legendSeen && card.choices.some((c) => c.hints.some((x: Hint) => x.k === 'favor' || x.k === 'trace'));
    setHidden(this.legend, !legend);
    setHidden(this.laterBtn, !card.canLater);
    const auto = card.autoInDays;
    setText(this.auto, auto !== undefined && auto !== null ? autoLabel(auto) : '');
    setHidden(this.foot, !card.canLater && (auto === undefined || auto === null));
    setHidden(this.pop, true);
    if (!same) {
      this.el.hidden = false;
      replayClass(this.el, 'is-in');
      try {
        this.el.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    this.checkMore();
  }

  hide(): void {
    if (!this.card) return;
    if (!this.legend.hidden) this.markLegendSeen();
    this.card = null;
    this.busy = false;
    this.setPeek(false);
    this.el.hidden = true;
  }

  /** Per frame while open: typewriter. */
  update(): void {
    if (this.busy && performance.now() - this.busyAt > 1500) this.busy = false; // the director ignored it: re-arm
    if (!this.card || this.typed >= this.text.length) return;
    const n = Math.min(this.text.length, Math.floor(((performance.now() - this.typeStart) / 1000) * CPS));
    if (n !== this.typed) {
      this.typed = n;
      this.renderTyping();
    }
  }

  private finishTyping(): void {
    if (this.typed >= this.text.length) return;
    this.typed = this.text.length;
    this.renderTyping();
  }

  private renderTyping(): void {
    setText(this.shown, this.text.slice(0, this.typed));
    setText(this.rest, this.text.slice(this.typed));
    const typing = this.typed < this.text.length;
    setClass(this.body, 'is-typing', typing);
    // The untyped rest is laid out (invisible), so overflow is known from the first frame;
    // re-measure a few times a second while typing, and once at the end.
    const now = performance.now();
    if (!typing || now - this.moreAt > 250) {
      this.moreAt = now;
      this.checkMore();
    }
  }

  /** "More below" cue when the body area scrolls and is not at its end. */
  private checkMore(): void {
    const sc = this.scroll;
    setClass(this.el, 'has-more', !!this.card && sc.scrollHeight - sc.scrollTop - sc.clientHeight > 6);
  }

  private markLegendSeen(): void {
    this.legendSeen = true;
    setHidden(this.legend, true);
    storageSet(LEGEND_KEY, '1');
  }

  private renderChoices(card: CardView): void {
    let html = '';
    const list = card.choices.length ? card.choices : [{ label: 'Continue.', hints: [], effectsText: '', isDefault: false }];
    list.forEach((c, i) => {
      const locked = 'locked' in c && c.locked ? c.locked : '';
      const long = c.label.length > 34;
      const hints = locked ? `<span class="cc-choice-lock">${icon('lock')}<span>${esc(locked)}</span></span>` : hintRow(c.hints);
      html +=
        `<button class="cc-choice${locked ? ' is-locked' : ''}${long ? ' is-long' : ''}${c.isDefault ? ' is-default' : ''}" type="button" data-i="${i}"` +
        `${locked ? ' aria-disabled="true"' : ''}>` +
        `<span class="cc-choice-label">${esc(c.label)}${c.isDefault ? `<span class="cc-choice-def" title="Default if left unanswered">${icon('clock')}</span>` : ''}</span>` +
        (hints ? `<span class="cc-choice-hints">${hints}</span>` : '') +
        `</button>`;
    });
    if (this.choices.dataset.html !== html) {
      this.choices.dataset.html = html;
      this.choices.innerHTML = html;
    }
  }

  private showEffects(btn: HTMLElement): void {
    const i = Number(btn.dataset.i);
    const c = this.card?.choices[i];
    if (!c) return;
    const text = c.locked ? c.locked : c.effectsText || 'No visible effect.';
    setText(this.pop, text);
    setHidden(this.pop, false);
    const r = btn.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    setStyle(this.pop, 'bottom', `${Math.round(host.bottom - r.top + 6)}px`);
  }

  private setPeek(on: boolean): void {
    setClass(this.el, 'is-peek', on);
    this.onPeek?.(on);
  }

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act="later"]')) {
      this.later();
      return;
    }
    const btn = t.closest<HTMLElement>('.cc-choice');
    if (!btn || !this.card) return;
    const i = Number(btn.dataset.i);
    const c = this.card.choices[i];
    if (c?.locked) {
      replayClass(btn, 'is-shake');
      this.ctx.game.toast(c.locked, 'info');
      this.ctx.sfx('error');
      return;
    }
    if (performance.now() < this.armedAt || this.busy) return;
    if (this.typed < this.text.length) this.finishTyping();
    if (!this.legend.hidden) this.markLegendSeen();
    this.busy = true;
    this.busyAt = performance.now();
    setClass(btn, 'is-picked', true);
    this.ctx.game.choose(i);
  };

  private later(): void {
    if (!this.card?.canLater || this.busy) return;
    this.busy = true;
    this.busyAt = performance.now();
    this.ctx.game.later();
  }
}
