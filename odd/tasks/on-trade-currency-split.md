# Fixed-income trades split across currency instruments

## Objective
A sold ON disappears from /dashboard ("Movimientos del día") and /rendimientos positions, as it
already does in /bonos.

## Problem
Balanz exports the same ON ticker (e.g. `MCC3O`) for trades paid in USD and in ARS. The importer
lets every BUY/SELL define the instrument currency (`instrumentCurrencyForRow`), so a USD buy and
an ARS sell of the same ON land on two instruments (`MCC3O`/USD and `MCC3O`/ARS). /bonos groups by
ticker (net 0), but the equity replay used by /dashboard and /rendimientos groups by instrumentId:
the USD row keeps 149 nominals that were already sold.

Observed (2026-11-16): MCC3O (149 USD buy 2026-05-07 / 149 ARS sell 2026-11-12) and EAC4O
(152 / 152) are the only split scopes in the DB.

## Why this approach
An ON's identity is its ticker; the currency a trade was paid in is already stored on the
Transaction (`currencyCode`) and every loader converts by the transaction's currency, not the
instrument's. So for fixed income (ON, BOND_AR, LETRA) the known denomination of the scope (existing
catalog row, else the first trade in the batch) wins over the trade's own currency. Equities keep
the current rule (trade states its currency). User approved importer fix + one-off data merge.

## Scope
- Pure rule in `src/lib/importers/instrument-currency.ts` + wiring in `commit-import.ts`.
- One-off script moving the 2 ARS sells to the USD instruments and deleting the emptied ARS rows.

Out of scope: grouping the equity replay by ticker, other brokers' formats.

## Constraints
- Strict TDD (vitest, `pnpm test`) for the pure rule; commit-import orchestration untested per repo convention.
- Data script is read-only by default (dry run); writes only with an explicit flag, inside a transaction.
- ~400 changed lines per task is an advisory heuristic only.

## Tasks
- [x] T1 Pure rule: fixed-income trades resolve to the scope denomination; catalog denomination wins over the batch for fixed income (RED → GREEN).
- [x] T2 Wire the rule into `resolveInstrumentsBatch` / `instrumentIdFor`.
- [x] T3 One-off merge script (dry run, then apply): move MCC3O/EAC4O ARS sells to the USD instruments, delete the emptied ARS instruments; verify /dashboard and /rendimientos no longer list them.

## Acceptance
- Re-importing a USD buy and an ARS sell of the same ON yields one instrument with net 0.
- After the merge, MCC3O and EAC4O no longer appear in /dashboard movers or /rendimientos positions.

## Checks
`pnpm test`, `pnpm tsc --noEmit`, `pnpm eslint <changed files>`.

## TDD
Mode: strict (source: user global config). Runner: `pnpm test` (vitest run).

## Progress
- 2026-11-16: Diagnosed (DB query), user approved importer fix + data merge. Doc created.
- 2026-11-16: T1 done. RED 8 failing (`mergeCatalogDenominations` missing, ON sell kept its own currency) -> GREEN 17/17 in instrument-currency.test.ts. `instrumentCurrencyForRow` takes optional `instrumentType`; fixed-income trades use the scope denomination. `mergeCatalogDenominations` replaces the inline catalog loop (fixed income: catalog wins over batch; equities unchanged).
- 2026-11-16: T2 done. `resolveInstrumentsBatch` uses `mergeCatalogDenominations`; `instrumentIdFor` already passes the parsed row (has `instrumentType`). tsc + eslint clean.
- 2026-11-16: T3 done. One-off script (scratchpad, not committed): dry run showed 1 transaction + 9 cached prices per ARS instrument; applied in one DB transaction: moved MCC3O/EAC4O sells to the USD instruments, deleted the ARS instruments (prices cascade). Idempotency hash uses ticker + row currency, not instrumentId, so re-imports still dedupe. `buildPerformanceReport` now returns 23 positions with no MCC3O/EAC4O. Full `pnpm test` 1121 pass. Not checked in the browser; report cache expires within 5 min.
- Next step: user checks /dashboard and /rendimientos; commit when asked.
