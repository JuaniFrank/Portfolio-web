import type { PositionSummary } from "@/lib/monitoreo/trade-markers";
import type { MonitoringCurrency } from "@/lib/monitoreo/types";
import { formatCurrency, formatPercent } from "./format";
import { StatTile, toneForValue } from "./stat-tile";

const NOT_COMPARABLE_REASON =
  "No se puede calcular en esta escala: falta el precio equivalente de alguna compra o hubo un evento corporativo (split, cambio de ratio) posterior.";

interface PositionPanelProps {
  summary: PositionSummary;
  tradesCount: number;
  currency: MonitoringCurrency;
}

export function PositionPanel({ summary, tradesCount, currency }: PositionPanelProps) {
  const reason = summary.comparable ? undefined : NOT_COMPARABLE_REASON;
  const closed = summary.quantity === 0;

  return (
    <>
        <StatTile
          label="Tu cantidad"
          value={closed ? "Sin posición" : summary.quantity.toLocaleString("es-AR")}
        />
        <StatTile
          label="Costo prom. (PPC)"
          value={summary.avgCost === null ? "—" : formatCurrency(summary.avgCost, currency)}
          title={summary.avgCost === null && !closed ? reason : undefined}
        />
        <StatTile
          label="Resultado vs. último"
          value={formatPercent(summary.unrealizedPct)}
          tone={toneForValue(summary.unrealizedPct)}
          title={summary.unrealizedPct === null && !closed ? reason : undefined}
        />
        <StatTile label="Operaciones" value={tradesCount.toLocaleString("es-AR")} />
    </>
  );
}
