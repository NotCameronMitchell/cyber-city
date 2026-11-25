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
import type { ActionPlan, Selection } from '../../game/types';
import { ghostPick } from '../../render/overlay';
import { CROWN_LOOK_NAMES, crownThumb } from '../pickers';
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
  /** The crown picker's choice (§6.2): the crown, its look, and the Stratablock it is for. */
  private pickCrown: CrownId | null = null;
  private pickLook = 0;
  private pickFor = -1;
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
    const acts = sel ? this.ctx.game.inspectActions(sel.x, sel.y, !!sel.sky, sel.link) : [];
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
        // MEGACITY §6.2 Pickers: a 2-column grid of crown cards; the picked crown shows its three looks (look 0 first),
        // the ghost on the map shows the chosen look, and Crown it raises it with that look.
        s += `<div class="cc-crowns" role="list"><div class="cc-crowns-head">Pick a crown · ${esc(a.label.replace(/^Raise to Crown · /, ''))}</div><div class="cc-crown-grid">`;
        for (const c of a.crowns) {
          const chips = c.favor
            .map((f) => `<span class="cc-hc is-fav ${f.v > 0 ? 'is-up' : 'is-down'}" style="--fc:${factionColor(f.f)}">${factionSigil(f.f, 14, 'cc-hc-sig')}<b>${f.v > 0 ? '+' : MINUS}${Math.abs(f.v)}</b></span>`)
            .join('');
          const on = this.pickCrown === c.id;
          s +=
            `<button class="cc-crown${c.enabled ? '' : ' is-off'}${on ? ' is-on' : ''}" type="button" role="listitem" aria-pressed="${on}" data-crown="${c.id}" data-i="${i}"${c.enabled ? '' : ` aria-disabled="true" data-reason="${esc(c.reason ?? 'Not available')}"`}>` +
            `<span class="cc-crown-main"><b>${esc(c.name)}</b><span>${esc(c.enabled ? c.summary : c.reason ?? c.summary)}</span></span><span class="cc-crown-chips">${chips}</span></button>`;
        }
        s += '</div>';
        if (this.pickCrown) {
          const names = CROWN_LOOK_NAMES[this.pickCrown];
          s += `<div class="cc-crown-looks" role="radiogroup" aria-label="Look">`;
          for (let k = 0; k < names.length; k++) {
            const on = this.pickLook === k;
            s += `<button class="cc-crown-look${on ? ' is-on' : ''}" type="button" role="radio" aria-checked="${on}" data-look="${k}"><span class="cc-look-thumb" data-thumb="${this.pickCrown}:${k}"></span><span>${esc(names[k])}</span></button>`;
          }
          s += '</div>';
        }
        s +=
          `<div class="cc-crowns-go"><button class="cc-btn is-ghost cc-crowns-cancel" type="button" data-act="cancel">${icon('back')}<span>Not yet</span></button>` +
          `<button class="cc-btn is-primary cc-crowns-ok" type="button" data-act="crown-go" data-i="${i}"${this.pickCrown ? '' : ' aria-disabled="true"'}>${icon('stack')}<span>Crown it</span></button></div></div>`;
        continue;
      }
      if (a.id === 'crackdown' && this.mode === 'confirm') {
        s +=
          `<div class="cc-insp-confirm"><span class="cc-insp-confirm-text">${icon('warn')}<span>Send the wasps into the marked zone?</span></span>` +
          `<span class="cc-insp-confirm-btns"><button class="cc-btn is-ghost" type="button" data-act="cancel">Hold off</button>` +
          `<button class="cc-btn is-danger cc-story-act" type="button" data-act="go" data-i="${i}">${icon('shield')}<span>Crackdown</span></button></span></div>`;
        continue;
      }
      const ico =
        a.id === 'crackdown' ? 'shield' : a.id === 'rights' ? 'key' : a.id === 'skyway' || a.id === 'bridgeRemove' ? 'trash' : a.id === 'map' ? 'map' : 'stack';
      const cls =
        a.id === 'crackdown' ? ' is-crackdown' : a.id === 'rights' ? ' is-rights' : a.id === 'skyway' || a.id === 'bridgeRemove' ? ' is-skyway' : a.id === 'map' ? ' is-map' : '';
      s +=
        `<button class="cc-story-act${a.enabled ? '' : ' is-off'}${cls}" type="button" data-act="${a.id}" data-i="${i}"${a.enabled ? '' : ` aria-disabled="true"`}>` +
        `<span class="cc-story-act-ico">${icon(a.enabled ? ico : 'lock')}</span>` +
        `<span class="cc-story-act-main"><span class="cc-story-act-label">${esc(a.label)}</span>${a.reason ? `<span class="cc-story-act-reason">${esc(a.reason)}</span>` : ''}</span>` +
        `</button>`;
    }
    this.el.innerHTML = s;
    // The look chips' tiny thumbnails (cached canvases).
    for (const t of this.el.querySelectorAll<HTMLElement>('[data-thumb]')) {
      const [crown, look] = (t.dataset.thumb ?? '').split(':');
      const c = crownThumb(crown as CrownId, Number(look));
      if (c) t.append(c);
    }
  }

  private setMode(m: 'idle' | 'confirm' | 'crowns'): void {
    const changed = m !== this.mode;
    this.mode = m;
    if (m !== 'crowns') this.setPick(null, 0);
    if (changed) this.onMode?.(m);
    window.clearTimeout(this.timer);
    if (m !== 'confirm') highlight.zone = null;
    if (m === 'confirm') this.timer = window.setTimeout(() => this.setMode('idle'), CONFIRM_MS);
    this.key = '';
  }

  /**
   * The picked crown and look (§6.2): the map's ghost shows it over the Stratablock (a preview plan of its footprint
   * with overlay's ghostPick), cleared when the picker closes.
   */
  private setPick(crown: CrownId | null, look: number, buildingId = -1): void {
    const game = this.ctx.game;
    const had = this.pickCrown !== null;
    this.pickCrown = crown;
    this.pickLook = look;
    this.pickFor = buildingId;
    const b = crown ? game.world.buildings.get(buildingId) : null;
    if (b && crown) {
      ghostPick.crown = crown;
      ghostPick.look = look as 0 | 1 | 2;
      const tiles: ActionPlan['tiles'] = [];
      for (let y = b.y; y < b.y + b.size; y++) for (let x = b.x; x < b.x + b.size; x++) tiles.push({ x, y, ok: true });
      game.setPreview({ tool: 'stack', tiles, cost: 0, valid: true, footprint: { x: b.x, y: b.y, size: b.size } });
    } else if (had) {
      delete ghostPick.crown;
      delete ghostPick.look;
      if (game.preview?.tool === 'stack' && game.tool === 'inspect') game.setPreview(null);
    }
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
      // Pick the crown (its looks show under the grid, look 0 preselected); Crown it raises it.
      this.setPick(crown, 0, a.buildingId);
      this.key = '';
      this.refresh();
      return;
    }
    if (btn.dataset.look !== undefined && this.pickCrown) {
      this.setPick(this.pickCrown, Number(btn.dataset.look), this.pickFor);
      this.key = '';
      this.refresh();
      return;
    }
    if (act === 'crown-go' && a && this.pickCrown) {
      const r = game.raiseStage(a.buildingId, this.pickCrown, this.pickLook as 0 | 1 | 2);
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
    } else if (act === 'bridgeRemove' && this.sel?.link !== undefined) {
      // MEGACITY §5.5: no refund once the 10 s undo has passed.
      const r = game.removeSkybridge(this.sel.link);
      if (r.ok) game.toast('Skybridge removed', 'info');
    } else if (act === 'map' && a.x !== undefined && a.y !== undefined) {
      // A locked district's preview (§7.5): the City map on that district.
      const slot = game.world.slotAt(a.x, a.y);
      game.select(null);
      this.ctx.actions.openCityMap(slot);
    } else if (act === 'frame') {
      // Skeleton Row (§3.7): finish the frame as a Stratablock with its Plinth done.
      const r = game.finishFrame(a.buildingId);
      if (r.ok) game.toast('The frame is finished: a Stratablock stands.', 'good');
      this.refresh();
    }
  };
}
