// R1 (docs/MEGACITY.md §3.9 R0, §11.1, §11.3): a canvas-mock speed-3 growth run on the megacity fixture, at 9
// districts (3×3) and 25 (5×5), with a Renderer drawing every frame. Whole-region render passes run only on a world
// swap or an annex (none in the run); owned-area passes (data overlay, dark-block tracking, the skyway layout, the
// tall-anchor mask, the turf diff, shore sites) at most once per 250 ms each. Render cache upkeep (the 'tiles'
// handlers and the per-frame cache refreshes) is measured and held to §11.1 with the suite's 3× slack.
//
// Out of scope here: art/traffic.ts' StreetTraffic.rebuild and effects.ts (WP-6, Wave 3, under the same rule).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import type { Region } from '../src/game/types';
import { installCanvasMock, mockStats, resetMockStats } from './canvas-mock';
import { cachedMegacity } from './megacity-fixture';

let uninstall: () => void = () => {};
beforeAll(() => {
  uninstall = installCanvasMock();
  // The data overlay builds an ImageData; the mock context has putImageData only.
  const proto = Object.getPrototypeOf(document.createElement('canvas').getContext('2d')) as Record<string, unknown>;
  proto.createImageData ??= (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
});
afterAll(() => uninstall());

type Timed = { [k: string]: (...a: unknown[]) => unknown };

/** Wrap prototype methods so their time adds to `acc.ms` (the render cache upkeep of one frame). */
function timeMethods(acc: { ms: number }, targets: [object, string][]): () => void {
  const undo: (() => void)[] = [];
  for (const [proto, name] of targets) {
    const p = proto as Timed;
    const orig = p[name];
    p[name] = function (this: unknown, ...a: unknown[]) {
      const t0 = performance.now();
      try {
        return orig.apply(this, a);
      } finally {
        acc.ms += performance.now() - t0;
      }
    };
    undo.push(() => (p[name] = orig));
  }
  return () => undo.forEach((u) => u());
}

describe.each([
  { region: 3 as Region, n: 9, meanBudget: 0.3, p95Budget: 1 },
  { region: 5 as Region, n: 25, meanBudget: 0.5, p95Budget: 1.5 },
])('R1: render passes and cache upkeep in a speed-3 growth run, $region×$region region ($n districts)', ({ region, n, meanBudget, p95Budget }) => {
  it('no whole-region pass; owned-area passes at most once per 250 ms each; upkeep within §11.1 (×3 slack in CI)', async () => {
    const { Renderer, ParcelCache } = await import('../src/render/renderer');
    const { Camera } = await import('../src/render/camera');
    const ground = await import('../src/render/ground');
    const overlay = await import('../src/render/overlay');
    const skyway = await import('../src/render/art/skyway');
    const story = await import('../src/render/story');
    const atlas = await import('../src/render/atlas');
    const { renderPasses, resetPasses } = await import('../src/render/passes');
    const g = new Game();
    expect(g.restore(cachedMegacity(region, n).serialize())).toBe(true);
    expect(g.world.districts.owned.length).toBe(n);
    const canvas = document.createElement('canvas');
    canvas.width = 390;
    canvas.height = 844;
    const cam = new Camera(g.world.N);
    const r = new Renderer(canvas, g, cam);
    // A fake frame clock: 60 fps, Game's sim clock on the same fake time.
    let now = 0;
    g.msClock = () => now;
    const acc = { ms: 0 };
    // The whole 'tiles' handlers (every cache they mark: ground chunks, the overlay, the access and parcel blocks, the
    // atlas, the skyway layout, the tall flags) and the per-frame refreshes that do the deferred work.
    const undo = timeMethods(acc, [
      [Renderer.prototype, 'onTiles'],
      [story.StoryRender.prototype, 'onTiles'],
      [Renderer.prototype, 'turfChanged'],
      [Renderer.prototype, 'turfStep'],
      [ground.GroundCache.prototype, 'patchTerrain'],
      [overlay.RoadAccessMap.prototype, 'get'],
      [ParcelCache.prototype, 'sync'],
      [ParcelCache.prototype, 'get'],
      [skyway.SkywayLayer.prototype, 'prepare'],
      [story.StoryRender.prototype, 'prepare'],
    ]);
    void atlas;
    try {
      cam.zoom = 0.6;
      cam.centerOnTile(g.world.N / 2, g.world.N / 2);
      g.setSpeed(3);
      resetMockStats();
      const frame = () => {
        now += 1000 / 60;
        acc.ms = 0;
        g.update(1 / 60);
        r.render(1 / 60, now / 1000);
        return acc.ms;
      };
      // Warm-up: the first frame builds every cache once.
      for (let k = 0; k < 20; k++) frame();
      resetPasses();
      const tilesBefore = { count: 0 };
      const off = g.events.on('tiles', () => tilesBefore.count++);
      const frames = 360; // 6 s at 60 fps
      const times: number[] = [];
      const t0 = g.world.tick;
      const wall0 = performance.now();
      for (let k = 0; k < frames; k++) times.push(frame());
      off();
      const days = g.world.tick - t0;
      // The throttles run on the wall clock: under a loaded CI box the 360 frames can take longer than 6 s.
      const seconds = Math.max(frames / 60, (performance.now() - wall0) / 1000);
      times.sort((a, b) => a - b);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const p95 = times[Math.ceil(0.95 * times.length) - 1];
      console.log(`[R1] ${n} districts: ${days} days, ${tilesBefore.count} tiles events, upkeep mean ${mean.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms · max ${times[times.length - 1].toFixed(3)} ms; passes ${JSON.stringify(renderPasses)}`);
      expect(days).toBeGreaterThan(30);
      expect(tilesBefore.count).toBeGreaterThan(20);
      // Whole-region passes: none during play (only a world swap or an annex builds them).
      for (const [k, v] of Object.entries(renderPasses)) if (k.startsWith('region:')) expect([k, v]).toEqual([k, 0]);
      // Owned-area passes: ≤ 1 per 250 ms each (+1 for the window edge).
      for (const [k, v] of Object.entries(renderPasses)) expect([k, v <= seconds / 0.25 + 1]).toEqual([k, true]);
      expect(mean).toBeLessThan(meanBudget * 3);
      expect(p95).toBeLessThan(p95Budget * 3);
      expect(mockStats.errors).toEqual([]);
      // With the data overlay and the Seaport tool on, the throttled passes still keep to their rate.
      g.overlay = 'landValue';
      g.setTool('seaport');
      resetPasses();
      const wall1 = performance.now();
      for (let k = 0; k < 120; k++) frame();
      const sec2 = Math.max(2, (performance.now() - wall1) / 1000);
      for (const [k, v] of Object.entries(renderPasses)) expect([k, v <= sec2 / 0.25 + 1]).toEqual([k, true]);
      expect(renderPasses['owned:overlay'] ?? 0).toBeGreaterThan(0);
    } finally {
      undo();
      r.destroy();
    }
  }, 120_000);
});

describe('R0: an annex rebuilds the region caches once; a world swap too', () => {
  it('annexing a slot costs one whole-region pass per cache, then nothing', async () => {
    const { Renderer } = await import('../src/render/renderer');
    const { Camera } = await import('../src/render/camera');
    const { renderPasses, resetPasses } = await import('../src/render/passes');
    const g = new Game();
    const canvas = document.createElement('canvas');
    canvas.width = 390;
    canvas.height = 844;
    const cam = new Camera(g.world.N);
    const r = new Renderer(canvas, g, cam);
    try {
      cam.zoom = 0.5;
      cam.centerOnTile(96, 96);
      for (let k = 0; k < 5; k++) r.render(1 / 60, k / 60);
      resetPasses();
      g.world.districts.grants = 1;
      const s = g.world.districts.kinds.findIndex((k, i) => i === 1 && k !== 'sunk') >= 0 ? 1 : 3;
      // A lease answer in case the slot is Tarmac Reach (New City seeds vary); ignored for every other kind.
      expect(g.annex(s, 'nacre')).toMatchObject({ ok: true });
      for (let k = 0; k < 10; k++) r.render(1 / 60, (5 + k) / 60);
      expect(renderPasses['region:terrainInfo']).toBe(1);
      expect(renderPasses['region:parcels'] ?? 0).toBeLessThanOrEqual(1);
      resetPasses();
      for (let k = 0; k < 10; k++) r.render(1 / 60, (15 + k) / 60);
      expect(Object.keys(renderPasses).filter((k) => k.startsWith('region:'))).toEqual([]);
    } finally {
      r.destroy();
    }
  });
});

describe('R0: growth that changes nothing on the ground repaints no ground chunk', () => {
  it('a level change dirties only the skyline chunks; zoning, a road or abandonment dirties the street ones too', async () => {
    const { Renderer } = await import('../src/render/renderer');
    const { Camera } = await import('../src/render/camera');
    const g = new Game();
    expect(g.restore(cachedMegacity(3, 3).serialize())).toBe(true);
    const canvas = document.createElement('canvas');
    canvas.width = 390;
    canvas.height = 844;
    const cam = new Camera(g.world.N);
    const r = new Renderer(canvas, g, cam);
    try {
      const w = g.world;
      // A developed tile in view: paint both views' chunks once.
      let x = -1;
      let y = -1;
      for (let i = 0; i < w.area && x < 0; i++) {
        const t = w.tiles[i];
        if (t.zone && t.level === 1 && !t.abandoned && w.isOwned(i % w.N, (i / w.N) | 0)) {
          x = i % w.N;
          y = (i / w.N) | 0;
        }
      }
      expect(x).toBeGreaterThanOrEqual(0);
      cam.centerOnTile(x, y);
      for (const z of [0.3, 0.6]) {
        cam.zoom = z;
        for (let k = 0; k < 30; k++) r.render(1 / 60, k / 60);
      }
      const ground = (r as unknown as { ground: { chunks: Map<number, { sky: boolean; dirty: unknown; rendered: boolean }> } }).ground;
      const dirty = () => {
        let street = 0;
        let sky = 0;
        for (const c of ground.chunks.values()) if (c.rendered && c.dirty) c.sky ? sky++ : street++;
        return { street, sky };
      };
      const before = [...ground.chunks.values()].filter((c) => c.rendered);
      expect(before.some((c) => c.sky)).toBe(true);
      expect(before.some((c) => !c.sky)).toBe(true);
      expect(dirty()).toEqual({ street: 0, sky: 0 });
      w.setLevel(x, y, 2);
      const d1 = dirty();
      expect(d1.street).toBe(0);
      expect(d1.sky).toBeGreaterThan(0);
      w.setLevel(x, y, 2, true);
      expect(dirty().street).toBeGreaterThan(0);
    } finally {
      r.destroy();
    }
  });
});

