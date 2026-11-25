// ─────────────────────────────────────────────────────────────────────────────
// Transient feedback: toasts, the live action pill shown while dragging a
// tool, the milestone celebration banner and the FPS readout.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, BUILDING_ORDER, MILESTONES, ROAD_KINDS, SKYWAY, ZONES, isBuildingTool, isZoneTool, type BuildingDef } from '../game/config';
import type { ToastAction } from '../game/events';
import type { Game } from '../game/game';
import { isRoadTool } from '../game/roads';
import type { ActionPlan, MomentId } from '../game/types';
import type { World } from '../game/world';
import { h, prefersReducedMotion, replayClass, setAttr, setClass, setHidden, setHtml, setText } from './dom';
import { credits, groupInt, MINUS } from './format';
import { footprintTouchesGrid } from './grid';
import { icon, type IconName } from './icons';
import { INFRA_POP, SECTIONS, toolMeta } from './tools';
import { skyBus } from '../input/mapbus';
import { inReach } from '../input/skybridge';
import { skybridgeView } from '../render/overlay';

// ── Toasts ─────────────────────────────────────────────────────────────────

type ToastKind = 'info' | 'error' | 'good';
type ActionId = ToastAction['id'];
const TOAST_ICON: Record<ToastKind, IconName> = { info: 'info', error: 'warn', good: 'check' };
const TOAST_MS: Record<ToastKind, number> = { info: 3200, error: 2600, good: 3000 };
const TOAST_MAX = 3;
const ACTION_ICON: Record<ActionId, IconName> = { undo: 'undo', watch: 'eye', map: 'layers', export: 'save' };

/** What a toast's button does (Undo, Watch; EXPANSION §2.9), wired by the UI root. */
export interface ToastActionHooks {
  run(id: ActionId): void;
  /** Is the action still possible (the undo window is open, the first launch is still ahead)? */
  alive(id: ActionId): boolean;
  /** Seconds the action has left, if the root knows (the launch lead counts unpaused time only). */
  left?(id: ActionId): number;
}

interface ToastEntry {
  el: HTMLElement;
  text: string;
  count: number;
  countEl: HTMLElement;
  timer: number;
  action?: ToastAction;
}

interface WaitingToast {
  text: string;
  kind: ToastKind;
  count: number;
  action?: ToastAction;
  /** performance.now() when it arrived (an action's window runs while it waits). */
  at: number;
}

export class Toasts {
  readonly el: HTMLElement;
  private readonly live: ToastEntry[] = [];
  /** Toasts that arrived while a full-screen story surface was up (shown once it closes). */
  private readonly waiting: WaitingToast[] = [];
  /**
   * True while toasts must not print over the screen (chapter title, Charter
   * Night, ending screen): non-error toasts wait and show afterwards.
   */
  held: () => boolean = () => false;
  /** Toast buttons; without hooks an action toast shows as plain text. */
  hooks: ToastActionHooks | null = null;

  constructor() {
    this.el = h('div', { class: 'cc-toasts', role: 'status', 'aria-live': 'polite' });
  }

