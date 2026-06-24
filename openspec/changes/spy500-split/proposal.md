# Proposal — spy500-split: Corporate Events ("Eventos")

**Change name**: `spy500-split`
**Status**: Proposal
**Artifact store**: hybrid (engram + openspec)
**Delivery strategy**: single-pr
**Date**: 2026-06-09

---

## 1. Why

The SPY CEDEAR (Argentine receipt tracking the S&P 500 ETF) underwent a technical conversion-ratio change from 20:1 to 60:1. Holders received 3x the units automatically and the per-unit price was divided by three; total economic position is unchanged. This is a **CEDEAR ratio change**, not a split of the underlying SPY ETF.

The portfolio app today has no concept of corporate actions in its position-calculation layer:

- `TransactionType` already includes `SPLIT`, `REVERSE_SPLIT`, `SPINOFF`, `MERGER`, `ADJUSTMENT`, but those rows are **explicitly excluded** from `TRADE_TYPES` and never enter holdings math.
- `Instrument.conversionRatio` exists but is never read by any aggregation.
- The dashboard, transactions view, and dividends view all recompute positions from raw `BUY`/`SELL` rows on every read, so a ratio change produces:
  - Wrong quantity (still shows pre-event units against a now post-event Yahoo price)
  - Distorted P&L (cost basis correct in ARS total, but per-unit PPP shown at pre-event scale against post-event market price)
  - Distorted allocation/concentration/top-movers (rely on derived market value)
  - Distorted dividend forecast (forecast = current quantity × Yahoo per-share; if quantity is wrong, forecast is wrong)

Without a structured way to record corporate events, the user has only two bad options: (a) manually edit historical transactions (destroying the audit trail and idempotency hashes from the importer) or (b) ignore the discrepancy and accept wrong numbers. Both are unacceptable for a portfolio tracker whose value proposition is "trust the dashboard".

The SPY case is the immediate trigger, but the same problem will recur with future CEDEAR ratio changes, stock splits, reverse splits, spinoffs, mergers, and ticker renames — all common corporate actions for the BCBA / NYSE instruments the app already supports.

## 2. What changes

The user gets a new **Eventos** section in the app that lets them:

- Register a corporate event for a specific instrument: event type, effective date, ratio (numerator/denominator), optional notes.
- See a list of all registered events across the portfolio, ordered by effective date.
- Delete an event (which acts as an undo — positions recompute on the next read with the event removed).
- See, across the rest of the app (dashboard, transactions, dividends), positions/P&L/allocations/forecasts that respect every registered event automatically.

The first concrete use case shipped with this change is the SPY CEDEAR 3:1 event, registered as `CEDEAR_RATIO_CHANGE` with numerator 3 / denominator 1 on the appropriate effective date.

## 3. Non-goals (out of scope for this change)

This change is **not** doing any of the following:

- **Automated event detection** from broker feeds, Yahoo, or any external API. All events are user-entered.
- **Multi-currency event scenarios** beyond ARS. Cost basis is tracked in ARS; this change does not introduce currency conversion for events.
- **Retroactive dividend amount adjustment**. `ReceivedDividend.grossAmount` represents cash actually received and is already correct for its date. Forecasts auto-correct because they multiply current (adjusted) quantity by Yahoo per-share. We do **not** rewrite historical dividend amounts.
- **`PortfolioSnapshot` regeneration**. Existing snapshots are not in the primary read path and may go stale after an event is added. We accept this for now (deferred).
- **Audit log UI** for who applied which event when. The `appliedAt` and `createdByUserId` fields are persisted but not surfaced in the UI in this slice.
- **Bulk event import or CSV upload**. Events are entered one at a time through the form.
- **Per-event impact preview** (showing the diff to positions before confirming). The confirm step exists; a calculated preview does not.
- **Mergers/spinoffs that change `instrumentId`**. Schema supports the event type; the holdings math for cross-instrument flows is deferred. `TICKER_CHANGE` is supported (no quantity/price math).
- **Editing an existing event**. Edit = delete + recreate. No in-place edit UI.

## 4. Approach summary

Approach A from the exploration: a dedicated `CorporateEvent` table with **query-time adjustment**. Source `Transaction` rows are never mutated. On every read, the holdings builder receives the list of events for the affected instruments and applies the ratio to any transaction whose `tradeDate < event.effectiveDate` (multiply quantity, divide per-unit price; total `netAmount` cost in ARS is invariant). Deleting an event row is sufficient rollback because nothing was ever materialized. Idempotency comes from a `UNIQUE(instrumentId, effectiveDate, eventType)` constraint. Multiple events on the same instrument compose chronologically.

This is consistent with the existing compute-on-read architecture and avoids introducing materialized adjustment rows, undo logs, or destructive edits.

## 5. Impacted surfaces

### Schema
- `prisma/schema.prisma` — new `CorporateEvent` model + `CorporateEventType` enum + relation on `Instrument` + migration.

