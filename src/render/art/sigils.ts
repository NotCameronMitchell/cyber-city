// ─────────────────────────────────────────────────────────────────────────────
// Procedural faction sigils (docs/STORY.md §2.2, §8): six faction marks plus
// MOTH, LURE and the system mark, drawn with plain canvas paths so the same
// art serves the DOM (ui/story/sigils.ts caches data URLs) and the renderer
// (MOTH's mark on holo towers once Revealed). Every mark is a distinct shape,
// so factions never rely on colour alone.
// ─────────────────────────────────────────────────────────────────────────────

import type { FactionId } from '../../game/story/types';

export type SigilKind = 'ninering' | 'hexcolumn' | 'spiral' | 'hookwave' | 'kite' | 'window' | 'moth' | 'lure' | 'system' | 'unknown';

export const FACTION_SIGIL: Record<FactionId, SigilKind> = {
  board: 'ninering',
  basalt: 'hexcolumn',
  nacre: 'spiral',
  undertow: 'hookwave',
  kites: 'kite',
  tuning: 'window',
};

/** Lamp colours for the non-faction marks. */
export const MOTH_COLOR = '#ffe2a0';
export const LURE_COLOR = '#e6f3ff';
export const SYSTEM_COLOR = '#22e5ff';

const TAU = Math.PI * 2;

/**
 * Draw a sigil centred on (cx, cy) with outer radius r. Strokes use `color`;
 * `glow` adds a soft halo (UI caches the result, so shadowBlur is fine there).
 */
