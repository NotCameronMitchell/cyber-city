// ─────────────────────────────────────────────────────────────────────────────
// The City map's atlas (docs/MEGACITY.md §3.9, WP-3): one cached impostor per
// slot, drawn only while the camera is on the City map (camera.mapView).
//
//  * The atlas scale is chosen when the City map opens (districts.ts
//    atlasScale): ≤ 0.1 device px per world px, capped so the R² impostors fit
//    the atlas budget (4 MB on a handheld device or in lower detail, 8 MB on a
//    PC). There are no intermediate zooms, so it is never shown magnified past
//    what it was painted for (beyond the snap's own 0.3 s).
//  * Owned slots: a ground colour per tile, a shaded prism per developed tile
//    (height by level), prisms for buildings, lit-window dots in 3 night
//    buckets. Locked slots: fog terrain (water, land, terrace tints), the kind's
//    icon at blit time, and the Sunk's old pump hall as a dark hall.
//  * Repainted progressively in diagonal row bands within ≤ 2 ms a frame, into
//    a back buffer that swaps in when the slot is done; only slots marked dirty
//    (a 'tiles' event, an annex, a night bucket change) repaint, only while the
//    City map is open. Frame cost: R² blits plus labels.
//  * styleVignette(kind): the annex sheet's small night vignette, once per kind.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS, DISTRICTS, ZONES } from '../game/config';
import { pumpHallSite } from '../game/districts/annex';
import { slotRect } from '../game/districts/slots';
import { heightOf } from '../game/heights';
import { Terrain, ZoneType, type DistrictKind, type SlotId } from '../game/types';
import type { World } from '../game/world';
import { HALF_H, HALF_W, type Camera } from './camera';
import { candidateSlots, slotNames } from './districts';
import { css, hexToRgb, mix, shade, type RGB } from './palette';

/** Height headroom above a slot's diamond (world px): the tallest prisms. */
const HEAD = 300;
/** Diagonals painted per band (a slot has 127). */
const BAND = 12;
/** Repaint budget per frame (§3.9: ≤ 2 ms). */
const PAINT_MS = 2;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const ZONE_RGB: RGB[] = [[120, 120, 130], hexToRgb(ZONES.res.color), hexToRgb(ZONES.com.color), hexToRgb(ZONES.ind.color)];
const LEVEL_H = [0, 22, 56, 132];

interface Impostor {
  canvas: HTMLCanvasElement | null;
  /** Painting: the back buffer and the next band. */
  back: HTMLCanvasElement | null;
  band: number;
  /** Scale and night bucket it was painted at; dirty = must repaint. */
  scale: number;
  night: number;
  owned: boolean;
  dirty: boolean;
}

/** The atlas night bucket (3: day, dusk, night). */
export function atlasNight(night: number): number {
  return night < 0.3 ? 0 : night < 0.7 ? 1 : 2;
}

export class Atlas {
  private slots: Impostor[] = [];
  private scale = 0;
  private worldN = 0;
  private region = 0;
  /** Diagnostics and tests: impostor bytes held, bands painted this frame. */
  bytes = 0;
  painted = 0;

  /** A world swap: drop every impostor. */
  reset(): void {
    for (const s of this.slots) this.free(s);
    this.slots = [];
    this.bytes = 0;
    this.scale = 0;
  }

  /** The City map opens (§3.9): choose the scale; a changed scale repaints every slot, otherwise the dirty ones. */
  open(world: World, scale: number): void {
    const R = world.region;
    if (R !== this.region || world.N !== this.worldN) {
      this.reset();
      this.region = R;
      this.worldN = world.N;
    }
    if (Math.abs(scale - this.scale) > 1e-6) {
      this.scale = scale;
      for (const s of this.slots) s.dirty = true;
    }
    while (this.slots.length < R * R) this.slots.push({ canvas: null, back: null, band: 0, scale: 0, night: -1, owned: false, dirty: true });
  }

