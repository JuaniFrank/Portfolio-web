# Corporate Events — Tasks
# Change: spy500-split

**Type**: Task checklist
**Delivery**: single-pr (`size:exception` — ~618 net lines, user-accepted)
**Strict TDD**: OFF — quality gates are `pnpm lint` + `pnpm tsc --noEmit` only
**Date**: 2026-06-09

---

## 1. Task List

### C1 — Schema + Migration

#### T-1: Add `CorporateEventType` enum and `CorporateEvent` model to Prisma schema
- **What**: Add the `CorporateEventType` enum (CEDEAR_RATIO_CHANGE, STOCK_SPLIT, REVERSE_SPLIT, SPINOFF, MERGER, TICKER_CHANGE) and the `CorporateEvent` model with all fields, the `@@unique([instrumentId, effectiveDate, eventType])` constraint, and both indexes. Add inverse relations to `Instrument` (`corporateEvents`) and `User` (`corporateEventsCreated`).
- **Files**: `prisma/schema.prisma`
- **Acceptance**: `pnpm db:generate` exits 0; schema diff shows only additive changes; no existing model is modified.
- **Spec refs**: FR-1, FR-7, NFR-2

#### T-2: Generate and run the migration
- **What**: Run `pnpm db:migrate dev --name add_corporate_event_model`. Verify the generated SQL creates the table, the enum, the unique index, and both FK indexes. Commit the generated migration file.
- **Files**: `prisma/migrations/<ts>_add_corporate_event_model/migration.sql`
- **Acceptance**: Migration runs cleanly; `prisma migrate status` shows no pending migrations; generated Prisma client includes `CorporateEvent` and `CorporateEventType`.
- **Spec refs**: FR-1, FR-7
- **Prereqs**: T-1

---

### C2 — Pure Event-Apply Library

#### T-3: Create `src/lib/events/types.ts`
- **What**: Define and export: `CorporateEventForBuilder` (fields from schema needed at runtime: id, instrumentId, eventType, effectiveDate as string `YYYY-MM-DD`, numerator as string, denominator as string), `CorporateEventDTO` (all fields for the UI list: adds ticker, notes, appliedAt), `ProjectedPosition` ({ instrumentId, ticker, current: HoldingRow | null, projected: HoldingRow }), and action result union types (`EventActionResult<T>`, `{ ok: true; data: T } | { ok: false; error: string }`).
- **Files**: `src/lib/events/types.ts`
- **Acceptance**: File compiles with zero errors; no import cycles; `CorporateEventForBuilder.effectiveDate` is `string` (not `Date`).
- **Spec refs**: FR-5, NFR-2

#### T-4: Create `src/lib/events/validations.ts`
- **What**: Export `newEventInputSchema` (zod): `instrumentId` string min(1), `eventType` nativeEnum(CorporateEventType), `effectiveDate` regex `YYYY-MM-DD`, `numerator` string refine(v > 0), `denominator` string refine(v > 0), `notes` string max(500) optional nullable. Export `NewEventInput` inferred type.
- **Files**: `src/lib/events/validations.ts`
- **Acceptance**: `pnpm tsc --noEmit` passes; zod `safeParse` rejects numerator=0, denominator=-1, missing instrumentId, and malformed date.
- **Spec refs**: FR-9, NFR-2
- **Prereqs**: T-2 (needs generated `CorporateEventType` from Prisma client)

#### T-5: Create `src/lib/events/apply.ts` — pure `applyEventsToTrade`
- **What**: Export `applyEventsToTrade(trade: TradeForHoldings, events: CorporateEventForBuilder[]): TradeForHoldings`. Logic: sort events ascending by `effectiveDate` (lexical string comparison, NOT `Date.getTime()`). For each event: if `trade.tradeDate.slice(0, 10) < event.effectiveDate` AND `event.eventType !== 'TICKER_CHANGE'`, apply ratio via `Decimal.js` — multiply `quantity` by `numerator/denominator`, divide `price` by same factor; `netAmount` MUST NOT change. Document the `tradeDate < effectiveDate` boundary and the `YYYY-MM-DD` lexical comparison in a JSDoc block.
- **Files**: `src/lib/events/apply.ts`
- **Acceptance**: Function is pure (no I/O, no side effects); `TICKER_CHANGE` returns trade unchanged; composed 2:1 × 3:1 yields ×6 on a pre-both trade; `netAmount` is invariant across all scenarios; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-5, FR-10, FR-11, NFR-2, NFR-5 (AD-3, AD-8, AD-9)
- **Prereqs**: T-3

