// Simulation of road kinds, skyways, noise and the regional links (docs/EXPANSION.md §3.3,
// §3.7–§3.10; WP-1 acceptance).

import { describe, expect, it } from 'vitest';
import { BUILDINGS, NOISE, ROAD_KINDS, SKYWAY, ZONES } from '../src/game/config';
import { Simulation } from '../src/game/sim';
import type { FieldSystem } from '../src/game/sim/fields';
import { SimGrid } from '../src/game/sim/grid';
import * as Tuning from '../src/game/sim/tuning';
import { SKY_E, SKY_RAMP, SKY_W } from '../src/game/skyway';
import { LEGACY_SIZE, RoadKind, ZoneType } from '../src/game/types';
import { World } from '../src/game/world';
import { Advisor } from '../src/game/sim/advisor';
import { Census } from '../src/game/sim/census';
import { PowerGrid } from '../src/game/sim/power';
import { ScriptedMayor, flatWorld, makeSim } from './helpers';
import { run as tiles, skyPath } from './expansion-fixture';
import { LEGACY_REGION } from '../src/game/types';
import { toV3 } from './legacy-save';

const N = LEGACY_SIZE;
const AREA = N * N;
const { Street: S, Avenue: A, Highway: H, Alley: L, Ramp: R } = RoadKind;

/** The private systems, for white-box checks. */
const inner = (sim: Simulation) => sim as unknown as { grid: SimGrid; fields: FieldSystem };

function block(w: World, z: ZoneType, level: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      w.setZone(x, y, z);
      w.setLevel(x, y, level);
    }
}

const at = (w: World, f: 'traffic' | 'noise' | 'hub' | 'sea' | 'education' | 'crime' | 'landValue' | 'skyTraffic', x: number, y: number) =>
  w.fields[f][y * N + x];

/** Pre-expansion traffic (copied from the old FieldSystem.traffic): every road one kind, capacity 220. */
function oldTraffic(w: World): Float32Array {
  const road = new Uint8Array(AREA);
  for (let i = 0; i < AREA; i++) road[i] = w.tiles[i].road ? 1 : 0;
  // The old SimGrid BFS: 8-neighbour from every road, range 3, first claim wins.
  const dist = new Uint8Array(AREA).fill(255);
  const near = new Int32Array(AREA).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < AREA; i++) if (road[i]) {
    dist[i] = 0;
    near[i] = i;
    q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (dist[i] >= 3) continue;
    const x = i % N;
    const y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (dist[j] !== 255) continue;
        dist[j] = dist[i] + 1;
        near[j] = near[i];
        q.push(j);
      }
  }
  const cap = [[0, 0, 0, 0], ZONES.res.capacity, ZONES.com.capacity, ZONES.ind.capacity];
  const raw = new Float32Array(AREA);
  const transit = w.fields.transit;
  for (let i = 0; i < AREA; i++) {
    const t = w.tiles[i];
    if (t.zone === ZoneType.None || t.level === 0 || t.abandoned || near[i] < 0) continue;
    raw[near[i]] += cap[t.zone][t.level] * Tuning.TRIPS_PER_UNIT[t.zone] * (1 - Tuning.TRANSIT_TRIP_CUT * transit[i]);
  }
  for (const b of w.buildings.values()) {
    const def = BUILDINGS[b.type];
    const trips = (def.jobs + def.residents) * Tuning.BUILDING_TRIPS;
    if (trips <= 0) continue;
    const c = (b.y + (b.size >> 1)) * N + b.x + (b.size >> 1);
    if (near[c] >= 0) raw[near[c]] += trips * (1 - Tuning.TRANSIT_TRIP_CUT * transit[c]);
  }
  const tmp = new Float32Array(AREA);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < AREA; i++) {
      if (!road[i]) continue;
      const x = i % N;
      let s = 0;
      let n = 0;
      if (x > 0 && road[i - 1]) (s += raw[i - 1]), n++;
      if (x < N - 1 && road[i + 1]) (s += raw[i + 1]), n++;
      if (i >= N && road[i - N]) (s += raw[i - N]), n++;
      if (i < AREA - N && road[i + N]) (s += raw[i + N]), n++;
      tmp[i] = n > 0 ? raw[i] * 0.5 + (s / n) * 0.5 : raw[i];
    }
    for (let i = 0; i < AREA; i++) if (road[i]) raw[i] = tmp[i];
  }
  const out = new Float32Array(AREA);
  for (let i = 0; i < AREA; i++) if (road[i]) out[i] = 1 - Math.exp(-raw[i] * (1 / 220)); // exactly the old production expression
  return out;
}