  /** Tiles changed in `r` (or an annex): the slots it touches repaint the next time the map is open. */
  invalidate(world: World, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const R = world.region;
    if (R !== this.region) return;
    const sx0 = Math.max(0, r.x0 >> 6);
    const sy0 = Math.max(0, r.y0 >> 6);
    const sx1 = Math.min(R - 1, r.x1 >> 6);
    const sy1 = Math.min(R - 1, r.y1 >> 6);
    for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) if (this.slots[sy * R + sx]) this.slots[sy * R + sx].dirty = true;
  }

  get atlasScale(): number {
    return this.scale;
  }

  /** Slots fully painted at the current scale (tests). */
  get ready(): number {
    let n = 0;
    for (const s of this.slots) if (s.canvas && s.scale === this.scale && !s.dirty) n++;
    return n;
  }

  private free(s: Impostor) {
    for (const c of [s.canvas, s.back]) if (c) c.width = c.height = 0;
    s.canvas = null;
    s.back = null;
  }

  private size(): { w: number; h: number } {
    const s = this.scale;
    return { w: Math.ceil(64 * 64 * s) + 2, h: Math.ceil((64 * 32 + HEAD) * s) + 2 };
  }

  /** Paint dirty slots, nearest the view centre first, within PAINT_MS. */
  private paint(world: World, cam: Camera, night: number) {
    const nb = atlasNight(night);
    const t0 = now();
    this.painted = 0;
    const centre = cam.screenToWorld(cam.width / 2, cam.height / 2);
    const order = this.slots
      .map((_, k) => k)
      .filter((k) => {
        const s = this.slots[k];
        const owned = world.slotOwned[k] === 1;
        if (s.owned !== owned) s.dirty = true;
        if (s.night !== nb && owned) s.dirty = true;
        return s.dirty || s.back !== null || !s.canvas || s.scale !== this.scale;
      })
      .sort((a, b) => dist(world, a, centre) - dist(world, b, centre));
    for (const k of order) {
      const s = this.slots[k];
      while (now() - t0 < PAINT_MS) {
        if (this.paintBand(world, k, s, nb)) break;
      }
      if (now() - t0 >= PAINT_MS) break;
    }
  }

  /** Paint the next band of slot k into its back buffer; true when the slot is done (swapped in). */
  private paintBand(world: World, k: SlotId, s: Impostor, nb: number): boolean {
    const { w, h } = this.size();
    if (!s.back) {
      if (typeof document === 'undefined') return true;
      s.back = document.createElement('canvas');
      s.back.width = w;
      s.back.height = h;
      s.band = 0;
      s.owned = world.slotOwned[k] === 1;
      s.night = nb;
      s.dirty = false;
      this.bytes += w * h * 4;
    }
    const g = s.back.getContext('2d');
    if (!g) return true;
    const r = slotRect(world, k);
    const sc = this.scale;
    // Slot-local canvas: tile (lx, ly) top corner at ((lx − ly) · 32 + 2048, (lx + ly) · 16 + HEAD) · s.
    const P = (lx: number, ly: number, z: number): [number, number] => [((lx - ly) * HALF_W + 64 * HALF_W) * sc + 1, ((lx + ly) * HALF_H + HEAD - z) * sc + 1];
    const d0 = s.band * BAND;
    const d1 = Math.min(126, d0 + BAND - 1);
    const N = world.N;
    const owned = s.owned;
    const pal = atlasPal(nb);
    for (let dg = d0; dg <= d1; dg++) {
      const la = Math.max(0, dg - 63);
      const lb = Math.min(63, dg);
      for (let lx = la; lx <= lb; lx++) {
        const ly = dg - lx;
        const x = r.x0 + lx;
        const y = r.y0 + ly;
        const t = world.tiles[y * N + x];
        let col: string;
        if (!owned) col = t.terrain === Terrain.Water ? pal.fogWater : pal.fogLand[Math.min(3, t.elev)];
        else if (t.terrain === Terrain.Water) col = t.road ? pal.road : pal.water;
        else if (t.road) col = pal.road;
        else if (t.buildingId >= 0) col = pal.pad;
        else if (t.zone !== ZoneType.None) col = t.level === 0 ? pal.lot[t.zone] : pal.pad;
        else col = pal.land[Math.min(3, t.elev)];
        diamond(g, P, lx, ly, 0, 1, col);
        if (!owned) continue;
        // Prisms: developed zone tiles by level; a building from its front corner (drawn once, over its footprint).
        if (t.buildingId >= 0) {
          const b = world.buildings.get(t.buildingId);
          if (b && b.x + b.size - 1 === x && b.y + b.size - 1 === y) {
            const def = BUILDINGS[b.type];
            const hz = Math.max(16, Math.min(HEAD - 20, heightOf(world, x, y) || def?.height || 40));
            const c = def ? hexToRgb(def.color) : [140, 140, 150];
            prism(g, P, b.x - r.x0, b.y - r.y0, b.size, hz, c as RGB, nb, pal);
          }
        } else if (t.zone !== ZoneType.None && t.level > 0) {
          const c = t.abandoned ? ([70, 66, 74] as RGB) : ZONE_RGB[t.zone];
          prism(g, P, lx, ly, 1, LEVEL_H[t.level], c, nb, pal, !t.abandoned && t.level >= 2);
        }
      }
    }
    // The Sunk's old pump hall in the fog (§3.7): a dark hall on the water.
    if (!owned && s.band === 0 && world.districts.kinds[k] === 'sunk') {
      const hs = pumpHallSite(world, k);
      if (hs) prism(g, P, hs.x - r.x0, hs.y - r.y0, 3, 26, [26, 24, 34], 0, pal);
    }
    s.band++;
    this.painted++;
    if (d1 < 126) return false;
    // Done: swap in.
    if (s.canvas) {
      this.bytes -= s.canvas.width * s.canvas.height * 4;
      s.canvas.width = s.canvas.height = 0;
    }
    s.canvas = s.back;
    s.back = null;
    s.scale = this.scale;
    return true;
  }

  /**
   * Draw the City map (§3.9): a dark board, the region's diamond, every impostor that is ready (a flat diamond for one
   * that is still painting), the slot grid and the labels. Expects the identity × DPR transform (CSS px) on entry;
   * leaves it there. `time` animates the candidates' rims.
   */
  draw(ctx: CanvasRenderingContext2D, world: World, cam: Camera, dpr: number, night: number, time: number): void {
    this.paint(world, cam, night);
    const R = world.region;
    const z = cam.zoom;
    const wa = dpr * z;
    const we = (cam.width / 2 - cam.x * z) * dpr;
    const wf = (cam.height / 2 - cam.y * z) * dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css(mix([18, 14, 34], [6, 4, 14], night));
    ctx.fillRect(0, 0, cam.width, cam.height);
    // The region's diamond (world space).
    ctx.setTransform(wa, 0, 0, wa, we, wf);
    const N = world.N;
    ctx.fillStyle = css(mix([38, 32, 64], [16, 12, 30], night));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(N * HALF_W, N * HALF_H);
    ctx.lineTo(0, N * 2 * HALF_H);
    ctx.lineTo(-N * HALF_W, N * HALF_H);
    ctx.closePath();
    ctx.fill();
    const cands = new Set(candidateSlots(world));
    for (let k = 0; k < R * R; k++) {
      const r = slotRect(world, k);
      const s = this.slots[k];
      const ox = (r.x0 - r.y0) * HALF_W - 64 * HALF_W;
      const oy = (r.x0 + r.y0) * HALF_H - HEAD;
      if (s?.canvas && s.scale > 0) ctx.drawImage(s.canvas, ox - 1 / s.scale, oy - 1 / s.scale, s.canvas.width / s.scale, s.canvas.height / s.scale);
      else {
        ctx.fillStyle = world.slotOwned[k] ? css([70, 74, 92]) : css([48, 36, 78]);
        slotDiamond(ctx, r.x0, r.y0);
        ctx.fill();
      }
    }
    // Slot grid and states.
    const px = 1 / z;
    for (let k = 0; k < R * R; k++) {
      const r = slotRect(world, k);
      const owned = world.slotOwned[k] === 1;
      const cand = cands.has(k);
      slotDiamond(ctx, r.x0, r.y0);
      if (!owned) {
        ctx.fillStyle = css([40, 26, 70], 0.28);
        ctx.fill();
      }
      ctx.lineWidth = (owned ? 1.4 : cand ? 2 : 1) * px;
      ctx.strokeStyle = owned ? css([236, 228, 255], 0.55) : cand ? css([255, 216, 77], 0.6 + 0.3 * Math.sin(time * 2.6)) : css([143, 123, 255], 0.45);
      ctx.stroke();
    }
    // Labels and icons (screen space).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const big = Math.min(13, Math.max(9, 64 * HALF_W * z * 0.11));
    for (let k = 0; k < R * R; k++) {
      const r = slotRect(world, k);
      const c = cam.worldToScreen((r.x0 + 32 - (r.y0 + 32)) * HALF_W, (r.x0 + 32 + r.y0 + 32) * HALF_H);
      const owned = world.slotOwned[k] === 1;
      const kind = world.districts.kinds[k];
      const { name, short } = slotNames(world, k);
      const label = 64 * HALF_W * 2 * z > 150 ? name : short;
      if (!owned) drawKindIcon(ctx, kind, c.x, c.y - big * 1.3, big * 1.1, cands.has(k));
      ctx.font = `${owned ? 700 : 600} ${big}px system-ui, sans-serif`;
      const tw = ctx.measureText ? ctx.measureText(label).width : label.length * big * 0.55;
      ctx.fillStyle = css([10, 6, 22], 0.6);
      ctx.fillRect(c.x - tw / 2 - 4, c.y - big * 0.7, tw + 8, big * 1.4);
      ctx.fillStyle = owned ? css([240, 236, 255]) : cands.has(k) ? css([255, 226, 140]) : css([190, 180, 230], 0.85);
      ctx.fillText(label, c.x, c.y);
    }
    ctx.restore();
  }
}

