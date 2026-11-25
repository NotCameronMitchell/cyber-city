// ─────────────────────────────────────────────────────────────────────────────
// Landmarks and new civic buildings (docs/MEGACITY.md §6.3), plus the annex-only
// structures: Skeleton Row's tower frames and the Sunk's old pump hall with its
// looks after the ch4.brine choice (§9.3).
//
// Civic and utility:  Floodwatch Station, Pump House (working / pump garden),
//   Canopy Park, Med Tower, Reclaim Works, Metro Station, Market Hall, Tidal
//   Turbine (on open water), Geothermal Bore, Data Vault.
// Landmarks:  Charter Hall (Board), Hexworks (Basalt), Pearl Atrium (Nacre),
//   Hullhouse (Undertow), Kite Mast (Kites), Lamp Choir (Tuning) in their
//   faction language with its signature; Harbour Beacon (a sweeping beam), Arc
//   Arena, Halo Lookout, Grand Terminal.
//
// Footprints span 0..size; heights are world px. The tall ones keep a solid
// facade near their `roof` so skybridges attach to something (heights.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { BuildingType } from '../../game/types';
import { NEON, css, mix, type RGB } from '../palette';
import { antennaForest, buttressHall, charterBlock, choirRing, coilBelfry, craneHab, FACTION_PALS, gantrySpine, haloAtrium, hexColumn, hullStack, lampChapel, netLoft, openBelfry, pearlDrop, ribbonTwins, sailCanopy, type DCtx } from './faction';
import { GLASS, mat, type ArtPal, type Mat, type Painter, type WinSpec } from './painter';
import { arch, ball, clockFace, crane, flag, hexPrism, hull, lampString, lattice, pole, pyramid, sail } from './parts';
import type { Recipe } from './zones';

const CONC = mat([124, 126, 140]);
const PAD = mat([96, 98, 110]);
const ROOF = mat([104, 100, 112]);
const DARK = mat([72, 70, 84]);
const STEEL = mat([140, 144, 152]);
const WHITE = mat([214, 220, 226], [44, 48, 64]);
const LAWN = mat([86, 150, 96], [14, 38, 30]);
const WATER = mat([60, 120, 150], [10, 26, 44]);
const BRICK = mat([128, 82, 66], [30, 18, 22]);
const W_GRID: WinSpec = { style: 'grid', floor: 7, col: 6, w: 0.55, h: 0.5 };
const W_BAND: WinSpec = { style: 'band', floor: 8, col: 7, w: 1, h: 0.45 };
const W_CURT: WinSpec = { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 };
const W_SLIT: WinSpec = { style: 'slit', floor: 9, col: 7, w: 0.25, h: 0.6, lit: 0.9 };

const pal = (neon: RGB, neon2: RGB, up: RGB, warm = 0.4, cool = 0.4): ArtPal => ({ neon, neon2, up, warm, cool });

function slab(p: Painter, s: number, m: Mat = PAD, z = 1.2) {
  p.box(0.04, 0.04, s - 0.04, s - 0.04, 0, z, m, { uplight: false });
}
function warn(p: Painter, u: number, v: number, z: number) {
  const [x, y] = p.pt(u, v, z);
  p.addFx({ k: 'warn', x, y, ph: p.rng.next() });
  p.track(x - 9, y - 9);
}
const dctx = (b: [number, number, number, number], z0: number, h: number, banners = true): DCtx => ({ b, z0, h, banners });

// ════════════════════════════════════════════════════════════════════════════
// CIVIC AND UTILITY
// ════════════════════════════════════════════════════════════════════════════

/** Floodwatch Station: a tide-gauge tower, pump house and a flood barrier with gates. */
const floodwatch: Recipe = (p) => {
  slab(p, 2, mat([110, 120, 130]), 1);
  // The barrier wall along the front with two lifting gates.
  p.box(0.06, 1.7, 1.94, 1.86, 1, 9, CONC, { top: mat([150, 154, 164]) });
  for (const t of [0.35, 0.75]) p.door(0.06, 1.86, 1.94, 1.86, t - 0.1, t + 0.1, 1, 8, null);
  p.neon([0.06, 1.86, 9, 1.94, 1.86, 9], [255, 210, 60], 0.7);
  // The pump house and the gauge tower with its level stripes.
  p.box(0.15, 0.2, 1.1, 1.5, 1, 20, WHITE, { win: W_BAND, top: ROOF, trim: p.pal.neon });
  p.box(1.3, 0.25, 1.75, 0.7, 1, 48, WHITE, { win: { style: 'slit', floor: 8, col: 4, w: 0.4, h: 0.6 }, top: DARK });
  for (let z = 6; z < 46; z += 8) p.box(1.75, 0.25, 1.78, 0.7, z, z + 3, mat([60, 130, 220]), { uplight: false });
  p.box(1.25, 0.2, 1.8, 0.75, 48, 54, mat([60, 70, 90]), { win: { style: 'band', floor: 6, col: 4, w: 1, h: 0.5, lit: 1.5 }, top: DARK, trim: p.pal.neon });
  p.antenna(1.5, 0.45, 54, 14, NEON.blue);
  p.pipe(1.1, 0.8, 4, 1.6, 1.7, 4, 2.2, mat([80, 140, 190]));
  p.lamp(1.95, 1.0, 10, [150, 220, 255], 14);
  warn(p, 0.6, 0.8, 24);
};

