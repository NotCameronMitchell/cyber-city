// Review fixes, render layer (fix-b): the glow sprite cache stays bounded through dusk and dawn;
// a still frame (the reduced-motion title) re-reads the camera after it moves; the Wealth lens
// pips follow the sim's step rule; an E or S Seaport's ship is not culled with its port; the
// rocket keeps its floodlit colour in flight; the deck highlight and sky bulldoze preview sit on
// a ramp's incline, not flat at deck height.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEAPORT, SKYWAY, WEALTH } from '../src/game/config';
import { shoreFacing, shoreSites } from '../src/game/ports';
import { SKY_RAMP } from '../src/game/skyway';
import { LEGACY_SIZE, ZoneType, type Building } from '../src/game/types';
import { World } from '../src/game/world';
import { installCanvasMock, mockContext, mockStats } from './canvas-mock';
import { expansionFixture } from './expansion-fixture';
import { flatWorld, fullyBuiltWorld } from './helpers';

const uninstall = installCanvasMock();
afterAll(() => uninstall());

const N = LEGACY_SIZE;
const HW = 32;
const HH = 16;

type Mods = {
  palette: typeof import('../src/render/palette');
  sky: typeof import('../src/render/sky');
  ground: typeof import('../src/render/ground');
  buildings: typeof import('../src/render/buildings');
  overlay: typeof import('../src/render/overlay');
  ports: typeof import('../src/render/art/ports');
  renderer: typeof import('../src/render/renderer');
  camera: typeof import('../src/render/camera');
  Game: typeof import('../src/game/game').Game;
};
let M: Mods;
beforeAll(async () => {
  M = {
    palette: await import('../src/render/palette'),
    sky: await import('../src/render/sky'),
    ground: await import('../src/render/ground'),
    buildings: await import('../src/render/buildings'),
    overlay: await import('../src/render/overlay'),
    ports: await import('../src/render/art/ports'),
    renderer: await import('../src/render/renderer'),
    camera: await import('../src/render/camera'),
    Game: (await import('../src/game/game')).Game,
  };
});

/** A mid-game city with every road kind, skyway ramps and all three ports (tests/expansion-fixture). */
function fixtureGame() {
  const g = new M.Game();
  const w = fullyBuiltWorld(99);
  expansionFixture(w);
  expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
  g.setSpeed(0);
  return g;
}

describe('render-1: glow sprites stay bounded through a day/night transition', () => {
  it('glowSprite rounds a mixed float colour into its key', () => {
    const { glowSprite } = M.palette;
    expect(glowSprite([100.31, 50.2, 20.7], 32)).toBe(glowSprite([100.44, 49.9, 20.6], 32));
  });

  it('the under-map glow adds a bounded number of sprites over a dusk of continuous night values', () => {
    const back = new M.sky.Backdrop(7);
    const ctx = mockContext();
    const view = { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };
    const before = mockStats.canvases;
    // 2400 frames of a dusk (night 0.1 → 0.5): every frame a new float night value.
    for (let k = 0; k < 2400; k++) back.drawUnderMap(ctx, 0.1 + k * 0.000167 + 1e-7 * Math.sqrt(k), k / 60, 0.8, view, N);
    // 1/32 steps: at most 14 hues for each of the two glows (was two new 128 px canvases a frame).
    expect(mockStats.canvases - before).toBeLessThanOrEqual(40);
  });

  it('the water sparkle tint adds a bounded number of sprites over a dawn', () => {
    const w = new World(4242);
    const cache = new M.ground.GroundCache();
    const ctx = mockContext();
    const before = mockStats.canvases;
    const b = { x0: 0, y0: 0, x1: 3, y1: 3 };
    const view = { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };
    for (let k = 0; k < 1200; k++) cache.drawAnimated(ctx, w, b, { time: k / 60, night: 0.9 - k * 0.000611 + 1e-7 * Math.sqrt(k), zoom: 1, quality: 'high' }, view);
    expect(mockStats.canvases - before).toBeLessThanOrEqual(40);
  });
});

