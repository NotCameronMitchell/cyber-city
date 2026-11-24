// ─────────────────────────────────────────────────────────────────────────────
// PortSystem (docs/EXPANSION.md §5, §6.3): seaport / airport / spaceport
// counts, visitors, trade, the spaceport countdown and opening moments.
//
//   refresh()   pure: demand adds, "Port trade" per seaport, visitors (X3).
//               Runs every tick and in recomputeAll.
//   tick()      daily, step() only: the Spaceport countdown (held at 1 day
//               while waitSec > 0; Game counts waitSec down in real time),
//               art steps at ⅓ and ⅔, completion news and the moment.
//   announce()  step() only: once-per-city opening moments (world.moments).
//
// A port counts while it is online (not offline) and powered; the Spaceport
// only once complete. The `PortView` interface is frozen (Step 0).
// ─────────────────────────────────────────────────────────────────────────────

import { AIRPORT, BUILDINGS, SEAPORT, SPACEPORT, TOURISM } from '../config';
import type { Building } from '../types';
import type { World } from '../world';
import type { Census } from './census';
import type { SimGrid } from './grid';

/** Read-only port numbers for Game, inspect and art (`Simulation.ports`). Frozen after Step 0. */
export interface PortView {
  /** Visitors per month (X3). */
  readonly visitors: number;
  /** Fab jobs the counted seaports add to industrial demand. */
  readonly exportJobs: number;
  /** Market jobs the airport and a complete spaceport add to commercial demand. */
  readonly comJobs: number;
  /** Fab jobs a complete spaceport adds to industrial demand. */
  readonly indJobs: number;
  /** "Port trade" credits per month of seaport `id` (0 for other buildings). */
  tradeFor(id: number): number;
  /** 0..1 construction progress of building `id`: the Spaceport combines days and waitSec; anything else reads 1. */
  buildProgress(id: number): number;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const LANDMARK_VISITORS: Partial<Record<string, number>> = { ...TOURISM.landmark };

/** A port that works: online, powered and (Spaceport) complete. */
export function portLive(b: Building): boolean {
  return b.offline <= 0 && b.powered && (b.buildDays ?? 0) <= 0;
}

/** Art stage of a spaceport under construction: 0, 1 (⅓) or 2 (⅔). */
const stageOf = (p: number): number => (p >= 2 / 3 ? 2 : p >= 1 / 3 ? 1 : 0);

export class PortSystem implements PortView {
  visitors = 0;
  exportJobs = 0;
  comJobs = 0;
  indJobs = 0;
  /** Live seaports, airports and complete spaceports (this refresh). */
  seaports = 0;
  airports = 0;
  spaceports = 0;
  /** "Port trade" per live seaport, CR per month. */
  private readonly trade = new Map<number, number>();
  /** Last art stage seen per spaceport under construction (not saved: a reload just re-reads it). */
  private readonly stage = new Map<number, number>();

  constructor(private readonly world: World) {}

  tradeFor(id: number): number {
    return this.trade.get(id) ?? 0;
  }

  /** Σ "Port trade" over every live seaport (CR per month). */
  get tradeTotal(): number {
    let s = 0;
    for (const v of this.trade.values()) s += v;
    return s;
  }

  /**
   * min((D − buildDays) / D, (S − waitSec) / S) for a Spaceport (D = its buildDays,
   * S = SPACEPORT.minBuildSec); 1 for every other existing building, 0 for an unknown id.
   */
  buildProgress(id: number): number {
    const b = this.world.buildings.get(id);
    if (!b) return 0;
    return progressOf(b);
  }

