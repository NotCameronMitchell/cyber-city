// ─────────────────────────────────────────────────────────────────────────────
// Start screen: the title over the live city, shown on every page load (and
// from the in-game menu's "Main menu"). The city stays paused behind it and
// the story waits (StoryUI.setHold; main.ts skips game.update while held).
//
//   backdrop   the canvas itself (the saved city, or on first launch a lit
//              showcase city, showcase.ts) at night, drifting slowly; a
//              gradient + vignette here
//   brand      neon CYBER CITY wordmark in a chamfered frame, tagline
//   actions    Continue card (save) · New city · Settings / How to play /
//              About (the menu's own views) · Previous city (backup slot)
//   sheet      New city: name + reroll, Story pace, Found city
//
// Leaving fades the title out (LEAVE_MS) while the HUD fades in, then the
// hold ends and the game resumes at 1×. Logic without DOM: startModel.ts.
// ─────────────────────────────────────────────────────────────────────────────

import './start.css';
import { DAY_CYCLE_SECONDS } from '../../game/config';
import { CITY_NAME_MAX, randomCityName, randomSeed, type Game } from '../../game/game';
import { STORY_PACES, ZoneType, type StoryPace } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W, type Camera } from '../../render/camera';
import type { Renderer } from '../../render/renderer';
import type { UI } from '../ui';
import { h, prefersReducedMotion, setAttr, setClass, setHidden, setText } from '../dom';
import { icon } from '../icons';
import { PACE } from '../menu';
import {
  LEAVE_MS,
  StartFlow,
  a2hsHint,
  citySummary,
  driftOffset,
  holdGame,
  replaceNote,
  startButtons,
  startKey,
  titleWarning,
  worthKeeping,
  type StartButtons,
} from './startModel';
import { Showcase } from './showcase';

export interface StartOptions {
  game: Game;
  camera: Camera;
  ui: UI;
  /** The game canvas (the first-launch showcase draws on it while the title is up). */
  canvas?: HTMLCanvasElement;
  /** A city to continue already exists (a save on this device, or a restored hot-reload snapshot). */
  hasCity: boolean;
  /** A save exists but the game could not read it (it starts a fresh city instead). */
  unreadable?: boolean;
  /** Save now (main.ts resets its autosave clocks too); false when nothing was stored. */
  save: () => boolean;
}

const A2HS_KEY = 'cybercity.ui.a2hs.v1';
/** Night on the visual clock (fraction of a day): late evening, the dayNight-off look. */
const NIGHT = 0.88;

export class StartScreen {
  readonly el: HTMLElement;
  readonly flow = new StartFlow('title');
  private readonly game: Game;
  private readonly camera: Camera;
  private readonly ui: UI;
  private readonly root: HTMLElement;
  private readonly save: () => boolean;

  private readonly layout: HTMLElement;
  private readonly slot: HTMLElement;
  private readonly slotKicker: HTMLElement;
  private readonly slotName: HTMLElement;
  private readonly slotMeta: HTMLElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly prevName: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly foot: HTMLElement;

  private readonly sheet: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly paceBtns: HTMLButtonElement[] = [];
  private readonly paceDesc: HTMLElement;
  private readonly note: HTMLElement;
  private readonly foundBtn: HTMLButtonElement;
  private pace: StoryPace = 'relaxed';

  private buttons: StartButtons = startButtons({ hasCity: false, hasBackup: false });
  /** Continue is offered: a save, a restored snapshot, or a city played this session. */
  private city: boolean;
  /** A returning player at boot (the install tip waits for the second visit). */
  private readonly returning: boolean;
  /** The stored save could not be read: say so once, New City is the primary. */
  private unreadable: boolean;
  /** First launch: a lit city behind the title instead of a bare map (until the player leaves). */
  private showcase: Showcase | null = null;
  private anchor: { x: number; y: number } | null = null;
  private driftT = 0;
  private leaveTimer = 0;

