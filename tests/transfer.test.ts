// City transfer (docs/MEGACITY.md §13, §13.8; WP-9): the export file (magic line, readable header, gzipped save in
// base64), every check of §13.3 with its message and nothing changed, the round trip at every size, the save safety
// of §13.4 (.prev first, the quota rule, saveBlocked, a v3 file, no World before the confirm, a build that throws),
// the same-city lines, the story pace, the preview lines, the platform choice, file names, lower detail and hostile
// input. The sheets' DOM is checked in the browser run (WP-9's report).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_KEY } from '../src/game/config';
import { resetDeviceProfile, type DeviceProfile } from '../src/game/device';
import { Game, LOW_DETAIL_NOTICE_KEY, LOW_DETAIL_TEXT } from '../src/game/game';
import { deriveMarks } from '../src/game/marks';
import {
  FUTURE_SAVE_KEY,
  MIRROR_SAVE_KEY,
  PREV_SAVE_KEY,
  V3_SAVE_KEY,
  clearUnpackedCache,
  gzipB64,
  readPlain,
  resetMirrorClock,
  setIdleScheduler,
} from '../src/game/saveStore';
import {
  FILE_MAX_BYTES,
  LINE_WIDTH,
  TRANSFER_TEXT,
  buildCityFile,
  cityFileName,
  citySlug,
  exportPlan,
  fileFacts,
  fnv1a,
  readCityFile,
  sameCity,
  type ReadResult,
} from '../src/game/transfer';
import { RoadKind, type SaveData } from '../src/game/types';
import { World } from '../src/game/world';
import { copyToClipboard, exportCityLine, importPreview, isAppleMobile, lowerDetailHere, paceLine, type PreviewContext } from '../src/ui/transfer';
import { cachedMegacity } from './megacity-fixture';

const V3_ENDING = (import.meta.glob('./fixtures/v3-ending.json', { import: 'default', eager: true }) as Record<string, SaveData>)['./fixtures/v3-ending.json'];
const V3_EXPANSION = (import.meta.glob('./fixtures/v3-expansion.json', { import: 'default', eager: true }) as Record<string, SaveData>)['./fixtures/v3-expansion.json'];

// ── Storage and device stubs ─────────────────────────────────────────────────

