# Corporate Events — Specification
# Change: spy500-split

**Type**: New capability (no existing spec to delta against)
**Delivery**: single-pr
**Date**: 2026-06-09

---

## 1. Glossary

| Term | Definition |
|------|------------|
| **CorporateEvent** | A persisted record describing a corporate action that affects the quantity or per-unit price of an instrument in the portfolio (e.g., ratio change, split). |
| **eventType** | Enum value (`CorporateEventType`) classifying the nature of the event: `CEDEAR_RATIO_CHANGE`, `STOCK_SPLIT`, `REVERSE_SPLIT`, `SPINOFF`, `MERGER`, `TICKER_CHANGE`. |
| **effectiveDate** | The calendar date from which the event takes effect. Trades whose `tradeDate >= effectiveDate` are post-event and are NOT adjusted. |
| **ratio** | The factor expressed as `numerator / denominator`. For a 3:1 split: `numerator=3, denominator=1`. New quantity = old quantity × ratio; new per-unit price = old per-unit price ÷ ratio. |
| **pre-event trade** | A `Transaction` row where `tradeDate < effectiveDate`. This trade MUST be adjusted by the ratio before entering holdings math. |
| **post-event trade** | A `Transaction` row where `tradeDate >= effectiveDate`. This trade is already at the post-event scale. It MUST NOT be adjusted. |
| **ratio application** | Multiplying a pre-event trade's quantity by `numerator/denominator` and dividing its per-unit price by the same factor. `netAmount` (total ARS cost) is invariant. |
| **event composition** | When multiple events exist for the same instrument, events are applied in ascending chronological order of `effectiveDate`. Each event's ratio is applied to the running adjusted values, not the originals. |
| **undo (delete = revert)** | Deleting a `CorporateEvent` row causes all subsequent reads to recompute holdings without that event. No additional undo log is needed. |

---

## 2. Functional Requirements

### FR-1: Create Event

