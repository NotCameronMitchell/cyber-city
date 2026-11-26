// MEGACITY §6.4 / §3.11 / §11.5 WP-6: life and atmosphere — settings, caps, LOD, low quality, lower detail, the view
// band, R0 for the street index, and the §11.1 life budget (Node, canvas mock, 3× slack).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY_CYCLE_SECONDS } from '../src/game/config';
import { DEFAULT_SETTINGS, Game } from '../src/game/game';
import { cityLifeOn, crowdsOn, weatherOf, weatherPatch, withLifeDefaults } from '../src/game/settings';
import type { Region, Settings } from '../src/game/types';
import { installCanvasMock, mockStats, resetMockStats } from './canvas-mock';
import { cachedMegacity } from './megacity-fixture';

let uninstall: () => void = () => {};
beforeAll(() => {
  uninstall = installCanvasMock();
  const proto = Object.getPrototypeOf(document.createElement('canvas').getContext('2d')) as Record<string, unknown>;
  proto.createImageData ??= (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
});
afterAll(() => uninstall());

describe('life settings (§7.6: unknown reads as default)', () => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  it('weather reads from the old rain toggle when missing', () => {
    expect(weatherOf({ ...base, rain: true })).toBe('full');
    expect(weatherOf({ ...base, rain: false })).toBe('off');
    expect(weatherOf({ ...base, rain: false, weather: 'light' })).toBe('light');
    expect(weatherOf({ ...base, weather: 'bogus' as never })).toBe('full');
  });
  it('crowds default to the quality; City life defaults on', () => {
    expect(crowdsOn({ ...base, quality: 'high' })).toBe(true);
    expect(crowdsOn({ ...base, quality: 'low' })).toBe(false);
    expect(crowdsOn({ ...base, quality: 'low', crowds: true })).toBe(true);
    expect(cityLifeOn(base)).toBe(true);
    expect(cityLifeOn({ ...base, cityLife: false })).toBe(false);
  });
  it('rain is still written for older builds', () => {
    expect(weatherPatch('off')).toEqual({ weather: 'off', rain: false });
    expect(weatherPatch('light')).toEqual({ weather: 'light', rain: true });
    expect(withLifeDefaults({ ...base, rain: false })).toMatchObject({ weather: 'off', rain: false });
    expect(withLifeDefaults({ ...base, weather: 'light', rain: false })).toMatchObject({ weather: 'light', rain: true });
    expect(DEFAULT_SETTINGS.weather).toBeUndefined();
  });
});

describe('lifeLevers (§6.4, §3.11): low quality, the settings, lower detail and the view band', () => {
  it('turn each layer on and off as the spec says', async () => {
    const { lifeLevers } = await import('../src/render/effects');
    const s: Settings = { ...DEFAULT_SETTINGS };
    const hi = lifeLevers(s, 'high', false, 'street');
    expect(hi).toEqual({ weather: 1, crowds: true, boats: 24, drones: true, fogPatches: true, reflections: true, cityLife: true, street: true });
    // Low quality: crowds, boats and fog patches off.
    expect(lifeLevers(s, 'low', false, 'street')).toMatchObject({ crowds: false, boats: 0, fogPatches: false, weather: 1, reflections: true, drones: true, cityLife: true });
    // Lower detail: weather off, crowds off, boats ≤ 8, drones off, City life visuals off.
    expect(lifeLevers(s, 'high', true, 'street')).toMatchObject({ weather: 0, crowds: false, boats: 8, drones: false, fogPatches: false, reflections: false, cityLife: false });
    // Settings.
    expect(lifeLevers({ ...s, weather: 'light' }, 'high', false, 'street').weather).toBe(0.5);
    expect(lifeLevers({ ...s, weather: 'off' }, 'high', false, 'street')).toMatchObject({ weather: 0, fogPatches: false, reflections: false });
    expect(lifeLevers({ ...s, rain: false }, 'high', false, 'street').weather).toBe(0);
    expect(lifeLevers({ ...s, crowds: false }, 'high', false, 'street').crowds).toBe(false);
    expect(lifeLevers({ ...s, quality: 'low', crowds: true }, 'high', false, 'street').crowds).toBe(true);
    expect(lifeLevers({ ...s, cityLife: false }, 'high', false, 'street').cityLife).toBe(false);
    // The skyline view and the City map: no street cars, crowds, boats or reflections (§3.9).
    expect(lifeLevers(s, 'high', false, 'skyline')).toMatchObject({ street: false, crowds: false, boats: 0, reflections: false, drones: true });
    expect(lifeLevers(s, 'high', false, 'map')).toMatchObject({ street: false, drones: false, cityLife: false, fogPatches: false });
  });
});