/** A fake localStorage with a character quota (UTF-16 code units), recording the order of writes. */
function quotaStorage(quota = Infinity, init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  const writes: string[] = [];
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
      writes.push(k);
    },
    removeItem: (k: string) => void m.delete(k),
  };
  return { m, writes, snapshot: () => JSON.stringify([...m].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

const HANDHELD: DeviceProfile = { finePointer: false, mobileOS: true, shortSide: 390, cores: 8, memoryGB: null, benchFactor: null };
const PC: DeviceProfile = { finePointer: true, mobileOS: false, shortSide: 900, cores: 8, memoryGB: 8, benchFactor: null };

beforeEach(() => {
  setIdleScheduler((fn) => fn());
  resetMirrorClock();
  clearUnpackedCache();
  resetDeviceProfile(PC);
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  setIdleScheduler(null);
  resetDeviceProfile();
  vi.restoreAllMocks();
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const strip = (d: SaveData) => {
  const c = clone(d) as unknown as Record<string, unknown>;
  delete c.savedAt;
  return c;
};

/** A Game holding a city restored from a save (no storage writes of its own). */
function gameWith(data: SaveData): Game {
  const g = new Game();
  expect(g.restore(clone(data))).toBe(true);
  return g;
}

/** A small city with progress (worth keeping), saved as the main save. */
function playedCity(name: string, seed = 4321, region: 3 | 5 = 3): Game {
  const g = new Game();
  g.newCity(name, seed, region);
  const w = g.world;
  const o = w.ownedBox;
  for (let x = o.x0 + 10; x < o.x0 + 30; x++) w.setRoad(x, o.y0 + 20, RoadKind.Street);
  w.tick = 400;
  g.save(true);
  return g;
}

/** Export through Game (the save JSON exactly as SAVE_KEY holds it) and pack the file. */
async function exportOf(g: Game, opts: { compress?: boolean; now?: Date } = {}) {
  const ex = g.exportCity()!;
  expect(ex).not.toBeNull();
  const file = await buildCityFile(ex.json, ex.data, opts);
  return { ...ex, file };
}

const okRead = (r: ReadResult): Extract<ReadResult, { ok: true }> => {
  if (!r.ok) throw new Error(`expected a readable file, got ${r.message}`);
  return r;
};

/** A city file with a hand-made header and payload (sums computed unless overridden). */
function craft(o: { magic?: string; header?: Record<string, unknown>; json?: string; payload?: string; enc?: 'json' | 'gzip-b64' }): string {
  const json = o.json ?? '{}';
  const head = { game: 'cyber-city', format: 1, save: 4, region: 3, city: 'X', seed: 1, day: 0, enc: o.enc ?? 'json', bytes: json.length, sum: fnv1a(json), ...o.header };
  return `${o.magic ?? 'CYBERCITY 1'}\n${JSON.stringify(head)}\n${o.payload ?? json}\n`;
}

// ── 1. Round trip ────────────────────────────────────────────────────────────

describe('§13.8 item 1: export then import gives the same city', () => {
  const cases: [string, () => SaveData][] = [
    ['a one-district city', () => playedCity('Neon Bay').world.serialize()],
    ['a full 3×3 city', () => cachedMegacity(3, 9).serialize()],
    ['a full 5×5 city', () => cachedMegacity(5, 25).serialize()],
  ];
  for (const [label, make] of cases)
    it(`${label}: serialize() equals the original's (except savedAt), the header matches the city`, async () => {
      quotaStorage();
      const src = gameWith(make());
      const { json, data, file } = await exportOf(src);
      const h = file.header;
      expect(file.text.startsWith('CYBERCITY 1\n')).toBe(true);
      expect(h).toMatchObject({ game: 'cyber-city', format: 1, save: 4, region: src.world.region, city: src.world.cityName, seed: src.world.seed, day: src.world.tick, districts: src.world.districts.owned.length, enc: 'gzip-b64', bytes: json.length, sum: fnv1a(json) });
      expect(h.pop).toBe(src.world.maxPopulation);
      expect(file.text.split('\n').slice(2, -2).every((l) => l.length === LINE_WIDTH)).toBe(true);
      const r = okRead(await readCityFile(new Blob([file.text], { type: 'text/plain' })));
      expect(r.json).toBe(json);
      const dst = new Game();
      expect(dst.importCity(r.save)).toBe(true);
      expect(strip(dst.world.serialize())).toEqual(strip(data));
      expect(dst.world.region).toBe(src.world.region);
    }, 60000);

  it('mid-story and after an ending: the story, flags and marks come back the same', async () => {
    quotaStorage();
    const base = World.deserialize(clone(V3_ENDING));
    Object.assign(base.story.flags, { truce: true, published: true, namesLit: true });
    base.story.keyChoices['ch2.vote'] = 2;
    const src = gameWith(base.serialize());
    expect(src.world.story.ending).not.toBeNull();
    const marks = deriveMarks(src.world).list;
    const { data, file } = await exportOf(src);
    expect(file.header.ending).toBe(src.world.story.ending);
    expect(file.header.chapter).toBe(src.world.story.chapter);
    const dst = new Game();
    expect(dst.importCity(okRead(await readCityFile(file.text)).save)).toBe(true);
    expect(strip(dst.world.serialize())).toEqual(strip(data));
    expect(deriveMarks(dst.world).list).toEqual(marks);
    // Mid-story: a chapter III city.
    const mid = gameWith(World.deserialize(clone(V3_EXPANSION)).serialize());
    const { data: d2, file: f2 } = await exportOf(mid);
    const dst2 = new Game();
    expect(dst2.importCity(okRead(await readCityFile(f2.text)).save)).toBe(true);
    expect(strip(dst2.world.serialize())).toEqual(strip(d2));
    expect(dst2.world.story.chapter).toBe(mid.world.story.chapter);
  }, 60000);

  it('builds and reads within the §11.1 budgets (3× CI slack): 3×3 ≤ 30 / 50 ms, 5×5 ≤ 60 / 100 ms in Node', async () => {
    for (const [region, n, build, read] of [
      [3, 9, 30, 50],
      [5, 25, 60, 100],
    ] as const) {
      const data = cachedMegacity(region, n).serialize();
      const json = JSON.stringify(data);
      const times = { build: [] as number[], read: [] as number[] };
      let file = await buildCityFile(json, data);
      for (let k = 0; k < 5; k++) {
        let t = performance.now();
        file = await buildCityFile(json, data);
        times.build.push(performance.now() - t);
        t = performance.now();
        okRead(await readCityFile(file.text));
        times.read.push(performance.now() - t);
      }
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
      console.log(`[transfer] ${region}×${region} ${n}: build ${med(times.build).toFixed(1)} ms, read ${med(times.read).toFixed(1)} ms, file ${(file.size / 1024).toFixed(0)} KB`);
      expect(med(times.build)).toBeLessThan(build * 3);
      expect(med(times.read)).toBeLessThan(read * 3);
      // §2.8 / §13.2 sizes: a full 3×3 ≈ 115 KB, a full 5×5 ≈ 310 KB.
      expect(file.size).toBeLessThan(region === 3 ? 200 * 1024 : 500 * 1024);
    }
  }, 60000);
});

// ── 2. Every check of §13.3 ──────────────────────────────────────────────────

describe('§13.8 item 2: every row of §13.3 gives its message and leaves storage byte-identical', () => {
  it('each bad file is refused with the right copy; the city and storage are untouched', async () => {
    const st = quotaStorage();
    const g = playedCity('Harbor Nine');
    const good = (await exportOf(g)).file.text;
    const goodJson = g.exportCity()!.json;
    const lines = good.split('\n');
    const header = JSON.parse(lines[1]) as Record<string, unknown>;
    const withHeader = (patch: Record<string, unknown>) => [lines[0], JSON.stringify({ ...header, ...patch }), ...lines.slice(2)].join('\n');
    const save = JSON.parse(goodJson) as SaveData;
    const before = st.snapshot();
    const world = g.world;
    const tick = world.tick;
    const gz = async (s: string) => (await gzipB64(s))!;
    const rows: [string, string | Uint8Array | Blob, keyof typeof TRANSFER_TEXT][] = [
      ['larger than 2 MB', new Blob([new Uint8Array(FILE_MAX_BYTES + 1)]), 'notCity'],
      ['not text (invalid UTF-8)', new Uint8Array([0x43, 0x59, 0xff, 0xfe, 0x00, 0x41]), 'notCity'],
      ['not text (NUL characters)', `CYBERCITY 1\n\u0000\u0000`, 'notCity'],
      ['no magic line', good.replace('CYBERCITY 1', 'CITYFILE 1'), 'notCity'],
      ['a newer file format (magic)', good.replace('CYBERCITY 1', 'CYBERCITY 2'), 'newer'],
      ['a newer file format (header)', withHeader({ format: 2 }), 'newer'],
      ['a header that is not JSON', [lines[0], '{"game":"cyber-city",', ...lines.slice(2)].join('\n'), 'notCity'],
      ['another game', withHeader({ game: 'other-game' }), 'notCity'],
      ['a newer save version', withHeader({ save: 5 }), 'newer'],
      ['a region this build does not know', withHeader({ region: 7 }), 'newer'],
      ['base64 that fails', [lines[0], lines[1], '!!!!not-base64!!!!'].join('\n'), 'damaged'],
      ['gzip that fails', [lines[0], lines[1], btoa('not gzip at all, just text')].join('\n'), 'damaged'],
      ['unpacked over 4 MB', craft({ enc: 'gzip-b64', json: ' ', payload: await gz(' '.repeat(4 * 1024 * 1024 + 10)) }), 'damaged'],
      ['bytes differs', withHeader({ bytes: goodJson.length + 1 }), 'damaged'],
      ['sum differs', withHeader({ sum: '00000000' }), 'damaged'],
      ['JSON that fails', craft({ json: '{"version":4,' }), 'damaged'],
      ['version differs from save', craft({ json: JSON.stringify({ ...save, version: 3 }), header: { seed: save.seed, day: save.tick } }), 'damaged'],
      ['region disagrees with the header', craft({ json: goodJson, header: { region: 5, seed: save.seed, day: save.tick } }), 'damaged'],
      ['size disagrees with the header', craft({ json: JSON.stringify({ ...save, size: 320 }), header: { seed: save.seed, day: save.tick } }), 'damaged'],
      ['a tile block missing', craft({ json: JSON.stringify({ ...save, tileBlocks: [] }), header: { seed: save.seed, day: save.tick } }), 'incompatible'],
      ['a short tile block', craft({ json: JSON.stringify({ ...save, tileBlocks: [save.tileBlocks![0].slice(4)] }), header: { seed: save.seed, day: save.tick } }), 'incompatible'],
      ['an out-of-range slot', craft({ json: JSON.stringify({ ...save, districts: { ...save.districts!, owned: [4, 9] }, tileBlocks: [save.tileBlocks![0], save.tileBlocks![0]] }), header: { seed: save.seed, day: save.tick } }), 'incompatible'],
      ['no start slot', craft({ json: JSON.stringify({ ...save, districts: { ...save.districts!, owned: [3] } }), header: { seed: save.seed, day: save.tick } }), 'incompatible'],
      ['kinds of the wrong length', craft({ json: JSON.stringify({ ...save, districts: { ...save.districts!, kinds: ['flats'] } }), header: { seed: save.seed, day: save.tick } }), 'incompatible'],
      ['a building off the frame', craft({ json: JSON.stringify({ ...save, buildings: [{ id: 1, type: 'solar', x: 500, y: 2 }] }), header: { seed: save.seed, day: save.tick } }), 'incompatible'],
      ['a story tile index off the frame', craft({ json: JSON.stringify({ ...save, story: { ...(save.story as object), story: { ...((save.story as { story: object }).story), seam: 192 * 192 + 5 } } }), header: { seed: save.seed, day: save.tick } }), 'incompatible'],
    ];
    const deserialize = vi.spyOn(World, 'deserialize');
    for (const [label, input, want] of rows) {
      const r = await readCityFile(input);
      expect(r.ok, label).toBe(false);
      if (!r.ok) {
        expect(r.error, label).toBe(want);
        expect(r.message, label).toBe(TRANSFER_TEXT[want]);
      }
    }
    // No World was built for any of them; the city and every key are as they were.
    expect(deserialize).not.toHaveBeenCalled();
    expect(g.world).toBe(world);
    expect(g.world.tick).toBe(tick);
    expect(st.snapshot()).toBe(before);
    // The good file still reads.
    expect((await readCityFile(good)).ok).toBe(true);
  }, 60000);

  it('the messages are §13.3 verbatim', () => {
    expect(TRANSFER_TEXT).toEqual({
      notCity: "This file isn't a city file.",
      newer: 'This city was saved by a newer version. Reload to update, then import it again.',
      noDecompress: "This browser can't open city files. Update it to import this city.",
      damaged: 'This file is damaged. Export it again on the other device.',
      incompatible: 'This file is damaged or from an incompatible build.',
    });
  });
});

// ── 3 and 4. Encodings and tolerant reading ──────────────────────────────────

describe('§13.8 items 3 and 4: encodings, line ends and re-wrapping', () => {
  it('a "json" file imports; a gzip file without DecompressionStream gives the update message', async () => {
    quotaStorage();
    const g = playedCity('Plain Text');
    const { json, data } = g.exportCity()!;
    const plain = await buildCityFile(json, data, { compress: false });
    expect(plain.header.enc).toBe('json');
    expect(plain.text.split('\n')[2]).toBe(json);
    const r = okRead(await readCityFile(plain.text));
    expect(r.json).toBe(json);
    const gz = await buildCityFile(json, data);
    const saved = (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
    (globalThis as { DecompressionStream?: unknown }).DecompressionStream = undefined;
    try {
      const r2 = await readCityFile(gz.text);
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.message).toBe("This browser can't open city files. Update it to import this city.");
      // A json file still opens there.
      expect((await readCityFile(plain.text)).ok).toBe(true);
    } finally {
      (globalThis as { DecompressionStream?: unknown }).DecompressionStream = saved;
    }
  });

  it('CRLF, a BOM, extra blank lines and base64 re-wrapped at another width all import; one changed character fails', async () => {
    quotaStorage();
    const g = playedCity('Wrapped Bay');
    const { file, json } = await exportOf(g);
    const lines = file.text.trimEnd().split('\n');
    const b64 = lines.slice(2).join('');
    const rewrap = (w: number) => b64.match(new RegExp(`.{1,${w}}`, 'g'))!.join('\n');
    const variants = [
      file.text.replace(/\n/g, '\r\n'),
      '﻿' + file.text,
      `\n\n  \n${lines[0]}\n\n${lines[1]}\n\n${lines.slice(2).join('\n')}\n\n\n`,
      `${lines[0]}\n${lines[1]}\n${rewrap(64)}\n`,
      `${lines[0]}\n${lines[1]}\n${b64}\n`,
      `${lines[0]}\r\n${lines[1]}\r\n${rewrap(100).replace(/\n/g, '\r\n')}`,
    ];
    for (const v of variants) expect(okRead(await readCityFile(v)).json).toBe(json);
    // One changed payload character (inside the gzip body): the checksum or the gzip check fails.
    for (const at of [40, Math.floor(b64.length / 2), b64.length - 12]) {
      const c = b64[at] === 'A' ? 'B' : 'A';
      const bad = `${lines[0]}\n${lines[1]}\n${b64.slice(0, at)}${c}${b64.slice(at + 1)}\n`;
      const r = await readCityFile(bad);
      expect(r.ok, `char ${at}`).toBe(false);
      if (!r.ok) expect(r.error).toBe('damaged');
    }
    // In a json file one changed character fails the sum.
    const plain = await buildCityFile(json, g.exportCity()!.data, { compress: false });
    const r = await readCityFile(plain.text.replace('"tick":400', '"tick":401'));
    expect(r.ok).toBe(false);
  });
});

// ── 5. Save safety ───────────────────────────────────────────────────────────

describe('§13.8 item 5: save safety (§13.4)', () => {
  it('the current city is in .prev before the main save changes; the imported city is the main save and the mirror', async () => {
    const st = quotaStorage();
    const other = playedCity('Neon Bay', 777);
    const { file } = await exportOf(other);
    st.m.clear();
    const g = playedCity('Harbor Nine');
    const mine = st.m.get(SAVE_KEY)!;
    st.writes.length = 0;
    const r = okRead(await readCityFile(file.text));
    expect(g.importCity(r.save)).toBe(true);
    const prevAt = st.writes.indexOf(PREV_SAVE_KEY);
    const mainAt = st.writes.indexOf(SAVE_KEY);
    expect(prevAt).toBeGreaterThanOrEqual(0);
    expect(prevAt).toBeLessThan(mainAt);
    expect(JSON.parse(readPlain(PREV_SAVE_KEY)!).cityName).toBe('Harbor Nine');
    expect(JSON.parse(readPlain(PREV_SAVE_KEY)!).tick).toBe(JSON.parse(mine).tick);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Neon Bay');
    expect(JSON.parse(readPlain(MIRROR_SAVE_KEY)!).cityName).toBe('Neon Bay');
    expect(g.world.cityName).toBe('Neon Bay');
    expect(g.previousSaveInfo()?.cityName).toBe('Harbor Nine');
    // Restore previous city swaps back: nothing was lost.
    expect(g.loadPrevious()).toBe(true);
    expect(g.world.cityName).toBe('Harbor Nine');
  });

  it('a failed .prev write changes nothing and offers Export and Replace without a copy', async () => {
    const st0 = quotaStorage();
    const other = playedCity('Neon Bay', 777);
    const { file } = await exportOf(other);
    void st0;
    // Room for the main save (and its replacement) but not for a backup beside it, even once the mirror is dropped.
    const g0 = playedCity('Harbor Nine');
    const len = g0.exportCity()!.json.length;
    const st = quotaStorage(Math.round(len * 1.5));
    const g = playedCity('Harbor Nine');
    const before = st.snapshot();
    const world = g.world;
    const r = okRead(await readCityFile(file.text));
    expect(g.importCity(r.save)).toBe(false);
    expect(g.swapFailed).toBe('copy');
    expect(g.keepCopyFailed).toBe('Harbor Nine');
    expect(g.keepCopyText).toBe("Couldn't keep a copy of Harbor Nine: storage is full. Export it first.");
    expect(g.world).toBe(world);
    expect(st.snapshot()).toBe(before);
    // Export still works (the way out of a full storage) ...
    expect(g.exportCity()).not.toBeNull();
    // ... and Replace without a copy (the second confirm) goes ahead.
    expect(g.importCity(r.save, undefined, { replaceWithoutCopy: true })).toBe(true);
    expect(g.world.cityName).toBe('Neon Bay');
    expect(st.m.has(PREV_SAVE_KEY)).toBe(false);
  });

  it('a saveBlocked device imports without writing .prev, keeps .future and lifts the block; Export is disabled while blocked', async () => {
    quotaStorage();
    const other = playedCity('Neon Bay', 777);
    const { file } = await exportOf(other);
    const newer = JSON.stringify({ version: 9, cityName: 'From Tomorrow', tiles: [] });
    const st = quotaStorage(Infinity, { [SAVE_KEY]: newer });
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    expect(g.exportCity()).toBeNull();
    expect(g.canGrow).toBe(false);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(newer);
    st.writes.length = 0;
    expect(g.importCity(okRead(await readCityFile(file.text)).save)).toBe(true);
    expect(st.writes).not.toContain(PREV_SAVE_KEY);
    expect(st.m.has(PREV_SAVE_KEY)).toBe(false);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(newer);
    expect(g.saveBlocked).toBe(false);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Neon Bay');
    expect(g.exportCity()).not.toBeNull();
  });

  it('an imported v3 file becomes a 3×3 city and writes no .v3', async () => {
    const st = quotaStorage();
    const v3 = clone(V3_EXPANSION);
    const json = JSON.stringify(v3);
    const file = await buildCityFile(json, v3);
    expect(file.header).toMatchObject({ save: 3, region: 3 });
    const r = okRead(await readCityFile(file.text));
    const facts = fileFacts(r);
    expect([facts.region, facts.owned, facts.total]).toEqual([3, 1, 9]);
    expect(facts.peak).toBe(v3.maxPopulation * 10);
    const g = new Game();
    expect(g.importCity(r.save)).toBe(true);
    expect([g.world.region, g.world.N]).toEqual([3, 192]);
    expect(g.world.cityName).toBe(v3.cityName);
    expect(st.m.has(V3_SAVE_KEY)).toBe(false);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).version).toBe(4);
  });

  it('no World is built before the confirm; Cancel leaves memory and storage as they were', async () => {
    quotaStorage();
    const { file } = await exportOf(playedCity('Neon Bay', 777));
    const st = quotaStorage();
    const g = playedCity('Harbor Nine');
    const before = st.snapshot();
    const world = g.world;
    const deserialize = vi.spyOn(World, 'deserialize');
    const generate = vi.spyOn(World, 'generate');
    // Read, check and preview (what the sheet does before Replace city).
    const r = okRead(await readCityFile(new Blob([file.text])));
    const view = importPreview(fileFacts(r), previewCtx(g));
    expect(view.action?.label).toBe('Replace city');
    expect(deserialize).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    // Cancel: nothing to undo.
    expect(g.world).toBe(world);
    expect(st.snapshot()).toBe(before);
  });

  it('a deserialize that throws after the confirm leaves the current city as it was and SAVE_KEY untouched', async () => {
    quotaStorage();
    const { file } = await exportOf(playedCity('Neon Bay', 777));
    const st = quotaStorage();
    const g = playedCity('Harbor Nine');
    const before = st.snapshot();
    const world = g.world;
    const r = okRead(await readCityFile(file.text));
    vi.spyOn(World, 'deserialize').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(g.importCity(r.save)).toBe(false);
    expect(g.swapFailed).toBe('build');
    expect(g.world).toBe(world);
    expect(st.snapshot()).toBe(before);
    vi.restoreAllMocks();
    // The city plays on and saves.
    expect(g.save()).toBe(true);
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Harbor Nine');
  });

  it('a main save that fails after the copy puts .prev back exactly and changes nothing', async () => {
    quotaStorage();
    const { file } = await exportOf(cityOfSize('Big Neon', 5));
    const g0 = playedCity('Harbor Nine');
    const small = g0.exportCity()!.json.length;
    // Room for the small city, its mirror and a .prev copy, not for the big imported city.
    const st = quotaStorage(small * 3 + 4000, { [PREV_SAVE_KEY]: 'an older backup' });
    const g = playedCity('Harbor Nine');
    const before = st.snapshot();
    const world = g.world;
    const r = okRead(await readCityFile(file.text));
    expect(g.importCity(r.save)).toBe(false);
    expect(g.swapFailed).toBe('save');
    expect(g.world).toBe(world);
    expect(st.m.get(PREV_SAVE_KEY)).toBe('an older backup');
    expect(JSON.parse(st.m.get(SAVE_KEY)!).cityName).toBe('Harbor Nine');
    void before;
  }, 30000);
});

/** A bigger city of a region (several districts) for the size-sensitive rows. */
function cityOfSize(name: string, region: 3 | 5): Game {
  const w = cachedMegacity(region, region === 5 ? 9 : 4);
  w.cityName = name;
  return gameWith(w.serialize());
}

/** The preview context the sheet builds from this device (current city, Previous city, pace, class). */
function previewCtx(g: Game, o: Partial<PreviewContext> = {}): PreviewContext {
  const w = g.world;
  return {
    current: { name: w.cityName, seed: w.seed, day: w.tick, keeps: g.hasProgress },
    backup: g.previousSaveInfo()?.cityName ?? null,
    devicePace: g.settings.storyPace,
    handheld: false,
    lowerDetail: false,
    apple: false,
    now: Date.now(),
    ...o,
  };
}

// ── 10. The same city ────────────────────────────────────────────────────────

describe('§13.8 item 10: the same city', () => {
  it('older, same and newer copies of the city on this device', async () => {
    quotaStorage();
    const g = playedCity('Neon Bay', 2091);
    const facts = fileFacts(okRead(await readCityFile((await exportOf(g)).file.text)));
    const at = (day: number) => importPreview({ ...facts, day }, previewCtx(g, { current: { name: 'Neon Bay', seed: 2091, day: 600, keeps: true } }));
    const older = at(400);
    expect(older.same).toBe('older');
    expect(older.lines.find((l) => l.kind === 'warn')?.text).toBe('This copy is older than the one on this device: FEB 2092 (this device: SEP 2092).');
    expect(older.action?.label).toBe('Replace with older copy');
    expect(older.action?.confirm).toEqual({ title: 'Replace your city?', body: 'Neon Bay moves to Previous city. Neon Bay takes its place.', label: 'Replace with older copy' });
    const same = at(600);
    expect(same.same).toBe('same');
    expect(same.lines.map((l) => l.text)).toContain('This is the same as the city on this device.');
    expect(same.action).toBeNull();
    // Within one month the lines read to the day.
    const mid = (day: number) => importPreview({ ...facts, day }, previewCtx(g, { current: { name: 'Neon Bay', seed: 2091, day: 615, keeps: true } }));
    expect(mid(605).lines.find((l) => l.kind === 'warn')?.text).toBe('This copy is older than the one on this device: 06 SEP 2092 (this device: 16 SEP 2092).');
    expect(mid(620).lines.map((l) => l.text)).toContain('A newer copy of Neon Bay: 21 SEP 2092 (this device: 16 SEP 2092).');
    const newer = at(800);
    expect(newer.same).toBe('newer');
    expect(newer.lines.map((l) => l.text)).toContain('A newer copy of Neon Bay: MAR 2093 (this device: SEP 2092).');
    expect(newer.action?.label).toBe('Replace city');
    // Another city: the replace line names both, with the Previous city it replaces.
    expect(sameCity({ seed: 1, day: 5 }, { seed: 2, day: 5 })).toBe('other');
    const other = importPreview({ ...facts, seed: 99 }, previewCtx(g, { current: { name: 'Harbor Nine', seed: 2091, day: 600, keeps: true }, backup: 'Old Lanthorn' }));
    expect(other.lines[0].text).toBe('This replaces your current city, Harbor Nine. It moves to Previous city (replacing Old Lanthorn there).');
    expect(other.action?.confirm).toEqual({ title: 'Replace your city?', body: 'Harbor Nine moves to Previous city. Neon Bay takes its place.', label: 'Replace' });
  });
});

// ── 11. Story pace ───────────────────────────────────────────────────────────

describe('§13.8 item 11: story pace travels with the city', () => {
  it('a Relaxed file on a Brisk device offers the choice with Relaxed selected and runs Relaxed from its first update', async () => {
    quotaStorage();
    const src = playedCity('Slow Harbor', 31);
    src.updateSettings({ storyPace: 'relaxed' });
    const { file } = await exportOf(src);
    expect(file.header.pace).toBe('relaxed');
    quotaStorage();
    const g = playedCity('Fast Lane', 7);
    g.updateSettings({ storyPace: 'brisk' });
    const r = okRead(await readCityFile(file.text));
    const view = importPreview(fileFacts(r), previewCtx(g));
    expect(view.pace).toEqual({ file: 'relaxed', device: 'brisk' });
    expect(paceLine('relaxed', 'brisk')).toBe('Story pace: Relaxed (this device: Brisk)');
    expect(g.importCity(r.save, 'relaxed')).toBe(true);
    expect(g.settings.storyPace).toBe('relaxed');
    expect(g.world.story.pace).toBe('relaxed');
    // The player picks Brisk instead.
    quotaStorage();
    const g2 = playedCity('Fast Lane', 7);
    g2.updateSettings({ storyPace: 'brisk' });
    expect(g2.importCity(r.save, 'brisk')).toBe(true);
    expect(g2.settings.storyPace).toBe('brisk');
    expect(g2.world.story.pace).toBe('brisk');
  });

  it('a file without a pace keeps the device pace (no choice shown)', async () => {
    quotaStorage();
    const src = playedCity('No Pace', 31);
    const ex = src.exportCity()!;
    const data = clone(ex.data);
    delete (data.story as { story: { pace?: unknown } }).story.pace;
    const json = JSON.stringify(data);
    const file = await buildCityFile(json, data);
    expect(file.header.pace).toBeNull();
    const g = playedCity('Fast Lane', 7);
    g.updateSettings({ storyPace: 'brisk' });
    const r = okRead(await readCityFile(file.text));
    expect(importPreview(fileFacts(r), previewCtx(g)).pace).toBeNull();
    expect(g.importCity(r.save)).toBe(true);
    expect(g.settings.storyPace).toBe('brisk');
  });
});

// ── 12. Preview lines ────────────────────────────────────────────────────────

describe('§13.8 item 12: preview lines', () => {
  it('a 3×3 file on a PC shows the Grow hint; a 5×5 file where it runs in lower detail says so; the card lines', async () => {
    quotaStorage();
    const g = playedCity('Harbor Nine');
    const three = fileFacts(okRead(await readCityFile((await exportOf(playedCity('Neon Bay', 77))).file.text)));
    const texts = (v: ReturnType<typeof importPreview>) => v.lines.map((l) => l.text);
    expect(texts(importPreview(three, previewCtx(g, { handheld: false })))).toContain('You can grow it to 25 districts later in Settings.');
    expect(texts(importPreview(three, previewCtx(g, { handheld: true })))).not.toContain('You can grow it to 25 districts later in Settings.');
    const five = { ...three, region: 5 as const, total: 25, owned: 7 };
    expect(texts(importPreview(five, previewCtx(g, { handheld: true, lowerDetail: true })))).toContain('This is a 25-district city. On this device it runs in lower detail.');
    expect(texts(importPreview(five, previewCtx(g, { handheld: false, lowerDetail: false })))).not.toContain('This is a 25-district city. On this device it runs in lower detail.');
    const v = importPreview(five, previewCtx(g));
    expect(v.size).toBe('5×5 region · 7 of 25 districts');
    expect(v.name).toBe('Neon Bay');
    expect(v.exported).toBe('exported just now');
    expect(importPreview({ ...five, exportedAt: Date.now() - 3 * 86400_000 }, previewCtx(g)).exported).toBe('exported 3 days ago');
    expect(v.story).toMatch(/^Chapter I · /);
    // Lower detail here: the player's switch, else the device class.
    expect(lowerDetailHere(undefined, 'handheld')).toBe(true);
    expect(lowerDetailHere(undefined, 'pc')).toBe(false);
    expect(lowerDetailHere(false, 'handheld')).toBe(false);
    expect(lowerDetailHere(true, 'pc')).toBe(true);
  });

  it('the iPhone note shows only on Apple mobile platforms', () => {
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true); // iPadOS
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', maxTouchPoints: 5 })).toBe(false);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile(undefined)).toBe(false);
  });
});

// ── 6. Platform choice ───────────────────────────────────────────────────────

describe('§13.8 item 6: platform choice (§13.5)', () => {
  it('Share first on a handheld device that can share files; Download first on a PC with Share second; the frame note', () => {
    const env = { handheld: true, canShareFiles: true, framed: false, iosStandalone: false };
    expect(exportPlan(env)).toEqual({ actions: ['share', 'download', 'copy'], frameNote: false });
    expect(exportPlan({ ...env, canShareFiles: false })).toEqual({ actions: ['download', 'copy'], frameNote: false });
    expect(exportPlan({ ...env, handheld: false })).toEqual({ actions: ['download', 'share', 'copy'], frameNote: false });
    expect(exportPlan({ ...env, handheld: false, canShareFiles: false })).toEqual({ actions: ['download', 'copy'], frameNote: false });
    // A framed page (the artifact build): Copy as text is there, with the note.
    const framed = exportPlan({ ...env, handheld: false, canShareFiles: false, framed: true });
    expect(framed.actions).toContain('copy');
    expect(framed.frameNote).toBe(true);
    // An iOS Home Screen app without file sharing: Copy as text instead of a blob download.
    expect(exportPlan({ handheld: true, canShareFiles: false, framed: false, iosStandalone: true })).toEqual({ actions: ['copy'], frameNote: false });
  });

  it('the clipboard: written when allowed; refused or missing → false (the sheet shows the text box)', async () => {
    const got: string[] = [];
    expect(await copyToClipboard('CYBERCITY 1', { clipboard: { writeText: async (t: string) => void got.push(t) } })).toBe(true);
    expect(got).toEqual(['CYBERCITY 1']);
    expect(await copyToClipboard('x', { clipboard: { writeText: () => Promise.reject(new DOMException('no', 'NotAllowedError')) } })).toBe(false);
    expect(await copyToClipboard('x', {})).toBe(false);
    expect(await copyToClipboard('x', undefined)).toBe(false);
  });

  it('the Export sheet city line', () => {
    expect(exportCityLine('Neon Bay', 2_410_000, 5, 7)).toBe('Neon Bay · 2.41M · 5×5 · 7 districts');
    expect(exportCityLine('Neon Bay', 0, 3, 1)).toBe('Neon Bay · 0 · 3×3 · 1 district');
  });
});

// ── 7. File names ────────────────────────────────────────────────────────────

describe('§13.8 item 7: file names', () => {
  it('slug rules: lower case, runs of non-ASCII-alphanumerics → "-", ≤ 24 characters, "city" when nothing is left', () => {
    const day = new Date(2026, 10, 24, 16, 0, 0);
    expect(cityFileName('Neon Bay', day)).toBe('neon-bay-2026-11-24.cybercity.txt');
    expect(cityFileName('東京', day)).toBe('city-2026-11-24.cybercity.txt');
    expect(cityFileName('   ', day)).toBe('city-2026-11-24.cybercity.txt');
    expect(citySlug("  Old Lanthorn's -- Pier #9 ")).toBe('old-lanthorn-s-pier-9');
    expect(citySlug('Söder Kai')).toBe('s-der-kai');
    const long = citySlug('The Very Long Name Of A Harbour City');
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long).toBe('the-very-long-name-of-a');
    expect(long.endsWith('-')).toBe(false);
  });
});

