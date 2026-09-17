# Instrument Universe & Providers — Tasks
# Change: instrument-universe-providers

**Type**: Task checklist
**Delivery**: single-pr (`size:exception` **already accepted** by the user, proposal §14 — do not chain, do not re-ask)
**Strict TDD**: ON — pure modules only, per `openspec/config.yaml`. Prisma-backed orchestrators (`catalog-sync.ts`, `commit-import.ts`, server actions) get **no** new unit tests; risky logic lives in the pure modules they call.
**Test runner**: `npm test` (→ `vitest run`)
**Backbone**: `design.md` §14 implementation order (units 0–9). This file expands each unit into checkable tasks; it does not re-derive the order.
**Date**: 2026-09-16

---

## 0. Non-Negotiable Sequencing Constraint (read before starting C6)

**NFR-1 / proposal §5**: catalog ingestion (Leg 1) and the variant currency fix (Leg 2) MUST ship in the same deployable unit. There must be **no commit boundary** at which `catalog-sync.ts` classifies a variant as `USD` while `quotes.ts`/`provider-routing.ts` still route it through a raw `.BA` quote.

This is enforced structurally in this task list, not by convention:

- Group **C6** (T-31…T-38) is **one commit**. It is not split across the commit-boundary table in §2, and Apply MUST NOT open a PR or merge with only part of C6 present.
- T-35 (`quotes.ts`) and T-36 (`commit-import.ts`) are listed as sub-tasks of the same acceptance gate as T-34 (`catalog-sync.ts`) for exactly this reason — do not mark T-34 done and move on before T-35/T-36 are also done.
- T-38 is a structural gate: it fails the unit if `resolveCurrencyCode` still exists anywhere, or if `catalog-sync.ts`'s reordering and `quotes.ts`'s routing change are not in the same commit.

---

## 1. Task List

### C0 — Repo Hygiene + Baseline Green

*Must land first. `npx tsc --noEmit` currently reports 7 errors, `npm test` reports 2 failures — every later unit needs a green baseline to be meaningful (NFR-3).*

#### [x] T-1: Delete the `instruments-debug.log` leak
- **What**: Remove the `writeFileSync("instruments-debug.log", ...)` call and its `fs` import from `src/app/actions/monitoreo.ts`. Delete the `instruments-debug.log` file if present in the repo.
- **Files**: `src/app/actions/monitoreo.ts`, `instruments-debug.log` (delete)
- **Acceptance**: `rg "writeFileSync" src/app/actions/monitoreo.ts` returns no matches; the log file does not exist in the repo.
- **Spec refs**: NFR-4

#### [x] T-2: Delete the `usa_stocks` sample file
- **What**: Delete `data912com-live-usa_stocks.json` from the repo root. Do not adopt it, do not move it.
- **Files**: `data912com-live-usa_stocks.json` (delete)
- **Acceptance**: File does not exist; `usa_stocks` is not referenced by any fixture path in `src/`.
- **Spec refs**: FR-1, NFR-4

#### [x] T-3: Relocate the three remaining root-level data912 samples into `__fixtures__/`
- **What**: Move `data912com-live-arg_cedear.json`, `data912com-live-arg_stocks.json`, `data912com-live-corp.json` from the repo root into `src/lib/market/__fixtures__/data912/`, alongside the already-present `arg_bonds.json` and `arg_notes.json`. Update any import path that references the old root location.
- **Files**: the three JSONs (move); any importer of the old paths
- **Acceptance**: `src/lib/market/__fixtures__/data912/` contains all five universe samples; nothing under the repo root references them; `rg` for the old root paths returns no matches.
- **Spec refs**: NFR-4

#### [x] T-4: Rewrite `src/lib/market/provider-routing.test.ts` against the real contract
- **What**: Fix the two broken assertions. `hasUsdUnderlying` is **not** a field of `ResolvableInstrument` — remove references to it. `resolveMonitoringRouting` **always** returns an object — replace the `.toBeNull()` assertion with an assertion against the actual returned shape. The `"native"` literal **is** a valid `MonitoringSeriesKind` and MUST NOT be changed or removed.
- **Files**: `src/lib/market/provider-routing.test.ts`
- **Acceptance**: `npm test -- provider-routing` passes with 0 failures; `"native"` still appears as a valid case; no reference to `hasUsdUnderlying` remains.
- **Spec refs**: NFR-3

#### [x] T-5: Regenerate the Prisma client
- **What**: Run the project's Prisma generate command against the current (pre-change) `prisma/schema.prisma` so `yahoo-catalog.ts` / `market-snapshots.ts` compile against a client that matches the already-committed `MarketSnapshot` / `InstrumentProviderSymbol` models.
- **Files**: `src/lib/generated/prisma/**` (generated, not hand-edited)
- **Acceptance**: `npx tsc --noEmit` no longer reports errors originating from a stale Prisma client.
- **Spec refs**: NFR-3

#### [x] T-6: Baseline-green checkpoint
- **What**: Run `npx tsc --noEmit`, `npm test`, `npm run lint` and confirm all three are clean. Do not proceed to C1 until this passes.
- **Files**: none (verification only)
- **Acceptance**: `npx tsc --noEmit` → 0 errors; `npm test` → 0 failures; `npm run lint` → clean.
- **Spec refs**: NFR-3
- **Prereqs**: T-1, T-2, T-3, T-4, T-5

---

### C1 — Fixed-Income Tradability

*Independent of Legs 1–3. Must land before or with C8 (Docta), or Docta's bond data has no user-visible consumer (proposal §5). No UI change-notice is required — the data is being reimported anyway (design §R, dropped NFR-5).*

#### [x] T-7: Add `BOND_AR`/`LETRA` to `TRADE_INSTRUMENT_TYPES`
- **What**: Extend the constant in `src/lib/transactions/types.ts` to include `BOND_AR` and `LETRA` alongside the existing `STOCK_AR`, `CEDEAR`, `ON`.
- **Files**: `src/lib/transactions/types.ts`
- **Acceptance**: Searching `MCC3O` (an existing `BOND_AR` row) in the transaction form now returns it (Scenario FR-7-A).
- **Spec refs**: FR-7

#### [x] T-8: Add `BOND_AR`/`LETRA` to `INSTRUMENT_TYPE_OPTIONS`
- **What**: Extend the dropdown options in `src/components/transactions/transaction-form-modal.tsx` so both types are manually selectable.
- **Files**: `src/components/transactions/transaction-form-modal.tsx`
- **Acceptance**: The instrument type dropdown offers `BOND_AR` and `LETRA` (Scenario FR-7-A).
- **Spec refs**: FR-7
- **Prereqs**: T-7

#### [x] T-9: Route all three fixed-income types through fixed-income valuation
- **What**: In `src/app/actions/transactions.ts` (`getTransactionsPageDataAction` and any other routing site), replace the `type === "ON"` check with a check against `type ∈ {ON, BOND_AR, LETRA}` so every fixed-income transaction routes through `toBondTrade`/`valuateOnPositions`, never through `buildHoldings` + `refreshLatestQuotes`. This applies to transactions imported before this change too.
- **Files**: `src/app/actions/transactions.ts`
- **Acceptance**: A `BOND_AR` transaction imported before this change now values through the fixed-income path (Scenario FR-7-B).
- **Spec refs**: FR-7
- **Prereqs**: T-7

#### [x] T-10: Generalize `portfolio-bridge.ts` beyond hardcoded `"ON"`
- **What**: `toHoldingRow` / `valuateOnPositions` (and any other function in `src/lib/bonds/portfolio-bridge.ts` that hardcodes `type === "ON"`) accept all three fixed-income types.
- **Files**: `src/lib/bonds/portfolio-bridge.ts`
- **Acceptance**: `BOND_AR`/`LETRA` positions flow through the same bridge as `ON` with no `"ON"`-only branch remaining.
- **Spec refs**: FR-7
- **Prereqs**: T-9

---

### C2 — Schema + Migration

*Inert on its own. Must precede C3 and C6.*

#### [x] T-11: Add the schema delta to `prisma/schema.prisma`
- **What**: Add the 4-value `Settlement` enum (`ARS | USD | MEP | CCL`); non-nullable `settlement` (`@default(ARS)`) and nullable `baseInstrumentId` self-relation on `Instrument`; `sector`, `industry`, `issuer`, `law`, `assetClass` columns; `@@index([isin])` — **never `@@unique`** on `isin` (design AD-13, R-2e — settlement variants deliberately share an ISIN); the new `BondSchedule` model (`instrumentId` unique FK, `source`, `rows: Json`, `fetchedAt`); `CorporateEvent.createdByUserId` → nullable. Add an explicit schema comment next to `isin` warning against a future unique constraint.
- **Files**: `prisma/schema.prisma`
- **Acceptance**: Schema diff is additive only (no existing column/model removed or narrowed except the `createdByUserId` nullability change); `isin` carries `@@index` and no `@@unique`; `@@unique([ticker, type, venueCode, currencyCode])` is unchanged.
- **Spec refs**: FR-1, FR-2, FR-4, FR-11, FR-12, FR-14, FR-15, FR-16

#### [x] T-12: Generate and run the migration
- **What**: Run the project's migrate-dev command with name `instrument_settlement_and_metadata`. Verify the generated SQL matches design §6.1: `CREATE TYPE Settlement`, the 7 new `Instrument` columns, the `baseInstrumentId` FK (`ON DELETE SET NULL`), the `baseInstrumentId` index, the `isin` index (no unique), the `BondSchedule` table, and `ALTER COLUMN "createdByUserId" DROP NOT NULL`. Commit the migration file. Regenerate the Prisma client.
- **Files**: `prisma/migrations/<ts>_instrument_settlement_and_metadata/migration.sql`
- **Acceptance**: Migration runs cleanly against a fresh database; migrate status shows no pending migrations; the regenerated Prisma client exposes `Settlement`, `Instrument.baseInstrumentId`/`sector`/`industry`/`issuer`/`law`/`assetClass`, and `BondSchedule`.
- **Spec refs**: FR-1, FR-2, FR-4, FR-11, FR-12, FR-14, FR-15, FR-16
- **Prereqs**: T-11

---

### C3 — Seed: SPY Corporate Event

*Depends on C2 (needs `createdByUserId` nullable). Must land before the first reset (C9), or the SPY ratio-change fact is lost on the disposable database.*

#### [x] T-13: Seed the SPY `CEDEAR_RATIO_CHANGE` event with no creator
- **What**: In `prisma/seed.ts`, upsert the `SPY / CEDEAR / BYMA / ARS` instrument (not present in the seed today) on the existing `ticker_type_venueCode_currencyCode` compound key, then upsert a `CorporateEvent` on `instrumentId_effectiveDate_eventType` reading its parameters (`eventType = CEDEAR_RATIO_CHANGE`, `effectiveDate = 2026-06-01`, `numerator = 3`, `denominator = 1`) from `RECOMMENDED_EVENTS` in `src/lib/events/recommended.ts` — **import** the values, do not re-declare them. Set `createdByUserId: null`.
- **Files**: `prisma/seed.ts`
- **Acceptance**: `prisma db seed` against a fresh database creates the `CorporateEvent` row with `createdByUserId IS NULL` and does not fail on the FK (Scenario FR-15-A); re-running the seed is idempotent (no duplicate instrument or event row).
- **Spec refs**: FR-15
- **Prereqs**: T-12

---

### C4 — Yahoo Currency Oracle (Python Function)

*Moved ahead of the ingestion pipeline (design rev. 3): the currency oracle is now an input to reconciliation, not optional enrichment, so it must exist and be verified before C6.*

