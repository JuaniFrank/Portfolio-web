# Instrument Universe & Providers — Specification
# Change: instrument-universe-providers

**Type**: New capability (no existing spec to delta against — matches the `spy500-split` precedent per proposal §7; `openspec/specs/` does not exist in this repo)
**Delivery**: single-pr (`size:exception` accepted, proposal §14 — do not chain)
**Date**: 2026-09-15
**Source**: `openspec/changes/instrument-universe-providers/proposal.md` (all 15 sections), `exploration.md` (measured findings, not re-derived here)
**Database strategy (revision, this session)**: the database is disposable — **reset + reseed + reimport**, not an additive migration against live data. This retires the live-migration hazard that previously drove FR-5's two-function design (see FR-5, FR-14) and adds a seed requirement (FR-15). Requirements whose sole purpose was proving a live-migration path safe have been dropped; requirements that protect ongoing runtime behavior (not just a one-time cutover) are kept and now carry an explicit rationale so they are not mistaken for migration leftovers.
**Realigned to `design.md` rev. 4 (this session)**: FR-2 is no longer a price-ratio heuristic — linking is deterministic via Yahoo's currency oracle (equities/CEDEARs/ONs, AD-12) and Docta's ISIN (sovereigns/letras, AD-13); the price ratio is demoted to a MEP/CCL refinement (AD-13b) and can never create a link. FR-4 sources settlement currency from those two paths plus price ordering, not a band check. FR-11 is rebuilt around a verbatim-stored `BondSchedule` (AD-14), with `BondTerms` auto-fill refusing any step-up schedule. FR-14 and FR-16 (new) make the enrichment allowlist and the non-unique `isin` index explicit. NFR-6 (new) records the Yahoo crumb handshake as a functional dependency. Counter-example scenarios asserting `CC`/`Chemours` and `DD`/`DDD` as a false pair — both measured false — are corrected, not merely removed, to prevent their reintroduction as regression tests.

---

## 1. Glossary

| Term | Definition |
|---|---|
| **CatalogInstrument** | The ingestion-time row shape built from a data912 universe before it is persisted as an `Instrument`. |
| **Settlement** | Enum `ARS \| USD \| MEP \| CCL` (non-nullable, default `ARS`) on `Instrument`. `USD` means "settles in USD; MEP vs CCL split not yet determined". |
| **Base instrument** | An `Instrument` with `baseInstrumentId = null`; the ARS-settled root of a ticker family (e.g. `NVDA`). |
| **Settlement variant** | An `Instrument` with `baseInstrumentId` set to its base's id and `settlement ∈ {USD, MEP, CCL}` (e.g. `NVDAD`, `NVDAC`). |
| **Currency oracle** | Yahoo's `meta.currency` per `.BA` symbol (`resolveUniverseCurrencies`). `ARS` ⇒ base candidate; `USD` ⇒ confirmed settlement variant. Authoritative for the 1,687 STOCK_AR/CEDEAR/ON symbols; HTTP 404 for a symbol (all Argentine sovereigns/letras) means Yahoo does not cover it. |
| **ISIN group** | Docta's `isin` field from `GET /bonds/instruments/{TICKER}/`. Tickers sharing an ISIN are one security by definition of the standard — the deterministic membership signal for the 221 BOND_AR/LETRA symbols (FR-2). |
| **Price ordering** | Within an already-confirmed group (by currency oracle or ISIN), the highest price is the ARS listing; of the remaining two the higher is MEP and the lower is CCL, because the CCL rate exceeds the MEP rate. |
| **Price-ratio band** | `price(base) / price(variant)`, checked against that day's CCL/MEP anchors from `ccl-rate.ts`/`dolarapi.ts`. **Demoted, never a link creator**: within a group already confirmed by the currency oracle or ISIN, it only (a) splits MEP from CCL for a group of exactly 2, or (b) vetoes an ordering whose implied rate misses both anchors (§2, FR-2, FR-4). |
| **Unlinked instrument** | A catalog row that neither the currency oracle nor ISIN grouping could confirm against any base. Remains fully searchable and tradable; only the settlement chip is absent. Never withheld. |
| **Identity key** (was: `identityKey()` / `instrumentKey()`) | One shared identity function — `ticker|type|currencyCode|venueCode` — matching the DB's `@@unique([ticker, type, venueCode, currencyCode])` constraint and the existing `instrumentKey()` in `commit-import.ts`. `catalog-sync.ts` MUST reuse it rather than maintain its own. Safe only because currency is immutable after ingestion (FR-14, Currency Immutability). |
| **Empty `BondTerms`** | Precise definition for FR-11: **no `BondTerms` row exists at all** for the instrument. A row that exists with null/blank fields is NOT empty and must be treated as populated (propose, not overwrite). |
| **`BondSchedule`** | A per-instrument row storing Docta's cashflow schedule verbatim (`paymentDate`, `capital`, `interestRate`, `interestAmount`, `residualValue`, `cashFlow`), read by the bonds UI in preference to `BondTerms` + `projectCashFlows` derivation (FR-11). |
| **Option B (Docta write policy)** | Auto-fill `BondTerms` from Docta cashflow only when the schedule's `interest_rate` is constant across periods and the gate passes (FR-11); a step-up schedule refuses `BondTerms` entirely and relies solely on `BondSchedule`. Otherwise present a propose-don't-overwrite flow, mirroring `fetchArgenBondProposal`. |

### Capability mapping (proposal §7)

| Capability | Requirements |
|---|---|
| `instrument-settlement-variants` | FR-1, FR-2, FR-3, FR-4, FR-5, FR-14, FR-16 |
| `currency-aware-valuation` | FR-6, NFR-1 |
| `fixed-income-tradability` | FR-7, FR-8 |
| `instrument-metadata-providers` | FR-9, FR-10, FR-12, FR-13, FR-17 |
| `bond-cashflow-autofill` | FR-11 |
| `corporate-events-seed` (added this revision, not in proposal §7) | FR-15 |

---

## 2. Functional Requirements

### FR-1: Universe Ingestion — Five data912 Endpoints

The system MUST ingest all five data912 universes — `arg_stocks`→STOCK_AR, `arg_cedears`→CEDEAR, `arg_corp`→ON, `arg_bonds`→BOND_AR, `arg_notes`→LETRA — and MUST create an `Instrument` row for every symbol returned, including every settlement variant. The system MUST NOT ingest `usa_stocks`; no row of that origin may exist in the catalog.

The system MUST NOT interpret an empty universe response (all five endpoints returning nothing) as a delisting signal: ingestion MUST leave the existing catalog untouched, log the failure, and return `ok: false`. (Rationale: this guards against a data912 outage being misread as "everything got delisted" — a live-provider integrity concern that exists on every ingestion run, not a one-time migration hazard the reset/reseed/reimport strategy would otherwise remove. The reset changes how the database starts; it does not change how ingestion must behave on the runs that follow.)

