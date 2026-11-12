import { Plus, RefreshCw, RotateCcw } from "lucide-react";
import type { MarketQuote } from "@/lib/monitoreo/load-quote";
import type { OrderDraft, ResolvedDraft } from "@/lib/monitoreo/order-drafts";
import type { BasisOption, PriceBasis } from "@/lib/monitoreo/price-basis";
import type { LedgerResult } from "@/lib/monitoreo/simulation-ledger";
import type { PositionSummary } from "@/lib/monitoreo/trade-markers";
import type { MonitoringCurrency } from "@/lib/monitoreo/types";
import { formatCurrency, formatPercent } from "./format";
import { Segmented } from "./segmented";
import { SimulationInsights } from "./simulation-insights";
import { SimulatorOrderRow, type PriceReferences } from "./simulator-order-row";
import { StatTile, toneForValue, type StatTone } from "./stat-tile";

const NOT_COMPARABLE_REASON =
  "No se puede simular en esta escala: falta el precio equivalente de alguna compra o hubo un evento corporativo (split, cambio de ratio) posterior.";

/** Lowering the PPC is the point of averaging down, so a drop reads as positive. */
function toneForAvgCostChange(change: number): StatTone {
  return toneForValue(change === 0 ? 0 : -change);
}

interface BuySimulatorProps {
  /** Changes with the instrument / series kind: resets the insights' local state */
  scopeKey: string;
  /** Why the last price-basis switch was refused, if it was */
  notice: string | null;
  drafts: OrderDraft[];
  rows: ResolvedDraft[];
  onDraftChange: (id: string, patch: Partial<OrderDraft>) => void;
  onAddDraft: () => void;
  onRemoveDraft: (id: string) => void;
  onReset: () => void;
  activeDraftId: string | null;
  onActivateDraft: (id: string) => void;
  /** Draft whose price is being picked on the chart, if any */
  pickingId: string | null;
  onTogglePick: (id: string) => void;
  /** Commission input (percent, raw text) shared by every order */
  feeText: string;
  onFeeChange: (value: string) => void;
  feePct: number;
  /** Price bases of the instrument (empty: no selector) and the effective/other ones */
  bases: BasisOption[];
  basis: BasisOption | null;
  otherBasis: BasisOption | null;
  onBasisChange: (basis: PriceBasis) => void;
  /** "CEDEARs" / "acciones": the unit of the quantity */
  unitsLabel: string;
  /** Live market price in chart scale; `{ price: null }` when no source answered, null while unknown */
  quote: MarketQuote | null;
  quoteLoading: boolean;
  /** Market price in the basis (per unit) and the same price in the other basis, if known */
  marketPrice: number | null;
  equivalentMarketPrice: number | null;
  references: PriceReferences;
  /** Refetches the quotes and drops every typed price in favor of them */
  onRefreshQuote: () => void;
  position: PositionSummary | null;
  /** null when no order is valid yet or the position is not comparable */
  result: LedgerResult | null;
  /** Price (chart scale) the result and break-even are measured against */
  referencePrice: number | null;
  currency: MonitoringCurrency;
  /** Instrument currency for money figures; `moneyFactor` null means they can't be computed */
  moneyCurrency: MonitoringCurrency;
  moneyFactor: number | null;
}

const SOURCE_LABELS: Record<string, string> = { "data912-live": "data912", yahoo: "Yahoo" };

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** data912 has no exchange timestamp: its time is when we asked ("consultado"). */
function marketHint(quote: MarketQuote | null, loading: boolean): string {
  if (quote?.price != null) {
    const source = SOURCE_LABELS[quote.source] ?? quote.source;
    if (!quote.asOf) return source;
    return quote.source === "data912-live"
      ? `${source} · consultado ${formatTime(quote.asOf)}`
      : `${source} · ${formatTime(quote.asOf)}`;
  }
  return loading ? "buscando…" : "último cierre";
}

const feeInputClass =
  "w-16 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-teal-700";

