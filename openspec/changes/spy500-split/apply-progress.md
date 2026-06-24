# Apply Progress — spy500-split
**Status**: DONE — all 21 tasks complete
**Date**: 2026-06-09

## Tasks Completed

### C1 — Schema + Migration
- [x] T-1: `prisma/schema.prisma` — `CorporateEventType` enum + `CorporateEvent` model added. Inverse relations on `Instrument.corporateEvents` and `User.corporateEventsCreated`.
- [x] T-2: `prisma/migrations/20260609221545_add_corporate_event_model/migration.sql` — generated and applied. Note: baseline migration `0_init` created first (DB was previously managed via `db:push`).

### C2 — Pure Event-Apply Library
- [x] T-3: `src/lib/events/types.ts` — `CorporateEventForBuilder`, `CorporateEventDTO`, `ProjectedPosition`, `EventActionResult<T>`
- [x] T-4: `src/lib/events/validations.ts` — `newEventInputSchema` (zod) + `NewEventInput`
- [x] T-5: `src/lib/events/apply.ts` — pure `applyEventsToTrade(trade, events): TradeForHoldings`

### C3 — buildHoldings Events-Aware
- [x] T-6: `src/lib/transactions/holdings.ts` — added optional 3rd param `events?: Map<string, CorporateEventForBuilder[]>`; backwards compatible

### C4 — Three Call-Site Rewires
- [x] T-7: `src/app/actions/dashboard.ts` — queries `corporateEvent`, builds eventsMap, passes to `buildHoldings`
- [x] T-8: `src/app/actions/transactions.ts` — same pattern
- [x] T-9: `src/app/actions/dividends.ts` — removed inline `computeHoldings`; rewired to `buildHoldings` with eventsMap

### C5 — Server Actions
- [x] T-10: `src/app/actions/events.ts` — `listCorporateEvents`
- [x] T-11: `src/app/actions/events.ts` — `previewCorporateEvent` (pure compute, no DB write)
- [x] T-12: `src/app/actions/events.ts` — `createCorporateEvent` (P2002 caught → Spanish error, `revalidatePath` ×4)
- [x] T-13: `src/app/actions/events.ts` — `deleteCorporateEvent` (vague error, `revalidatePath` ×4)

Extra action added (not in original task list, needed by T-19):
- `listPortfolioInstruments` — scoped instrument list for the form picker

### C6 — UI Components
- [x] T-14: `src/components/events/format.ts` — `formatRatio`, `formatEventTypeLabel`
- [x] T-15: `src/components/events/event-delete-dialog.tsx` — Radix Dialog confirmation (no AlertDialog pkg installed)
- [x] T-16: `src/components/events/events-list.tsx` — table + delete integration
- [x] T-17: `src/components/events/event-form-dialog.tsx` — two-step form→preview Dialog
- [x] T-18: `src/components/events/events-page.tsx` — client root, KPIs, CTA, state management
- [x] T-19: `src/app/(app)/events/page.tsx` — server component shell, auth guard via `redirect("/login")`

### C7 — Sidebar + Final Quality Gates
- [x] T-20: `src/components/layout/sidebar.tsx` — `/events` entry with `CalendarSync` icon between `/dividends` and `/imports`
- [x] T-21: Quality gates:
  - `pnpm tsc --noEmit`: 0 errors
  - ESLint on all new/changed files: 0 errors, 0 warnings
  - `pnpm db:generate`: success

## Additional Files Created
- `src/lib/events/constants.ts` — `HOLDABLE_TRADE_TYPES`
- `prisma/migrations/0_init/migration.sql` — baseline migration

## Deviations from Design
1. **No AlertDialog package** — `@radix-ui/react-alert-dialog` is not installed. Used existing `Dialog` (Radix Dialog.Root) for delete confirmation. Same UX contract, same Spanish copy.
2. **`listPortfolioInstruments` action** — not in original task list but required for the instrument picker. Added inline in `events.ts`.
3. **Optimistic delete** — local state removal via `filter(e => e.id !== deletedId)` rather than page reload. Server `revalidatePath` still fires.
4. **Baseline migration** — `0_init` created because DB was managed via `db:push` (no prior migrations). This is a prerequisite step, not a design change.

## Pre-existing Lint Issues (NOT introduced by this change)
- `src/components/imports/import-modal.tsx`: `react-hooks/set-state-in-effect` error
- `src/lib/dividends/forecast.ts`: `prefer-const` error
