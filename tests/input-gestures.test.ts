import { describe, expect, it } from 'vitest';
import {
  EDGE_MAX_SPEED,
  EDGE_ZONE,
  MIN_PINCH_SPREAD,
  VelocityTracker,
  capSpeed,
  centroidSpread,
  clampToolTile,
  edgeScrollVelocity,
  flingDisplacement,
  isTwoFingerTap,
  pickTile,
  pinchFactor,
  screenToTileInto,
  SKY_PICK_BASE,
  SKY_PICK_LOW,
  SKY_PICK_TOP,
  wheelDeltaPx,
  type FootprintLookup,
  type PickHit,
} from '../src/input/gestures';
import { SKYWAY } from '../src/game/config';
import { Camera, tileCenterWorld } from '../src/render/camera';

function camera(w = 390, h = 844, zoom = 1.3): Camera {
  const c = new Camera();
  c.setViewport(w, h);
  c.zoom = zoom;
  c.centerOnTile(20, 30);
  return c;
}

describe('screenToTileInto', () => {
  it('matches Camera.screenToTile everywhere', () => {
    const cam = camera();
    const out = { x: 0, y: 0 };
    for (let sx = -40; sx <= 430; sx += 7.3) {
      for (let sy = -40; sy <= 880; sy += 11.1) {
        const ref = cam.screenToTile(sx, sy);
        screenToTileInto(cam, sx, sy, out);
        expect(out).toEqual(ref);
      }
    }
  });

  it('round-trips a tile centre', () => {
    const cam = camera(800, 600, 0.7);
    const s = cam.tileToScreen(33, 12);
    expect(screenToTileInto(cam, s.x, s.y, { x: 0, y: 0 })).toEqual({ x: 33, y: 12 });
  });
});

describe('clampToolTile', () => {
  it('keeps single tiles on the map', () => {
    expect(clampToolTile({ x: -3, y: 70 }, 64)).toEqual({ x: 0, y: 63 });
  });
  it('keeps building footprints fully on the map', () => {
    // size 3 → origin offset 1: finger tile must be in 1..62
    expect(clampToolTile({ x: 0, y: 63 }, 64, 3)).toEqual({ x: 1, y: 62 });
    // size 2 → offset 0: finger tile in 0..62
    expect(clampToolTile({ x: -1, y: 63 }, 64, 2)).toEqual({ x: 0, y: 62 });
    // size 4 → offset 1: finger tile in 1..61
    expect(clampToolTile({ x: 0, y: 63 }, 64, 4)).toEqual({ x: 1, y: 61 });
  });
});

describe('centroidSpread / pinchFactor', () => {
  it('computes centroid and mean distance', () => {
    const c = centroidSpread([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 0, y: 0, spread: 0, count: 0 });
    expect(c).toEqual({ x: 50, y: 0, spread: 50, count: 2 });
  });
  it('handles empty and single points', () => {
    const out = { x: 9, y: 9, spread: 9, count: 9 };
    expect(centroidSpread([], out)).toEqual({ x: 0, y: 0, spread: 0, count: 0 });
    expect(centroidSpread([{ x: 3, y: 4 }], out)).toEqual({ x: 3, y: 4, spread: 0, count: 1 });
  });
  it('floors tiny spreads so the factor stays sane', () => {
    expect(pinchFactor(100, 200)).toBe(2);
    expect(pinchFactor(0, 1)).toBe(1);
    expect(pinchFactor(MIN_PINCH_SPREAD, MIN_PINCH_SPREAD * 3)).toBe(3);
  });
});

describe('isTwoFingerTap', () => {
  it('accepts a quick still tap', () => {
    expect(isTwoFingerTap(150, 2, 4, 0.97, 1.03)).toBe(true);
  });
  it('rejects slow, moving, pinching or 3-finger touches', () => {
    expect(isTwoFingerTap(500, 2, 4, 1, 1)).toBe(false);
    expect(isTwoFingerTap(150, 2, 40, 1, 1)).toBe(false);
    expect(isTwoFingerTap(150, 2, 4, 0.6, 1)).toBe(false);
    expect(isTwoFingerTap(150, 3, 4, 1, 1)).toBe(false);
  });
});

