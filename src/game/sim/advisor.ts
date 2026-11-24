// ─────────────────────────────────────────────────────────────────────────────
// City advisor: rate-limited warnings and tips, one-off development highlights
// (first mid-rise, first tower…), building unlock announcements, milestones
// and the flavor-headline schedule.
//
// Story hooks (§11): each milestone also pushes a `milestone` signal; unlock
// news skips gated (story / faction) buildings, which the director announces.
//
// Expansion (docs/EXPANSION.md §7.1, §7.6, Appendix B): unlock news names the
// tray ("Unlocked: Avenue (Road). …") for road kinds, the Skyway and
// buildings; six first-tier highlights; the hwnoramp / skyloose / noisehome
// lines with their `hint` events; the revised roads and traffic lines.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, BUILDING_ORDER, CURRENCY, MILESTONES, ROAD_KINDS, SKYWAY, ZONES, type BuildingDef } from '../config';
import type { HintId } from '../events';
import { HeadlineDeck } from '../news';
import { ZoneType, type Demand, type NewsItem } from '../types';
import type { World } from '../world';
import type { Census } from './census';
import type { SimGrid } from './grid';
import type { PowerGrid } from './power';
import * as T from './tuning';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** First-time development highlights, keyed by zone * 4 + level. */
const HIGHLIGHTS: Record<number, { text: string; kind: NewsItem['kind'] }> = {
  [ZoneType.Residential * 4 + 1]: { text: 'First settlers move into {city}. Capsule homes glow along the new streets.', kind: 'good' },
  [ZoneType.Commercial * 4 + 1]: { text: 'First Market Strip opens: a noodle stall, a repair booth and a very loud sign.', kind: 'good' },
  [ZoneType.Industrial * 4 + 1]: { text: 'First Fab Yards shift starts. The drones are already on overtime.', kind: 'good' },
  [ZoneType.Residential * 4 + 2]: { text: 'Mid-rise hab stacks rise in {city}. Land value is paying off.', kind: 'good' },
  [ZoneType.Commercial * 4 + 2]: { text: 'Arcade malls are moving in. {city} has a shopping district.', kind: 'good' },
  [ZoneType.Industrial * 4 + 2]: { text: 'Fab lines double up: mid-density factories online.', kind: 'info' },
  [ZoneType.Residential * 4 + 3]: { text: "Skyline moment: {city}'s first hab tower tops out at ninety floors.", kind: 'good' },
  [ZoneType.Commercial * 4 + 3]: { text: 'A holo-ad mega-mall lights up the night: first high-density Market Strip.', kind: 'good' },
  [ZoneType.Industrial * 4 + 3]: { text: 'First automated mega-fab comes online. The night shift is now entirely robots.', kind: 'info' },
};

/** First-tier highlights (Appendix B), keyed by zone * 3 + tier. */
const WEALTH_HIGHLIGHTS: Record<number, { text: string; kind: NewsItem['kind'] }> = {
  [ZoneType.Residential * 3 + 1]: { text: 'Window boxes and working lifts: the first $$ Hab Blocks in {city}.', kind: 'good' },
  [ZoneType.Residential * 3 + 2]: { text: 'Glass balconies, private lifts: the first $$$ Hab Blocks in {city}. Land value did that.', kind: 'good' },
  [ZoneType.Commercial * 3 + 1]: { text: 'The noodle bars get real chairs. First $$ Market Strip.', kind: 'good' },
  [ZoneType.Commercial * 3 + 2]: { text: 'A boutique with no prices on anything: the first $$$ Market Strip.', kind: 'good' },
  [ZoneType.Industrial * 3 + 1]: { text: 'Cleaner lines, better pay: the first $$ Fab Yards.', kind: 'info' },
  [ZoneType.Industrial * 3 + 2]: { text: 'A fab so clean it has a lobby: the first $$$ Fab Yards. The smog lifts a little.', kind: 'good' },
};

/**
 * Tray a building sits in (§7.1), for unlock news. The Power tray reads "Infra" once the first
 * port unlocks (the Seaport); `transport` buildings live there too.
 */