---

### C3 — `buildHoldings` Events-Aware

#### T-6: Extend `buildHoldings` signature with optional `events` parameter
- **What**: Add third optional parameter `events?: Map<string, CorporateEventForBuilder[]>` to `buildHoldings`. Before the per-instrument loop, if `events` is provided and has entries for the instrument, call `applyEventsToTrade(trade, instrumentEvents)` for each trade before passing to `computePositionFromTrades`. Default (`events` absent or empty map) MUST produce identical output to the current implementation (backwards compatible). Add JSDoc noting the `tradeDate < effectiveDate` boundary.
- **Files**: `src/lib/transactions/holdings.ts`
- **Acceptance**: Existing call sites with 2 args still compile and produce the same results; a call with 3 args and a 3:1 event produces adjusted quantity/PPP with invariant `netAmount`; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-5, NFR-5 (AD-2)
- **Prereqs**: T-5

---

### C4 — Three Call-Site Rewires

#### T-7: Rewire `getDashboardPageDataAction` to fetch and pass events
- **What**: Add events query to the `Promise.all` — `prisma.corporateEvent.findMany` scoped to instruments in the user's portfolio (filter via `instrument.transactions.some({ portfolio: { userId: user.id } })`), ordered by `effectiveDate asc`. Group results by `instrumentId` into `Map<string, CorporateEventForBuilder[]>` (map `effectiveDate` to `YYYY-MM-DD` string). Pass the map as third arg to `buildHoldings(trades, prices, eventsMap)`.
- **Files**: `src/app/actions/dashboard.ts`
- **Acceptance**: Action compiles; a portfolio with a registered SPY 3:1 event shows adjusted SPY quantity on the dashboard; `pnpm lint` + `pnpm tsc --noEmit` pass.
- **Spec refs**: FR-5, FR-12 (AD-10, AD-11)
- **Prereqs**: T-6

#### T-8: Rewire `getTransactionsPageDataAction` to fetch and pass events
- **What**: Same events query pattern as T-7. Pass `eventsMap` as third arg to `buildHoldings(tradesForHoldings, latestPrices, eventsMap)`. No changes to history/trade rows — events affect holdings display only.
- **Files**: `src/app/actions/transactions.ts`
- **Acceptance**: Compiles; holdings quantities on transactions page match dashboard after event; `pnpm lint` + `pnpm tsc --noEmit` pass.
- **Spec refs**: FR-5 (AD-10)
- **Prereqs**: T-6

#### T-9: Unify `getDividendsPageDataAction` — remove `computeHoldings`, rewire to `buildHoldings`
- **What**: This is the `computeHoldings` unification sub-task (FR-6). Steps: (a) Delete the inline `computeHoldings` function. (b) Add `price` and `netAmount` to the `tradeRows` select (needed by `TradeForHoldings`). (c) Add events query to `Promise.all` using the same scoping pattern as T-7/T-8. (d) Build `TradeForHoldings[]` from `tradeRows` (mapping `instrument.id`, `instrument.ticker`, `instrument.type`, `instrument.name`, `type`, `quantity`, `price`, `netAmount`, `tradeDate`). (e) Call `buildHoldings(trades, new Map(), eventsMap)` — pass empty prices map (no market price needed for dividend forecast quantity). (f) Map `HoldingRow[]` → `HoldingForForecast[]` for `forecastUpcomingDividends`. The shape difference: `HoldingForForecast` needs `{ ticker, instrumentName, instrumentType, quantity }` — all present on `HoldingRow`. Pass `eventsMap` as third arg.
- **Files**: `src/app/actions/dividends.ts`
- **Acceptance**: `computeHoldings` no longer exists in the file; dividend forecast quantities match dashboard quantities for the same instrument after an event; `pnpm lint` + `pnpm tsc --noEmit` pass.
- **Spec refs**: FR-5, FR-6 (AD-10, R-7)
- **Prereqs**: T-6

---

### C5 — Server Actions

