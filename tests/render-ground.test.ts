// WP-3 render smoke tests (docs/EXPANSION.md §3.7, §3.11, §5, §7.3, §7.5) against the strict
// canvas mock (tests/canvas-mock.ts): every road kind, bridges per kind, ramps, alleys, skyway
// decks (flat, slopes, ramps, closed ramps, junctions, docks), regional stubs, port aprons and
// the academy courtyard paint into the chunked ground cache at far / mid / near zoom, by day and
// by night, with no throw and no bad number; the skyway layer, overlays, previews and street
// traffic draw cleanly too.

import { beforeAll, describe, expect, it } from 'vitest';
import { RoadKind, Terrain, ZoneType } from '../src/game/types';
import type { World as WorldT } from '../src/game/world';
import { installCanvasMock, mockContext, mockStats, resetMockStats } from './canvas-mock';

installCanvasMock();

type Mods = {
  World: typeof import('../src/game/world').World;
  Game: typeof import('../src/game/game').Game;
  ground: typeof import('../src/render/ground');
  overlay: typeof import('../src/render/overlay');
  skyway: typeof import('../src/render/art/skyway');
  traffic: typeof import('../src/render/art/traffic');
  sky: typeof import('../src/game/skyway');
};
let M: Mods;
beforeAll(async () => {
  M = {
    World: (await import('../src/game/world')).World,
    Game: (await import('../src/game/game')).Game,
    ground: await import('../src/render/ground'),
    overlay: await import('../src/render/overlay'),
    skyway: await import('../src/render/art/skyway'),
    traffic: await import('../src/render/art/traffic'),
    sky: await import('../src/game/skyway'),
  };
});

const N = 64;
const { Street: S, Avenue: A, Highway: H, Alley: L, Ramp: R } = RoadKind;

/** Every road kind, bridges, an interchange, decks of every shape, ports and an academy on one map. */
function scene(w: WorldT) {
  const { SKY_E, SKY_N, SKY_RAMP, SKY_S, SKY_W } = M.sky;
  for (let i = 0; i < N * N; i++) w.tiles[i].terrain = Terrain.Land;
  // A water channel (bridges) and a bay on the south edge (the seaport's shore).
  for (let y = 4; y < 44; y++) for (let x = 36; x <= 37; x++) w.tiles[y * N + x].terrain = Terrain.Water;
  for (let y = 56; y < N; y++) for (let x = 0; x < N; x++) w.tiles[y * N + x].terrain = Terrain.Water;
  const row = (y: number, k: RoadKind, x0 = 2, x1 = 60) => {
    for (let x = x0; x <= x1; x++) if (!((k === L || k === R) && w.tiles[y * N + x].terrain === Terrain.Water)) w.setRoad(x, y, k);
  };
  row(6, S, 0, 63); // runs off both map edges (regional links)
  row(10, A);
  row(14, H, 0, 63);
  row(18, L);
  // Interchange: S R H R S, and a parallel street beside the highway.
  for (let y = 11; y <= 17; y++) if (y !== 14) w.setRoad(20, y, y === 13 || y === 15 ? R : S);
  for (let x = 24; x <= 30; x++) w.setRoad(x, 15, S);
  // Junctions of mixed kinds.
  for (let y = 6; y <= 10; y++) w.setRoad(10, y, A);
  for (let y = 10; y <= 18; y++) if (y !== 14) w.setRoad(30, y, y === 18 ? L : S);
  // Zones of every kind, level and tier.
  for (let x = 2; x <= 34; x++)
    for (const y of [7, 9, 11, 17, 19]) {
      if (w.tiles[y * N + x].road) continue;
      w.setZone(x, y, ((x % 3) + 1) as ZoneType);
      w.setLevel(x, y, x % 4, x % 7 === 0, (x % 3) as 0 | 1 | 2);
    }
  // Skyway: ramp (two-tile slope) on the street, junction, corner, a dead end, a closed ramp.
  for (let x = 4; x <= 8; x++) w.setRoad(x, 24, S);
  w.setSky(4, 24, SKY_E | SKY_RAMP);
  for (let x = 5; x <= 33; x++) w.setSky(x, 24, SKY_E | SKY_W);
  w.setSky(34, 24, SKY_W | SKY_S);
  for (let y = 25; y <= 30; y++) w.setSky(34, y, SKY_N | SKY_S);
  w.setSky(34, 31, SKY_N);
  w.setSky(15, 24, SKY_E | SKY_W | SKY_N);
  w.setSky(15, 23, SKY_S | SKY_RAMP); // closed (bare land below)
  // Ports and an academy, a 4×4 Stratablock docked by the deck.
  const sea = w.addBuilding('seaport', 20, 52);
  if (sea) sea.facing = 2;
  w.addBuilding('airport', 40, 30);
  const sp = w.addBuilding('spaceport', 48, 44);
  if (sp) sp.buildDays = 100;
  w.addBuilding('academy', 12, 30);
  const st = w.addBuilding('stack', 26, 26);
  if (st) st.stage = 3;
  for (let y = 25; y <= 27; y++) w.setSky(28, y, (y === 25 ? 0 : SKY_N) | SKY_S);
  w.setSky(28, 24, SKY_E | SKY_W | SKY_S);
  // Across the airport's runway rows (a low building: deferred) and beside the Stratablock's +y face.
  for (let x = 38; x <= 47; x++) w.setSky(x, 32, (x > 38 ? SKY_W : 0) | (x < 47 ? SKY_E : 0));
  for (let x = 25; x <= 30; x++) w.setSky(x, 30, (x > 25 ? SKY_W : 0) | (x < 30 ? SKY_E : 0));
  for (const b of w.buildings.values()) b.powered = true;
  for (let i = 0; i < N * N; i++) {
    if (w.sky[i]) w.fields.skyTraffic[i] = 0.7;
    if (w.tiles[i].road) w.fields.traffic[i] = 0.5;
    w.fields.noise[i] = (i % 17) / 17;
    w.fields.wealth[i] = (i % 13) / 13;
  }
  w.turf.owner[w.idx(5, 18)] = 1;
  w.turf.str[w.idx(5, 18)] = 80;
}

