# Realized sales re-entry signal and price alerts

## Objective
1. In "Ventas realizadas" (/rendimientos), show for each sale the original stock's average purchase price, its price
   on the sale day and its current price, plus a label when it is now cheaper than when it was sold (re-entry signal).
2. Price targets: the user sets a target per instrument; it shows as a label in-app when reached (passive alerts).
3. Active alerts: a scheduled evaluation that sends a notification (Telegram) when a target triggers.
4. A long-running worker entry point that runs the same evaluation in a loop (for intraday cadence outside Vercel).

## Problem / why
- User request (2026-10-27): wants to spot re-entry opportunities in stocks already held but sold, and grow that into
  price tracking/alerts. Then: "Hacé todas las fases, para cedears y acciones locales."
- The existing "Costo prom." column is the CEDEAR's ARS PPC; original-stock prices exist only for open CEDEAR
  positions (`underlyingAverageCost` returns null for closed lots).
- Comparing today's price against the CEDEAR's ARS sale price mixes units (CCL, ratio changes, splits).

## Decisions
- "Original stock" and comparison basis:
  - CEDEAR → the underlying on its home exchange, in USD (Yahoo split-adjusted closes + quote; existing
    `underlying-price.ts` / `underlying-loader.ts`).
  - Local stock (BYMA) → the instrument itself, in ARS, split-adjusted to today's units (data912 is NOT
    split-adjusted: always go through the corporate-events adjustment, see `adjustBarsForEvents`).
  - Other types (bonds, FCIs…) → "—", no targets.
- Re-entry label is per sale row: current original price < original price on the sale day; shows % below.
- Average purchase price per sale = average cost of the position at the moment of the sale (same replay semantics as
  `buildRealizedSales`), in the basis above.
- Alerts domain is pure (`evaluate(target, price)`); price source and notifier are ports; adapters: Vercel cron route,
  Telegram notifier, worker script. Splitting into a separate project is deferred: the worker imports the same domain.
- Vercel cron schedule is daily-safe (works on Hobby plan, where sub-daily crons fail the deploy); intraday cadence is
  the worker's job. Switch the schedule if the project is on Pro.
