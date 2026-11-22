// ─────────────────────────────────────────────────────────────────────────────
// Transient feedback: toasts, the live action pill shown while dragging a
// tool, the milestone celebration banner and the FPS readout.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, BUILDING_ORDER, MILESTONES, ZONES, isBuildingTool, isZoneTool } from '../game/config';
import type { Game } from '../game/game';
import type { ActionPlan } from '../game/types';
import { h, prefersReducedMotion, replayClass, setClass, setHidden, setHtml, setText } from './dom';
import { credits, groupInt, MINUS } from './format';
import { footprintTouchesGrid } from './grid';
import { icon, type IconName } from './icons';
import { toolMeta } from './tools';

// ── Toasts ─────────────────────────────────────────────────────────────────

type ToastKind = 'info' | 'error' | 'good';
const TOAST_ICON: Record<ToastKind, IconName> = { info: 'info', error: 'warn', good: 'check' };
const TOAST_MS: Record<ToastKind, number> = { info: 3200, error: 2600, good: 3000 };
const TOAST_MAX = 3;

interface ToastEntry {
  el: HTMLElement;
  text: string;
  count: number;
  countEl: HTMLElement;
  timer: number;
}

export class Toasts {
  readonly el: HTMLElement;
  private readonly live: ToastEntry[] = [];
  /** Toasts that arrived while a full-screen story surface was up (shown once it closes). */
  private readonly waiting: { text: string; kind: ToastKind; count: number }[] = [];
  /**
   * True while toasts must not print over the screen (chapter title, Charter
   * Night, ending screen): non-error toasts wait and show afterwards.
   */
  held: () => boolean = () => false;

  constructor() {
    this.el = h('div', { class: 'cc-toasts', role: 'status', 'aria-live': 'polite' });
  }

  push(text: string, kind: ToastKind = 'info'): void {
    if (kind !== 'error' && this.held()) {
      const w = this.waiting.find((t) => t.text === text);
      if (w) w.count++;
      else this.waiting.push({ text, kind, count: 1 });
      while (this.waiting.length > TOAST_MAX) this.waiting.shift();
      return;
    }
    const dup = this.live.find((t) => t.text === text);
    if (dup) {
      dup.count++;
      setText(dup.countEl, `×${dup.count}`);
      replayClass(dup.el, 'is-bump');
      this.arm(dup, kind);
      return;
    }
    const countEl = h('span', { class: 'cc-toast-count' });
    const el = h(
      'div',
      { class: 'cc-toast', 'data-kind': kind },
      h('span', { class: 'cc-toast-ico', html: icon(TOAST_ICON[kind]) }),
      h('span', { class: 'cc-toast-text', text }),
      countEl,
    );
    const entry: ToastEntry = { el, text, count: 1, countEl, timer: 0 };
    this.el.append(el);
    this.live.push(entry);
    while (this.live.length > TOAST_MAX) this.dismiss(this.live[0], true);
    this.arm(entry, kind);
  }

  /** Per frame (cheap): hide live toasts while held, release the waiting ones once nothing full-screen is up. */
  flush(): void {
    const held = this.held();
    setClass(this.el, 'is-held', held);
    if (!this.waiting.length || held) return;
    for (const t of this.waiting.splice(0)) for (let i = 0; i < t.count; i++) this.push(t.text, t.kind);
  }

  private arm(t: ToastEntry, kind: ToastKind): void {
    window.clearTimeout(t.timer);
    // Long messages get time to be read (~45 ms a character past the base).
    const ms = Math.max(TOAST_MS[kind], 1200 + t.text.length * 45);
    t.timer = window.setTimeout(() => this.dismiss(t, false), ms);
  }

  private dismiss(t: ToastEntry, instant: boolean): void {
    const i = this.live.indexOf(t);
    if (i < 0) return;
    this.live.splice(i, 1);
    window.clearTimeout(t.timer);
    if (instant || prefersReducedMotion()) t.el.remove();
    else {
      t.el.classList.add('is-out');
      window.setTimeout(() => t.el.remove(), 220);
    }
  }
}

// ── Action pill ────────────────────────────────────────────────────────────

