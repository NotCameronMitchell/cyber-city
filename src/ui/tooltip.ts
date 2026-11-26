// ─────────────────────────────────────────────────────────────────────────────
// Hover tooltips (docs/MEGACITY.md §14.2).
//
// Never on touch: only for a mouse (pointerType 'mouse') while (hover: hover)
// matches. A touch or pen event hides any tooltip and suppresses them until the
// next mouse move. None while a button is held, a drag or a pinch is under way
// (input's hoverBus.busy), a plan waits for ✓, or a modal dialog is open.
//
// Timing (TipClock): 450 ms over the same target, 150 ms when moving to another
// toolbar button or tray card within a second of the last tooltip; hidden at
// once on leave, wheel, key press or click; one at a time.
//
// Targets: the toolbar buttons, the tray cards, the HUD (DOM, delegated on the
// UI root, with aria-describedby), and the map (input.ts' hover pick through
// hoverBus: a building, a zone tile or parcel, a road, skyway or skybridge
// tube, a locked district, a City map slot). Content comes from the same
// tables the game reads (BUILDINGS, ZONES, ROAD_KINDS, getTileInfo,
// districtView), built only when the target changes.
// ─────────────────────────────────────────────────────────────────────────────

import { lockedReason } from '../game/actions';
import { BUILDINGS, DISTRICTS, LOW_DETAIL, ROAD_KINDS, SKYBRIDGE, ZONES, isBuildingTool, isZoneTool } from '../game/config';
import type { Game } from '../game/game';
import type { ServiceEffect, ToolId } from '../game/types';
import { hoverBus, type HoverPick } from '../input/input';
import type { UIContext } from './context';
import { h, setText } from './dom';
import { abbr, credits, groupInt, signed } from './format';
import { cardKey, categoryKey } from './shortcuts';
import { CATEGORIES, cardState, categoryChrome, livePrice, toolMeta, traySections, type CategoryId } from './tools';

/** Show after this long over the same target (ms). */
export const TIP_DELAY_MS = 450;
/** …or this long when moving to another toolbar button or tray card within TIP_WARM_WINDOW_MS of the last tooltip. */
export const TIP_WARM_MS = 150;
export const TIP_WARM_WINDOW_MS = 1000;
/** A map tooltip sits this far right of and below the cursor. */
export const TIP_MAP_DX = 16;
export const TIP_MAP_DY = 20;
/** Widest tooltip (px). */
export const TIP_MAX_W = 280;
/** Rich tooltips on: a pointer that hovers (§14.2). Watched live by the UI root (touch devices never match). */
export const TIP_QUERY = '(hover: hover)';

/** A tooltip's text: a title line and up to a few short lines under it. */
export interface TipContent {
  title: string;
  lines: string[];
}

// ── Timing (pure, tested) ────────────────────────────────────────────────────

/**
 * The tooltip clock (§14.2): which target the mouse rests on, since when, and whether the next tooltip is "warm" (a
 * toolbar button or tray card within a second of the last tooltip of that kind).
 */
export class TipClock {
  /** The hovered target (null: none). */
  key: string | null = null;
  showing = false;
  private at = 0;
  private delay = TIP_DELAY_MS;
  private lastEnd = -Infinity;
  private lastWarm = false;
  /** A click, wheel or key dismissed this target: it waits for the pointer to move to another one. */
  private dismissed: string | null = null;

  /** The mouse now rests on `key` (null: nothing with a tooltip). `warmable`: a toolbar button or a tray card. */
  hover(key: string | null, now: number, warmable: boolean): void {
    if (key !== this.dismissed) this.dismissed = null;
    if (key === this.key) return;
    const warm = warmable && this.lastWarm && (this.showing || now - this.lastEnd <= TIP_WARM_WINDOW_MS);
    this.end(now);
    this.key = key === this.dismissed ? null : key;
    this.at = now;
    this.delay = warm ? TIP_WARM_MS : TIP_DELAY_MS;
  }

  /** Should the tooltip show now? */
  due(now: number): boolean {
    return this.key !== null && !this.showing && now - this.at >= this.delay;
  }

  /** The delay the current target waits (450, or 150 warm). */
  get wait(): number {
    return this.delay;
  }

  shown(warmable: boolean): void {
    this.showing = true;
    this.lastWarm = warmable;
  }

  /** The tooltip hid (leave, or the target changed). */
  end(now: number): void {
    if (!this.showing) return;
    this.showing = false;
    this.lastEnd = now;
  }

