# Reinvent /monitoreo → /activos

## Objective
Turn `/monitoreo` into an asset page ("Activos") where picking a ticker immediately shows its full price history, the user's own trades placed at the exact price they happened (also on the original-exchange chart of a CEDEAR), and the position context needed to read them.

## Problem
- History only loads after pressing "Cargar histórico"; the default read is cache-only (`PriceCache`, last 2 years) and falls back to a single live bar.
- Trade markers are placed by bar date (below low / above high), never by price, so the user can't see where inside the candle they bought or sold.
- On the CEDEAR "USD subyacente" view, markers carry the ARS trade price, which is not comparable to the USD underlying bars; nothing projects it.
- Range changes refetch from the server (and from the 2-year cache, which can shrink a loaded 10-year "ALL").
- The name "Monitoreo" doesn't describe the page (per-asset price + own activity).

## Decisions
- **Name**: route `/activos`, sidebar label "Activos". `/monitoreo` redirects to `/activos`. Internal module names (`src/lib/monitoreo`, `src/components/monitoreo`, actions) stay as-is in this feature to keep the diff reviewable; renaming them is a follow-up.
- **Auto history**: selecting an instrument (and the initial bootstrap) renders the cached series right away and, when coverage is insufficient (pure rule `shouldLoadHistory`), loads history in the background with an inline status. The button is removed. Each instrument+kind is loaded at most once per page session.
- **Client-side range**: fetch the whole series once per instrument+kind and filter by range on the client (`filterBarsByRange`) — instant range switches, no shrink after a history load.
- **Price projection** (pure, tested): each trade gets a `chartPrice` in the displayed series' scale:
  - native series, same currency → trade price.
  - native ARS series, USD trade → price × CCL(trade date).
  - cedear-underlying → priceArs × (underlyingClose(d) / cedearArsClose(d)), d = trade date with a short on-or-before lookback on both series; USD trades are converted to ARS with CCL first.
  - Anything missing → `chartPrice = null`, marker falls back to date placement and is flagged as approximate.
- **Markers**: one marker per trade, placed at `(trade bar, chartPrice)` on the candle; hover shows tooltip + dashed price line to the axis. Default chart type becomes candles.
- **Position context**: average-cost line (in chart scale) and position summary computed from the projected trades; hidden when a corporate event after a trade breaks comparability.
- **Interactivity**: trades list next to the chart, cross-highlighted with markers; clicking a trade scrolls the chart to it. Selection is kept in the URL (`?ticker=…&vista=…`).

## Scope
- In: `/monitoreo` page, its actions, `src/lib/monitoreo/*` pure modules, kline chart component, sidebar entry, redirect.
- Out: renaming internal modules, cedear-theoretical series, extending the 2-year persistence window, drawing tools.

## Constraints
- Pure logic in `src/lib/monitoreo/` with Vitest tests; Prisma/server actions/client components untested by repo convention.
- Non-standard Next.js: read `node_modules/next/dist/docs/` before touching any Next API (redirect, searchParams, server actions).
- klinecharts v10: read shipped `.d.ts` before using new APIs (e.g. scroll to timestamp).
- UI copy in Spanish (existing UI); code, identifiers and comments in English.
- Repo is pnpm-managed. Use rg/fd/bat/eza instead of grep/find/cat/ls.
- Planning heuristic ~400 changed lines per task (advisory only, not a cap).

## TDD
- Mode: strict (source: user global config "Strict TDD Mode: enabled")
- Runner: `npm test` (vitest run); single file `npx vitest run <path>`

## Tasks
- [x] T1 Pure `trade-projection.ts`: `projectTradePrice` per rules above (incl. lookback, CCL conversion, null fallback) — RED → GREEN → REFACTOR
- [x] T2 Rework `buildTradeMarkers`: one marker per trade with `chartPrice` / `approximate`, `changeSinceTradePct` from the projected price vs last close (still gated by corporate events); plus pure `buildPositionSummary` (qty, avg cost in chart scale, unrealized %) — tests first
- [x] T3 Pure `shouldLoadHistory(series, today)` — tests first
- [x] T4 Server: `getInstrumentTradeMarkersAction` also returns the projection inputs (CEDEAR native ARS closes around trade dates, CCL as-of trade dates)
- [x] T5 Chart: price-anchored markers, hover price line, avg-cost line, fallback styling, `scrollToTrade` API; default candles
- [x] T6 Page: auto history load (no button), client-side range, header with price/change stats, position summary, trades list cross-highlight, URL state
- [x] T7 Route rename `/activos` + `/monitoreo` redirect + sidebar label/metadata

