# Instrument Universe & Providers — Technical Design
# Change: instrument-universe-providers

**Type**: Architecture & implementation design
**Status**: Design — **rev. 4** (rev. 2: disposable database · rev. 3: Yahoo currency oracle · rev. 4: Docta ISIN + stored schedules — see §R)
**Delivery**: single-pr (`size:exception` accepted — proposal §14)
**Date**: 2026-09-15

This document specifies HOW the change is built. It complements `proposal.md` (WHY/WHAT) and `exploration.md` (measured findings — not restated). Task breakdown is deferred to `tasks.md`.

The five open questions the orchestrator handed to this phase are answered in §2 (sector), §3 (identity key), §4 (price-ratio linking), §9 (concurrency), §10 (Python contract).

---

## R. Revision note — the database is disposable

**New constraint (rev. 2):** the user has declared the database disposable. This is a single-user personal project and the delivery strategy is **reset → reseed → sync → reimport** (§6), not an additive migration against a live DB. The only non-regenerable row was one `CorporateEvent` (the SPY CEDEAR ratio change); it moves into the seed (§6.3).

What this removes, and why it was there:

| Removed in rev. 2 | Existed only because |
|---|---|
| The `catalogKey` / `storageKey` split | Pre-existing rows were born `currencyCode = ARS` from `catalog-sync.ts`'s `resolveCurrencyCode` fallback, so full-key reconciliation orphaned them after the currency fix. |
| The three-way mass-delist proof | Same. With a wiped DB there is no legacy row to orphan. |
| The 20 % shrink guard | Same — it was a tripwire for that one migration moment. |
| The `?dryRun=1` cron mode | Same — a pre-merge rehearsal against production data that no longer exists. |
| The sector backfill script | A full resync writes sector for every row anyway (§2). |
| The "these values were corrected" UI notice | Single user, disposable data. The user knows why the numbers moved. |

What **survives** the disposable DB, and why (so a future reader does not delete them as leftovers):

| Kept | One-line reason |
|---|---|
| **AD-5** monotonic settlement links | Protects the valuation of a *held position* against a transient thin-quote day. Nothing to do with migration. |
| **Empty-universe guard** (`catalog-sync.ts:86`) | Protects against data912 returning `[]` — provider failure, not migration. |
| **Pure, unit-tested modules** (§7) | `strict_tdd: true` in `config.yaml`. The convention, not the data, drives it. |

The single decision that makes the collapse safe is **AD-0**. Read it before §3.

### R.2 — Second finding: Yahoo lists the variants and reports their currency

**Measured against `query2.finance.yahoo.com/v8/finance/chart/{SYMBOL}.BA` on the real BYMA universe.** Yahoo returns an authoritative `meta.currency` per symbol, and it lists the settlement variants themselves:

| Bases — `meta.currency = ARS` | Variants — `meta.currency = USD` | Not covered |
|---|---|---|
| NVDA 14120 · GGAL 6725 · YPFD 9180 · AMD 80500 · DD 40900 · C 72300 · CRWD 4892.5 · ERIC 8035 · CARC 22.95 · BA 13830 · TGNO4 3295 · MCC3O 158850 | NVDAC 8.87 · NVDAD 9.22 · GGALD 4.4 · YPFDD 5.97 · DDD 26.32 · CC 45.84 · BAC 8.76 · BAD 9.16 · TGN4D 2.14 | AL30 → HTTP 404 (Argentine sovereigns are absent from Yahoo) |

Three consequences, each of which changes a decision below:

1. **Currency stops being a heuristic.** BYMA's main board quotes in ARS, so a `.BA` symbol quoting in USD **is** a settlement variant. `meta.currency` is therefore both the currency oracle and the variant *detector*. `resolveCurrencyCode`'s guess is replaced by a lookup (**AD-12**).
2. **The price ratio's job shrinks to two much easier questions** — which base a confirmed variant belongs to, and CCL vs MEP — decided within a small confirmed-USD set rather than an open search over ~1,700 symbols (§4).
3. **Two counter-examples that rev. 1 encoded as truth are false**, and one of them was about to be locked into a regression test:

| Rev. 1 claim | Measured reality |
|---|---|
| `CC` is Chemours, an unrelated ARS listing | `CC.BA` = **USD** 45.84; `C.BA / CC.BA` = 1577 ⇒ **Citigroup's CCL variant** |
| `DD`/`DDD` is a false pair; "a unit test MUST assert it produces no link" | `DDD.BA` = **USD** 26.32; `DD.BA / DDD.BA` = 1554 ⇒ **DuPont's real variant**. The exploration's 1461.7 came from an older snapshot and was a **false negative of the ratio method on one day's data**. |

That second row is the decisive argument for AD-12: the ratio alone is not trustworthy, it failed in the *unsafe* direction on real data, and rev. 1 was one commit away from freezing that failure as an assertion. **Yahoo's currency takes precedence over the ratio wherever Yahoo answers.** The genuine ARS bases confirmed by measurement are AMD, DD, C, CRWD, ERIC, CARC, BA, TGNO4.

`TGNO4 → TGN4D` (USD 2.14, ratio 1540) is also now confirmed **across a ticker rewrite** — no string rule finds it; currency plus ratio does.

### R.3 — Third finding: Docta publishes an ISIN, and variants share it

**Verified in this phase against `src/lib/market/__fixtures__/docta/instruments-AL30.json:11` and `instruments-AL30D.json:11`** — both carry `"isin": "ARARGE3209S6"`, and every other field is identical except `ticker` and its echo inside `name`.

**Tickers sharing an ISIN are one security, by the definition of the standard.** For fixed income that is a *deterministic* link — no tolerance band, no FX anchor, no false positives — and it works exactly where every other signal fails:

| Signal | Sovereigns / letras |
|---|---|
| Yahoo `meta.currency` (AD-12) | **Unavailable.** `AL30.BA` returns a row with `currency: undefined` and no price; `AL30D.BA` is absent entirely. |
| Ticker string rules | **Useless.** `BA37D → BA7DC`/`BA7DD`, `NDG34 → NDG4C`/`NDG4D`, `X30N6 → XN6D` are rewrites, not suffixes. |
| Price ratio | Works, but it is a band over a thin market — the weakest evidence available for the riskiest instruments. |
| **Docta ISIN** | **Exact, and free** — the `/instruments/` call is already needed for `issuer`/`law`/`sector`. |

*Also verified and superseded*: `cashflow-AL30.json` and `cashflow-AL30D.json` return byte-for-byte equal *values* across all 19 rows, so the contractual schedule is a valid fingerprint too. It is demoted to a documented fallback in AD-13 — it answers the same question inferentially, at the cost of a second endpoint and a canonicalisation step, when the issuer already published the answer.

Four further corrections and cautions, each of which changes a decision below:

1. **Corrected coverage boundary.** §R.2 implied all fixed income is outside Yahoo. **It is not.** ONs are fully covered — `MCC3O.BA` ARS 158850, `MCC3D.BA` USD 103.95, `MCC3C.BA` USD 99.7, the complete O/D/C trio with authoritative currency. The real split is `arg_stocks` (95) + `arg_cedears` (957) + `arg_corp` (635) = **1,687 symbols on the Yahoo oracle**, and `arg_bonds` (198) + `arg_notes` (23) = **221 on the fingerprint path**.
2. **Settlement falls out of price ordering within a confirmed group.** Highest price is the ARS listing; of the remaining two the higher is MEP and the lower is CCL, because the CCL rate exceeds the MEP rate and dividing by the larger number yields the smaller price. Ground-truthed against Yahoo on equities: NVDAC (CCL) 8.87 < NVDAD (MEP) 9.22; BAC (CCL) 8.76 < BAD (MEP) 9.16.
3. **AL30 is a step-up bond and the current `BondTerms` model cannot represent it.** Its `interest_rate` runs 0.13 → 0.5 → 0.75 → 1.75 across the schedule (fixture lines 4, 5, 9, 17). `BondTerms.couponRate` is a single `Decimal` and `projectCashFlows` derives coupons as *rate × remaining principal ÷ periods per year*, so no single stored rate reproduces this bond. Worse, §8.3b's rule "infer FIXED when `interest_rate` is constant" would classify it **FLOATING**, which makes `projectCashFlows` mark every coupon `assumedRate: true` and project at a last-known rate. AL30 is not floating — it is fixed and fully predetermined, merely stepped. Every 2020-restructuring sovereign is like this: AL29, AL30, AL35, AE38, GD29, GD30, GD35, GD38, GD41, GD46. **AD-14** resolves this by storing the schedule instead of deriving it.
4. **Implementation trap found while verifying.** The two cashflow fixtures are *not* byte-identical: one is compact and the other pretty-printed, one renders `0.0` where the other renders `0`, and `interest_rate` carries IEEE noise (`1.7500000000000002` for 1.75). Any fingerprint over raw bytes or `JSON.stringify` would report these as **different** securities and silently produce zero links. This trap is now confined to AD-13's fallback — and it is a further argument for the ISIN, which is a string that either matches or does not.
5. **The ISIN trap, in the other direction.** `Instrument.isin` (`schema.prisma:267`) is `String?` with no unique constraint, and **nothing in `src/` reads or writes it today** — verified. It looks like a natural unique key. It must never become one: settlement variants *share* an ISIN, and that sharing is the link. AD-13 states this explicitly.

---

## 0. Next.js 16 conventions actually verified

Per `AGENTS.md` and `config.yaml`, nothing below is asserted from training data. Sources are in `node_modules/.pnpm/next@16.2.6.../node_modules/next/dist/docs/`.

| Claim used in this design | Source | Note vs pre-16 |
|---|---|---|
| `fetch` is **not** cached by default (`auto no cache`); `next.revalidate` is the opt-in; `next.tags` enables `revalidateTag` | `01-app/03-api-reference/04-functions/fetch.md` | Differs from Next 13 where `fetch` was cached by default. The existing `data912-universe.ts` / `dolarapi.ts` opt-in pattern is correct and is kept. |
| `fetch` memoization does **not** apply inside Route Handlers | same file, "Memoization" | The cron route must not rely on dedupe across calls — hence the single-reader design in §5. |
| Route Handlers are not cached by default; `GET` opts in with `dynamic = 'force-static'` | `01-app/01-getting-started/15-route-handlers.md` | The cron routes already use `dynamic = "force-dynamic"`; unchanged. |
| `after()` from `next/server` schedules work after the response, is available in **Server Functions** and Route Handlers, runs even on error, and is bounded by the route's `maxDuration` | `01-app/03-api-reference/04-functions/after.md` | This is the primitive used in AD-9 to stop enrichment from blocking an import commit. It was experimental (`unstable_after`) before 15. |
| `maxDuration` is a route segment config export | same | `sync-catalog` currently exports none; AD-9 adds it. |

No `use cache` / `cacheComponents` usage is introduced — the repo does not enable it today.

---

## 1. Architecture Decisions

### AD-0 — `currencyCode` is decided once at ingestion and never rewritten afterwards

**This is the load-bearing invariant of rev. 2. AD-2's single identity key is correct only while AD-0 holds.**

- **Decision**: `Instrument.currencyCode` is the row's **settlement currency**, determined exactly once, from evidence, by the ingestion pipeline:
  - **Catalog path** — from Yahoo's `meta.currency` for the symbol (**AD-12**), falling back to the price-band link (§4) only where Yahoo does not answer. Always materialised as `currencyForSettlement(settlement)`, so `currencyCode` and `settlement` can never disagree.
  - **Import path** — from `p.currencyCode`, the currency the broker statement attests for that transaction (`commit-import.ts:89`). This is testimony, not a guess.
  - The **settlement-resolution step is the only writer of `currencyCode` after creation**, and it writes in place by row `id`, as a function of `settlement` alone.
- **Enrichment MUST NEVER write `currencyCode`.** Not Yahoo, not Docta, not the sector/industry/issuer/law/assetClass pass. The enrichment update object is an explicit allowlist of descriptive columns; `currencyCode`, `settlement`, `baseInstrumentId`, `venueCode`, `type` and `ticker` are not in it.
- **AD-0 and AD-12 are not in tension — AD-0 constrains _when_, not _who_.** The same provider appears on both sides of the line because it appears at two different pipeline positions:

  | Pipeline position | Runs | May write `currencyCode`? |
  |---|---|---|
  | **Ingestion** — `resolveUniverseCurrencies` (AD-12), then the link step (§4) | once per symbol, at or before row creation | **Yes.** This is the "exactly once" of AD-0. |
  | **Enrichment** — `enrichUsedInstruments` (§10, §8) | repeatedly, over rows that already exist | **Never.** Compile-time blocked by `EnrichmentPatch`. |

  Yahoo's currency is authoritative at birth and forbidden forever after. A later Yahoo call that happens to report a different currency is not a correction, it is drift, and the reset runbook — not a silent rewrite — is how a wrong row gets fixed.
- **Why this decision has its own ID**: every piece of machinery deleted in rev. 2 — the key split, the delist proof, the shrink guard, the dry run — existed to survive `currencyCode` drifting *after* the row was created. If any enrichment path can mutate it, that exact drift reappears on a clean database and all of that machinery becomes necessary again. The disposable DB buys the simplification; AD-0 is what keeps it bought.
- **Superseded assumption (rev. 1)**: "yfinance reports ARS for every `.BA` symbol, so its currency is useless." **Measured false** (§R.2): Yahoo reports USD for `NVDAD.BA`, `DDD.BA`, `CC.BA` and every other variant probed. Rev. 1 rejected the best available oracle on an unverified claim. AD-12 adopts it.
- **Test hook**: `instrument-identity.test.ts` cannot enforce this (it is an orchestrator property). The enforcement is structural: `enrichUsedInstruments` builds its Prisma `data` object from a typed `EnrichmentPatch` whose TypeScript type literally has no `currencyCode` key, so a future writer is a compile error rather than a silent data change.

### AD-12 — Yahoo `meta.currency` is the currency oracle for the whole ingested universe

*Numbered 12 because it was added in rev. 3; placed here because AD-0 depends on it.*

- **Decision**: at every sync, resolve the currency of **every symbol in the ingested universe** through one batched Yahoo lookup (`resolveUniverseCurrencies`), before linking and before reconciliation. `meta.currency = "ARS"` ⇒ base. `meta.currency = "USD"` ⇒ settlement variant, because BYMA's main board quotes in ARS. `catalog-sync.ts:142`'s `resolveCurrencyCode` fallback is deleted outright.
- **Chosen over "ratio is the bulk path, Yahoo is the tiebreaker"** on three grounds:

  | | Whole-universe lookup (**chosen**) | Ratio-first, Yahoo as tiebreaker |
  |---|---|---|
  | **Determinism** | An assertion from the venue's own data. Same answer every run. | A heuristic over two prices and an FX anchor. Measured to have produced a **false negative on DD/DDD** (§R.2) that rev. 1 nearly froze into a test. |
  | **Cost** | ~1,700 symbols ÷ 25 per batch ≈ **70 requests** on a once-daily cron, at concurrency 4 (§9). Small next to the 5 data912 endpoints plus per-instrument Docta calls already in the same run. | Fewer requests, but the saving is measured in tens of requests per **day**. |
  | **Failure mode** | Fails as a **unit** and is detectable: zero currencies resolved ⇒ the run knows it is blind and refuses to create rows (see below). | Fails silently, **per symbol**, in the direction that creates a mis-currencied row — precisely the corruption this design exists to prevent. |

  The tiebreaker design also inverts the trust ordering: it would let the weaker signal decide the common case and consult the stronger one only on the cases the weaker signal already thinks it solved. That is backwards.
- **Transport**: reuse the Python function of §10 with `mode: "currency"` (§10.3b) rather than calling Yahoo from the Node runtime. It already has the auth, the 25-item batch limit, the timeout and the concurrency cap, and `yfinance` handles batched symbol lookup natively. **Verify at implementation** whether the batch path is one request per batch or N inside the function; the 70-request figure assumes the former, and the design is unaffected either way because the cap and budget of §9 bound it.
- **Failure policy — never invent a currency.** Three distinguishable outcomes, only two of which are evidence:

  | Outcome | Meaning | Action |
  |---|---|---|
  | `meta.currency` = `ARS` / `USD` | Evidence | Determined. `settlement = ARS` / `USD` (then refined to MEP·CCL by §4). |
  | HTTP **404** for `{SYMBOL}.BA` | Evidence of **absence** — Yahoo does not cover it (all Argentine sovereigns; `AL30.BA` measured) | Fall back to the price ratio (§4). A confirmed link ⇒ USD. No link ⇒ `ARS` **by domain rule**: BYMA's main board quotes in ARS and no USD counterpart evidence exists. This is FR-3's unlinked-but-tradable state and it is a positive determination, not a default. |
  | Timeout / 5xx / auth failure | **No evidence at all** | **Fail closed.** Do not create any row whose currency is undetermined this run, do not modify any existing row, log, and report `ok: false` with `currencyOracle: "unavailable"`. The next run creates them. A symbol that is one day late to appear in search is a non-event; a symbol born with the wrong currency is permanent under AD-0. |

  **Silently defaulting an unresolved symbol to ARS is explicitly forbidden** — that is exactly how rev. 1's mis-currencied rows were born, and on a reset database it would recreate the problem the reset was meant to end.
