// MEGACITY §14.1 / §14.4 / §14.5 items 1, 2 and 5: the desktop layout query (and the phone layout it never touches),
// the side panel's geometry and camera inset, the dock and rail placement at 1024×768, 1280×800, 1440×900 and
// 1920×1080, and the panel host: one panel at a time, a story card that takes the panel and gives the report back,
// Back from a card read from the Goals drawer, a card parked under another panel, the City map giving nothing back.

import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import {
  DESK_QUERY,
  DOCK_BUTTON,
  DOCK_BUTTON_COMPACT,
  PANEL_GAP,
  SidePanels,
  dockCompact,
  dockRoom,
  dockWidth,
  mapAreaWidth,
  panelInset,
  sidePanelWidth,
  type PanelId,
  type PanelSurface,
} from '../src/ui/context';

// ── The desktop layout query (§14.1, §14.4) ─────────────────────────────────

interface Device {
  w: number;
  h: number;
  hover: 'hover' | 'none';
  pointer: 'fine' | 'coarse';
}

/** Evaluate a media query made of `(feature: value)` terms joined by `and` against a device (all terms must hold). */
function matches(q: string, d: Device): boolean {
  return q.split(/\s+and\s+/).every((term) => {
    const m = /^\(\s*([a-z-]+)\s*:\s*([a-z0-9.]+)\s*\)$/.exec(term.trim());
    if (!m) throw new Error(`unparsed ${term}`);
    const [, f, v] = m;
    const n = parseFloat(v);
    switch (f) {
      case 'min-width':
        return d.w >= n;
      case 'min-height':
        return d.h >= n;
      case 'hover':
        return d.hover === v;
      case 'pointer':
        return d.pointer === v;
      default:
        throw new Error(`unknown feature ${f}`);
    }
  });
}

const PC_SIZES: [number, number][] = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
];

describe('the desktop layout (§14.1): a mouse that hovers on a window of at least 1024×600', () => {
  it('matches at 1024×768, 1280×800, 1440×900 and 1920×1080 with a mouse', () => {
    for (const [w, h] of PC_SIZES) expect(matches(DESK_QUERY, { w, h, hover: 'hover', pointer: 'fine' }), `${w}×${h}`).toBe(true);
  });

  it('never on phones (390×844, 360×640, 844×390), tablets with a coarse pointer, or narrower or shorter windows', () => {
    const phone = { hover: 'none', pointer: 'coarse' } as const;
    for (const [w, h] of [
      [390, 844],
      [360, 640],
      [844, 390],
    ])
      expect(matches(DESK_QUERY, { w, h, ...phone })).toBe(false);
    // An iPad in landscape: coarse pointer, no hover (§14.5 item 5: no panel, no tooltip).
    expect(matches(DESK_QUERY, { w: 1180, h: 820, ...phone })).toBe(false);
    expect(matches(DESK_QUERY, { w: 1366, h: 1024, hover: 'none', pointer: 'coarse' })).toBe(false);
    // The 640-1023 wide layout stays as it is (§14.4); a short window too.
    expect(matches(DESK_QUERY, { w: 1023, h: 800, hover: 'hover', pointer: 'fine' })).toBe(false);
    expect(matches(DESK_QUERY, { w: 1440, h: 599, hover: 'hover', pointer: 'fine' })).toBe(false);
  });
});

// ── Geometry (§14.1) ─────────────────────────────────────────────────────────

