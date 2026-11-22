// ─────────────────────────────────────────────────────────────────────────────
// First-run coach card: three steps (road → homes + fabs → power) that tick
// themselves off as the player builds. Shown for fresh cities only, collapses
// to one line while a tool or tray is active, dismissal persists.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, ZONES } from '../game/config';
import { storageGet, storageSet } from '../game/game';
import { ZoneType } from '../game/types';
import type { UIContext } from './context';
import { h, replayClass, setClass, setText } from './dom';
import { icon, type IconName } from './icons';

const COACH_KEY = 'cybercity.ui.coach.v1';

interface Step {
  title: string;
  body: string;
  icon: IconName;
  cta: string;
  done: boolean;
  el?: HTMLElement;
}

export class Coach {
  readonly el: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly steps: Step[];
  private active = false;
  private finished = false;
  private collapsed = false;

  constructor(private readonly ctx: UIContext) {
    this.steps = [
      { title: 'Build a road', body: 'Drag across tiles. Roads can bridge water.', icon: 'road', cta: 'Road', done: false },
      {
        title: `Zone ${ZONES.res.name} & ${ZONES.ind.name} next to it`,
        body: 'Homes need jobs. Keep zones within 3 tiles of a road.',
        icon: 'zones',
        cta: 'Zones',
        done: false,
      },
      { title: `Add a ${BUILDINGS.solar.name}`, body: 'Place it touching your roads or zones.', icon: 'solar', cta: 'Solar', done: false },
    ];
    this.count = h('span', { class: 'cc-coach-count' });
    this.list = h('ol', { class: 'cc-coach-steps' });
    this.steps.forEach((s, i) => {
      s.el = h(
        'li',
        { class: 'cc-coach-step' },
        h('span', { class: 'cc-coach-mark', html: `<b>${i + 1}</b>${icon('check')}` }),
        h('span', { class: 'cc-coach-text' }, h('strong', { text: s.title }), h('span', { text: s.body })),
        h('button', { class: 'cc-coach-go', type: 'button', 'data-step': i, 'aria-label': `Show me: ${s.title}`, html: `${icon(s.icon)}<span>${s.cta}</span>` }),
      );
      this.list.append(s.el);
    });
    this.el = h(
      'section',
      { class: 'cc-coach cc-panel', hidden: true, 'aria-label': 'Getting started' },
      h(
        'header',
        { class: 'cc-coach-head' },
        h('span', { class: 'cc-coach-kicker', text: 'Getting started' }),
        this.count,
        h('button', { class: 'cc-iconbtn cc-coach-x', type: 'button', 'data-act': 'dismiss', 'aria-label': 'Dismiss tips', html: icon('close') }),
      ),
      this.list,
      h('div', { class: 'cc-coach-done', html: `${icon('check')}<span>City online. Watch the R·C·I bars and build what's rising.</span>` }),
    );
    this.el.addEventListener('click', this.onClick);
    this.evaluate();
  }

  /** Decide whether a (possibly new) world should show the coach. */
  evaluate(): void {
    const w = this.ctx.game.world;
    const dismissed = storageGet(COACH_KEY) === '1';
    const fresh = w.tick < 5 && !w.tiles.some((t) => t.road);
    this.finished = false;
    this.active = !dismissed && fresh;
    for (const s of this.steps) s.done = false;
    setClass(this.el, 'is-finished', false);
    this.el.hidden = !this.active;
    if (this.active) {
      this.check();
      replayClass(this.el, 'is-in');
    }
  }

  /** Re-check step completion (throttled by the root, cheap 4k-tile scan). */
  check(): void {
    if (!this.active || this.finished) return;
    const w = this.ctx.game.world;
    let road = false;
    let res = false;
    let ind = false;
    for (const t of w.tiles) {
      if (t.road) road = true;
      else if (t.zone === ZoneType.Residential) res = true;
      else if (t.zone === ZoneType.Industrial) ind = true;
      if (road && res && ind) break;
    }
    let plant = false;
    for (const b of w.buildings.values()) if (BUILDINGS[b.type].powerSupply > 0) plant = true;
    const done = [road, res && ind, plant];
    let current = -1;
    for (let i = 0; i < 3; i++) {
      const s = this.steps[i];
      if (done[i] && !s.done) {
        s.done = true;
        replayClass(s.el!, 'is-tick');
        this.ctx.sfx('zone');
      }
      setClass(s.el!, 'is-done', s.done);
      if (!s.done && current < 0) current = i;
    }
    for (let i = 0; i < 3; i++) setClass(this.steps[i].el!, 'is-current', i === current);
    const n = this.steps.filter((s) => s.done).length;
    setText(this.count, `${n}/3`);
    if (current < 0) this.finish();
  }

  /** Collapse to the current step while a tool / tray / sheet is active. */
  setCollapsed(c: boolean): void {
    if (c === this.collapsed) return;
    this.collapsed = c;
    setClass(this.el, 'is-collapsed', c);
  }

  private finish(): void {
    this.finished = true;
    setClass(this.el, 'is-finished', true);
    storageSet(COACH_KEY, '1');
    window.setTimeout(() => this.hide(), 5200);
  }

  private hide(): void {
    this.active = false;
    this.el.classList.add('is-out');
    window.setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove('is-out');
    }, 240);
  }

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act="dismiss"]')) {
      storageSet(COACH_KEY, '1');
      this.hide();
      return;
    }
    const go = t.closest<HTMLElement>('[data-step]');
    if (!go) return;
    const i = Number(go.dataset.step);
    const { game, actions } = this.ctx;
    if (i === 0) {
      actions.closeTray();
      game.setTool('road');
    } else if (i === 1) {
      actions.openTray('zones');
    } else {
      actions.closeTray();
      game.setTool('solar');
    }
  };
}
