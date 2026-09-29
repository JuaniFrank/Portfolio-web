# Dashboard reorganization — phase 1

## Objective
Give each screen one question to answer:
- **Dashboard → "¿qué pasó hoy / esta semana?"** — short-term results and what needs attention.
- **Composición (dashboard tab) → "¿qué tengo?"** — the portfolio snapshot.
- **Rendimientos → "¿cómo me fue?"** — historical analysis (unchanged in phase 1).

## Problem / why
- The dashboard mixes today's snapshot with since-purchase results ("Mejores/Peores rendimientos" rank
  unrealized P&L since purchase — that is a positions/rendimientos concern; the positions table there is
  already sortable).
- There is no short-term view: nothing answers "how did I do today / this week / this month".
- Data-quality signals (missing CCL, stale prices, estimated ON prices, concentration) are scattered in
  footnotes.
- Composition charts (donut, market, sector, value per stock, concentration) take half the page and are
  looked at occasionally, not daily.

## Scope (phase 1)
1. **Period KPI panel**: Hoy / 7D / 30D / YTD — change in money and TWR %, plus net contributions, in the
   selected currency. Computed client-side from the daily evolution series (full selection). "Hoy" = last
   daily point vs the previous one.
2. **Movers del día**: the last daily point's `gainers`/`losers` (already computed per bucket in
   `evolution.ts`).
3. **Avisos panel**: missing CCL, stale tickers at the last point, ON values estimated at the last point,
   top holding / top-5 concentration above a threshold. Hidden when there is nothing to report.
4. **Tabs "Hoy" | "Composición"** in `/dashboard`:
   - Hoy: period KPIs, current-state KPI cards ("Vista Detallada"), evolution chart (default range 3M),
     movers del día, avisos.
   - Composición: donut, market, sector, value per stock, concentration card.
5. Remove the since-purchase "Mejores/Peores rendimientos" block from the dashboard (the sortable positions
   table in /rendimientos covers it). Keep `TopMovers` code only if still referenced; otherwise delete it.

## Out of scope (phase 2, pending user approval)
- Próximos cobros (ON coupons/amortizations + announced dividends, next 30 days).
- Replace `/rendimientos` `ValueEvolution` with the evolution chart v2 (single value chart in the app).
- Return attribution by ticker/sector in `/rendimientos`.

## Constraints
- Pure logic in `src/lib/dashboard/*` with vitest; components not unit-tested (repo convention).
- Reuse `summarizeRange` / `buildViewRows` (`evolution-view.ts`) and `sliceByRange` / `resolveRangeWindow`
  (`time-range.ts`) — do not re-derive TWR.
- Both palettes (Default / Finanzas) must keep working: use zinc/emerald/rose utilities, no new hex literals.
- UI copy in Spanish, code in English.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). RED → GREEN → REFACTOR for pure modules.

## Tasks
- [x] T1 Pure `period-kpis.ts`: Hoy/7D/30D/YTD windows over the daily series — tests
- [x] T2 Pure `dashboard-notices.ts`: avisos from dashboard data + last evolution point — tests
- [x] T3 UI: period KPI panel, movers del día, avisos components
- [x] T4 UI: dashboard tabs Hoy/Composición, evolution default 3M, remove since-purchase movers
- [ ] T5 `pnpm test`, `tsc --noEmit`, eslint on touched files; browser check by the user
      (automated checks below all green; browser check still pending, needs the user)
- [x] T6 (follow-up, not in original scope) Root-cause fix for "Hoy" exact-$0 bug: echo
      live-quote detection + skip, `EvolutionPoint.isLive`, dynamic "today" label — tests

## Progress
- Created. Verified: positions table in /rendimientos is sortable (`positions-table.tsx:526`); daily points
  carry `gainers`/`losers`; `src/components/ui/tabs.tsx` (Radix) exists; `DEFAULT_TIME_RANGE` is ALL.
