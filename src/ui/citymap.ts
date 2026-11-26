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
import { slotNames } from '../render/districts';
import { HALF_H, HALF_W, type Camera } from '../render/camera';
import type { UIContext } from './context';
import { buzz, esc, h, setAttr, setClass, setHidden, setHtml, setStyle, setText } from './dom';
import { abbr, credits, MINUS } from './format';
import { icon } from './icons';
import { factionSigil } from './story/sigils';
import { BLOCKED_TEXT, TRANSFER_COPY, TRANSFER_ICONS } from './transfer';

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

export function footerModel(
  s: DistrictSlotView,
  opts: { lease: 'nacre' | 'basalt' | null; confirming: boolean; blocked?: boolean; funds?: number },
): FooterModel {
  if (s.state === 'owned') {
    const done = s.goals.filter((g) => g.done).length;
    const price = s.goals.length ? `Part of the city · ${done} of ${s.goals.length} district goals done` : 'Part of the city';
    return { price, act: 'go', label: 'Go there', enabled: true, confirm: null, note: null };
  }
  if (s.state !== 'candidate') return { price: s.price.text, act: null, label: '', enabled: false, confirm: null, note: null };
  const needLease = !!s.lease && !opts.lease;
  const enabled = s.canAnnex && !needLease && !opts.blocked;
  // After an ending with no grant left a district costs credits: a short purse says by how much (§9.5).
  const buy = !s.canAnnex && s.price.grants <= 0 && s.price.credits > 0;
  const short = buy && opts.funds !== undefined ? Math.ceil(s.price.credits - opts.funds) : 0;
  const note = opts.blocked
    ? 'Reload to update first'
    : needLease && s.canAnnex
      ? 'Pick who leases the old apron'
      : buy
        ? short > 0
          ? `Not enough credits: ${short.toLocaleString('en-US')} CR short`
          : 'Not enough credits'
        : null;
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

/**
 * The Metro on the City map (§7.2, §6.3): each owned district with a live Metro Station (powered, online, built) gives
 * one stop (its live station nearest the district's centre); with stops in two or more districts they are joined by
 * the shortest set of lines that links them all (a spanning tree over tile distance, so no line doubles another). One
 * district alone draws nothing: the sim links stations only across districts. Stops are in world px.
 */
export interface MetroNet {
  stops: { slot: SlotId; x: number; y: number }[];
  /** Index pairs into `stops`. */
  lines: [number, number][];
  /** Every owned district with a live station (also when it is the only one). */
  live: SlotId[];
}

export function metroNet(world: Pick<World, 'buildings' | 'region' | 'slotAt' | 'slotOwned'>): MetroNet {
  const best = new Map<SlotId, { tx: number; ty: number; d: number }>();
  for (const b of world.buildings.values()) {
    if (b.type !== 'metro' || !b.powered || b.offline > 0 || (b.buildDays ?? 0) > 0) continue;
    const slot = world.slotAt(b.x, b.y);
    if (slot < 0 || world.slotOwned[slot] !== 1) continue;
    const r = slotRect(world, slot);
    const d = Math.abs(b.x + 0.5 - (r.x0 + r.x1 + 1) / 2) + Math.abs(b.y + 0.5 - (r.y0 + r.y1 + 1) / 2);
    const cur = best.get(slot);
    if (cur && cur.d <= d) continue;
    best.set(slot, { tx: b.x, ty: b.y, d });
  }
  const live = [...best.keys()].sort((a, b) => a - b);
  if (best.size < 2) return { stops: [], lines: [], live };
  const tiles = [...best.entries()].sort((a, b) => a[0] - b[0]);
  const stops = tiles.map(([slot, p]) => ({ slot, x: (p.tx - p.ty) * HALF_W, y: (p.tx + p.ty + 1) * HALF_H }));
  // Prim's tree over at most R² stops.
  const n = stops.length;
  const inTree = new Array<boolean>(n).fill(false);
  const dist = new Array<number>(n).fill(Infinity);
  const from = new Array<number>(n).fill(-1);
  const lines: [number, number][] = [];
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || dist[i] < dist[u])) u = i;
    inTree[u] = true;
    if (from[u] >= 0) lines.push([from[u], u]);
    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      const d = Math.hypot(tiles[i][1].tx - tiles[u][1].tx, tiles[i][1].ty - tiles[u][1].ty);
      if (d < dist[i]) {
        dist[i] = d;
        from[i] = u;
      }
    }
  }
  return { stops, lines, live };
}

