// ─────────────────────────────────────────────────────────────────────────────
// Service building recipes: one hand-built design per BuildingType, each with
// a distinct silhouette that reads at a glance:
//
//   solar     tilted panel rows that mirror the sky
//   reactor   containment dome + torus with a pulsing violet core, coolant towers
//   plaza     paved square with a holographic light-tree and benches
//   precinct  fortified block, drone pad, blue/red strobes
//   clinic    white-teal medical block with a heartbeat-line sign
//   datahub   lattice mast firing data pulses into the sky
//   maglev    elevated platform, guideway with glowing rails, parked pod
//   spire     very tall faceted corporate tower with a crown light
//   arcology  stepped ziggurat megastructure covered in lights
//
// Footprint coordinates span 0..size. Offline / unpowered buildings paint with
// lights off and register a red 'warn' blink.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuildingType } from '../../game/types';
import { NEON, css, mix, type RGB } from '../palette';
import { GLASS, mat, type ArtPal, type Mat, type Painter, type WinSpec } from './painter';
import type { Recipe } from './zones';

const CONC = mat([124, 126, 140]);
const PAD = mat([96, 98, 110]);
const ROOF = mat([104, 100, 112]);
const ROOF_DARK = mat([76, 74, 88]);
const STEEL = mat([140, 144, 152]);
const W_CURT: WinSpec = { style: 'curtain', floor: 7, col: 7, w: 1, h: 0.82, margin: 1 };
const W_GRID: WinSpec = { style: 'grid', floor: 7, col: 6, w: 0.55, h: 0.5 };
const W_SLIT: WinSpec = { style: 'slit', floor: 9, col: 7, w: 0.25, h: 0.6, lit: 0.8 };

function pal(neon: RGB, neon2: RGB, up: RGB, warm = 0.4, cool = 0.4): ArtPal {
  return { neon, neon2, up, warm, cool };
}

export const SERVICE_PALS: Record<BuildingType, ArtPal> = {
  solar: pal(NEON.green, NEON.cyan, [40, 200, 120]),
  reactor: pal(NEON.violet, [170, 130, 255], [110, 80, 255], 0.3, 0.5),
  plaza: pal(NEON.green, NEON.magenta, [60, 220, 140]),
  precinct: pal(NEON.blue, NEON.red, [60, 110, 255], 0.2, 0.6),
  clinic: pal([80, 240, 220], NEON.red, [60, 200, 200], 0.2, 0.5),
  datahub: pal(NEON.cyan, NEON.blue, [40, 180, 255], 0.1, 0.7),
  maglev: pal(NEON.yellow, NEON.cyan, [220, 200, 60], 0.5, 0.3),
  spire: pal(NEON.magenta, NEON.cyan, [220, 40, 190], 0.3, 0.45),
  arcology: pal(NEON.amber, NEON.magenta, [230, 150, 50], 0.6, 0.2),
  // Story buildings: buildings.ts uses art/story.ts and art/vertical.ts for these types;
  // the entries stay so this table remains a complete Record<BuildingType, …>.
  stack: pal([170, 184, 255], NEON.cyan, [140, 150, 255], 0.5, 0.4),
  foundry: pal([255, 123, 46], NEON.amber, [255, 110, 40], 0.6, 0.2),
  glarewall: pal([255, 198, 241], NEON.magenta, [255, 170, 230], 0.2, 0.6),
  tidemarket: pal([182, 255, 46], NEON.green, [150, 230, 40], 0.5, 0.3),
  roost: pal([201, 162, 255], NEON.violet, [180, 140, 255], 0.3, 0.5),
  commons: pal([207, 227, 255], NEON.green, [180, 210, 255], 0.5, 0.3),
  memorial: pal([143, 227, 255], [255, 243, 196], [120, 210, 255], 0.6, 0.2),
  // Expansion placeholders (docs/EXPANSION.md §11 Step 0); WP-4 replaces them with real art.
  academy: pal([255, 208, 160], NEON.amber, [240, 190, 140], 0.5, 0.3),
  seaport: pal([56, 200, 255], NEON.amber, [40, 170, 230], 0.4, 0.4),
  airport: pal([233, 240, 255], NEON.cyan, [200, 215, 255], 0.3, 0.5),
  spaceport: pal([255, 143, 107], NEON.amber, [240, 120, 90], 0.4, 0.4),
};

