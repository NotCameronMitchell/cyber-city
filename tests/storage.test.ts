// The storage plan (docs/MEGACITY.md §3.10, §11.2 item 14): plain main save, envelopes, the mirror rule, `.prev`,
// eviction, the kept newer city and the story pace.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../src/game/config';
import { Game } from '../src/game/game';
import {
  FUTURE_SAVE_KEY,
  MIRROR_SAVE_KEY,
  MIRROR_PLAIN_MAX,
  PREV_SAVE_KEY,
  STALE_SAVE_KEY,
  STORAGE_FULL_TEXT,
  UNREADABLE_SAVE_KEY,
  V2_SAVE_KEY,
  V3_SAVE_KEY,
  clearUnpackedCache,
  flushEnvelopes,
  gzipB64,
  keepNewerSave,
  packEnvelope,
  parseEnvelope,
  readHeader,
  readPlain,
  readStoredSave,
  resetMirrorClock,
  setIdleScheduler,
  unpackEnvelope,
  writeMainSave,
} from '../src/game/saveStore';
import { RoadKind } from '../src/game/types';
import { World } from '../src/game/world';
import { bootV3, isFutureSaveV3, newCityV3, restoreMirrorV3 } from './v3-save-safety';

/** A fake localStorage with a character quota (UTF-16 code units, like WebKit's 5 MB). */
function quotaStorage(quota = Infinity, init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = m.get(k);
      m.set(k, String(v));
      if (used() > quota) {
        if (before === undefined) m.delete(k);
        else m.set(k, before);
        throw new Error('QuotaExceededError');
      }
    },
    removeItem: (k: string) => void m.delete(k),
  };
  return m;
}
const store = (m: Map<string, string>) => ({ get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) });

beforeEach(() => {
  setIdleScheduler((fn) => fn());
  resetMirrorClock();
  clearUnpackedCache();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  setIdleScheduler(null);
});

/** A city with progress (worth keeping), on a region. */
function city(name: string, region: 3 | 5 = 3) {
  const g = new Game();
  g.newCity(name, 4321, region);
  const w = g.world;
  const o = w.ownedBox;
  for (let x = o.x0 + 10; x < o.x0 + 30; x++) w.setRoad(x, o.y0 + 20, RoadKind.Street);
  return g;
}

describe('envelopes', () => {
  it('pack and unpack round-trip exactly; the header stays readable', async () => {
    const data = new World(9, 'Neon Bay', undefined, 5).serialize();
    const json = JSON.stringify(data);
    const env = (await packEnvelope(json, data))!;
    expect(env.length).toBeLessThan(json.length / 2);
    const e = parseEnvelope(env)!;
    expect([e.version, e.region, e.cityName, e.scale]).toEqual([4, 5, 'Neon Bay', 10]);
    expect(readHeader(env)).toMatchObject({ version: 4, region: 5, cityName: 'Neon Bay' });
    expect(await unpackEnvelope(env)).toBe(json);
    expect(parseEnvelope(json)).toBeNull();
  });

  it("today's v3 rules treat an envelope as a newer save and keep it", async () => {
    const big = new World(9, 'Neon Bay', undefined, 5).serialize();
    const env = (await packEnvelope(JSON.stringify(big), big))!;
    expect(isFutureSaveV3(JSON.parse(env))).toBe(true);
    // A v3 build finds an older-version main beside our envelope mirror: it restores the envelope, then blocks on it.
    const v2 = JSON.stringify({ version: 2, cityName: 'Stale', tiles: [] });
    const m = quotaStorage(Infinity, { [SAVE_KEY]: v2, [MIRROR_SAVE_KEY]: env });
    expect(restoreMirrorV3(store(m))).toBe(true);
    expect(m.get(SAVE_KEY)).toBe(env);
    expect(bootV3(store(m)).blocked).toBe(true);
    expect(m.get(FUTURE_SAVE_KEY)).toBe(env);
    expect(m.get(STALE_SAVE_KEY)).toBe(v2);
  });

  it('boot unpacks an envelope found in SAVE_KEY and the city loads', async () => {
    const g = city('Envelope City');
    const data = g.world.serialize();
    const env = (await packEnvelope(JSON.stringify(data), data))!;
    const m = quotaStorage(Infinity, { [SAVE_KEY]: env });
    await readStoredSave();
    expect(parseEnvelope(m.get(SAVE_KEY)!)).toBeNull();
    const loaded = new Game();
    expect(loaded.world.cityName).toBe('Envelope City');
    expect(loaded.saveBlocked).toBe(false);
  });
});

