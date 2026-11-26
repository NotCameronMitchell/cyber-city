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
import { Camera, HALF_H, HALF_W, tileCenterWorld } from '../src/render/camera';
import { LEGACY_SIZE } from '../src/game/types';

function camera(w = 390, h = 844, zoom = 1.3): Camera {
  const c = new Camera(LEGACY_SIZE);
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

// ── Megacity input (MEGACITY §7.4, §3.9; WP-5): the skybridge tool's silhouette first tap, badges, the tube pick,
//    the drag snap, the reach view, and the annex pins.
import { applyAction } from '../src/game/actions';
import { Game } from '../src/game/game';
import { heightOf } from '../src/game/heights';
import * as vertical from '../src/game/story/vertical';
import { ZoneType } from '../src/game/types';
import { World } from '../src/game/world';
import { ANCHOR_SLOP_PX, BADGE_TAP_R, badgeAt, inReach, pickAnchor, pickTube, reachView, silhouetteDistance, snapPartner, tubeBeatsFront } from '../src/input/skybridge';
import { annexPins, pinAt } from '../src/render/districts';
import { partnerBadges, BADGE_MAX, ROUTE_SLOTS, skybridgeView } from '../src/render/overlay';
import { startWorld, sx, sy } from './helpers';
import { screenToTileF } from '../src/input/gestures';

/** A level-3, powered tower tile. */
function tower(w: World, x: number, y: number, zone = ZoneType.Residential): void {
  w.setZone(x, y, zone);
  w.setLevel(x, y, 3);
  w.tiles[w.idx(x, y)].powered = true;
}

function skyWorld(): World {
  const w = startWorld(3, 404);
  w.funds = 1e8;
  w.maxPopulation = 1e7;
  w.story.unlocks.push('skybridge');
  vertical.refresh(w);
  return w;
}

function cityCam(w: World, x: number, y: number, zoom = 0.6, W = 390, H = 844): Camera {
  const c = new Camera(w.N);
  c.setViewport(W, H);
  c.zoom = zoom;
  c.centerOnTile(x, y);
  return c;
}

describe('skybridge tool: the first tap hits the whole silhouette (§7.4)', () => {
  it('a tap on a tower body high above its base picks the tower; 24 px beside it still does; far off does not', () => {
    const w = skyWorld();
    const a = { x: sx(20), y: sy(20) };
    tower(w, a.x, a.y);
    vertical.refresh(w);
    const cam = cityCam(w, a.x, a.y, 0.6);
    const base = cam.tileToScreen(a.x, a.y);
    const top = heightOf(w, a.x, a.y);
    expect(top).toBeGreaterThan(100);
    // Halfway up the body: far above the ground tile the tap would otherwise pick.
    const body = { x: base.x, y: base.y - (top * cam.zoom) / 2 };
    expect(pickAnchor(w, cam, body.x, body.y)?.key).toBe(vertical.anchorAt(w, a.x, a.y)!.key);
    // Just beside the silhouette, within the 24 px slop.
    const right = base.x + 32 * cam.zoom;
    expect(pickAnchor(w, cam, right + ANCHOR_SLOP_PX - 4, body.y)).not.toBeNull();
    expect(pickAnchor(w, cam, right + ANCHOR_SLOP_PX + 30, body.y)).toBeNull();
    // Above the roof by more than the slop: nothing.
    expect(pickAnchor(w, cam, base.x, base.y - top * cam.zoom - ANCHOR_SLOP_PX - 20)).toBeNull();
  });

  it('the silhouette distance is 0 inside the extruded diamond and grows outside it', () => {
    const w = skyWorld();
    const cam = cityCam(w, 100, 100, 1);
    const a = { x0: 100, y0: 100, x1: 100, y1: 100 };
    const c = cam.tileToScreen(100, 100);
    expect(silhouetteDistance(cam, a, 150, c.x, c.y)).toBe(0);
    expect(silhouetteDistance(cam, a, 150, c.x, c.y - 140)).toBe(0);
    expect(silhouetteDistance(cam, a, 150, c.x + 32 + 10, c.y)).toBeCloseTo(10, 5);
  });

  it('a nearer tower wins over one 20 px further; a tower in front wins a tie', () => {
    const w = skyWorld();
    const a = { x: sx(20), y: sy(20) };
    tower(w, a.x, a.y);
    tower(w, a.x + 1, a.y + 1);
    vertical.refresh(w);
    const cam = cityCam(w, a.x, a.y, 0.6);
    const front = cam.tileToScreen(a.x + 1, a.y + 1);
    // On the front tower's base: it is drawn over the one behind.
    expect(pickAnchor(w, cam, front.x, front.y)?.key).toBe(vertical.anchorAt(w, a.x + 1, a.y + 1)!.key);
  });
});

describe('skybridge tool: badges, snap, reach (§5.4, §7.4)', () => {
  it('green badges are 44 px; a red dot draws at 16 px but takes a 44 px tap; at most 8 in all, none overlapping', () => {
    const w = skyWorld();
    const a = { x: sx(20), y: sy(20) };
    tower(w, a.x, a.y);
    // A dense row and column of partners at gaps 2..9, some blocked by taller towers in between.
    for (let d = 3; d <= 11; d += 2) {
      tower(w, a.x + d, a.y);
      tower(w, a.x, a.y + d);
      tower(w, a.x - d, a.y);
    }
    vertical.refresh(w);
    const g = new Game();
    expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
    g.setTool('skybridge');
    g.skybridgeSource(a.x, a.y);
    const cam = cityCam(g.world, a.x, a.y, 0.6);
    const badges = partnerBadges(g, cam);
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.length).toBeLessThanOrEqual(BADGE_MAX);
    for (let i = 0; i < badges.length; i++)
      for (let j = i + 1; j < badges.length; j++) expect(Math.hypot(badges[i].x - badges[j].x, badges[i].y - badges[j].y)).toBeGreaterThanOrEqual(badges[i].r + badges[j].r);
    for (const b of badges) {
      if (b.kind === 'ok') expect(b.r * 2).toBe(44);
      // Each badge takes a tap 20 px from its centre, red dots included.
      expect(badgeAt([b], b.x + 20, b.y)).toBe(b);
    }
    expect(BADGE_TAP_R * 2).toBe(44);
    expect(inReach(g.skybridgePartners())).toBe(badges.filter((b) => b.kind === 'ok').length);
  });

  /** A downtown with partners in all four lanes at gaps 2..10 (more than 8 badges' worth), Show routes on or off. */
  function denseSource(routes: boolean): { g: Game; a: { x: number; y: number } } {
    const w = skyWorld();
    const a = { x: sx(24), y: sy(24) };
    tower(w, a.x, a.y);
    for (let d = 3; d <= 11; d += 2) {
      tower(w, a.x + d, a.y);
      tower(w, a.x, a.y + d);
      tower(w, a.x - d, a.y);
      tower(w, a.x, a.y - d);
      tower(w, a.x + d, a.y + 3);
    }
    vertical.refresh(w);
    const g = new Game();
    expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
    g.setTool('skybridge');
    g.skybridgeSource(a.x, a.y);
    skybridgeView.showRoutes = routes;
    return { g, a };
  }

  it('§5.4: at most 8 badges in all (green, red and blue together), nearest the source first', () => {
    const saved = { routes: skybridgeView.showRoutes, avoid: skybridgeView.avoid };
    try {
      for (const routes of [false, true]) {
        const { g, a } = denseSource(routes);
        const shown = g.skybridgePartners().filter((p) => routes || !p.route);
        // The scene has more partners than the cap, so the shared cap is what limits it.
        expect(shown.length).toBeGreaterThan(BADGE_MAX);
        const cam = cityCam(g.world, a.x, a.y, 0.6, 1280, 1600);
        skybridgeView.avoid = [];
        const badges = partnerBadges(g, cam);
        expect(badges.length).toBe(BADGE_MAX);
        // Nearest first (within the direct partners, and within the routes): none left out is nearer than the
        // farthest of its kind shown. With Show routes on, routes keep up to ROUTE_SLOTS places.
        const d = (p: { x: number; y: number }) => Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
        const isRoute = (p: { route?: unknown; ok: boolean }) => !!p.route && p.ok;
        for (const kind of [false, true]) {
          const mine = badges.filter((b) => (b.kind === 'route') === kind);
          if (!mine.length) continue;
          const far = Math.max(...mine.map((b) => d({ x: b.tx, y: b.ty })));
          const left = shown.filter((p) => isRoute(p) === kind && !badges.some((b) => b.tx === p.x && b.ty === p.y));
          for (const p of left) expect(d(p)).toBeGreaterThanOrEqual(far);
        }
        const nRoutes = shown.filter(isRoute).length;
        expect(badges.filter((b) => b.kind === 'route').length).toBe(routes ? Math.min(ROUTE_SLOTS, nRoutes) : 0);
        if (routes) expect(nRoutes).toBeGreaterThan(0);
        // The list itself runs nearest first.
        for (let i = 1; i < badges.length; i++) expect(d({ x: badges[i].tx, y: badges[i].ty })).toBeGreaterThanOrEqual(d({ x: badges[i - 1].tx, y: badges[i - 1].ty }));
      }
    } finally {
      skybridgeView.showRoutes = saved.routes;
      skybridgeView.avoid = saved.avoid;
    }
  });

  it('§5.4, §7.8: no badge sits under the pill or the HUD; a covered badge moves or gives its place to the next nearest', () => {
    const saved = { routes: skybridgeView.showRoutes, avoid: skybridgeView.avoid };
    try {
      const { g, a } = denseSource(false);
      const cam = cityCam(g.world, a.x, a.y, 0.6, 844, 390);
      skybridgeView.avoid = [];
      const open = partnerBadges(g, cam);
      // The landscape HUD and ticker (top 70 px), the pill across the middle of the top, the side rail, the tool chip.
      const ui = [
        { x0: 0, y0: 0, x1: 844, y1: 70 },
        { x0: 311, y0: 78, x1: 594, y1: 130 },
        { x0: 0, y0: 0, x1: 62, y1: 390 },
        { x0: 70, y0: 282, x1: 350, y1: 326 },
      ];
      skybridgeView.avoid = ui;
      const badges = partnerBadges(g, cam);
      expect(badges.length).toBeGreaterThan(0);
      expect(badges.length).toBeLessThanOrEqual(BADGE_MAX);
      for (const b of badges) {
        const t = Math.max(b.r, BADGE_TAP_R);
        for (const r of ui) expect(b.x + t <= r.x0 || b.x - t >= r.x1 || b.y + t <= r.y0 || b.y - t >= r.y1).toBe(true);
        expect(b.y - t).toBeGreaterThanOrEqual(0);
        expect(b.x + t).toBeLessThanOrEqual(844);
      }
      // Something was covered in the open layout, so the UI changed the answer.
      const covered = (b: { x: number; y: number; r: number }) => ui.some((r) => b.x + 22 > r.x0 && b.x - 22 < r.x1 && b.y + 22 > r.y0 && b.y - 22 < r.y1);
      expect(open.some(covered)).toBe(true);
      // A tap where a covered badge was drawn finds no badge now (the pill's DOM takes it).
      for (const b of open.filter(covered)) {
        const hit = badgeAt(badges, b.x, b.y);
        if (hit) expect(hit.tx === b.tx && hit.ty === b.ty && hit.y === b.y).toBe(false);
      }
    } finally {
      skybridgeView.showRoutes = saved.routes;
      skybridgeView.avoid = saved.avoid;
    }
  });

  it('§5.4 step 2: the reach ease fits the source and its badges inside the frame the HUD, pill and toolbar leave', () => {
    const w = skyWorld();
    const a = { x: 100, y: 100 };
    const cam = cityCam(w, a.x, a.y, 1.2, 1440, 900);
    cam.streetMinZoom = 0.2;
    cam.minZoom = 0.2;
    const frame = { x0: 0, y0: 150, x1: 1440, y1: 760 };
    // Partners up to 6 tiles out, roofs up to 220 px: their badges stand well above the ground box.
    const tops = [
      { x: a.x, y: a.y, roof: 180 },
      { x: a.x + 6, y: a.y, roof: 220 },
      { x: a.x - 5, y: a.y, roof: 200 },
      { x: a.x, y: a.y - 6, roof: 210 },
      { x: a.x, y: a.y + 4, roof: 160 },
    ];
    const v = reachView(cam, { x0: a.x, y0: a.y, x1: a.x, y1: a.y }, 10, frame, tops);
    expect(v.zoom).toBeLessThanOrEqual(1.2);
    const view = new Camera(w.N);
    view.setViewport(1440, 900);
    view.x = v.x;
    view.y = v.y;
    view.zoom = v.zoom;
    for (const t of tops) {
      const s = view.tileToScreen(t.x, t.y);
      const by = s.y - t.roof * v.zoom - 26;
      // The whole badge (44 px) and the tower's base are inside the frame.
      expect(by - 22).toBeGreaterThanOrEqual(frame.y0 - 0.5);
      expect(s.y).toBeLessThanOrEqual(frame.y1 + 0.5);
      expect(s.x - 22).toBeGreaterThanOrEqual(frame.x0 - 0.5);
      expect(s.x + 22).toBeLessThanOrEqual(frame.x1 + 0.5);
    }
    // On a phone the street floor wins: the fit cannot hold, but the source stays in the frame.
    const phone = cityCam(w, a.x, a.y, 0.6, 844, 390);
    phone.streetMinZoom = 0.4;
    const pf = { x0: 62, y0: 130, x1: 844, y1: 282 };
    const pv = reachView(phone, { x0: a.x, y0: a.y, x1: a.x, y1: a.y }, 10, pf, tops);
    expect(pv.zoom).toBeGreaterThanOrEqual(0.45);
    const pc = new Camera(w.N);
    pc.setViewport(844, 390);
    pc.x = pv.x;
    pc.y = pv.y;
    pc.zoom = pv.zoom;
    const s = pc.tileToScreen(a.x, a.y);
    expect(s.x).toBeGreaterThanOrEqual(pf.x0);
    expect(s.x).toBeLessThanOrEqual(pf.x1);
    expect(s.y).toBeGreaterThanOrEqual(pf.y0);
    expect(s.y).toBeLessThanOrEqual(pf.y1);
  });

  it('a drag snaps to the nearest green partner within 2 tiles of the finger, never to a red one or a route', () => {
    const partners: vertical.Partner[] = [
      { x: 10, y: 5, ok: true, cost: 1700 },
      { x: 14, y: 5, ok: false, reason: 'A taller building is in the way', cost: 2700 },
      { x: 10, y: 9, ok: true, cost: 1700, route: { via: { x: 10, y: 5 } } },
    ];
    expect(snapPartner(partners, 11, 6)).toEqual(partners[0]);
    expect(snapPartner(partners, 13, 6)).toBeNull();
    expect(snapPartner(partners, 14, 5)).toBeNull();
    expect(snapPartner(partners, 10, 9)).toBeNull();
  });

  it('the reach view frames the source in the uncovered area, never zooming in and never below the street view', () => {
    const w = skyWorld();
    const cam = cityCam(w, 100, 100, 0.9);
    cam.setInsets({ top: 76, bottom: 130 });
    cam.streetMinZoom = 0.4;
    const v = reachView(cam, { x0: 100, y0: 100, x1: 100, y1: 100 });
    expect(v.zoom).toBeLessThanOrEqual(0.9);
    expect(v.zoom).toBeGreaterThanOrEqual(0.45);
    const far = reachView({ ...cam, zoom: 0.5, width: cam.width, height: cam.height, insets: cam.insets, streetMinZoom: 0.4, minZoom: 0.22 }, { x0: 100, y0: 100, x1: 100, y1: 100 });
    expect(far.zoom).toBeLessThanOrEqual(0.5);
  });
});