function dist(world: World, k: SlotId, c: { x: number; y: number }): number {
  const r = slotRect(world, k);
  const mx = r.x0 + 32;
  const my = r.y0 + 32;
  return Math.abs((mx - my) * HALF_W - c.x) + Math.abs((mx + my) * HALF_H - c.y);
}

function slotDiamond(ctx: CanvasRenderingContext2D, x0: number, y0: number) {
  const P = (x: number, y: number): [number, number] => [(x - y) * HALF_W, (x + y) * HALF_H];
  ctx.beginPath();
  let p = P(x0, y0);
  ctx.moveTo(p[0], p[1]);
  p = P(x0 + 64, y0);
  ctx.lineTo(p[0], p[1]);
  p = P(x0 + 64, y0 + 64);
  ctx.lineTo(p[0], p[1]);
  p = P(x0, y0 + 64);
  ctx.lineTo(p[0], p[1]);
  ctx.closePath();
}

type Proj = (lx: number, ly: number, z: number) => [number, number];

function diamond(g: CanvasRenderingContext2D, P: Proj, lx: number, ly: number, z: number, size: number, col: string) {
  const a = P(lx, ly, z);
  const b = P(lx + size, ly, z);
  const c = P(lx + size, ly + size, z);
  const d = P(lx, ly + size, z);
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(a[0], a[1] - 0.3);
  g.lineTo(b[0] + 0.3, b[1]);
  g.lineTo(c[0], c[1] + 0.3);
  g.lineTo(d[0] - 0.3, d[1]);
  g.closePath();
  g.fill();
}

