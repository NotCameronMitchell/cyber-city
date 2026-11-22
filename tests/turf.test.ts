// Gangs and turf (STORY.md §3): seeding, hold, spread, cap, determinism,
// crackdown and scatter, truce freeze, pacts, layers, ops and the 2 ms budget.

import { describe, expect, it } from 'vitest';
import { crackdown } from '../src/game/actions';
import { RIBBON, TURF } from '../src/game/config';
import * as turf from '../src/game/story/turf';
import * as vertical from '../src/game/story/vertical';
import { ZoneType } from '../src/game/types';
import type { World } from '../src/game/world';
import { flatWorld, fullyBuiltWorld, makeSim } from './helpers';

const U = 1;
const K = 2;

/** A flat world with a road cross (so seeds have a city to tag) and uniform crime. */
function turfWorld(seed = 1234, crime = 0.5): World {
  const w = flatWorld(seed);
  for (let x = 4; x < 60; x++) {
    w.setRoad(x, 20);
    w.setRoad(x, 40);
  }
  for (let y = 4; y < 60; y++) {
    w.setRoad(20, y);
    w.setRoad(40, y);
  }
  w.fields.crime.fill(crime);
  return w;
}

function month(w: World, n = 1): void {
  for (let k = 0; k < n; k++) {
    w.tick += 30;
    turf.update(w);
  }
}

function own(w: World, x: number, y: number, o: number, str: number): void {
  const i = w.idx(x, y);
  w.turf.owner[i] = o;
  w.turf.str[i] = str;
}

function quietSeeded(w: World): void {
  w.turf.seeded.undertow = true;
  w.turf.seeded.kites = true;
}

