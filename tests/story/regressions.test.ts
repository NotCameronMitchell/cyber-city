// Regression tests for the integration review (game side): the ending screen
// across a reload, migrated cities and the chapter floor, turf layers after a
// load, timed effects ending on their day, decode validation, gallery storage,
// a Hostile faction that can't monopolise the deck or stay locked Hostile,
// tool prices and the view's stable COMMS rows.

import { afterEach, describe, expect, it } from 'vitest';
import { BULLDOZE_COST, GALLERY_KEY, ROAD_COST, STORY_PACING, TURF } from '../../src/game/config';
import { Game } from '../../src/game/game';
import { storyContent } from '../../src/game/story/conditions';
import { readGallery } from '../../src/game/story/director';
import { driftFavor, standing } from '../../src/game/story/factions';
import * as turf from '../../src/game/story/turf';
import type { SaveData } from '../../src/game/types';
import { headlessGame, playStory } from './harness';

const P = STORY_PACING;

function days(g: Game, n: number, sec = 0) {
  for (let k = 0; k < n; k++) {
    if (sec) g.story.update(sec, false);
    g.sim.step();
    g.story.onDay();
  }
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const reload = (g: Game): Game => {
  const h = new Game();
  if (!h.restore(clone(g.world.serialize()))) throw new Error('restore failed');
  return h;
};
const sum = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
};

