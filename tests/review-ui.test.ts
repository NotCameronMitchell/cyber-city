// Review fixes, UI layer (fix-b): the Seaport card tells a built-up waterfront from a map with no
// straight shore; Main menu drops a plan waiting for ✓; a tool's first-use tip never outlives
// its tool; the first launch's Watch toast follows the unpaused launch lead, not the wall clock.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game/game';
import { shoreGeometry, shoreSites } from '../src/game/ports';
import { Terrain } from '../src/game/types';
import { World } from '../src/game/world';
import { NO_SHORE, SHORE_BUILT, seaportNote } from '../src/ui/dock';
import { Toasts } from '../src/ui/feedback';
import { holdGame } from '../src/ui/start/startModel';
import { Tips } from '../src/ui/tips';
import { flatWorld } from './helpers';

const N = 64;

// ── A tiny fake DOM: enough for h(), classes, hidden, prepend/append/remove ──

interface FakeEl {
  tagName: string;
  className: string;
  textContent: string;
  innerHTML: string;
  hidden: boolean;
  offsetWidth: number;
  parent: FakeEl | null;
  children: FakeEl[];
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean; toggle(c: string, on?: boolean): void };
  style: { setProperty(k: string, v: string): void };
  setAttribute(k: string, v: string): void;
  append(...c: (FakeEl | string)[]): void;
  prepend(...c: (FakeEl | string)[]): void;
  remove(): void;
  addEventListener(): void;
}

function fakeEl(tag: string): FakeEl {
  const classes = new Set<string>();
  const el: FakeEl = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    offsetWidth: 0,
    parent: null,
    children: [],
    attrs: {},
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
    },
    style: { setProperty: () => undefined },
    setAttribute(k, v) {
      if (k === 'hidden') el.hidden = true;
      el.attrs[k] = v;
    },
    append(...c) {
      for (const x of c)
        if (typeof x !== 'string') {
          x.parent = el;
          el.children.push(x);
        }
    },
    prepend(...c) {
      for (const x of c)
        if (typeof x !== 'string') {
          x.parent = el;
          el.children.unshift(x);
        }
    },
    remove() {
      if (!el.parent) return;
      const i = el.parent.children.indexOf(el);
      if (i >= 0) el.parent.children.splice(i, 1);
      el.parent = null;
    },
    addEventListener: () => undefined,
  };
  return el;
}

const g0 = globalThis as Record<string, unknown>;
const saved = { document: g0.document, window: g0.window };
beforeAll(() => {
  g0.document = { createElement: (tag: string) => fakeEl(tag) };
  g0.window = globalThis;
});
afterAll(() => {
  g0.document = saved.document;
  g0.window = saved.window;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ui-3: the Seaport card on a built-up waterfront', () => {
  it('a street on every waterfront tile leaves no clear site but the shore is still there: "Shore built up"', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12 && checked < 3; seed++) {
      const w = World.generate(seed * 104729);
      const marks = new Uint8Array(N * N);
      if (shoreSites(w, marks) === 0) continue;
      expect(seaportNote(shoreSites(w, marks), shoreGeometry(w))).toBeNull();
      const geometry = shoreGeometry(w);
      expect(geometry).toBeGreaterThan(0);
      // A coastal road: every land tile beside water gets a street.
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const t = w.tiles[y * N + x];
          if (t.terrain !== Terrain.Land || t.buildingId >= 0) continue;
          const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.tiles[(y + dy) * N + x + dx]?.terrain === Terrain.Water && x + dx >= 0 && x + dx < N);
          if (wet) w.setRoad(x, y);
        }
      const sites = shoreSites(w, marks);
      if (sites > 0) continue; // a site set back from the coastal road survived on this seed
      expect(shoreGeometry(w)).toBe(geometry); // roads never change the map's shape
      expect(seaportNote(sites, shoreGeometry(w))).toBe(SHORE_BUILT);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a map with no straight shore at all keeps "No straight shore here"', () => {
    const w = flatWorld(3);
    expect(shoreSites(w, new Uint8Array(N * N))).toBe(0);
    expect(shoreGeometry(w)).toBe(0);
    expect(seaportNote(0, shoreGeometry(w))).toBe(NO_SHORE);
  });
});

