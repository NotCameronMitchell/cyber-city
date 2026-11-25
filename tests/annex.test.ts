// Annexing (docs/MEGACITY.md §3.2, §3.7, §3.8, §11.3 D2, D3, D5; WP-2), on both regions: one batched 'tiles' event,
// content from its own Rng (never world.rng), the same world for the same seed and order, each kind's content (ruins
// and the pump hall, brownfield, reeds, frames, the apron families on Tarmac Reach only, alleys), the district layer
// part (Terraces views, wild reeds as parks, brownfield smog, the Sunk's crime fading, king tides, Floodwatch), Pump
// House reclamation, and a new district that grows (D5).

import { describe, expect, it } from 'vitest';
import { finishFrame, frameStatus } from '../src/game/actions';
import { DISTRICTS } from '../src/game/config';
import { districtDaily, kingTides, pumpHouses, pumpRings } from '../src/game/districts/daily';
import { brownfieldSites, framesOf, isRuin, pumpHallSite, tarmacSites } from '../src/game/districts/annex';
import {
  apron,
  clearBrownfield,
  clearRuins,
  countGround,
  drainReeds,
  halfLifeShare,
  isFloodplain,
  kingTideAt,
  maxLevelAt,
  updateDistrictLayers,
  writeDistrictPart,
} from '../src/game/districts/effects';
import { alleysIn, ruinsIn } from '../src/game/districts/goals';
import { slotOffset, slotRect } from '../src/game/districts/slots';
import { Simulation } from '../src/game/sim';
import { composeLayers } from '../src/game/story/mods';
import { DAYS_PER_MONTH, Ground, REGIONS, RoadKind, Terrain, ZoneType, type DistrictKind, type Region } from '../src/game/types';
import { World } from '../src/game/world';
import { ScriptedMayor } from './helpers';

/** A generated world of a region with the slot of `kind` (and variant) annexed; null if the seed has none. */
function annexed(R: Region, kind: DistrictKind, seed = 2091, variant = 0): { w: World; s: number } {
  const w = World.generate(seed, 'Annex', undefined, R);
  for (let s = 0; s < R * R; s++)
    if (w.districts.kinds[s] === kind && w.variantOf(s) === variant) {
      w.annex(s);
      return { w, s };
    }
  throw new Error(`no ${kind}/${variant} on seed ${seed}`);
}

function landTiles(w: World, s: number): number {
  const r = slotRect(w, s);
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (w.tiles[w.idx(x, y)].terrain === Terrain.Land) n++;
  return n;
}

describe.each(REGIONS)('%i×%i: the structural annex (§3.2)', (R) => {
  it('one batched tiles event; world.rng untouched; the same seed and order give the same world', () => {
    const a = World.generate(77, 'A', undefined, R);
    const b = World.generate(77, 'B', undefined, R);
    const rngBefore = a.rng.state;
    const tiles: unknown[] = [];
    a.events.on('tiles', (e) => tiles.push(e));
    const order = R === 3 ? [5, 1, 2, 7, 6] : [13, 7, 8, 17, 18, 14];
    a.story.flags.published = true;
    b.story.flags.published = true;
    for (const s of order) a.annex(s);
    for (const s of order) b.annex(s);
    expect(tiles).toHaveLength(order.length);
    expect(a.rng.state).toBe(rngBefore);
    const sa = JSON.stringify({ ...a.serialize(), cityName: '', savedAt: 0 });
    const sb = JSON.stringify({ ...b.serialize(), cityName: '', savedAt: 0 });
    expect(sa).toBe(sb);
  });
});

