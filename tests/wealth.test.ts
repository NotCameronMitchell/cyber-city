// Wealth tiers in the simulation (docs/EXPANSION.md §4; WP-1 acceptance): the score field,
// hysteresis, the latch at development, the one-time settle for old saves, the structural
// invariant of recomputeAll, and the per-tier effects on residents, tax, power and approval.

import { describe, expect, it } from 'vitest';
import { WEALTH, ZONES } from '../src/game/config';
import { Simulation } from '../src/game/sim';
import { FieldSystem } from '../src/game/sim/fields';
import { SimGrid } from '../src/game/sim/grid';
import { GrowthSystem } from '../src/game/sim/growth';
import { PowerGrid } from '../src/game/sim/power';
import { DAYS_PER_MONTH, MAP_SIZE, RoadKind, ZoneType, type SaveData, type WealthTier } from '../src/game/types';
import { potentialTier, tierCap, tierCapAt, wealthScoreAt, zoneCapacity } from '../src/game/wealth';
import { World } from '../src/game/world';
import { ScriptedMayor, act, flatWorld, fullyBuiltWorld, makeSim, run } from './helpers';
import { expansionFixture } from './expansion-fixture';

const N = MAP_SIZE;
const RES = ZoneType.Residential;

/** Growth driven by hand: no field passes, so a test can set fields.wealth itself. */
function rig(w: World) {
  const g = new SimGrid(w);
  g.scan(w, true);
  const power = new PowerGrid();
  power.compute(w, g);
  const growth = new GrowthSystem();
  const fields = new FieldSystem();
  const tick = (demand = { res: 0, com: 0, ind: 0 }) => {
    w.tick++;
    g.scan(w);
    power.compute(w, g);
    growth.run(w, g, power, fields, demand);
  };
  return { g, power, growth, tick };
}

/** A powered street (y = 10) with a solar farm at its west end. */
function street(seed: number): World {
  const w = flatWorld(seed);
  w.addBuilding('solar', 3, 10);
  for (let x = 5; x <= 40; x++) w.setRoad(x, 10);
  return w;
}

describe('wealth score (§4.2)', () => {
  it('fields.wealth equals wealthScoreAt on every zone tile, and 0 elsewhere', () => {
    const w = fullyBuiltWorld();
    expansionFixture(w);
    const sim = makeSim(w);
    run(sim, 40);
    let zoned = 0;
    for (let i = 0; i < N * N; i++) {
      if (w.tiles[i].zone === ZoneType.None) expect(w.fields.wealth[i]).toBe(0);
      else {
        zoned++;
        expect(w.fields.wealth[i]).toBeCloseTo(wealthScoreAt(w, i), 5);
      }
    }
    expect(zoned).toBeGreaterThan(1500);
  });

  it('an Academy lifts the score of nearby homes at once (recomputeAll), before any tier moves', () => {
    const w = street(42);
    w.maxPopulation = 1e6;
    for (let x = 12; x <= 30; x++) {
      w.setZone(x, 11, RES);
      w.setLevel(x, 11, 1);
    }
    const sim = makeSim(w);
    const before = w.fields.wealth[w.idx(20, 11)];
    w.addBuilding('academy', 20, 12);
    sim.recomputeAll();
    expect(w.fields.wealth[w.idx(20, 11)]).toBeGreaterThan(before + WEALTH.score.res.edu * 0.8);
    expect(w.tileAt(20, 11)!.wealth).toBe(0);
  });
});

