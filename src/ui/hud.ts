// ─────────────────────────────────────────────────────────────────────────────
// Top HUD bar: city + date, treasury (tap → budget), population (tap → city
// report), RCI demand bars, sim speed controls and the menu button.
// Refreshed at ~5 Hz by the UI root; every write is diffed.
// ─────────────────────────────────────────────────────────────────────────────

import { abbr, groupInt, signed } from './format';
import type { UIContext } from './context';
import { closestData, h, replayClass, setAttr, setClass, setHidden, setHtml, setStyle, setText } from './dom';
import { icon } from './icons';

const SPEED_ICONS = ['pause', 'play', 'fast', 'faster'] as const;

interface RciBar {
  up: HTMLElement;
  down: HTMLElement;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly cityName: HTMLElement;
  private readonly cityDate: HTMLElement;
  private readonly fundsVal: HTMLElement;
  private readonly fundsNet: HTMLElement;
  private readonly fundsBtn: HTMLButtonElement;
  private readonly delta: HTMLElement;
  private readonly popVal: HTMLElement;
  private readonly popBtn: HTMLButtonElement;
  private readonly rci: HTMLElement;
  private readonly bars: RciBar[] = [];
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly cycleBtn: HTMLButtonElement;
  /** The City map button (MEGACITY §7.2, §7.3): a gold dot with the count while a land grant waits; not below 375 px. */
  private readonly mapBtn: HTMLButtonElement;
  private readonly mapDot: HTMLElement;
  /** Speed to resume at when un-pausing from the compact cycle button. */
  private resume = 1;
  /** Rich tooltips are on (a mouse that hovers, §14.2): the HUD drops its native `title`s (no double tooltips). */
  private tipsOn = false;
  private readonly menuBtn: HTMLButtonElement;
  private lastFunds = NaN;

  constructor(private readonly ctx: UIContext) {
    this.cityName = h('span', { class: 'cc-hud-name' });
    this.cityDate = h('span', { class: 'cc-hud-date' });
    const city = h('div', { class: 'cc-hud-city' }, this.cityName, this.cityDate);

    this.fundsVal = h('span', { class: 'cc-hud-val' });
    this.fundsNet = h('span', { class: 'cc-hud-sub' });
    this.delta = h('span', { class: 'cc-delta', 'aria-hidden': 'true' });
    this.fundsBtn = h(
      'button',
      { class: 'cc-hud-item cc-hud-funds', type: 'button', 'data-act': 'budget', 'aria-label': 'Treasury — open budget', title: 'Budget' },
      h('span', { class: 'cc-hud-ico', html: icon('coin') }),
      h('span', { class: 'cc-hud-stack' }, this.fundsVal, this.fundsNet),
      this.delta,
    );

    this.popVal = h('span', { class: 'cc-hud-val' });
    this.popBtn = h(
      'button',
      { class: 'cc-hud-item cc-hud-pop', type: 'button', 'data-act': 'report', 'aria-label': 'Population — open city report', title: 'City report' },
      h('span', { class: 'cc-hud-ico', html: icon('pop') }),
      h('span', { class: 'cc-hud-stack' }, this.popVal, h('span', { class: 'cc-hud-sub', text: 'Pop' })),
    );

    this.rci = h('button', { class: 'cc-rci', type: 'button', 'data-act': 'report', 'aria-label': 'Demand' });
    for (const k of ['r', 'c', 'i']) {
      const up = h('i', { class: 'cc-rci-up' });
      const down = h('i', { class: 'cc-rci-down' });
      this.rci.append(h('span', { class: `cc-rci-bar is-${k}` }, h('span', { class: 'cc-rci-track' }, up, down), h('b', { text: k.toUpperCase() })));
      this.bars.push({ up, down });
    }

    const speed = h('div', { class: 'cc-speed', role: 'group', 'aria-label': 'Simulation speed' });
    const labels = ['Pause', 'Normal speed', 'Fast', 'Fastest'];
    const keys = ['Space', '1', '2', '3'];
    for (let s = 0; s <= 3; s++) {
      const b = h('button', {
        class: `cc-speed-btn${s > 0 ? ' is-wideonly' : ''}`,
        type: 'button',
        'data-speed': s,
        'aria-label': labels[s],
        title: `${labels[s]} (${keys[s]})`,
        'aria-pressed': 'false',
        html: icon(SPEED_ICONS[s]),
      });
      this.speedBtns.push(b);
      speed.append(b);
    }
    this.cycleBtn = h('button', { class: 'cc-speed-btn cc-speed-cycle is-narrowonly', type: 'button', 'data-act': 'speed-cycle', 'aria-label': 'Change speed' });
    speed.append(this.cycleBtn);

    const menu = (this.menuBtn = h('button', { class: 'cc-hud-menu', type: 'button', 'data-act': 'menu', 'aria-label': 'Menu', title: 'Menu', html: icon('menu') }));
    this.mapDot = h('span', { class: 'cc-hud-mapdot', hidden: true });
    this.mapBtn = h(
      'button',
      { class: 'cc-hud-map', type: 'button', 'data-act': 'map', 'aria-label': 'City map', title: 'City map', hidden: true },
      h('span', { class: 'cc-hud-mapico', html: icon('map') }),
      h('span', { class: 'cc-hud-maplabel is-wideonly', text: 'City map' }),
      this.mapDot,
    );

    this.el = h(
      'header',
      { class: 'cc-hud', role: 'toolbar', 'aria-label': 'City status' },
      city,
      this.fundsBtn,
      this.popBtn,
      this.rci,
      h('span', { class: 'cc-hud-spacer' }),
      speed,
      this.mapBtn,
      menu,
    );

    this.el.addEventListener('click', this.onClick);
    this.resume = ctx.game.speed > 0 ? ctx.game.speed : 1;
    this.syncSpeed();
    this.refresh();
  }