describe('ui-4: Main menu drops a plan waiting for ✓', () => {
  it('holdGame clears pendingConfirm with the preview, so Enter later has nothing to buy', () => {
    const g = new Game();
    const w = flatWorld(5150, 'Test Reach');
    w.funds = 1e7;
    w.maxPopulation = 1e6;
    expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
    g.world.setRoad(30, 29);
    g.setTool('arcology');
    const p = g.commit({ x: 31, y: 31 }, { x: 31, y: 31 });
    expect(p.valid && p.confirm).toBe(true);
    expect(g.pendingConfirm).not.toBeNull();
    holdGame(g);
    expect(g.pendingConfirm).toBeNull();
    expect(g.preview).toBeNull();
    expect(g.speed).toBe(0);
    expect(g.confirmPending()).toBeNull();
    expect(g.world.buildings.size).toBe(0);
  });
});

describe('ui-5: a tool tip never outlives its tool', () => {
  it('switching tools hides the old tool tip unseen (it shows again next time); hint tips stay', () => {
    const slot = fakeEl('div');
    const tips = new Tips(slot as unknown as HTMLElement, () => false);
    tips.onToolChange('seaport');
    tips.onTool('seaport');
    tips.update(0.25);
    expect(tips.showing).toBe('seaport');
    // The port is built, the tip is back on screen; the player picks Bulldoze.
    tips.onHint('wealth');
    tips.onToolChange('bulldoze');
    tips.onTool('bulldoze');
    tips.update(0.25);
    expect(tips.showing).not.toBe('seaport');
    expect(tips.pending).not.toContain('seaport');
    // The hint tip was not dropped.
    expect(tips.pending).toContain('wealth');
    // Not marked seen: picking the Seaport again queues it again.
    tips.onToolChange('seaport');
    tips.onTool('seaport');
    expect(tips.pending).toContain('seaport');
    // A queued tool tip for another tool goes too; the current tool's own stays.
    tips.onToolChange('avenue');
    tips.onTool('avenue');
    expect(tips.pending).not.toContain('seaport');
    expect(tips.pending).toContain('avenue');
  });
});

describe('ui-7: the first launch Watch toast follows the unpaused lead', () => {
  const watch = { id: 'watch' as const, label: 'Watch', sec: 10 };
  const liveCount = (t: Toasts) => (t.el as unknown as FakeEl).children.length;

  it('a pause longer than 10 s does not time the Watch button out while the lead is still running', () => {
    vi.useFakeTimers();
    const toasts = new Toasts();
    const lead = { left: 9.7 as number | null };
    toasts.hooks = { run: () => undefined, alive: (id) => id !== 'watch' || lead.left !== null, left: () => lead.left ?? 0 };
    toasts.push('First launch in 10 s', 'info', watch);
    expect(liveCount(toasts)).toBe(1);
    // Paused for 11.5 s: the lead does not move.
    vi.advanceTimersByTime(11500);
    toasts.flush();
    expect(liveCount(toasts)).toBe(1);
    // Liftoff: the lead ends and flush takes the toast with it.
    lead.left = null;
    toasts.flush();
    vi.advanceTimersByTime(500);
    expect(liveCount(toasts)).toBe(0);
  });

  it('a Watch toast that waited behind a story card for longer than 10 s still shows while the lead runs', () => {
    vi.useFakeTimers();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const toasts = new Toasts();
    let held = true;
    toasts.held = () => held;
    const lead = { left: 9.6 as number | null };
    toasts.hooks = { run: () => undefined, alive: (id) => id !== 'watch' || lead.left !== null, left: () => lead.left ?? 0 };
    toasts.push('First launch in 10 s', 'info', watch);
    expect(liveCount(toasts)).toBe(0);
    now += 15000;
    held = false;
    toasts.flush();
    expect(liveCount(toasts)).toBe(1);
  });

  it('Undo keeps its wall-clock window', () => {
    vi.useFakeTimers();
    const toasts = new Toasts();
    toasts.hooks = { run: () => undefined, alive: () => true, left: () => 10 };
    toasts.push('Street ×12', 'info', { id: 'undo', label: 'Undo', sec: 10 });
    vi.advanceTimersByTime(10500);
    expect(liveCount(toasts)).toBe(0);
  });
});
