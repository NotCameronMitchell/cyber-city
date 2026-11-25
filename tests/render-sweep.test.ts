// WP-3 · the building sweep on the canvas mock (docs/MEGACITY.md §3.9, §5.4, §5.6, §6.1, §11.5 "parcel draw order"):
// drawZone and drawSkybridgeTile are wrapped to record what the Renderer asks WP-4's art to draw, in order.
//
//  * The sweep visits tiles back to front (x + y; within a diagonal multi-tile heads first, then by x); a merged
//    parcel's members come before its head (the front corner, its sort key), every member is called with its parcel,
//    the head with parcels.ts' own parcelAt answer; the tiles standing in front of a parcel on its head's diagonal
//    ((hx − 1, hy + 1) for 2×1 and 2×2, (hx + 1, hy − 1) for 1×2 and 2×2) draw after the head, so its body never
//    paints over them.
//  * While a skybridge source is selected, every building standing in one of its lanes draws see-through (alpha
//    0.35) and nothing else does; each lane's ghost tube is green up to the first blocker and red beyond, at bridge
//    height; partner badges are at most 8 of each colour, nearest first, never overlapping, routes only after the
//    Show routes chip; the route ghost draws both spans.
//  * Crossing order (§5.6 depth): two tubes on one tile draw the lower first.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SKYBRIDGE } from '../src/game/config';
import { Game } from '../src/game/game';
import { parcelAt } from '../src/game/parcels';
import * as vertical from '../src/game/story/vertical';
import { ZoneType, type Parcel } from '../src/game/types';
import type { World } from '../src/game/world';
import { Camera } from '../src/render/camera';
import { BADGE_MAX, laneClear, partnerBadges, skybridgeView } from '../src/render/overlay';
import { installCanvasMock, mockStats, resetMockStats } from './canvas-mock';
import { startWorld, sx, sy } from './helpers';
import { megacityWorld } from './megacity-fixture';

const rec = vi.hoisted(() => ({
  on: false,
  /** A paint budget for the Renderer's sprite limits (ms), or null for the real one. */
  budget: null as number | null,
  pre: [] as { x: number; y: number }[],
  zone: [] as { x: number; y: number; p: Parcel | null; alpha: number }[],
  tube: [] as { wx: number; wy: number; z: number; kind: number }[],
  /** Every body in draw order: zone tiles at their tile, service buildings at their head (front corner). */
  seq: [] as { x: number; y: number; kind: 'zone' | 'building'; head: boolean }[],
}));

vi.mock('../src/render/buildings', async (orig) => {
  const m = await orig<typeof import('../src/render/buildings')>();
  return {
    ...m,
    prepaintZone: (...a: Parameters<typeof m.prepaintZone>) => {
      if (rec.on) rec.pre.push({ x: a[4], y: a[5] });
      return m.prepaintZone(...a);
    },
    drawZone: (...a: Parameters<typeof m.drawZone>) => {
      const [ctx, , p, , at] = a;
      if (rec.on) {
        rec.zone.push({ x: at.x, y: at.y, p: p ? { ...p } : null, alpha: ctx.globalAlpha });
        rec.seq.push({ x: at.x, y: at.y, kind: 'zone', head: !!p && p.hx === at.x && p.hy === at.y });
      }
      return m.drawZone(...a);
    },
    drawServiceBuilding: (...a: Parameters<typeof m.drawServiceBuilding>) => {
      const b = a[3];
      if (rec.on) rec.seq.push({ x: b.x + b.size - 1, y: b.y + b.size - 1, kind: 'building', head: true });
      return m.drawServiceBuilding(...a);
    },
  };
});

vi.mock('../src/render/districts', async (orig) => {
  const m = await orig<typeof import('../src/render/districts')>();
  return {
    ...m,
    spriteLimits: (...a: Parameters<typeof m.spriteLimits>) => {
      const l = m.spriteLimits(...a);
      return rec.budget === null ? l : { ...l, budgetMs: rec.budget };
    },
  };
});

vi.mock('../src/render/art/vertical', async (orig) => {
  const m = await orig<typeof import('../src/render/art/vertical')>();
  return {
    ...m,
    drawSkybridgeTile: (...a: Parameters<typeof m.drawSkybridgeTile>) => {
      if (rec.on) rec.tube.push({ wx: a[1], wy: a[2], z: a[4], kind: (a[9] as number | undefined) ?? 0 });
      return m.drawSkybridgeTile(...a);
    },
  };
});

