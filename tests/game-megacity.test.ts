// Game side of the Megacity update (docs/MEGACITY.md §3.3, §3.4, §3.8, §3.11, §5.4, §11.5's WP-2 row): annexing with
// grants and lobby reactions, the lease on Tarmac Reach only, buying at districtPrice after an ending, the epilogue
// grant clock at both cadences, the "region is whole" banner once, the City map model, locked-tile refusals with the
// Map toast, skybridge source / plan / apply with undo, finishing a frame, the frame cap by device class, the
// backlog, 'auto' sleep on strain, the lower-detail speed cap and the autosave interval.

import { describe, expect, it } from 'vitest';
import { ANNEX, DISTRICTS, LOW_DETAIL, REGION, SAFETY, SKYBRIDGE, SLEEP, SLICE, STORY_PACE, districtPrice } from '../src/game/config';
import type { GameEventMap } from '../src/game/events';
import { AUTOSAVE_MONTHS, AUTOSAVE_WAIT_MS, AutosaveClock } from '../src/game/autosave';
import { FrameGuard, STRAIN_MIN_FRAMES, frameCapMs, p95Of } from '../src/game/frameGuard';
import { Game } from '../src/game/game';
import { heightOf } from '../src/game/heights';
import { parcelAt } from '../src/game/parcels';
import * as vertical from '../src/game/story/vertical';
import { adjacentLocked, slotRect } from '../src/game/districts/slots';
import * as turf from '../src/game/story/turf';
import { REGIONS, RoadKind, ZoneType, type DistrictKind, type Region, type SlotId } from '../src/game/types';
import { World } from '../src/game/world';
import { startWorld, sx, sy } from './helpers';

/** A Game on a given world (restored from its save), with a fake wall clock. */
function gameOn(w: World): { g: Game; clock: { t: number } } {
  const g = new Game();
  expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
  const clock = { t: 1000 };
  g.now = () => clock.t;
  g.settings.lowerDetail = false;
  return { g, clock };
}

function record<K extends keyof GameEventMap>(g: Game, kind: K): GameEventMap[K][] {
  const out: GameEventMap[K][] = [];
  g.events.on(kind, (e) => out.push(e));
  return out;
}

/** A generated city of a region and seed. */
function city(region: Region, seed: number): { g: Game; clock: { t: number } } {
  return gameOn(World.generate(seed, 'Annex Bay', undefined, region));
}

/** A candidate slot of a kind (null if none is next to the city). */
function candidateOf(g: Game, kind: DistrictKind): SlotId | null {
  const w = g.world;
  return adjacentLocked(w).find((s) => w.districts.kinds[s] === kind) ?? null;
}

/** Annex every candidate until the region is whole (grants given, the Sunk opened, the lease picked). */
function annexAll(g: Game): void {
  const w = g.world;
  w.story.flags.published = true;
  for (let guard = 0; guard < 40 && w.districts.owned.length < w.region * w.region; guard++) {
    const s = adjacentLocked(w)[0];
    w.districts.grants = Math.max(w.districts.grants, 1);
    expect(g.annex(s, 'nacre').ok).toBe(true);
  }
}

/** A seed whose 3×3 layout has `kind` on an edge slot (a first-annex candidate). */
function seedWithEdge(kind: DistrictKind): number {
  for (let seed = 1; seed < 400; seed++) {
    const w = new World(seed, 'Probe', undefined, 3);
    if ([1, 3, 5, 7].some((s) => w.districts.kinds[s] === kind)) return seed;
  }
  throw new Error(`no seed with ${kind} on an edge`);
}

describe('annex with land grants (§3.8)', () => {
  it('a grant annexes an adjacent slot in one batched tiles event, with the lobby reactions, the banner and a save', () => {
    const { g } = city(3, seedWithEdge('shoals'));
    const w = g.world;
    const s = candidateOf(g, 'shoals')!;
    w.districts.grants = 1;
    const nacre = w.story.favor.nacre ?? 0;
    const tiles = record(g, 'tiles');
    const annex = record(g, 'annex');
    const moments = record(g, 'moment');
    const r = g.annex(s);
    expect(r.ok).toBe(true);
    expect(w.slotOwned[s]).toBe(1);
    expect(w.districts.grants).toBe(0);
    expect(annex).toEqual([{ slot: s, kind: 'shoals', variant: 0 }]);
    // One 'tiles' event for the slot (World.annex batches its content); recomputes may add none for the slot.
    const r0 = slotRect(w, s);
    expect(tiles.filter((t) => t.x0 <= r0.x0 && t.x1 >= r0.x1 && t.y0 <= r0.y0 && t.y1 >= r0.y1)).toHaveLength(1);
    expect((w.story.favor.nacre ?? 0) - nacre).toBe(ANNEX.lobbyFavor);
    expect(moments.map((m) => m.title)).toContain('DISTRICT ANNEXED · SALTGLASS SHOALS');
    expect(w.news.some((n) => n.text === `${w.cityName} grows: Saltglass Shoals joins the city.`)).toBe(true);
  });

  it('refuses without a grant before an ending, a slot not next to the city, an owned slot and the Sunk before ch4.brine', () => {
    const { g } = city(3, 2091);
    const w = g.world;
    const cand = adjacentLocked(w)[0];
    expect(g.annex(cand).reason).toMatch(/^Next land grant: finish Chapter/);
    w.districts.grants = 3;
    // Corners of ring 1 are not next to the start slot.
    const corner = [0, 2, 6, 8].find((s) => !adjacentLocked(w).includes(s))!;
    expect(g.annex(corner).reason).toMatch(/Not next to the city yet|Still flooded: opens later/);
    expect(g.annex(4).reason).toBe('Not a district to annex');
    const sunk = w.districts.kinds.indexOf('sunk');
    // Own an edge slot next to the Sunk (a corner) so adjacency is not the reason.
    const edge = [sunk - 1, sunk + 1, sunk - 3, sunk + 3].find((n) => [1, 3, 5, 7].includes(n) && Math.abs((n % 3) - (sunk % 3)) + Math.abs(((n / 3) | 0) - ((sunk / 3) | 0)) === 1)!;
    w.districts.grants = 3;
    expect(g.annex(edge, 'nacre').ok).toBe(true);
    expect(adjacentLocked(w)).toContain(sunk);
    expect(g.annex(sunk).reason).toBe('Still flooded: opens later');
    w.story.flags.published = true;
    expect(g.annex(sunk).ok).toBe(true);
  });

  it('a 5×5 repeat of a kind gets the smaller reactions (+2 / −1)', () => {
    const { g } = city(5, seedWithEdge('shoals'));
    const w = g.world;
    w.districts.grants = 2;
    const first = candidateOf(g, 'shoals')!;
    expect(g.annex(first).ok).toBe(true);
    // Ring 2 straight across the bay is Shoals too (§3.6.2) and touches the first.
    const second = adjacentLocked(w).find((s) => w.districts.kinds[s] === 'shoals')!;
    expect(second).toBeDefined();
    const before = w.story.favor.nacre ?? 0;
    const moments = record(g, 'moment');
    expect(g.annex(second).ok).toBe(true);
    expect((w.story.favor.nacre ?? 0) - before).toBe(ANNEX.repeatLobbyFavor);
    expect(moments.some((m) => m.title.startsWith('DISTRICT ANNEXED'))).toBe(false);
    expect(w.variantOf(second)).toBeGreaterThan(0);
  });
});

