// ─────────────────────────────────────────────────────────────────────────────
// The City map and the annex sheet (docs/MEGACITY.md §7.2, §7.3, §3.9).
//
//   header       44 px: "City map", the grants waiting (✦ 2), owned / region
//                size (3/9), "?" and ✕
//   atlas        the canvas itself: the camera snaps to the City map framing
//                (camera.snapToMap) and the renderer draws the atlas; a tap
//                anywhere inside a slot's diamond selects it (pure geometry:
//                camera.screenToTile → world.slotAt), the selected slot gets an
//                outline (an SVG over the canvas, no renderer change)
//   chip row     5×5 only: a 44 px chip for every candidate (+) and owned
//                district, scrolling sideways; a tap selects and centres it
//   sheet        a bottom sheet (portrait, drag to 85%) or a right panel
//                (landscape, wide screens): name, night vignette, tagline,
//                terrain, perks, hazards, lobbyists, the annex summary, links,
//                the lease (Tarmac Reach), census and district goals (owned)
//   footer       sticky under the sheet's scroll: the price line and the 52 px
//                Annex button (Go there on an owned district); Annex turns into
//                "Annex Kessel Flats? ✓ ✕" (a single tap never annexes)
//
// After ✓: game.annex(slot, lease), the map closes, the camera flies in
// (ANNEX.flyInSec, a tap skips: input/mapbus.ts) and the renderer lifts the fog.
// The sim keeps running: the map is a panel like the budget, not a pause.
// The pure parts (chips, footer, hit-test, default slot) are exported for tests.
// ─────────────────────────────────────────────────────────────────────────────

import { ANNEX, DISTRICTS, FACTION_LABELS } from '../game/config';
import { slotRect } from '../game/districts/slots';
import type { DistrictSlotView, DistrictView, Game } from '../game/game';
import { FACTIONS } from '../game/story/content/factions';
import type { FactionId } from '../game/story/types';
import type { SlotId } from '../game/types';
import type { World } from '../game/world';
import { mapBus } from '../input/mapbus';
import { styleVignette } from '../render/atlas';
import { HALF_H, HALF_W, type Camera } from '../render/camera';
import type { UIContext } from './context';
import { buzz, esc, h, setAttr, setClass, setHidden, setHtml, setStyle, setText } from './dom';
import { abbr, credits, MINUS } from './format';
import { icon } from './icons';
import { factionSigil } from './story/sigils';

// ── Copy (§7.2) ─────────────────────────────────────────────────────────────

export const CITYMAP_HELP =
  'Every chapter you finish brings a land grant. Spend it here to annex a district next to your city. Each district has its own land, perks, problems and goals, and some factions lobby for one or another. After Charter Night grants keep coming, and you can buy districts with credits. Your region is 3×3 or 5×5 districts, chosen when you founded the city; a 3×3 city can grow to 5×5 in Settings.';
/** A slot whose terrain line names what the land holds (§7.2: islands, ruins, frames, steps, channels by kind). */
const TERRAIN_NOUN: Partial<Record<string, string>> = {
  shoals: 'islands',
  sunk: 'ruins and canals',
  flats: 'rail yards',
  terraces: 'terrace steps',
  reedmere: 'reed channels',
  skeleton: 'unfinished frames',
  tarmac: 'old runways',
  bazaar: 'alleys',
};
/** Ignore a ✓ this soon after Annex armed the confirm (a quick double tap must not annex, §7.8). */
export const CONFIRM_GUARD_MS = 350;
/** The sheet's two heights in portrait (share of the viewport): resting and dragged up (§7.2). */
const SHEET_REST = 0.5;
const SHEET_FULL = 0.85;

// ── Pure model ──────────────────────────────────────────────────────────────

/** A 44 px chip of the 5×5 chip row (§7.2): candidates first (+), then owned districts. */
export interface MapChip {
  slot: SlotId;
  label: string;
  kind: 'candidate' | 'owned';
}

/** The 5×5 chip row: every candidate and every owned district; none on a 3×3 region (its layout is unchanged). */
export function chipRow(view: Pick<DistrictView, 'region' | 'slots'>): MapChip[] {
  if (view.region !== 5) return [];
  const out: MapChip[] = [];
  for (const s of view.slots) if (s.state === 'candidate') out.push({ slot: s.slot, label: s.short, kind: 'candidate' });
  for (const s of view.slots) if (s.state === 'owned') out.push({ slot: s.slot, label: s.short, kind: 'owned' });
  return out;
}