The system MUST allow an authenticated user to register a `CorporateEvent` via a form. The form MUST collect: instrument (from the user's current portfolio), `eventType`, `effectiveDate` (free date picker), `numerator` (integer > 0), `denominator` (integer > 0), and optional notes. Submission MUST be rejected if any required field is missing. Numerator and denominator MUST each be > 0 — the system MUST reject zero and negative values both client-side (zod) and server-side (Server Action validation). The instrument picker MUST be scoped to instruments held by the authenticated user's portfolio.

### FR-2: Preview Before Confirm

The system MUST implement a two-step create flow. After the form is submitted, the server MUST compute a preview showing: projected post-event quantity, projected post-event PPP (price per unit), and current market value (invariant). The user MUST review this preview and explicitly click "Confirm" to persist the event. Cancelling the preview MUST NOT persist any record.

### FR-3: List Events

The system MUST display all registered `CorporateEvent` rows for instruments held by the authenticated user's portfolio, ordered by `effectiveDate` descending (most recent first). Columns MUST include: ticker, event type label, effective date, ratio rendered as `N:D` (e.g., "3:1"), notes (if present), and a delete action. ARS impact column MUST NOT be shown.

### FR-4: Delete Event (Undo)

The system MUST allow the user to delete any listed event. Deleting an event MUST cause the next read to recompute holdings without it (no additional data mutations). A confirmation dialog MUST be shown with the copy "¿Eliminar este evento?" before the deletion is executed.

### FR-5: Holdings Builder — Events-Aware

The system MUST extend `buildHoldings` to accept an optional `events` parameter (`Map<string, CorporateEvent[]>`). For each trade, if the instrument has one or more events and `trade.tradeDate < event.effectiveDate`, the system MUST apply the ratio: multiply `quantity` by `numerator/denominator` and divide the per-unit `price` by the same factor. `netAmount` MUST remain unchanged. Events MUST be applied in chronological order when multiple events exist for the same instrument.

### FR-6: Holdings Unification

The system MUST eliminate the inline `computeHoldings` duplicate inside `getDividendsPageDataAction` and replace it with a call to the shared `buildHoldings` function. After unification, all three call sites (`getDashboardPageDataAction`, `getTransactionsPageDataAction`, `getDividendsPageDataAction`) MUST use the same `buildHoldings` implementation.

### FR-7: Idempotency

The system MUST enforce a `UNIQUE(instrumentId, effectiveDate, eventType)` constraint at the database level. Attempting to register a duplicate event MUST NOT result in a 500 error — the system MUST surface a user-facing validation error explaining the conflict.

### FR-8: Sidebar Entry

The system MUST add a `/events` navigation entry to the sidebar, positioned between `/dividends` and any future `/imports` entry.

### FR-9: Form Validation

The system MUST validate all form fields before submission. Required fields: `instrumentId`, `eventType`, `effectiveDate`. Numeric fields: `numerator > 0`, `denominator > 0`. Validation MUST run client-side via zod and MUST be re-validated server-side in the Server Action.

### FR-10: TICKER_CHANGE No-Op

When the registered event has `eventType = TICKER_CHANGE`, the holdings builder MUST apply zero quantity or price adjustment (no-op). The event MUST be persisted normally (same schema, same idempotency constraint). `Instrument.ticker` MUST NOT be mutated by this slice.

### FR-11: Effective Date Boundary

The system MUST treat `effectiveDate` as an exclusive lower bound for adjustment. Specifically: `tradeDate < effectiveDate` → trade IS adjusted. `tradeDate >= effectiveDate` → trade IS NOT adjusted. This boundary MUST be documented in the `buildHoldings` implementation.

### FR-12: Scope — Portfolio-Filtered Events Query

The system MUST filter the events query to instruments held by the authenticated user's portfolio. An unauthenticated user MUST NOT access any events data.

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | `pnpm lint` and `pnpm tsc --noEmit` MUST pass with zero errors. |
| NFR-2 | Ratio arithmetic MUST use `Decimal.js` (available from Prisma runtime) to avoid float drift. `numerator` and `denominator` columns MUST be `Decimal(20, 8)` in the schema. |
| NFR-3 | The events list page MUST NOT issue more than 1 additional DB query beyond the instrument IDs already loaded. A single `findMany` filtered by those instrument IDs is the required pattern. |
| NFR-4 | The preview computation MUST reuse `buildHoldings`. A parallel preview math implementation MUST NOT exist. |
| NFR-5 | `buildHoldings` MUST remain a pure function. The `events` parameter is optional and defaults to no-op so existing call sites are unaffected before migration. |

---

## 4. Scenarios

#### Scenario FR-1-A: Create event — happy path

- GIVEN the user holds SPY CEDEARs (at least one BUY before 2025-01-01)
- WHEN the user opens /events, fills the form with instrument=SPY, type=CEDEAR_RATIO_CHANGE, effectiveDate=2025-01-01, numerator=3, denominator=1, and submits
- THEN the server returns a preview showing projected quantity = pre-event BUY qty × 3, projected PPP = pre-event PPP ÷ 3, market value unchanged
- AND the user clicks Confirm
- THEN a CorporateEvent row is persisted
- AND the events list shows the new entry

#### Scenario FR-1-B: Create event — instrument not in portfolio rejected

- GIVEN an instrument that is NOT held in the user's portfolio
- WHEN the user attempts to select it in the instrument picker
- THEN the instrument does NOT appear in the picker options

#### Scenario FR-2-A: Preview reflects adjusted holdings

- GIVEN SPY has 10 pre-event BUYs and 0 post-event trades
- WHEN the user submits the create form with numerator=3, denominator=1
- THEN the preview shows quantity=30, PPP=(original PPP / 3), market value invariant
- AND no CorporateEvent row exists in the DB yet

#### Scenario FR-2-B: Cancel preview does not persist

- GIVEN the preview is shown
- WHEN the user clicks Cancel
- THEN no CorporateEvent row is created
- AND the events list is unchanged

#### Scenario FR-3-A: Events list ordering

- GIVEN two events exist: SPY 2025-01-01 and MELI 2024-06-01
- WHEN the user visits /events
- THEN the list shows SPY 2025-01-01 first, MELI 2024-06-01 second

#### Scenario FR-4-A: Delete event reverts dashboard

- GIVEN the SPY CEDEAR_RATIO_CHANGE event is registered and the dashboard shows SPY quantity = 30
- WHEN the user opens the delete confirmation, confirms "¿Eliminar este evento?"
- THEN the CorporateEvent row is deleted
- AND the dashboard now shows SPY quantity = 10 (pre-event)

#### Scenario FR-5-A: Pre-event trades adjusted, post-event trades not

- GIVEN SPY has 5 BUYs on 2024-12-01 (pre-event) and 2 BUYs on 2025-02-01 (post-event)
- AND a CEDEAR_RATIO_CHANGE event with effectiveDate=2025-01-01 and ratio=3:1 is registered
- WHEN buildHoldings runs
- THEN the 2024-12-01 BUYs have quantity × 3 and price ÷ 3 applied
- AND the 2025-02-01 BUYs are used as-is
- AND the resulting quantity = (5 × 3) + 2 = 17

#### Scenario FR-5-B: Composition of two events

- GIVEN SPY has a 2:1 event on 2023-01-01 and a 3:1 event on 2025-01-01
- AND a BUY of 4 units on 2022-06-01 (pre-both)
- WHEN buildHoldings composes events chronologically
- THEN the 2022-06-01 BUY contributes quantity = 4 × 2 × 3 = 24
- AND PPP reflects division by 6

#### Scenario FR-6-A: Dividends action uses shared buildHoldings

- GIVEN the dividends action previously used an inline computeHoldings
- WHEN getDividendsPageDataAction is called after an SPY event is registered
- THEN the dividend forecast quantity matches the dashboard quantity for SPY

#### Scenario FR-7-A: Duplicate event returns validation error

- GIVEN a CEDEAR_RATIO_CHANGE for SPY on 2025-01-01 already exists
- WHEN the user submits the same (instrumentId=SPY, effectiveDate=2025-01-01, eventType=CEDEAR_RATIO_CHANGE)
- THEN the Server Action returns a validation error message (not a 500)
- AND no duplicate row is created

#### Scenario FR-9-A: Zero denominator rejected

- GIVEN the user fills the form with denominator=0
- WHEN the form is submitted (client-side)
- THEN a validation error is shown before any server request is made

#### Scenario FR-9-B: Server-side re-validation

- GIVEN a malformed request bypasses the client (e.g., via curl)
- WHEN the Server Action receives numerator=0
- THEN it returns a structured error response — no DB write occurs

#### Scenario FR-10-A: TICKER_CHANGE does not alter quantities

- GIVEN a TICKER_CHANGE event is registered for SPY with effectiveDate=2025-01-01, numerator=1, denominator=1
- WHEN buildHoldings runs
- THEN SPY quantity, PPP, and cost basis are identical to the result without the event

#### Scenario FR-11-A: Effective date boundary — trade on effectiveDate not adjusted

- GIVEN a BUY on 2025-01-01 (equal to effectiveDate)
- AND a CEDEAR_RATIO_CHANGE with effectiveDate=2025-01-01 and ratio=3:1
- WHEN buildHoldings runs
- THEN the 2025-01-01 BUY is NOT adjusted (tradeDate >= effectiveDate)

#### Scenario FR-12-A: Out-of-portfolio instrument not queryable

- GIVEN instrument AAPL is not held by the user
- WHEN the events API is queried for AAPL
- THEN no data is returned for AAPL

#### Scenario: Dividend forecast auto-corrects after event

- GIVEN SPY has 10 shares and no event registered
- AND the dividend forecast shows forecast = 10 × estimatedAmountPerShare
- WHEN a 3:1 CEDEAR_RATIO_CHANGE event is registered and confirmed
- THEN the dividend forecast shows forecast = 30 × estimatedAmountPerShare

#### Scenario: Historical received dividends unchanged after event

- GIVEN a DIVIDEND_CASH transaction for SPY on 2024-06-01 with netAmount=150 ARS
- WHEN a CEDEAR_RATIO_CHANGE event is registered with effectiveDate=2025-01-01
- THEN the received dividend record still shows 150 ARS (cash amounts are not adjusted)

---

## 5. Out of Scope

- Automated event detection from broker feeds or external APIs.
- Multi-currency event scenarios beyond ARS.
- Retroactive dividend amount adjustment (received cash amounts are already correct).
- PortfolioSnapshot regeneration or invalidation after retroactive events.
- Audit log UI (`appliedAt` / `createdByUserId` persisted but not surfaced).
- Bulk event import or CSV upload.
- Edit-in-place for existing events (delete + recreate instead).
- Cross-instrument flows: spinoff issuing a new instrument, merger retiring one and issuing another.
- `TICKER_CHANGE` mutating `Instrument.ticker` in this slice.
- Per-event ARS impact column in the events list.

---

## 6. Acceptance Checklist (used by sdd-verify)

- [ ] **FR-1**: Authenticated user can submit the create-event form; all required fields are enforced.
- [ ] **FR-2**: Two-step flow: preview is shown before persist; cancelling preview leaves DB unchanged.
- [ ] **FR-3**: Events list shows all portfolio events ordered by effectiveDate desc; columns: ticker, type, date, ratio (N:D), notes, delete.
- [ ] **FR-4**: Delete confirmation uses "¿Eliminar este evento?" copy; event is removed and next read recomputes without it.
- [ ] **FR-5**: `buildHoldings` accepts optional events map; pre-event trades are adjusted by ratio; post-event trades are not; netAmount invariant; multiple events compose chronologically.
- [ ] **FR-6**: `getDividendsPageDataAction` no longer contains an inline `computeHoldings` — it calls `buildHoldings`.
- [ ] **FR-7**: Duplicate (instrumentId, effectiveDate, eventType) returns a user-facing validation error, not a 500.
- [ ] **FR-8**: Sidebar shows `/events` link between `/dividends` and the next entry.
- [ ] **FR-9**: `numerator <= 0` or `denominator <= 0` is rejected client-side and server-side.
- [ ] **FR-10**: `TICKER_CHANGE` event is persisted but `buildHoldings` applies no quantity or price adjustment.
- [ ] **FR-11**: Trades with `tradeDate >= effectiveDate` are NOT adjusted; trades with `tradeDate < effectiveDate` ARE adjusted.
- [ ] **FR-12**: Events query is scoped to the authenticated user's portfolio instruments; unauthenticated requests are rejected.
- [ ] **NFR-1**: `pnpm lint` and `pnpm tsc --noEmit` pass with zero errors.
- [ ] **NFR-2**: Ratio math uses `Decimal.js`; schema columns are `Decimal(20, 8)`.
- [ ] **NFR-3**: Events page issues at most 1 additional DB query (single `findMany` by instrument IDs).
- [ ] **NFR-4**: Preview reuses `buildHoldings`; no parallel preview math function exists.
