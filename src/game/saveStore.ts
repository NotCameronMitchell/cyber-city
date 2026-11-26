// ─────────────────────────────────────────────────────────────────────────────
// The storage plan (docs/MEGACITY.md §3.10). Frozen after Step 0b.
//
// localStorage is synchronous (the pagehide save needs that) and small (plan
// for 2.5 M characters per origin). The rule: the main save stays plain JSON
// and synchronous; backups of big saves are compressed envelopes, a small JSON
// object whose header stays readable:
//   {"version":4,"region":5,"cityName":"…","maxPopulation":…,"savedAt":…,"scale":10,"z":"<base64 of gzip(save JSON)>"}
// Because it carries `version`, every older build's newer-save check still
// works. Envelopes are written asynchronously (CompressionStream) and read back
// at boot by readStoredSave(), which keeps the unpacked text in memory so the
// synchronous Game paths (Continue, Restore previous city, the kept city) can
// read it.
// ─────────────────────────────────────────────────────────────────────────────

import { REGION, SAVE_KEY } from './config';
import { isFutureSave } from './districts/migrate';
import { storageGet, storageRemove, storageSet } from './storage';
import { SLOT, type SaveData } from './types';

/** Backup slot: New City, Import, Restore and Grow move the city they replace here ("Restore previous city"). */
export const PREV_SAVE_KEY = `${SAVE_KEY}.prev`;
/** Raw copy of a save written by a newer build (written once, if empty). While it is the stored save, autosave is blocked. */
export const FUTURE_SAVE_KEY = `${SAVE_KEY}.future`;
/** Raw copy of a stored save that failed to load for any other reason, taken before the fresh city starts. */
export const UNREADABLE_SAVE_KEY = `${SAVE_KEY}.unreadable`;
/** Raw copy of the first v1 / v2 save this build loaded (once; never overwritten), so a downgrade can recover it. */
export const V2_SAVE_KEY = `${SAVE_KEY}.v2`;
/** Raw copy of the first v3 save this build loaded (once; never overwritten, MEGACITY §3.10). */
export const V3_SAVE_KEY = `${SAVE_KEY}.v3`;
/** Mirror of the last save this build wrote: plain up to MIRROR_PLAIN_MAX characters, a compressed envelope above. */
export const MIRROR_SAVE_KEY = `${SAVE_KEY}.mirror`;
/** Raw copy of the older-version save that replaced the city, kept when the mirror is restored. */
export const STALE_SAVE_KEY = `${SAVE_KEY}.stale`;

/** A save up to this many characters gets a plain mirror; a bigger one an envelope (or none without CompressionStream). */
export const MIRROR_PLAIN_MAX = 300_000;
/** Dropped in this order when a write hits the quota; `.prev`, `.future`, `.v2` and `.v3` are other cities and never go. */
export const EVICTION_ORDER: readonly string[] = [STALE_SAVE_KEY, UNREADABLE_SAVE_KEY, MIRROR_SAVE_KEY];
/** The storage-full toast (§3.10), once a session, with an Export action. */
export const STORAGE_FULL_TEXT = "Couldn't save: storage is full. Export your city to keep a copy.";

/** The readable header of a compressed envelope. */
export interface EnvelopeHeader {
  version: number;
  region: number;
  cityName: string;
  maxPopulation: number;
  savedAt: number;
  scale: number;
}
export interface Envelope extends EnvelopeHeader {
  /** base64 of gzip(save JSON). */
  z: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Parse a stored string as an envelope (header plus `z`), or null. */
export function parseEnvelope(raw: string | null): Envelope | null {
  if (!raw || raw.length < 2 || raw[0] !== '{') return null;
  // Cheap reject: a plain save has no "z" key at the top level near the end.
  if (!raw.includes('"z"')) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isObj(v) || typeof v.z !== 'string' || 'tileBlocks' in v || 'tiles' in v) return null;
    return v as unknown as Envelope;
  } catch {
    return null;
  }
}

