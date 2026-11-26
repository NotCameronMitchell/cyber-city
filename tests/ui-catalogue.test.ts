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
import { Advisor } from '../src/game/sim/advisor';
import { bannerUnlocks, changedTiles, chipNews, payoffToast, pillLabel, trayName, traySpot } from '../src/ui/feedback';
import type { ActionPlan } from '../src/game/types';
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
import { LEGACY_REGION } from '../src/game/types';

/**
 * Every ToolId, as a Record so a new member that is missing here fails to compile. `false`: a Megacity type Step 0b
 * added hidden (no tray, meta or icon until WP-5 / WP-4 give it one); the catalogue checks skip it.
 */
const ALL_TOOLS: Record<ToolId, boolean> = {
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
  floodwatch: true,
  pumphouse: true,
  canopypark: true,
  medtower: true,
  reclaim: true,
  metro: true,
  markethall: true,
  tidal: true,
  geothermal: true,
  datavault: true,
  charterhall: true,
  hexworks: true,
  pearlatrium: true,
  hullhouse: true,
  kitemast: true,
  lampchoir: true,
  beacon: true,
  arena: true,
  halolookout: true,
  terminal: true,
  gantry: true,
  glasssmile: true,
  breadpier: true,
  recordtower: true,
  stillsquare: true,
  frame: false,
  pumphall: false,
};
const TOOLS = (Object.keys(ALL_TOOLS) as ToolId[]).filter((t) => ALL_TOOLS[t]);
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

