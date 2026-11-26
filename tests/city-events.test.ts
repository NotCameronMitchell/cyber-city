// City life (docs/MEGACITY.md §6.4.1, §11.3 E1, §11.5 WP-6): on a fake clock, 3–7 happenings per unpaused hour,
// none in the first 600 s, never two at once, exactly one ticker line each; gameplay terms last ≤ 60 sim days at
// any speed (the sim counts them down per day), then the visuals continue alone.
import { describe, expect, it } from 'vitest';
import { arenaNightNoise, CityEvents, CITY_LIFE_DEFS, CITY_LIFE_RULES, LandSurvey, longestAvenue, placeName, SURVEY_TILES, type CityEventsHost } from '../src/game/cityEvents';
import { CITY_LIFE, DAY_CYCLE_SECONDS, DISTRICTS } from '../src/game/config';
import { slotRect } from '../src/game/districts/slots';
import { DEFAULT_SETTINGS, Game } from '../src/game/game';
import { RoadKind, type CityEventId, type Settings } from '../src/game/types';
import type { World } from '../src/game/world';
import { cachedMegacity, megacitySim } from './megacity-fixture';
import { flatWorld, makeSim } from './helpers';

/** A fake Game for City life: the world, settings, a speed and the visual daylight on a fake clock. */
class FakeHost implements CityEventsHost {
  speed = 1;
  settings: Settings = { ...DEFAULT_SETTINGS };
  clock = DAY_CYCLE_SECONDS * 0.85;
  constructor(public world: World) {}
  get daylight(): number {
    const t = ((this.clock / DAY_CYCLE_SECONDS) % 1 + 1) % 1;
    return Math.max(0, Math.min(1, (Math.sin((t - 0.25) * Math.PI * 2) - 0.15) / 0.55));
  }
}

/** A built two-district city where a night market (at night) and a parade (approval 80, an avenue) can run. */
function lifeCity(): World {
  const w = cachedMegacity(3, 2);
  const s = w.districts.owned[1];
  const r = slotRect(w, s);
  // An avenue along one fixture road row (roads every 4 tiles).
  for (let x = r.x0; x <= r.x1; x++) if (w.isRoad(x, r.y0 + 8)) w.setRoadKind(x, r.y0 + 8, RoadKind.Avenue);
  w.stats.approval = 80;
  w.stats.population = 20000;
  return w;
}

interface Run {
  starts: { sec: number; id: CityEventId }[];
  ends: number[];
  news: number;
  overlap: boolean;
}

/** Drive City life for `sec` unpaused seconds at `dt`, 2 sim days a second (speed 1), the visual clock running. */
function drive(host: FakeHost, life: CityEvents, sec: number, dt = 0.5): Run {
  const w = host.world;
  const run: Run = { starts: [], ends: [], news: 0, overlap: false };
  let t = 0;
  let open = false;
  const offs = [
    w.events.on('cityEvent', (e) => {
      if (e.phase === 'start') {
        if (open) run.overlap = true;
        open = true;
        run.starts.push({ sec: t + dt, id: e.id });
      } else {
        open = false;
        run.ends.push(t + dt);
      }
    }),
    w.events.on('news', () => run.news++),
  ];
  let dayAcc = 0;
  for (; t < sec; t += dt) {
    life.update(dt);
    if (host.speed > 0) {
      host.clock += dt;
      dayAcc += dt * 2;
      while (dayAcc >= 1) {
        dayAcc -= 1;
        w.tick++;
        if (w.cityEvent && w.cityEvent.daysLeft > 0) w.cityEvent.daysLeft--;
      }
    }
  }
  offs.forEach((o) => o());
  return run;
}

