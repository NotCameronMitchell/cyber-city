// ─────────────────────────────────────────────────────────────────────────────
// UI root: builds the DOM HUD over the canvas and wires it to the game bus.
//
//   Hud          top bar: city/date, treasury, population, RCI, speed, menu
//   Ticker       news strip under the HUD (tap → NewsLog)
//   Dock         bottom toolbar / landscape side rail, item tray, tool chip,
//                gesture hint, overlay legend (+ Coach + InspectSheet slots)
//   Feedback     toasts, live action pill, milestone banner, FPS readout
//   Dialogs      Budget, CityReport, NewsLog, Menu (settings/help/about), Confirm
//
// The root is pointer-events:none; only real panels take pointer events, so
// map gestures fall through to the canvas. DOM writes are diffed and the HUD
// refreshes at ~5 Hz; update(dt) itself does almost nothing per frame.
// ─────────────────────────────────────────────────────────────────────────────

import './ui.css';
import type { Game } from '../game/game';
import type { Camera } from '../render/camera';
import { BudgetPanel } from './budget';
import { Coach } from './coach';
import { ConfirmDialog } from './confirm';
import { Modals, type UIActions, type UIContext } from './context';
import { Dock } from './dock';
import { h, setClass } from './dom';
import { ActionPill, FpsMeter, MilestoneBanner, Toasts } from './feedback';
import { Hud } from './hud';
import { InspectSheet } from './inspect';
import { Menu } from './menu';
import { NewsLog } from './newslog';
import { CityReport } from './report';
import { StoryUI } from './story/storyUI';
import './story/story.css';
import { Ticker } from './ticker';
import type { CategoryId } from './tools';

/** HUD figures refresh interval (s). */
const HUD_INTERVAL = 0.2;
/** Open panels / tray / coach refresh interval (s). */
const PANEL_INTERVAL = 0.3;
const COMPACT_QUERY = '(max-width: 639px)';

export class UI {
  private readonly ctx: UIContext;
  private readonly modals: Modals;
  private readonly hud: Hud;
  private readonly ticker: Ticker;
  private readonly dock: Dock;
  private readonly coach: Coach;
  private readonly inspect: InspectSheet;
  private readonly toasts: Toasts;
  private readonly pill: ActionPill;
  private readonly banner: MilestoneBanner;
  private readonly fps: FpsMeter;
  private readonly budget: BudgetPanel;
  private readonly report: CityReport;
  private readonly news: NewsLog;
  private readonly menu: Menu;
  private readonly confirm: ConfirmDialog;
  private readonly story: StoryUI;

