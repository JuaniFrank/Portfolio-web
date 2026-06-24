# Corporate Events — Technical Design
# Change: spy500-split

**Type**: Architecture & implementation design
**Status**: Design
**Delivery**: single-pr
**Date**: 2026-06-09

This document specifies HOW the Corporate Events feature is built. It complements `proposal.md` (the WHY/WHAT) and `spec.md` (functional and non-functional requirements). Task breakdown is deferred to `tasks.md`.

---

## 1. Architecture Decisions

Each decision is numbered, with rationale and rejected alternatives.

### AD-1 — `CorporateEvent` is a first-class table, not a Transaction subtype

- **Decision**: Add a dedicated `CorporateEvent` Prisma model with its own enum `CorporateEventType`. Do NOT reuse `TransactionType.SPLIT` / `REVERSE_SPLIT` / `SPINOFF` / `MERGER` / `ADJUSTMENT`.
- **Why**: Separation of concerns. Trades are economic movements; corporate events are scaling/rename declarations applied to past trades. Reusing `Transaction` would (a) require the holdings builder to detect and re-interpret rows mid-loop, (b) destroy idempotency hashing (a SPLIT row inserted from the UI cannot share the broker idempotency contract), and (c) couple the audit trail of trades with the audit trail of events.
- **Rejected alternative — Approach C in exploration** (append-only adjustment Transactions): worse idempotency, fragile linking between the event row and the synthetic trade rows it generated, and PPP math becomes ambiguous because adding zero-cost shares mixes "cost" with "scaling".
- **Rejected alternative — Approach B** (write-time mutation of Transactions): irreversible without an undo log, destroys audit, violates the append-only ledger.

### AD-2 — Holdings builder receives events as `Map<instrumentId, CorporateEvent[]>`

- **Decision**: `buildHoldings` accepts an optional 3rd argument, a `Map` keyed by `instrumentId`. The orchestrating Server Action pre-sorts each instrument's events by `effectiveDate` ascending before passing.
- **Why**: O(1) lookup per trade inside the inner loop; pre-sorting moves the work to the caller (one sort per instrument) instead of repeating it per trade. The signature stays backwards compatible — existing tests/fixtures and any future call site that does not care about events can omit the parameter.
- **Rejected alternative**: pass a flat array. Forces the builder to filter per trade — O(trades × events) instead of O(trades).

### AD-3 — Decimal math via `decimal.js` runtime only — no `number` coercion in the builder

- **Decision**: The ratio multiplier is constructed as `new Decimal(numerator).div(new Decimal(denominator))`. The adjustment to a trade is computed via `quantity = quantity.mul(ratio)` and `price = price.div(ratio)`. `netAmount` is NEVER touched.
- **Why**: Composed ratios (multiple events applied chronologically to the same trade) compound rounding errors if they ever pass through JS `number`. `decimal.js` is already a transitive dependency (Prisma uses it for `Decimal` columns) and is already imported in `holdings.ts`. Keeping the boundary tight (string → Decimal → Decimal → string) prevents an entire class of precision bugs.
- **Rejected alternative**: `Number(numerator) / Number(denominator)` for "small" ratios. The spec accepts arbitrary `Decimal(20, 8)` precision — coercion is incorrect on principle.

### AD-4 — Preview is computed by reusing `buildHoldings` (single source of truth)

