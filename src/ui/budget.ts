// ─────────────────────────────────────────────────────────────────────────────
// Budget panel: treasury, tax-rate slider with a live income projection,
// income / expense lines from world.budget and a 12-month net cash-flow chart
// (diverging bars around a zero baseline; tap / hover a month for its value).
// ─────────────────────────────────────────────────────────────────────────────

import { CURRENCY, MAX_TAX, MIN_TAX } from '../game/config';
import { DAYS_PER_MONTH } from '../game/types';
import type { BudgetLine } from '../game/types';
import { buildDialog, type UIContext } from './context';
import { h, setAttr, setClass, setHidden, setHtml, setText } from './dom';
import { MINUS, credits, groupInt, signed, tickDate } from './format';
import { icon } from './icons';

const CHART_W = 288;
const CHART_H = 76;
const SVG_NS = 'http://www.w3.org/2000/svg';

export class BudgetPanel {
  readonly el: HTMLElement;
  private readonly funds: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly taxVal: HTMLElement;
  private readonly taxHint: HTMLElement;
  private readonly projIncome: HTMLElement;
  private readonly incomeList: HTMLElement;
  private readonly expenseList: HTMLElement;
  private readonly incomeTotal: HTMLElement;
  private readonly expenseTotal: HTMLElement;
  private readonly net: HTMLElement;
  private readonly chart: SVGSVGElement;
  private readonly chartLabel: HTMLElement;
  private readonly chartEmpty: HTMLElement;
  /** Tax rate world.budget's figures were last projected at (they scale linearly with rate). */
  private projRate = -1;
  private lastLines: BudgetLine[] | null = null;
  private chartKey = '';
  private pick = -1;
  private history: number[] = [];

