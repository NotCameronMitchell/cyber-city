// UI catalogue (docs/EXPANSION.md §7, WP-5): every tool has its own card metadata
// and an original icon, every data view has an entry, the Road button follows the
// hybrid rules, the toolbar relabels Power → Infra at the first port, the pill
// folds counts into its name, the milestone banner names trays, the tip copy
// fits, and the first-use tips show one at a time. Pure logic plus a tiny fake
// DOM for the Tips card (the suite runs under node).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction, lockedReason, planAction } from '../src/game/actions';
import { BUILDINGS, BUILDING_ORDER, ROAD_KINDS, SKYWAY } from '../src/game/config';
import { ROAD_TOOLS, type RoadTool } from '../src/game/roads';
import { RoadKind, type OverlayId, type ToolId } from '../src/game/types';
import { World } from '../src/game/world';
import { OVERLAY_CYCLE } from '../src/input/keyboard';
import { bannerUnlocks, changedTiles, pillLabel, trayName } from '../src/ui/feedback';
import { icon } from '../src/ui/icons';
import { TIPS, TIP_GAP, TIP_SEC, Tips, toolTip, type TipId } from '../src/ui/tips';
import {
  CATEGORIES,
  INFRA_POP,
  OVERLAYS,
  SERVICE_SWATCHES,
  categoryChrome,
  categoryOf,
  costLabel,
  isHybrid,
  nextRoadTool,
  roadButton,
  toolMeta,
} from '../src/ui/tools';

/** Every ToolId, as a Record so a new member that is missing here fails to compile. */
const ALL_TOOLS: Record<ToolId, true> = {
  inspect: true,
  bulldoze: true,
  road: true,
  avenue: true,
  highway: true,
  alley: true,
  skyway: true,
  res: true,
  com: true,
  ind: true,
  skybridge: true,
  rail: true,
  solar: true,
  reactor: true,
  plaza: true,
  precinct: true,
  clinic: true,
  datahub: true,
  maglev: true,
  spire: true,
  arcology: true,
  academy: true,
  seaport: true,
  airport: true,
  spaceport: true,
  stack: true,
  foundry: true,
  glarewall: true,
  tidemarket: true,
  roost: true,
  commons: true,
  memorial: true,
};
const TOOLS = Object.keys(ALL_TOOLS) as ToolId[];
const ALL_OVERLAYS: Record<OverlayId, true> = {
  none: true,
  power: true,
  landValue: true,
  crime: true,
  pollution: true,
  traffic: true,
  services: true,
  turf: true,
  wealth: true,
  noise: true,
};

const flat = () => new World(77, 'Catalogue');
const unlockedIn = (w: World) => (t: RoadTool) => !lockedReason(w, t);

