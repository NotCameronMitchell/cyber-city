// ─────────────────────────────────────────────────────────────────────────────
// Faction architecture languages (docs/MEGACITY.md §6.2).
//
// Six design languages, each with its palette, shapes, rules, light, a live
// signature and named designs (A–D):
//
//   Basalt "Hex and Furnace"   hex prisms, buttresses, riveted trusses, stacks
//   Nacre "Pearl and Spiral"   discs, cylinders, domes, rings; no sharp tops
//   Board "Civic Stone"        symmetric podium-body-crown, colonnades, clocks
//   Undertow "Salvage and Tide" containers, upturned hulls, nets, cranes
//   Kites "Rig and Sail"       masts, diamond sails, platforms, ladders
//   Tuning "Lamp and Hymn"     lantern roofs, copper coils, bell domes
//
// Designs draw inside a footprint box from z0 to z0 + h, so one design serves a
// Corp Spire, a Stratablock crown, a faction building and a landmark. Look 0 of
// every family is today's art (buildings.ts keeps those recipes); the designs
// here are looks 1.., added beside them.
//
// Standing shows at night: Allied lights brighter with banners out, Hostile at
// half window light with banners down (buildings.ts sets the light, `banners`
// here). Signatures are registered as Painter.sig anchors and drawn live by
// drawSigs (≤ 0.3 ms a frame together with the marks, §11.1).
// ─────────────────────────────────────────────────────────────────────────────

import type { FactionId } from '../../game/story/types';
import { HALF_H, HALF_W } from '../camera';
import { NEON, css, glowSprite, mix, type RGB } from '../palette';
import { ledgerFace, smileFace } from './landmarkLive';
import { GLASS, mat, type ArtPal, type Mat, type Painter, type Sig, type WinSpec } from './painter';
import { clockFace, coil, crane, flag, hexPrism, hull, lampString, lanternRoof, lattice, pole, pyramid, sail } from './parts';

/** A footprint box [u0, v0, u1, v1] in tile units. */
export type Box4 = [number, number, number, number];

/** What a design draws with: the box, the base, the height and whether banners are out. */
export interface DCtx {
  b: Box4;
  z0: number;
  h: number;
  banners: boolean;
}

export type Design = (p: Painter, d: DCtx) => void;

/**
 * Banners for the recipe being run (§6.2 standing: down while its faction is Hostile). buildings.ts sets it around
 * every recipe run of a faction model; designs read it with their own `banners` flag.
 */
export const BANNERS = { on: true };

// ── Palettes and materials ────────────────────────────────────────────────

const pal = (neon: RGB, neon2: RGB, up: RGB, warm: number, cool: number, glass?: Mat): ArtPal => ({ neon, neon2, up, warm, cool, glass });

export const FACTION_PALS: Record<FactionId, ArtPal> = {
  basalt: pal([255, 123, 46], [255, 196, 90], [255, 110, 40], 0.85, 0.02),
  nacre: pal([255, 198, 241], [180, 230, 255], [255, 170, 230], 0.2, 0.55, { day: [214, 176, 206], night: [40, 26, 48] }),
  board: pal([120, 200, 255], [255, 220, 160], [190, 210, 255], 0.75, 0.1),
  undertow: pal([182, 255, 46], [60, 200, 160], [140, 220, 40], 0.55, 0.2),
  kites: pal([201, 162, 255], [255, 214, 150], [170, 130, 255], 0.45, 0.35),
  tuning: pal([255, 214, 140], [255, 243, 196], [255, 190, 110], 0.98, 0),
};

// Basalt
const BASALT = mat([52, 50, 56], [12, 11, 16]);
const BASALT2 = mat([70, 66, 70], [16, 14, 18]);
const RUSTS = mat([120, 80, 60], [26, 16, 14]);
const HAZARD: RGB = [230, 190, 40];
const FURNACE: RGB = [255, 123, 46];
// Nacre
const PEARL = mat([232, 226, 236], [46, 40, 56]);
const BLUSH = mat([214, 176, 206], [40, 26, 48]);
const ICE: RGB = [180, 230, 255];
const HALO: RGB = [255, 198, 241];
const NACRE_GLASS: Mat = { day: [214, 176, 206], night: [40, 26, 48] };
// Board
const LIME = mat([214, 214, 206], [44, 44, 52]);
const SLATE = mat([96, 104, 120], [20, 22, 32]);
const VERD = mat([120, 180, 160], [22, 40, 40]);
const WARMW: RGB = [255, 220, 160];
const BANNER: RGB = [80, 140, 255];
// Undertow
const URUST = mat([132, 84, 60], [30, 18, 16]);
const HULLG = mat([56, 92, 80], [12, 22, 22]);
const TARPB = mat([60, 120, 140], [12, 26, 34]);
const NET = mat([150, 150, 146], [30, 30, 34]);
const GLAMP: RGB = [182, 255, 46];
// Kites
const LILAC: RGB = [201, 162, 255];
const SAILC = mat([236, 236, 246], [52, 50, 70]);
const CABLE = mat([40, 40, 48], [8, 8, 14]);
const STRING: RGB = [255, 214, 150];
const KDECK = mat([110, 104, 130], [22, 20, 32]);
// Tuning
const CREAM = mat([255, 243, 196], [60, 54, 46]);
const COPPER = mat([184, 115, 51], [40, 24, 14]);
const COPPER_RGB: RGB = [184, 115, 51];
const NIGHTB = mat([50, 60, 100], [12, 14, 30]);
const CANDLE: RGB = [255, 214, 140];
// Neutral (independent Spires)
const STEELG = mat([150, 160, 176], [30, 34, 50]);
const STEEL = mat([140, 144, 152]);
const DARKR = mat([60, 60, 72]);

const W_SLIT: WinSpec = { style: 'slit', floor: 9, col: 7, w: 0.25, h: 0.6, lit: 1.1 };
const W_CURT: WinSpec = { style: 'curtain', floor: 6, col: 6, w: 1, h: 0.82, margin: 1 };
const W_GRID: WinSpec = { style: 'grid', floor: 7, col: 6, w: 0.55, h: 0.5, lit: 1.2 };
const W_WARM: WinSpec = { style: 'grid', floor: 7, col: 6, w: 0.5, h: 0.55, lit: 1.4 };
const W_BAND: WinSpec = { style: 'band', floor: 7, col: 7, w: 1, h: 0.45 };

const cx = (b: Box4) => (b[0] + b[2]) / 2;
const cy = (b: Box4) => (b[1] + b[3]) / 2;
const half = (b: Box4) => Math.min(b[2] - b[0], b[3] - b[1]) / 2;

/** Register a signature at a 3D point. */
function sigAt(p: Painter, u: number, v: number, z: number, s: (x: number, y: number) => Sig) {
  const [x, y] = p.pt(u, v, z);
  p.addSig(s(x, y));
}

// ════════════════════════════════════════════════════════════════════════════
// BASALT · Hex and Furnace
// ════════════════════════════════════════════════════════════════════════════

/** A furnace slit band (orange) around a hex at height z; registers the flicker. */
function furnaceBand(p: Painter, u: number, v: number, r: number, z: number) {
  p.neonRing(u, v, r * 1.0, z, FURNACE, 1.6);
  p.glow(u, v, z, FURNACE, r * 90, p.glowA() * 0.45);
  const rx = r * HALF_W * Math.SQRT2;
  sigAt(p, u, v, z, (x, y) => ({ k: 'furnace', x, y, w: rx, h: 3 }));
}

/** Flame stack with a shift-change flare. */
function flameStack(p: Painter, u: number, v: number, r: number, z: number, h: number) {
  p.stack(u, v, r, z, h, true);
  const [x, y] = p.pt(u, v, z + h);
  p.addFx({ k: 'flame', x, y, ph: p.rng.next() });
  p.addSig({ k: 'flare', x, y });
  p.track(x - 12, y - 40);
}

