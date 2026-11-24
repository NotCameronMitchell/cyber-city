// The districts contract (docs/MEGACITY.md §3.1, §3.2, §3.6, §6.1, §11.2 items 2, 6–12).

import { describe, expect, it } from 'vitest';
import './canvas-mock';
import { applyAction } from '../src/game/actions';
import { DISTRICTS, MILESTONES, milestonesFor, REGION } from '../src/game/config';
import { assignKinds, REGION5_QUOTA, seedLayout } from '../src/game/districts/layout';
import { NOT_SPATIAL_FIELDS, TILE_INDEX_FIELDS, TILE_XY_FIELDS, encodeBlock } from '../src/game/districts/migrate';
import { adjacentLocked, ringKey, ringOf, slotAtRingKey, slotNeighbours, slotRect } from '../src/game/districts/slots';
import { KIND_WATER, startParams } from '../src/game/districts/terrain';
import { Game } from '../src/game/game';
import { Rng } from '../src/game/rng';
import { Simulation } from '../src/game/sim';
import { Advisor } from '../src/game/sim/advisor';
import { newStoryState } from '../src/game/story/state';
import { applySurge, findSpot } from '../src/game/story/effects';
import * as turf from '../src/game/story/turf';
import { BUILDING_ORDER } from '../src/game/config';
import { DISTRICT_KINDS, Ground, LEGACY_REGION, MAX_MAP_SIZE, RoadKind, SLOT, Terrain, ZoneType, startSlot, type Region, type SaveData } from '../src/game/types';
import { World } from '../src/game/world';
import { KIT_BASE, SERVICE_KIT_BASE, serviceModelId, serviceSeed } from '../src/render/buildings';
import { SKY_BASE } from '../src/render/art/skyway';

const REGIONS: Region[] = [3, 5];

describe('slots (§3.1, §3.2)', () => {
  it.each(REGIONS)('%i×%i: the start slot is the centre; ringKey is the same place on both regions', (R) => {
    expect(startSlot(R)).toBe(R === 3 ? 4 : 12);
    expect(ringKey(R, startSlot(R))).toBe(12);
    for (let s = 0; s < R * R; s++) {
      expect(slotAtRingKey(R, ringKey(R, s))).toBe(s);
      expect(slotNeighbours(R, s).length).toBeGreaterThanOrEqual(2);
    }
    const w = new World(1, 'Slots', undefined, R);
    expect(w.segCount).toBe(SLOT * 2);
    expect(w.ownedBox).toEqual(slotRect(w, startSlot(R)));
    expect(adjacentLocked(w)).toEqual(slotNeighbours(R, startSlot(R)).sort((a, b) => a - b));
    // Owned slots side by side in a row merge into one segment.
    w.annex(startSlot(R) + 1);
    expect(w.segCount).toBe(SLOT * 2);
    expect(w.segs[1] - w.segs[0]).toBe(2 * SLOT);
    w.annex(startSlot(R) + R);
    expect(w.segCount).toBe(SLOT * 4);
    let n = 0;
    for (let s = 0; s < w.segCount; s += 2) for (let i = w.segs[s]; i < w.segs[s + 1]; i++, n++) expect(w.ownedAt(i)).toBe(true);
    expect(n).toBe(3 * SLOT * SLOT);
  });
});