  private readonly onClick = (e: MouseEvent) => {
    const game = this.ctx.game;
    const sp = closestData(e.target, 'speed', this.el);
    if (sp) {
      const s = Number(sp.dataset.speed);
      // Tapping pause while paused resumes (one-thumb toggle).
      game.setSpeed(s === 0 && game.speed === 0 ? this.resume : s);
      return;
    }
    const act = closestData(e.target, 'act', this.el)?.dataset.act;
    if (act === 'speed-cycle') {
      if (game.speed === 0) game.setSpeed(this.resume);
      else game.setSpeed((game.speed % 3) + 1);
    } else if (act === 'budget') this.ctx.actions.openBudget();
    else if (act === 'report') this.ctx.actions.openReport();
    else if (act === 'menu') this.ctx.actions.openMenu();
    else if (act === 'map') this.ctx.actions.openCityMap();
  };

  /** Reflect game.speed in the buttons (called on 'speed'). */
  syncSpeed(): void {
    const s = this.ctx.game.speed;
    if (s > 0) this.resume = s;
    for (let i = 0; i < this.speedBtns.length; i++) {
      const on = i === s;
      setClass(this.speedBtns[i], 'is-on', on);
      setAttr(this.speedBtns[i], 'aria-pressed', on ? 'true' : 'false');
    }
    const shown = s > 0 ? s : this.resume;
    setHtml(this.cycleBtn, icon(SPEED_ICONS[shown]) + `<span class="cc-speed-x">${shown}×</span>`);
    setClass(this.cycleBtn, 'is-on', s > 0);
    setClass(this.cycleBtn, 'is-paused', s === 0);
    setAttr(this.cycleBtn, 'aria-label', s === 0 ? `Resume at ${shown}× speed` : `Speed ${s}× — tap to change`);
    setClass(this.el, 'is-paused', s === 0);
    // Lower detail caps every speed (MEGACITY §3.11): the speed buttons say so.
    const cap = this.ctx.game.speedCapNote;
    for (let i = 1; i < this.speedBtns.length; i++) this.setTitle(this.speedBtns[i], cap ? `${['Pause', 'Normal speed', 'Fast', 'Fastest'][i]} · ${cap}` : `${['Pause', 'Normal speed', 'Fast', 'Fastest'][i]} (${i})`);
    this.setTitle(this.cycleBtn, cap ?? '');
  }

