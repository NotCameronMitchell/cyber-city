// Vertical systems (STORY.md §4): skybridge validation, sealing and reopening,
// live-network BFS, stations, layers, stages and the vertical mod patch.

import { describe, expect, it } from 'vitest';
import { applyAction, planAction, raiseStage } from '../src/game/actions';
import { RIBBON, SKYBRIDGE, STACK_STAGES } from '../src/game/config';
import * as vertical from '../src/game/story/vertical';
import { Terrain, ZoneType, type Building } from '../src/game/types';
import type { World } from '../src/game/world';
import { flatWorld } from './helpers';

/** A level-3, powered Hab tile: a tall zone anchor. */
function tallTile(w: World, x: number, y: number, zone = ZoneType.Residential) {
  w.setZone(x, y, zone);
  w.setLevel(x, y, 3);
  w.tiles[w.idx(x, y)].powered = true;
}

function skyWorld(): World {
  const w = flatWorld();
  w.funds = 1e6;
  w.story.unlocks.push('skybridge', 'rail');
  vertical.refresh(w); // first refresh of a world is quiet
  return w;
}

function powered(b: Building | null): Building {
  b!.powered = true;
  return b!;
}

describe('skybridge validation', () => {
  it('needs the unlock (or 90,000 residents)', () => {
    const w = flatWorld();
    tallTile(w, 10, 10);
    tallTile(w, 14, 10);
    const p = planAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 });
    expect(p.valid).toBe(false);
    expect(p.reason).toMatch(/90,000/);
    w.maxPopulation = 90000;
    expect(planAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 }).valid).toBe(true);
  });

  it('prices by gap and describes the span for the renderer', () => {
    const w = skyWorld();
    tallTile(w, 10, 10);
    tallTile(w, 14, 10);
    const p = planAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 });
    expect(p.valid).toBe(true);
    expect(p.cost).toBe(SKYBRIDGE.base + SKYBRIDGE.perTile * 3);
    expect(p.span).toEqual({ ax: 10, ay: 10, bx: 14, by: 10, gap: 3 });
    expect(p.tiles.map((t) => t.x)).toEqual([10, 11, 12, 13, 14]);
    w.mods.buildCostMul = 2;
    expect(planAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 }).cost).toBe(2 * (1200 + 900));
  });

  it('checks straightness, tall anchors and the 2..8 gap', () => {
    const w = skyWorld();
    tallTile(w, 10, 10);
    tallTile(w, 14, 12);
    tallTile(w, 12, 10);
    tallTile(w, 20, 20);
    tallTile(w, 30, 20);
    const reason = (a: [number, number], b: [number, number]) =>
      planAction(w, 'skybridge', { x: a[0], y: a[1] }, { x: b[0], y: b[1] }).reason;
    expect(reason([10, 10], [14, 12])).toMatch(/straight/);
    expect(reason([10, 10], [12, 10])).toBe('Gap 1: min 2');
    expect(reason([20, 20], [30, 20])).toBe('Gap 9: max 8');
    expect(reason([10, 10], [10, 15])).toBe('End on a tall tower');
    expect(reason([11, 30], [15, 30])).toBe('Start on a tall tower');
    expect(reason([10, 10], [10, 10])).toMatch(/another tall tower/);
    // A tower between the anchors blocks the span.
    tallTile(w, 16, 10);
    expect(reason([10, 10], [16, 10])).toBe('A tower is in the way');
  });

  it('normalises building anchors to the facing footprint edges', () => {
    const w = skyWorld();
    powered(w.addBuilding('spire', 20, 20));
    powered(w.addBuilding('spire', 26, 20));
    const p = planAction(w, 'skybridge', { x: 20, y: 20 }, { x: 27, y: 20 });
    expect(p.valid).toBe(true);
    expect(p.span).toEqual({ ax: 21, ay: 20, bx: 26, by: 20, gap: 4 });
    // Dragging within one building is not a bridge.
    expect(planAction(w, 'skybridge', { x: 20, y: 20 }, { x: 21, y: 20 }).reason).toMatch(/another tall tower/);
  });

  it('refuses a gap tile under a skyway deck (EXPANSION §3.7)', () => {
    const w = skyWorld();
    tallTile(w, 10, 10);
    tallTile(w, 14, 10);
    w.setSky(12, 9, 4);
    w.setSky(12, 10, 1 | 4);
    w.setSky(12, 11, 1);
    const plan = planAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 });
    expect(plan.valid).toBe(false);
    expect(plan.reason).toBe('Skyway in the way');
    expect(plan.tiles.find((t) => t.x === 12)!.ok).toBe(false);
    w.clearSky(12, 10);
    expect(planAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 }).valid).toBe(true);
  });

  it('allows at most 2 bridges per anchor and no shared gap tiles', () => {
    const w = skyWorld();
    for (const [x, y] of [
      [10, 10],
      [14, 10],
      [10, 14],
      [6, 10],
      [12, 7],
      [12, 13],
    ]) tallTile(w, x, y);
    expect(applyAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 }).valid).toBe(true);
    expect(planAction(w, 'skybridge', { x: 14, y: 10 }, { x: 10, y: 10 }).reason).toBe('Already linked');
    expect(applyAction(w, 'skybridge', { x: 10, y: 10 }, { x: 10, y: 14 }).valid).toBe(true);
    expect(planAction(w, 'skybridge', { x: 6, y: 10 }, { x: 10, y: 10 }).reason).toMatch(/at most 2/);
    // (12, 7) → (12, 13) would cross the first bridge's gap at (12, 10).
    expect(planAction(w, 'skybridge', { x: 12, y: 7 }, { x: 12, y: 13 }).reason).toBe('Another skybridge crosses here');
    expect(w.links.length).toBe(2);
    expect(vertical.linksOnAnchor(w, vertical.anchorKey(w, 10, 10))).toBe(2);
  });
});

