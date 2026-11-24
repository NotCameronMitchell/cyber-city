// ─────────────────────────────────────────────────────────────────────────────
// Inspect sheet: opens on 'select' with game.getTileInfo(x, y). A bottom sheet
// on phones (in the dock flow, above the toolbar), a side card on wide and
// landscape screens. Percent rows get a tiny meter coloured by whether high is
// good or bad; service buildings get an in-page "Demolish" confirm.
// When the sheet would hide the selected tile, the camera eases it into view.
// ─────────────────────────────────────────────────────────────────────────────

import { planAction } from '../game/actions';
import { BUILDINGS, WEALTH } from '../game/config';
import type { TileInfo } from '../game/game';
import type { Selection } from '../game/types';
import type { UIContext } from './context';
import { h, prefersReducedMotion, replayClass, setClass, setHidden, setHtml, setStyle, setText } from './dom';
import { credits } from './format';
import { icon } from './icons';
import { InspectStory } from './story/inspectStory';

/** Rows whose percentage is better when high (others: lower is better). */
export const HIGH_IS_GOOD = new Set(['Land value', 'Education', 'Wealth']);
/** Progress rows (the Spaceport's "Building 62%"): a neutral meter, never red at the start. */
const PROGRESS_ROWS = new Set(['Building']);
/** Header kind label per building category (EXPANSION §7.4 adds Transport for the ports). */
const KIND_LABEL: Record<string, string> = { power: 'Utility', landmarks: 'Landmark', vertical: 'Megastructure', faction: 'Faction', transport: 'Transport' };
const BAD_VALUES = /^(NO POWER|ABANDONED|NO ROAD|OFFLINE)|^Offline/;
const GOOD_VALUES = /^(Online|Yes)$/;
const CONFIRM_MS = 4500;

interface RowRefs {
  el: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  meter: HTMLElement;
  fill: HTMLElement;
  /** Tick marks on a ticked meter (the Wealth row's WEALTH.up thresholds). */
  ticks: HTMLElement[];
  /** label|value last laid out (the wide check re-runs only when it changes). */
  key: string;
}

export class InspectSheet {
  readonly el: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly coords: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly rows: RowRefs[] = [];
  /** Full-width, wrapping note rows under the stat grid (TileInfo.notes, §7.4). */
  private readonly notesEl: HTMLElement;
  private notesKey = '';
  private readonly actionsEl: HTMLElement;
  private readonly story: InspectStory;
  private readonly scroll: HTMLElement;
  private readonly demolishBtn: HTMLButtonElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private sel: Selection | null = null;
  private confirming = false;
  private confirmTimer = 0;
  /** Remaining camera nudge in screen px. */
  private nudgeX = 0;
  private nudgeY = 0;

  constructor(private readonly ctx: UIContext) {
    this.kind = h('span', { class: 'cc-insp-kind' });
    this.coords = h('span', { class: 'cc-insp-coords' });
    this.title = h('h3', { class: 'cc-insp-title', id: 'cc-insp-title' });
    this.sub = h('p', { class: 'cc-insp-sub' });
    this.rowsEl = h('dl', { class: 'cc-insp-rows' });
    this.notesEl = h('ul', { class: 'cc-insp-notes', hidden: true });

    this.demolishBtn = h('button', { class: 'cc-btn is-danger-ghost', type: 'button', 'data-act': 'demolish' });
    this.confirmBtn = h('button', { class: 'cc-btn is-danger', type: 'button', 'data-act': 'demolish-yes', hidden: true });
    this.cancelBtn = h('button', { class: 'cc-btn is-ghost', type: 'button', 'data-act': 'demolish-no', hidden: true, text: 'Keep' });
    this.actionsEl = h('div', { class: 'cc-insp-actions', hidden: true }, this.demolishBtn, this.cancelBtn, this.confirmBtn);
    this.story = new InspectStory(ctx);

    this.el = h(
      'section',
      { class: 'cc-sheet cc-panel', hidden: true, role: 'dialog', 'aria-labelledby': 'cc-insp-title' },
      h('span', { class: 'cc-insp-stripe' }),
      h(
        'header',
        { class: 'cc-insp-head' },
        h('div', { class: 'cc-insp-meta' }, this.kind, this.coords),
        h('button', { class: 'cc-iconbtn cc-insp-close', type: 'button', 'data-act': 'close', 'aria-label': 'Close inspector', html: icon('close') }),
      ),
      this.title,
      // Only the body scrolls, so the chamfered frame, stripe and header stay put
      // (a scrolling panel dragged its ::before frame along and hid the last row).
      (this.scroll = h('div', { class: 'cc-insp-scroll' }, this.sub, this.rowsEl, this.notesEl, this.story.el, this.actionsEl)),
    );
    this.el.addEventListener('click', this.onClick);
    // Crown picker: grow the sheet, drop the stat rows, start at the picker head.
    this.story.onMode = (m) => {
      setClass(this.el, 'is-picking', m === 'crowns');
      if (m === 'crowns') this.scroll.scrollTop = 0;
    };
  }

