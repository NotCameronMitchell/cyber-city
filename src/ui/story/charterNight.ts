// ─────────────────────────────────────────────────────────────────────────────
// Charter Night (docs/STORY.md §6.1, §8.10): full screen, bottom-aligned so
// the always-available Quiet Hand sits right above Recount in the thumb zone.
//
//   header      CHARTER NIGHT · {year}
//   5 rows      96 px: sigil · ending title · "MOTH becomes: …" · ✓/✗ claims with gaps
//   footer      Recount · six more months (48 px)
//   confirm     "Hold the charter for Basalt?" → Hold the charter (52 px) / Back
//
// Locked rows are greyed; a tap flashes the first failed claim on the row
// itself (no toast: toasts wait while this screen is up). Preview mode (from
// the Chapter VI goal drawer) shows the same rows read-only and says so.
// ─────────────────────────────────────────────────────────────────────────────

import type { EndingId, StoryView } from '../../game/story/types';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, START_YEAR } from '../../game/types';
import type { UIContext } from '../context';
import { esc, h, replayClass, setHidden, setText } from '../dom';
import { icon } from '../icons';
import { MOTH_COLOR, factionColor, sigilImg, type SigilKind } from './sigils';

/** Mark + colour per ending (whose charter it is). */
export const ENDING_MARK: Record<EndingId, { kind: SigilKind; color: string }> = {
  ironwork: { kind: 'hexcolumn', color: factionColor('basalt') },
  pearl: { kind: 'spiral', color: factionColor('nacre') },
  lowcrown: { kind: 'hookwave', color: factionColor('undertow') },
  ledger: { kind: 'ninering', color: factionColor('board') },
  quiet: { kind: 'moth', color: MOTH_COLOR },
};

/** Fallback copy (STORY.md §6.1) when the view carries no claims. */
export const ENDING_COPY: Record<EndingId, { title: string; becomes: string; ask: string }> = {
  ironwork: { title: 'Ironwork', becomes: 'The Foreman', ask: 'Hold the charter for Basalt?' },
  pearl: { title: 'Pearlescence', becomes: 'The Smile', ask: 'Hold the charter for Nacre?' },
  lowcrown: { title: 'The Low Crown', becomes: 'The moth on every corner', ask: 'Hand the charter to the crews?' },
  ledger: { title: 'Open Ledger', becomes: 'The Public Record', ask: 'Read the Ledger aloud, yours too?' },
  quiet: { title: 'The Quiet Hand', becomes: 'Nobody', ask: 'Split the count and keep the scales level?' },
};

const ORDER: EndingId[] = ['ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet'];

