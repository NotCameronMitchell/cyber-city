// ─────────────────────────────────────────────────────────────────────────────
// Expansion buildings (docs/EXPANSION.md §5, §6.1): the Academy, the Seaport,
// the Airport and the Spaceport, plus their live parts and the port FX (ships,
// planes, launches) that Effects drives.
//
//   academy    2×2 campus: an L of lecture halls around a courtyard, an
//              observatory tower and a drone lab on the roof
//   seaport    4×4, one model per facing: two gantry cranes on the water edge
//              with booms over the berth, container rows, a reefer shed and
//              two light masts (the quay apron is ground art)
//   airport    6×6: only the raised parts (a curved glass terminal, jet
//              bridges, two parked planes, the control tower); the runway,
//              taxiways and apron are ground art
//   spaceport  6×6: three construction stages (foundation and crane; half
//              tower in scaffolding; full tower in scaffolding), complete
//              (launch tower, gantry arm, rocket on the pad, fuel spheres,
//              control bunker) and complete with an empty pad (during and
//              just after a launch); the blast pad is ground art
//
// Live parts that need the building's depth slot (crane trolleys, a ship
// moored in front of its quay, the tower beacon, pad steam and searchlights)
// are drawn by drawPortLive right after the sprite (buildings.ts). Everything
// that moves is driven by PortFx (effects.ts owns one): ships and planes run on
// the visual clock (dt × game.clockRate, frozen while paused); a launch is a
// 14 s cut-scene in unpaused real seconds that starts only on 'liftoff'.
// ─────────────────────────────────────────────────────────────────────────────

import { AIRPORT, BUILDINGS, SEAPORT, SPACEPORT } from '../../game/config';
import { hash2 } from '../../game/rng';
import { MAP_SIZE, Terrain, type Building, type BuildingType } from '../../game/types';
import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import { NEON, css, glowSprite, mix, shade, type RGB } from '../palette';
import { K_LEFT, K_RIGHT, K_TOP, mat, type ArtPal, type Mat, type Painter, type WinSpec } from './painter';
import type { Recipe } from './zones';

const N = MAP_SIZE;

// ── Palettes and materials ────────────────────────────────────────────────

function pal(neon: RGB, neon2: RGB, up: RGB, warm = 0.4, cool = 0.4): ArtPal {
  return { neon, neon2, up, warm, cool };
}

/** Palettes of the four expansion buildings (buildings.ts prefers these over SERVICE_PALS). */
export const PORT_PALS: Partial<Record<BuildingType, ArtPal>> = {
  academy: pal([255, 208, 160], NEON.amber, [240, 180, 120], 0.7, 0.15),
  seaport: pal([56, 200, 255], NEON.amber, [40, 160, 220], 0.45, 0.35),
  airport: pal([233, 240, 255], NEON.cyan, [190, 210, 255], 0.35, 0.5),
  spaceport: pal([255, 143, 107], NEON.amber, [240, 120, 90], 0.4, 0.4),
};

const CONC = mat([124, 126, 140]);
const PAD = mat([96, 98, 110]);
const ROOF = mat([104, 100, 112]);
const ROOF_DARK = mat([76, 74, 88]);
const STEEL = mat([140, 144, 152]);
const WHITE = mat([214, 218, 226], [40, 44, 62]);
const BRICK = mat([156, 112, 96]);
const STONE = mat([186, 176, 160]);
const SLATE = mat([92, 96, 116]);
const CRANE = mat([58, 128, 156]);
const CRANE_DARK = mat([40, 92, 116]);
const REEFER = mat([196, 204, 214]);
const TERMINAL = mat([180, 188, 202]);
const T_GLASS: Mat = { day: [96, 150, 184], night: [14, 22, 44] };
const JET = mat([226, 230, 238], [48, 52, 70]);
const JET_DARK = mat([150, 156, 170]);
const TOWER_SHAFT = mat([188, 192, 204]);
const LATTICE = mat([214, 96, 58], [120, 46, 36]);
const LATTICE_CORE = mat([86, 88, 102], [24, 24, 38]);
/** Floodlit at night, so it stays pale. */
const ROCKET = mat([236, 238, 244], [150, 152, 176]);
const ROCKET_BAND = mat([40, 42, 52], [8, 8, 14]);
const SPHERE = mat([226, 228, 232], [52, 54, 70]);
const BUNKER = mat([118, 120, 128]);
const SCAFFOLD = mat([214, 170, 70], [70, 54, 26]);
const CONTAINERS: RGB[] = [
  [150, 70, 58],
  [56, 110, 116],
  [62, 82, 136],
  [166, 128, 60],
  [96, 120, 70],
  [176, 176, 184],
];

const W_HALL: WinSpec = { style: 'grid', floor: 9, col: 7, w: 0.5, h: 0.62, margin: 2, lit: 1.3 };
const W_SLIT: WinSpec = { style: 'slit', floor: 9, col: 7, w: 0.25, h: 0.6, lit: 0.8 };
const W_BAND: WinSpec = { style: 'band', floor: 7, col: 6, w: 1, h: 0.45, margin: 1.5, lit: 1.2 };

/** Red warning light that blinks when the building is offline / unpowered. */
function warn(p: Painter, u: number, v: number, z: number) {
  const [x, y] = p.pt(u, v, z);
  p.addFx({ k: 'warn', x, y, ph: p.rng.next() });
  p.track(x - 9, y - 9);
}

/** Pole from the ground with a floodlight head (glows at night). */
function lightMast(p: Painter, u: number, v: number, h: number, c: RGB) {
  p.begin_();
  p.m(u, v, 0);
  p.l(u, v, h);
  p.stroke(p.col(STEEL, 0.7), p.lod ? 1 : 0.8);
  p.box(u - 0.05, v - 0.03, u + 0.05, v + 0.03, h, h + 2.2, ROOF_DARK, { uplight: false });
  p.lamp(u, v + 0.03, h, c, 18);
}

/** Scaffold cage around a box volume (construction stages). */
function scaffold(p: Painter, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number) {
  if (p.lod) return;
  p.begin_();
  for (const [u, v] of [
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ] as const) {
    p.m(u, v, z0);
    p.l(u, v, z1);
  }
  for (let z = z0 + 8; z <= z1; z += 10) {
    p.m(u0, v1, z);
    p.l(u1, v1, z);
    p.l(u1, v0, z);
  }
  for (let z = z0; z + 10 <= z1; z += 20) {
    p.m(u0, v1, z);
    p.l((u0 + u1) / 2, v1, z + 10);
    p.l(u1, v1, z);
    p.m(u1, v0, z);
    p.l(u1, (v0 + v1) / 2, z + 10);
    p.l(u1, v1, z);
  }
  p.stroke(p.col(SCAFFOLD, 0.9, 0.9), 0.5);
}

/** Tower crane (construction stages). */
function towerCrane(p: Painter, u: number, v: number, h: number) {
  const y = mat([226, 186, 60], [70, 56, 22]);
  p.box(u - 0.06, v - 0.06, u + 0.06, v + 0.06, 0, h, y, { uplight: false });
  p.box(u - 0.6, v - 0.04, u + 1.5, v + 0.04, h, h + 3, y, { uplight: false });
  p.box(u - 0.55, v - 0.1, u - 0.25, v + 0.1, h - 4, h, CONC, { uplight: false });
  p.box(u - 0.08, v - 0.1, u + 0.12, v + 0.1, h - 6, h, mat([70, 74, 90]), { win: W_BAND, uplight: false });
  p.begin_();
  p.m(u + 1.1, v, h);
  p.l(u + 1.1, v, h - 30);
  p.stroke(p.col(STEEL, 0.6), 0.4);
  p.blinker(u + 1.5, v, h + 3, NEON.red, 1.3, 14);
}

// ════════════════════════════════════════════════════════════════════════════
// ACADEMY (2×2)
// ════════════════════════════════════════════════════════════════════════════

const academy: Recipe = (p) => {
  const h = 24;
  // Observatory tower at the back corner of the L.
  p.box(0.12, 0.12, 0.66, 0.66, 0, 40, STONE, { win: W_HALL, top: SLATE });
  p.dome(0.39, 0.39, 0.24, 40, 13, mat([170, 186, 200], [30, 40, 60]));
  if (p.g && !p.lod) {
    // Telescope slit in the dome.
    p.begin_();
    p.m(0.42, 0.5, 42);
    p.l(0.42, 0.5, 52);
    p.stroke(css(p.emissive(p.pal.neon, 0.3)), 1.4);
  }
  // Lecture hall wing along the back right (u), and the library wing along the back left (v).
  p.box(0.66, 0.12, 1.88, 0.7, 0, h, BRICK, { win: W_HALL, top: SLATE, trim: p.pal.neon });
  p.box(0.12, 0.66, 0.7, 1.88, 0, h - 4, BRICK, { win: W_HALL, top: SLATE, trim: p.pal.neon });
  // Stone cornices.
  p.box(0.64, 0.7, 1.88, 0.74, h - 3, h - 1, STONE, { uplight: false });
  p.box(0.7, 0.66, 0.74, 1.88, h - 7, h - 5, STONE, { uplight: false });
  // Drone lab: a glass box with a pad on the lecture hall roof.
  p.box(1.1, 0.2, 1.5, 0.6, h, h + 8, SLATE, { win: { style: 'curtain', floor: 8, col: 6, w: 1, h: 0.8, margin: 1 }, glass: { day: [110, 160, 190], night: [18, 30, 52] }, top: ROOF_DARK, trim: p.pal.neon2 });
  p.padMark(1.68, 0.42, 0.14, h + 0.2, p.pal.neon2);
  const [dx, dy] = p.pt(1.68, 0.42, h + 12);
  p.addFx({ k: 'drone', x: dx, y: dy, r: 9, ph: p.rng.next() });
  p.track(dx - 13, dy - 10);
  p.antenna(0.9, 0.3, h, 12);
  // Entrance with a warm lit sign on the lecture hall's courtyard face.
  p.door(0.66, 0.7, 1.88, 0.7, 0.42, 0.62, 0, 8, p.pal.neon);
  p.wallSign(0.66, 0.7, 1.88, 0.7, 0.36, 0.68, 11, 16, p.pal.neon, true);
  // Courtyard: two trees, benches and lamps (the paving is ground art).
  p.greens(1.15, 1.15, 1.45, 1.45, 0, 5);
  p.greens(1.5, 1.55, 1.75, 1.8, 0, 4);
  p.bench(1.05, 1.62, 'u');
  p.bench(1.62, 1.0, 'v');
  for (const [u, v] of [
    [0.95, 0.95],
    [1.85, 1.3],
    [1.3, 1.85],
  ] as const) {
    p.begin_();
    p.m(u, v, 0);
    p.l(u, v, 8);
    p.stroke(p.col(STEEL, 0.6), 0.6);
    p.lamp(u, v, 8, [255, 214, 160], 14);
  }
  warn(p, 1.2, 0.4, h + 10);
};