/** A shaded prism of `size` tiles and height `hz` world px: left face dark, right face mid, roof light, lit dots at night. */
function prism(g: CanvasRenderingContext2D, P: Proj, lx: number, ly: number, size: number, hz: number, c: RGB, nb: number, pal: AtlasPal, windows = false) {
  const i = size === 1 ? 0.14 : 0.08;
  const x0 = lx + i;
  const y0 = ly + i;
  const x1 = lx + size - i;
  const y1 = ly + size - i;
  const dark = nb === 2 ? 0.32 : nb === 1 ? 0.45 : 0.6;
  const k = nb === 2 ? 0.45 : nb === 1 ? 0.62 : 0.85;
  const B = [P(x1, y0, 0), P(x1, y1, 0), P(x0, y1, 0)];
  const T = [P(x0, y0, hz), P(x1, y0, hz), P(x1, y1, hz), P(x0, y1, hz)];
  // Left face (+y side) then right face (+x side).
  g.fillStyle = css(shade(c, dark * 0.8));
  g.beginPath();
  g.moveTo(T[3][0], T[3][1]);
  g.lineTo(T[2][0], T[2][1]);
  g.lineTo(B[1][0], B[1][1]);
  g.lineTo(B[2][0], B[2][1]);
  g.closePath();
  g.fill();
  g.fillStyle = css(shade(c, dark));
  g.beginPath();
  g.moveTo(T[2][0], T[2][1]);
  g.lineTo(T[1][0], T[1][1]);
  g.lineTo(B[0][0], B[0][1]);
  g.lineTo(B[1][0], B[1][1]);
  g.closePath();
  g.fill();
  g.fillStyle = css(shade(c, k));
  g.beginPath();
  g.moveTo(T[0][0], T[0][1]);
  g.lineTo(T[1][0], T[1][1]);
  g.lineTo(T[2][0], T[2][1]);
  g.lineTo(T[3][0], T[3][1]);
  g.closePath();
  g.fill();
  if (windows && nb > 0) {
    // Lit-window dots on the right face, more at night.
    g.fillStyle = pal.win;
    const rows = Math.max(1, Math.floor(hz / 28));
    for (let r = 0; r < rows; r++) {
      const zz = hz * (0.2 + (0.7 * r) / rows);
      const p = P(x1, y0 + (y1 - y0) * 0.5, zz);
      const sz = Math.max(0.8, 0.9 * (nb === 2 ? 1.2 : 1));
      g.fillRect(p[0] - sz / 2, p[1] - sz / 2, sz, sz);
    }
  }
}