const view = (zoom: number) => ({ camX: 0, camY: N * 16, zoom, dpr: 1, width: 390, height: 844 });

describe('ground cache paints every road kind cleanly (§3.11)', () => {
  it('far, mid and near zoom, day and night, plus a partial redraw after an edit', () => {
    const w = new M.World(4242, undefined, undefined, 1);
    scene(w);
    for (const zoom of [0.2, 0.5, 1, 2.5]) {
      for (const night of [0, 1]) {
        resetMockStats();
        const cache = new M.ground.GroundCache();
        const ctx = mockContext();
        // A generous budget renders every visible chunk in one call.
        cache.draw(ctx, w, view(zoom), night, 1e6);
        cache.draw(ctx, w, view(zoom), night, 1e6);
        cache.drawAnimated(ctx, w, { x0: 0, y0: 0, x1: N - 1, y1: N - 1 }, { time: 3, night, zoom, quality: 'high' }, { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 });
        // An edit (a skyway tile cleared) repaints a dirty rect.
        cache.invalidate({ x0: 10, y0: 20, x1: 20, y1: 28 });
        cache.draw(ctx, w, view(zoom), night, 1e6);
        expect(mockStats.errors, `zoom ${zoom} night ${night}`).toEqual([]);
        expect(mockStats.draws).toBeGreaterThan(0);
      }
    }
  });
});

