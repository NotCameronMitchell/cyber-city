// Megacity deck cards (docs/MEGACITY.md §8.3, WP-7), the way expansion-cards.test.ts checks EXPANSION's: each card
// is ineligible on a fresh city and in a city that meets only part of its `when`, is drawn from the deck once the
// city has annexed and built what it reads, arrives in COMMS (never opens by itself), shows what each choice does,
// and keeps its physical promise (§8.4): brownfield cleared, ruins cleared, the south bank drained, the apron
// rehoused or cleared, the Kites' turf on the frames dimmed (slot:skeleton). Also the grant hint, the {district}
// token inside a district, and a city where every district is owned staying within the pace's deck gaps.

import { afterEach, describe, expect, it } from 'vitest';
import { STORY_PACE, STORY_PACING } from '../../src/game/config';
import { isRuin, tarmacSites } from '../../src/game/districts/annex';
import { countGround } from '../../src/game/districts/effects';
import { neighbourhoodAt, neighbourhoodsOf } from '../../src/game/districts/names';
import { artOffset, slotOffset, slotRect } from '../../src/game/districts/slots';
import { Game } from '../../src/game/game';
import { deriveMarks } from '../../src/game/marks';
import { districtName } from '../../src/game/news';
import { Rng } from '../../src/game/rng';
import { useStoryContent } from '../../src/game/story/conditions';
import { DECK, MEGACITY_CARDS, STORY_CONTENT } from '../../src/game/story/content';
import { MARK_NAMES } from '../../src/game/story/content/epilogue';
import { applyEffects, districtOf, effectsText, hintsFor, slotTiles, targetArea, type EffectHost } from '../../src/game/story/effects';
import { URGENT_SYSTEM, cardEligible, cardWeight, drawCard } from '../../src/game/story/pacing';
import * as turf from '../../src/game/story/turf';
import type { Card, Effect } from '../../src/game/story/types';
import { DAYS_PER_MONTH, Ground, SLOT, Terrain, ZoneType, type DistrictKind, type Region, type SlotId, type StoryPace } from '../../src/game/types';
import { World } from '../../src/game/world';

afterEach(() => {
  useStoryContent(STORY_CONTENT);
});

/** Register content whose deck holds only `id` (no system, ⚑ or other faction cards to win the draw). */
function onlyInDeck(id: string): void {
  const deck = new Set(DECK.map((c) => c.id));
  useStoryContent({ ...STORY_CONTENT, cards: STORY_CONTENT.cards.filter((c) => !deck.has(c.id) || c.id === id) });
}

/** A generated 3×3 city (seed 2091), built once per file and handed out as fresh copies. */
let base: string | null = null;
function regionWorld(region: Region = 3, seed = 2091): World {
  if (region !== 3 || seed !== 2091) return World.generate(seed, 'Harness Bay', undefined, region);
  base ??= JSON.stringify(World.generate(2091, 'Harness Bay', undefined, 3).serialize());
  return World.deserialize(JSON.parse(base));
}

/** A Game on a 3×3 city with COMMS open and the deck ready to draw. */
function game(pace: StoryPace = 'brisk'): Game {
  const g = new Game();
  g.settings.storyPace = pace;
  g.settings.lowerDetail = false;
  if (!g.restore(JSON.parse(JSON.stringify(regionWorld().serialize())))) throw new Error('restore failed');
  const st = g.world.story;
  if (!st.unlocks.includes('comms')) st.unlocks.push('comms');
  st.lastCardTick = g.world.tick - 1000;
  return g;
}

const slotOf = (w: World, kind: DistrictKind): SlotId => w.districts.kinds.findIndex((k) => k === kind) as SlotId;

/** Annex the district of a kind (structurally: the test is about the card, not the annex rules). */
function own(w: World, kind: DistrictKind): SlotId {
  const s = slotOf(w, kind);
  expect(s, kind).toBeGreaterThanOrEqual(0);
  w.annex(s);
  return s;
}