  /** A click, wheel or key press: hide now; this target stays quiet until the pointer moves to another one. */
  dismiss(now: number): void {
    this.end(now);
    if (this.key) this.dismissed = this.key;
    this.key = null;
  }

  /** Touch, pen, a held button, a drag: hide and forget the target (no warm start after it). */
  reset(): void {
    this.showing = false;
    this.key = null;
    this.lastEnd = -Infinity;
  }
}

// ── Content (pure, tested) ───────────────────────────────────────────────────

const EFFECT_NAME: Record<ServiceEffect, string> = {
  security: 'Safety',
  health: 'Health',
  net: 'Data',
  park: 'Parks',
  transit: 'Transit',
  prestige: 'Prestige',
  education: 'Learning',
  resilience: 'Flood guard',
  filter: 'Clean air',
};

/** What a toolbar button holds, in words (§14.2: "Hab Blocks, Market Strip, Fab Yards"). */
const CATEGORY_HOLDS: Partial<Record<CategoryId, string>> = {
  inspect: 'Click anything on the map to see it',
  bulldoze: 'Clear roads, zones and buildings',
  data: 'The City map and the data views',
};

/** A toolbar button: its name and key ("Zones · Z X C") and what it holds. */
export function toolbarTip(cat: CategoryId, game: Game): TipContent {
  const c = CATEGORIES.find((x) => x.id === cat)!;
  const w = game.world;
  const label = categoryChrome(c, w.maxPopulation).label;
  const key = cat === 'zones' ? ['res', 'com', 'ind'].map((t) => cardKey(t)).join(' ') : categoryKey(cat);
  let holds = CATEGORY_HOLDS[cat] ?? '';
  if (!holds) {
    const secs = traySections(w, cat);
    if (secs.length >= 2) holds = secs.map((s) => s.section.label).join(', ');
    else {
      const items = (secs[0]?.cards ?? c.items ?? []).filter((t) => cardState(w, t) !== 'hidden');
      holds = items.map((t) => toolMeta(t).name).join(', ');
    }
  }
  if (cat === 'road') holds = `Street now; ${holds}`;
  return { title: key ? `${label} · ${key}` : label, lines: holds ? [holds] : [] };
}

/** A tray card: name and key, cost, the key numbers, and the locked reason when locked (§14.2). */
export function cardTip(tool: ToolId, game: Game): TipContent {
  const w = game.world;
  const m = toolMeta(tool);
  const key = cardKey(tool);
  const lines: string[] = [];
  const price = livePrice(game, tool);
  const road = ROAD_KINDS.find((r) => r.tool === tool);
  if (isZoneTool(tool)) {
    const z = ZONES[tool];
    lines.push(`${credits(price)} a tile`);
    lines.push(`Up to ${groupInt(z.capacity[3])} ${tool === 'res' ? 'residents' : 'jobs'} a tile`);
  } else if (road) {
    lines.push(`${credits(price)} a tile · bridges ${road.bridgeCost !== null ? credits(road.bridgeCost) : 'none'}`);
    lines.push(`Upkeep ${road.upkeep} CR a tile a month`);
    if (road.meta) lines.push(road.meta);
  } else if (isBuildingTool(tool)) {
    const b = BUILDINGS[tool];
    lines.push(credits(price));
    const nums: string[] = [];
    if (b.powerSupply) nums.push(`${groupInt(b.powerSupply)} MW`);
    else if (b.powerUse) nums.push(`uses ${groupInt(b.powerUse)} MW`);
    if (b.upkeep) nums.push(`${groupInt(b.upkeep)} CR a month`);
    if (nums.length) lines.push(nums.join(' · '));
    const people: string[] = [];
    if (b.residents) people.push(`${abbr(b.residents)} residents`);
    if (b.jobs) people.push(`${abbr(b.jobs)} jobs`);
    if (people.length) lines.push(people.join(' · '));
    const fx: string[] = [];
    if (b.effect && b.radius) fx.push(`${EFFECT_NAME[b.effect]} r${b.radius}`);
    fx.push(`${b.size}×${b.size}`);
    lines.push(fx.join(' · '));
  } else if (tool === 'skybridge') {
    lines.push(`from ${credits(price)}`);
    lines.push(`Links two tall towers ${SKYBRIDGE.minGap} to ${SKYBRIDGE.maxGap} tiles apart`);
  } else {
    lines.push(m.perTile ? `${credits(price)} a tile` : credits(price));
  }
  const locked = lockedReason(w, tool);
  if (locked) lines.push(locked.replace(/^Locked:\s*/, ''));
  return { title: key ? `${m.name} · ${key}` : m.name, lines };
}

