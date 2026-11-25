// The New City sheet's Region control (docs/MEGACITY.md §7.9, §3.11; §11.5's WP-5 row): the default by device class,
// the Recommended tag on that default, the phone warning only for 5×5 on a handheld device, the choice remembered per
// device, newCity getting the region, and the waiting first-launch map kept only for the same region.

import { afterEach, describe, expect, it } from 'vitest';
import { defaultRegion, deviceClass, resetDeviceProfile, type DeviceProfile } from '../src/game/device';
import { Game } from '../src/game/game';
import { World } from '../src/game/world';
import {
  REGION_COPY,
  REGION_FOOTNOTE,
  REGION_KEY,
  REGION_TAG,
  REGION_WARNING,
  citySummary,
  foundPlan,
  initialRegion,
  readRegion,
  regionWarning,
} from '../src/ui/start/startModel';

const PHONE: DeviceProfile = { finePointer: false, mobileOS: true, shortSide: 390, cores: 6, memoryGB: 4, benchFactor: null };
const LAPTOP: DeviceProfile = { finePointer: true, mobileOS: false, shortSide: 900, cores: 8, memoryGB: 8, benchFactor: 1.1 };
const WEAK_PC: DeviceProfile = { finePointer: true, mobileOS: false, shortSide: 768, cores: 2, memoryGB: 2, benchFactor: null };

afterEach(() => resetDeviceProfile(null));

describe('Region control (§7.9)', () => {
  it('the default comes from the device: 3×3 on a phone or a weak PC, 5×5 on a capable PC; the tag follows it', () => {
    resetDeviceProfile(PHONE);
    expect(defaultRegion()).toBe(3);
    expect(deviceClass()).toBe('handheld');
    resetDeviceProfile(LAPTOP);
    expect(defaultRegion()).toBe(5);
    expect(deviceClass()).toBe('pc');
    resetDeviceProfile(WEAK_PC);
    expect(defaultRegion()).toBe(3);
    expect(REGION_TAG).toBe('Recommended');
  });

  it('copy: the options, their short labels below 380 px, the lines and the footnote', () => {
    expect(REGION_COPY[3].label).toBe('3×3 · 9 districts');
    expect(REGION_COPY[5].label).toBe('5×5 · 25 districts');
    expect(REGION_COPY[3].short).toBe('3×3 · 9');
    expect(REGION_COPY[5].short).toBe('5×5 · 25');
    expect(REGION_COPY[3].line).toBe('Nine districts, a city of 4–5 million. Best on phones.');
    expect(REGION_COPY[5].line).toBe('25 districts, a city of up to 12 million. Best on a computer.');
    expect(REGION_FOOTNOTE).toBe('Both have the same story. A 3×3 city can grow to 5×5 later, never back.');
  });

  it('the phone warning shows only for 5×5 on a handheld device', () => {
    expect(regionWarning(5, 'handheld')).toBe(REGION_WARNING);
    expect(regionWarning(3, 'handheld')).toBeNull();
    expect(regionWarning(5, 'pc')).toBeNull();
    expect(REGION_WARNING).toMatch(/^25 districts are a lot for a phone: it will run in lower detail/);
  });

  it('the choice is remembered for the next New City on this device and wins over the default', () => {
    expect(REGION_KEY).toBe('cybercity.ui.region.v1');
    expect(readRegion('5')).toBe(5);
    expect(readRegion('3')).toBe(3);
    expect(readRegion(null)).toBeNull();
    expect(readRegion('4')).toBeNull();
    expect(initialRegion(null, 3)).toBe(3);
    expect(initialRegion(5, 3)).toBe(5);
    expect(initialRegion(3, 5)).toBe(3);
  });

  it('Found city passes the region to newCity; the waiting map is kept only for the same region (same seed either way)', () => {
    expect(foundPlan({ keepMap: true, worldSeed: 77, worldRegion: 3, region: 3, fresh: 5 })).toEqual({ seed: 77, region: 3, kept: true });
    expect(foundPlan({ keepMap: true, worldSeed: 77, worldRegion: 3, region: 5, fresh: 5 })).toEqual({ seed: 77, region: 5, kept: false });
    expect(foundPlan({ keepMap: false, worldSeed: 77, worldRegion: 3, region: 5, fresh: 5 })).toEqual({ seed: 5, region: 5, kept: false });
    const g = new Game();
    const plan = foundPlan({ keepMap: true, worldSeed: g.world.seed, worldRegion: g.world.region, region: 5, fresh: 1 });
    g.newCity('Region Bay', plan.seed, plan.region);
    expect(g.world.region).toBe(5);
    expect(g.world.N).toBe(320);
    // The same seed at either size gives the same start map (§3.1).
    const a = World.generate(plan.seed, 'A', undefined, 3);
    const b = World.generate(plan.seed, 'B', undefined, 5);
    const ra = a.districts.owned[0];
    const rb = b.districts.owned[0];
    const ox = (s: number, R: number) => (s % R) * 64;
    const oy = (s: number, R: number) => Math.floor(s / R) * 64;
    for (let y = 0; y < 64; y += 7)
      for (let x = 0; x < 64; x += 7) expect(a.tiles[(oy(ra, 3) + y) * a.N + ox(ra, 3) + x].terrain).toBe(b.tiles[(oy(rb, 5) + y) * b.N + ox(rb, 5) + x].terrain);
  });

  it('the Continue card shows the size ("· 5×5")', () => {
    const s = citySummary({ cityName: 'Neon Bay', date: 'MAR 2093', population: 2_410_000, story: null, region: 5 });
    expect(s.meta).toBe('MAR 2093 · 2,410,000 residents · 5×5');
    expect(citySummary({ cityName: 'Old', date: 'JAN 2091', population: 10, story: null }).meta).toBe('JAN 2091 · 10 residents');
  });
});