describe('the side panel: clamp(360px, 28vw, 440px), 12 px from the right, the camera inset its width + 24', () => {
  it('360 at 1024 and 1280, 403 at 1440, 440 at 1920; the map area 908, 1,025 and 1,468 px', () => {
    expect(PC_SIZES.map(([w]) => sidePanelWidth(w))).toEqual([360, 360, 403, 440]);
    expect(mapAreaWidth(1280)).toBe(908);
    expect(mapAreaWidth(1440)).toBe(1025);
    expect(mapAreaWidth(1920)).toBe(1468);
    for (const [w] of PC_SIZES) expect(panelInset(w)).toBe(sidePanelWidth(w) + 24);
  });

  it('with the right inset set, centring a tile puts it in the middle of the map area, clear of the panel', () => {
    for (const [W, H] of PC_SIZES) {
      const cam = new Camera(192);
      cam.setViewport(W, H);
      cam.zoom = 1;
      cam.setInsets({ top: 76, right: panelInset(W), bottom: 0, left: 0 });
      cam.centerOnTile(96, 96);
      const p = cam.tileToScreen(96, 96);
      const mapRight = W - panelInset(W);
      expect(Math.abs(p.x - mapRight / 2)).toBeLessThanOrEqual(1);
      expect(p.x).toBeLessThan(W - PANEL_GAP - sidePanelWidth(W));
    }
  });
});

describe('the dock and the story rail centre in the map area; compact only where the full dock does not fit', () => {
  it('9 buttons: ≈ 710 px full, ≈ 566 compact (76 and 60 px buttons)', () => {
    expect(dockWidth(9, false)).toBe(9 * DOCK_BUTTON + 16 + 10);
    expect(dockWidth(9, true)).toBe(9 * DOCK_BUTTON_COMPACT + 16 + 10);
    expect(dockWidth(9, false)).toBe(710);
    expect(dockWidth(9, true)).toBe(566);
  });

  it('compact at 1024×768 with a panel open; full at 1280, 1440 and 1920; full everywhere without a panel', () => {
    expect(dockCompact(1024, 9, true)).toBe(true);
    expect(dockCompact(1024, 8, true)).toBe(true);
    for (const w of [1280, 1440, 1920]) expect(dockCompact(w, 9, true), `${w}`).toBe(false);
    for (const [w] of PC_SIZES) expect(dockCompact(w, 9, false)).toBe(false);
    // The switch sits just under 1,110 px (§14.1).
    expect(dockCompact(1105, 9, true)).toBe(true);
    expect(dockCompact(1110, 9, true)).toBe(false);
  });

  it('the dock (and the rail in its column) fits the map area and never reaches the panel', () => {
    for (const [W] of PC_SIZES) {
      const room = dockRoom(W, true);
      const compact = dockCompact(W, 9, true);
      expect(dockWidth(9, compact)).toBeLessThanOrEqual(room);
      // The dock column's right edge (panel width + 24 from the right) is left of the panel's left edge.
      const dockRight = W - panelInset(W);
      const panelLeft = W - PANEL_GAP - sidePanelWidth(W);
      expect(dockRight).toBeLessThan(panelLeft);
      // Centred in the map area: the dock's middle sits in the middle of [12, W - inset].
      const mid = (PANEL_GAP + dockRight) / 2;
      expect(mid).toBeCloseTo((W - panelInset(W) + PANEL_GAP) / 2, 6);
    }
  });
});

// ── The panel host (§14.1) ───────────────────────────────────────────────────

class FakeSurface implements PanelSurface {
  open = false;
  parked = false;
  reopened = 0;
  constructor(
    readonly id: PanelId,
    private readonly parks = false,
  ) {
    if (parks) this.park = (on: boolean) => (this.parked = on);
  }
  isOpen(): boolean {
    return this.open;
  }
  close(): void {
    if (!this.parks) this.open = false;
  }
  reopen(): void {
    this.reopened++;
    this.open = true;
  }
  park?: (on: boolean) => void;
}

function host(): { p: SidePanels; s: Record<PanelId, FakeSurface>; changes: number[] } {
  const p = new SidePanels();
  const ids: PanelId[] = ['inspect', 'card', 'goals', 'factions', 'comms', 'report', 'budget', 'news', 'shortcuts', 'citymap'];
  const s = {} as Record<PanelId, FakeSurface>;
  for (const id of ids) {
    s[id] = new FakeSurface(id, id === 'card');
    p.register(id, s[id]);
  }
  const changes: number[] = [];
  p.onChange = () => changes.push(1);
  p.desk = true;
  return { p, s, changes };
}

