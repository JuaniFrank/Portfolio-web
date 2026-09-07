"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { ViewCurrency } from "@/lib/rendimientos/types";

const STORAGE_KEY = "portfolio:currency";

type Listener = () => void;
const listeners = new Set<Listener>();

function isViewCurrency(value: string | null): value is ViewCurrency {
  return value === "ARS" || value === "USD";
}

function getSnapshot(): ViewCurrency {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isViewCurrency(stored) ? stored : "ARS";
}

/** El server no tiene localStorage: siempre arranca en ARS hasta que hidrata. */
function getServerSnapshot(): ViewCurrency {
  return "ARS";
}

function subscribe(listener: Listener) {
  // `storage` solo dispara en otras pestañas; los listeners cubren la propia.
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function setStoredCurrency(next: ViewCurrency) {
  window.localStorage.setItem(STORAGE_KEY, next);
  listeners.forEach((listener) => listener());
}

type CurrencyContextValue = {
  currency: ViewCurrency;
  setCurrency: (currency: ViewCurrency) => void;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

/** Preferencia de moneda global de la app, sincronizada con localStorage entre pestañas. */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const currency = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency: setStoredCurrency }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);
  if (!context) throw new Error("useCurrency must be used within a CurrencyProvider");
  return context;
}
