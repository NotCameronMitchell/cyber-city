// Ports in the simulation (docs/EXPANSION.md §5, §6.3; WP-1 acceptance): demand adds, income
// lines, visitors, the Spaceport countdown with its real-time hold, opening moments, and the
// determinism of the expansion fixture.

import { describe, expect, it } from 'vitest';
import { AIRPORT, BUILDINGS, SEAPORT, SPACEPORT, TOURISM } from '../src/game/config';
import type { GameEventMap } from '../src/game/events';
import type { Census } from '../src/game/sim/census';
import { DAYS_PER_MONTH, LEGACY_SIZE, ZoneType } from '../src/game/types';
import { World } from '../src/game/world';
import { flatWorld, fullyBuiltWorld, makeSim, run, startWorld } from './helpers';
import { expansionFixture, playExpansion } from './expansion-fixture';

const N = LEGACY_SIZE;

/**
 * A powered town with jobs and homes, plus whichever ports `add` places (all touching the grid). `o` offsets it into
 * the start slot of the frame `make` builds (0 on the legacy 64 frame, 64 on a 3×3 region).
 */
function town(add: (w: World) => void = () => {}, make: () => World = () => flatWorld(51), o = 0) {
  const w = make();
  w.maxPopulation = 1e6;
  w.addBuilding('reactor', o + 2, o + 10);
  w.addBuilding('reactor', o + 2, o + 13);
  for (let x = 5; x <= 60; x++) w.setRoad(o + x, o + 10);
  for (let x = 6; x <= 58; x++) {
    w.setZone(o + x, o + 11, ZoneType.Residential);
    w.setLevel(o + x, o + 11, 3);
    w.setZone(o + x, o + 9, ZoneType.Industrial);
    w.setLevel(o + x, o + 9, 2);
    w.setZone(o + x, o + 8, ZoneType.Commercial);
    w.setLevel(o + x, o + 8, 2);
  }
  add(w);
  const sim = makeSim(w);
  return { w, sim };
}

/** The legacy 64 frame and the start slot of a 3×3 region (MEGACITY §11.5): O1 makes them equal. */
const FRAMES: [string, () => World, number][] = [
  ['64 frame', () => flatWorld(51), 0],
  ['3×3 start slot', () => startWorld(3, 51), 64],
];

const line = (w: World, label: string) => w.budget.incomeLines.find((l) => l.label === label)?.amount ?? 0;
const census = (sim: unknown) => (sim as { census: Census }).census;

