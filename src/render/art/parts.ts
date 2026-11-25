// ─────────────────────────────────────────────────────────────────────────────
// Shared building parts for the Megacity art (kit templates, styles, faction
// designs, landmarks): shapes the Painter does not have as one call. All of them
// draw through the Painter (record / paint passes, bounds, night colours).
// ─────────────────────────────────────────────────────────────────────────────

import { HALF_H, HALF_W } from '../camera';
import { css, mix, shade, type RGB } from '../palette';
import { K_LEFT, K_RIGHT, K_TOP, mat, type Mat, type Painter, type PrismOpts, type WinSpec } from './painter';

/** Regular n-gon footprint (flat u,v pairs) around (cu, cv), radius r, rotated by a. */
export function ngon(cu: number, cv: number, r: number, n: number, a = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = a + (i / n) * Math.PI * 2;
    out.push(cu + Math.cos(t) * r, cv + Math.sin(t) * r);
  }
  return out;
}

/** Hexagonal prism (Basalt). */
export function hexPrism(p: Painter, cu: number, cv: number, r: number, z0: number, z1: number, m: Mat, o: PrismOpts = {}) {
  p.prism(ngon(cu, cv, r, 6, Math.PI / 12), z0, z1, m, o);
}

/** Four-sided pyramid roof on (u0,v0)-(u1,v1) at z, apex `rise` above the centre. */
export function pyramid(p: Painter, u0: number, v0: number, u1: number, v1: number, z: number, rise: number, m: Mat) {
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  p.begin_();
  p.m(u1, v0, z);
  p.l(u1, v1, z);
  p.l(cu, cv, z + rise);
  p.g?.closePath();
  p.fill(p.col(m, K_RIGHT * 1.05));
  p.begin_();
  p.m(u0, v1, z);
  p.l(u1, v1, z);
  p.l(cu, cv, z + rise);
  p.g?.closePath();
  p.fill(p.col(m, K_TOP * 0.95));
  if (p.g && !p.lod) {
    p.begin_();
    p.m(u1, v1, z);
    p.l(cu, cv, z + rise);
    p.stroke(p.col(m, 1.3, 0.7), 0.5);
  }
}

/** Hip roof: a pyramid cut by a ridge along the longer side. */
export function hip(p: Painter, u0: number, v0: number, u1: number, v1: number, z: number, rise: number, m: Mat) {
  const alongU = u1 - u0 >= v1 - v0;
  const d = Math.min(u1 - u0, v1 - v0) / 2;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const a: [number, number] = alongU ? [u0 + d, cv] : [cu, v0 + d];
  const b: [number, number] = alongU ? [u1 - d, cv] : [cu, v1 - d];
  // Right (+u) face.
  p.begin_();
  if (alongU) {
    p.m(u1, v0, z);
    p.l(u1, v1, z);
    p.l(b[0], b[1], z + rise);
  } else {
    p.m(u1, v0, z);
    p.l(u1, v1, z);
    p.l(b[0], b[1], z + rise);
    p.l(a[0], a[1], z + rise);
  }
  p.g?.closePath();
  p.fill(p.col(m, K_RIGHT * 1.05));
  // Left (+v) face.
  p.begin_();
  if (alongU) {
    p.m(u0, v1, z);
    p.l(u1, v1, z);
    p.l(b[0], b[1], z + rise);
    p.l(a[0], a[1], z + rise);
  } else {
    p.m(u0, v1, z);
    p.l(u1, v1, z);
    p.l(b[0], b[1], z + rise);
  }
  p.g?.closePath();
  p.fill(p.col(m, K_TOP * 0.95));
  if (p.g && !p.lod) {
    p.begin_();
    p.m(a[0], a[1], z + rise);
    p.l(b[0], b[1], z + rise);
    p.l(u1, v1, z);
    p.stroke(p.col(m, 1.3, 0.7), 0.5);
  }
}