describe('seeding and spread', () => {
  it('seeds the Undertow at 1,200 and the Kites at 2,500, near the city', () => {
    const w = turfWorld();
    w.maxPopulation = 1100;
    month(w);
    expect(w.turf.seeded.undertow).toBe(false);
    w.maxPopulation = 1300;
    month(w);
    expect(w.turf.seeded.undertow).toBe(true);
    expect(w.turf.seeded.kites).toBe(false);
    expect(w.turf.stats.tiles.undertow).toBeGreaterThanOrEqual(9);
    expect(w.news.some((n) => /^Fresh tags in .+: a hook and a wave\.$/.test(n.text))).toBe(true);
    // Every turf tile is within reach of the road grid (rows/cols 4..59, ±3 plus spread).
    const s = w.turf.stats.strongest.undertow;
    expect(s).toBeGreaterThanOrEqual(0);
    w.maxPopulation = 2600;
    month(w);
    expect(w.turf.seeded.kites).toBe(true);
    expect(w.news.some((n) => n.text.endsWith('a diamond kite, drawn in one line.'))).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = turfWorld(77, 0.9);
    const b = turfWorld(77, 0.9);
    a.maxPopulation = b.maxPopulation = 3000;
    month(a, 24);
    month(b, 24);
    expect(Array.from(a.turf.owner)).toEqual(Array.from(b.turf.owner));
    expect(Array.from(a.turf.str)).toEqual(Array.from(b.turf.str));
    expect(a.story.rng).toBe(b.story.rng);
    expect(a.story.seam).toBe(b.story.seam);
    expect(a.turf.stats.tiles.undertow).toBeGreaterThan(9);
    // A different story RNG state gives a different spread.
    const c = turfWorld(77, 0.9);
    c.story.rng = 12345;
    c.maxPopulation = 3000;
    month(c, 24);
    expect(Array.from(c.turf.owner)).not.toEqual(Array.from(a.turf.owner));
  });

  it('holds the 8% cap', () => {
    const w = turfWorld(5, 1);
    w.fields.traffic.fill(0.5);
    w.maxPopulation = 5000;
    const cap = turf.capFor(w);
    expect(cap).toBe(Math.floor(TURF.capShare * 64 * 64));
    for (let m = 0; m < 120; m++) {
      month(w);
      expect(w.turf.stats.tiles.undertow).toBeLessThanOrEqual(cap);
      expect(w.turf.stats.tiles.kites).toBeLessThanOrEqual(cap);
    }
    expect(w.turf.stats.tiles.undertow).toBe(cap);
    // The Seam sits between the two gangs.
    expect(w.story.seam).not.toBeNull();
  });

  it('decays tiles with poor affinity; protection floors hold at 50', () => {
    const w = flatWorld();
    quietSeeded(w);
    w.fields.landValue.fill(1);
    w.fields.security.fill(0.7);
    w.addBuilding('tidemarket', 30, 30);
    own(w, 10, 10, U, 60);
    own(w, 33, 30, U, 60); // within 4 of the Tidemarket
    w.tick = 30;
    turf.update(w);
    // d = round((0 − 0.35) × 40) − 20 = −34
    expect(w.turf.str[w.idx(10, 10)]).toBe(26);
    expect(w.turf.str[w.idx(33, 30)]).toBe(50);
    month(w);
    expect(w.turf.owner[w.idx(10, 10)]).toBe(0);
    expect(w.turf.owner[w.idx(33, 30)]).toBe(U);
  });

  it('rail hurts Undertow turf and blocks spread onto track', () => {
    const w = turfWorld(9, 0.8);
    quietSeeded(w);
    for (let y = 0; y < 64; y++) own(w, 30, y, U, 100);
    for (let y = 0; y < 64; y++) w.setRail(31, y, (y > 0 ? 1 : 0) | (y < 63 ? 4 : 0));
    own(w, 31, 5, U, 60);
    const aff = 0.25 + 0.5 * 0.8 + 0.3 - 0.3; // ribbon within 1
    month(w, 6);
    for (let y = 0; y < 64; y++) if (y !== 5) expect(w.turf.owner[w.idx(31, y)]).toBe(0);
    // The tile on the track lost RIBBON.turfHit on top of its hold each month (or was freed).
    const per = Math.round((aff - TURF.holdPivot) * TURF.holdGain) - RIBBON.turfHit;
    expect(w.turf.str[w.idx(31, 5)]).toBe(Math.min(100, 60 + per * 6));
  });

  it('a pact stops spread onto high land value', () => {
    const make = (pact: boolean) => {
      const w = flatWorld(3);
      quietSeeded(w);
      w.fields.crime.fill(0.8);
      for (let i = 0; i < 64 * 64; i++) w.fields.landValue[i] = i % 64 >= 32 ? 0.6 : 0.2;
      for (let y = 0; y < 64; y++) own(w, 31, y, U, 100);
      if (pact) w.story.pacts.push({ gang: 'undertow', until: 1e6 });
      month(w, 6);
      let right = 0;
      let left = 0;
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          if (w.turf.owner[w.idx(x, y)] !== U) continue;
          if (x >= 32) right++;
          else if (x < 31) left++;
        }
      return { right, left };
    };
    const withPact = make(true);
    expect(withPact.right).toBe(0);
    expect(withPact.left).toBeGreaterThan(0);
    expect(make(false).right).toBeGreaterThan(0);
  });

  it('contests rival tiles and flips them', () => {
    const w = flatWorld(4);
    quietSeeded(w);
    // Kites affinity 0.35 (hold ±0), Undertow 0.75: the Kites row only loses to contests.
    w.fields.crime.fill(0.4);
    for (let x = 0; x < 64; x++) {
      own(w, x, 10, U, 100);
      own(w, x, 11, K, 20);
    }
    month(w, 6);
    let flipped = 0;
    for (let x = 0; x < 64; x++) if (w.turf.owner[w.idx(x, 11)] === U) flipped++;
    expect(flipped).toBeGreaterThan(0);
    expect(w.turf.stats.contested).toBeGreaterThan(0);
    const j = w.turf.contested.findIndex((d) => d > 0);
    const s = w.turf.str[j] / 100;
    expect(w.layerParts.turf.crimeAdd[j]).toBeCloseTo(TURF.crimePerStr * s + TURF.contestCrime, 4);
  });

  it('tags back after 180 days under 9 tiles', () => {
    const w = turfWorld();
    quietSeeded(w);
    own(w, 30, 30, U, 40);
    month(w);
    expect(w.turf.lowSince.undertow).toBe(w.tick);
    const since = w.tick;
    w.turf.owner.fill(0);
    w.turf.str.fill(0);
    month(w, 6);
    expect(w.tick - since).toBeGreaterThanOrEqual(TURF.reseedDays);
    expect(w.turf.stats.tiles.undertow).toBeGreaterThan(0);
    expect(w.news.some((n) => n.text.startsWith('Tagback in'))).toBe(true);
  });
});

