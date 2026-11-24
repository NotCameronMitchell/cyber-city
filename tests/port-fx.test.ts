// WP-4 (EXPANSION §5.1–§5.3, §11): port FX. Ships never cross land, bridges or rail; ships and
// planes run on the visual clock (dt × game.clockRate) and freeze while paused; the first ship
// or plane starts when its port opens; a launch plays only when Game emits 'liftoff', runs 14
// unpaused real seconds and empties the pad sprite meanwhile.
import { beforeAll, describe, expect, it } from 'vitest';
import { AIRPORT, BUILDINGS, SEAPORT, SPACEPORT } from '../src/game/config';
import { Game } from '../src/game/game';
import { shoreFacing, shoreSites } from '../src/game/ports';
import { MAP_SIZE, Terrain, type Building } from '../src/game/types';
import { World } from '../src/game/world';
import { flatWorld } from './helpers';
import { installCanvasMock, mockContext, mockStats, resetMockStats } from './canvas-mock';

installCanvasMock();
type Ports = typeof import('../src/render/art/ports');
let P: Ports;
beforeAll(async () => {
  P = await import('../src/render/art/ports');
});

const N = MAP_SIZE;
const openWater = (w: World, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const t = w.tiles[y * N + x];
  return t.terrain === Terrain.Water && !t.road && w.rail[y * N + x] === 0;
};

/** A live seaport on a generated map's shore site (k-th valid site), or null. */
function seaportWorld(seed: number, k = 0): { w: World; b: Building } | null {
  const w = World.generate(seed);
  const marks = new Uint8Array(N * N);
  if (shoreSites(w, marks) === 0) return null;
  let n = 0;
  for (let i = 0; i < N * N; i++) {
    if (!marks[i] || n++ < k) continue;
    const x = i % N;
    const y = Math.floor(i / N);
    const b = w.addBuilding('seaport', x, y)!;
    b.facing = shoreFacing(w, x, y, 4) as 0 | 1 | 2 | 3;
    b.powered = true;
    return { w, b };
  }
  return null;
}

/** Every hull sample point of the current pose is over open water. */
function hullOnWater(w: World, fx: InstanceType<Ports['PortFx']>, id: number): boolean {
  const pose = fx.shipOf(id);
  if (!pose) return true;
  const pts = P.shipHullPoints(pose);
  for (let i = 0; i < pts.length; i += 2) if (!openWater(w, Math.floor(pts[i]), Math.floor(pts[i + 1]))) return false;
  return true;
}

describe('ships (§5.1)', () => {
  it('never cross land, bridges or rail over whole cycles on 12 generated maps', () => {
    let ships = 0;
    for (let s = 1; s <= 12; s++) {
      for (const k of [0, 7, 19]) {
        const sw = seaportWorld(s * 7919, k);
        if (!sw) continue;
        const { w, b } = sw;
        const fx = new P.PortFx();
        fx.update(0.01, 1, w);
        if (fx.shipStart(b.id) < P.MOOR_D) continue;
        ships++;
        for (let t = 0; t < SEAPORT.shipCycleSec * 1.5; t += 0.2) {
          fx.update(0.2, 1, w);
          expect(hullOnWater(w, fx, b.id), `seed ${s} site ${k} t ${t.toFixed(1)}`).toBe(true);
        }
      }
    }
    expect(ships).toBeGreaterThan(10);
  });

  it('a bridge across the approach shortens it, and the hull still never touches the deck', () => {
    for (let s = 1; s <= 30; s++) {
      const sw = seaportWorld(s * 104729);
      if (!sw) continue;
      const { w, b } = sw;
      const fx = new P.PortFx();
      fx.update(0.01, 1, w);
      const far = fx.shipStart(b.id);
      if (far < 5) continue;
      // Lay a bridge (road on water) across the approach, 4 tiles out from the quay.
      const [ox, oy] = [b.facing === 1 ? 1 : b.facing === 3 ? -1 : 0, b.facing === 2 ? 1 : b.facing === 0 ? -1 : 0];
      const cx = b.x + 2 + ox * 5.5;
      const cy = b.y + 2 + oy * 5.5;
      for (let k = -3; k <= 3; k++) {
        const x = Math.floor(cx + (oy !== 0 ? k : 0));
        const y = Math.floor(cy + (ox !== 0 ? k : 0));
        if (w.tiles[y * N + x]?.terrain === Terrain.Water) w.setRoad(x, y);
      }
      fx.invalidate();
      fx.update(0.01, 1, w);
      expect(fx.shipStart(b.id)).toBeLessThan(far);
      for (let t = 0; t < SEAPORT.shipCycleSec; t += 0.25) {
        fx.update(0.25, 1, w);
        expect(hullOnWater(w, fx, b.id)).toBe(true);
      }
      return;
    }
    throw new Error('no seed with a long approach');
  });

  it('the first ship starts its approach when the port opens; cycles scale with the clock rate and freeze while paused', () => {
    const sw = seaportWorld(7919 * 3)!;
    const { w, b } = sw;
    b.powered = false;
    const fx = new P.PortFx();
    fx.update(1, 1, w);
    expect(fx.shipTime(b.id)).toBeNull();
    b.powered = true;
    fx.update(0.1, 1, w);
    expect(fx.shipTime(b.id)).toBe(0);
    fx.update(2, 1, w);
    expect(fx.shipTime(b.id)).toBeCloseTo(2, 6);
    fx.update(2, 2.4, w);
    expect(fx.shipTime(b.id)).toBeCloseTo(6.8, 6);
    fx.update(5, 0, w);
    expect(fx.shipTime(b.id)).toBeCloseTo(6.8, 6);
    // Moored in the middle of the cycle, then gone after it ends if the port shut.
    fx.update(40 - 6.8, 1, w);
    expect(fx.shipOf(b.id)?.moored).toBe(true);
    b.offline = 30;
    fx.update(SEAPORT.shipCycleSec, 1, w);
    expect(fx.shipTime(b.id)).toBeNull();
  });
});

