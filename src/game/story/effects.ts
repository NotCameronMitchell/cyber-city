// ─────────────────────────────────────────────────────────────────────────────
// Story effects (docs/STORY.md §10.3): the applier for the closed vocabulary,
// target and spot resolution, token fill, hint chips and effect text.
// Owner: WP-A.
//
//   applyEffects(host, fx, ctx)  apply left to right; an effect whose target
//                                can't be resolved is skipped, never an error
//   findSpot / spotAvailable     §7.1 spot rules
//   fillTokens                   {city} {district} {patron} {rival} {year} {coherence} …
//   hintsFor / effectsText       choice hint chips and the exact-effects popover
//   writeLocals                  story.locals → world.layerParts.local → composeLayers
//
// Director-level effects (queue, log, countdown, charterNight, ending, flag
// hooks) go through the EffectHost the director implements.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, FACTION_IDS, FACTION_LABELS, GANG_IDS, GANG_NEWS_NAME, STANDING, TRACE, TURF } from '../config';
import { capitalizeFirst, districtName } from '../news';
import type { Rng } from '../rng';
import { DAYS_PER_MONTH, MAP_SIZE, Terrain, ZoneType, type Building, type BuildingType } from '../types';
import type { World } from '../world';
import { evalCond, storyContent } from './conditions';
import { changeFavor, endingRules, isVisible, patronOf, resolveRef, rivalOf } from './factions';
import { composeLayers, resetLayers } from './mods';
import { coherenceFor } from './state';
import * as turf from './turf';
import type {
  Effect,
  EndingId,
  FactionId,
  FlagValue,
  GangId,
  Hint,
  ModPatch,
  SimMods,
  SpotRule,
  Target,
  Unlockable,
} from './types';
import * as vertical from './vertical';

const N = MAP_SIZE;
const AREA = N * N;
const MAX_OFFLINE = 30;

/** What the director provides to effects that touch its scheduling. */
export interface EffectHost {
  readonly world: World;
  /** The story RNG (the host keeps story.rng in sync). */
  readonly rng: Rng;
  /** Schedule a card `days` from now (0 = chained / next). */
  queue(card: string, days: number): void;
  /** Own Silt Log n and show its card after the current one closes. */
  log(n: number): void;
  /** A flag was written (the director reacts to tuningActive, revealed, …). */
  flagSet(key: string, v: FlagValue): void;
  countdown(days: number): void;
  charterNight(): void;
  ending(id: EndingId): void;
}

/** Per-application context: the card's spot and a few values effects pass to later ones. */
export interface EffectCtx {
  /** The card's spot tile index, or −1. */
  spot: number;
  /** Deal effects: permanent mods end with the deal. */
  dealUntil?: number;
  /** Name of the last building an `offline` effect hit ({plant} / {building} in news). */
  lastName?: string;
  /** Tile the last `offline` effect hit ({district} in news). */
  lastAt?: number;
}

// ── Small helpers ───────────────────────────────────────────────────────────

const idxOf = (x: number, y: number) => y * N + x;
const xOf = (i: number) => i % N;
const yOf = (i: number) => (i / N) | 0;
const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function shuffleInPlace<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** Calls fn(i) for every tile within Euclidean r of tile (cx, cy) (integer tile distance). */
function forDisc(cx: number, cy: number, r: number, fn: (i: number) => void): void {
  const rr = Math.max(0, r);
  const xa = Math.max(0, Math.floor(cx - rr));
  const xb = Math.min(N - 1, Math.ceil(cx + rr));
  const ya = Math.max(0, Math.floor(cy - rr));
  const yb = Math.min(N - 1, Math.ceil(cy + rr));
  const r2 = rr * rr;
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) fn(y * N + x);
    }
}

const isDeveloped = (world: World, i: number) => {
  const t = world.tiles[i];
  return t.zone !== ZoneType.None && t.level > 0 && !t.abandoned && t.buildingId < 0;
};

// ── Trace, reveal, unlocks, flags ───────────────────────────────────────────

/** Is the Trace gauge ignoring changes (revealed, frozen, retired by the ending, or locked at 100)? */
export function traceLocked(world: World): boolean {
  const s = world.story;
  return s.revealed || !!s.flags.traceFrozen || !!endingRules(world)?.retireTrace || s.trace >= TRACE.max;
}

/** Raise or lower Trace (§2.5). Returns the change applied. Emits 'trace'. */
export function addTrace(world: World, v: number): number {
  const s = world.story;
  if (!v || !Number.isFinite(v) || traceLocked(world)) return 0;
  if (v > 0) s.traceRaisedThisMonth = true;
  const next = Math.max(0, Math.min(TRACE.max, s.trace + v));
  const d = next - s.trace;
  if (!d) return 0;
  s.trace = next;
  world.events.emit('trace', { value: Math.round(next) });
  return d;
}

