/**
 * Comparadores de orden y persistencia del layout de la tabla interactiva de
 * posiciones. **Módulo puro**: no toca `localStorage` — el componente le pasa el
 * string ya leído y guarda el string que este módulo le devuelve.
 */

export type SortDirection = "asc" | "desc";

/**
 * Compara dos valores numéricos posiblemente nulos. Los nulos van **siempre** al
 * final, sea cual sea la dirección: un dato que no se pudo medir no es "el más
 * chico" ni "el más grande", así que no puede quedar arriba solo por invertir el
 * orden.
 */
export function compareNullableNumeric(
  a: number | null,
  b: number | null,
  direction: SortDirection
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

/** Igual que `compareNullableNumeric`, pero alfabético (`localeCompare` en español). */
export function compareNullableAlphabetical(
  a: string | null,
  b: string | null,
  direction: SortDirection
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = a.localeCompare(b, "es");
  return direction === "asc" ? cmp : -cmp;
}

export type PositionsTableSort = { id: string; desc: boolean };

export type PositionsTableLayout = {
  columnOrder: string[];
  columnSizing: Record<string, number>;
  columnVisibility: Record<string, boolean>;
  sorting: PositionsTableSort[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === "number");
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === "boolean");
}

function isSortingArray(value: unknown): value is PositionsTableSort[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isPlainObject(item) && typeof item.id === "string" && typeof item.desc === "boolean"
    )
  );
}

/**
 * Recupera el layout guardado. Ante un JSON inválido o que no es un objeto, devuelve
 * `null` — se hidrata con los defaults. Ante un objeto válido con ALGUNOS campos con
 * forma inesperada (p. ej. después de un cambio de versión), conserva los campos
 * válidos y descarta solo los corruptos: perder todo el layout por un campo roto
 * sería peor que perder ese campo.
 */
export function parseStoredLayout(raw: string | null): Partial<PositionsTableLayout> | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) return null;

  const result: Partial<PositionsTableLayout> = {};
  if (isStringArray(parsed.columnOrder)) result.columnOrder = parsed.columnOrder;
  if (isNumberRecord(parsed.columnSizing)) result.columnSizing = parsed.columnSizing;
  if (isBooleanRecord(parsed.columnVisibility)) result.columnVisibility = parsed.columnVisibility;
  if (isSortingArray(parsed.sorting)) result.sorting = parsed.sorting;

  return result;
}

export function serializeLayout(layout: PositionsTableLayout): string {
  return JSON.stringify(layout);
}

/**
 * Concilia el orden guardado con las columnas que existen hoy: descarta ids que ya
 * no existen (una columna que se sacó del código) y agrega al final las que el
 * layout guardado no conocía (una columna nueva), en su posición por defecto.
 */
export function reconcileColumnOrder(defaultOrder: string[], storedOrder: string[]): string[] {
  const validStored = storedOrder.filter((id) => defaultOrder.includes(id));
  const missing = defaultOrder.filter((id) => !validStored.includes(id));
  return [...validStored, ...missing];
}

export type ColumnWidthSpec = { id: string; size: number; minSize: number; maxSize?: number };

export type ResolvedColumnWidths = {
  columns: Array<{ id: string; width: number }>;
  total: number;
};

function clampWidth(width: number, spec: ColumnWidthSpec): number {
  return Math.min(Math.max(width, spec.minSize), spec.maxSize ?? Number.POSITIVE_INFINITY);
}

/**
 * Ancho de cada columna visible, en orden, y el total de la tabla. Ambos salen de los
 * mismos números: con `table-layout: fixed`, si el ancho de la tabla no coincide con la
 * suma de las columnas, el navegador reparte la diferencia entre TODAS, y achicar o
 * agrandar una mueve a las demás. Por eso no se usan los getters memoizados de TanStack,
 * que pueden quedar desfasados respecto del estado controlado durante un resize.
 */
export function resolveColumnWidths(
  specs: ColumnWidthSpec[],
  order: string[],
  visibility: Record<string, boolean>,
  sizing: Record<string, number>
): ResolvedColumnWidths {
  const specsById = new Map(specs.map((spec) => [spec.id, spec]));
  const columns: ResolvedColumnWidths["columns"] = [];
  let total = 0;

  for (const id of order) {
    const spec = specsById.get(id);
    if (!spec || visibility[id] === false) continue;
    const stored = sizing[id];
    const width = clampWidth(typeof stored === "number" && Number.isFinite(stored) ? stored : spec.size, spec);
    columns.push({ id, width });
    total += width;
  }

  return { columns, total };
}

/** Ancho que deja ver entero el contenido más ancho medido de la columna (doble click en
 * el borde), dentro de sus límites. Sin mediciones vuelve al tamaño por defecto. */
export function fitColumnWidth(contentWidths: number[], spec: ColumnWidthSpec): number {
  if (contentWidths.length === 0) return spec.size;
  return clampWidth(Math.ceil(Math.max(...contentWidths)), spec);
}
