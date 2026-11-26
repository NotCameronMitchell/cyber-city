// ─────────────────────────────────────────────────────────────────────────────
// City life (docs/MEGACITY.md §6.4.1): night markets, lantern nights, storm
// watches, arena nights, kite days and parades.
//
// Real-time and never interrupting. Happenings run on unpaused real seconds
// (Game.update calls update(dt) only while the sim runs, so an open story card
// or the pause freezes them): the first gap opens CITY_LIFE.firstAfterSec into
// a city, each later one CITY_LIFE.gapSec after the previous happening ended,
// and at most one runs at a time. Once a gap is open the first happening whose
// condition holds starts (lantern night and arena night reserve their gap:
// the next sim month 10 for lanterns, every third gap for the Arena).
//
// Each happening posts exactly one ticker line (news 'info') at its start and
// emits 'cityEvent' start / end on the world's bus (the optional chime, WP-5).
// Its visuals last a fixed real time (art/festival.ts reads world.cityEvent);
// its gameplay terms go through world.cityEvent, which the sim reads only while
// daysLeft > 0: Simulation.step counts daysLeft down once a sim day (never
// here), from CITY_LIFE.capDays, so speed 3 does not multiply a term.
//
// Settings › City life Off starts none (and ends one in progress); lower
// detail hides the visuals only (Effects), the terms still apply (§3.11).
// Nothing here touches world.rng: City life never changes the sim's stream.
//
// The land checks (Market tiles per district, the Kites' turf, the longest
// avenue) read the whole owned area: while a gap is open a survey walks it a
// band of rows a frame (≤ SURVEY_TILES tiles), so no frame pays for the walk
// (a whole pass is ≈ 5 ms in Node at 25 districts) and a gap's checks read the
// last finished pass.
// ─────────────────────────────────────────────────────────────────────────────

import { CITY_LIFE, DISTRICTS, STANDING } from './config';
import { artOffset, slotRect } from './districts/slots';
import { neighbourhoodsOf } from './districts/names';
import { districtName } from './news';
import { hash2 } from './rng';
import { cityLifeOn } from './settings';
import { standing } from './story/factions';
import { RoadKind, ZoneType, type CityEventId, type CityEventState, type Settings, type SlotId } from './types';
import type { World } from './world';

/** What City life reads from Game. */
export interface CityEventsHost {
  readonly world: World;
  readonly settings: Settings;
  /** 0 = paused (an open story card pauses the sim too). */
  readonly speed: number;
  /** Visual daylight 0 (deep night) .. 1 (full day): night markets run at night, kite days by day. */
  readonly daylight: number;
}

/** The sky the weather layer shows (art/weather.ts Sky: 0 clear, 1 drizzle, 2 storm). */
export type CitySky = 0 | 1 | 2;

export interface CityLifeDef {
  /** Visual length, unpaused real seconds (§6.4.1). */
  sec: number;
  /** Gameplay terms while daysLeft > 0 (visitors a monthly rate). */
  visitors: number;
  approval: number;
  demandCom: number;
  /** The ticker line (Appendix B); {district} is the neighbourhood (and district short name in a multi-district city). */
  line: string;
  /** Core (4) or optional (2) in §6.4.1. */
  core: boolean;
  /** Noise v within Chebyshev r of the Arena while daysLeft > 0 (arena night; the sim's noise pass reads arenaNightNoise). */
  noise?: { v: number; r: number };
}

/** The six happenings (§6.4.1, Appendix B). */
export const CITY_LIFE_DEFS: Record<CityEventId, CityLifeDef> = {
  nightmarket: {
    sec: 120,
    visitors: 3000,
    approval: 0,
    demandCom: 0.03,
    line: 'Night market in {district} tonight: paper lanterns from one end of the street to the other.',
    core: true,
  },
  lanterns: {
    sec: 150,
    visitors: 0,
    approval: 1,
    demandCom: 0,
    line: 'Lantern night: the whole city sends paper lights up over the water.',
    core: true,
  },
  stormwatch: {
    sec: 90,
    visitors: 0,
    approval: 0,
    demandCom: 0,
    line: 'Storm watch: flood barriers up along the shore. Stay off the piers.',
    core: true,
  },
  arenanight: {
    sec: 120,
    visitors: 8000,
    approval: 0,
    demandCom: 0,
    line: 'Match night at the Arc Arena. The stations are full and the streets are louder.',
    core: true,
    noise: { v: 0.5, r: 6 },
  },
  kiteday: {
    sec: 120,
    visitors: 0,
    approval: 0,
    demandCom: 0,
    line: 'Kite day: diamond kites over {district}. Nobody admits who made them.',
    core: false,
  },
  parade: {
    sec: 90,
    visitors: 0,
    approval: 1,
    demandCom: 0,
    line: 'Parade on the avenue in {district}. Confetti in every gutter by midnight.',
    core: false,
  },
};