describe('render-2: a still frame after the camera moves', () => {
  it('Renderer.render re-reads the world transform even when the time has not moved (the still title)', () => {
    const g = fixtureGame();
    const ctx = mockContext(390, 844);
    const cam = new M.camera.Camera(g.world.N);
    const r = new M.renderer.Renderer(ctx.canvas as unknown as HTMLCanvasElement, g, cam);
    // The still title: every frame at one time.
    for (let k = 0; k < 3; k++) r.render(0, 5);
    // A rotation or reframe moves the camera; the title draws again at the same time.
    cam.x -= 200;
    cam.y += 90;
    r.render(0, 5);
    // A port (transport) building restores the cached frame transform after its live parts: it must
    // be the camera's current one, not the one from before the move.
    const port = [...g.world.buildings.values()].find((b) => b.type === 'seaport')!;
    const z = cam.zoom;
    const world = { a: z, e: 390 / 2 - cam.x * z, f: 844 / 2 - cam.y * z };
    ctx.setTransform(world.a, 0, 0, world.a, world.e, world.f);
    M.buildings.drawServiceBuilding(ctx, (port.x - port.y) * HW, (port.x + port.y) * HH, port, { time: 5, night: 0, zoom: z, quality: 'low' });
    const t = ctx.getTransform();
    expect(t.a).toBeCloseTo(world.a, 6);
    expect(t.e).toBeCloseTo(world.e, 6);
    expect(t.f).toBeCloseTo(world.f, 6);
    r.destroy();
  });
});

describe('render-3: Wealth lens pips follow the sim step rule (hysteresis band shows none)', () => {
  it('a $$$ block in the band holds (no ▼); below the down threshold it slips; a lift shows ▲', () => {
    const w = new World(77);
    const proto = Object.getPrototypeOf(mockContext()) as Record<string, unknown>;
    proto.createImageData ??= (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch });
    const set = (x: number, y: number, tier: 0 | 1 | 2, score: number) => {
      const i = w.idx(x, y);
      const t = w.tiles[i];
      t.terrain = 0;
      t.zone = ZoneType.Residential;
      t.level = 2;
      t.wealth = tier;
      t.abandoned = false;
      w.fields.wealth[i] = score;
      w.fields.crime[i] = 0;
      w.fields.noise[i] = 0;
      w.fields.pollution[i] = 0;
      w.fields.alleyNear[i] = 0;
      return i;
    };
    const [d0, d1] = WEALTH.down;
    const [u0, u1] = WEALTH.up;
    const band3 = set(10, 10, 2, (d1 + u1) / 2); // $$$ inside [down, up): holds
    const band2 = set(11, 10, 1, (d0 + u0) / 2); // $$ inside its band: holds
    const slip = set(12, 10, 2, d1 - 0.03); // $$$ below its down threshold: steps down
    const lift = set(13, 10, 1, u1 + 0.03); // $$ above the next up threshold: steps up
    const layer = new M.overlay.OverlayLayer();
    layer.draw(mockContext(), w, 'wealth', 1, { x0: 0, y0: 0, x1: N - 1, y1: N - 1 }, 1);
    const pips = (layer as unknown as { pips: Int8Array }).pips;
    expect(pips[band3]).toBe(0);
    expect(pips[band2]).toBe(0);
    expect(pips[slip]).toBe(-1);
    expect(pips[lift]).toBe(1);
  });
});