/** A: Hex Column — three stacked hex prisms (0.9 / 0.75 / 0.6 of the box radius), slit bands at the joints, a flame stack. */
export const hexColumn: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.95;
  const hs = [0.39, 0.35, 0.26].map((f) => f * d.h * 0.86);
  let z = d.z0;
  const radii = [R, R * 0.83, R * 0.66];
  for (let i = 0; i < 3; i++) {
    hexPrism(p, u, v, radii[i], z, z + hs[i], i % 2 ? BASALT2 : BASALT, { win: W_SLIT, top: RUSTS, trim: i === 2 ? FURNACE : undefined });
    z += hs[i];
    if (i < 2) furnaceBand(p, u, v, radii[i + 1] * 1.02, z + 1);
  }
  // Riveted buttress ribs on the base.
  p.ribs(u - R * 0.7, v + R * 0.7, u + R * 0.2, v + R * 0.95, d.z0, d.z0 + hs[0] * 0.8, 5, RUSTS);
  flameStack(p, u + R * 0.25, v - R * 0.25, Math.max(0.05, R * 0.12), z, d.z0 + d.h - z);
  if (d.banners && BANNERS.on) flag(p, u - R * 0.3, v + R * 0.3, z, HAZARD, 8, 4);
};

/** B: Buttress Hall — a long block with four wedge buttresses a side and two stacks. */
export const buttressHall: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const hz = d.z0 + d.h * 0.45;
  p.box(u0 + 0.08, v0 + 0.08, u1 - 0.08, v1 - 0.08, d.z0, hz, BASALT, { win: W_SLIT, top: RUSTS, trim: FURNACE });
  p.saw(u0 + 0.08, v0 + 0.08, u1 - 0.08, v1 - 0.08, hz, 6, Math.max(2, Math.round((u1 - u0) * 3)), RUSTS, FURNACE);
  // Wedge buttresses along the two visible faces (wider at the base).
  for (let i = 0; i < 4; i++) {
    const t = u0 + 0.15 + ((u1 - u0 - 0.3) * (i + 0.5)) / 4;
    p.prism([t - 0.05, v1 - 0.08, t + 0.05, v1 - 0.08, t + 0.04, v1 + 0.08, t - 0.04, v1 + 0.08], d.z0, d.z0 + (hz - d.z0) * 0.7, BASALT2, { top: RUSTS });
    const s = v0 + 0.15 + ((v1 - v0 - 0.3) * (i + 0.5)) / 4;
    p.prism([u1 - 0.08, s - 0.05, u1 + 0.08, s - 0.04, u1 + 0.08, s + 0.04, u1 - 0.08, s + 0.05], d.z0, d.z0 + (hz - d.z0) * 0.7, BASALT2, { top: RUSTS });
  }
  furnaceBand(p, cx(d.b), cy(d.b), half(d.b) * 0.5, d.z0 + (hz - d.z0) * 0.5);
  flameStack(p, u0 + (u1 - u0) * 0.3, v0 + 0.25, 0.08, hz, d.z0 + d.h - hz);
  flameStack(p, u0 + (u1 - u0) * 0.7, v0 + 0.25, 0.07, hz, (d.z0 + d.h - hz) * 0.82);
  if (d.banners && BANNERS.on) flag(p, u1 - 0.15, v1 - 0.15, hz, HAZARD, 8, 4);
};

/** C: Crucible — a tapering tower crowned by a glowing bowl with embers. */
export const crucible: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.9;
  const bowlZ = d.z0 + d.h * 0.8;
  hexPrism(p, u, v, R, d.z0, d.z0 + d.h * 0.25, BASALT, { win: W_SLIT, top: RUSTS });
  hexPrism(p, u, v, R * 0.62, d.z0 + d.h * 0.25, bowlZ, BASALT2, { win: W_SLIT, top: RUSTS, trim: FURNACE });
  furnaceBand(p, u, v, R * 0.64, d.z0 + d.h * 0.25 + 2);
  // The bowl: a wide flared cylinder, its rim glowing.
  p.cyl(u, v, R * 0.55, bowlZ, bowlZ + d.h * 0.12, RUSTS, mat([255, 140, 60], [255, 110, 40]), R * 0.95);
  p.neonRing(u, v, R * 0.95, bowlZ + d.h * 0.12, FURNACE, 1.8, true);
  p.glow(u, v, bowlZ + d.h * 0.14, FURNACE, R * 160, p.glowA() * 0.9 + 0.15);
  const [x, y] = p.pt(u, v, bowlZ + d.h * 0.14);
  p.addFx({ k: 'pulse', x, y, size: R * 120, c: FURNACE, period: 1.7, ph: 0 });
  p.addFx({ k: 'smoke', x, y: y - 4, r: R * 30, ph: p.rng.next() });
  p.addSig({ k: 'flare', x, y });
  p.reach(d.z0 + d.h);
  p.track(x - R * 60, y - 50);
  if (d.banners && BANNERS.on) flag(p, u + R * 0.6, v + R * 0.3, d.z0 + d.h * 0.25, HAZARD, 8, 4);
};

/** D: Gantry Spine — an open lattice core with a gantry crane on top. */
export const gantrySpine: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.7;
  hexPrism(p, u, v, R * 1.25, d.z0, d.z0 + d.h * 0.18, BASALT, { win: W_SLIT, top: RUSTS, trim: FURNACE });
  // Solid core inside an open truss.
  p.box(u - R * 0.32, v - R * 0.32, u + R * 0.32, v + R * 0.32, d.z0, d.z0 + d.h * 0.86, BASALT2, { win: W_SLIT, top: RUSTS });
  lattice(p, u - R * 0.75, v - R * 0.75, u + R * 0.75, v + R * 0.75, d.z0 + d.h * 0.18, d.z0 + d.h * 0.86, RUSTS, 10, 0.9);
  for (let z = d.z0 + d.h * 0.3; z < d.z0 + d.h * 0.85; z += d.h * 0.18) furnaceBand(p, u, v, R * 0.4, z);
  crane(p, u, v, d.z0 + d.h * 0.86, d.h * 0.14, R * 2.6, mat([230, 190, 40]));
  p.reach(d.z0 + d.h);
};

// ════════════════════════════════════════════════════════════════════════════
// NACRE · Pearl and Spiral
// ════════════════════════════════════════════════════════════════════════════

/** A slowly turning halo ring (the Nacre signature) at height z. */
function haloRing(p: Painter, u: number, v: number, r: number, z: number) {
  p.neonRing(u, v, r, z, HALO, 1.2, true);
  const rx = r * HALF_W * Math.SQRT2;
  sigAt(p, u, v, z, (x, y) => ({ k: 'halo', x, y, rx, ry: rx / 2, c: HALO }));
  p.glow(u, v, z, HALO, rx * 3, p.glowA() * 0.35);
}

/** A: Spiral — 12 discs, each turned 15°, tapering. */
export const spiral: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.92;
  const n = 12;
  const dz = (d.h * 0.9) / n;
  for (let i = 0; i < n; i++) {
    const r = R * (1 - i * 0.045);
    const a = (i * 15 * Math.PI) / 180;
    const poly: number[] = [];
    for (let k = 0; k < 8; k++) {
      const t = a + (k / 8) * Math.PI * 2;
      const rr = k % 2 ? r * 0.82 : r;
      poly.push(u + Math.cos(t) * rr, v + Math.sin(t) * rr * 0.86);
    }
    p.prism(poly, d.z0 + i * dz, d.z0 + (i + 1) * dz - 0.8, i % 2 ? BLUSH : PEARL, { win: W_CURT, glass: NACRE_GLASS, top: PEARL });
  }
  const topZ = d.z0 + d.h * 0.9;
  p.dome(u, v, R * 0.5, topZ, d.h * 0.08, PEARL);
  haloRing(p, u, v, R * 0.9, topZ + d.h * 0.04);
  pole(p, u, v, topZ + d.h * 0.08, d.z0 + d.h, mat([220, 220, 230]), 0.6);
  p.lamp(u, v, d.z0 + d.h, ICE, 14);
  if (d.banners && BANNERS.on) p.glow(u, v, topZ, HALO, R * 200, p.glowA() * 0.3);
};

