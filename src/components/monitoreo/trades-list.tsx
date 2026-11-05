import type { TradeEntry } from "@/lib/monitoreo/trade-markers";
import type { MonitoringCurrency } from "@/lib/monitoreo/types";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent, formatTradingDate } from "./format";

interface TradesListProps {
  /** Any order; rendered newest first. Entries without a bar are listed but not selectable. */
  entries: TradeEntry[];
  chartCurrency: MonitoringCurrency;
  /** Label of the chart-scale price shown under the trade price when it differs */
  scaleLabel: string;
  activeId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

export function TradesList({
  entries,
  chartCurrency,
  scaleLabel,
  activeId,
  onHover,
  onSelect,
}: TradesListProps) {
  const ordered = [...entries].sort(
    (a, b) => b.trade.tradeDate.localeCompare(a.trade.tradeDate) || b.id.localeCompare(a.id)
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-zinc-800/80 bg-zinc-950/70">
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2.5">
        <h3 className="text-sm font-semibold text-zinc-100">Tus operaciones</h3>
        <span className="text-xs text-zinc-500">{ordered.length}</span>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-zinc-800/60 overflow-y-auto">
        {ordered.map((marker) => {
          const trade = marker.trade;
          const tradeCurrency: MonitoringCurrency = trade.currencyCode === "USD" ? "USD" : "ARS";
          const isBuy = trade.side === "BUY";
          const anchored = marker.barTime !== null;
          const showScalePrice =
            marker.chartPrice !== null &&
            (chartCurrency !== tradeCurrency || Math.abs(marker.chartPrice - trade.price) > 0.005);

          const content = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      isBuy ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"
                    )}
                  >
                    {isBuy ? "Compra" : "Venta"}
                  </span>
                  <span className="text-xs text-zinc-300">{formatTradingDate(trade.tradeDate)}</span>
                </span>
                {trade.changeSinceTradePct !== null && (
                  <span
                    className={cn(
                      "font-mono text-xs",
                      trade.changeSinceTradePct >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}
                    title="Variación desde la operación"
                  >
                    {formatPercent(trade.changeSinceTradePct)}
                  </span>
                )}
              </span>
              <span className="flex items-center justify-between gap-2 font-mono text-xs text-zinc-200">
                <span>{trade.quantity.toLocaleString("es-AR")} u.</span>
                <span>{formatCurrency(trade.price, tradeCurrency)}</span>
              </span>
              {showScalePrice && marker.chartPrice !== null && (
                <span className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                  <span>{scaleLabel}</span>
                  <span className="font-mono">{formatCurrency(marker.chartPrice, chartCurrency)}</span>
                </span>
              )}
              {marker.approximate && anchored && (
                <span className="text-[11px] text-amber-400">Precio aproximado</span>
              )}
              {!anchored && (
                <span className="text-[11px] text-zinc-500">
                  Sin vela: fuera del histórico disponible
                </span>
              )}
            </>
          );

          return (
            <li key={marker.id}>
              {anchored ? (
                <button
                  type="button"
                  onMouseEnter={() => onHover(marker.id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(marker.id)}
                  onBlur={() => onHover(null)}
                  onClick={() => onSelect(marker.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-zinc-900/80",
                    activeId === marker.id && "bg-zinc-900/80"
                  )}
                >
                  {content}
                </button>
              ) : (
                <div className="flex w-full flex-col gap-0.5 px-3 py-2 opacity-70">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
