// ─────────────────────────────────────────────────────────────────────────────
// Save migration and region growth (docs/MEGACITY.md §3.10, §3.11). Frozen after
// Step 0b: `upgradeSave`, `reframe`, `upgradeRegion` and `validateSaveShape`.
//
// Everything here is pure JSON → JSON: no World, no DOM, no storage. A v1–v3
// city becomes a 3×3 region with its 64×64 map in the start slot (offset 64, 64);
// a 3×3 city grows into a 5×5 one at a further offset (64, 64). Tile blocks are
// slot-local, so they never move; every world-coordinate field goes through one
// function, `reframe`.
// ─────────────────────────────────────────────────────────────────────────────

import { POP_SCALE, SAVE_VERSIONS_SUPPORTED } from '../config';
import { decodeRle, encodeRle } from '../story/encode';
import {
  DISTRICT_KINDS,
  LEGACY_REGION,
  LEGACY_SIZE,
  SLOT,
  startSlot,
  type DistrictKind,
  type DistrictSave,
  type FrameRegion,
  type Region,
  type SaveData,
  type SlotId,
} from '../types';
import { assignRing2, numberVariants, seedLayout } from './layout';

/** Bytes per tile in a v4 tile block (bits 0-23, little-endian). */
export const BLOCK_BYTES = 3;
/** Tiles in one slot's block. */
export const BLOCK_TILES = SLOT * SLOT;
/** Base64 characters of one block (4096 × 3 bytes). */
export const BLOCK_CHARS = (BLOCK_TILES * BLOCK_BYTES * 4) / 3; // 16,384

/** StoryState fields holding a tile index (y * N + x), remapped by `reframe`; −1 / null are kept. */
export const TILE_INDEX_FIELDS = ['seam', 'pending.spot', 'open.spot', 'waiting.spot', 'railOut[].i'] as const;
/** StoryState fields holding tile coordinates, offset by `reframe`. */
export const TILE_XY_FIELDS = ['locals[].x', 'locals[].y', 'crackdowns[].x', 'crackdowns[].y'] as const;
/**
 * Every other numeric StoryState field (paths as the contract test writes them: `a.b`, `list[].f`, `record.*`):
 * ticks, counters, ids and amounts, none of them a place on the map. A new numeric field must join one of the
 * three lists, or the contract test fails (§11.2 item 2).
 */
export const NOT_SPATIAL_FIELDS = [
  'v',
  'chapter',
  'chapterTick',
  'waitingSince',
  'holds.*',
  'favor.*',
  'mood.*',
  'floors.*',
  'ceils.*',
  'trace',
  'logs[]',
  'seen.*',
  'queue[].tick',
  'pending.tick',
  'waiting.tick',
  'mods[].until',
  'mods[].mods.*',
  'incomes[].perMonth',
  'incomes[].until',
  'locals[].r',
  'locals[].until',
  'locals[].crimeAdd',
  'locals[].lvAdd',
  'credits[].n',
  'credits[].mul',
  'pacts[].until',
  'deals.*.until',
  'deals.*.cooldownUntil',
  'crackdowns[].r',
  'crackdowns[].until',
  'crackdowns[].scatterAt',
  'crackdowns[].base.*',
  'precinctReady.*',
  'saltReady.*',
  'builtCounts.*',
  'lastCardTick',
  'lastHostileTick',
  'lastHostileBy.*',
  'lastPulseBy.*',
  'lastBeatTick',
  'gangActions',
  'lastCrackdownTick',
  'railOut[].until',
  'countdownEnd',
  'endingTick',
  'nextReview',
  'nudgeReady',
  'keyChoices.*',
  'whisperSnap.*',
  'lastWhisperTick',
  'lastNoteTick',
  'noteIdx',
  'log[].tick',
  'log[].choice',
  'rng',
  'chapterSec',
  'sinceStartSec',
  'deckSec',
  'frontSec',
  'waiveFrom',
  'flags.*',
  'endingHistory[].from',
  'endingHistory[].to',
] as const;

// ── Tile blocks ─────────────────────────────────────────────────────────────

const toB64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[]);
  return btoa(s);
};

/** One slot's tile numbers (bits 0-23) as a base64 block. */
export function encodeBlock(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(BLOCK_TILES * BLOCK_BYTES);
  for (let i = 0, b = 0; i < BLOCK_TILES; i++, b += 3) {
    const v = values[i] | 0;
    bytes[b] = v & 255;
    bytes[b + 1] = (v >>> 8) & 255;
    bytes[b + 2] = (v >>> 16) & 255;
  }
  return toB64(bytes);
}

