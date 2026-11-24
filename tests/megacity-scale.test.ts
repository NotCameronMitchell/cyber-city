// Megacity scale (docs/MEGACITY.md §4, §11.3 S1, §11.5): the unit change and its lints.
//
//   Static half   every head count in the tables equals v3 × POP_SCALE (times DENSITY for the
//                 density pass's raised rows, §4.2), every per-head rate equals v3 ÷ POP_SCALE,
//                 and the numbers §4.1 keeps on purpose (money, power, radii) are untouched.
//   Lints         story `m('pop', …)` thresholds are multiples of 1,000 and goal labels quote
//                 their condition; every unlockPop is a multiple of 10; every per-tile-count
//                 term (/per100|perTile|per 100/i) in config.ts and story/ is a reviewed one.
//   Saves         serialize writes `scale: POP_SCALE`; a save without it loads ×10.
//   S2, S4        the density pass (part 2): the ScriptedMayor against its pinned v3 run, the
//                 balanced-L3 arithmetic, the megastructure premium, and a demand-led mayor's
//                 land use, traffic and Balance of Power against the same run with the density
//                 pass undone (tests/megacity-density.ts). MEASURE=1 adds the 3-seed and 12-seed
//                 tables and the story-harness chapter starts (docs/MEGACITY.md §11.6 records them).
//   S1            the pinned v3 saves (tests/fixtures, measured by the v3 build in
//                 v3-baseline.json) loaded by this build: residents and jobs ×10, money,
//                 fields, power, salt and the Balance of Power unchanged, at load and after a
//                 month; the pinned ScriptedMayor run replays month for month. Head counts are
//                 whole tens of people, so this holds exactly. It holds only for the pure unit
//                 change, so it runs while DENSITY is empty (Step 0a part 1); part 2's density
//                 pass makes it skip and the static half stays.

import { afterEach, describe, expect, it } from 'vitest';
import {
  AIRPORT,
  BUILDINGS,
  CR_SCALE,
  CROWNS,
  EDGE_LINKS,
  MILESTONES,
  POP_SCALE,
  POWER_WEIGHTS,
  ROAD_KINDS,
  SALT,
  SEAPORT,
  SKYWAY,
  SPACEPORT,
  STACK_STAGES,
  TOURISM,
  TURF,
  UNLOCK_FALLBACK_POP,
  ZONES,
} from '../src/game/config';
import { Game, PREV_SAVE_KEY } from '../src/game/game';
import { HEADLINES } from '../src/game/news';
import * as T from '../src/game/sim/tuning';
import { CHAPTERS, NOTE_CROSSINGS_PER_BRIDGE } from '../src/game/story/content';
import type { Condition } from '../src/game/story/types';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, type Building, type BuildingType, type SaveData, type StoryPace } from '../src/game/types';
import { World, savePopScale } from '../src/game/world';
import { blankStats, buildingStats } from '../src/game/buildingStats';
import type { Game as GameT } from '../src/game/game';
import { ScriptedMayor, flatWorld, makeSim } from './helpers';
import { demandLedRun, scriptedMayorYears, unitsOnly, type S4Run } from './megacity-density';
import { measureSave, type S1Snapshot } from './megacity-s1';
import { playStory } from './story/harness';
import { LEGACY_REGION } from '../src/game/types';

const S = POP_SCALE;

// ── The v3 tables (docs/EXPANSION.md as built, commit 479a8b5) ──────────────

/** v3 head counts per building: residents, jobs, jobsInd (undefined = default), unlockPop, gate fallbackPop. */
const V3_BUILDINGS: Partial<Record<BuildingType, [number, number, number | undefined, number, number | undefined]>> = {
  solar: [0, 0, undefined, 0, undefined],
  reactor: [0, 40, undefined, 600, undefined],
  plaza: [0, 0, undefined, 0, undefined],
  precinct: [0, 20, undefined, 150, undefined],
  clinic: [0, 25, undefined, 400, undefined],
  datahub: [0, 10, undefined, 1000, undefined],
  maglev: [0, 15, undefined, 2000, undefined],
  spire: [0, 600, undefined, 5000, undefined],
  arcology: [3000, 120, undefined, 12000, undefined],
  academy: [0, 30, 0, 1500, undefined],
  seaport: [0, 240, 240, 5000, undefined],
  airport: [0, 320, 0, 12000, undefined],
  spaceport: [0, 550, 250, 30000, undefined],
  stack: [0, 400, undefined, 0, 8000],
  foundry: [0, 250, undefined, 0, undefined],
  glarewall: [0, 10, undefined, 0, undefined],
  tidemarket: [0, 150, undefined, 0, undefined],
  roost: [0, 0, undefined, 0, undefined],
  commons: [0, 30, undefined, 0, undefined],
  memorial: [0, 0, undefined, 0, undefined],
};

const V3 = {
  zones: { res: [0, 14, 48, 150], com: [0, 8, 28, 90], ind: [0, 12, 34, 75] },
  milestones: [100, 500, 1500, 5000, 12000, 30000],
  milestoneGrants: [1000, 2000, 4000, 8000, 15000, 30000],
  fallback: { factions: 3000, comms: 3000, stack: 8000, deals: 8000, crackdown: 6000, pact: 6000, turfOverlay: 6000, skybridge: 9000, rail: 9000, crowns: 20000 },
  seedPop: { undertow: 1200, kites: 2500 },
  /** STACK_STAGES res, jobsCom, jobsInd. */
  stages: [
    [0, 300, 100],
    [1600, 0, 0],
    [400, 300, 0],
  ],
  /** CROWNS residents, jobsInd. */
  crowns: { foundry: [0, 250], glare: [0, 0], nest: [0, 0], commons: [600, 0] },
  roads: [0, 1500, 5000, 1200, 5000],
  skyway: 12000,
  seaportExportJobs: 260,
  airportComJobs: 320,
  spaceport: [200, 300],
  edge: { ind: 25, com: 12 },
  tourism: { airport: 1200, spaceport: 3000, perHighCom: 3, perEdgePoint: 40, landmark: { spire: 150, arcology: 100, memorial: 200 } },
  tuning: {
    RES_STARTER: 220,
    COM_BASE: 25,
    IND_EXPORT_BASE: 100,
    RES_DEMAND_FLOOR: 160,
    JOB_DEMAND_FLOOR: 60,
    UNEMPLOYMENT_FULL_POP: 800,
    CRIME_TOWN_POP: 3000,
    CRIME_CITY_POP: 20000,
    EVENT_MIN_POP: 60,
  },
  /** Per-head rates (÷ POP_SCALE). */
  rates: {
    TAX_PER_RESIDENT: 0.035,
    TAX_PER_COM_JOB: 0.045,
    TAX_PER_IND_JOB: 0.04,
    TRIPS_PER_UNIT: [0, 1.0, 0.9, 0.8],
    BUILDING_TRIPS: 0.5,
    tradeRate: 0.12,
    spend: 0.35,
    saltPerPop: 0.08,
    jobsIndDiv: 8,
    jobsComDiv: 8,
  },
  noteCrossings: 150,
  /** HEADLINES' minPop / maxPop in deck order. */
  news: [
    ['minPop', 200],
    ['minPop', 300],
    ['minPop', 800],
    ['minPop', 1500],
    ['minPop', 2000],
    ['minPop', 1000],
    ['minPop', 500],
    ['minPop', 1200],
    ['minPop', 2500],
    ['maxPop', 400],
    ['maxPop', 900],
    ['minPop', 6000],
  ],
} as const;

