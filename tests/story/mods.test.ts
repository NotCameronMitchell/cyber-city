import { describe, expect, it } from 'vitest';
import { MAX_TAX } from '../../src/game/config';
import {
  ADDITIVE_MOD_KEYS,
  DEFAULT_MODS,
  MULTIPLICATIVE_MOD_KEYS,
  clampMods,
  cloneMods,
  combine,
  composeLayers,
  makeLayerParts,
  makeLayers,
  resetLayers,
  resetMods,
} from '../../src/game/story/mods';
import type { SimMods } from '../../src/game/story/types';
import { LEGACY_SIZE } from '../../src/game/types';

const AREA = LEGACY_SIZE * LEGACY_SIZE;

describe('DEFAULT_MODS', () => {
  it('holds identities for every key', () => {
    for (const k of ADDITIVE_MOD_KEYS) expect(DEFAULT_MODS[k]).toBe(0);
    for (const k of MULTIPLICATIVE_MOD_KEYS) expect(DEFAULT_MODS[k]).toBe(1);
    expect(DEFAULT_MODS.taxCap).toBe(MAX_TAX);
    expect(DEFAULT_MODS.costMul).toEqual({});
    expect(DEFAULT_MODS.upkeepMulType).toEqual({});
    expect(DEFAULT_MODS.favorMonthly).toEqual({});
  });

  it('lists every scalar key exactly once', () => {
    const scalar = Object.keys(DEFAULT_MODS).filter((k) => typeof (DEFAULT_MODS as any)[k] === 'number');
    const listed = [...ADDITIVE_MOD_KEYS, ...MULTIPLICATIVE_MOD_KEYS, 'taxCap'];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...scalar].sort()).toEqual([...listed].sort());
  });

  it('is frozen, keyed maps included; clones are independent', () => {
    expect(Object.isFrozen(DEFAULT_MODS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MODS.costMul)).toBe(true);
    const a = cloneMods();
    const b = cloneMods();
    a.costMul.reactor = 0.5;
    a.crimeMul = 2;
    expect(b.costMul.reactor).toBeUndefined();
    expect(DEFAULT_MODS.costMul.reactor).toBeUndefined();
    expect(b.crimeMul).toBe(1);
    const c = cloneMods(a);
    c.costMul.reactor = 0.1;
    expect(a.costMul.reactor).toBe(0.5);
  });

  it('resetMods restores identities in place', () => {
    const m = cloneMods();
    combine(m, { demandRes: 0.2, crimeMul: 0.5, taxCap: 12, costMul: { stack: 0.8 }, favorMonthly: { kites: -1 } });
    const ref = m;
    resetMods(m);
    expect(m).toBe(ref);
    expect(m).toEqual(cloneMods());
  });
});

describe('combine', () => {
  it('adds additive keys and multiplies multiplicative keys', () => {
    const m = cloneMods();
    combine(m, { demandRes: 0.1, approvalAdd: 5, crimeMul: 0.8, upkeepMul: 0.9 });
    combine(m, { demandRes: 0.2, approvalAdd: -2, crimeMul: 0.5, upkeepMul: 0.5 });
    expect(m.demandRes).toBeCloseTo(0.3, 10);
    expect(m.approvalAdd).toBe(3);
    expect(m.crimeMul).toBeCloseTo(0.4, 10);
    expect(m.upkeepMul).toBeCloseTo(0.45, 10);
    expect(m.demandCom).toBe(0);
    expect(m.trafficMul).toBe(1);
  });

  it('takes the minimum tax cap', () => {
    const m = cloneMods();
    combine(m, { taxCap: 15 });
    combine(m, { taxCap: 18 });
    expect(m.taxCap).toBe(15);
    combine(m, { taxCap: 12 });
    expect(m.taxCap).toBe(12);
  });

  it('combines keyed maps per key', () => {
    const m = cloneMods();
    combine(m, { costMul: { reactor: 0.8, stack: 0.8 }, upkeepMulType: { precinct: 0.5 }, favorMonthly: { kites: -1 } });
    combine(m, { costMul: { reactor: 0.75 }, upkeepMulType: { precinct: 0.5 }, favorMonthly: { kites: -1, board: 2 } });
    expect(m.costMul.reactor).toBeCloseTo(0.6, 10);
    expect(m.costMul.stack).toBeCloseTo(0.8, 10);
    expect(m.costMul.foundry).toBeUndefined();
    expect(m.upkeepMulType.precinct).toBeCloseTo(0.25, 10);
    expect(m.favorMonthly).toEqual({ kites: -2, board: 2 });
  });

  it('ignores non-finite patch values and does not alias patch maps', () => {
    const m = cloneMods();
    const patch = { demandInd: NaN, crimeMul: Infinity, taxCap: NaN, costMul: { glarewall: NaN, spire: 0.5 } };
    combine(m, patch);
    expect(m.demandInd).toBe(0);
    expect(m.crimeMul).toBe(1);
    expect(m.taxCap).toBe(MAX_TAX);
    expect(m.costMul.glarewall).toBeUndefined();
    expect(m.costMul.spire).toBe(0.5);
    m.costMul.spire = 0.1;
    expect(patch.costMul.spire).toBe(0.5);
  });

  it('an empty patch is a no-op', () => {
    const m = cloneMods();
    combine(m, {});
    expect(m).toEqual(cloneMods());
  });
});

