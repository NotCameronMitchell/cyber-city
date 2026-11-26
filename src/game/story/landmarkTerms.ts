// ─────────────────────────────────────────────────────────────────────────────
// The ending landmarks' turf terms (docs/MEGACITY.md §9.2, WP-8). While the Low
// Crown holds the charter, a standing Bread Pier softens gang turf crime ×0.85
// within r12 of it and protects both gangs' turf within r6 (as a Tidemarket or
// a Roost protects its own gang's). After a Charter Review swaps the ending the
// pier stands dormant and these terms drop; they wake if the Low Crown returns.
//
// turf.ts calls the two functions below from its own passes (one line each):
// the protection masks are stamped with the other buildings', and the crime
// term is applied to the turf layer part after it is written. Nothing here is
// saved: both are derived from the buildings and story.ending every time.
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDINGS } from '../config';
import type { World } from '../world';

/** Bread Pier's terms while the Low Crown is current (§9.2). */
export const BREAD_PIER_TURF = { crimeMul: 0.85, crimeRadius: 12, protectRadius: 6 } as const;

/** The standing Bread Piers whose terms apply now (none unless the Low Crown holds the charter). */
function livePiers(world: World): { x: number; y: number; size: number }[] {
  if (world.story.ending !== 'lowcrown') return [];
  const out: { x: number; y: number; size: number }[] = [];
  for (const b of world.buildings.values()) if (b.type === 'breadpier') out.push({ x: b.x, y: b.y, size: BUILDINGS.breadpier.size });
  return out;
}

/** Stamp both gangs' protection masks within r6 of every live Bread Pier (turf.ts buildingMaps). */
export function pierProtect(world: World, protU: Uint8Array, protK: Uint8Array): void {
  const N = world.N;
  const r = BREAD_PIER_TURF.protectRadius;
  for (const p of livePiers(world)) {
    const x0 = Math.max(0, p.x - r);
    const y0 = Math.max(0, p.y - r);
    const x1 = Math.min(N - 1, p.x + p.size - 1 + r);
    const y1 = Math.min(N - 1, p.y + p.size - 1 + r);
    for (let y = y0; y <= y1; y++) {
      protU.fill(1, y * N + x0, y * N + x1 + 1);
      protK.fill(1, y * N + x0, y * N + x1 + 1);
    }
  }
}

/** Gang turf crime ×0.85 within r12 of every live Bread Pier, on the turf layer part's crime (turf.ts writeLayers). */
export function pierCrime(world: World, crimeAdd: Float32Array): void {
  const N = world.N;
  const r = BREAD_PIER_TURF.crimeRadius;
  const k = BREAD_PIER_TURF.crimeMul;
  for (const p of livePiers(world)) {
    const cx = p.x + p.size / 2;
    const cy = p.y + p.size / 2;
    const xa = Math.max(0, Math.floor(cx - r));
    const xb = Math.min(N - 1, Math.ceil(cx + r));
    const ya = Math.max(0, Math.floor(cy - r));
    const yb = Math.min(N - 1, Math.ceil(cy + r));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) crimeAdd[y * N + x] *= k;
      }
  }
}
