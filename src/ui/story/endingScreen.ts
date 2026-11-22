// ─────────────────────────────────────────────────────────────────────────────
// Ending screen (docs/STORY.md §8.10): full screen, scrollable.
//
//   96 px sigil · title (28 px) · the final card (16 px) · "MOTH became: …"
//   2 × 2 stats: years · peak population · Silt Logs x/12 · key choices
//   gallery strip: 5 slots of 56 px, silhouettes for endings not yet seen
//   Keep building (56 px, primary, pinned) · New city (text button)
// ─────────────────────────────────────────────────────────────────────────────

import { readGallery } from '../../game/story/director';
import type { EndingId, StoryView } from '../../game/story/types';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from '../../game/types';
import { randomCityName, randomSeed } from '../../game/game';
import type { UIContext } from '../context';
import { esc, h, replayClass } from '../dom';
import { groupInt } from '../format';
import { ENDING_COPY, ENDING_MARK } from './charterNight';
import { sigilImg } from './sigils';

const ORDER: EndingId[] = ['ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet'];
const KEY_LABEL: Record<string, string> = { 'ch1.lark': 'I', 'ch2.vote': 'II', 'ch3.pier': 'III', 'ch4.brine': 'IV', 'ch5.choice': 'V' };

export class EndingScreen {
  readonly el: HTMLElement;
  private readonly content: HTMLElement;
  private _open = false;
  onClosed: (() => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    this.content = h('div', { class: 'cc-end-content' });
    this.el = h(
      'section',
      { class: 'cc-ending', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ending', tabindex: '-1' },
      h('div', { class: 'cc-end-scroll' }, this.content),
      h(
        'div',
        { class: 'cc-end-foot' },
        h('button', { class: 'cc-btn is-primary cc-end-keep', type: 'button', 'data-act': 'keep' }, h('span', { text: 'Keep building' })),
        h('button', { class: 'cc-end-new', type: 'button', 'data-act': 'new', text: 'New city' }),
      ),
    );
    this.el.addEventListener('click', this.onClick);
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(v: StoryView, finalBody: string): void {
    const e = v.ending;
    if (!e) return;
    const { game } = this.ctx;
    const w = game.world;
    const claim = v.claims.find((c) => c.id === e.id);
    const copy = ENDING_COPY[e.id];
    const mark = e.variant === 'lamplight' ? { kind: 'window' as const, color: '#fff3c4' } : ENDING_MARK[e.id];
    const title = e.variant === 'lamplight' ? `${claim?.title ?? copy.title} · Lamplight` : claim?.title ?? copy.title;
    const years = Math.max(1, Math.round(w.tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR)));
    const logs = v.logs.filter((l) => l.owned).length;
    const gallery = readGallery();
    const seen = new Set<EndingId>(gallery.endings);
    seen.add(e.id);
    let keys = '';
    for (const k of e.keyChoices.slice(0, 6)) keys += `<span class="cc-end-key" title="${esc(k.card)}"><b>${esc(KEY_LABEL[k.card] ?? '•')}</b>${'ABCD'[k.choice] ?? k.choice + 1}</span>`;
    let strip = '';
    for (const id of ORDER) {
      const m = ENDING_MARK[id];
      const on = seen.has(id);
      strip += `<span class="cc-end-slot${on ? ' is-seen' : ''}${id === e.id ? ' is-now' : ''}" title="${on ? esc(ENDING_COPY[id].title) : 'Not yet seen'}">${sigilImg(on ? m.kind : 'unknown', on ? m.color : '#5a5f84', 36)}</span>`;
    }
    this.content.innerHTML =
      `<div class="cc-end-sig" style="--ec:${mark.color}">${sigilImg(mark.kind, mark.color, 96)}</div>` +
      `<div class="cc-end-kicker">Ending</div><h2 class="cc-end-title">${esc(title)}</h2>` +
      (finalBody ? finalBody.split(/\n\n+/).map((p) => `<p class="cc-end-body">${esc(p)}</p>`).join('') : '') +
      `<div class="cc-end-became">MOTH became: <b>${esc(claim?.becomes ?? copy.becomes)}</b></div>` +
      `<div class="cc-end-stats">` +
      `<div class="cc-end-stat"><b>${years}</b><span>${years === 1 ? 'year' : 'years'}</span></div>` +
      `<div class="cc-end-stat"><b>${groupInt(w.maxPopulation)}</b><span>peak population</span></div>` +
      `<div class="cc-end-stat"><b>${logs}/12</b><span>Silt Logs</span></div>` +
      `<div class="cc-end-stat"><span class="cc-end-keys">${keys || '—'}</span><span>key choices</span></div>` +
      `</div>` +
      `<div class="cc-end-gallery"><div class="cc-end-glabel">Endings seen</div><div class="cc-end-strip">${strip}</div></div>`;
    this._open = true;
    this.el.hidden = false;
    replayClass(this.el, 'is-in');
    (this.el.querySelector('.cc-end-scroll') as HTMLElement).scrollTop = 0;
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

  private readonly onClick = (e: MouseEvent) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'keep') this.close();
    else if (act === 'new') {
      const { game, actions } = this.ctx;
      actions.confirm({
        title: 'Found a new city',
        body: 'This city stays in the backup slot: the menu can restore it.',
        confirmLabel: 'Found city',
        danger: true,
        input: { label: 'City name', value: randomCityName(randomSeed()), maxLength: 24, reroll: () => randomCityName(randomSeed()) },
        onConfirm: (name) => {
          this.close();
          game.newCity(name || undefined);
          game.toast(`Charter signed: welcome to ${game.world.cityName}`, 'good');
        },
      });
    }
  };
}

