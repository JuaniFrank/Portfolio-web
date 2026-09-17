# Proposal — instrument-universe-providers: Full BYMA universe with settlement variants + Yahoo/Docta metadata providers

**Change name**: `instrument-universe-providers`
**Status**: Proposal
**Artifact store**: openspec
**Delivery strategy**: single-pr (review budget 800 lines — see §9, this change is expected to exceed it)
**Date**: 2026-09-15
**Source**: `openspec/changes/instrument-universe-providers/exploration.md` (findings are measured there; not restated here)

---

## 1. Why

Today the app can only track a fraction of what the user actually holds at their broker.

| What the user wants to do | What happens today |
|---|---|
| Record a purchase of `NVDAD` (NVDA settled in MEP) | The ticker exists in the catalog, but is seeded as ARS and would be priced through `NVDAD.BA`, so the position is silently mis-valued. |
| Search for a sovereign bond or a LETRA | Not returned. `TRADE_INSTRUMENT_TYPES = ["STOCK_AR", "CEDEAR", "ON"]` (`src/lib/transactions/types.ts:4`) gates search, dashboard and transactions at once. |
| Add a BOND_AR or LETRA by hand | Impossible. `INSTRUMENT_TYPE_OPTIONS` offers only CEDEAR / STOCK_AR / ON, even though the zod schema would accept the rest. |
| See a BOND_AR they already imported valued correctly | It is valued through the **equity** path. `getTransactionsPageDataAction` routes to fixed-income valuation only on `type === "ON"`, so imported BOND_AR/LETRA rows get equity PPP and equity quotes. **Latent, already-shipped bug.** |
| See the coupon schedule of a bond in `/bonds → analítica v2` | Only if they type the whole schedule by hand, or scrape argen.bond and accept the proposal. |
| Get name/ISIN/sector metadata for instruments | Via Finnhub, which does not cover the Argentine fixed-income universe at all, and via an `execFile("python", ...)` call that cannot run on Vercel. |

The common root cause: the catalog is a partial, single-currency, metadata-poor view of BYMA. This change makes the catalog match the market the user actually trades in, and gives each asset family a provider that actually knows about it.

## 2. What changes

After this change the user can:

- **Search and hold every BYMA instrument** from the five data912 universes: Argentine stocks, CEDEARs, ONs, sovereign bonds and LETRAs.
- **Search settlement variants flat.** `NVDA`, `NVDAC` and `NVDAD` each appear as their own result, each carrying a visible **ARS / MEP / CCL** chip. No grouping, no hiding — the user sees exactly which ticker the transaction is recorded against.
- **See USD-settled variants valued correctly**, converted to ARS through the CCL path already proven in the ON branch — instead of an ARS price stamped on a USD instrument.
- **Add, hold and value fixed income end to end**: BOND_AR and LETRA become first-class tradable types with fixed-income valuation, not equity valuation.
- **See the contractual cashflow schedule auto-filled** in `/bonds → analítica v2`, fed by Docta instead of manual entry.
- **Get richer instrument metadata**: equities/CEDEARs from Yahoo (yfinance, running as a Python function on Vercel), fixed income from Docta (name, ISIN, issuer, law, sector).

## 3. Non-goals

Explicitly **not** in this change:

- **`usa_stocks`.** That data912 universe stays excluded; the sample file at the repo root is deleted, not adopted.
- **Docta's `stocks:read`, `cedears:read`, `fci:read` scopes.** The token grants them; equities stay on Yahoo by decision. No FCI support.
- **Docta as a price source.** Only the catalog-metadata and cashflow endpoints are used. Live pricing stays on the existing routing.
- **Backfilling base↔variant links for pre-existing rows beyond what ingestion naturally re-links.** The heuristic runs at ingestion; no separate historical migration script.
- **A grouped/collapsed search UI** for variants (decided against: flat + chip).
- **Retroactive re-valuation of positions already recorded against a variant** before this change. They become correct on the next read once currency is right; no historical rewrite.
- **New unit tests for Prisma-backed orchestrators** (`catalog-sync.ts`, `commit-import.ts`, server actions), per `openspec/config.yaml`. Risky logic moves into pure modules that *are* tested.
- **Vercel Services restructuring.** File-based `/api/*.py` is used; the `services` key is not.
- **A queue/worker for enrichment.** Best-effort + concurrency cap only.

