// Ruins (docs/MEGACITY.md §3.3, §3.7, §11.3 D2, §11.5 WP-1): a ruin is a zoned, abandoned tile on ground Rubble. The
// census counts it in `ruins`, never in `abandoned`; it never collapses; it recovers like an abandoned tile once a road
// and power reach it, at RECOVER_CHANCE × recoverMul (2 in the Sunk), turning Plain, counting districts.ruinsRestored
// and paying restorePay up to RUINS.payCapMonth a month; untouched, ≥ 90% still stand after 2 sim years.

import { describe, expect, it } from 'vitest';
import { ruinRestored } from '../src/game/actions';
import { DISTRICTS, RUINS, milestonesFor } from '../src/game/config';
import { slotRect } from '../src/game/districts/slots';
import { Simulation } from '../src/game/sim';
import type { Census } from '../src/game/sim/census';
import { Ground, Terrain, ZoneType, type DistrictKind, type SlotId } from '../src/game/types';
import { World } from '../src/game/world';
import { fillSlot } from './megacity-fixture';

/** A 3×3 world owning the start slot plus the first slot of `kind`. */
function withKind(kind: DistrictKind, seed = 2091): { w: World; slot: SlotId } {
  const w = World.generate(seed, 'Ruins', undefined, 3);
  w.funds = 1e9;
  w.maxPopulation = 1e9;
  const slot = w.districts.kinds.findIndex((k, s) => k === kind && s !== 4);
  if (slot < 0) throw new Error(`no ${kind} slot`);
  w.annex(slot);
  return { w, slot };
}

function sim(w: World): Simulation {
  const s = new Simulation(w);
  s.options.events = false;
  s.recomputeAll();
  return s;
}

const census = (s: Simulation) => (s as unknown as { census: Census }).census;

/** Abandon up to `max` developed zone tiles of a slot (from fillSlot), on `ground`. Returns their indices. */
function abandonIn(w: World, slot: SlotId, ground: Ground, max: number): number[] {
  const r = slotRect(w, slot);
  const out: number[] = [];
  for (let y = r.y0; y <= r.y1 && out.length < max; y++)
    for (let x = r.x0; x <= r.x1 && out.length < max; x++) {
      const t = w.tileAt(x, y)!;
      if (t.zone === ZoneType.None || t.level === 0 || t.buildingId >= 0) continue;
      w.setLevel(x, y, t.level, true);
      w.setGround(x, y, ground);
      t.age = 0;
      out.push(y * w.N + x);
    }
  return out;
}