/** The header of an envelope or of a plain save (name, peak population, region, version), without unpacking. */
export function readHeader(raw: string | null): EnvelopeHeader | null {
  if (!raw) return null;
  const env = parseEnvelope(raw);
  if (env)
    return {
      version: Number(env.version),
      region: Number(env.region),
      cityName: String(env.cityName ?? ''),
      maxPopulation: Number(env.maxPopulation) || 0,
      savedAt: Number(env.savedAt) || 0,
      scale: Number(env.scale) || 0,
    };
  try {
    const d = JSON.parse(raw) as Partial<SaveData> | null;
    if (!isObj(d)) return null;
    return {
      version: Number(d.version),
      region: d.region === undefined ? (Number(d.version) <= 3 ? 3 : NaN) : Number(d.region),
      cityName: String(d.cityName ?? ''),
      maxPopulation: Number(d.maxPopulation) || 0,
      savedAt: Number(d.savedAt) || 0,
      scale: Number(d.scale) || 0,
    };
  } catch {
    return null;
  }
}

// ── Compression ─────────────────────────────────────────────────────────────

/** True where CompressionStream / DecompressionStream exist (iOS 16.4+, every current desktop browser, Node 22). */
export function hasCompression(): boolean {
  return typeof (globalThis as { CompressionStream?: unknown }).CompressionStream === 'function' && typeof (globalThis as { DecompressionStream?: unknown }).DecompressionStream === 'function';
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[]);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** gzip → base64 of a string (null without CompressionStream or on failure). */
export async function gzipB64(text: string): Promise<string | null> {
  if (!hasCompression()) return null;
  try {
    return bytesToB64(await pipe(new TextEncoder().encode(text), new CompressionStream('gzip')));
  } catch {
    return null;
  }
}

/** base64 → gunzip → string (null on failure). */
export async function gunzipB64(b64: string): Promise<string | null> {
  if (!hasCompression()) return null;
  try {
    return new TextDecoder().decode(await pipe(b64ToBytes(b64), new DecompressionStream('gzip')));
  } catch {
    return null;
  }
}

/** Pack a save's JSON into an envelope string (header from `data`), or null without CompressionStream. */
export async function packEnvelope(json: string, data?: Pick<SaveData, 'version' | 'region' | 'cityName' | 'maxPopulation' | 'savedAt' | 'scale'>): Promise<string | null> {
  const d = data ?? (JSON.parse(json) as SaveData);
  const z = await gzipB64(json);
  if (z === null) return null;
  const env: Envelope = {
    version: Number(d.version),
    region: Number(d.region ?? 3),
    cityName: String(d.cityName ?? ''),
    maxPopulation: Number(d.maxPopulation) || 0,
    savedAt: Number(d.savedAt) || Date.now(),
    scale: Number(d.scale) || 0,
    z,
  };
  return JSON.stringify(env);
}

/** Unpack an envelope string to the save JSON it holds (null when it isn't one, or it can't be unpacked). */
export async function unpackEnvelope(raw: string): Promise<string | null> {
  const env = parseEnvelope(raw);
  if (!env) return null;
  return gunzipB64(env.z);
}

// ── The unpacked-text cache ─────────────────────────────────────────────────

/** key → { the stored envelope string, the save JSON it holds }. Filled by readStoredSave and by our own envelope writes. */
const unpacked = new Map<string, { stored: string; plain: string }>();

/** Test hook: forget every cached unpacked text. */
export function clearUnpackedCache(): void {
  unpacked.clear();
}

/**
 * The save JSON stored under `key`, synchronously: a plain save as stored, an envelope when this session unpacked it
 * (readStoredSave at boot, or our own write), else null (an envelope nobody unpacked yet: call unpackStored).
 */
export function readPlain(key: string): string | null {
  const raw = storageGet(key);
  if (raw === null) return null;
  if (!parseEnvelope(raw)) return raw;
  const c = unpacked.get(key);
  return c && c.stored === raw ? c.plain : null;
}

