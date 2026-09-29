# Dashboard reorganization — phase 2

## Objective
Finish the screen split started in phase 1 (`odd/tasks/dashboard-reorg.md`):
1. **Próximos cobros** on the dashboard "Hoy" tab.
2. **One evolution chart in the app**: `/rendimientos` uses the dashboard `PortfolioEvolutionChart` instead of
   `ValueEvolution`.
3. **Return attribution** in `/rendimientos`: how much each ticker and each sector contributed to the period.

## Findings that shape the design (exploration, 2026-09-29)
- ON future cashflows already exist and are scaled to the user's holding: `resolveBondSchedule` →
  `scaleFlowsToHolding` → `BondCashflowEntry[]`, built inside `getBondsPageDataAction`
  (`src/app/actions/bonds.ts:47`); `buildBondCashflowOutlook` only returns the next payment + yearly totals.
- There is **no announced-dividend source**. The only forward signal is the Yahoo-cadence estimate
  `forecastUpcomingDividends` (`src/lib/dividends/forecast.ts:224`, `isEstimate: true`), which calls Yahoo per
  ticker (slow, external).
- `/rendimientos` is a monthly engine (`buildPerformanceReport`, `series.ts:88`) with its own period selector
  (6M/1A/YTD/ALL); the evolution chart is daily with its own `TimeRangeSelector` and includes ONs.
- Per-ticker monthly gains exist (`attributeMonthlyPositionGains`, `valuation.ts:275`, stored in
  `MonthlyPerformanceRow.positions`) but **exclude income** by design; income is only aggregate per month.
  `series.ts` does not load sectors; the dashboard's sector fallback lives in `src/app/actions/dashboard.ts:129`
  + `translateSector` (`src/lib/dashboard/build.ts:71`).

## Design
- **Próximos cobros**: pure `buildUpcomingIncome(entries, dividendEstimates, ccl, today)` → rows
  `{date, daysUntil, ticker, kind: coupon | amortization | dividend, estimated, amountArs, amountUsd}` sorted
  by date + totals for 30/60/90 days. ON flows are contractual (not estimated); dividends always `estimated`.
  Loaded by its own server action **after** the page renders (client fetch with a loading state) so Yahoo
  latency never blocks the dashboard. Bond cashflow-entry building is extracted from `getBondsPageDataAction`
  into a shared loader so `/bonds` and the dashboard use the same code (no duplication, `/bonds` unchanged).
- **Single chart**: `/rendimientos` loads `loadPortfolioEvolution` (reusing its CCL series) and renders
  `PortfolioEvolutionChart` in place of `ValueEvolution`; the chart owns its daily range, the monthly
  sections keep the existing period selector. Footnote that the chart includes ONs while the monthly
  tables don't (yet). Delete `ValueEvolution` if unused.
- **Attribution**: pure `attributeReturns(rows, groupBy: "ticker" | "sector", currency, sectorOf)` over the
  months of the selected period: per group Σ monthGain; plus an **"Renta (dividendos y cupones)"** row =
  Σ month income; plus a reconciliation row only if Σ ≠ period gain (should be ~0; tested). Sector comes from
  the same 3-step fallback + `translateSector` (extract to a shared helper; load the sector fields in
  `series.ts`). UI: diverging horizontal bars (div-based, palette-safe), toggle Por ticker / Por sector,
  sorted by absolute contribution, total at the bottom.

## Constraints
- Pure logic in `src/lib/**` with vitest (strict TDD); Prisma orchestrators/components untested (convention).
- `/rendimientos` numbers must not change (only additive fields/sections). `/bonds` behavior unchanged.
- Both palettes: zinc/emerald/rose/amber utilities only, no new hex.
- UI copy Spanish, code English.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest).

## Tasks
- [x] T1 Pure `upcoming-income.ts` (+ tests)
- [x] T2 Shared bond cashflow-entries loader (extracted from `bonds.ts`) + `getUpcomingIncomeAction`
- [x] T3 UI "Próximos cobros" panel in the Hoy tab (client-loaded, loading/empty/error states, 30/60/90 toggle)
- [x] T4 `/rendimientos`: evolution chart replaces `ValueEvolution`
- [x] T5 Pure `attribution.ts` (+ tests, incl. reconciliation) and shared sector helper (+ tests)
- [x] T6 `/rendimientos`: load sectors, "Atribución del período" card
- [x] T7 `pnpm test`, `tsc --noEmit`, eslint on touched files; sanity script — done below
      (browser check still pending, needs the user)