describe('hysteresis and the latch (§4.3)', () => {
  it('a score oscillating inside the band never moves a tier; a steady one steps after WEALTH.streak samples', () => {
    const w = street(43);
    for (let x = 6; x <= 30; x++) {
      w.setZone(x, 11, RES);
      w.setLevel(x, 11, 1, false, x <= 15 ? 1 : 0);
    }
    const { tick } = rig(w);
    const score = w.fields.wealth;
    for (let t = 0; t < 600; t++) {
      for (let x = 6; x <= 15; x++) score[w.idx(x, 11)] = t % 2 ? WEALTH.down[0] + 0.01 : WEALTH.up[1] - 0.01; // $$ band
      for (let x = 16; x <= 22; x++) score[w.idx(x, 11)] = t % 2 ? 0.05 : WEALTH.up[0] - 0.01; // under $$
      for (let x = 23; x <= 30; x++) score[w.idx(x, 11)] = (WEALTH.up[0] + WEALTH.up[1]) / 2; // steady $$
      tick();
    }
    for (let x = 6; x <= 15; x++) expect(w.tileAt(x, 11)!.wealth).toBe(1);
    for (let x = 16; x <= 22; x++) expect(w.tileAt(x, 11)!.wealth).toBe(0);
    for (let x = 23; x <= 30; x++) expect(w.tileAt(x, 11)!.wealth).toBe(1);
    // No tier change ever abandons a building.
    for (let x = 6; x <= 30; x++) expect(w.tileAt(x, 11)!.abandoned).toBe(false);
  });

  it('a falling block filters down one step at a time, and a cap pulls it down too', () => {
    const w = street(44);
    for (let x = 6; x <= 12; x++) {
      w.setZone(x, 11, RES);
      w.setLevel(x, 11, 2, false, 2);
    }
    const { tick } = rig(w);
    const seen = new Set<number>();
    for (let t = 0; t < 400; t++) {
      for (let x = 6; x <= 12; x++) w.fields.wealth[w.idx(x, 11)] = 0.1;
      tick();
      seen.add(w.tileAt(6, 11)!.wealth);
    }
    expect(w.tileAt(6, 11)!.wealth).toBe(0);
    expect(seen.has(1)).toBe(true);
    // High score but heavy crime: capped at $, the block steps down.
    for (let x = 6; x <= 12; x++) w.setLevel(x, 11, 2, false, 1);
    for (let t = 0; t < 300; t++) {
      for (let x = 6; x <= 12; x++) {
        w.fields.wealth[w.idx(x, 11)] = 0.7;
        w.fields.crime[w.idx(x, 11)] = WEALTH.caps.midMaxCrime + 0.05;
      }
      tick();
    }
    for (let x = 6; x <= 12; x++) expect(w.tileAt(x, 11)!.wealth).toBe(0);
  });

  it('a new lot latches its potential tier, and falls back to what the grid can feed', () => {
    const make = (headroom: number) => {
      const w = street(45);
      for (let x = 6; x <= 17; x++) {
        w.setZone(x, 9, RES);
        w.setLevel(x, 9, 1);
      }
      for (let x = 6; x <= 30; x++) w.setZone(x, 11, RES);
      w.mods.powerSupplyMul = (12 * ZONES.res.power[1] + headroom) / 100;
      const r = rig(w);
      for (let t = 0; t < 120; t++) {
        for (let x = 6; x <= 30; x++) w.fields.wealth[w.idx(x, 11)] = 0.6;
        r.tick({ res: 1, com: 0, ind: 0 });
      }
      const grown: WealthTier[] = [];
      for (let x = 6; x <= 30; x++) if (w.tileAt(x, 11)!.level > 0) grown.push(w.tileAt(x, 11)!.wealth);
      return grown;
    };
    // Plenty of power: every new home opens at $$$.
    const rich = make(1000);
    expect(rich.length).toBeGreaterThan(10);
    expect(rich.every((t) => t === 2)).toBe(true);
    // 1.2 MW spare: $$$ (1.3) can't be fed, $$ (1.1) can; then the grid is full.
    const tight = make(1.2);
    expect(tight).toEqual([1]);
  });

  it('a $$$ Fab stepping down to $$ draws more, so it waits for grid headroom: no brownout (review sim-4)', () => {
    const w = street(48);
    for (let x = 6; x <= 12; x++) {
      w.setZone(x, 11, ZoneType.Industrial);
      w.setLevel(x, 11, 3, false, 2);
    }
    const r = rig(w);
    const solar = 100; // MW before powerSupplyMul
    const fall = (spare: number) => {
      // A plateaued grid: `spare` MW over demand. One Fab step ($$$ 12.6 → $$ 14 MW) needs 1.4.
      w.mods.powerSupplyMul = (r.power.demand + spare) / solar;
      for (let t = 0; t < 300; t++) {
        for (let x = 6; x <= 12; x++) w.fields.wealth[w.idx(x, 11)] = 0;
        r.tick();
        expect(r.power.overloaded).toBe(false);
      }
      let fell = 0;
      for (let x = 6; x <= 12; x++) if (w.tileAt(x, 11)!.wealth < 2) fell++;
      return fell;
    };
    expect(fall(0.5)).toBe(0);
    expect(fall(3)).toBe(2); // room for two steps; those two go on to $ (no extra draw)
    for (let x = 6; x <= 12; x++) expect(w.tileAt(x, 11)!.abandoned).toBe(false);
  });

  it('tier steps draw nothing from world.rng (other rolls never shift)', () => {
    const make = (lift: boolean) => {
      const w = street(46);
      for (let x = 6; x <= 30; x++) {
        w.setZone(x, 11, RES);
        w.setLevel(x, 11, 1);
      }
      const { tick } = rig(w);
      if (lift) {
        for (let x = 6; x <= 30; x++) {
          w.fields.wealth[w.idx(x, 11)] = 0.4;
          w.wealthStreak[w.idx(x, 11)] = WEALTH.streak - 1;
        }
      }
      tick();
      return w;
    };
    const a = make(false);
    const b = make(true);
    expect(b.tiles.some((t) => t.wealth === 1)).toBe(true);
    expect(b.rng.state).toBe(a.rng.state);
  });
});

