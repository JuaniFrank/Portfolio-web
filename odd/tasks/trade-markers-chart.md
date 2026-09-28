# KLineChart with buy/sell markers in /monitoreo

## Objective
Replace the lightweight-charts candlestick/line chart in `/monitoreo` with a KLineChart chart that (a) plots the user's BUY/SELL trades for the selected instrument as markers and (b) shows trade metrics on hover, plus (c) TradingView-like built-in technical indicators (volume, MA/EMA/BOLL on the price pane, MACD/RSI/etc. in sub-panes).

## Problem
The TradingView embed widget is a cross-origin iframe with no API for custom marks; Advanced Charts' `createExecutionShape` is Trading Platform only. KLineChart (Apache-2.0) ships indicators computed from the OHLCV we already store in `PriceCache` and allows custom overlays.

## Why KLineChart
User chose it over lightweight-charts + trading-signals to get built-in indicators (and drawing tools later) without writing each indicator. Tradeoff accepted: a second charting library in the repo (lightweight-charts stays for the dashboard evolution chart).

## Scope
- `/monitoreo` chart only (`MonitoringChart` replaced; line/candle toggle kept).
- Trade markers: BUY/SELL `Transaction` rows of the user's default portfolio for the selected instrument, within the displayed bar range. Multiple trades on the same day aggregate into one marker (buy, sell or mixed).
- Marker placement is by bar date (below low for buys, above high for sells) — never by trade price, because the displayed series may be in another scale/currency (CEDEAR underlying, USD, unadjusted data912 bars).
- Hover tooltip: date, side, quantity, price + currency, gross amount, fees; "change since trade" vs last close only when comparable (native series, same currency as the trade, and no corporate event for the instrument after the trade date).
- Indicator picker: main-pane (MA, EMA, BOLL, SAR) and sub-pane (VOL, MACD, RSI, KDJ) toggles; VOL on by default.

Out of scope (v1): drawing tools, per-ticker route, markers on the /rendimientos table.

## Constraints
- Pure marker/tooltip logic in `src/lib/monitoreo/` with Vitest tests; Prisma/server action and client component untested by repo convention.
- Next.js version is non-standard: read `node_modules/next/dist/docs/` for any Next API touched (server actions).
- Read KLineChart v10 shipped type declarations/docs before coding against it.
- UI copy in Spanish (existing /monitoreo UI is Spanish); code/comments in English.
- Repo is pnpm-managed (`pnpm add`).

## TDD
- Mode: strict (source: user global config "Strict TDD Mode: enabled")
- Runner: `npm test` (vitest run)

## Tasks
- [x] T1 Pure module `trade-markers.ts`: group trades by bar date (snap to next available bar), side aggregation, tooltip metrics incl. comparability rule — tests first (RED → GREEN → REFACTOR)
- [x] T2 Server action returning the instrument's BUY/SELL trades + corporate event dates for the current user
- [x] T3 Install `klinecharts`; new KLineChart client component (candles/area, dark theme, markers overlay, hover tooltip, indicator picker); replace `MonitoringChart` in `monitoreo-page.tsx`
- [x] T4 Verify volume coverage in `PriceCache` for monitored sources; document gaps

## Acceptance criteria
- Selecting an instrument with trades shows one marker per trade day at the right bar; hover shows the metrics above.
- Indicators toggle on/off; VOL visible by default when bars have volume.
- Line/candle toggle, range and currency controls keep working.

## Checks
- `npm test`: 458/458 passed.
- `npx tsc --noEmit`: clean, 0 errors.
- `npm run lint`: 0 errors / 35 warnings (matches main baseline exactly — no new warnings introduced).
- Not verified in a real browser (no dev-server/visual pass was run in this session).

## Progress

