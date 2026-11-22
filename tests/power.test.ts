import { describe, expect, it } from 'vitest';
import { BUILDINGS, ZONES } from '../src/game/config';
import { ZoneType } from '../src/game/types';
import { flatWorld, makeSim } from './helpers';

/**
 * Layout used by most tests: a solar farm at (8..9, 10..11), a road along
 * y = 10 from x = 10 to x = 40, and a strip of zone tiles along y = 11.
 */
function strip(level: number, count: number, zone = ZoneType.Residential) {
  const w = flatWorld();
  w.addBuilding('solar', 8, 10);
  for (let x = 10; x <= 40; x++) w.setRoad(x, 10);
  for (let i = 0; i < count; i++) {
    w.setZone(10 + i, 11, zone);
    w.setLevel(10 + i, 11, level);
  }
  return w;
}

describe('power grid', () => {
  it('energises zones and roads connected to a plant', () => {
    const w = strip(1, 20);
    makeSim(w);
    expect(w.stats.powerSupply).toBe(BUILDINGS.solar.powerSupply);
    expect(w.stats.powerDemand).toBe(20 * ZONES.res.power[1]);
    expect(w.stats.unpoweredTiles).toBe(0);
    for (let i = 0; i < 20; i++) expect(w.tileAt(10 + i, 11)!.powered).toBe(true);
    expect(w.tileAt(40, 10)!.powered).toBe(true);
    // Empty land never conducts.
    expect(w.tileAt(20, 30)!.powered).toBe(false);
  });

  it('browns out the far end of the grid first (BFS order from the plant)', () => {
    // 20 high-density hab tiles × 8 MW = 160 MW against 100 MW of solar.
    const w = strip(3, 20);
    makeSim(w);
    const draw = ZONES.res.power[3];
    const expectedPowered = Math.floor(BUILDINGS.solar.powerSupply / draw); // 12
    const flags = Array.from({ length: 20 }, (_, i) => w.tileAt(10 + i, 11)!.powered);
    expect(flags.filter(Boolean).length).toBe(expectedPowered);
    // Powered tiles are exactly the ones nearest the plant.
    expect(flags.slice(0, expectedPowered).every(Boolean)).toBe(true);
    expect(flags.slice(expectedPowered).some(Boolean)).toBe(false);
    expect(w.stats.unpoweredTiles).toBe(20 - expectedPowered);
    expect(w.stats.powerDemand).toBe(20 * draw);
    // Roads near the plant are lit, roads past the brownout front are dark.
    expect(w.tileAt(10, 10)!.powered).toBe(true);
    expect(w.tileAt(40, 10)!.powered).toBe(false);
  });

  it('leaves disconnected islands unpowered', () => {
    const w = strip(1, 5);
    for (let x = 50; x < 55; x++) {
      w.setZone(x, 40, ZoneType.Commercial);
      w.setLevel(x, 40, 1);
    }
    makeSim(w);
    expect(w.tileAt(12, 11)!.powered).toBe(true);
    expect(w.tileAt(52, 40)!.powered).toBe(false);
    expect(w.stats.unpoweredTiles).toBe(5);
  });

  it('conducts through zone tiles and building footprints, not empty land', () => {
    const w = flatWorld();
    w.addBuilding('solar', 10, 10);
    // Zone chain from the plant, then a precinct, then a road beyond it.
    for (let x = 12; x < 16; x++) w.setZone(x, 10, ZoneType.Industrial);
    w.addBuilding('precinct', 16, 10);
    w.setRoad(18, 10);
    w.setRoad(30, 30); // isolated
    makeSim(w);
    expect(w.buildingAt(16, 10)!.powered).toBe(true);
    expect(w.tileAt(18, 10)!.powered).toBe(true);
    expect(w.tileAt(30, 30)!.powered).toBe(false);
  });

  it('an offline plant supplies nothing and comes back when the timer runs out', () => {
    const w = strip(1, 10);
    const sim = makeSim(w);
    const plant = w.buildingAt(8, 10)!;
    plant.offline = 3;
    sim.recomputeAll();
    expect(w.stats.powerSupply).toBe(0);
    expect(w.tileAt(12, 11)!.powered).toBe(false);
    expect(plant.powered).toBe(true); // plants always report powered
    sim.step();
    sim.step();
    expect(w.stats.powerSupply).toBe(0);
    sim.step();
    expect(plant.offline).toBe(0);
    expect(w.stats.powerSupply).toBe(BUILDINGS.solar.powerSupply);
    expect(w.news.some((n) => n.kind === 'good' && n.text.includes(BUILDINGS.solar.name))).toBe(true);
  });

  it('service buildings only radiate coverage when powered', () => {
    const w = flatWorld();
    w.addBuilding('precinct', 30, 30);
    const sim = makeSim(w);
    const i = w.idx(31, 31);
    expect(w.fields.security[i]).toBe(0);
    w.addBuilding('solar', 28, 30); // touching the precinct footprint
    sim.recomputeAll();
    expect(w.buildingAt(30, 30)!.powered).toBe(true);
    expect(w.fields.security[i]).toBeGreaterThan(0.9);
    // Falls off linearly with distance and is zero beyond the radius.
    const r = BUILDINGS.precinct.radius;
    expect(w.fields.security[w.idx(31 + Math.floor(r / 2), 31)]).toBeGreaterThan(0.3);
    expect(w.fields.security[w.idx(31, 31 + r + 2)]).toBe(0);
  });
});
