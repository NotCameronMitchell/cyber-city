// ─────────────────────────────────────────────────────────────────────────────
// Sigils for the DOM: the procedural marks from render/art/sigils.ts baked
// once per (mark, colour, size) into a data URL, plus small faction helpers
// shared by every story surface (names, colours, tier words and colours).
// ─────────────────────────────────────────────────────────────────────────────

import { FACTION_LABELS } from '../../game/config';
import type { CardView, FactionId, Tier } from '../../game/story/types';
import { FACTION_SIGIL, LURE_COLOR, MOTH_COLOR, SYSTEM_COLOR, drawSigil, type SigilKind } from '../../render/art/sigils';
import { esc } from '../dom';

export { FACTION_SIGIL, MOTH_COLOR, type SigilKind };

const urlCache = new Map<string, string>();

/** Data URL of a sigil drawn for `cssPx` CSS pixels (rendered at 3× for crisp phones). */
export function sigilURL(kind: SigilKind, color: string, cssPx: number): string {
  const key = `${kind}|${color}|${cssPx}`;
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const px = Math.max(16, Math.round(cssPx * 3));
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    if (g) {
      drawSigil(g, kind, px / 2, px / 2, px * 0.38, color, true);
      url = c.toDataURL('image/png');
    }
  } catch {
    url = '';
  }
  urlCache.set(key, url);
  return url;
}

/** `<img>` markup for a sigil (decorative: empty alt). */
export function sigilImg(kind: SigilKind, color: string, cssPx: number, cls = 'cc-sig'): string {
  const url = sigilURL(kind, color, cssPx);
  return url ? `<img class="${cls}" src="${url}" width="${cssPx}" height="${cssPx}" alt="" draggable="false">` : `<span class="${cls}"></span>`;
}

export function factionColor(f: FactionId | null | undefined): string {
  return f ? FACTION_LABELS[f].color : SYSTEM_COLOR;
}

export function factionShort(f: FactionId): string {
  return FACTION_LABELS[f].short;
}

export function factionName(f: FactionId): string {
  return FACTION_LABELS[f].name;
}

export function factionSigil(f: FactionId, cssPx: number, cls?: string): string {
  return sigilImg(FACTION_SIGIL[f], FACTION_LABELS[f].color, cssPx, cls);
}

/** Mark + colour for a card's speaker: the faction, else MOTH / LURE / the system. */
export function speakerMark(card: Pick<CardView, 'faction' | 'speakerName' | 'kind'>): { kind: SigilKind; color: string } {
  if (card.faction) return { kind: FACTION_SIGIL[card.faction], color: FACTION_LABELS[card.faction].color };
  const s = card.speakerName.toLowerCase();
  if (s.includes('lure')) return { kind: 'lure', color: LURE_COLOR };
  if (card.kind === 'system' || s.includes('system')) return { kind: 'system', color: SYSTEM_COLOR };
  return { kind: 'moth', color: MOTH_COLOR };
}

export const TIER_WORD: Record<Tier, string> = {
  hostile: 'Hostile',
  cold: 'Cold',
  neutral: 'Neutral',
  friendly: 'Friendly',
  allied: 'Allied',
};

export const TIER_COLOR: Record<Tier, string> = {
  hostile: '#ff3b5c',
  cold: '#6fa8ff',
  neutral: '#a6acd2',
  friendly: '#4dff9a',
  allied: '#ffd34d',
};

/** CSS background pattern per faction for the Balance of Power bar (patterns, not just colour). */
export function factionPattern(f: FactionId): string {
  const c = FACTION_LABELS[f].color;
  switch (f) {
    case 'board':
      return `repeating-linear-gradient(90deg, transparent 0 6px, rgba(0,0,0,.38) 6px 8px), ${c}`;
    case 'basalt':
      return `repeating-linear-gradient(0deg, transparent 0 3px, rgba(0,0,0,.4) 3px 5px), ${c}`;
    case 'nacre':
      return `radial-gradient(circle, rgba(255,255,255,.7) 0 1.3px, transparent 1.8px) 0 0 / 6px 6px, ${c}`;
    case 'undertow':
      return `repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,0,0,.5) 3px 6px), ${c}`;
    case 'kites':
      return `radial-gradient(circle, rgba(0,0,0,.55) 0 1.3px, transparent 1.7px) 0 0 / 5px 5px, ${c}`;
    default:
      return c;
  }
}

/** Escape helper re-export for composing small HTML strings. */
export { esc };
