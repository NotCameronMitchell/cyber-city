// ─────────────────────────────────────────────────────────────────────────────
// City transfer and growing, the player's side (docs/MEGACITY.md §13.1, §13.5,
// §13.6, §3.11; WP-9):
//
//   Export sheet   the city line, the file name and size, Share… / Download /
//                  Copy as text in the order §13.5 picks (a text box when the
//                  clipboard is refused), the frame note
//   Import sheet   Choose file… / Paste text / (desktop) a drop zone, "Reading
//                  city…", the error line, then a preview card built from the
//                  checked file (no World): what it holds, what happens to the
//                  current city, the same-city and pace lines, Replace city
//   Grow           the "Grow to 25 districts?" confirm, the busy state, the view
//                  kept in place (its tile moves by 64, 64), the copy-refused choice
//
// Export and Import stay centred dialogs on every layout (§14.1). Strings from
// a file reach the screen only as text. Logic without DOM: game/transfer.ts and
// the pure helpers at the top of this file.
// ─────────────────────────────────────────────────────────────────────────────

import { deviceClass } from '../game/device';
import { STORAGE_FULL_TEXT } from '../game/saveStore';
import { CHAPTER_NUMERALS } from '../game/story/state';
import { CHAPTERS } from '../game/story/content/chapters';
import { ENDINGS } from '../game/story/content/endings';
import type { EndingId } from '../game/story/types';
import {
  FILE_ACCEPT,
  FILE_TYPE,
  TRANSFER_TEXT,
  buildCityFile,
  exportPlan,
  fileFacts,
  readCityFile,
  sameCity,
  type CityFile,
  type ExportAction,
  type ExportEnv,
  type FileFacts,
  type ReadResult,
  type SameCity,
} from '../game/transfer';
import { STORY_PACES, type StoryPace } from '../game/types';
import { HALF_H } from '../render/camera';
import { buildDialog, type UIContext } from './context';
import { h, setAttr, setClass, setHidden, setText } from './dom';
import { abbr, tickDate, tickDay } from './format';

/** Story pace labels (menu.ts PACE; kept here so the two modules don't import each other). */
const PACE_LABEL: Record<StoryPace, string> = { relaxed: 'Relaxed', normal: 'Normal', brisk: 'Brisk' };

// ── Copy (§13.6, §13.1, §13.5, §3.11) ──────────────────────────────────────

/** Export and Grow while this device holds a newer build's city (§13.1, §3.11). */
export const BLOCKED_TEXT = 'Reload to update first: this device holds a city from a newer version.';
export const TRANSFER_COPY = {
  exportRow: { label: 'Export city', desc: 'Save a copy to move or keep' },
  importRow: { label: 'Import city', desc: 'Open a city file from another device' },
  titleImport: 'Import city',
  exportTitle: 'Export city',
  importTitle: 'Import city',
  share: 'Share…',
  download: 'Download',
  copy: 'Copy as text',
  frameNote: 'If nothing downloads, use Copy as text.',
  choose: 'Choose file…',
  paste: 'Paste text',
  open: 'Open',
  replace: 'Replace city',
  /** The Import sheet's button when nothing on this device is replaced (a first launch): no confirm follows. */
  openCity: 'Open city',
  replaceOlder: 'Replace with older copy',
  cancel: 'Cancel',
  close: 'Close',
  drop: 'or drop a city file here',
  reading: 'Reading city…',
  packing: 'Packing city…',
  selectAll: 'Select all',
  iphone: 'On iPhone the Home Screen app keeps its own city: export in Safari, import in the app.',
  shared: 'City shared.',
  copied: 'City copied as text. Paste it into Import city on the other device.',
  copyBox: 'Your browser kept the clipboard closed. Select the text and copy it.',
  grow: 'Grow to 25 districts',
  growing: 'Growing the region…',
  withoutCopy: 'Replace without a copy',
  exportBtn: 'Export',
} as const;
/** About (menu.ts), replacing "Your city is saved only on this device." (§13.6). */
export const ABOUT_SAVE_LINE = 'Your city is saved on this device. Menu › Export city makes a copy you can open anywhere.';
/** How to play step 17 (§7.7, §13.6). */
export const HELP_TRANSFER = {
  title: '17 · Take your city along',
  body: 'Menu › Export city saves your city to a file. On another phone or computer, Menu › Import city opens it. On iPhone the Home Screen app keeps its own city: export in Safari, import in the app.',
} as const;

