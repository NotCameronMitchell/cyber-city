// WP-B: every §10.6 read inside the simulation honours world.mods and
// world.layers, stage-aware buildingStats feed census / power / fields /
// budget, the budget appends world.ledger, and the sim pushes the signals the
// director needs. Each test compares a modded world against an identical
// baseline (recomputeAll is deterministic and does not advance time).

import { describe, expect, it } from 'vitest';
import { BUILDINGS, DEFAULT_TAX, ROAD_UPKEEP, STACK_STAGES, ZONES } from '../src/game/config';
import { Simulation } from '../src/game/sim';
import type { Census } from '../src/game/sim/census';
import { IncidentSystem, surgeGang } from '../src/game/sim/incidents';
import { cloneMods } from '../src/game/story/mods';
import type { SimMods } from '../src/game/story/types';
import { DAYS_PER_MONTH, ZoneType, type Fields } from '../src/game/types';
import type { World } from '../src/game/world';
import { flatWorld, makeSim, run } from './helpers';

function block(w: World, z: ZoneType, level: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      w.setZone(x, y, z);
      if (level > 0) w.setLevel(x, y, level);
    }
}

/** A small powered town: reactor, one long street, mixed blocks, a precinct and a plaza. */
function town(seed = 21): World {
  const w = flatWorld(seed);
  w.maxPopulation = 1e6;
  w.addBuilding('reactor', 2, 29);
  for (let x = 5; x <= 58; x++) w.setRoad(x, 30);
  block(w, ZoneType.Residential, 2, 10, 31, 19, 33);
  block(w, ZoneType.Commercial, 2, 20, 31, 25, 32);
  block(w, ZoneType.Industrial, 1, 40, 31, 45, 33);
  block(w, ZoneType.Residential, 1, 10, 27, 19, 29);
  w.addBuilding('precinct', 30, 31);
  w.addBuilding('plaza', 27, 29);
  return w;
}

/** Build the town, apply `mods` / `layers` before the first recomputeAll, return it. */
function modded(patch: Partial<SimMods> = {}, layers?: (w: World) => void, build: (w: World) => void = () => {}): World {
  const w = town();
  build(w);
  Object.assign(w.mods, patch);
  layers?.(w);
  makeSim(w);
  return w;
}

const at = (w: World, f: keyof Fields, x: number, y: number) => w.fields[f][w.idx(x, y)];
const line = (lines: { label: string; amount: number }[], label: string) => lines.find((l) => l.label === label)?.amount;

describe('§10.6 demand and approval', () => {
  it('demand adds shift each zone; taxDemandMul scales the tax term', () => {
    const base = modded();
    const plus = modded({ demandInd: 0.2, demandCom: -0.3, demandRes: 0.3 });
    expect(plus.stats.demand.ind).toBeGreaterThan(base.stats.demand.ind);
    expect(plus.stats.demand.com).toBeLessThan(base.stats.demand.com);
    expect(plus.stats.demand.res).toBeGreaterThan(base.stats.demand.res);

    const taxed = (mul: number) => modded({ taxDemandMul: mul }, undefined, (w) => (w.taxRate = 18));
    const full = taxed(1);
    const half = taxed(0.5);
    // At 18% the tax term is negative; halving it raises every demand.
    expect(half.stats.demand.ind).toBeGreaterThan(full.stats.demand.ind);
    expect(half.stats.demand.com).toBeGreaterThan(full.stats.demand.com);
  });

  it('approvalAdd adds to approval, clamped to 0..100', () => {
    const base = modded();
    const up = modded({ approvalAdd: 10 });
    expect(up.stats.approval).toBe(Math.min(100, base.stats.approval + 10));
    expect(modded({ approvalAdd: -200 }).stats.approval).toBe(0);
  });
});

