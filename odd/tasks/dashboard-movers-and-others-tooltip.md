# Dashboard: full mover lists and "Otros" breakdown

## Objective
- "Mejores/Peores rendimientos" (Salud del Portfolio) show the top 5 by default with a "Ver todos" toggle.
- The "Otros" slice of "Resumen de Portfolio" lists the tickers it groups on hover.

## Scope
- `src/lib/dashboard/build.ts` (stop truncating movers to 5)
- `src/components/dashboard/top-movers.tsx` (show all toggle)
- `src/lib/dashboard/allocation-grouping.ts` (new, pure) + test
- `src/components/dashboard/allocation-donut.tsx` (use grouping, tooltip for "Otros")

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). Only the pure grouping module is testable.

## Tasks
- [x] T1 Extract "Otros" grouping into a pure function that attaches grouped tickers as `details` (RED → GREEN)
- [x] T2 Donut uses it; "Otros" tooltip lists its tickers in the selected currency
- [x] T3 Movers: full ranked lists from build, UI shows 5 + "Ver todos"/"Ver menos"
- [x] T5 Replace recharts tooltip with an own hoverable one: scrollable detail list (no "+N más"), stays open while hovered (user feedback)
- [x] T4 `pnpm test`, `pnpm lint`, `tsc --noEmit`

## Progress
- T1: RED (module missing) → first test run failed because my own expectation contradicted existing semantics (topN named slices + Otros); test corrected, GREEN 3/3.
- T4: `pnpm test` 461/461, `tsc --noEmit` clean, eslint clean on touched files.
- T5: recharts 3 hides its tooltip when the pointer leaves the sector, so it cannot be hovered; replaced by state-driven tooltip with 250 ms hide grace, frozen once the pointer leaves the slice. tsc/eslint clean, tests 461/461.
- Pending: visual check in the browser.
