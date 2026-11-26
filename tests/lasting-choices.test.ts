// Choices that last (docs/MEGACITY.md §9.6, WP-8): the marks every key choice leaves (§9.3), derived and never
// saved; the skyline takeover and the ending history (§9.2); the ending landmarks and their dormant terms; the
// epilogue grant clock (§9.5); the Charter Review's callback lines (§9.4); the epilogue deck in play; a v3 post-ending
// save. The copy lint is tests/story/lasting-lint.test.ts.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lockedReason } from '../src/game/actions';
import { REGION, STORY_PACE, STORY_PACING } from '../src/game/config';
import { slotRect, startSlotOf } from '../src/game/districts/slots';
import { Game } from '../src/game/game';
import { deriveMarks, lanternBands, markCellName, markTitle, plaquesAt, skylineLang, skylineShares, sunkTagline, TAKEOVER } from '../src/game/marks';
import { BREAD_PIER_TURF, pierCrime, pierProtect } from '../src/game/story/landmarkTerms';
import * as turf from '../src/game/story/turf';
import { districtName } from '../src/game/news';
import { EPILOGUE_DECK, LANDMARK_CARD_ENDING } from '../src/game/story/content/cards/epilogue';
import { GENERIC_REVIEW_LINE, REVIEW_LINES, SUNK_TAGLINES } from '../src/game/story/content/epilogue';
import { cardEligible } from '../src/game/story/pacing';
import type { Mark, StoryState } from '../src/game/story/types';
import { Terrain, ZoneType, type BuildingType, type Region } from '../src/game/types';
import { World } from '../src/game/world';
import { artOffset } from '../src/game/districts/slots';

const YEAR = 360;
const V3_ENDING = (import.meta.glob('./fixtures/v3-ending.json', { import: 'default', eager: true }) as Record<string, unknown>)['./fixtures/v3-ending.json'];

// ── Fixture: a generated 3×3 city owning every district, with the buildings the marks read ──

/** A free all-land, building-free, road-free square of `size` inside the slot, scanning from its centre outward. */
function freeSquare(w: World, slot: number, size: number, avoid: Set<number>): { x: number; y: number } | null {
  const r = slotRect(w, slot);
  const cx = (r.x0 + r.x1) >> 1;
  const cy = (r.y0 + r.y1) >> 1;
  for (let k = 0; k < 32; k++)
    for (let y = cy - k; y <= cy + k; y++)
      for (let x = cx - k; x <= cx + k; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== k) continue;
        if (x < r.x0 + 1 || y < r.y0 + 1 || x + size > r.x1 || y + size > r.y1) continue;
        let ok = true;
        for (let dy = -1; ok && dy <= size; dy++)
          for (let dx = -1; ok && dx <= size; dx++) {
            const i = (y + dy) * w.N + x + dx;
            const t = w.tiles[i];
            ok = t.terrain === Terrain.Land && t.buildingId < 0 && !t.road && t.zone === ZoneType.None && !avoid.has(i);
          }
        if (ok) return { x, y };
      }
  return null;
}

interface City {
  w: World;
  hall: { x: number; y: number };
  at: Partial<Record<BuildingType, { id: number; x: number; y: number; size: number }>>;
  seam: number;
}

function buildCity(region: Region = 3, seed = 1234): City {
  const w = World.generate(seed, 'Keepsake Bay', undefined, region);
  for (let s = 0; s < region * region; s++) if (!w.slotOwned[s]) w.annex(s);
  w.funds = 1e9;
  const start = startSlotOf(w);
  const sunk = w.districts.kinds.indexOf('sunk');
  const hallB = [...w.buildings.values()].find((b) => b.type === 'pumphall')!;
  const at: City['at'] = {};
  const used = new Set<number>();
  const put = (type: BuildingType, slot = start) => {
    const s = freeSquare(w, slot, BUILDINGS_SIZE[type] ?? 2, used);
    if (!s) throw new Error(`no room for ${type}`);
    const b = w.addBuilding(type, s.x, s.y)!;
    for (let dy = -1; dy <= b.size; dy++) for (let dx = -1; dx <= b.size; dx++) used.add((s.y + dy) * w.N + s.x + dx);
    at[type] = b;
    return b;
  };
  for (const t of ['commons', 'charterhall', 'foundry', 'glarewall', 'plaza', 'kitemast', 'maglev'] as BuildingType[]) put(t);
  put('memorial', sunk);
  // A street through Charter Shore's centre, rails beside the Maglev, three developed blocks, a skybridge record.
  const r = slotRect(w, start);
  for (let x = r.x0 + 2; x <= r.x1 - 2; x++) if (!used.has(((r.y0 + 20) * w.N) + x) && w.tiles[(r.y0 + 20) * w.N + x].terrain === Terrain.Land) w.setRoad(x, r.y0 + 20);
  const mg = at.maglev!;
  w.rail[mg.y * w.N + mg.x - 1] = 1;
  let blocks = 0;
  for (let y = r.y0 + 22; y < r.y1 && blocks < 12; y += 2)
    for (let x = r.x0 + 4; x < r.x1 && blocks < 12; x += 3) {
      const t = w.tiles[y * w.N + x];
      if (t.terrain !== Terrain.Land || t.buildingId >= 0 || t.road || used.has(y * w.N + x)) continue;
      w.setZone(x, y, ZoneType.Residential);
      w.setLevel(x, y, 2, false, 0);
      blocks++;
    }
  w.links.push({ id: 7, ax: r.x0 + 30, ay: r.y0 + 30, bx: r.x0 + 33, by: r.y0 + 30 });
  const seam = (r.y0 + 20) * w.N + r.x0 + 32;
  w.story.seam = seam;
  return { w, hall: { x: hallB.x, y: hallB.y }, at, seam };
}
const BUILDINGS_SIZE: Partial<Record<BuildingType, number>> = { commons: 2, charterhall: 3, foundry: 2, glarewall: 2, plaza: 1, kitemast: 2, maglev: 1, memorial: 2 };

let city: City;
let base: StoryState;
beforeAll(() => {
  city = buildCity();
  base = JSON.parse(JSON.stringify(city.w.story));
});
beforeEach(() => {
  city.w.story = JSON.parse(JSON.stringify(base));
});

const find = (w: World, id: string): Mark | undefined => deriveMarks(w).list.find((m) => m.id === id);
const covers = (m: Mark | undefined, x: number, y: number) => !!m && x >= m.x && y >= m.y && x < m.x + m.w && y < m.y + m.h;
const cellOf = (w: World, i: number) => {
  const ao = artOffset(w);
  return [((i % w.N) - ao) >> 3, (((i / w.N) | 0) - ao) >> 3] as const;
};

// ── 1. Every §9.3 row ───────────────────────────────────────────────────────