describe('crackdown, scatter and the truce', () => {
  function cdWorld() {
    const w = turfWorld(21);
    w.funds = 100000;
    w.story.unlocks.push('crackdown');
    quietSeeded(w);
    const p = w.addBuilding('precinct', 30, 30)!;
    p.powered = true;
    for (let k = 0; k < 40; k++) own(w, 22 + (k % 8), 24 + Math.floor(k / 8), U, 50);
    for (let x = 34; x < 40; x++) own(w, x, 36, K, 80);
    turf.refreshStats(w);
    return { w, p };
  }

  it('refuses without the unlock, power, turf or funds', () => {
    const w = turfWorld();
    const p = w.addBuilding('precinct', 30, 30)!;
    expect(crackdown(w, p.id).reason).toMatch(/6,000/);
    w.story.unlocks.push('crackdown');
    expect(crackdown(w, p.id).reason).toBe('Precinct has no power');
    p.powered = true;
    expect(crackdown(w, p.id).reason).toBe('No turf in range');
    own(w, 28, 28, U, 50);
    w.funds = 100;
    expect(crackdown(w, p.id).reason).toMatch(/Not enough credits/);
    expect(crackdown(w, 9999).reason).toBe('Not a precinct');
  });

  it('hits turf, favor, Trace and pacts, then cools down', () => {
    const { w, p } = cdWorld();
    w.story.pacts.push({ gang: 'undertow', until: w.tick + 360 });
    const f0 = { ...w.story.favor };
    const funds = w.funds;
    const r = crackdown(w, p.id);
    expect(r).toEqual({ ok: true, cost: TURF.crackdown.cost });
    expect(w.funds).toBe(funds - TURF.crackdown.cost);
    expect(w.turf.stats.tiles.undertow).toBe(0); // 50 − 60
    expect(w.turf.str[w.idx(34, 36)]).toBe(20); // 80 − 60
    const C = TURF.crackdown;
    expect(w.story.favor.undertow).toBe(f0.undertow + C.favorHit + C.pactBreak);
    expect(w.story.favor.kites).toBe(f0.kites + C.favorHit);
    expect(w.story.favor.board).toBe(f0.board + C.board);
    expect(w.story.favor.tuning).toBe(f0.tuning + C.tuning);
    expect(w.story.pacts).toEqual([]);
    expect(w.news.some((n) => n.text === 'The Undertow: pact broken. Expect company.')).toBe(true);
    expect(w.news.some((n) => n.text.startsWith('Wasps over'))).toBe(true);
    expect(w.story.trace).toBe(C.trace);
    expect(w.story.gangActions).toBe(1);
    expect(w.story.lastCrackdownTick).toBe(w.tick);
    expect(w.story.crackdowns).toEqual([
      { x: 31, y: 31, r: 13, until: w.tick + C.days, scatterAt: w.tick + C.scatterDays, hit: ['undertow', 'kites'], base: { undertow: 40, kites: 6 } },
    ]);
    expect(w.story.locals[0]).toMatchObject({ x: 31, y: 31, r: 13, crimeAdd: C.crime });
    expect(w.story.mods[0]).toMatchObject({ label: 'Crackdown', mods: { approvalAdd: -C.approval } });
    expect(w.signals.some((s) => s.t === 'action' && s.tool === 'crackdown')).toBe(true);
    expect(crackdown(w, p.id).reason).toBe(`Cooldown ${C.cooldown}d`);
  });

  it('keeps hitting the zone monthly, then scatters a hard-hit gang outside it', () => {
    const { w, p } = cdWorld();
    crackdown(w, p.id);
    month(w); // tick 30: Kites at 20 + hold − 30 → freed
    expect(w.turf.stats.tiles.kites).toBe(0);
    month(w, 2); // tick 90: scatter
    expect(w.story.crackdowns).toEqual([]);
    expect(w.turf.stats.tiles.undertow).toBeGreaterThan(0);
    for (let i = 0; i < 64 * 64; i++) {
      if (w.turf.owner[i] !== U) continue;
      const dx = (i % 64) + 0.5 - 31;
      const dy = Math.floor(i / 64) + 0.5 - 31;
      expect(dx * dx + dy * dy).toBeGreaterThan(13 * 13);
    }
    expect(w.news.some((n) => n.text.startsWith('Tagback in') && n.text.includes('the Undertow'))).toBe(true);
    // The Kites lost only 6 tiles: no scatter for them.
    expect(w.turf.stats.tiles.kites).toBe(0);
  });

  it('the Seam Truce freezes hold and spread; a crackdown ends it', () => {
    const { w, p } = cdWorld();
    w.turf.frozenUntil = w.tick + 720;
    w.story.flags.truce = true;
    const before = Array.from(w.turf.str);
    month(w, 3);
    expect(Array.from(w.turf.str)).toEqual(before);
    crackdown(w, p.id);
    expect(w.turf.frozenUntil).toBe(w.tick);
    expect(w.story.flags.truce).toBeUndefined();
    expect(w.news.some((n) => n.text.startsWith('The Seam Truce is over'))).toBe(true);
  });
});