- **Coverage boundary (corrected in rev. 4, §R.3)**: the oracle covers `arg_stocks` + `arg_cedears` + `arg_corp` = **1,687 symbols**, ONs included (`MCC3O`/`MCC3D`/`MCC3C` all resolve). The **221** symbols of `arg_bonds` + `arg_notes` — sovereigns and letras — go to the fingerprint path of **AD-13** instead. Rev. 3's claim that all fixed income was outside Yahoo was wrong and cost the ON trio its deterministic currency; corrected here.
- **rev. 6 correction (2026-09-16, scope confirmation)**: ON's currency/settlement classification stays on Yahoo, unchanged by anything below — **verified live**: `MCC3O.BA` ARS / `MCC3D.BA` USD / `MCC3C.BA` USD, the full O/D/C trio resolves exactly as this boundary already documented. What changes is ON's **contractual terms**: Yahoo's `quoteSummary` was verified live to return zero bond-term data for ON tickers (`assetProfile`/`defaultKeyStatistics`/`bondData` all report "No fundamentals data found"; `quoteType` reports `"EQUITY"` — Yahoo has no concept of ON as a bond at all, only as a price series). ON therefore also goes through Docta's AD-14 stored-schedule + gated `BondTerms` path (§8), exactly like BOND_AR/LETRA — see AD-14's rev. 6 note below. **AD-12 (this decision) is otherwise unchanged**: Yahoo remains the sole currency oracle for ON, and Docta is never consulted for ON's currency/settlement.
- **Transport caution (rev. 4)**: Yahoo's batch quote endpoint is **not** openly accessible. Raw `v7/finance/quote` returns `401` and `v6` returns `404`. The working sequence is `GET https://fc.yahoo.com/` for cookies → `GET https://query1.finance.yahoo.com/v1/test/getcrumb` with those cookies → `GET v7/finance/quote?symbols=…&crumb=…`, measured to return 5 symbols with correct currencies in one call. `yfinance` performs this handshake internally, which is the deciding reason the oracle lives in the Python function (§10.3b) rather than in Node: a raw-HTTP implementation would have to own cookie jar, crumb lifetime and re-handshake-on-401 itself. **If the function is ever rewritten without `yfinance`, the handshake becomes mandatory implementation work, not an optimisation.**

### AD-13 — For fixed income, the ISIN is the identity

**Verified in this phase**: `instruments-AL30.json:11` and `instruments-AL30D.json:11` both carry `"isin": "ARARGE3209S6"`. Every other field in the two payloads is identical except `ticker` and the ticker echoed inside `name`.

- **Decision**: link `BOND_AR` and `LETRA` variants by **ISIN**, read from Docta's `GET /bonds/instruments/{TICKER}` (no trailing slash — see the rev. 5 correction below). Tickers sharing an ISIN are one security; the ARS listing is the base and the others are its settlement variants. The split within the group comes from price ordering (AD-13b).

#### rev. 5 correction (2026-09-16, apply-phase acceptance) — the "essentially free" cost model was wrong, measured against the live account

Everything above this note assumed the 221 `/instruments/` calls were cheap enough to run as one whole-universe pass. **Measured against the live "basic" plan account, they are not**: the account is rate-limited at **10 requests/minute** (`x-ratelimit-limit: 10`) and, decisively, **15 requests/day** (`x-dailylimit-limit: 15`, confirmed via `x-dailylimit-remaining: 0` and a `retry-after` in the tens of thousands of seconds once exhausted). A whole-universe pass over 221 tickers is not "zero marginal cost, already budgeted for metadata" — it is roughly **15 days** of budget spent in one run, of which only the first ~15 tickers (in whatever order the loop happened to visit them) would ever get a live answer; every other ticker in that same run would 429 pointlessly. The prior text's "Cost: 221 `/instruments/` calls, already budgeted for metadata" and "Steady-state daily cost is zero" statements were based on an unverified assumption ("essentially free") that turned out to be wrong once credentials existed to measure it — not a data912/Yahoo-style bulk endpoint, a per-ticker call against a 15/day ceiling.

- **Revised decision — prioritize-then-drip, not whole-universe-per-run**: fixed-income instruments referenced by at least one `Transaction` ("held") are looked up **first**; the rest follow, budget-capped per run (`DOCTA_LINKING_BUDGET_PER_RUN`, `src/lib/market/fixed-income-linking.ts` — deliberately kept under the 15/day ceiling with headroom for the cashflow path, which draws on the same daily quota). A user holding a handful of bonds gets them linked the same day the sync next runs; the remaining ~216 fill in over subsequent runs. This is FR-3-safe by construction: an unlinked fixed-income instrument is still fully searchable and tradable, only its settlement chip is absent, and only until its turn comes.
- **This is a one-time ramp, not a recurring daily cost.** Once a ticker's ISIN lookup resolves — an ISIN, or a confirmed 404 ("Docta does not serve this ticker") — it is cached **permanently** and never looked up again (see the corrected caching rule below). The 221-ticker backlog is a fixed, shrinking pool that drains over roughly `221 / DOCTA_LINKING_BUDGET_PER_RUN` runs, not a 221-calls-every-day bill. The original "steady-state daily cost is zero" claim is correct in spirit — after the ramp completes — it was simply wrong about the ramp itself being free.
- **A 404 must be cached, not just a success.** The original design cached only a successful `/instruments/` response; a 404 was treated as "nothing to write" and discarded. On a 15/day budget this is a real bug, not a style nit: it means every ticker Docta genuinely does not serve gets re-asked, and re-429'd-or-re-404'd, on every single run, burning quota that should have gone to tickers not yet asked at all. The corrected rule: a definitive 404 is evidence exactly like a successful response — cache it forever. Only a `429` (no evidence, the day's or minute's quota is spent) or a transport/parse error (no evidence, safe to retry later) are left uncached.
- **The ordering and budget-slicing logic is a pure, unit-tested module** (`src/lib/market/docta-linking-plan.ts`), per this repo's own testing convention (`config.yaml`) — `fixed-income-linking.ts` itself stays an untested Prisma orchestrator, but the actual decision ("who gets a live lookup this run") does not live inside it.
- **Why ISIN over the cashflow fingerprint** (which rev. 4 briefly designed and this decision supersedes):

  | | ISIN (**chosen**) | Cashflow fingerprint |
  |---|---|---|
  | Strength of claim | **Definitional.** Same ISIN means same security by the definition of the standard. | **Inferential.** Two bonds issued with identical terms would collide. Strong, but still an inference. |
  | Shape | One indexed string. Grouping is `GROUP BY isin`. | Deep equality over a 19-row schedule, with canonicalisation required (see fallback below). |
  | Cost | **Zero *marginal* cost relative to metadata** (the same call serves both) — but see the rev. 5 correction below: the *absolute* cost of that one call is far from free on a 15-request/day account. | A second endpoint, 221 extra calls. |
  | Storage | `Instrument.isin` **already exists** (`schema.prisma:267`). | A new column for the hash. |

  The fingerprint is not wrong — it is simply a harder way to learn something the issuer already published.
- **`Instrument.isin` is dead schema this change brings to life.** It is `String?` at `schema.prisma:267` and **nothing in `src/` reads or writes it today** (verified). Docta's ISIN populates it for fixed income.
- **`isin` MUST NOT be made `@unique`.** This is the trap the decision creates: the field looks like a natural unique key, and a future reader may "fix" it. **Settlement variants deliberately share an ISIN** — that sharing *is* the link. A unique constraint would make it impossible to store a base and its variant at the same time. Add `@@index([isin])` for the grouping query; never a unique.
- **Cost**: up to 221 `/instruments/` calls total, spread over multiple runs per the rev. 5 correction above (measured: 15/day, 10/minute) — NOT one run. Immutable per ticker once resolved (success OR a confirmed 404), so cached in `ScrapedBondData` (`ticker @unique`, `payload Json`, `fetchedAt` — the model already exists) and re-fetched only for a ticker with no cached row. **Steady-state daily cost is zero once the backlog drains** — the ramp itself is not free, and takes roughly `221 / DOCTA_LINKING_BUDGET_PER_RUN` runs. The `/cashflow` endpoint is no longer part of linking at all; it collapses to the bonds the user actually **holds**, for AD-14's stored schedule — and shares the same daily quota as the linking calls above.
- **Fallback when Docta returns no ISIN** — documented, not primary. `fingerprintCashflow(payload)` groups by canonicalised schedule. It requires canonicalisation, because the two captured cashflow fixtures are *not* byte-identical (§R.3 item 4): drop `ticker` and `metadata`; keep only `issue_date`, `payment_date`, `capital`, `interest_rate`, `residual_value`; round numerics to 6 decimals (killing `1.7500000000000002` → `1.75` and `0.0` → `0`); sort by `payment_date`; hash. Built only if the acceptance pass finds a material number of ISIN-less tickers — otherwise those tickers stay unlinked-but-tradable and the fallback is never written.
- **Docta gaps**: `BA7DD`, `XN6D` and `TVPA` appear in the data912 fixtures but are **unverified against Docta**. A ticker Docta does not serve gets no ISIN, therefore no group, therefore **unlinked-but-tradable (FR-3)** — visible, no chip. Degraded, never wrong. The count is recorded by §14 unit 9 and is what decides whether the fingerprint fallback gets built.
- **Known non-variants — these look like variants and are not.** Both are locked as unit tests over captured payloads:

  | Tickers | What they actually are | Expected under AD-13 |
  |---|---|---|
  | `TVPA` · `TVPE` · `TVPP` · `TVPY` | **PBI-linked coupons differentiated by issue currency**, not settlement variants of one another | Four **distinct** securities ⇒ four distinct ISINs ⇒ no group. A suffix or price-ordering rule would have merged them. |
  | `TZXD6` · `TZXD7` · `TZXD8` | **CER-adjusted bases that merely end in `D`** | The `D` is part of the series name, not a settlement marker. Distinct maturities ⇒ distinct ISINs ⇒ three groups of one. |

  **Stated as an assumption, not a measurement**: the ISINs for these eight tickers have not been captured. The expectation follows from what the instruments are, and §14 unit 9 verifies it. If any of them were to share an ISIN, that would be evidence the assumption about the instrument is wrong, not that the mechanism is.
- **Rejected**: the price ratio as the fixed-income linker. A band over the thinnest, least liquid market in the universe, applied to the instruments whose mis-valuation hurts most, when a published identifier is available at zero marginal cost.
- **Rejected**: `metadata.sub_asset_class` as a currency or grouping signal. `AL30` and `AL30D` are **both** `HARD_DOLLAR` while one trades in ARS and the other in USD. It is a useful classification axis for the bonds UI and nothing more.

### AD-13b — Within a confirmed group, price ordering gives the settlement split

- **Decision**: once a group is confirmed — by ISIN (fixed income) or by the AD-12 currency partition (equities/CEDEARs/ONs) — assign settlement by **descending price**: highest is `ARS`, then `MEP`, then `CCL`.
- **Why it holds**: the CCL rate exceeds the MEP rate, so dividing the same ARS value by the larger number yields the smaller price. Ground-truthed against Yahoo's independent currency verdict on equities — NVDAC 8.87 < NVDAD 9.22, BAC 8.76 < BAD 9.16 (§R.3) — where the ordering agrees with Yahoo in every measured case.
- **Guards**: it applies only to a group of exactly 2 or 3 whose membership is already established. A group of 2 needs the ratio band to decide whether the USD member is MEP or CCL, because ordering alone cannot name which of the two it is. Prices must be present, positive and finite; a missing price leaves the member at `settlement = "USD"` (AD-1).
- **The ratio band is demoted to a sanity check.** It no longer establishes membership anywhere. It now (a) splits MEP from CCL in a two-member group, and (b) vetoes an ordering whose implied rate is absurd — if `price(ARS)/price(USD)` misses both anchors by more than `TOLERANCE`, the members stay `settlement = "USD"` with the group link retained. Membership comes from the ISIN or from Yahoo; the band only ever refines or abstains.

### AD-1 — `Instrument` self-relation + non-nullable `settlement` enum

