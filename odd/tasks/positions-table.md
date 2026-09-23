# Interactive positions table in /rendimientos

## Objective
A single, centralized positions table (one row per held instrument) on `/rendimientos`, placed between `PerformanceKpis` and `ValueEvolution`.

## Problem
No view shows every per-position metric together. `PerformanceReport` has no per-position rows and `DashboardHolding` lacks average cost, unit price, daily change and holding age.

## Scope
Columns: Ticker (name + type), Avg cost ARS, Avg cost USD (at purchase-day CCL), Current price, Return ARS (amount + %), Return USD (amount + %), Daily change %, Weight %, Holding age ("2a 1m"), Market value, live-price marker.
Interaction: click header sorts asc → desc → none (numeric vs alphabetical); drag header to reorder columns; drag header edge to resize; search by ticker/name; column visibility menu; order/widths/visibility persisted in `localStorage`; monetary values follow the ARS/USD toggle.

Out of scope (v1): "US share", "US share change", "Tags" — underlying price/ratio not verified in DB, tags do not exist in schema.

## Constraints
- Reuse `valuatePortfolioAt` and the live overlay; do not duplicate valuation logic.
- Pure row-building module covered by Vitest; Prisma orchestrators stay untested by convention.
- Libraries: `@tanstack/react-table`, `@dnd-kit` (user-approved).
- UI copy in Spanish (matches existing project UI); code/comments follow repo conventions.
- Null-safe: missing CCL or price yields empty cells, never fabricated numbers.

## TDD
- Mode: strict (source: user global config "Strict TDD Mode: enabled")
- Runner: `npm test` (vitest run)

## Tasks
- [x] T1 Pure module building position rows (avg cost ARS/USD, price, returns, daily change, weight, holding age) with tests (RED → GREEN → REFACTOR)
- [x] T2 Wire rows into the /rendimientos loader and `PerformanceReport`
- [x] T3 Install deps; interactive table component (sort, reorder, resize, search, visibility, persistence)
- [x] T4 Place table between KPIs and "Evolución del portfolio"; ARS/USD toggle

## Acceptance criteria
- Every current position appears once with correct metrics against fixtures.
- Sorting, reordering, resizing, search and visibility work and survive reload.

## Checks
- `npm test`, `npx tsc --noEmit`, `npm run lint`

## Progress
- Engram mirror `odd/positions-table/tasks`: PENDING (Engram tools unavailable in this session)

### T1 — pure position-rows module
- Extended `src/lib/rendimientos/price-series.ts`: `TimeSeries.before` (strictly-before lookup, no forward-fill) and `PriceIndex.previousClose`, needed for the daily-change column. `PositionDetail` already carries avg-cost inputs, USD cost basis (purchase-day CCL, via `buildHoldings`/`FxForHoldings`) and `priceIsLive`, so those are reused, not recomputed.
- New `src/lib/rendimientos/position-rows.ts`: `buildPositionRows(positions, trades, prices, today)` → `PositionTableRow[]` (avg cost ARS/USD, daily change %, weight %, return ARS/USD pass-through, holding-age days with lot-restart-after-full-sale semantics, stale/live pass-through) and `formatHoldingAge(days)` ("Xd" / "Xm" / "Xa[ Ym]").
- RED: `npx vitest run src/lib/rendimientos/position-rows.test.ts src/lib/rendimientos/price-series.test.ts` → `position-rows.test.ts` failed to resolve (`Cannot find module './position-rows'`, 0 tests); `price-series.test.ts` failed 6/20 (`before`/`previousClose` not functions).
- GREEN: same command → `Test Files 2 passed (2)`, `Tests 38 passed (38)`.
- No refactor needed beyond the initial implementation.