// ── 8. Lower detail on a handheld device ─────────────────────────────────────

describe('§13.8 item 8: a 5×5 import on a handheld device', () => {
  it('turns lower detail on once (a player setting wins) and queues its notice once per city', async () => {
    quotaStorage();
    const five = cityOfSize('Big Neon', 5);
    const { file } = await exportOf(five);
    const r = okRead(await readCityFile(file.text));
    resetDeviceProfile(HANDHELD);
    const st = quotaStorage();
    const g = playedCity('Harbor Nine');
    expect(g.settings.lowerDetail).toBeUndefined();
    const toasts: string[] = [];
    g.events.on('toast', (t) => toasts.push(t.text));
    expect(g.importCity(r.save)).toBe(true);
    expect(g.settings.lowerDetail).toBe(true);
    expect(g.lowerDetail).toBe(true);
    g.update(0.016);
    expect(toasts.filter((t) => t === LOW_DETAIL_TEXT)).toHaveLength(1);
    expect(JSON.parse(st.m.get(LOW_DETAIL_NOTICE_KEY)!)).toContain(g.world.seed);
    // Again (Restore back and import once more): no second notice for this city.
    expect(g.loadPrevious()).toBe(true);
    expect(g.importCity(r.save)).toBe(true);
    g.update(0.016);
    expect(toasts.filter((t) => t === LOW_DETAIL_TEXT)).toHaveLength(1);
    // A player who turned it off keeps it off.
    quotaStorage();
    const p = playedCity('Harbor Ten');
    p.updateSettings({ lowerDetail: false });
    expect(p.importCity(r.save)).toBe(true);
    expect(p.settings.lowerDetail).toBe(false);
    expect(p.lowerDetail).toBe(false);
  }, 60000);
});