/** The HUD's targets. */
export type HudTip = 'funds' | 'pop' | 'rci' | 'speed0' | 'speed1' | 'speed2' | 'speed3' | 'menu' | 'map';

const DEMAND_WORD = (v: number): string => (v > 0.5 ? 'booming' : v > 0.15 ? 'rising' : v > -0.15 ? 'steady' : v > -0.5 ? 'falling' : 'glut');

/** The HUD (§14.2): the treasury, the population, the demand words, the speed buttons, the menu, the City map. */
export function hudTip(kind: HudTip, game: Game): TipContent {
  const w = game.world;
  const s = w.stats;
  switch (kind) {
    case 'funds': {
      const net = Math.round(w.budget.income - w.budget.expenses);
      return { title: 'Treasury', lines: [`${signed(net)} CR a month`, 'Click for the budget'] };
    }
    case 'pop':
      return { title: `${abbr(s.population)} residents`, lines: [`${abbr(s.jobsCom + s.jobsInd)} jobs`, 'Click for the report'] };
    case 'rci':
      return {
        title: 'Demand',
        lines: [`${ZONES.res.name}: ${DEMAND_WORD(s.demand.res)}`, `${ZONES.com.name}: ${DEMAND_WORD(s.demand.com)}`, `${ZONES.ind.name}: ${DEMAND_WORD(s.demand.ind)}`],
      };
    case 'speed0':
      return { title: 'Pause · Space', lines: [] };
    case 'speed1':
    case 'speed2':
    case 'speed3': {
      const n = Number(kind.charAt(5));
      const name = ['', 'Normal', 'Fast', 'Fastest'][n];
      const cap = game.lowerDetail ? ` · ${LOW_DETAIL.maxDaysPerSec} days a second` : '';
      return { title: `${name} · ${n}${cap}`, lines: [] };
    }
    case 'menu':
      return { title: 'Menu', lines: [] };
    case 'map':
      return { title: 'City map · M', lines: [] };
  }
}

/** A district's display name at slot `s` (a 5×5 repeat by its variant's name). */
function districtName(game: Game, s: number): string {
  const w = game.world;
  const kind = w.districts.kinds[s];
  const def = kind ? DISTRICTS[kind] : undefined;
  if (!def) return '';
  const v = w.variantOf(s);
  return (v > 0 ? def.variants[v - 1]?.name : undefined) ?? def.name;
}

/** Traffic in words: a road tile's load. */
function trafficWord(pct: number): string {
  return pct >= 85 ? 'jammed' : pct >= 55 ? 'busy' : pct >= 20 ? 'steady' : 'quiet';
}

/** A slot on the City map or a locked district in the city: name, state, price or grant, an owned district's census. */
export function slotTip(game: Game, slot: number): TipContent | null {
  const v = game.districtView().slots.find((x) => x.slot === slot);
  if (!v) return null;
  const lines: string[] = [];
  if (v.state === 'owned') {
    lines.push('Part of the city');
    if (v.census) lines.push(`${abbr(v.census.residents)} residents · ${abbr(v.census.jobs)} jobs`);
  } else if (v.state === 'candidate') {
    lines.push(v.price.grants > 0 && game.world.districts.grants > 0 ? 'Annex with a land grant' : 'Next to the city');
    if (v.price.text) lines.push(v.price.text);
  } else if (v.state === 'notAdjacent') lines.push('Not next to the city yet');
  else lines.push('Still flooded: opens later');
  return { title: v.name, lines };
}

/**
 * The map under the cursor (§14.2): a building, a zone tile or parcel, a road, skyway or skybridge tube, a locked
 * district (whose click opens the City map), a City map slot. Null where there is nothing to say (open water, open
 * ground). Runs only when the target changes.
 */