/**
 * The arena night's noise term (§6.3 Arc Arena: "noise 0.5 r6 only during an event"; §6.4.1): the def's noise while an
 * arena night's gameplay terms run (daysLeft > 0), else null. The sim's noise pass stamps it around the Arena.
 */
export function arenaNightNoise(world: World): { v: number; r: number } | null {
  const ev = world.cityEvent;
  return ev && ev.id === 'arenanight' && ev.daysLeft > 0 ? (CITY_LIFE_DEFS.arenanight.noise ?? null) : null;
}

/** Thresholds of the "When" column (§6.4.1). */
export const CITY_LIFE_RULES = {
  /** Developed Market tiles a district needs for a night market. */
  marketTiles: 40,
  /** Residents for a lantern night (×10 units). */
  lanternPop: 50000,
  /** The sim month of lantern night (world.month is 0-based: 9 = OCT, "month 10"). */
  lanternMonth: 9,
  /** Approval for a parade. */
  paradeApproval: 70,
  /** Arena night takes every third gap. */
  arenaEvery: 3,
  /** Night (daylight below) and day (above) for the night market and kite day. */
  nightBelow: 0.3,
  dayAbove: 0.6,
  /** Avenue run a parade needs (tiles). */
  paradeRun: 6,
  /** Seconds between condition checks while a gap is open. */
  checkSec: 1,
} as const;

/** The least start-to-start spacing: never more than 7 happenings in any unpaused hour (E1). */
const MIN_SPACING = 3600 / 7 + 1;

/**
 * The `{district}` name for a tile (§6.4.1): the neighbourhood there and, in a city of more than one district, the
 * district's short name ("Paper Lane, Verdigris"). Charter Shore keeps today's names (news.ts districtName).
 */
export function placeName(world: World, x: number, y: number): string {
  const ao = artOffset(world);
  const s = world.slotAt(x, y);
  const kind = s >= 0 ? world.districts.kinds[s] : 'shore';
  let name: string;
  if (!kind || kind === 'shore') name = districtName(x, y, world.seed, ao);
  else {
    const list = neighbourhoodsOf(kind, world.variantOf(s));
    name = list.length ? list[Math.floor(hash2((x - ao) >> 3, (y - ao) >> 3, world.seed ^ 0x51ed) * list.length)] : DISTRICTS[kind].name;
  }
  if (world.districts.owned.length <= 1 || s < 0 || !kind) return name;
  const v = world.variantOf(s);
  const short = v > 0 ? DISTRICTS[kind].variants[v - 1]?.short ?? DISTRICTS[kind].short : DISTRICTS[kind].short;
  return `${name}, ${short}`;
}

/** Where a happening is: its slot and the tile its {district} names. */
interface Place {
  slot?: SlotId;
  x: number;
  y: number;
}

/** Tiles a survey step reads at most (one frame's share of the land checks). */
export const SURVEY_TILES = 2560;

type Avenue = { x0: number; y0: number; x1: number; y1: number; len: number };

/**
 * One pass over the owned land for the City life checks, a band of rows at a time: developed, lived-in Market tiles
 * per owned slot (and the busiest tile of each), the Glass Kites' turf per owned slot (count and centre) and the
 * longest straight run of Avenue tiles (vertical runs carry across bands in a per-column counter).
 */