const flat = () => new World(77, 'Catalogue', undefined, LEGACY_REGION);
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
    // MEGACITY §7.1: every section chip's cards, chip by chip.
    expect(items('power')).toEqual(['solar', 'reactor', 'tidal', 'geothermal', 'seaport', 'airport', 'spaceport']);
    expect(items('services')).toEqual(['precinct', 'floodwatch', 'clinic', 'medtower', 'plaza', 'canopypark', 'markethall', 'memorial', 'academy', 'datahub', 'datavault', 'maglev', 'metro', 'reclaim', 'pumphouse']);
    expect(items('sky')).toEqual(['stack', 'spire', 'arcology', 'skybridge', 'rail', 'skyway', 'beacon', 'arena', 'halolookout', 'terminal']);
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
    expect(card('skyway')).toEqual(['Skyway', '160 CR/tile', 'Cars · drag']);
    expect(card('seaport')).toEqual(['Seaport', '18,000 CR', '4×4 · shore only']);
    expect(card('airport')).toEqual(['Airport', '45,000 CR', '6×6 · loud']);
    expect(card('spaceport')).toEqual(['Spaceport', '150,000 CR', '6×6 · slow build']);
    expect(card('academy')).toEqual(['Academy', '3,200 CR', '2×2 · schools']);
    // MEGACITY §5.2, §7.1: one job each for the three links.
    expect(toolMeta('skybridge').meta).toBe('Walkway · tap 2 towers');
    expect(toolMeta('rail').meta).toBe('Trains · drag');
    expect(toolMeta('skyway').meta).toBe('Cars · drag');
    expect(costLabel(toolMeta('skybridge'))).toBe('from 1,450 CR');
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
    w.maxPopulation = 15000; // Back Alley + Avenue
    expect(roadButton('res', false, 'avenue', unlockedIn(w))).toEqual({ tool: 'avenue', tray: 'open' });
    expect(roadButton('inspect', false, 'highway', unlockedIn(w))).toEqual({ tool: 'road', tray: 'open' });
  });

  it('rules 2 and 3: a road tool active → the button toggles the tray, the tool stays', () => {
    const w = flat();
    w.maxPopulation = 60000;
    for (const t of ROAD_TOOLS) {
      expect(roadButton(t, false, 'road', unlockedIn(w))).toEqual({ tool: null, tray: 'open' });
      expect(roadButton(t, true, 'road', unlockedIn(w))).toEqual({ tool: null, tray: 'close' });
    }
  });

  it('one tap on Road lays a street; Street → Avenue takes two taps (Road, Avenue)', () => {
    const w = flat();
    w.maxPopulation = 20000;
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
    w.maxPopulation = 15000;
    expect(nextRoadTool('road', u)).toBe('alley');
    expect(nextRoadTool('alley', u)).toBe('avenue');
    expect(nextRoadTool('avenue', u)).toBe('road');
    w.maxPopulation = 50000;
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
    expect(categoryChrome(road, 999_999).label).toBe('Road');
  });

  it('the banner names trays the way the unlock news does', () => {
    expect(trayName(BUILDINGS.reactor, INFRA_POP - 1)).toBe('Power');
    expect(trayName(BUILDINGS.reactor, INFRA_POP)).toBe('Infra');
    expect(trayName(BUILDINGS.seaport, INFRA_POP)).toBe('Infra');
    // ×10 units (MEGACITY §4.4).
    expect(trayName(BUILDINGS.academy, 15000)).toBe('Civic');
    expect(trayName(BUILDINGS.spire, 120_000)).toBe('Sky');
    // MEGACITY §7.7 item 6: the tray and its chip.
    expect(bannerUnlocks(5000, 15000)).toEqual(expect.arrayContaining(['Academy (Civic · Learning)', 'Avenue (Road)', 'Back Alley (Road)']));
    expect(bannerUnlocks(15000, 50000)).toEqual(expect.arrayContaining(['Seaport (Infra · Ports)', 'Highway (Road)']));
    expect(bannerUnlocks(50000, 120_000)).toEqual(expect.arrayContaining(['Airport (Infra · Ports)', 'Skyway (Sky · Links)']));
    expect(bannerUnlocks(120_000, 300_000)).toContain('Spaceport (Infra · Ports)');
    expect(bannerUnlocks(50000, 120_000)).toContain('Med Tower (Civic · Safety)');
    // No On-ramp line (it comes with the Highway) and no gated story buildings.
    for (const s of bannerUnlocks(0, 999_999)) expect(s.startsWith('On-ramp')).toBe(false);
    for (const t of BUILDING_ORDER) if (BUILDINGS[t].gate) expect(bannerUnlocks(0, 999_999).some((s) => s.startsWith(BUILDINGS[t].name + ' ('))).toBe(false);
  });

  it('the feed names the tray and its chip in unlock news (§7.7 item 6), from the sim\'s own lines', () => {
    // The sim's advisor writes "Unlocked: Canopy Park (Civic). …"; the ticker and the City feed show the chip too.
    const w = flat();
    const adv = new Advisor();
    // Every line the advisor writes (the feed itself keeps only the latest few).
    const lines: string[] = [];
    const add = w.addNews.bind(w);
    w.addNews = (text, kind) => {
      if (text.startsWith('Unlocked: ')) lines.push(text);
      return add(text, kind);
    };
    w.maxPopulation = 0;
    adv.milestones(w, 0);
    w.maxPopulation = 999_999;
    adv.milestones(w, 0);
    expect(lines.length).toBeGreaterThanOrEqual(12);
    let chipped = 0;
    for (const t of lines) {
      const shown = chipNews(t, w.maxPopulation);
      // The description after the name is kept word for word.
      expect(shown.slice(shown.indexOf(').') + 2)).toBe(t.slice(t.indexOf(').') + 2));
      const name = /^Unlocked: (.+?) \(/.exec(t)![1];
      const def = BUILDING_ORDER.map((k) => BUILDINGS[k]).find((d) => d.name === name);
      if (def) {
        expect(shown).toContain(`Unlocked: ${name} (${traySpot(def, w.maxPopulation)}).`);
        if (traySpot(def, w.maxPopulation).includes(' · ')) chipped++;
      } else if (name === 'Skyway') expect(shown).toContain('(Sky · Links).');
      else expect(shown).toBe(t); // road kinds: "(Road)"
    }
    expect(chipped).toBeGreaterThanOrEqual(6);
    expect(chipNews('Unlocked: Med Tower (Civic). A hospital tower.', 999_999)).toBe('Unlocked: Med Tower (Civic · Safety). A hospital tower.');
    expect(chipNews('Unlocked: Canopy Park (Civic). Trees.', 999_999)).toBe('Unlocked: Canopy Park (Civic · Parks). Trees.');
    // Anything else passes through.
    for (const t of ['Brownout in the Flats.', 'Unlocked: Nothing Real (Civic). x', 'Unlocked: Avenue (Road). Wide.']) expect(chipNews(t, 999_999)).toBe(t);
  });

  it('a skybridge Undo toast names only the build while the pill flashes the payoff (§5.4 step 3)', () => {
    expect(payoffToast('Skybridge built · 524 walkers · cars −20%')).toBe('Skybridge built');
    expect(payoffToast('2 skybridges built · 1,048 walkers · cars −25%')).toBe('2 skybridges built');
    expect(payoffToast('Skybridge built')).toBe('Skybridge built');
    expect(payoffToast('Too late to undo')).toBe('Too late to undo');
    expect(payoffToast('Avenue built · 12 tiles')).toBe('Avenue built · 12 tiles');
  });
});