describe('§9.6 item 1: every key choice leaves exactly its mark, at its place; clearing it removes it', () => {
  type Row = { name: string; set: (st: StoryState) => void; id: string; decal: string | RegExp; at?: (c: City) => [number, number]; plaque: string };
  const bAt = (t: BuildingType) => (c: City): [number, number] => [c.at[t]!.x, c.at[t]!.y];
  const hallAt = (c: City): [number, number] => [c.hall.x + 1, c.hall.y + 1];
  const seamAt = (c: City): [number, number] => [c.seam % c.w.N, (c.seam / c.w.N) | 0];
  const rows: Row[] = [
    { name: "ch1.lark 'M.O.T.H.'", set: (s) => (s.flags.larkKnows = true, s.keyChoices['ch1.lark'] = 0), id: 'larkKite', decal: 'kite', at: bAt('kitemast'), plaque: "lark's kite: she flies it for you." },
    { name: 'ep.kite ping back', set: (s) => (s.flags.larkKnows = true, s.flags.kiteHello = true), id: 'larkKite', decal: 'kite:2', at: bAt('kitemast'), plaque: "lark's kite: she flies it for you." },
    { name: "ch1.lark 'Stay dark.'", set: (s) => (s.keyChoices['ch1.lark'] = 1), id: 'deadChannel', decal: 'relay', plaque: 'A dead pump channel. Nothing pings back.' },
    { name: 'ch1.lark clerk', set: (s) => (s.flags.clerkLie = true, s.keyChoices['ch1.lark'] = 2), id: 'clerkNine', decal: 'plaque', at: bAt('commons'), plaque: 'Permits: Clerk No. 9.' },
    { name: 'ch2.vote Basalt', set: (s) => (s.keyChoices['ch2.vote'] = 0, s.flags.patron = 'basalt'), id: 'patronBasalt', decal: 'banner', at: bAt('foundry'), plaque: 'Ground broken on a projection.' },
    { name: 'ch2.vote Nacre', set: (s) => (s.keyChoices['ch2.vote'] = 1, s.flags.patron = 'nacre'), id: 'patronNacre', decal: 'banner', at: bAt('glarewall'), plaque: 'Delight, as projected.' },
    { name: 'ch2.vote honest tie', set: (s) => (s.keyChoices['ch2.vote'] = 2, s.flags.honestTie = true), id: 'honestTie', decal: 'banner', at: bAt('plaza'), plaque: 'Four to four. The terminal told the truth.' },
    { name: 'ch3.pier Clean Glass', set: (s) => (s.flags.cleanGlass = true), id: 'cleanGlassMast', decal: 'mast', at: seamAt, plaque: 'Operation Clean Glass began here.' },
    { name: 'ch3.pier Seam Truce', set: (s) => (s.flags.truce = true), id: 'truceWall', decal: 'mural', at: seamAt, plaque: 'The crews signed the Seam Truce here.' },
    { name: 'ep.seam lights the Truce Wall', set: (s) => (s.flags.truce = true, s.flags.seamFair = true), id: 'truceWall', decal: 'mural:lit', at: seamAt, plaque: 'The crews signed the Seam Truce here.' },
    { name: 'ch3.winner Undertow', set: (s) => (s.flags.oneTide = 'undertow'), id: 'lowWater', decal: 'nets', at: seamAt, plaque: 'The Undertow took the Seam here.' },
    { name: 'ch3.winner Kites', set: (s) => (s.flags.oneTide = 'kites'), id: 'highLine', decal: 'highline', at: seamAt, plaque: 'The Kites took the Seam here.' },
    { name: 'ch4.brine publish', set: (s) => (s.flags.published = true), id: 'openHall', decal: 'hall:open', at: hallAt, plaque: 'Open to all. The names are read here every year.' },
    { name: 'ep.names lamps', set: (s) => (s.flags.published = true, s.flags.namesLit = true), id: 'openHall', decal: 'hall:open:lit', at: hallAt, plaque: 'Open to all. The names are read here every year.' },
    { name: 'ch4.brine bury', set: (s) => (s.flags.buried = true), id: 'privateWorks', decal: 'hall:fence', at: hallAt, plaque: 'Private works. No entry.' },
    { name: 'ep.fence pour', set: (s) => (s.flags.buried = true, s.flags.hallPoured = true), id: 'pouredSlab', decal: 'hall:slab', at: hallAt, plaque: 'Private works. One slab, poured over the file.' },
    { name: 'ep.fence open after all', set: (s) => (s.flags.buried = true, s.flags.hallOpened = true), id: 'openHall', decal: 'hall:open', at: hallAt, plaque: 'Open to all. The names are read here every year.' },
    { name: 'ch4.brine leash', set: (s) => (s.flags.leashed = true), id: 'archive', decal: 'hall:archive', at: hallAt, plaque: 'Board archive. Key held by the Chair.' },
    { name: 'ep.leash unleashed', set: (s) => (s.flags.leashed = true, s.flags.unleashed = true), id: 'openHall', decal: 'hall:open', at: hallAt, plaque: 'Open to all. The names are read here every year.' },
    { name: 'coda.recall Stay', set: (s) => (s.flags.fullRecall = true), id: 'everyLamp', decal: 'hall:lamps', at: hallAt, plaque: 'Every lamp lit.' },
    { name: 'the reveal and the Sunk', set: (s) => (s.seen['ch4.logs'] = 100), id: 'lowerWards', decal: 'memorial', at: bAt('memorial'), plaque: 'The names face the water here.' },
    { name: 'ch5 sign with the patron', set: (s) => (s.flags.lure = 'shelved', s.flags.patron = 'basalt'), id: 'livery', decal: 'livery:basalt', plaque: 'Lit under contract.' },
    { name: 'ch5 go to ground', set: (s) => (s.flags.wentToGround = true, s.flags.lure = 'running'), id: 'darkBlocks', decal: /^dark:\d+\.\d+\.\d+$/, plaque: 'Something hums here after midnight.' },
    { name: 'ch5.kept', set: (s) => (s.flags.keptByBoard = true), id: 'balcony', decal: 'balcony', at: bAt('charterhall'), plaque: 'MOTH answers to this room every month.' },
    { name: 'ch5.hidden', set: (s) => (s.flags.hiddenByTuning = true), id: 'ohmDoor', decal: 'hall:door', at: hallAt, plaque: 'A lamp by the door, for next time.' },
    { name: 'kt.paint', set: (s) => (s.flags.mural = true), id: 'crewBridge', decal: 'plaque', plaque: "lark's crew painted this." },
    { name: 'kt.door fen free', set: (s) => (s.flags.fen = 'free'), id: 'fenKites', decal: /^fen:\d+$/, at: bAt('maglev'), plaque: "fen's flying kites off the ribbon now." },
    { name: 'bd.archive', set: (s) => (s.flags.marrowKnows = true), id: 'minutes', decal: 'plaque', at: bAt('charterhall'), plaque: 'Minutes, unedited.' },
  ];
  it.each(rows)('$name', (row) => {
    const w = city.w;
    expect(find(w, row.id)).toBeUndefined();
    row.set(w.story);
    const list = deriveMarks(w).list;
    const m = list.find((k) => k.id === row.id);
    expect(m, row.id).toBeDefined();
    if (typeof row.decal === 'string') expect(m!.decal).toBe(row.decal);
    else expect(m!.decal).toMatch(row.decal);
    expect(m!.plaque).toBe(row.plaque);
    if (row.at) {
      const [x, y] = row.at(city);
      expect(covers(m, x, y), `${row.id} at ${x},${y}`).toBe(true);
    }
    // Exactly that mark: no other row's mark appeared.
    expect(list.filter((k) => !k.id.startsWith('landmark.')).length).toBe(row.id === 'openHall' && w.story.flags.fullRecall ? 2 : 1);
    // Its plaque shows in inspect on the mark's place.
    if (!m!.decal.startsWith('dark:')) expect(plaquesAt(w, m!.x, m!.y)).toContain(row.plaque);
    w.story = JSON.parse(JSON.stringify(base));
    expect(find(w, row.id)).toBeUndefined();
  });

  it('the dead channel stands on Charter Shore\'s shore; the livery and the dark blocks on developed land', () => {
    const w = city.w;
    w.story.keyChoices['ch1.lark'] = 1;
    const m = find(w, 'deadChannel')!;
    const r = slotRect(w, startSlotOf(w));
    expect(m.x >= r.x0 && m.x <= r.x1 && m.y >= r.y0 && m.y <= r.y1).toBe(true);
    const i = m.y * w.N + m.x;
    expect(w.tiles[i].terrain).toBe(Terrain.Land);
    expect([i - 1, i + 1, i - w.N, i + w.N].some((k) => w.tiles[k].terrain === Terrain.Water)).toBe(true);
    w.story.flags.wentToGround = true;
    const d = find(w, 'darkBlocks')!;
    const ids = d.decal.slice(5).split('.').map(Number);
    expect(ids.length).toBe(3);
    for (const k of ids) expect(w.tiles[k].level).toBeGreaterThan(0);
    expect(plaquesAt(w, ids[0] % w.N, (ids[0] / w.N) | 0)).toContain('Something hums here after midnight.');
  });

  it('the Clean Glass mast stands on the nearest street when the Seam falls on water', () => {
    const w = city.w;
    const N = w.N;
    // A water tile beside the Seam street: the Seam moves onto it; the mast keeps to the street.
    const sx = city.seam % N;
    const sy = ((city.seam / N) | 0) + 1;
    const i = sy * N + sx;
    const t = w.tiles[i];
    const keep = { terrain: t.terrain, road: t.road, zone: t.zone, level: t.level };
    t.terrain = Terrain.Water;
    t.road = false;
    t.zone = ZoneType.None;
    t.level = 0;
    try {
      w.story.seam = i;
      w.story.flags.cleanGlass = true;
      const m = find(w, 'cleanGlassMast')!;
      const at = (m.y + (m.h >> 1)) * N + m.x + (m.w >> 1);
      expect(w.tiles[at].terrain).toBe(Terrain.Land);
      expect(w.tiles[at].road).toBe(true);
      expect(Math.max(Math.abs((at % N) - sx), Math.abs(((at / N) | 0) - sy))).toBeLessThanOrEqual(2);
      // The Seam's cell keeps its new name.
      const [cx, cy] = cellOf(w, i);
      expect(markCellName(w.seed, cx, cy)).toBe('Glass Yard');
    } finally {
      Object.assign(t, keep);
      w.story = JSON.parse(JSON.stringify(base));
      deriveMarks(w); // leave no derived name behind for the next test
    }
  });

  it('renames the cell (news, inspect and cards read it through districtName) and swaps the Sunk tagline', () => {
    const w = city.w;
    const [cx, cy] = cellOf(w, city.seam);
    const before = districtName(city.seam % w.N, (city.seam / w.N) | 0, w.seed, artOffset(w));
    w.story.flags.truce = true;
    deriveMarks(w);
    expect(markCellName(w.seed, cx, cy)).toBe('Truce Row');
    expect(districtName(city.seam % w.N, (city.seam / w.N) | 0, w.seed, artOffset(w))).toBe('Truce Row');
    w.story = JSON.parse(JSON.stringify(base));
    deriveMarks(w);
    expect(districtName(city.seam % w.N, (city.seam / w.N) | 0, w.seed, artOffset(w))).toBe(before);
    // The vote names the cell of the oldest Foundry Spine.
    w.story.keyChoices['ch2.vote'] = 0;
    deriveMarks(w);
    const f = city.at.foundry!;
    expect(districtName(f.x, f.y, w.seed, artOffset(w))).toBe('Projection Yard');
    w.story = JSON.parse(JSON.stringify(base));
    expect(deriveMarks(w) && sunkTagline(w)).toBeNull();
    w.story.flags.published = true;
    deriveMarks(w);
    expect(sunkTagline(w)).toBe(SUNK_TAGLINES.open);
    w.story.flags.published = false;
    w.story.flags.buried = true;
    deriveMarks(w);
    expect(sunkTagline(w)).toBe(SUNK_TAGLINES.fenced);
    w.story.flags.buried = false;
    w.story.flags.leashed = true;
    deriveMarks(w);
    expect(sunkTagline(w)).toBe(SUNK_TAGLINES.archive);
  });

  it('a built ending landmark leaves its own mark: built under its ending, dormant while another holds', () => {
    const w = city.w;
    const b = w.addBuilding('stillsquare', ...(Object.values(freeSquare(w, startSlotOf(w), 3, new Set())!) as [number, number]))!;
    w.story.ending = 'quiet';
    expect(find(w, 'landmark.stillsquare')!.plaque).toBe('Built under the Quiet Hand.');
    expect(markTitle(find(w, 'landmark.stillsquare')!)).toBe('The Still Square');
    w.story.ending = 'ledger';
    expect(find(w, 'landmark.stillsquare')!.plaque).toBe('Built under the Quiet Hand. Dormant while another ending holds.');
    // Under Lamplight it is the Lamp Square, built under Lamplight; after a swap it remembers Lamplight.
    w.story.ending = 'quiet';
    w.story.endingVariant = 'lamplight';
    w.story.endingHistory = [{ id: 'quiet', variant: 'lamplight', from: 0, to: null }];
    expect(find(w, 'landmark.stillsquare')!.plaque).toBe('Built under Lamplight.');
    expect(markTitle(find(w, 'landmark.stillsquare')!)).toBe('The Lamp Square');
    w.story.endingHistory = [{ id: 'quiet', variant: 'lamplight', from: 0, to: 100 }, { id: 'ledger', variant: null, from: 100, to: null }];
    w.story.ending = 'ledger';
    w.story.endingVariant = null;
    expect(find(w, 'landmark.stillsquare')!.plaque).toBe('Built under Lamplight. Dormant while another ending holds.');
    expect(markTitle(find(w, 'landmark.stillsquare')!)).toBe('The Still Square');
    w.removeBuilding(b.id);
    expect(find(w, 'landmark.stillsquare')).toBeUndefined();
  });
});

