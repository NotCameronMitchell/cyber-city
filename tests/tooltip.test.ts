// MEGACITY §14.2 / §14.5 item 3: tooltips after 450 ms (150 ms warm), the content of every target of the table, never
// on touch or pen, never while dragging or with a modal open, placed under a button or beside the cursor and kept off
// the side panel.

import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS, LOW_DETAIL, ZONES } from '../src/game/config';
import { Game } from '../src/game/game';
import { RoadKind, ZoneType } from '../src/game/types';
import {
  TIP_DELAY_MS,
  TIP_MAP_DX,
  TIP_MAP_DY,
  TIP_WARM_MS,
  TIP_WARM_WINDOW_MS,
  TipClock,
  cardTip,
  hudTip,
  mapTip,
  slotTip,
  tipBlocked,
  tipPosition,
  toolbarTip,
} from '../src/ui/tooltip';
import { cachedMegacity } from './megacity-fixture';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('TipClock (§14.2 timing)', () => {
  it('shows after 450 ms over the same target, not before', () => {
    const c = new TipClock();
    c.hover('cat:zones', 1000, true);
    expect(c.due(1000 + TIP_DELAY_MS - 1)).toBe(false);
    expect(c.due(1000 + TIP_DELAY_MS)).toBe(true);
    expect(TIP_DELAY_MS).toBe(450);
  });

  it('moving to another toolbar button or tray card within a second of the last tooltip: 150 ms', () => {
    const c = new TipClock();
    c.hover('cat:zones', 0, true);
    c.shown(true);
    // Crossing the 2 px gap between buttons (no target), then the next button.
    c.hover(null, 600, false);
    c.hover('cat:power', 620, true);
    expect(c.wait).toBe(TIP_WARM_MS);
    expect(c.due(620 + 149)).toBe(false);
    expect(c.due(620 + 150)).toBe(true);
    c.shown(true);
    // Straight from a button to a tray card, the tooltip still up: warm too.
    c.hover('card:reactor', 900, true);
    expect(c.wait).toBe(150);
  });

  it('cold again after a second without a tooltip, and for the HUD and the map (never warm)', () => {
    const c = new TipClock();
    c.hover('cat:zones', 0, true);
    c.shown(true);
    c.hover(null, 500, false);
    c.hover('cat:power', 500 + TIP_WARM_WINDOW_MS + 1, true);
    expect(c.wait).toBe(450);
    const d = new TipClock();
    d.hover('cat:zones', 0, true);
    d.shown(true);
    d.hover('hud:funds', 100, false);
    expect(d.wait).toBe(450);
    d.hover('map:3,4', 200, false);
    expect(d.wait).toBe(450);
  });

  it('a click, wheel or key hides it at once; the same target stays quiet until the pointer moves to another one', () => {
    const c = new TipClock();
    c.hover('cat:zones', 0, true);
    c.shown(true);
    c.dismiss(700);
    expect(c.showing).toBe(false);
    c.hover('cat:zones', 720, true);
    expect(c.due(5000)).toBe(false);
    c.hover('cat:road', 800, true);
    c.hover('cat:zones', 900, true);
    expect(c.due(900 + 450)).toBe(true);
  });

  it('a touch, pen or drag resets it: no warm start after one', () => {
    const c = new TipClock();
    c.hover('cat:zones', 0, true);
    c.shown(true);
    c.reset();
    expect(c.showing).toBe(false);
    c.hover('cat:power', 100, true);
    expect(c.wait).toBe(450);
  });
});

describe('tipBlocked (§14.2): never on touch, never while dragging, never with a modal open', () => {
  const ok = { enabled: true, pointerType: 'mouse', buttons: 0, busy: false, pending: false, modals: 0 };
  it('a mouse that hovers may show one', () => {
    expect(tipBlocked(ok)).toBe(false);
  });
  it('touch and pen never; a held button, a drag or pinch, a plan waiting for ✓, a modal dialog, or tooltips off: none', () => {
    expect(tipBlocked({ ...ok, pointerType: 'touch' })).toBe(true);
    expect(tipBlocked({ ...ok, pointerType: 'pen' })).toBe(true);
    expect(tipBlocked({ ...ok, buttons: 1 })).toBe(true);
    expect(tipBlocked({ ...ok, busy: true })).toBe(true);
    expect(tipBlocked({ ...ok, pending: true })).toBe(true);
    expect(tipBlocked({ ...ok, modals: 1 })).toBe(true);
    expect(tipBlocked({ ...ok, enabled: false })).toBe(true);
  });
});

