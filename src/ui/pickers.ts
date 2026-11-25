// ─────────────────────────────────────────────────────────────────────────────
// The faction pickers (docs/MEGACITY.md §6.2 Pickers):
//
//   Spire sponsor step  in the Corp Spire's confirm pill, above ✓ / ✕: a 44 px
//                       segmented control (Basalt · Nacre · Independent) and a
//                       "‹ look ›" chip that cycles the ghost through that
//                       sponsor's looks; ✓ places it with the sponsor and look
//   crown looks         the names and tiny thumbnails of each crown's three
//                       looks (the inspect sheet's crown picker draws the grid)
//
// The ghost on the map follows the choice through render/overlay.ts' ghostPick.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from '../game/config';
import type { Game } from '../game/game';
import type { CrownId } from '../game/story/types';
import type { Building } from '../game/types';
import { drawServiceBuilding } from '../render/buildings';
import { ghostPick } from '../render/overlay';
import { h, setAttr, setClass, setHidden, setText } from './dom';

export type Sponsor = 'basalt' | 'nacre' | 'none';

/** Corp Spire designs by sponsor (§6.2; look 0 is today's art). Game holds the same table for inspect. */
export const SPIRE_LOOK_NAMES: Record<Sponsor, readonly string[]> = {
  nacre: ['Facet', 'Spiral', 'Pearl Drop', 'Halo Atrium'],
  basalt: ['Hex Column', 'Crucible', 'Gantry Spine'],
  none: ['Needle', 'Twin Blade', 'Lattice'],
};

/** Crown designs (§6.2; look 0 of the four old crowns is today's, "Classic"). */
export const CROWN_LOOK_NAMES: Record<CrownId, readonly string[]> = {
  foundry: ['Classic', 'Crucible', 'Hex Column'],
  glare: ['Classic', 'Pearl Drop', 'Halo Atrium'],
  nest: ['Classic', 'Antenna Forest', 'Sail Canopy'],
  commons: ['Classic', 'Stepped Tower', 'Open Belfry'],
  salvage: ['Hull Stack', 'Net Loft', 'Crane Hab'],
  lamp: ['Lamp Chapel', 'Coil Belfry', 'Choir Ring'],
};

const SPONSORS: { id: Sponsor; label: string; sum: string }[] = [
  { id: 'basalt', label: 'Basalt', sum: 'Basalt +6 · 40% Fab jobs' },
  { id: 'nacre', label: 'Nacre', sum: 'Nacre +6 · prestige r16' },
  { id: 'none', label: 'Independent', sum: 'Board +3 · prestige r14' },
];

/** The look after `look` for a sponsor (the "‹ look ›" chip cycles). */
export function nextLook(sponsor: Sponsor, look: number, step = 1): number {
  const n = SPIRE_LOOK_NAMES[sponsor].length;
  return (((look + step) % n) + n) % n;
}

/**
 * The Corp Spire's sponsor row (§6.2): shown in the confirm pill while a Spire waits for ✓. The choice lives in
 * overlay's ghostPick, so the map's ghost, the pill's ✓ and Enter (input) all read the same one.
 */
export class SpirePicker {
  readonly el: HTMLElement;
  private readonly seg: HTMLElement;
  private readonly look: HTMLButtonElement;
  private readonly lookName: HTMLElement;
  private readonly sum: HTMLElement;
  private shown = false;
  /** The pill re-renders when the row appears or changes. */
  onChange: (() => void) | null = null;