describe('the Tarmac lease (§3.7: variant 0 only)', () => {
  it('Tarmac Reach waits for its lease; the chosen corp +8, the other −4', () => {
    const { g } = city(3, seedWithEdge('tarmac'));
    const w = g.world;
    const s = candidateOf(g, 'tarmac')!;
    w.districts.grants = 1;
    expect(g.annex(s).reason).toBe('Pick who leases the old apron');
    expect(w.districts.grants).toBe(1);
    const view = g.districtView().slots[s];
    expect(view.lease?.options).toEqual(['nacre', 'basalt']);
    const b0 = w.story.favor.basalt ?? 0;
    const n0 = w.story.favor.nacre ?? 0;
    const react = g.annexReactions(s, 'basalt');
    expect(g.annex(s, 'basalt').ok).toBe(true);
    expect(w.districts.leases?.tarmac).toBe('basalt');
    const lobbyBasalt = DISTRICTS.tarmac.lobby.includes('basalt') ? ANNEX.lobbyFavor : 0;
    const lobbyNacre = DISTRICTS.tarmac.lobby.includes('nacre') ? ANNEX.lobbyFavor : 0;
    expect((w.story.favor.basalt ?? 0) - b0).toBe(lobbyBasalt + ANNEX.leaseFavor);
    expect((w.story.favor.nacre ?? 0) - n0).toBe(lobbyNacre + ANNEX.leaseRivalFavor);
    expect(react.find((r) => r.f === 'basalt')?.v).toBe(lobbyBasalt + ANNEX.leaseFavor);
  });

  it('a Tarmac repeat on a 5×5 region has no lease', () => {
    const { g } = city(5, seedWithEdge('tarmac'));
    annexAll(g);
    const w = g.world;
    const repeats = w.districts.owned.filter((s) => w.districts.kinds[s] === 'tarmac' && w.variantOf(s) > 0);
    expect(repeats.length).toBeGreaterThan(0);
    // annexAll passed 'nacre' everywhere; only variant 0 recorded it.
    expect(w.districts.leases?.tarmac).toBe('nacre');
  });
});

describe('buying districts (§3.8: after an ending only, a fixed price by districts owned)', () => {
  it('pays districtPrice(owned), never scaled with funds; grants first; buying never resets the epilogue clock', () => {
    const { g } = city(3, 7);
    const w = g.world;
    const s = adjacentLocked(w).find((k) => w.districts.kinds[k] !== 'tarmac')!;
    w.funds = 1e9;
    expect(g.buyDistrict(s).ok).toBe(false); // no ending yet
    w.story.ending = 'quiet';
    w.districts.epilogueSec = 123;
    const price = districtPrice(w.districts.owned.length);
    expect(price).toBe(360_000 * w.districts.owned.length);
    const view = g.districtView();
    expect(view.slots[s].price.text).toBe(`${price.toLocaleString('en-US')} CR · or wait for the next grant`);
    expect(g.annex(s).ok).toBe(true); // no grant: annex buys after an ending
    expect(w.funds).toBe(1e9 - price);
    expect(w.districts.bought).toBe(1);
    expect(w.districts.epilogueSec).toBe(123);
    // The same price with a poor treasury: never scaled with funds.
    const t = adjacentLocked(w).find((k) => w.districts.kinds[k] !== 'tarmac' && w.districts.kinds[k] !== 'sunk')!;
    w.funds = districtPrice(w.districts.owned.length) - 1;
    expect(g.buyDistrict(t).reason).toMatch(/^Not enough credits/);
    w.funds += 1;
    expect(g.buyDistrict(t).ok).toBe(true);
    expect(w.funds).toBe(0);
  });
});

