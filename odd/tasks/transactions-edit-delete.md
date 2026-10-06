# Transactions edit / delete

## Objective
Make edit and delete work on `/transactions`: edit and delete a single transaction (Historial tab) and delete a
whole holding (Resumen tab), leaving no orphan or stale data.

## Problem / why
- User report (2026-10-06): edit/delete on `/transactions` don't work.
- Exploration: they were never implemented. `trade-history-table.tsx:141-160` renders disabled placeholder
  buttons ("Editar/Eliminar (próximamente)") with no handler; `src/app/actions/transactions.ts` only has
  list/search/create. `HoldingsTable` has no row actions.

## Findings (exploration, 2026-10-06)
- Holdings are derived from transactions (`buildHoldings`, `src/lib/transactions/holdings.ts`); no Holding model.
  Deleting a holding = deleting its transactions.
- `Transaction` children: only `TransactionTag` (`onDelete: Cascade`). Parents (portfolio, brokerAccount,
  instrument, currency, counterpartyAccount, importBatch) don't block deletion.
- Orphan/stale risk: `ImportBatch.rowsImported` goes stale; a batch with no rows left must become `REVERTED`.
  `deleteImportedTransactionsAction` (`src/app/actions/imports.ts`) already does this but only for
  `source: IMPORT`.
- `Instrument` is global/shared → never delete it (nor its prices, events, bond terms).
- `PortfolioSnapshot` history is a historical record written by cron (not source of truth) → left as is.
- No `unstable_cache`/`"use cache"` in `src` → `revalidatePath` on every consumer is enough.

## Decisions
- Deleting a holding deletes ALL of the user's transactions for that instrument in that holding's scope
  (BUY/SELL and also dividends, coupons, amortizations, withholdings linked to the instrument), so nothing is
  left hanging. The confirm dialog shows counts per type. (Chosen by the assistant on "no orphans"; user may
  override.)
- Edit keeps `idempotencyHash` as is: a re-import of the original row still pairs with the edited transaction
  and is flagged as a duplicate (correct: the user already has it).

## Scope
- In: shared delete-with-cleanup helper (ownership, `$transaction`, batch recount/status, revalidation),
  `deleteTransactionAction`, `deleteHoldingAction`, `updateTransactionAction`, refactor
  `deleteImportedTransactionsAction` onto the helper, Historial edit/delete UI, Resumen delete-holding UI.
- Out: deleting instruments or market data; rewriting historical `PortfolioSnapshot` rows.

## Constraints
- Ownership enforced server-side on every mutation (user's portfolios only).
- UI copy Spanish, code English. Both palettes (zinc utilities only).
- Pure logic in `src/lib/**` with vitest (strict TDD); Prisma orchestrators/components untested (convention).

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). Extracted pure helpers: RED → GREEN → REFACTOR.

## Tasks
- [x] T1 Pure helpers with tests (batch status/count after delete; update payload validation/normalization shared with create)
- [x] T2 Server actions: shared delete helper + `deleteTransactionAction`, `deleteHoldingAction`, `updateTransactionAction`; refactor `deleteImportedTransactionsAction`; revalidate all consumers
- [x] T3 Historial: wire edit (form modal in edit mode) and delete (confirm dialog)
- [x] T4 Resumen: delete-holding action with confirm dialog showing counts per type
- [x] T5 `pnpm test`, `tsc --noEmit`, eslint on touched files
- [ ] T6 Browser check (user)

## Acceptance criteria
- Editing a transaction persists and the page reflects it (holdings recomputed).
- Deleting a transaction removes it and its tags; its import batch count/status is updated.
- Deleting a holding removes all its transactions; the holding disappears; batches updated; no Instrument deleted.
- A user can never edit/delete another user's transactions.

## Progress
- Created after exploration (2026-10-06).
- T1 (2026-10-06): RED observed (2 test files failed, modules missing), GREEN 51 files / 615 tests.
  `src/lib/transactions/trade-amounts.ts` (gross/net, shared by create and edit, keeps imported `marketRights`),
  `src/lib/transactions/delete-helpers.ts` (`batchStateAfterDelete`, `countByType`) + colocated tests.
  Field validation was already a shared zod schema (`validations.ts`), reused for update as is.
- T2: `src/lib/transactions/mutations.ts` (`deleteOwnedTransactions`: ownership + `$transaction` + batch
  recount/status; `revalidateTransactionConsumers`: /imports /transactions /dashboard /rendimientos /dividends
  /bonds /events /monitoreo). `src/app/actions/transactions.ts`: `getTransactionForEditAction`,
  `updateTransactionAction`, `deleteTransactionAction`, `getHoldingDeletionPreviewAction`,
  `deleteHoldingAction`; create refactored onto the helpers. `deleteImportedTransactionsAction` now uses the
  helper (still IMPORT-only). Holding key = `instrumentId`, scope = all the user's portfolios/accounts (that is
  how `buildHoldings` aggregates), all transaction types with that instrumentId.
- Edit: BUY/SELL only; provenance (source, importBatchId, idempotency*) untouched; instrument kept when
  ticker+type unchanged, else resolved/created like create. Tags not editable (form has none).
- T3: `transaction-form-modal.tsx` now exports `TransactionFormDialog` (create/edit); `trade-history-table.tsx`
  wired; generic `confirm-delete-dialog.tsx`.
- T4: `delete-holding-dialog.tsx` + "Acciones" column in `holdings-table.tsx`.
- T5: `pnpm test` 51 files / 615 tests pass; `tsc --noEmit` clean; eslint 0 errors (2 pre-existing warnings:
  unused `cn` in trade-history-table, RHF `watch` compiler note).
- Independent verifier (risk high, RDD off): ownership enforced at write time, delete scope matches
  `buildHoldings`, batch recount inside the same `$transaction`, create behaviour unchanged. D1 fixed: edit kept
  the old instrument when only the currency changed (currency is part of the instrument identity) → now
  re-resolves unless ticker, type AND currency match. `tsc` clean, eslint clean, 615/615.
- OPEN: withholdings stored with `instrumentId` NULL (Balanz "Ret IIGG y BBPP - GGAL", ticker only in notes)
  are not removed by delete-holding → leftover negative flows. Awaiting user decision.
- Minor (not fixed): edit coerces non-USD currencies to ARS; form net preview ignores imported `marketRights`.
- Next: user browser check (edit, delete, delete holding; imported row batch count in /imports).
