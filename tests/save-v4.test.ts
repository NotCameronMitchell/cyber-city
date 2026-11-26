// Save version 4, migration and growing a region (docs/MEGACITY.md §3.10, §3.11, §11.2 items 1, 3, 4, 5, 16).

import { afterEach, describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../src/game/config';
import { BLOCK_CHARS, decodeBlock, encodeBlock, growSlot, isFutureSave, reframe, upgradeRegion, upgradeSave, validateSaveShape } from '../src/game/districts/migrate';
import { REGION5_QUOTA } from '../src/game/districts/layout';
import { artOffset, ringOf, slotRect } from '../src/game/districts/slots';
import { decodeRle } from '../src/game/story/encode';
import { FUTURE_SAVE_KEY, Game, PREV_SAVE_KEY, V2_SAVE_KEY, V3_SAVE_KEY } from '../src/game/game';
import { districtName } from '../src/game/news';
import { Simulation } from '../src/game/sim';
import { Ground, LEGACY_REGION, RoadKind, Terrain, ZoneType, startSlot, type Region, type SaveData } from '../src/game/types';
import { World } from '../src/game/world';
import { toV3 } from './legacy-save';

const FIXTURES = import.meta.glob(['./fixtures/v3-*.json', '!./fixtures/v3-baseline.json'], { import: 'default', eager: true }) as Record<string, SaveData>;
const fixture = (name: string) => JSON.parse(JSON.stringify(FIXTURES[`./fixtures/${name}.json`])) as SaveData;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
  return m;
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** Own a slot structurally (Step 0b places no annex content). */
function own(w: World, ...slots: number[]) {
  for (const s of slots) w.annex(s);
}

describe('v1–v3 saves migrate to a 3×3 region (§3.10, §11.2 item 1)', () => {
  for (const name of Object.keys(FIXTURES).map((k) => k.slice(11, -5)))
    it(`${name}: the start slot holds the old map bit for bit; everything spatial moves by (64, 64)`, () => {
      const v3 = fixture(name);
      const v4 = upgradeSave(clone(v3));
      expect([v4.version, v4.region, v4.size, v4.scale]).toEqual([4, 3, 192, 10]);
      expect(v4.tiles).toBeUndefined();
      expect(v4.districts!.owned).toEqual([4]);
      expect(v4.districts!.annexedAt).toHaveLength(9);
      expect(v4.districts!.annexedAt[4]).toBe(v3.tick);
      expect(v4.districts!.bought).toBe(0);
      const vals = new Int32Array(4096);
      expect(decodeBlock(v4.tileBlocks![0], vals)).toBe(true);
      expect(Array.from(vals)).toEqual(v3.tiles!.map((t) => t & 0xfffff));
      v3.buildings.forEach((b, k) => expect([v4.buildings[k].x, v4.buildings[k].y]).toEqual([b.x + 64, b.y + 64]));
      // Sky, turf and rail at the offset.
      const at = (rle: unknown, side: number) => {
        const a = new Uint16Array(side * side);
        expect(decodeRle(rle, a, 0xffff)).toBe(true);
        return a;
      };
      for (const [a, b] of [
        [v3.sky, v4.sky],
        [v3.story?.turf, v4.story?.turf],
        [v3.story?.rail, v4.story?.rail],
      ] as [unknown, unknown][]) {
        if (a === undefined) continue;
        const old = at(a, 64);
        const neu = at(b, 192);
        let moved = 0;
        for (let i = 0; i < 4096; i++) {
          const j = ((i >> 6) + 64) * 192 + (i & 63) + 64;
          expect(neu[j]).toBe(old[i]);
          moved += old[i];
        }
        expect(neu.reduce((s, v) => s + v, 0)).toBe(moved);
      }
      const st3 = v3.story?.story;
      const st4 = v4.story?.story;
      const re = (i: number | null | undefined) => (i === null || i === undefined || i < 0 ? i : ((i >> 6) + 64) * 192 + (i & 63) + 64);
      if (st3 && st4) {
        expect(st4.seam).toBe(re(st3.seam));
        expect(st4.pending?.spot ?? null).toBe(st3.pending ? re(st3.pending.spot) : null);
        expect(st4.railOut.map((r) => r.i)).toEqual(st3.railOut.map((r) => re(r.i)));
        expect(st4.locals.map((l) => [l.x, l.y])).toEqual(st3.locals.map((l) => [l.x + 64, l.y + 64]));
        expect(st4.crackdowns.map((c) => [c.x, c.y])).toEqual(st3.crackdowns.map((c) => [c.x + 64, c.y + 64]));
        expect(v4.story!.links.map((l) => [l.ax, l.ay, l.bx, l.by])).toEqual(v3.story!.links.map((l) => [l.ax + 64, l.ay + 64, l.bx + 64, l.by + 64]));
      }
      // ×10 head counts (a v3 save has no scale), grants owed, the ending history.
      expect(v4.maxPopulation).toBe(v3.maxPopulation * 10);
      expect(v4.milestones).toEqual(v3.milestones.map((p) => p * 10));
      const chapter = st3?.chapter ?? 1;
      expect(v4.districts!.grants).toBe(Math.min(5, chapter - 1) + (st3?.ending ? 1 : 0));
      if (st3?.ending) {
        expect(st4!.endingHistory).toEqual([{ id: st3.ending, variant: st3.endingVariant, from: st3.endingTick, to: null }]);
        expect(v4.districts!.epilogueSec).toBe(0);
      }
      // And it loads: a 3×3 world, loadedVersion 3, the same tiles in the start slot.
      const w = World.deserialize(clone(v3));
      expect([w.region, w.N, w.loadedVersion]).toEqual([3, 192, 3]);
      for (let i = 0; i < 4096; i++) {
        const t = w.tiles[((i >> 6) + 64) * 192 + (i & 63) + 64];
        expect(t.terrain).toBe(v3.tiles![i] & 1);
        expect(t.variant).toBe((v3.tiles![i] >> 7) & 255);
      }
    });

  it('grants owed: a Ch3 save gets 2, a post-ending save 6 with its ending history', () => {
    const w = World.generate(91, 'Grants', undefined, LEGACY_REGION);
    w.story.chapter = 3;
    const ch3 = upgradeSave(toV3(clone(w.serialize())));
    expect(ch3.districts!.grants).toBe(2);
    w.story.chapter = 7;
    w.story.ending = 'ledger';
    w.story.endingTick = 1234;
    const ended = upgradeSave(toV3(clone(w.serialize())));
    expect(ended.districts!.grants).toBe(6);
    expect(ended.story!.story.endingHistory).toEqual([{ id: 'ledger', variant: null, from: 1234, to: null }]);
    expect(World.deserialize(ended).districts.epilogueSec).toBe(0);
  });

  it('.v2 for a v1 / v2 save and .v3 for a v3 save, each written once and never overwritten; loadedVersion kept', () => {
    const v3 = JSON.stringify(fixture('v3-expansion'));
    const m = memStorage({ [SAVE_KEY]: v3 });
    const g = new Game();
    expect(g.world.loadedVersion).toBe(3);
    expect(m.get(V3_SAVE_KEY)).toBe(v3);
    expect(m.get(V2_SAVE_KEY)).toBeUndefined();
    expect(g.save()).toBe(true);
    expect(JSON.parse(m.get(SAVE_KEY)!).version).toBe(4);
    const other = JSON.stringify({ ...JSON.parse(v3), cityName: 'Other' });
    m.set(SAVE_KEY, other);
    m.delete('cybercity.save.v1.mirror');
    new Game();
    expect(m.get(V3_SAVE_KEY)).toBe(v3);
    const v2 = JSON.stringify(toV3(clone(new World(3, 'Two', undefined, LEGACY_REGION).serialize()), 2));
    const m2 = memStorage({ [SAVE_KEY]: v2 });
    expect(new Game().world.loadedVersion).toBe(2);
    expect(m2.get(V2_SAVE_KEY)).toBe(v2);
    expect(m2.get(V3_SAVE_KEY)).toBeUndefined();
  });
});

/** A city on a region with two annexed slots, every v4 field set to something non-default. */
function richCity(region: Region): World {
  const w = World.generate(4242, 'Rich', undefined, region);
  const s0 = startSlot(region);
  const east = s0 + 1;
  const south = s0 + region;
  own(w, east, south);
  w.funds = 1e7;
  const r = slotRect(w, s0);
  const e = slotRect(w, east);
  for (let x = r.x0 + 4; x <= e.x0 + 20; x++) if (w.tileAt(x, r.y0 + 20)!.terrain === Terrain.Land) w.setRoad(x, r.y0 + 20, RoadKind.Avenue);
  for (let x = r.x0 + 6; x < r.x0 + 14; x++) {
    w.setZone(x, r.y0 + 21, ZoneType.Residential);
    w.setLevel(x, r.y0 + 21, 2, false, 1);
  }
  // Elev and ground on land, both 0 on water.
  for (let k = 0; k < 40; k++) {
    const x = e.x0 + (k % 8);
    const y = e.y0 + 30 + ((k / 8) | 0);
    if (w.tileAt(x, y)!.terrain === Terrain.Land) {
      w.tiles[w.idx(x, y)].elev = k % 4;
      w.setGround(x, y, (k % 4) as Ground);
    }
  }
  const spire = w.addBuilding('spire', r.x0 + 30, r.y0 + 30);
  if (spire) {
    spire.sponsor = 'basalt';
    spire.look = 2;
  }
  const d = w.districts;
  d.grants = 3;
  d.bought = 1;
  d.epilogueSec = 321.5;
  d.goalsDone = [`shoals.residents@${east}`];
  d.ruinsRestored = 7;
  if (d.kinds[east] === 'tarmac' || d.kinds[south] === 'tarmac') d.leases = { tarmac: 'basalt' };
  w.story.endingHistory = [{ id: 'quiet', variant: 'lamplight', from: 10, to: 20 }];
  w.story.callbacks = ['review.a', 'review.b'];
  w.story.pace = 'normal';
  w.story.seam = w.idx(r.x0 + 10, r.y0 + 10);
  return w;
}

describe.each([3, 5] as Region[])('v4 round trip on a %i×%i region (§11.2 item 3)', (region) => {
  it('keeps the region, districts, tile bits, building and story fields; locked slots regenerate identically', () => {
    const w = richCity(region);
    const data = clone(w.serialize());
    expect([data.version, data.region, data.size]).toEqual([4, region, 64 * region]);
    expect(data.tiles).toBeUndefined();
    expect(data.tileBlocks).toHaveLength(3);
    for (const b of data.tileBlocks!) expect(b).toHaveLength(BLOCK_CHARS);
    const l = World.deserialize(clone(data));
    expect(l.region).toBe(region);
    expect(l.districts).toEqual(w.districts);
    expect(l.districts.owned).toEqual(w.districts.owned);
    expect(Array.from(l.slotOwned)).toEqual(Array.from(w.slotOwned));
    expect(l.ownedBox).toEqual(w.ownedBox);
    for (let i = 0; i < w.area; i++) {
      const a = w.tiles[i];
      const b = l.tiles[i];
      if (a.terrain !== b.terrain || a.elev !== b.elev || a.ground !== b.ground || a.variant !== b.variant || a.zone !== b.zone || a.road !== b.road)
        throw new Error(`tile ${i} differs`);
    }
    const sp = [...l.buildings.values()].find((b) => b.type === 'spire');
    if (sp) expect([sp.sponsor, sp.look]).toEqual(['basalt', 2]);
    expect(l.story.endingHistory).toEqual(w.story.endingHistory);
    expect(l.story.callbacks).toEqual(w.story.callbacks);
    expect(l.story.pace).toBe('normal');
    expect(l.story.seam).toBe(w.story.seam);
    // Saving again gives the same data.
    const again = clone(l.serialize());
    expect({ ...again, savedAt: 0 }).toEqual({ ...data, savedAt: 0 });
  });
});

describe('corrupt v4 input (§11.2 item 4)', () => {
  const base = () => clone(richCity(3).serialize());
  it('a bad block, a count mismatch, duplicate or out-of-range slots or no start slot are "Incompatible save"', () => {
    const bad: ((d: SaveData) => void)[] = [
      (d) => (d.tileBlocks![1] = d.tileBlocks![1].slice(1)),
      (d) => (d.tileBlocks![0] = '!'.repeat(BLOCK_CHARS)),
      (d) => d.tileBlocks!.pop(),
      (d) => (d.districts!.owned[1] = d.districts!.owned[0]),
      (d) => (d.districts!.owned[1] = 9),
      (d) => (d.districts!.owned[0] = 0),
    ];
    for (const f of bad) {
      const d = base();
      f(d);
      expect(() => World.deserialize(d)).toThrow('Incompatible save');
    }
  });
  it('wrong kinds → the seed layout; negative grants → 0; elev / ground on water → 0; a lease on the wrong district dropped', () => {
    const w = richCity(3);
    const d = clone(w.serialize());
    d.districts!.kinds = ['shore'] as never;
    d.districts!.grants = -4;
    d.districts!.leases = { tarmac: 'nacre' };
    // A water tile with elev 3 and ground Reed bits in the start slot's block.
    const vals = new Int32Array(4096);
    decodeBlock(d.tileBlocks![0], vals);
    vals[0] = 1 | (3 << 20) | (1 << 22);
    d.tileBlocks![0] = encodeBlock(vals);
    const l = World.deserialize(d);
    expect(l.districts.kinds).toEqual(new World(4242, 'x', undefined, 3).districts.kinds);
    expect(l.districts.grants).toBe(0);
    const t = l.tileAt(64, 64)!;
    expect([t.terrain, t.elev, t.ground]).toEqual([Terrain.Water, 0, Ground.Plain]);
    const tarmac0 = l.districts.owned.some((s) => l.districts.kinds[s] === 'tarmac' && l.variantOf(s) === 0);
    expect(l.districts.leases?.tarmac).toBe(tarmac0 ? 'nacre' : undefined);
    // Nothing stands on locked land.
    const e = clone(w.serialize());
    e.buildings.push({ id: 999, type: 'plaza', x: 2, y: 2, size: 1, builtTick: 0, offline: 0, powered: false });
    expect(World.deserialize(e).buildings.has(999)).toBe(false);
  });
});

describe('future saves (§3.10, §11.2 item 5)', () => {
  it('v5, or v4 with a region other than 3 / 5 or a size not 64 × region, is a future save; a v4 is never migrated', () => {
    const d = clone(richCity(3).serialize());
    expect(isFutureSave(d)).toBe(false);
    expect(isFutureSave({ ...d, version: 5 })).toBe(true);
    expect(isFutureSave({ ...d, region: 4, size: 256 })).toBe(true);
    expect(isFutureSave({ ...d, size: 320 })).toBe(true);
    expect(isFutureSave({ ...d, region: undefined })).toBe(false); // missing region reads as 3 with size 192
    expect(isFutureSave({ ...d, region: undefined, size: 320 })).toBe(true);
    expect(isFutureSave({ ...d, region: 1, size: 64 })).toBe(true); // the legacy test frame is never a game save
    expect(upgradeSave(d)).toBe(d);
    for (const v of [{ ...d, version: 5 }, { ...d, region: 4, size: 256 }]) {
      const raw = JSON.stringify(v);
      const m = memStorage({ [SAVE_KEY]: raw });
      const g = new Game();
      expect(g.saveBlocked).toBe(true);
      expect(g.save()).toBe(false);
      expect(m.get(SAVE_KEY)).toBe(raw);
      expect(m.get(FUTURE_SAVE_KEY)).toBe(raw);
    }
  });
  it('a dev save with scale 10 is not multiplied again; previousSaveInfo shows ×10 numbers and region 3 for a v3 backup', () => {
    const d = clone(richCity(3).serialize());
    d.maxPopulation = 12345;
    expect(World.deserialize(d).maxPopulation).toBe(12345);
    const v3 = fixture('v3-expansion');
    memStorage({ [PREV_SAVE_KEY]: JSON.stringify(v3) });
    expect(new Game().previousSaveInfo()).toMatchObject({ maxPopulation: v3.maxPopulation * 10, region: 3, cityName: v3.cityName });
  });
  it('validateSaveShape takes the legacy frame only when asked', () => {
    const l = clone(new World(1, 'L', undefined, LEGACY_REGION).serialize());
    expect(() => validateSaveShape(l)).toThrow('Incompatible save');
    expect(validateSaveShape(l, { allowLegacy: true })).toEqual({ region: 1, size: 64 });
  });
});

describe('growing a 3×3 city into a 5×5 one (§3.11, §11.2 item 16)', () => {
  it('upgradeRegion is pure and leaves a 5×5 (or an old) save unchanged', () => {
    const five = clone(richCity(5).serialize());
    expect(upgradeRegion(five)).toBe(five);
    const v3 = fixture('v3-expansion');
    expect(upgradeRegion(v3)).toBe(v3);
    const three = clone(richCity(3).serialize());
    const frozen = JSON.stringify(three);
    const grown = upgradeRegion(three);
    expect(JSON.stringify(three)).toBe(frozen);
    expect([grown.region, grown.size]).toEqual([5, 320]);
    expect(grown.tileBlocks).toEqual(three.tileBlocks);
    expect(grown.districts!.owned).toEqual(three.districts!.owned.map(growSlot));
    expect(grown.districts!.goalsDone).toEqual(three.districts!.goalsDone!.map((g) => g.replace(/@(\d+)$/, (_, s) => `@${growSlot(Number(s))}`)));
    expect(grown.districts!.annexedAt).toHaveLength(25);
    for (let s = 0; s < 9; s++) expect(grown.districts!.annexedAt[growSlot(s)]).toBe(three.districts!.annexedAt[s]);
    // The 5×5 quotas, ring 1 kept, ring 2 the native 5×5 layout of the seed.
    const kinds = grown.districts!.kinds;
    const count: Record<string, number> = {};
    kinds.forEach((k, s) => s !== 12 && (count[k] = (count[k] ?? 0) + 1));
    expect(count).toEqual({ ...REGION5_QUOTA });
    for (let s = 0; s < 9; s++) expect(kinds[growSlot(s)]).toBe(three.districts!.kinds[s]);
    expect(kinds).toEqual(new World(4242, 'Native', undefined, 5).districts.kinds);
    expect(reframe(three, 192, 320, 64).buildings.map((b) => b.x)).toEqual(grown.buildings.map((b) => b.x));
  });

  it('the grown city loads and plays as a 5×5 city with identical fields on its land; art hashes and ring 2 match a native 5×5', () => {
    const w3 = richCity(3);
    const sim3 = new Simulation(w3);
    sim3.options.events = false;
    sim3.recomputeAll();
    const grown = upgradeRegion(clone(w3.serialize()));
    const w5 = World.deserialize(grown);
    const sim5 = new Simulation(w5);
    sim5.options.events = false;
    sim5.recomputeAll();
    expect([w5.region, w5.N]).toEqual([5, 320]);
    // Every field on the 3×3 frame (owned and the ring-1 locked land) equals the grown one at +64.
    const keys = ['landValue', 'pollution', 'crime', 'traffic', 'security', 'health', 'park', 'noise', 'wealth'] as const;
    for (const k of keys)
      for (let y = 0; y < 192; y++)
        for (let x = 0; x < 192; x++) {
          const a = w3.fields[k][y * 192 + x];
          const b = w5.fields[k][(y + 64) * 320 + x + 64];
          if (Math.abs(a - b) > 1e-6) throw new Error(`${k} at ${x},${y}: ${a} vs ${b}`);
        }
    expect(w5.stats.population).toBe(w3.stats.population);
    // Art coordinates: names and the start slot look the same.
    for (const [x, y] of [
      [70, 70],
      [100, 90],
    ])
      expect(districtName(x + 64, y + 64, w5.seed, artOffset(w5))).toBe(districtName(x, y, w3.seed, artOffset(w3)));
    // Annexing a ring-2 slot places the terrain a native 5×5 city of the seed has there.
    const native = World.generate(4242, 'Native', undefined, 5);
    const ring2 = [...Array(25).keys()].find((s) => ringOf(5, s) === 2)!;
    w5.annex(ring2);
    const r = slotRect(w5, ring2);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) expect(w5.tileAt(x, y)!.terrain).toBe(native.tileAt(x, y)!.terrain);
    // And it plays.
    for (let d = 0; d < 30; d++) sim5.step();
    expect(w5.tick).toBe(w3.tick + 30);
    // The round trip keeps every v4 field.
    const back = World.deserialize(clone(w5.serialize()));
    expect(back.districts).toEqual(w5.districts);
  }, 60000);
});