type Fx = import('../src/render/effects').Effects;

/** A Game on `world`, a 390×844 Renderer and a fake 60 fps clock; `frames(n)` renders n frames. */
async function scene(save: unknown, opts: { zoom?: number; night?: boolean; settings?: Partial<Settings>; at?: [number, number] } = {}) {
  const { Renderer } = await import('../src/render/renderer');
  const { Camera } = await import('../src/render/camera');
  const g = new Game();
  expect(g.restore(save as never)).toBe(true);
  g.updateSettings({ ...opts.settings });
  const canvas = document.createElement('canvas');
  canvas.width = 390;
  canvas.height = 844;
  const cam = new Camera(g.world.N);
  const r = new Renderer(canvas, g, cam);
  let now = 0;
  g.msClock = () => now;
  cam.zoom = opts.zoom ?? 1;
  const [cx, cy] = opts.at ?? [g.world.N / 2, g.world.N / 2];
  cam.centerOnTile(cx, cy);
  // Night (00:00) or a fog morning hour (07:00) on the visual clock.
  g.clock = opts.night ? DAY_CYCLE_SECONDS * 3 : DAY_CYCLE_SECONDS * (3 + 7 / 24);
  const fx = (r as unknown as { effects: Fx }).effects;
  const frames = (n: number, each?: () => void) => {
    for (let k = 0; k < n; k++) {
      now += 1000 / 60;
      // A story card would pause the sim and City life with it: answer it and keep the speed.
      if (g.story.blocking) g.choose(0);
      if (g.speed === 0) g.setSpeed(1);
      g.update(1 / 60);
      r.render(1 / 60, now / 1000);
      each?.();
    }
  };
  return { g, r, cam, fx, frames };
}

const busy = () => cachedMegacity(3, 9).serialize();

/** A city that annexed every district it may (terrain generated by Game.annex): owned water for boats and fog. */
function wetCity(region: Region, seed = 4321): unknown {
  const g = new Game();
  g.newCity('Wet', seed, region);
  const w = g.world;
  for (let pass = 0; pass < 3; pass++)
    for (let s = 0; s < region * region; s++) {
      if (w.slotOwned[s]) continue;
      w.districts.grants = 1;
      g.annex(s, 'nacre');
    }
  w.stats.population = 40000;
  return w.serialize();
}
const wet3 = wetCity(3);