describe.each(REGIONS)('%i×%i: annex content by kind (§3.7)', (R) => {
  it('the Sunk: ruins on ≈ 35% of its land (ruins, not abandoned lots), rubble, the fixed pump hall by the water', () => {
    const { w, s } = annexed(R, 'sunk');
    const land = landTiles(w, s);
    const ruins = ruinsIn(w, s);
    expect(ruins / land).toBeGreaterThan(0.28);
    expect(ruins / land).toBeLessThan(0.42);
    const hall = [...w.buildings.values()].filter((b) => b.type === 'pumphall');
    expect(hall).toHaveLength(1);
    const site = pumpHallSite(w, s)!;
    expect(hall[0].x).toBe(site.x);
    expect(hall[0].y).toBe(site.y);
    let rubble = 0;
    const r = slotRect(w, s);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const t = w.tiles[w.idx(x, y)];
        if (t.ground === Ground.Rubble && t.zone === ZoneType.None) rubble++;
        if (isRuin(t)) {
          expect(t.level === 1 || t.level === 2).toBe(true);
          expect(t.wealth).toBe(0);
          expect(t.zone === ZoneType.Residential || t.zone === ZoneType.Commercial).toBe(true);
        }
      }
    expect(rubble).toBeGreaterThan(0);
  });

  it('Kessel Flats: brownfield on ≈ 60% of the land; Reedmere: reeds near water', () => {
    const f = annexed(R, 'flats');
    const placed = brownfieldSites(f.w, f.s).length;
    expect(placed / landTiles(f.w, f.s)).toBeGreaterThan(0.55);
    expect(placed / landTiles(f.w, f.s)).toBeLessThan(0.65);
    const m = annexed(R, 'reedmere');
    const r = slotRect(m.w, m.s);
    let reeds = 0;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        if (m.w.tiles[m.w.idx(x, y)].ground !== Ground.Reed) continue;
        reeds++;
        let near = false;
        for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4 && !near; dx++) near = m.w.tileAt(x + dx, y + dy)?.terrain === Terrain.Water;
        expect(near).toBe(true);
      }
    expect(reeds).toBeGreaterThan(300); // the kind's goal "300 wild reed lots" is reachable
  });

  it('Skeleton Row: 5 frames ≥ 10 tiles apart, fixed; a broken street grid', () => {
    const { w, s } = annexed(R, 'skeleton');
    const frames = [...w.buildings.values()].filter((b) => b.type === 'frame');
    expect(frames).toHaveLength(5);
    expect(framesOf(w, s).map((f) => `${f.x},${f.y}`).sort()).toEqual(frames.map((f) => `${f.x},${f.y}`).sort());
    for (const a of frames)
      for (const b of frames) {
        if (a === b) continue;
        const gx = Math.max(0, Math.abs(a.x - b.x) - 4);
        const gy = Math.max(0, Math.abs(a.y - b.y) - 4);
        expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(10);
      }
    let streets = 0;
    const r = slotRect(w, s);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (w.tiles[w.idx(x, y)].road) streets++;
    expect(streets).toBeGreaterThan(100);
  });

  it('Tarmac Reach: the runway and apron on brownfield, and the apron families (24 Hab lots and an alley) on variant 0 only', () => {
    const { w, s } = annexed(R, 'tarmac');
    const sites = tarmacSites(w, s);
    expect(sites.runways.length).toBe(1);
    expect(sites.families).not.toBeNull();
    const f = sites.families!;
    let hab = 0;
    let alley = 0;
    for (let y = f.y0; y <= f.y1; y++)
      for (let x = f.x0; x <= f.x1; x++) {
        const t = w.tiles[w.idx(x, y)];
        if (t.zone === ZoneType.Residential && t.level === 1 && t.wealth === 0) hab++;
        if (t.road && t.roadKind === RoadKind.Alley) alley++;
      }
    expect(hab).toBe(24);
    expect(alley).toBe(6);
    if (R === 5) {
      const v = annexed(5, 'tarmac', 2091, 1);
      expect(tarmacSites(v.w, v.s).families).toBeNull();
      expect(tarmacSites(v.w, v.s).runways.length).toBe(2); // Cargo Fields: two strips
    }
  });

  it('Verdigris Bazaar: a Back Alley tangle on ≈ 18% of the land', () => {
    const { w, s } = annexed(R, 'bazaar');
    const share = alleysIn(w, s) / landTiles(w, s);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.3);
  });
});

