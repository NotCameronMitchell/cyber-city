// ─────────────────────────────────────────────────────────────────────────────
// Inspect panel additions (docs/STORY.md §8.8), driven by game.inspectActions:
//
//   Precinct     Crackdown · 2,000 CR (52 px), disabled with its reason. The
//                first press shows the zone on the map and arms a confirm.
//   Stratablock  Raise to Hab Core · 16,000 CR · 90 d, disabled with its reason;
//                the Crown stage opens the crown picker (4 rows of 56 px with
//                an effect summary and favor chips); while it is open the
//                sheet grows and hides its stat rows (onMode).
//   Spaceport    Launch rights · Choose (EXPANSION §5.3): opens the ex.rights
//                card on demand (no deck slot), disabled with its reason.
//   Skyway deck  Demolish segment · 5 CR (EXPANSION §7.4): the sheet a tap on
//                the deck opens (Selection.sky); removes that one segment.
//
// The turf, stage, ribbon and skybridge rows themselves come from
// game.getTileInfo, so the generic inspect rows already show them.
// ─────────────────────────────────────────────────────────────────────────────

import type { CrownId, InspectAction } from '../../game/story/types';
import type { Selection } from '../../game/types';
import { highlight } from '../../render/highlight';
import type { UIContext } from '../context';
import { esc, h, replayClass, setHidden } from '../dom';
import { MINUS } from '../format';
import { icon } from '../icons';
import { pressGuard } from './gesture';
import { factionColor, factionSigil } from './sigils';

const CONFIRM_MS = 6000;

export class InspectStory {
  readonly el: HTMLElement;
  private sel: Selection | null = null;
  private actions: InspectAction[] = [];
  private mode: 'idle' | 'confirm' | 'crowns' = 'idle';
  private key = '';
  private timer = 0;
  private readonly press: { readonly down: boolean };
  /** Mode changes (the inspect sheet makes room for the crown picker). */
  onMode: ((mode: 'idle' | 'confirm' | 'crowns') => void) | null = null;

  constructor(private readonly ctx: UIContext) {
    this.el = h('div', { class: 'cc-insp-story', hidden: true });
    this.el.addEventListener('click', this.onClick);
    this.press = pressGuard(this.el, () => this.refresh());
  }

  /** New selection: reset modes. */
  select(sel: Selection | null): void {
    this.sel = sel;
    this.setMode('idle');
    this.refresh();
  }