/** The slot under screen point (sx, sy) (CSS px) on the City map, or −1 off the region: the diamonds tile it. */
export function slotAtScreen(world: Pick<World, 'N' | 'slotAt'>, cam: Pick<Camera, 'screenToTile'>, sx: number, sy: number): SlotId {
  const t = cam.screenToTile(sx, sy);
  if (t.x < 0 || t.y < 0 || t.x >= world.N || t.y >= world.N) return -1;
  return world.slotAt(t.x, t.y);
}

/** A slot diamond's four corners on screen (top, right, bottom, left; CSS px). */
export function slotScreenPoly(world: Pick<World, 'region'>, cam: Pick<Camera, 'worldToScreen'>, slot: SlotId): [number, number][] {
  const r = slotRect(world, slot);
  const P = (x: number, y: number): [number, number] => {
    const p = cam.worldToScreen((x - y) * HALF_W, (x + y) * HALF_H);
    return [p.x, p.y];
  };
  return [P(r.x0, r.y0), P(r.x1 + 1, r.y0), P(r.x1 + 1, r.y1 + 1), P(r.x0, r.y1 + 1)];
}

/**
 * The slot the map opens on: the one asked for (a pin, the 'map' toast), else, while the city can annex, the first
 * candidate it can afford, else any candidate, else the start (first owned) district.
 */
export function defaultSlot(view: Pick<DistrictView, 'slots' | 'region'>, want?: SlotId | null, startSlot = -1): SlotId {
  if (want !== undefined && want !== null && want >= 0 && want < view.slots.length) return want;
  // A candidate the city can annex now; one without a lease question first (it annexes in two taps).
  const can = view.slots.find((s) => s.canAnnex && !s.lease) ?? view.slots.find((s) => s.canAnnex);
  if (can) return can.slot;
  const cand = view.slots.find((s) => s.state === 'candidate');
  if (cand) return cand.slot;
  if (startSlot >= 0 && startSlot < view.slots.length) return startSlot;
  return view.slots.find((s) => s.state === 'owned')?.slot ?? 0;
}

/** The sheet's sticky footer (§7.2): the price line and the primary button (or the ✓ / ✕ confirm). */
export interface FooterModel {
  price: string;
  /** 'annex' (a candidate), 'go' (an owned district: Go there), null (nothing to do here). */
  act: 'annex' | 'go' | null;
  label: string;
  enabled: boolean;
  /** Annex was tapped: "Annex Kessel Flats?" with ✓ and ✕ (each ≥ 44 × 44). */
  confirm: string | null;
  /** Why the button is disabled (the lease, credits), for the pill-style note under it. */
  note: string | null;
}

export function footerModel(s: DistrictSlotView, opts: { lease: 'nacre' | 'basalt' | null; confirming: boolean; blocked?: boolean }): FooterModel {
  if (s.state === 'owned') {
    const done = s.goals.filter((g) => g.done).length;
    const price = s.goals.length ? `Part of the city · ${done} of ${s.goals.length} district goals done` : 'Part of the city';
    return { price, act: 'go', label: 'Go there', enabled: true, confirm: null, note: null };
  }
  if (s.state !== 'candidate') return { price: s.price.text, act: null, label: '', enabled: false, confirm: null, note: null };
  const needLease = !!s.lease && !opts.lease;
  const enabled = s.canAnnex && !needLease && !opts.blocked;
  const note = opts.blocked ? 'Reload to update first' : needLease && s.canAnnex ? 'Pick who leases the old apron' : null;
  return {
    price: s.price.text,
    act: 'annex',
    label: `Annex ${s.name}`,
    enabled,
    confirm: opts.confirming && enabled ? `Annex ${s.name}?` : null,
    note,
  };
}

/** "Basalt ++ · Nacre −" (the choice-summary style): pips by size, faction colour kept. HTML. */
export function reactionSummary(reactions: readonly { f: FactionId; v: number }[]): string {
  return reactions
    .filter((r) => r.v !== 0)
    .sort((a, b) => b.v - a.v)
    .map((r) => {
      const l = FACTION_LABELS[r.f];
      // §7.2's examples: a lobby's +6 reads ++, a rival's −2 reads −; the lease's +8 / −4 read ++ / −.
      const n = Math.abs(r.v) >= 10 ? 3 : Math.abs(r.v) >= 5 ? 2 : 1;
      const sign = (r.v > 0 ? '+' : MINUS).repeat(n);
      return `<span class="cc-sum-fav ${r.v > 0 ? 'is-up' : 'is-down'}" style="--fc:${l.color}"><b>${esc(l.short)}</b> ${sign}</span>`;
    })
    .join('<span class="cc-sum-sep" aria-hidden="true"> · </span>');
}