- Notifications: Telegram bot via env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`); missing env → no-op, not an error.
- A triggered target is notified once (`triggeredAt` set); the user can re-arm it.

## Scope
- In: `src/lib/rendimientos/realized-sales*`, underlying/local price loading in `series.ts` and loaders,
  `src/components/rendimientos/realized-sales.tsx`, new Prisma model + migration, new `src/lib/alerts/*`, server
  actions + UI to manage targets, `/api/cron/price-alerts`, `vercel.json`, `.env.example`, a worker script.
- Out: web push / email channels, streaming prices, multi-user notification routing, separate repository.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). Pure modules only (Prisma orchestrators untested by
project convention).

## Tasks
- [x] T1 Pure per-sale original-stock figures (avg purchase, sale-day, current, % vs sale, re-entry flag) for CEDEARs
      (USD underlying) and local stocks (ARS, split-adjusted), tested
- [x] T2 Loader wiring: sold CEDEARs join the Yahoo candidates; local-stock price history/current price, failure-
      tolerant
- [x] T3 UI: three original-stock columns + re-entry label in "Ventas realizadas"
- [x] T4 `PriceTarget` model + migration; pure alerts domain (`evaluate`, direction above/below, re-arm), tested
- [x] T5 Server actions + UI to create/edit/delete/re-arm targets (from a realized-sale row and per instrument);
      "target reached" label in-app
- [x] T6 Ports + Telegram notifier + `evaluatePriceAlerts` use case (fakes in tests), tested
- [ ] T7 Cron route `/api/cron/price-alerts` (cron secret) + `vercel.json` + `.env.example` (route and vercel.json done;
      `.env.example` append was blocked by the permission system: pending)
- [x] T8 Worker entry point (loop with interval, market-hours aware) reusing the use case

## Checks
- `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`; real-data spot check of one CEDEAR and one local-stock sale.

## Progress
- 2026-10-27: explored realized sales, underlying loader, crons; document created.
- 2026-10-27: T1-T3 done.
  - T1: `src/lib/rendimientos/realized-original.ts` (`withRealizedOriginals`) + `realized-original.test.ts` (11 tests).
    RED: `vitest run realized-original.test.ts` failed at import (module did not exist, "no tests"); GREEN: 11/11
    after implementing. `RealizedSale` gained `original: RealizedOriginal | null` (null from `buildRealizedSales`).
  - T2: `underlying-loader.ts` split into `loadUnderlyingMarket` (Yahoo bars + quote per symbol, deduped) and
    `loadUnderlyingPrices` (accepts the preloaded market); `series.ts` adds sold CEDEARs to the candidates and builds
    local-stock sources from `overlaidPriceRows` (EOD already adjusted at write time + live overlay as current price).
  - T3: `realized-sales.tsx`: columns "PPC orig.", "Venta orig.", "Actual orig." (after "Tenencia"), always in basis
    currency, header hints, sky pill "-X% vs tu venta" when `belowSale`, `min-w` 1180px, footnote.
  - Checks: `pnpm test` 70 files / 812 tests pass; `tsc --noEmit` clean; `pnpm lint` 0 errors (11 pre-existing warnings).
  - Real data (read-only, `buildPerformanceReport`): 5 sales, all CEDEAR/USD, none with null avg. Ex.: KO 2026-10-23
    avg 79.23, sale-day 92.71, current 91.51 (-1.29%, belowSale); AAPL 2026-10-07 avg 305.69, sale 336.67, current
    346.92 (+3.04%). No local-stock sale exists in the DB: that path is covered only by unit tests.
  - Decisions/caveats: local-stock bars must already be post-event (PriceCache EOD is adjusted when stored), so the
    pure function does not re-adjust bars; sale/avg use closes, not executed prices; local exchange label is "BYMA".
- 2026-10-27: T4-T8 implemented (T7 minus `.env.example`).
  - Domain `src/lib/alerts/`: `evaluate.ts` (evaluate, isArmed, targetStatus, distance, basisForInstrumentType),
    `message.ts`, `market-hours.ts` (Intl time zones), `validation.ts` (zod, pure), `rows.ts`, `worker-config.ts`,
    `ports.ts` (PriceSource, Notifier, PriceTargetRepo), `evaluate-price-alerts.ts` (use case). Adapters in
    `src/lib/alerts/adapters/`: `telegram.ts`, `prisma-targets.ts`, `market-price-source.ts`, `run.ts`.
  - RED: each test file was run before its module existed and failed at import ("Cannot find module", "no tests"):
    evaluate/message/market-hours/validation (4 files failed), evaluate-price-alerts, telegram, worker-config, rows.
    One further RED on behavior: `evaluated` counted only armed targets with price; test expected it to include
    missing-price ones, implementation aligned. GREEN: 7 new alert test files (+ telegram adapter with injected fetch).
  - Prisma: `PriceTarget` + enum `PriceTargetDirection`, relations on User and Instrument. Migration
    `prisma/migrations/20261027160000_price_targets/migration.sql` generated OFFLINE with `migrate diff
    --from-schema-datamodel <copy of previous schema> --to-schema-datamodel`. NOT applied to any database.
  - Actions `src/app/actions/price-targets.ts` (create/update/delete/re-arm; ownership by userId; currency derived from
    instrument type server-side). UI: `/alertas` page, `TargetForm`, `CreateTargetDialog` (bell button per row in
    "Ventas realizadas", prefilled sale-day price, BELOW), "Objetivo alcanzado" pill via `hasReachedTarget`, sidebar
    link. The rendimientos route loads targets defensively (empty on failure, e.g. migration not applied yet).
  - Cron `src/app/api/cron/price-alerts/route.ts` + `vercel.json` `30 21 * * 1-5`. Worker
    `scripts/price-alerts-worker.ts` + `pnpm alerts:worker`; import graph checked by loading `adapters/run` under tsx
    (no connection made). Worker was NOT run.
  - Checks: `pnpm test` 78 files / 867 tests pass; `tsc --noEmit` clean; `pnpm lint` 0 errors (11 pre-existing
    warnings); `prisma validate` valid.
  - Caveats: migration not applied; Telegram never called live; UI compiled but not exercised in a browser; editing a
    target re-arms it (decision); targets limited to instruments the user has transacted (no catalog search); market
    hours ignore holidays; `.env.example` NOT updated (write denied).

- 2026-10-27: Independent verification: PASS with should-fix; fixed 1-5.
  - 1: `evaluate` treats price <= 0 as no price; price source also filters `> 0` in Yahoo and data912 branches.
  - 2: Telegram `fetch` gets `signal: AbortSignal.timeout(10_000)`; TimeoutError maps to `failed`; an error whose
    message contains the token does not leak it (adapter only reports `error.name`).
  - 3: `InstrumentOption.currency` set in `/alertas` page via shared `basisForInstrumentType`; `TargetForm` shows the
    currency of the selected instrument in the price label.
  - 4: `TARGET_PRICE_MAX = 1e11` (fits `Decimal(20,8)`) in `validation.ts`; create/update actions wrap Prisma in
    try/catch and return `{ ok: false, error }`.
  - 5: `markTriggered` (where `triggeredAt: null`) and `markNotified` (where `notifiedAt: null`, `triggeredAt` not null)
    are conditional `updateMany` and return `boolean`; the use case skips notifying when the trigger was not applied
    and does not count `notified` when the mark was not applied.
  - RED (before code): 5 tests failed (evaluate non-positive, Decimal bound, Telegram signal, 2 use-case "not applied"
    tests); GREEN after: `pnpm test` 78 files / 874 tests pass.
  - Checks: `pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors (11 pre-existing warnings).
  - Untested by convention: Prisma adapter and UI.

- 2026-10-27: user chose to place the original-stock columns next to "Costo prom." in both tables. "Ventas
  realizadas": "PPC orig." / "Venta orig." / "Actual orig." now follow "Costo prom.". "Posiciones": the default order
  is now Costo prom. ARS/USD → Costo prom. acción orig. → Precio acción orig. → Precio (saved layouts keep their
  stored order until "Restablecer"). Checks: `pnpm test` 874 pass, `tsc --noEmit` clean, eslint on both files clean.

## Next step
Append the three env vars to `.env.example` (blocked for the writer), apply the migration, then manual checks: create a
target from a realized-sale row, open `/alertas`, run `/api/cron/price-alerts` locally, then T7 can be checked.
