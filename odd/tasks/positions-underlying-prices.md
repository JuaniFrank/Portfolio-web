# Rendimientos positions table: original-stock prices

## Objective
For every CEDEAR in the "Posiciones" table on /rendimientos, show, next to the CEDEAR price already shown, the
price of the original stock on its home exchange (e.g. META on NASDAQ): the average price of that stock on the
days the position was bought, and its current price.

## Problem / why
- User request (2026-10-26): "que me digan a qué precio de la acción original hice las operaciones"; wants both the
  CEDEAR price paid and the NYSE/home-exchange price, as separate columns or in the same cell.
- `Instrument.conversionRatio` cannot be used: null for most held CEDEARs (META, SPY, TSM…) and a placeholder `10`
  from the seed for AAPL/GOOGL/KO/MELI/MSFT/NVDA (wrong). So the original-stock price is taken from Yahoo market
  data, not implied from the CEDEAR price.

## Decisions
- Source: Yahoo chart API for the underlying US symbol (existing `src/lib/market/yahoo.ts`). Average cost = quantity-
  weighted average of the underlying's daily close on each BUY date of the currently open lot, with the same
  average-cost method as the CEDEAR cost (sells keep the average, a full sale resets it). Quantities are adjusted for
  corporate events (e.g. SPY 3:1 ratio change) so earlier lots weigh correctly.
- Closes are Yahoo split-adjusted `close` (not dividend-adjusted), so cost and current price are comparable.
- Separate columns (sortable, hideable, resizable like the rest), always in USD regardless of the ARS/USD toggle,
  labelled with the exchange (e.g. "NASDAQ").
- Only CEDEARs get values; other instrument types show "—". Any Yahoo failure degrades to "—" without breaking
  the page.

## Scope
- In: `src/lib/rendimientos/*` (position rows, loader in `series.ts`), a pure underlying-price helper with tests,
  `src/lib/market/yahoo.ts` if a cached history fetch is needed, `src/components/rendimientos/positions-table.tsx`.
- Out: dashboard, transactions page, fixing `conversionRatio` data, AR stocks' ADRs.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). Pure modules only (Prisma orchestrators untested by
project convention).

## Tasks
- [x] T1 Pure `underlyingSymbolFor` (CEDEAR → Yahoo US symbol: base instrument ticker for settlement variants,
      `underlyingAsset.ticker` when set, Yahoo formatting such as `BRK.B` → `BRK-B`; null for non-CEDEARs), tested
- [x] T2 Pure underlying average cost over the open lot (weighted by event-adjusted quantity, sells keep average,
      full sale resets, close on or before the trade date, null when a buy date has no close), tested
- [x] T3 Loader: fetch underlying history + current quote per held CEDEAR (cached, failure-tolerant), add
      `underlyingSymbol`, `underlyingExchange`, `underlyingAvgCostUsd`, `underlyingPriceUsd` to `PositionTableRow`
- [x] T4 UI: columns "Costo prom. acción orig." and "Precio acción orig." (USD, exchange shown, header `title`
      explains), defaults/min widths, verified with real data

## Checks
- `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`; read-only scratch script comparing META's computed values with
  Yahoo for its buy dates.

## Progress
- 2026-10-26: data checked (conversionRatio unusable; one CEDEAR_RATIO_CHANGE event: SPY 2026-05-29 3/1);
  user chose to show both CEDEAR and original-stock prices; document created.

- 2026-10-26: T1-T4 done. T1/T2 in `underlying-price.ts` (+ `.test.ts`): RED = import unresolved (suite failed), then
  18 failing (`closeOnOrBefore is not a function`); GREEN = 783 tests passing. Also `closeOnOrBefore` (10-day lookback
  cap), `formatExchangeName`. T3: `underlying-loader.ts` (Yahoo history cached 12h via new `revalidateSeconds` option,
  quote 5 min, per-symbol parallel, USD-only, never throws), `series.ts` wiring, `buildPositionRows` 5th param
  (RED: 2 failing, GREEN 785 passing). T4: two columns in `positions-table.tsx` with header `title`. Checks: `pnpm test`
  785 pass, `tsc --noEmit` clean, `pnpm lint` 0 errors / 11 warnings. Real data: META avg 640.79 (hand-checked
  5767.11/9), SPY 735.10 (hand-checked with the 3x pre-event weights), exchanges NASDAQ/NYSE/NYSE Arca.
- Note: users with a saved table layout get the two new columns appended at the end (`reconcileColumnOrder`);
  "Restablecer" puts them in the default position.

## Next step
Parent review / commit.