// ════════════════════════════════════════════════════════════════════════════
// SEAPORT (4×4), one model per facing
// ════════════════════════════════════════════════════════════════════════════

/** Crane positions along the quay and their boom reach over the water (local "along" units). */
export const CRANE_AT = [1.05, 2.85] as const;
/** Boom height (px) and its reach over the water (tiles beyond the quay edge). */
export const BOOM_Z = 44;
export const BOOM_OUT = 1.15;
/** Trolley travel on the boom: from over the moored ship (−0.55) back over the quay (0.55), in "inland" units. */
export const TROLLEY_D0 = -0.62;
export const TROLLEY_D1 = 0.55;

/** Local quay coords (a along the water side 0..4, d inland from the water edge; d < 0 is over the water) → footprint (u, v). */
export function quayUV(face: number, a: number, d: number, size = 4): [number, number] {
  switch (face) {
    case 0:
      return [a, d];
    case 1:
      return [size - d, a];
    case 3:
      return [d, a];
    default:
      return [a, size - d];
  }
}

function seaport(face: number): Recipe {
  return (p) => {
    const L = (a: number, d: number) => quayUV(face, a, d);
    /** Box in local (a, d) ranges. */
    const B = (a0: number, d0: number, a1: number, d1: number): [number, number, number, number] => {
      const [ua, va] = L(a0, d0);
      const [ub, vb] = L(a1, d1);
      return [Math.min(ua, ub), Math.min(va, vb), Math.max(ua, ub), Math.max(va, vb)];
    };
    // Parts are drawn back to front: sort by the screen depth (u + v) of their centre.
    const parts: { key: number; draw: () => void }[] = [];
    const add = (a: number, d: number, draw: () => void) => {
      const [u, v] = L(a, d);
      parts.push({ key: u + v, draw });
    };
    // Container rows behind the cranes, stacked 1-3 high (colours fixed per model).
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 4; k++) {
        const a0 = 0.25 + k * 0.9;
        const d0 = 1.65 + row * 0.62;
        const stack = 1 + Math.floor(hash2(row * 7 + k, face, 41) * 3);
        add(a0 + 0.38, d0 + 0.2, () => {
          for (let s = 0; s < stack; s++) {
            const c = CONTAINERS[Math.floor(hash2(row * 13 + k * 3 + s, face, 17) * CONTAINERS.length)];
            const [u0, v0, u1, v1] = B(a0, d0, a0 + 0.78, d0 + 0.4);
            p.container(u0, v0, u1, v1, s * 7, 7, c);
          }
        });
      }
    }
    // Reefer shed in the back corner, with plug-in lights.
    add(1.0, 3.62, () => {
      const [u0, v0, u1, v1] = B(0.2, 3.38, 1.9, 3.88);
      p.box(u0, v0, u1, v1, 0, 11, REEFER, { win: W_BAND, top: ROOF, trim: p.pal.neon });
      p.ribs(u0, v1, u1, v1, 0, 11, 14, REEFER);
    });
    // Gate house in the other back corner.
    add(3.3, 3.6, () => {
      const [u0, v0, u1, v1] = B(2.9, 3.35, 3.75, 3.85);
      p.box(u0, v0, u1, v1, 0, 9, CONC, { win: W_SLIT, top: ROOF_DARK, trim: p.pal.neon2 });
    });
    // Two light masts on the quay ends.
    for (const a of [0.18, 3.82]) {
      add(a, 1.32, () => {
        const [u, v] = L(a, 1.32);
        lightMast(p, u, v, 58, [255, 226, 170]);
      });
    }
    // Gantry cranes: two portal frames on the quay rails, a boom over the berth, a cab.
    for (const a of CRANE_AT) {
      add(a, 0.5, () => {
        const legs: [number, number][] = [
          [a - 0.32, 0.12],
          [a + 0.32, 0.12],
          [a - 0.32, 0.92],
          [a + 0.32, 0.92],
        ];
        // Back legs first.
        legs.sort((x, y) => {
          const [ux, vx] = L(x[0], x[1]);
          const [uy, vy] = L(y[0], y[1]);
          return ux + vx - (uy + vy);
        });
        for (const [la, ld] of legs) {
          const [u0, v0, u1, v1] = B(la - 0.04, ld - 0.04, la + 0.04, ld + 0.04);
          p.box(u0, v0, u1, v1, 0, BOOM_Z - 6, CRANE, { uplight: false });
        }
        // Portal cross beams.
        const [c0, c1, c2, c3] = B(a - 0.34, 0.08, a + 0.34, 0.96);
        p.box(c0, c1, c2, c3, BOOM_Z - 8, BOOM_Z - 5, CRANE_DARK, { uplight: false });
        // Boom over the water and the back girder.
        const [b0, b1, b2, b3] = B(a - 0.06, -BOOM_OUT, a + 0.06, 1.45);
        p.box(b0, b1, b2, b3, BOOM_Z, BOOM_Z + 3.2, CRANE, { uplight: false });
        // Counterweight and machinery house over the back legs.
        const [m0, m1, m2, m3] = B(a - 0.16, 1.0, a + 0.16, 1.42);
        p.box(m0, m1, m2, m3, BOOM_Z + 3.2, BOOM_Z + 9, CRANE_DARK, { uplight: false, top: ROOF_DARK });
        // Operator cab under the boom.
        const [k0, k1, k2, k3] = B(a - 0.1, 0.0, a + 0.1, 0.22);
        p.box(k0, k1, k2, k3, BOOM_Z - 5, BOOM_Z, mat([200, 206, 214]), { win: W_BAND, uplight: false });
        // A lit strip under the boom and a red beacon on its tip.
        const [s0u, s0v] = L(a, -BOOM_OUT + 0.05);
        const [s1u, s1v] = L(a, 1.4);
        p.neon([s0u, s0v, BOOM_Z - 0.2, s1u, s1v, BOOM_Z - 0.2], p.pal.neon, 0.5);
        p.blinker(s0u, s0v, BOOM_Z + 3.4, NEON.red, 1.5, 14);
      });
    }
    parts.sort((x, y) => x.key - y.key);
    for (const part of parts) part.draw();
    const [wu, wv] = L(2, 2.6);
    warn(p, wu, wv, 30);
  };
}

// ════════════════════════════════════════════════════════════════════════════
// AIRPORT (6×6): terminal, jet bridges, parked planes, control tower
// ════════════════════════════════════════════════════════════════════════════

/** Runway centre line (v) and the plane path in footprint units (EXPANSION §5.2). */
export const RUNWAY_V = 2;
export const TOUCH_U = 0.5;
export const ROLL_U = 4.5;
/** Control tower centre and the height of its beacon (px). */
export const TOWER_UV = [5.5, 5.5] as const;
export const TOWER_TOP = 106;

/** A parked jet seen from above, nose towards +v (in the sprite) at (u, v), length `len` tiles. */
function parkedJet(p: Painter, u: number, v: number, len: number) {
  const w = len * 0.9;
  const z = 2.4;
  // Fuselage.
  p.box(u - 0.045, v - len / 2, u + 0.045, v + len / 2 - 0.06, z, z + 3.4, JET, { uplight: false, top: JET });
  // Nose.
  p.begin_();
  p.m(u - 0.045, v + len / 2 - 0.06, z + 3.4);
  p.l(u + 0.045, v + len / 2 - 0.06, z + 3.4);
  p.l(u, v + len / 2 + 0.02, z + 2);
  p.fill(p.col(JET, K_TOP));
  // Wings and tailplane.
  p.begin_();
  p.m(u, v - 0.02, z + 2.2);
  p.l(u - w / 2, v - 0.14, z + 2.2);
  p.l(u - w / 2, v - 0.2, z + 2.2);
  p.l(u, v - 0.16, z + 2.2);
  p.l(u + w / 2, v - 0.2, z + 2.2);
  p.l(u + w / 2, v - 0.14, z + 2.2);
  p.fill(p.col(JET_DARK, K_TOP));
  p.begin_();
  p.m(u, v - len / 2 + 0.06, z + 3);
  p.l(u - w * 0.2, v - len / 2 - 0.01, z + 3);
  p.l(u + w * 0.2, v - len / 2 - 0.01, z + 3);
  p.fill(p.col(JET_DARK, K_TOP));
  // Fin.
  p.begin_();
  p.m(u, v - len / 2 + 0.02, z + 3.4);
  p.l(u, v - len / 2 + 0.14, z + 3.4);
  p.l(u, v - len / 2 + 0.03, z + 9);
  p.fill(p.col(mat([60, 140, 200]), K_RIGHT));
  p.lamp(u - w / 2, v - 0.17, z + 2.4, NEON.red, 6);
  p.lamp(u + w / 2, v - 0.17, z + 2.4, NEON.green, 6);
}