describe('clampMods', () => {
  const clamped = (p: Partial<SimMods>): SimMods => {
    const m = { ...cloneMods(), ...p } as SimMods;
    clampMods(m);
    return m;
  };

  it('clamps demand adds to ±0.5', () => {
    const m = clamped({ demandRes: 0.9, demandCom: -0.9, demandInd: 0.3 });
    expect(m.demandRes).toBe(0.5);
    expect(m.demandCom).toBe(-0.5);
    expect(m.demandInd).toBe(0.3);
  });

  it('clamps crimeAdd and landValueAdd to ±0.3 and approvalAdd to ±20', () => {
    const m = clamped({ crimeAdd: 0.5, landValueAdd: -0.4, approvalAdd: 30 });
    expect(m.crimeAdd).toBe(0.3);
    expect(m.landValueAdd).toBe(-0.3);
    expect(m.approvalAdd).toBe(20);
    expect(clamped({ approvalAdd: -25 }).approvalAdd).toBe(-20);
  });

  it('clamps every multiplier to [0.25, 4]', () => {
    for (const k of MULTIPLICATIVE_MOD_KEYS) {
      expect(clamped({ [k]: 10 } as Partial<SimMods>)[k]).toBe(4);
      expect(clamped({ [k]: 0.1 } as Partial<SimMods>)[k]).toBe(0.25);
      expect(clamped({ [k]: 0.9 } as Partial<SimMods>)[k]).toBe(0.9);
    }
  });

  it('keeps costMul ≥ 0 (free is allowed) and upkeepMulType in [0.25, 4]', () => {
    const m = clamped({ costMul: { glarewall: 0, stack: -1, spire: 5 }, upkeepMulType: { precinct: 0.1, clinic: 9 } });
    expect(m.costMul.glarewall).toBe(0);
    expect(m.costMul.stack).toBe(0);
    expect(m.costMul.spire).toBe(5);
    expect(m.upkeepMulType.precinct).toBe(0.25);
    expect(m.upkeepMulType.clinic).toBe(4);
  });

  it('clamps taxCap to [5, 20]', () => {
    expect(clamped({ taxCap: 2 }).taxCap).toBe(5);
    expect(clamped({ taxCap: 25 }).taxCap).toBe(20);
    expect(clamped({ taxCap: 15 }).taxCap).toBe(15);
  });

  it('resets non-finite values to identities and leaves traceMonthly alone', () => {
    const m = clamped({ demandRes: NaN, crimeMul: NaN, taxCap: NaN, traceMonthly: 3, outageChance: 2 });
    expect(m.demandRes).toBe(0);
    expect(m.crimeMul).toBe(1);
    expect(m.taxCap).toBe(20);
    expect(m.traceMonthly).toBe(3);
    expect(m.outageChance).toBe(1);
  });

  it('identities survive a clamp unchanged', () => {
    const m = cloneMods();
    clampMods(m);
    expect(m).toEqual(cloneMods());
  });

  it('stacks an ending patch on top of a deal, then clamps (Ironwork + Foundry Contract)', () => {
    const m = cloneMods();
    combine(m, { costMul: { reactor: 0.8, stack: 0.8, foundry: 0.8 } }); // deal
    combine(m, { demandInd: 0.15, costMul: { reactor: 0.85, stack: 0.85, foundry: 0.85 }, pollutionMul: 1.15, taxCap: 15 }); // ending
    combine(m, { demandInd: 0.5 }); // overshoot
    clampMods(m);
    expect(m.costMul.reactor).toBeCloseTo(0.68, 10);
    expect(m.pollutionMul).toBeCloseTo(1.15, 10);
    expect(m.taxCap).toBe(15);
    expect(m.demandInd).toBe(0.5);
  });
});