- **Decision**: `baseInstrumentId String?` self-relation (`@relation("InstrumentVariants")`) plus `settlement Settlement @default(ARS)` — **non-nullable**, over an enum of **four** values: `ARS | USD | MEP | CCL`. `baseInstrumentId` stays nullable.
- **Why non-nullable (changed in rev. 2)**: rev. 1 made it nullable so the additive migration would not have to backfill ~1,700 live rows. That reason is gone, and every read stops carrying a `?? "ARS"`.
- **Why a fourth enum value `USD` (added in rev. 3)**: AD-12 separates two questions that rev. 1 answered together. Yahoo now tells us a symbol settles in USD **before** the ratio tells us which base it belongs to or whether it is MEP or CCL — and sometimes the ratio never separates the two (`DD/DDD` at 1554 sits between today's implied anchors, §4.4). `USD` means "settles in USD; MEP vs CCL not determined". Without it, such a row would have to be stored as `settlement = ARS, currencyCode = USD`, an incoherent pair. `null` would work too, but it would reintroduce a nullable column — this time the state is a **positive statement**, so it belongs in the enum.
- **Resulting states** — every one a positive assertion, none a default:

  | State | `settlement` | `currencyCode` | `baseInstrumentId` | Chip |
  |---|---|---|---|---|
  | Base | `ARS` | `ARS` | `null` | none |
  | Variant, split known | `MEP` / `CCL` | `USD` | base id | `MEP` / `CCL` |
  | Variant, split undetermined | `USD` | `USD` | base id or `null` | `USD` |
  | Yahoo-uncovered, unlinked (FR-3) | `ARS` | `ARS` | `null` | none — **visible, tradable, no chip** (proposal §14) |

- **Hard invariant**: `currencyCode = currencyForSettlement(settlement)` for every row, always. `currencyForSettlement: ARS → "ARS"`, `USD|MEP|CCL → "USD"`. It is checked by an acceptance query (§14 unit 9), not by a DB constraint.
- **Why `baseInstrumentId` stays nullable**: that nullability is **semantic, not a migration artifact** — a base instrument has no base. It survives the reset unchanged.
- **Rejected**: `InstrumentGroup` parent entity (exploration Approach 2) — a synthetic id per ticker family for no functional gain. Derive-at-query (Approach 3) — disqualified by the measured finding that the relation is not derivable from the ticker string.

### AD-2 — One identity function, shared by the catalog and the importer

- **Decision**: create `src/lib/market/instrument-identity.ts` exporting exactly **one** pure function:

  ```ts
  /** The row's identity. Mirrors @@unique([ticker, type, venueCode, currencyCode]). */
  export function instrumentKey(i: {
    ticker: string; type: InstrumentType; currencyCode: string; venueCode: string | null;
  }): string {
    return `${i.ticker}|${i.type}|${i.currencyCode}|${i.venueCode ?? ""}`;
  }
  ```

  `identityKey()` in `catalog-sync.ts:35` (malformed — see §3.1) is deleted. `instrumentKey()` in `commit-import.ts:59` is deleted and re-imported from the new module, **byte-identical output**, so the importer's behaviour does not change at all. Both call sites now share one function.
- **Why this is correct forever on a reset database**: the key mirrors the DB's own `@@unique`, and under AD-0 the four components of a row never change after creation. Both sides of the reconciliation therefore compute the same string for the same listing on every run.
- **Rejected (rev. 1's `catalogKey`/`storageKey` split)**: it protected legacy rows whose currency was wrong at birth. With no legacy rows, the split buys nothing and costs a permanent invitation to use the wrong one of two near-identical functions.
- **Rejected**: leaving `identityKey` malformed. Today it is harmless by coincidence (§3.1); its literal `` ?? "}` `` suffix invites exactly the wrong fix.

### AD-14 — Store Docta's schedule verbatim; derive only for hand-entered bonds

**The problem, measured.** `AL30`'s `interest_rate` steps 0.13 → 0.5 → 0.75 → 1.75 across its 19 rows (`cashflow-AL30.json` lines 4, 5, 9, 17). `BondTerms.couponRate` is a single `Decimal`, and `projectCashFlows` (`src/lib/bonds/cashflows.ts`) derives each coupon as *rate × remaining principal ÷ periods per year*. **No single stored rate reproduces this bond.** And §8.3b's "infer `FIXED` when `interest_rate` is constant" would label it `FLOATING`, which makes `projectCashFlows` mark every coupon `assumedRate: true` and project at a last-known rate. AL30 is not floating — it is fixed and fully predetermined, merely stepped. Every 2020-restructuring sovereign behaves this way: AL29, AL30, AL35, AE38, GD29, GD30, GD35, GD38, GD41, GD46.

- **Decision**: add a **stored-schedule path**. When Docta supplies a cashflow, persist the per-period schedule verbatim and read it directly; `projectCashFlows` is bypassed entirely. `BondTerms` plus derivation remains the path for hand-entered bonds, unchanged.
- **rev. 6 correction (2026-09-16)**: this path applies to **ON exactly as it does to BOND_AR/LETRA** — `docta-enrichment.ts`'s `FIXED_INCOME_TYPES` already included `ON` from its first implementation (verified, not a gap). The manual "Cargar términos" form at `/bonds → Analítica v2` (`BondTermsInput`, `src/app/actions/bond-terms.ts`) is auto-fillable from Docta for ON exactly like it already is for sovereigns/letras — confirmed live: Yahoo's `quoteSummary` returns zero bond-term data for ON (`assetProfile`/`defaultKeyStatistics`/`bondData` all report no fundamentals; `quoteType: "EQUITY"`), so Docta is ON's only source for contractual terms, while Yahoo remains its only source for currency/settlement (AD-12). The `mapDoctaCashflow`/`mapDoctaSchedule` functions take no `InstrumentType` parameter — the step-up-refusal gate (R-3c) and every other rule in §8.3b applies identically regardless of which fixed-income type called them; there is no ON-specific branch to design or to miss. **`fixed-income-linking.ts`'s ISIN-based MEMBERSHIP linking (AD-13) is unaffected and does NOT include ON** — ON needs no ISIN linking because Yahoo already classifies its currency deterministically; only the schedule/terms path is shared.
- **Why**: deriving a schedule from parameters is strictly worse than reading the authoritative schedule when the authoritative schedule is in hand. Derivation exists to *reconstruct* what the issuer published; there is no reason to reconstruct it when it has been handed over.
- **Shape**: a `BondSchedule` row keyed by `instrumentId`, holding `source` (`"docta"`), `fetchedAt`, and a JSON array of `{ paymentDate, capital, interestRate, interestAmount, residualValue, cashFlow }` — Docta's rows with their names normalised. The bonds UI reads `BondSchedule` when present and falls back to `BondTerms` + `projectCashFlows` when absent. **One reader, two sources, explicit precedence** — the same shape as the sector fallback chain of AD-3.
- **This dissolves the §8.3b blockers.** `faceValue`, `currencyCode`, `rateType` and `dayCountConvention` were blockers *only because they fed derivation*. With nothing deriving, they stop gating:

  | §8.3b field | Under derivation (rev. 2) | Under the stored schedule |
  |---|---|---|
  | `faceValue` | Needed as the scaling basis | Schedule is already per-100; `scaleFlowsToHolding` divides by the same 100 |
  | `currencyCode` | **Hard blocker** — wrong currency mis-denominates every flow | Still needed **for display**, still from the name token table — but it no longer silently corrupts amounts, because the amounts are Docta's own |
  | `rateType` | Mislabels AL30 as FLOATING and fakes a forecast | **Not applicable.** A stored schedule is not a projection; there is nothing to assume |
  | `dayCountConvention` | ~1.4 % accrual error | **Not applicable.** Docta's `interest_amount` already embeds the real convention |

  Three of the four stop being questions. The §8.3b gate therefore applies **only to the `BondTerms` derivation path**, and the all-or-nothing rule of AD-7 is unchanged for it.
- **Rejected**: widening `BondTerms.couponRate` into a rate schedule. It would make every consumer of `BondTerms` handle two shapes, to reconstruct by derivation what Docta already provides directly.
- **Rejected**: storing the schedule and *also* deriving, to cross-check. Two sources of truth for one number, with no rule for which wins when they disagree.

### AD-3 — Sector lands on `Instrument`, read with a 3-step fallback chain

**Answers proposal §15.** See §2 for the full read path.

- **Decision**: add `sector String?` and `industry String?` to `Instrument`. Both providers write there (Yahoo for STOCK_AR/CEDEAR, Docta for ON/BOND_AR/LETRA). `UnderlyingAsset.sector` is **not** written to and **not** removed. Read precedence: `instrument.sector ?? instrument.baseInstrument.sector ?? instrument.underlyingAsset.sector ?? null`, then `translateSector` as the existing last resort.
- **Why not populate `UnderlyingAsset` (option B)**: `UnderlyingAsset.ticker` is `@unique` and the model is a dictionary of *real-world assets* with no venue/currency of its own. Populating it per BYMA ticker breaks on three counts: (a) Boeing's CEDEAR `BA` and Bank of America's `BA.C` cannot both own the row keyed `BA`; (b) an ON like `MCC3O` is not a real-world asset in the sense `UnderlyingAsset` models, so Docta's sector would have no legitimate home; (c) it would create ~1,700 dictionary rows whose only purpose is to hold one string, permanently confusing the CEDEAR→underlying semantics that `provider-routing.ts` already depends on (`underlyingAsset?.ticker` drives the FMP/Yahoo underlying symbol).
- **Why not `Instrument.sector` alone with no fallback**: the ~24 seeded `UnderlyingAsset.sector` values are correct data. Discarding them to avoid one `??` is a net loss; keeping them costs one extra `select`.
- **Variant no-duplication constraint (hard)**: enrichment **MUST NOT** write `sector`/`industry` onto a row where `baseInstrumentId IS NOT NULL`. `enrichUsedInstruments` filters those rows out and substitutes the base's id. A variant therefore reads sector exclusively through `baseInstrument.sector` — one value, one writer, no drift.
- Docta's `issuer`, `law`, `assetClass` also land on `Instrument` (proposal §14 "persist and surface"), under the same variant rule.
- **AD-0 applies here literally**: the enrichment patch type is `{ name?, isin?, sector?, industry?, issuer?, law?, assetClass?, website? }` and nothing else. Neither provider may write `currencyCode`, `settlement`, `baseInstrumentId`, `venueCode`, `ticker` or `type`. Yahoo's `currencyCode` field is read from the Python response and **discarded**.

### AD-4 — Linking is a pure band check over injected prices and rates

- **Decision**: `src/lib/market/settlement-matching.ts` is pure — inputs are a quote list and reference rates, output is a link plan. Zero DB, zero network. Full algorithm in §4.
- **Why**: `config.yaml`'s testing convention only unit-tests pure modules. This is the highest-risk new logic in the change (a false link silently mis-values a holding), so it must be on the tested side of the boundary. The Prisma orchestrator that applies the plan stays untested by design.
- **Rejected**: doing the band check inside `catalog-sync.ts`. Untestable under the repo convention, which is exactly the outcome the convention exists to prevent.

### AD-5 — Links are monotonic: confirmed once, never revoked by silence

**Kept in rev. 2.** It protects the valuation correctness of a *held position* against a transient thin-quote day — it never had anything to do with protecting the database.

- **Decision**: a sync writes `baseInstrumentId` / `settlement` / `currencyCode` when the band confirms a link. A sync that fails to confirm an existing link (thin day, missing quote, stale rate) leaves the stored link untouched. Only an explicit confirmed link to a *different* base overwrites.
- **Why**: the inverse is a value-corruption bug. A quiet trading day would flip a held USD variant back to `currencyCode = ARS`, and `quotes.ts` would immediately request `NVDAD.BA` again — the exact failure mode §5 of the proposal makes non-negotiable. Degradation must be "we learned nothing new", never "we forgot what we knew".
- **Escape hatch (new in rev. 2, affordable now)**: monotonicity means a *wrong* link is also permanent, which was uncomfortable while the DB was precious. It no longer is. `scripts/reset-settlement-links.ts` — a plain `tsx` script, not a route, not a cron — accepts an optional ticker list and runs:

  ```sql
  UPDATE "Instrument"
     SET "baseInstrumentId" = NULL, "settlement" = 'ARS', "currencyCode" = 'ARS'
   WHERE "baseInstrumentId" IS NOT NULL
     AND ($1::text[] IS NULL OR "ticker" = ANY($1));
  ```

  The next sync re-derives the links from scratch. This is the only sanctioned writer of `currencyCode` outside the link step (AD-0), it is manual, and it is the whole rollback story for a bad link. No UI, no action, no endpoint.

### AD-6 — `quotes.ts` consumes `provider-routing.ts`'s existing shape; no second mechanism

- **Decision**: extend `ResolvableInstrument` with `settlement: Settlement` and `baseInstrument?: { ticker: string } | null`, add a `seriesKind: "spot"` branch to `resolveMonitoringRouting` that returns `{ provider: "yahoo", externalSymbol: <base>.BA, currency: "USD" | "ARS" }`, and have `refreshLatestQuotes` call it instead of its inline `ARGENTINIAN_TYPES.has(type)` symbol build. When the resolution says `currency: "USD"`, `refreshLatestQuotes` multiplies by the CCL rate before writing `PriceCache`, using the same `resolveCclRate()` the ON branch already uses.
- **Why**: `provider-routing.ts` is already the only place in the codebase that branches on type + currencyCode + underlyingAsset and returns an explicit currency. Duplicating that shape inside `quotes.ts` creates two routing tables that drift. Proposal §4 Leg 2 states this explicitly.
- **Detail — which symbol a USD variant quotes under**: a linked variant is priced from its **base**'s `.BA` symbol at `currency: "ARS"`. A variant with no base link (`settlement = "USD"`, `baseInstrumentId IS NULL`) uses its own `.BA` symbol. `PriceCache` therefore stays in ARS for every row and `buildHoldings` / `valuatePortfolioAt` remain pure-ARS consumers. **`PriceCache` semantics are unchanged: always ARS.**
- **Corrected claim (rev. 3)**: rev. 1 justified this by asserting "Yahoo has no reliable `NVDAD.BA`". **That is measured false** — `NVDAD.BA` returns USD 9.22 (§R.2), and so does every variant probed. The decision stands, but on its real rationale: quoting the base keeps `PriceCache` single-currency, so no FX anchor becomes a hard dependency of every quote refresh, and a stale or missing CCL/MEP rate can never corrupt a displayed price. Quoting the variant directly in USD and converting is now a genuinely available alternative; it would reflect the variant's own spread, at the cost of making `PriceCache` currency-aware and putting the FX anchor on the critical path. **Monitored, not adopted** — proposal §3 rules the `PriceCache` refactor out of scope, and R-2's residual is better addressed by AD-12 than by a second price source.
- **Rejected**: storing USD into `PriceCache` and converting downstream. That would require currency awareness in `buildHoldings`, `valuatePortfolioAt`, `calculatePortfolioValuation` and `series.ts` — a far larger blast radius, most of it in untested orchestrators.

### AD-7 — `BondTerms` auto-fill only when no row exists, and only when every field is evidenced

- **Decision (part 1, unchanged — proposal §14 option B)**: "empty" means **no `BondTerms` row for that `instrumentId`**, not a row with null fields. `BondTerms` has no nullable business columns, so a row always means a user (or an accepted argen.bond proposal) committed values. If a row exists, Docta data is surfaced through the **existing** `getBondTermsProposalAction` proposal channel (`ScrapedBondProposal` shape), never written.
- **Decision (part 2, new in rev. 2)**: auto-fill is **all-or-nothing**. `mapDoctaCashflow` returns a complete `BondTerms` input only when every required field is derived from evidence; otherwise it returns a `ScrapedBondProposal` (nulls allowed) and **no row is created**. A partially-guessed row is strictly worse than a proposal: option B never revisits a row once it exists, so a wrong guess is permanent until the user notices it. Field-by-field justification in §8.3.
- **Why**: gives a precise, checkable predicate (`prisma.bondTerms.findUnique({where:{instrumentId}}) === null`) and reuses the already-shipped propose UI in `bonds-page.tsx` rather than building a second one. The all-or-nothing gate makes the propose channel — not a silent guess — the default outcome for anything Docta does not actually say.

### AD-8 — Docta is feature-gated on env presence; token cached in module memory

- **Decision**: `src/lib/market/docta-client.ts` exports `isDoctaEnabled()` = both `DOCTA_CLIENT_ID` and `DOCTA_CLIENT_SECRET` set. Every entry point short-circuits to a no-op when false. Base URL is a module constant (`https://api.doctacapital.com.ar/api/v1`, confirm at implementation). Token is minted on first use and held in a module-scope `{ token, expiresAt }`, refreshed at `expires_in - 300s`. Never persisted.
- **Why**: matches how `data912.com` / `finnhub.io` are already handled, and makes rollback a Vercel env-var deletion with no deploy (proposal §12).
- **Serverless caveat, stated not hidden**: module memory does not survive a cold start, so a cold invocation mints a fresh token. At one cron run/day plus occasional imports this is a handful of mints, well inside a 24h token's intent. If quota telemetry later says otherwise, the fallback is an `FxRate`-style persisted row — explicitly out of scope now.

### AD-9 — Import path does not await enrichment; cron path is capped and budgeted

**Answers open question 4.** Numbers in §9.

- **Decision**: delete the `enrichUsedInstruments` call from `commit-import.ts` entirely. Re-issue it from `commitImportAction` in `src/app/actions/imports.ts` inside `after(() => enrichUsedInstruments(ids).catch(warn))`. Cron keeps its inline `await` but gains a concurrency cap and an elapsed-time budget.
- **Why**: `commit-import.ts:247` awaits enrichment *inside* the try whose catch returns `"No se pudieron resolver los instrumentos del archivo"`. A Yahoo hiccup therefore fails an import of otherwise-valid transactions today, and two new providers make it strictly worse. `after()` is the Next 16 primitive for exactly this (verified §0): the response is sent, the work still runs, and a throw inside it cannot reach the user.
- **Rejected**: wrapping the existing call in its own try/catch. Fixes the failure mode but leaves unbounded external latency on a synchronous user-facing request.
- **Rejected**: a queue/worker. Explicit non-goal (proposal §3).

### AD-10 — One data912 live reader, two cache policies

- **Decision**: `data912-universe.ts` owns a single `fetchData912Live({ revalidateSeconds })` that returns `{ symbol, type, price, pctChange, ... }` per row across the five endpoints. `fetchInstrumentUniverse()` calls it with `revalidate: 3600` + tag `instrument-catalog` (the search self-heal path needs the cached read). `market-snapshots.ts`'s `fetchData912MarketSnapshots()` calls it with `cache: "no-store"`. `fetchEndpointSymbols` and `stripCurrencyVariants` are deleted.
- **Why**: the linking heuristic needs prices, and `fetchData912MarketSnapshots` already fetches exactly the payload that carries them from exactly the same five endpoints. Adding a second price fetch inside the sync would double data912 load for data already in hand. Two readers of one payload is the duplication this change should remove, not add.
- **Next 16 note**: fetch memoization does not apply in Route Handlers (§0), so the two policies genuinely produce two requests when both run in the same cron invocation. The sync therefore threads one `no-store` result through both the snapshot upsert and the linking step rather than calling twice.

### AD-11 — `venueCode` resolution and `taxJurisdiction` are unchanged

- **Decision**: `resolveVenueCode` keeps returning `"BYMA"` (or null if the `Venue` row is absent) for all five types. A settlement variant is listed on BYMA exactly like its base.
- **Why**: `venueCode` is a component of `instrumentKey` (AD-2), so changing how it resolves would move every row's key. Orthogonal to this change and left alone.

### AD-15 — Capped drip enrichment for unheld equity/CEDEAR profiles (added 2026-09-16, user-directed scope addition)

- **Decision**: `enrichUnusedEquityProfiles` (`yahoo-catalog.ts`) drips profile fields (`name`/`sector`/`industry`/`website` — whatever subset the existing Yahoo Python function already returns; no new scraped fields) for `STOCK_AR`/`CEDEAR` instruments that are neither held (already covered by `enrichUsedInstruments`) nor previously attempted, capped at `EQUITY_PROFILE_DRIP_LIMIT` (30) per `sync-catalog` run. Candidate selection (exclude held, order deterministically, slice to the cap) is a pure, tested function, `equity-profile-drip-plan.ts` — the Prisma read/write orchestration around it stays untested by convention (NFR-2).
- **Why a new `profileEnrichedAt` column, not inferring "unenriched" from `name === ticker`**: the latter false-positives whenever a real ticker's name happens to equal its symbol, and gives no way to distinguish "never tried" from "tried, Yahoo had nothing." The column is set on every attempt, success or not, so an un-enrichable ticker is not retried every single run forever.
- **Why capped, unlike Docta's linking budget**: Yahoo has no known daily quota (unlike Docta, AD-13's rev. 5 correction) — the cap exists purely to keep one run's fan-out bounded against ~1,687 `STOCK_AR`/`CEDEAR` symbols, not to respect a measured external limit. `ENRICH_CONCURRENCY`/`ENRICH_BUDGET_MS` (design §9.2) still bound the actual fan-out shape; `EQUITY_PROFILE_DRIP_LIMIT` bounds how many candidates enter it per run.
- **Scope, deliberately narrow**: `STOCK_AR`/`CEDEAR` only — never `BOND_AR`/`LETRA`/`ON` (Docta's job) — and profile fields only, never price history, never `PriceCache`/`MarketSnapshot`. Writes go through the same `EnrichmentPatch` type and AD-0 discipline as the held-instrument path — `currencyCode`/`settlement`/`baseInstrumentId`/`venueCode`/`ticker`/`type` are never in reach.

---

## 2. Sector — decision, schema, and the resulting read path

### 2.1 Options weighed

| Option | Covers rows with no `underlyingAssetId` | Fixed income has a home | Survives `BA` / `BA.C` | Variant reads through base | Verdict |
|---|---|---|---|---|---|
| A. `Instrument.sector` | Yes (all ~1,700) | Yes | Yes (per-row) | Yes, by write rule | **Chosen** |
| B. Populate `UnderlyingAsset` from Yahoo | No — requires creating a dictionary row per BYMA ticker | No | **No** — `ticker @unique` collides | Only via a second hop | Rejected |
| C. Hybrid write (both) | Yes | Partial | No | Two writers → drift | Rejected as a *write* strategy |

C is rejected as a write strategy but adopted as a **read** strategy: one writer (`Instrument`), three readers in precedence order.

### 2.2 Schema delta

```prisma
model Instrument {
  // ... existing fields unchanged ...
  sector     String?   // Yahoo `sector` (equities/CEDEARs) or Docta `sector` (fixed income)
  industry   String?   // Yahoo only
  issuer     String?   // Docta only
  law        String?   // Docta `law`, e.g. "Ley Argentina"
  assetClass String?   // Docta `asset_class`, e.g. "BOND"

  settlement       Settlement   @default(ARS)   // non-nullable (AD-1, rev. 2)
  baseInstrumentId String?                      // nullable for a SEMANTIC reason: a base has no base
  baseInstrument   Instrument?  @relation("InstrumentVariants", fields: [baseInstrumentId], references: [id])
  variants         Instrument[] @relation("InstrumentVariants")

  @@index([baseInstrumentId])
}

enum Settlement {
  ARS   // main board
  USD   // settles in USD; MEP vs CCL not determined (AD-1, rev. 3)
  MEP
  CCL
}
```

**Invariant (enforced in the enrichment orchestrator, not by the DB):** a row with `baseInstrumentId IS NOT NULL` has `sector = industry = issuer = law = assetClass = NULL`. Postgres cannot express this as a cheap CHECK across a self-FK without a trigger; a trigger is not worth it for descriptive metadata. The rule lives in one place — `enrichUsedInstruments` resolves each requested id to its base before writing.

### 2.3 Dashboard read path, concretely

`src/app/actions/dashboard.ts:56` — extend the select:

```ts
instrument: {
  select: {
    id: true, ticker: true, name: true, type: true,
    sector: true,
    baseInstrument:  { select: { sector: true } },
    underlyingAsset: { select: { sector: true } },
  },
},
```

`dashboard.ts:125` — replace the single-source read, and **also set it on the fixed-income branch**, which currently `continue`s before line 125 and therefore never records a sector at all:

```ts
const sector =
  r.instrument.sector ??
  r.instrument.baseInstrument?.sector ??
  r.instrument.underlyingAsset?.sector ??
  null;
sectorByInstrument.set(r.instrument.id, sector);   // now on BOTH branches
```

Second required edit, easily missed: `toDashboardHolding` (`src/lib/bonds/portfolio-bridge.ts:117`) hardcodes `sector: null`. It gains a `sector: string | null` parameter fed from the same map. Without this, Docta's sector reaches the DB but never reaches the donut.

`translateSector` (`src/lib/dashboard/build.ts:44`) is **unchanged**. Its type buckets (`Renta fija`, `ETF`, `Sin clasificar`) remain the last resort for a genuinely null sector, exactly as proposal §15 requires.

Flow:

```
Yahoo (equities/CEDEAR) ─┐
                         ├─→ enrichUsedInstruments ─→ Instrument.sector  (base rows only)
Docta (ON/BOND/LETRA) ───┘                                   │
                                                             ▼
seed UnderlyingAsset.sector ─────────────────→  dashboard select (3 sources)
                                                             │
                                              instrument.sector ?? base.sector ?? underlying.sector
                                                             │
                                                             ▼
                                              translateSector(raw, type)  ← unchanged fallback
                                                             │
                                                             ▼
                                                    SectorBar / AllocationDonut
```

---

## 3. Identity key — one function, and the ordering rule that keeps it stable

Rev. 1 devoted this section to proving that a full-key reconciliation would mass-delist pre-existing rows. On a reset database there are no pre-existing rows, so the proof, the 20 % shrink guard and the `?dryRun=1` rehearsal are all deleted. What remains is the correct key and the one ordering constraint that keeps it stable across runs.

### 3.1 What the current code actually does

`src/lib/market/catalog-sync.ts:42`

```ts
return `${i.ticker}|${i.type} ?? ""}`;
```

Only `${i.type}` interpolates. The trailing `` ?? ""}` `` is literal text appended **identically** to every key, universe-side (line 101) and DB-side (line 108). Removing an identical suffix from both sides of an equality is a no-op, so the effective reconciliation key today is exactly `ticker|type`. `currencyCode` and `venueCode` are ignored entirely, even though the DB's own constraint is stricter. It works by coincidence, and the commented-out full key next to it shows the author already knew where it should go.

### 3.2 The fix: one key, on both sides

`catalog-sync.ts` and `commit-import.ts` both call `instrumentKey` from `src/lib/market/instrument-identity.ts` (AD-2). Universe side and DB side compute the same four components:

| Component | Universe side (data912) | DB side |
|---|---|---|
| `ticker` | `row.symbol` | `instrument.ticker` |
| `type` | endpoint → `InstrumentType` | `instrument.type` |
| `venueCode` | `resolveVenueCode()` → `"BYMA"` | `instrument.venueCode` |
| `currencyCode` | `currencyForSettlement(settlement)`, where `settlement` comes from Yahoo (AD-12) or, where Yahoo 404s, the ratio — §3.3 | `instrument.currencyCode` |

`resolveCurrencyCode` in `catalog-sync.ts:142` — the ARS-for-everything fallback that caused rev. 1's whole problem — is **deleted**. Currency now comes from the currency oracle and nowhere else (AD-0, AD-12).

### 3.3 The ordering rule: resolve currency, then link, **then** reconcile

This is the one real constraint the single key imposes, and it sets the pipeline order (§5.1).

Both currency resolution (AD-12, a network lookup over the universe) and `planSettlementLinks` (pure over the data912 payload plus the FX anchors, §4) are computable **before** the reconciliation pass touches the DB. The order is therefore:

```
1  fetch live rows              (one reader, §AD-10)
2  snapshots                    (upsert prices)
3  resolveUniverseCurrencies()  ← AD-12. ARS | USD | 404→ratio | unavailable→ABORT creates
4  planSettlementLinks()        ← PURE. Splits the confirmed-USD set into MEP·CCL·USD.
5  apply the plan               ← in-place UPDATE by row `id` on rows that already exist
6  reconcile                    ← instrumentKey on both sides, now guaranteed to agree
7  enrich                       ← AD-0: never touches currencyCode
```

Step 3 before step 4 is what shrinks the ratio's search space to the confirmed-USD set. Step 5 before step 6 is what makes the key stable. A row created on an earlier run as `USD` and refined to `MEP` today is upgraded in place at step 5, so by step 6 the stored row and the universe row already agree and the row is never delisted-and-recreated. Note that the `USD → MEP` refinement does **not** change `currencyCode`, so it does not change the key at all — a second benefit of the four-value enum (AD-1). Step 5 resolves its targets by `ticker + type` because a link plan is expressed in tickers — that is a **lookup that updates by `id`**, not an identity, and it never decides listing status. No second exported key function exists.

### 3.4 Reconciliation cases on a reset database

| Case | Result |
|---|---|
| `GGAL/STOCK_AR` in universe, row exists as `GGAL\|STOCK_AR\|ARS\|BYMA` | match → keep active |
| `NVDAD/CEDEAR`, Yahoo says USD, row already `USD`/`MEP` | match → keep active |
| `NVDAD/CEDEAR`, Yahoo says USD, row still `ARS` from the importer | step 5 upgrades in place → step 6 matches → keep active |
| `NVDAD/CEDEAR`, ratio cannot split MEP·CCL this run, row is `MEP` from a prior run | AD-5: step 5 writes nothing; `currencyCode` is `USD` either way → key unchanged → keep active |
| `XYZ/CEDEAR` row exists, symbol absent from universe | no match → soft delist (correct: it really was delisted) |
| `MCC3O/ON` inactive in DB, back in universe | match → reactivate |
| data912 returns `[]` | **empty-universe guard** (`catalog-sync.ts:86`) bails out before any write — kept, see §R |
| Yahoo currency oracle unreachable | AD-12 fail-closed: no creates, no currency writes, `ok: false`. Delist/reactivate still run — they do not depend on currency for symbols whose rows already exist. |

The third row is AD-5 expressed at the key level, and it is now nearly free: because `currencyCode` is `USD` for all three of `USD`, `MEP` and `CCL`, refining the split can never move a row's key.

### 3.5 Duplicate detection (reporting only)

`@@unique([ticker, type, venueCode, currencyCode])` makes an exact duplicate impossible. A *near*-duplicate — the same ticker persisted under two currencies — is possible only if the importer's broker-attested currency disagrees with the catalog's band classification for a ticker the user holds. The sync counts and logs any `ticker+type` group with more than one row into `CatalogSyncResult.duplicateGroups` and surfaces it in the cron response. It is reporting, not a guard: on a reset database the acceptance check (§14, unit 8) is a single query that must return zero rows.

```sql
SELECT ticker, type, count(*) FROM "Instrument"
 WHERE "venueCode" = 'BYMA'
 GROUP BY ticker, type HAVING count(*) > 1;