  get isOpen(): boolean {
    return this.sel !== null;
  }

  /** 'select' event. */
  onSelect(sel: Selection | null): void {
    const was = this.sel;
    // A tap on a skyway deck selects the deck, not the ground (Selection.sky, EXPANSION §3.7).
    this.sel = sel ? (sel.sky ? { x: sel.x, y: sel.y, sky: true } : { x: sel.x, y: sel.y }) : null;
    this.resetConfirm();
    this.story.select(this.sel);
    if (!sel) {
      this.el.hidden = true;
      this.nudgeX = this.nudgeY = 0;
      return;
    }
    this.ctx.actions.closeTray();
    this.el.hidden = false;
    this.refresh();
    if (!was) replayClass(this.el, 'is-in');
    else replayClass(this.el, 'is-swap');
    this.planNudge();
  }

  /** Re-read tile info (on 'stats', throttled by the root). */
  refresh(): void {
    const sel = this.sel;
    if (!sel) return;
    const { game } = this.ctx;
    const sky = !!sel.sky && game.world.sky[game.world.idx(sel.x, sel.y)] !== 0;
    const info = game.getTileInfo(sel.x, sel.y, sky);
    if (!info) {
      game.select(null);
      return;
    }
    const tile = game.world.tileAt(sel.x, sel.y)!;
    // The skyway sheet is about the deck: the building under it is not on this sheet.
    const building = !sky && tile.buildingId >= 0 ? game.world.buildings.get(tile.buildingId) ?? null : null;

    setStyle(this.el, '--accent', info.color);
    setText(this.title, info.title);
    setText(this.sub, info.subtitle);
    setText(this.coords, `X${String(sel.x).padStart(2, '0')} · Y${String(sel.y).padStart(2, '0')}`);
    const cat = building ? BUILDINGS[building.type].category : null;
    const kind = building ? KIND_LABEL[cat!] ?? 'Service' : sky || tile.road ? 'Transport' : tile.zone ? 'Zone' : 'Terrain';
    setText(this.kind, kind);

    // Rows: reuse elements, add/remove only when the count changes.
    while (this.rows.length < info.rows.length) {
      const label = h('dt');
      const value = h('span', { class: 'cc-insp-v' });
      const fill = h('i');
      const meter = h('span', { class: 'cc-meter', hidden: true }, fill);
      const el = h('div', { class: 'cc-insp-row' }, label, h('dd', null, meter, value));
      this.rowsEl.append(el);
      this.rows.push({ el, label, value, meter, fill, ticks: [], key: '' });
    }
    while (this.rows.length > info.rows.length) this.rows.pop()!.el.remove();
    // Empty lots: say whether power reaches them (getTileInfo leaves it as '—' until a lot develops),
    // so a stranded plant is visible from the first tap.
    const lot = !!tile.zone && tile.level === 0 && !tile.abandoned;
    const meterRow = info.meter?.row ?? -1;
    for (let i = 0; i < info.rows.length; i++) {
      const label = info.rows[i][0];
      let value = info.rows[i][1];
      if (lot && label === 'Power' && value === '—') value = tile.powered ? 'Online' : 'NO POWER';
      const r = this.rows[i];
      setText(r.label, label);
      setText(r.value, value);
      // The ticked meter (the Wealth row, "$$ ▲ 52%") reads the trailing percent; plain rows a bare one.
      const ticked = i === meterRow;
      const m = ticked ? /(\d+)%$/.exec(value) : /^(\d+)%$/.exec(value);
      let tone = '';
      if (m) {
        const v = Number(m[1]) / 100;
        setHidden(r.meter, false);
        setStyle(r.fill, 'transform', `scaleX(${Math.min(1, v).toFixed(3)})`);
        if (ticked) {
          // Fill in the block's tier colour; ticks at the step-up thresholds (EXPANSION §4.5).
          const tier = value.startsWith('$$$') ? 2 : value.startsWith('$$') ? 1 : 0;
          setStyle(r.fill, 'background', WEALTH.colors[tier]);
          this.setTicks(r, info.meter!.ticks);
          tone = value.includes('▼') ? 'bad' : value.includes('▲') ? 'good' : '';
        } else {
          setStyle(r.fill, 'background', PROGRESS_ROWS.has(label) ? 'var(--accent)' : '');
          if (r.ticks.length) this.setTicks(r, []);
          const good = HIGH_IS_GOOD.has(label) ? v : 1 - v;
          tone = PROGRESS_ROWS.has(label) ? '' : good > 0.62 ? 'good' : good < 0.35 ? 'bad' : 'mid';
        }
      } else {
        setHidden(r.meter, true);
        if (r.ticks.length) this.setTicks(r, []);
        tone = BAD_VALUES.test(value) ? 'bad' : GOOD_VALUES.test(value) ? 'good' : '';
      }
      setClass(r.meter, 'is-ticked', ticked && !!m);
      r.el.dataset.tone = tone;
      // A row whose value does not fit its half of the grid spans both columns (≤ 12 chars fit at 390 px).
      const key = `${label}|${value}|${ticked}`;
      if (key !== r.key) {
        r.key = key;
        setClass(r.el, 'is-wide', ticked);
        if (!ticked && r.el.clientWidth > 0 && r.el.scrollWidth > r.el.clientWidth + 1) setClass(r.el, 'is-wide', true);
      }
    }
    this.renderNotes(info.notes);

    this.story.refresh();

    // Demolish (buildings only; the skyway sheet has its own "Demolish segment" action).
    const canDemolish = !!building;
    setHidden(this.actionsEl, !canDemolish);
    if (canDemolish) {
      const plan = planAction(game.world, 'bulldoze', sel, sel);
      // Placed under SAFETY.refundSec ago: bulldozing it now refunds it in full (EXPANSION §7.7).
      const refund = game.refundLeft(building!.id) > 0;
      const cost = refund ? 'Full refund' : credits(plan.cost);
      setHtml(this.demolishBtn, `${icon('trash')}<span>Demolish</span><span class="cc-btn-cost${refund ? ' is-refund' : ''}">${cost}</span>`);
      setHtml(this.confirmBtn, `${icon('warn')}<span>Confirm · ${cost}</span>`);
      setClass(this.confirmBtn, 'is-poor', !refund && plan.cost > game.world.funds);
    }
  }