## 4. Approach — per leg

Full rationale and counter-evidence live in the exploration; this is the decision record.

### Leg 1 — Universe with settlement variants

- Ingest all five data912 universes; keep variants (`stripCurrencyVariants` becomes dead code and is removed).
- **Data model: exploration Approach 1** — self-relation on `Instrument` (`baseInstrumentId` nullable FK + a `settlement` enum `ARS | MEP | CCL`). Additive migration, no synthetic parent ids, every existing FK untouched.
- **The link is established at ingestion on two deterministic paths, never by ticker-string pattern matching.** Superseded the original price-ratio heuristic after measurement (see design §R):
  - **Yahoo's `meta.currency` oracle** for the 1,687 symbols of `arg_stocks` + `arg_cedears` + `arg_corp`. BYMA's main board quotes in ARS, so a `.BA` symbol quoting in USD *is* a settlement variant.
  - **Docta's ISIN** for the 221 symbols of `arg_bonds` + `arg_notes`, which Yahoo does not cover. Same ISIN means same security by definition of the standard.
  - The price ratio is **demoted to a refinement** that splits MEP from CCL within an already-confirmed group. It can never create a link.
- Counter-examples that disqualify any suffix rule remain: `AMD`, `CRWD`, `YPFD`/`YPFDD`, `TGNO4`→`TGN4D`, `BA37D`→`BA7DD`, `X30N6`→`XN6D`.
- The matching band check is a **pure module** (inputs: candidate prices + reference rates; output: match or no match) so it is unit-testable under the repo's convention.
- Fix `identityKey()` in `catalog-sync.ts` and reconcile it with `instrumentKey()` in `commit-import.ts` — two identity functions for the same entity currently disagree, and Leg 1 makes a variant's `currencyCode` mutable post-creation, which is exactly the dimension `identityKey()` ignores.

### Leg 2 — Currency-aware valuation

- Extend the currency branching that already exists in `src/lib/market/provider-routing.ts` into `src/lib/market/quotes.ts`, rather than inventing a second mechanism.
- Variants resolve `currency: "USD"` and convert through the CCL pattern already used by `valuateOnPositions`/`fetchOnPrices`.
- `searchInstrumentsAction`'s returned shape gains the settlement so the UI can render the chip.

### Leg 3 — Metadata providers

| Provider | Runtime | Endpoints | Feeds |
|---|---|---|---|
| Yahoo (yfinance) | Python on Vercel, file-based `/api/*.py` + `requirements.txt` | yfinance lookup | `Instrument` name/ISIN/sector for STOCK_AR, CEDEAR — replaces Finnhub |
| Docta Capital | Node, module-constant base URL, `DOCTA_CLIENT_ID` / `DOCTA_CLIENT_SECRET` | `POST /auth/token` (24h, minted at runtime and cached in memory — never in `.env`), `GET /bonds/instruments/{T}/`, `GET /bonds/analytics/{T}/cashflow` | `Instrument` name/ISIN/issuer/law/sector; `BondTerms` + `src/lib/bonds/cashflows.ts` → `/bonds → analítica v2` |

- `scripts/yahoo_catalog.py`'s normalization logic is reused; its `execFile` caller in `yahoo-catalog.ts` is deleted.
- Metadata is fetched **only for instruments referenced by user transactions** (`enrichUsedInstruments`), never for the ~1,700-row universe.
- Docta's `name` arrives mojibake-encoded (`Energã­A` → `Energía`); the client normalizes encoding before persisting.
- Response mapping is a **pure module** tested against the captured fixtures in `src/lib/market/__fixtures__/docta/`.
- `enrichUsedInstruments`'s call from `commit-import.ts` becomes best-effort (self-catching, as `catalog-sync.ts` already is) and gets a concurrency cap. Today an unrelated metadata hiccup fails an otherwise-valid import commit, and two new providers make that strictly worse.

## 5. Sequencing constraint (hard)

**The variant currency fix (Leg 2) must ship before or alongside catalog ingestion (Leg 1) — never after.**

Shipping ingestion alone seeds every variant with ARS via `resolveCurrencyCode()`, and `quotes.ts` then requests `NVDAD.BA`. Any position a user records against a variant in that window is silently mis-valued, and the error is not self-correcting without a currency backfill. If the change is sliced (§9), Leg 1 and Leg 2 belong in the **same** slice.

