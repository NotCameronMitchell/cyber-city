import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/sim';
import { decodeRle, decodeStoryState, decodeTurf, encodeRle, encodeTurf, pruneUnknownCards } from '../src/game/story/encode';
import { newStoryState } from '../src/game/story/state';
import type { SaveData } from '../src/game/types';
import { World } from '../src/game/world';
import { ScriptedMayor, makeSim } from './helpers';

describe('save / load', () => {
  it('serialize → deserialize → recomputeAll reproduces population and power', () => {
    const w = World.generate(4242, 'Roundtrip Reach');
    const sim = makeSim(w, true);
    const mayor = new ScriptedMayor(w, sim);
    mayor.opening();
    for (let m = 0; m < 14; m++) {
      for (let d = 0; d < 30; d++) sim.step();
      mayor.turn();
    }
    sim.recomputeAll();
    expect(w.stats.population).toBeGreaterThan(300);

    const data = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    const loaded = World.deserialize(data);
    const sim2 = new Simulation(loaded);
    sim2.recomputeAll();

    const a = w.stats;
    const b = loaded.stats;
    expect(b.population).toBe(a.population);
    expect(b.jobsCom).toBe(a.jobsCom);
    expect(b.jobsInd).toBe(a.jobsInd);
    expect(b.powerSupply).toBe(a.powerSupply);
    expect(b.powerDemand).toBe(a.powerDemand);
    expect(b.unpoweredTiles).toBe(a.unpoweredTiles);
    expect(b.developed).toEqual(a.developed);
    expect(b.abandonedTiles).toBe(a.abandonedTiles);
    expect(loaded.tiles.map((t) => t.powered)).toEqual(w.tiles.map((t) => t.powered));
    expect(loaded.funds).toBe(Math.round(w.funds));
    expect(loaded.tick).toBe(w.tick);
    expect(loaded.maxPopulation).toBe(w.maxPopulation);
    expect(loaded.milestones).toEqual(w.milestones);
    expect(loaded.budget.history).toEqual(w.budget.history);

    // The loaded city keeps simulating happily.
    expect(() => {
      for (let i = 0; i < 90; i++) sim2.step();
    }).not.toThrow();
  });

  it('a loaded save does not replay milestones or highlights', () => {
    const w = World.generate(99, 'Replay Point');
    const sim = makeSim(w, false);
    const mayor = new ScriptedMayor(w, sim);
    mayor.opening();
    for (let m = 0; m < 8; m++) {
      for (let d = 0; d < 30; d++) sim.step();
      mayor.turn();
    }
    expect(w.milestones.length).toBeGreaterThan(0);
    const loaded = World.deserialize(JSON.parse(JSON.stringify(w.serialize())));
    const sim2 = new Simulation(loaded);
    sim2.options.events = false;
    sim2.recomputeAll();
    const funds = loaded.funds;
    let milestones = 0;
    loaded.events.on('milestone', () => milestones++);
    const newsBefore = loaded.news.length;
    sim2.step();
    expect(milestones).toBe(0);
    expect(loaded.funds).toBe(funds);
    const fresh = loaded.news.slice(newsBefore).filter((n) => n.text.startsWith('First'));
    expect(fresh).toEqual([]);
  });
});

// ── Story layer save (STORY.md §10.8, §13) ──────────────────────────────────