describe('tool catalogue', () => {
  it('every ToolId has its own toolMeta (never the Inspect fallback) and a drawable icon', () => {
    for (const t of TOOLS) {
      const m = toolMeta(t);
      expect(m.id, t).toBe(t);
      expect(m.name.length, t).toBeGreaterThan(0);
      expect(icon(m.icon), t).not.toContain('undefined');
    }
  });

  it('every tool has a distinct icon of its own', () => {
    const seen = new Map<string, ToolId>();
    for (const t of TOOLS) {
      const ic = toolMeta(t).icon;
      expect(seen.get(ic), `${t} shares '${ic}' with ${seen.get(ic)}`).toBeUndefined();
      seen.set(ic, t);
    }
  });

  it('every ToolId in CATEGORIES belongs to exactly one category, and every buildable tool is offered', () => {
    const where = new Map<ToolId, string>();
    for (const c of CATEGORIES) {
      for (const t of new Set([...(c.items ?? []), ...(c.tool ? [c.tool] : [])])) {
        expect(where.has(t), `${t} in ${c.id} and ${where.get(t)}`).toBe(false);
        where.set(t, c.id);
        expect(categoryOf(t)).toBe(c.id);
      }
    }
    for (const t of TOOLS) expect(where.has(t), t).toBe(true);
  });

  it('trays hold the §7.1 items in unlock order', () => {
    const items = (id: string) => CATEGORIES.find((c) => c.id === id)!.items;
    expect(items('road')).toEqual(['road', 'alley', 'avenue', 'highway']);
    expect(items('power')).toEqual(['solar', 'reactor', 'seaport', 'airport', 'spaceport']);
    expect(items('services')).toEqual(['plaza', 'precinct', 'clinic', 'datahub', 'academy', 'maglev', 'memorial']);
    expect(items('sky')).toEqual(['stack', 'skybridge', 'rail', 'skyway', 'spire', 'arcology']);
    expect(CATEGORIES.length).toBe(9); // still 9 buttons, nothing added
  });

  it('the Road category is the only hybrid and keeps the Street tool id', () => {
    const hybrids = CATEGORIES.filter(isHybrid).map((c) => c.id);
    expect(hybrids).toEqual(['road']);
    expect(CATEGORIES.find((c) => c.id === 'road')!.tool).toBe('road');
  });

  it('tray cards carry the §7.2 names, prices and meta lines (≤ 22 chars)', () => {
    const card = (t: ToolId) => {
      const m = toolMeta(t);
      return [m.name, costLabel(m), m.meta];
    };
    expect(card('road')).toEqual(['Street', '15 CR/tile', 'Lots ≤ 3 tiles']);
    expect(card('alley')).toEqual(['Back Alley', '6 CR/tile', 'Cheap homes · crime']);
    expect(card('avenue')).toEqual(['Avenue', '40 CR/tile', '2× traffic · widens']);
    expect(card('highway')).toEqual(['Highway', '90 CR/tile', '5× traffic · no lots']);
    expect(card('skyway')).toEqual(['Skyway', '160 CR/tile', 'Cars · ramps']);
    expect(card('seaport')).toEqual(['Seaport', '18,000 CR', '4×4 · shore only']);
    expect(card('airport')).toEqual(['Airport', '45,000 CR', '6×6 · loud']);
    expect(card('spaceport')).toEqual(['Spaceport', '150,000 CR', '6×6 · slow build']);
    expect(card('academy')).toEqual(['Academy', '3,200 CR', '2×2 · schools']);
    expect(toolMeta('skybridge').meta).toBe('Tower to tower');
    expect(toolMeta('rail').meta).toBe('Stations');
    for (const t of TOOLS) {
      const meta = toolMeta(t).meta;
      if (meta) expect(meta.length, t).toBeLessThanOrEqual(22);
    }
  });

  it('unlock populations come from the config (roads, skyway, buildings)', () => {
    expect(toolMeta('alley').unlockPop).toBe(ROAD_KINDS[RoadKind.Alley].unlockPop);
    expect(toolMeta('avenue').unlockPop).toBe(ROAD_KINDS[RoadKind.Avenue].unlockPop);
    expect(toolMeta('highway').unlockPop).toBe(ROAD_KINDS[RoadKind.Highway].unlockPop);
    expect(toolMeta('skyway').unlockPop).toBe(SKYWAY.unlockPop);
    for (const t of BUILDING_ORDER) if (!BUILDINGS[t].gate) expect(toolMeta(t).unlockPop).toBe(BUILDINGS[t].unlockPop);
  });
});

describe('data views', () => {
  it('every OverlayId has an OVERLAYS entry, in the §7.3 tray order', () => {
    for (const id of Object.keys(ALL_OVERLAYS) as OverlayId[]) expect(OVERLAYS.some((o) => o.id === id), id).toBe(true);
    expect(OVERLAYS.map((o) => o.id)).toEqual(['none', 'wealth', 'landValue', 'traffic', 'noise', 'power', 'crime', 'pollution', 'services', 'turf']);
    for (const o of OVERLAYS) expect(icon(o.icon), o.id).not.toContain('undefined');
  });

  it('Wealth uses the tiers legend, Noise a Quiet → Roaring heat scale, Services gains Schools', () => {
    expect(OVERLAYS.find((o) => o.id === 'wealth')!.legend).toBe('tiers');
    const noise = OVERLAYS.find((o) => o.id === 'noise')!;
    expect([noise.legend, noise.low, noise.high]).toEqual(['heat', 'Quiet', 'Roaring']);
    expect(SERVICE_SWATCHES.map((s) => s.label)).toContain('Schools');
    expect(SERVICE_SWATCHES.length).toBe(7);
  });

  it('the O key cycles through the new views', () => {
    expect(OVERLAY_CYCLE).toContain('wealth');
    expect(OVERLAY_CYCLE).toContain('noise');
    for (const id of OVERLAY_CYCLE) expect(OVERLAYS.some((o) => o.id === id)).toBe(true);
  });
});