describe('district ground character on a 5×5 region (MEGACITY §3.7, §3.9)', () => {
  it('every kind and variant paints owned and in the fog, street and skyline, day and night, with its decals', async () => {
    const { Ground } = await import('../src/game/types');
    const { slotRect } = await import('../src/game/districts/slots');
    const w = M.World.generate(2091, 'Region', undefined, 5);
    w.funds = 1e9;
    // Own the inner ring (ring 1: every kind's first district); ring 2 stays fog.
    for (let s = 0; s < 25; s++) {
      const sx = s % 5;
      const sy = (s / 5) | 0;
      if (sx >= 1 && sx <= 3 && sy >= 1 && sy <= 3 && !w.slotOwned[s]) w.annex(s);
    }
    const info = new M.ground.TerrainInfo(w);
    const kinds = new Set<string>();
    let reeds = 0;
    let runwayNums = 0;
    for (let s = 0; s < 25; s++) {
      const kind = w.districts.kinds[s];
      kinds.add(`${kind}:${w.variantOf(s)}`);
      const r = slotRect(w, s);
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          const i = y * w.N + x;
          if (w.slotOwned[s] && w.tiles[i].ground === Ground.Reed) reeds++;
          const d = info.deco[i];
          if (d === M.ground.DECO_RUNWAY_NUM_LO || d === M.ground.DECO_RUNWAY_NUM_HI) runwayNums++;
        }
    }
    expect(kinds.size).toBeGreaterThan(9);
    if (w.districts.kinds.includes('tarmac')) {
      expect(runwayNums).toBeGreaterThan(0);
      expect(info.socks.length).toBeGreaterThan(0);
    }
    if (w.districts.owned.some((s) => w.districts.kinds[s] === 'reedmere')) expect(reeds).toBeGreaterThan(0);
    // Paint the middle of every slot at far, mid and near zoom, street and skyline, day and night.
    const cache = new M.ground.GroundCache();
    const ctx = mockContext();
    for (let s = 0; s < 25; s++) {
      const r = slotRect(w, s);
      const cx = r.x0 + 32;
      const cy = r.y0 + 32;
      for (const [zoom, skyline] of [
        [0.3, true],
        [0.5, false],
        [1.2, false],
      ] as [number, boolean][])
        for (const night of [0, 1]) {
          resetMockStats();
          const v = { camX: (cx - cy) * 32, camY: (cx + cy) * 16, zoom, dpr: 1, width: 390, height: 844 };
          cache.draw(ctx, w, v, night, 1e6, skyline);
          const b = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
          cache.drawAnimated(ctx, w, b, { time: 5, night, zoom, quality: 'high', artOffset: 64, world: w }, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 });
          expect(mockStats.errors, `slot ${s} ${w.districts.kinds[s]} zoom ${zoom} night ${night}`).toEqual([]);
        }
    }
  });
});

describe('skyway layer (§3.7)', () => {
  it('draws every deck, the deferred pieces, portals, car lights and the one glow pass without errors', () => {
    const w = new M.World(77, undefined, undefined, 1);
    scene(w);
    const layer = new M.skyway.SkywayLayer();
    for (const [zoom, night] of [
      [0.4, 0],
      [1, 1],
      [2.5, 1],
    ]) {
      resetMockStats();
      const ctx = mockContext();
      const env = { time: zoom * 10 + night, night, zoom, quality: 'high' as const };
      layer.prepare(w, env);
      expect(layer.any).toBe(true);
      let deferred = 0;
      for (let i = 0; i < N * N; i++) {
        if (!w.sky[i]) continue;
        if (layer.isDeferred(i)) deferred++;
        else layer.drawTile(ctx, w, i % N, (i / N) | 0);
      }
      for (const b of w.buildings.values()) layer.afterBuilding(ctx, w, b, () => true);
      layer.flushCars(ctx);
      layer.drawGlows(ctx);
      expect(deferred).toBeGreaterThan(0);
      expect(mockStats.errors).toEqual([]);
      expect(mockStats.draws).toBeGreaterThan(0);
    }
  });
});

