// ─────────────────────────────────────────────────────────────────────────────
// Faction sheet (docs/STORY.md §8.6): snaps to 60 % (expand to full).
//
//   BALANCE OF POWER  16 px stacked bar, five colours + patterns, % labels
//   Trace             eye · 0–100 bar with ticks at 25/40/70 · number / REVEALED
//   rows (64 px)      sigil · name · tier word · meter centred at 0 with ticks
//                     at ±20 / ±60 · top mood driver
//   detail (push)     leader and what they call you · penalty chips · the
//                     actions first, so they sit above the fold at 60 %: Deal
//                     (Pact for gangs) · Send salt · Nudge · exclusive building +
//                     Build · then Charter claim and every mood driver.
//                     Back is pinned bottom-left; an edge swipe right also goes back.
//                     Short phones open the detail expanded to full height.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from '../../game/config';
import type { ActionView, FactionId, StoryView } from '../../game/story/types';
import type { UIContext } from '../context';
import { esc, h, setHidden } from '../dom';
import { groupInt, MINUS } from '../format';
import { icon } from '../icons';
import { edgeSwipeRight, pressGuard } from './gesture';
import { hintRow } from './hints';
import { StorySheet } from './sheet';
import { TIER_COLOR, TIER_WORD, factionColor, factionPattern, factionSigil, sigilImg } from './sigils';

type FactionRow = StoryView['factions'][number];

function signedInt(v: number): string {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : r < 0 ? `${MINUS}${-r}` : '0';
}

export class FactionSheet {
  readonly sheet = new StorySheet('cc-factions', 'Factions', 'tall', { expandable: true });
  private readonly backBtn: HTMLButtonElement;
  private detail: FactionId | null = null;
  private html = '';
  private view: StoryView | null = null;
  private readonly press: { readonly down: boolean };

  constructor(private readonly ctx: UIContext) {
    this.backBtn = h('button', { class: 'cc-btn is-ghost cc-ss-back', type: 'button', 'data-act': 'back' }, h('span', { html: icon('back') }), h('span', { text: 'Back' }));
    this.sheet.foot.append(this.backBtn);
    this.sheet.el.addEventListener('click', this.onClick);
    this.press = pressGuard(this.sheet.el, () => this.view && this.sync(this.view));
    edgeSwipeRight(this.sheet.body, () => this.back(), () => this.detail !== null);
    this.sheet.onClosed = () => {
      this.detail = null;
    };
  }

  open(f: FactionId | null = null): void {
    this.detail = f;
    this.sheet.open();
    if (f) this.expandIfShort();
    if (this.view) this.sync(this.view, true);
    this.sheet.body.scrollTop = 0;
  }

  /** Portrait phones under ~720 px: 60 % leaves room for one action, so the detail opens full height. */
  private expandIfShort(): void {
    if (typeof matchMedia === 'function' && matchMedia('(orientation: portrait) and (max-height: 719px)').matches) this.sheet.setExpanded(true);
  }

  back(): void {
    if (!this.detail) return;
    this.detail = null;
    if (this.view) this.sync(this.view, true);
    this.sheet.body.scrollTop = 0;
  }

  sync(v: StoryView, force = false): void {
    this.view = v;
    if (!this.sheet.isOpen && !force) return;
    const f = this.detail ? v.factions.find((x) => x.id === this.detail) : null;
    if (this.detail && !f) this.detail = null;
    const html = f ? this.detailHtml(v, f) : this.listHtml(v);
    this.sheet.setTitle(f ? f.name : 'Factions', f ? `${f.leader} · calls you “${f.callsYou}”` : 'Everyone wants the switch.');
    setHidden(this.sheet.foot, !f);
    // Never swap the buttons out under a finger (cooldowns and standings tick while the sheet is open).
    if (force || (html !== this.html && !this.press.down)) {
      this.html = html;
      this.sheet.body.innerHTML = html;
    }
  }

  // ── List ─────────────────────────────────────────────────────────────────

