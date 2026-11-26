// The sprite cache's paint budget (docs/MEGACITY.md §6.1, §11.1): a frame paints while the time spent is under its
// budget (so it ends at most one sprite past it); bodies past that draw a stand-in. Same-family stand-ins (another
// night or scale bucket) are counted as stale, which turns on the Renderer's centre-first pass.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpriteCache, type Sprite } from '../src/render/art/sprites';

let clock = 0;
const sprite = (): Sprite => ({ canvas: { width: 1, height: 1 } as HTMLCanvasElement, ox: 0, oy: 0, w: 1, h: 1, scale: 1, bytes: 4, used: 0, key: 0, family: 0 });
/** A build that takes `ms` of the fake clock. */
const build = (ms: number) => () => {
  clock += ms;
  return sprite();
};

afterEach(() => vi.restoreAllMocks());

describe('SpriteCache paint budget', () => {
  it('a frame of 2.5 ms sprites with a 6 ms budget paints three (the last starts at 5 ms), the rest fall back', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const c = new SpriteCache();
    c.budgetMs = 6;
    c.newFrame();
    let painted = 0;
    let fallbacks = 0;
    for (let k = 0; k < 10; k++) {
      const s = c.get(100 + k, 100 + k, build(2.5), () => {
        fallbacks++;
        return sprite();
      });
      if (s && c.has(100 + k)) painted++;
    }
    expect(painted).toBe(3);
    expect(c.spentMs).toBe(7.5);
    expect(fallbacks).toBe(7);
    // Next frame: the first paint always runs, even if it alone is over the budget.
    c.newFrame();
    c.get(500, 500, build(9));
    expect(c.has(500)).toBe(true);
    expect(c.spentMs).toBe(9);
  });

  it('a body drawn from its sprite at another bucket because the budget was spent counts as stale', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const c = new SpriteCache();
    c.budgetMs = 1;
    c.newFrame();
    c.get(1, 7, build(0.5));
    c.newFrame();
    c.get(2, 8, build(2));
    // Family 7's sprite at another key (another night bucket): over budget → the old one, counted stale.
    const s = c.get(3, 7, build(0.5));
    expect(c.has(3)).toBe(false);
    expect(s).not.toBeNull();
    expect(c.stale).toBe(1);
    c.newFrame();
    expect(c.stale).toBe(0);
  });
});