describe('§10.6 fields', () => {
  it('crimeMul and crimeAdd move crime city-wide; layers.crimeAdd only its own tile', () => {
    const base = modded();
    expect(modded({ crimeMul: 2 }).stats.avgCrime).toBeGreaterThan(base.stats.avgCrime);
    const add = modded({ crimeAdd: 0.1 });
    expect(at(add, 'crime', 15, 32)).toBeCloseTo(Math.min(1, at(base, 'crime', 15, 32) + 0.1), 1);

    const i = base.idx(15, 32);
    const layered = modded({}, (w) => (w.layers.crimeAdd[i] = 0.2));
    expect(layered.fields.crime[i]).toBeGreaterThan(base.fields.crime[i] + 0.15);
    expect(at(layered, 'crime', 12, 32)).toBe(at(base, 'crime', 12, 32));
  });

  it('pollutionMul scales the final pollution before the clamp', () => {
    const base = modded();
    const p = modded({ pollutionMul: 1.5 });
    const b = at(base, 'pollution', 42, 32);
    expect(b).toBeGreaterThan(0.05);
    expect(at(p, 'pollution', 42, 32)).toBeCloseTo(Math.min(1, b * 1.5), 5);
    expect(at(modded({ pollutionMul: 0.25 }), 'pollution', 42, 32)).toBeCloseTo(b * 0.25, 5);
  });

  it('landValueAdd and layers.lvAdd raise land value before the clamp', () => {
    const base = modded();
    expect(modded({ landValueAdd: 0.1 }).stats.avgLandValue).toBeGreaterThan(base.stats.avgLandValue + 0.05);
    const i = base.idx(50, 50); // open land far from everything
    const layered = modded({}, (w) => (w.layers.lvAdd[i] = 0.2));
    expect(layered.fields.landValue[i]).toBeGreaterThan(base.fields.landValue[i] + 0.15);
    expect(at(layered, 'landValue', 52, 52)).toBe(at(base, 'landValue', 52, 52));
  });

  it('securityMul scales precinct coverage (clamped to 1)', () => {
    const base = modded();
    const half = modded({ securityMul: 0.5 });
    const b = at(base, 'security', 30, 31);
    expect(b).toBeGreaterThan(0.8);
    expect(at(half, 'security', 30, 31)).toBeCloseTo(b * 0.5, 5);
    const quad = modded({ securityMul: 4 });
    expect(at(quad, 'security', 30, 31)).toBe(1);
    expect(Math.max(...quad.fields.security)).toBeLessThanOrEqual(1);
  });

  it('layers.transitAdd is max-combined into transit and cuts trips', () => {
    const base = modded();
    const lifted = modded({}, (w) => {
      for (let y = 31; y <= 33; y++) for (let x = 10; x <= 19; x++) w.layers.transitAdd[w.idx(x, y)] = 0.8;
    });
    expect(at(base, 'transit', 15, 32)).toBe(0);
    expect(at(lifted, 'transit', 15, 32)).toBeCloseTo(0.8, 5);
    expect(at(lifted, 'traffic', 15, 30)).toBeLessThan(at(base, 'traffic', 15, 30));
  });

  it('trafficMul and layers.tripMul scale each trip source', () => {
    const base = modded();
    const b = at(base, 'traffic', 15, 30);
    expect(b).toBeGreaterThan(0.05);
    expect(at(modded({ trafficMul: 0.5 }), 'traffic', 15, 30)).toBeLessThan(b);
    expect(at(modded({ trafficMul: 2 }), 'traffic', 15, 30)).toBeGreaterThan(b);
    const silent = modded({}, (w) => w.layers.tripMul.fill(0));
    expect(Math.max(...silent.fields.traffic)).toBe(0);
  });
});

describe('§10.6 power', () => {
  it('powerSupplyMul scales plant output; powerDemandMul scales every draw', () => {
    const base = modded();
    expect(modded({ powerSupplyMul: 0.5 }).stats.powerSupply).toBeCloseTo(base.stats.powerSupply * 0.5, 6);
    expect(modded({ powerDemandMul: 2 }).stats.powerDemand).toBeCloseTo(base.stats.powerDemand * 2, 6);
  });

  it('a starved grid browns out: powerSupplyMul can black out a town', () => {
    const w = flatWorld(3);
    w.addBuilding('solar', 2, 29);
    for (let x = 4; x <= 40; x++) w.setRoad(x, 30);
    block(w, ZoneType.Industrial, 3, 5, 31, 30, 33);
    makeSim(w);
    const dark = w.stats.unpoweredTiles;
    w.mods.powerSupplyMul = 4;
    new Simulation(w).recomputeAll();
    expect(w.stats.unpoweredTiles).toBeLessThan(dark);
  });
});

