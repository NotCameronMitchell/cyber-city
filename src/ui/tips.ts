// ─────────────────────────────────────────────────────────────────────────────
// First-use tips (docs/EXPANSION.md §7.6, Appendix A). The first time the
// player picks one of the new tools, and the first time the sim raises a
// 'hint' ($$ blocks, a highway with no ramps, noisy homes), a small card in
// the gesture-hint slot shows one line, an icon and a Got it button.
//
// One item at a time: the one-time gesture hint goes first, then the tip. A tip
// shows only while no tray is open, no drag or ✓ confirm is in progress and no
// story card, sheet, message banner or dialog is up; otherwise it waits (it is
// never dropped). It hides after 8 s on screen. Seen ids are kept per device
// in TIPS_KEY (a JSON array); a storage failure only means a tip may repeat.
// ─────────────────────────────────────────────────────────────────────────────

import { storageGet, storageSet } from '../game/game';
import type { HintId } from '../game/events';
import type { ToolId } from '../game/types';
import { h, replayClass, setHtml, setText } from './dom';
import { icon, type IconName } from './icons';

export const TIPS_KEY = 'cybercity.ui.tips.v1';
/** Seconds a tip stays on screen (paused while something covers it). */
export const TIP_SEC = 8;
/** Quiet seconds between two tips, so they never read as one stream. */
export const TIP_GAP = 2;

/**
 * Megacity tips (MEGACITY §7.7, Appendix A): the UI raises them from game events (a grant, the first City map, the
 * first annex, the first lobby, a Skeleton Row annex, the Legacy chip) and from tools (Skybridge, Pump House, the
 * Spire's sponsor step); the three district sim hints come from the advisor's news lines (`newsTip`).
 */
export type MegaTipId = 'grant' | 'citymap' | 'annexed' | 'skybridge' | 'skylobby' | 'frame' | 'pumphouse' | 'sponsor' | 'legacy' | 'floodplain' | 'brownfield' | 'ruins';
export type TipId = 'avenue' | 'highway' | 'alley' | 'skyway' | 'seaport' | 'airport' | 'spaceport' | 'academy' | HintId | MegaTipId;

/** Appendix A, verbatim (one line each, ≤ 110 characters). */
export const TIPS: Record<TipId, { text: string; icon: IconName }> = {
  avenue: { icon: 'avenue', text: "Avenues carry twice a street's traffic. Drag one over a street to widen it: you pay the difference." },
  highway: { icon: 'highway', text: 'Highways carry 5× the traffic, but no lots. Cross one with a street for ramps; run it off the map for trade.' },
  alley: { icon: 'alley', text: 'Back alleys are cheap. Homes beside them stay affordable and hold more people, but crime rises.' },
  skyway: { icon: 'skyway', text: 'Skyways carry cars over anything. End one on a street for a ramp, or run it into a megastructure.' },
  seaport: { icon: 'seaport', text: 'Pick a highlighted shore: one side on open water. Ships bring Fab trade, and some noise.' },
  airport: { icon: 'airport', text: 'Runways are loud: keep homes back. Shops 8 to 16 tiles away do better business.' },
  spaceport: { icon: 'spaceport', text: 'The tower takes 240 days and at least 4 minutes to rise. Tap it to choose who holds launch rights.' },
  academy: { icon: 'academy', text: 'Schools lift nearby blocks toward $$ and $$$, and turn Fab Yards clean.' },
  wealth: { icon: 'tiers', text: 'Blocks are getting richer. Data → Wealth shows $, $$ and $$$; tap a block to see what lifts it.' },
  ramps: { icon: 'highway', text: 'Your highway has no on-ramps, so nothing uses it. Drag a street across it.' },
  noise: { icon: 'noise', text: 'Noise from highways and runways is pulling homes down. Tap a block to see why.' },
  // MEGACITY Appendix A, verbatim.
  grant: { icon: 'grant', text: 'You earned a land grant. Open the City map to choose where your city grows next.' },
  citymap: { icon: 'map', text: 'Tap a district next to your city to see its land, perks, goals and who wants it. Annexing uses one grant.' },
  annexed: { icon: 'map', text: 'Roads, power and services cross into the new district like anywhere else. Inspect shows its perks.' },
  skybridge: { icon: 'skybridge', text: 'Tap a tall tower: its lanes light up at bridge height. Anything lower passes under. Skyways are for cars.' },
  skylobby: { icon: 'skybridge', text: 'Three linked towers make a Sky Lobby: fewer car trips, higher land value and visitors.' },
  frame: { icon: 'stack', text: "Skeleton Row's frames are half-built towers. Tap one to finish it as a Stratablock." },
  pumphouse: { icon: 'rain', text: 'Pump Houses raise the canals around them into new land, one ring a month.' },
  sponsor: { icon: 'spire', text: "Choose who pays for this Spire. The sponsor's style, jobs and power go with it." },
  legacy: { icon: 'star', text: 'Your ending has its own landmark now. Find it under Deals, in the Legacy chip.' },
  floodplain: { icon: 'rain', text: "Reedmere's floodplain stops at level 2. A Floodwatch Station lets it grow tall." },
  brownfield: { icon: 'smog', text: "Kessel Flats' brownfield smog fades as the soil is built on, or under parks." },
  ruins: { icon: 'res', text: 'Ruins come back as homes once a road reaches them and the power is on.' },
};

