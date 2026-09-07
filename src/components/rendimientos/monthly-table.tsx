"use client";

import { AlertTriangle, ChevronDown, Info, TableProperties } from "lucide-react";
import { Fragment, useState } from "react";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatMoney } from "@/components/dashboard/format";
import {
  EMPTY_VALUE,
  formatSignedPercentOrEmpty,
  returnToneClass,
} from "@/components/rendimientos/chart-utils";
import { formatMonthLabel } from "@/lib/rendimientos/months";
import type { MonthlyPerformanceRow, ViewCurrency } from "@/lib/rendimientos/types";
import { positionFigures, type MonthlyChartRow } from "@/lib/rendimientos/view";
import { cn } from "@/lib/utils";

/** Un número que no se pudo medir en la moneda activa se muestra vacío, no en cero. */
function formatMoneyOrEmpty(value: number | null, currency: ViewCurrency): string {
  return value === null ? EMPTY_VALUE : formatMoney(value, currency);
}

/**
 * Tabla mensual con el detalle de posiciones desplegable.
 *
 * Muestra las filas de la más reciente a la más antigua, que es el orden en el que se
 * mira este tipo de tabla. Los charts van en orden cronológico; la tabla, al revés.
 */
export function MonthlyTable({
  rows,
  monthsByKey,
  currency,
}: {
  rows: MonthlyChartRow[];
  /** Filas crudas del motor, para el detalle de posiciones. */
  monthsByKey: Map<string, MonthlyPerformanceRow>;
  currency: ViewCurrency;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const ordered = [...rows].reverse();

  const toggle = (month: string) =>
    setExpanded((current) => (current === month ? null : month));

  return (
    <ChartCard
      title="Detalle mensual"
      description="Un mes por fila. Hacé click en una fila para ver las posiciones de ese cierre."
      icon={<TableProperties className="h-4 w-4" />}
    >
      {ordered.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
          Todavía no hay meses para mostrar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <Th>Mes</Th>
                <Th align="right">CCL cierre</Th>
                <Th
                  align="right"
                  hint="Posiciones a precio de mercado más la renta acumulada a esa fecha. No incluye el efectivo de la cuenta."
                >
                  Valor invertido
                </Th>
                <Th
                  align="right"
                  hint="Cuánto cambió el valor invertido este mes, neto del capital que pusiste o sacaste (compras − ventas). Incluye la renta cobrada en el mes."
                >
                  Ganancia mes
                </Th>
                <Th
                  align="right"
                  hint="Suma de “Ganancia mes” dentro del período que estás mirando (no desde tu primera operación)."
                >
                  Ganancia acum.
                </Th>
                <Th
                  align="right"
                  hint="Rendimiento porcentual del mes (Modified Dietz), valuando la cartera en cada operación en vez de con un promedio del capital."
                >
                  Rend. mensual
                </Th>
                <Th
                  align="right"
                  hint="Cuánto están arriba o abajo TUS POSICIONES ABIERTAS respecto a su costo promedio, al cierre de este mes. Es una foto, no el rendimiento del mes."
                >
                  No realizado
                </Th>
                <Th
                  align="right"
                  hint="Rendimiento encadenado desde el inicio del período visible — no es la suma de los rendimientos mensuales."
                >
                  Rend. acumulado
                </Th>
                <Th align="right">Detalle</Th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => {
                const source = monthsByKey.get(row.month);
                const isOpen = expanded === row.month;

                return (
                  <Fragment key={row.month}>
                    <tr
                      onClick={() => toggle(row.month)}
                      className={cn(
                        "cursor-pointer border-b border-zinc-800/60 transition-colors hover:bg-zinc-800/30",
                        isOpen && "bg-zinc-800/40"
                      )}
                    >
                      <Td>
                        <span className="flex items-center gap-1.5 font-medium text-zinc-200">
                          {formatMonthLabel(row.month)}
                          {row.coverage === "partial" ? (
                            <span title="Algún precio de este mes viene por arrastre">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            </span>
                          ) : null}
                        </span>
                      </Td>
                      <Td align="right" className="text-zinc-400">
                        {row.cclMonthEnd === null
                          ? EMPTY_VALUE
                          : row.cclMonthEnd.toLocaleString("es-AR", {
                              maximumFractionDigits: 2,
                            })}
                      </Td>
                      <Td align="right" className="text-zinc-100">
                        {formatMoney(row.value, currency)}
                      </Td>
                      <Td align="right" className={returnToneClass(row.gain)}>
                        {formatMoney(row.gain, currency)}
                      </Td>
                      <Td align="right" className={returnToneClass(row.cumulativeGain)}>
                        {formatMoney(row.cumulativeGain, currency)}
                      </Td>
                      <Td align="right" className={returnToneClass(row.monthlyReturn)}>
                        {formatSignedPercentOrEmpty(row.monthlyReturn)}
                      </Td>
                      <Td align="right" className={returnToneClass(row.unrealizedReturn)}>
                        {formatSignedPercentOrEmpty(row.unrealizedReturn)}
                      </Td>
                      <Td align="right" className={returnToneClass(row.cumulativeReturn)}>
                        {formatSignedPercentOrEmpty(row.cumulativeReturn)}
                      </Td>
                      <Td align="right">
                        <ChevronDown
                          className={cn(
                            "ml-auto h-4 w-4 text-zinc-500 transition-transform",
                            isOpen && "rotate-180"
                          )}
                        />
                      </Td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-zinc-800/60">
                        <td colSpan={9} className="bg-zinc-950/50 px-3 py-3">
                          <PositionsDetail
                            positions={source?.positions ?? []}
                            staleTickers={source?.staleTickers ?? []}
                            income={currency === "ARS" ? source?.incomeArs : source?.incomeUsd}
                            netInvested={
                              currency === "ARS"
                                ? source?.netInvestedArs
                                : source?.netInvestedUsd
                            }
                            currency={currency}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        &quot;Valor invertido&quot; son tus posiciones a precio de mercado más la renta
        cobrada; no incluye el efectivo de la cuenta. Cada mes se valúa con el último
        precio disponible hasta el cierre, así que puede no coincidir exactamente con el
        estado de cuenta de tu broker. El rendimiento mensual se calcula valuando la cartera
        en cada operación, y el acumulado está encadenado, no sumado.
      </p>
    </ChartCard>
  );
}

function PositionsDetail({
  positions,
  staleTickers,
  income,
  netInvested,
  currency,
}: {
  positions: MonthlyPerformanceRow["positions"];
  staleTickers: string[];
  /** Renta cobrada en el mes, neta de comisiones. */
  income: number | undefined;
  /** Capital puesto en el mes: compras − ventas. */
  netInvested: number | undefined;
  currency: ViewCurrency;
}) {
  if (positions.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        Sin posiciones abiertas al cierre de este mes.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="text-zinc-500">
          Capital del mes{" "}
          <span className={returnToneClass(netInvested ?? 0)}>
            {formatMoney(netInvested ?? 0, currency)}
          </span>
        </span>
        {income ? (
          <span className="text-zinc-500">
            Renta cobrada{" "}
            <span className={returnToneClass(income)}>{formatMoney(income, currency)}</span>
          </span>
        ) : null}
      </div>

      {staleTickers.length > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-400/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Precio arrastrado de un mes anterior en: {staleTickers.join(", ")}. Esos valores
            son una valuación, no una medición.
          </span>
        </p>
      ) : null}

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <Th>Ticker</Th>
            <Th align="right">Cantidad</Th>
            <Th align="right">Precio</Th>
            <Th align="right" hint="Cantidad × precio, al cierre de este mes.">
              Valor
            </Th>
            <Th
              align="right"
              hint="Costo promedio de compra (PPC) de toda la posición. Solo cambia si comprás o vendés. En dólares, cada compra va al CCL del día en que se hizo."
            >
              Costo
            </Th>
            <Th
              align="right"
              hint="Ganancia/pérdida ACUMULADA de esta posición contra su costo promedio, al cierre de este mes. No es lo que ganó este mes — para eso mirá “Result. mes”."
            >
              No realizado
            </Th>
            <Th align="right" hint="“No realizado” sobre el costo.">
              %
            </Th>
            <Th
              align="right"
              hint="Ganancia/pérdida de ESTE ticker durante ESTE mes: precio de cierre vs. precio de cierre del mes anterior (o precio de compra si es nueva), neto de compras/ventas del ticker en el mes. Sumando esta columna en todas las filas da “Ganancia mes”, menos la renta cobrada."
            >
              Result. mes
            </Th>
            <Th align="right" hint="“Result. mes” sobre la base comparable de ese ticker.">
              % mes
            </Th>
          </tr>
        </thead>
        <tbody>
          {[...positions]
            .sort((a, b) => b.valueArs - a.valueArs)
            .map((position) => {
              const figures = positionFigures(position, currency);
              return (
              <tr key={position.instrumentId} className="border-t border-zinc-800/50">
                <Td>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-zinc-200">{position.ticker}</span>
                    {position.priceIsStale ? (
                      <span title="Precio arrastrado de un mes anterior">
                        <AlertTriangle className="h-3 w-3 text-amber-400" />
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-500">
                    {position.instrumentName}
                  </span>
                </Td>
                <Td align="right" className="text-zinc-400">
                  {position.quantity.toLocaleString("es-AR", { maximumFractionDigits: 4 })}
                </Td>
                <Td align="right" className="text-zinc-400">
                  {formatMoneyOrEmpty(figures.price, currency)}
                </Td>
                <Td align="right" className="text-zinc-200">
                  {formatMoney(figures.value, currency)}
                </Td>
                <Td align="right" className="text-zinc-500">
                  {formatMoneyOrEmpty(figures.costBasis, currency)}
                </Td>
                <Td align="right" className={returnToneClass(figures.unrealizedPnl)}>
                  {formatMoneyOrEmpty(figures.unrealizedPnl, currency)}
                </Td>
                <Td align="right" className={returnToneClass(figures.unrealizedReturnPct)}>
                  {formatSignedPercentOrEmpty(figures.unrealizedReturnPct)}
                </Td>
                <Td align="right" className={returnToneClass(figures.monthGain)}>
                  {formatMoneyOrEmpty(figures.monthGain, currency)}
                </Td>
                <Td align="right" className={returnToneClass(figures.monthReturnPct)}>
                  {formatSignedPercentOrEmpty(figures.monthReturnPct)}
                </Td>
              </tr>
              );
            })}
        </tbody>
      </table>
      <p className="text-[10px] text-zinc-600">
        En dólares, el valor de cada cierre va al CCL de ese cierre y el costo al CCL del
        día de cada compra. Un guion significa que alguna compra quedó fuera del histórico
        de CCL y ese número no se puede medir en dólares.
      </p>
    </div>
  );
}

function Th({
  children,
  align = "left",
  hint,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  /** Aclaración que aparece al pasar el mouse sobre el ícono de info. */
  hint?: string;
}) {
  return (
    <th
      className={cn("px-3 py-2 font-medium", align === "right" ? "text-right" : "text-left")}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1",
          align === "right" && "flex-row-reverse"
        )}
      >
        {children}
        {hint ? (
          <span title={hint}>
            <Info className="h-3 w-3 shrink-0 cursor-help text-zinc-600" aria-label={hint} />
          </span>
        ) : null}
      </span>
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 tabular-nums",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </td>
  );
}
