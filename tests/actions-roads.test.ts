// Expansion road tools, skyways and bulldoze layers (docs/EXPANSION.md §3.4–§3.7, WP-2):
// the §3.4 worked examples, upgrade prices, ramps, the highway cut notes and confirm, the
// skyway placement rules, closed sky ramps (live and after a reload), the one-layer
// bulldoze, the skyway crown requirement, and a note / reason length fuzz.

import { describe, expect, it } from 'vitest';
import { applyAction, lockedReason, planAction, skywayNetwork, stackConnected, stageStatus } from '../src/game/actions';
import { BUILDINGS, ROAD_KINDS, SAFETY, SKYWAY } from '../src/game/config';
import { roadPrice } from '../src/game/roads';
import { Rng } from '../src/game/rng';
import { SKY_E, SKY_N, SKY_RAMP, SKY_S, SKY_W, skyRampActive } from '../src/game/skyway';
import { RoadKind, Terrain, ZoneType, type ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { flatWorld } from './helpers';
import { LEGACY_REGION } from '../src/game/types';

const S = RoadKind.Street;
const A = RoadKind.Avenue;
const H = RoadKind.Highway;
const L = RoadKind.Alley;
const R = RoadKind.Ramp;

/** A flat, rich world with every tool unlocked. */
function rich(): World {
  const w = flatWorld(4321);
  w.funds = 1e7;
  w.maxPopulation = 1e6;
  return w;
}

const kindAt = (w: World, x: number, y: number) => {
  const t = w.tileAt(x, y)!;
  return t.road ? t.roadKind : -1;
};
const row = (w: World, y: number, x0: number, x1: number) => {
  const out: number[] = [];
  for (let x = x0; x <= x1; x++) out.push(kindAt(w, x, y));
  return out;
};
const lay = (w: World, kind: RoadKind, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) w.setRoad(x, y, kind);
};
const develop = (w: World, x: number, y: number, zone = ZoneType.Residential, level = 1) => {
  w.setZone(x, y, zone);
  w.setLevel(x, y, level);
};