/** Revealed, permanently (§2.5). */
export function revealStory(world: World): void {
  const s = world.story;
  if (s.revealed) return;
  s.revealed = true;
  s.flags.revealed = true;
  world.events.emit('trace', { value: Math.round(s.trace) });
}

/** Default unlock news lines (§5.0) when the content gives none. */
const UNLOCK_NEWS: Partial<Record<string, string>> = {
  factions: 'Unlocked: Factions. Everyone wants the switch.',
  comms: 'Unlocked: COMMS. Messages meant for no one, routed to you.',
  deals: 'Unlocked: Deals. Friendly factions will trade.',
  stack: 'Unlocked: Stratablock. Homes, shops and jobs, stacked.',
  crackdown: 'Unlocked: Crackdown. Inspect a precinct to send the wasps.',
  pact: 'Unlocked: Pacts. Some crews will keep to their streets.',
  turfOverlay: 'Unlocked: Turf overlay. See whose streets are whose.',
  skybridge: 'Unlocked: Skybridge. Link two towers across the sky.',
  rail: 'Unlocked: Ribbon Rail. Join two stations with light.',
  crowns: 'Unlocked: Crowns. Finish a Stratablock, pick a side.',
  glarewall: "Unlocked: Glarewall. Nacre's light, on your corners.",
  foundry: "Unlocked: Foundry Spine. Basalt's fire, on your grid.",
  memorial: 'Unlocked: Sunk Memorial. Eleven thousand names.',
};

/** Own a story unlock: news line and 'unlock' event (once). Returns true if new. */
export function unlockStory(world: World, what: Unlockable): boolean {
  const s = world.story;
  if (s.unlocks.includes(what)) return false;
  s.unlocks.push(what);
  const line = storyContent().unlockNews[what] ?? UNLOCK_NEWS[what];
  if (line) world.addNews(line, 'info');
  world.events.emit('unlock', { what });
  return true;
}

// ── Targets and spots (§10.1, §7.1) ─────────────────────────────────────────