### Round 2 (user feedback after browser check, 2026-11-05)
- [x] T8 Bug: "Tus operaciones" column disappears after switching ticker and only returns on reload — find root cause, fix, regression test if the cause lives in pure logic
- [x] T9 Chart space: chart fills the available viewport height, compact page header, collapsible trades panel (chart takes full width when collapsed), fullscreen toggle
- [x] T10 App navigation (user chose the left app menu, not the trades panel): collapsible to an icon rail on desktop (state remembered per browser), mobile drawer kept working, taller/roomier nav items
- [x] T11 Drawing tools on the chart (klinecharts built-in overlays): trend line, ray, horizontal line, price line, parallel channel, Fibonacci retracement, rectangle/annotation; select/delete, clear all, magnet snap; drawings persisted per ticker+view in localStorage
- [x] T12 General polish found while doing T8–T11 (only small, in-scope improvements; list them)
- [x] T13 Trade markers scale with candle width (size from `getBarSpace().bar`, no side glyph, tick when very narrow, pure `markerGeometry`)

## Acceptance criteria
- Selecting a ticker shows history without any extra click; a background load is visible but non-blocking.
- On a CEDEAR in "USD subyacente", each buy/sell sits at its equivalent price on the underlying candle; on "ARS CEDEAR" and local stocks, at the trade price.
- Trades without projection inputs still render (by date) and say so in the tooltip.
- Range switches are instant and never drop already-loaded history.
- `/monitoreo` lands on `/activos`.

## Checks
- `npm test`, `npx tsc --noEmit`, `npm run lint` (baseline: 0 errors / 35 warnings).

## Progress
- Exploration done (2026-11-05). Next: T1–T4 (pure + server) by one writer, then T5–T7 (UI) by one writer.
- T1 done. RED: `npx vitest run src/lib/monitoreo/trade-projection.test.ts` -> "Cannot find module './trade-projection'". GREEN: 13/13 (one test-date bug fixed in the test: 03-12 is only 3 days after 03-09, changed to 03-15). CCL lookups use the same 5-day as-of lookback (deviation: spec only stated it for bars; keeps stale rates out).
- T2 done. RED: `npx vitest run src/lib/monitoreo/trade-markers.test.ts` -> 19 of 24 failed (one-marker-per-trade, chartPrice/approximate, projectTrades/buildPositionSummary missing). GREEN: 24/24. API: `projectTrades` (unclipped, for position math) + `buildTradeMarkers(trades, bars, ctx, events, projectionBars = bars)`. Deviation: `buildPositionSummary` only treats a missing chartPrice on BUYs as blocking (a sell never uses its own price). `kline-chart.tsx` / `monitoreo-page.tsx` minimally adapted (single trade tooltip, no "mixed").
- T3 done (new module `history-policy.ts`, series.ts untouched). RED: "Cannot find module './history-policy'". GREEN: 7/7.
- T4 done (typecheck only, no unit test by convention). `getInstrumentTradeMarkersAction` returns `nativeArsCloses` (data912-eod preferred, yahoo-eod fallback per date) and `cclByDate` (via `loadCclSeries`, filtered to [tradeDate-7d, tradeDate] windows). Exports type `TradeMarkerData`.
- Checks after T1-T4: `npm test` 82 files / 915 tests passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 11 warnings.
- T5 done (`kline-chart.tsx`). Markers sit at (barTime, chartPrice) with a dark ring + side glyph (▲/▼) to the left; approximate ones keep date placement with a hollow dashed style; out-of-pane prices clamp to the edge and render as an arrow. Hover/active marker shows tooltip + dashed line to the axis with price label; `avgCost` draws the dashed "PPC" line. Props added: `avgCost`, `activeMarkerId`, `onMarkerHover`, `focusRequest`, `scaleLabel`. Deviation: scroll uses a separate `focusRequest {id, seq}` instead of reacting to `activeMarkerId`, because row hover also changes `activeMarkerId` and must not scroll. Scroll uses `getVisibleRange` + `scrollToDataIndex` (puts the bar at the right edge, so it aims half a screen further to centre; no-op when already visible).
- T6 done (`monitoreo-page.tsx` + `stat-tile`, `asset-header-stats`, `position-panel`, `trades-list`). New pure helpers, tests first. RED: `npx vitest run src/lib/monitoreo/asset-stats.test.ts src/lib/monitoreo/activos-selection.test.ts` -> both files failed to import (modules missing). GREEN: 14/14 (`asset-stats.ts`: header stats; `activos-selection.ts`: URL param parsing/building, initial selection, portfolio-first sort). `loadMonitoringBootstrap({ticker, vista})` resolves the deep link. History: derived `needsHistory` + effect (no sync setState), `requestedHistoryRef`, and `loadedSeriesRef` (a loaded full series is reused when returning to an instrument instead of refetching the 2-year cache). Trades list uses markers built against FULL bars; the chart gets those inside the range; clicking a trade older than the range widens it to ALL. Trades before the first available bar are not listed (no bar to anchor).
- T7 done. Route moved with `git mv` to `src/app/(app)/activos/` (page + loading.tsx); `/monitoreo/page.tsx` redirects preserving the query string; sidebar uses `CandlestickChart`; `revalidatePath` list in `transactions/mutations.ts` now targets `/activos`.
- Checks after T5-T7: `npm test` 84 files / 929 tests passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 11 warnings; `npm run build` succeeded. Not verified in a browser (chart overlay positioning, scroll-to-trade, list/chart height, redirect with query).
- Verification fixes (independent verifier F1-F5):
  - F1: server orders by `tradeDate, createdAt, id`; pure `compareChronological` puts BUY before SELL on the same day (`projectTrades`, `buildPositionSummary`). RED: 2 new same-day tests failed. GREEN after fix; one old test (buy/sell/buy all on one day) relied on input order, so its trades got distinct dates.
  - F2: `kline-chart.tsx` keeps a pending focus ref, retried on rAF and whenever bars/markers change until the bar is found; cleared on apply and when the instrument changes. Not unit-tested (component).
  - F3: new pure `filterBarsByRangeFromLast` (window anchored to the last bar); page uses it, server callers keep `filterBarsByRange`. RED: function missing (2 tests failed). GREEN.
  - F4: `syncUrl` uses `window.history.replaceState` (docs 04-linking-and-navigating.md: integrates with `usePathname`/`useSearchParams`); `useRouter` removed.
  - F5: server drops yahoo-eod fallback closes dated before a later corporate event; `TradeProjectionContext` gains `seriesAdjusted` + `corporateEventDates`, native projection returns null when adjusted and an event is after the trade; `isSeriesAdjusted` (split-adjusted policy or yahoo-eod source) used by the page. RED: 3 failures (isSeriesAdjusted missing, no null). GREEN.
  - Checks: `npm test` 84 files / 936 tests passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 11 warnings.