describe('§3.4 worked examples', () => {
  it('a street dragged straight across a highway makes S R H R S: a four-way interchange', () => {
    const w = rich();
    lay(w, H, 20, 10, 20, 30);
    const plan = planAction(w, 'road', { x: 18, y: 20 }, { x: 22, y: 20 });
    expect(plan.valid).toBe(true);
    expect(plan.roadKinds).toEqual([S, R, H, R, S]);
    expect(plan.ramps).toBe(2);
    expect(plan.upgrades).toBe(0);
    expect(plan.cost).toBe(2 * 15 + 2 * 60);
    const funds = w.funds;
    applyAction(w, 'road', { x: 18, y: 20 }, { x: 22, y: 20 });
    expect(w.funds).toBe(funds - plan.cost);
    expect(row(w, 20, 18, 22)).toEqual([S, R, H, R, S]);
    expect(w.roadMask(20, 20)).toBe(1 | 2 | 4 | 8); // highway N/S plus both ramp arms
    expect(w.roadMask(19, 20)).toBe(2 | 8); // the ramp joins the street and the highway
  });

  it('a street dragged from a highway end tile outward starts with a ramp', () => {
    const w = rich();
    lay(w, H, 10, 40, 20, 40);
    const plan = planAction(w, 'road', { x: 20, y: 40 }, { x: 25, y: 40 });
    expect(plan.roadKinds).toEqual([H, R, S, S, S, S]);
    expect(plan.ramps).toBe(1);
    applyAction(w, 'road', { x: 20, y: 40 }, { x: 25, y: 40 });
    expect(row(w, 40, 19, 23)).toEqual([H, H, R, S, S]);
  });

  it('an avenue dragged along a street widens it for the price difference (25 a tile, bridges 110)', () => {
    const w = rich();
    for (let x = 14; x <= 16; x++) w.tiles[w.idx(x, 5)].terrain = Terrain.Water;
    lay(w, S, 10, 5, 20, 5);
    const variants = row(w, 5, 10, 20).map((_, k) => w.tileAt(10 + k, 5)!.variant);
    const plan = planAction(w, 'avenue', { x: 10, y: 5 }, { x: 20, y: 5 });
    expect(plan.valid).toBe(true);
    expect(plan.upgrades).toBe(11);
    expect(plan.cost).toBe(8 * 25 + 3 * 110);
    expect(plan.roadKinds).toEqual(Array(11).fill(A));
    applyAction(w, 'avenue', { x: 10, y: 5 }, { x: 20, y: 5 });
    expect(row(w, 5, 10, 20)).toEqual(Array(11).fill(A));
    // Widening keeps each tile's variant (no reroll, no construction animation).
    expect(row(w, 5, 10, 20).map((_, k) => w.tileAt(10 + k, 5)!.variant)).toEqual(variants);
  });

  it('a highway along a street with Hab Blocks on both sides strands them: lostAccess, confirm, the note', () => {
    const w = rich();
    lay(w, S, 10, 30, 16, 30);
    for (let x = 10; x <= 16; x++) {
      develop(w, x, 29);
      develop(w, x, 31);
    }
    const plan = planAction(w, 'highway', { x: 10, y: 30 }, { x: 16, y: 30 });
    expect(plan.valid).toBe(true);
    expect(plan.lostAccess).toBe(14);
    expect(plan.lostTiles).toHaveLength(14);
    expect(plan.confirm).toBe(true);
    expect(plan.note).toBe('14 blocks lose road access');
    expect(plan.cost).toBe(7 * (90 - 15));
  });

  it('a highway across a grid where every lot keeps a street only cuts the cross streets and builds on lift', () => {
    const w = rich();
    lay(w, S, 10, 10, 20, 10);
    lay(w, S, 10, 20, 20, 20);
    lay(w, S, 15, 5, 15, 25);
    for (let y = 11; y <= 13; y++) {
      develop(w, 14, y);
      develop(w, 16, y);
    }
    const plan = planAction(w, 'highway', { x: 15, y: 5 }, { x: 15, y: 25 });
    expect(plan.valid).toBe(true);
    expect(plan.lostAccess).toBe(0);
    expect(plan.lostTiles).toEqual([]);
    expect(plan.confirm).toBeUndefined();
    expect(plan.note).toBe('Cuts 4 cross streets');
  });

  it('a street dragged into a highway bridge: the ramp position is water, so that tile is bad and the rest lays', () => {
    const w = rich();
    for (let y = 0; y < 64; y++) for (let x = 28; x <= 34; x++) w.tiles[w.idx(x, y)].terrain = Terrain.Water;
    lay(w, H, 20, 45, 40, 45); // a highway crossing the channel on a bridge
    const plan = planAction(w, 'road', { x: 31, y: 40 }, { x: 31, y: 45 });
    expect(plan.valid).toBe(true);
    expect(plan.tiles.map((t) => t.ok)).toEqual([true, true, true, true, false, true]);
    expect(plan.reason).toBe('Ramps need land');
    expect(plan.cost).toBe(4 * 90);
    applyAction(w, 'road', { x: 31, y: 40 }, { x: 31, y: 45 });
    expect(kindAt(w, 31, 43)).toBe(S);
    expect(kindAt(w, 31, 44)).toBe(-1);
    expect(kindAt(w, 31, 45)).toBe(H);
  });
});

