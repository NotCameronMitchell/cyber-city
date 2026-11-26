// The City map and the annex sheet (docs/MEGACITY.md §7.2, §11.5's WP-5 row): slot states, price lines, the sticky
// footer's primary (Annex / Go there), lease gating, the two-step confirm, the goals list; on a 5×5 region the chip
// row, the diamond hit-test from any point inside a slot, and the 2× atlas zoom. The panel itself is DOM (checked in
// the browser at 390×844, 360×640 and 844×390); these are its pure parts on a real Game.

import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtPrice } from '../src/game/config';
import { adjacentLocked, slotRect } from '../src/game/districts/slots';
import { Game } from '../src/game/game';
import type { Building, Region, SlotId } from '../src/game/types';
import { World } from '../src/game/world';
import { zoomRange } from '../src/input/input';
import { MAP_PINCH_IN, MAP_PINCH_OUT, pinchMayLeaveMap } from '../src/input/mapbus';
import { Camera, HALF_H, HALF_W } from '../src/render/camera';
import {
  atlasZoomed,
  CITYMAP_HELP,
  CONFIRM_GUARD_MS,
  chipRow,
  balanceLine,
  censusLine,
  defaultSlot,
  footerModel,
  leaveMapTo,
  metroLine,
  metroNet,
  reactionSummary,
  slotAtScreen,
  slotScreenPoly,
  speakerName,
  terrainLine,
} from '../src/ui/citymap';

function city(region: Region, seed = 1234): Game {
  const g = new Game();
  expect(g.restore(JSON.parse(JSON.stringify(World.generate(seed, 'Map Bay', undefined, region).serialize())))).toBe(true);
  g.settings.lowerDetail = false;
  return g;
}

/** A camera framing the whole region as the City map does (390 × 844, the sheet over the bottom half). */
function mapCamera(g: Game, w = 390, h = 844, headroom = 1): Camera {
  const cam = new Camera(g.world.N);
  cam.setViewport(w, h);
  cam.setInsets({ top: 48 });
  cam.snapToMap(h / 2, headroom, 0);
  return cam;
}