  /** Tick marks on a row's meter at fractions `ticks` (0..1). */
  private setTicks(r: RowRefs, ticks: readonly number[]): void {
    while (r.ticks.length < ticks.length) {
      const t = h('b', { class: 'cc-meter-tick' });
      r.meter.append(t);
      r.ticks.push(t);
    }
    while (r.ticks.length > ticks.length) r.ticks.pop()!.remove();
    for (let k = 0; k < ticks.length; k++) setStyle(r.ticks[k], 'left', `${(Math.max(0, Math.min(1, ticks[k])) * 100).toFixed(1)}%`);
  }

  /** Note rows: full width, wrapping, 12 px, an optional tone (diffed). */
  private renderNotes(notes: TileInfo['notes']): void {
    const list = notes ?? [];
    const key = list.map((n) => `${n.tone ?? ''}:${n.text}`).join('\n');
    if (key === this.notesKey) return;
    this.notesKey = key;
    this.notesEl.textContent = '';
    for (const n of list) {
      const li = h('li', { class: 'cc-insp-note', text: n.text });
      if (n.tone) li.dataset.tone = n.tone;
      this.notesEl.append(li);
    }
    setHidden(this.notesEl, list.length === 0);
  }

  private readonly onClick = (e: MouseEvent) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    const { game } = this.ctx;
    if (act === 'close') {
      game.select(null);
    } else if (act === 'demolish') {
      this.confirming = true;
      this.demolishBtn.hidden = true;
      this.confirmBtn.hidden = false;
      this.cancelBtn.hidden = false;
      window.clearTimeout(this.confirmTimer);
      this.confirmTimer = window.setTimeout(() => this.resetConfirm(), CONFIRM_MS);
      try {
        this.confirmBtn.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    } else if (act === 'demolish-no') {
      this.resetConfirm();
    } else if (act === 'demolish-yes') {
      const sel = this.sel;
      this.resetConfirm();
      if (!sel) return;
      // Route through the normal tool path so costs, sfx, toasts and the sim recompute all apply.
      game.setTool('bulldoze');
      game.apply(sel, sel);
      game.setTool('inspect');
    }
  };