interface AtlasPal {
  water: string;
  road: string;
  pad: string;
  lot: string[];
  land: string[];
  fogLand: string[];
  fogWater: string;
  win: string;
}

const pals = new Map<number, AtlasPal>();
function atlasPal(nb: number): AtlasPal {
  let p = pals.get(nb);
  if (p) return p;
  const n = nb / 2;
  const land: RGB = mix([78, 82, 96], [24, 22, 40], n);
  const fog: RGB = [40, 26, 70];
  p = {
    water: css(mix([30, 70, 96], [8, 22, 44], n)),
    road: css(mix([150, 152, 168], [90, 84, 140], n)),
    pad: css(mix([92, 94, 108], [30, 28, 48], n)),
    lot: ZONE_RGB.map((c) => css(mix(mix(land, c, 0.3), [0, 0, 0], 0.1))),
    land: [0, 1, 2, 3].map((e) => css(mix(land, [255, 244, 220], 0.06 * e))),
    fogLand: [0, 1, 2, 3].map((e) => css(mix(shade(mix(land, [255, 244, 220], 0.09 * e), 0.75), fog, 0.3))),
    fogWater: css(mix(shade(mix([30, 70, 96], [8, 22, 44], n), 0.6), [20, 14, 44], 0.3)),
    win: css([255, 220, 150], nb === 2 ? 0.95 : 0.6),
  };
  pals.set(nb, p);
  return p;
}