/** Unpack the envelope under `key` into the cache (no-op for plain or missing values). Returns the save JSON or null. */
export async function unpackStored(key: string): Promise<string | null> {
  const raw = storageGet(key);
  if (raw === null) return null;
  if (!parseEnvelope(raw)) return raw;
  const cached = unpacked.get(key);
  if (cached && cached.stored === raw) return cached.plain;
  const plain = await unpackEnvelope(raw);
  if (plain !== null) unpacked.set(key, { stored: raw, plain });
  return plain;
}

/** True when an envelope's header (or a save's) names a version or region this build can't load (a newer build's). */
export function isFutureHeader(h: Pick<EnvelopeHeader, 'version' | 'region'> | null): boolean {
  if (!h) return false;
  return isFutureSave({ version: h.version, region: h.region, size: SLOT * h.region });
}

/**
 * Boot (§3.10): `main.ts` awaits this before constructing Game. An envelope in SAVE_KEY (only after an older build
 * restored our envelope mirror there) is unpacked into memory first, so the synchronous load reads it even when the
 * write-back below fails, then written back plain with the quota rule. A newer build's envelope is left exactly as
 * stored (Game blocks on it). Envelopes in the mirror, `.prev` and `.future` are unpacked into memory (never written
 * back: `.future` stays as the newer build left it). An envelope that doesn't unpack stays as stored: Game reads its
 * header (a newer build's: blocked; ours: copied to `.unreadable` before a fresh city starts).
 */
export async function readStoredSave(): Promise<void> {
  const main = storageGet(SAVE_KEY);
  const env = parseEnvelope(main);
  if (main !== null && env) {
    const plain = await unpackEnvelope(main);
    if (plain !== null) {
      unpacked.set(SAVE_KEY, { stored: main, plain });
      let future = isFutureHeader(readHeader(main));
      if (!future)
        try {
          future = isFutureSave(JSON.parse(plain));
        } catch {
          future = false;
        }
      if (!future && writeWithEviction(SAVE_KEY, plain)) unpacked.delete(SAVE_KEY);
    }
  }
  for (const key of [MIRROR_SAVE_KEY, PREV_SAVE_KEY, FUTURE_SAVE_KEY]) await unpackStored(key);
}

/** A stored value and its unpacked text, so a write can be undone exactly (`restoreKey`). */
export interface KeySnapshot {
  key: string;
  stored: string | null;
  cached: { stored: string; plain: string } | undefined;
}
/** Take a snapshot of `key` (the stored string, and the unpacked text this session holds for it). */
export function snapshotKey(key: string): KeySnapshot {
  return { key, stored: storageGet(key), cached: unpacked.get(key) };
}
/**
 * Put `key` back as the snapshot had it (removed when it was empty). Used when a swap must change nothing: the value
 * it replaced fitted before, so writing it back over the bigger or smaller one fits again. False if even that fails.
 */
export function restoreKey(snap: KeySnapshot): boolean {
  if (snap.stored === null) {
    storageRemove(snap.key);
    unpacked.delete(snap.key);
    return true;
  }
  if (storageGet(snap.key) !== snap.stored && !writeWithEviction(snap.key, snap.stored)) return false;
  if (snap.cached && snap.cached.stored === snap.stored) unpacked.set(snap.key, snap.cached);
  else unpacked.delete(snap.key);
  return true;
}

/** Why `keepNewerSave` could not keep the stored save: storage is full, or `.future` holds a different city. */
export type KeepNewerResult = 'kept' | 'full' | 'taken';

/** Name, seed (when readable) and save time of a stored save, for telling copies of one city apart. */
function cityOf(key: string, raw: string): { name: string; seed: number | null; savedAt: number } | null {
  const h = readHeader(raw);
  if (!h) return null;
  let seed: number | null = null;
  const plain = parseEnvelope(raw) ? readPlain(key) : raw;
  if (plain !== null)
    try {
      const s = Number((JSON.parse(plain) as { seed?: unknown }).seed);
      seed = Number.isFinite(s) ? s : null;
    } catch {
      seed = null;
    }
  return { name: h.cityName, seed, savedAt: h.savedAt };
}

