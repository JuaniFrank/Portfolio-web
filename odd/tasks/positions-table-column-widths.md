# Rendimientos positions table: column widths

## Objective
Resizing one column of the "Posiciones" table on /rendimientos must change only that column, and default widths
must fit their content (no clipped headers, no oversized columns).

## Problem / why
- User report (2026-10-21): "si movés una se mueven todas"; some columns are wider than they should be, others
  narrower.
- Reproduced in Chromium (Playwright, dev harness): dragging column 2 by +80px updates `table.getTotalSize()`
  (table width 1390 → 1470) but the `<th>`/`<td>` widths keep the old value (`header.getSize()` /
  `cell.column.getSize()` stay at 140px). With `table-layout: fixed`, the browser spreads the 80px surplus across
  every column (220→233, 150→159, …).
- Measured natural widths with sample data: Ticker 206 (driven by the truncated name), Costo prom. 147/148,
  Precio 101, Result. 121/120, Var. diaria 110, Peso 83, Antigüedad 118, Valor de mercado 151. Current defaults
  clip "Costo prom. ARS/USD" and "Antigüedad" headers and oversize Ticker, Precio and Result.

## Decisions
- Widths are derived by a pure helper from the persisted sizing + column config (not TanStack's memoized
  instance getters) and rendered through a `<colgroup>`; the table width is the sum of the same values.
- Retuned static defaults from the measurements; double-click on a resize handle auto-fits that column to its
  content; header labels get a `title` so a narrowed header is still readable.

## Scope
- In: `src/components/rendimientos/positions-table.tsx`, `src/lib/rendimientos/positions-table-layout.ts` (+ test).
- Out: other tables; sort/reorder/visibility behavior.

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest).

## Tasks
- [x] T1 Pure `resolveColumnWidths` (order + visibility + sizing + min/max clamp → per-column widths and total), tested
- [x] T2 Table renders widths via `<colgroup>` from the helper; resizing one column changes only that column (verified in browser)
- [x] T3 Retuned defaults/min sizes; double-click handle auto-fits; header `title`

## Checks
- `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`; Playwright probe on the dev harness (harness deleted afterwards).

## Progress
- 2026-10-21: root cause reproduced and measured; document created.
- 2026-10-21 T1 done: `resolveColumnWidths` + `fitColumnWidth` in `positions-table-layout.ts`; RED 9 failed → GREEN 28/28.
- 2026-10-21 T2 done: `<colgroup>` + table width from the same helper; `<th>` width from it too; `<td>` widths removed.
  Probe: +80px drag on "Costo prom. ARS" → 150→230 only, others unchanged, table 1345→1425.
- 2026-10-21 T3 done: defaults Ticker 180 (max 360), Costo 150/150, Precio 115, Result. 130/130, Var. 115, Peso 85,
  Antigüedad 125, Valor 165 — no clipped headers with sample data. Double-click on a handle auto-fits (measures an
  invisible `max-content` copy of every cell of the column; probe: 230→147). Header `title` for narrowed columns.
  Also fixed a pre-existing hydration mismatch (dnd-kit `aria-describedby` ids) with a fixed `DndContext id`;
  console clean after.
- Checks: `pnpm test` 757 passed; `pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors / 11 warnings (unchanged).
  Harness page deleted; stale `.next/dev/types` removed.
- Note: widths already saved in localStorage by the old code are kept; "Restablecer" returns to the new defaults.

## Next step
Done, uncommitted. User checks /rendimientos; commit on request.
