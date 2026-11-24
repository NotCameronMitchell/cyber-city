// Expansion Step 0 contract (docs/EXPANSION.md §2, §10.2 #7, #9): config rows,
// building order, World mutator invariants, the wealth / ports / skyway helpers,
// buildingStats, the sim stubs, Game.clockRate, story vocab and openOnDemand.

import { afterAll, describe, expect, it } from 'vitest';
import { buildingStats } from '../src/game/buildingStats';
import {
  BRIDGE_COST,
  BRIDGE_UPKEEP,
  BUILDINGS,
  BUILDING_ORDER,
  BUILD_REACTION_LIMIT_BY_TYPE,
  FACTION_BUILD_REACTIONS,
  MILESTONES,
  POWER_WEIGHTS,
  ROAD_COST,
  ROAD_KINDS,
  ROAD_UPKEEP,
  SAFETY,
  SKYWAY,
  SPACEPORT,
  TURF,
  WEALTH,
  ZONES,
} from '../src/game/config';
import type { GameEventMap } from '../src/game/events';
import { Game, type TileInfo } from '../src/game/game';
import { berthTiles, isBerthTile, noiseDef, noiseReach, shoreFacing, shoreSites } from '../src/game/ports';
import { Rng } from '../src/game/rng';
import { Simulation } from '../src/game/sim';
import { isSkyAnchorAt, planSkyway, skyLinksBack, skyRampActive, skyRampGround, skywayDocks } from '../src/game/skyway';
import { isMetric, metric, storyContent, useStoryContent } from '../src/game/story/conditions';
import { STORY_CONTENT } from '../src/game/story/content';
import { METRIC_LIST, SPOT_RULES } from '../src/game/story/content/vocab';
import type { Card, InspectAction, Metric } from '../src/game/story/types';
import { MAP_SIZE, RoadKind, Terrain, ZoneType, type ActionPlan, type Building, type BuildingType, type WealthTier } from '../src/game/types';
import {
  TIER_LABEL,
  potentialTier,
  stepTarget,
  tierCap,
  wealthInfo,
  wealthScoreAt,
  wealthTerms,
  zoneCapacity,
  zonePollution,
  zonePowerMul,
  zoneTaxMul,
} from '../src/game/wealth';
import { World } from '../src/game/world';
import { headlessGame } from './story/harness';

const N = MAP_SIZE;
const { Street: S, Avenue: A, Highway: H, Alley: L, Ramp: R } = RoadKind;
const NEW_TYPES: BuildingType[] = ['academy', 'seaport', 'airport', 'spaceport'];
const STORY_TYPES: BuildingType[] = ['stack', 'foundry', 'glarewall', 'tidemarket', 'roost', 'commons', 'memorial'];