### Round 2 progress
- T8 root cause (read from `node_modules/next/dist/client/components/app-router-instance.js`; not reproduced in a browser, no authenticated session): `syncUrl` called `window.history.replaceState` during the click. Next patches `replaceState` and dispatches `ACTION_RESTORE`, which marks the in-flight series server action as `discarded` and becomes `actionQueue.pending`. The trades action is dispatched from the `[selectedId]` effect, which React flushes synchronously at the end of the click commit — i.e. before the RESTORE's async reducer settles, so `pending !== null`. Next then appends it to `actionQueue.last.next`, but `last` is still the discarded series action (RESTORE never updates `last`), while the RESTORE took `next` from the series action earlier. When the RESTORE finishes it advances to `null`, so the appended action is never started: its promise never resolves, `tradeData` stays `null`, panel hidden until a reload (no series action in flight on reload, and cached/`loaded` switches have no pending action so they were unaffected). Fix: `replaceState(window.history.state, ...)` — Next's patch bypasses the router when the state carries `__NA`, so no RESTORE is dispatched (we never use `useSearchParams`). Also added a `.catch` to the trades fetch so a rejected action degrades to an empty list instead of an unhandled rejection. No pure-logic regression test possible (cause lives in Next client queue + component effect timing). Kind toggle: `tradeData` is per instrument and untouched by the toggle, so the panel persists across toggle and back.
- Pure helpers, tests first. RED: `npx vitest run src/lib/monitoreo/marker-geometry.test.ts src/lib/monitoreo/drawings-storage.test.ts src/lib/ui/safe-storage.test.ts` -> 3 files failed to import (modules missing). GREEN: 19/19.
  - `marker-geometry.ts`: `markerGeometry(barWidth, side)` -> shape (`tick` < 4px, else `triangle-up` buy / `triangle-down` sell), size = body width clamped 4..12, ring 0 under 6px else 1px, hit target >= 12px.
  - `drawings-storage.ts`: per `ticker+kind` key, tolerant parse/serialize, required point counts per tool.
  - `safe-storage.ts` + `use-stored-boolean.ts` (useSyncExternalStore: server/first render use the default, stored value after hydration; in-memory fallback if storage is blocked).
