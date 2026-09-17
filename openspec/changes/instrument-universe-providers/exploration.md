# Exploration: instrument-universe-providers — Full BYMA universe with settlement variants + Yahoo/Docta metadata providers

## Scope

Three legs, delivered as one change:

1. **Universe with settlement variants.** Ingest all five data912 BYMA universes (`arg_stocks`→STOCK_AR, `arg_cedears`→CEDEAR, `arg_corp`→ON, `arg_bonds`→BOND_AR, `arg_notes`→LETRA). Every symbol — including CCL/MEP settlement variants such as `NVDAC`/`NVDAD` — must exist in the catalog so users can record transactions against them, without duplicating metadata across a base and its variants.
2. **Yahoo/yfinance metadata provider running as Python on Vercel.** Replaces the Finnhub path for STOCK_AR and CEDEAR. Metadata is fetched only for instruments actually referenced by user transactions, never for the whole universe.
3. **Docta Capital provider for fixed income** (ON, BOND_AR, LETRA), via `client_credentials` token mint plus a per-instrument bond endpoint.

## Established findings (measured, not inferred)

Measured against the real data912 payloads captured at the repo root (`data912com-live-arg_cedear.json` 957 symbols, `data912com-live-arg_stocks.json` 95, `data912com-live-corp.json` 635).

### The base↔variant relation cannot be derived from the ticker string

Counter-evidence that disqualifies any suffix rule:

- Real base tickers that end in C or D: `AMD`, `DD`, `CRWD`, `ERIC`, `C` (Citigroup), `CC` (Chemours), `CARC` (Carboclor).
- BYMA inserts a dot on collision: Boeing is `BA`/`BAC`/`BAD`, while Bank of America is `BA.C`/`BA.CC`/`BA.CD`.
- `YPFD` is YPF's real base ticker; its MEP variant is `YPFDD`.
- Argentine stocks rewrite rather than suffix: `TGNO4`→`TGN4D`, `TGSU2`→`TGSUD`, `TECO2`→`TECOD`.
- ONs use a third convention: `AEC3O` (ARS) / `AEC3D` (MEP) / `AEC3C` (CCL).

### Variant coverage is uneven

| Universe | Both C and D | Only D | Neither |
|---|---|---|---|
| CEDEARs | 217 bases | 81 bases | 64 bases |
| Argentine stocks | 0 (C never exists) | 19 of 69 bases | 50 bases |
| ONs (`…O` bases) | 91 | 155 | 34 |

### The price ratio is a reliable discovery signal

`price(base) / price(variant)` lands in a tight band equal to that day's CCL (measured 1556–1583) or MEP (1502–1534), consistent across all instruments. False pairs fall outside the band: `DD`/`DDD` (DuPont vs 3D Systems) gives 1461.7, `CAR`/`CAR.C` gives 66077. Independent rate anchors already exist in `src/lib/market/ccl-rate.ts` and `src/lib/market/dolarapi.ts`, so the check is not self-referential.

### Variants quote in USD, not ARS

`NVDA` trades at 14330 (ARS) while `NVDAD` trades at 9.46 (USD). `resolveCurrencyCode()` in `catalog-sync.ts` assigns ARS to every non-STOCK_US instrument, so every variant would be seeded with the wrong currency.

### Vercel can run Python

File-based `/api/*.py` functions are supported. A Python framework preset would take precedence over them, but this project's preset is Next.js (JS), so there is no conflict. Bundle limit is 500 MB uncompressed (yfinance + pandas + numpy ≈ 150 MB). Python 3.12 is the default; dependencies come from `requirements.txt`. The alternative is Vercel Services (`services` key in `vercel.json`), the officially blessed path for Python alongside another framework, but it requires restructuring the repo into per-service roots and a Services account permission.

## Current State

### Catalog ingestion (uncommitted WIP already in the tree)

- `src/lib/market/data912-universe.ts` already wires all five endpoints; `usa_stocks` stays commented out. `CatalogInstrument` is reduced to `{ ticker, type }` — `currencyCode` and `venueCode` are commented out of the type itself, so the WIP has not modeled per-variant currency yet.
- `stripCurrencyVariants()` exists but its call site is commented out (`data912-universe.ts:64`), so variants already flow into the catalog today. This matches the requirement, but **no base↔variant link is captured anywhere**; every variant becomes an independent, unlinked `Instrument` row.
- `src/lib/market/catalog-sync.ts` `CATALOG_TYPES` already includes all five types.

