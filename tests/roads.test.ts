// Road kinds (docs/EXPANSION.md §3.2–§3.4, §10.2 #6): links, the drag table,
// prices, the one access rule and the highway lost-access check.

import { describe, expect, it } from 'vitest';
import { ROAD_ACCESS_RANGE, ROAD_KINDS } from '../src/game/config';
import { Rng } from '../src/game/rng';
import {
  KIND_NONE,
  ROAD_TOOL_KIND,
  accessRange,
  computeAccess,
  dragResult,
  fillKinds,
  frontable,
  isRoadTool,
  lostAccess,
  roadLinks,
  roadPrice,
  roadUpkeep,
} from '../src/game/roads';
import { SimGrid } from '../src/game/sim/grid';
import { LEGACY_SIZE, RoadKind, Terrain, ZoneType } from '../src/game/types';
import { World } from '../src/game/world';
import { RoadAccessMap } from '../src/render/overlay';
import { LEGACY_REGION } from '../src/game/types';

const N = LEGACY_SIZE;
const AREA = N * N;
const { Street: S, Avenue: A, Highway: H, Alley: L, Ramp: R } = RoadKind;
const KINDS = [S, A, H, L, R];

function access(world: World) {
  const kinds = fillKinds(world, new Uint8Array(AREA));
  const dist = new Uint8Array(AREA);
  const near = new Int32Array(AREA);
  computeAccess(kinds, dist, near, new Int32Array(AREA), world.N);
  return { kinds, dist, near };
}

