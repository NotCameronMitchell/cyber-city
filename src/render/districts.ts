// ─────────────────────────────────────────────────────────────────────────────
// The world view with districts (docs/MEGACITY.md §3.9, WP-3): the rules the
// renderer, input and UI share, as pure functions of the world and the camera.
//
//   view bands      streetMinZoom by viewport and device class; the skyline
//                   view's sprite cap; lower-detail levers
//   budgets         the building sprite cache and paint budget (PC sized to
//                   the canvas), the City map atlas scale
//   annex pins      44 px "+" buttons on candidate slots' shared borders, only
//                   while a grant waits (or a purchase is affordable after an
//                   ending), at most ANNEX.maxPins, nearest the view centre
//   boundary        the dashed owned/locked border (tile-space runs)
//   district label  the name of the district under the view centre, faded in
//                   and out over 1.5 s, at most once per 20 s
//
// Pins and slot taps are pure geometry (camera.tileToScreen / screenToTile →
// slotAt), so input and UI never call into the renderer.
// ─────────────────────────────────────────────────────────────────────────────

import { ANNEX, DISTRICTS, districtPrice } from '../game/config';
import { adjacentLocked, slotNeighbours, slotRect } from '../game/districts/slots';
import { evalCond } from '../game/story/conditions';
import type { SlotId } from '../game/types';
import type { World } from '../game/world';
import { HALF_H, HALF_W, type Camera } from './camera';
import { css } from './palette';

export type DeviceKind = 'pc' | 'handheld';

/** Tiles a street view may show at its smallest zoom on a PC screen (§3.9; provisional, lowered if V1/P1 miss). */
export const STREET_TILE_CAP = 6000;
/** Street view floor on a handheld device, and in lower detail (§3.9, §3.11). */
export const STREET_MIN_HANDHELD = 0.4;
export const STREET_MIN_LOW_DETAIL = 0.5;
/** Skyline view sprite caps (§3.9): a phone, a PC on high quality, lower detail. */
export const SKYLINE_CAP = { handheld: 2600, pc: 6000, lowDetail: 1800 } as const;

/**
 * The smallest zoom of the street view (§3.9): 0.4 on a handheld device (0.5 in lower detail); on a PC the smallest
 * zoom whose screen shows ≤ 6,000 tiles (≈ W × H / (1,024 z²) CSS px), never below 0.4: 0.41 at 1280×800, 0.46 at
 * 1440×900, 0.58 at 1920×1080 (rounded to 0.01, as the spec's table).
 */
export function streetMinZoom(cssW: number, cssH: number, cls: DeviceKind, lowerDetail = false): number {
  const floor = lowerDetail ? STREET_MIN_LOW_DETAIL : STREET_MIN_HANDHELD;
  if (cls !== 'pc') return floor;
  const z = Math.sqrt((Math.max(1, cssW) * Math.max(1, cssH)) / (1024 * STREET_TILE_CAP));
  return Math.max(floor, Math.round(z * 100) / 100);
}

/** The skyline view's sprite cap per frame (§3.9): 2,600 on a phone, 6,000 on a PC on high quality, 1,800 in lower detail. */
export function skylineCap(cls: DeviceKind, quality: 'low' | 'high', lowerDetail = false): number {
  if (lowerDetail) return SKYLINE_CAP.lowDetail;
  return cls === 'pc' && quality === 'high' ? SKYLINE_CAP.pc : SKYLINE_CAP.handheld;
}

export interface SpriteLimits {
  capBytes: number;
  budgetMs: number;
}

const MB = 1024 * 1024;

/**
 * The building sprite cache and paint budget (§3.9, §6.1, §11.1): handheld 32 MB on high, 20 MB on low (and in lower
 * detail), paint 3.5 / 2 ms as today; a PC on high quality 64 MB, 96 MB from 2.5 M device pixels, paint
 * min(6, max(3, 9 − simMs)) ms (raised in a frame whose sim units left room).
 */
export function spriteLimits(cls: DeviceKind, quality: 'low' | 'high', devicePx: number, simMs: number, lowerDetail = false): SpriteLimits {
  if (quality === 'low' || lowerDetail) return { capBytes: 20 * MB, budgetMs: 2 };
  if (cls !== 'pc') return { capBytes: 32 * MB, budgetMs: 3.5 };
  return { capBytes: (devicePx >= 2_500_000 ? 96 : 64) * MB, budgetMs: Math.min(6, Math.max(3, 9 - Math.max(0, simMs))) };
}

/** The atlas memory budget (§3.9, §11.1): 4 MB on a handheld device and in lower detail, 8 MB on a PC. */
export function atlasBudgetBytes(cls: DeviceKind, lowerDetail = false): number {
  return (cls === 'pc' && !lowerDetail ? 8 : 4) * MB;
}