/** Tile index of the centre of the largest 4-connected abandoned cluster, or −1. */
const seenBuf = new Uint8Array(AREA);
const queueBuf = new Int32Array(AREA);
export function largestAbandoned(world: World): number {
  const tiles = world.tiles;
  seenBuf.fill(0);
  let best = -1;
  let bestN = 0;
  for (let s = 0; s < AREA; s++) {
    if (seenBuf[s] || !tiles[s].abandoned) continue;
    let head = 0;
    let tail = 0;
    queueBuf[tail++] = s;
    seenBuf[s] = 1;
    let sx = 0;
    let sy = 0;
    while (head < tail) {
      const i = queueBuf[head++];
      const x = xOf(i);
      const y = yOf(i);
      sx += x;
      sy += y;
      for (let k = 0; k < 4; k++) {
        if ((k === 0 && x === 0) || (k === 1 && x === N - 1) || (k === 2 && y === 0) || (k === 3 && y === N - 1)) continue;
        const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - N : i + N;
        if (!seenBuf[j] && tiles[j].abandoned) {
          seenBuf[j] = 1;
          queueBuf[tail++] = j;
        }
      }
    }
    if (tail > bestN) {
      bestN = tail;
      // Member nearest the centroid.
      const cx = sx / tail;
      const cy = sy / tail;
      let bd = Infinity;
      for (let k = 0; k < tail; k++) {
        const i = queueBuf[k];
        const d = (xOf(i) - cx) ** 2 + (yOf(i) - cy) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
  }
  return best;
}

function randomTile(world: World, rng: Rng, ok: (i: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < AREA; i++) if (ok(i)) n++;
  if (!n) return -1;
  let k = Math.floor(rng.next() * n);
  for (let i = 0; i < AREA; i++) if (ok(i) && k-- === 0) return i;
  return -1;
}

function nearWater(world: World, i: number, r: number): boolean {
  const x = xOf(i);
  const y = yOf(i);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      if (world.tiles[idxOf(xx, yy)].terrain === Terrain.Water) return true;
    }
  return false;
}

/** Strongest tile of a gang (or of either, for 'all'), −1 if none. */
function strongestOf(world: World, gang: GangId | 'all'): number {
  const st = world.turf.stats.strongest;
  if (gang !== 'all') return st[gang];
  const a = st.undertow;
  const b = st.kites;
  if (a < 0) return b;
  if (b < 0) return a;
  return world.turf.str[a] >= world.turf.str[b] ? a : b;
}

/** Can this spot rule find a tile right now? (Card eligibility; cheap.) */
export function spotAvailable(world: World, rule: SpotRule): boolean {
  const s = world.stats;
  switch (rule) {
    case 'industrial':
      return s.developed.ind > 0;
    case 'abandoned':
      return s.abandonedTiles > 0;
    case 'turf:undertow':
    case 'waterfrontTurf':
      return world.turf.stats.strongest.undertow >= 0;
    case 'turf:kites':
      return world.turf.stats.strongest.kites >= 0;
    case 'seam':
      return world.story.seam !== null;
    case 'skybridge':
      return world.vertical.activeLinks.size > 0;
    case 'random':
      return s.developed.res + s.developed.com + s.developed.ind > 0;
  }
  return false;
}

/** Pick a tile for a spot rule (§7.1), −1 if none. */
export function findSpot(world: World, rule: SpotRule, rng: Rng): number {
  const tiles = world.tiles;
  switch (rule) {
    case 'industrial':
      return randomTile(world, rng, (i) => tiles[i].zone === ZoneType.Industrial && isDeveloped(world, i));
    case 'abandoned':
      return largestAbandoned(world);
    case 'turf:undertow':
      return world.turf.stats.strongest.undertow;
    case 'turf:kites':
      return world.turf.stats.strongest.kites;
    case 'waterfrontTurf': {
      const owner = world.turf.owner;
      const str = world.turf.str;
      let best = -1;
      for (let i = 0; i < AREA; i++) {
        if (owner[i] !== 1) continue;
        if (best >= 0 && str[i] <= str[best]) continue;
        if (nearWater(world, i, 4)) best = i;
      }
      return best >= 0 ? best : world.turf.stats.strongest.undertow;
    }
    case 'seam':
      return world.story.seam ?? -1;
    case 'skybridge': {
      const act = world.links.filter((l) => world.vertical.activeLinks.has(l.id));
      if (!act.length) return -1;
      const l = act[Math.floor(rng.next() * act.length)];
      return idxOf(Math.round((l.ax + l.bx) / 2), Math.round((l.ay + l.by) / 2));
    }
    case 'random':
      return randomTile(world, rng, (i) => isDeveloped(world, i));
  }
  return -1;
}

/** Centre tile of a target (−1 = unresolved). 'city' and 'rail' have no single centre. */
export function targetCenter(world: World, at: Target, spot: number, gang?: GangId | 'all'): number {
  switch (at) {
    case 'spot':
      return spot >= 0 && spot < AREA ? spot : -1;
    case 'seam':
      return world.story.seam ?? -1;
    case 'strongestTurf':
      return gang ? strongestOf(world, gang) : -1;
    case 'strongestTurf:undertow':
      return world.turf.stats.strongest.undertow;
    case 'strongestTurf:kites':
      return world.turf.stats.strongest.kites;
    case 'largestAbandoned':
      return largestAbandoned(world);
    case 'city':
      return idxOf(N >> 1, N >> 1);
    case 'rail': {
      for (let i = 0; i < AREA; i++) if (world.rail[i]) return i;
      return -1;
    }
  }
  return -1;
}

/** A turf-style area for a target and radius, or null when it resolves to nothing. */
export function targetArea(world: World, at: Target, r: number, spot: number, gang?: GangId | 'all'): turf.TurfArea | null {
  if (at === 'city') return 'city';
  if (at === 'rail') {
    const tiles = vertical.railArea(world, Math.max(0, Math.round(r)));
    return tiles.length ? tiles : null;
  }
  const c = targetCenter(world, at, spot, gang);
  if (c < 0) return null;
  return { x: xOf(c), y: yOf(c), r: Math.max(0, r) };
}

// ── Local layers (§10.5 localLayers) ────────────────────────────────────────

/**
 * Rewrite world.layerParts.local from the active story.locals (crime / land
 * value discs, Euclidean from their centre point), then composeLayers.
 */
export function writeLocals(world: World): void {
  const L = world.layerParts.local;
  resetLayers(L);
  const tick = world.tick;
  for (const l of world.story.locals) {
    if (l.until >= 0 && l.until <= tick) continue;
    const r = Math.max(0, l.r);
    const xa = Math.max(0, Math.floor(l.x - r));
    const xb = Math.min(N - 1, Math.ceil(l.x + r));
    const ya = Math.max(0, Math.floor(l.y - r));
    const yb = Math.min(N - 1, Math.ceil(l.y + r));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - l.x;
        const dy = y + 0.5 - l.y;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * N + x;
        if (l.crimeAdd) L.crimeAdd[i] += l.crimeAdd;
        if (l.lvAdd) L.lvAdd[i] += l.lvAdd;
      }
  }
  composeLayers(world);
}

// ── Offline / abandon / renew helpers ───────────────────────────────────────

function setOffline(world: World, b: Building, days: number, ctx: EffectCtx): void {
  const d = Math.max(0, Math.min(MAX_OFFLINE, Math.round(days)));
  if (!d) return;
  b.offline = Math.max(b.offline, d);
  ctx.lastName = BUILDINGS[b.type]?.name ?? b.type;
  ctx.lastAt = idxOf(b.x, b.y);
  world.markChanged(b.x, b.y, b.x + b.size - 1, b.y + b.size - 1);
}

