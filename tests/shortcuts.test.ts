// MEGACITY §14.3 / §14.5 item 4: every key on US, AZERTY and QWERTZ `key` / `code` pairs; `?` never zooms or opens
// the City map; Ctrl / Cmd+Z undoes on all three; the ? sheet lists exactly the bound keys; key hints only on the
// desktop layout or after a hardware key press, never after a virtual keyboard's keydown or in a text field.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KeyboardInput,
  SHORTCUTS,
  TRAY_KEYS,
  isHardwareKey,
  keyBus,
  resolveKey,
  type KeyAction,
  type KeyLike,
} from '../src/input/keyboard';
import { CARD_KEYS, CATEGORY_KEYS, SHORTCUT_GROUPS, cardKey, categoryKey, keyHintsShown, rowKeys, setKeyLayout, shortcutSheet } from '../src/ui/shortcuts';
import { HELP_SHORTCUTS_SENTENCE } from '../src/ui/menu';
import { CATEGORIES } from '../src/ui/tools';

type Layout = 'US' | 'AZERTY' | 'QWERTZ';

/** What pressing a physical key gives on each layout: [code, key, key with Shift]. */
const PHYS: Record<Layout, Record<string, [string, string]>> = {
  US: {
    KeyW: ['w', 'W'], KeyA: ['a', 'A'], KeyS: ['s', 'S'], KeyD: ['d', 'D'], KeyZ: ['z', 'Z'], KeyY: ['y', 'Y'], KeyQ: ['q', 'Q'],
    KeyB: ['b', 'B'], KeyR: ['r', 'R'], KeyX: ['x', 'X'], KeyC: ['c', 'C'], KeyE: ['e', 'E'], KeyV: ['v', 'V'], KeyT: ['t', 'T'],
    KeyF: ['f', 'F'], KeyO: ['o', 'O'], KeyM: ['m', 'M'], KeyG: ['g', 'G'], KeyU: ['u', 'U'], Semicolon: [';', ':'],
    Minus: ['-', '_'], Equal: ['=', '+'], Slash: ['/', '?'], BracketRight: [']', '}'], Digit6: ['6', '^'],
    Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'],
  },
  // French AZERTY: A↔Q, Z↔W, M on the Semicolon key, ? on Shift + the KeyM key, - on Digit6, digits shifted.
  AZERTY: {
    KeyW: ['z', 'Z'], KeyA: ['q', 'Q'], KeyS: ['s', 'S'], KeyD: ['d', 'D'], KeyZ: ['w', 'W'], KeyY: ['y', 'Y'], KeyQ: ['a', 'A'],
    KeyB: ['b', 'B'], KeyR: ['r', 'R'], KeyX: ['x', 'X'], KeyC: ['c', 'C'], KeyE: ['e', 'E'], KeyV: ['v', 'V'], KeyT: ['t', 'T'],
    KeyF: ['f', 'F'], KeyO: ['o', 'O'], KeyM: [',', '?'], KeyG: ['g', 'G'], KeyU: ['u', 'U'], Semicolon: ['m', 'M'],
    Minus: [')', '°'], Equal: ['=', '+'], Slash: ['!', '§'], BracketRight: ['$', '£'], Digit6: ['-', '6'],
    Digit1: ['&', '1'], Digit2: ['é', '2'], Digit3: ['"', '3'],
  },
  // German QWERTZ: Y↔Z, ? on Shift + the Minus key (ß), - on the Slash key, + on BracketRight.
  QWERTZ: {
    KeyW: ['w', 'W'], KeyA: ['a', 'A'], KeyS: ['s', 'S'], KeyD: ['d', 'D'], KeyZ: ['y', 'Y'], KeyY: ['z', 'Z'], KeyQ: ['q', 'Q'],
    KeyB: ['b', 'B'], KeyR: ['r', 'R'], KeyX: ['x', 'X'], KeyC: ['c', 'C'], KeyE: ['e', 'E'], KeyV: ['v', 'V'], KeyT: ['t', 'T'],
    KeyF: ['f', 'F'], KeyO: ['o', 'O'], KeyM: ['m', 'M'], KeyG: ['g', 'G'], KeyU: ['u', 'U'], Semicolon: ['ö', 'Ö'],
    Minus: ['ß', '?'], Equal: ['Dead', 'Dead'], Slash: ['-', '_'], BracketRight: ['+', '*'], Digit6: ['6', '&'],
    Digit1: ['1', '!'], Digit2: ['2', '"'], Digit3: ['3', '§'],
  },
};

