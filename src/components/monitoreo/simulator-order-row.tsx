import { Crosshair, X } from "lucide-react";
import type { OrderDraft, OrderMode, ResolvedDraft } from "@/lib/monitoreo/order-drafts";
import type { TargetSizingFailure } from "@/lib/monitoreo/order-sizing";
import type { BasisOption } from "@/lib/monitoreo/price-basis";
import type { OrderSide } from "@/lib/monitoreo/simulation-ledger";
import type { MonitoringCurrency } from "@/lib/monitoreo/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "./format";
import { Segmented } from "./segmented";

const TARGET_FAILURE_MESSAGES: Record<TargetSizingFailure, string> = {
  invalid: "Revisá los valores ingresados.",
  "no-position": "No tenés posición abierta: no hay PPC para llevar a un objetivo.",
  "not-comparable": "El PPC actual no es comparable en esta escala.",
  "already-at-target": "Ya estás en ese PPC.",
  "wrong-direction":
    "Con ese precio la compra no acerca el PPC al objetivo: comprar por debajo del PPC lo baja; por encima, lo sube.",
  unreachable: "Inalcanzable: el objetivo tiene que quedar entre tu PPC y el precio de compra.",
};

const inputClass =
  "w-full min-w-0 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-teal-700";

const fieldLabelClass = "flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-zinc-500";

/** Reference prices (basis currency, per unit) the chips can fill in; null disables a chip. */
export type PriceReferences = {
  market: number | null;
  lastClose: number | null;
  avgCost: number | null;
};

const DROP_CHIPS = [5, 10, 20];

const formatInputNumber = (value: number) => String(Number(value.toFixed(4)));

interface SimulatorOrderRowProps {
  index: number;
  draft: OrderDraft;
  row: ResolvedDraft;
  active: boolean;
  picking: boolean;
  canRemove: boolean;
  basis: BasisOption | null;
  /** Chart-scale currency: PPC is expressed in it */
  currency: MonitoringCurrency;
  /** Instrument currency of money figures (amounts, realized result) */
  moneyCurrency: MonitoringCurrency;
  /** false: no pesos quote to size money, so Monto mode is unavailable */
  moneyAvailable: boolean;
  references: PriceReferences;
  onChange: (patch: Partial<OrderDraft>) => void;
  onRemove: () => void;
  onActivate: () => void;
  onTogglePick: () => void;
}

function stepSummary(
  row: ResolvedDraft,
  currency: MonitoringCurrency,
  moneyCurrency: MonitoringCurrency,
  moneyAvailable: boolean,
  draft: OrderDraft
) {
  const parts: { text: string; tone?: "warn" | "good" | "bad" | "muted" }[] = [];
  const { sizing, step } = row;

  if (!moneyAvailable && row.order === null && draft.mode === "amount") {
    return [{ text: "Sin cotización en pesos para calcular montos.", tone: "warn" as const }];
  }
  if (sizing?.kind === "target" && !sizing.result.ok) {
    return [{ text: TARGET_FAILURE_MESSAGES[sizing.result.reason], tone: "warn" as const }];
  }
  if (sizing?.kind === "amount" && row.quantity === null) {
    return [{ text: "El monto no alcanza para una unidad entera.", tone: "warn" as const }];
  }
  if (!row.order) {
    return [{ text: "Completá cantidad y precio para ver el efecto.", tone: "muted" as const }];
  }

  if (sizing?.kind === "amount") {
    parts.push({
      text: `= ${row.quantity!.toLocaleString("es-AR")} u. · sobran ${formatCurrency(sizing.leftover, moneyCurrency)}`,
    });
  } else if (sizing?.kind === "target" && sizing.result.ok) {
    // The cost is money: never shown unscaled when there is no pesos quote
    const cost = moneyAvailable ? formatCurrency(sizing.result.cost, moneyCurrency) : "—";
    parts.push({ text: `= ${sizing.result.quantity.toLocaleString("es-AR")} u. (${cost})` });
  }
  if (!step) return parts;

  if (step.side === "buy") {
    parts.push({
      text: `→ ${step.quantityAfter.toLocaleString("es-AR")} u. · PPC ${formatCurrency(step.avgCostAfter, currency)}`,
    });
  } else {
    parts.push({
      text: `→ ${step.quantityAfter.toLocaleString("es-AR")} u. · ${
        step.avgCostAfter === null ? "posición cerrada" : "PPC sin cambios"
      }`,
    });
    parts.push(
      moneyAvailable
        ? {
            text: `realizado ${step.realized >= 0 ? "+" : "−"}${formatCurrency(Math.abs(step.realized), moneyCurrency)}`,
            tone: step.realized >= 0 ? ("good" as const) : ("bad" as const),
          }
        : { text: "realizado —", tone: "muted" as const }
    );
    if (step.clamped) {
      parts.push({
        text: `Vendés más de lo que tenés: se limita a ${step.quantity.toLocaleString("es-AR")} u.`,
        tone: "warn",
      });
    }
  }
  return parts;
}