describe('road kinds: prices, upgrades, shrinking, water and locks', () => {
  it('upgrades cost exactly the price difference, on land and on water', () => {
    const cases: [RoadKind, 'road' | 'avenue' | 'highway', RoadKind][] = [
      [L, 'road', S],
      [L, 'avenue', A],
      [S, 'avenue', A],
      [L, 'highway', H],
      [S, 'highway', H],
      [A, 'highway', H],
      [R, 'highway', H],
    ];
    for (const water of [false, true]) {
      for (const [from, tool, to] of cases) {
        if (water && (from === L || from === R)) continue; // neither sits on water
        const w = rich();
        if (water) w.tiles[w.idx(30, 30)].terrain = Terrain.Water;
        w.setRoad(30, 30, from);
        const plan = planAction(w, tool, { x: 30, y: 30 }, { x: 30, y: 30 });
        expect(plan.valid, `${from}→${tool} water=${water}`).toBe(true);
        expect(plan.upgrades).toBe(1);
        expect(plan.cost).toBe(roadPrice(to, water)! - roadPrice(from, water)!);
        applyAction(w, tool, { x: 30, y: 30 }, { x: 30, y: 30 });
        expect(kindAt(w, 30, 30)).toBe(to);
      }
    }
    // Ramp upgrades by drag: a street at a ramp position becomes a ramp for +45, an avenue for +20.
    for (const [from, extra] of [
      [S, 45],
      [A, 20],
    ] as const) {
      const w = rich();
      w.setRoad(30, 30, H);
      w.setRoad(31, 30, from);
      const plan = planAction(w, from === S ? 'road' : 'avenue', { x: 30, y: 30 }, { x: 31, y: 30 });
      expect(plan.roadKinds).toEqual([H, R]);
      expect(plan.cost).toBe(extra);
      expect(plan.ramps).toBe(1);
    }
  });

  it('smaller tools never shrink a road; re-laying the same kind is free and invalid', () => {
    const shrink: [RoadKind, ToolId][] = [
      [S, 'alley'],
      [A, 'alley'],
      [A, 'road'],
      [H, 'alley'],
      [H, 'road'],
      [H, 'avenue'],
      [R, 'road'],
      [R, 'avenue'],
      [R, 'alley'],
      [S, 'road'],
      [A, 'avenue'],
      [H, 'highway'],
      [L, 'alley'],
    ];
    for (const [kind, tool] of shrink) {
      const w = rich();
      w.setRoad(30, 30, kind);
      const plan = planAction(w, tool, { x: 30, y: 30 }, { x: 30, y: 30 });
      expect(plan.valid, `${tool} over ${kind}`).toBe(false);
      expect(plan.cost).toBe(0);
      expect(plan.reason).toBe('Nothing to change');
      expect(plan.roadKinds).toEqual([kind]);
    }
  });

  it('alleys and ramps never sit on water; no bridge on a berth', () => {
    const w = rich();
    for (let x = 20; x <= 22; x++) w.tiles[w.idx(x, 10)].terrain = Terrain.Water;
    const alley = planAction(w, 'alley', { x: 18, y: 10 }, { x: 24, y: 10 });
    expect(alley.tiles.filter((t) => !t.ok).map((t) => t.x)).toEqual([20, 21, 22]);
    expect(alley.reason).toBe("Alleys can't cross water");
    expect(alley.valid).toBe(true); // the land tiles still lay
    // A street can bridge it; a ramp position on water can't.
    expect(planAction(w, 'road', { x: 18, y: 10 }, { x: 24, y: 10 }).reason).toBeUndefined();
    w.setRoad(23, 10, H);
    const ramp = planAction(w, 'road', { x: 18, y: 10 }, { x: 23, y: 10 });
    expect(ramp.tiles.find((t) => t.x === 22)!.ok).toBe(false);
    expect(ramp.reason).toBe('Ramps need land');
    // A seaport's berth refuses bridges.
    const v = rich();
    for (let y = 30; y < 64; y++) for (let x = 0; x < 64; x++) v.tiles[v.idx(x, y)].terrain = Terrain.Water;
    const sea = v.addBuilding('seaport', 20, 26)!;
    sea.facing = 2;
    const bridge = planAction(v, 'road', { x: 21, y: 30 }, { x: 21, y: 33 });
    expect(bridge.tiles.map((t) => t.ok)).toEqual([false, false, true, true]);
    expect(bridge.reason).toBe('Keep the berth clear');
  });

  it('locked road tools and the skyway refuse with "Locked: reach N residents"', () => {
    const w = flatWorld();
    expect(lockedReason(w, 'road')).toBeNull();
    const want: [ToolId, string][] = [
      ['alley', 'Locked: reach 12,000 residents'],
      ['avenue', 'Locked: reach 15,000 residents'],
      ['highway', 'Locked: reach 50,000 residents'],
      ['skyway', 'Locked: reach 120,000 residents'],
      ['seaport', 'Locked: reach 50,000 residents'],
      ['airport', 'Locked: reach 120,000 residents'],
      ['spaceport', 'Locked: reach 300,000 residents'],
      ['academy', 'Locked: reach 15,000 residents'],
    ];
    for (const [tool, reason] of want) {
      expect(lockedReason(w, tool)).toBe(reason);
      const plan = planAction(w, tool, { x: 10, y: 10 }, { x: 14, y: 10 });
      expect(plan.valid).toBe(false);
      expect(plan.reason).toBe(reason);
      expect(plan.tiles.every((t) => !t.ok)).toBe(true);
    }
    w.maxPopulation = ROAD_KINDS[A].unlockPop;
    expect(lockedReason(w, 'avenue')).toBeNull();
    expect(lockedReason(w, 'alley')).toBeNull();
    expect(lockedReason(w, 'highway')).not.toBeNull();
  });

  it('alley and highway drags never make ramps', () => {
    const w = rich();
    lay(w, H, 20, 10, 20, 30);
    const alley = planAction(w, 'alley', { x: 18, y: 20 }, { x: 22, y: 20 });
    expect(alley.roadKinds).toEqual([L, L, H, L, L]);
    expect(alley.ramps).toBe(0);
    const hwy = planAction(w, 'highway', { x: 18, y: 15 }, { x: 22, y: 15 });
    expect(hwy.roadKinds).toEqual([H, H, H, H, H]);
    expect(hwy.ramps).toBe(0);
  });
});