describe.each(REGIONS)('%i×%i: the district part is rebuilt per slot, only where an input changed (§3.3, §11.1)', (R) => {
  it('after random tile, terrain, tide and year changes the per-slot rebuild equals a whole rebuild exactly; a level change elsewhere rebuilds nothing', () => {
    const w = World.generate(R === 3 ? 2091 : 7, 'Parts', undefined, R);
    w.story.flags.published = true;
    for (let s = 0; s < R * R; s++) if (!w.slotOwned[s]) w.annex(s);
    updateDistrictLayers(w, true);
    const N = w.N;
    let seed = 99;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const pick = (test: (i: number) => boolean): number => {
      for (let k = 0; k < 4000; k++) {
        const i = Math.floor(rnd() * w.area);
        if (w.ownedAt(i) && test(i)) return i;
      }
      return -1;
    };
    const parts = () => {
      const d = w.layerParts.district;
      const l = w.layers;
      return [d.lvAdd, d.crimeAdd, d.parkAdd, d.pollutionAdd, l.lvAdd, l.crimeAdd, l.parkAdd, l.pollutionAdd].map((a) => Array.from(a));
    };
    let rebuilt = 0;
    for (let round = 0; round < 12; round++) {
      for (let k = 0; k < 6; k++) {
        const kind = Math.floor(rnd() * 6);
        if (kind === 0) {
          const i = pick((j) => w.tiles[j].ground === Ground.Reed && w.tiles[j].zone === ZoneType.None && !w.tiles[j].road);
          if (i >= 0) w.setZone(i % N, (i / N) | 0, ZoneType.Residential);
        } else if (kind === 1) {
          const i = pick((j) => w.tiles[j].ground === Ground.Brownfield);
          if (i >= 0) {
            w.setZone(i % N, (i / N) | 0, ZoneType.Industrial);
            w.setLevel(i % N, (i / N) | 0, w.tiles[i].level >= 1 ? 0 : 1);
          }
        } else if (kind === 2) {
          const i = pick((j) => w.tiles[j].ground === Ground.Rubble);
          if (i >= 0) w.setGround(i % N, (i / N) | 0, Ground.Plain);
        } else if (kind === 3) {
          const f = [...w.buildings.values()].find((b) => b.type === 'frame');
          if (f) w.removeBuilding(f.id);
        } else if (kind === 4) {
          const i = pick((j) => w.tiles[j].terrain === Terrain.Water && !w.tiles[j].road && [1, -1, N, -N].some((d) => w.tiles[j + d]?.terrain === Terrain.Land));
          if (i >= 0) w.setTerrain(i % N, (i / N) | 0, Terrain.Land);
        } else {
          w.tide = w.tide > 0 ? 0 : 20;
          if (rnd() < 0.5) w.tick += 360;
        }
      }
      if (updateDistrictLayers(w)) rebuilt++;
      const inc = parts();
      writeDistrictPart(w);
      composeLayers(w, true);
      const whole = parts();
      for (let a = 0; a < inc.length; a++) {
        const bad = inc[a].findIndex((v, i) => v !== whole[a][i]);
        expect(bad, `round ${round}, array ${a}, tile ${bad}`).toBe(-1);
      }
    }
    expect(rebuilt).toBeGreaterThan(6);
    // Zoning and growing a plain lot in a district whose terms read tiles (inputs no term reads) leaves every slot clean.
    const tileKinds = new Set(['sunk', 'flats', 'skeleton']);
    const i = pick(
      (j) =>
        tileKinds.has(w.districts.kinds[w.slotAt(j % N, (j / N) | 0)]) &&
        w.tiles[j].terrain === Terrain.Land &&
        w.tiles[j].ground === Ground.Plain &&
        !w.tiles[j].road &&
        w.tiles[j].buildingId < 0,
    );
    expect(i).toBeGreaterThanOrEqual(0);
    w.setZone(i % N, (i / N) | 0, ZoneType.Residential);
    w.setLevel(i % N, (i / N) | 0, 2);
    expect(updateDistrictLayers(w)).toBe(false);
  }, 60_000);
});

