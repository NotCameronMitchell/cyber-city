// Growing a 3×3 city into a 5×5 one, the player's side (docs/MEGACITY.md §3.11 "The player's side", §11.5's WP-9 row):
// Game.growRegion with the frozen upgradeRegion, the confirm copy, the 3×3 copy in `.prev` first (plain, with the
// quota rule), disabled while saveBlocked, the lower-detail default and notice on a handheld device, the camera kept
// (its tile moves by 64, 64), the news line, grants / story / epilogue clock carried on, and field identity with the
// 3×3 run plus a native 5×5's ring 2 (§3.11's tests; save-v4.test.ts covers the transform itself).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../src/game/config';
import { resetDeviceProfile, type DeviceProfile } from '../src/game/device';
import { ringOf, slotRect } from '../src/game/districts/slots';
import { growSlot } from '../src/game/districts/migrate';
import { Game, LOW_DETAIL_TEXT, growNews } from '../src/game/game';
import { FUTURE_SAVE_KEY, PREV_SAVE_KEY, clearUnpackedCache, parseEnvelope, readPlain, resetMirrorClock, setIdleScheduler } from '../src/game/saveStore';
import { Simulation } from '../src/game/sim';
import { RoadKind, type SaveData } from '../src/game/types';
import { World } from '../src/game/world';
import { Camera, tileCenterWorld } from '../src/render/camera';
import { BLOCKED_TEXT, GROW_SHIFT_Y, TRANSFER_COPY, growConfirm, keepViewAfterGrow, lowerDetailHere } from '../src/ui/transfer';
import { cachedMegacity } from './megacity-fixture';