export class LandSurvey {
  /** The finished pass (null until one completes for this world). */
  markets: { slot: SlotId; count: number; x: number; y: number }[] | null = null;
  kites: { slot: SlotId; n: number; x: number; y: number }[] | null = null;
  avenue: Avenue | null = null;
  private world: World | null = null;
  private y = 0;
  private x0 = 0;
  private x1 = -1;
  private y1 = -1;
  private col = new Int32Array(0);
  private mCount = new Int32Array(0);
  private mBest = new Int32Array(0);
  private mAt = new Int32Array(0);
  private kN = new Int32Array(0);
  private kX = new Float64Array(0);
  private kY = new Float64Array(0);
  private best: Avenue | null = null;
  /** Passes finished (tests, diagnostics). */
  passes = 0;

  get ready(): boolean {
    return this.markets !== null;
  }

  /**
   * Start a new pass over `box` (default the owned box; the finished pass stays readable until this one completes);
   * another world drops everything.
   */
  restart(world: World, box?: { x0: number; y0: number; x1: number; y1: number }): void {
    if (world !== this.world) {
      this.world = world;
      this.markets = this.kites = null;
      this.avenue = null;
    }
    const b = box ?? world.ownedBox;
    this.x0 = b.x0;
    this.x1 = b.x1;
    this.y = b.y0;
    this.y1 = b.y1;
    const w = Math.max(0, b.x1 - b.x0 + 1);
    if (this.col.length < w) this.col = new Int32Array(w);
    else this.col.fill(0, 0, w);
    const n = world.region * world.region;
    if (this.mCount.length !== n) {
      this.mCount = new Int32Array(n);
      this.mBest = new Int32Array(n);
      this.mAt = new Int32Array(n);
      this.kN = new Int32Array(n);
      this.kX = new Float64Array(n);
      this.kY = new Float64Array(n);
    }
    this.mCount.fill(0);
    this.mBest.fill(-1);
    this.mAt.fill(-1);
    this.kN.fill(0);
    this.kX.fill(0);
    this.kY.fill(0);
    this.best = null;
  }

  /** Read up to `budget` tiles of the pass (whole rows; at least one). True when the pass finished on this call. */
  step(world: World, budget = SURVEY_TILES): boolean {
    if (world !== this.world) this.restart(world);
    const { x0, x1 } = this;
    const w = x1 - x0 + 1;
    if (w <= 0 || this.y > this.y1) return this.finish(world);
    const N = world.N;
    const R = world.region;
    const tiles = world.tiles;
    const owned = world.slotOwned;
    const turf = world.turf?.owner;
    const kites = turf && turf.length === world.area ? turf : null;
    const col = this.col;
    let rows = Math.max(1, Math.floor(budget / w));
    for (; rows > 0 && this.y <= this.y1; rows--, this.y++) {
      const y = this.y;
      const sy = (y >> 6) * R;
      let run = 0;
      let i = y * N + x0;
      for (let x = x0; x <= x1; x++, i++) {
        const s = sy + (x >> 6);
        const t = tiles[i];
        const own = owned[s] === 1;
        const ave = own && t.road && t.roadKind === RoadKind.Avenue;
        // Horizontal runs end at the row's end; vertical runs at the column's first non-avenue tile.
        if (ave) run++;
        else if (run) {
          this.offer(x - run, y, x - 1, y, run);
          run = 0;
        }
        const c = x - x0;
        if (ave) col[c]++;
        else if (col[c]) {
          this.offer(x, y - col[c], x, y - 1, col[c]);
          col[c] = 0;
        }
        if (!own) continue;
        if (t.zone === ZoneType.Commercial && t.level >= 1 && !t.abandoned) {
          this.mCount[s]++;
          if (t.level > this.mBest[s]) {
            this.mBest[s] = t.level;
            this.mAt[s] = i;
          }
        }
        if (kites && kites[i] === 2) {
          this.kN[s]++;
          this.kX[s] += x;
          this.kY[s] += y;
        }
      }
      if (run) this.offer(x1 - run + 1, y, x1, y, run);
    }
    if (this.y <= this.y1) return false;
    // Columns still running at the bottom row.
    for (let c = 0; c < w; c++) if (col[c]) this.offer(x0 + c, this.y1 - col[c] + 1, x0 + c, this.y1, col[c]);
    return this.finish(world);
  }