/** Red warning light that blinks when the building is offline / unpowered. */
function warn(p: Painter, u: number, v: number, z: number) {
  const [x, y] = p.pt(u, v, z);
  p.addFx({ k: 'warn', x, y, ph: p.rng.next() });
  p.track(x - 9, y - 9);
}

/** Flat paved pad covering the footprint. */
function slab(p: Painter, s: number, m: Mat = PAD, z = 1.2) {
  p.box(0.04, 0.04, s - 0.04, s - 0.04, 0, z, m, { uplight: false });
}

// ── Solar farm ─────────────────────────────────────────────────────────────
const solar: Recipe = (p) => {
  slab(p, 2, mat([92, 96, 92]), 0.8);
  const rows = 5;
  const g = p.g;
  for (let i = 0; i < rows; i++) {
    const v0 = 0.16 + i * 0.34;
    const v1 = v0 + 0.22;
    const u0 = 0.14;
    const u1 = 1.86;
    // Legs.
    p.begin_();
    for (const u of [u0 + 0.1, (u0 + u1) / 2, u1 - 0.1]) {
      p.m(u, v0 + 0.02, 0.8);
      p.l(u, v0 + 0.02, 7);
      p.m(u, v1 - 0.02, 0.8);
      p.l(u, v1 - 0.02, 3);
    }
    p.stroke(p.col(STEEL, 0.6), 0.6);
    // Panel: slopes down towards +v, facing the viewer and the sky.
    p.begin_();
    p.quad(u0, v0, 7.5, u1, v0, 7.5, u1, v1, 2.5, u0, v1, 2.5);
    if (g) {
      const [xa, ya] = p.pt(u0, v0, 7.5);
      const [xb, yb] = p.pt(u1, v1, 2.5);
      const grad = g.createLinearGradient(xa, ya, xb, yb);
      const n = p.n;
      grad.addColorStop(0, css(mix([170, 200, 226], [40, 26, 70], n)));
      grad.addColorStop(0.45, css(mix([46, 72, 130], [14, 14, 40], n)));
      grad.addColorStop(0.7, css(mix([120, 150, 200], [70, 30, 90], n)));
      grad.addColorStop(1, css(mix([36, 54, 110], [10, 10, 30], n)));
      g.fillStyle = grad;
      g.fill();
      if (!p.lod) {
        // Cell grid.
        p.begin_();
        for (let c = 1; c < 10; c++) {
          const u = u0 + ((u1 - u0) * c) / 10;
          p.m(u, v0, 7.5);
          p.l(u, v1, 2.5);
        }
        p.m(u0, (v0 + v1) / 2, 5);
        p.l(u1, (v0 + v1) / 2, 5);
        p.stroke(css(mix([200, 220, 240], [60, 50, 100], n), 0.45), 0.4);
      }
      p.begin_();
      p.m(u0, v1, 2.5);
      p.l(u1, v1, 2.5);
      p.stroke(p.col(STEEL, 1.2), 0.6);
    }
  }
  // Inverter cabinet with a green status light.
  p.box(1.62, 1.72, 1.9, 1.94, 0.8, 7, mat([170, 176, 180]));
  p.lamp(1.76, 1.94, 5.5, NEON.green, 10);
  p.fence([0.04, 1.96, 1.96, 1.96, 1.96, 0.04]);
  warn(p, 1.76, 1.83, 9);
};