// ── 2. Derived, never saved ──────────────────────────────────────────────────

describe('§9.6 item 2: deriveMarks after a save and load equals deriveMarks live', () => {
  it('every mark, name and tagline comes back from saved state alone', () => {
    const w = city.w;
    const s = w.story;
    Object.assign(s.flags, { larkKnows: true, kiteHello: true, honestTie: true, truce: true, seamFair: true, published: true, namesLit: true, keptByBoard: true, hiddenByTuning: true, fullRecall: true, lure: 'shelved', patron: 'nacre' });
    s.keyChoices['ch2.vote'] = 2;
    s.seen['ch4.logs'] = 50;
    s.ending = 'pearl';
    s.endingTick = 0;
    s.endingHistory = [{ id: 'pearl', variant: null, from: 0, to: null }];
    w.tick = 3 * YEAR;
    const live = deriveMarks(w);
    const json = JSON.stringify(w.serialize());
    expect(json).not.toContain('truceWall'); // marks are never saved
    const back = World.deserialize(JSON.parse(json));
    const loaded = deriveMarks(back);
    expect(loaded.list).toEqual(live.list);
    expect(sunkTagline(back)).toBe(sunkTagline(w));
    // The skyline reads the same bands from the loaded city.
    const r = slotRect(back, 0);
    const ao = artOffset(back);
    const langs = (world: World) => {
      deriveMarks(world);
      const out: (string | null)[] = [];
      for (let y = r.y0; y < r.y0 + 20; y++) for (let x = r.x0; x < r.x0 + 20; x++) out.push(skylineLang(x - ao, y - ao));
      return out;
    };
    expect(langs(back)).toEqual(langs(w));
    w.tick = 0;
  });
});

// ── 3. The skyline takeover and the ending history ──────────────────────────