const TONE_CLASS = {
  warn: "text-amber-500/90",
  good: "text-emerald-400",
  bad: "text-rose-400",
  muted: "text-zinc-500",
} as const;

export function SimulatorOrderRow({
  index,
  draft,
  row,
  active,
  picking,
  canRemove,
  basis,
  currency,
  moneyCurrency,
  moneyAvailable,
  references,
  onChange,
  onRemove,
  onActivate,
  onTogglePick,
}: SimulatorOrderRowProps) {
  const basisCurrency = basis?.currency ?? currency;
  const setSide = (side: OrderSide) =>
    onChange({
      side,
      ...(side === "sell" && draft.mode === "target" ? { mode: "quantity" as const } : {}),
    });

  const priceValue =
    draft.priceText ?? (row.basisPrice !== null ? formatInputNumber(row.basisPrice) : "");

  const chips: { label: string; value: number | null }[] = [
    { label: "Mercado", value: references.market },
    { label: "Último cierre", value: references.lastClose },
    ...DROP_CHIPS.map((drop) => ({
      label: `−${drop} %`,
      value: references.market !== null ? references.market * (1 - drop / 100) : null,
    })),
    { label: "PPC actual", value: references.avgCost },
  ];

  const summary = stepSummary(row, currency, moneyCurrency, moneyAvailable, draft);

  return (
    <div
      onFocusCapture={onActivate}
      className={cn(
        "rounded-md border px-2 py-1.5 transition-colors",
        active ? "border-sky-800/60 bg-zinc-900/70" : "border-zinc-800/80 bg-zinc-900/30"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-300">
          {index + 1}
        </span>
        <Segmented<OrderSide>
          ariaLabel="Tipo de orden"
          value={draft.side}
          onChange={setSide}
          options={[
            { value: "buy", label: "Compra", tone: "buy" },
            { value: "sell", label: "Venta", tone: "sell" },
          ]}
        />
        <Segmented<OrderMode>
          ariaLabel="Cómo definir la cantidad"
          value={draft.mode}
          onChange={(mode) => onChange({ mode })}
          options={[
            { value: "quantity", label: "Cant.", title: "Definir por cantidad de unidades" },
            {
              value: "amount",
              label: "Monto",
              disabled: !moneyAvailable,
              title: moneyAvailable
                ? "Definir por monto a invertir"
                : "Sin cotización en pesos para calcular montos",
            },
            {
              value: "target",
              label: "PPC obj.",
              disabled: draft.side === "sell",
              title:
                draft.side === "sell"
                  ? "Solo disponible para compras"
                  : "Unidades necesarias para llegar a un PPC",
            },
          ]}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Quitar orden"
            aria-label="Quitar orden"
            className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {draft.mode === "quantity" && (
          <label className={fieldLabelClass}>
            Cantidad
            <input
              type="text"
              inputMode="decimal"
              value={draft.quantityText}
              onChange={(e) => onChange({ quantityText: e.target.value })}
              placeholder="0"
              className={inputClass}
            />
          </label>
        )}
        {draft.mode === "amount" && (
          <label className={fieldLabelClass}>
            Monto ({moneyCurrency})
            <input
              type="text"
              inputMode="decimal"
              value={draft.amountText}
              onChange={(e) => onChange({ amountText: e.target.value })}
              placeholder="0,00"
              className={inputClass}
            />
          </label>
        )}
        {draft.mode === "target" && (
          <label className={fieldLabelClass}>
            PPC objetivo ({basisCurrency})
            <input
              type="text"
              inputMode="decimal"
              value={draft.targetText}
              onChange={(e) => onChange({ targetText: e.target.value })}
              placeholder="0,00"
              className={inputClass}
            />
          </label>
        )}

        <label className={fieldLabelClass}>
          Precio ({basisCurrency})
          <span className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={priceValue}
              onChange={(e) => onChange({ priceText: e.target.value })}
              placeholder="0,00"
              className={inputClass}
            />
            <button
              type="button"
              onClick={onTogglePick}
              aria-pressed={picking}
              title={picking ? "Cancelar (Esc)" : "Elegir el precio haciendo clic en el gráfico"}
              aria-label="Elegir precio en el gráfico"
              className={cn(
                "inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border transition-colors",
                picking
                  ? "border-sky-600 bg-sky-950/60 text-sky-300"
                  : "border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-zinc-100"
              )}
            >
              <Crosshair className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        </label>
      </div>

      <p className="mt-1 flex flex-wrap gap-x-2.5 text-[11px] leading-snug" aria-live="polite">
        {summary.map((part) => (
          <span
            key={part.text}
            className={cn("font-mono", part.tone ? TONE_CLASS[part.tone] : "text-zinc-300")}
          >
            {part.text}
          </span>
        ))}
      </p>

      {active && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[10px] uppercase tracking-wide text-zinc-500">Precio</span>
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={chip.value === null}
              onClick={() =>
                chip.value !== null && onChange({ priceText: formatInputNumber(chip.value) })
              }
              title={chip.value !== null ? formatCurrency(chip.value, basisCurrency) : "Sin dato"}
              className="rounded-full border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-40"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