### FR-2: Base↔Variant Linking — Deterministic on Two Paths (Currency Oracle + ISIN)

The system MUST establish the base↔variant link deterministically along two disjoint paths, chosen by instrument type:

- For STOCK_AR, CEDEAR, and ON instruments (1,687 symbols: `arg_stocks` 95 + `arg_cedears` 957 + `arg_corp` 635), the system MUST classify each `.BA` symbol's membership using Yahoo's `meta.currency`: `ARS` designates a base candidate, `USD` designates a confirmed settlement variant. This holds because BYMA's main board quotes in ARS, so a `.BA` symbol quoting in USD is, by that fact alone, a settlement variant.
- For BOND_AR and LETRA instruments (221 symbols: `arg_bonds` 198 + `arg_notes` 23), the system MUST establish the link by grouping instruments that share the same Docta-sourced `isin` (`GET /bonds/instruments/{TICKER}`, no trailing slash — measured against the live service, §16) — same ISIN means same security by definition of the standard, and this holds even though Yahoo does not cover these tickers at all.
- The system MUST NOT derive a link from ticker-string pattern matching (suffix, dot-insertion, or rewrite heuristics) on either path, because BYMA's naming is not a reliable predicate: real base tickers end in `C`/`D` (`AMD`, `DD`, `C`, `CRWD`, `ERIC`, `CARC`, `BA`, `TGNO4`), collisions are disambiguated with a dot, and some families rewrite rather than suffix (`YPFD`→`YPFDD`, `TGNO4`→`TGN4D`).
- The price-ratio band check MUST NOT establish or veto group membership on either path (see FR-4); it is a refinement applied only after membership is already confirmed.
- **Docta's ISIN lookup MUST be budget-bounded and held-first, not whole-universe-per-run** (measured 2026-09-16: the account is rate-limited at 10 requests/minute and — decisively — 15 requests/day; the design's earlier "essentially free" cost model for a 221-ticker whole-universe pass was unverified and wrong). The system MUST prioritize fixed-income instruments referenced by at least one `Transaction` ("held") ahead of unheld ones when selecting which tickers get a live Docta lookup in a given run, and MUST cap the number of live lookups per run to a value that leaves headroom under the daily limit for the cashflow endpoint, which draws on the same quota. A ticker's ISIN lookup outcome (a resolved ISIN, or a confirmed "Docta does not serve this ticker") MUST be cached permanently once resolved, so that unresolved tickers are never re-asked on a later run merely because an earlier run's answer was discarded — this makes the backlog a one-time, shrinking ramp rather than a recurring daily cost. A rate-limited response (HTTP 429) MUST NOT be cached (it is not evidence about the ticker) and MUST stop the current run from starting further live lookups, rather than continuing to exhaust the same spent quota on every remaining candidate.

### FR-3: Unmatched Variants Remain Tradable

When neither the currency oracle (STOCK_AR/CEDEAR/ON) nor Docta ISIN grouping (BOND_AR/LETRA) can confirm a link for a candidate instrument, the system MUST still persist it as a fully searchable, tradable catalog row with `baseInstrumentId = null`, and MUST NOT display a settlement chip for it. A later sync MAY establish the link once the missing evidence (a resolved Yahoo currency, or a Docta-served ISIN) becomes available. The system MUST NOT withhold a real instrument from search pending a confirmed link. (Rationale: this protects a real, currently-tradable instrument from disappearing from search on every ingestion run — a ticker Docta does not serve, or serves without an ISIN, still needs to trade, independent of whether the database was just reset.)

### FR-4: Settlement Currency Assignment — Oracle/ISIN Primary, Price Ordering for the Split

The system MUST assign `currencyCode = USD` to every instrument with `settlement ∈ {USD, MEP, CCL}`, and MUST NOT assign `ARS` to a confirmed settlement variant.

- For the 1,687 Yahoo-covered symbols, settlement currency comes from the currency oracle (FR-2): Yahoo `meta.currency = USD` ⇒ `settlement ∈ {USD, MEP, CCL}` (refined below); `meta.currency = ARS` ⇒ `settlement = ARS`.
- For the 221 ISIN-grouped symbols, once a group of 2 or 3 is confirmed by shared ISIN (FR-2), the system MUST assign settlement by descending price within the group: the highest price is `ARS`; of the remaining members, the higher price is `MEP` and the lower is `CCL`, because the CCL rate exceeds the MEP rate and dividing the same ARS value by the larger rate yields the smaller price.
- The price-ratio band MUST be used only to split `MEP` from `CCL` within a confirmed group of exactly 2 (where price ordering alone cannot name which of the two it is), and MUST NEVER be used to establish or veto group membership.
- When a confirmed-USD instrument's `MEP`/`CCL` split cannot be determined this run, the system MUST assign `settlement = USD` (`currencyCode = USD`) rather than guessing or withholding the currency. `resolveCurrencyCode()`'s ARS-fallback guess MUST be removed; currency comes only from the oracle, the ISIN-group price ordering, or the price-ratio refinement above.

### FR-5: Identity Reconciliation Across Sync and Import (simplified — disposable database)

The system MUST use one shared identity function — `ticker|type|currencyCode|venueCode`, matching the DB's `@@unique([ticker, type, venueCode, currencyCode])` constraint and the existing `instrumentKey()` in `commit-import.ts` — for both `catalog-sync.ts`'s create/reactivate/delist reconciliation and `commit-import.ts`'s instrument lookup. `catalog-sync.ts` MUST import this function rather than compute its own.

(Previously: this requirement reconciled two *different* keys — a listing-only key and a row key — specifically to protect a pre-existing row seeded with the wrong currency before this change's fix shipped, so a live catalog would not mass-delist or duplicate on the first sync after deploy. That protection is no longer needed: the database is reset, reseeded and reimported for this change, not migrated against live data, so no row exists whose `currencyCode` was assigned by the old, incorrect logic. Every row from this point forward is created once, by the corrected logic, in a single identity dimension — which is exactly what makes one 4-part key sufficient. This simplification is safe only because of FR-14 (Currency Immutability): without it, a later enrichment write could again split one instrument's identity across two keys even on a database that started clean.)

### FR-6: Currency-Aware Quote Routing

`quotes.ts` (`refreshLatestQuotes`) MUST stop deriving the Yahoo symbol from instrument `type` alone. For an instrument with `currencyCode = USD`, the system MUST resolve its native-currency price and convert to ARS through the CCL/MEP pattern already proven by `valuateOnPositions`/`fetchOnPrices`, rather than requesting a `.BA`-suffixed symbol.

### FR-7: Fixed Income Fully Tradable