let uninstall: () => void = () => {};
beforeAll(() => {
  uninstall = installCanvasMock();
});
afterAll(() => uninstall());

function renderer(g: Game, w = 390, h = 844) {
  return import('../src/render/renderer').then(({ Renderer }) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const cam = new Camera(g.world.N);
    const r = new Renderer(canvas, g, cam);
    return { r, cam };
  });
}

function record(fn: () => void) {
  rec.pre.length = 0;
  rec.seq.length = 0;
  rec.zone.length = 0;
  rec.tube.length = 0;
  rec.on = true;
  try {
    fn();
  } finally {
    rec.on = false;
  }
}

describe('the sweep order and parcels (§6.1: WP-3 caches and sorts them, WP-4 draws them)', () => {
  it('back to front by x + y, multi-tile heads first in a diagonal, then x; a parcel’s members before its head, the head with parcelAt’s parcel', async () => {
    const g = new Game();
    g.restore(megacityWorld(3, 2, 7).serialize());
    const { r, cam } = await renderer(g);
    try {
      cam.zoom = 1;
      cam.centerOnTile(96, 96);
      r.render(1 / 60, 1);
      resetMockStats();
      record(() => r.render(1 / 60, 1.02));
      const w = g.world;
      expect(rec.zone.length).toBeGreaterThan(200);
      // Within a diagonal the multi-tile heads come first (each by x), then the other tiles (by x).
      const isHead = (c: (typeof rec.zone)[number]) => !!c.p && c.x === c.p.hx && c.y === c.p.hy;
      for (let k = 1; k < rec.zone.length; k++) {
        const a = rec.zone[k - 1];
        const b = rec.zone[k];
        const sa = a.x + a.y;
        const sb = b.x + b.y;
        const ok = sa < sb || (sa === sb && ((isHead(a) && !isHead(b)) || (isHead(a) === isHead(b) && a.x < b.x)));
        expect(ok, `${a.x},${a.y} before ${b.x},${b.y}`).toBe(true);
      }
      const seen = new Map<number, number>();
      rec.zone.forEach((c, k) => seen.set(c.y * w.N + c.x, k));
      let heads = 0;
      let members = 0;
      for (const [k, c] of rec.zone.entries()) {
        const want = parcelAt(w, c.x, c.y);
        if (!want) {
          expect(c.p).toBeNull();
          continue;
        }
        expect(c.p).not.toBeNull();
        expect([c.p!.x, c.p!.y, c.p!.hx, c.p!.hy]).toEqual([want.x, want.y, want.hx, want.hy]);
        if (c.x === want.hx && c.y === want.hy) {
          heads++;
          expect(c.p).toEqual(want);
          // Every member the sweep reached was called before the head (the head is the parcel's sort key).
          for (let y = want.y; y <= want.hy; y++)
            for (let x = want.x; x <= want.hx; x++) {
              const j = seen.get(y * w.N + x);
              if (j !== undefined && !(x === c.x && y === c.y)) expect(j).toBeLessThan(k);
            }
        } else members++;
      }
      expect(heads).toBeGreaterThan(10);
      expect(members).toBeGreaterThan(10);
      expect(mockStats.errors).toEqual([]);
    } finally {
      r.destroy();
    }
  });

  it('a tile in front of a parcel on its head’s diagonal draws after the head (no facade over the tower in front)', async () => {
    const g = new Game();
    g.restore(megacityWorld(3, 2, 7).serialize());
    const { r, cam } = await renderer(g);
    try {
      cam.zoom = 1;
      cam.centerOnTile(96, 96);
      r.render(1 / 60, 1);
      record(() => r.render(1 / 60, 1.02));
      const w = g.world;
      const order = new Map<number, number>();
      rec.zone.forEach((c, k) => order.set(c.y * w.N + c.x, k));
      const checked = { left: 0, right: 0 };
      for (const [k, c] of rec.zone.entries()) {
        const p = c.p;
        if (!p || c.x !== p.hx || c.y !== p.hy) continue;
        // Front-left neighbour of the left member (2×1, 2×2) and front-right of the back member (1×2, 2×2).
        const fronts: [number, number, 'left' | 'right'][] = [];
        if (p.w === 2) fronts.push([p.hx - 1, p.hy + 1, 'left']);
        if (p.h === 2) fronts.push([p.hx + 1, p.hy - 1, 'right']);
        for (const [fx, fy, side] of fronts) {
          const j = order.get(fy * w.N + fx);
          if (j === undefined) continue;
          const t = w.tiles[fy * w.N + fx];
          if (t.zone === ZoneType.None || t.level < 1) continue;
          expect(j, `${fx},${fy} after the head ${p.hx},${p.hy}`).toBeGreaterThan(k);
          checked[side]++;
        }
      }
      expect(checked.left).toBeGreaterThan(5);
      expect(checked.right).toBeGreaterThan(5);
    } finally {
      r.destroy();
    }
  });
});