#### T-10: Create `src/app/actions/events.ts` — `listCorporateEvents`
- **What**: Implement `listCorporateEvents(): Promise<CorporateEventDTO[] | { error: "unauthorized" }>`. Auth via `getCurrentUser`. Single `prisma.corporateEvent.findMany` scoped to instruments held by the user (`instrument.transactions.some({ portfolio: { userId } })`), `include: { instrument: { select: { ticker: true } } }`, `orderBy: { effectiveDate: "desc" }`. Map to `CorporateEventDTO` (format `effectiveDate` as `YYYY-MM-DD` string). No extra queries beyond this one.
- **Files**: `src/app/actions/events.ts`
- **Acceptance**: Returns empty array for new user; returns events ordered newest-first; a user without auth gets `{ error: "unauthorized" }`; `pnpm tsc --noEmit` passes; NFR-3 satisfied (single findMany).
- **Spec refs**: FR-3, FR-12, NFR-3 (AD-10, AD-11)
- **Prereqs**: T-3, T-4, T-2

#### T-11: Add `previewCorporateEvent` action
- **What**: Implement `previewCorporateEvent(input: NewEventInput): Promise<{ ok: true; current: HoldingRow | null; projected: HoldingRow } | { ok: false; error: string }>`. Auth → zod `safeParse` → verify instrument is in user's portfolio → fetch trades + existing events (for that instrument) from DB → build current holdings (without virtual event) → build projected holdings (with virtual event appended and sorted into the events map) using `buildHoldings` with a dummy price entry (use existing `avgPriceArs` from current or 0). No DB write occurs. Reuse `buildHoldings` — no parallel math.
- **Files**: `src/app/actions/events.ts`
- **Acceptance**: Returns `{ ok: false }` if auth fails or input invalid; returns `{ ok: true, current, projected }` with adjusted quantities; `projected.netAmount` equals `current.netAmount` (invariant); no DB write on preview; NFR-4 satisfied.
- **Spec refs**: FR-2, FR-4 (no write), NFR-4 (AD-4, AD-5)
- **Prereqs**: T-10, T-6

#### T-12: Add `createCorporateEvent` action
- **What**: Implement `createCorporateEvent(input: NewEventInput): Promise<{ ok: true; event: CorporateEventDTO } | { ok: false; error: string }>`. Auth → zod `safeParse` (server-side re-validate) → `prisma.corporateEvent.create` with `createdByUserId: user.id` and `effectiveDate: new Date(input.effectiveDate)` → catch Prisma P2002 and return `{ ok: false, error: "Ya existe un evento de este tipo para el instrumento en esa fecha." }` → on success call `revalidatePath` for `/events`, `/dashboard`, `/transactions`, `/dividends`. Before implementing, read `node_modules/next/dist/docs/` for v16-specific `revalidatePath` API — do NOT guess from training data.
- **Files**: `src/app/actions/events.ts`
- **Acceptance**: New row in DB on success; P2002 returns friendly Spanish error without 500; all 4 paths revalidated; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-1, FR-7, FR-2 (AD-5, AD-7, AD-11)
- **Prereqs**: T-11