describe('StoryState fields are classified (§11.2 item 2)', () => {
  /** Every numeric leaf of a populated StoryState, as `a.b`, `list[].f` and `record.*` paths. */
  function numericPaths(v: unknown, path: string, out: Set<string>, recordKeys: Set<string>): void {
    if (typeof v === 'number') out.add(path);
    else if (Array.isArray(v)) for (const e of v) numericPaths(e, `${path}[]`, out, recordKeys);
    else if (v && typeof v === 'object')
      for (const [k, e] of Object.entries(v)) {
        const rec = recordKeys.has(path);
        numericPaths(e, path ? `${path}.${rec ? '*' : k}` : k, out, recordKeys);
      }
  }
  it('every numeric field is a tile index, a coordinate or "not spatial"', () => {
    const st = newStoryState(7) as unknown as Record<string, unknown>;
    Object.assign(st, {
      seam: 5,
      pending: { card: 'c', tick: 1, spot: 2 },
      open: { card: 'c', spot: 3 },
      waiting: { card: 'c', tick: 1, spot: 4 },
      queue: [{ card: 'c', tick: 1 }],
      mods: [{ id: 'm', label: 'l', until: 1, mods: { demandRes: 0.1 } }],
      incomes: [{ id: 'i', label: 'l', perMonth: 1, until: 2 }],
      locals: [{ id: 'l', x: 1, y: 2, r: 3, until: 4, crimeAdd: 0.1, lvAdd: 0.1 }],
      credits: [{ what: 'plaza', n: 1, mul: 0.5 }],
      pacts: [{ gang: 'kites', until: 1 }],
      deals: { d: { until: 1, cooldownUntil: 2 } },
      crackdowns: [{ x: 1, y: 2, r: 3, until: 4, scatterAt: 5, hit: ['kites'], base: { kites: 3 } }],
      precinctReady: { 4: 10 },
      saltReady: { board: 1 },
      builtCounts: { plaza: 1 },
      railOut: [{ i: 6, until: 7 }],
      log: [{ tick: 1, card: 'c', choice: 0 }],
      logs: [1],
      seen: { c: 1 },
      holds: { h: 1 },
      keyChoices: { k: 1 },
      flags: { f: 1 },
      endingHistory: [{ id: 'quiet', variant: null, from: 1, to: 2 }],
      callbacks: ['x'],
      countdownEnd: 1,
      endingTick: 1,
      nextReview: 1,
      waiveFrom: 1,
      chapterSec: 1,
      sinceStartSec: 1,
      deckSec: 1,
      frontSec: 1,
      mood: { board: 1 },
      lastHostileBy: { board: 1 },
      lastPulseBy: { board: 1 },
      whisperSnap: { board: 1 },
    });
    const records = new Set(['holds', 'favor', 'mood', 'floors', 'ceils', 'seen', 'deals', 'precinctReady', 'saltReady', 'builtCounts', 'lastHostileBy', 'lastPulseBy', 'keyChoices', 'whisperSnap', 'flags', 'mods[].mods', 'crackdowns[].base']);
    const paths = new Set<string>();
    numericPaths(st, '', paths, records);
    const known = new Set<string>([...TILE_INDEX_FIELDS, ...TILE_XY_FIELDS, ...NOT_SPATIAL_FIELDS]);
    const missing = [...paths].filter((p) => !known.has(p));
    expect(missing).toEqual([]);
    // Every StoryState key the defaults define is walked (a new key shows up here).
    for (const k of Object.keys(newStoryState(7))) expect(Object.keys(st)).toContain(k);
  });
});

describe('the start slot is today\'s map on either region (§3.6.1, §11.2 item 6)', () => {
  it('30 seeds: the start slot of a 3×3 and a 5×5 region equals the 64×64 generator; ring 1 of a 5×5 equals the 3×3', () => {
    for (let k = 0; k < 30; k++) {
      const seed = (k * 7919 + 13) >>> 0;
      const legacy = World.generate(seed, 'L', undefined, LEGACY_REGION);
      const w3 = World.generate(seed, 'T', undefined, 3);
      const w5 = World.generate(seed, 'F', undefined, 5);
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const a = legacy.tiles[y * 64 + x];
          const b = w3.tiles[(y + 64) * 192 + x + 64];
          const c = w5.tiles[(y + 128) * 320 + x + 128];
          if (a.terrain !== b.terrain || a.variant !== b.variant || a.terrain !== c.terrain || a.variant !== c.variant) throw new Error(`seed ${seed} at ${x},${y}`);
        }
      // Ring 1 (and the start) of the 5×5 region: the 3×3 frame at +64.
      for (let y = 0; y < 192; y++)
        for (let x = 0; x < 192; x++) {
          const b = w3.tiles[y * 192 + x];
          const c = w5.tiles[(y + 64) * 320 + x + 64];
          if (b.terrain !== c.terrain || b.variant !== c.variant) throw new Error(`ring 1, seed ${seed} at ${x},${y}`);
        }
      expect(w5.districts.kinds.filter((_, s) => ringOf(5, s) <= 1)).toEqual(w3.districts.kinds.map((x) => x));
    }
  }, 60000);
});

