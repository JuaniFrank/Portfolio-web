# ADR view for Argentine stocks in /activos

## Objective
For an Argentine local stock with a US ADR (GGAL→GGAL, YPFD→YPF, PAMP→PAM…), /activos lets the
user switch to the ADR chart (USD, Yahoo) and see their PPC and trades projected in ADR terms.

## Problem
Users watch the ADR (pre-market, US hours, USD) but their position is in the local stock in ARS.
Today the chart only shows the local series; there is no local→ADR link anywhere in the code/data.

## Why this approach
Mirror the existing CEDEAR `cedear-underlying` path: a new series kind `adr`, the toggle pattern
of "USD subyacente / ARS CEDEAR", and the same-day factor projection (ADR close / local ARS close
on the trade date, `valueAsOf` lookback). User chose the same-day factor over CCL × ratio
(2026-11-12): trades land on the ADR candle of that day and no ADR ratio table is needed.

## Scope
- Static map local ticker → ADR Yahoo symbol (pure module, tested). Only symbols, no ratios.
- New `kind: "adr"` in API schema + UI kind; routing for STOCK_AR + adr → Yahoo ADR symbol (USD).
- Cache under a source that cannot clash with other series of the same instrument; Yahoo series
  are provider-adjusted (no re-adjustment).
- Trade projection + position summary (PPC, result vs last) in ADR terms via the same-day factor.
- Toggle in the toolbar only when the instrument has an ADR.

Out of scope: ADR ratio table, CCL × ratio conversion, ADRs in other pages, DB schema changes.

## Constraints
- Strict TDD (vitest, `pnpm test`): pure modules RED → GREEN → REFACTOR; loaders/routes/components untested.
- Next 16 in this repo differs from training data: read `node_modules/next/dist/docs/` before Next-specific code.
- ~400 changed lines per task is an advisory heuristic only.

## Tasks
- [x] T1 ADR map module (`src/lib/market/adr-map.ts`) + tests.
- [x] T2 `adr` kind in schemas/types + provider routing (STOCK_AR + adr → Yahoo ADR, USD) + source/adjustment mode + tests.
- [x] T3 Trade projection `adr` branch (same-day factor) + position summary + tests.
- [x] T4 Server loaders (series/history/trades) accept `adr`; UI toggle in `monitoreo-page.tsx`, currency USD, PPC line + KPIs in ADR terms.

## Acceptance
- GGAL (BYMA) shows a "ADR" toggle; switching shows Yahoo GGAL (USD) candles.
- PPC line and trade markers sit on the ADR price of each trade date (same-day factor).
- Stocks without an ADR show no toggle; CEDEAR and native views unchanged.

## Checks
`pnpm test`, `pnpm tsc --noEmit`, `pnpm eslint <changed files>`.

## TDD
Mode: strict (source: user global config). Runner: `pnpm test` (vitest run).

## Progress
- 2026-11-12: Explored; approach chosen by the user. Doc created.
- 2026-11-12: T1 done. RED (module missing) -> GREEN 5/5 in adr-map.test.ts; eslint + tsc clean. Added VIST. Omitted: TEN/TXAR (Ternium SA is a different issuer).
- 2026-11-12: T2 done. RED (3 failing in provider-routing/split-adjustment tests) -> GREEN; full pnpm test 1024 pass, tsc clean. Source `yahoo-adr-eod` (provider-adjusted); kind `adr` in types/schema; routing STOCK_AR+adr -> Yahoo ADR symbol, USD, falls back to native if no ADR.
- 2026-11-12: T3 done. RED (4 adr tests in trade-projection.test.ts) -> GREEN by widening the cedear-underlying branch to `adr` (same-day factor, method stays "underlying-factor"). Position summary is kind-agnostic; added trade-markers characterization test (ADR entries + PPC in USD). pnpm test 1030 pass, tsc + eslint clean.
- 2026-11-12: T4 done (no unit tests, per repo convention). Routes already accept `adr` via seriesInputSchema; load-history works unchanged (Yahoo branch); load-series skips alternate sources + local live fallback for ADR. UI: "ARS local / USD ADR" toggle for STOCK_AR with an ADR, currency USD, scale label "Equivalente ADR". Not verified in the running app. pnpm test 1030 pass, tsc + eslint clean.
- 2026-11-12: Independent review: nothing blocking. Fixed should-fix: ADR view no longer hides PPC when a local corporate event follows a trade (gating dates = [] for `adr`; same-day factor is event-safe). All 14 ADR symbols verified on Yahoo (USD, right issuer). pnpm test 1030, tsc + eslint clean. Pending: check in the running app; commit.
- Next step: user checks GGAL in /activos (toggle, candles, PPC line, markers), then commit.