describe('caps and LOD (§6.4)', () => {
  it('crowds ≤ 300 at zoom ≥ 0.8 and none below; cars of every §6.4 kind; drones over the Market streets', async () => {
    const { r, cam, fx, frames, g } = await scene(busy(), { zoom: 1 });
    try {
      g.setSpeed(1);
      let maxCrowd = 0;
      const kinds = [0, 0, 0, 0, 0, 0, 0];
      frames(600, () => {
        const s = fx.lifeStats();
        maxCrowd = Math.max(maxCrowd, s.crowds);
        s.carKinds.forEach((n, k) => (kinds[k] += n));
      });
      const s = fx.lifeStats();
      expect(maxCrowd).toBeGreaterThan(20);
      expect(maxCrowd).toBeLessThanOrEqual(300);
      expect(s.crowdsDrawn).toBeGreaterThan(0);
      expect(s.cars).toBeGreaterThan(10);
      // Car, Taxi, Truck, Bike, Bus, Van, Police: the fixture has avenues only if laid; buses need avenues.
      expect(kinds[0]).toBeGreaterThan(0);
      expect(kinds[1]).toBeGreaterThan(0);
      expect(kinds[2]).toBeGreaterThan(0);
      expect(kinds[5]).toBeGreaterThan(0);
      expect(kinds[6]).toBeGreaterThan(0); // the fixture has precincts
      expect(s.drones).toBeGreaterThan(0);
      expect(s.drones).toBeLessThanOrEqual(28 + 4);
      // Below zoom 0.8 the crowds go.
      cam.zoom = 0.7;
      frames(30);
      expect(fx.lifeStats().crowds).toBe(0);
      expect(mockStats.errors).toEqual([]);
    } finally {
      r.destroy();
    }
  }, 60_000);

  it('neon reflections on wet roads at night ≤ 120, zoom ≥ 0.6; none by day, dry or with the weather off', async () => {
    const { r, cam, fx, frames, g } = await scene(busy(), { zoom: 1, night: true });
    try {
      const screen = (fx as unknown as { screen: { kind: number; rain: number; spanEnd: number } }).screen;
      // A storm over the city.
      frames(2);
      const force = () => {
        screen.kind = 2;
        screen.spanEnd = g.clock + 1000;
      };
      force();
      frames(240, force);
      const s = fx.lifeStats();
      expect(s.rain).toBeGreaterThan(0.3);
      expect(s.reflections).toBeGreaterThan(0);
      expect(s.reflections).toBeLessThanOrEqual(120);
      cam.zoom = 0.55;
      frames(70, force);
      expect(fx.lifeStats().reflections).toBe(0);
      cam.zoom = 1;
      g.updateSettings({ weather: 'off', rain: false });
      frames(900, force);
      expect(fx.lifeStats().rain).toBeLessThan(0.05);
      expect(fx.lifeStats().reflections).toBe(0);
    } finally {
      r.destroy();
    }
  }, 60_000);

  it('car lights on a wet night: a straight car draws its pool, tail glow and streaks from 2 pre-composed sprites, not 4 glows', async () => {
    const { r, fx, frames, g } = await scene(busy(), { zoom: 1.4, night: true });
    try {
      const screen = (fx as unknown as { screen: { kind: number; spanEnd: number } }).screen;
      const force = () => {
        screen.kind = 2;
        screen.spanEnd = g.clock + 1000;
      };
      force();
      frames(240, force);
      expect(fx.rain).toBeGreaterThan(0.3);
      type Street = { size: number; draw: (...a: unknown[]) => void; lightSprites: unknown[]; bounds: unknown };
      const street = (fx as unknown as { street: Street }).street;
      const cars = street.size;
      expect(cars).toBeGreaterThan(10);
      // One more draw onto a counting context, as the renderer's ground pass would draw it.
      const ctx = document.createElement('canvas').getContext('2d')!;
      let images = 0;
      const di = ctx.drawImage.bind(ctx) as (...a: unknown[]) => void;
      (ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage = (...a: unknown[]) => {
        images++;
        di(...a);
      };
      street.draw(ctx, street.bounds, 1.4, 1, 'high', fx.rain);
      // Before: ≥ 4 glows a car (pool, two streaks, tail glow), plus underglows and police bars. Now 2 a straight car.
      expect(images).toBeLessThan(cars * 3.2);
      expect(images).toBeGreaterThanOrEqual(cars);
      // At most 7 kinds × 4 headings × 2 sprites, built once.
      const built = street.lightSprites.filter(Boolean).length;
      expect(built).toBeGreaterThan(0);
      expect(built).toBeLessThanOrEqual(56);
      expect(mockStats.errors).toEqual([]);
    } finally {
      r.destroy();
    }
  }, 60_000);

  it('fog bands on a fog morning (0.25 Full, 0.12 Light) and ≤ 40 ground fog patches over water and reeds at zoom ≥ 0.5', async () => {
    const { r, cam, fx, frames, g } = await scene(wet3, { zoom: 0.8 });
    try {
      const screen = (fx as unknown as { screen: { kind: number; spanEnd: number } }).screen;
      const storm = () => {
        screen.kind = 2;
        screen.spanEnd = g.clock + 1000;
      };
      frames(2);
      storm();
      // Find a view with water.
      const N = g.world.N;
      // The middle of the owned water.
      let sx = 0;
      let sy = 0;
      let nw = 0;
      for (let i = 0; i < g.world.area; i++)
        if (g.world.tiles[i].terrain === 1 && g.world.ownedAt(i)) {
          sx += i % N;
          sy += (i / N) | 0;
          nw++;
        }
      expect(nw).toBeGreaterThan(500);
      let wx = -1;
      let bd = Infinity;
      for (let i = 0; i < g.world.area; i++)
        if (g.world.tiles[i].terrain === 1 && g.world.ownedAt(i)) {
          const d = Math.abs((i % N) - sx / nw) + Math.abs(((i / N) | 0) - sy / nw);
          if (d < bd) {
            bd = d;
            wx = i;
          }
        }
      cam.centerOnTile(wx % N, (wx / N) | 0);
      frames(600, storm);
      let s = fx.lifeStats();
      expect(s.fog).toBeGreaterThan(0.15);
      expect(s.fog).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(s.fogPatches).toBeGreaterThan(0);
      expect(s.fogPatches).toBeLessThanOrEqual(40);
      g.updateSettings({ weather: 'light' });
      frames(600, storm);
      s = fx.lifeStats();
      expect(s.fog).toBeLessThanOrEqual(0.12 + 1e-9);
      expect(s.fog).toBeGreaterThan(0.05);
      cam.zoom = 0.45;
      frames(70, storm);
      expect(fx.lifeStats().fogPatches).toBe(0);
      // Low quality: no fog patches.
      cam.zoom = 0.8;
      g.updateSettings({ quality: 'low' });
      frames(70, storm);
      expect(fx.lifeStats().fogPatches).toBe(0);
    } finally {
      r.destroy();
    }
  }, 60_000);

  it('boats on owned water ≤ 24, routed on navigable water; none at low quality', async () => {
    const { r, cam, fx, frames, g } = await scene(wet3, { zoom: 0.6 });
    try {
      const N = g.world.N;
      // The view over the wettest owned district.
      let best = -1;
      let bestN = 0;
      for (const s of g.world.districts.owned) {
        const sx = s % 3;
        const sy = (s / 3) | 0;
        let n = 0;
        for (let y = sy * 64; y < sy * 64 + 64; y++) for (let x = sx * 64; x < sx * 64 + 64; x++) if (g.world.tiles[y * N + x].terrain === 1) n++;
        if (n > bestN) {
          bestN = n;
          best = s;
        }
      }
      cam.centerOnTile((best % 3) * 64 + 32, ((best / 3) | 0) * 64 + 32);
      let max = 0;
      frames(900, () => (max = Math.max(max, fx.lifeStats().boats)));
      expect(max).toBeGreaterThan(0);
      expect(max).toBeLessThanOrEqual(24);
      const boats = (fx as unknown as { boats: { list: { path: Int32Array }[] } }).boats;
      for (const b of boats.list) for (const i of b.path) expect(g.world.tiles[i].terrain).toBe(1);
      g.updateSettings({ quality: 'low' });
      frames(5);
      expect(fx.lifeStats().boats).toBe(0);
    } finally {
      r.destroy();
    }
  }, 60_000);
});

describe('lower detail (§3.11) and the skyline view (§3.9)', () => {
  it('a 5×5 city in lower detail: no weather, crowds or drones, boats ≤ 8', async () => {
    const { r, fx, frames, g } = await scene(wetCity(5), { zoom: 1, settings: { lowerDetail: true } });
    try {
      expect(g.lowerDetail).toBe(true);
      frames(300);
      const s = fx.lifeStats();
      expect(s.rain).toBe(0);
      expect(s.crowds).toBe(0);
      expect(s.drones).toBe(0);
      expect(s.boats).toBeLessThanOrEqual(8);
      expect(fx.levers).toMatchObject({ weather: 0, crowds: false, drones: false, boats: 8, cityLife: false });
    } finally {
      r.destroy();
    }
  }, 60_000);

  it('no street cars in the skyline view', async () => {
    const { r, cam, fx, frames } = await scene(busy(), { zoom: 1 });
    try {
      frames(120);
      expect(fx.lifeStats().cars).toBeGreaterThan(0);
      cam.zoom = Math.max(cam.minZoom, cam.streetMinZoom - 0.05);
      frames(5);
      expect(r.view.band).toBe('skyline');
      expect(fx.lifeStats().cars).toBe(0);
      expect(fx.lifeStats().crowds).toBe(0);
    } finally {
      r.destroy();
    }
  }, 60_000);
});

describe('City life visuals (§6.4.1)', () => {
  it('each happening draws while it runs, within its caps; off with City life off or in lower detail', async () => {
    const { r, fx, frames, g } = await scene(busy(), { zoom: 1, night: true });
    try {
      const life = g.cityEvents as unknown as { start(w: unknown, id: string, p: { x: number; y: number; slot?: number }): void };
      frames(2);
      const w = g.world;
      const s = w.districts.owned[0];
      const sx = (s % 3) * 64;
      const sy = ((s / 3) | 0) * 64;
      // An avenue through the view for the parade (fixture roads run every 4 tiles).
      for (let x = sx; x < sx + 64; x++) if (w.isRoad(x, sy + 32)) w.setRoadKind(x, sy + 32, 1);
      for (const id of ['nightmarket', 'lanterns', 'stormwatch', 'arenanight', 'kiteday', 'parade']) {
        w.cityEvent = null;
        life.start(w, id, { x: sx + 32, y: sy + 32, slot: s });
        let drawn = 0;
        let lanterns = 0;
        frames(240, () => {
          drawn = Math.max(drawn, fx.lifeStats().festivalDrawn);
          lanterns = Math.max(lanterns, fx.lifeStats().skyLanterns);
        });
        expect([id, fx.lifeStats().festival]).toEqual([id, id]);
        if (id === 'nightmarket' || id === 'lanterns' || id === 'parade') expect([id, drawn > 0]).toEqual([id, true]);
        expect(lanterns).toBeLessThanOrEqual(60);
      }
      g.updateSettings({ cityLife: false });
      frames(5);
      expect(fx.lifeStats().festival).toBeNull();
      expect(mockStats.errors).toEqual([]);
    } finally {
      r.destroy();
    }
  }, 60_000);
});

describe.each([
  { region: 3 as Region, n: 9 },
  { region: 5 as Region, n: 25 },
])('R0 and the life budget, $region×$region ($n districts)', ({ region, n }) => {
  it('the street index walks no more than the view; tiles events only flag blocks; life ≤ 1.5 ms a frame (×3)', async () => {
    const { renderPasses, resetPasses } = await import('../src/render/passes');
    const { StreetIndex } = await import('../src/render/art/traffic');
    // The 25-district column is a 5×5 city on a PC (§11.1): lower detail off, every layer on.
    const { r, fx, frames, g } = await scene(cachedMegacity(region, n).serialize(), { zoom: 0.8, night: true, settings: { lowerDetail: false } });
    try {
      // A 'tiles' handler: flagging blocks only (time it over a burst like a speed-3 frame's).
      const idx = new StreetIndex();
      idx.invalidate(g.world);
      idx.refresh(g.world, { x0: 0, y0: 0, x1: 20, y1: 20 });
      const t0 = performance.now();
      for (let k = 0; k < 2000; k++) idx.invalidate(g.world, { x0: (k * 7) % g.world.N, y0: (k * 13) % g.world.N, x1: ((k * 7) % g.world.N) + 2, y1: ((k * 13) % g.world.N) + 2 });
      const burst = performance.now() - t0;
      expect(burst).toBeLessThan(3);
      g.setSpeed(3);
      frames(30);
      resetPasses();
      resetMockStats();
      const run = () => {
        const times: number[] = [];
        const wall0 = performance.now();
        frames(360, () => times.push(fx.ms.update + fx.ms.ground + fx.ms.sky + fx.ms.screen));
        const seconds = Math.max(6, (performance.now() - wall0) / 1000);
        times.sort((a, b) => a - b);
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        const p95 = times[Math.ceil(0.95 * times.length) - 1];
        return { seconds, mean, p95, max: times[times.length - 1] };
      };
      let m = run();
      for (const [k, v] of Object.entries(renderPasses)) if (k.startsWith('region:')) expect([k, v]).toEqual([k, 0]);
      expect(renderPasses['view:traffic'] ?? 0).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(renderPasses)) expect([k, v <= m.seconds / 0.25 + 1]).toEqual([k, true]);
      // A timing bound: a loaded CI box can stall one run; the better of two runs is asserted.
      if (m.p95 >= 1.5 * 3) {
        const m2 = run();
        if (m2.p95 < m.p95) m = m2;
      }
      console.log(`[life] ${n} districts: life mean ${m.mean.toFixed(3)} ms · p95 ${m.p95.toFixed(3)} · max ${m.max.toFixed(3)}; ${JSON.stringify(fx.lifeStats())}`);
      expect(g.lowerDetail).toBe(false);
      expect(fx.lifeStats().crowds).toBeGreaterThan(0);
      expect(m.p95).toBeLessThan(1.5 * 3);
      expect(mockStats.errors).toEqual([]);
    } finally {
      r.destroy();
    }
  }, 120_000);
});

