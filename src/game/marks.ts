// ─────────────────────────────────────────────────────────────────────────────
// Choices that last: marks (docs/MEGACITY.md §9). Interface frozen after Step 0b;
// WP-8 fills it. Marks are derived, never saved: deriveMarks recomputes them on
// load and after story changes. skylineLang is read by the kit's pickForm (§6.1).
//
//   deriveMarks(world)   every §9.3 mark from saved state only (flags, key
//                        choices, story.seam, the oldest building of a type by
//                        id, the old pump hall, the ending history): a place,
//                        a plaque and the decal art/marks.ts draws. Also the
//                        neighbourhood names the marks give an 8×8 cell, the
//                        Sunk's tagline and the skyline bands below.
//   skylineLang(x, y)    the skyline takeover (§9.2): an eligible L3 body at art
//                        coordinates (x, y) hashes to u in [0, 1) and draws in
//                        the language of the ending whose band covers u. Each
//                        ending held gets min(0.35, 0.07 × years held), all of
//                        them at most 0.5 together; bands are laid out in the
//                        order the endings were held, so a Charter Review that
//                        swaps the ending freezes the old band and starts a new
//                        one after it (the old towers stay). Charter Shore also
//                        keeps the patron's first ground (§9.3 ch2.vote): a
//                        permanent 10% band at the top of [0, 1), inside the
//                        same 0.5.
//
// The last derived world is the one skylineLang and the name hook read (the
// game's world; the renderer re-binds it each frame through art/marks.ts).
// Cheap: one pass over the owned land at most, run by the director off the
// month tick and throttled on growth; skylineLang is a hash and a few compares.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from './config';
import { artOffset, slotRect, startSlotOf } from './districts/slots';
import { heightOf } from './heights';
import { hash2 } from './rng';
import { MARK_COPY, MARK_NAMES, SUNK_TAGLINES } from './story/content/epilogue';
import type { EndingId, Mark, Marks, StoryState } from './story/types';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, Terrain, ZoneType, type Building, type BuildingType, type SlotId } from './types';
import type { World } from './world';

/** The skyline takeover's numbers (§9.2): per sim year held, one ending's cap, all endings' cap, the patron's band. */
export const TAKEOVER = { perYear: 0.07, cap: 0.35, total: 0.5, patron: 0.1 } as const;
const YEAR_DAYS = DAYS_PER_MONTH * MONTHS_PER_YEAR;
const BODY_SALT = 0x5c1e9;
/** Ending names inside a plaque line ("Built under the Low Crown."), as inspect's notes write them. */
const ENDING_NAMES: Record<EndingId, string> = { ironwork: 'Ironwork', pearl: 'Pearlescence', lowcrown: 'the Low Crown', ledger: 'Open Ledger', quiet: 'the Quiet Hand' };
const LANDMARK_OF: Record<EndingId, BuildingType> = { ironwork: 'gantry', pearl: 'glasssmile', lowcrown: 'breadpier', ledger: 'recordtower', quiet: 'stillsquare' };
const ENDING_ORDER: readonly EndingId[] = ['ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet'];
/** The ten landmarks of §6.3 (a type still hidden in this build does not count) for the sandbox's landmark set (§3.8). */
export const SET_LANDMARKS: readonly BuildingType[] = ['charterhall', 'hexworks', 'pearlatrium', 'kitemast', 'beacon', 'arena', 'halolookout', 'hullhouse', 'lampchoir', 'terminal'];

/** The sandbox's landmark set (§3.8, §9.2): the landmarks and ending landmarks standing, of those this build has. */
export interface LandmarkSet {
  landmarks: number;
  of: number;
  endings: number;
  endingsOf: number;
  /** Every landmark of the set and all five ending landmarks stand. */
  done: boolean;
}

/** One band of [0, 1): bodies whose hash falls below `end` (and above the band before) draw in `lang`. */
interface Band {
  end: number;
  lang: EndingId;
}