/** B: Pearl Drop — a slim stem with a bulb top 1.4× as wide and a ring halo. */
export const pearlDrop: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.5;
  p.cyl(u, v, R * 1.2, d.z0, d.z0 + 8, PEARL, BLUSH, R * 0.9);
  p.cyl(u, v, R * 0.75, d.z0 + 8, d.z0 + d.h * 0.66, PEARL, BLUSH, R * 0.55);
  p.cylBands(u, v, R * 0.7, d.z0 + 10, d.z0 + d.h * 0.64, 8);
  const bz = d.z0 + d.h * 0.66;
  const br = Math.min(half(d.b) * 0.92, R * 1.4);
  p.cyl(u, v, br * 0.6, bz, bz + d.h * 0.05, BLUSH, PEARL, br);
  p.cyl(u, v, br, bz + d.h * 0.05, bz + d.h * 0.2, BLUSH, PEARL, br * 0.75);
  p.cylBands(u, v, br * 0.98, bz + d.h * 0.06, bz + d.h * 0.2, 6);
  p.dome(u, v, br * 0.75, bz + d.h * 0.2, d.h * 0.12, PEARL);
  haloRing(p, u, v, br * 1.35, bz + d.h * 0.13);
  p.lamp(u, v, d.z0 + d.h, ICE, 12);
  p.reach(d.z0 + d.h);
};

/** C: Ribbon Twins — two slim towers joined by a curved ribbon at 70% height. */
export const ribbonTwins: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const r = Math.min(u1 - u0, v1 - v0) * 0.18;
  const a: [number, number] = [u0 + (u1 - u0) * 0.3, v0 + (v1 - v0) * 0.3];
  const b: [number, number] = [u0 + (u1 - u0) * 0.72, v0 + (v1 - v0) * 0.72];
  const za = d.z0 + d.h * 0.92;
  p.cyl(a[0], a[1], r, d.z0, za, PEARL, BLUSH, r * 0.8);
  p.cylBands(a[0], a[1], r, d.z0 + 4, za - 4, 7);
  p.dome(a[0], a[1], r * 0.8, za, 8, PEARL);
  // The ribbon: a curved band sweeping between the towers at 70% height.
  const zr = d.z0 + d.h * 0.7;
  const pts: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const u = a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * 0.25;
    const vv = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.25;
    pts.push(u, vv, zr + Math.sin(t * Math.PI) * 10);
  }
  if (p.g) {
    p.begin_();
    for (let i = 0; i <= 10; i++) (i === 0 ? p.m : p.l).call(p, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    for (let i = 10; i >= 0; i--) p.l(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2] - 6);
    p.fill(p.col(BLUSH, 1.05));
  } else for (let i = 0; i <= 10; i++) p.m(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  p.neon(pts, HALO, 1);
  const zb = d.z0 + d.h;
  p.cyl(b[0], b[1], r * 1.1, d.z0, zb - 8, PEARL, BLUSH, r * 0.9);
  p.cylBands(b[0], b[1], r * 1.1, d.z0 + 4, zb - 12, 7);
  p.dome(b[0], b[1], r * 0.9, zb - 8, 8, PEARL);
  haloRing(p, b[0], b[1], r * 1.6, zb - 14);
};

/** D: Halo Atrium — a wide dome with two floating rings round a pearl shaft that rises out of it. */
export const haloAtrium: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.95;
  const dh = d.h * 0.3;
  p.cyl(u, v, R, d.z0, d.z0 + d.h * 0.1, PEARL, BLUSH);
  p.cylBands(u, v, R, d.z0 + 2, d.z0 + d.h * 0.1, 6);
  // The shaft first (its foot hides inside the dome), then the dome over it.
  const shaftTop = d.z0 + d.h * 0.76;
  const rs = R * 0.36;
  p.cyl(u, v, rs, d.z0 + d.h * 0.1, shaftTop, PEARL, BLUSH, rs * 0.9);
  p.cylBands(u, v, rs, d.z0 + d.h * 0.3, shaftTop - 2, 7);
  p.dome(u, v, R * 0.95, d.z0 + d.h * 0.1, dh, mat([214, 196, 220], [44, 30, 56]));
  p.cyl(u, v, rs * 0.98, d.z0 + d.h * 0.1 + dh * 0.7, d.z0 + d.h * 0.42, PEARL, BLUSH, rs * 0.98);
  p.dome(u, v, rs * 0.9, shaftTop, d.h * 0.05, PEARL);
  const zTop = d.z0 + d.h;
  pole(p, u, v, shaftTop + d.h * 0.05, zTop, mat([230, 230, 240]), 1.2);
  haloRing(p, u, v, R * 0.8, d.z0 + d.h * 0.56);
  haloRing(p, u, v, R * 0.58, d.z0 + d.h * 0.7);
  p.lamp(u, v, zTop, ICE, 14);
  p.glow(u, v, d.z0 + d.h * 0.25, HALO, R * 140, p.glowA() * 0.4);
};

// ════════════════════════════════════════════════════════════════════════════
// BOARD · Civic Stone
// ════════════════════════════════════════════════════════════════════════════

/** Nine pennants in a row along the front edge (banners out only). */
function pennants(p: Painter, u0: number, u1: number, v: number, z: number, n = 9) {
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const u = u0 + (u1 - u0) * t;
    flag(p, u, v, z, i % 3 === 1 ? WARMW : BANNER, 5, 3);
    if (i % 3 === 1) sigAt(p, u, v, z + 9, (x, y) => ({ k: 'flag', x, y, c: BANNER, len: 5 }));
  }
}

/** A: Charter block — a symmetric colonnaded block with a verdigris dome and nine flags. */
export const charterBlock: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const podZ = d.z0 + d.h * 0.12;
  const bodyZ = d.z0 + d.h * 0.62;
  p.box(u0 + 0.04, v0 + 0.04, u1 - 0.04, v1 - 0.04, d.z0, podZ, SLATE, { top: LIME });
  p.box(u0 + 0.14, v0 + 0.14, u1 - 0.14, v1 - 0.14, podZ, bodyZ, LIME, { win: W_WARM, top: SLATE });
  // The colonnade on both street faces.
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8;
    const u = u0 + 0.14 + (u1 - u0 - 0.28) * t;
    p.box(u - 0.025, v1 - 0.1, u + 0.025, v1 - 0.05, podZ, podZ + (bodyZ - podZ) * 0.5, LIME, { uplight: false });
    const vv = v0 + 0.14 + (v1 - v0 - 0.28) * t;
    p.box(u1 - 0.1, vv - 0.025, u1 - 0.05, vv + 0.025, podZ, podZ + (bodyZ - podZ) * 0.5, LIME, { uplight: false });
  }
  p.door(u0 + 0.14, v1 - 0.14, u1 - 0.14, v1 - 0.14, 0.42, 0.58, podZ, podZ + 8, WARMW);
  // Drum and verdigris dome on the centre line.
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.42;
  p.cyl(u, v, R, bodyZ, bodyZ + d.h * 0.12, LIME, SLATE);
  p.cylBands(u, v, R, bodyZ + 2, bodyZ + d.h * 0.12, 7);
  p.dome(u, v, R, bodyZ + d.h * 0.12, d.h * 0.2, VERD);
  pole(p, u, v, bodyZ + d.h * 0.32, d.z0 + d.h, STEEL, 0.6);
  if (d.banners && BANNERS.on) pennants(p, u0 + 0.14, u1 - 0.14, v1 - 0.12, bodyZ);
};

