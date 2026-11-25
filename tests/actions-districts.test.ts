// District rules in actions.ts (docs/MEGACITY.md §3.4, §3.5, §3.7, §6.3; WP-2), on both regions: locked land refuses
// every tool, district prices (Shoals bridges, Tarmac roads, Terraces slopes, Kessel Fab zoning, buildCostMul inside a
// district), port limits by districts owned, flat ground, water and shore sites, district-bound and gated buildings,
// the pump-hall radius, sponsors and looks, fixed annex structures, ruin restore pay.

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  buildingCost,
  districtRoadMul,
  lockedReason,
  planAction,
  portLimitReason,
  ruinRestored,
} from '../src/game/actions';
import { BUILDINGS, PORT_LIMITS, ROAD_KINDS, RUINS, ZONES } from '../src/game/config';
import { slotRect } from '../src/game/districts/slots';
import { Ground, REGIONS, RoadKind, Terrain, ZoneType, type BuildingType, type DistrictKind, type Region, type ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { sx, sy } from './helpers';

/** A blank (all-land) world of a region, rich, with the slot of `kind` annexed (content placed). */
function withKind(R: Region, kind: DistrictKind, seed = 2091): { w: World; s: number; x0: number; y0: number; x1: number; y1: number } {
  const w = new World(seed, 'Rules', undefined, R);
  w.funds = 1e9;
  w.maxPopulation = 1e7;
  const s = w.districts.kinds.indexOf(kind);
  expect(s).toBeGreaterThanOrEqual(0);
  w.annex(s);
  // Clear what annexing placed: these tests are about the rules, not the content.
  const r = slotRect(w, s);
  for (const b of [...w.buildings.values()]) w.removeBuilding(b.id);
  for (let y = r.y0; y <= r.y1; y++)
    for (let x = r.x0; x <= r.x1; x++) {
      w.clearTile(x, y);
      w.setGround(x, y, Ground.Plain);
    }
  return { w, s, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
}

/** Show hidden Megacity types for one test (their art is WP-4's; their rules are WP-2's). */
function shown<T>(types: BuildingType[], fn: () => T): T {
  const was = types.map((t) => BUILDINGS[t].hidden);
  for (const t of types) (BUILDINGS[t] as { hidden?: boolean }).hidden = false;
  try {
    return fn();
  } finally {
    types.forEach((t, k) => ((BUILDINGS[t] as { hidden?: boolean }).hidden = was[k]));
  }
}

/** Water on a rect (test setup: World only reclaims water → land through setTerrain). */
function water(w: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.tiles[w.idx(x, y)].terrain = Terrain.Water;
}

describe.each(REGIONS)('%i×%i: locked land (§3.4)', (R) => {
  it('every tool is refused on a locked tile with "Not annexed yet" and the slot; bulldoze ignores it', () => {
    const w = new World(7, 'Locked', undefined, R);
    w.funds = 1e9;
    w.maxPopulation = 1e7;
    w.story.unlocks.push('skybridge', 'rail');
    const lx = sx(-5, R);
    const ly = sy(10, R);
    const slot = w.slotAt(lx, ly);
    const tools: ToolId[] = ['road', 'alley', 'avenue', 'res', 'com', 'ind', 'solar', 'precinct', 'rail', 'skyway'];
    for (const tool of tools) {
      const p = planAction(w, tool, { x: lx - 3, y: ly }, { x: lx, y: ly });
      expect(p.valid, tool).toBe(false);
      expect(p.reason, tool).toBe('Not annexed yet');
      expect(p.slot, tool).toBe(slot);
    }
    const b = planAction(w, 'bulldoze', { x: lx - 3, y: ly }, { x: lx, y: ly });
    expect(b.valid).toBe(false);
    expect(b.reason).toBe('Nothing to demolish');
    expect(lockedReason(w, 'road')).toBeNull();
  });
});

describe.each(REGIONS)('%i×%i: district prices (§3.7)', (R) => {
  it('Shoals bridges ×0.6 (D2), Tarmac roads ×0.7, Terraces slopes ×2', () => {
    const sh = withKind(R, 'shoals');
    water(sh.w, sh.x0 + 10, sh.y0 + 10, sh.x0 + 20, sh.y0 + 10);
    const bridge = planAction(sh.w, 'road', { x: sh.x0 + 10, y: sh.y0 + 10 }, { x: sh.x0 + 20, y: sh.y0 + 10 });
    const plainWater = new World(1, 'Plain', undefined, R);
    plainWater.funds = 1e9;
    const c = sx(10, R);
    water(plainWater, c, c, c + 10, c);
    const today = planAction(plainWater, 'road', { x: c, y: c }, { x: c + 10, y: c });
    expect(bridge.cost).toBe(Math.round(today.cost * 0.6));
    expect(districtRoadMul(sh.w, sh.x0 + 12, sh.y0 + 10, true)).toBe(0.6);

    const ta = withKind(R, 'tarmac');
    const road = planAction(ta.w, 'road', { x: ta.x0 + 5, y: ta.y0 + 5 }, { x: ta.x0 + 24, y: ta.y0 + 5 });
    expect(road.cost).toBe(Math.round(20 * ROAD_KINDS[RoadKind.Street].cost * 0.7));

    const te = withKind(R, 'terraces');
    for (let y = te.y0; y <= te.y1; y++) for (let x = te.x0 + 20; x <= te.x1; x++) te.w.tiles[te.w.idx(x, y)].elev = 1;
    // Tiles at x0+19 and x0+20 sit next to a different step: they cost double.
    const slope = planAction(te.w, 'road', { x: te.x0 + 15, y: te.y0 + 5 }, { x: te.x0 + 24, y: te.y0 + 5 });
    expect(slope.cost).toBe(Math.round((8 + 2 * 2) * ROAD_KINDS[RoadKind.Street].cost));
  });

  it('Kessel Flats Fab zoning ×0.5 (D2) and a reactor 15% off only with its whole footprint inside', () => {
    const f = withKind(R, 'flats');
    const z = planAction(f.w, 'ind', { x: f.x0 + 4, y: f.y0 + 4 }, { x: f.x0 + 7, y: f.y0 + 7 });
    expect(z.cost).toBe(16 * ZONES.ind.cost * 0.5);
    const res = planAction(f.w, 'res', { x: f.x0 + 4, y: f.y0 + 4 }, { x: f.x0 + 7, y: f.y0 + 7 });
    expect(res.cost).toBe(16 * ZONES.res.cost);
    expect(buildingCost(f.w, 'reactor', { x: f.x0 + 10, y: f.y0 + 10, size: 3 })).toBe(Math.round(BUILDINGS.reactor.cost * 0.85));
    // Straddling the border with the start slot: no district price.
    const s = f.w.slotAt(f.x0, f.y0);
    const start = (R * R - 1) >> 1;
    const r = slotRect(f.w, start);
    const edgeX = s % R < start % R ? f.x0 + 63 : f.x0 - 1;
    const edgeY = Math.floor(s / R) === Math.floor(start / R) ? r.y0 + 10 : r.y0;
    expect(buildingCost(f.w, 'reactor', { x: Math.min(edgeX, edgeX - 1), y: edgeY, size: 3 })).toBe(BUILDINGS.reactor.cost);
    expect(buildingCost(f.w, 'reactor')).toBe(BUILDINGS.reactor.cost);
  });
});

describe.each(REGIONS)('%i×%i: ports (§3.5)', (R) => {
  it('Seaport and Airport limits follow PORT_LIMITS; the second Airport stands in a Tarmac district (D2)', () => {
    const t = withKind(R, 'tarmac');
    const w = t.w;
    expect(PORT_LIMITS.seaport(1)).toBe(2);
    expect(PORT_LIMITS.seaport(4)).toBe(3);
    expect(PORT_LIMITS.airport(1)).toBe(1);
    expect(PORT_LIMITS.airport(4)).toBe(2);
    expect(PORT_LIMITS.airport(13)).toBe(3);
    // One Airport anywhere, then the limit by districts (2 owned: one Airport).
    const a1 = w.addBuilding('airport', sx(10, R), sy(10, R));
    expect(a1).not.toBeNull();
    const p = planAction(w, 'airport', { x: t.x0 + 20, y: t.y0 + 20 }, { x: t.x0 + 20, y: t.y0 + 20 });
    expect(p.reason).toBe('A second Airport needs 4 districts');
    // Own 4 districts: the second Airport only in Tarmac Reach, 25% off there.
    for (let s = 0; s < R * R && w.districts.owned.length < 4; s++) if (!w.slotOwned[s]) w.annex(s);
    for (const b of [...w.buildings.values()]) if (b.type !== 'airport') w.removeBuilding(b.id);
    const r = slotRect(w, t.s);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) w.clearTile(x, y);
    for (let x = t.x0 + 10; x < t.x0 + 30; x++) w.setRoad(x, t.y0 + 15);
    const ok = planAction(w, 'airport', { x: t.x0 + 20, y: t.y0 + 20 }, { x: t.x0 + 20, y: t.y0 + 20 });
    expect(ok.valid).toBe(true);
    expect(ok.cost).toBe(Math.round(BUILDINGS.airport.cost * 0.75));
    const other = w.districts.owned.find((s) => w.districts.kinds[s] !== 'tarmac' && s !== (R * R - 1) >> 1)!;
    const o = slotRect(w, other);
    for (let y = o.y0; y <= o.y1; y++) for (let x = o.x0; x <= o.x1; x++) w.clearTile(x, y);
    for (const b of [...w.buildings.values()]) if (w.slotAt(b.x, b.y) === other) w.removeBuilding(b.id);
    for (let x = o.x0 + 10; x < o.x0 + 30; x++) w.setRoad(x, o.y0 + 15);
    expect(planAction(w, 'airport', { x: o.x0 + 20, y: o.y0 + 20 }, { x: o.x0 + 20, y: o.y0 + 20 }).reason).toBe('Another Airport needs Tarmac Reach');
    expect(portLimitReason(w, 'spaceport', 1)).toBe('One Spaceport per city');
  });

  it("a Seaport's berth must be owned water", () => {
    const w = new World(3, 'Port', undefined, R);
    w.funds = 1e9;
    w.maxPopulation = 1e7;
    // The start slot's east edge: land up to x1, the berth (2 tiles) on locked water beyond.
    const r = slotRect(w, (R * R - 1) >> 1);
    water(w, r.x1 + 1, r.y0 + 10, r.x1 + 6, r.y0 + 30);
    for (let y = r.y0 + 10; y <= r.y0 + 30; y++) w.setRoad(r.x1 - 5, y);
    const p = planAction(w, 'seaport', { x: r.x1 - 2, y: r.y0 + 20 }, { x: r.x1 - 2, y: r.y0 + 20 });
    expect(p.valid).toBe(false);
    expect(p.reason).toBe('The berth must be in the city');
    water(w, r.x1 - 1, r.y0 + 10, r.x1, r.y0 + 30);
    for (let y = r.y0 + 10; y <= r.y0 + 30; y++) w.clearTile(r.x1 - 5, y);
    for (let y = r.y0 + 10; y <= r.y0 + 30; y++) w.setRoad(r.x1 - 7, y);
    const q = planAction(w, 'seaport', { x: r.x1 - 4, y: r.y0 + 20 }, { x: r.x1 - 4, y: r.y0 + 20 });
    expect(q.reason).toBeUndefined();
    expect(q.valid).toBe(true);
  });
});

describe.each(REGIONS)('%i×%i: new building rules (§6.3)', (R) => {
  it('every footprint stands on one terrace step; the Geothermal Bore needs the Terraces and a step ≥ 1', () => {
    const te = withKind(R, 'terraces');
    const w = te.w;
    for (let y = te.y0; y <= te.y1; y++) for (let x = te.x0 + 20; x <= te.x1; x++) w.tiles[w.idx(x, y)].elev = 1;
    expect(planAction(w, 'solar', { x: te.x0 + 19, y: te.y0 + 5 }, { x: te.x0 + 19, y: te.y0 + 5 }).reason).toBe('Needs flat ground');
    expect(planAction(w, 'solar', { x: te.x0 + 30, y: te.y0 + 5 }, { x: te.x0 + 30, y: te.y0 + 5 }).valid).toBe(true);
    shown(['geothermal'], () => {
      expect(planAction(w, 'geothermal', { x: te.x0 + 5, y: te.y0 + 5 }, { x: te.x0 + 5, y: te.y0 + 5 }).reason).toBe('Needs a terrace step');
      expect(planAction(w, 'geothermal', { x: te.x0 + 30, y: te.y0 + 30 }, { x: te.x0 + 30, y: te.y0 + 30 }).valid).toBe(true);
      expect(planAction(w, 'geothermal', { x: sx(20, R), y: sy(20, R) }, { x: sx(20, R), y: sy(20, R) }).reason).toBe('Must stand in the Terraces');
      const bare = new World(9, 'Bare', undefined, R);
      bare.funds = 1e9;
      expect(lockedReason(bare, 'geothermal')).toBe('Needs the Terraces');
    });
  });

  it('a skyway or Ribbon Rail span may not change terrace step (§3.7 Terraces)', () => {
    const te = withKind(R, 'terraces');
    const w = te.w;
    w.story.unlocks.push('rail');
    // Step 1 from column x0 + 20 on; a street to ramp the skyway onto.
    for (let y = te.y0; y <= te.y1; y++) for (let x = te.x0 + 20; x <= te.x1; x++) w.tiles[w.idx(x, y)].elev = 1;
    const y = te.y0 + 10;
    w.setRoad(te.x0 + 10, y, RoadKind.Street);
    w.setRoad(te.x0 + 25, y, RoadKind.Street);
    // On one step both build.
    expect(planAction(w, 'skyway', { x: te.x0 + 10, y }, { x: te.x0 + 16, y }).valid).toBe(true);
    expect(planAction(w, 'rail', { x: te.x0 + 2, y: y + 4 }, { x: te.x0 + 12, y: y + 4 }).valid).toBe(true);
    // Across the step line both are refused, with the tile where the step changes marked.
    const sk = planAction(w, 'skyway', { x: te.x0 + 10, y }, { x: te.x0 + 25, y });
    expect(sk.valid).toBe(false);
    expect(sk.reason).toBe("Can't cross a terrace step");
    expect(sk.tiles.find((p) => p.x === te.x0 + 20 && p.y === y)?.ok).toBe(false);
    const rl = planAction(w, 'rail', { x: te.x0 + 12, y: y + 4 }, { x: te.x0 + 28, y: y + 4 });
    expect(rl.valid).toBe(false);
    expect(rl.reason).toBe("Can't cross a terrace step");
    expect(rl.reason!.length).toBeLessThanOrEqual(32);
    // Elsewhere (no steps) nothing changes: a long skyway in the start slot still builds.
    w.setRoad(sx(10, R), sy(40, R), RoadKind.Street);
    expect(planAction(w, 'skyway', { x: sx(10, R), y: sy(40, R) }, { x: sx(30, R), y: sy(40, R) }).valid).toBe(true);
  });

  it('Pump Houses: a shore tile in the Sunk, the Shoals or Reedmere, not within r6 of the old pump hall, 16 a district', () => {
    shown(['pumphouse'], () => {
      const bare = new World(9, 'Bare', undefined, R);
      expect(lockedReason(bare, 'pumphouse')).toBe('Needs the Shoals, the Sunk or Reedmere');
      const sk = withKind(R, 'sunk');
      const w = sk.w;
      water(w, sk.x0, sk.y0 + 30, sk.x1, sk.y0 + 33);
      const hall = w.addBuilding('pumphall', sk.x0 + 5, sk.y0 + 26)!;
      expect(hall).not.toBeNull();
      expect(planAction(w, 'pumphouse', { x: sk.x0 + 9, y: sk.y0 + 29 }, { x: sk.x0 + 9, y: sk.y0 + 29 }).reason).toBe('Too close to the old pump hall');
      const ok = planAction(w, 'pumphouse', { x: sk.x0 + 30, y: sk.y0 + 29 }, { x: sk.x0 + 30, y: sk.y0 + 29 });
      expect(ok.valid).toBe(true);
      for (let k = 0; k < 16; k++) w.addBuilding('pumphouse', sk.x0 + 20 + k * 2, sk.y0 + 29);
      expect(planAction(w, 'pumphouse', { x: sk.x0 + 55, y: sk.y0 + 29 }, { x: sk.x0 + 55, y: sk.y0 + 29 }).reason).toBe('This district has its 16 Pump Houses');
      expect(planAction(w, 'pumphouse', { x: sx(10, R), y: sy(10, R) }, { x: sx(10, R), y: sy(10, R) }).reason).toBe('Needs the Shoals, the Sunk or Reedmere');
    });
  });

  it('the Tidal Turbine stands on owned open water with 2 sides on water', () => {
    shown(['tidal'], () => {
      const rm = withKind(R, 'reedmere');
      const w = rm.w;
      water(w, rm.x0 + 10, rm.y0 + 10, rm.x0 + 20, rm.y0 + 20);
      expect(planAction(w, 'tidal', { x: rm.x0 + 15, y: rm.y0 + 15 }, { x: rm.x0 + 15, y: rm.y0 + 15 }).valid).toBe(true);
      expect(planAction(w, 'tidal', { x: rm.x0 + 30, y: rm.y0 + 30 }, { x: rm.x0 + 30, y: rm.y0 + 30 }).reason).toBe('Needs open water');
      // A 2×2 pond the turbine fills: no side faces water.
      water(w, rm.x0 + 40, rm.y0 + 40, rm.x0 + 41, rm.y0 + 41);
      expect(planAction(w, 'tidal', { x: rm.x0 + 40, y: rm.y0 + 40 }, { x: rm.x0 + 40, y: rm.y0 + 40 }).reason).toBe('Needs 2 sides on open water');
    });
  });

  it('district-bound, lobby, districts, chapter and ending gates are AND terms with the first missing part named', () => {
    shown(['hullhouse', 'metro', 'charterhall', 'gantry', 'hexworks', 'terminal', 'beacon'], () => {
      const sk = withKind(R, 'sunk');
      const w = sk.w;
      w.story.favor.undertow = 100;
      w.story.flags.undertowSeeded = true;
      const hull = lockedReason(w, 'hullhouse');
      if (hull === null) {
        expect(planAction(w, 'hullhouse', { x: sx(20, R), y: sy(20, R) }, { x: sx(20, R), y: sy(20, R) }).reason).toBe('Must stand in the Sunk');
      }
      const bare = new World(9, 'Bare', undefined, R);
      bare.maxPopulation = 1e7;
      expect(lockedReason(bare, 'metro')).toBe('Needs 2 districts');
      expect(lockedReason(w, 'metro')).toBeNull();
      expect(lockedReason(bare, 'terminal')).toBe('Needs 3 districts');
      bare.story.favor.board = 60;
      expect(lockedReason(bare, 'charterhall')).toBe('Needs Chapter III done');
      bare.story.chapter = 4;
      expect(lockedReason(bare, 'charterhall')).toBeNull();
      expect(lockedReason(bare, 'gantry')).toBe('Opens with its ending');
      bare.story.ending = 'ironwork';
      expect(lockedReason(bare, 'gantry')).toBeNull();
      expect(lockedReason(bare, 'hexworks')).toMatch(/^Locked: Basalt Allied/);
      bare.story.flags.patron = 'basalt';
      expect(lockedReason(bare, 'hexworks')).toBeNull();
      expect(lockedReason(bare, 'beacon')).toBe('Needs the Shoals');
    });
    // Hidden types are never in a tray.
    const w = new World(9, 'Hidden', undefined, R);
    w.maxPopulation = 1e9;
    expect(lockedReason(w, 'frame')).toBe('Locked: not yet');
    expect(lockedReason(w, 'pumphall')).toBe('Locked: not yet');
  });

  it("a Spire takes its sponsor and look; old Spires read as Nacre with look 0", () => {
    const w = new World(9, 'Spires', undefined, R);
    w.funds = 1e9;
    w.maxPopulation = 1e7;
    const at = { x: sx(20, R), y: sy(20, R) };
    w.setRoad(at.x - 3, at.y);
    const p = applyAction(w, 'spire', at, at, { sponsor: 'basalt', look: 2 });
    expect(p.valid).toBe(true);
    const b = w.buildingAt(at.x, at.y)!;
    expect(b.sponsor).toBe('basalt');
    expect(b.look).toBe(2);
    const q = applyAction(w, 'spire', { x: at.x + 10, y: at.y }, { x: at.x + 10, y: at.y });
    expect(q.valid).toBe(true);
    const c = w.buildingAt(at.x + 10, at.y)!;
    expect(c.sponsor).toBe('nacre');
    expect(c.look).toBeGreaterThanOrEqual(0);
    expect(c.look).toBeLessThan(4);
  });

  it('a restored ruin pays 40 CR in the Sunk up to RUINS.payCapMonth a month', () => {
    const sk = withKind(R, 'sunk');
    const w = sk.w;
    w.funds = 0;
    let paid = 0;
    for (let k = 0; k < 150; k++) {
      const x = sk.x0 + (k % 60);
      const y = sk.y0 + 2 + ((k / 60) | 0);
      w.setZone(x, y, ZoneType.Residential);
      w.setLevel(x, y, 1, true);
      w.setGround(x, y, Ground.Rubble);
      paid += ruinRestored(w, x, y);
      expect(w.tiles[w.idx(x, y)].ground).toBe(Ground.Plain);
    }
    expect(paid).toBe(RUINS.payCapMonth);
    expect(w.funds).toBe(RUINS.payCapMonth);
    expect(w.districts.ruinsRestored).toBe(150);
    w.tick += 30;
    expect(ruinRestored(w, sk.x0 + 1, sk.y0 + 40)).toBe(40);
  });
});
