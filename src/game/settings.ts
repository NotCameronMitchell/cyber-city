// ─────────────────────────────────────────────────────────────────────────────
// The life and atmosphere settings (docs/MEGACITY.md §6.4, §7.6), read through
// one helper so every reader applies the same "unknown reads as default" rule:
//
//   weather   'full' | 'light' | 'off'. Missing: from the old `rain` toggle
//             (true → 'full', false → 'off'). `rain` is still written
//             (weather !== 'off') so an older build reads the same choice.
//   crowds    missing → on at high quality, off at low.
//   cityLife  missing → on. Turning it off hides the happenings' visuals and
//             ticker lines only; their small gameplay terms still apply (§3.11).
// ─────────────────────────────────────────────────────────────────────────────

import type { Settings } from './types';

export type WeatherSetting = 'full' | 'light' | 'off';
export const WEATHER_SETTINGS: readonly WeatherSetting[] = ['full', 'light', 'off'];

/** The weather setting, with the old `rain` toggle as the fallback (missing or unknown reads as default). */
export function weatherOf(s: Partial<Settings>): WeatherSetting {
  const w = s.weather;
  if (w === 'full' || w === 'light' || w === 'off') return w;
  return s.rain === false ? 'off' : 'full';
}

/** Crowds on? Missing reads as on at high quality, off at low. */
export function crowdsOn(s: Partial<Settings>): boolean {
  return typeof s.crowds === 'boolean' ? s.crowds : s.quality !== 'low';
}

/** City life on? Missing reads as on. */
export function cityLifeOn(s: Partial<Settings>): boolean {
  return typeof s.cityLife === 'boolean' ? s.cityLife : true;
}

/**
 * The patch that sets the weather: `weather` plus the `rain` an older build reads (WP-5's Settings row passes this
 * to Game.updateSettings so both fields always agree).
 */
export function weatherPatch(w: WeatherSetting): Pick<Settings, 'weather' | 'rain'> {
  return { weather: w, rain: w !== 'off' };
}

/** Settings as loaded: the weather resolved from `rain` when missing, and `rain` re-derived from it. */
export function withLifeDefaults(s: Settings): Settings {
  const weather = weatherOf(s);
  return { ...s, weather, rain: weather !== 'off' };
}