describe('render-4: an E or S Seaport keeps its ship on screen while the port itself is culled', () => {
  /** A live seaport whose quay faces `face` on a generated map's shore, or null. */
  function seaportFacing(face: number): { w: World; b: Building } | null {
    for (let seed = 1; seed <= 60; seed++) {
      const w = World.generate(seed * 7919);
      const marks = new Uint8Array(N * N);
      if (shoreSites(w, marks) === 0) continue;
      for (let i = 0; i < N * N; i++) {
        if (!marks[i]) continue;
        const x = i % N;
        const y = Math.floor(i / N);
        if (shoreFacing(w, x, y, 4) !== face) continue;
        const b = w.addBuilding('seaport', x, y)!;
        b.facing = face as 0 | 1 | 2 | 3;
        b.powered = true;
        const fx = new M.ports.PortFx();
        fx.update(0.01, 1, w);
        if (fx.shipStart(b.id) < 5) {
          w.removeBuilding(b.id);
          continue;
        }
        return { w, b };
      }
    }
    return null;
  }

  for (const face of [1, 2]) {
    it(`face ${face}: every hull point over a whole cycle lies inside the port's culling box`, () => {
      const sw = seaportFacing(face);
      expect(sw).not.toBeNull();
      const { w, b } = sw!;
      const fx = new M.ports.PortFx();
      fx.update(0.01, 1, w);
      const wx = (b.x - b.y) * HW;
      const wy = (b.x + b.y) * HH;
      const z = b.size;
      const [rl, rr, rd] = M.ports.shipReach(b);
      let outside = 0;
      let beyondFootprint = 0;
      for (let t = 0; t < SEAPORT.shipCycleSec; t += 0.5) {
        fx.update(0.5, 1, w);
        const pose = fx.shipOf(b.id);
        if (!pose) continue;
        const pts = M.ports.shipHullPoints(pose);
        for (let k = 0; k < pts.length; k += 2) {
          const sx = (pts[k] - pts[k + 1]) * HW;
          const sy = (pts[k] + pts[k + 1]) * HH;
          if (sx < wx - z * HW - rl || sx > wx + z * HW + rr || sy > wy + 2 * z * HH + rd) outside++;
          if (sx < wx - z * HW || sx > wx + z * HW || sy > wy + 2 * z * HH) beyondFootprint++;
        }
      }
      // The ship really does leave the footprint box (the bug), and the widened box holds it.
      expect(beyondFootprint).toBeGreaterThan(0);
      expect(outside).toBe(0);
    });

    it(`face ${face}: the renderer draws the port while only its ship far out on the water is on screen`, () => {
      const sw = seaportFacing(face);
      const { w, b } = sw!;
      const fx = new M.ports.PortFx();
      fx.update(0.01, 1, w);
      fx.update(3, 1, w); // early in the approach: the ship is far out
      const pose = fx.shipOf(b.id)!;
      expect(pose).not.toBeNull();
      const sx = (pose.x - pose.y) * HW;
      const sy = (pose.x + pose.y) * HH;
      // A phone-sized view around the ship only (the port's own footprint box is off screen).
      const view = { x0: sx - 120, y0: sy - 200, x1: sx + 120, y1: sy + 200 };
      const wx = (b.x - b.y) * HW;
      const wy = (b.x + b.y) * HH;
      const footprintOff = wx + b.size * HW < view.x0 - HW || wx - b.size * HW > view.x1 + HW || wy + 2 * b.size * HH < view.y0;
      expect(footprintOff).toBe(true);
      expect(M.renderer.buildingInView(b, view.x0 - HW, view.x1 + HW, view)).toBe(true);
      // Far away from both, it is still culled.
      const away = { x0: sx + 5000, y0: sy + 5000, x1: sx + 5240, y1: sy + 5400 };
      expect(M.renderer.buildingInView(b, away.x0 - HW, away.x1 + HW, away)).toBe(false);
    });
  }

  it('N and W quays, and every other building, add no reach (their ships draw in the ground pass)', () => {
    expect(M.ports.shipReach({ type: 'seaport', facing: 0 })).toEqual([0, 0, 0]);
    expect(M.ports.shipReach({ type: 'seaport', facing: 3 })).toEqual([0, 0, 0]);
    expect(M.ports.shipReach({ type: 'airport' })).toEqual([0, 0, 0]);
  });
});

describe('render-5: the rocket in flight keeps its floodlit colour at night', () => {
  it('the body is painted pale (the parked sprite material), not the dark night ship-bridge white', () => {
    const w = flatWorld(31, 'Pad');
    const pad = w.addBuilding('spaceport', 20, 20)!;
    pad.buildDays = 0;
    pad.waitSec = 0;
    pad.powered = true;
    const fx = new M.ports.PortFx();
    fx.update(0.01, 1, w);
    fx.liftoff(w, pad.id, true);
    fx.update(3, 1, w); // in the climb (1.5 s ≤ t < 8.5 s)
    const ctx = mockContext(900, 900);
    const bodies: string[] = [];
    const rect = ctx.fillRect.bind(ctx);
    (ctx as unknown as { fillRect: (...a: number[]) => void }).fillRect = (x: number, y: number, rw: number, rh: number) => {
      if (rh === M.ports.ROCKET_H - 34) bodies.push(String(ctx.fillStyle));
      rect(x, y, rw, rh);
    };
    fx.drawSky(ctx, { night: 1, zoom: 1, quality: 'high' });
    expect(bodies.length).toBe(2);
    for (const c of bodies) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
      expect(m, c).not.toBeNull();
      const lum = (Number(m![1]) + Number(m![2]) + Number(m![3])) / 3;
      expect(lum, c).toBeGreaterThan(110);
    }
  });
});

