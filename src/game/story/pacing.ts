// ─────────────────────────────────────────────────────────────────────────────
// Deck pacing (docs/STORY.md §7.1, §8.11): draw gates, card eligibility,
// weights, the five-step draw and the no-answer default. Owner: WP-A.
//
// Pure decisions: nothing here mutates story state. The director applies the
// result (delivery, seen ticks, queue drops). Time comes in two clocks:
// sim days (world.tick) and unpaused real seconds (director.activeSec).
// ─────────────────────────────────────────────────────────────────────────────

import { FACTION_IDS, STORY_PACING } from '../config';
import type { Rng } from '../rng';
import type { World } from '../world';
import { evalCond, storyContent } from './conditions';
import { spotAvailable } from './effects';
import { isActive, isRetired, isVisible, patronOf, rivalOf, standing, tierOf } from './factions';
import { NEVER_TICK } from './state';
import type { Card, FactionId } from './types';

const P = STORY_PACING;

/** Card kinds the monthly deck draw delivers (step 1 follow-ups included). */
export const DECK_KINDS: ReadonlySet<Card['kind']> = new Set<Card['kind']>(['faction', 'hostile', 'system']);
/** Card kinds shown as blocking "front" cards (beats, logs, endings). */
export const FRONT_KINDS: ReadonlySet<Card['kind']> = new Set<Card['kind']>(['beat', 'log', 'ending']);

/** The faction a card speaks for (patron / rival resolved now), or null for MOTH / system / LURE. */
export function cardFaction(world: World, card: Card): FactionId | null {
  const s = card.speaker;
  if (s === 'patron') return patronOf(world);
  if (s === 'rival') return rivalOf(world);
  if (s === 'moth' || s === 'system' || s === 'lure') return null;
  return s;
}

/** Every faction on a card (speaker and `with`). */
export function cardFactions(world: World, card: Card): FactionId[] {
  const out: FactionId[] = [];
  const a = cardFaction(world, card);
  if (a) out.push(a);
  if (card.with && card.with !== a) out.push(card.with);
  return out;
}

/** Inputs for the deck gates (§7.1 "Gates for every deck card"). */
export interface DeckGateInput {
  /** A card is open (any kind) or Charter Night is up. */
  open: boolean;
  /** A faction card waits in COMMS. */
  pending: boolean;
  /** A beat (or other front card) is due but not yet shown. */
  frontDue: boolean;
  activeSec: number;
  lastCardSec: number;
}

/** All deck gates hold: nothing open or pending, 120 unpaused s since the last card, no beat open, due or recent. */
export function deckGatesOpen(world: World, g: DeckGateInput): boolean {
  if (g.open || g.pending || g.frontDue) return false;
  if (g.activeSec - g.lastCardSec < P.minActiveSecBetween) return false;
  return world.tick - world.story.lastBeatTick >= P.beatMuteDays;
}

/** Days a card waits after showing before it can be drawn again. */
export function cooldownOf(card: Card): number {
  if (typeof card.cooldown === 'number') return card.cooldown;
  if (card.star) return P.starRetryDays;
  return P.defaultCooldown;
}

/**
 * Can this card be drawn now? Its factions must be visible and unretired, its
 * `when` must hold, its spot must resolve; deck cards also respect once, the
 * ★ rule (until its Log is owned) and the cooldown. `queued` follow-ups skip
 * once and cooldown (they were scheduled on purpose).
 */
export function cardEligible(world: World, card: Card, queued = false): boolean {
  const st = world.story;
  for (const f of cardFactions(world, card)) if (!isVisible(world, f) || isRetired(world, f)) return false;
  if (card.star && st.logs.includes(card.star)) return false;
  if (!queued) {
    const last = st.seen[card.id];
    if (last !== undefined) {
      if (card.once) return false;
      if (world.tick - last < cooldownOf(card)) return false;
    }
  }
  if (card.spot && !spotAvailable(world, card.spot)) return false;
  return evalCond(world, card.when);
}

/** Draw weight (§7.1): w × (1 + |standing|/50) × 0.5 if the same faction spoke last × 1.5 for ★. */
export function cardWeight(world: World, card: Card): number {
  const fs = cardFactions(world, card);
  if (!fs.length || card.kind !== 'faction') return 0;
  let abs = 0;
  let same = false;
  for (const f of fs) {
    abs = Math.max(abs, Math.abs(standing(world, f)));
    if (f === world.story.lastSpeaker) same = true;
  }
  let w = (card.weight ?? P.defaultWeight) * (1 + abs / 50);
  if (same) w *= 0.5;
  if (card.star) w *= 1.5;
  return w;
}

