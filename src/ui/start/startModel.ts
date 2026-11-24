// ─────────────────────────────────────────────────────────────────────────────
// Start screen logic with no DOM: which buttons the title shows, the Continue
// card's text, the New City note, the boot hold and the backdrop drift.
// The DOM side (startScreen.ts) and main.ts read these; tests cover them.
//
//   title ──New City──▶ setup ──✕ / Esc──▶ title
//     │                   │
//     └──Continue─────────┴──Found city──▶ leaving ──fade done──▶ play
//   play ──menu › Main menu──▶ title
//
// While the phase is not 'play' the game is held: no game.update (so nothing
// in the story advances, not even its real-time timers), no autosave, story
// surfaces and toasts wait. They resume, unchanged, once the fade is done.
// ─────────────────────────────────────────────────────────────────────────────

export type StartPhase = 'title' | 'setup' | 'leaving' | 'play';

/** Fade from the title into the city (ms); instant with reduced motion. */
export const LEAVE_MS = 380;

/** What the title offers for the slots on this device. */
export interface StartSlots {
  /** A city to continue: a save on this device, a restored hot-reload snapshot, or the city played this session. */
  hasCity: boolean;
  /** "New City" left a previous city in the backup slot. */
  hasBackup: boolean;
}

export interface StartButtons {
  /** Continue card and button (the primary when shown). */
  continue: boolean;
  /** New City is the 52 px primary (first launch); otherwise a 44 px secondary. */
  newPrimary: boolean;
  /** Small "Previous city" text button. */
  previous: boolean;
  /** What Enter does on the title. */
  primary: 'continue' | 'new';
}

export function startButtons(s: StartSlots): StartButtons {
  return {
    continue: s.hasCity,
    newPrimary: !s.hasCity,
    previous: s.hasBackup,
    primary: s.hasCity ? 'continue' : 'new',
  };
}

/** The live story numbers the Continue card shows (a slice of StoryView). */
export interface StorySlice {
  n: number;
  numeral: string;
  title: string;
  phase: string;
  /** An ending has been chosen (StoryView.ending). */
  ended: boolean;
}

export interface CitySummaryInput {
  cityName: string;
  /** World.dateLabel(), e.g. "MAR 2093". */
  date: string;
  population: number;
  story: StorySlice | null;
}

export interface CitySummary {
  name: string;
  /** "MAR 2093 · 1,204 residents". */
  meta: string;
  /** "Chapter III · TURF LINES", "Sandbox" after an ending, '' when unknown. */
  chapter: string;
  /** For the kicker's colour: 'story' or 'sandbox'. */
  kind: 'story' | 'sandbox' | 'none';
}

const groupInt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function residents(n: number): string {
  const p = Math.max(0, Math.round(n || 0));
  if (p === 0) return 'no residents yet';
  return p === 1 ? '1 resident' : `${groupInt(p)} residents`;
}

export function chapterLine(s: StorySlice | null): { text: string; kind: CitySummary['kind'] } {
  if (!s) return { text: '', kind: 'none' };
  if (s.ended || s.phase === 'ended' || s.n >= 7) return { text: 'Sandbox', kind: 'sandbox' };
  if (!s.numeral) return { text: '', kind: 'none' };
  const title = s.title.trim();
  return { text: title ? `Chapter ${s.numeral} · ${title}` : `Chapter ${s.numeral}`, kind: 'story' };
}

export function citySummary(i: CitySummaryInput): CitySummary {
  const ch = chapterLine(i.story);
  return {
    name: i.cityName.trim() || 'Unnamed city',
    meta: `${i.date} · ${residents(i.population)}`,
    chapter: ch.text,
    kind: ch.kind,
  };
}

/** Does a city have progress worth a backup? Mirrors Game.newCity's own check (game.ts worthKeeping). */
export function worthKeeping(w: { tick: number; buildingCount: number; tiles: ArrayLike<{ road: boolean; zone: number }> }): boolean {
  if (w.tick > 0 || w.buildingCount > 0) return true;
  for (let i = 0; i < w.tiles.length; i++) {
    const t = w.tiles[i];
    if (t.road || t.zone !== 0) return true;
  }
  return false;
}

/**
 * The New City sheet's line about the city it replaces ('' when nothing is replaced).
 * Game.newCity backs up the current city only when it has progress, and that
 * replaces whatever was in the backup slot before.
 */
export function replaceNote(o: { current: string | null; keeps: boolean; backup: string | null }): string {
  if (!o.current || !o.keeps) return '';
  const name = o.current.trim() || 'Your current city';
  const swap = o.backup ? ` It replaces ${o.backup.trim() || 'the city'} there.` : '';
  return `${name} moves to the backup slot.${swap} "Previous city" on this screen brings it back.`;
}

/** Story pace choices on the New City sheet: same ids and meaning as Settings › Story pace. */
export const PACE_CHOICES = ['relaxed', 'normal', 'brisk'] as const;

/**
 * The title's phase machine. Every transition returns whether it happened, so a
 * double tap (or Enter during the fade) can never run an action twice.
 */
export class StartFlow {
  phase: StartPhase;

  constructor(phase: StartPhase = 'title') {
    this.phase = phase;
  }

  /** The game is held: no game.update, no autosave, story surfaces and toasts wait. */
  get holding(): boolean {
    return this.phase !== 'play';
  }

  /** The title (or its setup sheet) takes input; false while fading out and in play. */
  get interactive(): boolean {
    return this.phase === 'title' || this.phase === 'setup';
  }

  /** The backdrop camera drifts (title, setup sheet and the fade). */
  get drifting(): boolean {
    return this.phase !== 'play';
  }

  openSetup(): boolean {
    if (this.phase !== 'title') return false;
    this.phase = 'setup';
    return true;
  }