/** Pump House: a brick pump house with a big pipe to the water; `garden` = the pump garden it becomes. */
function pumphouse(garden: boolean): Recipe {
  return (p) => {
    slab(p, 1, garden ? LAWN : PAD, 0.8);
    if (garden) {
      p.greens(0.1, 0.1, 0.9, 0.9, 0.8, 7);
      p.box(0.3, 0.3, 0.62, 0.62, 0.8, 9, BRICK, { win: { style: 'grid', floor: 8, col: 8, w: 0.5, h: 0.5 }, top: LAWN });
      p.greens(0.32, 0.32, 0.6, 0.6, 9, 3);
      for (const [u, v] of [
        [0.15, 0.85],
        [0.85, 0.15],
        [0.85, 0.85],
      ] as const)
        p.lamp(u, v, 5, [255, 220, 150], 10);
      p.bench(0.6, 0.85, 'u');
      return;
    }
    p.box(0.14, 0.18, 0.7, 0.8, 0.8, 14, BRICK, { win: { style: 'grid', floor: 8, col: 8, w: 0.5, h: 0.5 }, noTop: true });
    p.gable(0.12, 0.16, 0.72, 0.82, 14, 5, mat([90, 96, 92]), 'v');
    p.box(0.7, 0.4, 0.92, 0.62, 0.8, 7, STEEL, { uplight: false });
    p.pipe(0.8, 0.5, 4, 1.05, 0.5, 1, 3, mat([90, 110, 100]));
    p.stack(0.3, 0.3, 0.05, 14, 8, false);
    p.lamp(0.72, 0.8, 9, [182, 255, 46], 10);
    const [x, y] = p.pt(0.98, 0.5, 1);
    p.addFx({ k: 'pulse', x, y, size: 20, c: [120, 200, 255], period: 2.4, ph: 0 });
    warn(p, 0.4, 0.5, 18);
  };
}

/** Canopy Park: big shade trees over winding paths, a pavilion and a pond. */
const canopypark: Recipe = (p) => {
  slab(p, 3, LAWN, 0.6);
  p.box(1.9, 1.9, 2.7, 2.7, 0.2, 0.7, WATER, { uplight: false, top: WATER });
  // Paths.
  if (p.g && !p.lod) {
    p.begin_();
    p.m(0.1, 1.5, 0.7);
    p.l(1.2, 1.4, 0.7);
    p.l(1.6, 2.9, 0.7);
    p.m(1.4, 0.1, 0.7);
    p.l(1.3, 1.4, 0.7);
    p.l(2.9, 1.6, 0.7);
    p.stroke(p.col(mat([200, 190, 160]), 1), 3);
  }
  // Tall canopy trees: trunk + layered crowns.
  const trees: [number, number, number][] = [
    [0.5, 0.5, 28],
    [1.2, 0.45, 22],
    [2.3, 0.6, 30],
    [0.5, 1.2, 24],
    [0.6, 2.3, 26],
    [2.5, 1.3, 20],
    [1.25, 2.55, 22],
  ];
  const leaf = mat([60, 132, 84], [10, 34, 30]);
  const leaf2 = mat([90, 170, 100], [16, 48, 38]);
  for (const [u, v, h] of trees) {
    pole(p, u, v, 0.6, h * 0.6, mat([96, 74, 56]), 1.6);
    for (let k = 0; k < 3; k++) {
      const [x, y] = p.pt(u, v, h * (0.55 + k * 0.17));
      const r = 12 - k * 3;
      p.track(x - r, y - r);
      p.track(x + r, y + r * 0.6);
      p.reach(h);
      if (p.g) {
        p.g.beginPath();
        p.g.ellipse(x, y, r * 1.2, r * 0.75, 0, 0, Math.PI * 2);
        p.g.fillStyle = p.col(k === 2 ? leaf2 : leaf, 0.9 + k * 0.12);
        p.g.fill();
      }
    }
  }
  // Pavilion and lights.
  p.cyl(1.5, 1.5, 0.22, 0.6, 7, WHITE, mat([200, 120, 90]));
  pyramid(p, 1.25, 1.25, 1.75, 1.75, 7, 6, mat([200, 120, 90]));
  for (let i = 0; i < 6; i++) p.lamp(0.3 + i * 0.45, 1.45 - i * 0.02, 4, [255, 230, 170], 10);
  p.fence([0.04, 2.96, 2.96, 2.96, 2.96, 0.04], 2.5);
};

/** Med Tower: a white tower of wards on a podium, a helipad and the heartbeat sign. */
const medtower: Recipe = (p) => {
  slab(p, 3, mat([150, 156, 160]), 1);
  const teal: Mat = { day: [96, 170, 180], night: [10, 30, 40] };
  p.chamfer(0.12, 0.12, 2.88, 2.88, 0.35, 1, 26, WHITE, { win: W_BAND, glass: teal, top: mat([180, 186, 190]), trim: p.pal.neon });
  p.chamfer(0.5, 0.5, 2.1, 2.4, 0.25, 26, 170, WHITE, { win: { style: 'band', floor: 7, col: 7, w: 1, h: 0.5 }, glass: teal, top: mat([180, 186, 190]), trim: p.pal.neon });
  p.chamfer(2.1, 0.7, 2.6, 1.6, 0.1, 26, 120, mat([180, 210, 214], [34, 48, 56]), { win: W_GRID, top: mat([170, 176, 180]) });
  p.neon([2.1, 2.4, 30, 2.1, 2.4, 166], p.pal.neon, 1.1);
  // The heartbeat sign high on the left face.
  p.begin_();
  p.quad(0.8, 2.4, 140, 1.9, 2.4, 140, 1.9, 2.4, 156, 0.8, 2.4, 156);
  p.fill(p.col(mat([20, 24, 34], [6, 8, 14]), 0.8));
  const [ox, oy] = p.pt(0.8, 2.4, 140);
  const [x1, y1] = p.pt(1.9, 2.4, 140);
  p.addFx({ k: 'ecg', ox, oy, ex: x1 - ox, ey: y1 - oy, h: 16, c1: [90, 255, 220], ph: 0 });
  p.neon([0.85, 2.4, 148, 1.1, 2.4, 148, 1.16, 2.4, 154, 1.24, 2.4, 142, 1.3, 2.4, 148, 1.85, 2.4, 148], [90, 255, 220], 0.7);
  p.padMark(1.3, 1.45, 0.42, 170, [90, 255, 220]);
  p.blinker(0.7, 0.7, 172, [90, 255, 220], 1.2, 12);
  p.door(0.4, 2.88, 2.6, 2.88, 0.35, 0.65, 1, 9, [180, 255, 240]);
  p.box(1.0, 2.88, 2.0, 3.05, 8, 9, mat([70, 170, 170], [14, 46, 52]), { uplight: false });
  warn(p, 1.5, 1.5, 172);
};

