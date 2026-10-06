# Rendimientos: closed positions and realized sales

## Objective
Make sales visible on `/rendimientos`: (1) a position fully sold during a month shows up in "Detalle mensual"
marked as sold, with its month result; (2) a new "Ventas realizadas" section lists every sale (partial too)
with realized P&L against average cost.

## Problem / why
- User report (2026-10-06): a sold ticker does not appear in "Detalle mensual".
- Root cause: `attributeMonthlyPositionGains` (`src/lib/rendimientos/valuation.ts:275`) maps only
  `endPositions`. A ticker fully sold in the month is missing from the per-ticker breakdown, so the documented
  identity "sum of Result. mes = Ganancia mes − renta" breaks in that month.
- No realized P&L (sale vs average cost) is computed anywhere today.

## Decisions
- Keep the two metrics separate: "Result. mes" (vs previous month-end value) stays in the monthly table;
  realized P&L (vs average cost) lives in its own section. Same column would show contradicting numbers.
- USD realized cost uses the CCL of each buy day (same as `costBasisUsd`); proceeds at CCL of the sale day.

## Scope
- In: closed-in-month rows in monthly attribution + "Vendida" badge in `PositionsDetail`; pure realized-sales
  builder; wiring in `series.ts`/types; "Ventas realizadas" section with period total.
- Out: changing portfolio-level gain/return math; tax lots (FIFO) — average cost only.

## Constraints
- Pure logic in `src/lib/**` with vitest; Prisma orchestrators/components untested (convention).
- UI copy Spanish, code English. Both palettes (zinc utilities only).
- Splits: quantities/prices must go through the same event adjustment the replay uses.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). RED → GREEN → REFACTOR for pure helpers.

## Tasks
- [x] T1 Monthly attribution includes positions closed during the month (quantity 0, value 0, monthGain = −startValue − netInvested); test the sum identity
- [x] T2 `PositionsDetail` renders closed rows with a "Vendida" badge; month with only closed positions no longer shows "Sin posiciones abiertas"
- [x] T3 Pure `buildRealizedSales` (per SELL: date, ticker, qty, sale price, avg cost, realized ARS/USD, %, holding days) with tests incl. partial sells and splits
- [x] T4 Wire realized sales into the rendimientos data + "Ventas realizadas" section filtered by the visible period, with total

## Checks
- `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`

## Progress
- 2026-10-06: document created; user approved order T1–T2 then T3–T4.
- 2026-10-06 T1 done: RED (5 new tests failed in valuation.test.ts) -> GREEN (33/33). `attributeMonthlyPositionGains` now emits `closed: true` rows for start-only and flows-only (bought+sold same month, via new `instrumentLookup` param built from trades in series.ts). `positionFigures` nulls price/cost/unrealized for closed rows (RED 1 failed -> GREEN). Identity test added.
- 2026-10-06 T2 done: `SoldBadge` + closed rows sorted after open ones in `PositionsDetail`; quantity shown as EMPTY_VALUE; tsc clean.
- 2026-10-06 T3 done: `src/lib/rendimientos/realized-sales.ts` (`buildRealizedSales`, reuses now-exported `computePositionFromTrades` + `applyEventsToTrade`); RED (module missing) -> GREEN 11 tests; view helpers `salesInMonths`/`realizedFigures`/`totalRealizedPnl` RED (8 failed) -> GREEN (19).
- 2026-10-06 T4 done: `PerformanceReport.realizedSales`, wired in `series.ts`; `src/components/rendimientos/realized-sales.tsx` rendered in `rendimientos-page.tsx` (period filter, currency toggle, total, empty state). Checks: pnpm test 640 passed, tsc clean, lint 0 errors (34 pre-existing warnings).
- 2026-10-06 Independent verification (risk high): no blocking findings; tests 640 passed, tsc clean. Fixed duplicate React key for identical sells (index in key). Follow-up (pre-existing, not in scope): trades ignore `currencyCode`, so a USD-denominated BUY/SELL would mix units — check DB.
- 2026-10-06 User decision: no USD-denominated BUY/SELL exist; keep ARS-only trade amounts for now (currencyCode follow-up deferred). Committed and pushed to main.
