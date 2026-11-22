// ─────────────────────────────────────────────────────────────────────────────
// Zone building recipes: 8 silhouettes per zone per level, plus empty-lot props.
//
//   Residential (magenta / violet): capsule stacks + shanties → hab slabs with
//     balconies → setback hab towers with sky gardens and antennas.
//   Commercial (cyan): noodle bars + stalls → arcades / malls with neon strips →
//     glass skyscrapers with holo billboards and beacons.
//   Industrial (amber): sheds + containers → sawtooth fab halls → refinery
//     columns and cooling towers with smoke and warning lights.
//
// Footprint is the unit tile (u, v ∈ 0..1). Parts are drawn back to front
// (ascending u + v) and bottom to top. All randomness goes through p.rng.
// ─────────────────────────────────────────────────────────────────────────────

import { NEON, type RGB } from '../palette';
import { mat, type ArtPal, type Mat, type Painter, type WinSpec } from './painter';

export type Recipe = (p: Painter) => void;

const R = (p: Painter, a: number, b: number) => a + (b - a) * p.rng.next();
function pick<T>(p: Painter, arr: readonly T[]): T {
  return arr[Math.floor(p.rng.next() * arr.length)];
}

// ── Palettes ───────────────────────────────────────────────────────────────

export const ZONE_PALS: ArtPal[][] = [
  // Residential
  [
    { neon: NEON.magenta, neon2: NEON.amber, up: [200, 40, 170], warm: 0.62, cool: 0.18 },
    { neon: [176, 120, 255], neon2: NEON.cyan, up: [120, 70, 230], warm: 0.55, cool: 0.25 },
  ],
  // Commercial
  [
    { neon: NEON.cyan, neon2: NEON.magenta, up: [30, 170, 220], warm: 0.25, cool: 0.5 },
    { neon: NEON.cyan, neon2: NEON.yellow, up: [40, 190, 210], warm: 0.3, cool: 0.45 },
  ],
  // Industrial
  [
    { neon: NEON.amber, neon2: NEON.red, up: [220, 120, 30], warm: 0.7, cool: 0.08 },
    { neon: NEON.amber, neon2: NEON.green, up: [210, 130, 40], warm: 0.6, cool: 0.15 },
  ],
];

// ── Materials ──────────────────────────────────────────────────────────────

const RES_WALL: Mat[] = [mat([142, 116, 140]), mat([150, 130, 128]), mat([112, 126, 136]), mat([128, 122, 142]), mat([158, 150, 144])];
const COM_WALL: Mat[] = [mat([98, 116, 140]), mat([150, 154, 168]), mat([84, 92, 112]), mat([124, 136, 150])];
const IND_WALL: Mat[] = [mat([128, 96, 76]), mat([106, 108, 88]), mat([146, 124, 76]), mat([112, 114, 120])];
const ROOF = mat([104, 100, 112]);
const ROOF_DARK = mat([78, 76, 88]);
const TARP: Mat[] = [mat([60, 120, 140]), mat([150, 70, 70]), mat([90, 90, 150]), mat([140, 120, 60])];
const STEEL = mat([140, 144, 152]);
const RUST = mat([132, 84, 60]);
const CONC = mat([124, 126, 140]);
const DARK_GLASS: Mat = { day: [58, 84, 112], night: [10, 12, 28] };
const TEAL_GLASS: Mat = { day: [70, 128, 142], night: [10, 18, 32] };
const CONTAINER: RGB[] = [
  [150, 70, 58],
  [56, 110, 116],
  [62, 82, 136],
  [166, 128, 60],
  [96, 120, 70],
];

// ── Window presets ─────────────────────────────────────────────────────────

const W_SMALL: WinSpec = { style: 'grid', floor: 6, col: 8, w: 0.45, h: 0.5, margin: 2 };
const W_CAP: WinSpec = { style: 'capsule', floor: 6, col: 6.5, w: 0.6, h: 0.55, margin: 1.5 };
const W_RES: WinSpec = { style: 'grid', floor: 7, col: 7, w: 0.5, h: 0.5 };
const W_RES_T: WinSpec = { style: 'grid', floor: 6.5, col: 6, w: 0.55, h: 0.5 };
const W_BAND: WinSpec = { style: 'band', floor: 7, col: 7, w: 1, h: 0.42 };
const W_CURT: WinSpec = { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 };
const W_CURT_L: WinSpec = { style: 'curtain', floor: 7, col: 8, w: 1, h: 0.82, margin: 1 };
const W_SLIT: WinSpec = { style: 'slit', floor: 10, col: 9, w: 0.28, h: 0.55, lit: 1.1 };
const W_SHOP: WinSpec = { style: 'grid', floor: 7, col: 8, w: 0.55, h: 0.5, margin: 2, skip: 1 };

// Face edge helpers for a box (u0,v0)-(u1,v1): left face = v1 edge, right face = u1 edge.
type Box = [number, number, number, number];
const LEFT = (b: Box): [number, number, number, number] => [b[0], b[3], b[2], b[3]];
const RIGHT = (b: Box): [number, number, number, number] => [b[2], b[1], b[2], b[3]];

/** Balcony ledges on the left face of box b every `every` floors. */
function balconies(p: Painter, b: Box, z0: number, z1: number, floor: number, every: number, depth = 0.05) {
  const rail = mat([170, 170, 182]);
  for (let z = z0 + floor * every; z < z1 - floor; z += floor * every) {
    p.box(b[0] + 0.03, b[3], b[2] - 0.03, b[3] + depth, z - 1, z, CONC, { uplight: false });
    if (!p.lod) {
      p.begin_();
      p.m(b[0] + 0.03, b[3] + depth, z + 2);
      p.l(b[2] - 0.03, b[3] + depth, z + 2);
      p.stroke(p.col(rail, 0.8, 0.8), 0.4);
    }
  }
}

/** AC units bolted on the right face of box b. */
function wallAC(p: Painter, b: Box, z0: number, z1: number, count: number) {
  for (let i = 0; i < count; i++) {
    const v = b[1] + 0.08 + (b[3] - b[1] - 0.18) * p.rng.next();
    const z = z0 + 4 + (z1 - z0 - 10) * p.rng.next();
    p.box(b[2], v, b[2] + 0.04, v + 0.07, z, z + 3, STEEL, { uplight: false });
  }
}

/** Ground-floor door on the left face. */
function frontDoor(p: Painter, b: Box, t: number, lit: RGB | null = null) {
  const [au, av, bu, bv] = LEFT(b);
  p.door(au, av, bu, bv, t, t + 0.14, 0, 5.5, lit);
}

// ════════════════════════════════════════════════════════════════════════════
// RESIDENTIAL
// ════════════════════════════════════════════════════════════════════════════

