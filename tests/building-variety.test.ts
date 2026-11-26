// WP-4 (MEGACITY §6.1–§6.3, §5.6, §9.2, §11.3 V1, §11.5): building variety. Every kit body × style × tier × parcel ×
// parameter set paints cleanly; the eligibility matrix floors; every new building type, look and ending landmark; the
// height truth; the V1 counts on synthetic districts; look 0 is today's art on a migrated city.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_ORDER } from '../src/game/config';
import { CLASSIC_TOPS, classicId } from '../src/game/heights';
import { DISTRICT_KINDS, ZoneType, type Building, type BuildingType, type DistrictKind, type SaveData, type Tile } from '../src/game/types';
import { World } from '../src/game/world';
import { installCanvasMock, mockContext, mockStats, resetMockStats } from './canvas-mock';

const uninstall = installCanvasMock();
afterAll(() => uninstall());
type Art = typeof import('../src/render/buildings');
type Kit = typeof import('../src/render/art/kit');
type Vert = typeof import('../src/render/art/vertical');
let art: Art;
let kit: Kit;
let vert: Vert;
beforeAll(async () => {
  art = await import('../src/render/buildings');
  kit = await import('../src/render/art/kit');
  vert = await import('../src/render/art/vertical');
});

const tile = (zone: number, level: number, variant: number, wealth: 0 | 1 | 2, extra: Partial<Tile> = {}): Tile =>
  ({ terrain: 0, road: false, zone, level, abandoned: false, variant, buildingId: -1, powered: true, age: 400, roadKind: 0, wealth, elev: 0, ground: 0, ...extra }) as Tile;
let time = 0;
const env = (night: number, zoom: number) => ({ time: (time += 1), night, zoom, quality: 'high' as const });
const SHAPE_WH = [
  [1, 1],
  [2, 1],
  [2, 2],
] as const;

describe('the eligibility matrix (§6.1 floors)', () => {
  it('44 templates; every single cell ≥ 6 distinct silhouettes, every pair and quad cell ≥ 4 templates, at every style and tier', () => {
    expect(kit.TEMPLATES[0]).toHaveLength(16);
    expect(kit.TEMPLATES[1]).toHaveLength(16);
    expect(kit.TEMPLATES[2]).toHaveLength(12);
    for (const style of DISTRICT_KINDS)
      for (let zone = 1; zone <= 3; zone++)
        for (let level = 1; level <= 3; level++)
          for (let shape = 0; shape < 3; shape++)
            for (const tier of [0, 1, 2]) {
              const { all } = kit.cellBodies(zone, level, shape, tier, style);
              const forms = new Set(all.map((b) => b.form));
              const templates = new Set(all.filter((b) => b.form >= kit.KIT_FIRST && b.form < kit.SIL_FIRST).map((b) => b.form));
              if (shape === 0) expect(forms.size, `${style} z${zone} S${level} t${tier}`).toBeGreaterThanOrEqual(6);
              else expect(templates.size, `${style} z${zone} ${shape === 1 ? 'P' : 'Q'}${level} t${tier}`).toBeGreaterThanOrEqual(4);
              // Each template brings its 4 parameter sets.
              for (const f of templates) expect(all.filter((b) => b.form === f)).toHaveLength(4);
            }
  });

  it('every style but Charter Shore has its own silhouettes (2–4: the Shoals adds a tower for its skyline), only in its district', () => {
    expect(kit.silhouettes('shore')).toHaveLength(0);
    for (const style of DISTRICT_KINDS.filter((k) => k !== 'shore')) {
      const sil = kit.silhouettes(style);
      expect(sil.length, style).toBeGreaterThanOrEqual(2);
      expect(sil.length, style).toBeLessThanOrEqual(4);
      // A shore cell never offers another style's silhouettes.
      expect(kit.cellBodies(1, 1, 0, 0, 'shore').all.some((b) => b.form >= kit.SIL_FIRST)).toBe(false);
    }
  });
});