describe('config (§2.8, §10.2 #9)', () => {
  it('ROAD_KINDS is indexed by kind; the old constants are its Street row', () => {
    ROAD_KINDS.forEach((d, k) => expect(d.kind).toBe(k));
    const st = ROAD_KINDS[S];
    expect([st.cost, st.bridgeCost, st.upkeep, st.bridgeUpkeep]).toEqual([ROAD_COST, BRIDGE_COST, ROAD_UPKEEP, BRIDGE_UPKEEP]);
    expect(ROAD_KINDS.map((d) => d.tool)).toEqual(['road', 'avenue', 'highway', 'alley', null]);
    expect(ROAD_KINDS[L].bridgeCost).toBeNull();
    expect(ROAD_KINDS[R].bridgeCost).toBeNull();
    // Unlocks: Back Alley with the Undertow, the rest on population milestones.
    const pops = new Set(MILESTONES.map((m) => m.pop));
    expect(ROAD_KINDS[L].unlockPop).toBe(TURF.seedPop.undertow);
    for (const k of [A, H, R]) expect(pops.has(ROAD_KINDS[k].unlockPop)).toBe(true);
    expect(pops.has(SKYWAY.unlockPop)).toBe(true);
  });

  it('inserts the new buildings before the Stratablock; the story types stay last', () => {
    const k = BUILDING_ORDER.indexOf('stack');
    expect(BUILDING_ORDER.slice(k - 5, k)).toEqual(['arcology', ...NEW_TYPES]);
    expect(BUILDING_ORDER.slice(-7)).toEqual(STORY_TYPES);
    expect(new Set(BUILDING_ORDER)).toEqual(new Set(Object.keys(BUILDINGS)));
    expect(BUILDING_ORDER.length).toBe(Object.keys(BUILDINGS).length);
  });

  it('defines the new buildings as specified (§2.8 table)', () => {
    const row = (t: BuildingType) => {
      const d = BUILDINGS[t];
      return [d.category, d.size, d.cost, d.upkeep, d.powerUse, d.effect ?? null, d.radius, d.jobs, d.jobsInd, d.pollution, d.noise ?? null, d.unlockPop, d.meta];
    };
    // Head counts in ×10 units (MEGACITY §4.4).
    expect(row('academy')).toEqual(['services', 2, 3200, 140, 8, 'education', 12, 300, 0, 0, null, 15000, '2×2 · schools']);
    expect(row('seaport')).toEqual(['transport', 4, 18000, 280, 30, null, 0, 2400, 2400, 0.3, { v: 0.5, r: 6 }, 50000, '4×4 · shore only']);
    expect(row('airport')).toEqual(['transport', 6, 45000, 650, 80, null, 0, 3200, 0, 0.15, { v: 0.9, r: 10 }, 120000, '6×6 · loud']);
    expect(row('spaceport')).toEqual(['transport', 6, 150000, 1800, 300, 'prestige', 20, 5500, 2500, 0.2, { v: 0.5, r: 8 }, 300000, '6×6 · slow build']);
    expect(BUILDINGS.academy.plural).toBe('Academies');
    expect([BUILDINGS.seaport.site, BUILDINGS.seaport.maxCount, BUILDINGS.airport.maxCount, BUILDINGS.spaceport.maxCount]).toEqual(['shore', 2, 1, 1]);
    expect(BUILDINGS.spaceport.buildDays).toBe(240);
    for (const t of ['seaport', 'airport', 'spaceport', 'stack'] as BuildingType[]) expect(BUILDINGS[t].needsRoad).toBe(true);
    const anchors = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => BUILDINGS[t].skyAnchor).sort();
    expect(anchors).toEqual(['airport', 'arcology', 'spire', 'stack']);
    const pops = new Set(MILESTONES.map((m) => m.pop));
    for (const t of NEW_TYPES) {
      expect(BUILDINGS[t].type).toBe(t);
      expect(pops.has(BUILDINGS[t].unlockPop)).toBe(true);
      expect(BUILDINGS[t].desc.length).toBeLessThanOrEqual(90);
      expect(BUILDINGS[t].gate).toBeUndefined();
    }
    // Every port costs more than the confirm threshold (§5.4).
    for (const t of ['seaport', 'airport', 'spaceport'] as BuildingType[]) expect(BUILDINGS[t].cost).toBeGreaterThanOrEqual(SAFETY.confirmCost);
  });

  it('keeps every tray meta line within 22 characters', () => {
    const metas = [...ROAD_KINDS.map((d) => d.meta), SKYWAY.meta, ...Object.values(BUILDINGS).map((d) => d.meta ?? '')];
    for (const m of metas) expect(m.length, m).toBeLessThanOrEqual(22);
  });

  it('adds the story-facing rows (§2.8)', () => {
    expect(FACTION_BUILD_REACTIONS.academy).toEqual({ board: 2, tuning: 2 });
    expect(FACTION_BUILD_REACTIONS.seaport).toEqual({ basalt: 4, undertow: 3 });
    expect(FACTION_BUILD_REACTIONS.airport).toEqual({ nacre: 5, board: 2, kites: -3 });
    expect(FACTION_BUILD_REACTIONS.spaceport).toEqual({ nacre: 4, basalt: 4, board: 3, kites: 2, tuning: -2 });
    expect(BUILD_REACTION_LIMIT_BY_TYPE).toMatchObject({ memorial: 1, seaport: 2, airport: 1, spaceport: 1 });
    expect(POWER_WEIGHTS.board.launchRights).toBe(150);
    expect([POWER_WEIGHTS.basalt.perSeaport, POWER_WEIGHTS.basalt.launchRights]).toEqual([60, 150]);
    expect([POWER_WEIGHTS.nacre.perAirport, POWER_WEIGHTS.nacre.launchRights]).toEqual([80, 150]);
    expect([POWER_WEIGHTS.undertow.perAlley, POWER_WEIGHTS.undertow.alleyMax]).toEqual([0.25, 60]);
    expect([POWER_WEIGHTS.kites.perSkywayTile, POWER_WEIGHTS.kites.skywayMax, POWER_WEIGHTS.kites.launchRights]).toEqual([0.5, 100, 150]);
    expect(TURF.affinity.undertow).toMatchObject({ alleyNear: 0.2, alleyRadius: 1, seaportNear: 0.2, seaportRadius: 6 });
    expect(TURF.affinity.kites).toMatchObject({ alleyNear: 0.1, alleyRadius: 1, skywayNear: 0.15, skywayRadius: 1 });
  });
});

// ── World mutators (§2.1, §2.4, §10.2 #7) ────────────────────────────────────

function invariants(w: World): string[] {
  const bad: string[] = [];
  w.tiles.forEach((t, i) => {
    if (!t.road && t.roadKind !== S) bad.push(`${i}: roadKind ${t.roadKind} without a road`);
    if ((t.zone === ZoneType.None || t.level === 0) && t.wealth !== 0) bad.push(`${i}: wealth ${t.wealth} on a lot`);
    if (t.terrain === Terrain.Water && (t.roadKind === L || t.roadKind === R)) bad.push(`${i}: alley/ramp on water`);
    if (!(t.roadKind >= 0 && t.roadKind <= 4) || !(t.wealth >= 0 && t.wealth <= 2)) bad.push(`${i}: out of range`);
    if (t.road && (t.zone !== ZoneType.None || t.buildingId >= 0)) bad.push(`${i}: road with zone or building`);
    if (w.sky[i] > 31) bad.push(`${i}: sky ${w.sky[i]}`);
  });
  return bad;
}

