// ─────────────────────────────────────────────────────────────────────────────
// Bottom dock (thumb zone): the category toolbar (a side rail on landscape
// phones), the item tray that opens above it, the active-tool chip with its
// one-time gesture hint, and the data-overlay legend.
// ─────────────────────────────────────────────────────────────────────────────

import { isUnlocked, lockedReason } from '../game/actions';
import { BUILDINGS, isBuildingTool } from '../game/config';
import { storageGet, storageSet } from '../game/game';
import { shoreSites } from '../game/ports';
import { isRoadTool, type RoadTool } from '../game/roads';
import type { OverlayId, ToolId } from '../game/types';
import type { UIContext } from './context';
import { buzz, closestData, h, setAttr, setClass, setHidden, setHtml, setStyle, setText } from './dom';
import { abbr } from './format';
import { icon } from './icons';
import { factionSigil } from './story/sigils';
import {
  CATEGORIES,
  OVERLAYS,
  SERVICE_SWATCHES,
  TIER_PIP_DOWN,
  TIER_PIP_UP,
  TIER_SWATCHES,
  categoryChrome,
  categoryOf,
  costLabel,
  isHybrid,
  livePrice,
  overlayMeta,
  roadButton,
  toolMeta,
  type CategoryId,
} from './tools';

const HINT_KEY = 'cybercity.ui.hint.v1';
/** Tool ids whose tray card the player has seen (the toolbar "new" dots, EXPANSION §7.1). Per device. */
export const NEWDOT_KEY = 'cybercity.ui.newdot.v1';
/**
 * Tools this update adds. A device with no "seen" list yet counts every other unlocked tool as
 * seen, so an existing city shows dots exactly where the new tools are.
 */
const NEW_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['alley', 'avenue', 'highway', 'skyway', 'academy', 'seaport', 'airport', 'spaceport']);
/** "No straight shore here" (EXPANSION §5.1): the Seaport card on a map without a valid site. */
export const NO_SHORE = 'No straight shore here';

function replayShake(el: HTMLElement): void {
  el.classList.remove('is-shake');
  void el.offsetWidth;
  el.classList.add('is-shake');
}
const HINT_MS = 9000;

interface CatRefs {
  btn: HTMLButtonElement;
  ico: HTMLElement;
  long: HTMLElement;
  short: HTMLElement;
  dot: HTMLElement;
  /** Current chrome key (label|icon), for the Infra relabel diff. */
  chrome: string;
}