describe('overlays and previews (§7.3, §7.5)', () => {
  it('wealth (with pips), noise, traffic, power and services build and draw cleanly', () => {
    const w = new M.World(5, undefined, undefined, 1);
    scene(w);
    // The shared mock has no createImageData; the overlay needs one ImageData per layer.
    const proto = Object.getPrototypeOf(mockContext()) as Record<string, unknown>;
    proto.createImageData ??= (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch });
    const layer = new M.overlay.OverlayLayer();
    const b = { x0: 0, y0: 0, x1: N - 1, y1: N - 1 };
    const v = { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };
    for (const o of ['wealth', 'noise', 'traffic', 'power', 'services', 'landValue'] as const) {
      resetMockStats();
      const ctx = mockContext();
      layer.invalidate();
      layer.draw(ctx, w, o, 1, b, 1);
      layer.drawTop(ctx, w, o, b, 1, v);
      expect(mockStats.errors, o).toEqual([]);
    }
  });

  it('road, skyway, bulldoze and port ghosts plus shore-site hints draw from real plans', () => {
    const g = new M.Game();
    // The legacy 64×64 frame (the scene's coordinates): a fresh Game holds a 3×3 region whose start slot is 64..127.
    g.restore(JSON.parse(JSON.stringify(new M.World(9, undefined, undefined, 1).serialize())));
    scene(g.world);
    g.sim.recomputeAll();
    g.world.maxPopulation = 600_000;
    g.world.funds = 1e6;
    const env = { time: 1, night: 0.5, zoom: 1, quality: 'high' as const };
    const cases: [string, { x: number; y: number }, { x: number; y: number }][] = [
      ['road', { x: 44, y: 11 }, { x: 44, y: 17 }],
      ['avenue', { x: 2, y: 6 }, { x: 20, y: 6 }],
      ['highway', { x: 2, y: 10 }, { x: 20, y: 10 }],
      ['alley', { x: 40, y: 20 }, { x: 50, y: 20 }],
      ['skyway', { x: 8, y: 34 }, { x: 20, y: 34 }],
      ['airport', { x: 4, y: 40 }, { x: 4, y: 40 }],
      ['seaport', { x: 40, y: 52 }, { x: 40, y: 52 }],
      ['bulldoze', { x: 6, y: 24 }, { x: 9, y: 24 }],
    ];
    for (const [tool, a, z] of cases) {
      resetMockStats();
      g.setTool(tool as never);
      const plan = g.plan(a, z);
      g.setPreview(plan);
      const ctx = mockContext();
      M.overlay.drawToolHints(ctx, g, 1, 1, { x0: 0, y0: 0, x1: N - 1, y1: N - 1 });
      M.overlay.drawPreviewGround(ctx, g, 1, 1);
      M.overlay.drawPreviewTop(ctx, g, env);
      expect(mockStats.errors, tool).toEqual([]);
    }
    // The skyway drag and the sky bulldoze plan as expected for their ghosts.
    g.setTool('skyway');
    expect(g.plan({ x: 8, y: 34 }, { x: 20, y: 34 }).skyMasks?.length).toBe(13);
    g.setTool('bulldoze');
    expect(g.plan({ x: 6, y: 24 }, { x: 9, y: 24 }).layer).toBe('sky');
    // A selected deck and a selected noisy building draw their highlights.
    for (const sel of [{ x: 10, y: 24, sky: true as const }, { x: 41, y: 31 }]) {
      resetMockStats();
      g.select(sel);
      const ctx = mockContext();
      M.overlay.drawSelectionGround(ctx, g, 1, 1);
      M.overlay.drawSelectionTop(ctx, g, 1, 1);
      expect(mockStats.errors).toEqual([]);
      expect(mockStats.draws).toBeGreaterThan(0);
    }
  });
});

describe('street traffic draws on every kind (§3.11)', () => {
  it('runs and draws cars, trucks and bikes by day and night without errors', () => {
    const w = new M.World(8, undefined, undefined, 1);
    scene(w);
    w.stats.population = 90000;
    const t = new M.traffic.StreetTraffic();
    const b = { x0: 0, y0: 0, x1: N - 1, y1: N - 1 };
    const ctx = mockContext();
    resetMockStats();
    for (let k = 0; k < 120; k++) {
      t.draw(ctx, b, k % 2 ? 0.4 : 1.2, k % 3 ? 0 : 1, 'high', 0.5);
      t.update(1 / 30, w, 'high');
    }
    expect(mockStats.errors).toEqual([]);
    expect(mockStats.draws).toBeGreaterThan(0);
  });
});