/** B: Stepped Tower — three setbacks, a clock face on the top tier. */
export const steppedTower: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const fr = [0.36, 0.3, 0.24];
  let z = d.z0;
  const tiers = [0.44, 0.3, 0.2];
  for (let i = 0; i < 3; i++) {
    const ins = 0.06 + i * Math.min(u1 - u0, v1 - v0) * 0.12;
    const h = d.h * tiers[i];
    p.box(u0 + ins, v0 + ins, u1 - ins, v1 - ins, z, z + h, i % 2 ? SLATE : LIME, { win: W_WARM, top: i === 2 ? VERD : LIME });
    if (i < 2) p.box(u0 + ins, v1 - ins, u1 - ins, v1 - ins + 0.03, z + h - 2, z + h, VERD, { uplight: false });
    z += h;
    void fr;
  }
  const ins = 0.06 + 2 * Math.min(u1 - u0, v1 - v0) * 0.12;
  clockFace(p, cx(d.b), v1 - ins + 0.005, z - d.h * 0.1, Math.max(4, (u1 - u0 - 2 * ins) * 12), CREAM, WARMW);
  sigAt(p, cx(d.b), v1 - ins + 0.005, z - d.h * 0.1, (x, y) => ({ k: 'clock', x, y, r: Math.max(4, (u1 - u0 - 2 * ins) * 12) }));
  pyramid(p, u0 + ins, v0 + ins, u1 - ins, v1 - ins, z, d.z0 + d.h - z, VERD);
  if (d.banners && BANNERS.on) flag(p, cx(d.b), cy(d.b), d.z0 + d.h - 2, BANNER, 7, 4);
};

/** C: Open Belfry — a slender tower with an open lit top. */
export const openBelfry: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.45;
  const bz = d.z0 + d.h * 0.72;
  p.box(u - R * 1.4, v - R * 1.4, u + R * 1.4, v + R * 1.4, d.z0, d.z0 + d.h * 0.1, SLATE, { top: LIME });
  p.box(u - R, v - R, u + R, v + R, d.z0 + d.h * 0.1, bz, LIME, { win: W_WARM, top: SLATE });
  // The open belfry: four corner piers, a lit bell inside, a cap.
  for (const [a, b] of [
    [u + R, v - R],
    [u + R, v + R],
    [u - R, v + R],
  ] as const)
    p.box(a - 0.04, b - 0.04, a + 0.04, b + 0.04, bz, bz + d.h * 0.14, LIME, { uplight: false });
  p.glow(u, v, bz + d.h * 0.07, WARMW, R * 120, p.glowA() * 0.9 + 0.1);
  p.lamp(u, v, bz + d.h * 0.07, WARMW, 14);
  p.box(u - R - 0.04, v - R - 0.04, u + R + 0.04, v + R + 0.04, bz + d.h * 0.14, bz + d.h * 0.17, SLATE, { uplight: false });
  pyramid(p, u - R - 0.04, v - R - 0.04, u + R + 0.04, v + R + 0.04, bz + d.h * 0.17, d.z0 + d.h - bz - d.h * 0.17, VERD);
  clockFace(p, u, v + R + 0.005, bz - d.h * 0.08, R * 18, CREAM, WARMW);
  sigAt(p, u, v + R + 0.005, bz - d.h * 0.08, (x, y) => ({ k: 'clock', x, y, r: R * 18 }));
  if (d.banners && BANNERS.on) pennants(p, u - R * 1.3, u + R * 1.3, v + R * 1.35, d.z0 + d.h * 0.1, 3);
};

// ════════════════════════════════════════════════════════════════════════════
// UNDERTOW · Salvage and Tide (always asymmetric; ≥ 3 materials; something hangs)
// ════════════════════════════════════════════════════════════════════════════

const CONT: RGB[] = [
  [132, 84, 60],
  [60, 120, 140],
  [56, 92, 80],
  [150, 120, 60],
];

/** A swinging green lamp on a chain (registers the Undertow signature). */
function swingLamp(p: Painter, u: number, v: number, z: number, len = 6) {
  pole(p, u, v, z - len, z, mat([60, 60, 60]), 0.35);
  p.lamp(u, v, z - len, GLAMP, 10);
  sigAt(p, u, v, z, (x, y) => ({ k: 'swing', x, y, c: GLAMP, len }));
}

/** A: Hull Stack — containers three high under an upturned boat hull. */
export const hullStack: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  // Containers stay container-sized (≈ 9–11 px); a taller use stacks more of them.
  const levels = Math.max(3, Math.min(6, Math.round((d.h * 0.62) / 10)));
  const ch = Math.max(6, (d.h * 0.62) / levels);
  for (let L = 0; L < levels; L++) {
    const shift = (L % 2) * 0.12;
    p.container(u0 + 0.06 + shift, v0 + 0.1, u1 - 0.1 + shift * 0.3, v0 + (v1 - v0) * 0.5, d.z0 + L * ch, ch - 0.5, CONT[L % 4]);
    p.container(u0 + 0.1, v0 + (v1 - v0) * 0.5 + 0.02, u1 - 0.06 - shift, v1 - 0.1, d.z0 + L * ch, ch - 0.5, CONT[(L + 2) % 4]);
  }
  const hz = d.z0 + levels * ch;
  hull(p, u0, v0 + 0.05, u1 + 0.1, v1 - 0.05, hz, d.z0 + d.h - hz, HULLG);
  // Cut windows lit green, a net hanging off the front.
  p.door(u0 + 0.1, v1 - 0.1, u1 - 0.06, v1 - 0.1, 0.2, 0.4, d.z0 + ch + 2, d.z0 + 2 * ch - 2, GLAMP);
  p.door(u1 - 0.06, v0 + 0.1, u1 - 0.06, v1 - 0.1, 0.55, 0.8, d.z0 + 2 * ch + 2, d.z0 + 3 * ch - 2, GLAMP);
  p.laundry(u0 + 0.2, v1 - 0.06, u0 + (u1 - u0) * 0.6, v1 - 0.06, hz - 6);
  swingLamp(p, u1 - 0.12, v1 - 0.08, hz, 7);
  swingLamp(p, u0 + 0.2, v1 - 0.08, d.z0 + ch * 1.9, 5);
};