/** Reclaim Works: filter beds, settling tanks and a soil conveyor. */
const reclaim: Recipe = (p) => {
  slab(p, 2, mat([104, 100, 92]), 0.8);
  const bed = mat([90, 150, 96], [16, 40, 30]);
  for (let i = 0; i < 3; i++) p.box(0.12 + i * 0.4, 0.12, 0.46 + i * 0.4, 0.9, 0.8, 3, CONC, { top: bed });
  for (const [u, v] of [
    [0.45, 1.4],
    [1.0, 1.55],
  ] as const) {
    p.cyl(u, v, 0.26, 0.8, 9, CONC, mat([80, 120, 110], [14, 30, 30]));
    p.neonRing(u, v, 0.26, 9, p.pal.neon, 0.9, true);
  }
  p.box(1.4, 0.95, 1.9, 1.9, 0.8, 22, mat([150, 160, 140], [30, 34, 32]), { win: W_SLIT, top: ROOF, trim: p.pal.neon });
  p.pipe(0.3, 1.0, 6, 1.4, 1.3, 16, 3, mat([140, 120, 90]));
  p.stack(1.75, 1.1, 0.06, 22, 16, false);
  p.glow(0.6, 0.5, 4, [140, 255, 160], 60, p.glowA() * 0.6);
  warn(p, 1.65, 1.4, 26);
};

/** Metro Station: a glass entrance pavilion over stairs down, with a lit route sign. */
const metro: Recipe = (p) => {
  slab(p, 1, PAD, 0.8);
  // The stairwell opening, lit from below.
  p.box(0.2, 0.45, 0.62, 0.9, 0.2, 0.8, mat([30, 32, 40]), { uplight: false, top: mat([24, 24, 32]) });
  p.glow(0.41, 0.68, 0.8, [255, 230, 170], 30, p.glowA() * 0.8);
  const glass: Mat = { day: [110, 160, 190], night: [14, 28, 50] };
  p.box(0.15, 0.12, 0.85, 0.42, 0.8, 12, mat([120, 160, 190], [20, 30, 50]), { win: W_CURT, glass, top: mat([170, 190, 210]) });
  arch(p, 0.12, 0.12, 0.88, 0.45, 12, 4, mat([160, 200, 220], [24, 40, 60]), 'u');
  // The route sign: an invented stacked-chevron pictogram on a pole.
  pole(p, 0.8, 0.85, 0.8, 16, STEEL, 0.8);
  p.box(0.74, 0.8, 0.86, 0.9, 14, 20, mat([30, 30, 44]), { uplight: false });
  p.neon([0.75, 0.9, 15.5, 0.8, 0.9, 18.5, 0.85, 0.9, 15.5], p.pal.neon, 0.9);
  p.neon([0.75, 0.9, 17, 0.8, 0.9, 20, 0.85, 0.9, 17], p.pal.neon2, 0.7);
  p.lamp(0.2, 0.9, 6, [255, 230, 170], 10);
  warn(p, 0.5, 0.3, 16);
};

/** Market Hall: a covered market under a glazed barrel roof, stalls at its open ends. */
const markethall: Recipe = (p) => {
  slab(p, 2, mat([150, 140, 120]), 0.8);
  p.box(0.12, 0.12, 1.88, 1.88, 0.8, 16, mat([176, 128, 80], [36, 26, 22]), { win: { style: 'grid', floor: 8, col: 7, w: 0.6, h: 0.55, lit: 1.3 }, noTop: true });
  arch(p, 0.08, 0.08, 1.92, 1.92, 16, 12, mat([120, 170, 190], [20, 40, 60]), 'u');
  for (let j = 0; j < 4; j++) p.door(0.12, 1.88, 1.88, 1.88, (j + 0.15) / 4, (j + 0.85) / 4, 0.8, 9, j % 2 ? [255, 214, 150] : p.pal.neon);
  p.awning(0.12, 1.88, 1.88, 1.88, 10, 0.12, p.pal.neon, true);
  p.wallSign(1.88, 0.12, 1.88, 1.88, 0.2, 0.8, 11, 15, p.pal.neon2);
  p.glow(1.0, 1.0, 20, [255, 214, 150], 90, p.glowA() * 0.6);
  for (let i = 0; i < 5; i++) p.crate(0.2 + i * 0.32, 1.95, 0);
  warn(p, 1.0, 1.0, 30);
};