- T9: page is a viewport-height flex column on `lg` (`100dvh - 6.5rem`, min 560px; fixed 520px chart on mobile), single-row toolbar, stats + position tiles flow in one compact strip (StatTile/AssetHeaderStats/PositionPanel now render tile fragments), Card wrapper dropped. Trades panel toggle ("Operaciones", localStorage `activos:trades-collapsed`); chart goes full width when collapsed. Chart fills its parent (`height` prop removed); ResizeObserver already calls `resize()`. Fullscreen button on the chart (Fullscreen API on the chart root, fixed-position fallback + Esc). Overlap fix: chart top bar is one non-wrapping line, root is `isolate overflow-hidden`; indicator picker compacted.
- T10: sidebar collapses to a 4rem icon rail (`nav:collapsed`, width transition, Radix tooltips with labels, aria-labels, brand "P", palette toggle becomes a cycling icon button, theme toggle icon-only), sticky full-height aside, items `min-h-11 py-2.5` with 20px icons. Mobile drawer unchanged (never collapsed; nav now scrolls if short).
- T11: `drawing-toolbar.tsx` + overlay logic in `kline-chart.tsx`: segment, rayLine, horizontalStraightLine, priceLine, parallelStraightLine, fibonacciLine, simpleAnnotation (verified in klinecharts v10 bundle; no rect/simpleTag in toolbar). Magnet cycles off/weak/strong via overlay `mode`. Delete/Backspace deletes selection, Esc cancels drawing, "borrar todo". Persist on draw end / move end / remove under `activos:drawings:v1:<TICKER>:<kind>`; restored on mount and view change (saves suppressed while restoring). Overlay styles set in the dark theme (teal). Marker layer gets `pointer-events-none` while a tool is active. Deviation: toolbar uses native `title` tooltips, not Radix (portals are invisible in native fullscreen); annotation text via `window.prompt`; rectangle omitted (not a built-in overlay in v10 extensions list).
- T12 polish: range shortcuts 1/3/6/Y/A (ignored in inputs/with modifiers; hint in the range group title); loading skeleton/empty states fill the chart area.
- T13: markers now a triangle (buy up, sell down) centred at (candle, exact price) sized from `chart.getBarSpace().bar` (recomputed on zoom/scroll/resize already scheduled), thin ring only >= 6px, one-candle-wide 2px tick when narrower than 4px, approximate markers hollow dashed/translucent tick, side glyph and same-day horizontal offset removed (each trade stays at its own price). Hit target >= 12px invisible.
- Checks: `npm test` 87 files / 955 tests passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 11 warnings; `curl` /activos, /dashboard, /monitoreo -> 307 (unauthenticated, no 500). Not verified in a browser.

### Fix — chart pan/zoom blocked (user report)
- Cause: the marker layer (`absolute inset-0 z-10`) took pointer events whenever no drawing tool was active, swallowing drag-to-pan and wheel zoom.
- Fix (`kline-chart.tsx`): layer is always `pointer-events-none`; only marker hit targets are `pointer-events-auto`, and only with no active tool. `tsc` clean, eslint clean on the file. Pending browser confirmation.

