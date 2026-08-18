import type { InstrumentType } from "@/lib/generated/prisma";
import type { MonitoringBar } from "@/lib/monitoreo/types";

const DATA912_HISTORICAL_BASE = "https://data912.com/historical";

type Data912HistoryRawItem = {
  date?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
  [key: string]: unknown;
};

export async function fetchData912History(
  ticker: string,
  type: InstrumentType
): Promise<{ bars: MonitoringBar[]; error?: string }> {
  const category = type === "CEDEAR" ? "cedears" : "stocks";
  const url = `${DATA912_HISTORICAL_BASE}/${category}/${encodeURIComponent(ticker.toUpperCase())}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Cache historical responses for 1 hour to avoid hitting 120 req/min limit
      next: { revalidate: 3600, tags: [`data912-hist-${ticker.toUpperCase()}`] },
    });

    if (res.status === 404) {
      return { bars: [], error: `Sin cobertura histórica en Data912 para ${ticker}` };
    }

    if (res.status === 429) {
      return { bars: [], error: "Límite de tasa excedido en Data912 (120 req/min)" };
    }

    if (!res.ok) {
      return { bars: [], error: `Error HTTP ${res.status} desde Data912` };
    }

    const data = (await res.json()) as Data912HistoryRawItem[];
    if (!Array.isArray(data)) {
      return { bars: [], error: "Formato de respuesta no válido de Data912" };
    }

    const bars: MonitoringBar[] = [];

    for (const item of data) {
      if (!item || typeof item !== "object") continue;

      let dateStr: string | null = null;
      if (typeof item.date === "string") {
        dateStr = item.date.slice(0, 10);
      } else if (typeof item.date === "number") {
        dateStr = new Date(item.date).toISOString().slice(0, 10);
      }

      if (!dateStr || isNaN(Date.parse(dateStr))) continue;

      const close = typeof item.c === "number" && Number.isFinite(item.c) ? item.c : null;
      if (close === null || close <= 0) continue;

      const open = typeof item.o === "number" && Number.isFinite(item.o) ? item.o : null;
      const high = typeof item.h === "number" && Number.isFinite(item.h) ? item.h : null;
      const low = typeof item.l === "number" && Number.isFinite(item.l) ? item.l : null;
      const volume = typeof item.v === "number" && Number.isFinite(item.v) ? item.v : null;

      bars.push({
        time: dateStr,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    return { bars };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { bars: [], error: `Fallo al consultar histórico en Data912: ${msg}` };
  }
}