/** B: Net Loft — a scaffold tower hung with drying nets and lamps. */
export const netLoft: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const w = Math.min(u1 - u0, v1 - v0);
  const a: Box4 = [u0 + w * 0.2, v0 + w * 0.15, u1 - w * 0.25, v1 - w * 0.2];
  p.box(a[0], a[1], a[2], a[3], d.z0, d.z0 + d.h * 0.55, URUST, { win: { style: 'capsule', floor: 7, col: 6, w: 0.6, h: 0.5, lit: 1.2 }, top: TARPB });
  p.box(a[0] + 0.05, a[1], a[2] - (a[2] - a[0]) * 0.4, a[3] - 0.05, d.z0 + d.h * 0.55, d.z0 + d.h * 0.78, HULLG, { win: W_GRID, top: TARPB });
  lattice(p, a[0] - 0.08, a[1] - 0.08, a[2] + 0.06, a[3] + 0.06, d.z0, d.z0 + d.h * 0.95, mat([150, 130, 100]), 9, 0.6);
  // Drying nets hung on the scaffold's two street faces.
  const g = p.g;
  for (let k = 0; k < 3; k++) {
    const z1 = d.z0 + d.h * (0.35 + k * 0.2);
    const z0 = z1 - d.h * 0.14;
    const t0 = 0.1 + k * 0.25;
    if (g) {
      p.begin_();
      p.quad(a[0] + (a[2] - a[0]) * t0, a[3] + 0.06, z0, a[0] + (a[2] - a[0]) * (t0 + 0.3), a[3] + 0.06, z0 + 2, a[0] + (a[2] - a[0]) * (t0 + 0.3), a[3] + 0.06, z1, a[0] + (a[2] - a[0]) * t0, a[3] + 0.06, z1);
      p.fill(p.col(NET, 0.9, 0.55));
      if (!p.lod) {
        p.begin_();
        for (let j = 0; j < 5; j++) {
          const t = t0 + (0.3 * j) / 4;
          p.m(a[0] + (a[2] - a[0]) * t, a[3] + 0.06, z0);
          p.l(a[0] + (a[2] - a[0]) * t, a[3] + 0.06, z1);
        }
        p.stroke(p.col(mat([90, 90, 90]), 1, 0.6), 0.3);
      }
    } else p.m(a[0] + (a[2] - a[0]) * t0, a[3] + 0.06, z1);
    swingLamp(p, a[2] + 0.06, a[1] + (a[3] - a[1]) * (0.2 + k * 0.3), z1, 5);
  }
  p.antenna(a[0] + 0.1, a[1] + 0.1, d.z0 + d.h * 0.95, d.h * 0.05 + 4, GLAMP);
};

/** C: Crane Hab — a dock crane with cabins along the jib. */
export const craneHab: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const mu = u0 + (u1 - u0) * 0.3;
  const mv = v0 + (v1 - v0) * 0.35;
  const top = d.z0 + d.h * 0.86;
  p.box(u0 + 0.08, v0 + 0.08, u1 - 0.1, v1 - 0.08, d.z0, d.z0 + d.h * 0.15, URUST, { win: { style: 'capsule', floor: 7, col: 6, w: 0.6, h: 0.5 }, top: TARPB });
  lattice(p, mu - 0.12, mv - 0.12, mu + 0.12, mv + 0.12, d.z0 + d.h * 0.15, top, mat([200, 160, 60]), 8, 0.9);
  // The jib with cabins hung along it (asymmetric: it reaches out over the street).
  const jibL = (u1 - u0) * 1.05;
  p.box(mu - 0.25, mv - 0.06, mu + jibL, mv + 0.06, top, top + 4, mat([200, 160, 60]), { uplight: false });
  for (let i = 0; i < 4; i++) {
    const u = mu + 0.15 + i * (jibL / 4.4);
    const ch = 8 + (i % 2) * 3;
    p.box(u, mv - 0.1, u + 0.18, mv + 0.12, top - ch, top, i % 2 ? HULLG : TARPB, { win: { style: 'capsule', floor: ch, col: 4, w: 0.6, h: 0.5, lit: 1.4 }, top: URUST });
    swingLamp(p, u + 0.18, mv + 0.12, top - ch, 4);
  }
  p.box(mu - 0.25, mv - 0.15, mu - 0.05, mv + 0.15, top - 8, top + 4, URUST, { uplight: false });
  p.blinker(mu + jibL, mv, top + 5, GLAMP, 1.6, 12);
  p.reach(d.z0 + d.h);
};

// ════════════════════════════════════════════════════════════════════════════
// KITES · Rig and Sail (light add-ons over something; diagonals)
// ════════════════════════════════════════════════════════════════════════════

/** A mast with a blinking tip (registers the Kites tip pattern). */
const MASTC = mat([150, 140, 178], [70, 60, 100]);
function kmast(p: Painter, u: number, v: number, z: number, h: number, i: number) {
  pole(p, u, v, z, z + h, MASTC, 0.7);
  p.lamp(u, v, z + h, i % 3 === 0 ? STRING : LILAC, 8);
  sigAt(p, u, v, z + h, (x, y) => ({ k: 'tips', x, y, c: LILAC, n: i }));
}

/** A kite tugging on its line by day (signature). */
function kite(p: Painter, u: number, v: number, z: number) {
  sigAt(p, u, v, z, (x, y) => ({ k: 'kite', x, y, c: LILAC }));
  p.track(p.X(u, v) - 30, p.Y(u, v, z) - 40);
}

/** A: Antenna Forest — 8–12 masts of mixed height with blinking tips, over a low deck. */
export const antennaForest: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const base = d.z0 + d.h * 0.3;
  p.box(u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.1, d.z0, base, KDECK, { win: W_GRID, top: mat([80, 76, 96]) });
  const n = 8 + Math.floor(p.rng.next() * 5);
  for (let i = 0; i < n; i++) {
    const u = u0 + 0.15 + p.rng.next() * (u1 - u0 - 0.3);
    const v = v0 + 0.15 + p.rng.next() * (v1 - v0 - 0.3);
    const h = (d.h * 0.7) * (0.45 + 0.55 * p.rng.next());
    kmast(p, u, v, base, h, i);
    if (i % 4 === 1) p.dish(u, v, base + h * 0.6, 0.05);
  }
  lampString(p, [u0 + 0.15, v1 - 0.15, base + d.h * 0.3], [u1 - 0.15, v1 - 0.15, base + d.h * 0.2], 7, [STRING, LILAC], 4, 6);
  // Two diamond banners on the tallest masts, so the forest reads at a distance.
  const w = Math.min(u1 - u0, v1 - v0);
  sail(p, u0 + w * 0.3, v1 - w * 0.3, base + d.h * 0.45, w * 0.36, d.h * 0.16, mat([214, 196, 250], [48, 40, 70]), LILAC);
  sail(p, u1 - w * 0.25, v0 + w * 0.3, base + d.h * 0.6, w * 0.3, d.h * 0.13, SAILC, LILAC);
  kite(p, u1 + 0.3, v0 - 0.2, d.z0 + d.h * 1.05);
  p.reach(d.z0 + d.h);
};

/** B: Sail Canopy — four diamond sails on masts over the roof. */
export const sailCanopy: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const base = d.z0 + d.h * 0.45;
  p.box(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.12, d.z0, base, KDECK, { win: W_BAND, top: mat([84, 80, 100]), trim: LILAC });
  const w = Math.min(u1 - u0, v1 - v0);
  const spots: [number, number][] = [
    [u0 + w * 0.3, v0 + w * 0.3],
    [u1 - w * 0.28, v0 + w * 0.35],
    [u0 + w * 0.35, v1 - w * 0.28],
    [u1 - w * 0.3, v1 - w * 0.3],
  ];
  spots.forEach(([u, v], i) => {
    const mh = d.h * (0.38 + (i % 2) * 0.12);
    kmast(p, u, v, base, mh + d.h * 0.1, i);
    sail(p, u, v, base + mh, w * 0.42, d.h * 0.2, i % 2 ? SAILC : mat([214, 196, 250], [48, 40, 70]), LILAC);
  });
  kite(p, u1 + 0.2, v0, d.z0 + d.h * 1.05);
  p.reach(d.z0 + d.h);
};

