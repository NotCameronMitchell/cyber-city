// ─────────────────────────────────────────────────────────────────────────────
// Main menu: resume / save / load / new city plus the Settings, How to Play
// and About pages (sub-views of the same dialog). Opening the menu pauses the
// simulation; closing it resumes at the previous speed. The start screen opens
// the sub-views on their own (open(view, true): ✕ returns to the title), sets
// onMainMenu, which adds the "Main menu" row, and onNewCity, which sends
// "New city" to its setup sheet (one New City flow).
// ─────────────────────────────────────────────────────────────────────────────

import { defaultRegion } from '../game/device';
import { cityLifeOn, crowdsOn, weatherOf, weatherPatch, WEATHER_SETTINGS, type WeatherSetting } from '../game/settings';
import { storageGet } from '../game/storage';
import { REGION_KEY, readRegion } from './start/startModel';
import { BUILDINGS, ZONES } from '../game/config';
import { randomCityName, randomSeed } from '../game/game';
import { STORY_PACES, type Settings, type StoryPace } from '../game/types';
import { buildDialog, type UIContext } from './context';
import { closestData, h, setAttr, setClass, setHidden, setText } from './dom';
import { groupInt } from './format';
import { icon, type IconName } from './icons';
import { ABOUT_SAVE_LINE, BLOCKED_TEXT, HELP_TRANSFER, TRANSFER_COPY, TRANSFER_ICONS } from './transfer';

type View = 'main' | 'settings' | 'help' | 'about';

interface Toggle {
  key: keyof Settings;
  label: string;
  desc: string;
  icon: IconName;
}

/**
 * On / off rows. Weather (Full / Light / Off) replaced the Rain toggle (MEGACITY §7.6); Crowds and City life read
 * "unknown as default" through game/settings.ts, so their switches show the effective value. City life sits right
 * after City events, each with its line, so the two are not confused.
 */
export const TOGGLES: Toggle[] = [
  { key: 'sound', label: 'Sound effects', desc: 'Clicks, builds, alerts and district sounds', icon: 'sound' },
  { key: 'music', label: 'Music', desc: 'Slow generative synth score', icon: 'music' },
  { key: 'dayNight', label: 'Day / night cycle', desc: 'Off keeps the city at night', icon: 'moon' },
  { key: 'crowds', label: 'Crowds', desc: 'People on the sidewalks, umbrellas in the rain', icon: 'pop' },
  { key: 'events', label: 'City events', desc: 'Grid hacks, crew surges, investments', icon: 'broadcast' },
  { key: 'cityLife', label: 'City life', desc: 'Night markets, lantern nights, match nights: one ticker line each', icon: 'sparkle' },
  { key: 'showFps', label: 'Show FPS', desc: 'Frame-rate readout', icon: 'gauge' },
];

/** The effective on / off value of a toggle (crowds and City life read unknown as default). */
function toggleOn(s: Settings, key: keyof Settings): boolean {
  if (key === 'crowds') return crowdsOn(s);
  if (key === 'cityLife') return cityLifeOn(s);
  return !!s[key];
}

/**
 * A toggle row as Settings shows it. Low quality turns crowds off whatever the switch says (§6.4), so at Low the Crowds
 * row reads Off, is disabled and says why; the player's choice comes back with High quality (§7.6).
 */
export function toggleRow(s: Settings, t: Pick<Toggle, 'key' | 'desc'>): { on: boolean; disabled: boolean; desc: string } {
  if (t.key === 'crowds' && s.quality === 'low') return { on: false, disabled: true, desc: 'Off at Low quality' };
  return { on: toggleOn(s, t.key), disabled: false, desc: t.desc };
}

/** Step 6's last sentence (MEGACITY §7.7, §14.3): the ? sheet lists every key. */
export const HELP_SHORTCUTS_SENTENCE = 'Press ? for every shortcut.';

/** How to play steps 15 and 16 (MEGACITY §7.7), verbatim. */
export const HELP_MEGA: readonly { title: string; body: string }[] = [
  {
    title: '15 · Grow beyond the shore',
    body: "Each chapter brings a land grant. Open the City map, pick a district next to your city and annex it. A city's region is 3×3 or 5×5 districts, chosen when you found it; a 3×3 city can grow to 5×5.",
  },
  {
    title: '16 · Bridge the towers',
    body: 'Pick Skybridge and tap a tall tower: its lanes light up. Tap a glowing partner to link them. Three linked towers make a Sky Lobby.',
  },
];

