// ─────────────────────────────────────────────────────────────────────────────
// COMMS (docs/STORY.md §8.7): a full-height sheet whose two tabs sit at the
// bottom, above the safe area, with the close button beside them.
//
//   Log        56 px rows (sigil, title, the choice made or "(no answer)",
//              date), bottom-anchored like a chat; the pending card with its
//              countdown ring sits just above the tabs. Whispers are one-line
//              rows. Tap a row to expand it; tap the pending row to answer.
//   Silt Logs  coherence %, then a 4 × 3 grid of 72 px tiles; found tiles glow
//              and open the log, missing ones show their source.
// ─────────────────────────────────────────────────────────────────────────────

import { STORY_PACING } from '../../game/config';
import type { FactionId, StoryView } from '../../game/story/types';
import type { UIContext } from '../context';
import { esc, h, setClass, setHidden, setText } from '../dom';
import { icon } from '../icons';
import { pressGuard, swipeDown } from './gesture';
import { MOTH_COLOR, factionColor, factionSigil, sigilImg } from './sigils';
import { autoLabel } from './storyCard';

/** Countdown ring fill for a waiting card: the later of the day and real-second clocks. */
export function pendingFrac(p: { daysLeft: number; secLeft: number }): number {
  const d = p.daysLeft / Math.max(1, STORY_PACING.pendingDays);
  const s = p.secLeft / Math.max(1, STORY_PACING.pendingMinSec);
  return Math.max(0, Math.min(1, Math.max(d, s)));
}

type Tab = 'log' | 'silt';

const PREFIX: Record<string, FactionId> = { bd: 'board', ba: 'basalt', nc: 'nacre', ut: 'undertow', kt: 'kites', tu: 'tuning' };
const SHORT_TO_ID: Record<string, FactionId> = { Board: 'board', Basalt: 'basalt', Nacre: 'nacre', Undertow: 'undertow', Kites: 'kites', Tuning: 'tuning' };

/** Best-effort speaker of a log row from its card id (for the row sigil only). */
function rowFaction(row: StoryView['comms'][number]): FactionId | null {
  if (row.card.startsWith('wh:')) return (row.card.split(':')[1] as FactionId) ?? null;
  if (row.card.startsWith('wh.')) return SHORT_TO_ID[row.title] ?? 'kites';
  const p = row.card.split('.')[0];
  return PREFIX[p] ?? null;
}

