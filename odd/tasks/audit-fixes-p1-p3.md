# Audit fixes: correctness (P1), resilience/performance (P2), code health (P3)

## Objective
Fix the problems found in the 2026-10-21 read-only audit, blocks P1–P3. Security (P0) is explicitly out of scope
(user decision 2026-10-21: personal project, revisit later).

## Problem / why
- P1: several money paths can show false numbers (currency mixing, unpriced ON valued at 0, silent quote failures,
  dividend currency, manual trade timestamps, bond coupon projection).
- P2: no error boundaries; ineffective `revalidate` on /rendimientos; repeated auth lookups; Yahoo refetch after hours;
  snapshot cron aborts on one failure.
- P3: dead legacy import modal chain and stubs; page loaders in `"use server"` files; no lazy chart loading;
  god components; no mobile layout.

## Decisions
- P0 (security: secrets, cron auth, CVEs, rate limit) is out of scope.
- 2026-10-06 the user deferred the `currencyCode` fix because no USD-denominated BUY/SELL exist. It is now in scope
  because the user requested all of P1 on 2026-10-21; the fix must be a no-op for ARS-only data.
- Kept as-is on purpose: 41 duplicate groups, `rowNumber` in the idempotency hash.
- Each finding reported by the audit but not spot-verified must be confirmed in code before it is changed; if it
  turns out false, record that and skip it.

## Scope
- In: tasks below.
- Out: security; DB schema changes that require a migration unless unavoidable (the DB is disposable — reset, not
  migrate); `pnpm build` (it runs `prisma migrate deploy`).

## Constraints
- Pure logic in `src/lib/**` with vitest; Prisma orchestrators/components untested (convention).
- UI copy Spanish, code/comments English. Both palettes (zinc utilities only).
- Next.js 16: read `node_modules/next/dist/docs/` before using caching, error boundaries or dynamic imports.
- ~400 changed lines per task is an advisory planning heuristic only, not a cap.

## TDD
Strict TDD on (source: global CLAUDE.md). Runner: `pnpm test` (vitest). RED → GREEN → REFACTOR for pure helpers.

## Tasks
### P1 — correctness
- [x] T1 Shared trade mapper that converts USD-denominated trades to ARS at the trade-date CCL (extract from `dashboard/evolution-data.ts`); use it in `rendimientos/series.ts`, `calculations/performance.ts`, `actions/dashboard.ts`, `actions/transactions.ts`; fix `bonds/holdings.ts` units
- [x] T2 Unpriced ON: `market/data912.ts` rejects `c <= 0`; `bonds/portfolio-bridge.ts` values an unpriced ON at cost with a stale flag instead of 0
- [x] T3 Quote failures surfaced: dashboard/performance keep the `errors` from quote refresh and mark affected positions stale (notice), instead of silently using cost
- [x] T4 Dividends: use `isUsdCurrency` in `dividends/aggregate.ts`, `dividends/forecast.ts pickCurrency`, `bonds/cashflows.ts computeCouponsYtd`; withholding bucket consumed once; verify and fix the CEDEAR forecast fallback ratio
- [x] T5 Manual trades stored at 12:00Z like imports (create and edit paths in `actions/transactions.ts`)
- [x] T6 Bond cashflows: coupon accrues on principal at period start (same-day amortization); coupon dates anchored to issue date (verify first)

### P2 — resilience / performance
- [x] T7 `error.tsx` for `(app)`, `global-error.tsx`, `not-found.tsx`
- [x] T8 `getCurrentUser` wrapped in React `cache()`; replace the ineffective `revalidate = 300` on /rendimientos with real per-user caching of the heavy report, invalidated by transaction/import/event mutations
- [x] T9 Quote freshness based on fetch time, not last-trade time (verify first; avoid migration if possible)
- [x] T10 Snapshot cron: per-portfolio try/catch, partial-failure summary

### P3 — code health
- [x] T11 Delete dead code: legacy import modal chain, empty stubs, unused ui wrappers/deps (verify each)
- [x] T12 Move page data loaders out of `"use server"` files into plain server modules
- [x] T13 `next/dynamic` for heavy charts; lazy `import("xlsx")`
- [x] T14 Split `portfolio-evolution.tsx` and `unified-review-step.tsx` into hooks + presentational pieces (no behavior change)
- [x] T15 Mobile layout: collapsible sidebar below `md`

## Checks
- `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit` after every task.

