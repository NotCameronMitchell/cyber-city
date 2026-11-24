// Shared colour helpers for renderer, building art and effects.
// Colours are [r, g, b] tuples (0..255) so we can blend for day/night cheaply.

export type RGB = [number, number, number];

export const NEON = {
  cyan: [34, 229, 255] as RGB,
  magenta: [255, 43, 214] as RGB,
  amber: [255, 176, 46] as RGB,
  yellow: [255, 225, 77] as RGB,
  green: [77, 255, 154] as RGB,
  red: [255, 59, 92] as RGB,
  violet: [123, 92, 255] as RGB,
  blue: [61, 123, 255] as RGB,
  white: [235, 240, 255] as RGB,
};

/** Base (unlit) material colours. Day value first, night value second. */
export const MATERIAL = {
  ground: { day: [70, 74, 86] as RGB, night: [18, 17, 30] as RGB },
  groundAlt: { day: [78, 80, 92] as RGB, night: [22, 20, 36] as RGB },
  lot: { day: [60, 62, 74] as RGB, night: [16, 15, 26] as RGB },
  asphalt: { day: [44, 46, 56] as RGB, night: [10, 10, 18] as RGB },
  water: { day: [24, 74, 96] as RGB, night: [6, 16, 34] as RGB },
  concrete: { day: [120, 124, 140] as RGB, night: [34, 32, 52] as RGB },
  wall: { day: [96, 100, 120] as RGB, night: [26, 24, 44] as RGB },
  glass: { day: [70, 110, 140] as RGB, night: [14, 20, 40] as RGB },
  skyTop: { day: [96, 120, 132] as RGB, night: [4, 3, 12] as RGB },
  skyHorizon: { day: [196, 150, 120] as RGB, night: [40, 10, 52] as RGB },
};

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Material colour at a given `night` amount (0 = day, 1 = night). */
export function lit(m: { day: RGB; night: RGB }, night: number): RGB {
  return mix(m.day, m.night, night);
}

/** Multiply brightness (k < 1 darkens). */
export function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function css(c: RGB, a = 1): string {
  const r = Math.max(0, Math.min(255, c[0] | 0));
  const g = Math.max(0, Math.min(255, c[1] | 0));
  const b = Math.max(0, Math.min(255, c[2] | 0));
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Heatmap ramp for overlays: 0 → deep blue, 0.5 → magenta, 1 → hot yellow. */
export function heat(v: number): RGB {
  v = Math.max(0, Math.min(1, v));
  if (v < 0.5) return mix([20, 40, 140], [230, 40, 200], v * 2);
  return mix([230, 40, 200], [255, 230, 80], (v - 0.5) * 2);
}

const glowCache = new Map<string, HTMLCanvasElement>();
/**
 * A pre-rendered radial glow sprite (draw with globalCompositeOperation = 'lighter').
 * Much cheaper than shadowBlur on mobile. `size` is the sprite diameter in px.
 */
export function glowSprite(color: RGB, size = 64): HTMLCanvasElement {
  // Whole-number channels: a colour mixed by a continuous value (dusk, dawn) must not add a
  // new sprite every frame, so the cache stays bounded.
  const r = Math.round(color[0]);
  const g0 = Math.round(color[1]);
  const b = Math.round(color[2]);
  const key = `${r},${g0},${b}|${size}`;
  let c = glowCache.get(key);
  if (c) return c;
  color = [r, g0, b];
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, css(color, 0.9));
  grad.addColorStop(0.25, css(color, 0.45));
  grad.addColorStop(1, css(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}
