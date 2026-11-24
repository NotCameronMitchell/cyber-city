// Save version 3 and save safety (docs/EXPANSION.md §2.3, §2.5, §2.6, §10.2 #1–#5, #8).

import { afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS, SAVE_KEY, SAVE_VERSION, SAVE_VERSIONS_SUPPORTED, SPACEPORT } from '../src/game/config';
import { FUTURE_SAVE_KEY, FUTURE_SAVE_TEXT, Game, UNREADABLE_SAVE_KEY, V2_SAVE_KEY } from '../src/game/game';
import { Simulation } from '../src/game/sim';
import { MAP_SIZE, RoadKind, Terrain, ZoneType, type SaveData, type WealthTier } from '../src/game/types';
import { World } from '../src/game/world';
import { ScriptedMayor, fullyBuiltWorld, makeSim } from './helpers';

const N = MAP_SIZE;
const { Street: S, Avenue: A, Highway: H, Alley: L, Ramp: R } = RoadKind;

const json = (w: World) => JSON.parse(JSON.stringify(w.serialize())) as SaveData;
const roundTrip = (w: World) => World.deserialize(json(w));

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

/** A small streets-only city with developed lots, as a v1 / v2 build would have saved it. */
function oldCity(): World {
  const w = World.generate(4242, 'Old Harbor');
  const sim = makeSim(w);
  const mayor = new ScriptedMayor(w, sim);
  mayor.opening();
  for (let m = 0; m < 6; m++) {
    for (let d = 0; d < 30; d++) sim.step();
    mayor.turn();
  }
  // A v1 / v2 build had no wealth tiers: waterfront blocks a v3 sim lifts go back to $ (WP-1).
  for (let i = 0; i < N * N; i++) w.setWealth(i % N, (i / N) | 0, 0);
  return w;
}

/** Every expansion structure populated, built with World mutators only. */
function expansionCity(): World {
  const w = new World(31, 'Glass Shore');
  // Water: a bay along the south edge (y ≥ 56) and a channel at x = 40..41.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) if (y >= 56 || x === 40 || x === 41) w.tiles[y * N + x].terrain = Terrain.Water;
  // Ground roads of every kind, and bridges of each kind that may cross water.
  for (let x = 2; x <= 20; x++) w.setRoad(x, 10, S);
  for (let x = 2; x <= 20; x++) w.setRoad(x, 14, A);
  for (let x = 30; x <= 50; x++) w.setRoad(x, 20, H); // crosses the channel: highway bridge
  w.setRoad(35, 19, R);
  w.setRoad(35, 18, S);
  for (let y = 11; y <= 13; y++) w.setRoad(5, y, L);
  for (let x = 36; x <= 45; x++) w.setRoad(x, 30, A); // avenue bridge over the channel
  for (let x = 36; x <= 45; x++) w.setRoad(x, 32, S); // street bridge
  // Zones at every tier.
  for (let x = 6; x <= 15; x++) {
    w.setZone(x, 11, ZoneType.Residential);
    w.setLevel(x, 11, 1 + (x % 3), false, (x % 3) as WealthTier);
    w.setZone(x, 12, ZoneType.Commercial);
    w.setLevel(x, 12, 2, false, ((x + 1) % 3) as WealthTier);
    w.setZone(x, 13, ZoneType.Industrial);
    w.setLevel(x, 13, 3, x === 9, ((x + 2) % 3) as WealthTier);
  }
  w.setZone(16, 11, ZoneType.Residential); // a lot
  // Skyways: a ramp on the street at (10,10) running north to a junction, plus an inactive ramp over open ground.
  w.setSky(10, 10, 1 | 16);
  w.setSky(10, 9, 4 | 1);
  w.setSky(10, 8, 4 | 2 | 8);
  w.setSky(9, 8, 2 | 16); // ramp over plain ground: inactive, but kept
  w.setSky(11, 8, 8);
  // Ports.
  const sea = w.addBuilding('seaport', 20, 52)!;
  sea.facing = 2;
  const sp = w.addBuilding('spaceport', 50, 40)!;
  sp.buildDays = 120;
  sp.waitSec = 77.5;
  sp.launches = 3;
  w.addBuilding('academy', 24, 24);
  w.addBuilding('airport', 2, 30);
  w.moments.add('seaport');
  w.moments.add('launch');
  return w;
}

