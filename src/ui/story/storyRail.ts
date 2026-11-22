// ─────────────────────────────────────────────────────────────────────────────
// Story rail (docs/STORY.md §8.1): a 48 px row directly above the toolbar.
//
//   goal chip   flexible width, 36 px tall in a 44 px hit area:
//               "III ▸ ◉◉○", or "Charter Night · 214d" in Chapter VI
//   faction     44 px: the leading faction's sigil with a tiny tier ring
//               (hidden until the factions unlock)
//   COMMS       44 px: envelope, unread badge, countdown ring while a faction
//               card waits (hidden until COMMS unlocks)
//
// The rail hides while a story card or sheet is open, and when there is no
// story to show yet (the sandbox before the first beat).
// ─────────────────────────────────────────────────────────────────────────────

import type { StoryView } from '../../game/story/types';
import type { UIContext } from '../context';
import { h, replayClass, setAttr, setClass, setHidden, setHtml, setStyle, setText } from '../dom';
import { icon } from '../icons';
import { TIER_COLOR, factionSigil } from './sigils';

export interface RailActions {
  goals(): void;
  factions(): void;
  comms(): void;
}

const RING_C = 2 * Math.PI * 19;

export class StoryRail {
  readonly el: HTMLElement;
  private readonly goal: HTMLButtonElement;
  private readonly goalNum: HTMLElement;
  private readonly goalText: HTMLElement;
  private readonly goalDots: HTMLElement;
  private readonly goalNext: HTMLElement;
  private readonly fac: HTMLButtonElement;
  private readonly facSig: HTMLElement;
  private readonly comms: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly ring: SVGCircleElement;
  private doneCount = -1;
  private chapterN = -1;