### The `identityKey()` defect

```ts
return `${i.ticker}|${i.type} ?? ""}`;
```

Only `${i.type}` interpolates; everything after is literal text appended identically to every row. The function is therefore not corrupting ticker/type distinctness — both DB-side and universe-side keys get the same constant suffix, so relative equality is preserved. What it actually does is silently collapse identity to `ticker|type`, ignoring `currencyCode` and `venueCode` entirely, even though the commented-out fields suggest that was the intent and the DB's own `@@unique([ticker, type, venueCode, currencyCode])` is stricter.

Today this is harmless by coincidence: one row is ever created per ticker+type, venue is always `BYMA`, and currency is decided once at creation. It becomes a real risk the moment Leg 2 mutates a variant's `currencyCode` post-creation (ARS→USD) — the create/reactivate/delist reconciliation would not reflect that dimension at all.

It is also inconsistent with `instrumentKey()` in `src/lib/importers/commit-import.ts`, which **does** include `currencyCode` and `venueCode`. Two identity functions for the same entity, disagreeing on what identity means.

### Consumer blast radius

- `src/lib/transactions/types.ts:4` — `TRADE_INSTRUMENT_TYPES = ["STOCK_AR", "CEDEAR", "ON"]` gates three things at once: `searchInstrumentsAction` (autocomplete), `getDashboardPageDataAction`, and `getTransactionsPageDataAction`. **BOND_AR and LETRA are excluded from all three**, even though `catalog-sync.ts` already ingests them. This is a pre-existing gap, but Leg 3 is pointless for BOND_AR/LETRA until the list is extended, since there is no UI path to search, hold, or value them.
- `src/components/transactions/transaction-form-modal.tsx` — `INSTRUMENT_TYPE_OPTIONS` hardcodes only CEDEAR / STOCK_AR / ON. BOND_AR and LETRA cannot be manually entered, even though `newTransactionInputSchema` (`z.nativeEnum(InstrumentType)`) would accept them. Only the importer can currently create those transactions.
- `getTransactionsPageDataAction` special-cases `r.instrument.type === "ON"` to route into bond valuation (`toBondTrade`/`valuateOnPositions` → `src/lib/bonds/portfolio-bridge.ts`). Already-imported BOND_AR/LETRA rows are not `ON`, so they fall into the generic equity branch (`tradesForHoldings` → `buildHoldings` + `refreshLatestQuotes`), which has no fixed-income PPP or quote handling. **Latent pre-existing bug, squarely in this change's scope.**
- Search flood risk is real but uneven. `searchInstrumentsAction` matches `contains` on ticker/name, `take 10`, `orderBy ticker asc`, and the returned shape (`ticker/name/type/currencyCode`) has no way to flag "this is a settlement variant." The dot convention (`BA`/`BA.C`/`BA.CD`) puts variants alphabetically adjacent to their base and can crowd a 10-row window; the rewrite convention (`TGNO4`→`TGN4D`) does not. The flood is inconsistent across instruments, so it needs a UI affordance, not just a larger limit.

### Valuation path — where a USD variant breaks

- `src/lib/market/quotes.ts` (`refreshLatestQuotes`) has **zero** currency awareness. It builds a Yahoo symbol purely from `ARGENTINIAN_TYPES.has(type)` (CEDEAR/STOCK_AR/BOND_AR/LETRA/ON get a `.BA` suffix, everything else stays bare) and writes whatever price Yahoo returns straight into `PriceCache`, with no FX step. `NVDAD` inherits `type: CEDEAR`, so this would request `NVDAD.BA` — almost certainly the wrong or non-existent symbol, or a stale ARS price if it happens to resolve. This is the sharpest break point.
- Nothing downstream has currency logic: `buildHoldings` and `valuatePortfolioAt` consume `priceMap: Map<instrumentId, string>` as pure ARS.
- The multi-currency handling that does exist lives in `src/lib/market/provider-routing.ts` (`resolveMonitoringRouting`), used only by `/monitoreo`. It already branches on type/currencyCode/underlyingAsset and returns an explicit `currency: "ARS" | "USD"`. Right shape to imitate; not wired into `quotes.ts`.
- The only existing native-currency→ARS conversion via CCL is the ON branch (`valuateOnPositions`/`fetchOnPrices`, fed `cclRate` by the caller), confirming the rate modules are already wired for exactly this purpose.