/** A powered streets-only town: a grid, mixed zones at every level, small services. */
function streetTown(): World {
  const w = flatWorld(17);
  w.maxPopulation = 1e6;
  for (let k = 0; k <= 5; k++) {
    for (let x = 8; x <= 48; x++) w.setRoad(x, 8 + k * 8);
    for (let y = 8; y <= 48; y++) w.setRoad(8 + k * 8, y);
  }
  w.addBuilding('reactor', 4, 8);
  let n = 0;
  for (let by = 0; by < 5; by++)
    for (let bx = 0; bx < 5; bx++) {
      const x0 = 9 + bx * 8;
      const y0 = 9 + by * 8;
      const z = ((bx + by) % 3) + 1;
      for (let y = y0; y < y0 + 7; y++)
        for (let x = x0; x < x0 + 7; x++) {
          w.setZone(x, y, z);
          w.setLevel(x, y, ((x + y + n) % 4) as 0 | 1 | 2 | 3);
        }
      n++;
    }
  w.clearTile(12, 12);
  w.clearTile(13, 12);
  w.addBuilding('plaza', 12, 12);
  for (const [x, y] of [[25, 25], [26, 25], [25, 26], [26, 26]]) w.clearTile(x, y);
  w.addBuilding('precinct', 25, 25);
  for (const [x, y] of [[41, 33], [42, 33], [41, 34], [42, 34]]) w.clearTile(x, y);
  w.addBuilding('maglev', 41, 33);
  return w;
}

describe('traffic (§3.8)', () => {
  it('with streets only and every tile at $, traffic and `near` equal the pre-expansion maths', () => {
    const w = streetTown();
    const sim = makeSim(w);
    expect(w.tiles.every((t) => t.wealth === 0)).toBe(true);
    const old = oldTraffic(w);
    let roads = 0;
    for (let i = 0; i < AREA; i++) {
      if (!w.tiles[i].road) continue;
      roads++;
      expect(w.fields.traffic[i]).toBe(old[i]); // bit-identical (street units, §3.8)
    }
    expect(roads).toBeGreaterThan(400);
    expect(Math.max(...old)).toBeGreaterThan(0.3);
    // Pollution and land value see the same road numbers (volume = traffic on a street).
    const f = inner(sim).fields;
    for (let i = 0; i < AREA; i++) if (w.tiles[i].road) expect(f.volume[i]).toBe(w.fields.traffic[i]);
  });

  it('a highway with no on-ramps carries 0; with ramps it carries traffic and streets near the ramps lose load', () => {
    const make = (ramps: boolean) => {
      const w = flatWorld(21);
      w.maxPopulation = 1e6;
      w.addBuilding('reactor', 1, 29);
      for (let x = 4; x <= 58; x++) w.setRoad(x, 30, S);
      for (let x = 4; x <= 58; x++) w.setRoad(x, 24, H);
      for (const cx of [20, 40]) {
        for (let y = 26; y <= 29; y++) w.setRoad(cx, y, S);
        w.setRoad(cx, 25, ramps ? R : S);
      }
      block(w, ZoneType.Residential, 3, 6, 31, 56, 33);
      for (let y = 27; y <= 29; y++) for (let x = 21; x <= 39; x++) { w.setZone(x, y, ZoneType.Commercial); w.setLevel(x, y, 3); }
      makeSim(w);
      return w;
    };
    const none = make(false);
    const hw = (w: World) => {
      let s = 0;
      for (let x = 4; x <= 58; x++) s += at(w, 'traffic', x, 24);
      return s;
    };
    expect(hw(none)).toBe(0);
    const ramped = make(true);
    expect(hw(ramped)).toBeGreaterThan(0);
    // Streets within reach of a ramp hand over part of their load.
    expect(at(ramped, 'traffic', 20, 27)).toBeLessThan(at(none, 'traffic', 20, 27) - 0.05);
    expect(at(ramped, 'traffic', 20, 30)).toBeLessThan(at(none, 'traffic', 20, 30));
    let a = 0;
    let b = 0;
    for (let x = 4; x <= 58; x++) {
      a += at(ramped, 'traffic', x, 30);
      b += at(none, 'traffic', x, 30);
    }
    expect(a).toBeLessThan(b);
  });

  it('an avenue reads lower congestion than a street carrying the same trips', () => {
    const w = flatWorld(22);
    w.maxPopulation = 1e6;
    w.addBuilding('reactor', 1, 10);
    w.addBuilding('reactor', 1, 40);
    for (let x = 4; x <= 30; x++) {
      w.setRoad(x, 11, S);
      w.setRoad(x, 41, A);
    }
    block(w, ZoneType.Residential, 3, 6, 12, 28, 13);
    block(w, ZoneType.Residential, 3, 6, 42, 28, 43);
    makeSim(w);
    const street = at(w, 'traffic', 17, 11);
    const avenue = at(w, 'traffic', 17, 41);
    expect(street).toBeGreaterThan(0.3);
    expect(avenue).toBeLessThan(street - 0.1);
    // Same trips: u = raw / capacity, so −ln(1 − traffic) scales with 1 / capacity.
    const ratio = Math.log(1 - avenue) / Math.log(1 - street);
    expect(ratio).toBeCloseTo(ROAD_KINDS[S].capacity / ROAD_KINDS[A].capacity, 1);
  });

  it('buildings of size ≥ 3 send their trips from the perimeter tile nearest a road', () => {
    const w = flatWorld(23);
    w.maxPopulation = 1e6;
    for (let x = 10; x <= 30; x++) w.setRoad(x, 20, S);
    w.addBuilding('arcology', 15, 21); // centre (16, 22) is 2 from the road: as before
    w.addBuilding('airport', 22, 21); // centre (25, 24) is 4 from the road: dropped before, kept now
    w.addBuilding('reactor', 8, 19);
    const sim = makeSim(w);
    const g = inner(sim).grid;
    const air = w.buildingAt(22, 21)!;
    const r = g.accessRoad(air);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(w.tiles[r].road).toBe(true);
    expect(Math.abs((r % N) - 22)).toBeLessThanOrEqual(1); // claimed from the top-left perimeter tile, 1 from the road
    expect(Math.floor(r / N)).toBe(20);
    expect(w.fields.traffic[r]).toBeGreaterThan(0.2);
  });
});