/** Tidal Turbine: a turbine housing on piers over open water, its rotor churning under the surface. */
const tidal: Recipe = (p) => {
  // No slab: it stands on water. Foam rings where the rotors turn.
  for (const [u, v] of [
    [0.55, 1.0],
    [1.45, 1.0],
  ] as const) {
    p.ring(u, v, 0.36, 0.3, mat([200, 230, 240], [60, 90, 110]), 1.4);
    const [x, y] = p.pt(u, v, 0.3);
    p.addFx({ k: 'pulse', x, y, size: 40, c: [120, 220, 255], period: 1.8, ph: u });
    p.track(x - 22, y - 12);
  }
  for (const [u, v] of [
    [0.25, 0.4],
    [1.75, 0.4],
    [0.25, 1.6],
    [1.75, 1.6],
  ] as const)
    p.box(u - 0.06, v - 0.06, u + 0.06, v + 0.06, 0, 10, CONC, { uplight: false, top: CONC });
  p.box(0.15, 0.3, 1.85, 1.7, 10, 13, mat([150, 156, 166]), { uplight: false });
  // The nacelle housing and the service crane.
  p.box(0.4, 0.75, 1.6, 1.25, 13, 24, mat([200, 210, 220], [36, 40, 56]), { win: W_BAND, top: mat([180, 190, 200]), trim: p.pal.neon });
  p.cyl(1.0, 1.0, 0.18, 24, 28, mat([200, 210, 220]), mat([160, 170, 180]));
  crane(p, 1.7, 0.4, 13, 16, 0.6, mat([236, 196, 60]));
  p.neon([0.15, 1.7, 13, 1.85, 1.7, 13, 1.85, 0.3, 13], [255, 210, 60], 0.6);
  p.blinker(0.25, 1.6, 12, NEON.green, 2.2, 10);
  warn(p, 1.0, 1.0, 30);
};

/** Geothermal Bore: a drill derrick over the well, steam vents and insulated pipes. */
const geothermal: Recipe = (p) => {
  slab(p, 2, mat([130, 120, 110]), 1);
  lattice(p, 0.35, 0.35, 0.85, 0.85, 1, 58, mat([200, 160, 60]), 9, 0.9);
  p.box(0.45, 0.45, 0.75, 0.75, 1, 12, mat([120, 110, 100]), { top: DARK });
  pyramid(p, 0.3, 0.3, 0.9, 0.9, 58, 8, mat([200, 160, 60]));
  p.box(1.1, 0.25, 1.85, 1.0, 1, 18, mat([150, 140, 130], [30, 28, 32]), { win: W_GRID, top: ROOF, trim: p.pal.neon });
  p.pipe(0.75, 0.9, 6, 1.6, 1.7, 6, 3, mat([200, 200, 200]));
  p.pipe(0.9, 0.6, 8, 1.1, 0.6, 8, 2.6, mat([200, 200, 200]));
  for (const [u, v] of [
    [1.4, 1.6],
    [1.75, 1.3],
  ] as const) {
    p.cyl(u, v, 0.1, 1, 8, CONC, DARK);
    const [x, y] = p.pt(u, v, 8);
    p.addFx({ k: 'smoke', x, y, r: 6, ph: p.rng.next() });
  }
  p.glow(0.6, 0.6, 6, [255, 140, 60], 50, p.glowA() * 0.6);
  p.blinker(0.6, 0.6, 67, NEON.red, 1.6, 12);
  warn(p, 1.5, 0.6, 22);
};

/** Data Vault: a windowless armoured block with cooling fins and a cold data glow. */
const datavault: Recipe = (p) => {
  slab(p, 3, PAD, 1);
  const armour = mat([70, 76, 92], [14, 16, 26]);
  p.chamfer(0.2, 0.2, 2.8, 2.8, 0.4, 1, 34, armour, { top: DARK, trim: p.pal.neon });
  // Cooling fins on the two visible faces.
  for (let i = 0; i < 12; i++) {
    const t = 0.6 + (i * 1.8) / 12;
    p.box(t - 0.02, 2.8, t + 0.02, 2.9, 3, 30, mat([110, 116, 130]), { uplight: false });
    p.box(2.8, t - 0.02, 2.9, t + 0.02, 3, 30, mat([110, 116, 130]), { uplight: false });
  }
  p.box(0.8, 0.8, 2.2, 2.2, 34, 44, armour, { top: DARK });
  for (const [u, v] of [
    [1.1, 1.1],
    [1.9, 1.1],
    [1.1, 1.9],
    [1.9, 1.9],
  ] as const) {
    p.cyl(u, v, 0.16, 44, 47, mat([150, 150, 160]), mat([40, 44, 56]));
    p.glow(u, v, 47, p.pal.neon, 26, p.glowA() * 0.6);
  }
  p.neon([0.6, 2.8, 8, 2.4, 2.8, 8], p.pal.neon, 1);
  p.neon([2.8, 0.6, 8, 2.8, 2.4, 8], p.pal.neon, 1);
  p.door(0.2, 2.8, 2.8, 2.8, 0.45, 0.55, 1, 8, p.pal.neon);
  const [x, y] = p.pt(1.5, 1.5, 48);
  p.addFx({ k: 'beam', x, y, h: 90, c: p.pal.neon, ph: p.rng.next() });
  p.track(x - 4, y - 90);
  warn(p, 1.5, 1.5, 50);
};

// ════════════════════════════════════════════════════════════════════════════
// LANDMARKS
// ════════════════════════════════════════════════════════════════════════════