describe('World mutators keep the invariants (§10.2 #7)', () => {
  it('random sequences of every mutator', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const w = new World(seed);
      for (let y = 20; y < 26; y++) for (let x = 0; x < N; x++) w.tiles[y * N + x].terrain = Terrain.Water;
      const rng = new Rng(seed * 31);
      const at = () => ({ x: rng.int(0, 40), y: rng.int(15, 30) });
      const kinds = [S, A, H, L, R];
      const ids = () => [...w.buildings.keys()];
      const ops: (() => void)[] = [
        () => {
          const p = at();
          w.setRoad(p.x, p.y, rng.pick(kinds));
        },
        () => {
          const p = at();
          w.setRoad(p.x, p.y);
        },
        () => {
          const p = at();
          w.setRoadKind(p.x, p.y, rng.pick(kinds));
        },
        () => {
          const p = at();
          w.setZone(p.x, p.y, rng.int(1, 3) as ZoneType);
        },
        () => {
          const p = at();
          w.setLevel(p.x, p.y, rng.int(0, 3), rng.chance(0.2), rng.chance(0.5) ? (rng.int(0, 2) as WealthTier) : undefined);
        },
        () => {
          const p = at();
          w.setWealth(p.x, p.y, rng.int(0, 2) as WealthTier);
        },
        () => {
          const p = at();
          w.clearTile(p.x, p.y, rng.chance(0.5));
        },
        () => {
          const p = at();
          w.addBuilding(rng.pick(['plaza', 'precinct', 'seaport', 'academy'] as BuildingType[]), p.x, p.y);
        },
        () => {
          const list = ids();
          if (list.length) w.removeBuilding(rng.pick(list));
        },
        () => {
          const p = at();
          w.restoreTile(w.idx(p.x, p.y), { i: w.idx(p.x, p.y), road: rng.chance(0.5), roadKind: rng.pick(kinds), zone: rng.int(0, 3) as ZoneType, level: rng.int(0, 3), sky: rng.int(0, 40) });
        },
        () => {
          const p = at();
          w.setSky(p.x, p.y, rng.int(0, 40));
        },
        () => {
          const p = at();
          w.clearSky(p.x, p.y);
        },
      ];
      for (let k = 0; k < 1500; k++) {
        rng.pick(ops)();
        const bad = invariants(w);
        if (bad.length) throw new Error(`seed ${seed} step ${k}: ${bad.slice(0, 3).join('; ')}`);
      }
    }
  });

  it('setRoad(x, y) still lays a Street; Alley and Ramp on water are written as Street', () => {
    const w = new World(1);
    w.tiles[w.idx(5, 6)].terrain = Terrain.Water;
    w.setRoad(5, 5);
    expect(w.tileAt(5, 5)!.roadKind).toBe(S);
    w.setRoad(5, 6, L);
    expect(w.tileAt(5, 6)!.roadKind).toBe(S);
    w.setRoadKind(5, 6, R);
    expect(w.tileAt(5, 6)!.roadKind).toBe(S);
    w.setRoadKind(5, 6, H);
    expect(w.tileAt(5, 6)!.roadKind).toBe(H);
    w.setRoadKind(9, 9, A); // not a road: no-op
    expect(w.tileAt(9, 9)!.road).toBe(false);
    expect(w.tileAt(9, 9)!.roadKind).toBe(S);
  });

  it('setRoadKind keeps variant and age; setWealth emits no tiles event', () => {
    const w = new World(2);
    w.setRoad(3, 3);
    const t = w.tileAt(3, 3)!;
    t.age = 500;
    const v = t.variant;
    const rects: unknown[] = [];
    w.events.on('tiles', (r) => rects.push(r));
    w.setRoadKind(3, 3, A);
    expect([t.roadKind, t.variant, t.age]).toEqual([A, v, 500]);
    expect(rects.length).toBe(1);
    w.setZone(4, 4, ZoneType.Residential);
    w.setLevel(4, 4, 2, false, 1);
    const z = w.tileAt(4, 4)!;
    expect(z.wealth).toBe(1);
    z.age = 300;
    const zv = z.variant;
    const n = rects.length;
    const version = w.version;
    w.setWealth(4, 4, 2);
    expect([z.wealth, z.variant, z.age, rects.length, w.version]).toEqual([2, zv, 300, n, version]);
    // Abandonment keeps the tier; collapse to a lot resets it; a lot can't hold one.
    w.setLevel(4, 4, 2, true);
    expect(z.wealth).toBe(2);
    w.setLevel(4, 4, 0);
    expect(z.wealth).toBe(0);
    w.setWealth(4, 4, 2);
    expect(z.wealth).toBe(0);
    // setLevel with an unchanged level only moves the tier.
    w.setLevel(4, 4, 1);
    w.setLevel(4, 4, 1, false, 2);
    expect(z.wealth).toBe(2);
    // setZone and addBuilding reset it.
    w.setZone(4, 4, ZoneType.Commercial);
    expect(z.wealth).toBe(0);
  });

  it('sky: setSky / clearSky bump skyVersion; clearSky unhooks neighbours; ground clears keep decks', () => {
    const w = new World(3);
    const v0 = w.skyVersion;
    w.setSky(10, 10, 2 | 16); // ramp, east
    w.setSky(11, 10, 8 | 2);
    w.setSky(12, 10, 8 | 4);
    w.setSky(12, 11, 1);
    expect(w.skyVersion).toBe(v0 + 4);
    w.clearSky(11, 10);
    expect(w.sky[w.idx(11, 10)]).toBe(0);
    expect(w.sky[w.idx(10, 10)]).toBe(0); // a ramp left with no link goes
    expect(w.sky[w.idx(12, 10)]).toBe(4);
    expect(w.skyVersion).toBe(v0 + 5);
    // A ground clear (bulldoze) and removeBuilding leave the deck; clearTile(…, true) takes it.
    w.setRoad(12, 10);
    w.clearTile(12, 10);
    expect(w.sky[w.idx(12, 10)]).toBe(4);
    const b = w.addBuilding('stack', 12, 11)!;
    w.removeBuilding(b.id);
    expect(w.sky[w.idx(12, 11)]).toBe(1);
    w.clearTile(12, 10, true);
    expect(w.sky[w.idx(12, 10)]).toBe(0);
    expect(w.sky[w.idx(12, 11)]).toBe(0);
  });

  it('restoreTile writes a snapshot back', () => {
    const w = new World(4);
    const i = w.idx(7, 7);
    w.setZone(7, 7, ZoneType.Industrial);
    w.restoreTile(i, { i, road: true, roadKind: A, zone: ZoneType.None, level: 0, sky: 2 | 16 });
    const t = w.tiles[i];
    expect([t.road, t.roadKind, t.zone, t.level, w.sky[i]]).toEqual([true, A, ZoneType.None, 0, 18]);
    w.restoreTile(i, { i, road: false, roadKind: H, zone: ZoneType.Residential, level: 0, sky: 0 });
    expect([t.road, t.roadKind, t.zone, w.sky[i]]).toEqual([false, S, ZoneType.Residential, 0]);
  });
});