describe('layout (§3.6.2, §11.2 item 8)', () => {
  it('200 seeds per region: kinds and quotas, the Sunk in ring 1, the Shoals across the bay, land shares and buildable land', () => {
    for (let k = 0; k < 200; k++) {
      const seed = (k * 2654435761) >>> 0;
      const p = startParams(seed);
      const l3 = assignKinds(seed, 3, p.side, p.riverAxis, p.riverExits);
      expect([...l3.kinds].sort()).toEqual([...DISTRICT_KINDS].sort());
      expect(l3.variants.every((v) => v === 0)).toBe(true);
      const l5 = seedLayout(seed, 5);
      const count: Record<string, number> = {};
      l5.kinds.forEach((kk, s) => s !== 12 && (count[kk] = (count[kk] ?? 0) + 1));
      expect(count).toEqual({ ...REGION5_QUOTA });
      expect(l5.kinds[12]).toBe('shore');
      const sunk = l5.kinds.indexOf('sunk');
      expect(ringOf(5, sunk)).toBe(1);
      // Ring 1 of the 5×5 equals the 3×3 layout.
      for (let s = 0; s < 9; s++) expect(l5.kinds[(Math.floor(s / 3) + 1) * 5 + (s % 3) + 1]).toBe(l3.kinds[s]);
      // The slots straight across the bay are Shoals in rings 1 and 2.
      const [dx, dy] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ][p.side];
      expect(l3.kinds[(1 + dy) * 3 + 1 + dx]).toBe('shoals');
      expect(l5.kinds[(2 + dy) * 5 + 2 + dx]).toBe('shoals');
      expect(l5.kinds[(2 + 2 * dy) * 5 + 2 + 2 * dx]).toBe('shoals');
      // Variants number each kind's slots 0, 1, 2, 3.
      for (const kind of DISTRICT_KINDS) {
        const vs = l5.variants.filter((_, s) => l5.kinds[s] === kind).sort();
        expect(vs).toEqual(vs.map((_, i) => i));
      }
    }
  });

  it.each(REGIONS)('%i×%i: every slot\'s land share is in its kind\'s range and ≥ 35% of it is one 4-connected piece', (R) => {
    for (let k = 0; k < 6; k++) {
      const w = World.generate((k * 104729 + 5) >>> 0, 'Land', undefined, R);
      for (let s = 0; s < R * R; s++) {
        if (s === startSlot(R)) continue;
        const r = slotRect(w, s);
        let water = 0;
        const land = new Uint8Array(SLOT * SLOT);
        for (let y = 0; y < SLOT; y++)
          for (let x = 0; x < SLOT; x++) {
            const t = w.tileAt(r.x0 + x, r.y0 + y)!;
            if (t.terrain === Terrain.Water) water++;
            else land[y * SLOT + x] = 1;
          }
        const share = water / (SLOT * SLOT);
        const kind = w.districts.kinds[s];
        const v = w.variantOf(s);
        const [lo, hi] = v > 0 ? [0, 1] : KIND_WATER[kind];
        expect(share, `${kind} ${s}`).toBeGreaterThanOrEqual(lo - 0.01);
        expect(share, `${kind} ${s}`).toBeLessThanOrEqual(hi + 0.01);
        // Largest 4-connected land component.
        const seen = new Uint8Array(SLOT * SLOT);
        let best = 0;
        for (let i = 0; i < land.length; i++) {
          if (!land[i] || seen[i]) continue;
          let n = 0;
          const q = [i];
          seen[i] = 1;
          while (q.length) {
            const j = q.pop()!;
            n++;
            const x = j % SLOT;
            for (const nb of [j - SLOT, j + SLOT, x > 0 ? j - 1 : -1, x < SLOT - 1 ? j + 1 : -1])
              if (nb >= 0 && nb < land.length && land[nb] && !seen[nb]) {
                seen[nb] = 1;
                q.push(nb);
              }
          }
          best = Math.max(best, n);
        }
        expect(best / land.length, `${kind} ${s}`).toBeGreaterThanOrEqual(0.35);
      }
    }
  });
});

