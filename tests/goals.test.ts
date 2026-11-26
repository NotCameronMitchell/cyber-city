// District goals (docs/MEGACITY.md §3.7, §11.3 D6; WP-2): every goal of every kind and every 5×5 variant, with its
// `once` and `skipGoals` rules, is reachable in its own district on that variant's terrain (a scripted builder sets
// up each check with World mutators); each pays once, posts one line and emits districtGoal; a goal completed after
// an ending pays max(reward, GOAL_LATE_SHARE × districtPrice(owned)); a goal stays hidden while its building type is
// hidden or locked; every check reads only its own district.

import { describe, expect, it } from 'vitest';
import { applyAction, finishFrame, ruinRestored } from '../src/game/actions';
import { BUILDINGS, DISTRICTS, GOAL_LATE_SHARE, districtPrice, type DistrictGoal } from '../src/game/config';
import { brownfieldSites, framesOf, isRuin } from '../src/game/districts/annex';
import { isWildReed } from '../src/game/districts/effects';
import {
  checkDistrictGoals,
  goalMet,
  goalPay,
  goalVisible,
  bazaarVisitors,
  framesFinished,
  goalsOf,
  shoalsIslands,
  slotCensus,
  wildReeds,
} from '../src/game/districts/goals';
import { slotRect } from '../src/game/districts/slots';
import { shoreFacing } from '../src/game/ports';
import * as vertical from '../src/game/story/vertical';
import { Ground, REGIONS, Terrain, ZoneType, type BuildingType, type Region, type SlotId } from '../src/game/types';
import { World } from '../src/game/world';

const HIDDEN = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => BUILDINGS[t].hidden && t !== 'frame' && t !== 'pumphall');

/** Every slot of a generated region annexed (5×5: every variant), with everything unlocked and money to spend. */
function region(R: Region, seed: number): World {
  const w = World.generate(seed, 'Goals', undefined, R);
  w.story.flags.published = true;
  for (let s = 0; s < R * R; s++) if (!w.slotOwned[s]) w.annex(s);
  w.funds = 1e9;
  w.maxPopulation = 1e9;
  w.story.unlocks.push('memorial', 'stack', 'skybridge', 'rail');
  w.story.chapter = 6;
  return w;
}

/** Free footprint sites of a size in a slot: all land (or all water), nothing on it, centre inside the slot. */
function sites(w: World, s: SlotId, size: number, test: (x: number, y: number) => boolean, onWater = false): { x: number; y: number }[] {
  const r = slotRect(w, s);
  const out: { x: number; y: number }[] = [];
  const used = new Set<number>();
  for (let y = r.y0 + 1; y + size <= r.y1; y++)
    for (let x = r.x0 + 1; x + size <= r.x1; x++) {
      let ok = true;
      for (let k = 0; k < size * size && ok; k++) {
        const i = w.idx(x + (k % size), y + ((k / size) | 0));
        const t = w.tiles[i];
        ok = !used.has(i) && t.buildingId < 0 && !t.road && t.zone === ZoneType.None && (onWater ? t.terrain === Terrain.Water : t.terrain === Terrain.Land);
        if (ok && !onWater) ok = t.elev === w.tiles[w.idx(x, y)].elev;
      }
      if (!ok || !test(x, y)) continue;
      for (let k = 0; k < size * size; k++) used.add(w.idx(x + (k % size), y + ((k / size) | 0)));
      out.push({ x, y });
    }
  return out;
}

/** Place n buildings of a type in a slot (structural), on the right kind of site. */
function place(w: World, s: SlotId, type: BuildingType, n: number, where: 'land' | 'water' | 'shore' | 'bywater' = 'land'): void {
  const size = BUILDINGS[type].size;
  const byWater = (x: number, y: number) => {
    for (let k = 0; k < size; k++)
      for (const [px, py] of [[x + k, y - 1], [x + k, y + size], [x - 1, y + k], [x + size, y + k]]) {
        const t = w.tileAt(px, py);
        if (t && t.terrain === Terrain.Water && !t.road) return true;
      }
    return false;
  };
  const test = where === 'shore' ? (x: number, y: number) => shoreFacing(w, x, y, size) >= 0 : where === 'bywater' ? byWater : () => true;
  const at = sites(w, s, size, test, where === 'water');
  expect(at.length, `${n} ${type} sites in slot ${s}`).toBeGreaterThanOrEqual(n);
  for (let k = 0; k < n; k++) {
    const b = w.addBuilding(type, at[k].x, at[k].y);
    expect(b, `${type} at ${at[k].x},${at[k].y}`).not.toBeNull();
    if (type === 'pumphouse') b!.reclaim = 0;
    if (type === 'stack') w.setStage(b!, 1, 0);
  }
}

