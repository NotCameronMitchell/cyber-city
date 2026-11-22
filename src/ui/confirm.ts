// ─────────────────────────────────────────────────────────────────────────────
// In-page confirm dialog (window.confirm/prompt are blocked in sandboxed
// frames). Optional single text field, e.g. the new city's name.
// ─────────────────────────────────────────────────────────────────────────────

import { buildDialog, type ConfirmOptions, type UIContext } from './context';
import { h, setHidden, setText } from './dom';
import { icon } from './icons';

export class ConfirmDialog {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly field: HTMLElement;
  private readonly fieldLabel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly reroll: HTMLButtonElement;
  private readonly ok: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private opts: ConfirmOptions | null = null;
  private settled = false;

  constructor(private readonly ctx: UIContext) {
    const d = buildDialog({ id: 'cc-confirm', title: '', icon: icon('warn') });
    this.el = d.el;
    this.title = d.title;
    d.el.classList.add('cc-confirm');
    this.text = h('p', { class: 'cc-confirm-text' });
    this.fieldLabel = h('label', { class: 'cc-label', for: 'cc-confirm-input' });
    this.input = h('input', {
      class: 'cc-input',
      id: 'cc-confirm-input',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      enterkeyhint: 'done',
    });
    this.reroll = h('button', { class: 'cc-iconbtn cc-reroll', type: 'button', 'aria-label': 'Random name', html: icon('dice') });
    this.field = h('div', { class: 'cc-field' }, this.fieldLabel, h('div', { class: 'cc-field-row' }, this.input, this.reroll));
    d.body.append(this.text, this.field);

    this.cancel = h('button', { class: 'cc-btn is-ghost', type: 'button', 'data-act': 'cancel' });
    this.ok = h('button', { class: 'cc-btn is-primary', type: 'button', 'data-act': 'ok', 'data-autofocus': true });
    d.foot.hidden = false;
    d.foot.append(this.cancel, this.ok);

    d.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]') || t.closest('[data-act="cancel"]')) this.dismiss();
      else if (t.closest('[data-act="ok"]')) this.accept();
    });
    this.reroll.addEventListener('click', () => {
      const next = this.opts?.input?.reroll?.();
      if (next) this.input.value = next;
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.accept();
      }
    });
  }

  open(opts: ConfirmOptions): void {
    this.opts = opts;
    this.settled = false;
    setText(this.title, opts.title);
    setText(this.text, opts.body);
    setText(this.ok, opts.confirmLabel);
    setText(this.cancel, opts.cancelLabel ?? 'Cancel');
    this.ok.classList.toggle('is-danger', !!opts.danger);
    this.ok.classList.toggle('is-primary', !opts.danger);
    setHidden(this.field, !opts.input);
    setHidden(this.reroll, !opts.input?.reroll);
    if (opts.input) {
      setText(this.fieldLabel, opts.input.label);
      this.input.value = opts.input.value;
      this.input.maxLength = opts.input.maxLength ?? 32;
    }
    this.ctx.modals.open(this.el, () => {
      // Closed by scrim / Esc / X without a decision.
      if (!this.settled) {
        this.settled = true;
        this.opts?.onCancel?.();
      }
    });
  }

  private accept(): void {
    const opts = this.opts;
    if (!opts || this.settled) return;
    this.settled = true;
    const value = this.input.value.trim();
    this.ctx.modals.close(this.el);
    opts.onConfirm(value);
  }

  private dismiss(): void {
    this.ctx.modals.close(this.el); // onClose → onCancel
  }
}