- T1–T4 implemented by one writer (2026-09-29).
  - `src/lib/dashboard/period-kpis.ts` (+ `.test.ts`, 8 tests): `buildPeriodKpis(daily, instruments,
    currency, referenceDay?)`. Window rule: each period looks for "the last real close on/before the
    boundary date"; if the series doesn't reach that far back, falls back to the first point and marks
    `partial: true`. `available: false` only when start and end resolve to the *same* point (no second
    point to compare against — covers the single-point series case for every period, not just Hoy).
    Reuses `buildViewRows`/`summarizeRange` (full selection) so the numbers match the evolution chart's
    summary strip exactly. RED confirmed (module not found) → GREEN (8/8, one `toBeCloseTo` precision
    relaxed from 4 to 2 decimals to tolerate `round4` chaining noise).
  - `src/lib/dashboard/dashboard-notices.ts` (+ `.test.ts`, 9 tests): `buildDashboardNotices({cclMissing,
    lastPoint, concentration, holdings?})`. Concentration notice checks `topHoldingPercent > 25` first,
    else `top5Percent > 70` (strict `>`, boundary values tested at exactly 25.00/70.00 → no notice).
    `holdings` accepted in the signature per spec but unused (existing `ConcentrationStats` fields were
    enough). RED → GREEN (9/9).
  - `src/components/dashboard/period-kpis-panel.tsx`, `day-movers.tsx`, `notices-panel.tsx` (new,
    untested per repo convention — pure components, no logic). `day-movers.tsx` reuses the exact
    `EvolutionMover` marker semantics/glyphs (`*` stale, `•` live, `°` hadFlow) already in
    `portfolio-evolution.tsx`'s tooltip, with a compact legend shown only when a marker is present.
    Added `formatSignedMoney` to `format.ts` (shared by both new components; mirrors the private helper
    already in `portfolio-evolution.tsx`, left untouched).
  - `dashboard-page.tsx` restructured: Header + currency toggle stay above the tabs (toggle moved out of
    the old "Análisis Gráfico" row, next to the tab list — applies to both tabs). Tabs "Hoy" (default) |
    "Composición" via **local `useState`, not the URL query** — decision: grepped the repo, found zero
    existing `useSearchParams` usage (only `useRouter`/`usePathname`), so a query-persisted tab would
    have introduced a new pattern (plus a `Suspense` boundary consideration on this dynamic route) for a
    tab that isn't shared/deep-linked. Local state mirrors the currency toggle already on the same
    component. Hoy tab: `NoticesPanel` (replaces the old inline CCL-only warning box — no duplicate
    warning), `PeriodKpisPanel`, "Vista Detallada" `DashboardKpiCards`, evolution chart with
    `initialRange={{preset:"3M",...}}` (added optional `initialRange` prop to `PortfolioEvolutionChart`,
    default unchanged), `DayMovers`. Composición tab: donut, market, sector, value-by-ticker,
    `ConcentrationCard`.
  - Deleted `top-movers.tsx` and the `TopMover`/`topGainers`/`topLosers`/`topGainersUsd`/`topLosersUsd`
    fields from `types.ts` and their construction in `build.ts` — confirmed with `rg` that nothing else
    referenced them before deleting.
  - Verification: `pnpm test` 542/542 passed; `pnpm tsc --noEmit` clean; `pnpm eslint` on every
    touched/created file clean (one `no-unused-vars` warning on an unused `TabsContent` import, fixed).
    Read-only sanity script (`scripts/sanity-dashboard-reorg.ts`, deleted after use) ran
    `getDashboardPageDataAction`'s exact pipeline (bypassing `getCurrentUser()`, which needs a real Next
    request — picked the first active portfolio instead, like `diagnose-rendimientos.ts` does) against
    the real dev DB and printed `buildPeriodKpis` (ARS/USD) and `buildDashboardNotices`: numbers looked
    sane (e.g. Hoy ARS change $0 today, 7D −$99,844.1 / −1.92%, YTD +$346,928.56 / +6.14%; USD windows
    differ from ARS as expected; no notices — CCL present, no stale/estimated tickers, concentration
    under threshold for this portfolio). `refreshLatestQuotes`/`fetchOnPrices` 502'd offline as expected
    (non-blocking, caught in the script).