export function BuySimulator({
  scopeKey,
  notice,
  drafts,
  rows,
  onDraftChange,
  onAddDraft,
  onRemoveDraft,
  onReset,
  activeDraftId,
  onActivateDraft,
  pickingId,
  onTogglePick,
  feeText,
  onFeeChange,
  feePct,
  bases,
  basis,
  otherBasis,
  onBasisChange,
  unitsLabel,
  quote,
  quoteLoading,
  marketPrice,
  equivalentMarketPrice,
  references,
  onRefreshQuote,
  position,
  result,
  referencePrice,
  currency,
  moneyCurrency,
  moneyFactor,
}: BuySimulatorProps) {
  const moneyAvailable = moneyFactor !== null;
  const money = (value: number) => (moneyAvailable ? formatCurrency(value, moneyCurrency) : "—");
  const moneyHint = moneyAvailable ? undefined : "Sin cotización en pesos para calcular montos";
  const blocked = position !== null && position.quantity > 0 && position.avgCost === null;
  const hasPosition = position !== null && position.quantity > 0;
  const totals = result?.totals ?? null;
  const hasSells = result?.steps.some((s) => s.side === "sell") ?? false;
  const firstInvestment = result?.steps.find((s) => s.side === "buy")?.cash ?? null;
  const activeId = activeDraftId ?? drafts[drafts.length - 1]?.id ?? null;

  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      {/* Context: price basis and commission on one compact row */}
      <div className="flex items-end justify-between gap-2">
        {bases.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Precio en</span>
            <Segmented<PriceBasis>
              ariaLabel="Precio en"
              value={basis?.basis ?? bases[0]!.basis}
              onChange={onBasisChange}
              options={bases.map((option) => ({
                value: option.basis,
                label: option.label,
                disabled: !option.available,
                title: option.available ? undefined : "Sin cotización para convertir a esta escala",
              }))}
            />
          </div>
        ) : (
          <span className="text-[10px] text-zinc-500">Cantidades en {unitsLabel}</span>
        )}
        <label className="flex shrink-0 flex-col gap-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
          Comisión %
          <input
            type="text"
            inputMode="decimal"
            value={feeText}
            onChange={(e) => onFeeChange(e.target.value)}
            placeholder="0"
            title="Se aplica a todas las órdenes simuladas (compra: sube el costo; venta: baja lo cobrado)"
            className={feeInputClass}
          />
        </label>
      </div>
      {notice && <p className="text-[11px] text-amber-500/90">{notice}</p>}

      {/* Market price the untouched rows follow */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/30 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">
            Mercado {basis ? basis.unitLabel : ""}
          </p>
          <p className="truncate font-mono text-sm text-zinc-100">
            {formatCurrency(marketPrice, basis ? basis.currency : currency)}
          </p>
          <p className="truncate text-[10px] text-zinc-500" aria-live="polite">
            {marketHint(quote, quoteLoading)}
            {otherBasis?.available && equivalentMarketPrice !== null && (
              <>
                {" "}
                · ≈ {formatCurrency(equivalentMarketPrice, otherBasis.currency)}{" "}
                {otherBasis.unitLabel}
              </>
            )}
          </p>
          {otherBasis && !otherBasis.available && !quoteLoading && (
            <p className="text-[10px] text-amber-500/80">
              Sin cotización para convertir a {otherBasis.label}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefreshQuote}
          disabled={quoteLoading}
          aria-label="Actualizar precio de mercado"
          title="Actualizar con el precio de mercado (reemplaza los precios escritos)"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/80 text-zinc-300 transition-colors hover:text-zinc-100 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${quoteLoading ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </div>

      {/* Orders */}
      <div className="flex flex-col gap-1.5">
        {drafts.map((draft, index) => {
          const row = rows[index];
          if (!row) return null;
          return (
            <SimulatorOrderRow
              key={draft.id}
              index={index}
              draft={draft}
              row={row}
              active={draft.id === activeId}
              picking={pickingId === draft.id}
              canRemove={drafts.length > 1}
              basis={basis}
              currency={currency}
              moneyCurrency={moneyCurrency}
              moneyAvailable={moneyAvailable}
              references={references}
              onChange={(patch) => onDraftChange(draft.id, patch)}
              onRemove={() => onRemoveDraft(draft.id)}
              onActivate={() => onActivateDraft(draft.id)}
              onTogglePick={() => onTogglePick(draft.id)}
            />
          );
        })}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddDraft}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Agregar orden
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Limpiar
          </button>
        </div>
      </div>

      {/* Combined result: compact two-column tiles */}
      {blocked ? (
        <p className="text-xs text-zinc-500">{NOT_COMPARABLE_REASON}</p>
      ) : totals ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <StatTile
              label="PPC simulado"
              value={totals.avgCost === null ? "—" : formatCurrency(totals.avgCost, currency)}
              sub={
                hasPosition ? `(antes ${formatCurrency(position.avgCost, currency)})` : undefined
              }
              stacked
            />
            {totals.avgCostChangePct !== null && (
              <StatTile
                label="Variación PPC"
                value={formatPercent(totals.avgCostChangePct)}
                sub={formatCurrency(totals.avgCostChange, currency)}
                tone={toneForAvgCostChange(totals.avgCostChange)}
                stacked
              />
            )}
            <StatTile
              label="Cantidad nueva"
              value={totals.quantity.toLocaleString("es-AR")}
              sub={hasPosition ? `(antes ${position.quantity.toLocaleString("es-AR")})` : undefined}
              stacked
            />
            <StatTile
              label="Resultado vs. último"
              value={formatPercent(totals.unrealizedPct)}
              sub={hasPosition ? `(antes ${formatPercent(position.unrealizedPct)})` : undefined}
              tone={toneForValue(totals.unrealizedPct)}
              stacked
            />
            {totals.totalInvested > 0 && (
              <StatTile
                label="Inversión"
                value={money(totals.totalInvested)}
                sub={
                  totals.totalFees > 0 && moneyAvailable
                    ? `(com. ${money(totals.totalFees)})`
                    : undefined
                }
                title={moneyHint}
                stacked
              />
            )}
            {hasSells && (
              <StatTile
                label="Cobrado"
                value={money(totals.totalProceeds)}
                sub={
                  totals.totalInvested === 0 && totals.totalFees > 0 && moneyAvailable
                    ? `(com. ${money(totals.totalFees)})`
                    : undefined
                }
                title={moneyHint}
                stacked
              />
            )}
            {hasSells && (
              <StatTile
                label="Realizado"
                value={money(totals.totalRealized)}
                tone={moneyAvailable ? toneForValue(totals.totalRealized) : "neutral"}
                title={moneyHint}
                stacked
              />
            )}
          </div>
          {feePct > 0 && hasPosition && (
            <p className="text-[10px] text-zinc-500">
              El PPC actual sale de tus operaciones registradas (precio de cada operación, sin
              comisiones); la comisión se aplica solo a las órdenes simuladas.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">Ingresá cantidad y precio para ver el nuevo PPC.</p>
      )}

      {!blocked && (
        <SimulationInsights
          key={scopeKey}
          position={position}
          result={result}
          referencePrice={referencePrice}
          marketPrice={marketPrice}
          factor={basis ? basis.factor : 1}
          feePct={feePct}
          defaultAmount={moneyAvailable ? firstInvestment : null}
          currency={currency}
          moneyCurrency={moneyCurrency}
          moneyFactor={moneyFactor}
        />
      )}
    </div>
  );
}