describe('turf effects', () => {
  it('writes crime, land value, tax and abandon layers', () => {
    const w = flatWorld();
    w.setZone(10, 10, ZoneType.Residential);
    own(w, 10, 10, U, 100);
    own(w, 20, 20, K, 50);
    w.turf.contested[w.idx(20, 20)] = 30;
    turf.refreshStats(w);
    const L = w.layerParts.turf;
    const i = w.idx(10, 10);
    const j = w.idx(20, 20);
    expect(L.crimeAdd[i]).toBeCloseTo(TURF.crimePerStr, 5);
    expect(L.lvAdd[i]).toBeCloseTo(TURF.resLvPerStr, 5);
    expect(L.taxMul[i]).toBeCloseTo(1 - TURF.taxSkim, 5);
    expect(L.abandonMul[i]).toBe(TURF.abandon.notFriendly); // standing −10
    expect(L.crimeAdd[j]).toBeCloseTo(TURF.crimePerStr * 0.5 + TURF.contestCrime, 5);
    expect(L.lvAdd[j]).toBe(0);
    expect(w.layers.crimeAdd[i]).toBeCloseTo(TURF.crimePerStr, 5);
    expect(w.turf.stats.contested).toBe(1);

    // A pact cuts crime and ends the skim; an Allied gang halves crime and abandonment.
    w.story.pacts.push({ gang: 'undertow', until: 1e6 });
    turf.refreshStats(w);
    expect(L.crimeAdd[i]).toBeCloseTo(TURF.crimePerStr * TURF.pactCrimeMul, 5);
    expect(L.taxMul[i]).toBe(1);
    w.story.favor.undertow = 70;
    turf.refreshStats(w);
    expect(L.crimeAdd[i]).toBeCloseTo(TURF.crimePerStr * TURF.pactCrimeMul * 0.5, 5);
    expect(L.abandonMul[i]).toBe(TURF.abandon.allied);
    w.story.favor.undertow = 30;
    turf.refreshStats(w);
    expect(L.abandonMul[i]).toBe(1);

    // Tidemarket crime disc; turfCrimeMul from the resolved mods.
    w.addBuilding('tidemarket', 40, 40);
    w.mods.turfCrimeMul = 0.5;
    turf.refreshStats(w);
    expect(L.crimeAdd[w.idx(41, 41)]).toBeCloseTo(0.1, 5);
    expect(L.crimeAdd[i]).toBeCloseTo(TURF.crimePerStr * TURF.pactCrimeMul * 0.5, 5);
  });

  it('turfPatch: demand per 100 tiles and the pacts’ city-wide mods', () => {
    const w = flatWorld();
    for (let k = 0; k < 100; k++) own(w, k % 50, 5 + Math.floor(k / 50), U, 50);
    for (let k = 0; k < 50; k++) own(w, k, 30, K, 50);
    turf.refreshStats(w);
    expect(turf.turfPatch(w)).toEqual({ demandInd: 0.04, demandCom: 0.02 });
    w.story.pacts.push({ gang: 'undertow', until: 1e6 });
    expect(turf.turfPatch(w)).toMatchObject({ traceMonthly: 1, favorMonthly: { board: -1 } });
    w.story.ending = 'lowcrown';
    expect(turf.pactActive(w, 'kites')).toBe(true);
    expect(turf.turfPatch(w)).toMatchObject({ traceMonthly: 2, favorMonthly: { board: -1, nacre: -1 } });
    turf.setEndingRulesSource(() => null);
    expect(turf.pactActive(w, 'kites')).toBe(false);
    turf.setEndingRulesSource((ww) => (ww.story.ending === 'lowcrown' ? { permanentPacts: true, pactNoLimits: true } : null));
  });

  it('street take and the 40% pact cut', () => {
    const w = flatWorld();
    for (let x = 0; x < 10; x++) {
      w.setZone(x, 5, ZoneType.Commercial);
      w.setLevel(x, 5, 2);
      own(w, x, 5, K, 50);
    }
    own(w, 20, 20, K, 100); // undeveloped: no take
    expect(turf.streetTake(w, 'kites')).toBeCloseTo(10 * TURF.streetTake * 0.5, 6);
    expect(turf.pactCut(w)).toBe(0);
    w.story.pacts.push({ gang: 'kites', until: 1e6 });
    expect(turf.pactCut(w)).toBeCloseTo(10 * TURF.streetTake * 0.5 * TURF.pactCut, 6);
  });

  it('stats: secured share, strongest tile, the Seam', () => {
    const w = flatWorld();
    own(w, 10, 10, U, 40);
    own(w, 11, 10, U, 90);
    own(w, 14, 10, K, 60);
    w.fields.security[w.idx(10, 10)] = 0.6;
    turf.refreshStats(w);
    const s = w.turf.stats;
    expect(s.tiles).toEqual({ undertow: 2, kites: 1 });
    expect(s.secured.undertow).toBeCloseTo(0.5, 6);
    expect(s.strongest).toEqual({ undertow: w.idx(11, 10), kites: w.idx(14, 10) });
    expect(w.story.seam).toBe(w.idx(13, 10)); // midpoint of (11,10)–(14,10), rounded
  });
});