const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decode a block into `out` (4096 tile numbers). False when it is not a well-formed 16,384-character block. */
export function decodeBlock(block: unknown, out: Int32Array | number[]): boolean {
  if (typeof block !== 'string' || block.length !== BLOCK_CHARS || !B64_RE.test(block)) return false;
  let bin: string;
  try {
    bin = atob(block);
  } catch {
    return false;
  }
  if (bin.length !== BLOCK_TILES * BLOCK_BYTES) return false;
  for (let i = 0, b = 0; i < BLOCK_TILES; i++, b += 3) out[i] = bin.charCodeAt(b) | (bin.charCodeAt(b + 1) << 8) | (bin.charCodeAt(b + 2) << 16);
  return true;
}

// ── Shape checks ────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** A save's region as stored: `region`, or 3 when it is missing and `size` is 192 (§3.10); NaN otherwise. */
export function storedRegion(data: { region?: unknown; size?: unknown }): number {
  if (data.region === undefined) return Number(data.size) === 3 * SLOT ? 3 : NaN;
  const r = Number(data.region);
  return Number.isFinite(r) ? r : NaN;
}

/**
 * A newer build's save (EXPANSION §2.5 with the Megacity rule, §3.10): a version above the newest supported, or a v4
 * save whose region is not 3 or 5 or whose size is not 64 × region. Left untouched; autosave is blocked. (The legacy
 * 1×1 test frame counts as a future save here: the game never writes one.)
 */
export function isFutureSave(data: unknown): boolean {
  if (!isObj(data)) return false;
  const v = Number(data.version);
  if (!Number.isFinite(v)) return false;
  if (v > Math.max(...SAVE_VERSIONS_SUPPORTED)) return true;
  if (v !== 4) return false;
  const r = storedRegion(data);
  return !(r === 3 || r === 5) || Number(data.size) !== SLOT * r;
}

/**
 * The structural checks `World.deserialize` and Import share (§3.10, §13.3), on a v4 save: region 3 or 5 (1 only with
 * `allowLegacy`, the headless test frame), size 64 × region, `owned` slots in range without duplicates and with the
 * start slot, one 16,384-character block per owned slot. Throws `Error('Incompatible save')`; returns the region.
 */
export function validateSaveShape(data: unknown, opts: { allowLegacy?: boolean } = {}): { region: FrameRegion; size: number } {
  const bad = () => new Error('Incompatible save');
  if (!isObj(data) || Number(data.version) !== 4) throw bad();
  const r = storedRegion(data);
  const ok = r === 3 || r === 5 || (opts.allowLegacy === true && r === LEGACY_REGION);
  if (!ok || Number(data.size) !== SLOT * r) throw bad();
  const region = r as FrameRegion;
  const d = data.districts;
  if (!isObj(d) || !Array.isArray(d.owned)) throw bad();
  const owned = d.owned as unknown[];
  const seen = new Set<number>();
  for (const s of owned) {
    if (!isInt(s) || s < 0 || s >= region * region || seen.has(s)) throw bad();
    seen.add(s);
  }
  if (!seen.has(startSlot(region))) throw bad();
  const blocks = data.tileBlocks;
  if (!Array.isArray(blocks) || blocks.length !== owned.length) throw bad();
  for (const b of blocks) if (typeof b !== 'string' || b.length !== BLOCK_CHARS || !B64_RE.test(b)) throw bad();
  return { region, size: SLOT * region };
}

// ── Reframe ─────────────────────────────────────────────────────────────────

/** A tile index on a `from` frame moved by (offset, offset) onto a `to` frame. Negative and non-numbers kept. */
export function remapIndex(i: unknown, from: number, to: number, offset: number): unknown {
  if (!isInt(i) || i < 0) return i;
  return (Math.floor(i / from) + offset) * to + (i % from) + offset;
}

/** RLE pairs of a `from`² grid placed at (offset, offset) on a `to`² grid. Malformed → undefined (read as empty). */
function reframeRle(pairs: unknown, from: number, to: number, offset: number): number[] | undefined {
  if (pairs === undefined) return undefined;
  const src = new Uint16Array(from * from);
  if (!decodeRle(pairs, src, 0xffff)) return undefined;
  const dst = new Uint16Array(to * to);
  for (let y = 0; y < from; y++) dst.set(src.subarray(y * from, y * from + from), (y + offset) * to + offset);
  return encodeRle(dst);
}