describe('old saves (§10.2 #1)', () => {
  it('a v2 save loads all-Street, all-$, no skyways, loadedVersion 2, story unchanged', () => {
    const w = oldCity();
    const data = json(w);
    data.version = 2;
    delete data.sky;
    delete data.moments;
    const l = World.deserialize(data);
    expect(l.loadedVersion).toBe(2);
    expect(l.tiles.filter((t) => t.road).length).toBeGreaterThan(20);
    expect(l.tiles.every((t) => t.roadKind === S && t.wealth === 0)).toBe(true);
    expect(l.sky.every((v) => v === 0)).toBe(true);
    expect(l.moments.size).toBe(0);
    expect(l.story).toEqual(w.story);
    expect(l.story.flags.migrated).toBeUndefined();
    // Same city: same simulation results.
    const a = new Simulation(w);
    a.recomputeAll();
    const b = new Simulation(l);
    b.recomputeAll();
    expect(l.stats.population).toBe(w.stats.population);
  });

  it('a v1 save loads all-Street, all-$, loadedVersion 1, with a migrated story', () => {
    const w = oldCity();
    const data = json(w);
    data.version = 1;
    delete data.story;
    delete data.sky;
    delete data.moments;
    const l = World.deserialize(data);
    expect(l.loadedVersion).toBe(1);
    expect(l.tiles.every((t) => t.roadKind === S && t.wealth === 0)).toBe(true);
    expect(l.sky.every((v) => v === 0)).toBe(true);
    expect(l.story.flags.migrated).toBe(true);
  });

  it('a new world reports the current version', () => {
    expect(new World(1).loadedVersion).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(3);
    expect([...SAVE_VERSIONS_SUPPORTED]).toEqual([1, 2, 3]);
  });
});

describe('v3 round trip (§10.2 #2)', () => {
  it('keeps road kinds, bridge kinds, tiers, sky masks and ramps, port fields and moments', () => {
    const w = expansionCity();
    const data = json(w);
    expect(data.version).toBe(3);
    const l = World.deserialize(data);
    expect(l.loadedVersion).toBe(3);
    for (let i = 0; i < N * N; i++) {
      const a = w.tiles[i];
      const b = l.tiles[i];
      expect([b.road, b.roadKind, b.zone, b.level, b.wealth, b.abandoned, b.variant, b.terrain]).toEqual([
        a.road,
        a.roadKind,
        a.zone,
        a.level,
        a.wealth,
        a.abandoned,
        a.variant,
        a.terrain,
      ]);
    }
    expect(l.tileAt(40, 20)!.terrain).toBe(Terrain.Water);
    expect(l.tileAt(40, 20)!.roadKind).toBe(H);
    expect(l.tileAt(40, 30)!.roadKind).toBe(A);
    expect(l.tileAt(40, 32)!.roadKind).toBe(S);
    expect(l.tileAt(13, 13)!.abandoned).toBe(false);
    expect(l.tileAt(9, 13)!.abandoned).toBe(true);
    expect(l.tileAt(9, 13)!.wealth).toBe(w.tileAt(9, 13)!.wealth); // abandonment keeps the tier
    expect(Array.from(l.sky)).toEqual(Array.from(w.sky));
    expect(l.sky[l.idx(9, 8)]).toBe(2 | 16);
    const ports = [...l.buildings.values()];
    expect(ports.find((b) => b.type === 'seaport')!.facing).toBe(2);
    const sp = ports.find((b) => b.type === 'spaceport')!;
    expect([sp.buildDays, sp.waitSec, sp.launches]).toEqual([120, 77.5, 3]);
    expect([...l.moments].sort()).toEqual(['launch', 'seaport']);
    // Saving the loaded world again gives the same data.
    const again = JSON.parse(JSON.stringify(l.serialize())) as SaveData;
    expect(again.tiles).toEqual(data.tiles);
    expect(again.sky).toEqual(data.sky);
    expect(again.buildings).toEqual(data.buildings);
  });

  it('round-trips the tile bits for every road kind × tier (§10.2 #9)', () => {
    for (const k of [S, A, H, L, R])
      for (const tier of [0, 1, 2] as WealthTier[]) {
        const w = new World(5);
        w.setRoad(10, 10, k);
        w.setZone(11, 10, ZoneType.Commercial);
        w.setLevel(11, 10, 3, false, tier);
        const l = roundTrip(w);
        expect(l.tileAt(10, 10)!.roadKind).toBe(k);
        expect(l.tileAt(11, 10)!.wealth).toBe(tier);
        const p = json(w).tiles;
        expect(p.every((v) => v >= 0 && v < 1 << 20)).toBe(true);
        expect((p[w.idx(10, 10)] >> 15) & 7).toBe(k);
        expect((p[w.idx(11, 10)] >> 18) & 3).toBe(tier);
      }
  });
});