/**
 * Before a stale session lifts the newer-save block (New City, Restore, Import, Grow) and writes SAVE_KEY, make sure
 * `.future` holds exactly the stored main save (§3.10, EXPANSION §2.5), written with the quota rule. An older copy of
 * the same city there (same name and seed, saved no later) is replaced; any other content of `.future` is another
 * kept city and is never overwritten ('taken'). 'full' when it doesn't fit even after the drops. Boot calls it too.
 */
export function keepNewerSave(): KeepNewerResult {
  const main = storageGet(SAVE_KEY);
  if (main === null) return 'kept';
  const fut = storageGet(FUTURE_SAVE_KEY);
  if (fut === main) return 'kept';
  if (fut !== null) {
    const a = cityOf(FUTURE_SAVE_KEY, fut);
    const b = cityOf(SAVE_KEY, main);
    const same = !!a && !!b && a.name === b.name && (a.seed === null || b.seed === null || a.seed === b.seed) && a.savedAt <= b.savedAt;
    if (!same) return 'taken';
  }
  if (!writeWithEviction(FUTURE_SAVE_KEY, main)) return 'full';
  const c = unpacked.get(SAVE_KEY);
  if (c && c.stored === main) unpacked.set(FUTURE_SAVE_KEY, c);
  else unpacked.delete(FUTURE_SAVE_KEY);
  return 'kept';
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * setItem with the quota rule (§3.10): on failure drop `.stale`, then `.unreadable`, then `.mirror` (never `.prev`,
 * `.future`, `.v2`, `.v3`), retrying after each. Returns whether the value is stored.
 */
export function writeWithEviction(key: string, value: string): boolean {
  if (storageSet(key, value)) return true;
  for (const drop of EVICTION_ORDER) {
    if (drop === key || storageGet(drop) === null) continue;
    storageRemove(drop);
    unpacked.delete(drop);
    if (storageSet(key, value)) return true;
  }
  return false;
}

/** Idle scheduling (requestIdleCallback with a 500 ms timeout, else a timer); tests may replace it. */
export let scheduleIdle: (fn: () => void) => void = (fn) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 500 });
  else setTimeout(fn, 0);
};
/** Test hook: run idle work synchronously (or restore the default). */
export function setIdleScheduler(fn: ((fn: () => void) => void) | null): void {
  scheduleIdle =
    fn ??
    ((f) => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === 'function') ric(f, { timeout: 500 });
      else setTimeout(f, 0);
    });
}