const RES1: Recipe[] = [
  // Stacked capsule homes.
  (p) => {
    const w1 = pick(p, RES_WALL);
    const w2 = pick(p, RES_WALL);
    const h1 = R(p, 11, 14);
    const h2 = h1 + R(p, 8, 10);
    const trim = p.rng.next() < 0.5;
    const b: Box = [0.14, 0.14, 0.86, 0.86];
    p.box(...b, 0, h1, w1, { win: W_SMALL, top: ROOF });
    frontDoor(p, b, 0.15, p.pal.neon2);
    p.ac(0.7, 0.18, h1);
    p.box(0.2, 0.34, 0.66, 0.86, h1, h2, w2, { win: W_CAP, top: ROOF, trim: trim ? p.pal.neon : undefined });
    p.laundry(0.72, 0.3, 0.78, 0.78, h1);
    p.tank(0.36, 0.55, h2);
    p.blade(0.82, 0.86, 'v', 0.1, 3, h1 - 1, p.pal.neon);
  },
  // Shanty cluster with tarps and a dish.
  (p) => {
    const parts: [number, number, number, number, number][] = [
      [0.1, 0.1, 0.48, 0.52, R(p, 12, 16)],
      [0.52, 0.12, 0.9, 0.48, R(p, 8, 11)],
      [0.12, 0.56, 0.5, 0.9, R(p, 8, 10)],
      [0.56, 0.52, 0.9, 0.9, R(p, 13, 18)],
    ];
    for (let i = 0; i < parts.length; i++) {
      const [u0, v0, u1, v1, h] = parts[i];
      const w = pick(p, RES_WALL);
      p.box(u0, v0, u1, v1, 0, h, w, { win: W_SMALL, noTop: true });
      p.shed(u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, h, R(p, 2, 4), pick(p, TARP), i % 2 ? 'u' : 'v');
    }
    p.dish(0.74, 0.66, parts[3][4] + 2);
    p.antenna(0.22, 0.2, parts[0][4] + 2, 12);
    p.blade(0.5, 0.9, 'v', 0.08, 2, 9, p.pal.neon);
    p.bike(0.62, 0.92, p.pal.neon);
  },
  // Jenga capsule stack.
  (p) => {
    const ws = [pick(p, RES_WALL), pick(p, RES_WALL), pick(p, RES_WALL)];
    p.box(0.12, 0.2, 0.88, 0.62, 0, 8, ws[0], { win: W_CAP, top: ROOF });
    p.box(0.3, 0.12, 0.72, 0.88, 8, 16, ws[1], { win: W_CAP, top: ROOF });
    p.box(0.15, 0.3, 0.8, 0.7, 16, 24, ws[2], { win: W_CAP, top: ROOF, trim: p.pal.neon });
    p.ac(0.6, 0.36, 24);
    p.antenna(0.24, 0.38, 24, 9);
    p.blade(0.72, 0.88, 'v', 0.09, 9, 15, p.pal.neon2);
  },
  // Gable-roof row house with tank + chimney.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 12, 15);
    const b: Box = [0.16, 0.18, 0.84, 0.82];
    p.box(...b, 0, h, w, { win: W_SMALL, noTop: true });
    frontDoor(p, b, 0.55, p.pal.neon2);
    p.gable(0.14, 0.16, 0.86, 0.84, h, R(p, 7, 9), pick(p, TARP), 'u');
    p.box(0.3, 0.26, 0.38, 0.34, h, h + 10, CONC);
    p.tank(0.7, 0.7, h + 2, 0.05, 5);
    p.antenna(0.62, 0.3, h + 6, 10);
  },
  // Twin mini blocks joined by a bridge, laundry on the roof.
  (p) => {
    const wa = pick(p, RES_WALL);
    const wb = pick(p, RES_WALL);
    const ha = R(p, 20, 26);
    const hb = R(p, 14, 18);
    p.box(0.1, 0.12, 0.46, 0.55, 0, ha, wa, { win: W_SMALL, top: ROOF });
    p.box(0.36, 0.42, 0.62, 0.58, 10, 13, CONC, { uplight: false });
    p.box(0.52, 0.5, 0.9, 0.88, 0, hb, wb, { win: W_SMALL, top: ROOF, trim: p.pal.neon });
    p.laundry(0.18, 0.2, 0.38, 0.45, ha);
    p.ac(0.62, 0.56, hb);
    p.blade(0.3, 0.55, 'v', 0.08, 8, 18, p.pal.neon);
  },
  // Container homes, crosswise stacked.
  (p) => {
    const c1 = pick(p, CONTAINER);
    const c2 = pick(p, CONTAINER);
    const c3 = pick(p, CONTAINER);
    p.container(0.1, 0.18, 0.9, 0.46, 0, 8, c1);
    p.container(0.1, 0.54, 0.9, 0.84, 0, 8, c2);
    p.container(0.3, 0.16, 0.6, 0.86, 8, 16, c3);
    p.wallSign(0.3, 0.86, 0.6, 0.86, 0.15, 0.85, 10, 14.5, p.pal.neon);
    p.greens(0.68, 0.2, 0.86, 0.5, 8, 3);
    p.ac(0.7, 0.6, 8);
  },
  // Walk-up with a rooftop shack and pot plants.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 15, 19);
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, h, w, { win: W_SMALL, top: ROOF });
    frontDoor(p, b, 0.4);
    p.box(0.16, 0.16, 0.44, 0.44, h, h + 6, pick(p, RES_WALL), { win: W_SMALL, noTop: true });
    p.shed(0.14, 0.14, 0.46, 0.46, h + 6, 2.5, pick(p, TARP), 'v');
    p.greens(0.55, 0.5, 0.84, 0.84, h, 4);
    p.tank(0.7, 0.24, h);
    p.blade(0.88, 0.6, 'u', 0.09, 5, h - 2, p.pal.neon2);
  },
  // Shophouse: neon ground floor, capsule rooms above.
  (p) => {
    const w = pick(p, RES_WALL);
    const b: Box = [0.1, 0.1, 0.9, 0.9];
    p.box(...b, 0, 9, CONC, { top: ROOF });
    const [au, av, bu, bv] = LEFT(b);
    p.door(au, av, bu, bv, 0.1, 0.55, 0, 6.5, p.pal.neon);
    p.awning(au, av, bu, bv, 8, 0.08, p.pal.neon);
    p.box(0.16, 0.16, 0.84, 0.7, 9, R(p, 19, 23), w, { win: W_CAP, top: ROOF });
    p.ac(0.7, 0.74, 9);
    p.blade(0.9, 0.3, 'u', 0.09, 9, 19, p.pal.neon2);
  },
];

const RES2: Recipe[] = [
  // Balcony slab.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 52, 64);
    const b: Box = [0.14, 0.2, 0.86, 0.8];
    p.box(...b, 0, h, w, { win: W_RES, top: ROOF });
    balconies(p, b, 0, h, 7, 2);
    wallAC(p, b, 0, h, 4);
    frontDoor(p, b, 0.42, p.pal.neon2);
    p.tank(0.3, 0.35, h);
    p.tank(0.5, 0.35, h);
    p.antenna(0.72, 0.62, h, 14);
    p.neon([0.86, 0.8, 4, 0.86, 0.8, h - 4], p.pal.neon, 0.9);
  },
  // L-shaped slab with roof garden.
  (p) => {
    const wa = pick(p, RES_WALL);
    const wb = pick(p, RES_WALL);
    const ha = R(p, 54, 64);
    const hb = R(p, 38, 46);
    const a: Box = [0.12, 0.12, 0.88, 0.45];
    const b: Box = [0.12, 0.45, 0.5, 0.88];
    p.box(...a, 0, ha, wa, { win: W_RES, top: ROOF, trim: p.pal.neon });
    p.box(...b, 0, hb, wb, { win: W_RES, top: ROOF });
    balconies(p, b, 0, hb, 7, 2);
    p.greens(0.16, 0.5, 0.46, 0.84, hb, 5);
    p.ac(0.6, 0.2, ha);
    p.dish(0.75, 0.3, ha);
    p.blade(0.5, 0.7, 'u', 0.1, 8, 30, p.pal.neon);
  },
  // Gallery block with external corridors + stair tower.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 44, 52);
    const b: Box = [0.12, 0.15, 0.82, 0.85];
    p.box(...b, 0, h, w, { win: W_BAND, top: ROOF });
    const rail = mat([180, 176, 190]);
    for (let z = 7; z < h - 3; z += 7) {
      p.box(b[0], b[3], b[2], b[3] + 0.04, z - 0.8, z, CONC, { uplight: false });
      if (!p.lod) {
        p.begin_();
        p.m(b[0], b[3] + 0.04, z + 2.2);
        p.l(b[2], b[3] + 0.04, z + 2.2);
        p.stroke(p.col(rail, 0.7, 0.8), 0.4);
      }
    }
    p.box(0.82, 0.3, 0.94, 0.52, 0, h + 6, CONC, { win: { style: 'slit', floor: 7, col: 4, w: 0.4, h: 0.6 } });
    p.neon([0.94, 0.52, 3, 0.94, 0.52, h + 4], p.pal.neon, 0.9);
    p.tank(0.35, 0.4, h);
    p.laundry(0.55, 0.25, 0.6, 0.75, h);
  },
  // Stepped slab with terrace garden.
  (p) => {
    const w = pick(p, RES_WALL);
    const h1 = R(p, 30, 36);
    const h2 = h1 + R(p, 22, 28);
    p.box(0.12, 0.12, 0.88, 0.88, 0, h1, w, { win: W_RES, top: ROOF, trim: p.pal.neon2 });
    p.box(0.18, 0.12, 0.88, 0.58, h1, h2, pick(p, RES_WALL), { win: W_RES, top: ROOF, trim: p.pal.neon });
    p.greens(0.2, 0.64, 0.84, 0.86, h1, 6);
    p.antenna(0.3, 0.3, h2, 12);
    p.ac(0.6, 0.25, h2);
    balconies(p, [0.12, 0.12, 0.88, 0.88], 0, h1, 7, 2, 0.04);
  },
  // Capsule tower: core with pods plugged into both faces.
  (p) => {
    const core = mat([120, 120, 132]);
    const h = R(p, 60, 70);
    p.box(0.25, 0.25, 0.75, 0.75, 0, h, core, { win: W_SMALL, top: ROOF });
    const pods = [pick(p, RES_WALL), pick(p, RES_WALL)];
    for (let z = 3; z < h - 8; z += 8) {
      for (let i = 0; i < 3; i++) {
        if (p.rng.next() < 0.3) continue;
        const t = 0.27 + i * 0.16;
        p.box(t, 0.75, t + 0.14, 0.87, z, z + 6.5, pods[(i + z) % 2], { win: { style: 'capsule', floor: 6.5, col: 4, w: 0.6, h: 0.5, margin: 1.5 }, uplight: false });
      }
      for (let i = 0; i < 3; i++) {
        if (p.rng.next() < 0.3) continue;
        const t = 0.27 + i * 0.16;
        p.box(0.75, t, 0.87, t + 0.14, z, z + 6.5, pods[(i + z + 1) % 2], { win: { style: 'capsule', floor: 6.5, col: 4, w: 0.6, h: 0.5, margin: 1.5 }, uplight: false });
      }
    }
    p.antenna(0.5, 0.5, h, 16);
    p.neon([0.75, 0.75, 2, 0.75, 0.75, h - 2], p.pal.neon, 0.8);
  },
  // Octagonal hab with crown trim.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 54, 62);
    p.chamfer(0.16, 0.16, 0.84, 0.84, 0.16, 0, h, w, { win: W_RES, top: ROOF, trim: p.pal.neon });
    p.chamfer(0.3, 0.3, 0.7, 0.7, 0.1, h, h + 5, ROOF_DARK, { trim: p.pal.neon2 });
    p.dish(0.4, 0.4, h + 5);
    p.antenna(0.6, 0.45, h + 5, 10);
  },
  // Twin slabs with a skybridge.
  (p) => {
    const wa = pick(p, RES_WALL);
    const wb = pick(p, RES_WALL);
    const ha = R(p, 46, 54);
    const hb = R(p, 56, 66);
    p.box(0.1, 0.12, 0.42, 0.88, 0, ha, wa, { win: W_RES, top: ROOF });
    p.box(0.4, 0.42, 0.6, 0.58, 28, 33, mat([90, 110, 130]), { trim: p.pal.neon, uplight: false });
    p.box(0.58, 0.12, 0.9, 0.88, 0, hb, wb, { win: W_RES, top: ROOF });
    balconies(p, [0.58, 0.12, 0.9, 0.88], 0, hb, 7, 3, 0.04);
    p.tank(0.25, 0.3, ha);
    p.antenna(0.75, 0.3, hb, 12);
    p.greens(0.62, 0.5, 0.86, 0.84, hb, 3);
  },
  // Slab with a rooftop sign frame.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 42, 48);
    const b: Box = [0.14, 0.14, 0.86, 0.86];
    p.box(...b, 0, h, w, { win: W_RES, top: ROOF });
    balconies(p, b, 0, h, 7, 2);
    frontDoor(p, b, 0.2, p.pal.neon2);
    p.begin_();
    p.m(0.3, 0.45, h);
    p.l(0.3, 0.45, h + 8);
    p.m(0.75, 0.45, h);
    p.l(0.75, 0.45, h + 8);
    p.stroke(p.col(STEEL, 0.6), 0.8);
    p.wallSign(0.22, 0.45, 0.82, 0.45, 0, 1, h + 6, h + 15, p.pal.neon);
    p.ac(0.3, 0.65, h);
  },
];