describe('skybridge sealing and effects', () => {
  it('is active while both anchors are tall and powered; seals and reopens', () => {
    const w = skyWorld();
    tallTile(w, 10, 10);
    tallTile(w, 14, 10);
    applyAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 });
    const id = w.links[0].id;
    expect(w.vertical.activeLinks.has(id)).toBe(true);
    expect(w.vertical.metrics.skybridges).toBe(1);
    expect(vertical.upkeep(w).skybridges).toBe(SKYBRIDGE.upkeepBase + SKYBRIDGE.upkeepPerTile * 3);
    // Effects: lv near each end, trips × 0.8 on the anchors.
    const L = w.layerParts.vertical;
    expect(L.lvAdd[w.idx(9, 10)]).toBeCloseTo(SKYBRIDGE.lv, 5);
    expect(L.lvAdd[w.idx(30, 30)]).toBe(0);
    expect(L.tripMul[w.idx(10, 10)]).toBeCloseTo(SKYBRIDGE.tripMul, 5);
    expect(L.tripMul[w.idx(12, 10)]).toBe(1);
    expect(w.layers.lvAdd[w.idx(9, 10)]).toBeCloseTo(SKYBRIDGE.lv, 5); // composed

    // An anchor drops below the skyline: sealed, dark, free.
    w.setLevel(14, 10, 2);
    vertical.refresh(w);
    expect(w.vertical.activeLinks.has(id)).toBe(false);
    expect(vertical.linkSealed(w, w.links[0])).toBe(true);
    expect(vertical.upkeep(w).skybridges).toBe(0);
    expect(w.news.some((n) => n.text.startsWith('Skybridge sealed'))).toBe(true);
    expect(w.layerParts.vertical.lvAdd[w.idx(9, 10)]).toBe(0);

    // It reopens on its own.
    w.setLevel(14, 10, 3);
    vertical.refresh(w);
    expect(w.vertical.activeLinks.has(id)).toBe(true);

    // Unpowered: dark but not sealed (still costs upkeep).
    w.tiles[w.idx(14, 10)].powered = false;
    vertical.refresh(w);
    expect(w.vertical.activeLinks.has(id)).toBe(false);
    expect(vertical.upkeep(w).skybridges).toBeGreaterThan(0);
  });

  it('bulldozing an anchor deletes its bridges', () => {
    const w = skyWorld();
    tallTile(w, 10, 10);
    tallTile(w, 14, 10);
    applyAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 });
    expect(applyAction(w, 'bulldoze', { x: 14, y: 10 }, { x: 14, y: 10 }).valid).toBe(true);
    expect(w.links).toEqual([]);
    expect(w.vertical.metrics.skybridges).toBe(0);
  });

  it('verticalPatch: bridge and cluster demand, Commons Halls and crowns', () => {
    const w = skyWorld();
    tallTile(w, 10, 10);
    tallTile(w, 14, 10);
    tallTile(w, 18, 10);
    applyAction(w, 'skybridge', { x: 10, y: 10 }, { x: 14, y: 10 });
    expect(vertical.verticalPatch(w).demandCom).toBeCloseTo(0.01, 6);
    applyAction(w, 'skybridge', { x: 14, y: 10 }, { x: 18, y: 10 });
    // 2 bridges + a 3-anchor cluster: 0.02 + 0.02 × (3 − 2).
    expect(vertical.verticalPatch(w).demandCom).toBeCloseTo(0.04, 6);

    for (let k = 0; k < 3; k++) powered(w.addBuilding('commons', 30 + k * 3, 30));
    expect(vertical.verticalPatch(w).approvalAdd).toBe(4); // +2 each, max +4

    const s = powered(w.addBuilding('stack', 40, 40));
    w.setStage(s, 3, 0, 'glare');
    const p = vertical.verticalPatch(w);
    expect(p.taxIncomeMul).toBeCloseTo(1.02, 6);
    w.setStage(s, 3, 0, 'nest');
    expect(vertical.verticalPatch(w).traceMonthly).toBe(-1);
    s.powered = false;
    expect(vertical.verticalPatch(w).traceMonthly).toBeUndefined();
  });
});