const airport: Recipe = (p) => {
  // Parked planes at the two jet bridges (behind the terminal on screen), noses to the terminal.
  parkedJet(p, 2.0, 4.1, 0.78);
  parkedJet(p, 3.7, 4.1, 0.78);
  // Jet bridges from the airside face.
  for (const u of [2.0, 3.7]) {
    p.box(u - 0.07, 4.42, u + 0.07, 4.72, 5.5, 9, JET_DARK, { uplight: false, top: TERMINAL });
    p.cyl(u, 4.42, 0.05, 0, 6, STEEL, STEEL);
  }
  // Curved glass terminal: a barrel-vault roof over a glass hall.
  const u0 = 1.1;
  const u1 = 4.9;
  const v0 = 4.72;
  const v1 = 5.78;
  const h = 14;
  p.box(u0, v0, u1, v1, 0, h, TERMINAL, {
    win: { style: 'curtain', floor: 7, col: 7, w: 1, h: 0.86, margin: 1, lit: 2.6 },
    glass: T_GLASS,
    noTop: true,
  });
  const steps = 6;
  const arc = (i: number) => h + Math.sin((i / steps) * Math.PI) * 9;
  for (let i = 0; i < steps; i++) {
    const va = v0 + ((v1 - v0) * i) / steps;
    const vb = v0 + ((v1 - v0) * (i + 1)) / steps;
    p.begin_();
    p.quad(u0 - 0.05, va, arc(i), u1 + 0.05, va, arc(i), u1 + 0.05, vb, arc(i + 1), u0 - 0.05, vb, arc(i + 1));
    const slope = arc(i + 1) - arc(i);
    p.fill(p.col(WHITE, slope > 0 ? K_TOP * 0.86 : K_TOP * 1.04));
    // End cap (the visible right end at u1).
    p.begin_();
    p.quad(u1 + 0.05, va, h, u1 + 0.05, vb, h, u1 + 0.05, vb, arc(i + 1), u1 + 0.05, va, arc(i));
    p.fill(p.col(WHITE, K_RIGHT));
  }
  if (p.g && !p.lod) {
    // Roof ribs.
    p.begin_();
    for (let k = 1; k < 8; k++) {
      const u = u0 + ((u1 - u0) * k) / 8;
      for (let i = 0; i <= steps; i++) {
        const v = v0 + ((v1 - v0) * i) / steps;
        if (i === 0) p.m(u, v, arc(i));
        else p.l(u, v, arc(i));
      }
    }
    p.stroke(p.col(WHITE, 0.72, 0.7), 0.4);
  }
  p.neon([u0, v1, h, u1, v1, h, u1, v0, h], p.pal.neon2, 0.6);
  // The hall glows warm through the glass at night.
  const ga = p.glowA();
  if (p.g && ga > 0.05) {
    p.g.globalCompositeOperation = 'lighter';
    p.begin_();
    p.quad(u0 + 0.05, v1, 1.5, u1 - 0.05, v1, 1.5, u1 - 0.05, v1, h - 1.5, u0 + 0.05, v1, h - 1.5);
    p.fill(css([255, 206, 140], 0.3 * Math.min(1, ga)));
    p.begin_();
    p.quad(u1, v0 + 0.05, 1.5, u1, v1 - 0.05, 1.5, u1, v1 - 0.05, h - 1.5, u1, v0 + 0.05, h - 1.5);
    p.fill(css([255, 206, 140], 0.22 * Math.min(1, ga)));
    p.g.globalCompositeOperation = 'source-over';
  }
  p.glow(2.2, v1, 7, [255, 220, 170], 70, ga * 0.45);
  p.glow(3.9, v1, 7, [255, 220, 170], 70, ga * 0.45);
  // Entrance canopy and a lit sign on the landside face.
  p.box(2.4, v1, 3.6, v1 + 0.16, 6, 7, WHITE, { uplight: false });
  p.glow(3, v1 + 0.1, 3, p.pal.neon, 40, p.glowA() * 0.7);
  p.wallSign(u0, v1, u1, v1, 0.4, 0.6, 8.5, 12.5, p.pal.neon2, true);
  // Control tower: a slim shaft, a glass cab and an antenna.
  const [tu, tv] = TOWER_UV;
  p.chamfer(tu - 0.13, tv - 0.13, tu + 0.13, tv + 0.13, 0.04, 0, 88, TOWER_SHAFT, { win: { style: 'slit', floor: 11, col: 5, w: 0.3, h: 0.5, lit: 0.8 }, top: ROOF });
  p.chamfer(tu - 0.24, tv - 0.24, tu + 0.24, tv + 0.24, 0.08, 88, 92, TOWER_SHAFT, { top: ROOF_DARK });
  p.chamfer(tu - 0.22, tv - 0.22, tu + 0.22, tv + 0.22, 0.07, 92, 100, TOWER_SHAFT, {
    win: { style: 'curtain', floor: 8, col: 5, w: 1, h: 0.9, margin: 0.5, lit: 2 },
    glass: { day: [70, 140, 160], night: [10, 40, 50] },
    top: ROOF_DARK,
    trim: p.pal.neon2,
  });
  p.cyl(tu, tv, 0.03, 100, TOWER_TOP - 2, STEEL, STEEL);
  p.reach(TOWER_TOP + 2);
  p.track(p.X(tu, tv) - 20, p.Y(tu, tv, TOWER_TOP) - 8);
  p.track(p.X(tu, tv) + 20, p.Y(tu, tv, TOWER_TOP) + 8);
  warn(p, 3, 5.2, 26);
};

// ════════════════════════════════════════════════════════════════════════════
// SPACEPORT (6×6): stages 0..2, complete, complete with an empty pad
// ════════════════════════════════════════════════════════════════════════════

/** Pad centre (the rocket) and the launch tower footprint, in footprint units. */
export const PAD_UV = [3.0, 2.9] as const;
export const ROCKET_R = 0.17;
export const ROCKET_H = 176;
export const LAUNCH_TOWER_TOP = 262;
const LT = [3.46, 2.06, 3.98, 2.58] as const;

/** Lattice tower on a square from z0 to z1: a dark core, three service decks, red legs and X-bracing on the faces we see. */
function lattice(p: Painter, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number) {
  const iu = (u1 - u0) * 0.22;
  const iv = (v1 - v0) * 0.22;
  p.box(u0 + iu, v0 + iv, u1 - iu, v1 - iv, z0, z1, LATTICE_CORE, { win: { style: 'slit', floor: 12, col: 6, w: 0.3, h: 0.5, lit: 0.6 }, uplight: false });
  for (const k of [0.36, 0.66]) {
    const z = z0 + (z1 - z0) * k;
    if (z1 - z0 > 60) p.box(u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, z, z + 1.4, LATTICE, { uplight: false });
  }
  const g = p.g;
  if (!g) {
    p.track(p.X(u0, v1), p.Y(u0, v1, z1));
    p.track(p.X(u1, v0), p.Y(u1, v0, z0));
  }
  // X-bracing on the two visible faces (+u and +v).
  if (!p.lod) {
    p.begin_();
    const step = 14;
    for (let z = z0; z + step <= z1; z += step) {
      p.m(u0, v1, z);
      p.l(u1, v1, z + step);
      p.m(u1, v1, z);
      p.l(u0, v1, z + step);
      p.m(u1, v0, z);
      p.l(u1, v1, z + step);
      p.m(u1, v1, z);
      p.l(u1, v0, z + step);
    }
    p.stroke(p.col(LATTICE, 0.9), 0.5);
  }
  // The three legs in front.
  p.begin_();
  for (const [u, v] of [
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ] as const) {
    p.m(u, v, z0);
    p.l(u, v, z1);
  }
  p.stroke(p.col(LATTICE, 1), p.lod ? 1.4 : 1.2);
}

/** The rocket standing on the pad (base at z0). Effects draws the same silhouette in flight. */
function rocket(p: Painter, u: number, v: number, z0: number) {
  const r = ROCKET_R;
  const body = ROCKET_H - 34;
  p.cyl(u, v, r, z0, z0 + body, ROCKET);
  for (const zb of [z0 + 26, z0 + 90]) p.cyl(u, v, r * 1.01, zb, zb + 5, ROCKET_BAND);
  p.cyl(u, v, r, z0 + body, z0 + ROCKET_H - 6, ROCKET, ROCKET, 0.03);
  p.cyl(u, v, 0.03, z0 + ROCKET_H - 6, z0 + ROCKET_H, ROCKET_BAND, ROCKET_BAND, 0.005);
  // Fins.
  for (const [du, dv] of [
    [1, 0],
    [0, 1],
  ] as const) {
    p.begin_();
    p.m(u + du * r, v + dv * r, z0 + 26);
    p.l(u + du * (r + 0.14), v + dv * (r + 0.14), z0 + 2);
    p.l(u + du * r, v + dv * r, z0 + 2);
    p.fill(p.col(ROCKET_BAND, du ? K_RIGHT : K_LEFT));
  }
  p.wallSign(u - r * 0.7, v + r * 0.7, u + r * 0.7, v + r * 0.7, 0.2, 0.8, z0 + 40, z0 + 80, p.pal.neon, true, true);
}

function fuelSpheres(p: Painter, built: number) {
  const spots: [number, number][] = [
    [0.8, 4.4],
    [1.55, 4.95],
    [0.85, 5.35],
  ];
  for (let i = 0; i < spots.length; i++) {
    const [u, v] = spots[i];
    p.box(u - 0.22, v - 0.22, u + 0.22, v + 0.22, 0, 3, CONC, { uplight: false });
    if (i >= built) continue;
    for (const lu of [-0.14, 0.14]) {
      p.begin_();
      p.m(u + lu, v + 0.14, 3);
      p.l(u + lu, v + 0.14, 10);
      p.stroke(p.col(STEEL, 0.6), 0.8);
    }
    // A spherical tank: a short belly under a domed top.
    p.cyl(u, v, 0.2, 6, 10, SPHERE, SPHERE, 0.26);
    p.dome(u, v, 0.26, 10, 13, SPHERE);
  }
  if (built >= 3) p.pipe(1.0, 4.4, 6, 2.6, 3.2, 6, 1.4, STEEL);
}