const RES3: Recipe[] = [
  // Setback tower with antenna.
  (p) => {
    const w = pick(p, RES_WALL);
    const h1 = R(p, 66, 76);
    const h2 = h1 + R(p, 34, 42);
    const h3 = h2 + R(p, 14, 20);
    p.box(0.16, 0.16, 0.84, 0.84, 0, h1, w, { win: W_RES_T, top: ROOF, trim: p.pal.neon });
    p.box(0.22, 0.22, 0.78, 0.78, h1, h2, w, { win: W_RES_T, top: ROOF, trim: p.pal.neon2 });
    p.greens(0.18, 0.7, 0.8, 0.82, h1, 4);
    p.box(0.3, 0.3, 0.7, 0.7, h2, h3, ROOF_DARK, { win: W_SMALL, top: ROOF });
    p.antenna(0.5, 0.5, h3, 22);
    p.neon([0.84, 0.84, 4, 0.84, 0.84, h1 - 3], p.pal.neon, 1);
    balconies(p, [0.16, 0.16, 0.84, 0.84], 0, h1, 6.5, 3, 0.04);
  },
  // Twin towers with skybridge.
  (p) => {
    const wa = pick(p, RES_WALL);
    const wb = pick(p, RES_WALL);
    const ha = R(p, 130, 150);
    const hb = R(p, 104, 120);
    p.box(0.1, 0.12, 0.44, 0.5, 0, ha, wa, { win: W_RES_T, top: ROOF, trim: p.pal.neon });
    p.antenna(0.26, 0.3, ha, 18);
    p.box(0.32, 0.42, 0.6, 0.58, 76, 83, mat([80, 100, 124]), { trim: p.pal.neon2, uplight: false });
    p.box(0.52, 0.5, 0.9, 0.88, 0, hb, wb, { win: W_RES_T, top: ROOF, trim: p.pal.neon });
    p.greens(0.56, 0.54, 0.86, 0.84, hb, 5);
    p.neon([0.9, 0.88, 4, 0.9, 0.88, hb - 3], p.pal.neon2, 0.8);
  },
  // Octagon tower with a sky-garden band.
  (p) => {
    const w = pick(p, RES_WALL);
    const ha = R(p, 56, 64);
    const hb = ha + 8;
    const hc = hb + R(p, 54, 66);
    p.chamfer(0.18, 0.18, 0.82, 0.82, 0.16, 0, ha, w, { win: W_RES_T, top: ROOF });
    p.chamfer(0.24, 0.24, 0.76, 0.76, 0.12, ha, hb, mat([90, 110, 100]), { top: mat([80, 130, 92]) });
    p.greens(0.2, 0.2, 0.8, 0.8, ha, 8);
    p.chamfer(0.18, 0.18, 0.82, 0.82, 0.16, hb, hc, w, { win: W_RES_T, top: ROOF, trim: p.pal.neon });
    p.antenna(0.5, 0.5, hc, 18);
    p.dish(0.32, 0.4, hc);
  },
  // Slab tower with a lit crown and roof garden.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 112, 128);
    p.box(0.12, 0.25, 0.88, 0.75, 0, h, w, { win: W_BAND, top: ROOF });
    p.box(0.2, 0.3, 0.8, 0.7, h, h + 8, ROOF_DARK, { trim: p.pal.neon, win: { style: 'band', floor: 8, col: 6, w: 1, h: 0.5, margin: 1 } });
    p.greens(0.24, 0.34, 0.76, 0.66, h + 8, 6);
    balconies(p, [0.12, 0.25, 0.88, 0.75], 0, h, 7, 4, 0.05);
    p.blade(0.88, 0.5, 'u', 0.1, 20, 60, p.pal.neon);
  },
  // Balcony-ringed tower.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 126, 142);
    p.box(0.2, 0.2, 0.8, 0.8, 0, h, w, { win: W_RES_T, top: ROOF, trim: p.pal.neon2 });
    for (let z = 26; z < h - 6; z += 26) p.box(0.17, 0.17, 0.83, 0.83, z - 1.2, z, ROOF_DARK, { uplight: false, top: ROOF_DARK, trim: z % 52 === 0 ? p.pal.neon : undefined });
    p.tank(0.35, 0.35, h, 0.06, 7);
    p.tank(0.6, 0.4, h, 0.05, 6);
    p.antenna(0.5, 0.65, h, 16);
  },
  // Cantilevered top block.
  (p) => {
    const w = pick(p, RES_WALL);
    const h1 = R(p, 84, 96);
    const h2 = h1 + R(p, 30, 38);
    p.box(0.25, 0.2, 0.75, 0.8, 0, h1, w, { win: W_RES_T, top: ROOF });
    p.box(0.12, 0.14, 0.88, 0.86, h1, h2, pick(p, RES_WALL), { win: W_RES_T, top: ROOF, trim: p.pal.neon2 });
    p.neon([0.12, 0.86, h1 + 0.5, 0.88, 0.86, h1 + 0.5, 0.88, 0.14, h1 + 0.5], p.pal.neon, 1.1);
    p.greens(0.2, 0.2, 0.5, 0.5, h2, 4);
    p.antenna(0.7, 0.7, h2, 14);
  },
  // Cluster of four prisms.
  (p) => {
    const ws = [pick(p, RES_WALL), pick(p, RES_WALL), pick(p, RES_WALL)];
    p.box(0.12, 0.12, 0.5, 0.5, 0, R(p, 140, 156), ws[0], { win: W_RES_T, top: ROOF, trim: p.pal.neon });
    p.antenna(0.3, 0.3, p.maxZ, 16);
    p.box(0.5, 0.15, 0.86, 0.5, 0, R(p, 100, 116), ws[1], { win: W_RES_T, top: ROOF });
    p.box(0.15, 0.5, 0.55, 0.86, 0, R(p, 84, 98), ws[2], { win: W_RES_T, top: ROOF });
    const h4 = R(p, 56, 70);
    p.box(0.55, 0.55, 0.88, 0.88, 0, h4, ws[0], { win: W_RES_T, top: ROOF, trim: p.pal.neon2 });
    p.greens(0.6, 0.6, 0.84, 0.84, h4, 4);
  },
  // Neon-spine tower with a tall blade sign.
  (p) => {
    const w = pick(p, RES_WALL);
    const h = R(p, 118, 132);
    p.box(0.2, 0.2, 0.8, 0.8, 0, h, w, { win: W_RES_T, top: ROOF });
    p.neon([0.8, 0.8, 3, 0.8, 0.8, h + 2], p.pal.neon, 1.2);
    p.neon([0.8, 0.5, 6, 0.8, 0.5, h - 6], p.pal.neon2, 0.8);
    p.blade(0.4, 0.8, 'v', 0.12, 30, 82, p.pal.neon);
    p.dish(0.32, 0.32, h);
    p.dish(0.55, 0.3, h);
    p.antenna(0.62, 0.6, h, 20);
  },
];

// ════════════════════════════════════════════════════════════════════════════
// COMMERCIAL
// ════════════════════════════════════════════════════════════════════════════

