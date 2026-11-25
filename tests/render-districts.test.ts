// WP-3 · the world view with districts (docs/MEGACITY.md §3.9, §11.5): fog over locked land and its distance bands,
// the boundary runs, annex pins (only with a grant or an affordable purchase, at most 4, on screen), the view bands
// (streetMinZoom by viewport and device class, the skyline cap per pointer and in lower detail), the City map snap
// both ways through camera.snapToMap / snapFromMap, minZoom, insets, the atlas scale and budget for 9 and 25 slots,
// the district label, the PC sprite cache and paint budget by canvas size, the overview's budget, the parcel cache
// (incremental refills equal parcelAt; the head is the front corner, the sweep key) and the Renderer's bands on the
// canvas mock.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANNEX } from '../src/game/config';
import { slotRect } from '../src/game/districts/slots';
import { Game } from '../src/game/game';
import { PARCEL_HEAD, PARCEL_MEMBER, parcelAt } from '../src/game/parcels';
import { Terrain, ZoneType, type Parcel } from '../src/game/types';
import { World } from '../src/game/world';
import { Camera, HALF_H, HALF_W, worldToTileF } from '../src/render/camera';
import {
  DistrictLabel,
  LABEL_GAP_SEC,
  SKYLINE_CAP,
  annexPins,
  atlasBudgetBytes,
  atlasScale,
  boundaryRuns,
  candidateSlots,
  impostorBytes,
  pinAt,
  skylineCap,
  spriteLimits,
  streetMinZoom,
} from '../src/render/districts';
import { installCanvasMock, mockStats, resetMockStats } from './canvas-mock';
import { megacityWorld } from './megacity-fixture';

let uninstall: () => void = () => {};
beforeAll(() => {
  uninstall = installCanvasMock();
});
afterAll(() => uninstall());

const MB = 1024 * 1024;

/** A 3×3 city with the start slot and its north neighbour owned, one grant waiting. */
function twoDistricts(region: 3 | 5 = 3, seed = 2091): World {
  const w = World.generate(seed, 'Two', undefined, region);
  const start = (region * region - 1) / 2;
  w.annex(start - region);
  return w;
}

function camOn(w: World, width = 390, height = 844): Camera {
  const cam = new Camera(w.N);
  cam.setViewport(width, height);
  return cam;
}

describe('view bands by viewport and device class (§3.9)', () => {
  it('streetMinZoom: 0.4 on a handheld device, 0.5 in lower detail; on a PC the ≤ 6,000-tile zoom, never below 0.4', () => {
    expect(streetMinZoom(390, 844, 'handheld')).toBe(0.4);
    expect(streetMinZoom(844, 390, 'handheld')).toBe(0.4);
    expect(streetMinZoom(390, 844, 'handheld', true)).toBe(0.5);
    expect(streetMinZoom(1280, 800, 'pc')).toBe(0.41);
    expect(streetMinZoom(1440, 900, 'pc')).toBe(0.46);
    expect(streetMinZoom(1920, 1080, 'pc')).toBe(0.58);
    expect(streetMinZoom(1024, 600, 'pc')).toBe(0.4);
    expect(streetMinZoom(1280, 800, 'pc', true)).toBe(0.5);
    // The tile count at that zoom is within the cap (≈ W × H / (1,024 z²)).
    for (const [W, H] of [
      [1280, 800],
      [1440, 900],
      [1920, 1080],
    ]) {
      const z = streetMinZoom(W, H, 'pc');
      expect((W * H) / (1024 * z * z)).toBeLessThanOrEqual(6000 * 1.02);
    }
  });

  it('the skyline cap per pointer and in lower detail: 2,600 on a phone, 6,000 on a PC on high, 1,800 in lower detail', () => {
    expect(skylineCap('handheld', 'high')).toBe(SKYLINE_CAP.handheld);
    expect(skylineCap('handheld', 'high')).toBe(2600);
    expect(skylineCap('pc', 'high')).toBe(6000);
    expect(skylineCap('pc', 'low')).toBe(2600);
    expect(skylineCap('handheld', 'high', true)).toBe(1800);
    expect(skylineCap('pc', 'high', true)).toBe(1800);
  });

  it('the PC sprite cache by canvas size and the paint budget by the frame’s sim work; handheld and lower detail', () => {
    expect(spriteLimits('handheld', 'high', 780 * 1688, 0)).toEqual({ capBytes: 32 * MB, budgetMs: 3.5 });
    expect(spriteLimits('handheld', 'low', 780 * 1688, 0)).toEqual({ capBytes: 20 * MB, budgetMs: 2 });
    expect(spriteLimits('handheld', 'high', 780 * 1688, 0, true).capBytes).toBe(20 * MB);
    expect(spriteLimits('pc', 'high', 1920 * 1080, 0).capBytes).toBe(64 * MB);
    expect(spriteLimits('pc', 'high', 1920 * 1080 * 1.25 * 1.25, 0).capBytes).toBe(96 * MB);
    expect(spriteLimits('pc', 'high', 2880 * 1800, 0).capBytes).toBe(96 * MB);
    // budgetMs = min(6, max(3, 9 − simMs)).
    expect(spriteLimits('pc', 'high', 1920 * 1080, 0).budgetMs).toBe(6);
    expect(spriteLimits('pc', 'high', 1920 * 1080, 4.5).budgetMs).toBe(4.5);
    expect(spriteLimits('pc', 'high', 1920 * 1080, 8).budgetMs).toBe(3);
  });
});