describe('the epilogue grant clock (§3.8, §9.6 test 5, the stub at both cadences)', () => {
  const tick = (g: Game, dt: number) => (g as unknown as { tickEpilogue(dt: number): void }).tickEpilogue(dt);

  it.each([3, 5] as const)('%i×%i: one grant every chapterMinSec × epilogueGrantMul unpaused seconds; none while one waits', (R) => {
    const { g } = city(R, 31);
    const w = g.world;
    w.story.ending = 'ledger';
    const every = STORY_PACE.relaxed.chapterMinSec * REGION[R].epilogueGrantMul;
    expect(g.epilogueGrantSec()).toBe(every);
    expect(every).toBe(R === 3 ? 1440 : 720);
    const grants = record(g, 'grant');
    tick(g, every - 1);
    expect(w.districts.grants).toBe(0);
    tick(g, 1);
    expect(w.districts.grants).toBe(1);
    expect(grants).toEqual([{ grants: 1, why: 'epilogue' }]);
    expect(w.news.some((n) => n.text === 'A land grant arrives: the city may annex again.')).toBe(true);
    // None while a grant is unspent: the clock waits.
    tick(g, every * 3);
    expect(w.districts.grants).toBe(1);
    expect(w.districts.epilogueSec).toBe(0);
  });

  it('never before an ending, never while paused (update at speed 0), never once every slot is owned; it survives save and load', () => {
    const { g } = city(3, 31);
    const w = g.world;
    const tickE = (dt: number) => (g as unknown as { tickEpilogue(dt: number): void }).tickEpilogue(dt);
    tickE(5000);
    expect(w.districts.grants).toBe(0);
    w.story.ending = 'quiet';
    g.setSpeed(0);
    for (let i = 0; i < 40; i++) g.update(0.25);
    expect(w.districts.epilogueSec ?? 0).toBe(0);
    g.setSpeed(1);
    g.update(0.25);
    expect(w.districts.epilogueSec).toBeCloseTo(0.25, 6);
    tickE(100);
    const saved = JSON.parse(JSON.stringify(w.serialize()));
    const { g: h } = gameOn(World.deserialize(saved));
    expect(h.world.districts.epilogueSec).toBeCloseTo(100.25, 6);
    annexAll(g);
    g.world.districts.grants = 0;
    tickE(1e6);
    expect(g.world.districts.grants).toBe(0);
  });
});

describe('the region is whole (§3.8)', () => {
  it.each([3, 5] as const)('%i×%i: the banner shows once, on the annex that owns every slot; then the edge line', (R) => {
    const { g } = city(R, 2091);
    const moments = record(g, 'moment');
    annexAll(g);
    const w = g.world;
    expect(w.districts.owned).toHaveLength(R * R);
    const whole = moments.filter((m) => m.title === 'THE REGION IS WHOLE');
    expect(whole).toEqual([{ id: 'region', title: 'THE REGION IS WHOLE', sub: `All ${R * R} districts are part of ${w.cityName}.` }]);
    expect(w.moments.has('region')).toBe(true);
    const v = g.districtView();
    expect(v.whole).toBe(true);
    expect(v.edgeLine).toBe('The city reaches the edge of the region.');
    expect(v.canGrow).toBe(R === 3);
  });
});

describe('the City map model (§7.2)', () => {
  it('states, names, perks, lobby lines, price lines and the owned / region count', () => {
    const { g } = city(3, 2091);
    const w = g.world;
    const v = g.districtView();
    expect(v.total).toBe(9);
    expect(v.owned).toBe(1);
    expect(v.slots[4].state).toBe('owned');
    const sunk = w.districts.kinds.indexOf('sunk');
    expect(v.slots[sunk].state).toBe('notOpen');
    expect(v.slots[sunk].perks).toEqual([]);
    expect(v.slots[sunk].lobby).toEqual([]);
    for (const s of adjacentLocked(w)) {
      if (s === sunk) continue;
      const sv = v.slots[s];
      expect(sv.state).toBe('candidate');
      expect(sv.name).toBe(DISTRICTS[sv.kind].name);
      expect(sv.perks).toEqual(DISTRICTS[sv.kind].perks);
      expect(sv.price.text).toMatch(/^Next land grant: finish Chapter I$/);
      expect(sv.canAnnex).toBe(false);
      for (const l of sv.lobby) expect(l.quote.length).toBeGreaterThan(0);
    }
    w.districts.grants = 2;
    const c = adjacentLocked(w).find((s) => s !== sunk)!;
    expect(g.districtView().slots[c].price.text).toBe('Uses 1 land grant (1 left)');
    // The Tuning never lobbies before it is active: Marrow (the Board) speaks for the Terraces.
    const ter = w.districts.kinds.indexOf('terraces');
    expect(g.districtView().slots[ter].lobby.map((l) => l.faction)).toEqual(['board']);
  });

  it('a 5×5 repeat shows its variant name and its own goal', () => {
    const { g } = city(5, 2091);
    annexAll(g);
    const v = g.districtView();
    const rep = v.slots.find((s) => s.variant > 0)!;
    const def = DISTRICTS[rep.kind].variants[rep.variant - 1];
    expect(rep.name).toBe(def.name);
    expect(rep.kindName).toBe(DISTRICTS[rep.kind].name);
    expect(rep.goals.map((x) => x.id)).toContain(def.goal.id);
    expect(rep.goals.some((x) => DISTRICTS[rep.kind].goals.find((k) => k.id === x.id)?.once)).toBe(false);
  });
});