// ── Wealth helpers (§4) ─────────────────────────────────────────────────────

describe('wealth helpers (§4)', () => {
  it('tier tables: tier 0 equals the old capacity, pollution and multipliers of 1', () => {
    for (const zd of Object.values(ZONES))
      for (let l = 0; l <= 3; l++) {
        expect(zoneCapacity(zd.zone, l, 0)).toBe(zd.capacity[l]);
        expect(zonePollution(zd.zone, l, 0)).toBe(zd.pollution[l]);
        expect(zoneTaxMul(zd.zone, 0)).toBe(1);
        expect(zonePowerMul(zd.zone, 0)).toBe(1);
      }
    expect(zoneCapacity(ZoneType.Residential, 3, 2)).toBe(1350);
    expect(zoneCapacity(ZoneType.Residential, 3, 0, true)).toBe(1650);
    expect(zoneCapacity(ZoneType.Residential, 3, 1, true)).toBe(Math.round(150 * 0.95) * 10); // affordable only at $; whole tens (×10 units)
    expect(zoneCapacity(ZoneType.Commercial, 3, 0, true)).toBe(900);
    expect(zoneTaxMul(ZoneType.Industrial, 2)).toBe(1.8);
    expect(zonePowerMul(ZoneType.Industrial, 2)).toBe(0.9);
    expect(zonePollution(ZoneType.Industrial, 3, 2)).toBeCloseTo(0.85 * 0.35, 6);
    expect(zoneCapacity(ZoneType.None, 2, 1)).toBe(0);
    expect(TIER_LABEL).toEqual(['$', '$$', '$$$']);
  });

  it('caps, potential and the hysteresis band', () => {
    const c = WEALTH.caps;
    expect(tierCap(ZoneType.Residential, 0, 0, 0, false)).toBe(2);
    expect(tierCap(ZoneType.Residential, c.highMaxCrime, 0, 0, false)).toBe(1);
    expect(tierCap(ZoneType.Commercial, 0, c.highMaxNoise, 0, false)).toBe(1);
    expect(tierCap(ZoneType.Commercial, 0, 0, c.highMaxPollution, false)).toBe(1);
    expect(tierCap(ZoneType.Residential, c.midMaxCrime, 0, 0, false)).toBe(0);
    expect(tierCap(ZoneType.Residential, 0, 0, 0, true)).toBe(1);
    expect(tierCap(ZoneType.Commercial, 0, 0, 0, true)).toBe(2); // alleys cap homes only
    expect(tierCap(ZoneType.Industrial, 0.9, 0.9, 0.9, true)).toBe(1);
    expect(tierCap(ZoneType.Industrial, 0, 0, 0, false)).toBe(2);
    expect(potentialTier(ZoneType.Residential, 0.5, 2)).toBe(2);
    expect(potentialTier(ZoneType.Residential, 0.5, 1)).toBe(1);
    expect(potentialTier(ZoneType.Residential, 0.32, 2)).toBe(1);
    expect(potentialTier(ZoneType.Residential, 0.31, 2)).toBe(0);
    expect(potentialTier(ZoneType.None, 0.9, 2)).toBe(0);
    // Up at 0.32 / 0.46, down below 0.27 / 0.40: inside the band nothing moves.
    expect(stepTarget(ZoneType.Residential, 0, 0.32, 2)).toBe(1);
    expect(stepTarget(ZoneType.Residential, 0, 0.32, 0)).toBe(0);
    expect(stepTarget(ZoneType.Residential, 1, 0.3, 2)).toBe(0);
    expect(stepTarget(ZoneType.Residential, 1, 0.26, 2)).toBe(-1);
    expect(stepTarget(ZoneType.Residential, 2, 0.41, 2)).toBe(0);
    expect(stepTarget(ZoneType.Residential, 2, 0.39, 2)).toBe(-1);
    expect(stepTarget(ZoneType.Residential, 2, 0.9, 1)).toBe(-1); // the cap pulls it down
    expect(stepTarget(ZoneType.Residential, 1, 0.5, 2)).toBe(1);
  });

  it('the score reads only world.fields and the tile; its parts sum to it', () => {
    const w = new World(5);
    const f = w.fields;
    const put = (x: number, y: number, zone: ZoneType) => {
      w.setZone(x, y, zone);
      w.setLevel(x, y, 1);
      return w.idx(x, y);
    };
    const r = put(10, 10, ZoneType.Residential);
    f.landValue[r] = 0.3;
    f.education[r] = 0.5;
    f.transit[r] = 1;
    f.noise[r] = 0.1;
    expect(wealthScoreAt(w, r)).toBeCloseTo(0.3 + 0.05 + 0.06 - 0.02, 6);
    const t = wealthTerms(w, r);
    const sum = t.base + t.landValue + t.education + t.transit + t.hub + t.sea + t.net + t.noise + t.crime;
    expect(sum).toBeCloseTo(wealthScoreAt(w, r), 6);
    expect(t.noise).toBeCloseTo(-0.38 * 0.1, 6);
    const c = put(11, 10, ZoneType.Commercial);
    f.landValue[c] = 0.3;
    f.hub[c] = 1;
    expect(wealthScoreAt(w, c)).toBeCloseTo(0.42, 6);
    const ind = put(12, 10, ZoneType.Industrial);
    f.landValue[ind] = 0.9; // ignored
    f.education[ind] = 1;
    f.crime[ind] = 0.5;
    // Base, education and crime weights come from config (Step 7 tunes the base, §10.5).
    expect(wealthScoreAt(w, ind)).toBeCloseTo(WEALTH.score.ind.base + WEALTH.score.ind.edu + 0.5 * WEALTH.score.ind.crime, 6);
    expect(wealthScoreAt(w, w.idx(30, 30))).toBe(0);
    f.landValue[r] = 5;
    expect(wealthScoreAt(w, r)).toBe(1);
  });

  it('wealthInfo: tier, potential, trend, notes', () => {
    const w = new World(6);
    const f = w.fields;
    w.setZone(10, 10, ZoneType.Residential);
    w.setLevel(10, 10, 2, false, 1);
    const i = w.idx(10, 10);
    f.landValue[i] = 0.5;
    f.education[i] = 1;
    w.wealthStreak[i] = 3;
    let info = wealthInfo(w, 10, 10);
    expect(info).toMatchObject({ tier: 1, potential: 2, lot: false, dir: 1, affordable: false, next: 'Rising: steps up soon', lifted: 'Academy +10%' });
    expect(info.score).toBeCloseTo(0.6, 6);
    expect(info.ticks).toEqual([0.32, 0.46]);
    // An alley beside it caps it at $$ and says so.
    f.alleyNear[i] = 1;
    info = wealthInfo(w, 10, 10);
    expect(info.potential).toBe(1);
    expect(info.next).toBe('Beside an alley: rents stay low');
    // At $$$ there is no Next.
    f.alleyNear[i] = 0;
    w.setWealth(10, 10, 2);
    expect(wealthInfo(w, 10, 10).next).toBeNull();
    // A noisy $ block names the noise.
    w.setZone(20, 20, ZoneType.Residential);
    w.setLevel(20, 20, 1);
    const j = w.idx(20, 20);
    f.landValue[j] = 0.2;
    f.noise[j] = 0.4;
    w.wealthStreak[j] = -2;
    info = wealthInfo(w, 20, 20);
    expect(info.dir).toBe(-1);
    expect(info.next).toBe('Noise −15%: keep homes back');
    // An affordable lot.
    w.setZone(30, 30, ZoneType.Residential);
    f.alleyNear[w.idx(30, 30)] = 1;
    info = wealthInfo(w, 30, 30);
    expect([info.lot, info.affordable, info.tier]).toEqual([true, true, 0]);
    // Non-zone tiles read zero.
    expect(wealthInfo(w, 40, 40)).toMatchObject({ tier: 0, score: 0, next: null, lifted: null });
    for (const z of [ZoneType.Residential, ZoneType.Commercial, ZoneType.Industrial]) {
      w.setZone(50, 50, z);
      w.setLevel(50, 50, 1);
      for (const lv of [0, 0.2, 0.35]) {
        f.landValue[w.idx(50, 50)] = lv;
        const n = wealthInfo(w, 50, 50);
        expect((n.next ?? '').length).toBeLessThanOrEqual(40);
        expect((n.lifted ?? '').length).toBeLessThanOrEqual(24);
      }
    }
  });
});