function pickN<T>(list: T[], n: number | 'all', rng: Rng): T[] {
  if (n === 'all') return list;
  return shuffleInPlace(list, rng).slice(0, Math.max(0, Math.floor(n)));
}

function footprintNear(world: World, b: Building, mask: (i: number) => boolean, r: number): boolean {
  for (let y = b.y - r; y < b.y + b.size + r; y++)
    for (let x = b.x - r; x < b.x + b.size + r; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (mask(idxOf(x, y))) return true;
    }
  return false;
}

function applyOffline(host: EffectHost, e: Extract<Effect, { t: 'offline' }>, ctx: EffectCtx): void {
  const world = host.world;
  const rng = host.rng;
  const all = [...world.buildings.values()];
  if (e.what === 'rail') {
    const i = vertical.railOutTarget(world, e.gang);
    if (i < 0) return;
    world.story.railOut.push({ i, until: world.tick + Math.max(1, Math.round(e.days)) });
    ctx.lastAt = i;
    vertical.refresh(world);
    return;
  }
  let picked: Building[] = [];
  if (e.what === 'plant') {
    const plants = all.filter((b) => (BUILDINGS[b.type]?.powerSupply ?? 0) > 0 && b.offline <= 0);
    picked = pickN(plants, e.n, rng);
  } else if (e.what === 'district') {
    const c = targetCenter(world, e.at ?? 'spot', ctx.spot, e.gang);
    if (c < 0) return;
    const cx = xOf(c);
    const cy = yOf(c);
    const r = e.r ?? 6;
    const r2 = r * r;
    picked = all.filter((b) => {
      for (let y = b.y; y < b.y + b.size; y++)
        for (let x = b.x; x < b.x + b.size; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) return true;
      return false;
    });
    if (e.n !== 'all') picked = pickN(picked, e.n, rng);
  } else if (e.what === 'nearTurf') {
    const gangs = e.gang ? [e.gang] : GANG_IDS;
    const codes: number[] = gangs.map((g) => (g === 'undertow' ? 1 : 2));
    const owner = world.turf.owner;
    const near = all.filter((b) => footprintNear(world, b, (i) => codes.includes(owner[i]), 4));
    const online = near.filter((b) => b.offline <= 0);
    picked = pickN(online.length ? online : near, e.n, rng);
  } else if (Array.isArray(e.what)) {
    const types = new Set<BuildingType>(e.what);
    const of = all.filter((b) => types.has(b.type));
    if (e.n === 'all') picked = of;
    else {
      const online = of.filter((b) => b.offline <= 0);
      picked = pickN(online.length ? online : of, e.n, rng);
    }
  }
  for (const b of picked) setOffline(world, b, e.days, ctx);
}

function applyAbandon(host: EffectHost, e: Extract<Effect, { t: 'abandon' }>, ctx: EffectCtx): void {
  const world = host.world;
  const c = targetCenter(world, e.at, ctx.spot);
  if (c < 0) return;
  const zone = e.zone === 'res' ? ZoneType.Residential : e.zone === 'com' ? ZoneType.Commercial : e.zone === 'ind' ? ZoneType.Industrial : 0;
  const cand: number[] = [];
  forDisc(xOf(c), yOf(c), e.r, (i) => {
    if (!isDeveloped(world, i)) return;
    if (zone && world.tiles[i].zone !== zone) return;
    cand.push(i);
  });
  for (const i of pickN(cand, e.n, host.rng)) world.setLevel(xOf(i), yOf(i), world.tiles[i].level, true);
}

function applyRenew(host: EffectHost, e: Extract<Effect, { t: 'renew' }>, ctx: EffectCtx): void {
  const world = host.world;
  const c = targetCenter(world, e.at, ctx.spot);
  if (c < 0) return;
  forDisc(xOf(c), yOf(c), e.r, (i) => {
    const t = world.tiles[i];
    if (t.abandoned && t.zone !== ZoneType.None) world.setLevel(xOf(i), yOf(i), 0, false);
  });
}

function applyTurf(host: EffectHost, e: Extract<Effect, { t: 'turf' }>, ctx: EffectCtx): void {
  const world = host.world;
  switch (e.op) {
    case 'freeze':
      turf.freezeTurf(world, e.days ?? 0);
      return;
    case 'seed': {
      if (e.gang === 'all' && e.at === 'city') {
        turf.forceSeed(world);
        return;
      }
      const gangs: GangId[] = e.gang === 'all' ? ['undertow', 'kites'] : [e.gang];
      for (const g of gangs) {
        let c = targetCenter(world, e.at, ctx.spot, g);
        if (c < 0 && e.at === 'city') c = turf.bestTile(world, g);
        if (c < 0) continue;
        turf.seedGang(world, g, xOf(c), yOf(c), e.v ?? TURF.seedStr);
      }
      return;
    }
    case 'str': {
      const area = targetArea(world, e.at, e.r ?? 0, ctx.spot, e.gang);
      if (area) turf.addStrength(world, e.gang, area, e.v ?? 0);
      return;
    }
    case 'clear': {
      const area = targetArea(world, e.at, e.r ?? 0, ctx.spot, e.gang);
      if (area) turf.clearTurf(world, e.gang, area);
      return;
    }
    case 'flip': {
      if (e.gang === 'all') return;
      const to: GangId = e.to ?? (e.gang === 'undertow' ? 'kites' : 'undertow');
      const area = targetArea(world, e.at, e.r ?? 0, ctx.spot, e.gang);
      if (area) turf.flipTurf(world, e.gang, to, area);
      return;
    }
  }
}