describe('invariants on locked land (§3.2, §11.2 item 7)', () => {
  it.each(REGIONS)('%i×%i: every mutator in random order with random annexes keeps the invariants', (R) => {
    const w = World.generate(77, 'Inv', undefined, R);
    w.funds = 1e9;
    w.maxPopulation = 1e9;
    const rng = new Rng(99);
    const N = w.N;
    const check = (what: string) => {
      for (let i = 0; i < w.area; i++) {
        const t = w.tiles[i];
        if (t.terrain === Terrain.Water && (t.elev !== 0 || t.ground !== Ground.Plain)) throw new Error(`${what}: elev/ground on water at ${i}`);
        if (w.ownedAt(i)) continue;
        if (t.road || t.zone !== ZoneType.None || t.buildingId >= 0 || w.rail[i] || w.sky[i] || w.turf.owner[i]) throw new Error(`${what}: locked tile ${i} holds something`);
      }
      for (const l of w.links) if (!w.isOwned(l.ax, l.ay) || !w.isOwned(l.bx, l.by)) throw new Error(`${what}: link anchor on locked land`);
      let n = 0;
      for (let s = 0; s < w.segCount; s += 2) n += w.segs[s + 1] - w.segs[s];
      if (n !== w.districts.owned.length * SLOT * SLOT) throw new Error(`${what}: segs`);
    };
    const xy = () => [rng.int(0, N - 1), rng.int(0, N - 1)] as const;
    const ops: [string, () => void][] = [
      ['road', () => w.setRoad(...xy(), rng.int(0, 3) as RoadKind)],
      ['zone', () => w.setZone(...xy(), rng.int(1, 3) as ZoneType)],
      ['level', () => w.setLevel(...xy(), rng.int(0, 3))],
      ['sky', () => w.setSky(...xy(), 1 | 4)],
      ['rail', () => w.setRail(...xy(), 2 | 8)],
      ['building', () => void w.addBuilding('plaza', ...xy())],
      ['link', () => void w.addLink({ ax: xy()[0], ay: 5, bx: xy()[0], by: 5 })],
      ['ground', () => w.setGround(...xy(), rng.int(0, 3) as Ground)],
      ['terrain', () => w.setTerrain(...xy(), rng.int(0, 1) as Terrain)],
      ['clear', () => w.clearTile(...xy())],
      ['tool', () => void applyAction(w, 'road', { x: rng.int(0, N - 1), y: rng.int(0, N - 1) }, { x: rng.int(0, N - 1), y: rng.int(0, N - 1) })],
      ['annex', () => w.annex(rng.int(0, R * R - 1))],
      // Turf (review fix): seeding, the monthly rules and the surge incident never claim a locked tile.
      ['turfSeed', () => void turf.seedGang(w, rng.int(0, 1) ? 'undertow' : 'kites', ...xy(), 90)],
      ['turfMonth', () => turf.update(w)],
      ['surge', () => void applySurge(w, rng.int(0, 1) ? 'undertow' : 'kites', ...xy())],
    ];
    for (let k = 0; k < 600; k++) {
      const [name, op] = ops[rng.int(0, ops.length - 1)];
      op();
      if (k % 20 === 0) check(name);
    }
    check('end');
    expect(w.districts.owned[0]).toBe(startSlot(R));
  });
});

describe('turf never forms on locked land (§3.4, §11.2 item 7; review fix)', () => {
  it.each(REGIONS)('%i×%i: gangs seeded at the start slot corners stay on owned land for 40 months; the cap and share count owned land', (R) => {
    const w = new World(77, 'Lock', undefined, R);
    const b = w.ownedBox;
    const N = w.N;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const t = w.tiles[y * N + x];
        t.terrain = Terrain.Land;
        if (!w.isOwned(x, y)) continue; // locked slots stay bare, as in play
        if (x % 4 === 0 || y % 4 === 0) t.road = true;
        else {
          t.zone = ZoneType.Residential;
          t.level = 2;
        }
      }
    const sim = new Simulation(w);
    sim.options.events = false;
    sim.recomputeAll();
    expect(turf.landTiles(w)).toBe(SLOT * SLOT);
    turf.seedGang(w, 'undertow', b.x0 + 1, b.y0 + 1, 90);
    turf.seedGang(w, 'kites', b.x1 - 1, b.y1 - 1, 90);
    // Seeds asked for on locked land claim nothing.
    expect(turf.seedGang(w, 'undertow', b.x0 - 3, b.y0 - 3, 90)).toBe(0);
    for (let k = 0; k < 40; k++) {
      turf.update(w);
      for (let d = 0; d < 30; d++) sim.step();
    }
    applySurge(w, 'undertow', b.x0, b.y0);
    applySurge(w, 'kites', b.x1 + 1, b.y1 + 1);
    let owned = 0;
    let locked = 0;
    for (let i = 0; i < w.area; i++) if (w.turf.owner[i]) w.ownedAt(i) ? owned++ : locked++;
    expect(owned).toBeGreaterThan(20);
    expect(locked).toBe(0);
    expect(w.turf.stats.tiles.undertow + w.turf.stats.tiles.kites).toBe(owned);
    expect(turf.isEligible(w, b.x0 - 1, b.y0)).toBe(false);
    // Story spots land on owned tiles too.
    const rng = new Rng(5);
    for (const rule of ['dense', 'abandoned', 'industrial', 'shore', 'highway', 'alley', 'any'] as const) {
      const at = findSpot(w, rule as Parameters<typeof findSpot>[1], rng);
      if (at >= 0) expect([rule, w.ownedAt(at)]).toEqual([rule, true]);
    }
  }, 120_000);
});