describe('story save (v2)', () => {
  /** A world with every saved story structure populated. */
  function storied(): World {
    const w = World.generate(777, 'Charter Point');
    for (let x = 18; x <= 44; x++) w.setRoad(x, 30);
    w.addBuilding('solar', 16, 29);
    const stack = w.addBuilding('stack', 24, 31)!;
    w.setStage(stack, 3, 0, 'glare');
    const stack2 = w.addBuilding('stack', 30, 31)!;
    w.setStage(stack2, 2, 41);
    // Turf: varied strengths, both gangs, contested flags (which are not saved).
    for (let k = 0; k < 40; k++) {
      const i = w.idx(20 + (k % 10), 33 + Math.floor(k / 10));
      w.turf.owner[i] = k < 25 ? 1 : 2;
      w.turf.str[i] = 20 + ((k * 7) % 81);
      w.turf.contested[i] = k % 3;
    }
    w.turf.frozenUntil = 1234;
    w.turf.seeded = { undertow: true, kites: true };
    w.turf.lowSince = { undertow: 400, kites: -1 };
    // Rail: an L of track.
    for (let x = 20; x <= 26; x++) w.setRail(x, 28, (x > 20 ? 8 : 0) | (x < 26 ? 2 : 4));
    w.setRail(26, 29, 1);
    w.addLink({ ax: 25, ay: 32, bx: 31, by: 32 });
    w.addLink({ id: 9, ax: 26, ay: 33, bx: 32, by: 33 });
    // Story state.
    const s = w.story;
    s.chapter = 3;
    s.phase = 'active';
    s.chapterTick = 900;
    s.favor.basalt = 37;
    s.favor.kites = -61;
    s.floors.board = 0;
    s.trace = 42;
    s.logs = [1, 2, 7];
    s.flags = { patron: 'nacre', honestTie: true, gangActions: 2 };
    s.unlocks = ['stack', 'factions', 'comms'];
    s.seen = { 'ba.shift': 300 };
    s.queue = [{ card: 'ch3.pier', tick: 960 }];
    s.pending = { card: 'nc.feeds', tick: 950, spot: 1234 };
    s.mods = [{ id: 'm1', label: 'Smog waiver', until: 1200, mods: { demandInd: 0.2, pollutionMul: 1.3 } }];
    s.incomes = [{ id: 'bond', label: 'Civic Bond', perMonth: -450, until: 2000 }];
    s.locals = [{ id: 'l1', x: 22, y: 34, r: 4, until: 1000, crimeAdd: 0.08, lvAdd: 0 }];
    s.credits = [{ what: 'glarewall', n: 1, mul: 0.5 }];
    s.pacts = [{ gang: 'undertow', until: 1500 }];
    s.deals = { 'nacre.canopy': { until: 1300, cooldownUntil: 1600 } };
    s.crackdowns = [{ x: 22, y: 34, r: 13, until: 980, scatterAt: 1010, hit: ['undertow'] }];
    s.precinctReady = { 12: 1000 };
    s.railOut = [{ i: w.idx(22, 28), until: 990 }];
    s.countdownEnd = null;
    s.keyChoices = { 'ch1.lark': 1, 'ch2.vote': 0 };
    s.log = [{ tick: 900, card: 'ch3.clash', choice: 1 }, { tick: 950, card: 'nc.feeds', choice: null, auto: true }];
    s.seam = w.idx(25, 35);
    s.rng = 0xdeadbeef;
    w.tick = 955;
    return w;
  }

  const roundTrip = (w: World, opts?: Parameters<typeof World.deserialize>[2]) =>
    World.deserialize(JSON.parse(JSON.stringify(w.serialize())) as SaveData, undefined, opts);

  it('round trip keeps turf, turfMeta, rail, railOut, links, stages and story exactly', () => {
    const w = storied();
    const data = w.serialize();
    expect(data.version).toBe(3); // v3 = expansion; the story block is unchanged
    expect(data.story).toBeDefined();
    const l = roundTrip(w);

    expect(l.story).toEqual(w.story);
    expect(l.story.flags.migrated).toBeUndefined();
    expect(Array.from(l.turf.owner)).toEqual(Array.from(w.turf.owner));
    expect(Array.from(l.turf.str)).toEqual(Array.from(w.turf.str));
    expect(l.turf.contested.every((v) => v === 0)).toBe(true); // not saved
    expect(l.turf.frozenUntil).toBe(1234);
    expect(l.turf.seeded).toEqual({ undertow: true, kites: true });
    expect(l.turf.lowSince).toEqual({ undertow: 400, kites: -1 });
    expect(Array.from(l.rail)).toEqual(Array.from(w.rail));
    expect(l.links).toEqual(w.links);
    expect(l.nextLinkId).toBe(10);
    const stacks = [...l.buildings.values()].filter((b) => b.type === 'stack');
    expect(stacks.map((b) => [b.stage, b.buildDays, b.crown])).toEqual([
      [3, 0, 'glare'],
      [2, 41, undefined],
    ]);

    // Saving the loaded world again gives the same story block.
    const again = l.serialize();
    expect(again.story).toEqual(JSON.parse(JSON.stringify(data.story)));
    expect(l.addLink({ ax: 1, ay: 1, bx: 5, by: 1 }).id).toBe(10);
  });

  it('encodes turf and rail compactly', () => {
    const w = storied();
    const save = w.serialize().story!;
    expect(save.rail.length).toBeLessThan(60);
    expect(save.turf.length).toBeLessThan(200);
    const empty = new World(1).serialize().story!;
    expect(empty.turf).toEqual([0, 4096]);
    expect(empty.rail).toEqual([0, 4096]);
    expect(JSON.stringify(empty).length).toBeLessThan(2000);
  });

  it('migrates a v1 save: fresh story, flag migrated, empty turf, rail and links', () => {
    const w = storied();
    const v1 = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    v1.version = 1;
    const l = World.deserialize(v1); // a v1 save never decodes a story block
    expect(l.story.chapter).toBe(1);
    expect(l.story.phase).toBe('waiting');
    expect(l.story.flags.migrated).toBe(true);
    expect(l.turf.owner.every((v) => v === 0)).toBe(true);
    expect(l.turf.seeded).toEqual({ undertow: false, kites: false });
    expect(l.rail.every((v) => v === 0)).toBe(true);
    expect(l.links).toEqual([]);
    expect(l.nextLinkId).toBe(1);
    // Stage fields live on the buildings and survive anyway.
    expect([...l.buildings.values()].find((b) => b.type === 'stack')?.stage).toBe(3);
    // And the migrated city simulates.
    const sim = new Simulation(l);
    sim.recomputeAll();
    expect(() => {
      for (let i = 0; i < 40; i++) sim.step();
    }).not.toThrow();
  });

  it('a v2 save with story deleted, or an undecodable one, loads with a fresh story', () => {
    const w = storied();
    const data = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    const noStory = { ...data };
    delete noStory.story;
    for (const bad of [noStory, { ...data, story: 'garbage' }, { ...data, story: { ...data.story, story: 7 } }]) {
      const l = World.deserialize(bad as SaveData);
      expect(l.story.flags.migrated).toBe(true);
      expect(l.story.chapter).toBe(1);
      expect(l.turf.owner.every((v) => v === 0)).toBe(true);
      expect(l.links).toEqual([]);
      expect(l.tiles.filter((t) => t.road).length).toBe(w.tiles.filter((t) => t.road).length);
    }
  });

  it('a saved StoryState missing a field (or with a malformed one) loads with its default', () => {
    const w = storied();
    const data = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    const st = data.story!.story as unknown as Record<string, unknown>;
    delete st.keyChoices;
    delete st.whisperSnap;
    delete st.lastCrackdownTick;
    delete st.favor; // whole record
    st.phase = 'exploded';
    st.chapter = 99;
    st.trace = 'high';
    st.pending = { card: 5 };
    st.logs = [1, 'two', 3];
    st.flags = { ok: true, bad: { nested: 1 } };
    (st.seen as Record<string, unknown>).oops = 'x';
    st.unknownFutureField = 1;
    const l = World.deserialize(data);
    const fresh = newStoryState(w.seed);
    expect(l.story.flags.migrated).toBeUndefined();
    expect(l.story.keyChoices).toEqual({});
    expect(l.story.whisperSnap).toEqual({});
    expect(l.story.lastCrackdownTick).toBe(fresh.lastCrackdownTick);
    expect(l.story.favor).toEqual(fresh.favor);
    expect(l.story.phase).toBe('waiting');
    expect(l.story.chapter).toBe(1);
    expect(l.story.trace).toBe(0);
    expect(l.story.pending).toBeNull();
    expect(l.story.logs).toEqual([1, 3]);
    expect(l.story.flags).toEqual({ ok: true });
    expect(l.story.seen).toEqual({ 'ba.shift': 300 });
    expect('unknownFutureField' in l.story).toBe(false);
    // Fields that were fine are kept.
    expect(l.story.queue).toEqual(w.story.queue);
    expect(l.story.mods).toEqual(w.story.mods);
    // A partial favor record merges over the start favor.
    (data.story!.story as unknown as Record<string, unknown>).favor = { basalt: 50 };
    expect(World.deserialize(data).story.favor).toEqual({ ...fresh.favor, basalt: 50 });
  });

  it('drops unknown card ids from queue, pending and open', () => {
    const w = storied();
    w.story.open = { card: 'gone.card', spot: 0 };
    w.story.queue.push({ card: 'gone.too', tick: 1000 });
    const known = new Set(['ch3.pier', 'nc.feeds']);
    const l = roundTrip(w, { knownCard: (id) => known.has(id) });
    expect(l.story.queue).toEqual([{ card: 'ch3.pier', tick: 960 }]);
    expect(l.story.pending?.card).toBe('nc.feeds');
    expect(l.story.open).toBeNull();
    // Without a card table nothing is dropped (the director can prune later).
    const keep = roundTrip(w);
    expect(keep.story.queue.length).toBe(2);
    expect(pruneUnknownCards(keep.story, (id) => known.has(id))).toBe(2);
    expect(keep.story.open).toBeNull();
  });

  it('a malformed turf or rail run loads empty without losing the story', () => {
    const w = storied();
    const data = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    data.story!.turf = [129, 10]; // too short
    data.story!.rail = [16, 4096]; // mask out of range
    data.story!.links = [{ id: 3, ax: 1, ay: 1, bx: 99, by: 1 }, { id: 4, ax: 1, ay: 2, bx: 5, by: 2 }] as never;
    const l = World.deserialize(data);
    expect(l.story).toEqual(w.story);
    expect(l.turf.owner.every((v) => v === 0)).toBe(true);
    expect(l.turf.seeded).toEqual({ undertow: true, kites: true }); // turfMeta still decodes
    expect(l.rail.every((v) => v === 0)).toBe(true);
    expect(l.links.map((k) => k.id)).toEqual([4]);
    expect(l.nextLinkId).toBe(5);
  });

  it('keeps stage fields only on well-formed Stratablocks', () => {
    const w = new World(3);
    const a = w.addBuilding('plaza', 5, 5)!;
    const b = w.addBuilding('stack', 10, 10)!;
    const data = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
    Object.assign(data.buildings.find((x) => x.id === a.id)!, { stage: 2, buildDays: 3 });
    Object.assign(data.buildings.find((x) => x.id === b.id)!, { stage: 3, buildDays: -4, crown: 'rocket' });
    const l = World.deserialize(data);
    expect(l.buildings.get(a.id)!.stage).toBeUndefined();
    expect(l.buildings.get(a.id)!.buildDays).toBeUndefined();
    const lb = l.buildings.get(b.id)!;
    expect(lb.stage).toBe(3);
    expect(lb.buildDays).toBe(0);
    expect(lb.crown).toBeUndefined();
  });
});

