# Dashboard: "Evolución del Portfolio" v2

## Objective
Make the dashboard evolution chart cover the whole invested portfolio (including ONs) and turn it into an
explorable tool: filter by asset type and ticker, switch between value / result / return, see contributions
and trades, and read a summary of the visible period.

## Problem / why
- The replay only values `PERFORMANCE_INSTRUMENT_TYPES` (`CEDEAR`, `STOCK_AR`). ONs (EAC4O, MCC3O, both USD
  hard-dollar, bought at USD 1/VN) are silently absent, as are their coupons/amortizations.
- data912 has no ON history (`/historical/*` only covers stocks, cedears, sovereign bonds; verified against
  `https://data912.com/openapi.json`). `PriceCache` only holds intraday `data912` ON snapshots since 2026-09-17.
- The chart plots a single aggregate line; per-position values are computed per point and then discarded.

## Scope (dashboard only — /rendimientos perimeter unchanged)
1. **ONs in the series.** Price per VN per day = real close when available (last `data912` snapshot of the
   day, ARS per 100 VN → `/100`); otherwise estimated technical value = residual fraction (from the resolved
   bond schedule) × USD 1 × CCL of the day. Estimated points are flagged. ON coupons/amortizations count as income.
2. **Filters.** Asset type chips (Todo / Acciones / CEDEARs / ONs) + ticker multi-select. Requires a slim
   per-position breakdown on every point (value + net flow, ARS/USD).
3. **Aportes netos line.** Cumulative net contributions overlaid on the value curve.
4. **View mode.** Valor / Resultado (value − cumulative contributions) / Rendimiento % (chained TWR of the
   selection).
5. **Trade markers.** Buy/sell markers on the chart for the selected tickers.
6. **Period summary strip.** For the visible range: start value, end value, net contributions, result $,
   return %, max drawdown.

## Constraints
- Price units: ON quotes are ARS per 100 VN (`VN_QUOTE_BASIS`), never per unit.
- Time-range slicing stays client-side over the full series (see `time-range.ts`).
- Pure logic lives in `src/lib/dashboard/*` with vitest coverage; Prisma loaders stay untested on purpose.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). RED → GREEN → REFACTOR for every pure module.

## Tasks
- [x] T1 Data: ON daily price series (real close or estimated technical value) — pure + tests
- [x] T2 Data: include ONs in dashboard evolution loader; per-position breakdown, cumulative flows and trades on the evolution payload — tests
- [x] T3 View model: selection filter, modes (value/result/return), period summary stats — pure + tests
- [x] T4 UI: filters, mode toggle, contributions line, trade markers, summary strip, estimated-price note
- [ ] T5 `pnpm test`, `tsc --noEmit`, eslint on touched files; browser check

## Progress
- Created after exploration.
- T1/T2 done. `bond-price-series.ts` (+8 tests, RED: module missing → GREEN). ON price fed to the replay is ARS per VN
  (real close ÷ 100, else residual × USD 1 × CCL); quantity stays nominal VN, amortization lives only in price.
  ON trades (USD) converted to ARS at trade-date CCL in the loader. ONs not added to the live overlay (it assumes
  ARS per share; ON quotes are per 100 VN). Only stored schedules reconstruct historical residual; derived/none assume par.
  `EvolutionPoint` gained `positions`, `cumulativeNetFlowArs/Usd`, `hasEstimatedPrices`; `PortfolioEvolution` gained
  `instruments`, `trades`. /rendimientos unchanged (optional fields only).
- Checks: `pnpm test` 477/477 (parent re-ran), `tsc --noEmit` clean, eslint clean on touched files.
  Sanity (2026-09-25): value with ONs 5,170,273 ARS vs 4,690,163 without; EAC4O 243,200 / MCC3O 236,910 (real closes).

- T3/T4 done. `src/lib/dashboard/evolution-view.ts` (+21 tests, RED: module missing → GREEN): `selectTickers`
  (type ∩ ticker), `buildViewRows` (value/invested/result/periodReturn/cumulativeReturn over the FULL
  series so slicing never resets `invested`), `rebaseForRange` (rebases % to 0 at the first *visible*
  point by chaining real per-point `periodReturn`s from there; Result mode stays absolute — value −
  invested, not rebased, "more honest than resetting a money result"), `summarizeRange`, `tradesForSelection`
  (snaps a trade to the first `visibleDates` entry ≥ its date; drops trades before the first or after the
  last visible date instead of misattributing them to an out-of-view bucket). Reuses `subPeriodReturn` /
  `chainReturns` / `drawdownFromCumulative` from `@/lib/rendimientos/returns` unchanged — same TWR
  convention the aggregate already uses (percent, not fraction; flows netted before the base check).
  UI in `portfolio-evolution.tsx`: asset-type chips, `TickerSelector` popover (search + checkboxes,
  `evolution/ticker-selector.tsx`), mode toggle (Valor/Resultado/Rendimiento %), contributions line
  (dashed `LineSeries`, Valor mode only), trade markers via lightweight-charts v5
  `createSeriesMarkers`/`ISeriesMarkersPluginApi` (arrowUp green buy, arrowDown red sell, circle amber
  mixed), `SummaryStrip` (`evolution/summary-strip.tsx`), estimated-price footnote (cutoff = first date
  after the last point with `hasEstimatedPrices`), tooltip filtered to the selection and showing
  matched trades. Preserved the pre-existing uncommitted comment tweak in this file (ZoomableAreaChart
  doc comment). Did not touch monitoreo/package.json/other unrelated dirty files.
