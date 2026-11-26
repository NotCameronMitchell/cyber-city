// ─────────────────────────────────────────────────────────────────────────────
// Story card (docs/STORY.md §8.2): the bottom sheet for beats, faction cards,
// ⚑ cards, system cards, Silt Logs and ending cards.
//
//   3 px faction edge · 56 px header (48 px sigil, speaker, faction; the
//     speaker line is a "who is this?" button for faction speakers)
//   sys line · title · "What's going on" (Card.brief, plain language) ·
//     [who is this: name, leader, standing, Faction.about — open on first
//     meeting, under the brief so the card still opens on what's going on] ·
//     body (typewriter); this whole block scrolls, the choices never move
//   up to 4 choices (52 px; 68 px when the label wraps), each with a plain
//     summary of what it does ("Basalt ++ · Trace +3 · −1,200 CR")
//   footer: Later (messages: COMMS cards and story messages) · "auto in 14d"
//
// When the text overflows its area a chevron and edge glow say "more below".
// The first card with favor or Trace effects carries a one-time legend line
// (deferred past a faction's first card, whose intro already takes the room).
//
// Press-and-hold anywhere that is not a button fades the card to 15% so the
// player can peek at the map. Swipe down = Later (faction cards only).
// Long-press a choice for its exact effects; a tap on a locked choice shakes
// it and repeats the reason as a toast. Choices ignore taps for 600 ms.
// Desktop layout (MEGACITY §14.1): the card is the side panel (story.css):
// not modal, no scrim, the peek and the swipe stay touch gestures; parked
// (.is-parked, hidden but still open) while another panel takes its place.
// ─────────────────────────────────────────────────────────────────────────────