/** In-memory localStorage that counts reads; `fail` makes every call throw. */
function memStorage(fail = false) {
  const m = new Map<string, string>();
  const s = {
    gets: 0,
    getItem: (k: string) => {
      s.gets++;
      if (fail) throw new Error('denied');
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (fail) throw new Error('denied');
      m.set(k, String(v));
    },
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
  (globalThis as { localStorage?: unknown }).localStorage = s;
  return s;
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** Charter Night is open in Ch6. */
function charterOpen(seed = 77): Game {
  const g = headlessGame(seed);
  const st = g.world.story;
  st.chapter = 6;
  st.phase = 'countdown';
  st.logs = [1, 2, 3, 4, 5];
  st.flags.charterNightOpen = true;
  return g;
}

// ── Ending screen across a reload ───────────────────────────────────────────

describe('the ending screen survives a reload', () => {
  it('reload while the final card is up: closing it and Log 6 still shows the screen, once', () => {
    memStorage();
    const g = charterOpen();
    expect(g.chooseEnding('quiet').ok).toBe(true);
    expect(g.world.story.open?.card).toBe('end.quiet');
    expect(g.world.story.flags.endingScreen).toBe('quiet');
    const h = reload(g);
    const ended: string[] = [];
    h.events.on('ending', (e) => ended.push(e.id));
    h.story.update(0.5, false);
    expect(h.world.story.open?.card).toBe('end.quiet');
    expect(ended).toEqual([]);
    h.choose(0);
    expect(h.world.story.open?.card).toBe('reward.6');
    expect(ended).toEqual([]);
    h.choose(0);
    expect(ended).toEqual(['quiet']);
    expect(h.world.story.flags.endingScreen).toBeUndefined();
    // Saved after the screen: a later load doesn't show it again.
    const k = reload(h);
    const again: string[] = [];
    k.events.on('ending', (e) => again.push(e.id));
    k.story.update(0.5, false);
    days(k, 40, 0.5);
    expect(again).toEqual([]);
  });

  it('reload while Log 6 is up, and a save with nothing left to show: the screen comes on the first frame', () => {
    memStorage();
    const g = charterOpen();
    g.chooseEnding('quiet');
    g.choose(0);
    expect(g.world.story.open?.card).toBe('reward.6');
    const h = reload(g);
    const ended: string[] = [];
    h.events.on('ending', (e) => ended.push(e.id));
    h.story.update(0.1, false);
    h.choose(0);
    expect(ended).toEqual(['quiet']);
    // Saved between the last close and the screen (e.g. the app was killed): shown at load.
    const data = clone(g.world.serialize());
    data.story!.story.open = null;
    data.story!.story.queue = [];
    const k = new Game();
    const late: string[] = [];
    k.events.on('ending', (e) => late.push(e.id));
    expect(k.restore(data)).toBe(true);
    k.story.update(0.1, false);
    expect(late).toEqual(['quiet']);
  });
});

// ── Migrated cities and the chapter floor ───────────────────────────────────

describe('an old city loaded as v1 does not rush the early chapters', () => {
  it('Ch1 waits for its 20 s load delay and every chapter waits out the 600 s floor', () => {
    const { game } = playStory({ seed: 2091, years: 4 });
    expect(game.world.stats.population).toBeGreaterThan(5000);
    const data = clone(game.world.serialize()) as SaveData;
    data.version = 1;
    delete data.story;
    const g = new Game();
    expect(g.restore(data)).toBe(true);
    const st = g.world.story;
    expect(st.flags.migrated).toBe(true);
    expect(st.waitingSince).toBe(g.world.tick);
    expect(st.chapterTick).toBe(g.world.tick);
    const chapters: { n: number; sec: number }[] = [];
    g.world.events.on('chapter', (c) => chapters.push({ n: c.n, sec: g.story.activeSec }));
    let cards = 0;
    g.world.events.on('card', (c) => void (c && cards++));
    for (let day = 0; day < 1600; day++) {
      g.story.update(0.5, false);
      for (let k = 0; k < 10 && g.story.blocking; k++) g.choose(0);
      g.sim.step();
      g.story.onDay();
      for (let k = 0; k < 10 && g.story.blocking; k++) g.choose(0);
      if (day === 2 * 600 - 1) expect(cards).toBeLessThanOrEqual(10); // first 10 minutes
    }
    expect(chapters[0].n).toBe(1);
    expect(chapters[0].sec).toBeGreaterThanOrEqual(P.bootLoadDelaySec - 3 - 1e-6);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < chapters.length; k++) expect(chapters[k].sec - chapters[k - 1].sec).toBeGreaterThanOrEqual(P.chapterMinSec - 1);
  }, 60000);
});

// ── Turf layers after a load ────────────────────────────────────────────────

describe('turf layers after a load', () => {
  it('use the ending’s turfCrimeMul at once (Low Crown 0.4), not the default until the next month', () => {
    const g = headlessGame(42);
    const w = g.world;
    for (let k = 0; k < 40; k++) {
      const i = w.idx(10 + (k % 10), 10 + Math.floor(k / 10));
      w.turf.owner[i] = k % 2 ? 1 : 2;
      w.turf.str[i] = 80;
    }
    w.tick = 15;
    w.story.ending = 'lowcrown';
    w.story.chapter = 7;
    w.story.phase = 'ended';
    g.story.markDirty();
    turf.refreshStats(w);
    expect(w.mods.turfCrimeMul).toBeCloseTo(0.4, 6);
    const before = sum(w.layerParts.turf.crimeAdd);
    expect(before).toBeGreaterThan(0);
    const h = reload(g);
    expect(h.world.mods.turfCrimeMul).toBeCloseTo(0.4, 6);
    expect(sum(h.world.layerParts.turf.crimeAdd)).toBeCloseTo(before, 4);
  });

  it('the secured shares are derived from the real security field after the first recompute', () => {
    const { game } = playStory({ seed: 9, years: 6 });
    const w = game.world;
    // Hand the Undertow every well-policed tile, so its secured share is well above 0.
    let n = 0;
    for (let i = 0; i < w.tiles.length; i++) {
      if (w.fields.security[i] < TURF.securedAt || w.tiles[i].buildingId >= 0 || w.turf.owner[i] === 2) continue;
      w.turf.owner[i] = 1;
      w.turf.str[i] = 50;
      n++;
    }
    expect(n).toBeGreaterThan(10);
    turf.refreshStats(w);
    const secured = { ...w.turf.stats.secured };
    expect(secured.undertow).toBeGreaterThan(0.05);
    const h = reload(game);
    expect(h.world.turf.stats.secured.undertow).toBeCloseTo(secured.undertow, 6);
    expect(h.story.view().factions.find((f) => f.id === 'undertow')!.drivers).toEqual(game.story.view().factions.find((f) => f.id === 'undertow')!.drivers);
  }, 60000);
});

// ── Timed effects end on their day ──────────────────────────────────────────

describe('timed effects end on their day', () => {
  function bond(startTick: number, reloadAt = -1): number {
    let g = headlessGame(5);
    while (g.world.tick < startTick) days(g, 1);
    const st = g.world.story;
    st.unlocks.push('deals', 'factions', 'comms');
    st.favor.board = 50;
    g.story.markDirty();
    expect(g.takeDeal('board').ok).toBe(true);
    let charged = 0;
    for (let d = 0; d < 40 * 30; d++) {
      if (g.world.tick === reloadAt) g = reload(g);
      g.sim.step();
      if (g.world.tick % 30 === 0 && g.world.budget.expenseLines.some((l) => l.label === 'Civic bond')) charged++;
      g.story.onDay();
    }
    return charged;
  }

  it('a 30-month Civic Bond is charged 30 times, mid-month or not, with or without a reload', () => {
    expect(bond(15)).toBe(30);
    expect(bond(30)).toBe(30);
    expect(bond(15, 905)).toBe(30); // a reload in the last month changes nothing
  });

  it('a timed mod stops applying on its last day, mid-month', () => {
    const g = headlessGame(6);
    const w = g.world;
    days(g, 1);
    w.story.mods.push({ id: 'test', label: 'Test', until: w.tick + 10, mods: { demandInd: 0.15 } });
    g.story.markDirty();
    const base = w.mods.demandInd;
    days(g, 9);
    expect(w.mods.demandInd).toBeCloseTo(base, 6);
    expect(w.story.mods.some((m) => m.id === 'test')).toBe(true);
    days(g, 1); // tick 11: not a month rollover
    expect(w.tick % 30).not.toBe(0);
    expect(w.story.mods.some((m) => m.id === 'test')).toBe(false);
    expect(w.mods.demandInd).toBeLessThan(base);
  });
});

// ── Decode validation ───────────────────────────────────────────────────────

describe('decode validation', () => {
  it('drops a corrupt mood value and malformed timed entries instead of trusting them', () => {
    const g = headlessGame(3);
    const data = clone(g.world.serialize());
    const s = data.story!.story as unknown as Record<string, unknown>;
    s.mood = { board: '5', nacre: 4 };
    s.locals = [{ id: 'x', x: 32, y: 32, r: 10, until: 99999, crimeAdd: '0.1', lvAdd: null }];
    s.incomes = [{ id: 'y', perMonth: 100, until: 99999 }];
    s.mods = [{ id: 'z', until: 99999, mods: { approvalAdd: 5 } }];
    const h = new Game();
    expect(h.restore(data)).toBe(true);
    const st = h.world.story;
    expect(st.mood).toEqual({ nacre: 4 });
    expect(standing(h.world, 'board')).toBe(10); // the start favor, not a string-glued 100
    expect(st.locals).toEqual([]);
    expect(st.incomes).toEqual([]);
    expect(st.mods).toEqual([]);
    expect(sum(h.world.layers.crimeAdd)).not.toBeNaN();
  });
});

// ── Gallery storage ─────────────────────────────────────────────────────────

describe('the endings gallery', () => {
  it('after Full Recall it is not read every sim day', () => {
    const store = memStorage();
    const g = headlessGame(8);
    const st = g.world.story;
    st.ending = 'quiet';
    st.chapter = 7;
    st.phase = 'ended';
    st.flags.fullRecall = true;
    days(g, 1);
    expect(readGallery().fullRecall).toBe(true);
    store.gets = 0;
    days(g, 300);
    expect(store.gets).toBe(0);
    expect(JSON.parse(store.map.get(GALLERY_KEY)!).fullRecall).toBe(true);
  });

  it('storage that throws reads as empty and never breaks an ending', () => {
    memStorage(true);
    expect(readGallery()).toEqual({ v: 1, endings: [], lamplight: false, fullRecall: false });
    const g = charterOpen();
    expect(g.chooseEnding('quiet').ok).toBe(true);
    expect(g.world.story.ending).toBe('quiet');
  });
});

// ── Hostility can't lock the deck or a faction ──────────────────────────────

describe('a faction that stays Hostile', () => {
  it('takes at most every other deck slot; faction cards keep coming', () => {
    const { log } = playStory({
      seed: 2091,
      years: 25,
      answerPending: 0.5,
      each: (g) => void (g.world.story.ceils.basalt = -80),
    });
    const deck = log.deck;
    const flags = deck.filter((d) => d.kind === 'hostile');
    expect(flags.length).toBeGreaterThan(3);
    for (let k = 1; k < deck.length; k++) {
      if (deck[k].kind === 'hostile') expect(deck[k - 1].kind, `deck slot ${k} (${deck[k].id})`).not.toBe('hostile');
    }
    expect(deck.filter((d) => d.kind === 'faction').length).toBeGreaterThanOrEqual(flags.length);
  }, 60000);

  it('a negative favorMonthly sours a faction only to −30; below that the drift still recovers it', () => {
    const g = headlessGame(10);
    const fav = g.world.story.favor;
    fav.nacre = -20;
    for (let k = 0; k < 24; k++) driftFavor(g.world, { nacre: -TURF.pact.favorDrift });
    expect(fav.nacre).toBe(-30); // the String Pact still sours Nacre to Cold
    fav.nacre = -100;
    for (let k = 0; k < 24; k++) driftFavor(g.world, { nacre: -1 });
    expect(fav.nacre).toBe(-76); // +1 a month, the pact's −1 no longer cancels it
    fav.nacre = -30.5;
    driftFavor(g.world, { nacre: -1 });
    expect(fav.nacre).toBe(-30);
    fav.kites = 50;
    driftFavor(g.world, { kites: -1 });
    expect(fav.kites).toBe(48); // above 0 a negative favorMonthly applies in full
  });

  it('the ⚑ side choices no longer push the Hostile faction further down', () => {
    const fx = (id: string, label: string) => storyContent().cards.get(id)!.choices.find((c) => c.label === label)!.fx;
    const loss = (id: string, label: string, f: string) =>
      fx(id, label).filter((e) => e.t === 'favor' && e.f === f && e.v < 0).length;
    expect(loss('nc.blackout', 'Let the Kites hijack them.', 'nacre')).toBe(0);
    expect(loss('ba.embargo', 'Leak it to Nacre.', 'basalt')).toBe(0);
  });
});

// ── Tool prices and view details ────────────────────────────────────────────

describe('tool prices and view details', () => {
  it('road and bulldoze chips show their real per-tile price', () => {
    const g = headlessGame(11);
    expect(Game.toolCost('road')).toBe(ROAD_COST);
    expect(Game.toolCost('bulldoze')).toBe(BULLDOZE_COST);
    g.world.mods.buildCostMul = 2;
    expect(g.toolCost('road')).toBe(ROAD_COST * 2);
    expect(g.toolCost('inspect')).toBe(0);
  });

  it('COMMS and Silt Log rows keep their identity until the log changes', () => {
    const g = headlessGame(12);
    const st = g.world.story;
    st.chapter = 2;
    st.phase = 'waiting';
    st.waitingSince = g.world.tick;
    st.log.push({ tick: 0, card: 'ch1.boot', choice: 0 });
    const a = g.story.view();
    days(g, 3);
    const b = g.story.view();
    expect(b).not.toBe(a);
    expect(b.comms).toBe(a.comms);
    expect(b.logs).toBe(a.logs);
    st.log.push({ tick: g.world.tick, card: 'ch1.minutes', choice: 1 });
    g.story.markDirty();
    expect(g.story.view().comms).not.toBe(a.comms);
    expect(g.story.view().comms.at(-1)?.card).toBe('ch1.minutes');
  });

  it('an open pending card says how many unpaused seconds its default still waits', () => {
    const g = headlessGame(13);
    const st = g.world.story;
    st.unlocks.push('factions', 'comms');
    st.pending = { card: 'ba.shift', tick: g.world.tick, spot: -1 };
    g.story.update(25, false);
    g.story.openPending();
    const v = g.story.view().card!;
    expect(v.autoInDays).toBe(P.pendingDays);
    expect(v.autoInSec).toBe(P.pendingMinSec - 25);
  });
});