/** Device px of one slot impostor at atlas scale s (the slot's diamond plus building headroom, 4 bytes a px). */
export function impostorBytes(s: number): number {
  const w = Math.ceil(64 * 64 * s) + 2;
  const h = Math.ceil((64 * 32 + 300) * s) + 2;
  return w * h * 4;
}

/**
 * The atlas scale (§3.9), chosen when the City map opens: s = min(0.1, fitZoom × DPR × headroom), headroom 2 for a
 * 5×5 region on a handheld device (its City map zooms to 2× fit) and 1 otherwise, capped so R² impostors fit the
 * atlas budget (25 slots: ≤ 0.064 on a handheld device, ≤ 0.09 on a PC).
 */
export function atlasScale(fitZoom: number, dpr: number, region: number, cls: DeviceKind, lowerDetail = false): number {
  const headroom = region === 5 && cls === 'handheld' ? 2 : 1;
  let s = Math.min(0.1, fitZoom * dpr * headroom);
  const slots = region * region;
  const budget = atlasBudgetBytes(cls, lowerDetail);
  const cap = region === 5 ? (cls === 'pc' && !lowerDetail ? 0.09 : 0.064) : 0.1;
  s = Math.min(s, cap);
  while (s > 0.01 && slots * impostorBytes(s) > budget) s *= 0.97;
  return Math.max(0.01, s);
}

// ── Annex pins (§3.9) ─────────────────────────────────────────────────────

export interface AnnexPin {
  slot: SlotId;
  /** Centre in CSS px. */
  x: number;
  y: number;
  /** Radius in CSS px (44 px button). */
  r: number;
  /** The district's short name under the "+". */
  label: string;
  /** The shared border's midpoint in tiles (a tile corner). */
  tx: number;
  ty: number;
}

/** Pin radius: a 44 px round button (§3.9, the phone's tap target). */
export const PIN_R = 22;
/**
 * The HUD's least cover (CSS px) while the UI has not set camera insets yet: the top bar with the ticker and the
 * bottom dock. Pins and the district label keep out of it; real insets (WP-5, WP-9) win when larger.
 */
export const HUD_TOP = 80;
export const HUD_BOTTOM = 130;

/** The world's funds and story state are on the world; districts can be bought after an ending (§3.8). */
function pinsWanted(world: World): boolean {
  const d = world.districts;
  if (d.grants > 0) return true;
  return !!world.story.ending && world.funds >= districtPrice(d.owned.length);
}

/** Candidates (§3.8): locked slots 4-adjacent to an owned slot whose `opensWhen` holds. */
export function candidateSlots(world: World): SlotId[] {
  if (world.region === 1) return [];
  return adjacentLocked(world).filter((s) => {
    const def = DISTRICTS[world.districts.kinds[s]];
    return !def?.opensWhen || evalCond(world, def.opensWhen);
  });
}

/** The display name of a slot's district (a 5×5 repeat by its variant's name) and its short name. */
export function slotNames(world: World, s: SlotId): { name: string; short: string } {
  const def = DISTRICTS[world.districts.kinds[s]];
  const v = world.variantOf(s);
  const vd = v > 0 ? def?.variants[v - 1] : undefined;
  const name = vd?.name ?? def?.name ?? 'District';
  return { name, short: vd?.short ?? def?.short ?? name };
}

/**
 * The shared-border midpoints of a candidate slot (tile-corner coordinates), one per owned neighbour: the pin sits on
 * the one nearest the view centre.
 */
export function sharedBorders(world: World, s: SlotId): { tx: number; ty: number }[] {
  const R = world.region;
  const r = slotRect(world, s);
  const out: { tx: number; ty: number }[] = [];
  const sx = s % R;
  const sy = (s / R) | 0;
  for (const n of slotNeighbours(R, s)) {
    if (!world.slotOwned[n]) continue;
    const nx = n % R;
    const ny = (n / R) | 0;
    if (ny < sy) out.push({ tx: r.x0 + 32, ty: r.y0 });
    else if (ny > sy) out.push({ tx: r.x0 + 32, ty: r.y1 + 1 });
    else if (nx < sx) out.push({ tx: r.x0, ty: r.y0 + 32 });
    else out.push({ tx: r.x1 + 1, ty: r.y0 + 32 });
  }
  return out;
}

/**
 * The annex pins to show now (§3.9): only while a land grant waits, or after an ending while the next district's
 * price is affordable; at most ANNEX.maxPins, nearest the view centre, and only those inside the uncovered view;
 * never on the City map (its own slots are the targets there). Positions in CSS px from the camera, so input
 * hit-tests exactly what is drawn.
 */