### Position / holdings math
- `src/lib/transactions/holdings.ts` — `buildHoldings` signature extended to accept events; pre-accumulation ratio adjustment for any trade whose `tradeDate < event.effectiveDate`.
- `src/lib/transactions/types.ts` — no change to `TRADE_TYPES` (events are NOT transactions; the existing `SPLIT`/`REVERSE_SPLIT` transaction-type rows from the importer remain excluded).

### Call sites that read events and pass them to `buildHoldings`
- `src/app/actions/dashboard.ts` — `getDashboardPageDataAction`.
- `src/app/actions/transactions.ts` — `getTransactionsPageDataAction`.
- `src/app/actions/dividends.ts` — `getDividendsPageDataAction`. Also: the inline `computeHoldings` duplicate inside this file is removed and replaced with a call to the shared `buildHoldings` (unification sub-task).

### Routing, server actions, UI
- New route: `src/app/(app)/events/page.tsx` (Server Component shell).
- New server action file: `src/app/actions/events.ts` — list, create, delete actions.
- New lib: `src/lib/events/` — `types.ts`, `apply.ts` (pure function that adjusts a trade given an event list), `validations.ts` (zod schemas).
- New components: `src/components/events/` — page shell (client), events list table, create-event form (react-hook-form + zod), delete-confirmation dialog.
- `src/components/layout/sidebar.tsx` — one-line addition for the `/events` entry (Calendar/Activity icon).

### Dividends & quotes (no change required)
- `src/lib/dividends/forecast.ts` — uses current quantity, which auto-corrects via the adjusted holdings. No code change.
- `src/lib/dividends/aggregate.ts` — operates on cash amounts. No change.
- `src/lib/market/quotes.ts` — `PriceCache` is short-lived (10 min) and stores live market prices, which Yahoo already returns post-event. No change.

## 6. First slice (MVP scope — what lands in this single PR)

1. **Schema and migration**
   - `CorporateEventType` enum with: `CEDEAR_RATIO_CHANGE`, `STOCK_SPLIT`, `REVERSE_SPLIT`, `SPINOFF`, `MERGER`, `TICKER_CHANGE`.
   - `CorporateEvent` model with: `id`, `instrumentId` (FK + index), `eventType`, `effectiveDate`, `numerator Decimal`, `denominator Decimal`, `notes String?`, `appliedAt`, `createdByUserId` (FK to `User`).
   - `@@unique([instrumentId, effectiveDate, eventType])`.
   - Prisma migration generated and committed.

2. **Holdings builder is events-aware**
   - `buildHoldings(trades, prices, eventsByInstrumentId?)` — new optional third argument: `Map<string, CorporateEvent[]>` (events sorted by `effectiveDate` ascending).
   - For each trade, before accumulating: walk events for that instrument; for each event where `trade.tradeDate < event.effectiveDate`, multiply quantity by `numerator/denominator` and divide `price` by the same factor. `netAmount` (total ARS cost) is unchanged.
   - Composition: multiple events on the same instrument are applied in chronological order.

3. **Unify duplicate `computeHoldings`**
   - `src/app/actions/dividends.ts` currently has an inline `computeHoldings` near-duplicate of `buildHoldings`. Remove the duplicate; use the shared `buildHoldings` with events.

4. **Three call sites updated**
   - `getDashboardPageDataAction`, `getTransactionsPageDataAction`, `getDividendsPageDataAction` each query events for the relevant instruments and pass them to `buildHoldings`.

5. **UI — `/events` route**
   - List view: table of events ordered by `effectiveDate desc`, showing ticker, event type, effective date, ratio (e.g. "3:1" rendered from numerator/denominator), notes preview, delete button.
   - Create form: instrument picker (autocomplete from existing portfolio instruments), event type (select), effective date (date picker), numerator + denominator (numeric inputs with constraint > 0), notes (textarea). Submit triggers a server action; on success the list refreshes.
   - Confirm-before-apply: the create action is two-step — submit shows a confirmation dialog summarizing the event, then a second click commits. No calculated preview of position impact (deferred).
   - Delete = undo: a single confirmation, then the row is removed; the next dashboard read recomputes without the event.

6. **Sidebar**
   - Add `/events` entry between `/dividends` and `/imports` (or equivalent — final position decided in design).

7. **Seed/demo data**
   - **Not** seeded. The user will register the SPY 3:1 event through the UI as the first real use case after the PR merges. (This keeps the migration clean.)

## 7. Deferred follow-ups (explicitly NOT in this slice)