describe('the §11.1 life items, each within its budget (Node, canvas mock, ×3)', () => {
  const p95 = (xs: number[]) => {
    const a = [...xs].sort((p, q) => p - q);
    return a[Math.ceil(0.95 * a.length) - 1];
  };
  it('a rainy night downtown with a night market: crowds ≤ 0.6, weather ≤ 0.5, City life ≤ 0.4, together ≤ 1.5 ms', async () => {
    const { r, fx, frames, g } = await scene(busy(), { zoom: 1, night: true });
    try {
      const screen = (fx as unknown as { screen: { kind: number; spanEnd: number } }).screen;
      const storm = () => {
        screen.kind = 2;
        screen.spanEnd = g.clock + 1000;
      };
      frames(2);
      storm();
      const w = g.world;
      const life = g.cityEvents as unknown as { start(w: unknown, id: string, p: { x: number; y: number; slot?: number }): void };
      const s = w.slotAt(w.N >> 1, w.N >> 1);
      life.start(w, 'nightmarket', { x: w.N >> 1, y: w.N >> 1, slot: s });
      frames(240, storm);
      const items = { crowds: [] as number[], weather: [] as number[], cityLife: [] as number[], total: [] as number[] };
      frames(360, () => {
        storm();
        const m = fx.itemMs;
        items.crowds.push(m.crowds);
        items.weather.push(m.weather);
        items.cityLife.push(m.cityLife);
        items.total.push(m.crowds + m.weather + m.boats + m.cityLife);
      });
      const st = fx.lifeStats();
      expect(st.festival).toBe('nightmarket');
      expect(st.festivalDrawn).toBeGreaterThan(0);
      expect(st.crowds).toBeGreaterThan(20);
      expect(st.rain).toBeGreaterThan(0.5);
      expect(st.reflections).toBeGreaterThan(0);
      const out = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, +p95(v).toFixed(3)]));
      console.log(`[life items] p95 ms ${JSON.stringify(out)}; ${JSON.stringify(st)}`);
      expect(out.crowds).toBeLessThan(0.6 * 3);
      expect(out.weather).toBeLessThan(0.5 * 3);
      expect(out.cityLife).toBeLessThan(0.4 * 3);
      expect(out.total).toBeLessThan(1.5 * 3);
    } finally {
      r.destroy();
    }
  }, 60_000);

  it('boats on a wet city: ≤ 0.2 ms', async () => {
    const { r, cam, fx, frames, g } = await scene(wet3, { zoom: 0.6 });
    try {
      const N = g.world.N;
      let best = -1;
      let bestN = 0;
      for (const s of g.world.districts.owned) {
        let n = 0;
        for (let y = ((s / 3) | 0) * 64; y < ((s / 3) | 0) * 64 + 64; y++) for (let x = (s % 3) * 64; x < (s % 3) * 64 + 64; x++) if (g.world.tiles[y * N + x].terrain === 1) n++;
        if (n > bestN) {
          bestN = n;
          best = s;
        }
      }
      cam.centerOnTile((best % 3) * 64 + 32, ((best / 3) | 0) * 64 + 32);
      frames(600);
      const ms: number[] = [];
      frames(360, () => ms.push(fx.itemMs.boats));
      expect(fx.lifeStats().boats).toBeGreaterThan(0);
      console.log(`[life items] boats ${fx.lifeStats().boats}: p95 ${p95(ms).toFixed(3)} ms`);
      expect(p95(ms)).toBeLessThan(0.2 * 3);
    } finally {
      r.destroy();
    }
  }, 60_000);
});