## Progress
- Created after exploration.
- T1–T6 implemented by one writer (2026-09-29).
  - **T1** `src/lib/dashboard/upcoming-income.ts` (+ `.test.ts`, 7 tests): `buildUpcomingIncome({bondEntries,
    dividendEstimates, cclRate, today})` → `{rows, totals: {d30,d60,d90}}`. Exported `toArsAndUsd` from
    `src/lib/bonds/cashflows.ts` (was private) instead of re-deriving the CCL conversion. Past flows excluded
    (`daysUntil < 0`); dividends always `estimated: true`, ON flows always `false`; rows sorted by date then
    ticker; missing CCL leaves the unconvertible side `null` per row, totals sum what's measurable (same
    skip-silently convention as `buildBondCashflowOutlook`, not a null-propagating total). RED (module not
    found) → GREEN (7/7): empty, past-exclusion, mixed kinds + sort, estimated flags, CCL present/absent,
    exact 30/60/90-day boundaries (inclusive), stable ticker tiebreak.
  - **T2** `src/lib/bonds/cashflow-entries.ts`: `loadBondCashflowEntries(scope: {userId} | {portfolioIds},
    today?)` — extracted the holdings→schedule→scaled-flows pipeline out of `getBondsPageDataAction`
    (`src/app/actions/bonds.ts`). `bonds.ts` now calls it (parallel with `fetchOnPrices`/`fetchCclQuote`) and
    the old inline `cashflowEntries` array/pushes were deleted; the per-holding analytics loop is untouched
    (needs its own unscaled resolveBondSchedule call regardless — YTM/duration math is separate from the
    outlook). New action `src/app/actions/upcoming-income.ts`: `getUpcomingIncomeAction()` — auth + default
    portfolio (same query shape as the dashboard action), loads bond entries + builds equity holdings for
    `forecastUpcomingDividends`, wraps it in try/catch (`dividendsUnavailable: true` on throw or any
    per-ticker error) so a Yahoo failure never blocks the ON rows.
  - **T3** `src/components/dashboard/upcoming-income-panel.tsx`: client component, `useEffect`+`useState`
    (same pattern as `monitoreo-page.tsx`'s trade-markers fetch — no `use()`/SWR/react-query in this repo),
    loading skeleton (`components/ui/skeleton`), error state, 30/60/90 toggle, list with `DD/MM` date + "en N
    días", kind badge (Cupón/Amortización/Dividendo estimado, "· est." suffix when estimated), amount in
    selected currency, per-window total, amber notice when `dividendsUnavailable`. Wired into the dashboard
    Hoy tab (`dashboard-page.tsx`) right after `DayMovers`.
  - **T4** `src/app/(app)/rendimientos/page.tsx` now loads `loadPortfolioEvolution([portfolio.id])` in
    parallel with `buildPerformanceReport` (`Promise.all`) — decision: did **not** try to share
    `buildPerformanceReport`'s internal CCL series with `loadPortfolioEvolution`, since the former doesn't
    expose it and injecting one would serialize the CCL fetch ahead of both parallel loads instead of leaving
    them concurrent; each loads its own CCL series inside its own internal `Promise.all`. `rendimientos-page.tsx`
    renders `PortfolioEvolutionChart` (imported from `components/dashboard/portfolio-evolution`) instead of
    `ValueEvolution`, with a footnote that the chart includes ONs while the monthly tables don't yet. Deleted
    `value-evolution.tsx` (confirmed via `rg` it had exactly one caller). Measured: `buildPerformanceReport`
    alone ~840ms; `buildPerformanceReport` + `loadPortfolioEvolution` in parallel ~1386ms (real dev DB) — the
    evolution load isn't free but the two run concurrently rather than adding sequentially.
  - **T5** `src/lib/rendimientos/attribution.ts` (+ `.test.ts`, 12 tests): `attributeReturns(rows, groupBy,
    currency, sectorOf)` over already-period-sliced `MonthlyPerformanceRow[]` — per-group Σ `monthGainArs`/
    `monthGainUsd` (skips positions with `monthGainUsd === null`), a separate "Renta (dividendos y cupones)"
    row (`Σ incomeArs/incomeUsd`, never attributed by ticker per `attributeMonthlyPositionGains`'s own
    contract), and a "Otros ajustes" reconciliation row only when `|periodGain − (Σgroups + income)| > 0.5`.
    `total` is always the period gain (same field `PerformanceKpis` shows as "Ganancia del período" via
    `summaryForCurrency`). RED → GREEN (12/12): per-ticker/per-sector sums across months, a position present
    only some months, sort by |contribution| desc, income row, reconciliation absent when the residual is
    ARS-exact (confirmed against the real portfolio too — see sanity output below), reconciliation present
    for a synthetic USD gap, exact 0.5 boundary (≤0.5 no row, >0.5 row), total always equals Σ row(gainArs).
    Shared sector helper: extracted `src/lib/sector.ts` (+ `.test.ts`, 13 tests) — `resolveRawSector` (3-step
    fallback, AD-3 §2.3) + `translateSector` (Yahoo-sector table + per-instrument-type synthesis, was a
    private function in `dashboard/build.ts`) + `resolveSector` (compose both). `build.ts` and
    `app/actions/dashboard.ts` now import from there instead of their own copies (behavior-identical refactor,
    verified by the unchanged 574-test baseline before T6's additions). RED → GREEN (13/13): fallback
    precedence order, translation table + aliases, raw-passthrough, per-type synthesis, "Sin clasificar"
    default, blank-string treated as absent.
  - **T6** `series.ts`: additive `sector`/`baseInstrument.sector`/`underlyingAsset.sector` select fields on the
    existing eligible-instrument query (no new query); builds `sectorByTicker: Record<string,string>` via the
    shared helper once per instrument (sector doesn't vary month to month) and returns it as a new
    `PerformanceReport.sectorByTicker` field (both `emptyReport`s updated, plus the `view.test.ts` fixture).
    `src/components/rendimientos/attribution-card.tsx`: "Atribución del período" card — Por ticker/Por sector
    toggle (same button-group pattern as the period selector), div-based diverging horizontal bars (center
    line, emerald/rose by sign for groups, fixed teal for the income row, fixed amber for reconciliation —
    all existing palette utilities, no new hex), sorted by |contribution| (already sorted by
    `attributeReturns`), total at the bottom. Wired into `rendimientos-page.tsx` right after `PerformanceKpis`,
    fed `sliceMonths(report.months, period)` so it always matches the page's own period selector.

- **Verification**: `pnpm test` 586/586 passed (48 files, +32 net new: 7 upcoming-income + 12 attribution +
  13 sector); `pnpm tsc --noEmit` clean; `pnpm eslint` clean on every touched/created file. Read-only sanity
  script (`scripts/sanity-phase2.ts`, deleted after use) against the real dev DB:
  - (a) `loadBondCashflowEntries` vs. a reimplementation of the pre-extraction inline path: same entry count,
    `buildBondCashflowOutlook` output byte-identical (`JSON.stringify` equal) — the extraction didn't change
    `/bonds`' numbers.
  - (b) `buildUpcomingIncome` for the real portfolio: 75 rows, next 3 all dividend estimates (BBAR, GGAL,
    BBAR) with ARS+USD both populated (CCL was available), totals 30/60/90d ARS 950.10 / 13574.05 / 33190.55.
  - (c) `attributeReturns` for ALL and YTD, by ticker and by sector, ARS: no reconciliation row in either
    (residual "—") — confirms the docstring guarantee (Σ position gains + income == period gain exactly in
    ARS) holds on real data, not just the synthetic test. Top ALL contributor YPFD (+172,156.72 → sector
    Energía), largest YTD detractor GGAL (−53,121.08 → Servicios financieros −72,775.15 once BBAR's own
    negative month is folded in).
  - (d) load time: `buildPerformanceReport` alone ~840ms; with `loadPortfolioEvolution` added in parallel
    ~1386ms.
  - Known environmental failure (non-blocking, disclosed per instructions): none hit this run — `fetchOnPrices`/
    Yahoo all responded (no offline 502s this session); `dividendErrors=0`.

## Limitations / decisions a reviewer should know
- `getUpcomingIncomeAction` and the dashboard action resolve CCL differently in the codebase already existed
  before this change (`resolveCclRate()`, persisted daily) vs. `bonds.ts`'s `fetchCclQuote()` (live, no
  persistence) — I kept `getUpcomingIncomeAction` on `resolveCclRate()` to match "auth + default portfolio
  resolution like the dashboard action" per the task note; `loadBondCashflowEntries` itself is CCL-agnostic
  (returns native-currency flows), so this choice only affects `getUpcomingIncomeAction`'s own ARS conversion.
- `bonds.ts` now does one extra (cheap) DB round-trip for the shared loader in parallel with its existing
  price/CCL fetches — the analytics loop still needs its own unscaled `resolveBondSchedule` call regardless,
  so there was no way to extract cashflow-entries without either a second query or a much larger refactor of
  the per-holding analytics path; a second query in parallel was the lower-risk option given the "extract,
  don't rewrite" constraint.
- Status: **done**.

## Next step
User browser check of the new "Próximos cobros" panel, the `/rendimientos` evolution chart, and the
"Atribución del período" card.

- Independent verification: PASS except one major finding — `/rendimientos` page lost its error resilience
  (`loadPortfolioEvolution` unguarded inside `Promise.all`, a throw would crash the whole page incl. the
  previously hardened monthly report). Fixed with `safeLoadEvolution` (→ `EMPTY_EVOLUTION` + console.error),
  mirroring `safeBuildReport`. Verifier also confirmed units of upcoming income (no double scaling; CEDEAR
  dividends via ratio), `/bonds` extraction faithful, no cross-user leak, attribution reconciles.
