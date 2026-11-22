// ─────────────────────────────────────────────────────────────────────────────
// Inspect sheet: opens on 'select' with game.getTileInfo(x, y). A bottom sheet
// on phones (in the dock flow, above the toolbar), a side card on wide and
// landscape screens. Percent rows get a tiny meter coloured by whether high is
// good or bad; service buildings get an in-page "Demolish" confirm.
// When the sheet would hide the selected tile, the camera eases it into view.
// ─────────────────────────────────────────────────────────────────────────────

import { planAction } from '../game/actions';
import { BUILDINGS } from '../game/config';
import type { Selection } from '../game/types';
import type { UIContext } from './context';
import { h, prefersReducedMotion, replayClass, setClass, setHidden, setHtml, setStyle, setText } from './dom';
import { credits } from './format';
import { icon } from './icons';

/** Rows whose percentage is better when high (others: lower is better). */
const HIGH_IS_GOOD = new Set(['Land value']);
const BAD_VALUES = /^(NO POWER|ABANDONED|NO ROAD|OFFLINE)|^Offline/;
const GOOD_VALUES = /^(Online|Yes)$/;
const CONFIRM_MS = 4500;

interface RowRefs {
  el: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  meter: HTMLElement;
  fill: HTMLElement;
}

export class InspectSheet {
  readonly el: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly coords: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly rows: RowRefs[] = [];
  private readonly actionsEl: HTMLElement;
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

    this.demolishBtn = h('button', { class: 'cc-btn is-danger-ghost', type: 'button', 'data-act': 'demolish' });
    this.confirmBtn = h('button', { class: 'cc-btn is-danger', type: 'button', 'data-act': 'demolish-yes', hidden: true });
    this.cancelBtn = h('button', { class: 'cc-btn is-ghost', type: 'button', 'data-act': 'demolish-no', hidden: true, text: 'Keep' });
    this.actionsEl = h('div', { class: 'cc-insp-actions', hidden: true }, this.demolishBtn, this.cancelBtn, this.confirmBtn);

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
      this.sub,
      this.rowsEl,
      this.actionsEl,
    );
    this.el.addEventListener('click', this.onClick);
  }

  get isOpen(): boolean {
    return this.sel !== null;
  }

  /** 'select' event. */
  onSelect(sel: Selection | null): void {
    const was = this.sel;
    this.sel = sel ? { x: sel.x, y: sel.y } : null;
    this.resetConfirm();
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
    const info = game.getTileInfo(sel.x, sel.y);
    if (!info) {
      game.select(null);
      return;
    }
    const tile = game.world.tileAt(sel.x, sel.y)!;
    const building = tile.buildingId >= 0 ? game.world.buildings.get(tile.buildingId) ?? null : null;

    setStyle(this.el, '--accent', info.color);
    setText(this.title, info.title);
    setText(this.sub, info.subtitle);
    setText(this.coords, `X${String(sel.x).padStart(2, '0')} · Y${String(sel.y).padStart(2, '0')}`);
    const kind = building
      ? BUILDINGS[building.type].category === 'power'
        ? 'Utility'
        : BUILDINGS[building.type].category === 'landmarks'
          ? 'Landmark'
          : 'Service'
      : tile.road
        ? 'Transport'
        : tile.zone
          ? 'Zone'
          : 'Terrain';
    setText(this.kind, kind);

    // Rows: reuse elements, add/remove only when the count changes.
    while (this.rows.length < info.rows.length) {
      const label = h('dt');
      const value = h('span', { class: 'cc-insp-v' });
      const fill = h('i');
      const meter = h('span', { class: 'cc-meter', hidden: true }, fill);
      const el = h('div', { class: 'cc-insp-row' }, label, h('dd', null, meter, value));
      this.rowsEl.append(el);
      this.rows.push({ el, label, value, meter, fill });
    }
    while (this.rows.length > info.rows.length) this.rows.pop()!.el.remove();
    for (let i = 0; i < info.rows.length; i++) {
      const [label, value] = info.rows[i];
      const r = this.rows[i];
      setText(r.label, label);
      setText(r.value, value);
      const m = /^(\d+)%$/.exec(value);
      let tone = '';
      if (m) {
        const v = Number(m[1]) / 100;
        const good = HIGH_IS_GOOD.has(label) ? v : 1 - v;
        tone = good > 0.62 ? 'good' : good < 0.35 ? 'bad' : 'mid';
        setHidden(r.meter, false);
        setStyle(r.fill, 'transform', `scaleX(${v.toFixed(3)})`);
      } else {
        setHidden(r.meter, true);
        tone = BAD_VALUES.test(value) ? 'bad' : GOOD_VALUES.test(value) ? 'good' : '';
      }
      r.el.dataset.tone = tone;
    }

    // Demolish (service buildings only).
    const canDemolish = !!building;
    setHidden(this.actionsEl, !canDemolish);
    if (canDemolish) {
      const plan = planAction(game.world, 'bulldoze', sel, sel);
      const cost = credits(plan.cost);
      setHtml(this.demolishBtn, `${icon('trash')}<span>Demolish</span><span class="cc-btn-cost">${cost}</span>`);
      setHtml(this.confirmBtn, `${icon('warn')}<span>Confirm · ${cost}</span>`);
      setClass(this.confirmBtn, 'is-poor', plan.cost > game.world.funds);
    }
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
