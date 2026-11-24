// Start screen logic (src/ui/start/startModel.ts): which buttons the title
// shows for each slot state, the Continue card's text, the New City note, the
// title's phase machine (the boot hold), its keys, the backdrop drift and the
// install tip. Plus the hold contract with a real Game: while the title is up
// main.ts never calls game.update, and a brand-new city still gets its
// Chapter I title, then the boot card, once play starts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FUTURE_SAVE_TEXT, Game } from '../src/game/game';
import { SAVE_KEY } from '../src/game/config';
import { Terrain, ZoneType } from '../src/game/types';
import { buildShowcase } from '../src/ui/start/showcase';
import {
  HeldTimer,
  LEAVE_MS,
  StartFlow,
  a2hsHint,
  chapterLine,
  citySummary,
  driftOffset,
  replaceNote,
  residents,
  saveState,
  startButtons,
  startKey,
  titleWarning,
  TITLE_FUTURE_TEXT,
  worthKeeping,
  type HintEnv,
  type StartPhase,
} from '../src/ui/start/startModel';

describe('title buttons per slot state', () => {
  it('first launch (no save): New City is the primary, no Continue, no Previous city', () => {
    expect(startButtons({ hasCity: false, hasBackup: false })).toEqual({ continue: false, newPrimary: true, previous: false, primary: 'new' });
  });
  it('returning player: Continue is the primary, New City secondary', () => {
    expect(startButtons({ hasCity: true, hasBackup: false })).toEqual({ continue: true, newPrimary: false, previous: false, primary: 'continue' });
  });
  it('a backup city adds the Previous city button', () => {
    expect(startButtons({ hasCity: true, hasBackup: true })).toMatchObject({ continue: true, previous: true, primary: 'continue' });
    expect(startButtons({ hasCity: false, hasBackup: true })).toMatchObject({ continue: false, newPrimary: true, previous: true, primary: 'new' });
  });
});

describe('Continue card text', () => {
  const story = (o: Partial<{ n: number; numeral: string; title: string; phase: string; ended: boolean }> = {}) => ({
    n: 3,
    numeral: 'III',
    title: 'TURF LINES',
    phase: 'active',
    ended: false,
    ...o,
  });

  it('names the city, the date, the residents and the chapter', () => {
    expect(citySummary({ cityName: 'Lanthorn Bay', date: 'MAR 2093', population: 1204, story: story() })).toEqual({
      name: 'Lanthorn Bay',
      meta: 'MAR 2093 · 1,204 residents',
      chapter: 'Chapter III · TURF LINES',
      kind: 'story',
    });
  });

  it('reads Sandbox after an ending (chosen ending, ended phase or the epilogue)', () => {
    expect(chapterLine(story({ ended: true }))).toEqual({ text: 'Sandbox', kind: 'sandbox' });
    expect(chapterLine(story({ phase: 'ended' })).text).toBe('Sandbox');
    expect(chapterLine(story({ n: 7, numeral: 'VII', title: 'Epilogue' })).text).toBe('Sandbox');
  });

  it('a chapter still waiting to start shows its number and title (the rail does too)', () => {
    expect(chapterLine(story({ n: 1, numeral: 'I', title: 'COLD BOOT', phase: 'waiting' })).text).toBe('Chapter I · COLD BOOT');
    expect(chapterLine(story({ title: '  ' })).text).toBe('Chapter III');
    expect(chapterLine(null)).toEqual({ text: '', kind: 'none' });
  });

  it('counts residents plainly', () => {
    expect(residents(0)).toBe('no residents yet');
    expect(residents(1)).toBe('1 resident');
    expect(residents(12345.6)).toBe('12,346 residents');
    expect(citySummary({ cityName: '   ', date: 'JAN 2091', population: 0, story: null })).toMatchObject({
      name: 'Unnamed city',
      meta: 'JAN 2091 · no residents yet',
      chapter: '',
    });
  });
});

