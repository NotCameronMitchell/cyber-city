// Merged parcels as a pure function (docs/MEGACITY.md §6.1, Step 0b): the merge rule, level and tier, heads, the map.

import { describe, expect, it } from 'vitest';
import { PARCEL_HEAD, PARCEL_MEMBER, PARCEL_SHAPE, fillParcelMap, parcelAt, parcelMap } from '../src/game/parcels';
import { LEGACY_REGION, ZoneType } from '../src/game/types';
import { World } from '../src/game/world';

/** A world whose start slot is one big developed Hab block (every tile level 1..3, tier 0..2). */
function block(region: 1 | 3, seed = 11): World {
  const w = new World(seed, 'Parcels', undefined, region);
  const b = w.ownedBox;
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      w.setZone(x, y, ZoneType.Residential);
      w.setLevel(x, y, 1 + ((x * 7 + y * 3) % 3), false, ((x + y) % 3) as 0 | 1 | 2);
    }
  return w;
}

describe('parcels (§6.1)', () => {
  it('quads are aligned to even coordinates, pairs and quads draw at their lowest level and tier, the head is the front corner', () => {
    const w = block(3);
    const b = w.ownedBox;
    let quads = 0;
    let pairs = 0;
    let singles = 0;
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const p = parcelAt(w, x, y);
        if (!p) {
          singles++;
          continue;
        }
        expect(p.x % 2 === 0 || p.w === 1).toBe(true);
        expect(p.y % 2 === 0 || p.h === 1).toBe(true);
        expect([p.hx, p.hy]).toEqual([p.x + p.w - 1, p.y + p.h - 1]);
        let lv = 3;
        let tier = 2;
        for (let dy = 0; dy < p.h; dy++)
          for (let dx = 0; dx < p.w; dx++) {
            lv = Math.min(lv, w.tileAt(p.x + dx, p.y + dy)!.level);
            tier = Math.min(tier, w.tileAt(p.x + dx, p.y + dy)!.wealth);
          }
        expect([p.level, p.tier]).toEqual([lv, tier]);
        // Every member reports the same parcel.
        expect(parcelAt(w, p.x, p.y)).toEqual(p);
        if (p.w === 2 && p.h === 2) quads++;
        else pairs++;
      }
    // About half the blocks merge whole; most of the rest pair up.
    expect(quads / 4).toBeGreaterThan(300);
    expect(pairs).toBeGreaterThan(500);
    expect(singles).toBeGreaterThan(0);
  });

  it('level and tier never take part: levelling up keeps every parcel; a member abandoned, rezoned or built on splits it', () => {
    const w = block(3);
    const b = w.ownedBox;
    const before = new Uint8Array(w.area);
    fillParcelMap(w, before);
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) w.setLevel(x, y, 3, false, 2);
    const after = new Uint8Array(w.area);
    fillParcelMap(w, after);
    expect(Array.from(after)).toEqual(Array.from(before));
    // Find a quad and break one member three ways.
    let q = -1;
    for (let i = 0; i < w.area && q < 0; i++) if ((before[i] & PARCEL_SHAPE) === 3 && before[i] & PARCEL_HEAD) q = i;
    const hx = q % w.N;
    const hy = (q / w.N) | 0;
    w.setLevel(hx, hy, 3, true);
    expect(parcelAt(w, hx, hy)).toBeNull();
    w.setLevel(hx, hy, 3, false);
    expect(parcelAt(w, hx, hy)?.w).toBe(2);
    w.setZone(hx, hy, ZoneType.Commercial);
    expect(parcelAt(w, hx, hy)).toBeNull();
  });

  it('the map marks members, heads and shapes; parcelMap follows world.version; a migrated start slot merges as on the 64 map', () => {
    const w = block(3);
    const map = parcelMap(w);
    let heads = 0;
    for (let i = 0; i < w.area; i++) {
      if (!(map[i] & PARCEL_MEMBER)) continue;
      if (map[i] & PARCEL_HEAD) heads++;
      const p = parcelAt(w, i % w.N, (i / w.N) | 0)!;
      expect(p).not.toBeNull();
      expect(map[i] & PARCEL_SHAPE).toBe(p.w === 2 && p.h === 2 ? 3 : p.w === 2 ? 1 : 2);
    }
    expect(heads).toBeGreaterThan(0);
    const b = w.ownedBox;
    w.setZone(b.x0, b.y0, ZoneType.Industrial);
    expect(parcelMap(w)[w.idx(b.x0, b.y0)] & PARCEL_MEMBER).toBe(parcelAt(w, b.x0, b.y0) ? PARCEL_MEMBER : 0);
    // The art offset is even (64), so the start slot of a 3×3 region merges exactly as the legacy 64 frame.
    const legacy = block(LEGACY_REGION);
    const region = block(3);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const a = parcelAt(legacy, x, y);
        const c = parcelAt(region, x + 64, y + 64);
        expect(c ? [c.x - 64, c.y - 64, c.w, c.h] : null).toEqual(a ? [a.x, a.y, a.w, a.h] : null);
      }
  });
});