describe('RLE codec', () => {
  it('round-trips arbitrary bytes and rejects malformed runs', () => {
    const src = new Uint8Array(4096);
    let x = 12345;
    for (let i = 0; i < src.length; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      src[i] = x % 7 === 0 ? (x >>> 8) & 15 : 0;
    }
    const pairs = encodeRle(src);
    const out = new Uint8Array(4096);
    expect(decodeRle(pairs, out, 15)).toBe(true);
    expect(Array.from(out)).toEqual(Array.from(src));
    for (const bad of [[1, 4095], [0, 4097], [0, -1, 0, 4097], [0.5, 4096], [99, 4096], 'x', [0]]) {
      expect(decodeRle(bad, out, 15)).toBe(false);
      expect(out.every((v) => v === 0)).toBe(true);
    }
  });

  it('turf packs owner × 128 + str', () => {
    const t = { owner: new Uint8Array(4096), str: new Uint8Array(4096), contested: new Uint8Array(4096) };
    t.owner[5] = 2;
    t.str[5] = 77;
    t.str[6] = 50; // strength without an owner is dropped
    const pairs = encodeTurf(t);
    expect(pairs).toEqual([0, 5, 2 * 128 + 77, 1, 0, 4090]);
    const back = { owner: new Uint8Array(4096), str: new Uint8Array(4096), contested: new Uint8Array(4096).fill(9) };
    expect(decodeTurf(pairs, back)).toBe(true);
    expect(back.owner[5]).toBe(2);
    expect(back.str[5]).toBe(77);
    expect(back.str[6]).toBe(0);
    expect(back.contested.every((v) => v === 0)).toBe(true);
  });

  it('decodeStoryState returns null only for a non-object', () => {
    expect(decodeStoryState(null, 1)).toBeNull();
    expect(decodeStoryState([1, 2], 1)).toBeNull();
    // `met` missing = a save from before it existed: left unset for the director to work out.
    const { met: _met, ...rest } = newStoryState(1);
    const back = decodeStoryState({}, 1)!;
    expect(back).toEqual(rest);
    expect('met' in back).toBe(false);
    expect(decodeStoryState({ met: ['board', 'nope', 'board'] }, 1)!.met).toEqual(['board']);
  });
});