describe('New City note', () => {
  it('says nothing when there is no city to replace, or it has no progress (Game.newCity keeps no backup then)', () => {
    expect(replaceNote({ current: null, keeps: true, backup: null })).toBe('');
    expect(replaceNote({ current: 'Lanthorn Bay', keeps: false, backup: 'Umbral Shoals' })).toBe('');
  });
  it('says plainly that the current city moves to the backup slot and can come back', () => {
    const n = replaceNote({ current: 'Lanthorn Bay', keeps: true, backup: null });
    expect(n).toContain('Lanthorn Bay moves to the backup slot.');
    expect(n).toContain('"Previous city" on this screen brings it back.');
    expect(n).not.toContain('replaces');
  });
  it('names the backup it replaces', () => {
    expect(replaceNote({ current: 'Lanthorn Bay', keeps: true, backup: 'Umbral Shoals' })).toContain('It replaces Umbral Shoals there.');
  });
  it('mirrors Game.newCity: a city with any progress is kept', () => {
    const empty = Array.from({ length: 16 }, () => ({ road: false, zone: 0 }));
    expect(worthKeeping({ tick: 0, buildingCount: 0, tiles: empty })).toBe(false);
    expect(worthKeeping({ tick: 3, buildingCount: 0, tiles: empty })).toBe(true);
    expect(worthKeeping({ tick: 0, buildingCount: 1, tiles: empty })).toBe(true);
    const road = empty.map((t, i) => (i === 5 ? { road: true, zone: 0 } : t));
    expect(worthKeeping({ tick: 0, buildingCount: 0, tiles: road })).toBe(true);
    const zoned = empty.map((t, i) => (i === 9 ? { road: false, zone: 1 } : t));
    expect(worthKeeping({ tick: 0, buildingCount: 0, tiles: zoned })).toBe(true);
  });
  it('matches the real Game on a fresh and a touched city', () => {
    const g = new Game();
    g.newCity('Probe', 777);
    const w = g.world;
    expect(worthKeeping({ tick: w.tick, buildingCount: w.buildings.size, tiles: w.tiles })).toBe(false);
    w.tick = 1;
    expect(worthKeeping({ tick: w.tick, buildingCount: w.buildings.size, tiles: w.tiles })).toBe(true);
  });
});

describe('the boot hold (title phase machine)', () => {
  it('boots on the title, holding the game', () => {
    const f = new StartFlow();
    expect(f.phase).toBe('title');
    expect(f.holding).toBe(true);
    expect(f.interactive).toBe(true);
    expect(f.drifting).toBe(true);
  });

  it('title → setup → title (✕ / Esc) keeps holding', () => {
    const f = new StartFlow();
    expect(f.openSetup()).toBe(true);
    expect(f.phase).toBe('setup');
    expect(f.holding).toBe(true);
    expect(f.openSetup()).toBe(false);
    expect(f.closeSetup()).toBe(true);
    expect(f.phase).toBe('title');
    expect(f.closeSetup()).toBe(false);
  });

  it('Continue: holds through the fade, releases only when it is done', () => {
    const f = new StartFlow();
    expect(f.leave()).toBe(true);
    expect(f.phase).toBe('leaving');
    expect(f.holding).toBe(true); // story surfaces and the sim wait for the fade
    expect(f.interactive).toBe(false);
    expect(f.leave()).toBe(false); // a double tap cannot leave twice
    expect(f.openSetup()).toBe(false);
    expect(f.finish()).toBe(true);
    expect(f.phase).toBe('play');
    expect(f.holding).toBe(false);
    expect(f.drifting).toBe(false);
    expect(f.finish()).toBe(false);
  });

  it('Found city leaves from the setup sheet', () => {
    const f = new StartFlow();
    f.openSetup();
    expect(f.leave()).toBe(true);
    expect(f.finish()).toBe(true);
  });

  it('Main menu shows the title again only from play', () => {
    const f = new StartFlow();
    expect(f.show()).toBe(false);
    f.leave();
    expect(f.show()).toBe(false); // not during the fade
    f.finish();
    expect(f.show()).toBe(true);
    expect(f.phase).toBe('title');
    expect(f.holding).toBe(true);
  });

  it('the fade is short', () => {
    expect(LEAVE_MS).toBeGreaterThan(0);
    expect(LEAVE_MS).toBeLessThanOrEqual(400);
  });
});

