// ─────────────────────────────────────────────────────────────────────────────
// Tiny builders for story content (docs/STORY.md §10.2–§10.3 syntax → data).
// Every helper returns a plain object of the closed vocabulary in ../types, so
// content files read close to the spec's text notation:
//
//   `Board +5`                    → favor('board', 5)
//   `[demandInd +0.1, 720d]`      → mod(720, { demandInd: 0.1 })
//   `flag patron=basalt`          → setFlag('patron', 'basalt')
//   `trace >= 25 & !revealed`     → all(m('trace', '>=', 25), noFlag('revealed'))
//
// `card()` fills the ids (and default labels) of the `mod`, `income` and
// `local` effects it holds, from the card id and the choice position, so a
// repeat of the same choice refreshes its modifier instead of stacking it.
// Pure data, no runtime dependencies beyond types.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuildingType, NewsItem } from '../../types';
import type {
  Card,
  Choice,
  Condition,
  Effect,
  EndingId,
  FactionId,
  FactionRef,
  FlagValue,
  GangId,
  Metric,
  ModPatch,
  Op,
  Target,
  Unlockable,
} from '../types';

// ── Conditions ──────────────────────────────────────────────────────────────

/** Always true (`all` of nothing). Used for "new city" triggers, "720 d" fallbacks and always-on rows. */
export const ALWAYS: Condition = { all: [] };

/** Metric comparison. An array of metrics is summed. */
export const m = (metric: Metric | Metric[], op: Op, v: number): Condition => ({ m: metric, op, v });
/** `flag x` (truthy) or `flag x=y`. */
export const flagIs = (key: string, eq?: FlagValue): Condition => (eq === undefined ? { flag: key } : { flag: key, eq });
/** `!flag x`. */
export const noFlag = (key: string): Condition => ({ not: { flag: key } });
export const not = (c: Condition): Condition => ({ not: c });
export const all = (...c: Condition[]): Condition => ({ all: c });
export const any = (...c: Condition[]): Condition => ({ any: c });
/** `hold(c, Nd)`: true after `days` consecutive days of `c`; `key` is the goal id. */
export const hold = (c: Condition, days: number, key: string): Condition => ({ hold: c, days, key });

// ── Effects ─────────────────────────────────────────────────────────────────

/** `CR ±n`. */
export const funds = (v: number): Effect => ({ t: 'funds', v });
/** `Faction ±n` (favor). */
export const favor = (f: FactionRef, v: number): Effect => ({ t: 'favor', f, v });
/** `Trace ±n`. */
export const trace = (v: number): Effect => ({ t: 'trace', v });
/** `[k v & …, Nd]`. `id` is filled by `card()` unless given; `label` defaults to the card title. */
export const mod = (days: number | 'perm', mods: ModPatch, label = '', id = ''): Effect => ({ t: 'mod', id, label, days, mods });
/** `↻ ±n/mo ×Nmo "Label"`. */
export const income = (label: string, perMonth: number, months: number, id = ''): Effect => ({
  t: 'income',
  id,
  label,
  perMonth,
  months,
});
/** `local(at, rN, Nd) crime ±x` / `lv ±x`. */
export const local = (at: Target, r: number, days: number, add: { crimeAdd?: number; lvAdd?: number }, id = ''): Effect => ({
  t: 'local',
  id,
  at,
  r,
  days,
  ...add,
});
/** `turf str <gang> ±v (at, rN)`. */
export const turfStr = (gang: GangId | 'all', at: Target, v: number, r?: number): Effect =>
  r === undefined ? { t: 'turf', gang, op: 'str', at, v } : { t: 'turf', gang, op: 'str', at, r, v };
/** `turf clear <gang> (at, rN)`. */
export const turfClear = (gang: GangId | 'all', at: Target, r: number): Effect => ({ t: 'turf', gang, op: 'clear', at, r });
/** `turf flip <from>→<to> (at, rN)`. */
export const turfFlip = (from: GangId, to: GangId, at: Target, r: number): Effect => ({ t: 'turf', gang: from, op: 'flip', at, r, to });
/** `turf seed <gang> (at) v`: a 3×3 patch at strength v. */
export const turfSeed = (gang: GangId, at: Target, v: number): Effect => ({ t: 'turf', gang, op: 'seed', at, v });
/** `turf freeze Nd`. */
export const turfFreeze = (days: number): Effect => ({ t: 'turf', gang: 'all', op: 'freeze', at: 'city', days });
/** `offline …`: see §10.3 (max 30 d). */
export const offline = (
  what: BuildingType[] | 'plant' | 'rail' | 'district' | 'nearTurf',
  n: number | 'all',
  days: number,
  where: { at?: Target; r?: number; gang?: GangId } = {},
): Effect => ({ t: 'offline', what, n, days, ...where });
/** `abandon <zone> n (at, rN)`. */
export const abandon = (at: Target, r: number, n: number, zone?: 'res' | 'com' | 'ind'): Effect =>
  zone ? { t: 'abandon', at, r, n, zone } : { t: 'abandon', at, r, n };