/** Land tiles of a slot, in row order. */
function landIn(w: World, s: SlotId): number[] {
  const r = slotRect(w, s);
  const out: number[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (w.tiles[y * w.N + x].terrain === Terrain.Land) out.push(y * w.N + x);
  return out;
}

/** n land tiles of turf for a gang inside a slot, at strength str. */
function gangTurf(w: World, gang: 1 | 2, s: SlotId, n = 16, str = 50, skip = 0): number[] {
  const tiles = landIn(w, s).slice(skip, skip + n);
  for (const i of tiles) {
    w.turf.owner[i] = gang;
    w.turf.str[i] = str;
  }
  turf.refreshStats(w);
  return tiles;
}

/** An owned land tile of a slot where a building of `size` fits (all land, nothing on it). */
function siteIn(w: World, s: SlotId, size: number, ok: (x: number, y: number) => boolean = () => true): [number, number] {
  const r = slotRect(w, s);
  for (let y = r.y0 + 2; y <= r.y1 - size - 2; y++)
    for (let x = r.x0 + 2; x <= r.x1 - size - 2; x++) {
      let fits = ok(x, y);
      for (let dy = 0; dy < size && fits; dy++)
        for (let dx = 0; dx < size && fits; dx++) {
          const t = w.tileAt(x + dx, y + dy)!;
          if (t.terrain !== Terrain.Land || t.buildingId >= 0 || t.zone || t.road) fits = false;
        }
      if (fits) return [x, y];
    }
  throw new Error('no site');
}

const nearWater = (w: World, x: number, y: number) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (w.tileAt(x + dx, y + dy)?.terrain === Terrain.Water) return true;
  return false;
};

/** Make the world meet a card's `when`, the way a city that annexed and built it would. */
const SETUP: Record<string, (w: World) => void> = {
  'ds.shoals': (w) => void own(w, 'shoals'),
  'ds.sunk': (w) => {
    w.story.flags.published = true; // the Sunk opens after ch4.brine
    gangTurf(w, 1, own(w, 'sunk'));
  },
  'ds.flats': (w) => void own(w, 'flats'),
  'ds.terraces': (w) => {
    own(w, 'terraces');
    w.story.flags.tuningActive = true;
  },
  'ds.reedmere': (w) => void own(w, 'reedmere'),
  'ds.skeleton': (w) => void gangTurf(w, 2, own(w, 'skeleton')),
  'ds.tarmac': (w) => void own(w, 'tarmac'),
  'ds.bazaar': (w) => {
    const s = own(w, 'bazaar');
    gangTurf(w, 1, s);
    gangTurf(w, 2, s, 16, 50, 400);
  },
  'lm.arena': (w) => {
    const s = own(w, 'flats');
    const [x, y] = siteIn(w, s, 4);
    expect(w.addBuilding('arena', x, y)).not.toBeNull();
  },
  'lm.beacon': (w) => {
    const s = own(w, 'shoals');
    const [x, y] = siteIn(w, s, 1, (px, py) => nearWater(w, px, py));
    expect(w.addBuilding('beacon', x, y)).not.toBeNull();
  },
  'lm.halo': (w) => {
    const s = own(w, 'flats');
    const [x, y] = siteIn(w, s, 2);
    expect(w.addBuilding('halolookout', x, y)).not.toBeNull();
  },
};

/** Part of each multi-part `when`: the city meets every term but one, so the card must stay out of the deck. */
const PARTIAL: Record<string, (w: World) => void> = {
  'ds.sunk': (w) => void own(w, 'sunk'), // no Undertow turf
  'ds.terraces': (w) => void own(w, 'terraces'), // the Tuning still hidden
  'ds.skeleton': (w) => void own(w, 'skeleton'), // no Kites turf
  'ds.bazaar': (w) => void gangTurf(w, 1, own(w, 'bazaar')), // only one gang there
  'lm.arena': (w) => void own(w, 'flats'), // a district, no Arena
};

