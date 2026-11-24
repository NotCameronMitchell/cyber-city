// The per-world frame (docs/MEGACITY.md §3.1, §11.2 item 13; Step 0b part 1).
//
// There is no map-size constant: every World owns its side (`world.N`) and tile count
// (`world.area`), every system copies them at construction, and module-scope working arrays
// are per size (`scratchFor`). Every city is still 64×64 at this step; these tests run the
// sim, the story and the tools on worlds of other sides (the legacy 64 frame and the 3×3 / 5×5 regions; formerly
// the 3×3 and 5×5 regions of part 2) to show nothing still assumes 64.

import { describe, expect, it } from 'vitest';
import { applyAction, skywayNetwork } from '../src/game/actions';
import { scratchFor } from '../src/game/frame';
import { shoreSites } from '../src/game/ports';
import { Rng } from '../src/game/rng';
import { Simulation } from '../src/game/sim';
import { SimGrid } from '../src/game/sim/grid';
import { StoryDirector } from '../src/game/story/director';
import { decodeStory, encodeStory } from '../src/game/story/encode';
import * as turf from '../src/game/story/turf';
import * as vertical from '../src/game/story/vertical';
import * as types from '../src/game/types';
import { LEGACY_REGION, LEGACY_SIZE, MAX_MAP_SIZE, SLOT, Terrain, ZoneType, type FrameRegion } from '../src/game/types';
import { World } from '../src/game/world';
import { Game } from '../src/game/game';
import { buildShowcase } from '../src/ui/start/showcase';
import { Camera } from '../src/render/camera';
import { RoadAccessMap } from '../src/render/overlay';
import { ScriptedMayor, ownedWorld, startWorld, sx, sy } from './helpers';

/** Every source file under src/, raw. */
const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every per-tile array a World carries. */
function perTileArrays(w: World): [string, ArrayLike<unknown>][] {
  const out: [string, ArrayLike<unknown>][] = [
    ['tiles', w.tiles],
    ['rail', w.rail],
    ['sky', w.sky],
    ['wealthStreak', w.wealthStreak],
    ['turf.owner', w.turf.owner],
    ['turf.str', w.turf.str],
    ['turf.contested', w.turf.contested],
    ['vertical.railLive', w.vertical.railLive],
  ];
  for (const [k, a] of Object.entries(w.fields)) out.push([`fields.${k}`, a]);
  for (const [k, a] of Object.entries(w.layers)) out.push([`layers.${k}`, a]);
  for (const [part, set] of Object.entries(w.layerParts))
    for (const [k, a] of Object.entries(set as Record<string, Float32Array>)) out.push([`layerParts.${part}.${k}`, a]);
  return out;
}

/** A small block at (x, y): ring roads, a 3×3 Hab block, a row of Market and a Solar Farm beside it. */
function block(w: World, x: number, y: number): void {
  for (const [a, b] of [
    [{ x: x - 1, y: y - 1 }, { x: x + 7, y: y - 1 }],
    [{ x: x - 1, y: y + 3 }, { x: x + 7, y: y + 3 }],
    [{ x: x - 1, y: y - 1 }, { x: x - 1, y: y + 3 }],
    [{ x: x + 3, y: y - 1 }, { x: x + 3, y: y + 3 }],
    [{ x: x + 7, y: y - 1 }, { x: x + 7, y: y + 3 }],
  ])
    applyAction(w, 'road', a, b);
  applyAction(w, 'res', { x, y }, { x: x + 2, y: y + 2 });
  applyAction(w, 'com', { x: x + 4, y }, { x: x + 6, y });
  applyAction(w, 'solar', { x: x + 4, y: y + 1 }, { x: x + 4, y: y + 1 });
}

/** Own every slot of a world (structural annexes; Step 0b places no annex content). */
function ownAll(w: World): World {
  for (let s = 0; s < w.region * w.region; s++) w.annex(s);
  return w;
}