describe('access (§3.3)', () => {
  it('a lot 2 from a street and 1 from an alley sends its trips to the street; an alley-only lot 2 away has no access', () => {
    const w = flatWorld(24);
    w.maxPopulation = 1e6;
    w.setRoad(20, 20, S);
    w.setRoad(23, 20, L);
    w.setZone(22, 20, ZoneType.Residential);
    w.setRoad(40, 40, L);
    w.setZone(42, 40, ZoneType.Residential);
    w.setZone(41, 41, ZoneType.Residential);
    const sim = makeSim(w);
    const g = inner(sim).grid;
    expect(g.nearestRoad[w.idx(22, 20)]).toBe(w.idx(20, 20));
    expect(g.roadDist[w.idx(22, 20)]).toBe(2);
    expect(g.hasRoad(w.idx(42, 40))).toBe(false);
    expect(g.hasRoad(w.idx(41, 41))).toBe(true);
    expect(g.nearestRoad[w.idx(41, 41)]).toBe(w.idx(40, 40));
    expect(w.stats.developed.res).toBe(0);
  });

  it('lots beside only a highway have no access and never develop', () => {
    const w = flatWorld(25);
    w.addBuilding('solar', 8, 20);
    for (let x = 10; x <= 40; x++) w.setRoad(x, 20, H);
    for (let x = 12; x <= 30; x++) w.setZone(x, 21, ZoneType.Residential);
    const sim = makeSim(w);
    for (let d = 0; d < 120; d++) sim.step();
    expect(w.stats.developed.res).toBe(0);
    expect(inner(sim).grid.hasRoad(w.idx(15, 21))).toBe(false);
  });
});