const COM1: Recipe[] = [
  // Noodle bar with glowing awning and blade sign.
  (p) => {
    const w = pick(p, COM_WALL);
    const h = R(p, 11, 13);
    const b: Box = [0.15, 0.15, 0.85, 0.85];
    p.box(...b, 0, h, w, { top: ROOF });
    const [au, av, bu, bv] = LEFT(b);
    p.door(au, av, bu, bv, 0.08, 0.7, 0, 6.5, p.pal.neon2);
    p.awning(au, av, bu, bv, 8.5, 0.11, p.pal.neon);
    p.blade(0.8, 0.85, 'v', 0.1, 9, 22, p.pal.neon);
    p.lamp(0.3, 0.97, 6, NEON.red, 8);
    p.lamp(0.5, 0.97, 6, NEON.red, 8);
    p.ac(0.3, 0.3, h);
    p.pipe(0.6, 0.3, h, 0.6, 0.3, h + 8, 1.4, STEEL);
  },
  // Kiosk cluster under coloured canopies.
  (p) => {
    const ks: [number, number, number, number][] = [
      [0.12, 0.12, 0.42, 0.42],
      [0.56, 0.14, 0.86, 0.44],
      [0.14, 0.56, 0.44, 0.86],
      [0.58, 0.58, 0.86, 0.86],
    ];
    for (let i = 0; i < ks.length; i++) {
      const [u0, v0, u1, v1] = ks[i];
      const h = R(p, 7, 10);
      p.box(u0, v0, u1, v1, 0, h, pick(p, COM_WALL), { noTop: true });
      p.door(u0, v1, u1, v1, 0.15, 0.85, 1, h - 2, i % 2 ? p.pal.neon : p.pal.neon2);
      p.shed(u0 - 0.03, v0 - 0.03, u1 + 0.03, v1 + 0.04, h, 2.5, pick(p, TARP), 'v');
    }
    p.neon([0.42, 0.42, 9, 0.56, 0.44, 10, 0.86, 0.44, 9], [255, 220, 150], 0.5);
    p.crate(0.46, 0.5, 0);
    p.crate(0.48, 0.62, 0);
  },
  // Screen shop with a big lit front panel.
  (p) => {
    const w = pick(p, COM_WALL);
    const h = R(p, 15, 18);
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, h, w, { top: ROOF });
    const [au, av, bu, bv] = LEFT(b);
    p.wallSign(au, av, bu, bv, 0.08, 0.92, 8, h - 1.5, p.pal.neon);
    p.door(au, av, bu, bv, 0.2, 0.7, 0, 6, p.pal.neon2);
    const [ru, rv, su, sv] = RIGHT(b);
    p.door(ru, rv, su, sv, 0.15, 0.85, 0, 7);
    p.box(0.88, 0.8, 0.95, 0.88, 0, 8, mat([60, 60, 80]), { uplight: false });
    p.glow(0.95, 0.84, 4, p.pal.neon, 14, p.glowA() * 0.8);
    p.ac(0.3, 0.3, h);
    p.ac(0.55, 0.3, h);
  },
  // Two-floor shop: awning + blade sign.
  (p) => {
    const w = pick(p, COM_WALL);
    const h = R(p, 20, 24);
    const b: Box = [0.15, 0.15, 0.85, 0.85];
    p.box(...b, 0, h, w, { win: W_SHOP, top: ROOF });
    const [ru, rv, su, sv] = RIGHT(b);
    p.door(ru, rv, su, sv, 0.15, 0.85, 0, 6, p.pal.neon);
    p.awning(ru, rv, su, sv, 7.5, 0.08, p.pal.neon2);
    p.blade(0.4, 0.85, 'v', 0.1, 8, 20, p.pal.neon);
    p.ac(0.3, 0.3, h);
    p.antenna(0.7, 0.3, h, 8, null);
  },
  // Open market canopy with string lights.
  (p) => {
    p.box(0.1, 0.1, 0.9, 0.9, 0, 0.8, CONC, { uplight: false });
    for (const [u, v] of [
      [0.14, 0.14],
      [0.86, 0.14],
      [0.14, 0.86],
    ] as const) {
      p.begin_();
      p.m(u, v, 0);
      p.l(u, v, 11);
      p.stroke(p.col(STEEL, 0.6), 0.8);
    }
    for (let i = 0; i < 3; i++) p.box(0.2 + i * 0.22, 0.4, 0.36 + i * 0.22, 0.6, 0, 4, pick(p, TARP), { uplight: false });
    p.shed(0.1, 0.1, 0.9, 0.9, 11, 3, mat([70, 150, 170], [14, 40, 54]), 'v');
    p.begin_();
    p.m(0.86, 0.86, 0);
    p.l(0.86, 0.86, 11);
    p.stroke(p.col(STEEL, 0.6), 0.8);
    p.neon([0.1, 0.9, 10.5, 0.5, 0.9, 9.5, 0.9, 0.9, 10.5, 0.9, 0.5, 11.5, 0.9, 0.1, 13.5], [255, 214, 140], 0.45);
    for (let i = 0; i < 4; i++) p.lamp(0.15 + i * 0.22, 0.9, 10, [255, 200, 120], 6);
    p.blade(0.9, 0.6, 'u', 0.08, 5, 16, p.pal.neon);
  },
  // Round kiosk pod with a glowing band.
  (p) => {
    const shell = mat([150, 158, 172]);
    p.box(0.12, 0.12, 0.88, 0.88, 0, 0.8, CONC, { uplight: false });
    p.cyl(0.5, 0.5, 0.28, 0, 11, shell, ROOF);
    p.cylBands(0.5, 0.5, 0.28, 2, 9, 4);
    p.cyl(0.5, 0.5, 0.2, 11, 15, mat([90, 100, 120]), ROOF_DARK, 0.12);
    p.neonRing(0.5, 0.5, 0.285, 10, p.pal.neon, 1);
    p.glow(0.5, 0.5, 8, p.pal.neon, 40, p.glowA() * 0.45);
    p.blade(0.6, 0.72, 'v', 0.12, 6, 20, p.pal.neon2);
    p.bench(0.2, 0.84, 'u');
  },
  // Repair garage with an open lit bay.
  (p) => {
    const w = pick(p, COM_WALL);
    const h = R(p, 13, 15);
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, h, w, { top: ROOF });
    const [au, av, bu, bv] = LEFT(b);
    p.door(au, av, bu, bv, 0.1, 0.6, 0, 8, NEON.amber);
    p.wallSign(au, av, bu, bv, 0.1, 0.6, 9, h - 1, p.pal.neon);
    p.blade(0.88, 0.5, 'u', 0.08, 4, h + 4, p.pal.neon2);
    p.crate(0.7, 0.9, 0, 0.06);
    p.bike(0.3, 0.95, p.pal.neon);
    p.ac(0.6, 0.3, h);
  },
  // Corner bar with a glowing window band and roof sign.
  (p) => {
    const w = pick(p, COM_WALL);
    const h = R(p, 12, 14);
    p.box(0.12, 0.12, 0.88, 0.5, 0, h, w, { win: { style: 'band', floor: 8, col: 5, w: 1, h: 0.5, margin: 2, lit: 1.6 }, top: ROOF });
    p.box(0.12, 0.5, 0.5, 0.88, 0, h - 2, w, { win: { style: 'band', floor: 8, col: 5, w: 1, h: 0.5, margin: 2, lit: 1.6 }, top: ROOF, trim: p.pal.neon2 });
    p.wallSign(0.3, 0.3, 0.8, 0.3, 0, 1, h, h + 8, p.pal.neon);
    p.lamp(0.6, 0.55, 5, p.pal.neon2, 10);
  },
];