describe('action pill (§7.5)', () => {
  it('folds counts into the name: Street ×12, Avenue ×6 · 6 widened, Demolish skyway ×n', () => {
    const w = flat();
    w.funds = 1e7;
    w.maxPopulation = 130_000;
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
    // Skybridges (MEGACITY §5.4): one bridge by its name, a two-bridge route as "2 Skybridges".
    const one = { tool: 'skybridge', tiles: [{ x: 1, y: 1, ok: true }], cost: 1450, valid: true } as ActionPlan;
    expect(pillLabel(w, one)).toBe('Skybridge');
    const route = { ...one, cost: 3100, route: { via: { x: 2, y: 2 }, second: { ax: 2, ay: 2, bx: 2, by: 6, gap: 3 } } } as ActionPlan;
    expect(pillLabel(w, route)).toBe('2 Skybridges');
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

    it('the City map takes over the grant tip: resolved on open (never shown again), the map tip at once; dropped unseen on close', () => {
      const slot = fakeDocument().createElement('div');
      let blockedFor: TipId | null = null;
      const tips = new Tips(slot as unknown as HTMLElement, (id) => id === blockedFor);
      tips.show('grant');
      tips.update(0.25);
      expect(tips.showing).toBe('grant');
      // The player opens the map: the grant tip is done, the map's own tip shows with no gap.
      tips.resolve('grant');
      tips.onCityMap();
      tips.update(0.25);
      expect(tips.showing).toBe('citymap');
      tips.show('grant');
      expect(tips.pending).toEqual(['citymap']);
      // Closing the map after it showed: seen.
      tips.drop('citymap');
      expect(tips.showing).toBeNull();
      tips.onCityMap();
      expect(tips.pending).toEqual([]);
      // A tip blocked for its own id waits (the City map holds every other tip back) and is not dropped.
      blockedFor = 'annexed';
      tips.show('annexed');
      tips.update(5);
      tips.update(0.25);
      expect(tips.showing).toBeNull();
      blockedFor = null;
      // The quiet gap after the map tip runs only while nothing blocks, then the tip shows.
      for (let t = 0; t < TIP_GAP + 0.25; t += 0.25) tips.update(0.25);
      expect(tips.showing).toBe('annexed');
    });

    it('a queued map tip that never showed is dropped unseen and comes back on the next open', () => {
      const slot = fakeDocument().createElement('div');
      const tips = new Tips(slot as unknown as HTMLElement, () => true);
      tips.onCityMap();
      tips.update(0.25);
      expect(tips.showing).toBeNull();
      tips.drop('citymap');
      expect(tips.pending).toEqual([]);
      tips.onCityMap();
      expect(tips.pending).toEqual(['citymap']);
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

// ── Megacity trays (MEGACITY §7.1) ───────────────────────────────────────────
import { SECTIONS, cardCondition, cardState, sectionOf, traySections } from '../src/ui/tools';
import { adjacentLocked } from '../src/game/districts/slots';
import { World as RegionWorld } from '../src/game/world';

describe('tray section chips and rumoured cards (MEGACITY §7.1)', () => {
  it('at most 4 chips a tray and 6 cards a chip; the chips hold exactly the tray items; still 9 buttons', () => {
    expect(CATEGORIES.length).toBe(9);
    for (const c of CATEGORIES) {
      const secs = SECTIONS[c.id];
      if (!secs) continue;
      expect(secs.length, c.id).toBeLessThanOrEqual(4);
      for (const sec of secs) expect(sec.items.length, `${c.id}/${sec.id}`).toBeLessThanOrEqual(6);
      expect(secs.flatMap((x) => x.items).sort()).toEqual([...(c.items ?? [])].sort());
      for (const sec of secs) for (const t of sec.items) expect(sectionOf(t)).toBe(sec.id);
    }
    expect(SECTIONS.services!.map((x) => x.label)).toEqual(['Safety', 'Parks', 'Learning', 'Transit & works']);
    expect(SECTIONS.sky!.map((x) => x.label)).toEqual(['Towers', 'Links', 'Landmarks']);
    expect(SECTIONS.deals!.map((x) => x.label)).toEqual(['Buildings', 'Landmarks', 'Legacy']);
    expect(SECTIONS.power!.map((x) => x.label)).toEqual(['Power', 'Ports']);
    expect(SECTIONS.sky![1].items).toEqual(['skybridge', 'rail', 'skyway']);
  });

  it('hidden types never reach a tray; the Legacy chip appears only after an ending, with that ending landmark only', () => {
    const w = RegionWorld.generate(5, 'Trays', undefined, 3);
    for (const t of ['frame', 'pumphall'] as const) expect(cardState(w, t)).toBe('hidden');
    for (const t of BUILDING_ORDER) if (BUILDINGS[t].hidden) expect(cardState(w, t), t).toBe('hidden');
    expect(traySections(w, 'deals').some((x) => x.section.id === 'legacy')).toBe(false);
    w.story.ending = 'ironwork';
    const legacy = traySections(w, 'deals').find((x) => x.section.id === 'legacy');
    expect(legacy?.cards).toEqual(['gantry']);
    for (const t of ['glasssmile', 'breadpier', 'recordtower', 'stillsquare'] as const) expect(cardState(w, t)).toBe('hidden');
  });

  it('a district-bound type stays hidden until its district is owned or next door, then shows greyed with its condition', () => {
    for (let seed = 1; seed < 300; seed++) {
      const w = RegionWorld.generate(seed, 'Rumour', undefined, 3);
      const wet = new Set(['shoals', 'sunk', 'reedmere']);
      const near = adjacentLocked(w).some((s) => wet.has(w.districts.kinds[s]));
      expect(cardState(w, 'pumphouse')).toBe(near ? 'rumoured' : 'hidden');
      if (near) {
        expect(cardCondition(w, 'pumphouse')).toBe('Needs the Shoals, the Sunk or Reedmere');
        return;
      }
    }
    throw new Error('no seed with a wet district next to the start');
  });

  it('a population lock below half its unlock is hidden for landmarks, a plain locked card for services', () => {
    const w = RegionWorld.generate(9, 'Rumour', undefined, 3);
    w.maxPopulation = 0;
    expect(cardState(w, 'reactor')).toBe('locked');
    expect(cardState(w, 'arena')).toBe('hidden'); // hidden type, whatever the population
    expect(['hidden', 'rumoured']).toContain(cardState(w, 'kitemast'));
    expect(cardState(w, 'solar')).toBe('open');
  });
});

// ── Megacity settings, help and tips (MEGACITY §7.6, §7.7, Appendix A) ─────────
import { HELP_MEGA, LOWER_DETAIL_DESC, TOGGLES, cityLine } from '../src/ui/menu';
import { newsTip } from '../src/ui/tips';
import { cityLifeOn, crowdsOn, weatherOf, weatherPatch } from '../src/game/settings';

describe('settings rows (MEGACITY §7.6)', () => {
  it('Weather replaces the Rain toggle; Crowds and City life are switches; City life sits after City events', () => {
    const keys = TOGGLES.map((t) => t.key);
    expect(keys).not.toContain('rain');
    expect(keys).toContain('crowds');
    expect(keys.indexOf('cityLife')).toBe(keys.indexOf('events') + 1);
    for (const t of TOGGLES) expect(t.desc.length, t.key).toBeGreaterThan(0);
    // The "unknown reads as default" rules the switches show.
    expect(weatherOf({ rain: true })).toBe('full');
    expect(weatherOf({ rain: false })).toBe('off');
    expect(weatherPatch('light')).toEqual({ weather: 'light', rain: true });
    expect(weatherPatch('off')).toEqual({ weather: 'off', rain: false });
    expect(crowdsOn({ quality: 'high' })).toBe(true);
    expect(crowdsOn({ quality: 'low' })).toBe(false);
    expect(cityLifeOn({})).toBe(true);
  });

  it('the read-only City line names the size; the Lower detail line is the §7.6 copy', () => {
    expect(cityLine('Neon Bay', 5)).toBe('Neon Bay · 5×5 region · 25 districts');
    expect(cityLine('Neon Bay', 3)).toBe('Neon Bay · 3×3 region · 9 districts');
    expect(LOWER_DETAIL_DESC).toBe('Far districts rest, no weather or crowds, lower top speed. For big cities on phones.');
  });

  it('help steps 15 and 16 are the §7.7 copy', () => {
    expect(HELP_MEGA.map((s) => s.title)).toEqual(['15 · Grow beyond the shore', '16 · Bridge the towers']);
    expect(HELP_MEGA[1].body).toBe('Pick Skybridge and tap a tall tower: its lanes light up. Tap a glowing partner to link them. Three linked towers make a Sky Lobby.');
  });

  it('the Megacity tips are Appendix A verbatim, ≤ 110 characters; the advisor lines raise the sim tips', () => {
    for (const id of ['grant', 'citymap', 'annexed', 'skybridge', 'skylobby', 'frame', 'pumphouse', 'sponsor', 'legacy', 'floodplain', 'brownfield', 'ruins'] as const) {
      expect(TIPS[id].text.length, id).toBeLessThanOrEqual(110);
      expect(icon(TIPS[id].icon), id).not.toContain('undefined');
    }
    expect(TIPS.grant.text).toBe('You earned a land grant. Open the City map to choose where your city grows next.');
    expect(toolTip('skybridge')).toBe('skybridge');
    expect(toolTip('pumphouse')).toBe('pumphouse');
    expect(toolTip('spire')).toBe('sponsor');
    expect(newsTip("Advisor: Reedmere's floodplain holds homes at level 2. A Floodwatch Station lifts the limit.")).toBe('floodplain');
    expect(newsTip('Advisor: brownfield smog over Kessel Flats. Build on it, or add parks and a Reclaim Works.')).toBe('brownfield');
    expect(newsTip('Advisor: ruins in the Sunk come back as homes with a road and power.')).toBe('ruins');
    expect(newsTip('Night market in Paper Lane tonight.')).toBeNull();
  });
});