Leg 3 has no ordering constraint against Legs 1–2, but the fixed-income tradability work (§6, transactions/UI) must land **before or with** Leg 3, or Docta's bond data has no user-visible consumer.

## 6. Impacted surfaces

| Area | Impact | What changes |
|---|---|---|
| `prisma/schema.prisma` + migration | Modified | `baseInstrumentId` self-relation + `settlement` enum on `Instrument`; `docta` provider convention on `InstrumentProviderSymbol` |
| `src/lib/market/data912-universe.ts` | Modified | Restore `currencyCode`/`venueCode`/base-link on `CatalogInstrument`; delete `stripCurrencyVariants` |
| `src/lib/market/catalog-sync.ts` | Modified | Fix `identityKey()`; variant-aware currency resolution; link variants at ingestion |
| New pure module (settlement matching) | New | Price-ratio band check against CCL/MEP reference rates + unit tests |
| `src/lib/market/quotes.ts` | Modified | Currency-aware symbol/price routing; CCL conversion for USD variants |
| `src/lib/transactions/types.ts` | Modified | `TRADE_INSTRUMENT_TYPES` += `BOND_AR`, `LETRA` |
| `src/components/transactions/transaction-form-modal.tsx` | Modified | `INSTRUMENT_TYPE_OPTIONS` += BOND_AR, LETRA |
| `src/app/actions/transactions.ts` | Modified | Bond valuation routing covers all three fixed-income types, not just `ON` |
| `src/app/actions/instruments.ts` (`searchInstrumentsAction`) | Modified | Returned shape carries settlement |
| Search result UI | Modified | ARS / MEP / CCL chip |
| `api/*.py` + `requirements.txt` | New | Yahoo metadata function on Vercel |
| `src/lib/market/yahoo-catalog.ts` | Modified | `execFile` caller removed; HTTP adapter to the Python function |
| New Docta client + mapping module | New | Token mint/cache, two GETs, fixture-tested mapping to `Instrument` / `BondTerms` |
| `src/lib/bonds/cashflows.ts`, `bond-cashflow-table.tsx` | Unchanged API | Consume Docta-sourced data through the existing tested surface |
| `src/lib/importers/commit-import.ts` | Modified | Enrichment best-effort + concurrency cap |
| `prisma/schema.prisma` — `CorporateEvent.createdByUserId` | Modified | Becomes **nullable**. `@@unique([instrumentId, effectiveDate, eventType])` (line 522) already treats a corporate event as a global fact about the instrument, so the creator is audit metadata. Today the non-null FK to `User` (lines 519–520) makes the event unseedable, because `prisma/seed.ts` creates no user. |
| `prisma/seed.ts` | Modified | Loads known public corporate actions with no creator — starting with the SPY `CEDEAR_RATIO_CHANGE` (2026-06-01, 3:1) currently hardcoded in `RECOMMENDED_EVENTS`. Added because the disposable-database strategy (§14) wipes the one hand-recorded `CorporateEvent`. |
| `src/lib/events/recommended.ts` | Read-only | Source of the seeded event's parameters. The recommendation flow still works unchanged: it only surfaces an event the user does not already have, so a seeded event simply stops being offered. |

### In-tree work this change absorbs

**Keep and finish**: the 5-endpoint change in `data912-universe.ts`; `MarketSnapshot` + `InstrumentProviderSymbol` models and migration `20260912000000_add_market_snapshots_and_provider_symbols/`; extra currencies in `prisma/seed.ts`; normalization logic in `scripts/yahoo_catalog.py`; the three data912 sample JSONs at the repo root, **moved** into a `__fixtures__/` directory (existing convention: `src/lib/bonds/__fixtures__/`).

**Drop or rewrite**: `writeFileSync("instruments-debug.log")` in `src/app/actions/monitoreo.ts` and the log file it produced; `src/lib/market/provider-routing.test.ts` (two genuinely broken assertions — `hasUsdUnderlying` is not a field of `ResolvableInstrument`, and one case asserts `.toBeNull()` while the function always returns an object; the `"native"` literal **is** correct); `data912com-live-usa_stocks.json`; the `execFile("python", ...)` caller in `yahoo-catalog.ts`.