- **Per-event impact preview** before confirming (showing diff to quantity / PPC / market value).
- **Edit-in-place** for events (today: delete + recreate).
- **Audit log UI** surfacing `appliedAt` / `createdByUserId`.
- **`PortfolioSnapshot` invalidation/regeneration** when an event is added retroactively.
- **Automated event detection** from broker feed or Yahoo.
- **Cross-instrument events** (spinoffs that issue a new instrument, mergers that retire one and issue another) — the enum value exists but the math/UI is not built.
- **Bulk event import / CSV.**
- **Additional event categories** beyond the initial six.
- **Multi-currency event scenarios.**

## 8. Success criteria

1. After registering the SPY CEDEAR 3:1 event through the `/events` UI with the correct effective date, the dashboard shows:
   - SPY quantity equal to 3× the sum of pre-event BUY rows minus 3× the sum of pre-event SELL rows, plus 1× any post-event BUY/SELL.
   - SPY PPP (avg price ARS) equal to the pre-event PPP divided by 3 (on a portfolio composed entirely of pre-event trades) or the correctly composed value for mixed pre/post portfolios.
   - SPY total cost basis in ARS unchanged versus pre-event computation.
   - SPY P&L = `marketValue - costBasis` using post-event Yahoo price × post-event quantity.
2. Allocation/concentration/top-movers, sector bars, and value bars on the dashboard reflect the adjusted SPY position with no manual reload required.
3. Dividends forecast for SPY uses the adjusted (post-event) quantity automatically; historical received dividends are **unchanged** in amount.
4. Transactions page shows the same underlying raw rows as before (never mutated), but its summary/holdings totals match the dashboard.
5. Deleting the event from `/events` returns every value above to its pre-event state on the next read.
6. Re-creating the same `(instrumentId, effectiveDate, eventType)` returns a clear DB-level idempotency error surfaced as a user-facing validation message.
7. `pnpm lint` and `pnpm tsc --noEmit` both pass on the change.
8. Total changed lines stay within ~400 (single-PR budget). If approach decisions during design push above this, flag before specs.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `buildHoldings` signature change ripples to 3 call sites and any test fixtures. | Make the third argument optional (default `undefined` → behaves like today). Audit all callers in design phase. |
| `computeHoldings` duplicate in `dividends.ts` and `buildHoldings` could drift again. | Unification is part of the MVP, not a follow-up. The dividends action calls the shared function. |
| Composing multiple events on the same instrument could produce off-by-one rounding errors against `Decimal(20,8)` ratios. | Use `Decimal.js` (already in Prisma's runtime) for all ratio math inside `buildHoldings`. Document the multiplication order. |
| The `effectiveDate` boundary semantics (inclusive vs exclusive) is easy to get wrong. | Spec phase nails this down: a trade on `effectiveDate` is **post-event** (not adjusted). Document in the proposal-spec handoff and in code comments. |
| `PortfolioSnapshot` stale data after retroactive event. | Documented as known limitation; deferred until snapshots are wired into a read path. |
| Single-PR budget (~400 lines) may be tight given new schema + migration + UI + 3 call-site edits. | If design phase projects the diff above the budget, surface the risk before specs and either reduce UI ambition (e.g. drop the delete-confirmation dialog or merge form into list view) or request `size:exception`. |
| Manual entry of ratio could be wrong (e.g. user enters 1/3 instead of 3/1 for the SPY case). | Form validation: numerator and denominator must both be > 0; show a worked example ("3:1 split → numerator 3, denominator 1; reverse 1:3 → numerator 1, denominator 3"). Confirmation dialog summarizes "Your X units will become Y" or shows the multiplier explicitly. |
| `instrumentId` picker on the create form needs to scope to the user's portfolio (not all instruments in DB). | Server-side filter on the autocomplete query. |
| Test coverage today is zero (no test runner). Regressions on holdings math are silent. | Keep the holdings function pure with explicit inputs/outputs so vitest can be added later. Add a `// TODO(tests):` marker on the core branch points. Accept the gap for this slice. |

## 10. Open questions (need product/UX answer before specs)

1. **Confirmation UX**: confirm dialog only, or confirm dialog **plus** a server-computed preview of the new position values (which would add an extra round-trip and ~30–60 lines of code)? — Default in proposal: confirm-only, no calculated preview (deferred).
2. **Effective date input**: free date picker, or a curated list of "known dates" we provide? — Default: free date picker.
3. **Currency view for the events list**: show ratios only (currency-agnostic) or also a per-event ARS impact column? — Default: ratios only; no ARS column (deferred).
4. **Sidebar position**: where does `/events` sit? Between `/dividends` and `/imports`, or under a "Configuración" submenu? — Default: between `/dividends` and `/imports`.
5. **`TICKER_CHANGE` semantics**: this slice persists the enum value but does the holdings builder ignore it (no math) and is the ticker update on `Instrument` out of scope? — Default: enum persisted, holdings builder no-ops for `TICKER_CHANGE`, no `Instrument.ticker` mutation in this slice.
6. **Delete confirmation copy**: should the delete dialog warn "this will recompute X positions"? — Default: generic "Delete this event?" without computed counts.