/** Charter Hall (Board): the civic language at its grandest, a dome and nine flags. */
const charterhall: Recipe = (p) => {
  slab(p, 3, mat([190, 190, 182], [40, 40, 48]), 1.2);
  charterBlock(p, dctx([0.08, 0.08, 2.92, 2.92], 1.2, 96));
  // A broad stair at the front.
  for (let s = 0; s < 4; s++) p.box(0.9 - s * 0.04, 2.92 - 0.02 + s * 0.03, 2.1 + s * 0.04, 2.95 + s * 0.03, 0, 1.2 + s * 1.4, mat([214, 214, 206], [44, 44, 52]), { uplight: false });
  warn(p, 1.5, 1.5, 70);
};

/** Hexworks (Basalt): a hex furnace spine between two buttress halls; tall. */
const hexworks: Recipe = (p) => {
  slab(p, 4, mat([70, 66, 70]), 1.5);
  buttressHall(p, dctx([0.1, 2.3, 3.9, 3.9], 1.5, 70));
  buttressHall(p, dctx([2.3, 0.1, 3.9, 2.2], 1.5, 60));
  gantrySpine(p, dctx([0.2, 0.2, 2.2, 2.2], 1.5, 230));
  hexColumn(p, dctx([2.4, 2.4, 3.6, 3.6], 1.5, 120));
  warn(p, 2, 2, 90);
};

/** Pearl Atrium (Nacre): a great pearl dome with floating halos between ribbon towers; tall. */
const pearlatrium: Recipe = (p) => {
  slab(p, 3, mat([200, 190, 206], [40, 30, 50]), 1.2);
  ribbonTwins(p, dctx([0.05, 0.05, 1.6, 1.6], 1.2, 210));
  haloAtrium(p, dctx([0.9, 0.9, 2.95, 2.95], 1.2, 150));
  warn(p, 1.5, 1.5, 60);
};

/** Hullhouse (Undertow): a long hall under three upturned hulls, containers and nets. */
const hullhouse: Recipe = (p) => {
  // A great upturned hull raised on a yard of stacked containers, a hull-stack tower on its corner, a dock crane with
  // nets and green lamps: the Undertow's hall, asymmetric, made of at least three materials, everything hung.
  slab(p, 3, mat([90, 86, 80], [18, 18, 20]), 1);
  const rust = mat([132, 84, 60], [30, 18, 16]);
  const green = mat([56, 92, 80], [12, 22, 22]);
  const CONT: RGB[] = [[132, 84, 60], [60, 120, 140], [56, 92, 80], [150, 120, 60]];
  // The container yard: two rows, three high, staggered.
  for (let L = 0; L < 3; L++)
    for (let r = 0; r < 3; r++) {
      const sh = ((L + r) % 2) * 0.1;
      p.container(0.12 + sh, 0.15 + r * 0.78, 2.15 - sh, 0.85 + r * 0.78, 1 + L * 9, 8.6, CONT[(L + r) % 4]);
    }
  // The hall under the keel: a capsule-windowed wall on the yard, the hull over the whole span.
  p.box(0.2, 0.2, 2.1, 2.45, 28, 40, rust, { win: { style: 'capsule', floor: 6, col: 6, w: 0.6, h: 0.5, lit: 1.4 }, noTop: true });
  hull(p, 0.05, 0.1, 2.3, 2.6, 40, 20, green);
  // The corner tower: a hull stack, and a crane leaning out over the canal.
  hullStack(p, dctx([2.15, 1.95, 2.95, 2.95], 1, 84));
  crane(p, 2.6, 0.45, 1, 92, 1.6, mat([200, 160, 60]));
  p.laundry(0.3, 2.62, 1.6, 2.62, 30);
  p.laundry(2.18, 0.4, 2.18, 1.6, 22);
  lampString(p, [0.2, 2.7, 27], [2.1, 2.7, 24], 9, [182, 255, 46], 3, 8);
  lampString(p, [2.3, 0.2, 50], [2.3, 2.5, 34], 7, [182, 255, 46], 4, 7);
  p.door(0.15, 2.6, 2.1, 2.6, 0.2, 0.45, 1, 10, [182, 255, 46]);
  p.wallSign(0.2, 2.45, 2.1, 2.45, 0.6, 0.9, 30, 37, [182, 255, 46], true);
  warn(p, 1.5, 1.2, 40);
};

/** Kite Mast (Kites): the tallest mast in the city, strung with kites and relays; takes 6 skybridges. */
const kitemast: Recipe = (p) => {
  slab(p, 2, mat([96, 92, 110]), 1);
  // The platform hab the bridges reach, then the mast above.
  p.box(0.25, 0.25, 1.75, 1.75, 1, 12, mat([110, 104, 130], [22, 20, 32]), { win: W_GRID, top: mat([84, 80, 100]) });
  p.box(0.5, 0.5, 1.5, 1.5, 12, 200, mat([120, 112, 140], [24, 22, 34]), { win: { style: 'grid', floor: 7, col: 5, w: 0.5, h: 0.5, lit: 1.4 }, top: mat([84, 80, 100]), trim: [201, 162, 255] });
  lattice(p, 0.38, 0.38, 1.62, 1.62, 12, 210, mat([40, 40, 48]), 12, 0.7);
  pole(p, 1, 1, 200, 290, mat([40, 40, 48]), 1.4);
  for (let z = 40; z < 200; z += 40) sail(p, 1.68, 1.0, z, 0.35, 16, mat([236, 236, 246], [52, 50, 70]), [201, 162, 255]);
  lampString(p, [1, 1, 290], [2.4, 2.2, 160], 10, [201, 162, 255], 10, 7);
  lampString(p, [1, 1, 290], [-0.4, 2.2, 150], 10, [255, 214, 150], 10, 7);
  for (const z of [120, 220, 260]) p.dish(1.1, 0.9, z, 0.07);
  p.blinker(1, 1, 291, [201, 162, 255], 1.2, 22);
  const [x, y] = p.pt(1.8, 0.2, 300);
  p.addSig({ k: 'kite', x, y, c: [201, 162, 255] });
  p.addSig({ k: 'tips', x: p.X(1, 1), y: p.Y(1, 1, 290), c: [201, 162, 255], n: 0 });
  p.track(x - 30, y - 40);
  warn(p, 1, 1, 30);
};