/** A flat world of a region (every slot owned) with a few blocks, including one in the far corner. */
function builtWorld(region: FrameRegion, seed: number): World {
  const w = ownAll(new World(seed, `Frame ${region}`, undefined, region));
  const side = w.N;
  w.funds = 1e7;
  w.maxPopulation = 1e6;
  const c = side >> 1;
  block(w, c - 8, c - 6);
  block(w, c + 2, c + 2);
  block(w, side - 10, side - 6);
  // A highway with an on-ramp, and a skyway docked into nothing (a ramp on a street).
  applyAction(w, 'highway', { x: c - 12, y: c + 8 }, { x: c + 12, y: c + 8 });
  applyAction(w, 'road', { x: c - 2, y: c + 6 }, { x: c - 2, y: c + 10 });
  applyAction(w, 'skyway', { x: c - 9, y: c - 7 }, { x: c - 9, y: c + 2 });
  return w;
}

describe('the frame constants (§3.1)', () => {
  it('MAP_SIZE is gone; SLOT, LEGACY_SIZE and MAX_MAP_SIZE remain, and every index stays below 2³¹', () => {
    expect('MAP_SIZE' in types).toBe(false);
    expect(SLOT).toBe(64);
    expect(LEGACY_SIZE).toBe(64);
    expect(MAX_MAP_SIZE).toBe(320);
    expect(MAX_MAP_SIZE ** 2 < 2 ** 31).toBe(true);
  });

  it('no module-scope typed array is sized from a frame constant and no module captures a side (source scan)', () => {
    const typed = '(?:Int8|Uint8|Uint8Clamped|Int16|Uint16|Int32|Uint32|Float32|Float64)Array';
    const frameWord = /\b(N|AREA|MAP_SIZE|LEGACY_SIZE|MAX_MAP_SIZE|SLOT|area|side|size)\b/;
    // Module scope: a declaration at column 0. Class fields: an initializer at indent 2.
    const moduleArray = new RegExp(`^(?:export )?(?:const|let|var) \\w+(?:\\s*:[^=]+)?\\s*=\\s*new ${typed}\\(([^)]*)\\)`);
    const fieldArray = new RegExp(`^  (?:(?:private|public|protected|readonly|static) )*\\w+(?:\\s*:[^=]+)?\\s*=\\s*new ${typed}\\(([^)]*)\\)`);
    const capture = /^(?:export )?(?:const|let) (?:N|AREA)\s*=/;
    const bad: string[] = [];
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    for (const [rel, text] of Object.entries(SOURCES)) {
      text
        .split('\n')
        .forEach((line, k) => {
          const m = moduleArray.exec(line) ?? fieldArray.exec(line);
          if (m && frameWord.test(m[1])) bad.push(`${rel}:${k + 1}: ${line.trim()}`);
          if (capture.test(line)) bad.push(`${rel}:${k + 1}: ${line.trim()}`);
          if (/\bMAP_SIZE\b/.test(line.replace(/MAX_MAP_SIZE/g, ''))) bad.push(`${rel}:${k + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });

  it('scratchFor keeps one set per size and hands the same set back for the same size', () => {
    let built = 0;
    const s = scratchFor((area) => {
      built++;
      return { a: new Uint8Array(area) };
    });
    const a64 = s(64 * 64);
    const a128 = s(128 * 128);
    expect(a64.a.length).toBe(4096);
    expect(a128.a.length).toBe(16384);
    expect(s(64 * 64)).toBe(a64);
    expect(s(128 * 128)).toBe(a128);
    expect(built).toBe(2);
    expect(() => s(0)).toThrow();
    expect(() => s(1.5)).toThrow();
  });
});

describe('a World owns its frame', () => {
  it('every per-tile array of a 5×5 world holds 320² entries; the default is a 3×3 region, the legacy frame is 64', () => {
    const w = new World(5, 'Wide', undefined, 5);
    expect(w.N).toBe(320);
    expect(w.area).toBe(320 * 320);
    for (const [name, a] of perTileArrays(w)) expect([name, a.length]).toEqual([name, w.area]);
    const d = new World(5);
    expect([d.region, d.N, d.area]).toEqual([3, 192, 192 * 192]);
    const l = new World(5, 'Legacy', undefined, LEGACY_REGION);
    expect([l.N, l.area]).toEqual([LEGACY_SIZE, LEGACY_SIZE * LEGACY_SIZE]);
    for (const [name, a] of perTileArrays(l)) expect([name, a.length]).toEqual([name, l.area]);
    expect(w.inBounds(319, 319) && !w.inBounds(320, 0) && !l.inBounds(64, 0)).toBe(true);
    expect(w.idx(100, 3)).toBe(3 * 320 + 100);
  });

  it('a region other than 3, 5 or the legacy frame is refused', () => {
    for (const r of [0, 2, 4, 6, 64, 1.5]) expect(() => new World(1, 'Bad', undefined, r as FrameRegion)).toThrow();
    for (const r of [1, 3, 5] as FrameRegion[]) expect(new World(1, 'Ok', undefined, r).N).toBe(r * SLOT);
  });

  it("SimGrid's tile-index lists are 32-bit and its component ids 32-bit signed (a 320 frame overflows 16 bits)", () => {
    const g = new SimGrid(new World(1, 'Lists', undefined, 5));
    for (const k of ['hwList', 'hwReachList', 'skyList', 'skyReachList'] as const) expect(g[k]).toBeInstanceOf(Uint32Array);
    for (const k of ['hwComp', 'hwReach', 'skyComp', 'skyReach'] as const) expect(g[k]).toBeInstanceOf(Int32Array);
    expect(g.hwList.length).toBe(320 * 320);
    expect(g.hwTiles.length).toBe((320 * 320) >> 1);
  });

  it('a 320 world past 65,535 tiles keeps highway and skyway indices (no 16-bit wrap)', () => {
    const w = ownAll(new World(3, 'Far', undefined, 5));
    w.funds = 1e7;
    w.maxPopulation = 1e6;
    // A highway and a skyway along row 300, far past index 65,535 (row 204 at side 320).
    applyAction(w, 'road', { x: 280, y: 296 }, { x: 280, y: 304 });
    applyAction(w, 'highway', { x: 250, y: 300 }, { x: 279, y: 300 });
    applyAction(w, 'skyway', { x: 281, y: 298 }, { x: 281, y: 290 });
    const g = new SimGrid(w);
    g.scan(w, true);
    expect(g.hwListLen).toBe(30);
    for (let k = 0; k < g.hwListLen; k++) expect(w.tiles[g.hwList[k]].roadKind).toBe(types.RoadKind.Highway);
    expect(g.skyCount).toBeGreaterThan(1);
    for (let k = 0; k < g.skyCount; k++) expect(w.sky[g.skyList[k]]).not.toBe(0);
    expect(g.hwComp[w.idx(260, 300)]).toBe(0);
    expect(g.skyComp[w.idx(281, 295)]).toBe(0);
  });
});

describe('a 3×3 world through the sim and the story', () => {
  it('a scripted city grows past the legacy 64 frame, the story reaches Ch3 and seeds turf, and the story save round-trips', () => {
    const w = ownAll(World.generate(2091, 'Wide Bay', undefined, 3));
    expect(w.tiles.some((t, i) => t.terrain === Terrain.Water && i > 4096)).toBe(true);
    const sim = new Simulation(w);
    sim.options.events = false;
    const d = new StoryDirector({ world: w, settings: { storyPace: 'brisk' } });
    sim.recomputeAll();
    const mayor = new ScriptedMayor(w, sim);
    mayor.opening();
    const rng = new Rng(7);
    const answer = () => {
      for (let guard = 0; guard < 40 && d.blocking; guard++) {
        const st = w.story;
        if (st.flags.charterNightOpen && !st.open) {
          d.chooseEnding('quiet');
          continue;
        }
        const v = d.view().card;
        if (!v) break;
        const open = v.choices.map((c, k) => (c.locked ? -1 : k)).filter((k) => k >= 0);
        d.choose(open[Math.floor(rng.next() * open.length)] ?? 0);
      }
    };
    let maxTurf = 0;
    const chapters: number[] = [];
    w.events.on('chapter', (c) => chapters.push(c.n));
    for (let day = 0; day < 360 * 9; day++) {
      d.update(0.5, false);
      answer();
      if (w.story.waiting && !w.story.open) {
        d.openWaiting();
        answer();
      }
      sim.step();
      d.onDay();
      answer();
      if (w.tick % 30 === 0) {
        mayor.turn();
        mayor.observe();
      }
      maxTurf = Math.max(maxTurf, w.turf.stats.tiles.undertow + w.turf.stats.tiles.kites);
    }
    expect(w.stats.population).toBeGreaterThan(50000);
    expect(chapters).toContain(3);
    // Development on both sides of the old 64 border (the mayor's grid spans 42..86).
    let east = 0;
    let south = 0;
    for (let i = 0; i < w.area; i++) {
      const t = w.tiles[i];
      if (t.zone === ZoneType.None || t.level === 0) continue;
      if (i % w.N >= 64) east++;
      if (((i / w.N) | 0) >= 64) south++;
    }
    expect(east).toBeGreaterThan(0);
    expect(south).toBeGreaterThan(0);
    // Turf seeded (Ch3 at the latest) and every turf tile, seam and strongest tile is a 192-frame index.
    const st = w.turf.stats;
    expect(w.turf.seeded.undertow && w.turf.seeded.kites).toBe(true);
    expect(maxTurf).toBeGreaterThan(9);
    expect(w.turf.owner.length).toBe(w.area);
    for (const s of [st.strongest.undertow, st.strongest.kites, w.story.seam ?? -1]) expect(s).toBeLessThan(w.area);
    // Fields stay finite everywhere.
    for (const [name, a] of Object.entries(w.fields)) expect([name, (a as Float32Array).every((v) => Number.isFinite(v))]).toEqual([name, true]);
    // The story block round-trips into a fresh world of the same side.
    const back = new World(2091, 'Back', undefined, 3);
    expect(decodeStory(JSON.parse(JSON.stringify(encodeStory(w))), back)).toBe(true);
    expect(Array.from(back.turf.owner)).toEqual(Array.from(w.turf.owner));
    expect(Array.from(back.turf.str)).toEqual(Array.from(w.turf.str));
    expect(back.story.seam).toBe(w.story.seam);
    expect(back.story.chapter).toBe(w.story.chapter);
  }, 120000);

  it("a seam or rail-out index past a 64 frame survives on a 3×3 world but is dropped on a 64 one", () => {
    const w = new World(9, 'Seam', undefined, 3);
    w.story.seam = 100 * 192 + 100;
    w.story.railOut = [{ i: 120 * 192 + 5, until: 99 }];
    const save = JSON.parse(JSON.stringify(encodeStory(w)));
    const wide = new World(9, 'Wide', undefined, 3);
    const small = new World(9, 'Small', undefined, LEGACY_REGION);
    expect(decodeStory(save, wide) && decodeStory(save, small)).toBe(true);
    expect(wide.story.seam).toBe(100 * 192 + 100);
    expect(wide.story.railOut).toHaveLength(1);
    expect(small.story.seam).toBeNull();
    expect(small.story.railOut).toHaveLength(0);
  });
});

describe('worlds of different sides side by side (the Showcase case)', () => {
  /** Interleave days, monthly turf and the tools' scratch across worlds; return a digest per world. */
  function play(worlds: World[], days: number): string[] {
    const sims = worlds.map((w) => {
      const s = new Simulation(w);
      s.options.events = false;
      s.recomputeAll();
      return s;
    });
    for (const w of worlds) {
      const c = w.N >> 1;
      turf.seedGang(w, 'undertow', c - 6, c - 4, 60);
      turf.seedGang(w, 'kites', c + 4, c + 4, 60);
    }
    for (let day = 0; day < days; day++)
      for (let k = 0; k < worlds.length; k++) {
        const w = worlds[k];
        sims[k].step();
        if (w.tick % 30 === 0) {
          turf.update(w);
          vertical.refresh(w);
        }
      }
    return worlds.map((w) => {
      const c = w.N >> 1;
      const net = skywayNetwork(w, w.idx(c - 9, c - 5));
      const marks = new Uint8Array(w.area);
      const shores = shoreSites(w, marks);
      const data = w.serialize() as unknown as Record<string, unknown>;
      delete data.savedAt;
      return JSON.stringify({
        data,
        net,
        shores,
        turf: [Array.from(w.turf.owner), Array.from(w.turf.str)],
        aff: Array.from(turf.affinity(w, 'kites')).map((v) => Math.round(v * 1e6)),
        fields: Object.entries(w.fields).map(([k, a]) => [k, Array.from(a as Float32Array)]),
      });
    });
  }

  it('a legacy 64, a 3×3 and a 5×5 world stepped in turn match each stepped alone', () => {
    const sides: FrameRegion[] = [1, 3, 5];
    const together = play(sides.map((s) => builtWorld(s, 11)), 75);
    const alone = sides.map((s) => play([builtWorld(s, 11)], 75)[0]);
    for (let k = 0; k < sides.length; k++) expect([sides[k], together[k] === alone[k]]).toEqual([sides[k], true]);
    // And the worlds really did something.
    const w = builtWorld(5, 11);
    const s = new Simulation(w);
    s.options.events = false;
    for (let d = 0; d < 75; d++) s.step();
    expect(w.stats.population).toBeGreaterThan(0);
    expect(w.tiles[w.idx(311, 315)].level).toBeGreaterThan(0);
  }, 120000);
});

describe('the title Showcase beside a 5×5 city (§11.2 item 13, the Showcase case)', () => {
  /** Everything a world holds that the sim or a save can see. */
  const digest = (w: World) => {
    const d = w.serialize() as unknown as Record<string, unknown>;
    delete d.savedAt;
    return JSON.stringify({ d, f: Object.entries(w.fields).map(([k, a]) => [k, Array.from(a as Float32Array)]) });
  };
  /** A 5×5 game city with two blocks in its start slot, stepped 60 days; the Showcase recomputed beside it each day. */
  function run(withShowcase: boolean): { game: string; show: string | null; showRegion: number; owned: number } {
    const g = new Game();
    g.newCity('Wide', 77, 5);
    const w = g.world;
    w.funds = 1e7;
    const c = w.N >> 1;
    block(w, c - 8, c - 6);
    block(w, c + 2, c + 2);
    g.sim.options.events = false;
    g.sim.recomputeAll();
    const show = withShowcase ? buildShowcase() : null;
    const showSim = show ? new Simulation(show) : null;
    if (showSim) showSim.options.events = false;
    for (let d = 0; d < 60; d++) {
      g.sim.step();
      showSim?.recomputeAll();
    }
    return {
      game: digest(w),
      show: show ? digest(show) : null,
      showRegion: show?.region ?? 0,
      owned: show ? show.slotOwned.reduce((a, b) => a + b, 0) : 0,
    };
  }

  it('a 3×3 Showcase with locked slots and a 5×5 World + Simulation never touch each other', () => {
    const together = run(true);
    const alone = run(false);
    expect(together.showRegion).toBe(3);
    expect(together.owned).toBe(1); // the Showcase lives in its start slot; the other 8 slots are locked
    expect(together.game === alone.game).toBe(true);
    // The Showcase alone, recomputed as often, ends where it ended beside the game.
    const solo = buildShowcase();
    const soloSim = new Simulation(solo);
    soloSim.options.events = false;
    for (let d = 0; d < 60; d++) soloSim.recomputeAll();
    expect(together.show === digest(solo)).toBe(true);
    expect(JSON.parse(together.game).d.region).toBe(5);
  }, 60000);
});

describe('the region test helpers (§11.5)', () => {
  it('sx / sy place slot-local tiles in the start slot; startWorld owns one slot, ownedWorld all', () => {
    for (const r of [3, 5] as const) {
      const w = startWorld(r);
      const rect = w.ownedBox;
      expect([sx(0, r), sy(63, r)]).toEqual([rect.x0, rect.y1]);
      expect(w.slotOwned.reduce((a, b) => a + b, 0)).toBe(1);
      expect(w.isOwned(sx(10, r), sy(10, r))).toBe(true);
      expect(w.isOwned(sx(-1, r), sy(10, r))).toBe(false);
      expect(ownedWorld(r).slotOwned.every((v) => v === 1)).toBe(true);
    }
    expect(sx(5, LEGACY_REGION)).toBe(5);
  });
});

describe('the render side reads the frame from the world it shows', () => {
  it('the camera clamps and fits to its map size, and follows a world of another side', () => {
    const cam = new Camera(128);
    cam.setViewport(390, 844);
    cam.centerOnTile(500, 500);
    expect(cam.visibleTileBounds(0).x1).toBe(127);
    cam.fitMap();
    expect(cam.y).toBe(128 * 16);
    cam.setMapSize(64);
    cam.centerOnTile(500, 500);
    expect(cam.visibleTileBounds(0).x1).toBe(63);
  });

  it('the road access map resizes to each world it is asked about', () => {
    const map = new RoadAccessMap();
    const wide = builtWorld(3, 3);
    const small = builtWorld(1, 3);
    const a = map.get(wide);
    expect(a.length).toBe(192 * 192);
    expect(a[wide.idx(183, 187)]).toBe(1); // inside the far block (182..184, 186..188): its ring road gives access
    expect(a[wide.idx(5, 184)]).toBe(0);
    map.invalidate();
    expect(map.get(small).length).toBe(64 * 64);
  });
});