/** The owned district's Metro line in the sheet: linked, or the hint that a station in a second district links them. */
export function metroLine(net: MetroNet, slot: SlotId): string {
  if (!net.live.includes(slot)) return '';
  const n = net.stops.length - 1;
  if (n <= 0) return 'Metro Station here: one in another district links them';
  return `Metro: linked to ${n} other ${n === 1 ? 'district' : 'districts'}`;
}

/**
 * Leave the City map for the view the player had when it opened (✕, Esc): its centre and zoom, through the §3.9 snap.
 * Without one (the map opened straight from another map state), snap back towards `fallback` (screen px; the start
 * district) at minZoom.
 */
export function leaveMapTo(cam: Camera, back: { x: number; y: number; zoom: number } | null, fallback: { x: number; y: number }): void {
  if (!back) {
    cam.snapFromMap(fallback.x, fallback.y);
    return;
  }
  const p = cam.worldToScreen(back.x, back.y);
  cam.snapFromMap(p.x, p.y);
  if (back.zoom > cam.minZoom) cam.easeTo(back.x, back.y, Math.min(cam.maxZoom, back.zoom), 0.3);
}

/** The atlas is shown past its fitted framing (a 5×5 map at up to 2×, §7.2). */
export function atlasZoomed(cam: Pick<Camera, 'zoom' | 'mapZoom'>): boolean {
  return cam.zoom > cam.mapZoom * 1.04;
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
  private readonly growBtn: HTMLButtonElement;
  private readonly growNote: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly poly: SVGPolygonElement;
  private readonly metroCase: SVGPathElement;
  private readonly metroPath: SVGPathElement;
  private readonly metroStops: SVGPathElement;
  private readonly metroHoles: SVGPathElement;
  private readonly measure: CanvasRenderingContext2D | null;
  private readonly textW = new Map<string, number>();
  private net: MetroNet = { stops: [], lines: [], live: [] };
  private netKey = '';
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
  /** Where the city view was when the map opened (world px, zoom): ✕ and Esc go back there. */
  private back: { x: number; y: number; zoom: number } | null = null;
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
    // The "?" help sits at the top of the scrolling body, so it scrolls away with the district (on a landscape phone it
    // would otherwise squeeze the district into a sliver above the sticky footer).
    this.body.append(this.helpEl);
    this.sheet = h('section', { class: 'cc-cm-sheet cc-panel', 'aria-labelledby': 'cc-cm-title' }, this.handle, this.chips, this.body, this.tipSlot, this.foot);
    this.growSlot = h('span', { class: 'cc-cm-growslot', 'data-slot': 'grow' });
    // Grow to 25 districts (§3.11, §7.2): a 44 px button beside the edge line, on a 3×3 region once all 9 are owned.
    this.growBtn = h('button', { class: 'cc-btn cc-cm-grow', type: 'button', 'data-act': 'grow', html: TRANSFER_ICONS.grow }, TRANSFER_COPY.grow);
    this.growNote = h('span', { class: 'cc-cm-grownote', hidden: true, text: BLOCKED_TEXT });
    this.edgeEl = h('div', { class: 'cc-cm-edge', hidden: true }, h('span', { class: 'cc-cm-edge-text' }), this.growSlot);
    const svgNS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(svgNS, 'svg');
    this.svg.setAttribute('class', 'cc-cm-sel');
    this.svg.setAttribute('aria-hidden', 'true');
    this.poly = document.createElementNS(svgNS, 'polygon');
    // The Metro (§7.2): a dark casing, the line and its stops, under the selection outline.
    const metro = document.createElementNS(svgNS, 'g');
    metro.setAttribute('class', 'cc-cm-metro');
    this.metroCase = document.createElementNS(svgNS, 'path');
    this.metroCase.setAttribute('class', 'is-case');
    this.metroPath = document.createElementNS(svgNS, 'path');
    this.metroPath.setAttribute('class', 'is-line');
    this.metroStops = document.createElementNS(svgNS, 'path');
    this.metroStops.setAttribute('class', 'is-stop');
    // The lines pass under the atlas's name plates and icons (a mask cut at each plate), so no name is struck through;
    // a stop under its district's plate reads as the line running into the name, like a station on a transit map.
    const defs = document.createElementNS(svgNS, 'defs');
    const mask = document.createElementNS(svgNS, 'mask');
    mask.setAttribute('id', 'cc-cm-metro-mask');
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    const all = document.createElementNS(svgNS, 'rect');
    for (const [k, v] of [['x', '-10000'], ['y', '-10000'], ['width', '20000'], ['height', '20000'], ['fill', 'white']]) all.setAttribute(k, v);
    this.metroHoles = document.createElementNS(svgNS, 'path');
    this.metroHoles.setAttribute('fill', 'black');
    mask.append(all, this.metroHoles);
    defs.append(mask);
    const lines = document.createElementNS(svgNS, 'g');
    lines.setAttribute('mask', 'url(#cc-cm-metro-mask)');
    lines.append(this.metroCase, this.metroPath, this.metroStops);
    metro.append(lines);
    this.svg.append(defs, metro, this.poly);
    let m: CanvasRenderingContext2D | null = null;
    try {
      m = document.createElement('canvas').getContext('2d');
    } catch {
      m = null;
    }
    this.measure = m;
    this.el = h('div', { class: 'cc-citymap', hidden: true, role: 'dialog', 'aria-labelledby': 'cc-cm-title' }, this.svg as unknown as HTMLElement, this.head, this.edgeEl, this.sheet);
    this.el.addEventListener('click', this.onClick);
    this.wireDrag();
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** The city view ✕ and Esc return to (world px and zoom), null when the map opened from the map view or is closed. */
  get returnView(): { x: number; y: number; zoom: number } | null {
    return this.open_ && this.back ? { ...this.back } : null;
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
    this.readMetro();
    const start = g.world.districts.owned[0] ?? -1;
    const was = this.open_;
    this.open_ = true;
    this.el.hidden = false;
    this.expanded = false;
    setClass(this.sheet, 'is-full', false);
    this.select(defaultSlot(this.view, slot ?? null, start), false);
    this.layout();
    if (!was) {
      const cam = this.ctx.camera;
      this.back = cam.mapView ? null : { x: cam.x, y: cam.y, zoom: cam.zoom };
      this.onToggle?.(true);
      this.snap();
    }
    this.ctx.sfx('click');
  }

  /**
   * Build the sheet once while the map is closed (idle time after a city loads, §11.1 "City map open"): the first open
   * then skips the district view's first pass, the chips, the body with its style vignette and the panel's first
   * layout, so the 0.3 s snap starts on its first frame instead of after an 18-44 ms hitch.
   */
  prewarm(): void {
    if (this.open_) return;
    const g = this.ctx.game;
    if (g.world.region < 3 || !g.world.districts.owned.length) return;
    this.view = g.districtView();
    this.readMetro();
    this.select(defaultSlot(this.view, null, g.world.districts.owned[0] ?? -1), false);
    // One layout of the panel while it is invisible (styles and fonts resolved before the first real open).
    if (typeof this.el.getBoundingClientRect === 'function') {
      this.el.style.visibility = 'hidden';
      this.el.hidden = false;
      void this.sheet.getBoundingClientRect();
      this.el.hidden = true;
      this.el.style.visibility = '';
    }
  }

  /**
   * Close: back to the city view at minZoom centred on `toward` (a slot, or a screen point under a pinch), or, for ✕
   * and Esc, as it was when the map opened (its centre and zoom). The screen's centre is the last resort: on the map it
   * sits low on the atlas (the sheet covers the bottom half), so it would land on the region's far fogged corner.
   */
  close(toward?: { slot?: SlotId; sx?: number; sy?: number }): void {
    if (!this.open_) return;
    this.open_ = false;
    this.confirming = false;
    this.el.hidden = true;
    this.onToggle?.(false);
    const back = this.back;
    this.back = null;
    const cam = this.ctx.camera;
    if (!cam.mapView) return;
    if (toward?.slot !== undefined && toward.slot >= 0) {
      const p = this.slotCentreScreen(toward.slot);
      cam.snapFromMap(p.x, p.y);
    } else if (toward?.sx !== undefined && toward.sy !== undefined) cam.snapFromMap(toward.sx, toward.sy);
    else {
      const start = this.ctx.game.world.districts.owned[0];
      leaveMapTo(cam, back, start !== undefined ? this.slotCentreScreen(start) : { x: cam.width / 2, y: cam.height / 2 });
    }
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
    this.readMetro();
    this.render();
  }

  /** Re-read the Metro network; a change redraws the lines on the next frame. */
  private readMetro(): void {
    const net = metroNet(this.ctx.game.world);
    const key = net.stops.map((p) => `${p.slot}:${p.x},${p.y}`).join(';') + `|${net.live.join(',')}`;
    if (key === this.netKey) return;
    this.netKey = key;
    this.net = net;
    this.polyKey = '';
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
    // A 5×5 atlas zoomed past its fit runs under the edge line: the line steps aside until the zoom comes back.
    setClass(this.el, 'is-zoomed', atlasZoomed(cam));
    this.drawMetro(cam);
    if (this.slot < 0) {
      this.poly.setAttribute('points', '');
      return;
    }
    const pts = slotScreenPoly(this.ctx.game.world, cam, this.slot);
    this.poly.setAttribute('points', pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  }

  /** The Metro lines and stops in screen px (thin at any atlas zoom). */
  private drawMetro(cam: Camera): void {
    const { stops, lines } = this.net;
    let d = '';
    for (const [a, b] of lines) {
      const p = cam.worldToScreen(stops[a].x, stops[a].y);
      const q = cam.worldToScreen(stops[b].x, stops[b].y);
      d += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }
    let dots = '';
    const r = 3;
    for (const s of stops) {
      const p = cam.worldToScreen(s.x, s.y);
      dots += `M${(p.x - r).toFixed(1)} ${p.y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    this.metroCase.setAttribute('d', d);
    this.metroPath.setAttribute('d', d);
    this.metroStops.setAttribute('d', dots);
    this.metroHoles.setAttribute('d', d ? this.plateHoles(cam) : '');
  }

  /**
   * The atlas's name plates and kind icons on screen (the same sizes Atlas.draw uses), as one path to cut out of the
   * Metro lines' mask.
   */
  private plateHoles(cam: Camera): string {
    const w = this.ctx.game.world;
    const R = w.region;
    const z = cam.zoom;
    const big = Math.min(13, Math.max(9, 64 * HALF_W * z * 0.11));
    const long = 64 * HALF_W * 2 * z > 150;
    let d = '';
    const rect = (x: number, y: number, rw: number, rh: number) => {
      d += `M${x.toFixed(1)} ${y.toFixed(1)}h${rw.toFixed(1)}v${rh.toFixed(1)}h${(-rw).toFixed(1)}z`;
    };
    for (let k = 0; k < R * R; k++) {
      const r = slotRect(w, k);
      const c = cam.worldToScreen((r.x0 - r.y0) * HALF_W, (r.x0 + r.y0 + 64) * HALF_H);
      const owned = w.slotOwned[k] === 1;
      const { name, short } = slotNames(w, k);
      const label = long ? name : short;
      const font = `${owned ? 700 : 600} ${big}px system-ui, sans-serif`;
      const key = `${font}|${label}`;
      let tw = this.textW.get(key);
      if (tw === undefined) {
        if (this.measure) {
          this.measure.font = font;
          tw = this.measure.measureText(label).width;
        } else tw = label.length * big * 0.55;
        this.textW.set(key, tw);
      }
      rect(c.x - tw / 2 - 6, c.y - big * 0.7 - 2, tw + 12, big * 1.4 + 4);
      if (!owned) rect(c.x - big * 0.75, c.y - big * 1.3 - big * 0.75, big * 1.5, big * 1.5);
    }
    return d;
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
    setClass(this.edgeEl, 'has-grow', v.canGrow);
    if (v.canGrow !== (this.growSlot.firstChild !== null)) {
      if (v.canGrow) this.growSlot.append(this.growBtn, this.growNote);
      else this.growSlot.textContent = '';
    }
    if (v.canGrow) {
      // Disabled while a newer build's city is stored, with its line (§3.11).
      this.growBtn.disabled = g.saveBlocked;
      setHidden(this.growNote, !g.saveBlocked);
    }
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
    const key = JSON.stringify([s, this.lease, reactions, v.ended, this.netKey]);
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
      const m = metroLine(this.net, s.slot);
      if (m) html += `<p class="cc-cm-line is-metro">${esc(m)}</p>`;
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
    this.body.prepend(this.helpEl);
    const vig = this.body.querySelector<HTMLElement>('.cc-cm-vig');
    const c = vig ? styleVignette(s.kind) : null;
    if (vig && c) vig.append(c);
  }

  private renderFoot(s: DistrictSlotView, blocked: boolean): void {
    const f = footerModel(s, { lease: this.lease, confirming: this.confirming, blocked, funds: this.ctx.game.world.funds });
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
    else if (act === 'grow') this.ctx.actions.growRegion('map');
    else if (act === 'help') {
      const show = this.helpEl.hidden;
      setHidden(this.helpEl, !show);
      setAttr(this.helpBtn, 'aria-expanded', show ? 'true' : 'false');
      if (show) {
        this.setExpanded(true);
        this.body.scrollTop = 0;
      }
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
    this.back = null;
    this.netKey = '';
    this.net = { stops: [], lines: [], live: [] };
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