/** `renew (at, rN)`. */
export const renew = (at: Target, r: number): Effect => ({ t: 'renew', at, r });
export const unlock = (what: Unlockable): Effect => ({ t: 'unlock', what });
/** `credit <type> ×n ×mul`. */
export const credit = (what: BuildingType | 'patronExclusive', n: number, mul: number): Effect => ({ t: 'credit', what, n, mul });
/** `flag key` (= true), `flag key=v`, `flag key +1`, `flag key=$patron`. */
export const setFlag = (key: string, v: FlagValue | '+1' | '$patron' = true): Effect => ({ t: 'flag', key, v });
export const floor = (f: FactionId, v: number): Effect => ({ t: 'floor', f, v });
export const ceil = (f: FactionId, v: number): Effect => ({ t: 'ceil', f, v });
export const pact = (gang: GangId, months: number): Effect => ({ t: 'pact', gang, months });
/** `queue <card> +Nd` (`+0d` = chained). */
export const queue = (card: string, days: number): Effect => ({ t: 'queue', card, days });
/** `Log n`. */
export const log = (n: number): Effect => ({ t: 'log', n });
export const reveal = (): Effect => ({ t: 'reveal' });
export const news = (text: string, kind: NewsItem['kind']): Effect => ({ t: 'news', text, kind });
/** `gangAction` (`crackdown` also sets lastCrackdownTick). */
export const gangAction = (crackdown = false): Effect => (crackdown ? { t: 'gangAction', crackdown: true } : { t: 'gangAction' });
export const countdown = (days: number): Effect => ({ t: 'countdown', days });
export const charterNight = (): Effect => ({ t: 'charterNight' });
export const ending = (id: EndingId): Effect => ({ t: 'ending', id });
/** `if (c) {then} else {else}`. */
export const when = (c: Condition, then: Effect[], otherwise?: Effect[]): Effect =>
  otherwise ? { t: 'if', c, then, else: otherwise } : { t: 'if', c, then };

// ── Choices ─────────────────────────────────────────────────────────────────

/** A plain choice. */
export const choice = (label: string, ...fx: Effect[]): Choice => ({ label, fx });
/** The ‡ default choice. */
export const dflt = (label: string, ...fx: Effect[]): Choice => ({ label, fx, default: true });
/** A `[req …]` choice, greyed out with `lockedHint` while `requires` fails. */
export const locked = (label: string, requires: Condition, lockedHint: string, ...fx: Effect[]): Choice => ({
  label,
  requires,
  lockedHint,
  fx,
});

// ── Cards ───────────────────────────────────────────────────────────────────

/** 'NOBODY BREATHES AT 3 A.M.' → 'Nobody breathes at 3 a.m.' (default modifier label). */
export function sentenceCase(title: string): string {
  const s = title.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fill empty ids / labels of id-bearing effects, recursing into `if`. */
function stamp(fx: Effect[], prefix: string, label: string, counter: { n: number }): void {
  for (const e of fx) {
    if (e.t === 'mod' || e.t === 'income' || e.t === 'local') {
      if (!e.id) e.id = `${prefix}.${counter.n}`;
      counter.n++;
      if ((e.t === 'mod' || e.t === 'income') && !e.label) e.label = label;
    } else if (e.t === 'if') {
      stamp(e.then, prefix, label, counter);
      if (e.else) stamp(e.else, prefix, label, counter);
    }
  }
}

/**
 * Finalise a card: ids of `mod` / `income` / `local` effects become
 * `<card id>/<show|cN>.<k>` and empty modifier labels become the card title in
 * sentence case. Returns the same object.
 */
export function card(c: Card): Card {
  const label = sentenceCase(c.title);
  if (c.onShow) stamp(c.onShow, `${c.id}/show`, label, { n: 0 });
  c.choices.forEach((ch, i) => stamp(ch.fx, `${c.id}/c${i}`, label, { n: 0 }));
  return c;
}

/** Stamp ids on a loose effect list (deals, pulses, rewards) that sits outside a card. */
export function effects(prefix: string, label: string, fx: Effect[]): Effect[] {
  stamp(fx, prefix, label, { n: 0 });
  return fx;
}