describe('ribbon rail', () => {
  function line(w: World) {
    const a = powered(w.addBuilding('maglev', 10, 10));
    const b = powered(w.addBuilding('maglev', 20, 10));
    return { a, b, plan: applyAction(w, 'rail', { x: 12, y: 10 }, { x: 19, y: 10 }) };
  }

  it('lays joined track and prices land and water tiles', () => {
    const w = skyWorld();
    w.tiles[w.idx(15, 10)].terrain = Terrain.Water;
    const p = planAction(w, 'rail', { x: 12, y: 10 }, { x: 19, y: 10 });
    expect(p.valid).toBe(true);
    expect(p.cost).toBe(7 * RIBBON.perTile + RIBBON.perWaterTile);
    expect(p.railMasks).toEqual([2, 10, 10, 10, 10, 10, 10, 8]);
    applyAction(w, 'rail', { x: 12, y: 10 }, { x: 19, y: 10 });
    expect(w.rail[w.idx(12, 10)]).toBe(2);
    expect(w.rail[w.idx(13, 10)]).toBe(10);
    // Joining a branch onto existing track adds the bit both ways and charges only new tiles.
    const j = planAction(w, 'rail', { x: 14, y: 10 }, { x: 14, y: 13 });
    expect(j.cost).toBe(3 * RIBBON.perTile);
    applyAction(w, 'rail', { x: 14, y: 10 }, { x: 14, y: 13 });
    expect(w.rail[w.idx(14, 10)]).toBe(10 | 4);
    expect(w.rail[w.idx(14, 11)]).toBe(1 | 4);
    // Single taps, buildings in the way.
    expect(planAction(w, 'rail', { x: 30, y: 30 }, { x: 30, y: 30 }).reason).toBe('Drag to lay track');
    w.addBuilding('plaza', 33, 30);
    expect(planAction(w, 'rail', { x: 30, y: 30 }, { x: 36, y: 30 }).reason).toBe('Blocked by buildings');
    // Long drags are cut to the max.
    const long = planAction(w, 'rail', { x: 0, y: 40 }, { x: 63, y: 40 });
    expect(long.tiles.length).toBe(RIBBON.maxDrag);
  });

  it('is live with 2 powered stations; dead with one, or when knocked out', () => {
    const w = skyWorld();
    const { a, b } = line(w);
    const v = w.vertical;
    expect(v.railLive[w.idx(15, 10)]).toBe(1);
    expect([...v.liveStations].sort()).toEqual([a.id, b.id].sort());
    expect(v.metrics.railMaxStations).toBe(2);
    expect(v.metrics.railTiles).toBe(8);
    expect(w.news.some((n) => n.text === 'Ribbon live: 2 stations joined by light.')).toBe(true);
    expect(vertical.railNetworkAt(w, 15, 10)).toMatchObject({ live: true, stations: 2, out: false });
    expect(vertical.upkeep(w).rail).toBeCloseTo(8 * RIBBON.upkeep, 6);

    // Layers: transit on and near the track, station discs (Maglev 11 → 14), trips near the line.
    const L = w.layerParts.vertical;
    expect(L.transitAdd[w.idx(15, 11)]).toBeGreaterThanOrEqual(RIBBON.transit);
    expect(L.transitAdd[w.idx(11, 24)]).toBeGreaterThan(0); // 13 tiles from the maglev centre
    expect(L.tripMul[w.idx(15, 12)]).toBeCloseTo(RIBBON.tripMul, 5);
    expect(w.layers.transitAdd[w.idx(15, 11)]).toBeGreaterThanOrEqual(RIBBON.transit);

    b.powered = false;
    vertical.refresh(w);
    expect(v.railLive[w.idx(15, 10)]).toBe(0);
    expect(v.metrics.railMaxStations).toBe(0);
    expect(w.news.some((n) => n.text.startsWith('Ribbon line dark near'))).toBe(true);
    expect(w.layerParts.vertical.transitAdd[w.idx(15, 11)]).toBe(0);

    b.powered = true;
    w.story.railOut.push({ i: vertical.railOutTarget(w), until: w.tick + 30 });
    vertical.refresh(w);
    expect(v.railLive[w.idx(15, 10)]).toBe(0);
    expect(vertical.railNetworkAt(w, 15, 10)?.out).toBe(true);
    w.tick += 31;
    vertical.refresh(w);
    expect(v.railLive[w.idx(15, 10)]).toBe(1);
  });

  it('counts a Stratablock as a station only once its Plinth is complete', () => {
    const w = skyWorld();
    powered(w.addBuilding('maglev', 10, 10));
    const s = powered(w.addBuilding('stack', 20, 9));
    w.setStage(s, 1, 60);
    applyAction(w, 'rail', { x: 12, y: 10 }, { x: 19, y: 10 });
    expect(w.vertical.railLive[w.idx(15, 10)]).toBe(0);
    w.setStage(s, 1, 0);
    vertical.refresh(w);
    expect(w.vertical.railLive[w.idx(15, 10)]).toBe(1);
    expect(w.vertical.liveStations.has(s.id)).toBe(true);
    // Stack disc is r7.
    expect(w.layerParts.vertical.transitAdd[w.idx(22, 16)]).toBeGreaterThan(0);
    expect(w.layerParts.vertical.transitAdd[w.idx(22, 19)]).toBe(0);
  });

  it('bulldozing track removes it for 5 CR a tile and splits the line', () => {
    const w = skyWorld();
    line(w);
    const p = planAction(w, 'bulldoze', { x: 15, y: 10 }, { x: 15, y: 10 });
    expect(p.valid).toBe(true);
    expect(p.cost).toBe(RIBBON.bulldozeCost);
    applyAction(w, 'bulldoze', { x: 15, y: 10 }, { x: 15, y: 10 });
    expect(w.rail[w.idx(15, 10)]).toBe(0);
    expect(w.rail[w.idx(14, 10)] & 2).toBe(0);
    expect(w.vertical.railLive[w.idx(13, 10)]).toBe(0);
  });

  it('railArea widens the rail target', () => {
    const w = skyWorld();
    line(w);
    expect(vertical.railArea(w).length).toBe(8);
    expect(vertical.railArea(w, 1).length).toBe(10 * 3); // x 11..20, rows 9..11
  });
});