describe('megacity cards are drawable where the city has earned them (MEGACITY §8.3)', () => {
  it('has a setup for every card', () => {
    expect(Object.keys(SETUP).sort()).toEqual(MEGACITY_CARDS.map((c) => c.id).sort());
  });

  for (const card of MEGACITY_CARDS) {
    it(`${card.id}: ineligible on a fresh city${PARTIAL[card.id] ? ' and on half its when' : ''}, drawn once its when holds, waits in COMMS, and every choice resolves`, () => {
      const g = game();
      const w = g.world;
      expect(cardEligible(w, card), 'a fresh city has not earned it').toBe(false);
      if (PARTIAL[card.id]) {
        const p = game();
        PARTIAL[card.id](p.world);
        expect(cardEligible(p.world, card), 'part of its when').toBe(false);
      }
      SETUP[card.id](w);
      expect(cardEligible(w, card)).toBe(true);
      expect(cardWeight(w, card)).toBeGreaterThan(0);

      // The deck's weighted draw picks it (alone in the deck, so nothing else can win).
      onlyInDeck(card.id);
      let picked: Card | null = null;
      for (let seed = 1; seed <= 40 && !picked; seed++) picked = drawCard(w, new Rng(seed), true, 1).pick?.card ?? null;
      expect(picked?.id).toBe(card.id);

      // Through the director: every gate open, the card arrives as a COMMS card and does not open by itself.
      const st = w.story;
      st.deckSec = 1e6;
      st.frontSec = 1e6;
      st.sinceStartSec = 1e6;
      st.lastBeatTick = w.tick - 1000;
      for (let mo = 0; mo < 24 && !st.pending; mo++) {
        w.tick += DAYS_PER_MONTH;
        g.story.onMonth();
      }
      expect(st.pending?.card).toBe(card.id);
      expect(st.open).toBeNull();
      useStoryContent(STORY_CONTENT);

      // Open it as the player would from COMMS and answer each choice in turn (a fresh city per choice).
      for (let i = 0; i < card.choices.length; i++) {
        const gi = i === 0 ? g : game();
        if (i > 0) {
          SETUP[card.id](gi.world);
          gi.world.story.seen[card.id] = gi.world.tick;
          gi.world.story.pending = { card: card.id, tick: gi.world.tick, spot: -1 };
        }
        gi.openPending();
        const view = gi.story.view().card!;
        expect(view.id).toBe(card.id);
        expect(view.body).not.toMatch(/\{\w+\}/);
        expect(view.brief ?? '').not.toMatch(/\{\w+\}/);
        const ch = view.choices[i];
        expect(ch.hints.length, `${card.id} choice ${i} shows what it does`).toBeGreaterThan(0);
        // The hidden Tuning is never named in a hint (ds.sunk and ds.flats move it while it may still be hidden).
        if (!gi.world.story.flags.tuningActive) expect(ch.hints.some((h) => h.k === 'favor' && h.f === 'tuning')).toBe(false);
        expect(ch.locked).toBeUndefined();
        gi.choose(i);
        expect(gi.world.story.open).toBeNull();
        expect(gi.world.story.log[gi.world.story.log.length - 1]).toMatchObject({ card: card.id, choice: i });
        // Once: never asks again.
        expect(cardEligible(gi.world, card)).toBe(false);
      }
    }, 60_000);
  }
});