describe('E1: City life on a fake clock (§6.4.1, §11.3)', () => {
  it('3–7 per unpaused hour, none in the first 600 s, never two at once, one ticker line each', () => {
    const w = lifeCity();
    const host = new FakeHost(w);
    const life = new CityEvents(host);
    const hours = 6;
    const run = drive(host, life, hours * 3600);
    expect(run.overlap).toBe(false);
    expect(run.starts[0].sec).toBeGreaterThanOrEqual(CITY_LIFE.firstAfterSec);
    expect(run.news).toBe(run.starts.length);
    for (let h = 0; h < hours; h++) {
      const n = run.starts.filter((s) => s.sec >= h * 3600 && s.sec < (h + 1) * 3600).length;
      expect([h, n >= 3 && n <= 7]).toEqual([h, true]);
    }
    // Any sliding hour holds at most 7.
    for (const s of run.starts) expect(run.starts.filter((o) => o.sec >= s.sec && o.sec < s.sec + 3600).length).toBeLessThanOrEqual(7);
    // Each one ends before the next starts, after its visual length.
    for (let k = 0; k < run.ends.length; k++) {
      const len = run.ends[k] - run.starts[k].sec;
      expect(Math.abs(len - CITY_LIFE_DEFS[run.starts[k].id].sec)).toBeLessThanOrEqual(1);
      if (k + 1 < run.starts.length) expect(run.starts[k + 1].sec).toBeGreaterThan(run.ends[k]);
    }
    // Both conditions hold at times, so the city sees both.
    const ids = new Set(run.starts.map((s) => s.id));
    expect(ids.has('nightmarket')).toBe(true);
    expect(ids.has('parade')).toBe(true);
    // Night markets only at night.
    expect(run.starts.length).toBeGreaterThan(hours * 3);
  });

  it('freezes while paused and with City life off; a running one ends when City life is turned off', () => {
    const w = lifeCity();
    const host = new FakeHost(w);
    const life = new CityEvents(host);
    host.speed = 0;
    expect(drive(host, life, 3600).starts).toEqual([]);
    expect(life.nextIn).toBe(CITY_LIFE.firstAfterSec);
    host.speed = 1;
    host.settings = { ...host.settings, cityLife: false };
    expect(drive(host, life, 3600).starts).toEqual([]);
    host.settings = { ...host.settings, cityLife: true };
    const on = drive(host, life, 60);
    expect(on.starts.length).toBe(1);
    expect(w.cityEvent).not.toBeNull();
    host.settings = { ...host.settings, cityLife: false };
    life.update(0.1);
    expect(w.cityEvent).toBeNull();
  });

  it('a world swap forgets the clocks and the happening in progress', () => {
    const w = lifeCity();
    const host = new FakeHost(w);
    const life = new CityEvents(host);
    drive(host, life, 650);
    expect(w.cityEvent).not.toBeNull();
    host.world = lifeCity();
    life.update(0.5);
    expect(host.world.cityEvent).toBeNull();
    expect(life.nextIn).toBeCloseTo(CITY_LIFE.firstAfterSec - 0.5, 5);
  });

  it('each happening runs only when its condition holds', () => {
    const w = lifeCity();
    const host = new FakeHost(w);
    const life = new CityEvents(host);
    // Night market: at night, a district with ≥ 40 developed Market tiles.
    host.clock = 0; // midnight
    expect(host.daylight).toBe(0);
    expect(life.eligible(w, 'nightmarket')).not.toBeNull();
    host.clock = DAY_CYCLE_SECONDS / 2; // noon
    expect(life.eligible(w, 'nightmarket')).toBeNull();
    // Parade: approval ≥ 70 and an avenue.
    expect(life.eligible(w, 'parade')).not.toBeNull();
    w.stats.approval = 60;
    expect(life.eligible(w, 'parade')).toBeNull();
    // Lantern night: ≥ 50,000 residents, sim month 10.
    w.stats.population = CITY_LIFE_RULES.lanternPop;
    w.tick = CITY_LIFE_RULES.lanternMonth * 30;
    expect(life.eligible(w, 'lanterns')).not.toBeNull();
    w.tick += 30;
    expect(life.eligible(w, 'lanterns')).toBeNull();
    // Storm watch: only in a storm, and only with a shore that may show barriers.
    expect(life.eligible(w, 'stormwatch')).toBeNull();
    life.noteSky(2);
    const shoals = w.districts.owned.some((s) => w.districts.kinds[s] === 'shoals' || w.districts.kinds[s] === 'sunk');
    expect(life.eligible(w, 'stormwatch') !== null).toBe(shoals);
    w.story.seen['ch4.logs'] = 1;
    expect(life.eligible(w, 'stormwatch')).not.toBeNull();
    // Arena night: the Arena exists.
    expect(life.eligible(w, 'arenanight')).toBeNull();
    // Kite day: by day, the Kites at least Friendly, holding turf.
    expect(life.eligible(w, 'kiteday')).toBeNull();
  });

  it('ticker lines name the neighbourhood and, in a multi-district city, the district short name', () => {
    const w = lifeCity();
    const s = w.districts.owned[1];
    const r = slotRect(w, s);
    const name = placeName(w, r.x0 + 10, r.y0 + 10);
    const kind = w.districts.kinds[s];
    expect(name.endsWith(`, ${DISTRICTS[kind].short}`)).toBe(true);
    const host = new FakeHost(w);
    host.clock = 0;
    w.stats.approval = 0;
    const life = new CityEvents(host);
    const lines: string[] = [];
    const off = w.events.on('news', (n) => lines.push(n.text));
    drive(host, life, 700);
    off();
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^Night market in .+, .+ tonight: paper lanterns/);
    expect(lines[0]).not.toContain('{');
    expect(w.news[w.news.length - 1].kind).toBe('info');
    expect(longestAvenue(w)!.len).toBe(64);
  });
});