The system MUST add `BOND_AR` and `LETRA` to `TRADE_INSTRUMENT_TYPES` (`src/lib/transactions/types.ts`) and to `INSTRUMENT_TYPE_OPTIONS` (`transaction-form-modal.tsx`). The system MUST route any transaction whose instrument has `type ∈ {ON, BOND_AR, LETRA}` through fixed-income valuation (`toBondTrade`/`valuateOnPositions`), and MUST NOT route it through the equity path (`buildHoldings` + `refreshLatestQuotes`), including for transactions imported before this change.

### FR-8: Search Results Carry Settlement

`searchInstrumentsAction`'s returned shape MUST include the instrument's `settlement` (`ARS`, `USD`, `MEP`, or `CCL`; no chip is rendered for `ARS`) so the UI can render a USD/MEP/CCL chip. Results for a ticker family MUST be returned as flat, independent rows — the system MUST NOT group or nest variants under their base. Within a ticker family, the ARS row MUST sort first, ahead of strict alphabetical ordering.

### FR-9: Yahoo Metadata Provider

The system MUST resolve equity/CEDEAR metadata (name, ISIN, sector, industry) through a Python function running on Vercel via file-based `/api/*.py` (yfinance, Python 3.12, dependencies from `requirements.txt`), replacing both the Finnhub path and the `execFile("python", ...)` caller in `yahoo-catalog.ts`. The system MUST fetch metadata only for instruments referenced by at least one user `Transaction` (via `enrichUsedInstruments`, scoped to `prisma.transaction.findMany({ distinct: ["instrumentId"] })`), and MUST NOT enrich the full catalog universe.

### FR-10: Docta Metadata Provider

The system MUST mint a Docta OAuth token via `POST /api/v1/auth/token` (`client_credentials`, `DOCTA_CLIENT_ID`/`DOCTA_CLIENT_SECRET`) and cache it in memory for its `expires_in` (24h), and MUST NOT persist the token in `.env` or any durable store. The system MUST fetch bond catalog metadata via `GET /bonds/instruments/{ticker}/` for ON/BOND_AR/LETRA instruments referenced by user transactions, mapping `name`, `isin`, `issuer`, `law`, `sector` onto `Instrument`. The system MUST normalize Docta's mojibake-encoded `name` field (e.g. `Energã­A` → `Energía`) before persisting it, and MUST NOT persist the raw mojibake string.

### FR-11: Bond Cashflow — Stored Schedule Primary, `BondTerms` Refuses Step-Up

Docta's cashflow response is the authoritative per-period schedule. The system MUST persist it verbatim as a `BondSchedule` row (keyed by `instrumentId`, `source = "docta"`), copying `paymentDate`, `capital`, `interestRate`, `interestAmount`, `residualValue`, and `cashFlow` from each period with no derivation — including a stepped `interestRate` sequence, which MUST be preserved exactly, not summarized into one value. The bonds UI MUST read `BondSchedule` when present and MUST fall back to `BondTerms` + `projectCashFlows` only when no `BondSchedule` row exists for the instrument.