describe('City map model (§7.2)', () => {
  it('a new 3×3 city: the start slot owned, its neighbours candidates, the corners not adjacent', () => {
    const g = city(3);
    const v = g.districtView();
    expect(v.region).toBe(3);
    expect(v.total).toBe(9);
    expect(v.owned).toBe(1);
    const states = v.slots.map((s) => s.state);
    expect(states[4]).toBe('owned');
    for (const s of [0, 2, 6, 8]) expect(['notAdjacent', 'notOpen']).toContain(states[s]);
    for (const s of [1, 3, 5, 7]) expect(['candidate', 'notOpen']).toContain(states[s]);
  });

  it('price lines: a grant, the wait for the next one, credits after an ending, not adjacent', () => {
    const g = city(3);
    const w = g.world;
    const cand = adjacentLocked(w).find((s) => g.districtView().slots[s].state === 'candidate')!;
    w.districts.grants = 2;
    let s = g.districtView().slots[cand];
    expect(s.price.text).toBe('Uses 1 land grant (1 left)');
    expect(footerModel(s, { lease: s.lease ? 'nacre' : null, confirming: false }).price).toBe('Uses 1 land grant (1 left)');
    w.districts.grants = 0;
    s = g.districtView().slots[cand];
    expect(s.price.text).toMatch(/^Next land grant: finish Chapter /);
    expect(footerModel(s, { lease: null, confirming: false }).enabled).toBe(false);
    // After an ending, no grant: the district's price in credits.
    w.story.ending = 'quiet';
    s = g.districtView().slots[cand];
    expect(s.price.text).toBe(`${districtPrice(w.districts.owned.length).toLocaleString('en-US')} CR · or wait for the next grant`);
    const farSlot = g.districtView().slots.find((x) => x.state === 'notAdjacent')!;
    expect(farSlot.price.text).toBe('Not next to the city yet');
    const far = footerModel(farSlot, { lease: null, confirming: false });
    expect(far.act).toBeNull();
    expect(far.price).toBe('Not next to the city yet');
  });

  it('the sticky footer always has a price line; Annex on a candidate, Go there on an owned district', () => {
    const g = city(3);
    g.world.districts.grants = 1;
    const v = g.districtView();
    for (const s of v.slots) {
      const f = footerModel(s, { lease: 'nacre', confirming: false });
      expect(f.price.length).toBeGreaterThan(0);
      if (s.state === 'owned') expect(f.act).toBe('go');
      else if (s.state === 'candidate') {
        expect(f.act).toBe('annex');
        expect(f.label).toBe(`Annex ${s.name}`);
      } else expect(f.act).toBeNull();
    }
  });

  it('the annex confirm takes two taps: armed only on request, never while the button is disabled', () => {
    const g = city(3);
    g.world.districts.grants = 1;
    const s = g.districtView().slots.find((x) => x.state === 'candidate' && !x.lease)!;
    expect(footerModel(s, { lease: null, confirming: false }).confirm).toBeNull();
    expect(footerModel(s, { lease: null, confirming: true }).confirm).toBe(`Annex ${s.name}?`);
    g.world.districts.grants = 0;
    const off = g.districtView().slots[s.slot];
    expect(footerModel(off, { lease: null, confirming: true }).confirm).toBeNull();
    // A save from a newer build blocks annexing (Game refuses it too).
    g.world.districts.grants = 1;
    const blocked = footerModel(g.districtView().slots[s.slot], { lease: null, confirming: true, blocked: true });
    expect(blocked.enabled).toBe(false);
    expect(blocked.confirm).toBeNull();
    expect(CONFIRM_GUARD_MS).toBeGreaterThanOrEqual(250);
  });

  it('lease gating: Tarmac Reach (variant 0) keeps Annex disabled until a lease is picked', () => {
    // Find a seed whose 3×3 layout puts Tarmac Reach next to the start slot.
    let g: Game | null = null;
    let slot: SlotId = -1;
    for (let seed = 1; seed < 400 && slot < 0; seed++) {
      const w = World.generate(seed, 'Lease', undefined, 3);
      const s = adjacentLocked(w).find((k) => w.districts.kinds[k] === 'tarmac');
      if (s !== undefined) {
        g = city(3, seed);
        slot = s;
      }
    }
    expect(slot).toBeGreaterThanOrEqual(0);
    g!.world.districts.grants = 1;
    const s = g!.districtView().slots[slot];
    expect(s.lease).not.toBeNull();
    const none = footerModel(s, { lease: null, confirming: true });
    expect(none.enabled).toBe(false);
    expect(none.confirm).toBeNull();
    expect(none.note).toBe('Pick who leases the old apron');
    const picked = footerModel(s, { lease: 'basalt', confirming: true });
    expect(picked.enabled).toBe(true);
    expect(picked.confirm).toBe(`Annex ${s.name}?`);
    // The lease reaction shows in the summary once picked.
    const sum = reactionSummary(g!.annexReactions(slot, 'basalt'));
    expect(sum).toContain('Basalt');
    // Game agrees: no lease, no annex.
    expect(g!.annex(slot).ok).toBe(false);
    expect(g!.annex(slot, 'basalt').ok).toBe(true);
  });

  it('owned districts list their goals with ticks and rewards; the footer counts them', () => {
    const g = city(3);
    const w = g.world;
    w.districts.grants = 1;
    w.story.flags.published = true;
    const cand = g.districtView().slots.find((s) => s.state === 'candidate' && !s.lease)!;
    expect(g.annex(cand.slot).ok).toBe(true);
    const s = g.districtView().slots[cand.slot];
    expect(s.state).toBe('owned');
    expect(s.goals.length).toBeGreaterThan(0);
    for (const gl of s.goals) {
      expect(gl.label.length).toBeGreaterThan(0);
      expect(gl.reward).toBeGreaterThan(0);
    }
    const f = footerModel(s, { lease: null, confirming: false });
    expect(f.price).toBe(`Part of the city · 0 of ${s.goals.length} district goals done`);
    expect(f.label).toBe('Go there');
  });

  it('the map opens on the slot asked for, else an affordable lease-free candidate, else the start district', () => {
    const g = city(3);
    const v0 = g.districtView();
    expect(defaultSlot(v0, 7)).toBe(7);
    expect(defaultSlot(v0, null, 4)).toBe(v0.slots.find((s) => s.state === 'candidate')!.slot);
    g.world.districts.grants = 1;
    const v1 = g.districtView();
    const pick = defaultSlot(v1, null, 4);
    expect(v1.slots[pick].canAnnex).toBe(true);
    expect(v1.slots[pick].lease).toBeNull();
  });

  it('the annex summary reads like a choice summary: +6 is ++, −2 is −, the lease +8 / −4 is ++ / −', () => {
    const plain = (html: string) => html.replace(/<[^>]+>/g, '');
    expect(plain(reactionSummary([{ f: 'basalt', v: 6 }, { f: 'nacre', v: -2 }]))).toBe('Basalt ++ · Nacre −');
    expect(plain(reactionSummary([{ f: 'nacre', v: 8 }, { f: 'basalt', v: -4 }]))).toBe('Nacre ++ · Basalt −');
  });

  it('copy: the help text, terrain line, speakers, census of a variant', () => {
    expect(CITYMAP_HELP).toContain('a 3×3 city can grow to 5×5 in Settings');
    expect(terrainLine({ land: 0.89, kind: 'flats' })).toBe('Land 89% · Water 11% · rail yards');
    expect(speakerName('basalt')).toBe('Sallow');
    expect(speakerName('undertow')).toBe('Old Brine');
    expect(speakerName('kites')).toBe('Lark');
    const g = city(5);
    const v = g.districtView();
    const variant = v.slots.find((s) => s.variant > 0)!;
    expect(censusLine({ ...variant, census: { residents: 412000, jobs: 98000, developed: 1, avgLandValue: 0.4, ruins: 0 } })).toBe(
      `${variant.name} · ${DISTRICTS[variant.kind].short} · 412k residents · 98k jobs`,
    );
  });

  it('the census balance line (§4.6): jobs per resident either way round, the land value, nothing for an empty district', () => {
    const c = (residents: number, jobs: number, lv = 0.42) => ({ residents, jobs, developed: 1, avgLandValue: lv, ruins: 0 });
    expect(balanceLine(c(170000, 100000))).toBe('1 job per 1.7 residents · Land value 42%');
    expect(balanceLine(c(187000, 273000, 0.18))).toBe('1.5 jobs per resident · Land value 18%');
    expect(balanceLine(c(0, 5000, 0.1))).toBe('Jobs, no homes yet · Land value 10%');
    expect(balanceLine(c(0, 0))).toBe('');
    expect(balanceLine(undefined)).toBe('');
  });
});

