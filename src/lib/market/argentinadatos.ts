/**
 * Cliente para api.argentinadatos.com — series históricas argentinas públicas.
 *
 * Cubre los dos datos que dolarapi no puede dar:
 *   - **CCL histórico** (dolarapi solo expone la cotización de hoy).
 *   - **Inflación mensual del INDEC** (para el benchmark de la serie en ARS).
 *
 * No requiere autenticación. Ambos endpoints devuelven la serie completa en una
 * sola respuesta (el CCL son ~530 KB desde 2013), así que se cachean agresivamente:
 * son datos que solo crecen por el final.
 *
 * Regla del proyecto: si la API falla devolvemos `null` y el consumidor degrada.
 * Nunca tiramos la página abajo por un proveedor externo.
 */

const BASE_URL = "https://api.argentinadatos.com/v1";

/** 6 h: la serie solo se extiende por el final, una vez por día hábil. */
const REVALIDATE_SECONDS = 60 * 60 * 6;

type RawCclItem = {
  casa?: unknown;
  compra?: unknown;
  venta?: unknown;
  fecha?: unknown;
};

type RawIndexItem = {
  fecha?: unknown;
  valor?: unknown;
};

/** Un día de cotización CCL. */
export type CclHistoryPoint = {
  /** Medianoche UTC del día cotizado. */
  date: Date;
  buy: number;
  sell: number;
  /** Mid = (buy + sell) / 2 — es el que usamos para convertir. */
  mid: number;
};

/** Un mes de inflación. */
export type InflationPoint = {
  /** Medianoche UTC de la fecha que publica la fuente (fin de mes). */
  date: Date;
  /**
   * Variación porcentual **mensual**, tal como la publica la fuente:
   * `{"fecha":"2026-06-30","valor":1.9}` significa 1,9 % en junio.
   *
   * NO es un nivel de índice. Confundir estas dos semánticas es el error más
   * fácil de cometer con esta serie — para acumular hay que hacer
   * `Π (1 + valor/100) - 1`, no una resta de niveles.
   */
  monthlyPercent: number;
};

/** Parsea "YYYY-MM-DD" a medianoche UTC. Devuelve null si no es una fecha válida. */
function parseUtcDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS, tags: ["argentinadatos"] },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Serie histórica completa del CCL (verificada: desde 2013-01-02).
 *
 * La fuente **incluye fines de semana y feriados** repitiendo el último valor
 * hábil, así que la serie no tiene huecos de calendario. Aun así el consumidor
 * debe hacer lookup as-of con forward-fill: no hay garantía contractual de eso.
 *
 * Devuelve `null` si la API no responde, y ordenado ascendente si responde.
 */
export async function fetchCclHistory(): Promise<CclHistoryPoint[] | null> {
  const raw = await fetchJson<RawCclItem[]>("/cotizaciones/dolares/contadoconliqui");
  if (!Array.isArray(raw)) return null;

  const points: CclHistoryPoint[] = [];
  for (const item of raw) {
    const date = parseUtcDate(item?.fecha);
    const buy = finiteNumber(item?.compra);
    const sell = finiteNumber(item?.venta);
    if (!date || buy === null || sell === null || buy <= 0 || sell <= 0) continue;
    points.push({ date, buy, sell, mid: (buy + sell) / 2 });
  }

  points.sort((a, b) => a.date.getTime() - b.date.getTime());
  return points;
}

/**
 * Inflación mensual del INDEC.
 *
 * **Ojo con el lag de publicación:** el INDEC publica con ~1,5 meses de atraso.
 * El mes en curso y el anterior típicamente no tienen dato. La UI debe mostrar
 * `—` para esos meses, nunca `0`: un cero en el acumulado de inflación le regala
 * rendimiento real al portfolio.
 */
export async function fetchInflationHistory(): Promise<InflationPoint[] | null> {
  const raw = await fetchJson<RawIndexItem[]>("/finanzas/indices/inflacion");
  if (!Array.isArray(raw)) return null;

  const points: InflationPoint[] = [];
  for (const item of raw) {
    const date = parseUtcDate(item?.fecha);
    const value = finiteNumber(item?.valor);
    if (!date || value === null) continue;
    points.push({ date, monthlyPercent: value });
  }

  points.sort((a, b) => a.date.getTime() - b.date.getTime());
  return points;
}