describe('corrupt input never throws (§10.2 #3)', () => {
  /** Tile number with explicit fields. */
  const tile = (o: { water?: boolean; road?: boolean; zone?: number; level?: number; kind?: number; tier?: number }) =>
    (o.water ? 1 : 0) | ((o.road ? 1 : 0) << 1) | ((o.zone ?? 0) << 2) | ((o.level ?? 0) << 4) | ((o.kind ?? 0) << 15) | ((o.tier ?? 0) << 18);

  it('sanitises tile bits', () => {
    const data = json(new World(7));
    const at = (x: number, y: number) => y * N + x;
    data.tiles[at(1, 1)] = tile({ road: true, kind: 7 });
    data.tiles[at(2, 1)] = tile({ road: true, kind: 5 });
    data.tiles[at(3, 1)] = tile({ water: true, road: true, kind: L });
    data.tiles[at(4, 1)] = tile({ water: true, road: true, kind: R });
    data.tiles[at(5, 1)] = tile({ water: true, road: true, kind: H });
    data.tiles[at(6, 1)] = tile({ zone: 1, level: 2, tier: 3 });
    data.tiles[at(7, 1)] = tile({ zone: 2, level: 0, tier: 2 });
    data.tiles[at(8, 1)] = tile({ zone: 0, level: 0, tier: 2 });
    data.tiles[at(9, 1)] = tile({ road: false, kind: 2 });
    data.tiles[at(10, 1)] = tile({ road: true, kind: L }) | (1 << 25); // reserved bits ignored
    const l = World.deserialize(data);
    const t = (x: number) => l.tileAt(x, 1)!;
    expect(t(1).roadKind).toBe(S);
    expect(t(2).roadKind).toBe(S);
    expect(t(3).roadKind).toBe(S);
    expect(t(4).roadKind).toBe(S);
    expect(t(5).roadKind).toBe(H); // a highway bridge is fine
    expect(t(6).wealth).toBe(2);
    expect(t(7).wealth).toBe(0);
    expect(t(8).wealth).toBe(0);
    expect(t(9).roadKind).toBe(S);
    expect(t(10).roadKind).toBe(L);
  });

  it('a malformed sky decodes as no skyways', () => {
    const base = json(expansionCity());
    for (const bad of ['x', [0, 4095], [0, 4096, 1], [32, 4096], [0, 4000, 3, 97], [-1, 4096], { 0: 1 }] as unknown[]) {
      const l = World.deserialize({ ...base, sky: bad } as SaveData);
      expect(l.sky.every((v) => v === 0)).toBe(true);
    }
    const missing = { ...base };
    delete missing.sky;
    expect(World.deserialize(missing).sky.every((v) => v === 0)).toBe(true);
  });

  it('sanitises sky links and ramp bits (§2.5)', () => {
    const w = new World(8);
    w.setRoad(20, 20);
    const s = w.sky;
    const i = (x: number, y: number) => w.idx(x, y);
    // One-sided link: (5,5) points east, (6,5) doesn't point back.
    s[i(5, 5)] = 2;
    s[i(6, 5)] = 4;
    s[i(6, 6)] = 1;
    // Off-map link.
    s[i(0, 30)] = 8 | 2;
    s[i(1, 30)] = 8;
    // Ramp bit with two links.
    s[i(20, 21)] = 1 | 4 | 16;
    s[i(20, 22)] = 1;
    s[i(20, 20)] = 4 | 16; // ramp on a street, one link: kept
    // Ramp over a non-road tile: kept (the ground is not checked).
    s[i(30, 30)] = 2 | 16;
    s[i(31, 30)] = 8;
    const l = roundTrip(w);
    const v = (x: number, y: number) => l.sky[l.idx(x, y)];
    expect(v(5, 5)).toBe(0);
    expect(v(6, 5)).toBe(4);
    expect(v(6, 6)).toBe(1);
    expect(v(0, 30)).toBe(2);
    expect(v(1, 30)).toBe(8);
    expect(v(20, 21)).toBe(1 | 4);
    expect(v(20, 20)).toBe(4 | 16);
    expect(v(30, 30)).toBe(2 | 16);
    expect(v(31, 30)).toBe(8);
  });

  it('sanitises port fields and moments', () => {
    const w = new World(9);
    // East shore: x ≥ 30 is water.
    for (let y = 0; y < N; y++) for (let x = 30; x < N; x++) w.tiles[y * N + x].terrain = Terrain.Water;
    const sea = w.addBuilding('seaport', 26, 20)!; // east side x = 30, 31: open water
    const inland = w.addBuilding('seaport', 4, 4)!; // no shore at all
    const plaza = w.addBuilding('plaza', 10, 10)!;
    const sp = w.addBuilding('spaceport', 10, 30)!;
    const data = json(w);
    const rec = (id: number) => data.buildings.find((b) => b.id === id)! as unknown as Record<string, unknown>;
    rec(sea.id).facing = 9;
    rec(inland.id).facing = 'north';
    Object.assign(rec(plaza.id), { facing: 1, waitSec: 5, launches: 2, buildDays: 7, stage: 2 });
    Object.assign(rec(sp.id), { buildDays: 5000, waitSec: -3, launches: 2.5, facing: 0, stage: 3, crown: 'glare' });
    data.moments = ['seaport', 'bogus', 7, 'airport'] as unknown as string[];
    const l = World.deserialize(data);
    expect(l.buildings.get(sea.id)!.facing).toBe(1); // recomputed: S fails, E qualifies
    expect(l.buildings.get(inland.id)!.facing).toBe(2); // no side qualifies → S
    const p = l.buildings.get(plaza.id)!;
    expect([p.facing, p.waitSec, p.launches, p.buildDays, p.stage]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const s = l.buildings.get(sp.id)!;
    expect(s.buildDays).toBe(BUILDINGS.spaceport.buildDays);
    expect(s.waitSec).toBe(0);
    expect(s.launches).toBe(0);
    expect([s.facing, s.stage, s.crown]).toEqual([undefined, undefined, undefined]);
    expect([...l.moments].sort()).toEqual(['airport', 'seaport']);
    // waitSec above the floor clamps to it.
    rec(sp.id).waitSec = 9999;
    rec(sp.id).launches = -1;
    const l2 = World.deserialize(data);
    expect(l2.buildings.get(sp.id)!.waitSec).toBe(SPACEPORT.minBuildSec);
    expect(l2.buildings.get(sp.id)!.launches).toBe(0);
    // moments that are not an array: none.
    expect(World.deserialize({ ...data, moments: 'seaport' } as unknown as SaveData).moments.size).toBe(0);
  });
});

describe('save safety (§2.5, §10.2 #4)', () => {
  it('World.deserialize throws for a v4 save', () => {
    const data = json(new World(1));
    expect(() => World.deserialize({ ...data, version: 4 })).toThrow('Incompatible save');
  });

  it('a newer save is left untouched, copied to .future, and blocks saving until New City', () => {
    const v4 = JSON.stringify({ ...json(World.generate(3, 'Future Reach')), version: 4, novel: [1, 2, 3] });
    const m = memStorage({ [SAVE_KEY]: v4 });
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    expect(m.get(FUTURE_SAVE_KEY)).toBe(v4);
    expect(g.world.cityName).not.toBe('Future Reach');
    const toasts: string[] = [];
    g.events.on('toast', (t) => toasts.push(t.text));
    g.update(0.1);
    expect(toasts).toContain(FUTURE_SAVE_TEXT);
    // Autosaves are harmless.
    expect(g.save()).toBe(false);
    for (let k = 0; k < 20; k++) g.update(0.25);
    expect(g.save()).toBe(false);
    expect(m.get(SAVE_KEY)).toBe(v4);
    expect(g.load()).toBe(false);
    expect(m.get(SAVE_KEY)).toBe(v4);
    // A second stale start keeps the first copy.
    m.set(FUTURE_SAVE_KEY, 'first copy');
    expect(new Game().saveBlocked).toBe(true);
    expect(m.get(FUTURE_SAVE_KEY)).toBe('first copy');
    // Only an explicit New City clears the block.
    g.newCity('Fresh Start');
    expect(g.saveBlocked).toBe(false);
    expect(JSON.parse(m.get(SAVE_KEY)!).version).toBe(3);
    expect(g.save()).toBe(true);
    expect(m.get(FUTURE_SAVE_KEY)).toBe('first copy');
  });

  it('an unreadable save is copied to .unreadable and autosave still works', () => {
    const m = memStorage({ [SAVE_KEY]: '{"version": 2, "tiles": "oops"' });
    const g = new Game();
    expect(g.saveBlocked).toBe(false);
    expect(m.get(UNREADABLE_SAVE_KEY)).toBe('{"version": 2, "tiles": "oops"');
    expect(g.save()).toBe(true);
    // A parseable but invalid save too.
    const bad = JSON.stringify({ version: 2, tiles: [1, 2, 3] });
    m.set(SAVE_KEY, bad);
    new Game();
    expect(m.get(UNREADABLE_SAVE_KEY)).toBe(bad);
  });

  it('the first v2 load writes .v2 once and never overwrites it', () => {
    const w = oldCity();
    const data = json(w);
    data.version = 2;
    delete data.sky;
    delete data.moments;
    const v2 = JSON.stringify(data);
    const m = memStorage({ [SAVE_KEY]: v2 });
    const g = new Game();
    expect(g.world.cityName).toBe('Old Harbor');
    expect(g.world.loadedVersion).toBe(2);
    expect(m.get(V2_SAVE_KEY)).toBe(v2);
    expect(g.save()).toBe(true);
    expect(JSON.parse(m.get(SAVE_KEY)!).version).toBe(3);
    // The v3 save loads without touching the backup; another v2 save never replaces it.
    expect(new Game().world.loadedVersion).toBe(3);
    expect(m.get(V2_SAVE_KEY)).toBe(v2);
    const other = JSON.stringify({ ...data, cityName: 'Other Harbor' });
    m.set(SAVE_KEY, other);
    expect(new Game().world.cityName).toBe('Other Harbor');
    expect(m.get(V2_SAVE_KEY)).toBe(v2);
  });
});

describe('recomputeAll never changes structural tile fields (§2.6, §10.2 #5)', () => {
  it('holds on a city mid-gentrification with every road kind and skyways', () => {
    const w = oldCity();
    const sim = makeSim(w);
    // Gentrify by hand: tiers on developed tiles, streaks mid-way, a few road kinds and a deck.
    let k = 0;
    w.tiles.forEach((t, i) => {
      if (t.zone !== ZoneType.None && t.level > 0) {
        w.setWealth(i % N, (i / N) | 0, (k++ % 3) as WealthTier);
        w.wealthStreak[i] = (k % 5) - 2;
      }
    });
    let r = 0;
    w.tiles.forEach((t, i) => {
      if (t.road && r++ % 4 === 0) w.setRoadKind(i % N, (i / N) | 0, [A, H, L, R][r % 4]);
    });
    w.setSky(30, 30, 2 | 16);
    w.setSky(31, 30, 8);
    const snap = () => w.tiles.map((t) => [t.terrain, t.road, t.roadKind, t.zone, t.level, t.wealth, t.abandoned, t.variant, t.buildingId, t.age].join());
    const before = snap();
    const sky = Array.from(w.sky);
    sim.recomputeAll();
    sim.recomputeAll();
    expect(snap()).toEqual(before);
    expect(Array.from(w.sky)).toEqual(sky);
  });
});

describe('size (§10.2 #8)', () => {
  it('a full v3 city with the expansion structures stays under 64 KB of JSON', () => {
    const w = fullyBuiltWorld(7);
    // Highway ring on the outer grid roads with ramps, every tier, sky over the middle rows, ports.
    for (let x = 0; x < N; x += 1) {
      if (w.tileAt(x, 0)!.road) w.setRoadKind(x, 0, H);
      if (w.tileAt(x, 60)!.road) w.setRoadKind(x, 60, H);
    }
    for (let y = 0; y < N; y += 1) {
      if (w.tileAt(0, y)!.road) w.setRoadKind(0, y, H);
      if (w.tileAt(60, y)!.road) w.setRoadKind(60, y, H);
    }
    for (const x of [8, 16, 24, 32, 40, 48, 56]) w.setRoadKind(x, 1, R);
    let k = 0;
    w.tiles.forEach((t, i) => {
      if (t.zone !== ZoneType.None && t.level > 0) w.setWealth(i % N, (i / N) | 0, (k++ % 3) as WealthTier);
    });
    for (let y = 8; y < 56; y += 8) for (let x = 4; x < 60; x++) w.setSky(x, y, (x > 4 ? 8 : 16) | (x < 59 ? 2 : 0));
    const sp = w.addBuilding('spaceport', 0, 0);
    if (sp) sp.launches = 12;
    w.moments.add('airport');
    const size = JSON.stringify(w.serialize()).length;
    expect(size).toBeLessThan(64 * 1024);
  });
});