const LAYOUTS: Layout[] = ['US', 'AZERTY', 'QWERTZ'];

function press(layout: Layout, code: string, mods: Partial<KeyLike> = {}): KeyLike {
  const named: Record<string, string> = { Space: ' ', Escape: 'Escape', Enter: 'Enter', NumpadEnter: 'Enter', ArrowUp: 'ArrowUp', ArrowLeft: 'ArrowLeft', NumpadAdd: '+', NumpadSubtract: '-' };
  const pair = PHYS[layout][code];
  const key = named[code] ?? (pair ? (mods.shiftKey ? pair[1] : pair[0]) : '');
  return { key, code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods };
}

/** Where each action's key sits on each layout (the code to press, and Shift). Clusters by position; mnemonics by letter. */
function keyFor(layout: Layout, a: KeyAction): { code: string; shift?: boolean } {
  const letterCode = (ch: string): string => {
    for (const [code, [k]] of Object.entries(PHYS[layout])) if (k === ch) return code;
    throw new Error(`${layout} has no ${ch}`);
  };
  switch (a) {
    case 'pan':
      return { code: 'KeyW' };
    case 'zoomIn':
      return { code: 'Equal', shift: layout !== 'QWERTZ' };
    case 'zoomOut':
      return { code: layout === 'US' ? 'Minus' : layout === 'AZERTY' ? 'Digit6' : 'Slash' };
    case 'pause':
      return { code: 'Space' };
    case 'speed1':
      return { code: 'Digit1' };
    case 'speed2':
      return { code: 'Digit2' };
    case 'speed3':
      return { code: 'Digit3' };
    case 'escape':
      return { code: 'Escape' };
    case 'confirm':
      return { code: 'Enter' };
    case 'bulldoze':
      return { code: 'KeyB' };
    case 'road':
      return { code: 'KeyR' };
    case 'res':
      return { code: 'KeyZ' };
    case 'com':
      return { code: 'KeyX' };
    case 'ind':
      return { code: 'KeyC' };
    case 'infra':
      return { code: 'KeyE' };
    case 'civic':
      return { code: 'KeyV' };
    case 'sky':
      return { code: 'KeyT' };
    case 'deals':
      return { code: 'KeyF' };
    case 'overlay':
      return { code: 'KeyO' };
    case 'overlayBack':
      return { code: 'KeyO', shift: true };
    case 'map':
      return { code: letterCode('m') };
    case 'goals':
      return { code: letterCode('g') };
    case 'undo':
      return { code: letterCode('u') };
    case 'shortcuts':
      return { code: layout === 'US' ? 'Slash' : layout === 'AZERTY' ? 'KeyM' : 'Minus', shift: true };
  }
}

const ALL_ACTIONS: KeyAction[] = [
  'pan', 'zoomIn', 'zoomOut', 'pause', 'speed1', 'speed2', 'speed3', 'escape', 'confirm', 'bulldoze', 'road', 'res', 'com', 'ind',
  'infra', 'civic', 'sky', 'deals', 'overlay', 'overlayBack', 'map', 'goals', 'shortcuts', 'undo',
];