/** The advisor's district lines (sim/advisor.ts, Appendix B) raise the matching sim tip (no HintId for them). */
export function newsTip(text: string): TipId | null {
  if (!text.startsWith('Advisor:')) return null;
  if (text.includes('floodplain')) return 'floodplain';
  if (text.includes('brownfield')) return 'brownfield';
  if (text.includes('ruins in the Sunk')) return 'ruins';
  return null;
}

const TOOL_TIPS: ReadonlySet<string> = new Set<TipId>(['avenue', 'highway', 'alley', 'skyway', 'seaport', 'airport', 'spaceport', 'academy', 'skybridge', 'pumphouse', 'sponsor']);

/** The tip a tool shows the first time it is picked, if any (the Corp Spire's is its sponsor step, §7.7). */
export function toolTip(tool: ToolId): TipId | null {
  if (tool === 'spire') return 'sponsor';
  return TOOL_TIPS.has(tool) ? (tool as TipId) : null;
}

/**
 * The tip queue and its card. `blocked()` says whether anything that a tip must never
 * cover is up (tray, drag, confirm, story surface, message banner, dialog, the gesture hint).
 */
export class Tips {
  readonly el: HTMLElement;
  private readonly ico: HTMLElement;
  private readonly text: HTMLElement;
  private readonly seen: Set<string>;
  private readonly queue: TipId[] = [];
  private current: TipId | null = null;
  /** Seconds the current tip has been on screen. */
  private shown = 0;
  /** Quiet seconds left before the next tip may show. */
  private gap = 0;

  constructor(
    slot: HTMLElement,
    private readonly blocked: () => boolean,
  ) {
    this.ico = h('span', { class: 'cc-tip-ico' });
    this.text = h('span', { class: 'cc-tip-text' });
    const ok = h('button', { class: 'cc-tip-ok', type: 'button', 'data-act': 'tip-ok', text: 'Got it' });
    this.el = h('div', { class: 'cc-tip cc-chipglass', hidden: true, role: 'status', 'aria-live': 'polite' }, this.ico, this.text, ok);
    ok.addEventListener('click', () => this.dismiss());
    slot.append(this.el);
    this.seen = new Set(readSeen());
  }

  /** The tip on screen (null when none is showing). */
  get showing(): TipId | null {
    return this.el.hidden ? null : this.current;
  }

  /** Waiting tips (the current one first). For tests and the harness. */
  get pending(): readonly TipId[] {
    return this.current ? [this.current, ...this.queue] : [...this.queue];
  }

  /**
   * The active tool changed (before onTool): a tool's tip never outlives its tool. A tip for
   * another tool, on screen or queued, is dropped without being marked seen, so it shows the
   * next time its own tool is picked. Hint tips stay.
   */
  onToolChange(tool: ToolId): void {
    const keep = toolTip(tool);
    for (let k = this.queue.length - 1; k >= 0; k--) {
      const id = this.queue[k];
      if (TOOL_TIPS.has(id) && id !== keep) this.queue.splice(k, 1);
    }
    if (this.current && TOOL_TIPS.has(this.current) && this.current !== keep) {
      this.current = null;
      this.el.hidden = true;
    }
  }

  /** A tool was picked: queue its first-use tip. */
  onTool(tool: ToolId): void {
    const id = toolTip(tool);
    if (id) this.enqueue(id);
  }

  /** The sim raised a hint (§2.9 'hint'): queue it. */
  onHint(id: HintId): void {
    if (id in TIPS) this.enqueue(id);
  }

  /** A game moment raised a Megacity tip (a grant, an annex, a lobby, the Legacy chip): queue it once per device. */
  show(id: TipId): void {
    if (id in TIPS) this.enqueue(id);
  }

  /** The City map opened: its first-use tip. */
  onCityMap(): void {
    this.enqueue('citymap');
  }

  /** Show tips in another slot (the City map's while it is open, the dock's otherwise). */
  moveTo(slot: HTMLElement): void {
    if (this.el.parentElement !== slot) slot.append(this.el);
  }

  private enqueue(id: TipId): void {
    if (this.seen.has(id) || this.current === id || this.queue.includes(id)) return;
    this.queue.push(id);
  }

  /** Per frame (cheap): show the next tip when nothing covers its slot; pause the clock while something does. */
  update(dt: number): void {
    if (!this.current && !this.queue.length) return;
    const blocked = this.blocked();
    if (blocked) {
      if (!this.el.hidden) this.el.hidden = true;
      return;
    }
    const step = dt > 0 && dt < 1 ? dt : 0;
    if (!this.current) {
      if (this.gap > 0) {
        this.gap -= step;
        return;
      }
      this.current = this.queue.shift()!;
      this.shown = 0;
      const t = TIPS[this.current];
      setHtml(this.ico, icon(t.icon));
      setText(this.text, t.text);
    }
    if (this.el.hidden) {
      this.el.hidden = false;
      replayClass(this.el, 'is-in');
    }
    this.shown += step;
    if (this.shown >= TIP_SEC) this.dismiss();
  }

  /** Got it (or the 8 s ran out): remember it and make room for the next. */
  dismiss(): void {
    const id = this.current;
    this.current = null;
    this.el.hidden = true;
    if (!id) return;
    this.gap = TIP_GAP;
    this.seen.add(id);
    storageSet(TIPS_KEY, JSON.stringify([...this.seen]));
  }

  /** A new world: drop what was queued (it was about the old city's tools). Seen ids stay. */
  reset(): void {
    this.queue.length = 0;
    if (this.current) {
      this.current = null;
      this.el.hidden = true;
    }
  }
}

function readSeen(): string[] {
  const raw = storageGet(TIPS_KEY);
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