  /** Rich tooltips on (§14.2): drop the native `title`s, keep the aria-labels; off: today's titles again. */
  setTips(on: boolean): void {
    if (on === this.tipsOn) return;
    this.tipsOn = on;
    this.setTitle(this.fundsBtn, 'Budget');
    this.setTitle(this.popBtn, 'City report');
    this.setTitle(this.speedBtns[0], 'Pause (Space)');
    this.setTitle(this.mapBtn, 'City map');
    this.setTitle(this.menuBtn, 'Menu');
    this.syncSpeed();
  }

  /** A native tooltip, dropped while rich tooltips are on. */
  private setTitle(el: HTMLElement, text: string): void {
    if (this.tipsOn || !text) el.removeAttribute('title');
    else if (el.getAttribute('title') !== text) el.setAttribute('title', text);
  }

  /** Throttled refresh of every figure. */
  refresh(): void {
    const { game, compact } = this.ctx;
    const w = game.world;
    const s = w.stats;

    setText(this.cityName, w.cityName);
    setText(this.cityDate, w.dateLabel());

    const funds = Math.round(w.funds);
    setText(this.fundsVal, compact && Math.abs(funds) >= 100_000 ? abbr(funds) : groupInt(funds));
    setClass(this.fundsBtn, 'is-neg', funds < 0);
    const net = Math.round(w.budget.income - w.budget.expenses);
    setText(this.fundsNet, `${signed(net, compact)}/mo`);
    setClass(this.fundsNet, 'is-up', net > 0);
    setClass(this.fundsNet, 'is-down', net < 0);
    if (Number.isFinite(this.lastFunds) && funds !== this.lastFunds) this.flashDelta(funds - this.lastFunds);
    this.lastFunds = funds;

    // The City map button: a region city only; the gold dot counts the land grants waiting.
    const grants = w.region >= 3 ? Math.max(0, w.districts.grants | 0) : 0;
    setHidden(this.mapBtn, w.region < 3);
    setHidden(this.mapDot, grants <= 0);
    setText(this.mapDot, String(grants));
    setClass(this.mapBtn, 'has-grant', grants > 0);
    setAttr(this.mapBtn, 'aria-label', grants > 0 ? `City map, ${grants} land ${grants === 1 ? 'grant' : 'grants'} waiting` : 'City map');

    const pop = s.population;
    setText(this.popVal, compact || pop >= 100_000 ? abbr(pop) : groupInt(pop));

    const d = s.demand;
    const vals = [d.res, d.com, d.ind];
    for (let i = 0; i < 3; i++) {
      const v = Math.max(-1, Math.min(1, vals[i]));
      const q = Math.round(v * 40) / 40; // quantise so tiny jitters don't restyle
      setStyle(this.bars[i].up, 'transform', `scaleY(${q > 0 ? q : 0})`);
      setStyle(this.bars[i].down, 'transform', `scaleY(${q < 0 ? -q : 0})`);
    }
    setAttr(this.rci, 'aria-label', `Demand: homes ${word(d.res)}, shops ${word(d.com)}, industry ${word(d.ind)}. Open city report`);
  }

  /** Reset the funds baseline (world swapped) so no bogus delta floats up. */
  resetBaseline(): void {
    this.lastFunds = NaN;
  }

  private flashDelta(delta: number): void {
    setText(this.delta, signed(delta, true));
    setClass(this.delta, 'is-up', delta > 0);
    setClass(this.delta, 'is-down', delta < 0);
    replayClass(this.delta, 'is-show');
  }
}

function word(v: number): string {
  if (v > 0.5) return 'very high';
  if (v > 0.15) return 'high';
  if (v > -0.15) return 'steady';
  if (v > -0.5) return 'low';
  return 'very low';
}