  constructor(o: StartOptions) {
    this.game = o.game;
    this.camera = o.camera;
    this.ui = o.ui;
    this.root = o.ui.ctx.root;
    this.save = o.save;
    this.city = o.hasCity;
    this.returning = o.hasCity;
    this.unreadable = !!o.unreadable && !o.hasCity;

    // ── Brand ──────────────────────────────────────────────────────────────
    const mark = h(
      'h1',
      { class: 'cc-start-mark', id: 'cc-start-title', 'aria-label': 'Cyber City' },
      h('span', { class: 'cc-start-glow', 'aria-hidden': 'true' }, h('span', { class: 'cc-start-frame' })),
      h('span', { class: 'cc-start-corner is-tr', 'aria-hidden': 'true' }),
      h('span', { class: 'cc-start-corner is-bl', 'aria-hidden': 'true' }),
      h(
        'span',
        { class: 'cc-start-w1', 'data-text': 'CYBER', 'aria-hidden': 'true' },
        'CYB',
        h('span', { class: 'cc-start-flk', text: 'E' }),
        'R',
      ),
      h(
        'span',
        { class: 'cc-start-w2', 'aria-hidden': 'true' },
        h('i', { class: 'cc-start-rule' }),
        h('span', { class: 'cc-start-w2t' }, 'CI', h('span', { class: 'cc-start-flk is-2', text: 'T' }), 'Y'),
        h('i', { class: 'cc-start-rule' }),
      ),
    );
    const brand = h(
      'header',
      { class: 'cc-start-brand' },
      h('div', { class: 'cc-start-sys', text: '> municipal grid · standby' }),
      mark,
      h('p', { class: 'cc-start-line', text: 'The city thinks it runs itself. You let it.' }),
    );

    // ── Actions ────────────────────────────────────────────────────────────
    this.slotKicker = h('div', { class: 'cc-start-slot-k' });
    this.slotName = h('div', { class: 'cc-start-slot-name' });
    this.slotMeta = h('div', { class: 'cc-start-slot-meta' });
    this.continueBtn = h(
      'button',
      { class: 'cc-btn is-primary cc-start-big', type: 'button', 'data-act': 'continue' },
      h('span', { class: 'cc-start-btn-ico', html: icon('play') }),
      h('span', { text: 'Continue' }),
    );
    this.slot = h(
      'section',
      { class: 'cc-start-slot', 'aria-label': 'Your city' },
      h('div', { class: 'cc-start-slot-info' }, this.slotKicker, this.slotName, this.slotMeta),
      this.continueBtn,
    );
    this.newBtn = h(
      'button',
      { class: 'cc-btn cc-start-new', type: 'button', 'data-act': 'new' },
      h('span', { class: 'cc-start-btn-ico', html: icon('newCity') }),
      h('span', { text: 'New city' }),
    );
    const mini = (act: string, ico: Parameters<typeof icon>[0], label: string) =>
      h('button', { class: 'cc-start-mini', type: 'button', 'data-act': act }, h('span', { html: icon(ico) }), h('span', { text: label }));
    const row = h('div', { class: 'cc-start-row' }, mini('settings', 'gear', 'Settings'), mini('help', 'help', 'How to play'), mini('about', 'info', 'About'));
    this.prevName = h('span', { class: 'cc-start-prev-name' });
    this.prevBtn = h(
      'button',
      { class: 'cc-start-prev', type: 'button', 'data-act': 'previous' },
      h('span', { html: icon('back') }),
      h('span', { class: 'cc-start-prev-text' }, h('span', { text: 'Previous city' }), this.prevName),
    );
    this.hintText = h('span', { class: 'cc-start-hint-text' });
    this.hint = h(
      'div',
      { class: 'cc-start-hint', hidden: true },
      this.hintText,
      h('button', { class: 'cc-start-hint-x', type: 'button', 'data-act': 'hint-x', 'aria-label': 'Dismiss tip', html: icon('close') }),
    );
    this.warn = h('p', { class: 'cc-start-warn', role: 'status', hidden: true });
    this.foot = h('div', { class: 'cc-start-foot' });
    const actions = h('nav', { class: 'cc-start-actions', 'aria-label': 'Start' }, this.warn, this.slot, this.newBtn, row, this.prevBtn, this.hint, this.foot);
    this.layout = h('div', { class: 'cc-start-layout' }, brand, actions);

    // ── New city sheet ─────────────────────────────────────────────────────
    this.nameInput = h('input', {
      class: 'cc-input cc-start-input',
      id: 'cc-start-name',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      enterkeyhint: 'go',
      maxlength: CITY_NAME_MAX,
    });
    const paceSeg = h('div', { class: 'cc-seg cc-seg-pace cc-start-seg', role: 'radiogroup', 'aria-labelledby': 'cc-start-pace-k' });
    for (const p of STORY_PACES) {
      const b = h('button', { class: 'cc-seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-pace': p, text: PACE[p].label });
      this.paceBtns.push(b);
      paceSeg.append(b);
    }
    this.paceDesc = h('p', { class: 'cc-start-desc', 'aria-live': 'polite' });
    this.note = h('p', { class: 'cc-start-note' });
    this.foundBtn = h(
      'button',
      { class: 'cc-btn is-primary cc-start-big', type: 'button', 'data-act': 'found' },
      h('span', { class: 'cc-start-btn-ico', html: icon('newCity') }),
      h('span', { text: 'Found city' }),
    );
    this.sheet = h(
      'section',
      { class: 'cc-start-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cc-start-sheet-t', tabindex: '-1', hidden: true },
      h(
        'header',
        { class: 'cc-start-sheet-head' },
        h('div', {}, h('div', { class: 'cc-start-sys', text: '> new charter' }), h('h2', { class: 'cc-start-sheet-t', id: 'cc-start-sheet-t', text: 'New city' })),
        h('button', { class: 'cc-iconbtn', type: 'button', 'data-act': 'close-setup', 'aria-label': 'Back to the title', html: icon('close') }),
      ),
      h(
        'div',
        { class: 'cc-start-sheet-body' },
        h(
          'div',
          { class: 'cc-start-field' },
          h('label', { class: 'cc-start-k', for: 'cc-start-name', text: 'City name' }),
          h(
            'div',
            { class: 'cc-field-row' },
            this.nameInput,
            h('button', { class: 'cc-iconbtn cc-reroll', type: 'button', 'data-act': 'reroll', 'aria-label': 'Random name', html: icon('dice') }),
          ),
        ),
        h('div', { class: 'cc-start-field' }, h('span', { class: 'cc-start-k', id: 'cc-start-pace-k', text: 'Story pace' }), paceSeg, this.paceDesc),
      ),
      // The backup note sits with Found city, so it can never scroll out of sight.
      h('div', { class: 'cc-start-sheet-foot' }, this.note, this.foundBtn),
    );

    this.el = h(
      'div',
      { class: 'cc-start', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cc-start-title', hidden: true },
      h('div', { class: 'cc-start-shade', 'aria-hidden': 'true' }),
      this.layout,
      this.sheet,
    );
    // Above the story layer, under dialogs (Settings, the confirm) so those open over the title.
    this.root.insertBefore(this.el, this.ui.ctx.modals.layer);

    this.el.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKey, true);
    this.ui.menu.onMainMenu = () => this.show();
    this.ui.menu.onNewCity = () => this.show(true);

    // First launch: a lit city behind the title (the real, empty map waits underneath).
    if (!o.hasCity && o.canvas) {
      try {
        this.showcase = new Showcase(this.game, o.canvas);
      } catch (err) {
        console.warn('[start] showcase backdrop unavailable', err);
        this.showcase = null;
      }
    }

    // Boot: the title is the first thing on screen, the game held behind it.
    this.ui.story.setHold(true);
    this.present(true);
  }