describe('render-6: the deck highlight and the sky bulldoze preview follow a ramp', () => {
  /** A Canvas stand-in that tracks the full affine transform and records path points in world px. */
  class TrackCtx {
    m = [1, 0, 0, 1, 0, 0];
    stack: number[][] = [];
    pts: [number, number][] = [];
    fills: [number, number][][] = [];
    globalAlpha = 1;
    globalCompositeOperation = 'source-over';
    fillStyle: unknown = '';
    strokeStyle: unknown = '';
    lineWidth = 1;
    lineJoin = 'miter';
    lineCap = 'butt';
    private map(x: number, y: number): [number, number] {
      const [a, b, c, d, e, f] = this.m;
      return [a * x + c * y + e, b * x + d * y + f];
    }
    save() {
      this.stack.push([...this.m]);
    }
    restore() {
      this.m = this.stack.pop() ?? this.m;
    }
    getTransform() {
      const [a, b, c, d, e, f] = this.m;
      return { a, b, c, d, e, f };
    }
    setTransform(a: number | { a: number; b: number; c: number; d: number; e: number; f: number }, b = 0, c = 0, d = 1, e = 0, f = 0) {
      this.m = typeof a === 'object' ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f];
    }
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      const [A, B, C, D, E, F] = this.m;
      this.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
    }
    translate(x: number, y: number) {
      this.transform(1, 0, 0, 1, x, y);
    }
    beginPath() {
      this.pts = [];
    }
    moveTo(x: number, y: number) {
      this.pts.push(this.map(x, y));
    }
    lineTo(x: number, y: number) {
      this.pts.push(this.map(x, y));
    }
    arc(x: number, y: number) {
      this.pts.push(this.map(x, y));
    }
    rect(x: number, y: number, w: number, h: number) {
      this.pts.push(this.map(x, y), this.map(x + w, y), this.map(x + w, y + h), this.map(x, y + h));
    }
    closePath() {}
    fill() {
      this.fills.push([...this.pts]);
    }
    stroke() {}
    createLinearGradient() {
      return { addColorStop() {} };
    }
  }

  /** A ramp tile of the fixture's skyways (one link, SKY_RAMP set). */
  function rampTile(g: InstanceType<Mods['Game']>): { x: number; y: number } {
    const sky = g.world.sky;
    for (let i = 0; i < N * N; i++) {
      const bits = sky[i];
      if (!(bits & SKY_RAMP)) continue;
      const m = bits & 15;
      if (m === 1 || m === 2 || m === 4 || m === 8) return { x: i % N, y: Math.floor(i / N) };
    }
    throw new Error('no ramp in the fixture');
  }

  /** Height above the ground (world px) of the outline's centre over tile (x, y). */
  const centreZ = (pts: [number, number][], x: number, y: number) => {
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return (x + y) * HH + HH - cy;
  };

  it('the selected ramp is outlined on its incline (centre at most halfway up), not flat at SKY_Z', () => {
    const g = fixtureGame();
    const r = rampTile(g);
    g.select({ x: r.x, y: r.y, sky: true });
    const ctx = new TrackCtx();
    M.overlay.drawSelectionTop(ctx as unknown as CanvasRenderingContext2D, g, 1, 1);
    expect(ctx.fills.length).toBeGreaterThan(0);
    const z = centreZ(ctx.fills[0], r.x, r.y);
    // A one-tile ramp centres at 29 px, the lower half of a two-tile ramp at 18 px; flat decks sit at SKY_Z (52).
    expect(z).toBeGreaterThan(14);
    expect(z).toBeLessThan(SKYWAY.z - 18);
  });

  it('the sky bulldoze preview lights the ramp on its incline too', async () => {
    const { planAction } = await import('../src/game/actions');
    const g = fixtureGame();
    const r = rampTile(g);
    const plan = planAction(g.world, 'bulldoze', r, r);
    expect(plan.layer).toBe('sky');
    g.setPreview(plan);
    const ctx = new TrackCtx();
    M.overlay.drawPreviewTop(ctx as unknown as CanvasRenderingContext2D, g, { time: 1, night: 0, zoom: 1, quality: 'high' });
    const lit = ctx.fills.filter((f) => f.length > 0);
    expect(lit.length).toBeGreaterThan(0);
    const z = centreZ(lit[lit.length - 1], r.x, r.y);
    expect(z).toBeGreaterThan(14);
    expect(z).toBeLessThan(SKYWAY.z - 18);
  });
});
