// WP-4 (EXPANSION §4.5, §5, §6.1, §11): building art sweep. Every one of the 432 zone bodies
// (3 zones × 3 levels × 8 forms × 3 wealth tiers × 2 palettes) and every service, story and
// port model paints through the real sprite cache and painter against a strict mock canvas:
// no throw, no NaN or negative radius, something drawn. The model ids and tops follow the spec.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS, BUILDING_ORDER } from '../src/game/config';
import { ZoneType, type Building, type BuildingType, type Tile } from '../src/game/types';
import { installCanvasMock, mockContext, mockStats, resetMockStats } from './canvas-mock';

const uninstall = installCanvasMock();
afterAll(() => uninstall());
type Art = typeof import('../src/render/buildings');
type Ports = typeof import('../src/render/art/ports');
let art: Art;
let ports: Ports;
beforeAll(async () => {
  art = await import('../src/render/buildings');
  ports = await import('../src/render/art/ports');
});

const tile = (zone: number, level: number, variant: number, wealth: 0 | 1 | 2, extra: Partial<Tile> = {}): Tile =>
  ({
    terrain: 0,
    road: false,
    zone,
    level,
    abandoned: false,
    variant,
    buildingId: -1,
    powered: true,
    age: 400,
    roadKind: 0,
    wealth,
    ...extra,
  }) as Tile;

let time = 0;
const env = (night: number, zoom: number, quality: 'low' | 'high' = 'high') => ({ time: (time += 1), night, zoom, quality });

describe('zone model ids (EXPANSION §4.5)', () => {
  it('cover 0..431 once each and decode as the spec says', () => {
    const seen = new Set<number>();
    for (let z = 1; z <= 3; z++)
      for (let l = 1; l <= 3; l++)
        for (let f = 0; f < 8; f++)
          for (let t = 0; t < 3; t++)
            for (let b = 0; b < 2; b++) {
              const id = art.zoneModelId(z, l, f | (b << 3), t);
              expect(id).toBe(((((z - 1) * 3 + l - 1) * 8 + f) * 3 + t) * 2 + b);
              expect(Math.floor(id / 144) + 1).toBe(z);
              expect((Math.floor(id / 48) % 3) + 1).toBe(l);
              expect(Math.floor(id / 2) % 3).toBe(t);
              expect(id & 1).toBe(b);
              seen.add(id);
            }
    expect(seen.size).toBe(art.ZONE_BODIES);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(431);
  });

  it('keep the pre-tier seed and top for every tier (props never raise the top)', () => {
    for (let z = 1; z <= 3; z++)
      for (let l = 1; l <= 3; l++)
        for (let v = 0; v < 16; v++) {
          const base = art.zoneModelInfo(z, l, v, 0);
          const legacy = ((z - 1) * 3 + (l - 1)) * 16 + (v & 7) * 2 + ((v >> 3) & 1);
          expect(base.seed).toBe(7919 * (legacy + 1) + 13);
          for (const t of [1, 2]) {
            const m = art.zoneModelInfo(z, l, v, t);
            expect(m.seed).toBe(base.seed);
            expect(m.top).toBe(base.top);
            expect(m.tier).toBe(t);
            expect(art.zoneBuildingHeight(tile(z, l, v, t as 1 | 2))).toBe(base.top);
          }
        }
  });

  it('variant bits above the palette bit do not change the model', () => {
    expect(art.zoneModelInfo(1, 2, 3 | 8, 2).id).toBe(art.zoneModelInfo(1, 2, (3 | 8) + 64, 2).id);
  });
});

describe('sweep: every zone body paints cleanly (EXPANSION §11 WP-4 acceptance)', () => {
  it('all 432 bodies × lit / dark / abandoned × day / night × near / far', () => {
    const ctx = mockContext();
    let bodies = 0;
    for (let z = 1; z <= 3; z++)
      for (let l = 1; l <= 3; l++)
        for (let f = 0; f < 8; f++)
          for (let b = 0; b < 2; b++)
            for (const t of [0, 1, 2] as const) {
              bodies++;
              for (const state of ['on', 'dark', 'abandoned'] as const)
                for (const night of [0, 1])
                  for (const zoom of [1, 0.4]) {
                    resetMockStats();
                    const tl = tile(z, l, f | (b << 3), t, { powered: state !== 'dark', abandoned: state === 'abandoned' });
                    art.drawZoneBuilding(ctx, 0, 0, tl, 10, 10, env(night, zoom));
                    expect(mockStats.errors, `zone ${z} L${l} form ${f} pal ${b} tier ${t} ${state} night ${night} zoom ${zoom}`).toEqual([]);
                    expect(mockStats.draws).toBeGreaterThan(5);
                  }
            }
    expect(bodies).toBe(432);
  });

  it('construction, ghosts and empty lots paint cleanly at every tier', () => {
    const ctx = mockContext();
    for (let z = 1; z <= 3; z++)
      for (const t of [0, 1, 2] as const) {
        resetMockStats();
        art.drawZoneBuilding(ctx, 0, 0, tile(z, 3, 5, t, { age: 6 }), 4, 4, env(0.5, 1));
        art.drawZoneBuilding(ctx, 0, 0, tile(z, 2, 9, t), 4, 4, { ...env(0, 1), ghost: true });
        art.drawZoneBuilding(ctx, 0, 0, tile(z, 0, 3, 0), 4, 4, env(1, 1));
        expect(mockStats.errors).toEqual([]);
      }
  });
});

