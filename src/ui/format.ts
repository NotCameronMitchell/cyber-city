// ─────────────────────────────────────────────────────────────────────────────
// Number / date formatting for the HUD and panels. Hand-rolled (no Intl calls
// in the hot path) so a 5 Hz HUD refresh stays allocation-light.
// ─────────────────────────────────────────────────────────────────────────────

import { CURRENCY } from '../game/config';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, START_YEAR } from '../game/types';

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Real minus sign: reads better than a hyphen in tabular figures. */
export const MINUS = '−';

/** 25000 → "25,000" (rounded; negative numbers keep a real minus sign). */
export function groupInt(n: number): string {
  const v = Math.round(n);
  const neg = v < 0;
  let s = String(Math.abs(v));
  if (s.length > 3) {
    let out = '';
    let i = s.length % 3 || 3;
    out = s.slice(0, i);
    for (; i < s.length; i += 3) out += ',' + s.slice(i, i + 3);
    s = out;
  }
  return neg ? MINUS + s : s;
}

/** Compact figure: 999 → "999", 1234 → "1.2k", 12400 → "12.4k", 124000 → "124k", 1.24e6 → "1.24M". */
export function abbr(n: number): string {
  const neg = n < 0;
  const a = Math.abs(n);
  let s: string;
  if (a < 1000) s = String(Math.round(a));
  else if (a < 100_000) s = trimZero((a / 1000).toFixed(1)) + 'k';
  else if (a < 1_000_000) s = Math.round(a / 1000) + 'k';
  else if (a < 100_000_000) s = trimZero((a / 1_000_000).toFixed(2)) + 'M';
  else s = Math.round(a / 1_000_000) + 'M';
  return neg ? MINUS + s : s;
}

function trimZero(s: string): string {
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** "1,500 CR" */
export function credits(n: number): string {
  return `${groupInt(n)} ${CURRENCY}`;
}

/** "+1,240" / "−300" / "0" */
export function signed(n: number, compact = false): string {
  const v = Math.round(n);
  if (v === 0) return '0';
  const body = compact ? abbr(Math.abs(v)) : groupInt(Math.abs(v));
  return (v > 0 ? '+' : MINUS) + body;
}

/** Calendar label for an arbitrary sim tick: "MAR 2091". */
export function tickDate(tick: number): string {
  const month = Math.floor(tick / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
  const year = START_YEAR + Math.floor(tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  return `${MONTHS[month]} ${year}`;
}

/** Day-precise label: "14 MAR 2091". */
export function tickDay(tick: number): string {
  return `${String((tick % DAYS_PER_MONTH) + 1).padStart(2, '0')} ${tickDate(tick)}`;
}

/** 0..1 → "42%". */
export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