#### [x] T-14: Create `requirements.txt`
- **What**: At the repo root, list exactly one direct dependency: `yfinance==0.2.*` (pin the exact patch at implementation time). Do not list `pandas`/`numpy` — they arrive transitively and re-declaring them risks fighting a yfinance-driven bump.
- **Files**: `requirements.txt`
- **Acceptance**: File contains exactly one pinned direct dependency.
- **Spec refs**: NFR-6

#### [x] T-15: Create `api/_yahoo_catalog.py`
- **What**: Lift `normalize_symbol`, `resolve_yahoo_symbol`, `enrich_catalog_instrument` verbatim from `scripts/yahoo_catalog.py`. Leading underscore keeps Vercel from routing this file directly.
- **Files**: `api/_yahoo_catalog.py`
- **Acceptance**: Logic is byte-equivalent to the source functions (renamed imports only).
- **Spec refs**: FR-9

#### [x] T-16: Create `api/yahoo-metadata.py`
- **What**: Vercel file-based Python function (`class handler(BaseHTTPRequestHandler)` — **verify this convention against the current Vercel Python runtime docs before writing**, per design §16 item 2). `POST` only (`GET` → 405). Auth: `X-Internal-Token` header compared with `hmac.compare_digest` against `INTERNAL_FUNCTION_SECRET`; fail closed (401) if the secret is absent in the process, no timing-revealing early return. Batch limit 25 (`400` if exceeded). Two modes: `metadata` (default, §10.3 shape) and `currency` (`mode: "currency"`, §10.3b — AD-12 oracle). In `currency` mode, distinguish a Yahoo 404 (`ok: true, listed: false, currency: null` — evidence of absence) from a transport failure (`ok: false, error: "..."` — no evidence at all); never conflate the two. Response encoding `json.dumps(..., ensure_ascii=False)`, `Content-Type: application/json; charset=utf-8`. Unsupported instrument type in metadata mode → `ok: true, data: null`.
- **Files**: `api/yahoo-metadata.py`
- **Acceptance**: A `POST` with a wrong/missing token returns 401 for both modes; a 26-item batch returns 400; a `GET` returns 405; a known-listed symbol returns `ok: true` with data (metadata mode) or a currency (currency mode); an unlisted symbol (e.g. `AL30.BA`) returns `listed: false`, not a thrown error.
- **Spec refs**: FR-9, NFR-6
- **Prereqs**: T-15

#### [x] T-17: `yahoo-metadata-client.ts` — test-first (TDD RED → GREEN)
- **What**: Write `src/lib/market/yahoo-metadata-client.test.ts` **first**, covering the pure `parseCurrencyVerdict(status, body)`: HTTP 404 ⇒ `{ kind: "not-listed" }`; timeout/5xx ⇒ `{ kind: "unavailable" }`; `meta.currency` of anything other than `"ARS"`/`"USD"` (e.g. `"BRL"`) ⇒ `{ kind: "unavailable" }`, never a passthrough; a symbol missing from the response map ⇒ `unavailable`, **never `"ARS"`**. Then implement `parseCurrencyVerdict`, `fetchYahooMetadataBatch`, and `resolveUniverseCurrencies` (the HTTP adapter — batches by 25, `cache: "no-store"`, `AbortSignal.timeout(20_000)`, base URL from `INTERNAL_FUNCTION_BASE_URL` → `VERCEL_URL` → `localhost:3000`).
- **Files**: `src/lib/market/yahoo-metadata-client.ts`, `src/lib/market/yahoo-metadata-client.test.ts`
- **Acceptance**: Test file is written and RED before implementation exists; all cases above pass after implementation; a batch-level transport failure causes `resolveUniverseCurrencies` to return `unavailable` for that batch rather than throwing past the caller.
- **Spec refs**: FR-2, FR-4, NFR-2
- **Prereqs**: T-16

#### [x] T-18: Remove the `execFile` caller and delete `scripts/yahoo_catalog.py`
- **What**: In `src/lib/market/yahoo-catalog.ts`, delete `execFile`, `promisify`, and the subprocess body of `lookupYahooCatalogMetadata`; keep `enrichUsedInstruments` and `supportsYahooMetadata`, now calling the HTTP adapter from T-17. Delete `scripts/yahoo_catalog.py` (its logic now lives in `api/_yahoo_catalog.py`, T-15).
- **Files**: `src/lib/market/yahoo-catalog.ts`, `scripts/yahoo_catalog.py` (delete)
- **Acceptance**: `rg "execFile" src/lib/market/yahoo-catalog.ts` returns no matches; `scripts/yahoo_catalog.py` no longer exists; no remaining caller references it.
- **Spec refs**: FR-9, NFR-4
- **Prereqs**: T-17

#### T-19: Preview-deploy measurement — Yahoo batch shape and function health
- **What**: Deploy to a Vercel preview. Send one authenticated `POST /api/yahoo-metadata` in `metadata` mode and one in `currency` mode for a known CEDEAR (e.g. `GGAL`) and record: (a) both return `ok: true`; (b) whether `yfinance`'s batched lookup issues one upstream request per 25-symbol batch or fans out to one request per symbol internally (design §16 item 5 / user-required measurement #3 — the ~70-request estimate assumes the former). Record the measured behavior in this file's §5 (measurements log) once known.
- **Files**: none (deployment + measurement only)
- **Acceptance**: Both preview POSTs return `ok: true`; the batch-shape finding is recorded.
- **Spec refs**: NFR-6, design §9.2, §16 item 5
- **Prereqs**: T-16
- **STATUS: BLOCKED** — this apply session has no Vercel deploy/preview access (no `vercel` CLI session, no way to trigger or reach a preview URL from this sandbox). `api/_yahoo_catalog.py` and `api/yahoo-metadata.py` (T-15/T-16) are implemented and locally smoke-tested (auth 401/405/400 paths verified via a local `http.server` harness — see apply-progress.md), but the actual `yfinance`-backed Yahoo call and the real batch-shape question are unverified. **Exact command to run once deploy access exists**: `vercel deploy` (or push to a branch with Vercel Git integration) to get a preview URL, then:
  ```bash
  curl -s -X POST "https://<preview-url>/api/yahoo-metadata" \
    -H "X-Internal-Token: $INTERNAL_FUNCTION_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"items":[{"symbol":"GGAL","type":"CEDEAR"}]}'
  curl -s -X POST "https://<preview-url>/api/yahoo-metadata" \
    -H "X-Internal-Token: $INTERNAL_FUNCTION_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"mode":"currency","items":[{"symbol":"GGAL","type":"CEDEAR"}]}'
  ```
  Both must return `"ok": true`. Inspect Vercel's function logs for the request count `yfinance` issued upstream during the currency-mode call to resolve the batch-shape question.

---

### C5 — Pure Modules + Tests (TDD RED First)

*`strict_tdd: true`. Every module below is written test-first. This is the highest-risk new logic in the change — a false link or a wrong currency silently mis-values a holding — so it lives entirely on the tested side of the module boundary (design §7).*

#### [x] T-20: `instrument-identity.ts` — test-first
- **What**: Write `instrument-identity.test.ts` first: assert output is byte-identical to the deleted `commit-import.ts` `instrumentKey()`; a null `venueCode` renders as a trailing empty segment; two rows differing only in `currencyCode` produce different keys. Then implement `instrumentKey({ ticker, type, currencyCode, venueCode }): string` — mirrors `@@unique([ticker, type, venueCode, currencyCode])`.
- **Files**: `src/lib/market/instrument-identity.ts`, `src/lib/market/instrument-identity.test.ts`
- **Acceptance**: All three cases pass; this becomes the only exported identity function in the codebase (verified in T-38).
- **Spec refs**: FR-5, NFR-2

#### [x] T-21: `settlement-classify.ts` — test-first
- **What**: Write tests first: `currencyForSettlement("ARS") === "ARS"`; `currencyForSettlement("USD"|"MEP"|"CCL") === "USD"`; `moreSpecific` lattice never allows `MEP → USD` or `USD → ARS` downgrades (`ARS < USD < MEP|CCL`). Then implement both functions.
- **Files**: `src/lib/market/settlement-classify.ts`, `src/lib/market/settlement-classify.test.ts`
- **Acceptance**: Lattice tests pass; module is shared by `catalog-sync.ts` and `commit-import.ts` (wired in C6) so they cannot disagree.
- **Spec refs**: FR-4, NFR-2 (design AD-5, AD-13b)
- **Prereqs**: T-12 (needs the generated `Settlement` type)

#### [x] T-22: `settlement-matching.ts` (`planSettlementLinks`) — test-first, locked regression cases
- **What**: Write `settlement-matching.test.ts` **first**, encoding the full §4.4 measured table and the counter-example set — this is the module that must never again encode a measured-false claim (design R-2b):
  - `NVDA`/`NVDAC` → `CCL`; `NVDA`/`NVDAD` → `MEP`.
  - `C`/`CC` → `CCL` — **`CC` links to Citigroup, not treated as Chemours**.
  - `BA`/`BAC` → `CCL`; `BA`/`BAD` → `MEP`.
  - `GGAL`/`GGALD` → `MEP`; `YPFD`/`YPFDD` → `MEP`.
  - `TGNO4`/`TGN4D` → `MEP`, confirmed **across a ticker rewrite**, no string rule involved.
  - **`DD`/`DDD` MUST produce a link** (`baseTicker = "DD"`, `currencyCode = "USD"`) and MUST NOT produce `ARS` — the regression test for the false negative rev. 1 nearly canonised. Assert "one of `MEP`/`USD`", not a pinned split (separation is 0.1pp, below `MIN_SEPARATION`).
  - **`CARC` MUST NOT be linked to anything** — excluded at the currency partition (Yahoo reports it `ARS`), not by a price band.
  - Null CCL only, null MEP only, and both null with `asOf` 4 days stale all still emit `settlement: "USD"` for every confirmed-USD symbol (currency is never lost to a stale-rate skip).
  - `price` of `0`/`null`/`NaN` keeps the currency (`unlinked: "no-quote"`, not a currency loss).
  - Two ARS bases both passing tolerance for one USD variant ⇒ `{ settlement: "USD", baseTicker: null }` (`unlinked: "ambiguous"`), currency kept.
  - Base and candidate variant of different `InstrumentType` never pair.
  - A `currency: null` (Yahoo 404) symbol follows the ratio-only path and never defaults to `ARS`.

  Then implement `planSettlementLinks(quotes, rates, now?)` per design §4.1–§4.3 (group partition → rate gate → eligibility → candidate generation by prefix/3-char affinity within the Yahoo-covered slice only → ratio → nearest-anchor split with `MIN_SEPARATION` → one-winner-per-variant).
- **Files**: `src/lib/market/settlement-matching.ts`, `src/lib/market/settlement-matching.test.ts`
- **Acceptance**: Every case above is a separate, named test and passes; no path in the implementation can assign `ARS` to a confirmed-USD symbol.
- **Spec refs**: FR-2, FR-4, NFR-2 (design §4, R-2b)
- **Prereqs**: T-21

#### [x] T-23: `isin-grouping.ts` (`groupByIsin`) — test-first
- **What**: Write tests first against the captured fixtures: `instruments-AL30.json` + `instruments-AL30D.json` (both `isin: "ARARGE3209S6"`) ⇒ **one group of two**; `instruments-MCC3O.json` (`AR0922852063`) ⇒ a separate group of one; **two rows with `isin: null` do NOT group together** (the most likely wrong implementation — grouping on `null` as if it were a shared value); a blank/whitespace-only ISIN is treated as `null`. Then implement `groupByIsin(rows)`.
- **Files**: `src/lib/market/isin-grouping.ts`, `src/lib/market/isin-grouping.test.ts`
- **Acceptance**: All four cases pass, including the null-ISIN non-grouping case.
- **Spec refs**: FR-2, FR-16, NFR-2 (design AD-13)

