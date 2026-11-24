import { describe, expect, it } from 'vitest';
import { applyAction, lockedReason, planAction } from '../src/game/actions';
import { BRIDGE_COST, BUILDINGS, BULLDOZE_COST, ROAD_COST, ZONES } from '../src/game/config';
import { RoadKind, Terrain, ZoneType } from '../src/game/types';
import { flatWorld } from './helpers';

describe('actions', () => {
  it('prices roads per tile and bridges over water', () => {
    const w = flatWorld();
    for (let x = 14; x <= 16; x++) w.tiles[w.idx(x, 5)].terrain = Terrain.Water;
    const plan = planAction(w, 'road', { x: 10, y: 5 }, { x: 20, y: 5 });
    expect(plan.valid).toBe(true);
    expect(plan.tiles.length).toBe(11);
    expect(plan.cost).toBe(8 * ROAD_COST + 3 * BRIDGE_COST);
    const funds = w.funds;
    applyAction(w, 'road', { x: 10, y: 5 }, { x: 20, y: 5 });
    expect(w.funds).toBe(funds - plan.cost);
    expect(w.isRoad(15, 5)).toBe(true);
    // Re-laying existing road is free and does nothing.
    const again = planAction(w, 'road', { x: 10, y: 5 }, { x: 20, y: 5 });
    expect(again.cost).toBe(0);
    expect(again.valid).toBe(false);
    // Expansion (EXPANSION §3.4): the Street tool is always unlocked and lays Streets, bridges included.
    expect(lockedReason(w, 'road')).toBeNull();
    expect(plan.roadKinds).toEqual(Array(11).fill(RoadKind.Street));
    expect(plan.upgrades).toBe(0);
    expect(plan.ramps).toBe(0);
    expect(w.tileAt(15, 5)!.roadKind).toBe(RoadKind.Street);
  });

  it('roads are L-shaped and blocked by developed zones and buildings', () => {
    const w = flatWorld();
    w.setZone(12, 8, ZoneType.Residential);
    w.setLevel(12, 8, 2);
    w.addBuilding('plaza', 15, 8);
    const plan = planAction(w, 'road', { x: 10, y: 8 }, { x: 18, y: 10 });
    const blocked = plan.tiles.filter((t) => !t.ok).map((t) => `${t.x},${t.y}`);
    expect(blocked).toEqual(['12,8', '15,8']);
    expect(plan.reason).toBe('Blocked by buildings');
    expect(plan.cost).toBe((plan.tiles.length - 2) * ROAD_COST);
    expect(plan.tiles.at(-1)).toMatchObject({ x: 18, y: 10 });
  });

  it('zones cost per tile and skip roads, water and buildings', () => {
    const w = flatWorld();
    w.setRoad(11, 11);
    w.tiles[w.idx(12, 12)].terrain = Terrain.Water;
    const plan = planAction(w, 'com', { x: 10, y: 10 }, { x: 12, y: 12 });
    expect(plan.tiles.filter((t) => t.ok).length).toBe(7);
    expect(plan.cost).toBe(7 * ZONES.com.cost);
    expect(plan.reason).toBe('Some tiles are occupied');
    applyAction(w, 'com', { x: 10, y: 10 }, { x: 12, y: 12 });
    expect(w.tileAt(10, 10)!.zone).toBe(ZoneType.Commercial);
    expect(w.tileAt(11, 11)!.road).toBe(true);
  });

  it('buildings are locked until the population milestone', () => {
    const w = flatWorld();
    expect(lockedReason(w, 'solar')).toBeNull();
    expect(lockedReason(w, 'reactor')).toMatch(/Locked/);
    const plan = planAction(w, 'reactor', { x: 20, y: 20 }, { x: 20, y: 20 });
    expect(plan.valid).toBe(false);
    expect(plan.reason).toMatch(/Locked/);
    w.maxPopulation = BUILDINGS.reactor.unlockPop;
    const ok = planAction(w, 'reactor', { x: 20, y: 20 }, { x: 20, y: 20 });
    expect(ok.valid).toBe(true);
    expect(ok.cost).toBe(BUILDINGS.reactor.cost);
    expect(ok.footprint).toEqual({ x: 19, y: 19, size: 3 });
  });

  it('refuses unaffordable plans and sites on water', () => {
    const w = flatWorld();
    w.funds = 100;
    const plan = planAction(w, 'solar', { x: 20, y: 20 }, { x: 20, y: 20 });
    expect(plan.valid).toBe(false);
    expect(plan.reason).toMatch(/Not enough credits/);
    w.funds = 1e6;
    w.tiles[w.idx(30, 30)].terrain = Terrain.Water;
    const wet = planAction(w, 'solar', { x: 30, y: 30 }, { x: 30, y: 30 });
    expect(wet.valid).toBe(false);
    expect(wet.reason).toBe("Can't build on water");
  });

  it('bulldozes roads, developed zones and whole buildings', () => {
    const w = flatWorld();
    w.setRoad(5, 5);
    w.setZone(6, 5, ZoneType.Industrial);
    w.setLevel(6, 5, 2);
    w.setZone(7, 5, ZoneType.Residential); // empty lot: free to clear
    const b = w.addBuilding('precinct', 8, 5)!;
    const plan = planAction(w, 'bulldoze', { x: 5, y: 5 }, { x: 8, y: 5 });
    expect(plan.cost).toBe(BULLDOZE_COST + BULLDOZE_COST * 2 * 2 + Math.round(BUILDINGS.precinct.cost * 0.05));
    const funds = w.funds;
    applyAction(w, 'bulldoze', { x: 5, y: 5 }, { x: 8, y: 5 });
    expect(w.funds).toBe(funds - plan.cost);
    expect(w.isRoad(5, 5)).toBe(false);
    expect(w.tileAt(6, 5)!.zone).toBe(ZoneType.None);
    expect(w.buildings.has(b.id)).toBe(false);
    expect(w.tileAt(9, 6)!.buildingId).toBe(-1);
    expect(plan.layer).toBe('ground');
    const nothing = planAction(w, 'bulldoze', { x: 30, y: 30 }, { x: 31, y: 31 });
    expect(nothing.valid).toBe(false);
    expect(nothing.reason).toBe('Nothing to demolish');
  });
});