describe('resolveKey: every key of §14.3 on US, AZERTY and QWERTZ', () => {
  for (const layout of LAYOUTS) {
    it(`${layout}: each action resolves from its key`, () => {
      for (const a of ALL_ACTIONS) {
        const k = keyFor(layout, a);
        expect(resolveKey(press(layout, k.code, { shiftKey: !!k.shift })), `${layout} ${a} (${k.code})`).toBe(a);
      }
    });
  }

  it('the clusters stay in place: physical WASD pans and the code KeyZ zones homes on every layout (ZQSD on AZERTY, Y on QWERTZ)', () => {
    for (const layout of LAYOUTS) {
      for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft']) expect(resolveKey(press(layout, code))).toBe('pan');
      expect(resolveKey(press(layout, 'KeyZ'))).toBe('res');
    }
    // QWERTZ's printed Z (code KeyY) is not the zone key; AZERTY's printed Z (code KeyW) pans.
    expect(resolveKey(press('QWERTZ', 'KeyY'))).toBeNull();
    expect(resolveKey(press('AZERTY', 'KeyW'))).toBe('pan');
  });

  it('? never zooms or opens the City map (QWERTZ: Shift + the zoom-out key; AZERTY: Shift + the KeyM key)', () => {
    expect(resolveKey(press('QWERTZ', 'Minus', { shiftKey: true }))).toBe('shortcuts');
    expect(resolveKey(press('AZERTY', 'KeyM', { shiftKey: true }))).toBe('shortcuts');
    expect(resolveKey(press('US', 'Slash', { shiftKey: true }))).toBe('shortcuts');
    // Unshifted, the same keys do their own jobs: QWERTZ ß zooms out by its code, AZERTY ',' is nothing.
    expect(resolveKey(press('QWERTZ', 'Minus'))).toBe('zoomOut');
    expect(resolveKey(press('AZERTY', 'KeyM'))).toBeNull();
  });

  it('Ctrl / Cmd+Z undoes on all three (QWERTZ code KeyY, AZERTY code KeyW); the printed Y / W never do', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(resolveKey(press('US', 'KeyZ', mod))).toBe('undo');
      expect(resolveKey(press('AZERTY', 'KeyW', mod))).toBe('undo');
      expect(resolveKey(press('QWERTZ', 'KeyY', mod))).toBe('undo');
      expect(resolveKey(press('QWERTZ', 'KeyZ', mod))).toBeNull(); // 'y'
      expect(resolveKey(press('AZERTY', 'KeyZ', mod))).toBeNull(); // 'w'
    }
    // A non-Latin layout: the physical KeyZ (its letter is Cyrillic).
    expect(resolveKey({ key: 'я', code: 'KeyZ', ctrlKey: true })).toBe('undo');
    // Ctrl+Shift+Z (redo elsewhere) and other combinations are the browser's.
    expect(resolveKey(press('US', 'KeyZ', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveKey(press('US', 'KeyB', { ctrlKey: true }))).toBeNull();
    expect(resolveKey(press('US', 'KeyM', { altKey: true }))).toBeNull();
    expect(resolveKey(press('US', 'KeyZ', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('M, G and U go by the letter; on a Cyrillic layout by the physical key', () => {
    expect(resolveKey({ key: 'ь', code: 'KeyM' })).toBe('map');
    expect(resolveKey({ key: 'п', code: 'KeyG' })).toBe('goals');
    expect(resolveKey({ key: 'г', code: 'KeyU' })).toBe('undo');
    // A Cyrillic letter on a cluster key still does the cluster's job.
    expect(resolveKey({ key: 'и', code: 'KeyB' })).toBe('bulldoze');
    // AZERTY's printed M (code Semicolon) opens the map; its ',' key does not.
    expect(resolveKey(press('AZERTY', 'Semicolon'))).toBe('map');
  });
});

describe('the ? sheet lists exactly the bound keys', () => {
  it('every row names actions the keyboard (or the pointer) really binds, and every bound action is listed', () => {
    const pointer = new Set(['wheel', 'rightDrag', 'fast']);
    const listed = new Set<string>();
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBe(s.codes.length);
      for (const a of s.actions) {
        listed.add(a);
        if (pointer.has(a)) continue;
        // Bound: some key on the US layout resolves to it.
        const k = keyFor('US', a as KeyAction);
        expect(resolveKey(press('US', k.code, { shiftKey: !!k.shift })), `${a}`).toBe(a);
      }
      // A code-bound key prints the key at that code.
      s.codes.forEach((code, i) => {
        if (!code) return;
        expect(resolveKey(press('US', code)), `${s.label} ${code}`).not.toBeNull();
        void i;
      });
    }
    for (const a of ALL_ACTIONS) expect(listed.has(a), `${a} listed`).toBe(true);
  });

  it('groups Camera, Time, Build and Panels in order; M on Camera, Space and 1 2 3 on Time, G and ? on Panels', () => {
    const sheet = shortcutSheet();
    expect(sheet.map((g) => g.group)).toEqual([...SHORTCUT_GROUPS]);
    const flat = (g: string) => sheet.find((x) => x.group === g)!.rows.flatMap((r) => r.keys);
    expect(flat('Camera')).toEqual(expect.arrayContaining(['W', 'A', 'S', 'D', 'Shift', '+', '−', 'M']));
    expect(flat('Time')).toEqual(['Space', '1', '2', '3']);
    expect(flat('Build')).toEqual(expect.arrayContaining(['Esc', 'B', 'R', 'Z', 'X', 'C', 'E', 'V', 'T', 'F', 'Enter', 'U']));
    expect(flat('Panels')).toEqual(expect.arrayContaining(['G', 'O', '?', 'Esc']));
    expect(sheet.reduce((n, g) => n + g.rows.length, 0)).toBe(SHORTCUTS.length);
  });

  it('keycaps read the player layout where the browser tells it (letters only), else the US label', () => {
    try {
      setKeyLayout(new Map([['KeyZ', 'y'], ['KeyY', 'z'], ['KeyW', 'z'], ['KeyA', 'q'], ['KeyE', 'e']]));
      expect(categoryKey('zones')).toBe('Y');
      expect(cardKey('res')).toBe('Y');
      expect(categoryKey('inspect')).toBe('Esc');
      const pan = SHORTCUTS.find((s) => s.actions.includes('pan'))!;
      expect(rowKeys(pan)).toEqual(['Z', 'Q', 'S', 'D']);
      // Digits, symbols and the mnemonic letters print as written.
      expect(rowKeys(SHORTCUTS.find((s) => s.actions.includes('speed1'))!)).toEqual(['1', '2', '3']);
      expect(rowKeys(SHORTCUTS.find((s) => s.actions.includes('map'))!)).toEqual(['M']);
    } finally {
      setKeyLayout(null);
    }
    expect(categoryKey('zones')).toBe('Z');
  });

  it('the toolbar keycaps: Inspect Esc, Bulldoze B, Road R, Zones Z, Infra E, Civic V, Sky T, Deals F, Data O; the tray cards R Z X C', () => {
    const want: Record<string, string> = { inspect: 'Esc', bulldoze: 'B', road: 'R', zones: 'Z', power: 'E', services: 'V', sky: 'T', deals: 'F', data: 'O' };
    for (const c of CATEGORIES) expect(categoryKey(c.id), c.id).toBe(want[c.id]);
    expect(Object.keys(CATEGORY_KEYS).sort()).toEqual(Object.keys(want).sort());
    expect(Object.fromEntries(Object.keys(CARD_KEYS).map((t) => [t, cardKey(t)]))).toEqual({ road: 'R', res: 'Z', com: 'X', ind: 'C' });
    // Each toolbar keycap's physical key does what the button does.
    expect(resolveKey(press('US', CATEGORY_KEYS.power.code))).toBe('infra');
    expect(TRAY_KEYS.infra).toBe('power');
    expect(TRAY_KEYS.civic).toBe('services');
    expect(TRAY_KEYS.sky).toBe('sky');
    expect(TRAY_KEYS.deals).toBe('deals');
    // Help step 6 points at the sheet (§7.7, §14.3).
    expect(HELP_SHORTCUTS_SENTENCE).toBe('Press ? for every shortcut.');
  });
});

describe('key hints: the desktop layout, or a hardware key press (§14.3)', () => {
  it('a virtual keyboard (key "Unidentified", or no code) and a keydown in a text field never count', () => {
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(isHardwareKey({ key: 'Unidentified', code: 'KeyA' })).toBe(false);
    expect(isHardwareKey({ key: 'a', code: '' })).toBe(false);
    expect(isHardwareKey({ key: 'Process', code: 'KeyA' })).toBe(false);
    expect(isHardwareKey({ key: 'a', code: 'KeyA', target: input })).toBe(false);
    expect(isHardwareKey({ key: 'a', code: 'KeyA', target: { tagName: 'TEXTAREA' } as unknown as EventTarget })).toBe(false);
    expect(isHardwareKey({ key: 'a', code: 'KeyA', target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget })).toBe(false);
    expect(isHardwareKey({ key: 'b', code: 'KeyB', target: { tagName: 'CANVAS' } as unknown as EventTarget })).toBe(true);
  });

  it('hints show on the desktop layout or after a hardware key, else never', () => {
    expect(keyHintsShown(true, false)).toBe(true);
    expect(keyHintsShown(false, true)).toBe(true);
    expect(keyHintsShown(false, false)).toBe(false);
  });
});

// ── KeyboardInput end to end, on a stub window ─────────────────────────────

interface FakeGame {
  speed: number;
  tool: string;
  overlay: string;
  pendingConfirm: unknown;
  undos: number;
  left: number;
  world: { stats: object };
  events: { on: () => () => void };
  setSpeed(s: number): void;
  setTool(t: string): void;
  setOverlay(o: string): void;
  setPreview(): void;
  select(): void;
  cancelPending(): void;
  undoLeft(): number;
  undo(): boolean;
}

function fakeGame(): FakeGame {
  return {
    speed: 1,
    tool: 'inspect',
    overlay: 'none',
    pendingConfirm: null,
    undos: 0,
    left: 0,
    world: { stats: {} },
    events: { on: () => () => {} },
    setSpeed(s) {
      this.speed = s;
    },
    setTool(t) {
      this.tool = t;
    },
    setOverlay(o) {
      this.overlay = o;
    },
    setPreview() {},
    select() {},
    cancelPending() {},
    undoLeft() {
      return this.left;
    },
    undo() {
      this.undos++;
      return true;
    },
  };
}

describe('KeyboardInput (§14.3): the keys reach the game and the UI hooks', () => {
  let win: EventTarget;
  let kb: KeyboardInput;
  let game: FakeGame;
  const calls: string[] = [];
  const zooms: number[] = [];

  function key(e: KeyLike & { repeat?: boolean; target?: unknown }, on: EventTarget = win): Event {
    const ev = new Event('keydown', { cancelable: true }) as Event & Record<string, unknown>;
    const { target, ...rest } = e;
    Object.assign(ev, { repeat: false, ...rest });
    if (target) Object.defineProperty(ev, 'target', { value: target });
    on.dispatchEvent(ev);
    return ev;
  }

  beforeEach(() => {
    win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { activeElement: null });
    keyBus.hardware = false;
    calls.length = 0;
    zooms.length = 0;
    keyBus.ui = {
      toggleTray: (cat) => (calls.push(`tray:${cat}`), true),
      toggleMap: () => (calls.push('map'), true),
      toggleGoals: () => (calls.push('goals'), true),
      toggleShortcuts: () => (calls.push('shortcuts'), true),
    };
    keyBus.onHardware = () => calls.push('hardware');
    game = fakeGame();
    kb = new KeyboardInput(game as never, { zoomStep: (f) => zooms.push(f), cancelGesture: () => {}, confirmPending: () => calls.push('confirm') });
  });

  afterEach(() => {
    kb.destroy();
    keyBus.ui = null;
    keyBus.onHardware = null;
    keyBus.hardware = false;
    vi.unstubAllGlobals();
  });

  it('? opens the sheet on all three layouts and never zooms or opens the map', () => {
    for (const layout of LAYOUTS) {
      const k = keyFor(layout, 'shortcuts');
      key(press(layout, k.code, { shiftKey: true }));
    }
    expect(calls.filter((c) => c === 'shortcuts')).toHaveLength(3);
    expect(calls).not.toContain('map');
    expect(zooms).toEqual([]);
  });

  it('Ctrl / Cmd+Z and U undo only while an Undo toast shows, on all three layouts; never in a text field', () => {
    key(press('US', 'KeyZ', { ctrlKey: true }));
    expect(game.undos).toBe(0);
    game.left = 8;
    key(press('US', 'KeyZ', { ctrlKey: true }));
    key(press('AZERTY', 'KeyW', { metaKey: true }));
    key(press('QWERTZ', 'KeyY', { ctrlKey: true }));
    key(press('US', 'KeyU'));
    expect(game.undos).toBe(4);
    key({ ...press('US', 'KeyZ', { ctrlKey: true }), target: { tagName: 'INPUT' } });
    expect(game.undos).toBe(4);
  });

  it('E V T F toggle their trays; M the City map; G the Goals drawer; the cluster keys set tools and speed', () => {
    for (const code of ['KeyE', 'KeyV', 'KeyT', 'KeyF']) key(press('US', code));
    key(press('AZERTY', 'Semicolon'));
    key(press('QWERTZ', 'KeyG'));
    expect(calls).toEqual(['hardware', 'tray:power', 'tray:services', 'tray:sky', 'tray:deals', 'map', 'goals']);
    key(press('AZERTY', 'KeyZ'));
    expect(game.tool).toBe('res');
    key(press('AZERTY', 'Digit3'));
    expect(game.speed).toBe(3);
    key(press('QWERTZ', 'Slash'));
    expect(zooms).toEqual([1 / 1.25]);
  });

  it('under a takeover screen (a chapter title, Charter Night, an ending) the game keys wait and leave Space and Enter to its buttons', () => {
    let covered = true;
    keyBus.ui = { ...keyBus.ui!, covered: () => covered };
    game.left = 8;
    const evs = ['KeyB', 'KeyR', 'KeyZ', 'Space', 'Digit3', 'KeyO', 'KeyU', 'Escape', 'Enter', 'KeyE', 'KeyM'].map((c) => key(press('US', c)));
    key(press('US', 'Minus'));
    key(press('US', 'KeyW'));
    expect(game.tool).toBe('inspect');
    expect(game.speed).toBe(1);
    expect(game.overlay).toBe('none');
    expect(game.undos).toBe(0);
    expect(zooms).toEqual([]);
    expect(calls).toEqual(['hardware']);
    expect(evs.filter((e) => e.defaultPrevented)).toEqual([]);
    const v = { x: 0, y: 0 };
    expect(kb.step(0.1, v)).toBe(false);
    // Once it closes, the same keys reach the city again.
    covered = false;
    key(press('US', 'KeyB'));
    key(press('US', 'Digit3'));
    expect(game.tool).toBe('bulldoze');
    expect(game.speed).toBe(3);
  });

  it('a virtual keyboard keydown while typing a city name never shows key hints; a hardware key does, once', () => {
    key({ key: 'Unidentified', code: '', target: { tagName: 'INPUT' } });
    key({ key: 'a', code: 'KeyA', target: { tagName: 'INPUT' } });
    expect(keyBus.hardware).toBe(false);
    expect(calls).toEqual([]);
    key(press('US', 'KeyB'));
    key(press('US', 'KeyX'));
    expect(keyBus.hardware).toBe(true);
    expect(calls.filter((c) => c === 'hardware')).toHaveLength(1);
  });
});