describe('§10.6 growth', () => {
  function lots(mods: Partial<SimMods>, layers?: (w: World) => void): World {
    const w = flatWorld(8);
    w.addBuilding('reactor', 2, 29);
    for (let x = 5; x <= 58; x++) w.setRoad(x, 30);
    block(w, ZoneType.Residential, 0, 6, 31, 40, 33);
    block(w, ZoneType.Commercial, 0, 6, 27, 20, 29);
    Object.assign(w.mods, mods);
    layers?.(w);
    const sim = makeSim(w);
    run(sim, 12);
    return w;
  }
  const developed = (w: World) => w.stats.developed.res + w.stats.developed.com;

  it('growthMul scales grow chances', () => {
    const slow = developed(lots({ growthMul: 0.25 }));
    const normal = developed(lots({}));
    const fast = developed(lots({ growthMul: 4 }));
    expect(slow).toBeLessThan(normal);
    expect(fast).toBeGreaterThan(normal);
  });

  it('abandonMul and layers.abandonMul scale abandonment', () => {
    // Developed tiles with no road anywhere near abandon at ABANDON_NO_ROAD per evaluation.
    const make = (mods: Partial<SimMods>, layers?: (w: World) => void) => {
      const w = flatWorld(9);
      w.addBuilding('reactor', 2, 2);
      block(w, ZoneType.Residential, 2, 20, 20, 39, 29);
      Object.assign(w.mods, mods);
      layers?.(w);
      run(makeSim(w), 6);
      return w.stats.abandonedTiles;
    };
    const low = make({ abandonMul: 0.25 });
    const high = make({ abandonMul: 4 });
    expect(low).toBeLessThan(high);
    // A zero layer means those tiles never abandon.
    expect(make({}, (w) => w.layers.abandonMul.fill(0))).toBe(0);
  });
});

describe('§10.6 budget', () => {
  it('layers.taxMul and taxIncomeMul scale the tax lines', () => {
    const base = modded();
    const taxBase = base.budget.incomeLines.map((l) => l.amount);
    expect(taxBase[0]).toBeGreaterThan(10);
    const twice = modded({ taxIncomeMul: 2 }).budget.incomeLines.map((l) => l.amount);
    twice.forEach((v, k) => expect(Math.abs(v - 2 * taxBase[k])).toBeLessThanOrEqual(1));
    const untaxed = modded({}, (w) => w.layers.taxMul.fill(0)).budget;
    expect(untaxed.incomeLines.every((l) => l.amount === 0)).toBe(true);
    const halfRes = modded({}, (w) => {
      for (let y = 27; y <= 33; y++) for (let x = 10; x <= 19; x++) w.layers.taxMul[w.idx(x, y)] = 0.5;
    }).budget;
    expect(Math.abs(halfRes.incomeLines[0].amount - taxBase[0] / 2)).toBeLessThanOrEqual(1);
    expect(halfRes.incomeLines[1].amount).toBe(taxBase[1]);
  });

  it('upkeepMul scales every expense line; upkeepMulType one type', () => {
    const base = modded();
    const roads = Math.round(54 * ROAD_UPKEEP);
    expect(line(base.budget.expenseLines, 'Roads')).toBe(roads);
    const twice = modded({ upkeepMul: 2 }).budget;
    expect(line(twice.expenseLines, 'Roads')).toBe(Math.round(54 * ROAD_UPKEEP * 2));
    expect(line(twice.expenseLines, 'Power plants')).toBe(BUILDINGS.reactor.upkeep * 2);
    const typed = modded({ upkeepMulType: { precinct: 1.5 } }).budget;
    expect(line(typed.expenseLines, 'Enforcer Precincts')).toBe(BUILDINGS.precinct.upkeep * 1.5);
    expect(line(typed.expenseLines, 'Power plants')).toBe(BUILDINGS.reactor.upkeep);
  });

  it('appends world.ledger lines grouped by label, and settles them', () => {
    const w = town();
    w.ledger.income.push(
      { label: 'Off-ledger', amount: 100 },
      { label: 'Civic Bond', amount: 0 },
      { label: 'Off-ledger', amount: 60.4 },
    );
    w.ledger.expense.push({ label: 'Skybridges', amount: 45 }, { label: 'Civic Bond', amount: 450 }, { label: 'Odd', amount: -20 });
    const sim = makeSim(w);
    const b = w.budget;
    expect(line(b.incomeLines, 'Off-ledger')).toBe(160);
    expect(b.incomeLines.filter((l) => l.label === 'Off-ledger').length).toBe(1);
    expect(line(b.incomeLines, 'Civic Bond')).toBeUndefined();
    expect(line(b.expenseLines, 'Skybridges')).toBe(45);
    expect(line(b.expenseLines, 'Civic Bond')).toBe(450);
    expect(line(b.incomeLines, 'Odd')).toBe(20); // a negative expense is income
    const sum = (ls: { amount: number }[]) => ls.reduce((s, l) => s + l.amount, 0);
    expect(b.income).toBe(sum(b.incomeLines));
    expect(b.expenses).toBe(sum(b.expenseLines));
    run(sim, DAYS_PER_MONTH - (w.tick % DAYS_PER_MONTH));
    expect(w.budget.history[w.budget.history.length - 1]).toBe(w.budget.income - w.budget.expenses);
  });

  it('clamps the tax rate to mods.taxCap at the month end', () => {
    const w = town();
    w.taxRate = 18;
    const sim = makeSim(w);
    w.mods.taxCap = 12;
    run(sim, 5);
    expect(w.taxRate).toBe(18); // not mid-month
    run(sim, DAYS_PER_MONTH);
    expect(w.taxRate).toBe(12);
    w.mods.taxCap = 20;
    run(sim, DAYS_PER_MONTH);
    expect(w.taxRate).toBe(12); // never raised back
    expect(DEFAULT_TAX).toBeLessThanOrEqual(12);
  });
});