describe('§9.6 item 3: the ending history sets each ending\'s band; a swap keeps the old towers', () => {
  it('Ironwork for 6 years then Open Ledger for 2: Basalt 0.35, Board 0.14, total ≤ 0.5; the Basalt bodies stay Basalt', () => {
    const w = city.w;
    const s = w.story;
    s.ending = 'ironwork';
    s.endingTick = 0;
    s.endingHistory = [{ id: 'ironwork', variant: null, from: 0, to: null }];
    w.tick = 6 * YEAR;
    expect(skylineShares(w).ironwork).toBeCloseTo(0.35, 9);
    // Bodies outside Charter Shore (no patron band there) in the Basalt band before the swap.
    deriveMarks(w);
    const ao = artOffset(w);
    const slot = w.districts.kinds.indexOf('flats');
    const r = slotRect(w, slot);
    const sample: [number, number][] = [];
    for (let y = r.y0; y <= r.y1; y += 3) for (let x = r.x0; x <= r.x1; x += 3) sample.push([x - ao, y - ao]);
    const before = sample.map(([x, y]) => skylineLang(x, y));
    const basalt = before.filter((l) => l === 'ironwork').length;
    expect(basalt / sample.length).toBeGreaterThan(0.3);
    expect(basalt / sample.length).toBeLessThan(0.4);
    // A Charter Review swaps to Open Ledger; two more years.
    s.endingHistory[0].to = 6 * YEAR;
    s.endingHistory.push({ id: 'ledger', variant: null, from: 6 * YEAR, to: null });
    s.ending = 'ledger';
    w.tick = 8 * YEAR;
    const sh = skylineShares(w);
    expect(sh.ironwork).toBeCloseTo(0.35, 9);
    expect(sh.ledger).toBeCloseTo(0.14, 9);
    expect((sh.ironwork ?? 0) + (sh.ledger ?? 0)).toBeLessThanOrEqual(TAKEOVER.total);
    deriveMarks(w);
    const after = sample.map(([x, y]) => skylineLang(x, y));
    sample.forEach((_, k) => {
      if (before[k] === 'ironwork') expect(after[k]).toBe('ironwork');
    });
    expect(after.filter((l) => l === 'ledger').length).toBeGreaterThan(0);
    // The total never passes 0.5, however long the endings are held; one ending never more than 0.35.
    w.tick = 40 * YEAR;
    const far = skylineShares(w);
    expect(far.ironwork).toBeCloseTo(0.35, 9);
    expect((far.ironwork ?? 0) + (far.ledger ?? 0)).toBeCloseTo(0.5, 9);
    w.tick = 0;
  });

  it('the takeover stays off locked districts, the Quiet Hand takes no band, and the patron keeps 10% of Charter Shore', () => {
    const w = new World(77, 'Small', undefined, 3); // only the start slot owned
    w.story.ending = 'ironwork';
    w.story.endingHistory = [{ id: 'ironwork', variant: null, from: 0, to: null }];
    w.tick = 10 * YEAR;
    deriveMarks(w);
    const ao = artOffset(w);
    expect(skylineLang(5 - ao, 5 - ao)).toBeNull(); // slot 0 is locked
    w.story.ending = 'quiet';
    w.story.endingHistory = [{ id: 'quiet', variant: null, from: 0, to: null }];
    expect(skylineShares(w)).toEqual({});
    w.story.keyChoices['ch2.vote'] = 1;
    deriveMarks(w);
    const r = slotRect(w, startSlotOf(w));
    let nacre = 0;
    let n = 0;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        n++;
        if (skylineLang(x - ao, y - ao) === 'pearl') nacre++;
      }
    expect(nacre / n).toBeGreaterThan(0.08);
    expect(nacre / n).toBeLessThan(0.12);
  });

  it('Lamplight\'s band keeps its lantern roofs after a review swap (render/buildings.ts asks only while lanternBands())', () => {
    const w = city.w;
    const s = w.story;
    s.ending = 'ironwork';
    s.endingHistory = [{ id: 'ironwork', variant: null, from: 0, to: null }];
    w.tick = 4 * YEAR;
    deriveMarks(w);
    expect(lanternBands()).toBe(false);
    s.ending = 'quiet';
    s.endingVariant = 'lamplight';
    s.endingHistory = [{ id: 'quiet', variant: 'lamplight', from: 0, to: null }];
    deriveMarks(w);
    expect(lanternBands()).toBe(true);
    expect(skylineShares(w).quiet).toBeCloseTo(0.28, 9);
    const ao = artOffset(w);
    const r = slotRect(w, w.districts.kinds.indexOf('flats'));
    const lamps: [number, number][] = [];
    for (let y = r.y0; y <= r.y1; y += 2) for (let x = r.x0; x <= r.x1; x += 2) if (skylineLang(x - ao, y - ao) === 'quiet') lamps.push([x - ao, y - ao]);
    expect(lamps.length).toBeGreaterThan(0);
    // A Charter Review swaps to Open Ledger: the Lamplight band (and its lantern roofs) stays.
    s.endingHistory[0].to = 4 * YEAR;
    s.endingHistory.push({ id: 'ledger', variant: null, from: 4 * YEAR, to: null });
    s.ending = 'ledger';
    s.endingVariant = null;
    w.tick = 6 * YEAR;
    deriveMarks(w);
    expect(lanternBands()).toBe(true);
    for (const [x, y] of lamps) expect(skylineLang(x, y)).toBe('quiet');
    // A plain Quiet Hand takes no band and draws no lanterns.
    s.endingHistory = [{ id: 'quiet', variant: null, from: 0, to: null }];
    s.ending = 'quiet';
    deriveMarks(w);
    expect(lanternBands()).toBe(false);
    w.tick = 0;
  });
});

// ── 4. Ending landmarks ──────────────────────────────────────────────────────

function gameOn(w: World): Game {
  const g = new Game();
  expect(g.restore(JSON.parse(JSON.stringify(w.serialize())))).toBe(true);
  return g;
}