  private hudAcc = 0;
  private panelAcc = 0;
  private statsDirty = true;
  private panelsDirty = true;
  private slowTicks = 0;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Game,
    camera: Camera,
  ) {
    root.textContent = '';
    root.classList.add('cc-ui');

    this.modals = new Modals(root);
    // Late-bound actions: components call these, the root routes them.
    const actions: UIActions = {
      openBudget: () => this.budget.open(),
      openNews: () => this.news.open(),
      openReport: () => this.report.open(),
      openMenu: () => this.menu.open(),
      confirm: (opts) => this.confirm.open(opts),
      openTray: (cat) => this.dock.openTray(cat as CategoryId),
      closeTray: () => this.dock.closeTray(),
    };
    const mq = typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : null;
    this.ctx = {
      game,
      camera,
      root,
      modals: this.modals,
      actions,
      compact: mq ? mq.matches : false,
      sfx: (kind) => game.events.emit('sfx', kind),
    };
    if (mq) {
      const onMq = () => {
        this.ctx.compact = mq.matches;
        this.statsDirty = true;
      };
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMq);
      else mq.addListener(onMq);
    }

    // ── Build ──────────────────────────────────────────────────────────────
    this.hud = new Hud(this.ctx);
    this.ticker = new Ticker(this.ctx);
    this.dock = new Dock(this.ctx);
    this.coach = new Coach(this.ctx);
    this.inspect = new InspectSheet(this.ctx);
    this.toasts = new Toasts();
    this.pill = new ActionPill();
    this.banner = new MilestoneBanner();
    this.fps = new FpsMeter();
    this.budget = new BudgetPanel(this.ctx);
    this.report = new CityReport(this.ctx);
    this.news = new NewsLog(this.ctx);
    this.menu = new Menu(this.ctx);
    this.confirm = new ConfirmDialog(this.ctx);
    this.story = new StoryUI(this.ctx);

    this.dock.stack.prepend(this.coach.el);
    this.dock.sheetSlot.append(this.inspect.el);
    const topStack = h('div', { class: 'cc-topstack' }, this.pill.el, this.toasts.el);
    root.prepend(this.dock.el, this.ticker.el, this.hud.el, this.fps.el, this.banner.el, topStack);
    for (const dlg of [this.budget.el, this.report.el, this.news.el, this.menu.el, this.confirm.el]) this.modals.layer.append(dlg);
    this.dock.railSlot.append(this.story.rail.el);
    root.insertBefore(this.story.el, this.modals.layer);
    this.story.onChange = () => this.syncCoach();
    this.story.onView = () => this.dock.syncCategories();

    this.dock.onTrayChange = () => this.syncCoach();
    this.modals.onChange = (open) => setClass(root, 'has-modal', open);

    this.wireEvents();
    this.wireInput();
    this.applySettings();
    this.syncCoach();
  }

  // ── Game bus ──────────────────────────────────────────────────────────────

  private wireEvents(): void {
    const ev = this.game.events;
    const on: typeof ev.on = (type, fn) => {
      const off = ev.on(type, fn);
      this.offs.push(off);
      return off;
    };
    on('stats', () => {
      this.statsDirty = true;
      this.panelsDirty = true;
      this.dock.refreshChipCost();
    });
    on('month', () => {
      this.statsDirty = true;
      this.panelsDirty = true;
    });
    on('tool', () => {
      this.dock.syncTool();
      this.dock.refreshTray();
      this.syncCoach();
    });
    on('overlay', () => this.dock.syncOverlay());
    on('speed', () => this.hud.syncSpeed());
    on('select', (sel) => {
      this.inspect.onSelect(sel);
      this.syncCoach();
    });
    on('news', (item) => {
      this.ticker.push(item);
      this.news.refresh();
    });
    on('toast', (t) => this.toasts.push(t.text, t.kind));
    on('milestone', (m) => this.banner.show(m));
    on('settings', () => {
      this.applySettings();
      this.menu.refresh();
    });
    on('sfx', (kind) => {
      if (kind === 'build' || kind === 'zone' || kind === 'road' || kind === 'bulldoze') this.dock.noteBuilt();
    });
    on('world', () => this.onWorld());
    const storyChanged = () => {
      this.panelsDirty = true;
      this.dock.syncCategories();
    };
    on('unlock', storyChanged);
    on('standing', () => (this.panelsDirty = true));
    on('story', () => (this.panelsDirty = true));
    on('vertical', () => (this.panelsDirty = true));
    on('turf', () => (this.panelsDirty = true));
  }

  /** game.world was replaced (new city / load): drop every per-world view state. */
  private onWorld(): void {
    this.inspect.onSelect(null);
    this.dock.closeTray();
    this.dock.syncTool();
    this.dock.syncOverlay();
    this.hud.resetBaseline();
    this.hud.syncSpeed();
    this.ticker.reset();
    this.coach.evaluate();
    this.syncCoach();
    this.statsDirty = true;
    this.panelsDirty = true;
    this.refreshHud();
  }

  // ── DOM input ─────────────────────────────────────────────────────────────

  private wireInput(): void {
    const root = this.root;
    // Tiny UI click for every button press (one delegated listener).
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (btn && root.contains(btn) && btn.getAttribute('aria-disabled') !== 'true') this.ctx.sfx('click');
    };
    root.addEventListener('click', onClick);
    this.offs.push(() => root.removeEventListener('click', onClick));

    // Touching the map (anything outside the UI root) folds the tray and stops camera nudges.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && root.contains(t)) return;
      this.dock.closeTray();
      this.inspect.cancelNudge();
    };
    window.addEventListener('pointerdown', onDown, true);
    this.offs.push(() => window.removeEventListener('pointerdown', onDown, true));

    // Keyboard: Esc closes the top-most panel. While a dialog has focus, game
    // hotkeys are suppressed (preventDefault is honoured by the input module).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (this.closeTopPanel()) e.preventDefault();
        return;
      }
      if (this.modals.depth === 0 || e.key === 'Tab' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (!target || !this.modals.layer.contains(target)) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.key === ' ' || e.key === 'Enter') && target.tagName === 'BUTTON') {
        e.preventDefault();
        if (!e.repeat) (target as HTMLButtonElement).click();
        return;
      }
      if (e.key.startsWith('Arrow')) return; // let focused controls handle arrows
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    this.offs.push(() => window.removeEventListener('keydown', onKey, true));
  }

  /** Esc handling: dialog → inspect sheet → tray. Returns whether something closed. */
  private closeTopPanel(): boolean {
    if (this.modals.closeTop()) return true;
    if (this.story.closeTop()) return true;
    if (this.inspect.isOpen) {
      this.game.select(null);
      return true;
    }
    if (this.dock.trayOpen) {
      this.dock.closeTray();
      return true;
    }
    return false;
  }

  private applySettings(): void {
    const s = this.game.settings;
    setClass(this.root, 'cc-lowfx', s.quality === 'low');
  }

  private syncCoach(): void {
    this.coach.setCollapsed(this.game.tool !== 'inspect' || this.dock.trayOpen || this.inspect.isOpen || !!this.story?.busy);
  }

  private refreshHud(): void {
    this.hud.refresh();
    this.ticker.refreshDate();
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  /** Per frame. Cheap: diffed pill + throttled refreshes. */
  update(dt: number): void {
    if (!(dt >= 0) || dt > 1) dt = 0;
    this.pill.update(this.game);
    this.fps.update(dt, this.game.settings.showFps);
    this.ticker.update(performance.now());
    this.inspect.update(dt);
    this.story.update(dt);

    this.hudAcc += dt;
    if (this.hudAcc >= HUD_INTERVAL) {
      this.hudAcc = 0;
      // Refresh when stats changed, and once a second regardless (date, safety net).
      if (this.statsDirty || ++this.slowTicks >= 5) {
        this.statsDirty = false;
        this.slowTicks = 0;
        this.refreshHud();
      }
    }

    this.panelAcc += dt;
    if (this.panelAcc >= PANEL_INTERVAL && this.panelsDirty) {
      this.panelAcc = 0;
      this.panelsDirty = false;
      this.inspect.refresh();
      this.dock.refreshTray();
      this.dock.syncCategories();
      this.coach.check();
      this.budget.refresh();
      this.report.refresh();
      if (this.menu.isOpen) this.menu.refresh();
    }
  }
}