- T6 follow-up (2026-09-29): the exact-$0 "Hoy" was flagged as suspicious. Diagnosed read-only first
  (throwaway script, deleted): the last daily point had 0/23 instruments with a real EOD bar — it existed
  purely because the live overlay quoted every instrument at exactly its previous close (data912 answered
  pre-open with yesterday's numbers), so `valueArs` was byte-identical to the prior point and
  `gainers=losers=0`. Not partial backfill (both prior days had 23/23 real bars).
  - `src/lib/dashboard/echo-live-snapshot.ts` (+ `.test.ts`, 7 tests): `isEchoLiveSnapshot(liveQuotes,
    lastCloseByInstrument, epsilon=1e-9)` — pure, conservative (no usable quotes → false; a quote for an
    instrument with no previous close → false). RED → GREEN.
  - `evolution-data.ts`: confirmed `overlayLivePrices`/`overlayLiveCcl` (`live-overlay.ts`) are shared with
    `/rendimientos` (`series.ts`) — did **not** touch that shared module or `series.ts`. Instead, scoped
    the fix to the dashboard loader: builds `lastCloseByInstrument` from the raw (pre-overlay) equity
    price rows via `PriceIndex.previousClose`, and when `isEchoLiveSnapshot` is true, passes `[]`/`null`
    into `overlayLivePrices`/`overlayLiveCcl` instead of the real quotes — so no live day is added to
    `tradingDays` and no live CCL point either (decision: skip both together; a live CCL point with no
    matching live price day would be inconsistent, and it'd be inert anyway since `tradingDays` only
    derives from price rows). No dedicated test file (Prisma-touching orchestrator, matches repo
    convention); verified via `tsc` + the sanity script.
  - `evolution.ts`: added `EvolutionPoint.isLive: boolean`. Turned out to need **no new plumbing** —
    `ReplayInputs.liveInstrumentIds` was already threaded through `EvolutionInputs`, and
    `valuatePortfolioAt` already marks each `PositionDetail.priceIsLive` correctly per-close (only true
    when that position's resolved price date is both in `liveInstrumentIds` and is the latest date in its
    series). So `isLive = valuation.positions.some(p => p.priceIsLive)` inside the existing `buildSeries`
    loop was sufficient — same pattern as `hasEstimatedPrices`. 3 new tests in `evolution.test.ts`. Had to
    add `isLive: false` to the `EvolutionPoint` fixture builders in `evolution-view.test.ts`,
    `period-kpis.test.ts`, `dashboard-notices.test.ts` (tsc fallout from the new required field). RED →
    GREEN.
  - `period-kpis.ts`: added exported `formatDDMM` and made the `"today"` KPI's label dynamic — "Hoy" when
    `daily[endIndex].isLive`, else `` `Última rueda ${formatDDMM(date)}` `` (spec: live is the fresh case,
    not-live is "last real close, dated" — inverse of what I first guessed; caught by RED, fixed my own
    test expectations, not the implementation). Applied even when the period is `unavailable` (single-point
    series still gets a real label). 4 new tests. RED → GREEN.
  - `period-kpis-panel.tsx`: mechanical — replaced its private `toDDMM` with the now-centralized
    `formatDDMM` import; no visible/behavioral change (`kpi.label` was already rendered as-is).
  - Verification: `pnpm test` 554/554 passed (45 files); `pnpm tsc --noEmit` clean; `pnpm eslint` on every
    touched/created file clean. Read-only sanity script (`scripts/sanity-echo-fix.ts`, deleted after use)
    against the real dev DB, last 3 daily points + "today" KPI in ARS:
    `2026-09-24 changeArs=+2062.90 isLive=false`, `2026-09-25 changeArs=-10276.70 isLive=false`,
    `2026-09-28 changeArs=-76655.70 isLive=false` — the 09-29 echo point is gone entirely (series now ends
    at 09-28), and `today` KPI reads `label="Última rueda 28/09" change=-76655.70` — the real last-close
    change, not the fake $0.

## Next step
T5: user browser check of the new tabs, panels and 3M-default evolution chart.

- User feedback (2026-09-29): wants the since-purchase "Mejores/Peores rendimientos" back. Reverted its removal
  (`top-movers.tsx`, `TopMover`/`topGainers*`/`topLosers*` in `types.ts`/`build.ts` restored from HEAD) and
  restored the "Salud del Portfolio" section (TopMovers + ConcentrationCard) at the end of the Composición tab,
  replacing the standalone "Concentración" section. tsc/eslint clean, tests 554/554.