  closeSetup(): boolean {
    if (this.phase !== 'setup') return false;
    this.phase = 'title';
    return true;
  }

  /** Continue, Found city or Previous city: start the fade. */
  leave(): boolean {
    if (!this.interactive) return false;
    this.phase = 'leaving';
    return true;
  }

  /** The fade is done: the game runs again. */
  finish(): boolean {
    if (this.phase !== 'leaving') return false;
    this.phase = 'play';
    return true;
  }

  /** In-game menu › Main menu. */
  show(): boolean {
    if (this.phase !== 'play') return false;
    this.phase = 'title';
    return true;
  }
}

/**
 * Slow backdrop drift, world px at zoom 1: a wide Lissajous loop around the
 * framed view, 0 at t = 0 so the first frame matches the framing exactly.
 */
export function driftOffset(t: number, amp = 90): { x: number; y: number } {
  if (!(t > 0)) return { x: 0, y: 0 };
  // Ease in over the first few seconds so the motion starts from rest.
  const ease = Math.min(1, t / 6);
  const e = ease * ease * (3 - 2 * ease);
  return {
    x: Math.sin(t * 0.061) * amp * e,
    y: Math.sin(t * 0.043 + Math.PI) * -amp * 0.45 * e,
  };
}

/** What a key press on the title does (the DOM layer applies it). */
export type StartKeyAction = 'primary' | 'close-setup' | 'click-target' | 'block' | 'pass';

export function startKey(o: {
  key: string;
  phase: StartPhase;
  /** A dialog (Settings, How to play, About, the confirm) is open over the title. */
  modal: boolean;
  /** The focused element is a button inside the start screen. */
  onButton: boolean;
  /** The focused element is a text field. */
  typing: boolean;
  repeat?: boolean;
}): StartKeyAction {
  if (o.phase === 'play') return 'pass';
  if (o.key === 'Tab') return 'pass';
  // Dialogs over the title handle their own keys (the UI root); still keep game hotkeys off.
  if (o.modal) return o.key === 'Escape' || o.key === 'Esc' || o.key.startsWith('Arrow') ? 'pass' : 'block';
  if (o.phase === 'leaving') return 'block';
  if (o.key === 'Escape' || o.key === 'Esc') return o.phase === 'setup' ? 'close-setup' : 'block';
  if (o.typing) return o.key === 'Enter' ? (o.repeat ? 'block' : 'primary') : 'pass';
  if (o.key === 'Enter' || o.key === ' ' || o.key === 'Spacebar') {
    if (o.repeat) return 'block';
    if (o.onButton) return 'click-target';
    return o.key === 'Enter' ? 'primary' : 'block';
  }
  return 'block';
}

/**
 * What the stored save turned out to be at boot: none, the city the Game loaded,
 * or a save the Game could not read (corrupt JSON, an incompatible version). The
 * Game starts a fresh random city in that last case, so it compares the stored
 * seed and day with the world it ended up with.
 */
export type SaveState = 'none' | 'loaded' | 'unreadable';

export function saveState(raw: string | null, world: { seed: number; tick: number }): SaveState {
  if (raw === null) return 'none';
  try {
    const d = JSON.parse(raw) as { seed?: unknown; tick?: unknown } | null;
    if (!d || typeof d !== 'object') return 'unreadable';
    return Number(d.seed) >>> 0 === world.seed && (Number(d.tick) | 0) === world.tick ? 'loaded' : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/**
 * A one-shot timer that stops while the title holds the game. Held while it runs,
 * it is owed instead, and starts again in full when the hold ends: the boot
 * "where you left off" toast always follows the same real seconds of play, so it
 * never reads goals the story has not checked yet.
 */
export class HeldTimer {
  private id: ReturnType<typeof setTimeout> | null = null;
  private owed = false;
  private held = false;

  constructor(
    private readonly ms: number,
    private readonly fn: () => void,
  ) {}

  /** Due (running or owed). */
  get pending(): boolean {
    return this.id !== null || this.owed;
  }

  /** (Re)start the countdown; while held it starts when the hold ends. */
  schedule(): void {
    this.clear();
    if (this.held) {
      this.owed = true;
      return;
    }
    this.id = setTimeout(() => {
      this.id = null;
      this.fn();
    }, this.ms);
  }

  hold(on: boolean): void {
    if (this.held === on) return;
    this.held = on;
    if (on) {
      if (this.id !== null) {
        this.clear();
        this.owed = true;
      }
    } else if (this.owed) {
      this.owed = false;
      this.schedule();
    }
  }

  cancel(): void {
    this.clear();
    this.owed = false;
  }

  private clear(): void {
    if (this.id !== null) clearTimeout(this.id);
    this.id = null;
  }
}

/** Where the page runs, for the optional "Add to Home Screen" tip. */
export interface HintEnv {
  /** Touch-first device ((pointer: coarse)). */
  coarse: boolean;
  /** Already installed (display-mode standalone / fullscreen, or iOS navigator.standalone). */
  standalone: boolean;
  /** Top-level page (not inside an iframe, e.g. the single-file artifact). */
  topLevel: boolean;
  /** The player closed the tip before (or storage cannot remember it). */
  dismissed: boolean;
  ios: boolean;
  /** Served over http(s) (not file://), so it can be installed. */
  web: boolean;
  /** A returning player (a city to continue at boot): never on the very first launch. */
  returning: boolean;
}

/** One-line install tip, or null when it does not apply. */
export function a2hsHint(e: HintEnv): string | null {
  if (!e.returning || !e.coarse || e.standalone || !e.topLevel || e.dismissed || !e.web) return null;
  return e.ios ? 'Full screen: Share › Add to Home Screen' : 'Full screen: menu › Add to Home screen';
}
