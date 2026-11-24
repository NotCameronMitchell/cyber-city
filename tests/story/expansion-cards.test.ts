// Expansion deck cards (docs/EXPANSION.md §8.3, WP-6): each card is drawable in a test
// world that meets its `when` and spot, its {district} names a real place, every choice
// resolves, and ex.rights opens both on demand (Game.openLaunchRights → openOnDemand)
// and through the deck, handing the launch rights to exactly one holder.

import { afterEach, describe, expect, it } from 'vitest';
import { POWER_WEIGHTS } from '../../src/game/config';
import type { Game } from '../../src/game/game';
import { districtName } from '../../src/game/news';
import { Rng } from '../../src/game/rng';
import { storyContent, useStoryContent } from '../../src/game/story/conditions';
import { DECK, EXPANSION_CARDS, STORY_CONTENT, getCard } from '../../src/game/story/content';
import { findSpot } from '../../src/game/story/effects';
import { powerWeight } from '../../src/game/story/factions';
import { cardEligible, cardWeight, drawCard } from '../../src/game/story/pacing';
import * as turf from '../../src/game/story/turf';
import type { Card } from '../../src/game/story/types';
import { MAP_SIZE, RoadKind, Terrain, ZoneType } from '../../src/game/types';
import type { World } from '../../src/game/world';
import { headlessGame } from './harness';

const N = MAP_SIZE;

afterEach(() => {
  useStoryContent(STORY_CONTENT);
});

/** Register content whose deck holds only `id` (no system, ⚑ or other faction cards to win the draw). */
function onlyInDeck(id: string): void {
  const deck = new Set(DECK.map((c) => c.id));
  useStoryContent({ ...STORY_CONTENT, cards: STORY_CONTENT.cards.filter((c) => !deck.has(c.id) || c.id === id) });
}

function gangBlock(w: World, gang: 1 | 2, x0: number, y0: number, size: number, str = 50): void {
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      w.turf.owner[w.idx(x, y)] = gang;
      w.turf.str[w.idx(x, y)] = str;
    }
  turf.refreshStats(w);
}

function home(w: World, x: number, y: number): void {
  w.setZone(x, y, ZoneType.Residential);
  w.setLevel(x, y, 2);
}

/** Make the world meet a card's `when` (and spot), the way a city that earned it would. */
const SETUP: Record<string, (g: Game) => void> = {
  'ex.manifest': ({ world: w }) => {
    w.addBuilding('seaport', 10, 10);
    gangBlock(w, 1, 30, 30, 4);
  },
  'ex.backway': ({ world: w }) => {
    for (let x = 5; x < 45; x++) w.setRoad(x, 40, RoadKind.Alley);
    w.stats.roads.alley = 40;
    gangBlock(w, 1, 20, 38, 5);
  },
  'ex.convoy': ({ world: w }) => {
    w.addBuilding('seaport', 10, 10);
    for (let y = 20; y < 45; y++) w.setRoad(30, y, RoadKind.Highway);
    w.stats.roads.highway = 25;
  },
  'ex.lounge': ({ world: w }) => {
    w.addBuilding('airport', 20, 20);
  },
  'ex.glassshore': ({ world: w }) => {
    for (let y = 0; y < N; y++) w.tiles[w.idx(50, y)].terrain = Terrain.Water;
    home(w, 48, 12);
    home(w, 49, 20);
    w.fields.landValue[w.idx(49, 20)] = 0.6;
    w.stats.wealth = [60, 25, 15];
  },
  'ex.pricedout': ({ world: w }) => {
    w.stats.wealth = [40, 35, 25];
  },
  'ex.thecut': ({ world: w }) => {
    for (let y = 10; y < 45; y++) w.setRoad(30, y, RoadKind.Highway);
    w.stats.roads.highway = 35;
    home(w, 32, 20);
    home(w, 28, 30);
    w.fields.noise[w.idx(28, 30)] = 0.7;
  },
  'ex.rights': ({ world: w }) => {
    w.addBuilding('spaceport', 20, 20);
  },
  'ex.stringlights': ({ world: w }) => {
    w.stats.roads.skyway = 24;
  },
  'ex.nofly': ({ world: w }) => {
    w.addBuilding('airport', 20, 20);
    gangBlock(w, 2, 40, 40, 4);
  },
  'ex.nightschool': ({ world: w }) => {
    w.addBuilding('academy', 20, 20);
    w.story.flags.tuningActive = true;
  },
};

/** The tile each spot card should name. */
const SPOT_AT: Record<string, [number, number]> = {
  'ex.backway': [20, 40],
  'ex.glassshore': [49, 20],
  'ex.thecut': [28, 30],
};

function game(): Game {
  const g = headlessGame(2091, false, 'brisk');
  const st = g.world.story;
  if (!st.unlocks.includes('comms')) st.unlocks.push('comms');
  st.lastCardTick = g.world.tick - 1000;
  return g;
}