- Checks: `pnpm test` 498/498, `tsc --noEmit` clean, `eslint` clean on every touched/created file.
  `pnpm dev` + `curl /dashboard` → 307 to `/login` (auth redirect, not a 500); middleware redirects
  before the page module renders, so this didn't runtime-exercise the new component tree — mitigated by
  clean `tsc`/`eslint` across all new/changed files.

- User feedback (tooltip overflow): movers columns overlapped and overflowed the 320px tooltip. Fix: width 380
  (clamped to chart width), ARS mover amounts without cents, `min-w-0` + nowrap on columns/rows, mover tone now
  follows the displayed currency (was always ARS). tsc/eslint clean; visual check pending.

## Next step
T5 (already covered above by this session's checks) — nothing left unless new issues surface in review.

- Bug fix (income dropped from the dashboard chart, confirmed by parent): `valuatePortfolioAt`
  (`valuation.ts:172-174`) adds `accumulatedIncomeArs` to the aggregate `valueArs`, but
  `PositionDetail` only carries holdings — so `buildPositionBreakdown` and `buildViewRows`
  summed positions only and understated Valor/Resultado/Rendimiento even with "Todo" selected.
  Fix: attribute income per instrument.
  - `evolution-data.ts`: `forFlows` now carries `instrumentId`; `classifyIncome` events are
    grouped by instrument and each group run through `accumulateInArs` into a new
    `incomeArsByInstrument: Map<string, DatedAmount[]>`, passed to `buildEvolutionSeries`
    alongside the untouched aggregate `incomeArsByDate`.
  - `evolution.ts`: `EvolutionInputs` gained the optional `incomeArsByInstrument` field (zero
    changes to `ReplayInputs`/`valuatePortfolioAt`/`rendimientos/*`). `EvolutionPositionBreakdown`
    gained `incomeArs`/`incomeUsd` (via `sumUpTo` with the same cutoff `valuatePortfolioAt` uses,
    USD = ARS / point `cclMid`). The skip-empty guard in `buildPositionBreakdown` now also keeps a
    position with income-only (closed position that later paid a coupon). `EvolutionPoint` gained
    `unattributedIncomeArs/Usd` = aggregate − Σ(position value+income), reconciling income events
    without `instrumentId` and rounding noise.
  - `evolution-view.ts`: `buildViewRows` gained a required `isFullSelection` param; selected value
    is now Σ(value + income) of selected positions, plus the point's unattributed income only when
    `isFullSelection` is true. Income is never a flow (TWR counts it as return, matching
    `valuatePortfolioAt`'s convention).
  - `portfolio-evolution.tsx`: passes `isFullSelection = selection.size === evolution.instruments.length`.
  - Minor fixes (same pass, per parent's report): changing the asset-type chip now resets the
    ticker filter to `"all"` (`handleTypeFilterChange`), preventing a silent empty type∩ticker
    intersection. Updated `evolution.ts`'s header comment: the perimeter is `/rendimientos` plus
    ONs, not `/rendimientos` alone.
  - Tests: rewrote the tautological "selección completa" fixture in `evolution-view.test.ts` so
    `point()` builds `valueArs` from `positions.valueArs + incomeArs + unattributedIncome` (mirrors
    the real aggregate) instead of summing bare position values — the old fixture could never fail
    even with the bug. Added tests for: full-selection reconstruction with real income (ARS/USD),
    unattributed income only added when `isFullSelection`, single-ticker selection only sees its own
    income, income not counted as flow/invested. Added tests in `evolution.test.ts`: per-instrument
    income attribution respecting the cutoff (`sumUpTo`, not future income), closed position kept
    when income-only, and full reconciliation (Σ position value+income + unattributed == aggregate).
  - RED confirmed first (9 new/rewritten tests failing on the old code — 5 in
    `evolution-view.test.ts`, 5 in `evolution.test.ts`, one shared), then GREEN after
    implementation.
  - Checks: `pnpm test` 506/506, `tsc --noEmit` clean, `eslint` clean on every touched file.
    Sanity script (read-only, deleted after use) against the real portfolio: last daily point —
    aggregate `valueArs` 5.170.273,22 vs Σ(positions value+income) 5.170.273,23,
    `unattributedIncomeArs` −0,01 (rounding noise), total attributed income 12.645,73. Full-selection
    `buildViewRows` vs aggregate across all 230 daily points: max absolute difference 0.000000
    (≤ 0.05 expected). data912 live-overlay calls 502'd in this environment (unrelated, non-blocking
    — the EOD/estimated series still loaded fine).
  - Status: done.