/**
 * The density pass and the megastructure premium (§4.1 step 2, §4.2): rows whose head counts are
 * NOT v3 × 10, with their expected values. Empty in Step 0a part 1 (the pure unit change, when S1
 * below ran exact); part 2 fills it, so S1 skips and the static half checks everything else.
 */
const DENSITY: Record<string, number | readonly number[]> = {
  // Businesses provide enough jobs: Market and Fab L2–L3 (×10 units would be 280 / 900, 340 / 750).
  'ZONES.com.capacity': [0, 80, 380, 1250],
  'ZONES.ind.capacity': [0, 120, 450, 1200],
  // Megastructures out-house the towers beside them (×10 units: 16,000; 4,000; 6,000; 30,000; 6,000).
  'STACK_STAGES.1.res': 32000,
  'STACK_STAGES.2.res': 6000,
  'CROWNS.commons.residents': 10000,
  'BUILDINGS.arcology.residents': 40000,
  'BUILDINGS.spire.jobs': 8000,
};

/** Expected value of a head-count row: the density override if listed, else v3 × POP_SCALE. */
function want(key: string, v3: number): number;
function want(key: string, v3: readonly number[]): number[];
function want(key: string, v3: number | readonly number[]): number | number[] {
  const d = DENSITY[key];
  if (d !== undefined) return typeof d === 'number' ? d : [...d];
  return typeof v3 === 'number' ? v3 * S : v3.map((x) => x * S);
}

const UNITS_ONLY = Object.keys(DENSITY).length === 0;

// ── Static half ─────────────────────────────────────────────────────────────