describe('VelocityTracker', () => {
  it('measures a steady swipe', () => {
    const vt = new VelocityTracker();
    for (let i = 0; i <= 10; i++) vt.add(i * 16, i * 16, -i * 8); // 1000 px/s, -500 px/s
    const v = vt.velocity(160, { x: 0, y: 0 });
    expect(v.x).toBeCloseTo(1000, 0);
    expect(v.y).toBeCloseTo(-500, 0);
  });
  it('only looks at the recent window', () => {
    const vt = new VelocityTracker();
    vt.add(0, 0, 0);
    vt.add(100, 1000, 0); // fast early
    for (let t = 200; t <= 400; t += 16) vt.add(t, 1000 + (t - 200) * 0.1, 0); // slow late (100 px/s)
    const v = vt.velocity(400, { x: 0, y: 0 });
    expect(v.x).toBeGreaterThan(80);
    expect(v.x).toBeLessThan(120);
  });
  it('is zero when the finger stopped before lifting', () => {
    const vt = new VelocityTracker();
    for (let i = 0; i <= 5; i++) vt.add(i * 16, i * 30, 0);
    expect(vt.velocity(80 + 200, { x: 1, y: 1 })).toEqual({ x: 0, y: 0 });
  });
  it('is zero with too few samples', () => {
    const vt = new VelocityTracker();
    vt.add(0, 0, 0);
    expect(vt.velocity(0, { x: 1, y: 1 })).toEqual({ x: 0, y: 0 });
    vt.reset();
    expect(vt.velocity(0, { x: 1, y: 1 })).toEqual({ x: 0, y: 0 });
  });
  it('survives ring-buffer wrap-around', () => {
    const vt = new VelocityTracker();
    for (let i = 0; i < 100; i++) vt.add(i * 10, i * 5, 0); // 500 px/s
    expect(vt.velocity(990, { x: 0, y: 0 }).x).toBeCloseTo(500, 0);
  });
});

describe('fling helpers', () => {
  it('caps speed preserving direction', () => {
    const v = { x: 3000, y: 4000 };
    expect(capSpeed(v, 1000)).toBe(1000);
    expect(v.x).toBeCloseTo(600);
    expect(v.y).toBeCloseTo(800);
  });
  it('integrates exponential decay frame-rate independently', () => {
    const one = flingDisplacement(1000, 3.6, 0.5);
    let v = 1000;
    let sum = 0;
    for (let i = 0; i < 30; i++) {
      sum += flingDisplacement(v, 3.6, 0.5 / 30);
      v *= Math.exp(-3.6 * (0.5 / 30));
    }
    expect(sum).toBeCloseTo(one, 6);
    // total travel converges to v / k
    expect(flingDisplacement(1000, 4, 100)).toBeCloseTo(250, 6);
  });
});

describe('edgeScrollVelocity', () => {
  const out = { x: 0, y: 0 };
  it('is zero in the interior', () => {
    expect(edgeScrollVelocity(200, 400, 390, 844, EDGE_ZONE, EDGE_MAX_SPEED, out)).toEqual({ x: 0, y: 0 });
  });
  it('points toward the nearest edges', () => {
    edgeScrollVelocity(2, 840, 390, 844, EDGE_ZONE, EDGE_MAX_SPEED, out);
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeGreaterThan(0);
  });
  it('ramps up toward the edge and saturates beyond it', () => {
    const a = edgeScrollVelocity(390 - 30, 400, 390, 844, EDGE_ZONE, EDGE_MAX_SPEED, { x: 0, y: 0 }).x;
    const b = edgeScrollVelocity(390 - 10, 400, 390, 844, EDGE_ZONE, EDGE_MAX_SPEED, { x: 0, y: 0 }).x;
    const c = edgeScrollVelocity(390 + 50, 400, 390, 844, EDGE_ZONE, EDGE_MAX_SPEED, { x: 0, y: 0 }).x;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBe(EDGE_MAX_SPEED);
  });
});