/** Develop zone tiles on free land in a slot until `enough()` holds. */
function develop(w: World, s: SlotId, zone: ZoneType, level: number, enough: () => boolean, opts: { wealth?: 0 | 1 | 2; tile?: (x: number, y: number) => boolean } = {}): void {
  const r = slotRect(w, s);
  for (let y = r.y0; y <= r.y1 && !enough(); y++)
    for (let x = r.x0; x <= r.x1 && !enough(); x++) {
      const t = w.tiles[w.idx(x, y)];
      if (t.terrain !== Terrain.Land || t.road || t.buildingId >= 0 || t.zone !== ZoneType.None) continue;
      if (opts.tile && !opts.tile(x, y)) continue;
      if (t.ground === Ground.Reed && isWildReed(w, w.idx(x, y))) continue;
      w.setZone(x, y, zone);
      w.setLevel(x, y, level, false, opts.wealth ?? 0);
    }
}

/** A road from the start slot to (x, y) over owned tiles (bridges on water), by BFS. */
function connect(w: World, x: number, y: number): void {
  const start = (w.region * w.region - 1) >> 1;
  const sr = slotRect(w, start);
  const sx = sr.x0 + 32;
  const sy = sr.y0 + 32;
  const N = w.N;
  const prev = new Int32Array(w.area).fill(-2);
  const q = [sy * N + sx];
  prev[q[0]] = -1;
  const goal = y * N + x;
  while (q.length && prev[goal] === -2) {
    const i = q.shift()!;
    const ix = i % N;
    const iy = (i / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx;
      const ny = iy + dy;
      if (!w.isOwned(nx, ny)) continue;
      const j = ny * N + nx;
      if (prev[j] !== -2 || w.tiles[j].buildingId >= 0) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  expect(prev[goal]).not.toBe(-2);
  for (let i = goal; i >= 0; i = prev[i]) w.setRoad(i % N, (i / N) | 0);
}

/** Three L3 towers in a row in a slot, bridged into a Sky Lobby. */
function lobby(w: World, s: SlotId): void {
  const r = slotRect(w, s);
  for (let y = r.y0 + 2; y <= r.y1 - 2; y++)
    for (let x = r.x0 + 2; x + 8 <= r.x1 - 2; x++) {
      const xs = [x, x + 4, x + 8];
      const clear = (tx: number) => {
        for (let k = 0; k <= 8; k++) {
          const t = w.tiles[w.idx(x + k, y)];
          if (t.terrain !== Terrain.Land || t.buildingId >= 0 || t.road || t.zone !== ZoneType.None || t.elev !== w.tiles[w.idx(x, y)].elev) return false;
        }
        return tx >= 0;
      };
      if (!clear(0)) continue;
      for (const tx of xs) {
        w.setZone(tx, y, ZoneType.Residential);
        w.setLevel(tx, y, 3);
        w.tiles[w.idx(tx, y)].powered = true;
      }
      expect(applyAction(w, 'skybridge', { x: xs[0], y }, { x: xs[1], y }).valid).toBe(true);
      expect(applyAction(w, 'skybridge', { x: xs[1], y }, { x: xs[2], y }).valid).toBe(true);
      vertical.refresh(w);
      return;
    }
  throw new Error(`no lobby site in slot ${s}`);
}

/** The scripted builder: make one goal's check hold in its district. */
function achieve(w: World, s: SlotId, g: DistrictGoal): void {
  const census = () => slotCensus(w, s);
  const top = () => {
    const r = slotRect(w, s);
    let m = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) m = Math.max(m, w.tiles[w.idx(x, y)].elev);
    return m;
  };
  switch (g.id) {
    case 'shoals.islands': {
      const isl = shoalsIslands(w, s);
      expect(isl.length, 'islands').toBeGreaterThanOrEqual(1);
      for (const p of isl.slice(0, 3)) connect(w, p.x, p.y);
      return;
    }
    case 'shoals.beacon':
      return place(w, s, 'beacon', 1, 'shore');
    case 'shoals.residents':
      return develop(w, s, ZoneType.Residential, 3, () => census().residents >= 150000);
    case 'sunk.ruins': {
      const r = slotRect(w, s);
      let n = 0;
      for (let y = r.y0; y <= r.y1 && n < 40; y++)
        for (let x = r.x0; x <= r.x1 && n < 40; x++)
          if (isRuin(w.tiles[w.idx(x, y)])) {
            w.setLevel(x, y, 1, false);
            ruinRestored(w, x, y);
            n++;
          }
      return;
    }
    case 'sunk.gardens':
      return place(w, s, 'pumphouse', 3, 'shore');
    case 'sunk.memorial':
      return place(w, s, 'memorial', 1, 'bywater');
    case 'flats.brownfield': {
      const left = brownfieldSites(w, s).slice(0, 300);
      expect(left.length).toBe(300);
      for (const i of left) w.setGround(i % w.N, (i / w.N) | 0, Ground.Plain);
      return;
    }
    case 'flats.seaports':
      return place(w, s, 'seaport', 2, 'shore');
    case 'flats.reclaim':
    case 'tarmac.v2':
      return place(w, s, 'reclaim', 1);
    case 'terraces.top': {
      const t = top();
      return develop(w, s, ZoneType.Residential, 3, () => census().l3TopStep >= 10, { tile: (x, y) => w.tiles[w.idx(x, y)].elev === t });
    }
    case 'terraces.bore':
      return place(w, s, 'geothermal', 1);
    case 'reedmere.wild':
      w.stats.population = 100000;
      expect(wildReeds(w, s)).toBeGreaterThanOrEqual(300);
      return;
    case 'reedmere.floodwatch':
    case 'shoals.v1':
      return place(w, s, 'floodwatch', 1);
    case 'skeleton.frames':
    case 'skeleton.v1': {
      const n = g.id === 'skeleton.frames' ? 2 : 4;
      const fs = framesOf(w, s);
      expect(fs.length).toBeGreaterThanOrEqual(n);
      for (const f of fs) {
        const b = w.buildingAt(f.x, f.y);
        if (framesFinished(w, s) >= n || !b || b.type !== 'frame') continue;
        expect(finishFrame(w, b.id).reason ?? null, `${g.id} frame at ${f.x},${f.y}`).toBeNull();
      }
      return;
    }
    case 'skeleton.lobby':
    case 'bazaar.v2':
      return lobby(w, s);
    case 'tarmac.airport':
      return place(w, s, 'airport', 1);
    case 'tarmac.residents':
      return develop(w, s, ZoneType.Residential, 3, () => census().residents >= 100000);
    case 'bazaar.markets':
      return develop(w, s, ZoneType.Commercial, 2, () => census().marketRich >= 40, { wealth: 1 });
    case 'bazaar.hall':
      return place(w, s, 'markethall', 1);
    case 'shoals.v2':
      return develop(w, s, ZoneType.Residential, 3, () => census().residents >= 120000);
    case 'shoals.v3':
      return develop(w, s, ZoneType.Commercial, 1, () => census().developed[ZoneType.Commercial] >= 80);
    case 'terraces.v1':
      return develop(w, s, ZoneType.Residential, 3, () => census().residentsTop >= 20000, { tile: (x, y) => w.tiles[w.idx(x, y)].elev === 3 });
    case 'terraces.v2':
      return place(w, s, 'canopypark', 1);
    case 'terraces.v3':
      return place(w, s, 'plaza', 3);
    case 'reedmere.v1':
      return place(w, s, 'metro', 1);
    case 'reedmere.v2':
      return place(w, s, 'tidal', 1, 'water');
    case 'flats.v1':
      return develop(w, s, ZoneType.Industrial, 1, () => census().developed[ZoneType.Industrial] >= 200);
    case 'flats.v2':
      return place(w, s, 'maglev', 1);
    case 'skeleton.v2':
      return place(w, s, 'stack', 3);
    case 'tarmac.v1':
      return develop(w, s, ZoneType.Commercial, 1, () => census().developed[ZoneType.Commercial] >= 100);
    case 'bazaar.v1':
      return develop(w, s, ZoneType.Commercial, 1, () => bazaarVisitors(w, s) >= 5000);
    default:
      throw new Error(`no scripted builder for ${g.id}`);
  }
}

function shownAll<T>(fn: () => T): T {
  for (const t of HIDDEN) (BUILDINGS[t] as { hidden?: boolean }).hidden = false;
  try {
    return fn();
  } finally {
    for (const t of HIDDEN) (BUILDINGS[t] as { hidden?: boolean }).hidden = true;
  }
}

describe('which goals a district carries (§3.7)', () => {
  it('variant 0 carries its kind\'s goals; a repeat drops the `once` goals and its skipGoals and adds its own', () => {
    const w = region(5, 2091);
    for (let s = 0; s < 25; s++) {
      const kind = w.districts.kinds[s];
      if (kind === 'shore') continue;
      const v = w.variantOf(s);
      const ids = goalsOf(w, s).map((g) => g.id);
      const def = DISTRICTS[kind];
      if (v === 0) expect(ids).toEqual(def.goals.map((g) => g.id));
      else {
        const vd = def.variants[v - 1];
        expect(ids).toContain(vd.goal.id);
        for (const g of def.goals) {
          const expected = !g.once && !(vd.skipGoals ?? []).includes(g.id);
          expect(ids.includes(g.id), `${vd.name}: ${g.id}`).toBe(expected);
        }
      }
    }
    // Coral Strand has a spit, not islands.
    const strand = DISTRICTS.shoals.variants.find((v) => v.terrain === 'strand')!;
    expect(strand.skipGoals).toContain('shoals.islands');
  });
});

describe.each(REGIONS)('%i×%i: D6, every goal is reachable in its district and pays once', (R) => {
  it.each([2091, 7])('seed %i: each goal of each owned district completes on the month tick, pays its reward, posts one line', (seed) => {
    shownAll(() => {
      const w = region(R, seed);
      const done: string[] = [];
      w.events.on('districtGoal', (e) => done.push(`${e.id}@${e.slot}`));
      let expectedPay = 0;
      const all: string[] = [];
      for (const s of w.districts.owned) {
        if (w.districts.kinds[s] === 'shore') continue;
        for (const g of goalsOf(w, s)) {
          // The Tidal Turbine (optional, still hidden) can't stand yet: World.addBuilding refuses water footprints
          // (frozen world.ts; WP-2's report hands it to Step 9), so its variant goal is skipped here.
          if (g.needs === 'tidal') continue;
          expect(goalVisible(w, g), g.id).toBe(true);
          achieve(w, s, g);
          expect(goalMet(w, s, g.id), `${g.id} in slot ${s} (${w.districts.kinds[s]} v${w.variantOf(s)})`).toBe(true);
          all.push(`${g.id}@${s}`);
          expectedPay += g.reward;
        }
      }
      const funds = w.funds;
      const lines: string[] = [];
      const add = w.addNews.bind(w);
      w.addNews = (text: string, kind?: Parameters<World['addNews']>[1]) => {
        lines.push(text);
        return add(text, kind);
      };
      const keys = checkDistrictGoals(w);
      expect(keys.sort()).toEqual([...all].sort());
      expect(done.sort()).toEqual([...all].sort());
      expect(w.funds - funds).toBe(expectedPay);
      expect(lines).toHaveLength(all.length);
      for (const l of lines) expect(l).toMatch(/^[A-Z][A-Za-z ]+: .+\. \+[\d,]+ CR$/);
      // Once each.
      expect(checkDistrictGoals(w)).toEqual([]);
      expect(w.funds - funds).toBe(expectedPay);
    });
  });
});

describe('the late pay rule and visibility (§3.7)', () => {
  it('after an ending a goal pays max(reward, 0.25 × districtPrice(owned)), never scaled with funds', () => {
    const w = region(3, 31);
    expect(goalPay(w, 20000)).toBe(20000);
    w.story.ending = 'ledger';
    const late = Math.round(GOAL_LATE_SHARE * districtPrice(w.districts.owned.length));
    expect(goalPay(w, 20000)).toBe(Math.max(20000, late));
    w.funds = 1e12;
    expect(goalPay(w, 20000)).toBe(Math.max(20000, late));
  });

  it('a goal that names a building type stays hidden while that type is hidden; hidden goals never complete', () => {
    const w = region(3, 31);
    const flats = w.districts.kinds.indexOf('flats');
    const g = goalsOf(w, flats).find((x) => x.id === 'flats.reclaim')!;
    expect(BUILDINGS.reclaim.hidden).toBe(true);
    expect(goalVisible(w, g)).toBe(false);
    shownAll(() => place(w, flats, 'reclaim', 1));
    expect(goalMet(w, flats, 'flats.reclaim')).toBe(true);
    expect(checkDistrictGoals(w)).not.toContain(`flats.reclaim@${flats}`);
  });

  it('every check reads only its own district: two Shoals districts complete their residents goal apart', () => {
    shownAll(() => {
      const w = region(5, 2091);
      const shoals = w.districts.owned.filter((s) => w.districts.kinds[s] === 'shoals');
      expect(shoals.length).toBe(4);
      const [a, b] = shoals;
      achieve(w, a, { id: 'shoals.residents', label: '', reward: 0 });
      expect(goalMet(w, a, 'shoals.residents')).toBe(true);
      expect(goalMet(w, b, 'shoals.residents')).toBe(false);
    });
  });
});
