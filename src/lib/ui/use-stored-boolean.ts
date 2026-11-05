"use client";

import * as React from "react";
import { getBrowserStorage, readStoredBoolean, writeStoredString } from "./safe-storage";

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Boolean preference remembered in localStorage. Server and first client render use `fallback`
 * (no hydration mismatch); the stored value applies right after hydration. Storage errors are
 * swallowed: the value then lives only for the current page view.
 */
export function useStoredBoolean(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  // In-memory overlay used when storage is unavailable, so the toggle still works.
  const memoryRef = React.useRef<boolean | null>(null);

  const value = React.useSyncExternalStore(
    subscribe,
    () => memoryRef.current ?? readStoredBoolean(getBrowserStorage(), key, fallback),
    () => fallback
  );

  const set = React.useCallback(
    (next: boolean) => {
      const stored = writeStoredString(getBrowserStorage(), key, next ? "1" : "0");
      memoryRef.current = stored ? null : next;
      listeners.forEach((l) => l());
    },
    [key]
  );

  return [value, set];
}