/** Barrel-vault (arched hangar) roof along u ('u') or v ('v') on a box top at z. */
export function arch(p: Painter, u0: number, v0: number, u1: number, v1: number, z: number, rise: number, m: Mat, axis: 'u' | 'v' = 'u') {
  const steps = p.lod ? 4 : 8;
  const g = p.g;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI;
    const a1 = ((i + 1) / steps) * Math.PI;
    const t0 = (1 - Math.cos(a0)) / 2;
    const t1 = (1 - Math.cos(a1)) / 2;
    const h0 = Math.sin(a0) * rise;
    const h1 = Math.sin(a1) * rise;
    p.begin_();
    if (axis === 'u') p.quad(u0, v0 + (v1 - v0) * t0, z + h0, u1, v0 + (v1 - v0) * t0, z + h0, u1, v0 + (v1 - v0) * t1, z + h1, u0, v0 + (v1 - v0) * t1, z + h1);
    else p.quad(u0 + (u1 - u0) * t0, v0, z + h0, u0 + (u1 - u0) * t0, v1, z + h0, u0 + (u1 - u0) * t1, v1, z + h1, u0 + (u1 - u0) * t1, v0, z + h1);
    p.fill(p.col(m, K_TOP * (0.78 + 0.32 * (i / steps))));
  }
  // End wall (the visible gable end).
  if (!g) return;
  p.begin_();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI;
    const t = (1 - Math.cos(a)) / 2;
    const h = Math.sin(a) * rise;
    if (axis === 'u') {
      if (i === 0) p.m(u1, v0, z);
      else p.l(u1, v0 + (v1 - v0) * t, z + h);
    } else if (i === 0) p.m(u0, v1, z);
    else p.l(u0 + (u1 - u0) * t, v1, z + h);
  }
  g.closePath();
  p.fill(p.col(m, axis === 'u' ? K_RIGHT : K_LEFT));
  if (!p.lod) {
    p.begin_();
    for (let k = 1; k < 5; k++) {
      const t = k / 5;
      if (axis === 'u') {
        p.m(u0 + (u1 - u0) * t, v0, z);
        p.l(u0 + (u1 - u0) * t, (v0 + v1) / 2, z + rise);
        p.l(u0 + (u1 - u0) * t, v1, z);
      } else {
        p.m(u0, v0 + (v1 - v0) * t, z);
        p.l((u0 + u1) / 2, v0 + (v1 - v0) * t, z + rise);
        p.l(u1, v0 + (v1 - v0) * t, z);
      }
    }
    p.stroke(p.col(m, 0.7, 0.6), 0.45);
  }
}

/** A thin vertical pole from z0 to z1. */
export function pole(p: Painter, u: number, v: number, z0: number, z1: number, m: Mat, w = 0.6) {
  p.begin_();
  p.m(u, v, z0);
  p.l(u, v, z1);
  p.stroke(p.col(m, 0.8), p.lod ? w * 1.4 : w);
}

/** A small flag or pennant on a pole top (static; the faction signature stirs it live). */
export function flag(p: Painter, u: number, v: number, z: number, c: RGB, len = 7, h = 4) {
  pole(p, u, v, z, z + h + 6, mat([170, 170, 180]), 0.5);
  const g = p.g;
  if (!g) {
    p.track(p.X(u, v) + len, p.Y(u, v, z + h + 6) - 2);
    return;
  }
  const x = p.X(u, v);
  const y = p.Y(u, v, z + h + 6);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + len, y + h * 0.4);
  g.lineTo(x, y + h);
  g.closePath();
  g.fillStyle = css(p.emissive(c, 0.2));
  g.fill();
  p.track(x + len, y);
}

/** A string of lamps hanging between two 3D points with a sag. */
export function lampString(p: Painter, a: [number, number, number], b: [number, number, number], count: number, c: RGB | RGB[], sag = 4, size = 7) {
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const s = Math.sin(t * Math.PI) * sag;
    const col = Array.isArray(c[0]) ? (c as RGB[])[i % (c as RGB[]).length] : (c as RGB);
    p.lamp(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - s, col, size);
  }
  if (p.g && !p.lod) {
    p.begin_();
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s = Math.sin(t * Math.PI) * sag;
      const u = a[0] + (b[0] - a[0]) * t;
      const v = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t - s;
      if (i === 0) p.m(u, v, z);
      else p.l(u, v, z);
    }
    p.stroke(p.col(mat([40, 40, 46], [8, 8, 12]), 1, 0.7), 0.35);
  }
}

/** A diamond sail (Kites): four corners around a centre on a mast, facing the viewer. */
export function sail(p: Painter, u: number, v: number, z: number, w: number, h: number, c: Mat, glow: RGB | null = null) {
  p.begin_();
  p.m(u - w / 2, v + w / 2, z);
  p.l(u, v, z + h / 2);
  p.l(u + w / 2, v - w / 2, z);
  p.l(u, v, z - h / 2);
  p.g?.closePath();
  p.fill(p.col(c, 1.05, 0.92));
  if (glow && p.glowA() > 0.05) p.glow(u, v, z, glow, 26 * w * 4, p.glowA() * 0.35);
  if (p.g && !p.lod) {
    p.begin_();
    p.m(u - w / 2, v + w / 2, z);
    p.l(u + w / 2, v - w / 2, z);
    p.m(u, v, z + h / 2);
    p.l(u, v, z - h / 2);
    p.stroke(p.col(mat([60, 60, 70]), 1, 0.6), 0.35);
  }
}