describe('the City map: snap both ways, insets, atlas scale and budget (§3.9)', () => {
  it('snapToMap frames the whole region below minZoom; snapFromMap returns to minZoom centred where the fingers are', () => {
    const w = twoDistricts(3);
    const cam = camOn(w);
    cam.minZoom = 0.22;
    cam.zoom = 0.5;
    cam.centerOnTile(96, 96);
    cam.snapToMap(0, 1);
    expect(cam.mapView).toBe(true);
    expect(cam.animating).toBe(true);
    // 0.3 s ease.
    for (let k = 0; k < 20; k++) cam.update(1 / 60);
    expect(cam.animating).toBe(false);
    expect(cam.zoom).toBeCloseTo(cam.mapZoom, 6);
    expect(cam.zoom).toBeGreaterThan(0.025);
    expect(cam.zoom).toBeLessThan(0.05);
    // The region's four corners are on screen.
    for (const [tx, ty] of [
      [0, 0],
      [w.N, 0],
      [0, w.N],
      [w.N, w.N],
    ]) {
      const p = cam.worldToScreen((tx - ty) * HALF_W, (tx + ty) * HALF_H);
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(cam.width + 1);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThanOrEqual(cam.height + 1);
    }
    // On the map, zooms stay inside [fit, fit × headroom].
    cam.zoomAt(4, 195, 422);
    expect(cam.zoom).toBeCloseTo(cam.mapZoom, 6);
    // Tap the north district's middle: back at minZoom, centred on it.
    const r = slotRect(w, 1);
    const at = cam.worldToScreen((r.x0 + 32 - (r.y0 + 32)) * HALF_W, (r.x0 + 32 + r.y0 + 32) * HALF_H);
    cam.snapFromMap(at.x, at.y);
    expect(cam.mapView).toBe(false);
    for (let k = 0; k < 20; k++) cam.update(1 / 60);
    expect(cam.zoom).toBeCloseTo(0.22, 6);
    const c = worldToTileF(cam.x, cam.y);
    expect(Math.abs(c.x - (r.x0 + 32))).toBeLessThan(1.5);
    expect(Math.abs(c.y - (r.y0 + 32))).toBeLessThan(1.5);
    // Any pan cancels an ease.
    cam.easeTo(0, 0, 1, 0.3);
    cam.panBy(1, 1);
    expect(cam.animating).toBe(false);
  });

  it('a 5×5 region on a handheld device may zoom to 2× its City map fit', () => {
    const w = new World(1, 'Five', undefined, 5);
    const cam = camOn(w);
    cam.snapToMap(0, 2, 0);
    expect(cam.zoom).toBeGreaterThan(0.015);
    expect(cam.zoom).toBeLessThan(0.03);
    cam.zoomAt(10, 195, 422);
    expect(cam.zoom).toBeCloseTo(cam.mapZoom * 2, 6);
  });

  it('setInsets: fitBox and centerOnTile use the uncovered area (the desktop side panel)', () => {
    const w = twoDistricts(3);
    const cam = camOn(w, 1440, 900);
    cam.setInsets({ right: 400 });
    cam.zoom = 1;
    cam.centerOnTile(96, 96);
    const p = cam.tileToScreen(96, 96);
    expect(p.x).toBeCloseTo((1440 - 400) / 2, 3);
    expect(p.y).toBeCloseTo(450, 3);
    cam.fitBox({ x0: 64, y0: 64, x1: 127, y1: 127 });
    const q = cam.tileToScreen(96, 96);
    expect(Math.abs(q.x - 520)).toBeLessThan(40);
    // No insets: today's centring exactly.
    cam.setInsets({ right: 0 });
    cam.centerOnTile(96, 96);
    expect(cam.tileToScreen(96, 96).x).toBeCloseTo(720, 3);
  });

  it('the atlas scale: ≤ 0.1, ×2 headroom for a 5×5 region on a handheld device, within 4 MB / 8 MB for 9 and 25 slots', () => {
    // A 3×3 City map on a phone (fit ≈ 0.032, DPR 2): 0.064, nine impostors well within 4 MB.
    const s3 = atlasScale(0.032, 2, 3, 'handheld');
    expect(s3).toBeCloseTo(0.064, 3);
    expect(9 * impostorBytes(s3)).toBeLessThanOrEqual(atlasBudgetBytes('handheld'));
    // Big fit zooms cap at 0.1.
    expect(atlasScale(0.2, 2, 3, 'pc')).toBeLessThanOrEqual(0.1);
    // 25 slots: ≤ 0.064 on a handheld device (even with the 2× headroom), ≤ 0.09 on a PC; always within the budget.
    for (const [fit, dpr, cls, cap, budget] of [
      [0.02, 3, 'handheld', 0.064, 4],
      [0.06, 2, 'pc', 0.09, 8],
      [0.06, 2, 'handheld', 0.064, 4],
    ] as const) {
      const s = atlasScale(fit, dpr, 5, cls);
      expect(s).toBeLessThanOrEqual(cap + 1e-9);
      expect(25 * impostorBytes(s)).toBeLessThanOrEqual(budget * MB);
    }
    // Lower detail: 4 MB on a PC too.
    const sl = atlasScale(0.06, 2, 5, 'pc', true);
    expect(25 * impostorBytes(sl)).toBeLessThanOrEqual(4 * MB);
  });
});