describe('noise, hub and sea (§3.9)', () => {
  it('highways and skyways make noise that falls off with Chebyshev distance', () => {
    const w = flatWorld(26);
    for (let x = 10; x <= 50; x++) w.setRoad(x, 20, H);
    w.setSky(30, 40, SKY_E);
    w.setSky(31, 40, SKY_W);
    makeSim(w);
    expect(at(w, 'noise', 30, 20)).toBeCloseTo(NOISE.highway, 5);
    expect(at(w, 'noise', 30, 21)).toBeCloseTo(NOISE.highway * (2 / 3), 5);
    expect(at(w, 'noise', 30, 22)).toBeCloseTo(NOISE.highway * (1 / 3), 5);
    expect(at(w, 'noise', 30, 23)).toBe(0);
    expect(at(w, 'noise', 30, 40)).toBeCloseTo(SKYWAY.noise, 5);
    expect(at(w, 'noise', 29, 41)).toBeCloseTo(SKYWAY.noise / 2, 5);
    expect(at(w, 'noise', 28, 40)).toBe(0);
    // Noise lowers land value: −NOISE.lv × noise.
    const q = flatWorld(26);
    makeSim(q);
    expect(at(w, 'landValue', 30, 22)).toBeCloseTo(at(q, 'landValue', 30, 22) - NOISE.lv * NOISE.highway * (1 / 3), 2);
    expect(at(w, 'landValue', 30, 22)).toBeLessThan(at(q, 'landValue', 30, 22));
  });

  it('a powered airport: noise 0.9·(1 − d/11) to r10, and the business-district plateau 6..16 fading to 20', () => {
    const w = flatWorld(27);
    w.maxPopulation = 1e6;
    w.addBuilding('airport', 25, 25); // footprint 25..30
    w.addBuilding('reactor', 22, 25);
    const sim = makeSim(w);
    expect(w.buildingAt(25, 25)!.powered).toBe(true);
    const air = BUILDINGS.airport.noise!;
    const d = (k: number) => 30 + k; // tile k east of the footprint edge
    expect(at(w, 'noise', 27, 27)).toBeCloseTo(air.v, 5);
    for (const k of [1, 5, 10]) expect(at(w, 'noise', d(k), 27)).toBeCloseTo(air.v * (1 - k / (air.r + 1)), 5);
    expect(at(w, 'noise', d(11), 27)).toBe(0);
    expect(at(w, 'hub', d(5), 27)).toBe(0);
    expect(at(w, 'hub', d(6), 27)).toBe(1);
    expect(at(w, 'hub', d(16), 27)).toBe(1);
    expect(at(w, 'hub', d(18), 27)).toBeCloseTo(0.5, 5);
    expect(at(w, 'hub', 27, 30 + 17)).toBeCloseTo(0.75, 5);
    expect(at(w, 'hub', 27, 30 + 20)).toBe(0);
    // Offline: no noise, no business district.
    w.buildingAt(25, 25)!.offline = 50;
    sim.recomputeAll();
    expect(at(w, 'noise', 27, 27)).toBe(0);
    expect(at(w, 'hub', d(8), 27)).toBe(0);
  });

  it('a seaport lifts Fab tiles within 12 (sea = 1 − d/12); a spaceport is quiet until complete', () => {
    const w = flatWorld(28);
    w.maxPopulation = 1e6;
    w.addBuilding('reactor', 5, 5);
    w.addBuilding('seaport', 8, 5); // touches the reactor
    const sp = w.addBuilding('spaceport', 30, 30)!;
    w.addBuilding('reactor', 27, 30);
    sp.buildDays = 100;
    const sim = makeSim(w);
    expect(at(w, 'sea', 9, 6)).toBe(1);
    expect(at(w, 'sea', 11 + 6, 6)).toBeCloseTo(0.5, 5);
    expect(at(w, 'sea', 11 + 12, 6)).toBe(0);
    expect(at(w, 'noise', 32, 32)).toBe(0);
    sp.buildDays = 0;
    sim.recomputeAll();
    expect(at(w, 'noise', 32, 32)).toBeCloseTo(BUILDINGS.spaceport.noise!.v, 5);
  });

  it('education clears when its Academy is bulldozed or goes offline (§6.1)', () => {
    const w = flatWorld(29);
    w.maxPopulation = 1e6;
    w.addBuilding('reactor', 17, 20);
    const ac = w.addBuilding('academy', 20, 20)!;
    const sim = makeSim(w);
    expect(at(w, 'education', 21, 21)).toBeGreaterThan(0.8);
    ac.offline = 30;
    sim.recomputeAll();
    expect(w.fields.education.every((v) => v === 0)).toBe(true);
    ac.offline = 0;
    sim.recomputeAll();
    expect(at(w, 'education', 21, 21)).toBeGreaterThan(0.8);
    w.removeBuilding(ac.id);
    sim.recomputeAll();
    expect(w.fields.education.every((v) => v === 0)).toBe(true);
  });
});