/** "Neon Bay · 2.41M · 5×5 · 7 districts" (§13.1). */
export function exportCityLine(name: string, population: number, region: number, owned: number): string {
  return `${name} · ${abbr(Math.max(0, population))} · ${region}×${region} · ${owned} ${owned === 1 ? 'district' : 'districts'}`;
}
/** The title's kept-city row (§3.10): "A newer city was kept: Neon Bay · 2.41M". */
export function keptCityLine(name: string, population: number): string {
  return `A newer city was kept: ${name || 'Unnamed city'} · ${abbr(Math.max(0, population))}`;
}
/** Its Restore confirm (§3.10): "Restore Neon Bay? Harbor Nine moves to Previous city." */
export function keptConfirm(kept: string, current: string | null): { title: string; body: string; confirmLabel: string } {
  const name = kept || 'the kept city';
  return { title: `Restore ${name}?`, body: current ? `${current} moves to Previous city.` : `${name} becomes your city on this device.`, confirmLabel: 'Restore' };
}
/** A file size the way the sheet shows it: "86 KB". */
export function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
/** "neon-bay-2026-11-24.cybercity.txt · 86 KB". */
export function fileLine(name: string, bytes: number): string {
  return `${name} · ${kb(bytes)}`;
}
/** "exported 3 days ago" (§13.1). */
export function exportedAgo(at: number, now: number): string {
  if (!Number.isFinite(at)) return '';
  const min = Math.max(0, (now - at) / 60000);
  if (min < 1) return 'exported just now';
  if (min < 60) return `exported ${Math.round(min)} min ago`;
  const hours = min / 60;
  if (hours < 24) return `exported ${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'exported yesterday' : `exported ${days} days ago`;
}
/** "Chapter III · TURF LINES", or "After Charter Night · Ironwork" once an ending holds. */
export function storyLine(chapter: number, ending: EndingId | null): string {
  if (ending && ENDINGS[ending]) return `After Charter Night · ${ENDINGS[ending].title}`;
  const ch = CHAPTERS.find((c) => c.n === chapter);
  if (!ch) return chapter >= 7 ? 'After Charter Night' : '';
  return `Chapter ${CHAPTER_NUMERALS[chapter] ?? chapter} · ${ch.title}`;
}

/** An iPhone or iPad (iPadOS reports a Mac with touch points), for the Home Screen note (§13.1). Feature-free, read once. */
export function isAppleMobile(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  return /iPhone|iPad|iPod/.test(ua) || ((/Macintosh/.test(ua) || nav.platform === 'MacIntel') && (nav.maxTouchPoints ?? 0) > 1);
}

export interface PreviewContext {
  /** The city on this device (null on a first launch with nothing to replace, and while `blocked`). */
  current: { name: string; seed: number; day: number; keeps: boolean } | null;
  /**
   * This device holds a newer build's city (saveBlocked): the city in memory is a stand-in, but the import still
   * replaces the stored newer city (kept aside in `.future`, §13.4 step 5), so it keeps its confirm.
   */
  blocked?: boolean;
  /** The city in the Previous city slot now (replaced by the current one). */
  backup: string | null;
  devicePace: StoryPace;
  /** §3.11's device class is 'handheld' (the Grow hint shows only on a PC). */
  handheld: boolean;
  /** A 5×5 city would run in lower detail here: the player's switch, else the device class (§3.11). */
  lowerDetail: boolean;
  apple: boolean;
  now: number;
}
export interface PreviewLine {
  text: string;
  kind: 'info' | 'warn' | 'good';
}
export interface ImportPreview {
  name: string;
  /** "5×5 region · 7 of 25 districts". */
  size: string;
  /** "Peak 2.41M residents". */
  peak: string;
  story: string;
  exported: string;
  lines: PreviewLine[];
  same: SameCity;
  /** The pace choice (the file's differs from the device's), with the file's selected. */
  pace: { file: StoryPace; device: StoryPace } | null;
  /**
   * The button and confirm; null for the same copy (only Close). On a device with nothing to replace (a first launch:
   * no current city, not blocked) the button reads "Open city" and opens it without a confirm: no city is at stake.
   */
  action: { label: string; confirm: { title: string; body: string; label: string } | null } | null;
}

/** The Import preview card (§13.1), from the checked file and this device; no World. */
export function importPreview(f: FileFacts, c: PreviewContext): ImportPreview {
  const lines: PreviewLine[] = [];
  const same = sameCity(f, c.current);
  if (c.current) {
    if (same === 'same') lines.push({ text: 'This is the same as the city on this device.', kind: 'info' });
    else {
      const name = c.current.name || 'your city';
      if (c.current.keeps) {
        const swap = c.backup ? ` (replacing ${c.backup} there)` : '';
        lines.push({ text: `This replaces your current city, ${name}. It moves to Previous city${swap}.`, kind: 'info' });
      } else lines.push({ text: `This replaces your current city, ${name}.`, kind: 'info' });
      // Dates as the HUD writes them; within one month, to the day, so the two never read alike.
      const [a, b] = tickDate(f.day) === tickDate(c.current.day) ? [tickDay(f.day), tickDay(c.current.day)] : [tickDate(f.day), tickDate(c.current.day)];
      if (same === 'newer') lines.push({ text: `A newer copy of ${f.city}: ${a} (this device: ${b}).`, kind: 'good' });
      else if (same === 'older') lines.push({ text: `This copy is older than the one on this device: ${a} (this device: ${b}).`, kind: 'warn' });
    }
  }
  if (f.region === 5 && c.lowerDetail) lines.push({ text: 'This is a 25-district city. On this device it runs in lower detail.', kind: 'warn' });
  if (f.region === 3 && !c.handheld) lines.push({ text: 'You can grow it to 25 districts later in Settings.', kind: 'info' });
  if (c.apple) lines.push({ text: TRANSFER_COPY.iphone, kind: 'info' });
  const pace = f.pace && f.pace !== c.devicePace && same !== 'same' ? { file: f.pace, device: c.devicePace } : null;
  const label = same === 'older' ? TRANSFER_COPY.replaceOlder : TRANSFER_COPY.replace;
  const current = c.current?.name || 'Your city';
  const body = c.current?.keeps ? `${current} moves to Previous city. ${f.city} takes its place.` : `${f.city} takes its place.`;
  const fresh = !c.current && !c.blocked;
  return {
    name: f.city,
    size: `${f.region}×${f.region} region · ${f.owned} of ${f.total} districts`,
    peak: `Peak ${abbr(f.peak)} residents`,
    story: storyLine(f.chapter, f.ending),
    exported: exportedAgo(f.exportedAt, c.now),
    lines,
    same,
    pace,
    action:
      same === 'same'
        ? null
        : fresh
          ? { label: TRANSFER_COPY.openCity, confirm: null }
          : { label, confirm: { title: 'Replace your city?', body, label: same === 'older' ? TRANSFER_COPY.replaceOlder : 'Replace' } },
  };
}

/** "Story pace: Relaxed (this device: Brisk)" (§13.1). */
export function paceLine(file: StoryPace, device: StoryPace): string {
  return `Story pace: ${PACE_LABEL[file]} (this device: ${PACE_LABEL[device]})`;
}

/**
 * The Grow confirm (§3.11), verbatim. `lowerDetail`: the grown city will run in lower detail on this device (a handheld
 * device unless the player turned the switch off; a PC whose player turned it on), so the line says so.
 */
export function growConfirm(o: { name: string; prev: string | null; lowerDetail: boolean }): { title: string; body: string; confirmLabel: string } {
  const replacing = o.prev ? ` (replacing ${o.prev} there)` : '';
  const body = `${o.name} gains 16 districts around its edge. Everything you built stays. This can't be undone: the 3×3 copy is kept as Previous city${replacing}.`;
  return { title: 'Grow to 25 districts?', body: o.lowerDetail ? `${body} On this device it runs in lower detail.` : body, confirmLabel: 'Grow' };
}