  // ── State ────────────────────────────────────────────────────────────────

  /** main.ts: hold the game (no game.update, no autosave, no input). */
  get holding(): boolean {
    return this.flow.holding;
  }

  /** The title is idle on screen (not fading): main.ts may render it at a lower frame rate. */
  get idle(): boolean {
    return this.flow.interactive;
  }

  /** Continue is offered (main.ts: a hot-reload snapshot is only worth taking then). */
  get hasCity(): boolean {
    return this.city;
  }

  /** What main.ts draws while the title holds: the first-launch showcase, or null for the game's own renderer. */
  get backdrop(): Renderer | null {
    return this.showcase?.renderer ?? null;
  }

  /** Reduced motion: the backdrop is a still picture (main.ts redraws it rarely, with time stopped). */
  get still(): boolean {
    return reducedMotion();
  }

  /** The viewport changed (main.ts, alongside the game's renderer). */
  resize(): void {
    this.showcase?.resize();
  }

  /**
   * In-game menu › Main menu: save, pause and show the title again.
   * `setup`: the menu's New city, straight to the setup sheet (✕ leaves the title up).
   */
  show(setup = false): void {
    if (this.flow.phase !== 'play') return;
    if (!this.save() && storageWorks()) this.game.toast('This city could not be saved: storage is full', 'error');
    this.flow.show();
    holdGame(this.game);
    this.ui.ctx.actions.closeTray();
    this.ui.story.setHold(true);
    this.present(false);
    if (setup) this.openSheet();
  }

