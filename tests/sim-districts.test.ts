// District rules in the sim (docs/MEGACITY.md §3.3, §3.5, §3.7, §11.5 WP-1): layers, fields, brownfield (ruins: ruins.test.ts),
// the floodplain cap, demand and visitor adds, the per-district census, the turf demand term, regional links on the
// owned boundary and the Metro network. Each rule reads the district kind of its tile; a plain city is unchanged.

import { describe, expect, it } from 'vitest';
import { DISTRICTS, EDGE_LINKS, TOURISM, TURF } from '../src/game/config';
import { slotRect } from '../src/game/districts/slots';
import { Simulation } from '../src/game/sim';
import { Census, landmarkTerms } from '../src/game/sim/census';
import { MEGA_LANDMARK_VISITORS } from '../src/game/sim/tuning';
import { districtVisitors } from '../src/game/sim/ports';
import { composeLayers } from '../src/game/story/mods';
import * as turf from '../src/game/story/turf';
import { turfPatch } from '../src/game/story/turf';
import { Terrain, ZoneType, type DistrictKind, type SlotId } from '../src/game/types';
import { World } from '../src/game/world';

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
    composeLayers(w, true); // written in place, without a reset
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

  it('a terrain change (a Pump House ring) recomputes the terrain value and floodplain caps near it only, exactly as a whole pass', () => {
    const { w, slot } = withKind('reedmere');
    const s = sim(w);
    const g = inner(s).grid as unknown as { terrainValue: Float32Array; floodCap: Uint8Array; computeTerrainValue: (w: World) => void };
    let whole = 0;
    const full = g.computeTerrainValue.bind(g);
    g.computeTerrainValue = (x: World) => {
      whole++;
      full(x);
    };
    const r = slotRect(w, slot);
    // Raise a few water tiles to land and sink a few land tiles, as reclamation and a test would.
    let changed = 0;
    for (let y = r.y0 + 10; y < r.y0 + 30 && changed < 24; y++)
      for (let x = r.x0 + 10; x < r.x0 + 30 && changed < 24; x++) {
        const t = w.tileAt(x, y)!;
        if ((x + y) % 5 !== 0 || t.buildingId >= 0) continue;
        w.setTerrain(x, y, t.terrain === Terrain.Water ? Terrain.Land : Terrain.Water);
        changed++;
      }
    expect(changed).toBe(24);
    s.step();
    expect(whole).toBe(0);
    const ref = inner(sim(w)).grid;
    expect(Array.from(g.terrainValue)).toEqual(Array.from(ref.terrainValue));
    expect(Array.from(g.floodCap)).toEqual(Array.from(ref.floodCap));
    // An annex still recomputes everything.
    w.annex(w.districts.kinds.findIndex((_, k) => !w.slotOwned[k]));
    s.step();
    expect(whole).toBe(1);
  });

  it('city life terms (MEGACITY §6.4.1): visitors, approval and Market demand while the happening has sim days left, one day at a time', () => {
    const w = new World(12, 'Life', undefined, 3);
    w.funds = 1e9;
    for (let x = 70; x < 120; x++) w.setRoad(x, 96);
    w.addBuilding('reactor', 66, 97);
    for (let x = 70; x < 120; x++) {
      w.setZone(x, 97, ZoneType.Residential);
      w.setLevel(x, 97, 2);
      if (x % 4 === 0) {
        w.setZone(x, 95, ZoneType.Commercial);
        w.setLevel(x, 95, 1);
      }
    }
    const s = sim(w);
    const approval = () => inner(s).census.approval(w, (s as unknown as { power: never }).power);
    const plain = { visitors: s.ports.visitors, approval: approval() };
    const target = { res: 0, com: 0, ind: 0 };
    inner(s).census.demandTarget(w, 60, 0, target);
    w.cityEvent = { id: 'parade', until: 60, daysLeft: 3, visitors: 5000, approval: 4, demandCom: 0.1 };
    s.recomputeAll();
    // A monthly rate, scaled by the tourism mood like every visitor source.
    expect(s.ports.visitors).toBeGreaterThanOrEqual(plain.visitors + Math.floor(5000 * TOURISM.moodMin * (1 - TOURISM.crimeHit) * 0.95));
    // On the same census: the happening's approval term is added as is.
    // A bare test street reads 0 (no jobs, no services): lift it into range so the term is not clamped away.
    const raw = () => {
      w.cityEvent!.daysLeft = 0;
      const lo = inner(s).census.approval(w, (s as unknown as { power: never }).power);
      w.cityEvent!.daysLeft = 3;
      return lo;
    };
    // Shift the approval into (0, 100) with the story's additive term, so the clamp cannot hide the happening's.
    for (const a of [0, 50, 100, 150, 200, 300, 400, -50, -100]) {
      w.mods.approvalAdd = a;
      const v = raw();
      if (v > 10 && v < 90) break;
    }
    expect(raw()).toBeGreaterThan(10);
    const on = approval();
    w.cityEvent!.daysLeft = 0;
    const off = approval();
    w.cityEvent!.daysLeft = 3;
    expect(on - off).toBeCloseTo(4, 6);
    void plain.approval;
    const withLife = { res: 0, com: 0, ind: 0 };
    inner(s).census.demandTarget(w, 60, 0, withLife);
    // The term adds inside demandTarget's outer clamp to ±1.
    expect(withLife.com).toBeGreaterThan(target.com);
    if (target.com > -0.9 && target.com < 0.9) expect(withLife.com - target.com).toBeCloseTo(0.1, 6);
    else expect(withLife.com - target.com).toBeLessThanOrEqual(0.1 + 1e-9);
    // The terms count down one sim day per day and stop at 0.
    s.step();
    expect(w.cityEvent!.daysLeft).toBe(2);
    s.step();
    s.step();
    expect(w.cityEvent!.daysLeft).toBe(0);
    s.recomputeAll();
    expect(s.ports.visitors).toBe(plain.visitors);
    s.step();
    expect(w.cityEvent!.daysLeft).toBe(0);
  });

  it('§6.3 landmark visitors: Pearl Atrium, Harbour Beacon, Arc Arena and each Market Hall when live; a Halo Lookout only in a Sky Lobby', () => {
    const base = () => {
      const w = new World(12, 'Landmarks', undefined, 3);
      w.funds = 1e9;
      for (let x = 60; x < 120; x++) w.setRoad(x, 96);
      w.addBuilding('reactor', 66, 97);
      for (let x = 70; x < 120; x++) {
        w.setZone(x, 97, ZoneType.Residential);
        w.setLevel(x, 97, 2);
      }
      return w;
    };
    // Raw visitors (before the tourism mood, which the landmark itself moves): visitors / mood.
    const rawOf = (w: World, s: Simulation) => {
      const c = inner(s).census;
      let mood = Math.min(TOURISM.moodMax, Math.max(TOURISM.moodMin, w.stats.approval / TOURISM.approvalRef));
      mood *= 1 - TOURISM.crimeHit * c.avgCrime;
      return s.ports.visitors / mood;
    };
    // Each landmark on the road, powered: its raw visitors against the same town without it.
    const raw = (type: Parameters<World['addBuilding']>[0], lobby = false) => {
      const w = base();
      const plain = rawOf(w, sim(w));
      const b = w.addBuilding(type, 100, 97 - 4)!;
      expect(b).toBeTruthy();
      for (let y = b.y + b.size; y < 96; y++) w.setRoad(b.x, y);
      if (lobby) w.vertical.lobbies = [{ anchors: [b.y * w.N + b.x, 1, 2], visitors: 0 }];
      const s = sim(w);
      expect(w.buildings.get(b.id)!.powered).toBe(true);
      return rawOf(w, s) - plain;
    };
    // Visitors are whole tens (POP_SCALE) after the mood (±10 / mood of rounding), and a big landmark's jobs nudge the
    // high-tier Market count a little: within 45 or 2%.
    for (const [type, v] of [['memorial', 2000], ['pearlatrium', 20000], ['beacon', 5000], ['arena', 25000], ['markethall', 1500]] as const) {
      expect(TOURISM.landmark[type] ?? MEGA_LANDMARK_VISITORS[type]).toBe(v);
      expect(Math.abs(raw(type) - v), type).toBeLessThan(Math.max(45, v * 0.02));
    }
    expect(Math.abs(raw('halolookout'))).toBeLessThan(45);
    expect(Math.abs(raw('halolookout', true) - 15000)).toBeLessThan(45);
  });

  it('§6.3 terms: Charter Hall +3 and Lamp Choir +2 approval while they stand, Market Halls +0.5 approval / +0.01 demand each (caps 2 / 0.05); a Lamp Choir cuts upkeep ×0.98', () => {
    const w = new World(12, 'Terms', undefined, 3);
    w.funds = 1e9;
    for (let x = 60; x < 130; x++) w.setRoad(x, 96);
    w.addBuilding('reactor', 66, 97);
    for (let x = 70; x < 130; x++) {
      w.setZone(x, 97, ZoneType.Residential);
      w.setLevel(x, 97, 2);
    }
    const s = sim(w);
    const approval = () => inner(s).census.approval(w, (s as unknown as { power: never }).power);
    // Lift the approval into (0, 100) so the clamp cannot hide the terms.
    for (const a of [0, 30, 60, -30, -60, 90]) {
      w.mods.approvalAdd = a;
      const v = approval();
      if (v > 20 && v < 70) break;
    }
    const demand = () => {
      const t = { res: 0, com: 0, ind: 0 };
      inner(s).census.demandTarget(w, 60, 0, t);
      return t.com;
    };
    const a0 = approval();
    const d0 = demand();
    const upkeep0 = w.budget.expenses;
    w.addBuilding('charterhall', 80, 92);
    w.addBuilding('lampchoir', 90, 93);
    for (let k = 0; k < 6; k++) w.addBuilding('markethall', 100 + k * 3, 94);
    s.recomputeAll();
    // Six halls: +3 approval capped at +2, +0.06 demand capped at +0.05.
    expect(landmarkTerms(w)).toMatchObject({ approval: 3 + 2 + 2, demandCom: 0.05 });
    // The census adds exactly these: the same census with the three types not standing (under construction) reads 7 less.
    const on = approval();
    const dOn = demand();
    const types = new Set(['charterhall', 'lampchoir', 'markethall']);
    for (const b of w.buildings.values()) if (types.has(b.type)) b.buildDays = 5;
    w.markChanged(0, 0);
    expect(landmarkTerms(w)).toMatchObject({ approval: 0, demandCom: 0 });
    expect(on - approval()).toBeCloseTo(7, 6);
    if (dOn > -0.9 && dOn < 0.9) expect(dOn - demand()).toBeCloseTo(0.05, 6);
    for (const b of w.buildings.values()) if (types.has(b.type)) b.buildDays = 0;
    void a0;
    void d0;
    // Upkeep: the choir's own and the halls' upkeep join, and every line is × 0.98.
    s.recomputeAll();
    const plants = () => w.budget.expenseLines.find((l) => l.label === 'Power plants')!.amount;
    const withChoir = plants();
    w.removeBuilding(w.buildingAt(90, 93)!.id);
    s.recomputeAll();
    const without = plants();
    expect(without).toBeGreaterThan(withChoir);
    expect(Math.abs(without - withChoir / 0.98)).toBeLessThanOrEqual(1);
    expect(upkeep0).toBeGreaterThan(0);
  });

  it('Saltglass Shoals bridges cost ×0.7 upkeep (§3.7, DISTRICTS.shoals.mods.bridgeUpkeepMul); a bridge elsewhere the full rate', () => {
    const { w, slot } = withKind('shoals');
    const r = slotRect(w, slot);
    // A 10-tile street bridge on Shoals water, and the same over start-slot water if it has any.
    const bridge = (x0: number, x1: number, y: number) => {
      for (let x = x0; x <= x1; x++) {
        w.tiles[w.idx(x, y)].terrain = Terrain.Water;
        w.setRoad(x, y);
      }
    };
    const s = sim(w);
    const roads = () => w.budget.expenseLines.find((l) => l.label === 'Roads')?.amount ?? 0;
    const before = roads();
    bridge(r.x0 + 10, r.x0 + 19, r.y0 + 30);
    s.recomputeAll();
    const shoals = roads() - before;
    const s0 = slotRect(w, 4);
    bridge(s0.x0 + 10, s0.x0 + 19, s0.y0 + 30);
    s.recomputeAll();
    const plain = roads() - before - shoals;
    expect(plain).toBeGreaterThan(0);
    expect(shoals / plain).toBeCloseTo(DISTRICTS.shoals.mods.bridgeUpkeepMul!, 1);
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

describe('turf in districts (§3.7, §6.2, §8.4)', () => {
  const month = (w: World) => {
    w.tick += 30;
    turf.update(w);
  };

  it('a frame keeps its turf (Skeleton Row, as world.ts TURF_KEEPING); other buildings do not', () => {
    const w = new World(3, 'Frames', undefined, 3);
    w.funds = 1e9;
    expect(w.addBuilding('frame', 80, 80)).toBeTruthy();
    expect(w.addBuilding('clinic', 90, 80)).toBeTruthy();
    expect(turf.isEligible(w, 80, 80)).toBe(true);
    expect(turf.isEligible(w, 90, 80)).toBe(false);
    expect(turf.seedGang(w, 'kites', 81, 81, 60)).toBeGreaterThan(0);
    expect(turf.ownerAt(w, 80, 80)).toBe('kites');
  });

  it('a Salvage crown shelters Undertow turf within r2 of its Stratablock (MEGACITY §6.2), as the Kite Nest does the Kites', () => {
    const w = new World(4, 'Salvage', undefined, 3);
    w.funds = 1e9;
    w.maxPopulation = 1e9;
    w.turf.seeded.undertow = true;
    w.turf.seeded.kites = true;
    const b = w.addBuilding('stack', 90, 90)!;
    b.powered = true;
    w.setStage(b, 3, 0, 'salvage');
    // A strip of Undertow turf east of the block: tiles 1..2 past its footprint are sheltered, 3 and beyond are not.
    const x1 = b.x + b.size - 1;
    const y = b.y + 1;
    for (let x = x1 + 1; x <= x1 + 8; x++) {
      const i = w.idx(x, y);
      w.turf.owner[i] = 1;
      w.turf.str[i] = 60;
    }
    // Full security: the hold loses TURF.securityPenalty a month, more than the affinity gives back here.
    w.fields.security.fill(1);
    const aff = turf.affinity(w, 'undertow');
    expect(Math.round((aff[w.idx(x1 + 1, y)] - TURF.holdPivot) * TURF.holdGain)).toBeLessThan(TURF.securityPenalty);
    month(w);
    month(w);
    const str = (x: number) => (turf.ownerAt(w, x, y) === 'undertow' ? w.turf.str[w.idx(x, y)] : 0);
    expect(str(x1 + 1)).toBeGreaterThanOrEqual(TURF.protectFloor);
    expect(str(x1 + 2)).toBeGreaterThanOrEqual(TURF.protectFloor);
    expect(str(x1 + 4)).toBeLessThan(TURF.protectFloor);
    // Without the crown the same strip decays everywhere.
    w.setStage(b, 3, 0, 'commons');
    for (let x = x1 + 1; x <= x1 + 8; x++) {
      const i = w.idx(x, y);
      w.turf.owner[i] = 1;
      w.turf.str[i] = 60;
    }
    month(w);
    month(w);
    expect(str(x1 + 1)).toBeLessThan(TURF.protectFloor);
  });

  it("the Undertow's first seed prefers an owned Sunk's best tile (§3.7), else the best tile near the city", () => {
    const seedAt = (annexSunk: boolean): number => {
      const { w, slot } = withKind('sunk');
      if (!annexSunk) {
        // The same city with the Sunk left locked: rebuild it without the annex.
        const v = World.generate(2091, 'Districts', undefined, 3);
        v.funds = 1e9;
        v.maxPopulation = 1e9;
        return seedOn(v, slot);
      }
      return seedOn(w, slot);
    };
    const seedOn = (w: World, sunk: SlotId): number => {
      // A small city in the start slot: roads and developed Hab, so the best tile near the city is there.
      for (let x = 70; x < 120; x++) w.setRoad(x, 96);
      for (let x = 70; x < 120; x++) {
        w.setZone(x, 97, ZoneType.Residential);
        if (w.tileAt(x, 97)?.zone === ZoneType.Residential) w.setLevel(x, 97, 2);
      }
      w.turf.seeded.kites = true;
      month(w);
      expect(w.turf.seeded.undertow).toBe(true);
      let inSunk = 0;
      let total = 0;
      for (let i = 0; i < w.area; i++)
        if (w.turf.owner[i] === 1) {
          total++;
          if (w.slotAt(i % w.N, (i / w.N) | 0) === sunk) inSunk++;
        }
      expect(total).toBeGreaterThan(0);
      return inSunk / total;
    };
    expect(seedAt(true)).toBe(1);
    expect(seedAt(false)).toBe(0);
  });
});