### T1 — `src/lib/monitoreo/trade-markers.ts` + `trade-markers.test.ts`
- RED: `npx vitest run src/lib/monitoreo/trade-markers.test.ts` → `Error: Cannot find module './trade-markers'` (14 tests, 0 ran) — module didn't exist yet.
- GREEN: same command → `14 passed (14)`.
- Implemented `buildTradeMarkers(trades, bars, seriesContext, corporateEventDates)`: snaps each trade to the first bar on/after its date (drops trades outside `[firstBar.time, lastBar.time]`), groups by bar date, aggregates side (buy/sell/mixed) and totals (buy/sell/net quantity, gross, fees), and computes `changeSinceTradePct` (vs the series' last close) only when `kind === "native"`, trade currency matches the series currency, and no corporate event `effectiveDate` is strictly after the trade date.
- No refactor needed after GREEN — kept as written.

### T2 — `getInstrumentTradeMarkersAction` in `src/app/actions/monitoreo.ts`
- Resolves the caller's default portfolio the same way `listMonitoringInstruments` does (`isDefault desc, createdAt asc`, `archivedAt: null`); returns `{trades: [], corporateEventDates: []}` if there's none.
- Trades: `Transaction` rows for that portfolio + instrument, `type in [BUY, SELL]`, Decimal/Date fields serialized to plain number/string (`TradeMarkerInput`).
- Corporate events: scoped to instruments the user has actually transacted, same ownership check as the existing `listCorporateEvents` (events.ts) — `instrument: { transactions: { some: { portfolio: { userId } } } } }`.
- Unauthorized → `{ error: "unauthorized" }`; invalid input → zod-validated `{ error }`.
- Verified via `npx tsc --noEmit` (clean) — no dedicated test per repo convention (server actions/Prisma orchestration are excluded from Vitest coverage, per project memory).

### T3 — `klinecharts` + `src/components/monitoreo/kline-chart.tsx`
- Installed `klinecharts@10.0.3` via `pnpm add klinecharts`.
- Read `node_modules/klinecharts/dist/index.d.ts` + README before coding; v10 has **no** `applyNewData`/`setData` — confirmed by grepping the bundle (no matches) and by the official docs (fetched via WebFetch): data is pulled through `chart.setDataLoader({ getBars })`, triggered on `setSymbol`/`setPeriod`/scroll-to-boundary. `chart.resetData()` forces a fresh `getBars` call — used whenever the `bars` prop changes (range/currency/history-load), so the chart is created once and never recreated for those. The chart *is* recreated when `ticker` (instrument) changes — a deliberate exception, since indicators/markers should reset for a new instrument anyway.
- Confirmed `window is not defined` when `require("klinecharts")` runs in plain Node → not SSR-safe → imported dynamically inside the mount effect; only `import type {...} from "klinecharts"` is used at module scope (erased at compile time).
- Confirmed built-in indicator name strings by grepping the shipped bundle: `MA`, `EMA`, `BOLL`, `SAR` (main pane, `series: 'price'`), `VOL` (`series: 'volume'`), `MACD`, `RSI`, `KDJ` (sub panes). Toggled via `chart.createIndicator(name)` / `chart.removeIndicator({ name })`, relying on the library's automatic pane placement (confirmed via the official `createIndicator` docs).
- Markers are **not** KLineChart overlays — they're plain React divs (arrow icons, emerald/rose/neutral-gray for mixed) positioned via `chart.convertToPixel({ timestamp, value }, { paneId: "candle_pane" })`, then offset by a fixed 14px in *screen* pixels (not price units) so the offset looks consistent regardless of price scale. Repositioned on `onZoom`/`onScroll`/`onVisibleRangeChange` (via `subscribeAction`, rAF-batched) and on resize/marker/bar changes. This was simpler and safer than `registerOverlay`, and keeps the hover tooltip (a separate absolutely-positioned React div, per the task's explicit requirement) trivial to implement.
- OHLCV top info bar reproduces the old lightweight-charts behaviour via `chart.subscribeAction("onCrosshairChange", ...)`; the library's own built-in candle tooltip is disabled (`candle.tooltip.showRule: "none"`) to avoid a duplicate box.
- Dark theme via `chart.setStyles(...)`/init `styles` option, matching the previous zinc/emerald/rose palette (`#27272a` grid, `#3f3f46` axis lines, `#10b981`/`#f43f5e` candle colors, `#71717a` crosshair).
- Replaced `MonitoringChart` in `monitoreo-page.tsx`; fetches `getInstrumentTradeMarkersAction` when `selectedId` changes and computes markers via `buildTradeMarkers` (`useMemo` on `series`/`tradeData`). Deleted `src/components/monitoreo/monitoring-chart.tsx` (no remaining imports) and updated a stale doc-comment reference to it in `src/components/dashboard/portfolio-evolution.tsx`.
- **Lint fixes during this task**: the repo's React Compiler ESLint rules (`react-hooks/refs`, `react-hooks/set-state-in-effect`) flagged two real issues — mutating `barsRef.current`/`markersRef.current` during render (moved into the effects that already depend on `[bars]`/`[markers]`), and a synchronous `setState` inside a `useEffect` body in `monitoreo-page.tsx` (replaced with the React-docs "adjust state during render" pattern: `if (selectedId !== tradeDataInstrumentId) { setTradeDataInstrumentId(selectedId); setTradeData(null); }`, so stale markers from a previous instrument never flash against the new instrument's bars). Final `npm run lint`: 0 errors, 35 warnings (== main baseline).