describe('Stratablock stages', () => {
  function stackWorld() {
    const w = skyWorld();
    w.story.unlocks.push('stack');
    for (let x = 5; x <= 30; x++) w.setRoad(x, 9);
    const p = applyAction(w, 'stack', { x: 11, y: 11 }, { x: 11, y: 11 });
    expect(p.valid).toBe(true);
    const b = w.buildingAt(10, 10)!;
    b.powered = true;
    return { w, b };
  }

  it('builds the Plinth over 60 days, then completes with news', () => {
    const { w, b } = stackWorld();
    expect(b.stage).toBe(1);
    expect(b.buildDays).toBe(STACK_STAGES[0].days);
    for (let d = 1; d < 60; d++) expect(vertical.onDay(w)).toBe(false);
    expect(b.buildDays).toBe(1);
    expect(vertical.onDay(w)).toBe(true);
    expect(b.buildDays).toBe(0);
    expect(w.news.at(-1)!.text).toMatch(/^Plinth complete in .+\. The skyline steps up\.$/);
  });

  it('raises Hab Core on land value, Crown on unlock plus a live link', () => {
    const { w, b } = stackWorld();
    expect(raiseStage(w, b.id).reason).toBe('Building, 60d left');
    b.buildDays = 0;
    expect(raiseStage(w, b.id).reason).toBe('Needs land value 40%, now 0%');
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) w.fields.landValue[w.idx(10 + dx, 10 + dy)] = 0.45;
    const funds = w.funds;
    const r = raiseStage(w, b.id);
    expect(r).toEqual({ ok: true, cost: STACK_STAGES[1].cost });
    expect(w.funds).toBe(funds - STACK_STAGES[1].cost);
    expect(b.stage).toBe(2);
    expect(b.buildDays).toBe(STACK_STAGES[1].days);
    expect(w.vertical.metrics.stacksStage2).toBe(0);
    b.buildDays = 1;
    vertical.onDay(w);
    expect(w.vertical.metrics.stacksStage2).toBe(1);
    expect(vertical.isTallAt(w, 12, 12)).toBe(true);

    expect(raiseStage(w, b.id, 'glare').reason).toMatch(/200,000/);
    w.story.unlocks.push('crowns');
    expect(raiseStage(w, b.id, 'glare').reason).toBe('Needs a live skybridge, ribbon station or skyway');
    tallTile(w, 17, 12);
    applyAction(w, 'skybridge', { x: 13, y: 12 }, { x: 17, y: 12 });
    expect(w.vertical.metrics.skybridges).toBe(1);
    expect(raiseStage(w, b.id).reason).toBe('Pick a crown');
    expect(raiseStage(w, b.id, 'nest').reason).toMatch(/Needs Kites 20/);
    const nacre = w.story.favor.nacre;
    expect(raiseStage(w, b.id, 'glare').ok).toBe(true);
    expect(w.story.favor.nacre).toBe(nacre + 8);
    expect(b.crown).toBe('glare');
    b.buildDays = 1;
    vertical.onDay(w);
    expect(w.vertical.metrics.crowns.glare).toBe(1);
    expect(w.vertical.metrics.stacksStage3).toBe(1);
    expect(raiseStage(w, b.id).reason).toBe('Fully raised');
    // Glare crown lifts land value around it.
    expect(w.layerParts.vertical.lvAdd[w.idx(12, 19)]).toBeGreaterThan(0);
  });

  it('shades Hab tiles and brightens Market tiles around a Hab Core', () => {
    const { w, b } = stackWorld();
    w.setZone(14, 12, ZoneType.Residential);
    w.setLevel(14, 12, 1);
    w.setZone(15, 13, ZoneType.Commercial);
    w.setLevel(15, 13, 1);
    w.setStage(b, 2, 0);
    vertical.refresh(w);
    const L = w.layerParts.vertical;
    expect(L.lvAdd[w.idx(14, 12)]).toBeCloseTo(-0.04, 5);
    expect(L.lvAdd[w.idx(15, 13)]).toBeCloseTo(0.03, 5);
  });

  it('Glarewalls cut crime nearby', () => {
    const w = skyWorld();
    powered(w.addBuilding('glarewall', 30, 30));
    vertical.refresh(w);
    expect(w.layerParts.vertical.crimeAdd[w.idx(31, 31)]).toBeCloseTo(-0.05, 5);
    expect(w.layerParts.vertical.crimeAdd[w.idx(40, 40)]).toBe(0);
    expect(vertical.isTallAt(w, 30, 30)).toBe(true);
  });
});
