import type { CityEventId, DistrictKind, DistrictVariant, MomentId, NewsItem, Selection, SlotId, ToolId, OverlayId } from './types';
import type { EndingId, FactionId, Unlockable } from './story/types';

/** Typed event map for the game-wide bus. */
export interface GameEventMap {
  /** Selected tool changed. */
  tool: ToolId;
  /** Sim speed changed (0..3). */
  speed: number;
  overlay: OverlayId;
  /**
   * Short-lived on-screen message. `action` (expansion, §7.7 / §5.3) adds a 44 px button for
   * `sec` seconds: 'undo' calls game.undo(), 'watch' centres the camera on the launch pad.
   */
  toast: { text: string; kind: 'info' | 'error' | 'good'; action?: ToastAction };
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

  // ── Story layer (docs/STORY.md §11). Emitted by the director unless noted. ──
  /** A story card opened (id), or the open card closed (null). Read game.story.view().card. */
  card: { id: string } | null;
  /** A faction card arrived and waits in COMMS: show the incoming banner. */
  incoming: { id: string };
  /** The pending (COMMS) card changed: a new one (id) or none left (null). Step 0 addition. */
  pending: { id: string } | null;
  /** A chapter started: show the title card (view().titleCard). */
  chapter: { n: number; title: string };
  /** A goal was met (done) or reset. */
  goal: { id: string; done: boolean };
  /** A faction's standing changed (monthly, or after a choice / salt / deal). */
  standing: { faction: FactionId; delta: number; value: number };
  /** Trace changed. */
  trace: { value: number };
  /** A Silt Log was found. */
  log: { n: number };
  /** An ending was chosen (also after a Charter Review swap). */
  ending: { id: EndingId };
  /** Something was unlocked (tools, overlay, rail buttons). Step 0 addition. */
  unlock: { what: Unlockable };
  /** The Charter Night screen should open (view().claims). Step 0 addition. */
  charterNight: void;
  /** Turf changed (story/turf.ts, after updates and crackdowns): overlay and decals refresh. */
  turf: void;
  /** Rail, links or stages changed or were re-evaluated (story/vertical.ts). */
  vertical: void;
  /** The StoryView changed for any other reason (markDirty): re-read game.story.view(). Step 0 addition. */
  story: void;

  // ── Expansion (docs/EXPANSION.md §2.9). No new sfx kinds. ──
  /** Game: a visible Spaceport launch starts now (render, audio, news). `id` = the spaceport's building id. */
  liftoff: { id: number; first: boolean };
  /** Sim → UI first-use tips (§7.6), shown once per device. */
  hint: { id: HintId };
  /** Once-per-city banner (§5.4): ports opening and the first launch. Recorded in world.moments. */
  moment: { id: MomentId; title: string; sub: string };
  // ── Megacity (docs/MEGACITY.md §3.2) ──
  /** World: a slot was annexed (after its content is placed and the one 'tiles' touch for its rect). */
  annex: { slot: SlotId; kind: DistrictKind; variant: DistrictVariant };
  /** Game / director: unspent land grants changed. */
  grant: { grants: number; why: 'chapter' | 'ending' | 'epilogue' | 'migrated' };
  /** World.setTerrain (Pump House reclamation): the tile rect whose terrain changed. */
  terrain: { x0: number; y0: number; x1: number; y1: number };
  /** A district goal was completed (WP-2). */
  districtGoal: { slot: SlotId; id: string };
  /** City life (WP-6): a happening starts or ends. */
  cityEvent: { id: CityEventId; phase: 'start' | 'end'; slot?: SlotId };
}

/** Button on a toast (EXPANSION §2.9): label shown for `sec` seconds. */
export interface ToastAction {
  /** Megacity: 'map' opens the City map on the locked slot (§3.4); 'export' the Export sheet (the storage-full toast, §3.10; WP-9). */
  id: 'undo' | 'watch' | 'map' | 'export';
  label: string;
  sec: number;
}

/** Sim-side first-use tip ids (EXPANSION §7.6). */
export type HintId = 'wealth' | 'ramps' | 'noise';

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
