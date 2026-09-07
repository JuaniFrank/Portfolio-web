"use client";

import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardKpis } from "@/lib/dashboard/types";
import { formatMoney, formatSignedPercent } from "./format";

type Props = {
  kpis: DashboardKpis;
};

export function DashboardKpiCards({ kpis }: Props) {
  const pnlArs = Number(kpis.unrealizedPnlArs);
  const pnlUsd = Number(kpis.unrealizedPnlUsd);
  const pnlPct = Number(kpis.unrealizedPnlPercent);
  const pnlPctUsd = Number(kpis.unrealizedPnlPercentUsd);
  const pnlClass = pnlArs >= 0 ? "text-emerald-400" : "text-rose-400";
  // El signo puede diferir del de pesos: ganarle al mercado y perder contra el dólar
  // es un resultado perfectamente posible, y el color tiene que decirlo.
  const pnlUsdClass = pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <KpiCard
        label="Total invertido"
        hint="Costo total acumulado de tus compras netas (PPP). El importe en dólares usa el CCL del día de cada compra, no el de hoy."
      >
        <CurrencyRow label="ARS" value={formatMoney(kpis.totalInvestedArs, "ARS")} />
        <CurrencyRow label="USD" value={formatMoney(kpis.totalInvestedUsd, "USD")} />
        {kpis.usdBasisIsApproximate ? (
          <p className="pt-1 text-[11px] leading-snug text-amber-300/80">
            Alguna compra quedó fuera del histórico de CCL: su costo en dólares se estimó
            al tipo de cambio de hoy.
          </p>
        ) : null}
      </KpiCard>

      <KpiCard
        label="Valor actual"
        hint="Valuación de las posiciones a precios de mercado vigentes."
      >
        <CurrencyRow label="ARS" value={formatMoney(kpis.currentValueArs, "ARS")} />
        <CurrencyRow label="USD" value={formatMoney(kpis.currentValueUsd, "USD")} />
      </KpiCard>

      <KpiCard
        label="Rendimiento no realizado"
        hint="Diferencia entre el valor actual y lo invertido. No incluye dividendos. El rendimiento en dólares compara el valor de hoy al CCL de hoy contra lo que costó al CCL de cada compra, así que difiere del de pesos cuando el tipo de cambio se movió."
      >
        <CurrencyRow
          label="ARS"
          value={formatMoney(kpis.unrealizedPnlArs, "ARS")}
          valueClass={pnlClass}
          delta={formatSignedPercent(pnlPct)}
          deltaClass={pnlClass}
        />
        <CurrencyRow
          label="USD"
          value={formatMoney(kpis.unrealizedPnlUsd, "USD")}
          valueClass={pnlUsdClass}
          delta={formatSignedPercent(pnlPctUsd)}
          deltaClass={pnlUsdClass}
        />
      </KpiCard>

      <KpiCard
        label="Resumen de posiciones"
        hint="Cantidad de instrumentos distintos con tenencia positiva."
      >
        <div className="flex items-baseline gap-2 text-sm text-zinc-400">
          <span>Total instrumentos:</span>
          <span className="text-2xl font-semibold tabular-nums text-sky-400">
            {kpis.totalInstruments}
          </span>
        </div>
      </KpiCard>

      <KpiCard
        label="Liquidez total"
        hint="Saldo en efectivo disponible en cuentas conectadas."
        spanCols={2}
      >
        <CurrencyRow label="ARS" value={formatMoney(kpis.cashArs, "ARS")} />
        <CurrencyRow label="USD" value={formatMoney(kpis.cashUsd, "USD")} />
      </KpiCard>
    </div>
  );
}

function KpiCard({
  label,
  hint,
  children,
  spanCols,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  spanCols?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900/40 p-4",
        spanCols === 2 ? "lg:col-span-2" : null
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        {hint ? (
          <span title={hint} className="text-zinc-600 hover:text-zinc-400">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <div className="mt-3 space-y-1.5">{children}</div>
    </div>
  );
}

function CurrencyRow({
  label,
  value,
  valueClass,
  delta,
  deltaClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
  delta?: string | null;
  deltaClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-lg font-semibold tabular-nums text-emerald-400",
            valueClass
          )}
        >
          {value}
        </span>
        {delta ? (
          <span className={cn("text-xs tabular-nums text-emerald-400", deltaClass)}>
            {delta}
          </span>
        ) : null}
      </span>
    </div>
  );
}
