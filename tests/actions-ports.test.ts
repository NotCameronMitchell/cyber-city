// Expansion building rules (docs/EXPANSION.md §5, §7.7, WP-2): the seaport shore rule and
// facing order, berths, max counts, road access, "Skyway in the way", the confirm flag at
// SAFETY.confirmCost, noise reach on the ghost, the Spaceport countdown and the seaport snap.

import { describe, expect, it } from 'vitest';
import { applyAction, footprintOrigin, planAction, snapSeaport } from '../src/game/actions';
import { BUILDINGS, SAFETY, SEAPORT } from '../src/game/config';
import { berthTiles, shoreSites } from '../src/game/ports';
import { RoadKind, Terrain, ZoneType, type BuildingType } from '../src/game/types';
import { World } from '../src/game/world';
import { flatWorld } from './helpers';

const N = 64;

/** A flat rich world with water wherever `water(x, y)` holds. */
function shore(water: (x: number, y: number) => boolean): World {
  const w = flatWorld(808);
  w.funds = 1e7;
  w.maxPopulation = 1e6;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (water(x, y)) w.tiles[w.idx(x, y)].terrain = Terrain.Water;
  return w;
}

/** Finger tile that puts a building's footprint top-left at (x, y). */
const at = (type: BuildingType, x: number, y: number) => {
  const off = Math.floor((BUILDINGS[type].size - 1) / 2);
  return { x: x + off, y: y + off };
};
const plan = (w: World, type: BuildingType, x: number, y: number) => planAction(w, type, at(type, x, y), at(type, x, y));
const place = (w: World, type: BuildingType, x: number, y: number) => applyAction(w, type, at(type, x, y), at(type, x, y));

describe('seaport (§5.1)', () => {
  it('needs a straight shore and takes the first facing side in the order S, E, N, W', () => {
    // South and east both open: south wins.
    const se = shore((x, y) => y >= 40 || x >= 24);
    se.setRoad(20, 35);
    const p = plan(se, 'seaport', 20, 36);
    expect(p.valid).toBe(true);
    expect(p.confirm).toBe(true); // 18,000 ≥ SAFETY.confirmCost
    place(se, 'seaport', 20, 36);
    expect(se.buildingAt(20, 36)!.facing).toBe(2);
    // Only east.
    const e = shore((x) => x >= 24);
    e.setRoad(20, 29);
    place(e, 'seaport', 20, 30);
    expect(e.buildingAt(20, 30)!.facing).toBe(1);
    // Only north.
    const n = shore((_x, y) => y <= 10);
    n.setRoad(20, 15);
    place(n, 'seaport', 20, 11);
    expect(n.buildingAt(20, 11)!.facing).toBe(0);
    // Only west.
    const wst = shore((x) => x <= 10);
    wst.setRoad(15, 20);
    place(wst, 'seaport', 11, 20);
    expect(wst.buildingAt(11, 20)!.facing).toBe(3);
    // Inland.
    const dry = shore(() => false);
    dry.setRoad(20, 35);
    expect(plan(dry, 'seaport', 20, 36).reason).toBe('Needs a straight shore');
  });

  it('a berth with an existing bridge (or rail) is not open water; bridges on a berth are refused', () => {
    const w = shore((_x, y) => y >= 40);
    w.setRoad(20, 35);
    w.setRoad(21, 40); // a bridge stub on the would-be berth
    expect(plan(w, 'seaport', 20, 36).reason).toBe('Needs a straight shore');
    w.clearTile(21, 40);
    w.setRail(22, 41, 4);
    w.setRail(22, 42, 1);
    expect(plan(w, 'seaport', 20, 36).reason).toBe('Needs a straight shore');
    w.clearTile(22, 41);
    w.clearTile(22, 42);
    expect(place(w, 'seaport', 20, 36).valid).toBe(true);
    const b = w.buildingAt(20, 36)!;
    expect(berthTiles(b, w.N)).toHaveLength(8);
    const bridge = planAction(w, 'road', { x: 22, y: 40 }, { x: 22, y: 45 });
    expect(bridge.reason).toBe('Keep the berth clear');
    expect(bridge.tiles.filter((t) => !t.ok).map((t) => t.y)).toEqual([40, 41]); // the 2-deep berth
    expect(bridge.valid).toBe(true); // the bridge beyond it still lays
    // Skyways may pass over the berth.
    expect(planAction(w, 'skyway', { x: 18, y: 41 }, { x: 26, y: 41 }).valid).toBe(true);
  });

  it('every sampled generated seed has shore sites a seaport can actually take', () => {
    let placed = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = World.generate(seed * 7919);
      w.funds = 1e7;
      w.maxPopulation = 1e6;
      const marks = new Uint8Array(N * N);
      expect(shoreSites(w, marks)).toBeGreaterThanOrEqual(2);
      // Lay a street beside the first site that has dry land next to it, then place the port.
      for (let i = 0; i < N * N; i++) {
        if (!marks[i]) continue;
        const x = i % N;
        const y = (i / N) | 0;
        const side = [
          [x - 1, y],
          [x + 4, y],
          [x, y - 1],
          [x, y + 4],
        ].find(([sx, sy]) => w.tileAt(sx, sy)?.terrain === Terrain.Land);
        if (!side) continue;
        w.setRoad(side[0], side[1]);
        const p = plan(w, 'seaport', x, y);
        expect(p.valid, `seed ${seed} at ${x},${y}: ${p.reason}`).toBe(true);
        placed++;
        break;
      }
    }
    expect(placed).toBe(10);
  });

  it('the ghost snaps to the nearest valid site within 2 tiles', () => {
    const w = shore((_x, y) => y >= 40);
    const marks = new Uint8Array(N * N);
    shoreSites(w, marks);
    // Valid top-lefts sit on row 36 (the south side faces the water).
    const finger = at('seaport', 20, 36);
    expect(snapSeaport(finger, marks, w.N)).toEqual(finger); // already valid
    const snapped = snapSeaport({ x: finger.x, y: finger.y - 2 }, marks, w.N);
    expect(footprintOrigin(snapped, 4)).toEqual({ x: 20, y: 36 });
    // Too far: unchanged.
    expect(snapSeaport({ x: finger.x, y: finger.y - 5 }, marks, w.N)).toEqual({ x: finger.x, y: finger.y - 5 });
    expect(SEAPORT.snapRadius).toBe(2);
  });
});