  constructor(
    private readonly ctx: UIContext,
    actions: RailActions,
  ) {
    this.goalNum = h('span', { class: 'cc-goal-num' });
    this.goalText = h('span', { class: 'cc-goal-text' });
    this.goalDots = h('span', { class: 'cc-goal-dots', 'aria-hidden': 'true' });
    this.goalNext = h('span', { class: 'cc-goal-next', 'aria-hidden': 'true' });
    this.goal = h(
      'button',
      { class: 'cc-rail-goal', type: 'button', 'aria-label': 'Chapter goals' },
      h('span', { class: 'cc-goal-chip cc-chipglass' }, this.goalNum, h('span', { class: 'cc-goal-sep', text: '▸' }), this.goalText, this.goalDots, this.goalNext),
    );
    this.facSig = h('span', { class: 'cc-rail-sig' });
    this.fac = h('button', { class: 'cc-rail-btn cc-rail-fac', type: 'button', 'aria-label': 'Factions', hidden: true }, h('span', { class: 'cc-rail-face cc-chipglass' }, this.facSig));
    this.badge = h('span', { class: 'cc-rail-badge', hidden: true });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'cc-rail-ring');
    svg.setAttribute('viewBox', '0 0 44 44');
    svg.setAttribute('aria-hidden', 'true');
    this.ring = document.createElementNS(svgNS, 'circle');
    this.ring.setAttribute('cx', '22');
    this.ring.setAttribute('cy', '22');
    this.ring.setAttribute('r', '19');
    this.ring.setAttribute('stroke-dasharray', `${RING_C}`);
    svg.append(this.ring);
    this.comms = h(
      'button',
      { class: 'cc-rail-btn cc-rail-comms', type: 'button', 'aria-label': 'COMMS', hidden: true },
      h('span', { class: 'cc-rail-face cc-chipglass', html: icon('comms') }),
      svg as unknown as HTMLElement,
      this.badge,
    );
    this.el = h('div', { class: 'cc-storyrail', hidden: true, role: 'toolbar', 'aria-label': 'Story' }, this.goal, this.fac, this.comms);
    this.goal.addEventListener('click', () => actions.goals());
    this.fac.addEventListener('click', () => actions.factions());
    this.comms.addEventListener('click', () => actions.comms());
  }

  /** Is there anything to show at all? */
  static hasStory(v: StoryView): boolean {
    return v.goals.length > 0 || !!v.chapter.title || v.unlocked.factions || v.unlocked.comms || v.countdownDays !== null || !!v.ending;
  }

  sync(v: StoryView, unread: number): void {
    const has = StoryRail.hasStory(v);
    setClass(this.el, 'is-empty', !has);
    // Goal chip.
    const ch = v.chapter;
    if (v.countdownDays !== null && v.countdownDays !== undefined) {
      setText(this.goalNum, ch.numeral || 'VI');
      setText(this.goalText, `Charter Night · ${Math.max(0, Math.ceil(v.countdownDays))}d`);
      setText(this.goalDots, '');
      const ok = v.claims.filter((c) => c.ok).length;
      setText(this.goalNext, v.claims.length ? `${ok}/${v.claims.length} claims` : '');
    } else {
      setText(this.goalNum, ch.numeral || '');
      const done = v.goals.filter((g) => g.done || g.waived).length;
      let dots = '';
      for (const g of v.goals) dots += g.done || g.waived ? '◉' : '○';
      setText(this.goalDots, dots);
      setText(this.goalText, v.goals.length ? '' : ch.n >= 7 ? 'Epilogue' : ch.title || 'Story');
      const next = v.goals.find((g) => !g.done && !g.waived);
      setText(this.goalNext, next ? (next.now && next.need && !next.now.includes('/') && next.now !== '✗' ? `${next.label} · ${next.now}` : next.label) : '');
      if (this.chapterN === ch.n && done > this.doneCount && this.doneCount >= 0) this.pulse();
      this.doneCount = done;
    }
    this.chapterN = ch.n;
    setClass(this.goal, 'is-done', v.goals.length > 0 && v.goals.every((g) => g.done || g.waived));
    const label = v.goals.length ? `Chapter ${ch.numeral} goals: ${v.goals.filter((g) => g.done || g.waived).length} of ${v.goals.length} done` : 'Chapter';
    setAttr(this.goal, 'aria-label', label);

    // Faction button: the highest-standing visible faction.
    setHidden(this.fac, !v.unlocked.factions);
    if (v.unlocked.factions) {
      let best: StoryView['factions'][number] | null = null;
      for (const f of v.factions) if (f.shown === 'yes' && !f.retiredLabel && (!best || f.standing > best.standing)) best = f;
      if (best) {
        setHtml(this.facSig, factionSigil(best.id, 26));
        setStyle(this.fac, '--tier', TIER_COLOR[best.tier]);
      }
    }

    // COMMS button.
    setHidden(this.comms, !v.unlocked.comms);
    const p = v.pending;
    setClass(this.comms, 'is-pending', !!p);
    if (p) {
      const frac = Math.max(0, Math.min(1, p.daysLeft / 20));
      setAttr(this.ring, 'stroke-dashoffset', `${(RING_C * (1 - frac)).toFixed(1)}`);
    }
    const n = unread + (p ? 1 : 0);
    setHidden(this.badge, n <= 0);
    setText(this.badge, n > 9 ? '9+' : String(n));
    setAttr(this.comms, 'aria-label', p ? `COMMS: a card is waiting, auto in ${Math.ceil(p.daysLeft)} days` : n > 0 ? `COMMS: ${n} new` : 'COMMS');
  }

  /** Flash the goal chip (progress, resume). */
  pulse(): void {
    replayClass(this.goal, 'is-pulse');
  }

  setVisible(on: boolean): void {
    setHidden(this.el, !on);
  }

  /** Top edge of the rail in viewport px (for the incoming banner), or null when hidden. */
  topEdge(): number | null {
    if (this.el.hidden) return null;
    const r = this.el.getBoundingClientRect();
    return r.height > 0 ? r.top : null;
  }

  get ctxRef(): UIContext {
    return this.ctx;
  }
}
