// ─────────────────────────────────────────────────────────────────────────────
// UI root: builds the DOM HUD over the canvas and wires it to the game bus.
//
//   Hud          top bar: city/date, treasury, population, RCI, speed, menu
//   Ticker       news strip under the HUD (tap → NewsLog)
//   Dock         bottom toolbar / landscape side rail, item tray, tool chip,
//                gesture hint, overlay legend (+ Coach + InspectSheet slots)
//   Feedback     toasts (with Undo / Watch buttons), live action pill (✓ / ✕ for
//                plans that need confirming), milestone + city-first banner, FPS
//   Tips         first-use tips for new tools and sim hints, one at a time
//   Dialogs      Budget, CityReport, NewsLog, Menu (settings/help/about), Confirm
//
// The root is pointer-events:none; only real panels take pointer events, so
// map gestures fall through to the canvas. DOM writes are diffed and the HUD
// refreshes at ~5 Hz; update(dt) itself does almost nothing per frame.
// ─────────────────────────────────────────────────────────────────────────────

import './ui.css';
import type { ToastAction } from '../game/events';
import type { Game } from '../game/game';
import { pointerActivity } from '../input/gestures';
import type { Camera } from '../render/camera';
import { mapBus } from '../input/mapbus';
import { partnerBadges } from '../render/overlay';
import { BudgetPanel } from './budget';
import { CityMap } from './citymap';
import { Coach } from './coach';
import { ConfirmDialog } from './confirm';
import { Modals, type UIActions, type UIContext } from './context';
import { Dock } from './dock';
import { buzz, h, setClass, setHidden } from './dom';
import { SpirePicker } from './pickers';
import { ActionPill, FpsMeter, MilestoneBanner, Toasts } from './feedback';
import { gridLink } from './grid';
import { Hud } from './hud';
import { InspectSheet } from './inspect';
import { Menu } from './menu';
import { NewsLog } from './newslog';
import { CityReport } from './report';
import { StoryUI } from './story/storyUI';
import './story/story.css';
import { Ticker } from './ticker';
import { Tips, newsTip, type TipId } from './tips';
import { traySections, type CategoryId } from './tools';

/** HUD figures refresh interval (s). */
const HUD_INTERVAL = 0.2;
/** Open panels / tray / coach refresh interval (s). */
const PANEL_INTERVAL = 0.3;
const COMPACT_QUERY = '(max-width: 639px)';
/** Watch (the first launch): where the pad sits on screen, as a share of the height (room above for the climb). */
const WATCH_Y = 0.66;
/** Watch: the view is eased out to at most this zoom so the tower and the climb fit. */
const WATCH_ZOOM = 0.85;


/** Toast actions this UI handles (Undo, Watch, Map: the City map on the locked slot). WP-9 adds 'export' with its Export city handler. */
const TOAST_HANDLED: ReadonlySet<ToastAction['id']> = new Set<ToastAction['id']>(['undo', 'watch', 'map']);
/** How often the camera insets are re-measured from the HUD and dock (s), besides resizes and world swaps. */
const INSET_INTERVAL = 1;

export class UI {
  /** Public for the start screen (src/ui/start): shared dialogs, menu views and the story hold. */
  readonly ctx: UIContext;
  private readonly modals: Modals;
  private readonly hud: Hud;
  private readonly ticker: Ticker;
  private readonly dock: Dock;
  private readonly coach: Coach;
  private readonly inspect: InspectSheet;
  private readonly toasts: Toasts;
  private readonly pill: ActionPill;
  /** The Corp Spire's sponsor row in the confirm pill (MEGACITY §6.2). */
  private readonly spire: SpirePicker;
  private readonly banner: MilestoneBanner;
  private readonly fps: FpsMeter;
  private readonly tips: Tips;
  /** Action pill + toasts, at the top. The pill steps aside while a full-screen story surface is up. */
  private readonly topStack: HTMLElement;
  /** Watch: the camera glides to this tile (the Spaceport pad) until it arrives or the player grabs the map. */
  private glide: { x: number; y: number } | null = null;
  private readonly budget: BudgetPanel;
  private readonly report: CityReport;
  private readonly news: NewsLog;
  readonly menu: Menu;
  private readonly confirm: ConfirmDialog;
  readonly story: StoryUI;
  /** The City map and annex sheet (MEGACITY §7.2). */
  readonly cityMap: CityMap;
  private insetAcc = INSET_INTERVAL;