describe('ruins (§3.7, D2)', () => {
  it('count in stats.ruins and per district, never in abandoned (the advisor line and "Dark lots" never see them)', () => {
    const { w, slot } = withKind('sunk');
    fillSlot(w, slot);
    const made = abandonIn(w, slot, Ground.Rubble, 120).length;
    const s = sim(w);
    // The Sunk's annex content brings ruins of its own: count every zoned, abandoned Rubble tile.
    let all = 0;
    let shells = 0;
    for (let i = 0; i < w.area; i++) {
      const t = w.tiles[i];
      if (!w.ownedAt(i) || t.zone === ZoneType.None || !t.abandoned) continue;
      if (t.ground === Ground.Rubble) all++;
      else shells++;
    }
    expect(all).toBeGreaterThanOrEqual(made);
    expect(w.stats.ruins).toBe(all);
    expect(w.stats.abandonedTiles).toBe(shells);
    expect(census(s).abandoned).toBe(shells);
    expect(w.stats.districts.find((d) => d.slot === slot)!.ruins).toBe(all);
  });

  it('untouched (no road, no power) ≥ 90% stand after 2 sim years, while plain abandoned shells collapse', () => {
    const { w, slot } = withKind('sunk');
    const r = slotRect(w, slot);
    const ruins: number[] = [];
    const shells: number[] = [];
    for (let y = r.y0 + 4; y < r.y0 + 60 && ruins.length + shells.length < 400; y += 2)
      for (let x = r.x0 + 4; x < r.x0 + 60 && ruins.length + shells.length < 400; x += 2) {
        if (w.tileAt(x, y)!.terrain !== Terrain.Land || w.tileAt(x, y)!.buildingId >= 0) continue;
        w.setZone(x, y, ZoneType.Residential);
        w.setLevel(x, y, 1, true);
        const rubble = (x + y) % 4 === 0;
        w.setGround(x, y, rubble ? Ground.Rubble : Ground.Plain);
        (rubble ? ruins : shells).push(y * w.N + x);
      }
    expect(ruins.length).toBeGreaterThan(50);
    const s = sim(w);
    for (let d = 0; d < 720; d++) s.step();
    const standing = (list: number[]) => list.filter((i) => w.tiles[i].abandoned && w.tiles[i].level > 0).length;
    expect(standing(ruins)).toBeGreaterThanOrEqual(Math.ceil(0.9 * ruins.length));
    // The exemption is what keeps them: shells on plain ground past COLLAPSE_AGE fall to empty lots.
    expect(standing(shells)).toBeLessThan(0.5 * shells.length);
  });

  it('Sunk ruins recover ≥ 1.8× as often as abandoned tiles elsewhere (road and power present), turning Plain', () => {
    const { w, slot } = withKind('sunk');
    fillSlot(w, 4);
    fillSlot(w, slot, 3);
    const shells = abandonIn(w, 4, Ground.Plain, 600);
    const ruins = abandonIn(w, slot, Ground.Rubble, 600);
    expect(Math.min(shells.length, ruins.length)).toBeGreaterThan(300);
    const s = sim(w);
    w.mods.demandRes = 0.5;
    w.mods.demandCom = 0.5;
    w.mods.demandInd = 0.5;
    const days = 8;
    const before = w.districts.ruinsRestored ?? 0;
    for (let d = 0; d < days; d++) s.step();
    const back = (list: number[]) => list.filter((i) => !w.tiles[i].abandoned).length;
    // Daily hazard per group (−ln(1 − share) / days): the ratio is the multiplier however many have come back.
    const hazard = (n: number, of: number) => -Math.log(1 - n / of) / days;
    const hs = hazard(back(shells), shells.length);
    const hr = hazard(back(ruins), ruins.length);
    expect(hs).toBeGreaterThan(0);
    expect(hr / hs).toBeGreaterThanOrEqual(1.8);
    expect(DISTRICTS.sunk.mods.recoverMul).toBe(2);
    const restored = ruins.filter((i) => !w.tiles[i].abandoned);
    expect(restored.every((i) => w.tiles[i].ground === Ground.Plain)).toBe(true);
    expect((w.districts.ruinsRestored ?? 0) - before).toBeGreaterThanOrEqual(restored.length);
  });

  it('a restored ruin pays restorePay, at most RUINS.payCapMonth a month; with Game\'s hook the cap is shared with the player\'s restores', () => {
    const run = (hook: boolean) => {
      const { w, slot } = withKind('sunk');
      fillSlot(w, slot, 3);
      const ruins = abandonIn(w, slot, Ground.Rubble, 900);
      const s = sim(w);
      if (hook) s.ruinRestored = ruinRestored;
      w.mods.demandRes = w.mods.demandCom = w.mods.demandInd = 0.5;
      // Start on a month's first day, so the whole run is one month of pay.
      while (w.tick % 30 !== 0) s.step();
      if (hook) {
        // The player restored two ruins by hand this month (actions.ts pays them from the same cap).
        const p = ruins.slice(-2);
        for (const i of p) {
          w.setLevel(i % w.N, (i / w.N) | 0, w.tiles[i].level, false);
          ruinRestored(w, i % w.N, (i / w.N) | 0);
        }
      }
      // Every milestone bonus already paid: within a month only the restore pay moves funds (settlement is on the
      // month end, which this run never reaches).
      for (const m of milestonesFor(w.region)) if (!w.milestones.includes(m.pop)) w.milestones.push(m.pop);
      const restored0 = w.districts.ruinsRestored ?? 0;
      const funds0 = w.funds;
      for (let d = 0; d < 29; d++) s.step();
      return { restored: (w.districts.ruinsRestored ?? 0) - restored0, paid: w.funds - funds0 };
    };
    const pay = DISTRICTS.sunk.mods.restorePay!;
    expect(pay).toBeGreaterThan(0);
    const plain = run(false);
    expect(plain.restored * pay).toBeGreaterThan(RUINS.payCapMonth); // enough recoveries to hit the cap
    expect(plain.paid).toBe(RUINS.payCapMonth);
    const shared = run(true);
    expect(shared.paid).toBe(RUINS.payCapMonth - 2 * pay);
  });
});