describe('the minimal render frame keeps the start slot\'s look (MEGACITY §3.9; review fixes)', () => {
  const FIXTURES = import.meta.glob(['./fixtures/v3-*.json', '!./fixtures/v3-baseline.json'], { import: 'default', eager: true }) as Record<string, import('../src/game/types').SaveData>;
  /** The fixture migrated to a 3×3 region, and the same city on the legacy 64 frame. */
  const pair = async (v3: import('../src/game/types').SaveData) => {
    const { encodeBlock } = await import('../src/game/districts/migrate');
    const migrated = M.World.deserialize(JSON.parse(JSON.stringify(v3)));
    const legacySave = { ...JSON.parse(JSON.stringify(v3)), version: 4, region: 1, size: 64, districts: { kinds: ['shore'], owned: [0], grants: 0, bought: 0, annexedAt: [0] }, tileBlocks: [encodeBlock(v3.tiles!.map((t) => t & 0xfffff))] };
    delete legacySave.tiles;
    return { migrated, legacy: M.World.deserialize(legacySave) };
  };

  it('terrain tone, water depth and the regional-road stubs of every migrated fixture equal the 64 map', async () => {
    for (const [name, v3] of Object.entries(FIXTURES)) {
      const { migrated, legacy } = await pair(v3);
      const a = new M.ground.TerrainInfo(legacy);
      const b = new M.ground.TerrainInfo(migrated);
      let stubs = 0;
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const i = y * 64 + x;
          const j = (y + 64) * 192 + x + 64;
          if (a.tone[i] !== b.tone[j] || a.depth[i] !== b.depth[j] || a.stub[i] !== b.stub[j]) throw new Error(`${name} at ${x},${y}: tone ${a.tone[i]}/${b.tone[j]} depth ${a.depth[i]}/${b.depth[j]} stub ${a.stub[i]}/${b.stub[j]}`);
          if (a.stub[i]) stubs++;
        }
      expect([name, stubs]).toEqual([name, 4]);
      // No stub anywhere off the start slot.
      let outside = 0;
      for (let i = 0; i < migrated.area; i++) if (b.stub[i] && !migrated.ownedAt(i)) outside++;
      expect(outside).toBe(0);
    }
  });

  it('street traffic enters at the start slot edge where it entered at the 64 map edge', async () => {
    const v3 = Object.entries(FIXTURES).find(([n]) => n.includes('v3-expansion'))![1];
    const { migrated, legacy } = await pair(v3);
    const edges = (w: WorldT, off: number) => {
      const t = new M.traffic.StreetTraffic();
      const b = { x0: off, y0: off, x1: off + 63, y1: off + 63 };
      t.draw(mockContext(), b, 1, 0, 'high', 0);
      t.update(1 / 30, w, 'high');
      return (t as unknown as { visEdge: number[] }).visEdge.map((i) => [(i % w.N) - off, ((i / w.N) | 0) - off]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    };
    const a = edges(legacy, 0);
    expect(a.length).toBeGreaterThan(0);
    expect(edges(migrated, 64)).toEqual(a);
  });

  it('sky lanes, flyers and the blimp fly over the owned land, at the 64 map\'s places on a migrated start slot', async () => {
    const { SkyTraffic } = await import('../src/render/art/skytraffic');
    type Lane = { axis: number; c: number; z: number; lo: number; hi: number };
    type Peek = { lanes: Lane[]; flyers: { lane: number; s: number }[]; blimp: { axis: number; c: number; s: number } | null; blimpTimer: number };
    const v3 = Object.entries(FIXTURES).find(([n]) => n.includes('v3-expansion'))![1];
    const { migrated, legacy } = await pair(v3);
    const run = (w: WorldT) => {
      const sky = new SkyTraffic();
      const p = sky as unknown as Peek;
      w.stats.population = 500_000;
      for (let k = 0; k < 200; k++) {
        if (k === 5) p.blimpTimer = 0;
        sky.update(0.05, w, 'high', null, 1);
      }
      return p;
    };
    const a = run(legacy);
    for (const R of [3, 5] as const) {
      const w = R === 3 ? migrated : M.World.generate(legacy.seed, 'Sky', undefined, 5);
      if (R === 5) w.stats.population = 500_000;
      const b = run(w);
      const o = w.ownedBox;
      const off = o.x0;
      // The same lanes, shifted onto the start slot.
      expect(b.lanes.map((l) => [l.axis, l.c - off, l.z])).toEqual(a.lanes.map((l) => [l.axis, l.c, l.z]));
      for (const l of b.lanes) {
        expect(l.c).toBeGreaterThanOrEqual(o.x0);
        expect(l.c).toBeLessThanOrEqual(o.x1);
        expect([l.lo, l.hi]).toEqual([o.x0, o.x1 + 1]);
      }
      expect(b.flyers.length).toBeGreaterThan(10);
      for (const f of b.flyers) {
        expect(f.s).toBeGreaterThanOrEqual(o.x0 - 8);
        expect(f.s).toBeLessThanOrEqual(o.x1 + 1 + 8);
      }
      expect(b.blimp).not.toBeNull();
      expect(b.blimp!.c).toBeGreaterThanOrEqual(o.x0 + 14);
      expect(b.blimp!.c).toBeLessThanOrEqual(o.x1 - 13);
    }
  });
});