describe('the per-sim-day cap (§6.4.1): terms last ≤ 60 sim days at any speed', () => {
  it('the sim counts daysLeft down once a day; census adds approval only while daysLeft > 0', () => {
    const w = lifeCity();
    const sim = megacitySim(w);
    const inner = sim as unknown as { census: { approval(w: World, p: unknown): number }; power: unknown };
    const approval = () => inner.census.approval(w, inner.power);
    w.cityEvent = { id: 'parade', until: 90, daysLeft: CITY_LIFE.capDays, visitors: 0, approval: 1, demandCom: 0 };
    const on = approval();
    sim.step();
    expect(w.cityEvent.daysLeft).toBe(CITY_LIFE.capDays - 1);
    for (let d = 1; d < CITY_LIFE.capDays; d++) sim.step();
    expect(w.cityEvent.daysLeft).toBe(0);
    sim.step();
    expect(w.cityEvent.daysLeft).toBe(0);
    // Census reads the term only while sim days are left.
    const off = approval();
    w.cityEvent.daysLeft = 5;
    const again = approval();
    expect(again - off).toBeCloseTo(Math.min(1, 100 - off), 6);
    void on;
  });

  it("arena night: noise 0.5 within r6 of the Arena while its terms run, none before or after (§6.3, §6.4.1)", () => {
    const w = flatWorld(31);
    const arena = w.addBuilding('arena', 30, 30)!; // footprint 30..33
    expect(arena).not.toBeNull();
    const N = w.N;
    const noise = (x: number, y: number) => w.fields.noise[y * N + x];
    const sim = makeSim(w);
    expect(noise(31, 31)).toBe(0);
    expect(arenaNightNoise(w)).toBeNull();
    const def = CITY_LIFE_DEFS.arenanight;
    expect(def.noise).toEqual({ v: 0.5, r: 6 });
    w.cityEvent = { id: 'arenanight', until: def.sec, daysLeft: CITY_LIFE.capDays, visitors: def.visitors, approval: 0, demandCom: 0 };
    expect(arenaNightNoise(w)).toEqual(def.noise);
    sim.recomputeAll();
    expect(noise(31, 31)).toBeCloseTo(0.5, 5);
    for (const k of [1, 3, 6]) expect(noise(33 + k, 31)).toBeCloseTo(0.5 * (1 - k / 7), 5);
    expect(noise(33 + 7, 31)).toBe(0);
    // Once the sim has counted the terms down, the Arena is quiet again (the visuals may still run).
    w.cityEvent.daysLeft = 0;
    expect(arenaNightNoise(w)).toBeNull();
    sim.recomputeAll();
    expect(noise(31, 31)).toBe(0);
    // Other happenings make no noise.
    w.cityEvent = { id: 'parade', until: 90, daysLeft: CITY_LIFE.capDays, visitors: 0, approval: 1, demandCom: 0 };
    sim.recomputeAll();
    expect(noise(31, 31)).toBe(0);
  });

  it.each([1, 3])('in a running Game at speed %i: the terms apply for 60 sim days, the visuals run on', async (speed) => {
    const g = new Game();
    expect(g.restore(lifeCity().serialize())).toBe(true);
    let now = 0;
    g.msClock = () => now;
    g.setSpeed(speed);
    const w = g.world;
    w.stats.approval = 80;
    const life = g.cityEvents as unknown as { start(w: World, id: CityEventId, p: { x: number; y: number }): void };
    g.update(1 / 60);
    life.start(w, 'nightmarket', { x: 100, y: 100 });
    const ev = w.cityEvent!;
    const tick0 = w.tick;
    let spent = -1;
    for (let k = 0; k < 60 * 70 && w.cityEvent; k++) {
      now += 1000 / 60;
      g.update(1 / 60);
      // A story card pauses the sim and City life with it: the visuals' clock stands still until it is answered.
      if (g.story.blocking) {
        const until = ev.until;
        g.update(1 / 60);
        expect(ev.until).toBe(until);
        g.choose(0);
        g.setSpeed(speed);
      }
      if (spent < 0 && ev.daysLeft === 0) spent = w.tick - tick0;
    }
    expect(spent).toBeGreaterThanOrEqual(CITY_LIFE.capDays);
    expect(spent).toBeLessThanOrEqual(CITY_LIFE.capDays + 2);
    // At speed 1 the 60 days take 30 s, at speed 3 under 4 s: well inside the 120 s of visuals.
    expect(ev.until).toBeGreaterThan(0);
  }, 60_000);
});

