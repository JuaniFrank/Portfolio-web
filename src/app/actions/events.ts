"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { newEventInputSchema, type NewEventInput } from "@/lib/events/validations";
import type { CorporateEventDTO, CorporateEventForBuilder, ProjectedPosition } from "@/lib/events/types";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";
import { HOLDABLE_TRADE_TYPES } from "@/lib/events/constants";
import type { InstrumentType } from "@/lib/generated/prisma";

// ---------------------------------------------------------------------------
// listPortfolioInstruments — instruments held by the user's portfolio
// Used to populate the instrument picker in the create form.
// ---------------------------------------------------------------------------

export async function listPortfolioInstruments(): Promise<
  Array<{ id: string; ticker: string; name: string }> | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const instruments = await prisma.instrument.findMany({
    where: {
      transactions: { some: { portfolio: { userId: user.id } } },
    },
    select: { id: true, ticker: true, name: true },
    orderBy: { ticker: "asc" },
    distinct: ["id"],
  });

  return instruments;
}

// ---------------------------------------------------------------------------
// listCorporateEvents (T-10)
// ---------------------------------------------------------------------------

export async function listCorporateEvents(): Promise<
  CorporateEventDTO[] | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const events = await prisma.corporateEvent.findMany({
    where: {
      instrument: {
        transactions: { some: { portfolio: { userId: user.id } } },
      },
    },
    orderBy: { effectiveDate: "desc" },
    select: {
      id: true,
      instrumentId: true,
      instrument: { select: { ticker: true } },
      eventType: true,
      effectiveDate: true,
      numerator: true,
      denominator: true,
      notes: true,
      appliedAt: true,
    },
  });

  return events.map((e) => ({
    id: e.id,
    instrumentId: e.instrumentId,
    ticker: e.instrument.ticker,
    eventType: e.eventType,
    effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
    numerator: e.numerator.toString(),
    denominator: e.denominator.toString(),
    notes: e.notes,
    appliedAt: e.appliedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// previewCorporateEvent (T-11)
// Pure compute — no DB write. Runs buildHoldings with and without the virtual event.
// ---------------------------------------------------------------------------

export async function previewCorporateEvent(input: NewEventInput): Promise<
  | { ok: true; current: ProjectedPosition | null; projected: ProjectedPosition }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = newEventInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const data = parsed.data;

  // Verify the instrument belongs to the user's portfolio
  const instrument = await prisma.instrument.findFirst({
    where: {
      id: data.instrumentId,
      transactions: { some: { portfolio: { userId: user.id } } },
    },
    select: { id: true, ticker: true, type: true, name: true },
  });

  if (!instrument) {
    return { ok: false, error: "Instrumento no encontrado en tu cartera" };
  }

  // Fetch trades for this instrument
  const tradeRows = await prisma.transaction.findMany({
    where: {
      portfolio: { userId: user.id },
      instrumentId: data.instrumentId,
      type: { in: HOLDABLE_TRADE_TYPES },
    },
    orderBy: { tradeDate: "asc" },
    select: {
      type: true,
      quantity: true,
      price: true,
      netAmount: true,
      tradeDate: true,
    },
  });

  const trades: TradeForHoldings[] = tradeRows.map((r) => ({
    instrumentId: instrument.id,
    ticker: instrument.ticker,
    instrumentType: instrument.type as InstrumentType,
    instrumentName: instrument.name,
    type: r.type as "BUY" | "SELL",
    quantity: r.quantity.toString(),
    price: r.price.toString(),
    netAmount: r.netAmount.toString(),
    tradeDate: r.tradeDate.toISOString(),
  }));

  // Fetch existing events for this instrument
  const existingEventRows = await prisma.corporateEvent.findMany({
    where: { instrumentId: data.instrumentId },
    orderBy: { effectiveDate: "asc" },
    select: {
      instrumentId: true,
      eventType: true,
      effectiveDate: true,
      numerator: true,
      denominator: true,
    },
  });

  const existingEvents: CorporateEventForBuilder[] = existingEventRows.map((e) => ({
    instrumentId: e.instrumentId,
    eventType: e.eventType,
    effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
    numerator: e.numerator.toString(),
    denominator: e.denominator.toString(),
  }));

  const emptyPrices = new Map<string, string>();

  // Current: holdings without the new event
  const currentEventsMap = new Map<string, CorporateEventForBuilder[]>();
  if (existingEvents.length > 0) {
    currentEventsMap.set(data.instrumentId, existingEvents);
  }
  const currentHoldings = buildHoldings(trades, emptyPrices, currentEventsMap);
  const currentRow = currentHoldings.find((h) => h.instrumentId === data.instrumentId) ?? null;

  // Projected: holdings with the new event merged in (sorted ascending)
  const newEvent: CorporateEventForBuilder = {
    instrumentId: data.instrumentId,
    eventType: data.eventType,
    effectiveDate: data.effectiveDate,
    numerator: data.numerator,
    denominator: data.denominator,
  };
  const mergedEvents = [...existingEvents, newEvent].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate)
  );
  const projectedEventsMap = new Map<string, CorporateEventForBuilder[]>([
    [data.instrumentId, mergedEvents],
  ]);
  const projectedHoldings = buildHoldings(trades, emptyPrices, projectedEventsMap);
  const projectedRow = projectedHoldings.find((h) => h.instrumentId === data.instrumentId);

  if (!projectedRow) {
    return { ok: false, error: "No se pudo calcular la proyección. Verificá las operaciones." };
  }

  const toPosition = (row: typeof projectedRow): ProjectedPosition => ({
    instrumentId: row.instrumentId,
    ticker: row.ticker,
    quantity: row.quantity,
    avgPriceArs: row.avgPriceArs,
    costBasisArs: row.costBasisArs,
  });

  return {
    ok: true,
    current: currentRow ? toPosition(currentRow) : null,
    projected: toPosition(projectedRow),
  };
}