const COM2: Recipe[] = [
  // Mall block with vertical sign strips.
  (p) => {
    const w = pick(p, COM_WALL);
    const h = R(p, 44, 50);
    const b: Box = [0.1, 0.1, 0.9, 0.9];
    p.box(...b, 0, h, w, { win: W_BAND, top: ROOF, trim: p.pal.neon });
    p.blade(0.9, 0.9, 'v', 0.08, 10, h - 4, p.pal.neon);
    p.blade(0.35, 0.9, 'v', 0.08, 16, h - 8, p.pal.neon2);
    p.blade(0.9, 0.35, 'u', 0.08, 14, h - 6, p.pal.neon2);
    p.door(...LEFT(b), 0.45, 0.85, 0, 7, p.pal.neon);
    p.ac(0.3, 0.3, h);
    p.ac(0.5, 0.25, h);
  },
  // Arcade with a big marquee and glass upper tier.
  (p) => {
    const w = pick(p, COM_WALL);
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, 34, w, { top: ROOF });
    const [au, av, bu, bv] = LEFT(b);
    p.wallSign(au, av, bu, bv, 0.06, 0.94, 16, 31, p.pal.neon);
    p.door(au, av, bu, bv, 0.25, 0.75, 0, 9, p.pal.neon2);
    p.awning(au, av, bu, bv, 12, 0.07, p.pal.neon2, false);
    p.box(0.2, 0.12, 0.88, 0.6, 34, R(p, 48, 54), TEAL_GLASS, { win: W_CURT, top: ROOF, trim: p.pal.neon });
    p.blade(0.88, 0.7, 'u', 0.09, 6, 30, p.pal.neon);
  },
  // Stepped mall with LED bands.
  (p) => {
    p.box(0.1, 0.1, 0.9, 0.9, 0, 24, pick(p, COM_WALL), { win: W_CURT, glass: TEAL_GLASS, top: ROOF, trim: p.pal.neon });
    p.box(0.18, 0.1, 0.9, 0.7, 24, 44, pick(p, COM_WALL), { win: W_BAND, top: ROOF, trim: p.pal.neon2 });
    p.box(0.3, 0.1, 0.9, 0.5, 44, R(p, 56, 62), pick(p, COM_WALL), { win: W_CURT, top: ROOF, trim: p.pal.neon });
    p.greens(0.2, 0.74, 0.86, 0.86, 24, 4);
    p.ac(0.4, 0.56, 44);
  },
  // Glass cube with diagonal neon strokes.
  (p) => {
    const h = R(p, 52, 60);
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, h, COM_WALL[0], { win: W_CURT_L, glass: DARK_GLASS, top: ROOF, trim: p.pal.neon });
    p.neon([0.12, 0.88, 4, 0.88, 0.88, h - 6, 0.88, 0.12, 4], p.pal.neon2, 1);
    p.neon([0.12, 0.88, 14, 0.55, 0.88, h - 2], p.pal.neon, 0.7);
    p.ticker(...LEFT(b), 0.05, 0.95, 4, 8, p.pal.neon);
    p.antenna(0.3, 0.3, h, 10);
  },
  // L-shaped plaza block with screens.
  (p) => {
    const a: Box = [0.1, 0.1, 0.9, 0.45];
    const b: Box = [0.1, 0.45, 0.5, 0.9];
    p.box(...a, 0, R(p, 50, 56), pick(p, COM_WALL), { win: W_BAND, top: ROOF });
    p.box(...b, 0, R(p, 36, 42), pick(p, COM_WALL), { win: W_SHOP, top: ROOF, trim: p.pal.neon });
    p.wallSign(...LEFT(b), 0.1, 0.9, 14, 30, p.pal.neon2);
    p.wallSign(...RIGHT(a), 0.6, 0.95, 20, 44, p.pal.neon, true, true);
    p.ticker(...RIGHT(b), 0.1, 0.9, 6, 9, p.pal.neon);
    p.dish(0.7, 0.25, p.maxZ);
  },
  // Office with rooftop glyph sign.
  (p) => {
    const h = R(p, 40, 46);
    const b: Box = [0.14, 0.14, 0.86, 0.86];
    p.box(...b, 0, h, pick(p, COM_WALL), { win: W_RES, top: ROOF });
    p.begin_();
    p.m(0.25, 0.4, h);
    p.l(0.25, 0.4, h + 6);
    p.m(0.8, 0.4, h);
    p.l(0.8, 0.4, h + 6);
    p.stroke(p.col(STEEL, 0.6), 0.8);
    p.wallSign(0.16, 0.4, 0.86, 0.4, 0, 1, h + 5, h + 16, p.pal.neon);
    p.door(...LEFT(b), 0.3, 0.7, 0, 7, p.pal.neon2);
    p.awning(...LEFT(b), 9, 0.06, p.pal.neon, false);
  },
  // Octo-mall with facet strips.
  (p) => {
    const h = R(p, 46, 54);
    p.chamfer(0.12, 0.12, 0.88, 0.88, 0.18, 0, h, pick(p, COM_WALL), { win: W_BAND, top: ROOF, trim: p.pal.neon });
    p.neon([0.88, 0.7, 3, 0.88, 0.7, h - 2], p.pal.neon2, 1);
    p.neon([0.7, 0.88, 3, 0.7, 0.88, h - 2], p.pal.neon2, 1);
    p.chamfer(0.3, 0.3, 0.7, 0.7, 0.1, h, h + 6, ROOF_DARK, { trim: p.pal.neon2 });
    p.door(0.88, 0.7, 0.7, 0.88, 0.2, 0.8, 0, 7, p.pal.neon);
  },
  // Slim capsule hotel with a tall blade sign.
  (p) => {
    const h = R(p, 62, 70);
    p.box(0.2, 0.2, 0.8, 0.8, 0, h, pick(p, COM_WALL), { win: W_CAP, top: ROOF, trim: p.pal.neon2 });
    p.blade(0.8, 0.8, 'v', 0.12, 10, h - 4, p.pal.neon);
    p.door(0.2, 0.8, 0.8, 0.8, 0.2, 0.7, 0, 6, p.pal.neon);
    p.antenna(0.4, 0.4, h, 12);
  },
];

const COM3: Recipe[] = [
  // Glass tower with a big billboard.
  (p) => {
    const h = R(p, 144, 160);
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, h, COM_WALL[2], { win: W_CURT, glass: DARK_GLASS, top: ROOF, trim: p.pal.neon });
    p.board(...RIGHT(b), 0.1, 0.9, 64, 112, 0, p.pal.neon, p.pal.neon2);
    p.box(0.3, 0.3, 0.7, 0.7, h, h + 8, ROOF_DARK, { trim: p.pal.neon2 });
    p.blinker(0.5, 0.5, h + 14, NEON.red, 1.4, 16);
    p.begin_();
    p.m(0.5, 0.5, h + 8);
    p.l(0.5, 0.5, h + 14);
    p.stroke(p.col(STEEL, 0.7), 0.8);
    p.ticker(...LEFT(b), 0.04, 0.96, 8, 12, p.pal.neon);
  },
  // Faceted tower with a vertical billboard on the front facet.
  (p) => {
    const h = R(p, 160, 178);
    const c = 0.2;
    p.chamfer(0.14, 0.14, 0.86, 0.86, c, 0, h, COM_WALL[0], { win: W_CURT, glass: TEAL_GLASS, top: ROOF, trim: p.pal.neon });
    p.board(0.86, 0.86 - c, 0.86 - c, 0.86, 0.06, 0.94, 40, 136, 2, p.pal.neon2, p.pal.neon);
    p.chamfer(0.3, 0.3, 0.7, 0.7, 0.1, h, h + 10, ROOF_DARK, { trim: p.pal.neon2 });
    p.antenna(0.5, 0.5, h + 10, 26, NEON.red);
  },
  // Setback tower with a holo ring crown.
  (p) => {
    const h1 = R(p, 84, 96);
    const h2 = h1 + R(p, 44, 52);
    const h3 = h2 + 18;
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, h1, COM_WALL[1], { win: W_CURT, glass: DARK_GLASS, top: ROOF, trim: p.pal.neon2 });
    p.board(...LEFT(b), 0.12, 0.88, 36, 76, 1, p.pal.neon, p.pal.neon2);
    p.box(0.2, 0.2, 0.8, 0.8, h1, h2, COM_WALL[0], { win: W_BAND, top: ROOF, trim: p.pal.neon });
    p.box(0.28, 0.28, 0.72, 0.72, h2, h3, ROOF_DARK, { win: W_CURT, glass: TEAL_GLASS, top: ROOF });
    const [x, y] = p.pt(0.5, 0.5, h3 + 6);
    p.addFx({ k: 'ring', x, y, rx: 18, ry: 9, c: p.pal.neon, ph: p.rng.next() });
    p.track(x - 20, y - 10);
    p.track(x + 20, y + 10);
    p.blinker(0.5, 0.5, h3 + 2, NEON.red, 1.8, 14);
  },
  // Twin glass towers with a billboard bridge.
  (p) => {
    const ha = R(p, 164, 180);
    const hb = R(p, 130, 146);
    p.box(0.1, 0.12, 0.44, 0.5, 0, ha, COM_WALL[2], { win: W_CURT, glass: TEAL_GLASS, top: ROOF, trim: p.pal.neon });
    p.blinker(0.27, 0.31, ha + 2, NEON.red, 1.5, 14);
    p.box(0.3, 0.44, 0.62, 0.58, 96, 106, mat([60, 64, 80]), { uplight: false });
    p.board(0.3, 0.58, 0.6, 0.58, 0.05, 0.95, 97, 105, 3, p.pal.neon2, p.pal.neon);
    const b: Box = [0.52, 0.5, 0.9, 0.88];
    p.box(...b, 0, hb, COM_WALL[0], { win: W_CURT, glass: DARK_GLASS, top: ROOF, trim: p.pal.neon2 });
    p.board(...LEFT(b), 0.1, 0.9, 30, 70, 0, p.pal.neon, p.pal.neon2);
    p.blinker(0.71, 0.69, hb + 2, NEON.red, 1.7, 14);
  },
  // Needle tower on a podium.
  (p) => {
    const h = R(p, 150, 166);
    const pod: Box = [0.1, 0.1, 0.9, 0.9];
    p.box(...pod, 0, 20, COM_WALL[1], { win: W_BAND, top: ROOF, trim: p.pal.neon });
    p.ticker(...LEFT(pod), 0.05, 0.95, 13, 17, p.pal.neon2);
    p.box(0.26, 0.26, 0.74, 0.74, 20, h, COM_WALL[2], { win: W_CURT, glass: TEAL_GLASS, top: ROOF, trim: p.pal.neon2 });
    p.board(0.74, 0.26, 0.74, 0.74, 0.08, 0.92, 70, 124, 3, p.pal.neon, p.pal.neon2);
    p.cyl(0.5, 0.5, 0.06, h, h + 34, STEEL, STEEL, 0.015);
    p.blinker(0.5, 0.5, h + 35, NEON.red, 1.2, 18);
    p.neon([0.74, 0.74, 22, 0.74, 0.74, h], p.pal.neon, 0.9);
  },
  // Stepped office with ticker bands.
  (p) => {
    const h1 = R(p, 64, 74);
    const h2 = h1 + R(p, 44, 52);
    const h3 = h2 + R(p, 18, 24);
    const a: Box = [0.1, 0.1, 0.9, 0.9];
    const b: Box = [0.16, 0.16, 0.84, 0.84];
    const c: Box = [0.24, 0.24, 0.76, 0.76];
    p.box(...a, 0, h1, COM_WALL[1], { win: W_BAND, top: ROOF, trim: p.pal.neon });
    p.ticker(...LEFT(a), 0.05, 0.95, h1 - 7, h1 - 3, p.pal.neon2);
    p.box(...b, h1, h2, COM_WALL[2], { win: W_CURT, glass: DARK_GLASS, top: ROOF, trim: p.pal.neon2 });
    p.ticker(...LEFT(b), 0.05, 0.95, h2 - 7, h2 - 3, p.pal.neon);
    p.box(...c, h2, h3, COM_WALL[0], { win: W_BAND, top: ROOF, trim: p.pal.neon });
    p.board(...RIGHT(a), 0.15, 0.85, 20, 50, 1, p.pal.neon2, p.pal.neon);
    p.blinker(0.5, 0.5, h3 + 2, NEON.red, 1.6, 14);
  },
  // Blade tower with a tall vertical billboard.
  (p) => {
    const h = R(p, 170, 188);
    const b: Box = [0.12, 0.3, 0.88, 0.64];
    p.box(...b, 0, h, COM_WALL[0], { win: W_CURT, glass: TEAL_GLASS, top: ROOF, trim: p.pal.neon });
    p.board(...LEFT(b), 0.18, 0.82, 48, 150, 2, p.pal.neon, p.pal.neon2);
    p.neon([0.88, 0.64, 2, 0.88, 0.64, h], p.pal.neon2, 1.1);
    p.box(0.2, 0.36, 0.5, 0.58, h, h + 7, ROOF_DARK);
    p.antenna(0.7, 0.47, h, 22, NEON.red);
  },
  // Cylinder tower with lit bands and a crown ring.
  (p) => {
    const h = R(p, 132, 148);
    p.box(0.08, 0.08, 0.92, 0.92, 0, 12, COM_WALL[1], { win: W_SHOP, top: ROOF, trim: p.pal.neon2 });
    p.cyl(0.5, 0.5, 0.36, 12, h, COM_WALL[2], ROOF);
    p.cylBands(0.5, 0.5, 0.36, 14, h - 2, 6);
    for (let z = 40; z < h - 10; z += 36) p.neonRing(0.5, 0.5, 0.365, z, p.pal.neon, 1.1);
    p.cyl(0.5, 0.5, 0.2, h, h + 10, ROOF_DARK, ROOF);
    const [x, y] = p.pt(0.5, 0.5, h + 6);
    p.addFx({ k: 'ring', x, y, rx: 20, ry: 10, c: p.pal.neon2, ph: p.rng.next() });
    p.track(x - 22, y - 12);
    p.track(x + 22, y + 12);
    p.antenna(0.5, 0.5, h + 10, 18, NEON.red);
    p.ticker(0.08, 0.92, 0.92, 0.92, 0.05, 0.95, 5, 9, p.pal.neon);
  },
];