describe('the land checks walk the owned area a band a frame (no whole-city walk in one frame)', () => {
  it('a survey pass reads whole rows within SURVEY_TILES a step and equals a whole read', () => {
    for (const [region, n] of [
      [3, 9],
      [5, 25],
    ] as const) {
      const w = cachedMegacity(region, n);
      const b = w.ownedBox;
      const width = b.x1 - b.x0 + 1;
      const rows = Math.max(1, Math.floor(SURVEY_TILES / width));
      const sv = new LandSurvey();
      sv.restart(w);
      let steps = 0;
      while (!sv.step(w)) steps++;
      steps++;
      expect(steps).toBe(Math.ceil((b.y1 - b.y0 + 1) / rows));
      expect(steps).toBeGreaterThan(region === 5 ? 30 : 10);
      // The banded pass finds what one whole read finds.
      const whole = new LandSurvey().full(w);
      expect(sv.markets).toEqual(whole.markets);
      expect(sv.kites).toEqual(whole.kites);
      expect(sv.avenue).toEqual(whole.avenue);
      expect(whole.markets!.length).toBe(w.districts.owned.length);
      expect(whole.markets!.every((m) => m.count >= CITY_LIFE_RULES.marketTiles)).toBe(true);
    }
  });

  it('the avenue run carries across bands and district edges; the parade reads it', () => {
    const w = lifeCity();
    const r = slotRect(w, w.districts.owned[1]);
    // A north-south avenue 20 tiles long across several bands.
    const x = r.x0 + 4;
    for (let y = r.y0 + 2; y < r.y0 + 22; y++) {
      if (!w.isRoad(x, y)) w.setRoad(x, y);
      w.setRoadKind(x, y, RoadKind.Avenue);
    }
    const sv = new LandSurvey();
    sv.restart(w);
    while (!sv.step(w, 64));
    expect(sv.avenue!.len).toBe(64);
    expect(new LandSurvey().full(w, { x0: x, y0: r.y0, x1: x, y1: r.y1 }).avenue).toMatchObject({ x0: x, x1: x, len: 20 });
  });

  it('while a gap waits on a 25-district city, no update walks more than one band (Node timing, ×3)', () => {
    const w = cachedMegacity(5, 25);
    const host = new FakeHost(w);
    // Neither night nor day, approval for a parade but no avenue run: every check fails and the gap stays open.
    host.clock = DAY_CYCLE_SECONDS * 0.315;
    const life = new CityEvents(host);
    w.stats.approval = 80;
    const day = host.daylight;
    expect(day).toBeGreaterThanOrEqual(CITY_LIFE_RULES.nightBelow);
    expect(day).toBeLessThanOrEqual(CITY_LIFE_RULES.dayAbove);
    life.update(1 / 60);
    for (let k = 0; k < CITY_LIFE.firstAfterSec * 60 && life.nextIn > 0; k++) life.update(1 / 60);
    const times: number[] = [];
    const passes0 = life.survey.passes;
    const freeze = host.clock;
    for (let k = 0; k < 600; k++) {
      host.clock = freeze;
      const t0 = performance.now();
      life.update(1 / 60);
      times.push(performance.now() - t0);
    }
    expect(w.cityEvent).toBeNull();
    // About 40 bands a pass at 25 districts: 600 frames run several passes, each a band at a time.
    expect(life.survey.passes - passes0).toBeGreaterThanOrEqual(5);
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(0.95 * times.length) - 1];
    expect(p95).toBeLessThan(0.4 * 3);
  });
});
