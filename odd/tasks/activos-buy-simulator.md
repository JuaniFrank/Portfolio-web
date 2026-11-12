# Buy simulator in /activos

## Objective
Let the user simulate a purchase (quantity + price) on the selected instrument and see how their
PPC (average cost) and result vs last price would change. Nothing is persisted.

## Problem
Averaging down/up decisions today need mental math or a spreadsheet; the page already knows the
open position (`buildPositionSummary`) but cannot answer "what if I buy N at P?".

## Scope
- Pure function in `src/lib/monitoreo/` that takes the current `PositionSummary`, a simulated buy
  (quantity, price in chart scale) and the last close, and returns: new quantity, new avg cost,
  avg cost change (absolute and %), total cost of the buy, new result vs last. Handles: no open
  position (new PPC = buy price), non-comparable position (avgCost null → no result), invalid
  input (≤ 0 / NaN → null).
- "Simular compra" panel in /activos: quantity and price inputs (price prefilled with the last
  close of the active series), results shown next to current values. Ephemeral React state only,
  reset when the instrument or series kind changes. Works in every view (native, CEDEAR, ADR)
  because prices are in chart scale; quantity is the instrument's own units.
- Chart: second dashed line "PPC sim." in a distinct color while a valid simulation is active.

Out of scope: simulated sells, multiple simulated buys, fees, "units needed to reach PPC X", persistence.

## Constraints
- Strict TDD (vitest, `pnpm test`) for the pure function; components untested per repo convention.
- UI copy in Spanish like the rest of /activos; code/comments in English.
- ~400 changed lines per task is an advisory heuristic only.

## Tasks
- [x] T1 Pure `simulateBuy` + tests (RED → GREEN).
- [x] T2 Simulator panel in /activos (inputs, results, reset on instrument/kind change).
- [x] T3 Simulated PPC line in `KLineChart`.
- [x] T4 Market price prefill (user request 2026-11-12: "que tenga precio de mercado, que haga un fetch del precio actual"): read-only `GET /api/activos/quote` (instrumentId + kind) resolving the live price in chart scale — data912 live for ARS local/CEDEAR (Yahoo `.BA` fallback), Yahoo quote (`fresh`) for USD kinds (adr, cedear-underlying); no PriceCache writes. Pure source-selection helper with tests. Simulator prefills price with it (shows source + time, "usar precio de mercado" refresh), falls back to the last close on failure; result vs. last uses the market price when available.

- [x] T5 Price basis selector (user request 2026-11-12: "que puedas simular con el precio del cedear en pesos o de la accion original. Hacelo completo"): for CEDEARs "CEDEAR (ARS)" / "Acción original (USD)", for AR stocks with ADR "Local (ARS)" / "ADR (USD)", independent of the chart view. Quantity stays in the instrument's units. The typed/fetched price in the chosen basis is converted to chart scale with the live factor (chart-kind quote / basis quote); the equivalent in the other basis is shown. "Actualizar" fetches the chosen basis. Pure conversion helper with tests.
- [x] T6 Multiple simulated orders (user 2026-11-12: "vos mejoralo x100, hacelo lo más completo posible"): a list of orders (buy or sell, qty @ price, each in the chosen basis), applied in order with the average-cost method; sells don't change PPC but reduce quantity and show the simulated realized result. Each order drawn as a ghost marker on the last bar; combined result + per-order step (PPC after each order).
- [x] T7 Input modes per order: by quantity; by amount (whole units = floor(amount / price), leftover shown); by target PPC (solver: units needed to reach PPC T at price P, with clear messages when T is unreachable — e.g. T ≤ P or T ≥ current PPC for a buy).
- [x] T8 Optional commission % (ephemeral, default 0): applied to buy cost (effective PPC) and sell proceeds; shown separately in "Inversión".
- [x] T9 Price helpers: chips (Mercado, Último cierre, −5 %, −10 %, −20 % from market, PPC actual) and pick a price by clicking the chart (pick mode in KLineChart, converted to the chosen basis).
- [x] T10 Insight block: break-even move needed before vs after (last → PPC %), and a scenarios table (market −5/−10/−20/−30 %: PPC and result if investing the same amount at that price).