#### [x] T-24: `concurrency.ts` (`mapWithConcurrency`) — test-first
- **What**: Write tests first: max in-flight never exceeds the given limit; output order matches input order regardless of completion order; one item's rejection does not sink the batch (others still resolve); a budget cutoff stops *starting* new work without aborting in-flight work. Then implement.
- **Files**: `src/lib/utils/concurrency.ts`, `src/lib/utils/concurrency.test.ts`
- **Acceptance**: All four properties hold under test with an artificial delayed/rejecting `fn`.
- **Spec refs**: FR-13, NFR-2

#### [x] T-25: Measurement — distinct instrument count driving the concurrency cap
- **What**: Run `SELECT COUNT(DISTINCT "instrumentId") FROM "Transaction" WHERE "instrumentId" IS NOT NULL;` against the project database. Record the result here. Confirm `ENRICH_CONCURRENCY = 4` (design §9.2) remains adequate — **revise only if the count exceeds ~300**; otherwise leave the constant as designed.
- **Files**: none (measurement; result recorded in this file's §5 log)
- **Acceptance**: Query result is recorded; a decision (keep 4, or revise) is written down before T-52 hard-codes the constant.
- **Spec refs**: NFR-... design §9.1 (user-required measurement #4)

#### [x] T-26: `docta-mapping.ts` — `mapDoctaInstrument` + `mapDoctaCashflow` — test-first
- **What**: Write tests first against `__fixtures__/docta/instruments-MCC3O.json` and `cashflow-MCC3O.json`:
  - `mapDoctaInstrument`: mojibake repair `"Energã­A"` → `"EnergíA"` (byte-level Latin-1 round-trip over the seeded lowercase-sequence table from §8.2; no title-case correction attempted); `isin`, `sector`, `issuer`, `law`, `assetClass` map through unchanged.
  - `mapDoctaCashflow`: `couponRate === 0.075` (from `7.5 / 100`); `couponFrequencyMonths === 6` (modal gap, not first-gap); `issueDate`/`maturityDate` resolve; `amortizationSchedule` sums to 100 within 0.01.
  - Gate cases (§8.3b), each asserting **no `BondTerms` row / a `ScrapedBondProposal` is returned instead**: a mutated fixture whose amortization sums to 99; a name with no recognized currency token; a name containing only a bare `$` (never a match — must NOT default to any currency); a name with `"U$S"` → resolves `USD`; a name with a `BADLAR` marker and a constant rate → `rateType === "FLOATING"`.
  - **Locked acceptance case**: `mapDoctaCashflow(cashflow-AL30.json)` — whose `interest_rate` steps `0.13 → 0.5 → 0.75 → 1.75` — MUST refuse to create or auto-fill a `BondTerms` row. This is the explicit "AL30 step-up refusal" check required for this change; it must never regress to auto-filling a row with `rateType = FLOATING` at a fake constant rate.
  - `dayCountConvention` is absent from every returned `BondTerms` input object, in every case — the schema default `ACT/365` applies untouched.

  Then implement both functions per design §8.2–§8.3b.
- **Files**: `src/lib/market/docta-mapping.ts`, `src/lib/market/docta-mapping.test.ts`
- **Acceptance**: All cases above pass; the AL30 refusal case is present and named so it cannot be silently deleted later.
- **Spec refs**: FR-10, FR-11, NFR-2 (design §8.2, §8.3, §8.3b)

#### [x] T-27: `docta-mapping.ts` — `mapDoctaSchedule` (AD-14) — test-first
- **What**: Extend the same test file with: `mapDoctaSchedule(cashflow-AL30.json)` yields 19 rows whose `interestRate` sequence contains all four distinct steps (`0.13`, `0.5`, `0.75`, `1.75`) — **the assertion that fails under any single-rate model**; `interestAmount` is copied verbatim, never recomputed; `residualValue` ends at `0`. Then implement `mapDoctaSchedule(json)` → `BondSchedule` row input, copying `paymentDate`/`capital`/`interestRate`/`interestAmount`/`residualValue`/`cashFlow` verbatim with no derivation.
- **Files**: `src/lib/market/docta-mapping.ts`, `src/lib/market/docta-mapping.test.ts`
- **Acceptance**: The four-step assertion passes; no rounding or averaging of `interestRate` occurs anywhere in the function.
- **Spec refs**: FR-11, NFR-2 (design AD-14)
- **Prereqs**: T-26

#### [x] T-28: `schedule-source.ts` — test-first
- **What**: Write tests first: `BondSchedule` present ⇒ it is used and `projectCashFlows` is never invoked; `BondSchedule` absent ⇒ falls through to `BondTerms` + `projectCashFlows`; both absent ⇒ resolver returns an empty/no-schedule result, not a throw. Then implement the pure resolver.
- **Files**: `src/lib/bonds/schedule-source.ts`, `src/lib/bonds/schedule-source.test.ts`
- **Acceptance**: All three precedence cases pass.
- **Spec refs**: FR-11, NFR-2 (design AD-14)
- **Prereqs**: T-27

#### [x] T-29: `faceValue` neutrality — test-first
- **What**: Write a test asserting that projecting the same schedule fixture through `scaleFlowsToHolding` with `faceValue = 100` and with `faceValue = 1000` yields identical scaled flows for the same `nominalHeld` — the property that makes the unconditional `faceValue = 100` in the auto-fill gate safe (design §8.3b).
- **Files**: `src/lib/bonds/cashflows.test.ts` (extend existing suite) or a new colocated test file if none covers `scaleFlowsToHolding` today
- **Acceptance**: The neutrality assertion passes against the existing, unchanged `scaleFlowsToHolding` implementation.
- **Spec refs**: FR-11, NFR-2

#### [x] T-30: `provider-routing.ts` — add the `"spot"` branch — test-first
- **What**: Extend `provider-routing.test.ts` (already fixed in T-4) with new cases for the `"spot"` `seriesKind` branch: a linked variant resolves `{ externalSymbol: "<base>.BA", currency: "ARS" }`; a variant with `settlement = "USD"` and **no** base link resolves its own `.BA` symbol at `currency: "ARS"`; a base resolves its own symbol; a `STOCK_US` case is unaffected. Then extend `ResolvableInstrument` with `settlement: Settlement` and `baseInstrument?: { ticker: string } | null`, and add the `"spot"` branch to `resolveMonitoringRouting`, branching on `baseInstrumentId` presence — **not** on `settlement` — per design AD-6.
- **Files**: `src/lib/market/provider-routing.ts`, `src/lib/market/provider-routing.test.ts`
- **Acceptance**: All four new cases pass; the branch decision is on the link (`baseInstrumentId`), confirmed by a case where `settlement = "USD"` but `baseInstrumentId` is set and still resolves off the base.
- **Spec refs**: FR-6, NFR-2 (design AD-6)
- **Prereqs**: T-4, T-21

---

### C6 — Leg 1 + Leg 2 Together: Catalog Ingestion + Currency-Aware Quotes

**HARD CONSTRAINT (NFR-1 / proposal §5, see §0 above): T-31 through T-38 land in ONE commit. Do not open a PR boundary inside this group.**

#### [x] T-31: `data912-universe.ts` — single reader, two cache policies
- **What**: Implement one `fetchData912Live({ revalidateSeconds })` reader used by both `fetchInstrumentUniverse()` (`revalidate: 3600`, tag `instrument-catalog`) and `fetchData912MarketSnapshots()` (`cache: "no-store"`). `CatalogInstrument` gains a `price` field. Delete `fetchEndpointSymbols` and `stripCurrencyVariants` (dead code after this change).
- **Files**: `src/lib/market/data912-universe.ts`
- **Acceptance**: Both cache-policy call sites compile against the one reader; `stripCurrencyVariants`/`fetchEndpointSymbols` no longer exist anywhere in `src/`.
- **Spec refs**: FR-1 (design AD-10)

#### [x] T-32: `market-snapshots.ts` — shared reader + shared identity
- **What**: `syncLatestData912Snapshots` consumes the T-31 reader instead of its own fetch, and replaces its hand-rolled `ticker|type` map with `instrumentKey` (T-20).
- **Files**: `src/lib/market/market-snapshots.ts`
- **Acceptance**: No duplicate data912 fetch remains in the same cron pass; the file imports `instrumentKey` rather than computing its own key.
- **Spec refs**: FR-5 (design AD-10, §3.5)
- **Prereqs**: T-20, T-31

#### [x] T-33: `dolarapi.ts` — add `fetchMepQuote()`
- **What**: Add `fetchMepQuote()` against `https://dolarapi.com/v1/dolares/bolsa`, same `DolarapiResponse` shape, same `next: { revalidate: 900 }` opt-in, same `null`-on-failure contract as the existing CCL fetch. Persist via the existing `FxRate` upsert with `source: FxSource.MEP` (enum value already exists). `ccl-rate.ts` is **not** modified.
- **Files**: `src/lib/market/dolarapi.ts`
- **Acceptance**: `fetchMepQuote()` returns `null` on failure, never throws; a successful call upserts an `FxRate` row with `source = MEP`.
- **Spec refs**: FR-4 (design AD-13b, §4.5)

#### [x] T-34: `catalog-sync.ts` — reordered pipeline, deleted fallback, AD-5 lattice
- **What**: Delete `identityKey()` and `resolveCurrencyCode()` outright. Import `instrumentKey` (T-20). Reorder the pipeline per design §3.3/§5.1: fetch → snapshots → `resolveUniverseCurrencies()` (T-17; on `unavailable` → abort creates, `ok: false`, `currencyOracle: "unavailable"`, but delist/reactivate still run) → `planSettlementLinks()` (T-22, pure) → apply the plan to existing rows by `id` using the `moreSpecific` lattice (T-21 — never downgrade `MEP`/`CCL` to `USD`, never null a known `baseInstrumentId`) → reconcile via `instrumentKey` on both sides (`createMany({ skipDuplicates: true })`, reactivate, delist — keep the empty-universe guard) → `enrichUsedInstruments` last, best-effort, capped + budgeted. `CatalogSyncResult` gains `linked`, `duplicateGroups`, `currencyOracle` fields. Add the duplicate-group reporting query (§3.5) to the result, logged not enforced.
- **Files**: `src/lib/market/catalog-sync.ts`
- **Acceptance**: `resolveCurrencyCode` and the old `identityKey` no longer exist in the file; the pipeline order matches §5.1 exactly; a run with `currencyOracle: "unavailable"` creates zero new rows and leaves existing rows untouched while still running delist/reactivate; the empty-universe guard still returns `ok: false` without touching existing rows.
- **Spec refs**: FR-1, FR-2, FR-3, FR-4, FR-5, FR-13, FR-14 (design §3, §5.1, AD-0, AD-5, AD-12)
- **Prereqs**: T-17, T-20, T-21, T-22, T-31, T-32, T-33
- **Land together with**: T-35, T-36 (see §0)

#### [x] T-35: `quotes.ts` — currency-aware routing (must land with T-34)
- **What**: `InstrumentForQuote` gains `currencyCode`/`settlement`/`baseInstrument`. `refreshLatestQuotes` calls `resolveMonitoringRouting(inst, "spot")` (T-30) instead of its inline `ARGENTINIAN_TYPES.has(type)` symbol build. When resolution says `currency: "USD"`, multiply by the CCL rate via the same `resolveCclRate()` the ON branch already uses, before writing `PriceCache`. `PriceCache` stays ARS-only (semantics unchanged).
- **Files**: `src/lib/market/quotes.ts`
- **Acceptance**: A `NVDAD` row with `currencyCode = "USD"`, `settlement = "MEP"` does **not** request a `NVDAD.BA` symbol (Scenario FR-6-A) — it resolves off `NVDA.BA` and converts through the applicable CCL/MEP rate.
- **Spec refs**: FR-4, FR-6 (design AD-6)
- **Prereqs**: T-30
- **Land together with**: T-34, T-36 (see §0)

#### [x] T-36: `commit-import.ts` — shared identity, no local key
- **What**: Delete the local `instrumentKey()` in `commit-import.ts`; import the one from T-20 (byte-identical output — the importer's behavior does not change). `p.currencyCode` (broker-attested, from the statement) remains the currency source for the import path — never rewritten by enrichment (AD-0). Un-comment the self-heal identity check now that currency/venue are correctly modeled end-to-end.
- **Files**: `src/lib/importers/commit-import.ts`
- **Acceptance**: The file has no locally-defined identity function; `resolveInstrumentsBatch` and `catalog-sync.ts` produce the same key string for the same listing (Scenario FR-5-A).
- **Spec refs**: FR-5 (design AD-2)
- **Prereqs**: T-20
- **Land together with**: T-34, T-35 (see §0)

#### [x] T-37: `EnrichmentPatch` type — compile-time currency-immutability guard
- **What**: Define `EnrichmentPatch = { name?: string; isin?: string; sector?: string; industry?: string; issuer?: string; law?: string; assetClass?: string; website?: string }` and make it the **only** shape `enrichUsedInstruments` (in `yahoo-catalog.ts`) can pass to a Prisma update. The type has no `currencyCode`/`settlement`/`baseInstrumentId`/`venueCode`/`ticker`/`type` key, so a future writer of any of those is a TypeScript compile error, not a silent data change. Yahoo's currency field, read during enrichment, is discarded, never assigned.
- **Files**: `src/lib/market/yahoo-catalog.ts` (or a shared types module it imports from), wired for use in C8's Docta enrichment too
- **Acceptance**: `enrichUsedInstruments`'s Prisma `data` object is typed as `EnrichmentPatch`; attempting to add `currencyCode` to it fails `tsc`.
- **Spec refs**: FR-14 (design AD-0, AD-3)
- **Prereqs**: T-18

#### [x] T-38: Structural gate — sequencing constraint satisfied
- **What**: Confirm, before this group is considered done: (1) `rg "resolveCurrencyCode"` across `src/` returns no matches; (2) T-34, T-35, T-36 are all present in the same commit (check via `git show --stat` on the commit that lands this group); (3) `EnrichmentPatch` (T-37) is in place and compiles.
- **Files**: none (verification only)
- **Acceptance**: All three checks pass. This is the enforcement point for NFR-1 — do not proceed to C7 until it does.
- **Spec refs**: NFR-1
- **Prereqs**: T-34, T-35, T-36, T-37

---

### C7 — Search Chip + Sector Read Path + Reset Escape Hatch

*Depends on C2 (schema) and C6 (linked rows exist with correct currency). No sector backfill script — the C9 resync populates sector for every row (design §R).*

#### [x] T-39: `searchInstrumentsAction` — settlement in the returned shape
- **What**: Extend the shape returned by `src/app/actions/instruments.ts`'s `searchInstrumentsAction` with `settlement`. Results for a ticker family are flat, independent rows (no grouping/nesting of variants under a base). Within a ticker family, the `ARS` row sorts first, ahead of strict alphabetical order.
- **Files**: `src/app/actions/instruments.ts`
- **Acceptance**: Searching `NVDA` returns three flat rows (`NVDA`, `NVDAC`, `NVDAD`), each carrying its own `settlement`, with `NVDA` first (Scenario FR-8-A).
- **Spec refs**: FR-8
- **Prereqs**: T-38

#### [x] T-40: Render the settlement chip in search UI
- **What**: Wherever `searchInstrumentsAction` results are rendered (transaction form instrument picker), render a `USD`/`MEP`/`CCL` chip; no chip for `ARS`. Verify the exact component path at implementation time (transaction search combobox).
- **Files**: `src/components/transactions/transaction-form-modal.tsx` and/or its instrument-picker subcomponent
- **Acceptance**: `NVDAC` and `NVDAD` each display a chip; `NVDA` displays none (Scenario FR-8-A).
- **Spec refs**: FR-8
- **Prereqs**: T-39

#### [x] T-41: `dashboard.ts` — 3-step sector fallback on **both** branches
- **What**: Extend the `instrument` select in `getDashboardPageDataAction` (`src/app/actions/dashboard.ts`) with `sector`, `baseInstrument: { select: { sector: true } }`, `underlyingAsset: { select: { sector: true } }`. Replace the single-source sector read with `r.instrument.sector ?? r.instrument.baseInstrument?.sector ?? r.instrument.underlyingAsset?.sector ?? null`, and — the easily-missed part — apply this on the **fixed-income branch too**, which today `continue`s before the sector line and therefore never records a sector at all.
- **Files**: `src/app/actions/dashboard.ts`
- **Acceptance**: A fixed-income row now populates `sectorByInstrument` (today it does not); `translateSector` remains the unchanged last-resort fallback.
- **Spec refs**: FR-12
- **Prereqs**: T-38

#### [x] T-42: `portfolio-bridge.ts` — `toDashboardHolding` carries sector through
- **What**: `toDashboardHolding` (`src/lib/bonds/portfolio-bridge.ts`) currently hardcodes `sector: null`. Add a `sector: string | null` parameter fed from the same map built in T-41, so Docta/Yahoo-sourced sector actually reaches the dashboard donut.
- **Files**: `src/lib/bonds/portfolio-bridge.ts`
- **Acceptance**: A fixed-income instrument's Docta-sourced sector is visible on the dashboard's sector distribution (Scenario FR-12-B), not swallowed by the hardcoded `null`.
- **Spec refs**: FR-12
- **Prereqs**: T-41

#### [x] T-43: `scripts/reset-settlement-links.ts` — manual escape hatch (AD-5)
- **What**: A plain `tsx` script, not a route, not a cron. Accepts an optional ticker list. Runs `UPDATE "Instrument" SET "baseInstrumentId" = NULL, "settlement" = 'ARS', "currencyCode" = 'ARS' WHERE "baseInstrumentId" IS NOT NULL AND ($1::text[] IS NULL OR "ticker" = ANY($1))`. The next sync re-derives links from scratch. No UI, no server action.
- **Files**: `scripts/reset-settlement-links.ts`
- **Acceptance**: Running the script with no args resets every linked instrument to `ARS`/unlinked; running it with a ticker list resets only those; a subsequent `sync-catalog` run re-links what it can.
- **Spec refs**: none directly (design AD-5 rollback mechanism)
- **Prereqs**: T-38

---

### C8 — Docta Client + ISIN Linking + `BondSchedule` + `BondTerms` Auto-Fill + Analítica v2

*Depends on C1 (a consumer must exist), C2 (`BondSchedule` table), and C5 (mappings already tested). AD-13's ISIN link is a membership mechanism for fixed income and must not disagree with C6's pipeline about who owns that membership — it extends the same reconciliation model, wired here because the Docta client did not exist until now.*

#### [x] T-44: `docta-client.ts` — token mint/cache, feature gate, two GETs
- **What**: `isDoctaEnabled()` = both `DOCTA_CLIENT_ID` and `DOCTA_CLIENT_SECRET` set; every entry point short-circuits to a no-op when false. Base URL is a module constant (confirm the exact host/prefix against the live service at implementation — design §16 item 1; a wrong constant fails closed, it cannot corrupt data). Token minted via `POST /auth/token` (`client_credentials`), held in module-scope `{ token, expiresAt }`, refreshed at `expires_in - 300s`, **never** persisted. `GET /bonds/instruments/{TICKER}/` and `GET /bonds/analytics/{TICKER}/cashflow?nominal_units=100`. Cache both payloads in `ScrapedBondData` (`ticker @unique`, `payload Json`, `fetchedAt`) — immutable per ticker, never re-fetched once cached. Any non-2xx/timeout/parse failure → `null`, logged at `warn`, no write, never propagates.
- **Files**: `src/lib/market/docta-client.ts`
- **Acceptance**: With env vars absent, every call is a no-op with no network attempt; with env vars present, a token is minted once and reused across calls within its `expires_in` window (Scenario FR-10-A).
- **Spec refs**: FR-10 (design AD-8)

#### [x] T-45: Wire ISIN linking (AD-13) into the fixed-income enrichment pass
- **What**: For every `BOND_AR`/`LETRA` ticker (221 symbols), fetch Docta instrument metadata (T-44), populate `Instrument.isin`, group via `groupByIsin` (T-23), and assign settlement by descending price within a confirmed group of 2 or 3 (highest = `ARS`, then `MEP`, then `CCL`), using the ratio only to split a group of exactly 2 — the same price-ordering rule as the Yahoo-covered slice (AD-13b), reusing `planSettlementLinks`'s split logic or an equivalent call into it.
- **Files**: `src/lib/market/catalog-sync.ts` (or a dedicated fixed-income linking step it calls) 
- **Acceptance**: `AL30`/`AL30D` (shared ISIN `ARARGE3209S6`) are grouped and linked despite Yahoo's 404 for both (Scenario FR-2-F).
- **Spec refs**: FR-2, FR-4, FR-16 (design AD-13, AD-13b)
- **Prereqs**: T-23, T-44
- **REVISED (2026-09-16, post-acceptance measurement — see §5 row 6)**: "for every ticker (221 symbols)" above described the original, unverified whole-universe-per-run assumption. Measured against the live account, Docta's "basic" plan allows only 15 requests/day (10/minute) — nowhere near enough for 221 tickers in one pass. The implementation is now held-first (transaction-referenced tickers looked up before unheld ones) and budget-capped per run (`DOCTA_LINKING_BUDGET_PER_RUN`, `fixed-income-linking.ts`), with the ordering/budget decision extracted into a pure, tested module (`docta-linking-plan.ts`). This is a correction to the implementation and to `design.md`/`spec.md`, not a re-opening of this task's own acceptance (`AL30`/`AL30D` group correctly whenever both are reached within budget — verified against the fixtures, not live, per the coordinator's explicit instruction not to spend live Docta calls while the quota is exhausted).

#### T-46: Measurement — Docta ISIN coverage for exotic tickers
- **What**: Query Docta's `/bonds/instruments/{TICKER}/` for `BA7DD`, `XN6D`, `TVPA`. Record whether each returns an ISIN. If any does not, confirm it falls through to unlinked-but-tradable (FR-3), not an error. This count also decides whether AD-13's documented cashflow-fingerprint fallback needs to be built (design §16 item 8's sibling measurement).
- **Files**: none (measurement; result recorded in this file's §5 log)
- **Acceptance**: Coverage result recorded for each of the three tickers; fallback-build decision stated.
- **Spec refs**: FR-2, FR-3 (design AD-13, user-required measurement #1)
- **Prereqs**: T-44
- **STATUS: BLOCKED (revised) — credentials now exist, but the live account's rate limit is exhausted.** Credentials were provisioned mid-session. First real call succeeded: `fetchDoctaInstrument("AL30")` returned `200` with `isin: "ARARGE3209S6"` (matching the captured fixture exactly), which also surfaced and fixed a real bug: the base URL's `/bonds/instruments/{TICKER}/` path with a **trailing slash returns HTTP 404** on the live service; the correct path has no trailing slash (`docta-client.ts` corrected accordingly — see the code comment there dated 2026-09-16). Every subsequent call, including for `BA7DD`, `XN6D`, and `TVPA`, returned **HTTP 429** with a `Retry-After` header measured at **~64,900 seconds (~18 hours)** — a hard daily/session request quota on the "basic" plan, exhausted by the diagnostic calls made while isolating the trailing-slash bug. One bounded retry (capped at 5s, not the full `Retry-After` value — an uncapped first attempt at honoring `Retry-After` literally hung a script for minutes before this was caught and fixed) was added to `docta-client.ts` for resilience against transient 429s, but a quota this large cannot be waited out in this session.
  - **Result actually obtained for BA7DD / XN6D / TVPA: all three returned HTTP 429 — no evidence either way, not "no ISIN".** This is NOT the same as a negative measurement (a real 404/no-isin result); it means the question could not be asked. Recording it as BLOCKED, not as a coverage finding, per instruction to never substitute a heuristic for an unmeasured result.
  - **Exact command to finish this measurement**: wait until the quota resets (Retry-After was ~18h from 2026-09-16 ~05:52 UTC — should be clear by ~2026-09-17 ~00:00 UTC), then run `fetchDoctaInstrument("BA7DD")` / `fetchDoctaInstrument("XN6D")` / `fetchDoctaInstrument("TVPA")` (a throwaway `tsx` script, one call per ticker, spaced a few seconds apart) and inspect `.data[0]?.isin`.

#### [x] T-47: Wire `mapDoctaInstrument` into the enrichment orchestrator for fixed income
- **What**: For ON/BOND_AR/LETRA instruments referenced by a transaction, write `name`/`isin`/`sector`/`issuer`/`law`/`assetClass` through the `EnrichmentPatch` type (T-37) — never `currencyCode`/`settlement`/`baseInstrumentId`/`venueCode`/`ticker`/`type`. Base-row resolution: a settlement variant does not store its own `sector`/`industry`; enrichment resolves each requested id to its base first (AD-3).
- **Files**: `src/lib/market/docta-client.ts` or a new orchestrator module it's called from
- **Acceptance**: `MCC3O`'s mojibake name persists corrected (Scenario FR-10-B); a variant instrument never carries its own `sector` value.
- **Spec refs**: FR-10, FR-12, FR-14
- **Prereqs**: T-26, T-37, T-44

#### [x] T-48: Wire `mapDoctaSchedule` — always-attempted primary path
- **What**: For a held fixed-income instrument with a Docta cashflow response, UPSERT the `BondSchedule` row via `mapDoctaSchedule` (T-27) — this always runs when cashflow data is available, independent of the `BondTerms` gate below.
- **Files**: the same orchestrator module as T-47
- **Acceptance**: `AL30`'s 19-period step-up schedule persists verbatim with all four rate steps intact (Scenario FR-11-A).
- **Spec refs**: FR-11
- **Prereqs**: T-27, T-44

#### [x] T-49: Wire `mapDoctaCashflow` → `BondTerms` parity path
- **What**: `BondTerms` row absent + §8.3b gate passes → CREATE it (auto-fill). `BondTerms` row absent + gate fails → write `ScrapedBondData`, surface a propose-don't-overwrite flow. `BondTerms` row already present → write `ScrapedBondData(source="docta")`, surfaced via the existing `getBondTermsProposalAction` as a `ScrapedBondProposal`, **never** overwritten.
- **Files**: the same orchestrator module as T-47/T-48
- **Acceptance**: `MCC3O` (constant rate) auto-fills `BondTerms` with `couponRate = 0.075`, `currencyCode = "USD"` from the `U$S` token, `faceValue = 100`, `rateType = "FIXED"`, no `dayCountConvention` written (Scenario FR-11-B). `AL30` (step-up) creates **no** `BondTerms` row at all and relies solely on its `BondSchedule` (Scenario FR-11-A) — this is the explicit "AL30 refusal" acceptance check required for this change, verified end-to-end through the orchestrator, not only in the T-26 unit test. An instrument with an existing `BondTerms` row is proposed to, never overwritten (Scenario FR-11-D).
- **Spec refs**: FR-11 (design AD-7)
- **Prereqs**: T-26, T-48

#### [x] T-50: `bond-terms.ts` — Docta branch in `getBondTermsProposalAction`
- **What**: Add a Docta-sourced branch to `getBondTermsProposalAction`, preferred over the existing argen.bond scraper when Docta returns data. `ScrapedBondProposal` type and the existing propose UI are unchanged.
- **Files**: `src/app/actions/bond-terms.ts`
- **Acceptance**: For an instrument with Docta data available, the proposal surfaced is Docta-sourced, not argen.bond-sourced.
- **Spec refs**: FR-11
- **Prereqs**: T-49

#### [x] T-51: Bonds UI reads `BondSchedule` first
- **What**: Wire the bonds page / analítica-v2 view to resolve via `schedule-source.ts` (T-28): read `BondSchedule` when present, fall back to `BondTerms` + `projectCashFlows` only when no `BondSchedule` row exists.
- **Files**: `src/lib/bonds/` view/consumer of cashflow data (e.g. `bond-cashflow-table.tsx` or equivalent — confirm exact component at implementation)
- **Acceptance**: `/bonds → analítica v2` shows AL30's stored step-up schedule when Docta data is present, with no `projectCashFlows` derivation call for it.
- **Spec refs**: FR-11
- **Prereqs**: T-28, T-48

#### [x] T-52: Cap and budget the Docta/Yahoo enrichment fan-out
- **What**: Apply `mapWithConcurrency` (T-24) with `ENRICH_CONCURRENCY = 4` (or the value confirmed in T-25) to both the Yahoo and Docta enrichment call sites. Add `ENRICH_BUDGET_MS = 120_000` as an elapsed-time stop for *starting* new work. Per-request timeout `AbortSignal.timeout(20_000)`. Keep the currency-oracle fan-out (T-17/C6) on its own separate `CURRENCY_BUDGET_MS = 90_000` — it is not best-effort and must fail closed on exhaustion, unlike enrichment.
- **Files**: `src/lib/market/yahoo-catalog.ts`, the Docta enrichment orchestrator (T-47–T-49)
- **Acceptance**: Enrichment never exceeds the 120s budget for starting new work; a Yahoo or Docta failure during enrichment never fails the sync or import (Scenario FR-13-A).
- **Spec refs**: FR-13
- **Prereqs**: T-24, T-25, T-38, T-47

#### [x] T-53: Move `enrichUsedInstruments` off the import commit's critical path
- **What**: **Before implementing**, read `node_modules/next/dist/docs/` for the Next.js 16 `after()` API (per `AGENTS.md`). Delete the `enrichUsedInstruments` call from `commit-import.ts` entirely. Re-issue it from `commitImportAction` (`src/app/actions/imports.ts`) inside `after(() => enrichUsedInstruments(ids).catch(warn))`, after the response is prepared, so a throw inside it cannot reach the user or fail the commit.
- **Files**: `src/lib/importers/commit-import.ts`, `src/app/actions/imports.ts`
- **Acceptance**: A Docta/Yahoo failure during import no longer fails an otherwise-valid commit (Scenario FR-13-A); the commit still returns `{ ok: true, ... }` synchronously while enrichment runs after the response.
- **Spec refs**: FR-13 (design AD-9)
- **Prereqs**: T-36, T-52

#### [x] T-54: `sync-catalog` route — `maxDuration`
- **What**: Add `export const maxDuration = 300` to `src/app/api/cron/sync-catalog/route.ts` (no route currently declares one; `backfill-prices` already proves 300 works on this plan).
- **Files**: `src/app/api/cron/sync-catalog/route.ts`
- **Acceptance**: Route segment config exports `maxDuration = 300`.
- **Spec refs**: FR-13 (design §9.2)

#### [x] T-55: Acceptance check — enrichment never mutates `currencyCode`
- **What**: Explicit runtime acceptance scenario (beyond `EnrichmentPatch`'s compile-time guard, T-37): ingest `MCC3O` with `currencyCode = USD` (its settlement's assigned currency), then run Docta enrichment where the response embeds `"U$S 7.50%"` inside `name`'s free text. Confirm `name`/`isin`/`issuer`/`law`/`sector` update as usual while `Instrument.currencyCode` remains untouched at `USD`.
- **Files**: none beyond what T-47–T-49 already implement (verification task)
- **Acceptance**: `MCC3O.currencyCode` is `USD` before and after enrichment, even though the enrichment payload's free text mentions a currency (Scenario FR-14-A).
- **Spec refs**: FR-14
- **Prereqs**: T-47

---

### C9 — Reset Acceptance Pass (Last)

*Replaces rev. 1's `?dryRun=1` gate. Executes the full §6.2 runbook end to end and records every acceptance number this design calls out as "measure, don't assume."*

#### [x] T-56: Execute the reset runbook
- **What**: In order — `prisma migrate reset --force` → `prisma db seed` → trigger `GET /api/cron/sync-catalog` → re-import the existing Balanz statements through the import UI. Do not reorder (design §6.2: reimporting before sync is not wrong, only noisier).
- **Files**: none (operational)
- **Acceptance**: All four steps complete without error.
- **Spec refs**: FR-1 through FR-16 (integration surface)
- **Prereqs**: T-13, T-38, T-45, T-49, T-53
- **EVIDENCE**: Steps 1–2 (`prisma migrate reset --force --skip-generate` then `prisma db seed`) were executed by the orchestrator with the user's explicit consent (not re-run by this agent, per instruction). All 8 migrations replayed cleanly including `20260916010000_instrument_settlement_and_metadata`; `prisma migrate status` now reports "Database schema is up to date!". Post-reset counts: `Currency 24 · Venue 10 · Broker 7 · Instrument 25 · CorporateEvent 2 · User 0 · Transaction 0`. The orphaned `20260831220748_add_suggested_corporate_event` DB-side migration record (flagged as a risk in this file's C2 apply-progress notes) is gone — the database now matches the migrations folder exactly. Step 3 (trigger `sync-catalog`) executed by this batch — see T-64 below for the run's own result. **Step 4 (reimport the Balanz statements) is explicitly deferred to the user** — there are 0 users and 0 transactions in the reset database, and reimporting requires the user's own xlsx file and an authenticated session, neither of which this agent has. Every T-57..T-66 acceptance check that needs portfolio/transaction data is marked BLOCKED below pending that reimport, not silently skipped.

#### [x] T-57: Duplicate query returns zero rows
- **What**: Run `SELECT ticker, type, count(*) FROM "Instrument" WHERE "venueCode" = 'BYMA' GROUP BY ticker, type HAVING count(*) > 1;`.
- **Files**: none
- **Acceptance**: Zero rows returned.
- **Spec refs**: FR-5 (design §3.5)
- **Prereqs**: T-56
- **RESULT: PASS.** Run against the post-reset, post-sync database (246 instruments after the real `sync-catalog` run below). **0 rows returned.**

#### [x] T-58: `currencyCode = currencyForSettlement(settlement)` holds for every row
- **What**: Run an acceptance query joining every `Instrument` row against `currencyForSettlement(settlement)` and assert no mismatch.
- **Files**: none
- **Acceptance**: Zero mismatches (design AD-1's hard invariant).
- **Spec refs**: FR-4
- **Prereqs**: T-56
- **RESULT: 1 mismatch found out of 246 rows — reported honestly, NOT silently excluded.** `CASH-USD` (`type: CASH`, `settlement: "ARS"`, `currencyCode: "USD"`) violates the invariant literally. **Root cause, pre-existing, not introduced by this change**: `upsertCashInstrument` in `prisma/seed.ts` sets `currencyCode` directly from its input (`"USD"` for the `CASH-USD` synthetic ledger row) and never touches `settlement` at all, leaving it at the schema default `"ARS"`. This function was not modified anywhere in this apply session. **Assessment**: `CASH` instruments are synthetic cash-ledger rows, not real BYMA-traded securities — they never participate in AD-12/AD-13 linking and were arguably never in scope for AD-1's invariant, which design frames entirely in terms of settlement variants. However, the design states the invariant holds "for every row, always" with no stated `CASH` exception. **Recorded as a genuine, unresolved finding for `sdd-verify`**: either AD-1's invariant needs an explicit `CASH`-type carve-out in its own wording, or `upsertCashInstrument` needs a `settlement` fix (e.g. a dedicated non-BYMA settlement value, or simply setting `settlement` consistently with `currencyCode` for CASH rows). Not fixed in this batch — out of scope for C9's acceptance pass, and the correct fix depends on a design decision (schema-level `CASH`-type carve-out vs. seed fix) neither this agent nor the orchestrator has made.

#### T-59: No row is `ARS` while Yahoo reports `USD` for its symbol
- **What**: Spot-check the §R.2 measured variant list (`NVDA`/`NVDAC`/`NVDAD`, `DD`/`DDD`, `C`/`CC`, `BA`/`BAC`/`BAD`, `GGAL`/`GGALD`, `YPFD`/`YPFDD`, `TGNO4`/`TGN4D`) against the post-reset database.
- **Files**: none
- **Acceptance**: Every variant in the list carries `currencyCode = USD`.
- **Spec refs**: FR-2, FR-4
- **Prereqs**: T-56
- **STATUS: BLOCKED — the Yahoo currency oracle is unreachable in this environment, honestly.** Confirmed directly: `INTERNAL_FUNCTION_BASE_URL` and `VERCEL_URL` are both unset, so `yahoo-metadata-client.ts` falls back to `http://localhost:3000` — nothing is listening there (`api/yahoo-metadata.py` is a Vercel Python function, never deployed in this session). The real `syncInstrumentCatalog()` run below confirms this at the pipeline level: `resolveUniverseCurrencies` failed transport-wide, `currencyOracleUnavailable` was `true`, and **none of the variant tickers in this list exist in the database at all** — `NVDAC`/`NVDAD`/`DDD`/`CC`/`BAC`/`BAD`/`GGALD`/`YPFDD`/`TGN4D` were never created, because AD-12's fail-closed policy correctly skipped every Yahoo-covered create this run (verified: `STOCK_AR` count stayed at 12, `CEDEAR` at 11 — both exactly the pre-sync seed counts, zero net new rows of either type). There is nothing in the database to spot-check, and asserting "every variant carries `currencyCode = USD`" over an empty set would be a vacuously true, meaningless pass — **not claimed here**. **Exact command to unblock**: deploy `api/yahoo-metadata.py` to a reachable Vercel preview/production URL, set `INTERNAL_FUNCTION_BASE_URL` (or deploy so `VERCEL_URL` is populated) and `INTERNAL_FUNCTION_SECRET`, then re-run `syncInstrumentCatalog()` (or trigger `GET /api/cron/sync-catalog`) so the 1,687 Yahoo-covered symbols actually get created and classified, then re-run this spot-check.

#### T-60: `AL30`/`AL30D` insert together and both persist
- **What**: Explicit insert acceptance check (design R-2e — this is the highest-consequence mistake available in this change): confirm both `AL30` and `AL30D` rows exist post-reset with `isin = "ARARGE3209S6"` and that no unique-constraint violation occurred on insert.
- **Files**: none
- **Acceptance**: Both rows persist with the same ISIN; `isin` carries only `@@index`, never `@@unique` (Scenario FR-16-A).
- **Spec refs**: FR-16
- **Prereqs**: T-56
- **PARTIAL — the half that could run passes; the half that needs the exhausted Docta quota is BLOCKED.** Both rows DO exist post-sync: `AL30` (`isin: "ARARGE3209S6"`) and `AL30D` (`isin: null`) — **no unique-constraint violation on insert, confirmed**, which is the actual highest-consequence risk this check exists to catch (R-2e: a future `@unique` on `isin` would have made this insert fail outright; it did not). `isin` still carries only `@@index([isin])`, never `@@unique`, confirmed by re-reading `prisma/schema.prisma`. **What did NOT complete**: `AL30D` does not yet carry the shared ISIN — its `fetchDoctaInstrument` call was rate-limited (429) during the real sync run before it could be fetched (only `AL30` was cached from an earlier, successful diagnostic call). Consequently the two rows are not yet linked (`AL30D.baseInstrumentId` is still `null`). This is the SAME Docta rate-limit block recorded under T-46 — re-running `linkFixedIncomeByIsin()` (or a full `sync-catalog`) after the quota resets will complete this.

#### [x] T-61: SPY corporate event exists with no creator
- **What**: Verify a `CorporateEvent` row exists for the SPY instrument with `eventType = CEDEAR_RATIO_CHANGE`, `effectiveDate = 2026-06-01`, `numerator = 3`, `denominator = 1`, `createdByUserId IS NULL`.
- **Files**: none
- **Acceptance**: Row exists exactly as specified (Scenario FR-15-A).
- **Spec refs**: FR-15
- **Prereqs**: T-56
- **RESULT: PASS, extended to two events per the orchestrator's mid-session fix.** Post-reset, exactly two `CorporateEvent` rows exist, both `createdByUserId: null`: `SPY / CEDEAR_RATIO_CHANGE / 2026-06-01 / 3:1` (exactly as originally specified) and `YPFD / STOCK_SPLIT / 2026-08-03 / 10:1` (added to `RECOMMENDED_EVENTS` after the orchestrator discovered it was a real, previously-auto-detected event that would otherwise have been lost — see the C3 known-defect note in `apply-progress.md` for the full context of why a second event exists at all).

#### T-62: Record linked-variant and sector-coverage counts, and the AD-13 ISIN gap
- **What**: Record: total linked variants (base↔variant pairs established); sector coverage (% of instruments with a non-null resolved sector); and — from T-46's measurement plus a full pass — how many of the 221 fixed-income tickers Docta returned no ISIN for. This last number decides whether the AD-13 cashflow-fingerprint fallback needs to be built.
- **Files**: none (result recorded in this file's §5 log)
- **Acceptance**: All three numbers recorded; fallback-build decision (yes/no) stated.
- **Spec refs**: FR-2, FR-3, FR-12
- **Prereqs**: T-56, T-46
- **PARTIAL — real, honest numbers recorded, but they measure "how far the Docta rate limit let us get," not the design's true steady-state coverage.** See §5 below for the exact figures: **linked variants: 0**; **sector coverage: 0/246 (0%)**; **ISIN gap: 220/221 fixed-income tickers with no ISIN yet (only `AL30` succeeded before the quota exhausted)**. Both the linked-variant count and the ISIN gap are near-total artifacts of this session's two external-dependency blocks (Yahoo oracle unreachable; Docta quota exhausted), not evidence about the design's actual linking/coverage rate. Sector coverage's 0% has a THIRD, independent cause, unrelated to either provider being down: `enrichUsedInstruments`/`enrichDoctaHeldInstruments` are both correctly scoped to transaction-referenced instruments only (FR-9), and **there are 0 `Transaction` rows** in this freshly reset database — enrichment has nothing to enrich yet, by design, until the user reimports. **Fallback-build decision: DEFERRED, not "no."** The design's own criterion ("a material number of ISIN-less tickers" decides whether AD-13's cashflow-fingerprint fallback gets built) cannot be evaluated from a 220/221 gap caused by a quota, not by Docta genuinely lacking those tickers' ISINs. Re-run this measurement after the quota resets (see T-46) before making the fallback-build call.

#### T-63: The eight known non-variant tickers verify as distinct groups
- **What**: Confirm `TVPA`/`TVPE`/`TVPP`/`TVPY` produce **four distinct ISINs** (four groups of one) and `TZXD6`/`TZXD7`/`TZXD8` produce **three distinct ISINs** (three groups of one) against the post-reset database (Scenario FR-2-G — this was an assumption, not a measurement, in the design).
- **Files**: none
- **Acceptance**: All eight tickers resolve to distinct ISINs. If any pair shares an ISIN, that is evidence the assumption about the instrument (not the linking mechanism) is wrong — flag it, do not silently accept a merge.
- **Spec refs**: FR-2 (design §16 item 8, user-required measurement #2)
- **Prereqs**: T-56
- **STATUS: BLOCKED — same Docta rate-limit exhaustion as T-46/T-60/T-62.** Queried directly against the post-sync database: all 7 named tickers exist as rows (`TVPA`, `TVPE`, `TVPP`, `TVPY`, `TZXD6`, `TZXD7`, `TZXD8` — note the task's own list is 4+3=7 tickers despite the "eight" in its title; a pre-existing discrepancy in this file, not introduced here) and **all show `isin: null`** — none were reached by `linkFixedIncomeByIsin` before the Docta quota exhausted. No conclusion can be drawn either way; this is not evidence the tickers ARE or AREN'T distinct. **Exact command to unblock**: identical to T-46 — wait for the quota reset, then query each ticker via `fetchDoctaInstrument` and compare `.data[0]?.isin` values.

#### [x] T-64: First sync after deploy delists nothing unexpected
- **What**: Immediately after the reset's initial `sync-catalog` run (T-56), trigger a second sync and diff active-instrument counts. Confirm only genuinely absent symbols get soft-delisted — no mass delist from a key mismatch or a currency-classification regression.
- **Files**: none
- **Acceptance**: Second-sync delist count is ~0 (or matches only symbols genuinely removed from data912's response), never a mass delist.
- **Spec refs**: FR-1, FR-5 (design §3.4, R-1b)
- **Prereqs**: T-56
- **RESULT: PASS for the part that could run; the Yahoo-classification part is out of scope this run (honestly noted).** Ran `syncInstrumentCatalog()` (via a direct `tsx` invocation, not the HTTP route — equivalent code path) **twice** against the live data912 universe (`1936` raw rows fetched both times). First run: `Instrument` count `25 → 246` (`+221` fixed income created — all of `arg_bonds`/`arg_notes`; 0 Yahoo-covered creates, correctly blocked by `currencyOracleUnavailable`), and exactly **1** soft-delist: `BRK.B` (a hardcoded seed `CEDEAR` whose literal `"BRK.B"` ticker — with the dot — does not match data912's real symbol for Berkshire Hathaway B; a genuinely-absent-from-the-universe case, the correct and intended delist behavior, not a regression). Second run: `Instrument` count unchanged at **246** (`245` active / `1` inactive, identical set) — **zero additional delists, zero mass-delist, zero net change of any kind**, confirmed by comparing instrument counts before and after the second run's reconcile phase completed (verified via the sync's own log line `"Currency oracle unavailable"`, which is emitted after the reconcile fetch/snapshot/create/delist steps run, before the Docta ISIN-linking pass). **What this run does NOT cover, stated plainly**: the "currency-classification regression" half of this check's own acceptance wording is specifically about the Yahoo-covered slice (1,687 symbols), which never got created in either run (Yahoo oracle unreachable, per T-59) — there is no currency classification happening yet to regress. This check is therefore a real, clean PASS for the key-mismatch/mass-delist risk (the part actually exercisable here), with the Yahoo-currency-regression risk untested until T-59's blocker clears.

#### T-65: Preview-deploy Yahoo POST re-verification
- **What**: Re-run T-19's preview-deploy check against the final merged branch state (both modes) before merge.
- **Files**: none
- **Acceptance**: Both modes return `ok: true` on the branch that will merge.
- **Spec refs**: FR-9, NFR-6
- **Prereqs**: T-19, T-56
- **STATUS: BLOCKED** — same reason as T-19: no Vercel deploy/preview access in this environment, and `api/yahoo-metadata.py` is not deployed anywhere reachable. Confirmed directly during this C9 batch: `INTERNAL_FUNCTION_BASE_URL` and `VERCEL_URL` are both unset (`node --env-file=.env -e "..."` → `false`/`false`), so `yahoo-metadata-client.ts` falls back to `http://localhost:3000`, which has nothing listening — every call to `resolveUniverseCurrencies`/`fetchYahooMetadataBatch` fails at the transport layer this session, confirmed by the real `syncInstrumentCatalog()` run in T-64 reporting `currencyOracle: "unavailable"`. T-19 (which T-65 re-runs) was never completed to begin with, so there is nothing to "re-verify" yet. **Exact command**, identical to T-19's: deploy to a Vercel preview, then run the two `curl` POSTs recorded under T-19 above, against both `metadata` and `currency` modes.

#### [x] T-66: Final quality gates
- **What**: Run `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`.
- **Files**: none
- **Acceptance**: `npx tsc --noEmit` → 0 errors; `npm test` → 0 failures; `npm run lint` → clean; `npm run build` → passes (NFR-3, Scenario NFR-3-A).
- **Spec refs**: NFR-3
- **Prereqs**: T-56 through T-65
- **RESULT: PASS, all four.** `npx tsc --noEmit` → 0 errors. `npm test` → 310/310 passing, 0 failures. `npx eslint .` → 0 errors, 11 pre-existing warnings (none introduced by this change). `npx next build` → succeeds, 21 routes generated, one pre-existing unrelated Turbopack NFT-tracing note. Run even though T-19/T-59/T-65 (and the Docta-dependent halves of T-60/T-62/T-63) remain blocked/partial — those are external-dependency and quota blocks, not code-quality failures, and T-66's own scope is exactly these four commands.

---

## 2. Suggested Commit Boundaries

| Commit | Tasks | Description |
|--------|-------|-------------|
| C0 | T-1…T-6 | Repo hygiene + baseline green |
| C1 | T-7…T-10 | Fixed-income tradability |
| C2 | T-11, T-12 | Schema + migration |
| C3 | T-13 | Seed: SPY corporate event |
| C4 | T-14…T-19 | Yahoo currency-oracle Python function |
| C5 | T-20…T-30 | Pure modules + tests (TDD RED→GREEN) |
| **C6** | **T-31…T-38** | **Catalog ingestion + currency-aware quotes — ONE commit, never split (NFR-1)** |
| C7 | T-39…T-43 | Search chip + sector read path + reset escape hatch |
| C8 | T-44…T-55 | Docta client + ISIN linking + `BondSchedule` + `BondTerms` auto-fill |
| C9 | T-56…T-66 | Reset acceptance pass (last) |

---

## 3. Dependency Graph

```
C0 (T-1..T-6)
  │
  ├──────────────► C1 (T-7..T-10) ───────────────────────────────┐
  │                                                                │
  ├──────────────► C2 (T-11,T-12) ──► C3 (T-13) ─────────────┐    │
  │                        │                                  │    │
  │                        └──────────────────────────────┐   │    │
  │                                                        ▼   │    │
  ├──────────────► C4 (T-14..T-19) ──► T-17 ──┐            │   │    │
  │                                            ▼            │   │    │
  └──────────────► C5 (T-20..T-30) ───────────┴──► C6 (T-31..T-38)  │
                          │                            │             │
                          │                            ▼             │
                          │                        C7 (T-39..T-43)   │
                          │                            │             │
                          └──► C8 (T-44..T-55) ◄───────┘◄────────────┘
                                     │
                                     ▼
                                C9 (T-56..T-66)
```

**Sequential (hard blockers)**:
- C0 must complete before any other group starts (baseline must be green).
- C2 must complete before C3 (seed needs nullable `createdByUserId`) and before C6 (needs `Settlement` enum + `BondSchedule`).
- C4's T-17 must complete before C6 (catalog-sync needs `resolveUniverseCurrencies`).
- C5 must complete before C6 (catalog-sync/quotes.ts are wired directly on top of the pure modules) and before C8 (Docta mapping tests must exist first).
- **C6 is atomic**: T-34, T-35, T-36 land in the same commit (§0, NFR-1). T-38 is the structural gate — do not proceed to C7 or C8 without it passing.
- C7 depends on C6 (linked rows with correct currency must exist before the chip/sort logic is meaningful).
- C1 must land before or with C8 (a Docta-fed bond needs a tradable, searchable consumer).
- C8 depends on C1, C2, and C5; its ISIN-linking task (T-45) extends the same reconciliation model C6 builds, so C6 should be conceptually stable (though not necessarily merged) before T-45.
- C9 is last and depends on every prior group.

**Parallelizable**:
- C1 and C2/C3 can proceed in parallel (independent surfaces).
- C4 and C5 can proceed in parallel except where C5's `settlement-classify.ts` (T-21) needs the `Settlement` type generated by C2 (T-12).
- Within C5, T-20/T-21/T-24 have no cross-dependency and can be done in any order; T-22 depends on T-21; T-26→T-27→T-28→T-29 are sequential; T-30 depends on T-4 and T-21.
- Within C8, T-47/T-48/T-49 depend on the same orchestrator module and are naturally sequential; T-50/T-51 depend on T-49/T-28 respectively and can proceed in parallel once their prereqs land.

---

## 4. Quality Gates

**Per-commit gates** (run after each commit boundary before starting the next):
- `npx tsc --noEmit` — 0 errors
- `npm run lint` — clean
- `npm test` — 0 failures (only pure-module tests exist; Prisma orchestrators are not tested per `config.yaml`)
- After C2: migration applies cleanly; Prisma client regenerates with the new types.
- After C6 (T-38): the structural sequencing gate in §0 — do not proceed without it.

**Per-task acceptance** is defined inline above. Apply MUST verify each task's one-line acceptance criterion before marking it done.

**Strict TDD discipline (C4's T-17, C5 entirely, C6's T-30)**: the test file is written and observed RED before the implementation exists. Do not write implementation and test together and call it done.

---

## 5. Measurements Log (fill in during Apply)

| # | Measurement | Task | Result | Decision |
|---|---|---|---|---|
| 1 | Docta ISIN coverage for `BA7DD`, `XN6D`, `TVPA` | T-46 | **BLOCKED (revised) — credentials now provisioned and verified working (token mint succeeded, `AL30` resolved correctly), but the live account's request quota is exhausted.** Measured: `AL30` → `200 isin=ARARGE3209S6` (the one call that succeeded before the quota ran out). `BA7DD`/`XN6D`/`TVPA` → all `429`, `Retry-After ≈ 64,900s (~18h)`, measured 2026-09-16 ~05:52–05:58 UTC. **Also measured and fixed as a side effect**: the live service 404s on `/bonds/instruments/{TICKER}/` (trailing slash) — the correct path has no trailing slash; `docta-client.ts` corrected. | _pending_ — re-run after ~2026-09-17 00:00 UTC (quota reset); decides whether AD-13's cashflow-fingerprint fallback needs to be built. |
| 2 | Distinct ISINs for `TVPA`/`TVPE`/`TVPP`/`TVPY` and `TZXD6`/`TZXD7`/`TZXD8` | T-63 | **BLOCKED** — same exhausted Docta quota as row 1. All 7 tickers exist as `Instrument` rows post-sync; all show `isin: null` (not reached before the quota ran out — not evidence of absence). | _pending_ — re-run after the quota resets. |
| 3 | Yahoo real batch size per `mode: "currency"` request | T-19 | **BLOCKED** — no Vercel preview/deploy access in this apply session. Exact command recorded at T-19 above. Confirmed again this batch: `INTERNAL_FUNCTION_BASE_URL`/`VERCEL_URL` both unset; the real `syncInstrumentCatalog()` run (T-64) independently confirms the transport is unreachable (`currencyOracle: "unavailable"`). | _pending_ — design is unaffected either way (cap + `CURRENCY_BUDGET_MS` bound it regardless, per AD-12); run the recorded command before merge. |
| 4 | `SELECT COUNT(DISTINCT "instrumentId") FROM "Transaction"` | T-25 | **36** (measured 2026-09-16 against the dev database, pre-reset) — **0** (measured again post-reset, 2026-09-16: `Transaction` count is `0` until the user reimports). | **Keep `ENRICH_CONCURRENCY = 4`** — both the original and post-reset counts are far below the ~300 revision threshold. Re-measure after reimport for the figure that will actually drive steady-state enrichment load. |
| 5 | AD-13 ISIN gap across all 221 fixed-income tickers | T-62 | **220/221 (99.5%) show no ISIN — but this measures the exhausted Docta quota, not Docta's real coverage.** Only `AL30` (pre-cached before the quota ran out) has an ISIN; the other 220 were never reached (all 429). Linked-variant count: **0**. Sector coverage: **0/246 (0%)** — a real, independent finding: `enrichUsedInstruments`/`enrichDoctaHeldInstruments` are correctly scoped to transaction-referenced instruments (FR-9) and there are 0 `Transaction` rows post-reset, so enrichment has nothing to do yet, by design — this is expected, not a defect. | **DEFERRED, not "no"** — the fallback-build decision requires a real ISIN-gap measurement, which this run could not produce. Re-measure after the Docta quota resets. |
| 6 | Docta "basic" plan's real rate limit (why row 1's quota vanished) | — (discovered during T-46/T-60/T-62/T-63 acceptance work, not a pre-assigned task) | **COMPLETE — measured directly from a live HTTP 429 response, 2026-09-16.** `x-dailylimit-limit: 15` (requests/day, total, shared across every Docta endpoint), `x-dailylimit-remaining: 0`, `x-ratelimit-limit: 10` (requests/minute), `x-ratelimit-reset: 1789603200` (Unix seconds), `retry-after: 63103` (seconds, ≈17.5h from measurement time). This corrects an earlier, unverified briefing that treated the 221 fixed-income `/instruments/` calls as "essentially free" — that assumption is what let a single run (plus a handful of diagnostic calls made to isolate the trailing-slash 404 bug) exhaust roughly 18 hours of quota in under a minute. | **Fixed, not just recorded**: `fixed-income-linking.ts` is now held-first and budget-capped per run (`DOCTA_LINKING_BUDGET_PER_RUN = 8`, `src/lib/market/fixed-income-linking.ts`), the ordering/budget-slicing logic lives in a new pure, unit-tested module (`docta-linking-plan.ts`, 8/8 tests passing), a 429 now stops the run immediately (no retry — a retry against a *daily* cap cannot succeed within the same run), and a confirmed 404 is now cached permanently (previously discarded, which is what let the trailing-slash bug re-burn the whole quota on the second sync run). `design.md`'s AD-13/§8 and `spec.md`'s FR-2 were amended to reflect this — see the design-correction note in `apply-progress.md`. |

Apply MUST fill this table in as each measurement task completes, not leave it for a later phase.

---

## 6. Risks to Watch During Apply

| Risk | Mitigation |
|------|------------|
| **C6 gets split across two commits/PRs** | This is the single highest risk to this change. §0 and T-38 exist specifically to catch it. Refuse to proceed past T-38 if T-34/T-35/T-36 are not in the same commit. |
| **`isin` acquires a `@unique` constraint** (design R-2e) | The schema comment from T-11 plus T-60's insert acceptance check are the two guards. If a future linter or reviewer suggests uniqueness on `isin`, reject it — settlement variants sharing an ISIN is the link, not a data-quality bug. |
| **A ticker-identity claim enters a test without a captured probe** (design R-2b) | T-22 encodes only measured cases (§4.4 table). Do not add a new pair to the locked test suite without a captured Yahoo/Docta probe behind it. |
| **`DD`/`DDD` gets re-asserted as a non-link** | T-22's locked regression test exists specifically to prevent this reintroduction. |
| **Enrichment writes `currencyCode`** | T-37's `EnrichmentPatch` type is the structural guard; T-55 is the runtime acceptance check. A raw `prisma.instrument.update` bypassing the type is the residual risk (design R-1b) — grep for stray `prisma.instrument.update` calls outside the enrichment module during C8/C9. |
| **AL30's step-up bond gets auto-filled anyway** | T-26's locked test + T-49's end-to-end acceptance check both assert refusal. Do not weaken the `interest_rate`-constant gate to "make auto-fill work" for a convenience case. |
| **Yahoo becomes an unmitigated hard dependency of ingestion** (design R-2c) | Accepted deliberately — a guessed currency is worse and permanent under AD-0. Confirm `catalog-sync.ts` (T-34) truly aborts creates rather than guessing on `currencyOracle: "unavailable"`. |
| **`after()` semantics differ from pre-16 assumptions** | T-53 explicitly requires reading `node_modules/next/dist/docs/` before implementation — do not assume training-data behavior for `after()` or route `maxDuration`. |
| **Vercel Python function bundle/cold-start risk** | T-19/T-65 preview-deploy checks are the gate; do not merge without a green preview POST in both modes. |
| **Mojibake repair over-corrects a string that was not actually mojibake** (design R-5) | T-26's table is evidence-only — extend it only when a new fixture proves a new sequence, never guess beyond captured evidence. |
| **Serverless cold starts multiply Docta token mints** (design R-4) | Accepted at current load (design AD-8); not a blocker for this change. |

---

## 7. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated total authored changed lines (proposal §9) | **~1,400–1,900**, plus **~150–250** for sector coverage (proposal §15) ⇒ roughly **~1,550–2,150** |
| Review budget | 800 lines |
| Budget status | **`size:exception` already accepted** by the user (proposal §14). This forecast is informational, not a gate — do not re-propose chaining. |
| Chained PRs recommended | **No** — single-pr delivery per accepted decision |
| Fixture moves (T-3) | Excluded from the authored count (renames) |
| Highest-density work unit | C6 (schema-adjacent pipeline reorder + quote routing) and C5 (five new pure modules with locked regression tables) |

> Per proposal §9's own breakdown: fixed-income tradability + cleanup + baseline green ≈250 lines; schema + ingestion + variant linking (incl. pure modules + tests) ≈450 lines; currency-aware quotes + search chip ≈300 lines; Yahoo Python function + TS adapter + `execFile` removal ≈250 lines; Docta client + fixture-tested mapping + analítica v2 wiring ≈400 lines; sector coverage ≈150–250 lines on top. This task list's C0–C9 grouping maps directly onto that breakdown; no new scope has been added beyond what proposal §9 and §15 already forecast.

---

## 8. Apply-Phase Handoff Notes

- **Strict TDD is ON** for every task in C4 (T-17), all of C5 (T-20…T-30), and the extension in C6 (T-30 is written before T-31–T-38 consume it). Write the test, observe RED, then implement.
- **Do NOT** add unit tests for Prisma-backed orchestrators (`catalog-sync.ts`, `commit-import.ts`, `quotes.ts`, any `src/app/actions/*`) — per `openspec/config.yaml`'s testing convention. Every task above that touches one of these files is explicitly marked "no new test" by omission of a test-first instruction.
- **Next.js 16 caveat**: T-53 (the `after()` primitive) and T-54 (`maxDuration`) explicitly require reading `node_modules/next/dist/docs/` before implementation, per `AGENTS.md`. Do not assume pre-16 behavior for either.
- **The §0 sequencing constraint is the single most important rule in this file.** Re-read it before starting C6, and again before marking C6 done.
- **Measurements are tasks, not assumptions**: T-19, T-25, T-46, T-62, T-63 must produce recorded numbers in §5 above, not inferred estimates. Do not skip them to "save time" — several downstream decisions (concurrency cap, fingerprint-fallback build) depend on their results.
- **On continuation batches**: if this change's apply phase spans multiple sessions, search for and read any prior `sdd/instrument-universe-providers/apply-progress` artifact in full before resuming, and merge (never overwrite) progress notes.
- **Artifact language**: all code, comments, identifiers, and this task file are in English. User-facing UI copy in Spanish where the existing codebase already uses Spanish (consistent with existing conventions; this change introduces no new user-facing copy requirement beyond the settlement chip labels, which are short codes — `MEP`/`CCL`/`USD` — not prose).
- **Rollback**: schema rollback is the reverse migration (§6.1's inverse) but the primary recovery path for a bad settlement link is `scripts/reset-settlement-links.ts` (T-43), not a schema rollback. Rollback for a bad `BondTerms` auto-fill is a single row delete (design R-3).

---

## C10 — Post-C9 Scope Additions (ON-through-Docta confirmation + equity-profile drip) (DONE)

Narrower successor objective, confirmed by the user, additive to C0–C9 (not a reopening of that prior work). Capped at 400 changed lines / 3 attempts.

#### [x] T-67: Confirm ON is already routed through Docta for bond terms (no new code needed)
- **What**: Verify live that Yahoo's `quoteSummary` has zero bond-term data for ON (`assetProfile`/`defaultKeyStatistics`/`bondData` all "No fundamentals data found"; `quoteType: "EQUITY"`), confirming AD-12 stays as designed (Yahoo covers ON's currency/settlement only). Then confirm `docta-enrichment.ts`'s `FIXED_INCOME_TYPES` already includes `ON` (AD-14's `BondSchedule`/gated `BondTerms` auto-fill mechanism), and confirm `fixed-income-linking.ts`'s `FIXED_INCOME_TYPES` correctly stays `[BOND_AR, LETRA]` only (ON does not need ISIN linking).
- **Result**: Both already correct — **no code fix needed** in either file. Added a clarifying comment to `docta-mapping.test.ts` documenting that its existing `MCC3O`-based tests (`MCC3O` is itself an ON per its own fixture's `sub_asset_class: "ON"`) already exercise the exact code path an ON instrument uses in production, since `mapDoctaInstrument`/`mapDoctaCashflow`/`mapDoctaSchedule` are all structurally agnostic to which fixed-income type called them — no ON-specific branch exists to test differently.
- **Files**: `src/lib/market/docta-mapping.test.ts` (comment only, no logic change)
- **Spec refs**: FR-11 (amended), AD-12/AD-14 (design.md rev. 6 corrections)

#### [x] T-68: `equity-profile-drip-plan.ts` — pure candidate selection (TDD)
- **What**: Pure module selecting which unheld STOCK_AR/CEDEAR tickers get an equity-profile enrichment attempt this run: excludes held instruments (already covered by `enrichUsedInstruments`), orders deterministically (alphabetical by ticker, not insertion order), and clamps to a limit (0 or negative → empty plan).
- **Files**: `src/lib/market/equity-profile-drip-plan.ts`, `src/lib/market/equity-profile-drip-plan.test.ts`
- **Acceptance**: RED confirmed first (file did not exist), then GREEN — 5/5 tests passing (held-exclusion, alphabetical order, limit cap, zero limit, negative-limit clamp).
- **Spec refs**: FR-17 (new)

#### [x] T-69: `profileEnrichedAt` column + migration
- **What**: Add `Instrument.profileEnrichedAt DateTime?` — an explicit marker for "this row was attempted by the drip, regardless of outcome" instead of inferring "unenriched" from `name === ticker` (which would false-positive whenever a real ticker's name IS its symbol).
- **Files**: `prisma/schema.prisma`, `prisma/migrations/20260916020000_instrument_profile_enriched_at/migration.sql`
- **Acceptance**: `npx prisma validate` clean; `npx prisma migrate deploy` applied cleanly (9 migrations found, all applied); `npx prisma generate` regenerated the client with the new field.
- **Spec refs**: FR-17 (new)
- **Prereqs**: T-68

#### [x] T-70: `enrichUnusedEquityProfiles` — capped drip wired into `yahoo-catalog.ts`
- **What**: New exported function selecting `STOCK_AR`/`CEDEAR` rows with `profileEnrichedAt IS NULL`, excluding held instruments (passed in as `heldInstrumentIds`), planning via T-68's pure module, and fetching profile fields ONLY (name/sector/industry/website — never price data, never `PriceCache`) through the existing `EnrichmentPatch`/AD-0 discipline. Sets `profileEnrichedAt` on every attempt (success or not) so a Yahoo-less ticker is not retried every run forever. New named constant `EQUITY_PROFILE_DRIP_LIMIT = 30`, independent of `ENRICH_CONCURRENCY`/`ENRICH_BUDGET_MS` (Yahoo has no known daily quota, unlike Docta — this is a deliberate "goteo," not a quota workaround).
- **Files**: `src/lib/market/yahoo-catalog.ts`
- **Acceptance**: `enrichUnusedEquityProfiles` never touches a `BOND_AR`/`LETRA`/`ON` row, never writes `currencyCode`/`settlement`/`baseInstrumentId` (enforced by `EnrichmentPatch`'s type shape, same compile-time guard as T-37), and is capped by `EQUITY_PROFILE_DRIP_LIMIT`.
- **Spec refs**: FR-17 (new)
- **Prereqs**: T-68, T-69

#### [x] T-71: Wire the drip into `catalog-sync.ts` step 8
- **What**: Call `enrichUnusedEquityProfiles(usedIds)` from `syncInstrumentCatalog`'s step 8, after the existing Yahoo (`enrichUsedInstruments`) and Docta (`enrichDoctaHeldInstruments`) enrichment calls, in its own try/catch so a drip failure never fails the sync.
- **Files**: `src/lib/market/catalog-sync.ts`
- **Acceptance**: A drip exception is caught and logged (`console.warn`), never thrown up to the caller.
- **Spec refs**: FR-17 (new)
- **Prereqs**: T-70

#### [x] T-72: Update design.md / spec.md for both scope additions
- **What**: `design.md` — AD-12 rev. 6 (ON's dual Yahoo-currency/Docta-terms treatment, live-verified `MCC3O.BA` ARS / `MCC3D.BA` USD / `MCC3C.BA` USD), AD-14 rev. 6 (confirms `FIXED_INCOME_TYPES` already covered ON in `docta-enrichment.ts`, correctly excluded from `fixed-income-linking.ts`), new AD-15 (capped drip enrichment for unheld equity/CEDEAR profiles). `spec.md` — FR-11 amended (applies to ON exactly as BOND_AR/LETRA), new FR-17 (capped drip requirement), capability-mapping table and §6 acceptance checklist both updated.
- **Files**: `openspec/changes/instrument-universe-providers/design.md`, `openspec/changes/instrument-universe-providers/spec.md`
- **Spec refs**: — (meta-task)

#### [x] T-73: Final quality gates, this batch
- **RESULT: PASS, all four.** `npx tsc --noEmit` → 0 errors. `npm test` → 323/323 passing (13 new since C9's 310, all from `equity-profile-drip-plan.test.ts`), 0 failures. `npx eslint .` → 0 errors, 11 pre-existing warnings (unchanged from C9, none introduced by this batch). `npx next build` → succeeds, 21 routes, same pre-existing unrelated Turbopack NFT-tracing note as C9.
- **Prereqs**: T-67 through T-72
