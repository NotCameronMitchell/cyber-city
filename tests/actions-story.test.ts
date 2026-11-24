// Story-layer actions and the Game API (STORY.md §4.5, §10.6, §11): gates,
// turf placement rules, costs and credits, stations over rail, signals,
// inspect actions, tile info, tool prices and the previous-city backup.

import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, buildingCost, lockedReason, planAction } from '../src/game/actions';
import { BUILDINGS, ROAD_COST, SAVE_KEY, STACK_COST_SCALE, ZONES } from '../src/game/config';
import { Game, PREV_SAVE_KEY } from '../src/game/game';
import { ZoneType } from '../src/game/types';
import type { World } from '../src/game/world';
import { flatWorld } from './helpers';

/** A Game on an all-land map (new Game() generates random terrain). */
function flatGame(): Game {
  const g = new Game();
  expect(g.restore(JSON.parse(JSON.stringify(flatWorld().serialize())))).toBe(true);
  return g;
}

function own(w: World, x: number, y: number, o: number, str = 60) {
  const i = w.idx(x, y);
  w.turf.owner[i] = o;
  w.turf.str[i] = str;
}

describe('faction and story gates (§4.5)', () => {
  it('opens exclusives on unlock OR tier OR fallback population', () => {
    const w = flatWorld();
    expect(lockedReason(w, 'foundry')).toBe('Locked: Basalt Friendly');
    w.story.favor.basalt = 20;
    expect(lockedReason(w, 'foundry')).toBeNull();
    w.story.favor.basalt = 0;
    w.story.unlocks.push('foundry');
    expect(lockedReason(w, 'foundry')).toBeNull();
    expect(lockedReason(w, 'glarewall')).toBe('Locked: Nacre Friendly');
    w.story.favor.nacre = 25;
    expect(lockedReason(w, 'glarewall')).toBeNull();
    expect(lockedReason(w, 'commons')).toBe('Locked: Board Friendly');
    w.story.favor.board = 20;
    expect(lockedReason(w, 'commons')).toBeNull();
    // A ceiling below Friendly keeps it shut.
    w.story.ceils.board = 15;
    expect(lockedReason(w, 'commons')).toBe('Locked: Board Friendly');
    expect(lockedReason(w, 'memorial')).toBe('Locked: not yet');
    w.story.unlocks.push('memorial');
    expect(lockedReason(w, 'memorial')).toBeNull();
  });

  it('Tidemarket needs 3 footprint tiles of Undertow turf; a Roost one Kites tile', () => {
    const w = flatWorld();
    w.funds = 1e6;
    expect(lockedReason(w, 'tidemarket')).toBe('Locked: Undertow Friendly');
    w.story.favor.undertow = 25;
    expect(lockedReason(w, 'tidemarket')).toBeNull();
    const at = { x: 20, y: 20 };
    expect(planAction(w, 'tidemarket', at, at).reason).toBe('Must sit on Undertow turf');
    own(w, 20, 20, 1);
    own(w, 21, 20, 1);
    own(w, 21, 21, 2);
    expect(planAction(w, 'tidemarket', at, at).reason).toBe('Must sit on Undertow turf');
    own(w, 20, 21, 1);
    expect(planAction(w, 'tidemarket', at, at).valid).toBe(true);
    applyAction(w, 'tidemarket', at, at);
    expect(w.turf.owner[w.idx(20, 20)]).toBe(1); // a Tidemarket keeps its turf

    w.story.favor.kites = 25;
    expect(planAction(w, 'roost', { x: 30, y: 30 }, { x: 30, y: 30 }).reason).toBe('Must sit on Kites turf');
    own(w, 30, 30, 2);
    expect(planAction(w, 'roost', { x: 30, y: 30 }, { x: 30, y: 30 }).valid).toBe(true);
  });

  it('placing an ordinary building on turf clears it and refreshes turf stats', () => {
    const w = flatWorld();
    own(w, 10, 10, 1);
    own(w, 11, 10, 1);
    expect(applyAction(w, 'plaza', { x: 10, y: 10 }, { x: 10, y: 10 }).valid).toBe(true);
    expect(w.turf.owner[w.idx(10, 10)]).toBe(0);
    expect(w.turf.stats.tiles.undertow).toBe(1);
  });
});