// ════════════════════════════════════════════════════════════════════════════
// INDUSTRIAL
// ════════════════════════════════════════════════════════════════════════════

/** Yellow/black hazard stripes along the foot of the left face. */
function hazard(p: Painter, b: Box) {
  if (p.lod || !p.g) return;
  const g = p.g;
  g.beginPath();
  const [au, av, bu, bv] = LEFT(b);
  for (let i = 0; i < 10; i += 2) {
    const t0 = i / 10;
    const t1 = (i + 1) / 10;
    p.quad(au + (bu - au) * t0, av, 0.5, au + (bu - au) * t1, bv, 0.5, au + (bu - au) * t1, bv, 2, au + (bu - au) * t0, av, 2);
  }
  p.fill(p.col(mat([210, 180, 40]), 0.75));
}

const IND1: Recipe[] = [
  // Corrugated shed with roll door + small stack.
  (p) => {
    const w = pick(p, IND_WALL);
    const h = R(p, 10, 13);
    const b: Box = [0.12, 0.15, 0.82, 0.85];
    p.box(...b, 0, h, w, { noTop: true });
    p.ribs(...LEFT(b), 0, h, 14, w);
    p.ribs(...RIGHT(b), 0, h, 12, w);
    p.door(...LEFT(b), 0.2, 0.62, 0, 8, p.rng.next() < 0.5 ? p.pal.neon : null);
    p.gable(0.1, 0.13, 0.84, 0.87, h, 6, mat([120, 122, 130]), 'u');
    hazard(p, b);
    p.stack(0.9, 0.3, 0.05, 0, 22);
    p.lamp(0.7, 0.86, 9, p.pal.neon, 12);
  },
  // Container yard.
  (p) => {
    p.container(0.1, 0.14, 0.52, 0.4, 0, 8, pick(p, CONTAINER));
    p.container(0.58, 0.12, 0.88, 0.62, 0, 8, pick(p, CONTAINER));
    p.container(0.1, 0.14, 0.52, 0.4, 8, 16, pick(p, CONTAINER));
    p.container(0.1, 0.46, 0.52, 0.72, 0, 8, pick(p, CONTAINER));
    p.container(0.6, 0.66, 0.9, 0.9, 0, 8, pick(p, CONTAINER));
    p.crate(0.3, 0.8, 0);
    p.crate(0.42, 0.82, 0, 0.06);
    p.lamp(0.55, 0.5, 14, p.pal.neon, 14);
  },
  // Workshop with chimney and barrels.
  (p) => {
    const w = pick(p, IND_WALL);
    const h = R(p, 12, 15);
    const b: Box = [0.15, 0.15, 0.7, 0.85];
    p.box(...b, 0, h, w, { win: W_SLIT, noTop: true });
    p.shed(0.13, 0.13, 0.72, 0.87, h, 4, RUST, 'u');
    p.stack(0.82, 0.3, 0.06, 0, 28);
    for (let i = 0; i < 3; i++) p.cyl(0.8 + (i % 2) * 0.07, 0.6 + i * 0.09, 0.035, 0, 4.5, mat([60, 100, 150]), mat([50, 80, 120]));
    p.door(...LEFT(b), 0.3, 0.7, 0, 7, p.pal.neon);
  },
  // Tank and pump shed.
  (p) => {
    p.cyl(0.38, 0.38, 0.26, 0, R(p, 14, 18), mat([170, 166, 160]), mat([140, 136, 132]));
    p.ring(0.38, 0.38, 0.27, 8, mat([90, 90, 96]), 0.6, true);
    p.box(0.6, 0.56, 0.9, 0.9, 0, 9, pick(p, IND_WALL), { win: W_SLIT });
    p.pipe(0.5, 0.55, 3, 0.66, 0.64, 3, 1.6, STEEL);
    p.pipe(0.6, 0.3, 12, 0.85, 0.35, 12, 1.2, RUST);
    p.pipe(0.85, 0.35, 12, 0.85, 0.35, 0, 1.2, RUST);
    p.lamp(0.75, 0.73, 11, p.pal.neon, 12);
  },
  // Garage with a fenced yard of crates.
  (p) => {
    const w = pick(p, IND_WALL);
    const b: Box = [0.12, 0.12, 0.6, 0.6];
    p.box(...b, 0, 12, w, { noTop: true });
    p.shed(0.1, 0.1, 0.62, 0.62, 12, 3, mat([110, 114, 120]), 'v');
    p.door(...LEFT(b), 0.2, 0.8, 0, 8, null);
    p.door(...RIGHT(b), 0.2, 0.8, 0, 8, p.pal.neon);
    p.crate(0.7, 0.2, 0);
    p.crate(0.7, 0.2, 4);
    p.crate(0.8, 0.32, 0);
    p.crate(0.25, 0.72, 0);
    p.crate(0.36, 0.74, 0, 0.06);
    p.fence([0.08, 0.9, 0.92, 0.9, 0.92, 0.08]);
  },
  // Drone workshop: two-tooth roof + pad.
  (p) => {
    const w = pick(p, IND_WALL);
    p.box(0.15, 0.15, 0.85, 0.85, 0, 12, w, { win: W_SLIT, noTop: true });
    p.saw(0.15, 0.15, 0.55, 0.85, 12, 5, 2, mat([120, 122, 130]), p.pal.neon);
    p.box(0.55, 0.15, 0.85, 0.85, 12, 12.6, ROOF_DARK, { uplight: false });
    p.padMark(0.7, 0.5, 0.12, 12.6, p.pal.neon2);
    p.lamp(0.84, 0.84, 13, p.pal.neon, 12);
  },
  // Silos with a conveyor.
  (p) => {
    const m = mat([176, 170, 160]);
    p.cyl(0.32, 0.3, 0.15, 0, R(p, 20, 24), m, mat([140, 130, 120]), 0.06);
    p.cyl(0.62, 0.32, 0.14, 0, R(p, 18, 22), m, mat([140, 130, 120]), 0.05);
    p.box(0.2, 0.6, 0.85, 0.85, 0, 8, pick(p, IND_WALL), { win: W_SLIT, top: ROOF });
    p.pipe(0.32, 0.3, 20, 0.5, 0.7, 8, 1.4, RUST);
    p.lamp(0.85, 0.85, 7, p.pal.neon, 12);
  },
  // Generator shed with roof fans and a transformer.
  (p) => {
    const w = pick(p, IND_WALL);
    const b: Box = [0.12, 0.2, 0.7, 0.82];
    p.box(...b, 0, 10, w, { top: ROOF });
    p.ribs(...LEFT(b), 0, 10, 12, w);
    for (let i = 0; i < 3; i++) p.cyl(0.26 + i * 0.15, 0.5, 0.05, 10, 12, STEEL, mat([50, 50, 56]));
    p.box(0.74, 0.3, 0.92, 0.6, 0, 9, mat([100, 110, 100]));
    p.ribs(0.92, 0.3, 0.92, 0.6, 0, 9, 6, mat([100, 110, 100]));
    p.lamp(0.83, 0.45, 11, p.pal.neon, 12);
    p.pipe(0.74, 0.5, 6, 0.7, 0.55, 6, 0.8, mat([40, 40, 40]));
    hazard(p, b);
  },
];