/** "Land 89% · Water 11% · islands": the terrain line by kind. */
export function terrainLine(s: Pick<DistrictSlotView, 'land' | 'kind'>): string {
  const land = Math.round(Math.max(0, Math.min(1, s.land)) * 100);
  const parts = [`Land ${land}%`, `Water ${100 - land}%`];
  const noun = TERRAIN_NOUN[s.kind];
  if (noun) parts.push(noun);
  return parts.join(' · ');
}

/** The name a lobbyist speaks under (§7.2: "Sallow: …"). */
export function speakerName(f: FactionId): string {
  const n = FACTIONS[f]?.leader ?? FACTION_LABELS[f].short;
  if (/^(Old|Sister)\s/.test(n) || !n.includes(' ')) return n;
  return n.split(' ').pop() ?? n;
}

/** Census line of an owned district; a variant names its kind ("Ironside Docks · Flats"). */
export function censusLine(s: DistrictSlotView): string {
  const parts: string[] = [];
  if (s.variant > 0) parts.push(`${s.name} · ${DISTRICTS[s.kind]?.short ?? s.kindName}`);
  const c = s.census;
  if (c) parts.push(`${abbr(c.residents)} residents`, `${abbr(c.jobs)} jobs`);
  return parts.join(' · ');
}

/**
 * The census's second line (§4.6): the job balance ("1 job per 1.7 residents", or "1.4 jobs per resident" where work
 * outnumbers homes) and the average land value. Empty until the district has people or jobs.
 */
export function balanceLine(c: DistrictSlotView['census']): string {
  if (!c || (c.residents <= 0 && c.jobs <= 0)) return '';
  const parts: string[] = [];
  if (c.residents > 0 && c.jobs > 0) {
    const r = c.residents / c.jobs;
    parts.push(r >= 1 ? `1 job per ${r.toFixed(1)} residents` : `${(1 / r).toFixed(1)} jobs per resident`);
  } else parts.push(c.jobs > 0 ? 'Jobs, no homes yet' : 'Homes, no jobs yet');
  parts.push(`Land value ${Math.round(Math.max(0, Math.min(1, c.avgLandValue)) * 100)}%`);
  return parts.join(' · ');
}

// ── The panel ───────────────────────────────────────────────────────────────

