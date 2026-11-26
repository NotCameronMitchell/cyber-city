// ─────────────────────────────────────────────────────────────────────────────
// Faction and story building recipes (docs/STORY.md §4.5, §9):
//
//   foundry     Foundry Spine (Basalt, 3×3): a furnace column with orange vent
//               slits, side halls, twin stacks with smoke and a flame on top
//   glarewall   Glarewall (Nacre, 1×1): a slim light tower wrapped in pink holo
//               panels, halo crown; tall enough to anchor a skybridge
//   tidemarket  Tidemarket (Undertow, 2×2): salvage stalls under tarps, crates,
//               a beached hull, lime string lights, hook-and-wave blade sign
//   roost       Kite Roost (Kites, 1×1): a rooftop shack with a lattice relay
//               mast flying lilac kites
//   commons     Commons Hall (Board, 2×2): a colonnaded public hall, doors open
//               and warm, a small green in front, nine-ring seal sign
//   memorial    Sunk Memorial (1×1): a dark slab of names lit from below over a
//               reflecting pool, ringed with candles
//
// Same Painter conventions as art/services.ts (footprint 0..size, z in px).
// ─────────────────────────────────────────────────────────────────────────────

import { NEON, css, mix, type RGB } from '../palette';
import { mat, type ArtPal, type Mat, type Painter, type WinSpec } from './painter';
import type { Recipe } from './zones';

const CONC = mat([124, 126, 140]);
const PAD = mat([96, 98, 110]);
const ROOF = mat([104, 100, 112]);
const ROOF_DARK = mat([72, 70, 84]);
const STEEL = mat([140, 144, 152]);
const W_SLIT: WinSpec = { style: 'slit', floor: 9, col: 7, w: 0.25, h: 0.6, lit: 0.9 };
const W_GRID: WinSpec = { style: 'grid', floor: 7, col: 6, w: 0.55, h: 0.5, lit: 1.3 };

const BASALT: RGB = [255, 123, 46];
const NACRE: RGB = [255, 198, 241];
const LIME: RGB = [182, 255, 46];
const LILAC: RGB = [201, 162, 255];
const BOARD: RGB = [207, 227, 255];
const MEMO: RGB = [143, 227, 255];
const CANDLE: RGB = [255, 214, 140];

function pal(neon: RGB, neon2: RGB, up: RGB, warm = 0.4, cool = 0.4): ArtPal {
  return { neon, neon2, up, warm, cool };
}

export const STORY_PALS = {
  foundry: pal(BASALT, NEON.amber, [255, 110, 40], 0.75, 0.05),
  glarewall: pal(NACRE, NEON.magenta, [255, 150, 220], 0.15, 0.6),
  tidemarket: pal(LIME, NEON.green, [140, 220, 40], 0.6, 0.15),
  roost: pal(LILAC, NEON.violet, [170, 130, 255], 0.3, 0.5),
  commons: pal(BOARD, NEON.green, [170, 200, 255], 0.65, 0.2),
  memorial: pal(MEMO, CANDLE, [120, 200, 255], 0.5, 0.3),
} as const;

function warn(p: Painter, u: number, v: number, z: number) {
  const [x, y] = p.pt(u, v, z);
  p.addFx({ k: 'warn', x, y, ph: p.rng.next() });
  p.track(x - 9, y - 9);
}

function slab(p: Painter, s: number, m: Mat = PAD, z = 1.2) {
  p.box(0.04, 0.04, s - 0.04, s - 0.04, 0, z, m, { uplight: false });
}

/** Hexagon outline sign (Basalt's mark) drawn flat on a face plane at height z. */
function hexMark(p: Painter, u: number, v: number, z: number, r: number, c: RGB, alongU: boolean) {
  const pts: number[] = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const t = Math.cos(a) * r * 0.035;
    pts.push(alongU ? u + t : u, alongU ? v : v + t, z + Math.sin(a) * r);
  }
  p.neon(pts, c, 0.9);
}

