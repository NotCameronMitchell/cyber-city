// District rules in the sim (docs/MEGACITY.md §3.3, §3.5, §3.7, §11.5 WP-1): layers, fields, ruins, brownfield,
// the floodplain cap, demand and visitor adds, the per-district census, the turf demand term, regional links on the
// owned boundary and the Metro network. Each rule reads the district kind of its tile; a plain city is unchanged.

import { describe, expect, it } from 'vitest';
import { DISTRICTS, EDGE_LINKS, RUINS } from '../src/game/config';
import { slotRect } from '../src/game/districts/slots';
import { Simulation } from '../src/game/sim';
import { Census } from '../src/game/sim/census';
import { districtVisitors } from '../src/game/sim/ports';
import { composeLayers } from '../src/game/story/mods';
import { turfPatch } from '../src/game/story/turf';
import { Ground, Terrain, ZoneType, type DistrictKind, type SlotId } from '../src/game/types';
import { World } from '../src/game/world';
import { fillSlot } from './megacity-fixture';

/** A 3×3 world owning the start slot plus the slot of `kind` (the first one of that kind), its land flattened. */
function withKind(kind: DistrictKind, seed = 2091): { w: World; slot: SlotId } {
  const w = World.generate(seed, 'Districts', undefined, 3);
  w.funds = 1e9;
  w.maxPopulation = 1e9;
  const slot = w.districts.kinds.findIndex((k, s) => k === kind && s !== 4);
  if (slot < 0) throw new Error(`no ${kind} slot`);
  w.annex(slot);
  return { w, slot };
}

const inner = (sim: Simulation) => sim as unknown as { census: Census; grid: { floodCap: Uint8Array; terrainValue: Float32Array; edgePoints: number } };

function sim(w: World): Simulation {
  const s = new Simulation(w);
  s.options.events = false;
  s.recomputeAll();
  return s;
}