/** C: Rope Roost — stacked platforms, ladders and nets. */
export const ropeRoost: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const n = 4;
  const w = Math.min(u1 - u0, v1 - v0);
  for (let i = 0; i < n; i++) {
    const z = d.z0 + (d.h * 0.9 * i) / n;
    const sh = (i % 2 ? 0.12 : -0.08) * w;
    const r = w * (0.42 - i * 0.05);
    const cu = cx(d.b) + sh;
    const cv = cy(d.b) - sh;
    // Posts (diagonal braces) and the platform.
    if (i > 0) {
      p.begin_();
      p.m(cu - r, cv + r, z - (d.h * 0.9) / n);
      p.l(cu - r * 0.8, cv + r * 0.8, z);
      p.m(cu + r, cv - r, z - (d.h * 0.9) / n);
      p.l(cu + r * 0.8, cv - r * 0.8, z);
      p.m(cu + r, cv + r, z - (d.h * 0.9) / n);
      p.l(cu + r * 0.7, cv + r * 0.7, z);
      p.stroke(p.col(CABLE, 1), 0.7);
    }
    p.box(cu - r, cv - r, cu + r, cv + r, z, z + 2.5, KDECK, { uplight: false });
    if (i === 0) p.box(cu - r * 0.8, cv - r * 0.8, cu + r * 0.8, cv + r * 0.8, d.z0, d.z0 + (d.h * 0.9) / n - 1, mat([120, 112, 140], [24, 22, 34]), { win: W_GRID, top: KDECK });
    else p.box(cu - r * 0.5, cv - r * 0.5, cu + r * 0.4, cv + r * 0.4, z + 2.5, z + 9, mat([150, 140, 170], [30, 28, 42]), { win: { style: 'grid', floor: 6, col: 6, w: 0.5, h: 0.5, lit: 1.5 }, top: mat([200, 180, 240]) });
    lampString(p, [cu - r, cv + r, z + 2.5], [cu + r, cv + r, z + 2.5], 5, [STRING, LILAC], 2, 5);
    // A ladder up the front.
    if (p.g && !p.lod && i < n - 1) {
      p.begin_();
      const lu = cu + r * 0.6;
      p.m(lu, cv + r, z);
      p.l(lu, cv + r, z + (d.h * 0.9) / n);
      p.m(lu + 0.06, cv + r, z);
      p.l(lu + 0.06, cv + r, z + (d.h * 0.9) / n);
      for (let s = 2; s < (d.h * 0.9) / n; s += 2.5) {
        p.m(lu, cv + r, z + s);
        p.l(lu + 0.06, cv + r, z + s);
      }
      p.stroke(p.col(CABLE, 1, 0.8), 0.4);
    }
  }
  kmast(p, cx(d.b), cy(d.b), d.z0 + d.h * 0.9, d.h * 0.1, 3);
  kite(p, u1 + 0.25, v0 - 0.15, d.z0 + d.h * 1.02);
};

// ════════════════════════════════════════════════════════════════════════════
// TUNING · Lamp and Hymn (warm light only; no billboards)
// ════════════════════════════════════════════════════════════════════════════

/** A pulsing lantern window (the Tuning signature; in step across the city). */
function lanternSig(p: Painter, u: number, v: number, z: number, size: number) {
  sigAt(p, u, v, z, (x, y) => ({ k: 'lantern', x, y, c: CANDLE, size }));
}

/** A: Lamp Chapel — a pointed roof with an open lantern. */
export const lampChapel: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  const wz = d.z0 + d.h * 0.42;
  p.box(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.12, d.z0, wz, CREAM, { win: { style: 'slit', floor: 10, col: 7, w: 0.3, h: 0.7, lit: 1.6 }, noTop: true });
  pyramid(p, u0 + 0.08, v0 + 0.08, u1 - 0.08, v1 - 0.08, wz, d.h * 0.28, COPPER);
  const u = cx(d.b);
  const v = cy(d.b);
  const r = half(d.b) * 0.3;
  lanternRoof(p, u, v, r, wz + d.h * 0.2, d.h * 0.18, d.z0 + d.h - (wz + d.h * 0.38) - 1.5, COPPER, CANDLE);
  lanternSig(p, u, v, wz + d.h * 0.29, r * 90);
  p.door(u0 + 0.12, v1 - 0.12, u1 - 0.12, v1 - 0.12, 0.4, 0.6, d.z0, d.z0 + 8, CANDLE);
  for (let i = 0; i < 4; i++) p.lamp(u0 + 0.2 + i * ((u1 - u0 - 0.4) / 3), v1 - 0.06, d.z0 + 4, CANDLE, 8);
};

/** B: Coil Belfry — a copper coil tower with a humming glow. */
export const coilBelfry: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.5;
  p.box(u - R * 1.5, v - R * 1.5, u + R * 1.5, v + R * 1.5, d.z0, d.z0 + d.h * 0.12, CREAM, { win: W_WARM, top: COPPER });
  p.cyl(u, v, R, d.z0 + d.h * 0.12, d.z0 + d.h * 0.72, NIGHTB, COPPER, R * 0.85);
  coil(p, u, v, R, d.z0 + d.h * 0.14, d.z0 + d.h * 0.7, COPPER_RGB, CANDLE);
  // The bell dome on top with a lit ring under it.
  p.cyl(u, v, R * 0.95, d.z0 + d.h * 0.72, d.z0 + d.h * 0.78, COPPER, COPPER);
  p.neonRing(u, v, R * 0.95, d.z0 + d.h * 0.74, CANDLE, 1.4, true);
  p.dome(u, v, R * 0.9, d.z0 + d.h * 0.78, d.h * 0.15, COPPER);
  pole(p, u, v, d.z0 + d.h * 0.93, d.z0 + d.h, COPPER, 0.7);
  p.glow(u, v, d.z0 + d.h * 0.5, CANDLE, R * 150, p.glowA() * 0.5);
  lanternSig(p, u, v, d.z0 + d.h * 0.74, R * 80);
};

/** C: Choir Ring — a ring of lit windows around a court, concentric ground rings. */
export const choirRing: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.92;
  const hz = d.z0 + d.h * 0.7;
  // The back half of the ring, the lit court, then the front half (two arcs of boxes).
  const n = 10;
  const draw = (front: boolean) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const isFront = Math.sin(a + Math.PI / 4) > 0;
      if (isFront !== front) continue;
      const bu = u + Math.cos(a) * R * 0.78;
      const bv = v + Math.sin(a) * R * 0.78;
      const s = R * 0.2;
      p.box(bu - s, bv - s, bu + s, bv + s, d.z0, hz - (i % 2) * d.h * 0.08, CREAM, { win: { style: 'slit', floor: 8, col: 5, w: 0.4, h: 0.7, lit: 1.8 }, top: COPPER });
      if (i % 2 === 0) lanternRoof(p, bu, bv, s * 0.7, hz - (i % 2) * d.h * 0.08, 5, d.h * 0.12, COPPER, CANDLE);
    }
  };
  draw(false);
  p.neonRing(u, v, R * 0.45, d.z0 + 0.6, CANDLE, 0.9, true);
  p.neonRing(u, v, R * 0.28, d.z0 + 0.6, CANDLE, 0.7, true);
  p.glow(u, v, d.z0 + 6, CANDLE, R * 120, p.glowA() * 0.7);
  lanternSig(p, u, v, d.z0 + 8, R * 60);
  draw(true);
  p.reach(d.z0 + d.h);
};

// ════════════════════════════════════════════════════════════════════════════
// INDEPENDENT SPIRES (neutral glass and steel)
// ════════════════════════════════════════════════════════════════════════════

const NEUTRAL: RGB = [200, 230, 255];

/** Needle: a very slim glass shaft on a podium with a long mast. */
export const needle: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b);
  p.chamfer(u - R * 0.95, v - R * 0.95, u + R * 0.95, v + R * 0.95, R * 0.3, d.z0, d.z0 + 20, STEELG, { win: W_GRID, top: DARKR, trim: NEUTRAL });
  p.chamfer(u - R * 0.34, v - R * 0.34, u + R * 0.34, v + R * 0.34, R * 0.12, d.z0 + 20, d.z0 + d.h * 0.78, STEELG, { win: W_CURT, glass: GLASS, top: DARKR, trim: NEUTRAL });
  p.neon([u + R * 0.34, v + R * 0.22, d.z0 + 22, u + R * 0.34, v + R * 0.22, d.z0 + d.h * 0.76], NEUTRAL, 0.9);
  pole(p, u, v, d.z0 + d.h * 0.78, d.z0 + d.h, STEEL, 1.1);
  p.blinker(u, v, d.z0 + d.h, NEON.red, 1.3, 18);
  p.glow(u, v, d.z0 + d.h * 0.78, NEUTRAL, 50, p.glowA() * 0.5);
};