  /**
   * Counts, demand adds, trade and visitors (pure; no events). `approval` is the smoothed
   * approval, census must be current (jobs, jobFill, avgCrime, tier counts).
   */
  refresh(world: World, g: SimGrid, census: Census, approval: number): void {
    let sea = 0;
    let air = 0;
    let space = 0;
    let landmarks = 0;
    this.trade.clear();
    const perSeaport = Math.min(SEAPORT.tradeCap, SEAPORT.tradeRate * census.jobsInd * census.jobFill);
    for (const b of g.buildings) {
      const lm = LANDMARK_VISITORS[b.type];
      if (lm && b.offline <= 0 && b.powered) landmarks += lm;
      if (b.type !== 'seaport' && b.type !== 'airport' && b.type !== 'spaceport') continue;
      if (!portLive(b)) continue;
      if (b.type === 'seaport') {
        sea++;
        this.trade.set(b.id, Math.round(perSeaport));
      } else if (b.type === 'airport') air++;
      else space++;
    }
    this.seaports = sea;
    this.airports = air;
    this.spaceports = space;
    this.exportJobs = SEAPORT.exportJobs * Math.min(sea, SEAPORT.maxCounted);
    this.comJobs = AIRPORT.comJobs * air + SPACEPORT.comJobs * space;
    this.indJobs = SPACEPORT.indJobs * space;

    // X3 tourism (§6.3).
    const highCom = census.tierCount[2 * 3 + 2];
    const raw =
      TOURISM.airport * air +
      TOURISM.spaceport * space +
      TOURISM.perHighCom * highCom +
      landmarks +
      TOURISM.perEdgePoint * g.edgePoints;
    let mood = approval / TOURISM.approvalRef;
    mood = mood < TOURISM.moodMin ? TOURISM.moodMin : mood > TOURISM.moodMax ? TOURISM.moodMax : mood;
    mood *= 1 - TOURISM.crimeHit * census.avgCrime;
    this.visitors = raw > 0 ? Math.max(0, Math.round(raw * mood)) : 0;
  }

  /**
   * Daily (step only): count the Spaceport's buildDays down, holding at 1 while waitSec > 0;
   * repaint its footprint when the progress crosses ⅓ and ⅔; on completion post the news,
   * play the milestone sound and the once-per-city 'spaceport' moment.
   */
  tick(world: World): void {
    for (const b of world.buildings.values()) {
      if (b.type !== 'spaceport') continue;
      const d = b.buildDays ?? 0;
      if (d <= 0) {
        this.stage.delete(b.id);
        continue;
      }
      const wait = b.waitSec ?? 0;
      if (d > 1) b.buildDays = d - 1;
      else if (wait <= 0) b.buildDays = 0;
      const x1 = b.x + b.size - 1;
      const y1 = b.y + b.size - 1;
      if ((b.buildDays ?? 0) <= 0) {
        this.stage.delete(b.id);
        world.markChanged(b.x, b.y, x1, y1);
        world.addNews(`The ${world.cityName} Spaceport is finished. The first launch goes up on the next clear night.`, 'good');
        world.events.emit('sfx', 'milestone');
        this.moment(world, 'spaceport', 'SPACEPORT COMPLETE', 'First launch on the next clear night');
        continue;
      }
      const s = stageOf(progressOf(b));
      const prev = this.stage.get(b.id);
      if (prev !== undefined && prev !== s) world.markChanged(b.x, b.y, x1, y1);
      this.stage.set(b.id, s);
    }
  }

  /** Step only, after refresh(): the once-per-city opening banners for the Seaport and the Airport (§5.4). */
  announce(world: World): void {
    if (this.seaports > 0) this.moment(world, 'seaport', 'SEAPORT OPEN', `+${fmt(SEAPORT.exportJobs)} Fab jobs`);
    if (this.airports > 0) this.moment(world, 'airport', 'AIRPORT OPEN', `+${fmt(TOURISM.airport)} visitors a month`);
  }

  private moment(world: World, id: 'seaport' | 'airport' | 'spaceport', title: string, sub: string): void {
    if (world.moments.has(id)) return;
    world.moments.add(id);
    world.events.emit('moment', { id, title, sub });
  }
}

/** Spaceport construction progress 0..1 (days and real seconds); 1 for anything else. */
function progressOf(b: Building): number {
  if (b.type !== 'spaceport') return 1;
  const D = BUILDINGS.spaceport.buildDays ?? 0;
  const S = SPACEPORT.minBuildSec;
  const days = D > 0 ? (D - Math.min(D, Math.max(0, b.buildDays ?? 0))) / D : 1;
  const secs = S > 0 ? (S - Math.min(S, Math.max(0, b.waitSec ?? 0))) / S : 1;
  return Math.min(days, secs);
}
