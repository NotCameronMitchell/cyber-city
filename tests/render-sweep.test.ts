// WP-3 · the building sweep on the canvas mock (docs/MEGACITY.md §3.9, §5.4, §5.6, §6.1, §11.5 "parcel draw order"):
// drawZone and drawSkybridgeTile are wrapped to record what the Renderer asks WP-4's art to draw, in order.
//
//  * The sweep visits tiles back to front (x + y, then x); a merged parcel's members come before its head (the front
//    corner, its sort key), every member is called with its parcel, the head with parcels.ts' own parcelAt answer.
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
  zone: [] as { x: number; y: number; p: Parcel | null; alpha: number }[],
  tube: [] as { wx: number; wy: number; z: number; kind: number }[],
}));

vi.mock('../src/render/buildings', async (orig) => {
  const m = await orig<typeof import('../src/render/buildings')>();
  return {
    ...m,
    drawZone: (...a: Parameters<typeof m.drawZone>) => {
      const [ctx, , p, , at] = a;
      if (rec.on) rec.zone.push({ x: at.x, y: at.y, p: p ? { ...p } : null, alpha: ctx.globalAlpha });
      return m.drawZone(...a);
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
  it('back to front by x + y then x; a parcel’s members before its head, the head with parcelAt’s parcel', async () => {
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
      for (let k = 1; k < rec.zone.length; k++) {
        const a = rec.zone[k - 1];
        const b = rec.zone[k];
        expect(a.x + a.y < b.x + b.y || (a.x + a.y === b.x + b.y && a.x < b.x), `${a.x},${a.y} before ${b.x},${b.y}`).toBe(true);
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