/** Twin Blade: two knife-edged slabs offset on one podium. */
export const twinBlade: Design = (p, d) => {
  const [u0, v0, u1, v1] = d.b;
  p.box(u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, d.z0, d.z0 + 16, STEELG, { win: W_BAND, top: DARKR });
  const w = u1 - u0;
  p.prism([u0 + w * 0.15, v0 + w * 0.2, u0 + w * 0.5, v0 + w * 0.12, u0 + w * 0.42, v0 + w * 0.52, u0 + w * 0.12, v0 + w * 0.46], d.z0 + 16, d.z0 + d.h * 0.86, STEELG, { win: W_CURT, glass: GLASS, top: DARKR, trim: NEUTRAL });
  p.prism([u0 + w * 0.55, v0 + w * 0.5, u0 + w * 0.88, v0 + w * 0.54, u0 + w * 0.84, v0 + w * 0.88, u0 + w * 0.52, v0 + w * 0.8], d.z0 + 16, d.z0 + d.h * 0.72, STEELG, { win: W_CURT, glass: GLASS, top: DARKR, trim: NEUTRAL });
  pole(p, u0 + w * 0.3, v0 + w * 0.3, d.z0 + d.h * 0.86, d.z0 + d.h, STEEL, 0.9);
  p.blinker(u0 + w * 0.3, v0 + w * 0.3, d.z0 + d.h, NEON.red, 1.5, 16);
};

/** Lattice: a glass shaft inside an exposed steel diagrid. */
export const latticeSpire: Design = (p, d) => {
  const u = cx(d.b);
  const v = cy(d.b);
  const R = half(d.b) * 0.62;
  p.box(u - R * 1.4, v - R * 1.4, u + R * 1.4, v + R * 1.4, d.z0, d.z0 + 14, STEELG, { win: W_BAND, top: DARKR });
  p.box(u - R * 0.7, v - R * 0.7, u + R * 0.7, v + R * 0.7, d.z0 + 14, d.z0 + d.h * 0.84, mat([70, 90, 120], [10, 14, 30]), { win: W_CURT, glass: GLASS, top: DARKR });
  // Diagrid: crossing diagonals on the two visible faces.
  if (p.g) {
    p.begin_();
    const z0 = d.z0 + 14;
    const z1 = d.z0 + d.h * 0.84;
    const step = (z1 - z0) / 8;
    for (let z = z0; z < z1 - 0.1; z += step) {
      p.m(u - R * 0.72, v + R * 0.72, z);
      p.l(u + R * 0.72, v + R * 0.72, z + step);
      p.m(u + R * 0.72, v + R * 0.72, z);
      p.l(u - R * 0.72, v + R * 0.72, z + step);
      p.m(u + R * 0.72, v - R * 0.72, z);
      p.l(u + R * 0.72, v + R * 0.72, z + step);
      p.m(u + R * 0.72, v + R * 0.72, z);
      p.l(u + R * 0.72, v - R * 0.72, z + step);
    }
    p.stroke(p.col(STEEL, 1.1), p.lod ? 1.2 : 0.8);
  }
  p.neonRing(u, v, R, d.z0 + d.h * 0.84, NEUTRAL, 1, true);
  pole(p, u, v, d.z0 + d.h * 0.84, d.z0 + d.h, STEEL, 1);
  p.blinker(u, v, d.z0 + d.h, NEON.red, 1.4, 16);
};

// ════════════════════════════════════════════════════════════════════════════
// LOOK TABLES (§6.2 "Where each language appears")
// ════════════════════════════════════════════════════════════════════════════

export const DESIGNS = {
  basalt: [hexColumn, buttressHall, crucible, gantrySpine],
  nacre: [spiral, pearlDrop, ribbonTwins, haloAtrium],
  board: [charterBlock, steppedTower, openBelfry],
  undertow: [hullStack, netLoft, craneHab],
  kites: [antennaForest, sailCanopy, ropeRoost],
  tuning: [lampChapel, coilBelfry, choirRing],
} as const;

/** Corp Spire looks by sponsor (look 0 of Nacre is today's Facet: buildings.ts keeps that recipe). */
export const SPIRE_LOOKS: Record<'nacre' | 'basalt' | 'none', (Design | null)[]> = {
  nacre: [null, spiral, pearlDrop, haloAtrium],
  basalt: [hexColumn, crucible, gantrySpine],
  none: [needle, twinBlade, latticeSpire],
};

/** Stratablock crown looks (look 0 = today's crown for the four old crowns). */
export const CROWN_LOOKS: Record<string, (Design | null)[]> = {
  foundry: [null, crucible, hexColumn],
  glare: [null, pearlDrop, haloAtrium],
  nest: [null, antennaForest, sailCanopy],
  commons: [null, steppedTower, openBelfry],
  salvage: [hullStack, netLoft, craneHab],
  lamp: [lampChapel, coilBelfry, choirRing],
};

/** Faction building looks 1 and 2 (look 0 = today's art/story.ts recipe). */
export const FACTION_BUILDING_LOOKS: Partial<Record<string, [Design, Design]>> = {
  foundry: [buttressHall, hexColumn],
  glarewall: [pearlDrop, spiral],
  tidemarket: [hullStack, craneHab],
  roost: [antennaForest, ropeRoost],
  commons: [charterBlock, steppedTower],
};

/** The faction a building family belongs to (standing light). */
export const FAMILY_FACTION: Partial<Record<string, FactionId>> = {
  foundry: 'basalt',
  glarewall: 'nacre',
  tidemarket: 'undertow',
  roost: 'kites',
  commons: 'board',
  charterhall: 'board',
  hexworks: 'basalt',
  pearlatrium: 'nacre',
  hullhouse: 'undertow',
  kitemast: 'kites',
  lampchoir: 'tuning',
};

/** The faction of a crown. */
export const CROWN_FACTION: Record<string, FactionId> = { foundry: 'basalt', glare: 'nacre', nest: 'kites', commons: 'board', salvage: 'undertow', lamp: 'tuning' };

// ════════════════════════════════════════════════════════════════════════════
// SIGNATURES (live, drawn after the body sprite)
// ════════════════════════════════════════════════════════════════════════════

const glowCache = new Map<number, HTMLCanvasElement>();
function glowOf(c: RGB): HTMLCanvasElement {
  const k = (c[0] << 16) | (c[1] << 8) | c[2];
  let g = glowCache.get(k);
  if (!g) {
    g = glowSprite(c, 32);
    glowCache.set(k, g);
  }
  return g;
}

export interface SigState {
  time: number;
  night: number;
  lit: boolean;
  lod: boolean;
  phase: number;
}

