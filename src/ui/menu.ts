// ─────────────────────────────────────────────────────────────────────────────
// Main menu: resume / save / load / new city plus the Settings, How to Play
// and About pages (sub-views of the same dialog). Opening the menu pauses the
// simulation; closing it resumes at the previous speed.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, ZONES } from '../game/config';
import { randomCityName, randomSeed } from '../game/game';
import type { Settings } from '../game/types';
import { buildDialog, type UIContext } from './context';
import { closestData, h, setAttr, setClass, setHidden, setText } from './dom';
import { groupInt } from './format';
import { icon, type IconName } from './icons';

type View = 'main' | 'settings' | 'help' | 'about';

interface Toggle {
  key: keyof Settings;
  label: string;
  desc: string;
  icon: IconName;
}

const TOGGLES: Toggle[] = [
  { key: 'sound', label: 'Sound effects', desc: 'Synth clicks, builds and alerts', icon: 'sound' },
  { key: 'music', label: 'Music', desc: 'Slow generative synth score', icon: 'music' },
  { key: 'rain', label: 'Rain', desc: 'Passing neon downpours', icon: 'rain' },
  { key: 'dayNight', label: 'Day / night cycle', desc: 'Off keeps the city at night', icon: 'moon' },
  { key: 'events', label: 'City events', desc: 'Grid hacks, crew surges, investments', icon: 'broadcast' },
  { key: 'showFps', label: 'Show FPS', desc: 'Frame-rate readout', icon: 'gauge' },
];

const TITLES: Record<View, string> = { main: '', settings: 'Settings', help: 'How to play', about: 'About' };

export class Menu {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly views: Record<View, HTMLElement>;
  private readonly loadBtn: HTMLButtonElement;
  private readonly toggles = new Map<keyof Settings, HTMLButtonElement>();
  private readonly quality: HTMLButtonElement[] = [];
  private view: View = 'main';
  private resumeSpeed = 0;