describe('the main save and the mirror', () => {
  it('the main save is plain JSON at both sizes; a small save gets a plain mirror, a big one an envelope', async () => {
    for (const region of [3, 5] as const) {
      const m = quotaStorage();
      const g = city(`Plain ${region}`, region);
      expect(g.save()).toBe(true);
      expect(JSON.parse(m.get(SAVE_KEY)!).region).toBe(region);
      expect(m.get(MIRROR_SAVE_KEY)).toBe(m.get(SAVE_KEY));
    }
    // A save over MIRROR_PLAIN_MAX characters: the mirror becomes an envelope (asynchronously).
    const m = quotaStorage();
    const big = JSON.stringify({ version: 4, region: 5, size: 320, cityName: 'Big', pad: 'x'.repeat(MIRROR_PLAIN_MAX + 10) });
    const r = writeMainSave(big, JSON.parse(big), { force: true });
    expect(r).toEqual({ ok: true, mirror: 'envelope' });
    expect(m.get(SAVE_KEY)).toBe(big);
    await flushEnvelopes();
    const env = parseEnvelope(m.get(MIRROR_SAVE_KEY)!)!;
    expect(env.cityName).toBe('Big');
    expect(await unpackEnvelope(m.get(MIRROR_SAVE_KEY)!)).toBe(big);
    // At most every mirrorEverySec: the next save skips the envelope.
    expect(writeMainSave(big, JSON.parse(big), { mirrorEverySec: 300 }).mirror).toBe('none');
  });

  it('without CompressionStream everything is plain and a big save gets no mirror', () => {
    const cs = (globalThis as { CompressionStream?: unknown }).CompressionStream;
    (globalThis as { CompressionStream?: unknown }).CompressionStream = undefined;
    try {
      const m = quotaStorage(Infinity, { [MIRROR_SAVE_KEY]: 'old mirror' });
      const big = JSON.stringify({ version: 4, cityName: 'Big', pad: 'x'.repeat(MIRROR_PLAIN_MAX + 10) });
      expect(writeMainSave(big, JSON.parse(big), { force: true })).toEqual({ ok: true, mirror: 'none' });
      expect(m.get(MIRROR_SAVE_KEY)).toBeUndefined();
    } finally {
      (globalThis as { CompressionStream?: unknown }).CompressionStream = cs;
    }
  });

  it('on quota failure .stale, .unreadable and .mirror go in that order; .prev, .future, .v2, .v3 never; then one toast with Export', () => {
    const keep = { [PREV_SAVE_KEY]: 'p'.repeat(100), [FUTURE_SAVE_KEY]: 'f'.repeat(100), [V2_SAVE_KEY]: '2'.repeat(100), [V3_SAVE_KEY]: '3'.repeat(100) };
    const g = city('Quota');
    const json = JSON.stringify(g.world.serialize());
    const keepTotal = Object.entries(keep).reduce((n, [k, v]) => n + k.length + v.length, 0);
    // Room for the main save, the kept cities and the mirror: .stale and .unreadable must go, .mirror can stay.
    const quota = json.length + SAVE_KEY.length + keepTotal + 700 + MIRROR_SAVE_KEY.length + 100;
    const m = quotaStorage(quota, { ...keep, [STALE_SAVE_KEY]: 's'.repeat(700), [UNREADABLE_SAVE_KEY]: 'u'.repeat(700), [MIRROR_SAVE_KEY]: 'm'.repeat(700) });
    expect(g.save()).toBe(true);
    expect(m.has(STALE_SAVE_KEY)).toBe(false);
    expect(m.has(UNREADABLE_SAVE_KEY)).toBe(false);
    // The eviction kept the mirror, but this save's plain mirror then didn't fit: a mirror of another city state
    // would be worse than none, so it goes (review fix; the eviction order itself is logged in 'the drop order').
    expect(m.has(MIRROR_SAVE_KEY)).toBe(false);
    // Tighter still: the mirror goes last.
    const m3 = quotaStorage(json.length + SAVE_KEY.length + keepTotal + 50, { ...keep, [MIRROR_SAVE_KEY]: 'm'.repeat(700) });
    expect(g.save()).toBe(true);
    expect(m3.get(SAVE_KEY)).toBe(json.replace(/"savedAt":\d+/, m3.get(SAVE_KEY)!.match(/"savedAt":\d+/)![0]));
    expect(m3.has(MIRROR_SAVE_KEY)).toBe(false);
    for (const [k, v] of Object.entries(keep)) expect(m.get(k)).toBe(v);
    // Storage that can't hold the city at all: nothing of another city is dropped, one toast with Export.
    const m2 = quotaStorage(1000, keep);
    const toasts: { text: string; id?: string }[] = [];
    g.events.on('toast', (t) => toasts.push({ text: t.text, id: t.action?.id }));
    expect(g.save()).toBe(false);
    expect(g.save()).toBe(false);
    for (const [k, v] of Object.entries(keep)) expect(m2.get(k)).toBe(v);
    expect(toasts).toEqual([{ text: STORAGE_FULL_TEXT, id: 'export' }]);
  });
});