```

`syncLatestData912Snapshots` (`market-snapshots.ts:67`) builds its own local `ticker|type` map by hand; it is switched to `instrumentKey` for consistency once its rows carry a currency, and its behaviour is otherwise unchanged.

---

## 4. Price-ratio linking algorithm

Lives in `src/lib/market/settlement-matching.ts`. **Pure — no Prisma, no fetch.**

**Scope narrowed twice.** Rev. 3: the ratio no longer detects variants and no longer decides currency — AD-12 does both for the 1,687 Yahoo-covered symbols. Rev. 4: it no longer establishes fixed-income membership either — AD-13's ISIN does that for the 221 sovereigns and letras. What is left is a refinement step with two inputs and no authority to create a link on its own:

| Universe slice | Count | Membership from | Settlement from |
|---|---|---|---|
| `arg_stocks` + `arg_cedears` + `arg_corp` | 1,687 | **Yahoo `meta.currency`** (AD-12) | price ordering (AD-13b) + ratio for the MEP/CCL split |
| `arg_bonds` + `arg_notes` | 221 | **Docta ISIN** (AD-13) | price ordering (AD-13b) + ratio for the MEP/CCL split |
| Neither answers | — | none | unlinked-but-tradable, FR-3 |

Two questions remain, and each is now asked over a small, pre-classified set:

1. **Which base** does a confirmed-USD variant belong to? Candidates are the confirmed-**ARS** symbols of the same type. Cross-class pairings are impossible by construction.
2. **MEP or CCL?** The nearest-anchor assignment, unchanged in method, applied only within the confirmed-USD set. When it cannot separate them, the row degrades to `settlement = USD` (AD-1) — it does **not** lose its link and never loses its currency.

### 4.1 Contract

```ts
export type SettlementQuote = {
  ticker: string;
  type: InstrumentType;
  /** data912 `c` (last). null/0/non-finite ⇒ this row is not eligible this run. */
  price: number | null;
  /** AD-12 verdict. "ARS" ⇒ base candidate · "USD" ⇒ variant · null ⇒ Yahoo 404, ratio-only. */
  currency: "ARS" | "USD" | null;
};

export type ReferenceRates = {
  /** ARS per USD, CCL. null ⇒ no CCL links this run. */
  ccl: number | null;
  /** ARS per USD, MEP. null ⇒ no MEP links this run. */
  mep: number | null;
  /** Date backing the rates. Older than MAX_RATE_AGE_DAYS ⇒ no links at all. */
  asOf: Date;
};

export type SettlementLink = {
  baseTicker: string | null;          // null ⇒ USD confirmed, base not identified
  variantTicker: string;
  type: InstrumentType;
  /** "USD" ⇒ settles in USD, MEP vs CCL not determined (AD-1). */
  settlement: "USD" | "MEP" | "CCL";
  ratio: number | null;
  /** |ratio/anchor - 1|, for logging and for the acceptance assertions. */
  distance: number | null;
};

export type LinkPlan = {
  links: SettlementLink[];
  /** ARS symbols evaluated as bases, and USD symbols whose split stayed open. */
  unlinked: Array<{ ticker: string; reason: "no-quote" | "no-candidate" | "out-of-band" | "ambiguous" }>;
  skippedReason?: "stale-rates" | "no-rates";
};