  constructor(private readonly ctx: UIContext) {
    const d = buildDialog({ id: 'cc-menu', title: '', icon: icon('logo') });
    this.el = d.el;
    this.title = d.title;
    this.sub = d.sub;
    d.el.classList.add('cc-menu');
    this.back = h('button', { class: 'cc-iconbtn cc-menu-back', type: 'button', 'data-act': 'back', 'aria-label': 'Back', hidden: true, html: icon('back') });
    d.head.prepend(this.back);

    // ── Main ───────────────────────────────────────────────────────────────
    const item = (act: string, ico: IconName, label: string, desc: string, cls = '') =>
      h(
        'button',
        { class: `cc-menu-item ${cls}`, type: 'button', 'data-act': act },
        h('span', { class: 'cc-menu-ico', html: icon(ico) }),
        h('span', { class: 'cc-menu-text' }, h('strong', { text: label }), h('span', { text: desc })),
        h('span', { class: 'cc-menu-chev', html: icon('chevron') }),
      );
    this.loadBtn = item('load', 'load', 'Load saved city', 'Return to your last save');
    const resume = item('resume', 'play', 'Resume', 'Back to the streets', 'is-primary');
    resume.setAttribute('data-autofocus', '');
    const main = h(
      'div',
      { class: 'cc-menu-view cc-menu-list' },
      resume,
      item('save', 'save', 'Save city', 'Stored on this device'),
      this.loadBtn,
      item('new', 'newCity', 'New city', 'Fresh map, fresh charter'),
      h('div', { class: 'cc-menu-sep' }),
      item('view:settings', 'gear', 'Settings', 'Sound, music, weather, quality'),
      item('view:help', 'help', 'How to play', 'Roads, zones, power and more'),
      item('view:about', 'info', 'About', 'Credits'),
    );

    // ── Settings ───────────────────────────────────────────────────────────
    const settings = h('div', { class: 'cc-menu-view cc-settings', hidden: true });
    for (const t of TOGGLES) {
      const sw = h('button', { class: 'cc-switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'data-setting': t.key, 'aria-label': t.label }, h('i'));
      this.toggles.set(t.key, sw);
      settings.append(
        h(
          'div',
          { class: 'cc-set-row' },
          h('span', { class: 'cc-menu-ico', html: icon(t.icon) }),
          h('span', { class: 'cc-menu-text' }, h('strong', { text: t.label }), h('span', { text: t.desc })),
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
        step('pinch', '6 · Move the map', 'One finger draws with the active tool. Two fingers pan; pinch to zoom. On desktop: drag with right mouse, scroll to zoom, WASD to pan.', '#22e5ff'),
        step('data', '7 · Use data views', 'Open Data for power, land value, crime, pollution, traffic and service coverage overlays.', '#22e5ff'),
        step('star', '8 · Hit milestones', 'Population milestones pay a charter grant and unlock bigger buildings: reactors, data hubs, spires and arcologies.', '#ffb02e'),
      ),
      h('p', { class: 'cc-help-foot', text: 'Watch the treasury: taxes come in monthly, upkeep goes out. Tap your credits to open the budget.' }),
    );

    // ── About ──────────────────────────────────────────────────────────────
    const about = h(
      'div',
      { class: 'cc-menu-view cc-about', hidden: true },
      h('div', { class: 'cc-about-logo', html: icon('logo') }),
      h('div', { class: 'cc-about-name', text: 'Cyber City' }),
      h('div', { class: 'cc-about-ver', text: 'Build 0.1 · neon edition' }),
      h('p', { text: 'An original city builder set in a rain-slicked, neon-lit future. Every name, district, company and pixel was invented for this game.' }),
      h('p', { text: 'Hand-made with TypeScript, Canvas 2D and Web Audio: no image files, no sound files, no trackers. Your city is saved only on this device.' }),
      h('p', { class: 'cc-about-small', text: 'Made with care for small screens and long nights.' }),
    );

    this.views = { main, settings, help, about };
    d.body.append(main, settings, help, about);
    d.el.addEventListener('click', this.onClick);
  }

  get isOpen(): boolean {
    return this.ctx.modals.isOpen(this.el);
  }

  open(view: View = 'main'): void {
    const { game, modals } = this.ctx;
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
    setHidden(this.back, view === 'main');
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
      setText(this.sub, w.cityName);
    }
    setHidden(this.loadBtn, !game.hasSave());
    const s = game.settings;
    for (const [key, el] of this.toggles) {
      const on = !!s[key];
      setAttr(el, 'aria-checked', on ? 'true' : 'false');
      setClass(el, 'is-on', on);
    }
    for (const b of this.quality) {
      const on = b.dataset.quality === s.quality;
      setAttr(b, 'aria-checked', on ? 'true' : 'false');
      setClass(b, 'is-on', on);
    }
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
      game.updateSettings({ [key]: !game.settings[key] } as Partial<Settings>);
      return;
    }
    const q = closestData(t, 'quality', this.el);
    if (q) {
      game.updateSettings({ quality: q.dataset.quality as Settings['quality'] });
      return;
    }
    const act = closestData(t, 'act', this.el)?.dataset.act;
    if (!act) return;
    if (act === 'back') this.show('main');
    else if (act.startsWith('view:')) this.show(act.slice(5) as View);
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
    } else if (act === 'new') {
      actions.confirm({
        title: 'Found a new city',
        body: 'Your current city will be replaced. Save first if you want to come back to it.',
        confirmLabel: 'Found city',
        danger: true,
        input: { label: 'City name', value: randomCityName(randomSeed()), maxLength: 28, reroll: () => randomCityName(randomSeed()) },
        onConfirm: (name) => {
          this.resumeSpeed = 0; // newCity() sets its own speed
          game.newCity(name || undefined);
          modals.closeAll();
          game.toast(`Charter signed: welcome to ${game.world.cityName}`, 'good');
        },
      });
    }
  };
}
