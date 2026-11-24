// ─────────────────────────────────────────────────────────────────────────────
// The per-world frame (docs/MEGACITY.md §3.1, Step 0b part 1).
//
// There is no map-size constant any more: a World owns its side (`world.N`) and
// tile count (`world.area` = N²), and every system copies them at construction.
// Module-scope working arrays (BFS queues, stamps, seen flags…) can't be sized
// once when the module loads, because worlds of different sides live side by
// side (the title Showcase beside a city; a test's 64 world beside a 128 one).
// `scratchFor` builds them per size on first use and keeps one set per size.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-size scratch: `const scratch = scratchFor((area) => ({ seen: new Uint8Array(area) }))`, then
 * `scratch(world.area).seen` inside a function. One set is built per distinct `area` the first time
 * it is asked for and reused after (the last size is a fast path). The scratch is shared by every
 * world of that size, exactly as a module-scope array was shared before: use it within one call,
 * never across calls for different worlds.
 */
export function scratchFor<T>(make: (area: number) => T): (area: number) => T {
  const bySize = new Map<number, T>();
  let lastArea = -1;
  let last: T | undefined;
  return (area: number): T => {
    if (area === lastArea) return last as T;
    let s = bySize.get(area);
    if (s === undefined) {
      if (!(Number.isInteger(area) && area > 0)) throw new Error(`scratchFor: bad area ${area}`);
      s = make(area);
      bySize.set(area, s);
    }
    lastArea = area;
    last = s;
    return s;
  };
}
