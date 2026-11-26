// ─────────────────────────────────────────────────────────────────────────────
// Keepsakes (docs/MEGACITY.md §9.6): the goal drawer's "Story so far" lists
// every mark the city's choices have left (game.story.visual.marks), each with
// its plaque line and a Show button (44 px) that closes the drawer, eases the
// camera to the mark and rings it for a moment. Nothing opens by itself; the
// list only follows the derived marks (rebuilt when their version changes).
// ─────────────────────────────────────────────────────────────────────────────

import { markTitle } from '../../game/marks';
import type { Mark } from '../../game/story/types';
import { tileCenterWorld } from '../../render/camera';
import { highlight } from '../../render/highlight';
import type { UIContext } from '../context';
import { esc, h, setHidden } from '../dom';

/** Seconds the camera takes to reach a mark, and the ring stays up after. */
const SHOW_SEC = 0.6;
const RING_MS = 3500;
/** The zoom a Show lands on: close enough to read the decal, never further out than the player already is. */
const SHOW_ZOOM = { min: 0.9, max: 1.6 } as const;
const RING_RGB: [number, number, number] = [255, 214, 120];

let styled = false;
/** The list's styles, beside the drawer's own (story.css is shared; these rows are only Keepsakes'). */
function injectStyle(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
.cc-gd-keep { display: flex; flex-direction: column; gap: 6px; }
.cc-keep-lead { margin: 0; font-size: 12px; line-height: 17px; color: var(--cc-ink-2); }
.cc-keep { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cc-keep-row { display: flex; align-items: center; gap: 10px; min-height: 48px; }
.cc-keep-dot { flex: none; width: 8px; height: 8px; margin-left: 10px; background: var(--cc-amber); transform: rotate(45deg); }
.cc-keep-main { flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 13px; line-height: 18px; color: var(--cc-ink-2); }
.cc-keep-title { font-size: 13px; letter-spacing: 0.04em; color: var(--cc-ink); overflow-wrap: anywhere; }
.cc-keep-plaque { font-style: italic; color: #f2d89a; overflow-wrap: anywhere; }
.cc-keep-show { flex: none; min-width: 64px; min-height: 44px; padding: 0 12px; font-size: 13px; }
`;
  document.head.append(s);
}

export class Keepsakes {
  readonly el = h('section', { class: 'cc-gd-keep', hidden: true });
  private ctx: UIContext | null = null;
  private key = '';
  private shown: Mark[] = [];
  private ringTimer = 0;
  /** Called after Show (the goal drawer closes so the map is in view). */
  onShow: (() => void) | null = null;

  constructor() {
    injectStyle();
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mark]');
      if (!b) return;
      const m = this.shown[Number(b.dataset.mark)];
      if (m) this.show(m);
    });
  }

  /** The game and camera the list reads and pans (StoryUI binds it once). */
  bind(ctx: UIContext): void {
    this.ctx = ctx;
  }

  /** Rebuild the rows when the derived marks changed (cheap otherwise). */
  sync(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const marks = ctx.game.story.visual.marks;
    const list = marks.list.filter((m) => !!m.plaque);
    const key = `${marks.version}|${list.length}|${ctx.game.world.seed}`;
    if (key === this.key) return;
    this.key = key;
    this.shown = list;
    if (!list.length) {
      this.el.innerHTML = '';
      setHidden(this.el, true);
      return;
    }
    let s = '<div class="cc-gd-k">Keepsakes</div><p class="cc-keep-lead">What the city remembers of your choices.</p><ol class="cc-keep">';
    list.forEach((m, i) => {
      const title = markTitle(m);
      s +=
        `<li class="cc-keep-row"><span class="cc-keep-dot" aria-hidden="true"></span>` +
        `<span class="cc-keep-main"><b class="cc-keep-title">${esc(title)}</b><span class="cc-keep-plaque">${esc(m.plaque)}</span></span>` +
        `<button class="cc-btn cc-keep-show" type="button" data-mark="${i}" aria-label="Show ${esc(title)} on the map">Show</button></li>`;
    });
    s += '</ol>';
    this.el.innerHTML = s;
    setHidden(this.el, false);
  }

  /** Close the drawer, ease the camera to the mark and ring it. */
  show(m: Mark): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.onShow?.();
    const cam = ctx.camera;
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    const c = tileCenterWorld(cx - 0.5, cy - 0.5);
    const zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, Math.max(SHOW_ZOOM.min, Math.min(SHOW_ZOOM.max, cam.zoom))));
    // The mark's centre at the centre of the area the UI leaves uncovered (camera insets, as centerOnTile).
    const ins = cam.insets;
    cam.easeTo(c.x - (ins.left - ins.right) / 2 / zoom, c.y - (ins.top - ins.bottom) / 2 / zoom, zoom, SHOW_SEC);
    const ring = { x: cx, y: cy, r: Math.max(2.5, Math.max(m.w, m.h) * 0.75), color: RING_RGB };
    highlight.zone = ring;
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = window.setTimeout(() => {
      if (highlight.zone === ring) highlight.zone = null;
      this.ringTimer = 0;
    }, RING_MS);
  }
}