describe('§9.6 item 4: ending landmarks build only under their ending; after a swap they stand dormant and wake again', () => {
  it('the Record Tower: approval and land value kept, the upkeep cut dropped; the Gantry: demand and prices dropped', () => {
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    expect(lockedReason(w, 'recordtower')).toBe('Opens with its ending');
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'ledger';
    st.endingTick = w.tick;
    st.endingHistory = [{ id: 'ledger', variant: null, from: w.tick, to: null }];
    expect(lockedReason(w, 'recordtower')).toBeNull();
    expect(lockedReason(w, 'gantry')).toBe('Opens with its ending');
    g.story.markDirty();
    const base0 = { approval: w.mods.approvalAdd, upkeep: w.mods.upkeepMul };
    const site = freeSquare(w, startSlotOf(w), 3, new Set())!;
    const tower = w.addBuilding('recordtower', site.x, site.y)!;
    g.story.markDirty();
    expect(w.mods.approvalAdd).toBeCloseTo(base0.approval + 3, 6);
    expect(w.mods.upkeepMul).toBeCloseTo(base0.upkeep * 0.98, 6);
    const lv = w.layers.lvAdd[(tower.y + 1) * w.N + tower.x + 1];
    expect(lv).toBeGreaterThan(0.025);
    // A Charter Review swaps the ending to the Quiet Hand.
    st.endingHistory[0].to = w.tick;
    st.endingHistory.push({ id: 'quiet', variant: null, from: w.tick, to: null });
    st.ending = 'quiet';
    g.story.markDirty();
    const quietBase = (() => {
      // The Quiet Hand's own approval term, without the tower.
      w.removeBuilding(tower.id);
      g.story.markDirty();
      const a = w.mods.approvalAdd;
      const u = w.mods.upkeepMul;
      return { a, u };
    })();
    const back = w.addBuilding('recordtower', site.x, site.y)!;
    g.story.markDirty();
    expect(w.buildings.has(back.id)).toBe(true);
    expect(w.mods.approvalAdd).toBeCloseTo(quietBase.a + 3, 6); // kept
    expect(w.mods.upkeepMul).toBeCloseTo(quietBase.u, 6); // dropped
    expect(w.layers.lvAdd[(back.y + 1) * w.N + back.x + 1]).toBeGreaterThan(0.025); // kept
    g.story.update(1 / 60, false); // the marks re-derive on the next frame
    const info = g.getTileInfo(back.x, back.y)!;
    expect(info.notes?.map((n) => n.text)).toContain('Dormant: its ending is not current');
    expect(g.story.visual.marks.list.find((m) => m.id === 'landmark.recordtower')?.plaque).toBe('Built under Open Ledger. Dormant while another ending holds.');
    // The ending returns: it wakes.
    st.endingHistory[1].to = w.tick;
    st.endingHistory.push({ id: 'ledger', variant: null, from: w.tick, to: null });
    st.ending = 'ledger';
    g.story.markDirty();
    expect(w.mods.upkeepMul).toBeLessThan(quietBase.u);
    expect(g.getTileInfo(back.x, back.y)!.notes?.map((n) => n.text)).not.toContain('Dormant: its ending is not current');
  });

  it('the Gantry and the Bread Pier: ending-bound demand, prices and stalls drop after a swap; visitors stay', () => {
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'ironwork';
    st.endingHistory = [{ id: 'ironwork', variant: null, from: 0, to: null }];
    g.story.markDirty();
    const d0 = w.mods.demandInd;
    const c0 = w.mods.costMul.reactor ?? 1;
    const site = freeSquare(w, startSlotOf(w), 4, new Set())!;
    w.addBuilding('gantry', site.x, site.y);
    g.story.markDirty();
    expect(w.mods.demandInd).toBeCloseTo(d0 + 0.05, 6);
    expect(w.mods.costMul.reactor ?? 1).toBeCloseTo(c0 * 0.95, 6);
    st.ending = 'lowcrown';
    st.endingHistory = [{ id: 'ironwork', variant: null, from: 0, to: 10 }, { id: 'lowcrown', variant: null, from: 10, to: null }];
    g.story.markDirty();
    const withGantry = w.mods.demandInd;
    const g2 = [...w.buildings.values()].find((b) => b.type === 'gantry')!;
    w.removeBuilding(g2.id);
    g.story.markDirty();
    expect(w.mods.demandInd).toBeCloseTo(withGantry, 6); // the dormant Gantry adds nothing
    // Bread Pier's stalls: an untaxed ledger line only while the Low Crown holds.
    const pierSite = freeSquare(w, startSlotOf(w), 4, new Set())!;
    w.addBuilding('breadpier', pierSite.x, pierSite.y);
    g.story.markDirty();
    expect(w.ledger.income.some((l) => l.label === 'Pier stalls' && l.amount === 900)).toBe(true);
    st.ending = 'ledger';
    g.story.markDirty();
    expect(w.ledger.income.some((l) => l.label === 'Pier stalls')).toBe(false);
  });

  it('the Still Square shortens the Nudge to 270 days under the Quiet Hand and gives +1 approval (+2 under Lamplight)', () => {
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'quiet';
    st.endingHistory = [{ id: 'quiet', variant: null, from: 0, to: null }];
    g.story.markDirty();
    const a0 = w.mods.approvalAdd;
    const site = freeSquare(w, startSlotOf(w), 3, new Set())!;
    w.addBuilding('stillsquare', site.x, site.y);
    g.story.markDirty();
    expect(w.mods.approvalAdd).toBeCloseTo(a0 + 1, 6);
    const f = (['board', 'basalt', 'nacre', 'undertow', 'kites'] as const).find((k) => g.story.nudge(k).ok);
    expect(f).toBeDefined();
    expect(st.nudgeReady - w.tick).toBe(270);
    expect(270).toBeLessThan(STORY_PACING.nudgeEvery);
  });

  it('the Bread Pier softens gang turf crime ×0.85 within r12 and protects both gangs r6, only while the Low Crown holds', () => {
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'lowcrown';
    st.endingHistory = [{ id: 'lowcrown', variant: null, from: 0, to: null }];
    const site = freeSquare(w, startSlotOf(w), 4, new Set())!;
    const cx = site.x + 2;
    const cy = site.y + 2;
    // Both gangs hold the streets around it.
    for (let y = cy - 16; y <= cy + 16; y++)
      for (let x = cx - 16; x <= cx + 16; x++) {
        const i = y * w.N + x;
        w.turf.owner[i] = x < cx ? 1 : 2;
        w.turf.str[i] = 80;
      }
    const near = (cy + 3) * w.N + cx + 3;
    const far = (cy + 15) * w.N + cx + 15;
    turf.refreshStats(w);
    const crime0 = { near: w.layerParts.turf.crimeAdd[near], far: w.layerParts.turf.crimeAdd[far] };
    expect(crime0.near).toBeGreaterThan(0);
    const pier = w.addBuilding('breadpier', site.x, site.y)!;
    turf.refreshStats(w);
    expect(w.layerParts.turf.crimeAdd[near]).toBeCloseTo(crime0.near * BREAD_PIER_TURF.crimeMul, 6);
    expect(w.layerParts.turf.crimeAdd[far]).toBeCloseTo(crime0.far, 6);
    const pu = new Uint8Array(w.area);
    const pk = new Uint8Array(w.area);
    pierProtect(w, pu, pk);
    const r = BREAD_PIER_TURF.protectRadius;
    expect(pu[(site.y - r) * w.N + site.x - r]).toBe(1);
    expect(pk[(site.y + 3 + r) * w.N + site.x + 3 + r]).toBe(1);
    expect(pu[(site.y - r - 1) * w.N + site.x]).toBe(0);
    // A Charter Review swaps the ending: the pier stands dormant and its turf terms drop.
    st.ending = 'ledger';
    turf.refreshStats(w);
    const dormant = w.layerParts.turf.crimeAdd[near];
    w.removeBuilding(pier.id);
    turf.refreshStats(w);
    expect(w.layerParts.turf.crimeAdd[near]).toBeCloseTo(dormant, 6); // the dormant pier changes nothing
    w.addBuilding('breadpier', site.x, site.y);
    pu.fill(0);
    pk.fill(0);
    pierProtect(w, pu, pk);
    expect(pu.some((v) => v)).toBe(false);
    const c = new Float32Array(w.area).fill(1);
    pierCrime(w, c);
    expect(c.every((v) => v === 1)).toBe(true);
  });
});

describe('carry 10: the Spire\'s build reaction follows its sponsor (§6.2)', () => {
  it.each([
    ['nacre', { nacre: 6, basalt: 2, undertow: -2 }],
    ['basalt', { basalt: 6, nacre: 2, undertow: -2 }],
    ['none', { board: 3 }],
  ] as const)('a %s Spire', (sponsor, want) => {
    const g = gameOn(city.w);
    const w = g.world;
    const site = freeSquare(w, startSlotOf(w), 3, new Set())!;
    const b = w.addBuilding('spire', site.x, site.y)!;
    b.sponsor = sponsor;
    const before = { ...w.story.favor };
    w.pushSignal({ t: 'built', type: 'spire', id: b.id });
    g.story.onDay();
    for (const f of ['board', 'basalt', 'nacre', 'undertow', 'kites', 'tuning'] as const) expect(w.story.favor[f] - before[f], f).toBe((want as Partial<Record<string, number>>)[f] ?? 0);
  });
});

// ── 5. The epilogue grant clock ─────────────────────────────────────────────

describe('§9.6 item 5: the epilogue grant clock on a fake clock', () => {
  const tick = (g: Game, dt: number) => (g as unknown as { tickEpilogue(dt: number): void }).tickEpilogue(dt);
  it.each([3, 5] as const)('%i×%i: the first grant after chapterMinSec × epilogueGrantMul unpaused seconds, a purchase never resets it, it survives a reload', (R) => {
    const w = new World(31, 'Clock', undefined, R);
    const g = gameOn(w);
    const gw = g.world;
    gw.story.ending = 'ledger';
    const every = STORY_PACE.relaxed.chapterMinSec * REGION[R].epilogueGrantMul;
    expect(every).toBe(R === 3 ? 1440 : 720);
    // Never while paused: Game.update at speed 0 leaves the clock alone.
    g.setSpeed(0);
    for (let k = 0; k < 20; k++) g.update(0.25);
    expect(gw.districts.epilogueSec ?? 0).toBe(0);
    tick(g, every / 2);
    // A purchase skips the wait but never resets the clock.
    gw.funds = 1e12;
    const cand = [...Array(R * R).keys()].find((s) => !gw.slotOwned[s] && g.districtView().slots[s].state === 'candidate')!;
    expect(g.buyDistrict(cand).ok).toBe(true);
    expect(gw.districts.epilogueSec).toBeCloseTo(every / 2, 6);
    // Save and load mid-wait.
    const h = gameOn(World.deserialize(JSON.parse(JSON.stringify(gw.serialize()))));
    expect(h.world.districts.epilogueSec).toBeCloseTo(every / 2, 6);
    tick(h, every / 2 - 0.5);
    expect(h.world.districts.grants).toBe(0);
    tick(h, 0.5);
    expect(h.world.districts.grants).toBe(1);
    // None while a grant is unspent.
    tick(h, every * 4);
    expect(h.world.districts.grants).toBe(1);
    // None once every slot is owned.
    for (let s = 0; s < R * R; s++) if (!h.world.slotOwned[s]) h.world.annex(s);
    h.world.districts.grants = 0;
    tick(h, every * 4);
    expect(h.world.districts.grants).toBe(0);
  });
});