describe('settleWealth (§4.3)', () => {
  /** A generated-terrain city after a scripted year, saved as a v2 build would (no tiers). */
  function v2City(): SaveData {
    const w = World.generate(4242, 'Old Harbor');
    const sim = makeSim(w);
    const mayor = new ScriptedMayor(w, sim);
    mayor.opening();
    for (let m = 0; m < 12; m++) {
      run(sim, DAYS_PER_MONTH);
      mayor.turn();
    }
    for (let i = 0; i < N * N; i++) w.setWealth(i % N, (i / N) | 0, 0);
    const data = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    data.version = 2;
    delete data.sky;
    delete data.moments;
    return data;
  }

  it('raises an old city in one deterministic call, never above potential, and recomputeAll never moves a tier', () => {
    const data = v2City();
    const settle = () => {
      const w = World.deserialize(JSON.parse(JSON.stringify(data)));
      expect(w.loadedVersion).toBe(2);
      const sim = new Simulation(w);
      sim.recomputeAll();
      for (let k = 0; k < 3; k++) sim.recomputeAll();
      expect(w.tiles.every((t) => t.wealth === 0)).toBe(true);
      const pop = w.stats.population;
      const steps = sim.settleWealth();
      sim.recomputeAll();
      return { w, steps, pop };
    };
    const a = settle();
    const b = settle();
    expect(a.steps).toBeGreaterThan(0);
    expect(b.steps).toBe(a.steps);
    expect(b.w.tiles.map((t) => t.wealth)).toEqual(a.w.tiles.map((t) => t.wealth));
    expect(a.w.stats.wealth[1] + a.w.stats.wealth[2]).toBeGreaterThan(0);
    expect(a.w.stats.population).not.toBe(a.pop);
    // No tile above the tier its score and caps allow (scores as they were when it settled).
    const w = World.deserialize(JSON.parse(JSON.stringify(data)));
    const sim = new Simulation(w);
    sim.recomputeAll();
    sim.settleWealth();
    for (let i = 0; i < N * N; i++) {
      const t = w.tiles[i];
      if (t.zone === ZoneType.None || t.level === 0) continue;
      expect(t.wealth).toBeLessThanOrEqual(potentialTier(t.zone, w.fields.wealth[i], tierCapAt(w, i)));
    }
  });
});

describe('recomputeAll and the structural fields (§2.6)', () => {
  it('never changes terrain, roads, kinds, zones, levels, tiers, abandonment, variants, buildings or ages mid-gentrification', () => {
    const w = fullyBuiltWorld();
    expansionFixture(w);
    const sim = makeSim(w);
    let steps = 0;
    for (let d = 0; d < 240; d++) {
      sim.step();
      steps += (sim as unknown as { growth: GrowthSystem }).growth.tierSteps;
    }
    expect(steps).toBeGreaterThan(0);
    const snap = () =>
      w.tiles.map((t) => [t.terrain, t.road, t.roadKind, t.zone, t.level, t.wealth, t.abandoned, t.variant, t.buildingId, t.age].join());
    const before = snap();
    const sky = Array.from(w.sky);
    sim.recomputeAll();
    sim.recomputeAll();
    expect(snap()).toEqual(before);
    expect(Array.from(w.sky)).toEqual(sky);
  });
});