describe('.prev (Previous city)', () => {
  it('New City writes the replaced city to .prev plain and synchronously, then swaps it for an envelope', async () => {
    let deferred: (() => void)[] = [];
    setIdleScheduler((fn) => void deferred.push(fn));
    const m = quotaStorage();
    const g = city('First');
    const first = JSON.stringify(g.world.serialize());
    g.newCity('Second', 99, 3);
    // Plain first (the same city, saved a moment later).
    const plain = m.get(PREV_SAVE_KEY)!;
    expect(JSON.parse(plain).cityName).toBe('First');
    expect(JSON.parse(plain).tileBlocks).toEqual(JSON.parse(first).tileBlocks);
    // The idle callback swaps it for an envelope; the title reads its header; Restore unpacks it.
    for (const f of deferred) f();
    deferred = [];
    await flushEnvelopes();
    expect(parseEnvelope(m.get(PREV_SAVE_KEY)!)).not.toBeNull();
    expect(g.previousSaveInfo()).toMatchObject({ cityName: 'First', region: 3 });
    expect(g.loadPrevious()).toBe(true);
    expect(g.world.cityName).toBe('First');
  });

  it('while saveBlocked, New City and Restore never write the stand-in city to .prev', () => {
    const future = JSON.stringify({ version: 5, cityName: 'From The Future' });
    const prev = JSON.stringify(new World(3, 'Old Town', undefined, 3).serialize());
    const m = quotaStorage(Infinity, { [SAVE_KEY]: future });
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    const o = g.world.ownedBox;
    g.world.setRoad(o.x0 + 5, o.y0 + 5); // progress on the stand-in
    g.newCity('Fresh', 7, 3);
    expect(m.has(PREV_SAVE_KEY)).toBe(false);
    // Restore in a blocked session: the stand-in never lands in .prev either.
    const m2 = quotaStorage(Infinity, { [SAVE_KEY]: future, [PREV_SAVE_KEY]: prev });
    const g2 = new Game();
    g2.world.setRoad(g2.world.ownedBox.x0 + 5, g2.world.ownedBox.y0 + 5);
    expect(g2.loadPrevious()).toBe(true);
    expect(g2.world.cityName).toBe('Old Town');
    expect(m2.has(PREV_SAVE_KEY)).toBe(false);
  });

  it('a failed .prev write (after the drops) changes nothing and offers Export; Replace without a copy goes ahead', () => {
    const g = city('Precious');
    const json = JSON.stringify(g.world.serialize());
    const m = quotaStorage(json.length + 400, { [SAVE_KEY]: json });
    const toasts: string[] = [];
    g.events.on('toast', (t) => t.action?.id === 'export' && toasts.push(t.text));
    g.newCity('Replacement', 5, 3);
    expect(g.world.cityName).toBe('Precious');
    expect(g.keepCopyFailed).toBe('Precious');
    expect(m.get(SAVE_KEY)).toBe(json);
    expect(toasts).toHaveLength(1);
    quotaStorage(json.length + 400);
    g.newCity('Replacement', 5, 3, { replaceWithoutCopy: true });
    expect(g.world.cityName).toBe('Replacement');
  });
});

