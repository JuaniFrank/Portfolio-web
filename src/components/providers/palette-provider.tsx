"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { PALETTE_STORAGE_KEY, resolvePalette, type PaletteId } from "@/lib/theme/palettes";

type Listener = () => void;
const listeners = new Set<Listener>();

function getSnapshot(): PaletteId {
  return resolvePalette(window.localStorage.getItem(PALETTE_STORAGE_KEY));
}

/** El server no tiene localStorage: siempre arranca en "default" hasta que hidrata
 * (el script inline del layout ya aplicó el atributo antes del paint, así que no
 * hay flash aunque este snapshot inicial diga "default"). */
function getServerSnapshot(): PaletteId {
  return "default";
}

function subscribe(listener: Listener) {
  // `storage` solo dispara en otras pestañas; los listeners cubren la propia.
  // El atributo se aplica ANTES de avisarle a React: `useChartColors` lee
  // `getComputedStyle` durante el render, y si el atributo se actualizara recién en el
  // efecto del provider, los charts de esa pestaña quedarían con la paleta anterior.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PALETTE_STORAGE_KEY) return;
    applyPalette(getSnapshot());
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** "default" es la ausencia de atributo: sacarlo deja el look de hoy intacto. */
function applyPalette(palette: PaletteId) {
  const root = document.documentElement;
  if (palette === "default") {
    root.removeAttribute("data-palette");
  } else {
    root.setAttribute("data-palette", palette);
  }
}

function setStoredPalette(next: PaletteId) {
  if (next === "default") {
    window.localStorage.removeItem(PALETTE_STORAGE_KEY);
  } else {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
  }
  applyPalette(next);
  listeners.forEach((listener) => listener());
}

type PaletteContextValue = {
  palette: PaletteId;
  setPalette: (palette: PaletteId) => void;
};

const PaletteContext = createContext<PaletteContextValue | null>(null);

/** Preferencia de paleta global de la app, sincronizada con localStorage entre pestañas. */
export function PaletteProvider({ children }: { children: ReactNode }) {
  const palette = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Re-aplica el atributo en cada render por si el script inline no corrió (SSR
  // sin JS, extensiones que lo bloquean) o el snapshot cambió por otra pestaña.
  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  return (
    <PaletteContext.Provider value={{ palette, setPalette: setStoredPalette }}>
      {children}
    </PaletteContext.Provider>
  );
}

export function usePalette(): PaletteContextValue {
  const context = useContext(PaletteContext);
  if (!context) throw new Error("usePalette must be used within a PaletteProvider");
  return context;
}