/** The gangSurge incident (§3.2): +30 strength in a 5×5 around (x, y), claiming unowned eligible tiles at 30. */
export function applySurge(world: World, gang: GangId, x: number, y: number): number {
  if (!world.inBounds(x, y)) return 0;
  const S = TURF.surge;
  const code: 1 | 2 = gang === 'undertow' ? 1 : 2;
  const tk = world.turf;
  const own: number[] = [];
  const claim: number[] = [];
  for (let dy = -S.radius; dy <= S.radius; dy++)
    for (let dx = -S.radius; dx <= S.radius; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (!world.inBounds(xx, yy)) continue;
      const i = idxOf(xx, yy);
      if (tk.owner[i] === code) own.push(i);
      else if (tk.owner[i] === 0 && turf.isEligible(world, xx, yy)) claim.push(i);
    }
  if (own.length) turf.addStrength(world, gang, own, S.str, false);
  let held = turf.gangTiles(world)[gang];
  const cap = turf.capFor(world);
  let n = own.length;
  for (const i of claim) {
    if (held >= cap) break;
    tk.owner[i] = code;
    tk.str[i] = S.claimStr;
    held++;
    n++;
  }
  turf.refreshStats(world);
  return n;
}

// ── The applier ─────────────────────────────────────────────────────────────

/** Apply effects left to right. Unresolvable targets skip their effect; nothing throws. */
export function applyEffects(host: EffectHost, fx: readonly Effect[] | undefined, ctx: EffectCtx): void {
  if (!fx) return;
  for (const e of fx) {
    try {
      applyEffect(host, e, ctx);
    } catch (err) {
      console.warn('[story] effect skipped', e, err);
    }
  }
}

/** Apply one effect (§10.3 rules). */
export function applyEffect(host: EffectHost, e: Effect, ctx: EffectCtx): void {
  const world = host.world;
  const s = world.story;
  const tick = world.tick;
  switch (e.t) {
    case 'funds':
      if (Number.isFinite(e.v)) world.funds += e.v;
      return;
    case 'favor':
      for (const f of resolveRef(world, e.f)) changeFavor(world, f, e.v);
      return;
    case 'trace':
      addTrace(world, e.v);
      return;
    case 'mod': {
      const until = e.days === 'perm' ? (ctx.dealUntil ?? -1) : tick + Math.max(0, Math.round(e.days));
      const k = s.mods.findIndex((m) => m.id === e.id);
      const entry = { id: e.id, label: e.label, until, mods: cloneJson(e.mods) };
      if (k >= 0) s.mods[k] = entry;
      else s.mods.push(entry);
      return;
    }
    case 'income':
      s.incomes.push({ id: e.id, label: e.label, perMonth: e.perMonth, until: tick + Math.max(0, e.months) * DAYS_PER_MONTH });
      return;
    case 'local': {
      const c = targetCenter(world, e.at, ctx.spot);
      if (c < 0 || e.at === 'city' || e.at === 'rail') return;
      s.locals.push({
        id: e.id,
        x: xOf(c) + 0.5,
        y: yOf(c) + 0.5,
        r: e.r,
        until: tick + Math.max(0, Math.round(e.days)),
        crimeAdd: e.crimeAdd ?? 0,
        lvAdd: e.lvAdd ?? 0,
      });
      writeLocals(world);
      return;
    }
    case 'turf':
      applyTurf(host, e, ctx);
      return;
    case 'offline':
      applyOffline(host, e, ctx);
      return;
    case 'abandon':
      applyAbandon(host, e, ctx);
      return;
    case 'renew':
      applyRenew(host, e, ctx);
      return;
    case 'unlock':
      unlockStory(world, e.what);
      return;
    case 'credit': {
      const what: BuildingType = e.what === 'patronExclusive' ? (patronOf(world) === 'basalt' ? 'foundry' : 'glarewall') : e.what;
      if (!BUILDINGS[what] || !(e.n > 0)) return;
      s.credits.push({ what, n: Math.floor(e.n), mul: Math.max(0, e.mul) });
      return;
    }
    case 'flag': {
      let v: FlagValue;
      if (e.v === '+1') {
        const prev = s.flags[e.key];
        v = (typeof prev === 'number' ? prev : prev ? 1 : 0) + 1;
      } else if (e.v === '$patron') v = patronOf(world);
      else v = e.v;
      s.flags[e.key] = v;
      host.flagSet(e.key, v);
      return;
    }
    case 'floor': {
      const prev = s.floors[e.f];
      s.floors[e.f] = typeof prev === 'number' ? Math.max(prev, e.v) : e.v;
      return;
    }
    case 'ceil': {
      const prev = s.ceils[e.f];
      s.ceils[e.f] = typeof prev === 'number' ? Math.min(prev, e.v) : e.v;
      return;
    }
    case 'pact':
      signPactEffect(world, e.gang, e.months);
      return;
    case 'queue':
      host.queue(e.card, Math.max(0, Math.round(e.days)));
      return;
    case 'log':
      host.log(e.n);
      return;
    case 'reveal':
      revealStory(world);
      host.flagSet('revealed', true);
      return;
    case 'news':
      world.addNews(fillTokens(world, e.text, ctx.lastAt ?? ctx.spot, newsTokens(ctx)), e.kind);
      return;
    case 'gangAction':
      s.gangActions++;
      if (e.crackdown) s.lastCrackdownTick = tick;
      return;
    case 'countdown':
      host.countdown(Math.max(0, Math.round(e.days)));
      return;
    case 'charterNight':
      host.charterNight();
      return;
    case 'ending':
      host.ending(e.id);
      return;
    case 'if':
      applyEffects(host, evalCond(world, e.c) ? e.then : e.else, ctx);
      return;
  }
}