describe.each(FRAMES)('port effects (§5, %s)', (_frame, make, o) => {
  const town2 = (add?: (w: World) => void) => town(add, make, o);
  it('a Seaport adds Fab demand and the "Port trade" line; offline it adds nothing', () => {
    const none = town2();
    const sea = town2((w) => w.addBuilding('seaport', o + 20, o + 12));
    expect(sea.sim.ports.exportJobs).toBe(SEAPORT.exportJobs);
    expect(none.sim.ports.exportJobs).toBe(0);
    expect(census(sea.sim).tradeInd).toBeGreaterThanOrEqual(SEAPORT.exportJobs);
    // Same jobs, no export trade: the same port offline (from the first recompute).
    const idle = town2((w) => (w.addBuilding('seaport', o + 20, o + 12)!.offline = 99));
    expect(sea.w.stats.demand.ind).toBeGreaterThan(idle.w.stats.demand.ind + 0.05);
    const port = sea.w.buildingAt(o + 20, o + 12)!;
    const expected = Math.round(Math.min(SEAPORT.tradeCap, SEAPORT.tradeRate * sea.w.stats.jobsInd * census(sea.sim).jobFill));
    expect(sea.sim.ports.tradeFor(port.id)).toBe(expected);
    expect(line(sea.w, 'Port trade')).toBe(expected);
    expect(line(none.w, 'Port trade')).toBe(0);
    expect(none.w.budget.incomeLines.length).toBe(3);
    expect(sea.w.budget.expenseLines.some((l) => l.label === 'Seaports')).toBe(true);
    port.offline = 20;
    sea.sim.recomputeAll();
    expect(sea.sim.ports.exportJobs).toBe(0);
    expect(line(sea.w, 'Port trade')).toBe(0);
  });

  it('at most two Seaports count toward demand', () => {
    const { sim } = town2((w) => {
      w.addBuilding('seaport', o + 14, o + 12);
      w.addBuilding('seaport', o + 20, o + 12);
      w.addBuilding('seaport', o + 26, o + 12);
    });
    expect(sim.ports.exportJobs).toBe(SEAPORT.exportJobs * SEAPORT.maxCounted);
  });

  it('an Airport adds Market demand, visitors and "Tourism"; its jobs are taxed like a landmark', () => {
    const none = town2();
    const air = town2((w) => w.addBuilding('airport', o + 30, o + 12));
    expect(air.sim.ports.comJobs).toBe(AIRPORT.comJobs);
    const idle = town2((w) => (w.addBuilding('airport', o + 30, o + 12)!.offline = 99));
    expect(air.w.stats.demand.com).toBeGreaterThan(idle.w.stats.demand.com + 0.05);
    expect(idle.sim.ports.visitors).toBe(0);
    const c = census(air.sim);
    const mood = Math.min(TOURISM.moodMax, Math.max(TOURISM.moodMin, air.w.stats.approval / TOURISM.approvalRef)) * (1 - TOURISM.crimeHit * c.avgCrime);
    expect(air.sim.ports.visitors).toBeGreaterThan(0);
    expect(Math.abs(air.sim.ports.visitors - TOURISM.airport * mood)).toBeLessThan(TOURISM.airport * 0.05);
    expect(air.w.stats.visitors).toBe(air.sim.ports.visitors);
    expect(line(air.w, 'Tourism')).toBe(Math.round(air.sim.ports.visitors * TOURISM.spend));
    expect(line(air.w, 'Market Strip tax')).toBeGreaterThan(line(none.w, 'Market Strip tax'));
  });

  it('a complete Spaceport adds both demands, "Launch contracts" and visitors; under construction it adds nothing', () => {
    const { w, sim } = town2((v) => {
      const b = v.addBuilding('spaceport', o + 30, o + 12)!;
      b.buildDays = 10;
    });
    const sp = w.buildingAt(o + 30, o + 12)!;
    expect(sim.ports.comJobs).toBe(0);
    expect(line(w, 'Launch contracts')).toBe(0);
    expect(w.budget.expenseLines.some((l) => l.label === 'Spaceports')).toBe(false);
    sp.buildDays = 0;
    sim.recomputeAll();
    expect(sim.ports.comJobs).toBe(SPACEPORT.comJobs);
    expect(sim.ports.indJobs).toBe(SPACEPORT.indJobs);
    expect(line(w, 'Launch contracts')).toBe(SPACEPORT.income);
    expect(sim.ports.visitors).toBeGreaterThan(TOURISM.spaceport * TOURISM.moodMin * 0.5);
    expect(w.budget.expenseLines.find((l) => l.label === 'Spaceports')!.amount).toBe(BUILDINGS.spaceport.upkeep);
  });
});

describe('the Spaceport countdown (§5.3)', () => {
  it('counts buildDays down daily but holds at 1 while waitSec > 0; finishes with news, sound and one moment', () => {
    const { w, sim } = town((v) => v.addBuilding('spaceport', 30, 12));
    const sp = w.buildingAt(30, 12)!;
    sp.buildDays = BUILDINGS.spaceport.buildDays;
    sp.waitSec = SPACEPORT.minBuildSec;
    const moments: GameEventMap['moment'][] = [];
    const sfx: string[] = [];
    const tiles: GameEventMap['tiles'][] = [];
    w.events.on('moment', (m) => moments.push(m));
    w.events.on('sfx', (s) => sfx.push(s));
    w.events.on('tiles', (t) => tiles.push(t));
    expect(sim.ports.buildProgress(sp.id)).toBe(0);
    run(sim, 300);
    expect(sp.buildDays).toBe(1); // the days are done; the real-time floor is not
    expect(sim.ports.buildProgress(sp.id)).toBe(0);
    expect(moments).toEqual([]);
    // Game counts waitSec down in real time; the art steps at ⅓ and ⅔ of the slower clock.
    const footprint = () => tiles.filter((t) => t.x0 <= sp.x && t.x1 >= sp.x + 5 && t.y0 <= sp.y && t.y1 >= sp.y + 5).length;
    const at0 = footprint();
    sp.waitSec = SPACEPORT.minBuildSec * 0.6;
    run(sim, 1);
    expect(footprint()).toBe(at0 + 1);
    expect(sim.ports.buildProgress(sp.id)).toBeCloseTo(0.4, 5);
    sp.waitSec = 0;
    run(sim, 1);
    expect(sp.buildDays).toBe(0);
    expect(sim.ports.buildProgress(sp.id)).toBe(1);
    expect(w.news.some((n) => n.text === `The ${w.cityName} Spaceport is finished. The first launch goes up on the next clear night.`)).toBe(true);
    expect(sfx).toContain('milestone');
    expect(moments.map((m) => m.id)).toEqual(['spaceport']);
    expect(moments[0].title).toBe('SPACEPORT COMPLETE');
    expect(w.moments.has('spaceport')).toBe(true);
    run(sim, 2);
    expect(sim.ports.comJobs).toBe(SPACEPORT.comJobs);
  });

  it('with no waitSec (headless) it is a plain 240-day build', () => {
    const { w, sim } = town((v) => v.addBuilding('spaceport', 30, 12));
    const sp = w.buildingAt(30, 12)!;
    sp.buildDays = BUILDINGS.spaceport.buildDays;
    run(sim, BUILDINGS.spaceport.buildDays! - 1);
    expect(sp.buildDays).toBe(1);
    run(sim, 1);
    expect(sp.buildDays).toBe(0);
  });
});