/** World px the view moves by when a 3×3 city grows: its tiles move by (64, 64), which is straight down on screen. */
export const GROW_SHIFT_Y = 64 * 2 * HALF_H;
/** The view a camera showed before growing, in the grown city's coordinates (the same tile under the centre, §3.11). */
export function keepViewAfterGrow<T extends { x: number; y: number }>(v: T): T {
  return { ...v, y: v.y + GROW_SHIFT_Y };
}

/** Copy text to the clipboard; false when there is none or the page may not use it (the sheet then shows a text box). */
export async function copyToClipboard(text: string, nav: { clipboard?: { writeText?: (t: string) => Promise<void> } } | undefined = typeof navigator !== 'undefined' ? navigator : undefined): Promise<boolean> {
  const write = nav?.clipboard?.writeText;
  if (typeof write !== 'function') return false;
  try {
    await write.call(nav!.clipboard, text);
    return true;
  } catch {
    return false;
  }
}

/** What the Export sheet can do here (§13.5): feature tests, never the user agent (except the iOS Home Screen case). */
export function readExportEnv(file: File | null): ExportEnv {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { standalone?: boolean }) | undefined;
  let canShareFiles = false;
  try {
    canShareFiles = !!file && !!nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
  } catch {
    canShareFiles = false;
  }
  let framed = false;
  try {
    framed = window.top !== window;
  } catch {
    framed = true;
  }
  const standalone = nav?.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return { handheld: deviceClass() === 'handheld', canShareFiles, framed, iosStandalone: isAppleMobile(nav) && standalone };
}

// ── Icons (24×24, stroked like icons.ts) ────────────────────────────────────