// ── Ports (§5) ──────────────────────────────────────────────────────────────

describe('port helpers (§5.1, §5.4)', () => {
  /** Water below y = 40 and right of x = 50. */
  function shore(): World {
    const w = new World(7);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (y >= 40 || x >= 50) w.tiles[y * N + x].terrain = Terrain.Water;
    return w;
  }

  it('shoreFacing tests S, E, N, W; bridges and rail block a berth', () => {
    const w = shore();
    expect(shoreFacing(w, 10, 36, 4)).toBe(2); // bottom row y = 39; y = 40, 41 water
    expect(shoreFacing(w, 46, 10, 4)).toBe(1); // east column x = 49; x = 50, 51 water
    expect(shoreFacing(w, 46, 36, 4)).toBe(2); // both qualify: S first
    expect(shoreFacing(w, 10, 10, 4)).toBe(-1);
    expect(shoreFacing(w, 10, 35, 4)).toBe(-1); // bottom row y = 38: y = 39 beyond it is land
    w.setRoad(12, 41); // a bridge in the berth
    expect(shoreFacing(w, 10, 36, 4)).toBe(-1);
    const v = shore();
    v.setRail(11, 40, 2);
    expect(shoreFacing(v, 10, 36, 4)).toBe(-1);
    // North and west shores.
    const u = new World(8);
    for (let x = 0; x < N; x++) for (let y = 0; y < 5; y++) u.tiles[y * N + x].terrain = Terrain.Water;
    expect(shoreFacing(u, 20, 5, 4)).toBe(0);
    const s = new World(9);
    for (let y = 0; y < N; y++) for (let x = 0; x < 5; x++) s.tiles[y * N + x].terrain = Terrain.Water;
    expect(shoreFacing(s, 5, 20, 4)).toBe(3);
  });

  it('berths, berth tiles and shore sites', () => {
    const w = shore();
    const b = w.addBuilding('seaport', 10, 36)!;
    b.facing = 2;
    const berth = berthTiles(b);
    expect(berth.length).toBe(8);
    expect(berth).toContain(w.idx(10, 40));
    expect(berth).toContain(w.idx(13, 41));
    expect(isBerthTile(w, 12, 41)).toBe(true);
    expect(isBerthTile(w, 12, 42)).toBe(false);
    expect(isBerthTile(w, 14, 40)).toBe(false);
    expect(berthTiles({ ...b, type: 'plaza' } as Building)).toEqual([]);
    const marks = new Uint8Array(N * N);
    const n = shoreSites(w, marks);
    expect(n).toBeGreaterThan(10);
    expect(marks[w.idx(10, 36)]).toBe(0); // occupied now
    expect(marks[w.idx(20, 36)]).toBe(1);
    expect(marks[w.idx(20, 20)]).toBe(0);
    expect(marks.reduce((a, v) => a + v, 0)).toBe(n);
  });

  it('every sampled generated map has at least 2 non-overlapping shore sites', () => {
    const marks = new Uint8Array(N * N);
    for (let seed = 1; seed <= 30; seed++) {
      const w = World.generate(seed * 7919);
      expect(shoreSites(w, marks), `seed ${seed}`).toBeGreaterThan(0);
      // Greedy non-overlapping pick.
      const taken: { x: number; y: number }[] = [];
      for (let i = 0; i < N * N; i++) {
        if (!marks[i]) continue;
        const x = i % N;
        const y = (i / N) | 0;
        if (taken.every((t) => Math.abs(t.x - x) >= 4 || Math.abs(t.y - y) >= 4)) taken.push({ x, y });
      }
      expect(taken.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('noiseReach lists developed Hab Blocks inside the Chebyshev reach', () => {
    const w = new World(10);
    expect(noiseDef('airport')).toEqual({ v: 0.9, r: 10 });
    expect(noiseDef('plaza')).toBeNull();
    for (const [x, y, z, l] of [
      [5, 20, ZoneType.Residential, 1],
      [4, 20, ZoneType.Residential, 1],
      [8, 20, ZoneType.Commercial, 1],
      [7, 20, ZoneType.Residential, 0],
    ] as const) {
      w.setZone(x, y, z);
      w.setLevel(x, y, l);
    }
    const out: number[] = [];
    // Airport at (16, 15): footprint 16..21; reach 10 covers x ≥ 6.
    expect(noiseReach(w, 'airport', 16, 15, out)).toBe(0);
    w.setZone(6, 20, ZoneType.Residential);
    w.setLevel(6, 20, 2);
    expect(noiseReach(w, 'airport', 16, 15, out)).toBe(1);
    expect(out).toEqual([w.idx(6, 20)]);
    expect(noiseReach(w, 'plaza', 16, 15, out)).toBe(0);
  });
});

// ── Skyways (§3.7) ──────────────────────────────────────────────────────────

describe('skyway helpers (§3.7)', () => {
  it('ramps are active only over a Street, Avenue or Ramp; links back are mutual', () => {
    const w = new World(11);
    w.setRoad(10, 10);
    w.setSky(10, 10, 2 | 16);
    w.setSky(11, 10, 8);
    const i = w.idx(10, 10);
    expect(skyRampActive(w, i)).toBe(true);
    w.setRoadKind(10, 10, H);
    expect(skyRampActive(w, i)).toBe(false);
    w.setRoadKind(10, 10, R);
    expect(skyRampActive(w, i)).toBe(true);
    w.setRoadKind(10, 10, L);
    expect(skyRampActive(w, i)).toBe(false);
    expect(skyRampGround({ road: true, roadKind: A })).toBe(true);
    expect(skyRampGround({ road: false, roadKind: S })).toBe(false);
    expect(skyLinksBack(w.sky, i, 2)).toBe(true);
    expect(skyLinksBack(w.sky, i, 4)).toBe(false);
    expect(skyLinksBack(w.sky, w.idx(63, 5), 2)).toBe(false); // off the map
  });

  it('skywayDocks: a BFS over mutual links from an anchor footprint', () => {
    const w = new World(12);
    const stack = w.addBuilding('stack', 20, 20)!; // 20..23
    const plaza = w.addBuilding('plaza', 30, 30)!;
    expect(isSkyAnchorAt(w, 21, 21)).toBe(true);
    expect(isSkyAnchorAt(w, 30, 30)).toBe(false);
    expect(skywayDocks(w, stack)).toEqual({ docked: false, ramps: 0 });
    // A deck from (21,22) east to a ramp on a street at (26,22).
    w.setRoad(26, 22);
    w.setSky(21, 22, 2);
    for (let x = 22; x <= 25; x++) w.setSky(x, 22, 8 | 2);
    w.setSky(26, 22, 8 | 16);
    expect(skywayDocks(w, stack)).toEqual({ docked: true, ramps: 1 });
    // An inactive ramp doesn't count; a one-sided link doesn't join.
    w.setRoadKind(26, 22, H);
    expect(skywayDocks(w, stack)).toEqual({ docked: true, ramps: 0 });
    w.setRoadKind(26, 22, S);
    w.setSky(25, 22, 8); // (25) no longer links east: (26) is cut off
    expect(skywayDocks(w, stack)).toEqual({ docked: true, ramps: 0 });
    // Non-anchors never dock.
    w.setSky(30, 30, 2);
    w.setSky(31, 30, 8);
    expect(skywayDocks(w, plaza)).toEqual({ docked: false, ramps: 0 });
  });

  it('planSkyway fills the plan (the Step 0 stub, filled by WP-2; rules in tests/actions-roads.test.ts)', () => {
    const w = new World(13);
    const plan: ActionPlan = { tool: 'skyway', tiles: [], cost: 0, valid: false };
    expect(planSkyway(w, [{ x: 1, y: 1 }, { x: 2, y: 1 }], plan)).toBe(2);
    expect(plan.skyMasks).toEqual([2, 8]);
    expect(plan.tiles.every((t) => t.ok)).toBe(true);
    expect(plan.note).toBe('Lands nowhere');
  });
});

// ── buildingStats, sim stubs, Game ──────────────────────────────────────────

describe('buildingStats (§2.8, §5.3)', () => {
  const b = (type: BuildingType, extra: Partial<Building> = {}): Building => ({
    id: 1,
    type,
    x: 0,
    y: 0,
    size: BUILDINGS[type].size,
    builtTick: 0,
    offline: 0,
    powered: true,
    ...extra,
  });

  it('splits jobs by jobsInd (all Fab for power plants by default)', () => {
    expect(buildingStats(b('seaport'))).toMatchObject({ jobsInd: 2400, jobsCom: 0, pollution: 0.3, upkeep: 280, powerUse: 30 });
    expect(buildingStats(b('airport'))).toMatchObject({ jobsInd: 0, jobsCom: 3200 });
    expect(buildingStats(b('spaceport'))).toMatchObject({ jobsInd: 2500, jobsCom: 3000, effect: 'prestige', radius: 20, upkeep: 1800 });
    expect(buildingStats(b('academy'))).toMatchObject({ jobsInd: 0, jobsCom: 300, effect: 'education', radius: 12 });
    expect(buildingStats(b('reactor'))).toMatchObject({ jobsInd: 400, jobsCom: 0 });
    expect(buildingStats(b('foundry'))).toMatchObject({ jobsInd: 2500, jobsCom: 0 });
    expect(buildingStats(b('spire'))).toMatchObject({ jobsInd: 0, jobsCom: 6000 });
  });

  it('a building under construction (buildDays > 0, non-stack) has no effects', () => {
    const s = buildingStats(b('spaceport', { buildDays: 12 }));
    expect(s).toMatchObject({ residents: 0, jobsCom: 0, jobsInd: 0, trips: 0, powerUse: 0, powerSupply: 0, upkeep: 0, effect: null, radius: 0, pollution: 0 });
    expect(buildingStats(b('spaceport', { buildDays: 0 })).jobsInd).toBe(2500);
    // Stratablocks keep their own stage rules.
    expect(buildingStats(b('stack', { stage: 1, buildDays: 60 })).station).toBe(true);
  });
});

describe('sim stubs (§2.7)', () => {
  it('sim.ports reads zeros; buildProgress combines days and seconds; settleWealth is a no-op', () => {
    const w = new World(14);
    const sim = new Simulation(w);
    const sp = w.addBuilding('spaceport', 10, 10)!;
    const plaza = w.addBuilding('plaza', 30, 30)!;
    const p = sim.ports;
    expect([p.visitors, p.exportJobs, p.comJobs, p.indJobs, p.tradeFor(sp.id)]).toEqual([0, 0, 0, 0, 0]);
    expect(p.buildProgress(plaza.id)).toBe(1);
    expect(p.buildProgress(9999)).toBe(0);
    expect(p.buildProgress(sp.id)).toBe(1);
    sp.buildDays = 120;
    sp.waitSec = SPACEPORT.minBuildSec;
    expect(p.buildProgress(sp.id)).toBe(0);
    sp.waitSec = 60;
    expect(p.buildProgress(sp.id)).toBeCloseTo(0.5, 6);
    sp.buildDays = 1;
    expect(p.buildProgress(sp.id)).toBeCloseTo(0.75, 6);
    expect(sim.settleWealth()).toBe(0);
  });
});

describe('Game (§2.7)', () => {
  it('clockRate is 0 while paused and ×1 / ×1.6 / ×2.4 at speeds 1-3; the clock follows it', () => {
    const g = new Game();
    const rates = [0, 1, 2, 3].map((s) => {
      g.setSpeed(s);
      return g.clockRate;
    });
    expect(rates).toEqual([0, 1, 1.6, 2.4]);
    g.setSpeed(3);
    const c = g.clock;
    g.update(0.1);
    expect(g.clock - c).toBeCloseTo(0.24, 6);
    g.setSpeed(0);
    const c2 = g.clock;
    g.update(0.1);
    expect(g.clock).toBe(c2);
  });

  it('types the new events, TileInfo notes and InspectAction ids', () => {
    const lift: GameEventMap['liftoff'] = { id: 4, first: true };
    const hint: GameEventMap['hint'] = { id: 'ramps' };
    const moment: GameEventMap['moment'] = { id: 'seaport', title: 'SEAPORT OPEN', sub: '+260 Fab jobs' };
    const toast: GameEventMap['toast'] = { text: 'Street ×12', kind: 'info', action: { id: 'undo', label: 'Undo', sec: SAFETY.undoSec } };
    const info: TileInfo = { title: 'Skyway', subtitle: '', color: '#fff', rows: [['Load', '34%']], notes: [{ text: 'Lands nowhere', tone: 'warn' }], meter: { row: 0, ticks: [0.32, 0.46] } };
    const acts: InspectAction['id'][] = ['rights', 'skyway'];
    const g = new Game();
    const seen: string[] = [];
    g.events.on('moment', (m) => seen.push(m.id));
    g.events.emit('moment', moment);
    expect([lift.first, hint.id, seen[0], toast.action?.id, info.notes?.length, acts.length]).toEqual([true, 'ramps', 'seaport', 'undo', 1, 2]);
  });
});

// ── Story vocabulary (§2.2) ─────────────────────────────────────────────────

describe('story metrics and spot rules (§2.2)', () => {
  it('are in the closed vocabulary', () => {
    for (const m of ['wealth.high', 'wealth.low', 'roads.highway', 'roads.alley', 'skyway.tiles', 'count.academy', 'count.seaport', 'count.airport', 'count.spaceport'] as Metric[]) {
      expect(METRIC_LIST).toContain(m);
      expect(isMetric(m)).toBe(true);
    }
    for (const s of ['highway', 'alley', 'shore']) expect(SPOT_RULES.has(s)).toBe(true);
    const w = new World(15);
    w.addBuilding('seaport', 10, 10);
    expect(metric(w, 'count.seaport')).toBe(1);
  });
});

// ── director.openOnDemand (§2.2) ────────────────────────────────────────────

describe('director.openOnDemand (§2.2)', () => {
  const RIGHTS: Card = {
    id: 'test.rights',
    kind: 'faction',
    speaker: 'board',
    title: 'TEST RIGHTS',
    body: 'Marrow: test.',
    brief: 'A test card that opens from a button.',
    when: { m: 'count.spaceport', op: '>=', v: 1 },
    weight: 30,
    once: true,
    onDemand: true,
    choices: [
      { label: 'Keep it public.', fx: [{ t: 'favor', f: 'board', v: 10 }], default: true },
      { label: 'Give it away.', fx: [] },
    ],
  };
  useStoryContent({ ...STORY_CONTENT, cards: [...STORY_CONTENT.cards, RIGHTS] });
  afterAll(() => {
    useStoryContent(STORY_CONTENT);
  });

  /** A game with a spaceport, mid-story clocks and a different card pending in COMMS. */
  function setup() {
    const g = headlessGame(2091);
    const w = g.world;
    w.addBuilding('spaceport', 20, 20);
    const st = w.story;
    st.deckSec = 123;
    st.frontSec = 45;
    st.lastCardTick = 7;
    const other = storyContent().deck.find((c) => c.id !== RIGHTS.id)!;
    st.pending = { card: other.id, tick: w.tick, spot: -1 };
    return { g, w, st, other };
  }

  it('opens without taking a deck slot; answering it leaves deckSec, frontSec and the pending slot', () => {
    const { g, w, st, other } = setup();
    const favor = st.favor.board;
    const r = g.story.openOnDemand(RIGHTS.id);
    expect(r.ok).toBe(true);
    expect(st.open?.card).toBe(RIGHTS.id);
    expect(g.story.blocking).toBe(true);
    expect([st.deckSec, st.frontSec, st.lastCardTick, st.pending?.card]).toEqual([123, 45, 7, other.id]);
    const view = g.story.view().card!;
    expect(view.id).toBe(RIGHTS.id);
    expect(view.canLater).toBe(false);
    g.choose(0);
    expect(st.open).toBeNull();
    expect([st.deckSec, st.frontSec, st.lastCardTick, st.pending?.card]).toEqual([123, 45, 7, other.id]);
    expect(st.favor.board).toBe(favor + 10);
    expect(st.log[st.log.length - 1]).toMatchObject({ card: RIGHTS.id, choice: 0 });
    // A spent `once` card can't open again; nor can it be drawn.
    expect(g.story.openOnDemand(RIGHTS.id).ok).toBe(false);
    expect(w.story.seen[RIGHTS.id]).toBe(w.tick);
  });

  it('refuses while a card is open, when its condition fails, or for a card without onDemand', () => {
    const { g, w, st, other } = setup();
    g.openPending();
    expect(st.open?.card).toBe(other.id);
    expect(g.story.openOnDemand(RIGHTS.id).ok).toBe(false);
    g.later();
    expect(st.open).toBeNull();
    expect(g.story.openOnDemand(other.id).ok).toBe(false);
    expect(g.story.openOnDemand('no.such.card').ok).toBe(false);
    for (const b of [...w.buildings.values()]) w.removeBuilding(b.id);
    expect(g.story.openOnDemand(RIGHTS.id)).toMatchObject({ ok: false });
    expect(st.open).toBeNull();
  });

  it('opens the pending COMMS card when that is this card', () => {
    const { g, st } = setup();
    st.pending = { card: RIGHTS.id, tick: g.world.tick, spot: -1 };
    expect(g.story.openOnDemand(RIGHTS.id).ok).toBe(true);
    expect(st.open?.card).toBe(RIGHTS.id);
    expect(g.story.view().card!.canLater).toBe(true); // the ordinary COMMS card
    g.choose(1);
    expect(st.pending).toBeNull();
  });
});
