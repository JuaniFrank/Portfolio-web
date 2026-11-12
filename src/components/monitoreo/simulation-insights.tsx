import * as React from "react";
import { ChevronDown } from "lucide-react";
import { parseDecimalInput } from "@/lib/monitoreo/order-drafts";
import { breakEvenMovePct, scenarioTable } from "@/lib/monitoreo/sim-insights";
import type { Holding, LedgerResult } from "@/lib/monitoreo/simulation-ledger";
import type { MonitoringCurrency } from "@/lib/monitoreo/types";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent } from "./format";
import { StatTile, toneForValue } from "./stat-tile";

interface SimulationInsightsProps {
  position: Holding | null;
  result: LedgerResult | null;
  /** Reference price (chart scale) the break-even is measured from */
  referencePrice: number | null;
  /** Market price in the price basis, and the chart-scale price per basis price */
  marketPrice: number | null;
  factor: number | null;
  feePct: number;
  /** Investment of the simulated buys, in money: the scenarios' starting amount */
  defaultAmount: number | null;
  currency: MonitoringCurrency;
  moneyCurrency: MonitoringCurrency;
  /** null: no pesos quote, so amounts (and units) can't be computed */
  moneyFactor: number | null;
}

const inputClass =
  "w-24 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-teal-700";

/** "Needs +x %" when below the PPC, or how far above it the reference already is. */
function breakEvenValue(pct: number | null): string {
  if (pct === null) return "—";
  return pct > 0 ? formatPercent(pct) : "ya en ganancia";
}

/** Collapsible insights: break-even move before/after and a "market falls X %" scenario table. */
export function SimulationInsights({
  position,
  result,
  referencePrice,
  marketPrice,
  factor,
  feePct,
  defaultAmount,
  currency,
  moneyCurrency,
  moneyFactor,
}: SimulationInsightsProps) {
  const [open, setOpen] = React.useState(false);
  // null: follow the simulated buys' investment until the user types an amount
  const [amountText, setAmountText] = React.useState<string | null>(null);

  const hasPosition = position !== null && position.quantity > 0 && position.avgCost !== null;
  const before = hasPosition ? breakEvenMovePct(referencePrice, position.avgCost) : null;
  const after = result ? breakEvenMovePct(referencePrice, result.totals.avgCost) : null;

  const amountValue =
    amountText ??
    (defaultAmount !== null && defaultAmount > 0 ? String(Math.round(defaultAmount)) : "");
  const amount = parseDecimalInput(amountValue);
  const scenarios =
    marketPrice !== null && factor !== null
      ? scenarioTable(position, { amount, marketPrice, factor, moneyFactor, feePct })
      : null;
  // Without a money factor only the hypothetical prices can be shown
  const priceOnly =
    moneyFactor === null && marketPrice !== null && factor !== null
      ? [5, 10, 20, 30].map((drop) => ({ drop, price: marketPrice * (1 - drop / 100) * factor }))
      : null;

  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-100"
      >
        Equilibrio y escenarios
        <ChevronDown
          className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-zinc-800/80 p-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <StatTile
              stacked
              label="Salir hecho (hoy)"
              value={breakEvenValue(before)}
              sub={before !== null && before > 0 ? "desde el último" : undefined}
              title="Suba necesaria desde el precio de referencia para llegar a tu PPC actual"
            />
            <StatTile
              stacked
              label="Salir hecho (sim.)"
              value={breakEvenValue(after)}
              tone={before !== null && after !== null ? toneForValue(before - after) : "neutral"}
              title="Lo mismo con el PPC que resulta de las órdenes simuladas"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            {moneyFactor !== null && (
              <label className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                Si el mercado cae e invertís ({moneyCurrency})
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountValue}
                  onChange={(e) => setAmountText(e.target.value)}
                  placeholder="0"
                  className={inputClass}
                />
              </label>
            )}
            {priceOnly ? (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] text-amber-500/80">
                  Sin cotización en pesos para calcular montos.
                </p>
                <p className="font-mono text-[11px] text-zinc-300">
                  {priceOnly
                    .map((r) => `−${r.drop} %: ${formatCurrency(r.price, currency)}`)
                    .join(" · ")}
                </p>
              </div>
            ) : scenarios ? (
              <ul className="divide-y divide-zinc-800/60 font-mono text-[11px]">
                {scenarios.map((s) => (
                  <li key={s.dropPct} className="flex flex-col gap-0.5 py-1">
                    <span className="flex justify-between text-zinc-300">
                      <span className="text-zinc-400">
                        −{s.dropPct} % · {formatCurrency(s.price, currency)}
                      </span>
                      <span>{s.quantity.toLocaleString("es-AR")} u.</span>
                    </span>
                    <span className="flex justify-between text-zinc-300">
                      <span>
                        PPC {formatCurrency(s.newAvgCost, currency)}{" "}
                        <span className={toneClass(s.avgCostChangePct, true)}>
                          ({formatPercent(s.avgCostChangePct)})
                        </span>
                      </span>
                      <span className={toneClass(s.resultPct, false)}>
                        {formatPercent(s.resultPct)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">
                Ingresá un monto (y esperá el precio de mercado) para ver los escenarios.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A lower PPC is the good outcome, so for the PPC change the sign is inverted. */
function toneClass(value: number | null, lowerIsBetter: boolean): string {
  if (value === null || value === 0) return "";
  const good = lowerIsBetter ? value < 0 : value > 0;
  return good ? "text-emerald-400" : "text-rose-400";
}