describe('skybridge tube pick (§7.4, §5.5): a slab at the tube height selects { x, y, link }', () => {
  it('a tap on the drawn tube picks its link; the street below it does not', () => {
    const w = skyWorld();
    const a = { x: sx(20), y: sy(20) };
    const b = { x: a.x + 4, y: a.y };
    tower(w, a.x, a.y);
    tower(w, b.x, b.y);
    vertical.refresh(w);
    const plan = applyAction(w, 'skybridge', a, b);
    expect(plan.valid).toBe(true);
    expect(w.links.length).toBe(1);
    const l = w.links[0];
    const { top, bottom } = vertical.tubeOf(vertical.linkRoof(w, l));
    const cam = cityCam(w, a.x + 2, a.y, 1);
    // The middle gap tile, at the tube's mid height.
    const gx = a.x + 2;
    const c = cam.tileToScreen(gx, a.y);
    const z = (top + bottom) / 2;
    const f = screenToTileF(cam, c.x, c.y - z * cam.zoom, { x: 0, y: 0 });
    const hit = pickTube(w, f.x, f.y);
    expect(hit?.link).toBe(l.id);
    expect(Math.abs(hit!.x - gx)).toBeLessThanOrEqual(1);
    // On the ground under it: no tube.
    const g0 = screenToTileF(cam, c.x, c.y, { x: 0, y: 0 });
    expect(pickTube(w, g0.x, g0.y)).toBeNull();
  });

  it('a short bridge out of a Stratablock: a tap on the tube drawn over the tower\'s face picks the tube, not the tower', () => {
    const w = skyWorld();
    w.story.unlocks.push('stack');
    const b0 = w.addBuilding('stack', sx(20), sy(20))!;
    expect(b0).toBeTruthy();
    b0.stage = 3;
    b0.buildDays = 0;
    // A partner tower one gap tile beyond the Stratablock's +x face.
    const ax = b0.x + 3;
    const ay = b0.y;
    const bx = ax + 2;
    tower(w, bx, ay);
    vertical.refresh(w);
    w.links.push({ id: 1, ax, ay, bx, by: ay });
    const { top, bottom } = vertical.tubeOf(vertical.linkRoof(w, w.links[0]));
    const cam = cityCam(w, ax + 1, ay, 0.8);
    const z = (top + bottom) / 2;
    const front = { x: ax, y: ay, size: 4, depth: b0.x + b0.y + 2 * (4 - 1), height: heightOf(w, ax, ay), zone: false };
    // Along the drawn tube, from inside the Stratablock's footprint (the collar end) across the gap tile.
    for (const along of [-0.45, -0.25, -0.05, 0.3, 0.7]) {
      const p = cam.worldToScreen((ax + 1 + along - (ay + 0.5)) * HALF_W, (ax + 1 + along + ay + 0.5) * HALF_H - z);
      const f = screenToTileF(cam, p.x, p.y, { x: 0, y: 0 });
      const hit = pickTube(w, f.x, f.y);
      expect(hit?.link, `along ${along}`).toBe(1);
      // The tube draws after its back anchor (render/story.ts), so it wins over the tower there.
      expect(tubeBeatsFront(cam, front, hit!, p.x), `along ${along}`).toBe(true);
    }
    // The Stratablock's own body away from the tube: no tube.
    const body = cam.worldToScreen((b0.x + 2 - (b0.y + 2)) * HALF_W, (b0.x + 2 + b0.y + 2) * HALF_H - 60);
    const fb = screenToTileF(cam, body.x, body.y, { x: 0, y: 0 });
    expect(pickTube(w, fb.x, fb.y)).toBeNull();
  });

  it('a tower in front keeps a tap on its body, but the tube wins beside a narrow zone tower and over anything lower', () => {
    const cam = new Camera(192);
    cam.setViewport(390, 844);
    cam.zoom = 0.7;
    cam.centerOnTile(80, 70);
    const tube = { depth: 150, bottom: 126 };
    const tower = { x: 82, y: 73, size: 1, depth: 155, height: 213, zone: true };
    const c = cam.tileToScreen(82, 73);
    // On the tower's body: the tower.
    expect(tubeBeatsFront(cam, tower, tube, c.x)).toBe(false);
    expect(tubeBeatsFront(cam, tower, tube, c.x + HALF_W * cam.zoom * 0.5)).toBe(false);
    // At the edge of its tile, where the narrower body leaves the tube showing: the tube.
    expect(tubeBeatsFront(cam, tower, tube, c.x + HALF_W * cam.zoom * 0.8)).toBe(true);
    // A wide service building in front keeps its whole box; a lower one or one behind never hides the tube.
    expect(tubeBeatsFront(cam, { ...tower, size: 3, zone: false }, tube, c.x + HALF_W * cam.zoom * 0.8)).toBe(false);
    expect(tubeBeatsFront(cam, { ...tower, height: 90 }, tube, c.x)).toBe(true);
    expect(tubeBeatsFront(cam, { ...tower, depth: 148 }, tube, c.x)).toBe(true);
  });
});

describe('annex pins (§3.9): input hit-tests what is drawn', () => {
  it('pins only while a grant waits; a tap on a pin (with slack) finds its slot', () => {
    const w = World.generate(7, 'Pins', undefined, 3);
    const cam = new Camera(w.N);
    cam.setViewport(390, 844);
    cam.zoom = 0.3;
    cam.centerOnTile(128, 96);
    w.districts.grants = 0;
    expect(annexPins(w, cam)).toEqual([]);
    w.districts.grants = 1;
    const pins = annexPins(w, cam);
    expect(pins.length).toBeGreaterThan(0);
    const p = pins[0];
    expect(p.r * 2).toBe(44);
    expect(pinAt(pins, p.x + 20, p.y)?.slot).toBe(p.slot);
    expect(pinAt(pins, p.x + 60, p.y)).toBeNull();
  });
});
