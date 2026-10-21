"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