import { storageGet, storageSet } from '../../game/game';
import type { CardView, Hint, StoryView } from '../../game/story/types';
import type { UIContext } from '../context';
import { esc, h, prefersReducedMotion, replayClass, setClass, setHidden, setHtml, setStyle, setText } from '../dom';
import { MINUS } from '../format';
import { icon } from '../icons';
import { longPress, swipeDown } from './gesture';
import { hintSummary } from './hints';
import { TIER_COLOR, TIER_WORD, factionColor, factionName, factionSigil, sigilImg, speakerMark } from './sigils';

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
  private readonly who: HTMLButtonElement;
  private readonly whoHint: HTMLElement;
  private readonly about: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly briefText: HTMLElement;
  private aboutOpen = false;
  private aboutFor: string | null = null;
  private factions: StoryView['factions'] = [];
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
    this.whoHint = h('span', { class: 'cc-scard-whohint', html: `${icon('info')}<span>Who is this?</span>` });
    // The speaker line doubles as the "who is this?" button for faction speakers.
    this.who = h('button', { class: 'cc-scard-who', type: 'button', 'data-act': 'who', 'aria-expanded': 'false' }, this.speaker, h('span', { class: 'cc-scard-whorow' }, this.faction, this.whoHint));
    this.kind = h('span', { class: 'cc-scard-kind' });
    this.about = h('div', { class: 'cc-scard-about', hidden: true, role: 'note' });
    this.sys = h('div', { class: 'cc-scard-sys' });
    this.title = h('h2', { class: 'cc-scard-title', id: 'cc-scard-title' });
    this.briefText = h('p', { class: 'cc-brief-text' });
    this.brief = h('div', { class: 'cc-scard-brief', hidden: true, role: 'note' }, h('div', { class: 'cc-brief-k', html: `${icon('info')}<span>What's going on</span>` }), this.briefText);
    this.shown = h('span');
    this.rest = h('span', { class: 'cc-tw-rest', 'aria-hidden': 'true' });
    this.body = h('p', { class: 'cc-scard-body' }, this.shown, this.rest);
    // The intro sits under "What's going on", so a faction's first card still opens on its
    // title and plain-language brief; the in-voice body follows the intro.
    this.scroll = h('div', { class: 'cc-scard-scroll' }, this.sys, this.title, this.brief, this.about, this.body);
    this.choices = h('div', { class: 'cc-scard-choices', role: 'group', 'aria-label': 'Choices' });
    this.more = h('div', { class: 'cc-scard-more', 'aria-hidden': 'true', html: icon('chevron') });
    this.legendSeen = storageGet(LEGEND_KEY) === '1';
    this.legend = h(
      'div',
      { class: 'cc-scard-legend', hidden: true },
      h('span', { class: 'cc-scard-legend-row' }, h('span', { class: 'cc-scard-legend-k', html: `<b class="is-up">+</b><b class="is-down">${MINUS}</b>` }), h('span', { text: 'How that faction will feel about it (more signs, more feeling)' })),
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
      h('header', { class: 'cc-scard-head' }, this.sig, this.who, this.kind),
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
      // The side panel sits beside the map: nothing to peek at with a mouse (§14.1).
      if (this.ctx.desk && e.pointerType === 'mouse') return;
      window.clearTimeout(this.peekTimer);
      this.peekTimer = window.setTimeout(() => this.setPeek(true), PEEK_MS);
    });
    const endPeek = () => {
      window.clearTimeout(this.peekTimer);
      this.setPeek(false);
    };
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) this.el.addEventListener(t, endPeek);

    swipeDown(this.el, {
      canStart: (t, e) =>
        !(this.ctx.desk && e.pointerType === 'mouse') && !!this.card?.canLater && !t.closest('button') && !(this.scroll.contains(t) && this.scroll.scrollTop > 0),
      onSwipe: () => this.later(),
    });
  }

  get isOpen(): boolean {
    return this.card !== null;
  }

  /** Show (or replace) the open card; `v` gives the speaker's faction row for "who is this?". */
  show(card: CardView, v?: StoryView): void {
    const same = this.card?.id === card.id;
    this.card = card;
    this.busy = false;
    if (v) this.factions = v.factions;
    if (card.kind === 'ending') this.lastEndingBody = card.body;
    const mark = speakerMark(card);
    const color = card.faction ? factionColor(card.faction) : mark.color;
    setStyle(this.el, '--accent', color);
    setStyle(this.el, '--fc', color);
    this.el.dataset.kind = card.kind;
    // The side panel on the desktop layout keeps role="dialog" but is not modal (§14.1).
    this.el.setAttribute('aria-modal', this.ctx.desk ? 'false' : 'true');
    let sig = sigilImg(mark.kind, mark.color, 48, 'cc-scard-sigimg');
    if (card.with) sig += factionSigil(card.with, 30, 'cc-scard-sigwith');
    this.sig.innerHTML = sig;
    setText(this.speaker, card.speakerName || (card.faction ? factionName(card.faction) : 'MOTH'));
    const fname = card.faction ? factionName(card.faction) + (card.with ? ` · ${factionName(card.with)}` : '') : card.kind === 'log' ? 'Pump Station 6' : '';
    // Two factions ("The Undertow · The Glass Kites") wrap between the names on a narrow phone instead of cutting one.
    // (setText first, so its cache holds this text and a later one-faction card is written again.)
    setText(this.faction, fname);
    if (card.faction && card.with)
      this.faction.replaceChildren(h('span', { class: 'cc-scard-fname', text: `${factionName(card.faction)} ·` }), ' ', h('span', { class: 'cc-scard-fname', text: factionName(card.with) }));
    setHidden(this.faction, !fname);
    // "Who is this?" for a visible faction speaker; the first card a faction speaks on opens it.
    const row = this.speakerRow(card);
    this.who.disabled = !row;
    setClass(this.who, 'has-about', !!row);
    setHidden(this.whoHint, !row);
    if (!same || this.aboutFor !== card.id) {
      this.aboutFor = card.id;
      this.aboutOpen = !!row && !!card.firstMeet;
    }
    this.renderAbout(row, !!card.firstMeet);
    setText(this.briefText, card.brief ?? '');
    setHidden(this.brief, !card.brief);
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
    // One-time legend for the hint chips, on the first card that has favor or Trace chips
    // (not on a faction's first card: its intro already takes the room).
    const legend = !this.legendSeen && !card.firstMeet && card.choices.some((c) => c.hints.some((x: Hint) => x.k === 'favor' || x.k === 'trace'));
    setHidden(this.legend, !legend);
    setHidden(this.laterBtn, !card.canLater);
    this.laterBtn.setAttribute('aria-label', card.fromMessage && card.autoInDays === undefined ? 'Later: keep it waiting on the goal chip' : 'Later: keep it waiting in COMMS');
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

  /** The speaker's faction row, if it is visible and has something to say about itself. */
  private speakerRow(card: CardView): StoryView['factions'][number] | null {
    if (!card.faction) return null;
    const row = this.factions.find((f) => f.id === card.faction);
    return row && row.shown === 'yes' ? row : null;
  }

  /** "Who is this?": name, leader, standing and the faction's plain-language intro. */
  private renderAbout(row: StoryView['factions'][number] | null, first: boolean): void {
    this.who.setAttribute('aria-expanded', this.aboutOpen && row ? 'true' : 'false');
    this.who.setAttribute('aria-label', row ? `${row.leader || row.name}, ${row.name}. Who is this?` : this.speaker.textContent ?? '');
    setHidden(this.about, !(this.aboutOpen && row));
    if (!row || !this.aboutOpen) return;
    const s = Math.round(row.standing);
    const standing = `${TIER_WORD[row.tier]} · standing ${s > 0 ? '+' : s < 0 ? MINUS : ''}${Math.abs(s)}`;
    setStyle(this.about, '--tier', TIER_COLOR[row.tier]);
    setHtml(
      this.about,
      `<div class="cc-who-k">${first ? 'New contact' : 'Who is this?'}</div>` +
        `<div class="cc-who-name">${factionSigil(row.id, 22, 'cc-who-sig')}<span><b>${esc(row.name)}</b>${row.leader ? ` · ${esc(row.leader)}` : ''}</span></div>` +
        `<div class="cc-who-standing"><span class="cc-who-tier">${esc(standing)}</span>${row.callsYou ? `<span> · calls you “${esc(row.callsYou)}”</span>` : ''}</div>` +
        (row.about ? `<p class="cc-who-text">${esc(row.about)}</p>` : '') +
        `<div class="cc-who-tip">Tap the name above to hide this.</div>`,
    );
  }

  /** Scroll the text so the just-opened intro shows (it sits under the brief). */
  private revealAbout(): void {
    const sc = this.scroll;
    const top = this.about.offsetTop - 4;
    const bottom = this.about.offsetTop + this.about.offsetHeight + 4;
    if (top < sc.scrollTop) sc.scrollTop = Math.max(0, top);
    else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.max(0, Math.min(top, bottom - sc.clientHeight));
  }

  hide(): void {
    if (!this.card) return;
    if (!this.legend.hidden) this.markLegendSeen();
    this.card = null;
    this.aboutFor = null;
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
      // Always-visible plain summary of what the choice does; hold for the exact effects.
      const sum = hintSummary(c.hints);
      const hints = locked
        ? `<span class="cc-choice-lock">${icon('lock')}<span>${esc(locked)}</span></span>`
        : sum
          ? `<span class="cc-choice-sum">${sum}</span>`
          : card.choices.length > 1
            ? '<span class="cc-choice-sum is-none">no visible effect</span>'
            : '';
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
    if (t.closest('[data-act="who"]')) {
      const row = this.card ? this.speakerRow(this.card) : null;
      if (!row) return;
      this.aboutOpen = !this.aboutOpen;
      this.renderAbout(row, !!this.card?.firstMeet);
      if (this.aboutOpen) this.revealAbout();
      this.checkMore();
      return;
    }
    const btn = t.closest<HTMLElement>('.cc-choice');
    if (!btn || !this.card) return;
    const i = Number(btn.dataset.i);
    const c = this.card.choices[i];
    if (c?.locked) {
      replayClass(btn, 'is-shake');
      this.ctx.game.toast(c.locked, 'error'); // 'error' so it prints over the open card
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