describe('tipPosition: under a button, beside the cursor on the map, flipped on screen and off the side panel', () => {
  it('centred under a HUD button', () => {
    const p = tipPosition({ left: 100, top: 10, right: 160, bottom: 50, width: 60 }, 0, 0, 120, 40, 1440, 900);
    expect(p).toEqual({ x: 70, y: 56 });
  });
  it('above a toolbar button at the bottom (no room under it)', () => {
    const p = tipPosition({ left: 600, top: 820, right: 676, bottom: 880, width: 76 }, 0, 0, 200, 50, 1440, 900);
    expect(p.y).toBe(820 - 6 - 50);
    expect(p.x).toBe(538);
  });
  it('16 px right of and 20 px below the cursor on the map', () => {
    expect(tipPosition(null, 300, 200, 180, 60, 1440, 900)).toEqual({ x: 300 + TIP_MAP_DX, y: 200 + TIP_MAP_DY });
  });
  it('left of the cursor when it would cover the side panel (right edge = the panel left), above it at the bottom', () => {
    const panelLeft = 1440 - 12 - 403 - 8;
    const p = tipPosition(null, 950, 880, 180, 60, 1440, 900, panelLeft);
    expect(p.x + 180).toBeLessThanOrEqual(panelLeft);
    expect(p.x).toBe(950 - TIP_MAP_DX - 180);
    expect(p.y).toBe(880 - TIP_MAP_DY - 60);
  });
});

