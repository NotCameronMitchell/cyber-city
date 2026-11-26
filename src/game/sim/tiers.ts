// ─────────────────────────────────────────────────────────────────────────────
// Flat per zone × level × tier tables for the hot loops (docs/EXPANSION.md
// §4.4): index z * 12 + l * 3 + t (z = ZoneType 0..3, l = level 0..3, t = tier
// 0..2). Built once from wealth.ts (the one source), in float64 so a $ tile
// reads exactly the old ZONES numbers. CAP_AFF[l]: a $ Hab Block with an
// alley within 1 (the affordable quarter).
// ─────────────────────────────────────────────────────────────────────────────

import { ZONES } from '../config';
import { ZoneType } from '../types';
import { zoneCapacity, zonePollution, zonePowerMul, zoneTaxMul } from '../wealth';

/** Residents (Hab Blocks) or jobs (Market / Fab) per tile. */
export const CAP_T = new Float64Array(48);
/** Pollution a zone tile emits. */
export const POL_T = new Float64Array(48);
/** Power draw of a developed zone tile (0 at level 0). */
export const DRAW_T = new Float64Array(48);
/** Tax per resident / job multiplier (index z * 3 + t). */
export const TAX_T = new Float64Array(12);
/** Residents of a $ Hab Block in an affordable quarter, by level. */
export const CAP_AFF = new Float64Array(4);

const POWER: readonly (readonly number[])[] = [[0, 0, 0, 0], ZONES.res.power, ZONES.com.power, ZONES.ind.power];

for (let z = 1; z <= 3; z++) {
  for (let t = 0; t <= 2; t++) TAX_T[z * 3 + t] = zoneTaxMul(z, t);
  for (let l = 0; l <= 3; l++)
    for (let t = 0; t <= 2; t++) {
      const k = z * 12 + l * 3 + t;
      CAP_T[k] = zoneCapacity(z, l, t);
      POL_T[k] = zonePollution(z, l, t);
      const mul = zonePowerMul(z, t);
      // ×1 keeps a $ tile's draw bit-identical to the old ZONE_DRAW table.
      DRAW_T[k] = mul === 1 ? POWER[z][l] : POWER[z][l] * mul;
    }
}
for (let l = 0; l <= 3; l++) CAP_AFF[l] = zoneCapacity(ZoneType.Residential, l, 0, true);

/** Capacity of a zone tile at its level and tier; `alley` = fields.alleyNear (only a $ Hab Block gains). */
export function tierCapacity(z: number, l: number, t: number, alley: number): number {
  return z === ZoneType.Residential && t === 0 && alley ? CAP_AFF[l] : CAP_T[z * 12 + l * 3 + t];
}