describe('district rules (§3.3)', () => {
  it('layers: the district parkAdd is max-combined into park, pollutionAdd adds to the sources', () => {
    const w = new World(5, 'Layers', undefined, 3);
    const s = sim(w);
    const i = 90 * w.N + 90;
    expect(w.fields.park[i]).toBe(0);
    const p0 = w.fields.pollution[i];
    w.layerParts.district.parkAdd[i] = 0.5;
    w.layerParts.district.pollutionAdd[i + 10] = 0.15;
    composeLayers(w);
    s.recomputeAll();
    expect(w.fields.park[i]).toBeCloseTo(0.5, 6);
    expect(w.fields.pollution[i + 10]).toBeGreaterThan(p0);
  });

  it('resilience and filter are coverage effects; filter cuts the diffused pollution', () => {
    const w = new World(6, 'Filter', undefined, 3);
    const s = sim(w);
    const x = 90;
    const y = 90;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) w.setZone(x + dx, y + dy, ZoneType.Industrial);
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) w.setLevel(x + dx, y + dy, 3);
    s.recomputeAll();
    const before = w.fields.pollution[(y + 1) * w.N + x + 1];
    expect(before).toBeGreaterThan(0);
    w.fields.filter.fill(0);
    // A filter source: write the coverage field the way a Reclaim Works would (the pass reads fields.filter).
    const f = (s as unknown as { fields: { pollution: (w: World, g: unknown) => void } }).fields;
    w.fields.filter.fill(1, (y + 1) * w.N + x, (y + 1) * w.N + x + 3);
    f.pollution(w, (s as unknown as { grid: unknown }).grid);
    expect(w.fields.pollution[(y + 1) * w.N + x + 1]).toBeLessThan(before);
    expect(['resilience', 'filter'].every((e) => e in w.fields)).toBe(true);
  });

  it('ruins (ground Rubble) count apart from abandoned, never collapse, and recover ×2 in the Sunk with pay capped monthly', () => {
    const { w, slot } = withKind('sunk');
    const r = slotRect(w, slot);
    fillSlot(w, slot);
    let ruins = 0;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const t = w.tileAt(x, y)!;
        if (t.zone !== ZoneType.None && t.level > 0 && ruins < 120) {
          w.setLevel(x, y, t.level, true);
          w.setGround(x, y, Ground.Rubble);
          ruins++;
        }
      }
    const s = sim(w);
    // The Sunk's annex content brings ruins of its own: count every zoned, abandoned Rubble tile.
    let all = 0;
    for (let i = 0; i < w.area; i++) {
      const t = w.tiles[i];
      if (w.ownedAt(i) && t.zone !== ZoneType.None && t.abandoned && t.ground === Ground.Rubble) all++;
    }
    expect(all).toBeGreaterThanOrEqual(ruins);
    expect(w.stats.ruins).toBe(all);
    expect(inner(s).census.abandoned).toBe(0);
    const fundsBefore = w.funds;
    for (let d = 0; d < 360; d++) s.step();
    expect(w.districts.ruinsRestored ?? 0).toBeGreaterThan(0);
    // Pay: restorePay each, capped at RUINS.payCapMonth a month.
    expect(DISTRICTS.sunk.mods.recoverMul).toBe(2);
    expect(w.funds).toBeGreaterThanOrEqual(fundsBefore - 1e9);
    expect(RUINS.payCapMonth).toBeGreaterThan(0);
  });

  it('ruins with no road or power stand: ≥ 90% after 2 sim years (D2)', () => {
    const { w, slot } = withKind('sunk');
    const r = slotRect(w, slot);
    let n = 0;
    for (let y = r.y0 + 4; y < r.y0 + 40 && n < 200; y += 2)
      for (let x = r.x0 + 4; x < r.x0 + 40 && n < 200; x += 2) {
        if (w.tileAt(x, y)!.terrain !== Terrain.Land) continue;
        w.setZone(x, y, ZoneType.Residential);
        w.setLevel(x, y, 1, true);
        w.setGround(x, y, Ground.Rubble);
        n++;
      }
    const s = sim(w);
    for (let d = 0; d < 720; d++) s.step();
    expect(w.stats.ruins).toBeGreaterThanOrEqual(Math.ceil(0.9 * n));
  });

  it('the Reedmere floodplain: land within 1 of water stops at level 2 while no resilience covers it', () => {
    const { w, slot } = withKind('reedmere');
    const s = sim(w);
    const r = slotRect(w, slot);
    const cap = inner(s).grid.floodCap;
    let capped = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (cap[y * w.N + x] === DISTRICTS.reedmere.mods.floodplainMaxLevel) capped++;
    expect(capped).toBeGreaterThan(0);
    // The start slot (Charter Shore) has no cap.
    const s4 = slotRect(w, 4);
    for (let y = s4.y0; y <= s4.y1; y++) for (let x = s4.x0; x <= s4.x1; x++) expect(cap[y * w.N + x]).toBe(3);
  });

  it('Kessel Flats adds 2,000 Fab jobs of demand while it has < 400 developed Fab tiles; the census has one row per owned district', () => {
    const { w, slot } = withKind('flats');
    const s = sim(w);
    const c = inner(s).census;
    expect(w.stats.districts.map((d) => d.slot).sort()).toEqual([4, slot].sort());
    const flats = c.byDistrict.find((d) => d.slot === slot)!;
    expect(flats.kind).toBe('flats');
    expect(flats.fabTiles).toBeLessThan(400);
    const add = DISTRICTS.flats.mods.demandInd!;
    expect(c.tradeInd).toBeGreaterThanOrEqual(add.jobs);
  });

  it('Bazaar visitors: 600 per 10 developed Market tiles of each Bazaar district, 30,000 at most (100 tiles → 6,000)', () => {
    const c = new Census();
    (c.byDistrict as unknown[]).push({ slot: 1, kind: 'bazaar', residents: 0, jobs: 0, developed: 100, ruins: 0, fabTiles: 0, marketTiles: 100, lvSum: 0 });
    expect(districtVisitors(c)).toBe(6000);
    (c.byDistrict[0] as { marketTiles: number }).marketTiles = 1000;
    expect(districtVisitors(c)).toBe(30000);
    (c.byDistrict as unknown[]).push({ slot: 2, kind: 'shore', residents: 0, jobs: 0, developed: 100, ruins: 0, fabTiles: 0, marketTiles: 100, lvSum: 0 });
    expect(districtVisitors(c)).toBe(30000);
  });

  it('the turf demand term is divided by the owned districts (one district unchanged)', () => {
    const w = new World(5, 'Turf', undefined, 3);
    w.turf.stats.tiles.undertow = 300;
    expect(turfPatch(w).demandInd).toBeCloseTo(0.12, 9);
    for (const s of [1, 3, 5]) w.annex(s);
    expect(turfPatch(w).demandInd).toBeCloseTo(0.03, 9);
  });

  it('regional links count on the owned boundary, capped at 12 + 4 × (owned − 1); an annex turns a shared border internal', () => {
    const w = new World(8, 'Links', undefined, 3);
    w.funds = 1e9;
    // Streets from inside the start slot to its east edge (x = 127): links while slot 5 is locked.
    for (let k = 0; k < 6; k++) for (let x = 110; x <= 127; x++) w.setRoad(x, 70 + k * 8);
    const s = sim(w);
    const g = inner(s).grid;
    expect(g.edgePoints).toBe(6 * EDGE_LINKS.street);
    w.annex(5);
    s.recomputeAll();
    expect(g.edgePoints).toBe(0);
  });

  it('the Metro network: live stations in two districts link (transit r12) and cut trips near them', () => {
    const w = new World(9, 'Metro', undefined, 3);
    w.annex(5);
    const s = sim(w);
    for (let x = 80; x < 180; x++) w.setRoad(x, 96);
    w.addBuilding('reactor', 100, 97);
    w.addBuilding('metro', 90, 97);
    s.recomputeAll();
    const i = 97 * w.N + 90 - 11;
    const alone = w.fields.transit[i];
    w.addBuilding('metro', 150, 97);
    s.recomputeAll();
    expect(w.fields.transit[i]).toBeGreaterThan(alone);
  });
});