  private resetConfirm(): void {
    window.clearTimeout(this.confirmTimer);
    if (!this.confirming) return;
    this.confirming = false;
    this.demolishBtn.hidden = false;
    this.confirmBtn.hidden = true;
    this.cancelBtn.hidden = true;
  }

  // ── Keep the selected tile visible ───────────────────────────────────────

  private planNudge(): void {
    const sel = this.sel;
    if (!sel) return;
    const cam = this.ctx.camera;
    const p = cam.tileToScreen(sel.x, sel.y);
    const r = this.el.getBoundingClientRect(); // one layout read per selection
    if (r.width === 0) return;
    const margin = 48;
    let dx = 0;
    let dy = 0;
    const sideCard = r.width < cam.width * 0.55;
    if (sideCard) {
      // Side card on the right: keep the tile left of it.
      if (p.x > r.left - margin) dx = r.left - margin - p.x;
    } else if (p.y > r.top - margin) {
      // Bottom sheet: lift the tile above it.
      dy = r.top - margin - p.y;
    }
    // Never push the tile off the top/left of the screen.
    if (p.y + dy < 140) dy = Math.min(0, 140 - p.y);
    if (p.x + dx < 60) dx = Math.min(0, 60 - p.x);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    if (prefersReducedMotion()) {
      cam.panBy(dx, dy);
      return;
    }
    this.nudgeX = dx;
    this.nudgeY = dy;
  }

  /** User grabbed the map: stop steering the camera. */
  cancelNudge(): void {
    this.nudgeX = this.nudgeY = 0;
  }

  update(dt: number): void {
    if (this.nudgeX === 0 && this.nudgeY === 0) return;
    const k = 1 - Math.exp(-dt * 11);
    let sx = this.nudgeX * k;
    let sy = this.nudgeY * k;
    if (Math.abs(this.nudgeX - sx) < 0.5 && Math.abs(this.nudgeY - sy) < 0.5) {
      sx = this.nudgeX;
      sy = this.nudgeY;
    }
    this.ctx.camera.panBy(sx, sy);
    this.nudgeX -= sx;
    this.nudgeY -= sy;
    if (Math.abs(this.nudgeX) < 0.5 && Math.abs(this.nudgeY) < 0.5) this.nudgeX = this.nudgeY = 0;
  }
}