describe('opening moments (§5.4)', () => {
  it('each port moment fires once per city and is saved', () => {
    const { w, sim } = town((v) => {
      v.addBuilding('seaport', 14, 12);
      v.addBuilding('airport', 30, 12);
    });
    const moments: GameEventMap['moment'][] = [];
    w.events.on('moment', (m) => moments.push(m));
    run(sim, 3);
    expect(moments.map((m) => m.id).sort()).toEqual(['airport', 'seaport']);
    expect(moments.find((m) => m.id === 'seaport')!.title).toBe('SEAPORT OPEN');
    expect(moments.find((m) => m.id === 'airport')!.title).toBe('AIRPORT OPEN');
    // A second seaport opening later: no second banner.
    w.addBuilding('seaport', 20, 12);
    run(sim, 3);
    expect(moments.length).toBe(2);
    // recomputeAll never announces; a reloaded city remembers.
    const l = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const again: string[] = [];
    l.events.on('moment', (m) => again.push(m.id));
    const s2 = makeSim(l);
    run(s2, 3);
    expect(again).toEqual([]);
  });
});

describe('the expansion fixture (§10.4)', () => {
  it('has the shape the spec asks for', () => {
    const w = fullyBuiltWorld();
    const fx = expansionFixture(w);
    expect(fx.highway.length).toBe(60);
    expect(fx.ramps.length).toBe(8);
    expect(fx.sky).toBe(300);
    expect(fx.academies.length).toBe(2);
    expect(fx.seaport.facing).toBe(2);
    let sky = 0;
    for (const v of w.sky) if (v) sky++;
    expect(sky).toBe(300);
    const sim = makeSim(w);
    const g = (sim as unknown as { grid: { dockOf: Map<number, number>; hwRamps: Int32Array; hwCompCount: number } }).grid;
    expect(g.dockOf.size).toBeGreaterThanOrEqual(5);
    expect(g.hwCompCount).toBe(1);
    expect(g.hwRamps[0]).toBe(8);
    for (const b of [fx.seaport, fx.airport, fx.spaceport]) expect(b.powered).toBe(true);
  });

  it('two identical runs give identical tiles, funds and stats', () => {
    const play = () => {
      const w = fullyBuiltWorld();
      expansionFixture(w);
      const sim = makeSim(w, true);
      run(sim, DAYS_PER_MONTH * 6);
      return w;
    };
    const a = play();
    const b = play();
    expect(b.funds).toBe(a.funds);
    expect(JSON.stringify(b.stats)).toBe(JSON.stringify(a.stats));
    expect(b.serialize().tiles).toEqual(a.serialize().tiles);
    expect(Array.from(b.fields.wealth)).toEqual(Array.from(a.fields.wealth));
    expect(a.stats.wealth[1] + a.stats.wealth[2]).toBeGreaterThan(0);
    expect(a.stats.visitors).toBeGreaterThan(0);
    void N;
  });

  it('ExpansionMayor applies its options (avenues, a ramped highway ring, back alleys, an airport on a lifted lock)', () => {
    const w = flatWorld(2091);
    w.funds = 100000; // the ring costs ~10,000 CR; a scripted town rarely has that by year 3
    const { sim } = playExpansion(w, 3, { avenues: true, highwayRing: true, alleys: true, airport: 1, liftLocks: [{ year: 1, pop: 120_000 }] });
    const r = w.stats.roads;
    expect(r.avenue).toBeGreaterThan(10);
    expect(r.highway).toBeGreaterThan(40);
    expect(r.ramp).toBeGreaterThanOrEqual(4);
    expect(r.alley).toBeGreaterThan(0);
    const air = [...w.buildings.values()].find((b) => b.type === 'airport');
    expect(air?.powered).toBe(true);
    expect(sim.ports.comJobs).toBe(AIRPORT.comJobs);
    expect(w.stats.population).toBeGreaterThan(10000);
  });
});