// ── Fusion reactor ─────────────────────────────────────────────────────────
const reactor: Recipe = (p) => {
  slab(p, 3, PAD, 2);
  const tower = mat([176, 174, 170]);
  // Coolant towers at the back.
  p.coolingTower(0.62, 1.3, 0.46, 62, tower);
  p.coolingTower(1.3, 0.62, 0.46, 58, tower);
  for (const [u, v, h] of [
    [0.62, 1.3, 62],
    [1.3, 0.62, 58],
  ]) {
    const [x, y] = p.pt(u, v, h);
    p.addFx({ k: 'smoke', x, y, r: 11, ph: p.rng.next() });
    p.track(x - 34, y - 66);
  }
  // Control block.
  p.box(2.2, 0.25, 2.85, 1.15, 2, 20, CONC, { win: W_GRID, top: ROOF, trim: p.pal.neon });
  p.antenna(2.6, 0.5, 20, 14);
  // Coolant pipes into the dome.
  p.pipe(0.95, 1.5, 8, 1.4, 1.75, 8, 2.6, STEEL);
  p.pipe(1.5, 0.95, 8, 1.75, 1.4, 8, 2.6, STEEL);
  // Containment torus + dome.
  const core = mat([150, 150, 172], [30, 26, 56]);
  p.ring(1.9, 1.9, 0.86, 6, mat([90, 92, 108]), 6);
  p.dome(1.9, 1.9, 0.78, 3, 40, core);
  if (p.g && !p.lod) {
    // Panel seams on the dome.
    const [cx, cy] = p.pt(1.9, 1.9, 3);
    const g = p.g;
    const rx = 0.78 * 32 * Math.SQRT2;
    g.strokeStyle = p.col(core, 0.6, 0.6);
    g.lineWidth = 0.5;
    for (const k of [0.35, 0.7]) {
      g.beginPath();
      g.ellipse(cx, cy - 40 * k * 0.95, rx * Math.sqrt(1 - k * k * 0.85), rx * 0.5 * Math.sqrt(1 - k * k), 0, 0, Math.PI);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.35, 40, 0, Math.PI, Math.PI * 1.5);
    g.stroke();
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.35, 40, 0, Math.PI * 1.5, Math.PI * 2);
    g.stroke();
  }
  // Glowing confinement ring.
  p.neonRing(1.9, 1.9, 0.9, 10, [150, 120, 255], 1.4);
  p.glow(1.9, 1.9, 14, p.pal.neon, 120, p.glowA() * 0.5);
  const [x, y] = p.pt(1.9, 1.9, 30);
  p.addFx({ k: 'pulse', x, y, size: 90, c: NEON.violet, period: 2.2, ph: 0 });
  p.addFx({ k: 'pulse', x, y: y + 10, size: 46, c: [200, 170, 255], period: 1.1, ph: 0.3 });
  p.track(x - 45, y - 45);
  p.blinker(0.62, 1.3, 64, NEON.red, 1.6, 14);
  p.blinker(1.3, 0.62, 60, NEON.red, 1.9, 14);
  p.fence([0.04, 2.96, 2.96, 2.96, 2.96, 0.04]);
  warn(p, 2.5, 1.15, 16);
};

