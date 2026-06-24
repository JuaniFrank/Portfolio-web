# Exploration: spy500-split — Corporate Events (Eventos) feature

## Current State

### Data model (Prisma)

- `Transaction` is the single source of truth for all movements. Fields relevant to corporate actions: `type` (enum `TransactionType`), `quantity`, `price`, `netAmount`, `tradeDate`, `instrumentId`, `idempotencyHash + idempotencyVersion`.
- `TransactionType` already includes `SPLIT`, `REVERSE_SPLIT`, `SPINOFF`, `MERGER`, `ADJUSTMENT` — but these are import artifacts; they are NOT processed by the holdings/position calculation layer.
- `Instrument` has a `conversionRatio Decimal?` field (for CEDEARs), seeded to `10` in `prisma/seed.ts`, but this field is **never read** in any aggregation logic — it is purely metadata.
- No `CorporateEvent` model exists anywhere. No events concept exists in the DB schema.
- `PortfolioSnapshot` stores a JSON `positions` blob, but snapshots are not the primary read path — the dashboard always recomputes from raw `Transaction` rows on every request.

### Position / cost-basis calculation (compute-on-read)

The entire holdings/PPC/P&L pipeline is **stateless and computed on every read**:

1. `getDashboardPageDataAction` (src/app/actions/dashboard.ts) queries all `BUY` / `SELL` transactions for the portfolio, filtered by `TRADE_TYPES = ["BUY", "SELL"]` and `TRADE_INSTRUMENT_TYPES = ["STOCK_AR", "CEDEAR"]`.
2. Raw rows are mapped to `TradeForHoldings` (instrumentId, ticker, type, quantity, price, netAmount, tradeDate).
3. `buildHoldings` (src/lib/transactions/holdings.ts) groups by `instrumentId`, sorts by `tradeDate`, and runs a running PPP accumulator: BUY adds `|netAmount|` to `totalCost` and adds quantity; SELL removes proportional cost and subtracts quantity.
4. Result: `{ quantity, avgPriceArs (PPP), costBasisArs, currentPriceArs (from Yahoo), marketValueArs, pnlArs, pnlPercent }`.
5. `buildDashboardData` (src/lib/dashboard/build.ts) wraps these into KPIs, allocation slices, sector bars, concentration stats, top movers. All derived — no cache.
6. `SPLIT`, `REVERSE_SPLIT`, `ADJUSTMENT` transaction types are **explicitly excluded** from `TRADE_TYPES` — they never enter position math today.

### Dividends

- `getDividendsPageDataAction` (src/app/actions/dividends.ts) queries `DIVIDEND_CASH` + `TAX_WITHHOLDING` transactions independently, then recomputes holdings from `BUY`/`SELL` to get current quantities.
- `aggregateReceivedDividends` (src/lib/dividends/aggregate.ts) groups dividends by `ticker|date|currency` and matches tax rows. Amounts are stored in `Transaction.netAmount` — they represent the **actual cash received**, not a per-share amount.
- `forecastUpcomingDividends` (src/lib/dividends/forecast.ts) calls Yahoo for historical dividend events (per share), multiplies by current holding quantity. The per-share amount from Yahoo reflects the underlying asset (SPY), not the CEDEAR ratio. If the CEDEAR ratio changes and the user's quantity triples, forecasts auto-correct because they use current holding quantity.
- Historical `ReceivedDividend.grossAmount` is the cash actually received — already ratio-correct for its date. No adjustment needed for past dividends; only forecasts are quantity-sensitive.

### Market data / quotes

- `refreshLatestQuotes` (src/lib/market/quotes.ts): fetches Yahoo prices per instrument, caches in `PriceCache` for 10 min. Prices are market prices in native currency — they are NOT affected by CEDEAR ratio changes (Yahoo reflects the post-split price automatically).
- `PriceCache` rows are live and expire quickly — they don't need retroactive adjustment.

### Import system

- `movimientos.xlsx` is parsed by `parseBalanzRows` (src/lib/importers/balanz.ts). Rows with `Movimiento Manual` description map to `ADJUSTMENT` type, which is excluded from holdings math.
- `idempotencyHash + idempotencyVersion` on `Transaction` provides deduplication. A corporate action applied twice with the same hash would be skipped on import, but a manually inserted row would not have this protection.
- `ImportBatch` tracks `status: PENDING | PREVIEW | COMMITTED | REVERTED | FAILED` — a full revert mechanism exists at the batch level for imports, not for individual corporate events.