// ── Foundry Spine ─────────────────────────────────────────────────────────
const foundry: Recipe = (p) => {
  slab(p, 3, mat([88, 84, 82]), 1);
  const iron = mat([96, 84, 78]);
  const iron2 = mat([118, 104, 92]);
  // Side furnace halls with sawtooth roofs.
  p.box(0.15, 0.2, 1.1, 2.85, 1, 22, iron2, { win: W_SLIT, top: ROOF_DARK, trim: p.pal.neon2 });
  p.saw(0.15, 0.2, 1.1, 2.85, 22, 6, 3, ROOF, BASALT);
  p.box(1.95, 1.95, 2.85, 2.85, 1, 18, iron2, { win: W_SLIT, top: ROOF_DARK });
  p.door(1.95, 2.85, 2.85, 2.85, 0.2, 0.8, 1, 12, BASALT);
  // The spine: an octagonal furnace column, stepped.
  const tiers: [number, number, number, number][] = [
    [1.15, 0.25, 1, 64],
    [1.3, 0.22, 64, 118],
    [1.45, 0.18, 118, 150],
  ];
  for (const [i, c, z0, z1] of tiers) {
    const o = 2.9 - i;
    p.chamfer(i, 0.25 + (i - 1.15), o + 0.55, o - 0.3, c, z0, z1, iron, { top: ROOF_DARK, trim: p.pal.neon });
  }
  // Glowing vent slits up the two visible faces.
  const ga = p.glowA();
  for (let z = 10; z < 140; z += 9) {
    const i = z < 64 ? 1.15 : z < 118 ? 1.3 : 1.45;
    const o = 2.9 - i;
    const u1 = o + 0.55;
    const v1 = o - 0.3;
    const v0 = 0.25 + (i - 1.15);
    const lit = p.lights && !p.abandoned;
    const c = lit ? mix(mix(BASALT, [90, 50, 30], 0.5), BASALT, 0.4 + 0.6 * p.n) : [60, 50, 46];
    p.begin_();
    p.quad(u1, v0 + 0.35, z, u1, v1 - 0.35, z, u1, v1 - 0.35, z + 3, u1, v0 + 0.35, z + 3);
    p.fill(css(c as RGB));
    p.begin_();
    p.quad(i + 0.35, v1, z, u1 - 0.35, v1, z, u1 - 0.35, v1, z + 3, i + 0.35, v1, z + 3);
    p.fill(css(c as RGB));
  }
  if (ga > 0.05) p.glow(2.0, 1.7, 80, BASALT, 110, ga * 0.4);
  hexMark(p, 2.25, 2.28, 42, 9, BASALT, true);
  // Twin smoke stacks and a flame at the top of the spine.
  p.stack(0.45, 0.55, 0.12, 22, 70);
  p.stack(0.75, 0.55, 0.1, 22, 58);
  p.pipe(0.9, 1.4, 30, 1.2, 1.4, 40, 3, STEEL);
  p.pipe(1.6, 2.4, 14, 1.95, 2.4, 14, 3, STEEL);
  const [fx, fy] = p.pt(1.85, 1.4, 152);
  p.addFx({ k: 'flame', x: fx, y: fy, ph: p.rng.next() });
  p.addFx({ k: 'smoke', x: fx, y: fy - 6, r: 7, ph: p.rng.next() });
  p.track(fx - 14, fy - 60);
  p.reach(200);
  p.blinker(1.85, 1.4, 151, NEON.red, 1.5, 16);
  p.fence([0.04, 2.96, 2.96, 2.96, 2.96, 0.04]);
  warn(p, 2.4, 2.4, 22);
};

// ── Glarewall ─────────────────────────────────────────────────────────────
const glarewall: Recipe = (p) => {
  slab(p, 1, mat([110, 100, 116]), 1);
  const skin = mat([210, 196, 214], [40, 30, 52]);
  const glass: Mat = { day: [170, 150, 190], night: [24, 12, 34] };
  p.box(0.28, 0.28, 0.72, 0.72, 1, 10, CONC, { top: ROOF });
  p.chamfer(0.33, 0.33, 0.67, 0.67, 0.08, 10, 122, skin, { win: { style: 'curtain', floor: 6, col: 5, w: 1, h: 0.8, margin: 1 }, glass, top: ROOF_DARK, trim: p.pal.neon });
  // Holo panels on the two street faces (static panel + animated board).
  p.board(0.3, 0.72, 0.7, 0.72, 0.04, 0.96, 34, 92, 1, NACRE, NEON.magenta);
  p.board(0.72, 0.7, 0.72, 0.3, 0.04, 0.96, 46, 104, 2, NEON.magenta, NACRE);
  // Edge light lines.
  p.neon([0.67, 0.67, 12, 0.67, 0.67, 120], p.pal.neon, 1);
  p.neon([0.33, 0.67, 12, 0.33, 0.67, 120], p.pal.neon2, 0.7);
  // Halo crown.
  p.neonRing(0.5, 0.5, 0.26, 128, NACRE, 1.2, true);
  p.neonRing(0.5, 0.5, 0.18, 134, NEON.magenta, 0.9, true);
  p.glow(0.5, 0.5, 130, NACRE, 70, p.glowA() * 0.6);
  const [x, y] = p.pt(0.5, 0.5, 130);
  p.addFx({ k: 'pulse', x, y, size: 64, c: NACRE, period: 2.6, ph: 0 });
  p.addFx({ k: 'ring', x, y: y - 4, rx: 14, ry: 7, c: NACRE, ph: 0 });
  p.track(x - 34, y - 34);
  // Light pool on the corner (the "glare").
  p.glow(0.95, 0.95, 1, NACRE, 70, p.glowA() * 0.45);
  p.blinker(0.5, 0.5, 138, NEON.red, 1.4, 14);
  warn(p, 0.5, 0.5, 20);
};