describe('locked land (§3.4)', () => {
  it('a road into a locked slot is refused tile by tile with "Not annexed yet" and the Map toast', () => {
    const w = startWorld(3, 99);
    w.funds = 1e6;
    const { g } = gameOn(w);
    const toasts = record(g, 'toast');
    g.setTool('road');
    // A drag that crosses the border builds its owned part; the locked tiles are refused one by one.
    const part = g.plan({ x: sx(60), y: sy(30) }, { x: sx(70), y: sy(30) });
    expect(part.valid).toBe(true);
    expect(part.reason).toBe('Not annexed yet');
    expect(part.slot).toBe(5);
    expect(part.tiles.filter((p) => !p.ok).map((p) => p.x)).toEqual([128, 129, 130, 131, 132, 133, 134]);
    const plan = g.apply({ x: sx(66), y: sy(30) }, { x: sx(70), y: sy(30) });
    expect(plan.valid).toBe(false);
    expect(plan.reason).toBe('Not annexed yet');
    expect(plan.slot).toBe(5);
    expect(g.mapSlot).toBe(5);
    const t = toasts.at(-1)!;
    expect(t.text).toBe(`${DISTRICTS[g.world.districts.kinds[5]].name} isn't part of the city yet`);
    expect(t.action?.id).toBe('map');
    // Zoning, a building and rail all refuse the same way.
    g.setTool('res');
    expect(g.apply({ x: sx(66), y: sy(10) }, { x: sx(68), y: sy(12) }).reason).toBe('Not annexed yet');
    g.setTool('solar');
    expect(g.apply({ x: sx(66), y: sy(20) }, { x: sx(66), y: sy(20) }).reason).toBe('Not annexed yet');
    expect(g.world.buildings.size).toBe(0);
    for (let x = sx(64); x <= sx(70); x++) expect(g.world.tileAt(x, sy(30))!.road).toBe(false);
  });

  it('inspect on a locked tile is the district preview with "Open City map"', () => {
    const { g } = city(3, 2091);
    const w = g.world;
    const s = adjacentLocked(w).find((k) => w.districts.kinds[k] !== 'sunk')!;
    const r = slotRect(w, s);
    const info = g.getTileInfo(r.x0 + 10, r.y0 + 10)!;
    const def = DISTRICTS[w.districts.kinds[s]];
    expect(info.title).toBe(def.name);
    expect(info.subtitle).toBe('Not annexed yet');
    expect(info.notes?.some((n) => n.text === `+ ${def.perks[0]}`)).toBe(true);
    expect(g.inspectActions(r.x0 + 10, r.y0 + 10).map((a) => a.id)).toEqual(['map']);
    const sunk = w.districts.kinds.indexOf('sunk');
    const q = slotRect(w, sunk);
    const si = g.getTileInfo(q.x0 + 5, q.y0 + 5)!;
    expect(si.subtitle).toBe('Still flooded: opens later');
    expect(si.notes).toBeUndefined();
  });
});

/** Two single L3 Hab towers in a row in the start slot of a flat 3×3 world, `gap` tiles apart, powered by a plant. */
function towers(gap: number): { g: Game; clock: { t: number }; a: { x: number; y: number }; b: { x: number; y: number } } {
  const w = startWorld(3, 77);
  w.funds = 1e6;
  w.maxPopulation = 1e7;
  const a = { x: sx(20), y: sy(20) };
  const b = { x: a.x + gap + 1, y: a.y };
  for (const p of [a, b]) {
    w.setZone(p.x, p.y, ZoneType.Residential);
    w.setLevel(p.x, p.y, 3);
  }
  for (let x = a.x - 2; x <= b.x + 2; x++) w.setRoad(x, a.y + 1, RoadKind.Street);
  w.addBuilding('reactor', a.x, a.y + 3);
  w.story.unlocks.push('skybridge');
  const out = gameOn(w);
  return { ...out, a, b };
}

describe('skybridge source / plan / apply with undo (§5.4, §5.3 rule 8)', () => {
  it('tap a tower, tap a partner: built at once at 1,200 + 250 a gap tile, the far tower is the next source; Undo refunds', () => {
    const { g, clock, a, b } = towers(4);
    const w = g.world;
    const partners = g.skybridgeSource(a.x, a.y)!;
    expect(partners.find((p) => p.x === b.x && p.y === b.y)?.ok).toBe(true);
    expect(g.skybridgeLanes().length).toBeGreaterThan(0);
    const plan = g.planSkybridge(b.x, b.y);
    expect(plan.valid).toBe(true);
    expect(plan.cost).toBe(SKYBRIDGE.base + 250 * 4);
    expect(plan.bridge?.walkers).toBeGreaterThan(0);
    const funds = w.funds;
    const toasts = record(g, 'toast');
    const done = g.applySkybridge(b.x, b.y);
    expect(done.valid).toBe(true);
    expect(w.links).toHaveLength(1);
    expect(w.funds).toBe(funds - plan.cost);
    expect(g.bridgeSource).toEqual(b);
    expect(toasts.at(-1)?.action?.id).toBe('undo');
    expect(g.undoLeft()).toBeCloseTo(SAFETY.undoSec, 6);
    clock.t += 5;
    expect(g.undo()).toBe(true);
    expect(w.links).toHaveLength(0);
    expect(w.funds).toBe(funds);
  });

  it('undo after 10 s is too late; "Remove skybridge" removes it without a refund', () => {
    const { g, clock, a, b } = towers(3);
    const w = g.world;
    g.skybridgeSource(a.x, a.y);
    expect(g.applySkybridge(b.x, b.y).valid).toBe(true);
    clock.t += SAFETY.undoSec + 1;
    expect(g.undo()).toBe(false);
    expect(w.links).toHaveLength(1);
    const id = w.links[0].id;
    const acts = g.inspectActions(a.x + 1, a.y, false, id);
    expect(acts.map((x) => x.id)).toEqual(['bridgeRemove']);
    const info = g.linkInfo(id)!;
    expect(info.title).toBe('Skybridge');
    expect(info.subtitle).toBe('A walkway for people. Skyways carry cars.');
    const funds = w.funds;
    expect(g.removeSkybridge(id).ok).toBe(true);
    expect(w.links).toHaveLength(0);
    expect(w.funds).toBe(funds);
  });

  it('tapping the source again or a tile that is not tall deselects', () => {
    const { g, a } = towers(3);
    expect(g.skybridgeSource(a.x, a.y)).not.toBeNull();
    expect(g.skybridgeSource(a.x, a.y)).toBeNull();
    expect(g.bridgeSource).toBeNull();
    expect(g.skybridgeSource(a.x, a.y + 1)).toBeNull();
    // Leaving the tool deselects too.
    g.setTool('skybridge');
    expect(g.skybridgeSource(a.x, a.y)).not.toBeNull();
    g.setTool('road');
    expect(g.bridgeSource).toBeNull();
    expect(g.skybridgeLanes()).toEqual([]);
  });
});

