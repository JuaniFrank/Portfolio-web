# Import duplicate detector

## Objective
When the user imports a file, compare its rows against the transactions already registered and flag the
ones that are duplicates directly in the review (preview) table: pre-excluded with a "possible duplicate"
marker, reversible row by row.

## Problem / why
- Detection exists (`checkImportDuplicatesAction`, `src/app/actions/imports.ts`) but relies only on
  `idempotencyHash`, which includes `rowNumber` (`src/lib/importers/idempotency.ts`). A movement is only
  detected when it sits on the same row of the file → overlapping exports with a different date range
  detect nothing.
- `rowNumber` cannot be dropped from the hash: the DB holds 41 intentional ×2 groups (identical buys on the
  same day) that rely on it to stay distinct under the `[idempotencyHash, idempotencyVersion]` unique.
- Current UX is all-or-nothing (`DuplicateResolutionSection`: skip / import all), shown only after clicking
  confirm.

## Decision (user, 2026-10-06)
Suggestion lives in the review table (pre-excluded, reversible per row), not in the all-or-nothing dialog.

## Design
- Content matching next to the hash, without changing the hash or the schema.
- Content key: brokerAccount + tradeDate (day) + type + ticker + currency + quantity + netAmount
  (+ externalId when present). Decimals compared normalized.
- Multiplicity-aware: file ×2 vs DB ×1 → only 1 row flagged (respects intentional duplicates).
- Pairing order: exact `idempotencyHash` matches first, then content-key matches over the remaining
  existing transactions. Each existing transaction is consumed by at most one incoming row.
- Matches any registered transaction (imported or manual), not only imported ones.
- Detection runs proactively right after parsing (account already chosen in the upload step).
- Because every hash collision is also flagged, any row still included at commit was chosen by the user →
  commit uses `duplicateStrategy: "import"` (re-included flagged rows are inserted with a bumped version).
- The same-file (`fileHash`) signal stays as an informational banner.

## Scope
- In: pure matcher in `src/lib/importers/duplicates.ts` (+ tests), `checkImportDuplicatesAction`,
  `ImportWizard` + `UnifiedReviewStep` (and the table it renders).
- Out: `ImportModal` / `ImportEditTable` / `ImportDuplicatesDialog` (not mounted anywhere); hash/schema
  changes; deleting existing duplicates in the DB.

## Constraints
- Never touch the intentional duplicate groups in the DB.
- UI copy Spanish, code/comments English.
- Pure logic in `src/lib/**` with vitest (strict TDD); Prisma orchestrators/components untested (convention).

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). Matcher: RED → GREEN → REFACTOR.

## Tasks
- [x] T1 Pure matcher `matchImportDuplicates` in `duplicates.ts` with tests (hash-first, content key, multiplicity, decimal/date normalization, externalId)
- [x] T2 `checkImportDuplicatesAction`: load candidate transactions for the account/date range and use the matcher
- [x] T3 Wizard: run detection after parse, pre-exclude flagged rows, "Posible duplicado" marker in the review table, reversible; commit with `import`; replace the strategy section with a same-file/count banner
- [x] T4 `pnpm test`, `tsc --noEmit`, eslint on touched files
- [ ] T5 Browser check (user)

## Acceptance criteria
- Importing an export that overlaps an earlier one (different row positions) flags the overlapping rows.
- File ×2 identical rows vs DB ×1 → exactly one flagged.
- Flagged rows start excluded; re-including one and committing inserts it.
- Non-flagged rows import as before.

## Progress
- Created after exploration (2026-10-06).
- T1 (2026-10-06): `matchImportDuplicates` + types in `src/lib/importers/duplicates.ts`, tests in `duplicates.test.ts`. RED: 11/11 failed (function missing); GREEN: 11/11 pass. `DuplicateRow` gained `matchedBy: "hash" | "content"`.
- T2: `checkImportDuplicatesAction` loads account transactions in [minDate-1d, maxDate+1d] plus hash-only hits outside the window, maps them (ticker via `instrument.ticker`; quantity/netAmount/tradeDate stored as parsed, no sign flip) and calls the matcher. `sameFileBatches` kept.
- T3: `import-wizard.tsx` runs detection in `handleFile` (non-blocking on failure), flagged rows start excluded, banner replaces `DuplicateResolutionSection` (deleted, no other importer), commit with `duplicateStrategy: "import"`. `unified-review-step.tsx` shows a "Posible duplicado" badge (title: when/which file) via `duplicateByRow`; prop `checkingDuplicates` renamed `committing`.
- T4: `pnpm test` 597/597 pass; `tsc --noEmit` clean; eslint 0 errors (8 pre-existing unused-import warnings in wizard/review step).
- Independent verifier (risk `high`, RDD off): matcher, action (user-scoped, bounded window) and wizard OK.
  D1 fixed: if detection fails nothing is flagged, so commit falls back to `duplicateStrategy: "skip"`
  instead of `"import"` (otherwise a re-uploaded file would be double-inserted). `tsc` clean, eslint 0 errors.
- Known minor: an edited flagged row keeps a possibly stale flag; quantities/amounts with >8 decimals never
  match the stored `Decimal(20,8)` (false negative); stale header comment in `duplicates.ts`.
- Next: user browser check with an overlapping export.