// ── Neon plaza ─────────────────────────────────────────────────────────────
const plaza: Recipe = (p) => {
  const pave = mat([138, 136, 148]);
  slab(p, 1, pave, 1);
  if (p.g && !p.lod) {
    // Paving grid.
    p.begin_();
    for (let i = 1; i < 6; i++) {
      const t = 0.04 + (0.92 * i) / 6;
      p.m(t, 0.04, 1);
      p.l(t, 0.96, 1);
      p.m(0.04, t, 1);
      p.l(0.96, t, 1);
    }
    p.stroke(p.col(pave, 0.8, 0.7), 0.4);
  }
  // Corner planters.
  for (const [u, v] of [
    [0.08, 0.08],
    [0.74, 0.08],
    [0.08, 0.74],
    [0.74, 0.74],
  ]) {
    p.box(u, v, u + 0.18, v + 0.18, 1, 3.4, CONC, { uplight: false });
    p.greens(u + 0.03, v + 0.03, u + 0.15, v + 0.15, 3.4, 3);
  }
  p.bench(0.42, 0.14, 'u');
  p.bench(0.14, 0.42, 'v');
  p.bench(0.82, 0.42, 'v');
  p.bench(0.42, 0.82, 'u');
  // Projector plinth.
  p.cyl(0.5, 0.5, 0.11, 1, 4, CONC, ROOF_DARK);
  p.neonRing(0.5, 0.5, 0.11, 4, p.pal.neon, 1, true);
  // Static holo silhouette (what low quality shows).
  if (p.g && p.glowA() > 0.05) {
    const [x, y] = p.pt(0.5, 0.5, 4);
    const g = p.g;
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = css(p.pal.neon, 0.35 * p.glowA());
    g.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      const a = i / 5;
      const r = (1 - a) * 11 + 2;
      g.beginPath();
      g.ellipse(x, y - 6 - a * 30, r, r / 2, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
  const [x, y] = p.pt(0.5, 0.5, 4);
  p.addFx({ k: 'holo', x, y, h: 40, ph: p.rng.next() });
  p.track(x - 26, y - 44);
  p.reach(40);
  for (const [u, v] of [
    [0.3, 0.06],
    [0.06, 0.3],
    [0.94, 0.7],
    [0.7, 0.94],
  ]) {
    p.begin_();
    p.m(u, v, 1);
    p.l(u, v, 10);
    p.stroke(p.col(STEEL, 0.6), 0.6);
    p.lamp(u, v, 10, [255, 214, 160], 14);
  }
  warn(p, 0.5, 0.5, 10);
};

// ── Enforcer precinct ──────────────────────────────────────────────────────
const precinct: Recipe = (p) => {
  slab(p, 2, PAD, 1);
  const armor = mat([88, 96, 116]);
  const armor2 = mat([70, 78, 96]);
  // Sloped armoured plinth.
  p.box(0.12, 0.12, 1.88, 1.88, 1, 6, armor2, { top: armor2 });
  p.box(0.2, 0.2, 1.8, 1.8, 6, 30, armor, { win: W_SLIT, top: ROOF_DARK, trim: p.pal.neon });
  // Blue band.
  p.neon([0.2, 1.8, 14, 1.8, 1.8, 14, 1.8, 0.2, 14], p.pal.neon, 1.1);
  // Command block + comms mast.
  p.box(0.3, 0.3, 1.0, 1.1, 30, 42, armor2, { win: W_SLIT, top: ROOF_DARK });
  p.antenna(0.5, 0.5, 42, 24, NEON.red);
  p.dish(0.85, 0.5, 42, 0.07);
  // Drone pad + patrol drone.
  p.padMark(1.4, 1.4, 0.3, 30, p.pal.neon);
  const [dx, dy] = p.pt(1.4, 1.4, 40);
  p.addFx({ k: 'drone', x: dx, y: dy, r: 12, ph: p.rng.next() });
  p.track(dx - 16, dy - 12);
  // Emblem: invented shield glyph sign.
  p.wallSign(0.2, 1.8, 1.8, 1.8, 0.35, 0.65, 18, 27, p.pal.neon);
  // Gate.
  p.door(1.8, 0.2, 1.8, 1.8, 0.35, 0.65, 1, 9, p.pal.neon);
  // Strobe bar on the front corner of the roof.
  p.box(1.55, 1.68, 1.75, 1.78, 30, 32, mat([40, 40, 52]), { uplight: false });
  const [sx, sy] = p.pt(1.65, 1.73, 33);
  p.addFx({ k: 'strobe', x: sx, y: sy, w: 3, ph: p.rng.next() });
  p.track(sx - 20, sy - 20);
  p.track(sx + 20, sy + 20);
  warn(p, 1.65, 1.0, 34);
};

// ── Med clinic ─────────────────────────────────────────────────────────────
const clinic: Recipe = (p) => {
  slab(p, 2, mat([150, 156, 160]), 1);
  const white = mat([206, 212, 216], [42, 46, 62]);
  const teal = mat([70, 170, 170], [14, 46, 52]);
  const tealGlass: Mat = { day: [96, 170, 180], night: [10, 30, 40] };
  p.chamfer(0.18, 0.18, 1.82, 1.82, 0.3, 1, 26, white, { win: { style: 'band', floor: 8, col: 7, w: 1, h: 0.45 }, glass: tealGlass, top: mat([180, 186, 190]), trim: p.pal.neon });
  p.chamfer(0.3, 0.3, 1.25, 1.55, 0.2, 26, 40, white, { win: { style: 'band', floor: 7, col: 7, w: 1, h: 0.5 }, glass: tealGlass, top: mat([180, 186, 190]) });
  // Teal stripe.
  p.neon([0.18, 1.52, 9, 0.48, 1.82, 9, 1.52, 1.82, 9, 1.82, 1.52, 9, 1.82, 0.48, 9], p.pal.neon, 1);
  // Entrance canopy.
  p.box(0.6, 1.82, 1.3, 2.0, 7, 8, teal, { uplight: false });
  p.glow(0.95, 1.9, 4, p.pal.neon, 40, p.glowA() * 0.7);
  p.door(0.48, 1.82, 1.52, 1.82, 0.25, 0.75, 1, 7, [180, 255, 240]);
  // Heartbeat sign on the upper block's left face.
  p.begin_();
  p.quad(0.42, 1.55, 29, 1.1, 1.55, 29, 1.1, 1.55, 37, 0.42, 1.55, 37);
  p.fill(p.col(mat([20, 24, 34], [6, 8, 14]), 0.8));
  const [ox, oy] = p.pt(0.42, 1.55, 29);
  const [x1, y1] = p.pt(1.1, 1.55, 29);
  p.addFx({ k: 'ecg', ox, oy, ex: x1 - ox, ey: y1 - oy, h: 8, c1: [90, 255, 220], ph: 0 });
  p.neon([0.42, 1.55, 29, 1.1, 1.55, 29, 1.1, 1.55, 37, 0.42, 1.55, 37, 0.42, 1.55, 29], p.pal.neon, 0.5);
  // Static trace (low quality / day).
  p.neon([0.46, 1.55, 33, 0.6, 1.55, 33, 0.64, 1.55, 36, 0.68, 1.55, 30, 0.72, 1.55, 33, 1.06, 1.55, 33], [90, 255, 220], 0.6);
  // Medevac pad on the lower roof.
  p.padMark(1.48, 0.62, 0.26, 26, [90, 255, 220]);
  p.blinker(1.48, 0.36, 27, [90, 255, 220], 1.2, 12);
  p.ac(0.5, 0.5, 40);
  warn(p, 1.0, 1.0, 44);
};

// ── Data hub ───────────────────────────────────────────────────────────────
const datahub: Recipe = (p) => {
  slab(p, 1, PAD, 1);
  const rack = mat([60, 66, 84]);
  const b = [0.14, 0.14, 0.86, 0.86] as const;
  p.box(b[0], b[1], b[2], b[3], 1, 14, rack, { top: ROOF_DARK, trim: p.pal.neon });
  // Server LED rows.
  if (p.g) {
    const on = p.lights && !p.abandoned;
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 10; i++) {
        const z = 4 + r * 3.2;
        const t = 0.08 + i * 0.088;
        const [x, y] = p.pt(b[0] + (b[2] - b[0]) * t, b[3], z);
        const [x2, y2] = p.pt(b[2], b[1] + (b[3] - b[1]) * t, z);
        p.g.fillStyle = on ? css(mix([40, 120, 140], (i + r) % 3 ? NEON.cyan : NEON.green, 0.4 + 0.6 * p.n)) : css(mix([40, 50, 60], [10, 12, 20], p.n));
        p.g.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
        p.g.fillRect(x2 - 0.6, y2 - 0.6, 1.2, 1.2);
      }
  }
  // Lattice mast.
  const top = 104;
  const base = 14;
  const legs = [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.72, 0.72],
    [0.28, 0.72],
  ];
  const at = (i: number, z: number): [number, number] => {
    const k = (z - base) / (top - base);
    const r = 0.22 * (1 - k) + 0.04 * k;
    const lu = legs[i][0] < 0.5 ? -1 : 1;
    const lv = legs[i][1] < 0.5 ? -1 : 1;
    return [0.5 + lu * r, 0.5 + lv * r];
  };
  // Cross bracing (thin), then the four legs (thicker) on top.
  p.begin_();
  for (let z = base; z < top - 6; z += 10) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const [ua, va] = at(i, z);
      const [ub, vb] = at(j, z + 10);
      const [uc, vc] = at(j, z);
      p.m(ua, va, z);
      p.l(ub, vb, z + 10);
      p.m(ua, va, z);
      p.l(uc, vc, z);
    }
  }
  p.stroke(p.col(STEEL, 0.75), 0.4);
  p.begin_();
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = at(i, base);
    const [u1, v1] = at(i, top);
    p.m(u0, v0, base);
    p.l(u1, v1, top);
  }
  p.stroke(p.col(STEEL, 0.95), 0.9);
  p.dish(0.62, 0.5, 52, 0.08);
  p.dish(0.4, 0.58, 72, 0.06);
  p.lamp(0.5, 0.5, 60, p.pal.neon, 10);
  p.lamp(0.5, 0.5, 84, p.pal.neon, 10);
  p.blinker(0.5, 0.5, top + 2, NEON.red, 1.3, 16);
  const [x, y] = p.pt(0.5, 0.5, top + 4);
  p.addFx({ k: 'beam', x, y, h: 150, c: p.pal.neon, ph: p.rng.next() });
  p.track(x - 4, y - 150);
  warn(p, 0.86, 0.5, 16);
};