describe('a service building and the 2×1 parcel in front of it (§6.1 parcel draw order)', () => {
  it('a building of size 2 draws before the 2×1 parcel head at its front-left on the same diagonal', async () => {
    const w = startWorld(3, 911);
    w.funds = 1e8;
    // Solar farms (2×2) at (bx − 1..bx, by − 1..by) with a Market pair at (bx − 2, by + 1)–(bx − 1, by + 1): by + 1 odd,
    // so the pair is the bottom row of the aligned block whose top-right tile is the building's (no quad can form).
    const cases: { bx: number; by: number }[] = [];
    for (let k = 0; k < 40 && cases.length < 4; k++) {
      const bx = sx(8 + (k % 8) * 6);
      const by = sy(8 + Math.floor(k / 8) * 8);
      if (!w.addBuilding('solar', bx - 1, by - 1)) continue;
      for (const x of [bx - 2, bx - 1]) {
        w.setZone(x, by + 1, ZoneType.Commercial);
        w.setLevel(x, by + 1, 3);
        w.tiles[w.idx(x, by + 1)].powered = true;
      }
      const p = parcelAt(w, bx - 1, by + 1);
      if (p && p.w === 2 && p.h === 1 && p.hx === bx - 1 && p.hy === by + 1) cases.push({ bx, by });
    }
    expect(cases.length).toBeGreaterThan(0);
    const g = new Game();
    g.restore(w.serialize());
    const { r, cam } = await renderer(g, 1440, 900);
    try {
      for (const { bx, by } of cases) {
        cam.zoom = 1;
        cam.centerOnTile(bx, by);
        r.render(1 / 60, 1);
        record(() => r.render(1 / 60, 1.02));
        const b = rec.seq.findIndex((c) => c.kind === 'building' && c.x === bx && c.y === by);
        const ph = rec.seq.findIndex((c) => c.kind === 'zone' && c.head && c.x === bx - 1 && c.y === by + 1);
        expect(b, `building at ${bx},${by}`).toBeGreaterThanOrEqual(0);
        expect(ph, `parcel head at ${bx - 1},${by + 1}`).toBeGreaterThan(b);
      }
    } finally {
      r.destroy();
    }
  });
});

describe('centre-first painting after a pan (§11.1 fallback frames, V1)', () => {
  it('while bodies show a fallback, the next frame paints from the tile under the screen centre outward; none without', async () => {
    const art = await import('../src/render/buildings');
    const g = new Game();
    g.restore(megacityWorld(3, 9, 7).serialize());
    const { r, cam } = await renderer(g);
    try {
      art.clearBuildingCache();
      cam.zoom = 1;
      cam.centerOnTile(70, 120);
      // A paint budget too small for the view: most kit bodies show the classic fallback.
      rec.budget = 0.02;
      r.render(1 / 60, 1);
      expect(r.view.sprites.fallbacks).toBeGreaterThan(0);
      record(() => r.render(1 / 60, 1.02));
      expect(rec.pre.length).toBeGreaterThan(0);
      const c = cam.screenToTile(195, 422);
      const d = rec.pre.map((q) => Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y)));
      expect(d[0]).toBeLessThanOrEqual(2);
      for (let k = 1; k < d.length; k++) expect(d[k]).toBeGreaterThanOrEqual(d[k - 1]);
      // With room to paint everything, no fallback remains and the pass stops running.
      rec.budget = 1e6;
      for (let k = 0; k < 3; k++) r.render(1 / 60, 1.04 + k / 60);
      expect(r.view.sprites.fallbacks).toBe(0);
      record(() => r.render(1 / 60, 1.2));
      expect(rec.pre.length).toBe(0);
    } finally {
      rec.budget = null;
      r.destroy();
    }
  });
});