describe('costs, credits and Stratablock placement', () => {
  it('scales every tool by buildCostMul and buildings by costMul and credits', () => {
    const w = flatWorld();
    w.funds = 1e6;
    w.maxPopulation = 1e6;
    w.mods.buildCostMul = 1.5;
    expect(planAction(w, 'road', { x: 5, y: 5 }, { x: 14, y: 5 }).cost).toBe(Math.round(10 * ROAD_COST * 1.5));
    expect(planAction(w, 'res', { x: 5, y: 8 }, { x: 6, y: 8 }).cost).toBe(Math.round(2 * ZONES.res.cost * 1.5));
    expect(planAction(w, 'reactor', { x: 30, y: 30 }, { x: 30, y: 30 }).cost).toBe(BUILDINGS.reactor.cost * 1.5);
    w.mods.buildCostMul = 1;
    w.mods.costMul.reactor = 0.5;
    expect(buildingCost(w, 'reactor')).toBe(4000);
    w.story.credits.push({ what: 'reactor', n: 1, mul: 0.5 });
    expect(planAction(w, 'reactor', { x: 30, y: 30 }, { x: 30, y: 30 }).cost).toBe(2000);
    const funds = w.funds;
    applyAction(w, 'reactor', { x: 30, y: 30 }, { x: 30, y: 30 });
    expect(w.funds).toBe(funds - 2000);
    expect(w.story.credits).toEqual([]);
    expect(buildingCost(w, 'reactor')).toBe(4000);
  });

  it('a Stratablock needs road access, starts its Plinth and scales by 1.15ⁿ', () => {
    const w = flatWorld();
    w.funds = 1e6;
    w.story.unlocks.push('stack');
    expect(planAction(w, 'stack', { x: 31, y: 31 }, { x: 31, y: 31 }).reason).toBe('Needs road access');
    for (let x = 0; x < 64; x++) w.setRoad(x, 29);
    for (let x = 0; x < 64; x++) w.setRoad(x, 35);
    const p = planAction(w, 'stack', { x: 31, y: 31 }, { x: 31, y: 31 });
    expect(p.valid).toBe(true);
    expect(p.cost).toBe(BUILDINGS.stack.cost);
    expect(p.footprint).toEqual({ x: 30, y: 30, size: 4 });
    applyAction(w, 'stack', { x: 31, y: 31 }, { x: 31, y: 31 });
    const b = w.buildingAt(30, 30)!;
    expect(b.type).toBe('stack');
    expect(b.stage).toBe(1);
    expect(b.buildDays).toBe(60);
    expect(w.signals).toContainEqual({ t: 'built', type: 'stack', id: b.id });
    expect(w.signals).toContainEqual({ t: 'action', tool: 'stack', x: 31, y: 31 });
    expect(buildingCost(w, 'stack')).toBe(Math.round(BUILDINGS.stack.cost * STACK_COST_SCALE));
    // A credit discounts the plinth (scaling still applies).
    w.story.credits.push({ what: 'stack', n: 2, mul: 0.5 });
    expect(buildingCost(w, 'stack')).toBe(Math.round(BUILDINGS.stack.cost * STACK_COST_SCALE * 0.5));
  });

  it('only stations may stand on rail', () => {
    const w = flatWorld();
    w.funds = 1e6;
    w.maxPopulation = 1e6;
    w.setRail(30, 30, 2);
    w.setRail(31, 30, 8);
    expect(planAction(w, 'plaza', { x: 30, y: 30 }, { x: 30, y: 30 }).reason).toBe('Rail in the way');
    expect(planAction(w, 'maglev', { x: 30, y: 30 }, { x: 30, y: 30 }).valid).toBe(true);
    applyAction(w, 'maglev', { x: 30, y: 30 }, { x: 30, y: 30 });
    expect(w.rail[w.idx(30, 30)]).toBe(2); // the station keeps its track
  });

  it('bulldoze reports developed Fab tiles and clears rail-only tiles', () => {
    const w = flatWorld();
    for (let x = 10; x < 14; x++) {
      w.setZone(x, 10, ZoneType.Industrial);
      w.setLevel(x, 10, 2);
    }
    w.setRail(20, 10, 2);
    w.setRail(21, 10, 8);
    applyAction(w, 'bulldoze', { x: 10, y: 10 }, { x: 21, y: 10 });
    expect(w.signals).toContainEqual({ t: 'bulldozed', fabTiles: 4 });
    expect(w.rail[w.idx(20, 10)]).toBe(0);
    expect(w.rail[w.idx(21, 10)]).toBe(0);
  });
});