// ── 6. The Charter Review's callback lines ──────────────────────────────────

describe('§9.6 item 6: each Charter Review appends exactly one line, never repeats one, then the generic line', () => {
  function deliverReview(g: Game): string {
    const st = g.world.story;
    // The review arrives through a deck slot (director.deliver), as in play.
    (g.story as unknown as { deliver(c: unknown): void }).deliver({ id: 'ep.review', kind: 'system', speaker: 'system', title: 'CHARTER REVIEW', body: '', choices: [] });
    expect(st.pending?.card).toBe('ep.review');
    g.openPending();
    const body = g.story.view().card!.body;
    g.choose(0); // Keep the charter as it is.
    return body;
  }
  it('three earned callbacks come once each, in table order, then the generic line; the card itself is unchanged', () => {
    const g = gameOn(city.w);
    const st = g.world.story;
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'ledger';
    st.endingHistory = [{ id: 'ledger', variant: null, from: 0, to: null }];
    st.flags.larkKnows = true;
    st.flags.truce = true;
    st.flags.buried = true;
    st.flags.patron = 'basalt';
    const bodies = [deliverReview(g), deliverReview(g), deliverReview(g), deliverReview(g), deliverReview(g)];
    const line = (id: string) => REVIEW_LINES.find((l) => l.id === id)!.text;
    const head = 'Three years on, the charter comes up for review.';
    for (const b of bodies) {
      expect(b.startsWith(head)).toBe(true);
      expect(b.split('\n\n').length).toBe(2); // exactly one appended paragraph
    }
    expect(bodies[0].endsWith(line('rl.lark'))).toBe(true);
    expect(bodies[1].endsWith(line('rl.truce'))).toBe(true);
    expect(bodies[2].endsWith("The old pump hall is still fenced and dark. Basalt Consolidated's sign has faded. The water under it has not.")).toBe(true);
    expect(bodies[3].endsWith(line(GENERIC_REVIEW_LINE))).toBe(true);
    expect(bodies[4].endsWith(line(GENERIC_REVIEW_LINE))).toBe(true);
    expect(st.callbacks).toEqual(['rl.lark', 'rl.truce', 'rl.buried', GENERIC_REVIEW_LINE]);
    // A callback earned later still comes before the generic line.
    st.flags.fullRecall = true;
    expect(deliverReview(g).endsWith(line('rl.recall'))).toBe(true);
    // Saved: a reload keeps the used lines.
    const h = gameOn(World.deserialize(JSON.parse(JSON.stringify(g.world.serialize()))));
    expect(h.world.story.callbacks).toEqual(['rl.lark', 'rl.truce', 'rl.buried', GENERIC_REVIEW_LINE, 'rl.recall']);
  });
});

// ── 7. The epilogue deck in play ────────────────────────────────────────────

describe('§9.6 item 7: epilogue cards draw only in Chapter VII with their flags, never open by themselves', () => {
  it('each card is eligible only with its condition; the landmark cards only while their ending holds', () => {
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    const byId = new Map(EPILOGUE_DECK.map((c) => [c.id, c]));
    Object.assign(st.flags, { larkKnows: true, truce: true, published: true, buried: true, leashed: true });
    st.chapter = 6;
    for (const c of EPILOGUE_DECK) expect(cardEligible(w, c), c.id).toBe(false);
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'pearl';
    for (const id of ['ep.kite', 'ep.seam', 'ep.names', 'ep.fence', 'ep.leash']) expect(cardEligible(w, byId.get(id)!), id).toBe(true);
    st.flags.larkKnows = false;
    expect(cardEligible(w, byId.get('ep.kite')!)).toBe(false);
    // ep.leash is a Board card: retired with the Board under Ironwork.
    st.ending = 'ironwork';
    expect(cardEligible(w, byId.get('ep.leash')!)).toBe(false);
    // The landmark cards: their landmark standing; the director keeps them out while their ending is not current.
    for (const [id, e] of Object.entries(LANDMARK_CARD_ENDING)) expect(cardEligible(w, byId.get(id)!), `${id} (${e}) without its landmark`).toBe(false);
  });

  it('a delivered epilogue card waits in COMMS (pending), and ep.fence / ep.leash leave buried and leashed alone', () => {
    const g = gameOn(city.w);
    const st = g.world.story;
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'pearl';
    Object.assign(st.flags, { buried: true, leashed: true });
    const fence = EPILOGUE_DECK.find((c) => c.id === 'ep.fence')!;
    (g.story as unknown as { deliver(c: unknown): void }).deliver(fence);
    expect(st.open).toBeNull();
    expect(st.pending?.card).toBe('ep.fence');
    g.openPending();
    g.choose(0); // Pour over it.
    expect(st.flags.hallPoured).toBe(true);
    expect(st.flags.buried).toBe(true);
    const leash = EPILOGUE_DECK.find((c) => c.id === 'ep.leash')!;
    (g.story as unknown as { deliver(c: unknown): void }).deliver(leash);
    expect(st.open).toBeNull();
    g.openPending();
    g.choose(0); // Take the leash off.
    expect(st.flags.unleashed).toBe(true);
    expect(st.flags.leashed).toBe(true);
  });

  it('the director never draws a landmark card while its ending is not current, and draws it once it is', () => {
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'ledger';
    st.endingHistory = [{ id: 'ironwork', variant: null, from: 0, to: 10 }, { id: 'ledger', variant: null, from: 10, to: null }];
    st.unlocks.push('comms');
    // A dormant Gantry: ep.quota's own `when` holds, its ending does not.
    const site = freeSquare(w, startSlotOf(w), 4, new Set())!;
    w.addBuilding('gantry', site.x, site.y);
    const draw = () => {
      st.pending = null;
      st.waiting = null;
      st.queue = [];
      st.deckSec = 1e6;
      st.frontSec = 1e6;
      st.sinceStartSec = 1e6;
      st.lastCardTick = -1e6;
      w.tick += 400;
      (g.story as unknown as { drawDeck(): void }).drawDeck();
      return st.pending as { card: string } | null;
    };
    let any = 0;
    for (let k = 0; k < 60; k++) {
      const p = draw();
      expect(p?.card).not.toBe('ep.quota');
      if (p) {
        any++;
        st.seen[p.card] = w.tick;
      }
    }
    expect(any).toBeGreaterThan(5);
    expect(st.seen['ep.quota']).toBeUndefined();
    // Ironwork holds again: the Gantry's card can come (once).
    st.ending = 'ironwork';
    let drawn = false;
    for (let k = 0; k < 400 && !drawn; k++) {
      const p = draw();
      if (p?.card === 'ep.quota') drawn = true;
      else if (p) st.seen[p.card] = w.tick;
    }
    expect(drawn).toBe(true);
  });
});

// ── 8. A v3 post-ending save ────────────────────────────────────────────────