describe('Leaving the City map (§3.9, §7.2)', () => {
  /** A 5×5 camera on a city that owns the middle slots, as the partial 5×5 save does. */
  function cityCamera(): Camera {
    const cam = new Camera(320);
    cam.setViewport(390, 844);
    cam.minZoom = 0.22;
    cam.setBounds({ x0: 58, y0: 58, x1: 261, y1: 197 });
    cam.easeTo(1024, 4608, 0.8, 0);
    return cam;
  }

  it('✕ and Esc go back to the view the map opened from: its centre and its zoom', () => {
    const cam = cityCamera();
    const back = { x: cam.x, y: cam.y, zoom: cam.zoom };
    cam.setInsets({ top: 48 });
    cam.snapToMap(422, 2, 0);
    expect(cam.mapView).toBe(true);
    leaveMapTo(cam, back, { x: 195, y: 422 });
    expect(cam.mapView).toBe(false);
    cam.update(1);
    expect(cam.x).toBeCloseTo(1024, 3);
    expect(cam.y).toBeCloseTo(4608, 3);
    expect(cam.zoom).toBeCloseTo(0.8, 6);
  });

  it('opened from minZoom it comes back to minZoom at the same place', () => {
    const cam = cityCamera();
    cam.easeTo(1024, 4608, 0.22, 0);
    const back = { x: cam.x, y: cam.y, zoom: cam.zoom };
    cam.setInsets({ top: 48 });
    cam.snapToMap(422, 2, 0);
    leaveMapTo(cam, back, { x: 195, y: 422 });
    cam.update(1);
    expect(cam.zoom).toBeCloseTo(0.22, 6);
    expect(Math.hypot(cam.x - 1024, cam.y - 4608)).toBeLessThan(1);
  });

  it("the screen's centre would have landed on the far fogged corner of the owned box (the bug this replaces)", () => {
    const cam = cityCamera();
    cam.setInsets({ top: 48 });
    cam.snapToMap(422, 2, 0);
    cam.snapFromMap(195, 422);
    cam.update(1);
    const t = cam.screenToTile(195, 422);
    // Clamped to the bounds' bottom corner: outside every owned slot (6, 7, 8, 11, 12).
    expect(t.x).toBeGreaterThan(255);
    expect(t.y).toBeGreaterThan(191);
  });
});