describe('road neighbourhood terms (§3.8, §4.4)', () => {
  it('alleys add crime, cut land value and mark the affordable quarter; avenues lift land value', () => {
    const make = (kind: RoadKind) => {
      const w = flatWorld(30);
      w.addBuilding('solar', 8, 20);
      for (let x = 10; x <= 40; x++) w.setRoad(x, 20, kind);
      block(w, ZoneType.Residential, 1, 12, 21, 38, 21);
      makeSim(w);
      return w;
    };
    const street = make(S);
    const alley = make(L);
    const avenue = make(A);
    expect(alley.fields.alleyNear[alley.idx(20, 21)]).toBe(1);
    expect(alley.fields.alleyNear[alley.idx(20, 23)]).toBe(0);
    expect(street.fields.alleyNear.every((v) => v === 0)).toBe(true);
    expect(at(alley, 'crime', 20, 21)).toBeGreaterThan(at(street, 'crime', 20, 21) + 0.03);
    expect(at(alley, 'landValue', 20, 21)).toBeLessThan(at(street, 'landValue', 20, 21));
    expect(at(avenue, 'landValue', 20, 21)).toBeGreaterThan(at(street, 'landValue', 20, 21));
    expect(at(avenue, 'crime', 20, 21)).toBeLessThan(at(street, 'crime', 20, 21));
    // Back alleys pollute less per trip, highways more (volume × kind multiplier).
    expect(ROAD_KINDS[L].pollution).toBeLessThan(1);
  });

  it('"Roads" upkeep is charged per kind and terrain; "Skyways" per sky tile', () => {
    const w = flatWorld(31);
    for (let x = 10; x <= 19; x++) w.setRoad(x, 10, S);
    for (let x = 10; x <= 14; x++) w.setRoad(x, 12, A);
    for (let x = 10; x <= 13; x++) w.setRoad(x, 14, H);
    for (let x = 10; x <= 12; x++) w.setRoad(x, 16, L);
    skyPath(w, tiles(20, 30, 25, 30));
    makeSim(w);
    const line = (l: string) => w.budget.expenseLines.find((e) => e.label === l)?.amount;
    const k = ROAD_KINDS;
    expect(line('Roads')).toBe(Math.round(10 * k[S].upkeep + 5 * k[A].upkeep + 4 * k[H].upkeep + 3 * k[L].upkeep));
    expect(line('Skyways')).toBe(Math.round(6 * SKYWAY.upkeep));
    expect(w.stats.roads).toEqual({ street: 10, avenue: 5, highway: 4, alley: 3, ramp: 0, skyway: 6 });
  });
});