/** Lamp Choir (Tuning): a ring of lantern windows around a candle court. */
const lampchoir: Recipe = (p) => {
  slab(p, 2, mat([200, 190, 160], [40, 36, 30]), 1);
  choirRing(p, dctx([0.05, 0.05, 1.95, 1.95], 1, 46));
  warn(p, 1, 1, 30);
};

/** Harbour Beacon: a striped lighthouse on a stone foot; its beam sweeps the bay at night. */
const beacon: Recipe = (p) => {
  slab(p, 1, mat([150, 146, 136]), 1);
  p.cyl(0.5, 0.5, 0.36, 1, 8, mat([170, 166, 156]), mat([150, 146, 136]));
  const white = mat([232, 230, 226], [50, 50, 64]);
  const red = mat([200, 70, 70], [40, 16, 20]);
  for (let i = 0; i < 6; i++) p.cyl(0.5, 0.5, 0.24 - i * 0.012, 8 + i * 14, 22 + i * 14, i % 2 ? red : white, white, 0.24 - (i + 1) * 0.012);
  p.cyl(0.5, 0.5, 0.2, 92, 104, mat([60, 70, 90], [20, 24, 40]), DARK);
  p.glow(0.5, 0.5, 98, [255, 240, 200], 60, p.glowA() * 0.9 + 0.1);
  p.lamp(0.5, 0.5, 98, [255, 240, 200], 16);
  p.dome(0.5, 0.5, 0.22, 104, 7, red);
  pole(p, 0.5, 0.5, 111, 118, STEEL, 0.6);
  const [x, y] = p.pt(0.5, 0.5, 98);
  p.addSig({ k: 'sweep', x, y, c: [255, 240, 200], len: 260 });
  p.track(x - 40, y - 40);
  warn(p, 0.5, 0.5, 20);
};

/** Arc Arena: an oval bowl with a lit rim, giant screens and floodlight masts. */
const arena: Recipe = (p) => {
  slab(p, 4, PAD, 1);
  const shell = mat([180, 184, 196], [36, 38, 56]);
  // The bowl: stacked rings narrowing inward, the pitch glowing inside.
  p.cyl(2, 2, 1.85, 1, 30, shell, mat([60, 130, 80], [14, 40, 30]), 1.7);
  p.cylBands(2, 2, 1.85, 4, 28, 8);
  p.cyl(2, 2, 1.25, 30, 31, mat([60, 130, 80], [14, 40, 30]), mat([70, 150, 90], [20, 60, 40]));
  p.neonRing(2, 2, 1.72, 30, p.pal.neon, 1.6, true);
  p.neonRing(2, 2, 1.85, 12, p.pal.neon2, 1.2, true);
  p.glow(2, 2, 34, [200, 255, 220], 200, p.glowA() * 0.45);
  // Floodlight masts at the corners.
  for (const [u, v] of [
    [0.35, 0.35],
    [3.65, 0.35],
    [0.35, 3.65],
    [3.65, 3.65],
  ] as const) {
    pole(p, u, v, 1, 64, STEEL, 1.1);
    p.box(u - 0.08, v - 0.08, u + 0.08, v + 0.08, 60, 66, mat([60, 60, 70]), { uplight: false });
    p.lamp(u, v, 63, [240, 250, 255], 20);
  }
  // A screen on the front.
  p.board(0.7, 3.7, 2.6, 3.7, 0, 1, 14, 40, 2, p.pal.neon, p.pal.neon2);
  pole(p, 1.0, 3.7, 1, 14, STEEL, 0.8);
  pole(p, 2.3, 3.7, 1, 14, STEEL, 0.8);
  warn(p, 2, 2, 40);
};

/** Halo Lookout: an observation tower with a floating halo deck; bridged into a Sky Lobby. */
const halolookout: Recipe = (p) => {
  slab(p, 2, mat([110, 110, 126]), 1);
  p.chamfer(0.2, 0.2, 1.8, 1.8, 0.4, 1, 14, mat([150, 160, 180], [30, 34, 50]), { win: W_BAND, top: DARK });
  p.cyl(1, 1, 0.4, 14, 196, mat([90, 110, 140], [16, 20, 36]), DARK, 0.34);
  p.cylBands(1, 1, 0.38, 16, 190, 7);
  // The halo observation deck: a wide lit ring with a glass rim.
  p.cyl(1, 1, 0.82, 196, 206, mat([200, 214, 230], [40, 46, 70]), mat([170, 190, 210]));
  p.cylBands(1, 1, 0.82, 197, 205, 5);
  p.neonRing(1, 1, 0.86, 200, p.pal.neon, 1.6, true);
  p.neonRing(1, 1, 1.0, 214, p.pal.neon2, 1, true);
  p.glow(1, 1, 206, p.pal.neon, 120, p.glowA() * 0.5);
  pole(p, 1, 1, 206, 250, STEEL, 1);
  p.blinker(1, 1, 251, NEON.red, 1.3, 18);
  const [x, y] = p.pt(1, 1, 214);
  p.addSig({ k: 'halo', x, y, rx: 45, ry: 22, c: p.pal.neon2 });
  p.track(x - 48, y - 24);
  warn(p, 1, 1, 30);
};

