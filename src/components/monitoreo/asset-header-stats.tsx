import type { HeaderStats } from "@/lib/monitoreo/asset-stats";
import type { MonitoringCurrency, MonitoringRange } from "@/lib/monitoreo/types";
import { formatCurrency, formatPercent, formatTradingDate } from "./format";
import { StatTile, toneForValue } from "./stat-tile";

const RANGE_LABEL: Record<MonitoringRange, string> = {
  "1M": "1 mes",
  "3M": "3 meses",
  "6M": "6 meses",
  "1Y": "1 año",
  ALL: "histórico",
};

interface AssetHeaderStatsProps {
  stats: HeaderStats;
  currency: MonitoringCurrency;
  range: MonitoringRange;
}

export function AssetHeaderStats({ stats, currency, range }: AssetHeaderStatsProps) {
  const signedAbs =
    stats.dayChangeAbs === null
      ? "—"
      : `${stats.dayChangeAbs > 0 ? "+" : ""}${formatCurrency(stats.dayChangeAbs, currency)}`;

  return (
    <>
      <StatTile
        label="Último precio"
        value={formatCurrency(stats.lastPrice, currency)}
        sub={stats.lastDate ? `Rueda ${formatTradingDate(stats.lastDate)}` : undefined}
      />
      <StatTile
        label="Variación diaria"
        value={formatPercent(stats.dayChangePct)}
        sub={signedAbs}
        tone={toneForValue(stats.dayChangePct)}
      />
      <StatTile
        label={`Variación ${RANGE_LABEL[range]}`}
        value={formatPercent(stats.rangeChangePct)}
        tone={toneForValue(stats.rangeChangePct)}
      />
      <StatTile label="Máximo del rango" value={formatCurrency(stats.rangeHigh, currency)} />
      <StatTile label="Mínimo del rango" value={formatCurrency(stats.rangeLow, currency)} />
    </>
  );
}
