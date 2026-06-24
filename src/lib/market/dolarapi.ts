/**
 * Cliente para dolarapi.com — API pública de cotizaciones del dólar en Argentina.
 *
 * Endpoint CCL (Contado con Liquidación): https://dolarapi.com/v1/dolares/contadoconliqui
 *
 * No requiere autenticación. Para no saturarla, cacheamos la respuesta vía
 * Next 16 fetch revalidate (15 min). Si la API falla, devolvemos null y la UI
 * se degrada (los totales mixtos no se muestran).
 */

const CCL_ENDPOINT = "https://dolarapi.com/v1/dolares/contadoconliqui";
const REVALIDATE_SECONDS = 60 * 15;

type DolarapiResponse = {
  moneda?: string;
  casa?: string;
  nombre?: string;
  compra?: number;
  venta?: number;
  fechaActualizacion?: string;
};

export type CclQuote = {
  /** Punta compradora (ARS por 1 USD CCL). */
  buy: number;
  /** Punta vendedora (ARS por 1 USD CCL). */
  sell: number;
  /** Mid = (buy + sell) / 2. Útil para conversiones de UI. */
  mid: number;
  /** ISO de cuando la API publicó la cotización. */
  updatedAt: string | null;
};

export async function fetchCclQuote(): Promise<CclQuote | null> {
  try {
    const res = await fetch(CCL_ENDPOINT, {
      next: { revalidate: REVALIDATE_SECONDS, tags: ["ccl-quote"] },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as DolarapiResponse;
    const buy = typeof data.compra === "number" ? data.compra : null;
    const sell = typeof data.venta === "number" ? data.venta : null;
    if (!buy || !sell || buy <= 0 || sell <= 0) return null;
    return {
      buy,
      sell,
      mid: (buy + sell) / 2,
      updatedAt: data.fechaActualizacion ?? null,
    };
  } catch {
    return null;
  }
}
