# Rendimientos: include ONs

## Objective
Make `/rendimientos` measure ONs (corporate bonds) like the dashboard evolution chart already does, so both
engines cover the same perimeter and their totals reconcile.

## Problem / why
- User report (2026-10-28): evolution chart "Resultado" (Todo) = −US$ 77.73 vs `/rendimientos` = −US$ 69.51.
- Root cause (verified by running both engines): `/rendimientos` perimeter is `PERFORMANCE_INSTRUMENT_TYPES`
  = CEDEAR + STOCK_AR (`src/lib/rendimientos/types.ts:24`); the chart adds ONs (`evolution-data.ts:57`).
  ON result in chart: −9.56 USD. Remaining +1.34 is the chart dropping the first day (separate issue, out of scope).
- `EXCLUSION_REASONS.ON` ("data912 only publishes today's quotes") is stale: `buildBondDailyPriceSeries`
  already rebuilds daily ON prices (real data912 snapshot or estimated technical value).

## Decisions
- Do NOT add `ON` to `PERFORMANCE_INSTRUMENT_TYPES`: it also drives the Yahoo EOD backfill
  (`src/lib/market/backfill.ts:95`), which has no ON prices. `/rendimientos` gets its own perimeter constant,
  mirroring `EVOLUTION_INSTRUMENT_TYPES`.
- Reuse the chart's ON price resolution instead of duplicating it: extract it to a shared module used by both loaders.
- ONs stay out of the generic live overlay and the `EOD_PRICE_SOURCE` query (data912 quotes ONs per 100 VN).

## Scope
- In: shared ON daily-price builder; `series.ts` perimeter + ON price rows + `estimatedPriceDays`; drop stale
  `EXCLUSION_REASONS.ON`; UI note on `/rendimientos` when estimated ON prices are in range.
- Out: chart first-day base for "Todo"; MEP vs CCL; ON valuation vs Balanz; backfill changes.

## Constraints
- Pure logic in `src/lib/**` with vitest; Prisma orchestrators/components untested (convention).
- UI copy Spanish, code English. Both palettes (zinc utilities only).
- `valuatePortfolioAt` (shared core) must not change behavior for existing callers.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). RED → GREEN → REFACTOR for pure helpers.

## Tasks
- [x] T1 Extract pure ON daily-price assembly from `evolution-data.ts` into a shared module (RED test first); chart loader uses it with identical output
- [x] T2 `series.ts`: own perimeter (CEDEAR, STOCK_AR, ON); ONs excluded from EOD query/live overlay; merge ON price rows + `estimatedPriceDays` into replay; remove `EXCLUSION_REASONS.ON`
- [x] T3 `/rendimientos` UI: note when the visible period includes estimated ON prices
- [x] T4 Reconcile: rendimientos total gain ≈ chart Todo result − first-day gap (scratch read-only script)

## Acceptance criteria
- `/rendimientos` lists ONs in positions/monthly detail; no ON in "excluded holdings".
- Chart ALL result − rendimientos gain equals only the first-day gap (≈ −1.34 USD as of 2026-10-28).
- Chart numbers unchanged (−77.73 as of 2026-10-28).

## Checks
- `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`

## Progress
- 2026-10-28: document created.
- 2026-10-28 T1: RED `vitest run src/lib/bonds/on-daily-prices.test.ts` -> "Cannot find module ./on-daily-prices"; GREEN 7/7 after adding `src/lib/bonds/on-daily-prices.ts` (pure `buildOnDailyPrices`) + `on-daily-prices-loader.ts` (Prisma, untested). `evolution-data.ts` now uses both; `RENDIMIENTOS_INSTRUMENT_TYPES` (types.ts) replaces its local spread. tsc clean.
- 2026-10-28 T2: `series.ts` perimeter = `RENDIMIENTOS_INSTRUMENT_TYPES`; ONs out of EOD query + live overlay; tradingDays from equity rows; ON rows merged into `PriceIndex`; `estimatedPriceDays` in `replayInputs`; `EXCLUSION_REASONS.ON` removed. Checked: no underlying/original-source for ON (CEDEAR/STOCK_AR only), sector resolves by type. tsc clean, 885 tests pass.
- 2026-10-28 T3: RED `estimated-prices.test.ts` (module missing) -> GREEN 4/4. `DataQuality.estimatedPriceMonths` (from month-end valuations' `priceEstimated`), filtered by visible period in `rendimientos-page.tsx`, shown as warning Notice in `data-notices.tsx`. Checks: `pnpm test` 80 files / 885 pass; `pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors, 11 pre-existing warnings.
- 2026-10-28 T4: scratch read-only script ran both engines. Chart ALL unchanged: -77.73 (end 3465.50, contrib 3381.63). Rendimientos now: value 3465.50, invested 3544.56 (= 3381.63 + first buy 162.94), gain -79.07 = -77.73 - 1.34 first-day gap. Parent spot check: pnpm test 885 passed, tsc clean. RDD off; assess risk=high -> independent verifier launched.
- 2026-10-28 Verifier (independent, read-only): no blockers; tests 885 pass, tsc clean. Fixed should-fix: stale cached report (unstable_cache across deploy) lacks dataQuality.estimatedPriceMonths -> '?? []' in rendimientos-page.tsx. Fixed nit: evolution.ts perimeter comment. Accepted as-is: ON prices only on equity trading days (same as dashboard; ON-only portfolios fall back to cost). Re-checks: see below.
- 2026-10-28 Re-checks after fixes: pnpm exec tsc --noEmit clean; pnpm lint 0 errors / 11 warnings; pnpm test 80 files / 885 passed. Status: done, uncommitted. Next: user decides commit.