describe('the kept newer city (§3.10)', () => {
  it('a stale-v3 New City over a v4 city leaves it only in .future; the v4 boot offers it, Restore brings it back', async () => {
    // A v4 build saved Neon Bay.
    const m = quotaStorage();
    const v4 = city('Neon Bay', 5);
    expect(v4.save()).toBe(true);
    const neon = m.get(SAVE_KEY)!;
    // A stale v3 build boots on it (blocked, .future), then the player taps New City there.
    expect(bootV3(store(m)).blocked).toBe(true);
    expect(m.get(FUTURE_SAVE_KEY)).toBe(neon);
    const harbor = JSON.stringify({ version: 3, cityName: 'Harbor Nine', seed: 1, tick: 9, tiles: new Array(4096).fill(0), buildings: [], funds: 1, taxRate: 9, maxPopulation: 10, nextBuildingId: 1, news: [], history: [], milestones: [], savedAt: 1 });
    newCityV3(store(m), harbor, null);
    // The v4 build boots: Harbor Nine is the city, Neon Bay is offered back.
    clearUnpackedCache();
    await readStoredSave();
    const g = new Game();
    expect(g.world.cityName).toBe('Harbor Nine');
    expect(g.keptCityInfo()).toMatchObject({ cityName: 'Neon Bay', region: 5 });
    g.world.setRoad(g.world.ownedBox.x0 + 3, g.world.ownedBox.y0 + 3); // progress, so it is worth keeping
    expect(g.restoreKept()).toBe(true);
    expect(g.world.cityName).toBe('Neon Bay');
    expect(JSON.parse(m.get(SAVE_KEY)!).cityName).toBe('Neon Bay');
    expect(m.has(FUTURE_SAVE_KEY)).toBe(false);
    expect(JSON.parse(m.get(PREV_SAVE_KEY)!).cityName).toBe('Harbor Nine');
    expect(g.keptCityInfo()).toBeNull();
  });

  it('a .future this build cannot read is never offered', () => {
    quotaStorage(Infinity, { [FUTURE_SAVE_KEY]: JSON.stringify({ version: 9, cityName: 'Far Future' }) });
    expect(new Game().keptCityInfo()).toBeNull();
    quotaStorage(Infinity, { [FUTURE_SAVE_KEY]: '{oops' });
    expect(new Game().keptCityInfo()).toBeNull();
  });
});

describe('the story pace travels with the city (§3.10)', () => {
  it('saved from Settings; applied on Continue and on Restore previous city', () => {
    const m = quotaStorage();
    const g = city('Paced');
    g.updateSettings({ storyPace: 'brisk' });
    expect(g.save()).toBe(true);
    expect(JSON.parse(m.get(SAVE_KEY)!).story.story.pace).toBe('brisk');
    // Another device (relaxed) continues the city: brisk applies.
    m.set('cybercity.settings.v1', JSON.stringify({ storyPace: 'relaxed' }));
    const g2 = new Game();
    expect(g2.world.cityName).toBe('Paced');
    expect(g2.settings.storyPace).toBe('brisk');
    // Restore previous city applies the restored city's pace.
    g2.updateSettings({ storyPace: 'normal' });
    g2.newCity('Next', 3, 3);
    g2.updateSettings({ storyPace: 'relaxed' });
    expect(g2.loadPrevious()).toBe(true);
    expect(g2.world.cityName).toBe('Paced');
    expect(g2.settings.storyPace).toBe('normal');
  });
});

