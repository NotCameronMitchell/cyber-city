// ─────────────────────────────────────────────────────────────────────────────
// StoryDirector: chapter flow, deck, standing, Trace, deals, endings, view()
// and visual (docs/STORY.md §5–§7, §10.9, §11). Owner: WP-A.
//
// Step 0 stub: the final public API, inert. It drains world.signals, derives
// world.mods / world.layers on construction, returns a valid empty StoryView
// and never blocks the sim, so the sandbox runs exactly as before.
//
// Lifecycle: Game builds a new director whenever game.world is replaced (new
// city, load, restore), after the Simulation exists and before its first
// recomputeAll(). Never cache game.story across a 'world' event.
// ─────────────────────────────────────────────────────────────────────────────

import { DAYS_PER_MONTH } from '../types';
import type { Game } from '../game';
import type { World } from '../world';
import { composeLayers } from './mods';
import { resolveMods } from './resolve';
import { emptyStoryView } from './state';
import * as turf from './turf';
import type { EndingId, FactionId, GangId, Result, StoryView, VisualState } from './types';
import * as vertical from './vertical';

const NOT_YET: Result = { ok: false, reason: 'Not available yet', cost: 0 };

export class StoryDirector {
  /** Everything story-specific the renderer reads, once per frame (§9). Mutated in place. */
  readonly visual: VisualState = {
    presence: 0,
    traceFlicker: 0,
    palette: null,
    candles: 0,
    lureCold: false,
    revealed: false,
    mural: false,
    crackdowns: [],
  };

  /** Unpaused real seconds this session (not saved). */
  activeSec = 0;

  private readonly game: Game;
  private readonly world: World;
  private cached: StoryView | null = null;

  constructor(game: Game) {
    this.game = game;
    this.world = game.world;
    // Derived on load (§10.8): turf stats, vertical caches, then mods and layers.
    turf.refreshStats(this.world);
    vertical.refresh(this.world);
    this.refreshMods();
  }

  /** A card is open and must pause the sim (Game sets speed 0 and restores it afterwards). */
  get blocking(): boolean {
    return false;
  }

  /** Per frame: real-time gates, banner and pending timers. `paused` = sim speed 0. */
  update(dt: number, paused: boolean): void {
    if (!paused) this.activeSec += dt;
  }

  /** After each sim.step(): signals, holds, goals, triggers, queue, pending timeout; onMonth on rollover. */
  onDay(): void {
    const w = this.world;
    vertical.onDay(w);
    // TODO(WP-A): consume signals (build reactions, milestones, gangSurge, corpGrant), holds, goals,
    // triggers, queue and the pending timeout.
    if (w.signals.length) w.signals.length = 0;
    if (w.tick % DAYS_PER_MONTH === 0) this.onMonth();
  }

  /** Month rollover, after the sim's settleMonth (§11 onMonth order). */
  onMonth(): void {
    const w = this.world;
    // 1. TODO(WP-A): expire mods, incomes, locals, pacts, deals and crackdowns.
    // 2–3. Turf, then vertical.
    turf.update(w);
    vertical.refresh(w);
    // 4–5. TODO(WP-A): metrics, mood, standings, tiers, pulses, drift, favorMonthly; Trace.
    // 6. Mods, layers and the story ledger.
    this.refreshMods();
    const up = vertical.upkeep(w);
    w.ledger.income.length = 0;
    w.ledger.expense.length = 0;
    if (up.skybridges > 0) w.ledger.expense.push({ label: 'Skybridges', amount: Math.round(up.skybridges) });
    if (up.rail > 0) w.ledger.expense.push({ label: 'Ribbon Rail', amount: Math.round(up.rail) });
    // 7. TODO(WP-A): goals, triggers and the card draw.
  }

  /** Answer the open card. */
  choose(_choiceIndex: number): void {}
  /** Open the pending COMMS card. */
  openPending(): void {}
  /** Send the open faction card back to COMMS (keeps its no-answer timer). */
  later(): void {}

  takeDeal(_f: FactionId): Result {
    return NOT_YET;
  }
  signPact(_g: GangId): Result {
    return NOT_YET;
  }
  sendSalt(_f: FactionId): Result {
    return NOT_YET;
  }
  nudge(_f: FactionId): Result {
    return NOT_YET;
  }
  chooseEnding(_id: EndingId): Result {
    return NOT_YET;
  }
  /** Charter Night: six more months. */
  recount(): void {}

  /** Re-resolve mods and rebuild the view (WP-C calls it after a crackdown, pact or stage change). */
  markDirty(): void {
    this.refreshMods();
    this.cached = null;
    this.game.events.emit('story');
  }

  /** world.mods ← resolveMods; world.layers ← composeLayers(layerParts). */
  private refreshMods(): void {
    this.world.mods = resolveMods(this.world);
    composeLayers(this.world);
  }

  /** Cached plain-data view for the UI, every token filled. */
  view(): StoryView {
    return (this.cached ??= emptyStoryView(this.world.story));
  }
}