### Code review fixes
- R1 URL sync: client fetches moved off server actions onto route handlers `GET /api/activos/series`, `POST /api/activos/history` (writes the price cache), `GET /api/activos/trades` (all `force-dynamic` + `Cache-Control: no-store`, auth via `getCurrentUser` -> 401 JSON, zod -> 400, missing -> 404). Shared bodies live in `src/lib/monitoreo/` (`load-history.ts`, `load-trade-data.ts`, `api-schemas.ts`, `trade-marker-data.ts`); `src/app/actions/monitoreo.ts` deleted (page was the only user). Browser side: `activos-client.ts` (`fetchSeries`/`postHistory`/`fetchTrades`, never throw, `{error}` on network/non-OK/non-JSON). `syncUrl` now uses the documented `window.history.replaceState(null, "", url)`; no queued server action exists to orphan. `proxy.ts` matcher already excludes `/api`, so unauthenticated calls get the handler's JSON 401, not an HTML redirect. Supersedes the T8 `window.history.state` workaround. Not unit-tested (handlers/components). Needs a browser check: switch ticker, trades panel returns, Back from another page restores the right ticker.
- R2 Trades outside the bar range: new pure `buildTradeEntries` (all trades, `barTime: string | null`); `buildTradeMarkers` is now the anchored subset. List shows every trade; unanchored ones are non-interactive with "Sin vela: fuera del histórico disponible". Panel visibility is `tradeEntries.length > 0`. RED: `npx vitest run src/lib/monitoreo/trade-markers.test.ts` -> 4 `buildTradeEntries is not a function`. GREEN: all pass.
- R3 PPC line outside the visible range: layout tracks `avgCostEdge`; line dimmed, label gets an up/down arrow and keeps the real price (label drops below the line at the top edge).
- R4 `MonitoringBootstrapData` gained `selectedKind` / `selectedCurrency` (set by `loadMonitoringBootstrap`, also when `initialSeries` is null); page initializes `kind` from it.
- R5 Escape: single keydown handler (placed after the fullscreen state) — Escape cancels an in-progress drawing, else leaves CSS fullscreen; one press does one thing.
- R6 CCL/close queries limited to `[min trade date - 7d, max trade date]`; windows merged and walked in one pass by pure `selectPointsInWindows` / `tradeQueryBounds` (`ccl-windows.ts`). RED: `npx vitest run src/lib/monitoreo/ccl-windows.test.ts` -> failed to import (module missing). GREEN: 7/7. `loadCclSeries()` no longer used here.
- R7 Docs now sit on the right symbols (`TradeMarkerData` in `trade-marker-data.ts`; handler/loader comments on their functions).
- R8 `palette-toggle.tsx`: unknown stored palette reads "Paleta: personalizada (cambiar a <first>)".
- Dedup: `EMPTY_TRADE_MARKER_DATA` exported constant, used by the loader and the page.
- Checks: `pnpm test` 88 files / 966 tests passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 11 warnings; unauthenticated curl on the 3 handlers -> 401 each (JSON).

### Follow-up optimizations (2026-11-05)
- Position summary now reuses `tradeEntries` projections instead of calling `projectTrades` again (`monitoreo-page.tsx`).
- `trade-projection.ts`: local binary-search `asOf` replaced by `TimeSeries.asOf` (`src/lib/rendimientos/price-series.ts`) with the 5-day lookback checked on the hit date; new `prepareProjection` builds the lookup series once per `projectTrades` call (`projectPreparedTradePrice`). Behavior-preserving refactor under the existing tests.
- Checks: `pnpm test` 966/966, `tsc` clean, lint 0 errors / 11 warnings.

### Round 3 (2026-11-05)
- [x] T14 Measure ruler like TradingView (price range + date range): toolbar tool and Shift+click shortcut; two-point drag/click measure drawing a translucent rectangle (green up / red down) with a label: price change (abs + %), bars count, calendar span, summed volume. Ephemeral (removed on next click / Esc), not persisted. Pure measure stats in `src/lib/monitoreo/` with tests first.
- T14: pure `src/lib/monitoreo/measure.ts` (`computeMeasure`, `formatMeasureLines`) + `measure.test.ts` (12 tests). RED: suite failed on the missing module (1 file failed, 966 others passed); GREEN: 89 files / 978 tests, then 979 with a new drawings-storage test proving `measure` is never serialized/restored. Chart side: `measure-overlay.ts` registers a klinecharts v10 overlay via `registerOverlay` (`totalStep: 3`, `createPointFigures` returning `rect`/`line`/`text` figures, `needDefault*Figure`, `mode` for magnet, `onDrawEnd`/`onRemoved`, `overlay.extendData` for currency, `chart.getDataList()` for bars/volume), own group `measure-ruler` so `persistDrawings` (group `user-drawings`) ignores it. `kline-chart.tsx`: toolbar "Medir" (Ruler icon) + Shift+click (capture-phase `pointerdown`, cursor tool only), removed on click outside the finished rectangle, Esc, tool switch, view/currency/ticker change; marker layer gets `pointer-events-none` while measuring. Definitions: barsCount = bars after the earlier point up to the later one (TradingView-style, start excluded); volume sums both ends inclusive. Deviations: click-drag-release not supported (klinecharts completes steps on click, a drag pans); label is three stacked text figures (single-line text figure). Not verified in a browser. Checks: pnpm test 979 pass, tsc clean, lint 0 errors / 11 warnings.
- [x] T15 Split-adjusted series on /activos, reversible: adjust at READ time only (PriceCache stays raw, no schema/data change) per source — data912-eod raw → `adjustBarsForEvents` with the instrument CorporateEvents; fmp-eod raw → underlying split events (Yahoo split events of the underlying symbol); yahoo-eod / yahoo-underlying-eod already provider-adjusted → untouched. Trade prices on adjusted native series divided by the factor of later events (same rule as `applyEventsToTrade`). Real `adjustmentPolicy` label. UI toggle "Ajustado / Sin ajustar" (default ajustado). Kill switch env `ACTIVOS_SPLIT_ADJUSTMENT=off` restores the previous raw behavior exactly. Isolated commits so `git revert` is clean.