describe('the physical promises of the megacity cards (MEGACITY §8.4)', () => {
  /** Open the card as a COMMS card and answer `label`. */
  function answer(g: Game, id: string, label: string): void {
    const st = g.world.story;
    st.seen[id] = g.world.tick;
    st.pending = { card: id, tick: g.world.tick, spot: -1 };
    g.openPending();
    const i = g.story.view().card!.choices.findIndex((c) => c.label === label);
    expect(i, label).toBeGreaterThanOrEqual(0);
    g.choose(i);
  }

  it('ds.flats "Clean it first": every brownfield tile of the owned Flats turns Plain, for 9,000', () => {
    const g = game();
    const w = g.world;
    const s = own(w, 'flats');
    expect(countGround(w, s, Ground.Brownfield)).toBeGreaterThan(300);
    w.funds = 50_000;
    answer(g, 'ds.flats', 'Clean it first: 9,000.');
    expect(countGround(w, s, Ground.Brownfield)).toBe(0);
    expect(w.funds).toBe(41_000);
    expect(w.story.flags.brownfield).toBe('cleared');
    // "Let it clear slowly" leaves the ground to the sim.
    const g2 = game();
    const s2 = own(g2.world, 'flats');
    const before = countGround(g2.world, s2, Ground.Brownfield);
    answer(g2, 'ds.flats', 'Let it clear slowly.');
    expect(countGround(g2.world, s2, Ground.Brownfield)).toBe(before);
  });

  it('ds.sunk "Clear the ruins": the Sunk\'s ruins become empty zoned lots; giving title leaves them standing', () => {
    const ruins = (w: World, s: SlotId) => landIn(w, s).filter((i) => isRuin(w.tiles[i])).length;
    const g = game();
    const w = g.world;
    w.story.flags.published = true;
    const s = own(w, 'sunk');
    gangTurf(w, 1, s);
    const zoned = landIn(w, s).filter((i) => isRuin(w.tiles[i]));
    expect(zoned.length).toBeGreaterThan(100);
    answer(g, 'ds.sunk', 'Clear the ruins.');
    expect(ruins(w, s)).toBe(0);
    for (const i of zoned) {
      const t = w.tiles[i];
      expect(t.zone).not.toBe(ZoneType.None);
      expect(t.level).toBe(0);
      expect(t.ground).toBe(Ground.Plain);
    }
    const g2 = game();
    g2.world.story.flags.published = true;
    const s2 = own(g2.world, 'sunk');
    gangTurf(g2.world, 1, s2);
    const n = ruins(g2.world, s2);
    answer(g2, 'ds.sunk', 'Give them title to the ruins.');
    expect(ruins(g2.world, s2)).toBe(n);
  });

  it('ds.reedmere "Drain the south bank": reeds turn Plain on the half nearer the start slot only', () => {
    const g = game();
    const w = g.world;
    const s = own(w, 'reedmere');
    const r = slotRect(w, s);
    const [dx, dy] = slotOffset(w.region, s);
    const halves = () => {
      let near = 0;
      let far = 0;
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          if (w.tiles[y * w.N + x].ground !== Ground.Reed) continue;
          if ((x - r.x0 - 31.5) * dx + (y - r.y0 - 31.5) * dy < 0) near++;
          else far++;
        }
      return { near, far };
    };
    const before = halves();
    expect(before.near).toBeGreaterThan(0);
    expect(before.far).toBeGreaterThan(0);
    answer(g, 'ds.reedmere', 'Drain the south bank.');
    expect(halves()).toEqual({ near: 0, far: before.far });
  });

  it('ds.tarmac: "Rehouse them" lifts the apron families to level 2 at $$; "Clear the apron" bulldozes the block', () => {
    const families = (w: World, s: SlotId) => {
      const f = tarmacSites(w, s).families!;
      const out: number[] = [];
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (w.tiles[y * w.N + x].zone === ZoneType.Residential) out.push(y * w.N + x);
      return { f, homes: out };
    };
    const g = game();
    const s = own(g.world, 'tarmac');
    const { homes } = families(g.world, s);
    expect(homes.length).toBe(24);
    g.world.funds = 20_000;
    answer(g, 'ds.tarmac', 'Rehouse them: 6,000.');
    for (const i of homes) {
      expect(g.world.tiles[i].level).toBe(2);
      expect(g.world.tiles[i].wealth).toBe(1);
    }
    expect(g.world.funds).toBe(14_000);

    const g2 = game();
    const s2 = own(g2.world, 'tarmac');
    const { f } = families(g2.world, s2);
    answer(g2, 'ds.tarmac', 'Clear the apron.');
    for (let y = f.y0; y <= f.y1; y++)
      for (let x = f.x0; x <= f.x1; x++) {
        const t = g2.world.tiles[y * g2.world.N + x];
        expect(t.zone).toBe(ZoneType.None);
      }
  });

  it('ds.skeleton "Clear the frames": the Kites\' turf in Skeleton Row weakens by 60; their turf elsewhere is untouched', () => {
    const g = game();
    const w = g.world;
    const s = own(w, 'skeleton');
    const inside = gangTurf(w, 2, s, 20, 50);
    const strong = gangTurf(w, 2, s, 5, 90, 200);
    const outside = gangTurf(w, 2, slotOf(w, 'shore'), 12, 50, 300);
    answer(g, 'ds.skeleton', 'Clear the frames.');
    for (const i of inside) expect(w.turf.owner[i], 'weak turf on the frames is gone').toBe(0);
    for (const i of strong) expect(w.turf.str[i]).toBe(30);
    for (const i of outside) {
      expect(w.turf.owner[i]).toBe(2);
      expect(w.turf.str[i]).toBe(50);
    }
  });

  it('slot:<kind> resolves to every owned district of that kind, and to nothing while none is owned', () => {
    const w = regionWorld();
    expect(slotTiles(w, 'skeleton')).toBeNull();
    expect(targetArea(w, 'slot:skeleton', 0, -1, 'kites')).toBeNull();
    const s = own(w, 'skeleton');
    const tiles = slotTiles(w, 'skeleton')!;
    expect(tiles.length).toBe(SLOT * SLOT);
    const r = slotRect(w, s);
    expect(tiles[0]).toBe(r.y0 * w.N + r.x0);
    expect(targetArea(w, 'slot:skeleton', 0, -1, 'kites')).toEqual(tiles);
    // On a 5×5 region a kind repeats: the target covers every owned district of it.
    const w5 = regionWorld(5, 77);
    const kinds = w5.districts.kinds;
    const shoals = kinds.map((k, i) => (k === 'shoals' ? i : -1)).filter((i) => i >= 0) as SlotId[];
    expect(shoals.length).toBeGreaterThan(1);
    for (const sl of shoals) w5.annex(sl);
    expect(slotTiles(w5, 'shoals')!.length).toBe(shoals.length * SLOT * SLOT);
  });

  it('a verb whose district is not owned changes nothing, and the popover says what each verb does', () => {
    const w = regionWorld();
    const host = { world: w, rng: new Rng(1), queue() {}, log() {}, flagSet() {}, countdown() {}, charterNight() {}, ending() {} } as EffectHost;
    const json = JSON.stringify(w.serialize().tiles);
    applyEffects(host, [{ t: 'flag', key: 'brownfield', v: 'cleared' }, { t: 'flag', key: 'reeds', v: 'drained' }, { t: 'flag', key: 'apron', v: 'cleared' }], { spot: -1 });
    expect(JSON.stringify(w.serialize().tiles)).toBe(json);
    expect(w.story.flags.brownfield).toBe('cleared');
    const fx: Effect[] = [
      { t: 'flag', key: 'brownfield', v: 'cleared' },
      { t: 'flag', key: 'ruins', v: 'cleared' },
      { t: 'flag', key: 'reeds', v: 'drained' },
      { t: 'flag', key: 'apron', v: 'rehoused' },
      { t: 'flag', key: 'apron', v: 'cleared' },
      { t: 'turf', gang: 'kites', op: 'str', at: 'slot:skeleton', v: -60 },
    ];
    expect(effectsText(w, fx)).toBe(
      'brownfield cleared in Kessel Flats · ruins cleared for builders in the Sunk · south bank reeds drained in Reedmere · apron homes rebuilt in Tarmac Reach · apron cleared in Tarmac Reach · Kites turf −60 in Skeleton Row',
    );
    // An ordinary flag still says nothing.
    expect(effectsText(w, [{ t: 'flag', key: 'ruins', v: 'kept' }])).toBe('No effect.');
  });

  it('a grant effect shows the ✦ hint with its count (carry item 25)', () => {
    const w = regionWorld();
    expect(hintsFor(w, [{ t: 'grant', n: 1 }])).toEqual([{ k: 'grant', n: 1 }]);
    expect(hintsFor(w, [{ t: 'grant', n: 1 }, { t: 'funds', v: 500 }, { t: 'grant', n: 2 }])).toEqual([
      { k: 'cr', v: 500 },
      { k: 'grant', n: 3 },
    ]);
    expect(hintsFor(w, [{ t: 'grant', n: 0 }])).toEqual([]);
  });
});

