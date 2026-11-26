// Safe localStorage wrappers: storage may be missing or throw (private mode,
// sandboxed frames). A leaf module so story code can use them without
// importing game.ts; game.ts re-exports them for everyone else.

export function storageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): boolean {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}
