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

/** Pinned by Step 0b in Node 22 (seeds as SEEDS; [3×3, 5×5]). WP-2's generators re-pin. */
export const PINNED: string[][] = [
  ['d6fe55a6', 'e30a2323'],
  ['ea6b1a8c', 'd9548a43'],
  ['5f9788f9', '7b58f513'],
  ['d5ffedda', '86b36877'],
  ['8ca0f38f', '0671fd8c'],
];