describe('regional links on the owned boundary (§3.5; review fix)', () => {
  it.each(REGIONS)('%i×%i: a road at the start slot edge links (sim and inspect), and stops once the slot beyond is annexed', (R) => {
    const g = new Game();
    g.newCity('Links', 2091, R);
    const w = g.world;
    const o = w.ownedBox;
    const y = o.y0 + 30;
    for (let yy = o.y0; yy <= o.y1; yy++) for (let x = o.x0; x <= o.x1; x++) w.tiles[yy * w.N + x].terrain = Terrain.Land;
    // A street from the west edge of the start slot inward, an avenue from its east edge.
    for (let x = o.x0; x < o.x0 + 12; x++) w.setRoad(x, y, RoadKind.Street);
    for (let x = o.x1; x > o.x1 - 12; x--) w.setRoad(x, y + 10, RoadKind.Avenue);
    // A road ending one tile short of the edge is no link.
    for (let x = o.x0 + 1; x < o.x0 + 12; x++) w.setRoad(x, y + 20, RoadKind.Street);
    g.sim.recomputeAll();
    expect(w.stats.edgeLinks).toBe(1 + 2);
    expect(g.getTileInfo(o.x0, y)?.notes).toEqual([{ text: 'Regional link: +1 trade', tone: 'good' }]);
    expect(g.getTileInfo(o.x1, y + 10)?.notes).toEqual([{ text: 'Regional link: +2 trade', tone: 'good' }]);
    expect(g.getTileInfo(o.x0 + 1, y + 20)?.notes ?? []).toEqual([]);
    // Annexing the west neighbour turns that border internal: the street stops counting (a daily step sees it).
    const west = startSlot(R) - 1;
    w.annex(west);
    g.sim.step();
    expect(w.stats.edgeLinks).toBe(2);
    expect(g.getTileInfo(o.x0, y)?.notes ?? []).toEqual([]);
  });
});

describe('inspect on locked land (§3.4; review fix)', () => {
  it.each(REGIONS)("%i×%i: a locked tile names its district, 'Not annexed yet', with no lot rows; the Sunk before it opens says only 'Still flooded'", (R) => {
    const g = new Game();
    g.newCity('Peek', 2091, R);
    const w = g.world;
    const o = w.ownedBox;
    const s = startSlot(R) - R; // north of the start slot
    const at = { x: o.x0 + 10, y: o.y0 - 10 };
    expect(w.slotAt(at.x, at.y)).toBe(s);
    const def = DISTRICTS[w.districts.kinds[s]];
    const v = w.variantOf(s);
    const name = v > 0 ? def.variants[v - 1].name : def.name;
    const info = g.getTileInfo(at.x, at.y)!;
    expect(info).toMatchObject({ title: name, subtitle: 'Not annexed yet', rows: [] });
    expect(info.title).not.toBe('Open ground');
    // The Sunk before ch4.brine: its name and "Still flooded" only.
    w.districts.kinds[s] = 'sunk';
    expect(g.getTileInfo(at.x, at.y)).toEqual({ title: DISTRICTS.sunk.name, subtitle: 'Still flooded: opens later', color: DISTRICTS.sunk.color, rows: [] });
    // Owned land still gets the lot rows.
    expect(g.getTileInfo(o.x0 + 10, o.y0 + 10)!.rows.length).toBeGreaterThan(0);
  });
});