/**
 * Move every world-coordinate field of a save from a `from`-side frame to a `to`-side frame at (offset, offset):
 * buildings, `sky`, story `turf` and `rail` (RLE), `links`, the story's TILE_INDEX_FIELDS and TILE_XY_FIELDS.
 * Pure: returns a new save, never mutates `data`. Tiles and tile blocks are not touched (blocks are slot-local).
 */
export function reframe(data: SaveData, from: number, to: number, offset: number): SaveData {
  const out: SaveData = { ...data };
  if (Array.isArray(data.buildings))
    out.buildings = data.buildings.map((b) => (isObj(b) ? { ...b, x: (b.x | 0) + offset, y: (b.y | 0) + offset } : b));
  if (data.sky !== undefined) out.sky = reframeRle(data.sky, from, to, offset);
  if (isObj(data.story)) {
    const sv = JSON.parse(JSON.stringify(data.story)) as Record<string, unknown>;
    if (sv.turf !== undefined) sv.turf = reframeRle(sv.turf, from, to, offset);
    if (sv.rail !== undefined) sv.rail = reframeRle(sv.rail, from, to, offset);
    if (Array.isArray(sv.links))
      sv.links = sv.links.map((l) =>
        isObj(l)
          ? { ...l, ax: Number(l.ax) + offset, ay: Number(l.ay) + offset, bx: Number(l.bx) + offset, by: Number(l.by) + offset }
          : l,
      );
    const st = sv.story;
    if (isObj(st)) {
      const re = (v: unknown) => remapIndex(v, from, to, offset);
      if (st.seam !== undefined && st.seam !== null) st.seam = re(st.seam);
      for (const k of ['pending', 'open', 'waiting'] as const) {
        const o = st[k];
        if (isObj(o) && o.spot !== undefined) o.spot = re(o.spot);
      }
      if (Array.isArray(st.railOut)) for (const r of st.railOut) if (isObj(r)) r.i = re(r.i);
      for (const k of ['locals', 'crackdowns'] as const) {
        const list = st[k];
        if (Array.isArray(list))
          for (const e of list)
            if (isObj(e)) {
              if (typeof e.x === 'number') e.x += offset;
              if (typeof e.y === 'number') e.y += offset;
            }
      }
    }
    out.story = sv as unknown as SaveData['story'];
  }
  return out;
}

// ── v1–v3 → v4 ──────────────────────────────────────────────────────────────

/** Land grants a migrated city has earned (§3.8): completed chapters (at most 5), plus 1 if an ending was chosen. */
export function grantsOwed(story: unknown): number {
  const st = isObj(story) && isObj(story.story) ? story.story : null;
  if (!st) return 0;
  const chapter = Number(st.chapter);
  const done = Number.isFinite(chapter) ? Math.max(0, Math.min(5, Math.floor(chapter) - 1)) : 0;
  return done + (typeof st.ending === 'string' && st.ending ? 1 : 0);
}

/**
 * Migrate a v1–v3 save (`version ≤ 3`) to v4 (§3.10), without asking: a v3 city becomes a 3×3 region with its map in
 * the start slot (its `tiles` become the start slot's block verbatim, elev and ground 0), every world-coordinate
 * field reframed (64 → 192 at offset 64), head counts × POP_SCALE when the save has no `scale`, the seed's district
 * layout, the grants it has earned and, after an ending, one `endingHistory` entry and the epilogue clock at 0.
 * A save of any other version comes back unchanged; so does one whose `tiles` are not a 64×64 map (deserialize then
 * reports it as incompatible).
 */