describe('title keys', () => {
  const key = (k: string, phase: StartPhase, o: Partial<{ modal: boolean; onButton: boolean; typing: boolean; repeat: boolean }> = {}) =>
    startKey({ key: k, phase, modal: false, onButton: false, typing: false, ...o });

  it('Enter is the primary button; Escape closes the setup sheet', () => {
    expect(key('Enter', 'title')).toBe('primary');
    expect(key('Enter', 'setup')).toBe('primary');
    expect(key('Enter', 'setup', { typing: true })).toBe('primary');
    expect(key('Escape', 'setup')).toBe('close-setup');
    expect(key('Escape', 'setup', { typing: true })).toBe('close-setup');
    expect(key('Escape', 'title')).toBe('block');
  });

  it('a focused button gets Enter / Space; nothing repeats', () => {
    expect(key('Enter', 'title', { onButton: true })).toBe('click-target');
    expect(key(' ', 'title', { onButton: true })).toBe('click-target');
    expect(key(' ', 'title')).toBe('block'); // never the game's pause toggle
    expect(key('Enter', 'title', { repeat: true })).toBe('block');
  });

  it('game hotkeys stay off behind the title; Tab and typing pass', () => {
    for (const k of ['1', '2', '3', 'w', 'o', 'Delete', 'ArrowUp']) expect(key(k, 'title')).toBe('block');
    expect(key('Tab', 'title')).toBe('pass');
    expect(key('a', 'setup', { typing: true })).toBe('pass');
  });

  it('a dialog over the title handles its own keys', () => {
    expect(key('Escape', 'title', { modal: true })).toBe('pass');
    expect(key('ArrowDown', 'title', { modal: true })).toBe('pass');
    expect(key('Enter', 'title', { modal: true })).toBe('block');
    expect(key('2', 'title', { modal: true })).toBe('block');
  });

  it('nothing during the fade; everything passes in play', () => {
    expect(key('Enter', 'leaving')).toBe('block');
    expect(key('Enter', 'play')).toBe('pass');
    expect(key(' ', 'play')).toBe('pass');
  });
});

describe('backdrop drift', () => {
  it('starts exactly on the framed view and eases in', () => {
    expect(driftOffset(0)).toEqual({ x: 0, y: 0 });
    expect(driftOffset(-1)).toEqual({ x: 0, y: 0 });
    const early = driftOffset(0.5);
    expect(Math.hypot(early.x, early.y)).toBeLessThan(1);
  });
  it('stays within its amplitude and moves slowly (a few px per second)', () => {
    let prev = driftOffset(0);
    for (let t = 0.1; t < 400; t += 0.1) {
      const d = driftOffset(t, 90);
      expect(Math.abs(d.x)).toBeLessThanOrEqual(90);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(90);
      expect(Math.hypot(d.x - prev.x, d.y - prev.y)).toBeLessThan(1.5); // per 0.1 s
      prev = d;
    }
  });
});

describe('install tip', () => {
  const env: HintEnv = { coarse: true, standalone: false, topLevel: true, dismissed: false, ios: false, web: true, returning: true };
  it('shows on a touch browser tab that is not installed', () => {
    expect(a2hsHint(env)).toMatch(/add to home screen/i);
    expect(a2hsHint({ ...env, ios: true })).toContain('Share');
  });
  it('waits for a returning player: never on the very first launch', () => {
    expect(a2hsHint({ ...env, returning: false })).toBeNull();
  });
  it('never when installed, dismissed, on desktop, in a frame or from a file', () => {
    expect(a2hsHint({ ...env, standalone: true })).toBeNull();
    expect(a2hsHint({ ...env, dismissed: true })).toBeNull();
    expect(a2hsHint({ ...env, coarse: false })).toBeNull();
    expect(a2hsHint({ ...env, topLevel: false })).toBeNull();
    expect(a2hsHint({ ...env, web: false })).toBeNull();
  });
});