describe('effects per tier (§4.4)', () => {
  /** Ten L3 Hab Blocks at one tier (or in an affordable quarter), plus a powered street. */
  function homes(tier: WealthTier, alley = false) {
    const w = street(47);
    for (let x = 10; x <= 19; x++) {
      w.setZone(x, 11, RES);
      w.setLevel(x, 11, 3, false, tier);
    }
    if (alley) for (let x = 10; x <= 19; x++) w.setRoad(x, 12, RoadKind.Alley);
    w.mods.approvalAdd = 60; // a jobless test street would read 0 otherwise
    makeSim(w);
    return w;
  }

  it('richer homes hold slightly fewer people, pay clearly more tax and draw more power', () => {
    const a = homes(0);
    const b = homes(1);
    const c = homes(2);
    expect(a.stats.population).toBe(10 * ZONES.res.capacity[3]);
    expect(b.stats.population).toBe(10 * zoneCapacity(RES, 3, 1));
    expect(c.stats.population).toBe(10 * zoneCapacity(RES, 3, 2));
    expect(c.stats.population).toBeLessThan(a.stats.population);
    expect(c.stats.population).toBeGreaterThanOrEqual(a.stats.population * 0.9);
    expect(b.stats.tierEffect.residents).toBe(b.stats.population - a.stats.population);
    expect(a.stats.tierEffect).toEqual({ residents: 0, tax: 0 });
    const tax = (w: World) => w.budget.incomeLines[0].amount;
    expect(tax(b) / tax(a)).toBeGreaterThan(1.12);
    expect(tax(c) / tax(a)).toBeGreaterThan(1.35);
    expect(c.stats.tierEffect.tax).toBeGreaterThan(0);
    expect(c.stats.powerDemand).toBeCloseTo(10 * ZONES.res.power[3] * WEALTH.power[RES][2], 5);
    expect(a.stats.wealth).toEqual([10, 0, 0]);
    expect(c.stats.wealth).toEqual([0, 0, 10]);
    // Prosperity: + WEALTH.approval.prosperity × the share of homes at $$ or better.
    expect(c.stats.approval).toBeGreaterThanOrEqual(a.stats.approval + WEALTH.approval.prosperity - 2);
  });

  it('a $ home beside a back alley is an affordable quarter: +10% residents, and it pays tax on them', () => {
    const plain = homes(0);
    const quarter = homes(0, true);
    expect(quarter.stats.population).toBe(10 * zoneCapacity(RES, 3, 0, true));
    expect(quarter.stats.population).toBeGreaterThan(plain.stats.population);
    expect(quarter.stats.tierEffect.residents).toBe(quarter.stats.population - plain.stats.population);
    // Capped at $$: even a perfect score in a quiet, safe block never makes it $$$.
    expect(quarter.fields.alleyNear[quarter.idx(12, 11)]).toBe(1);
    expect(tierCap(RES, 0, 0, 0, quarter.fields.alleyNear[quarter.idx(12, 11)])).toBe(1);
    expect(tierCap(RES, 0, 0, 0, plain.fields.alleyNear[plain.idx(12, 11)])).toBe(2);
  });

  it('a clean $$$ Fab Yards tile pollutes far less', () => {
    const make = (tier: WealthTier) => {
      const w = street(48);
      for (let x = 10; x <= 19; x++) {
        w.setZone(x, 11, ZoneType.Industrial);
        w.setLevel(x, 11, 3, false, tier);
      }
      makeSim(w);
      return w.fields.pollution[w.idx(15, 11)];
    };
    expect(make(2)).toBeLessThan(make(0) * 0.6);
  });

  it('the starter city stays all $ (B1)', () => {
    const w = flatWorld(31);
    const sim = makeSim(w);
    act(w, 'road', { x: 20, y: 20 }, { x: 36, y: 20 });
    act(w, 'road', { x: 20, y: 24 }, { x: 36, y: 24 });
    act(w, 'road', { x: 20, y: 20 }, { x: 20, y: 28 });
    act(w, 'road', { x: 28, y: 20 }, { x: 28, y: 24 });
    act(w, 'res', { x: 21, y: 21 }, { x: 27, y: 23 });
    act(w, 'com', { x: 29, y: 21 }, { x: 32, y: 23 });
    act(w, 'ind', { x: 21, y: 25 }, { x: 24, y: 27 });
    act(w, 'solar', { x: 35, y: 22 });
    sim.recomputeAll();
    run(sim, DAYS_PER_MONTH * 6);
    expect(w.stats.population).toBeGreaterThan(1500);
    expect(w.stats.wealth[1] + w.stats.wealth[2]).toBe(0);
  });
});