function bunker(p: Painter) {
  p.box(4.5, 4.6, 5.6, 5.55, 0, 10, BUNKER, { win: { style: 'band', floor: 6, col: 5, w: 1, h: 0.3, margin: 2, lit: 1.6 }, top: ROOF_DARK, trim: p.pal.neon });
  p.shed(4.48, 4.58, 5.62, 5.57, 10, 3, BUNKER, 'u');
  p.dish(5.3, 4.8, 13, 0.08);
  p.antenna(4.7, 4.8, 12, 16);
}

function spaceport(variant: number): Recipe {
  return (p) => {
    const [pu, pv] = PAD_UV;
    const stage = Math.min(4, Math.max(0, variant));
    // Flame trench walls (the scorch rings and road loop are ground art).
    p.box(pu - 0.55, pv + 0.36, pu + 0.55, pv + 0.5, 0, 3, CONC, { uplight: false });
    p.box(pu - 0.55, pv - 0.5, pu + 0.55, pv - 0.36, 0, 3, CONC, { uplight: false });
    fuelSpheres(p, stage === 0 ? 0 : stage === 1 ? 1 : 3);
    const [l0, l1, l2, l3] = LT;
    if (stage === 0) {
      // Foundation ring, rebar and the crane.
      p.cyl(pu, pv, 0.62, 0, 4, CONC, PAD);
      p.box(l0, l1, l2, l3, 0, 10, CONC, { uplight: false });
      for (let i = 0; i < 4; i++) p.container(1.2 + i * 0.5, 0.5, 1.6 + i * 0.5, 0.75, 0, 6, [150, 140, 120]);
      towerCrane(p, 4.8, 1.2, 128);
    } else if (stage === 1) {
      p.cyl(pu, pv, 0.62, 0, 4, CONC, PAD);
      lattice(p, l0, l1, l2, l3, 0, 130);
      scaffold(p, l0 - 0.08, l1 - 0.08, l2 + 0.08, l3 + 0.08, 0, 136);
      towerCrane(p, 4.8, 1.2, 168);
    } else if (stage === 2) {
      p.cyl(pu, pv, 0.62, 0, 4, CONC, PAD);
      lattice(p, l0, l1, l2, l3, 0, LAUNCH_TOWER_TOP - 8);
      scaffold(p, l0 - 0.08, l1 - 0.08, l2 + 0.08, l3 + 0.08, 0, LAUNCH_TOWER_TOP - 4);
      bunker(p);
    } else {
      // Complete: the pad, the tower with its arm, the rocket (unless it just flew).
      p.cyl(pu, pv, 0.5, 0, 4, CONC, PAD);
      lattice(p, l0, l1, l2, l3, 0, LAUNCH_TOWER_TOP - 10);
      p.box(l0 - 0.04, l1 - 0.04, l2 + 0.04, l3 + 0.04, LAUNCH_TOWER_TOP - 10, LAUNCH_TOWER_TOP - 4, ROOF_DARK, { top: ROOF_DARK, trim: p.pal.neon });
      // Lightning mast and its beacon.
      p.cyl((l0 + l2) / 2, (l1 + l3) / 2, 0.025, LAUNCH_TOWER_TOP - 4, LAUNCH_TOWER_TOP, STEEL, STEEL);
      p.blinker((l0 + l2) / 2, (l1 + l3) / 2, LAUNCH_TOWER_TOP, NEON.red, 1.4, 18);
      for (let z = 40; z < LAUNCH_TOWER_TOP - 20; z += 60) p.blinker(l2, l3, z, NEON.red, 1.8, 10);
      if (stage === 3) {
        rocket(p, pu, pv, 4);
        p.glow(pu, pv, 60, [255, 236, 210], 150, p.glowA() * 0.25);
      }
      // Gantry arm towards the rocket's upper stage.
      p.box(pu + 0.1, pv - 0.06, l0, pv + 0.06, 150, 154, LATTICE, { uplight: false });
      p.box(pu + 0.1, pv - 0.06, l0, pv + 0.06, 60, 63, LATTICE, { uplight: false });
      bunker(p);
      lightMast(p, 1.0, 1.0, 64, [255, 226, 170]);
      lightMast(p, 5.2, 3.2, 64, [255, 226, 170]);
    }
    if (stage <= 1) bunkerFootings(p);
    warn(p, 5, 5.1, 20);
  };
}

function bunkerFootings(p: Painter) {
  p.box(4.5, 4.6, 5.6, 5.55, 0, 2, CONC, { uplight: false });
}

// ── Model selection ───────────────────────────────────────────────────────

/** Spaceport model variants: 0..2 construction stages, 3 complete, 4 complete with an empty pad. */
export const SPACE_COMPLETE = 3;
export const SPACE_EMPTY_PAD = 4;

/** Spaceport construction progress 0..1 from days and real seconds (the same rule as sim/ports.ts). */
export function spaceportProgress(b: Pick<Building, 'buildDays' | 'waitSec'>): number {
  const D = BUILDINGS.spaceport.buildDays ?? 0;
  const S = SPACEPORT.minBuildSec;
  const days = D > 0 ? (D - Math.min(D, Math.max(0, b.buildDays ?? 0))) / D : 1;
  const secs = S > 0 ? (S - Math.min(S, Math.max(0, b.waitSec ?? 0))) / S : 1;
  return Math.min(days, secs);
}

/** Model variant of an expansion building: Seaport facing (0..3), Spaceport stage; 0 otherwise. */
export function portVariant(b: Partial<Pick<Building, 'id' | 'facing' | 'buildDays' | 'waitSec'>> & Pick<Building, 'type'>): number {
  if (b.type === 'seaport') return b.facing ?? 2;
  if (b.type !== 'spaceport') return 0;
  if ((b.buildDays ?? 0) > 0 || (b.waitSec ?? 0) > 0) {
    const pr = spaceportProgress(b);
    return pr >= 2 / 3 ? 2 : pr >= 1 / 3 ? 1 : 0;
  }
  return b.id !== undefined && padEmpty.has(b.id) ? SPACE_EMPTY_PAD : SPACE_COMPLETE;
}

/** Recipe of an expansion building's variant, or null for any other type. */
export function portRecipe(type: BuildingType, variant: number): Recipe | null {
  switch (type) {
    case 'academy':
      return academy;
    case 'seaport':
      return seaport(variant & 3);
    case 'airport':
      return airport;
    case 'spaceport':
      return spaceport(variant);
    default:
      return null;
  }
}

/** Facing the Seaport placement ghost shows (Effects sets it from the preview footprint each frame). */
let ghostFacing = 2;
export function seaportGhostFacing(): number {
  return ghostFacing;
}
export function setSeaportGhostFacing(f: number): void {
  ghostFacing = f >= 0 && f <= 3 ? f : 2;
}

/** Spaceports whose pad is empty (a launch in flight or just gone); PortFx keeps it. */
const padEmpty = new Set<number>();

// ════════════════════════════════════════════════════════════════════════════
// PORT FX: ships, planes, launches (EXPANSION §5.1–§5.3)
// ════════════════════════════════════════════════════════════════════════════

/** Ship hull half-length and half-width (tiles): a hull about 2.5 × 0.7 tiles. */
export const SHIP_HL = 1.25;
export const SHIP_HW = 0.35;
/** Distance of a moored ship's centre line from the quay edge (tiles). */
export const MOOR_D = 0.55;
/** The ship turns from bow-in to alongside between these distances. */
const TURN_D = 2.6;
/** Farthest approach start (tiles out from the quay, §5.1). */
const APPROACH_MAX = 12;
/** Ship cycle phases in clock-seconds: approach, moored, depart (SEAPORT.shipCycleSec = 80). */
const SHIP_IN = 26;
const SHIP_OUT = 54;
/** Plane phases in clock-seconds (AIRPORT.planeCycleSec = 36). */
const PL_TOUCH = 9;
const PL_ROLL = 13;
const PL_OFF = 14;
const PL_TAKEOFF = 22;
const PL_AIR = 26;
/** Launch sequence (real seconds) and how long the pad stays empty after liftoff. */
export const LAUNCH_SEC = 14;
const PAD_EMPTY_SEC = 30;
const ROCKET_TOP_Z = 900;

const HL = HALF_W;
const HH = HALF_H;

/** Open water a hull may cross: in bounds, water, no road (a bridge counts as land) and no rail. */
function openWater(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const i = y * N + x;
  const t = world.tiles[i];
  return t.terrain === Terrain.Water && !t.road && world.rail[i] === 0;
}

/** Bow heading (radians) for a ship at distance d: 0 = bow-in along the normal, π/2 = alongside, π = bow out. */
function shipPhi(d: number, leaving: boolean): number {
  const k = Math.max(0, Math.min(1, (TURN_D - d) / (TURN_D - MOOR_D)));
  return leaving ? Math.PI - k * (Math.PI / 2) : k * (Math.PI / 2);
}

export interface ShipPose {
  /** Centre in world tile coordinates. */
  x: number;
  y: number;
  /** Bow direction (unit, tile space). */
  ax: number;
  ay: number;
  alpha: number;
  moored: boolean;
}

interface Ship {
  id: number;
  b: Building;
  face: number;
  /** Clock-seconds into the cycle. */
  t: number;
  idle: boolean;
  /** Farthest safe approach distance (centre line, tiles out); < MOOR_D = no ship fits. */
  dStart: number;
  pose: ShipPose;
}

export interface PlanePose {
  x: number;
  y: number;
  z: number;
  /** Heading (unit, tile space). */
  hx: number;
  hy: number;
  alpha: number;
  /** Clock-seconds into the cycle (strobe phase). */
  t: number;
}

interface Plane {
  id: number;
  b: Building;
  t: number;
  idle: boolean;
  pose: PlanePose | null;
}

interface Launch {
  id: number;
  b: Building;
  /** Real (unpaused) seconds since liftoff. */
  t: number;
  first: boolean;
}