/** Live "ROAD ×12 · −180 CR" readout of game.preview, refreshed every frame (diffed). */
export class ActionPill {
  readonly el: HTMLElement;
  private readonly ico: HTMLElement;
  private readonly name: HTMLElement;
  private readonly cost: HTMLElement;
  private readonly note: HTMLElement;
  private lastPlan: ActionPlan | null = null;
  private lastFunds = NaN;
  private lastKey = '';

  constructor() {
    this.ico = h('span', { class: 'cc-pill-ico' });
    this.name = h('span', { class: 'cc-pill-name' });
    this.cost = h('span', { class: 'cc-pill-cost' });
    this.note = h('span', { class: 'cc-pill-note' });
    this.el = h('div', { class: 'cc-pill', hidden: true, 'aria-hidden': 'true' }, this.ico, this.name, this.cost, this.note);
  }

  update(game: Game): void {
    const plan = game.tool === 'inspect' ? null : game.preview;
    if (plan === this.lastPlan && game.world.funds === this.lastFunds) return;
    this.lastPlan = plan;
    this.lastFunds = game.world.funds;
    if (!plan || plan.tiles.length === 0) {
      setHidden(this.el, true);
      this.lastKey = '';
      return;
    }
    const meta = toolMeta(plan.tool);
    const count = changedTiles(game, plan);
    const name = plan.tool === 'bulldoze' ? 'Demolish' : meta.name;
    const label = isBuildingTool(plan.tool) || plan.tool === 'skybridge' || count <= 1 ? name : `${name} ×${count}`;
    const costText = plan.valid ? (plan.cost > 0 ? `${MINUS}${credits(plan.cost)}` : 'Free') : '';
    let note = plan.reason && plan.reason !== 'Nothing to change' ? plan.reason : '';
    // A power plant only feeds what it touches: flag a spot with no road, zone or building beside it.
    const fp = plan.footprint;
    const stranded =
      plan.valid && !note && !!fp && isBuildingTool(plan.tool) && BUILDINGS[plan.tool].powerSupply > 0 && !footprintTouchesGrid(game.world, fp.x, fp.y, fp.size);
    if (stranded) note = 'Not connected · touch a road or zone';
    const key = `${plan.tool}|${label}|${costText}|${note}|${plan.valid}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.el.dataset.tool = plan.tool;
    this.el.style.setProperty('--accent', meta.color);
    setHtml(this.ico, icon(meta.icon));
    setText(this.name, label);
    setText(this.cost, costText);
    setHidden(this.cost, !costText);
    setText(this.note, note);
    setHidden(this.note, !note);
    setClass(this.el, 'is-bad', !plan.valid);
    setClass(this.el, 'is-warn', stranded);
    setHidden(this.el, false);
  }
}

/** Number of tiles the plan would actually change (plan.tiles also lists no-op tiles as ok). */
function changedTiles(game: Game, plan: ActionPlan): number {
  const w = game.world;
  let n = 0;
  if (plan.tool === 'road') {
    for (const p of plan.tiles) if (p.ok && !w.tileAt(p.x, p.y)?.road) n++;
  } else if (plan.tool === 'rail') {
    for (const p of plan.tiles) if (p.ok && !w.rail[w.idx(p.x, p.y)]) n++;
  } else if (isZoneTool(plan.tool)) {
    const zone = ZONES[plan.tool].zone;
    for (const p of plan.tiles) if (p.ok && w.tileAt(p.x, p.y)?.zone !== zone) n++;
  } else {
    for (const p of plan.tiles) if (p.ok) n++;
  }
  return n;
}

// ── Milestone banner ───────────────────────────────────────────────────────

export class MilestoneBanner {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly unlocks: HTMLElement;
  private readonly queue: { pop: number; title: string }[] = [];
  private current: { pop: number; title: string } | null = null;
  private timer = 0;
  private showing = false;
  private shownAt = 0;
  /**
   * True while a story card, sheet, chapter title, Charter Night, the ending or a
   * dialog covers the map: the banner (z 9) would sit unreadable under it, so it
   * waits and shows once the surface closes.
   */
  held: () => boolean = () => false;

  constructor() {
    this.title = h('div', { class: 'cc-banner-title' });
    this.sub = h('div', { class: 'cc-banner-sub' });
    this.unlocks = h('div', { class: 'cc-banner-unlocks' });
    this.el = h(
      'div',
      { class: 'cc-banner', hidden: true, role: 'alert' },
      h('div', { class: 'cc-banner-kicker', html: `${icon('star')}<span>Milestone reached</span>${icon('star')}` }),
      this.title,
      this.sub,
      this.unlocks,
      h('div', { class: 'cc-banner-rays', 'aria-hidden': 'true' }),
    );
    // The banner floats over the middle of the map, so it lets touches through
    // (pointer-events: none in CSS); any tap anywhere dismisses it instead.
    // Taps on story surfaces and dialogs belong to them (e.g. a chapter title's tap-to-continue).
    window.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as Element | null;
        if (t && typeof t.closest === 'function' && t.closest('.cc-story, .cc-modal-layer')) return;
        if (this.showing && performance.now() - this.shownAt > 350) this.next();
      },
      { capture: true, passive: true },
    );
  }

  show(m: { pop: number; title: string }): void {
    this.queue.push(m);
    if (!this.showing && !this.held()) this.next();
  }

  /** Per frame (cheap): park the banner while something covers it, resume after. */
  update(): void {
    const held = this.held();
    if (held && this.showing && this.current) {
      // A surface opened over it (milestone and chapter title on the same tick): requeue, hide now.
      window.clearTimeout(this.timer);
      this.queue.unshift(this.current);
      this.current = null;
      this.showing = false;
      this.el.hidden = true;
      this.el.classList.remove('is-out', 'is-in');
    } else if (!held && !this.showing && this.queue.length) this.next();
  }

  private next(): void {
    window.clearTimeout(this.timer);
    const m = this.held() ? undefined : this.queue.shift();
    this.current = m ?? null;
    if (!m) {
      this.showing = false;
      if (!this.el.hidden) {
        this.el.classList.add('is-out');
        window.setTimeout(() => {
          if (!this.showing) this.el.hidden = true;
          this.el.classList.remove('is-out');
        }, prefersReducedMotion() ? 0 : 320);
      }
      return;
    }
    this.showing = true;
    const def = MILESTONES.find((x) => x.pop === m.pop);
    const idx = def ? MILESTONES.indexOf(def) : -1;
    const prevPop = idx > 0 ? MILESTONES[idx - 1].pop : 0;
    const title = m.title.toUpperCase();
    setText(this.title, title);
    this.title.dataset.text = title;
    this.sub.innerHTML =
      `<span>${groupInt(m.pop)} residents</span>` +
      (def ? `<i class="cc-banner-dot">·</i><span>Charter grant <b>+${credits(def.grant)}</b></span>` : '');
    const unlocked = BUILDING_ORDER.filter((t) => BUILDINGS[t].unlockPop > prevPop && BUILDINGS[t].unlockPop <= m.pop).map(
      (t) => BUILDINGS[t].name,
    );
    setText(this.unlocks, unlocked.length ? `Now available: ${unlocked.join(', ')}` : '');
    setHidden(this.unlocks, unlocked.length === 0);
    this.el.classList.remove('is-out');
    this.el.hidden = false;
    replayClass(this.el, 'is-in');
    this.shownAt = performance.now();
    this.timer = window.setTimeout(() => this.next(), 4600);
  }
}

// ── FPS readout ────────────────────────────────────────────────────────────

export class FpsMeter {
  readonly el: HTMLElement;
  private frames = 0;
  private acc = 0;
  private worst = 0;

  constructor() {
    this.el = h('div', { class: 'cc-fps', hidden: true, 'aria-hidden': 'true' });
  }

  update(dt: number, visible: boolean): void {
    setHidden(this.el, !visible);
    if (!visible || !(dt > 0)) return;
    this.frames++;
    this.acc += dt;
    if (dt > this.worst) this.worst = dt;
    if (this.acc >= 0.5) {
      const fps = Math.round(this.frames / this.acc);
      setText(this.el, `${fps} FPS · ${(this.worst * 1000).toFixed(0)}ms`);
      setClass(this.el, 'is-low', fps < 40);
      this.frames = 0;
      this.acc = 0;
      this.worst = 0;
    }
  }
}