describe('Metro lines on the City map (§7.2, §6.3)', () => {
  /** A 3×3 world owning `owned` (start slot 4 included) with fake buildings for the Metro read. */
  function metroWorld(owned: SlotId[], list: Partial<Building>[]) {
    const w = World.generate(77, 'Metro Bay', undefined, 3);
    for (const s of owned) if (!w.slotOwned[s]) w.annex(s);
    const buildings = new Map<number, Building>();
    list.forEach((b, i) => buildings.set(i + 1, { id: i + 1, type: 'metro', size: 1, builtTick: 0, offline: 0, powered: true, x: 0, y: 0, ...b } as Building));
    return { buildings, region: w.region, slotAt: (x: number, y: number) => w.slotAt(x, y), slotOwned: w.slotOwned };
  }
  /** A tile in slot `s` at (dx, dy) from its corner. */
  const at = (s: SlotId, dx = 32, dy = 32) => {
    const r = slotRect({ region: 3 }, s);
    return { x: r.x0 + dx, y: r.y0 + dy };
  };

  it('one district alone draws no line; the sheet says a second district links it', () => {
    const net = metroNet(metroWorld([4], [at(4)]));
    expect(net.stops).toEqual([]);
    expect(net.lines).toEqual([]);
    expect(net.live).toEqual([4]);
    expect(metroLine(net, 4)).toBe('Metro Station here: one in another district links them');
    expect(metroLine(net, 1)).toBe('');
  });

  it('live stations in three districts: three stops joined by two lines that link them all, the shortest way', () => {
    const net = metroNet(metroWorld([4, 1, 5], [at(4), at(1), at(5)]));
    expect(net.stops.map((s) => s.slot)).toEqual([1, 4, 5]);
    expect(net.lines.length).toBe(2);
    // Slots 1 and 5 touch only at a corner: the tree runs through the start district, never 1–5 directly.
    const pairs = net.lines.map(([a, b]) => [net.stops[a].slot, net.stops[b].slot].sort((x, y) => x - y).join('-')).sort();
    expect(pairs).toEqual(['1-4', '4-5']);
    // Stops sit on their station's tile centre in world px.
    const p = at(4);
    const stop = net.stops.find((s) => s.slot === 4)!;
    expect(stop.x).toBe((p.x - p.y) * HALF_W);
    expect(stop.y).toBe((p.x + p.y + 1) * HALF_H);
    expect(metroLine(net, 4)).toBe('Metro: linked to 2 other districts');
    const two = metroNet(metroWorld([4, 1], [at(4), at(1)]));
    expect(metroLine(two, 1)).toBe('Metro: linked to 1 other district');
  });

  it('only live stations in owned districts count: unpowered, offline, still building or locked land draw nothing', () => {
    const dead = metroWorld([4, 1], [at(4), { ...at(1), powered: false }, { ...at(1, 10, 10), offline: 3 }, { ...at(1, 20, 20), buildDays: 2 }, at(7)]);
    const net = metroNet(dead);
    expect(net.live).toEqual([4]);
    expect(net.lines).toEqual([]);
    // Other building types never count.
    expect(metroNet(metroWorld([4, 1], [at(4), { ...at(1), type: 'maglev' }])).live).toEqual([4]);
  });

  it('a district with several stations shows one stop: the one nearest its centre', () => {
    const net = metroNet(metroWorld([4, 1], [at(4), at(1, 2, 2), at(1, 30, 35), at(1, 60, 60)]));
    const p = at(1, 30, 35);
    const stop = net.stops.find((s) => s.slot === 1)!;
    expect(stop.x).toBe((p.x - p.y) * HALF_W);
    expect(net.lines.length).toBe(1);
  });
});

