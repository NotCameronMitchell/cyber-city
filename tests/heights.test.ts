// Heights (docs/MEGACITY.md §3.2, §5.3, §6.1): CLASSIC_TOPS equals today's art, kitTop's bounds, heightOf / roofOf.

import { describe, expect, it } from 'vitest';
import './canvas-mock';
import { BUILDINGS } from '../src/game/config';
import { CLASSIC_TOPS, HEIGHT_BOUNDS, STYLE_HEIGHT, classicId, elevOffset, heightOf, kitTop, roofOf } from '../src/game/heights';
import { DISTRICT_KINDS, LEGACY_REGION, ZoneType } from '../src/game/types';
import { World } from '../src/game/world';
import { zoneModelId, zoneModelInfo } from '../src/render/buildings';

describe('heights (§3.2)', () => {
  it('CLASSIC_TOPS has the 432 classic bodies and equals the art; classicId is the render id', () => {
    expect(CLASSIC_TOPS).toHaveLength(432);
    for (let id = 0; id < 432; id++) {
      const palBit = id & 1;
      const tier = (id >> 1) % 3;
      const form = Math.floor(id / 6) % 8;
      const level = (Math.floor(id / 48) % 3) + 1;
      const zone = Math.floor(id / 144) + 1;
      const variant = form | (palBit << 3);
      expect(classicId(zone, level, variant, tier)).toBe(zoneModelId(zone, level, variant, tier));
      expect(CLASSIC_TOPS[id]).toBeCloseTo(zoneModelInfo(zone, level, variant, tier).top, 1);
    }
    // §5.3's measured bounds: today's L3 Hab and Market bodies are 128–216 px, L2 bodies ≤ 84.
    for (let id = 0; id < 432; id++) {
      const level = (Math.floor(id / 48) % 3) + 1;
      const zone = Math.floor(id / 144) + 1;
      if (level === 2) expect(CLASSIC_TOPS[id]).toBeLessThanOrEqual(84);
      // (One classic Market body measures 127.97 px: §5.3's "128" is that rounded; WP-4's kit bound stays 128.)
      if (level === 3 && zone !== ZoneType.Industrial) expect(CLASSIC_TOPS[id]).toBeGreaterThanOrEqual(127.9);
    }
  });

  it('kitTop stays inside the bounds at every style, level, parcel and seed', () => {
    for (const style of DISTRICT_KINDS)
      for (const zone of [1, 2, 3])
        for (const level of [1, 2, 3])
          for (const parcel of [0, 1, 2] as const)
            for (let seed = 0; seed < 4; seed++) {
              const h = kitTop({ zone, level, tier: 0, style, form: 8, parcel, palBit: 0, seed });
              const key = level === 1 ? 'l1' : level === 2 ? 'l2' : zone === 3 ? 'fabL3' : parcel === 2 ? 'l3Quad' : parcel === 1 ? 'l3Pair' : 'l3Single';
              const [lo, hi] = HEIGHT_BOUNDS[key];
              expect(h).toBeGreaterThanOrEqual(lo);
              expect(h).toBeLessThanOrEqual(hi);
            }
    expect(STYLE_HEIGHT.skeleton).toBe(1.1);
  });

  it('heightOf and roofOf read buildings, Stratablock stages and zone bodies; elevOffset is 0', () => {
    const w = new World(3, 'Heights', undefined, LEGACY_REGION);
    const spire = w.addBuilding('spire', 10, 10)!;
    expect(heightOf(w, 10, 10)).toBe(BUILDINGS.spire.height);
    expect(roofOf(w, 11, 11)).toBe(BUILDINGS.spire.roof);
    void spire;
    const stack = w.addBuilding('stack', 20, 20)!;
    w.setStage(stack, 2, 0);
    expect(heightOf(w, 20, 20)).toBe(177);
    expect(roofOf(w, 20, 20)).toBe(160);
    w.setZone(30, 30, ZoneType.Residential);
    expect(heightOf(w, 30, 30)).toBe(8);
    w.setLevel(30, 30, 3);
    const t = w.tileAt(30, 30)!;
    expect(heightOf(w, 30, 30)).toBe(CLASSIC_TOPS[classicId(t.zone, 3, t.variant, t.wealth)]);
    expect(heightOf(w, 40, 40)).toBe(0);
    expect(elevOffset(w, 30, 30)).toBe(0);
  });
});
