/** Minimal Storage surface so helpers stay testable without a DOM. */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredString(storage: StringStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredString(storage: StringStorage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readStoredBoolean(storage: StringStorage | null, key: string, fallback: boolean): boolean {
  const raw = readStoredString(storage, key);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

/** `window.localStorage`, or null when unavailable/blocked (SSR, private mode). */
export function getBrowserStorage(): StringStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