/** Pending envelope writes, so tests (and a pagehide) can wait for them. */
const pending = new Set<Promise<void>>();
/** Resolve when every envelope write started so far has finished. */
export async function flushEnvelopes(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/**
 * The mirror's write generation: every mirror write (plain, removed, or an envelope scheduled) takes the next one, and
 * an envelope that finishes compressing lands only if no later mirror write happened meanwhile. So `.mirror` always
 * holds the last save this build wrote (or nothing), never an older or different city (§3.10, EXPANSION §2.5).
 */
let mirrorGen = 0;

/**
 * Replace the plain value under `key` with a compressed envelope in an idle callback, if the key still holds exactly
 * `json` then (nothing newer was written); for the mirror, if no later mirror write happened (its generation). The
 * unpacked text stays in memory so synchronous reads keep working.
 */
export function envelopeLater(key: string, json: string, data?: Parameters<typeof packEnvelope>[1]): void {
  if (!hasCompression()) return;
  const gen = mirrorGen;
  scheduleIdle(() => {
    const p = (async () => {
      const env = await packEnvelope(json, data);
      if (env === null) return;
      if (key === MIRROR_SAVE_KEY) {
        if (gen !== mirrorGen) return;
        if (writeWithEviction(key, env)) unpacked.set(key, { stored: env, plain: json });
        else {
          // No room for this save's mirror: an older one would point at another city state, so it goes.
          if (storageGet(key) !== null) storageRemove(key);
          unpacked.delete(key);
        }
        return;
      }
      if (storageGet(key) !== json) return;
      if (writeWithEviction(key, env)) unpacked.set(key, { stored: env, plain: json });
    })();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
}

/** Mirror state per session: the unpaused seconds since the last envelope mirror (5×5 cities only). */
let mirrorSec = Infinity;
/** Game calls this with unpaused seconds (the envelope mirror's cadence). */
export function tickMirrorClock(dt: number): void {
  if (Number.isFinite(mirrorSec)) mirrorSec += dt;
}
/** Test hook. */
export function resetMirrorClock(): void {
  mirrorSec = Infinity;
}

export interface MainWriteResult {
  /** The main save is stored. */
  ok: boolean;
  /** 'plain' | 'envelope' (scheduled) | 'none' (none written this time). */
  mirror: 'plain' | 'envelope' | 'none';
}

/**
 * Write the main save (plain, synchronous) with the quota rule, then the mirror (§3.10): plain while the save is
 * ≤ MIRROR_PLAIN_MAX characters; larger, a compressed envelope written asynchronously at most every
 * `mirrorEverySec` unpaused seconds (REGION[R].mirrorEverySec, LOW_DETAIL's in lower detail), or now with `force`
 * (New City, Import, Restore). Without CompressionStream a big save gets no mirror.
 */
export function writeMainSave(json: string, data: Pick<SaveData, 'version' | 'region' | 'cityName' | 'maxPopulation' | 'savedAt' | 'scale'>, opts: { mirrorEverySec?: number; force?: boolean } = {}): MainWriteResult {
  if (!writeWithEviction(SAVE_KEY, json)) return { ok: false, mirror: 'none' };
  if (json.length <= MIRROR_PLAIN_MAX) {
    mirrorGen++;
    unpacked.delete(MIRROR_SAVE_KEY);
    // A failed mirror write must not leave the previous city's mirror behind.
    if (storageSet(MIRROR_SAVE_KEY, json)) return { ok: true, mirror: 'plain' };
    if (storageGet(MIRROR_SAVE_KEY) !== null) storageRemove(MIRROR_SAVE_KEY);
    return { ok: true, mirror: 'none' };
  }
  if (!hasCompression()) {
    // No envelope possible: a stale plain mirror would point at an older city state, so it goes.
    mirrorGen++;
    storageRemove(MIRROR_SAVE_KEY);
    unpacked.delete(MIRROR_SAVE_KEY);
    return { ok: true, mirror: 'none' };
  }
  const every = opts.mirrorEverySec ?? REGION[5].mirrorEverySec;
  if (!opts.force && Number.isFinite(mirrorSec) && mirrorSec < every) return { ok: true, mirror: 'none' };
  mirrorSec = 0;
  mirrorGen++;
  // A forced mirror follows a city swap (New City, Import, Restore): until the envelope lands, the old mirror would
  // be another city, so it goes now.
  if (opts.force && storageGet(MIRROR_SAVE_KEY) !== null) {
    storageRemove(MIRROR_SAVE_KEY);
    unpacked.delete(MIRROR_SAVE_KEY);
  }
  envelopeLater(MIRROR_SAVE_KEY, json, data);
  return { ok: true, mirror: 'envelope' };
}

/**
 * Keep the city being replaced in `.prev` (§3.10): plain and synchronous first (with the quota rule), then swapped for
 * an envelope in an idle callback where CompressionStream exists. False when even after the drops it doesn't fit:
 * the caller changes nothing and offers Export and Replace without a copy.
 */
export function writePrev(json: string): boolean {
  if (!writeWithEviction(PREV_SAVE_KEY, json)) return false;
  unpacked.delete(PREV_SAVE_KEY);
  envelopeLater(PREV_SAVE_KEY, json);
  return true;
}
