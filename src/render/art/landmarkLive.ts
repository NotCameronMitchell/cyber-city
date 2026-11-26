// ─────────────────────────────────────────────────────────────────────────────
// The ending landmarks' live extras (docs/MEGACITY.md §9.2, the optional row;
// WP-8): hooked from the signatures (art/faction.ts drawSigs), fed once a frame
// by the marks pass (art/marks.ts draw, before the buildings).
//
//   smileFace   the Glass Smile's face at night turns slowly to follow the
//               camera: its eyes and mouth ease toward the middle of the view.
//   ledgerFace  the Record Tower's faces scroll the city's real income and
//               upkeep lines (world.budget) while Open Ledger holds, at the
//               street zoom; the static ticker stays far out and when frozen.
//
// Its own module (no import of buildings.ts), so faction.ts can call it
// without an import cycle. Cheap: one Smile and one Record Tower a city
// (maxCount 1); the ledger text is one cached sprite, redrawn when the
// budget's lines change, and one clipped drawImage a face.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../../game/world';
import { HALF_H, HALF_W } from '../camera';
import type { Rect } from '../ground';
import { css, type RGB } from '../palette';

/** World px of a tile point (u, v in tile units). */
const wx = (u: number, v: number) => (u - v) * HALF_W;
const wy = (u: number, v: number) => (u + v) * HALF_H;

/** Per-frame draws of the extras (tests, the measurement script). */
export const LIVE_STATS = { smiles: 0, ledgers: 0 };

/** What the last draw() saw: the view's centre and half width in world px, the zoom and the world (for its budget). */
const view = { x: 0, y: 0, r: 200, set: false, zoom: 1, low: false, world: null as World | null };
/** The Glass Smile's eased gaze (world px off the sphere's centre; one Smile a city, maxCount 1). */
const gaze = { x: 0, y: 0, t: -1 };
/** Seconds the face takes to settle on a new view (it "turns slowly"). */
const GAZE_SEC = 1.8;
/** Live ledger text only from this zoom (below it the static ticker reads as figures anyway). */
export const LEDGER_TEXT_ZOOM = 0.85;

/** The marks pass's frame: where the view is (the Smile's gaze) and which world's budget the Record Tower reads. */
export function noteView(ctx: CanvasRenderingContext2D, world: World, tiles: Rect, zoom: number, low = false): void {
  view.world = world;
  view.zoom = zoom;
  view.low = low;
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  if (m && m.a > 0 && ctx.canvas) {
    view.x = (ctx.canvas.width / 2 - m.e) / m.a;
    view.y = (ctx.canvas.height / 2 - m.f) / m.d;
    view.r = Math.max(60, ctx.canvas.width / 2 / m.a);
  } else {
    // No transform to read (a canvas mock): the centre of the tile rect in view.
    const cu = (tiles.x0 + tiles.x1 + 1) / 2;
    const cv = (tiles.y0 + tiles.y1 + 1) / 2;
    view.x = wx(cu, cv);
    view.y = wy(cu, cv);
    view.r = Math.max(60, ((tiles.x1 - tiles.x0 + tiles.y1 - tiles.y0) / 4) * HALF_W);
  }
  view.set = true;
  LIVE_STATS.smiles = 0;
  LIVE_STATS.ledgers = 0;
}

/** The Glass Smile's gaze now (tests): world px from the sphere's centre to where the face looks. */
export function smileGaze(): { x: number; y: number } {
  return { x: gaze.x, y: gaze.y };
}

/**
 * The Glass Smile's face at night (§9.2 optional: "turns slowly to follow the camera"): MOTH's smile, an original pearl
 * disc with two dots and an arc, whose eyes and mouth ease toward the middle of the view, narrowing on the side they
 * turn from, as if the sphere turned to look at whoever is looking. Returns false (art/faction.ts then draws its fixed
 * smile) before the marks pass has seen a view.
 */
