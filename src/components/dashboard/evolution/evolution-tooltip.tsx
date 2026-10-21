import {
  EMPTY_VALUE,
  TOOLTIP_CLASS,
  formatDateLong,
  formatSignedPercentOrEmpty,
  returnToneClass,
} from "@/components/rendimientos/chart-utils";
import { MOVERS_PER_SIDE, type EvolutionMover } from "@/lib/dashboard/evolution";
import type { ViewMode } from "@/lib/dashboard/evolution-chart";
import { cn } from "@/lib/utils";
import { formatMoney, type ViewCurrency } from "../format";
import type { ChartRow } from "./chart-model";
import { formatSignedMoney } from "./format";

export function EvolutionTooltip({
  row,
  currency,
  mode,
}: {
  row: ChartRow;
  currency: ViewCurrency;
  mode: ViewMode;
}) {
  const hasBase = row.view.periodReturn !== null;
  const allMovers = [...row.gainers, ...row.losers];
  const hasFlowMarker = allMovers.some((mover) => mover.hadFlow);
  const hasLiveMarker = allMovers.some((mover) => mover.priceIsLive);

  const secondaryLabel =
    mode === "percent" ? "Rendimiento acumulado" : mode === "result" ? "Resultado acumulado" : "Aportes acumulados";
  const secondaryValue =
    mode === "percent"
      ? formatSignedPercentOrEmpty(row.view.cumulativeReturn)
      : mode === "result"
        ? formatSignedMoney(row.view.result, currency)
        : formatMoney(row.view.invested, currency);
  const secondaryTone =
    mode === "value"
      ? "text-zinc-100"
      : returnToneClass(mode === "percent" ? row.view.cumulativeReturn : row.view.result);

  return (
    <div className={TOOLTIP_CLASS}>
      <p className="font-medium text-zinc-200">
        {formatDateLong(row.date)}
        {row.view.hasEstimatedPrices ? (
          <span className="ml-1.5 rounded bg-amber-950 px-1 py-0.5 text-[10px] font-normal text-amber-300">
            estimado
          </span>
        ) : null}
      </p>

      <div className="mt-2 flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">Valor</span>
        <span className="font-medium tabular-nums text-zinc-100">
          {formatMoney(row.view.value, currency)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">{secondaryLabel}</span>
        <span className={cn("font-medium tabular-nums", secondaryTone)}>{secondaryValue}</span>
      </div>

      <div className="flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">Resultado del período</span>
        <span className={cn("font-medium tabular-nums", returnToneClass(hasBase ? row.periodChange : null))}>
          {hasBase ? formatSignedMoney(row.periodChange, currency) : EMPTY_VALUE}
          <span className="ml-1.5 text-[11px] text-zinc-500">
            {formatSignedPercentOrEmpty(row.view.periodReturn)}
          </span>
        </span>
      </div>

      {row.gainers.length > 0 || row.losers.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-x-4 border-t border-zinc-800 pt-2">
          <MoverColumn
            title="Ganaron"
            movers={row.gainers.slice(0, MOVERS_PER_SIDE)}
            currency={currency}
          />
          <MoverColumn
            title="Perdieron"
            movers={row.losers.slice(0, MOVERS_PER_SIDE)}
            currency={currency}
          />
        </div>
      ) : (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          {hasBase
            ? "Ninguna posición seleccionada se movió en el período."
            : "Primer cierre: no hay período anterior con qué comparar."}
        </p>
      )}

      {row.trade ? (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
            Operaciones ({row.trade.count})
          </p>
          <ul className="space-y-0.5">
            {row.trade.trades.map((trade, index) => (
              <li
                key={`${trade.ticker}-${index}`}
                className="flex items-baseline justify-between gap-2 text-[11px]"
              >
                <span className="text-zinc-300">
                  {trade.side === "buy" ? "Compra" : "Venta"} {trade.ticker} × {trade.quantity}
                </span>
                <span className="tabular-nums text-zinc-400">{formatMoney(trade.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasFlowMarker ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          <span className="text-teal-400/80">°</span> Operaste en el período: el resultado
          incluye el precio al que compraste o vendiste, así que puede no acompañar la
          variación del ticker.
        </p>
      ) : null}

      {hasLiveMarker ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          <span className="text-emerald-400/80">•</span> Precio en vivo: todavía no hay cierre
          del día, se reemplaza cuando corre el backfill.
        </p>
      ) : null}

      {row.staleTickers.length > 0 ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-amber-300/80">
          <span className="text-amber-400/80">*</span> Sin cierre propio del período (
          {row.staleTickers.join(", ")}): valuado al último precio conocido.
        </p>
      ) : null}
    </div>
  );
}

function MoverColumn({
  title,
  movers,
  currency,
}: {
  title: string;
  movers: EvolutionMover[];
  currency: ViewCurrency;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">{title}</p>
      {movers.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{EMPTY_VALUE}</p>
      ) : (
        <ul className="space-y-0.5">
          {movers.map((mover) => (
            <li
              key={mover.ticker}
              className="flex min-w-0 items-baseline justify-between gap-2 whitespace-nowrap"
            >
              <span className="min-w-0 truncate text-zinc-300">
                {mover.ticker}
                {/* Un asterisco donde el precio vino arrastrado: el número está
                    calculado contra un cierre que no es del período. */}
                {mover.priceIsStale ? <span className="text-amber-400/80">*</span> : null}
                {/* Un punto verde donde el cierre todavía es el precio en vivo del día. */}
                {mover.priceIsLive ? <span className="text-emerald-400/80">•</span> : null}
                {/* Marca las filas donde se operó: es la única explicación posible de
                    que el resultado y la variación del ticker discrepen de signo. */}
                {mover.hadFlow ? <span className="text-teal-400/80">°</span> : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                <span className={returnToneClass(currency === "ARS" ? mover.pnlArs : mover.pnlUsd)}>
                  {formatSignedMoney(
                    currency === "ARS" ? mover.pnlArs : mover.pnlUsd,
                    currency,
                    { compact: true }
                  )}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {formatSignedPercentOrEmpty(mover.pricePercent)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