describe('layers', () => {
  it('makeLayers starts at identities and resetLayers restores them', () => {
    const l = makeLayers(AREA);
    for (const a of [l.crimeAdd, l.lvAdd, l.transitAdd]) {
      expect(a.length).toBe(AREA);
      expect(a.every((v) => v === 0)).toBe(true);
    }
    for (const a of [l.tripMul, l.abandonMul, l.taxMul]) expect(a.every((v) => v === 1)).toBe(true);
    l.crimeAdd[5] = 0.3;
    l.tripMul[5] = 0.5;
    resetLayers(l);
    expect(l.crimeAdd[5]).toBe(0);
    expect(l.tripMul[5]).toBe(1);
  });

  it('composeLayers adds, maxes and multiplies the three parts', () => {
    const world = { layers: makeLayers(AREA), layerParts: makeLayerParts(AREA) };
    const { turf, vertical, local } = world.layerParts;
    turf.crimeAdd[10] = 0.1;
    vertical.crimeAdd[10] = -0.05;
    local.crimeAdd[10] = 0.08;
    turf.lvAdd[11] = -0.04;
    vertical.lvAdd[11] = 0.05;
    vertical.transitAdd[12] = 0.5;
    local.transitAdd[12] = 0.7;
    turf.tripMul[13] = 0.8;
    vertical.tripMul[13] = 0.8;
    turf.abandonMul[14] = 1.5;
    local.abandonMul[14] = 0.5;
    turf.taxMul[15] = 0.7;
    vertical.taxMul[15] = 0.5;
    composeLayers(world);
    const L = world.layers;
    expect(L.crimeAdd[10]).toBeCloseTo(0.13, 6);
    expect(L.lvAdd[11]).toBeCloseTo(0.01, 6);
    expect(L.transitAdd[12]).toBeCloseTo(0.7, 6);
    expect(L.tripMul[13]).toBeCloseTo(0.64, 6);
    expect(L.abandonMul[14]).toBeCloseTo(0.75, 6);
    expect(L.taxMul[15]).toBeCloseTo(0.35, 6);
    // Untouched tiles stay at identities; parts are not modified.
    expect(L.crimeAdd[0]).toBe(0);
    expect(L.tripMul[0]).toBe(1);
    expect(turf.crimeAdd[10]).toBeCloseTo(0.1, 6);
  });

  it('composeLayers is idempotent and re-running after a part changes overwrites', () => {
    const world = { layers: makeLayers(AREA), layerParts: makeLayerParts(AREA) };
    world.layerParts.turf.crimeAdd[3] = 0.2;
    composeLayers(world);
    composeLayers(world);
    expect(world.layers.crimeAdd[3]).toBeCloseTo(0.2, 6);
    resetLayers(world.layerParts.turf);
    composeLayers(world);
    expect(world.layers.crimeAdd[3]).toBe(0);
  });

  it('composeLayers keeps results sane', () => {
    const world = { layers: makeLayers(AREA), layerParts: makeLayerParts(AREA) };
    const p = world.layerParts;
    p.turf.crimeAdd[0] = 0.9;
    p.local.crimeAdd[0] = 0.9;
    p.vertical.transitAdd[1] = 3;
    p.turf.tripMul[2] = -1;
    composeLayers(world);
    expect(world.layers.crimeAdd[0]).toBe(1);
    expect(world.layers.transitAdd[1]).toBe(1);
    expect(world.layers.tripMul[2]).toBe(0);
  });

  it('composeLayers is fast enough for per-month use', () => {
    const world = { layers: makeLayers(AREA), layerParts: makeLayerParts(AREA) };
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) composeLayers(world);
    expect((performance.now() - t0) / 50).toBeLessThan(2);
  });
});