export class CharterNight {
  readonly el: HTMLElement;
  private readonly year: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly recount: HTMLButtonElement;
  private readonly confirm: HTMLElement;
  private readonly confirmQ: HTMLElement;
  private readonly confirmSub: HTMLElement;
  private choice: EndingId | null = null;
  private preview = false;
  private _open = false;
  private html = '';
  private view: StoryView | null = null;
  onClosed: (() => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    this.year = h('div', { class: 'cc-cn-title' });
    this.sub = h('div', { class: 'cc-cn-sub', text: 'Every ballot passes through you.' });
    this.rows = h('div', { class: 'cc-cn-rows', role: 'list' });
    this.recount = h('button', { class: 'cc-btn cc-cn-recount', type: 'button', 'data-act': 'recount' }, h('span', { html: icon('clock') }), h('span', { text: 'Recount · six more months' }));
    this.confirmQ = h('div', { class: 'cc-cn-q' });
    this.confirmSub = h('div', { class: 'cc-cn-qsub' });
    this.confirm = h(
      'div',
      { class: 'cc-cn-confirm cc-panel', hidden: true, role: 'alertdialog' },
      this.confirmQ,
      this.confirmSub,
      h(
        'div',
        { class: 'cc-cn-qbtns' },
        h('button', { class: 'cc-btn is-ghost', type: 'button', 'data-act': 'back' }, h('span', { html: icon('back') }), h('span', { text: 'Back' })),
        h('button', { class: 'cc-btn is-primary cc-cn-hold', type: 'button', 'data-act': 'hold' }, h('span', { text: 'Hold the charter' })),
      ),
    );
    this.el = h(
      'section',
      { class: 'cc-charter', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Charter Night', tabindex: '-1' },
      h('div', { class: 'cc-cn-head' }, this.year, this.sub, h('button', { class: 'cc-iconbtn cc-cn-close', type: 'button', 'data-act': 'close', 'aria-label': 'Close preview', html: icon('close'), hidden: true })),
      h('div', { class: 'cc-cn-scroll' }, this.rows),
      h('div', { class: 'cc-cn-foot' }, this.recount),
      this.confirm,
    );
    this.el.addEventListener('click', this.onClick);
  }

  get isOpen(): boolean {
    return this._open;
  }

  get isPreview(): boolean {
    return this.preview;
  }

  open(v: StoryView, preview = false): void {
    this.preview = preview;
    this._open = true;
    this.choice = null;
    setHidden(this.confirm, true);
    this.el.classList.toggle('is-preview', preview);
    setHidden(this.el.querySelector<HTMLElement>('.cc-cn-close')!, !preview);
    setText(this.recount.lastElementChild as HTMLElement, preview ? 'Close preview' : 'Recount · six more months');
    setText(this.sub, preview ? 'Preview only · the count opens on Charter Night.' : 'Every ballot passes through you.');
    this.recount.dataset.act = preview ? 'close' : 'recount';
    const tick = this.ctx.game.world.tick;
    setText(this.year, `Charter Night · ${START_YEAR + Math.floor(tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR))}`);
    this.el.hidden = false;
    replayClass(this.el, 'is-in');
    this.sync(v, true);
    const sc = this.el.querySelector<HTMLElement>('.cc-cn-scroll')!;
    sc.scrollTop = sc.scrollHeight;
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

  sync(v: StoryView, force = false): void {
    this.view = v;
    if (!this._open && !force) return;
    const claims = [...v.claims].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    let s = '';
    for (const c of claims) {
      const m = ENDING_MARK[c.id];
      const ok = c.ok || c.id === 'quiet';
      s +=
        `<button class="cc-cn-row${ok ? ' is-ok' : ' is-locked'}${this.choice === c.id ? ' is-picked' : ''}" type="button" role="listitem" data-end="${c.id}" style="--ec:${m.color}"${ok ? '' : ' aria-disabled="true"'}>` +
        `<span class="cc-cn-sig">${sigilImg(m.kind, m.color, 44)}</span>` +
        `<span class="cc-cn-main"><span class="cc-cn-name">${esc(c.title || ENDING_COPY[c.id].title)}</span>` +
        `<span class="cc-cn-becomes">MOTH becomes: <b>${esc(c.becomes || ENDING_COPY[c.id].becomes)}</b></span>` +
        `<span class="cc-cn-claims">${c.rows.length ? c.rows.map((r) => `<span class="cc-cn-claim${r.ok ? ' is-ok' : ''}">${r.ok ? '✓' : '✗'} ${esc(r.label)}${r.gap ? ` <i>${esc(r.gap)}</i>` : ''}</span>`).join('') : '<span class="cc-cn-claim is-ok">✓ Always open</span>'}</span></span>` +
        `<span class="cc-cn-state">${ok ? icon('chevron') : icon('lock')}</span></button>`;
    }
    if (s !== this.html || force) {
      this.html = s;
      this.rows.innerHTML = s;
    }
  }

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const { game } = this.ctx;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') {
      this.close();
      return;
    }
    if (act === 'recount') {
      game.recount();
      this.close();
      game.toast('Recount ordered. Six more months.', 'info');
      return;
    }
    if (act === 'back') {
      this.choice = null;
      setHidden(this.confirm, true);
      if (this.view) this.sync(this.view, true);
      return;
    }
    if (act === 'hold' && this.choice) {
      const r = game.chooseEnding(this.choice);
      if (r.ok) this.close();
      else {
        this.choice = null;
        setHidden(this.confirm, true);
      }
      return;
    }
    const row = t.closest<HTMLElement>('[data-end]');
    if (!row || !this.view) return;
    const id = row.dataset.end as EndingId;
    const c = this.view.claims.find((x) => x.id === id);
    if (!c) return;
    if (!(c.ok || id === 'quiet')) {
      replayClass(row, 'is-shake');
      const miss = row.querySelector<HTMLElement>('.cc-cn-claim:not(.is-ok)');
      if (miss) replayClass(miss, 'is-flash');
      this.ctx.sfx('error');
      return;
    }
    if (this.preview) {
      replayClass(this.sub, 'is-flash');
      return;
    }
    this.choice = id;
    setText(this.confirmQ, ENDING_COPY[id].ask);
    setText(this.confirmSub, `MOTH becomes: ${c.becomes || ENDING_COPY[id].becomes}`);
    this.confirm.style.setProperty('--accent', ENDING_MARK[id].color);
    setHidden(this.confirm, false);
    replayClass(this.confirm, 'is-in');
    this.sync(this.view, true);
  };
}