export function upgradeSave(data: SaveData): SaveData {
  if (!isObj(data) || !(Number(data.version) <= 3)) return data;
  const tiles = data.tiles;
  if (!Array.isArray(tiles) || tiles.length !== LEGACY_SIZE * LEGACY_SIZE) return data;
  const region: Region = 3;
  const N = SLOT * region;
  const out = reframe(data, LEGACY_SIZE, N, SLOT);
  // Head counts in today's units (MEGACITY §4.4): a save without `scale` counts v3 people.
  const s = Number(data.scale);
  const popMul = Number.isFinite(s) && s > 0 ? POP_SCALE / s : POP_SCALE;
  const whole = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  out.maxPopulation = Math.round(whole(data.maxPopulation) * popMul);
  if (Array.isArray(data.milestones)) out.milestones = data.milestones.map((p) => Math.round(whole(p) * popMul)).filter((p) => p > 0);
  out.scale = POP_SCALE;
  const values = new Int32Array(BLOCK_TILES);
  for (let i = 0; i < BLOCK_TILES; i++) values[i] = (Number(tiles[i]) | 0) & 0xfffff; // bits 0-19; elev and ground 0
  const layout = seedLayout(data.seed >>> 0, region);
  const start = startSlot(region);
  const annexedAt = new Array(region * region).fill(-1);
  annexedAt[start] = Number(data.tick) | 0;
  const districts: DistrictSave = {
    kinds: layout.kinds,
    variants: layout.variants,
    owned: [start],
    grants: grantsOwed(data.story),
    bought: 0,
    annexedAt,
    epilogueSec: 0,
    goalsDone: [],
    ruinsRestored: 0,
  };
  out.districts = districts;
  out.tileBlocks = [encodeBlock(values)];
  delete out.tiles;
  out.region = region;
  out.size = N;
  // Ending history (§9.6): one entry for the ending the city holds.
  const sv = out.story as unknown;
  if (isObj(sv) && isObj(sv.story)) {
    const st = sv.story;
    if (typeof st.ending === 'string' && st.ending && !Array.isArray(st.endingHistory)) {
      const from = Number(st.endingTick);
      st.endingHistory = [
        { id: st.ending, variant: st.endingVariant === 'lamplight' ? 'lamplight' : null, from: Number.isFinite(from) ? from : Number(data.tick) | 0, to: null },
      ];
    }
  }
  out.version = 4;
  return out;
}

// ── 3×3 → 5×5 ───────────────────────────────────────────────────────────────

const isKind = (k: unknown): k is DistrictKind => typeof k === 'string' && (DISTRICT_KINDS as readonly string[]).includes(k);

/** A 3×3 slot id on the 5×5 region (one ring further out from every edge). */
export const growSlot = (s: SlotId): SlotId => (Math.floor(s / 3) + 1) * 5 + (s % 3) + 1;

/**
 * Grow a v4 3×3 save into a 5×5 one (§3.11), one way. Pure; a save that is not a v4 `region: 3` save comes back
 * unchanged. Every world-coordinate field is reframed (192 → 320 at offset 64), slot ids move by one slot in each
 * axis (`owned`, `annexedAt`, `goalsDone`), ring 1's kinds are kept and ring 2 is placed by §3.6.2's rule with them
 * as parents, so the grown city's ring 2 is the one a native 5×5 city of the same seed has. Tile blocks, grants,
 * `bought`, the lease, the epilogue clock, the story and every other field are unchanged.
 */
export function upgradeRegion(data: SaveData): SaveData {
  if (!isObj(data) || Number(data.version) !== 4 || storedRegion(data) !== 3 || Number(data.size) !== 3 * SLOT) return data;
  const d = data.districts;
  if (!isObj(d) || !Array.isArray(d.owned)) return data;
  const out = reframe(data, 3 * SLOT, 5 * SLOT, SLOT);
  const seed = data.seed >>> 0;
  let kinds: (DistrictKind | null)[];
  if (Array.isArray(d.kinds) && d.kinds.length === 9 && d.kinds.every(isKind)) {
    kinds = new Array(25).fill(null);
    d.kinds.forEach((k, s) => (kinds[growSlot(s)] = k));
    assignRing2(seed, 5, kinds);
  } else kinds = seedLayout(seed, 5).kinds;
  const full = kinds.map((k) => k ?? 'flats');
  const annexedAt = new Array(25).fill(-1);
  if (Array.isArray(d.annexedAt)) d.annexedAt.forEach((t, s) => s < 9 && (annexedAt[growSlot(s)] = Number(t) | 0));
  const goalsDone = Array.isArray(d.goalsDone)
    ? d.goalsDone.map((g) => {
        if (typeof g !== 'string') return g;
        const at = g.lastIndexOf('@');
        const s = Number(g.slice(at + 1));
        return at > 0 && Number.isInteger(s) && s >= 0 && s < 9 ? `${g.slice(0, at)}@${growSlot(s)}` : g;
      })
    : d.goalsDone;
  out.districts = {
    ...(d as unknown as DistrictSave),
    kinds: full,
    variants: numberVariants(5, full),
    owned: (d.owned as number[]).map((s) => (isInt(s) && s >= 0 && s < 9 ? growSlot(s) : s)),
    annexedAt,
    ...(goalsDone !== undefined ? { goalsDone: goalsDone as string[] } : {}),
  };
  out.region = 5;
  out.size = 5 * SLOT;
  return out;
}