// ---------------------------------------------------------------------------
// createCorporateEvent (T-12)
// Re-validates input, persists, catches P2002, revalidates 4 paths.
// ---------------------------------------------------------------------------

export async function createCorporateEvent(input: NewEventInput): Promise<
  { ok: true; event: CorporateEventDTO } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = newEventInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const data = parsed.data;

  // Verify ownership
  const instrument = await prisma.instrument.findFirst({
    where: {
      id: data.instrumentId,
      transactions: { some: { portfolio: { userId: user.id } } },
    },
    select: { id: true, ticker: true },
  });

  if (!instrument) {
    return { ok: false, error: "Instrumento no encontrado en tu cartera" };
  }

  try {
    const created = await prisma.corporateEvent.create({
      data: {
        instrumentId: data.instrumentId,
        eventType: data.eventType,
        effectiveDate: new Date(data.effectiveDate),
        numerator: data.numerator,
        denominator: data.denominator,
        notes: data.notes ?? null,
        createdByUserId: user.id,
      },
      select: {
        id: true,
        instrumentId: true,
        instrument: { select: { ticker: true } },
        eventType: true,
        effectiveDate: true,
        numerator: true,
        denominator: true,
        notes: true,
        appliedAt: true,
      },
    });

    revalidatePath("/events");
    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath("/dividends");

    return {
      ok: true,
      event: {
        id: created.id,
        instrumentId: created.instrumentId,
        ticker: created.instrument.ticker,
        eventType: created.eventType,
        effectiveDate: created.effectiveDate.toISOString().slice(0, 10),
        numerator: created.numerator.toString(),
        denominator: created.denominator.toString(),
        notes: created.notes,
        appliedAt: created.appliedAt.toISOString(),
      },
    };
  } catch (err) {
    // Prisma P2002 = unique constraint violation
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: "Ya existe un evento de este tipo para el instrumento en esa fecha.",
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// deleteCorporateEvent (T-13)
// Auth + authz + hard delete + revalidate 4 paths.
// Vague error to avoid existence leak.
// ---------------------------------------------------------------------------

export async function deleteCorporateEvent(id: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  // Verify the event exists and belongs to the authenticated user
  const event = await prisma.corporateEvent.findFirst({
    where: {
      id,
      createdByUserId: user.id,
    },
    select: { id: true },
  });

  if (!event) {
    return { ok: false, error: "Evento no encontrado." };
  }

  await prisma.corporateEvent.delete({ where: { id } });

  revalidatePath("/events");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/dividends");

  return { ok: true };
}
