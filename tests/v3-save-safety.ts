// Today's (v3 build's) save-safety rules, copied verbatim from src/game/game.ts at commit c33958c before Step 0b part 2
// edited it (MEGACITY §11.2 item 14): a stale v3 build meeting what a v4 build stores must keep the city safe.

const SAVE_VERSIONS_SUPPORTED_V3: readonly number[] = [1, 2, 3];
const SAVE_KEY = 'cybercity.save.v1';
const MIRROR_SAVE_KEY = `${SAVE_KEY}.mirror`;
const STALE_SAVE_KEY = `${SAVE_KEY}.stale`;
const FUTURE_SAVE_KEY = `${SAVE_KEY}.future`;
const PREV_SAVE_KEY = `${SAVE_KEY}.prev`;

type Store = { get(k: string): string | null; set(k: string, v: string): void };

/** v3's isFutureSave (verbatim apart from the constant's name). */
export function isFutureSaveV3(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const v = Number((data as { version?: unknown }).version);
  return Number.isFinite(v) && v > Math.max(...SAVE_VERSIONS_SUPPORTED_V3);
}

/** v3's restoreMirror (verbatim apart from storage access through `s`). */
export function restoreMirrorV3(s: Store): boolean {
  const raw = s.get(SAVE_KEY);
  const mirror = s.get(MIRROR_SAVE_KEY);
  if (raw === null || mirror === null || raw === mirror) return false;
  const version = (str: string): number => {
    try {
      const v = Number((JSON.parse(str) as { version?: unknown } | null)?.version);
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;
    }
  };
  const main = version(raw);
  if (!(main < 3) || !(version(mirror) >= 3)) return false;
  s.set(STALE_SAVE_KEY, raw);
  s.set(SAVE_KEY, mirror);
  return true;
}

/** v3's boot (loadStored's newer-save branch): a future save is copied to .future once and blocks saving. */
export function bootV3(s: Store): { blocked: boolean } {
  restoreMirrorV3(s);
  const raw = s.get(SAVE_KEY);
  if (raw === null) return { blocked: false };
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (isFutureSaveV3(data)) {
    if (s.get(FUTURE_SAVE_KEY) === null) s.set(FUTURE_SAVE_KEY, raw);
    return { blocked: true };
  }
  return { blocked: false };
}

/** v3's New City in a blocked session: the stand-in city (`cityJson`) to .prev if it has progress (v3 did), then the main save and mirror. */
export function newCityV3(s: Store, cityJson: string, standInJson: string | null): void {
  if (standInJson !== null) s.set(PREV_SAVE_KEY, standInJson);
  s.set(SAVE_KEY, cityJson);
  s.set(MIRROR_SAVE_KEY, cityJson);
}