describe('boot resume toast timer (held while the title is up)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a quick Continue still gets the full 1.6 s of play before the toast', () => {
    const fired: number[] = [];
    let now = 0;
    const t = new HeldTimer(1600, () => fired.push(now));
    t.schedule(); // StoryUI constructor (onWorld)
    t.hold(true); // the title comes up straight after
    expect(t.pending).toBe(true);
    now = 200;
    vi.advanceTimersByTime(200); // Continue tapped 0.2 s after load…
    vi.advanceTimersByTime(380); // …the fade…
    t.hold(false); // …and play starts
    vi.advanceTimersByTime(1599);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired.length).toBe(1);
    expect(t.pending).toBe(false);
  });

  it('never fires while held, however long the title stays up', () => {
    let n = 0;
    const t = new HeldTimer(1600, () => n++);
    t.hold(true);
    t.schedule(); // a world loaded behind the title (Found city, Previous city)
    vi.advanceTimersByTime(60_000);
    expect(n).toBe(0);
    t.hold(false);
    vi.advanceTimersByTime(1600);
    expect(n).toBe(1);
  });

  it('a hold after it fired owes nothing (Main menu → Continue: no second toast)', () => {
    let n = 0;
    const t = new HeldTimer(1600, () => n++);
    t.schedule();
    vi.advanceTimersByTime(2000);
    expect(n).toBe(1);
    t.hold(true);
    t.hold(false);
    vi.advanceTimersByTime(5000);
    expect(n).toBe(1);
  });

  it('a new schedule replaces the old one; cancel drops it', () => {
    let n = 0;
    const t = new HeldTimer(1600, () => n++);
    t.schedule();
    vi.advanceTimersByTime(1000);
    t.schedule();
    vi.advanceTimersByTime(1000);
    expect(n).toBe(0);
    vi.advanceTimersByTime(600);
    expect(n).toBe(1);
    t.schedule();
    t.cancel();
    vi.advanceTimersByTime(5000);
    expect(n).toBe(1);
  });
});

describe('stored save at boot', () => {
  it('none, the loaded city, or a save the game could not read', () => {
    const g = new Game();
    g.newCity('Readable', 4242);
    g.world.tick = 37;
    const raw = JSON.stringify(g.world.serialize());
    expect(saveState(null, g.world)).toBe('none');
    expect(saveState(raw, g.world)).toBe('loaded');
    // The game fell back to a fresh random city: its seed or day no longer match the stored one.
    expect(saveState(raw, { seed: g.world.seed ^ 1, tick: 0 })).toBe('unreadable');
    expect(saveState('{not json', g.world)).toBe('unreadable');
    expect(saveState('null', g.world)).toBe('unreadable');
  });
});

describe('first-launch showcase backdrop', () => {
  it('is a lit, settled city of its own, deterministic, and quick to build', () => {
    const t0 = performance.now();
    const w = buildShowcase();
    const ms = performance.now() - t0;
    let roads = 0;
    let lots = 0;
    let towers = 0;
    let dark = 0;
    let young = 0;
    for (const t of w.tiles) {
      if (t.road) roads++;
      if (t.zone !== ZoneType.None && t.level > 0) {
        lots++;
        if (t.level === 3) towers++;
        if (!t.powered) dark++;
        if (t.age < 24) young++;
      }
    }
    expect(roads).toBeGreaterThan(150);
    expect(lots).toBeGreaterThan(300);
    expect(towers).toBeGreaterThan(20);
    expect(w.buildings.size).toBeGreaterThanOrEqual(5);
    expect(dark).toBe(0); // no unpowered glyphs
    expect(young).toBe(0); // no construction scaffolds
    expect(w.stats.population).toBeGreaterThan(10000); // street and sky traffic scale with it
    expect(ms).toBeLessThan(1000);
    const again = buildShowcase();
    expect(again.serialize().tiles).toEqual(w.serialize().tiles);
    expect(again.stats.population).toBe(w.stats.population);
  });

  it('never touches the game: its world is separate from the city the player founds', () => {
    const g = new Game();
    g.newCity('Untouched', 9001);
    const snap = () => ({ ...g.world.serialize(), savedAt: 0 });
    const before = snap();
    const w = buildShowcase();
    expect(w).not.toBe(g.world);
    expect(w.events).not.toBe(g.events);
    expect(snap()).toEqual(before);
  });
});