describe('Game story API', () => {
  let store: Map<string, string> | null = null;
  function mockStorage() {
    const m = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    };
    store = m;
    return m;
  }
  afterEach(() => {
    delete (globalThis as any).localStorage;
    store = null;
  });

  it('inspectActions: Crackdown on a precinct, Raise / Crown on a Stratablock', () => {
    const g = flatGame();
    const w = g.world;
    w.funds = 1e6;
    const p = w.addBuilding('precinct', 30, 30)!;
    let [a] = g.inspectActions(30, 30);
    expect(a).toMatchObject({ id: 'crackdown', label: 'Crackdown · 2,000 CR', cost: 2000, enabled: false, buildingId: p.id, radius: 13 });
    expect(a.reason).toMatch(/60,000/);
    w.story.unlocks.push('crackdown');
    p.powered = true;
    own(w, 28, 28, 1, 40);
    [a] = g.inspectActions(31, 31);
    expect(a.enabled).toBe(true);
    w.turf.frozenUntil = w.tick + 100;
    expect(g.inspectActions(31, 31)[0].label).toBe('Crackdown · ends the Truce');
    expect(g.crackdown(p.id).ok).toBe(true);
    expect(g.inspectActions(31, 31)[0]).toMatchObject({ enabled: false, reason: 'Cooldown 90d' });

    w.story.unlocks.push('stack');
    const s = w.addBuilding('stack', 40, 40)!;
    w.setStage(s, 1, 0);
    s.powered = true;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) w.fields.landValue[w.idx(40 + dx, 40 + dy)] = 0.1;
    [a] = g.inspectActions(41, 41);
    expect(a).toMatchObject({ id: 'raise', label: 'Raise to Hab Core · 16,000 CR · 90 d', enabled: false, days: 90 });
    expect(a.reason).toBe('Needs land value 40%, now 10%');
    w.setStage(s, 2, 0);
    w.story.unlocks.push('crowns');
    [a] = g.inspectActions(41, 41);
    expect(a.id).toBe('crown');
    expect(a.crowns!.map((c) => c.id)).toEqual(['foundry', 'glare', 'nest', 'commons']);
    expect(a.crowns!.find((c) => c.id === 'nest')!.enabled).toBe(false);
    expect(a.reason).toBe('Needs a live skybridge, ribbon station or skyway');
    w.setStage(s, 3, 50, 'commons');
    expect(g.inspectActions(41, 41)[0]).toMatchObject({ label: 'Commons Crown · building 50d', enabled: false });
    expect(g.inspectActions(5, 5)).toEqual([]);
  });

  it('getTileInfo adds stage, turf, rail and skybridge rows', () => {
    const g = flatGame();
    const w = g.world;
    w.story.unlocks.push('stack');
    const s = w.addBuilding('stack', 40, 40)!;
    w.setStage(s, 1, 34);
    const rows = Object.fromEntries(g.getTileInfo(41, 41)!.rows);
    expect(rows.Stage).toBe('Plinth · building 34d');
    own(w, 10, 10, 1, 72);
    w.setRail(10, 10, 2);
    w.setRail(11, 10, 8);
    const r2 = Object.fromEntries(g.getTileInfo(10, 10)!.rows);
    expect(r2.Turf).toBe('Undertow 72%');
    expect(r2['Ribbon Rail']).toBe('dead: needs 2 powered stations');
    w.addBuilding('spire', 20, 20);
    expect(Object.fromEntries(g.getTileInfo(20, 20)!.rows).Skybridges).toBe('0/2');
  });

  it('toolCost applies modifiers, credits and the stack scaling', () => {
    const g = flatGame();
    const w = g.world;
    expect(g.toolCost('stack')).toBe(12000);
    w.addBuilding('stack', 40, 40);
    expect(g.toolCost('stack')).toBe(13800);
    w.story.credits.push({ what: 'stack', n: 1, mul: 0.5 });
    expect(g.toolCost('stack')).toBe(6900);
    expect(g.toolCost('skybridge')).toBe(1800);
    expect(g.toolCost('rail')).toBe(110);
    w.mods.buildCostMul = 2;
    expect(g.toolCost('res')).toBe(ZONES.res.cost * 2);
    expect(g.toolCost('rail')).toBe(220);
    expect(Game.toolCost('stack')).toBe(12000);
  });

  it('New City keeps the replaced city in a backup slot; loadPrevious swaps back', () => {
    mockStorage();
    const g = new Game();
    g.newCity('First Light', 1234); // the untouched boot city is not worth a backup
    expect(g.hasPreviousSave()).toBe(false);
    g.setTool('road');
    expect(g.apply({ x: 74, y: 74 }, { x: 84, y: 74 }).valid).toBe(true); // the start slot of a 3×3 region (64..127)
    g.newCity('Second Wind', 5678);
    expect(g.world.cityName).toBe('Second Wind');
    expect(g.hasPreviousSave()).toBe(true);
    expect(g.previousSaveInfo()?.cityName).toBe('First Light');
    expect(g.loadPrevious()).toBe(true);
    expect(g.world.cityName).toBe('First Light');
    expect(g.world.isRoad(79, 74)).toBe(true);
    expect(JSON.parse(store!.get(SAVE_KEY)!).cityName).toBe('First Light');
    expect(g.hasPreviousSave()).toBe(false); // Second Wind had no progress
    // With progress on both sides the slots swap.
    g.newCity('Third Rail', 91011);
    g.setTool('road');
    g.apply({ x: 69, y: 69 }, { x: 73, y: 69 });
    expect(g.loadPrevious()).toBe(true);
    expect(g.world.cityName).toBe('First Light');
    expect(JSON.parse(store!.get(PREV_SAVE_KEY)!).cityName).toBe('Third Rail');
    store!.set(PREV_SAVE_KEY, '{not json');
    expect(g.loadPrevious()).toBe(false);
  });
});