// ── Tidemarket ────────────────────────────────────────────────────────────
const TARPS: Mat[] = [mat([70, 120, 80]), mat([150, 120, 60]), mat([60, 100, 130]), mat([130, 70, 70])];
const tidemarket: Recipe = (p) => {
  slab(p, 2, mat([84, 88, 86]), 0.8);
  // Beached hull at the back, cut open as a stall.
  const hull = mat([96, 70, 58]);
  p.prism([0.15, 0.2, 0.95, 0.15, 1.05, 0.4, 0.95, 0.65, 0.15, 0.6], 0.8, 9, hull, { top: mat([110, 90, 70]) });
  p.box(0.4, 0.3, 0.7, 0.5, 9, 14, mat([120, 120, 128]), { top: ROOF, uplight: false });
  // Stalls under tarps.
  const stalls: [number, number][] = [
    [1.15, 0.2],
    [1.55, 0.2],
    [0.2, 0.95],
    [0.65, 0.95],
    [1.15, 0.95],
    [0.2, 1.45],
    [1.15, 1.45],
  ];
  for (let k = 0; k < stalls.length; k++) {
    const [u, v] = stalls[k];
    const w = 0.34;
    p.box(u, v, u + w, v + w, 0.8, 5, mat([110, 104, 96]), { uplight: false, top: mat([120, 116, 110]) });
    p.shed(u - 0.02, v - 0.02, u + w + 0.02, v + w + 0.02, 9, 2.5, TARPS[k % TARPS.length], k % 2 ? 'u' : 'v');
    for (const [a, b] of [
      [u, v + w],
      [u + w, v + w],
      [u + w, v],
    ]) {
      p.begin_();
      p.m(a, b, 0.8);
      p.l(a, b, 9);
      p.stroke(p.col(STEEL, 0.6), 0.45);
    }
    if (p.lights && p.n > 0.2) p.glow(u + w / 2, v + w + 0.05, 3, k % 3 ? CANDLE : LIME, 22, p.n * 0.45);
  }
  // Crates and a container.
  p.crate(1.6, 1.5, 0.8, 0.1);
  p.crate(1.72, 1.62, 0.8, 0.08);
  p.container(1.5, 0.6, 1.9, 0.82, 0.8, 9, [96, 120, 70]);
  // String lights zig-zagging across the market.
  if (p.g) {
    const pts: [number, number][] = [
      [0.1, 0.9],
      [0.6, 0.85],
      [1.1, 0.9],
      [1.6, 0.85],
      [1.95, 0.9],
    ];
    p.begin_();
    for (let i = 0; i < pts.length; i++) (i ? p.l : p.m).call(p, pts[i][0], pts[i][1], 13 - (i % 2) * 2);
    p.stroke(p.col(mat([60, 60, 70]), 1, 0.8), 0.35);
  }
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    p.lamp(0.1 + t * 1.85, 0.88, 12 - Math.abs(Math.sin(t * Math.PI * 2)) * 1.5, i % 2 ? LIME : CANDLE, 8);
  }
  // Hook-and-wave blade sign on a pole.
  p.begin_();
  p.m(1.9, 1.9, 0.8);
  p.l(1.9, 1.9, 24);
  p.stroke(p.col(STEEL, 0.7), 0.8);
  p.blade(1.9, 1.75, 'v', 0.12, 14, 26, LIME);
  p.glow(1.9, 1.85, 20, LIME, 30, p.glowA() * 0.5);
  warn(p, 1.0, 1.0, 14);
};