describe('§10.6 incidents', () => {
  it('eventRateMul divides the interval to the next incident', () => {
    const gap = (rate: number) => {
      const w = flatWorld(77);
      w.mods.eventRateMul = rate;
      const inc = new IncidentSystem();
      const census = { population: 0 } as Census;
      inc.update(w, {} as never, {} as never, census, true); // schedules the first roll
      w.tick = inc.nextTick;
      inc.update(w, {} as never, {} as never, census, true); // schedules the next one
      return inc.nextTick - w.tick;
    };
    const g1 = gap(1);
    expect(g1).toBeGreaterThanOrEqual(60);
    expect(gap(4)).toBe(Math.round(g1 / 4));
    expect(gap(0.5)).toBe(g1 * 2);
  });
});

describe('stage-aware buildings in the sim', () => {
  function withStack(stage: 1 | 2 | 3, buildDays: number, crown?: 'commons' | 'foundry'): World {
    const w = town();
    const b = w.addBuilding('stack', 34, 31)!;
    w.setStage(b, stage, buildDays, crown);
    makeSim(w);
    return w;
  }

  it('a Stratablock under scaffolding adds nothing; complete stages add jobs, homes and power draw', () => {
    const base = modded();
    const scaffold = withStack(1, 60);
    expect(scaffold.stats.jobsCom).toBe(base.stats.jobsCom);
    expect(scaffold.stats.powerDemand).toBe(base.stats.powerDemand);
    expect(line(scaffold.budget.expenseLines, 'Stratablocks')).toBeUndefined();

    const plinth = withStack(1, 0);
    expect(plinth.stats.jobsCom).toBe(base.stats.jobsCom + STACK_STAGES[0].jobsCom);
    expect(plinth.stats.jobsInd).toBe(base.stats.jobsInd + STACK_STAGES[0].jobsInd);
    expect(plinth.stats.powerDemand).toBe(base.stats.powerDemand + STACK_STAGES[0].power);
    expect(line(plinth.budget.expenseLines, 'Stratablocks')).toBe(STACK_STAGES[0].upkeep);

    const core = withStack(2, 0);
    expect(core.stats.population).toBe(base.stats.population + STACK_STAGES[1].res);
    // Stratablock residents and jobs are taxed (the landmark rule).
    expect(core.budget.incomeLines[0].amount).toBeGreaterThan(base.budget.incomeLines[0].amount);
  });

  it('crowns: Commons adds homes and prestige coverage; Foundry adds Fab jobs and smoke', () => {
    const base = modded();
    const commons = withStack(3, 0, 'commons');
    expect(commons.stats.population).toBe(base.stats.population + 1600 + 400 + 600);
    expect(at(commons, 'prestige', 36, 33)).toBeGreaterThan(0.8);
    const foundry = withStack(3, 0, 'foundry');
    expect(foundry.stats.jobsInd).toBe(base.stats.jobsInd + 100 + 250);
    expect(at(foundry, 'pollution', 36, 33)).toBeGreaterThan(at(base, 'pollution', 36, 33));
  });

  it('an unpowered Stratablock houses and employs nobody but still asks for power', () => {
    const w = flatWorld(4);
    const b = w.addBuilding('stack', 20, 20)!;
    w.setStage(b, 2, 0);
    makeSim(w);
    expect(b.powered).toBe(false);
    expect(w.stats.population).toBe(0);
    expect(w.stats.jobsCom).toBe(0);
  });

  it('faction buildings simulate: Foundry supplies power, Tidemarket jobs count but are untaxed', () => {
    const w = flatWorld(6);
    w.addBuilding('foundry', 2, 29);
    for (let x = 5; x <= 30; x++) w.setRoad(x, 30);
    block(w, ZoneType.Residential, 2, 6, 31, 15, 33);
    makeSim(w);
    expect(w.stats.powerSupply).toBe(BUILDINGS.foundry.powerSupply);
    expect(w.stats.jobsInd).toBe(BUILDINGS.foundry.jobs);
    expect(line(w.budget.expenseLines, 'Power plants')).toBe(BUILDINGS.foundry.upkeep);

    const before = w.stats.jobsCom;
    w.addBuilding('tidemarket', 20, 31);
    w.addBuilding('roost', 23, 31);
    const sim = new Simulation(w);
    sim.recomputeAll();
    expect(w.stats.jobsCom).toBe(before + BUILDINGS.tidemarket.jobs);
    expect(line(w.budget.expenseLines, 'Tidemarkets')).toBeUndefined(); // no upkeep, no line
    expect(at(w, 'net', 23, 32)).toBeGreaterThan(0.5); // the roost's relay
    expect(w.budget.incomeLines[1].label).toBe(`${ZONES.com.name} tax`);
  });
});