/** A ship's bow/stern/side sample points at pose (a, d, φ) in world tile coords, for the land check. */
function hullPoints(b: Building, face: number, d: number, phi: number, out: number[]): number[] {
  out.length = 0;
  // Bow direction in quay coords (a, d): φ = 0 points into the quay (+d).
  const ba = Math.sin(phi);
  const bd = Math.cos(phi);
  for (const [s, c] of [
    [SHIP_HL, 0],
    [SHIP_HL * 0.75, SHIP_HW],
    [SHIP_HL * 0.75, -SHIP_HW],
    [0, SHIP_HW],
    [0, -SHIP_HW],
    [-SHIP_HL, SHIP_HW],
    [-SHIP_HL, -SHIP_HW],
    [0, 0],
  ] as const) {
    const a = 2 + ba * s + bd * c;
    const dd = -d + bd * s - ba * c;
    const [u, v] = quayUV(face, a, dd, b.size);
    out.push(b.x + u, b.y + v);
  }
  return out;
}

const scratchPts: number[] = [];
/** Is the hull at distance d (approach heading) entirely over open water? */
function hullClear(world: World, b: Building, face: number, d: number, leaving: boolean): boolean {
  const pts = hullPoints(b, face, d, shipPhi(d, leaving), scratchPts);
  for (let i = 0; i < pts.length; i += 2) if (!openWater(world, Math.floor(pts[i]), Math.floor(pts[i + 1]))) return false;
  return true;
}

/**
 * Farthest approach start for a seaport's ship: the hull is checked at every 0.1 tile from
 * the mooring outwards (turning as it will), and the path stops before the first sample that
 * touches land, a bridge or rail, or the map edge, or at APPROACH_MAX − SHIP_HL. Returns a
 * value below MOOR_D when even the mooring is blocked (no ship is drawn then).
 */
export function shipApproach(world: World, b: Building, face: number): number {
  if (!hullClear(world, b, face, MOOR_D, false) || !hullClear(world, b, face, MOOR_D, true)) return -1;
  let best = MOOR_D;
  for (let d = MOOR_D + 0.1; d <= APPROACH_MAX - SHIP_HL + 1e-6; d += 0.1) {
    if (!hullClear(world, b, face, d, false) || !hullClear(world, b, face, d, true)) break;
    best = d;
  }
  return best;
}

/**
 * World tile coordinates (x, y pairs) of a drawn hull's sample points at a pose: bow tip,
 * shoulders, midships, stern corners and centre (tests check each lies over open water).
 */
export function shipHullPoints(p: ShipPose): number[] {
  const out: number[] = [];
  for (const [s, c] of [
    [SHIP_HL, 0],
    [SHIP_HL * 0.76, SHIP_HW],
    [SHIP_HL * 0.76, -SHIP_HW],
    [0, SHIP_HW],
    [0, -SHIP_HW],
    [-SHIP_HL, SHIP_HW],
    [-SHIP_HL, -SHIP_HW],
    [0, 0],
  ] as const)
    out.push(p.x + p.ax * s - p.ay * c, p.y + p.ay * s + p.ax * c);
  return out;
}

/** Ship pose at cycle time t (clock-seconds). */
function shipPose(s: Ship, out: ShipPose): ShipPose {
  const cyc = SEAPORT.shipCycleSec;
  const t = s.t;
  const span = Math.max(0, s.dStart - MOOR_D);
  let d = MOOR_D;
  let leaving = false;
  if (t < SHIP_IN) {
    const k = 1 - t / SHIP_IN;
    d = MOOR_D + span * k * k;
  } else if (t >= SHIP_OUT) {
    const k = (t - SHIP_OUT) / (cyc - SHIP_OUT);
    d = MOOR_D + span * k * k;
    leaving = true;
  }
  const phi = shipPhi(d, leaving);
  const ba = Math.sin(phi);
  const bd = Math.cos(phi);
  const [u0, v0] = quayUV(s.face, 2, -d, s.b.size);
  const [u1, v1] = quayUV(s.face, 2 + ba, -d + bd, s.b.size);
  out.x = s.b.x + u0;
  out.y = s.b.y + v0;
  out.ax = u1 - u0;
  out.ay = v1 - v0;
  // Fade in at the far end of the approach and out at the end of the departure.
  const edge = span > 0.3 ? 2.5 : 4;
  out.alpha = Math.max(0, Math.min(1, t / edge, (cyc - t) / edge));
  out.moored = t >= SHIP_IN && t < SHIP_OUT;
  return out;
}

/** Plane pose at cycle time t, or null while it is at the gate. Airport footprint at (bx, by). */
export function planePose(bx: number, by: number, t: number, out: PlanePose): PlanePose | null {
  const v = by + RUNWAY_V;
  out.t = t;
  out.hx = 1;
  out.hy = 0;
  out.alpha = 1;
  if (t < PL_TOUCH) {
    const s = t / PL_TOUCH;
    out.x = bx + TOUCH_U - 14 * (1 - s);
    out.y = v;
    out.z = 180 * Math.pow(1 - s, 1.12);
    out.alpha = Math.min(1, t / 1.5);
  } else if (t < PL_ROLL) {
    const s = (t - PL_TOUCH) / (PL_ROLL - PL_TOUCH);
    out.x = bx + TOUCH_U + (ROLL_U - TOUCH_U) * (1 - (1 - s) * (1 - s));
    out.y = v;
    out.z = 0;
  } else if (t < PL_OFF) {
    const s = t - PL_ROLL;
    const a = s * (Math.PI / 2);
    out.x = bx + ROLL_U + Math.sin(a) * 0.35;
    out.y = v + (1 - Math.cos(a)) * 0.35 + s * 0.25;
    out.z = 0;
    out.hx = Math.cos(a);
    out.hy = Math.sin(a);
    out.alpha = 1 - s;
  } else if (t < PL_TAKEOFF) {
    return null;
  } else if (t < PL_AIR) {
    const s = (t - PL_TAKEOFF) / (PL_AIR - PL_TAKEOFF);
    out.x = bx + 0.3 + 5.3 * s * s;
    out.y = v;
    out.z = s > 0.85 ? (s - 0.85) * 20 : 0;
    out.alpha = Math.min(1, (t - PL_TAKEOFF) / 0.6);
  } else {
    const tau = Math.min(10, t - PL_AIR);
    out.x = bx + 5.6 + 2.65 * tau + 0.4 * tau * tau;
    out.y = v;
    const k = tau / 10;
    out.z = 3 + 217 * (1 - (1 - k) * (1 - k));
    // Fade at the map edge and at the end of the cycle.
    out.alpha = Math.max(0, Math.min(1, (N + 2 - out.x) / 5, (AIRPORT.planeCycleSec - t) / 1.5));
  }
  return out;
}

// ── Shared state with buildings.ts ─────────────────────────────────────────

const shipsBySeaport = new Map<number, Ship>();
const launchesById = new Map<number, Launch>();

/** Colours cached per night tenth (no per-frame string building). */
interface Cols {
  hull: string;
  hullSide: string;
  hullTop: string;
  deck: string;
  bridge: string;
  bridgeSide: string;
  win: string;
  jet: string;
  jetDark: string;
  trolley: string;
  cable: string;
  containers: string[];
  containersSide: string[];
}
const colCache: Cols[] = [];
function cols(night: number): Cols {
  const b = Math.max(0, Math.min(10, Math.round(night * 10)));
  let c = colCache[b];
  if (c) return c;
  const n = b / 10;
  const m = (x: Mat, k: number) => css(shade(mix(x.day, x.night, n), k));
  const hull = mat([44, 54, 78]);
  c = {
    hull: m(hull, K_LEFT),
    hullSide: m(hull, K_RIGHT),
    hullTop: m(mat([120, 60, 56]), K_TOP),
    deck: m(mat([96, 100, 108]), K_TOP),
    bridge: m(WHITE, K_TOP),
    bridgeSide: m(WHITE, K_RIGHT),
    win: css(mix([40, 50, 70], [255, 220, 150], Math.min(1, n * 1.3))),
    jet: m(JET, K_TOP),
    jetDark: m(JET_DARK, K_RIGHT),
    trolley: m(mat([226, 186, 60]), K_RIGHT),
    cable: m(STEEL, 0.6),
    containers: CONTAINERS.map((x) => m(mat(x), K_TOP)),
    containersSide: CONTAINERS.map((x) => m(mat(x), K_RIGHT * 0.9)),
  };
  colCache[b] = c;
  return c;
}

/** Fill a convex polygon given in ship-local (s, c) pairs at height z, mapped through (cx, cy, ax, ay). */
function shipPoly(ctx: CanvasRenderingContext2D, pts: readonly number[], z: number, cx: number, cy: number, ax: number, ay: number) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const s = pts[i];
    const c = pts[i + 1];
    const x = cx + ax * s - ay * c;
    const y = cy + ay * s + ax * c;
    const X = (x - y) * HL;
    const Y = (x + y) * HH - z;
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
  ctx.closePath();
}

/** A box in ship-local coords (s0..s1 × c0..c1, z0..z1): its two visible sides and the top. */
function shipBox(ctx: CanvasRenderingContext2D, s0: number, s1: number, c0: number, c1: number, z0: number, z1: number, cx: number, cy: number, ax: number, ay: number, top: string, side: string) {
  const corners = [s0, c0, s1, c0, s1, c1, s0, c1];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const sa = corners[i * 2];
    const ca = corners[i * 2 + 1];
    const sb = corners[j * 2];
    const cb = corners[j * 2 + 1];
    // Outward normal of edge a→b in ship coords, then in tile space.
    let ns = cb - ca;
    let nc = -(sb - sa);
    const ms = (sa + sb) / 2 - (s0 + s1) / 2;
    const mc = (ca + cb) / 2 - (c0 + c1) / 2;
    if (ns * ms + nc * mc < 0) {
      ns = -ns;
      nc = -nc;
    }
    const nx = ax * ns - ay * nc;
    const ny = ay * ns + ax * nc;
    if (nx + ny <= 0) continue;
    const xa = cx + ax * sa - ay * ca;
    const ya = cy + ay * sa + ax * ca;
    const xb = cx + ax * sb - ay * cb;
    const yb = cy + ay * sb + ax * cb;
    ctx.beginPath();
    ctx.moveTo((xa - ya) * HL, (xa + ya) * HH - z0);
    ctx.lineTo((xb - yb) * HL, (xb + yb) * HH - z0);
    ctx.lineTo((xb - yb) * HL, (xb + yb) * HH - z1);
    ctx.lineTo((xa - ya) * HL, (xa + ya) * HH - z1);
    ctx.closePath();
    ctx.fillStyle = side;
    ctx.fill();
  }
  shipPoly(ctx, corners, z1, cx, cy, ax, ay);
  ctx.fillStyle = top;
  ctx.fill();
}

