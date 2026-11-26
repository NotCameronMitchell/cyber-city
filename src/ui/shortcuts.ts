// ─────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts and key hints (docs/MEGACITY.md §14.3).
//
//   The ? sheet     every key the game binds, in four groups (Camera, Time,
//                   Build, Panels), printed from keyboard.ts' SHORTCUTS so it
//                   can never list a key that does nothing. A side panel on the
//                   desktop layout (buildDialog side: true), a dialog elsewhere.
//   Keycaps         the labels the toolbar, tray cards and tooltips print: the
//                   player's own layout where the browser can tell
//                   (navigator.keyboard.getLayoutMap(), Chromium), else the US
//                   label. Mnemonic keys (M, G, U, ?) go by the character, so
//                   their label never changes.
// ─────────────────────────────────────────────────────────────────────────────

import { SHORTCUTS, type Shortcut, type ShortcutGroup } from '../input/keyboard';
import { buildDialog, type UIContext } from './context';
import { h, setText } from './dom';
import { icon } from './icons';

/** The four groups, in order. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Camera', 'Time', 'Build', 'Panels'];

/** The physical key behind each toolbar button's keycap (§14.3), by category id. Escape and the Data key never move. */
export const CATEGORY_KEYS: Readonly<Record<string, { code: string; us: string }>> = {
  inspect: { code: 'Escape', us: 'Esc' },
  bulldoze: { code: 'KeyB', us: 'B' },
  road: { code: 'KeyR', us: 'R' },
  zones: { code: 'KeyZ', us: 'Z' },
  power: { code: 'KeyE', us: 'E' },
  services: { code: 'KeyV', us: 'V' },
  sky: { code: 'KeyT', us: 'T' },
  deals: { code: 'KeyF', us: 'F' },
  data: { code: 'KeyO', us: 'O' },
};

/** Tray cards with a key (§14.3): shown beside the cost. */
export const CARD_KEYS: Readonly<Record<string, { code: string; us: string }>> = {
  road: { code: 'KeyR', us: 'R' },
  res: { code: 'KeyZ', us: 'Z' },
  com: { code: 'KeyX', us: 'X' },
  ind: { code: 'KeyC', us: 'C' },
};

/** The layout map once the browser answered (null: not asked, not supported, or refused). */
let layout: ReadonlyMap<string, string> | null = null;
let layoutAsked = false;
const layoutListeners: (() => void)[] = [];

/**
 * Ask the browser for the player's keyboard layout once (Chromium's navigator.keyboard.getLayoutMap()); listeners run
 * when it answers, so keycaps already on screen relabel. Elsewhere every keycap keeps its US label.
 */
export function loadKeyLayout(onChange?: () => void): void {
  if (onChange) layoutListeners.push(onChange);
  if (layoutAsked) return;
  layoutAsked = true;
  const kb = typeof navigator !== 'undefined' ? (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> } }).keyboard : undefined;
  if (!kb?.getLayoutMap) return;
  try {
    kb.getLayoutMap()
      .then((m) => {
        layout = m;
        for (const fn of layoutListeners) fn();
      })
      .catch(() => {
        /* not allowed here (an iframe without the permission): US labels */
      });
  } catch {
    /* old browsers */
  }
}

/** Test hook: set (or clear) the layout map keycaps read. */
export function setKeyLayout(m: ReadonlyMap<string, string> | null): void {
  layout = m;
}

/** The printed label of the physical key `code` on the player's layout, else `us`. Letters print upper-case. */
export function keyLabel(code: string, us: string): string {
  if (!code || !layout || code === 'Escape' || code === 'Space' || code === 'Enter') return us;
  const ch = layout.get(code);
  if (!ch) return us;
  return ch.length === 1 ? ch.toUpperCase() : us;
}

/** A row's keys as printed on this layout (code-bound keys through keyLabel, the rest as written). */
export function rowKeys(s: Shortcut): string[] {
  return s.keys.map((k, i) => keyLabel(s.codes[i] ?? '', k));
}

/** The toolbar keycap for a category ('' for none). */
export function categoryKey(cat: string): string {
  const k = CATEGORY_KEYS[cat];
  return k ? keyLabel(k.code, k.us) : '';
}

/** The tray-card keycap for a tool ('' for none). */
export function cardKey(tool: string): string {
  const k = CARD_KEYS[tool];
  return k ? keyLabel(k.code, k.us) : '';
}

/**
 * Key hints (§14.3) show on the desktop layout and, on any device, after a hardware key press in the session (an iPad
 * with a keyboard); never after a virtual keyboard's keydown (keyboard.ts isHardwareKey keeps those out).
 */
export function keyHintsShown(desk: boolean, hardwareKey: boolean): boolean {
  return desk || hardwareKey;
}

/** The ? sheet's model: groups in order with their rows (what the sheet prints and the tests read). */
export function shortcutSheet(): { group: ShortcutGroup; rows: { keys: string[]; label: string }[] }[] {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    rows: SHORTCUTS.filter((s) => s.group === group).map((s) => ({ keys: rowKeys(s), label: s.label })),
  }));
}

/** A keycap element (14 px tall, 10 px text; the toolbar's top corner, a tray card's cost row, the ? sheet). */
export function keycap(label: string, cls = 'cc-kbd'): HTMLElement {
  return h('kbd', { class: cls, text: label });
}

/** The ? sheet. */
export class ShortcutSheet {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;

  constructor(private readonly ctx: UIContext) {
    const d = buildDialog({ id: 'cc-shortcuts', title: 'Keyboard shortcuts', icon: icon('key'), side: true });
    this.el = d.el;
    this.body = d.body;
    d.el.classList.add('cc-shortcuts');
    setText(d.sub, 'Every key the game listens to');
    this.render();
    d.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) ctx.modals.close(this.el);
    });
    loadKeyLayout(() => this.render());
  }

  get isOpen(): boolean {
    return this.ctx.modals.isOpen(this.el);
  }

  open(): void {
    this.render();
    this.ctx.modals.open(this.el);
  }

  close(): void {
    this.ctx.modals.close(this.el);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private render(): void {
    this.body.textContent = '';
    for (const g of shortcutSheet()) {
      const list = h('dl', { class: 'cc-keys-list' });
      for (const r of g.rows) {
        list.append(
          h(
            'div',
            { class: 'cc-keys-row' },
            h('dt', { class: 'cc-keys-caps' }, ...r.keys.map((k) => keycap(k))),
            h('dd', { class: 'cc-keys-what', text: r.label }),
          ),
        );
      }
      this.body.append(h('section', { class: 'cc-subpanel cc-keys-group' }, h('div', { class: 'cc-lines-head' }, h('span', { class: 'cc-label', text: g.group })), list));
    }
  }
}