function trayOf(def: BuildingDef, maxPop: number): string {
  switch (def.category) {
    case 'power':
      return maxPop >= BUILDINGS.seaport.unlockPop ? 'Infra' : 'Power';
    case 'transport':
      return 'Infra';
    case 'services':
      return 'Civic';
    case 'faction':
      return 'Deals';
    default:
      return 'Sky';
  }
}

export class Advisor {
  private readonly nextAllowed = new Map<string, number>();
  private readonly seen = new Set<number>();
  /** First-tier highlights already shown or present (zone * 3 + tier). */
  private readonly seenWealth = new Set<number>();
  /** The 'wealth' hint fires on the first $$ step of the session. */
  private wealthHinted = false;
  private readonly deck = new HeadlineDeck();
  private nextFlavor = -1;
  private unlockedAt = -1;

  /**
   * Mark everything that already exists as "seen" so loading a save doesn't
   * replay highlights and unlock announcements. Called from recomputeAll().
   */
  prime(world: World, census: Census): void {
    for (const key of Object.keys(HIGHLIGHTS)) {
      if (census.levelCount[Number(key)] > 0) this.seen.add(Number(key));
    }
    this.primeWealth(census);
    if (this.unlockedAt < 0) this.unlockedAt = world.maxPopulation;
  }

  /** Mark the tiers the city already has as seen (also after Simulation.settleWealth), so they never replay. */
  primeWealth(census: Census): void {
    for (const key of Object.keys(WEALTH_HIGHLIGHTS)) {
      if (census.tierCount[Number(key)] > 0) this.seenWealth.add(Number(key));
    }
  }

  /** One-time news for the first tile of each zone/level; `reached` comes from GrowthSystem. */
  highlights(world: World, reached: Uint8Array): void {
    for (let k = 0; k < reached.length; k++) {
      if (!reached[k] || this.seen.has(k)) continue;
      this.seen.add(k);
      const h = HIGHLIGHTS[k];
      if (h) world.addNews(h.text.replace('{city}', world.cityName), h.kind);
    }
  }

  /**
   * One-time news for the first $$ / $$$ tile of each zone (`reached` from GrowthSystem, zone * 3 + tier),
   * and the 'wealth' hint on the session's first step up.
   */
  wealthHighlights(world: World, reached: Uint8Array): void {
    for (let k = 0; k < reached.length; k++) {
      if (!reached[k]) continue;
      if (!this.wealthHinted && k % 3 > 0) {
        this.wealthHinted = true;
        world.events.emit('hint', { id: 'wealth' });
      }
      if (this.seenWealth.has(k)) continue;
      this.seenWealth.add(k);
      const h = WEALTH_HIGHLIGHTS[k];
      if (h) world.addNews(h.text.replace('{city}', world.cityName), h.kind);
    }
  }

  /** Population milestones (a Board bonus, once each) and building unlocks. Mutates funds; step() only. */
  milestones(world: World, population: number): void {
    for (const m of MILESTONES) {
      if (population < m.pop || world.milestones.includes(m.pop)) continue;
      world.milestones.push(m.pop);
      world.funds += m.grant;
      world.addNews(
        `${m.title}! ${world.cityName} passes ${fmt(m.pop)} residents. The Charter Board wires a ${fmt(m.grant)} ${CURRENCY} bonus.`,
        'good',
      );
      world.events.emit('milestone', { pop: m.pop, title: m.title });
      world.pushSignal({ t: 'milestone', pop: m.pop });
      world.events.emit('sfx', 'milestone');
    }
    if (this.unlockedAt < 0) this.unlockedAt = world.maxPopulation;
    if (world.maxPopulation > this.unlockedAt) {
      const from = this.unlockedAt;
      const to = world.maxPopulation;
      const opens = (pop: number) => pop > from && pop <= to;
      // Road kinds (the On-ramp comes with the Highway) and the Skyway name their tray (§7.1).
      for (const k of ROAD_KINDS) {
        if (k.tool && opens(k.unlockPop)) world.addNews(`Unlocked: ${k.name} (Road). ${k.desc}`, 'info');
      }
      if (opens(SKYWAY.unlockPop)) world.addNews(`Unlocked: Skyway (Sky). ${SKYWAY.desc}`, 'info');
      for (const type of BUILDING_ORDER) {
        const def = BUILDINGS[type];
        if (def.gate) continue;
        if (opens(def.unlockPop)) world.addNews(`Unlocked: ${def.name} (${trayOf(def, to)}). ${def.desc}`, 'info');
      }
      this.unlockedAt = world.maxPopulation;
    }
  }

