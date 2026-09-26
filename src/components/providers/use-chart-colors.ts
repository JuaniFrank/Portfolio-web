"use client";

import { useMemo } from "react";
import { usePalette } from "@/components/providers/palette-provider";

/**
 * Colores de chart resueltos desde las variables CSS de la paleta activa.
 * recharts y lightweight-charts dibujan con valores de color *literales*
 * (SVG props / opciones imperativas de canvas) — no entienden `var(--color-…)`
 * como haría una clase Tailwind — así que hay que leer el valor ya resuelto con
 * `getComputedStyle` y volver a leerlo cada vez que cambia la paleta.
 */
export type ChartColors = {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  card: string;
  positive: string;
  negative: string;
  accent: string;
  zinc50: string;
  zinc400: string;
  zinc500: string;
  zinc600: string;
  zinc800: string;
  zinc900: string;
  zinc950: string;
};

/** Mismos valores que los literales hardcodeados que reemplazan (Default):
 * zinc-50 #fafafa, zinc-400 #a1a1aa, zinc-500 #71717a, zinc-600 #52525b,
 * zinc-800 #27272a, zinc-900 #18181b, zinc-950 #09090b. Fallback para el primer
 * render (antes de que el efecto lea `getComputedStyle`) y para SSR. */
const FALLBACK: ChartColors = {
  background: "#09090b",
  foreground: "#fafafa",
  muted: "#71717a",
  border: "#27272a",
  card: "#18181b",
  positive: "#10b981",
  negative: "#f43f5e",
  accent: "#6366f1",
  zinc50: "#fafafa",
  zinc400: "#a1a1aa",
  zinc500: "#71717a",
  zinc600: "#52525b",
  zinc800: "#27272a",
  zinc900: "#18181b",
  zinc950: "#09090b",
};

const VAR_NAMES: Record<keyof ChartColors, string> = {
  background: "--color-background",
  foreground: "--color-foreground",
  muted: "--color-muted",
  border: "--color-border",
  card: "--color-card",
  positive: "--color-positive",
  negative: "--color-negative",
  accent: "--color-accent",
  zinc50: "--color-zinc-50",
  zinc400: "--color-zinc-400",
  zinc500: "--color-zinc-500",
  zinc600: "--color-zinc-600",
  zinc800: "--color-zinc-800",
  zinc900: "--color-zinc-900",
  zinc950: "--color-zinc-950",
};

let probe: CanvasRenderingContext2D | null | undefined;
const srgbCache = new Map<string, string | null>();

/**
 * Pasa cualquier color CSS a `rgb()`/`rgba()`.
 *
 * Tailwind 4 define la paleta en `oklch`, y `getComputedStyle` la devuelve en ese
 * espacio (o en `lab`). recharts la pasa tal cual al SVG y el navegador la entiende,
 * pero lightweight-charts parsea el color él mismo y solo acepta hex/rgb/rgba: con
 * `oklch` revienta al crear el chart. Pintar el color en un canvas de 1×1 deja que el
 * navegador haga la conversión, sea cual sea el espacio de origen.
 */
function toSrgb(value: string): string | null {
  const cached = srgbCache.get(value);
  if (cached !== undefined) return cached;

  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return null;

  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const result =
    a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round3((a ?? 0) / 255)})`;

  srgbCache.set(value, result);
  return result;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readChartColors(): ChartColors {
  const styles = getComputedStyle(document.documentElement);
  const result = { ...FALLBACK };
  for (const [key, cssVar] of Object.entries(VAR_NAMES) as Array<[keyof ChartColors, string]>) {
    const value = styles.getPropertyValue(cssVar).trim();
    if (!value) continue;
    // Si el navegador no puede convertirlo, mejor el fallback que romper el chart.
    result[key] = toSrgb(value) ?? result[key];
  }
  return result;
}

/** Colores de chart que siguen la paleta activa (`usePalette`). Es un valor
 * derivado (no estado): `useMemo` la recalcula solo cuando cambia `palette`, leyendo
 * `getComputedStyle` durante el render en vez de en un efecto — evitar el patrón
 * setState-en-efecto (cascading renders) que un `useState`+`useEffect` acá tendría.
 * Devuelve el fallback del Default en SSR (no hay `window`). */
export function useChartColors(): ChartColors {
  const { palette } = usePalette();

  return useMemo(() => {
    if (typeof window === "undefined") return FALLBACK;
    // `palette` no se lee directo: dispara el recálculo, pero el valor real sale de
    // `data-palette` en `<html>` (ya escrito por `PaletteProvider` antes de este
    // render) vía `getComputedStyle`.
    void palette;
    return readChartColors();
  }, [palette]);
}
