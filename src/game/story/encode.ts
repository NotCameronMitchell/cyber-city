// ─────────────────────────────────────────────────────────────────────────────
// Story save codec (docs/STORY.md §10.8). Owner: WP-B.
//
//   encodeStory(world)        → StorySave (SaveData.story)
//   decodeStory(save, world)  → writes world.story / turf / rail / links, or
//                               returns false (the caller keeps a fresh story)
//
// Turf and rail are run-length encoded as [value, run] pairs (turf value =
// owner × 128 + str). The saved StoryState is deep-merged over
// newStoryState(seed), so a field added in a later build loads with its
// default and a malformed field falls back to it. turf.contested and every
// derived cache (turf.stats, world.vertical, mods, layers, ledger) are not
// saved; the director rebuilds them on load.
//
// A leaf module: config, state and types only (World is a type import).
// ─────────────────────────────────────────────────────────────────────────────

import { CROWNS, FACTION_IDS, GANG_IDS, STORY_PACING } from '../config';
import { MAP_SIZE } from '../types';
import type { World } from '../world';
import { emptyTurf, newStoryState } from './state';
import type { FlagValue, GangId, SkyLink, StorySave, StoryState, TurfMap } from './types';

const N = MAP_SIZE;
const AREA = N * N;
/** Turf value packing: owner × TURF_PACK + str (str ≤ 100 < 128). */
const TURF_PACK = 128;
const MAX_OWNER = 2;
const MAX_STR = 100;

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Math.floor(v) === v;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isFlag = (v: unknown): v is FlagValue => isStr(v) || isNum(v) || typeof v === 'boolean';
const inMap = (v: unknown): v is number => isInt(v) && v >= 0 && v < AREA;

// ── Run-length encoding ─────────────────────────────────────────────────────

