import { getCurrentUser } from "@/lib/auth";
import { listMonitoringInstruments } from "@/lib/monitoreo/data";
import { fetchMonitoringSeries } from "@/lib/monitoreo/load-series";
import type { MonitoringBootstrapData } from "@/lib/monitoreo/types";

export async function loadMonitoringBootstrap(): Promise<
  MonitoringBootstrapData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const instruments = await listMonitoringInstruments(user.id);

  if (instruments.length === 0) {
    return {
      instruments: [],
      selectedInstrumentId: null,
      initialSeries: null,
    };
  }

  // Pick first instrument in portfolio, or first available instrument
  const recommended = instruments.find((i) => i.inPortfolio) || instruments[0]!;
  const defaultKind = recommended.isCedear ? "cedear-underlying" : "native";
  const defaultCurrency = recommended.isCedear ? "USD" : "ARS";

  const initialSeries = await fetchMonitoringSeries({
    instrumentId: recommended.id,
    currency: defaultCurrency,
    range: "ALL",
    chartType: "line",
    kind: defaultKind,
  });

  return {
    instruments,
    selectedInstrumentId: recommended.id,
    initialSeries,
  };
}
