// ─────────────────────────────────────────────────────────────────────────────
// Goal drawer (docs/STORY.md §8.5, docs/PACING.md): the goal chip opens a 60 %
// sheet (expandable) with, top to bottom:
//
//   messages     a story message waiting ("Read", the chapter goes on once it
//                is read) and the COMMS card, if any
//   what's happening   Chapter.summary in plain language
//   closes line  once every goal is met and only the chapter floor holds the
//                chapter open: "closes in 9:35"
//   goals        one 64 px row per goal (label, live "now · need" value,
//                progress bar; hold goals "12/20 days", waived goals "waived");
//                in Chapter VI the Charter Claims instead (tap: preview)
//   story so far finished chapters: recap and the key choice made; then the
//                Keepsakes (MEGACITY §9.6, keepsakes.ts): each mark with its
//                plaque and a Show button that pans the camera to it
//   pace         "Story pace: Relaxed" with a link to Settings
//
// The "?" in the header swaps the body for the glossary (Back returns).
// ─────────────────────────────────────────────────────────────────────────────

import { GLOSSARY } from '../../game/story/content/glossary';
import type { StoryView } from '../../game/story/types';
import { esc, h, setHidden, setHtml } from '../dom';
import { clock } from '../format';
import { icon } from '../icons';
import { pressGuard } from './gesture';
import { Keepsakes } from './keepsakes';
import { bannerKicker } from './incoming';
import { MOTH_COLOR, SYSTEM_COLOR, factionColor, factionSigil, sigilImg } from './sigils';
import { StorySheet } from './sheet';

const PACE_LABEL: Record<StoryView['pace'], string> = { relaxed: 'Relaxed', normal: 'Normal', brisk: 'Brisk' };

export class GoalDrawer {
  readonly sheet = new StorySheet('cc-goals', 'Goals', 'tall', { expandable: true });
  private html = '';
  private last: StoryView | null = null;
  private glossary = false;
  private readonly msgs = h('div', { class: 'cc-gd-msgs' });
  private readonly summary = h('div', { class: 'cc-gd-sum', hidden: true });
  /** The settle countdown: its own node, so the per-second tick never rebuilds the rows. */
  private readonly closes = h('div', { class: 'cc-goal-lead cc-goal-closes', hidden: true });
  private readonly list = h('div', { class: 'cc-goal-body' });
  private readonly sofar = h('section', { class: 'cc-gd-sofar', hidden: true });
  /** Story so far's Keepsakes: the marks the choices left, each with its plaque and Show (MEGACITY §9.6). */
  readonly keepsakes = new Keepsakes();
  private readonly pace = h('button', { class: 'cc-gd-pace', type: 'button', 'data-act': 'pace' });
  private readonly gloss = h('div', { class: 'cc-gd-gloss', hidden: true });
  private readonly main: HTMLElement;
  private readonly glossBtn: HTMLButtonElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly press: { readonly down: boolean };
  private msgHtml = '';
  private sofarHtml = '';
  onPreview: (() => void) | null = null;
  /** Open a waiting message: 'story' → game.openWaiting(), 'comms' → game.openPending(). */
  onRead: ((slot: 'story' | 'comms') => void) | null = null;
  /** Open Settings (story pace). */
  onPace: (() => void) | null = null;