describe('stale sprites and the warm ring (§11.1 fallback frames after a pan, V1 paint rate)', () => {
  it('after a night-bucket change the stale sprites repaint from the screen centre outward', async () => {
    const art = await import('../src/render/buildings');
    const g = new Game();
    g.restore(megacityWorld(3, 9, 7).serialize());
    const { r, cam } = await renderer(g);
    try {
      art.clearBuildingCache();
      cam.zoom = 1;
      cam.centerOnTile(96, 96);
      g.clock = 240 * 100 + 120; // noon
      rec.budget = 1e6;
      for (let k = 0; k < 3; k++) r.render(1 / 60, 1 + k / 60);
      expect(r.view.sprites.fallbacks + r.view.sprites.stale).toBe(0);
      // Midnight: every body's sprite is a night bucket away; with a small budget most draw their day sprite.
      g.clock = 240 * 100;
      rec.budget = 0.02;
      r.render(1 / 60, 1.1);
      expect(r.view.sprites.stale).toBeGreaterThan(0);
      record(() => r.render(1 / 60, 1.12));
      expect(rec.pre.length).toBeGreaterThan(0);
      const c = cam.screenToTile(195, 422);
      const d = rec.pre.map((q) => Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y)));
      expect(d[0]).toBeLessThanOrEqual(2);
      for (let k = 1; k < d.length; k++) expect(d[k]).toBeGreaterThanOrEqual(d[k - 1]);
    } finally {
      rec.budget = null;
      r.destroy();
    }
  });

  it('at rest the idle budget paints the bodies just off the screen, nearest first, then stops; a short pan lands on painted bodies', async () => {
    const art = await import('../src/render/buildings');
    const g = new Game();
    g.restore(megacityWorld(3, 9, 7).serialize());
    const pan = async (warmFirst: boolean): Promise<number> => {
      const { r, cam } = await renderer(g);
      try {
        art.clearBuildingCache();
        cam.zoom = 1;
        cam.centerOnTile(96, 96);
        rec.budget = 1e6;
        r.render(1 / 60, 1);
        let t = 1;
        if (warmFirst) {
          const warm = (r as unknown as { warm: { done: boolean } }).warm;
          let frames = 0;
          const offScreen: { x: number; y: number }[] = [];
          for (; frames < 120 && !warm.done; frames++) {
            record(() => r.render(1 / 60, (t += 1 / 60)));
            offScreen.push(...rec.pre);
          }
          expect(warm.done).toBe(true);
          // Nothing before the camera rested WARM_STILL frames; then only bodies off the screen.
          expect(offScreen.length).toBeGreaterThan(20);
          for (const q of offScreen) {
            const p = cam.tileToScreen(q.x, q.y);
            const inside = p.x > 40 && p.x < 350 && p.y > 40 && p.y < 804;
            expect(inside, `${q.x},${q.y} at ${Math.round(p.x)},${Math.round(p.y)}`).toBe(false);
          }
          // Done: no more paint-ahead while the camera rests.
          record(() => r.render(1 / 60, (t += 1 / 60)));
          expect(rec.pre.length).toBe(0);
          expect(r.view.sprites.bytes).toBeLessThanOrEqual((r.view.limits?.capBytes ?? 32 * 1024 * 1024) * 0.75);
        }
        // A pan of a third of the screen with almost no paint budget.
        rec.budget = 0.02;
        cam.panBy(-130, -280);
        r.render(1 / 60, (t += 1 / 60));
        return r.view.sprites.fallbacks;
      } finally {
        rec.budget = null;
        r.destroy();
      }
    };
    const cold = await pan(false);
    const warmed = await pan(true);
    expect(cold).toBeGreaterThan(10);
    expect(warmed).toBeLessThan(cold / 4);
  });
});

/** A level-3, powered tower tile (a tall zone anchor). */
function tower(w: World, x: number, y: number, level = 3, zone = ZoneType.Residential): void {
  w.setZone(x, y, zone);
  w.setLevel(x, y, level);
  w.tiles[w.idx(x, y)].powered = true;
}

