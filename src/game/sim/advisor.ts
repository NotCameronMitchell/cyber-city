// ─────────────────────────────────────────────────────────────────────────────
// City advisor: rate-limited warnings and tips, one-off development highlights
// (first mid-rise, first tower…), building unlock announcements, milestones
// and the flavor-headline schedule.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, BUILDING_ORDER, CURRENCY, MILESTONES, ROAD_ACCESS_RANGE, ZONES } from '../config';
import { HeadlineDeck } from '../news';
import { ZoneType, type Demand, type NewsItem } from '../types';
import type { World } from '../world';
import type { Census } from './census';
import type { PowerGrid } from './power';
import * as T from './tuning';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** First-time development highlights, keyed by zone * 4 + level. */
const HIGHLIGHTS: Record<number, { text: string; kind: NewsItem['kind'] }> = {
  [ZoneType.Residential * 4 + 1]: { text: 'First settlers move into {city}. Capsule homes glow along the new streets.', kind: 'good' },
  [ZoneType.Commercial * 4 + 1]: { text: 'First Market Strip opens: a noodle stall, a repair booth and a very loud sign.', kind: 'good' },
  [ZoneType.Industrial * 4 + 1]: { text: 'First Fab District shift starts. The drones are already on overtime.', kind: 'good' },
  [ZoneType.Residential * 4 + 2]: { text: 'Mid-rise hab stacks rise in {city}. Land value is paying off.', kind: 'good' },
  [ZoneType.Commercial * 4 + 2]: { text: 'Arcade malls are moving in. {city} has a shopping district.', kind: 'good' },
  [ZoneType.Industrial * 4 + 2]: { text: 'Fab lines double up: mid-density factories online.', kind: 'info' },
  [ZoneType.Residential * 4 + 3]: { text: "Skyline moment: {city}'s first hab tower tops out at ninety floors.", kind: 'good' },
  [ZoneType.Commercial * 4 + 3]: { text: 'A holo-ad mega-mall lights up the night: first high-density Market Strip.', kind: 'good' },
  [ZoneType.Industrial * 4 + 3]: { text: 'First automated mega-fab comes online. The night shift is now entirely robots.', kind: 'info' },
};

export class Advisor {
  private readonly nextAllowed = new Map<string, number>();
  private readonly seen = new Set<number>();
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
    if (this.unlockedAt < 0) this.unlockedAt = world.maxPopulation;
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

  /** Population milestones (grant once) and building unlocks. Mutates funds; step() only. */
  milestones(world: World, population: number): void {
    for (const m of MILESTONES) {
      if (population < m.pop || world.milestones.includes(m.pop)) continue;
      world.milestones.push(m.pop);
      world.funds += m.grant;
      world.addNews(
        `${m.title}! ${world.cityName} passes ${fmt(m.pop)} residents. The Charter Board wires a ${fmt(m.grant)} ${CURRENCY} grant.`,
        'good',
      );
      world.events.emit('milestone', { pop: m.pop, title: m.title });
      world.events.emit('sfx', 'milestone');
    }
    if (this.unlockedAt < 0) this.unlockedAt = world.maxPopulation;
    if (world.maxPopulation > this.unlockedAt) {
      for (const type of BUILDING_ORDER) {
        const def = BUILDINGS[type];
        if (def.unlockPop > this.unlockedAt && def.unlockPop <= world.maxPopulation) {
          world.addNews(`Unlocked: ${def.name}. ${def.desc}`, 'info');
        }
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

  /** Rate-limited warnings and tips. Runs every ADVISOR_PERIOD ticks. */
  warnings(world: World, census: Census, power: PowerGrid, demand: Demand): void {
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
      this.say(world, 'roads', 60, 'warn', `Advisor: ${census.noRoad} zoned lots have no road within ${ROAD_ACCESS_RANGE} tiles. They can't develop.`);
    }

    // ── Money ───────────────────────────────────────────────────────────────
    const hist = world.budget.history;
    if (world.funds < 0) {
      this.say(world, 'broke', 45, 'bad', 'Treasury in the red! New construction is frozen. Raise taxes or demolish costly services.');
    } else if (hist.length > 0 && hist[hist.length - 1] < 0 && world.funds < 8000) {
      this.say(world, 'deficit', 60, 'warn', `Treasury: last month ran a ${fmt(-hist[hist.length - 1])} ${CURRENCY} deficit. Trim services or grow the tax base.`);
    }

    // ── Demand / jobs ───────────────────────────────────────────────────────
    if (pop > 120 && census.unemployment > 0.18 && demand.res < 0) {
      this.say(world, 'jobs', 70, 'warn', `Advisor: residents need jobs (${Math.round(census.unemployment * 100)}% unemployed). Zone ${ZONES.com.name}s or ${ZONES.ind.name}s.`);
    }
    if (demand.res > 0.45 && census.lotsWithRoad[ZoneType.Residential] < 3) {
      this.say(world, 'needres', 80, 'info', `Settlers are queueing at the city limits. Zone more ${ZONES.res.name}.`);
    }
    if (demand.com > 0.45 && census.lotsWithRoad[ZoneType.Commercial] < 2 && pop > 60) {
      this.say(world, 'needcom', 80, 'info', `Shoppers have nowhere to spend. Zone more ${ZONES.com.name}s.`);
    }
    if (demand.ind > 0.45 && census.lotsWithRoad[ZoneType.Industrial] < 2) {
      this.say(world, 'needind', 80, 'info', `Idle hands want factory shifts. Zone more ${ZONES.ind.name}s.`);
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
        const tip = world.maxPopulation >= BUILDINGS.maglev.unlockPop ? `or a ${BUILDINGS.maglev.name}` : 'and spread zones out';
        this.say(world, 'traffic', 75, 'warn', `Advisor: gridlock on the main drags. Add parallel roads ${tip}.`);
      }
      if (census.abandoned >= 10) {
        this.say(world, 'abandoned', 90, 'warn', `${census.abandoned} buildings stand abandoned. Check power, roads, crime and pollution.`);
      }
    }
    if (world.taxRate >= 13 && pop > 200) {
      this.say(world, 'tax', 120, 'info', `Residents grumble about the ${world.taxRate}% tax rate. Growth is slowing.`);
    }
  }

  private say(world: World, key: string, cooldown: number, kind: NewsItem['kind'], text: string): void {
    const next = this.nextAllowed.get(key) ?? -1;
    if (world.tick < next) return;
    this.nextAllowed.set(key, world.tick + cooldown);
    world.addNews(text, kind);
  }
}
