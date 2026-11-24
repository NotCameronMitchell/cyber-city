// WP-3 render-side checks for road kinds and skyways (docs/EXPANSION.md §3.3, §3.7,
// §3.10, §3.11): the access map the "no road" badges read, deck shapes (ramps and
// slopes), regional stubs, kind widths and street-traffic kind rules. Pure logic: no
// canvas needed.

import { describe, expect, it } from 'vitest';
import { EDGE_LINKS } from '../src/game/config';
import { Rng } from '../src/game/rng';
import { computeAccess, fillKinds } from '../src/game/roads';
import { SKY_E, SKY_N, SKY_RAMP, SKY_S, SKY_W } from '../src/game/skyway';
import { MAP_SIZE, RoadKind, Terrain } from '../src/game/types';
import { World } from '../src/game/world';
import { SHAPE_RAMP, SHAPE_SLOPE, computeShapes } from '../src/render/art/skyway';
import { StreetTraffic } from '../src/render/art/traffic';
import { KIND_HALF, TerrainInfo, kindHalf } from '../src/render/ground';
import { RoadAccessMap } from '../src/render/overlay';

const N = MAP_SIZE;
const AREA = N * N;
const { Street: S, Avenue: A, Highway: H, Alley: L, Ramp: R } = RoadKind;
const KINDS = [S, A, H, L, R];

/** A random map of road segments of every kind, with some water (alleys and ramps there become streets). */
function randomRoads(seed: number): World {
  const w = new World(seed);
  const rng = new Rng(seed * 7 + 1);
  for (let k = 0; k < 6; k++) {
    const x = rng.int(0, N - 1);
    const y = rng.int(0, N - 1);
    for (let d = 0; d < 6; d++) if (w.inBounds(x + d, y)) w.tiles[y * N + x + d].terrain = Terrain.Water;
  }
  const segs = rng.int(6, 18);
  for (let s = 0; s < segs; s++) {
    const kind = rng.pick(KINDS);
    const horiz = rng.chance(0.5);
    const x0 = rng.int(0, N - 1);
    const y0 = rng.int(0, N - 1);
    const len = rng.int(3, 30);
    for (let d = 0; d < len; d++) {
      const x = horiz ? x0 + d : x0;
      const y = horiz ? y0 : y0 + d;
      if (w.inBounds(x, y)) w.setRoad(x, y, kind);
    }
  }
  return w;
}

describe('RoadAccessMap (§3.3, §10.2 #6)', () => {
  it('agrees with computeAccess and World.hasRoadAccess on 20 random mixed-kind maps', () => {
    const dist = new Uint8Array(AREA);
    const near = new Int32Array(AREA);
    const queue = new Int32Array(AREA);
    let highwayOnly = 0;
    for (let seed = 300; seed < 320; seed++) {
      const w = randomRoads(seed);
      computeAccess(fillKinds(w, new Uint8Array(AREA)), dist, near, queue);
      const map = new RoadAccessMap().get(w);
      for (let i = 0; i < AREA; i++) {
        const x = i % N;
        const y = (i / N) | 0;
        expect(map[i] === 1, `seed ${seed} tile ${i}`).toBe(dist[i] !== 255);
        expect(map[i] === 1, `seed ${seed} tile ${i}`).toBe(w.hasRoadAccess(x, y));
        if (!map[i] && w.tiles[i].road && w.tiles[i].roadKind === H) highwayOnly++;
      }
    }
    // The maps do exercise the mixed rule (highway tiles that give no access).
    expect(highwayOnly).toBeGreaterThan(0);
  });

  it('sees a highway alone as no access, an alley only 1 tile out, and rebuilds after invalidate()', () => {
    const w = new World(9);
    for (let x = 10; x < 30; x++) w.setRoad(x, 20, H);
    const m = new RoadAccessMap();
    expect(m.get(w)[w.idx(15, 21)]).toBe(0);
    w.setRoad(15, 22, L);
    // Stale until invalidated (the renderer invalidates on every 'tiles' event).
    expect(m.get(w)[w.idx(15, 23)]).toBe(0);
    m.invalidate();
    const a = m.get(w);
    expect(a[w.idx(15, 23)]).toBe(1);
    expect(a[w.idx(15, 24)]).toBe(0);
    w.setRoad(15, 21, R);
    m.invalidate();
    expect(m.get(w)[w.idx(15, 24)]).toBe(1);
  });
});