  push(text: string, kind: ToastKind = 'info', action?: ToastAction): void {
    if (kind !== 'error' && this.held()) {
      const w = action ? undefined : this.waiting.find((t) => t.text === text && !t.action);
      if (w) w.count++;
      else {
        // One waiting toast per action (a newer Undo replaces the older one).
        if (action) this.dropWaiting(action.id);
        this.waiting.push({ text, kind, count: 1, action, at: performance.now() });
      }
      while (this.waiting.length > TOAST_MAX) this.waiting.shift();
      return;
    }
    if (action && this.hooks) {
      // One live toast per action: only the last drag can be undone.
      for (const t of this.live.slice()) if (t.action?.id === action.id) this.dismiss(t, true);
    } else {
      const dup = this.live.find((t) => t.text === text && !t.action);
      if (dup) {
        dup.count++;
        setText(dup.countEl, `×${dup.count}`);
        replayClass(dup.el, 'is-bump');
        this.arm(dup, kind);
        return;
      }
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
    if (action && this.hooks) {
      entry.action = action;
      const btn = h(
        'button',
        { class: 'cc-toast-act', type: 'button', 'data-act': action.id, 'aria-label': `${action.label}: ${text}` },
        h('span', { class: 'cc-toast-act-ico', html: icon(ACTION_ICON[action.id]) }),
        h('span', { text: action.label }),
      );
      btn.style.setProperty('--sec', `${Math.max(1, action.sec)}s`);
      btn.addEventListener('click', () => {
        if (!this.live.includes(entry)) return;
        this.dismiss(entry, false);
        this.hooks?.run(action.id);
      });
      el.classList.add('has-act');
      el.append(btn);
    }
    // A toast with a button goes on top: toasts below it come and go without moving it under the finger.
    if (entry.action) this.el.prepend(el);
    else this.el.append(el);
    this.live.push(entry);
    // Make room: an Undo or Watch toast is the last to go (its button must stay where the finger is).
    while (this.live.length > TOAST_MAX) this.dismiss(this.live.find((t) => !t.action) ?? this.live[0], true);
    this.arm(entry, kind);
  }

  private dropWaiting(id: ActionId): void {
    for (let i = this.waiting.length - 1; i >= 0; i--) if (this.waiting[i].action?.id === id) this.waiting.splice(i, 1);
  }

  /** Per frame (cheap): hide live toasts while held, release the waiting ones once nothing full-screen is up. */
  flush(): void {
    const held = this.held();
    setClass(this.el, 'is-held', held);
    // An action that can no longer run (undo window closed, launch gone) takes its toast with it.
    if (this.hooks) for (const t of this.live) if (t.action && !this.hooks.alive(t.action.id)) this.dismiss(t, false);
    if (!this.waiting.length || held) return;
    const now = performance.now();
    for (const t of this.waiting.splice(0)) {
      if (t.action) {
        // Watch follows the launch lead (unpaused seconds), not the wall clock: it is stale only once the lead is gone.
        const watch = t.action.id === 'watch';
        const left = watch ? Math.max(1, this.hooks?.left?.('watch') ?? t.action.sec) : t.action.sec - (now - t.at) / 1000;
        if (left < 1 || !this.hooks?.alive(t.action.id)) continue; // stale: its window closed while it waited
        this.push(t.text, t.kind, { ...t.action, sec: Math.ceil(left) });
        continue;
      }
      for (let i = 0; i < t.count; i++) this.push(t.text, t.kind);
    }
  }

  private arm(t: ToastEntry, kind: ToastKind): void {
    window.clearTimeout(t.timer);
    // Watch stays until the launch lead ends (flush drops it once alive('watch') is false): the lead
    // counts unpaused seconds only, so a pause or a story card must not time the button out first.
    if (t.action?.id === 'watch') return;
    // Long messages get time to be read (~45 ms a character past the base); a button stays for its window.
    const ms = t.action ? t.action.sec * 1000 : Math.max(TOAST_MS[kind], 1200 + t.text.length * 45);
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

/** ✓ / ✕ on a plan waiting for confirmation (EXPANSION §7.7), wired by the UI root. */
export interface PillHooks {
  confirm(): void;
  cancel(): void;
}

/**
 * Live "STREET ×12 · −180 CR" readout of game.preview, refreshed every frame (diffed). While a
 * costly or lossy plan waits for ✓ (game.pendingConfirm), the pill grows and shows ✓ and ✕.
 */
export class ActionPill {
  readonly el: HTMLElement;
  private readonly ico: HTMLElement;
  private readonly name: HTMLElement;
  private readonly cost: HTMLElement;
  private readonly note: HTMLElement;
  private readonly btns: HTMLElement;
  private readonly okBtn: HTMLButtonElement;
  /** The Skybridge tool's "Show routes" chip (MEGACITY §5.4, §7.4): toggles the blue "2" route badges. */
  private readonly routesBtn: HTMLButtonElement;
  /** Extra controls above ✓ / ✕ (the Corp Spire's sponsor row, §6.2), mounted by the UI root. */
  readonly row: HTMLElement;
  private lastPlan: ActionPlan | null = null;
  private lastFunds = NaN;
  private lastConfirm = false;
  private lastKey = '';
  /** The skybridge source's partner count, cached by source and world version (the pill runs every frame). */
  private reachKey = '';
  private reachN = 0;

  constructor(hooks?: PillHooks) {
    this.ico = h('span', { class: 'cc-pill-ico' });
    this.name = h('span', { class: 'cc-pill-name' });
    this.cost = h('span', { class: 'cc-pill-cost' });
    this.note = h('span', { class: 'cc-pill-note' });
    this.okBtn = h('button', { class: 'cc-pill-btn is-ok', type: 'button', 'data-act': 'pill-ok', 'aria-label': 'Build it', html: icon('check') });
    const noBtn = h('button', { class: 'cc-pill-btn is-no', type: 'button', 'data-act': 'pill-no', 'aria-label': 'Cancel', html: icon('close') });
    this.btns = h('span', { class: 'cc-pill-btns', hidden: true }, noBtn, this.okBtn);
    this.routesBtn = h('button', { class: 'cc-pill-chip', type: 'button', 'data-act': 'pill-routes', 'aria-pressed': 'false', hidden: true, text: 'Show routes' });
    this.row = h('div', { class: 'cc-pill-row', hidden: true });
    const text = h('span', { class: 'cc-pill-text' }, h('span', { class: 'cc-pill-line' }, this.name, this.cost), this.note);
    this.el = h('div', { class: 'cc-pill', hidden: true, 'aria-hidden': 'true' }, this.ico, text, this.routesBtn, this.row, this.btns);
    this.okBtn.addEventListener('click', () => hooks?.confirm());
    noBtn.addEventListener('click', () => hooks?.cancel());
    this.routesBtn.addEventListener('click', () => {
      skybridgeView.showRoutes = !skybridgeView.showRoutes;
      this.lastKey = '';
    });
  }

  /** The ✓ / ✕ buttons are showing. */
  get confirming(): boolean {
    return this.lastConfirm;
  }

  update(game: Game): void {
    const plan = game.tool === 'inspect' ? null : game.preview;
    const confirm = !!plan && game.pendingConfirm?.plan === plan;
    const bridge = game.tool === 'skybridge';
    const src = bridge ? game.bridgeSource : null;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const flash = bridge && skyBus.flash && now < skyBus.flash.until && !confirm ? skyBus.flash : null;
    if (skyBus.flash && !flash && now >= skyBus.flash.until) skyBus.flash = null;
    const quick = `${plan ? 'p' : '-'}|${src ? `${src.x},${src.y}` : ''}|${flash ? flash.until : 0}|${skybridgeView.showRoutes}|${game.world.version}`;
    if (plan === this.lastPlan && game.world.funds === this.lastFunds && confirm === this.lastConfirm && quick === this.reachKey.split('#')[1]) return;
    this.lastPlan = plan;
    this.lastFunds = game.world.funds;
    this.lastConfirm = confirm;
    // The source's partners (counted once per source and world version).
    if (src) {
      const k = `${src.x},${src.y},${game.world.version}`;
      if (this.reachKey.split('#')[0] !== k) this.reachN = inReach(game.skybridgePartners());
      this.reachKey = `${k}#${quick}`;
    } else this.reachKey = `#${quick}`;
    const showRoutes = !!src && !flash;
    setHidden(this.routesBtn, !showRoutes);
    if (showRoutes) {
      setText(this.routesBtn, skybridgeView.showRoutes ? 'Hide routes' : 'Show routes');
      setAttr(this.routesBtn, 'aria-pressed', skybridgeView.showRoutes ? 'true' : 'false');
    }
    if (flash || (src && (!plan || plan.tiles.length === 0))) {
      // The skybridge tool between taps (§5.4): the payoff of the bridge just built, or the source's state.
      const meta = toolMeta('skybridge');
      const title = flash ? flash.title : 'Tap a partner';
      const costText = flash ? flash.cost : '';
      const note = flash ? flash.note : this.reachN > 0 ? `${this.reachN} in reach` : 'No partner in reach: try Show routes';
      const key = `sky|${title}|${costText}|${note}|${showRoutes}|${skybridgeView.showRoutes}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.el.dataset.tool = 'skybridge';
      this.el.style.setProperty('--accent', meta.color);
      setHtml(this.ico, icon(meta.icon));
      setText(this.name, title);
      setText(this.cost, costText);
      setHidden(this.cost, !costText);
      setText(this.note, note);
      setHidden(this.note, !note);
      setClass(this.el, 'is-bad', false);
      setClass(this.el, 'is-warn', false);
      setClass(this.el, 'is-refund', false);
      setClass(this.el, 'is-good', !!flash && flash.tone === 'good');
      setClass(this.el, 'is-confirm', false);
      setClass(this.el, 'is-source', showRoutes);
      setHidden(this.btns, true);
      setAttr(this.el, 'aria-hidden', showRoutes ? 'false' : 'true');
      setHidden(this.el, false);
      return;
    }
    if (!plan || plan.tiles.length === 0) {
      setHidden(this.el, true);
      this.lastKey = '';
      this.lastConfirm = false;
      return;
    }
    const meta = toolMeta(plan.tool);
    const label = pillLabel(game.world, plan);
    const refund = plan.valid && (plan.refund ?? 0) > 0 ? plan.refund! : 0;
    const costText = !plan.valid ? '' : refund > 0 ? `Refund ${credits(refund)}` : plan.cost > 0 ? `${MINUS}${credits(plan.cost)}` : 'Free';
    let note = !plan.valid ? (plan.reason && plan.reason !== 'Nothing to change' ? plan.reason : '') : (plan.note ?? '');
    // A power plant only feeds what it touches: flag a spot with no road, zone or building beside it.
    const fp = plan.footprint;
    const stranded =
      plan.valid && !note && !!fp && isBuildingTool(plan.tool) && BUILDINGS[plan.tool].powerSupply > 0 && !footprintTouchesGrid(game.world, fp.x, fp.y, fp.size);
    if (stranded) note = 'Not connected · touch a road or zone';
    const rowShown = confirm && !this.row.hidden;
    const key = `${plan.tool}|${label}|${costText}|${note}|${plan.valid}|${confirm}|${showRoutes}|${skybridgeView.showRoutes}|${rowShown}`;
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
    setClass(this.el, 'is-warn', plan.valid && !!note);
    setClass(this.el, 'is-refund', refund > 0);
    setClass(this.el, 'is-good', false);
    setClass(this.el, 'is-confirm', confirm);
    setClass(this.el, 'is-source', showRoutes);
    setClass(this.el, 'has-row', rowShown);
    setHidden(this.btns, !confirm);
    setAttr(this.el, 'aria-hidden', confirm || showRoutes ? 'false' : 'true');
    if (confirm) setAttr(this.okBtn, 'aria-label', `Build ${label}${costText ? `, ${costText}` : ''}`);
    setHidden(this.el, false);
  }

  /** Force the next update to re-render (the sponsor row changed). */
  invalidate(): void {
    this.lastKey = '';
    this.lastPlan = null;
  }
}

/**
 * The pill's name with its counts folded in (EXPANSION §7.5): "Street ×12", "Avenue ×6 · 6 widened",
 * "Street ×9 · 2 ramps", "Skyway ×8 · 1 ramp", "Demolish skyway ×6". The pill shows it uppercase.
 */
export function pillLabel(world: World, plan: ActionPlan): string {
  const tool = plan.tool;
  if (tool === 'bulldoze') {
    let n = 0;
    for (const p of plan.tiles) if (p.ok) n++;
    const name = plan.layer === 'sky' ? 'Demolish skyway' : 'Demolish';
    return n > 1 ? `${name} ×${n}` : name;
  }
  const name = toolMeta(tool).name;
  if (isBuildingTool(tool) || tool === 'skybridge') return name;
  const count = changedTiles(world, plan);
  let s = count > 1 ? `${name} ×${count}` : name;
  if (isRoadTool(tool) && (plan.upgrades ?? 0) > 0) s += ` · ${plan.upgrades} widened`;
  const ramps = plan.ramps ?? 0;
  if ((isRoadTool(tool) || tool === 'skyway') && ramps > 0) s += ` · ${ramps} ${ramps === 1 ? 'ramp' : 'ramps'}`;
  return s;
}

/**
 * Number of tiles the plan would actually change (plan.tiles also lists no-op tiles as ok): road
 * tools count by `plan.roadKinds` (new tiles and kind changes), skyways by new deck tiles.
 */
export function changedTiles(world: World, plan: ActionPlan): number {
  const w = world;
  let n = 0;
  if (isRoadTool(plan.tool)) {
    const kinds = plan.roadKinds;
    for (let k = 0; k < plan.tiles.length; k++) {
      const p = plan.tiles[k];
      if (!p.ok) continue;
      const t = w.tileAt(p.x, p.y);
      if (!t) continue;
      if (!t.road || (kinds && kinds[k] !== undefined && kinds[k] !== t.roadKind)) n++;
    }
  } else if (plan.tool === 'skyway') {
    for (const p of plan.tiles) if (p.ok && w.inBounds(p.x, p.y) && w.sky[w.idx(p.x, p.y)] === 0) n++;
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

/** Tray a building lives in, as the unlock news names it (sim/advisor.ts trayOf, EXPANSION §7.1). */
export function trayName(def: BuildingDef, pop: number): string {
  switch (def.category) {
    case 'power':
      return pop >= INFRA_POP ? 'Infra' : 'Power';
    case 'transport':
      return 'Infra';
    case 'services':
      return 'Civic';
    case 'faction':
      return 'Deals';
    default:
      return 'Sky';
  }
}

/** "Civic · Parks": the tray and its section chip (MEGACITY §7.7 item 6); the tray alone where it has no chips. */
export function traySpot(def: BuildingDef, pop: number): string {
  const tray = trayName(def, pop);
  for (const list of Object.values(SECTIONS)) for (const sec of list ?? []) if (sec.items.includes(def.type)) return `${tray} · ${sec.label}`;
  return tray;
}

/** "Seaport (Infra · Ports)", "Highway (Road)": what opens between two populations (gated buildings excluded). */
export function bannerUnlocks(prevPop: number, pop: number): string[] {
  const opens = (p: number) => p > prevPop && p <= pop;
  const out: string[] = [];
  for (const t of BUILDING_ORDER) {
    const def = BUILDINGS[t];
    if (def.gate || def.hidden) continue;
    if (opens(def.unlockPop)) out.push(`${def.name} (${traySpot(def, pop)})`);
  }
  for (const k of ROAD_KINDS) if (k.tool && opens(k.unlockPop)) out.push(`${k.name} (Road)`);
  if (opens(SKYWAY.unlockPop)) out.push('Skyway (Sky · Links)');
  return out;
}

type BannerEntry = { kind: 'milestone'; pop: number; title: string } | { kind: 'moment'; id: MomentId; title: string; sub: string };

export class MilestoneBanner {
  readonly el: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly unlocks: HTMLElement;
  private readonly queue: BannerEntry[] = [];
  private current: BannerEntry | null = null;
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
    this.kicker = h('span');
    this.title = h('div', { class: 'cc-banner-title' });
    this.sub = h('div', { class: 'cc-banner-sub' });
    this.unlocks = h('div', { class: 'cc-banner-unlocks' });
    const kick = h('div', { class: 'cc-banner-kicker' });
    kick.innerHTML = icon('star');
    kick.append(this.kicker);
    kick.insertAdjacentHTML('beforeend', icon('star'));
    this.el = h(
      'div',
      { class: 'cc-banner', hidden: true, role: 'alert' },
      kick,
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
    this.enqueue({ kind: 'milestone', pop: m.pop, title: m.title });
  }

  /** A once-per-city moment (EXPANSION §5.4): a port opening, the Spaceport finished, the first launch. */
  showMoment(m: { id: MomentId; title: string; sub: string }): void {
    this.enqueue({ kind: 'moment', id: m.id, title: m.title, sub: m.sub });
  }

  private enqueue(e: BannerEntry): void {
    this.queue.push(e);
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
    const title = m.title.toUpperCase();
    setText(this.title, title);
    this.title.dataset.text = title;
    if (m.kind === 'milestone') {
      const def = MILESTONES.find((x) => x.pop === m.pop);
      const idx = def ? MILESTONES.indexOf(def) : -1;
      const prevPop = idx > 0 ? MILESTONES[idx - 1].pop : 0;
      setText(this.kicker, 'Milestone reached');
      this.sub.innerHTML =
        `<span>${groupInt(m.pop)} residents</span>` +
        (def ? `<i class="cc-banner-dot">·</i><span>Board bonus <b>+${credits(def.grant)}</b></span>` : '');
      const unlocked = bannerUnlocks(prevPop, m.pop);
      setText(this.unlocks, unlocked.length ? `Now available: ${unlocked.join(', ')}` : '');
      setHidden(this.unlocks, unlocked.length === 0);
    } else {
      // Megacity moments ride the 'region' id (MomentId is frozen): the kicker names what happened.
      const kick =
        m.id === 'launch'
          ? 'Launch night'
          : m.title.startsWith('DISTRICT ANNEXED')
            ? 'New district'
            : m.title.startsWith('SKY LOBBY')
              ? 'Sky Lobby'
              : m.title === 'THE REGION IS WHOLE'
                ? 'Every district'
                : 'A city first';
      setText(this.kicker, kick);
      this.sub.textContent = '';
      this.sub.append(h('span', { text: m.sub }));
      setHidden(this.unlocks, true);
    }
    this.el.dataset.kind = m.kind;
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

  /** `resting`: districts resting this field cycle (MEGACITY §3.11: "· resting 16" for players who look). */
  update(dt: number, visible: boolean, resting = 0): void {
    setHidden(this.el, !visible);
    if (!visible || !(dt > 0)) return;
    this.frames++;
    this.acc += dt;
    if (dt > this.worst) this.worst = dt;
    if (this.acc >= 0.5) {
      const fps = Math.round(this.frames / this.acc);
      setText(this.el, `${fps} FPS · ${(this.worst * 1000).toFixed(0)}ms${resting > 0 ? ` · resting ${resting}` : ''}`);
      setClass(this.el, 'is-low', fps < 40);
      this.frames = 0;
      this.acc = 0;
      this.worst = 0;
    }
  }
}
