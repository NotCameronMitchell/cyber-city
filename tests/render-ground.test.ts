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
    const w = new M.World(4242);
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

describe('skyway layer (§3.7)', () => {
  it('draws every deck, the deferred pieces, portals, car lights and the one glow pass without errors', () => {
    const w = new M.World(77);
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
    const w = new M.World(5);
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
    scene(g.world);
    g.sim.recomputeAll();
    g.world.maxPopulation = 60000;
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
    const w = new M.World(8);
    scene(w);
    w.stats.population = 9000;
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
