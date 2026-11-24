// Same terrain on every engine (docs/MEGACITY.md §3.6.1 rule 5, §11.2 item 17). A hash of World.generate and assignKinds
// for 5 seeds per region equals a pinned value in Node. WP-2 replaces the generator stubs and re-pins these values;
// Step 9 runs the same page in Playwright Chromium (and WebKit / Firefox where installed).

import { describe, expect, it } from 'vitest';
import { seedLayout } from '../src/game/districts/layout';
import { World } from '../src/game/world';

const SRC = import.meta.glob(['../src/game/districts/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** FNV-1a over the terrain, variant, elev and ground of every tile, and the layout. */
export function terrainHash(seed: number, region: 3 | 5): string {
  const w = World.generate(seed, 'Golden', undefined, region);
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const t of w.tiles) {
    mix(t.terrain);
    mix(t.variant);
    mix(t.elev | (t.ground << 2));
  }
  const l = seedLayout(seed, region);
  for (const k of l.kinds) for (let i = 0; i < k.length; i++) mix(k.charCodeAt(i));
  for (const v of l.variants) mix(v);
  return h.toString(16).padStart(8, '0');
}

const SEEDS = [1, 2091, 7, 31, 0xdeadbeef];

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

/** Pinned by Step 0b in Node 22 (seeds as SEEDS; [3×3, 5×5]). WP-2's generators re-pin. */
const PINNED: string[][] = [
  ['d6fe55a6', 'e30a2323'],
  ['ea6b1a8c', 'd9548a43'],
  ['5f9788f9', '7b58f513'],
  ['d5ffedda', '86b36877'],
  ['8ca0f38f', '0671fd8c'],
];
