"use client";

import { Receipt } from "lucide-react";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatMoney } from "@/components/dashboard/format";
import {
  EMPTY_VALUE,
  formatDateLong,
  formatSignedPercentOrEmpty,
  returnToneClass,
} from "@/components/rendimientos/chart-utils";
import { Td, Th } from "@/components/rendimientos/monthly-table";
import { formatHoldingAge } from "@/lib/rendimientos/position-rows";
import {
  realizedFigures,
  salesInMonths,
  totalRealizedPnl,
  type RealizedSale,
} from "@/lib/rendimientos/realized-sales";
import type { MonthlyPerformanceRow, ViewCurrency } from "@/lib/rendimientos/types";

function formatMoneyOrEmpty(value: number | null, currency: ViewCurrency): string {
  return value === null ? EMPTY_VALUE : formatMoney(value, currency);
}

/**
 * Ventas del período contra el costo promedio. Es una métrica distinta de "Result. mes"
 * del detalle mensual (que compara contra el cierre del mes anterior): acá la referencia
 * es lo que costó la posición, así que una misma venta puede mostrar números distintos
 * en una y otra tabla, y los dos son correctos.
 */
export function RealizedSales({
  sales,
  months,
  currency,
}: {
  sales: RealizedSale[];
  /** Meses del período visible: el mismo recorte que usa el resto de la página. */
  months: MonthlyPerformanceRow[];
  currency: ViewCurrency;
}) {
  const visible = salesInMonths(sales, months);
  const { total, unmeasured } = totalRealizedPnl(visible, currency);

  return (
    <ChartCard
      title="Ventas realizadas"
      description="Cada venta del período contra el costo promedio de la posición. No es lo mismo que “Result. mes”."
      icon={<Receipt className="h-4 w-4" />}
      headerExtra={
        visible.length > 0 ? (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              Realizado del período
            </p>
            <p className={`text-sm font-semibold tabular-nums ${returnToneClass(total)}`}>
              {formatMoney(total, currency)}
            </p>
          </div>
        ) : null
      }
    >
      {visible.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
          No hay ventas en este período.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-(length:--monthly-table-font-size) leading-(--monthly-table-line-height)">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-(length:--monthly-table-head-font-size) uppercase tracking-wide text-zinc-500">
                <Th>Fecha</Th>
                <Th>Ticker</Th>
                <Th align="right">Cantidad</Th>
                <Th align="right" hint="Precio al que vendiste, tal como lo cargaste.">
                  Precio
                </Th>
                <Th
                  align="right"
                  hint="Costo promedio por unidad (PPC) de la posición al momento de la venta. En dólares, cada compra va al CCL del día en que se hizo."
                >
                  Costo prom.
                </Th>
                <Th
                  align="right"
                  hint="Lo que cobraste por la venta, neto de comisiones. En dólares, al CCL del día de la venta."
                >
                  Cobrado
                </Th>
                <Th
                  align="right"
                  hint="Ganancia/pérdida de ESTA venta contra el costo promedio de lo que vendiste. Es distinto de “Result. mes” del detalle mensual, que compara contra el cierre del mes anterior."
                >
                  Realizado
                </Th>
                <Th align="right" hint="“Realizado” sobre el costo de lo vendido.">
                  %
                </Th>
                <Th
                  align="right"
                  hint="Tiempo desde que abriste la posición (la compra que la llevó de cero a positiva) hasta esta venta."
                >
                  Tenencia
                </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((sale, index) => {
                const figures = realizedFigures(sale, currency);
                return (
                  <tr
                    key={`${sale.instrumentId}-${sale.tradeDate}-${index}`}
                    className="border-t border-zinc-800/50"
                  >
                    <Td className="text-zinc-400">{formatDateLong(sale.tradeDate)}</Td>
                    <Td>
                      <span className="font-medium text-zinc-200">{sale.ticker}</span>
                      <span className="block truncate text-[10px] text-zinc-500">
                        {sale.instrumentName}
                      </span>
                    </Td>
                    <Td align="right" className="text-zinc-400">
                      {sale.quantity.toLocaleString("es-AR", { maximumFractionDigits: 4 })}
                    </Td>
                    <Td align="right" className="text-zinc-400">
                      {formatMoney(sale.price, "ARS")}
                    </Td>
                    <Td align="right" className="text-zinc-500">
                      {formatMoneyOrEmpty(figures.avgCost, currency)}
                    </Td>
                    <Td align="right" className="text-zinc-200">
                      {formatMoneyOrEmpty(figures.proceeds, currency)}
                    </Td>
                    <Td align="right" className={returnToneClass(figures.pnl)}>
                      {formatMoneyOrEmpty(figures.pnl, currency)}
                    </Td>
                    <Td align="right" className={returnToneClass(figures.returnPct)}>
                      {formatSignedPercentOrEmpty(figures.returnPct)}
                    </Td>
                    <Td align="right" className="text-zinc-500">
                      {sale.holdingDays === null ? EMPTY_VALUE : formatHoldingAge(sale.holdingDays)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {unmeasured > 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-amber-400/90">
          {unmeasured === 1 ? "Una venta no se puede" : `${unmeasured} ventas no se pueden`}{" "}
          medir en dólares (falta el CCL de la venta o de alguna compra) y no suma al total.
        </p>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        El realizado usa el costo promedio ponderado de la posición, no lotes individuales.
        El precio de venta se muestra tal como lo cargaste, aunque después haya habido un
        split.
      </p>
    </ChartCard>
  );
}