export type DrawStep = 'queue' | 'system' | 'hostile' | 'seasonal' | 'random';

export interface DrawResult {
  card: Card;
  step: DrawStep;
  /** Index into story.queue for step 1. */
  queueIndex?: number;
}

/**
 * The §7.1 draw, run at month rollover once the gates hold. Returns the
 * winning card (or null) and the indices of due queue entries that turned out
 * ineligible (the caller drops them). Steps 1–3 skip the 60-day gap and the
 * chance roll. `deckOpen` = `unlock comms` owned: before it only system cards
 * (step 2) can come.
 */
export function drawCard(
  world: World,
  rng: Rng,
  deckOpen: boolean,
  cardRateMul: number,
): { pick: DrawResult | null; drop: number[] } {
  const idx = storyContent();
  const st = world.story;
  const tick = world.tick;
  const drop: number[] = [];
  // The chance roll always consumes one draw so runs stay deterministic.
  const roll = rng.next();

  // 1. A due queued follow-up.
  if (deckOpen) {
    for (let k = 0; k < st.queue.length; k++) {
      const q = st.queue[k];
      if (q.tick > tick) continue;
      const card = idx.cards.get(q.card);
      if (!card || !DECK_KINDS.has(card.kind)) continue;
      if (cardEligible(world, card, true)) return { pick: { card, step: 'queue', queueIndex: k }, drop };
      drop.push(k);
    }
  }

  // 2. A system card whose condition holds.
  for (const card of idx.system) {
    if (cardEligible(world, card)) return { pick: { card, step: 'system' }, drop };
  }
  if (!deckOpen) return { pick: null, drop };

  // 3. A Hostile faction's ⚑ card (most hostile first).
  let hostile: Card | null = null;
  let worst = Infinity;
  if (tick - st.lastHostileTick >= P.hostileGap) {
    for (const f of FACTION_IDS) {
      const card = idx.hostile[f];
      if (!card || !isActive(world, f)) continue;
      const s = standing(world, f);
      if (tierOf(s) !== 'hostile') continue;
      if (tick - (st.lastHostileBy[f] ?? NEVER_TICK) < P.hostileEvery) continue;
      if (card.spot && !spotAvailable(world, card.spot)) continue;
      if (!evalCond(world, card.when)) continue;
      if (s < worst) {
        worst = s;
        hostile = card;
      }
    }
  }
  if (hostile) return { pick: { card: hostile, step: 'hostile' }, drop };

  if (tick - st.lastCardTick < P.minDaysBetween) return { pick: null, drop };

  // 4. A seasonal card that hasn't shown in the last 300 d.
  for (const card of idx.seasonal) {
    const last = st.seen[card.id];
    if (last !== undefined && tick - last < P.seasonalGapDays) continue;
    if (cardEligible(world, card)) return { pick: { card, step: 'seasonal' }, drop };
  }

  // 5. A weighted random draw, at chance 0.35 × cardRateMul.
  if (roll >= P.cardChance * cardRateMul) return { pick: null, drop };
  let total = 0;
  const pool: { card: Card; w: number }[] = [];
  for (const card of idx.deck) {
    if (!cardEligible(world, card)) continue;
    const w = cardWeight(world, card);
    if (w > 0) {
      pool.push({ card, w });
      total += w;
    }
  }
  if (!pool.length) return { pick: null, drop };
  let r = rng.next() * total;
  for (const p of pool) {
    r -= p.w;
    if (r < 0) return { pick: { card: p.card, step: 'random' }, drop };
  }
  return { pick: { card: pool[pool.length - 1].card, step: 'random' }, drop };
}

/** Has a pending faction card waited long enough for its ‡ default (20 sim days AND 60 unpaused s)? */
export function pendingExpired(world: World, sinceTick: number, waitedSec: number): boolean {
  return world.tick - sinceTick >= P.pendingDays && waitedSec >= P.pendingMinSec;
}

/** Index of a card's ‡ default choice (else its last unlocked choice, else 0). */
export function defaultChoice(world: World, card: Card): number {
  const k = card.choices.findIndex((c) => c.default);
  if (k >= 0) return k;
  for (let i = card.choices.length - 1; i >= 0; i--) if (evalCond(world, card.choices[i].requires)) return i;
  return 0;
}