/** Everything derived for one world (never saved). */
interface Derived {
  world: World;
  seed: number;
  ao: number;
  N: number;
  region: number;
  start: SlotId;
  salt: number;
  /** The patron's first ground in Charter Shore (ending id of its language), or null. */
  patron: EndingId | null;
  /** Bands outside / inside the start slot (the start slot leaves room for the patron's band). */
  bands: Band[];
  bandsStart: Band[];
  /** world.tick and the history entry count the bands were laid out for. */
  bandsTick: number;
  bandsKey: string;
  /** Some ending held was Lamplight (its band draws lantern roofs, current or kept after a review swap). */
  lanterns: boolean;
  /** Neighbourhood names by art cell key. */
  names: Map<number, string>;
  tagline: string | null;
  marks: Marks;
  sig: string;
  /** The sandbox's landmark set as it stands (§3.8, §9.2). */
  set: LandmarkSet;
}

const derived = new WeakMap<World, Derived>();
let active: Derived | null = null;

const cellKey = (cx: number, cy: number) => (cx + 64) * 256 + (cy + 64);

// ── The skyline takeover (§9.2) ────────────────────────────────────────────

type History = NonNullable<StoryState['endingHistory']>;

/** The ending history, with the "missing → one entry" rule of §9.6 for a state that has none yet. */
function historyOf(st: StoryState, tick: number): History {
  if (st.endingHistory?.length) return st.endingHistory;
  return st.ending ? [{ id: st.ending, variant: st.endingVariant, from: st.endingTick ?? tick, to: null }] : [];
}

/**
 * Lay the history out as bands of [0, 1), oldest first, within `total`. The Quiet Hand takes no band (a city owned by
 * nobody keeps its district styles); Lamplight takes one (its lantern roofs, which art reads as 'quiet').
 */
function layBands(hist: History, tick: number, total: number): Band[] {
  const out: Band[] = [];
  const acc: Partial<Record<EndingId, number>> = {};
  let sum = 0;
  for (const h of hist) {
    if (h.id === 'quiet' && h.variant !== 'lamplight') continue;
    const years = Math.max(0, (h.to ?? tick) - h.from) / YEAR_DAYS;
    const room = Math.min(TAKEOVER.cap - (acc[h.id] ?? 0), total - sum);
    const seg = Math.max(0, Math.min(TAKEOVER.perYear * years, room));
    if (!(seg > 1e-9)) continue;
    acc[h.id] = (acc[h.id] ?? 0) + seg;
    sum += seg;
    out.push({ end: sum, lang: h.id });
  }
  return out;
}

/** The patron's first ground (§9.3 ch2.vote): the language of the projection, from Chapter II on. */
function patronBand(st: StoryState): EndingId | null {
  const v = st.keyChoices['ch2.vote'];
  if (v === 0) return 'ironwork';
  if (v === 1) return 'pearl';
  if (v === 2 || st.flags.honestTie) return 'ledger';
  return null;
}

function refreshBands(d: Derived): void {
  const st = d.world.story;
  const hist = historyOf(st, d.world.tick);
  d.bands = layBands(hist, d.world.tick, TAKEOVER.total);
  d.bandsStart = d.patron ? layBands(hist, d.world.tick, TAKEOVER.total - TAKEOVER.patron) : d.bands;
  d.bandsTick = d.world.tick;
  d.bandsKey = bandsKeyOf(st);
  d.lanterns = hist.some((h) => h.id === 'quiet' && h.variant === 'lamplight');
}

const bandsKeyOf = (st: StoryState) => `${st.endingHistory?.length ?? 0}:${st.ending ?? ''}:${st.endingVariant ?? ''}`;

/** Each ending's share of the eligible bodies outside Charter Shore (tests, the Keepsakes list). */
export function skylineShares(world: World): Partial<Record<EndingId, number>> {
  const out: Partial<Record<EndingId, number>> = {};
  let prev = 0;
  for (const b of layBands(historyOf(world.story, world.tick), world.tick, TAKEOVER.total)) {
    out[b.lang] = (out[b.lang] ?? 0) + b.end - prev;
    prev = b.end;
  }
  return out;
}