/** A start slot with a row of towers, a lane blocker, L1 and L2 bodies inside the lanes and a two-bridge route. */
function skyScene(): { g: Game; a: { x: number; y: number } } {
  const w = startWorld(3, 404);
  w.funds = 1e8;
  w.maxPopulation = 1e7;
  w.story.unlocks.push('skybridge');
  const x0 = sx(20);
  const y0 = sy(24);
  // Source A, partners east at 4 and 8 tiles, one north-east via V (a route), an L3 blocker 3 tiles south.
  tower(w, x0, y0);
  tower(w, x0 + 4, y0);
  tower(w, x0 + 8, y0);
  tower(w, x0 + 4, y0 - 5);
  tower(w, x0, y0 + 3);
  tower(w, x0, y0 + 7);
  // Low bodies standing inside the east lane (they pass under: see-through while A is selected).
  for (const x of [x0 + 1, x0 + 2, x0 + 6]) tower(w, x, y0, 1 + (x % 2));
  // Bodies outside every lane (opaque).
  for (const [dx, dy] of [
    [2, 2],
    [3, 3],
    [6, -2],
  ])
    tower(w, x0 + dx, y0 + dy, 2);
  vertical.refresh(w);
  const g = new Game();
  g.restore(w.serialize());
  g.setTool('skybridge');
  return { g, a: { x: x0, y: y0 } };
}