/** A random map of road segments; `mixed` picks every kind, otherwise streets only. Some water too. */
function randomRoads(seed: number, mixed: boolean): World {
  const w = new World(seed, undefined, undefined, LEGACY_REGION);
  const rng = new Rng(seed * 7 + 1);
  for (let k = 0; k < 6; k++) {
    const x = rng.int(0, N - 1);
    const y = rng.int(0, N - 1);
    for (let d = 0; d < 6; d++) if (w.inBounds(x + d, y)) w.tiles[y * N + x + d].terrain = Terrain.Water;
  }
  const segs = rng.int(6, 18);
  for (let s = 0; s < segs; s++) {
    const kind = mixed ? rng.pick(KINDS) : S;
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

describe('roadLinks (§3.2)', () => {
  it('connects everything except a highway to a non-ramp', () => {
    for (const a of KINDS)
      for (const b of KINDS) {
        const expected = a === H && b === H ? true : a === H ? b === R : b === H ? a === R : true;
        expect(roadLinks(a, b), `${a}-${b}`).toBe(expected);
        expect(roadLinks(a, b)).toBe(roadLinks(b, a));
      }
  });

  it('roadMask follows links on road tiles; roadAdjMask and non-road tiles see any road', () => {
    const w = new World(1, undefined, undefined, LEGACY_REGION);
    // Street at (10,10) with a highway to its east, a ramp to its north (joined to a highway further north).
    w.setRoad(10, 10, S);
    w.setRoad(11, 10, H);
    w.setRoad(10, 9, R);
    w.setRoad(10, 8, H);
    w.setRoad(9, 10, L);
    expect(w.roadMask(10, 10)).toBe(1 | 8); // ramp N + alley W, not the highway E
    expect(w.roadAdjMask(10, 10)).toBe(1 | 2 | 8);
    expect(w.roadMask(11, 10)).toBe(0); // the highway doesn't join the street
    expect(w.roadMask(10, 9)).toBe(1 | 4); // the ramp joins both
    expect(w.roadMask(10, 8)).toBe(4);
    // A lot next to the highway: raw adjacency, as before the expansion.
    expect(w.roadMask(12, 11)).toBe(0);
    expect(w.roadMask(11, 11)).toBe(1); // the highway above
    expect(w.roadMask(10, 11)).toBe(1); // the street above
  });
});

describe('dragResult (§3.4 table)', () => {
  it('matches the table: smaller kinds never shrink a road', () => {
    const T: Record<number, (RoadKind | null)[]> = {
      // current:  Street Avenue Highway Alley Ramp
      [L]: [null, null, null, null, null],
      [S]: [null, null, null, S, null],
      [A]: [A, null, null, A, null],
      [H]: [H, H, null, H, H],
      [R]: [R, R, null, R, null],
    };
    for (const target of KINDS)
      for (const current of KINDS) expect(dragResult(target, current), `${target} over ${current}`).toBe(T[target][current]);
  });

  it('tool kinds, prices and upkeep come from ROAD_KINDS', () => {
    expect(ROAD_TOOL_KIND).toEqual({ road: S, avenue: A, highway: H, alley: L });
    expect(isRoadTool('road') && isRoadTool('alley') && !isRoadTool('skyway') && !isRoadTool('res')).toBe(true);
    expect(roadPrice(S, false)).toBe(15);
    expect(roadPrice(S, true)).toBe(90);
    expect(roadPrice(A, true)).toBe(200);
    expect(roadPrice(H, true)).toBe(360);
    expect(roadPrice(L, true)).toBeNull();
    expect(roadPrice(R, true)).toBeNull();
    expect(roadPrice(R, false)).toBe(60);
    // Upgrade differences quoted in §3.4.
    expect(roadPrice(S, false)! - roadPrice(L, false)!).toBe(9);
    expect(roadPrice(A, false)! - roadPrice(S, false)!).toBe(25);
    expect(roadPrice(R, false)! - roadPrice(S, false)!).toBe(45);
    expect(roadPrice(R, false)! - roadPrice(A, false)!).toBe(20);
    expect(roadPrice(A, true)! - roadPrice(S, true)!).toBe(110);
    expect(roadUpkeep(H, true)).toBe(12);
    expect(roadUpkeep(L, false)).toBe(0.2);
    expect(frontable(H)).toBe(false);
    for (const k of [S, A, L, R]) expect(frontable(k)).toBe(true);
    expect(accessRange(L)).toBe(1);
    expect(accessRange(A)).toBe(ROAD_ACCESS_RANGE);
  });
});

describe('access (§3.3)', () => {
  it('with streets only, computeAccess equals the pre-expansion SimGrid BFS', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const w = randomRoads(seed, false);
      const g = new SimGrid(w);
      g.scan(w, true);
      const { dist, near } = access(w);
      expect(Array.from(near)).toEqual(Array.from(g.nearestRoad));
      expect(Array.from(dist)).toEqual(Array.from(g.roadDist));
    }
  });

  it('computeAccess, World.hasRoadAccess and RoadAccessMap agree on 20 random maps', () => {
    for (let seed = 100; seed < 120; seed++) {
      const w = randomRoads(seed, true);
      const { dist } = access(w);
      for (let i = 0; i < AREA; i++) expect(dist[i] !== 255, `seed ${seed} tile ${i}`).toBe(w.hasRoadAccess(i % N, (i / N) | 0));
    }
    // RoadAccessMap (render/overlay.ts) runs computeAccess itself (§3.3), so it agrees on mixed maps
    // too; the streets-only loop keeps the pre-expansion rule pinned.
    for (let seed = 200; seed < 220; seed++) {
      const w = randomRoads(seed, seed % 2 === 0);
      const { dist } = access(w);
      const map = new RoadAccessMap().get(w);
      for (let i = 0; i < AREA; i++) expect(map[i] === 1, `seed ${seed} tile ${i}`).toBe(dist[i] !== 255);
    }
  });

  it('seeds avenues before streets; highways never give access; alleys only fill gaps', () => {
    const w = new World(2, undefined, undefined, LEGACY_REGION);
    // A lot equally close (2) to an avenue (west) and a street (east): its trips go to the avenue.
    w.setRoad(8, 10, A);
    w.setRoad(12, 10, S);
    let a = access(w);
    expect(a.near[w.idx(10, 10)]).toBe(w.idx(8, 10));
    // A lot 2 from a street and 1 from an alley sends its trips to the street (WP-1 acceptance shape).
    const v = new World(3, undefined, undefined, LEGACY_REGION);
    v.setRoad(20, 20, S);
    v.setRoad(23, 20, L);
    a = access(v);
    expect(a.near[v.idx(22, 20)]).toBe(v.idx(20, 20));
    expect(a.dist[v.idx(22, 20)]).toBe(2);
    // Alley-only lots: 1 tile reaches, 2 doesn't.
    const u = new World(4, undefined, undefined, LEGACY_REGION);
    u.setRoad(30, 30, L);
    a = access(u);
    expect(a.near[u.idx(31, 31)]).toBe(u.idx(30, 30));
    expect(a.dist[u.idx(31, 31)]).toBe(1);
    expect(a.dist[u.idx(32, 30)]).toBe(255);
    expect(u.hasRoadAccess(31, 31)).toBe(true);
    expect(u.hasRoadAccess(32, 30)).toBe(false);
    // Highway only: no access, no claim, not even on its own tile.
    const h = new World(5, undefined, undefined, LEGACY_REGION);
    for (let x = 0; x < 20; x++) h.setRoad(x, 40, H);
    a = access(h);
    expect(a.kinds[h.idx(3, 40)]).toBe(H);
    expect(a.dist.every((d) => d === 255)).toBe(true);
    expect(h.hasRoadAccess(3, 41)).toBe(false);
    // A ramp gives access like a street.
    h.setRoad(5, 41, R);
    expect(h.hasRoadAccess(5, 44)).toBe(true);
    expect(fillKinds(h, new Uint8Array(AREA))[h.idx(30, 30)]).toBe(KIND_NONE);
  });
});

