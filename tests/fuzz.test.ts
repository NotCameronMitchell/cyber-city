import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/game/actions';
import { Rng } from '../src/game/rng';
import type { ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { makeSim } from './helpers';
import { LEGACY_REGION } from '../src/game/types';

const TOOLS: ToolId[] = [
  'road', 'road', 'road', 'res', 'res', 'com', 'ind', 'bulldoze',
  'solar', 'reactor', 'plaza', 'precinct', 'clinic', 'datahub', 'maglev', 'spire', 'arcology',
  // Expansion (EXPANSION §3, §5, §6.1).
  'avenue', 'highway', 'alley', 'alley', 'skyway', 'bulldoze', 'academy', 'seaport', 'airport', 'spaceport',
];

describe('fuzz', () => {
  it('survives random player actions interleaved with simulation', () => {
    const w = World.generate(777, 'Chaos Quay', undefined, LEGACY_REGION);
    w.funds = 5e6;
    w.maxPopulation = 1e6; // unlock everything
    const sim = makeSim(w, true);
    const rng = new Rng(4);
    const p = () => ({ x: rng.int(-2, 65), y: rng.int(-2, 65) });
    for (let tick = 0; tick < 1500; tick++) {
      if (rng.chance(0.4)) {
        const a = p();
        const b = rng.chance(0.5) ? a : { x: a.x + rng.int(-8, 8), y: a.y + rng.int(-8, 8) };
        applyAction(w, rng.pick(TOOLS), a, b);
        sim.recomputeAll();
      }
      if (rng.chance(0.01)) w.taxRate = rng.int(0, 20);
      sim.step();
    }
    const s = w.stats;
    for (const v of [s.population, s.jobsCom, s.jobsInd, s.powerSupply, s.powerDemand, s.approval, w.funds]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(s.demand.res).toBeGreaterThanOrEqual(-1);
    expect(s.demand.res).toBeLessThanOrEqual(1);
    for (const [name, f] of Object.entries(w.fields)) {
      for (const v of f as Float32Array) if (!(v >= 0 && v <= 1)) throw new Error(`${name} out of range: ${v}`);
    }
    for (const t of w.tiles) {
      expect(t.level).toBeGreaterThanOrEqual(0);
      expect(t.level).toBeLessThanOrEqual(3);
      if (t.zone === 0) expect(t.level).toBe(0);
      // Expansion invariants (§2.1).
      if (!t.road) expect(t.roadKind).toBe(0);
      if (t.zone === 0 || t.level === 0) expect(t.wealth).toBe(0);
      if (t.terrain === 1) expect(t.roadKind === 3 || t.roadKind === 4).toBe(false);
    }
    // Every skyway link is mutual; at most one airport and one spaceport, two seaports.
    for (let i = 0; i < 4096; i++) {
      const m = w.sky[i] & 15;
      if (m & 1) expect(w.sky[i - 64] & 4).toBe(4);
      if (m & 2) expect(w.sky[i + 1] & 8).toBe(8);
      if (m & 4) expect(w.sky[i + 64] & 1).toBe(1);
      if (m & 8) expect(w.sky[i - 1] & 2).toBe(2);
    }
    const count = (t: string) => [...w.buildings.values()].filter((b) => b.type === t).length;
    expect(count('airport')).toBeLessThanOrEqual(1);
    expect(count('spaceport')).toBeLessThanOrEqual(1);
    expect(count('seaport')).toBeLessThanOrEqual(2);
  });
});

describe('fuzz on a 3×3 region with annexes and the Megacity tools (MEGACITY §11.5, WP-2)', () => {
  it('random actions, annexes and new building types keep the district invariants', async () => {
    const { BUILDINGS, PORT_LIMITS } = await import('../src/game/config');
    const { districtDaily } = await import('../src/game/districts/daily');
    const { adjacentLocked } = await import('../src/game/districts/slots');
    const { finishFrame } = await import('../src/game/actions');
    const hidden = (Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[]).filter((t) => BUILDINGS[t].hidden && t !== 'frame' && t !== 'pumphall');
    for (const t of hidden) (BUILDINGS[t] as { hidden?: boolean }).hidden = false;
    try {
      const w = World.generate(4242, 'Chaos Reach', undefined, 3);
      w.funds = 5e7;
      w.maxPopulation = 1e7;
      w.story.unlocks.push('skybridge', 'rail', 'memorial', 'stack');
      w.story.flags.published = true;
      const sim = makeSim(w, true);
      sim.districtDaily = districtDaily;
      const rng = new Rng(9);
      const tools: ToolId[] = [...TOOLS, 'skybridge', 'skybridge', 'rail', 'res', 'com', ...hidden.filter((t) => t !== 'gantry')] as ToolId[];
      const p = () => ({ x: rng.int(-2, w.N + 1), y: rng.int(-2, w.N + 1) });
      for (let tick = 0; tick < 900; tick++) {
        if (tick % 120 === 60) {
          const c = adjacentLocked(w);
          if (c.length) w.annex(rng.pick(c));
          sim.recomputeAll();
        }
        if (rng.chance(0.5)) {
          const a = p();
          const b = rng.chance(0.5) ? a : { x: a.x + rng.int(-10, 10), y: a.y + rng.int(-10, 10) };
          applyAction(w, rng.pick(tools), a, b);
          sim.recomputeAll();
        }
        if (rng.chance(0.02)) for (const f of [...w.buildings.values()].filter((b) => b.type === 'frame').slice(0, 1)) finishFrame(w, f.id);
        sim.step();
      }
      expect(w.districts.owned.length).toBeGreaterThan(3);
      for (let i = 0; i < w.area; i++) {
        const t = w.tiles[i];
        if (t.terrain === 1) {
          expect(t.elev).toBe(0);
          expect(t.ground).toBe(0);
        }
        if (w.ownedAt(i)) continue;
        expect(t.road, `road on locked ${i}`).toBe(false);
        expect(t.zone).toBe(0);
        expect(t.buildingId).toBe(-1);
        expect(w.rail[i]).toBe(0);
        expect(w.sky[i]).toBe(0);
      }
      for (const l of w.links) {
        expect(w.isOwned(l.ax, l.ay) && w.isOwned(l.bx, l.by)).toBe(true);
        const gap = Math.abs(l.bx - l.ax) + Math.abs(l.by - l.ay) - 1;
        expect(gap).toBeGreaterThanOrEqual(1);
        expect(gap).toBeLessThanOrEqual(10);
      }
      const count = (t: string) => [...w.buildings.values()].filter((b) => b.type === t).length;
      const owned = w.districts.owned.length;
      expect(count('seaport')).toBeLessThanOrEqual(PORT_LIMITS.seaport(owned));
      expect(count('airport')).toBeLessThanOrEqual(PORT_LIMITS.airport(owned));
      for (const [name, f] of Object.entries(w.fields)) {
        for (let i = 0; i < w.area; i++) {
          const v = (f as Float32Array)[i];
          if (!(v >= 0 && v <= 1)) throw new Error(`${name} out of range at ${i}: ${v}`);
        }
      }
      for (const v of [w.stats.population, w.stats.jobsCom, w.stats.jobsInd, w.funds]) expect(Number.isFinite(v)).toBe(true);
    } finally {
      for (const t of hidden) (BUILDINGS[t] as { hidden?: boolean }).hidden = true;
    }
  }, 120000);
});