#### T-13: Add `deleteCorporateEvent` action
- **What**: Implement `deleteCorporateEvent(id: string): Promise<{ ok: true } | { ok: false; error: string }>`. Auth → find event by id + verify ownership via `instrument.transactions.some({ portfolio: { userId } })` → hard DELETE → `revalidatePath` × 4 (same paths as T-12). On missing or unauthorized: return vague `{ ok: false, error: "Evento no encontrado." }` (avoid existence leak). Before implementing, read `node_modules/next/dist/docs/` for v16-specific `revalidatePath` API if not already done in T-12.
- **Files**: `src/app/actions/events.ts`
- **Acceptance**: Row deleted from DB; all 4 paths revalidated; unauthorized returns vague error (no 500); `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-4, FR-12 (AD-6, AD-10)
- **Prereqs**: T-12

---

### C6 — UI Components

#### T-14: Create `src/components/events/format.ts`
- **What**: Export `formatRatio(numerator: string, denominator: string): string` (returns `"3:1"` format) and `formatEventTypeLabel(type: CorporateEventType): string` (human-readable Spanish labels for each enum value, e.g. CEDEAR_RATIO_CHANGE → "Ratio CEDEAR", STOCK_SPLIT → "Split", REVERSE_SPLIT → "Reverse Split", SPINOFF → "Spin-off", MERGER → "Fusión", TICKER_CHANGE → "Cambio de ticker").
- **Files**: `src/components/events/format.ts`
- **Acceptance**: Each enum value maps to a non-empty label; formatRatio("3","1") returns "3:1"; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-3 (§6 UI Design)
- **Prereqs**: T-3

#### T-15: Create `src/components/events/event-delete-dialog.tsx`
- **What**: Radix AlertDialog. Props: `id: string`, `ticker: string`, `open: boolean`, `onOpenChange(open: boolean): void`. Body copy: "¿Eliminar este evento? Esta acción no se puede deshacer." Buttons: `Cancelar` (ghost/outline) + `Eliminar` (rose-400 destructive). On confirm: call `deleteCorporateEvent(id)` → on `!result.ok` show inline error; on success close dialog (parent handles revalidation via server).
- **Files**: `src/components/events/event-delete-dialog.tsx`
- **Acceptance**: Confirmation dialog shows correct copy; cancel closes without action; confirm calls `deleteCorporateEvent`; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-4 (AD-12)
- **Prereqs**: T-13, T-14

#### T-16: Create `src/components/events/events-list.tsx`
- **What**: Client component. Props: `events: CorporateEventDTO[]`. Renders a table with columns: Ticker, Tipo (via `formatEventTypeLabel`), Fecha efectiva (`YYYY-MM-DD` display), Ratio (via `formatRatio`), Notas (truncated to 40 chars, full text in tooltip via Radix Tooltip), delete Trash icon (opens `EventDeleteDialog`). Empty state: text "No hay eventos registrados." with secondary CTA "Registrar tu primer evento". Handles delete-dialog open state internally.
- **Files**: `src/components/events/events-list.tsx`
- **Acceptance**: Renders all passed events; delete icon per row opens confirmation; empty state shown when events=[]; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-3, FR-4 (§6 UI Design, NFR-3)
- **Prereqs**: T-15

#### T-17: Create `src/components/events/event-form-dialog.tsx` — combined form + preview Dialog
- **What**: Single Radix Dialog. Local state: `step: "form" | "preview"`, `pendingInput: NewEventInput | null`, `preview: ProjectedPosition | null`, `pending: boolean`. Form pane (step="form"): react-hook-form + zodResolver(newEventInputSchema). Fields in order: Instrument combobox (options from `instrumentOptions: { id: string; ticker: string }[]` prop, scoped to held instruments), Event type select (all CorporateEventType values with labels), Effective date `<input type="date">` (default today), Numerator + Denominator side by side with `:` separator (both number inputs min=1), Notes textarea. On submit: call `previewCorporateEvent(input)` → on ok set `preview` + set `step="preview"` → on error show inline error. Preview pane (step="preview"): headline = ticker + event type label + effectiveDate. Two-column table: "Actual" vs "Proyectado" rows for Cantidad and PPP ARS. Footer: "Costo total en ARS se mantiene" (invariant note). Buttons: `Atrás` (returns to form, preserves values) + `Confirmar` (calls `createCorporateEvent(pendingInput)` → on ok close dialog; on error show inline error). Primary button disabled + spinner while `pending=true`.
- **Files**: `src/components/events/event-form-dialog.tsx`
- **Acceptance**: Form validates before preview fetch; preview shows correct actual vs projected; cancel from preview returns to filled form; confirm persists and closes; `pnpm tsc --noEmit` passes; NFR-4 satisfied (no second math path).
- **Spec refs**: FR-1, FR-2, FR-9, NFR-4 (AD-5, AD-12)
- **Prereqs**: T-12, T-14, T-4

#### T-18: Create `src/components/events/events-page.tsx` — client root
- **What**: Client root component. Props: `initialEvents: CorporateEventDTO[]`, `instrumentOptions: { id: string; ticker: string }[]`. State: dialog open flag. Renders: page header (title "Eventos Corporativos"), 3 KPI chips (total events count, last effective date, distinct instruments count — computed from `initialEvents`), `+ Registrar evento` CTA button, `EventsList`. Wire `EventFormDialog` with `instrumentOptions`. KPI values computed client-side from `initialEvents`.
- **Files**: `src/components/events/events-page.tsx`
- **Acceptance**: KPIs show correct counts from initial data; CTA opens form dialog; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-3, FR-8 (§6 UI Design)
- **Prereqs**: T-16, T-17

#### T-19: Create `src/app/(app)/events/page.tsx` — server component shell
- **What**: Server component. Auth guard: call `getCurrentUser()`, if not found redirect to login. Fetch `listCorporateEvents()` and fetch held instruments from DB for the picker (reuse the portfolio-scoped instrument query pattern from dashboard — `prisma.instrument.findMany` where instrument has transactions in the user's portfolios). Render `<EventsPage initialEvents={events} instrumentOptions={instruments} />`. Before implementing, verify the correct server component pattern in `node_modules/next/dist/docs/` for Next.js 16.
- **Files**: `src/app/(app)/events/page.tsx`
- **Acceptance**: Page renders server-side with real data; unauthenticated user is redirected; `pnpm tsc --noEmit` passes.
- **Spec refs**: FR-3, FR-12 (AD-11)
- **Prereqs**: T-10, T-18

---

### C7 — Sidebar + Final Quality Gates

#### T-20: Add `/events` sidebar entry
- **What**: Import `CalendarSync` from `lucide-react`. Add `{ href: "/events", label: "Eventos", icon: CalendarSync }` to the `items` array between the `/dividends` and `/imports` entries.
- **Files**: `src/components/layout/sidebar.tsx`
- **Acceptance**: Sidebar renders "Eventos" link between "Dividendos" and "Imports"; active state highlights correctly on `/events` route; `pnpm lint` + `pnpm tsc --noEmit` pass.
- **Spec refs**: FR-8
- **Prereqs**: T-19

#### T-21: Final lint + typecheck pass
- **What**: Run `pnpm lint` and `pnpm tsc --noEmit` across the full codebase. Fix all reported errors and warnings. Verify `prisma generate` still exits 0.
- **Files**: Any file with lint/type errors
- **Acceptance**: Zero lint errors; zero TypeScript errors; `pnpm db:generate` exits 0.
- **Spec refs**: NFR-1
- **Prereqs**: T-20 (all prior tasks complete)

---

## 2. Suggested Commit Boundaries

| Commit | Tasks | Description |
|--------|-------|-------------|
| C1 | T-1, T-2 | Schema: add `CorporateEvent` model + migration |
| C2 | T-3, T-4, T-5 | Pure event-apply lib (`types`, `validations`, `apply`) |
| C3 | T-6 | `buildHoldings` events-aware (optional 3rd arg) |
| C4 | T-7, T-8, T-9 | Three call-site rewires (dashboard, transactions, dividends + `computeHoldings` unification) |
| C5 | T-10, T-11, T-12, T-13 | Server actions: list, preview, create, delete |
| C6 | T-14, T-15, T-16, T-17, T-18, T-19 | UI components + page shell |
| C7 | T-20, T-21 | Sidebar entry + final lint/tsc pass |

---

## 3. Dependency Graph

```
T-1 → T-2 → T-4
              ↓