describe('Megacity scale: the units (§4.1, §4.3, §4.4)', () => {
  it('POP_SCALE is 10 and CR_SCALE 1 (prices at per-building parity)', () => {
    expect(POP_SCALE).toBe(10);
    expect(CR_SCALE).toBe(1);
  });

  it('zone capacities are v3 × 10 (the density pass listed in DENSITY)', () => {
    for (const z of ['res', 'com', 'ind'] as const) expect([...ZONES[z].capacity], z).toEqual(want(`ZONES.${z}.capacity`, V3.zones[z]));
    expect(ZONES.ind.name).toBe('Fab Yards');
    expect(ZONES.ind.tool).toBe('ind');
  });

  it('every building: residents, jobs, Fab share, unlockPop and gate fallback are v3 × 10', () => {
    // Every v3 type is still there; the Megacity types (MEGACITY §6.3, Step 0b) are new rows, not rescaled ones.
    for (const t of Object.keys(V3_BUILDINGS)) expect(BUILDINGS[t as BuildingType], t).toBeDefined();
    for (const t of Object.keys(V3_BUILDINGS) as BuildingType[]) {
      const d = BUILDINGS[t];
      const [res, jobs, ind, unlock, fb] = V3_BUILDINGS[t]!;
      expect(d.residents, `${t}.residents`).toBe(want(`BUILDINGS.${t}.residents`, res));
      expect(d.jobs, `${t}.jobs`).toBe(want(`BUILDINGS.${t}.jobs`, jobs));
      if (ind === undefined) expect(d.jobsInd, `${t}.jobsInd`).toBeUndefined();
      else expect(d.jobsInd, `${t}.jobsInd`).toBe(want(`BUILDINGS.${t}.jobsInd`, ind));
      expect(d.unlockPop, `${t}.unlockPop`).toBe(unlock * S);
      expect(d.gate?.fallbackPop, `${t}.fallbackPop`).toBe(fb === undefined ? undefined : fb * S);
    }
  });

  it('milestones: the six v3 rows × 10 with their bonuses, then the four new rows (§4.5)', () => {
    expect(MILESTONES.slice(0, 6).map((m) => m.pop)).toEqual(V3.milestones.map((p) => p * S));
    expect(MILESTONES.slice(0, 6).map((m) => m.grant)).toEqual([...V3.milestoneGrants]);
    expect(MILESTONES.slice(6).map((m) => [m.pop, m.title, m.grant])).toEqual([
      [600_000, 'Night Harbour', 45000],
      [1_000_000, 'Million Windows', 60000],
      [2_000_000, 'Neon Coast', 90000],
      [4_000_000, 'Endless City', 150_000],
      // 5×5 region only (Step 0b, `region: 5`).
      [6_000_000, 'Electric Tide', 200_000],
      [8_000_000, 'Glass Horizon', 250_000],
    ]);
    expect(MILESTONES.filter((m) => m.region === 5).map((m) => m.title)).toEqual(['Electric Tide', 'Glass Horizon']);
    for (let i = 1; i < MILESTONES.length; i++) expect(MILESTONES[i].pop).toBeGreaterThan(MILESTONES[i - 1].pop);
    // "Lamp" and "Lantern" stay the Tuning's (§4.5).
    for (const m of MILESTONES.slice(6)) expect(m.title).not.toMatch(/lamp|lantern/i);
  });

  it('story unlock fallbacks, turf seeding, Stratablock stages and crowns are v3 × 10', () => {
    expect({ ...UNLOCK_FALLBACK_POP }).toEqual(Object.fromEntries(Object.entries(V3.fallback).map(([k, v]) => [k, v * S])));
    expect({ ...TURF.seedPop }).toEqual({ undertow: V3.seedPop.undertow * S, kites: V3.seedPop.kites * S });
    STACK_STAGES.forEach((st, i) => {
      const [res, com, ind] = V3.stages[i];
      expect([st.res, st.jobsCom, st.jobsInd], st.name).toEqual([
        want(`STACK_STAGES.${i}.res`, res),
        want(`STACK_STAGES.${i}.jobsCom`, com),
        want(`STACK_STAGES.${i}.jobsInd`, ind),
      ]);
    });
    for (const [id, [res, ind]] of Object.entries(V3.crowns)) {
      const c = CROWNS[id as keyof typeof CROWNS];
      expect([c.residents ?? 0, c.jobsInd ?? 0], id).toEqual([want(`CROWNS.${id}.residents`, res), want(`CROWNS.${id}.jobsInd`, ind)]);
    }
    expect(CROWNS.foundry.summary).toBe('+2,500 Fab jobs, smoke at the top.');
    expect(CROWNS.commons.summary).toMatch(/^\+[\d,]+ residents in cheap floors, approval \+3\.$/);
    expect(CROWNS.commons.summary).toContain((CROWNS.commons.residents ?? 0).toLocaleString('en-US'));
  });

  it('road, skyway and port numbers are v3 × 10', () => {
    expect(ROAD_KINDS.map((r) => r.unlockPop)).toEqual(V3.roads.map((p) => p * S));
    expect(SKYWAY.unlockPop).toBe(V3.skyway * S);
    expect(SEAPORT.exportJobs).toBe(V3.seaportExportJobs * S);
    expect(AIRPORT.comJobs).toBe(V3.airportComJobs * S);
    expect([SPACEPORT.indJobs, SPACEPORT.comJobs]).toEqual(V3.spaceport.map((n) => n * S));
    expect([EDGE_LINKS.ind, EDGE_LINKS.com]).toEqual([V3.edge.ind * S, V3.edge.com * S]);
    expect([TOURISM.airport, TOURISM.spaceport, TOURISM.perHighCom, TOURISM.perEdgePoint]).toEqual(
      [V3.tourism.airport, V3.tourism.spaceport, V3.tourism.perHighCom, V3.tourism.perEdgePoint].map((n) => n * S),
    );
    expect({ ...TOURISM.landmark }).toEqual(Object.fromEntries(Object.entries(V3.tourism.landmark).map(([k, v]) => [k, v * S])));
    // Visitors and jobs both ×10: Market jobs per visitor stay.
    expect(TOURISM.comPerVisitor).toBe(0.06);
  });

  it('sim thresholds and demand bases are v3 × 10; per-head rates v3 ÷ 10', () => {
    for (const [k, v] of Object.entries(V3.tuning)) expect((T as unknown as Record<string, number>)[k], k).toBe(v * S);
    const r = V3.rates;
    const close = (a: number, b: number, what: string) => expect(a, what).toBeCloseTo(b / S, 12);
    close(T.TAX_PER_RESIDENT, r.TAX_PER_RESIDENT, 'TAX_PER_RESIDENT');
    close(T.TAX_PER_COM_JOB, r.TAX_PER_COM_JOB, 'TAX_PER_COM_JOB');
    close(T.TAX_PER_IND_JOB, r.TAX_PER_IND_JOB, 'TAX_PER_IND_JOB');
    T.TRIPS_PER_UNIT.forEach((v, i) => close(v, r.TRIPS_PER_UNIT[i], `TRIPS_PER_UNIT[${i}]`));
    close(T.BUILDING_TRIPS, r.BUILDING_TRIPS, 'BUILDING_TRIPS');
    close(SEAPORT.tradeRate, r.tradeRate, 'SEAPORT.tradeRate');
    close(TOURISM.spend, r.spend, 'TOURISM.spend');
    close(SALT.perPop, r.saltPerPop, 'SALT.perPop');
    // The Balance of Power divides jobs: the divisor grows with the units.
    expect(POWER_WEIGHTS.basalt.jobsIndDiv).toBe(r.jobsIndDiv * S);
    expect(POWER_WEIGHTS.nacre.jobsComDiv).toBe(r.jobsComDiv * S);
  });

  it('unchanged on purpose: money, caps and per-building numbers (§4.1); the premium\'s power and upkeep (§4.2)', () => {
    expect(SEAPORT.tradeCap).toBe(2000);
    expect(SALT.base).toBe(600);
    expect(SPACEPORT.income).toBe(1200);
    // Costs stay. The premium raises the Hab Core's power 80 → 150 and upkeep 180 → 260, the
    // Spire's power 60 → 80 and the Arcology's 220 → 290, so running costs per head stay near
    // a Hab L3 tile's; everything else is the v3 value.
    expect(STACK_STAGES.map((s) => [s.cost, s.power, s.upkeep])).toEqual([
      [12000, 40, 120],
      [16000, 150, 260],
      [22000, 80, 220],
    ]);
    expect([BUILDINGS.spire.cost, BUILDINGS.spire.powerUse, BUILDINGS.arcology.cost, BUILDINGS.arcology.powerUse]).toEqual([25000, 80, 60000, 290]);
    expect([BUILDINGS.spire.upkeep, BUILDINGS.arcology.upkeep, BUILDINGS.arcology.jobs]).toEqual([400, 700, 1200]);
    // Zone power, pollution and cost per tile are unchanged by the density pass (§4.1).
    expect([ZONES.res.power, ZONES.com.power, ZONES.ind.power]).toEqual([
      [0, 1, 3, 8],
      [0, 2, 5, 12],
      [0, 3, 7, 14],
    ]);
    expect([ZONES.res.cost, ZONES.com.cost, ZONES.ind.cost]).toEqual([20, 30, 25]);
  });

  it('descriptions quote the premium numbers', () => {
    expect(BUILDINGS.spire.desc).toContain(`${BUILDINGS.spire.jobs.toLocaleString('en-US')} office jobs`);
    expect(BUILDINGS.arcology.desc).toContain(`for ${BUILDINGS.arcology.residents.toLocaleString('en-US')} residents`);
    expect(CROWNS.commons.summary).toBe('+10,000 residents in cheap floors, approval +3.');
  });

  it('news gates, the MOTH crossing count and the in-code thresholds are ×10', async () => {
    const gates = HEADLINES.flatMap((h) => [...(h.minPop !== undefined ? [['minPop', h.minPop]] : []), ...(h.maxPop !== undefined ? [['maxPop', h.maxPop]] : [])]);
    expect(gates).toEqual(V3.news.map(([k, v]) => [k, v * S]));
    expect(NOTE_CROSSINGS_PER_BRIDGE).toBe(V3.noteCrossings * S);
    // Literals that live in code, not tables (§4.4 rows): each must read its ×10 value.
    const src = import.meta.glob(
      ['../src/game/sim/advisor.ts', '../src/game/sim/incidents.ts', '../src/game/sim/census.ts', '../src/render/art/traffic.ts', '../src/render/art/skytraffic.ts', '../src/game/story/director.ts', '../src/ui/dock.ts'],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    const file = (name: string) => Object.entries(src).find(([k]) => k.endsWith(name))![1];
    const advisor = file('sim/advisor.ts');
    for (const s of ['pop > 1200 && census.unemployment', 'pop > 600)', 'pop > 2000)']) expect(advisor).toContain(s);
    expect(advisor).not.toMatch(/pop > (120|60|200)\b/);
    const incidents = file('sim/incidents.ts');
    expect(incidents).toContain('census.population >= 3000');
    expect(incidents).toContain('1500 + census.population * 0.04');
    expect(file('sim/census.ts')).not.toMatch(/Math\.max\((160|60),/);
    expect(file('art/traffic.ts')).toContain('pop / 12000');
    expect(file('art/skytraffic.ts')).toContain('pop / 30000');
    expect(file('art/skytraffic.ts')).toContain('pop > 6000');
    expect(file('story/director.ts')).toContain('NOTE_CROSSINGS_PER_BRIDGE * w.vertical.metrics.skybridges');
    expect(file('ui/dock.ts')).toContain('def.jobs >= 1000');
  });
});

// ── Saves (§4.4 world.ts row) ───────────────────────────────────────────────

describe('Megacity scale: saves carry their units', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  const v3Save = (): SaveData => {
    const d = JSON.parse(JSON.stringify(new World(5, 'Old Units', undefined, LEGACY_REGION).serialize())) as SaveData;
    delete d.scale;
    d.maxPopulation = 12345;
    d.milestones = [100, 500, 1500];
    return d;
  };

  it('serialize writes scale: POP_SCALE; that save loads without multiplying again', () => {
    const w = new World(5, 'New Units', undefined, LEGACY_REGION);
    w.maxPopulation = 123450;
    w.milestones = [1000, 5000, 15000];
    const d = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    expect(d.scale).toBe(POP_SCALE);
    const back = World.deserialize(d);
    expect(back.maxPopulation).toBe(123450);
    expect(back.milestones).toEqual([1000, 5000, 15000]);
  });

  it('a save without scale (every v1–v3 save) loads ×10 and maps its milestones onto today\'s', () => {
    const d = v3Save();
    expect(savePopScale(d)).toBe(POP_SCALE);
    const w = World.deserialize(d);
    expect(w.maxPopulation).toBe(123450);
    expect(w.milestones).toEqual(MILESTONES.slice(0, 3).map((m) => m.pop));
    // A city past 214 M people (×10 of a v3 dev save) does not wrap.
    expect(World.deserialize({ ...v3Save(), maxPopulation: 1e9 }).maxPopulation).toBe(1e10);
    // Junk stays harmless.
    expect(World.deserialize({ ...v3Save(), maxPopulation: -4, milestones: ['x', 300] as unknown as number[] }).maxPopulation).toBe(0);
    expect(World.deserialize({ ...v3Save(), milestones: ['x', 300] as unknown as number[] }).milestones).toEqual([3000]);
    expect(savePopScale({ scale: 1 })).toBe(10);
    expect(savePopScale({ scale: 'ten' })).toBe(10);
  });

  it("the Previous city row shows a v3 backup's peak in today's units", () => {
    const m = new Map<string, string>([[PREV_SAVE_KEY, JSON.stringify(v3Save())]]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    };
    expect(new Game().previousSaveInfo()).toMatchObject({ cityName: 'Old Units', maxPopulation: 123450 });
    m.set(PREV_SAVE_KEY, JSON.stringify({ ...v3Save(), scale: POP_SCALE }));
    expect(new Game().previousSaveInfo()?.maxPopulation).toBe(12345);
  });
});

// ── Lints (§4.4) ────────────────────────────────────────────────────────────

const STORY_SRC = import.meta.glob(['../src/game/story/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const CONFIG_SRC = import.meta.glob(['../src/game/config.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every pop / maxPop threshold of a condition tree. */
function popThresholds(c: Condition, out: number[] = []): number[] {
  if ('m' in c) {
    if (c.m === 'pop' || c.m === 'maxPop') out.push(c.v);
  } else if ('all' in c) for (const x of c.all) popThresholds(x, out);
  else if ('any' in c) for (const x of c.any) popThresholds(x, out);
  else if ('not' in c) popThresholds(c.not, out);
  else if ('hold' in c) popThresholds(c.hold, out);
  return out;
}

describe('Megacity scale lints (§4.4)', () => {
  it("every m('pop', …) / m('maxPop', …) threshold in story content is a multiple of 1,000", () => {
    const bad: string[] = [];
    let seen = 0;
    const re = /m\(\s*['"](pop|maxPop)['"]\s*,\s*['"][^'"]+['"]\s*,\s*([\d_.]+)\s*\)/g;
    for (const [f, src] of Object.entries(STORY_SRC)) {
      for (const mt of src.matchAll(re)) {
        seen++;
        const v = Number(mt[2].replace(/_/g, ''));
        if (!Number.isInteger(v) || v % 1000 !== 0) bad.push(`${f}: ${mt[0]}`);
      }
    }
    expect(seen).toBeGreaterThan(15);
    expect(bad).toEqual([]);
    // The same rule on the loaded data (catches thresholds built without the m() helper).
    for (const ch of CHAPTERS) {
      const conds = [ch.trigger, ch.fallback, ...ch.goals.map((g) => g.cond), ...ch.beats.flatMap((b) => (typeof b.after === 'object' && 'cond' in b.after ? [b.after.cond] : []))];
      for (const c of conds) for (const v of popThresholds(c)) expect(v % 1000, `chapter ${ch.n}: ${v}`).toBe(0);
    }
  });

  it('a goal label that quotes residents quotes its condition and its progress target', () => {
    let checked = 0;
    for (const ch of CHAPTERS)
      for (const g of ch.goals) {
        const mt = /([\d,]+) residents/.exec(g.label);
        if (!mt) continue;
        checked++;
        const n = Number(mt[1].replace(/,/g, ''));
        expect(popThresholds(g.cond), g.id).toContain(n);
        if (g.show?.m === 'pop') expect(g.show.target, g.id).toBe(n);
        // Grouped the way the goal drawer prints numbers.
        expect(mt[1], g.id).toBe(n.toLocaleString('en-US'));
      }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('every unlockPop (and every population gate in config) is a multiple of 10', () => {
    const pops: [string, number][] = [
      ...Object.values(BUILDINGS).map((d) => [`${d.type}.unlockPop`, d.unlockPop] as [string, number]),
      ...Object.values(BUILDINGS).flatMap((d) => (d.gate?.fallbackPop !== undefined ? [[`${d.type}.fallbackPop`, d.gate.fallbackPop] as [string, number]] : [])),
      ...ROAD_KINDS.map((r) => [`${r.name}.unlockPop`, r.unlockPop] as [string, number]),
      ['SKYWAY.unlockPop', SKYWAY.unlockPop],
      ...Object.entries(UNLOCK_FALLBACK_POP).map(([k, v]) => [`fallback.${k}`, v as number] as [string, number]),
      ...MILESTONES.map((m) => [`milestone ${m.title}`, m.pop] as [string, number]),
    ];
    for (const [k, v] of pops) expect(v % 10, k).toBe(0);
  });

  it('every per-tile-count term in config.ts and story/ is a reviewed one', () => {
    // file → token → count. Each is a tile or price term §4.4 reviewed: TURF.demandPer100 (per 100
    // turf tiles; Step 0b divides it by owned districts), SKYBRIDGE / RIBBON / SKYWAY perTile and
    // upkeepPerTile (CR per tile), and their readers. A new match fails until it is reviewed here.
    const REVIEWED: Record<string, Record<string, number>> = {
      // + 2 perTile: Step 0b's SKYBRIDGE.v2 price (CR per gap tile) and its comment (MEGACITY §5.7).
      'src/game/config.ts': { demandPer100: 1, perTile: 5, upkeepPerTile: 1 },
      'src/game/story/vertical.ts': { upkeepPerTile: 1, perTile: 2 },
      'src/game/story/turf.ts': { 'per 100': 2, demandPer100: 1 },
    };
    const found: Record<string, Record<string, number>> = {};
    const re = /\w*(?:per100|perTile|per 100)\w*/gi;
    for (const [f, src] of [...Object.entries(CONFIG_SRC), ...Object.entries(STORY_SRC)]) {
      const key = f.replace(/^(\.\.\/)+/, '');
      for (const mt of src.matchAll(re)) {
        found[key] ??= {};
        found[key][mt[0]] = (found[key][mt[0]] ?? 0) + 1;
      }
    }
    expect(found).toEqual(REVIEWED);
  });
});

// ── S1: the pinned v3 saves loaded by this build (§11.3) ────────────────────

const FIXTURES = import.meta.glob(['./fixtures/v3-*.json', '!./fixtures/v3-baseline.json'], { import: 'default', eager: true }) as Record<string, SaveData>;
type MayorMonth = { pop: number; jobsCom: number; jobsInd: number; funds: number; net: number; approval: number };
const BASELINE = (
  import.meta.glob(['./fixtures/v3-baseline.json'], { import: 'default', eager: true }) as Record<
    string,
    { s1: Record<string, { load: S1Snapshot; month: S1Snapshot; net: number }>; mayor: Record<string, { months: MayorMonth[]; lowestFunds: number; maxPopulation: number; milestones: number[] }> }
  >
)[
  './fixtures/v3-baseline.json'
];
/** §11.3 S1 rows (the expansion fixture and the ScriptedMayor saves) plus the post-ending city. */
const S1_SAVES = ['v3-expansion', 'v3-mayor-2091-y3', 'v3-mayor-2091-y8', 'v3-mayor-7-y3', 'v3-mayor-7-y8', 'v3-mayor-31-y3', 'v3-mayor-31-y8', 'v3-ending'];

/** Today's income line label for a v3 one (the zone rename, §0 Words). */
const label = (l: string) => (l === 'Fab District tax' ? 'Fab Yards tax' : l);

/**
 * S1 (§11.3) allows residents and jobs ×10 ±0.5%, money ±1%, fields and unemployment ±0.002,
 * approval ±0.5, the Balance of Power ±1 point, power and salt identical. Head counts are whole
 * tens of people (zoneCapacity, workforce, visitors), so the unit change is exact: this build
 * reproduces the v3 numbers ×10 to floating-point noise, at load and after a month of play.
 */
const FP = 1e-9;

function compare(name: string, a: S1Snapshot, o: S1Snapshot): void {
  const at = (what: string) => `${name}: ${what}`;
  expect(a.tick, at('tick')).toBe(o.tick);
  expect(a.funds, at('funds')).toBe(o.funds);
  expect(a.maxPopulation, at('maxPopulation')).toBe(o.maxPopulation * S);
  expect(a.milestones, at('milestones')).toEqual(o.milestones.map((p) => p * S));
  for (const k of ['pop', 'jobsCom', 'jobsInd', 'visitors'] as const) expect(a[k], at(k)).toBe(o[k] * S);
  expect(a.income, at('income')).toBe(o.income);
  expect(a.expenses, at('expenses')).toBe(o.expenses);
  expect(a.incomeLines, at('income lines')).toEqual(Object.fromEntries(Object.entries(o.incomeLines).map(([l, v]) => [label(l), v])));
  expect(a.expenseLines, at('expense lines')).toEqual(o.expenseLines);
  for (const k of ['avgTraffic', 'avgPollution', 'avgLandValue', 'avgCrime', 'unemployment', 'approval'] as const)
    expect(Math.abs(a[k] - o[k]), at(`${k} ${a[k]} vs ${o[k]}`)).toBeLessThanOrEqual(FP);
  expect(a.approvalShown, at('approval shown')).toBe(o.approvalShown);
  expect(a.powerSupply, at('power supply')).toBe(o.powerSupply);
  expect(Math.abs(a.powerDemand - o.powerDemand), at('power demand')).toBeLessThanOrEqual(FP * o.powerDemand);
  for (const k of ['res', 'com', 'ind'] as const) expect(Math.abs(a.demand[k] - o.demand[k]), at(`demand ${k}`)).toBeLessThanOrEqual(FP);
  expect(a.salt, at('salt')).toBe(o.salt);
  for (const f of Object.keys(o.power) as (keyof typeof o.power)[])
    expect(Math.abs(a.power[f] - o.power[f]), at(`Balance of Power ${f}`)).toBeLessThanOrEqual(FP);
}

describe.skipIf(!UNITS_ONLY)('S1: the unit change is invisible (pinned v3 saves, §11.3)', () => {
  it('has every pinned save and its v3 measurement', () => {
    const names = Object.keys(FIXTURES).map((k) => k.replace(/^.*\/(v3-[^/]+)\.json$/, '$1'));
    for (const n of S1_SAVES) {
      expect(names, n).toContain(n);
      expect(BASELINE.s1[n], n).toBeDefined();
    }
  });

  for (const n of S1_SAVES)
    it(`${n}: residents and jobs ×10, money, fields, power, salt and the Balance of Power unchanged`, () => {
      const save = FIXTURES[`./fixtures/${n}.json`];
      expect(save.version).toBe(3);
      expect(save.scale).toBeUndefined();
      const r = measureSave(save);
      const b = BASELINE.s1[n];
      compare(`${n} at load`, r.load, b.load);
      compare(`${n} after a month`, r.month, b.month);
      expect(r.net, `${n}: the month's net`).toBe(b.net);
    }, 60_000);

  // The pinned ScriptedMayor run (balance.test.ts' playthrough, events on) replays the v3 city
  // month for month: the units never tip a growth roll, a milestone or a mayor's decision.
  it('the scripted mayor (seed 2091, 8 years) grows the v3 city ×10, month for month', () => {
    const b = BASELINE.mayor['2091'];
    const w = flatWorld(2091);
    const sim = makeSim(w, true);
    const mayor = new ScriptedMayor(w, sim);
    mayor.opening();
    for (let m = 0; m < 8 * MONTHS_PER_YEAR; m++) {
      for (let d = 0; d < DAYS_PER_MONTH; d++) {
        sim.step();
        mayor.observe();
      }
      mayor.turn();
      const s = w.stats;
      const o = b.months[m];
      expect([s.population, s.jobsCom, s.jobsInd], `month ${m + 1}`).toEqual([o.pop * S, o.jobsCom * S, o.jobsInd * S]);
      expect([Math.round(w.funds), w.budget.history.at(-1) ?? 0, s.approval], `month ${m + 1}`).toEqual([o.funds, o.net, o.approval]);
    }
    expect(mayor.lowestFunds).toBe(b.lowestFunds);
    expect(w.maxPopulation).toBe(b.maxPopulation * S);
    expect(w.milestones).toEqual(b.milestones.map((p) => p * S));
  }, 120_000);
});

// ── S2 and S4: the density pass (§4.1 step 2, §4.2, §11.3) ──────────────────

const env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MEASURE = env.MEASURE === '1';
const mean = (a: readonly number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const PINNED = [2091, 7, 31] as const;
const last = (r: S4Run) => r.years[r.years.length - 1];

/** Ratio of each run's year-end population to the pinned v3 run × 10, and of its funds. */
function againstV3(seed: number, years: ReturnType<typeof scriptedMayorYears>) {
  const b = BASELINE.mayor[String(seed)].months;
  return {
    pop: years.map((y, i) => y.pop / (b[i * MONTHS_PER_YEAR + MONTHS_PER_YEAR - 1].pop * S)),
    funds: years.map((y, i) => y.funds / b[i * MONTHS_PER_YEAR + MONTHS_PER_YEAR - 1].funds),
  };
}

describe('S2: the ScriptedMayor against its pinned v3 run (§11.3)', () => {
  // §11.3 S2: population ×10 within −5% / +25% and funds within −5% / +25%. One scripted run is
  // chaotic: in the v3 build, the same city with its dice shifted by one draw moves population
  // by 0.83–1.16× and funds by 0.20–3.1× at a year end (12 seeds, MEASURE=1). So the bands are
  // read on the mean of the three pinned seeds (population every year, funds once the build-out
  // is done, years 5–8, when the treasury is no longer spent to the bone), and each single run
  // stays inside the dice noise.
  it('three pinned seeds, 8 years: mean population ×10 within −5% / +25% every year; mean funds from year 5', () => {
    const pop: number[][] = [];
    const funds: number[][] = [];
    for (const seed of PINNED) {
      const r = againstV3(seed, scriptedMayorYears(seed));
      pop.push(r.pop);
      funds.push(r.funds);
      for (const [y, v] of r.pop.entries()) {
        expect(v, `seed ${seed} year ${y + 1} population`).toBeGreaterThanOrEqual(0.85);
        expect(v, `seed ${seed} year ${y + 1} population`).toBeLessThanOrEqual(1.25);
      }
    }
    for (let y = 0; y < 8; y++) {
      const p = mean(pop.map((r) => r[y]));
      expect(p, `year ${y + 1} mean population`).toBeGreaterThanOrEqual(0.95);
      expect(p, `year ${y + 1} mean population`).toBeLessThanOrEqual(1.25);
      if (y < 4) continue;
      const f = mean(funds.map((r) => r[y]));
      expect(f, `year ${y + 1} mean funds`).toBeGreaterThanOrEqual(0.95);
      expect(f, `year ${y + 1} mean funds`).toBeLessThanOrEqual(1.25);
    }
  }, 120_000);
});

/** Stats of a building as built and complete (a full Stratablock with an optional crown). */
function fullStats(type: BuildingType, crown?: Building['crown']) {
  const b: Building = { id: 1, type, x: 0, y: 0, size: BUILDINGS[type].size, builtTick: 0, offline: 0, powered: true, ...(type === 'stack' ? { stage: 3, buildDays: 0, crown } : {}) };
  return buildingStats(b, blankStats());
}

describe('S4: the density pass (§4.1, §4.2, §11.3)', () => {
  it('a balanced L3 city is ≈ 60% Hab, 20% Market, 20% Fab land (the demand ratios over the L3 capacities)', () => {
    // Per L3 Hab tile: Market jobs per resident (COM_PER_RES, plus COM_PER_IND of the Fab jobs)
    // and Fab jobs per resident (IND_PER_WORKER of the workforce), over the L3 capacities.
    const res = ZONES.res.capacity[3];
    const fabPerRes = T.WORKFORCE_SHARE * T.IND_PER_WORKER;
    const mktPerRes = T.COM_PER_RES + fabPerRes * T.COM_PER_IND;
    const mkt = (res * mktPerRes) / ZONES.com.capacity[3];
    const fab = (res * fabPerRes) / ZONES.ind.capacity[3];
    expect(mkt).toBeCloseTo(0.33, 2);
    expect(fab).toBeCloseTo(0.34, 2);
    const all = 1 + mkt + fab;
    expect(1 / all).toBeGreaterThan(0.55);
    expect(1 / all).toBeLessThan(0.65);
    for (const share of [mkt / all, fab / all]) {
      expect(share).toBeGreaterThan(0.15);
      expect(share).toBeLessThan(0.25);
    }
    // By units alone it was half shops and fabs (§4.1: ≈ 50% / 23% / 27%).
    const mkt0 = (res * mktPerRes) / 900;
    const fab0 = (res * fabPerRes) / 750;
    expect(1 / (1 + mkt0 + fab0)).toBeLessThan(0.52);
  });

  it('every megastructure houses or employs ≥ 1.5× its footprint in L3 zone tiles of its kind (§4.2)', () => {
    const tiles = (t: BuildingType) => BUILDINGS[t].size * BUILDINGS[t].size;
    const stack = fullStats('stack');
    expect([stack.residents, stack.jobsCom + stack.jobsInd]).toEqual([38000, 7000]);
    expect(stack.residents).toBeGreaterThanOrEqual(1.5 * tiles('stack') * ZONES.res.capacity[3]);
    expect(fullStats('stack', 'commons').residents).toBe(48000);
    expect(fullStats('arcology').residents).toBeGreaterThanOrEqual(1.5 * tiles('arcology') * ZONES.res.capacity[3]);
    expect(fullStats('spire').jobsCom).toBeGreaterThanOrEqual(1.5 * tiles('spire') * ZONES.com.capacity[3]);
    // §6.3's faction megastructures, once Step 0b adds their rows (Fab and office jobs).
    const later: Record<string, 'ind' | 'com'> = { hexworks: 'ind', pearlatrium: 'com' };
    for (const [t, kind] of Object.entries(later)) {
      if (!(t in BUILDINGS)) continue;
      const st = fullStats(t as BuildingType);
      expect(st.jobsCom + st.jobsInd, t).toBeGreaterThanOrEqual(1.5 * tiles(t as BuildingType) * ZONES[kind].capacity[3]);
    }
    // Running costs per resident stay near a Hab L3 tile's (8 power per 1,500 residents).
    const perHab = ZONES.res.power[3] / ZONES.res.capacity[3];
    expect(STACK_STAGES[1].power / STACK_STAGES[1].res / perHab).toBeLessThan(1.0);
    expect(BUILDINGS.arcology.powerUse / BUILDINGS.arcology.residents / perHab).toBeLessThan(1.4);
  });

  // The demand-led mayor of §11.3 S4 on one district, 12 years, seed 2091, against the same run
  // with the density pass undone (unitsOnly): the plain district (homes mostly reach L2: land
  // value ≈ 0.36) and a downtown (+0.3 land value everywhere: homes reach L3, the balanced L3
  // city of §4.1). MEASURE=1 runs seeds 2091, 7 and 31 and prints the tables.
  it('demand-led mayor, one district, 12 years: land use, traffic, residents and the Balance of Power', () => {
    const seed = 2091;
    const plain = demandLedRun(seed);
    const plain0 = unitsOnly(() => demandLedRun(seed));
    const down = demandLedRun(seed, 12, 0.3);
    const down0 = unitsOnly(() => demandLedRun(seed, 12, 0.3));
    const [p, p0, d, d0] = [plain, plain0, down, down0].map(last);
    // Downtown (L3 homes): §4.1's land use, Hab +5 points or more against units alone.
    expect(d.share.res).toBeGreaterThanOrEqual(0.55);
    expect(d.share.res).toBeLessThanOrEqual(0.65);
    for (const z of ['com', 'ind'] as const) {
      expect(d.share[z], z).toBeGreaterThanOrEqual(0.15);
      expect(d.share[z], z).toBeLessThanOrEqual(0.25);
    }
    expect(d.share.res - d0.share.res).toBeGreaterThanOrEqual(0.05);
    // The plain district: more of it is homes, and it holds more people ("about a fifth").
    expect(p.share.res - p0.share.res).toBeGreaterThanOrEqual(0.02);
    expect(p.pop / p0.pop).toBeGreaterThanOrEqual(1.0);
    expect(p.pop / p0.pop).toBeLessThanOrEqual(1.3);
    // Traffic: within +0.03 on the plain district. Downtown, where Market and Fab L3 tiles make
    // ×1.39 and ×1.6 the trips, it reads ≈ +0.06 (§4.1: Step 9's per-level trip factor if kept).
    expect(p.avgTraffic - p0.avgTraffic).toBeLessThanOrEqual(0.03);
    expect(d.avgTraffic - d0.avgTraffic).toBeLessThanOrEqual(0.08);
    // The Balance of Power at the downtown's balanced city: within ±2 points.
    for (const f of ['board', 'basalt', 'nacre'] as const) expect(Math.abs(d.power[f] - d0.power[f]), f).toBeLessThanOrEqual(2);
    // Unemployment sits at the demand model's equilibrium (residents follow jobs × RES_PER_JOB:
    // 1 − 1 / 1.15 ≈ 13%) in both builds; §11.3's "≤ 5%" is not this sim's balance (specGaps).
    for (const r of [p, p0, d, d0]) expect(r.unemployment).toBeLessThanOrEqual(0.14);
    expect(Math.abs(p.unemployment - p0.unemployment)).toBeLessThanOrEqual(0.02);
    // Money stays the reward: the denser district ends richer.
    expect(p.funds).toBeGreaterThan(p0.funds);
    expect(d.funds).toBeGreaterThan(d0.funds);
  }, 120_000);
});

// ── MEASURE=1: the tables §11.6 records ─────────────────────────────────────

const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const f3 = (v: number) => v.toFixed(3);

// Each `it` stays well under a minute of synchronous work and yields to the event loop after
// (Vitest's worker RPC times out when its loop is busy for a minute), so the runs are split per
// seed and the tables printed by a last `it`.
describe.skipIf(!MEASURE)('MEASURE: S2 and S4 tables (docs/MEGACITY.md §11.6)', () => {
  afterEach(() => new Promise<void>((r) => setTimeout(r, 20)));
  const ENSEMBLE = [2091, 7, 31, 1, 2, 3, 4, 5, 6, 8, 9, 10];
  type Years = ReturnType<typeof scriptedMayorYears>;
  const runs: { seed: number; v4: Years; cf: Years; dice: Years }[] = [];
  for (const seed of ENSEMBLE)
    it(`S2 ensemble: seed ${seed}`, () => {
      runs.push({ seed, v4: scriptedMayorYears(seed), cf: unitsOnly(() => scriptedMayorYears(seed)), dice: unitsOnly(() => scriptedMayorYears(seed, 8, 1)) });
    }, 120_000);
  it('S2: 12 seeds, the density pass and a dice shift against units alone', () => {
    const row = (k: 'v4' | 'dice', key: 'pop' | 'funds', y: number) => {
      const r = runs.map((x) => x[k][y][key] / x.cf[y][key]);
      return `${f3(mean(r))} [${f3(Math.min(...r))}–${f3(Math.max(...r))}]`;
    };
    const lines = ['year | pop density/units | pop dice/units | funds density/units | funds dice/units'];
    for (let y = 0; y < 8; y++) lines.push(`${y + 1} | ${row('v4', 'pop', y)} | ${row('dice', 'pop', y)} | ${row('v4', 'funds', y)} | ${row('dice', 'funds', y)}`);
    const y8 = (k: 'v4' | 'cf', f: (s: Years[number]) => number) => mean(runs.map((x) => f(x[k][7])));
    lines.push(`y8 traffic ${f3(y8('v4', (s) => s.avgTraffic))} vs ${f3(y8('cf', (s) => s.avgTraffic))}; unemployment ${pct(y8('v4', (s) => s.unemployment))} vs ${pct(y8('cf', (s) => s.unemployment))}; board ${y8('v4', (s) => s.power.board).toFixed(1)} vs ${y8('cf', (s) => s.power.board).toFixed(1)}, basalt ${y8('v4', (s) => s.power.basalt).toFixed(1)} vs ${y8('cf', (s) => s.power.basalt).toFixed(1)}, nacre ${y8('v4', (s) => s.power.nacre).toFixed(1)} vs ${y8('cf', (s) => s.power.nacre).toFixed(1)}`);
    for (const seed of PINNED) {
      const r = againstV3(seed, runs.find((x) => x.seed === seed)!.v4);
      lines.push(`seed ${seed} vs pinned v3: pop ${r.pop.map(f3).join(' ')}; funds ${r.funds.map(f3).join(' ')}`);
    }
    console.log(`S2\n${lines.join('\n')}`);
  });

  const s4: string[] = ['seed variant | build | pop | Hab / Market / Fab land | levels res, com, ind (L1/L2/L3) | unemployment | traffic | LV | board / basalt / nacre | funds'];
  for (const seed of PINNED)
    it(`S4: demand-led mayor, seed ${seed}, plain and downtown`, () => {
      for (const lv of [0, 0.3]) {
        for (const [name, run] of [
          ['density', () => demandLedRun(seed, 12, lv)],
          ['units', () => unitsOnly(() => demandLedRun(seed, 12, lv))],
        ] as const) {
          const y = last(run());
          const L = (a: number[]) => a.join('/');
          s4.push(`${seed} ${lv ? 'downtown' : 'plain'} | ${name} | ${y.pop} | ${pct(y.share.res)} / ${pct(y.share.com)} / ${pct(y.share.ind)} | ${L(y.levels.res)}, ${L(y.levels.com)}, ${L(y.levels.ind)} | ${pct(y.unemployment)} | ${f3(y.avgTraffic)} | ${f3(y.avgLandValue)} | ${y.power.board.toFixed(1)} / ${y.power.basalt.toFixed(1)} / ${y.power.nacre.toFixed(1)} | ${y.funds}`);
        }
      }
    }, 120_000);
  it('S4: the table', () => console.log(`S4\n${s4.join('\n')}`));

  type Harness = Record<StoryPace, Record<string, { chapters: { n: number; tick: number }[] }>>;
  const harness: string[] = ['pace seed | density − v3 (d), Ch1..Ch6 | dice-shifted v3 − v3 (d)'];
  const done = (g: GameT) => g.world.story.chapter >= 7 && !g.story.blocking && !g.world.story.waiting;
  const storyRun = (seed: number, pace: StoryPace, shift: number) => {
    let first = true;
    const { log } = playStory({
      seed,
      years: pace === 'relaxed' ? 62 : 40,
      pace,
      answerPending: 0.5,
      readDelaySec: 20,
      each: (g) => {
        if (first) {
          first = false;
          for (let i = 0; i < shift; i++) g.world.rng.next();
        }
        return done(g);
      },
    });
    return log.chapters.map((c) => c.tick);
  };
  for (const pace of ['relaxed', 'normal', 'brisk'] as const)
    for (const seed of PINNED)
      it(`S2 harness: ${pace}, seed ${seed}`, () => {
        const v3 = (BASELINE as unknown as { harness: Harness }).harness[pace][String(seed)].chapters.map((c) => c.tick);
        const v4 = storyRun(seed, pace, 0);
        const dice = unitsOnly(() => storyRun(seed, pace, 1));
        harness.push(`${pace} ${seed} | ${v4.map((t, i) => t - v3[i]).join(' ')} | ${dice.map((t, i) => t - v3[i]).join(' ')}`);
        // Chapters I–III start on the same day; later ones move only by goal-waiver periods.
        for (let i = 0; i < 3; i++) expect(Math.abs(v4[i] - v3[i]), `${pace} ${seed} Ch${i + 1}`).toBeLessThanOrEqual(30);
      }, 120_000);
  it('S2 harness: the table', () => console.log(`S2 harness\n${harness.join('\n')}`));
});