describe('fog, boundary and pins (§3.9)', () => {
  it('fog distance is 0 on owned land and grows past the boundary; the peek band is the first ANNEX.peek tiles', async () => {
    const { TerrainInfo } = await import('../src/render/ground');
    const w = twoDistricts(3);
    const info = new TerrainInfo(w);
    const N = w.N;
    expect(info.fogD[96 * N + 96]).toBe(0);
    expect(info.fogD[30 * N + 96]).toBe(0); // the annexed north district
    expect(info.fogD[96 * N + 128]).toBe(1); // first locked tile east of the start slot
    expect(info.fogD[96 * N + 128 + ANNEX.peek - 1]).toBe(ANNEX.peek);
    expect(info.fogD[96 * N + 190]).toBe(63);
  });

  it('the boundary runs follow owned / locked slot sides only (never the region edge), and move with an annex', () => {
    const w = twoDistricts(3);
    const runs = boundaryRuns(w);
    // Start slot: E, S, W locked; north district (slot 1): E, W locked (N is the region edge, S owned).
    expect(runs.length / 4).toBe(5);
    for (let i = 0; i < runs.length; i += 4) {
      const horizontal = runs[i + 1] === runs[i + 3];
      expect(horizontal || runs[i] === runs[i + 2]).toBe(true);
      expect(Math.abs(runs[i + 2] - runs[i] + runs[i + 3] - runs[i + 1])).toBe(64);
      // Never on the region's outer edge.
      if (horizontal) expect(runs[i + 1] > 0 && runs[i + 1] < w.N).toBe(true);
      else expect(runs[i] > 0 && runs[i] < w.N).toBe(true);
    }
    w.annex(5);
    expect(boundaryRuns(w).length / 4).toBe(6);
  });

  it('pins show only while a grant waits (or a purchase is affordable after an ending), at most 4, on screen, on shared borders', () => {
    const w = new World(7, 'Pins', undefined, 5);
    // A plus of five owned slots: eight candidates around it.
    for (const s of [7, 11, 13, 17]) w.annex(s);
    const cam = camOn(w, 1920, 1080);
    cam.zoom = 0.06;
    cam.centerOnTile(160, 160);
    w.districts.grants = 0;
    expect(annexPins(w, cam)).toEqual([]);
    w.districts.grants = 1;
    const cands = candidateSlots(w);
    expect(cands.length).toBeGreaterThan(4);
    const pins = annexPins(w, cam);
    expect(pins.length).toBe(ANNEX.maxPins);
    for (const p of pins) {
      expect(cands).toContain(p.slot);
      // On a border of the candidate slot (a slot side, tile-corner coordinates) shared with an owned slot.
      const r = slotRect(w, p.slot);
      const onSide = (p.tx === r.x0 || p.tx === r.x1 + 1 || p.ty === r.y0 || p.ty === r.y1 + 1) && (p.tx === r.x0 + 32 || p.ty === r.y0 + 32);
      expect(onSide).toBe(true);
      expect(p.r * 2).toBeGreaterThanOrEqual(44);
      expect(pinAt(pins, p.x + 10, p.y - 10)?.slot).toBe(p.slot);
    }
    expect(pinAt(pins, -100, -100)).toBeNull();
    // After an ending: pins when the next district's price is affordable, never on the City map.
    w.districts.grants = 0;
    w.story.ending = 'ironwork' as never;
    w.funds = 0;
    expect(annexPins(w, cam)).toEqual([]);
    w.funds = 1e12;
    expect(annexPins(w, cam).length).toBe(ANNEX.maxPins);
    cam.mapView = true;
    expect(annexPins(w, cam)).toEqual([]);
    cam.mapView = false;
    // Zoomed in on the start slot's centre: the borders are off screen, so no pin shows.
    cam.zoom = 1;
    cam.centerOnTile(160, 160);
    expect(annexPins(w, cam)).toEqual([]);
  });

  it('the Sunk before ch4.brine is never a candidate (no pin for it)', () => {
    for (let seed = 1; seed < 40; seed++) {
      const w = World.generate(seed, 'S', undefined, 3);
      const sunk = w.districts.kinds.indexOf('sunk');
      for (let s = 0; s < 9; s++) if (s !== sunk && s !== 4) w.annex(s);
      expect(candidateSlots(w)).not.toContain(sunk);
    }
  });
});