describe('signals', () => {
  it('milestones push a milestone signal', () => {
    const w = town();
    const sim = makeSim(w);
    sim.step();
    expect(w.signals).toContainEqual({ t: 'milestone', pop: 100 });
  });

  it('corp grants push a corpGrant signal', () => {
    const w = town();
    const inc = new IncidentSystem();
    const funds = w.funds;
    (inc as unknown as { corpGrant(w: World, c: Census): void }).corpGrant(w, { population: 2000 } as Census);
    const s = w.signals.find((x) => x.t === 'corpGrant');
    expect(s).toEqual({ t: 'corpGrant', amount: w.funds - funds });
  });

  it('gang surges name a seeded gang from plain turf data and push gangSurge', () => {
    const w = town();
    expect(surgeGang(w, 15, 32)).toBeNull();
    w.turf.seeded.undertow = true;
    w.turf.seeded.kites = true;
    w.turf.owner[w.idx(20, 36)] = 2;
    w.turf.owner[w.idx(15, 40)] = 1;
    expect(surgeGang(w, 15, 32)).toBe('kites'); // Chebyshev 5 beats 8
    expect(surgeGang(w, 15, 39)).toBe('undertow');
    w.turf.owner.fill(0);
    expect(['undertow', 'kites']).toContain(surgeGang(w, 15, 32)); // none nearby: a random seeded gang

    w.turf.seeded.kites = false;
    w.turf.owner[w.idx(14, 31)] = 1;
    const sim = makeSim(w) as unknown as { incidents: object; grid: object; fields: object };
    const inc = sim.incidents as { gangSurge(w: World, g: object, f: object): void };
    const before = w.news.length;
    inc.gangSurge(w, sim.grid, sim.fields);
    const sig = w.signals.find((x) => x.t === 'gangSurge');
    expect(sig).toMatchObject({ t: 'gangSurge', gang: 'undertow' });
    expect(w.news.slice(before).some((n) => n.text.includes('Undertow'))).toBe(true);
  });

  it('unlock news skips gated story buildings', () => {
    const w = town();
    w.maxPopulation = 0;
    const sim = makeSim(w);
    w.maxPopulation = 1e6;
    sim.step();
    const texts = w.news.map((n) => n.text);
    expect(texts.some((t) => t.startsWith(`Unlocked: ${BUILDINGS.arcology.name}`))).toBe(true);
    expect(texts.some((t) => t.startsWith(`Unlocked: ${BUILDINGS.stack.name}`))).toBe(false);
    expect(texts.some((t) => t.startsWith(`Unlocked: ${BUILDINGS.foundry.name}`))).toBe(false);
  });
});

describe('identity mods', () => {
  it('explicit identity mods and layers reproduce the sandbox exactly', () => {
    const a = town();
    const b = town();
    b.mods = cloneMods();
    const sa = makeSim(a);
    const sb = makeSim(b);
    run(sa, 75);
    run(sb, 75);
    expect(b.stats).toEqual(a.stats);
    expect(b.budget).toEqual(a.budget);
    expect(Array.from(b.fields.crime)).toEqual(Array.from(a.fields.crime));
  });
});

describe('layering', () => {
  it('the sim imports no story logic (only the pure story/types, mods and state leaves)', () => {
    const sources = import.meta.glob(['../src/game/sim.ts', '../src/game/buildingStats.ts', '../src/game/sim/*.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(8);
    const allowed = /story\/(types|mods|state)['"]/;
    for (const [f, src] of Object.entries(sources)) {
      for (const l of src.split('\n').filter((x) => /^import .*story\//.test(x))) expect(l, `${f}: ${l}`).toMatch(allowed);
    }
  });
});