describe('Road button (§7.2)', () => {
  it('rule 1: no road tool → Street (or the session’s last unlocked kind); the tray opens once two kinds are open', () => {
    const w = flat();
    expect(roadButton('inspect', false, 'road', unlockedIn(w))).toEqual({ tool: 'road', tray: 'keep' });
    // A locked last tool falls back to Street.
    expect(roadButton('inspect', false, 'highway', unlockedIn(w))).toEqual({ tool: 'road', tray: 'keep' });
    w.maxPopulation = 1500; // Back Alley + Avenue
    expect(roadButton('res', false, 'avenue', unlockedIn(w))).toEqual({ tool: 'avenue', tray: 'open' });
    expect(roadButton('inspect', false, 'highway', unlockedIn(w))).toEqual({ tool: 'road', tray: 'open' });
  });

  it('rules 2 and 3: a road tool active → the button toggles the tray, the tool stays', () => {
    const w = flat();
    w.maxPopulation = 6000;
    for (const t of ROAD_TOOLS) {
      expect(roadButton(t, false, 'road', unlockedIn(w))).toEqual({ tool: null, tray: 'open' });
      expect(roadButton(t, true, 'road', unlockedIn(w))).toEqual({ tool: null, tray: 'close' });
    }
  });

  it('one tap on Road lays a street; Street → Avenue takes two taps (Road, Avenue)', () => {
    const w = flat();
    w.maxPopulation = 2000;
    // Tap 1 (no tool): Street is selected and the tray opens; tap 2 is the Avenue card.
    const first = roadButton('inspect', false, 'road', unlockedIn(w));
    expect(first.tool).toBe('road');
    // With Street active and the tray closed, Road opens the tray (tap 1), then the card (tap 2).
    expect(roadButton('road', false, 'road', unlockedIn(w)).tray).toBe('open');
  });

  it('KeyR: Street, then the next unlocked kind in tray order, wrapping; alone it toggles back to Inspect', () => {
    const w = flat();
    const u = unlockedIn(w);
    expect(nextRoadTool('inspect', u)).toBe('road');
    expect(nextRoadTool('road', u)).toBe('inspect');
    w.maxPopulation = 1500;
    expect(nextRoadTool('road', u)).toBe('alley');
    expect(nextRoadTool('alley', u)).toBe('avenue');
    expect(nextRoadTool('avenue', u)).toBe('road');
    w.maxPopulation = 5000;
    expect(nextRoadTool('avenue', u)).toBe('highway');
    expect(nextRoadTool('highway', u)).toBe('road');
    expect(nextRoadTool('bulldoze', u)).toBe('road');
  });
});

