import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { CorporateEventDTO } from "@/lib/events/types";

// ---------------------------------------------------------------------------
// loadPortfolioInstruments — instruments held by the user's portfolio
// Used to populate the instrument picker in the create form.
// ---------------------------------------------------------------------------

export async function loadPortfolioInstruments(): Promise<
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
// loadCorporateEvents (T-10)
// ---------------------------------------------------------------------------

export async function loadCorporateEvents(): Promise<
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
