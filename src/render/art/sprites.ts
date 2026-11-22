// ─────────────────────────────────────────────────────────────────────────────
// Sprite cache for static building bodies.
//
// Each entry is an offscreen canvas holding one building body painted at one
// (night bucket, scale bucket, LOD) combination. Keys are plain integers, so
// the per-building hot path does no string work.
//
//  * Memory is capped (~32 MB of pixels). Least recently used entries that were
//    not drawn in the last couple of frames are evicted first; entries in use
//    are never evicted (the cap may be exceeded briefly rather than thrash).
//  * Painting new sprites is time-budgeted per frame. When over budget, the
//    most recent sprite of the same body (other night or scale bucket) is
//    drawn instead, so zooming and dusk transitions refine smoothly instead of
//    hitching. A body that has never been painted is always painted at once.
// ─────────────────────────────────────────────────────────────────────────────

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** World-px rect relative to the footprint's top corner. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  bytes: number;
  used: number;
  key: number;
  family: number;
}

export const NIGHT_STEPS = 7; // buckets 0..6
/** Scale ladder 2^(k/3), k = -7..6 → ~0.2 .. 4 device px per world px. */
export const SCALE_MIN_K = -7;
export const SCALE_MAX_K = 6;

export function nightBucket(n: number): number {
  return Math.max(0, Math.min(NIGHT_STEPS - 1, Math.round(n * (NIGHT_STEPS - 1))));
}
export function nightOfBucket(b: number): number {
  return b / (NIGHT_STEPS - 1);
}
/** Smallest ladder step ≥ scale (with a little tolerance), as a bucket index 0..13. */
export function scaleBucket(scale: number): number {
  const k = Math.ceil(3 * Math.log2(Math.max(1e-3, scale)) - 0.15);
  return Math.max(SCALE_MIN_K, Math.min(SCALE_MAX_K, k)) - SCALE_MIN_K;
}
export function scaleOfBucket(b: number): number {
  return Math.pow(2, (b + SCALE_MIN_K) / 3);
}

export class SpriteCache {
  private map = new Map<number, Sprite>();
  /** Most recent sprite per family (body × LOD): the fallback when over budget. */
  private latest = new Map<number, Sprite>();
  bytes = 0;
  frame = 0;
  private spent = 0;
  /** Max ms per frame spent painting sprites that have a fallback. */
  budgetMs = 3;
  capBytes = 32 * 1024 * 1024;
  /** Sprites painted this frame (stats). */
  built = 0;

  newFrame() {
    this.frame++;
    this.spent = 0;
    this.built = 0;
  }

  /** True if painting more sprites this frame is still within budget. */
  canBuild(): boolean {
    return this.spent < this.budgetMs;
  }

  /**
   * Fetch the sprite for `key`, painting it with `build` if missing (subject to
   * the frame budget when a fallback for `family` exists).
   */
  get(key: number, family: number, build: () => Sprite | null): Sprite | null {
    const s = this.map.get(key);
    if (s) {
      s.used = this.frame;
      return s;
    }
    const fb = this.latest.get(family);
    if (fb && this.spent >= this.budgetMs) {
      fb.used = this.frame;
      return fb;
    }
    const t0 = performance.now();
    const ns = build();
    this.spent += performance.now() - t0;
    if (!ns) return fb ?? null;
    ns.key = key;
    ns.family = family;
    ns.used = this.frame;
    this.map.set(key, ns);
    this.latest.set(family, ns);
    this.bytes += ns.bytes;
    this.built++;
    if (this.bytes > this.capBytes) this.evict();
    return ns;
  }

  private evict() {
    const target = this.capBytes * 0.8;
    const old: Sprite[] = [];
    for (const s of this.map.values()) if (s.used < this.frame - 1) old.push(s);
    old.sort((a, b) => a.used - b.used);
    for (const s of old) {
      if (this.bytes <= target) break;
      this.map.delete(s.key);
      if (this.latest.get(s.family) === s) this.latest.delete(s.family);
      this.bytes -= s.bytes;
      // Release the backing store promptly (helps mobile browsers).
      s.canvas.width = s.canvas.height = 0;
    }
  }

  clear() {
    for (const s of this.map.values()) s.canvas.width = s.canvas.height = 0;
    this.map.clear();
    this.latest.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.map.size;
  }
}