describe('wheelDeltaPx', () => {
  it('normalizes delta modes', () => {
    expect(wheelDeltaPx(100, 0, 800)).toBe(100);
    expect(wheelDeltaPx(3, 1, 800)).toBe(48);
    expect(wheelDeltaPx(1, 2, 800)).toBe(800);
  });
});

describe('pickTile (height-aware)', () => {
  /** Fractional ground coords of a screen point at zoom 1 with camera at origin. */
  function groundAt(wx: number, wy: number) {
    const a = wx / 32;
    const b = wy / 16;
    return { u: (b + a) / 2, v: (b - a) / 2 };
  }
  const world = (objs: { x: number; y: number; size: number; height: number }[]): FootprintLookup => (tx, ty, out) => {
    for (const o of objs) {
      if (tx >= o.x && tx < o.x + o.size && ty >= o.y && ty < o.y + o.size) {
        Object.assign(out, o);
        return true;
      }
    }
    return false;
  };

  it('falls back to the ground tile on an empty map', () => {
    const c = tileCenterWorld(8, 8);
    const g = groundAt(c.x, c.y);
    expect(pickTile(g.u, g.v, world([]), { x: 0, y: 0 })).toEqual({ x: 8, y: 8 });
  });

  it('picks a tall tower whose body covers the ground point behind it', () => {
    // Point 2 diagonal tiles behind (10,10) → 64 world px above its centre.
    const c = tileCenterWorld(10, 10);
    const g = groundAt(c.x, c.y - 64);
    expect([Math.floor(g.u), Math.floor(g.v)]).toEqual([8, 8]);
    expect(pickTile(g.u, g.v, world([{ x: 10, y: 10, size: 1, height: 100 }]), { x: 0, y: 0 })).toEqual({ x: 10, y: 10 });
    // A short building doesn't reach that high.
    expect(pickTile(g.u, g.v, world([{ x: 10, y: 10, size: 1, height: 40 }]), { x: 0, y: 0 })).toEqual({ x: 8, y: 8 });
  });

  it('prefers the front-most of overlapping objects', () => {
    const c = tileCenterWorld(10, 10);
    const g = groundAt(c.x, c.y - 64);
    const objs = [
      { x: 8, y: 8, size: 1, height: 200 },
      { x: 10, y: 10, size: 1, height: 100 },
    ];
    expect(pickTile(g.u, g.v, world(objs), { x: 0, y: 0 })).toEqual({ x: 10, y: 10 });
  });

  it('hits multi-tile buildings through any footprint tile', () => {
    const c = tileCenterWorld(21, 21); // front tile of a 2×2 at (20,20)
    const g = groundAt(c.x, c.y - 70);
    const p = pickTile(g.u, g.v, world([{ x: 20, y: 20, size: 2, height: 90 }]), { x: 0, y: 0 });
    expect(p.x >= 20 && p.x <= 21 && p.y >= 20 && p.y <= 21).toBe(true);
  });

  it('ignores objects off to the side', () => {
    const c = tileCenterWorld(10, 10);
    const g = groundAt(c.x + 90, c.y - 64); // well right of the tower's silhouette
    const p = pickTile(g.u, g.v, world([{ x: 10, y: 10, size: 1, height: 300 }]), { x: 0, y: 0 });
    expect(p).not.toEqual({ x: 10, y: 10 });
  });

  it('respects a silhouette base: nothing below it is hit', () => {
    const c = tileCenterWorld(10, 10);
    const slab = [{ x: 10, y: 10, size: 1, height: 56, base: 46 }];
    // The ground point of the tile itself is under the slab, not on it.
    const g0 = groundAt(c.x, c.y);
    expect(pickTile(g0.u, g0.v, world(slab), { x: 0, y: 0 })).toEqual({ x: 10, y: 10 }); // ground fallback, same tile
    const low = groundAt(c.x, c.y - 20);
    expect(pickTile(low.u, low.v, world(slab), { x: 0, y: 0 })).not.toEqual({ x: 10, y: 10 });
    const mid = groundAt(c.x, c.y - 51);
    expect(pickTile(mid.u, mid.v, world(slab), { x: 0, y: 0 })).toEqual({ x: 10, y: 10 });
  });
});