describe('skyways (§3.7)', () => {
  it('lays joined masks with ramps on street ends, priced per tile and per ramp', () => {
    const w = rich();
    lay(w, S, 10, 10, 10, 10);
    const plan = planAction(w, 'skyway', { x: 10, y: 10 }, { x: 15, y: 10 });
    expect(plan.valid).toBe(true);
    expect(plan.skyMasks).toEqual([SKY_E | SKY_RAMP, SKY_E | SKY_W, SKY_E | SKY_W, SKY_E | SKY_W, SKY_E | SKY_W, SKY_W]);
    expect(plan.ramps).toBe(1);
    expect(plan.cost).toBe(6 * SKYWAY.perTile + SKYWAY.rampCost);
    expect(plan.note).toBeUndefined(); // it lands on the street
    applyAction(w, 'skyway', { x: 10, y: 10 }, { x: 15, y: 10 });
    expect(w.sky[w.idx(10, 10)]).toBe(SKY_E | SKY_RAMP);
    expect(skyRampActive(w, w.idx(10, 10))).toBe(true);
    expect(skywayNetwork(w, w.idx(13, 10))).toEqual({ tiles: 6, ramps: 1, closed: 0, docks: 0 });
    // Re-dragging the same deck changes nothing.
    expect(planAction(w, 'skyway', { x: 10, y: 10 }, { x: 15, y: 10 }).reason).toBe('Nothing to change');
  });

  it('ramps only on Street, Avenue or Ramp ground at a path end', () => {
    for (const [kind, ramp] of [
      [S, true],
      [A, true],
      [R, true],
      [H, false],
      [L, false],
    ] as const) {
      const w = rich();
      w.setRoad(20, 20, kind);
      const plan = planAction(w, 'skyway', { x: 20, y: 20 }, { x: 20, y: 24 });
      expect((plan.skyMasks![0] & SKY_RAMP) !== 0, `kind ${kind}`).toBe(ramp);
    }
    // Middle tiles over a street never ramp.
    const w = rich();
    w.setRoad(20, 22, S);
    const plan = planAction(w, 'skyway', { x: 20, y: 20 }, { x: 20, y: 24 });
    expect(plan.skyMasks!.every((m) => (m & SKY_RAMP) === 0)).toBe(true);
    expect(plan.note).toBe('Lands nowhere');
  });

  it('extending through a ramp gives it a second link and clears the ramp bit', () => {
    const w = rich();
    w.setRoad(10, 10, S);
    w.setRoad(10, 15, S);
    applyAction(w, 'skyway', { x: 10, y: 10 }, { x: 15, y: 10 });
    expect(w.sky[w.idx(10, 10)] & SKY_RAMP).toBe(SKY_RAMP);
    const plan = planAction(w, 'skyway', { x: 10, y: 10 }, { x: 10, y: 15 });
    expect(plan.skyMasks![0]).toBe(SKY_E | SKY_S); // the touch-down moves to the new end
    expect(plan.skyMasks!.at(-1)).toBe(SKY_N | SKY_RAMP);
    expect(plan.cost).toBe(5 * SKYWAY.perTile + SKYWAY.rampCost);
    applyAction(w, 'skyway', { x: 10, y: 10 }, { x: 10, y: 15 });
    expect(w.sky[w.idx(10, 10)]).toBe(SKY_E | SKY_S);
    expect(skywayNetwork(w, w.idx(15, 10)).ramps).toBe(1);
  });

  it('caps a drag at 24 tiles and needs at least 2', () => {
    const w = rich();
    const long = planAction(w, 'skyway', { x: 2, y: 30 }, { x: 40, y: 30 });
    expect(long.tiles).toHaveLength(SKYWAY.maxDrag);
    expect(long.reason).toBe('Max 24 tiles per drag');
    expect(long.valid).toBe(true);
    const one = planAction(w, 'skyway', { x: 5, y: 5 }, { x: 5, y: 5 });
    expect(one.valid).toBe(false);
    expect(one.reason).toBe('Drag to lay a skyway');
  });

  it('passes over roads, zones, water and rail, and only skyAnchor buildings', () => {
    const w = rich();
    w.tiles[w.idx(12, 40)].terrain = Terrain.Water;
    w.setRoad(13, 40, H);
    develop(w, 14, 40, ZoneType.Commercial, 3);
    w.setRail(15, 40, 2);
    w.setRail(16, 40, 8);
    expect(planAction(w, 'skyway', { x: 10, y: 40 }, { x: 18, y: 40 }).valid).toBe(true);
    w.addBuilding('plaza', 17, 40);
    const blocked = planAction(w, 'skyway', { x: 10, y: 40 }, { x: 18, y: 40 });
    expect(blocked.valid).toBe(false);
    expect(blocked.reason).toBe('Blocked by buildings');
    expect(blocked.tiles.find((t) => t.x === 17)!.ok).toBe(false);
    // Anchors: a Stratablock, Spire, Arcology or Airport footprint can carry a deck (and docks it).
    for (const type of ['stack', 'spire', 'arcology', 'airport'] as const) {
      const v = rich();
      const b = v.addBuilding(type, 30, 30)!;
      const plan = planAction(v, 'skyway', { x: 25, y: 30 }, { x: 31, y: 30 });
      expect(plan.valid, type).toBe(true);
      expect(plan.note).toBeUndefined(); // docked: it lands somewhere
      applyAction(v, 'skyway', { x: 25, y: 30 }, { x: 31, y: 30 });
      expect(skywayNetwork(v, v.idx(26, 30)).docks).toBe(1);
      expect(b.id).toBeGreaterThan(0);
    }
  });

  // MEGACITY §5.2: a skybridge may now pass over a skyway (their heights never meet). The skyway side of EXPANSION
  // §3.7's rule ("Skybridge in the way") lives in skyway.ts and goes at Step 9 (WP-2 hand-off).
  it('a skybridge gap tile still refuses a skyway (skyway.ts), and a skybridge now passes over a skyway (v2)', () => {
    const tall = (w: World, x: number, y: number) => {
      const b = w.addBuilding('spire', x, y)!;
      b.powered = true;
      return b;
    };
    const w = rich();
    w.story.unlocks.push('skybridge');
    tall(w, 10, 20);
    tall(w, 16, 20);
    applyAction(w, 'skybridge', { x: 11, y: 20 }, { x: 16, y: 20 });
    expect(w.links).toHaveLength(1);
    const sky = planAction(w, 'skyway', { x: 13, y: 15 }, { x: 13, y: 25 });
    expect(sky.valid).toBe(false);
    expect(sky.reason).toBe('Skybridge in the way');
    // The other way round.
    const v = rich();
    v.story.unlocks.push('skybridge');
    tall(v, 10, 20);
    tall(v, 16, 20);
    applyAction(v, 'skyway', { x: 13, y: 15 }, { x: 13, y: 25 });
    const bridge = planAction(v, 'skybridge', { x: 11, y: 20 }, { x: 16, y: 20 });
    expect(bridge.valid).toBe(true);
    expect(bridge.reason).toBeUndefined();
  });

  it('a highway drag under a sky ramp closes it, live and after a save round trip alike', () => {
    const w = rich();
    lay(w, S, 10, 20, 20, 20);
    applyAction(w, 'skyway', { x: 12, y: 20 }, { x: 12, y: 15 });
    const ramp = w.idx(12, 20);
    expect(skyRampActive(w, ramp)).toBe(true);
    const plan = planAction(w, 'highway', { x: 10, y: 20 }, { x: 20, y: 20 });
    expect(plan.note).toBe('Closes 1 skyway ramp');
    expect(plan.confirm).toBeUndefined();
    applyAction(w, 'highway', { x: 10, y: 20 }, { x: 20, y: 20 });
    expect(w.sky[ramp] & SKY_RAMP).toBe(SKY_RAMP); // the bit stays
    expect(skyRampActive(w, ramp)).toBe(false);
    expect(skywayNetwork(w, ramp)).toMatchObject({ ramps: 0, closed: 1 });
    const l = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    expect(l.sky[ramp] & SKY_RAMP).toBe(SKY_RAMP);
    expect(skyRampActive(l, ramp)).toBe(false);
    expect(skywayNetwork(l, ramp)).toMatchObject({ ramps: 0, closed: 1 });
    // A street re-laid under it reopens it (the ground under a ramp is what counts).
    w.clearTile(12, 20);
    w.setRoad(12, 20, S);
    expect(skyRampActive(w, ramp)).toBe(true);
  });

  it('a Stratablock docked by a skyway with an active ramp meets the crown requirement', () => {
    const w = rich();
    w.story.unlocks.push('stack', 'crowns');
    const b = w.addBuilding('stack', 30, 30)!;
    w.setStage(b, 2, 0);
    w.setRoad(24, 31, S);
    expect(stackConnected(w, b)).toBe(false);
    applyAction(w, 'skyway', { x: 24, y: 31 }, { x: 31, y: 31 });
    expect(stackConnected(w, b)).toBe(true);
    w.setRoadKind(24, 31, H); // the ramp's street becomes a highway: closed
    expect(stackConnected(w, b)).toBe(false);
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) w.fields.landValue[w.idx(30 + dx, 30 + dy)] = 0.6;
    expect(stageStatus(w, b).reason).toBe('Needs a live skybridge, ribbon station or skyway');
  });
});