  /** Run a whole pass over `box` (default the owned box) now (tests; checks outside a running game). */
  full(world: World, box?: { x0: number; y0: number; x1: number; y1: number }): this {
    this.restart(world, box);
    while (!this.step(world, Infinity));
    return this;
  }

  private offer(x0: number, y0: number, x1: number, y1: number, len: number) {
    if (len > (this.best?.len ?? 0)) this.best = { x0, y0, x1, y1, len };
  }

  private finish(world: World): true {
    const N = world.N;
    const markets: { slot: SlotId; count: number; x: number; y: number }[] = [];
    const kites: { slot: SlotId; n: number; x: number; y: number }[] = [];
    for (const s of world.districts.owned) {
      if (s >= this.mCount.length) continue;
      const r = slotRect(world, s);
      const at = this.mAt[s];
      markets.push({ slot: s, count: this.mCount[s], x: at >= 0 ? at % N : r.x0, y: at >= 0 ? (at / N) | 0 : r.y0 });
      const n = this.kN[s];
      if (n > 0) kites.push({ slot: s, n, x: Math.round(this.kX[s] / n), y: Math.round(this.kY[s] / n) });
    }
    this.markets = markets;
    this.kites = kites;
    this.avenue = this.best;
    this.passes++;
    this.restart(world);
    return true;
  }
}

/** The longest straight run of Avenue tiles on owned land (the parade route), inside `box` when given: its ends, or null. */
export function longestAvenue(world: World, box?: { x0: number; y0: number; x1: number; y1: number }): Avenue | null {
  return new LandSurvey().full(world, box).avenue;
}

export class CityEvents {
  /** Unpaused seconds since this world came in. */
  private sec = 0;
  /** When the next gap opens (unpaused seconds). */
  private nextAt: number = CITY_LIFE.firstAfterSec;
  /** A gap is open: the first eligible happening starts. */
  private armed = false;
  /** Gaps opened so far (arena night takes every third). */
  private gaps = 0;
  /** What the open gap is reserved for (lantern night waits for its month; arena night for its turn), or null. */
  private reserved: CityEventId | null = null;
  private lastId: CityEventId | null = null;
  private lastStart = -Infinity;
  /** Sim year of the last lantern night. */
  private lanternYear = -1;
  private checkIn = 0;
  private worldRef: World | null = null;
  /** The weather layer's current sky (Effects reports it each frame; headless runs stay clear). */
  private sky: CitySky = 0;
  /** Happenings started since the last reset (tests, diagnostics). */
  started = 0;
  /** The banded land survey a gap's checks read (night markets, Kites turf, the parade avenue). */
  readonly survey = new LandSurvey();
  /** The survey finished a pass since the gap's last check. */
  private surveyed = false;
  /** A survey for checks outside a gap (eligible() without one). */
  private adhoc: LandSurvey | null = null;

  constructor(private readonly host: CityEventsHost) {}

  /** The weather layer's sky (art/weather.ts): a storm makes a storm watch eligible. */
  noteSky(sky: CitySky): void {
    this.sky = sky;
  }

  /** Unpaused seconds until the next gap opens (≤ 0 while a gap is open or a happening runs; tests, diagnostics). */
  get nextIn(): number {
    return this.nextAt - this.sec;
  }

  /**
   * Called by Game.update every frame with the frame's dt (s), only while the sim runs (speed > 0), so it freezes
   * while paused and while a story card is open.
   */
  update(dt: number): void {
    const host = this.host;
    const world = host.world;
    if (world !== this.worldRef) this.reset();
    if (host.speed <= 0 || !(dt > 0)) return;
    this.sec += dt;
    const ev = world.cityEvent;
    if (ev) {
      if (!cityLifeOn(host.settings)) {
        this.end(world, ev);
        return;
      }
      ev.until -= dt;
      if (ev.until <= 0) this.end(world, ev);
      return;
    }
    if (!this.armed) {
      if (this.sec < this.nextAt) return;
      this.armed = true;
      this.gaps++;
      this.checkIn = 0;
      this.reserved = this.reserveFor(world);
      this.survey.restart(world);
      this.surveyed = false;
    }
    if (!cityLifeOn(host.settings)) return;
    // A band of the land survey a frame until a pass is ready for the next check.
    if (!this.surveyed && this.survey.step(world)) this.surveyed = true;
    this.checkIn -= dt;
    if (this.checkIn > 0 || !this.surveyed) return;
    this.checkIn = CITY_LIFE_RULES.checkSec;
    this.surveyed = false;
    this.tryStart(world);
  }

