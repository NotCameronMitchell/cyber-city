// ─────────────────────────────────────────────────────────────────────────────
// Bottom dock (thumb zone): the category toolbar (a side rail on landscape
// phones), the item tray that opens above it, the active-tool chip with its
// one-time gesture hint, and the data-overlay legend.
// ─────────────────────────────────────────────────────────────────────────────

import { lockedReason } from '../game/actions';
import { BUILDINGS, isBuildingTool } from '../game/config';
import { storageGet, storageSet } from '../game/game';
import type { OverlayId, ToolId } from '../game/types';
import type { UIContext } from './context';
import { buzz, closestData, h, setAttr, setClass, setHidden, setHtml, setStyle, setText } from './dom';
import { abbr } from './format';
import { icon } from './icons';
import { CATEGORIES, OVERLAYS, SERVICE_SWATCHES, categoryOf, costLabel, overlayMeta, toolMeta, type CategoryId } from './tools';

const HINT_KEY = 'cybercity.ui.hint.v1';
const HINT_MS = 9000;

interface CardRefs {
  el: HTMLButtonElement;
  tool?: ToolId;
  overlay?: OverlayId;
  cost: HTMLElement;
  lock: HTMLElement;
  lockText: HTMLElement;
  lockFill: HTMLElement;
}

export class Dock {
  readonly el: HTMLElement;
  /** Column above the toolbar: coach card, legend and tool chip live here. */
  readonly stack: HTMLElement;
  /** In-flow slot for the inspect sheet on portrait phones. */
  readonly sheetSlot: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly catBtns = new Map<CategoryId, HTMLButtonElement>();
  private readonly tray: HTMLElement;
  private readonly trayTitle: HTMLElement;
  private readonly trayRow: HTMLElement;
  private cards: CardRefs[] = [];
  private openCat: CategoryId | null = null;

  private readonly chipRow: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly chipIco: HTMLElement;
  private readonly chipName: HTMLElement;
  private readonly chipCost: HTMLElement;
  private readonly hint: HTMLElement;
  private hintTimer = 0;
  private hintDone: boolean;

  private readonly legend: HTMLElement;
  private readonly legendIco: HTMLElement;
  private readonly legendName: HTMLElement;
  private readonly legendScale: HTMLElement;