// ── Kite Roost ────────────────────────────────────────────────────────────
const roost: Recipe = (p) => {
  slab(p, 1, PAD, 1);
  const tin = mat([110, 108, 124]);
  p.box(0.18, 0.2, 0.82, 0.8, 1, 16, tin, { win: { style: 'grid', floor: 6, col: 7, w: 0.5, h: 0.45, lit: 1.4 }, top: ROOF, trim: p.pal.neon });
  p.shed(0.16, 0.18, 0.84, 0.82, 16, 3, mat([90, 84, 110]), 'u');
  // Lattice relay mast.
  const base = 18;
  const top = 74;
  p.begin_();
  for (const [a, b] of [
    [0.38, 0.4],
    [0.62, 0.4],
    [0.62, 0.62],
    [0.38, 0.62],
  ]) {
    p.m(a, b, base);
    p.l(0.5 + (a - 0.5) * 0.25, 0.51 + (b - 0.51) * 0.25, top);
  }
  for (let z = base + 8; z < top - 4; z += 9) {
    const k = (z - base) / (top - base);
    const r = 0.12 * (1 - k) + 0.03 * k;
    p.m(0.5 - r, 0.51 - r, z);
    p.l(0.5 + r, 0.51 + r, z + 9);
    p.m(0.5 + r, 0.51 - r, z);
    p.l(0.5 - r, 0.51 + r, z + 9);
  }
  p.stroke(p.col(STEEL, 0.85), 0.5);
  p.dish(0.62, 0.5, 40, 0.07);
  p.blinker(0.5, 0.51, top + 1, LILAC, 1.1, 16);
  // Kites on strings, flying off the mast.
  const kites: [number, number, number][] = [
    [0.95, 0.15, 96],
    [0.1, 0.2, 88],
    [1.05, 0.7, 82],
  ];
  for (const [ku, kv, kz] of kites) {
    p.begin_();
    p.m(0.5, 0.51, top - 6);
    p.l(ku, kv, kz - 6);
    p.stroke(p.col(mat([200, 200, 220]), 1, 0.45), 0.3);
    const pts = [ku, kv, kz, ku + 0.06, kv - 0.06, kz - 5, ku, kv, kz - 12, ku - 0.06, kv + 0.06, kz - 5, ku, kv, kz];
    p.neon(pts, LILAC, 0.8);
    p.glow(ku, kv, kz - 5, LILAC, 18, p.glowA() * 0.6);
  }
  p.lamp(0.2, 0.8, 14, LILAC, 12);
  p.door(0.18, 0.8, 0.82, 0.8, 0.35, 0.6, 1, 8, LILAC);
  warn(p, 0.5, 0.5, 20);
};