describe('road kind widths (§3.11)', () => {
  it('orders the kinds by width so each reads apart: highway > avenue > street = ramp > alley', () => {
    expect(KIND_HALF).toEqual([0.3, 0.4, 0.46, 0.16, 0.3]);
    expect(kindHalf(H)).toBeGreaterThan(kindHalf(A));
    expect(kindHalf(A)).toBeGreaterThan(kindHalf(S));
    expect(kindHalf(R)).toBe(kindHalf(S));
    expect(kindHalf(L)).toBeLessThan(kindHalf(S));
    expect(kindHalf(99)).toBe(0.3);
    // Every half-width stays inside its tile (no ground art past SPILL).
    for (const h of KIND_HALF) expect(h).toBeLessThanOrEqual(0.5);
  });
});

describe('skyway deck shapes (§3.7)', () => {
  function shapesOf(w: World): Uint8Array {
    const list: number[] = [];
    for (let i = 0; i < AREA; i++) if (w.sky[i]) list.push(i);
    const out = new Uint8Array(AREA).fill(255);
    computeShapes(w, w.sky, list, list.length, out);
    return out;
  }

  it('a ramp on a street beside a straight piece is a two-tile slope (52 → 30 → 6)', () => {
    const w = new World(1);
    for (let x = 10; x <= 13; x++) w.setRoad(x, 20, S);
    // Deck x = 10..14 along y = 20, ramp at x = 10 (one link, east).
    w.setSky(10, 20, SKY_E | SKY_RAMP);
    for (let x = 11; x <= 13; x++) w.setSky(x, 20, SKY_E | SKY_W);
    w.setSky(14, 20, SKY_W);
    const sh = shapesOf(w);
    // Ramp tile: link east (d = 1), two-tile, open.
    expect(sh[w.idx(10, 20)]).toBe(SHAPE_RAMP + 1 * 4 + 2 + 0);
    // Its straight neighbour descends towards the ramp (west, d = 3).
    expect(sh[w.idx(11, 20)]).toBe(SHAPE_SLOPE + 3);
    // Plain pieces keep their masks.
    expect(sh[w.idx(12, 20)]).toBe(SKY_E | SKY_W);
    expect(sh[w.idx(14, 20)]).toBe(SKY_W);
    expect(sh[w.idx(30, 30)]).toBe(255);
  });

  it('a closed ramp (no street below) keeps its shape and is flagged closed; a corner neighbour makes a one-tile ramp', () => {
    const w = new World(2);
    // Ramp at (20, 10) over bare land: closed.
    w.setSky(20, 10, SKY_S | SKY_RAMP);
    w.setSky(20, 11, SKY_N | SKY_E);
    w.setSky(21, 11, SKY_W);
    const sh = shapesOf(w);
    // Link south (d = 2), one-tile (the neighbour is a corner), closed.
    expect(sh[w.idx(20, 10)]).toBe(SHAPE_RAMP + 2 * 4 + 0 + 1);
    expect(sh[w.idx(20, 11)]).toBe(SKY_N | SKY_E);
    w.setRoad(20, 10, A);
    expect(shapesOf(w)[w.idx(20, 10)]).toBe(SHAPE_RAMP + 2 * 4 + 0 + 0);
    // A highway below closes it again (§3.7: a highway is not ramp ground).
    w.setRoadKind(20, 10, H);
    expect(shapesOf(w)[w.idx(20, 10)]).toBe(SHAPE_RAMP + 2 * 4 + 1);
  });

  it('two ramps facing across one straight piece both stay one-tile (no shared slope)', () => {
    const w = new World(3);
    for (const x of [5, 7]) w.setRoad(x, 5, S);
    w.setSky(5, 5, SKY_E | SKY_RAMP);
    w.setSky(6, 5, SKY_E | SKY_W);
    w.setSky(7, 5, SKY_W | SKY_RAMP);
    const sh = shapesOf(w);
    expect(sh[w.idx(5, 5)]).toBe(SHAPE_RAMP + 1 * 4);
    expect(sh[w.idx(7, 5)]).toBe(SHAPE_RAMP + 3 * 4);
    expect(sh[w.idx(6, 5)]).toBe(SKY_E | SKY_W);
  });
});