describe('services, story buildings and ports', () => {
  const building = (type: BuildingType, extra: Partial<Building> = {}): Building =>
    ({ id: 900 + BUILDING_ORDER.indexOf(type), type, x: 10, y: 10, size: BUILDINGS[type].size, powered: true, offline: 0, ...extra }) as Building;

  it('every building type paints lit and dark, day and night, plus its ghost', () => {
    const ctx = mockContext();
    for (const type of BUILDING_ORDER) {
      let most = 0;
      for (const powered of [true, false])
        for (const night of [0, 1]) {
          resetMockStats();
          art.drawServiceBuilding(ctx, 0, 0, building(type, { powered }), env(night, 1));
          expect(mockStats.errors, `${type} powered ${powered} night ${night}`).toEqual([]);
          // A cached sprite is one blit (power plants never go dark); a fresh one paints its recipe.
          expect(mockStats.draws).toBeGreaterThan(0);
          most = Math.max(most, mockStats.draws);
        }
      expect(most, type).toBeGreaterThan(5);
      resetMockStats();
      art.drawBuildingGhost(ctx, 0, 0, type, true, env(0, 0.4));
      expect(mockStats.errors).toEqual([]);
    }
  });

  it('a seaport has one model per facing and a spaceport three stages, complete and an empty pad', () => {
    const ctx = mockContext();
    for (const facing of [0, 1, 2, 3] as const) {
      resetMockStats();
      art.drawServiceBuilding(ctx, 0, 0, building('seaport', { facing }), env(1, 1));
      expect(mockStats.errors).toEqual([]);
      expect(ports.portVariant({ type: 'seaport', facing })).toBe(facing);
    }
    // Construction stages follow the progress rule of sim/ports.ts (days and real seconds).
    const D = BUILDINGS.spaceport.buildDays!;
    expect(ports.portVariant({ type: 'spaceport', buildDays: D, waitSec: 240 })).toBe(0);
    expect(ports.portVariant({ type: 'spaceport', buildDays: D * 0.5, waitSec: 100 })).toBe(1);
    expect(ports.portVariant({ type: 'spaceport', buildDays: 1, waitSec: 10 })).toBe(2);
    expect(ports.portVariant({ type: 'spaceport', buildDays: 0, waitSec: 0 })).toBe(ports.SPACE_COMPLETE);
    // Days done but the real-time floor not: still building.
    expect(ports.portVariant({ type: 'spaceport', buildDays: 1, waitSec: 200 })).toBe(0);
    const heights: number[] = [];
    for (const [buildDays, waitSec] of [
      [D, 240],
      [D / 2, 100],
      [1, 10],
      [0, 0],
    ]) {
      resetMockStats();
      const b = building('spaceport', { buildDays, waitSec });
      art.drawServiceBuilding(ctx, 0, 0, b, env(0.6, 1));
      expect(mockStats.errors).toEqual([]);
      heights.push(art.serviceBuildingHeight('spaceport', b));
    }
    // The tower rises through the stages; complete is the launch tower (~260 px).
    expect(heights[1]).toBeGreaterThan(heights[0] - 40);
    expect(heights[2]).toBeGreaterThan(heights[1]);
    expect(heights[3]).toBeGreaterThanOrEqual(250);
    expect(heights[3]).toBeLessThanOrEqual(280);
  });

  it('port heights: seaport cranes and masts, airport tower ~110 px', () => {
    expect(art.serviceBuildingHeight('seaport', building('seaport', { facing: 2 }))).toBeGreaterThan(45);
    expect(art.serviceBuildingHeight('seaport', building('seaport', { facing: 2 }))).toBeLessThan(80);
    const air = art.serviceBuildingHeight('airport', building('airport'));
    expect(air).toBeGreaterThanOrEqual(100);
    expect(air).toBeLessThanOrEqual(120);
    expect(art.serviceBuildingHeight('academy', building('academy'))).toBeGreaterThan(40);
    expect(art.serviceBuildingHeight('academy', building('academy'))).toBeLessThan(70);
  });

  it('zone sprites keep the tier palettes: $ warmer, $$ today, $$$ gold and platinum', async () => {
    const { ZONE_PALS } = await import('../src/render/art/zones');
    for (let z = 0; z < 3; z++) {
      expect(ZONE_PALS[z]).toHaveLength(3);
      for (let b = 0; b < 2; b++) {
        expect(ZONE_PALS[z][0][b].warm).toBeGreaterThan(ZONE_PALS[z][1][b].warm);
        expect(ZONE_PALS[z][0][b].neon).toEqual(ZONE_PALS[z][1][b].neon);
      }
      expect(ZONE_PALS[z][2][0].neon2).toEqual([255, 216, 77]);
      expect(ZONE_PALS[z][2][0].up).toEqual([255, 200, 120]);
      expect(ZONE_PALS[z][2][1].neon2).toEqual([220, 235, 255]);
    }
    expect(ZoneType.Residential).toBe(1);
  });
});
