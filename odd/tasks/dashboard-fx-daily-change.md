# Dashboard: MEP and CCL daily change

## Objective
Show on /dashboard today's MEP and CCL with their change versus the previous close (ARS and %), so a day where the
portfolio rises in ARS but barely in USD is explained by the dollar move.

## Problem / why
- User request (2026-10-26): "mi cartera subió 50 mil pesos pero solo subió 1 dólar" — wants MEP and CCL variation on
  the dashboard.
- Found while exploring: today's stored rate is stale. FxRate rows dated 2026-10-26: CCL 1651.6, MEP 1560.65 — the
  same values as 10-24/10-25 (Friday's close carried by argentinadatos). Live dolarapi at the same moment: CCL
  1681.1 mid (1679.7/1682.5), MEP 1574.6 mid (1571.7/1577.5). Cause: `syncCclHistory` (history-sync.ts) inserts and
  revises a row for today from argentinadatos; `resolveCclRate` returns any row dated today without calling dolarapi
  (catalog-sync's MEP read has the same "row dated today ⇒ fresh" shortcut). So the daily change would read 0% and
  the dashboard's USD values use Friday's rate.

## Decisions
- "Today" comes from dolarapi live (already fetch-cached 15 min); the stored row is a fallback, and today's row is
  upserted with the live value. Previous close = latest stored row of the same source dated before today (weekend
  rows carry Friday's close, so Saturday/Sunday read ~0%, which is correct).
- The same today's CCL must feed the dashboard and /rendimientos (no divergence between screens).
- UI in Spanish like the rest of the dashboard; tooltip explains that a CCL rise lifts the ARS value without
  lifting the USD value.

## Scope
- In: `src/lib/market/ccl-rate.ts` (and a MEP equivalent), a pure daily-change helper with tests,
  `src/lib/dashboard/*` (load-page, build/types), a dashboard KPI/card component.
- Out: rewriting history-sync, other pages' layouts, P0 security.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). Pure modules only.

## Tasks
- [x] T1 Pure daily-change helper (current mid + previous-close row → change ARS / %, null-safe), tested
- [x] T2 Current CCL/MEP from dolarapi live with stored fallback; today's row upserted; previous close loaded;
      dashboard and /rendimientos use the same today's CCL; dashboard cache does not freeze the rate
- [x] T3 Dashboard UI: MEP and CCL with value, change ARS and %, colored, tooltip; verified with real data

## Checks
- `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`; read-only scratch script printing current/previous/change for
  both sources through the loader path.

## Progress
- 2026-10-26: stale today-rate found and measured; document created.

- 2026-10-26 T1: `computeFxDailyChange` (src/lib/market/fx-daily-change.ts); RED (module missing) -> GREEN 5/5.
- 2026-10-26 T2: `ccl-rate.ts` now resolves CCL/MEP live from dolarapi, upserts today's row only when the value
  differs, falls back to latest stored row; previous close = latest row dated < today (UTC). `overlayLiveCcl` now
  lets the live mid REPLACE today's stored point (RED on the old "stored wins" test -> GREEN), so /rendimientos,
  dashboard evolution and the KPI use the same live value. Dashboard has no cache (<= 15 min dolarapi fetch cache);
  /rendimientos cache is 5 min on top. Scratch via real loader: CCL 1681.1 (prev 1651.6 @10-25, +29.5, +1.79%),
  MEP 1574.6 (prev 1560.65 @10-25, +13.95, +0.89%); /rendimientos CCL today 1681.1.
- 2026-10-26 T3: `fx-rates.ts` view mapper (tested) + "Dólar MEP y CCL" card (full-width, two blocks) in
  dashboard-kpis.tsx; SSR render with real data: MEP $1.574,60 vs 25/10 +$13,95 +0,89%; CCL $1.681,10 +$29,50 +1,79%.
  Checks: pnpm test 795/795, tsc clean, lint 0 errors / 11 warnings.

## Next step
Parent review; commit pending (nothing committed).