describe('regional road stubs (§3.10)', () => {
  it('places EDGE_LINKS.stubs deterministic stubs on land border tiles with a land tile inward', () => {
    for (const seed of [11, 2091, 77777]) {
      const w = World.generate(seed);
      const a = new TerrainInfo(w);
      const b = new TerrainInfo(w);
      expect(Array.from(a.stub)).toEqual(Array.from(b.stub));
      let n = 0;
      for (let i = 0; i < AREA; i++) {
        const v = a.stub[i];
        if (!v) continue;
        n++;
        const x = i % N;
        const y = (i / N) | 0;
        const d = v - 1;
        expect(x === 0 || y === 0 || x === N - 1 || y === N - 1).toBe(true);
        // The stub points off the map from its edge.
        expect(d === 0 ? y === 0 : d === 1 ? x === N - 1 : d === 2 ? y === N - 1 : x === 0).toBe(true);
        expect(w.tiles[i].terrain).toBe(Terrain.Land);
        const ix = x - [0, 1, 0, -1][d];
        const iy = y - [-1, 0, 1, 0][d];
        expect(w.tileAt(ix, iy)?.terrain).toBe(Terrain.Land);
      }
      expect(n).toBe(EDGE_LINKS.stubs);
    }
  });
});

describe('street traffic kinds (§3.11)', () => {
  /** Run the traffic sim over a fixed view without drawing (the bounds are what draw() would set). */
  function run(w: World, seconds: number) {
    const t = new StreetTraffic();
    (t as unknown as { bounds: object }).bounds = { x0: 0, y0: 0, x1: N - 1, y1: N - 1 };
    for (let k = 0; k < seconds * 30; k++) t.update(1 / 30, w, 'high');
    return (t as unknown as { cars: { x: number; y: number; kind: number }[] }).cars;
  }

  it('alleys carry only bikes; highways carry 35% trucks', () => {
    const w = new World(5);
    for (let x = 2; x < 60; x++) {
      w.setRoad(x, 10, L);
      w.setRoad(x, 30, H);
      w.setRoad(x, 50, S);
    }
    w.stats.population = 50000;
    for (let i = 0; i < AREA; i++) if (w.tiles[i].road) w.fields.traffic[i] = 0.6;
    let alley = 0;
    let alleyBikes = 0;
    let hw = 0;
    let trucks = 0;
    for (let rep = 0; rep < 6; rep++) {
      for (const c of run(w, 4)) {
        const k = w.tiles[c.y * N + c.x].roadKind;
        if (k === L) {
          alley++;
          if (c.kind === 3) alleyBikes++;
        } else if (k === H) {
          hw++;
          if (c.kind === 2) trucks++;
        }
      }
    }
    expect(alley).toBeGreaterThan(0);
    expect(alleyBikes).toBe(alley);
    expect(hw).toBeGreaterThan(20);
    expect(trucks / hw).toBeGreaterThan(0.2);
    expect(trucks / hw).toBeLessThan(0.5);
  });

  it('cars never turn from a street into an alley (bikes may)', () => {
    const w = new World(6);
    // A street with alley side branches every few tiles.
    for (let x = 2; x < 60; x++) w.setRoad(x, 32, S);
    for (let x = 4; x < 60; x += 4) for (let y = 33; y < 40; y++) w.setRoad(x, y, L);
    w.stats.population = 50000;
    for (let i = 0; i < AREA; i++) if (w.tiles[i].road) w.fields.traffic[i] = 0.8;
    for (let rep = 0; rep < 4; rep++)
      for (const c of run(w, 5)) if (w.tiles[c.y * N + c.x].roadKind === L) expect(c.kind).toBe(3);
  });
});