### Routing and sidebar

- All app routes live under `src/app/(app)/` using the `(app)` route group with a shared layout (Sidebar + Header).
- Sidebar (`src/components/layout/sidebar.tsx`) is a static array of `{ href, label, icon }` — adding a new route is a one-line addition.
- Pattern for a new page: route at `src/app/(app)/events/page.tsx`, Server Action at `src/app/actions/events.ts`, lib logic at `src/lib/events/`, components at `src/components/events/`.

### UI patterns

- Server Component page → calls one Server Action → passes typed data to a Client Component page shell.
- KPI grid: `rounded-xl border border-zinc-800 bg-zinc-900/40 p-4`, `grid gap-3 lg:grid-cols-3`.
- Stat cards with `text-xs font-medium uppercase tracking-wide text-zinc-500` label + `HelpCircle` tooltip.
- Chart cards via `ChartCard` wrapper with title, description, and icon.
- Currency toggle (ARS/USD) is a thin client-side state pattern — no server round-trip.
- Color system: `zinc-950` background, `zinc-900` cards, `teal-400`/`emerald-400` positive, `rose-400` negative.

---

## Affected Areas

- `prisma/schema.prisma` — new `CorporateEvent` model + `CorporateEventType` enum + `User` relation
- `src/lib/transactions/holdings.ts` — `buildHoldings` must accept `events` and apply ratio adjustments to pre-event trades
- `src/lib/transactions/types.ts` — `TRADE_TYPES` stays as-is; events are a separate concern
- `src/app/actions/dashboard.ts` — pass events to `buildHoldings`
- `src/app/actions/transactions.ts` — pass events to `buildHoldings`
- `src/app/actions/dividends.ts` — the inline `computeHoldings` duplicate must be unified and made event-aware
- `src/lib/dividends/forecast.ts` — auto-corrects if positions are correct (no direct change needed)
- `src/lib/market/quotes.ts` — unaffected
- `src/components/layout/sidebar.tsx` — add `/events` entry
- New files: `src/app/(app)/events/page.tsx`, `src/app/actions/events.ts`, `src/lib/events/build.ts`, `src/lib/events/types.ts`, `src/components/events/`

---

## Approaches

### Approach A — Query-time adjustment (recommended)

A new `CorporateEvent` table stores `{ id, instrumentId, eventType, effectiveDate, numerator, denominator, notes, appliedAt, createdBy }`. All aggregation code reads events for affected instruments and applies the adjustment factor to transactions whose `tradeDate < effectiveDate` before computing positions.

In the holdings builder, before adding a trade: if its `tradeDate` is before any corporate event effective date, multiply `quantity` by `numerator/denominator` and divide `price` by the same factor. `netAmount` (total ARS cost) is invariant — cost basis doesn't change, only per-unit quantities and prices.

**Pros**
- Fully reversible — delete the event row, recompute, done.
- Auditable — all source transactions are intact.
- Idempotent by design — `UNIQUE(instrumentId, effectiveDate, eventType)` constraint.
- Future events (reverse splits, mergers, ticker changes) add new event types without touching transaction rows.
- Dividend forecasts auto-correct because they use quantity derived from adjusted holdings.
- Historical received dividends do NOT need adjustment — amounts are cash received, not per-share.

**Cons**
- Every `buildHoldings` call must receive and apply events. Currently 3 call sites.
- Slight CPU overhead per request (one extra DB query for events + loop adjustment). Negligible at portfolio scale.
- The `computeHoldings` function inside `dividends.ts` is a duplicate of `buildHoldings` — both must be kept in sync or refactored to share.

**Effort**: Medium

### Approach B — Write-time mutation

Applying an event writes adjusted `quantity` and `price` values back onto existing `Transaction` rows before the effective date.

**Pros**: Zero aggregation changes; trivial read perf.
**Cons**: IRREVERSIBLE without an undo log; audit trail destroyed; double-mutation guard required; violates append-only ledger integrity.
**Effort**: Medium (low implementation, HIGH operational risk)

### Approach C — Append-only adjustment transactions