describe('annex determinism (§3.8, §11.2 item 12)', () => {
  it.each(REGIONS)('%i×%i: the same seed and annex order give an identical world, with one tiles event per annex', (R) => {
    const order = [startSlot(R) + 1, startSlot(R) - R, startSlot(R) - 1];
    const make = () => {
      const w = World.generate(5150, 'Det', undefined, R);
      let tiles = 0;
      const annexed: number[] = [];
      w.events.on('tiles', () => tiles++);
      w.events.on('annex', (a) => annexed.push(a.slot));
      for (const s of order) {
        const before = tiles;
        w.annex(s);
        expect(tiles - before).toBe(1);
      }
      expect(annexed).toEqual(order);
      return w;
    };
    const a = make();
    const b = make();
    expect(a.rng.state).toBe(b.rng.state);
    expect(JSON.stringify({ ...a.serialize(), savedAt: 0 })).toBe(JSON.stringify({ ...b.serialize(), savedAt: 0 }));
    expect(a.districts.annexedAt[order[0]]).toBe(0);
    expect(a.slotsVersion).toBe(3);
  });
});

describe('ids, look 0 and the frame (§6.1, §6.2, §11.2 items 10, 11)', () => {
  it('every model id family is disjoint and the largest sprite key stays below 2⁵³', () => {
    const zones = [0, 479];
    const sky = [SKY_BASE, 5000 + 999];
    const kit = [KIT_BASE, 1_210_000];
    const services = [SERVICE_KIT_BASE, serviceModelId(56, 15, 9, 63)];
    expect(services[1]).toBeLessThan(2_600_000);
    const fams = [zones, sky, kit, services].sort((x, y) => x[0] - y[0]);
    for (let k = 1; k < fams.length; k++) expect(fams[k][0]).toBeGreaterThan(fams[k - 1][1]);
    const maxId = services[1];
    expect(((maxId * 5 + 4) * 7 + 6) * 4096 * 2 + 1).toBeLessThan(2 ** 53);
    expect(MAX_MAP_SIZE ** 2).toBeLessThan(2 ** 31);
  });

  it('look 0: every v3 building type keeps today\'s art seed (the Megacity rows seed after them)', () => {
    const V3_ORDER = ['solar', 'reactor', 'plaza', 'precinct', 'clinic', 'datahub', 'maglev', 'spire', 'arcology', 'academy', 'seaport', 'airport', 'spaceport', 'stack', 'foundry', 'glarewall', 'tidemarket', 'roost', 'commons', 'memorial'] as const;
    V3_ORDER.forEach((t, i) => expect(serviceSeed(t), t).toBe(31337 + 480 + i));
    const seeds = new Set(BUILDING_ORDER.map(serviceSeed));
    expect(seeds.size).toBe(BUILDING_ORDER.length);
  });
});

describe('config tables (§3.2, §3.7, §4.5)', () => {
  it('DISTRICTS: names, copy lengths, variants and goals', () => {
    const names = new Set<string>();
    for (const k of DISTRICT_KINDS) {
      const d = DISTRICTS[k];
      expect(d.kind).toBe(k);
      expect(d.name.length).toBeLessThanOrEqual(18);
      expect(d.short.length).toBeLessThanOrEqual(12);
      expect(d.tagline.length).toBeLessThanOrEqual(60);
      for (const p of d.perks) expect(p.length).toBeLessThanOrEqual(48);
      for (const h of d.hazards) expect(h.length).toBeLessThanOrEqual(48);
      for (const q of Object.values(d.quote)) expect(q!.length).toBeLessThanOrEqual(110);
      for (const g of [...d.goals, ...d.variants.map((v) => v.goal)]) expect(g.label.length, g.label).toBeLessThanOrEqual(40);
      if (k !== 'shore') expect(d.neighbourhoods).toHaveLength(12);
      for (const n of [d.name, ...d.variants.map((v) => v.name)]) {
        expect(names.has(n)).toBe(false);
        names.add(n);
      }
    }
    expect(DISTRICTS.shore.variants).toHaveLength(0);
    expect(DISTRICTS.sunk.variants).toHaveLength(0);
    expect(names.size).toBe(9 + 16);
    expect(DISTRICTS.tarmac.lease?.options).toEqual(['nacre', 'basalt']);
    expect(REGION[5].epilogueGrantMul).toBe(0.5);
    expect(milestonesFor(3).length).toBe(MILESTONES.length - 2);
    expect(milestonesFor(5).length).toBe(MILESTONES.length);
  });

  it.each(REGIONS)('%i×%i: the advisor pays the 5×5-only milestones only on a 5×5 region', (R) => {
    const w = new World(5, 'Milestones', undefined, R);
    const adv = new Advisor();
    adv.milestones(w, 9_000_000);
    const want = milestonesFor(R).map((m) => m.pop);
    expect(w.milestones).toEqual(want);
    expect(w.milestones.includes(6_000_000)).toBe(R === 5);
  });
});