function quotaStorage(quota = Infinity, init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  const writes: { key: string; value: string }[] = [];
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
      writes.push({ key: k, value: String(v) });
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
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A 3×3 city with four built districts (a Game restored from the fixture, saved as the main save). */
function grownUp(name = 'Neon Bay'): Game {
  const w = cachedMegacity(3, 4);
  w.cityName = name;
  w.districts.grants = 2;
  const g = new Game();
  expect(g.restore(clone(w.serialize()))).toBe(true);
  g.save(true);
  return g;
}

describe('the Grow confirm (§3.11), verbatim', () => {
  it('title, body with the Previous city it replaces, the lower-detail line where it applies, Grow', () => {
    expect(growConfirm({ name: 'Neon Bay', prev: 'Old Lanthorn', lowerDetail: false })).toEqual({
      title: 'Grow to 25 districts?',
      body: "Neon Bay gains 16 districts around its edge. Everything you built stays. This can't be undone: the 3×3 copy is kept as Previous city (replacing Old Lanthorn there).",
      confirmLabel: 'Grow',
    });
    expect(growConfirm({ name: 'Neon Bay', prev: null, lowerDetail: false }).body).toBe(
      "Neon Bay gains 16 districts around its edge. Everything you built stays. This can't be undone: the 3×3 copy is kept as Previous city.",
    );
    expect(growConfirm({ name: 'Neon Bay', prev: 'Old Lanthorn', lowerDetail: true }).body.endsWith('(replacing Old Lanthorn there). On this device it runs in lower detail.')).toBe(true);
    // A handheld device runs it in lower detail unless the player turned the switch off.
    expect(lowerDetailHere(undefined, 'handheld')).toBe(true);
    expect(lowerDetailHere(false, 'handheld')).toBe(false);
    expect(lowerDetailHere(undefined, 'pc')).toBe(false);
    expect(TRANSFER_COPY.grow).toBe('Grow to 25 districts');
    expect(TRANSFER_COPY.growing).toBe('Growing the region…');
    expect(BLOCKED_TEXT).toBe('Reload to update first: this device holds a city from a newer version.');
    expect(growNews('Neon Bay')).toBe('Neon Bay now spans a 5×5 region: 16 new districts to annex.');
  });
});

describe('Game.growRegion (§3.11)', () => {
  it('keeps the 3×3 copy in .prev first (plain), then the grown city is the main save; grants, story and clock carry on', () => {
    const st = quotaStorage();
    const g = grownUp();
    const w3 = g.world;
    const before = clone(w3.serialize());
    st.writes.length = 0;
    expect(g.canGrow).toBe(true);
    expect(g.growRegion()).toBe(true);
    const prevAt = st.writes.findIndex((e) => e.key === PREV_SAVE_KEY);
    const mainAt = st.writes.findIndex((e) => e.key === SAVE_KEY);
    expect(prevAt).toBeGreaterThanOrEqual(0);
    expect(prevAt).toBeLessThan(mainAt);
    // Written plain first (swapped for an envelope afterwards, in the idle callback).
    const firstPrev = st.writes[prevAt].value;
    expect(parseEnvelope(firstPrev)).toBeNull();
    const kept = JSON.parse(firstPrev) as SaveData;
    expect([kept.region, kept.size, kept.cityName, kept.tick]).toEqual([3, 192, 'Neon Bay', before.tick]);
    expect(JSON.parse(readPlain(PREV_SAVE_KEY)!).region).toBe(3);
    expect(g.previousSaveInfo()).toMatchObject({ cityName: 'Neon Bay', region: 3 });
    // The grown city.
    const w5 = g.world;
    expect(w5).not.toBe(w3);
    expect([w5.region, w5.N]).toEqual([5, 320]);
    const main = JSON.parse(readPlain(SAVE_KEY)!) as SaveData;
    expect([main.region, main.size]).toEqual([5, 320]);
    expect(w5.districts.owned).toEqual(before.districts!.owned.map(growSlot));
    expect(w5.districts.grants).toBe(2);
    expect(w5.funds).toBe(before.funds);
    expect(w5.tick).toBe(before.tick);
    expect(w5.story.chapter).toBe(w3.story.chapter);
    expect(w5.buildings.size).toBe(w3.buildings.size);
    // One news line.
    expect(w5.news.filter((n) => n.text === growNews('Neon Bay'))).toHaveLength(1);
    expect(w5.news.at(-1)?.text).toBe('Neon Bay now spans a 5×5 region: 16 new districts to annex.');
    // One way: a 5×5 city can't grow.
    expect(g.canGrow).toBe(false);
    expect(g.growRegion()).toBe(false);
    // Restoring Previous city is the way back.
    expect(g.loadPrevious()).toBe(true);
    expect(g.world.region).toBe(3);
    expect(g.world.districts.owned).toEqual(before.districts!.owned);
  }, 30000);

  it('an untouched 3×3 city still keeps its copy (the confirm promises it)', () => {
    const st = quotaStorage();
    const g = new Game();
    g.newCity('Fresh Quay', 99, 3);
    expect(g.hasProgress).toBe(false);
    expect(g.growRegion()).toBe(true);
    expect(JSON.parse(st.m.get(PREV_SAVE_KEY)!).cityName ?? JSON.parse(readPlain(PREV_SAVE_KEY)!).cityName).toBe('Fresh Quay');
    expect(g.world.region).toBe(5);
  }, 30000);

  it('a full storage: nothing changes, the copy is refused with its line; Replace without a copy grows', () => {
    quotaStorage();
    const probe = grownUp();
    const len3 = JSON.stringify(probe.world.serialize()).length;
    const len5 = JSON.stringify(World.deserialize(clone(probe.world.serialize())).serialize()).length;
    // Room for the 3×3 main save and the grown one replacing it, but never for a copy beside it.
    const st = quotaStorage(Math.round(Math.max(len3, len5) * 1.6));
    const g = grownUp();
    const w = g.world;
    const before = st.snapshot();
    expect(g.growRegion()).toBe(false);
    expect(g.swapFailed).toBe('copy');
    expect(g.keepCopyText).toBe("Couldn't keep a copy of Neon Bay: storage is full. Export it first.");
    expect(g.world).toBe(w);
    expect(g.world.region).toBe(3);
    expect(st.snapshot()).toBe(before);
    expect(g.growRegion({ replaceWithoutCopy: true })).toBe(true);
    expect(g.world.region).toBe(5);
    expect(st.m.has(PREV_SAVE_KEY)).toBe(false);
  }, 30000);

  it('disabled while saveBlocked: canGrow is false, nothing is written', () => {
    const newer = JSON.stringify({ version: 9, cityName: 'From Tomorrow', tiles: [] });
    const st = quotaStorage(Infinity, { [SAVE_KEY]: newer });
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    expect(g.world.region).toBe(3);
    expect(g.canGrow).toBe(false);
    const before = st.snapshot();
    expect(g.growRegion()).toBe(false);
    expect(g.world.region).toBe(3);
    expect(st.snapshot()).toBe(before);
    expect(st.m.get(FUTURE_SAVE_KEY)).toBe(newer);
    expect(st.m.has(PREV_SAVE_KEY)).toBe(false);
  });

  it('on a handheld device: lower detail is written once from the class and its notice shows once; a PC stays full detail', () => {
    resetDeviceProfile(HANDHELD);
    quotaStorage();
    const g = grownUp();
    expect(g.settings.lowerDetail).toBeUndefined();
    const toasts: string[] = [];
    g.events.on('toast', (t) => toasts.push(t.text));
    expect(g.growRegion()).toBe(true);
    expect(g.settings.lowerDetail).toBe(true);
    expect(g.lowerDetail).toBe(true);
    g.update(0.016);
    expect(toasts.filter((t) => t === LOW_DETAIL_TEXT)).toHaveLength(1);
    // A PC.
    resetDeviceProfile(PC);
    quotaStorage();
    const p = grownUp('Desk Harbor');
    const t2: string[] = [];
    p.events.on('toast', (t) => t2.push(t.text));
    expect(p.growRegion()).toBe(true);
    expect(p.settings.lowerDetail).toBe(false);
    expect(p.lowerDetail).toBe(false);
    p.update(0.016);
    expect(t2).not.toContain(LOW_DETAIL_TEXT);
  }, 30000);

  it('after an ending the epilogue clock carries on, at the 5×5 cadence', () => {
    quotaStorage();
    const g = grownUp();
    g.world.story.ending = 'pearl';
    g.world.districts.epilogueSec = 123;
    const three = g.epilogueGrantSec();
    expect(g.growRegion()).toBe(true);
    expect(g.world.story.ending).toBe('pearl');
    expect(g.world.districts.epilogueSec).toBe(123);
    expect(g.epilogueGrantSec()).toBeLessThan(three);
  }, 30000);
});

describe('the camera keeps its place (§3.11: its tile moves by 64, 64)', () => {
  it('the tile under the view centre before growing is the same tile, +64 on each axis, after', () => {
    const cam = new Camera(192);
    cam.setViewport(390, 844);
    for (const [tx, ty, zoom] of [
      [96, 96, 1],
      [70, 130, 0.6],
      [150, 80, 1.8],
    ] as const) {
      const c = tileCenterWorld(tx + 0.25, ty + 0.25);
      cam.mapSize = 192;
      cam.easeTo(c.x, c.y, zoom, 0);
      const before = { x: cam.x, y: cam.y, zoom: cam.zoom };
      const t0 = cam.screenToTile(cam.width / 2, cam.height / 2);
      // The world grows: the camera now frames a 320 map; the UI puts the view back.
      cam.setMapSize(320);
      const v = keepViewAfterGrow(before);
      cam.easeTo(v.x, v.y, v.zoom, 0);
      const t1 = cam.screenToTile(cam.width / 2, cam.height / 2);
      expect([t1.x, t1.y]).toEqual([t0.x + 64, t0.y + 64]);
      expect(cam.zoom).toBe(zoom);
      cam.setMapSize(192);
    }
    expect(GROW_SHIFT_Y).toBe(64 * 32);
  });
});

describe('field identity (§3.11): the grown city equals the 3×3 run on its land; ring 2 is the native 5×5 one', () => {
  it('fields and stats through Game.growRegion; a ring-2 annex places the native terrain', () => {
    quotaStorage();
    const g = grownUp();
    const w3 = g.world;
    const sim3 = new Simulation(w3);
    sim3.options.events = false;
    sim3.recomputeAll();
    const snap = (k: keyof typeof w3.fields) => Float64Array.from(w3.fields[k] as ArrayLike<number>);
    const keys = ['landValue', 'pollution', 'crime', 'traffic', 'security', 'health', 'park', 'noise', 'wealth'] as const;
    const f3 = Object.fromEntries(keys.map((k) => [k, snap(k)])) as Record<(typeof keys)[number], Float64Array>;
    const pop3 = w3.stats.population;
    expect(g.growRegion()).toBe(true);
    const w5 = g.world;
    g.sim.options.events = false;
    g.sim.recomputeAll();
    for (const s of w3.districts.owned) {
      const r = slotRect(w3, s);
      for (const k of keys)
        for (let y = r.y0; y <= r.y1; y++)
          for (let x = r.x0; x <= r.x1; x++) {
            const a = f3[k][y * 192 + x];
            const b = w5.fields[k][(y + 64) * 320 + x + 64];
            if (Math.abs(a - b) > 1e-6) throw new Error(`${k} at ${x},${y}: ${a} vs ${b}`);
          }
    }
    expect(w5.stats.population).toBe(pop3);
    const native = World.generate(w5.seed, 'Native', undefined, 5);
    expect(w5.districts.kinds).toEqual(native.districts.kinds);
    const ring2 = [...Array(25).keys()].find((s) => ringOf(5, s) === 2 && !w5.slotOwned[s])!;
    w5.annex(ring2);
    const r = slotRect(w5, ring2);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) expect(w5.tileAt(x, y)!.terrain).toBe(native.tileAt(x, y)!.terrain);
  }, 60000);
});

describe('§11.1 budget: grow = transform ≤ 20 ms + restore ≤ 200 ms in Node (3× CI slack)', () => {
  it('a fully built 3×3 city grows within the budget', () => {
    quotaStorage();
    const w = cachedMegacity(3, 9);
    const g = new Game();
    expect(g.restore(clone(w.serialize()))).toBe(true);
    const t = performance.now();
    expect(g.growRegion()).toBe(true);
    const ms = performance.now() - t;
    console.log(`[grow] 9 districts: ${ms.toFixed(0)} ms (serialize, .prev, transform, deserialize, Simulation, recomputeAll, save)`);
    expect(ms).toBeLessThan(220 * 3);
  }, 60000);
});

void RoadKind;