/** The takeover hash of a body at art coordinates (x, y) in this world: u in [0, 1). */
export function bodyHash(world: World, x: number, y: number): number {
  return hash2(x, y, (world.seed ^ BODY_SALT) | 0);
}

/**
 * The faction language an eligible L3 body at art coordinates (x, y) draws in under the skyline takeover rule (§9.2),
 * or null for its district style. Reads the last derived world (the game's): bodies outside an owned district, and
 * every body before Chapter II's vote and the ending, keep their style.
 */
export function skylineLang(x: number, y: number): EndingId | null {
  const d = active;
  if (!d) return null;
  const w = d.world;
  const st = w.story;
  if (!d.patron && st.ending === null && !st.endingHistory?.length) return null;
  if (w.tick !== d.bandsTick || bandsKeyOf(st) !== d.bandsKey) refreshBands(d);
  const wx = x + d.ao;
  const wy = y + d.ao;
  if (wx < 0 || wy < 0 || wx >= d.N || wy >= d.N) return null;
  const slot = (wy >> 6) * d.region + (wx >> 6);
  if (!w.slotOwned[slot]) return null;
  const u = hash2(x, y, d.salt);
  let bands = d.bands;
  if (slot === d.start && d.patron) {
    if (u >= 1 - TAKEOVER.patron) return d.patron;
    bands = d.bandsStart;
  }
  for (let k = 0; k < bands.length; k++) if (u < bands[k].end) return bands[k].lang;
  return null;
}

/**
 * Whether the skyline has a Lamplight band (render/buildings.ts asks skylineLang for lantern roofs only then): true
 * while Lamplight holds and after a Charter Review swaps it away, since its band and so its lantern roofs stay (§9.2).
 */
export function lanternBands(): boolean {
  const d = active;
  if (!d) return false;
  if (bandsKeyOf(d.world.story) !== d.bandsKey) refreshBands(d);
  return d.lanterns;
}

// ── Names, tagline, plaques (read by news.ts, game.ts and the Keepsakes list) ──

/** The name a mark gives the 8×8 neighbourhood cell (cx, cy) in art coordinates (§9.3), or null. */
export function markCellName(seed: number, cx: number, cy: number): string | null {
  const d = active;
  if (!d || d.seed !== seed || d.names.size === 0) return null;
  return d.names.get(cellKey(cx, cy)) ?? null;
}

/** The Sunk's tagline after `ch4.brine` (§9.3), or null for its own. */
export function sunkTagline(world: World): string | null {
  return derived.get(world)?.tagline ?? null;
}

/** The plaques of the marks on tile (x, y) (inspect, §9.3). */
export function plaquesAt(world: World, x: number, y: number): string[] {
  const d = derived.get(world);
  if (!d) return [];
  const out: string[] = [];
  for (const m of d.marks.list) {
    // An ending landmark's inspect sheet already says when it was built and whether it is dormant (game.ts).
    if (!m.plaque || m.id.startsWith('landmark.')) continue;
    if (m.decal.startsWith('dark:')) {
      const i = y * world.N + x;
      if (!m.decal.slice(5).split('.').includes(String(i))) continue;
    } else if (x < m.x || y < m.y || x >= m.x + m.w || y >= m.y + m.h) continue;
    if (!out.includes(m.plaque)) out.push(m.plaque);
  }
  return out;
}

/** The Keepsakes row title of a mark (§9.6). */
export function markTitle(m: Mark): string {
  // Under Lamplight the Still Square is the Lamp Square (§9.2).
  if (m.id === 'landmark.stillsquare' && m.decal === 'landmark:lamp') return 'The Lamp Square';
  if (m.id.startsWith('landmark.')) return BUILDINGS[m.id.slice(9) as BuildingType]?.name ?? 'Landmark';
  return MARK_COPY[m.id]?.title ?? m.id;
}

