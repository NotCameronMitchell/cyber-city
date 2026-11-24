// ─────────────────────────────────────────────────────────────────────────────
// Neighbourhood names inside districts (docs/MEGACITY.md §3.7): the `{district}`
// token's names. Step 0b placeholder: every 5×5 repeat reuses its kind's
// variant-0 list (config DISTRICTS[kind].neighbourhoods). WP-7 writes the 16
// variant lists here (12 names each, ≤ 15 chars) under the naming lint.
// ─────────────────────────────────────────────────────────────────────────────

import { DISTRICTS } from '../config';
import { DISTRICTS as START_NAMES } from '../news';
import type { DistrictKind, DistrictVariant } from '../types';

/** Variant lists by kind, index = variant − 1 (WP-7 fills them). */
export const VARIANT_NEIGHBOURHOODS: Partial<Record<DistrictKind, readonly (readonly string[])[]>> = {};

/** The neighbourhood names of a district: the start list for Charter Shore, the variant's list, else the kind's. */
export function neighbourhoodsOf(kind: DistrictKind, variant: DistrictVariant = 0): readonly string[] {
  if (kind === 'shore') return START_NAMES;
  if (variant > 0) {
    const list = VARIANT_NEIGHBOURHOODS[kind]?.[variant - 1];
    if (list && list.length) return list;
  }
  return DISTRICTS[kind].neighbourhoods;
}