// ── Review fixes (s0fix): no city is ever only in memory after a failed copy or save (§3.10) ──────────────────

/** A fake localStorage that logs writes and throws for the keys `fail` names (or every key with '*'). */
function failingStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  const fail = new Set<string>();
  const log: string[] = [];
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      log.push(`set ${k}`);
      if (fail.has('*') || fail.has(k)) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      log.push(`remove ${k}`);
      m.delete(k);
    },
  };
  return { m, fail, log };
}
/** Keys whose stored text names `city`. */
const holding = (m: Map<string, string>, city: string) => [...m].filter(([, v]) => v.includes(`"cityName":"${city}"`)).map(([k]) => k);
/** A city with progress, saved, then replaced by a second one (so the first is in `.prev`). */
function twoCities(): { g: Game; s: ReturnType<typeof failingStorage> } {
  const st = failingStorage();
  const g = city('Old Lanthorn');
  g.save();
  g.newCity('Harbor Nine', 22, 3);
  const o = g.world.ownedBox;
  for (let x = o.x0 + 4; x < o.x0 + 24; x++) g.world.setRoad(x, o.y0 + 12, RoadKind.Street);
  g.save();
  return { g, s: st };
}

describe('Restore and the kept city never lose the city they replace (review fixes)', () => {
  it('Restore previous city when .prev cannot take the current city: nothing changes, Export is offered', () => {
    const { g, s } = twoCities();
    expect(JSON.parse(s.m.get(PREV_SAVE_KEY)!).cityName).toBe('Old Lanthorn');
    const main = s.m.get(SAVE_KEY);
    const toasts: { text: string; id?: string }[] = [];
    g.events.on('toast', (t) => toasts.push({ text: t.text, id: t.action?.id }));
    s.fail.add(PREV_SAVE_KEY);
    s.log.length = 0;
    expect(g.loadPrevious()).toBe(false);
    expect(g.world.cityName).toBe('Harbor Nine');
    expect(g.keepCopyFailed).toBe('Harbor Nine');
    expect(toasts).toEqual([{ text: "Couldn't keep a copy of Harbor Nine: storage is full. Export it first.", id: 'export' }]);
    // Both cities are still stored where they were; .prev was never removed.
    expect(s.m.get(SAVE_KEY)).toBe(main);
    expect(JSON.parse(s.m.get(PREV_SAVE_KEY)!).cityName).toBe('Old Lanthorn');
    expect(s.log).not.toContain(`remove ${PREV_SAVE_KEY}`);
    expect(s.log).not.toContain(`set ${SAVE_KEY}`);
    // "Replace without a copy" (the second confirm) goes ahead.
    expect(g.loadPrevious({ replaceWithoutCopy: true })).toBe(true);
    expect(g.world.cityName).toBe('Old Lanthorn');
    expect(JSON.parse(s.m.get(SAVE_KEY)!).cityName).toBe('Old Lanthorn');
  });

  it('a restore whose main save fails puts .prev back exactly (an envelope, still readable) and changes nothing', async () => {
    const { g, s } = twoCities();
    await flushEnvelopes();
    const env = s.m.get(PREV_SAVE_KEY)!;
    expect(parseEnvelope(env)).not.toBeNull();
    const main = s.m.get(SAVE_KEY);
    s.fail.add(SAVE_KEY);
    expect(g.loadPrevious()).toBe(false);
    expect(g.lastSaveFailed).toBe(true);
    expect(g.world.cityName).toBe('Harbor Nine');
    expect(s.m.get(SAVE_KEY)).toBe(main);
    expect(s.m.get(PREV_SAVE_KEY)).toBe(env);
    expect(JSON.parse(readPlain(PREV_SAVE_KEY)!).cityName).toBe('Old Lanthorn');
    // Room again: the same restore now works, and the swap is complete.
    s.fail.clear();
    expect(g.loadPrevious()).toBe(true);
    expect(holding(s.m, 'Old Lanthorn')).toContain(SAVE_KEY);
    expect(JSON.parse(readPlain(PREV_SAVE_KEY)!).cityName).toBe('Harbor Nine');
  });

  it('restoreKept with .prev full: the current city stays stored, the kept one stays in .future', async () => {
    const st = failingStorage();
    const kept = city('Neon Bay');
    const keptJson = JSON.stringify(kept.world.serialize());
    st.m.clear();
    const h = city('Harbor Nine');
    h.save();
    st.m.set(FUTURE_SAVE_KEY, keptJson);
    clearUnpackedCache();
    await readStoredSave();
    const g = new Game();
    expect(g.keptCityInfo()?.cityName).toBe('Neon Bay');
    st.fail.add(PREV_SAVE_KEY);
    expect(g.restoreKept()).toBe(false);
    expect(g.world.cityName).toBe('Harbor Nine');
    expect(g.keepCopyFailed).toBe('Harbor Nine');
    expect(holding(st.m, 'Harbor Nine')).toContain(SAVE_KEY);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(keptJson);
  });

  it('restoreKept removes .future only once the restored city saved (every write failing: nothing changes)', async () => {
    const fixture = (await import('./fixtures/v3-mayor-7-y3.json')).default;
    const st = failingStorage({ [SAVE_KEY]: JSON.stringify(fixture) });
    const kept = new World(4321, 'Neon Bay', undefined, 3);
    kept.setRoad(kept.ownedBox.x0 + 3, kept.ownedBox.y0 + 3);
    const keptJson = JSON.stringify(kept.serialize());
    st.m.set(FUTURE_SAVE_KEY, keptJson);
    const g = new Game();
    expect(g.keptCityInfo()?.cityName).toBe('Neon Bay');
    const playing = g.world.cityName;
    st.fail.add('*');
    expect(g.restoreKept()).toBe(false);
    expect(g.world.cityName).toBe(playing);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(keptJson);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).version).toBe(3);
    // With room, it restores and only then drops .future.
    st.fail.clear();
    expect(g.restoreKept()).toBe(true);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Neon Bay');
    expect(st.m.has(FUTURE_SAVE_KEY)).toBe(false);
  });
});