### Data model context

- `Instrument.underlyingAssetId → UnderlyingAsset` models a **different** relation: "this Instrument is a claim on this real-world asset" (a CEDEAR → the US-listed company, as a descriptive dictionary row with ticker/name/type/sector/country/isin and no price, venue, or currency of its own). Reusing it for base↔variant would conflate two concepts and break existing CEDEAR semantics.
- `@@unique([ticker, type, venueCode, currencyCode])` already treats each variant as its own row, since tickers differ. No option below conflicts with it.

### BondTerms vs Docta

- `BondTerms` already models contractual terms precisely: `faceValue`, `currencyCode`, `rateType`, `couponRate`, `couponFrequencyMonths`, `issueDate`, `maturityDate`, `amortizationSchedule` (JSON), `dayCountConvention`.
- It is populated **only** by manual entry (`upsertBondTermsAction`), optionally pre-filled by the already-shipped, user-triggered argen.bond scraper (`fetchArgenBondProposal` in `src/lib/bonds/argen-bond-scraper.ts`) — a propose-don't-overwrite flow, not cron-driven.
- **Docta's response shape is now VERIFIED** from real captured responses (fixtures at `src/lib/market/__fixtures__/docta/`). It is **three** endpoints with distinct purposes, not one:

  1. `POST /api/v1/auth/token` with `{grant_type: "client_credentials", client_id, client_secret}` returns `{access_token, token_type: "bearer", expires_in: 86400, scope, plan}`. The token lasts 24h, so it must be minted at runtime and cached — never stored in `.env`. The granted scope is `bonds:read cedears:read fci:read stocks:read`, i.e. Docta could also serve equities and FCI, but this change deliberately routes equities through Yahoo.
  2. `GET /api/v1/bonds/instruments/{TICKER}/` returns **catalog metadata**, not prices: `{data: [{ticker, name, asset_class, sub_asset_class, sector, issuer, law, isin}], metadata: {total_records}}`. This is the fixed-income analogue of the Yahoo enrichment path — it maps onto `Instrument.name` and `Instrument.isin`, plus new fields (`issuer`, `law`, `sector`, `asset_class`/`sub_asset_class`) with no current home in the schema. Note `name` arrives mojibake-encoded (`Energã­A` for `Energía`), so the client needs an encoding fix or a normalization step.
  3. `GET /api/v1/bonds/analytics/{TICKER}/cashflow?nominal_units=100` returns the **contractual cashflow schedule**: `{ticker, data: [{issue_date, payment_date, capital, interest_rate, interest_amount, residual_value, cash_flow, adj_interest_amount, adj_capital}], metadata: {subasset_class, nominal_units, total_records}}`. This is the piece that maps onto `BondTerms` — `interest_rate` → `couponRate`, `issue_date` → `issueDate`, the final `payment_date` → `maturityDate`, payment spacing → `couponFrequencyMonths`, and the `capital`/`residual_value` columns → `amortizationSchedule`. Per-100-nominal figures align with `BondTerms.faceValue`.