describe('Infra relabel (§7.1)', () => {
  it('Power keeps its label and bolt until the Seaport unlocks, then reads Infra / Power & Ports', () => {
    const power = CATEGORIES.find((c) => c.id === 'power')!;
    expect(INFRA_POP).toBe(BUILDINGS.seaport.unlockPop);
    expect(categoryChrome(power, INFRA_POP - 1)).toEqual({ label: 'Power', short: 'Power', icon: 'power' });
    expect(categoryChrome(power, INFRA_POP)).toEqual({ label: 'Power & Ports', short: 'Infra', icon: 'infra' });
    expect(categoryChrome(power, INFRA_POP).short.length).toBeLessThanOrEqual(5);
    const road = CATEGORIES.find((c) => c.id === 'road')!;
    expect(categoryChrome(road, 99999).label).toBe('Road');
  });

  it('the banner names trays the way the unlock news does', () => {
    expect(trayName(BUILDINGS.reactor, INFRA_POP - 1)).toBe('Power');
    expect(trayName(BUILDINGS.reactor, INFRA_POP)).toBe('Infra');
    expect(trayName(BUILDINGS.seaport, INFRA_POP)).toBe('Infra');
    expect(trayName(BUILDINGS.academy, 1500)).toBe('Civic');
    expect(trayName(BUILDINGS.spire, 12000)).toBe('Sky');
    expect(bannerUnlocks(500, 1500)).toEqual(expect.arrayContaining(['Academy (Civic)', 'Avenue (Road)', 'Back Alley (Road)']));
    expect(bannerUnlocks(1500, 5000)).toEqual(expect.arrayContaining(['Seaport (Infra)', 'Highway (Road)']));
    expect(bannerUnlocks(5000, 12000)).toEqual(expect.arrayContaining(['Airport (Infra)', 'Skyway (Sky)']));
    expect(bannerUnlocks(12000, 30000)).toContain('Spaceport (Infra)');
    // No On-ramp line (it comes with the Highway) and no gated story buildings.
    for (const s of bannerUnlocks(0, 99999)) expect(s.startsWith('On-ramp')).toBe(false);
    for (const t of BUILDING_ORDER) if (BUILDINGS[t].gate) expect(bannerUnlocks(0, 99999).some((s) => s.startsWith(BUILDINGS[t].name + ' ('))).toBe(false);
  });
});

describe('action pill (§7.5)', () => {
  it('folds counts into the name: Street ×12, Avenue ×6 · 6 widened, Demolish skyway ×n', () => {
    const w = flat();
    w.funds = 1e7;
    w.maxPopulation = 13000;
    const street = planAction(w, 'road', { x: 10, y: 10 }, { x: 21, y: 10 });
    expect(street.valid).toBe(true);
    expect(pillLabel(w, street)).toBe('Street ×12');
    applyAction(w, 'road', { x: 10, y: 10 }, { x: 15, y: 10 });
    const widen = planAction(w, 'avenue', { x: 10, y: 10 }, { x: 15, y: 10 });
    expect(changedTiles(w, widen)).toBe(6);
    expect(pillLabel(w, widen)).toBe('Avenue ×6 · 6 widened');
    // Re-laying the same street changes nothing (and the pill counts nothing).
    expect(changedTiles(w, planAction(w, 'road', { x: 12, y: 10 }, { x: 15, y: 10 }))).toBe(0);
    // A street crossing a highway: two on-ramps.
    applyAction(w, 'highway', { x: 30, y: 5 }, { x: 30, y: 20 });
    const cross = planAction(w, 'road', { x: 28, y: 12 }, { x: 32, y: 12 });
    expect(pillLabel(w, cross)).toBe('Street ×4 · 2 ramps');
    // Skyway: new deck tiles, and a sky-layer bulldoze.
    const sky = planAction(w, 'skyway', { x: 40, y: 30 }, { x: 47, y: 30 });
    expect(pillLabel(w, sky)).toMatch(/^Skyway ×8/);
    applyAction(w, 'skyway', { x: 40, y: 30 }, { x: 47, y: 30 });
    const demo = planAction(w, 'bulldoze', { x: 40, y: 30 }, { x: 45, y: 30 });
    expect(demo.layer).toBe('sky');
    expect(pillLabel(w, demo)).toBe('Demolish skyway ×6');
  });
});

