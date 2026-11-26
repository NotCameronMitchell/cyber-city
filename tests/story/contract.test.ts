// Step 0 contract checks: the story layer's shared shapes exist, default to
// inert identities, and leave the sandbox (save, actions, sim) unchanged.

import { describe, expect, it } from 'vitest';
import { lockedReason } from '../../src/game/actions';
import { buildingStats, completeStage } from '../../src/game/buildingStats';
import {
  BUILDINGS,
  BUILDING_ORDER,
  CROWNS,
  MILESTONES,
  SAVE_VERSION,
  STACK_STAGES,
  START_FAVOR,
  UNLOCK_FALLBACK_POP,
  ZONES,
} from '../../src/game/config';
import { CITY_NAME_MAX, Game, randomCityName } from '../../src/game/game';
import { CORPS, CREWS, DISTRICTS, EVENT_COPY, HEADLINES } from '../../src/game/news';
import { cloneMods } from '../../src/game/story/mods';
import { emptyStoryView } from '../../src/game/story/state';
import type { Building, BuildingType, SaveData } from '../../src/game/types';
import { World } from '../../src/game/world';
import { act, makeSim } from '../helpers';
import { LEGACY_REGION } from '../../src/game/types';
import { toV3 } from '../legacy-save';

const NEW_TYPES: BuildingType[] = ['stack', 'foundry', 'glarewall', 'tidemarket', 'roost', 'commons', 'memorial'];

describe('world story defaults', () => {
  it('a new world carries inert story state', () => {
    const w = new World(7, 'Default Reach', undefined, LEGACY_REGION);
    expect(w.cityName).toBe('Default Reach');
    expect(new World(7, undefined, undefined, LEGACY_REGION).cityName).toBe('Lanthorn Bay');
    expect(w.story.chapter).toBe(1);
    expect(w.story.phase).toBe('waiting');
    expect(w.story.favor).toEqual(START_FAVOR);
    expect(w.mods).toEqual(cloneMods());
    expect(w.layers.tripMul.every((v) => v === 1)).toBe(true);
    expect(w.layers.crimeAdd.every((v) => v === 0)).toBe(true);
    expect(w.turf.owner.every((v) => v === 0)).toBe(true);
    expect(w.turf.stats.strongest).toEqual({ undertow: -1, kites: -1 });
    expect(w.rail.length).toBe(64 * 64);
    expect(w.links).toEqual([]);
    expect(w.signals).toEqual([]);
    expect(w.ledger).toEqual({ income: [], expense: [] });
    expect(w.vertical.metrics.skybridges).toBe(0);
  });

  it('story state is JSON-safe', () => {
    const w = new World(11, undefined, undefined, LEGACY_REGION);
    expect(JSON.parse(JSON.stringify(w.story))).toEqual(w.story);
  });
});