describe('the {district} token inside a district (MEGACITY §3.7)', () => {
  it('names a neighbourhood of the district a tile lies in: today\'s names in Charter Shore, the variant\'s own list elsewhere', () => {
    const w = regionWorld(5, 77);
    const shore = slotOf(w, 'shore');
    const r = slotRect(w, shore);
    for (const [x, y] of [
      [r.x0 + 3, r.y0 + 3],
      [r.x0 + 40, r.y0 + 20],
    ])
      expect(districtOf(w, y * w.N + x)).toBe(districtName(x, y, w.seed, artOffset(w)));
    // Every annexed district names its cells from its own list (a repeat from its variant's list).
    for (let s = 0; s < w.region * w.region; s++) if (!w.slotOwned[s]) w.annex(s as SlotId);
    let variants = 0;
    for (let s = 0; s < w.region * w.region; s++) {
      const kind = w.districts.kinds[s];
      if (kind === 'shore') continue;
      const v = w.variantOf(s as SlotId);
      if (v > 0) variants++;
      const list = neighbourhoodsOf(kind, v);
      const rr = slotRect(w, s as SlotId);
      const names = new Set<string>();
      for (let y = rr.y0; y <= rr.y1; y += 8)
        for (let x = rr.x0; x <= rr.x1; x += 8) {
          const n = districtOf(w, y * w.N + x);
          expect(list, `${kind} v${v}`).toContain(n);
          expect(n).toBe(neighbourhoodAt(w, x, y));
          names.add(n);
        }
      expect(names.size, `${kind} v${v} uses several names`).toBeGreaterThan(3);
    }
    expect(variants).toBe(16);
  }, 60_000);

  it('a cell a story choice renamed (§9.3) answers with its new name inside an annexed district too', () => {
    const w = regionWorld();
    const s = own(w, 'bazaar');
    const r = slotRect(w, s);
    const x = r.x0 + 20;
    const y = r.y0 + 28;
    const before = districtOf(w, y * w.N + x);
    expect(neighbourhoodsOf('bazaar', 0)).toContain(before);
    w.story.seam = y * w.N + x;
    w.story.flags.truce = true;
    deriveMarks(w);
    expect(districtOf(w, y * w.N + x)).toBe(MARK_NAMES.truceWall);
    expect(neighbourhoodAt(w, x, y)).toBe(MARK_NAMES.truceWall);
    // The next cell keeps its own name.
    expect(neighbourhoodsOf('bazaar', 0)).toContain(districtOf(w, (y + 16) * w.N + x + 16));
    deriveMarks(regionWorld()); // unbind: the marks module keeps the last derived world's names
  });
});