describe.each(REGIONS)('%i×%i: the district layer part (§3.3; D2, D3)', (R) => {
  it('Terraces +0.035 land value per step; wild reeds act as parks (≥ 0.45); brownfield smog 0.15, 0.07 developed', () => {
    const t = annexed(R, 'terraces');
    updateDistrictLayers(t.w, true);
    const r = slotRect(t.w, t.s);
    let checked = 0;
    for (let y = r.y0; y <= r.y1 && checked < 50; y++)
      for (let x = r.x0; x <= r.x1 && checked < 50; x++) {
        const tile = t.w.tiles[t.w.idx(x, y)];
        if (tile.terrain !== Terrain.Land || tile.elev === 0) continue;
        expect(t.w.layerParts.district.lvAdd[t.w.idx(x, y)]).toBeCloseTo(0.035 * tile.elev, 6);
        checked++;
      }
    expect(checked).toBe(50);
    const m = annexed(R, 'reedmere');
    writeDistrictPart(m.w);
    const rr = slotRect(m.w, m.s);
    for (let y = rr.y0; y <= rr.y1; y++)
      for (let x = rr.x0; x <= rr.x1; x++) {
        const i = m.w.idx(x, y);
        if (m.w.tiles[i].ground === Ground.Reed) expect(m.w.layerParts.district.parkAdd[i]).toBeGreaterThanOrEqual(0.45);
      }
    const f = annexed(R, 'flats');
    writeDistrictPart(f.w);
    const i = brownfieldSites(f.w, f.s)[0];
    expect(f.w.layerParts.district.pollutionAdd[i]).toBeCloseTo(0.15, 6);
    f.w.setZone(i % f.w.N, (i / f.w.N) | 0, ZoneType.Industrial);
    f.w.setLevel(i % f.w.N, (i / f.w.N) | 0, 1);
    writeDistrictPart(f.w);
    expect(f.w.layerParts.district.pollutionAdd[i]).toBeCloseTo(0.07, 6);
  });

  it('Skeleton Row: crime +4% within 3 of an unfinished frame; finishing the frame takes it away at once', () => {
    const { w, s } = annexed(R, 'skeleton');
    updateDistrictLayers(w, true);
    const frames = [...w.buildings.values()].filter((b) => b.type === 'frame' && w.slotAt(b.x, b.y) === s);
    expect(frames.length).toBe(5);
    const f = frames[0];
    const fc = DISTRICTS.skeleton.mods.frameCrime!;
    const near = { x: f.x - fc.r, y: f.y + 1 };
    const crimeAt = (x: number, y: number) => w.layerParts.district.crimeAdd[w.idx(x, y)];
    const landNear = w.tiles[w.idx(near.x, near.y)].terrain === Terrain.Land;
    expect(landNear).toBe(true);
    expect(crimeAt(near.x, near.y)).toBeCloseTo(fc.v, 6);
    // Far from every frame: no frame crime.
    const r = slotRect(w, s);
    let far = -1;
    for (let y = r.y0; y <= r.y1 && far < 0; y++)
      for (let x = r.x0; x <= r.x1 && far < 0; x++) {
        if (w.tiles[w.idx(x, y)].terrain !== Terrain.Land) continue;
        if (frames.every((b) => x < b.x - fc.r - 1 || x > b.x + b.size + fc.r || y < b.y - fc.r - 1 || y > b.y + b.size + fc.r)) far = w.idx(x, y);
      }
    expect(far).toBeGreaterThanOrEqual(0);
    expect(w.layerParts.district.crimeAdd[far]).toBe(0);
    // Finish it: its ring goes the same day.
    w.funds = 1e7;
    w.story.unlocks.push('stack');
    const inner = { x: f.x - 1, y: f.y + 1 };
    const before = crimeAt(inner.x, inner.y);
    expect(finishFrame(w, f.id).ok).toBe(true);
    const others = frames.slice(1);
    const stillNear = others.some((b) => inner.x >= b.x - fc.r && inner.x < b.x + b.size + fc.r && inner.y >= b.y - fc.r && inner.y < b.y + b.size + fc.r);
    expect(w.tiles[w.idx(inner.x, inner.y)].terrain).toBe(Terrain.Land);
    expect(stillNear).toBe(false); // frames stand ≥ 10 tiles apart
    expect(before).toBeCloseTo(fc.v, 6);
    expect(crimeAt(inner.x, inner.y)).toBe(0);
  });

  it('finishing a frame needs the Stratablock unlocked (or its fallback)', () => {
    const { w, s } = annexed(R, 'skeleton');
    const f = [...w.buildings.values()].find((b) => b.type === 'frame' && w.slotAt(b.x, b.y) === s)!;
    w.funds = 1e7;
    w.maxPopulation = 0;
    w.story.unlocks = w.story.unlocks.filter((u) => u !== 'stack');
    expect(frameStatus(w, f.id).reason).toMatch(/^Locked/);
    expect(finishFrame(w, f.id).ok).toBe(false);
    expect(w.buildings.get(f.id)?.type).toBe('frame');
    w.story.unlocks.push('stack');
    expect(frameStatus(w, f.id).reason).toBeNull();
  });

  it("the Sunk's crime +6% fades with a 1,080-day half-life, stepped by year", () => {
    const { w, s } = annexed(R, 'sunk');
    const r = slotRect(w, s);
    let i = -1;
    for (let y = r.y0; y <= r.y1 && i < 0; y++) for (let x = r.x0; x <= r.x1 && i < 0; x++) if (w.tiles[w.idx(x, y)].terrain === Terrain.Land) i = w.idx(x, y);
    writeDistrictPart(w);
    expect(w.layerParts.district.crimeAdd[i]).toBeCloseTo(0.06, 6);
    w.tick += 1080;
    writeDistrictPart(w);
    expect(w.layerParts.district.crimeAdd[i]).toBeCloseTo(0.03, 6);
    expect(halfLifeShare(2160, 1080)).toBeCloseTo(0.25, 9);
    expect(halfLifeShare(540, 1080)).toBeCloseTo(0.75, 9);
  });

  it('king tides twice a year on owned Shoals land by the water; a Floodwatch (resilience) cancels them and the floodplain cap (D3)', () => {
    const { w, s } = annexed(R, 'shoals');
    w.tick = DAYS_PER_MONTH * DISTRICTS.shoals.mods.kingTide!.months[0] + 1;
    expect(kingTides(w)).toBe(true);
    expect(w.tide).toBe(DISTRICTS.shoals.mods.kingTide!.days);
    const r = slotRect(w, s);
    let shore: { x: number; y: number } | null = null;
    for (let y = r.y0; y <= r.y1 && !shore; y++)
      for (let x = r.x0; x <= r.x1 && !shore; x++) {
        if (w.tiles[w.idx(x, y)].terrain !== Terrain.Land) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.tileAt(x + dx, y + dy)?.terrain === Terrain.Water)) shore = { x, y };
      }
    expect(kingTideAt(w, shore!.x, shore!.y)).toBe(true);
    writeDistrictPart(w);
    expect(w.layerParts.district.lvAdd[w.idx(shore!.x, shore!.y)]).toBeCloseTo(0.04 - 0.03, 6);
    w.fields.resilience[w.idx(shore!.x, shore!.y)] = 0.5;
    expect(kingTideAt(w, shore!.x, shore!.y)).toBe(false);
    writeDistrictPart(w);
    expect(w.layerParts.district.lvAdd[w.idx(shore!.x, shore!.y)]).toBeCloseTo(0.04, 6);
    // The floodplain cap: level 2 at most by the marsh's water, lifted under a Floodwatch.
    const m = annexed(R, 'reedmere');
    const q = slotRect(m.w, m.s);
    let fp: { x: number; y: number } | null = null;
    for (let y = q.y0; y <= q.y1 && !fp; y++) for (let x = q.x0; x <= q.x1 && !fp; x++) if (isFloodplain(m.w, x, y)) fp = { x, y };
    expect(maxLevelAt(m.w, fp!.x, fp!.y)).toBe(2);
    m.w.fields.resilience[m.w.idx(fp!.x, fp!.y)] = 1;
    expect(maxLevelAt(m.w, fp!.x, fp!.y)).toBe(3);
  });

  it('a Pump House raises one ring of owned water every 30 powered days, then becomes a pump garden', () => {
    const { w, s } = annexed(R, 'sunk');
    const r = slotRect(w, s);
    let at: { x: number; y: number } | null = null;
    for (let y = r.y0 + 3; y <= r.y1 - 3 && !at; y++)
      for (let x = r.x0 + 3; x <= r.x1 - 3 && !at; x++) {
        const t = w.tiles[w.idx(x, y)];
        if (t.terrain === Terrain.Land && t.buildingId < 0 && w.tileAt(x + 1, y)?.terrain === Terrain.Water && w.tileAt(x + 2, y)?.terrain === Terrain.Water) at = { x, y };
      }
    const b = w.addBuilding('pumphouse', at!.x, at!.y)!;
    b.reclaim = 90;
    b.powered = true;
    let raised = 0;
    for (let d = 0; d < 90; d++) raised += pumpHouses(w);
    expect(b.reclaim).toBe(0);
    expect(pumpRings(b)).toBe(3);
    expect(raised).toBeGreaterThan(0);
    expect(w.tileAt(at!.x + 1, at!.y)!.terrain).toBe(Terrain.Land);
    // Unpowered, nothing moves.
    const c = w.addBuilding('pumphouse', at!.x, at!.y + 10);
    if (c) {
      c.reclaim = 90;
      c.powered = false;
      pumpHouses(w);
      expect(c.reclaim).toBe(90);
    }
  });
});