Applying an event inserts new `SPLIT` transactions with zero cost and quantity delta. The holdings aggregator must be taught to handle `SPLIT` rows as "add quantity, don't add cost".

**Pros**: Uses existing `TransactionType.SPLIT`; append-only; revert by deleting the SPLIT row.
**Cons**: `price` column on the SPLIT row would be misleading; idempotency requires composite hash; linking generated rows back to the event requires a new FK or notes convention.
**Effort**: Medium (smaller DB surface, more fragile math and linking complexity)

### Approach D — Instrument-level ratio event table (`ConversionRatioEvent`)

Narrowly scoped to CEDEAR ratio changes — `Instrument.conversionRatio` evolves via an event log.

**Pros**: Semantically precise for CEDEARs.
**Cons**: Too narrow — doesn't generalize to stock splits, mergers, reverse splits.
**Effort**: Medium (same as A, less value)

---

## Recommendation

**Approach A** — dedicated `CorporateEvent` table with query-time application.

The codebase is already entirely compute-on-read. Adding an event layer to the read path is architecturally consistent. Reversibility is a hard requirement for financial data. Approach B is disqualifying. Approach C requires the same code changes as A but has worse idempotency/revert ergonomics. Approach D is too narrow.

### Proposed schema

```prisma
enum CorporateEventType {
  CEDEAR_RATIO_CHANGE   // CEDEAR conversion ratio adjustment (e.g., 20:1 → 60:1)
  STOCK_SPLIT           // n:1 split of underlying shares
  REVERSE_SPLIT         // 1:n reverse split
  SPINOFF               // Shares of new entity issued to holders
  MERGER                // Shares converted to acquirer at a ratio
  TICKER_CHANGE         // Symbol rename (no quantity/price effect)
}

model CorporateEvent {
  id              String             @id @default(cuid())
  instrumentId    String
  instrument      Instrument         @relation(fields: [instrumentId], references: [id])
  eventType       CorporateEventType
  effectiveDate   DateTime
  numerator       Decimal            @db.Decimal(20, 8)
  denominator     Decimal            @db.Decimal(20, 8)
  notes           String?
  appliedAt       DateTime           @default(now())
  createdByUserId String
  createdByUser   User               @relation(fields: [createdByUserId], references: [id])

  @@unique([instrumentId, effectiveDate, eventType])
  @@index([instrumentId])
}
```

### Holdings builder change

`buildHoldings(trades, prices, events?)`: `events` is `Map<instrumentId, CorporateEvent[]>`. For each trade, if any event has `effectiveDate > trade.tradeDate`, multiply `quantity` by `numerator/denominator` and divide `price` accordingly. `netAmount` is NOT changed.

### Call sites to update

1. `getDashboardPageDataAction`
2. `getTransactionsPageDataAction`
3. `getDividendsPageDataAction` — also unify its inline `computeHoldings` duplicate

---

## Edge Cases and Risks

1. **Pre-event vs post-event boundary**: only transactions with `tradeDate < effectiveDate` adjusted. Boundary is exclusive — on/after the effective date trades are already at the new ratio.
2. **Historical received dividends**: cash amounts, no adjustment needed. Forecasts auto-correct via current quantity.
3. **Idempotency**: `@@unique(instrumentId, effectiveDate, eventType)` prevents DB-level duplicates; UI must also guard.
4. **Reversibility**: delete the row → next request recomputes without it. Source transactions never mutated.
5. **`PortfolioSnapshot` stale data**: snapshot blobs become stale after retroactive events. Not blocking today, but must be addressed before historical TWR features.
6. **`computeHoldings` duplication** in `dividends.ts` must be unified before events can be applied consistently.
7. **Multiple events per instrument**: must apply chronologically; effects compose multiplicatively.
8. **Ticker-change events**: no quantity/price math — display-only.
9. **CEDEAR ratio vs underlying split**: same math, different audit label. UI must make the distinction clear.

---

## Ready for Proposal

Yes. Key decisions for proposal phase:
- Use a dedicated `CorporateEvent` table (Approach A).
- Holdings builder signature extended with optional `events` parameter.
- Unify duplicated `computeHoldings` in dividends action.
- UI: `/events` route with list, register form (symbol picker, type, effective date, ratio), and confirmation step.
- The SPY 3:1 CEDEAR ratio change is the first concrete test case.