/** An upturned boat hull roof (Undertow): a keel ridge along u over a box top at z. */
export function hull(p: Painter, u0: number, v0: number, u1: number, v1: number, z: number, rise: number, m: Mat) {
  const vm = (v0 + v1) / 2;
  const bow = (u1 - u0) * 0.18;
  // Left (+v) face of the hull.
  p.begin_();
  p.m(u0 + bow, v1, z);
  p.l(u1 - bow, v1, z);
  p.l(u1, vm, z + rise * 0.7);
  p.l(u1 - bow * 0.5, vm, z + rise);
  p.l(u0 + bow * 0.5, vm, z + rise);
  p.l(u0, vm, z + rise * 0.7);
  p.g?.closePath();
  p.fill(p.col(m, K_TOP * 0.92));
  // Bow end (+u).
  p.begin_();
  p.m(u1 - bow, v1, z);
  p.l(u1, vm, z + rise * 0.7);
  p.l(u1 - bow, v0, z);
  p.g?.closePath();
  p.fill(p.col(m, K_RIGHT));
  if (p.g && !p.lod) {
    // Planks.
    p.begin_();
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      p.m(u0 + bow * (1 - t) + 0.02, v1 - (v1 - vm) * t, z + rise * 0.8 * t);
      p.l(u1 - bow * (1 - t) - 0.02, v1 - (v1 - vm) * t, z + rise * 0.8 * t);
    }
    p.stroke(p.col(m, 0.7, 0.6), 0.4);
    p.begin_();
    p.m(u0 + bow * 0.5, vm, z + rise);
    p.l(u1 - bow * 0.5, vm, z + rise);
    p.stroke(p.col(m, 1.3, 0.8), 0.6);
  }
}

/** A clock face on a +v (left) wall plane at (u, v), centre height z, radius r px (static hands at ten past ten). */
export function clockFace(p: Painter, u: number, v: number, z: number, r: number, face: Mat, rim: RGB) {
  const g = p.g;
  const x = p.X(u, v);
  const y = p.Y(u, v, z);
  p.track(x - r, y - r);
  p.track(x + r, y + r);
  if (!g) return;
  g.beginPath();
  g.ellipse(x, y, r * 0.86, r, -0.46, 0, Math.PI * 2);
  g.fillStyle = css(mix(p.rgb(face, 1.1), [255, 236, 190], 0.55 * p.glowA()));
  g.fill();
  g.strokeStyle = css(p.emissive(rim, 0.3));
  g.lineWidth = 0.7;
  g.stroke();
  if (p.lod) return;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - r * 0.45, y - r * 0.35);
  g.moveTo(x, y);
  g.lineTo(x + r * 0.55, y - r * 0.55);
  g.strokeStyle = css(shade(p.rgb(face, 0.4), 0.6));
  g.lineWidth = 0.6;
  g.stroke();
}

/** A pointed lantern roof with an open lit cage (Tuning): square cage, then a pyramid. */
export function lanternRoof(p: Painter, cu: number, cv: number, r: number, z: number, cage: number, rise: number, m: Mat, light: RGB) {
  const u0 = cu - r;
  const u1 = cu + r;
  const v0 = cv - r;
  const v1 = cv + r;
  // Posts.
  for (const [u, v] of [
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ] as const)
    p.box(u - 0.025, v - 0.025, u + 0.025, v + 0.025, z, z + cage, m, { uplight: false });
  p.glow(cu, cv, z + cage * 0.5, light, 40 * r * 2 + 12, p.glowA() * 0.9);
  p.lamp(cu, cv, z + cage * 0.5, light, 12);
  p.box(u0 - 0.03, v0 - 0.03, u1 + 0.03, v1 + 0.03, z + cage, z + cage + 1.5, m, { uplight: false });
  pyramid(p, u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, z + cage + 1.5, rise, m);
}