export class CityMap {
  readonly el: HTMLElement;
  /** First-use tips show here while the map is open (the dock's slot is hidden then). */
  readonly tipSlot: HTMLElement;
  private readonly head: HTMLElement;
  private readonly grantsEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly helpBtn: HTMLButtonElement;
  private readonly helpEl: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly handle: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly body: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly priceEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly confirmRow: HTMLElement;
  private readonly confirmText: HTMLElement;
  private readonly okBtn: HTMLButtonElement;
  private readonly edgeEl: HTMLElement;
  private readonly growSlot: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly poly: SVGPolygonElement;
  private open_ = false;
  private slot: SlotId = -1;
  private lease: 'nacre' | 'basalt' | null = null;
  private confirming = false;
  private confirmAt = 0;
  private view: DistrictView | null = null;
  private bodyKey = '';
  private chipsKey = '';
  private polyKey = '';
  private expanded = false;
  private side = false;
  /** Called when the map opens or closes (the UI root hides the HUD and re-sets the camera insets). */
  onToggle: ((open: boolean) => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    this.grantsEl = h('span', { class: 'cc-cm-grants', hidden: true });
    this.countEl = h('span', { class: 'cc-cm-count' });
    this.helpBtn = h('button', { class: 'cc-iconbtn cc-cm-helpbtn', type: 'button', 'data-act': 'help', 'aria-label': 'How the City map works', 'aria-expanded': 'false', html: icon('help') });
    this.head = h(
      'header',
      { class: 'cc-cm-head' },
      h('span', { class: 'cc-cm-ico', html: icon('map') }),
      h('h2', { class: 'cc-cm-title', id: 'cc-cm-title', text: 'City map' }),
      this.grantsEl,
      this.countEl,
      h('span', { class: 'cc-cm-spacer' }),
      this.helpBtn,
      h('button', { class: 'cc-iconbtn cc-cm-close', type: 'button', 'data-act': 'close', 'aria-label': 'Close the City map', html: icon('close') }),
    );
    this.helpEl = h('p', { class: 'cc-cm-help', hidden: true, text: CITYMAP_HELP });
    this.handle = h('button', { class: 'cc-cm-handle', type: 'button', 'data-act': 'expand', 'aria-label': 'Show more' }, h('i'));
    this.chips = h('div', { class: 'cc-cm-chips', role: 'listbox', 'aria-label': 'Districts', hidden: true });
    this.body = h('div', { class: 'cc-cm-body' });
    this.priceEl = h('p', { class: 'cc-cm-price' });
    this.noteEl = h('p', { class: 'cc-cm-note', hidden: true });
    this.primary = h('button', { class: 'cc-btn is-primary cc-cm-go', type: 'button', 'data-act': 'primary' });
    this.confirmText = h('span', { class: 'cc-cm-confirm-text' });
    this.okBtn = h('button', { class: 'cc-cm-yes', type: 'button', 'data-act': 'yes', 'aria-label': 'Annex', html: icon('check') });
    this.confirmRow = h(
      'div',
      { class: 'cc-cm-confirm', hidden: true },
      this.confirmText,
      h('button', { class: 'cc-cm-no', type: 'button', 'data-act': 'no', 'aria-label': 'Not now', html: icon('close') }),
      this.okBtn,
    );
    this.foot = h('footer', { class: 'cc-cm-foot' }, this.priceEl, this.primary, this.confirmRow, this.noteEl);
    this.tipSlot = h('div', { class: 'cc-cm-tipslot' });
    this.sheet = h('section', { class: 'cc-cm-sheet cc-panel', 'aria-labelledby': 'cc-cm-title' }, this.handle, this.chips, this.helpEl, this.body, this.tipSlot, this.foot);
    this.growSlot = h('span', { class: 'cc-cm-growslot', 'data-slot': 'grow' });
    this.edgeEl = h('div', { class: 'cc-cm-edge', hidden: true }, h('span', { class: 'cc-cm-edge-text' }), this.growSlot);
    const svgNS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(svgNS, 'svg');
    this.svg.setAttribute('class', 'cc-cm-sel');
    this.svg.setAttribute('aria-hidden', 'true');
    this.poly = document.createElementNS(svgNS, 'polygon');
    this.svg.append(this.poly);
    this.el = h('div', { class: 'cc-citymap', hidden: true, role: 'dialog', 'aria-labelledby': 'cc-cm-title' }, this.svg as unknown as HTMLElement, this.head, this.edgeEl, this.sheet);
    this.el.addEventListener('click', this.onClick);
    this.wireDrag();
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** The selected slot (−1 when closed). */
  get selected(): SlotId {
    return this.open_ ? this.slot : -1;
  }

  /** Open on `slot` (a pin, the 'map' toast, the goal chip's token), or on the best slot to look at. */
  open(slot?: SlotId | null): void {
    const g = this.ctx.game;
    if (g.world.region < 3) return;
    this.view = g.districtView();
    const start = g.world.districts.owned[0] ?? -1;
    const was = this.open_;
    this.open_ = true;
    this.el.hidden = false;
    this.expanded = false;
    setClass(this.sheet, 'is-full', false);
    this.select(defaultSlot(this.view, slot ?? null, start), false);
    this.layout();
    if (!was) {
      this.onToggle?.(true);
      this.snap();
    }
    this.ctx.sfx('click');
  }

  /** Close: back to the city view at minZoom centred on `toward` (a slot or a screen point), or as it was. */
  close(toward?: { slot?: SlotId; sx?: number; sy?: number }): void {
    if (!this.open_) return;
    this.open_ = false;
    this.confirming = false;
    this.el.hidden = true;
    this.onToggle?.(false);
    const cam = this.ctx.camera;
    if (!cam.mapView) return;
    if (toward?.slot !== undefined && toward.slot >= 0) {
      const p = this.slotCentreScreen(toward.slot);
      cam.snapFromMap(p.x, p.y);
    } else if (toward?.sx !== undefined && toward.sy !== undefined) cam.snapFromMap(toward.sx, toward.sy);
    else cam.snapFromMap(cam.width / 2, cam.height / 2);
  }

  /**
   * A tap on the atlas (input, through mapBus): select the slot under it (§7.2: a tap anywhere inside a diamond; a miss
   * lands on a neighbour, outlined at once). Owned districts go there through the sheet's Go there or a pinch-in, so a
   * 5×5 map's double-tap zoom never leaves the map by accident.
   */
  tap(sx: number, sy: number): void {
    if (!this.open_) return;
    const s = slotAtScreen(this.ctx.game.world, this.ctx.camera, sx, sy);
    if (s < 0 || s === this.slot) return;
    this.select(s, false);
    buzz(6);
    this.ctx.sfx('click');
  }

  /** Re-read the model (stats, grants, annex) while open; cheap enough at the panel tick. */
  refresh(): void {
    if (!this.open_) return;
    this.view = this.ctx.game.districtView();
    this.render();
  }

  /** Per frame while open: keep the selection outline on its slot as the camera moves. */
  update(): void {
    if (!this.open_) return;
    const cam = this.ctx.camera;
    if (!cam.mapView && !cam.animating) {
      // Something else left the map (a world swap, a story jump): close quietly.
      this.open_ = false;
      this.el.hidden = true;
      this.onToggle?.(false);
      return;
    }
    const key = `${this.slot}|${cam.x.toFixed(1)}|${cam.y.toFixed(1)}|${cam.zoom.toFixed(5)}|${cam.width}|${cam.height}`;
    if (key === this.polyKey) return;
    this.polyKey = key;
    if (this.slot < 0) {
      this.poly.setAttribute('points', '');
      return;
    }
    const pts = slotScreenPoly(this.ctx.game.world, cam, this.slot);
    this.poly.setAttribute('points', pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  }

  /** The viewport changed: switch between the bottom sheet and the side panel, and refit the atlas. */
  layout(): void {
    if (!this.open_) return;
    const cam = this.ctx.camera;
    const side = cam.width > cam.height && (cam.height <= 520 || cam.width >= 900);
    const changed = side !== this.side;
    this.side = side;
    setClass(this.el, 'is-side', side);
    if (changed && cam.mapView) this.snap();
  }

  /** CSS px the map's own UI covers: the header (top), the sheet (bottom in portrait, right on the side). */
  covered(): { top: number; right: number; bottom: number } {
    const cam = this.ctx.camera;
    const hr = this.head.getBoundingClientRect();
    const sr = this.sheet.getBoundingClientRect();
    const top = Math.max(0, Math.round(hr.bottom));
    // "The city reaches the edge of the region." sits under the atlas (§7.2): keep the atlas framed above it.
    const edge = this.edgeEl.hidden ? 0 : Math.round(this.edgeEl.getBoundingClientRect().height) + 14;
    if (this.side) return { top, right: Math.max(0, Math.round(cam.width - sr.left)), bottom: edge };
    // The resting height, not a dragged-up sheet: the atlas stays framed above the resting sheet.
    const rest = this.expanded ? Math.round(cam.height * SHEET_REST) : Math.round(cam.height - sr.top);
    return { top, right: 0, bottom: Math.max(0, rest) + edge };
  }

  /** Snap (or refit) the camera to the City map above the sheet. */
  snap(): void {
    const cam = this.ctx.camera;
    const c = this.covered();
    cam.setInsets({ top: c.top, right: c.right, bottom: 0, left: 0 });
    const headroom = this.ctx.game.world.region === 5 && this.handheld() ? 2 : 1;
    cam.snapToMap(c.bottom, headroom);
  }

  private handheld(): boolean {
    return !(typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches);
  }

  private slotCentreScreen(slot: SlotId): { x: number; y: number } {
    const r = slotRect(this.ctx.game.world, slot);
    const cx = (r.x0 + r.x1 + 1) / 2;
    const cy = (r.y0 + r.y1 + 1) / 2;
    return this.ctx.camera.worldToScreen((cx - cy) * HALF_W, (cx + cy) * HALF_H);
  }

  private select(slot: SlotId, centre: boolean): void {
    if (slot !== this.slot) {
      this.lease = null;
      this.confirming = false;
      this.body.scrollTop = 0;
    }
    this.slot = slot;
    this.polyKey = '';
    this.render();
    if (centre) this.centreOn(slot);
  }

  /** Chip taps: bring the slot to the middle of the atlas area (it matters once a 5×5 map is zoomed in). */
  private centreOn(slot: SlotId): void {
    const cam = this.ctx.camera;
    const r = slotRect(this.ctx.game.world, slot);
    const cx = (r.x0 + r.x1 + 1) / 2;
    const cy = (r.y0 + r.y1 + 1) / 2;
    const c = this.covered();
    const dx = -c.right / 2;
    const dy = (c.top - c.bottom) / 2;
    cam.easeTo((cx - cy) * HALF_W - dx / cam.zoom, (cx + cy) * HALF_H - dy / cam.zoom, cam.zoom, 0.25);
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private render(): void {
    const v = this.view;
    if (!v) return;
    const g = this.ctx.game;
    // Header: grants waiting and owned / region.
    setHidden(this.grantsEl, v.grants <= 0);
    setText(this.grantsEl, `✦ ${v.grants}`);
    setAttr(this.grantsEl, 'aria-label', `${v.grants} land ${v.grants === 1 ? 'grant' : 'grants'} waiting`);
    setText(this.countEl, `${v.owned}/${v.total}`);
    setAttr(this.countEl, 'aria-label', `${v.owned} of ${v.total} districts owned`);
    // The edge of the region: the line under the atlas (+ WP-9's Grow button slot on a 3×3 region).
    setHidden(this.edgeEl, !v.edgeLine);
    if (v.edgeLine) setText(this.edgeEl.firstChild as HTMLElement, v.edgeLine);
    setClass(this.growSlot, 'is-wanted', v.canGrow);
    this.renderChips(v);
    const s = v.slots[this.slot];
    if (!s) return;
    this.renderBody(s, v);
    this.renderFoot(s, g.saveBlocked);
  }

  private renderChips(v: DistrictView): void {
    const list = chipRow(v);
    setHidden(this.chips, list.length === 0);
    const key = list.map((c) => `${c.slot}${c.kind[0]}`).join(',') + `|${this.slot}`;
    if (key === this.chipsKey) return;
    this.chipsKey = key;
    let s = '';
    for (const c of list) {
      const on = c.slot === this.slot;
      s +=
        `<button class="cc-cm-chip is-${c.kind}${on ? ' is-on' : ''}" type="button" role="option" aria-selected="${on}" data-slot="${c.slot}">` +
        `${c.kind === 'candidate' ? '<b aria-hidden="true">+</b>' : ''}<span>${esc(c.label)}</span></button>`;
    }
    this.chips.innerHTML = s;
    const on = this.chips.querySelector<HTMLElement>('.is-on');
    if (on && typeof on.scrollIntoView === 'function') on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private renderBody(s: DistrictSlotView, v: DistrictView): void {
    const g = this.ctx.game;
    const reactions = s.state === 'candidate' ? (this.lease ? g.annexReactions(s.slot, this.lease) : s.reactions) : [];
    const key = JSON.stringify([s, this.lease, reactions, v.ended]);
    if (key === this.bodyKey) return;
    this.bodyKey = key;
    setStyle(this.sheet, '--accent', s.color);
    const stateText =
      s.state === 'owned' ? 'Part of the city' : s.state === 'candidate' ? 'Next to the city' : s.state === 'notOpen' ? 'Still flooded: opens later' : 'Not next to the city yet';
    let html = `<div class="cc-cm-titlerow"><div class="cc-cm-names"><h3 class="cc-cm-name">${esc(s.name)}</h3>`;
    html += `<span class="cc-cm-state is-${s.state}">${esc(s.variant > 0 ? `${stateText} · ${DISTRICTS[s.kind]?.short ?? s.kindName}` : stateText)}</span></div>`;
    html += `<span class="cc-cm-vig" data-kind="${s.kind}"></span></div>`;
    if (s.tagline && s.state !== 'notOpen') html += `<p class="cc-cm-tag">${esc(s.tagline)}</p>`;
    if (s.lease) {
      html += `<div class="cc-cm-lease"><p class="cc-cm-line">${esc(s.lease.prompt)}</p><div class="cc-seg cc-cm-leaseseg" role="radiogroup" aria-label="Lease">`;
      for (const o of s.lease.options) {
        const on = this.lease === o;
        const label = o === 'nacre' ? 'Nacre: terminal' : 'Basalt: cargo';
        const sum = reactionSummary([
          { f: o, v: ANNEX.leaseFavor },
          { f: o === 'nacre' ? 'basalt' : 'nacre', v: ANNEX.leaseRivalFavor },
        ]);
        html += `<button class="cc-seg-btn cc-cm-leasebtn${on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${on}" data-lease="${o}"><b>${label}</b><span class="cc-sum">${sum}</span></button>`;
      }
      html += '</div></div>';
    }
    if (s.state === 'owned') {
      const c = censusLine(s);
      if (c) html += `<p class="cc-cm-line">${esc(c)}</p>`;
      const b = balanceLine(s.census);
      if (b) html += `<p class="cc-cm-line is-dim">${esc(b)}</p>`;
    } else if (s.state !== 'notOpen') html += `<p class="cc-cm-line">${esc(terrainLine(s))}</p>`;
    if (s.perks.length) html += `<ul class="cc-cm-list is-perks">${s.perks.slice(0, 3).map((p) => `<li>+ ${esc(p)}</li>`).join('')}</ul>`;
    if (s.hazards.length) html += `<ul class="cc-cm-list is-hazards">${s.hazards.slice(0, 2).map((p) => `<li>! ${esc(p)}</li>`).join('')}</ul>`;
    if (s.lobby.length && s.state !== 'owned') {
      html += '<div class="cc-cm-lobby">';
      for (const l of s.lobby) {
        if (!l.quote) continue;
        html += `<details class="cc-cm-quote" style="--fc:${FACTION_LABELS[l.faction].color}"><summary>${factionSigil(l.faction, 16, 'cc-cm-sig')}<span class="cc-cm-q"><b>${esc(speakerName(l.faction))}:</b> “${esc(l.quote)}”</span><span class="cc-cm-more">more</span></summary></details>`;
      }
      html += '</div>';
    }
    if (reactions.length) html += `<p class="cc-cm-sum"><span class="cc-cm-k">Annexing:</span> ${reactionSummary(reactions)}</p>`;
    if (s.linksInternal > 0)
      html += `<p class="cc-cm-line is-dim">${s.linksInternal} regional ${s.linksInternal === 1 ? 'link here becomes a city street' : 'links here become city streets'}.</p>`;
    if (s.state === 'owned' && s.goals.length) {
      html += `<div class="cc-cm-goals"><span class="cc-cm-k">District goals</span><ul>`;
      for (const gl of s.goals)
        html += `<li class="${gl.done ? 'is-done' : ''}"><span class="cc-cm-tick" aria-hidden="true">${gl.done ? '✓' : ''}</span><span>${esc(gl.label)}</span><b>${gl.done ? 'Done' : `+${abbr(gl.reward)} CR`}</b></li>`;
      html += '</ul></div>';
    }
    this.body.innerHTML = html;
    const vig = this.body.querySelector<HTMLElement>('.cc-cm-vig');
    const c = vig ? styleVignette(s.kind) : null;
    if (vig && c) vig.append(c);
  }

  private renderFoot(s: DistrictSlotView, blocked: boolean): void {
    const f = footerModel(s, { lease: this.lease, confirming: this.confirming, blocked });
    if (!f.confirm) this.confirming = false;
    setText(this.priceEl, f.price);
    setClass(this.priceEl, 'is-grant', s.price.grants > 0);
    setHidden(this.primary, !f.act || !!f.confirm);
    if (f.act) {
      setHtml(this.primary, `${f.act === 'go' ? icon('eye') : icon('plus')}<span>${esc(f.label)}</span>`);
      setAttr(this.primary, 'aria-disabled', f.enabled ? 'false' : 'true');
      setClass(this.primary, 'is-off', !f.enabled);
      setClass(this.primary, 'is-go', f.act === 'go');
    }
    setHidden(this.confirmRow, !f.confirm);
    if (f.confirm) {
      setText(this.confirmText, f.confirm);
      setAttr(this.okBtn, 'aria-label', f.confirm.replace(/\?$/, ''));
    }
    setText(this.noteEl, f.note ?? '');
    setHidden(this.noteEl, !f.note);
  }

  // ── Input ───────────────────────────────────────────────────────────────

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>('[data-slot]');
    if (chip && this.chips.contains(chip)) {
      this.select(Number(chip.dataset.slot), true);
      buzz(6);
      return;
    }
    const lease = t.closest<HTMLElement>('[data-lease]');
    if (lease) {
      this.lease = lease.dataset.lease === 'basalt' ? 'basalt' : 'nacre';
      this.confirming = false;
      buzz(6);
      this.render();
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') this.close();
    else if (act === 'help') {
      const show = this.helpEl.hidden;
      setHidden(this.helpEl, !show);
      setAttr(this.helpBtn, 'aria-expanded', show ? 'true' : 'false');
      if (show) this.setExpanded(true);
    } else if (act === 'expand') this.setExpanded(!this.expanded);
    else if (act === 'primary') this.primaryTap();
    else if (act === 'no') {
      this.confirming = false;
      this.render();
    } else if (act === 'yes') {
      if (performance.now() - this.confirmAt < CONFIRM_GUARD_MS) return;
      this.annex();
    }
  };

  private primaryTap(): void {
    const v = this.view;
    const s = v?.slots[this.slot];
    if (!s) return;
    if (s.state === 'owned') {
      this.close({ slot: s.slot });
      return;
    }
    const f = footerModel(s, { lease: this.lease, confirming: false, blocked: this.ctx.game.saveBlocked });
    if (!f.enabled) {
      this.ctx.sfx('error');
      this.primary.classList.remove('is-shake');
      void this.primary.offsetWidth;
      this.primary.classList.add('is-shake');
      return;
    }
    this.confirming = true;
    this.confirmAt = performance.now();
    buzz(8);
    this.render();
    try {
      this.okBtn.focus({ preventScroll: true });
    } catch {
      /* old browsers */
    }
  }

  /** ✓ (or Enter on the confirm): annex, close, fly in. */
  annex(): boolean {
    const s = this.view?.slots[this.slot];
    if (!s || !this.confirming) return false;
    const g = this.ctx.game;
    const r = g.annex(s.slot, this.lease ?? undefined);
    this.confirming = false;
    if (!r.ok) {
      if (r.reason) g.toast(r.reason, 'error');
      this.ctx.sfx('error');
      this.refresh();
      return false;
    }
    buzz(14);
    const slot = s.slot;
    this.close({ slot });
    this.flyIn(slot);
    return true;
  }

  /** The annex fly-in (§7.2): ease to the new district over ANNEX.flyInSec; a tap skips it (input reads mapBus.flyIn). */
  private flyIn(slot: SlotId): void {
    const r = slotRect(this.ctx.game.world, slot);
    this.ctx.camera.easeToBox(r, 0, ANNEX.flyInSec);
    mapBus.flyIn = r;
  }

  /** Enter on the City map: the confirm's ✓ while it is armed. */
  enter(): boolean {
    if (!this.open_ || !this.confirming) return false;
    return this.annex();
  }

  private setExpanded(on: boolean): void {
    if (this.side) return;
    this.expanded = on;
    setClass(this.sheet, 'is-full', on);
    setAttr(this.handle, 'aria-label', on ? 'Show less' : 'Show more');
  }

  /** Drag the handle up to 85 % (portrait), down to rest. */
  private wireDrag(): void {
    let y0 = -1;
    let moved = false;
    this.handle.addEventListener('pointerdown', (e) => {
      if (this.side) return;
      y0 = e.clientY;
      moved = false;
      try {
        this.handle.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
    });
    this.handle.addEventListener('pointermove', (e) => {
      if (y0 < 0) return;
      const dy = e.clientY - y0;
      if (Math.abs(dy) < 8) return;
      moved = true;
      const hgt = this.ctx.camera.height;
      const base = (this.expanded ? SHEET_FULL : SHEET_REST) * hgt;
      const want = Math.max(SHEET_REST * hgt * 0.8, Math.min(SHEET_FULL * hgt, base - dy));
      setStyle(this.sheet, 'height', `${Math.round(want)}px`);
    });
    const end = (e: PointerEvent) => {
      if (y0 < 0) return;
      const dy = e.clientY - y0;
      y0 = -1;
      this.sheet.style.removeProperty('height');
      if (!moved) return; // a click: the 'expand' action toggles
      this.setExpanded(dy < 0);
      // Swallow the click that follows the drag.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      this.handle.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => this.handle.removeEventListener('click', swallow, { capture: true }), 400);
    };
    this.handle.addEventListener('pointerup', end);
    this.handle.addEventListener('pointercancel', end);
  }

  /** A world swap: forget the selection and close. */
  reset(): void {
    this.open_ = false;
    this.el.hidden = true;
    this.slot = -1;
    this.lease = null;
    this.confirming = false;
    this.bodyKey = '';
    this.chipsKey = '';
    mapBus.flyIn = null;
  }
}

/** The map button's and the goal token's count: grants waiting, or 0. */
export function grantsWaiting(game: Pick<Game, 'world'>): number {
  return game.world.region >= 3 ? Math.max(0, game.world.districts.grants | 0) : 0;
}

/** Credits line for a purchase (after an ending): "2,520,000 CR". */
export function priceCredits(n: number): string {
  return credits(n);
}