- [x] T11 Move the simulator into the "Tus operaciones" column (user 2026-11-12: the full-width block takes too much space from the chart; no modal, results must stay visible live while editing). A "Simular operación" button at the foot of the column switches it to the simulator (header tabs "Operaciones | Simular", back to the list anytime); the layout is redesigned vertically for the narrow column (stacked inputs, compact tiles, scroll inside the column); the full-width block above the chart is removed so the chart gets its height back. Chart line, ghost markers and pick-from-chart keep working.

Delivery (user 2026-11-12): when T1–T10 are done and `pnpm test` + tsc + eslint pass, commit and push to main without waiting for final approval (commit-style: ≤2 files/commit, conventional, no Co-Authored-By, leave unrelated files out).

## Acceptance
- 34 GGAL at PPC 7.301,91 + simulated 10 at 4.975 → new PPC ≈ 6.773,07, shown with its change.
- Clearing the inputs or changing instrument removes the simulation and the chart line.
- No network request or DB write is triggered by simulating.

## Checks
`pnpm test`, `pnpm tsc --noEmit`, `pnpm eslint <changed files>`.

## TDD
Mode: strict (source: user global config). Runner: `pnpm test` (vitest run).

## Progress
- 2026-11-12: Explored (`buildPositionSummary`, `PositionPanel`, `KLineChart` avgCost line). Doc created.
- 2026-11-12: T1 done. RED (module missing) -> GREEN 11/11 in src/lib/monitoreo/buy-simulation.test.ts.
- 2026-11-12: T2+T3 done. `buy-simulator.tsx` collapsible block under the stats strip; state in `MonitoreoPage` (reset on instrument:kind change, price follows last close until edited); `KLineChart` `simulatedAvgCost` sky dashed "PPC sim." line. tsc and eslint clean. Running app not exercised.
- 2026-11-12: T4 done. `quote-source.ts` (`planQuoteAttempts`, RED module missing -> GREEN 6/6), `load-quote.ts` (read-only), `GET /api/activos/quote` (`quoteInputSchema`, `fetchQuote` client), simulator prefills from the quote (fallback last close), editable, "Actualizar" button overwrites, source/time hint. tsc, eslint, full `pnpm test` clean; unauthenticated route returns 401. Authenticated live fetch and UI not exercised.
- 2026-11-12: T5 done. `price-basis.ts` (`resolveBasisOptions`, `defaultBasis`, conversions; RED module missing -> GREEN 12/12). Simulator got a "Precio en" selector (CEDEAR/Acción original, Local/ADR), live factor from both basis-kind quotes, equivalent-in-other-basis hint, typed price converted on switch, Inversión in basis currency with ≈ other currency. tsc, eslint, full `pnpm test` (1059) clean. Authenticated UI/live quotes not exercised.
- 2026-11-12: T6-T10 done (implemented pure-first, UI in one pass so the dev page kept compiling). Pure modules, each RED (module missing / failing assertions) -> GREEN: `simulation-ledger.ts` (`applyOrder`, `runSimulation`; 12/12; `simulateBuy` is now a one-order wrapper, its 11 tests stay green), `order-sizing.ts` (`quantityForAmount`, `quantityForTargetAvgCost`; 14/14), `order-drafts.ts` (`resolveDrafts`, `parseDecimalInput`; 12/12 incl. amount-in-chart-currency case that went RED first), `sim-insights.ts` (`breakEvenMovePct`, `scenarioTable`; 10/10). UI: `BuySimulator` rewritten as an order list (`simulator-order-row.tsx`, `segmented.tsx`, `simulation-insights.tsx`): Compra/Venta + Cantidad/Monto/PPC objetivo per row, shared commission %, price chips (Mercado, Ultimo cierre, -5/-10/-20 %, PPC actual), crosshair pick button, step line per row, combined tiles, collapsible "Equilibrio y escenarios". `KLineChart`: `simulatedOrders` ghost markers (dashed sky outline on the last bar, "Simulada" tooltip) and `pickMode` overlay (guide + price tag, Esc cancels, starting a drawing tool/ruler cancels it). Decision: money (Monto, Inversion, Cobrado, escenarios) is in the chart-scale currency because a basis price can't convert money (CEDEAR ratio); per-unit prices and the target PPC do convert. The old "≈ other currency" sub on Inversion was dropped for that reason. Authenticated UI, live quotes and chart picking not exercised in a browser.
- 2026-11-12: Correction (coordinator bug report): in the USD views (`adr`, `cedear-underlying`) qty × chartPrice overstated money by the ratio. Added `moneyFactor(chartKind, quotes)` in `price-basis.ts` (native quote / chart quote; 1 for native and cedear-theoretical; null when a quote is missing). It now scales every money figure (cash, fees, proceeds, realized via `LedgerOptions.moneyFactor`; amount-mode sizing and the scenario amount via `resolveDrafts`/`scenarioTable`), while PPC, steps and % stay in chart scale. Money is shown in the instrument currency (ARS in USD views); with no pesos quote money tiles show "—", Monto mode is disabled and the scenarios show only hypothetical prices. RED first (7 failing: moneyFactor x3, ledger, drafts x2, insights; ADR 30 USD = 7000 ARS -> 10 shares cost 70.000, not 300) -> GREEN.
- 2026-11-12: T11 done. Full-width block removed (chart regains the height). New `operations-column.tsx` frames the right column (360px): header "Tus operaciones" until the simulator is first opened, then tabs "Operaciones (n) | Simular" (dot on Simular while a valid simulation is drawn); footer button "Simular operación" (calculator) on the trades tab; body scrolls inside the column. `BuySimulator` is now body-only and vertical (Precio en + Comisión row, market line with icon-only Actualizar, stacked order rows with side + mode on one line and qty/price in a 2-col grid, 2-col stat tiles with `stacked` sub, insights as compact list). `TradesList` is list-only. Decisions: simulation is active (chart line + ghost markers) while it has valid orders regardless of tab, so it can be compared with real trades; hiding the column via the toolbar toggle pauses it (no quotes, no overlays, pick cancelled; drafts kept); the column also shows for instruments without trades so they can still be simulated. Authenticated UI not exercised in a browser.
- 2026-11-12: Review fixes. (1) per-row realizado/cost show "—" without a money factor. (2) cleanup of the quote effect resets `simRefreshing`. (3) `moneyFactor(kind, quotes, chartLastClose)`: theoretical CEDEAR = native quote / series last close, null otherwise (RED: 2 failing -> GREEN). (4) memoization left to React Compiler (enabled; eslint clean). (5) `ghostMarkers` drops 0-unit orders and merges same side+price (RED -> GREEN). (6) `changeSimBasis` blocks the switch with a notice when a typed number can't be converted. (7) `fetchLiveQuoteFromData912` got `{ fresh, signal }` (other caller `data.ts` unchanged); load-quote uses fresh + 5s AbortSignal for data912 and a 5s race for Yahoo (yahoo.ts untouched, so the Yahoo request isn't aborted, just ignored); data912 hint reads "consultado hh:mm". (8) lookup error in load-quote degrades to `{ price: null }` (404 kept for unknown instrument). (9) `parseDecimalInput` strict (RED 2 tests -> GREEN). (10) `buy-simulation.ts` + test deleted (ledger test already covers 34 @ 7301.91 + 10 @ 4975). (11) sell-by-amount test added in order-drafts.test.ts (sizing already covered in order-sizing.test.ts).
