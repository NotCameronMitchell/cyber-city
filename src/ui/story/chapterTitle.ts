// ─────────────────────────────────────────────────────────────────────────────
// Chapter title card (docs/STORY.md §8.4): full screen for 2.2 s over the
// dimmed city; tap to skip.
//
//   CHAPTER III (64 px neon) · title (28 px) · epigraph (15 px italic)
//   > query: whose streets? · > coherence 28%
// ─────────────────────────────────────────────────────────────────────────────

import { h, prefersReducedMotion, replayClass, setText } from '../dom';

const SHOW_MS = 2200;

export interface TitleData {
  numeral: string;
  title: string;
  epigraph: string;
  question: string;
  coherence: number;
}

export class ChapterTitle {
  readonly el: HTMLElement;
  private readonly numeral: HTMLElement;
  private readonly title: HTMLElement;
  private readonly epigraph: HTMLElement;
  private readonly query: HTMLElement;
  private readonly coherence: HTMLElement;
  private timer = 0;
  private open = false;
  onClose: (() => void) | null = null;

  constructor() {
    this.numeral = h('div', { class: 'cc-cht-num' });
    this.title = h('div', { class: 'cc-cht-title' });
    this.epigraph = h('div', { class: 'cc-cht-epi' });
    this.query = h('div', { class: 'cc-cht-mono' });
    this.coherence = h('div', { class: 'cc-cht-mono is-dim' });
    this.el = h(
      'div',
      { class: 'cc-chtitle', hidden: true, role: 'dialog', 'aria-live': 'assertive' },
      h('div', { class: 'cc-cht-inner' }, this.numeral, h('div', { class: 'cc-cht-rule' }), this.title, this.epigraph, this.query, this.coherence),
      h('div', { class: 'cc-cht-skip', text: 'Tap to continue' }),
    );
    this.el.addEventListener('click', () => this.hide());
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(d: TitleData): void {
    const num = `CHAPTER ${d.numeral}`;
    setText(this.numeral, num);
    this.numeral.dataset.text = num;
    setText(this.title, d.title);
    setText(this.epigraph, d.epigraph ? `“${d.epigraph.replace(/^["“]|["”]$/g, '')}”` : '');
    setText(this.query, d.question ? (d.question.startsWith('>') ? d.question : `> query: ${d.question}`) : '');
    setText(this.coherence, `> coherence ${Math.round(d.coherence)}%`);
    this.open = true;
    this.el.classList.remove('is-out');
    this.el.hidden = false;
    replayClass(this.el, 'is-in');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), prefersReducedMotion() ? SHOW_MS + 800 : SHOW_MS);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    window.clearTimeout(this.timer);
    this.el.classList.add('is-out');
    window.setTimeout(
      () => {
        if (!this.open) this.el.hidden = true;
      },
      prefersReducedMotion() ? 0 : 280,
    );
    this.onClose?.();
  }
}
