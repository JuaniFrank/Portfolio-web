/**
 * Tipo de cambio USD→ARS vigente (CCL o MEP) para las métricas en dólares y para la
 * variación diaria del dashboard.
 *
 * "Hoy" sale de dolarapi, que ya está cacheada por fetch (~15 min): la fila guardada
 * con fecha de hoy NO es una fuente fresca. `syncCclHistory` inserta esa fila desde
 * argentinadatos, que hasta publicar el dato del día arrastra el cierre anterior, así
 * que fiarse de ella congelaba el dólar en el valor del viernes. Por eso el valor en
 * vivo manda y la fila de hoy se upsertea con él; el último valor guardado (de la
 * fecha que sea) queda solo como respaldo cuando dolarapi no responde.
 *
 * El cierre previo de cada fuente es la última fila guardada con fecha anterior a hoy.
 */

import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { CCL_RATE_WHERE } from "./ccl-rate-filter";
import { fetchCclQuote, fetchMepQuote, type CclQuote } from "./dolarapi";
import { computeFxDailyChange, type FxDailyChange, type FxPreviousClose } from "./fx-daily-change";

export type FxRateSource = "CCL" | "MEP";

const QUOTE_FETCHERS: Record<FxRateSource, () => Promise<CclQuote | null>> = {
  CCL: fetchCclQuote,
  MEP: fetchMepQuote,
};

const whereFor = (source: FxRateSource) => ({
  ...CCL_RATE_WHERE,
  source,
});

/** UTC midnight of the current day — the stable key for the daily FxRate row. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Persiste (o corrige) la fila de hoy con la cotización en vivo. No fatal si falla. */
async function upsertTodayRate(
  source: FxRateSource,
  quote: CclQuote,
  today: Date
): Promise<void> {
  try {
    await prisma.fxRate.upsert({
      where: {
        date_baseCurrencyCode_quoteCurrencyCode_source: {
          date: today,
          baseCurrencyCode: "USD",
          quoteCurrencyCode: "ARS",
          source,
        },
      },
      create: {
        date: today,
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "ARS",
        source,
        buy: new Prisma.Decimal(quote.buy),
        sell: new Prisma.Decimal(quote.sell),
        mid: new Prisma.Decimal(quote.mid),
      },
      update: {
        buy: new Prisma.Decimal(quote.buy),
        sell: new Prisma.Decimal(quote.sell),
        mid: new Prisma.Decimal(quote.mid),
      },
    });
  } catch {
    // Persistence failure (e.g. missing Currency row) is non-fatal — still use the
    // freshly fetched mid so the USD view renders this session.
  }
}

/**
 * Mid vigente de la fuente. Devuelve null solo si no hay valor guardado Y dolarapi no
 * responde.
 */
async function resolveFxMid(source: FxRateSource): Promise<number | null> {
  const today = todayUtc();
  const [latest, quote] = await Promise.all([
    prisma.fxRate.findFirst({ where: whereFor(source), orderBy: { date: "desc" } }),
    QUOTE_FETCHERS[source](),
  ]);

  // dolarapi caído: respaldo en el último valor guardado, sea de hoy o más viejo.
  if (!quote) return latest ? Number(latest.mid) : null;

  // La cotización cacheada no cambia entre llamadas: no se reescribe una fila que ya
  // tiene ese valor (esta función corre en cada carga de página).
  const alreadyStored =
    latest &&
    latest.date.getTime() === today.getTime() &&
    Math.abs(Number(latest.mid) - quote.mid) < 0.005;
  if (!alreadyStored) await upsertTodayRate(source, quote, today);

  return quote.mid;
}

/**
 * Return the current USD→ARS CCL mid rate (live from dolarapi, stored row as
 * fallback). Returns null only when there is no stored rate AND dolarapi is
 * unavailable.
 */
export async function resolveCclRate(): Promise<number | null> {
  return resolveFxMid("CCL");
}

/** Último cierre guardado de la fuente con fecha estrictamente anterior a hoy (UTC). */
async function loadPreviousClose(source: FxRateSource): Promise<FxPreviousClose | null> {
  const row = await prisma.fxRate.findFirst({
    where: { ...whereFor(source), date: { lt: todayUtc() } },
    orderBy: { date: "desc" },
    select: { date: true, mid: true },
  });
  return row ? { date: row.date, mid: Number(row.mid) } : null;
}

async function resolveFxDailyChange(source: FxRateSource): Promise<FxDailyChange | null> {
  // `resolveFxMid` primero: su upsert de hoy no toca el cierre previo (fecha < hoy).
  const [mid, previous] = await Promise.all([resolveFxMid(source), loadPreviousClose(source)]);
  return mid === null ? null : computeFxDailyChange(mid, previous);
}

export type FxDailyChanges = { ccl: FxDailyChange | null; mep: FxDailyChange | null };

/** Valor de hoy y variación contra el cierre previo, para CCL y MEP. */
export async function resolveFxDailyChanges(): Promise<FxDailyChanges> {
  const [ccl, mep] = await Promise.all([resolveFxDailyChange("CCL"), resolveFxDailyChange("MEP")]);
  return { ccl, mep };
}