export function planSettlementLinks(
  quotes: SettlementQuote[],
  rates: ReferenceRates,
  now?: Date
): LinkPlan;
```

### 4.2 Constants (calibrated against the exploration's measurements)

| Constant | Value | Calibration |
|---|---|---|
| `TOLERANCE` | `0.02` (±2 %) | **Re-purposed in rev. 3.** It is no longer a false-positive filter against the whole universe — AD-12 already excluded every ARS symbol — but a **staleness sanity band**: a confirmed-USD/ARS pair whose ratio misses *both* anchors by more than 2 % is quoting off stale or broken prices, so the base pairing is not asserted. Measured ratios all land inside it: C-suffix 1577–1592, D-suffix 1510–1554. |
| `MIN_SEPARATION` | `0.005` (0.5 pp) | Minimum gap between the distance to the CCL anchor and to the MEP anchor. Below it the split is **undetermined** ⇒ `settlement = "USD"`. In rev. 1 this produced *no link*; that was only safe while the ratio was also the detector. Now the currency is already known, so withholding the link would discard evidence we hold. |
| `MAX_RATE_AGE_DAYS` | `3` | Weekend + one holiday. Beyond it the anchor is not comparable to today's quotes. |
| `PREFIX_AFFINITY` | `3` chars | Candidate **generator** only (see 4.3). |

### 4.3 Steps

0. **Group partition.** Split the input by how membership was already established: the AD-12 currency verdict (`USD` ⇒ variant, `ARS` ⇒ base candidate) for Yahoo-covered symbols, and the AD-13 ISIN group for fixed income. **A symbol with neither is not linked by this module** — it emits nothing and stays FR-3 unlinked-but-tradable. Rev. 3's "legacy path where the ratio decides both" is **deleted**: the ratio no longer establishes membership anywhere.
1. **Rate gate.** If both anchors are null/non-finite → `skippedReason: "no-rates"`. If `now - rates.asOf > MAX_RATE_AGE_DAYS` → `skippedReason: "stale-rates"`. **Changed in rev. 3:** the skip no longer empties `links`. Every confirmed-USD symbol still emits `{ settlement: "USD", baseTicker: null }`, because AD-12's verdict does not depend on an FX anchor. Only the MEP·CCL split and the base pairing are withheld. Proposal §13's rule — "skip rather than guess" — now applies to the split alone, which is all it ever meant.
2. **Eligibility.** Drop quotes with `price == null`, `price <= 0`, or `!Number.isFinite(price)`, recorded as `unlinked: "no-quote"`. A confirmed-USD symbol with no usable price still emits `settlement: "USD"` — losing the price must not lose the currency.
3. **Candidate generation — Yahoo-covered slice only.** For fixed income there is no candidate generation at all: the ISIN group *is* the membership, and step 3 is skipped. For the Yahoo-covered slice, pairs are formed only *within the same `InstrumentType`*, only USD-against-ARS (step 0), and only where `price(base) > price(variant)`. A variant `v` is a candidate for a base `b` iff `v.startsWith(b)` **or** the two share their first 3 characters. This is a search-space reduction, not a rule: it covers `YPFD→YPFDD` and `BA→BAC/BAD` by prefix, `TGNO4→TGN4D` (**measured**, §R.2), `TGSU2→TGSUD`, `TECO2→TECOD`, `AEC3O→AEC3D` by 3-char affinity. A pair it misses is simply not paired this run; the row keeps `settlement = "USD"` and stays correct. **No suffix rule decides anything** — and the sovereign rewrites that would have defeated it (`BA37D→BA7DC`, `X30N6→XN6D`) never reach this step.
4. **Ratio.** `r = price(b) / price(v)`.
5. **Nearest-anchor assignment.** `d_ccl = |r/rates.ccl - 1|`, `d_mep = |r/rates.mep - 1|` (a null anchor ⇒ `Infinity`). Accept the base pairing iff `min(d_ccl, d_mep) <= TOLERANCE`. Then split: if `|d_ccl - d_mep| >= MIN_SEPARATION`, assign the nearer anchor; otherwise assign `settlement = "USD"` and **keep the base link**.
   *Why nearest-anchor and not two independent bands:* two ±2 % bands around the CCL and MEP anchors overlap, and measured D ratios land inside the overlap. Independent bands would reject real MEP variants as ambiguous; nearest-anchor keeps them.
6. **One winner per variant.** A variant may pair with at most one base. If two or more bases pass step 5, emit `{ settlement: "USD", baseTicker: null }` — the currency is still asserted, only the pairing is withheld (`unlinked: "ambiguous"`).
7. A confirmed-USD symbol failing the tolerance against every candidate is `unlinked: "out-of-band"` and keeps `settlement: "USD"`, `baseTicker: null`.

**The invariant across steps 1–7**: nothing the ratio fails to do may ever downgrade `currencyCode`. Every degradation path ends at `settlement = "USD"`, never at `ARS`.

### 4.4 The measured cases — rev. 1's table was wrong and is replaced

Rev. 1 listed `DD`/`DDD` and `CC` as *rejections* and was about to freeze the first as a regression test. §R.2 measured both to be real variants. The corrected table uses the anchors implied by the measurement itself — **CCL ≈ 1582** (mean of the C-suffix ratios) and **MEP ≈ 1526** (mean of the D-suffix ratios):

| Pair | Yahoo currency | Measured ratio | `d_mep` (1526) | `d_ccl` (1582) | Result |
|---|---|---|---|---|---|
| `NVDA`/`NVDAC` | USD | 1591.9 | 4.3 % | 0.6 % | **CCL** |
| `NVDA`/`NVDAD` | USD | 1531.5 | 0.4 % | 3.2 % | **MEP** |
| `C`/`CC` | USD | 1577.2 | 3.4 % | 0.3 % | **CCL** — *not* Chemours |
| `BA`/`BAC` | USD | 1578.8 | 3.5 % | 0.2 % | **CCL** |
| `BA`/`BAD` | USD | 1509.8 | 1.1 % | 4.6 % | **MEP** |
| `GGAL`/`GGALD` | USD | 1528.4 | 0.2 % | 3.4 % | **MEP** |
| `YPFD`/`YPFDD` | USD | 1537.7 | 0.8 % | 2.8 % | **MEP** |
| `TGNO4`/`TGN4D` | USD | 1539.7 | 0.9 % | 2.7 % | **MEP** — across a ticker rewrite |
| `DD`/`DDD` | USD | 1554.3 | 1.9 % | 1.8 % | base pairing accepted; separation 0.1 pp < 0.5 pp ⇒ **`settlement = "USD"`**, link kept |
| `CARC` | **ARS** | — | — | — | **never reaches the ratio** — excluded by currency at step 0 |

Two tests replace the deleted one, and both are locked:

- **`DD`/`DDD` MUST produce a link** (`baseTicker = "DD"`, `currencyCode = "USD"`), and MUST NOT produce `ARS`. This is the regression test for the false negative that rev. 1 nearly canonised. Whether it resolves to `MEP` or to `USD` is anchor-dependent and is asserted as "one of", not pinned.
- **`CARC` MUST NOT be linked to anything**, because Yahoo reports it in ARS — asserted through the currency partition, *not* through a price band. This is what replaces the old `CAR`/`CAR.C` row: the protection now comes from the oracle, so it holds even on a day when the ratio would have been fooled.

### 4.5 Rate sourcing (the orchestrator's job, not the pure module's)

- **CCL anchor**: `prisma.fxRate.findFirst({ where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS", source: "CCL" }, orderBy: { date: "desc" } })` — read directly, because the linking step needs the row's **`date`** for the freshness gate and `resolveCclRate()` deliberately hides it (it falls back to "the last stored rate, however old"). `ccl-rate.ts` is **not** modified.
- **MEP anchor**: `dolarapi.ts` today exposes only CCL. Add `fetchMepQuote()` against `https://dolarapi.com/v1/dolares/bolsa` — same `DolarapiResponse` shape, same `next: { revalidate: 900 }` opt-in, same `null`-on-failure contract — and persist it via the existing `FxRate` upsert with `source: FxSource.MEP` (the enum value already exists, `schema.prisma:96`). One new function plus one upsert; no new model.
- If only one anchor resolves, the pure module still runs: the missing anchor is `Infinity`, `MIN_SEPARATION` is trivially satisfied, and only that settlement's links are produced.

### 4.6 Applying the plan (Prisma orchestrator, untested by convention)

Runs **before** reconciliation (§3.3), so the rows it touches are already correct when `instrumentKey` is computed.

```
resolveUniverseCurrencies()  →  planSettlementLinks(quotes, rates)
        │
        ▼
for each link:  UPDATE Instrument
                   SET baseInstrumentId = <base.id>,          -- NULL-safe: keeps a prior base
                       settlement       = link.settlement,     -- USD | MEP | CCL
                       currencyCode     = currencyForSettlement(link.settlement)  -- 'USD'
                 WHERE id = <variant.id>
for each ARS:   SET settlement = 'ARS', baseInstrumentId = NULL   (idempotent)
unlinked:       NO WRITE  ← AD-5: silence never revokes a confirmed link
```

**AD-5 refinement for the four-value enum**: a `MEP`/`CCL` row must never be downgraded to `USD` by a run that merely failed to separate the anchors, and a row with a known `baseInstrumentId` must never have it nulled by a `baseTicker: null` link. The apply step therefore writes `settlement` only when the incoming value is more specific than the stored one (`ARS < USD < MEP|CCL`), and writes `baseInstrumentId` only when the link names a base. Monotonicity is now a lattice, not a boolean, and that is the whole change.

Updates are batched by target value (`updateMany` per settlement) rather than one statement per row.

**This is the only post-creation writer of `currencyCode` (AD-0)**, apart from the manual `reset-settlement-links` script. A link whose variant ticker has no row yet is not applied here — the reconciliation pass immediately after creates it with the planned settlement and currency already set, so it is born correct and never needs an upgrade.

---

## 5. Data Flow

### 5.1 Cron `sync-catalog` (the reordered pipeline)

```
GET /api/cron/sync-catalog   (maxDuration = 300, force-dynamic)
  │
  ├─1 fetchData912Live({ cache: "no-store" })            one pass, 5 endpoints
  │      → rows: { symbol, type, price, bid, ask, ... }
  │
  ├─2 syncLatestData912Snapshots(rows)                   MOVED EARLIER — feeds step 3
  │
  ├─3 resolveUniverseCurrencies(symbols)                 AD-12 — the currency oracle
  │      POST /api/yahoo-metadata {mode:"currency"}      batched 25, cap 4 (§9)
  │      ARS | USD | 404→ratio-only | unavailable→ABORT creates, ok:false
  │
  ├─4 plan links                                         PURE, TESTED
  │      FxRate(CCL) + FxRate(MEP) ─┐
  │      currency-partitioned rows ─┴→ planSettlementLinks() → LinkPlan
  │
  ├─5 apply plan to EXISTING rows                        in-place UPDATE by id
  │      (AD-5 lattice: never downgrade · AD-0: only writer of currencyCode)
  │
  ├─6 reconcile  (instrumentKey, both sides)             ← AFTER 5, see §3.3
  │      creates   → createMany({ skipDuplicates: true })  born with the planned
  │                                                        settlement + currency
  │      reactivate→ updateMany(active: true)
  │      delist    → updateMany(active: false)  [empty-universe guard]
  │      duplicates→ logged, counted (§3.5)
  │
  └─7 enrichUsedInstruments(ids)             LAST, best-effort, capped + budgeted
         ├─ base-row resolution (AD-3 variant rule)
         ├─ descriptive columns ONLY (AD-0)
         ├─ STOCK_AR/CEDEAR → POST /api/yahoo-metadata  (batched, §10)
         └─ ON/BOND_AR/LETRA → Docta instruments + cashflow (§8)
```

Rationale for the order: the currency oracle (3) runs before linking so the ratio only ever searches a pre-partitioned set; linking (4–5) runs **before** reconciliation so both sides of `instrumentKey` agree on currency (§3.3); and enrichment — the only unbounded-latency step — sits at the tail so it can never starve the steps that matter. Steps 3 and 7 both call the Yahoo function, with different modes and opposite write permissions (AD-0's table).

### 5.2 A USD variant's valuation read (Leg 2)

```
getTransactionsPageDataAction / getDashboardPageDataAction
  → refreshLatestQuotes([{ id, ticker, type, currencyCode, settlement, baseInstrument }])
       → resolveMonitoringRouting(inst, "spot")            ← provider-routing.ts, reused
            baseInstrumentId != null → { externalSymbol: `${base.ticker}.BA`, currency: "ARS" }
            baseInstrumentId == null → { externalSymbol: `${ticker}.BA`,      currency: "ARS" }
            (branches on the LINK, not on settlement: a settlement = "USD" row
             with a known base still prices off the base — AD-6)
       → fetchYahooQuote(symbol)
       → PriceCache.upsert(close = ARS)                     ← semantics unchanged
  → buildHoldings(trades, pricesArs, eventsMap)             ← unchanged, pure ARS
```

### 5.3 Import commit (AD-9)

```
commitImportAction  (server action)
  → commitImportBatch(...)                 ← enrichment call REMOVED from here
       resolveInstrumentsBatch (instrumentKey)
       prisma.$transaction([...])
       return { ok: true, importBatchId, imported, skipped, duplicatesImported }
  → revalidatePath(...)
  → after(() => enrichUsedInstruments(ids).catch(warn))     ← non-blocking, cannot fail the commit
  → response to user
```

---

## 6. Schema delta and reset strategy

**The database is disposable (§R).** There is no additive migration and no backfill. The schema is shaped correctly rather than shaped to accommodate rows that will not exist.

### 6.1 Migration `instrument_settlement_and_metadata`

```sql
CREATE TYPE "Settlement" AS ENUM ('ARS', 'USD', 'MEP', 'CCL');

ALTER TABLE "Instrument"
  ADD COLUMN "settlement"       "Settlement" NOT NULL DEFAULT 'ARS',   -- non-nullable (AD-1)
  ADD COLUMN "baseInstrumentId" TEXT,                                  -- nullable: a base has no base
  ADD COLUMN "sector"           TEXT,
  ADD COLUMN "industry"         TEXT,
  ADD COLUMN "issuer"           TEXT,
  ADD COLUMN "law"              TEXT,
  ADD COLUMN "assetClass"       TEXT;

ALTER TABLE "Instrument"
  ADD CONSTRAINT "Instrument_baseInstrumentId_fkey"
  FOREIGN KEY ("baseInstrumentId") REFERENCES "Instrument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Instrument_baseInstrumentId_idx" ON "Instrument"("baseInstrumentId");

-- AD-13: isin already exists (schema.prisma:267) and is written by nobody today.
-- Index it for the grouping query. NEVER make it UNIQUE — variants share an ISIN.
CREATE INDEX "Instrument_isin_idx" ON "Instrument"("isin");

-- AD-14: Docta's schedule stored verbatim, bypassing projectCashFlows.
CREATE TABLE "BondSchedule" (
  "id"           TEXT PRIMARY KEY,
  "instrumentId" TEXT NOT NULL UNIQUE REFERENCES "Instrument"("id") ON DELETE CASCADE,
  "source"       TEXT NOT NULL,          -- 'docta'
  "rows"         JSONB NOT NULL,         -- [{paymentDate, capital, interestRate,
                                          --   interestAmount, residualValue, cashFlow}]
  "fetchedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL
);

-- CorporateEvent.createdByUserId becomes nullable so the seed can load
-- known public corporate actions with no creator (§6.3).
ALTER TABLE "CorporateEvent" ALTER COLUMN "createdByUserId" DROP NOT NULL;
```

`@@unique([ticker, type, venueCode, currencyCode])` is **kept unchanged** — it is the contract `instrumentKey` mirrors (AD-2).

### 6.2 Reset runbook — the order is load-bearing

| # | Step | Why this position |
|---|---|---|
| 1 | `prisma migrate reset --force` | Drops and recreates. Everything below regenerates. |
| 2 | `prisma db seed` | Currencies, venues, underlying assets, brokers, instruments, cash instruments — **plus** the corporate events of §6.3. |
| 3 | `GET /api/cron/sync-catalog` | Creates the full data912 universe with the correct `currencyCode` and `settlement` from birth (§3.3), links variants, enriches sector/industry/issuer. |
| 4 | Re-import the Balanz statements through the existing import UI | Every instrument the user holds already exists with a confirmed currency, so the importer's `p.currencyCode` (broker-attested) matches an existing row and resolves it instead of creating a near-duplicate. |
| 5 | Acceptance queries (§14, unit 8) | Duplicate check (§3.5) must be empty; sector coverage and linked-variant counts recorded. |

Running step 4 before step 3 is not wrong, only noisier: the importer would create the held rows as ARS and step 3's link pass would upgrade them in place (§3.3, row 3 of the table). The documented order avoids the upgrade entirely.

### 6.3 Seeding the SPY corporate event

Verified: `prisma/seed.ts` creates **no** `User` (currencies, venues, underlying assets, brokers, instruments, cash instruments only), and `CorporateEvent.createdByUserId` is `String` with an FK to `User` (`schema.prisma:519-520`). The seed therefore cannot create the event as written.

- **Decision**: make `createdByUserId` nullable. The existing `@@unique([instrumentId, effectiveDate, eventType])` (`schema.prisma:522`) already treats a corporate event as a **global fact about the instrument**, not a user's record; the creator is audit metadata, and audit metadata is legitimately absent for a fact the system itself knows.
- **The one entry to seed** is `RECOMMENDED_EVENTS` in `src/lib/events/recommended.ts:29`: SPY, `CEDEAR_RATIO_CHANGE`, effective `2026-06-01`, numerator `3`, denominator `1`.
- **Implementation**: the seed first upserts the `SPY / CEDEAR / BYMA / ARS` instrument (it is not in the seed today) on the existing `ticker_type_venueCode_currencyCode` compound key, then upserts the event on `instrumentId_effectiveDate_eventType` with `createdByUserId: null`. Both are idempotent, so re-running the seed is safe and step 3 of the runbook will not duplicate the instrument (`createMany({ skipDuplicates: true })` plus the unique constraint).
- **The seed reads `RECOMMENDED_EVENTS`; it does not re-declare the values.** One source, so the recommendation card and the seeded fact can never disagree. `resolveApplicableRecommendations` already suppresses a recommendation whose event exists, so the card correctly stops appearing after a reset.
- **Known consequence, accepted**: `deleteCorporateEvent` (`src/app/actions/events.ts:313`) filters on `createdByUserId: user.id`, so a seeded event with a null creator is **not deletable from the UI**. That is the right default for a public corporate action loaded by the system — removing it is a seed edit or one SQL statement, and the alternative (widening the delete filter) would let a user delete a global fact by accident. No change to `events.ts` is in scope.

### 6.4 Rollback

The rollback for a personal, disposable database is the runbook itself: reset, reseed, resync, reimport (§6.2). The migration's own reverse (`DROP INDEX`, `DROP CONSTRAINT`, `DROP COLUMN ×7`, `DROP TYPE`, re-`SET NOT NULL` on `createdByUserId`) still exists and is still clean, but it is no longer the primary recovery path. A bad settlement link is reverted by `scripts/reset-settlement-links.ts` (AD-5) without touching the schema.

---

## 7. Module boundaries — what is tested and what is not

Per `config.yaml`: only pure modules are unit-tested; Prisma-backed orchestrators are deliberately excluded. Risky logic therefore moves **into** pure modules.

| Module | Kind | Tested | Responsibility |
|---|---|---|---|
| `src/lib/market/settlement-matching.ts` | **Pure** | **Yes** | `planSettlementLinks` — band check, nearest-anchor, ambiguity, counter-examples. |
| `src/lib/market/instrument-identity.ts` | **Pure** | **Yes** | `instrumentKey` — the single identity (AD-2). Assert byte-identical output to the deleted `commit-import.ts` version. |
| `src/lib/market/settlement-classify.ts` | **Pure** | **Yes** | `currencyForSettlement(settlement)` → `"ARS"` for `ARS`, `"USD"` for `USD\|MEP\|CCL`; plus `moreSpecific(stored, incoming)` — the AD-5 lattice (`ARS < USD < MEP\|CCL`). Shared by catalog-sync and the importer so they cannot disagree. |
| `src/lib/market/docta-mapping.ts` | **Pure** | **Yes** | `mapDoctaInstrument(json)` → metadata **+ ISIN** (incl. mojibake fix); `mapDoctaSchedule(json)` → `BondSchedule` rows (AD-14); `mapDoctaCashflow(json)` → gated `BondTerms` input. Tested against `__fixtures__/docta/`. |
| `src/lib/market/isin-grouping.ts` | **Pure** | **Yes** | `groupByIsin(rows)` → variant groups (AD-13); rejects null/blank ISINs rather than grouping them together. |
| `src/lib/utils/concurrency.ts` | **Pure** | **Yes** | `mapWithConcurrency(items, limit, fn)` — assert max in-flight ≤ limit, order preserved, one rejection does not sink the batch. |
| `src/lib/market/provider-routing.ts` | **Pure** | **Yes** (rewritten) | `resolveMonitoringRouting` + the new `"spot"` branch. The two broken assertions are fixed, not deleted: `hasUsdUnderlying` is not a field of `ResolvableInstrument`; the function never returns null. |
| `src/lib/market/catalog-sync.ts` | Prisma orchestrator | **No** | Wiring only. All decisions delegated to the pure modules above. `resolveCurrencyCode` (the ARS fallback) is deleted. |
| `src/lib/market/quotes.ts` | Prisma orchestrator | **No** | Wiring only; the symbol/currency decision comes from `provider-routing.ts`. |
| `src/lib/market/docta-client.ts` | Network orchestrator | **No** | Token mint/cache + two GETs. Parsing lives in `docta-mapping.ts`. |
| `src/lib/market/yahoo-metadata-client.ts` | Network orchestrator | **No** | HTTP adapter to the Python function: `fetchYahooMetadataBatch` (enrichment) and `resolveUniverseCurrencies` (AD-12 oracle). The `CurrencyVerdict` **mapping** — status + body → `currency \| not-listed \| unavailable` — is extracted into a pure `parseCurrencyVerdict` and tested; only the transport stays untested. |
| `src/lib/importers/commit-import.ts`, `src/app/actions/*` | Prisma orchestrators | **No** | Per convention. |

The rule this table encodes: **every decision that can silently produce a wrong number lives on the tested side of the line.**

---

## 8. Docta client and `BondTerms` auto-fill

### 8.1 Endpoints and env

| Concern | Decision |
|---|---|
| Env vars | Exactly `DOCTA_CLIENT_ID`, `DOCTA_CLIENT_SECRET`. Nothing else. |
| Base URL | Module constant, like `data912.com` / `finnhub.io` today. |
| ISIN | `data[0].isin` → `Instrument.isin`. **The linking key (AD-13)**, not merely metadata. |
| Token | `POST /auth/token` `{grant_type:"client_credentials", client_id, client_secret}` → `{access_token, expires_in: 86400}`. Minted at runtime, held in module memory, refreshed at `expires_in - 300`. **Never** in `.env`, never persisted (AD-8). |
| Metadata | `GET /bonds/instruments/{TICKER}` (**no trailing slash** — measured 2026-09-16 against the live service: a trailing slash returns HTTP 404; an earlier revision of this document documented the slash and was wrong) → `data[0]` → `Instrument.name/isin/sector/issuer/law/assetClass/subAssetClass`. **Also the linking key (AD-13)** — this call carries two jobs. Held-first, budget-capped per run (rev. 5 correction, AD-13) — it does NOT run for all 221 fixed-income tickers in one pass. |
| Cashflow | `GET /bonds/analytics/{TICKER}/cashflow?nominal_units=100` → `BondSchedule` (AD-14), and `BondTerms` only via the §8.3b gate. **No longer used for linking**, so it runs only for instruments the user **holds**, not for the whole universe — and draws on the SAME 15/day quota as the metadata/linking call above. |
| Caching | Both payloads land in `ScrapedBondData` (`ticker @unique`, `payload Json`, `fetchedAt`). A successful response AND a confirmed 404 are both immutable, permanent answers, cached identically — a cached ticker (either outcome) is never re-fetched. A `429` or a transport error is NEVER cached (no evidence either way). Steady-state daily cost: **zero, after the initial ramp** (measured 15/day, 10/minute — see the rev. 5 correction in AD-13; this was previously stated as unconditionally zero, which was wrong). |
| Scopes not used | `stocks:read`, `cedears:read`, `fci:read` — granted by the token, deliberately unused (proposal §3). See §16 item 7: `stocks:read`/`cedears:read` may expose ISIN for equities, which is worth measuring but is **not** designed for here. |
| Failure | `429` → `{ kind: "rate-limited" }`, no retry, no cache write — the caller MUST stop starting new lookups this run. A confirmed `404` → `{ kind: "not-found" }`, cached permanently. Any other non-2xx, timeout, or parse failure → `{ kind: "error" }`, logged at `warn`, no write, never propagates, safe to retry a later run. |

### 8.2 Mojibake normalization (verified against the fixture)

`instruments-MCC3O.json` contains `"Pecom Servicios Energã­A S.A.U. 2030 U$S 7.50% (MCC3O)"`. This is UTF-8 bytes for `í` (`C3 AD`) decoded as Latin-1 (`Ã­`) and then upper/title-cased somewhere upstream, which destroyed the `Ã` case. Pure fix in `docta-mapping.ts`:

```
1. Latin-1 round-trip:  Buffer.from(raw, "latin1").toString("utf8")
2. If the result contains U+FFFD, or the input had no chars in U+0080–U+00FF, keep the raw string.
3. Title-case normalization of the repaired string is NOT attempted — casing damage is
   upstream and unrecoverable; only the byte-level mojibake is repaired.
```

Because the source has been case-folded (`ã­` not `Ã­`), step 1 alone does not recover `í`. The mapping therefore applies the round-trip **after** a targeted lowercase-sequence table for the sequences Docta actually emits, seeded from the fixture (`ã­`→`í`, `ã¡`→`á`, `ã©`→`é`, `ã³`→`ó`, `ãº`→`ú`, `ã±`→`ñ`). **The unit test asserts `Energã­A` → `EnergíA` against the captured fixture**, and the table is extended only when a new fixture proves a new sequence. Guessing beyond captured evidence is explicitly out of scope — an unrepaired name is cosmetic, a wrongly repaired one is a silent data error.

### 8.3 Cashflow → `BondSchedule` (primary) and `BondTerms` (gated)

**Primary path — `mapDoctaSchedule` (AD-14).** Every row is copied through with its names normalised and nothing derived:

| `BondSchedule` field | Source | Rule |
|---|---|---|
| `paymentDate` | `payment_date` | verbatim |
| `capital` | `capital` | verbatim, per 100 nominal |
| `interestRate` | `interest_rate` | verbatim — **the step sequence is preserved**, which is the whole point (§R.3 item 3) |
| `interestAmount` | `interest_amount` | verbatim — already embeds Docta's day-count convention |
| `residualValue` | `residual_value` | verbatim |
| `cashFlow` | `cash_flow` | verbatim |

No `couponRate`, no `rateType`, no `dayCountConvention`, no inference of any kind. A unit test asserts that `mapDoctaSchedule(cashflow-AL30.json)` yields 19 rows whose `interestRate` sequence contains all four distinct steps — the assertion that would fail under any single-rate model.

**Secondary path — `mapDoctaCashflow` → `BondTerms`**, retained for parity with the hand-entry model and used only where the §8.3b gate passes. What Docta's cashflow covers for it (verified against `__fixtures__/docta/cashflow-MCC3O.json`):

| `BondTerms` field | Source | Rule |
|---|---|---|
| `couponRate` | `data[0].interest_rate / 100` | **Critical:** Docta sends `7.5`; `validateBondTermsInput` (`bond-terms.ts:103`) rejects `couponRate > 1`. The mapping divides by 100. A unit test asserts `7.5 → 0.075`. |
| `couponFrequencyMonths` | modal month gap between consecutive `payment_date`s | Fixture gives 6. Modal, not first-gap, so an irregular first period does not skew it. |
| `issueDate` | `data[0].issue_date` | Constant across rows in the fixture. |
| `maturityDate` | last `payment_date` | |
| `amortizationSchedule` | rows with `capital > 0` → `{ date: payment_date, principalPct: capital }` | Must sum to 100 (validator). Deviation > 0.01 ⇒ no auto-fill. |

### 8.3b The four fields Docta does **not** provide — decision per field

**Scope after AD-14**: this gate governs the **`BondTerms` derivation path only**. A Docta-sourced bond reads its `BondSchedule` and never reaches `projectCashFlows`, so three of these four stop being questions for it (AD-14's dissolution table). The gate still governs the argen.bond proposal channel and any bond whose schedule Docta does not serve.

`BondTerms` has no nullable business columns, so all nine must be supplied to create a row. Per AD-7 the write policy is option B (fill only when no row exists, propose otherwise), which means an auto-filled row is **never revisited**. A wrong guess is therefore permanent until the user notices it, while a proposal costs one click. The gate below is calibrated on that asymmetry.

| Field | What Docta actually gives | Decision | Justification |
|---|---|---|---|
| `faceValue` | Nothing. `nominal_units=100` is a **request parameter we sent**, not the bond's denomination. | **Set `100`. Safe.** | Not a guess about the bond — it is the basis the schedule is expressed in. `projectCashFlows` computes every amount as `faceValue × pct/100` (`cashflows.ts:217,235`) and `scaleFlowsToHolding` then divides by the same `terms.faceValue` (`cashflows.ts:275`). Every scaled amount is homogeneous of degree 1 in `faceValue`, so it **cancels exactly**. The unscaled per-lámina view is per-100, which is also what `100` labels. A unit test asserts the cancellation: projecting with `faceValue = 100` and with `faceValue = 1000` yields identical scaled flows for the same `nominalHeld`. |
| `currencyCode` | Not a field. Only embedded as text in `name` (`"… 2030 U$S 7.50%"`). | **Parse `name` against an explicit token table; no match ⇒ NO auto-fill, propose instead.** | Tokens: `U$S`, `US$`, `USD`, `Dólar`/`Dolar` ⇒ `USD`; `$` **alone is not a token** — it is ambiguous in Argentine usage and matching it would silently denominate a hard-dollar ON in pesos. There is no safe default: `Instrument.currencyCode` is the row's *settlement* currency (AD-0), a different concept from the bond's denomination, and for a BYMA-traded hard-dollar ON the two genuinely differ. A wrong currency mis-denominates every projected flow — exactly the money error §11 of the proposal exists to prevent. |
| `rateType` | Inferable only as "the `interest_rate` column is constant" — **and that inference is measured wrong for step-up bonds** (§R.3 item 3): AL30's stepped 0.13→0.5→0.75→1.75 is fixed and fully predetermined, yet a varies-across-rows rule labels it `FLOATING`. | **A varying `interest_rate` now blocks the `BondTerms` path outright** (propose, never auto-fill), because a step-up cannot be represented by a single `couponRate` at all. Constant rate + no floating marker (`BADLAR`, `TAMAR`, `CER`, `UVA`, `VARIABLE`) ⇒ `FIXED`; constant rate + marker ⇒ `FLOATING`. | Rev. 2 treated a varying rate as "label it FLOATING and carry on", which would have projected AL30 at a fake last-known rate with every coupon flagged `assumedRate: true`. The real answer is that such a bond does not belong on the derivation path at all — **AD-14 routes it to the stored schedule**, where the steps are preserved exactly. Blocking here is not a loss of coverage; it is the handoff. |
| `dayCountConvention` | Absent. | **Do not write the column; let the schema default `ACT/365` apply.** | The manual form already defaults to `ACT/365` (`schema.prisma:552`), so the auto-fill is not worse than the path it replaces, and the field stays user-editable. Residual: on a 30/360 or ACT/360 bond the accrued-interest day fraction is off by up to ~1.4 %. Recorded as R-3; not a blocker, because Docta supplies no evidence either way and blocking would suppress every auto-fill for a defect the status quo already has. |

**Auto-fill gate (all must hold; otherwise the mapping returns a `ScrapedBondProposal` and no row is created):**

```
interest_rate is CONSTANT across all rows        (a step-up goes to BondSchedule, AD-14)
AND currencyCode resolved from the name token table   (no default, no fallback)
AND 0 < couponRate <= 1
AND |sum(amortizationSchedule.principalPct) - 100| <= 0.01
AND couponFrequencyMonths resolved and > 0
AND issueDate < maturityDate
```

`faceValue` is never gating — it is dimensionally neutral. `dayCountConvention` is never written. A failure of the first condition is a **routing** outcome, not a degradation: the bond gets a stored schedule instead, which is strictly better than the `BondTerms` row it did not get.

### 8.4 Write policy (AD-7)

```
enrich ON/BOND_AR/LETRA
  → docta instruments  → Instrument metadata (name/isin/sector/issuer/law/assetClass/subAssetClass)
  │                      AND the ISIN link key (AD-13)     ← ALL 221 fixed-income tickers
  │
  → docta cashflow                                         ← HELD instruments only
  │    (no longer needed for linking, so it stops being a whole-universe cost)
        │
        ├─ mapDoctaSchedule() → UPSERT BondSchedule        ← PRIMARY (AD-14), always
        │
        └─ mapDoctaCashflow() → BondTerms parity path
              ├─ BondTerms row absent AND §8.3b gate passes → CREATE it   (auto-fill)
              ├─ BondTerms row absent AND gate FAILS        → write ScrapedBondData → propose
              └─ BondTerms row present → write ScrapedBondData(payload, source="docta")
                                          → surfaced by getBondTermsProposalAction as a
                                            ScrapedBondProposal in the EXISTING propose UI
```

`src/lib/bonds/cashflows.ts` is **unchanged** — `projectCashFlows` keeps its exact current behaviour for hand-entered bonds, and `scaleFlowsToHolding` serves both paths. What changes is one reader above it: the bonds page resolves `BondSchedule` first and falls through to `BondTerms` + `projectCashFlows` only when there is none. `getBondTermsProposalAction` gains a Docta branch preferred over argen.bond when Docta returns data; the `ScrapedBondProposal` type and the propose UI are untouched.

---

## 9. Concurrency, cron budget, and the measurement that must precede the cap

**Answers open question 4.**

### 9.1 Measure first

Before fixing any number, run against production:

```sql
SELECT COUNT(DISTINCT "instrumentId") AS distinct_instruments
FROM "Transaction"
WHERE "instrumentId" IS NOT NULL;
```

This is the true cost driver — `enrichUsedInstruments` is scoped to `findMany({ distinct: ["instrumentId"] })`. The exploration's "tens, not hundreds" is inference, not measurement (proposal §10). The result goes in `tasks.md` as a recorded fact.

### 9.2 Decisions

| Knob | Decision | Rationale |
|---|---|---|
| Concurrency cap (both paths) | **4**, from `ENRICH_CONCURRENCY` (module constant, not env) | Yahoo batches 25 symbols per HTTP call (§10), so 4 in flight ≈ 100 symbols in flight — ample for a "tens" workload without hammering either provider. Revise **only** if the measurement exceeds ~300. |
| Yahoo request shape | Batched, 25 items/request | Turns N round-trips into ⌈N/25⌉. This is the single biggest latency win and it is what makes a cap of 4 sufficient. |
| **Currency oracle fan-out (AD-12)** | Same batch size and cap; **separate budget** `CURRENCY_BUDGET_MS = 90_000` | ~1,700 symbols ⇒ ~70 batches ⇒ ~18 waves at concurrency 4. Unlike enrichment it is **not** best-effort: exhausting the budget means the run is blind, so it reports `currencyOracle: "unavailable"` and skips creates (AD-12) rather than proceeding with partial knowledge. This is the one step in the pipeline where a timeout must halt work instead of degrading it. |
| Docta request shape | Per-instrument (no batch endpoint exists) | Same cap of 4; only fixed-income instruments the user actually holds reach it. |
| Elapsed budget | `ENRICH_BUDGET_MS = 120_000` | `mapWithConcurrency` stops *starting* new work past the budget and returns partial. Enrichment can never consume the whole cron window. |
| Per-request timeout | `AbortSignal.timeout(20_000)` | Matches the 20 s `execFile` timeout being removed, so the worst case does not regress. |
| `sync-catalog` `maxDuration` | **300** | `vercel.json` sets none today, so it runs on the plan default. `backfill-prices` already exports `maxDuration = 300` and works, so 300 is proven on this plan. Declared in the route segment config, not `vercel.json`. |
| Import path awaits enrichment? | **No** — `after()` in the server action (AD-9) | An enrichment failure must never fail a commit of valid transactions. |
| `after()` budget | Governed by `commitImportAction`'s route `maxDuration` (Next 16, §0) | Documented so a future `maxDuration` reduction is understood to shorten enrichment too. |

### 9.3 Failure isolation summary

| Failure | Blast radius after this change |
|---|---|
| Yahoo function 5xx / timeout during **enrichment** | One batch's items lack metadata. Sync and import both succeed. |
| Yahoo function 5xx / timeout during the **currency oracle** | AD-12 fail-closed: no rows created, no currency written, existing rows untouched, `ok: false`. Delist/reactivate still run. **Never a silent ARS default.** |
| Yahoo 404 for a symbol | Evidence of absence. Ratio-only path (sovereigns). Not an error. |
| Docta token mint fails | Fixed-income enrichment is a no-op. Sync and import both succeed. |
| Docta env vars absent | Provider disabled entirely (AD-8). No error path. |
| data912 endpoint down | Existing guard: empty universe → catalog untouched. |
| dolarapi down and `FxRate` stale >3 days | `skippedReason: "stale-rates"` — the MEP·CCL split and base pairing are withheld, but confirmed-USD rows still get `settlement = "USD"` from AD-12. Existing links preserved (AD-5). Degraded from "we know which", never to "we forgot it is USD". |

---

## 10. The Python function contract

**Answers open question 5.**

### 10.1 Files

| Path | Role |
|---|---|
| `api/yahoo-metadata.py` | Vercel file-based Python function. Routed publicly at `/api/yahoo-metadata`. HTTP + auth only. |
| `api/_yahoo_catalog.py` | The normalization logic lifted verbatim from `scripts/yahoo_catalog.py` (`normalize_symbol`, `resolve_yahoo_symbol`, `enrich_catalog_instrument`). The leading underscore keeps Vercel from routing it. |
| `requirements.txt` | Repo root. Exactly `yfinance==0.2.*` (pin the exact patch at implementation). `pandas`/`numpy` arrive transitively; they are **not** listed, so a yfinance bump cannot fight a pin we invented. |
| `scripts/yahoo_catalog.py` | **Deleted** — its logic moved, its CLI had one caller. |
| `src/lib/market/yahoo-catalog.ts` | `execFile`, `promisify`, and `lookupYahooCatalogMetadata`'s subprocess body deleted. `enrichUsedInstruments` and `supportsYahooMetadata` stay. |
| `src/lib/market/yahoo-metadata-client.ts` | New. `fetchYahooMetadataBatch(items)` → HTTP adapter. |

### 10.2 Authentication — it will be publicly routable

The function has no Next.js middleware in front of it and no session. It is protected by a shared secret.

| Concern | Decision |
|---|---|
| Env var | **`INTERNAL_FUNCTION_SECRET`** — set in Vercel for the whole project, so both the Next runtime and the Python runtime read the same value. |
| Header | `X-Internal-Token: <secret>` |
| Comparison | `hmac.compare_digest` — constant-time. Never `==`. |
| Secret absent in the Python process | **Fail closed**: respond `401`. A missing secret must never mean "no auth required". |
| Header absent or mismatched | `401 {"error":"unauthorized"}`, no body echo, no timing-revealing early return before the compare. |
| Rotation | Change the Vercel env var and redeploy; both sides pick it up together. No code change. |
| Why not Vercel Deployment Protection | It would also block the Next runtime's own server-to-server call on preview deployments, which is exactly where the proposal requires this to be verified (§10). The shared secret works identically in preview and production. |

### 10.3 Request / response

```http
POST /api/yahoo-metadata
X-Internal-Token: <INTERNAL_FUNCTION_SECRET>
Content-Type: application/json

{ "origin": "data912",
  "items": [ { "symbol": "GGAL", "type": "CEDEAR" },
             { "symbol": "YPFD", "type": "STOCK_AR" } ] }
```

```http
200 OK
{ "results": [
    { "symbol": "GGAL", "ok": true,
      "data": { "symbol":"GGAL", "instrumentType":"CEDEAR", "provider":"yahoo",
                "providerSymbol":"GGAL.BA", "name":"Grupo Financiero Galicia S.A.",
                "currencyCode":"ARS", "taxJurisdiction":"AR",
                "sector":"Financial Services", "industry":"Banks - Regional",
                "website":"https://..." } },
    { "symbol": "YPFD", "ok": false, "error": "yfinance: no info for YPFD.BA" }
  ] }
```

| Rule | Value |
|---|---|
| Method | `POST` only. `GET` → `405`. |
| Batch limit | 25 items. More → `400 {"error":"batch too large"}`. |
| Per-item failure | `ok: false` with a message. **Never** fails the batch; HTTP is still `200`. |
| Non-200 statuses | `400` malformed body / oversized batch · `401` auth · `405` method · `500` unhandled. |
| Unsupported type (ON/BOND_AR/LETRA) | `ok: true, data: null` — mirrors `enrich_catalog_instrument` returning `None` today. The TS side treats it as "no Yahoo opinion", not an error. |
| Symbol absent from Yahoo | `ok: true, data: null, listed: false` — the 404 case (AL30). **Must be distinguishable from a transport failure**; see §10.3b. |
| Handler shape | `class handler(BaseHTTPRequestHandler)` with `do_POST` — Vercel's file-based Python convention. Verify against the runtime docs at implementation. |
| Response encoding | `json.dumps(..., ensure_ascii=False)` + `Content-Type: application/json; charset=utf-8`, preserving the existing script's behavior. |

### 10.3b `mode: "currency"` — the AD-12 oracle

The same endpoint, a second mode, deliberately **not** a second function: it inherits the auth, the 25-item batch limit, the timeout and the response envelope already specified above.

```http
POST /api/yahoo-metadata
{ "mode": "currency", "items": [ {"symbol":"NVDAD","type":"CEDEAR"}, {"symbol":"AL30","type":"BOND_AR"} ] }

200 OK
{ "results": [
    { "symbol": "NVDAD", "ok": true,  "listed": true,  "currency": "USD" },
    { "symbol": "AL30",  "ok": true,  "listed": false, "currency": null  }
  ] }
```

**Transport — the crumb handshake is mandatory.** Yahoo's batch quote endpoint is not openly accessible: raw `v7/finance/quote` returns `401` and `v6` returns `404`. The working sequence, measured to return 5 symbols with correct currencies in one call, is:

```
GET https://fc.yahoo.com/                                  → cookies
GET https://query1.finance.yahoo.com/v1/test/getcrumb      → crumb   (with those cookies)
GET .../v7/finance/quote?symbols=A,B,C&crumb=<crumb>       → currencies
```

`yfinance` performs this internally, which is the deciding reason the oracle lives in the Python function rather than in Node. **If the function is ever rewritten without `yfinance`, the handshake — cookie jar, crumb lifetime, re-handshake on `401` — becomes mandatory implementation work, not an optimisation.** The ~70-request estimate of AD-12 holds only with the handshake; without it every request fails closed, which is at least loud rather than silent.

| Rule | Value |
|---|---|
| `mode` absent | Defaults to `"metadata"` — the §10.3 payload. Backwards compatible. |
| Crumb/cookie failure | Batch-level `ok: false` ⇒ `unavailable` ⇒ AD-12 fail-closed. **Never** `listed: false`, which would silently hand 1,687 symbols to a path with no fallback. |
| Response fields in currency mode | `symbol`, `ok`, `listed`, `currency` **only**. No `sector`, no `name`. A narrow response is a narrow blast radius. |
| Yahoo 404 for `{SYMBOL}.BA` | `ok: true, listed: false, currency: null` — **evidence of absence**, consumed as AD-12's ratio-only path. |
| Yahoo timeout / 5xx for one symbol | `ok: false, error: "..."` — **not** `listed: false`. The distinction is the whole failure policy; conflating them would let a transient outage look like "Yahoo does not cover this symbol" and hand a variant to the ratio-only path that should have been skipped. |
| Batch-level transport failure | The TS adapter throws; `resolveUniverseCurrencies` returns `unavailable` for that batch and the sync fails closed (AD-12). |
| `currency` value | Passed through from `meta.currency` verbatim. Anything other than `"ARS"` or `"USD"` is treated as `ok: false` on the TS side — an unexpected venue currency is not something to guess about. |

```ts
export type CurrencyVerdict =
  | { kind: "currency"; currency: "ARS" | "USD" }
  | { kind: "not-listed" }      // 404 — fall back to the ratio
  | { kind: "unavailable" };    // no evidence — fail closed

export async function resolveUniverseCurrencies(
  items: Array<{ symbol: string; type: InstrumentType }>
): Promise<Map<string, CurrencyVerdict>>;
```

A symbol missing from the returned map is `unavailable`, never `ARS`.

### 10.4 TS adapter

```ts
export async function fetchYahooMetadataBatch(
  items: Array<{ symbol: string; type: InstrumentType }>
): Promise<Map<string, YahooCatalogMetadata | null>>;
```

- Base URL: `process.env.INTERNAL_FUNCTION_BASE_URL` → fallback `https://${process.env.VERCEL_URL}` → fallback `http://localhost:3000`.
- `cache: "no-store"` (Next 16 default is already uncached, §0; stated explicitly so intent survives a config change), `signal: AbortSignal.timeout(20_000)`.
- Non-200 → throw; the caller's `mapWithConcurrency` isolates it to that batch.
- Field validation identical to today's `lookupYahooCatalogMetadata` guard, so the contract the rest of the code sees is unchanged.

### 10.5 Deployment risk

Proposal §10 flags bundle/cold-start/runtime risk as Low. Mitigation stays: **verify in a preview deploy before merge** — one authenticated POST against the preview URL returning `ok: true` for a known CEDEAR is the acceptance gate, and it doubles as the Deployment-Protection check that motivated the shared secret.

---

## 11. File Changes

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma` | Modify | `Settlement` enum (4 values); `settlement` (non-nullable, default ARS), `baseInstrumentId`, self-relation, `sector`, `industry`, `issuer`, `law`, `assetClass`, `subAssetClass` on `Instrument`; `@@index([isin])` — **never `@unique`** (AD-13); new `BondSchedule` model (AD-14); `CorporateEvent.createdByUserId` → nullable. |
| `prisma/migrations/<ts>_instrument_settlement_and_metadata/migration.sql` | Create | §6.1. |
| `prisma/seed.ts` | Modify | Upsert the `SPY/CEDEAR/BYMA/ARS` instrument; upsert `RECOMMENDED_EVENTS` as `CorporateEvent` rows with `createdByUserId: null` (§6.3). Imports `RECOMMENDED_EVENTS`; does not re-declare it. |
| `scripts/reset-settlement-links.ts` | **Create** | Manual re-link/reset escape hatch (AD-5). `tsx` script, no route, no cron. |
| `src/lib/market/instrument-identity.ts` | **Create** | `instrumentKey` — the single identity. Pure, tested. |
| `src/lib/market/instrument-identity.test.ts` | **Create** | Byte-identical to the deleted `commit-import.ts` `instrumentKey`; null `venueCode` renders as the empty segment. |
| `src/lib/market/settlement-matching.ts` | **Create** | `planSettlementLinks`. Pure, tested. |
| `src/lib/market/settlement-matching.test.ts` | **Create** | The §4.4 measured table; `DD`/`DDD` **must link**; `CARC` must be excluded by currency; stale/missing rates still emit `settlement: "USD"`; ambiguity; one-winner; no path yields `ARS` for a confirmed-USD symbol. |
| `src/lib/market/settlement-classify.ts` (+`.test.ts`) | **Create** | `currencyForSettlement` + the AD-5 lattice. Shared by catalog-sync and the importer. |
| `src/lib/market/isin-grouping.ts` (+`.test.ts`) | **Create** | `groupByIsin` (AD-13). Pure, tested against the AL30/AL30D fixtures. |
| `src/lib/bonds/schedule-source.ts` (+`.test.ts`) | **Create** | Pure resolver: `BondSchedule` when present, else `BondTerms` + `projectCashFlows` (AD-14). The precedence rule lives on the tested side. |
| `src/lib/utils/concurrency.ts` (+`.test.ts`) | **Create** | `mapWithConcurrency`. |
| `src/lib/market/docta-client.ts` | **Create** | Token mint/cache, two GETs, feature gate. |
| `src/lib/market/docta-mapping.ts` (+`.test.ts`) | **Create** | Fixture-tested mapping + mojibake repair + `7.5 → 0.075`. |
| `src/lib/market/yahoo-metadata-client.ts` (+`.test.ts`) | **Create** | HTTP adapter + pure `parseCurrencyVerdict`, tested. |
| `api/yahoo-metadata.py` | **Create** | Vercel Python function. Two modes: `metadata` (§10.3) and `currency` (§10.3b, AD-12), with 404 distinguished from transport failure. |
| `api/_yahoo_catalog.py` | **Create** | Logic lifted from `scripts/yahoo_catalog.py`. |
| `requirements.txt` | **Create** | `yfinance` only. |
| `src/lib/market/data912-universe.ts` | Modify | Single `fetchData912Live` reader with a cache-policy parameter; `CatalogInstrument` gains `price`; delete `stripCurrencyVariants` and `fetchEndpointSymbols`. |
| `src/lib/market/market-snapshots.ts` | Modify | Consume the shared reader; use `instrumentKey`. |
| `src/lib/market/catalog-sync.ts` | Modify | Delete `identityKey` **and** `resolveCurrencyCode`; use `instrumentKey`; reordered pipeline — currency oracle → link → reconcile (§3.3, §5.1); AD-12 fail-closed branch; duplicate-group reporting; link application via the AD-5 lattice; `CatalogSyncResult` gains `linked`, `duplicateGroups`, `currencyOracle`. Keeps the empty-universe guard. |
| `src/lib/market/quotes.ts` | Modify | `InstrumentForQuote` gains `currencyCode`/`settlement`/`baseInstrument`; symbol+currency from `resolveMonitoringRouting`; capped fan-out. |
| `src/lib/market/provider-routing.ts` | Modify | `settlement` + `baseInstrument` on `ResolvableInstrument`; `"spot"` branch keyed on `baseInstrumentId`, not on settlement. |
| `src/lib/market/provider-routing.test.ts` | Modify | Rewrite the two broken assertions; keep `"native"`. |
| `src/lib/market/yahoo-catalog.ts` | Modify | Remove `execFile`; call the HTTP adapter; base-row resolution (AD-3); capped + budgeted fan-out; write `sector`/`industry` through a typed `EnrichmentPatch` that **has no `currencyCode` key** (AD-0). |
| `src/lib/market/dolarapi.ts` | Modify | Add `fetchMepQuote()`. |
| `src/lib/importers/commit-import.ts` | Modify | Remove the enrichment call and import; delete the local `instrumentKey` and import the shared one. `p.currencyCode` (broker-attested) stays the currency source — AD-0. |
| `src/app/actions/imports.ts` | Modify | `after(() => enrichUsedInstruments(...).catch(warn))`. |
| `src/lib/transactions/types.ts` | Modify | `TRADE_INSTRUMENT_TYPES` += `BOND_AR`, `LETRA`. |
| `src/components/transactions/transaction-form-modal.tsx` | Modify | `INSTRUMENT_TYPE_OPTIONS` += BOND_AR, LETRA; render the settlement chip. |
| `src/app/actions/transactions.ts` | Modify | Fixed-income routing covers ON+BOND_AR+LETRA; `TransactionInstrumentOption` gains `settlement`; base-first sort; un-comment the self-heal identity now that currency/venue are modeled. |
| `src/app/actions/dashboard.ts` | Modify | Sector select + 3-step fallback on **both** branches (§2.3). |
| `src/lib/bonds/portfolio-bridge.ts` | Modify | `toDashboardHolding` accepts `sector`; `toHoldingRow`/`valuateOnPositions` accept all three fixed-income types instead of hardcoding `"ON"`. |
| `src/app/actions/bond-terms.ts` | Modify | Docta branch in `getBondTermsProposalAction`; AD-7 auto-fill behind the §8.3b gate. |
| `src/app/api/cron/sync-catalog/route.ts` | Modify | `export const maxDuration = 300`. (No `?dryRun=1` — deleted in rev. 2, §R.) |
| `src/app/actions/monitoreo.ts` | Modify | Delete the `writeFileSync("instruments-debug.log")` leak (import L6, call L50). |
| `instruments-debug.log`, `data912com-live-usa_stocks.json` | **Delete** | Proposal §8. |
| `data912com-live-arg_{cedear,stocks}.json`, `…corp.json` | **Move** | → `src/lib/market/__fixtures__/data912/` (renames, excluded from the authored count). |

---

## 12. Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (`vitest`) | `planSettlementLinks` | RED first. The measured table of §4.4 plus: **`DD`/`DDD` links and is never `ARS`**; **`CARC` is excluded by the currency partition, not by a band**; null CCL only, null MEP only, both null and `asOf` 4 days old **still emit `settlement: "USD"` for confirmed-USD symbols**; price 0/null/NaN keeps the currency; two bases matching one variant ⇒ `baseTicker: null` with the currency kept; base and variant of different `InstrumentType`; a `currency: null` (404) symbol still follows the legacy ratio path. |
| Unit | `currencyForSettlement` / `moreSpecific` | `ARS→"ARS"`, `USD\|MEP\|CCL→"USD"`; the lattice never downgrades `MEP`→`USD` or `USD`→`ARS`. |
| Unit | `parseCurrencyVerdict` | 404 ⇒ `not-listed`; timeout/5xx ⇒ `unavailable`; `meta.currency` of `"BRL"` ⇒ `unavailable`, never a passthrough; a symbol missing from the response ⇒ `unavailable`, **never `ARS`**. |
| Unit | `instrumentKey` | Output equals the deleted `commit-import.ts` version byte for byte; a null `venueCode` renders as a trailing empty segment; two rows differing only in `currencyCode` produce different keys. |
| Unit | `mapWithConcurrency` | Max in-flight ≤ limit; order preserved; one rejection does not sink the batch; budget stops new starts. |
| Unit | `mapDoctaInstrument` | Against `instruments-MCC3O.json`: `Energã­A → EnergíA`; `isin`, `sector`, `issuer`, `law`, `assetClass` mapped. |
| Unit | `mapDoctaCashflow` | Against `cashflow-MCC3O.json`: `couponRate === "0.075"`, `couponFrequencyMonths === 6`, `issueDate`/`maturityDate`, amortization sums to 100. Gate cases (§8.3b): a mutated fixture summing to 99 ⇒ proposal, not auto-fill; a name with no currency token ⇒ proposal; a name containing only `$` ⇒ proposal (never `ARS` by default); `U$S` ⇒ `USD`; a `BADLAR` name with a constant rate ⇒ `rateType === "FLOATING"`; **`cashflow-AL30.json` (varying `interest_rate`) ⇒ NO `BondTerms` auto-fill** — it routes to `BondSchedule`; `dayCountConvention` absent from the returned object. |
| Unit | `mapDoctaSchedule` (AD-14) | Against `cashflow-AL30.json`: 19 rows; the `interestRate` sequence contains all four distinct steps (0.13, 0.5, 0.75, 1.75) — **the assertion that fails under any single-rate model**; `interestAmount` copied verbatim, never recomputed; `residualValue` ends at 0. |
| Unit | `groupByIsin` (AD-13) | `instruments-AL30.json` + `instruments-AL30D.json` ⇒ **one group of two** on `ARARGE3209S6`; `instruments-MCC3O.json` (`AR0922852063`) ⇒ a separate group; **two rows with `isin: null` do NOT group** — the most likely wrong implementation; blank/whitespace ISIN treated as null. |
| Unit | `schedule-source` (AD-14) | `BondSchedule` present ⇒ used, `projectCashFlows` never called; absent ⇒ falls through to `BondTerms`; both absent ⇒ empty, not a throw. |
| Unit | `faceValue` neutrality (`scaleFlowsToHolding`) | Projecting the same fixture with `faceValue = 100` and `faceValue = 1000` yields identical scaled flows for the same `nominalHeld` — the property that makes the fixed `100` safe. |
| Unit | `resolveMonitoringRouting` | Rewritten file; new `"spot"` cases for linked variant (base `.BA`, ARS), variant with `settlement = "USD"` and no base link (own `.BA`), base, STOCK_US. |
| Integration | — | `test_layers.integration: false`. Not scheduled. |
| E2E | — | `test_layers.e2e: false`. Not scheduled. |
| Manual acceptance (goes to `tasks.md`) | See §14 unit 8 | Full reset runbook (§6.2) end to end; duplicate query returns zero rows; preview-deploy Yahoo POST. |

Prisma-backed orchestrators (`catalog-sync.ts`, `commit-import.ts`, `quotes.ts`, server actions) get **no** unit tests, per `config.yaml`. This is why every decision in §7 lives in a pure module.

---

## 13. Threat Matrix

Applicable because this change adds a publicly routable endpoint, adds a dependency manifest Vercel executes, and **removes** a subprocess.

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, executable Markdown/MDX, `README.sh` | **Applicable** — this change creates a real root `requirements.txt` that the Vercel build executes as a dependency manifest. | `requirements.txt` lists exactly one direct dependency (`yfinance`), pinned to a minor range; transitive `pandas`/`numpy` are not re-declared. No other doc-like file in the repo becomes executable; `.md` and `.json` fixtures stay inert. | Build-time check, not a unit test: preview deploy must succeed and the function must answer `200`. Recorded as an acceptance item, not a fabricated unit test. |
| Git repository selection | `git -C`, relative/absolute paths | **N/A** — this change contains no VCS automation. | — | — |
| Commit state | staged, `commit -a`, empty index | **N/A** — no commit automation. | — | — |
| Push state | tracking branch, first push, refspec | **N/A** — no push automation. | — | — |
| PR commands | `--head`, env prefix, composed commands | **N/A** — no PR automation. | — | — |

**Additional boundaries this change touches, handled outside the canonical rows:**

- **Routing (new public endpoint).** `/api/yahoo-metadata` is unauthenticated by default on Vercel. Response: shared-secret header, constant-time compare, fail-closed on a missing secret (§10.2). Adversarial cases carried to tasks: no header · empty header · wrong header · secret unset in the Python process · `GET` instead of `POST` · 10 MB body · 1,000-item batch. Expected: `401`/`401`/`401`/`401`/`405`/`400`/`400`. Never a `200` and never a stack trace in the body.
- **Subprocess removal.** `execFile(python, [script, "--symbol", symbol, ...])` is deleted. It was already shell-free and therefore not injectable; the replacement carries the symbol as a JSON field, which removes the argument-composition boundary entirely rather than re-creating it. No new `child_process` usage anywhere in the change.

---

## 14. Implementation order (the §5 sequencing constraint, made concrete)

Single PR, but the commit order inside it is a correctness constraint, not a preference.

| # | Work unit | Constraint |
|---|---|---|
| 0 | Repo cleanup + baseline green: delete the `monitoreo.ts` debug leak and `instruments-debug.log`, delete `data912com-live-usa_stocks.json`, move the three data912 samples to `__fixtures__/`, rewrite `provider-routing.test.ts`. | Must land first. `tsc` has 7 errors and `npm test` has 2 failures today; every later step needs a green baseline to be meaningful. |
| 1 | Fixed-income tradability: `TRADE_INSTRUMENT_TYPES`, `INSTRUMENT_TYPE_OPTIONS`, fixed-income routing for all three types, `portfolio-bridge` type generalization. | Independent of Legs 1–3. Must land **before or with** Leg 3 (proposal §5) or Docta's bond data has no user-visible consumer. **No UI notice** for the re-valuation (rev. 2, §R): the data is being reimported anyway and the single user knows why the numbers moved. |
| 2 | Prisma schema + migration (§6.1): four-value `Settlement` enum, `CorporateEvent.createdByUserId` → nullable. | Inert on its own. Must precede 3 and 6. |
| 3 | Seed: SPY instrument + `RECOMMENDED_EVENTS` as creator-less corporate events (§6.3). | Depends on 2. Must land before the first reset, or the SPY ratio fact is lost. |
| 4 | **Yahoo Python function `mode: "currency"` + `resolveUniverseCurrencies` + `parseCurrencyVerdict`** (AD-12, §10.3b), with `requirements.txt`, the `execFile` removal and the `scripts/yahoo_catalog.py` deletion. | **Moved ahead of the pipeline work in rev. 3.** The currency oracle is now an input to reconciliation, not an optional enrichment, so it must exist and be verified on a preview deploy before unit 6 can be correct. |
| 5 | Pure modules + their tests (TDD RED first): `instrument-identity`, `settlement-classify` (incl. the AD-5 lattice), `settlement-matching` (the §4.4 measured table), `isin-grouping` (AD-13), `schedule-source` (AD-14), `concurrency`, `docta-mapping` (incl. `mapDoctaSchedule` and the §8.3b gate cases). | Inert on their own. `strict_tdd: true` — tests before implementation. **The `DD`/`DDD` test asserts a link**; rev. 1's opposite assertion must not be written. |
| 6 | **Leg 1 + Leg 2 together**: `data912-universe` reader, `catalog-sync` oracle→link→reconcile pipeline (§3.3), `quotes.ts` + `provider-routing.ts` routing on `baseInstrumentId`, `commit-import` → shared `instrumentKey`, `EnrichmentPatch` type (AD-0). | **Hard constraint (proposal §5).** Ingestion classifying variants as USD must not exist in any deployed state without the quote routing that understands it. Commit `quotes.ts`/`provider-routing.ts` **before or in the same commit as** the `catalog-sync.ts` linking. Depends on 4. |
| 7 | Search settlement chip (`ARS`/`USD`/`MEP`/`CCL`) + base-first sort + sector read path (`dashboard.ts`, `portfolio-bridge.ts`); `scripts/reset-settlement-links.ts` (AD-5). | Depends on 2 and 6. **No backfill script** — unit 9's resync populates sector for every row (§R). |
| 8 | Docta client + mapping wiring + **ISIN linking for the 221 fixed-income tickers (AD-13)** + **`BondSchedule` stored-schedule path (AD-14)** + `BondTerms` auto-fill behind the §8.3b gate + analítica v2. | Depends on 1 (a consumer must exist), 2 (the `BondSchedule` table) and 5 (the mappings are already tested). **AD-13 is a linking mechanism, so it must land with unit 6's pipeline, not after it** — a sovereign left unlinked is FR-3-correct, but the two must not disagree about who owns fixed-income membership. |
| 9 | **Reset acceptance pass** — execute §6.2 end to end: `migrate reset` → `db seed` → `sync-catalog` → reimport → verify. Record: the duplicate query (§3.5) returns zero rows; `currencyCode = currencyForSettlement(settlement)` holds for every row (AD-1); **no row has `currencyCode = 'ARS'` while Yahoo reports USD for its symbol** (spot-check the §R.2 variant list); the SPY event exists with `createdByUserId IS NULL`; counts for linked variants and sector coverage. **AD-13 checks**: how many of the 221 fixed-income tickers Docta returned no ISIN for (this number decides whether the fingerprint fallback gets built); `AL30`/`AL30D` share a group; **`TVPA`/`TVPE`/`TVPP`/`TVPY` are four groups of one and `TZXD6`/`TZXD7`/`TZXD8` are three groups of one** — the §R.3 assumptions, verified not assumed; no `isin` unique-constraint violation on insert. Plus preview-deploy Yahoo POST in both modes; `tsc` 0 / `npm test` 0 / lint clean / `npm run build` green. | Last. Replaces rev. 1's `?dryRun=1` gate. |

---

## 15. Risks and mitigations (technical, beyond proposal §10)

### R-1 — ~~`identityKey` change mass-delists on the first sync~~ **RETIRED in rev. 2**
This was the highest-severity item in rev. 1. It required a pre-existing row whose `currencyCode` was wrong at birth. The database is reset (§6.2), every row is born correct, and AD-0 forbids any later rewrite, so the failure mode has no input. The shrink guard and the `?dryRun=1` mode that existed solely to contain it are deleted. **What replaces it is R-1b**, which is one order of magnitude smaller.

### R-1b — AD-0 is violated by a future enrichment writer
If any code path ever writes `currencyCode` outside the settlement-link step, the rev. 1 drift returns on a clean database and every piece of machinery deleted in rev. 2 becomes necessary again. Mitigated structurally, not by discipline: enrichment writes through a typed `EnrichmentPatch` with no `currencyCode` key, so the violation is a TypeScript compile error. Yahoo's reported currency is read and discarded. Residual: a raw `prisma.instrument.update` written elsewhere bypasses the type. Low — the acceptance query in §14 unit 9 would surface the resulting duplicates on the next reset.

### R-2 — A false link mis-values a real position
**Severity substantially reduced in rev. 3.** The failure that mattered was a *currency* error (an ARS row treated as USD or vice versa); that is now an assertion from Yahoo, not a heuristic (AD-12). What remains is a *pairing* error: a confirmed-USD variant attached to the wrong confirmed-ARS base, which mis-prices the holding through the wrong quote. Mitigated by: same-type-only, USD-against-ARS-only candidate generation; the 2 % staleness band; one-winner-per-variant degrading to `baseTicker: null` with the currency retained; and AD-5's lattice. **Residual**: a false pairing between two same-prefix symbols of the same type whose ratio happens to land in the band. Accepted; §14 unit 9 spot-checks the §R.2 measured set on real data, and `scripts/reset-settlement-links.ts` (AD-5) reverts a bad link in one command.

### R-2b — The design encodes a measured-false fact
Rev. 1 asserted that `CC` was Chemours, that `DD`/`DDD` was a false pair, and that Yahoo reports ARS for every `.BA` symbol. All three are **measured false** (§R.2), and the second was one commit away from becoming a locked regression test that would have blocked the correct behaviour forever. Mitigated for this change by replacing the table with measured data and inverting the `DD`/`DDD` assertion. **The general lesson is the mitigation**: no ticker-identity claim enters a test unless a captured probe backs it. `TOLERANCE` and the anchor values remain calibrated from one day's measurements and are re-derived, not assumed, if unit 9 shows real variants outside the band.

### R-2d — Fixed-income linking now depends on Docta serving an ISIN
AD-13 replaces a heuristic that always produced *an* answer with an oracle that can decline. A ticker Docta does not serve, or serves without an ISIN, gets no group. **This is a reduction in risk, not an increase**: the old answer for those tickers was a price-band guess over the thinnest market in the universe, and the new one is FR-3's unlinked-but-tradable — visible, tradable, no chip, degraded and never wrong. `BA7DD`, `XN6D` and `TVPA` are known-unverified. The acceptance pass counts them and that count, not an estimate, decides whether the cashflow-fingerprint fallback is worth building.

### R-2e — `Instrument.isin` acquires a `@unique` constraint
The single highest-consequence mistake available in this change. `isin` looks like a natural unique key and is currently unused, so a future reader — or a schema linter — may "fix" it. **Settlement variants deliberately share an ISIN; that sharing is the link.** A unique constraint makes it impossible to persist a base and its variant simultaneously, and the failure appears at insert time on a reset, not at review time. Mitigated by an explicit comment in `schema.prisma`, by AD-13 stating it, and by the §14 unit 9 acceptance step that inserts `AL30` and `AL30D` together.

### R-2c — Yahoo becomes a hard dependency of ingestion
AD-12 puts a third-party endpoint on the path that decides whether rows get created. A Yahoo outage now blocks catalog creates rather than degrading them. Accepted deliberately: the alternative is creating rows with a guessed currency, which is permanent under AD-0 and is the exact corruption the reset exists to end. Bounded by: delist/reactivate/snapshots still run; the cron is daily, so a skipped run costs at most one day of new-listing latency; `ok: false` plus `currencyOracle: "unavailable"` makes the state visible rather than silent; and the Yahoo-uncovered set (sovereigns) is unaffected because it never depended on the oracle.

### R-3 — Docta auto-fills a wrong `BondTerms`
`BondTerms` feeds analítica v2's projections, and option B never revisits an auto-filled row. Mitigated by the all-or-nothing gate of §8.3b: no currency token in the name ⇒ propose instead of guess; amortization off by >0.01 from 100 ⇒ propose; `couponRate` out of range ⇒ propose. `faceValue = 100` is dimensionally neutral (proved by test), `rateType` defaults to the conservative `FLOATING`. **Residual, accepted**: `dayCountConvention` falls back to the schema default `ACT/365`, which can be wrong for a 30/360 or ACT/360 bond and shifts accrued interest by up to ~1.4 %. Docta supplies no evidence either way, the manual form has the identical default today, and the field stays user-editable. Rollback for a bad auto-fill is a single row delete.

### R-3c — A step-up bond is silently projected at a single rate
The failure AD-14 exists to prevent, and the one that was live in rev. 2: AL30's stepped coupon would have been stored as one `couponRate` with `rateType = FLOATING`, producing a projection that is both numerically wrong and mislabelled as an assumption. Mitigated by routing every varying-rate bond to `BondSchedule` (AD-14) and by the §8.3b gate refusing the `BondTerms` path outright for them. **Locked test**: `mapDoctaSchedule(cashflow-AL30.json)` must preserve all four rate steps, and `mapDoctaCashflow` on the same fixture must refuse to auto-fill. Residual: a step-up bond the user hand-enters still hits the single-rate model — unchanged from today, out of scope, and now visible because the Docta path demonstrates the difference.

### R-3b — The importer and the catalog disagree on a held variant's currency
The importer takes `currencyCode` from the broker statement; the catalog takes it from the price band. If they disagree for a ticker the user holds, two rows appear for one listing. Mitigated by the runbook order (sync before reimport, §6.2), by AD-5 keeping the catalog's answer stable, and by the duplicate query in §14 unit 9 which must return zero rows. Low severity on a disposable DB: the fix is to correct the row and re-run the reimport.

### R-4 — Serverless cold starts defeat the in-memory Docta token cache
Stated openly in AD-8. At the current load a handful of extra mints per day is acceptable. The escape hatch (persist the token like `FxRate`) is designed-for but not built.

### R-5 — Mojibake repair over-corrects
Repairing a string that was not actually mojibake would introduce a *new* data error, worse than leaving `Energã­A` visible. Mitigated by the evidence-only sequence table (§8.2): only sequences proven by a captured fixture are repaired, and the round-trip is abandoned on any U+FFFD.

### R-6 — `after()` work is silently dropped on an aborted request
`after` runs even on error (§0), but a hard platform abort could still drop it. Consequence: an import's instruments are not enriched until the next nightly `sync-catalog` picks them up — which it will, since `enrichUsedInstruments` is scoped to transaction-referenced instruments. **Self-healing by design**; no mitigation needed beyond noting it.

### R-6b — The currency oracle inflates the cron's runtime
~70 additional batched requests at concurrency 4 land in the same 300 s window as reconciliation, linking and enrichment. Mitigated by `CURRENCY_BUDGET_MS = 90_000` and by the pipeline order (§5.1): the oracle runs early, so if it exhausts its budget the run fails closed and cheaply rather than half-way through writes. If unit 9 measures it near the budget, the escape is a wider batch size — the 25-item limit is the Python function's own constant, not a Yahoo limit — before touching `maxDuration`.

### R-7 — `maxDuration = 300` exceeds the plan's function limit
`backfill-prices` already runs at 300 on this plan, so this is low. If the build rejects it, fall back to 60 and rely on the `ENRICH_BUDGET_MS` early stop — the pipeline order (§5.1) puts enrichment last precisely so a truncated run still completes reconciliation, snapshots, and linking.

### R-8 — Duplicate `ticker+type` rows accumulate
Covered in §3.5 and R-3b: only reachable when the broker statement's currency disagrees with the oracle's for a held ticker, reported by the sync as `duplicateGroups`, and gated to zero by the §14 unit 9 acceptance query on a reset database.

---

## 16. Open Technical Questions

None block tasks. All five orchestrator questions are answered (§2, §3, §4, §9, §10), all proposal §14 decisions are implemented as locked, and the three questions raised with the §R.2 measurement are answered in AD-12 (whole-universe lookup over tiebreaker), AD-0 (the invariant survives; only its source changes) and AD-12's failure-policy table (fail closed, never default to ARS). Monitored items:

1. **Docta base URL and exact auth path** — the fixtures prove the response shapes but the captured host/prefix must be confirmed against the live service at implementation time. A wrong constant fails closed (provider no-ops), so it cannot corrupt data.
2. **Vercel Python handler convention** — `class handler(BaseHTTPRequestHandler)` is the file-based convention; confirm against the current runtime docs before writing `api/yahoo-metadata.py`. The preview-deploy gate catches a mistake before merge.
3. **The measured `COUNT(DISTINCT "instrumentId")`** — §9.1. The cap of 4 stands unless the count exceeds ~300.
4. **`TOLERANCE` and the anchors on live data** — 2 % and the CCL ≈ 1582 / MEP ≈ 1526 anchors come from one day's measurements (§R.2). Widen only with a new measurement. **Rev. 1's "hard floor at 3.71 % from `DD`/`DDD`" is withdrawn** — that datapoint was a false negative, and using it as a floor would have been calibrating against a mistake.
5. **Yahoo's batch shape for `mode: "currency"`** — the ~70-request figure assumes `yfinance` issues one upstream request per 25-symbol batch. If it fans out to one request per symbol inside the function, the wall-clock cost changes but the design does not: the cap and `CURRENCY_BUDGET_MS` bound it either way, and the fail-closed policy makes an overrun safe. Measure in unit 4's preview deploy.
6. **Yahoo `.BA` coverage beyond the probed set** — ~24 symbols were measured and the boundary was corrected once already (§R.3 item 1: ONs *are* covered). If a material share of the 1,687 returns 404, more symbols fall through to FR-3 than assumed. Unit 9 records the `not-listed` count; that number, not an estimate, decides whether anything further is needed.
7. **Does Docta expose ISIN for equities and CEDEARs?** The token already carries `stocks:read` and `cedears:read`. If those endpoints return an ISIN, it would collapse two linking mechanisms into **one universal key for all 1,908 symbols** instead of Yahoo-for-1,687 plus ISIN-for-221. **Deliberately not designed for.** Yahoo already resolves equities deterministically, so building on this speculatively would trade a working mechanism for an unmeasured one. Take the measurement; and note that populating `Instrument.isin` for equities is **independently valuable** — for reporting, deduplication and future broker imports — even if linking never uses it.
8. **The eight known non-variant ISINs** — `TVPA`/`TVPE`/`TVPP`/`TVPY` and `TZXD6`/`TZXD7`/`TZXD8` are expected to yield distinct ISINs (§R.3). That expectation follows from what the instruments are, but it has not been captured. Unit 9 verifies it; a shared ISIN there would mean the assumption about the instrument is wrong, not the mechanism.
