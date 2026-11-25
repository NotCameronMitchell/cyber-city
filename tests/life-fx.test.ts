// MEGACITY §6.4 / §11.5 WP-6: life and atmosphere — settings, caps, LOD, low quality and lower detail.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/game/game';
import { cityLifeOn, crowdsOn, weatherOf, weatherPatch, withLifeDefaults } from '../src/game/settings';
import type { Settings } from '../src/game/types';

describe('life settings (§7.6: unknown reads as default)', () => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  it('weather reads from the old rain toggle when missing', () => {
    expect(weatherOf({ ...base, rain: true })).toBe('full');
    expect(weatherOf({ ...base, rain: false })).toBe('off');
    expect(weatherOf({ ...base, rain: false, weather: 'light' })).toBe('light');
    expect(weatherOf({ ...base, weather: 'bogus' as never })).toBe('full');
  });
  it('crowds default to the quality; City life defaults on', () => {
    expect(crowdsOn({ ...base, quality: 'high' })).toBe(true);
    expect(crowdsOn({ ...base, quality: 'low' })).toBe(false);
    expect(crowdsOn({ ...base, quality: 'low', crowds: true })).toBe(true);
    expect(cityLifeOn(base)).toBe(true);
    expect(cityLifeOn({ ...base, cityLife: false })).toBe(false);
  });
  it('rain is still written for older builds', () => {
    expect(weatherPatch('off')).toEqual({ weather: 'off', rain: false });
    expect(weatherPatch('light')).toEqual({ weather: 'light', rain: true });
    expect(withLifeDefaults({ ...base, rain: false })).toMatchObject({ weather: 'off', rain: false });
    expect(withLifeDefaults({ ...base, weather: 'light', rain: false })).toMatchObject({ weather: 'light', rain: true });
    expect(DEFAULT_SETTINGS.weather).toBeUndefined();
  });
});
