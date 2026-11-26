// ─────────────────────────────────────────────────────────────────────────────
// Hint chips under story choices and action buttons (docs/STORY.md §8.2):
// faction sigil with ▲/▼ pips, exact credits, an eye for Trace, a clock for
// timed modifiers, a key for unlocks, LOG for Silt Logs, a plug for buildings
// offline, a home for emptied blocks, a star for Charter Night, a letter for
// a follow-up card, "?" inside an `if`.
// ─────────────────────────────────────────────────────────────────────────────

import { FACTION_LABELS } from '../../game/config';
import type { Hint } from '../../game/story/types';
import { groupInt, MINUS } from '../format';
import { icon } from '../icons';
import { factionSigil } from './sigils';

function chip(cls: string, inner: string, title: string, style = ''): string {
  return `<span class="cc-hc ${cls}"${style ? ` style="${style}"` : ''} title="${title}">${inner}</span>`;
}

/** A land grant's count (MEGACITY §8.2, §8.4: the Hint union's `{ k: 'grant', n }`, emitted by story/effects.ts). */
function grants(n: number): number {
  return Math.max(1, n | 0);
}

/** HTML for one hint chip. */
export function hintChip(h: Hint): string {
  switch (h.k) {
    case 'favor': {
      const arrow = h.dir > 0 ? '▲' : '▼';
      const name = FACTION_LABELS[h.f].short;
      return chip(
        `is-fav ${h.dir > 0 ? 'is-up' : 'is-down'}`,
        `${factionSigil(h.f, 14, 'cc-hc-sig')}<b>${arrow.repeat(h.pips)}</b>`,
        `${name} ${h.dir > 0 ? 'likes' : 'dislikes'} this`,
        `--fc:${FACTION_LABELS[h.f].color}`,
      );
    }
    case 'cr': {
      const v = Math.round(h.v);
      const txt = `${v > 0 ? '+' : v < 0 ? MINUS : ''}${groupInt(Math.abs(v))} CR`;
      return chip(`is-cr ${v < 0 ? 'is-cost' : 'is-gain'}`, txt, 'Credits');
    }
    case 'trace': {
      const v = Math.round(h.v);
      return chip(`is-trace ${v > 0 ? 'is-up' : 'is-down'}`, `${icon('eye')}<b>${v > 0 ? '+' : MINUS}${Math.abs(v)}</b>`, 'Trace');
    }
    case 'timed':
      return chip('is-timed', `${icon('clock')}<b>${h.months} mo</b>`, 'Lasts a while');
    case 'unlock':
      return chip('is-unlock', icon('key'), 'Unlocks something');
    case 'log':
      return chip('is-log', '<b>LOG</b>', 'A Silt Log');
    case 'maybe':
      return chip('is-maybe', '<b>?</b>', 'Depends on the city');
    case 'offline':
      return chip('is-misc', icon('plug'), 'Knocks buildings offline');
    case 'abandon':
      return chip('is-misc', icon('res'), 'Empties some blocks');
    case 'charter':
      return chip('is-misc', icon('star'), 'Opens Charter Night');
    case 'follow':
      return chip('is-misc', icon('comms'), 'Leads to a follow-up');
    case 'grant': {
      // The ✦ chip: one land grant, or how many.
      const n = grants(h.n);
      return chip('is-grant', `<b>✦${n > 1 ? ` ${n}` : ''}</b>`, n > 1 ? `${n} land grants` : 'A land grant');
    }
  }
}

/** HTML for a row of hint chips (empty string when there are none). */
export function hintRow(hints: readonly Hint[] | undefined): string {
  if (!hints || !hints.length) return '';
  let s = '';
  for (const h of hints) s += hintChip(h);
  return s;
}

/**
 * Plain-language summary of what a choice does, always shown under its label
 * (clarity pass, docs/PACING.md): "Basalt ++ · Nacre − · Trace +3 · −1,200 CR".
 * Faction names carry their colour; signs repeat by strength (1–3). Returns
 * HTML ('' when the choice changes nothing visible).
 */
export function hintSummary(hints: readonly Hint[] | undefined): string {
  if (!hints || !hints.length) return '';
  const parts: string[] = [];
  for (const h of hints) {
    switch (h.k) {
      case 'favor': {
        const l = FACTION_LABELS[h.f];
        const sign = (h.dir > 0 ? '+' : MINUS).repeat(h.pips);
        parts.push(
          `<span class="cc-sum-fav ${h.dir > 0 ? 'is-up' : 'is-down'}" style="--fc:${l.color}" title="${l.short} ${h.dir > 0 ? 'will like this' : 'will dislike this'}"><b>${l.short}</b> ${sign}</span>`,
        );
        break;
      }
      case 'cr': {
        const v = Math.round(h.v);
        parts.push(`<span class="cc-sum-cr ${v < 0 ? 'is-cost' : 'is-gain'}">${v > 0 ? '+' : v < 0 ? MINUS : ''}${groupInt(Math.abs(v))} CR</span>`);
        break;
      }
      case 'trace': {
        const v = Math.round(h.v);
        parts.push(`<span class="cc-sum-trace ${v > 0 ? 'is-up' : 'is-down'}" title="Trace: how close anyone is to finding you">Trace ${v > 0 ? '+' : MINUS}${Math.abs(v)}</span>`);
        break;
      }
      case 'timed':
        parts.push(`<span class="cc-sum-misc">lasts ${h.months} mo</span>`);
        break;
      case 'unlock':
        parts.push('<span class="cc-sum-misc">unlocks something</span>');
        break;
      case 'log':
        parts.push('<span class="cc-sum-misc">a Silt Log</span>');
        break;
      case 'maybe':
        parts.push('<span class="cc-sum-misc">depends on the city</span>');
        break;
      case 'offline':
        parts.push('<span class="cc-sum-misc is-harm">buildings go offline</span>');
        break;
      case 'abandon':
        parts.push('<span class="cc-sum-misc is-harm">empties blocks</span>');
        break;
      case 'charter':
        parts.push('<span class="cc-sum-misc">opens Charter Night</span>');
        break;
      case 'follow':
        parts.push('<span class="cc-sum-misc">leads to a follow-up</span>');
        break;
      case 'grant': {
        const n = grants(h.n);
        parts.push(`<span class="cc-sum-misc is-grant">${n > 1 ? `${n} land grants` : 'a land grant'}</span>`);
        break;
      }
    }
  }
  return parts.join('<span class="cc-sum-sep" aria-hidden="true"> · </span>');
}