describe('save compatibility', () => {
  it('writes the current version and loads v1 saves with a migrated story', () => {
    const w = World.generate(4242, 'Old Harbor', undefined, LEGACY_REGION);
    act(w, 'road', { x: 20, y: 30 }, { x: 40, y: 30 });
    const v2 = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    expect(v2.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(4); // megacity (docs/MEGACITY.md §3.10)

    const v1 = toV3(v2, 1);
    delete v1.story;
    const loaded = World.deserialize(v1);
    expect(loaded.tiles.filter((t) => t.road).length).toBe(w.tiles.filter((t) => t.road).length);
    expect(loaded.story.chapter).toBe(1);
    expect(loaded.story.flags.migrated).toBe(true);

    expect(() => World.deserialize({ ...v2, version: 5 })).toThrow();
  });

  it('keeps Stratablock stage fields through a round trip', () => {
    const w = new World(5, undefined, undefined, LEGACY_REGION);
    const b = w.addBuilding('stack', 10, 10)!;
    w.setStage(b, 2, 45);
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const lb = loaded.buildings.get(b.id)!;
    expect(lb.stage).toBe(2);
    expect(lb.buildDays).toBe(45);
    expect(lb.size).toBe(4);
  });
});

describe('world story mutators', () => {
  it('clearRail unhooks neighbours; clearTile removes rail', () => {
    const w = new World(1, undefined, undefined, LEGACY_REGION);
    w.setRail(10, 10, 2); // east
    w.setRail(11, 10, 8 | 2); // west + east
    w.setRail(12, 10, 8);
    w.clearRail(11, 10);
    expect(w.rail[w.idx(11, 10)]).toBe(0);
    expect(w.rail[w.idx(10, 10)]).toBe(0);
    expect(w.rail[w.idx(12, 10)]).toBe(0);
    w.setRail(5, 5, 1);
    w.setRoad(5, 5);
    w.clearTile(5, 5);
    expect(w.rail[w.idx(5, 5)]).toBe(0);
  });

  it('links get ids and drop with their anchors', () => {
    const w = new World(1, undefined, undefined, LEGACY_REGION);
    const a = w.addBuilding('spire', 10, 10)!;
    const l1 = w.addLink({ ax: 11, ay: 11, bx: 16, by: 11 });
    const l2 = w.addLink({ ax: 16, ay: 11, bx: 16, by: 16 });
    expect(l2.id).toBe(l1.id + 1);
    w.removeBuilding(a.id);
    expect(w.links.map((l) => l.id)).toEqual([l2.id]);
    expect(w.removeLinksAt(16, 16)).toBe(1);
    expect(w.links).toEqual([]);
  });

  it('addBuilding clears turf except under a Tidemarket or Kite Roost', () => {
    const w = new World(1, undefined, undefined, LEGACY_REGION);
    const i = w.idx(20, 20);
    const j = w.idx(30, 30);
    w.turf.owner[i] = 1;
    w.turf.str[i] = 60;
    w.turf.owner[j] = 1;
    w.turf.str[j] = 60;
    w.addBuilding('plaza', 20, 20);
    w.addBuilding('tidemarket', 30, 30);
    expect(w.turf.owner[i]).toBe(0);
    expect(w.turf.str[i]).toBe(0);
    expect(w.turf.owner[j]).toBe(1);
  });

  it('pushSignal stays bounded when nothing drains it', () => {
    const w = new World(1, undefined, undefined, LEGACY_REGION);
    for (let k = 0; k < 1000; k++) w.pushSignal({ t: 'milestone', pop: k });
    expect(w.signals.length).toBeLessThanOrEqual(256);
    expect(w.signals[w.signals.length - 1]).toEqual({ t: 'milestone', pop: 999 });
  });
});

describe('config', () => {
  it('appends the story buildings, all gated', () => {
    expect(BUILDING_ORDER.slice(-7)).toEqual(NEW_TYPES);
    expect(new Set(BUILDING_ORDER)).toEqual(new Set(Object.keys(BUILDINGS)));
    for (const t of NEW_TYPES) {
      expect(BUILDINGS[t].type).toBe(t);
      expect(BUILDINGS[t].gate).toBeDefined();
      expect(BUILDINGS[t].unlockPop).toBe(0);
    }
    expect(BUILDINGS.stack.size).toBe(4);
    expect(BUILDINGS.stack.category).toBe('vertical');
    expect(STACK_STAGES.map((s) => s.cost)).toEqual([12000, 16000, 22000]);
    expect(Object.keys(CROWNS).sort()).toEqual(['commons', 'foundry', 'glare', 'lamp', 'nest', 'salvage']); // + Megacity's Salvage and Lamp (§6.2)
    // ×10 units (MEGACITY §4.4).
    expect(UNLOCK_FALLBACK_POP).toMatchObject({ factions: 30000, comms: 30000, stack: 80000, crackdown: 60000, skybridge: 90000, crowns: 200_000 });
  });

  it('story buildings stay locked in the sandbox until their gate opens', () => {
    const w = new World(1, undefined, undefined, LEGACY_REGION);
    w.maxPopulation = 1e6;
    for (const t of ['foundry', 'glarewall', 'tidemarket', 'roost', 'commons', 'memorial'] as BuildingType[]) {
      expect(lockedReason(w, t)).toMatch(/Locked/);
    }
    expect(lockedReason(w, 'foundry')).toBe('Locked: Basalt Friendly');
    expect(lockedReason(w, 'stack')).toBeNull(); // pop fallback 80,000
    expect(lockedReason(w, 'skybridge')).toBeNull();
    w.maxPopulation = 1000;
    expect(lockedReason(w, 'stack')).toMatch(/80,000/);
    expect(lockedReason(w, 'rail')).toMatch(/90,000/);
    w.story.unlocks.push('stack', 'memorial');
    expect(lockedReason(w, 'stack')).toBeNull();
    expect(lockedReason(w, 'memorial')).toBeNull();
    expect(lockedReason(w, 'solar')).toBeNull();
  });
});

describe('buildingStats', () => {
  const stack = (stage: 1 | 2 | 3, buildDays: number, powered = true, crown?: Building['crown']): Building => ({
    id: 1,
    type: 'stack',
    x: 0,
    y: 0,
    size: 4,
    builtTick: 0,
    offline: 0,
    powered,
    stage,
    buildDays,
    crown,
  });

  it('matches BUILDINGS for ordinary types', () => {
    const b: Building = { id: 1, type: 'reactor', x: 0, y: 0, size: 3, builtTick: 0, offline: 0, powered: true };
    const s = buildingStats(b);
    expect(s).toMatchObject({ powerSupply: 1200, jobsInd: 400, jobsCom: 0, upkeep: 220, pollution: 0.5, tall: false });
    expect(buildingStats({ ...b, type: 'spire', size: 2 })).toMatchObject({ jobsCom: 8000, effect: 'prestige', radius: 16, tall: true });
    expect(buildingStats({ ...b, type: 'maglev', size: 2 }).station).toBe(true);
  });

  it('counts only complete, powered Stratablock stages', () => {
    expect(completeStage(stack(1, 60))).toBe(0);
    expect(buildingStats(stack(1, 60))).toMatchObject({ residents: 0, jobsCom: 0, powerUse: 0, upkeep: 0, tall: false, station: true });
    expect(buildingStats(stack(1, 0))).toMatchObject({ jobsCom: 3000, jobsInd: 1000, powerUse: 40, upkeep: 120, tall: false });
    expect(buildingStats(stack(1, 0, false))).toMatchObject({ jobsCom: 0, powerUse: 40, upkeep: 0 });
    expect(buildingStats(stack(2, 30))).toMatchObject({ residents: 0, jobsCom: 3000, tall: false });
    const s2 = buildingStats(stack(2, 0));
    // The Hab Core with the density premium (MEGACITY §4.2): 32,000 residents, power 150, upkeep 260.
    expect(s2).toMatchObject({ residents: 32000, jobsCom: 3000, jobsInd: 1000, powerUse: 190, upkeep: 380, tall: true });
    // Internal life: 60 % of matched residents work inside (trips per head ÷ 10 with the ×10 units).
    expect(s2.trips).toBeCloseTo((32000 + 4000 - 2 * 0.6 * 4000) * 0.05, 6);
    const s3 = buildingStats(stack(3, 0, true, 'commons'));
    expect(s3).toMatchObject({ residents: 48000, jobsCom: 6000, effect: 'prestige', radius: 10, powerUse: 270, upkeep: 600 });
    expect(buildingStats(stack(3, 0, true, 'foundry'))).toMatchObject({ jobsInd: 3500, pollution: 0.15 });
  });

  it('reuses an out object', () => {
    const out = buildingStats(stack(1, 0));
    const again = buildingStats(stack(2, 0), out);
    expect(again).toBe(out);
    expect(out.residents).toBe(32000);
  });
});

describe('game story stubs', () => {
  it('the game runs with an inert director', () => {
    const g = new Game();
    expect(g.story.blocking).toBe(false);
    const v = g.story.view();
    // WP-A: the real view replaces the Step 0 empty one; with no roads nothing has started yet.
    const empty = emptyStoryView(g.world.story);
    expect(v.chapter.phase).toBe(empty.chapter.phase);
    expect(v.card).toBeNull();
    expect(v.pending).toBeNull();
    expect(v.goals).toEqual([]);
    expect(v.chapter.numeral).toBe('I');
    expect(v.coherence).toBe(4);
    // (74, 74) is in the start slot of the 3×3 region: a locked tile would offer 'Open City map' (MEGACITY §3.4).
    expect(g.inspectActions(74, 74)).toEqual([]);
    expect(g.takeDeal('basalt').ok).toBe(false);
    g.world.pushSignal({ t: 'milestone', pop: 100 });
    for (let k = 0; k < 40; k++) g.update(0.25);
    expect(g.world.tick).toBeGreaterThan(0);
    expect(g.world.signals.length).toBe(0);
    expect(g.speed).toBe(1);
    expect(g.toolCost('reactor')).toBe(BUILDINGS.reactor.cost);
    g.setTax(25);
    expect(g.world.taxRate).toBe(20);
  });

  it('caps city names at 24 characters and replaces the director on a new city', () => {
    const g = new Game();
    const first = g.story;
    g.newCity('A Very Long City Name That Keeps Going');
    expect(g.world.cityName.length).toBeLessThanOrEqual(CITY_NAME_MAX);
    expect(g.story).not.toBe(first);
    for (let seed = 0; seed < 4000; seed += 37) expect(randomCityName(seed).length).toBeLessThanOrEqual(CITY_NAME_MAX);
  });

  it('the sim still runs headless with story fields present', () => {
    const w = World.generate(9, 'Quiet Grid', undefined, LEGACY_REGION);
    const sim = makeSim(w);
    for (let k = 0; k < 60; k++) sim.step();
    expect(Number.isFinite(w.stats.approval)).toBe(true);
  });
});

describe('IP guardrails on sandbox strings (§1.4, §1.6)', () => {
  const BANNED =
    /\b(fixers?|netrunners?|ripperdocs?|cyberware|wetware|cyberspace|jack(ed)? in|eddies|choom|preem|gonk|flatlined?|sprawl|night city|afterlife|replicants?|tyrell|wintermute|section 9|arasaka|militech|kowloon|vantablack|hyperstack|glass jackals?)\b/i;
  it('config, news and city names are clean', () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk([BUILDINGS, ZONES, MILESTONES, CORPS, CREWS, DISTRICTS, HEADLINES, EVENT_COPY]);
    for (let seed = 0; seed < 4000; seed += 13) strings.push(randomCityName(seed));
    const hits = strings.filter((s) => BANNED.test(s));
    expect(hits).toEqual([]);
    expect(MILESTONES.map((m) => m.title)).toContain('Neon Metro');
    expect(MILESTONES.map((m) => m.title)).toContain('Thousand Lamps');
    expect(CREWS).toContain('the Undertow');
    expect(CREWS).toContain('the Glass Kites');
  });
});