  /** Forget the running happening and the clocks (a world swap: New City, load, restore, import, grow). */
  reset(): void {
    const world = this.host.world;
    this.worldRef = world;
    if (world) world.cityEvent = null;
    this.sec = 0;
    this.nextAt = CITY_LIFE.firstAfterSec;
    this.armed = false;
    this.gaps = 0;
    this.reserved = null;
    this.lastId = null;
    this.lastStart = -Infinity;
    this.lanternYear = -1;
    this.checkIn = 0;
    this.started = 0;
    this.surveyed = false;
    if (world) this.survey.restart(world);
  }

  /** The happening a just-opened gap is kept for, or null (the first eligible one starts). */
  private reserveFor(world: World): CityEventId | null {
    if (this.gaps % CITY_LIFE_RULES.arenaEvery === 0 && this.arena(world)) return 'arenanight';
    // Lantern night: once a sim year at most, on every third gap (offset from the Arena's), never twice running.
    if (
      this.gaps % CITY_LIFE_RULES.arenaEvery === 2 &&
      this.lastId !== 'lanterns' &&
      world.stats.population >= CITY_LIFE_RULES.lanternPop &&
      world.year !== this.lanternYear
    )
      return 'lanterns';
    return null;
  }

  private tryStart(world: World): void {
    if (this.sec - this.lastStart < MIN_SPACING) return;
    const r = this.reserved;
    if (r) {
      // A reserved gap waits for its own happening (lantern night: the next month 10; arena night: at once).
      if (r === 'lanterns' && world.year === this.lanternYear) this.reserved = null;
      else if (r === 'arenanight' && !this.arena(world)) this.reserved = null;
      else {
        const p = this.eligible(world, r, this.survey);
        if (p) this.start(world, r, p);
        return;
      }
    }
    // The first eligible happening, rotated by gap so the same one does not always win, and not the last one when
    // another is eligible too. A storm comes and goes: a storm in progress goes first.
    const order: CityEventId[] = ['nightmarket', 'parade', 'kiteday'];
    const k = Math.floor(hash2(this.gaps, 3, world.seed) * order.length);
    const cands: CityEventId[] = ['stormwatch'];
    for (let j = 0; j < order.length; j++) cands.push(order[(k + j) % order.length]);
    let fallback: { id: CityEventId; p: Place } | null = null;
    for (const id of cands) {
      const p = this.eligible(world, id, this.survey);
      if (!p) continue;
      if (id !== this.lastId) {
        this.start(world, id, p);
        return;
      }
      fallback ??= { id, p };
    }
    if (fallback) this.start(world, fallback.id, fallback.p);
  }