describe('bulldoze layers (§3.6)', () => {
  /** A street with zones and a skyway deck over it, landing on the street at (10, 10). */
  function decked(): World {
    const w = rich();
    lay(w, S, 10, 10, 20, 10);
    for (let x = 12; x <= 18; x++) develop(w, x, 11);
    applyAction(w, 'skyway', { x: 10, y: 10 }, { x: 18, y: 10 });
    return w;
  }

  it('a drag starting on a deck removes only skyway segments', () => {
    const w = decked();
    const plan = planAction(w, 'bulldoze', { x: 14, y: 10 }, { x: 16, y: 11 });
    expect(plan.layer).toBe('sky');
    expect(plan.tiles.filter((t) => t.ok).length).toBe(3); // only the deck tiles count
    expect(plan.cost).toBe(3 * SKYWAY.bulldozeCost);
    applyAction(w, 'bulldoze', { x: 14, y: 10 }, { x: 16, y: 11 });
    for (let x = 14; x <= 16; x++) {
      expect(w.sky[w.idx(x, 10)]).toBe(0);
      expect(kindAt(w, x, 10)).toBe(S);
      expect(w.tileAt(x, 11)!.level).toBe(1);
    }
    // The neighbours were unhooked; the cut-off end (17, 18) is its own little deck.
    expect(w.sky[w.idx(13, 10)]).toBe(SKY_W);
    expect(w.sky[w.idx(17, 10)]).toBe(SKY_E);
  });

  it('a drag starting on the ground clears roads and zones and leaves the deck spanning the site', () => {
    const w = decked();
    const plan = planAction(w, 'bulldoze', { x: 14, y: 11 }, { x: 16, y: 10 });
    expect(plan.layer).toBe('ground');
    applyAction(w, 'bulldoze', { x: 14, y: 11 }, { x: 16, y: 10 });
    for (let x = 14; x <= 16; x++) {
      expect(w.tileAt(x, 10)!.road).toBe(false);
      expect(w.tileAt(x, 11)!.zone).toBe(ZoneType.None);
      expect(w.sky[w.idx(x, 10)]).toBe(SKY_E | SKY_W);
    }
    // A tile with only a deck over it has nothing on the ground layer.
    const v = rich();
    applyAction(v, 'skyway', { x: 30, y: 30 }, { x: 35, y: 30 });
    const ground = planAction(v, 'bulldoze', { x: 29, y: 30 }, { x: 33, y: 30 });
    expect(ground.layer).toBe('ground');
    expect(ground.valid).toBe(false);
    expect(ground.reason).toBe('Nothing to demolish');
  });

  it('a sky drag never removes buildings under the deck', () => {
    const w = rich();
    const b = w.addBuilding('stack', 30, 30)!;
    applyAction(w, 'skyway', { x: 26, y: 31 }, { x: 33, y: 31 });
    applyAction(w, 'bulldoze', { x: 26, y: 31 }, { x: 33, y: 33 });
    expect(w.buildings.has(b.id)).toBe(true);
    expect(w.sky.every((v) => v === 0)).toBe(true);
  });
});

