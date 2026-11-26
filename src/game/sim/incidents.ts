// ─────────────────────────────────────────────────────────────────────────────
// Random city incidents: grid hacks, crew surges, corporate grants, smog
// alerts and black-market booms. Roughly one every 2–4 months after a grace
// period. Temporary effects (crime hotspots, smog, commercial boost) decay
// every tick; plant outages count down on building.offline.
//
// Story hooks (§3.2, §10.6, §11): the interval between incidents ÷
// mods.eventRateMul; once a gang has seeded, a crew surge is that gang's
// (picked from plain world.turf data, no story imports) and is reported as a
// `gangSurge` signal; corp grants report a `corpGrant` signal. Applying the
// surge's turf strength (TURF.surge) is the signal consumer's job.
// ─────────────────────────────────────────────────────────────────────────────

import { placeAt } from '../districts/names';
import { BUILDINGS, CURRENCY, GANG_IDS, GANG_NEWS_NAME, TURF, TURF_GANG } from '../config';
import { CORPS, CREWS, EVENT_COPY, pickLine } from '../news';
import type { GangId } from '../story/types';
import type { Building } from '../types';
import type { World } from '../world';
import type { Census } from './census';
import type { FieldSystem } from './fields';
import type { SimGrid } from './grid';
import * as T from './tuning';

type IncidentKind = 'gridHack' | 'gangSurge' | 'corpGrant' | 'smog' | 'blackMarket';