describe.each(REGIONS)('%i×%i: D5, a new district grows', (R) => {
  it('the first ScriptedMayor block in a just-annexed slot develops within 60 days of road and power', () => {
    const w = World.generate(5150, 'Grow', undefined, R);
    w.funds = 1e7;
    const start = (R * R - 1) >> 1;
    // The slot east of the start: annexed, its content cleared to land so the mayor's grid fits.
    const s = start + 1;
    w.annex(s);
    const r = slotRect(w, s);
    for (const b of [...w.buildings.values()]) w.removeBuilding(b.id);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        w.tiles[w.idx(x, y)].terrain = Terrain.Land;
        w.tiles[w.idx(x, y)].elev = 0;
        w.clearTile(x, y);
        w.setGround(x, y, Ground.Plain);
      }
    const sim = new Simulation(w);
    sim.options.events = false;
    sim.districtDaily = districtDaily;
    sim.recomputeAll();
    const mayor = new ScriptedMayor(w, sim, { ox: r.x0 + 10, oy: r.y0 + 10, span: 5 });
    mayor.opening();
    let developed = 0;
    for (let d = 0; d < 60 && developed === 0; d++) {
      sim.step();
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          const t = w.tiles[w.idx(x, y)];
          if (t.zone !== ZoneType.None && t.level > 0 && !t.abandoned) developed++;
        }
    }
    expect(developed).toBeGreaterThan(0);
  });
});