// ── Commons Hall ──────────────────────────────────────────────────────────
const commons: Recipe = (p) => {
  slab(p, 2, mat([150, 150, 158]), 1);
  const stone = mat([196, 200, 212], [44, 46, 66]);
  // Hall body set back from the green.
  p.box(0.2, 0.2, 1.8, 1.25, 1, 26, stone, { win: W_GRID, top: mat([180, 184, 196]), trim: p.pal.neon });
  p.gable(0.15, 0.15, 1.85, 1.3, 26, 10, mat([120, 130, 150]), 'u');
  // Portico: columns along the front (+v) face.
  p.box(0.3, 1.25, 1.7, 1.42, 22, 25, stone, { top: mat([190, 194, 206]), uplight: false });
  for (let k = 0; k < 6; k++) {
    const u = 0.36 + k * 0.255;
    p.box(u, 1.33, u + 0.06, 1.39, 1, 22, stone, { uplight: false });
  }
  // Open doors, lit warm.
  p.door(0.2, 1.25, 1.8, 1.25, 0.38, 0.62, 1, 14, CANDLE);
  p.glow(1.0, 1.45, 2, CANDLE, 60, p.glowA() * 0.6);
  // The green: lawn, trees, benches, lamps.
  p.box(0.15, 1.5, 1.85, 1.92, 1, 1.6, mat([70, 130, 90], [14, 40, 30]), { uplight: false });
  p.greens(0.2, 1.55, 0.6, 1.9, 1.6, 5);
  p.greens(1.4, 1.55, 1.8, 1.9, 1.6, 5);
  p.bench(0.8, 1.75, 'u');
  p.bench(1.05, 1.75, 'u');
  p.lamp(0.65, 1.6, 9, CANDLE, 14);
  p.lamp(1.35, 1.6, 9, CANDLE, 14);
  // Nine-ring seal on the pediment.
  const [sx, sy] = p.pt(1.0, 1.28, 31);
  if (p.g) {
    const g = p.g;
    const on = p.lights && !p.abandoned;
    g.strokeStyle = on ? css(mix(BOARD, [255, 255, 255], 0.3 * p.n)) : p.col(mat([150, 160, 180]), 0.8);
    g.lineWidth = 0.6;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.arc(sx + Math.cos(a) * 3.2, sy + Math.sin(a) * 1.8, 0.8, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.arc(sx, sy, 1.1, 0, Math.PI * 2);
    g.stroke();
  }
  p.glow(1.0, 1.28, 31, BOARD, 26, p.glowA() * 0.6);
  p.track(sx - 6, sy - 6);
  warn(p, 1.0, 0.8, 36);
};

// ── Sunk Memorial ─────────────────────────────────────────────────────────
const memorial: Recipe = (p) => {
  // Reflecting pool.
  slab(p, 1, mat([70, 74, 86]), 1);
  const water = mat([40, 70, 90], [6, 16, 30]);
  p.box(0.1, 0.1, 0.9, 0.9, 1, 1.6, water, { uplight: false, top: water });
  // The slab of names.
  const basalt = mat([46, 48, 60], [10, 10, 18]);
  p.box(0.4, 0.36, 0.6, 0.64, 1.6, 48, basalt, { top: mat([60, 62, 74], [14, 14, 22]), uplight: false });
  // Rows of tiny lit names on the two visible faces.
  if (p.g) {
    const g = p.g;
    const on = p.lights && !p.abandoned;
    const c = on ? css(mix([120, 140, 160], MEMO, 0.3 + 0.7 * p.n)) : css([80, 84, 96]);
    g.fillStyle = c;
    for (let z = 6; z < 44; z += 2.2) {
      for (let i = 0; i < 4; i++) {
        const t0 = 0.08 + i * 0.22 + ((z * 7) % 5) * 0.01;
        const [x, y] = p.pt(0.4 + 0.2 * t0, 0.64, z);
        g.fillRect(x, y, 1.6, 0.5);
        const [x2, y2] = p.pt(0.6, 0.36 + 0.28 * t0, z);
        g.fillRect(x2, y2 - 0.5, 1.4, 0.5);
      }
    }
  }
  // Uplight from the pool.
  p.glow(0.5, 0.66, 4, MEMO, 46, p.glowA() * 0.7);
  p.glow(0.62, 0.5, 4, MEMO, 40, p.glowA() * 0.5);
  // Candles around the rim.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    p.lamp(0.5 + Math.cos(a) * 0.36, 0.5 + Math.sin(a) * 0.36, 2.4, CANDLE, 9);
  }
  p.reach(52);
  warn(p, 0.5, 0.5, 50);
};

/**
 * The Sunk Memorial's "Lower Wards" look (MEGACITY §9.3): built inside the Sunk it faces the water, a long names wall
 * lit from the canal side, a channel of still water along its foot and lamps on a low quay.
 */
export const memorialLowerWards: Recipe = (p) => {
  slab(p, 1, mat([70, 74, 86]), 1);
  const water = mat([40, 70, 90], [6, 16, 30]);
  // The canal along the front (+u) edge.
  p.box(0.62, 0.06, 0.96, 0.94, 0.2, 0.9, water, { uplight: false, top: water });
  p.box(0.56, 0.06, 0.62, 0.94, 0, 2.2, mat([120, 120, 128]), { uplight: false });
  // The long names wall facing the canal.
  const basalt = mat([46, 48, 60], [10, 10, 18]);
  p.box(0.18, 0.1, 0.42, 0.9, 1, 34, basalt, { top: mat([60, 62, 74], [14, 14, 22]), uplight: false });
  if (p.g) {
    const g = p.g;
    const on = p.lights && !p.abandoned;
    g.fillStyle = on ? css(mix([120, 140, 160], MEMO, 0.3 + 0.7 * p.n)) : css([80, 84, 96]);
    for (let z = 5; z < 31; z += 2.2)
      for (let i = 0; i < 7; i++) {
        const t0 = 0.06 + i * 0.13 + ((z * 7) % 5) * 0.008;
        const [x, y] = p.pt(0.42, 0.1 + 0.8 * t0, z);
        g.fillRect(x, y - 0.5, 1.6, 0.5);
      }
  }
  // Lit from the canal side.
  p.glow(0.5, 0.5, 4, MEMO, 60, p.glowA() * 0.85);
  for (let k = 0; k < 6; k++) p.lamp(0.6, 0.14 + k * 0.14, 2.6, CANDLE, 9);
  p.reach(40);
  warn(p, 0.3, 0.5, 38);
};

export const STORY_RECIPES = { foundry, glarewall, tidemarket, roost, commons, memorial } as const;