describe('tooltip content (§14.2 table)', () => {
  let game: Game;
  beforeAll(() => {
    const w = cachedMegacity(3, 4);
    w.districts.grants = 1;
    game = new Game();
    expect(game.restore(clone(w.serialize()))).toBe(true);
  });

  it('a toolbar button: name and key, and what it holds', () => {
    expect(toolbarTip('zones', game)).toEqual({ title: 'Zones · Z X C', lines: [`${ZONES.res.name}, ${ZONES.com.name}, ${ZONES.ind.name}`] });
    expect(toolbarTip('bulldoze', game).title).toBe('Bulldoze · B');
    expect(toolbarTip('inspect', game).title).toBe('Inspect · Esc');
    expect(toolbarTip('data', game).title).toBe('Data · O');
    expect(toolbarTip('sky', game)).toEqual({ title: 'Sky · T', lines: ['Towers, Links, Landmarks'] });
    expect(toolbarTip('services', game).title).toBe('Services · V');
    expect(toolbarTip('services', game).lines[0]).toContain('Safety');
    expect(toolbarTip('road', game).lines[0]).toMatch(/^Street now; Street, /);
  });

  it('a tray card: name and key, cost, power, upkeep a month, jobs, effect and radius, size; the locked reason', () => {
    const r = cardTip('reactor', game);
    const def = BUILDINGS.reactor;
    expect(r.title).toBe(def.name);
    expect(r.lines.join(' | ')).toContain(`${def.powerSupply.toLocaleString('en-US')} MW`);
    expect(r.lines.join(' | ')).toContain('CR a month');
    expect(r.lines.join(' | ')).toContain(`${def.size}×${def.size}`);
    const clinic = cardTip('clinic', game).lines.join(' | ');
    expect(clinic).toContain(`Health r${BUILDINGS.clinic.radius}`);
    const street = cardTip('road', game);
    expect(street.title).toBe('Street · R');
    expect(street.lines[0]).toMatch(/CR a tile/);
    expect(cardTip('res', game).title).toBe(`${ZONES.res.name} · Z`);
    expect(cardTip('com', game).title).toBe(`${ZONES.com.name} · X`);
    expect(cardTip('ind', game).title).toBe(`${ZONES.ind.name} · C`);
    // A locked card says why (an ending landmark is locked before any ending).
    const locked = cardTip('gantry', game);
    expect(locked.lines.length).toBeGreaterThan(1);
  });

  it('the HUD: treasury, population and jobs, the demand words, speed with its key (and the lower-detail cap), menu, City map · M', () => {
    const f = hudTip('funds', game);
    expect(f.title).toBe('Treasury');
    expect(f.lines).toEqual([expect.stringMatching(/CR a month$/), 'Click for the budget']);
    const p = hudTip('pop', game);
    expect(p.title).toMatch(/residents$/);
    expect(p.lines).toEqual([expect.stringMatching(/jobs$/), 'Click for the report']);
    expect(hudTip('rci', game).lines.map((l) => l.split(':')[0])).toEqual([ZONES.res.name, ZONES.com.name, ZONES.ind.name]);
    expect(hudTip('speed3', game).title).toBe('Fastest · 3');
    expect(hudTip('speed0', game).title).toBe('Pause · Space');
    expect(hudTip('menu', game).title).toBe('Menu');
    expect(hudTip('map', game).title).toBe('City map · M');
    const low = Object.create(game) as Game;
    Object.defineProperty(low, 'lowerDetail', { get: () => true });
    expect(hudTip('speed3', low).title).toBe(`Fastest · 3 · ${LOW_DETAIL.maxDaysPerSec} days a second`);
  });

  it('a building on the map: name and district, 2-3 key rows, Click for details', () => {
    const w = game.world;
    const b = [...w.buildings.values()].find((x) => BUILDINGS[x.type].jobs > 0 && w.isOwned(x.x, x.y))!;
    const t = mapTip(game, { sx: 10, sy: 10, x: b.x, y: b.y, mapView: false, slot: w.slotAt(b.x, b.y) })!;
    expect(t.title.startsWith(game.getTileInfo(b.x, b.y)!.title)).toBe(true);
    expect(t.title).toContain(' · '); // a multi-district city names the district
    expect(t.lines[t.lines.length - 1]).toBe('Click for details');
    expect(t.lines.length).toBeGreaterThanOrEqual(3);
    expect(t.lines.length).toBeLessThanOrEqual(4);
  });

  it('a zone tile: form and floors, residents or jobs, wealth, land value', () => {
    const w = game.world;
    let at: { x: number; y: number } | null = null;
    for (let i = 0; i < w.area && !at; i++) {
      const t = w.tiles[i];
      if (t.zone === ZoneType.Residential && t.level >= 2 && !t.abandoned && t.buildingId < 0) at = { x: i % w.N, y: (i / w.N) | 0 };
    }
    expect(at).not.toBeNull();
    const t = mapTip(game, { sx: 0, sy: 0, ...at!, mapView: false, slot: w.slotAt(at!.x, at!.y) })!;
    expect(t.title).toMatch(/floors$/);
    expect(t.lines.some((l) => /residents$/.test(l))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('Wealth '))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('Land value '))).toBe(true);
  });

  it('a road: kind and traffic in a word', () => {
    const w = game.world;
    let at = -1;
    for (let i = 0; i < w.area && at < 0; i++) if (w.tiles[i].road && w.tiles[i].roadKind === RoadKind.Street && w.tiles[i].terrain === 0 && w.tiles[i].buildingId < 0 && w.isOwned(i % w.N, (i / w.N) | 0)) at = i;
    const x = at % w.N;
    const y = (at / w.N) | 0;
    const t = mapTip(game, { sx: 0, sy: 0, x, y, mapView: false, slot: w.slotAt(x, y) })!;
    expect(t.title).toMatch(/^Street · (quiet|steady|busy|jammed)$/);
  });

  it('a locked district: its name and state, and that a click opens the City map; a City map slot: name, state, price or grant, census', () => {
    const w = game.world;
    const v = game.districtView();
    const cand = v.slots.find((s) => s.state === 'candidate')!;
    const r = { x: (cand.slot % w.region) * 64 + 32 + (w.N - w.region * 64) / 2, y: Math.floor(cand.slot / w.region) * 64 + 32 + (w.N - w.region * 64) / 2 };
    expect(w.isOwned(r.x, r.y)).toBe(false);
    const t = mapTip(game, { sx: 0, sy: 0, ...r, mapView: false, slot: cand.slot })!;
    expect(t.title).toBe(cand.name);
    expect(t.lines[0]).toBe('Annex with a land grant');
    expect(t.lines[t.lines.length - 1]).toBe('Click to open the City map');
    const owned = v.slots.find((s) => s.state === 'owned' && s.census)!;
    const o = slotTip(game, owned.slot)!;
    expect(o.title).toBe(owned.name);
    expect(o.lines[0]).toBe('Part of the city');
    expect(o.lines[1]).toMatch(/residents · .* jobs$/);
    const onMap = mapTip(game, { sx: 0, sy: 0, x: 0, y: 0, mapView: true, slot: cand.slot })!;
    expect(onMap.lines).toContain(cand.price.text);
  });
});
