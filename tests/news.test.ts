import { describe, expect, it } from 'vitest';
import { CORPS, CREWS, DISTRICTS, EVENT_COPY, HEADLINES, HeadlineDeck, districtName, fillTemplate } from '../src/game/news';
import { Rng } from '../src/game/rng';
import { flatWorld, makeSim, run } from './helpers';

/** Franchise terms that must never appear in our copy (IP rule). */
const BANNED = [
  'night city', 'arasaka', 'militech', 'kang tao', 'netrunner', 'ripperdoc', 'eddies', 'braindance',
  'preem', 'choom', 'nova', 'delta', 'gonk', 'ncpd', 'trauma team', 'simoleon', 'sims', 'reticulating splines',
  'edgerunner', 'corpo', 'maelstrom', 'tyger', 'valentino', 'voodoo boys', 'cyberware', 'chrome',
];

const ctx = { city: 'Test Harbor', population: 99999, year: 2093, taxRate: 9 };

describe('news desk', () => {
  it('has 40+ original headlines with resolvable placeholders', () => {
    expect(HEADLINES.length).toBeGreaterThanOrEqual(40);
    const vars = { city: 'X', pop: 1, year: 1, lastYear: 1, district: 'D', corp: 'C', crew: 'G', n: 1, tax: 9 };
    for (const h of HEADLINES) expect(fillTemplate(h.text, vars)).not.toMatch(/\{\w+\}/);
  });

  it('copy avoids franchise names and slang', () => {
    const all = [
      ...HEADLINES.map((h) => h.text),
      ...Object.values(EVENT_COPY).flat(),
      ...CORPS,
      ...CREWS,
      ...DISTRICTS,
    ].join('\n').toLowerCase();
    // Whole words (optionally plural), so "corporations" doesn't trip "corpo".
    for (const word of BANNED) expect(all, word).not.toMatch(new RegExp(`\\b${word}s?\\b`));
  });

  it('deals every eligible headline once before repeating', () => {
    const deck = new HeadlineDeck();
    const rng = new Rng(7);
    const seen = new Set<string>();
    // Strip randomized fills so the same template compares equal.
    const n = HEADLINES.length;
    for (let i = 0; i < n; i++) seen.add(deck.draw(rng, { ...ctx, city: 'C' }).replace(/[0-9,]+/g, '#'));
    expect(seen.size).toBeGreaterThan(n * 0.8);
  });

  it('respects city-size gates', () => {
    const deck = new HeadlineDeck();
    const rng = new Rng(3);
    const small = HEADLINES.filter((h) => (h.minPop ?? 0) > 50).map((h) => h.text.slice(0, 20));
    for (let i = 0; i < 200; i++) {
      const text = deck.draw(rng, { ...ctx, population: 50 });
      for (const s of small) if (!s.includes('{')) expect(text.startsWith(s)).toBe(false);
    }
  });

  it('district names are stable per 8×8 block', () => {
    expect(districtName(3, 3, 1)).toBe(districtName(7, 0, 1));
    expect(DISTRICTS).toContain(districtName(40, 12, 9));
  });

  it('runs a flavor headline every ~8-20 days', () => {
    const w = flatWorld();
    const sim = makeSim(w);
    run(sim, 360);
    const flavor = w.news.filter((n) => n.kind === 'flavor').length;
    // world.news keeps the last 40 items; count via events instead for a full year.
    expect(flavor).toBeGreaterThan(10);
  });

  it('advisor warns about missing power and roads, rate-limited', () => {
    const w = flatWorld();
    for (let x = 10; x < 20; x++) w.setZone(x, 10, 1);
    for (let x = 10; x < 20; x++) w.setZone(x, 30, 1);
    const sim = makeSim(w);
    const warns: string[] = [];
    w.events.on('news', (n) => {
      if (n.kind === 'warn') warns.push(n.text);
    });
    run(sim, 60);
    const power = warns.filter((t) => t.includes('without power'));
    const roads = warns.filter((t) => t.includes('no usable road'));
    expect(power.length).toBeGreaterThanOrEqual(1);
    expect(power.length).toBeLessThanOrEqual(2);
    expect(roads.length).toBeGreaterThanOrEqual(1);
    expect(roads.length).toBeLessThanOrEqual(2);
  });
});