  private present(boot: boolean): void {
    window.clearTimeout(this.leaveTimer);
    this.game.setSpeed(0);
    this.nightClock();
    this.closeSheet(false);
    this.anchor = null;
    this.driftT = 0;
    this.refresh();
    this.el.hidden = false;
    this.el.inert = false;
    this.el.classList.remove('is-leaving');
    this.root.classList.remove('cc-start-reveal');
    this.root.classList.add('cc-start-on');
    if (!prefersReducedMotion()) {
      this.el.classList.remove('is-boot', 'is-back');
      void this.el.offsetWidth;
      this.el.classList.add(boot ? 'is-boot' : 'is-back');
    }
    // Keyboard users land on the primary; touch users get no stray focus ring.
    this.focus(this.primaryBtn(), true);
  }

  /** Slots, Continue card, Previous city and the footer, from the game as it is now. */
  refresh(): void {
    const { game } = this;
    const hasBackup = game.hasPreviousSave();
    this.buttons = startButtons({ hasCity: this.city, hasBackup });
    const warning = titleWarning({ unreadable: this.unreadable, future: game.saveBlocked });
    setText(this.warn, warning);
    setHidden(this.warn, !warning);
    const b = this.buttons;
    setHidden(this.slot, !b.continue);
    if (b.continue) {
      const v = game.story.view();
      const w = game.world;
      const s = citySummary({
        cityName: w.cityName,
        date: w.dateLabel(),
        population: w.stats.population,
        story: { n: v.chapter.n, numeral: v.chapter.numeral, title: v.chapter.title, phase: v.chapter.phase, ended: !!v.ending },
      });
      setText(this.slotKicker, s.chapter);
      setHidden(this.slotKicker, !s.chapter);
      setClass(this.slotKicker, 'is-sandbox', s.kind === 'sandbox');
      setText(this.slotName, s.name);
      setText(this.slotMeta, s.meta);
      setAttr(this.continueBtn, 'aria-label', `Continue ${s.name}`);
    }
    setClass(this.newBtn, 'is-primary', b.newPrimary);
    setClass(this.newBtn, 'cc-start-big', b.newPrimary);
    setHidden(this.prevBtn, !b.previous);
    if (b.previous) {
      const info = game.previousSaveInfo();
      setText(this.prevName, info?.cityName ? ` · ${info.cityName}` : '');
    }
    const hint = a2hsHint(readEnv(this.returning));
    setText(this.hintText, hint ?? '');
    setHidden(this.hint, !hint);
    setText(this.foot, `> build 0.1 · ${storageWorks() ? 'saved on this device' : 'saving is off in this browser'}`);
  }

