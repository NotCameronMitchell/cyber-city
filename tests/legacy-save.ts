// Test helper (MEGACITY Step 0b): turn a save of the legacy 64×64 test frame (a v4 save with region 1, which only
// headless tests write) into the v1–v3 shape (a 64×64 `tiles` array, no region, size, districts or tile blocks), so the
// old-save tests keep exercising the real migration path (upgradeSave → a 3×3 region with the map in the start slot).

import { decodeBlock } from '../src/game/districts/migrate';
import type { SaveData } from '../src/game/types';

/** The v3 shape of a legacy-frame save (version 3 unless given). Tiles keep bits 0-19. */
export function toV3(data: SaveData, version = 3): SaveData {
  if (data.region !== 1 || !Array.isArray(data.tileBlocks)) throw new Error('toV3: not a legacy-frame save');
  const vals = new Int32Array(4096);
  if (!decodeBlock(data.tileBlocks[0], vals)) throw new Error('toV3: bad block');
  const out = JSON.parse(JSON.stringify(data)) as SaveData;
  out.version = version;
  out.tiles = Array.from(vals, (v) => v & 0xfffff);
  delete out.region;
  delete out.size;
  delete out.districts;
  delete out.tileBlocks;
  return out;
}

/** World offset of the start slot of a migrated (3×3) city: v3 tile (x, y) is at (x + 64, y + 64). */
export const V3_OFFSET = 64;