describe('planner notes and reasons stay short (§7.5)', () => {
  it('fuzzes every new tool over a mixed city: every note and reason ≤ 32 characters', () => {
    const w = World.generate(2091, 'Fuzz Harbor', undefined, LEGACY_REGION);
    w.funds = 1e9;
    w.maxPopulation = 1e6;
    const rng = new Rng(9);
    const tools: ToolId[] = ['road', 'avenue', 'highway', 'alley', 'skyway', 'bulldoze', 'res', 'com', 'academy', 'seaport', 'airport', 'spaceport', 'stack', 'plaza'];
    const p = () => ({ x: rng.int(-1, 64), y: rng.int(-1, 64) });
    const seen = new Set<string>();
    for (let k = 0; k < 2500; k++) {
      const tool = rng.pick(tools);
      const a = p();
      const b = rng.chance(0.3) ? a : { x: a.x + rng.int(-12, 12), y: a.y + rng.int(-12, 12) };
      const plan = rng.chance(0.5) ? applyAction(w, tool, a, b) : planAction(w, tool, a, b);
      for (const s of [plan.note, plan.reason]) {
        if (s === undefined) continue;
        seen.add(s);
        expect(s.length, s).toBeLessThanOrEqual(SAFETY.noteMax);
      }
      if (plan.roadKinds) expect(plan.roadKinds).toHaveLength(plan.tiles.length);
      if (plan.skyMasks) expect(plan.skyMasks).toHaveLength(plan.tiles.length);
    }
    // The fuzz reached the interesting branches.
    for (const s of ['Lands nowhere', 'Blocked by buildings', 'Nothing to change']) expect(seen.has(s), s).toBe(true);
    // Every world invariant still holds.
    for (let i = 0; i < 4096; i++) {
      const t = w.tiles[i];
      if (!t.road) expect(t.roadKind).toBe(S);
      if (t.terrain === Terrain.Water) expect(t.roadKind === L || t.roadKind === R).toBe(false);
      const m = w.sky[i] & 15;
      for (const [bit, dx, dy, opp] of [
        [SKY_N, 0, -1, SKY_S],
        [SKY_E, 1, 0, SKY_W],
        [SKY_S, 0, 1, SKY_N],
        [SKY_W, -1, 0, SKY_E],
      ]) {
        if (!(m & bit)) continue;
        const x = (i % 64) + dx;
        const y = ((i / 64) | 0) + dy;
        expect(w.inBounds(x, y) && (w.sky[w.idx(x, y)] & opp) !== 0).toBe(true);
      }
    }
    expect(BUILDINGS.seaport.size).toBe(4);
  });
});
