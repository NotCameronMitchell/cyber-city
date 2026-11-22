import type { NewsItem, Selection, ToolId, OverlayId } from './types';

/** Typed event map for the game-wide bus. */
export interface GameEventMap {
  /** Selected tool changed. */
  tool: ToolId;
  /** Sim speed changed (0..3). */
  speed: number;
  overlay: OverlayId;
  /** Short-lived on-screen message. */
  toast: { text: string; kind: 'info' | 'error' | 'good' };
  /** New ticker item (already appended to world.news). */
  news: NewsItem;
  /** Stats/budget/funds changed (fired at most once per sim tick and after actions). */
  stats: void;
  /** A month rolled over (budget applied). */
  month: void;
  /** Tiles changed in this rectangle (inclusive x0..x1, y0..y1): renderer invalidates caches. */
  tiles: { x0: number; y0: number; x1: number; y1: number };
  /** Inspect selection changed. */
  select: Selection | null;
  /** Whole world replaced (new game / load). */
  world: void;
  /** Settings changed. */
  settings: void;
  /** An action was applied (for SFX): kind tells the sound to play. */
  sfx: 'build' | 'zone' | 'road' | 'bulldoze' | 'error' | 'click' | 'money' | 'milestone' | 'alert';
  /** Population milestone reached. */
  milestone: { pop: number; title: string };
}

type Handler<T> = (payload: T) => void;

export class Emitter<M extends object> {
  private handlers = new Map<keyof M, Set<Handler<any>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof M>(type: K, ...payload: M[K] extends void ? [] : [M[K]]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload[0] as M[K]);
      } catch (err) {
        console.error(`[events] handler for "${String(type)}" threw`, err);
      }
    }
  }
}