describe('the megacity cards add variety, not frequency (MEGACITY §8.3 cadence)', () => {
  /**
   * A 3×3 city where every district is owned and every card's `when` holds from day one, played on real seconds:
   * the deck still delivers no closer than the pace's gap, nothing opens by itself, and the eleven cards arrive
   * as COMMS cards among the rest.
   */
  for (const pace of ['relaxed', 'normal', 'brisk'] as const) {
    it(`${pace}: deck deliveries stay ${STORY_PACE[pace].minActiveSecBetween} s apart with every megacity card eligible`, () => {
      const g = game(pace);
      const w = g.world;
      for (const id of Object.keys(SETUP)) SETUP[id](w);
      const st = w.story;
      const deck = new Set(DECK.map((c) => c.id));
      const arrived: { id: string; sec: number }[] = [];
      const opened: string[] = [];
      w.events.on('incoming', (c) => deck.has(c.id) && arrived.push({ id: c.id, sec: g.story.activeSec }));
      w.events.on('card', (c) => c && opened.push(c.id));
      // Two sim years, slow enough that the real-second gap, not the sim's day gates, sets the rate (about six gaps a
      // run); every waiting card is answered at once, so the deck is never held back.
      const gap = STORY_PACE[pace].minActiveSecBetween;
      const secPerDay = gap / 120;
      const answerOpen = () => {
        for (let guard = 0; guard < 20 && st.open; guard++) {
          const i = g.story.view().card?.choices.findIndex((c) => !c.locked) ?? 0;
          g.choose(Math.max(0, i));
        }
      };
      for (let day = 0; day < 720; day++) {
        g.story.update(secPerDay, false);
        answerOpen();
        if (st.pending && !st.open) {
          g.openPending();
          g.choose(g.story.view().card!.choices.findIndex((c) => !c.locked));
        }
        g.sim.step();
        g.story.onDay();
        answerOpen();
      }
      expect(arrived.length, 'the deck kept drawing').toBeGreaterThan(1);
      for (let k = 1; k < arrived.length; k++) {
        const need = URGENT_SYSTEM.has(arrived[k].id) ? STORY_PACING.systemGapSec : gap;
        expect(arrived[k].sec - arrived[k - 1].sec, `${arrived[k - 1].id} → ${arrived[k].id}`).toBeGreaterThanOrEqual(need - 1e-6);
      }
      // No megacity card ever opened by itself.
      const megacity = new Set(MEGACITY_CARDS.map((c) => c.id));
      for (const id of opened) if (megacity.has(id)) expect(arrived.some((a) => a.id === id), `${id} came through COMMS`).toBe(true);
      expect(arrived.length).toBeLessThanOrEqual(Math.floor(g.story.activeSec / gap) + 1);
    }, 120_000);
  }
});