describe('§9.6 item 8: a v3 post-ending save migrates with one history entry and shows its marks on first load', () => {
  it('the pinned v3-ending fixture', () => {
    const raw = JSON.parse(JSON.stringify(V3_ENDING));
    expect(raw.version).toBe(3);
    const g = new Game();
    expect(g.restore(raw)).toBe(true);
    const st = g.world.story;
    expect(st.ending).toBeTruthy();
    expect(st.endingHistory).toEqual([{ id: st.ending, variant: st.endingVariant, from: st.endingTick ?? 0, to: null }]);
    // The marks are derived on load: whatever the fixture chose shows at once.
    const marks = g.story.visual.marks;
    expect(marks.version).toBeGreaterThan(0);
    expect(marks.list).toEqual(deriveMarks(g.world).list);
    const expectSome = Object.keys(st.flags).some((k) => ['larkKnows', 'truce', 'cleanGlass', 'oneTide', 'honestTie', 'clerkLie', 'keptByBoard', 'wentToGround', 'lure', 'mural', 'fen', 'marrowKnows'].includes(k)) || st.keyChoices['ch2.vote'] !== undefined;
    if (expectSome) expect(marks.list.length).toBeGreaterThan(0);
  });
});

// ── The ending's street look (§9.2; art/marks.ts, carry 35) ─────────────────

describe('§9.2 street look: each ending draws its props on the streets in view, capped, culled and quiet below the street zoom', () => {
  it('sodium lamps, corner string lights and banners, Board flags (on corners when there are no avenues)', async () => {
    const { installCanvasMock, mockContext, mockStats } = await import('./canvas-mock');
    const restore = installCanvasMock();
    try {
      const art = await import('../src/render/art/marks');
      const w = new World(4242, 'Lamp Test', undefined, 3);
      const r = slotRect(w, startSlotOf(w));
      // A street grid every 4 tiles across Charter Shore's land: corners everywhere, no avenue.
      for (let y = r.y0 + 8; y <= r.y1 - 8; y++)
        for (let x = r.x0 + 8; x <= r.x1 - 8; x++)
          if (((x - r.x0) % 4 === 0 || (y - r.y0) % 4 === 0) && w.tiles[y * w.N + x].terrain === Terrain.Land) w.setRoad(x, y);
      const cx = (r.x0 + r.x1) >> 1;
      const cy = (r.y0 + r.y1) >> 1;
      const tiles = { x0: cx - 13, y0: cy - 13, x1: cx + 13, y1: cy + 13 };
      const ctx = mockContext();
      const props: Record<string, number> = {};
      for (const e of ['ironwork', 'lowcrown', 'ledger'] as const) {
        w.story.ending = e;
        w.story.endingHistory = [{ id: e, variant: null, from: 0, to: null }];
        w.version++; // a new street list for the new look
        const marks = deriveMarks(w);
        art.draw(ctx, w, marks, tiles, { time: 1, night: 1, zoom: 1, quality: 'high', world: w } as never);
        props[e] = art.MARKS_STATS.props;
        expect(props[e], e).toBeGreaterThan(0);
        expect(props[e], e).toBeLessThanOrEqual(48);
        // Below the street zoom nothing draws.
        art.draw(ctx, w, marks, tiles, { time: 2, night: 1, zoom: art.MARKS_MIN_ZOOM - 0.05, quality: 'high', world: w } as never);
        expect(art.MARKS_STATS.props).toBe(0);
      }
      expect(mockStats.errors).toEqual([]);
    } finally {
      restore();
    }
  });
});

// ── WP-8c: the Lamp Square in inspect, the landmark set, the landmarks' live extras, the sky walkers' note ──

describe('§9.2 the Lamp Square in inspect, and the ending each landmark was built under', () => {
  const texts = (g: Game, x: number, y: number) => (g.getTileInfo(x, y)!.notes ?? []).map((n) => n.text);
  it('the Still Square reads "The Lamp Square" / "Built under Lamplight" while Lamplight holds, and remembers it after a swap', () => {
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'quiet';
    st.endingVariant = 'lamplight';
    st.endingTick = w.tick;
    st.endingHistory = [{ id: 'quiet', variant: 'lamplight', from: w.tick, to: null }];
    g.story.markDirty();
    const site = freeSquare(w, startSlotOf(w), 3, new Set())!;
    const sq = w.addBuilding('stillsquare', site.x, site.y)!;
    expect(g.getTileInfo(sq.x, sq.y)!.title).toBe('The Lamp Square');
    expect(texts(g, sq.x, sq.y)).toContain('Built under Lamplight');
    expect(texts(g, sq.x, sq.y)).not.toContain('Dormant: its ending is not current');
    // The plain Quiet Hand: the Still Square.
    st.endingVariant = null;
    st.endingHistory = [{ id: 'quiet', variant: null, from: w.tick, to: null }];
    expect(g.getTileInfo(sq.x, sq.y)!.title).toBe('The Still Square');
    expect(texts(g, sq.x, sq.y)).toContain('Built under the Quiet Hand');
    // Lamplight, then a review swap to Open Ledger: the square stands dormant and remembers Lamplight.
    st.endingHistory = [
      { id: 'quiet', variant: 'lamplight', from: 0, to: w.tick },
      { id: 'ledger', variant: null, from: w.tick, to: null },
    ];
    st.ending = 'ledger';
    st.endingVariant = null;
    expect(g.getTileInfo(sq.x, sq.y)!.title).toBe('The Still Square');
    expect(texts(g, sq.x, sq.y)).toEqual(expect.arrayContaining(['Built under Lamplight', 'Dormant: its ending is not current']));
    // The other ending landmarks keep inspect's names.
    const gs = freeSquare(w, startSlotOf(w), 4, new Set([...Array(9)].map((_, k) => (sq.y + ((k / 3) | 0)) * w.N + sq.x + (k % 3))))!;
    const gantry = w.addBuilding('gantry', gs.x, gs.y)!;
    expect(g.getTileInfo(gantry.x, gantry.y)!.title).toBe('Foreman\'s Gantry');
    expect(texts(g, gantry.x, gantry.y)).toEqual(expect.arrayContaining(['Built under Ironwork', 'Dormant: its ending is not current']));
  });
});