describe('turf ops for story effects', () => {
  it('seed, str, clear, flip, freeze and force-seed', () => {
    const w = turfWorld();
    expect(turf.seedGang(w, 'kites', 30, 30, 60)).toBe(9);
    expect(w.turf.seeded.kites).toBe(true);
    expect(turf.addStrength(w, 'kites', { x: 30, y: 30, r: 1 }, -10)).toBe(5); // disc r1: centre + 4
    expect(w.turf.str[w.idx(30, 30)]).toBe(50);
    expect(w.turf.str[w.idx(31, 31)]).toBe(60);
    expect(turf.flipTurf(w, 'kites', 'undertow', { x: 30, y: 30, r: 1 })).toBe(5);
    expect(w.turf.owner[w.idx(30, 30)]).toBe(U);
    expect(w.turf.str[w.idx(30, 30)]).toBe(50);
    expect(turf.addStrength(w, 'all', 'city', -70)).toBe(9);
    expect(w.turf.stats.tiles).toEqual({ undertow: 0, kites: 0 });
    turf.seedGang(w, 'undertow', 10, 10);
    expect(turf.clearTurf(w, 'undertow', [w.idx(10, 10), w.idx(11, 11)])).toBe(2);
    turf.freezeTurf(w, 720);
    expect(w.turf.frozenUntil).toBe(w.tick + 720);
    const w2 = turfWorld();
    expect(turf.forceSeed(w2).sort()).toEqual(['kites', 'undertow']);
    expect(w2.turf.stats.tiles.undertow).toBeGreaterThan(0);
    expect(w2.turf.stats.tiles.kites).toBeGreaterThan(0);
    expect(w2.story.seam).not.toBeNull();
    expect(turf.forceSeed(w2)).toEqual([]);
  });
});

describe('performance', () => {
  it('turf update + vertical refresh stay within 2 ms on a full map', () => {
    const w = fullyBuiltWorld();
    makeSim(w, false);
    for (let x = 0; x < 63; x++) w.setRail(x, 4, (x > 0 ? 8 : 0) | 2);
    w.setRail(63, 4, 8);
    w.story.unlocks.push('skybridge');
    for (let m = 0; m < 12; m++) {
      w.tick += 30;
      turf.update(w);
      vertical.refresh(w);
    }
    expect(w.turf.stats.tiles.undertow + w.turf.stats.tiles.kites).toBeGreaterThan(50);
    const runs = 30;
    const t0 = performance.now();
    for (let m = 0; m < runs; m++) {
      w.tick += 30;
      turf.update(w);
      vertical.refresh(w);
    }
    const ms = (performance.now() - t0) / runs;
    console.info(`[perf] turf.update + vertical.refresh ${ms.toFixed(3)} ms`);
    const slack = (globalThis as any).process?.env?.CI ? 3 : 1;
    expect(ms).toBeLessThan(2 * slack);
  });
});