/** How an ending landmark reads (§9.2): the ending it was built under (Lamplight for the Quiet Hand held as Lamplight), dormant, the Lamp Square. */
function landmarkState(world: World, e: EndingId): { held: string; dormant: boolean; lamp: boolean } {
  const st = world.story;
  const dormant = st.ending !== e;
  let held = ENDING_NAMES[e];
  if (e === 'quiet' && (dormant ? [...historyOf(st, world.tick)].reverse().find((h) => h.id === 'quiet')?.variant : st.endingVariant) === 'lamplight') held = 'Lamplight';
  return { held, dormant, lamp: !dormant && e === 'quiet' && st.endingVariant === 'lamplight' };
}

/**
 * Inspect's name and note for an ending landmark (game.ts, §9.2), or null for any other type: while Lamplight holds the
 * Still Square is "The Lamp Square", and the note names the ending it was built under ("Built under Lamplight").
 */
export function landmarkInspect(world: World, type: BuildingType): { title: string | null; built: string } | null {
  const e = ENDING_ORDER.find((k) => LANDMARK_OF[k] === type);
  if (!e) return null;
  const s = landmarkState(world, e);
  return { title: s.lamp ? 'The Lamp Square' : null, built: `Built under ${s.held}` };
}

function countSet(world: World): LandmarkSet {
  const have = new Set<BuildingType>();
  for (const b of world.buildings.values()) have.add(b.type);
  const counted = SET_LANDMARKS.filter((t) => !BUILDINGS[t]?.hidden);
  const landmarks = counted.filter((t) => have.has(t)).length;
  const endings = ENDING_ORDER.filter((e) => have.has(LANDMARK_OF[e])).length;
  return { landmarks, of: counted.length, endings, endingsOf: ENDING_ORDER.length, done: landmarks === counted.length && endings === ENDING_ORDER.length };
}

/**
 * The sandbox's landmark set (§3.8, §9.2: "all ten landmarks and, through Charter Reviews, all five ending landmarks"),
 * as the last deriveMarks counted it (the Keepsakes list, the director's one ticker line when it is whole).
 */
export function landmarkSet(world: World): LandmarkSet {
  return derived.get(world)?.set ?? countSet(world);
}

/** Make the renderer's world the one skylineLang and the names read (art/marks.ts, once a frame). */
export function bindMarks(world: World): void {
  const d = derived.get(world);
  if (d && active !== d) active = d;
}

// ── Places (saved state only) ──────────────────────────────────────────────

function oldestOf(world: World, ...types: BuildingType[]): Building | null {
  let best: Building | null = null;
  for (const b of world.buildings.values()) if (types.includes(b.type) && (!best || b.id < best.id)) best = b;
  return best;
}

function firstOf(world: World, type: BuildingType, inSlot?: (b: Building) => boolean): Building | null {
  let best: Building | null = null;
  for (const b of world.buildings.values()) if (b.type === type && (!inSlot || inSlot(b)) && (!best || b.id < best.id)) best = b;
  return best;
}

const rectOf = (b: Building) => ({ x: b.x, y: b.y, w: BUILDINGS[b.type].size, h: BUILDINGS[b.type].size });

/** A square of radius r around tile i, clipped to the map. */
function around(world: World, i: number, r: number) {
  const N = world.N;
  const x = i % N;
  const y = (i / N) | 0;
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  return { x: x0, y: y0, w: Math.min(N - 1, x + r) - x0 + 1, h: Math.min(N - 1, y + r) - y0 + 1 };
}

/** The tallest building (or L3 tower) on Kites turf; the Kite Mast once built; else Charter Shore's tallest. */
function kiteHost(world: World, startRect: { x0: number; y0: number; x1: number; y1: number }) {
  const mast = oldestOf(world, 'kitemast');
  if (mast) return rectOf(mast);
  const N = world.N;
  const owner = world.turf.owner;
  let best = -1;
  let bestH = 0;
  const consider = (i: number) => {
    const t = world.tiles[i];
    if (t.buildingId < 0 && (t.level < 3 || t.zone === ZoneType.None || t.abandoned)) return;
    const h = heightOf(world, i % N, (i / N) | 0);
    if (h > bestH) {
      bestH = h;
      best = i;
    }
  };
  for (let i = 0; i < owner.length; i++) if (owner[i] === 2 && world.ownedAt(i)) consider(i);
  if (best < 0) for (let y = startRect.y0; y <= startRect.y1; y++) for (let x = startRect.x0; x <= startRect.x1; x++) consider(y * N + x);
  if (best < 0) return null;
  const t = world.tiles[best];
  if (t.buildingId >= 0) {
    const b = world.buildings.get(t.buildingId);
    if (b) return rectOf(b);
  }
  return { x: best % N, y: (best / N) | 0, w: 1, h: 1 };
}