**This requirement applies to ON exactly as it does to BOND_AR/LETRA** (confirmed live, 2026-09-16: Yahoo's `quoteSummary` has no bond-term data for ON tickers at all — `assetProfile`/`defaultKeyStatistics`/`bondData` report no fundamentals, `quoteType` reports `"EQUITY"` — so Docta is ON's only source for the manual "Cargar términos" form's auto-fill, `BondTermsInput`). ON's currency/settlement classification remains sourced from Yahoo (FR-2, FR-4) — only its contractual terms come from Docta; the two are independent per instrument.

`BondTerms.couponRate` is a single stored `Decimal`, and `projectCashFlows` derives every coupon as `couponRate × remainingPrincipal / periodsPerYear`. A schedule whose `interest_rate` varies across periods (a step-up bond, verified against `cashflow-AL30.json`: `0.13 → 0.5 → 0.75 → 1.75` across 19 periods) cannot be represented by any single stored rate, and inferring `rateType = FIXED` only when the rate is constant would mislabel a step-up bond as `FLOATING` — marking every projected coupon `assumedRate: true` even though the bond is fixed and fully predetermined, merely stepped. The system MUST THEREFORE REFUSE to create or auto-fill a `BondTerms` row whenever the instrument's Docta cashflow reports a non-constant `interest_rate` across periods; such a bond MUST rely solely on its `BondSchedule`. Every 2020-restructuring sovereign (`AL29`, `AL30`, `AL35`, `AE38`, `GD29`, `GD30`, `GD35`, `GD38`, `GD41`, `GD46`) has this step-up shape.

When an instrument has **no `BondTerms` row at all** (empty, per Glossary) and its Docta cashflow reports a **constant** `interest_rate` across all periods, the system MUST auto-create a `BondTerms` row only when every one of the following holds — otherwise it MUST create no row and instead present the same propose-don't-overwrite flow used for an already-populated row:

- `couponRate` (`interest_rate / 100`, since Docta sends `7.5` and the validator rejects `couponRate > 1`) is within `(0, 1]`.
- `currencyCode` resolves from an explicit token table over the instrument's `name` (`U$S`, `US$`, `USD`, `Dólar`/`Dolar` ⇒ `USD`; a bare `$` is never a match — it is ambiguous in Argentine usage and `Instrument.currencyCode` is a different concept, the row's *settlement* currency, not the bond's denomination).
- `amortizationSchedule` (from the `capital`/`residual_value` series) sums to 100 within `0.01` tolerance.
- `couponFrequencyMonths` (modal gap between consecutive `payment_date`s) resolves to a positive value.
- `issueDate` precedes `maturityDate`.

When the gate passes: `faceValue` MUST be set to `100` unconditionally — it is the schedule's own per-100 basis and is dimensionally neutral through `scaleFlowsToHolding`, so no guess is involved. `rateType` MUST be set to `FIXED` when the instrument name carries no floating-rate marker (`BADLAR`, `TAMAR`, `CER`, `UVA`, `VARIABLE`), or to `FLOATING` when it does. `dayCountConvention` MUST NOT be auto-written; the schema default `ACT/365` applies and stays user-editable.

`BondTerms` plus `projectCashFlows` derivation remains, unchanged, the path for hand-entered bonds. When a `BondTerms` row already exists for the instrument (whether from manual entry or an accepted argen.bond proposal), the system MUST NOT overwrite it and MUST instead present a propose-don't-overwrite flow consistent with `fetchArgenBondProposal`.

### FR-12: Sector Coverage — Real Instrument Data

The system MUST source `sector` from Yahoo for STOCK_AR/CEDEAR instruments and from Docta for ON/BOND_AR/LETRA instruments, replacing reliance on the ~24 hardcoded seed rows in `prisma/seed.ts` as the primary source. A settlement variant MUST NOT store its own copy of `sector`; it MUST resolve sector by reading through its `baseInstrumentId` link. `translateSector`'s type-based buckets (`ETF`, `Renta fija`, `Fondos comunes`, `Cripto`, `Sin clasificar`) MUST remain only as the last-resort fallback when no provider-sourced sector is available, never as the primary source.

### FR-13: Enrichment Failure Isolation

The system MUST make `enrichUsedInstruments` best-effort at both call sites (`catalog-sync.ts` and `commit-import.ts`): a Yahoo or Docta failure MUST NOT fail an otherwise-valid import commit or sync run. The system MUST cap enrichment concurrency rather than issuing one unbounded `Promise.all` entry per instrument. (Rationale: import commits and cron syncs run continuously after the reset — every day, not just once during a cutover — so this isolation protects every future run, not a one-time migration.)

### FR-14: Currency Immutable After Ingestion — Enrichment Patch Is an Explicit Allowlist

Once `Instrument.currencyCode` is set at ingestion — determined by the currency oracle or ISIN-group price ordering (FR-4) — no later process MUST mutate it. The system MUST express every enrichment write (Yahoo metadata, FR-9; Docta metadata, FR-10) as a patch of type `{ name?, isin?, sector?, industry?, issuer?, law?, assetClass?, website? }` and MUST NOT permit that patch to carry `currencyCode`, `settlement`, `baseInstrumentId`, `venueCode`, `ticker`, or `type` — under any circumstance, even when a provider response implies a different currency in free text. Yahoo's currency field, read during enrichment, MUST be discarded rather than written. This is what makes the FR-5 identity simplification safe: a single `ticker|type|currencyCode|venueCode` key is only stable if none of its four components can be rewritten after creation by enrichment.

### FR-15: Seed Loads Known Public Corporate Actions

`prisma/seed.ts` currently creates no `User` row, and `CorporateEvent.createdByUserId` is a non-nullable FK to `User` (`prisma/schema.prisma:519-520`), which blocks seeding a `CorporateEvent` today. The system MUST make `createdByUserId` nullable. This is safe because `@@unique([instrumentId, effectiveDate, eventType])` (line 522) already treats a corporate event as a global fact about the instrument — the creator is audit metadata, not part of the event's identity. The system MUST have `prisma/seed.ts` load the SPY `CEDEAR_RATIO_CHANGE` event currently hardcoded in `RECOMMENDED_EVENTS` (`src/lib/events/recommended.ts`) — effective `2026-06-01`, `numerator = 3`, `denominator = 1` — as a seeded `CorporateEvent` row with `createdByUserId = null`.

### FR-16: `Instrument.isin` Is Populated and Indexed, Never Unique

`Instrument.isin` (`prisma/schema.prisma:267`) is `String?` and nothing in `src/` reads or writes it today. The system MUST populate it from Docta's bond catalog response (`GET /bonds/instruments/{TICKER}/`) for ON/BOND_AR/LETRA instruments. The system MUST add `@@index([isin])` to support ISIN-based grouping (FR-2), and MUST NOT add a unique constraint on `isin`: settlement variants deliberately share an ISIN, and that sharing is the base↔variant link. A unique constraint would make it impossible to persist a base and its variant simultaneously, and the failure would surface at insert time on a reset database, not at review time.

### FR-17: Capped Drip Enrichment for Unheld Equity/CEDEAR Profiles (added 2026-09-16, user-directed scope addition)

The system MUST enrich profile fields (`name`, `sector`, `industry`, `website` — the subset the existing Yahoo metadata function already returns) for `STOCK_AR`/`CEDEAR` instruments that are neither referenced by a transaction (already covered by FR-9's held-instrument enrichment) nor previously attempted, capped at a small fixed number of instruments per `sync-catalog` run (a "drip," not a whole-universe pass). The system MUST record an explicit, permanent per-instrument marker of whether this drip has already been attempted for that instrument, and MUST NOT infer "unenriched" from `name` equaling the ticker (which would false-positive whenever a real ticker's name happens to equal its symbol). This path MUST NOT write to `PriceCache` or `MarketSnapshot`, and MUST NOT enrich `BOND_AR`, `LETRA`, or `ON` instruments (Docta's job, FR-10/FR-11). Every write through this path MUST go through the same `EnrichmentPatch` allowlist and AD-0 currency-immutability discipline as FR-9's held-instrument enrichment (FR-14) — this path has no special exemption from it.

---

## 3. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | The variant currency fix (FR-4, FR-6) MUST ship in the same deployable unit as universe ingestion (FR-1, FR-2). Ingestion MUST NOT be deployed without it — an ingestion-only deploy seeds every variant as ARS and breaks quote routing with no self-correction. |
| NFR-2 | The price-ratio refinement, the currency-oracle classification, the ISIN grouping (all FR-2/FR-4), and the Docta response-mapping module (FR-10, FR-11) MUST be implemented as pure functions and covered by unit tests, per `openspec/config.yaml`'s testing convention. Prisma-backed orchestrators (`catalog-sync.ts`, `commit-import.ts`, server actions) MUST NOT gain new unit tests; risky logic MUST live in the pure modules they call. |
| NFR-3 | At the end of this change, `npx tsc --noEmit` MUST report 0 errors, `npm test` MUST report 0 failures, `npm run lint` MUST be clean, and `npm run build` MUST pass. This includes fixing `provider-routing.test.ts` (`hasUsdUnderlying` is not a field of `ResolvableInstrument`; `resolveMonitoringRouting` always returns an object, so the `.toBeNull()` assertion must be replaced — the `"native"` literal is a valid `MonitoringSeriesKind` and must NOT be changed) and regenerating the Prisma client consumed by `yahoo-catalog.ts`/`market-snapshots.ts`. |
| NFR-4 | The `writeFileSync("instruments-debug.log", ...)` call in `src/app/actions/monitoreo.ts` and any log file it produced MUST be removed. The `usa_stocks` sample file MUST be deleted, not adopted. The `arg_cedear`/`arg_stocks`/`corp` sample JSONs MUST be relocated into a `__fixtures__/` directory, consistent with the existing `src/lib/bonds/__fixtures__/` convention. |
| NFR-6 | The Yahoo cookie+crumb handshake is a **functional dependency**, not an optional optimization. The system MUST perform, in order: `GET https://fc.yahoo.com/` for cookies, then `GET https://query1.finance.yahoo.com/v1/test/getcrumb` with those cookies, then `GET .../v7/finance/quote?symbols=...&crumb=...`. Raw `v7/finance/quote` without this sequence MUST NOT be relied upon (measured to return HTTP 401), and raw `v6` MUST NOT be relied upon either (measured to return HTTP 404). The system MUST use a library (`yfinance`) that performs this handshake internally rather than reimplementing cookie-jar/crumb-lifetime management in Node — every Yahoo currency-oracle (FR-4) and metadata (FR-9) call depends on it. |

### REMOVED: NFR-5 — Fixed-Income Revaluation Correction Notice

(Was: "When a previously imported `BOND_AR`/`LETRA` transaction is revalued through the fixed-income path for the first time (FR-7), the UI MUST surface that the value changed on first corrected render. The change MUST NOT be silent.")

(Reason: single user, disposable data. The requirement existed to protect a live user from an unannounced number change on their real, already-recorded positions. With reset + reseed + reimport, there is no pre-existing live position to silently revalue — every transaction is reimported fresh under the corrected fixed-income routing (FR-7) from the start.)

(Migration: None — FR-7's routing fix still applies to every BOND_AR/LETRA transaction; only the UI notice is dropped.)

---

## 4. Scenarios

#### Scenario FR-1-A: All five endpoints ingest, `usa_stocks` excluded

- GIVEN the data912 endpoints for `arg_stocks` (95 symbols), `arg_cedears` (957 symbols), `arg_corp` (635 symbols), `arg_bonds`, and `arg_notes` are available, and `usa_stocks` is also available
- WHEN catalog ingestion runs
- THEN an `Instrument` row is created for every symbol across the five included universes, mapped to STOCK_AR/CEDEAR/ON/BOND_AR/LETRA respectively
- AND zero rows exist with a `usa_stocks` origin

#### Scenario FR-1-B: Empty universe is treated as provider failure, not a delisting event

- GIVEN all five data912 endpoints fail or return empty during a sync run
- WHEN ingestion evaluates the fetched universe and finds it empty
- THEN the sync returns `ok: false` with an error logged
- AND every existing `Instrument` row remains untouched — none is soft-delisted

#### Scenario FR-2-A: Yahoo currency oracle confirms an equity/CEDEAR variant

- GIVEN `NVDA.BA` reports `meta.currency = ARS` (price 14120) and `NVDAD.BA` reports `meta.currency = USD` (price 9.22)
- WHEN ingestion runs the currency oracle
- THEN `NVDA` is classified as a base candidate and `NVDAD` as a confirmed settlement variant
- AND the base↔variant link (`NVDAD` → `NVDA`) is established with no ticker-string rule involved

#### Scenario FR-2-B: `DD`/`DDD` DO link — corrects a prior measured-false claim

- GIVEN `DD.BA` reports `meta.currency = ARS` (base, DuPont) and `DDD.BA` reports `meta.currency = USD` 26.32, with `DD.BA / DDD.BA` = 1554
- WHEN ingestion evaluates the pair
- THEN `DDD.baseInstrumentId` is set to `DD`'s instrument id and `DDD.currencyCode = USD`
- AND this link is asserted regardless of whether the ratio can separate `MEP` from `CCL` this run — a prior design revision treated this pair as a non-link based on a single stale-day ratio measurement (1461.7) and that assertion is corrected here, not repeated

#### Scenario FR-2-C: `CC` links to Citigroup, not treated as an unrelated ARS listing

- GIVEN `CC.BA` reports `meta.currency = USD` 45.84, and `C.BA` (ARS, Citigroup) / `CC.BA` = 1577
- WHEN ingestion evaluates the pair
- THEN `CC.baseInstrumentId` is set to `C`'s instrument id (Citigroup's CCL variant)
- AND no logic anywhere treats `CC` as Chemours or as an unrelated ARS listing

#### Scenario FR-2-D: Genuine ARS bases are never linked as variants

- GIVEN tickers `AMD`, `DD`, `C`, `CRWD`, `ERIC`, `CARC`, `BA`, `TGNO4` all report `meta.currency = ARS`
- WHEN ingestion runs the currency oracle
- THEN each is classified as a base candidate — none is assigned a non-null `baseInstrumentId`
- AND this exclusion is decided by the currency oracle, not by a price band

#### Scenario FR-2-E: Rewrite-convention pairs link via the currency oracle, not string transformation

- GIVEN `TGNO4.BA` reports `meta.currency = ARS` (3295) and `TGN4D.BA` reports `meta.currency = USD` (2.14), a ticker rewrite rather than a suffix
- WHEN ingestion evaluates the pair
- THEN `TGN4D` links to `TGNO4`, confirmed by the currency oracle across the ticker rewrite, with no ticker-string transformation rule involved

#### Scenario FR-2-F: `AL30`/`AL30D` link deterministically by ISIN where Yahoo is absent

- GIVEN `AL30.BA` returns HTTP 404 from Yahoo (Argentine sovereigns are absent from Yahoo), but Docta's `GET /bonds/instruments/AL30/` and `GET /bonds/instruments/AL30D/` both return `isin = "ARARGE3209S6"`
- WHEN ingestion groups fixed-income instruments by ISIN
- THEN `AL30` and `AL30D` are grouped as one security
- AND the link is established despite Yahoo covering neither ticker

#### Scenario FR-2-G: Known non-variants are not merged by coincidental ticker shape (acceptance check, not an asserted fact)

- GIVEN `TVPA`, `TVPE`, `TVPP`, `TVPY` are PBI-linked coupons differentiated by issue currency (not settlement variants of one another), and `TZXD6`, `TZXD7`, `TZXD8` are CER-adjusted bases whose names merely end in `D`
- WHEN ingestion groups these tickers by their Docta ISIN
- THEN each of the eight tickers is expected to receive a distinct ISIN, producing eight groups of one
- AND this is verified as an acceptance check against real Docta data, not assumed true, because the ISINs for these eight tickers have not been captured — a shared ISIN found at verification time would mean the assumption about the instrument is wrong, not the linking mechanism

#### Scenario FR-2-H: Docta's daily quota is exhausted mid-run — held instruments were already prioritized, the rest defer cleanly

- GIVEN a `sync-catalog` run in which some fixed-income tickers still need a live Docta ISIN lookup, and the account's daily/per-minute request quota is exhausted partway through (measured: HTTP 429 with `x-dailylimit-remaining: 0`)
- WHEN the linking pass encounters the first `429`
- THEN it stops attempting further live lookups for the remainder of that run — it does not continue issuing (and 429-failing) a request for every remaining candidate
- AND every fixed-income ticker referenced by at least one `Transaction` that could be reached before the quota was exhausted was attempted BEFORE any unheld ticker, per the held-first ordering
- AND every ticker not reached this run keeps `isin = null` and remains fully searchable and tradable (FR-3) — the run reports the exhaustion, it does not fail, and does not fabricate a result for the untried tickers
- AND a ticker for which Docta previously returned a definitive 404 is not retried this run or any future run — its outcome was cached permanently, so it never competes with an unresolved ticker for the day's budget again

#### Scenario FR-3-A: Unlinked instrument is still searchable and tradable

- GIVEN a `BOND_AR`/`LETRA` ticker (e.g. `BA7DD`, `XN6D`, or `TVPA`) for which Docta returns no ISIN, or an equity/CEDEAR/ON ticker for which Yahoo returns neither a resolvable currency nor a 404
- WHEN the user searches for it
- THEN it appears in results with `baseInstrumentId = null` and no settlement chip
- AND the user can still select it and record a transaction against it

#### Scenario FR-4-A: Settlement variant is seeded as USD, not ARS

- GIVEN `NVDAD` has been linked with `settlement = MEP`
- WHEN catalog-sync persists the row
- THEN `Instrument.currencyCode = "USD"`, not `"ARS"`

#### Scenario FR-4-B: Price ordering assigns MEP vs CCL within a confirmed group

- GIVEN `NVDA`/`NVDAC`/`NVDAD` form a currency-oracle-confirmed group with prices `NVDA` ARS 14120, `NVDAC` USD 8.87, `NVDAD` USD 9.22
- WHEN ingestion applies price ordering within the group
- THEN `NVDAD` (the higher of the two USD prices) is assigned `MEP` and `NVDAC` (the lower) is assigned `CCL`, because the CCL rate exceeds the MEP rate
- AND the same ordering — ground-truthed against Yahoo's independent currency verdict — also holds for `BAC` (`CCL`, 8.76) being lower-priced than `BAD` (`MEP`, 9.16)

#### Scenario FR-5-A: One shared identity function drives both reconciliation and import lookup

- GIVEN `catalog-sync.ts`'s create/reactivate/delist reconciliation and `commit-import.ts`'s `resolveInstrumentsBatch` both need to identify the instrument `NVDAD | CEDEAR | USD | BYMA`
- WHEN either module computes its identity key
- THEN both produce the exact same string, because both call the one function exported from a shared module
- AND no second, independently-maintained key exists anywhere in the codebase

#### Scenario FR-5-B: A freshly ingested variant never needs currency reconciliation against an older row

- GIVEN a database that was just reset, reseeded and reimported
- WHEN `catalog-sync.ts` ingests `NVDAD` for the first time under this change
- THEN `NVDAD`'s row is created once with `currencyCode = USD` (FR-4) via the shared identity function
- AND there is no pre-existing `NVDAD` row with a different `currencyCode` to reconcile against, because none was ever created by pre-fix logic

#### Scenario FR-6-A: USD variant quote routes correctly and converts via CCL/MEP

- GIVEN `NVDAD` has `currencyCode = "USD"` and `settlement = MEP`, quoting USD 9.46
- WHEN `refreshLatestQuotes` resolves its price
- THEN it does NOT request a `NVDAD.BA` symbol
- AND it converts through the applicable rate, producing an ARS market value of `9.46 × MEP_rate`, consistent with the `valuateOnPositions` pattern already used for ONs

#### Scenario FR-7-A: `BOND_AR` and `LETRA` are searchable and manually enterable

- GIVEN the catalog contains `BOND_AR` instrument `MCC3O` (already ingested by `catalog-sync.ts`)
- WHEN the user searches "MCC3O" in the transaction form
- THEN it appears in results (today it is excluded because `TRADE_INSTRUMENT_TYPES` omits `BOND_AR`)
- AND the instrument type dropdown offers `BOND_AR` and `LETRA` as selectable options

#### Scenario FR-7-B: Previously imported `BOND_AR` row revalues through the fixed-income path

- GIVEN a `Transaction` row already imported with `instrument.type = BOND_AR`
- WHEN `getTransactionsPageDataAction` builds holdings
- THEN it routes through `toBondTrade`/`valuateOnPositions`
- AND it is NOT processed by the equity path (`buildHoldings` + `refreshLatestQuotes`)

#### Scenario FR-8-A: `NVDA` search returns three flat, chipped rows, ARS first

- GIVEN the catalog holds `NVDA` (base, ARS), `NVDAC` (CCL variant), `NVDAD` (MEP variant)
- WHEN the user searches "NVDA"
- THEN three independent rows are returned, none nested under another
- AND each row carries its settlement (`ARS`, `CCL`, `MEP` respectively; no chip renders for `ARS`)
- AND `NVDA` (ARS) sorts first, ahead of `NVDAC`/`NVDAD`

#### Scenario FR-9-A: Yahoo metadata resolves on Vercel with no `execFile`

- GIVEN a deployed preview build with `/api/*.py` present
- WHEN a metadata request runs for a STOCK_AR/CEDEAR instrument referenced by a transaction
- THEN the Python function (yfinance, Python 3.12) responds
- AND no `execFile("python", ...)` call occurs anywhere in the request path

#### Scenario FR-9-B: Enrichment scope is transaction-referenced instruments only

- GIVEN the catalog holds close to 1,700 rows but only a small subset is ever referenced by a `Transaction`
- WHEN `enrichUsedInstruments` runs
- THEN only the distinct `instrumentId`s returned by `prisma.transaction.findMany({ distinct: ["instrumentId"] })` are enriched

#### Scenario FR-10-A: Docta token is minted once and cached for 24h

- GIVEN no cached Docta token exists
- WHEN the client needs to call `/bonds/instruments/{ticker}/` for the first time
- THEN it POSTs `/api/v1/auth/token` with `client_credentials`, receives `access_token` with `expires_in = 86400`
- AND subsequent calls within 24h reuse the cached token without minting a new one
- AND the token is never written to `.env`

#### Scenario FR-10-B: Docta bond catalog metadata maps onto `Instrument`, mojibake corrected

- GIVEN the `instruments-MCC3O.json` fixture returns `name: "Pecom Servicios Energã­A S.A.U. 2030 U$S 7.50% (MCC3O)"`, `issuer: "Pecom Servicios Energã­A S.A.U."`, `law: "Ley Argentina"`, `sector: "Oil & Gas"`, `isin: "AR0922852063"`
- WHEN the mapping module processes this response
- THEN `Instrument.name` and `Instrument` issuer field persist as `"Pecom Servicios Energía S.A.U. 2030 U$S 7.50% (MCC3O)"` and `"Pecom Servicios Energía S.A.U."` (mojibake corrected)
- AND `isin`, `law`, and `sector` persist unchanged

#### Scenario FR-11-A: A step-up sovereign's schedule is stored verbatim and `BondTerms` is refused

- GIVEN instrument `AL30`'s `cashflow-AL30.json` fixture reports `interest_rate` stepping `0.13 → 0.5 → 0.75 → 1.75` across its 19 periods
- WHEN the Docta cashflow is mapped
- THEN a `BondSchedule` row is created holding all 19 periods, and its `interestRate` sequence preserves all four distinct values verbatim, unrounded to a single rate
- AND the mapping MUST NOT create or auto-fill a `BondTerms` row for `AL30`
- AND no `rateType = FLOATING` mislabeling occurs, because the bond never reaches the `BondTerms` derivation path

#### Scenario FR-11-B: A constant-rate bond (`MCC3O`) gets both a stored schedule and an auto-filled `BondTerms` row

- GIVEN instrument `MCC3O` has **no `BondTerms` row at all**, and its `cashflow-MCC3O.json` fixture reports `interest_rate: 7.5` constant across all 8 semi-annual payments, with a name containing `"U$S 7.50%"`
- WHEN the Docta cashflow is mapped
- THEN a `BondSchedule` row is created holding all 8 periods verbatim
- AND a `BondTerms` row is auto-created with `couponRate = 0.075` (`7.5 / 100`), `issueDate = 2026-05-11`, `maturityDate = 2030-05-13`, `couponFrequencyMonths = 6`, `currencyCode = USD` (resolved from the `U$S` token, not copied from `Instrument.currencyCode`), `rateType = FIXED` (no floating-rate marker in the name), `faceValue = 100`, and an `amortizationSchedule` summing to 100
- AND `dayCountConvention` is NOT written into this row — the schema default `ACT/365` applies

#### Scenario FR-11-C: A name with no currency token blocks `BondTerms` auto-fill entirely

- GIVEN a hypothetical cashflow with a constant `interest_rate`, whose instrument name carries no recognized currency token (no `U$S`/`US$`/`USD`/`Dólar`, and a bare `$` is never a match)
- WHEN the auto-fill gate evaluates the fields
- THEN no `BondTerms` row is created
- AND the fields are instead presented through the same propose-don't-overwrite flow used for an already-populated row

#### Scenario FR-11-D: Existing `BondTerms` is proposed, not overwritten

- GIVEN instrument `MCC3O` already has a `BondTerms` row (manually entered or argen.bond-accepted)
- WHEN the Docta cashflow is fetched for `MCC3O`
- THEN the system does NOT overwrite the existing row
- AND it presents a proposal the user must explicitly accept, mirroring `fetchArgenBondProposal`

#### Scenario FR-12-A: Yahoo-sourced sector replaces the seed value for a CEDEAR

- GIVEN a CEDEAR instrument previously had no sector (no `underlyingAssetId` match to one of the ~24 seeded rows)
- WHEN Yahoo enrichment runs and returns `sector`/`industry`
- THEN the instrument carries the Yahoo-sourced sector instead of falling into `translateSector`'s `Sin clasificar` bucket

#### Scenario FR-12-B: Docta-sourced sector for fixed income

- GIVEN `MCC3O`'s Docta catalog fixture returns `sector: "Oil & Gas"`
- WHEN enrichment persists it
- THEN `MCC3O` carries `sector = "Oil & Gas"` instead of `translateSector`'s generic `"Renta fija"` bucket

#### Scenario FR-12-C: Settlement variant reads sector through its base link

- GIVEN `NVDAD` is linked to `NVDA` via `baseInstrumentId`, and `NVDA` carries a Yahoo-sourced sector
- WHEN the dashboard resolves `NVDAD`'s sector
- THEN it reads `NVDA`'s sector through the link
- AND `NVDAD` does NOT store its own duplicate `sector` value

#### Scenario FR-13-A: Import commit succeeds despite an enrichment failure

- GIVEN Docta or Yahoo is unreachable during `commit-import.ts`
- WHEN a user commits an otherwise-valid import
- THEN the commit returns `{ ok: true }`
- AND enrichment is treated as best-effort and does not block or fail the commit

#### Scenario FR-14-A: An enrichment response carrying a different currency does not mutate `currencyCode`

- GIVEN `MCC3O` was ingested with `currencyCode = USD` (its settlement's assigned currency, FR-4)
- WHEN Docta's bond catalog metadata response embeds `"U$S 7.50%"` inside its `name` free text (FR-10)
- THEN enrichment writes `name`, `isin`, `issuer`, `law`, `sector` as usual, but leaves `Instrument.currencyCode` untouched at `USD`
- AND no code path in `enrichUsedInstruments` (Yahoo or Docta branch) ever assigns to `currencyCode`, `settlement`, `baseInstrumentId`, `venueCode`, `ticker`, or `type`

#### Scenario FR-15-A: Seed creates the SPY ratio-change event with no user

- GIVEN a freshly reset database with no `User` rows
- WHEN `prisma/seed.ts` runs
- THEN a `CorporateEvent` row exists for the SPY instrument with `eventType = CEDEAR_RATIO_CHANGE`, `effectiveDate = 2026-06-01`, `numerator = 3`, `denominator = 1`, and `createdByUserId = null`
- AND the seed does not fail on the `createdByUserId` foreign key, because the column is now nullable

#### Scenario FR-15-B: A user's own recommendation acceptance still records their id

- GIVEN a user applies the same SPY recommendation surfaced by `resolveApplicableRecommendations`
- WHEN they create their own `CorporateEvent` for it
- THEN `createdByUserId` is set to their user id, exactly as before
- AND making the column nullable only changes the seed path, not the user-facing creation path

#### Scenario FR-16-A: `AL30` and `AL30D` insert together and both persist

- GIVEN Docta reports `isin = "ARARGE3209S6"` for both `AL30` and `AL30D`
- WHEN both instruments are inserted into the catalog in the same sync
- THEN both rows persist with `isin = "ARARGE3209S6"`
- AND no unique-constraint violation occurs on insert, because `isin` carries only `@@index([isin])` and never a unique constraint

#### Scenario NFR-1-A: Ingestion cannot ship without the currency fix

- GIVEN a candidate deploy that ingests data912 variants (FR-1, FR-2) but does not include the USD currency resolution (FR-4) and CCL-aware quote routing (FR-6)
- WHEN evaluated against this spec
- THEN it fails NFR-1 and MUST NOT be merged or deployed standalone

#### Scenario NFR-3-A: Repo baseline is green

- GIVEN the documented baseline of 7 `tsc` errors and 2 test failures (all from `provider-routing.test.ts` and the stale Prisma client consumed by `yahoo-catalog.ts`/`market-snapshots.ts`)
- WHEN this change lands
- THEN `npx tsc --noEmit` reports 0 errors and `npm test` reports 0 failures

#### Scenario NFR-4-A: Debug leak and stale sample files are gone

- GIVEN `writeFileSync("instruments-debug.log", ...)` exists in `monitoreo.ts` and a `usa_stocks` sample JSON exists at the repo root
- WHEN this change lands
- THEN neither the call, the log file, nor the `usa_stocks` sample file exists in the repository
- AND `arg_cedear`/`arg_stocks`/`corp` sample JSONs live under a `__fixtures__/` directory

#### Scenario NFR-6-A: Raw Yahoo quote endpoints fail without the crumb handshake

- GIVEN a request to `v7/finance/quote` with no prior cookie/crumb handshake
- WHEN the request is sent
- THEN it returns HTTP 401 (and `v6/finance/quote` returns HTTP 404), demonstrating the handshake is required, not optional
- AND the implementation performs `GET https://fc.yahoo.com/` → `GET .../v1/test/getcrumb` → `GET v7/finance/quote?...&crumb=...` in that order before any batched currency or metadata call

---

## 5. Out of Scope

- The `usa_stocks` data912 universe (excluded, not adopted).
- Docta's `stocks:read`/`cedears:read`/`fci:read` scopes and any FCI support; equities stay on Yahoo by decision.
- Docta as a live price source — only catalog metadata and cashflow endpoints are used.
- Backfilling base↔variant links for pre-existing rows beyond what ingestion naturally re-links; no separate historical migration script.
- A grouped/collapsed search UI for variants (decided against: flat rows + chip).
- Retroactive re-valuation of positions recorded against a variant before this change; correct on next read, no historical rewrite.
- New unit tests for Prisma-backed orchestrators (`catalog-sync.ts`, `commit-import.ts`, server actions).
- Vercel Services restructuring — file-based `/api/*.py` only.
- A queue/worker for enrichment — best-effort + concurrency cap only.

---

## 6. Acceptance Checklist (used by sdd-verify)

- [ ] **FR-1**: All five data912 universes ingest into the catalog; `usa_stocks` is absent; an empty universe response leaves the existing catalog untouched and returns `ok: false`.
- [ ] **FR-2**: Base↔variant links are established deterministically — Yahoo `meta.currency` for the 1,687 equities/CEDEARs/ONs, Docta ISIN grouping for the 221 sovereigns/letras; `DD`/`DDD` and `CC`/`C` DO link (corrected); `AMD`/`DD`/`C`/`CRWD`/`ERIC`/`CARC`/`BA`/`TGNO4` remain bases; `AL30`/`AL30D` group by ISIN despite Yahoo's 404; `TVPA`/`TVPE`/`TVPP`/`TVPY` and `TZXD6`/`TZXD7`/`TZXD8` verify as eight distinct-ISIN groups; no ticker-string rule decides any link; the price ratio never establishes membership; the Docta ISIN lookup is held-first and budget-bounded per run (measured: 15 requests/day, 10/minute), stops cleanly on the first rate-limited response instead of exhausting every remaining candidate, and caches a confirmed 404 permanently alongside a success.
- [ ] **FR-3**: An unmatched candidate (no Yahoo currency and no Docta ISIN) is still searchable/tradable, with no settlement chip.
- [ ] **FR-4**: Every settlement variant has `currencyCode = USD`; MEP/CCL split within a confirmed group follows descending price ordering (highest = ARS, then MEP, then CCL), ratio used only as the 2-member tiebreaker.
- [ ] **FR-5**: `catalog-sync.ts` and `commit-import.ts` share one identity function (`ticker|type|currencyCode|venueCode`); no second, independently-maintained key exists.
- [ ] **FR-6**: `quotes.ts` resolves USD-variant prices without a `.BA` suffix and converts via CCL/MEP.
- [ ] **FR-7**: `BOND_AR`/`LETRA` are searchable, manually enterable, and previously imported rows value through the fixed-income path.
- [ ] **FR-8**: Search returns flat settlement-chipped rows (ARS/USD/MEP/CCL) with ARS sorting first.
- [ ] **FR-9**: Yahoo metadata resolves via `/api/*.py` on Vercel with no `execFile`; enrichment covers only transaction-referenced instruments.
- [ ] **FR-10**: Docta token mint/cache works; bond catalog metadata maps to `Instrument`; mojibake names are normalized.
- [ ] **FR-11**: Docta's cashflow is stored verbatim as `BondSchedule`; a step-up schedule (`AL30`, and every 2020-restructuring sovereign) REFUSES `BondTerms` auto-fill; a constant-rate schedule (`MCC3O`) auto-fills `BondTerms` only when `currencyCode` resolves from a name token, `faceValue = 100` unconditionally, `dayCountConvention` never auto-written; existing `BondTerms` is proposed, not overwritten.
- [ ] **FR-12**: Sector is provider-sourced for equities/CEDEARs (Yahoo) and fixed income (Docta); variants read sector via `baseInstrumentId`; `translateSector` is last-resort only.
- [ ] **FR-13**: A Docta/Yahoo failure never fails an import commit; enrichment is concurrency-capped.
- [ ] **FR-14**: The enrichment patch type carries only `{ name?, isin?, sector?, industry?, issuer?, law?, assetClass?, website? }`; `currencyCode`, `settlement`, `baseInstrumentId`, `venueCode`, `ticker`, `type` are never mutated by Yahoo or Docta enrichment after ingestion, regardless of what the provider response implies.
- [ ] **FR-15**: `createdByUserId` on `CorporateEvent` is nullable; `prisma/seed.ts` loads the SPY `CEDEAR_RATIO_CHANGE` (2026-06-01, 3:1) with `createdByUserId = null`.
- [ ] **FR-16**: `Instrument.isin` is populated from Docta for fixed income, carries `@@index([isin])`, and never a unique constraint; `AL30` and `AL30D` insert together with the same ISIN and both persist.
- [ ] **FR-17**: Unheld `STOCK_AR`/`CEDEAR` profiles drip-enrich, capped per run, excluding held instruments and previously-attempted ones (via an explicit marker, not `name === ticker`); never writes `PriceCache`/`MarketSnapshot`; never touches `BOND_AR`/`LETRA`/`ON`; every write goes through `EnrichmentPatch`.
- [ ] **NFR-1**: Currency fix and ingestion ship together, never ingestion-only.
- [ ] **NFR-2**: Currency-oracle classification, ISIN grouping, the price-ratio refinement, and Docta mapping are pure, unit-tested modules; no new tests on Prisma orchestrators.
- [ ] **NFR-3**: `npx tsc --noEmit` → 0 errors; `npm test` → 0 failures; `npm run lint` clean; `npm run build` passes.
- [ ] **NFR-4**: `instruments-debug.log` writer and the `usa_stocks` sample are gone; fixtures relocated to `__fixtures__/`.
- [ ] ~~**NFR-5**~~ Removed this revision — see REMOVED section (§3).
- [ ] **NFR-6**: The Yahoo cookie+crumb handshake (`fc.yahoo.com` → `getcrumb` → `v7/finance/quote`) runs before every batched currency/metadata call; raw `v7`/`v6` calls without it are not relied upon.
