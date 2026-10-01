# Navigation loading states

## Objective
Make screen-to-screen navigation feel immediate:
1. Instant route-level skeletons (`loading.tsx`) for every route under `src/app/(app)`.
2. Streaming with granular `<Suspense>` in `/dashboard` and `/rendimientos`, so fast sections render
   first and slow ones stream in when ready.

## Problem / why
- No `loading.tsx` and no `<Suspense>` anywhere under `(app)` (only `/login`). Without a boundary, a client
  navigation waits for the whole RSC payload, so a click looks frozen.
- Pages are monolithic: `dashboard/page.tsx` awaits `getDashboardPageDataAction()` in full;
  `rendimientos/page.tsx` awaits user → portfolios → `Promise.all([buildPerformanceReport,
  loadPortfolioEvolution])` (~1.4s measured in phase 2) before rendering anything.

## Findings (exploration, 2026-10-01)
- Next 16.2.6, `cacheComponents` NOT enabled (`next.config.ts` only has `reactCompiler`). Therefore
  `unstable_instant` / `'use cache'` do not apply here; plain `loading.tsx` is the mechanism: its fallback is
  prefetched, navigation is immediate and interruptible, shared layouts stay interactive
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`).
- `(app)/layout.tsx` is a static shell (Sidebar + Header + main) — the skeleton renders inside `<main>`.

## Scope
- In: `loading.tsx` files + shared skeleton primitives; Suspense split of `/dashboard` and `/rendimientos`.
- Out (layer 3, later, after measuring): caching the replay/valuation. Proposal saved, not implemented:
  `docs/proposal-cache-navegacion.md`.

## Constraints
- Numbers on every page must not change; only render ordering changes.
- Reuse `components/ui/skeleton`; both palettes (zinc utilities only, no new hex).
- UI copy Spanish, code English.
- Pure logic in `src/lib/**` with vitest (strict TDD); Prisma orchestrators/components untested (convention).

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). Skeletons and Suspense wiring are
components/orchestrators → no unit tests by convention; any extracted pure helper gets RED → GREEN.

## Tasks
- [x] T1 Shared skeleton primitives + `loading.tsx` for every `(app)` route, shaped like each page
- [x] T2 `/rendimientos`: stream report and evolution chart behind separate `<Suspense>` boundaries
- [x] T3 `/dashboard`: split the monolithic loader into Suspense-streamed sections (fast first)
- [~] T4 `pnpm test`, `tsc --noEmit`, eslint on touched files, `pnpm build`; browser check (user)

## Acceptance criteria
- Clicking any sidebar link shows that route's skeleton immediately.
- `/rendimientos` and `/dashboard` show their header/fast sections before the slow ones finish.
- Same figures as before on both pages.

## Progress
- Created after exploration (2026-10-01).
- T1 done: `src/components/layout/page-skeletons.tsx` (PageHeader, KpiCardRow, ChartBlock, Table) + `loading.tsx` in all 15 `(app)` routes.
- T2 done: `rendimientos/page.tsx` starts report + evolution promises un-awaited; report behind `<Suspense>` (fallback = real h1 + skeleton), evolution passed as a promise to `RendimientosPage`, consumed with `use()` under its own `<Suspense>` around the chart. `revalidate = 300` kept.
- T3 done: no dev DB env available, so no timing measured. `getDashboardPageDataAction` now returns `{ data, evolution: Promise }`; evolution (the slow replay) starts right after CCL series loads, runs concurrently, shares the CCL series. New `evolution-sections.tsx` (client, `use()` + Suspense per section: notices, period KPIs, chart, day movers). KPIs/composition/tables render without waiting.
- T4: test/tsc/eslint/next build observed passing (build run as `prisma generate` + `next build`, skipping `migrate deploy`); browser check pending (user).
- Independent verifier (risk assessed `high`, RDD off): no blocking issues — `build.ts` only passes `evolution`
  through; period KPIs/notices/day movers were already computed client-side with the same inputs; `safe*`
  helpers identical to HEAD; every `use()` sits inside its own boundary. Fixed its two indentation nits;
  `tsc --noEmit` + eslint re-run clean. Known: notices (`fallback={null}`) may shift layout when they exist.
- Engram mirror `odd/navigation-loading-states/tasks`: PENDING (Engram tools unavailable this session).

## Next step
Browser check by the user.