/** Charter Shore's shore tile nearest its centre (the old pump outfall): land beside water, no building on it. */
function outfall(world: World, r: { x0: number; y0: number; x1: number; y1: number }): number {
  const N = world.N;
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  let best = -1;
  let bestD = Infinity;
  for (let y = r.y0 + 1; y < r.y1; y++)
    for (let x = r.x0 + 1; x < r.x1; x++) {
      const i = y * N + x;
      const t = world.tiles[i];
      if (t.terrain !== Terrain.Land || t.buildingId >= 0) continue;
      const wet = world.tiles[i - 1].terrain === Terrain.Water || world.tiles[i + 1].terrain === Terrain.Water || world.tiles[i - N].terrain === Terrain.Water || world.tiles[i + N].terrain === Terrain.Water;
      if (!wet) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  return best;
}

/** The road tile nearest Charter Shore's centre (where its lamps' livery shows best). */
function centreRoad(world: World, r: { x0: number; y0: number; x1: number; y1: number }): number {
  const N = world.N;
  const cx = (r.x0 + r.x1) >> 1;
  const cy = (r.y0 + r.y1) >> 1;
  for (let k = 0; k < 32; k++)
    for (let y = cy - k; y <= cy + k; y++)
      for (let x = cx - k; x <= cx + k; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== k) continue;
        if (x < r.x0 || y < r.y0 || x > r.x1 || y > r.y1) continue;
        if (world.tiles[y * N + x].road) return y * N + x;
      }
  return cy * N + cx;
}

/** The tile nearest the Seam a mast can stand on: a street first, then open land, then any land (else the Seam). */
function mastSite(world: World, seam: number): number {
  const N = world.N;
  const sx = seam % N;
  const sy = (seam / N) | 0;
  let best = seam;
  let bestScore = Infinity;
  for (let y = Math.max(0, sy - 4); y <= Math.min(N - 1, sy + 4); y++)
    for (let x = Math.max(0, sx - 4); x <= Math.min(N - 1, sx + 4); x++) {
      const t = world.tiles[y * N + x];
      if (t.terrain !== Terrain.Land || !world.isOwned(x, y)) continue;
      const kind = t.road ? 0 : t.buildingId < 0 && t.zone === ZoneType.None ? 1 : 2;
      const score = kind * 100 + Math.max(Math.abs(x - sx), Math.abs(y - sy)) * 2 + Math.abs(x - sx) + Math.abs(y - sy);
      if (score < bestScore) {
        bestScore = score;
        best = y * N + x;
      }
    }
  return best;
}

/**
 * Three developed blocks on the strongest gang's turf, nearest its strongest tile (§9.3 wentToGround). The strongest
 * tile can sit where nothing is built (a map corner, the water's edge): then the gang's developed turf nearest it, then
 * any developed land nearest Charter Shore's centre, so the mark never goes missing while the city has blocks.
 */