- **Decision**: `previewCorporateEvent` constructs a virtual event in memory (NOT persisted), calls the existing query path (fetch user's trades for the instrument + existing persisted events for that instrument), merges the virtual event into the events Map, and invokes `buildHoldings`. It returns the projected `HoldingRow` for the affected instrument plus the current (pre-virtual-event) `HoldingRow` for comparison.
- **Why**: Eliminates divergence between what the user sees in the preview and what they see after confirm. No second math path to keep in sync with the builder. If the builder ever changes (e.g., switches `PPP` → `FIFO`), the preview tracks it for free.
- **Rejected alternative**: dedicated preview function that mirrors the builder's math. Two implementations of the same arithmetic always drift.

### AD-5 — Two-step Server Action flow for create (preview then commit)

- **Decision**: Two server actions. `previewCorporateEvent(input)` does NOT write — it returns `{ current, projected }` positions. `createCorporateEvent(input)` writes inside a single Prisma `create` and returns the new event DTO. The client retains the same `input` between the two calls and re-submits it on confirm. The server does NOT trust client-cached preview state — `createCorporateEvent` re-validates the same `input` server-side.
- **Why**: Per Next.js 16 / React 19 patterns observed in this codebase (no `useActionState` is used anywhere; `imports.ts` shows imperative Server Action calls returning typed unions). Two independent actions are simpler than smuggling a "step" discriminator through a single action. Re-validating on confirm is mandatory because the user could have lingered on the preview while trades changed.
- **Rejected alternative**: single action with a `commit: boolean` flag. Same surface in spirit, but mixes "compute" and "write" responsibilities and complicates testability later.

### AD-6 — Delete = revert. No soft-delete, no audit log UI

- **Decision**: `deleteCorporateEvent(id)` is a hard `DELETE` on the row. The next read recomputes holdings without it.
- **Why**: Source `Transaction` rows are never mutated by event creation. Therefore deleting the event row is sufficient rollback by definition. A soft-delete column would add complexity for no user-visible benefit in this slice. `appliedAt` and `createdByUserId` are persisted for future audit but are NOT surfaced in the UI.
- **Future**: if audit becomes required, the existing `AuditLog` table can capture create/delete actions.

### AD-7 — Idempotency at the DB layer; user-facing error mapping in the Server Action

- **Decision**: `@@unique([instrumentId, effectiveDate, eventType])` on `CorporateEvent`. The `createCorporateEvent` action catches Prisma `P2002` (unique constraint violation) and returns `{ ok: false, error: "Ya existe un evento de este tipo para este instrumento en esa fecha." }`.
- **Why**: DB-level guard is authoritative. Re-checking in application code creates a TOCTOU window. Catching `P2002` and remapping it gives a friendly UX without sacrificing correctness.

### AD-8 — `effectiveDate` boundary is exclusive on the left

- **Decision**: A trade is "pre-event" iff `trade.tradeDate < event.effectiveDate`. A trade on the effectiveDate itself is post-event (already at the new scale).
- **Why**: Matches market convention: on the effective date, the new ratio is already trading. The spec explicitly enumerates this in Glossary and FR-5. Stored as `DateTime` but compared at day granularity by relying on consistent `tradeDate` semantics (existing trades are persisted at midnight UTC of trade day, per importer).

### AD-9 — `TICKER_CHANGE` is a persisted enum value with builder no-op

- **Decision**: `CorporateEventType.TICKER_CHANGE` is part of the enum and selectable in the UI for recording purposes, but `applyEventsToTrade` returns the trade unchanged when the type is `TICKER_CHANGE`. `Instrument.ticker` is NOT mutated in this slice.
- **Why**: Users may want to log a rename for record-keeping. Implementing the actual ticker rewrite (and its ripple to `PriceCache`, dividend matching, Yahoo symbols, idempotency hashes) is out of scope per Non-Goals §3.

### AD-10 — Events are scoped to the user's portfolio when listed and queried

- **Decision**: `listCorporateEvents` and the queries inside the read actions filter events by `instrument.transactions.some({ portfolio: { userId } })`. The instrument picker in the create form is similarly scoped.
- **Why**: An event row in the DB is per-instrument, not per-user. But a user should only see and act on events for instruments they actually hold. This is consistent with how `getTransactionsPageDataAction` scopes queries today.

### AD-11 — Server Actions use `next-auth` v5 beta session via the existing `getCurrentUser` helper

- **Decision**: All four actions in `src/app/actions/events.ts` start with `const user = await getCurrentUser(); if (!user) return { error: "unauthorized" };`. This mirrors the contract used by `dashboard.ts`, `transactions.ts`, `dividends.ts`, `imports.ts`.
- **Why**: Consistency. Existing actions all use this pattern. Diverging on auth here would just create churn.

### AD-12 — Modal-based create flow (single Dialog, two panes)

- **Decision**: The create flow lives in one Radix Dialog. Pane 1 = form. Pane 2 = preview. The user toggles by clicking "Preview" (which triggers `previewCorporateEvent`) and can click "Back" to return to the form. "Confirm" on pane 2 triggers `createCorporateEvent` and closes the dialog on success.
- **Why**: Keeps the diff size small (no second page route). Aligns with existing modal patterns in `imports/` UI. The two-pane structure inside one component file is also the recommended diff-budget reduction (see §8).

---

## 2. Schema and Migration Plan

### 2.1 Final Prisma additions

```prisma
enum CorporateEventType {
  CEDEAR_RATIO_CHANGE
  STOCK_SPLIT
  REVERSE_SPLIT
  SPINOFF
  MERGER
  TICKER_CHANGE
}

model CorporateEvent {
  id              String             @id @default(cuid())
  instrumentId    String
  instrument      Instrument         @relation(fields: [instrumentId], references: [id], onDelete: Cascade)
  eventType       CorporateEventType
  effectiveDate   DateTime
  numerator       Decimal            @db.Decimal(20, 8)
  denominator     Decimal            @db.Decimal(20, 8)
  notes           String?
  appliedAt       DateTime           @default(now())
  createdByUserId String
  createdByUser   User               @relation("CorporateEventCreator", fields: [createdByUserId], references: [id])

  @@unique([instrumentId, effectiveDate, eventType])
  @@index([instrumentId])
  @@index([createdByUserId])
}
```

### 2.2 Inverse relations added to existing models

On `Instrument`:
```prisma
corporateEvents CorporateEvent[]
```

On `User`:
```prisma
corporateEventsCreated CorporateEvent[] @relation("CorporateEventCreator")
```

### 2.3 What is NOT changed

- `TransactionType` enum — untouched. `SPLIT`, `REVERSE_SPLIT`, `SPINOFF`, `MERGER`, `ADJUSTMENT` remain as import-artifact types excluded from `TRADE_TYPES`.
- `Instrument.conversionRatio` — untouched. Still metadata.
- `PortfolioSnapshot` — untouched. Stale snapshots after retroactive events are a documented limitation (proposal §9).

### 2.4 Migration

- Name: `add_corporate_event_model`
- Generated by `pnpm db:migrate dev --name add_corporate_event_model`
- Content: `CREATE TYPE "CorporateEventType" AS ENUM (...)`, `CREATE TABLE "CorporateEvent" (...)`, `CREATE UNIQUE INDEX`, `CREATE INDEX`, foreign keys. Purely additive — no data migration, no destructive changes, no downtime risk.

---

## 3. Data Flow

### 3.1 Read flow (every page that depends on holdings)

```
HTTP request to /dashboard | /transactions | /dividends
  -> Server Action (e.g. getDashboardPageDataAction)
       -> Promise.all([
            prisma.transaction.findMany(BUY/SELL trades for user),
            prisma.corporateEvent.findMany(events for instruments touched by user),
            prisma.fxRate.findFirst(latest CCL)
          ])
       -> map trades -> TradeForHoldings[]
       -> group events by instrumentId, sort each list by effectiveDate ASC
            -> Map<instrumentId, CorporateEventForBuilder[]>
       -> buildHoldings(trades, prices, eventsMap)
            -> for each trade: applyEventsToTrade(trade, events) before accumulation
       -> downstream (buildDashboardData / aggregateReceivedDividends / forecastUpcomingDividends)
  -> typed payload returned to Client Component
```

### 3.2 Create flow (two-step)

```
[Client] User fills form in EventFormDialog
  -> onSubmit -> formAction = "preview"
     -> previewCorporateEvent(input)
         -> getCurrentUser, verify instrument belongs to user
         -> validate input with zod
         -> fetch trades for the instrument + existing events
         -> merge virtual event into events list (sorted)
         -> buildHoldings(trades, prices, virtualEventsMap) for that single instrument
         -> return { current: HoldingRow | null, projected: HoldingRow }
  -> [Client] EventFormDialog switches to preview pane
  -> User clicks Confirm
     -> createCorporateEvent(input)   // same input, re-validated server-side
         -> getCurrentUser, verify instrument belongs to user
         -> re-validate input with zod
         -> prisma.corporateEvent.create({...})
         -> on P2002: return { ok: false, error: "..." }
         -> on success: revalidatePath("/events"), revalidatePath("/dashboard"),
                        revalidatePath("/transactions"), revalidatePath("/dividends")
         -> return { ok: true, event: CorporateEventDTO }
  -> [Client] Dialog closes, list refreshes via revalidation
```

### 3.3 Delete flow

```
[Client] User clicks trash icon -> EventDeleteDialog opens
  -> User clicks Confirm
     -> deleteCorporateEvent(id)
         -> getCurrentUser, verify event belongs to an instrument the user holds
         -> prisma.corporateEvent.delete({ where: { id } })
         -> revalidatePath("/events"), revalidatePath("/dashboard"),
            revalidatePath("/transactions"), revalidatePath("/dividends")
         -> return { ok: true }
  -> [Client] Dialog closes, list refreshes via revalidation
```

---

## 4. API Surface (Server Actions)

All four live in `src/app/actions/events.ts` with the `"use server"` directive at the top, and all four use `getCurrentUser` for auth. Return types are typed unions of success and error.

### 4.1 `previewCorporateEvent`

```ts
type PreviewResult =
  | { ok: true; current: HoldingRow | null; projected: HoldingRow }
  | { ok: false; error: string };

export async function previewCorporateEvent(
  input: NewEventInput
): Promise<PreviewResult>;
```

- Auth gate: `getCurrentUser`.
- Validation: `newEventInputSchema.safeParse(input)`. On failure, return `{ ok: false, error: <first issue message> }`.
- Authorization: verify `input.instrumentId` corresponds to an instrument the user holds (`transaction.findFirst` with the user filter). Otherwise return `{ ok: false, error: "Instrumento no encontrado en tu portfolio." }`.
- Fetches: user's trades for the instrument + existing persisted events for the instrument + latest price for the instrument.
- Compute: merges the virtual event into the events list (sorted ascending by effectiveDate), calls `buildHoldings` for trades of that single instrument, picks out the single `HoldingRow`. Also runs `buildHoldings` without the virtual event for `current`. Both calls share the same trades and price fetch.
- Does NOT write. No `revalidatePath`.

### 4.2 `createCorporateEvent`

```ts
type CreateResult =
  | { ok: true; event: CorporateEventDTO }
  | { ok: false; error: string };

export async function createCorporateEvent(
  input: NewEventInput
): Promise<CreateResult>;
```

- Auth gate: `getCurrentUser`.
- Validation: `newEventInputSchema.safeParse(input)` — same schema, server-side re-check. NEVER trust the client.
- Authorization: same instrument ownership check as preview.
- Write: `prisma.corporateEvent.create({ data: { ...input, createdByUserId: user.id } })`. Wrap in `try/catch`. On `Prisma.PrismaClientKnownRequestError` with `code === "P2002"`, return the friendly duplicate error. On other errors, log and return a generic message.
- After success: `revalidatePath` for `/events`, `/dashboard`, `/transactions`, `/dividends`.

### 4.3 `listCorporateEvents`

```ts
export async function listCorporateEvents(): Promise<
  CorporateEventDTO[] | { error: "unauthorized" }
>;
```

- Auth gate.
- Query: `prisma.corporateEvent.findMany` where `instrument.transactions.some({ portfolio: { userId } })`. `include: { instrument: { select: { ticker, name, type } } }`. `orderBy: { effectiveDate: "desc" }`.
- Map to `CorporateEventDTO[]`. Same string-serialization pattern used elsewhere for `Decimal` fields.

### 4.4 `deleteCorporateEvent`

```ts
type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteCorporateEvent(id: string): Promise<DeleteResult>;
```

- Auth gate.
- Authorization: fetch the event with its instrument; verify the user holds at least one trade on that instrument. On failure return `{ ok: false, error: "Evento no encontrado." }` (intentionally vague to avoid leaking existence).
- Delete: `prisma.corporateEvent.delete({ where: { id } })`.
- `revalidatePath` for the same four paths as create.

---

## 5. Validation Strategy

### 5.1 zod schema (`src/lib/events/validations.ts`)

```ts
import { z } from "zod";
import { CorporateEventType } from "@/lib/generated/prisma";

export const newEventInputSchema = z.object({
  instrumentId: z.string().min(1, "Seleccioná un instrumento."),
  eventType: z.nativeEnum(CorporateEventType),
  // ISO date string (YYYY-MM-DD) from <input type="date">
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  // Strings because react-hook-form yields strings; coerced to Decimal in the action.
  numerator: z
    .string()
    .refine((v) => Number(v) > 0, "El numerador debe ser mayor a 0."),
  denominator: z
    .string()
    .refine((v) => Number(v) > 0, "El denominador debe ser mayor a 0."),
  notes: z.string().max(500).optional().nullable(),
});

export type NewEventInput = z.infer<typeof newEventInputSchema>;
```

### 5.2 Constraints

- `numerator > 0` and `denominator > 0` — enforced both client-side via `zodResolver` and server-side via `safeParse` inside both `previewCorporateEvent` and `createCorporateEvent`.
- `eventType` ∈ enum — `z.nativeEnum`.
- `effectiveDate` ≤ today is NOT enforced as a validation error — future events are permitted. The UI MAY flag them visually as "fecha futura" but does not block.
- `notes` ≤ 500 characters.

### 5.3 Client form

- `react-hook-form` with `zodResolver(newEventInputSchema)`.
- Submit handler runs `previewCorporateEvent`, sets dialog pane to preview on success.
- The same `input` object is held in component state and re-sent to `createCorporateEvent` on confirm.

---

## 6. UI Design — `/events`

### 6.1 Page layout

`/events` page (server component shell) renders the `EventsPage` client component which contains:

1. Header: title "Eventos corporativos" + 1-line description.
2. KPI strip — three cards using the existing `rounded-xl border border-zinc-800 bg-zinc-900/40` style:
   - Total events registered.
   - Date of most recent event (or "—").
   - Distinct instruments with at least one event.
3. Primary CTA: `+ Registrar evento` button (top-right of the table area).
4. Events table (full width).

### 6.2 Create flow UI — `EventFormDialog`

Single Radix `Dialog` with two visual states managed by a local `step: "form" | "preview"`:

**Form pane** fields, in order:
1. Instrument combobox — scoped to user's held instruments (search by ticker or name). Required.
2. Event type select — six options with human-friendly labels in Spanish.
3. Effective date — `<input type="date">`. Defaults to today.
4. Numerator and Denominator — two number inputs side-by-side with a small `:` separator and helper text: "Ejemplo: para 3:1, ingresá 3 y 1." Both required, both `> 0`.
5. Notes — optional `<textarea>`.
6. Buttons: `Cancelar` (closes dialog), `Vista previa` (triggers `previewCorporateEvent`).

**Preview pane** content:
- Headline: ticker + event type label + effectiveDate.
- Two-column comparison (`Actual` vs `Proyectado`) showing: quantity, PPP ARS. Both with the same formatting as `holdings.ts` outputs.
- Invariant footer: "Costo total en ARS y valor de mercado se mantienen."
- Buttons: `Atrás` (returns to form, preserves all field values), `Confirmar` (triggers `createCorporateEvent`).

Error states (validation or server) render as a red `<p>` above the buttons in the active pane. A pending state (during the action call) disables the primary buttons and shows a spinner.

### 6.3 Events list table — `EventsList`

Columns, in order: Ticker, Tipo, Fecha efectiva, Ratio (rendered as `${numerator}:${denominator}`), Notas (truncated to ~40 chars with full text in a tooltip), Acción (trash icon).

Styling matches the existing dividends/dashboard tables: `text-sm`, zebra rows, sticky header, `text-zinc-300` body, `text-zinc-500` muted.

Empty state: centered message "No registraste eventos corporativos todavía." + the same `+ Registrar evento` button as a secondary CTA inside the empty card.

### 6.4 Delete flow UI — `EventDeleteDialog`

Trash icon in the row triggers a Radix AlertDialog. Generic copy per AD-6:

> ¿Eliminar este evento?
> Esta acción no se puede deshacer. Las posiciones afectadas se recalcularán sin este evento.

Buttons: `Cancelar`, `Eliminar` (rose-400 destructive variant). On success, dialog closes and the list refreshes via revalidation.

---

## 7. File Layout (concrete paths)

| Path | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | Add `CorporateEventType` enum, `CorporateEvent` model, inverse relations on `Instrument` and `User`. |
| `prisma/migrations/<timestamp>_add_corporate_event_model/migration.sql` | Generated migration. |
| `src/lib/events/types.ts` | `CorporateEventDTO`, `CorporateEventForBuilder`, `NewEventInput` (re-exported from validations for convenience), `ProjectedPosition`, `PreviewResult`, `CreateResult`, `DeleteResult`. |
| `src/lib/events/apply.ts` | Pure function `applyEventsToTrade(trade, events): TradeForHoldings`. Composes events chronologically. `TICKER_CHANGE` is a no-op. Used inside `buildHoldings`. |
| `src/lib/events/validations.ts` | `newEventInputSchema` zod schema and inferred `NewEventInput` type. |
| `src/lib/transactions/holdings.ts` | Extend `buildHoldings` to accept optional `eventsByInstrument?: Map<string, CorporateEventForBuilder[]>`. Inside the per-instrument loop, transform trades via `applyEventsToTrade` before `computePositionFromTrades`. |
| `src/app/actions/events.ts` | The four server actions: `previewCorporateEvent`, `createCorporateEvent`, `listCorporateEvents`, `deleteCorporateEvent`. |
| `src/app/actions/dashboard.ts` | Add events query; build events Map; pass to `buildHoldings`. |
| `src/app/actions/transactions.ts` | Same. |
| `src/app/actions/dividends.ts` | Replace inline `computeHoldings` with a call to `buildHoldings` (uses the shared events-aware path). Add events query; build events Map; pass to `buildHoldings`. Map `HoldingRow[]` to `HoldingForForecast[]`. |
| `src/app/(app)/events/page.tsx` | Server component shell. Calls `listCorporateEvents` and renders `<EventsPage>` with the data. |
| `src/components/events/events-page.tsx` | Client root. Holds header + KPI strip + create button + `<EventsList>`. |
| `src/components/events/events-list.tsx` | Table + empty state. Hosts the per-row trash button that opens `<EventDeleteDialog>`. |
| `src/components/events/event-form-dialog.tsx` | Single Dialog component with internal `step` state, react-hook-form, both panes (form and preview) in the same file. Imports `<EventPreview>` only if extracted; otherwise inline. |
| `src/components/events/event-delete-dialog.tsx` | AlertDialog with generic copy. |
| `src/components/events/format.ts` | Helpers: `formatRatio(n, d)` → `"3:1"`, `formatEventTypeLabel(t)` → Spanish label. |
| `src/components/layout/sidebar.tsx` | Add `{ href: "/events", label: "Eventos", icon: CalendarSync }` between `/dividends` and `/imports`. |

Diff-budget note (see §8): `event-preview.tsx` is folded into `event-form-dialog.tsx` as an internal component to save lines. The file list above shows it as inline.

---

## 8. Diff Size Projection (vs 400-line budget)

| Area | Estimated lines |
|------|-----------------|
| `prisma/schema.prisma` additions (enum + model + 2 inverse relations) | ~25 |
| Generated migration SQL (excluded from logical budget but committed) | ~30 |
| `src/lib/events/types.ts` | ~30 |
| `src/lib/events/apply.ts` | ~35 |
| `src/lib/events/validations.ts` | ~20 |
| `src/lib/transactions/holdings.ts` (signature change + per-trade adjustment hook) | ~25 |
| `src/app/actions/events.ts` (4 actions) | ~140 |
| `src/app/actions/dashboard.ts` (query events + Map + pass) | ~15 |
| `src/app/actions/transactions.ts` (same) | ~15 |
| `src/app/actions/dividends.ts` (remove duplicate + rewire to shared builder + pass events) | ~20 net (`-35` removed + `+55` added; net is what matters for the budget) |
| `src/app/(app)/events/page.tsx` | ~15 |
| `src/components/events/events-page.tsx` | ~50 |
| `src/components/events/events-list.tsx` | ~70 |
| `src/components/events/event-form-dialog.tsx` (form + preview combined) | ~140 |
| `src/components/events/event-delete-dialog.tsx` | ~30 |
| `src/components/events/format.ts` | ~15 |
| `src/components/layout/sidebar.tsx` (one entry) | ~3 |
| **Subtotal (logical)** | **~648** |
| Minus generated migration (excluded from review) | -30 |
| **Net** | **~618** |

**This exceeds the 400-line single-PR budget by ~200 lines.**

### Reductions applied in this design

- `event-preview.tsx` is folded into `event-form-dialog.tsx` (saves ~35 lines).
- `format.ts` kept tiny (no chart helpers needed in this slice).
- Empty state CTA reuses the header button (no second component).

### Further reductions available if the reviewer wants to push under 400

1. Inline `format.ts` into `events-list.tsx` (~15 line save).
2. Inline `event-delete-dialog.tsx` into `events-list.tsx` (~30 line save).
3. Drop KPI strip (~50 line save) — empty state messaging covers the "no events yet" case anyway.
4. Drop the preview pane and ship confirm-only first, deferring preview to a follow-up (~80 line save).

**Recommended posture**: keep design as specified and request `size:exception` on the PR. The feature is cohesive, and splitting it would force schema-without-UI or UI-without-math intermediate states which are worse for reviewers than one well-scoped PR. The proposal already flagged this risk under §9.

---

## 9. Risks and Mitigations (technical-specific)

### R-1: Compositional `Decimal` rounding

- **Risk**: Two events compounded on the same trade — e.g., a 2:1 split, then a 3:1 CEDEAR ratio change — multiply quantity by 6 and divide price by 6. If multiplication order or `decimal.js` precision is mishandled, the resulting `costBasisArs` could drift by cents.
- **Mitigation**: `applyEventsToTrade` does NOT touch `netAmount`. Only `quantity` and `price` are scaled, and they are scaled in opposite directions by the same ratio per event. `costBasisArs` in the builder is derived from `|netAmount|`, which is invariant by construction. Composition order is enforced by the caller pre-sorting events ascending. Worst case is a fractional-share representation in `quantity` (handled by `Decimal(20, 8)`).

### R-2: Next.js 16 Server Action semantics — `revalidatePath` paths

- **Risk**: This codebase is Next.js 16 (not 14/15). Per AGENTS.md, training data may be stale. Patterns in this codebase (see `src/app/actions/imports.ts`) confirm `revalidatePath` from `next/cache` is in use and works with simple path strings.
- **Mitigation**: Follow the exact pattern used by `commitImportAction` — `import { revalidatePath } from "next/cache"; revalidatePath("/path")` after successful writes. Revalidate all four paths (`/events`, `/dashboard`, `/transactions`, `/dividends`) on create and delete because all four read holdings.
- **Open**: if Next.js 16 introduces a tag-based invalidation requirement (`revalidateTag`), the verify phase will catch it via a runtime smoke test. The current observed pattern in the codebase is path-based; no tags are used today.

### R-3: Two-step flow without `useActionState`

- **Risk**: This codebase does NOT use `useActionState` anywhere (grep confirms zero occurrences). The two-step flow is implemented as plain imperative Server Action calls from a client component, with `react-hook-form` for the form half. No risk of v16/v19 API drift because we are not relying on form-state primitives that may have changed.
- **Mitigation**: Keep the EventFormDialog's `onSubmit` an `async` handler that awaits `previewCorporateEvent`. Hold pending state via local `useState`. This is exactly the pattern `imports.ts` is consumed with elsewhere.

### R-4: Concurrent create races

- **Risk**: Two browser tabs submit the same event simultaneously. Both pass validation; both reach `prisma.corporateEvent.create`. One succeeds; the other hits `P2002`.
- **Mitigation**: AD-7. `P2002` is caught and remapped to a user-friendly error. No retry; the UI shows the message and the user can dismiss.

### R-5: Auth check leak on delete

- **Risk**: A user could try to delete an event for an instrument they don't hold by guessing the event ID.
- **Mitigation**: `deleteCorporateEvent` runs an authorization check before delete (see §4.4). Vague error message ("Evento no encontrado.") to avoid existence-leak.

### R-6: `PortfolioSnapshot` staleness

- **Risk**: Adding a retroactive event invalidates historical EOD snapshots. Snapshots are not in the primary read path today but the data is stale.
- **Mitigation**: Documented limitation. Out of scope per Non-Goals §3. No code in this slice consults snapshots, so no immediate user-visible defect.

### R-7: Dividend `computeHoldings` rewire

- **Risk**: The inline `computeHoldings` in `dividends.ts` does NOT use cost-basis or PPP math — it only tracks quantity. Replacing it with `buildHoldings` (which expects price + netAmount fields) is a wider rewire than the other two call sites.
- **Mitigation**: `buildHoldings` already accepts all the fields trades carry from the dividends query (the query already selects `quantity` and `tradeDate`; the rewire adds `price` and `netAmount` to the `select`, which are already on `Transaction`). The output `HoldingRow` is then mapped to `HoldingForForecast` by picking `ticker, instrumentName, instrumentType, quantity`. The `HOLDABLE_TYPES` filter (`STOCK_AR`, `CEDEAR`, `STOCK_US`, `ETF`) is preserved as a query filter — `buildHoldings` does not filter by instrument type itself.

### R-8: Trade `tradeDate` precision

- **Risk**: Existing trades are persisted at midnight UTC; events use a date-only string from the date picker. Mixing `Date` semantics could produce an off-by-one at day boundaries near midnight in non-UTC time zones.
- **Mitigation**: Compare on YYYY-MM-DD lexical equality of the date prefix (`trade.tradeDate.slice(0, 10) < event.effectiveDate.slice(0, 10)`), not on `Date.getTime()`. This avoids time-zone ambiguity entirely. Document this in `applyEventsToTrade` with a code comment.

---

## 10. Open Technical Questions

None that block tasks. All proposal-level open questions are resolved (see proposal §10 and the override list in the design input). The following items remain monitored but do not require a decision before implementation:

1. **Tag-based revalidation in Next.js 16** — the codebase currently uses path-based `revalidatePath`. If `verify` discovers a Next.js 16 requirement to use `revalidateTag`, this will be a small fix in events.ts only.
2. **Snapshot regeneration trigger** — deferred per Non-Goals; no decision needed in this slice.
3. **Whether to enforce `effectiveDate <= today`** — proposal §10 resolved this as "no enforcement, soft UI flag." We do NOT add even the soft flag in this slice (it costs UI lines for marginal value). Easy to add in a follow-up.