describe('boot with an envelope in SAVE_KEY that cannot become a plain main (review fixes)', () => {
  it('a corrupt envelope is copied to .unreadable before the fresh city starts', async () => {
    const env = JSON.stringify({ version: 4, region: 3, cityName: 'Corrupt', maxPopulation: 5, savedAt: 1, scale: 10, z: 'AAAAAAAA' });
    const st = failingStorage({ [SAVE_KEY]: env });
    await readStoredSave();
    const g = new Game();
    expect(g.saveBlocked).toBe(false);
    expect(g.world.cityName).not.toBe('Corrupt');
    expect(st.m.get(UNREADABLE_SAVE_KEY)).toBe(env);
  });

  it('a valid envelope whose plain write-back fails still loads (from memory), and the next save stores it plain', async () => {
    const src = city('Packed City');
    const data = src.world.serialize();
    const env = (await packEnvelope(JSON.stringify(data), data))!;
    const st = failingStorage({ [SAVE_KEY]: env });
    clearUnpackedCache();
    st.fail.add(SAVE_KEY);
    await readStoredSave();
    expect(st.m.get(SAVE_KEY)).toBe(env);
    st.fail.clear();
    const g = new Game();
    expect(g.world.cityName).toBe('Packed City');
    expect(g.saveBlocked).toBe(false);
    expect(g.save()).toBe(true);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Packed City');
  });

  it("a newer build's envelope blocks: one that won't unpack is copied raw to .future, one that does is left as stored", async () => {
    const z = (await gzipB64('not a save'))!;
    const bad = JSON.stringify({ version: 5, region: 7, cityName: 'Future City', maxPopulation: 5, savedAt: 1, scale: 10, z: 'not-gzip-' + z.slice(0, 20) });
    const st = failingStorage({ [SAVE_KEY]: bad });
    await readStoredSave();
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(bad);
    expect(g.save()).toBe(false);
    expect(st.m.get(SAVE_KEY)).toBe(bad);
    // One that unpacks: never rewritten as plain text.
    const json = JSON.stringify({ version: 5, region: 3, size: 192, cityName: 'Future City' });
    const env5 = (await packEnvelope(json, { version: 5, region: 3, cityName: 'Future City', maxPopulation: 1, savedAt: 1, scale: 10 }))!;
    const st2 = failingStorage({ [SAVE_KEY]: env5 });
    clearUnpackedCache();
    await readStoredSave();
    expect(st2.m.get(SAVE_KEY)).toBe(env5);
    const g2 = new Game();
    expect(g2.saveBlocked).toBe(true);
    expect(st2.m.get(FUTURE_SAVE_KEY)).toBe(env5);
    expect(st2.m.get(SAVE_KEY)).toBe(env5);
  });
});