/** A copper coil wrapped around a cylinder (Tuning): bands, lit softly at night. */
export function coil(p: Painter, cu: number, cv: number, r: number, z0: number, z1: number, copper: RGB, glow: RGB) {
  const g = p.g;
  const cx = p.X(cu, cv);
  const cy = p.Y(cu, cv, 0);
  const rx = r * HALF_W * Math.SQRT2 * 1.06;
  p.track(cx - rx, cy - z1);
  p.track(cx + rx, cy - z0);
  if (!g) return;
  const turns = Math.max(3, Math.round((z1 - z0) / 7));
  g.lineWidth = p.lod ? 1.6 : 1.1;
  g.strokeStyle = css(p.rgb(mat(copper), 1.05));
  for (let i = 0; i < turns; i++) {
    const z = z0 + ((i + 0.5) * (z1 - z0)) / turns;
    g.beginPath();
    g.ellipse(cx, cy - z, rx, rx / 2, -0.12, 0.05, Math.PI - 0.05);
    g.stroke();
  }
  const ga = p.glowA();
  if (ga > 0.05 && !p.lod) {
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = css(glow, 0.25 * ga);
    g.lineWidth = 3;
    for (let i = 0; i < turns; i += 2) {
      const z = z0 + ((i + 0.5) * (z1 - z0)) / turns;
      g.beginPath();
      g.ellipse(cx, cy - z, rx, rx / 2, -0.12, 0.05, Math.PI - 0.05);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
}

/** Open lattice of a tower frame (scaffold, gantry core) on (u0,v0)-(u1,v1) from z0 to z1. */
export function lattice(p: Painter, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, m: Mat, step = 8, w = 0.6) {
  p.begin_();
  for (const [u, v] of [
    [u1, v0],
    [u1, v1],
    [u0, v1],
    [u0, v0],
  ] as const) {
    p.m(u, v, z0);
    p.l(u, v, z1);
  }
  for (let z = z0; z <= z1 + 0.01; z += step) {
    p.m(u0, v1, z);
    p.l(u1, v1, z);
    p.l(u1, v0, z);
  }
  for (let z = z0; z + step <= z1 + 0.01; z += step) {
    p.m(u0, v1, z);
    p.l(u1, v1, z + step);
    p.m(u1, v1, z);
    p.l(u1, v0, z + step);
  }
  p.stroke(p.col(m, 0.85), p.lod ? w * 1.5 : w);
}

/** A tower crane on a mast at (u, v) from z0, jib along +u of length `jib`, cab and hook. */
export function crane(p: Painter, u: number, v: number, z0: number, h: number, jib: number, m: Mat) {
  const top = z0 + h;
  p.begin_();
  p.m(u, v, z0);
  p.l(u, v, top);
  p.m(u - jib * 0.3, v, top);
  p.l(u + jib, v, top);
  p.m(u + jib * 0.7, v, top);
  p.l(u + jib * 0.7, v, top - h * 0.45);
  p.stroke(p.col(m, 0.95), p.lod ? 1.4 : 0.9);
  p.box(u - 0.04, v - 0.03, u + 0.06, v + 0.03, top - 4, top, m, { uplight: false });
  p.blinker(u, v, top + 1, [255, 59, 92], 1.4, 12);
}

/** A box with the window spec and a lit neon outline on its two front top edges. */
export function litBox(p: Painter, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, m: Mat, win: WinSpec | undefined, top: Mat, trim?: RGB) {
  p.box(u0, v0, u1, v1, z0, z1, m, { win, top, trim });
}

/** A colonnade of thin columns along the +v (left) face edge (Board). */
export function colonnade(p: Painter, u0: number, u1: number, v: number, z0: number, z1: number, n: number, m: Mat) {
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const u = u0 + (u1 - u0) * t;
    p.box(u - 0.025, v, u + 0.025, v + 0.05, z0, z1, m, { uplight: false });
  }
  p.box(u0, v, u1, v + 0.06, z1, z1 + 2, m, { uplight: false });
}

/** Ground disc rings (Tuning concentric ground rings) on z. */
export function groundRings(p: Painter, cu: number, cv: number, r: number, z: number, c: RGB) {
  p.neonRing(cu, cv, r, z, c, 0.8, true);
  p.neonRing(cu, cv, r * 0.66, z, c, 0.6, true);
}

/** Screen-space dark disc (e.g. a sphere's screen) helper: an ellipse filled at (u, v, z). */
export function disc(p: Painter, u: number, v: number, z: number, rx: number, ry: number, fill: string) {
  const x = p.X(u, v);
  const y = p.Y(u, v, z);
  p.track(x - rx, y - ry);
  p.track(x + rx, y + ry);
  const g = p.g;
  if (!g) return;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

/** A sphere (ball) centred at (u, v, z), radius r tiles, shaded. */
export function ball(p: Painter, u: number, v: number, z: number, r: number, m: Mat) {
  const x = p.X(u, v);
  const y = p.Y(u, v, z);
  const R = r * HALF_W * Math.SQRT2;
  p.track(x - R, y - R);
  p.track(x + R, y + R);
  if (y - R < y) p.reach(z + R);
  const g = p.g;
  if (!g) return;
  const grad = g.createRadialGradient(x + R * 0.35, y - R * 0.4, R * 0.08, x, y, R * 1.05);
  grad.addColorStop(0, p.col(m, 1.35));
  grad.addColorStop(0.55, p.col(m, 0.95));
  grad.addColorStop(1, p.col(m, 0.55));
  g.beginPath();
  g.ellipse(x, y, R, R, 0, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
}

/** Projected half-height of a tile unit (handy for screen-space parts). */
export const TILE_H = HALF_H;
export const TILE_W = HALF_W;