describe('the skybridge view while a source is selected (§5.4, §5.6)', () => {
  it('buildings in a lane draw see-through and only those; ghost tubes green to the first blocker, red beyond, at bridge height', async () => {
    const { g, a } = skyScene();
    expect(g.skybridgeSource(a.x, a.y)).not.toBeNull();
    const lanes = g.skybridgeLanes();
    expect(lanes.length).toBeGreaterThan(0);
    const { r, cam } = await renderer(g);
    try {
      cam.zoom = 1;
      cam.centerOnTile(a.x + 2, a.y);
      r.render(1 / 60, 1);
      resetMockStats();
      record(() => r.render(1 / 60, 1.02));
      const inLane = (x0: number, y0: number, x1: number, y1: number) => lanes.some((l) => x1 >= l.x0 && x0 <= l.x1 && y1 >= l.y0 && y0 <= l.y1);
      let ghosts = 0;
      for (const c of rec.zone) {
        const p = c.p;
        const inside = p ? inLane(p.x, p.y, p.hx, p.hy) : inLane(c.x, c.y, c.x, c.y);
        expect([c.x, c.y, c.alpha]).toEqual([c.x, c.y, inside ? 0.35 : 1]);
        if (inside) ghosts++;
      }
      expect(ghosts).toBeGreaterThan(0);
      // Ghost tubes: per lane, `clear` green tiles then red to the lane's end, all at the lane's bridge height.
      const w = g.world;
      const want = { green: 0, red: 0 };
      const zs = new Set<number>();
      for (const l of lanes) {
        const len = l.dir === 1 || l.dir === 3 ? l.x1 - l.x0 + 1 : l.y1 - l.y0 + 1;
        const clear = laneClear(w, l);
        want.green += clear;
        want.red += len - clear;
        zs.add(Math.max(30, l.roof - SKYBRIDGE.tubeBelowRoof - SKYBRIDGE.tubeHeight / 2));
      }
      const tubes = rec.tube.filter((t) => t.kind === 1 || t.kind === 2);
      expect(tubes.filter((t) => t.kind === 1).length).toBe(want.green);
      expect(tubes.filter((t) => t.kind === 2).length).toBe(want.red);
      expect(want.red).toBeGreaterThan(0);
      for (const t of tubes) expect(zs.has(t.z)).toBe(true);
      expect(mockStats.errors).toEqual([]);
      // Deselected: nothing is see-through and no ghost draws.
      g.skybridgeSource(a.x, a.y);
      record(() => r.render(1 / 60, 1.04));
      expect(rec.zone.every((c) => c.alpha === 1)).toBe(true);
      expect(rec.tube.filter((t) => t.kind > 0)).toEqual([]);
    } finally {
      r.destroy();
    }
  });

  it('partner badges: ≤ 8 of each colour, nearest the source first, never overlapping; routes only with Show routes; the route ghost draws both spans', async () => {
    const { g, a } = skyScene();
    g.skybridgeSource(a.x, a.y);
    const { r, cam } = await renderer(g);
    try {
      cam.zoom = 0.8;
      cam.centerOnTile(a.x + 2, a.y);
      skybridgeView.showRoutes = false;
      const off = partnerBadges(g, cam);
      expect(off.length).toBeGreaterThan(0);
      expect(off.some((b) => b.kind === 'route')).toBe(false);
      expect(off.some((b) => b.kind === 'ok')).toBe(true);
      skybridgeView.showRoutes = true;
      const on = partnerBadges(g, cam);
      expect(on.some((b) => b.kind === 'route')).toBe(true);
      for (const list of [off, on]) {
        expect(list.filter((b) => b.kind !== 'bad').length).toBeLessThanOrEqual(BADGE_MAX);
        expect(list.filter((b) => b.kind === 'bad').length).toBeLessThanOrEqual(BADGE_MAX);
        for (let i = 0; i < list.length; i++) {
          expect(list[i].r).toBe(list[i].kind === 'bad' ? 8 : 22);
          if (i > 0) {
            const d = (b: { tx: number; ty: number }) => Math.abs(b.tx - a.x) + Math.abs(b.ty - a.y);
            expect(d(list[i])).toBeGreaterThanOrEqual(d(list[i - 1]));
          }
          for (let j = 0; j < i; j++) expect(Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y)).toBeGreaterThanOrEqual(list[i].r + list[j].r);
        }
        for (const b of list.filter((q) => q.kind === 'ok')) expect(b.label).toBe(b.cost.toLocaleString('en-US'));
      }
      // The route ghost: planning the blue "2" previews both spans.
      const route = on.find((b) => b.kind === 'route')!;
      const plan = g.planSkybridge(route.tx, route.ty);
      expect(plan.route).toBeTruthy();
      g.setPreview(plan);
      resetMockStats();
      record(() => r.render(1 / 60, 2));
      const spans = [plan.span!, plan.route!.second];
      const gaps = spans.reduce((n, sp) => n + Math.abs(sp.bx - sp.ax) + Math.abs(sp.by - sp.ay) - 1, 0);
      const ghost = rec.tube.filter((t) => t.kind === 1 || t.kind === 2);
      // Both spans' gap tiles (plus the lane ghosts of the still selected source).
      const onSpan = (t: { wx: number; wy: number }) =>
        spans.some((sp) => {
          const n = Math.abs(sp.bx - sp.ax) + Math.abs(sp.by - sp.ay);
          for (let k = 1; k < n; k++) {
            const x = sp.ax + Math.sign(sp.bx - sp.ax) * k;
            const y = sp.ay + Math.sign(sp.by - sp.ay) * k;
            if ((x - y) * 32 === t.wx && (x + y) * 16 === t.wy) return true;
          }
          return false;
        });
      expect(ghost.filter(onSpan).length).toBeGreaterThanOrEqual(gaps);
      expect(mockStats.errors).toEqual([]);
    } finally {
      skybridgeView.showRoutes = false;
      r.destroy();
    }
  });

  it('crossing order: two tubes on one tile draw the lower first (§5.6 depth)', async () => {
    const { StoryRender } = await import('../src/render/story');
    const w = startWorld(3, 404);
    const x0 = sx(30);
    const y0 = sy(30);
    // An east-west bridge between two L3 towers and a north-south one between two L2 towers, crossing at (x0 + 3, y0).
    tower(w, x0, y0);
    tower(w, x0 + 6, y0);
    tower(w, x0 + 3, y0 - 3, 2);
    tower(w, x0 + 3, y0 + 3, 2);
    w.links.push({ id: 1, ax: x0, ay: y0, bx: x0 + 6, by: y0 }, { id: 2, ax: x0 + 3, ay: y0 - 3, bx: x0 + 3, by: y0 + 3 });
    const g = new Game();
    g.restore(w.serialize());
    const story = new StoryRender(g);
    try {
      story.prepare(g.world, { time: 0, night: 0, zoom: 1, quality: 'high', artOffset: 0, world: g.world });
      const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      let both = 0;
      for (let s = x0 + y0 - 6; s <= x0 + y0 + 12; s++) {
        record(() => story.drawSkybridges(ctx, s));
        const here = rec.tube.filter((t) => t.wx === (x0 + 3 - y0) * 32 && t.wy === (x0 + 3 + y0) * 16);
        if (here.length === 2) {
          both++;
          expect(here[0].z).toBeLessThan(here[1].z);
        }
      }
      expect(both).toBe(1);
    } finally {
      story.destroy();
    }
  });
});