describe('planes (§5.2)', () => {
  function airportWorld() {
    const w = flatWorld(77, 'Air');
    const b = w.addBuilding('airport', 20, 20)!;
    b.powered = true;
    return { w, b };
  }

  it('land at opening, follow the 36 clock-second cycle and pause with the sim', () => {
    const { w, b } = airportWorld();
    const fx = new P.PortFx();
    fx.update(0.016, 1, w);
    expect(fx.planeTime(b.id)).toBe(0);
    const p0 = fx.planeOf(b.id)!;
    expect(p0.z).toBeGreaterThan(150);
    expect(p0.x).toBeCloseTo(b.x + P.TOUCH_U - 14, 5);
    // Paused: nothing moves however long the frame loop runs.
    for (let i = 0; i < 100; i++) fx.update(0.1, 0, w);
    expect(fx.planeTime(b.id)).toBe(0);
    // Touchdown at 9 clock-seconds: ×1.6 → 5.625 real seconds.
    for (let i = 0; i < 225; i++) fx.update(0.025, 1.6, w);
    const td = fx.planeOf(b.id)!;
    expect(td.z).toBeCloseTo(0, 5);
    expect(td.x).toBeCloseTo(b.x + P.TOUCH_U, 3);
    expect(td.y).toBeCloseTo(b.y + P.RUNWAY_V, 6);
    // At the gate (14..22) the plane is hidden, then it takes off and climbs out to z ≈ 220.
    fx.update(18 - 9, 1, w);
    expect(fx.planeOf(b.id)).toBeNull();
    fx.update(35.9 - 18, 1, w);
    const up = fx.planeOf(b.id)!;
    expect(up.z).toBeGreaterThan(200);
    expect(up.x).toBeGreaterThan(b.x + 6);
    fx.update(0.2, 1, w);
    expect(fx.planeTime(b.id)!).toBeLessThan(1);
    expect(AIRPORT.planeCycleSec).toBe(36);
  });

  it('the plane path keeps the runway centre line while on the ground', () => {
    const out = { x: 0, y: 0, z: 0, hx: 1, hy: 0, alpha: 1, t: 0 };
    for (let t = P.planePose(0, 0, 0, out) ? 9 : 9; t < 13; t += 0.25) {
      const p = P.planePose(10, 10, t, out)!;
      expect(p.z).toBe(0);
      expect(p.y).toBe(10 + P.RUNWAY_V);
      expect(p.x).toBeGreaterThanOrEqual(10 + P.TOUCH_U - 1e-9);
      expect(p.x).toBeLessThanOrEqual(10 + P.ROLL_U + 1e-9);
    }
  });
});