describe('skyways (§3.7)', () => {
  /** A dense street with a deck from a ramp on the street (or over plain ground) running north. */
  function deck(ramp: boolean): World {
    const w = flatWorld(32);
    w.maxPopulation = 1e6;
    w.addBuilding('reactor', 1, 39);
    for (let x = 4; x <= 58; x++) w.setRoad(x, 40, S);
    block(w, ZoneType.Residential, 3, 6, 41, 56, 43);
    block(w, ZoneType.Commercial, 3, 6, 37, 56, 39);
    if (!ramp) for (let y = 30; y <= 36; y++) w.setZone(30, y, ZoneType.Residential);
    skyPath(w, tiles(30, ramp ? 40 : 36, 30, 30));
    return w;
  }

  it('a deck with an active ramp carries traffic and relieves the street; one that lands nowhere carries nothing', () => {
    const live = deck(true);
    const sim = makeSim(live);
    expect(live.sky[live.idx(30, 40)] & SKY_RAMP).toBe(SKY_RAMP);
    expect(at(live, 'skyTraffic', 30, 35)).toBeGreaterThan(0);
    const g = inner(sim).grid;
    expect(g.skyRamps[g.skyComp[live.idx(30, 35)]]).toBe(1);
    const plain = flatWorld(32);
    plain.maxPopulation = 1e6;
    plain.addBuilding('reactor', 1, 39);
    for (let x = 4; x <= 58; x++) plain.setRoad(x, 40, S);
    block(plain, ZoneType.Residential, 3, 6, 41, 56, 43);
    block(plain, ZoneType.Commercial, 3, 6, 37, 56, 39);
    makeSim(plain);
    expect(at(live, 'traffic', 30, 40)).toBeLessThan(at(plain, 'traffic', 30, 40));
    const loose = deck(false);
    makeSim(loose);
    for (let y = 30; y <= 36; y++) expect(at(loose, 'skyTraffic', 30, y)).toBe(0);
    // A highway laid under the ramp closes it (the bit stays, the ramp stops working).
    live.setRoadKind(30, 40, H);
    sim.recomputeAll();
    expect(live.sky[live.idx(30, 40)] & SKY_RAMP).toBe(SKY_RAMP);
    expect(g.skyRamps[g.skyComp[live.idx(30, 35)]]).toBe(0);
    expect(at(live, 'skyTraffic', 30, 35)).toBe(0);
  });

  it('a dock appears when an anchor is placed under a deck and goes away on the next step when it is bulldozed', () => {
    const w = deck(false);
    const sim = makeSim(w);
    const g = inner(sim).grid;
    const step2 = () => {
      sim.step();
      sim.step(); // one of the two is a traffic (phase 0) tick
    };
    expect(g.dockOf.size).toBe(0);
    expect(at(w, 'skyTraffic', 30, 33)).toBe(0);
    for (let y = 30; y <= 32; y++) for (let x = 29; x <= 31; x++) w.clearTile(x, y);
    const arc = w.addBuilding('arcology', 29, 30)!;
    sim.step();
    expect(g.dockOf.get(arc.id)).toBe(g.skyComp[w.idx(30, 33)]);
    step2();
    expect(at(w, 'skyTraffic', 30, 33)).toBeGreaterThan(0);
    // The deck stays as a span over the empty site; the dock goes away with the building.
    w.removeBuilding(arc.id);
    expect(w.sky[w.idx(30, 31)]).not.toBe(0);
    sim.step();
    expect(g.dockOf.size).toBe(0);
    step2();
    expect(at(w, 'skyTraffic', 30, 33)).toBe(0);
  });

  it('active sky ramps lift land value nearby; decks shade the tiles under them', () => {
    const live = deck(true);
    const g = new SimGrid(live);
    g.scan(live, true);
    expect(g.roadLv[live.idx(32, 42)]).toBeCloseTo(SKYWAY.lvRamp, 5);
    expect(g.roadLv[live.idx(33, 42)]).toBe(0);
    expect(g.roadLv[live.idx(30, 34)]).toBeCloseTo(SKYWAY.lvUnder, 5);
  });
});