// ── Maglev station ─────────────────────────────────────────────────────────
const maglev: Recipe = (p) => {
  slab(p, 2, PAD, 1);
  const beam = mat([150, 152, 164]);
  const deckM = mat([128, 130, 142]);
  // Pillars.
  for (const u of [0.25, 1.0, 1.75]) {
    p.box(u - 0.05, 0.3, u + 0.05, 0.4, 1, 14, CONC, { uplight: false });
    p.box(u - 0.05, 1.3, u + 0.05, 1.4, 1, 16, CONC, { uplight: false });
  }
  // Station hall underneath (stairs + lift).
  p.box(1.25, 1.45, 1.85, 1.9, 1, 15, mat([90, 96, 112]), { win: W_GRID, top: ROOF, trim: p.pal.neon });
  p.door(1.25, 1.9, 1.85, 1.9, 0.2, 0.6, 1, 7, p.pal.neon);
  // Guideway (overhangs the footprint along u).
  p.box(-0.1, 0.24, 2.1, 0.46, 14, 17, beam, { uplight: false });
  p.neon([-0.1, 0.29, 17.2, 2.1, 0.29, 17.2], p.pal.neon2, 0.7);
  p.neon([-0.1, 0.41, 17.2, 2.1, 0.41, 17.2], p.pal.neon2, 0.7);
  const [ax, ay] = p.pt(-0.1, 0.35, 17.4);
  const [bx, by] = p.pt(2.1, 0.35, 17.4);
  p.addFx({ k: 'rails', x0: ax, y0: ay, x1: bx, y1: by, c: p.pal.neon2, ph: p.rng.next() });
  // Parked pod.
  const pod = mat([214, 216, 224], [40, 42, 60]);
  p.box(0.2, 0.26, 1.5, 0.44, 18, 25, pod, { win: { style: 'band', floor: 7, col: 5, w: 1, h: 0.4, margin: 1.5, lit: 1.5 }, top: mat([200, 202, 210]) });
  p.neon([0.2, 0.44, 19, 1.5, 0.44, 19], p.pal.neon, 0.8);
  // Platform deck + canopy.
  p.box(0.15, 0.5, 1.85, 1.3, 16, 18, deckM, { top: mat([150, 150, 160]) });
  p.neon([0.15, 0.5, 18.2, 1.85, 0.5, 18.2], p.pal.neon, 0.8);
  for (const u of [0.3, 1.0, 1.7]) {
    p.begin_();
    p.m(u, 1.2, 18);
    p.l(u, 1.2, 28);
    p.stroke(p.col(STEEL, 0.7), 0.8);
  }
  // Lit platform floor under the canopy.
  p.glow(0.6, 0.9, 19, [255, 230, 170], 40, p.glowA() * 0.55);
  p.glow(1.4, 0.9, 19, [255, 230, 170], 40, p.glowA() * 0.55);
  p.shed(0.1, 0.5, 1.9, 1.34, 28, 3, mat([120, 160, 180], [26, 44, 70]), 'v');
  p.neon([0.1, 1.34, 28, 1.9, 1.34, 28, 1.9, 0.5, 31], p.pal.neon, 0.7);
  p.blade(1.85, 0.9, 'u', 0.1, 16, 30, p.pal.neon);
  p.lamp(0.6, 1.3, 27, [255, 230, 170], 18);
  p.lamp(1.4, 1.3, 27, [255, 230, 170], 18);
  warn(p, 1.0, 0.9, 34);
};