describe('expansion cards are drawable where the city has earned them (EXPANSION §8.3)', () => {
  it('has a setup for every card', () => {
    expect(Object.keys(SETUP).sort()).toEqual(EXPANSION_CARDS.map((c) => c.id).sort());
  });

  for (const card of EXPANSION_CARDS) {
    it(`${card.id}: ineligible on a fresh city, drawn from the deck once its when and spot hold, and every choice resolves`, () => {
      const g = game();
      const w = g.world;
      expect(cardEligible(w, card), 'a fresh city has not earned it').toBe(false);
      SETUP[card.id](g);
      expect(cardEligible(w, card)).toBe(true);
      expect(cardWeight(w, card)).toBeGreaterThan(0);

      // The deck's weighted draw picks it (alone in the deck, so nothing else can win).
      onlyInDeck(card.id);
      let picked: Card | null = null;
      for (let seed = 1; seed <= 40 && !picked; seed++) picked = drawCard(w, new Rng(seed), true, 1).pick?.card ?? null;
      expect(picked?.id).toBe(card.id);
      useStoryContent(STORY_CONTENT);

      // Its spot is the place the rule describes, and {district} is filled with it.
      const spot = card.spot ? findSpot(w, card.spot, new Rng(3)) : -1;
      if (card.spot) {
        const [sx, sy] = SPOT_AT[card.id];
        expect(spot).toBe(w.idx(sx, sy));
      }
      // Deliver it as the deck would (a COMMS card), open it, and answer each choice in turn.
      for (let i = 0; i < card.choices.length; i++) {
        const gi = i === 0 ? g : game();
        if (i > 0) SETUP[card.id](gi);
        const s = gi.world.story;
        // What director.deliver does for a deck card that waits in COMMS.
        s.seen[card.id] = gi.world.tick;
        s.pending = { card: card.id, tick: gi.world.tick, spot };
        gi.openPending();
        const view = gi.story.view().card!;
        expect(view.id).toBe(card.id);
        expect(view.body).not.toMatch(/\{\w+\}/);
        expect(view.brief ?? '').not.toMatch(/\{\w+\}/);
        if (card.spot) {
          const name = districtName(spot % N, Math.floor(spot / N), gi.world.seed);
          expect(view.body).toContain(name);
        }
        const ch = view.choices[i];
        expect(ch.hints.length, `${card.id} choice ${i} shows what it does`).toBeGreaterThan(0);
        if (ch.locked) continue;
        gi.choose(i);
        expect(gi.world.story.open).toBeNull();
        expect(gi.world.story.log[gi.world.story.log.length - 1]).toMatchObject({ card: card.id, choice: i });
        // A `once` card never asks again.
        if (card.once) expect(cardEligible(gi.world, card)).toBe(false);
      }
    });
  }
});

describe('ex.rights: launch rights for the Spaceport (EXPANSION §5.3, §8.3)', () => {
  const RIGHTS = ['basalt', 'nacre', 'board', 'kites'] as const;

  function withSpaceport() {
    const g = game();
    const w = g.world;
    const sp = w.addBuilding('spaceport', 20, 20)!;
    return { g, w, sp };
  }

  it('opens on demand from the Spaceport sheet, takes no deck slot, and each choice hands the rights to one holder', () => {
    for (let i = 0; i < RIGHTS.length; i++) {
      const { g, w, sp } = withSpaceport();
      const st = w.story;
      if (RIGHTS[i] === 'kites') st.favor.kites = 40; // the Kites must be Friendly
      st.deckSec = 77;
      st.frontSec = 33;
      const before = powerWeight(w, RIGHTS[i]);
      const [a] = g.inspectActions(21, 21);
      expect(a).toMatchObject({ id: 'rights', enabled: true, buildingId: sp.id });
      expect(g.openLaunchRights(sp.id).ok).toBe(true);
      expect(st.open?.card).toBe('ex.rights');
      const view = g.story.view().card!;
      expect(view.canLater).toBe(false);
      expect(view.choices[i].locked).toBeUndefined();
      g.choose(i);
      expect(st.open).toBeNull();
      expect(st.flags.launchRights).toBe(RIGHTS[i]);
      expect([st.deckSec, st.frontSec]).toEqual([77, 33]);
      expect(powerWeight(w, RIGHTS[i]) - before).toBe(POWER_WEIGHTS[RIGHTS[i]].launchRights);
      // Answered: the button goes away and the card can't open or be drawn again.
      expect(g.inspectActions(21, 21)).toEqual([]);
      expect(g.story.openOnDemand('ex.rights').ok).toBe(false);
      expect(cardEligible(w, getCard('ex.rights')!)).toBe(false);
    }
  });

  it('keeps the Kites choice locked until the Kites are Friendly', () => {
    const { g, sp } = withSpaceport();
    g.world.story.favor.kites = 0;
    g.openLaunchRights(sp.id);
    expect(g.story.view().card!.choices[3].locked).toBe('Needs the Kites Friendly');
  });

  it('comes through the deck for a player who never taps the button', () => {
    onlyInDeck('ex.rights');
    const g = game();
    const w = g.world;
    const st = w.story;
    w.addBuilding('spaceport', 20, 20);
    // Every deck gate open: long since the last card, the last story card and the start.
    st.deckSec = 1e6;
    st.frontSec = 1e6;
    st.sinceStartSec = 1e6;
    st.lastBeatTick = w.tick - 1000;
    for (let m = 0; m < 24 && !st.pending; m++) {
      w.tick += 30;
      g.story.onMonth();
    }
    expect(st.pending?.card).toBe('ex.rights');
    expect(storyContent().cards.get('ex.rights')?.onDemand).toBe(true);
    // The inspect button now opens that pending COMMS card (it keeps its Later).
    const sp = [...w.buildings.values()].find((b) => b.type === 'spaceport')!;
    expect(g.openLaunchRights(sp.id).ok).toBe(true);
    expect(st.open?.card).toBe('ex.rights');
    expect(g.story.view().card!.canLater).toBe(true);
    g.choose(2);
    expect(st.pending).toBeNull();
    expect(st.flags.launchRights).toBe('board');
  });
});
