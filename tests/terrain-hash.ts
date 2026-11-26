// The terrain golden hash (docs/MEGACITY.md §3.6.1 rule 5, §11.2 item 17), shared by tests/terrain-golden.test.ts (Node)
// and tests/bench/bench.html (browsers), so every engine hashes the same thing.

import { seedLayout } from '../src/game/districts/layout';
import { World } from '../src/game/world';

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

export const SEEDS = [1, 2091, 7, 31, 0xdeadbeef];

/** Pinned in Node 22 (seeds as SEEDS; [3×3, 5×5]): WP-2's district generators, presets and border blending. */
export const PINNED: string[][] = [
  ['8051fcab', 'd5d79aba'],
  ['ae09a3f9', 'fb0b166c'],
  ['12c89bd6', 'c3322520'],
  ['6c7d2111', 'ca7f4ecb'],
  ['85f01d8a', 'b0a431b5'],
];