  refresh(): void {
    const sel = this.sel;
    const acts = sel ? this.ctx.game.inspectActions(sel.x, sel.y, !!sel.sky) : [];
    this.actions = acts;
    if (!acts.length && this.mode !== 'idle') this.setMode('idle');
    const key = `${this.mode}|${JSON.stringify(acts)}`;
    if (key === this.key) return;
    // A daily tick (build days, costs) must not swap a button out under a finger; the release re-runs this.
    if (this.press.down && this.key !== '') return;
    this.key = key;
    setHidden(this.el, acts.length === 0);
    let s = '';
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (a.id === 'crown' && this.mode === 'crowns' && a.crowns) {
        s += `<div class="cc-crowns" role="list"><div class="cc-crowns-head">Pick a crown · ${esc(a.label.replace(/^Raise to Crown · /, ''))}</div>`;
        for (const c of a.crowns) {
          const chips = c.favor
            .map((f) => `<span class="cc-hc is-fav ${f.v > 0 ? 'is-up' : 'is-down'}" style="--fc:${factionColor(f.f)}">${factionSigil(f.f, 14, 'cc-hc-sig')}<b>${f.v > 0 ? '+' : MINUS}${Math.abs(f.v)}</b></span>`)
            .join('');
          s +=
            `<button class="cc-crown${c.enabled ? '' : ' is-off'}" type="button" role="listitem" data-crown="${c.id}" data-i="${i}"${c.enabled ? '' : ` aria-disabled="true" data-reason="${esc(c.reason ?? 'Not available')}"`}>` +
            `<span class="cc-crown-main"><b>${esc(c.name)}</b><span>${esc(c.enabled ? c.summary : c.reason ?? c.summary)}</span></span><span class="cc-crown-chips">${chips}</span></button>`;
        }
        s += `<button class="cc-btn is-ghost cc-crowns-cancel" type="button" data-act="cancel">${icon('back')}<span>Not yet</span></button></div>`;
        continue;
      }
      if (a.id === 'crackdown' && this.mode === 'confirm') {
        s +=
          `<div class="cc-insp-confirm"><span class="cc-insp-confirm-text">${icon('warn')}<span>Send the wasps into the marked zone?</span></span>` +
          `<span class="cc-insp-confirm-btns"><button class="cc-btn is-ghost" type="button" data-act="cancel">Hold off</button>` +
          `<button class="cc-btn is-danger cc-story-act" type="button" data-act="go" data-i="${i}">${icon('shield')}<span>Crackdown</span></button></span></div>`;
        continue;
      }
      const ico = a.id === 'crackdown' ? 'shield' : a.id === 'rights' ? 'key' : a.id === 'skyway' ? 'trash' : 'stack';
      const cls = a.id === 'crackdown' ? ' is-crackdown' : a.id === 'rights' ? ' is-rights' : a.id === 'skyway' ? ' is-skyway' : '';
      s +=
        `<button class="cc-story-act${a.enabled ? '' : ' is-off'}${cls}" type="button" data-act="${a.id}" data-i="${i}"${a.enabled ? '' : ` aria-disabled="true"`}>` +
        `<span class="cc-story-act-ico">${icon(a.enabled ? ico : 'lock')}</span>` +
        `<span class="cc-story-act-main"><span class="cc-story-act-label">${esc(a.label)}</span>${a.reason ? `<span class="cc-story-act-reason">${esc(a.reason)}</span>` : ''}</span>` +
        `</button>`;
    }
    this.el.innerHTML = s;
  }

  private setMode(m: 'idle' | 'confirm' | 'crowns'): void {
    const changed = m !== this.mode;
    this.mode = m;
    if (changed) this.onMode?.(m);
    window.clearTimeout(this.timer);
    if (m !== 'confirm') highlight.zone = null;
    if (m === 'confirm') this.timer = window.setTimeout(() => this.setMode('idle'), CONFIRM_MS);
    this.key = '';
  }

  /** Called when the inspect sheet closes. */
  reset(): void {
    this.sel = null;
    this.setMode('idle');
  }

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('button');
    if (!btn) return;
    const { game } = this.ctx;
    const a = this.actions[Number(btn.dataset.i)];
    const act = btn.dataset.act;
    if (act === 'cancel') {
      this.setMode('idle');
      this.refresh();
      return;
    }
    if (btn.getAttribute('aria-disabled') === 'true') {
      replayClass(btn, 'is-shake');
      const reason = btn.dataset.reason ?? a?.reason;
      if (reason) game.toast(reason, 'info');
      this.ctx.sfx('error');
      return;
    }
    const crown = btn.dataset.crown as CrownId | undefined;
    if (crown && a) {
      const r = game.raiseStage(a.buildingId, crown);
      if (r.ok) game.toast('Crown under way. The skyline steps up.', 'good');
      this.setMode('idle');
      this.refresh();
      return;
    }
    if (!a) return;
    if (act === 'crackdown') {
      const b = game.world.buildings.get(a.buildingId);
      if (b) highlight.zone = { x: b.x + b.size / 2, y: b.y + b.size / 2, r: a.radius ?? 13, color: [61, 123, 255] };
      this.setMode('confirm');
      highlight.zone = b ? { x: b.x + b.size / 2, y: b.y + b.size / 2, r: a.radius ?? 13, color: [61, 123, 255] } : null;
      this.refresh();
    } else if (act === 'go') {
      this.setMode('idle');
      game.crackdown(a.buildingId);
      this.refresh();
    } else if (act === 'raise') {
      const r = game.raiseStage(a.buildingId);
      if (r.ok) game.toast('Stage under way. Scaffolding goes up.', 'good');
      this.refresh();
    } else if (act === 'crown') {
      this.setMode('crowns');
      this.refresh();
    } else if (act === 'rights') {
      // Opens ex.rights through director.openOnDemand: it blocks like any card, the sheet stays behind it.
      game.openLaunchRights(a.buildingId);
      this.refresh();
    } else if (act === 'skyway' && a.x !== undefined && a.y !== undefined) {
      const r = game.demolishSkySegment(a.x, a.y);
      if (r.ok) game.toast('Skyway segment removed', 'info');
      this.refresh();
    }
  };
}