describe('the City map atlas paints progressively (§3.9)', () => {
  it('every slot gets its first picture even while growth keeps re-dirtying the slot under the view; churned slots wait', async () => {
    const { Atlas } = await import('../src/render/atlas');
    const w = megacityWorld(3, 9, 4);
    const cam = camOn(w);
    cam.snapToMap(0, 1, 0);
    cam.update(1);
    const atlas = new Atlas();
    atlas.open(w, atlasScale(cam.mapZoom, 1, 3, 'handheld'));
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const centre = slotRect(w, 4);
    let frames = 0;
    while (atlas.shown < 9 && frames < 2000) {
      // A growth event in the slot under the view every frame (speed 3 on a built city).
      atlas.invalidate(w, { x0: centre.x0 + 5, y0: centre.y0 + 5, x1: centre.x0 + 7, y1: centre.y0 + 7 });
      atlas.draw(ctx, w, cam, 1, 0, frames / 60);
      frames++;
    }
    expect(atlas.shown).toBe(9);
    expect(atlas.bytes).toBeLessThanOrEqual(atlasBudgetBytes('handheld'));
  });
});

describe('the district label (§3.9)', () => {
  it('fades in when the view centre crosses into another owned district, at most once per 20 s, never while dragging', () => {
    const w = twoDistricts(3);
    const cam = camOn(w);
    cam.zoom = 0.5;
    const label = new DistrictLabel();
    cam.centerOnTile(96, 96);
    label.update(w, cam, 0, false);
    expect(label.shown).toBeNull(); // the first district seen never announces itself
    cam.centerOnTile(96, 30);
    label.update(w, cam, 100, false);
    expect(label.shown).toBe(w.districts.kinds[1] === 'shore' ? 'CHARTER SHORE' : label.shown);
    expect(label.shown).toMatch(/^[A-Z ]+$/);
    label.update(w, cam, 100.6, false);
    expect(label.alpha).toBe(1);
    label.update(w, cam, 101.6, false);
    expect(label.alpha).toBe(0);
    // Back within 20 s: nothing.
    cam.centerOnTile(96, 96);
    label.update(w, cam, 110, false);
    expect(label.shown).toBeNull();
    // Later, but dragging: nothing.
    cam.centerOnTile(96, 30);
    label.update(w, cam, 100 + LABEL_GAP_SEC + 5, true);
    expect(label.shown).toBeNull();
    cam.centerOnTile(96, 96);
    label.update(w, cam, 100 + LABEL_GAP_SEC + 6, false);
    expect(label.shown).toBe('CHARTER SHORE');
    // One district: never.
    const one = World.generate(5, 'One', undefined, 3);
    const l1 = new DistrictLabel();
    const c1 = camOn(one);
    c1.centerOnTile(96, 96);
    l1.update(one, c1, 0, false);
    c1.centerOnTile(96, 30);
    l1.update(one, c1, 100, false);
    expect(l1.shown).toBeNull();
  });
});