  constructor() {
    this.main = h('div', { class: 'cc-gd-main' }, this.msgs, this.summary, this.closes, this.list, this.sofar, this.keepsakes.el, this.pace);
    this.keepsakes.onShow = () => this.sheet.close();
    this.sheet.body.append(this.main, this.gloss);
    this.glossBtn = h('button', { class: 'cc-iconbtn cc-gd-glossbtn', type: 'button', 'data-act': 'glossary', 'aria-label': 'Glossary: what the words mean', html: '<b aria-hidden="true">?</b>' });
    this.sheet.head.insertBefore(this.glossBtn, this.sheet.closeBtn);
    this.backBtn = h('button', { class: 'cc-btn is-ghost cc-ss-back', type: 'button', 'data-act': 'back' }, h('span', { html: icon('back') }), h('span', { text: 'Back' }));
    this.sheet.foot.append(this.backBtn);
    this.sheet.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'preview') this.onPreview?.();
      else if (a === 'read') this.onRead?.(act.dataset.slot === 'comms' ? 'comms' : 'story');
      else if (a === 'pace') this.onPace?.();
      else if (a === 'glossary') this.setGlossary(!this.glossary);
      else if (a === 'back') this.setGlossary(false);
    });
    const prev = this.sheet.onClosed;
    this.sheet.onClosed = () => {
      this.setGlossary(false);
      prev?.();
    };
    this.press = pressGuard(this.sheet.body, () => this.last && this.sheet.isOpen && this.sync(this.last));
  }

  /** Swap the body for the glossary (and back). */
  setGlossary(on: boolean): void {
    this.glossary = on;
    setHidden(this.main, on);
    setHidden(this.gloss, !on);
    setHidden(this.sheet.foot, !on);
    this.glossBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      let g = '<p class="cc-gd-gloss-lead">What the words in the story mean.</p><dl class="cc-gloss">';
      for (const e of [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term))) g += `<div class="cc-gloss-row"><dt>${esc(e.term)}</dt><dd>${esc(e.text)}</dd></div>`;
      g += '</dl>';
      setHtml(this.gloss, g);
      this.sheet.setTitle('Glossary', `${GLOSSARY.length} terms`);
    } else if (this.last) this.sync(this.last);
    this.sheet.body.scrollTop = 0;
  }

  sync(v: StoryView): void {
    this.last = v;
    if (this.glossary) return;
    const ch = v.chapter;
    const claimsMode = (v.countdownDays !== null || ch.n === 6) && v.claims.length > 0;
    this.sheet.setTitle(ch.n >= 7 ? 'Epilogue' : `Chapter ${ch.numeral}${ch.title ? ` · ${ch.title}` : ''}`, ch.question ? (ch.question.startsWith('>') ? ch.question : `> query: ${ch.question}`) : '');
    this.syncMessages(v);
    setHidden(this.summary, !ch.summary);
    if (ch.summary) setHtml(this.summary, `<div class="cc-gd-k">What's happening</div><p>${esc(ch.summary)}</p>`);
    const settle = ch.closesInSec !== undefined && (!claimsMode || (v.countdownDays ?? 1) <= 0);
    this.closes.hidden = !settle;
    if (settle) {
      setHtml(
        this.closes,
        claimsMode
          ? `<b>The count is almost ready.</b> Charter Night opens in ${clock(ch.closesInSec ?? 0)} of unpaused play.`
          : `<b>All goals done.</b> The chapter closes in ${clock(ch.closesInSec ?? 0)} of unpaused play.`,
      );
    }
    let html = '';
    if (claimsMode) {
      const d = v.countdownDays;
      html += `<div class="cc-goal-lead">${d !== null && d > 0 ? `<b>Charter Night</b> in ${Math.max(0, Math.ceil(d))} days.` : '<b>Charter Night</b>.'} Each claim is checked live against the city.</div>`;
      html += '<ul class="cc-claims">';
      for (const c of v.claims) {
        const miss = c.rows.find((r) => !r.ok);
        html +=
          `<li class="cc-claim${c.ok ? ' is-ok' : ''}"><span class="cc-claim-mark">${c.ok ? icon('check') : icon('close')}</span>` +
          `<span class="cc-claim-text"><b>${esc(c.title)}</b><span>${c.ok ? 'Every claim holds' : esc(miss ? `${miss.label}${miss.gap ? ` · ${miss.gap}` : ''}` : 'Not yet')}</span></span></li>`;
      }
      html += '</ul>';
      html += `<button class="cc-btn cc-goal-preview" type="button" data-act="preview">${icon('eye')}<span>Charter Night preview</span></button>`;
    } else if (v.goals.length === 0) {
      html += `<div class="cc-goal-empty">${ch.n >= 7 ? 'The charter is held. The city keeps building.' : 'No goals yet. Keep building; something is listening.'}</div>`;
    } else {
      html += '<div class="cc-gd-k">Goals</div><ul class="cc-goal-list">';
      for (const g of v.goals) {
        const state = g.waived ? 'is-waived' : g.done ? 'is-done' : '';
        const value = g.waived ? 'waived · the city moved on without it' : g.done ? 'done' : [g.now && `now ${g.now}`, g.need && `need ${g.need}`].filter(Boolean).join(' · ');
        const p = g.done || g.waived ? 1 : Math.max(0, Math.min(1, g.progress));
        html +=
          `<li class="cc-goal-row ${state}"><span class="cc-goal-mark">${g.done || g.waived ? icon('check') : icon('goal')}</span>` +
          `<span class="cc-goal-main"><span class="cc-goal-label">${esc(g.label)}</span><span class="cc-goal-val">${esc(value)}</span>` +
          `<span class="cc-goal-bar"><i style="transform:scaleX(${p.toFixed(3)})"></i></span></span></li>`;
      }
      html += '</ul>';
    }
    if (html !== this.html && !this.press.down) {
      this.html = html;
      this.list.innerHTML = html;
    }
    this.syncSoFar(v);
    this.keepsakes.sync();
    setHtml(this.pace, `<span>Story pace: <b>${PACE_LABEL[v.pace]}</b></span><span class="cc-gd-pace-go">Settings${icon('chevron')}</span>`);
    this.pace.setAttribute('aria-label', `Story pace: ${PACE_LABEL[v.pace]}. Change it in Settings.`);
  }

  private syncMessages(v: StoryView): void {
    let s = '';
    for (const m of v.messages) {
      const color = m.faction ? factionColor(m.faction) : m.kind === 'system' ? SYSTEM_COLOR : MOTH_COLOR;
      const sig = m.faction ? factionSigil(m.faction, 28) : sigilImg(m.kind === 'system' ? 'system' : 'moth', color, 28);
      s +=
        `<button class="cc-gd-msg${m.required ? ' is-required' : ''}" type="button" data-act="read" data-slot="${m.slot}" style="--fc:${color}">` +
        `<span class="cc-gd-msg-sig">${sig}</span>` +
        `<span class="cc-gd-msg-main"><span class="cc-gd-msg-k">${esc(bannerKicker(m))}</span><span class="cc-gd-msg-title">${esc(m.title)}</span></span>` +
        `<span class="cc-gd-msg-go">Read${icon('chevron')}</span></button>`;
      if (m.required) s += '<div class="cc-gd-msg-note">The chapter goes on once you read it.</div>';
    }
    if (s !== this.msgHtml && !this.press.down) {
      this.msgHtml = s;
      this.msgs.innerHTML = s;
    }
    setHidden(this.msgs, !s);
  }

  private syncSoFar(v: StoryView): void {
    let s = '';
    if (v.storySoFar.length) {
      s += '<div class="cc-gd-k">Story so far</div><ol class="cc-sofar">';
      for (const c of v.storySoFar) {
        s +=
          `<li class="cc-sofar-row"><span class="cc-sofar-num">${esc(c.numeral)}</span><span class="cc-sofar-main">` +
          `<b class="cc-sofar-title">${esc(c.title)}</b>` +
          (c.recap ? `<span class="cc-sofar-recap">${esc(c.recap)}</span>` : '') +
          c.choices.map((x) => `<span class="cc-sofar-choice">${icon('check')}<span>You chose: ${esc(x)}</span></span>`).join('') +
          '</span></li>';
      }
      s += '</ol>';
    }
    if (s !== this.sofarHtml) {
      this.sofarHtml = s;
      this.sofar.innerHTML = s;
    }
    setHidden(this.sofar, !s);
  }
}
