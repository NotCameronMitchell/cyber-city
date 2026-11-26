// ─────────────────────────────────────────────────────────────────────────────
// News ticker strip under the HUD. Shows world.news items one at a time (each
// for at least a few seconds so bursts stay readable), slides new items in
// with a glitch flash, and marquee-scrolls headlines that don't fit.
// Tap → news log.
// ─────────────────────────────────────────────────────────────────────────────

import { isCityLifeLine } from '../game/cityEvents';
import type { NewsItem } from '../game/types';
import type { UIContext } from './context';
import { h, prefersReducedMotion, replayClass, setClass, setStyle, setText } from './dom';
import { chipNews } from './feedback';
import { icon } from './icons';

export const NEWS_TAGS: Record<NewsItem['kind'], string> = {
  flavor: 'Feed',
  info: 'City',
  good: 'Boost',
  warn: 'Warn',
  bad: 'Alert',
};

const MIN_SHOW_MS = 4200;
const MARQUEE_PX_PER_S = 46;
const QUEUE_MAX = 4;

export class Ticker {
  readonly el: HTMLButtonElement;
  private readonly tag: HTMLElement;
  private readonly track: HTMLElement;
  private readonly text: HTMLElement;
  private readonly date: HTMLElement;
  private readonly queue: NewsItem[] = [];
  private current: NewsItem | null = null;
  private shownAt = 0;
  private holdMs = MIN_SHOW_MS;

  constructor(private readonly ctx: UIContext) {
    this.tag = h('span', { class: 'cc-tick-tag' });
    this.text = h('span', { class: 'cc-tick-text' });
    this.track = h('span', { class: 'cc-tick-track' }, this.text);
    this.date = h('span', { class: 'cc-tick-date' });
    this.el = h(
      'button',
      { class: 'cc-ticker', type: 'button', 'aria-label': 'News feed — open log' },
      this.tag,
      this.track,
      this.date,
      h('span', { class: 'cc-tick-more', html: icon('chevron') }),
    );
    this.el.addEventListener('click', () => ctx.actions.openNews());
    // Rotation / resize changes the strip width: re-measure the marquee (debounced).
    let t = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (this.current) this.measure();
      }, 250);
    });
    this.reset();
  }

  /**
   * A new item arrived. A City life line (§6.4.1: a happening's only notice) goes to the front of the queue and is
   * never dropped; a line already waiting in the queue is not queued twice (a repeated monthly warning). Under a burst
   * the oldest flavour chatter goes first, then the oldest of anything but a City life line.
   */
  push(item: NewsItem): void {
    if (!this.current) {
      this.show(item, true);
      return;
    }
    if (this.queue.some((n) => n.text === item.text && n.kind === item.kind)) return;
    if (isCityLifeLine(item.text)) {
      const at = this.queue.findIndex((n) => !isCityLifeLine(n.text));
      this.queue.splice(at < 0 ? this.queue.length : at, 0, item);
    } else this.queue.push(item);
    while (this.queue.length > QUEUE_MAX) {
      let i = this.queue.findIndex((n) => n.kind === 'flavor');
      if (i < 0) i = this.queue.findIndex((n) => !isCityLifeLine(n.text));
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
  }

  /** World swapped: show its latest item without animation. */
  reset(): void {
    this.queue.length = 0;
    const news = this.ctx.game.world.news;
    const last = news[news.length - 1] ?? null;
    if (last) this.show(last, false);
    else {
      this.current = null;
      setText(this.text, 'Uplink established. Awaiting headlines…');
      setText(this.tag, 'Feed');
      this.el.dataset.kind = 'flavor';
    }
    this.refreshDate();
  }

  refreshDate(): void {
    setText(this.date, this.ctx.game.world.dateLabel());
  }

  /** Advance the queue (called every frame with performance.now()). */
  update(now: number): void {
    if (this.queue.length === 0) return;
    if (now - this.shownAt < this.holdMs) return;
    this.show(this.queue.shift()!, true);
  }

  private show(item: NewsItem, animate: boolean): void {
    this.current = item;
    this.shownAt = performance.now();
    this.el.dataset.kind = item.kind;
    setText(this.tag, NEWS_TAGS[item.kind]);
    setText(this.text, chipNews(item.text, this.ctx.game.world.maxPopulation));
    if (animate) replayClass(this.el, 'is-new');
    this.measure();
  }

  /** One layout read per headline (rare) to decide whether it needs to scroll. */
  private measure(): void {
    setClass(this.text, 'is-marquee', false);
    this.holdMs = MIN_SHOW_MS;
    const overflow = this.text.scrollWidth - this.track.clientWidth;
    if (overflow > 4 && !prefersReducedMotion()) {
      const travel = overflow + 16;
      const dur = travel / MARQUEE_PX_PER_S + 3; // includes the dwell at both ends
      setStyle(this.text, '--cc-mq-dist', `${-travel}px`);
      setStyle(this.text, '--cc-mq-dur', `${dur.toFixed(2)}s`);
      setClass(this.text, 'is-marquee', true);
      this.holdMs = Math.max(MIN_SHOW_MS, dur * 1000 + 800);
    }
  }
}
