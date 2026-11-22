// ─────────────────────────────────────────────────────────────────────────────
// Goal drawer (docs/STORY.md §8.5): the goal chip opens a 50 % sheet with the
// chapter numeral, title and question, then one 64 px row per goal (label,
// live "now · need" value, progress bar; hold goals "12/20 days", waived goals
// "waived"). In Chapter VI it lists the Charter Claims for all five endings
// instead; a tap opens the Charter Night preview.
// ─────────────────────────────────────────────────────────────────────────────

import type { StoryView } from '../../game/story/types';
import { esc } from '../dom';
import { icon } from '../icons';
import { pressGuard } from './gesture';
import { StorySheet } from './sheet';

export class GoalDrawer {
  readonly sheet = new StorySheet('cc-goals', 'Goals', 'half');
  private html = '';
  private last: StoryView | null = null;
  private readonly press: { readonly down: boolean };
  onPreview: (() => void) | null = null;

  constructor() {
    this.sheet.body.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="preview"]')) this.onPreview?.();
    });
    this.press = pressGuard(this.sheet.body, () => this.last && this.sheet.isOpen && this.sync(this.last));
  }

  sync(v: StoryView): void {
    this.last = v;
    const ch = v.chapter;
    const claimsMode = (v.countdownDays !== null || ch.n === 6) && v.claims.length > 0;
    this.sheet.setTitle(ch.n >= 7 ? 'Epilogue' : `Chapter ${ch.numeral}${ch.title ? ` · ${ch.title}` : ''}`, ch.question ? (ch.question.startsWith('>') ? ch.question : `> query: ${ch.question}`) : '');
    let html = '';
    if (claimsMode) {
      const d = v.countdownDays;
      html += `<div class="cc-goal-lead">${d !== null ? `<b>Charter Night</b> in ${Math.max(0, Math.ceil(d))} days.` : '<b>Charter Night</b>.'} Each claim is checked live against the city.</div>`;
      html += '<ul class="cc-claims">';
      for (const c of v.claims) {
        const miss = c.rows.find((r) => !r.ok);
        html +=
          `<li class="cc-claim${c.ok ? ' is-ok' : ''}"><span class="cc-claim-mark">${c.ok ? icon('check') : icon('close')}</span>` +
          `<span class="cc-claim-text"><b>${esc(c.title)}</b><span>${c.ok ? 'Every claim holds' : esc(miss ? `${miss.label}${miss.gap ? ` · ${miss.gap}` : ''}` : 'Not yet')}</span></span></li>`;
      }
      html += '</ul>';
      html += `<button class="cc-btn cc-goal-preview" type="button" data-act="preview">${icon('eye')}<span>Charter Night preview</span></button>`;
    } else if (v.goals.length === 0) {
      html += `<div class="cc-goal-empty">${ch.n >= 7 ? 'The charter is held. The city keeps building.' : 'No goals yet. Keep building; something is listening.'}</div>`;
    } else {
      html += '<ul class="cc-goal-list">';
      for (const g of v.goals) {
        const state = g.waived ? 'is-waived' : g.done ? 'is-done' : '';
        const value = g.waived ? 'waived · the city moved on without it' : g.done ? 'done' : [g.now && `now ${g.now}`, g.need && `need ${g.need}`].filter(Boolean).join(' · ');
        const p = g.done || g.waived ? 1 : Math.max(0, Math.min(1, g.progress));
        html +=
          `<li class="cc-goal-row ${state}"><span class="cc-goal-mark">${g.done || g.waived ? icon('check') : icon('goal')}</span>` +
          `<span class="cc-goal-main"><span class="cc-goal-label">${esc(g.label)}</span><span class="cc-goal-val">${esc(value)}</span>` +
          `<span class="cc-goal-bar"><i style="transform:scaleX(${p.toFixed(3)})"></i></span></span></li>`;
      }
      html += '</ul>';
    }
    if (html !== this.html && !this.press.down) {
      this.html = html;
      this.sheet.body.innerHTML = html;
    }
  }
}