describe('sweep: every kit body paints cleanly (§11.5 WP-4)', () => {
  it('every body × style × parcel shape × parameter set, at $ and $$$, day and night, near and far', () => {
    const ctx = mockContext();
    let bodies = 0;
    for (const style of DISTRICT_KINDS)
      for (let zone = 1; zone <= 3; zone++)
        for (let level = 1; level <= 3; level++)
          for (let shape = 0; shape < 3; shape++)
            for (const tier of [0, 2] as const) {
              const { all } = kit.cellBodies(zone, level, shape, tier, style);
              const [W, H] = SHAPE_WH[shape];
              for (const b of all) {
                if (b.form < kit.KIT_FIRST && b.seed > 0 && (style !== 'shore' || tier !== 0)) continue;
                bodies++;
                const v = b.form < kit.KIT_FIRST ? b.form | ((bodies & 1) << 3) : (bodies * 7) & 15;
                for (const night of [0, 1]) {
                  resetMockStats();
                  art.drawZoneBody(ctx, 0, 0, tile(zone, level, v, tier), b, env(night, night ? 0.4 : 1), { kind: style, variant: bodies % 4, shape, W, H });
                  expect(mockStats.errors, `${style} z${zone} L${level} shape ${shape} form ${b.form}.${b.seed} night ${night}`).toEqual([]);
                  expect(mockStats.draws).toBeGreaterThan(0);
                }
              }
            }
    expect(bodies).toBeGreaterThan(4000);
  }, 60_000);

  it('abandoned, dark, under construction and ghost kit bodies paint cleanly', () => {
    const ctx = mockContext();
    for (const style of ['shore', 'sunk', 'bazaar'] as DistrictKind[])
      for (let zone = 1; zone <= 3; zone++)
        for (let shape = 0; shape < 3; shape++) {
          const [W, H] = SHAPE_WH[shape];
          const b = kit.cellBodies(zone, 2, shape, 1, style).all.find((x) => x.form >= kit.KIT_FIRST)!;
          for (const extra of [{ abandoned: true }, { powered: false }, { age: 5 }] as Partial<Tile>[]) {
            resetMockStats();
            art.drawZoneBody(ctx, 0, 0, tile(zone, 2, 3, 1, extra), b, env(1, 1), { kind: style, shape, W, H });
            expect(mockStats.errors).toEqual([]);
          }
          resetMockStats();
          art.drawZoneBody(ctx, 0, 0, tile(zone, 2, 3, 1), b, { ...env(0, 1), ghost: true }, { kind: style, shape, W, H });
          expect(mockStats.errors).toEqual([]);
        }
  });

  it('the 15 takeover bodies (5 languages × Hab, Market, quad) and the Lamplight lantern roof paint and reach the height truth', () => {
    const ctx = mockContext();
    const langs = ['basalt', 'nacre', 'undertow', 'kites', 'board'] as const;
    for (const lang of langs)
      for (const [zone, shape] of [
        [1, 0],
        [2, 0],
        [1, 2],
      ] as const)
        for (let seed = 0; seed < 4; seed++)
          for (const night of [0, 1]) {
            resetMockStats();
            const [W, H] = SHAPE_WH[shape];
            art.drawZoneBody(ctx, 0, 0, tile(zone, 3, seed * 3, 0), { form: 0, seed }, env(night, 1), { lang, shape, W, H });
            expect(mockStats.errors, `${lang} ${zone} ${shape}`).toEqual([]);
            const info = art.zoneBodyInfo(zone, 3, seed * 3, 0, { form: 0, seed }, { lang, shape });
            expect(info.top, `${lang} z${zone} shape ${shape}`).toBeGreaterThanOrEqual(info.truth - 1);
          }
    resetMockStats();
    art.drawZoneBody(ctx, 0, 0, tile(1, 3, 2, 1), { form: 2, seed: 0 }, env(1, 1), { lantern: true });
    expect(mockStats.errors).toEqual([]);
    expect(art.zoneBodyInfo(1, 3, 2, 1, { form: 2, seed: 0 }, { lantern: true }).sig).toBeGreaterThan(0);
  });
});

describe('height truth (§6.1 heights, heights.ts)', () => {
  it("every kit body's mass reaches the tile's classic top (heightOf): within −1 / +24 px for every cell, style and parameter set", () => {
    let checked = 0;
    for (const style of ['shore', 'shoals', 'skeleton', 'tarmac', 'bazaar'] as DistrictKind[])
      for (let zone = 1; zone <= 3; zone++)
        for (let level = 1; level <= 3; level++)
          for (let shape = 0; shape < 3; shape++)
            for (const b of kit.cellBodies(zone, level, shape, 0, style).all) {
              if (b.form < kit.KIT_FIRST) continue;
              for (const v of [0, 5, 11]) {
                const info = art.zoneBodyInfo(zone, level, v, 0, b, { kind: style, shape });
                const T = CLASSIC_TOPS[classicId(zone, level, v, 0)];
                expect(info.truth).toBe(T);
                expect(info.top, `${style} z${zone} L${level} s${shape} form ${b.form}.${b.seed} v${v}`).toBeGreaterThanOrEqual(T - 1);
                expect(info.top, `${style} z${zone} L${level} s${shape} form ${b.form}.${b.seed} v${v}`).toBeLessThanOrEqual(T + 24);
                checked++;
              }
            }
    expect(checked).toBeGreaterThan(2000);
  });

  it('below LOD a template keys on its height band: its mass stays within half a band of the truth (6 px at L3, so a tube still meets the roof and clears the lane)', () => {
    let checked = 0;
    for (const style of ['shore', 'flats', 'bazaar'] as DistrictKind[])
      for (let zone = 1; zone <= 3; zone++)
        for (let level = 1; level <= 3; level++)
          for (const b of kit.cellBodies(zone, level, 0, 0, style).all) {
            if (b.form < kit.KIT_FIRST) continue;
            const l = kit.lodBody(zone, level, 0, 0, style, b);
            for (let v = 0; v < 16; v++) {
              const T = CLASSIC_TOPS[classicId(zone, level, v, 0)];
              const full = art.zoneBodyInfo(zone, level, v, 0, l, { kind: style });
              const lod = art.zoneBodyInfo(zone, level, v, 0, l, { kind: style, lod: true });
              // The mass reaches at least half a band under the truth (6 px at L3, so a tube attached 6 px under the true
              // roof meets the drawn body; 12 px at L1–L2, far under every tube); a crown may rise past it as at full
              // detail (+24), plus the band.
              const half = level >= 3 ? 6 : 12;
              const tag = `${style} z${zone} L${level} form ${l.form} v${v}`;
              expect(lod.top, tag).toBeGreaterThanOrEqual(T - half - 1);
              expect(lod.top, tag).toBeLessThanOrEqual(Math.max(full.top, T + 24) + 2 * half);
              expect(lod.truth).toBe(T);
              checked++;
            }
          }
    expect(checked).toBeGreaterThan(500);
  });

  it('below LOD the megacity fixture draws far fewer distinct zone bodies than at full detail (the LOD set, §6.1)', async () => {
    const { megacityWorld } = await import('./megacity-fixture');
    const { parcelAt } = await import('../src/game/parcels');
    const w = megacityWorld(3, 9, 7);
    const lod = new Set<number>();
    const full = new Set<number>();
    let bodies = 0;
    const env = { world: w, artOffset: 64 };
    for (let y = 0; y < w.N; y++)
      for (let x = 0; x < w.N; x++) {
        const t = w.tiles[y * w.N + x];
        if (t.zone === ZoneType.None || t.level < 1 || t.buildingId >= 0) continue;
        const p = parcelAt(w, x, y);
        if (p && (p.hx !== x || p.hy !== y)) continue;
        bodies++;
        lod.add(art.zoneBodyAt(t, x, y, p, { ...env, zoom: 0.4 }).id);
        full.add(art.zoneBodyAt(t, x, y, p, { ...env, zoom: 1 }).id);
      }
    // Measured: 10,289 bodies, 8,487 full-detail and 4,011 LOD models (7,337 before the LOD set keyed on height bands).
    console.log(`[LOD set] ${bodies} bodies: ${full.size} full-detail models, ${lod.size} LOD models`);
    expect(bodies).toBeGreaterThan(9000);
    expect(lod.size).toBeLessThan(0.42 * bodies);
    expect(lod.size).toBeLessThan(0.5 * full.size);
  });

  it("today's forms in any style keep their exact top; zoneBuildingHeight is the truth whatever body a tile picked", () => {
    for (const style of DISTRICT_KINDS)
      for (let zone = 1; zone <= 3; zone++)
        for (let level = 1; level <= 3; level++)
          for (let f = 0; f < 8; f++) {
            const info = art.zoneBodyInfo(zone, level, f, 0, { form: f, seed: (f + zone) & 3 }, { kind: style });
            expect(info.top).toBeCloseTo(CLASSIC_TOPS[classicId(zone, level, f, 0)], 1);
          }
    expect(art.zoneBuildingHeight(tile(1, 3, 6, 0))).toBeCloseTo(CLASSIC_TOPS[classicId(1, 3, 6, 0)], 1);
    // A parcel member reads its parcel's drawn level.
    expect(art.zoneBuildingHeight(tile(1, 3, 6, 0), { hx: 1, hy: 1, x: 0, y: 0, w: 2, h: 2, level: 2, tier: 0 })).toBeCloseTo(CLASSIC_TOPS[classicId(1, 2, 6, 0)], 1);
  });
});