export function mapTip(game: Game, p: HoverPick): TipContent | null {
  const w = game.world;
  if (p.mapView) return p.slot >= 0 ? slotTip(game, p.slot) : null;
  if (!w.inBounds(p.x, p.y)) return null;
  if (!w.isOwned(p.x, p.y)) {
    const t = slotTip(game, w.slotAt(p.x, p.y));
    return t ? { title: t.title, lines: [...t.lines.slice(0, 2), 'Click to open the City map'] } : null;
  }
  const many = w.districts.owned.length > 1;
  const place = many ? districtName(game, w.slotAt(p.x, p.y)) : '';
  if (p.link !== undefined) {
    const info = game.linkInfo(p.link);
    if (!info) return null;
    const pick = info.rows.filter(([k]) => k === 'Walkers' || k === 'Lobby').slice(0, 2);
    return { title: info.title, lines: [...pick.map(([k, v]) => `${k} ${v}`), 'Click for details'] };
  }
  const t = w.tileAt(p.x, p.y)!;
  const info = game.getTileInfo(p.x, p.y, !!p.sky);
  if (!info) return null;
  if (p.sky) {
    const load = info.rows.find(([k]) => k === 'Load')?.[1] ?? '';
    return { title: `Skyway · ${trafficWord(parseInt(load, 10) || 0)}`, lines: [] };
  }
  if (t.buildingId >= 0) {
    const want = ['Output', 'Power', 'Jobs', 'Residents', 'Upkeep', 'Stage'];
    const rows = want.map((k) => info.rows.find(([l]) => l === k)).filter((r): r is [string, string] => !!r).slice(0, 3);
    return { title: place ? `${info.title} · ${place}` : info.title, lines: [...rows.map(([k, v]) => `${k} ${v}`), 'Click for details'] };
  }
  if (t.road) {
    const traffic = info.rows.find(([k]) => k === 'Traffic')?.[1] ?? '';
    return { title: `${info.title} · ${trafficWord(parseInt(traffic, 10) || 0)}`, lines: place ? [place] : [] };
  }
  if (t.zone) {
    const lines: string[] = [];
    const developed = t.level > 0 && !t.abandoned;
    const title = developed ? info.subtitle : `${info.title} · ${info.rows.find(([k]) => k === 'Status')?.[1] ?? ''}`;
    const parcel = info.notes?.find((n) => n.text.startsWith('Part of a '));
    const heads = parcel ? parcel.text.replace(/^Part of a /, '') : (() => {
      const r = info.rows.find(([k]) => k === 'Residents' || k === 'Jobs');
      return r ? `${r[1]} ${r[0].toLowerCase()}` : '';
    })();
    if (heads) lines.push(heads.charAt(0).toUpperCase() + heads.slice(1));
    const wealth = info.rows.find(([k]) => k === 'Wealth')?.[1];
    if (wealth) lines.push(`Wealth ${wealth}`);
    const lv = info.rows.find(([k]) => k === 'Land value')?.[1];
    if (lv) lines.push(`Land value ${lv}`);
    if (place) lines.push(place);
    return { title: developed ? `${info.title}: ${title}` : title, lines };
  }
  return null;
}

// ── When a tooltip may show (pure, tested) ───────────────────────────────────

/** The state a tooltip depends on (§14.2). */
export interface TipGate {
  /** Rich tooltips on (TIP_QUERY). */
  enabled: boolean;
  /** The last pointer event's type ('mouse', 'touch', 'pen'). */
  pointerType: string;
  /** Mouse buttons held now. */
  buttons: number;
  /** A drag or a pinch is under way (input's hoverBus.busy). */
  busy: boolean;
  /** A plan waits for ✓. */
  pending: boolean;
  /** Modal dialogs open. */
  modals: number;
}

/** Never on touch or pen, never while a button is held, a drag or pinch runs, a plan waits for ✓ or a modal is open. */
export function tipBlocked(g: TipGate): boolean {
  return !g.enabled || g.pointerType !== 'mouse' || g.buttons !== 0 || g.busy || g.pending || g.modals > 0;
}

// ── The tooltip element ──────────────────────────────────────────────────────

/** DOM targets with a rich tooltip (delegated on the UI root). */
const TIP_SELECTOR = '.cc-tb[data-cat], .cc-card[data-tool], .cc-hud-funds, .cc-hud-pop, .cc-rci, .cc-speed-btn[data-speed], .cc-hud-menu, .cc-hud-map';

interface Target {
  key: string;
  el: HTMLElement | null;
  warm: boolean;
  content: () => TipContent | null;
  /** Map targets: the cursor (canvas CSS px) the tooltip sits beside. */
  sx?: number;
  sy?: number;
}

/**
 * The one tooltip (§14.2), `role="tooltip"`, in the game's panel style. The UI root calls update() once a frame
 * (cheap: a clock check) and onMapPick from input's hover pick.
 */