  private listHtml(v: StoryView): string {
    let s = '<div class="cc-fs-top">';
    // Balance of power.
    const bar = v.factions.filter((f) => f.power !== null && f.shown === 'yes');
    const total = bar.reduce((a, f) => a + Math.max(0, f.power ?? 0), 0);
    s += '<div class="cc-fs-label">Balance of power</div><div class="cc-pow">';
    let labels = '';
    for (const f of bar) {
      const p = total > 0 ? Math.max(0, f.power ?? 0) / total : 0;
      if (p <= 0) continue;
      const pct = (p * 100).toFixed(2);
      s += `<span class="cc-pow-seg" style="width:${pct}%;background:${factionPattern(f.id)}" title="${esc(f.name)} ${Math.round(p * 100)}%"></span>`;
      labels += `<span class="cc-pow-lab" style="width:${pct}%;color:${factionColor(f.id)}">${p >= 0.1 ? `${Math.round(p * 100)}%` : ''}</span>`;
    }
    if (total <= 0) s += '<span class="cc-pow-empty">No one holds anything yet.</span>';
    s += `</div><div class="cc-pow-labels">${labels}</div>`;
    // Trace.
    const tr = v.trace;
    if (!tr.retired) {
      const val = Math.max(0, Math.min(100, tr.value));
      s +=
        `<div class="cc-trace${tr.revealed ? ' is-revealed' : ''}${tr.frozen ? ' is-frozen' : ''}" title="Trace: how close anyone is to proving you exist">` +
        `<span class="cc-trace-ico">${icon('eye')}</span><span class="cc-trace-name">Trace</span>` +
        `<span class="cc-trace-bar"><i style="transform:scaleX(${(val / 100).toFixed(3)})"></i><b style="left:25%"></b><b style="left:40%"></b><b style="left:70%"></b></span>` +
        `<span class="cc-trace-val">${tr.revealed ? 'REVEALED' : `${Math.round(val)}`}${tr.frozen ? icon('lock') : ''}</span></div>`;
    }
    s += '</div><ul class="cc-fs-list">';
    for (const f of v.factions) {
      if (f.shown === 'no') continue;
      if (f.shown === 'silhouette') {
        s += `<li class="cc-fs-row is-silhouette"><span class="cc-fs-sig">${sigilImg('unknown', '#8d93b8', 40)}</span><span class="cc-fs-main"><span class="cc-fs-name">???</span><span class="cc-fs-driver">lamps in windows</span></span></li>`;
        continue;
      }
      const st = Math.max(-100, Math.min(100, f.standing));
      const top = f.drivers.length ? [...f.drivers].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0] : null;
      const left = st < 0 ? 50 + st / 2 : 50;
      const width = Math.abs(st) / 2;
      s +=
        `<li><button class="cc-fs-row" type="button" data-f="${f.id}" style="--fc:${factionColor(f.id)};--tier:${TIER_COLOR[f.tier]}">` +
        `<span class="cc-fs-sig">${factionSigil(f.id, 40)}</span>` +
        `<span class="cc-fs-main"><span class="cc-fs-line"><span class="cc-fs-name">${esc(f.name)}</span><span class="cc-fs-tier">${f.retiredLabel ? 'Retired' : TIER_WORD[f.tier]}</span></span>` +
        `<span class="cc-fs-meter" aria-label="Standing ${Math.round(st)}"><i style="left:${left}%;width:${width}%"></i><b style="left:20%"></b><b style="left:40%"></b><b class="is-zero" style="left:50%"></b><b style="left:60%"></b><b style="left:80%"></b></span>` +
        `<span class="cc-fs-driver">${f.retiredLabel ? esc(f.retiredLabel) : top ? `<span class="${top.value >= 0 ? 'is-up' : 'is-down'}">${top.value >= 0 ? '▲' : '▼'}</span> ${esc(top.label)} ${signedInt(top.value)}` : 'No strong feelings.'}</span></span>` +
        `<span class="cc-fs-num">${signedInt(st)}</span><span class="cc-fs-chev">${icon('chevron')}</span></button></li>`;
    }
    s += '</ul>';
    return s;
  }

  // ── Detail ───────────────────────────────────────────────────────────────

  private detailHtml(v: StoryView, f: FactionRow): string {
    const st = Math.round(f.standing);
    let s =
      `<div class="cc-fd-head" style="--fc:${factionColor(f.id)};--tier:${TIER_COLOR[f.tier]}">` +
      `<span class="cc-fd-sig">${factionSigil(f.id, 56)}</span>` +
      `<span class="cc-fd-meta"><span class="cc-fd-tier">${f.retiredLabel ? 'Retired' : TIER_WORD[f.tier]} · ${signedInt(st)}</span>` +
      (f.power !== null ? `<span class="cc-fd-power">Power share ${Math.round(f.power)}%</span>` : '') +
      `</span></div>`;
    if (f.retiredLabel) s += `<p class="cc-fd-retired">${esc(f.retiredLabel)}</p>`;
    if (f.penalties.length) s += `<div class="cc-fd-pen">${f.penalties.map((p) => `<span class="cc-pen-chip">${icon('warn')}${esc(p)}</span>`).join('')}</div>`;
    // Actions first: at 60 % height they must not sit below the mood drivers.
    s += '<div class="cc-fd-actions">';
    const gang = f.id === 'undertow' || f.id === 'kites';
    if (f.deal) s += this.actionBtn('deal', f.deal, gang ? 'hand' : 'deals', gang ? 'Pact' : 'Deal');
    else if (!f.retiredLabel) s += `<div class="cc-fd-note">${icon('lock')}<span>${gang ? 'Pacts' : 'Deals'} open at Friendly.</span></div>`;
    if (f.salt) s += this.actionBtn('salt', f.salt, 'salt', 'Send salt');
    if (f.nudge) s += this.actionBtn('nudge', f.nudge, 'hand', 'Nudge');
    if (f.exclusive) {
      const def = BUILDINGS[f.exclusive.type];
      s +=
        `<div class="cc-fd-excl${f.exclusive.buildable ? ' is-open' : ''}"><span class="cc-fd-excl-text"><b>${esc(def.name)}</b><span>${esc(f.exclusive.buildable ? def.desc : f.exclusive.reason ?? 'Locked')}</span></span>` +
        `<button class="cc-btn${f.exclusive.buildable ? ' is-primary' : ''}" type="button" data-act="build" data-type="${f.exclusive.type}"${f.exclusive.buildable ? '' : ' aria-disabled="true"'}>${icon(f.exclusive.buildable ? 'chevron' : 'lock')}<span>Build</span></button></div>`;
    }
    s += '</div>';
    if (f.claim) s += `<div class="cc-fd-claim">${icon('flag')}<span>${esc(f.claim)}</span></div>`;
    // Mood drivers.
    if (f.drivers.length) {
      s += '<div class="cc-fs-label">What moves them</div><ul class="cc-fd-drivers">';
      for (const d of f.drivers.slice(0, 6)) {
        const cls = d.value > 0 ? 'is-up' : d.value < 0 ? 'is-down' : '';
        s += `<li class="${cls}"><span class="cc-fd-dmark">${d.value > 0 ? icon('check') : d.value < 0 ? icon('close') : '·'}</span><span>${esc(d.label)}</span><b>${signedInt(d.value)}</b></li>`;
      }
      s += '</ul>';
    }
    void v;
    return s;
  }

  private actionBtn(act: string, a: ActionView, ico: Parameters<typeof icon>[0], kicker: string): string {
    const cost = a.cost > 0 ? `${groupInt(a.cost)} CR` : '';
    const sub = !a.enabled ? a.reason ?? 'Not now' : a.cooldownDays && a.cooldownDays > 0 ? `ready in ${Math.ceil(a.cooldownDays)}d` : '';
    return (
      `<button class="cc-fd-act${a.enabled ? '' : ' is-off'}" type="button" data-act="${act}"${a.enabled ? '' : ' aria-disabled="true"'}${a.reason ? ` data-reason="${esc(a.reason)}"` : ''}>` +
      `<span class="cc-fd-act-ico">${icon(ico)}</span>` +
      `<span class="cc-fd-act-main"><span class="cc-fd-act-k">${esc(kicker)}</span><span class="cc-fd-act-label">${esc(a.label)}</span>` +
      `<span class="cc-fd-act-hints">${hintRow(a.hints)}${sub ? `<span class="cc-fd-act-sub">${esc(sub)}</span>` : ''}</span></span>` +
      (cost ? `<span class="cc-fd-act-cost">${cost}</span>` : '') +
      `</button>`
    );
  }

  private readonly onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('[data-f]');
    if (row && this.sheet.body.contains(row)) {
      this.detail = row.dataset.f as FactionId;
      this.expandIfShort();
      if (this.view) this.sync(this.view, true);
      this.sheet.body.scrollTop = 0;
      return;
    }
    const btn = t.closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const { game } = this.ctx;
    if (act === 'back') {
      this.back();
      return;
    }
    const f = this.detail;
    if (!f) return;
    if (btn.getAttribute('aria-disabled') === 'true') {
      const reason = btn.dataset.reason ?? (act === 'build' ? this.view?.factions.find((x) => x.id === f)?.exclusive?.reason : undefined);
      if (reason) game.toast(reason, 'info');
      this.ctx.sfx('error');
      return;
    }
    if (act === 'deal') game.takeDeal(f);
    else if (act === 'salt') game.sendSalt(f);
    else if (act === 'nudge') game.nudge(f);
    else if (act === 'build') {
      const type = btn.dataset.type as keyof typeof BUILDINGS;
      this.sheet.close();
      game.setTool(type);
    }
  };
}