**Baseline (must be green at the end)**: `npx tsc --noEmit` currently reports **7 errors**, `npm test` reports **2 failures** — all from the files listed above.

## 7. Capabilities (contract for sdd-spec)

`openspec/specs/` does not exist in this repo; the established convention (`spy500-split`) is a single change-local `spec.md`. Cover these capability areas:

- `instrument-settlement-variants` — catalog ingestion of the five universes, base↔variant linking via the currency oracle and ISIN, settlement/currency assignment, identity reconciliation.
- `currency-aware-valuation` — USD-variant quote routing and CCL conversion in the equity path.
- `fixed-income-tradability` — BOND_AR/LETRA searchable, manually enterable, and valued through the fixed-income path.
- `instrument-metadata-providers` — Yahoo-on-Python and Docta clients, enrichment scope, failure isolation, token caching.
- `bond-cashflow-autofill` — Docta cashflow → `BondTerms` / analítica v2, including the overwrite-vs-propose policy resolved in §11.

## 8. Success criteria

- [ ] All five data912 universes ingest; `usa_stocks` is absent from the catalog.
- [ ] Searching `NVDA` returns `NVDA`, `NVDAC`, `NVDAD` as three results, chipped ARS / MEP / CCL respectively.
- [ ] Each variant row has a non-null `baseInstrumentId` pointing at its base, produced by the deterministic path for its universe (currency oracle or ISIN). Verified against measured cases: `DD`/`DDD` **must** link (`DD.BA` ARS 40900, `DDD.BA` USD 26.32 — DuPont and its variant); `C`/`CC` **must** link (`CC.BA` USD 45.84 — Citigroup's CCL variant); `TGNO4`/`TGN4D` **must** link across a ticker rewrite; `AL30`/`AL30D` **must** link on shared ISIN `ARARGE3209S6`. `CAR` and `CARC` **must not** link — both quote in ARS (7270 and 22.95), so neither is a settlement variant; `CARC` is Carboclor.
- [ ] A position recorded against a USD variant shows an ARS market value consistent with `price_usd × CCL`, not with a raw `.BA` quote.
- [ ] BOND_AR and LETRA appear in search and in the manual transaction form, and a previously imported BOND_AR row is valued through the fixed-income path, not the equity path.
- [ ] `/bonds → analítica v2` shows a Docta-sourced cashflow schedule for a ticker with no manually entered `BondTerms`.
- [ ] Yahoo metadata resolves in production on Vercel with no `execFile`; enrichment covers only transaction-referenced instruments.
- [ ] A failing Docta or Yahoo call no longer fails an import commit.
- [ ] `npx tsc --noEmit` → 0 errors; `npm test` → 0 failures; `npm run lint` clean; `npm run build` passes.
- [ ] `instruments-debug.log` and the `usa_stocks` sample are gone from the repo.

## 9. Size assessment — frank

**This will exceed the 800-line review budget. Expect roughly 1,400–1,900 authored changed lines (additions + deletions), i.e. about 2× the budget.**

Rough breakdown:

| Work unit | Est. lines |
|---|---|
| Fixed-income tradability + repo cleanup + baseline back to green | ~250 |
| Schema + migration + ingestion + variant linking (incl. pure module + tests) | ~450 |
| Currency-aware quotes + search settlement chip | ~300 |
| Yahoo Python function on Vercel + TS adapter + `execFile` removal | ~250 |
| Docta client + fixture-tested mapping + analítica v2 wiring | ~400 |

Fixture JSON moves are renames and are excluded from the authored count.

**Recommendation for the orchestrator**: surface the `size:exception` decision to the user **now, before the tasks phase**. The natural chained slices, if the user prefers chaining over an exception, are:

1. Fixed-income tradability + cleanup + baseline green (independent, low risk, ~250).
2. Schema + ingestion + variant linking **+ currency-aware valuation** — must stay together (§5), ~750.
3. Search settlement chip (~150, depends on 2).
4. Yahoo-on-Vercel provider (~250, independent).
5. Docta + analítica v2 (~400, depends on 1).

Guard lines for the tasks phase: `Decision needed before apply: Yes` · `Chained PRs recommended: Yes` · `800-line budget risk: High`.

## 10. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Ingestion ships without the currency fix → silently wrong holdings on any variant position | Med | Hard sequencing constraint (§5): Legs 1 and 2 in the same slice. Non-negotiable in tasks. |
| A linking claim that was never measured gets locked into a regression test | **Materialised once already** | Rev. 1 asserted `CC` was Chemours and `DD`/`DDD` was a false pair. Both are measured false. No ticker-identity claim enters a test without a captured probe behind it. |
| Docta returns no ISIN for an exotic fixed-income ticker (`BA7DD`, `XN6D`, `TVPA` are unverified) | Med | Falls through to unlinked-but-tradable (FR-3). Degraded, never wrong — and strictly better than the price-band guess it replaced. |
| Yahoo unreachable at ingestion, so the currency oracle cannot answer | Med | Ingestion of new rows blocks rather than guessing. Defaulting to ARS is forbidden: under the immutability invariant a guessed currency is permanent. The catalog changes slowly, so a skipped day is harmless. |
| Heuristic depends on both quotes existing on the same day; `arg_notes`/`arg_bonds` liquidity is thinner than CEDEARs | Med | Unlinked-but-present is an acceptable end state: the instrument is still tradable, it just has no base link. Re-linking happens on a later sync. |
| `identityKey()` change alters create/reactivate/delist reconciliation against the live catalog | Med | High-risk per `config.yaml` (holdings-adjacent). Design phase must show the before/after reconciliation behavior; verify no mass-delist on the first sync after deploy. |
| Extending bond routing beyond `type === "ON"` touches valuation math for already-imported rows — numbers will visibly change | High (by design) | This is the bug fix, but it must be announced as a value change, not a silent one. Capture before/after for at least one imported BOND_AR position. |
| Python function on Vercel: bundle limit, cold start, runtime version | Low | yfinance + pandas + numpy ≈ 150 MB against a 500 MB uncompressed limit; Next.js preset does not conflict with file-based `/api/*.py`. Verify in a preview deploy before merge. |
| Docta token/quota behavior under cron + import load is unmeasured | Med | In-memory 24h token cache + concurrency cap; treat any Docta failure as best-effort/no-op. |
| Docta `name` mojibake persisted as-is into `Instrument.name` | High if unhandled | Normalize encoding in the client; assert against the captured fixture. |
| Next.js 16 API assumptions from stale training data | Med | Per `AGENTS.md` / `config.yaml`: design and apply phases must consult `node_modules/next/dist/docs/` before touching route handlers, server actions, or config. |
| Sizing of `enrichUsedInstruments` is inference, not measurement (no DB query was run) | Med | Design phase should measure `SELECT COUNT(DISTINCT instrumentId) FROM "Transaction"` before choosing the concurrency cap. |

## 11. Decision needed before specs

**`BondTerms` write policy for Docta cashflow data: overwrite or propose?**

The existing argen.bond flow (`fetchArgenBondProposal`, `src/lib/bonds/argen-bond-scraper.ts`) is deliberately **propose-don't-overwrite**: user-triggered, shows a proposal, the user accepts. Docta is an authoritative issuer-grade source and could reasonably auto-fill.

| Option | Pro | Con |
|---|---|---|
| **A. Propose** (mirror argen.bond) | Consistent UX; user-entered terms are never clobbered; one mental model for "external bond data" | An extra click per bond before analítica v2 is useful; weakens "auto-fill" in decision 6 |
| **B. Overwrite when empty, propose when populated** | Auto-fill for the common case; manual work still protected | Two behaviors on one surface; "empty" needs a precise definition (all fields? any field?) |
| **C. Always overwrite** | Simplest; data stays fresh | Destroys manual corrections and argen.bond-accepted values with no undo |

Not picked here. **This is a product/UX call for the user.** Default if unanswered: **B**, as the narrowest reading of "auto-fill" that still respects the existing propose contract — but it should be confirmed, not assumed.

## 12. Rollback plan

| Leg | Rollback |
|---|---|
| Schema | The migration is purely additive (nullable FK + enum). Rollback = `DROP COLUMN baseInstrumentId`, drop the enum; no data loss on `Instrument`, `Transaction` or `BondTerms`. |
| Ingestion | Re-comment the four non-`arg_stocks` endpoints in `data912-universe.ts`; already-created variant rows are inert (no transactions reference them unless the user recorded one). |
| Currency routing | Single revert of the `quotes.ts` branch; `PriceCache` is short-lived (10 min) and self-heals on the next refresh. |
| Fixed-income tradability | Revert the two constant lists and the routing condition; already-created BOND_AR/LETRA transactions remain valid rows. |
| Yahoo Python function | Delete `api/*.py` + `requirements.txt`; re-point the adapter at the previous provider. Metadata is descriptive only — no valuation depends on it. |
| Docta | Feature-gated by the presence of `DOCTA_CLIENT_ID`/`DOCTA_CLIENT_SECRET`; unsetting them disables the provider without a deploy. `BondTerms` rows written under option C would **not** be recoverable — another argument for §11 option A or B. |

## 13. Dependencies

- `DOCTA_CLIENT_ID` and `DOCTA_CLIENT_SECRET` provisioned in Vercel (and locally).
- Docta plan/quota sufficient for per-instrument bond fetches under cron + import load.
- Vercel project allows file-based Python functions on the current plan; `requirements.txt` builds within the bundle limit.
- CCL/MEP reference rates from `ccl-rate.ts` / `dolarapi.ts` available at ingestion time (the heuristic is unusable without them — ingestion must skip linking rather than guess).

## 14. Decisions resolved (user, this session)

| # | Decision | Resolution |
|---|---|---|
| Size | 800-line budget vs ~1,400–1,900 forecast | **`size:exception` accepted.** Single PR, `delivery_strategy: single-pr`. Do not chain. |
| §11 | `BondTerms` write policy for Docta cashflow | **Option B** — auto-fill when no terms exist, propose when they do. "Empty" must be defined precisely in the spec (recommended: no `BondTerms` row at all, not a row with null fields). |
| Variant linking | Instruments neither deterministic path can confirm | **Show them anyway, without a settlement chip.** Degraded, never wrong. A later sync links them. Never withhold a real tradable instrument from search. |
| Docta extras | `issuer`, `law`, `sector`, `asset_class` | **Persist and surface** — see §15, this became a primary goal. |
| Search sort | Ordering of base vs variants | Default applied: the ARS row sorts first within a ticker family, ahead of strict alphabetical (which would put `BA.C` before `BA`). |
| Value correction notice | Fixed-income re-valuation | Default applied: announce it in the UI on first corrected render. Numbers that move must not move silently. |

## 15. Sector coverage — promoted to a primary goal

The user identified sector data as the essential motivation for this work. Verified current state:

- `sector` exists **only** on `UnderlyingAsset.sector` (`prisma/schema.prisma:161`). `Instrument` has no sector field at all.
- `getDashboardPageDataAction` reads it exclusively through the relation: `underlyingAsset: { select: { sector: true } }` (`src/app/actions/dashboard.ts:62`), then `r.instrument.underlyingAsset?.sector ?? null` (line 125).
- The only populated values are ~24 hardcoded entries in `prisma/seed.ts` (AAPL, MSFT, GOOGL, NVDA, YPFD, PAMP, BMA, LOMA, …).
- `translateSector` (`src/lib/dashboard/build.ts:44`) masks the gap with type-based buckets: `ETF`, `Renta fija`, `Fondos comunes`, `Cripto`, `Sin clasificar`.

**Consequence:** every instrument without an `underlyingAssetId` — which is everything ingested from data912 or created by the importer — has no sector and collapses into `Sin clasificar`. The dashboard's sector distribution is currently driven by a dozen seed rows.

**What this change must deliver:** Yahoo supplies `sector` and `industry` per equity/CEDEAR ticker; Docta supplies `sector` per fixed-income instrument. Together they cover the full tradable universe. Sector must become real data on the instrument, not a seed artifact.

**Design question for `sdd-design` (do not pre-empt):** where sector lands. Putting it on `Instrument` covers every row including those with no underlying asset; populating `UnderlyingAsset` from Yahoo preserves the existing read path but muddies a dictionary of real-world assets with per-BYMA-ticker rows. A settlement variant must **not** carry its own copy — it reads sector through `baseInstrumentId`, consistent with the no-duplication requirement. Whichever shape is chosen, `translateSector`'s fallbacks stay as the last resort, not the primary source.

**Size impact:** this adds roughly 150–250 lines (schema field or relation change, enrichment mapping for both providers, dashboard read path, sector backfill for already-used instruments) on top of the §9 forecast. The `size:exception` above was accepted with this scope included.