// ── Corp spire ─────────────────────────────────────────────────────────────
const spire: Recipe = (p) => {
  slab(p, 2, mat([84, 84, 100]), 1);
  const skin = mat([70, 76, 100]);
  const glass: Mat = { day: [70, 90, 130], night: [10, 10, 26] };
  const win: WinSpec = { ...W_CURT, floor: 6, col: 6 };
  p.chamfer(0.1, 0.1, 1.9, 1.9, 0.4, 1, 22, skin, { win: W_GRID, top: ROOF_DARK, trim: p.pal.neon2 });
  const tiers: [number, number, number, number][] = [
    [0.3, 0.42, 22, 122],
    [0.42, 0.36, 122, 184],
    [0.54, 0.3, 184, 226],
  ];
  for (const [i, c, z0, z1] of tiers) {
    p.chamfer(i, i, 2 - i, 2 - i, c, z0, z1, skin, { win, glass, top: ROOF_DARK, trim: p.pal.neon });
    // Vertical light lines on the front edges.
    p.neon([2 - i, 2 - i - c, z0 + 2, 2 - i, 2 - i - c, z1 - 2], p.pal.neon, 0.9);
    p.neon([2 - i - c, 2 - i, z0 + 2, 2 - i - c, 2 - i, z1 - 2], p.pal.neon, 0.9);
  }
  // Corporate emblem on the front facet.
  p.board(1.7, 1.42 - 0.12, 1.42 - 0.12, 1.7, 0.1, 0.9, 136, 172, 3, p.pal.neon, p.pal.neon2);
  // Crown.
  p.chamfer(0.66, 0.66, 1.34, 1.34, 0.24, 226, 238, mat([50, 50, 66]), { top: ROOF_DARK, trim: p.pal.neon2 });
  p.glow(1, 1, 240, p.pal.neon, 60, p.glowA() * 0.7);
  p.cyl(1, 1, 0.05, 238, 286, STEEL, STEEL, 0.01);
  p.blinker(1, 1, 287, NEON.red, 1.2, 22);
  p.blinker(1.3, 0.72, 239, NEON.red, 1.7, 12);
  const [x, y] = p.pt(1, 1, 232);
  p.addFx({ k: 'ring', x, y, rx: 26, ry: 13, c: p.pal.neon, ph: 0 });
  p.addFx({ k: 'pulse', x, y: y - 8, size: 70, c: p.pal.neon, period: 3, ph: 0 });
  p.track(x - 35, y - 35);
  p.door(0.5, 1.9, 1.5, 1.9, 0.3, 0.7, 1, 10, p.pal.neon2);
  warn(p, 1.0, 1.0, 26);
};