  /**
   * Where `id` would run now, or null when its condition does not hold (§6.4.1 "When"). `survey`: a finished land
   * survey of this world to read (a gap's checks); without one the land is read now (tests, diagnostics).
   */
  eligible(world: World, id: CityEventId, survey?: LandSurvey): Place | null {
    const day = this.host.daylight;
    const land = () => (survey?.ready ? survey : (this.adhoc ??= new LandSurvey()).full(world));
    switch (id) {
      case 'nightmarket': {
        if (day >= CITY_LIFE_RULES.nightBelow) return null;
        const m = (land().markets ?? []).filter((s) => s.count >= CITY_LIFE_RULES.marketTiles);
        if (!m.length) return null;
        // The Bazaar first, then the busiest district.
        m.sort((a, b) => Number(world.districts.kinds[b.slot] === 'bazaar') - Number(world.districts.kinds[a.slot] === 'bazaar') || b.count - a.count);
        return { slot: m[0].slot, x: m[0].x, y: m[0].y };
      }
      case 'lanterns': {
        if (world.stats.population < CITY_LIFE_RULES.lanternPop || world.year === this.lanternYear) return null;
        if (world.month !== CITY_LIFE_RULES.lanternMonth) return null;
        const b = world.ownedBox;
        return { x: (b.x0 + b.x1) >> 1, y: (b.y0 + b.y1) >> 1 };
      }
      case 'stormwatch': {
        if (this.sky !== 2) return null;
        const s = this.stormShore(world);
        if (s < 0) return null;
        const r = slotRect(world, s);
        return { slot: s, x: (r.x0 + r.x1) >> 1, y: (r.y0 + r.y1) >> 1 };
      }
      case 'arenanight': {
        const a = this.arena(world);
        if (!a) return null;
        const x = a.x + (a.size >> 1);
        const y = a.y + (a.size >> 1);
        return { slot: world.slotAt(x, y), x, y };
      }
      case 'kiteday': {
        if (day <= CITY_LIFE_RULES.dayAbove) return null;
        if (standing(world, 'kites') < STANDING.friendly) return null;
        let best: Place | null = null;
        let bestN = 0;
        for (const k of land().kites ?? [])
          if (k.n > bestN) {
            bestN = k.n;
            best = { slot: k.slot, x: k.x, y: k.y };
          }
        return bestN >= 8 ? best : null;
      }
      case 'parade': {
        if (world.stats.approval < CITY_LIFE_RULES.paradeApproval) return null;
        const a = land().avenue;
        if (!a || a.len < CITY_LIFE_RULES.paradeRun) return null;
        const x = (a.x0 + a.x1) >> 1;
        const y = (a.y0 + a.y1) >> 1;
        return { slot: world.slotAt(x, y), x, y };
      }
    }
    return null;
  }

  private arena(world: World) {
    for (const b of world.buildings.values()) if (b.type === 'arena' && !(b.buildDays && b.buildDays > 0)) return b;
    return null;
  }

  /**
   * The shore a storm watch raises barriers on: an owned Saltglass Shoals (or the Sunk, owned only after the reveal);
   * Charter Shore only once `ch4.logs` has been shown (STORY.md's foreshadowing, §6.4.1). −1 when none.
   */
  private stormShore(world: World): SlotId {
    const d = world.districts;
    for (const s of d.owned) if (d.kinds[s] === 'shoals') return s;
    for (const s of d.owned) if (d.kinds[s] === 'sunk') return s;
    if (world.story.seen?.['ch4.logs'] !== undefined) for (const s of d.owned) if (d.kinds[s] === 'shore') return s;
    return -1;
  }

  private start(world: World, id: CityEventId, p: Place): void {
    const def = CITY_LIFE_DEFS[id];
    const terms = def.visitors !== 0 || def.approval !== 0 || def.demandCom !== 0 || !!def.noise;
    const ev: CityEventState = {
      id,
      until: def.sec,
      daysLeft: terms ? CITY_LIFE.capDays : 0,
      visitors: def.visitors,
      approval: def.approval,
      demandCom: def.demandCom,
    };
    if (p.slot !== undefined && p.slot >= 0) ev.slot = p.slot;
    world.cityEvent = ev;
    this.armed = false;
    this.reserved = null;
    this.lastId = id;
    this.lastStart = this.sec;
    this.started++;
    if (id === 'lanterns') this.lanternYear = world.year;
    const text = def.line.includes('{district}') ? def.line.replace('{district}', placeName(world, p.x, p.y)) : def.line;
    world.addNews(text, 'info');
    world.events.emit('cityEvent', ev.slot !== undefined ? { id, phase: 'start', slot: ev.slot } : { id, phase: 'start' });
  }

  private end(world: World, ev: CityEventState): void {
    world.cityEvent = null;
    const [g0, g1] = CITY_LIFE.gapSec;
    const gap = g0 + (g1 - g0) * hash2(this.gaps, 5, world.seed);
    this.nextAt = Math.max(this.sec + gap, this.lastStart + MIN_SPACING);
    world.events.emit('cityEvent', ev.slot !== undefined ? { id: ev.id, phase: 'end', slot: ev.slot } : { id: ev.id, phase: 'end' });
  }
}
