// Same terrain on every engine (docs/MEGACITY.md §3.6.1 rule 5, §11.2 item 17). A hash of World.generate and assignKinds
// for 5 seeds per region equals a pinned value in Node. WP-2 replaces the generator stubs and re-pins these values;
// tests/bench/bench.html computes the same hashes in a browser (the device check ran it in Playwright Chromium, §11.6).

import { describe, expect, it } from 'vitest';
import { PINNED, SEEDS, terrainHash } from './terrain-hash';

const SRC = import.meta.glob(['../src/game/districts/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('terrain golden hashes (§11.2 item 17)', () => {
  it('World.generate and assignKinds hash to the pinned values on both regions', () => {
    const got = SEEDS.map((s) => [terrainHash(s, 3), terrainHash(s, 5)]);
    expect(got).toEqual(PINNED);
  }, 30000);

  it('no district generator calls Math.sin, cos, exp or pow (the start generator keeps its river)', () => {
    for (const [file, text] of Object.entries(SRC)) {
      // The start generator (generateStart) keeps today's Math.sin river for bit-identity; nothing else may.
      const body = text
        .replace(/export function generateStart[\s\S]*?\n}\n/, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(body.match(/Math\.(sin|cos|exp|pow)\b/g) ?? [], file).toEqual([]);
    }
  });
});