  private hudAcc = 0;
  private panelAcc = 0;
  private statsDirty = true;
  private panelsDirty = true;
  private slowTicks = 0;
  /** A plant exists but reaches no zone (first-run trap); last warning time. */
  private stranded = false;
  private strandedAt = -Infinity;
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
      openMenu: (view) => this.menu.open(view ?? 'main'),
      openCityMap: (slot) => this.openCityMap(slot ?? null),
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
    this.toasts.hooks = {
      run: (id) => {
        if (id === 'undo') game.undo();
        else if (id === 'watch') this.watchLaunch();
        else if (id === 'map') this.openCityMap(game.mapSlot);
      },
      alive: (id) => (id === 'undo' ? game.undoLeft() > 0 : id === 'map' ? game.world.region >= 3 : game.launchLead !== null),
      left: (id) => (id === 'undo' ? game.undoLeft() : (game.launchLead?.left ?? 0)),
    };
    this.spire = new SpirePicker();
    this.pill = new ActionPill({
      confirm: () => {
        // The Corp Spire places with its sponsor and look (MEGACITY §6.2); everything else re-plans as before.
        const p = game.pendingConfirm;
        const plan = p && p.tool === 'spire' && p.tool === game.tool ? game.apply(p.from, p.to, this.spire.opts()) : game.confirmPending();
        if (plan?.valid) buzz(14);
      },
      cancel: () => game.cancelPending(),
    });
    this.pill.row.append(this.spire.el);
    this.spire.onChange = () => {
      setHidden(this.pill.row, !this.spire.visible);
      this.pill.invalidate();
    };
    this.banner = new MilestoneBanner();
    this.fps = new FpsMeter();
    this.budget = new BudgetPanel(this.ctx);
    this.report = new CityReport(this.ctx);
    this.news = new NewsLog(this.ctx);
    this.menu = new Menu(this.ctx);
    this.confirm = new ConfirmDialog(this.ctx);
    this.story = new StoryUI(this.ctx);
    this.cityMap = new CityMap(this.ctx);
    this.banner.held = () => this.story.busy || this.modals.depth > 0;
    this.toasts.held = () => this.story.holdsToasts;
    // One item at a time (EXPANSION §7.6): never over a tray, drag, confirm, story surface, message banner or dialog.
    this.tips = new Tips(this.dock.tipSlot, (id) => this.tipBlocked(id));

    this.dock.stack.prepend(this.coach.el);
    this.dock.sheetSlot.append(this.inspect.el);
    const topStack = (this.topStack = h('div', { class: 'cc-topstack' }, this.pill.el, this.toasts.el));
    root.prepend(this.dock.el, this.ticker.el, this.hud.el, this.fps.el, this.banner.el, topStack);
    for (const dlg of [this.budget.el, this.report.el, this.news.el, this.menu.el, this.confirm.el]) this.modals.layer.append(dlg);
    this.dock.railSlot.append(this.story.rail.el);
    root.insertBefore(this.story.el, this.modals.layer);
    root.insertBefore(this.cityMap.el, this.story.el);
    this.cityMap.onToggle = (open) => this.onCityMap(open);
    mapBus.hooks = {
      isOpen: () => this.cityMap.isOpen,
      open: (slot) => this.openCityMap(slot ?? null),
      tap: (sx, sy) => this.cityMap.tap(sx, sy),
      leave: (sx, sy) => this.cityMap.close({ sx, sy }),
    };
    this.story.onChange = () => this.syncCoach();
    this.story.onView = () => this.dock.syncCategories();