  private primaryBtn(): HTMLButtonElement {
    if (this.flow.phase === 'setup') return this.foundBtn;
    return this.buttons.primary === 'continue' ? this.continueBtn : this.newBtn;
  }

  private focus(el: HTMLElement, keyboardOnly: boolean): void {
    if (keyboardOnly && !keyboardModality) {
      try {
        (document.activeElement as HTMLElement | null)?.blur?.();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* old browsers */
    }
  }

  // ── Setup sheet ──────────────────────────────────────────────────────────

  private openSheet(): void {
    if (!this.flow.openSetup()) return;
    const { game } = this;
    this.nameInput.value = randomCityName(randomSeed());
    this.setPace(game.settings.storyPace);
    const keeps = this.city && worthKeeping({ tick: game.world.tick, buildingCount: game.world.buildings.size, tiles: game.world.tiles });
    const note = replaceNote({ current: this.city ? game.world.cityName : null, keeps, backup: game.previousSaveInfo()?.cityName ?? null });
    setText(this.note, note);
    setHidden(this.note, !note);
    this.sheet.hidden = false;
    this.layout.inert = true;
    this.el.classList.add('is-setup');
    if (!prefersReducedMotion()) {
      this.sheet.classList.remove('is-in');
      void this.sheet.offsetWidth;
      this.sheet.classList.add('is-in');
    }
    // No keyboard pop-up on phones: focus the name only for keyboard users.
    if (keyboardModality) this.focus(this.nameInput, false);
    else this.focus(this.sheet, false);
  }

  /** Hide the sheet (✕, Esc, a tap outside it, leaving, or showing the title again). */
  private closeSheet(refocus: boolean): void {
    this.flow.closeSetup();
    const wasOpen = !this.sheet.hidden;
    this.sheet.hidden = true;
    this.layout.inert = false;
    this.el.classList.remove('is-setup');
    if (wasOpen && refocus) this.focus(this.newBtn, true);
  }

  private setPace(p: StoryPace): void {
    this.pace = p;
    for (const b of this.paceBtns) {
      const on = b.dataset.pace === p;
      setAttr(b, 'aria-checked', on ? 'true' : 'false');
      setAttr(b, 'tabindex', on ? '0' : '-1');
      setClass(b, 'is-on', on);
    }
    setText(this.paceDesc, PACE[p]?.desc ?? '');
  }

  private found(): void {
    if (this.flow.phase !== 'setup') return;
    const { game } = this;
    const name = this.nameInput.value.trim().slice(0, CITY_NAME_MAX);
    if (game.settings.storyPace !== this.pace) game.updateSettings({ storyPace: this.pace });
    // First launch: found the untouched map waiting under the showcase (the camera is framed on it). Otherwise a fresh map.
    const keepMap = !this.city && !worthKeeping({ tick: game.world.tick, buildingCount: game.world.buildings.size, tiles: game.world.tiles });
    const seed = keepMap ? game.world.seed : randomSeed();
    game.newCity(name || undefined, seed);
    this.nightClock();
    if (!keepMap) this.reframe();
    this.city = true;
    this.unreadable = false;
    game.toast(`Charter signed: welcome to ${game.world.cityName}`, 'good');
    this.leave();
  }

  // ── Leaving ──────────────────────────────────────────────────────────────

  private leave(): void {
    if (!this.flow.leave()) return;
    this.closeSheet(false);
    this.dropShowcase();
    this.el.classList.remove('is-boot', 'is-back');
    this.el.inert = true;
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      /* ignore */
    }
    this.root.classList.remove('cc-start-on');
    window.clearTimeout(this.leaveTimer);
    if (prefersReducedMotion()) {
      this.finish();
      return;
    }
    this.root.classList.add('cc-start-reveal');
    this.el.classList.add('is-leaving');
    this.leaveTimer = window.setTimeout(() => this.finish(), LEAVE_MS);
  }

