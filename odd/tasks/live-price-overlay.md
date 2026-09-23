# Live price and CCL overlay for portfolio valuation

## Objective
Portfolio valuation (`/rendimientos` and the dashboard evolution chart) reflects today's market without waiting for the nightly `backfill-prices` cron.

## Problem
Both replay loaders (`src/lib/rendimientos/series.ts`, `src/lib/dashboard/evolution-data.ts`) read only `PriceCache` rows with `source = "yahoo-eod"` and the persisted `FxRate` CCL series. data912 live quotes are fetched elsewhere (catalog sync, snapshots, monitoreo) but never reach the replay, so today's value only exists after the backfill.

## Approach
Overlay live data **in memory at read time**; never persist it as `yahoo-eod`.
- Prices: one `fetchData912Live` call (short revalidate). For each eligible instrument without an EOD close for today, add a point at today's UTC midnight with the live `price`.
- CCL: `fetchCclQuote()` (dolarapi). If the CCL series has no point for today, add today's mid.
- The nightly EOD close supersedes the overlay naturally (EOD row wins when present).
- Live points must be distinguishable from measured closes so coverage/staleness can report them.

## Constraints
- Do not write intraday rows under `yahoo-eod` (history-sync assumes midnight-UTC closes only).
- data912 is not split-adjusted: acceptable for today's price only, never for history.
- Live fetch failure degrades silently to the current EOD-only behavior.
- Pure overlay logic lives in a pure module covered by Vitest; Prisma orchestrators stay untested by convention.

## TDD
- Mode: strict (source: user global config "Strict TDD Mode: enabled")
- Runner: `npm test` (vitest run)

## Tasks
- [x] T1 Pure overlay module (price + CCL) with tests (RED → GREEN → REFACTOR)
- [x] T2 Wire overlay into `series.ts` (/rendimientos) and `evolution-data.ts` (dashboard)
- [x] T3 Surface live points in coverage/staleness where applicable
- [x] T4 Fix: `priceIsLive` only when the valuation hits the live point (was true for past months too)
- [x] T5 UI: "En vivo" badge in `monthly-table.tsx`; green dot + legend in dashboard tooltip movers
- [x] T6 "Today" = market calendar day (default America/Argentina/Buenos_Aires, parameterizable); no live overlay on weekends

## Acceptance criteria
- With no EOD row for today and a live quote available, today's valuation uses the live price and live CCL.
- With an EOD row for today, the EOD close is used.
- Live fetch failure yields the same result as before this change.

## Checks
- `npm test`, `npx tsc --noEmit`, `npm run lint`

## Progress
- Engram mirror `odd/live-price-overlay/tasks`: PENDING (Engram tools unavailable in this session)
- T1: new pure module `src/lib/rendimientos/live-overlay.ts` (`overlayLivePrices`, `overlayLiveCcl`) with
  `src/lib/rendimientos/live-overlay.test.ts` (8 cases). TDD observed: RED (`Cannot find module
  './live-overlay'`) → GREEN (8/8 passing) → no refactor needed, kept minimal. Added `TimeSeries.all()`
  to `price-series.ts` (defensive copy of points) so the CCL overlay can inspect an already-built series
  shared from the dashboard action.
- T2: new impure helper `src/lib/market/live-quotes.ts` (`fetchLiveOverlayInputs`, try/catch → empty
  overlay on any failure). Wired into `src/lib/rendimientos/series.ts` and
  `src/lib/dashboard/evolution-data.ts`: both derive `{id, ticker, type}` for eligible instruments from
  the already-loaded `transactions` (no extra query), fetch live quotes + CCL mid concurrently with the
  existing Prisma reads, and overlay onto the raw EOD/CCL rows before constructing `PriceIndex`/`TimeSeries`.
  `evolution-data.ts` also recomputes `tradingDays` from the overlaid rows so today's live point can
  produce a chart point. `series.ts`'s `dataQuality.lastPriceSyncDate` is computed from the raw `priceRows`
  (not the overlay) so it keeps reporting real backfill freshness.
- T3: added `priceIsLive: boolean` to `PositionDetail` (`types.ts`) and `liveInstrumentIds?: Set<string>`
  to `ReplayInputs` (`valuation.ts`); `valuatePortfolioAt` sets `priceIsLive` per position. Both loaders
  pass the `liveInstrumentIds` returned by `overlayLivePrices` into their replay inputs. UI consumption
  (e.g. a badge in `monthly-table.tsx`/`portfolio-evolution.tsx`) is NOT implemented — the data flag is
  in place and ready, but wiring the UI display was left out to keep this change scoped to the data layer,
  per the task's "keep it minimal" note.
- Verification: `npm test` → 390/390 passed. `npx tsc --noEmit` → clean except one pre-existing failure
  in `src/lib/bonds/holdings.test.ts` (confirmed present on `main` before this change via `git stash`,
  unrelated to this feature). `npx eslint <changed files>` → no errors.
- T4: `valuatePortfolioAt` marked every position of an instrument with a live point as live, including
  past months. Now live only when `hit.date` equals the instrument's latest point
  (`PriceIndex.latestDateOf`). TDD: RED (past-month test failed) → GREEN. `EvolutionMover.priceIsLive`
  added with its own test (RED → GREEN).
- T5: UI badge/legend added. Verification: `npm test` 393/393; `tsc` only the pre-existing
  `bonds/holdings.test.ts` error; eslint clean on changed files. Not visually checked in a browser.
- T6: new pure `src/lib/rendimientos/market-day.ts` (`marketDayOf(instant, timeZone)`,
  `isTradingWeekday`, `DEFAULT_MARKET_TIME_ZONE`). Keyed on the MARKET's time zone, not the user's: a
  BYMA quote belongs to BYMA's trading day regardless of where the viewer is. Both loaders take an
  optional `marketTimeZone`. Overlays skip weekends. Holidays not modeled (a holiday live point equals
  the previous close). TDD: RED (missing module + 2 weekend failures) → GREEN. Checks: `npm test`
  401/401; tsc only the pre-existing bonds error; eslint clean.