export function annexPins(world: World, cam: Camera): AnnexPin[] {
  if (cam.mapView || world.region === 1 || !pinsWanted(world)) return [];
  const c = cam.screenToWorld(cam.width / 2 + (cam.insets.left - cam.insets.right) / 2, cam.height / 2 + (cam.insets.top - cam.insets.bottom) / 2);
  const ctx = (c.y / HALF_H + c.x / HALF_W) / 2;
  const cty = (c.y / HALF_H - c.x / HALF_W) / 2;
  const pins: (AnnexPin & { d: number })[] = [];
  for (const s of candidateSlots(world)) {
    let best: { tx: number; ty: number } | null = null;
    let bd = Infinity;
    for (const b of sharedBorders(world, s)) {
      const d = Math.hypot(b.tx - ctx, b.ty - cty);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) continue;
    const p = cam.worldToScreen((best.tx - best.ty) * HALF_W, (best.tx + best.ty) * HALF_H);
    // Only pins inside the uncovered view (with the button's own margin) show: an off-screen pin can't be tapped.
    const ins = cam.insets;
    const top = Math.max(ins.top, HUD_TOP);
    const bottom = Math.max(ins.bottom, HUD_BOTTOM);
    if (p.x < ins.left + PIN_R || p.x > cam.width - ins.right - PIN_R || p.y < top + PIN_R || p.y > cam.height - bottom - PIN_R) continue;
    pins.push({ slot: s, x: p.x, y: p.y, r: PIN_R, label: slotNames(world, s).short, tx: best.tx, ty: best.ty, d: bd });
  }
  pins.sort((a, b) => a.d - b.d);
  return pins.slice(0, ANNEX.maxPins).map(({ d: _d, ...p }) => p);
}