export function drawSigil(g: CanvasRenderingContext2D, kind: SigilKind, cx: number, cy: number, r: number, color: string, glow = true): void {
  g.save();
  g.translate(cx, cy);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  const lw = Math.max(1, r * 0.11);
  g.lineWidth = lw;
  if (glow) {
    g.shadowColor = color;
    g.shadowBlur = r * 0.45;
  }
  switch (kind) {
    case 'ninering': {
      // Nine-ring seal: eight rings around a central ring, inside a thin rim.
      g.lineWidth = lw * 0.6;
      ring(g, 0, 0, r * 0.94);
      g.lineWidth = lw * 0.85;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU - Math.PI / 2;
        ring(g, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.15);
      }
      ring(g, 0, 0, r * 0.24);
      break;
    }
    case 'hexcolumn': {
      // Hex column: a hexagonal prism standing upright, top face plus fluted sides.
      const w = r * 0.62;
      const h = r * 0.24;
      g.beginPath();
      g.moveTo(-w, -r * 0.6);
      g.lineTo(-w * 0.5, -r * 0.6 - h);
      g.lineTo(w * 0.5, -r * 0.6 - h);
      g.lineTo(w, -r * 0.6);
      g.lineTo(w * 0.5, -r * 0.6 + h);
      g.lineTo(-w * 0.5, -r * 0.6 + h);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(-w, -r * 0.6);
      g.lineTo(-w, r * 0.62);
      g.lineTo(-w * 0.5, r * 0.62 + h);
      g.lineTo(w * 0.5, r * 0.62 + h);
      g.lineTo(w, r * 0.62);
      g.lineTo(w, -r * 0.6);
      g.moveTo(-w * 0.5, -r * 0.6 + h);
      g.lineTo(-w * 0.5, r * 0.62 + h);
      g.moveTo(w * 0.5, -r * 0.6 + h);
      g.lineTo(w * 0.5, r * 0.62 + h);
      g.stroke();
      break;
    }
    case 'spiral': {
      // Spiral shell: a logarithmic spiral closing into its outer whorl.
      g.beginPath();
      const turns = 2.6;
      const steps = 90;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * turns * TAU;
        const rr = r * 0.06 * Math.exp(t * 2.75);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.92;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      break;
    }
    case 'hookwave': {
      // Hook over a wave.
      g.beginPath();
      g.moveTo(r * 0.12, -r * 0.9);
      g.lineTo(r * 0.12, r * 0.05);
      g.arc(-r * 0.2, r * 0.05, r * 0.32, 0, Math.PI * 0.95, false);
      g.stroke();
      g.beginPath();
      g.moveTo(-r * 0.52, r * 0.02);
      g.lineTo(-r * 0.62, -r * 0.16);
      g.stroke();
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const x = -r * 0.9 + t * r * 1.8;
        const y = r * 0.68 + Math.sin(t * TAU * 1.5) * r * 0.12;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      break;
    }
    case 'kite': {
      // Diamond kite with spars and a bowed tail, drawn in one line.
      const top = -r * 0.92;
      g.beginPath();
      g.moveTo(0, top);
      g.lineTo(r * 0.5, -r * 0.3);
      g.lineTo(0, r * 0.34);
      g.lineTo(-r * 0.5, -r * 0.3);
      g.closePath();
      g.stroke();
      g.lineWidth = lw * 0.6;
      g.beginPath();
      g.moveTo(0, top);
      g.lineTo(0, r * 0.34);
      g.moveTo(-r * 0.5, -r * 0.3);
      g.lineTo(r * 0.5, -r * 0.3);
      g.stroke();
      g.lineWidth = lw * 0.75;
      g.beginPath();
      g.moveTo(0, r * 0.34);
      g.bezierCurveTo(r * 0.3, r * 0.5, -r * 0.3, r * 0.7, r * 0.06, r * 0.94);
      g.stroke();
      g.beginPath();
      g.moveTo(-r * 0.13, r * 0.55);
      g.lineTo(r * 0.1, r * 0.62);
      g.moveTo(-r * 0.05, r * 0.78);
      g.lineTo(r * 0.18, r * 0.84);
      g.stroke();
      break;
    }
    case 'window': {
      // A lit window: frame, cross panes and a warm fill.
      const s = r * 0.7;
      g.save();
      g.globalAlpha = 0.28;
      g.fillRect(-s, -s, s * 2, s * 2);
      g.restore();
      g.strokeRect(-s, -s, s * 2, s * 2);
      g.lineWidth = lw * 0.7;
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(0, s);
      g.moveTo(-s, 0);
      g.lineTo(s, 0);
      g.stroke();
      g.beginPath();
      g.moveTo(-s - r * 0.12, s + r * 0.16);
      g.lineTo(s + r * 0.12, s + r * 0.16);
      g.stroke();
      break;
    }
    case 'moth':
    case 'lure': {
      // Two lamp halos joined by a filament body (MOTH). LURE: the same mark, squared off and cut.
      const lure = kind === 'lure';
      const hr = r * 0.34;
      for (const sx of [-1, 1]) {
        if (lure) g.strokeRect(sx * r * 0.5 - hr * 0.8, -r * 0.3 - hr * 0.8, hr * 1.6, hr * 1.6);
        else ring(g, sx * r * 0.5, -r * 0.28, hr);
        g.beginPath();
        g.moveTo(sx * r * 0.14, r * 0.05);
        g.quadraticCurveTo(sx * r * 0.62, r * 0.18, sx * r * 0.42, r * 0.62);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(0, -r * 0.72);
      g.lineTo(0, r * 0.82);
      g.stroke();
      g.beginPath();
      g.arc(0, -r * 0.72, lw * 1.1, 0, TAU);
      g.fill();
      if (lure) {
        g.lineWidth = lw * 0.6;
        g.beginPath();
        g.moveTo(-r * 0.9, r * 0.2);
        g.lineTo(r * 0.9, r * 0.05);
        g.stroke();
      }
      break;
    }
    case 'system': {
      g.lineWidth = lw * 0.8;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU - Math.PI / 2;
        const x = Math.cos(a) * r * 0.9;
        const y = Math.sin(a) * r * 0.9;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.stroke();
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(-r * 0.4, -r * 0.25);
      g.lineTo(-r * 0.1, 0);
      g.lineTo(-r * 0.4, r * 0.25);
      g.moveTo(r * 0.02, r * 0.28);
      g.lineTo(r * 0.42, r * 0.28);
      g.stroke();
      break;
    }
    default: {
      // Silhouette: a broken ring and a question.
      g.setLineDash([r * 0.28, r * 0.2]);
      ring(g, 0, 0, r * 0.86);
      g.setLineDash([]);
      g.font = `700 ${Math.round(r * 1.05)}px "Chakra Petch", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('?', 0, r * 0.06);
    }
  }
  g.restore();
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.stroke();
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Cached square canvas (size px) with a glowing sigil, for the renderer. */
export function sigilSprite(kind: SigilKind, color: string, size = 64): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${kind}|${color}|${size}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  drawSigil(g, kind, size / 2, size / 2, size * 0.36, color, true);
  spriteCache.set(key, c);
  return c;
}