/** A small icon per district kind for locked slots (screen space, CSS px). */
export function drawKindIcon(ctx: CanvasRenderingContext2D, kind: DistrictKind, x: number, y: number, s: number, candidate: boolean): void {
  const col = hexToRgb(DISTRICTS[kind]?.color ?? '#8f7bff');
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = candidate ? 1 : 0.75;
  ctx.fillStyle = css([12, 8, 26], 0.7);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = css(col);
  ctx.fillStyle = css(col);
  ctx.lineWidth = Math.max(1, s * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const u = s * 0.42;
  ctx.beginPath();
  switch (kind) {
    case 'shoals': // waves
      for (let k = -1; k <= 1; k += 2) {
        ctx.moveTo(-u, k * u * 0.4);
        ctx.quadraticCurveTo(-u * 0.5, k * u * 0.4 - u * 0.4, 0, k * u * 0.4);
        ctx.quadraticCurveTo(u * 0.5, k * u * 0.4 + u * 0.4, u, k * u * 0.4);
      }
      break;
    case 'sunk': // a broken arch over water
      ctx.moveTo(-u, u * 0.3);
      ctx.lineTo(-u, -u * 0.2);
      ctx.quadraticCurveTo(0, -u * 1.1, u * 0.6, -u * 0.4);
      ctx.moveTo(-u, u * 0.7);
      ctx.lineTo(u, u * 0.7);
      break;
    case 'flats': // a chimney and a shed
      ctx.moveTo(-u, u);
      ctx.lineTo(-u, 0);
      ctx.lineTo(0, -u * 0.4);
      ctx.lineTo(0, u);
      ctx.moveTo(u * 0.5, u);
      ctx.lineTo(u * 0.5, -u);
      break;
    case 'terraces': // steps
      ctx.moveTo(-u, u);
      ctx.lineTo(-u, u * 0.35);
      ctx.lineTo(-u * 0.3, u * 0.35);
      ctx.lineTo(-u * 0.3, -u * 0.3);
      ctx.lineTo(u * 0.4, -u * 0.3);
      ctx.lineTo(u * 0.4, -u);
      ctx.lineTo(u, -u);
      break;
    case 'reedmere': // reeds
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(k * u * 0.5, u);
        ctx.quadraticCurveTo(k * u * 0.5 + u * 0.2, 0, k * u * 0.7, -u * (k === 0 ? 1 : 0.7));
      }
      break;
    case 'skeleton': // a bare frame
      ctx.rect(-u * 0.7, -u, u * 1.4, u * 2);
      ctx.moveTo(-u * 0.7, 0);
      ctx.lineTo(u * 0.7, 0);
      ctx.moveTo(-u * 0.7, -u);
      ctx.lineTo(u * 0.7, u);
      break;
    case 'tarmac': // a plane
      ctx.moveTo(0, -u);
      ctx.lineTo(0, u);
      ctx.moveTo(-u, u * 0.1);
      ctx.lineTo(u, u * 0.1);
      ctx.moveTo(-u * 0.4, u * 0.8);
      ctx.lineTo(u * 0.4, u * 0.8);
      break;
    case 'bazaar': // a lantern
      ctx.moveTo(0, -u);
      ctx.lineTo(0, -u * 0.6);
      ctx.ellipse(0, 0, u * 0.5, u * 0.6, 0, 0, Math.PI * 2);
      break;
    default:
      ctx.arc(0, 0, u * 0.6, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The annex sheet's night vignette (§3.9, §7.2): a small night scene of one kind's district (its ground wash, three
 * blocks in its accent and lit windows), painted once per kind (and size) into a canvas the UI shows. WP-4's kit bodies
 * can replace the blocks later without changing the call.
 */
const vignettes = new Map<string, HTMLCanvasElement>();
export function styleVignette(kind: DistrictKind, w = 160, h = 96): HTMLCanvasElement | null {
  const key = `${kind}:${w}x${h}`;
  const hit = vignettes.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  const accent = hexToRgb(DISTRICTS[kind]?.color ?? '#8f7bff');
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, css([10, 6, 24]));
  sky.addColorStop(1, css(mix([30, 18, 56], accent, 0.18)));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const s = w / 160;
  const P: Proj = (lx, ly, z) => [w / 2 + (lx - ly) * 18 * s, h * 0.55 + (lx + ly) * 9 * s - z * s];
  for (let ly = -2; ly < 3; ly++) for (let lx = -2; lx < 3; lx++) diamond(g, P, lx, ly, 0, 1, css(mix([26, 24, 40], accent, 0.08)));
  const pal = atlasPal(2);
  const heights = [26, 52, 40];
  [
    [-1, 0],
    [0, -1],
    [1, 0],
  ].forEach(([lx, ly], k) => prism(g, P, lx, ly, 1, heights[k], mix([90, 86, 110], accent, 0.35 + 0.15 * k), 2, pal, true));
  vignettes.set(key, c);
  return c;
}
