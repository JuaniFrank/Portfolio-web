# CCL history: argentinadatos one-day lag

## Objective
Store each day's real CCL close. Since September 2026 argentinadatos dates every CCL row one day late (the row
dated D holds the previous business day's close), so every USD figure since then (daily evolution, purchase cost
at the CCL of the trade day) uses the wrong day's rate.

## Problem / why
- User report (2026-10-26/27): the dashboard showed the last session at −1.74% in USD while the broker (Cable view)
  showed −1.08%. The broker's implied Friday CCL was ≈1653, which matches argentinadatos' row dated Saturday
  10-24 (1651.6 mid), not the row dated Friday 10-23 (1638.7).
- Evidence (read-only check, 2026-10-27): 2013-01 → 2026-09-05, every Saturday row equals the preceding Friday
  (correctly dated). From the weekend of 2026-09-12 on, 7 of 7 Saturdays differ from Friday and equal Sunday and
  Monday. The Oct 12 holiday also shows the shift: Mon 10-12 and Tue 10-13 both carry Friday's close and Wed moves.
  The exact first lagged row lies between 09-07 and 09-11. The MEP series (`/bolsa`) has the same lag, but MEP
  history is not stored from argentinadatos (only live dolarapi), so only CCL is affected in the DB.

## Decisions
- Detect the lag per week instead of hardcoding a date, so the fix undoes itself if argentinadatos fixes the
  source: a week (rows Monday..Sunday around Saturday S) is lagged when row S differs from row S−1 (in a correctly
  dated series Saturday repeats Friday). Rows of a lagged week move back one day. The trailing partial week (no
  Saturday yet) inherits the last detected regime. On a collision at a regime boundary the correctly dated row
  wins; a resulting gap is covered by the existing as-of lookup.
- Applied in the argentinadatos parser so every consumer (`syncCclHistory`, backfill) receives corrected dates.
- One-off resync: upsert the corrected values for stored CCL rows dated from 2026-08-31 up to yesterday, and
  delete rows that should no longer exist; today's row stays owned by the live resolver.

## Scope
- In: `src/lib/market/argentinadatos.ts` (pure correction + parser wiring, tests), a one-off resync of FxRate
  `source=CCL` rows from 2026-08-31.
- Out: price-source differences between the dashboard (Yahoo quote, ≤10 min cache) and /rendimientos (data912
  live, 60 s), cash/liquidity tracking, MEP history.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest).

## Tasks
- [x] T1 Pure lag correction (per-week detection, shift, boundary collisions, trailing week, no-op on a correctly
      dated series), tested; wired into `fetchCclHistory`
- [x] T2 Resync stored CCL rows from 2026-08-31 to yesterday with corrected values; verify Friday 10-23 = 1651.6 mid
      and NVDA's USD cost recomputed

## Checks
- `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`; before/after dump of FxRate CCL rows 2026-09-01..today.

## Progress
- 2026-10-27: lag measured (switch after the 2026-09-05 weekend, MEP same); document created.

- 2026-10-27 T1: `correctLaggedDates` in argentinadatos.ts, wired into `fetchCclHistory`; 6 tests in argentinadatos.test.ts
  (RED 6/6 failing before implementing, GREEN after). `pnpm test` 801 passed, tsc clean, lint 0 errors / 11 warnings.
- 2026-10-27 T2: resync 2026-08-31..2026-10-26: 57 upserted, 0 deleted, 34 rows changed; today's row untouched.
  Fri 10-23 1638.7 -> 1651.6; Mon 10-26 1651.6 -> 1681.1; Thu 10-22 1636.55 -> 1638.7. NVDA USD cost 229.53 -> 228.15
  (CCL as-of 10-07 1610.05 -> 1608.35; 10-19 1619.45 -> 1624.60; 10-26 1651.6 -> 1681.1; 05-07 1483.75 unchanged).

## Next step
Parent: review, sync Engram mirror, commit.