/** Pact (§3.6): extends an active one; gangActions +1; news. Skipped under a lockPacts ending. */
export function signPactEffect(world: World, gang: GangId, months: number): boolean {
  if (endingRules(world)?.lockPacts) return false;
  const s = world.story;
  const until = world.tick + Math.max(1, Math.round(months)) * DAYS_PER_MONTH;
  const p = s.pacts.find((k) => k.gang === gang);
  if (p) p.until = Math.max(p.until, until);
  else s.pacts.push({ gang, until });
  s.gangActions++;
  world.addNews(`${capitalizeFirst(GANG_NEWS_NAME[gang])} keep to their streets. Somebody is paying for it.`, 'info');
  turf.refreshStats(world);
  return true;
}

// ── Tokens (§0) ─────────────────────────────────────────────────────────────

function newsTokens(ctx: EffectCtx): Record<string, string> {
  const name = ctx.lastName ?? 'plant';
  return { plant: name, building: name };
}

/** District name of a tile (map centre when −1). */
export function districtOf(world: World, i: number): string {
  const c = i >= 0 && i < AREA ? i : idxOf(N >> 1, N >> 1);
  return districtName(xOf(c), yOf(c), world.seed);
}

/** Fill {city} {district} {patron} {rival} {year} {coherence} (plus `extra`). Unknown tokens stay. */
export function fillTokens(world: World, text: string, spot = -1, extra?: Record<string, string>): string {
  if (!text || text.indexOf('{') < 0) return text;
  return text.replace(/\{(\w+)\}/g, (all, k: string) => {
    switch (k) {
      case 'city':
        return world.cityName;
      case 'district':
        return districtOf(world, spot);
      case 'patron':
        return FACTION_LABELS[patronOf(world)].name;
      case 'rival':
        return FACTION_LABELS[rivalOf(world)].name;
      case 'year':
        return String(world.year);
      case 'coherence':
        return String(coherenceFor(world.story.logs.length));
    }
    return extra?.[k] ?? all;
  });
}

// ── Hints and effect text (§8.2) ────────────────────────────────────────────

const pipsOf = (v: number): 1 | 2 | 3 => (Math.abs(v) >= 20 ? 3 : Math.abs(v) >= 10 ? 2 : 1);

/**
 * Hint chips for a list of effects: favor ▲/▼ pips, CR, Trace, timed, unlock, log,
 * offline, abandon, Charter Night, a follow-up card, maybe (inside an `if`).
 */