describe('field identity on the start slot (§11.2 item 9)', () => {
  const FIXTURES = import.meta.glob(['./fixtures/v3-*.json', '!./fixtures/v3-baseline.json'], { import: 'default', eager: true }) as Record<string, SaveData>;
  const KEYS = ['landValue', 'pollution', 'crime', 'security', 'health', 'park', 'transit', 'wealth', 'traffic', 'education'] as const;
  /** The fixture migrated to a 3×3 region and the same city on the legacy 64 frame (what the v3 build computed). */
  const pair = (v3: SaveData) => {
    const migrated = World.deserialize(JSON.parse(JSON.stringify(v3)));
    const legacySave: SaveData = {
      ...JSON.parse(JSON.stringify(v3)),
      version: 4,
      region: 1,
      size: 64,
      districts: { kinds: ['shore'], owned: [0], grants: 0, bought: 0, annexedAt: [0] },
      tileBlocks: [encodeBlock(v3.tiles!.map((t) => t & 0xfffff))],
    };
    delete legacySave.tiles;
    const legacy = World.deserialize(legacySave);
    for (const w of [migrated, legacy]) {
      const sim = new Simulation(w);
      sim.options.events = false;
      sim.recomputeAll();
    }
    return { migrated, legacy };
  };
  /** Tiles whose field differs by more than 1e-6, and the farthest of them from the slot edge (−1 when none). */
  const gap = (legacy: World, migrated: World) => {
    let n = 0;
    let depth = -1;
    for (const k of KEYS)
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const a = (legacy.fields[k] as Float32Array)[y * 64 + x];
          const b = (migrated.fields[k] as Float32Array)[(y + 64) * 192 + x + 64];
          if (Math.abs(a - b) <= 1e-6) continue;
          n++;
          depth = Math.max(depth, Math.min(x, y, 63 - x, 63 - y));
        }
    return { n, depth };
  };

  it('every pinned v3 fixture: identical regional links, residents and jobs; any field difference lies within 3 tiles of the slot edge', () => {
    const names = Object.keys(FIXTURES);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) {
      const { migrated, legacy } = pair(FIXTURES[name]);
      // Regional links count on the owned boundary (§3.5): the start slot's edge is the v3 map border.
      for (const k of ['edgeLinks', 'population', 'jobsCom', 'jobsInd'] as const) expect([name, k, migrated.stats[k]]).toEqual([name, k, legacy.stats[k]]);
      const g = gap(legacy, migrated);
      // Pollution's three blur passes still cross the slot edge into the locked slots (WP-1's O1 boundary rule).
      expect([name, g.depth]).toEqual([name, Math.min(g.depth, 2)]);
    }
  });

  it('the whole slot matches exactly on every fixture with no pollution at the slot edge (all but v3-expansion)', () => {
    for (const [name, v3] of Object.entries(FIXTURES)) {
      if (name.includes('v3-expansion')) continue;
      const { migrated, legacy } = pair(v3);
      expect([name, gap(legacy, migrated).n]).toEqual([name, 0]);
      // Visitors follow the mean crime (the tourism mood), so they match where the fields do.
      expect([name, migrated.stats.visitors]).toEqual([name, legacy.stats.visitors]);
    }
  });

  // OPEN Step 0b acceptance item (§11.6): v3-expansion has pollution sources on its map edge, and blur3 still reads
  // the locked slots beside the start slot. WP-1's O1 (a locked tile is off the map for every stencil) closes it;
  // this case then passes, and `it.fails` turns red: make it a plain `it`.
  it.fails('v3-expansion over the whole slot (open until WP-1 lands O1)', () => {
    const v3 = Object.entries(FIXTURES).find(([n]) => n.includes('v3-expansion'))![1];
    const { migrated, legacy } = pair(v3);
    expect(gap(legacy, migrated).n).toBe(0);
  });
});
