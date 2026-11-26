// ─────────────────────────────────────────────────────────────────────────────
// City transfer: the export file (docs/MEGACITY.md §13.2, §13.3). Build, read
// and validate a city file with no DOM: only TextEncoder / TextDecoder, atob /
// btoa and CompressionStream / DecompressionStream (Node 22 has them all, so
// the tests run the real code).
//
//   CYBERCITY 1                                   magic line + file format
//   {"game":"cyber-city","format":1,…}            header (readable, ≤ 1 KB)
//   H4sIAAAAAAAAA+y9a3Mb…                         payload: gzip(save JSON) in base64,
//   …                                             76 characters a line ("json": the save on one line)
//
// Every check of §13.3 runs before anything changes and returns the message the
// Import sheet shows; nothing here throws. No World is built: the checked save
// JSON (parsed once) goes to Game.importCity after the player confirms.
// ─────────────────────────────────────────────────────────────────────────────

import { SAVE_VERSIONS_SUPPORTED } from './config';
import { upgradeSave, validateSaveShape } from './districts/migrate';
import { gzipB64, hasCompression } from './saveStore';
import type { EndingId } from './story/types';
import { SLOT, STORY_PACES, type SaveData, type StoryPace } from './types';

/** The file format this build writes and the newest it reads. */
export const TRANSFER_FORMAT = 1;
export const TRANSFER_MAGIC = 'CYBERCITY';
export const TRANSFER_GAME = 'cyber-city';
/** A city file larger than this (bytes) is refused before it is read (§13.3). */
export const FILE_MAX_BYTES = 2 * 1024 * 1024;
/** An unpacked save larger than this (bytes) is refused (§13.3). */
export const UNPACKED_MAX_BYTES = 4 * 1024 * 1024;
/** Base64 payload lines (§13.2). */
export const LINE_WIDTH = 76;
/** The header line is ≤ 1 KB by construction; anything much longer is not ours (a header with 10,000 keys). */
export const HEADER_MAX_CHARS = 2048;
/** File names: the city's slug is at most this long before the date (§13.2). */
export const SLUG_MAX = 24;
/** The file's MIME type: plain text on purpose (iOS pickers and Android share lists, §13.2). */
export const FILE_TYPE = 'text/plain;charset=utf-8';
/** What the file input accepts (§13.5). */
export const FILE_ACCEPT = '.txt,text/plain';

/** §13.3's messages, verbatim. */
export const TRANSFER_TEXT = {
  notCity: "This file isn't a city file.",
  newer: 'This city was saved by a newer version. Reload to update, then import it again.',
  noDecompress: "This browser can't open city files. Update it to import this city.",
  damaged: 'This file is damaged. Export it again on the other device.',
  incompatible: 'This file is damaged or from an incompatible build.',
} as const;
export type TransferError = keyof typeof TRANSFER_TEXT;

/** The readable header (§13.2). */
export interface TransferHeader {
  game: typeof TRANSFER_GAME;
  format: number;
  /** The save version inside (4 from this build). */
  save: number;
  region: 3 | 5;
  /** The city's name (≤ 24 characters). */
  city: string;
  seed: number;
  /** The city's tick (sim day): the same-city check compares it (§13.1). */
  day: number;
  /** The story pace it was played at (`story.pace`), null when the save has none. */
  pace: StoryPace | null;
  /** Peak residents. */
  pop: number;
  /** Districts owned. */
  districts: number;
  chapter: number;
  ending: EndingId | null;
  /** ISO 8601, UTC, whole seconds. */
  exported: string;
  enc: 'gzip-b64' | 'json';
  /** The save JSON's length in characters. */
  bytes: number;
  /** FNV-1a 32-bit hash of the save JSON's UTF-8 bytes, 8 hex digits. */
  sum: string;
}

export interface CityFile {
  /** The whole file, ready for a Blob, a share or the clipboard. */
  text: string;
  /** `{slug}-{yyyy-mm-dd}.cybercity.txt`. */
  name: string;
  header: TransferHeader;
  /** UTF-8 size of `text` in bytes. */
  size: number;
}

