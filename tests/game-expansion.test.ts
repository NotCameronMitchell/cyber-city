// Game-side expansion logic (docs/EXPANSION.md §5.3, §7.4, §7.7, WP-2): the confirm flow,
// one-step undo (10 s), building refunds (30 s), Spaceport construction in real seconds and
// real-time launches (with a fake clock: update(dt) frames), the one-time settleWealth for
// old saves, inspect rows / notes / actions, tool prices and the sfx map.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILDINGS, DAY_CYCLE_SECONDS, SAFETY, SKYWAY, SPACEPORT } from '../src/game/config';
import type { GameEventMap } from '../src/game/events';
import { Game } from '../src/game/game';
import { Simulation } from '../src/game/sim';
import { SKY_E, SKY_RAMP, SKY_W } from '../src/game/skyway';
import { storyContent } from '../src/game/story/conditions';
import { RoadKind, Terrain, ZoneType, type Building, type ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { flatWorld } from './helpers';

/** A Game on a flat rich map with everything unlocked, and a fake wall clock. */
function richGame(seed = 5150): { g: Game; clock: { t: number } } {
  const g = new Game();
  const w = flatWorld(seed, 'Test Reach');
  w.funds = 1e7;
  w.maxPopulation = 1e6;
  expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
  const clock = { t: 1000 };
  g.now = () => clock.t;
  return { g, clock };
}

/** Collect events of one kind. */
function record<K extends keyof GameEventMap>(g: Game, kind: K): GameEventMap[K][] {
  const out: GameEventMap[K][] = [];
  g.events.on(kind, (e) => out.push(e));
  return out;
}

const use = (g: Game, tool: ToolId, from: { x: number; y: number }, to = from) => {
  g.setTool(tool);
  return g.apply(from, to);
};

afterEach(() => vi.restoreAllMocks());

describe('confirm (§7.7)', () => {
  it('commit() holds a costly building for ✓; confirmPending builds it, cancelPending and setTool drop it', () => {
    const { g } = richGame();
    const w = g.world;
    w.setRoad(30, 29);
    g.setTool('arcology');
    const funds = w.funds;
    const p = g.commit({ x: 31, y: 31 }, { x: 31, y: 31 });
    expect(p.valid && p.confirm).toBe(true);
    expect(g.pendingConfirm?.tool).toBe('arcology');
    expect(g.preview).toBe(p); // the ghost stays
    expect(w.buildings.size).toBe(0);
    expect(w.funds).toBe(funds);
    g.cancelPending();
    expect(g.pendingConfirm).toBeNull();
    expect(g.preview).toBeNull();
    g.commit({ x: 31, y: 31 }, { x: 31, y: 31 });
    const done = g.confirmPending()!;
    expect(done.valid).toBe(true);
    expect(w.buildingAt(31, 31)?.type).toBe('arcology');
    expect(w.funds).toBe(funds - BUILDINGS.arcology.cost);
    expect(g.pendingConfirm).toBeNull();
    // A tool change drops a pending plan; a cheap building commits at once.
    g.setTool('spire');
    g.commit({ x: 40, y: 30 }, { x: 40, y: 30 });
    expect(g.pendingConfirm).not.toBeNull();
    g.setTool('solar');
    expect(g.pendingConfirm).toBeNull();
    expect(g.commit({ x: 40, y: 30 }, { x: 40, y: 30 }).valid).toBe(true);
    expect(w.buildingAt(40, 30)?.type).toBe('solar');
    expect(g.pendingConfirm).toBeNull();
  });

  it('a highway that strands lots waits for ✓; ✓ re-plans and refuses if it is no longer affordable', () => {
    const { g } = richGame();
    const w = g.world;
    for (let x = 10; x <= 14; x++) {
      w.setRoad(x, 30);
      w.setZone(x, 31, ZoneType.Residential);
      w.setLevel(x, 31, 1);
    }
    g.setTool('highway');
    const p = g.commit({ x: 10, y: 30 }, { x: 14, y: 30 });
    expect(p.confirm).toBe(true);
    expect(p.note).toBe('5 blocks lose road access');
    expect(w.tileAt(12, 30)!.roadKind).toBe(RoadKind.Street);
    const toasts = record(g, 'toast');
    w.funds = 10;
    expect(g.confirmPending()!.valid).toBe(false);
    expect(toasts.at(-1)?.text).toMatch(/Not enough credits/);
    expect(w.tileAt(12, 30)!.roadKind).toBe(RoadKind.Street);
  });
});

describe('undo (§7.7)', () => {
  it('restores tiles and credits inside 10 s, with an Undo toast; refuses after the window', () => {
    const { g, clock } = richGame();
    const w = g.world;
    const toasts = record(g, 'toast');
    const funds = w.funds;
    expect(use(g, 'road', { x: 10, y: 10 }, { x: 20, y: 10 }).valid).toBe(true);
    expect(toasts.at(-1)).toEqual({ text: 'Street ×11', kind: 'info', action: { id: 'undo', label: 'Undo', sec: SAFETY.undoSec } });
    expect(g.undoLeft()).toBe(SAFETY.undoSec);
    clock.t += 9;
    expect(g.undoLeft()).toBeCloseTo(1);
    const sfx = record(g, 'sfx');
    expect(g.undo()).toBe(true);
    expect(w.isRoad(15, 10)).toBe(false);
    expect(w.funds).toBe(funds);
    expect(toasts.at(-1)?.text).toBe('Undone');
    expect(sfx).toEqual(['click']);
    expect(g.undoLeft()).toBe(0);
    expect(g.undo()).toBe(false); // one step only
    // Too late.
    use(g, 'road', { x: 10, y: 12 }, { x: 20, y: 12 });
    clock.t += SAFETY.undoSec + 0.5;
    expect(g.undoLeft()).toBe(0);
    expect(g.undo()).toBe(false);
    expect(toasts.at(-1)?.text).toBe('Too late to undo');
    expect(w.isRoad(15, 12)).toBe(true);
  });

  it('refuses when a tile changed meanwhile (a lot developed)', () => {
    const { g } = richGame();
    const w = g.world;
    const toasts = record(g, 'toast');
    use(g, 'res', { x: 10, y: 10 }, { x: 12, y: 12 });
    expect(toasts.at(-1)?.text).toBe('Zoned 9 lots');
    w.setLevel(11, 11, 1);
    expect(g.undo()).toBe(false);
    expect(toasts.at(-1)?.text).toBe('Too late to undo');
    expect(w.tileAt(10, 10)!.zone).toBe(ZoneType.Residential);
  });

  it('undoes kind changes and skyways (ramp bits come back), and any other action clears it', () => {
    const { g } = richGame();
    const w = g.world;
    for (let x = 10; x <= 20; x++) w.setRoad(x, 20);
    use(g, 'avenue', { x: 10, y: 20 }, { x: 20, y: 20 });
    expect(w.tileAt(15, 20)!.roadKind).toBe(RoadKind.Avenue);
    expect(g.undo()).toBe(true);
    expect(w.tileAt(15, 20)!.roadKind).toBe(RoadKind.Street);
    // A skyway from the street, then an extension through its ramp, undone.
    use(g, 'skyway', { x: 10, y: 20 }, { x: 15, y: 20 });
    const ramp = w.idx(10, 20);
    expect(w.sky[ramp]).toBe(SKY_E | SKY_RAMP);
    g.undo();
    expect(w.sky.every((v) => v === 0)).toBe(true);
    use(g, 'skyway', { x: 10, y: 20 }, { x: 15, y: 20 });
    use(g, 'skyway', { x: 5, y: 20 }, { x: 10, y: 20 });
    expect(w.sky[ramp]).toBe(SKY_E | SKY_W);
    const before = w.funds;
    expect(g.undo()).toBe(true);
    expect(w.sky[ramp]).toBe(SKY_E | SKY_RAMP);
    expect(w.sky[w.idx(7, 20)]).toBe(0);
    expect(w.funds).toBe(before + 5 * SKYWAY.perTile);
    // Any other action replaces the snapshot.
    use(g, 'road', { x: 30, y: 30 }, { x: 35, y: 30 });
    expect(g.undoLeft()).toBeGreaterThan(0);
    use(g, 'plaza', { x: 40, y: 40 });
    expect(g.undoLeft()).toBe(0);
    use(g, 'road', { x: 30, y: 32 }, { x: 35, y: 32 });
    use(g, 'bulldoze', { x: 30, y: 30 });
    expect(g.undoLeft()).toBe(0); // bulldoze is not undoable and ends the window
  });
});

describe('refund (§7.7)', () => {
  it('a building bulldozed within 30 s is refunded in full; later, only the usual demolition', () => {
    const { g, clock } = richGame();
    const w = g.world;
    const funds = w.funds;
    use(g, 'clinic', { x: 20, y: 20 });
    expect(w.funds).toBe(funds - BUILDINGS.clinic.cost);
    clock.t += 20;
    expect(g.refundLeft(w.buildingAt(20, 20)!.id)).toBeCloseTo(10);
    g.setTool('bulldoze');
    expect(g.plan({ x: 20, y: 20 }, { x: 21, y: 21 }).refund).toBe(BUILDINGS.clinic.cost);
    const toasts = record(g, 'toast');
    const p = g.apply({ x: 20, y: 20 }, { x: 21, y: 21 });
    expect(p.refund).toBe(BUILDINGS.clinic.cost);
    expect(w.buildings.size).toBe(0);
    expect(w.funds).toBe(funds); // the price and the demolition fee both come back
    expect(toasts.some((t) => t.text === 'Refunded 2,600 CR')).toBe(true);
    // After the window: no refund.
    use(g, 'clinic', { x: 20, y: 20 });
    clock.t += SAFETY.refundSec + 1;
    g.setTool('bulldoze');
    expect(g.plan({ x: 20, y: 20 }, { x: 20, y: 20 }).refund).toBeUndefined();
    const f2 = w.funds;
    g.apply({ x: 20, y: 20 }, { x: 20, y: 20 });
    expect(w.funds).toBe(f2 - Math.round(BUILDINGS.clinic.cost * 0.05));
  });
});

// ── Spaceport: construction floor and launches ──────────────────────────────

/** Run `sec` unpaused seconds of frames; answer any story card that opens (none should). */
function run(g: Game, sec: number, each?: (t: number) => void) {
  for (let t = 0; t < sec; t += 0.25) {
    each?.(t);
    g.update(0.25);
    if (g.story.blocking) g.choose(0);
  }
}

/** A powered, complete spaceport (reactor beside it) in a game whose world was just loaded. */
function launchGame(dayNight: boolean): { g: Game; sp: Building } {
  const { g } = richGame();
  g.settings.dayNight = dayNight;
  const w = g.world;
  w.addBuilding('reactor', 20, 20);
  const sp = w.addBuilding('spaceport', 23, 20)!;
  sp.buildDays = 0;
  g.sim.recomputeAll();
  expect(sp.powered).toBe(true);
  return { g, sp };
}

describe('Spaceport construction in real seconds (§5.3)', () => {
  it('placement sets waitSec 240; it counts down per unpaused frame at any speed and finishes the build', () => {
    const { g } = richGame();
    const w = g.world;
    w.setRoad(30, 29);
    w.addBuilding('reactor', 27, 30); // beside the pad: power conducts through buildings
    use(g, 'spaceport', { x: 32, y: 32 });
    const sp = w.buildingAt(30, 30)!;
    expect(sp.type).toBe('spaceport');
    expect(sp.buildDays).toBe(240);
    expect(sp.waitSec).toBe(SPACEPORT.minBuildSec);
    g.setSpeed(0);
    run(g, 5);
    expect(sp.waitSec).toBe(SPACEPORT.minBuildSec); // paused: nothing moves
    g.setSpeed(3);
    run(g, 20);
    expect(sp.waitSec).toBeCloseTo(220, 5);
    expect(sp.buildDays).toBe(1); // 320 days have run: the countdown holds at 1 for the clock
    const info = g.getTileInfo(30, 30)!;
    expect(info.rows[0][0]).toBe('Building');
    expect(info.notes?.map((n) => n.text)).toContain('Takes 240 days and at least 4 minutes of play.');
    const toasts = record(g, 'toast');
    const lifts = record(g, 'liftoff');
    g.settings.dayNight = false; // always night: the first launch waits only for the clock
    run(g, 221);
    expect(sp.buildDays).toBe(0);
    expect(g.launchStatus(sp.id)!.complete).toBe(true);
    // Completed in this world: its launch clock starts at a full gap, so the 10 s lead begins at once.
    const lead = toasts.find((t) => t.action?.id === 'watch');
    expect(lead).toEqual({ text: 'First launch in 10 s', kind: 'info', action: { id: 'watch', label: 'Watch', sec: SPACEPORT.firstLeadSec } });
    run(g, 10.5);
    expect(lifts).toEqual([{ id: sp.id, first: true }]);
  });
});

describe('launches (§5.3)', () => {
  it('after a load the clock starts at half a gap; the first launch is announced 10 s ahead, then ≥ 180 s apart', () => {
    const { g, sp } = launchGame(false);
    const lifts: { t: number; first: boolean }[] = [];
    const toasts: { t: number; text: string }[] = [];
    const moments = record(g, 'moment');
    const news = record(g, 'news');
    let now = 0;
    g.events.on('liftoff', (e) => lifts.push({ t: now, first: e.first }));
    g.events.on('toast', (e) => toasts.push({ t: now, text: e.text }));
    run(g, 480, (t) => (now = t));
    const lead = toasts.find((x) => x.text === 'First launch in 10 s')!;
    expect(lead.t).toBeCloseTo(SPACEPORT.launchGapSec / 2, 0);
    expect(lifts.map((l) => l.first)).toEqual([true, false, false]);
    expect(lifts[0].t - lead.t).toBeCloseTo(SPACEPORT.firstLeadSec, 0);
    for (let k = 1; k < lifts.length; k++) expect(lifts[k].t - lifts[k - 1].t).toBeGreaterThanOrEqual(SPACEPORT.launchGapSec - 0.3);
    expect(sp.launches).toBe(3);
    expect(moments.filter((m) => m.id === 'launch')).toHaveLength(1);
    expect(g.world.moments.has('launch')).toBe(true);
    // One rotating news line per liftoff, and only then.
    expect(news.filter((n) => /^(Launch night|Another launch|The spaceport lights)/.test(n.text)).map((n) => n.text)).toEqual([
      'Launch night: a cargo lifter climbs out of Test Reach on a column of light.',
      'Another launch. Half of shadeside is on the roofs to watch it go.',
      "The spaceport lights the low clouds orange for eleven seconds. Then it's gone.",
    ]);
    // Paused time doesn't count.
    g.setSpeed(0);
    run(g, 400);
    expect(lifts).toHaveLength(3);
  });

  it('readyLaunches (harness hook) makes a loaded Spaceport due at once; it skips one under construction', () => {
    const { g, sp } = launchGame(false);
    const toasts = record(g, 'toast');
    g.readyLaunches();
    run(g, 0.5);
    expect(toasts.map((t) => t.text)).toContain('First launch in 10 s');
    const { g: g2, sp: sp2 } = launchGame(false);
    sp2.buildDays = 40;
    g2.readyLaunches();
    expect(g2.launchStatus(sp2.id)!.complete).toBe(false);
    expect(sp.launches ?? 0).toBe(0);
  });

  it('no liftoff by day; one at night; never two in the same visual night at speed 1', () => {
    const { g, sp } = launchGame(true);
    const lifts = record(g, 'liftoff');
    const noon = DAY_CYCLE_SECONDS * 0.5;
    run(g, 400, () => (g.clock = noon)); // hold the sun up
    expect(g.daylight).toBeGreaterThan(SPACEPORT.nightBelow);
    expect(lifts).toHaveLength(0);
    expect(g.launchStatus(sp.id)!.gapLeft).toBe(0); // only the night is missing
    let nightsWithLaunch = new Map<number, number>();
    let k = 0;
    sp.launches = 1; // not the first: no lead
    g.events.on('liftoff', () => {
      const night = Math.floor((g.clock + DAY_CYCLE_SECONDS * 0.25) / DAY_CYCLE_SECONDS);
      nightsWithLaunch.set(night, (nightsWithLaunch.get(night) ?? 0) + 1);
      k++;
      expect(g.daylight).toBeLessThan(SPACEPORT.nightBelow);
    });
    run(g, 1200);
    expect(k).toBeGreaterThanOrEqual(3);
    for (const n of nightsWithLaunch.values()) expect(n).toBe(1);
    nightsWithLaunch = new Map();
  });

  it('a pending first launch is dropped when the world is replaced', () => {
    const { g } = launchGame(false);
    const lifts = record(g, 'liftoff');
    run(g, SPACEPORT.launchGapSec / 2 + 2); // inside the 10 s lead
    expect(g.launchLead).not.toBeNull();
    expect(g.restore(JSON.parse(JSON.stringify(g.world.serialize())))).toBe(true);
    expect(g.launchLead).toBeNull();
    run(g, 20);
    expect(lifts).toHaveLength(0);
  });

  it('an unpowered or offline spaceport holds its launches', () => {
    const { g, sp } = launchGame(false);
    sp.launches = 1;
    sp.offline = 9999;
    const lifts = record(g, 'liftoff');
    run(g, 300);
    expect(lifts).toHaveLength(0);
    const rows = Object.fromEntries(g.getTileInfo(sp.x, sp.y)!.rows);
    expect(rows['Next launch']).toBe('On hold');
  });
});

// ── Loading, inspect, prices ────────────────────────────────────────────────

describe('old saves settle once (§4.3)', () => {
  it('calls settleWealth exactly once for a v1 / v2 load and never for a v3 load', () => {
    const spy = vi.spyOn(Simulation.prototype, 'settleWealth');
    const { g } = richGame(); // a v3 restore
    expect(spy).not.toHaveBeenCalled();
    const data = JSON.parse(JSON.stringify(g.world.serialize()));
    data.version = 2;
    expect(g.restore(data)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    data.version = 1;
    delete data.story;
    expect(g.restore(data)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('inspect (§7.4)', () => {
  /** Every standard value ≤ 12 characters, every note ≤ 60. */
  const fits = (g: Game, x: number, y: number, sky = false) => {
    const info = g.getTileInfo(x, y, sky)!;
    for (const [label, v] of info.rows) expect(v.length, `${label}: ${v}`).toBeLessThanOrEqual(12);
    for (const n of info.notes ?? []) expect(n.text.length, n.text).toBeLessThanOrEqual(60);
    return info;
  };

  it('road kinds: titles, bridges, highway ramps and alley notes', () => {
    const { g } = richGame();
    const w = g.world;
    for (let y = 10; y <= 30; y++) w.setRoad(20, y, RoadKind.Highway);
    let info = fits(g, 20, 15);
    expect(info.title).toBe('Highway');
    expect(Object.fromEntries(info.rows).Ramps).toBe('0');
    expect(info.notes).toEqual([{ text: 'No on-ramps: nothing can use it', tone: 'warn' }]);
    use(g, 'road', { x: 17, y: 20 }, { x: 23, y: 20 });
    info = fits(g, 20, 15);
    expect(Object.fromEntries(info.rows).Ramps).toBe('2');
    expect(info.notes).toBeUndefined();
    expect(fits(g, 19, 20).title).toBe('On-ramp');
    const street = fits(g, 17, 20);
    expect(street.title).toBe('Street');
    expect(street.subtitle).toBe('Lots within 3 tiles can grow here.');
    w.tiles[w.idx(40, 40)].terrain = Terrain.Water;
    w.setRoad(40, 40, RoadKind.Avenue);
    expect(fits(g, 40, 40)).toMatchObject({ title: 'Avenue bridge', subtitle: 'A road on piers over the water.' });
    w.setRoad(45, 45, RoadKind.Alley);
    const alley = fits(g, 45, 45);
    expect(alley.title).toBe('Back Alley');
    expect(alley.rows.map((r) => r[0])).toEqual(['Traffic', 'Crime']);
    expect(alley.notes?.[0].text).toBe('Homes beside it stay affordable');
    // A border road whose inward neighbour joins it is a regional link.
    w.setRoad(0, 50);
    w.setRoad(1, 50);
    expect(fits(g, 0, 50).notes).toEqual([{ text: 'Regional link: +1 trade', tone: 'good' }]);
  });

  it('zone tiles: the Wealth row with its meter ticks, and the highway-only note', () => {
    const { g } = richGame();
    const w = g.world;
    w.setRoad(10, 10);
    w.setZone(11, 11, ZoneType.Residential);
    w.setLevel(11, 11, 1);
    w.setZone(12, 11, ZoneType.Residential);
    let info = fits(g, 11, 11);
    expect(info.rows[1][0]).toBe('Wealth');
    expect(info.rows[1][1]).toMatch(/^\$ \d+%$/);
    expect(info.meter).toEqual({ row: 1, ticks: [0.32, 0.46] });
    expect(Object.fromEntries(fits(g, 12, 11).rows).Wealth).toMatch(/^opens \$/);
    expect(fits(g, 12, 11).meter).toBeUndefined();
    // Only a highway nearby.
    w.setZone(40, 41, ZoneType.Residential);
    for (let x = 35; x <= 45; x++) w.setRoad(x, 40, RoadKind.Highway);
    info = fits(g, 40, 41);
    expect(Object.fromEntries(info.rows)['Road access']).toBe('none');
    expect(info.notes).toContainEqual({ text: 'Highway only: lots need a street or avenue', tone: 'warn' });
    // Streets-only lots keep today's value.
    w.setZone(60, 60, ZoneType.Residential);
    expect(Object.fromEntries(fits(g, 60, 60).rows)['Road access']).toBe('NO ROAD');
  });

  it('the skyway sheet (a tap on the deck), the ground under it, and the demolish action', () => {
    const { g } = richGame();
    const w = g.world;
    use(g, 'skyway', { x: 30, y: 30 }, { x: 35, y: 30 });
    let info = fits(g, 32, 30, true);
    expect(info.title).toBe('Skyway');
    expect(info.rows).toEqual([
      ['Load', '0%'],
      ['Ramps', '0'],
      ['Docks', '0'],
    ]);
    expect(info.notes).toEqual([{ text: 'Lands nowhere: add a ramp or dock', tone: 'warn' }]);
    expect(fits(g, 32, 30).notes).toEqual([{ text: 'Skyway overhead: tap the deck' }]);
    // A closed ramp says why.
    w.setRoad(40, 40);
    use(g, 'skyway', { x: 40, y: 40 }, { x: 40, y: 36 });
    w.setRoadKind(40, 40, RoadKind.Highway);
    expect(fits(g, 40, 40, true).notes).toContainEqual({ text: 'Ramp closed: needs a street below', tone: 'warn' });
    // Demolish one segment.
    const [a] = g.inspectActions(32, 30, true);
    expect(a).toMatchObject({ id: 'skyway', label: 'Demolish segment · 5 CR', cost: 5, enabled: true, buildingId: -1, x: 32, y: 30 });
    expect(g.inspectActions(32, 30)).toEqual([]); // the ground sheet has none
    g.select({ x: 32, y: 30, sky: true });
    const funds = w.funds;
    expect(g.demolishSkySegment(32, 30)).toEqual({ ok: true, cost: SKYWAY.bulldozeCost });
    expect(w.funds).toBe(funds - SKYWAY.bulldozeCost);
    expect(w.sky[w.idx(32, 30)]).toBe(0);
    expect(g.selected).toBeNull();
    expect(g.demolishSkySegment(32, 30).ok).toBe(false);
  });

  it('ports: seaport, airport and spaceport rows, the launch-rights action', () => {
    const { g } = richGame();
    const w = g.world;
    const air = w.addBuilding('airport', 10, 10)!;
    let info = fits(g, 10, 10);
    expect(Object.fromEntries(info.rows)).toMatchObject({ Business: '+240 jobs', Noise: '10 tiles' });
    expect(info.notes?.[0].text).toBe('Shops 8-16 tiles out do better business');
    const sp = w.addBuilding('spaceport', 30, 30)!;
    sp.buildDays = 120;
    info = fits(g, 30, 30);
    expect(info.rows[0]).toEqual(['Building', '50%']);
    // It draws no power while it builds, so the row never reads "NO POWER".
    expect(Object.fromEntries(info.rows).Power).toBe('—');
    expect(Object.fromEntries(info.rows).Rights).toBe('Open');
    const [a] = g.inspectActions(31, 31);
    expect(a.id).toBe('rights');
    expect(a.label).toBe('Launch rights · Choose');
    const hasCard = !!storyContent().cards.get('ex.rights');
    expect(a.enabled).toBe(hasCard);
    if (!hasCard) {
      expect(a.reason).toBe('Not available yet');
      expect(g.openLaunchRights(sp.id).ok).toBe(false);
    }
    expect(g.openLaunchRights(air.id)).toMatchObject({ ok: false, reason: 'Not a Spaceport' });
    w.story.flags.launchRights = 'nacre';
    expect(g.inspectActions(31, 31)).toEqual([]);
    expect(Object.fromEntries(fits(g, 30, 30).rows).Rights).toBe('Nacre');
    w.story.flags.launchRights = 'board';
    expect(Object.fromEntries(fits(g, 30, 30).rows).Rights).toBe('Public');
    sp.buildDays = 0;
    expect(fits(g, 30, 30).rows[0][0]).toBe('Next launch');
    const sea = w.addBuilding('seaport', 50, 10)!;
    sea.facing = 2;
    expect(Object.fromEntries(fits(g, 50, 10).rows)).toMatchObject({ Trade: '+0/mo', Exports: '+260 jobs', Noise: '6 tiles' });
    w.addBuilding('academy', 50, 50);
    expect(fits(g, 50, 50).notes?.[0].text).toBe('Lifts nearby blocks toward $$ and $$$');
  });

  it('the deck and the ground under it are different selections', () => {
    const { g } = richGame();
    const sel = record(g, 'select');
    g.select({ x: 5, y: 5 });
    g.select({ x: 5, y: 5, sky: true });
    g.select({ x: 5, y: 5, sky: true });
    expect(sel).toEqual([{ x: 5, y: 5 }, { x: 5, y: 5, sky: true }]);
  });
});

describe('prices, sounds and story refresh', () => {
  it('toolCost covers the new tools, static and with modifiers', () => {
    expect(Game.toolCost('road')).toBe(15);
    expect(Game.toolCost('alley')).toBe(6);
    expect(Game.toolCost('avenue')).toBe(40);
    expect(Game.toolCost('highway')).toBe(90);
    expect(Game.toolCost('skyway')).toBe(SKYWAY.perTile);
    expect(Game.toolCost('seaport')).toBe(18000);
    expect(Game.toolCost('spaceport')).toBe(150000);
    const { g } = richGame();
    g.world.mods.buildCostMul = 2;
    expect(g.toolCost('avenue')).toBe(80);
    expect(g.toolCost('skyway')).toBe(2 * SKYWAY.perTile);
    expect(g.toolCost('airport')).toBe(90000);
  });

  it('plays road for every road kind, build for the skyway and ports, zone for zones', () => {
    const { g } = richGame();
    const w = g.world;
    const sfx = record(g, 'sfx');
    use(g, 'road', { x: 5, y: 5 }, { x: 9, y: 5 });
    use(g, 'alley', { x: 5, y: 7 }, { x: 9, y: 7 });
    use(g, 'avenue', { x: 5, y: 5 }, { x: 9, y: 5 });
    use(g, 'highway', { x: 5, y: 9 }, { x: 9, y: 9 });
    use(g, 'skyway', { x: 20, y: 5 }, { x: 25, y: 5 });
    use(g, 'res', { x: 30, y: 30 }, { x: 31, y: 31 });
    w.setRoad(40, 39);
    use(g, 'academy', { x: 40, y: 40 });
    expect(sfx).toEqual(['road', 'road', 'road', 'road', 'build', 'zone', 'build']);
  });

  it('road and skyway drags refresh the story at once (alley mood, power terms, turf)', () => {
    const { g } = richGame();
    const dirty = vi.spyOn(g.story, 'markDirty');
    use(g, 'alley', { x: 5, y: 7 }, { x: 9, y: 7 });
    expect(dirty).toHaveBeenCalledTimes(1);
    use(g, 'skyway', { x: 20, y: 5 }, { x: 25, y: 5 });
    expect(dirty).toHaveBeenCalledTimes(2);
    use(g, 'res', { x: 30, y: 30 });
    expect(dirty).toHaveBeenCalledTimes(2);
  });

  it('a new world starts with no pending confirm, undo, refunds or launch lead', () => {
    const { g } = richGame();
    use(g, 'road', { x: 5, y: 5 }, { x: 9, y: 5 });
    expect(g.undoLeft()).toBeGreaterThan(0);
    g.restore(JSON.parse(JSON.stringify(new World(3).serialize())));
    expect(g.undoLeft()).toBe(0);
    expect(g.pendingConfirm).toBeNull();
    expect(g.launchLead).toBeNull();
  });
});