## Progress
- 2026-10-21: document created; user authorized P1, P2 and P3 (not P0).
- 2026-10-21 T1 done: new pure `transactions/trade-currency.ts` (`convertTradeToArs`, 9 tests; RED=suite failed to load, GREEN=9/9) used by evolution-data, rendimientos/series, performance, actions/dashboard, actions/transactions (the latter now loads the CCL series; `tradePricesAndAmounts` uses `isUsdCurrency`). `bonds/holdings.ts computePosition`: USD codes feed USD cost directly, other currencies are ARS converted to USD at trade-date CCL (3 new tests, RED 2 failed -> GREEN 7/7). ARS-only path unchanged (string passthrough).
- 2026-10-21 T2 done: new pure `market/data912-parse.ts` (`parseLiveOnQuote`/`parseCachedClose`, require c > 0; wired into `data912.ts` live + cache paths); `valuateOnPositions` values an unpriced ON at cost (ARS and USD, P&L 0) and carries `priceUnavailable`/`priceStale`; `bond-price-series` ignores snapshots with close <= 0 (finding confirmed: a stored 0 was taken as a real close). RED: 4 tests failed + parse suite failed to load; GREEN 26/26 across the 3 files.
- 2026-10-21 T3 done: finding confirmed (`errors` dropped, avgPrice used silently). `refreshLatestQuotes` now also returns `failedIds`; new pure `dashboard/price-issues.ts` (`classifyQuoteCoverage`, `onPriceIssues`, `mergePriceIssues`, 4+1+1 tests); `DashboardData.priceIssues` feeds two new notices in `buildDashboardNotices` ("Posiciones valuadas a costo", "Cotizaciones que no se pudieron actualizar") through `EvolutionNotices`. Note: `DataNotices` is the /rendimientos component; the dashboard mechanism is `dashboard-notices.ts` + `NoticesPanel`, which is what was extended. `calculatePortfolioValuation` returns `priceIssues` (not persisted, cron untouched; T10 can log it). RED: price-issues suite failed to load + 2 notice tests failed; GREEN dashboard 148/148. Full suite 56 files / 679 tests after T3.
- 2026-10-21 T4 done: `isUsdCurrency` now used in `dividends/aggregate.ts`, `bonds/cashflows.ts computeCouponsYtd` and (via new pure `dividends/forecast-helpers.ts`) `pickCurrency`. Withholding bucket is allocated across same ticker+date dividend rows in proportion to gross (total tax counted once; a lone dividend is unchanged). CEDEAR finding CONFIRMED: local `ARGENTINIAN_TYPES` omitted CEDEAR so `forecastFromArsCedear` queried the US symbol and multiplied a per-US-share dividend by CEDEAR qty (ratio ignored); fixed by `isBymaQuoted` (includes CEDEAR) so the fallback reads the `.BA` per-CEDEAR line (returns [] if Yahoo has none, instead of overstating). RED: 8 tests failed + helpers suite failed to load; GREEN 35/35 (dividends + bonds/cashflows).
- 2026-10-21 T5 done: new pure `transactions/trade-date.ts` (`tradeDateToStorage` -> 12:00Z like `balanz.analyzer.ts`, `tradeDateToInput`, `localTodayIso`); create and update actions store 12:00Z, edit read-back uses `tradeDateToInput` (UTC day, round-trips both 12:00Z and legacy 00:00Z). Extra off-by-one fixes found while verifying: form default date used the UTC day (wrong after 21:00 in UTC-3) -> `localTodayIso`; history table formatted in local time (a 00:00Z row showed the previous day) -> UTC day slice. RED: suite failed to load; GREEN 6/6.
- 2026-10-21 T6 done, both findings CONFIRMED: (a) same-date amortization was applied before the coupon (2.5 instead of 5.0) and an amortization at maturity dropped the last coupon (`remainingPrincipal > 0` guard); (b) `buildCouponDates` chained `addMonths` (Jan 31 -> Feb 28 -> Mar 28). `projectCashFlows` now accrues each coupon on principal at period start, split into sub-periods at any strictly-inside amortization; `buildCouponDates` (now exported) is `issue + k*freq` via a UTC `addMonthsUtc` (date-fns local-zone `addMonths` removed). 7 new tests; RED 7 failed, GREEN bonds 37/37. Behavior note: a bond whose maturity is off-cadence still gets the existing stub coupon; with a 100% amortization at maturity that stub is now emitted instead of dropped.
- 2026-10-21 Checks after T1-T6: `pnpm test` 59 files / 716 tests pass; `pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors / 34 warnings (baseline unchanged).
- 2026-10-21 T3 correction done: `classifyQuoteCoverage` was fed every instrument ever traded, so a fully sold ticker without a quote showed as "valuado a costo". New pure `onlyHeldInstruments(instruments, holdings)` (buildHoldings rows only exist for qty > 0) is applied in `actions/dashboard.ts` and `calculations/performance.ts`. RED 1 failed -> GREEN price-issues 7/7.
- 2026-10-21 T7 done: `app/(app)/error.tsx` (keeps sidebar/header, logs digest, "Reintentar" via `unstable_retry`, which is the Next 16 prop; `reset` is the discouraged alternative), `app/global-error.tsx` (own html/body, inline styles because it replaces the root layout), `app/not-found.tsx` (renders inside the root layout). Components, untested by convention.
- 2026-10-21 T8 done: (a) `getCurrentUser` wrapped in React `cache()`; no `user.update` exists in the app, so per-request memoization cannot go stale. (b) Mechanism: `unstable_cache` + tags, NOT `use cache`: `use cache` requires `cacheComponents`, which forces Suspense around every request-time read app-wide (session, Prisma). `unstable_cache` is the documented option for apps without it (flagged "replaced" in the docs; revisit if cacheComponents is adopted). New `lib/cache/report-tags.ts` (pure, 3 tests; RED suite failed to load -> GREEN 3/3) and `lib/cache/report-cache.ts` (`getCachedPerformanceReport`, `getCachedPortfolioEvolution`, key = userId + portfolioId (+name), 300 s, tags `reports:user:<id>` + `reports:all`). Both results are plain JSON (strings/numbers/null; no Decimal/Date; verified in types), so the JSON round-trip is lossless; a throwing loader is not cached. Invalidation uses `updateTag` (read-your-own-writes, Server Actions only; `revalidateTag` without profile is deprecated and with "max" would serve stale right after an edit): `revalidateTransactionConsumers(userId)` now also expires the user tag (create/edit/delete/delete-by-instrument/import commit/import revert); corporate event create/delete and bond terms upsert expire `reports:all` because those rows are shared per instrument. Dead `export const revalidate = 300` removed from /rendimientos. Dashboard's `loadPortfolioEvolution` call injects a precomputed series and shares work with the dashboard build, so it is left uncached.
- 2026-10-21 T9 done, finding CONFIRMED: `PriceCache` had no fetched-at column and the "yahoo" row stored `datetime = quote.asOf` (last trade), so after close/weekends `now - datetime` always exceeded 10 min. No migration: only `refreshLatestQuotes` reads/writes source "yahoo" (EOD history uses other sources), so `datetime` of those rows is now the fetch time; each refresh creates the row and deletes older "yahoo" rows of that instrument in one `$transaction` (one live row per instrument). New pure `market/quote-freshness.ts` (`isQuoteFresh`, 4 tests; RED suite failed to load -> GREEN 4/4). Legacy rows (old last-trade datetimes) are refetched once.
- 2026-10-21 T10 done: cron loops with per-portfolio try/catch, logs failures and `priceIssues` (warn), returns a summary. New pure `snapshots/cron-summary.ts` (`summarizeSnapshotRun`, 5 tests; RED suite failed to load -> GREEN 5/5): status 200 all ok, 207 partial, 500 if every portfolio failed; body `{ ok, snapshotsCreated, failed, failedPortfolioIds, portfoliosWithPriceIssues }`. Auth untouched; the outer try/catch still returns 500 for a failure loading users.

- 2026-10-21 T11 done, every claim CONFIRMED by rg (src, scripts, prisma; only docs/ mention the files). Deleted: `components/imports/{import-modal,import-edit-table,import-duplicates-dialog}.tsx`, `lib/calculations/{fx,positions}.ts`, `lib/market/{bcra,byma}.ts`, `lib/user-utils.ts`, `components/ui/separator.tsx`, `lib/importers/fixtures/balanz-movimientos.{ts,json}`. Kept (still live): `importers/auto-clear.ts`, `importers/duplicates.ts`, `getAmortizedTickersAction` (used by `import-wizard`, `unified-review-step`). Dep removed: `@radix-ui/react-separator` (`pnpm remove`). Other ui wrappers (tabs, tooltip, popover, dropdown-menu, dialog) are all used: kept. Also cleaned unused imports/vars in 12 files (lint 34 -> 11 warnings). `docs/*.md` still mention the deleted files and the old action names (not edited).
- 2026-10-21 T12 done: loaders moved out of `"use server"` into plain server modules (auth still via `getCurrentUser()`, return shape `{ error: "unauthorized" }` unchanged): `lib/dashboard/load-page.ts` (`loadDashboardPageData`), `lib/transactions/load-page.ts`, `lib/dividends/load-page.ts`, `lib/bonds/load-page.ts`, `lib/events/load-page.ts` (`loadPortfolioInstruments`, `loadCorporateEvents`), `lib/events/load-suggested.ts`, `lib/imports/load-page.ts` (`loadImportContext` + `ImportContextData`, `loadImportedTransactions`), `lib/monitoreo/load-bootstrap.ts` + shared `lib/monitoreo/load-series.ts` (`fetchMonitoringSeries`, was private to the action file). `actions/{dashboard,dividends,bonds}.ts` were loader-only and were moved whole. No client component called any of these as an action, so no wrapper was kept. `getUpcomingIncomeAction` and the monitoring series/history/markers actions ARE called from client components, so they stay actions. `server-only` is not installed (not added: no network dependency change); the modules are only imported by pages/actions. Recovery note: while extracting the transactions loader the remaining action file was clobbered by a bad shell redirect; it was rebuilt from HEAD plus the T5 (`tradeDateToStorage`/`tradeDateToInput`) and T8 (`revalidateTransactionConsumers(user.id)`) edits, verified by tsc + diff vs HEAD (only those lines + the loader removal differ).
- 2026-10-21 T13 done: `next/dynamic` (`ssr: false`, only inside client components, skeleton fallbacks from `page-skeletons`/`Skeleton`) for `KLineChart` (monitoreo-page), `PortfolioEvolutionChart` (new `dashboard/portfolio-evolution-lazy.tsx`, used by evolution-sections and rendimientos-page), the three recharts charts in rendimientos-page and `DividendCharts` (dividends-page). Dashboard donut/bars left static (above the fold). `xlsx`: finding PARTIALLY false: `file-dropzone`/`import-upload-step` never imported it; the only static import was `balanz.analyzer.ts`. Now `BalanzAnalyzer.parse` and `parseBalanzWorkbook` are async and `await import("xlsx")` (interface already allowed a Promise).
- 2026-10-21 T14 done, no behavior change. `portfolio-evolution.tsx` 1041 -> 138 lines + `dashboard/evolution/{chart-model.ts,use-evolution-chart.ts,chart-controls.tsx,zoomable-area-chart.tsx,evolution-tooltip.tsx,footnote.tsx,format.ts}`; pure helpers (`round2`, `formatAxisValue`, `estimatedPricesCutoff`, `formatDayMonth`, `ViewMode`) moved to `lib/dashboard/evolution-chart.ts` (7 tests; RED suite failed to load -> GREEN 7/7; note es-AR `formatDayMonth` does not zero-pad, existing behavior kept). `unified-review-step.tsx` 718 -> 160 lines + `imports/review/{use-review-state.ts,review-header.tsx,health-tabs-bar.tsx,review-filter-bar.tsx,unified-row-item.tsx}`; pure view logic moved to `lib/imports/review-view.ts` (12 tests; RED -> GREEN 12/12).
- 2026-10-21 T15 done: `Sidebar` is now `hidden md:flex`; new `layout/mobile-nav.tsx` (radix Dialog drawer, button `aria-label="Abrir menú de navegación"`, closes on link click via `onNavigate`, focus trap/Esc from radix, sr-only title) mounted in `Header` (below `md` only); `SidebarContent` shared by both; main padding `p-4 md:p-6`, header `px-4 md:px-6`. Note: the repo has no tailwind animate plugin (existing dialogs' `animate-in` classes are inert), so the drawer opens/closes without animation, same as dialogs.
- 2026-10-21 Checks after T11-T15: `pnpm test` 64 files / 748 tests pass; `pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors / 11 warnings (baseline 34).
- 2026-10-21 Independent verification P2+P3: no blocking findings (T12 rebuilt `actions/transactions.ts` matches HEAD + intended edits; cache keys/updateTag callers OK). Fixed low finding: `mobile-nav.tsx` closes the drawer when the viewport crosses `md` (tsc + eslint clean). `pnpm exec next build` (without migrations) compiled all 21 routes.
- Known low follow-ups (not done): `docta-enrichment.ts` writes BondTerms outside Server Actions (report may be stale ≤5 min); snapshot cron returns 207 on partial failure (Vercel won't flag it); dashboard evolution uncached; transactions page shows unpriced ON at cost without a marker; `docs/*.md` reference removed files; no smoke test against a running server with a logged-in user.

## Next step
All tasks done, uncommitted. Next: user smoke-tests the app, then commit decision (commit convention in memory). P0 security deferred by the user.