describe('advisor (§7.1, §7.6, Appendix B)', () => {
  /** News texts and hint ids posted while `fn` runs. */
  function listen(w: World, fn: () => void) {
    const news: { text: string; kind: string }[] = [];
    const hints: string[] = [];
    const offN = w.events.on('news', (n) => news.push({ text: n.text, kind: n.kind }));
    const offH = w.events.on('hint', (h) => hints.push(h.id));
    fn();
    offN();
    offH();
    return { news, hints, texts: news.map((n) => n.text) };
  }

  it('unlock news names the tray for road kinds, the Skyway and the new buildings (Power reads Infra from the Seaport)', () => {
    const w = flatWorld(34);
    const sim = makeSim(w);
    const at = (pop: number) =>
      listen(w, () => {
        w.maxPopulation = pop;
        sim.step();
      }).texts.filter((t) => t.startsWith('Unlocked: '));
    // Thresholds in ×10 units (MEGACITY §4.4).
    expect(at(5000)).toEqual([
      `Unlocked: ${BUILDINGS.precinct.name} (Civic). ${BUILDINGS.precinct.desc}`,
      `Unlocked: ${BUILDINGS.clinic.name} (Civic). ${BUILDINGS.clinic.desc}`,
    ]);
    expect(at(7000)).toEqual([`Unlocked: ${BUILDINGS.reactor.name} (Power). ${BUILDINGS.reactor.desc}`]);
    expect(at(13000)).toEqual([`Unlocked: Back Alley (Road). ${ROAD_KINDS[L].desc}`, `Unlocked: ${BUILDINGS.datahub.name} (Civic). ${BUILDINGS.datahub.desc}`]);
    expect(at(16000)).toEqual([`Unlocked: Avenue (Road). ${ROAD_KINDS[A].desc}`, `Unlocked: Academy (Civic). ${BUILDINGS.academy.desc}`]);
    const at5k = at(52000);
    expect(at5k[0]).toBe(`Unlocked: Highway (Road). ${ROAD_KINDS[H].desc}`); // road kinds first
    expect(at5k).toContain(`Unlocked: ${BUILDINGS.maglev.name} (Civic). ${BUILDINGS.maglev.desc}`);
    expect(at5k).toContain(`Unlocked: Seaport (Infra). ${BUILDINGS.seaport.desc}`);
    expect(at5k).toContain(`Unlocked: ${BUILDINGS.spire.name} (Sky). ${BUILDINGS.spire.desc}`);
    expect(at5k.some((t) => t.includes('On-ramp'))).toBe(false); // ramps come with the highway
    const at12k = at(125_000);
    expect(at12k).toContain(`Unlocked: Skyway (Sky). ${SKYWAY.desc}`);
    expect(at12k).toContain(`Unlocked: Airport (Infra). ${BUILDINGS.airport.desc}`);
    expect(at(310_000)).toEqual([`Unlocked: Spaceport (Infra). ${BUILDINGS.spaceport.desc}`]);
    expect(at(400_000)).toEqual([]);
  });

  it('the six first-tier highlights post once each, with the wealth hint on the first step up; a loaded city never replays them', () => {
    const w = flatWorld(35);
    w.cityName = 'Lumen';
    const adv = new Advisor();
    const census = new Census();
    adv.prime(w, census);
    const reached = new Uint8Array(12);
    for (const z of [ZoneType.Residential, ZoneType.Commercial, ZoneType.Industrial]) for (const t of [1, 2]) reached[z * 3 + t] = 1;
    const first = listen(w, () => adv.wealthHighlights(w, reached));
    expect(first.texts).toEqual([
      'Window boxes and working lifts: the first $$ Hab Blocks in Lumen.',
      'Glass balconies, private lifts: the first $$$ Hab Blocks in Lumen. Land value did that.',
      'The noodle bars get real chairs. First $$ Market Strip.',
      'A boutique with no prices on anything: the first $$$ Market Strip.',
      'Cleaner lines, better pay: the first $$ Fab Yards.',
      'A fab so clean it has a lobby: the first $$$ Fab Yards. The smog lifts a little.',
    ]);
    expect(first.news[4].kind).toBe('info');
    expect(first.hints).toEqual(['wealth']);
    expect(listen(w, () => adv.wealthHighlights(w, reached)).news).toEqual([]);
    // Primed from the tiers a loaded city already has (index zone * 3 + tier).
    const loaded = new Advisor();
    census.tierCount[ZoneType.Residential * 3 + 1] = 4;
    loaded.prime(w, census);
    const again = listen(w, () => loaded.wealthHighlights(w, reached));
    expect(again.texts.some((t) => t.startsWith('Window boxes'))).toBe(false);
    expect(again.texts.length).toBe(5);
  });

  it('a settled old city never announces the tiers it settled into', () => {
    const w = World.generate(4243, 'Old Quay', undefined, LEGACY_REGION);
    const sim = makeSim(w);
    const mayor = new ScriptedMayor(w, sim);
    mayor.opening();
    for (let m = 0; m < 12; m++) {
      for (let d = 0; d < 30; d++) sim.step();
      mayor.turn();
    }
    const data = toV3(JSON.parse(JSON.stringify(w.serialize())), 2); // the v2 shape (a 3×3 region once loaded)
    for (let k = 0; k < data.tiles!.length; k++) data.tiles![k] &= ~(3 << 18); // a v2 build saved no tiers
    const old = World.deserialize(data);
    const s2 = new Simulation(old);
    s2.recomputeAll();
    expect(s2.settleWealth()).toBeGreaterThan(0);
    s2.recomputeAll();
    // Which first-tier highlights the settle covered (zone * 3 + tier), e.g. $$ Hab Blocks on the waterfront.
    const settled = new Uint8Array(12);
    for (const t of old.tiles) if (t.zone !== ZoneType.None && t.level > 0 && t.wealth > 0) settled[t.zone * 3 + t.wealth] = 1;
    expect(settled[ZoneType.Residential * 3 + 1]).toBe(1);
    // A later step up into a tier the city already settled into is not "the first".
    const adv = (s2 as unknown as { advisor: Advisor }).advisor;
    const after = listen(old, () => adv.wealthHighlights(old, settled));
    expect(after.texts).toEqual([]);
    expect(after.hints).toEqual(['wealth']); // the tip still shows on the session's first step up
  });

  it('hwnoramp, skyloose and noisehome post with their hints; the traffic line names what is unlocked', () => {
    const w = flatWorld(36);
    for (let x = 10; x <= 30; x++) w.setRoad(x, 20, H);
    skyPath(w, tiles(40, 40, 45, 40)); // over plain ground: lands nowhere
    const g = new SimGrid(w);
    g.scan(w, true);
    const census = new Census();
    census.developed[ZoneType.Residential] = 20;
    census.avgNoiseRes = 0.5;
    census.avgTraffic = 0.7;
    const power = new PowerGrid(w);
    const adv = new Advisor();
    const demand = { res: 0, com: 0, ind: 0 };
    w.tick = 0;
    w.maxPopulation = 20000;
    const a = listen(w, () => adv.warnings(w, census, power, demand, g));
    expect(a.news).toContainEqual({ text: 'Advisor: a highway with no on-ramps carries nothing. Drag a street across it to add them.', kind: 'warn' });
    expect(a.news).toContainEqual({ text: 'Advisor: a skyway that lands nowhere carries nothing. End it on a street or run it into a megastructure.', kind: 'info' });
    expect(a.news).toContainEqual({
      text: `Advisor: noise from highways and runways is dragging down nearby ${ZONES.res.name}. Keep homes back, or add ${BUILDINGS.plaza.name}s.`,
      kind: 'warn',
    });
    expect(a.texts).toContain('Advisor: gridlock on the main drags. Widen them into Avenues.');
    expect(a.hints.sort()).toEqual(['noise', 'ramps']);
    // Rate-limited: nothing repeats inside its cooldown.
    w.tick = 5;
    expect(listen(w, () => adv.warnings(w, census, power, demand, g)).hints).toEqual([]);
    // Past the cooldowns, with highways unlocked: the traffic line adds the highway clause.
    w.tick = 600;
    w.maxPopulation = 60000;
    expect(listen(w, () => adv.warnings(w, census, power, demand, g)).texts).toContain(
      'Advisor: gridlock on the main drags. Widen them into Avenues, or run a Highway with on-ramps.',
    );
    // Before avenues the old fallback stays.
    const early = new Advisor();
    w.maxPopulation = 5000;
    expect(listen(w, () => early.warnings(w, census, power, demand)).texts).toContain('Advisor: gridlock on the main drags. Add parallel roads and spread zones out.');
    // Ramps on the highway and a ramp under the deck: neither line.
    w.setRoad(20, 21, R);
    for (let x = 40; x <= 45; x++) w.setRoad(x, 41);
    w.setRoad(40, 40);
    w.setSky(40, 40, w.sky[w.idx(40, 40)] | SKY_RAMP);
    g.scan(w, true);
    const quiet = new Advisor();
    w.tick = 0;
    const q = listen(w, () => quiet.warnings(w, census, power, demand, g));
    expect(q.texts.some((t) => t.includes('no on-ramps') || t.includes('lands nowhere'))).toBe(false);
  });

  it('the roads line says what reaches a lot', () => {
    const w = flatWorld(37);
    for (let x = 10; x < 20; x++) w.setZone(x, 30, ZoneType.Residential);
    const sim = makeSim(w);
    const { texts } = listen(w, () => {
      for (let d = 0; d < 10; d++) sim.step();
    });
    expect(texts).toContain('Advisor: 10 zoned lots have no usable road. Streets reach 3 tiles, alleys 1, highways none.');
  });
});

describe('regional links (§3.10)', () => {
  it('counts border roads whose inward neighbour links (Street 1, Avenue 2, Highway 3), capped at 12', () => {
    const w = flatWorld(33);
    // A street running off the west edge: counts.
    for (let x = 0; x <= 5; x++) w.setRoad(x, 10, S);
    // A road along the north border: does not count (its inward neighbours are not roads).
    for (let x = 20; x <= 30; x++) w.setRoad(x, 0, S);
    // An avenue off the south edge and a highway off the east edge.
    for (let y = 58; y <= 63; y++) w.setRoad(40, y, A);
    for (let x = 58; x <= 63; x++) w.setRoad(x, 30, H);
    const sim = makeSim(w);
    expect(inner(sim).grid.edgePoints).toBe(1 + 2 + 3);
    expect(w.stats.edgeLinks).toBe(6);
    for (let y = 2; y <= 40; y += 4) for (let x = 58; x <= 63; x++) w.setRoad(x, y, H);
    sim.recomputeAll();
    expect(w.stats.edgeLinks).toBe(12);
  });
});