- **Product decision (user, this session):** the cashflow endpoint should auto-fill the cashflow data behind `/bonds → analítica v2`. The existing pure module `src/lib/bonds/cashflows.ts` already has unit tests (`cashflows.test.ts`) and `src/components/bonds/bond-cashflow-table.tsx` already renders it, so Docta feeds an existing, tested surface rather than a new one.
- The overwrite-vs-propose question against the existing argen.bond flow (`fetchArgenBondProposal`, propose-don't-overwrite) is now the **only** open policy question for Leg 3, and it is a UX decision, not a schema blocker.

### Enrichment hook-in

- `enrichUsedInstruments` (`src/lib/market/yahoo-catalog.ts`) is called from two places:
  - `catalog-sync.ts` (cron) — wrapped in try/catch, failure only logs a warning.
  - `commit-import.ts` (import commit) — `await`ed directly and **uncaught** by the inner try, so a metadata-enrichment hiccup currently turns the whole commit into `{ ok: false, error: "No se pudieron resolver los instrumentos del archivo" }`, failing an import of otherwise-valid transactions.
- Both call sites run `Promise.all` with **no concurrency cap** — one subprocess or HTTP round-trip per instrument, fully parallel. For the import path this adds unbounded external latency to a synchronous user-facing request. Leg 3's Docta OAuth mint plus per-instrument bond fetch makes this materially worse.
- `vercel.json` sets no explicit `maxDuration` for `sync-catalog`, so it runs under the plan default.

### Sizing

`enrichUsedInstruments` is scoped to `prisma.transaction.findMany({ distinct: ["instrumentId"] })`, so the cost driver is distinct instruments ever traded, not total transactions. Plausible order of magnitude for this project is tens, not hundreds. **This is inference from code intent, not a measurement** — no DB query was run.

## Affected Areas

- `src/lib/market/data912-universe.ts` — restore currency/venue/base-link fields on `CatalogInstrument`; remove `stripCurrencyVariants` dead code once the keep-variants decision is final.
- `src/lib/market/catalog-sync.ts` — fix `identityKey()`; reconcile its definition of identity with `commit-import.ts`'s `instrumentKey()`; make `resolveCurrencyCode()` variant-aware or supersede it with Leg 2 enrichment.
- `prisma/schema.prisma` — base↔variant relation; `docta` provider convention on `InstrumentProviderSymbol`; possible `MarketSnapshot`/`BondTerms` extension once Docta's shape is known.
- `src/lib/transactions/types.ts` and `src/components/transactions/transaction-form-modal.tsx` — add BOND_AR/LETRA before Leg 3 has any UI consumer.
- `src/app/actions/transactions.ts` — the `type === "ON"` branch must become aware of all three fixed-income types, or an explicit decision to keep them catalog-only.
- `src/lib/market/quotes.ts` — currency-aware routing, reusing the shape of `provider-routing.ts`.
- `src/lib/market/yahoo-catalog.ts` — replaced/wrapped by the Python-on-Vercel adapter. `scripts/yahoo_catalog.py`'s normalization logic is reusable; its `execFile` caller is not.
- `src/lib/importers/commit-import.ts` — decide fire-and-forget vs inline vs queued for enrichment.
- `src/app/actions/monitoreo.ts` — drop the `writeFileSync("instruments-debug.log", ...)` debug leak (import at line 6, call at line 50) and the resulting log file.
- `src/lib/market/provider-routing.test.ts` — rewrite against the real contract. Two assertions are genuinely broken: `hasUsdUnderlying` is not a field of `ResolvableInstrument` (actual fields: `id, ticker, type, currencyCode, underlyingAsset?`), and one case asserts `.toBeNull()` while `resolveMonitoringRouting` always returns a `ProviderResolution`. The `"native"` literal is **correct** — it is a valid `MonitoringSeriesKind` per `src/lib/monitoreo/types.ts:5`.
- New: a Docta client module (token mint + bond fetch) with its own environment variables.

## Approaches — base↔variant data model

### 1. Self-relation on `Instrument` (recommended)

`baseInstrumentId String? @relation("InstrumentVariants", ...)` plus a `settlement` enum (`ARS | MEP | CCL`).

- **Pros:** purely additive migration (nullable FK), no backfill of a synthetic parent id; each variant stays a first-class `Instrument` so all existing FKs (`Transaction.instrumentId`, `BondTerms.instrumentId`) are untouched; the existing unique constraint already guarantees no collision; "all variants of X" is a simple self-join.
- **Cons:** a base has `baseInstrumentId: null`, so distinguishing base from variant requires checking both fields together.
- **Effort:** Medium.

### 2. Separate parent entity (`InstrumentGroup`)

- **Pros:** cleaner conceptually ("one tradable idea, N settlement legs"); no special-cased null-FK row.
- **Cons:** requires a synthetic group id for ~1700 rows including instruments that already carry live transactions; touches both identity functions more invasively; higher migration risk against the live DB for no functional gain at this scale.
- **Effort:** High.

### 3. No explicit link — derive at query time

- **Cons:** contradicts the established finding that the relation cannot be derived from the ticker string, and that the price-ratio band is a *discovery* signal rather than something cheap to recompute per read. Would re-run the band check on every valuation and search call, and make "show all variants of X" an expensive live computation instead of an indexed join. **Disqualifying.**

## Recommendation

**Data model:** Approach 1. Additive, safe against the live DB, and consistent with how `CorporateEvent` and `BondTerms` were already layered onto `Instrument` rather than restructuring it. The link itself must be established at ingestion time using the price-ratio heuristic calibrated against `ccl-rate.ts`/`dolarapi.ts`, never from ticker-string pattern matching.

**Currency handling:** extend the currency-aware branching that already exists in `provider-routing.ts` into the equity valuation path in `quotes.ts`, rather than inventing a second mechanism. Variants resolve `currency: "USD"` and route through the CCL-conversion pattern already proven in the ON branch.

**Docta (Leg 3):** do not commit to `MarketSnapshot` vs `BondTerms` vs both until a real sample response is obtained. The two shapes imply materially different code and materially different UX (silent background pricing vs a user-facing proposal banner like argen.bond's).

**Enrichment hook-in:** make the `commit-import.ts` call best-effort, catching its own errors as `catalog-sync.ts` already does, rather than letting it fail the whole import commit. Consider not awaiting it inline at all.

**Consumer gap:** extend `TRADE_INSTRUMENT_TYPES` and `INSTRUMENT_TYPE_OPTIONS` to include BOND_AR/LETRA, and extend the `type === "ON"` bond-routing check to cover all three fixed-income types, as a prerequisite for Leg 3 to have any user-visible effect.

## Product decisions (collected from the user this session)

1. **Fixed income becomes fully tradable.** Extend `TRADE_INSTRUMENT_TYPES` and `INSTRUMENT_TYPE_OPTIONS` to include BOND_AR and LETRA, and extend the bond valuation routing beyond `type === "ON"` to cover all three fixed-income types. This also closes the latent bug where imported BOND_AR/LETRA rows are valued as equities.
2. **Settlement variants render flat in search, with a currency chip.** `NVDA`, `NVDAC`, and `NVDAD` each appear as independent results, each tagged ARS / MEP / CCL. No grouping, no hiding — the user must see exactly which ticker the transaction is recorded against. `searchInstrumentsAction`'s returned shape must carry the settlement so the UI can render the chip.
3. **Docta is in scope with real sample data.** Environment variables are `DOCTA_CLIENT_ID` and `DOCTA_CLIENT_SECRET`; the base URL stays a module constant, consistent with how `data912.com` and `finnhub.io` are handled today.

## Risks

- **Currency mismatch on variants is a value-corruption risk.** If Leg 1 ships without Leg 2's currency fix, `resolveCurrencyCode()` seeds every new variant as ARS and `quotes.ts` fetches the wrong Yahoo symbol, producing silently wrong holdings the moment a user records a transaction against a variant.
- **Docta's response shape is completely unverified** — the single biggest unknown blocking Leg 3's schema design.
- **`commit-import.ts` can already fail an entire import batch** over an unrelated enrichment error; Legs 2 and 3 make this worse before any code changes for them are written.
- **BOND_AR/LETRA have no valuation path today** even where they already exist in the catalog and in importer-created transactions.
- **Sizing is inference, not measurement** — no DB query tool was available.

## Ready for Proposal

Yes. The Docta blocker is resolved — real responses for all three endpoints are captured as fixtures.

One sequencing constraint remains: **the currency-handling fix for variants must ship before or alongside catalog ingestion, not after.** Shipping Leg 1 alone would seed every variant with a wrong currency by default and mis-value any position recorded against one.

One size warning for the proposal phase: with fixed income now fully tradable, this change spans catalog ingestion, a Prisma migration, a Python runtime on Vercel, two new provider clients, currency-aware quote routing, and transaction/search UI. The session's review budget is 800 lines under a `single-pr` delivery strategy. The tasks phase should expect to exceed that and surface the `size:exception` decision explicitly rather than silently.