export type ReadResult =
  | { ok: true; header: TransferHeader; save: SaveData; json: string }
  | { ok: false; error: TransferError; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const fail = (error: TransferError): ReadResult => ({ ok: false, error, message: TRANSFER_TEXT[error] });

// ── Small pieces ────────────────────────────────────────────────────────────

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as 8 lower-case hex digits. */
export function fnv1a(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The city name as a file-name slug (§13.2): lower case, runs of anything but ASCII letters and digits → "-". */
export function citySlug(name: string): string {
  const s = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return s || 'city';
}

/** `{slug}-{yyyy-mm-dd}.cybercity.txt` (the local date of `now`). */
export function cityFileName(name: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${citySlug(name)}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.cybercity.txt`;
}

/** Wrap a base64 string at LINE_WIDTH characters. */
function wrap(b64: string, width = LINE_WIDTH): string {
  let out = '';
  for (let i = 0; i < b64.length; i += width) out += (i ? '\n' : '') + b64.slice(i, i + width);
  return out;
}

const storyOf = (data: SaveData): Record<string, unknown> | null => {
  const sv = data.story as unknown;
  return isObj(sv) && isObj(sv.story) ? sv.story : null;
};

/** The header fields read from a save (shared by build and the preview). */
export function headerFields(data: SaveData): Pick<TransferHeader, 'region' | 'city' | 'seed' | 'day' | 'pace' | 'pop' | 'districts' | 'chapter' | 'ending'> {
  const st = storyOf(data);
  const pace = st && typeof st.pace === 'string' && (STORY_PACES as readonly string[]).includes(st.pace) ? (st.pace as StoryPace) : null;
  const chapter = st && isInt(st.chapter) ? st.chapter : 1;
  const ending = st && typeof st.ending === 'string' && st.ending ? (st.ending as EndingId) : null;
  return {
    region: Number(data.region) === 5 ? 5 : 3,
    city: String(data.cityName ?? '').slice(0, 24),
    seed: Number(data.seed) >>> 0,
    day: Number(data.tick) | 0,
    pace,
    pop: Math.max(0, Math.round(Number(data.maxPopulation) || 0)),
    districts: Array.isArray(data.districts?.owned) ? data.districts!.owned.length : 1,
    chapter,
    ending,
  };
}

// ── Build ───────────────────────────────────────────────────────────────────

/**
 * Pack a city into its export file (§13.2): the magic line, the header and the save JSON (exactly what SAVE_KEY
 * holds), gzipped and base64-encoded in 76-character lines; without CompressionStream (or with `compress: false`) the
 * save JSON on one line with `enc: "json"`.
 */
export async function buildCityFile(saveJson: string, data: SaveData, opts: { now?: Date; compress?: boolean } = {}): Promise<CityFile> {
  const now = opts.now ?? new Date();
  const z = opts.compress === false || !hasCompression() ? null : await gzipB64(saveJson);
  const header: TransferHeader = {
    game: TRANSFER_GAME,
    format: TRANSFER_FORMAT,
    save: Number(data.version) | 0,
    ...headerFields(data),
    exported: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    enc: z === null ? 'json' : 'gzip-b64',
    bytes: saveJson.length,
    sum: fnv1a(saveJson),
  };
  const body = z === null ? saveJson : wrap(z);
  const text = `${TRANSFER_MAGIC} ${TRANSFER_FORMAT}\n${JSON.stringify(header)}\n${body}\n`;
  return { text, name: cityFileName(header.city, now), header, size: new TextEncoder().encode(text).length };
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Bytes → text, or null when it isn't UTF-8 text (invalid sequences or NUL characters). */
function decodeText(bytes: Uint8Array): string | null {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return s.includes('\u0000') ? null : s;
  } catch {
    return null;
  }
}

/** The text of a file input: a string, bytes or a Blob / File (size checked before it is read). */
async function textOf(input: string | Blob | ArrayBuffer | Uint8Array): Promise<string | null | 'big'> {
  if (typeof input === 'string') return input.length > FILE_MAX_BYTES ? 'big' : input.includes('\u0000') ? null : input;
  if (input instanceof Uint8Array) return input.length > FILE_MAX_BYTES ? 'big' : decodeText(input);
  if (input instanceof ArrayBuffer) return input.byteLength > FILE_MAX_BYTES ? 'big' : decodeText(new Uint8Array(input));
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    if (input.size > FILE_MAX_BYTES) return 'big';
    try {
      return decodeText(new Uint8Array(await input.arrayBuffer()));
    } catch {
      return null;
    }
  }
  return null;
}

/** base64 (any line width, any whitespace) → bytes, or null. */
function b64Bytes(text: string): Uint8Array | null {
  const s = text.replace(/\s+/g, '');
  if (!s.length || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** gunzip with a size cap: null when it fails or the unpacked bytes pass `max`. */
async function gunzipCapped(bytes: Uint8Array, max: number): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  } catch {
    return null;
  }
}

/** A tile index on an N-side frame (−1 and null allowed). */
const inFrameIndex = (v: unknown, area: number) => v === undefined || v === null || (isInt(v) && v >= -1 && v < area);
const inFrameXY = (v: unknown, N: number) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < N);

/**
 * The checks §13.3 lists beyond the frozen `validateSaveShape` (structure only): `kinds`, `variants` and `annexedAt`
 * of length region², buildings and links inside the frame, the story's tile indices and coordinates inside it, and
 * the scalar fields a World needs. True when the save may be built.
 */
export function insideFrame(data: SaveData, region: number): boolean {
  const N = SLOT * region;
  const area = N * N;
  const R2 = region * region;
  if ((data.cityName !== undefined && typeof data.cityName !== 'string') || !Number.isFinite(Number(data.seed)) || !isInt(data.tick) || data.tick < 0) return false;
  if (!Number.isFinite(Number(data.funds))) return false;
  const d = data.districts as unknown;
  if (!isObj(d)) return false;
  for (const k of ['kinds', 'variants', 'annexedAt'] as const) if (!Array.isArray(d[k]) || (d[k] as unknown[]).length !== R2) return false;
  if (!Array.isArray(data.buildings)) return false;
  for (const b of data.buildings as unknown[]) {
    if (!isObj(b)) return false;
    if (!isInt(b.x) || !isInt(b.y) || b.x < 0 || b.y < 0 || b.x >= N || b.y >= N || !isInt(b.id)) return false;
  }
  const sv = data.story as unknown;
  if (sv !== undefined) {
    if (!isObj(sv)) return false;
    if (sv.links !== undefined) {
      if (!Array.isArray(sv.links)) return false;
      for (const l of sv.links as unknown[]) {
        if (!isObj(l)) return false;
        for (const k of ['ax', 'ay', 'bx', 'by'] as const) if (!isInt(l[k]) || (l[k] as number) < 0 || (l[k] as number) >= N) return false;
      }
    }
    const st = sv.story;
    if (st !== undefined) {
      if (!isObj(st)) return false;
      if (!inFrameIndex(st.seam, area)) return false;
      for (const k of ['pending', 'open', 'waiting'] as const) {
        const o = st[k];
        if (isObj(o) && !inFrameIndex(o.spot, area)) return false;
      }
      if (Array.isArray(st.railOut)) for (const r of st.railOut as unknown[]) if (isObj(r) && !inFrameIndex(r.i, area)) return false;
      for (const k of ['locals', 'crackdowns'] as const) {
        const list = st[k];
        if (Array.isArray(list)) for (const e of list as unknown[]) if (isObj(e) && (!inFrameXY(e.x, N) || !inFrameXY(e.y, N))) return false;
      }
    }
  }
  return true;
}

/**
 * Read and check a city file (§13.3), every check before anything changes; the first failure returns its message.
 * Never throws. On success: the header, the save JSON exactly as exported and the save parsed once (a v1–v3 save as
 * it is: Game.importCity migrates it like a stored one).
 */
export async function readCityFile(input: string | Blob | ArrayBuffer | Uint8Array): Promise<ReadResult> {
  try {
    return await readUnsafe(input);
  } catch {
    return fail('damaged');
  }
}

async function readUnsafe(input: string | Blob | ArrayBuffer | Uint8Array): Promise<ReadResult> {
  // 1. Larger than 2 MB, or not text.
  const text = await textOf(input);
  if (text === null || text === 'big') return fail('notCity');
  // 2. The first non-blank line is the magic line (a BOM, blank lines and CRLF line ends are fine).
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const magic = /^CYBERCITY (\d{1,6})$/.exec((lines[i] ?? '').trim());
  if (!magic) return fail('notCity');
  const n = Number(magic[1]);
  if (n < 1) return fail('notCity');
  // 3. A newer file format.
  if (n > TRANSFER_FORMAT) return fail('newer');
  i++;
  while (i < lines.length && !lines[i].trim()) i++;
  const headLine = (lines[i] ?? '').trim();
  // 4. The header: JSON, ours.
  if (!headLine || headLine.length > HEADER_MAX_CHARS || headLine[0] !== '{') return fail('notCity');
  let head: unknown;
  try {
    head = JSON.parse(headLine);
  } catch {
    return fail('notCity');
  }
  if (!isObj(head)) return fail('notCity');
  const format = Number(head.format);
  if (Number.isFinite(format) && format > TRANSFER_FORMAT) return fail('newer');
  if (head.game !== TRANSFER_GAME || format !== TRANSFER_FORMAT) return fail('notCity');
  // 5. A newer save version or region.
  const saveV = Number(head.save);
  if (!isInt(saveV) || saveV < 1) return fail('damaged');
  if (saveV > Math.max(...SAVE_VERSIONS_SUPPORTED) || !(head.region === 3 || head.region === 5)) return fail('newer');
  // 6. Encoding this browser can open.
  const enc = head.enc;
  if (enc !== 'gzip-b64' && enc !== 'json') return fail('damaged');
  if (enc === 'gzip-b64' && typeof DecompressionStream !== 'function') return fail('noDecompress');
  // 7. Unpack: base64 / gzip, the size cap, bytes and sum.
  const body = lines.slice(i + 1).join('\n');
  let json: string;
  if (enc === 'json') {
    json = body.trim();
    if (new TextEncoder().encode(json).length > UNPACKED_MAX_BYTES) return fail('damaged');
  } else {
    const packed = b64Bytes(body);
    if (!packed) return fail('damaged');
    const raw = await gunzipCapped(packed, UNPACKED_MAX_BYTES);
    if (!raw) return fail('damaged');
    const t = decodeText(raw);
    if (t === null) return fail('damaged');
    json = t;
  }
  if (Number(head.bytes) !== json.length || head.sum !== fnv1a(json)) return fail('damaged');
  // 8. The save JSON agrees with its header.
  let save: SaveData;
  try {
    save = JSON.parse(json) as SaveData;
  } catch {
    return fail('damaged');
  }
  if (!isObj(save) || Number(save.version) !== saveV) return fail('damaged');
  if (Number(save.seed) >>> 0 !== Number(head.seed) >>> 0 || (Number(save.tick) | 0) !== (Number(head.day) | 0)) return fail('damaged');
  if (saveV >= 4) {
    if (Number(save.region) !== head.region || Number(save.size) !== SLOT * head.region) return fail('damaged');
  } else if (head.region !== 3) return fail('damaged');
  // 9. The structural checks deserialize makes (a v1–v3 save after the migration it will get), without a World.
  let shaped: SaveData = save;
  try {
    if (saveV <= 3) {
      if (!(Array.isArray(save.tiles) && save.tiles.length === SLOT * SLOT)) return fail('incompatible');
      shaped = upgradeSave(save);
    }
    const { region } = validateSaveShape(shaped);
    if (region !== head.region || !insideFrame(shaped, region)) return fail('incompatible');
  } catch {
    return fail('incompatible');
  }
  const h = head as Record<string, unknown>;
  const header: TransferHeader = {
    game: TRANSFER_GAME,
    format,
    save: saveV,
    region: head.region as 3 | 5,
    city: String(h.city ?? save.cityName ?? '').slice(0, 24),
    seed: Number(save.seed) >>> 0,
    day: Number(save.tick) | 0,
    pace: typeof h.pace === 'string' && (STORY_PACES as readonly string[]).includes(h.pace) ? (h.pace as StoryPace) : null,
    pop: Math.max(0, Math.round(Number(h.pop) || 0)),
    districts: isInt(h.districts) ? h.districts : 1,
    chapter: isInt(h.chapter) ? h.chapter : 1,
    ending: typeof h.ending === 'string' && h.ending ? (h.ending as EndingId) : null,
    exported: typeof h.exported === 'string' ? h.exported.slice(0, 40) : '',
    enc,
    bytes: json.length,
    sum: String(h.sum),
  };
  return { ok: true, header, save, json };
}

// ── The preview's facts (§13.1) ─────────────────────────────────────────────

/** What a checked file holds, from its save (the truth) rather than the header. */
export interface FileFacts {
  city: string;
  region: 3 | 5;
  owned: number;
  total: number;
  peak: number;
  seed: number;
  day: number;
  chapter: number;
  ending: EndingId | null;
  pace: StoryPace | null;
  /** Milliseconds since the epoch, NaN when unknown. */
  exportedAt: number;
}

export function fileFacts(r: Extract<ReadResult, { ok: true }>): FileFacts {
  const f = headerFields(r.save);
  const v3 = r.header.save <= 3;
  return {
    city: f.city || r.header.city || 'Unnamed city',
    region: v3 ? 3 : f.region,
    owned: v3 ? 1 : f.districts,
    total: (v3 ? 3 : f.region) ** 2,
    // A v1–v3 save counts v3 people: show today's units (×10), as loading it will (§4.4).
    peak: v3 && !(Number(r.save.scale) > 0) ? f.pop * 10 : f.pop,
    seed: f.seed,
    day: f.day,
    chapter: f.chapter,
    ending: f.ending,
    pace: f.pace ?? r.header.pace,
    exportedAt: Date.parse(r.header.exported),
  };
}

/** How the file's city relates to the one on this device (§13.1): another city, a newer, older or the same copy. */
export type SameCity = 'other' | 'newer' | 'older' | 'same';
export function sameCity(file: { seed: number; day: number }, current: { seed: number; day: number } | null): SameCity {
  if (!current || file.seed >>> 0 !== current.seed >>> 0) return 'other';
  return file.day > current.day ? 'newer' : file.day < current.day ? 'older' : 'same';
}

// ── Export platform choice (§13.5) ──────────────────────────────────────────

export type ExportAction = 'share' | 'download' | 'copy';
export interface ExportEnv {
  /** §3.11's device class is 'handheld'. */
  handheld: boolean;
  /** navigator.canShare?.({ files: [file] }) accepted the file. */
  canShareFiles: boolean;
  /** window.top !== window (a sandboxed frame such as the claude.ai artifact build). */
  framed: boolean;
  /** An iOS Home Screen app (standalone), where blob downloads are unreliable. */
  iosStandalone: boolean;
}
export interface ExportPlan {
  /** In order; the first is the primary. */
  actions: ExportAction[];
  /** "If nothing downloads, use Copy as text." */
  frameNote: boolean;
}

/**
 * The Export sheet's buttons (§13.5): Share first on a handheld device that can share files, Download first on a PC
 * (Share second where the file can be shared), Copy as text always last (pages where neither works, or to paste into
 * a note). An iOS Home Screen app without file sharing gets Copy as text instead of Download.
 */
export function exportPlan(env: ExportEnv): ExportPlan {
  const actions: ExportAction[] = [];
  const download = !(env.iosStandalone && !env.canShareFiles);
  if (env.handheld && env.canShareFiles) actions.push('share');
  if (download) actions.push('download');
  if (!env.handheld && env.canShareFiles) actions.push('share');
  actions.push('copy');
  return { actions, frameNote: env.framed && download };
}