export function smileFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, n: number, t: number): boolean {
  if (!view.set) return false;
  const dx = view.x - x;
  const dy = view.y - y;
  const d = Math.hypot(dx, dy);
  const k = d > 1e-6 ? Math.min(1, d / (view.r * 0.8)) / d : 0;
  const tx = dx * k * r * 0.4;
  const ty = dy * k * r * 0.24;
  const step = gaze.t < 0 ? 1 : 1 - Math.exp(-Math.max(0, Math.min(0.25, t - gaze.t)) / (GAZE_SEC / 3));
  gaze.x += (tx - gaze.x) * step;
  gaze.y += (ty - gaze.y) * step;
  gaze.t = t;
  const fx = x + gaze.x;
  const fy = y + gaze.y;
  // The features narrow toward the rim they turn to (a face on a sphere seen at an angle).
  const sq = 1 - Math.min(0.45, (Math.abs(gaze.x) / r) * 1.1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = n * 0.75;
  ctx.fillStyle = css(c, 0.5);
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.92, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = n;
  ctx.fillStyle = css([255, 255, 255], 0.9);
  const e = r * 0.14;
  ctx.fillRect(fx - r * 0.28 * sq - e / 2, fy - r * 0.25, e * sq, e);
  ctx.fillRect(fx + r * 0.28 * sq - e / 2, fy - r * 0.25, e * sq, e);
  ctx.strokeStyle = css([255, 255, 255], 0.9);
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.ellipse(fx, fy + r * 0.02, r * 0.42 * sq, r * 0.42, 0, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  LIVE_STATS.smiles++;
  return true;
}

/** "+1.24M" / "−412K" / "+950": a ledger amount in a few characters. */
export function ledgerAmount(v: number): string {
  const s = v < 0 ? '−' : '+';
  const a = Math.abs(v);
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e3)}K`;
  return `${s}${Math.round(a).toLocaleString('en-US')}`;
}

/** The Record Tower's lines: the city's real budget (world.budget), income then upkeep, then the month's net. */
export function ledgerLines(world: World): { label: string; amount: string; up: boolean }[] {
  const b = world.budget;
  const out: { label: string; amount: string; up: boolean }[] = [];
  // A face holds about 16 characters a row: the label to 9 at a word boundary ("HAB TAX", "POWER", "DATA HUBS"), its
  // figure right after it on the same row. A face slopes, so a figure in a column of its own, or a row below, sits level
  // with another line's label and reads as that line's.
  const short = (s: string) => {
    const words = s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    if (words.length > 1 && words[words.length - 1] === 'TAX' && words[0].length <= 5) return `${words[0]} TAX`;
    let out = words[0]?.slice(0, 9) ?? '';
    for (let k = 1; k < words.length && out.length + 1 + words[k].length <= 9; k++) out += ` ${words[k]}`;
    return out;
  };
  for (const l of b.incomeLines) if (l.amount) out.push({ label: short(l.label), amount: ledgerAmount(l.amount), up: true });
  for (const l of b.expenseLines) if (l.amount) out.push({ label: short(l.label), amount: ledgerAmount(-l.amount), up: false });
  out.push({ label: 'NET', amount: ledgerAmount(b.income - b.expenses), up: b.income >= b.expenses });
  return out.slice(0, 18);
}

/** Face units: px between rows (a line a row: its label, then its figure), the sprite's scale (crisp at zoom 2 on a 2× screen). */
const LEDGER_ROW = 8;
const LEDGER_S = 4;
const LEDGER_W = 52;
let ledgerCanvas: HTMLCanvasElement | null = null;
let ledgerKey = '';
let ledgerRows = 0;

/** The ledger text sprite (two copies of the lines, for a seamless scroll), rebuilt when the budget's lines change. */
function ledgerSprite(world: World, c: RGB): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const lines = ledgerLines(world);
  const key = lines.map((l) => `${l.label}${l.amount}`).join('|');
  if (ledgerCanvas && key === ledgerKey) return ledgerCanvas;
  // Whole rounds of the lines, at least a face's height of rows, so the scroll never runs past the second copy.
  const rows = lines.length * Math.ceil(15 / lines.length);
  const cv = ledgerCanvas ?? document.createElement('canvas');
  cv.width = LEDGER_W * LEDGER_S;
  cv.height = rows * LEDGER_ROW * LEDGER_S * 2;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, cv.width, cv.height);
  g.scale(LEDGER_S, LEDGER_S);
  g.font = 'bold 4.6px ui-monospace, Menlo, Consolas, monospace';
  g.textBaseline = 'alphabetic';
  for (let copy = 0; copy < 2; copy++)
    for (let k = 0; k < rows; k++) {
      const l = lines[k % lines.length];
      const yy = (copy * rows + k) * LEDGER_ROW + LEDGER_ROW - 2.2;
      g.textAlign = 'left';
      g.fillStyle = css(c, 0.66);
      g.fillText(l.label, 2, yy);
      g.fillStyle = l.up ? css(c, 1) : css([255, 196, 150], 0.95);
      g.fillText(l.amount, 2 + g.measureText(`${l.label} `).width, yy);
    }
  ledgerCanvas = cv;
  ledgerKey = key;
  ledgerRows = rows;
  return cv;
}

/**
 * The Record Tower's faces while Open Ledger holds (§9.2 optional "the live ledger text"): the city's real income and
 * upkeep lines (world.budget), scrolling up each face, at the street zoom. Returns false to keep the static ticker
 * (art/faction.ts) far out, at Low quality, while frozen (the past look) or before the marks pass has seen the world.
 */
export function ledgerFace(ctx: CanvasRenderingContext2D, ox: number, oy: number, ex: number, ey: number, h: number, c: RGB, frozen: boolean, t: number): boolean {
  const w = view.world;
  if (frozen || !w || view.low || view.zoom < LEDGER_TEXT_ZOOM) return false;
  const spr = ledgerSprite(w, c);
  if (!spr) return false;
  const L = Math.hypot(ex, ey);
  if (L < 8) return false;
  // Read left to right: start from the face's left end.
  const flip = ex < 0;
  const ax = flip ? ox + ex : ox;
  const ay = flip ? oy + ey : oy;
  const ux = (flip ? -ex : ex) / L;
  const uy = (flip ? -ey : ey) / L;
  ctx.save();
  ctx.transform(ux, uy, 0, 1, ax, ay);
  ctx.beginPath();
  ctx.rect(0, -h, L, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(10, 14, 24, 0.92)';
  ctx.fillRect(0, -h, L, h);
  const period = ledgerRows * LEDGER_ROW;
  const off = (t * 5) % period; // the lines rise ≈ 5 px a second
  const sh = h * (LEDGER_W / L);
  ctx.globalAlpha = 1;
  ctx.drawImage(spr, 0, off * LEDGER_S, spr.width, sh * LEDGER_S, 0, -h, L, h);
  ctx.restore();
  LIVE_STATS.ledgers++;
  return true;
}
