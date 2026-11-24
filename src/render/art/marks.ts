// ─────────────────────────────────────────────────────────────────────────────
// Mark decals (docs/MEGACITY.md §9.3): kites, mast, Truce Wall, nets, banners,
// livery, smile screens, ledger tickers, quota boards… WP-8 draws them. Step 0b
// ships the call site in render/story.ts with this no-op.
// ─────────────────────────────────────────────────────────────────────────────

import type { Marks } from '../../game/story/types';
import type { World } from '../../game/world';
import type { ArtEnv } from '../buildings';
import type { Rect } from '../ground';

/** Draw the visible marks (world transform). Step 0b: nothing. */
export function draw(_ctx: CanvasRenderingContext2D, _world: World, _marks: Marks, _tiles: Rect, _env: ArtEnv): void {
  // WP-8.
}
