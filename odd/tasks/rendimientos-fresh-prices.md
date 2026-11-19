# Fresh prices in /rendimientos + "vs tu venta" pill for higher prices

## Objective
/rendimientos must show today's price for the original stock ("Actual orig."), and the
"vs tu venta" pill must also appear when the stock now trades above the sale (missed return).

## Problem
PM showed US$ 211.28 (previous close) while Yahoo already returned 201.50. Two nested
stale-while-revalidate caches: the per-user report (`unstable_cache`, 300 s) and the Yahoo
quote fetch (`next.revalidate`, 300 s). After an idle period the first visit gets the previous
visit's report, the second recomputes it with the still-cached quote, and only the third is fresh.

## Scope
- Report cache: hard TTL (time-bucketed key) so an entry older than the bucket is never served.
- Underlying quotes for the report: fetched with `no-store` (the bucketed report bounds them to
  one fetch per bucket per user).
- Realized sales: show the pill for price above the sale too, with a distinct tone and hint.

Out of scope: other SWR consumers (dashboard live overlay, alerts, dividends forecast).

## Constraints
- TDD strict (vitest, `pnpm test`); pure helpers tested, Next/Prisma orchestrators are not.
- Next 16.2.6: `unstable_cache` serves stale while revalidating (docs: ISR guide).

## Tasks
- [x] T1 Time-bucketed report cache key (`reportCacheBucket` in `src/lib/cache/report-tags.ts`, used by `report-cache.ts`).
- [x] T2 `fetchYahooQuote(symbol, { fresh: true })` → `no-store`; used by `loadUnderlyingMarket`.
- [x] T3 Pill for above-sale prices in `realized-sales.tsx` (tone + title + column hint).

## Acceptance
- A report computed in a previous 5-minute bucket is never rendered.
- "Actual orig." equals Yahoo's `regularMarketPrice` at most ~5 minutes old.
- A sale whose original now trades higher shows "+x% vs tu venta" in a distinct tone.

## Checks
`pnpm test`, `pnpm tsc --noEmit`, `pnpm eslint <changed files>`.

## Progress
- 2026-11-05: Cause verified (Yahoo `range=1d` returns 201.5 for PM; the app showed 211.28). T1–T3 done (RED observed for T1 bucket tests and T2 fresh-quote test, then GREEN). pnpm test 1015/1015, tsc clean, eslint clean on changed files. Not verified in the deployed app (needs login).

## Next step
Commit and push when the user asks.