const IND2: Recipe[] = [
  // Sawtooth fab hall.
  (p) => {
    const w = pick(p, IND_WALL);
    const h = R(p, 18, 22);
    const b: Box = [0.1, 0.1, 0.9, 0.9];
    p.box(...b, 0, h, w, { win: W_SLIT, noTop: true });
    p.ribs(...LEFT(b), 0, h, 16, w);
    p.saw(0.1, 0.1, 0.9, 0.9, h, 9, 4, mat([126, 128, 136]), p.pal.neon);
    p.door(...LEFT(b), 0.08, 0.32, 0, 10, p.pal.neon);
    hazard(p, b);
    p.stack(0.18, 0.18, 0.05, h, 18, true);
  },
  // Hall with silos behind.
  (p) => {
    const m = mat([176, 170, 160]);
    p.cyl(0.26, 0.2, 0.12, 0, R(p, 38, 44), m, mat([140, 130, 120]), 0.04);
    p.cyl(0.58, 0.18, 0.11, 0, R(p, 32, 38), m, mat([140, 130, 120]), 0.04);
    const w = pick(p, IND_WALL);
    const b: Box = [0.1, 0.34, 0.9, 0.9];
    p.box(...b, 0, 22, w, { win: W_SLIT, noTop: true });
    p.gable(0.08, 0.32, 0.92, 0.92, 22, 8, mat([120, 118, 126]), 'u');
    p.pipe(0.26, 0.2, 36, 0.5, 0.5, 28, 1.6, RUST);
    p.door(...LEFT(b), 0.6, 0.85, 0, 10, p.pal.neon);
    p.lamp(0.92, 0.6, 16, p.pal.neon, 14);
  },
  // Hall with a rooftop gantry crane.
  (p) => {
    const w = pick(p, IND_WALL);
    p.box(0.15, 0.15, 0.85, 0.85, 0, 24, w, { win: W_SLIT, noTop: true });
    p.saw(0.15, 0.15, 0.85, 0.85, 24, 7, 3, mat([126, 128, 136]), p.pal.neon);
    const y = mat([200, 170, 50]);
    p.box(0.2, 0.2, 0.25, 0.25, 31, 46, y, { uplight: false });
    p.box(0.2, 0.75, 0.25, 0.8, 31, 46, y, { uplight: false });
    p.box(0.18, 0.18, 0.27, 0.82, 46, 49, y, { uplight: false });
    p.pipe(0.22, 0.55, 46, 0.22, 0.55, 36, 0.4, STEEL);
    p.blinker(0.22, 0.5, 50, NEON.amber, 1.1, 14);
  },
  // Pipe fab with a tall stack and tanks.
  (p) => {
    const w = pick(p, IND_WALL);
    p.box(0.1, 0.1, 0.62, 0.9, 0, R(p, 24, 28), w, { win: W_SLIT, top: ROOF });
    p.stack(0.8, 0.24, 0.07, 0, R(p, 44, 50));
    p.pipe(0.62, 0.3, 18, 0.76, 0.26, 18, 1.8, RUST);
    p.cyl(0.78, 0.66, 0.11, 0, 14, mat([170, 170, 176]), mat([150, 150, 156]));
    p.cyl(0.78, 0.86, 0.07, 0, 10, mat([170, 170, 176]), mat([150, 150, 156]));
    p.pipe(0.62, 0.7, 8, 0.7, 0.68, 8, 1.4, STEEL);
  },
  // Blocky fab with roof vents.
  (p) => {
    const w = pick(p, IND_WALL);
    const h = R(p, 30, 34);
    const b: Box = [0.12, 0.12, 0.88, 0.88];
    p.box(...b, 0, h, w, { win: W_SLIT, top: ROOF, trim: p.pal.neon });
    p.ribs(...RIGHT(b), 0, h, 10, w);
    for (let i = 0; i < 4; i++) p.cyl(0.26 + (i % 2) * 0.3, 0.3 + Math.floor(i / 2) * 0.3, 0.07, h, h + 4, STEEL, mat([50, 50, 56]));
    p.box(0.6, 0.6, 0.82, 0.82, h, h + 6, ROOF_DARK);
    p.pipe(0.12, 0.6, 10, 0.05, 0.6, 10, 2, STEEL);
    p.door(...LEFT(b), 0.6, 0.9, 0, 9, p.pal.neon);
  },
  // Vat farm with catwalk + stack.
  (p) => {
    const vm = mat([180, 176, 170]);
    const pts: [number, number][] = [
      [0.28, 0.28],
      [0.62, 0.26],
      [0.28, 0.64],
      [0.64, 0.62],
    ];
    for (const [u, v] of pts) {
      p.cyl(u, v, 0.13, 0, 18, vm, mat([150, 146, 140]));
      p.dome(u, v, 0.13, 18, 4, mat([160, 156, 150]));
    }
    p.box(0.26, 0.42, 0.68, 0.48, 18, 19, STEEL, { uplight: false });
    p.stack(0.88, 0.2, 0.05, 0, 40);
    p.lamp(0.45, 0.45, 22, p.pal.neon, 14);
  },
  // Assembly line hall with loading dock.
  (p) => {
    const w = pick(p, IND_WALL);
    p.box(0.1, 0.25, 0.9, 0.75, 0, 18, w, { win: W_SLIT, noTop: true });
    p.saw(0.1, 0.25, 0.9, 0.75, 18, 6, 5, mat([126, 128, 136]), p.pal.neon);
    const ann: Box = [0.2, 0.75, 0.55, 0.92];
    p.box(...ann, 0, 11, pick(p, IND_WALL), { top: ROOF });
    p.door(...LEFT(ann), 0.1, 0.9, 0, 8, p.pal.neon);
    p.awning(...LEFT(ann), 10, 0.05, p.pal.neon, true);
    p.container(0.6, 0.8, 0.9, 0.92, 0, 6, pick(p, CONTAINER));
  },
  // Container stacks with a crane tower.
  (p) => {
    p.container(0.1, 0.12, 0.5, 0.36, 0, 8, pick(p, CONTAINER));
    p.container(0.1, 0.12, 0.5, 0.36, 8, 16, pick(p, CONTAINER));
    p.container(0.1, 0.12, 0.5, 0.36, 16, 24, pick(p, CONTAINER));
    p.container(0.1, 0.42, 0.5, 0.66, 0, 8, pick(p, CONTAINER));
    p.container(0.1, 0.42, 0.5, 0.66, 8, 16, pick(p, CONTAINER));
    p.container(0.1, 0.72, 0.5, 0.92, 0, 8, pick(p, CONTAINER));
    const y = mat([200, 170, 50]);
    p.box(0.7, 0.3, 0.76, 0.36, 0, 44, y, { uplight: false });
    p.box(0.3, 0.29, 0.92, 0.37, 44, 47, y, { uplight: false });
    p.pipe(0.42, 0.33, 44, 0.42, 0.33, 30, 0.4, STEEL);
    p.box(0.72, 0.6, 0.9, 0.86, 0, 9, pick(p, IND_WALL), { top: ROOF });
    p.blinker(0.92, 0.33, 48, NEON.red, 1.3, 14);
  },
];