/** [value, run] pairs for a byte-ish array. */
export function encodeRle(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = data.length;
  let i = 0;
  while (i < n) {
    const v = data[i];
    let j = i + 1;
    while (j < n && data[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

/**
 * Decode [value, run] pairs into `out` (filled from 0). Returns false, leaving
 * `out` zeroed, unless the pairs are well formed (integer values in
 * 0..maxValue, positive runs) and cover exactly `out.length` entries.
 */
export function decodeRle(pairs: unknown, out: Uint8Array | Uint16Array, maxValue = 255): boolean {
  out.fill(0);
  if (!Array.isArray(pairs) || pairs.length % 2 !== 0) return false;
  let p = 0;
  for (let k = 0; k < pairs.length; k += 2) {
    const v = pairs[k];
    const run = pairs[k + 1];
    if (!isInt(v) || v < 0 || v > maxValue || !isInt(run) || run <= 0 || p + run > out.length) {
      out.fill(0);
      return false;
    }
    if (v !== 0) out.fill(v, p, p + run);
    p += run;
  }
  if (p !== out.length) {
    out.fill(0);
    return false;
  }
  return true;
}

/** Turf owner + strength as RLE pairs of owner × 128 + str. */
export function encodeTurf(turf: Pick<TurfMap, 'owner' | 'str'>): number[] {
  const packed = new Uint16Array(AREA);
  const { owner, str } = turf;
  for (let i = 0; i < AREA; i++) {
    const o = owner[i];
    packed[i] = o > 0 && o <= MAX_OWNER ? o * TURF_PACK + Math.min(MAX_STR, str[i]) : 0;
  }
  return encodeRle(packed);
}

/** Decode turf pairs into `turf.owner` / `turf.str` (contested resets to 0). False (and empty turf) if malformed. */
export function decodeTurf(pairs: unknown, turf: Pick<TurfMap, 'owner' | 'str' | 'contested'>): boolean {
  const packed = new Uint16Array(AREA);
  turf.owner.fill(0);
  turf.str.fill(0);
  turf.contested.fill(0);
  if (!decodeRle(pairs, packed, MAX_OWNER * TURF_PACK + MAX_STR)) return false;
  for (let i = 0; i < AREA; i++) {
    const v = packed[i];
    const o = (v / TURF_PACK) | 0;
    const s = v % TURF_PACK;
    if (o === 0) continue; // strength without an owner is meaningless
    turf.owner[i] = o;
    turf.str[i] = Math.min(MAX_STR, s);
  }
  return true;
}

// ── Encode ──────────────────────────────────────────────────────────────────

/** SaveData.story for this world. JSON-safe; the StoryState is deep-copied. */
export function encodeStory(world: Pick<World, 'story' | 'turf' | 'rail' | 'links'>): StorySave {
  const t = world.turf;
  return {
    story: JSON.parse(JSON.stringify(world.story)) as StoryState,
    turf: encodeTurf(t),
    turfMeta: {
      frozenUntil: t.frozenUntil,
      seeded: { ...t.seeded },
      lowSince: { ...t.lowSince },
    },
    rail: encodeRle(world.rail),
    links: world.links.map((l) => ({ id: l.id, ax: l.ax, ay: l.ay, bx: l.bx, by: l.by })),
  };
}

// ── Decode: StoryState deep merge ───────────────────────────────────────────

/** Element checks for StoryState arrays; arrays not listed keep every element. */
const ARRAY_ITEM: Partial<Record<keyof StoryState, (v: unknown) => boolean>> = {
  beatsShown: isStr,
  goalsDone: isStr,
  goalsWaived: isStr,
  unlocks: isStr,
  logs: isInt,
  queue: (v) => isObj(v) && isStr(v.card) && isNum(v.tick),
  mods: (v) => isObj(v) && isStr(v.id) && isStr(v.label) && isNum(v.until) && isObj(v.mods),
  incomes: (v) => isObj(v) && isStr(v.id) && isStr(v.label) && isNum(v.perMonth) && isNum(v.until),
  locals: (v) => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.r) && isNum(v.until) && isNum(v.crimeAdd) && isNum(v.lvAdd),
  credits: (v) => isObj(v) && isStr(v.what) && isNum(v.n) && isNum(v.mul),
  pacts: (v) => isObj(v) && isStr(v.gang) && GANG_IDS.includes(v.gang as GangId) && isNum(v.until),
  crackdowns: (v) => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.r) && isNum(v.until) && Array.isArray(v.hit),
  railOut: (v) => isObj(v) && inMap(v.i) && isNum(v.until),
  log: (v) => isObj(v) && isNum(v.tick) && isStr(v.card),
  met: (v) => FACTION_IDS.includes(v as never),
};

/** Value checks for StoryState records; records not listed accept any JSON value. */
const RECORD_VALUE: Partial<Record<keyof StoryState, (v: unknown) => boolean>> = {
  holds: isNum,
  favor: isNum,
  mood: isNum,
  floors: isNum,
  ceils: isNum,
  flags: isFlag,
  seen: isNum,
  deals: (v) => isObj(v) && isNum(v.until) && isNum(v.cooldownUntil),
  precinctReady: isNum,
  saltReady: isNum,
  builtCounts: isNum,
  lastHostileBy: isNum,
  lastPulseBy: isNum,
  keyChoices: isNum,
  whisperSnap: isNum,
};

const nullOr =
  (check: (v: unknown) => boolean) =>
  (v: unknown): boolean =>
    v === null || check(v);

/** Checks for fields whose default is null (or a closed set); anything else falls back to the default. */
const FIELD_CHECK: Partial<Record<keyof StoryState, (v: unknown) => boolean>> = {
  chapter: (v) => isInt(v) && v >= 1 && v <= 7,
  phase: (v) => v === 'waiting' || v === 'active' || v === 'countdown' || v === 'ended',
  pending: nullOr((v) => isObj(v) && isStr(v.card) && isNum(v.tick) && isNum(v.spot)),
  open: nullOr((v) => isObj(v) && isStr(v.card) && isNum(v.spot)),
  waiting: nullOr((v) => isObj(v) && isStr(v.card) && isNum(v.tick) && isNum(v.spot) && (v.read === undefined || typeof v.read === 'boolean')),
  waiveFrom: nullOr(isNum),
  lastSpeaker: nullOr((v) => FACTION_IDS.includes(v as never)),
  countdownEnd: nullOr(isNum),
  ending: nullOr((v) => v === 'ironwork' || v === 'pearl' || v === 'lowcrown' || v === 'ledger' || v === 'quiet'),
  endingVariant: nullOr((v) => v === 'lamplight'),
  endingTick: nullOr(isNum),
  nextReview: nullOr(isNum),
  seam: nullOr(inMap),
  rng: (v) => isInt(v) && v > 0 && v <= 0xffffffff,
};

/** Generic merge of one saved value over its default (types must match; records merge per key). */
function mergeValue(def: unknown, saved: unknown, item?: (v: unknown) => boolean): unknown {
  if (saved === undefined) return def;
  if (def === null) return saved; // a nullable field added later with no check: trust the JSON
  if (Array.isArray(def)) {
    if (!Array.isArray(saved)) return def;
    return item ? saved.filter(item) : saved.slice();
  }
  if (isObj(def)) {
    if (!isObj(saved)) return def;
    const out: Json = { ...def };
    for (const [k, v] of Object.entries(saved)) {
      if (k in def) out[k] = mergeValue(def[k], v);
      else if (item ? item(v) : v !== undefined) out[k] = v;
    }
    if (item) for (const k of Object.keys(out)) if (!item(out[k])) delete out[k];
    return out;
  }
  if (typeof def === 'number') return isNum(saved) ? saved : def;
  return typeof saved === typeof def ? saved : def;
}

/**
 * Deep-merge a saved StoryState over newStoryState(seed) (§10.8). Unknown keys
 * are dropped, malformed fields fall back to their defaults. Returns null only
 * when `raw` is not an object at all.
 */
export function decodeStoryState(raw: unknown, seed: number): StoryState | null {
  if (!isObj(raw)) return null;
  const def = newStoryState(seed);
  const out = def as unknown as Json;
  for (const key of Object.keys(def) as (keyof StoryState)[]) {
    const saved = raw[key];
    const check = FIELD_CHECK[key];
    if (check) {
      if (saved !== undefined && check(saved)) out[key] = saved;
      continue;
    }
    out[key] = mergeValue(def[key], saved, ARRAY_ITEM[key] ?? RECORD_VALUE[key]);
  }
  // Migrations go here when StoryState.v changes meaning (§10.8). Only v1 exists.
  def.v = 1;
  def.rng = def.rng >>> 0 || newStoryState(seed).rng;
  if (def.log.length > STORY_PACING.logKeep) def.log = def.log.slice(-STORY_PACING.logKeep);
  def.logs = [...new Set(def.logs)];
  def.unlocks = [...new Set(def.unlocks)];
  // Missing in a save from before the pacing pass: the director works out who was met from
  // the cards already seen, so those factions don't read as a new contact mid-story.
  if (Array.isArray(raw.met)) def.met = [...new Set(def.met ?? [])];
  else delete def.met;
  // Saved clocks are never negative (a hand-edited save can't stall the floors).
  for (const k of ['chapterSec', 'sinceStartSec', 'deckSec', 'frontSec'] as const) def[k] = Math.max(0, def[k] ?? 0);
  return def;
}

/**
 * Drop queue, pending and open entries whose card id `has` doesn't know
 * (content removed in a later build, §10.8). Returns how many were dropped.
 * The director calls this with its card table on construction.
 */
export function pruneUnknownCards(story: StoryState, has: (id: string) => boolean): number {
  let dropped = 0;
  const q = story.queue.filter((e) => has(e.card));
  dropped += story.queue.length - q.length;
  story.queue = q;
  if (story.pending && !has(story.pending.card)) {
    story.pending = null;
    dropped++;
  }
  if (story.open && !has(story.open.card)) {
    story.open = null;
    dropped++;
  }
  if (story.waiting && !has(story.waiting.card)) {
    story.waiting = null;
    dropped++;
  }
  return dropped;
}

// ── Decode: turf, rail and links ────────────────────────────────────────────

function decodeTurfMeta(raw: unknown, turf: TurfMap): void {
  if (!isObj(raw)) return;
  if (isNum(raw.frozenUntil)) turf.frozenUntil = raw.frozenUntil;
  const seeded = isObj(raw.seeded) ? raw.seeded : {};
  const low = isObj(raw.lowSince) ? raw.lowSince : {};
  for (const g of GANG_IDS) {
    if (typeof seeded[g] === 'boolean') turf.seeded[g] = seeded[g] as boolean;
    if (isNum(low[g])) turf.lowSince[g] = low[g] as number;
  }
}

function decodeLinks(raw: unknown): SkyLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SkyLink[] = [];
  const ids = new Set<number>();
  const xy = (v: unknown) => isInt(v) && v >= 0 && v < N;
  for (const l of raw) {
    if (!isObj(l) || !isInt(l.id) || l.id <= 0 || ids.has(l.id)) continue;
    if (!xy(l.ax) || !xy(l.ay) || !xy(l.bx) || !xy(l.by)) continue;
    ids.add(l.id);
    out.push({ id: l.id, ax: l.ax as number, ay: l.ay as number, bx: l.bx as number, by: l.by as number });
  }
  return out;
}

export interface DecodeOptions {
  /** Known card ids; queue / pending / open entries for others are dropped. Omit to keep all. */
  knownCard?: (id: string) => boolean;
}

/**
 * Decode SaveData.story into `world` (§10.8): story, turf (+ turfMeta), rail,
 * links and nextLinkId. Atomic: returns false and leaves `world` untouched
 * when the block or its StoryState isn't an object; the caller then keeps a
 * fresh story with flag `migrated`. A malformed turf or rail run alone just
 * loads empty.
 */
export function decodeStory(
  save: unknown,
  world: Pick<World, 'seed' | 'story' | 'turf' | 'rail' | 'links' | 'nextLinkId'>,
  opts: DecodeOptions = {},
): boolean {
  if (!isObj(save)) return false;
  const story = decodeStoryState(save.story, world.seed);
  if (!story) return false;
  if (opts.knownCard) pruneUnknownCards(story, opts.knownCard);

  const turf = emptyTurf();
  decodeTurf(save.turf, turf);
  decodeTurfMeta(save.turfMeta, turf);

  const rail = new Uint8Array(AREA);
  decodeRle(save.rail, rail, 15);

  const links = decodeLinks(save.links);
  let next = 1;
  for (const l of links) if (l.id >= next) next = l.id + 1;

  // Copy into the world's own arrays so references held elsewhere stay valid.
  world.story = story;
  const wt = world.turf;
  wt.owner.set(turf.owner);
  wt.str.set(turf.str);
  wt.contested.fill(0);
  wt.frozenUntil = turf.frozenUntil;
  wt.seeded = turf.seeded;
  wt.lowSince = turf.lowSince;
  world.rail.set(rail);
  world.links = links;
  world.nextLinkId = next;
  return true;
}

/** Crown ids accepted on a saved Stratablock. */
export function isCrownId(v: unknown): boolean {
  return isStr(v) && v in CROWNS;
}