describe('a save-blocked session never overwrites the only copy of the newer city (review fixes)', () => {
  const v5 = (tick: number, name = 'Newer City', savedAt = tick) => JSON.stringify({ version: 5, region: 3, size: 192, cityName: name, seed: 7, tick, savedAt });

  it('.future holding an older copy of the same city is refreshed before New City lifts the block', () => {
    const st = failingStorage({ [SAVE_KEY]: v5(90000), [FUTURE_SAVE_KEY]: v5(100), [MIRROR_SAVE_KEY]: v5(90000) });
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    g.newCity('Stand-in', 1, 3);
    expect(g.saveBlocked).toBe(false);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(v5(90000));
    expect(g.world.cityName).toBe('Stand-in');
  });

  it('.future holding another kept city: New City and Restore refuse (Export), Replace without a copy goes ahead', () => {
    const other = v5(500, 'Other Reach');
    const prev = JSON.stringify(new World(3, 'Old Town', undefined, 3).serialize());
    const st = failingStorage({ [SAVE_KEY]: v5(90000), [FUTURE_SAVE_KEY]: other, [PREV_SAVE_KEY]: prev });
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(other); // boot never overwrites another kept city
    g.newCity('Stand-in', 1, 3);
    expect(g.keepCopyFailed).toBe('Newer City');
    expect(g.saveBlocked).toBe(true);
    expect(g.loadPrevious()).toBe(false);
    expect(g.keepCopyFailed).toBe('Newer City');
    expect(st.m.get(SAVE_KEY)).toBe(v5(90000));
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(other);
    g.newCity('Stand-in', 1, 3, { replaceWithoutCopy: true });
    expect(g.saveBlocked).toBe(false);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Stand-in');
  });

  it('a .future copy that fails on quota (at boot and again at New City): New City refuses, the newer city stays', () => {
    const st = failingStorage({ [SAVE_KEY]: v5(90000), [MIRROR_SAVE_KEY]: v5(90000) });
    st.fail.add(FUTURE_SAVE_KEY);
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    expect(st.m.has(FUTURE_SAVE_KEY)).toBe(false);
    g.newCity('Stand-in', 1, 3);
    expect(g.keepCopyFailed).toBe('Newer City');
    expect(st.m.get(SAVE_KEY)).toBe(v5(90000));
    // Room again: the copy is taken first, then the block lifts.
    st.fail.clear();
    g.newCity('Stand-in', 1, 3);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(v5(90000));
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Stand-in');
  });

  it('keepNewerSave never replaces a newer copy of the same city', () => {
    failingStorage({ [SAVE_KEY]: v5(100, 'Newer City', 100), [FUTURE_SAVE_KEY]: v5(900, 'Newer City', 900) });
    expect(keepNewerSave()).toBe('taken');
    failingStorage({ [SAVE_KEY]: v5(900, 'Newer City', 900), [FUTURE_SAVE_KEY]: v5(100, 'Newer City', 100) });
    expect(keepNewerSave()).toBe('kept');
  });
});

