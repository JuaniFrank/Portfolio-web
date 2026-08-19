import { HelpCircle } from "lucide-react";
import type { BondCashflowOutlook } from "@/lib/bonds/cashflows";
import { formatFullDate } from "@/components/bonds/format";
import { cn } from "@/lib/utils";
import { formatMoney, type ViewCurrency } from "./format";

type Props = {
  outlook: BondCashflowOutlook;
  currency: ViewCurrency;
};

function pick(currency: ViewCurrency, ars: string, usd: string): string {
  return currency === "ARS" ? ars : usd;
}

export function BondCashflowOutlookCard({ outlook, currency }: Props) {
  const { nextPayment } = outlook;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard
        label="Próximo pago"
        hint="Cupón y/o amortización más próximo entre todas tus ONs con términos cargados."
      >
        {nextPayment ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-teal-400">
                {nextPayment.daysUntil <= 0 ? "Hoy" : `${nextPayment.daysUntil}d`}
              </span>
              <span className="text-xs text-zinc-500">{formatFullDate(nextPayment.date)}</span>
            </div>
            <p className="mt-1.5 text-lg font-semibold tabular-nums text-zinc-100">
              {formatMoney(pick(currency, nextPayment.amountArs, nextPayment.amountUsd), currency)}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500" title={nextPayment.tickers.join(", ")}>
              {nextPayment.tickers.join(", ")}
            </p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Sin pagos futuros proyectados.</p>
        )}
      </StatCard>

      <StatCard
        label={`Proyectado ${outlook.currentYear}`}
        hint="Suma de cupones y amortizaciones restantes del año en curso, según los términos cargados."
      >
        <span className="text-2xl font-semibold tabular-nums text-zinc-100">
          {formatMoney(
            pick(currency, outlook.projectedCurrentYearArs, outlook.projectedCurrentYearUsd),
            currency
          )}
        </span>
      </StatCard>

      <StatCard
        label={`Proyectado ${outlook.nextYear}`}
        hint="Suma de cupones y amortizaciones proyectados para el año siguiente."
      >
        <span className="text-2xl font-semibold tabular-nums text-zinc-100">
          {formatMoney(
            pick(currency, outlook.projectedNextYearArs, outlook.projectedNextYearUsd),
            currency
          )}
        </span>
      </StatCard>
    </div>
  );
}

function StatCard({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-zinc-800 bg-zinc-900/40 p-4")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        {hint ? (
          <span title={hint} className="text-zinc-600 hover:text-zinc-400">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