  private finish(): void {
    if (!this.flow.finish()) return;
    this.el.hidden = true;
    this.el.classList.remove('is-leaving');
    this.root.classList.remove('cc-start-reveal');
    this.city = true;
    // Release the story first so the first frame of play sees it unheld, then run at 1×.
    this.ui.story.setHold(false);
    this.game.setSpeed(1);
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  /** Per frame while held: the slow backdrop drift (none with reduced motion). */
  update(dt: number): void {
    if (!this.flow.drifting || reducedMotion()) return;
    const cam = this.showcase?.camera ?? this.camera;
    if (!this.anchor) this.anchor = { x: cam.x, y: cam.y };
    this.driftT += Math.min(Math.max(dt, 0), 0.1);
    const d = driftOffset(this.driftT);
    cam.x = this.anchor.x + d.x;
    cam.y = this.anchor.y + d.y;
    cam.clamp();
  }

  /** Leaving the first-launch title: the game's own map takes over the canvas (under the fade). */
  private dropShowcase(): void {
    if (!this.showcase) return;
    this.showcase.destroy();
    this.showcase = null;
    this.anchor = null;
    this.driftT = 0;
  }

  /** A different city is on the canvas: frame it, and drift from there (not from the old anchor). */
  private reframe(): void {
    frameCity(this.camera, this.game.world);
    this.anchor = null;
    this.driftT = 0;
  }

  /** The backdrop is a night city: move the visual clock to late evening when it is day. */
  private nightClock(): void {
    const g = this.game;
    if (g.daylight <= 0) return;
    const day = Math.floor(g.clock / DAY_CYCLE_SECONDS);
    g.clock = (day + NIGHT) * DAY_CYCLE_SECONDS;
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const pace = t.closest<HTMLElement>('[data-pace]');
    if (pace && this.sheet.contains(pace)) {
      this.setPace(pace.dataset.pace as StoryPace);
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) {
      // A tap on the dimmed title behind the sheet closes it.
      if (this.flow.phase === 'setup' && !this.sheet.contains(t)) this.closeSheet(true);
      return;
    }
    if (!this.flow.interactive) return;
    this.act(act);
  };

  private act(act: string): void {
    const { menu } = this.ui;
    switch (act) {
      case 'continue':
        if (this.buttons.continue) this.leave();
        return;
      case 'new':
        this.openSheet();
        return;
      case 'close-setup':
        this.closeSheet(true);
        return;
      case 'reroll':
        this.nameInput.value = randomCityName(randomSeed());
        return;
      case 'found':
        this.found();
        return;
      case 'settings':
      case 'help':
      case 'about':
        menu.open(act, true);
        return;
      case 'previous':
        this.restorePrevious();
        return;
      case 'hint-x':
        try {
          globalThis.localStorage?.setItem(A2HS_KEY, '1');
        } catch {
          /* ignore */
        }
        setHidden(this.hint, true);
        return;
    }
  }

  /** Previous city: the menu's confirm (same wording), then straight into it. */
  private restorePrevious(): void {
    const { game } = this;
    const name = game.previousSaveInfo()?.cityName || 'the previous city';
    this.ui.ctx.actions.confirm({
      title: 'Restore previous city?',
      body: `Swap back to ${name}. This city moves into the backup slot, so you can swap again.`,
      confirmLabel: 'Restore',
      onConfirm: () => {
        if (!this.flow.interactive) return;
        const ok = game.loadPrevious();
        if (!ok) {
          game.toast('The previous city could not be read', 'error');
          this.refresh();
          return;
        }
        this.nightClock();
        this.reframe();
        this.city = true;
        this.unreadable = false;
        game.toast(`Welcome back to ${game.world.cityName}`, 'good');
        this.leave();
      },
    });
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const phase = this.flow.phase;
    if (phase === 'play') return;
    const target = e.target as HTMLElement | null;
    const inStart = !!target && this.el.contains(target);
    // Story pace: arrows move the choice (radio group).
    if (phase === 'setup' && target?.dataset.pace && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const i = this.paceBtns.indexOf(target as HTMLButtonElement);
      const next = this.paceBtns[(i + (e.key === 'ArrowRight' ? 1 : this.paceBtns.length - 1)) % this.paceBtns.length];
      this.setPace(next.dataset.pace as StoryPace);
      next.focus();
      return;
    }
    // aria-modal: Tab wraps inside the title (or its sheet) instead of leaving for the page.
    if (e.key === 'Tab' && this.flow.interactive && this.ui.ctx.modals.depth === 0) {
      const items = focusables(phase === 'setup' ? this.sheet : this.layout);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const wrap = e.shiftKey ? i <= 0 : i < 0 || i === items.length - 1;
      if (items.length && wrap) {
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0].focus();
      }
      return;
    }
    const action = startKey({
      key: e.key,
      phase,
      modal: this.ui.ctx.modals.depth > 0,
      onButton: inStart && target?.tagName === 'BUTTON',
      typing: inStart && (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'),
      repeat: e.repeat,
    });
    switch (action) {
      case 'pass':
        return;
      case 'block':
        e.preventDefault();
        return;
      case 'close-setup':
        e.preventDefault();
        this.closeSheet(true);
        return;
      case 'click-target':
        e.preventDefault();
        (target as HTMLButtonElement).click();
        return;
      case 'primary':
        e.preventDefault();
        this.primaryBtn().click();
        return;
    }
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Last input was a keyboard (focus the primary) or a pointer (no focus ring). */
let keyboardModality = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) keyboardModality = true;
  }, true);
  window.addEventListener('pointerdown', () => (keyboardModality = false), true);
}