  /** Flavor headline every ~8–20 days. */
  flavor(world: World, population: number): void {
    const rng = world.rng;
    if (this.nextFlavor < 0) this.nextFlavor = world.tick + rng.int(6, 12);
    if (world.tick < this.nextFlavor) return;
    this.nextFlavor = world.tick + rng.int(T.FLAVOR_INTERVAL[0], T.FLAVOR_INTERVAL[1]);
    world.addNews(
      this.deck.draw(rng, { city: world.cityName, population, year: world.year, taxRate: world.taxRate }),
      'flavor',
    );
  }

  /** Rate-limited warnings and tips. Runs every ADVISOR_PERIOD ticks. `g` (optional) adds the road and skyway checks. */
  warnings(world: World, census: Census, power: PowerGrid, demand: Demand, g?: SimGrid): void {
    if (world.tick % T.ADVISOR_PERIOD !== 0) return;
    const devTiles = census.developed[1] + census.developed[2] + census.developed[3];
    const zonedTiles = devTiles + census.lots[1] + census.lots[2] + census.lots[3];
    const pop = census.population;

    // ── Power ───────────────────────────────────────────────────────────────
    if (power.supply === 0 && power.plants > 0 && devTiles > 0) {
      this.say(world, 'blackout', 40, 'bad', `Blackout! Every power plant is offline. A backup ${BUILDINGS.solar.name} would keep the lights on.`);
    } else if (power.supply === 0 && zonedTiles >= 4) {
      this.say(world, 'nopower', 50, 'warn', `Advisor: nothing grows without power. Build a ${BUILDINGS.solar.name} touching your roads or zones.`);
    } else if (power.overloaded) {
      const dark = power.unpoweredTiles > 0 ? ` ${plural(power.unpoweredTiles, 'block is', 'blocks are')} dark.` : '';
      this.say(
        world,
        'brownout',
        45,
        'warn',
        `Brownout! The grid needs ${fmt(power.demand)} MW but makes ${fmt(power.supply)} MW. Construction has stalled.${dark}`,
      );
    } else if (power.disconnected >= 3) {
      this.say(world, 'disconnected', 60, 'warn', 'Advisor: some blocks are cut off from the grid. Link them to a plant with roads or zones.');
    } else if (power.supply > 0 && power.demand > power.supply * 0.9) {
      this.say(world, 'powerlow', 60, 'info', `Grid at ${Math.round((power.demand / power.supply) * 100)}% capacity. Plan your next plant.`);
    }

    // ── Roads ───────────────────────────────────────────────────────────────
    if (census.noRoad >= 4) {
      this.say(world, 'roads', 60, 'warn', `Advisor: ${fmt(census.noRoad)} zoned lots have no usable road. Streets reach 3 tiles, alleys 1, highways none.`);
    }
    if (g) {
      let bare = false;
      for (let c = 0; c < g.hwCompCount && !bare; c++) if (g.hwRamps[c] === 0) bare = true;
      if (bare && this.say(world, 'hwnoramp', 120, 'warn', 'Advisor: a highway with no on-ramps carries nothing. Drag a street across it to add them.')) {
        this.hint(world, 'ramps');
      }
      let loose = false;
      for (let c = 0; c < g.skyCompCount && !loose; c++) if (!g.skyLive(c)) loose = true;
      if (loose) {
        this.say(world, 'skyloose', 180, 'info', 'Advisor: a skyway that lands nowhere carries nothing. End it on a street or run it into a megastructure.');
      }
    }

    // ── Money ───────────────────────────────────────────────────────────────
    const hist = world.budget.history;
    if (world.funds < 0) {
      this.say(world, 'broke', 45, 'bad', 'Treasury in the red! New construction is frozen. Raise taxes or demolish costly services.');
    } else if (hist.length > 0 && hist[hist.length - 1] < 0 && world.funds < 8000) {
      this.say(world, 'deficit', 60, 'warn', `Treasury: last month ran a ${fmt(-hist[hist.length - 1])} ${CURRENCY} deficit. Trim services or grow the tax base.`);
    }

    // ── Demand / jobs ───────────────────────────────────────────────────────
    if (pop > 1200 && census.unemployment > 0.18 && demand.res < 0) {
      this.say(world, 'jobs', 70, 'warn', `Advisor: residents need jobs (${Math.round(census.unemployment * 100)}% unemployed). Zone ${ZONES.com.name}s or ${ZONES.ind.name}.`);
    }
    if (demand.res > 0.45 && census.lotsWithRoad[ZoneType.Residential] < 3) {
      this.say(world, 'needres', 80, 'info', `Settlers are queueing at the city limits. Zone more ${ZONES.res.name}.`);
    }
    if (demand.com > 0.45 && census.lotsWithRoad[ZoneType.Commercial] < 2 && pop > 600) {
      this.say(world, 'needcom', 80, 'info', `Shoppers have nowhere to spend. Zone more ${ZONES.com.name}s.`);
    }
    if (demand.ind > 0.45 && census.lotsWithRoad[ZoneType.Industrial] < 2) {
      this.say(world, 'needind', 80, 'info', `Idle hands want factory shifts. Zone more ${ZONES.ind.name}.`);
    }

    // ── Livability ──────────────────────────────────────────────────────────
    if (devTiles >= 15) {
      if (census.avgCrime > 0.42) {
        const tip = world.maxPopulation >= BUILDINGS.precinct.unlockPop ? `Build an ${BUILDINGS.precinct.name} near the hot spots.` : 'Keep unemployment down until precincts unlock.';
        this.say(world, 'crime', 75, 'warn', `Advisor: crime is climbing across ${world.cityName}. ${tip}`);
      }
      if (census.avgPollution > 0.4) {
        this.say(world, 'pollution', 75, 'warn', `Advisor: smog is choking residents. Keep ${ZONES.res.name} away from fabs and add ${BUILDINGS.plaza.name}s.`);
      }
      if (census.avgTraffic > 0.6) {
        const avenue = ROAD_KINDS[1];
        const highway = ROAD_KINDS[2];
        if (world.maxPopulation >= avenue.unlockPop) {
          const hw = world.maxPopulation >= highway.unlockPop ? ', or run a Highway with on-ramps' : '';
          this.say(world, 'traffic', 75, 'warn', `Advisor: gridlock on the main drags. Widen them into Avenues${hw}.`);
        } else {
          const tip = world.maxPopulation >= BUILDINGS.maglev.unlockPop ? `or a ${BUILDINGS.maglev.name}` : 'and spread zones out';
          this.say(world, 'traffic', 75, 'warn', `Advisor: gridlock on the main drags. Add parallel roads ${tip}.`);
        }
      }
      if (census.avgNoiseRes > 0.35) {
        if (
          this.say(
            world,
            'noisehome',
            150,
            'warn',
            `Advisor: noise from highways and runways is dragging down nearby ${ZONES.res.name}. Keep homes back, or add ${BUILDINGS.plaza.name}s.`,
          )
        )
          this.hint(world, 'noise');
      }
      if (census.abandoned >= 10) {
        this.say(world, 'abandoned', 90, 'warn', `${census.abandoned} buildings stand abandoned. Check power, roads, crime and pollution.`);
      }
    }
    if (world.taxRate >= 13 && pop > 2000) {
      this.say(world, 'tax', 120, 'info', `Residents grumble about the ${world.taxRate}% tax rate. Growth is slowing.`);
    }
  }

  /** Post `text` unless `key` is cooling down; returns whether it was posted. */
  private say(world: World, key: string, cooldown: number, kind: NewsItem['kind'], text: string): boolean {
    const next = this.nextAllowed.get(key) ?? -1;
    if (world.tick < next) return false;
    this.nextAllowed.set(key, world.tick + cooldown);
    world.addNews(text, kind);
    return true;
  }

  private hint(world: World, id: HintId): void {
    world.events.emit('hint', { id });
  }
}