describe('§3.8 / §9.2 the landmark set: counted in Keepsakes after the ending; whole, one ticker line and a late goal\'s pay, once', () => {
  it('every landmark of this build and all five ending landmarks', async () => {
    const { SET_LANDMARKS, landmarkSet } = await import('../src/game/marks');
    const { goalPay } = await import('../src/game/districts/goals');
    const { setLine } = await import('../src/ui/story/keepsakes');
    const { BUILDINGS } = await import('../src/game/config');
    const g = gameOn(city.w);
    const w = g.world;
    const st = w.story;
    const counted = SET_LANDMARKS.filter((t) => !BUILDINGS[t].hidden);
    expect(counted.length).toBeGreaterThanOrEqual(7);
    const used = new Set<number>();
    const place = (type: BuildingType) => {
      if ([...w.buildings.values()].some((b) => b.type === type)) return;
      const size = BUILDINGS[type].size;
      for (let s = 0; s < 9; s++) {
        const at = freeSquare(w, s, size, used);
        if (!at) continue;
        w.addBuilding(type, at.x, at.y);
        for (let dy = -1; dy <= size; dy++) for (let dx = -1; dx <= size; dx++) used.add((at.y + dy) * w.N + at.x + dx);
        return;
      }
      throw new Error(`no room for ${type}`);
    };
    for (const t of counted) place(t);
    for (const t of ['gantry', 'glasssmile', 'breadpier', 'recordtower'] as BuildingType[]) place(t);
    // Four of five ending landmarks: not whole.
    deriveMarks(w);
    let set = landmarkSet(w);
    expect(set).toMatchObject({ landmarks: counted.length, of: counted.length, endings: 4, endingsOf: 5, done: false });
    expect(setLine(set)).toBe(`The landmark set: ${counted.length} of ${counted.length} landmarks, 4 of 5 ending landmarks. A Charter Review can open another ending's landmark.`);
    place('stillsquare');
    // Before an ending the director says nothing.
    const news0 = w.news.length;
    const funds0 = w.funds;
    g.story.markDirty();
    g.story.update(1 / 60, false);
    expect(landmarkSet(w).done).toBe(true);
    expect(st.flags.landmarkSet).toBeUndefined();
    expect(w.funds).toBe(funds0);
    // After the ending: once.
    st.chapter = 7;
    st.phase = 'ended';
    st.ending = 'ledger';
    st.endingTick = w.tick;
    st.endingHistory = [{ id: 'ledger', variant: null, from: w.tick, to: null }];
    const pay = goalPay(w, 0);
    expect(pay).toBeGreaterThan(0);
    g.story.markDirty();
    g.story.update(1 / 60, false);
    expect(st.flags.landmarkSet).toBe(true);
    expect(w.funds).toBe(funds0 + pay);
    const lines = w.news.slice(news0).filter((n) => n.text.startsWith('The landmark set is whole'));
    expect(lines.map((n) => n.text)).toEqual([`The landmark set is whole: every landmark stands, and all five ending landmarks with them. +${pay.toLocaleString('en-US')} CR`]);
    expect(lines[0].kind).toBe('good');
    g.story.markDirty();
    g.story.update(1 / 60, false);
    expect(w.news.filter((n) => n.text.startsWith('The landmark set is whole')).length).toBe(1);
    expect(w.funds).toBe(funds0 + pay);
    set = landmarkSet(w);
    expect(setLine(set)).toBe('The landmark set is whole: every landmark stands, and all five ending landmarks with them.');
    // The flag is an ordinary saved flag.
    const back = gameOn(w);
    expect(back.world.story.flags.landmarkSet).toBe(true);
  });
});

describe('§9.2 optional: the Glass Smile follows the camera, the Record Tower scrolls the city\'s real budget lines', () => {
  it('the smile\'s gaze eases toward the middle of the view, a little each frame', async () => {
    const { installCanvasMock, mockContext, mockStats } = await import('./canvas-mock');
    const restore = installCanvasMock();
    try {
      const live = await import('../src/render/art/landmarkLive');
      const w = new World(77, 'Smile Test', undefined, 3);
      const ctx = mockContext();
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      const tiles = { x0: 0, y0: 0, x1: 10, y1: 10 };
      // The view's centre 300 px right of the sphere: the face turns right.
      ctx.setTransform(1, 0, 0, 1, W / 2 - 300, H / 2);
      live.noteView(ctx, w, tiles, 1);
      expect(live.smileFace(ctx, 0, 0, 38, [255, 198, 241], 1, 10)).toBe(true);
      const right = live.smileGaze();
      expect(right.x).toBeGreaterThan(5);
      expect(Math.abs(right.y)).toBeLessThan(1);
      // The view moves left of it: one frame later the face has only begun to turn; three seconds later it looks left.
      ctx.setTransform(1, 0, 0, 1, W / 2 + 300, H / 2);
      live.noteView(ctx, w, tiles, 1);
      live.smileFace(ctx, 0, 0, 38, [255, 198, 241], 1, 10.05);
      const mid = live.smileGaze();
      expect(mid.x).toBeLessThan(right.x);
      expect(mid.x).toBeGreaterThan(0);
      for (let k = 1; k <= 300; k++) live.smileFace(ctx, 0, 0, 38, [255, 198, 241], 1, 10.05 + k / 60);
      const left = live.smileGaze();
      expect(left.x).toBeCloseTo(-right.x, 1);
      // Centred on it: the face looks straight out.
      ctx.setTransform(1, 0, 0, 1, W / 2, H / 2);
      live.noteView(ctx, w, tiles, 1);
      for (let k = 1; k <= 240; k++) live.smileFace(ctx, 0, 0, 38, [255, 198, 241], 1, 14 + k / 60);
      expect(Math.hypot(live.smileGaze().x, live.smileGaze().y)).toBeLessThan(0.5);
      expect(mockStats.errors).toEqual([]);
    } finally {
      restore();
    }
  });

  it('the ledger reads world.budget: income, upkeep, the net; live at the street zoom, the static ticker far out and when frozen', async () => {
    const { installCanvasMock, mockContext, mockStats } = await import('./canvas-mock');
    const restore = installCanvasMock();
    try {
      const live = await import('../src/render/art/landmarkLive');
      expect(live.ledgerAmount(1_240_000)).toBe('+1.24M');
      expect(live.ledgerAmount(12_500_000)).toBe('+12.5M');
      expect(live.ledgerAmount(-412_300)).toBe('−412K');
      expect(live.ledgerAmount(950)).toBe('+950');
      const w = new World(78, 'Ledger Test', undefined, 3);
      w.budget = {
        income: 1_500_000,
        expenses: 420_000,
        incomeLines: [
          { label: 'Hab Block tax', amount: 1_200_000 },
          { label: 'Tourism', amount: 300_000 },
        ],
        expenseLines: [
          { label: 'Roads', amount: 120_000 },
          { label: 'Power plants', amount: 300_000 },
        ],
        history: [],
      };
      expect(live.ledgerLines(w)).toEqual([
        { label: 'HAB BLOCK TAX', amount: '+1.20M', up: true },
        { label: 'TOURISM', amount: '+300K', up: true },
        { label: 'ROADS', amount: '−120K', up: false },
        { label: 'POWER PLANTS', amount: '−300K', up: false },
        { label: 'NET', amount: '+1.08M', up: true },
      ]);
      const ctx = mockContext();
      const tiles = { x0: 0, y0: 0, x1: 10, y1: 10 };
      live.noteView(ctx, w, tiles, 1);
      // The first face builds the text sprite once (the budget's lines); after that a face is one clipped drawImage.
      expect(live.ledgerFace(ctx, 10, 10, 46, 23, 108, [150, 220, 255], false, 2)).toBe(true);
      const canvases = mockStats.canvases;
      live.noteView(ctx, w, tiles, 1);
      const before = mockStats.draws;
      // Both faces: one running down-right, one running down-left (read from its left end).
      expect(live.ledgerFace(ctx, 10, 10, 46, 23, 108, [150, 220, 255], false, 3)).toBe(true);
      expect(live.ledgerFace(ctx, 60, 10, -46, 23, 108, [150, 220, 255], false, 3)).toBe(true);
      expect(mockStats.draws - before).toBeLessThanOrEqual(6);
      expect(mockStats.canvases).toBe(canvases);
      expect(live.LIVE_STATS.ledgers).toBe(2);
      // Frozen (the past look) or far out: the static ticker draws instead.
      expect(live.ledgerFace(ctx, 10, 10, 46, 23, 108, [150, 220, 255], true, 3)).toBe(false);
      live.noteView(ctx, w, tiles, live.LEDGER_TEXT_ZOOM - 0.1);
      expect(live.ledgerFace(ctx, 10, 10, 46, 23, 108, [150, 220, 255], false, 3)).toBe(false);
      expect(mockStats.errors).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('the sky walkers\' whisper note counts the people inspect counts (vertical.walkersToday)', () => {
  it('{n} is walkersToday, or the flat rate per bridge when the payoff counts none', async () => {
    const vertical = await import('../src/game/story/vertical');
    const { NOTE_CROSSINGS_PER_BRIDGE } = await import('../src/game/story/content');
    const g = gameOn(city.w);
    const w = g.world;
    const fill = (t: string) => (g.story as unknown as { fillNote(t: string): string }).fillNote(t);
    const want = vertical.walkersToday(w) || NOTE_CROSSINGS_PER_BRIDGE * w.vertical.metrics.skybridges;
    expect(fill('{n}')).toBe(want.toLocaleString('en-US'));
  });
});