describe('finishing a Skeleton Row frame (§3.7)', () => {
  it('"Finish frame · 7,200 CR" replaces it with a Stratablock at stage 1 complete; it cannot be bulldozed', () => {
    const seed = seedWithEdge('skeleton');
    const { g } = city(3, seed);
    const w = g.world;
    w.districts.grants = 1;
    expect(g.annex(candidateOf(g, 'skeleton')!).ok).toBe(true);
    const frames = [...w.buildings.values()].filter((b) => b.type === 'frame');
    expect(frames.length).toBe(5);
    const f = frames[0];
    g.setTool('bulldoze');
    expect(g.apply({ x: f.x, y: f.y }, { x: f.x, y: f.y }).valid).toBe(false);
    expect(w.buildingAt(f.x, f.y)?.type).toBe('frame');
    g.setTool('inspect');
    w.maxPopulation = 1e7;
    w.funds = 1e6;
    const [act] = g.inspectActions(f.x, f.y);
    expect(act.id).toBe('frame');
    expect(act.cost).toBe(7200);
    expect(act.label).toBe('Finish frame · 7,200 CR');
    expect(act.enabled).toBe(true);
    expect(g.getTileInfo(f.x, f.y)!.title).toBe('Unfinished frame');
    expect(g.finishFrame(f.id).ok).toBe(true);
    const b = w.buildingAt(f.x, f.y)!;
    expect(b.type).toBe('stack');
    expect(b.stage).toBe(1);
    expect(b.buildDays ?? 0).toBe(0);
    expect(w.funds).toBe(1e6 - 7200);
  });
});

