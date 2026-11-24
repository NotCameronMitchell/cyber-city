import { describe, expect, it } from 'vitest';
import { ROAD_ACCESS_RANGE } from '../src/game/config';
import { ZoneType } from '../src/game/types';
import type { World } from '../src/game/world';
import { FieldSystem } from '../src/game/sim/fields';
import { SimGrid } from '../src/game/sim/grid';
import { GrowthSystem } from '../src/game/sim/growth';
import { PowerGrid } from '../src/game/sim/power';
import { flatWorld, makeSim, run } from './helpers';

/** Road along y = 20 (x 10..40) with a solar farm at its west end. */
function base(opts: { power?: boolean; road?: boolean } = {}): World {
  const w = flatWorld(77);
  if (opts.road !== false) for (let x = 10; x <= 40; x++) w.setRoad(x, 20);
  if (opts.power !== false) w.addBuilding('solar', 8, 20);
  return w;
}

/** Zone a rectangle of empty lots. */
function zone(w: World, z: ZoneType, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.setZone(x, y, z);
}

function developed(w: World, z?: ZoneType): number {
  return w.tiles.filter((t) => t.level > 0 && !t.abandoned && (z === undefined || t.zone === z)).length;
}

describe('zone growth', () => {
  it('lots with road, power and demand develop', () => {
    const w = base();
    zone(w, ZoneType.Residential, 12, 21, 20, 22);
    zone(w, ZoneType.Industrial, 30, 21, 36, 22);
    const sim = makeSim(w);
    expect(w.stats.demand.res).toBeGreaterThan(0);
    run(sim, 60);
    expect(developed(w, ZoneType.Residential)).toBeGreaterThan(5);
    expect(developed(w, ZoneType.Industrial)).toBeGreaterThan(3);
    expect(w.stats.population).toBeGreaterThan(0);
    // New buildings start their construction animation from age 0.
    expect(w.tiles.some((t) => t.zone !== ZoneType.None && t.level > 0 && t.age < 60)).toBe(true);
  });

  it('nothing develops without a road in range', () => {
    const w = base();
    // A column of lots running away from the road: rows 21..23 are in range, 24+ are not.
    zone(w, ZoneType.Residential, 15, 21, 15, 34);
    const sim = makeSim(w);
    run(sim, 240);
    for (let y = 21; y <= 34; y++) {
      const t = w.tileAt(15, y)!;
      if (y - 20 > ROAD_ACCESS_RANGE) expect(t.level).toBe(0);
    }
    expect(w.tileAt(15, 21)!.level).toBeGreaterThan(0);
  });

  it('nothing develops with no roads at all', () => {
    const w = base({ road: false });
    zone(w, ZoneType.Residential, 10, 20, 20, 22); // touches the plant, so it is powered
    const sim = makeSim(w);
    run(sim, 120);
    expect(developed(w)).toBe(0);
    expect(w.stats.demand.res).toBeGreaterThan(0);
  });

  it('nothing develops without power', () => {
    const w = base({ power: false });
    zone(w, ZoneType.Residential, 12, 21, 20, 22);
    const sim = makeSim(w);
    run(sim, 120);
    expect(developed(w)).toBe(0);
    expect(w.tileAt(12, 21)!.powered).toBe(false);
  });

  it('nothing develops without demand', () => {
    const w = base();
    w.addBuilding('reactor', 7, 17); // plenty of power, touching the solar farm
    // 30 high-density hab towers with zero jobs: residential demand collapses.
    for (let x = 12; x < 42; x++) {
      w.setZone(x, 19, ZoneType.Residential);
      w.setLevel(x, 19, 3);
    }
    zone(w, ZoneType.Residential, 12, 21, 30, 22);
    const sim = makeSim(w);
    expect(w.stats.demand.res).toBeLessThan(0);
    run(sim, 90);
    for (let y = 21; y <= 22; y++) for (let x = 12; x <= 30; x++) expect(w.tileAt(x, y)!.level).toBe(0);
  });

  it('unpowered buildings are abandoned and recover when power returns', () => {
    const w = base();
    zone(w, ZoneType.Residential, 12, 21, 20, 22);
    const sim = makeSim(w);
    run(sim, 90);
    const before = developed(w);
    expect(before).toBeGreaterThan(5);
    const plant = w.buildingAt(8, 20)!;
    plant.offline = 80;
    run(sim, 75);
    expect(w.stats.abandonedTiles).toBeGreaterThan(0);
    run(sim, 120);
    expect(plant.offline).toBe(0);
    expect(w.stats.abandonedTiles).toBeLessThan(before);
    expect(developed(w)).toBeGreaterThan(0);
  });

  it('ages every tile once per tick, capped at 9999', () => {
    const w = base();
    zone(w, ZoneType.Residential, 12, 21, 12, 21);
    const t = w.tileAt(12, 21)!;
    const sim = makeSim(w);
    t.age = 5;
    w.tileAt(0, 0)!.age = 9999;
    sim.step();
    if (t.level === 0) expect(t.age).toBe(6);
    expect(w.tileAt(0, 0)!.age).toBe(9999);
  });

  it('parks raise land value and unlock mid-density habs', () => {
    const build = (parks: boolean) => {
      const w = base();
      w.addBuilding('reactor', 7, 17);
      zone(w, ZoneType.Residential, 12, 21, 40, 23);
      zone(w, ZoneType.Commercial, 12, 17, 40, 19);
      // Industry well away from the homes, on its own street.
      for (let y = 6; y <= 20; y++) w.setRoad(10, y);
      for (let x = 10; x <= 40; x++) w.setRoad(x, 6);
      zone(w, ZoneType.Industrial, 12, 3, 40, 5);
      if (parks) for (let x = 13; x <= 40; x += 4) w.addBuilding('plaza', x, 24);
      const sim = makeSim(w);
      run(sim, 420);
      let mid = 0;
      let lv = 0;
      for (let y = 21; y <= 23; y++)
        for (let x = 12; x <= 40; x++) {
          if (w.tileAt(x, y)!.level >= 2) mid++;
          lv += w.fields.landValue[w.idx(x, y)];
        }
      return { mid, lv: lv / (29 * 3) };
    };
    const plain = build(false);
    const green = build(true);
    expect(green.lv).toBeGreaterThan(plain.lv + 0.05);
    expect(green.mid).toBeGreaterThan(plain.mid + 3);
  });

  it('abandonment keeps the wealth tier of a block; collapse back to a lot resets it to $', () => {
    const w = base();
    for (let x = 12; x <= 20; x++) {
      w.setZone(x, 21, ZoneType.Residential);
      w.setLevel(x, 21, 2, false, 1);
    }
    // Growth driven by hand with a score inside the $$ band, so only power decides.
    const g = new SimGrid(w);
    const power = new PowerGrid();
    const growth = new GrowthSystem();
    const fields = new FieldSystem();
    w.buildingAt(8, 20)!.offline = 9999;
    for (let d = 0; d < 200; d++) {
      w.tick++;
      g.scan(w);
      power.compute(w, g);
      growth.countDays(g, power);
      for (let x = 12; x <= 20; x++) w.fields.wealth[w.idx(x, 21)] = 0.4;
      growth.run(w, g, power, fields, { res: 0, com: 0, ind: 0 });
    }
    const shells = w.tiles.filter((t) => t.zone === ZoneType.Residential && t.abandoned);
    expect(shells.length).toBeGreaterThan(3);
    expect(shells.every((t) => t.wealth === 1)).toBe(true);
    // A collapsed shell is a lot again, and a lot is always $.
    const t = w.tileAt(12, 21)!;
    w.setLevel(12, 21, 0);
    expect(t.wealth).toBe(0);
  });
});