/** Grand Terminal: a vaulted glass station hall with a clock tower and a canopy over the forecourt. */
const terminal: Recipe = (p) => {
  slab(p, 4, mat([150, 146, 140]), 1);
  const stone = mat([196, 186, 170], [40, 36, 40]);
  p.box(0.2, 0.3, 3.8, 3.4, 1, 26, stone, { win: { style: 'grid', floor: 9, col: 7, w: 0.5, h: 0.6, lit: 1.3 }, noTop: true });
  arch(p, 0.15, 0.25, 3.85, 3.45, 26, 26, mat([130, 180, 200], [20, 40, 60]), 'u');
  // Clock tower at the front corner.
  p.box(3.1, 2.9, 3.7, 3.5, 1, 74, stone, { win: W_GRID, top: DARK });
  clockFace(p, 3.4, 3.5, 62, 9, mat([255, 243, 196], [70, 60, 40]), [255, 220, 160]);
  p.addSig({ k: 'clock', x: p.X(3.4, 3.5), y: p.Y(3.4, 3.5, 62), r: 9 });
  pyramid(p, 3.05, 2.85, 3.75, 3.55, 74, 14, mat([120, 180, 160], [22, 40, 40]));
  // Forecourt canopy and the entrance arches.
  for (let j = 0; j < 5; j++) p.door(0.2, 3.4, 3.1, 3.4, (j + 0.15) / 5, (j + 0.85) / 5, 1, 14, [255, 230, 180]);
  p.box(0.4, 3.45, 2.9, 3.85, 12, 13.5, mat([170, 190, 210], [30, 40, 60]), { uplight: false });
  p.glow(2, 1.8, 30, [255, 230, 180], 200, p.glowA() * 0.5);
  p.wallSign(0.2, 3.4, 3.1, 3.4, 0.3, 0.7, 17, 24, p.pal.neon);
  warn(p, 2, 2, 50);
};

// ════════════════════════════════════════════════════════════════════════════
// ANNEX-ONLY STRUCTURES
// ════════════════════════════════════════════════════════════════════════════

/** Tower frame (Skeleton Row): a bare concrete frame, half its floors poured, a crane frozen mid-swing. */
const frame: Recipe = (p) => {
  slab(p, 4, mat([120, 118, 112]), 1);
  const raw = mat([156, 152, 144], [34, 32, 36]);
  for (let z = 1; z < 96; z += 12) p.box(0.4, 0.4, 3.6, 3.6, z, z + 2, raw, { uplight: false, top: mat([140, 138, 132]) });
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      if (i > 0 && i < 3 && j > 0 && j < 3) continue;
      const u = 0.45 + i * 1.03;
      const v = 0.45 + j * 1.03;
      p.box(u, v, u + 0.1, v + 0.1, 1, 97 - (i + j === 6 ? 24 : 0), raw, { uplight: false });
    }
  // Tarps flapping on one bay and rebar sticking out of the top.
  p.box(0.4, 3.58, 1.6, 3.62, 26, 49, mat([70, 110, 150], [14, 22, 34]), { uplight: false });
  if (p.g && !p.lod) {
    p.begin_();
    for (let k = 0; k < 10; k++) {
      const u = 0.45 + k * 0.32;
      p.m(u, 3.6, 97);
      p.l(u, 3.6, 103);
    }
    p.stroke(p.col(mat([120, 70, 50]), 0.9), 0.5);
  }
  crane(p, 3.3, 0.6, 1, 128, 2.6, mat([236, 196, 60]));
};

/**
 * The old pump hall (the Sunk, §3.7, §9.3). Looks: 0 sealed (dark in the fog), 1 the open hall (doors open, causeway
 * lamps, a glowing names wall), 2 private works (fenced, dark, a faded sign), 3 the archive (Board flag, guard box, one
 * lit window), 4 poured over (a slab), 5 every lamp lit (every window and a figure with a lamp), 6 Ohm's door (lamps
 * ring the door).
 */