describe('the parcel cache and sort keys (§6.1)', () => {
  it('incremental refills after random edits equal parcelAt everywhere; the head is the front corner (the sweep key)', async () => {
    const { ParcelCache, parcelFromMap } = await import('../src/render/renderer');
    const w = megacityWorld(3, 1, 5);
    const cache = new ParcelCache();
    const map = cache.get(w);
    const N = w.N;
    let seed = 17;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const off = w.events.on('tiles', (r) => cache.touch(w, r));
    for (let k = 0; k < 400; k++) {
      const x = 64 + Math.floor(rnd() * 64);
      const y = 64 + Math.floor(rnd() * 64);
      const t = w.tileAt(x, y)!;
      if (t.terrain !== Terrain.Land || t.road || t.buildingId >= 0) continue;
      const op = rnd();
      if (op < 0.4) w.setLevel(x, y, 1 + Math.floor(rnd() * 3), rnd() < 0.1, Math.floor(rnd() * 3) as 0 | 1 | 2);
      else if (op < 0.7) w.setZone(x, y, (1 + Math.floor(rnd() * 3)) as ZoneType);
      else w.clearTile(x, y);
    }
    off();
    // Touches only mark blocks stale (§3.9 R0); sync makes a box exact, get everything.
    expect(cache.pending).toBeGreaterThan(0);
    const box = { x0: 80, y0: 80, x1: 95, y1: 95 };
    cache.sync(w, box, 0);
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) expect([x, y, map[y * N + x] & PARCEL_MEMBER ? 1 : 0]).toEqual([x, y, parcelAt(w, x, y) ? 1 : 0]);
    expect(cache.pending).toBeGreaterThan(0);
    expect(cache.get(w)).toBe(map);
    expect(cache.pending).toBe(0);
    const out: Parcel = { hx: 0, hy: 0, x: 0, y: 0, w: 1, h: 1, level: 0, tier: 0 };
    let parcels = 0;
    for (let y = 64; y < 128; y++)
      for (let x = 64; x < 128; x++) {
        const p = parcelAt(w, x, y);
        const q = parcelFromMap(w, map, x, y, out);
        if (!p) {
          expect(q).toBeNull();
          continue;
        }
        parcels++;
        expect({ ...q! }).toEqual(p);
        const bits = map[y * N + x];
        expect((bits & PARCEL_MEMBER) !== 0).toBe(true);
        // The head is the member with the largest x + y: the sweep reaches it last, after every member.
        expect((bits & PARCEL_HEAD) !== 0).toBe(x === p.hx && y === p.hy);
        expect(p.hx + p.hy).toBe(Math.max(...[0, 1].flatMap((dx) => [0, 1].map((dy) => (dx < p.w && dy < p.h ? p.x + dx + p.y + dy : -1)))));
      }
    expect(parcels).toBeGreaterThan(100);
    expect(cache.partial).toBeGreaterThan(0);
  });
});