describe.each(REGIONS)('%i×%i: story effects that name a district (§8.4)', (R) => {
  it('brownfield clear: every brownfield tile of every owned Flats district turns Plain; the smog goes', () => {
    const { w, s } = annexed(R, 'flats');
    updateDistrictLayers(w, true);
    expect(countGround(w, s, Ground.Brownfield)).toBeGreaterThan(500);
    const n = clearBrownfield(w);
    expect(n).toBeGreaterThan(500);
    expect(countGround(w, s, Ground.Brownfield)).toBe(0);
    const r = slotRect(w, s);
    let smog = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) smog += w.layerParts.district.pollutionAdd[w.idx(x, y)];
    expect(smog).toBe(0);
    expect(clearBrownfield(w)).toBe(0);
  });

  it("ruins clear: the Sunk's ruins become empty zoned lots (never abandoned), ground Plain", () => {
    const { w, s } = annexed(R, 'sunk');
    const before = ruinsIn(w, s);
    expect(before).toBeGreaterThan(100);
    const r = slotRect(w, s);
    const zoned: number[] = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (isRuin(w.tiles[w.idx(x, y)])) zoned.push(w.idx(x, y));
    expect(clearRuins(w)).toBe(before);
    expect(ruinsIn(w, s)).toBe(0);
    for (const i of zoned) {
      const t = w.tiles[i];
      expect(t.zone).not.toBe(ZoneType.None);
      expect(t.level).toBe(0);
      expect(t.abandoned).toBe(false);
      expect(t.ground).toBe(Ground.Plain);
    }
  });

  it('reeds drain: reed ground turns Plain on the half of the marsh nearer the start slot only', () => {
    const { w, s } = annexed(R, 'reedmere');
    const r = slotRect(w, s);
    const [dx, dy] = slotOffset(w.region, s);
    const halves = () => {
      let near = 0;
      let far = 0;
      for (let ly = 0; ly < 64; ly++)
        for (let lx = 0; lx < 64; lx++) {
          if (w.tiles[w.idx(r.x0 + lx, r.y0 + ly)].ground !== Ground.Reed) continue;
          if ((lx - 31.5) * dx + (ly - 31.5) * dy < 0) near++;
          else far++;
        }
      return { near, far };
    };
    const b = halves();
    expect(b.near).toBeGreaterThan(0);
    expect(b.far).toBeGreaterThan(0);
    expect(drainReeds(w)).toBe(b.near);
    expect(halves()).toEqual({ near: 0, far: b.far });
  });

  it('apron rehouse lifts the families to level 2 at $$; apron clear removes the block; only on Tarmac Reach itself', () => {
    for (const mode of ['rehouse', 'clear'] as const) {
      const { w, s } = annexed(R, 'tarmac');
      const f = tarmacSites(w, s).families!;
      expect(f).not.toBeNull();
      let hab = 0;
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (w.tileAt(x, y)!.zone === ZoneType.Residential) hab++;
      expect(hab).toBe(24);
      expect(apron(w, mode)).toBeGreaterThanOrEqual(24);
      for (let y = f.y0; y <= f.y1; y++)
        for (let x = f.x0; x <= f.x1; x++) {
          const t = w.tileAt(x, y)!;
          if (mode === 'rehouse') {
            if (t.zone === ZoneType.Residential) {
              expect(t.level).toBe(2);
              expect(t.wealth).toBe(1);
            }
          } else {
            expect(t.zone).toBe(ZoneType.None);
            expect(t.road).toBe(false);
          }
        }
    }
  });

  it('an effect whose district is not owned does nothing', () => {
    const w = World.generate(2091, 'Bare', undefined, R);
    expect(clearBrownfield(w)).toBe(0);
    expect(clearRuins(w)).toBe(0);
    expect(drainReeds(w)).toBe(0);
    expect(apron(w, 'clear')).toBe(0);
  });
});