describe('the mirror is the last save this build wrote, whatever order envelopes finish in (review fixes)', () => {
  const hdr = (name: string) => ({ version: 4, region: 5, cityName: name, maxPopulation: 1, savedAt: 1, scale: 10 });
  let queue: (() => void)[] = [];
  beforeEach(() => {
    queue = [];
    setIdleScheduler((fn) => void queue.push(fn));
  });
  const drain = async () => {
    while (queue.length) queue.shift()!();
    await flushEnvelopes();
  };
  const mirrorCity = async (m: Map<string, string>) => {
    const raw = m.get(MIRROR_SAVE_KEY);
    if (raw === undefined) return null;
    return JSON.parse(parseEnvelope(raw) ? (await unpackEnvelope(raw))! : raw).cityName as string;
  };

  it("a big city's pending envelope never lands over a newer small city's plain mirror", async () => {
    const st = failingStorage();
    writeMainSave(JSON.stringify({ ...hdr('Big City'), pad: 'x'.repeat(350_000) }), hdr('Big City'));
    writeMainSave(JSON.stringify({ ...hdr('Small City'), pad: 'y' }), hdr('Small City'), { force: true });
    await drain();
    expect(await mirrorCity(st.m)).toBe('Small City');
  });

  it('two forced envelope mirrors: the later save wins even when it finishes first', async () => {
    const st = failingStorage();
    writeMainSave(JSON.stringify({ ...hdr('A'), pad: 'x'.repeat(900_000) }), hdr('A'), { force: true });
    writeMainSave(JSON.stringify({ ...hdr('B'), pad: 'y'.repeat(310_000) }), hdr('B'), { force: true });
    // B's idle callback runs first, then A's: A must not land.
    queue.reverse();
    await drain();
    expect(await mirrorCity(st.m)).toBe('B');
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('B');
  });

  it("a forced envelope mirror removes the previous city's mirror at once; a failed plain mirror leaves none", async () => {
    const st = failingStorage();
    writeMainSave(JSON.stringify({ ...hdr('Small City'), pad: 'y' }), hdr('Small City'));
    expect(await mirrorCity(st.m)).toBe('Small City');
    writeMainSave(JSON.stringify({ ...hdr('Big City'), pad: 'x'.repeat(350_000) }), hdr('Big City'), { force: true });
    expect(st.m.has(MIRROR_SAVE_KEY)).toBe(false);
    await drain();
    expect(await mirrorCity(st.m)).toBe('Big City');
    st.fail.add(MIRROR_SAVE_KEY);
    expect(writeMainSave(JSON.stringify({ ...hdr('Next City'), pad: 'z' }), hdr('Next City')).mirror).toBe('none');
    expect(st.m.has(MIRROR_SAVE_KEY)).toBe(false);
  });

  it('the drop order on a full main save is .stale, .unreadable, .mirror (logged)', () => {
    const json = JSON.stringify({ ...hdr('Quota City'), pad: 'q'.repeat(1000) });
    const st = failingStorage({ [STALE_SAVE_KEY]: 's', [UNREADABLE_SAVE_KEY]: 'u', [MIRROR_SAVE_KEY]: 'm', [PREV_SAVE_KEY]: 'p', [FUTURE_SAVE_KEY]: 'f', [V2_SAVE_KEY]: '2', [V3_SAVE_KEY]: '3' });
    // The main save fits only once all three droppable keys are gone.
    const ls = globalThis.localStorage as { setItem: (k: string, v: string) => void };
    const set = ls.setItem;
    ls.setItem = (k, v) => {
      if (k === SAVE_KEY && [STALE_SAVE_KEY, UNREADABLE_SAVE_KEY, MIRROR_SAVE_KEY].some((d) => st.m.has(d))) throw new Error('QuotaExceededError');
      set(k, v);
    };
    expect(writeMainSave(json, hdr('Quota City')).ok).toBe(true);
    expect(st.log.filter((l) => l.startsWith('remove')).map((l) => l.slice(7))).toEqual([STALE_SAVE_KEY, UNREADABLE_SAVE_KEY, MIRROR_SAVE_KEY]);
    for (const k of [PREV_SAVE_KEY, FUTURE_SAVE_KEY, V2_SAVE_KEY, V3_SAVE_KEY]) expect(st.m.has(k)).toBe(true);
  });
});
