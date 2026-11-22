// Regression: growth must never push its own grid into a brownout. A city
// with one small plant should plateau at its power capacity instead of
// overshooting, browning out and abandoning blocks.
import { describe, expect, it } from 'vitest';
import { act, flatWorld, makeSim, run } from './helpers';

describe('power headroom', () => {
  it('a single solar farm city plateaus without brownouts or power abandonment', () => {
    const world = flatWorld(77);
    world.funds = 1_000_000;
    // Spine road with zones on both sides (far more lots than 100 MW can feed).
    expect(act(world, 'road', { x: 10, y: 30 }, { x: 50, y: 30 })).toBe(true);
    expect(act(world, 'res', { x: 10, y: 27 }, { x: 30, y: 29 })).toBe(true);
    expect(act(world, 'ind', { x: 31, y: 27 }, { x: 50, y: 29 })).toBe(true);
    expect(act(world, 'com', { x: 10, y: 31 }, { x: 50, y: 33 })).toBe(true);
    expect(act(world, 'solar', { x: 20, y: 35 })).toBe(true);
    // Connect the plant to the road.
    act(world, 'road', { x: 20, y: 34 }, { x: 20, y: 31 });
    const sim = makeSim(world);
    let deficitDays = 0;
    run(sim, 360 * 4, () => {
      if (world.stats.powerDemand > world.stats.powerSupply) deficitDays++;
    });
    const abandoned = world.tiles.filter((t) => t.abandoned).length;
    expect(world.stats.population).toBeGreaterThan(100);
    expect(world.stats.powerDemand).toBeLessThanOrEqual(world.stats.powerSupply);
    expect(deficitDays).toBe(0);
    expect(abandoned).toBe(0);
  });
});