export class Comms {
  readonly el: HTMLElement;
  private readonly logList: HTMLElement;
  private readonly siltView: HTMLElement;
  private readonly reader: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private tab: Tab = 'log';
  private _open = false;
  private openRow = -1;
  private logHtml = '';
  private siltHtml = '';
  /** Pending row countdown: patched in place (≤ 1/s) instead of rebuilding every row each sim day. */
  private waitText = '';
  private waitFrac = '';
  private nextText = '';
  private nextFrac = '';
  private waitAt = 0;
  private view: StoryView | null = null;
  private readonly press: { readonly down: boolean };
  onClosed: (() => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    this.title = h('h2', { class: 'cc-ss-title', text: 'COMMS' });
    this.sub = h('div', { class: 'cc-ss-sub', text: 'Messages meant for no one, routed to you.' });
    this.logList = h('div', { class: 'cc-comms-log', role: 'log' });
    this.siltView = h('div', { class: 'cc-comms-silt', hidden: true });
    this.reader = h('div', { class: 'cc-comms-reader', hidden: true });
    const tab = (id: Tab, label: string, ico: Parameters<typeof icon>[0]) => {
      const b = h('button', { class: 'cc-comms-tab', type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': 'false' }, h('span', { html: icon(ico) }), h('span', { text: label }));
      this.tabs.push(b);
      return b;
    };
    this.el = h(
      'section',
      { class: 'cc-ss cc-panel cc-comms', 'data-size': 'full', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'COMMS', tabindex: '-1' },
      h('header', { class: 'cc-ss-head cc-comms-head' }, h('span', { class: 'cc-ss-grab', 'aria-hidden': 'true' }), h('div', { class: 'cc-ss-titles' }, this.title, this.sub)),
      h('div', { class: 'cc-ss-body cc-comms-body' }, this.logList, this.siltView, this.reader),
      h(
        'footer',
        { class: 'cc-comms-tabs', role: 'tablist' },
        tab('log', 'Log', 'comms'),
        tab('silt', 'Silt Logs', 'layers'),
        h('button', { class: 'cc-iconbtn cc-comms-close', type: 'button', 'data-act': 'close', 'aria-label': 'Close COMMS', html: icon('close') }),
      ),
    );
    this.el.addEventListener('click', this.onClick);
    this.press = pressGuard(this.el, () => this.view && this.sync(this.view));
    swipeDown(this.el, {
      canStart: (t) => !t.closest('button') && (!!t.closest('.cc-comms-head') || (this.tab === 'silt' && !t.closest('.cc-comms-reader'))),
      onSwipe: () => this.close(),
      threshold: 90,
    });
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(tab: Tab = 'log'): void {
    this._open = true;
    this.openRow = -1;
    this.setTab(tab);
    this.el.hidden = false;
    this.el.classList.remove('is-in');
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
    if (this.view) this.sync(this.view, true);
    this.scrollToEnd();
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
    setHidden(this.reader, true);
    this.onClosed?.();
  }

  private setTab(t: Tab): void {
    this.tab = t;
    for (const b of this.tabs) {
      const on = b.dataset.tab === t;
      setClass(b, 'is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    setHidden(this.logList, t !== 'log');
    setHidden(this.siltView, t !== 'silt');
    setHidden(this.reader, true);
    setText(this.title, t === 'log' ? 'COMMS' : 'Silt Logs');
    setText(this.sub, t === 'log' ? 'Messages meant for no one, routed to you.' : 'What the silt kept. Each log restores you a little.');
  }

  private scrollToEnd(): void {
    const body = this.logList.parentElement!;
    if (this.tab === 'log') body.scrollTop = body.scrollHeight;
    else body.scrollTop = 0;
  }

  sync(v: StoryView, force = false): void {
    this.view = v;
    if (!this._open && !force) return;
    // ── Log (oldest first, newest at the bottom, pending last) ──
    let s = '';
    if (!v.comms.length && !v.pending) s += '<div class="cc-comms-empty">Nothing yet. The wires are quiet.</div>';
    v.comms.forEach((r, i) => {
      const f = rowFaction(r);
      const sig = f ? factionSigil(f, 28) : sigilImg('moth', MOTH_COLOR, 28);
      if (r.whisper) {
        s += `<div class="cc-crow is-whisper" style="--fc:${factionColor(f)}"><span class="cc-crow-sig">${sig}</span><span class="cc-crow-whisper">${esc(r.whisper)}</span><span class="cc-crow-date">${esc(r.date)}</span></div>`;
        return;
      }
      const open = i === this.openRow;
      const choice = r.choice ? r.choice : r.auto ? '(no answer)' : '';
      s +=
        `<button class="cc-crow${open ? ' is-open' : ''}" type="button" data-row="${i}" style="--fc:${factionColor(f)}">` +
        `<span class="cc-crow-sig">${sig}</span><span class="cc-crow-main"><span class="cc-crow-title">${esc(r.title || r.card)}</span>` +
        `<span class="cc-crow-choice">${esc(r.auto && r.choice ? `${r.choice} (no answer)` : choice)}</span></span>` +
        `<span class="cc-crow-date">${esc(r.date)}</span></button>`;
    });
    const p = v.pending;
    const waitText = p ? `Waiting for you · ${autoLabel(p.daysLeft)}` : '';
    const waitFrac = p ? pendingFrac(p).toFixed(3) : '';
    if (p) {
      // The countdown text and ring are left blank here and patched below, so a new
      // sim day does not rebuild every row.
      s +=
        `<button class="cc-crow is-pending" type="button" data-act="answer" style="--fc:${factionColor(p.faction)}">` +
        `<span class="cc-crow-sig cc-crow-ring">${factionSigil(p.faction, 28)}</span>` +
        `<span class="cc-crow-main"><span class="cc-crow-title">${esc(p.title)}</span><span class="cc-crow-choice is-wait"></span></span>` +
        `<span class="cc-crow-answer">Answer${icon('chevron')}</span></button>`;
    }
    // Rows change only on a new entry, an expanded row or a new pending card; hold off while a finger is down.
    let rebuilt = false;
    if (s !== this.logHtml && (force || !this.press.down)) {
      const body = this.logList.parentElement!;
      const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      this.logHtml = s;
      this.logList.innerHTML = s;
      rebuilt = true;
      if (atEnd && this.tab === 'log') this.scrollToEnd();
    }
    if (p) {
      this.nextText = waitText;
      this.nextFrac = waitFrac;
      if (rebuilt || force) this.patchWait();
      else this.tick();
    }
    // ── Silt Logs ──
    const owned = v.logs.filter((l) => l.owned).length;
    let g = `<div class="cc-silt-head"><span class="cc-silt-coh">> coherence ${Math.round(v.coherence)}%</span><span class="cc-silt-count">${owned}/12 recovered</span></div><div class="cc-silt-grid">`;
    for (const l of v.logs.length ? v.logs : Array.from({ length: 12 }, (_, k) => ({ n: k + 1, owned: false, source: '', title: '' }))) {
      g += l.owned
        ? `<button class="cc-silt-tile is-found" type="button" data-log="${l.n}"><b>${String(l.n).padStart(2, '0')}</b><span>${esc(l.title.replace(/^SILT LOG \d+\s*·?\s*/i, '') || 'Log')}</span></button>`
        : `<div class="cc-silt-tile"><b>${String(l.n).padStart(2, '0')}</b><span>${esc(l.source || '—')}</span></div>`;
    }
    g += '</div>';
    if (g !== this.siltHtml && (force || !this.press.down)) {
      this.siltHtml = g;
      this.siltView.innerHTML = g;
    }
  }

  /** Per frame while open (cheap): apply a waiting countdown change, at most once a second. */
  tick(): void {
    if (!this._open || (this.nextText === this.waitText && this.nextFrac === this.waitFrac)) return;
    if (performance.now() - this.waitAt >= 1000) this.patchWait();
  }

  private patchWait(): void {
    this.waitAt = performance.now();
    this.waitText = this.nextText;
    this.waitFrac = this.nextFrac;
    const row = this.logList.querySelector<HTMLElement>('.cc-crow.is-pending');
    if (!row) return;
    const text = row.querySelector<HTMLElement>('.is-wait');
    const ring = row.querySelector<HTMLElement>('.cc-crow-ring');
    if (text) setText(text, this.waitText);
    if (ring) ring.style.setProperty('--p', this.waitFrac);
  }

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) {
      this.setTab(tab.dataset.tab as Tab);
      this.scrollToEnd();
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') {
      this.close();
      return;
    }
    if (act === 'answer') {
      this.close();
      this.ctx.game.openPending();
      return;
    }
    if (act === 'reader-close') {
      setHidden(this.reader, true);
      setHidden(this.siltView, false);
      return;
    }
    const row = t.closest<HTMLElement>('[data-row]');
    if (row) {
      const i = Number(row.dataset.row);
      this.openRow = this.openRow === i ? -1 : i;
      if (this.view) this.sync(this.view, true);
      return;
    }
    const log = t.closest<HTMLElement>('[data-log]');
    if (log && this.view) {
      const n = Number(log.dataset.log);
      const l = this.view.logs.find((x) => x.n === n);
      if (!l?.body) return;
      this.reader.innerHTML =
        `<div class="cc-reader-k">${esc(l.title)}</div><p class="cc-reader-body">${esc(l.body)}</p>` +
        `<button class="cc-btn" type="button" data-act="reader-close">${icon('back')}<span>All logs</span></button>`;
      setHidden(this.siltView, true);
      setHidden(this.reader, false);
      this.logList.parentElement!.scrollTop = 0;
    }
  };
}