  /** Called when the tray opens/closes so the coach can collapse. */
  onTrayChange: (() => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    // ── Toolbar ────────────────────────────────────────────────────────────
    this.bar = h('nav', { class: 'cc-bar', 'aria-label': 'Build tools' });
    for (const c of CATEGORIES) {
      const btn = h(
        'button',
        {
          class: 'cc-tb',
          type: 'button',
          'data-cat': c.id,
          'aria-label': c.label,
          title: c.label,
          'aria-pressed': c.tool ? 'false' : undefined,
          'aria-expanded': c.tool ? undefined : 'false',
        },
        h('span', { class: 'cc-tb-ico', html: icon(c.icon) }),
        h('span', { class: 'cc-tb-label' }, h('span', { class: 'is-long', text: c.label }), h('span', { class: 'is-short', text: c.short })),
        h('span', { class: 'cc-tb-dot' }),
      );
      setStyle(btn, '--accent', c.accent);
      this.catBtns.set(c.id, btn);
      this.bar.append(btn);
    }
    this.bar.addEventListener('click', this.onBarClick);

    // ── Tray ───────────────────────────────────────────────────────────────
    this.trayTitle = h('span', { class: 'cc-tray-title' });
    this.trayRow = h('div', { class: 'cc-tray-row', role: 'listbox' });
    this.tray = h(
      'div',
      { class: 'cc-tray cc-panel', hidden: true, role: 'dialog', 'aria-label': 'Build menu' },
      h(
        'div',
        { class: 'cc-tray-head' },
        this.trayTitle,
        h('button', { class: 'cc-iconbtn cc-tray-close', type: 'button', 'data-act': 'tray-close', 'aria-label': 'Close menu', html: icon('close') }),
      ),
      this.trayRow,
    );
    this.tray.addEventListener('click', this.onTrayClick);

    // ── Tool chip + hint ───────────────────────────────────────────────────
    this.chipIco = h('span', { class: 'cc-toolchip-ico' });
    this.chipName = h('span', { class: 'cc-toolchip-name' });
    this.chipCost = h('span', { class: 'cc-toolchip-cost' });
    this.chip = h(
      'div',
      { class: 'cc-toolchip cc-chipglass', hidden: true },
      this.chipIco,
      h('span', { class: 'cc-toolchip-text' }, this.chipName, this.chipCost),
      h('button', { class: 'cc-toolchip-x', type: 'button', 'data-act': 'tool-clear', 'aria-label': 'Stop building (back to Inspect)', html: icon('close') }),
    );
    this.chip.addEventListener('click', (e) => {
      if (closestData(e.target, 'act', this.chip)) ctx.game.setTool('inspect');
    });
    this.hint = h('div', { class: 'cc-hint', hidden: true, role: 'status' });
    this.hintDone = storageGet(HINT_KEY) === '1';
    this.chipRow = h('div', { class: 'cc-chiprow' }, this.chip, this.hint);

    // ── Legend ─────────────────────────────────────────────────────────────
    this.legendIco = h('span', { class: 'cc-legend-ico' });
    this.legendName = h('span', { class: 'cc-legend-name' });
    this.legendScale = h('span', { class: 'cc-legend-scale' });
    this.legend = h(
      'div',
      { class: 'cc-legend cc-chipglass', hidden: true, role: 'status' },
      this.legendIco,
      this.legendName,
      this.legendScale,
      h('button', { class: 'cc-legend-x', type: 'button', 'data-act': 'overlay-off', 'aria-label': 'Hide data view', html: icon('close') }),
    );
    this.legend.addEventListener('click', (e) => {
      if (closestData(e.target, 'act', this.legend)) ctx.game.setOverlay('none');
    });

    this.stack = h('div', { class: 'cc-dock-stack' }, this.legend, this.chipRow);
    this.sheetSlot = h('div', { class: 'cc-sheet-slot' });
    this.el = h('div', { class: 'cc-dock' }, this.stack, this.sheetSlot, this.tray, this.bar);

    this.syncTool();
    this.syncOverlay();
  }

