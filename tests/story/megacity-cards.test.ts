// Megacity deck cards (docs/MEGACITY.md §8.3, WP-7), the way expansion-cards.test.ts checks EXPANSION's: each card
// is ineligible on a fresh city and in a city that meets only part of its `when`, is drawn from the deck once the
// city has annexed and built what it reads, arrives in COMMS (never opens by itself), shows what each choice does,
// and keeps its physical promise (§8.4): brownfield cleared, ruins cleared, the south bank drained, the apron
// rehoused or cleared, the Kites' turf on the frames dimmed (slot:skeleton). Also the grant hint, the {district}
// token inside a district, and a city where every district is owned staying within the pace's deck gaps.

import { afterEach, describe, expect, it } from 'vitest';
import { DISTRICTS, STORY_PACE, STORY_PACING } from '../../src/game/config';
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
import { MegaMayor } from '../megacity-fixture';

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
  'ds.tarmac': (w) => {
    own(w, 'tarmac');
    w.story.flags.apronFamilies = true; // Game.annex sets it for Tarmac Reach itself (structural own() does not)
  },
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
  'ds.tarmac': (w) => void own(w, 'tarmac'), // owned without Game.annex: no apronFamilies flag (a 5×5 repeat's case)
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

  it('ds.tarmac waits for Tarmac Reach itself: Game.annex of it sets apronFamilies; a 5×5 Tarmac repeat does not', () => {
    // 3×3: annex Tarmac Reach through Game (its neighbours owned first, so it is next to the city), lease and all.
    const g = game();
    const w = g.world;
    const card = MEGACITY_CARDS.find((c) => c.id === 'ds.tarmac')!;
    const t = slotOf(w, 'tarmac');
    for (const n of [0, 1, 2, 3, 5, 6, 7, 8] as SlotId[]) if (n !== t && Math.abs((n % 3) - (t % 3)) + Math.abs(Math.floor(n / 3) - Math.floor(t / 3)) === 1) w.annex(n);
    w.districts.grants = 1;
    expect(w.story.flags.apronFamilies).toBeUndefined();
    expect(g.annex(t, 'basalt').ok).toBe(true);
    expect(w.story.flags.apronFamilies).toBe(true);
    expect(cardEligible(w, card)).toBe(true);
    // 5×5: a Tarmac repeat (Cargo Fields or Windmark Strip) annexed through Game leaves the card waiting.
    const g5 = new Game();
    g5.settings.lowerDetail = false;
    if (!g5.restore(JSON.parse(JSON.stringify(regionWorld(5, 77).serialize())))) throw new Error('restore failed');
    const w5 = g5.world;
    const rep = w5.districts.kinds.findIndex((k, i) => k === 'tarmac' && w5.variantOf(i as SlotId) > 0) as SlotId;
    expect(rep).toBeGreaterThanOrEqual(0);
    for (let s = 0; s < 25; s++) if (s !== rep && w5.districts.kinds[s] !== 'tarmac' && w5.districts.kinds[s] !== 'sunk' && !w5.slotOwned[s]) w5.annex(s as SlotId);
    w5.districts.grants = 1;
    expect(g5.annex(rep).ok).toBe(true);
    expect(w5.districts.kinds.filter((k, i) => k === 'tarmac' && w5.slotOwned[i]).length).toBe(1);
    expect(w5.story.flags.apronFamilies).toBeUndefined();
    expect(cardEligible(w5, card)).toBe(false);
  }, 30_000);

  it('the popover names the districts an effect acts on: a 5×5 repeat by its own name, several by count', () => {
    const w5 = regionWorld(5, 77);
    const kinds = w5.districts.kinds;
    const of = (kind: DistrictKind) => kinds.map((k, i) => (k === kind ? (i as SlotId) : -1)).filter((i) => i >= 0) as SlotId[];
    const skeletonRepeat = of('skeleton').find((s) => w5.variantOf(s) > 0)!;
    w5.annex(skeletonRepeat);
    const repeatName = DISTRICTS.skeleton.variants[w5.variantOf(skeletonRepeat) - 1].name;
    const flats = of('flats');
    for (const s of flats) w5.annex(s);
    const fx: Effect[] = [
      { t: 'turf', gang: 'kites', op: 'str', at: 'slot:skeleton', v: -60 },
      { t: 'flag', key: 'brownfield', v: 'cleared' },
      { t: 'flag', key: 'apron', v: 'rehoused' },
    ];
    expect(effectsText(w5, fx)).toBe(`Kites turf −60 in ${repeatName} · brownfield cleared in ${flats.length} Flats districts · apron homes rebuilt in Tarmac Reach`);
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

  it('the inspect sheet names the neighbourhood a tile lies in: a 5×5 repeat from its variant\'s list; a one-district city as before', () => {
    const g = new Game();
    g.settings.lowerDetail = false;
    if (!g.restore(JSON.parse(JSON.stringify(regionWorld(5, 77).serialize())))) throw new Error('restore failed');
    const w = g.world;
    const open = (s: SlotId) =>
      landIn(w, s).filter((i) => {
        const t = w.tiles[i];
        return t.buildingId < 0 && !t.road && t.zone === ZoneType.None && w.sky[i] === 0;
      });
    // One district owned: no District row and no neighbourhood note (the start city's inspect is unchanged).
    const shore = slotOf(w, 'shore');
    const [i0] = open(shore);
    const lone = g.getTileInfo(i0 % w.N, Math.floor(i0 / w.N))!;
    expect(lone.rows.some(([k]) => k === 'District')).toBe(false);
    expect(lone.notes?.some((n) => n.text.startsWith('Neighbourhood')) ?? false).toBe(false);
    // A repeat (variant > 0) annexed: its tiles name a neighbourhood from the variant's own list.
    const rep = w.districts.kinds.findIndex((k, i) => k === 'bazaar' && w.variantOf(i as SlotId) > 0) as SlotId;
    expect(rep).toBeGreaterThanOrEqual(0);
    w.annex(rep);
    const v = w.variantOf(rep);
    const list = neighbourhoodsOf('bazaar', v);
    expect(list).not.toEqual(neighbourhoodsOf('bazaar', 0));
    const seen = new Set<string>();
    for (const i of open(rep).filter((_, k) => k % 97 === 0)) {
      const x = i % w.N;
      const y = Math.floor(i / w.N);
      const info = g.getTileInfo(x, y)!;
      expect(info.rows).toContainEqual(['District', DISTRICTS.bazaar.variants[v - 1].short]);
      const note = info.notes?.find((n) => n.text.startsWith('Neighbourhood: '));
      expect(note, `${x},${y}`).toBeDefined();
      const name = note!.text.slice('Neighbourhood: '.length);
      expect(list).toContain(name);
      expect(name).toBe(neighbourhoodAt(w, x, y));
      expect(note!.text.length).toBeLessThanOrEqual(60); // the note rule (≤ 60 chars, two lines at 360 px)
      seen.add(name);
    }
    expect(seen.size).toBeGreaterThan(2);
    // Charter Shore, now one of two districts, names its cells from today's start list.
    const shoreInfo = g.getTileInfo(i0 % w.N, Math.floor(i0 / w.N))!;
    expect(shoreInfo.notes).toContainEqual({ text: `Neighbourhood: ${districtName(i0 % w.N, Math.floor(i0 / w.N), w.seed, artOffset(w))}` });
  }, 30_000);

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

describe('a 3×3 city that annexes on every grant plays through Game to the ending (MEGACITY §8.3, WP-7 acceptance)', () => {
  /**
   * The story playthrough with districts: a MegaMayor builds every owned district and annexes as each land grant
   * arrives, through Game, on real seconds at Brisk (the fastest pace, so the tightest deck gaps). It reaches Chapter
   * VI and an ending; the deck never delivers closer than the pace's floor (so never closer than at 3aff4ea, which
   * had the same floor); the megacity cards it earns come through COMMS and none opens by itself. Normal and Relaxed
   * were measured the same way against 3aff4ea (docs/STORY.md §7.8b) and run too long for the suite.
   */
  it('brisk: Chapter VII on a 3×3 region, deck gaps at or above the floor, megacity cards only through COMMS', () => {
    const pace: StoryPace = 'brisk';
    const g = new Game();
    g.settings.storyPace = pace;
    g.settings.lowerDetail = false;
    if (!g.restore(JSON.parse(JSON.stringify(regionWorld().serialize())))) throw new Error('restore failed');
    const w = g.world;
    w.funds = 2_000_000;
    const d = g.story;
    const rng = new Rng(2091 ^ 0x51a7);
    const deck = new Set(DECK.map((c) => c.id));
    const mega = new Set(MEGACITY_CARDS.map((c) => c.id));
    const arrived: { id: string; sec: number }[] = [];
    const delivered = new Set<string>();
    const forcedMega: string[] = [];
    let ch6 = -1;
    w.events.on('incoming', (c) => {
      delivered.add(c.id);
      if (deck.has(c.id)) arrived.push({ id: c.id, sec: d.activeSec });
    });
    w.events.on('card', (c) => {
      if (!c || delivered.delete(c.id)) return;
      if (mega.has(c.id)) forcedMega.push(c.id);
    });
    w.events.on('chapter', (c) => {
      if (c.n === 6 && ch6 < 0) ch6 = d.activeSec;
    });
    const mm = new MegaMayor(w, g.sim, { annex: (s) => g.annex(s, 'nacre').ok, opens: () => true });
    mm.opening();
    const answer = () => {
      for (let guard = 0; guard < 40 && d.blocking; guard++) {
        const st = w.story;
        if (st.flags.charterNightOpen && !st.open) {
          const ok = d.view().claims.filter((c) => c.ok).map((c) => c.id);
          if (!d.chooseEnding(ok[Math.floor(rng.next() * ok.length)] ?? 'quiet').ok) d.chooseEnding('quiet');
          continue;
        }
        const v = d.view().card;
        if (!v) break;
        const open = v.choices.map((c, k) => (c.locked ? -1 : k)).filter((k) => k >= 0);
        d.choose(open[Math.floor(rng.next() * open.length)] ?? 0);
      }
    };
    let msg = '';
    let msgAt = 0;
    for (let day = 0; day < 30 * 360 && !(w.story.chapter >= 7 && !d.blocking); day++) {
      d.update(0.5, false);
      answer();
      // Story messages are read after 20 s; COMMS cards are opened now and then, as a player would.
      const wt = w.story.waiting;
      if (wt && wt.card !== msg) {
        msg = wt.card;
        msgAt = d.activeSec;
      } else if (!wt) msg = '';
      if (wt && !w.story.open && d.activeSec - msgAt >= 20) {
        d.openWaiting();
        answer();
      }
      if (w.story.pending && !w.story.open && rng.next() < 0.02) {
        d.openPending();
        answer();
      }
      g.sim.step();
      d.onDay();
      answer();
      if (w.tick % DAYS_PER_MONTH === 0) {
        mm.turn();
        while (w.districts.grants > 0 && mm.annexNext() >= 0);
      }
    }
    expect(ch6, 'Chapter VI reached').toBeGreaterThan(0);
    expect(w.story.chapter).toBe(7);
    expect(w.districts.owned.length).toBeGreaterThanOrEqual(6);
    const gap = STORY_PACE[pace].minActiveSecBetween;
    for (let k = 1; k < arrived.length; k++) {
      const need = URGENT_SYSTEM.has(arrived[k].id) ? STORY_PACING.systemGapSec : gap;
      expect(arrived[k].sec - arrived[k - 1].sec, `${arrived[k - 1].id} → ${arrived[k].id}`).toBeGreaterThanOrEqual(need - 1e-6);
    }
    expect(arrived.filter((a) => mega.has(a.id)).length, 'the city earned megacity cards').toBeGreaterThan(0);
    expect(forcedMega).toEqual([]);
  }, 180_000);
});