describe('the Renderer with districts on the canvas mock (§3.9)', () => {
  const frame = (r: { render(dt: number, t: number): void }, n = 3) => {
    for (let k = 0; k < n; k++) r.render(1 / 60, 10 + k / 60);
  };

  it('bands: street at and above streetMinZoom, skyline below it (more than one district), the City map on snapToMap; one district keeps the street view', async () => {
    const { Renderer } = await import('../src/render/renderer');
    const g = new Game();
    g.restore(megacityWorld(3, 3, 11).serialize());
    const canvas = document.createElement('canvas');
    canvas.width = 390;
    canvas.height = 844;
    const cam = new Camera(g.world.N);
    const r = new Renderer(canvas, g, cam);
    try {
      resetMockStats();
      expect(cam.minZoom).toBe(0.22);
      cam.zoom = 0.6;
      cam.centerOnTile(96, 96);
      frame(r);
      expect(r.view.band).toBe('street');
      expect(r.view.streetMinZoom).toBe(0.4);
      expect(cam.streetMinZoom).toBe(0.4);
      cam.zoom = 0.3;
      cam.centerOnTile(96, 96);
      frame(r);
      expect(r.view.band).toBe('skyline');
      expect(r.view.skylineDrawn).toBeGreaterThan(0);
      expect(r.view.skylineDrawn).toBeLessThanOrEqual(2600);
      cam.snapToMap(0, 1, 0);
      frame(r, 30);
      expect(r.view.band).toBe('map');
      expect(r.pins).toEqual([]);
      cam.snapFromMap(195, 422, 0);
      frame(r);
      expect(r.view.band).toBe('skyline');
      expect(mockStats.errors).toEqual([]);
    } finally {
      r.destroy();
    }
    const one = new Game();
    const c1 = new Camera(one.world.N);
    const canvas1 = document.createElement('canvas');
    canvas1.width = 390;
    canvas1.height = 844;
    const r1 = new Renderer(canvas1, one, c1);
    try {
      expect(c1.minZoom).toBe(0.25);
      c1.zoom = 0.25;
      frame(r1);
      expect(r1.view.band).toBe('street');
    } finally {
      r1.destroy();
    }
  });

  it('lower detail (a 5×5 city with settings.lowerDetail): quality Low, streetMinZoom 0.5', async () => {
    const { Renderer } = await import('../src/render/renderer');
    const g = new Game();
    g.restore(megacityWorld(5, 2, 3).serialize());
    g.settings = { ...g.settings, lowerDetail: true, quality: 'high' };
    expect(g.lowerDetail).toBe(true);
    const canvas = document.createElement('canvas');
    canvas.width = 390;
    canvas.height = 844;
    const cam = new Camera(g.world.N);
    const r = new Renderer(canvas, g, cam);
    try {
      cam.zoom = 0.45;
      cam.centerOnTile(160, 160);
      frame(r, 17);
      expect(r.view.streetMinZoom).toBe(0.5);
      expect(r.view.band).toBe('skyline');
      expect(r.view.limits).toEqual({ capBytes: 20 * MB, budgetMs: 2 });
    } finally {
      r.destroy();
    }
  });

  it('the ground paints locked land as fog with no road, prop or glow, and the overview stays within its budget', async () => {
    const { GroundCache } = await import('../src/render/ground');
    const w = megacityWorld(5, 9, 21);
    const gc = new GroundCache();
    resetMockStats();
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    // Pan across the 5×5 region at a mid zoom, day then night.
    for (const night of [0, 1])
      for (let k = 0; k < 40; k++) {
        const tx = 40 + k * 6;
        const ty = 160;
        gc.draw(ctx, w, { camX: (tx - ty) * HALF_W, camY: (tx + ty) * HALF_H, zoom: 0.5, dpr: 2, width: 390, height: 844 }, night, 5, false);
      }
    expect(mockStats.errors).toEqual([]);
    const counts = gc.chunkCounts;
    expect(counts.overview * 516 * 516 * 4).toBeLessThanOrEqual(Math.max(4 * MB, 6 * 516 * 516 * 4));
  });

  it('a fast pan renders at most the per-frame chunk cap (current bucket and overview together); the underlay fills the holes', async () => {
    const { GroundCache } = await import('../src/render/ground');
    const { renderPasses, resetPasses } = await import('../src/render/passes');
    const proto = Object.getPrototypeOf(document.createElement('canvas').getContext('2d')) as { createImageData?: unknown };
    const had = proto.createImageData;
    proto.createImageData ??= (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch });
    try {
      const w = megacityWorld(5, 25, 21);
      const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      // The PC proxy (1920×1080 at its streetMinZoom 0.58) and a phone (390×844 at 0.4), a fast pan of 4–5 tiles a frame.
      for (const [width, height, zoom, budget, cap] of [
        [1920, 1080, 0.58, 5, 2],
        [390, 844, 0.4, 3, 1],
      ]) {
        const gc = new GroundCache();
        resetPasses();
        let most = 0;
        let total = 0;
        for (let k = 0; k < 60; k++) {
          const tx = 30 + ((k * 4) % 260);
          const ty = 40 + ((k * 3) % 240);
          gc.draw(ctx, w, { camX: (tx - ty) * HALF_W, camY: (tx + ty) * HALF_H, zoom, dpr: 1, width, height }, 0, budget, false);
          most = Math.max(most, gc.lastFullRenders);
          total += gc.lastFullRenders;
        }
        expect([width, most]).toEqual([width, cap]);
        expect(total).toBeGreaterThan(20);
        // One region pass to build the underlay; nothing more while panning.
        expect(renderPasses['region:underlay']).toBe(1);
      }
      expect(mockStats.errors).toEqual([]);
    } finally {
      if (!had) delete proto.createImageData;
    }
  });

  it('a night jump of 2+ buckets, or any change under a still camera, refreshes at the chunk cap, not one chunk per 120 ms', async () => {
    const { GroundCache } = await import('../src/render/ground');
    const w = megacityWorld(3, 9, 21);
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const gc = new GroundCache();
    const view = { camX: 0, camY: 96 * 2 * HALF_H, zoom: 0.5, dpr: 1, width: 1440, height: 900 };
    // Settle by day: every visible chunk painted.
    for (let k = 0; k < 60; k++) gc.draw(ctx, w, view, 0, 5, false);
    type C = { k: number; rendered: boolean; night: number; used: number };
    const chunks = () => [...(gc as unknown as { chunks: Map<number, C> }).chunks.values()].filter((c) => c.k !== -100 && c.rendered && c.used === (gc as unknown as { frame: number }).frame);
    const visible = chunks().length;
    expect(visible).toBeGreaterThan(6);
    // The day/night switch: daylight 1 → 0 (12 buckets) under a still camera; frames run back to back (no 120 ms gap).
    let frames = 0;
    for (; frames < 60; frames++) {
      gc.draw(ctx, w, view, 1, 5, false);
      if (chunks().every((c) => c.night === 12)) break;
    }
    expect(frames + 1).toBeLessThanOrEqual(Math.ceil(visible / 2) + 1);
    // A jump of 2+ buckets while the camera moves: also at the cap.
    let n = 0;
    for (; n < 60; n++) {
      view.camX += n % 2 ? 1 : -1;
      gc.draw(ctx, w, view, 0.5, 5, false);
      if (chunks().every((c) => c.night === 6)) break;
    }
    expect(n + 1).toBeLessThanOrEqual(Math.ceil(visible / 2) + 2);
  });
});