    this.dock.onTrayChange = () => this.syncCoach();
    this.coach.onChange = () => this.syncCoach();
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
    on('tool', (tool) => {
      this.dock.syncTool();
      this.dock.refreshTray();
      this.tips.onToolChange(tool);
      this.tips.onTool(tool);
      this.syncCoach();
    });
    on('overlay', () => this.dock.syncOverlay());
    // Land grants and annexes (MEGACITY §7.2, §7.3): the map button, the ✦ token and an open City map follow them.
    on('grant', (e) => {
      this.statsDirty = true;
      this.panelsDirty = true;
      this.story.refreshRail();
      // A grant that arrives with the City map open needs no "open the City map" tip.
      if (e.grants > 0 && this.game.world.region >= 3) {
        if (this.cityMap.isOpen) this.tips.resolve('grant');
        else this.tips.show('grant');
      }
      this.dock.syncCategories();
    });
    on('annex', (e) => {
      this.statsDirty = true;
      this.panelsDirty = true;
      this.story.refreshRail();
      this.cityMap.refresh();
      this.dock.syncCategories();
      this.tips.show('annexed');
      if (e.kind === 'skeleton') this.tips.show('frame');
    });
    on('speed', () => this.hud.syncSpeed());
    on('select', (sel) => {
      this.inspect.onSelect(sel);
      this.syncCoach();
    });
    on('news', (item) => {
      this.ticker.push(item);
      this.news.refresh();
      const tip = newsTip(item.text);
      if (tip) this.tips.show(tip);
    });
    // An action without a handler yet ('export' until WP-9's Export city, 'map' until the City map) shows as plain
    // text: its button would be dropped on the next frame (alive() is false for it) and take the message with it.
    on('toast', (t) => this.toasts.push(t.text, t.kind, t.action && TOAST_HANDLED.has(t.action.id) ? t.action : undefined));
    on('milestone', (m) => this.banner.show(m));
    on('moment', (m) => {
      this.banner.showMoment(m);
      // The first Sky Lobby's banner rides the 'region' moment (MomentId has no 'lobby', frozen types.ts).
      if (m.title.startsWith('SKY LOBBY')) this.tips.show('skylobby');
    });
    on('hint', (e) => this.tips.onHint(e.id));
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
    this.glide = null;
    // A world swap while the City map was open: leave it (the new city frames itself).
    const wasMap = this.cityMap.isOpen;
    this.cityMap.reset();
    if (wasMap) this.onCityMap(false);
    if (this.ctx.camera.mapView) this.ctx.camera.snapFromMap(this.ctx.camera.width / 2, this.ctx.camera.height / 2, 0);
    this.insetAcc = INSET_INTERVAL;
    this.tips.reset();
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
      this.glide = null;
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
      // Enter = ✓ on the City map's annex confirm (§7.2), unless a dialog or a text field has the key.
      if (e.key === 'Enter' && this.modals.depth === 0 && this.cityMap.isOpen && !e.repeat) {
        const t = e.target as HTMLElement | null;
        if (!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) && this.cityMap.enter()) {
          e.preventDefault();
          e.stopPropagation();
        }
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
    if (this.cityMap.isOpen) {
      this.cityMap.close();
      return true;
    }
    if (this.inspect.isOpen) {
      this.game.select(null);
      return true;
    }
    if (this.dock.trayOpen) {
      this.dock.closeTray();
      return true;
    }
    // The Skybridge tool (§5.4 step 7): Esc deselects the source tower before it leaves the tool.
    if (this.game.tool === 'skybridge' && this.game.bridgeSource) {
      this.game.cancelPending();
      this.game.setPreview(null);
      this.game.skybridgeSource(-1, -1);
      return true;
    }
    return false;
  }

  /** The skybridge partner badges on screen now (the harness and tests read what input hit-tests, §7.4). */
  badges(): ReturnType<typeof partnerBadges> {
    return partnerBadges(this.game, this.ctx.camera);
  }

  // ── City map (MEGACITY §7.2) ───────────────────────────────────────────────

  /** Open the City map (on a slot): closes the tray, the inspect sheet and any dialog first. */
  private openCityMap(slot: number | null): void {
    if (this.game.world.region < 3) return;
    this.modals.closeAll();
    this.dock.closeTray();
    this.game.select(null);
    this.glide = null;
    this.cityMap.open(slot);
  }

  /** The map opened or closed: hide the city HUD behind it, move the tip slot, re-set the camera insets. */
  private onCityMap(open: boolean): void {
    setClass(this.root, 'is-citymap', open);
    this.tips.moveTo(open ? this.cityMap.tipSlot : this.dock.tipSlot);
    if (open) {
      // The grant tip said "open the City map": done. The map's own tip takes its place at once.
      this.tips.resolve('grant');
      this.tips.onCityMap();
    } else {
      // The map's tip belongs to the map: seen if it showed, else it waits for the next open.
      this.tips.drop('citymap');
      this.syncInsets();
    }
    this.statsDirty = true;
    this.panelsDirty = true;
  }

  /**
   * The screen px the city HUD covers (§3.9): the top bar and ticker, the toolbar and story rail at the bottom, or the
   * side rail on a landscape phone. The camera frames boxes, pins and the district label inside the rest. The City map
   * sets its own while it is open.
   */
  syncInsets(): void {
    if (this.cityMap.isOpen) return;
    const cam = this.ctx.camera;
    const W = cam.width;
    const H = cam.height;
    let top = 0;
    let bottom = 0;
    let left = 0;
    for (const el of [this.hud.el, this.ticker.el]) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < H / 2) top = Math.max(top, r.bottom);
    }
    const bar = this.dock.barEl.getBoundingClientRect();
    if (bar.width > 0 && bar.height > 0) {
      if (bar.width >= W / 2 && bar.top > H / 2) {
        bottom = H - bar.top;
        const rail = this.story.rail.el.getBoundingClientRect();
        if (rail.height > 0 && rail.top > H / 2) bottom = Math.max(bottom, H - rail.top);
      } else if (bar.height >= H / 2 && bar.left < W / 2) left = bar.right;
    }
    cam.setInsets({ top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left) });
  }

  private applySettings(): void {
    const s = this.game.settings;
    setClass(this.root, 'cc-lowfx', s.quality === 'low');
  }

  private syncCoach(): void {
    this.coach.setCollapsed(this.game.tool !== 'inspect' || this.dock.trayOpen || this.inspect.isOpen || !!this.story?.busy);
    this.dock?.setCoachShowing(this.coach.showing);
  }

  /**
   * Warn when every plant is cut off from the zones (placed a tile off the road):
   * the sim's advisor only speaks up once lots develop, which they never will.
   * Once when it happens, then every 45 s of play while it lasts.
   */
  private checkGrid(): void {
    if (this.story.busy) return;
    const g = gridLink(this.game.world);
    const stranded = g.plants > 0 && g.zoned && !g.linked;
    const now = performance.now();
    if (stranded && (!this.stranded || (this.game.speed > 0 && now - this.strandedAt > 45000))) {
      this.strandedAt = now;
      this.game.toast(`Your ${g.plantName} isn't connected: it must touch a road or zone`, 'error');
    }
    this.stranded = stranded;
  }

  /**
   * Is anything up that a first-use tip (`id`, the one that would show) must not cover or compete with? The City map
   * shows only its own tip; the Corp Spire's sponsor tip explains its ✓ step, so that confirm does not hold it back.
   */
  private tipBlocked(id: TipId | null): boolean {
    const g = this.game;
    if (this.cityMap.isOpen && id !== 'citymap') return true;
    const sponsorStep = id === 'sponsor' && g.pendingConfirm?.tool === 'spire';
    if (this.dock.trayOpen || this.dock.hintShowing || pointerActivity.building || (g.pendingConfirm && !sponsorStep)) return true;
    // The inspect sheet has the player's attention (and shares the dock column on phones).
    if (this.inspect.isOpen) return true;
    if (this.story.busy || this.modals.depth > 0) return true;
    // The story's message banner (src/ui/story/incoming.ts) is a .cc-incoming element in the root.
    const banner = this.root.querySelector<HTMLElement>('.cc-incoming');
    return !!banner && !banner.hidden;
  }

  /** Watch (the first launch's toast): ease the camera to the pad, leaving room above for the climb. */
  private watchLaunch(): void {
    const lead = this.game.launchLead;
    if (!lead) return;
    this.glide = { x: lead.x, y: lead.y };
    const cam = this.ctx.camera;
    if (cam.zoom > WATCH_ZOOM) cam.zoomAt(WATCH_ZOOM / cam.zoom, cam.width / 2, cam.height / 2);
  }

  private updateGlide(dt: number): void {
    const g = this.glide;
    if (!g) return;
    const cam = this.ctx.camera;
    const p = cam.tileToScreen(g.x, g.y);
    const dx = cam.width / 2 - p.x;
    const dy = cam.height * WATCH_Y - p.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      this.glide = null;
      return;
    }
    const k = 1 - Math.exp(-dt * 6);
    const bx = cam.x;
    const by = cam.y;
    cam.panBy(dx * k, dy * k);
    // The camera clamp at the map edge ate the motion: stop there.
    if (cam.x === bx && cam.y === by) this.glide = null;
  }

  private refreshHud(): void {
    this.hud.refresh();
    this.ticker.refreshDate();
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  /** Per frame. Cheap: diffed pill + throttled refreshes. */
  update(dt: number): void {
    if (!(dt >= 0) || dt > 1) dt = 0;
    this.spire.sync(this.game);
    this.pill.update(this.game);
    // A chapter title, Charter Night or the ending covers the map: a plan waiting for ✓ waits behind it.
    setClass(this.topStack, 'is-story', this.story.fullscreen);
    this.fps.update(dt, this.game.settings.showFps, this.game.sim.resting | 0);
    this.ticker.update(performance.now());
    this.inspect.update(dt);
    this.story.update(dt);
    this.banner.update();
    this.toasts.flush();
    this.tips.update(dt);
    this.updateGlide(dt);
    this.cityMap.update();
    if (!this.ctx.camera.animating) mapBus.flyIn = null;
    this.insetAcc += dt;
    if (this.insetAcc >= INSET_INTERVAL) {
      this.insetAcc = 0;
      this.syncInsets();
      this.cityMap.layout();
    }

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
      this.checkGrid();
      this.budget.refresh();
      this.report.refresh();
      this.cityMap.refresh();
      // The first time the Legacy chip appears (§7.7): its tip, once per device.
      if (this.game.world.story.ending && traySections(this.game.world, 'deals').some((x) => x.section.id === 'legacy')) this.tips.show('legacy');
      if (this.menu.isOpen) this.menu.refresh();
    }
  }
}