describe('the frame guard (§3.3, §3.11)', () => {
  it('the cap by device class: 6 ms on a handheld device, 10 ms on a PC', () => {
    expect(frameCapMs('handheld')).toBe(SLICE.capHandheldMs);
    expect(frameCapMs('pc')).toBe(SLICE.capPcMs);
    expect(SLICE.capHandheldMs).toBe(6);
    expect(SLICE.capPcMs).toBe(10);
  });

  it('a frame stops at the cap on a fake clock, a day spans frames and completes, and stats publish only then', () => {
    const { g } = city(3, 5);
    let t = 0;
    g.msClock = () => (t += 0.5);
    g.guard.cap = 6;
    g.setSpeed(3);
    const stats = record(g, 'stats');
    const tick0 = g.world.tick;
    let frames = 0;
    while (!stats.length && frames < 2000) {
      g.update(1 / 60);
      frames++;
      // At most the cap plus one step over it (a step starts while it fits; one always runs).
      expect(g.simMsThisFrame).toBeLessThanOrEqual(6 + 4);
    }
    expect(stats.length).toBeGreaterThan(0); // the day's publish (and Game's own 'stats') in the frame it completed
    expect(g.world.tick - tick0).toBeGreaterThanOrEqual(1);
    expect(frames).toBeGreaterThan(1);
  });

  it('a save or a snapshot mid-day finishes the sliced day first (annex too): a month end paused mid-slice settles before it is written', () => {
    const { g } = city(3, 5);
    let t = 0;
    g.msClock = () => (t += 0.7); // a slow clock: every day spans frames
    g.setSpeed(3);
    let found = false;
    for (let f = 0; f < 20_000 && !found; f++) {
      if (g.story.blocking) g.choose(0);
      if (g.speed !== 3) g.setSpeed(3);
      g.update(1 / 60);
      found = g.sim.midDay && g.world.tick % 30 === 0 && g.world.tick > 0;
    }
    expect(found).toBe(true);
    g.setSpeed(0); // the player pauses mid-day, then the tab closes (pagehide)
    const hist = g.world.budget.history.length;
    const months = record(g, 'month');
    const data = g.snapshot();
    expect(g.sim.midDay).toBe(false);
    expect(months).toEqual([undefined]);
    expect(g.world.budget.history.length).toBe(hist + 1);
    expect(data.tick).toBe(g.world.tick);
    // The written city carries the settled month.
    const loaded = World.deserialize(JSON.parse(JSON.stringify(data)));
    expect(loaded.budget.history.length).toBe(hist + 1);
    // Nothing in flight: a second save changes nothing.
    expect(g.snapshot().tick).toBe(data.tick);
    expect(months).toHaveLength(1);
  }, 60_000);

  it('a backlog over 4 days is dropped', () => {
    const { g } = city(3, 5);
    let t = 0;
    g.msClock = () => (t += 50); // a very slow device: one step a frame
    g.setSpeed(3);
    for (let i = 0; i < 4; i++) g.update(0.25);
    expect(g.droppedDays).toBeGreaterThan(0);
  });

  it('strain: a dropped backlog or a p95 above 80% of the cap at speed 2 or 3 engages resting; 60 s without strain releases it', () => {
    const f = new FrameGuard(10);
    for (let i = 0; i < STRAIN_MIN_FRAMES + 5; i++) f.record(1 / 60, 5, 3, false);
    expect(f.engaged).toBe(false);
    for (let i = 0; i < 120; i++) f.record(1 / 60, 9, 3, false);
    expect(f.p95).toBeGreaterThan(SLEEP.strainCapShare * 10);
    expect(f.engaged).toBe(true);
    // Speed 1 frames are never strain, but the 60 s recovery counts every unpaused second.
    for (let i = 0; i < 60 * 59; i++) f.record(1 / 60, 9, 1, false);
    expect(f.engaged).toBe(true);
    for (let i = 0; i < 60 * 2; i++) f.record(1 / 60, 1, 1, false);
    expect(f.engaged).toBe(false);
    f.record(1 / 60, 1, 2, true);
    expect(f.engaged).toBe(true);
    expect(p95Of([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])).toBe(19);
  });

  it("'auto' sleep only on a 5×5 city under strain; 'forced' in lower detail; never on a 3×3 PC-less default", () => {
    const { g } = city(5, 5);
    g.setSpeed(1);
    g.update(0.02);
    expect(g.sim.sleep).toBe('off');
    g.guard.record(0.02, 0, 3, true); // the backlog guard dropped days at speed 3
    g.update(0.02);
    expect(g.sim.sleep).toBe('auto');
    g.updateSettings({ lowerDetail: true });
    g.update(0.02);
    expect(g.sim.sleep).toBe('forced');
    g.setViewCentre(150, 150);
    g.update(0.02);
    expect(g.sim.sleepFocus).toBe(g.world.slotAt(150, 150));
  });

  it('lower detail caps every speed at LOW_DETAIL.maxDaysPerSec and autosaves at most every 120 s', () => {
    const { g } = city(5, 5);
    expect(g.autosaveMinSec).toBe(REGION[5].autosaveMinSec);
    expect(g.speedCapNote).toBeNull();
    g.updateSettings({ lowerDetail: true });
    expect(g.lowerDetail).toBe(true);
    expect(g.speedCapNote).toBe(`Lower detail: up to ${LOW_DETAIL.maxDaysPerSec} days a second`);
    for (const s of [1, 2, 3]) {
      g.setSpeed(s);
      expect(g.daysPerSec).toBeLessThanOrEqual(LOW_DETAIL.maxDaysPerSec);
    }
    g.setSpeed(3);
    expect(g.daysPerSec).toBe(LOW_DETAIL.maxDaysPerSec);
    expect(g.autosaveMinSec).toBe(LOW_DETAIL.autosaveMinSec);
    // Every speed, measured: a second of frames at speed 3 runs at most 8 days.
    const t0 = g.world.tick;
    for (let i = 0; i < 20; i++) g.update(0.05);
    expect(g.world.tick - t0).toBeLessThanOrEqual(LOW_DETAIL.maxDaysPerSec);
    // A 3×3 city ignores the setting.
    const { g: h } = city(3, 5);
    h.updateSettings({ lowerDetail: true });
    h.setSpeed(3);
    expect(h.daysPerSec).toBe(16);
    expect(h.autosaveMinSec).toBe(REGION[3].autosaveMinSec);
  });
});