export function hintsFor(world: World, fx: readonly Effect[] | undefined): Hint[] {
  if (!fx?.length) return [];
  const favor: Partial<Record<FactionId, number>> = {};
  let cr = 0;
  let trace = 0;
  let months = 0;
  let unlock = false;
  let log = false;
  let maybe = false;
  let offline = false;
  let abandon = false;
  let follow = false;
  let charter = false;
  for (const e of fx) {
    switch (e.t) {
      case 'favor':
        // A hidden faction (the Tuning, §2.2) is never named before it shows itself.
        for (const f of resolveRef(world, e.f)) if (isVisible(world, f)) favor[f] = (favor[f] ?? 0) + e.v;
        break;
      case 'funds':
        cr += e.v;
        break;
      case 'trace':
        trace += e.v;
        break;
      case 'mod':
        if (e.days !== 'perm') months = Math.max(months, Math.max(1, Math.round(e.days / DAYS_PER_MONTH)));
        break;
      case 'income':
        months = Math.max(months, e.months);
        break;
      case 'unlock':
      case 'credit':
        unlock = true;
        break;
      case 'log':
        log = true;
        break;
      case 'if':
        maybe = true;
        break;
      case 'offline':
        offline = true;
        break;
      case 'abandon':
        abandon = true;
        break;
      case 'queue':
        // A whisper only reaches the ticker; any other queued card is something the player will read.
        if (storyContent().cards.get(e.card)?.kind !== 'whisper') follow = true;
        break;
      case 'charterNight':
        charter = true;
        break;
    }
  }
  const out: Hint[] = [];
  for (const f of FACTION_IDS) {
    const v = favor[f];
    if (v) out.push({ k: 'favor', f, dir: v > 0 ? 1 : -1, pips: pipsOf(v) });
  }
  if (cr) out.push({ k: 'cr', v: cr });
  if (trace) out.push({ k: 'trace', v: trace });
  if (months) out.push({ k: 'timed', months });
  if (unlock) out.push({ k: 'unlock' });
  if (log) out.push({ k: 'log' });
  if (offline) out.push({ k: 'offline' });
  if (abandon) out.push({ k: 'abandon' });
  if (charter) out.push({ k: 'charter' });
  if (follow) out.push({ k: 'follow' });
  if (maybe) out.push({ k: 'maybe' });
  return out;
}