describe('5×5 City map (§7.2)', () => {
  it('the chip row: every candidate (+) first, then every owned district, once each; none on 3×3', () => {
    expect(chipRow(city(3).districtView())).toEqual([]);
    const g = city(5);
    g.world.districts.grants = 3;
    for (let k = 0; k < 3; k++) {
      const c = g.districtView().slots.find((s) => s.canAnnex && !s.lease)!;
      expect(g.annex(c.slot).ok).toBe(true);
    }
    const v = g.districtView();
    const chips = chipRow(v);
    const cands = v.slots.filter((s) => s.state === 'candidate').map((s) => s.slot);
    const owned = v.slots.filter((s) => s.state === 'owned').map((s) => s.slot);
    expect(chips.map((c) => c.slot)).toEqual([...cands, ...owned]);
    expect(new Set(chips.map((c) => c.slot)).size).toBe(chips.length);
    expect(chips.every((c) => (c.kind === 'candidate') === cands.includes(c.slot))).toBe(true);
    expect(owned.length).toBe(4);
  });

  it('a tap anywhere inside a slot diamond selects that slot (centre and near every corner), off the region none', () => {
    for (const [w, h] of [
      [390, 844],
      [360, 640],
    ]) {
      const g = city(5);
      const cam = mapCamera(g, w, h, 2);
      for (let s = 0; s < 25; s++) {
        const r = slotRect(g.world, s);
        const pts: [number, number][] = [
          [r.x0 + 32, r.y0 + 32],
          [r.x0 + 2, r.y0 + 2],
          [r.x1 - 1, r.y0 + 2],
          [r.x1 - 1, r.y1 - 1],
          [r.x0 + 2, r.y1 - 1],
        ];
        for (const [tx, ty] of pts) {
          const p = cam.worldToScreen((tx - ty) * HALF_W, (tx + ty) * HALF_H);
          expect(slotAtScreen(g.world, cam, p.x, p.y)).toBe(s);
        }
        // The outline is the slot's diamond: four corners, top above bottom.
        const poly = slotScreenPoly(g.world, cam, s);
        expect(poly.length).toBe(4);
        expect(poly[0][1]).toBeLessThan(poly[2][1]);
      }
      expect(slotAtScreen(g.world, cam, 2, 60)).toBe(-1);
      // Slot diamonds at phone width are about 72 × 36 px at 390 and 66 × 33 at 360 (§7.2): smaller than a 44 px
      // target, hence the chips.
      const poly = slotScreenPoly(g.world, cam, 12);
      const dw = poly[1][0] - poly[3][0];
      expect(dw).toBeGreaterThan(55);
      expect(dw).toBeLessThan(90);
    }
  });

  it('the atlas zooms to 2× fit and back, never further (a handheld 5×5 map; 3×3 has no zoom)', () => {
    const g = city(5);
    const cam = mapCamera(g, 390, 844, 2);
    const fit = cam.mapZoom;
    expect(zoomRange(cam)).toEqual({ lo: fit, hi: fit * 2 });
    cam.zoomAt(5, 195, 300);
    expect(cam.zoom).toBeCloseTo(fit * 2, 9);
    cam.zoomAt(0.1, 195, 300);
    expect(cam.zoom).toBeCloseTo(fit, 9);
    // The edge line under the atlas steps aside only while the atlas is shown past its fit.
    expect(atlasZoomed(cam)).toBe(false);
    cam.zoomAt(1.5, 195, 300);
    expect(atlasZoomed(cam)).toBe(true);
    cam.zoomAt(0.1, 195, 300);
    expect(atlasZoomed(cam)).toBe(false);
    const g3 = city(3);
    const cam3 = mapCamera(g3, 390, 844, 1);
    cam3.zoomAt(2, 195, 300);
    expect(cam3.zoom).toBeCloseTo(cam3.mapZoom, 9);
    // The pinch thresholds that open and leave the map need a deliberate gesture.
    expect(MAP_PINCH_OUT).toBeLessThan(0.9);
    expect(MAP_PINCH_IN).toBeGreaterThan(1.1);
    // A pinch that zooms a 5×5 atlas in stops at 2× and stays on the map; only a new pinch at 2× leaves it. On a 3×3
    // map (no headroom) a pinch-in leaves at once.
    expect(pinchMayLeaveMap(fit, fit, 2)).toBe(false);
    expect(pinchMayLeaveMap(fit * 1.6, fit, 2)).toBe(false);
    expect(pinchMayLeaveMap(fit * 2, fit, 2)).toBe(true);
    expect(pinchMayLeaveMap(cam3.mapZoom, cam3.mapZoom, 1)).toBe(true);
  });

  it('the region sits in the middle of the area the header and the sheet leave, on every phone size and region', () => {
    for (const region of [3, 5] as const)
      for (const [W, H] of [
        [390, 844],
        [360, 640],
      ]) {
        const n = region * 64;
        const cam = new Camera(n);
        cam.setViewport(W, H);
        cam.setInsets({ top: 48 });
        // The resting sheet covers half the screen, plus the 58 px edge line of a whole region.
        const bottom = Math.round(H / 2) + 58;
        cam.snapToMap(bottom, 1, 0);
        const top = cam.worldToScreen(0, 0).y;
        const low = cam.worldToScreen(0, n * 2 * HALF_H).y;
        const mid = (48 + (H - bottom)) / 2;
        expect(Math.abs((top + low) / 2 - mid)).toBeLessThan(2);
        expect(top).toBeGreaterThanOrEqual(48);
        expect(low).toBeLessThanOrEqual(H - bottom);
      }
  });
});