/** The pin under screen point (sx, sy) (CSS px), with a little slack around the 44 px button, else null. */
export function pinAt(pins: readonly AnnexPin[], sx: number, sy: number, slack = 4): AnnexPin | null {
  let best: AnnexPin | null = null;
  let bd = Infinity;
  for (const p of pins) {
    const d = Math.hypot(sx - p.x, sy - p.y);
    if (d <= p.r + slack && d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Draw the pins (screen space: the context transform is DPR × CSS px). */
export function drawPins(ctx: CanvasRenderingContext2D, pins: readonly AnnexPin[], time: number, night: number): void {
  if (!pins.length) return;
  ctx.save();
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of pins) {
    const { x, y, r } = p;
    // Halo (a soft ring, no shadowBlur).
    ctx.globalAlpha = 0.25 + 0.2 * pulse;
    ctx.strokeStyle = css([255, 216, 77], 1);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = css([24, 16, 44], 0.92);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = css([255, 216, 77], 0.95);
    ctx.stroke();
    // The "+".
    ctx.strokeStyle = css([255, 236, 170], 1);
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 4);
    ctx.lineTo(x + 8, y - 4);
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    // Short name inside the lower half, on a dark plate when it overflows the button.
    ctx.font = '600 9px system-ui, sans-serif';
    const label = p.label.length > 12 ? p.label.slice(0, 11) + '…' : p.label;
    const w = ctx.measureText ? ctx.measureText(label).width : label.length * 5;
    if (w > r * 1.6) {
      ctx.fillStyle = css([24, 16, 44], 0.88);
      roundRect(ctx, x - w / 2 - 5, y + r - 4, w + 10, 14, 6);
      ctx.fill();
      ctx.fillStyle = css([255, 236, 170], 1);
      ctx.fillText(label, x, y + r + 3);
    } else {
      ctx.fillStyle = css([255, 236, 170], 1);
      ctx.fillText(label, x, y + 11);
    }
  }
  void night;
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── The owned / locked border (§3.9) ──────────────────────────────────────

/**
 * The dashed boundary between owned and locked slots, as tile-corner runs [x0, y0, x1, y1, …] (each a whole slot side;
 * the region's outer edge has the slab rim instead). Cached by the caller on world.slotsVersion.
 */
export function boundaryRuns(world: World): number[] {
  const R = world.region;
  const out: number[] = [];
  if (R === 1) return out;
  for (let s = 0; s < R * R; s++) {
    if (!world.slotOwned[s]) continue;
    const r = slotRect(world, s);
    const sx = s % R;
    const sy = (s / R) | 0;
    const locked = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < R && ty < R && !world.slotOwned[ty * R + tx];
    if (locked(sx, sy - 1)) out.push(r.x0, r.y0, r.x1 + 1, r.y0);
    if (locked(sx + 1, sy)) out.push(r.x1 + 1, r.y0, r.x1 + 1, r.y1 + 1);
    if (locked(sx, sy + 1)) out.push(r.x0, r.y1 + 1, r.x1 + 1, r.y1 + 1);
    if (locked(sx - 1, sy)) out.push(r.x0, r.y0, r.x0, r.y1 + 1);
  }
  return out;
}

/**
 * Stroke the boundary (§3.9): #8f7bff, 2 world px, alpha 0.6, dash 10 / 8 world px; never thinner than 2 CSS px, so
 * the edge of the city reads at zoom 0.22 too (the dash scales with it), over a faint wide underlay. World transform.
 */
export function drawBoundary(ctx: CanvasRenderingContext2D, runs: readonly number[], zoom: number, night: number, time: number): void {
  if (!runs.length) return;
  void time;
  const k = Math.max(1, 2 / (2 * zoom));
  ctx.save();
  ctx.lineCap = 'butt';
  // A faint wide underlay so the line reads over the fog and the city's edge alike.
  {
    ctx.globalAlpha = 0.12 + 0.1 * night;
    ctx.strokeStyle = '#8f7bff';
    ctx.lineWidth = 6 * k;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < runs.length; i += 4) {
      ctx.moveTo((runs[i] - runs[i + 1]) * HALF_W, (runs[i] + runs[i + 1]) * HALF_H);
      ctx.lineTo((runs[i + 2] - runs[i + 3]) * HALF_W, (runs[i + 2] + runs[i + 3]) * HALF_H);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#8f7bff';
  ctx.lineWidth = 2 * k;
  ctx.setLineDash([10 * k, 8 * k]);
  ctx.beginPath();
  for (let i = 0; i < runs.length; i += 4) {
    ctx.moveTo((runs[i] - runs[i + 1]) * HALF_W, (runs[i] + runs[i + 1]) * HALF_H);
    ctx.lineTo((runs[i + 2] - runs[i + 3]) * HALF_W, (runs[i + 2] + runs[i + 3]) * HALF_H);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.restore();
}

// ── District name label (§3.9) ────────────────────────────────────────────

/** Label timing (§3.9, §1.4): fades in and out over 1.5 s, at most once per 20 s. */
export const LABEL_SEC = 1.5;
export const LABEL_GAP_SEC = 20;

/**
 * When the camera centre crosses into another owned district, its name ("KESSEL FLATS") fades in at the top of the map
 * area and out over 1.5 s, at most once per 20 s, never while a tool is dragging. One district: never.
 */
export class DistrictLabel {
  private slot: SlotId = -1;
  private shownAt = -1e9;
  private text = '';
  private t = -1;

  /** Per frame: `now` in seconds (unpaused or wall, as long as it only grows), `dragging` = a tool drag is live. */
  update(world: World, cam: Camera, now: number, dragging: boolean): void {
    if (this.t >= 0) this.t = now - this.shownAt;
    if (this.t > LABEL_SEC) this.t = -1;
    if (world.region === 1 || world.districts.owned.length < 2 || cam.mapView) {
      this.slot = -1;
      return;
    }
    const c = cam.screenToWorld(cam.width / 2, cam.height / 2);
    const tx = Math.floor((c.y / HALF_H + c.x / HALF_W) / 2);
    const ty = Math.floor((c.y / HALF_H - c.x / HALF_W) / 2);
    const s = world.isOwned(tx, ty) ? world.slotAt(tx, ty) : -1;
    if (s < 0 || s === this.slot) return;
    const first = this.slot < 0;
    this.slot = s;
    if (first || dragging || now - this.shownAt < LABEL_GAP_SEC) return;
    this.text = slotNames(world, s).name.toUpperCase();
    this.shownAt = now;
    this.t = 0;
  }

  /** The label's alpha now (0 when hidden): in over the first 0.35 s, out over the last 0.5 s. */
  get alpha(): number {
    const t = this.t;
    if (t < 0) return 0;
    if (t < 0.35) return t / 0.35;
    if (t > LABEL_SEC - 0.5) return Math.max(0, (LABEL_SEC - t) / 0.5);
    return 1;
  }

  get shown(): string | null {
    return this.t >= 0 ? this.text : null;
  }

  /** Screen space (DPR × CSS px transform): centred at the top of the uncovered map area. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const a = this.alpha;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '700 17px system-ui, sans-serif';
    const x = cam.width / 2 + (cam.insets.left - cam.insets.right) / 2;
    const y = Math.max(cam.insets.top, HUD_TOP) + 12;
    const w = ctx.measureText ? ctx.measureText(this.text).width : this.text.length * 10;
    ctx.fillStyle = css([12, 8, 26], 0.55);
    roundRect(ctx, x - w / 2 - 14, y - 6, w + 28, 30, 10);
    ctx.fill();
    ctx.fillStyle = css([236, 228, 255], 1);
    ctx.fillText(this.text, x, y);
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = '#8f7bff';
    ctx.fillRect(x - 22, y + 23, 44, 2);
    ctx.restore();
  }
}
