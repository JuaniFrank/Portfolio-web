import { getCurrentUser } from "@/lib/auth";
import { listMonitoringInstruments } from "@/lib/monitoreo/data";
import { isSplitAdjustmentEnabled } from "@/lib/monitoreo/split-adjustment-config";
import { fetchMonitoringSeries } from "@/lib/monitoreo/load-series";
import { resolveInitialSelection, type ActivosView } from "@/lib/monitoreo/activos-selection";
import type { MonitoringBootstrapData } from "@/lib/monitoreo/types";

export async function loadMonitoringBootstrap(
  request: { ticker?: string | null; vista?: ActivosView | null } = {}
): Promise<
  MonitoringBootstrapData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const instruments = await listMonitoringInstruments(user.id);

  if (instruments.length === 0) {
    return {
      instruments: [],
      selectedInstrumentId: null,
      selectedKind: "native",
      selectedCurrency: "ARS",
      initialSeries: null,
      splitAdjustmentEnabled: isSplitAdjustmentEnabled(),
    };
  }

  // Requested ticker/view (deep link) when known, else the first portfolio instrument.
  const selection = resolveInitialSelection(instruments, {
    ticker: request.ticker ?? null,
    vista: request.vista ?? null,
  })!;
  const selected = instruments.find((i) => i.id === selection.instrumentId)!;
  const defaultCurrency = selection.kind === "cedear-underlying" ? "USD" : "ARS";

  const initialSeries = await fetchMonitoringSeries({
    instrumentId: selected.id,
    currency: defaultCurrency,
    range: "ALL",
    chartType: "candles",
    kind: selection.kind,
  });

  return {
    instruments,
    selectedInstrumentId: selected.id,
    selectedKind: selection.kind,
    selectedCurrency: defaultCurrency,
    initialSeries,
    splitAdjustmentEnabled: isSplitAdjustmentEnabled(),
  };
}