const fmtCr = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${CURRENCY}`;

export class IncidentSystem {
  /** Tick of the next incident roll (-1 = not scheduled yet). */
  nextTick = -1;
  /** Temporary commercial demand boost (decays). */
  comBoost = 0;
  /** Last incident fired (for tests / debug). */
  last: IncidentKind | null = null;

  /** Per-tick upkeep: decay boosts, count down plant outages. Returns true if a plant came back online. */
  tick(world: World, g: SimGrid): boolean {
    if (this.comBoost > 0) this.comBoost = this.comBoost < 0.01 ? 0 : this.comBoost * T.COM_BOOST_DECAY;
    let restored = false;
    for (const b of g.buildings) {
      if (b.offline <= 0) continue;
      b.offline--;
      if (b.offline === 0) {
        restored = true;
        world.addNews(pickLine(world.rng, EVENT_COPY.gridRestored, { plant: BUILDINGS[b.type].name }), 'good');
      }
    }
    return restored;
  }

  /** Maybe fire an incident. `enabled` mirrors SimOptions.events. */
  update(world: World, g: SimGrid, fields: FieldSystem, census: Census, enabled: boolean): void {
    const rng = world.rng;
    if (this.nextTick < 0) this.nextTick = Math.max(T.EVENT_GRACE_TICKS, world.tick) + rng.int(0, 45);
    if (world.tick < this.nextTick) return;
    const gap = rng.int(T.EVENT_INTERVAL[0], T.EVENT_INTERVAL[1]);
    const rate = world.mods.eventRateMul;
    this.nextTick = world.tick + (rate === 1 ? gap : Math.max(1, Math.round(gap / rate)));
    if (!enabled || census.population < T.EVENT_MIN_POP) return;

    const plants = g.buildings.filter((b) => BUILDINGS[b.type].powerSupply > 0 && b.offline === 0);
    const devTotal = census.developed[1] + census.developed[2] + census.developed[3];
    const options: [IncidentKind, number][] = [
      ['corpGrant', 0.8],
      ['gridHack', plants.length > 0 && census.population >= 3000 ? 0.7 : 0],
      ['gangSurge', devTotal >= 12 ? 1.1 : 0],
      ['smog', census.developed[3] >= 6 ? 0.8 : 0],
      ['blackMarket', census.developed[2] >= 4 ? 0.8 : 0],
    ];
    let total = 0;
    for (const [, w] of options) total += w;
    let roll = rng.next() * total;
    let kind: IncidentKind = 'corpGrant';
    for (const [k, w] of options) {
      if (roll < w) {
        kind = k;
        break;
      }
      roll -= w;
    }
    this.last = kind;
    switch (kind) {
      case 'gridHack':
        this.gridHack(world, rng.pick(plants));
        break;
      case 'gangSurge':
        this.gangSurge(world, g, fields);
        break;
      case 'corpGrant':
        this.corpGrant(world, census);
        break;
      case 'smog':
        fields.smog = 1;
        world.addNews(pickLine(rng, EVENT_COPY.smog, { city: world.cityName }), 'bad');
        world.events.emit('sfx', 'alert');
        break;
      case 'blackMarket': {
        this.comBoost = 0.45;
        const at = randomDeveloped(world, g, 2);
        world.addNews(
          pickLine(rng, EVENT_COPY.blackMarket, {
            city: world.cityName,
            district: at >= 0 ? placeAt(world, at % world.N, (at / world.N) | 0) : 'the arcades',
          }),
          'good',
        );
        break;
      }
    }
  }

  private gridHack(world: World, plant: Building): void {
    const rng = world.rng;
    const N = world.N;
    const cx = Math.min(N - 1, plant.x + (plant.size >> 1));
    const cy = Math.min(N - 1, plant.y + (plant.size >> 1));
    const security = world.fields.security[cy * N + cx];
    const vars = { plant: BUILDINGS[plant.type].name, district: placeAt(world, cx, cy) };
    if (rng.next() < security * 0.85) {
      world.addNews(pickLine(rng, EVENT_COPY.gridHackFoiled, vars), 'good');
      return;
    }
    const days = rng.int(10, 25);
    plant.offline = days;
    world.addNews(pickLine(rng, EVENT_COPY.gridHack, { ...vars, days }), 'bad');
    world.events.emit('sfx', 'alert');
  }

  private gangSurge(world: World, g: SimGrid, fields: FieldSystem): void {
    const rng = world.rng;
    const sec = world.fields.security;
    // Crews pick the densest, least-patrolled spot among a few candidates.
    let best = -1;
    let bestScore = -Infinity;
    for (let s = 0; s < 10; s++) {
      const i = randomDeveloped(world, g, 1);
      if (i < 0) break;
      const score = fields.density[i] - sec[i] * 1.5 + rng.next() * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return;
    const x = best % world.N;
    const y = (best / world.N) | 0;
    const strength = (0.32 + rng.next() * 0.16) * (1 - 0.6 * sec[best]);
    fields.addCrimeHotspot(x, y, 6, strength);
    const gang = surgeGang(world, x, y);
    const crew = gang ? GANG_NEWS_NAME[gang] : rng.pick(CREWS);
    world.addNews(pickLine(rng, EVENT_COPY.gangSurge, { crew, district: placeAt(world, x, y) }), 'bad');
    if (gang) world.pushSignal({ t: 'gangSurge', x, y, gang });
    world.events.emit('sfx', 'alert');
  }

  private corpGrant(world: World, census: Census): void {
    const rng = world.rng;
    // CR stay at per-building parity (MEGACITY §4.3): 0.04 per resident in ×10 units is v3's 0.4.
    const amount = Math.round(Math.min(12000, Math.max(1500, 1500 + census.population * 0.04)) / 100) * 100;
    world.funds += amount;
    world.pushSignal({ t: 'corpGrant', amount });
    world.addNews(
      pickLine(rng, EVENT_COPY.corpGrant, { corp: rng.pick(CORPS), city: world.cityName, amount: fmtCr(amount) }),
      'good',
    );
    world.events.emit('sfx', 'money');
  }
}

/**
 * The gang behind a surge at (x, y) (§3.2): the owner of the nearest owned turf
 * tile within TURF.surge.searchRadius (Chebyshev rings), else a random seeded
 * gang; null while no gang has seeded (the surge stays a flavor crew's).
 */
export function surgeGang(world: World, x: number, y: number): GangId | null {
  const turf = world.turf;
  let seeded = 0;
  for (const gid of GANG_IDS) if (turf.seeded[gid]) seeded++;
  if (seeded === 0) return null;
  const owner = turf.owner;
  const N = world.N;
  const R = TURF.surge.searchRadius;
  for (let r = 0; r <= R; r++) {
    const y0 = y - r;
    const y1 = y + r;
    for (let yy = Math.max(0, y0); yy <= Math.min(N - 1, y1); yy++) {
      const edgeRow = yy === y0 || yy === y1;
      const step = edgeRow ? 1 : 2 * r;
      for (let xx = x - r; xx <= x + r; xx += step || 1) {
        if (xx < 0 || xx >= N) continue;
        const gang = TURF_GANG[owner[yy * N + xx]];
        if (gang) return gang;
      }
    }
  }
  let pick = Math.floor(world.rng.next() * seeded);
  for (const gid of GANG_IDS) {
    if (!turf.seeded[gid]) continue;
    if (pick-- === 0) return gid;
  }
  return null;
}

/** A random developed tile index (optionally of one zone type), or -1. */
function randomDeveloped(world: World, g: SimGrid, zone = 0): number {
  if (g.zonedCount === 0) return -1;
  for (let attempt = 0; attempt < 24; attempt++) {
    const i = g.zoned[Math.floor(world.rng.next() * g.zonedCount)];
    if (g.developed(i) && (zone === 0 || g.zone[i] === zone)) return i;
  }
  return -1;
}