describe('autosave off the month tick (§3.3, §3.11)', () => {
  it('due only after 3 sim months and autosaveMinSec unpaused seconds; queued only in a frame without a sim slice, or after 500 ms', () => {
    const c = new AutosaveClock();
    expect(c.everyMonths).toBe(AUTOSAVE_MONTHS);
    expect(c.waitMs).toBe(AUTOSAVE_WAIT_MS);
    c.month(0, 60);
    c.month(0, 60);
    c.month(0, 60);
    expect(c.due).toBe(false); // 3 months but no play time yet
    expect(c.frame(1000, 59, true, false, 60)).toBe(false);
    expect(c.frame(1016, 2, false, false, 60)).toBe(false); // paused seconds do not count
    expect(c.frame(1032, 1, true, true, 60)).toBe(false); // due now, but this frame ran a slice
    expect(c.due).toBe(true);
    expect(c.frame(1048, 1 / 60, true, true, 60)).toBe(false);
    expect(c.frame(1064, 1 / 60, true, false, 60)).toBe(true); // the first frame with no slice queues it
    expect(c.frame(1080, 1 / 60, true, false, 60)).toBe(false); // once
    expect(c.idle()).toBe(true);
    c.saved();
    expect(c.due).toBe(false);
    // At top speed every frame runs a slice: after 500 ms it is queued anyway (the idle callback runs between frames).
    for (let m = 0; m < 3; m++) c.month(2000, 60);
    c.frame(2000, 61, true, true, 60);
    expect(c.frame(2400, 1 / 60, true, true, 60)).toBe(false);
    expect(c.frame(2500, 1 / 60, true, true, 60)).toBe(true);
    // A save for another reason (menu, page hide) before the idle callback fires: it finds nothing due.
    c.saved();
    expect(c.idle()).toBe(false);
  });

  it.each([false, true])('a speed-3 run on a 5×5 city (lower detail %s): every save runs between frames, at most every max(3 months, autosaveMinSec)', (low) => {
    const { g } = city(5, 5);
    g.updateSettings({ lowerDetail: low });
    const minSec = g.autosaveMinSec;
    expect(minSec).toBe(low ? LOW_DETAIL.autosaveMinSec : REGION[5].autosaveMinSec);
    const c = new AutosaveClock();
    let now = 0;
    let played = 0;
    const saves: { at: number; month: number }[] = [];
    let months = 0;
    g.events.on('month', () => {
      months++;
      c.month(now, g.autosaveMinSec);
    });
    let idle: (() => void) | null = null;
    let lastMonth = 0;
    let lastPlay = 0;
    g.setSpeed(3);
    for (let f = 0; f < 60 * 300 && saves.length < 2; f++) {
      now += 1000 / 60;
      // A story card would pause the city: pass on it, this test is about the save clock.
      if (g.story.blocking) {
        g.later();
        if (g.story.blocking) g.choose(0);
      }
      if (g.speed === 0) g.setSpeed(3);
      // The idle callback queued after the previous frame runs here, before the next frame's sim slice.
      if (idle) {
        const run = idle;
        idle = null;
        run();
      }
      g.update(1 / 60);
      const running = g.speed > 0;
      if (running) played += 1 / 60;
      if (c.frame(now, 1 / 60, running, g.simRanThisFrame, g.autosaveMinSec)) {
        idle = () => {
          if (!c.idle()) return;
          // Never inside a frame: the save runs between g.update calls (main.ts: requestIdleCallback).
          expect(months - lastMonth).toBeGreaterThanOrEqual(AUTOSAVE_MONTHS);
          expect(played - lastPlay).toBeGreaterThanOrEqual(minSec);
          saves.push({ at: played, month: months });
          lastMonth = months;
          lastPlay = played;
          c.saved();
        };
      }
    }
    expect(saves.length).toBe(2);
    expect(saves[1].at - saves[0].at).toBeGreaterThanOrEqual(minSec);
  });
});

describe('the gangs move in on annex (§3.7)', () => {
  it.each(REGIONS)('%i×%i: the Undertow seeds in the Sunk once it has seeded, never before', (R) => {
    for (const seeded of [false, true]) {
      const { g } = city(R, 2091);
      const w = g.world;
      w.story.flags.published = true;
      const sunk = w.districts.kinds.indexOf('sunk');
      // Own an edge neighbour of the Sunk first (the Sunk is a ring-1 corner).
      const r = slotRect(w, sunk);
      for (let guard = 0; guard < 6 && !adjacentLocked(w).includes(sunk); guard++) {
        const next = adjacentLocked(w).find((s) => Math.abs(slotRect(w, s).x0 - r.x0) + Math.abs(slotRect(w, s).y0 - r.y0) === 64)!;
        w.districts.grants = 1;
        expect(g.annex(next, 'nacre').ok).toBe(true);
      }
      w.turf.seeded.undertow = seeded;
      w.districts.grants = 1;
      expect(g.annex(sunk).ok).toBe(true);
      let held = 0;
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (turf.ownerAt(w, x, y) === 'undertow') held++;
      if (seeded) expect(held).toBeGreaterThanOrEqual(3);
      else expect(held).toBe(0);
    }
  });

  it('the Kites seed by a Skeleton Row frame once they have seeded', () => {
    const seed = seedWithEdge('skeleton');
    const { g } = city(3, seed);
    const w = g.world;
    w.turf.seeded.kites = true;
    const s = candidateOf(g, 'skeleton')!;
    w.districts.grants = 1;
    expect(g.annex(s).ok).toBe(true);
    const frames = [...w.buildings.values()].filter((b) => b.type === 'frame' && w.slotAt(b.x, b.y) === s);
    expect(frames.length).toBeGreaterThan(0);
    const r = slotRect(w, s);
    let held = 0;
    let near = 0;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        if (turf.ownerAt(w, x, y) !== 'kites') continue;
        held++;
        if (frames.some((b) => x >= b.x - 2 && x <= b.x + b.size + 1 && y >= b.y - 2 && y <= b.y + b.size + 1)) near++;
      }
    expect(held).toBeGreaterThan(0);
    expect(near).toBe(held);
  });
});

describe('milestones by region and regional links on a border (§4.5, §3.5)', () => {
  it.each(REGIONS)('%i×%i: Electric Tide and Glass Horizon only on a 5×5 region; reached rows follow the city', (R) => {
    const { g } = city(R, 7);
    const ms = g.milestones();
    expect(ms.some((m) => m.pop === 6_000_000)).toBe(R === 5);
    expect(ms.some((m) => m.pop === 8_000_000)).toBe(R === 5);
    expect(ms.some((m) => m.pop === 4_000_000 && m.title === 'Endless City')).toBe(true);
    expect(ms.every((m) => !m.reached)).toBe(true);
    g.world.milestones.push(1000);
    expect(g.milestones().find((m) => m.pop === 1000)!.reached).toBe(true);
  });

  it('a street ending on the boundary is a regional link of the slot beyond; annexing that slot makes it a city street', () => {
    const w = startWorld(3, 77);
    w.funds = 1e7;
    const east = w.slotAt(sx(64), sy(30));
    const y = sy(30);
    for (let x = sx(40); x <= sx(63); x++) w.setRoad(x, y, RoadKind.Street);
    const { g } = gameOn(w);
    expect(g.linksOnBorder(east)).toBe(1);
    const view = g.districtView().slots[east];
    expect(view.linksInternal).toBe(1);
    g.world.districts.grants = 1;
    const lease = g.world.districts.kinds[east] === 'tarmac' ? 'basalt' : undefined;
    expect(g.annex(east, lease).ok).toBe(true);
    expect(g.linksOnBorder(east)).toBe(0);
  });
});