describe('pickTile with the skyway slab (EXPANSION §3.7)', () => {
  function groundAt(wx: number, wy: number) {
    const a = wx / 32;
    const b = wy / 16;
    return { u: (b + a) / 2, v: (b - a) / 2 };
  }
  type Obj = { x: number; y: number; size: number; height: number };
  /** Ground objects on layer 0, a deck slab over each `sky` tile on layer 1. */
  const scene = (objs: Obj[], sky: [number, number][]): FootprintLookup => (tx, ty, out, layer) => {
    if (layer === 1) {
      if (!sky.some(([x, y]) => x === tx && y === ty)) return false;
      Object.assign(out, { x: tx, y: ty, size: 1, height: SKY_PICK_TOP, base: SKY_PICK_BASE });
      return true;
    }
    for (const o of objs) {
      if (tx >= o.x && tx < o.x + o.size && ty >= o.y && ty < o.y + o.size) {
        Object.assign(out, o);
        return true;
      }
    }
    return false;
  };
  /** Where the deck over tile (x, y) is drawn on screen (zoom 1, camera at origin). */
  const deckAt = (x: number, y: number) => {
    const c = tileCenterWorld(x, y);
    return groundAt(c.x, c.y - SKYWAY.z);
  };
  const hit = (): PickHit => ({ x: 0, y: 0, sky: false });

  it('the slab sits where the deck is drawn (SKYWAY.z inside the pick range)', () => {
    expect(SKYWAY.z).toBeGreaterThanOrEqual(SKY_PICK_BASE);
    expect(SKYWAY.z).toBeLessThanOrEqual(SKY_PICK_TOP);
    expect(SKY_PICK_LOW).toBe(SKYWAY.z - 4);
  });

  it('a tap on the drawn deck selects the deck tile with sky: true, not the ground behind it', () => {
    const g = deckAt(20, 20);
    expect([Math.floor(g.u), Math.floor(g.v)]).not.toEqual([20, 20]); // the ground there is another tile
    expect(pickTile(g.u, g.v, scene([], [[20, 20]]), hit(), undefined, true)).toEqual({ x: 20, y: 20, sky: true });
  });

  it('a tap on the street under a deck still picks the ground', () => {
    const c = tileCenterWorld(20, 20);
    const g = groundAt(c.x, c.y);
    expect(pickTile(g.u, g.v, scene([], [[20, 20]]), hit(), undefined, true)).toEqual({ x: 20, y: 20, sky: false });
  });

  it('without sky picking the slab is never asked for (old callers unchanged)', () => {
    const g = deckAt(20, 20);
    const out = { x: 0, y: 0 };
    pickTile(g.u, g.v, scene([], [[20, 20]]), out);
    expect(out).toEqual({ x: Math.floor(g.u), y: Math.floor(g.v) });
  });

  it('a low building under or beside the deck draws first, so the deck wins', () => {
    const g = deckAt(20, 20);
    // A 2×2 plinth (low anchor) whose footprint holds the deck tile.
    const r = pickTile(g.u, g.v, scene([{ x: 19, y: 19, size: 2, height: 40 }], [[20, 20]]), hit(), undefined, true);
    expect(r).toEqual({ x: 20, y: 20, sky: true });
  });

  it('a tall tower in front of the deck hides it and keeps the tap', () => {
    const g = deckAt(20, 20);
    // A tower one tile in front whose body covers the deck on screen.
    const r = pickTile(g.u, g.v, scene([{ x: 21, y: 21, size: 1, height: 200 }], [[20, 20]]), hit(), undefined, true);
    expect(r).toEqual({ x: 21, y: 21, sky: false });
  });

  it('a tall tower behind the deck loses to it', () => {
    const g = deckAt(20, 20);
    // Behind (smaller depth) and tall enough to reach the point: the deck is drawn over it.
    const behind = { x: Math.floor(g.u) + 1, y: Math.floor(g.v) + 1, size: 1, height: 200 };
    expect(behind.x + behind.y).toBeLessThan(40);
    const r = pickTile(g.u, g.v, scene([behind], [[20, 20]]), hit(), undefined, true);
    expect(r).toEqual({ x: 20, y: 20, sky: true });
  });
});