const svg = (d: string) => `<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
export const TRANSFER_ICONS = {
  export: svg('<path d="M6 3.5h8l4 4v13H6z"/><path d="M12 17v-7.5M9 12.5l3-3 3 3"/>'),
  import: svg('<path d="M6 3.5h8l4 4v13H6z"/><path d="M12 9.5V17M9 14l3 3 3-3"/>'),
  share: svg('<circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="5.5" r="2.4"/><circle cx="17.5" cy="18.5" r="2.4"/><path d="M8.1 10.8l7.3-4.1M8.1 13.2l7.3 4.1"/>'),
  download: svg('<path d="M12 3.5v11.5M7.5 10.5L12 15l4.5-4.5"/><path d="M4 16.5v4h16v-4"/>'),
  copy: svg('<path d="M8.5 8.5h11v12h-11z"/><path d="M15.5 8.5V3.5h-11v12h4"/>'),
  paste: svg('<path d="M8 4.5H5.5v16h13v-16H16"/><path d="M8.5 3h7v3h-7zM9 11h6M9 15h6"/>'),
  grow: svg('<path d="M8.5 8.5h7v7h-7z"/><path d="M3.5 8V3.5H8M16 3.5h4.5V8M20.5 16v4.5H16M8 20.5H3.5V16"/>'),
} as const;

// ── The sheets ──────────────────────────────────────────────────────────────

type ImportFrom = 'menu' | 'title';
type ImportState = 'pick' | 'paste' | 'reading' | 'preview' | 'opening';

export interface TransferHooks {
  /** The City map's state when Grow runs from it: open, and the view ✕ returns to. */
  mapView(): { open: boolean; back: { x: number; y: number; zoom: number } | null };
  /** After an import: frame the city (and, from the title, leave the title like Continue). */
  imported?(from: ImportFrom): void;
  /** Where a dropped file is imported from now (the title or the game); null while it can't be (a confirm is open). */
  dropSource?(): ImportFrom | null;
  /**
   * §13.4 step 2, "make room": the player has confirmed, so release what the swap doesn't need before the incoming city
   * is built (the first-launch title's Showcase: a second World and its renderer). Game.importCity lets go of the
   * outgoing Simulation itself once the incoming city is saved.
   */
  makeRoom?(): void;
}

export class TransferUI {
  readonly exportEl: HTMLElement;
  readonly importEl: HTMLElement;
  private readonly choiceEl: HTMLElement;
  private readonly busyEl: HTMLElement;
  hooks: TransferHooks;

  // Export
  private readonly exCity: HTMLElement;
  private readonly exFile: HTMLElement;
  private readonly exStatus: HTMLElement;
  private readonly exNote: HTMLElement;
  private readonly exBox: HTMLElement;
  private readonly exText: HTMLTextAreaElement;
  private readonly exFoot: HTMLElement;
  private exFile_: CityFile | null = null;
  private exToken = 0;

  // Import
  private readonly imPick: HTMLElement;
  private readonly imPaste: HTMLElement;
  private readonly imPasteText: HTMLTextAreaElement;
  private readonly imStatus: HTMLElement;
  private readonly imError: HTMLElement;
  private readonly imPreview: HTMLElement;
  private readonly imDrop: HTMLElement;
  private readonly imApple: HTMLElement;
  private readonly imFoot: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private imState: ImportState = 'pick';
  private imFrom: ImportFrom = 'menu';
  private imFile: Extract<ReadResult, { ok: true }> | null = null;
  private imView: ImportPreview | null = null;
  private imPace: StoryPace | null = null;
  private imToken = 0;

  // Choice + busy
  private readonly chText: HTMLElement;
  private readonly chFoot: HTMLElement;
  private readonly chTitle: HTMLElement;
  private readonly busyText: HTMLElement;

  constructor(
    private readonly ctx: UIContext,
    hooks: TransferHooks,
  ) {
    this.hooks = hooks;
    // ── Export ──
    const ex = buildDialog({ id: 'cc-export', title: TRANSFER_COPY.exportTitle, icon: TRANSFER_ICONS.export });
    this.exportEl = ex.el;
    ex.el.classList.add('cc-xfer');
    this.exCity = h('p', { class: 'cc-xfer-city' });
    this.exFile = h('p', { class: 'cc-xfer-file' });
    this.exStatus = h('p', { class: 'cc-xfer-status', role: 'status', 'aria-live': 'polite' });
    this.exNote = h('p', { class: 'cc-xfer-note', hidden: true, text: TRANSFER_COPY.frameNote });
    this.exText = h('textarea', { class: 'cc-xfer-text', readonly: true, rows: 5, spellcheck: 'false', 'aria-label': 'City file as text' });
    this.exBox = h(
      'div',
      { class: 'cc-xfer-box', hidden: true },
      h('p', { class: 'cc-xfer-note', text: TRANSFER_COPY.copyBox }),
      this.exText,
      h('button', { class: 'cc-btn', type: 'button', 'data-act': 'select-all', text: TRANSFER_COPY.selectAll }),
    );
    ex.body.append(this.exCity, this.exFile, this.exStatus, this.exNote, this.exBox);
    this.exFoot = ex.foot;
    ex.foot.hidden = false;
    ex.foot.classList.add('cc-xfer-foot');
    ex.el.addEventListener('click', this.onExportClick);

    // ── Import ──
    const im = buildDialog({ id: 'cc-import', title: TRANSFER_COPY.importTitle, icon: TRANSFER_ICONS.import });
    this.importEl = im.el;
    im.el.classList.add('cc-xfer');
    this.fileInput = h('input', { class: 'cc-xfer-input', type: 'file', accept: FILE_ACCEPT, tabindex: '-1', 'aria-hidden': 'true' });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.read(f);
    });
    this.imDrop = h('div', { class: 'cc-xfer-drop', hidden: true, text: TRANSFER_COPY.drop });
    this.imApple = h('p', { class: 'cc-xfer-note', hidden: true, text: TRANSFER_COPY.iphone });
    this.imPick = h(
      'div',
      { class: 'cc-xfer-pick' },
      h('button', { class: 'cc-btn is-primary cc-xfer-big', type: 'button', 'data-act': 'choose', html: TRANSFER_ICONS.import }, TRANSFER_COPY.choose),
      h('button', { class: 'cc-btn', type: 'button', 'data-act': 'paste', html: TRANSFER_ICONS.paste }, TRANSFER_COPY.paste),
      this.imDrop,
      this.imApple,
    );
    this.imPasteText = h('textarea', { class: 'cc-xfer-text', rows: 5, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'City file text', placeholder: 'CYBERCITY 1 …' });
    this.imPaste = h(
      'div',
      { class: 'cc-xfer-paste', hidden: true },
      this.imPasteText,
      h('button', { class: 'cc-btn is-primary', type: 'button', 'data-act': 'open-text', text: TRANSFER_COPY.open }),
    );
    this.imStatus = h('p', { class: 'cc-xfer-status', role: 'status', 'aria-live': 'polite', hidden: true });
    this.imError = h('p', { class: 'cc-xfer-error', role: 'alert', hidden: true });
    this.imPreview = h('div', { class: 'cc-xfer-preview', hidden: true });
    im.body.append(this.imError, this.imPick, this.imPaste, this.imStatus, this.imPreview, this.fileInput);
    this.imFoot = im.foot;
    im.foot.classList.add('cc-xfer-foot');
    im.el.addEventListener('click', this.onImportClick);
    for (const ev of ['dragenter', 'dragover'] as const)
      this.imDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        setClass(this.imDrop, 'is-over', true);
      });
    this.imDrop.addEventListener('dragleave', () => setClass(this.imDrop, 'is-over', false));

    // ── Choice (copy refused) and busy ──
    const ch = buildDialog({ id: 'cc-xfer-choice', title: '' });
    this.choiceEl = ch.el;
    ch.el.classList.add('cc-xfer');
    this.chTitle = ch.title;
    this.chText = h('p', { class: 'cc-confirm-text' });
    ch.body.append(this.chText);
    this.chFoot = ch.foot;
    ch.foot.hidden = false;
    ch.foot.classList.add('cc-xfer-foot');
    ch.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.ctx.modals.close(this.choiceEl);
    });
    const busy = buildDialog({ id: 'cc-xfer-busy', title: '' });
    this.busyEl = busy.el;
    busy.el.classList.add('cc-xfer', 'cc-xfer-busydlg');
    busy.closeBtn.hidden = true;
    this.busyText = h('p', { class: 'cc-xfer-busy', role: 'status', 'aria-live': 'polite' });
    busy.body.append(this.busyText);
    busy.head.hidden = true;

    for (const el of [this.exportEl, this.importEl, this.choiceEl, this.busyEl]) this.ctx.modals.layer.append(el);
    this.wireDrop();
  }

  // ── Export ────────────────────────────────────────────────────────────────

  /** Menu › Export city (and the storage-full toast's Export action). */
  openExport(): void {
    const { game, modals } = this.ctx;
    const token = ++this.exToken;
    this.exFile_ = null;
    setHidden(this.exBox, true);
    setHidden(this.exNote, true);
    this.exFoot.textContent = '';
    const w = game.world;
    setText(this.exCity, exportCityLine(w.cityName, w.stats.population, w.region, w.districts.owned.length));
    setText(this.exFile, '');
    modals.open(this.exportEl, () => {
      if (this.exToken === token) this.exToken++;
      this.exFile_ = null;
    });
    if (game.saveBlocked) {
      setText(this.exStatus, BLOCKED_TEXT);
      this.exFoot.append(h('button', { class: 'cc-btn is-ghost', type: 'button', 'data-close': true, text: TRANSFER_COPY.close }));
      return;
    }
    const data = game.exportCity();
    if (!data) {
      setText(this.exStatus, BLOCKED_TEXT);
      return;
    }
    setText(this.exStatus, TRANSFER_COPY.packing);
    void buildCityFile(data.json, data.data).then((file) => {
      if (token !== this.exToken) return;
      this.exFile_ = file;
      setText(this.exFile, fileLine(file.name, file.size));
      setText(this.exStatus, '');
      this.renderExportActions(file);
    });
  }

  private renderExportActions(file: CityFile): void {
    let shareable: File | null = null;
    try {
      shareable = new File([file.text], file.name, { type: 'text/plain' });
    } catch {
      shareable = null;
    }
    const plan = exportPlan(readExportEnv(shareable));
    setHidden(this.exNote, !plan.frameNote);
    const label: Record<ExportAction, string> = { share: TRANSFER_COPY.share, download: TRANSFER_COPY.download, copy: TRANSFER_COPY.copy };
    const ico: Record<ExportAction, string> = { share: TRANSFER_ICONS.share, download: TRANSFER_ICONS.download, copy: TRANSFER_ICONS.copy };
    this.exFoot.textContent = '';
    plan.actions.forEach((a, i) => {
      const b = h('button', { class: `cc-btn${i === 0 ? ' is-primary cc-xfer-big' : ''}`, type: 'button', 'data-act': a, 'data-autofocus': i === 0 ? true : null, html: ico[a] }, label[a]);
      this.exFoot.append(b);
    });
    this.shareFile = shareable;
  }
  private shareFile: File | null = null;

  private readonly onExportClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) {
      this.ctx.modals.close(this.exportEl);
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const file = this.exFile_;
    if (!act) return;
    if (act === 'select-all') {
      this.exText.focus();
      this.exText.select();
      return;
    }
    if (!file) return;
    if (act === 'share') this.share(file);
    else if (act === 'download') this.download(file);
    else if (act === 'copy') void this.copy(file);
  };

  /** The system share sheet, inside the tap (§13.5). Cancelled: nothing; refused: the text box. */
  private share(file: CityFile): void {
    const nav = navigator as Navigator;
    const f = this.shareFile;
    if (!f || typeof nav.share !== 'function') {
      this.showCopyBox(file);
      return;
    }
    nav.share({ files: [f], title: file.name }).then(
      () => this.ctx.game.toast(TRANSFER_COPY.shared, 'good'),
      (err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        this.showCopyBox(file);
      },
    );
  }

  /** The browser's download (`<a download>` on a blob URL, revoked after 60 s). */
  private download(file: CityFile): void {
    try {
      const url = URL.createObjectURL(new Blob([file.text], { type: FILE_TYPE }));
      const a = h('a', { href: url, download: file.name, rel: 'noopener', hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      this.ctx.game.toast(`Saved ${file.name}`, 'good');
    } catch {
      this.showCopyBox(file);
    }
  }

  private async copy(file: CityFile): Promise<void> {
    if (await copyToClipboard(file.text)) this.ctx.game.toast(TRANSFER_COPY.copied, 'good');
    else this.showCopyBox(file);
  }

  /** Clipboard refused: a read-only text box with all the text selected, and Select all (§13.1). */
  private showCopyBox(file: CityFile): void {
    this.exText.value = file.text;
    setHidden(this.exBox, false);
    try {
      this.exText.focus({ preventScroll: true });
      this.exText.select();
      this.exBox.scrollIntoView({ block: 'nearest' });
    } catch {
      /* old browsers */
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────

  /** Menu › Import city, or the title's Import city (`from`). */
  openImport(from: ImportFrom = 'menu', file?: File): void {
    this.imFrom = from;
    this.imFile = null;
    this.imView = null;
    this.imPasteText.value = '';
    this.imToken++;
    this.setImport('pick');
    setHidden(this.imError, true);
    const desk = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    setHidden(this.imDrop, !desk);
    setHidden(this.imApple, !isAppleMobile(typeof navigator !== 'undefined' ? navigator : undefined));
    this.ctx.modals.open(this.importEl, () => {
      // Cancel frees everything: nothing was built (§13.3).
      this.imToken++;
      this.imFile = null;
      this.imView = null;
    });
    if (file) void this.read(file);
  }

  private setImport(s: ImportState): void {
    this.imState = s;
    setHidden(this.imPick, s !== 'pick');
    setHidden(this.imPaste, s !== 'paste');
    setHidden(this.imStatus, s !== 'reading' && s !== 'opening');
    setHidden(this.imPreview, s !== 'preview' && s !== 'opening');
    setClass(this.importEl, 'is-busy', s === 'reading' || s === 'opening');
    for (const b of this.importEl.querySelectorAll<HTMLButtonElement>('button[data-act]')) b.disabled = s === 'reading' || s === 'opening';
    this.renderImportFoot();
  }

  private renderImportFoot(): void {
    const f = this.imFoot;
    f.textContent = '';
    const s = this.imState;
    const v = this.imView;
    const busy = s === 'reading' || s === 'opening';
    if (s === 'preview' || s === 'opening') {
      if (v?.action) {
        f.append(
          h('button', { class: 'cc-btn is-ghost', type: 'button', 'data-act': 'cancel', disabled: busy, text: TRANSFER_COPY.cancel }),
          h('button', { class: 'cc-btn is-primary cc-xfer-big', type: 'button', 'data-act': 'replace', 'data-autofocus': true, disabled: busy, text: v.action.label }),
        );
      } else f.append(h('button', { class: 'cc-btn is-primary', type: 'button', 'data-act': 'cancel', disabled: busy, text: TRANSFER_COPY.close }));
    } else f.append(h('button', { class: 'cc-btn is-ghost', type: 'button', 'data-act': 'cancel', disabled: busy, text: TRANSFER_COPY.cancel }));
    f.hidden = false;
  }

  /** Read and check a file (§13.3); the first failure shows in the sheet, a readable file shows the preview card. */
  private async read(input: File | string): Promise<void> {
    const token = ++this.imToken;
    setHidden(this.imError, true);
    setText(this.imStatus, TRANSFER_COPY.reading);
    const back: ImportState = typeof input === 'string' ? 'paste' : 'pick';
    this.setImport('reading');
    const r = await readCityFile(input);
    if (token !== this.imToken) return;
    if (!r.ok) {
      setText(this.imError, r.message);
      setHidden(this.imError, false);
      this.setImport(back);
      return;
    }
    this.showPreview(r);
  }

  private showPreview(r: Extract<ReadResult, { ok: true }>): void {
    const { game } = this.ctx;
    const w = game.world;
    // The city this replaces: the one in play (from the menu), or the title's city when it has any progress. While
    // saveBlocked the city in memory is a stand-in (the newer one stays kept aside in `.future`, §13.4).
    const keeps = game.hasProgress;
    const current = !game.saveBlocked && (this.imFrom === 'menu' || keeps) ? { name: w.cityName, seed: w.seed, day: w.tick, keeps } : null;
    const facts = fileFacts(r);
    const view = importPreview(facts, {
      current,
      blocked: game.saveBlocked,
      backup: game.previousSaveInfo()?.cityName ?? null,
      devicePace: game.settings.storyPace,
      handheld: deviceClass() === 'handheld',
      lowerDetail: lowerDetailHere(game.settings.lowerDetail),
      apple: false, // the note sits under the buttons already (openImport)
      now: Date.now(),
    });
    this.imFile = r;
    this.imView = view;
    this.imPace = view.pace ? view.pace.file : null;
    const p = this.imPreview;
    p.textContent = '';
    p.append(
      h('h3', { class: 'cc-xfer-name', text: view.name }),
      h('p', { class: 'cc-xfer-meta', text: [view.size, view.peak].join(' · ') }),
      h('p', { class: 'cc-xfer-meta', text: [view.story, view.exported].filter(Boolean).join(' · ') }),
    );
    for (const l of view.lines) p.append(h('p', { class: `cc-xfer-line is-${l.kind}`, text: l.text }));
    if (view.pace) {
      const seg = h('div', { class: 'cc-seg cc-xfer-pace', role: 'radiogroup', 'aria-label': 'Story pace' });
      for (const pc of [view.pace.file, view.pace.device]) {
        const on = pc === this.imPace;
        seg.append(h('button', { class: `cc-seg-btn${on ? ' is-on' : ''}`, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-pace': pc, text: PACE_LABEL[pc] }));
      }
      p.append(h('p', { class: 'cc-xfer-line', text: paceLine(view.pace.file, view.pace.device) }), seg);
    }
    this.setImport('preview');
  }

  private readonly onImportClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) {
      this.ctx.modals.close(this.importEl);
      return;
    }
    const pace = t.closest<HTMLElement>('[data-pace]');
    if (pace && this.imView?.pace) {
      const v = pace.dataset.pace as StoryPace;
      if (!(STORY_PACES as readonly string[]).includes(v)) return;
      this.imPace = v;
      for (const b of this.imPreview.querySelectorAll<HTMLElement>('[data-pace]')) {
        const on = b.dataset.pace === v;
        setClass(b, 'is-on', on);
        setAttr(b, 'aria-checked', on ? 'true' : 'false');
      }
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act || this.imState === 'reading' || this.imState === 'opening') return;
    if (act === 'choose') this.fileInput.click();
    else if (act === 'paste') {
      setHidden(this.imError, true);
      this.setImport('paste');
      try {
        this.imPasteText.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    } else if (act === 'open-text') {
      const text = this.imPasteText.value;
      if (text.trim()) void this.read(text);
    } else if (act === 'cancel') this.ctx.modals.close(this.importEl);
    else if (act === 'replace') this.confirmReplace();
  };

  /** Replace city → the confirm (§13.6), then "Opening Neon Bay…" and the import (§13.4). */
  private confirmReplace(): void {
    const v = this.imView;
    if (!v?.action) return;
    const c = v.action.confirm;
    // Nothing on this device is replaced (a first launch): open it straight away.
    if (!c) {
      this.runImport(false);
      return;
    }
    this.ctx.actions.confirm({ title: c.title, body: c.body, confirmLabel: c.label, onConfirm: () => this.runImport(false) });
  }

  private runImport(withoutCopy: boolean): void {
    const r = this.imFile;
    const v = this.imView;
    if (!r || !v) return;
    const { game, modals } = this.ctx;
    setText(this.imStatus, `Opening ${v.name}…`);
    this.setImport('opening');
    const token = this.imToken;
    afterPaint(() => {
      if (token !== this.imToken) return;
      this.hooks.makeRoom?.();
      // The preview's pace choice; without one (the file's pace is this device's, or it has none) the city's own.
      const ok = game.importCity(r.save, this.imPace ?? undefined, { replaceWithoutCopy: withoutCopy });
      if (ok) {
        const from = this.imFrom;
        this.imFile = null;
        this.imView = null;
        modals.closeAll();
        game.toast(`Imported ${game.world.cityName}.`, 'good');
        this.hooks.imported?.(from);
        return;
      }
      this.setImport('preview');
      if (game.swapFailed === 'copy') {
        this.choose(TRANSFER_COPY.importTitle, game.keepCopyText ?? `Couldn't keep a copy of ${game.world.cityName}.`, () => this.runImport(true));
        return;
      }
      setText(this.imError, game.swapFailed === 'save' ? STORAGE_FULL_TEXT : TRANSFER_TEXT.incompatible);
      setHidden(this.imError, false);
    });
  }

  // ── The copy-refused choice (§3.10: Export and Replace without a copy) ────

  private choose(title: string, text: string, withoutCopy: () => void): void {
    setText(this.chTitle, title);
    setText(this.chText, text);
    const f = this.chFoot;
    f.textContent = '';
    const exp = h('button', { class: 'cc-btn is-primary', type: 'button', html: TRANSFER_ICONS.export }, TRANSFER_COPY.exportBtn);
    const without = h('button', { class: 'cc-btn is-danger-ghost', type: 'button', text: TRANSFER_COPY.withoutCopy });
    exp.addEventListener('click', () => {
      this.ctx.modals.close(this.choiceEl);
      this.openExport();
    });
    without.addEventListener('click', () => {
      this.ctx.modals.close(this.choiceEl);
      withoutCopy();
    });
    f.append(without, exp);
    this.ctx.modals.open(this.choiceEl);
  }

  // ── Grow to 25 districts (§3.11) ──────────────────────────────────────────

  /** The Grow button (Settings' City line, the City map's edge line): the confirm, then the busy state and the swap. */
  grow(from: 'settings' | 'map'): void {
    const { game, actions } = this.ctx;
    if (!game.canGrow) {
      if (game.saveBlocked) game.toast(BLOCKED_TEXT, 'error');
      return;
    }
    const c = growConfirm({ name: game.world.cityName, prev: game.previousSaveInfo()?.cityName ?? null, lowerDetail: lowerDetailHere(game.settings.lowerDetail) });
    actions.confirm({ title: c.title, body: c.body, confirmLabel: c.confirmLabel, onConfirm: () => this.runGrow(from, false) });
  }

  private runGrow(from: 'settings' | 'map', withoutCopy: boolean): void {
    const { game, camera, modals, actions } = this.ctx;
    const map = this.hooks.mapView();
    const before = map.open && map.back ? map.back : { x: camera.x, y: camera.y, zoom: camera.zoom };
    setText(this.busyText, TRANSFER_COPY.growing);
    modals.open(this.busyEl);
    afterPaint(() => {
      const ok = game.growRegion({ replaceWithoutCopy: withoutCopy });
      modals.close(this.busyEl);
      if (ok) {
        // The view keeps its place: the same tile under the centre, now 64 tiles further in on each axis.
        const v = keepViewAfterGrow(before);
        camera.easeTo(v.x, v.y, v.zoom, 0);
        if (from === 'map' || map.open) actions.openCityMap(null);
        return;
      }
      if (game.swapFailed === 'copy')
        this.choose(TRANSFER_COPY.grow, game.keepCopyText ?? `Couldn't keep a copy of ${game.world.cityName}.`, () => this.runGrow(from, true));
      else if (game.swapFailed !== 'save') game.toast('The city could not grow. It is unchanged.', 'error');
    });
  }

  // ── Drag and drop on a desktop (§13.5, optional) ─────────────────────────

  private wireDrop(): void {
    if (typeof window === 'undefined') return;
    const desk = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...(e.dataTransfer.types ?? [])].includes('Files');
    window.addEventListener('dragover', (e) => {
      if (!desk() || !hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', (e) => {
      if (!desk() || !hasFiles(e)) return;
      e.preventDefault();
      setClass(this.imDrop, 'is-over', false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const { modals } = this.ctx;
      if (modals.isOpen(this.importEl)) {
        if (this.imState === 'pick' || this.imState === 'paste' || this.imState === 'preview') void this.read(file);
        return;
      }
      const from = this.hooks.dropSource ? this.hooks.dropSource() : 'menu';
      if (!from) return;
      this.openImport(from, file);
    });
  }
}

/**
 * Would a 5×5 city run in lower detail on this device (§3.11)? The player's switch when set, else the device class
 * (the value Game writes once on the first 5×5 load).
 */
export function lowerDetailHere(setting: boolean | undefined, cls: 'pc' | 'handheld' = deviceClass()): boolean {
  return setting ?? cls === 'handheld';
}

/** Run `fn` once the current state has painted (two frames), so a busy line shows before a long synchronous step. */
function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}