export class Tooltips {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly clock = new TipClock();
  private target: Target | null = null;
  private mapTarget: Target | null = null;
  private domTarget: Target | null = null;
  /** A touch or pen event: no tooltips until the next mouse move. */
  private suppressed = false;
  private enabled = false;
  private described: HTMLElement | null = null;
  private timer = 0;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly ctx: UIContext) {
    this.titleEl = h('div', { class: 'cc-tooltip-title' });
    this.body = h('div', { class: 'cc-tooltip-body' });
    this.el = h('div', { class: 'cc-tooltip', id: 'cc-tooltip', role: 'tooltip', hidden: true }, this.titleEl, this.body);
    const listen = (t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.offs.push(() => t.removeEventListener(type, fn, opts));
    };
    if (typeof window === 'undefined') return;
    listen(window, 'pointermove', (e) => this.onMove(e as PointerEvent), { capture: true, passive: true });
    listen(window, 'pointerdown', (e) => this.onDown(e as PointerEvent), { capture: true, passive: true });
    listen(window, 'wheel', () => this.dismiss(), { capture: true, passive: true });
    listen(window, 'keydown', () => this.dismiss(), { capture: true });
    listen(window, 'blur', () => this.hideNow());
    hoverBus.onPick = (p) => this.onMapPick(p);
    this.offs.push(() => (hoverBus.onPick = null));
  }

  /** Rich tooltips on or off (TIP_QUERY: a pointer that hovers). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.hideNow();
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') {
      // A touch or pen: hide, and no tooltips until the mouse moves again.
      this.suppressed = true;
      this.hideNow();
      return;
    }
    this.dismiss();
  }

  private onMove(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerType !== 'mouse') {
      this.suppressed = true;
      this.hideNow();
      return;
    }
    this.suppressed = false;
    if (e.buttons !== 0) {
      // A button is held (a drag, a slider): never a tooltip.
      this.hideNow();
      return;
    }
    const t = e.target as Element | null;
    const el = t && typeof (t as HTMLElement).closest === 'function' ? (t as HTMLElement).closest<HTMLElement>(TIP_SELECTOR) : null;
    if (el && this.ctx.root.contains(el)) {
      if (this.domTarget?.el !== el) this.domTarget = this.domTargetFor(el);
    } else this.domTarget = null;
    this.retarget();
  }

  /** input.ts' hover pick (≤ every 100 ms while the mouse moves over the canvas; null when it leaves or a tool is on). */
  onMapPick(p: HoverPick | null): void {
    if (!p) {
      this.mapTarget = null;
    } else {
      const key = `map:${p.mapView ? `s${p.slot}` : `${p.x},${p.y}${p.sky ? 's' : ''}${p.link !== undefined ? `l${p.link}` : ''}`}`;
      if (this.mapTarget?.key === key) {
        this.mapTarget.sx = p.sx;
        this.mapTarget.sy = p.sy;
        return;
      }
      const game = this.ctx.game;
      this.mapTarget = { key, el: null, warm: false, content: () => mapTip(game, p), sx: p.sx, sy: p.sy };
    }
    this.retarget();
  }

  private domTargetFor(el: HTMLElement): Target | null {
    const game = this.ctx.game;
    const cat = el.dataset.cat as CategoryId | undefined;
    if (cat) return { key: `cat:${cat}`, el, warm: true, content: () => toolbarTip(cat, game) };
    const tool = el.dataset.tool as ToolId | undefined;
    if (tool) return { key: `card:${tool}`, el, warm: true, content: () => cardTip(tool, game) };
    const speed = el.dataset.speed;
    if (speed !== undefined) return { key: `hud:speed${speed}`, el, warm: false, content: () => hudTip(`speed${speed}` as HudTip, game) };
    const kind: HudTip | null = el.classList.contains('cc-hud-funds')
      ? 'funds'
      : el.classList.contains('cc-hud-pop')
        ? 'pop'
        : el.classList.contains('cc-rci')
          ? 'rci'
          : el.classList.contains('cc-hud-menu')
            ? 'menu'
            : el.classList.contains('cc-hud-map')
              ? 'map'
              : null;
    return kind ? { key: `hud:${kind}`, el, warm: false, content: () => hudTip(kind, game) } : null;
  }

  /** The DOM target wins over the map under it (the pointer is on the UI). */
  private retarget(): void {
    const t = this.domTarget ?? this.mapTarget;
    const changed = t?.key !== this.target?.key;
    if (changed) {
      this.hide();
      this.target = t;
    } else if (t) this.target = t;
    this.clock.hover(t ? t.key : null, this.now(), !!t?.warm);
    // Show on time whatever the frame rate: a timer for the delay (the frame update also checks, and hides).
    if (changed && t && typeof window !== 'undefined') {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.update(), this.clock.wait + 1);
    }
  }

  /** A click, wheel or key press: hide at once; the target stays quiet until the pointer moves to another one. */
  private dismiss(): void {
    this.clock.dismiss(this.now());
    this.hide();
  }

  private hideNow(): void {
    this.clock.reset();
    this.hide();
    this.target = null;
  }

  private hide(): void {
    if (!this.el.hidden) this.el.hidden = true;
    this.clock.end(this.now());
    if (this.described) {
      this.described.removeAttribute('aria-describedby');
      this.described = null;
    }
  }

  /** May a tooltip show now? Never on touch, while dragging, with a plan waiting for ✓, or with a modal open. */
  private blocked(): boolean {
    const { game, modals } = this.ctx;
    return tipBlocked({
      enabled: this.enabled,
      pointerType: this.suppressed ? 'touch' : 'mouse',
      buttons: 0,
      busy: hoverBus.busy,
      pending: !!game.pendingConfirm,
      modals: modals.depth,
    });
  }

  /** Once a frame: show the tooltip when its time has come; hide it when something blocks it. */
  update(): void {
    if (this.blocked()) {
      if (!this.el.hidden) this.hideNow();
      return;
    }
    const t = this.target;
    if (!t) return;
    // A DOM target that left the page (a tray rebuilt under the cursor) takes its tooltip along.
    if (t.el && !t.el.isConnected) {
      this.domTarget = null;
      this.retarget();
      return;
    }
    const now = this.now();
    if (!this.clock.due(now)) return;
    const c = t.content();
    if (!c) {
      this.clock.shown(t.warm);
      return;
    }
    setText(this.titleEl, c.title);
    this.body.textContent = '';
    for (const line of c.lines) this.body.append(h('div', { class: 'cc-tooltip-line', text: line }));
    this.el.hidden = false;
    this.place(t);
    this.clock.shown(t.warm);
    if (t.el) {
      t.el.setAttribute('aria-describedby', 'cc-tooltip');
      this.described = t.el;
    }
  }

  /** Under a button, or right of and below the cursor on the map; flipped to stay on screen and off the side panel. */
  private place(t: Target): void {
    const el = this.el;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const r = el.getBoundingClientRect();
    const tw = r.width;
    const th = r.height;
    const panel = this.ctx.root.querySelector<HTMLElement>('.cc-sidepanel');
    const pr = panel ? panel.getBoundingClientRect() : null;
    const right = pr && pr.width > 0 ? pr.left - 8 : W - 8;
    const pos = tipPosition(t.el ? t.el.getBoundingClientRect() : null, t.sx ?? 0, t.sy ?? 0, tw, th, W, H, t.el && pr && t.el.closest('.cc-sidepanel') ? W - 8 : right);
    el.style.left = `${Math.round(pos.x)}px`;
    el.style.top = `${Math.round(pos.y)}px`;
  }

  destroy(): void {
    for (const off of this.offs.splice(0)) off();
  }
}

/**
 * Where a tooltip of size (tw, th) goes (§14.2): centred under a DOM target (above it when there is no room below, as
 * for the toolbar), or 16 px right and 20 px below the cursor on the map (left of / above it when that would leave the
 * screen or cover the side panel, whose left edge is `right`). Pure.
 */
export function tipPosition(
  target: { left: number; top: number; right: number; bottom: number; width: number } | null,
  sx: number,
  sy: number,
  tw: number,
  th: number,
  W: number,
  H: number,
  right = W - 8,
): { x: number; y: number } {
  const pad = 8;
  let x: number;
  let y: number;
  if (target) {
    x = target.left + target.width / 2 - tw / 2;
    y = target.bottom + 6;
    if (y + th > H - pad) y = target.top - 6 - th;
  } else {
    x = sx + TIP_MAP_DX;
    y = sy + TIP_MAP_DY;
    if (x + tw > right) x = sx - TIP_MAP_DX - tw;
    if (y + th > H - pad) y = sy - TIP_MAP_DY - th;
  }
  x = Math.max(pad, Math.min(x, Math.max(pad, right - tw)));
  y = Math.max(pad, Math.min(y, H - pad - th));
  return { x, y };
}