describe('inspect additions (§4.6, §5.5, §7.5)', () => {
  /** A powered level-3 Hab tile (a tall zone anchor). */
  function hab(w: World, x: number, y: number): void {
    w.setZone(x, y, ZoneType.Residential);
    w.setLevel(x, y, 3);
    w.tiles[w.idx(x, y)].powered = true;
  }

  it('a zone tower: "{form} · {n} floors", Homes for Hab, Skybridges 0/2; a 2×2 parcel adds its sum; a lobby tower its lobby note', () => {
    const w = startWorld(3, 77);
    w.funds = 1e7;
    w.maxPopulation = 1e7;
    w.story.unlocks.push('skybridge');
    const a = { x: sx(10), y: sy(10) };
    hab(w, a.x, a.y);
    // Three towers in a row for a Sky Lobby, on a street with a reactor (bridges light only on powered towers).
    const y = sy(50);
    const xs = [sx(10), sx(14), sx(18)];
    for (const x of xs) hab(w, x, y);
    for (let x = xs[0] - 2; x <= xs[2] + 2; x++) w.setRoad(x, y + 1, RoadKind.Street);
    w.addBuilding('reactor', xs[0], y + 2);
    const { g } = gameOn(w);
    const info = g.getTileInfo(a.x, a.y)!;
    const floors = Math.max(1, Math.round(heightOf(g.world, a.x, a.y) / 6.5));
    expect(info.subtitle).toBe(`Point tower · ${floors} floors`);
    expect(floors).toBeGreaterThan(10);
    const res = Number(info.rows.find((r) => r[0] === 'Residents')![1].replace(/,/g, ''));
    expect(info.rows.find((r) => r[0] === 'Homes')![1]).toBe(Math.round(res / 2.4).toLocaleString('en-US'));
    expect(info.rows.find((r) => r[0] === 'Skybridges')![1]).toBe(`0/${SKYBRIDGE.maxPerAnchor}`);
    expect(info.rows.some((r) => r[0] === 'District')).toBe(false); // a one-district city has no District row
    // A merged 2×2 parcel: the note sums its members.
    const gw = g.world;
    let parcel: { x: number; y: number } | null = null;
    for (let k = 0; k < 40 && !parcel; k++) {
      const x = sx(30 + 2 * (k % 8));
      const y = sy(30 + 2 * ((k / 8) | 0));
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) hab(gw, x + dx, y + dy);
      const p = parcelAt(gw, x, y);
      if (p && p.w === 2 && p.h === 2) parcel = { x: p.x, y: p.y };
      else for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) gw.clearTile(x + dx, y + dy);
    }
    expect(parcel).not.toBeNull();
    const pi = g.getTileInfo(parcel!.x, parcel!.y)!;
    expect(pi.notes?.some((n) => /^Part of a 2×2 tower: [\d,]+ residents$/.test(n.text))).toBe(true);
    expect(pi.rows.find((r) => r[0] === 'Skybridges')![1]).toBe(`0/${SKYBRIDGE.maxPerParcel}`);
    // Three towers bridged in a row: a Sky Lobby; each tower's note names it and its visitors.
    for (let i = 1; i < 3; i++) {
      g.setTool('skybridge');
      expect(g.skybridgeSource(xs[i - 1], y)).not.toBeNull();
      expect(g.applySkybridge(xs[i], y).valid).toBe(true);
      g.skybridgeSource(xs[i], y); // deselect the far tower (it became the source)
    }
    const lobby = gw.vertical.lobbies[0];
    expect(lobby.anchors).toHaveLength(3);
    const ti = g.getTileInfo(xs[1], y)!;
    expect(ti.rows.find((r) => r[0] === 'Skybridges')![1]).toBe('2/2');
    expect(ti.notes?.some((n) => n.text === `Part of Sky Lobby ${vertical.lobbyName(gw, lobby.anchors[0])}: +${lobby.visitors.toLocaleString('en-US')} visitors a month`)).toBe(true);
    // The tube: §5.5's rows and the same lobby note.
    const link = gw.links[0];
    const li = g.linkInfo(link.id)!;
    expect(li.title).toBe('Skybridge');
    expect(li.subtitle).toBe('A walkway for people. Skyways carry cars.');
    expect(li.rows.map((r) => r[0])).toEqual(['Walkers', 'Cars', 'Land', 'Lobby', 'Upkeep']);
    expect(li.rows.find((r) => r[0] === 'Cars')![1]).toBe('−25%');
    expect(li.rows.find((r) => r[0] === 'Upkeep')![1]).toBe(`${SKYBRIDGE.upkeepBase + SKYBRIDGE.upkeepPerTile * 3}/mo`);
    expect(g.inspectActions(xs[0], y, false, link.id).map((a) => a.id)).toContain('bridgeRemove');
  });
});