### T2 — wire into loader / PerformanceReport
- `PerformanceReport.positions: PositionTableRow[]` added in `src/lib/rendimientos/types.ts` (type-only import from `position-rows.ts`, no runtime circularity).
- `src/lib/rendimientos/series.ts` (`buildPerformanceReport`): after the monthly replay, reuses `valuations.at(-1)!.positions` (the current month-end valuation, forward-filled to today's live-overlay price — no separate replay) + the full `trades` history + `prices` + `today` to call `buildPositionRows`.
- Both `emptyReport` implementations (`series.ts` and the local one in `src/app/(app)/rendimientos/page.tsx`) updated with `positions: []`. `view.test.ts`'s `report()` helper updated the same way.
- Evidence: `npx tsc --noEmit` → clean. `npx vitest run` → `Test Files 34 passed (34)`, `Tests 425 passed (425)`.

### T3 — deps + interactive table component
- Installed via `pnpm add` (repo is pnpm-managed — `pnpm-lock.yaml`; plain `npm install` fails with an arborist crash on this tree): `@tanstack/react-table@9.2.4`, `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/modifiers@9.0.0`, `@dnd-kit/utilities@3.2.2`.
- `@tanstack/react-table` v9 is a from-scratch API (`useTable` + explicit `tableFeatures()` registration, not v8's `useReactTable`). Per AGENTS.md, read its shipped `node_modules/@tanstack/*/skills/*/SKILL.md` docs (getting-started, table-features, sorting, column-ordering/-sizing/-resizing/-visibility, global-filtering, migrate-v8-to-v9) before writing any code against it.
- Design decision: sorting is **not** done through TanStack's `rowSortingFeature`. Its `sortFn` contract only guarantees ascending comparators and lets the framework auto-reverse for descending — which would flip "nulls always last" to "nulls first" on desc. Instead, sorting/searching happen in plain JS (`useMemo`) against the tested comparators in `positions-table-layout.ts`, and the already-ordered array is handed to the table as `data`. Only `columnOrderingFeature` + `columnSizingFeature` + `columnResizingFeature` + `columnVisibilityFeature` are registered.
- New pure module `src/lib/rendimientos/positions-table-layout.ts`: `compareNullableNumeric`/`compareNullableAlphabetical` (nulls always last, regardless of direction), `parseStoredLayout`/`serializeLayout` (defensive per-field JSON parsing — a corrupt/outdated single field is dropped, not the whole layout), `reconcileColumnOrder` (drops columns that no longer exist, appends new ones the stored layout didn't know about).
  - RED: `npx vitest run src/lib/rendimientos/positions-table-layout.test.ts` → `Cannot find module './positions-table-layout'`, 0 tests.
  - GREEN (after adding `reconcileColumnOrder` in a second pass): `Test Files 1 passed (1)`, `Tests 19 passed (19)`.
- New `src/components/rendimientos/positions-table.tsx` (client component, not unit-tested — matches the repo convention that only pure `src/lib` modules get Vitest coverage; `vitest.config.mts` runs `environment: "node"` with no DOM, and there is no `@testing-library/react` in the repo). 10 columns: Ticker (+ name, stale/live markers), Costo prom. ARS, Costo prom. USD, Precio (ARS/USD-toggled), Result. ARS (amount+%), Result. USD (amount+%), Var. diaria, Peso, Antigüedad, Valor de mercado (ARS/USD-toggled). Return columns sort by `%`, not by amount (amount is dominated by position size, which "Peso" already covers).
  - Header click cycles asc → desc → none; a dedicated grip handle (`GripVertical`) carries the dnd-kit drag listeners so a plain click still sorts; resize handle is the header's right edge (`columnResizeMode: "onChange"`); column-visibility menu reuses `DropdownMenuCheckboxItem` (ticker forced `enableHiding: false`); sticky header (`position: sticky; top`) and conditionally-sticky ticker column (only while it is actually the first visible column, via `column.getIsFirstColumn()`).
  - Layout persistence (`columnOrder`, `columnSizing`, `columnVisibility`, `sorting`) uses a **module-level external store** (`readStoredLayout`/`writeLayout`/`subscribeToLayout` + `useSyncExternalStore`), the same pattern already used by `currency-provider.tsx` and `theme-toggle.tsx` — not `useState` + a mount `useEffect`. A first draft used the effect approach and `npm run lint` failed with `react-hooks/set-state-in-effect` ("Calling setState synchronously within an effect can trigger cascading renders"); the external-store rewrite hydrates safely (server snapshot = defaults, client snapshot = parsed `localStorage`) with no effect at all.
  - "Reset layout" writes `DEFAULT_LAYOUT` back through the same store.
  - `LiveBadge` exported from `monthly-table.tsx` (was private) and reused here instead of duplicating the "En vivo" markup.
- Evidence: `npx tsc --noEmit` → clean (no errors on the v9 generics). `npm run lint` → `0 errors` (35 warnings, all pre-existing in files this task didn't touch — confirmed identical count/exit-0 on `main`). `npx vitest run` → `Test Files 35 passed (35)`, `Tests 444 passed (444)`.

### T4 — placement + currency toggle
- `src/components/rendimientos/rendimientos-page.tsx`: `<PositionsTable positions={report.positions} currency={currency} />` inserted between `<PerformanceKpis .../>` and the `<div className="space-y-4">` that holds `<ValueEvolution/>` — exactly where the doc asked. `currency` is the page's existing ARS/USD toggle state, already resolved above this point.
- Final full-suite evidence (after T4): `npx tsc --noEmit` → clean. `npm run lint` → `0 errors, 35 warnings` (pre-existing baseline, exit 0). `npx vitest run` → `Test Files 35 passed (35)`, `Tests 444 passed (444)`.

## Known limitations / assumptions
- No footer/total row (spec marked it optional).
- `columnResizeMode: "onChange"` writes the resized width to the external store (and thus `localStorage`) on every drag tick, not debounced. Functionally correct and matches the requested resize mode; a perf-only follow-up could throttle the `localStorage.setItem` call if a very large table made this noticeable — not needed at today's portfolio sizes.
- Daily change % and weight % are **not** part of `PositionDetail`/`valuatePortfolioAt`; they're derived in the new `position-rows.ts` from `PriceIndex.previousClose` (new) and the total of the current positions list, respectively, per the doc's constraint to reuse — not duplicate — valuation logic.
- Not independently verified in a running browser (no browser/E2E tooling available in this session); verification is `tsc` + `eslint` + `vitest` as instructed, plus manual API-conformance checks against the installed `@tanstack/react-table`/`table-core` type declarations and shipped skill docs.

## Status: done