describe('lostAccess (§3.4)', () => {
  /** A street along y=20 from x=10..30 with developed Hab Blocks on both sides (rows 19 and 21). */
  function strip(): World {
    const w = new World(9, undefined, undefined, LEGACY_REGION);
    for (let x = 10; x <= 30; x++) {
      w.setRoad(x, 20);
      for (const y of [19, 21]) {
        w.setZone(x, y, ZoneType.Residential);
        w.setLevel(x, y, 1);
      }
    }
    return w;
  }
  const row = (w: World, y: number, x0: number, x1: number) => {
    const out: number[] = [];
    for (let x = x0; x <= x1; x++) out.push(w.idx(x, y));
    return out;
  };

  it('counts every developed lot whose only road a highway drag converts', () => {
    const w = strip();
    const out: number[] = [];
    const n = lostAccess(w, row(w, 20, 10, 30), out);
    expect(n).toBe(42);
    expect(new Set(out).size).toBe(42);
    expect(out).toContain(w.idx(10, 19));
    // Nothing changed in the world.
    expect(w.tileAt(15, 20)!.roadKind).toBe(S);
  });

  it('lots that keep another street do not count; empty lots and abandoned blocks never count', () => {
    const w = strip();
    for (let x = 10; x <= 30; x++) w.setRoad(x, 17); // a parallel street 2 north of row 19
    w.setLevel(12, 21, 0);
    w.setLevel(13, 21, 2, true);
    const out: number[] = [];
    const n = lostAccess(w, row(w, 20, 10, 30), out);
    expect(n).toBe(21 - 2 + 0); // only row 21 loses access, minus the lot and the abandoned block
    expect(out.every((i) => ((i / N) | 0) === 21)).toBe(true);
  });

  it('a needsRoad building counts once and lists its footprint', () => {
    const w = new World(10, undefined, undefined, LEGACY_REGION);
    for (let x = 0; x <= 20; x++) w.setRoad(x, 10);
    const b = w.addBuilding('stack', 6, 11)!; // 4×4, needsRoad, only road is y=10
    const out: number[] = [];
    expect(lostAccess(w, row(w, 10, 0, 20), out)).toBe(1);
    expect(out.length).toBe(16);
    expect(out).toContain(w.idx(b.x + 3, b.y + 3));
    // A plaza (no needsRoad) never counts.
    const v = new World(11, undefined, undefined, LEGACY_REGION);
    for (let x = 0; x <= 20; x++) v.setRoad(x, 10);
    v.addBuilding('plaza', 6, 11);
    expect(lostAccess(v, row(v, 10, 0, 20), [])).toBe(0);
  });

  it('a cross street the highway cuts loses nothing when every lot keeps a road', () => {
    const w = new World(12, undefined, undefined, LEGACY_REGION);
    for (let x = 0; x < 40; x++) {
      w.setRoad(x, 10);
      w.setRoad(x, 14);
    }
    for (let y = 10; y <= 14; y++) w.setRoad(20, y);
    for (let x = 0; x < 40; x++)
      for (const y of [11, 12, 13]) {
        if (x === 20) continue;
        w.setZone(x, y, ZoneType.Commercial);
        w.setLevel(x, y, 1);
      }
    expect(lostAccess(w, row(w, 10, 0, 39), [])).toBe(0);
  });
});

describe('ROAD_KINDS rows', () => {
  it('are indexed by kind and keep phone meta lines short', () => {
    ROAD_KINDS.forEach((d, k) => expect(d.kind).toBe(k));
    for (const d of ROAD_KINDS) expect(d.meta.length).toBeLessThanOrEqual(22);
  });
});