/** Draw a body's signature anchors live at its world origin (wx, wy). */
export function drawSigs(ctx: CanvasRenderingContext2D, sigs: readonly Sig[], wx: number, wy: number, s: SigState): void {
  if (!s.lit || !sigs.length) return;
  const n = s.night;
  const t = s.time;
  for (const g of sigs) {
    const x = wx + ('x' in g ? g.x : 0);
    const y = wy + ('y' in g ? g.y : 0);
    switch (g.k) {
      case 'furnace': {
        if (n < 0.2 || s.lod) break;
        const f = 0.55 + 0.45 * Math.sin(t * 7.3 + s.phase * 11 + g.x) * Math.sin(t * 3.1 + g.y);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, f) * n * 0.6;
        ctx.drawImage(glowOf(FURNACE), x - g.w, y - 6, g.w * 2, 12);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'flare': {
        // Shift change at dusk and dawn: a tall flare while the night amount crosses the middle.
        const k = Math.max(0, 1 - Math.abs(n - 0.5) / 0.12);
        if (k <= 0) break;
        const fl = k * (0.7 + 0.3 * Math.sin(t * 13 + g.x));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fl;
        ctx.drawImage(glowOf(FURNACE), x - 10, y - 34, 20, 36);
        ctx.drawImage(glowOf([255, 220, 120]), x - 5, y - 22, 10, 22);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'halo': {
        if (n < 0.15) break;
        // One turn a minute: a bright bead running round the ring.
        const a = (t / 60) * Math.PI * 2 + s.phase * 6;
        const bx = x + Math.cos(a) * g.rx;
        const by = y + Math.sin(a) * g.ry;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = n * 0.8;
        ctx.drawImage(glowOf(g.c), bx - 7, by - 7, 14, 14);
        ctx.globalAlpha = n * 0.4;
        ctx.drawImage(glowOf(g.c), x - g.rx * 1.1 + (bx - x) * 0.2, y - g.ry * 1.1, g.rx * 2.2, g.ry * 2.2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'clock': {
        if (s.lod) break;
        // The visual clock: day 0 = noon, night 1 = midnight; the hands sweep with it.
        const hour = ((t / 30) % 12) / 12;
        const a1 = hour * Math.PI * 2 - Math.PI / 2;
        const a2 = ((t / 2.5) % 1) * Math.PI * 2 - Math.PI / 2;
        ctx.strokeStyle = n > 0.5 ? 'rgba(80,60,30,0.95)' : 'rgba(40,40,50,0.9)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a1) * g.r * 0.45, y + Math.sin(a1) * g.r * 0.5);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a2) * g.r * 0.7, y + Math.sin(a2) * g.r * 0.75);
        ctx.stroke();
        break;
      }
      case 'flag': {
        if (s.lod) break;
        const w = Math.sin(t * 3 + g.x * 0.3) * 1.2;
        ctx.fillStyle = css(mix(g.c, [255, 255, 255], 0.2 * (1 - n)), 0.9);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + g.len, y + 1.2 + w);
        ctx.lineTo(x, y + 3);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'swing': {
        if (n < 0.2 || s.lod) break;
        const sw = Math.sin(t * 1.6 + g.x * 0.7 + s.phase * 5) * 0.35;
        const lx = x + Math.sin(sw) * g.len;
        const ly = y + Math.cos(sw) * g.len;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = n * 0.85;
        ctx.drawImage(glowOf(g.c), lx - 6, ly - 6, 12, 12);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'tips': {
        // Patterned blinking: each tip in a running sequence.
        const k = Math.floor(t * 4 + s.phase * 8);
        if ((k + g.n) % 5 !== 0 || n < 0.15) break;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6 + 0.4 * n;
        ctx.drawImage(glowOf(g.c), x - 6, y - 6, 12, 12);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'kite': {
        if (n > 0.6 || s.lod) break;
        // Two kites tug on their lines by day.
        for (let i = 0; i < 2; i++) {
          const kx = x - i * 16 + Math.sin(t * 0.9 + i * 2 + s.phase * 4) * 5;
          const ky = y - 18 - i * 8 + Math.cos(t * 1.3 + i) * 3;
          ctx.strokeStyle = 'rgba(40,40,50,0.5)';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.moveTo(x - i * 10, y);
          ctx.quadraticCurveTo(x - i * 12 - 4, y - 8, kx, ky + 4);
          ctx.stroke();
          ctx.fillStyle = css(i ? [236, 236, 246] : g.c, 0.95);
          ctx.beginPath();
          ctx.moveTo(kx, ky - 4);
          ctx.lineTo(kx + 3, ky);
          ctx.lineTo(kx, ky + 4);
          ctx.lineTo(kx - 3, ky);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'lantern': {
        if (n < 0.2) break;
        // In step across the city: the phase is the time alone.
        const k = 0.6 + 0.4 * Math.sin(t * 1.1);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = n * k * 0.7;
        ctx.drawImage(glowOf(g.c), x - g.size / 2, y - g.size / 2, g.size, g.size);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'sweep': {
        if (n < 0.3) break;
        // A beam turning once every 8 s, foreshortened on the iso plane.
        const a = (t / 8) * Math.PI * 2 + s.phase * 6;
        const ex = x + Math.cos(a) * g.len;
        const ey = y + Math.sin(a) * g.len * 0.5;
        const grad = ctx.createLinearGradient(x, y, ex, ey);
        grad.addColorStop(0, css(g.c, 0.5 * n));
        grad.addColorStop(1, css(g.c, 0));
        const px = -Math.sin(a) * 10;
        const py = Math.cos(a) * 5;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex + px * 2.5, ey + py * 2.5);
        ctx.lineTo(ex - px * 2.5, ey - py * 2.5);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = n;
        ctx.drawImage(glowOf(g.c), x - 9, y - 9, 18, 18);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'ledger': {
        if (s.lod) break;
        if (ledgerFace(ctx, x + g.ox, y + g.oy, g.ex, g.ey, g.h, g.c, !!g.frozen, t)) break; // MEGACITY §9.2: the live ledger text (WP-8)
        // Lines of figures rising up the face; frozen ones stay put and dim.
        const rows = Math.max(3, Math.floor(g.h / 7));
        const off = g.frozen ? 0 : (t * 6) % 7;
        ctx.globalAlpha = g.frozen ? 0.35 : 0.55 + 0.4 * n;
        ctx.fillStyle = css(g.c);
        for (let r = 0; r < rows; r++) {
          const z = r * 7 + off;
          if (z > g.h - 3) continue;
          for (let c = 0; c < 6; c++) {
            const seg = ((r * 31 + c * 7 + (g.frozen ? 0 : Math.floor(t * 6 / 7))) % 5) / 5;
            if (seg < 0.2) continue;
            const t0 = 0.06 + c * 0.155;
            const t1 = t0 + 0.13 * seg;
            const x0 = x + g.ox + g.ex * t0;
            const y0 = y + g.oy + g.ey * t0 - z;
            const x1 = x + g.ox + g.ex * t1;
            const y1 = y + g.oy + g.ey * t1 - z;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.lineTo(x1, y1 - 1.6);
            ctx.lineTo(x0, y0 - 1.6);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'smile': {
        if (n < 0.25) break;
        if (smileFace(ctx, x, y, g.r, g.c, n, t)) break; // MEGACITY §9.2: the smile follows the camera (WP-8)
        // MOTH's smile: an original pearl disc with two dots and an arc.
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = n * 0.75;
        ctx.fillStyle = css(g.c, 0.5);
        ctx.beginPath();
        ctx.ellipse(x, y, g.r * 0.92, g.r * 0.92, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = n;
        ctx.fillStyle = css([255, 255, 255], 0.9);
        ctx.fillRect(x - g.r * 0.35, y - g.r * 0.25, g.r * 0.14, g.r * 0.14);
        ctx.fillRect(x + g.r * 0.21, y - g.r * 0.25, g.r * 0.14, g.r * 0.14);
        ctx.strokeStyle = css([255, 255, 255], 0.9);
        ctx.lineWidth = Math.max(1, g.r * 0.08);
        ctx.beginPath();
        ctx.arc(x, y + g.r * 0.02, g.r * 0.42, 0.25 * Math.PI, 0.75 * Math.PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
    }
  }
}

/** Half-height helper for callers (projected tile height). */
export const PROJ = { HALF_W, HALF_H };