/** Per-frame reduced-motion check without building a MediaQueryList every frame. */
let reduceMq: MediaQueryList | null | undefined;
function reducedMotion(): boolean {
  if (reduceMq === undefined) reduceMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return !!reduceMq?.matches;
}

/** Keyboard-reachable controls inside `scope`, in DOM order (hidden, inert and roving -1 ones skipped). */
function focusables(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0,
  );
}

function storageWorks(): boolean {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    const k = 'cybercity.probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function readEnv(returning: boolean): Parameters<typeof a2hsHint>[0] {
  const mm = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  let dismissed = false;
  try {
    dismissed = globalThis.localStorage?.getItem(A2HS_KEY) === '1';
  } catch {
    dismissed = true; // no storage: the tip could never stay dismissed, so skip it
  }
  let topLevel = false;
  try {
    topLevel = window.top === window;
  } catch {
    topLevel = false;
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = navigator.userAgent || '';
  return {
    coarse: mm('(pointer: coarse)'),
    standalone: mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || nav.standalone === true,
    topLevel,
    dismissed,
    ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1),
    web: location.protocol === 'https:' || location.protocol === 'http:',
    returning,
  };
}

/** Frame the developed area (or the map centre) at a tappable zoom, as the renderer does on first layout. */
function frameCity(cam: Camera, w: World): void {
  const N = w.N;
  cam.setMapSize(N);
  let x0 = N;
  let y0 = N;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const t = w.tiles[y * N + x];
      if (!t.road && t.zone === ZoneType.None && t.buildingId < 0) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  const phone = Math.min(cam.width, cam.height) < 640;
  if (x1 < 0) {
    cam.zoom = phone ? 0.9 : 1;
    cam.centerOnTile(N / 2, N / 2);
    return;
  }
  const [zmin, zmax] = phone ? [0.8, 1.0] : [0.7, 1.25];
  const ww = (x1 - x0 + 1 + (y1 - y0 + 1)) * HALF_W;
  const wh = (x1 - x0 + 1 + (y1 - y0 + 1)) * HALF_H + 120;
  const fit = Math.min(cam.width / (ww + 80), cam.height / (wh + 80));
  cam.zoom = Math.max(zmin, Math.min(zmax, fit));
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  cam.x = (cx - cy) * HALF_W;
  cam.y = (cx + cy) * HALF_H;
  cam.clamp();
}
