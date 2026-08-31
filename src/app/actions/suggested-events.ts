"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { SuggestedCorporateEventDTO } from "@/lib/events/types";

// ---------------------------------------------------------------------------
// listSuggestedCorporateEvents
//
// Las sugerencias son globales (las genera el cron para todos los usuarios que
// tengan el instrumento en cartera), pero `dismissed` refleja la preferencia
// del usuario que pide la lista, no un estado compartido. Una sugerencia que ya
// tiene un `CorporateEvent` real aplicado (por cualquier usuario) no vuelve.
// ---------------------------------------------------------------------------

export async function listSuggestedCorporateEvents(): Promise<
  SuggestedCorporateEventDTO[] | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const suggestions = await prisma.suggestedCorporateEvent.findMany({
    where: {
      instrument: {
        transactions: { some: { portfolio: { userId: user.id } } },
      },
    },
    orderBy: { effectiveDate: "desc" },
    select: {
      id: true,
      instrumentId: true,
      instrument: { select: { ticker: true, name: true } },
      eventType: true,
      effectiveDate: true,
      numerator: true,
      denominator: true,
      source: true,
      dismissals: { where: { userId: user.id }, select: { id: true } },
    },
  });

  if (suggestions.length === 0) return [];

  const applied = await prisma.corporateEvent.findMany({
    where: { instrumentId: { in: suggestions.map((s) => s.instrumentId) } },
    select: { instrumentId: true, effectiveDate: true, eventType: true },
  });
  const appliedKeys = new Set(
    applied.map((e) => `${e.instrumentId}|${e.effectiveDate.toISOString().slice(0, 10)}|${e.eventType}`)
  );

  return suggestions
    .filter(
      (s) =>
        !appliedKeys.has(`${s.instrumentId}|${s.effectiveDate.toISOString().slice(0, 10)}|${s.eventType}`)
    )
    .map((s) => ({
      id: s.id,
      instrumentId: s.instrumentId,
      ticker: s.instrument.ticker,
      instrumentName: s.instrument.name,
      eventType: s.eventType,
      effectiveDate: s.effectiveDate.toISOString().slice(0, 10),
      numerator: s.numerator.toString(),
      denominator: s.denominator.toString(),
      source: s.source,
      dismissed: s.dismissals.length > 0,
    }));
}

// ---------------------------------------------------------------------------
// dismissSuggestedCorporateEvent / undismissSuggestedCorporateEvent
//
// Solo afectan al usuario que las llama: descartar una sugerencia no la oculta
// para los demás usuarios que tengan el mismo instrumento.
// ---------------------------------------------------------------------------

async function assertVisibleSuggestion(userId: string, id: string): Promise<boolean> {
  const suggestion = await prisma.suggestedCorporateEvent.findFirst({
    where: {
      id,
      instrument: { transactions: { some: { portfolio: { userId } } } },
    },
    select: { id: true },
  });
  return suggestion !== null;
}

export async function dismissSuggestedCorporateEvent(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  if (!(await assertVisibleSuggestion(user.id, id))) {
    return { ok: false, error: "Sugerencia no encontrada" };
  }

  await prisma.suggestedCorporateEventDismissal.upsert({
    where: { suggestedEventId_userId: { suggestedEventId: id, userId: user.id } },
    create: { suggestedEventId: id, userId: user.id },
    update: {},
  });

  revalidatePath("/events");
  return { ok: true };
}

export async function undismissSuggestedCorporateEvent(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  if (!(await assertVisibleSuggestion(user.id, id))) {
    return { ok: false, error: "Sugerencia no encontrada" };
  }

  await prisma.suggestedCorporateEventDismissal.deleteMany({
    where: { suggestedEventId: id, userId: user.id },
  });

  revalidatePath("/events");
  return { ok: true };
}