const IND3: Recipe[] = [
  // Cooling tower with a pump house.
  (p) => {
    const h = R(p, 76, 86);
    p.coolingTower(0.42, 0.42, 0.38, h, mat([170, 168, 164]));
    const [x, y] = p.pt(0.42, 0.42, h);
    p.addFx({ k: 'smoke', x, y, r: 10, ph: p.rng.next() });
    p.track(x - 30, y - 60);
    p.box(0.72, 0.72, 0.94, 0.94, 0, 10, pick(p, IND_WALL), { win: W_SLIT, top: ROOF });
    p.pipe(0.66, 0.66, 4, 0.76, 0.76, 4, 2, STEEL);
    p.blinker(0.42, 0.06, h - 2, NEON.red, 1.8, 14);
  },
  // Refinery columns with a flare stack.
  (p) => {
    const cm = mat([184, 180, 176]);
    const cols: [number, number, number, number][] = [
      [0.28, 0.26, 0.09, R(p, 96, 108)],
      [0.56, 0.22, 0.07, R(p, 74, 86)],
      [0.26, 0.58, 0.1, R(p, 64, 74)],
    ];
    for (const [u, v, r, h] of cols) {
      p.cyl(u, v, r, 0, h, cm, mat([150, 146, 140]));
      for (let z = 18; z < h - 4; z += 22) p.ring(u, v, r + 0.03, z, mat([120, 110, 100]), 0.8, true);
      p.blinker(u, v, h + 1, NEON.red, 1.4 + p.rng.next(), 12);
      p.lamp(u + r, v, h * 0.55, p.pal.neon, 12);
    }
    p.pipe(0.28, 0.26, 50, 0.56, 0.22, 40, 1.6, RUST);
    p.pipe(0.26, 0.58, 30, 0.5, 0.62, 30, 1.6, RUST);
    p.box(0.46, 0.5, 0.7, 0.86, 0, 12, pick(p, IND_WALL), { win: W_SLIT, top: ROOF });
    p.cyl(0.82, 0.72, 0.025, 0, 118, STEEL, STEEL);
    const [x, y] = p.pt(0.82, 0.72, 119);
    p.addFx({ k: 'flame', x, y, ph: p.rng.next() });
    p.track(x - 8, y - 14);
    p.blinker(0.82, 0.72, 104, NEON.red, 1.1, 12);
  },
  // Twin cooling towers.
  (p) => {
    const m = mat([170, 168, 164]);
    const ha = R(p, 66, 74);
    const hb = R(p, 56, 62);
    p.coolingTower(0.3, 0.62, 0.24, ha, m);
    p.coolingTower(0.66, 0.3, 0.22, hb, m);
    for (const [u, v, h] of [
      [0.3, 0.62, ha],
      [0.66, 0.3, hb],
    ]) {
      const [x, y] = p.pt(u, v, h);
      p.addFx({ k: 'smoke', x, y, r: 8, ph: p.rng.next() });
      p.track(x - 30, y - 60);
    }
    p.blinker(0.3, 0.4, ha - 2, NEON.red, 1.6, 12);
  },
  // Fab block with three tall stacks.
  (p) => {
    const w = pick(p, IND_WALL);
    const b: Box = [0.1, 0.1, 0.9, 0.9];
    p.box(...b, 0, 38, w, { win: W_SLIT, top: ROOF, trim: p.pal.neon });
    p.ribs(...LEFT(b), 0, 38, 18, w);
    p.stack(0.28, 0.24, 0.07, 38, R(p, 70, 82));
    p.stack(0.5, 0.22, 0.07, 38, R(p, 62, 74));
    p.stack(0.72, 0.26, 0.07, 38, R(p, 54, 66));
    p.box(0.5, 0.6, 0.82, 0.84, 38, 46, ROOF_DARK, { trim: p.pal.neon2 });
    p.door(...LEFT(b), 0.1, 0.35, 0, 12, p.pal.neon);
  },
  // Spherical tanks + distillation tower.
  (p) => {
    const sm = mat([196, 194, 190]);
    p.cyl(0.62, 0.22, 0.1, 0, R(p, 100, 116), mat([180, 176, 170]), mat([150, 146, 140]), 0.07);
    for (let z = 20; z < 96; z += 24) p.ring(0.62, 0.22, 0.13, z, mat([120, 110, 100]), 0.9, true);
    p.blinker(0.62, 0.22, p.maxZ + 1, NEON.red, 1.5, 14);
    for (const [u, v] of [
      [0.28, 0.4],
      [0.5, 0.68],
    ]) {
      p.box(u - 0.12, v - 0.12, u + 0.12, v + 0.12, 0, 6, STEEL, { uplight: false });
      p.dome(u, v, 0.18, 2, 26, sm);
      p.lamp(u, v + 0.18, 6, p.pal.neon, 12);
    }
    p.pipe(0.28, 0.4, 16, 0.62, 0.22, 30, 1.4, RUST);
    p.cyl(0.86, 0.84, 0.02, 0, 64, STEEL, STEEL);
    const [x, y] = p.pt(0.86, 0.84, 65);
    p.addFx({ k: 'flame', x, y, ph: p.rng.next() });
    p.track(x - 8, y - 14);
  },
  // Tall fab tower with roof pipes.
  (p) => {
    const w = pick(p, IND_WALL);
    const h = R(p, 76, 86);
    const b: Box = [0.15, 0.15, 0.85, 0.85];
    p.box(...b, 0, h, w, { win: W_SLIT, top: ROOF, trim: p.pal.neon });
    p.ribs(...RIGHT(b), 0, h, 12, w);
    p.stack(0.3, 0.3, 0.06, h, 30);
    p.stack(0.62, 0.3, 0.05, h, 24);
    p.pipe(0.3, 0.6, h + 3, 0.7, 0.6, h + 3, 2, RUST);
    p.box(0.6, 0.55, 0.8, 0.8, h, h + 6, ROOF_DARK);
    p.neon([0.85, 0.85, 6, 0.85, 0.85, h - 6], p.pal.neon2, 0.9);
    p.blinker(0.85, 0.15, h + 2, NEON.red, 1.4, 12);
  },
  // Furnace tower with glowing slag.
  (p) => {
    const w = pick(p, IND_WALL);
    p.box(0.1, 0.1, 0.9, 0.9, 0, 26, w, { win: W_SLIT, top: ROOF });
    p.cyl(0.5, 0.45, 0.28, 26, 70, mat([90, 84, 82]), mat([60, 56, 54]), 0.14);
    p.cyl(0.5, 0.45, 0.14, 70, 92, mat([110, 100, 96]), mat([40, 36, 34]), 0.1);
    const [x, y] = p.pt(0.5, 0.45, 92);
    p.addFx({ k: 'smoke', x, y, r: 6, ph: p.rng.next() });
    p.track(x - 30, y - 60);
    const [gx, gy] = p.pt(0.9, 0.6, 8);
    p.addFx({ k: 'pulse', x: gx, y: gy, size: 30, c: [255, 120, 30], period: 2.4, ph: p.rng.next() });
    p.door(0.9, 0.1, 0.9, 0.9, 0.3, 0.7, 0, 12, [255, 120, 30]);
    p.blinker(0.5, 0.2, 76, NEON.red, 1.7, 12);
  },
  // Silo complex with a conveyor gantry.
  (p) => {
    const m = mat([176, 170, 160]);
    const h1 = R(p, 80, 92);
    p.cyl(0.24, 0.24, 0.13, 0, h1, m, mat([140, 130, 120]), 0.07);
    p.cyl(0.5, 0.2, 0.13, 0, R(p, 70, 78), m, mat([140, 130, 120]), 0.07);
    p.cyl(0.24, 0.52, 0.13, 0, R(p, 62, 70), m, mat([140, 130, 120]), 0.07);
    p.box(0.5, 0.5, 0.88, 0.88, 0, 22, pick(p, IND_WALL), { win: W_SLIT, top: ROOF, trim: p.pal.neon });
    p.pipe(0.24, 0.24, 78, 0.7, 0.7, 22, 2.4, mat([200, 170, 50]));
    p.blinker(0.24, 0.24, h1 + 1, NEON.red, 1.5, 14);
    p.lamp(0.88, 0.7, 18, p.pal.neon, 14);
  },
];

// ════════════════════════════════════════════════════════════════════════════
// LEVEL 0 LOTS — subtle props (or nothing).
// ════════════════════════════════════════════════════════════════════════════

const NONE: Recipe = () => {};

/** Survey post with a small lit "available" sign. */
function surveyPost(p: Painter, u: number, v: number) {
  p.begin_();
  p.m(u, v, 0);
  p.l(u, v, 9);
  p.stroke(p.col(STEEL, 0.6), 0.6);
  p.blade(u, v, 'v', 0.12, 5, 9, p.pal.neon, true);
}

const LOTS: Recipe[][] = [
  // Residential
  [
    NONE,
    (p) => {
      surveyPost(p, 0.7, 0.75);
    },
    NONE,
    (p) => {
      p.bike(0.4, 0.62, p.pal.neon);
      p.crate(0.62, 0.5, 0, 0.06);
    },
    NONE,
    (p) => {
      p.box(0.3, 0.3, 0.56, 0.52, 0, 4, pick(p, TARP), { uplight: false });
      p.crate(0.66, 0.66, 0, 0.07);
    },
    NONE,
    (p) => {
      surveyPost(p, 0.28, 0.72);
      p.crate(0.62, 0.38, 0, 0.06);
    },
  ],
  // Commercial
  [
    NONE,
    (p) => {
      p.box(0.45, 0.6, 0.55, 0.68, 0, 8, mat([60, 60, 80]), { uplight: false });
      p.glow(0.55, 0.64, 5, p.pal.neon, 14, p.glowA());
      p.wallSign(0.55, 0.6, 0.55, 0.68, 0.1, 0.9, 3, 7, p.pal.neon, false);
    },
    NONE,
    (p) => {
      surveyPost(p, 0.72, 0.72);
    },
    NONE,
    (p) => {
      p.bike(0.3, 0.5, p.pal.neon2);
      p.bike(0.34, 0.66, p.pal.neon);
    },
    NONE,
    (p) => {
      p.crate(0.4, 0.4, 0);
      p.crate(0.5, 0.42, 0, 0.06);
      surveyPost(p, 0.76, 0.66);
    },
  ],
  // Industrial
  [
    NONE,
    (p) => {
      p.crate(0.3, 0.3, 0);
      p.crate(0.3, 0.3, 4);
      p.crate(0.42, 0.32, 0);
    },
    NONE,
    (p) => {
      p.fence([0.1, 0.9, 0.9, 0.9, 0.9, 0.1]);
    },
    NONE,
    (p) => {
      p.container(0.25, 0.35, 0.7, 0.6, 0, 7, pick(p, CONTAINER));
    },
    NONE,
    (p) => {
      for (let i = 0; i < 3; i++) p.cyl(0.4 + i * 0.08, 0.6, 0.035, 0, 4.5, mat([60, 100, 150]), mat([50, 80, 120]));
      surveyPost(p, 0.72, 0.3);
    },
  ],
];

/** [zone-1][level-1][form] */
export const ZONE_RECIPES: Recipe[][][] = [
  [RES1, RES2, RES3],
  [COM1, COM2, COM3],
  [IND1, IND2, IND3],
];
export const LOT_RECIPES = LOTS;
export const FORMS = 8;