describe('hold contract with a real Game', () => {
  /** A horizontal run of land tiles near the middle of the map. */
  function landRun(g: Game, len: number): { x: number; y: number } | null {
    const w = g.world;
    const N = w.N;
    for (let d = 0; d < N / 2; d++)
      for (const y of [N / 2 + d, N / 2 - d]) {
        for (let x = 4; x + len < N - 4; x++) {
          let ok = true;
          for (let i = 0; i < len && ok; i++) ok = w.tileAt(x + i, y)?.terrain === Terrain.Land;
          if (ok) return { x, y };
        }
      }
    return null;
  }

  it('a brand-new city: nothing while held, then the Chapter I title, then the boot card', () => {
    const g = new Game();
    g.newCity('Holdfast', 2091);
    const events: string[] = [];
    g.events.on('chapter', (c) => events.push(`chapter:${c.n}`));
    g.events.on('card', (c) => {
      if (c) events.push(`card:${c.id}`);
    });

    // On the title: speed 0 and no game.update at all (main.ts), however long it stays up.
    g.setSpeed(0);
    expect(events).toEqual([]);

    // Leave the title: 1×, then the player lays the first road.
    g.setSpeed(1);
    const at = landRun(g, 6);
    expect(at).not.toBeNull();
    g.setTool('road');
    expect(g.apply(at!, { x: at!.x + 5, y: at!.y }).valid).toBe(true);
    for (let i = 0; i < 900 && !events.some((e) => e.startsWith('card:')); i++) g.update(0.05);

    const ch = events.indexOf('chapter:1');
    const boot = events.indexOf('card:ch1.boot');
    expect(ch).toBeGreaterThanOrEqual(0);
    expect(boot).toBeGreaterThan(ch);
  });
});

describe('title warning for a save the game cannot continue', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('a newer build\'s save is explained (FUTURE_SAVE_TEXT), never called unreadable', () => {
    expect(TITLE_FUTURE_TEXT).toBe(FUTURE_SAVE_TEXT);
    expect(titleWarning({ unreadable: false, future: false })).toBe('');
    expect(titleWarning({ unreadable: true, future: false })).toMatch(/could not be read/);
    expect(titleWarning({ unreadable: true, future: true })).toBe(FUTURE_SAVE_TEXT);
  });

  it('a real stale Game on a newer save: blocked, no Continue, the warning shows until New City', () => {
    const src = new Game();
    src.newCity('Future Reach', 4243);
    const v4 = JSON.stringify({ ...src.world.serialize(), version: 5 });
    const m = new Map<string, string>([[SAVE_KEY, v4]]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    };
    const g = new Game();
    expect(g.saveBlocked).toBe(true);
    // main.ts: hasCity needs a loaded save and no block; the stored string is not ours, so saveState says 'unreadable'.
    expect(saveState(m.get(SAVE_KEY)!, g.world)).toBe('unreadable');
    expect(titleWarning({ unreadable: false, future: g.saveBlocked })).toBe(FUTURE_SAVE_TEXT);
    expect(m.get(SAVE_KEY)).toBe(v4);
    g.newCity('Fresh Start');
    expect(titleWarning({ unreadable: false, future: g.saveBlocked })).toBe('');
  });
});