describe('first-use tips (§7.6, Appendix A)', () => {
  it('every tip is one line of at most 110 characters with a drawable icon, and avoids the banned terms', () => {
    const banned = /\b(fixer|netrunner|deck|jack in|cyberspace|ghost|shell|chrome)\b/i;
    for (const [id, t] of Object.entries(TIPS)) {
      expect(t.text.length, id).toBeLessThanOrEqual(110);
      expect(t.text.includes('\n'), id).toBe(false);
      expect(icon(t.icon), id).not.toContain('undefined');
      expect(banned.test(t.text), id).toBe(false);
    }
  });

  it('the new tools have tips; old tools and sim-only ids do not come from tools', () => {
    for (const t of ['avenue', 'highway', 'alley', 'skyway', 'seaport', 'airport', 'spaceport', 'academy'] as ToolId[]) expect(toolTip(t)).toBe(t);
    for (const t of ['road', 'res', 'solar', 'bulldoze', 'inspect'] as ToolId[]) expect(toolTip(t)).toBeNull();
  });

  describe('Tips card', () => {
    const saved = { document: (globalThis as { document?: unknown }).document };
    beforeEach(() => {
      (globalThis as { document?: unknown }).document = fakeDocument();
    });
    afterEach(() => {
      (globalThis as { document?: unknown }).document = saved.document;
    });

    it('shows one tip at a time, waits while blocked, never drops one, and hides after 8 s on screen', () => {
      let blocked = false;
      const slot = fakeDocument().createElement('div');
      const tips = new Tips(slot as unknown as HTMLElement, () => blocked);
      tips.onTool('avenue');
      tips.onHint('wealth');
      tips.onTool('avenue'); // duplicate: ignored
      tips.onTool('road'); // no tip
      expect(tips.pending).toEqual(['avenue', 'wealth']);
      // Frames of 0.25 s (a stalled frame over 1 s is not counted as time on screen).
      const play = (sec: number) => {
        for (let t = 0; t < sec - 1e-6; t += 0.25) tips.update(0.25);
      };
      blocked = true;
      play(1);
      expect(tips.showing).toBeNull();
      blocked = false;
      play(0.25);
      expect(tips.showing).toBe('avenue');
      // Something covers it mid-way: hidden and paused, not dropped.
      play(3);
      blocked = true;
      play(30);
      expect(tips.showing).toBeNull();
      expect(tips.pending[0]).toBe('avenue');
      blocked = false;
      play(TIP_SEC - 3.5);
      expect(tips.showing).toBe('avenue');
      play(0.5);
      expect(tips.showing).toBeNull();
      // A quiet gap, then the next one.
      play(TIP_GAP - 0.5);
      expect(tips.showing).toBeNull();
      play(0.75);
      expect(tips.showing).toBe('wealth');
      tips.dismiss(); // Got it
      tips.update(0.1);
      expect(tips.showing).toBeNull();
      // Seen ids never show again in this session.
      tips.onTool('avenue');
      tips.onHint('wealth');
      expect(tips.pending).toEqual([]);
    });

    it('every TipId resolves to copy', () => {
      const ids: TipId[] = ['avenue', 'highway', 'alley', 'skyway', 'seaport', 'airport', 'spaceport', 'academy', 'wealth', 'ramps', 'noise'];
      for (const id of ids) expect(TIPS[id].text.length).toBeGreaterThan(20);
    });
  });
});

// ── A tiny fake DOM: just enough for h(), setText/setHtml, hidden and classList ──

interface FakeEl {
  tagName: string;
  className: string;
  textContent: string;
  innerHTML: string;
  hidden: boolean;
  offsetWidth: number;
  children: FakeEl[];
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean; toggle(c: string, on?: boolean): void };
  style: { setProperty(k: string, v: string): void };
  setAttribute(k: string, v: string): void;
  append(...c: (FakeEl | string)[]): void;
  addEventListener(): void;
}

function fakeDocument(): { createElement(tag: string): FakeEl } {
  return {
    createElement(tag: string): FakeEl {
      const classes = new Set<string>();
      const el: FakeEl = {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        offsetWidth: 0,
        children: [],
        attrs: {},
        dataset: {},
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c),
          toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
        },
        style: { setProperty: () => undefined },
        setAttribute(k, v) {
          if (k === 'hidden') el.hidden = true;
          el.attrs[k] = v;
        },
        append(...c) {
          for (const x of c) if (typeof x !== 'string') el.children.push(x);
        },
        addEventListener: () => undefined,
      };
      return el;
    },
  };
}