const HULL = [-SHIP_HL, -SHIP_HW, SHIP_HL * 0.76, -SHIP_HW, SHIP_HL, 0, SHIP_HL * 0.76, SHIP_HW, -SHIP_HL, SHIP_HW];

/** Draw a container ship at its pose (world space). `lod` skips the small parts. */
function drawShip(ctx: CanvasRenderingContext2D, s: Ship, night: number, lod: boolean) {
  const p = s.pose;
  if (p.alpha <= 0.01) return;
  const c = cols(night);
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * p.alpha;
  const { x, y, ax, ay } = p;
  // Wake behind a moving ship.
  if (!p.moored && !lod) {
    ctx.globalCompositeOperation = night > 0.4 ? 'lighter' : 'source-over';
    shipPoly(ctx, [-SHIP_HL - 0.7, -0.3, -SHIP_HL, -SHIP_HW * 0.6, -SHIP_HL, SHIP_HW * 0.6, -SHIP_HL - 0.7, 0.3], 0, x, y, ax, ay);
    ctx.fillStyle = night > 0.4 ? 'rgba(120,180,255,0.08)' : 'rgba(230,240,255,0.12)';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // Hull: sides, then the deck.
  for (let i = 0; i < HULL.length / 2; i++) {
    const j = (i + 1) % (HULL.length / 2);
    const sa = HULL[i * 2];
    const ca = HULL[i * 2 + 1];
    const sb = HULL[j * 2];
    const cb = HULL[j * 2 + 1];
    let ns = cb - ca;
    let nc = -(sb - sa);
    if (ns * (sa + sb) + nc * (ca + cb) < 0) {
      ns = -ns;
      nc = -nc;
    }
    const nx = ax * ns - ay * nc;
    const ny = ay * ns + ax * nc;
    if (nx + ny <= 0) continue;
    const xa = x + ax * sa - ay * ca;
    const ya = y + ay * sa + ax * ca;
    const xb = x + ax * sb - ay * cb;
    const yb = y + ay * sb + ax * cb;
    ctx.beginPath();
    ctx.moveTo((xa - ya) * HL, (xa + ya) * HH);
    ctx.lineTo((xb - yb) * HL, (xb + yb) * HH);
    ctx.lineTo((xb - yb) * HL, (xb + yb) * HH - 5);
    ctx.lineTo((xa - ya) * HL, (xa + ya) * HH - 5);
    ctx.closePath();
    ctx.fillStyle = ny > nx ? c.hull : c.hullSide;
    ctx.fill();
  }
  shipPoly(ctx, HULL, 5, x, y, ax, ay);
  ctx.fillStyle = c.deck;
  ctx.fill();
  // Superstructure and container blocks, back to front.
  const parts: [number, number][] = [];
  for (let k = 0; k < 4; k++) parts.push([k, -0.72 + k * 0.42 + 0.19]);
  parts.push([4, -0.98]);
  parts.sort((pa, pb) => {
    const da = (ax + ay) * pa[1];
    const db = (ax + ay) * pb[1];
    return da - db;
  });
  for (const [k] of parts) {
    if (k === 4) {
      shipBox(ctx, -1.17, -0.8, -0.29, 0.29, 5, 17, x, y, ax, ay, c.bridge, c.bridgeSide);
      if (!lod) {
        // Bridge windows (a lit band at night).
        shipBox(ctx, -0.81, -0.79, -0.25, 0.25, 13, 15.5, x, y, ax, ay, c.win, c.win);
      }
      continue;
    }
    const s0 = -0.72 + k * 0.42;
    const ci = Math.floor(hash2(s.id, k, 61) * CONTAINERS.length);
    const h = 5 + (hash2(s.id, k, 62) < 0.5 ? 8 : 5);
    shipBox(ctx, s0, s0 + 0.38, -0.27, 0.27, 5, h, x, y, ax, ay, c.containers[ci], c.containersSide[ci]);
  }
  // Lights at night: masthead, side lights, deck glow.
  if (night > 0.3 && !lod) {
    ctx.globalCompositeOperation = 'lighter';
    const light = (sl: number, cl: number, z: number, rgb: RGB, size: number, k: number) => {
      const lx = x + ax * sl - ay * cl;
      const ly = y + ay * sl + ax * cl;
      ctx.globalAlpha = a0 * p.alpha * night * k;
      ctx.drawImage(glowSprite(rgb, 32), (lx - ly) * HL - size / 2, (lx + ly) * HH - z - size / 2, size, size);
    };
    light(-1.0, 0, 21, [255, 240, 210], 10, 0.9);
    light(0.9, SHIP_HW, 6, NEON.green, 6, 0.8);
    light(0.9, -SHIP_HW, 6, NEON.red, 6, 0.8);
    light(0, 0, 12, [255, 210, 140], 26, 0.35);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = a0;
}

/** Trolley travel (inland units) of a crane for a moored ship at cycle time t. */
function trolleyD(t: number, k: number): { d: number; carry: boolean; hoist: number } {
  if (t < SHIP_IN + 1 || t >= SHIP_OUT - 1) return { d: TROLLEY_D1, carry: false, hoist: 6 };
  const ph = ((t - SHIP_IN - 1) / 7 + k * 0.37) % 1;
  // Out over the ship (0..0.4), hoist (0.4..0.5), back over the quay (0.5..0.9), lower (0.9..1).
  let d: number;
  let hoist: number;
  if (ph < 0.4) {
    d = TROLLEY_D1 + (TROLLEY_D0 - TROLLEY_D1) * (ph / 0.4);
    hoist = 8;
  } else if (ph < 0.5) {
    d = TROLLEY_D0;
    hoist = 8 + Math.sin(((ph - 0.4) / 0.1) * Math.PI) * 18;
  } else if (ph < 0.9) {
    d = TROLLEY_D0 + (TROLLEY_D1 - TROLLEY_D0) * ((ph - 0.5) / 0.4);
    hoist = 8;
  } else {
    d = TROLLEY_D1;
    hoist = 8 + Math.sin(((ph - 0.9) / 0.1) * Math.PI) * 22;
  }
  return { d, carry: ph >= 0.45 && ph < 0.95, hoist };
}

/**
 * Live parts of an expansion building, drawn right after its sprite in the depth sweep
 * (world space; (wx, wy) = footprint top corner): crane trolleys and a ship moored in front of
 * an S or E facing quay, the control tower beacon, pad steam and searchlights.
 */
export function drawPortLive(ctx: CanvasRenderingContext2D, wx: number, wy: number, b: Building, env: { time: number; night: number; zoom: number; quality: 'low' | 'high'; ghost?: boolean }, on: boolean): void {
  if (env.ghost) return;
  const lod = env.zoom < 0.55;
  const P = (u: number, v: number, z: number): [number, number] => [wx + (u - v) * HL, wy + (u + v) * HH - z];
  const night = env.night;
  if (b.type === 'seaport') {
    const s = shipsBySeaport.get(b.id);
    const face = b.facing ?? 2;
    const t = s && !s.idle ? s.t : 0;
    if (!lod) {
      const c = cols(night);
      for (let k = 0; k < CRANE_AT.length; k++) {
        const a = CRANE_AT[k];
        const tr = s && s.pose.moored && !s.idle ? trolleyD(t, k) : { d: TROLLEY_D1, carry: false, hoist: 6 };
        const [u0, v0] = quayUV(face, a - 0.08, tr.d - 0.09, b.size);
        const [u1, v1] = quayUV(face, a + 0.08, tr.d + 0.09, b.size);
        const ua = Math.min(u0, u1);
        const ub = Math.max(u0, u1);
        const va = Math.min(v0, v1);
        const vb = Math.max(v0, v1);
        const z0 = BOOM_Z - 3;
        const z1 = BOOM_Z + 0.5;
        // Trolley body (front faces + top).
        let q = P(ub, va, z0);
        let r = P(ub, vb, z0);
        ctx.fillStyle = c.trolley;
        ctx.beginPath();
        ctx.moveTo(q[0], q[1]);
        ctx.lineTo(r[0], r[1]);
        r = P(ua, vb, z0);
        ctx.lineTo(r[0], r[1]);
        r = P(ua, vb, z1);
        ctx.lineTo(r[0], r[1]);
        r = P(ub, vb, z1);
        ctx.lineTo(r[0], r[1]);
        r = P(ub, va, z1);
        ctx.lineTo(r[0], r[1]);
        ctx.closePath();
        ctx.fill();
        // Hoist cable and spreader (with a box when carrying).
        const [cu, cv] = quayUV(face, a, tr.d, b.size);
        q = P(cu, cv, z0);
        const zl = Math.max(2, z0 - tr.hoist - 8);
        r = P(cu, cv, zl);
        ctx.strokeStyle = c.cable;
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(q[0], q[1]);
        ctx.lineTo(r[0], r[1]);
        ctx.stroke();
        if (tr.carry) {
          const ci = Math.floor(hash2(b.id, Math.floor(t / 7) + k, 9) * CONTAINERS.length);
          ctx.fillStyle = c.containersSide[ci];
          ctx.fillRect(r[0] - 4, r[1], 8, 4.5);
          ctx.fillStyle = c.containers[ci];
          ctx.fillRect(r[0] - 4, r[1] - 1.5, 8, 1.6);
        } else {
          ctx.fillStyle = c.trolley;
          ctx.fillRect(r[0] - 3, r[1], 6, 1.2);
        }
      }
    }
    // A ship in front of an S or E quay draws in this slot, over the quay and under what stands in front.
    if (s && !s.idle && s.dStart >= MOOR_D && (face === 1 || face === 2)) drawShip(ctx, s, night, lod);
    // Mast floodlights at night: warm pools over the quay and the container rows.
    if (on && night > 0.3 && env.quality === 'high' && !lod) {
      ctx.globalCompositeOperation = 'lighter';
      for (const [a, d, k] of [
        [0.6, 1.0, 1],
        [3.4, 1.0, 1],
        [2.0, 2.2, 0.7],
      ] as const) {
        const [u, v] = quayUV(face, a, d, b.size);
        const [lx, ly] = P(u, v, 4);
        ctx.globalAlpha = 0.28 * night * k;
        ctx.drawImage(glowSprite([255, 222, 160], 64), lx - 90, ly - 45, 180, 90);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    return;
  }
  if (b.type === 'airport') {
    if (!on || env.quality === 'low') return;
    // Rotating beacon on the control tower: alternating white and green sweeps.
    const [tx, ty] = P(TOWER_UV[0], TOWER_UV[1], TOWER_TOP);
    const ang = env.time * 2.4;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) {
      const a = ang + k * Math.PI;
      const front = Math.max(0, Math.cos(a));
      const rgb: RGB = k ? NEON.green : [255, 255, 240];
      ctx.globalAlpha = (0.25 + 0.75 * front) * (0.35 + 0.65 * night);
      const sz = 8 + front * 16;
      ctx.drawImage(glowSprite(rgb, 32), tx + Math.sin(a) * 4 - sz / 2, ty - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  if (b.type === 'spaceport') {
    const complete = (b.buildDays ?? 0) <= 0 && (b.waitSec ?? 0) <= 0;
    if (!complete || !on || env.quality === 'low' || lod) return;
    const [pu, pv] = PAD_UV;
    // Steam venting from the pad: a few slow puffs.
    const launching = launchesById.has(b.id);
    if (!launching) {
      for (let k = 0; k < 4; k++) {
        const ph = (env.time * 0.22 + k / 4) % 1;
        const [sx, sy] = P(pu - 0.3 + k * 0.2, pv + 0.42, 3 + ph * 26);
        const r = 2 + ph * 7;
        ctx.globalAlpha = (1 - ph) * (night > 0.4 ? 0.22 : 0.4);
        ctx.fillStyle = night > 0.4 ? '#8a90b0' : '#e8ecf4';
        ctx.beginPath();
        ctx.ellipse(sx + ph * 6, sy, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Slow searchlights at night, crossing over the tower.
    if (night > 0.35) {
      ctx.globalCompositeOperation = 'lighter';
      for (const [k, u, v] of [
        [0, 1.0, 1.0],
        [1, 5.2, 3.2],
      ] as const) {
        const [bx0, by0] = P(u, v, 64);
        const a = Math.sin(env.time * 0.25 + k * 2.1) * 0.55 + (k ? -0.25 : 0.25);
        const len = 340;
        const tx = bx0 + Math.sin(a) * len;
        const ty = by0 - Math.cos(a) * len;
        const w = 26;
        ctx.globalAlpha = 0.07 * night;
        ctx.fillStyle = '#fff1d0';
        ctx.beginPath();
        ctx.moveTo(bx0, by0);
        ctx.lineTo(tx - Math.cos(a) * w, ty - Math.sin(a) * w);
        ctx.lineTo(tx + Math.cos(a) * w, ty + Math.sin(a) * w);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

/** Is a world-px box inside the view (world px), with a margin? */
function inView(view: { x0: number; y0: number; x1: number; y1: number }, x0: number, y0: number, x1: number, y1: number): boolean {
  return x1 >= view.x0 && x0 <= view.x1 && y1 >= view.y0 && y0 <= view.y1;
}

/** Visible world-px rect of a context with a uniform world transform. */
function viewOf(ctx: CanvasRenderingContext2D, out: { x0: number; y0: number; x1: number; y1: number }) {
  const t = ctx.getTransform();
  const a = t.a || 1;
  out.x0 = -t.e / a;
  out.y0 = -t.f / a;
  out.x1 = (ctx.canvas.width - t.e) / a;
  out.y1 = (ctx.canvas.height - t.f) / a;
  return out;
}

/** A plane at its pose (world space): ~26 × 5 px jet with nav lights, a strobe and a landing light at night. */
function drawPlane(ctx: CanvasRenderingContext2D, p: PlanePose, night: number, quality: 'low' | 'high', shadow: boolean) {
  const c = cols(night);
  const a0 = ctx.globalAlpha;
  const { x, y, z, hx, hy } = p;
  const L = 0.4;
  const map = (s: number, w: number, zz: number): [number, number] => {
    const px = x + hx * s - hy * w;
    const py = y + hy * s + hx * w;
    return [(px - py) * HL, (px + py) * HH - zz];
  };
  const poly = (pts: readonly number[], zz: number) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const [X, Y] = map(pts[i], pts[i + 1], zz);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  };
  const WING = [0.06, 0.03, -0.12, 0.34, -0.2, 0.34, -0.08, 0.03, -0.08, -0.03, -0.2, -0.34, -0.12, -0.34, 0.06, -0.03];
  const TAIL = [-0.3, 0.02, -0.4, 0.13, -0.44, 0.13, -0.38, 0.0, -0.44, -0.13, -0.4, -0.13, -0.3, -0.02];
  const BODY = [L, 0, L - 0.06, 0.045, -L, 0.04, -L - 0.02, 0, -L, -0.04, L - 0.06, -0.045];
  if (shadow) {
    // Ground shadow while low (drawn in the ground pass).
    ctx.globalAlpha = a0 * p.alpha * Math.max(0, 0.32 * (1 - z / 120)) * (1 - night * 0.6);
    ctx.fillStyle = '#05040c';
    poly(WING, 0);
    ctx.fill();
    poly(BODY, 0);
    ctx.fill();
    ctx.globalAlpha = a0;
    return;
  }
  ctx.globalAlpha = a0 * p.alpha;
  poly(WING, z);
  ctx.fillStyle = c.jetDark;
  ctx.fill();
  poly(TAIL, z + 1);
  ctx.fill();
  poly(BODY, z + 1.5);
  ctx.fillStyle = c.jet;
  ctx.fill();
  // Fin.
  const [f0x, f0y] = map(-L + 0.02, 0, z + 1.5);
  const [f1x, f1y] = map(-L + 0.14, 0, z + 1.5);
  const [f2x, f2y] = map(-L + 0.02, 0, z + 7);
  ctx.beginPath();
  ctx.moveTo(f0x, f0y);
  ctx.lineTo(f1x, f1y);
  ctx.lineTo(f2x, f2y);
  ctx.closePath();
  ctx.fillStyle = '#3c8cc8';
  ctx.fill();
  if (quality === 'high') {
    ctx.globalCompositeOperation = 'lighter';
    const light = (s: number, w: number, zz: number, rgb: RGB, size: number, k: number) => {
      const [X, Y] = map(s, w, zz);
      ctx.globalAlpha = a0 * p.alpha * k;
      ctx.drawImage(glowSprite(rgb, 32), X - size / 2, Y - size / 2, size, size);
    };
    const nl = 0.45 + 0.55 * night;
    light(-0.17, 0.34, z, NEON.green, 6, nl);
    light(-0.17, -0.34, z, NEON.red, 6, nl);
    if (p.t % 1 < 0.12) light(0, 0, z + 4, NEON.red, 12, 1);
    if (night > 0.3 && z < 120) light(L + 0.25, 0, z + 1, [255, 255, 235], 30, night * 0.8);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = a0;
}

/** Rocket in flight at height z above the pad (world px at the pad (x, y)). */
function drawRocket(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, night: number) {
  const c = cols(night);
  const w = ROCKET_R * HL * Math.SQRT2;
  const body = ROCKET_H - 34;
  const yb = y - z;
  ctx.fillStyle = c.bridgeSide;
  ctx.fillRect(x - w, yb - body, w * 2, body);
  ctx.fillStyle = c.bridge;
  ctx.fillRect(x - w, yb - body, w * 0.9, body);
  ctx.fillStyle = '#2a2c36';
  ctx.fillRect(x - w, yb - 31, w * 2, 5);
  ctx.fillRect(x - w, yb - 95, w * 2, 5);
  ctx.beginPath();
  ctx.moveTo(x - w, yb - body);
  ctx.lineTo(x, yb - ROCKET_H);
  ctx.lineTo(x + w, yb - body);
  ctx.closePath();
  ctx.fillStyle = c.bridge;
  ctx.fill();
  ctx.fillStyle = '#2a2c36';
  ctx.beginPath();
  ctx.moveTo(x - w, yb - 26);
  ctx.lineTo(x - w - 6, yb);
  ctx.lineTo(x - w, yb);
  ctx.moveTo(x + w, yb - 26);
  ctx.lineTo(x + w + 6, yb);
  ctx.lineTo(x + w, yb);
  ctx.fill();
}

/**
 * Port FX state machine: one ship per live Seaport (80 clock-s cycle), one plane per live
 * Airport (36 clock-s), one launch at a time per Spaceport (14 real seconds, only on
 * 'liftoff'). update() takes the frame dt and game.clockRate: ships and planes advance by
 * dt × clockRate, launches by dt while clockRate > 0, so all of it freezes while paused.
 */
export class PortFx {
  private ships = shipsBySeaport;
  private planes = new Map<number, Plane>();
  private launches = launchesById;
  private dirty = true;
  private sinceScan = 0;
  private readonly view = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /** Drop everything (world swapped). */
  reset(): void {
    this.ships.clear();
    this.planes.clear();
    this.launches.clear();
    padEmpty.clear();
    this.dirty = true;
  }

  /** Tiles changed: rescan ports and ship paths on the next update. */
  invalidate(): void {
    this.dirty = true;
  }

  /** A visible launch starts now (Game's 'liftoff'). */
  liftoff(world: World, id: number, first: boolean): void {
    const b = world.buildings.get(id);
    if (!b || b.type !== 'spaceport') return;
    this.launches.set(id, { id, b, t: 0, first });
    padEmpty.add(id);
  }

  private scan(world: World) {
    this.dirty = false;
    this.sinceScan = 0;
    const seen = new Set<number>();
    for (const b of world.buildings.values()) {
      if (b.type === 'seaport') {
        seen.add(b.id);
        let s = this.ships.get(b.id);
        if (!s || s.b !== b) {
          s = { id: b.id, b, face: b.facing ?? 2, t: 0, idle: true, dStart: -1, pose: { x: 0, y: 0, ax: 1, ay: 0, alpha: 0, moored: false } };
          this.ships.set(b.id, s);
        }
        s.face = b.facing ?? 2;
        s.dStart = shipApproach(world, b, s.face);
      } else if (b.type === 'airport') {
        seen.add(b.id);
        const pl = this.planes.get(b.id);
        if (!pl || pl.b !== b) this.planes.set(b.id, { id: b.id, b, t: 0, idle: true, pose: null });
      } else if (b.type === 'spaceport') seen.add(b.id);
    }
    for (const id of [...this.ships.keys()]) if (!seen.has(id)) this.ships.delete(id);
    for (const id of [...this.planes.keys()]) if (!seen.has(id)) this.planes.delete(id);
    for (const [id, l] of [...this.launches]) {
      if (!seen.has(id) || world.buildings.get(id) !== l.b) {
        this.launches.delete(id);
        padEmpty.delete(id);
      }
    }
  }

  /** Advance by frame seconds `dt` at visual clock rate `rate` (0 while paused). */
  update(dt: number, rate: number, world: World): void {
    this.sinceScan += dt;
    if (this.dirty || this.sinceScan > 1) this.scan(world);
    const cd = dt * Math.max(0, rate);
    const live = (b: Building) => b.offline <= 0 && b.powered && (b.buildDays ?? 0) <= 0;
    for (const s of this.ships.values()) {
      if (s.idle) {
        // The first ship starts its approach the moment the port opens.
        if (live(s.b) && s.dStart >= MOOR_D) {
          s.idle = false;
          s.t = 0;
        } else continue;
      } else s.t += cd;
      if (s.t >= SEAPORT.shipCycleSec) {
        if (live(s.b) && s.dStart >= MOOR_D) s.t -= SEAPORT.shipCycleSec;
        else {
          s.idle = true;
          continue;
        }
      }
      shipPose(s, s.pose);
    }
    for (const pl of this.planes.values()) {
      if (pl.idle) {
        if (live(pl.b)) {
          pl.idle = false;
          pl.t = 0;
        } else continue;
      } else pl.t += cd;
      if (pl.t >= AIRPORT.planeCycleSec) {
        if (live(pl.b)) pl.t -= AIRPORT.planeCycleSec;
        else {
          pl.idle = true;
          pl.pose = null;
          continue;
        }
      }
      pl.pose = planePose(pl.b.x, pl.b.y, pl.t, pl.pose ?? { x: 0, y: 0, z: 0, hx: 1, hy: 0, alpha: 1, t: 0 });
    }
    // Launches are a cut-scene in real seconds, but they freeze while the game is paused.
    if (rate > 0) {
      for (const [id, l] of [...this.launches]) {
        l.t += dt;
        if (l.t >= PAD_EMPTY_SEC) {
          this.launches.delete(id);
          padEmpty.delete(id);
        }
      }
    }
  }

  /** Ships in front of N or W quays (behind their port on screen), ground-phase planes and plane shadows. */
  drawGround(ctx: CanvasRenderingContext2D, env: { night: number; zoom: number; quality: 'low' | 'high' }): void {
    const view = viewOf(ctx, this.view);
    const lod = env.zoom < 0.55;
    for (const s of this.ships.values()) {
      if (s.idle || s.dStart < MOOR_D || s.face === 1 || s.face === 2) continue;
      const X = (s.pose.x - s.pose.y) * HL;
      const Y = (s.pose.x + s.pose.y) * HH;
      if (!inView(view, X - 90, Y - 60, X + 90, Y + 50)) continue;
      drawShip(ctx, s, env.night, lod);
    }
    for (const pl of this.planes.values()) {
      const p = pl.pose;
      if (!p || pl.idle) continue;
      const X = (p.x - p.y) * HL;
      const Y = (p.x + p.y) * HH;
      if (!inView(view, X - 40, Y - p.z - 30, X + 40, Y + 30)) continue;
      if (p.z < 6) drawPlane(ctx, p, env.night, env.quality, false);
      else if (p.z < 120 && env.quality === 'high') drawPlane(ctx, p, env.night, env.quality, true);
    }
  }

  /** Airborne planes and launches. The rocket is culled by its own screen box. */
  drawSky(ctx: CanvasRenderingContext2D, env: { night: number; zoom: number; quality: 'low' | 'high' }): void {
    const view = viewOf(ctx, this.view);
    for (const pl of this.planes.values()) {
      const p = pl.pose;
      if (!p || pl.idle || p.z < 6) continue;
      const X = (p.x - p.y) * HL;
      const Y = (p.x + p.y) * HH - p.z;
      if (!inView(view, X - 30, Y - 30, X + 30, Y + 30)) continue;
      drawPlane(ctx, p, env.night, env.quality, false);
    }
    for (const l of this.launches.values()) this.drawLaunch(ctx, l, view, env);
  }

  private drawLaunch(ctx: CanvasRenderingContext2D, l: Launch, view: { x0: number; y0: number; x1: number; y1: number }, env: { night: number; zoom: number; quality: 'low' | 'high' }) {
    const t = l.t;
    if (t >= LAUNCH_SEC) return;
    const b = l.b;
    const pu = b.x + PAD_UV[0];
    const pv = b.y + PAD_UV[1];
    const x = (pu - pv) * HL;
    const y = (pu + pv) * HH - 4;
    const rise = t < 1.5 ? 0 : Math.min(1, (t - 1.5) / 6.5);
    const z = ROCKET_TOP_Z * Math.pow(rise, 2.2);
    // Cull by the rocket's own box (it climbs far above the pad) plus its exhaust and smoke.
    if (!inView(view, x - 120, y - z - ROCKET_H - 40, x + 120, y + 60)) return;
    const low = env.quality === 'low';
    const night = env.night;
    const a0 = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    if (t < 8 + 0.01) {
      // Ignition and exhaust.
      const ign = t < 1.5 ? t / 1.5 : Math.max(0, 1 - (t - 1.5) / 3);
      // Low quality: the rocket and one glow only (the ignition glow, then the exhaust).
      if (!low || t < 1.5) {
        ctx.globalAlpha = Math.min(1, 0.4 + ign) * (0.6 + 0.4 * night);
        const g = 80 + ign * 120;
        ctx.drawImage(glowSprite([255, 170, 80], 64), x - g / 2, y - g * 0.35, g, g * 0.6);
      }
      if (!low && t >= 1.5) {
        // A column of 12 glow sprites, stretched along the climb so they overlap into one plume.
        const gap = 10 + rise * 26;
        for (let k = 0; k < 12; k++) {
          const zz = z - 8 - k * gap;
          if (zz < 0) break;
          const sz = 22 - k * 1.2 + Math.sin(t * 40 + k) * 2;
          const tall = Math.max(sz, gap * 2.2);
          ctx.globalAlpha = (1 - k / 12) * 0.85;
          ctx.drawImage(glowSprite(k < 3 ? [255, 236, 190] : [255, 150, 70], 32), x - sz / 2, y - zz - tall / 2, sz, tall);
        }
      } else if (t >= 1.5) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(glowSprite([255, 200, 120], 32), x - 14, y - z - 4, 28, 28);
      }
    }
    if (t >= 8) {
      // Afterglow line where it climbed.
      const k = 1 - (t - 8) / (LAUNCH_SEC - 8);
      ctx.globalAlpha = 0.35 * k * (0.5 + 0.5 * night);
      ctx.strokeStyle = '#ffb070';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x, y - ROCKET_TOP_Z - 40);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Smoke puffs rolling out from the pad.
    if (!low && t < 11) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const grow = Math.min(1, t / 3);
        const r = 0.4 + grow * 1.6;
        const sx = x + (Math.cos(a) - Math.sin(a)) * r * HL * 0.7;
        const sy = y + (Math.cos(a) + Math.sin(a)) * r * HH * 0.7 - 6;
        const rad = 8 + grow * 18;
        ctx.globalAlpha = Math.max(0, 0.55 * (1 - t / 11)) * (night > 0.4 ? 0.7 : 1);
        ctx.fillStyle = night > 0.4 ? '#6e6a86' : '#e6e8ef';
        ctx.beginPath();
        ctx.ellipse(sx, sy, rad, rad * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = a0;
    if (t >= 1.5 && t < 8.5 && z < ROCKET_TOP_Z) drawRocket(ctx, x, y, z, night);
    ctx.globalAlpha = a0;
  }

  // ── Read-only views (tests, debug) ──
  shipOf(id: number): Readonly<ShipPose> | null {
    const s = this.ships.get(id);
    return s && !s.idle && s.dStart >= MOOR_D ? s.pose : null;
  }
  shipTime(id: number): number | null {
    const s = this.ships.get(id);
    return s && !s.idle ? s.t : null;
  }
  shipStart(id: number): number {
    return this.ships.get(id)?.dStart ?? -1;
  }
  planeOf(id: number): Readonly<PlanePose> | null {
    const p = this.planes.get(id);
    return p && !p.idle ? p.pose : null;
  }
  planeTime(id: number): number | null {
    const p = this.planes.get(id);
    return p && !p.idle ? p.t : null;
  }
  launchTime(id: number): number | null {
    return this.launches.get(id)?.t ?? null;
  }
  get launching(): number {
    let n = 0;
    for (const l of this.launches.values()) if (l.t < LAUNCH_SEC) n++;
    return n;
  }
}