const trimZeros = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const signed = (v: number, digits = 0) => `${v >= 0 ? '+' : '−'}${trimZeros(Math.abs(v).toFixed(digits))}`;
const cr = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString('en-US')} CR`;

const MOD_LABEL: Record<string, string> = {
  demandRes: 'Hab demand',
  demandCom: 'Market demand',
  demandInd: 'Fab demand',
  crimeAdd: 'crime',
  landValueAdd: 'land value',
  approvalAdd: 'approval',
  traceMonthly: 'Trace a month',
  outageChance: 'outage chance',
  crimeMul: 'crime',
  turfCrimeMul: 'turf crime',
  pollutionMul: 'pollution',
  trafficMul: 'traffic',
  securityMul: 'security',
  taxIncomeMul: 'tax income',
  taxDemandMul: 'tax pressure',
  upkeepMul: 'upkeep',
  buildCostMul: 'build costs',
  powerSupplyMul: 'power supply',
  powerDemandMul: 'power demand',
  growthMul: 'growth',
  abandonMul: 'abandonment',
  eventRateMul: 'incidents',
  cardRateMul: 'faction cards',
  turfSpreadMul: 'turf spread',
};

/** Short text for a modifier patch, e.g. "build costs ×1.15 · approval −3". */
export function describePatch(p: ModPatch | undefined): string {
  if (!p) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(p) as [keyof SimMods, unknown][]) {
    if (k === 'costMul' || k === 'upkeepMulType' || k === 'favorMonthly') continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const label = MOD_LABEL[k] ?? k;
    if (k === 'taxCap') parts.push(`tax cap ${v}%`);
    else if (k.endsWith('Mul')) parts.push(`${label} ×${Math.round(v * 100) / 100}`);
    else if (k === 'approvalAdd' || k === 'traceMonthly') parts.push(`${label} ${signed(v)}`);
    else if (k === 'outageChance') parts.push(`${label} ${Math.round(v * 100)}%`);
    else parts.push(`${label} ${signed(v, 2)}`);
  }
  for (const [t, v] of Object.entries(p.costMul ?? {})) {
    const name = BUILDINGS[t as BuildingType]?.name ?? t;
    parts.push(v === 0 ? `${name} free` : `${name} cost ×${Math.round((v as number) * 100) / 100}`);
  }
  for (const [t, v] of Object.entries(p.upkeepMulType ?? {})) {
    parts.push(`${BUILDINGS[t as BuildingType]?.name ?? t} upkeep ×${Math.round((v as number) * 100) / 100}`);
  }
  for (const [f, v] of Object.entries(p.favorMonthly ?? {})) {
    parts.push(`${FACTION_LABELS[f as FactionId]?.short ?? f} ${signed(v as number)} a month`);
  }
  return parts.join(' · ');
}

const TARGET_TEXT: Record<Target, string> = {
  city: 'city-wide',
  spot: 'here',
  seam: 'at the Seam',
  strongestTurf: 'at its strongest turf',
  'strongestTurf:undertow': 'on Undertow turf',
  'strongestTurf:kites': 'on Kites turf',
  largestAbandoned: 'in the dark lots',
  rail: 'along the ribbon',
};

const short = (f: FactionId) => FACTION_LABELS[f]?.short ?? f;
const months = (days: number) => `${Math.max(1, Math.round(days / DAYS_PER_MONTH))} mo`;

/** One effect as popover text (resolved now: patron, rival, fan-outs). */
export function effectText(world: World, e: Effect): string {
  switch (e.t) {
    case 'funds':
      return cr(e.v);
    case 'favor':
      return resolveRef(world, e.f)
        .filter((f) => isVisible(world, f)) // the hidden Tuning stays unnamed (§2.2)
        .map((f) => `${short(f)} ${signed(e.v)}`)
        .join(', ');
    case 'trace':
      return `Trace ${signed(e.v)}`;
    case 'mod':
      return `${describePatch(e.mods)}${e.days === 'perm' ? '' : ` for ${months(e.days)}`}`;
    case 'income':
      return `${cr(e.perMonth)} a month for ${e.months} mo (${e.label})`;
    case 'local': {
      const p: string[] = [];
      if (e.crimeAdd) p.push(`crime ${signed(e.crimeAdd, 2)}`);
      if (e.lvAdd) p.push(`land value ${signed(e.lvAdd, 2)}`);
      return `${p.join(', ')} ${TARGET_TEXT[e.at]} for ${months(e.days)}`;
    }
    case 'turf': {
      const g = e.gang === 'all' ? 'all turf' : `${short(e.gang)} turf`;
      switch (e.op) {
        case 'seed':
          return `${short(e.gang === 'all' ? 'undertow' : e.gang)} tags ${TARGET_TEXT[e.at]}`;
        case 'str':
          return `${g} ${signed(e.v ?? 0)} ${TARGET_TEXT[e.at]}`;
        case 'clear':
          return `${g} cleared ${TARGET_TEXT[e.at]}`;
        case 'flip':
          return `${g} flips to ${short(e.to ?? 'kites')} ${TARGET_TEXT[e.at]}`;
        case 'freeze':
          return `turf frozen for ${months(e.days ?? 0)}`;
      }
      return '';
    }
    case 'offline': {
      const what =
        e.what === 'plant' ? 'plants' : e.what === 'rail' ? 'a ribbon line' : e.what === 'district' ? 'the district' : e.what === 'nearTurf' ? 'buildings near turf' : e.what.map((t) => BUILDINGS[t]?.name ?? t).join(', ');
      return `${e.n === 'all' ? 'all ' : e.what === 'district' || e.what === 'rail' ? '' : `${e.n} `}${what} offline ${Math.min(MAX_OFFLINE, e.days)}d`;
    }
    case 'abandon':
      return `${e.n} blocks abandoned ${TARGET_TEXT[e.at]}`;
    case 'renew':
      return `dark lots renewed ${TARGET_TEXT[e.at]}`;
    case 'unlock':
      return `Unlock: ${BUILDINGS[e.what as BuildingType]?.name ?? e.what}`;
    case 'credit': {
      const what = e.what === 'patronExclusive' ? (patronOf(world) === 'basalt' ? 'foundry' : 'glarewall') : e.what;
      const name = BUILDINGS[what]?.name ?? what;
      return e.mul === 0 ? `next ${name} free` : `next ${name} ${signed(Math.round((e.mul - 1) * 100))}%`;
    }
    case 'flag':
      return '';
    case 'floor':
      return `${short(e.f)} never below ${e.v}`;
    case 'ceil':
      return `${short(e.f)} never above ${e.v}`;
    case 'pact':
      return `${short(e.gang)} pact for ${e.months} mo`;
    case 'queue': {
      // A whisper only reaches the ticker; any other queued card follows up on this choice.
      const k = storyContent().cards.get(e.card)?.kind;
      return k === 'whisper' ? '' : e.days > 0 ? 'a follow-up later' : 'a follow-up next';
    }
    case 'log':
      return `Silt Log ${String(e.n).padStart(2, '0')}`;
    case 'reveal':
      return 'You are revealed';
    case 'news':
      return '';
    case 'gangAction':
      return e.crackdown ? 'counts as a crackdown' : '';
    case 'countdown':
      return `count in ${months(e.days)}`;
    case 'charterNight':
      return 'Charter Night';
    case 'ending':
      return 'An ending';
    case 'if':
      return 'depends on the city';
  }
  return '';
}

/** The exact-effects popover text for a choice: parts joined by ' · ' ("No effect." when empty). */
export function effectsText(world: World, fx: readonly Effect[] | undefined): string {
  const parts: string[] = [];
  for (const e of fx ?? []) {
    const t = effectText(world, e);
    if (t) parts.push(t);
  }
  return parts.length ? parts.join(' · ') : 'No effect.';
}

/** Silt Log id helper: 7 → 'log.07'. */
export const logId = (n: number) => `log.${String(n).padStart(2, '0')}`;

/** Standing band used by whispers (warm / neutral / cold). */
export function whisperBand(standingValue: number): 'warm' | 'neutral' | 'cold' {
  if (standingValue >= STANDING.friendly) return 'warm';
  if (standingValue <= STANDING.cold) return 'cold';
  return 'neutral';
}