  get trayOpen(): boolean {
    return this.openCat !== null;
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────

  private readonly onBarClick = (e: MouseEvent) => {
    const btn = closestData(e.target, 'cat', this.bar);
    if (!btn) return;
    const cat = CATEGORIES.find((c) => c.id === btn.dataset.cat);
    if (!cat) return;
    const game = this.ctx.game;
    buzz(6);
    if (cat.tool) {
      this.closeTray();
      // Tapping the active single tool again returns to Inspect.
      game.setTool(game.tool === cat.tool && cat.tool !== 'inspect' ? 'inspect' : cat.tool);
      if (cat.tool === 'inspect') game.select(null);
      return;
    }
    if (this.openCat === cat.id) this.closeTray();
    else this.openTray(cat.id);
  };

  openTray(id: CategoryId): void {
    const cat = CATEGORIES.find((c) => c.id === id);
    if (!cat || cat.tool) return;
    this.ctx.game.select(null); // the tray takes the inspect sheet's place
    this.openCat = id;
    setText(this.trayTitle, cat.id === 'data' ? 'Data views' : cat.label);
    setStyle(this.tray, '--accent', cat.accent);
    this.buildCards(cat.id);
    this.tray.hidden = false;
    this.tray.classList.remove('is-in');
    void this.tray.offsetWidth;
    this.tray.classList.add('is-in');
    this.trayRow.scrollLeft = 0;
    this.syncTool();
    this.refreshTray();
    this.onTrayChange?.();
  }

  closeTray(): void {
    if (!this.openCat) return;
    this.openCat = null;
    this.tray.hidden = true;
    this.syncTool();
    this.onTrayChange?.();
  }

  private buildCards(id: CategoryId): void {
    this.trayRow.textContent = '';
    this.cards = [];
    if (id === 'data') {
      for (const o of OVERLAYS) {
        const el = h(
          'button',
          { class: 'cc-card is-overlay', type: 'button', role: 'option', 'data-overlay': o.id, 'aria-label': `${o.name} view` },
          h('span', { class: 'cc-card-ico', html: icon(o.icon) }),
          h('span', { class: 'cc-card-name', text: o.name }),
          h('span', { class: 'cc-card-desc', text: o.desc }),
        );
        setStyle(el, '--accent', o.id === 'none' ? '#8d93b8' : '#22e5ff');
        this.trayRow.append(el);
        this.cards.push({ el, overlay: o.id, cost: el, lock: el, lockText: el, lockFill: el });
      }
      return;
    }
    const cat = CATEGORIES.find((c) => c.id === id)!;
    for (const tool of cat.items ?? []) {
      const m = toolMeta(tool);
      const cost = h('span', { class: 'cc-card-cost', text: costLabel(m) });
      const lockText = h('span', { class: 'cc-card-locktext' });
      const lockFill = h('i');
      const lock = h(
        'span',
        { class: 'cc-card-lock' },
        h('span', { class: 'cc-card-lockrow', html: icon('lock') }, lockText),
        h('span', { class: 'cc-card-progress' }, lockFill),
      );
      lockText.textContent = '';
      const def = isBuildingTool(tool) ? BUILDINGS[tool] : null;
      const meta: string[] = [];
      if (tool === 'res') meta.push('Housing');
      else if (tool === 'com') meta.push('Shops · jobs');
      else if (tool === 'ind') meta.push('Jobs · smog');
      if (def) {
        meta.push(`${def.size}×${def.size}`);
        if (def.powerSupply) meta.push(`${def.powerSupply} MW`);
        else if (def.radius) meta.push(`r${def.radius}`);
        if (def.residents) meta.push(`${abbr(def.residents)} homes`);
        else if (def.jobs >= 100) meta.push(`${abbr(def.jobs)} jobs`);
      }
      const el = h(
        'button',
        { class: 'cc-card', type: 'button', role: 'option', 'data-tool': tool, 'aria-label': `${m.name}, ${costLabel(m)}` },
        h('span', { class: 'cc-card-ico', html: icon(m.icon) + (m.badge ? `<b class="cc-card-badge">${m.badge}</b>` : '') }),
        h('span', { class: 'cc-card-name', text: m.name }),
        cost,
        h('span', { class: 'cc-card-desc', text: m.desc }),
        meta.length ? h('span', { class: 'cc-card-meta', text: meta.join(' · ') }) : null,
        lock,
      );
      setStyle(el, '--accent', m.color);
      this.trayRow.append(el);
      this.cards.push({ el, tool, cost, lock, lockText, lockFill });
    }
  }

  private readonly onTrayClick = (e: MouseEvent) => {
    const { game } = this.ctx;
    if (closestData(e.target, 'act', this.tray)?.dataset.act === 'tray-close') {
      this.closeTray();
      return;
    }
    const ov = closestData(e.target, 'overlay', this.tray);
    if (ov) {
      buzz(6);
      game.setOverlay(ov.dataset.overlay as OverlayId);
      this.closeTray();
      return;
    }
    const card = closestData(e.target, 'tool', this.tray);
    if (!card) return;
    const tool = card.dataset.tool as ToolId;
    const locked = lockedReason(game.world, tool);
    if (locked) {
      const m = toolMeta(tool);
      game.toast(`${m.name} unlocks at ${m.unlockPop.toLocaleString('en-US')} residents`, 'info');
      this.ctx.sfx('error');
      return;
    }
    buzz(8);
    game.setTool(tool);
    this.closeTray();
  };

  /** Locked / affordable states for the open tray (throttled by the UI root). */
  refreshTray(): void {
    if (!this.openCat) return;
    const { game } = this.ctx;
    const w = game.world;
    for (const c of this.cards) {
      if (c.overlay) {
        const on = game.overlay === c.overlay;
        setClass(c.el, 'is-on', on);
        setAttr(c.el, 'aria-selected', on ? 'true' : 'false');
        continue;
      }
      const tool = c.tool!;
      const m = toolMeta(tool);
      const locked = !!lockedReason(w, tool);
      setClass(c.el, 'is-locked', locked);
      setAttr(c.el, 'aria-disabled', locked ? 'true' : 'false');
      if (locked) {
        setText(c.lockText, `Reach ${abbr(m.unlockPop)} pop`);
        const p = Math.max(0, Math.min(1, w.maxPopulation / Math.max(1, m.unlockPop)));
        setStyle(c.lockFill, 'transform', `scaleX(${p.toFixed(3)})`);
      }
      setClass(c.el, 'is-poor', !locked && w.funds < m.cost);
      const on = game.tool === tool;
      setClass(c.el, 'is-on', on);
      setAttr(c.el, 'aria-selected', on ? 'true' : 'false');
    }
  }

  // ── Tool / overlay state ─────────────────────────────────────────────────

  /** Highlight the active category, show the tool chip (+ one-time hint). */
  syncTool(): void {
    const { game } = this.ctx;
    const tool = game.tool;
    const activeCat = categoryOf(tool);
    const m = toolMeta(tool);
    for (const c of CATEGORIES) {
      const btn = this.catBtns.get(c.id)!;
      const on = c.id === 'data' ? false : c.id === activeCat;
      setClass(btn, 'is-on', on);
      setClass(btn, 'is-open', this.openCat === c.id);
      if (c.tool) setAttr(btn, 'aria-pressed', on ? 'true' : 'false');
      else setAttr(btn, 'aria-expanded', this.openCat === c.id ? 'true' : 'false');
      // Multi-item categories adopt the chosen item's colour while active.
      if (c.items) setStyle(btn, '--accent', on ? m.color : c.accent);
    }
    const building = tool !== 'inspect';
    setHidden(this.chip, !building || this.trayOpen);
    if (building) {
      setStyle(this.chip, '--accent', m.color);
      setHtml(this.chipIco, icon(m.icon));
      setText(this.chipName, m.name);
      setText(this.chipCost, costLabel(m));
      if (!this.hintDone && !this.trayOpen) this.showHint(tool);
    } else this.hideHint(false);
    if (this.trayOpen) this.hint.hidden = true;
  }

  syncOverlay(): void {
    const { game } = this.ctx;
    const o = overlayMeta(game.overlay);
    const on = game.overlay !== 'none';
    setClass(this.catBtns.get('data')!, 'is-on', on);
    setHidden(this.legend, !on);
    if (on) {
      setHtml(this.legendIco, icon(o.icon));
      setText(this.legendName, o.name);
      let scale = '';
      if (o.legend === 'heat') {
        scale = `<span class="cc-lg-lo">${o.low}</span><span class="cc-lg-heat"></span><span class="cc-lg-hi">${o.high}</span>`;
      } else if (o.legend === 'power') {
        scale =
          '<span class="cc-lg-sw" style="--sw:#4dff9a">Plant</span><span class="cc-lg-sw" style="--sw:#22e5ff">Powered</span><span class="cc-lg-sw" style="--sw:#ff3b5c">No power</span>';
      } else if (o.legend === 'services') {
        scale = SERVICE_SWATCHES.map((s) => `<span class="cc-lg-sw" style="--sw:${s.color}">${s.label}</span>`).join('');
      }
      setHtml(this.legendScale, scale);
      setClass(this.legend, 'is-swatches', o.legend !== 'heat');
    }
    this.refreshTray();
  }

  // ── Gesture hint ─────────────────────────────────────────────────────────

  private showHint(tool: ToolId): void {
    const verb = tool === 'bulldoze' ? 'Drag to demolish' : isBuildingTool(tool) ? 'Drag to place' : 'Drag to build';
    setText(this.hint, `${verb} · two fingers to move the map`);
    if (this.hint.hidden) {
      this.hint.hidden = false;
      this.hint.classList.remove('is-in');
      void this.hint.offsetWidth;
      this.hint.classList.add('is-in');
    }
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(true), HINT_MS);
  }

  /** Hide the hint; `learned` = the player has seen it long enough / built something. */
  hideHint(learned: boolean): void {
    window.clearTimeout(this.hintTimer);
    if (!this.hint.hidden) this.hint.hidden = true;
    if (learned && !this.hintDone) {
      this.hintDone = true;
      storageSet(HINT_KEY, '1');
    }
  }

  /** Player completed a build action: the hint has done its job. */
  noteBuilt(): void {
    if (!this.hint.hidden) this.hideHint(true);
  }
}