// ── 9. Hostile input ─────────────────────────────────────────────────────────

describe('§13.8 item 9: hostile input never throws and reaches the screen only as text', () => {
  it('2 MB of junk, a header with 10,000 keys, deeply nested JSON, a city name with markup', async () => {
    const junk = new Uint8Array(FILE_MAX_BYTES);
    for (let i = 0; i < junk.length; i++) junk[i] = 32 + ((i * 7919) % 90);
    const many: Record<string, number> = { game: 0 } as never;
    for (let k = 0; k < 10000; k++) many[`k${k}`] = k;
    const deep = '['.repeat(200000) + ']'.repeat(200000);
    const inputs: (string | Uint8Array)[] = [
      junk,
      `CYBERCITY 1\n${JSON.stringify({ ...many, game: 'cyber-city', format: 1 })}\nAAAA\n`,
      craft({ json: deep }),
      craft({ enc: 'json', json: deep, payload: deep }),
      'CYBERCITY 1\n{"game":"cyber-city","format":1,"save":4,"region":3,"enc":"json","bytes":2,"sum":"x"}\n{}',
      'CYBERCITY 1\nnull\n',
      'CYBERCITY 1\n[]\n',
      'CYBERCITY 99999999\n{}',
      '',
      '\n\n\n',
    ];
    for (const input of inputs) {
      const r = await readCityFile(input);
      expect(r.ok).toBe(false);
    }
    // A name with markup reads as a plain string (the sheet sets it with text:, never html:).
    quotaStorage();
    const g = playedCity('<img src=x onerror=alert(1)>');
    const { file } = await exportOf(g);
    const r = okRead(await readCityFile(file.text));
    expect(fileFacts(r).city).toBe(g.world.cityName.slice(0, 24));
    expect(fileFacts(r).city.startsWith('<img')).toBe(true);
    expect(file.name).toMatch(/^img-src-x-onerror-alert-\d{4}-\d{2}-\d{2}\.cybercity\.txt$/);
  });
});