function darkBlocks(world: World, startRect: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const N = world.N;
  const s = world.turf.stats;
  const g = (s?.tiles.kites ?? 0) > (s?.tiles.undertow ?? 0) ? 2 : 1;
  const centre = ((startRect.y0 + startRect.y1) >> 1) * N + ((startRect.x0 + startRect.x1) >> 1);
  let at = s?.strongest[g === 2 ? 'kites' : 'undertow'] ?? -1;
  if (at < 0) at = centre;
  const onTurf = !!s && world.turf.owner[at] === g;
  const developed = (i: number) => {
    const t = world.tiles[i];
    return t.buildingId < 0 && t.zone !== ZoneType.None && t.level >= 1 && !t.abandoned && world.ownedAt(i);
  };
  const collect = (from: number, r: number, test: (i: number) => boolean) => {
    const ax = from % N;
    const ay = (from / N) | 0;
    const picks: { i: number; d: number }[] = [];
    for (let y = Math.max(0, ay - r); y <= Math.min(N - 1, ay + r); y++)
      for (let x = Math.max(0, ax - r); x <= Math.min(N - 1, ax + r); x++) {
        const i = y * N + x;
        if (developed(i) && test(i)) picks.push({ i, d: Math.max(Math.abs(x - ax), Math.abs(y - ay)) + hash2(x, y, 0x0da7) * 0.5 });
      }
    return picks;
  };
  const gang = (i: number) => !onTurf || world.turf.owner[i] === g;
  let picks = collect(at, 12, gang);
  if (picks.length < 3 && onTurf) picks = collect(at, N, (i) => world.turf.owner[i] === g);
  if (picks.length < 3) picks = collect(centre, N, () => true);
  picks.sort((a, b) => a.d - b.d || a.i - b.i);
  // Three apart from one another (not a single block's three tiles).
  const out: number[] = [];
  for (const p of picks) {
    if (out.length >= 3) break;
    if (out.some((q) => Math.max(Math.abs((q % N) - (p.i % N)), Math.abs(((q / N) | 0) - ((p.i / N) | 0))) < 2)) continue;
    out.push(p.i);
  }
  return out;
}

/** Up to three live Ribbon stations (fen's kites). */
function ribbonStations(world: World): Building[] {
  const out: Building[] = [];
  const N = world.N;
  for (const b of world.buildings.values()) {
    if (!BUILDINGS[b.type]?.station) continue;
    const s = BUILDINGS[b.type].size;
    let rail = false;
    for (let y = b.y - 1; y <= b.y + s && !rail; y++)
      for (let x = b.x - 1; x <= b.x + s && !rail; x++) if (x >= 0 && y >= 0 && x < N && y < N && world.rail[y * N + x]) rail = true;
    if (rail) out.push(b);
  }
  return out.sort((a, b) => a.id - b.id).slice(0, 3);
}

// ── deriveMarks ────────────────────────────────────────────────────────────

/** The flag that pins the Seam's marks (§9.3): the Seam's tile in art coordinates ("ax,ay"), saved by the director. */
export const SEAM_MARK_FLAG = 'seamMark';

/**
 * Where the Seam's marks stand (the Truce Wall, the Clean Glass mast, Low Water, High Line and their renamed cell): the
 * tile the director pinned when Chapter III's choice was made (flag `seamMark`, art coordinates, so a 3×3 city grown to
 * 5×5 keeps it), else the live `story.seam` (turf.ts moves that every month as the crews' turf shifts).
 */
export function seamMarkTile(world: World): number | null {
  const v = world.story.flags[SEAM_MARK_FLAG];
  if (typeof v === 'string') {
    const [a, b] = v.split(',').map(Number);
    const ao = artOffset(world);
    const x = a + ao;
    const y = b + ao;
    if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.N && y < world.N) return y * world.N + x;
  }
  return world.story.seam;
}

/**
 * Pin the Seam's marks once Chapter III's choice is made (the Seam Truce, Clean Glass or one tide holds): the live
 * Seam's tile, in art coordinates. Returns true when it set the flag. A save made before the pin existed gets it on
 * load, where the Seam is then.
 */
export function pinSeamMark(world: World): boolean {
  const st = world.story;
  const f = st.flags;
  if (typeof f[SEAM_MARK_FLAG] === 'string' || !(f.truce || f.cleanGlass || f.oneTide)) return false;
  const seam = st.seam;
  if (seam === null || seam < 0 || seam >= world.area) return false;
  const ao = artOffset(world);
  f[SEAM_MARK_FLAG] = `${(seam % world.N) - ao},${((seam / world.N) | 0) - ao}`;
  return true;
}

