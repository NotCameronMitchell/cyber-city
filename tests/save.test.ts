import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/sim';
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