- T15 (split-adjusted series, read time only): PriceCache and what `persistMissingRecentBars` writes are unchanged (raw); the returned copy is adjusted after merging and before range filtering in both `fetchMonitoringSeries` and `loadMonitoringHistory`.
  - Per-source rule (pure `src/lib/monitoreo/split-adjustment.ts`): `data912-eod`/`data912-live` -> the instrument's CorporateEvents through `adjustBarsForEvents` (volume untouched); `fmp-eod` -> real splits of the underlying from Yahoo (`fetchYahooHistory(...).splits`, symbol = routing `externalSymbol`, cached 6h), served raw + Spanish `dataQuality.warning` if they can't be fetched; `yahoo-eod`/`yahoo-underlying-eod` -> untouched (never double-adjusted). `adjustmentPolicy` is now truthful: "raw" | "split-adjusted" | "provider-adjusted" (footer in Spanish); the series also carries `adjustmentEvents` (what we applied).
  - Trades: adjusted native series divide the trade price by the product of ratios of events after the trade date (same comparison as `applyEventsToTrade`), before any CCL conversion; split-adjusted uses the series' own events, provider-adjusted uses the instrument's CorporateEvents (`TradeMarkerData.corporateEvents`). Later events no longer block `changeSinceTradePct`/position for adjusted series; raw series keep the legacy gating. cedear-underlying unchanged (same-day factor; `nativeArsCloses` are read straight from PriceCache, never adjusted).
  - UI: "Ajustado / Sin ajustar" toggle (default Ajustado) next to the range controls; sent as `adjusted=0|1` (query on `GET /api/activos/series`, query or boolean in the `POST /api/activos/history` body); client series cache keys on it; not in the URL.
  - Kill switch: env `ACTIVOS_SPLIT_ADJUSTMENT=off` (read only in `split-adjustment-config.ts`). Server then ignores `adjusted`, serves the previous behavior exactly (label "raw", legacy gating) and hides the toggle (`MonitoringBootstrapData.splitAdjustmentEnabled`). `.env.example` intentionally not touched (unrelated user changes there).
  - Tests first. RED: `pnpm test` -> `split-adjustment.test.ts` failed to import (module missing) and 4 new `trade-projection` adjustment tests failed (2 files failed). GREEN: 90 files / 1001 tests passed (one assertion in my own test corrected: OHLC high/low are divided too).
  - Checks: `pnpm test` 90 files / 1001 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors / 11 warnings; unauthenticated GET /api/activos/series and POST /api/activos/history -> 401 JSON (checked on a temporary dev server on :3011, since nothing was listening on :3000). Not verified in a browser.
  - Roll back: set `ACTIVOS_SPLIT_ADJUSTMENT=off` (no deploy of code needed beyond the env), or `git revert` the T15 commits (list in the delivery notes).

- T15 verification fixes (2026-11-05):
  - V1: `buildPositionSummary` takes optional `adjustmentEvents`; quantities are multiplied by `adjustmentFactorAfter` (same rule as `applyEventsToTrade`), so buy weighting and sells run in post-event units (example: 10@100 pre 2:1 split + 20@60 after -> avg 55, qty 40). The page passes the events only for `kind === "native"` series (cedear-underlying projection ignores events).
  - V2: provider-adjusted series restored to legacy behavior in `resolveTradeAdjustment` (`adjustmentEvents: undefined`, gating on `corporateEventDates`); only `split-adjusted` divides trades by factors.
  - V3: new pure `underlyingSplitSymbol(instrument)` (CEDEAR -> underlying ticker, else own ticker); used by `load-series.ts` (derived from the effective source path, no longer the primary routing symbol) and `load-history.ts`.
  - Tests first. RED: `pnpm test` -> 3 failed (position summary across split, provider gating, symbol helper). GREEN: 90 files / 1005 passed. `npx tsc --noEmit` clean; `npm run lint` 0 errors / 11 warnings.