/** The marks the city's choices have left (§9.3), recomputed from saved state. Binds this world for skylineLang. */
export function deriveMarks(world: World): Marks {
  const st = world.story;
  const f = st.flags;
  const N = world.N;
  const ao = artOffset(world);
  const start = startSlotOf(world);
  const sr = slotRect(world, start);
  const list: Mark[] = [];
  const names = new Map<number, string>();
  const add = (id: string, r: { x: number; y: number; w: number; h: number } | null, decal: string, plaque?: string) => {
    if (!r) return;
    list.push({ id, x: r.x, y: r.y, w: r.w, h: r.h, plaque: plaque ?? MARK_COPY[id]?.plaque ?? '', decal });
  };
  const nameCell = (x: number, y: number, name: string) => names.set(cellKey((x - ao) >> 3, (y - ao) >> 3), name);
  const ownedSunk = (b: Building) => world.kindAt(b.x, b.y) === 'sunk' && world.isOwned(b.x, b.y);
  const lark = st.keyChoices['ch1.lark'];

  // Chapter I · the lark.
  if (f.larkKnows) add('larkKite', kiteHost(world, sr), f.kiteHello ? 'kite:2' : 'kite');
  else if (lark === 1) {
    const i = outfall(world, sr);
    if (i >= 0) add('deadChannel', { x: i % N, y: (i / N) | 0, w: 1, h: 1 }, 'relay');
  }
  if (f.clerkLie) {
    const b = oldestOf(world, 'commons') ?? oldestOf(world, 'charterhall');
    if (b) add('clerkNine', rectOf(b), 'plaque');
  }

  // Chapter II · the vote: a name for the cell of the oldest Foundry Spine / Glarewall / Neon Plaza (the share is
  // skylineLang's); the plaque there, else on Charter Shore.
  const vote = st.keyChoices['ch2.vote'];
  const voteRow = vote === 0 ? (['patronBasalt', 'foundry'] as const) : vote === 1 ? (['patronNacre', 'glarewall'] as const) : vote === 2 || f.honestTie ? (['honestTie', 'plaza'] as const) : null;
  if (voteRow) {
    const b = oldestOf(world, voteRow[1]);
    if (b) {
      nameCell(b.x, b.y, MARK_NAMES[voteRow[0]]);
      add(voteRow[0], rectOf(b), 'banner');
    } else {
      const i = centreRoad(world, sr);
      add(voteRow[0], around(world, i, 3), 'banner');
    }
  }

  // Chapter III · the Seam: where the crews met when the choice was made (seamMarkTile), not where they meet today.
  const seam = seamMarkTile(world);
  if (seam !== null && seam >= 0 && seam < world.area) {
    const sx = seam % N;
    const sy = (seam / N) | 0;
    const row = f.cleanGlass ? 'cleanGlassMast' : f.truce ? 'truceWall' : f.oneTide === 'undertow' ? 'lowWater' : f.oneTide === 'kites' ? 'highLine' : null;
    if (row) {
      nameCell(sx, sy, MARK_NAMES[row]);
      const decal = row === 'cleanGlassMast' ? 'mast' : row === 'truceWall' ? (f.seamFair ? 'mural:lit' : 'mural') : row === 'lowWater' ? 'nets' : 'highline';
      // The mast stands on the street nearest the Seam (the Seam can fall on a canal: a mast never stands in the water).
      add(row, row === 'cleanGlassMast' ? around(world, mastSite(world, seam), 1) : around(world, seam, 2), decal);
    }
  }

  // Chapter IV · the old pump hall (the Sunk owned) and the Lower Wards memorial.
  const hall = firstOf(world, 'pumphall', ownedSunk);
  let tagline: string | null = null;
  if (hall) {
    const r = rectOf(hall);
    if (f.published || f.hallOpened || (f.leashed && f.unleashed)) {
      add('openHall', r, f.namesLit ? 'hall:open:lit' : 'hall:open');
      tagline = SUNK_TAGLINES.open;
    } else if (f.buried) {
      add(f.hallPoured ? 'pouredSlab' : 'privateWorks', r, f.hallPoured ? 'hall:slab' : 'hall:fence');
      tagline = SUNK_TAGLINES.fenced;
    } else if (f.leashed) {
      add('archive', r, 'hall:archive');
      tagline = SUNK_TAGLINES.archive;
    }
    if (f.hiddenByTuning) add('ohmDoor', r, 'hall:door');
  }
  if (st.seen['ch4.logs'] !== undefined) {
    const mem = firstOf(world, 'memorial', ownedSunk);
    if (mem) add('lowerWards', rectOf(mem), 'memorial');
  }

  // Chapter V.
  if (f.lure === 'shelved') {
    const patron = f.patron === 'basalt' || f.patron === 'nacre' ? f.patron : 'nacre';
    add('livery', around(world, centreRoad(world, sr), 3), `livery:${patron}`);
  }
  if (f.wentToGround) {
    const blocks = darkBlocks(world, sr);
    if (blocks.length) {
      let x0 = N;
      let y0 = N;
      let x1 = 0;
      let y1 = 0;
      for (const i of blocks) {
        x0 = Math.min(x0, i % N);
        y0 = Math.min(y0, (i / N) | 0);
        x1 = Math.max(x1, i % N);
        y1 = Math.max(y1, (i / N) | 0);
      }
      add('darkBlocks', { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, `dark:${blocks.join('.')}`);
    }
  }
  if (f.keptByBoard) {
    const b = oldestOf(world, 'charterhall') ?? oldestOf(world, 'commons');
    if (b) add('balcony', rectOf(b), 'balcony');
  }

  // Faction cards (optional rows).
  if (f.mural && world.links.length) {
    let l = world.links[0];
    for (const k of world.links) if (k.id < l.id) l = k;
    const x0 = Math.min(l.ax, l.bx);
    const y0 = Math.min(l.ay, l.by);
    add('crewBridge', { x: x0, y: y0, w: Math.max(l.ax, l.bx) - x0 + 1, h: Math.max(l.ay, l.by) - y0 + 1 }, 'plaque');
  }
  if (f.fen === 'free') {
    const sts = ribbonStations(world);
    if (sts.length) add('fenKites', rectOf(sts[0]), `fen:${sts.map((b) => b.id).join('.')}`);
  }
  if (f.marrowKnows) {
    const b = oldestOf(world, 'charterhall');
    if (b) add('minutes', rectOf(b), 'plaque');
  }

  // The coda.
  if (f.fullRecall && hall) add('everyLamp', rectOf(hall), 'hall:lamps');

  // The ending landmarks the city has built (§9.2): built under their ending, dormant while another is current.
  // The Quiet Hand's landmark names Lamplight when the city last held the Quiet Hand as Lamplight.
  for (const e of ENDING_ORDER) {
    const b = oldestOf(world, LANDMARK_OF[e]);
    if (!b) continue;
    const { held, dormant, lamp } = landmarkState(world, e);
    const plaque = dormant ? `Built under ${held}. Dormant while another ending holds.` : `Built under ${held}.`;
    add(`landmark.${LANDMARK_OF[e]}`, rectOf(b), dormant ? 'landmark:past' : lamp ? 'landmark:lamp' : 'landmark', plaque);
  }
  const set = countSet(world);

  // Version: bumps when the set (or a name, or the tagline) changes.
  const prev = derived.get(world);
  const sig = JSON.stringify([list, [...names.entries()], tagline]);
  const version = prev ? (prev.sig === sig ? prev.marks.version : prev.marks.version + 1) : 1;
  const marks: Marks = prev && prev.sig === sig ? prev.marks : { list, version };
  const d: Derived = {
    world,
    seed: world.seed,
    ao,
    N,
    region: world.region,
    start,
    salt: (world.seed ^ BODY_SALT) | 0,
    patron: patronBand(st),
    bands: [],
    bandsStart: [],
    bandsTick: -1,
    bandsKey: '',
    lanterns: false,
    names,
    tagline,
    marks,
    sig,
    set,
  };
  refreshBands(d);
  derived.set(world, d);
  active = d;
  return marks;
}