interface CardRefs {
  el: HTMLButtonElement;
  tool?: ToolId;
  overlay?: OverlayId;
  cost: HTMLElement;
  /** Last price shown (live, with story modifiers). */
  price?: number;
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
  /** Slot for the story rail, directly above the toolbar (docs/STORY.md §8.1). */
  readonly railSlot: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly catBtns = new Map<CategoryId, HTMLButtonElement>();
  private readonly catRefs = new Map<CategoryId, CatRefs>();
  /** The session's last road tool (memory only: a new session never starts on a highway, §7.2). */
  private lastRoad: RoadTool = 'road';
  /** Tool ids whose card was on screen in an open tray (NEWDOT_KEY). */
  private readonly seen: Set<ToolId>;
  /** Valid Seaport sites on the current map, counted when the Infra tray opens (-1 = not counted). */
  private shoreCount = -1;
  private shoreMarks: Uint8Array | null = null;
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
  /** First-use tips (ui/tips.ts) render here, in the gesture-hint slot (EXPANSION §7.6). */
  readonly tipSlot: HTMLElement;
  private hintTimer = 0;
  private hintDone: boolean;
  private coachShowing = false;

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
      const ico = h('span', { class: 'cc-tb-ico', html: icon(c.icon) });
      const long = h('span', { class: 'is-long', text: c.label });
      const short = h('span', { class: 'is-short', text: c.short });
      const dot = h('span', { class: 'cc-tb-dot', 'aria-hidden': 'true' });
      const btn = h(
        'button',
        {
          class: 'cc-tb',
          type: 'button',
          'data-cat': c.id,
          'aria-label': c.label,
          title: c.key ? `${c.label} (${c.key})` : c.label,
          // A hybrid (Road) is both a tool toggle and a tray opener (§7.2).
          'aria-pressed': c.tool ? 'false' : undefined,
          'aria-expanded': c.items || !c.tool ? 'false' : undefined,
          hidden: c.story ? true : undefined,
        },
        ico,
        h('span', { class: 'cc-tb-label' }, long, short),
        dot,
      );
      setStyle(btn, '--accent', c.accent);
      this.catBtns.set(c.id, btn);
      this.catRefs.set(c.id, { btn, ico, long, short, dot, chrome: `${c.label}|${c.icon}` });
      this.bar.append(btn);
    }
    this.seen = this.loadSeen();
    this.bar.addEventListener('click', this.onBarClick);

    // ── Tray ───────────────────────────────────────────────────────────────
    this.trayTitle = h('span', { class: 'cc-tray-title' });
    this.trayRow = h('div', { class: 'cc-tray-row', role: 'listbox' });
    // Trays that can scroll fade at the right edge so later cards are discoverable (§7.2).
    this.trayRow.addEventListener('scroll', () => this.syncFade(), { passive: true });
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
    this.tipSlot = h('div', { class: 'cc-tipslot' });
    this.chipRow = h('div', { class: 'cc-chiprow' }, this.chip, this.hint, this.tipSlot);

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
    this.railSlot = h('div', { class: 'cc-rail-slot' });
    this.el = h('div', { class: 'cc-dock' }, this.stack, this.sheetSlot, this.tray, this.railSlot, this.bar);

    this.syncTool();
    this.syncOverlay();
  }

  get trayOpen(): boolean {
    return this.openCat !== null;
  }

  /** The one-time gesture hint is on screen (it goes before any first-use tip, §7.6). */
  get hintShowing(): boolean {
    return !this.hint.hidden;
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────

  private readonly onBarClick = (e: MouseEvent) => {
    const btn = closestData(e.target, 'cat', this.bar);
    if (!btn) return;
    const cat = CATEGORIES.find((c) => c.id === btn.dataset.cat);
    if (!cat) return;
    const game = this.ctx.game;
    buzz(6);
    if (isHybrid(cat)) {
      // Road (§7.2): one tap lays a street; the tray holds the other kinds.
      const r = roadButton(game.tool, this.openCat === cat.id, this.lastRoad, (t) => !lockedReason(game.world, t));
      if (r.tool) game.setTool(r.tool);
      if (r.tray === 'open') this.openTray(cat.id);
      else if (r.tray === 'close') this.closeTray();
      else if (this.openCat && this.openCat !== cat.id) this.closeTray();
      return;
    }
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
    if (!cat || (cat.tool && !cat.items)) return;
    this.ctx.game.select(null); // the tray takes the inspect sheet's place
    this.openCat = id;
    setText(this.trayTitle, cat.id === 'data' ? 'Data views' : categoryChrome(cat, this.ctx.game.world.maxPopulation).label);
    setStyle(this.tray, '--accent', cat.accent);
    this.tray.dataset.cat = id;
    this.buildCards(cat.id);
    this.tray.hidden = false;
    this.tray.classList.remove('is-in');
    void this.tray.offsetWidth;
    this.tray.classList.add('is-in');
    this.trayRow.scrollLeft = 0;
    setClass(this.el, 'has-tray', true);
    this.syncTool();
    this.refreshTray();
    this.syncFade();
    this.syncCategories();
    this.onTrayChange?.();
  }

  /** Right-edge fade while a tray of 4+ cards can still scroll (one layout read per scroll). */
  private syncFade(): void {
    const r = this.trayRow;
    const more = this.cards.length >= 4 && r.scrollLeft + r.clientWidth < r.scrollWidth - 4;
    setClass(r, 'is-more', more);
  }

  closeTray(): void {
    if (!this.openCat) return;
    this.openCat = null;
    this.tray.hidden = true;
    setClass(this.el, 'has-tray', false);
    this.syncTool();
    this.onTrayChange?.();
  }

  private buildCards(id: CategoryId): void {
    this.trayRow.textContent = '';
    this.cards = [];
    if (id === 'data') {
      for (const o of OVERLAYS) {
        if (o.id === 'turf' && !this.turfUnlocked()) continue;
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
    if (cat.items?.includes('seaport')) {
      // Counted once per open (< 1 ms): a map with no straight shore says so on the card (§5.1).
      const w = this.ctx.game.world;
      if (!this.shoreMarks || this.shoreMarks.length !== w.size * w.size) this.shoreMarks = new Uint8Array(w.size * w.size);
      this.shoreCount = shoreSites(w, this.shoreMarks);
    }
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
      // A card's own meta line carries its key rule on phones (§7.2); the generic size · jobs line is the fallback.
      if (m.meta) meta.push(m.meta);
      else if (def) {
        meta.push(`${def.size}×${def.size}`);
        if (def.powerSupply) meta.push(`${def.powerSupply} MW`);
        else if (def.radius) meta.push(`r${def.radius}`);
        if (def.residents) meta.push(`${abbr(def.residents)} homes`);
        else if (def.jobs >= 100) meta.push(`${abbr(def.jobs)} jobs`);
      }
      const el = h(
        'button',
        { class: 'cc-card', type: 'button', role: 'option', 'data-tool': tool, 'aria-label': `${m.name}, ${costLabel(m)}${m.meta ? `, ${m.meta}` : ''}` },
        h('span', {
          class: 'cc-card-ico',
          html: icon(m.icon) + (m.badge ? `<b class="cc-card-badge">${m.badge}</b>` : '') + (m.faction ? factionSigil(m.faction, 18, 'cc-card-sig') : ''),
        }),
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
      game.toast(`${m.name}: ${locked.replace(/^Locked:\s*/, '')}`, 'info');
      this.ctx.sfx('error');
      replayShake(card);
      return;
    }
    if (tool === 'seaport' && this.shoreCount === 0) {
      game.toast(NO_SHORE, 'info');
      this.ctx.sfx('error');
      replayShake(card);
      return;
    }
    buzz(8);
    if (isRoadTool(tool)) this.lastRoad = tool;
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
      const reason = lockedReason(w, tool);
      const locked = !!reason;
      setClass(c.el, 'is-locked', locked);
      setAttr(c.el, 'aria-disabled', locked ? 'true' : 'false');
      if (locked) {
        const text = reason!.replace(/^Locked:\s*/, '');
        const popGate = /residents/.test(text) && m.unlockPop > 0;
        setText(c.lockText, popGate ? `Reach ${abbr(m.unlockPop)} pop` : text);
        setHidden(c.lockFill.parentElement as HTMLElement, !popGate);
        if (popGate) {
          const p = Math.max(0, Math.min(1, w.maxPopulation / Math.max(1, m.unlockPop)));
          setStyle(c.lockFill, 'transform', `scaleX(${p.toFixed(3)})`);
        }
      }
      if (!locked) this.markSeen(tool);
      const noShore = tool === 'seaport' && !locked && this.shoreCount === 0;
      const price = livePrice(game, tool);
      if (noShore) {
        c.price = -1;
        setText(c.cost, NO_SHORE);
      } else if (price !== c.price) {
        c.price = price;
        setText(c.cost, costLabel({ ...m, cost: price }));
      }
      setClass(c.el, 'is-noshore', noShore);
      setClass(c.el, 'is-poor', !locked && !noShore && w.funds < price);
      const on = game.tool === tool;
      setClass(c.el, 'is-on', on);
      setAttr(c.el, 'aria-selected', on ? 'true' : 'false');
    }
  }

  // ── Story-gated groups ───────────────────────────────────────────────────

  private turfUnlocked(): boolean {
    const g = this.ctx.game;
    return g.story.view().unlocked.turfOverlay || isUnlocked(g.world, 'turfOverlay');
  }

  /**
   * Show the Deals group once the factions unlock, relabel Power → Infra at the first port unlock,
   * and light the "new" dots (diffed; cheap enough for the panel tick).
   */
  syncCategories(): void {
    const g = this.ctx.game;
    const w = g.world;
    const v = g.story.view();
    const deals = v.unlocked.factions || isUnlocked(w, 'factions');
    for (const c of CATEGORIES) {
      const refs = this.catRefs.get(c.id)!;
      if (c.story) {
        const btn = refs.btn;
        const show = c.id === 'deals' ? deals : true;
        if (btn.hidden === show) {
          btn.hidden = !show;
          if (!show && this.openCat === c.id) this.closeTray();
        }
      }
      const ch = categoryChrome(c, w.maxPopulation);
      const key = `${ch.label}|${ch.icon}`;
      if (key !== refs.chrome) {
        refs.chrome = key;
        setHtml(refs.ico, icon(ch.icon));
        setText(refs.long, ch.label);
        setText(refs.short, ch.short);
        setAttr(refs.btn, 'aria-label', ch.label);
        setAttr(refs.btn, 'title', c.key ? `${ch.label} (${c.key})` : ch.label);
        if (this.openCat === c.id) setText(this.trayTitle, ch.label);
      }
      // "New" dot: an item unlocked since this tray was last open (opening it clears the dot).
      let fresh = false;
      if (c.items && this.openCat !== c.id) {
        for (const t of c.items) {
          if (!this.seen.has(t) && !lockedReason(w, t)) {
            fresh = true;
            break;
          }
        }
      }
      setClass(refs.btn, 'has-new', fresh);
    }
    setClass(this.bar, 'is-full', deals);
  }

  /** Seen tool ids from storage; a device with none counts every unlocked pre-expansion tool as seen. */
  private loadSeen(): Set<ToolId> {
    const raw = storageGet(NEWDOT_KEY);
    if (raw) {
      try {
        const arr: unknown = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.filter((x): x is ToolId => typeof x === 'string'));
      } catch {
        /* unreadable: start over */
      }
    }
    const seen = new Set<ToolId>();
    const w = this.ctx.game.world;
    for (const c of CATEGORIES) for (const t of c.items ?? []) if (!NEW_TOOLS.has(t) && !lockedReason(w, t)) seen.add(t);
    this.saveSeen(seen);
    return seen;
  }

  private markSeen(tool: ToolId): void {
    if (this.seen.has(tool)) return;
    this.seen.add(tool);
    this.saveSeen(this.seen);
  }

  /** A storage failure only means a dot may show again. */
  private saveSeen(seen: Set<ToolId>): void {
    storageSet(NEWDOT_KEY, JSON.stringify([...seen]));
  }

  // ── Tool / overlay state ─────────────────────────────────────────────────

  /** Highlight the active category, show the tool chip (+ one-time hint). */
  syncTool(): void {
    const { game } = this.ctx;
    const tool = game.tool;
    if (isRoadTool(tool)) this.lastRoad = tool; // KeyR and the coach count too
    const activeCat = categoryOf(tool);
    const m = toolMeta(tool);
    for (const c of CATEGORIES) {
      const btn = this.catBtns.get(c.id)!;
      const on = c.id === 'data' ? false : c.id === activeCat;
      setClass(btn, 'is-on', on);
      setClass(btn, 'is-open', this.openCat === c.id);
      if (c.tool) setAttr(btn, 'aria-pressed', on ? 'true' : 'false');
      if (c.items || !c.tool) setAttr(btn, 'aria-expanded', this.openCat === c.id ? 'true' : 'false');
      // Multi-item categories adopt the chosen item's colour while active.
      if (c.items) setStyle(btn, '--accent', on ? m.color : c.accent);
    }
    const building = tool !== 'inspect';
    // While the first-run coach shows, its one-line row carries the next step and the
    // toolbar shows the active tool, so the chip folds away instead of stacking up.
    setHidden(this.chip, !building || this.trayOpen || this.coachShowing);
    if (building) {
      setStyle(this.chip, '--accent', m.color);
      setHtml(this.chipIco, icon(m.icon));
      setText(this.chipName, m.name);
      // Live price (build-cost mods, faction perks, Stratablock scaling), same as the tray cards.
      setText(this.chipCost, costLabel({ ...m, cost: livePrice(game, tool) }));
      if (!this.hintDone && !this.trayOpen) this.showHint(tool);
    } else this.hideHint(false);
    if (this.trayOpen) this.hint.hidden = true;
  }

  /** Re-price the active tool chip (prices move with mods, faction perks and Stratablock scaling). */
  refreshChipCost(): void {
    const { game } = this.ctx;
    if (game.tool === 'inspect') return;
    setText(this.chipCost, costLabel({ ...toolMeta(game.tool), cost: livePrice(game, game.tool) }));
  }

  /** The coach card is on screen: hide the tool chip (see syncTool). */
  setCoachShowing(on: boolean): void {
    if (on === this.coachShowing) return;
    this.coachShowing = on;
    this.syncTool();
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
      } else if (o.legend === 'turf') {
        scale =
          '<span class="cc-lg-turf is-undertow">Undertow</span><span class="cc-lg-turf is-kites">Kites</span><span class="cc-lg-turf is-contested">Contested</span>';
      } else if (o.legend === 'tiers') {
        // EXPANSION §4.5: three swatches, then the one line on the pips (colours match render/overlay.ts).
        scale =
          TIER_SWATCHES.map((s) => `<span class="cc-lg-sw" style="--sw:${s.color}">${s.label}</span>`).join('') +
          `<span class="cc-lg-line"><b style="color:${TIER_PIP_UP}">▲</b> <b style="color:${TIER_PIP_DOWN}">▼</b> = about to change. Schools, transit, parks and quiet lift blocks.</span>`;
      }
      setHtml(this.legendScale, scale);
      setClass(this.legend, 'is-swatches', o.legend !== 'heat');
      setClass(this.legend, 'is-tiers', o.legend === 'tiers');
    }
    this.refreshTray();
  }

  // ── Gesture hint ─────────────────────────────────────────────────────────

  private showHint(tool: ToolId): void {
    const verb =
      tool === 'bulldoze'
        ? 'Drag to demolish'
        : tool === 'skybridge'
          ? 'Drag from tower to tower'
          : tool === 'rail'
            ? 'Drag to lay track between stations'
            : tool === 'skyway'
              ? 'Drag to lay a raised road'
              : isBuildingTool(tool)
              ? 'Drag to place'
              : 'Drag to build';
    const mouse = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    setText(this.hint, `${verb} · ${mouse ? 'right-drag or WASD to move the map' : 'two fingers to move the map'}`);
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