const WEATHER_LABEL: Record<WeatherSetting, string> = { full: 'Full', light: 'Light', off: 'Off' };
/** The read-only City line at the top of Settings (§7.6). */
export function cityLine(name: string, region: number): string {
  return region === 5 ? `${name} · 5×5 region · 25 districts` : region === 3 ? `${name} · 3×3 region · 9 districts` : name;
}
/** The Lower detail row's line (§7.6, a 5×5 city only). */
export const LOWER_DETAIL_DESC = 'Far districts rest, no weather or crowds, lower top speed. For big cities on phones.';

const TITLES: Record<View, string> = { main: '', settings: 'Settings', help: 'How to play', about: 'About' };

/** Story pace (docs/PACING.md): label and the one line that explains the selected pace. */
export const PACE: Record<StoryPace, { label: string; desc: string }> = {
  relaxed: { label: 'Relaxed', desc: 'Most time to build: a chapter every 20+ min, few messages' },
  normal: { label: 'Normal', desc: 'A chapter about every 15 min, a message every few minutes' },
  brisk: { label: 'Brisk', desc: 'The original pace: a chapter every 10 min, frequent messages' },
};

export class Menu {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly views: Record<View, HTMLElement>;
  private readonly loadBtn: HTMLButtonElement;
  private readonly restoreBtn: HTMLButtonElement;
  private readonly restoreDesc: HTMLElement;
  /** City transfer (§13.1): Export city (disabled while a newer build's city is stored) and Import city. */
  private readonly exportBtn: HTMLButtonElement;
  private readonly exportDesc: HTMLElement;
  private readonly growBtn: HTMLButtonElement;
  private readonly growNote: HTMLElement;
  private readonly cityRow: HTMLElement;
  private readonly toggles = new Map<keyof Settings, HTMLButtonElement>();
  /** Each toggle row's description line (the Crowds row says why it is off at Low quality). */
  private readonly toggleDesc = new Map<keyof Settings, HTMLElement>();
  private readonly quality: HTMLButtonElement[] = [];
  private readonly weather: HTMLButtonElement[] = [];
  /** The read-only City line (§7.6) and WP-9's Grow to 25 districts slot beside it (a 3×3 city). */
  private readonly cityText: HTMLElement;
  /** WP-9 mounts its "Grow to 25 districts" button here (§3.11, §7.6); WP-5 leaves it empty. */
  readonly growSlot: HTMLElement;
  private readonly lowerRow: HTMLElement;
  private readonly paces: HTMLButtonElement[] = [];
  private readonly paceDesc: HTMLElement;
  private readonly mainMenuBtn: HTMLButtonElement;
  private view: View = 'main';
  private resumeSpeed = 0;
  /** Opened straight on a sub-view from the start screen: Back closes the dialog. */
  private solo = false;
  /** Set by the start screen: the "Main menu" row saves, pauses and shows the title. */
  onMainMenu: (() => void) | null = null;
  /** Set by the start screen: "New city" opens its setup sheet (name, story pace, backup note). */
  onNewCity: (() => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    const d = buildDialog({ id: 'cc-menu', title: '', icon: icon('logo') });
    this.el = d.el;
    this.title = d.title;
    this.sub = d.sub;
    d.el.classList.add('cc-menu');
    this.back = h('button', { class: 'cc-iconbtn cc-menu-back', type: 'button', 'data-act': 'back', 'aria-label': 'Back', hidden: true, html: icon('back') });
    d.head.prepend(this.back);

    // ── Main ───────────────────────────────────────────────────────────────
    const item = (act: string, ico: IconName | { html: string }, label: string, desc: string, cls = '') =>
      h(
        'button',
        { class: `cc-menu-item ${cls}`, type: 'button', 'data-act': act },
        h('span', { class: 'cc-menu-ico', html: typeof ico === 'string' ? icon(ico) : ico.html }),
        h('span', { class: 'cc-menu-text' }, h('strong', { text: label }), h('span', { text: desc })),
        h('span', { class: 'cc-menu-chev', html: icon('chevron') }),
      );
    this.loadBtn = item('load', 'load', 'Load saved city', 'Return to your last save');
    this.restoreBtn = item('restore', 'back', 'Restore previous city', 'The city New City replaced');
    this.restoreDesc = this.restoreBtn.querySelector('.cc-menu-text span') as HTMLElement;
    this.exportBtn = item('export', { html: TRANSFER_ICONS.export }, TRANSFER_COPY.exportRow.label, TRANSFER_COPY.exportRow.desc);
    this.exportDesc = this.exportBtn.querySelector('.cc-menu-text span') as HTMLElement;
    const importBtn = item('import', { html: TRANSFER_ICONS.import }, TRANSFER_COPY.importRow.label, TRANSFER_COPY.importRow.desc);
    this.mainMenuBtn = item('mainmenu', 'logo', 'Main menu', 'Save and go to the title screen');
    const resume = item('resume', 'play', 'Resume', 'Back to the streets', 'is-primary');
    resume.setAttribute('data-autofocus', '');
    const main = h(
      'div',
      { class: 'cc-menu-view cc-menu-list' },
      resume,
      item('save', 'save', 'Save city', 'Stored on this device'),
      this.loadBtn,
      item('new', 'newCity', 'New city', 'Fresh map, fresh charter'),
      this.restoreBtn,
      this.exportBtn,
      importBtn,
      this.mainMenuBtn,
      h('div', { class: 'cc-menu-sep' }),
      item('view:settings', 'gear', 'Settings', 'Story pace, weather, crowds, quality'),
      item('view:help', 'help', 'How to play', 'Roads, zones, power, the story'),
      item('view:about', 'info', 'About', 'Credits'),
    );

    // ── Settings ───────────────────────────────────────────────────────────
    const settings = h('div', { class: 'cc-menu-view cc-settings', hidden: true });
    // The City line (§7.6): which size the city is, read-only; WP-9's Grow button goes in growSlot on a 3×3 city.
    this.cityText = h('span');
    this.growSlot = h('span', { class: 'cc-set-growslot', 'data-slot': 'grow' });
    // Grow to 25 districts (§3.11, §7.6): a 44 px button on a 3×3 city, disabled with its line while saveBlocked.
    this.growBtn = h('button', { class: 'cc-btn cc-set-grow', type: 'button', 'data-act': 'grow', html: TRANSFER_ICONS.grow }, TRANSFER_COPY.grow);
    this.growNote = h('span', { class: 'cc-set-grownote', hidden: true, text: BLOCKED_TEXT });
    this.cityRow = h(
      'div',
      { class: 'cc-set-row cc-set-city' },
      h('span', { class: 'cc-menu-ico', html: icon('map') }),
      h('span', { class: 'cc-menu-text' }, h('strong', { text: 'City' }), this.cityText),
      this.growSlot,
    );
    settings.append(this.cityRow);
    // Story pace first: it is the setting that changes how the game feels most. Applies at once.
    const paceSeg = h('div', { class: 'cc-seg cc-seg-pace', role: 'radiogroup', 'aria-label': 'Story pace' });
    for (const p of STORY_PACES) {
      const b = h('button', { class: 'cc-seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-pace': p, text: PACE[p].label });
      this.paces.push(b);
      paceSeg.append(b);
    }
    this.paceDesc = h('span', { class: 'cc-set-pace-desc' });
    settings.append(
      h(
        'div',
        { class: 'cc-set-row is-stack' },
        h('span', { class: 'cc-menu-ico', html: icon('comms') }),
        h('span', { class: 'cc-menu-text' }, h('strong', { text: 'Story pace' }), this.paceDesc),
        paceSeg,
      ),
    );
    // Weather (§7.6, §6.4): Full / Light / Off, replacing the Rain toggle.
    const wseg = h('div', { class: 'cc-seg cc-seg-weather', role: 'radiogroup', 'aria-label': 'Weather' });
    for (const w of WEATHER_SETTINGS) {
      const b = h('button', { class: 'cc-seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-weather': w, text: WEATHER_LABEL[w] });
      this.weather.push(b);
      wseg.append(b);
    }
    settings.append(
      h(
        'div',
        { class: 'cc-set-row is-stack' },
        h('span', { class: 'cc-menu-ico', html: icon('rain') }),
        h('span', { class: 'cc-menu-text' }, h('strong', { text: 'Weather' }), h('span', { text: 'Rain, storms and morning fog. Light is gentler.' })),
        wseg,
      ),
    );
    for (const t of TOGGLES) {
      const sw = h('button', { class: 'cc-switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'data-setting': t.key, 'aria-label': t.label }, h('i'));
      this.toggles.set(t.key, sw);
      const desc = h('span', { text: t.desc });
      this.toggleDesc.set(t.key, desc);
      settings.append(
        h(
          'div',
          { class: 'cc-set-row' },
          h('span', { class: 'cc-menu-ico', html: icon(t.icon) }),
          h('span', { class: 'cc-menu-text' }, h('strong', { text: t.label }), desc),
          sw,
        ),
      );
    }
    const seg = h('div', { class: 'cc-seg', role: 'radiogroup', 'aria-label': 'Render quality' });
    for (const q of ['low', 'high'] as const) {
      const b = h('button', { class: 'cc-seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-quality': q, text: q === 'low' ? 'Low' : 'High' });
      this.quality.push(b);
      seg.append(b);
    }
    settings.append(
      h(
        'div',
        { class: 'cc-set-row' },
        h('span', { class: 'cc-menu-ico', html: icon('sparkle') }),
        h('span', { class: 'cc-menu-text' }, h('strong', { text: 'Quality' }), h('span', { text: 'Low saves battery on older phones' })),
        seg,
      ),
    );
    // Lower detail (§7.6, §3.11): a 5×5 city only.
    const lowerSw = h('button', { class: 'cc-switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'data-setting': 'lowerDetail', 'aria-label': 'Lower detail' }, h('i'));
    this.toggles.set('lowerDetail', lowerSw);
    this.lowerRow = h(
      'div',
      { class: 'cc-set-row', hidden: true },
      h('span', { class: 'cc-menu-ico', html: icon('gauge') }),
      h('span', { class: 'cc-menu-text' }, h('strong', { text: 'Lower detail' }), h('span', { text: LOWER_DETAIL_DESC })),
      lowerSw,
    );
    settings.append(this.lowerRow);

    // ── How to play ────────────────────────────────────────────────────────
    const step = (ico: IconName, title: string, body: string, accent = '#22e5ff', extra?: string) => {
      const el = h(
        'li',
        { class: 'cc-help-step' },
        h('span', { class: 'cc-help-ico', html: extra ?? icon(ico) }),
        h('span', { class: 'cc-help-text' }, h('strong', { text: title }), h('span', { text: body })),
      );
      el.style.setProperty('--accent', accent);
      return el;
    };
    const help = h(
      'div',
      { class: 'cc-menu-view cc-help', hidden: true },
      h(
        'ol',
        { class: 'cc-help-list' },
        step('road', '1 · Lay roads', 'Pick Road and drag across the map. Everything grows along streets; bridges can cross water.', '#c8d0f0'),
        step(
          'zones',
          '2 · Paint zones',
          `${ZONES.res.name} (R) house people, ${ZONES.com.name} (C) and ${ZONES.ind.name} (I) give them jobs. Zone within 3 tiles of a road.`,
          ZONES.res.color,
        ),
        step('power', '3 · Switch on power', `A ${BUILDINGS.solar.name} touching your roads or zones lights them up. Power flows along roads and buildings.`, '#4dff9a'),
        step('services', '4 · Add services', 'Plazas raise land value, precincts cut crime, clinics speed up growth. Tap a building to see its reach.', '#3d7bff'),
        step(
          'chart',
          '5 · Read demand',
          'The R · C · I bars in the top bar show what the city wants. Bars up: build more of it. Bars down: hold off.',
          '#ff2bd6',
          '<span class="cc-help-rci" aria-hidden="true"><i class="is-r"></i><i class="is-c"></i><i class="is-i"></i></span>',
        ),
        // MEGACITY §14.3: step 6's desktop sentence ends with the ? sheet (WP-9).
        step('pinch', '6 · Move the map', `One finger draws with the active tool. Two fingers pan; pinch to zoom. On desktop: drag with right mouse, scroll to zoom, WASD to pan. ${HELP_SHORTCUTS_SENTENCE}`, '#22e5ff'),
        step('data', '7 · Use data views', 'Open Data for wealth, land value, traffic, noise, power, crime, pollution and service coverage.', '#22e5ff'),
        // EXPANSION §7.6: two steps after step 7; the later steps renumber.
        step('avenue', '8 · Grow your roads', 'Avenues and Highways carry more traffic. Cross a highway with a street for on-ramps. Back alleys keep homes cheap.', '#6f9bff'),
        step('tiers', '9 · Read wealth', 'Blocks turn $, $$ or $$$ by themselves: land value, schools, transit and quiet lift them; noise, crime and alleys hold them back. Data → Wealth shows it.', '#ffd84d'),
        step('star', '10 · Hit milestones', 'Population milestones pay a bonus and unlock bigger buildings: reactors, data hubs, spires and arcologies.', '#ffb02e'),
        step('flag', '11 · Follow the chapter', "Once the story starts, the chip above the toolbar shows the chapter goals. Tap it for the list, what's happening, the story so far and a glossary (?).", '#ffb02e'),
        step('comms', '12 · Read messages', 'Story messages and faction cards arrive with a banner and wait for you; the game keeps running. Tap to read. The chapter goes on once its messages are read; faction cards take their default answer when the ring runs out.', '#22e5ff'),
        step('eye', '13 · Read the choices', 'Under each choice, a line says what it does: "Basalt ++" means Basalt will like it, Trace is how close anyone is to finding you. Hold a choice for the exact effects. Tap a speaker to see who they are.', '#ff2bd6'),
        step('clock', '14 · Set the story pace', 'Settings › Story pace: Relaxed (the default) leaves the most time to build between chapters; Brisk is the quickest.', '#ffb02e'),
        // MEGACITY §7.7: two steps after the fourteen (WP-9 adds 17).
        step('map', HELP_MEGA[0].title, HELP_MEGA[0].body, '#ffd84d'),
        step('skybridge', HELP_MEGA[1].title, HELP_MEGA[1].body, '#8fe3ff'),
        // MEGACITY §7.7, §13.6: step 17 (WP-9).
        step('save', HELP_TRANSFER.title, HELP_TRANSFER.body, '#22e5ff', TRANSFER_ICONS.export),
      ),
      h('p', { class: 'cc-help-foot', text: 'Watch the treasury: taxes come in monthly, upkeep goes out. Tap your credits to open the budget.' }),
      // §14.3: the ? sheet from How to play, shown on the desktop layout only (ui.css .cc-help-keys).
      h(
        'button',
        { class: 'cc-menu-item cc-help-keys', type: 'button', 'data-act': 'shortcuts' },
        h('span', { class: 'cc-menu-ico', html: icon('key') }),
        h('span', { class: 'cc-menu-text' }, h('strong', { text: 'Keyboard shortcuts' }), h('span', { text: 'Every key, in one list. Or press ?' })),
      ),
    );

    // ── About ──────────────────────────────────────────────────────────────
    const about = h(
      'div',
      { class: 'cc-menu-view cc-about', hidden: true },
      h('div', { class: 'cc-about-logo', html: icon('logo') }),
      h('div', { class: 'cc-about-name', text: 'Cyber City' }),
      h('div', { class: 'cc-about-ver', text: 'Build 0.1 · neon edition' }),
      h('p', { text: 'An original city builder set in a rain-slicked, neon-lit future. Every name, district, company and pixel was invented for this game.' }),
      h('p', { text: `Hand-made with TypeScript, Canvas 2D and Web Audio: no image files, no sound files, no trackers. ${ABOUT_SAVE_LINE}` }),
      h('p', { class: 'cc-about-small', text: 'Made with care for small screens and long nights.' }),
    );

    this.views = { main, settings, help, about };
    d.body.append(main, settings, help, about);
    d.el.addEventListener('click', this.onClick);
  }

  get isOpen(): boolean {
    return this.ctx.modals.isOpen(this.el);
  }

  /** `solo`: from the start screen, on one sub-view only (Back and ✕ return to the title). */
  open(view: View = 'main', solo = false): void {
    const { game, modals } = this.ctx;
    this.solo = solo && view !== 'main';
    if (!this.isOpen) {
      this.resumeSpeed = game.speed;
      if (game.speed > 0) game.setSpeed(0);
    }
    this.show(view);
    modals.open(this.el, () => this.onClosed());
  }

  private onClosed(): void {
    const { game } = this.ctx;
    if (game.speed === 0 && this.resumeSpeed > 0) game.setSpeed(this.resumeSpeed);
    this.resumeSpeed = 0;
  }

  private show(view: View): void {
    this.view = view;
    for (const k of Object.keys(this.views) as View[]) setHidden(this.views[k], k !== view);
    // Solo (from the title): ✕ is the only way back, so no second, identical chevron.
    setHidden(this.back, view === 'main' || this.solo);
    setClass(this.el, 'is-sub', view !== 'main');
    this.refresh();
    this.views[view].scrollTop = 0;
  }

  /** Header + settings state (also on 'settings' / 'stats'). */
  refresh(): void {
    const { game } = this.ctx;
    const w = game.world;
    if (this.view === 'main') {
      setText(this.title, w.cityName);
      setText(this.sub, `${w.dateLabel()} · ${groupInt(w.stats.population)} residents · Paused`);
    } else {
      setText(this.title, TITLES[this.view]);
      setText(this.sub, this.solo ? '' : w.cityName);
    }
    setHidden(this.mainMenuBtn, !this.onMainMenu);
    setHidden(this.loadBtn, !game.hasSave());
    // WP-C's backup slot: guarded so an older Game without it simply hides the row.
    const g = game as typeof game & { hasPreviousSave?: () => boolean; previousSaveInfo?: () => { cityName: string; maxPopulation: number } | null };
    const canRestore = !!g.hasPreviousSave?.();
    setHidden(this.restoreBtn, !canRestore);
    if (canRestore) {
      const info = g.previousSaveInfo?.();
      setText(this.restoreDesc, info?.cityName ? `${info.cityName} · peak ${groupInt(info.maxPopulation)} residents` : 'The city New City replaced');
    }
    const s = game.settings;
    for (const [key, el] of this.toggles) {
      const t = TOGGLES.find((x) => x.key === key);
      const row = t ? toggleRow(s, t) : { on: toggleOn(s, key), disabled: false, desc: '' };
      setAttr(el, 'aria-checked', row.on ? 'true' : 'false');
      setAttr(el, 'aria-disabled', row.disabled ? 'true' : 'false');
      setClass(el, 'is-on', row.on);
      setClass(el, 'is-off', row.disabled);
      const d = this.toggleDesc.get(key);
      if (d && t) setText(d, row.desc);
    }
    const weather = weatherOf(s);
    for (const b of this.weather) {
      const on = b.dataset.weather === weather;
      setAttr(b, 'aria-checked', on ? 'true' : 'false');
      setClass(b, 'is-on', on);
    }
    setText(this.cityText, cityLine(w.cityName, w.region));
    // Grow (§3.11): only a 3×3 city; disabled while this device holds a newer build's city.
    const grow = w.region === 3;
    if (grow !== (this.growSlot.firstChild !== null)) {
      if (grow) this.growSlot.append(this.growBtn, this.growNote);
      else this.growSlot.textContent = '';
    }
    setClass(this.cityRow, 'has-grow', grow);
    if (grow) {
      this.growBtn.disabled = game.saveBlocked;
      setHidden(this.growNote, !game.saveBlocked);
    }
    // Export (§13.1): disabled while blocked, with the reason as its line.
    setAttr(this.exportBtn, 'aria-disabled', game.saveBlocked ? 'true' : 'false');
    setClass(this.exportBtn, 'is-disabled', game.saveBlocked);
    setText(this.exportDesc, game.saveBlocked ? BLOCKED_TEXT : TRANSFER_COPY.exportRow.desc);
    setHidden(this.lowerRow, w.region !== 5);
    for (const b of this.quality) {
      const on = b.dataset.quality === s.quality;
      setAttr(b, 'aria-checked', on ? 'true' : 'false');
      setClass(b, 'is-on', on);
    }
    for (const b of this.paces) {
      const on = b.dataset.pace === s.storyPace;
      setAttr(b, 'aria-checked', on ? 'true' : 'false');
      setClass(b, 'is-on', on);
    }
    setText(this.paceDesc, PACE[s.storyPace]?.desc ?? PACE.relaxed.desc);
  }

  private readonly onClick = (e: MouseEvent) => {
    const { game, modals, actions } = this.ctx;
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) {
      modals.close(this.el);
      return;
    }
    const setting = closestData(t, 'setting', this.el);
    if (setting) {
      const key = setting.dataset.setting as keyof Settings;
      // A disabled row (Crowds at Low quality) keeps the player's choice for High.
      if (setting.getAttribute('aria-disabled') === 'true') return;
      game.updateSettings({ [key]: !toggleOn(game.settings, key) } as Partial<Settings>);
      return;
    }
    const wb = closestData(t, 'weather', this.el);
    if (wb) {
      // `rain` is still written (weather !== 'off') for older builds (game/settings.ts weatherPatch).
      game.updateSettings(weatherPatch(wb.dataset.weather as WeatherSetting));
      return;
    }
    const q = closestData(t, 'quality', this.el);
    if (q) {
      game.updateSettings({ quality: q.dataset.quality as Settings['quality'] });
      return;
    }
    const pace = closestData(t, 'pace', this.el);
    if (pace) {
      game.updateSettings({ storyPace: pace.dataset.pace as StoryPace });
      this.refresh();
      return;
    }
    const act = closestData(t, 'act', this.el)?.dataset.act;
    if (!act) return;
    if (act === 'back') {
      if (this.solo) modals.close(this.el);
      else this.show('main');
    } else if (act === 'shortcuts') {
      // The ? sheet (§14.3): a side panel beside the city, so the menu closes first.
      modals.closeAll();
      actions.openShortcuts();
    } else if (act === 'mainmenu') {
      const go = this.onMainMenu;
      this.resumeSpeed = 0; // the start screen holds the game; Continue resumes at 1×
      modals.closeAll();
      go?.();
    } else if (act.startsWith('view:')) this.show(act.slice(5) as View);
    else if (act === 'resume') modals.close(this.el);
    else if (act === 'save') {
      const ok = game.save();
      game.toast(ok ? 'City saved' : 'Saving unavailable in this browser', ok ? 'good' : 'error');
      if (ok) this.ctx.sfx('money');
      this.refresh();
    } else if (act === 'load') {
      actions.confirm({
        title: 'Load saved city?',
        body: 'Anything since your last save will be lost.',
        confirmLabel: 'Load',
        onConfirm: () => {
          const ok = game.load();
          game.toast(ok ? `Welcome back to ${game.world.cityName}` : 'That save could not be read', ok ? 'good' : 'error');
          if (ok) modals.closeAll();
        },
      });
    } else if (act === 'restore') {
      const g = game as typeof game & { loadPrevious?: () => boolean; previousSaveInfo?: () => { cityName: string } | null };
      const name = g.previousSaveInfo?.()?.cityName || 'the previous city';
      actions.confirm({
        title: 'Restore previous city?',
        body: `Swap back to ${name}. This city moves into the backup slot, so you can swap again.`,
        confirmLabel: 'Restore',
        onConfirm: () => {
          const ok = !!g.loadPrevious?.();
          // A refused swap (no room for a copy, or for the restored city) has already said why, with Export.
          if (ok || (game.keepCopyFailed === null && !game.lastSaveFailed)) game.toast(ok ? `Welcome back to ${game.world.cityName}` : 'The previous city could not be read', ok ? 'good' : 'error');
          if (ok) {
            this.resumeSpeed = 0;
            modals.closeAll();
          } else if (game.keepCopyFailed !== null || game.lastSaveFailed) modals.closeAll(); // its Export toast shows over the city
        },
      });
    } else if (act === 'export') {
      if (game.saveBlocked) return;
      actions.openTransfer('export');
    } else if (act === 'import') actions.openTransfer('import');
    else if (act === 'grow') {
      if (game.canGrow) actions.growRegion('settings');
    } else if (act === 'new' && this.onNewCity) {
      const go = this.onNewCity;
      this.resumeSpeed = 0; // the start screen holds the game; Continue or Found city resumes at 1×
      modals.closeAll();
      go();
    } else if (act === 'new') {
      actions.confirm({
        title: 'Found a new city',
        body: 'Your current city moves to the backup slot: "Restore previous city" in this menu brings it back.',
        confirmLabel: 'Found city',
        danger: true,
        input: { label: 'City name', value: randomCityName(randomSeed()), maxLength: 24, reroll: () => randomCityName(randomSeed()) },
        onConfirm: (name) => {
          this.resumeSpeed = 0; // newCity() sets its own speed
          // The region last chosen on this device's New City sheet, else the device default (MEGACITY §7.9).
          game.newCity(name || undefined, undefined, readRegion(storageGet(REGION_KEY)) ?? defaultRegion());
          modals.closeAll();
          // No room to keep a copy of this city: nothing changed and the Export toast says so (§3.10).
          if (game.keepCopyFailed === null) game.toast(`Charter signed: welcome to ${game.world.cityName}`, 'good');
        },
      });
    }
  };
}