// ── Arcology ───────────────────────────────────────────────────────────────
const arcology: Recipe = (p) => {
  slab(p, 3, mat([92, 90, 100]), 1);
  const skin = mat([128, 118, 112]);
  const win: WinSpec = { style: 'grid', floor: 6, col: 5, w: 0.6, h: 0.5, lit: 1.25 };
  const tiers = 5;
  let z = 1;
  for (let i = 0; i < tiers; i++) {
    const inset = 0.1 + i * 0.27;
    const h = 30;
    const trim = i % 2 ? p.pal.neon2 : p.pal.neon;
    p.box(inset, inset, 3 - inset, 3 - inset, z, z + h, i % 2 ? skin : mat([112, 106, 108]), { win, top: mat([96, 120, 96], [16, 34, 30]), trim });
    // Terrace gardens on the exposed ring.
    if (i < tiers - 1) {
      const ni = inset + 0.27;
      p.greens(3 - ni, inset + 0.05, 3 - inset - 0.04, 3 - inset - 0.05, z + h, 4);
      p.greens(inset + 0.05, 3 - ni, 3 - ni, 3 - inset - 0.04, z + h, 4);
    }
    // Corner light strips.
    p.neon([3 - inset, 3 - inset, z + 2, 3 - inset, 3 - inset, z + h - 2], trim, 0.9);
    z += h;
  }
  // Grand atrium sign + entrance.
  p.wallSign(0.1, 2.9, 2.9, 2.9, 0.38, 0.62, 10, 24, p.pal.neon2, true);
  p.door(0.1, 2.9, 2.9, 2.9, 0.42, 0.58, 1, 8, p.pal.neon);
  // Crown spire.
  p.box(1.3, 1.3, 1.7, 1.7, z, z + 18, mat([70, 66, 76]), { win: W_CURT, glass: GLASS, top: ROOF_DARK, trim: p.pal.neon });
  p.cyl(1.5, 1.5, 0.05, z + 18, z + 52, STEEL, STEEL, 0.01);
  p.blinker(1.5, 1.5, z + 53, NEON.red, 1.4, 22);
  for (const [u, v] of [
    [0.1, 0.1],
    [2.9, 0.1],
    [0.1, 2.9],
    [2.9, 2.9],
  ])
    p.blinker(u, v, 31, NEON.red, 1.6 + p.rng.next(), 12);
  const [x, y] = p.pt(1.5, 1.5, z + 9);
  p.addFx({ k: 'ring', x, y, rx: 30, ry: 15, c: p.pal.neon, ph: 0 });
  p.track(x - 32, y - 16);
  warn(p, 1.5, 1.5, z + 22);
};

export const SERVICE_RECIPES: Record<BuildingType, Recipe> = {
  solar,
  reactor,
  plaza,
  precinct,
  clinic,
  datahub,
  maglev,
  spire,
  arcology,
  // Story buildings are drawn from art/story.ts / art/vertical.ts (see buildings.ts); fallbacks only.
  stack: arcology,
  foundry: reactor,
  glarewall: datahub,
  tidemarket: clinic,
  roost: datahub,
  commons: clinic,
  memorial: plaza,
  // Expansion placeholders (Step 0): existing recipes until WP-4 paints the real ones.
  academy: clinic,
  seaport: precinct,
  airport: arcology,
  spaceport: reactor,
};