describe('V1 on synthetic districts (§11.3)', () => {
  /** Pick a body for every tile of an n × n block with random cells; identity = the full body key. */
  function grid(style: DistrictKind, n: number, seed: number, l3 = 0.3) {
    const ids: string[] = [];
    const cellOf: string[] = [];
    const silFlags: boolean[] = [];
    let r = seed;
    const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const zone = rnd() < 0.6 ? 1 : rnd() < 0.6 ? 2 : 3;
        const level = rnd() < l3 ? 3 : rnd() < 0.5 ? 2 : 1;
        const tier = rnd() < 0.5 ? 0 : rnd() < 0.7 ? 1 : 2;
        const variant = Math.floor(rnd() * 256);
        const b = kit.pickForm(zone, level, 0, tier, style, x, y, variant, variant & 7, (variant >> 3) & 1);
        const palBit = (variant >> 3) & 1;
        ids.push(`${zone}.${level}.${tier}.${b.form}.${b.seed}.${palBit}`);
        cellOf.push(`${zone}.${level}.${tier}`);
        silFlags.push(b.form >= kit.SIL_FIRST);
      }
    return { ids, cellOf, silFlags };
  }

  it('no identical body within r = 2 and an adjacent-identical rate of 0 (≤ 3%) on every style', () => {
    for (const style of DISTRICT_KINDS) {
      const n = 48;
      const { ids } = grid(style, n, 17 + style.length);
      let pairs = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              if (!dx && !dy) continue;
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              if (ids[y * n + x] === ids[yy * n + xx]) pairs++;
            }
      expect(pairs, style).toBe(0);
    }
  });

  it("no body is more than 15% of its cell's tiles; style silhouettes take ≥ 25% of their district's bodies", () => {
    for (const style of DISTRICT_KINDS) {
      const n = 64;
      const { ids, cellOf, silFlags } = grid(style, n, 5 + style.length * 3, 0.15);
      const byCell = new Map<string, Map<string, number>>();
      ids.forEach((id, i) => {
        const m = byCell.get(cellOf[i]) ?? new Map<string, number>();
        m.set(id, (m.get(id) ?? 0) + 1);
        byCell.set(cellOf[i], m);
      });
      for (const [cell, m] of byCell) {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        if (total < 40) continue;
        const most = Math.max(...m.values());
        expect(most / total, `${style} cell ${cell}`).toBeLessThanOrEqual(0.15);
      }
      if (style === 'shore') continue;
      const share = silFlags.filter(Boolean).length / silFlags.length;
      expect(share, style).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('no cell leans on one silhouette: one template (any parameter set) is at most a third of a cell', () => {
    for (const style of DISTRICT_KINDS)
      for (let zone = 1; zone <= 3; zone++)
        for (let level = 1; level <= 3; level++)
          for (let shape = 0; shape < 3; shape++) {
            const count = new Map<number, number>();
            let n = 0;
            for (let y = 0; y < 48; y++)
              for (let x = 0; x < 48; x++) {
                const h = (x * 7919 + y * 104729) & 255;
                const b = kit.pickForm(zone, level, shape, 0, style, x, y, h, h & 7, (h >> 3) & 1);
                if (b.form >= kit.SIL_FIRST) count.set(b.form, (count.get(b.form) ?? 0) + 1);
                n++;
              }
            for (const [form, c] of count) expect(c / n, `${style} z${zone} L${level} shape ${shape} form ${form}`).toBeLessThanOrEqual(0.34);
          }
  });

  it('distinct bodies on a 390×844 phone view at zoom 1 stay ≤ 260; below LOD a cell collapses to ≤ 4 kit silhouettes', () => {
    // At zoom 1 a portrait phone shows ≈ 7 × 27 diamond rows: ≤ 200 tiles, so ≤ 200 distinct bodies.
    const { ids } = grid('bazaar', 14, 3);
    expect(new Set(ids).size).toBeLessThanOrEqual(260);
    for (let zone = 1; zone <= 3; zone++)
      for (let level = 1; level <= 3; level++)
        for (let shape = 0; shape < 3; shape++) {
          const lod = new Set<number>();
          for (const b of kit.cellBodies(zone, level, shape, 0, 'flats').all) {
            const l = kit.lodBody(zone, level, shape, 0, 'flats', b);
            if (l.form >= kit.KIT_FIRST && l.form < kit.SIL_FIRST) lod.add(l.form * 4 + l.seed);
          }
          expect(lod.size).toBeLessThanOrEqual(4);
        }
  });
});

describe('services, landmarks, looks and standing (§6.2, §6.3, §9.2)', () => {
  const building = (type: BuildingType, extra: Partial<Building> = {}): Building =>
    ({ id: 900 + BUILDING_ORDER.indexOf(type), type, x: 10, y: 10, size: BUILDINGS[type].size, powered: true, offline: 0, stage: 3, buildDays: 0, ...extra }) as Building;
  /** A world view whose district kind is `kind` everywhere. */
  const worldOf = (kind: DistrictKind, favor: Record<string, number> = {}): World => {
    const w = new World(7, 'Looks', undefined, 3);
    for (const [f, v] of Object.entries(favor)) (w.story.favor as Record<string, number>)[f] = v;
    const view = Object.create(w) as World;
    (view as unknown as { kindAt: () => DistrictKind }).kindAt = () => kind;
    return view;
  };

  it('every building type and every look paints lit and dark, day and night (the 27 new types included)', () => {
    const ctx = mockContext();
    const cases: Partial<Building>[] = [{}];
    for (const type of BUILDING_ORDER) {
      const extras: Partial<Building>[] =
        type === 'spire'
          ? [
              { sponsor: 'nacre', look: 0 },
              { sponsor: 'nacre', look: 1 },
              { sponsor: 'nacre', look: 2 },
              { sponsor: 'nacre', look: 3 },
              { sponsor: 'basalt', look: 0 },
              { sponsor: 'basalt', look: 1 },
              { sponsor: 'basalt', look: 2 },
              { sponsor: 'none', look: 0 },
              { sponsor: 'none', look: 1 },
              { sponsor: 'none', look: 2 },
            ]
          : type === 'stack'
            ? (['foundry', 'glare', 'nest', 'commons', 'salvage', 'lamp'] as const).flatMap((crown) => [0, 1, 2].map((look) => ({ crown, look: look as 0 | 1 | 2 })))
            : ['foundry', 'glarewall', 'tidemarket', 'roost', 'commons'].includes(type)
              ? [{ look: 0 }, { look: 1 }, { look: 2 }]
              : type === 'pumphouse'
                ? [{ reclaim: 40 }, { reclaim: 0 }]
                : cases;
      for (const extra of extras)
        for (const powered of [true, false])
          for (const night of [0, 1]) {
            resetMockStats();
            art.drawServiceBuilding(ctx, 0, 0, building(type, { powered, ...extra }), env(night, night ? 0.4 : 1));
            expect(mockStats.errors, `${type} ${JSON.stringify(extra)} ${powered} ${night}`).toEqual([]);
            expect(mockStats.draws).toBeGreaterThan(0);
          }
    }
  });

  it('look 0 is today: v3 Spires (no sponsor), crowns, faction buildings, Arcology and reactors resolve to the Step 0b ids', () => {
    for (const type of ['spire', 'foundry', 'glarewall', 'tidemarket', 'roost', 'commons', 'arcology', 'reactor', 'clinic', 'plaza', 'precinct', 'memorial'] as BuildingType[]) {
      const info = art.serviceModelInfo(type, building(type), null);
      expect(info.look, type).toBe(0);
      expect(info.style, type).toBe(0);
      expect(info.variant, type).toBe(0);
      expect(info.seed).toBe(art.serviceSeed(type));
    }
    expect(art.serviceModelInfo('spire', building('spire'), null).top).toBeGreaterThan(280);
    for (const crown of ['foundry', 'glare', 'nest', 'commons'] as const) {
      const info = art.serviceModelInfo('stack', building('stack', { crown }), null);
      expect(info.look).toBe(0);
      expect(info.style).toBe(0);
    }
  });

  it('a migrated city keeps its palettes and today\'s Spires, crowns and faction buildings', () => {
    const fixtures = import.meta.glob('./fixtures/v3-expansion.json', { import: 'default', eager: true }) as Record<string, SaveData>;
    const data = JSON.parse(JSON.stringify(fixtures['./fixtures/v3-expansion.json'])) as SaveData;
    const w = World.deserialize(data);
    let n = 0;
    for (const b of w.buildings.values()) {
      const info = art.serviceModelInfo(b.type, b, w);
      if (b.type === 'stack' || b.type === 'spire' || BUILDINGS[b.type].category === 'faction' || b.type === 'arcology') {
        expect(info.look % 4, b.type).toBe(0);
        expect(info.style, b.type).toBe(0);
      }
      n++;
    }
    expect(n).toBeGreaterThan(0);
    // Zone tiles keep their palette: a body's palette is the tile's own palette bit, in every pick.
    const N = w.N;
    let zones = 0;
    for (let i = 0; i < w.area; i++) {
      const t = w.tiles[i];
      if (t.zone === ZoneType.None || t.level < 1) continue;
      const body = art.zoneBodyAt(t, i % N, Math.floor(i / N), null, { world: w, artOffset: 64, zoom: 1 });
      expect(body.kind).toBe('shore');
      if (body.form < 8) expect(body.form).toBe(t.variant & 7);
      zones++;
    }
    expect(zones).toBeGreaterThan(50);
  });

  it('style looks: clinic, precinct, plaza, reactor (3 groups) and the Arcology (5 looks); the Sunk Memorial', () => {
    const groups = new Map<string, Set<number>>();
    for (const kind of DISTRICT_KINDS) {
      const w = worldOf(kind);
      for (const type of ['clinic', 'precinct', 'plaza', 'reactor', 'arcology', 'memorial'] as BuildingType[]) {
        const info = art.serviceModelInfo(type, building(type), w);
        const s = groups.get(type) ?? new Set<number>();
        s.add(info.style);
        groups.set(type, s);
      }
    }
    for (const t of ['clinic', 'precinct', 'plaza', 'reactor']) expect(groups.get(t)!.size, t).toBe(3);
    expect(groups.get('arcology')!.size).toBe(5);
    expect(groups.get('memorial')!.size).toBe(2);
    // Arcology looks keep the skybridge facade: every look reaches ≥ 186 px (its roof 180).
    for (const kind of DISTRICT_KINDS) expect(art.serviceModelInfo('arcology', building('arcology'), worldOf(kind)).top, kind).toBeGreaterThanOrEqual(186);
  });

  it('every Spire look keeps the Spire height (≥ 206 facade for its roof 200, top ≤ 300); crowns stay near 232', () => {
    for (const [sponsor, n] of [
      ['nacre', 4],
      ['basalt', 3],
      ['none', 3],
    ] as const)
      for (let look = 0; look < n; look++) {
        const info = art.serviceModelInfo('spire', building('spire', { sponsor, look: look as 0 | 1 | 2 | 3 }), null);
        expect(info.top, `${sponsor} ${look}`).toBeGreaterThanOrEqual(240);
        expect(info.top, `${sponsor} ${look}`).toBeLessThanOrEqual(300);
      }
    for (const crown of ['foundry', 'glare', 'nest', 'commons', 'salvage', 'lamp'] as const)
      for (const look of [0, 1, 2] as const) {
        const top = art.serviceModelInfo('stack', building('stack', { crown, look }), null).top;
        expect(top, `${crown} ${look}`).toBeGreaterThanOrEqual(200);
        expect(top, `${crown} ${look}`).toBeLessThanOrEqual(320);
      }
  });

  it('standing: Allied and Hostile factions light their buildings, crowns, landmarks and sponsored Spires differently', () => {
    const allied = worldOf('shore', { basalt: 90, nacre: 90 });
    const hostile = worldOf('shore', { basalt: -90, nacre: -90 });
    for (const [type, extra] of [
      ['foundry', {}],
      ['hexworks', {}],
      ['spire', { sponsor: 'basalt' }],
      ['stack', { crown: 'glare' }],
    ] as [BuildingType, Partial<Building>][]) {
      const a = art.serviceModelInfo(type, building(type, extra), allied);
      const h = art.serviceModelInfo(type, building(type, extra), hostile);
      const n = art.serviceModelInfo(type, building(type, extra), null);
      expect(a.standing, type).toBe(1);
      expect(h.standing, type).toBe(2);
      expect(n.standing, type).toBe(0);
      expect(new Set([a.id, h.id, n.id]).size, type).toBe(3);
    }
  });

  it('faction signatures register on their designs (furnace, halo, clock, swing, tips, lantern) and draw live', () => {
    const sigs = (type: BuildingType, extra: Partial<Building>) => art.serviceModelInfo(type, building(type, extra), null).sig;
    expect(sigs('spire', { sponsor: 'basalt', look: 0 })).toBeGreaterThan(0);
    expect(sigs('spire', { sponsor: 'nacre', look: 1 })).toBeGreaterThan(0);
    expect(sigs('commons', { look: 2 })).toBeGreaterThan(0);
    expect(sigs('tidemarket', { look: 1 })).toBeGreaterThan(0);
    expect(sigs('roost', { look: 1 })).toBeGreaterThan(0);
    expect(sigs('lampchoir', {})).toBeGreaterThan(0);
    expect(sigs('beacon', {})).toBeGreaterThan(0);
    expect(sigs('recordtower', {})).toBeGreaterThan(0);
  });

  it('ending landmarks have a past look, the Still Square a Lamp Square; the pump hall its seven looks', () => {
    const ended = (ending: string, variant: string | null = null) => {
      const w = new World(9, 'End', undefined, 3);
      (w.story as unknown as { ending: string }).ending = ending;
      (w.story as unknown as { endingVariant: string | null }).endingVariant = variant;
      return w;
    };
    for (const [type, own] of [
      ['gantry', 'ironwork'],
      ['glasssmile', 'pearl'],
      ['breadpier', 'lowcrown'],
      ['recordtower', 'ledger'],
      ['stillsquare', 'quiet'],
    ] as [BuildingType, string][]) {
      const cur = art.serviceModelInfo(type, building(type), ended(own));
      const past = art.serviceModelInfo(type, building(type), ended(own === 'ironwork' ? 'pearl' : 'ironwork'));
      expect(cur.variant, type).toBe(0);
      expect(past.variant, type).toBe(1);
      expect(cur.id).not.toBe(past.id);
    }
    expect(art.serviceModelInfo('stillsquare', building('stillsquare'), ended('quiet', 'lamplight')).variant).toBe(2);
    const ctx = mockContext();
    const flags = ['', 'published', 'buried', 'leashed', 'hallPoured', 'fullRecall', 'hiddenByTuning'];
    const looks = new Set<number>();
    for (const f of flags) {
      const w = new World(11, 'Hall', undefined, 3);
      if (f) (w.story.flags as Record<string, unknown>)[f] = true;
      const info = art.serviceModelInfo('pumphall', building('pumphall'), w);
      looks.add(info.look);
      resetMockStats();
      art.drawServiceBuilding(ctx, 0, 0, building('pumphall'), { ...env(1, 1), world: w });
      expect(mockStats.errors).toEqual([]);
    }
    expect(looks.size).toBe(7);
  });
});

describe('skybridge skins and walkers (§5.6)', () => {
  it('eight skins × lit / dark × day / night × walkers paint cleanly; the cable span sags at mid-span', () => {
    const ctx = mockContext();
    const e = { time: 3, night: 0, zoom: 1, lod: false, quality: 'high' as const };
    for (let skin = 0; skin < vert.SKIN_COUNT; skin++)
      for (const active of [true, false])
        for (const night of [0, 1])
          for (const walkers of [0, 3]) {
            resetMockStats();
            vert.drawSkybridgeTile(ctx, 0, 0, skin % 2 === 0, 120, active, skin === 5, 0.5, { ...e, night }, 0, -0.2, 1, skin, walkers);
            expect(mockStats.errors).toEqual([]);
            expect(mockStats.draws).toBeGreaterThan(2);
          }
    resetMockStats();
    vert.drawSkybridgeSpan(ctx, { ax: 2, ay: 3, bx: 8, by: 3, gap: 5, top: 150, active: true }, 'kites', { time: 1, night: 1, zoom: 1, quality: 'high' });
    expect(mockStats.errors).toEqual([]);
    expect(vert.skinIndex('basalt')).toBe(1);
    expect(vert.skinIndex('nacre')).toBe(2);
    expect(vert.skinIndex(undefined)).toBe(0);
  });

  it('skinOf: a faction crown first, then a faction building, a Spire sponsor, the lower anchor\'s district, glass', () => {
    const tiles = new Map<string, number>();
    const buildings = new Map<number, { type: string; crown?: string; sponsor?: string }>();
    const world = (kind: DistrictKind) => ({ tileAt: (x: number, y: number) => ({ buildingId: tiles.get(`${x},${y}`) ?? -1 }), buildings, kindAt: () => kind });
    const l = { ax: 1, ay: 1, bx: 5, by: 1 };
    expect(vert.skinOf(world('shore'), l)).toBe(0);
    expect(vert.skinOf(world('flats'), l)).toBe(1);
    expect(vert.skinOf(world('sunk'), l)).toBe(4);
    expect(vert.skinOf(world('reedmere'), l)).toBe(7);
    buildings.set(1, { type: 'spire', sponsor: 'nacre' });
    tiles.set('5,1', 1);
    expect(vert.skinOf(world('flats'), l)).toBe(2);
    buildings.set(2, { type: 'roost' });
    tiles.set('1,1', 2);
    expect(vert.skinOf(world('flats'), l)).toBe(5);
    buildings.set(3, { type: 'stack', crown: 'lamp' });
    tiles.set('5,1', 3);
    expect(vert.skinOf(world('flats'), l)).toBe(6);
  });
});

describe('the cross-family fallback (§6.1, sprites.ts)', () => {
  it('a kit body never painted shows its classic body while the frame is over budget', async () => {
    const { SpriteCache } = await import('../src/render/art/sprites');
    const c = new SpriteCache();
    c.newFrame();
    c.budgetMs = -1; // already over budget
    const classic = { canvas: document.createElement('canvas'), ox: 0, oy: 0, w: 1, h: 1, scale: 1, bytes: 4, used: 0, key: 0, family: 0 };
    let painted = 0;
    const s = c.get(
      1,
      1,
      () => {
        painted++;
        return classic;
      },
      () => classic,
    );
    expect(s).toBe(classic);
    expect(painted).toBe(0);
    expect(c.fallbacks).toBe(1);
    // Without a fallback a never-painted body paints at once (today's rule).
    c.get(2, 2, () => {
      painted++;
      return classic;
    });
    expect(painted).toBe(1);
  });
});

describe('V1 in a scripted pan over the megacity fixture (§6.1 targets, §11.4 M7)', () => {
  type Row = { maxBodies: number; maxMB: number; viewMB: number; tiles: number; fallbackFramesAfterStop: number; paintP95: number; capMB: number; budgetMs: number; adjIdentical: number; maxCellShare: number };

  /**
   * Render a scripted pan with the real Renderer on the canvas mock: `frames` frames moving across the fixture, then 40
   * still frames. Returns the per-frame maxima, the frames still showing a cross-family fallback body after the stop, the
   * paint ms p95 (Node with the mock: a proxy, the browser numbers are Step 9's), and the on-screen identity numbers.
   */
  async function pan(o: { region: 3 | 5; slots: number; w: number; h: number; dpr: number; pc: boolean; zoom: number; frames?: number }): Promise<Row> {
    const g0 = globalThis as Record<string, unknown>;
    const hadWindow = 'window' in g0;
    const prevWindow = g0.window;
    g0.window = { devicePixelRatio: o.dpr, innerWidth: o.w, innerHeight: o.h };
    const dev = await import('../src/game/device');
    dev.resetDeviceProfile({ finePointer: o.pc, mobileOS: !o.pc, shortSide: o.pc ? 1080 : 390, cores: 8, memoryGB: 8, benchFactor: 1 } as Parameters<typeof dev.resetDeviceProfile>[0]);
    try {
      const { Game } = await import('../src/game/game');
      const { Renderer } = await import('../src/render/renderer');
      const { Camera } = await import('../src/render/camera');
      const { megacityWorld } = await import('./megacity-fixture');
      const { parcelAt } = await import('../src/game/parcels');
      const g = new Game();
      g.restore(megacityWorld(o.region, o.slots, 7).serialize());
      g.setSpeed(0);
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.width = o.w;
      canvas.height = o.h;
      const cam = new Camera(g.world.N);
      const r = new Renderer(canvas, g, cam);
      art.clearBuildingCache();
      art.setArtStats(true);
      const c0 = Math.floor(g.world.N / 2);
      let t = 10;
      let maxBodies = 0;
      let maxBytes = 0;
      let viewBytes = 0;
      const paint: number[] = [];
      const frames = o.frames ?? 60;
      cam.zoom = o.zoom;
      for (let f = 0; f < frames; f++) {
        cam.zoom = o.zoom;
        cam.centerOnTile(c0 - 12 + f * 0.4, c0 - 8 + f * 0.25);
        r.render(1 / 60, (t += 1 / 60));
        const s = art.artFrameStats();
        maxBodies = Math.max(maxBodies, s.bodies);
        maxBytes = Math.max(maxBytes, s.bytes);
        viewBytes = Math.max(viewBytes, s.viewBytes);
        paint.push(s.paintMs);
      }
      let fallbackFrames = 0;
      for (let f = 0; f < 40; f++) {
        r.render(1 / 60, (t += 1 / 60));
        const s = art.artFrameStats();
        if (s.fallbacks > 0) fallbackFrames = f + 1;
        maxBytes = Math.max(maxBytes, s.bytes);
        viewBytes = Math.max(viewBytes, s.viewBytes);
        paint.push(s.paintMs);
      }
      const last = art.artFrameStats();
      paint.sort((a, b) => a - b);
      // On-screen identity: every developed zone tile of a 24 × 24 window at the stop maps to the body it draws (a parcel
      // member to its head's); 8-neighbour pairs in different lots drawing the same body, and the largest body share per cell
      // (a 40 × 40 window: about what a phone shows at zoom 0.55).
      const w = g.world;
      const ids = new Map<number, { id: number; lot: number; cell: string }>();
      const cx = Math.round(c0 - 12 + (frames - 1) * 0.4);
      const cy = Math.round(c0 - 8 + (frames - 1) * 0.25);
      const envA = { artOffset: 64 * ((w.region - 1) >> 1), world: w, zoom: o.zoom };
      for (let y = cy - 20; y < cy + 20; y++)
        for (let x = cx - 20; x < cx + 20; x++) {
          const tl = w.tileAt(x, y);
          if (!tl || tl.zone === ZoneType.None || tl.level < 1 || tl.buildingId >= 0) continue;
          const p = parcelAt(w, x, y);
          const hx = p ? p.hx : x;
          const hy = p ? p.hy : y;
          const head = w.tileAt(hx, hy)!;
          const b = art.zoneBodyAt(head, hx, hy, p, envA);
          ids.set(y * w.N + x, { id: b.id, lot: hy * w.N + hx, cell: `${tl.zone}.${p ? p.level : tl.level}.${p ? (p.w * p.h > 2 ? 2 : 1) : 0}` });
        }
      let pairs = 0;
      let same = 0;
      for (const [i, a] of ids) {
        const x = i % w.N;
        const y = Math.floor(i / w.N);
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          const b = ids.get((y + dy) * w.N + x + dx);
          if (!b || b.lot === a.lot) continue;
          pairs++;
          if (b.id === a.id) same++;
        }
      }
      const byCell = new Map<string, Map<number, Set<number>>>();
      for (const a of ids.values()) {
        const m = byCell.get(a.cell) ?? new Map<number, Set<number>>();
        const lots = m.get(a.id) ?? new Set<number>();
        lots.add(a.lot);
        m.set(a.id, lots);
        byCell.set(a.cell, m);
      }
      let maxCellShare = 0;
      for (const m of byCell.values()) {
        const total = [...m.values()].reduce((s, l) => s + l.size, 0);
        if (total < 24) continue;
        maxCellShare = Math.max(maxCellShare, Math.max(...[...m.values()].map((l) => l.size)) / total);
      }
      return {
        maxBodies,
        maxMB: maxBytes / 2 ** 20,
        viewMB: viewBytes / 2 ** 20,
        tiles: ids.size,
        fallbackFramesAfterStop: fallbackFrames,
        paintP95: paint[Math.floor(paint.length * 0.95)] ?? 0,
        capMB: last.capBytes / 2 ** 20,
        budgetMs: last.budgetMs,
        adjIdentical: pairs ? same / pairs : 0,
        maxCellShare,
      };
    } finally {
      art.setArtStats(false);
      art.setSpriteLimits(null);
      dev.resetDeviceProfile(null);
      if (hadWindow) g0.window = prevWindow;
      else delete g0.window;
    }
  }

  it('phone 390×844: zoom 1 at DPR 2 ≤ 260 distinct bodies and ≤ 26 MB; zoom 0.55 and 0.4 within the cache; fallback bodies gone ≤ 30 frames after the pan; adjacent-identical ≤ 3%, no body over 15% of its cell on screen (a third below LOD)', async () => {
    const out: Record<string, Row> = {};
    for (const zoom of [1, 0.55, 0.4]) {
      const row = await pan({ region: 3, slots: 9, w: 390, h: 844, dpr: 2, pc: false, zoom });
      out[`phone z${zoom}`] = row;
      expect(row.maxMB, `z${zoom}`).toBeLessThanOrEqual(row.capMB);
      expect(row.tiles, `z${zoom}`).toBeGreaterThan(400);
      expect(row.maxCellShare, `z${zoom}`).toBeGreaterThan(0);
      expect(row.fallbackFramesAfterStop, `z${zoom}`).toBeLessThanOrEqual(30);
      expect(row.adjIdentical, `z${zoom}`).toBeLessThanOrEqual(0.03);
      // Below LOD a cell collapses to its LOD set (§6.1: ≤ 4 templates per cell and style, by palette and height band),
      // so a body can hold more than 15% of a cell there; it may still never hold more than a third.
      expect(row.maxCellShare, `z${zoom}`).toBeLessThanOrEqual(zoom < 0.55 ? 1 / 3 : 0.15);
      if (zoom === 1) {
        expect(row.maxBodies).toBeLessThanOrEqual(260);
        // The sprites the view itself needs (the cache may hold more, up to its cap, for panning back).
        expect(row.viewMB).toBeLessThanOrEqual(26);
      }
    }
    console.log('[V1 phone]', JSON.stringify(out));
  }, 120_000);

  it('desktop rows: 1920×1080 DPR 1 and 1440×900 DPR 2 at their streetMinZoom and at 0.3: sprite MB within the PC cache, ≤ 30 fallback frames after the pan', async () => {
    const out: Record<string, Row> = {};
    for (const [w, h, dpr, smz] of [
      [1920, 1080, 1, 0.58],
      [1440, 900, 2, 0.46],
    ] as const)
      for (const zoom of [smz, 0.3]) {
        const row = await pan({ region: 5, slots: 9, w, h, dpr, pc: true, zoom, frames: 40 });
        out[`${w}x${h}@${dpr} z${zoom}`] = row;
        expect(row.capMB, `${w}x${h}`).toBeGreaterThanOrEqual(64);
        expect(row.maxMB, `${w}x${h} z${zoom}`).toBeLessThanOrEqual(row.capMB);
        expect(row.fallbackFramesAfterStop, `${w}x${h} z${zoom}`).toBeLessThanOrEqual(30);
      }
    console.log('[V1 desktop]', JSON.stringify(out));
  }, 240_000);
});