  constructor(private readonly ctx: UIContext) {
    const d = buildDialog({ id: 'cc-budget', title: 'Budget', icon: icon('coin') });
    this.el = d.el;
    d.el.classList.add('cc-budget');
    setText(d.sub, 'Monthly projection');

    this.funds = h('div', { class: 'cc-bud-funds' });
    this.warn = h(
      'div',
      { class: 'cc-callout is-bad', hidden: true, role: 'alert' },
      h('span', { html: icon('warn') }),
      h('span', { text: 'The treasury is in the red. Raise taxes, cut services or let the city grow before building more.' }),
    );

    this.slider = h('input', {
      class: 'cc-range',
      type: 'range',
      min: MIN_TAX,
      max: MAX_TAX,
      step: 1,
      'aria-label': 'Tax rate',
    });
    this.taxVal = h('span', { class: 'cc-bud-taxval' });
    this.taxHint = h('span', { class: 'cc-bud-taxhint' });
    this.projIncome = h('span', { class: 'cc-bud-proj' });
    this.slider.addEventListener('input', this.onSlide);
    this.slider.addEventListener('change', this.onSlideEnd);

    this.incomeList = h('dl', { class: 'cc-lines' });
    this.expenseList = h('dl', { class: 'cc-lines' });
    this.incomeTotal = h('span', { class: 'cc-lines-total is-up' });
    this.expenseTotal = h('span', { class: 'cc-lines-total is-down' });
    this.net = h('div', { class: 'cc-bud-net' });

    this.chart = document.createElementNS(SVG_NS, 'svg');
    this.chart.setAttribute('class', 'cc-chart');
    this.chart.setAttribute('viewBox', `0 0 ${CHART_W} ${CHART_H}`);
    this.chart.setAttribute('preserveAspectRatio', 'none');
    this.chart.setAttribute('role', 'img');
    this.chartLabel = h('div', { class: 'cc-chart-label' });
    this.chartEmpty = h('div', { class: 'cc-chart-empty', text: 'First report lands at the end of the month.' });
    this.chart.addEventListener('pointermove', this.onChartPointer);
    this.chart.addEventListener('pointerdown', this.onChartPointer);
    this.chart.addEventListener('pointerleave', () => {
      this.pick = -1;
      this.drawLabel();
    });

    d.body.append(
      h('div', { class: 'cc-bud-top' }, h('span', { class: 'cc-label', text: 'Treasury' }), this.funds),
      this.warn,
      h(
        'section',
        { class: 'cc-bud-tax cc-subpanel' },
        h('div', { class: 'cc-bud-taxrow' }, h('label', { class: 'cc-label', text: 'Tax rate' }), this.taxVal),
        this.slider,
        h('div', { class: 'cc-bud-taxscale', 'aria-hidden': 'true' }, h('span', { text: `${MIN_TAX}%` }), h('span', { text: '10%' }), h('span', { text: `${MAX_TAX}%` })),
        h('div', { class: 'cc-bud-taxfoot' }, this.taxHint, this.projIncome),
      ),
      h(
        'div',
        { class: 'cc-bud-cols' },
        h('section', { class: 'cc-bud-col' }, h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Income' }), this.incomeTotal), this.incomeList),
        h('section', { class: 'cc-bud-col' }, h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Expenses' }), this.expenseTotal), this.expenseList),
      ),
      this.net,
      h(
        'section',
        { class: 'cc-bud-chart cc-subpanel' },
        h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: 'Net cash flow · 12 months' }), this.chartLabel),
        h('div', { class: 'cc-chart-wrap' }, this.chart, this.chartEmpty),
      ),
    );
    d.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) ctx.modals.close(this.el);
    });
  }

  open(): void {
    this.pick = -1;
    this.chartKey = '';
    this.slider.value = String(this.ctx.game.world.taxRate);
    this.ctx.modals.open(this.el);
    this.refresh();
  }

  get isOpen(): boolean {
    return this.ctx.modals.isOpen(this.el);
  }

  private readonly onSlide = () => {
    const v = Number(this.slider.value);
    this.ctx.game.setTax(v); // emits 'stats' → refresh()
    this.refresh();
  };

  private readonly onSlideEnd = () => {
    // Settle exact figures for the new rate (no time passes, no money moves).
    try {
      this.ctx.game.sim.recomputeAll();
    } catch (err) {
      console.warn('[ui] budget recompute failed', err);
    }
    this.ctx.sfx('click');
    this.refresh();
  };

  refresh(): void {
    if (!this.isOpen) return;
    const w = this.ctx.game.world;
    const b = w.budget;
    if (b.incomeLines !== this.lastLines) {
      this.lastLines = b.incomeLines;
      this.projRate = w.taxRate;
    }
    const rate = w.taxRate;
    // Income scales linearly with the tax rate; rescale the last projection until the sim re-projects.
    const k = this.projRate > 0 ? rate / this.projRate : rate === 0 ? 0 : 1;

    const funds = Math.round(w.funds);
    setText(this.funds, credits(funds));
    setClass(this.funds, 'is-neg', funds < 0);
    setHidden(this.warn, funds >= 0);

    if (document.activeElement !== this.slider && this.slider.value !== String(rate)) this.slider.value = String(rate);
    this.slider.style.setProperty('--fill', `${((rate - MIN_TAX) / (MAX_TAX - MIN_TAX)) * 100}%`);
    setText(this.taxVal, `${rate}%`);
    setText(this.taxHint, rate <= 5 ? 'Low: settlers flock in, thin treasury' : rate <= 11 ? 'Balanced' : rate <= 15 ? 'High: growth slows' : 'Punishing: residents leave');
    setClass(this.taxHint, 'is-warn', rate > 11);
    setClass(this.taxHint, 'is-good', rate <= 11);

    let income = 0;
    const inLines = b.incomeLines.map((l) => {
      const amt = Math.round(l.amount * k);
      income += amt;
      return { label: l.label, amount: amt };
    });
    setText(this.projIncome, `Income ${signed(income)} ${CURRENCY}/mo`);
    this.renderLines(this.incomeList, inLines, 1);
    this.renderLines(this.expenseList, b.expenseLines, -1);
    setText(this.incomeTotal, `+${groupInt(income)}`);
    setText(this.expenseTotal, `${MINUS}${groupInt(b.expenses)}`);
    const net = income - Math.round(b.expenses);
    setHtml(this.net, `<span class="cc-label">Net per month</span><b class="${net >= 0 ? 'is-up' : 'is-down'}">${signed(net)} ${CURRENCY}</b>`);

    this.history = b.history.slice(-12);
    this.drawChart();
  }

  private renderLines(list: HTMLElement, lines: BudgetLine[], sign: 1 | -1): void {
    const key = lines.map((l) => `${l.label}=${Math.round(l.amount)}`).join('|');
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.textContent = '';
    if (lines.length === 0) {
      list.append(h('div', { class: 'cc-lines-empty', text: sign > 0 ? 'No taxpayers yet' : 'Nothing to pay for' }));
      return;
    }
    for (const l of lines) {
      const v = Math.round(l.amount);
      list.append(
        h(
          'div',
          { class: 'cc-line' },
          h('dt', { text: l.label }),
          h('dd', { class: v === 0 ? '' : sign > 0 ? 'is-up' : 'is-down', text: v === 0 ? '0' : `${sign > 0 ? '+' : MINUS}${groupInt(v)}` }),
        ),
      );
    }
  }

  // ── Chart ────────────────────────────────────────────────────────────────

  private drawChart(): void {
    const hist = this.history;
    const key = hist.join(',');
    setHidden(this.chartEmpty, hist.length > 0);
    if (key === this.chartKey) return;
    this.chartKey = key;
    this.chart.textContent = '';
    if (hist.length === 0) {
      this.drawLabel();
      return;
    }
    const max = Math.max(1, ...hist.map((v) => Math.abs(v)));
    const hasNeg = hist.some((v) => v < 0);
    const hasPos = hist.some((v) => v > 0);
    // Zero line placement: centred when both signs appear, else pinned to an edge.
    const pad = 4;
    const zeroY = hasNeg && hasPos ? CHART_H / 2 : hasNeg ? pad : CHART_H - pad;
    const span = hasNeg && hasPos ? CHART_H / 2 - pad : CHART_H - pad * 2;
    const slot = CHART_W / 12;
    const barW = slot - 4; // 2px surface gap each side
    const x0 = CHART_W - hist.length * slot;
    let svg = `<line class="cc-chart-zero" x1="0" x2="${CHART_W}" y1="${zeroY}" y2="${zeroY}"/>`;
    hist.forEach((v, i) => {
      const hgt = Math.max(1.5, (Math.abs(v) / max) * span);
      const x = x0 + i * slot + 2;
      const y = v >= 0 ? zeroY - hgt : zeroY;
      svg += `<path class="cc-chart-bar ${v >= 0 ? 'is-up' : 'is-down'}" data-i="${i}" d="${roundedBar(x, y, barW, hgt, v >= 0)}"/>`;
    });
    this.chart.innerHTML = svg;
    setAttr(this.chart, 'aria-label', `Net cash flow, last ${hist.length} months: ${hist.map((v) => signed(v)).join(', ')} ${CURRENCY}`);
    this.drawLabel();
  }

  private readonly onChartPointer = (e: PointerEvent) => {
    const n = this.history.length;
    if (n === 0) return;
    const r = this.chart.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / Math.max(1, r.width)) * CHART_W;
    const slot = CHART_W / 12;
    const i = Math.floor((fx - (CHART_W - n * slot)) / slot);
    const pick = i >= 0 && i < n ? i : -1;
    if (pick !== this.pick) {
      this.pick = pick;
      this.drawLabel();
    }
  };

  private drawLabel(): void {
    const hist = this.history;
    if (hist.length === 0) {
      setText(this.chartLabel, '');
      return;
    }
    const i = this.pick >= 0 ? this.pick : hist.length - 1;
    const v = hist[i];
    // History entry i settled at the end of month (current month - (n - i)).
    const w = this.ctx.game.world;
    const monthStart = w.tick - (w.tick % DAYS_PER_MONTH);
    const tick = monthStart - (hist.length - i) * DAYS_PER_MONTH;
    setHtml(this.chartLabel, `<span>${tickDate(Math.max(0, tick))}</span> <b class="${v >= 0 ? 'is-up' : 'is-down'}">${signed(v)}</b>`);
    for (const el of this.chart.querySelectorAll('.cc-chart-bar')) {
      el.classList.toggle('is-pick', Number((el as SVGElement).dataset.i) === i);
    }
  }
}

/** Bar path with 3px rounded data end, square end on the baseline. */
function roundedBar(x: number, y: number, w: number, hgt: number, up: boolean): string {
  const r = Math.min(3, w / 2, hgt);
  if (up) {
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  const b = y + hgt;
  return `M${x},${y}V${b - r}Q${x},${b} ${x + r},${b}H${x + w - r}Q${x + w},${b} ${x + w},${b - r}V${y}Z`;
}
