// ─────────────────────────────────────────────────────────────────────────────
// News log: the full world.news feed, newest first, kind-coloured.
// ─────────────────────────────────────────────────────────────────────────────

import { buildDialog, type UIContext } from './context';
import { h, setText } from './dom';
import { tickDay } from './format';
import { icon } from './icons';
import { NEWS_TAGS } from './ticker';

export class NewsLog {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly sub: HTMLElement;
  private renderedKey = '';

  constructor(private readonly ctx: UIContext) {
    const d = buildDialog({ id: 'cc-news', title: 'City feed', icon: icon('news') });
    this.el = d.el;
    this.sub = d.sub;
    d.el.classList.add('cc-newslog');
    this.list = h('ol', { class: 'cc-news-list' });
    d.body.append(this.list);
    d.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) ctx.modals.close(this.el);
    });
  }

  get isOpen(): boolean {
    return this.ctx.modals.isOpen(this.el);
  }

  open(): void {
    this.renderedKey = '';
    this.ctx.modals.open(this.el);
    this.refresh();
    this.list.parentElement!.scrollTop = 0;
  }

  refresh(): void {
    if (!this.isOpen) return;
    const w = this.ctx.game.world;
    const news = w.news;
    const last = news[news.length - 1];
    const key = `${news.length}|${last?.tick}|${last?.text}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    setText(this.sub, `${w.cityName} · ${news.length} ${news.length === 1 ? 'story' : 'stories'}`);
    this.list.textContent = '';
    if (news.length === 0) {
      this.list.append(h('li', { class: 'cc-news-empty', text: 'Quiet night. No headlines yet.' }));
      return;
    }
    for (let i = news.length - 1; i >= 0; i--) {
      const n = news[i];
      this.list.append(
        h(
          'li',
          { class: 'cc-news-item', 'data-kind': n.kind },
          h('div', { class: 'cc-news-meta' }, h('span', { class: 'cc-news-tag', text: NEWS_TAGS[n.kind] }), h('time', { text: tickDay(n.tick) })),
          h('p', { text: n.text }),
        ),
      );
    }
  }
}