### Independent verification fix (T3)
- Verifier found: in area mode (the default "line" view) KLineChart builds the main y-axis range from `close` only (`YAxisImp.createRangeImp`, `isArea` branch), so markers anchored on `high`/`low` could land outside the pane and be clipped. Fix in `kline-chart.tsx`: anchor on `close` unless `chartType === "candles"`, via a `chartTypeRef`; the chart-type effect now also reschedules marker positions.
- After fix: `npx tsc --noEmit` clean; `npm run lint` 0 errors / 35 warnings (baseline); `npm test` 458/458.
- Minor, not fixed: trade-marker fetch errors fall back silently to no markers (no toast).

### Bug fix — markers never rendered in dev (T3)
- Symptom (user, GGAL, candles, ALL, data912-eod): no markers. Data path verified correct via a scratchpad replica of the action + `buildTradeMarkers` → markers `2025-10-27` and `2026-07-13` (buy).
- Root cause: the unmount cleanup cancelled the pending rAF but left `rafRef.current` set; after React Strict Mode's dev remount, `schedulePositionUpdate` bailed forever. Fix: reset `rafRef.current = null` in the cleanup.
- After fix: `npx tsc --noEmit` clean; `npx eslint src/components/monitoreo/kline-chart.tsx` clean. Browser confirmation pending (user).

### UX fix — marker hover flicker (T3)
- Symptom (user): hover only worked when entering the circle from above; the tooltip appeared over the circle, stole the pointer, fired `mouseleave` and closed.
- Cause: tooltip anchored at `y ± 8` with a higher z-index, covering half of the 16px circle.
- Fix in `kline-chart.tsx`: tooltip is `pointer-events-none` and opens beside the circle (right, or left when it doesn't fit), vertically centred on the circle and clamped inside the pane.
- After fix: `npx tsc --noEmit` clean; `npx eslint src/components/monitoreo/kline-chart.tsx` clean. Browser confirmation pending (user).

### T4 — Volume coverage in `PriceCache`
- Read-only script in the session scratchpad (`/private/tmp/.../scratchpad/check-volume-coverage*.ts`, never committed), run via `npx tsx` against the local dev DB, using `prisma.priceCache.groupBy`/`count` only (no writes).
- Findings (local/dev DB, not necessarily production):
  - `yahoo-eod`: 4179 rows across 23 instruments, **0 null volume (100% coverage)** — this is the only monitored source with any cached data right now.
  - `data912-eod`, `yahoo-underlying-eod`, `fmp-eod`, `data912-live`: **0 rows** in this DB — no data to assess yet.
  - Two legacy/orphaned source strings exist outside the current naming scheme (`data912`, `yahoo` — bare, no `-eod` suffix): 74 and 215 rows respectively, **100% null volume**. Neither is one of `provider-routing.ts`'s current source constants, so current monitoring code (`loadCachedMonitoringBars`, `listMonitoringInstruments`) never reads them — they're dead data as far as this feature is concerned, not a live gap.
- Gap to flag: VOL will render correctly wherever `yahoo-eod` is the effective source; there's no evidence either way yet for `data912-eod`/`yahoo-underlying-eod`/`fmp-eod` in this environment (zero rows to sample) — worth re-checking against a production-like dataset before assuming full coverage everywhere.

## Open questions / limitations
- Not verified in an actual browser: no dev server was launched to visually confirm marker placement, tooltip rendering, or indicator pane behaviour.
- Marker vertical offset uses a fixed 14px screen-space gap rather than a value computed from KLineChart's own bar spacing; looks reasonable at the default height (440px) but wasn't tuned across a matrix of heights/zoom levels.
- `resetData()`'s exact internal behavior isn't fully documented upstream (WebFetch on `/api/instance/resetData` returned only a one-line description); assumed it re-invokes `getBars` with `type: "init"`, consistent with its name and the Store interface placement — worth confirming visually.

## Engram mirror: `odd/trade-markers-chart/tasks` — PENDING (tool unavailable in this session)

## Status: done