  constructor() {
    this.seg = h('div', { class: 'cc-seg cc-spire-seg', role: 'radiogroup', 'aria-label': 'Sponsor' });
    for (const s of SPONSORS) this.seg.append(h('button', { class: 'cc-seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-sponsor': s.id, text: s.label }));
    this.lookName = h('span');
    this.look = h('button', { class: 'cc-spire-look', type: 'button', 'data-act': 'look', 'aria-label': 'Next look' }, h('b', { text: '‹' }), this.lookName, h('b', { text: '›' }));
    this.sum = h('span', { class: 'cc-spire-sum' });
    this.el = h('div', { class: 'cc-spire-pick' }, this.seg, this.look, this.sum);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sp = t.closest<HTMLElement>('[data-sponsor]');
      if (sp) {
        ghostPick.sponsor = sp.dataset.sponsor as Sponsor;
        ghostPick.look = 0;
        this.render();
        return;
      }
      if (t.closest('[data-act="look"]')) {
        const s = (ghostPick.sponsor ?? 'nacre') as Sponsor;
        ghostPick.look = nextLook(s, ghostPick.look ?? 0) as 0 | 1 | 2 | 3;
        this.render();
      }
    });
  }

  /** Per frame (cheap): show the row while a Corp Spire waits for ✓; keep the ghost pick for the Spire tool only. */
  sync(game: Game): void {
    const spire = game.tool === 'spire';
    if (spire && ghostPick.sponsor === undefined) {
      ghostPick.sponsor = 'nacre';
      ghostPick.look = 0;
    } else if (!spire && ghostPick.sponsor !== undefined && ghostPick.crown === undefined) {
      delete ghostPick.sponsor;
      delete ghostPick.look;
    }
    const show = spire && game.pendingConfirm?.tool === 'spire';
    if (show === this.shown) return;
    this.shown = show;
    setHidden(this.el, !show);
    if (show) this.render();
    this.onChange?.();
  }

  get visible(): boolean {
    return this.shown;
  }

  /** The placement options ✓ uses. */
  opts(): { sponsor: Sponsor; look: 0 | 1 | 2 | 3 } {
    return { sponsor: (ghostPick.sponsor ?? 'nacre') as Sponsor, look: (ghostPick.look ?? 0) as 0 | 1 | 2 | 3 };
  }

  private render(): void {
    const s = (ghostPick.sponsor ?? 'nacre') as Sponsor;
    for (const b of this.seg.querySelectorAll<HTMLButtonElement>('[data-sponsor]')) {
      const on = b.dataset.sponsor === s;
      setClass(b, 'is-on', on);
      setAttr(b, 'aria-checked', on ? 'true' : 'false');
    }
    const look = ghostPick.look ?? 0;
    setText(this.lookName, SPIRE_LOOK_NAMES[s][look] ?? SPIRE_LOOK_NAMES[s][0]);
    setAttr(this.look, 'aria-label', `Look: ${SPIRE_LOOK_NAMES[s][look]}. Next look`);
    setText(this.sum, SPONSORS.find((x) => x.id === s)?.sum ?? '');
    this.onChange?.();
  }
}

// ── Look thumbnails (the crown picker's look chips) ─────────────────────────

const thumbs = new Map<string, HTMLCanvasElement>();

/** A tiny night thumbnail of a complete Stratablock with `crown` at `look` (cached; null without a DOM). */
export function crownThumb(crown: CrownId, look: number, w = 44, hgt = 56): HTMLCanvasElement | null {
  const key = `${crown}:${look}:${w}x${hgt}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  const g = c.getContext('2d');
  if (!g) return null;
  const size = BUILDINGS.stack.size;
  // Fit a 4×4 footprint (256 world px wide) and its crown (≈ 420 px tall) into the thumbnail.
  const s = Math.min(c.width / (size * 64 + 16), c.height / 440);
  const b: Building = { id: -1, type: 'stack', x: 0, y: 0, size, builtTick: 0, offline: 0, powered: true, stage: 3, buildDays: 0, crown, look: look as 0 | 1 | 2 };
  try {
    g.setTransform(s, 0, 0, s, c.width / 2, c.height - size * 32 * s - 2);
    drawServiceBuilding(g, 0, 0, b, { time: 0, night: 1, zoom: s, quality: 'high' });
  } catch {
    return null;
  }
  thumbs.set(key, c);
  return c;
}