describe('ports and costly buildings (§5.2–§5.4, §7.7)', () => {
  it('caps counts: two seaports, one airport, one spaceport', () => {
    const w = shore((_x, y) => y >= 40);
    w.setRoad(0, 35);
    w.setRoad(63, 35);
    for (let x = 0; x < N; x++) w.setRoad(x, 35);
    expect(place(w, 'seaport', 2, 36).valid).toBe(true);
    expect(place(w, 'seaport', 10, 36).valid).toBe(true);
    expect(plan(w, 'seaport', 20, 36).reason).toBe('Only 2 Seaports per city');
    for (let y = 0; y < 30; y++) w.setRoad(30, y);
    expect(place(w, 'airport', 31, 2).valid).toBe(true);
    expect(plan(w, 'airport', 31, 12).reason).toBe('One Airport per city');
    expect(plan(w, 'spaceport', 20, 2).reason).toBe('Needs road access'); // the street at x 30 is 5 tiles off
    expect(place(w, 'spaceport', 24, 2).valid).toBe(true);
    expect(plan(w, 'spaceport', 24, 20).reason).toBe('One Spaceport per city');
  });

  it('needs a frontable road: a highway alone never counts', () => {
    const w = shore(() => false);
    w.setRoad(20, 19, RoadKind.Highway);
    expect(plan(w, 'airport', 20, 20).reason).toBe('Needs road access');
    w.setRoad(21, 19, RoadKind.Ramp);
    expect(plan(w, 'airport', 20, 20).valid).toBe(true);
    expect(plan(w, 'academy', 40, 40).valid).toBe(true); // an Academy needs no road (like the other services)
  });

  it('refuses a skyway over the site unless the building takes docks', () => {
    const w = shore(() => false);
    w.setSky(41, 41, 2);
    w.setSky(42, 41, 8);
    expect(plan(w, 'solar', 41, 41).reason).toBe('Skyway in the way');
    expect(plan(w, 'stack', 40, 40).reason).not.toBe('Skyway in the way');
    w.setRoad(39, 40);
    w.story.unlocks.push('stack');
    expect(plan(w, 'stack', 40, 40).valid).toBe(true);
    w.clearTile(39, 40);
    w.setRoad(37, 38);
    expect(plan(w, 'airport', 38, 38).valid).toBe(true);
  });

  it('flags confirm at SAFETY.confirmCost (with modifiers) and shows the noise reach', () => {
    const w = shore(() => false);
    w.setRoad(30, 29);
    expect(plan(w, 'solar', 30, 30).confirm).toBeUndefined();
    expect(plan(w, 'arcology', 30, 30).confirm).toBe(true);
    w.mods.buildCostMul = 0.1;
    expect(plan(w, 'arcology', 30, 30).confirm).toBeUndefined(); // 6,000 CR now
    w.mods.buildCostMul = 1;
    w.mods.costMul.reactor = SAFETY.confirmCost / BUILDINGS.reactor.cost;
    expect(plan(w, 'reactor', 30, 30).confirm).toBe(true);
    // Homes in the airport's reach tint amber and the note counts them.
    for (let x = 24; x <= 29; x++) {
      w.setZone(x, 40, ZoneType.Residential);
      w.setLevel(x, 40, 1);
    }
    w.setZone(23, 40, ZoneType.Residential); // a lot: not a home yet
    const air = plan(w, 'airport', 30, 30);
    expect(air.valid).toBe(true);
    expect(air.loudTiles).toHaveLength(6);
    expect(air.note).toBe('Loud over 6 homes');
    expect(air.confirm).toBe(true);
    // No homes in reach: the spaceport says how long it takes.
    const v = shore(() => false);
    v.setRoad(30, 29);
    const sp = plan(v, 'spaceport', 30, 30);
    expect(sp.loudTiles).toEqual([]);
    expect(sp.note).toBe('Takes 4+ minutes to build');
  });

  it('a placed spaceport starts its 240-day countdown; a seaport stores its facing', () => {
    const w = shore(() => false);
    w.setRoad(30, 29);
    place(w, 'spaceport', 30, 30);
    const b = w.buildingAt(30, 30)!;
    expect(b.buildDays).toBe(BUILDINGS.spaceport.buildDays);
    expect(b.launches).toBeUndefined();
    const r = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(r.buildingAt(30, 30)!.buildDays).toBe(240);
  });
});
