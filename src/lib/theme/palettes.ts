/**
 * Registro de paletas de color de la app. **Módulo puro**: no toca `localStorage`
 * ni el DOM — el provider/script inline le pasan el valor ya leído y aplican lo
 * que este módulo devuelve.
 *
 * "Default" es el look de hoy (sin atributo en `<html>`, cero cambios visuales).
 * "Finanzas" es una paleta alternativa: menos negro puro, mayor contraste, densidad
 * más cómoda — ver `globals.css` (bloque `html[data-palette="finanzas"]`).
 */

export type PaletteId = "default" | "finanzas";

export type PaletteOption = { id: PaletteId; label: string };

export const PALETTES: readonly PaletteOption[] = [
  { id: "default", label: "Default" },
  { id: "finanzas", label: "Finanzas" },
];

export const PALETTE_STORAGE_KEY = "portfolio:palette";

const PALETTE_IDS = new Set<PaletteId>(PALETTES.map((p) => p.id));

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTE_IDS.has(value as PaletteId);
}

/** Ante un valor guardado inválido o ausente, cae a "default": nunca romper el render. */
export function resolvePalette(stored: unknown): PaletteId {
  return isPaletteId(stored) ? stored : "default";
}

/**
 * Script inline (string, sin dependencias) para setear `data-palette` en `<html>`
 * antes del primer paint, evitando el flash del look default al hidratar. Mismo
 * patrón que next-themes: un `<script suppressHydrationWarning dangerouslySetInnerHTML>`
 * renderizado en el root layout, ejecutado en orden de documento.
 *
 * "default" nunca necesita atributo (es la ausencia de atributo), así que el script
 * solo actúa para los ids no-default — generados desde el registro, no hardcodeados,
 * para que agregar una paleta nueva no requiera tocar este string.
 */
export function noFlashScript(): string {
  const nonDefaultIds = PALETTES.filter((p) => p.id !== "default").map((p) => p.id);
  return (
    "(function(){try{" +
    `var v=localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)});` +
    `if(${JSON.stringify(nonDefaultIds)}.indexOf(v)!==-1){` +
    'document.documentElement.setAttribute("data-palette",v);' +
    "}}catch(e){}})();"
  );
}