T-3 → T-5 → T-6 → T-7
                  → T-8
                  → T-9

T-2 + T-3 → T-10 → T-11 → T-12 → T-13
                                    ↓
T-14 ──────────────────────────────→ T-15 → T-16 ──→ T-18 → T-19 → T-20 → T-21
T-4 + T-12 + T-14 ────────────────→ T-17 ──↗
```

**Sequential (hard blockers)**:
- T-1 must complete before T-2 (migration needs schema)
- T-2 must complete before T-4 (zod needs generated `CorporateEventType`)
- T-3 must complete before T-5 (apply.ts needs types)
- T-5 must complete before T-6 (holdings.ts calls applyEventsToTrade)
- T-6 must complete before T-7, T-8, T-9 (call sites need extended signature)
- T-10 must complete before T-11 (preview uses same file + list deps)
- T-11 must complete before T-12 (create builds on same file)
- T-12 must complete before T-13 (delete builds on same file)
- T-13 must complete before T-15 (delete dialog calls deleteCorporateEvent)
- T-16 must complete before T-18 (page root uses list)
- T-17 must complete before T-18 (page root uses form dialog)
- T-18 must complete before T-19 (page shell renders client root)
- T-19 must complete before T-20 (sidebar links to /events route)
- T-20 must complete before T-21 (final pass covers all files)

**Parallelizable (if future iterations split work)**:
- T-3 (types) and T-1/T-2 (schema) can proceed in parallel
- T-7, T-8, T-9 (call-site rewires) can proceed in parallel after T-6
- T-14 (format.ts) can proceed in parallel with T-10–T-13 (actions)
- T-15 and T-16 could be written in parallel (T-15 depends on T-13, T-16 depends on T-15 — sequential within the UI chain)

---

## 4. Quality Gates

**Per-commit gates** (run after each commit boundary before starting the next):
- `pnpm lint` — zero errors
- `pnpm tsc --noEmit` — zero errors
- After C1: `pnpm db:generate` exits 0; `prisma migrate status` shows clean

**Per-task acceptance** is defined inline above. Apply phase MUST verify the one-line acceptance criterion before marking a task done.

**No test runs** — strict TDD is OFF for this project (no test runner installed).

---

## 5. Risks to Watch During Apply

| Risk | Mitigation |
|------|------------|
| **Decimal composition rounding** | Use `new Decimal(numerator).div(denominator)` throughout; NEVER touch `netAmount`; verify composed 2:1 × 3:1 yields ×6 by manually computing with 2 stacked events |
| **effectiveDate boundary** | Always compare `trade.tradeDate.slice(0,10) < event.effectiveDate` as lexical string; document this in JSDoc; do NOT use `Date.getTime()` comparison |
| **TICKER_CHANGE no-op** | Guard in `applyEventsToTrade` before ratio math; a test via UI: register TICKER_CHANGE and verify dashboard unchanged |
| **Revalidation paths** | Must hit `/events`, `/dashboard`, `/transactions`, `/dividends` in both `createCorporateEvent` and `deleteCorporateEvent`; read Next.js 16 docs before coding |
| **next-auth v5 session access** | Use `getCurrentUser()` pattern exactly as in `dashboard.ts` / `imports.ts`; read `node_modules/next/dist/docs/` for v5 beta session API before deviating |
| **P2002 duplicate key** | Catch Prisma error code `P2002` by checking `error.code`; return Spanish user-facing message; do NOT let it bubble to 500 |
| **dividends.ts rewire (T-9)** | `buildHoldings` with an empty prices Map returns `avgPriceArs = avgPrice` from cost-basis math — correct for quantity-only use; verify `HoldingRow.quantity` matches `computeHoldings` output for same trades set |
| **Instrument picker scope** | Picker options come from server (page.tsx query); client never calls DB directly — options passed as prop to `EventsPage` |
| **Migration irreversibility** | Schema changes are additive-only; no destructive migration; rollback = drop the table (documented) |

---

## 6. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated total net changed lines | ~618 (from design §8, excluding generated migration SQL ~30 lines) |
| Chained PRs recommended | **No** — single-pr delivery, user accepted `size:exception` |
| 400-line budget risk | **High** — ~218 lines over the 400-line default budget |
| Decision needed before apply | **No** — already resolved in proposal phase |

> **Note**: This PR is marked `size:exception` per user decision in proposal phase. Reviewer should expect a larger-than-default diff. All reductions already applied per design §8 (preview folded into form dialog, empty state reuses header button). Further reductions were deliberately not applied to keep the design intact.

---

## 7. Apply-Phase Handoff Notes

- **Strict TDD**: OFF. No test runs. Quality gates = `pnpm lint` + `pnpm tsc --noEmit` only.
- **Before each task**: Read the task's "Files" list and "Acceptance" criterion.
- **Next.js 16 caveat**: Tasks T-12, T-13, T-19 explicitly require reading `node_modules/next/dist/docs/` before touching `revalidatePath` or server component patterns. Do NOT assume training-data behavior.
- **On continuation batches**: Apply MUST search `sdd/spy500-split/apply-progress` in engram, read the full observation, merge new progress, and save the combined result. Do NOT overwrite — MERGE.
- **Artifact language**: All code, comments, UI copy, and identifiers in English. Exception: user-facing dialog copy and error messages (Spanish, as specified in spec FR-4 and AD-7).
- **Decimal.js**: Already imported in `holdings.ts` and `dividends.ts`. Import from `"decimal.js"` (same as existing usage).
- **Prisma generated path**: `@/lib/generated/prisma` (confirmed from existing imports in `dividends.ts`).