describe('launches (§5.3)', () => {
  function spaceportGame() {
    const g = new Game();
    const w = flatWorld(31, 'Pad');
    w.funds = 1e7;
    expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
    const b = g.world.addBuilding('spaceport', 20, 20)!;
    b.buildDays = 0;
    b.waitSec = 0;
    b.powered = true;
    return { g, b };
  }

  it('play only when Game emits liftoff, for 14 unpaused real seconds, and freeze while paused', async () => {
    const { Effects } = await import('../src/render/effects');
    const { g, b } = spaceportGame();
    const fx = new Effects(g);
    g.setSpeed(1);
    // No liftoff, no launch, however long the frames run (the game itself is not updated).
    for (let i = 0; i < 600; i++) fx.update(0.1);
    expect(fx.ports.launching).toBe(0);
    expect(P.portVariant(b)).toBe(P.SPACE_COMPLETE);
    g.events.emit('liftoff', { id: b.id, first: true });
    expect(fx.ports.launchTime(b.id)).toBe(0);
    expect(P.portVariant(b)).toBe(P.SPACE_EMPTY_PAD);
    // A cut-scene: not sped up at speed 3 ...
    g.setSpeed(3);
    for (let i = 0; i < 50; i++) fx.update(0.1);
    expect(fx.ports.launchTime(b.id)).toBeCloseTo(5, 6);
    // ... and frozen while paused.
    g.setSpeed(0);
    for (let i = 0; i < 50; i++) fx.update(0.1);
    expect(fx.ports.launchTime(b.id)).toBeCloseTo(5, 6);
    g.setSpeed(1);
    for (let i = 0; i < 91; i++) fx.update(0.1);
    expect(fx.ports.launching).toBe(0);
    // The pad stays empty a little longer, then the next rocket stands on it.
    expect(P.portVariant(b)).toBe(P.SPACE_EMPTY_PAD);
    for (let i = 0; i < 200; i++) fx.update(0.1);
    expect(P.portVariant(b)).toBe(P.SPACE_COMPLETE);
    expect(fx.ports.launchTime(b.id)).toBeNull();
    fx.destroy();
  });

  it('real launches come from Game: at night, ≥ launchGapSec apart, each one starts the FX', async () => {
    const { Effects } = await import('../src/render/effects');
    const { g, b } = spaceportGame();
    const fx = new Effects(g);
    g.settings.dayNight = false; // always night: a launch every launchGapSec
    g.setSpeed(1);
    let starts = 0;
    let wasRunning = false;
    for (let i = 0; i < 6000; i++) {
      g.update(0.1);
      b.powered = true; // no plant on this test map: keep the pad powered so its launch clock runs
      fx.update(0.1);
      const running = fx.ports.launching > 0;
      if (running && !wasRunning) starts++;
      wasRunning = running;
    }
    // 600 s: the first after the lead (10 s) once the half gap has passed, then every 180 s.
    expect(starts).toBeGreaterThanOrEqual(3);
    expect(starts).toBeLessThanOrEqual(4);
    expect(b.launches).toBe(starts);
    expect(SPACEPORT.launchGapSec).toBe(180);
    fx.destroy();
  });

  it('the world swap drops a launch in flight', async () => {
    const { Effects } = await import('../src/render/effects');
    const { g, b } = spaceportGame();
    const fx = new Effects(g);
    g.setSpeed(1);
    g.events.emit('liftoff', { id: b.id, first: false });
    fx.update(0.5);
    expect(fx.ports.launching).toBe(1);
    g.newCity('Fresh', 99);
    expect(fx.ports.launching).toBe(0);
    fx.destroy();
  });
});

describe('drawing', () => {
  it('ships, planes, launches and live parts draw cleanly by day and night, high and low quality', async () => {
    const { drawServiceBuilding } = await import('../src/render/buildings');
    const sw = seaportWorld(7919 * 5)!;
    const { w, b } = sw;
    const air = w.addBuilding('airport', 2, 2);
    const pad = w.addBuilding('spaceport', 2, 40);
    const fx = new P.PortFx();
    for (const x of [air, pad]) if (x) {
      x.powered = true;
      x.buildDays = 0;
    }
    fx.update(0.01, 1, w);
    if (pad) fx.liftoff(w, pad.id, true);
    const ctx = mockContext(900, 900);
    for (let step = 0; step < 80; step++) {
      fx.update(1, 1, w);
      for (const night of [0, 1])
        for (const quality of ['high', 'low'] as const) {
          resetMockStats();
          ctx.setTransform(0.5, 0, 0, 0.5, 450, 0);
          fx.drawGround(ctx, { night, zoom: 1, quality });
          fx.drawSky(ctx, { night, zoom: 1, quality });
          for (const x of [b, air, pad]) if (x) drawServiceBuilding(ctx, (x.x - x.y) * 32, (x.x + x.y) * 16, x, { time: step, night, zoom: 1, quality });
          expect(mockStats.errors, `step ${step} night ${night} ${quality}`).toEqual([]);
        }
    }
    expect(BUILDINGS.seaport.size).toBe(4);
  });
});