describe('ending street look on the buildings and placement ghosts with a look (§9.2, §6.2 pickers)', () => {
  it('each ending dresses its facades (Fab quota boards, Market smile screens and tickers, crews\' banners) without raising the height truth; the Quiet Hand dresses nothing', () => {
    const ctx = mockContext();
    for (const ending of ['ironwork', 'pearl', 'lowcrown', 'ledger', 'quiet'] as const)
      for (const zone of [1, 2, 3])
        for (const level of [1, 2, 3])
          for (const kind of ['shore', 'bazaar', 'flats'] as DistrictKind[]) {
            const v = (level * 3 + zone) & 15;
            const body = { form: v & 7, seed: 1 };
            const plain = art.zoneBodyInfo(zone, level, v, 0, body, { kind });
            const dressed = art.zoneBodyInfo(zone, level, v, 0, body, { kind, ending });
            expect(dressed.top, `${ending} z${zone} L${level} ${kind}`).toBe(plain.top);
            if (ending === 'quiet') expect(dressed.id).toBe(plain.id);
            else expect(dressed.id, `${ending} z${zone} L${level}`).not.toBe(plain.id);
            for (const night of [0, 1]) {
              resetMockStats();
              art.drawZoneBody(ctx, 0, 0, tile(zone, level, v, 0), body, env(night, 1), { kind, ending });
              expect(mockStats.errors, `${ending} z${zone} L${level} ${kind}`).toEqual([]);
              expect(mockStats.draws).toBeGreaterThan(0);
            }
          }
  });

  it('a placement ghost shows the chosen Spire sponsor and look, a crown look, and paints cleanly', () => {
    const ctx = mockContext();
    const picks: [BuildingType, Parameters<Art['drawBuildingGhost']>[6]][] = [
      ['spire', undefined],
      ...([0, 1, 2, 3] as const).map((look) => ['spire', { sponsor: 'nacre', look }] as [BuildingType, { sponsor: 'nacre'; look: 0 | 1 | 2 | 3 }]),
      ...([0, 1, 2] as const).map((look) => ['spire', { sponsor: 'basalt', look }] as [BuildingType, { sponsor: 'basalt'; look: 0 | 1 | 2 }]),
      ...([0, 1, 2] as const).map((look) => ['stack', { crown: 'salvage', look }] as [BuildingType, { crown: 'salvage'; look: 0 | 1 | 2 }]),
      ['clinic', { x: 70, y: 70 }],
    ];
    for (const [type, pick] of picks)
      for (const ok of [true, false]) {
        resetMockStats();
        art.drawBuildingGhost(ctx, 0, 0, type, ok, { ...env(1, 1), ghost: true }, pick);
        expect(mockStats.errors, `${type} ${JSON.stringify(pick)}`).toEqual([]);
        expect(mockStats.draws, `${type} ${JSON.stringify(pick)}`).toBeGreaterThan(0);
      }
    // The ghost's model is the placed building's: a Basalt look-1 Spire ghost is the Crucible, not today's Facet.
    const a = art.serviceModelInfo('spire', { sponsor: 'basalt', look: 1 } as Partial<Building>);
    const b = art.serviceModelInfo('spire', {} as Partial<Building>);
    expect(a.id).not.toBe(b.id);
  });
});