describe('SidePanels: one panel at a time (§14.1)', () => {
  it('opening a surface replaces the current one', () => {
    const { p, s } = host();
    s.report.open = true;
    p.update();
    expect(p.current).toBe('report');
    s.budget.open = true;
    p.update();
    expect(p.current).toBe('budget');
    expect(s.report.open).toBe(false);
    expect(p.ret).toBeNull();
    s.budget.open = false;
    p.update();
    expect(p.current).toBeNull();
    expect(s.report.reopened).toBe(0);
  });

  it('§14.5 item 2: a story card opened with the City report up takes the panel, and the report comes back after it', () => {
    const { p, s } = host();
    s.report.open = true;
    p.update();
    // The card waited (banner / COMMS); the player opens it.
    s.card.open = true;
    p.update();
    expect(p.current).toBe('card');
    expect(s.report.open).toBe(false);
    expect(p.ret).toBe('report');
    expect(p.nested).toBe(false); // not opened from inside the report: no Back
    // The card is answered.
    s.card.open = false;
    p.update();
    expect(s.report.reopened).toBe(1);
    expect(p.current).toBe('report');
  });

  it('a card read from the Goals drawer (the drawer closed as it opened) shows Back; Back returns to the drawer', () => {
    const { p, s } = host();
    s.goals.open = true;
    p.update();
    s.goals.open = false;
    s.card.open = true;
    p.update();
    expect(p.current).toBe('card');
    expect(p.nested).toBe(true);
    expect(p.ret).toBe('goals');
    // Back (Later on the card): the card closes and the drawer returns.
    s.card.open = false;
    p.update();
    expect(s.goals.reopened).toBe(1);
    expect(p.current).toBe('goals');
  });

  it('another panel over a story card parks the card; it shows again when that panel closes', () => {
    const { p, s } = host();
    s.card.open = true;
    p.update();
    s.inspect.open = true; // a click on the map, beside the card
    p.update();
    expect(p.current).toBe('inspect');
    expect(s.card.parked).toBe(true);
    expect(s.card.open).toBe(true);
    s.inspect.open = false; // Esc
    p.update();
    expect(s.card.parked).toBe(false);
    expect(p.current).toBe('card');
  });

  it('Back and close on the host: a nested panel goes back one level; a plain one just closes', () => {
    const { p, s } = host();
    s.comms.open = true;
    p.update();
    s.comms.open = false;
    s.card.open = true;
    p.update();
    expect(p.nested).toBe(true);
    // A card goes back through its own Later (the UI clicks it); here the card closes.
    s.card.open = false;
    p.update();
    expect(p.current).toBe('comms');
    // COMMS was not opened from inside anything: no Back, Esc closes it.
    expect(p.back()).toBe(false);
    expect(p.closeCurrent()).toBe(true);
    expect(s.comms.open).toBe(false);
    expect(p.current).toBeNull();
  });

  it('the City map replaces any panel and gives nothing back', () => {
    const { p, s } = host();
    s.news.open = true;
    p.update();
    s.citymap.open = true;
    p.update();
    expect(p.current).toBe('citymap');
    expect(s.news.open).toBe(false);
    s.citymap.open = false;
    p.update();
    expect(p.current).toBeNull();
    expect(s.news.reopened).toBe(0);
  });

  it('off the desktop layout it does nothing (phones keep their sheets and dialogs), and leaving it shows a parked card', () => {
    const { p, s } = host();
    s.card.open = true;
    p.update();
    s.report.open = true;
    p.update();
    expect(s.card.parked).toBe(true);
    p.desk = false;
    expect(s.card.parked).toBe(false);
    expect(p.current).toBeNull();
    s.budget.open = true;
    p.update();
    expect(s.report.open).toBe(true); // nothing closed off the desktop layout
    expect(p.current).toBeNull();
  });
});