export function pumphallRecipe(look: number): Recipe {
  return (p) => {
    slab(p, 3, mat([92, 90, 84], [18, 18, 20]), 1.5);
    if (look === 4) {
      // Poured over: a blank concrete slab with a vent.
      p.box(0.1, 0.1, 2.9, 2.9, 1.5, 14, mat([150, 148, 140], [30, 30, 34]), { top: mat([140, 138, 132]) });
      p.cyl(1.5, 1.5, 0.12, 14, 20, CONC, DARK);
      return;
    }
    const brick = mat([110, 80, 66], [24, 16, 18]);
    const allLit = look === 5;
    const lit = look === 1 || allLit;
    p.box(0.25, 0.3, 2.75, 2.5, 1.5, 34, brick, { win: { style: 'grid', floor: 10, col: 9, w: 0.45, h: 0.6, lit: allLit ? 6 : lit ? 1.6 : 0.05 }, noTop: true });
    p.gable(0.2, 0.25, 2.8, 2.55, 34, 14, mat([80, 90, 86], [16, 20, 20]), 'u');
    // The pump chimney and the outfall arch on the water side.
    p.stack(0.6, 0.6, 0.12, 34, 26, false);
    p.box(1.0, 2.5, 2.0, 2.95, 1.5, 6, CONC, { uplight: false });
    const doorLit: RGB | null = lit ? [255, 214, 150] : look === 3 ? null : null;
    p.door(0.25, 2.5, 2.75, 2.5, 0.38, 0.62, 1.5, 16, doorLit);
    if (lit) {
      // The names wall glowing from below and lamps along the causeway.
      p.glow(1.5, 2.6, 8, [143, 227, 255], 120, p.glowA() * 0.9 + 0.1);
      p.wallSign(0.25, 2.5, 2.75, 2.5, 0.1, 0.32, 6, 26, [143, 227, 255], true, true);
      for (let i = 0; i < 6; i++) p.lamp(0.1 + i * 0.55, 2.95, 7, [255, 214, 150], 12);
    }
    if (allLit) {
      // A small figure with a lamp at the door.
      p.box(1.46, 2.62, 1.52, 2.68, 1.5, 5.5, mat([40, 40, 50]), { uplight: false });
      p.lamp(1.55, 2.68, 5, [255, 214, 150], 12);
    }
    if (look === 2) {
      p.fence([0.08, 2.92, 2.92, 2.92, 2.92, 0.08], 5);
      p.wallSign(0.25, 2.5, 2.75, 2.5, 0.65, 0.95, 20, 28, mix([180, 120, 90], [120, 110, 110], 0.5), false);
    }
    if (look === 3) {
      flag(p, 2.6, 2.4, 48, [80, 140, 255], 8, 4);
      p.box(2.3, 2.62, 2.6, 2.9, 1.5, 9, mat([150, 160, 170]), { win: { style: 'grid', floor: 6, col: 5, w: 0.5, h: 0.5, lit: 3 }, top: DARK });
      p.door(0.25, 2.5, 2.75, 2.5, 0.75, 0.82, 20, 26, [255, 220, 160]);
    }
    if (look === 6) for (let i = 0; i < 5; i++) p.lamp(1.2 + i * 0.15, 2.55, 4 + Math.sin((i / 4) * Math.PI) * 10, [255, 214, 140], 10);
    if (look === 0) p.glow(1.5, 1.5, 12, [40, 60, 70], 80, 0);
  };
}

// ── Tables ─────────────────────────────────────────────────────────────────

export const LANDMARK_RECIPES: Partial<Record<BuildingType, Recipe>> = {
  floodwatch,
  pumphouse: pumphouse(false),
  canopypark,
  medtower,
  reclaim,
  metro,
  markethall,
  tidal,
  geothermal,
  datavault,
  charterhall,
  hexworks,
  pearlatrium,
  hullhouse,
  kitemast,
  lampchoir,
  beacon,
  arena,
  halolookout,
  terminal,
  frame,
  pumphall: pumphallRecipe(0),
};

export const PUMP_GARDEN = pumphouse(true);

export const LANDMARK_PALS: Partial<Record<BuildingType, ArtPal>> = {
  floodwatch: pal([90, 200, 255], [255, 210, 60], [80, 170, 255], 0.3, 0.5),
  pumphouse: pal([120, 220, 200], [182, 255, 46], [100, 200, 180], 0.5, 0.3),
  canopypark: pal(NEON.green, [255, 230, 170], [80, 220, 140], 0.6, 0.2),
  medtower: pal([80, 240, 220], NEON.red, [60, 200, 200], 0.2, 0.55),
  reclaim: pal([140, 255, 160], NEON.amber, [100, 220, 140], 0.4, 0.3),
  metro: pal([255, 210, 80], NEON.cyan, [230, 200, 80], 0.5, 0.3),
  markethall: pal([255, 140, 80], NEON.yellow, [255, 160, 90], 0.65, 0.15),
  tidal: pal([90, 230, 255], NEON.green, [70, 200, 240], 0.2, 0.6),
  geothermal: pal([255, 140, 60], NEON.amber, [255, 120, 60], 0.6, 0.2),
  datavault: pal([90, 160, 255], NEON.cyan, [70, 120, 255], 0.05, 0.8),
  charterhall: FACTION_PALS.board,
  hexworks: FACTION_PALS.basalt,
  pearlatrium: FACTION_PALS.nacre,
  hullhouse: FACTION_PALS.undertow,
  kitemast: FACTION_PALS.kites,
  lampchoir: FACTION_PALS.tuning,
  beacon: pal([255, 240, 200], [255, 80, 80], [220, 220, 255], 0.6, 0.3),
  arena: pal(NEON.magenta, NEON.cyan, [200, 60, 220], 0.3, 0.5),
  halolookout: pal([143, 227, 255], [255, 198, 241], [120, 200, 255], 0.3, 0.5),
  terminal: pal([255, 220, 160], NEON.cyan, [255, 200, 140], 0.65, 0.2),
  frame: pal([201, 162, 255], [255, 214, 150], [170, 130, 255], 0.3, 0.3),
  pumphall: pal([143, 227, 255], [255, 214, 150], [100, 150, 170], 0.7, 0.2),
};

/** Faction designs a style-less landmark reuses (keeps the import list honest for tree-shaking). */
export const LANDMARK_DESIGNS = { pearlDrop, lampChapel, coilBelfry, openBelfry, netLoft, craneHab, sailCanopy, antennaForest };
void ball;
void hexPrism;
void css;
void GLASS;
void W_CURT;
