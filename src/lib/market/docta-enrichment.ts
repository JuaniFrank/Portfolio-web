/**
 * Docta enrichment orchestrator for ON/BOND_AR/LETRA instruments referenced
 * by a user transaction (T-47/T-48/T-49). Prisma orchestrator — untested by
 * convention; every decision it delegates to is a pure, tested module
 * (`docta-mapping.ts`).
 *
 * Wiring, per design §8.4:
 *   docta instruments  → Instrument metadata, through EnrichmentPatch (AD-0)
 *   docta cashflow      → mapDoctaSchedule() → UPSERT BondSchedule (ALWAYS, primary, AD-14)
 *                       → mapDoctaCashflow() → BondTerms parity path (gated, AD-7)
 *                            row absent + gate passes → CREATE (auto-fill)
 *                            row absent + gate fails   → ScrapedBondData → propose
 *                            row present                → ScrapedBondData → propose, NEVER overwrite
 */

import { prisma } from "@/lib/prisma";
import { InstrumentType, Prisma } from "@/lib/generated/prisma";
import type { EnrichmentPatch } from "./yahoo-catalog";
import { fetchDoctaInstrument, fetchDoctaCashflow, isDoctaEnabled } from "./docta-client";
import { mapDoctaInstrument, mapDoctaCashflow, mapDoctaSchedule } from "./docta-mapping";
import type { ScrapedBondProposal } from "@/lib/bonds/argen-bond-scraper";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { ENRICH_CONCURRENCY, ENRICH_BUDGET_MS } from "./yahoo-catalog";

const FIXED_INCOME_TYPES: InstrumentType[] = [
  InstrumentType.ON,
  InstrumentType.BOND_AR,
  InstrumentType.LETRA,
];

function toProposal(
  cashflowRows: Array<{ payment_date: string; interest_rate: number; capital: number }>,
  gated: ReturnType<typeof mapDoctaCashflow>
): ScrapedBondProposal {
  const cashflowSchedule = cashflowRows.map((r) => ({
    date: r.payment_date,
    interestPct: r.interest_rate,
    principalPct: r.capital,
  }));

  if (gated.ok) {
    const t = gated.terms;
    return {
      faceValue: 100,
      currencyCode: t.currencyCode,
      rateType: t.rateType,
      couponRate: Number(t.couponRate),
      couponFrequencyMonths: t.couponFrequencyMonths,
      issueDate: t.issueDate,
      maturityDate: t.maturityDate,
      amortizationSchedule: t.amortizationSchedule,
      cashflowSchedule,
      dayCountConvention: null,
    };
  }

  return {
    faceValue: null,
    currencyCode: null,
    rateType: null,
    couponRate: null,
    couponFrequencyMonths: null,
    issueDate: null,
    maturityDate: null,
    amortizationSchedule: [],
    cashflowSchedule,
    dayCountConvention: null,
  };
}

/**
 * Best-effort Docta enrichment for one instrument. Never throws — every
 * failure is caught and logged, matching FR-13 (a Docta failure must never
 * fail the caller's commit/sync).
 */
async function enrichOne(instrument: { id: string; ticker: string; baseInstrumentId: string | null }): Promise<void> {
  try {
    const metadataResult = await fetchDoctaInstrument(instrument.ticker);
    // "rate-limited"/"error"/"not-found" all mean no metadata to write this
    // pass — a rate-limited or transport error may resolve on a later run
    // (never cached); a confirmed 404 is permanent (cached) and simply has
    // nothing to enrich, ever.
    if (metadataResult.kind === "ok") {
      const metadata = metadataResult.data;
      const mapped = mapDoctaInstrument(metadata);
      // AD-3: a settlement variant does not store its own sector/industry —
      // resolve to the base first.
      const targetId = instrument.baseInstrumentId ?? instrument.id;
      const patch: EnrichmentPatch = {
        name: mapped.name,
        isin: mapped.isin ?? undefined,
        sector: mapped.sector ?? undefined,
        issuer: mapped.issuer ?? undefined,
        law: mapped.law ?? undefined,
        assetClass: mapped.assetClass ?? undefined,
      };
      const data: EnrichmentPatch = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined)
      );
      if (Object.keys(data).length > 0) {
        await prisma.instrument.update({ where: { id: targetId }, data });
      }
    }
  } catch (error) {
    console.warn(`[docta-enrichment] metadata failed for ${instrument.ticker}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const cashflowResult = await fetchDoctaCashflow(instrument.ticker);
    if (cashflowResult.kind !== "ok") return;
    const cashflow = cashflowResult.data;

    // AD-14 primary path — always attempted when cashflow data is available.
    const scheduleRows = mapDoctaSchedule(cashflow);
    await prisma.bondSchedule.upsert({
      where: { instrumentId: instrument.id },
      create: {
        instrumentId: instrument.id,
        source: "docta",
        rows: scheduleRows as unknown as Prisma.InputJsonValue,
      },
      update: {
        rows: scheduleRows as unknown as Prisma.InputJsonValue,
        fetchedAt: new Date(),
      },
    });

    // BondTerms parity path (gated, AD-7).
    const existingTerms = await prisma.bondTerms.findUnique({ where: { instrumentId: instrument.id } });
    const instrumentRow = await prisma.instrument.findUnique({
      where: { id: instrument.id },
      select: { name: true },
    });
    const gated = mapDoctaCashflow(cashflow, instrumentRow?.name ?? instrument.ticker);

    if (!existingTerms && gated.ok) {
      await prisma.bondTerms.create({
        data: {
          instrumentId: instrument.id,
          faceValue: new Prisma.Decimal(100),
          currencyCode: gated.terms.currencyCode,
          rateType: gated.terms.rateType,
          couponRate: new Prisma.Decimal(gated.terms.couponRate),
          couponFrequencyMonths: gated.terms.couponFrequencyMonths,
          issueDate: new Date(gated.terms.issueDate),
          maturityDate: new Date(gated.terms.maturityDate),
          amortizationSchedule: gated.terms.amortizationSchedule as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      // Either no row + gate failed, or a row already exists — propose,
      // never overwrite (AD-7).
      const proposal = toProposal(cashflow.data, gated);
      await prisma.scrapedBondData.upsert({
        where: { ticker: instrument.ticker },
        create: {
          ticker: instrument.ticker,
          sourceUrl: `docta:/bonds/analytics/${instrument.ticker}/cashflow`,
          payload: proposal as unknown as Prisma.InputJsonValue,
        },
        update: { payload: proposal as unknown as Prisma.InputJsonValue },
      });
    }
  } catch (error) {
    console.warn(`[docta-enrichment] cashflow failed for ${instrument.ticker}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Enriches every ON/BOND_AR/LETRA instrument referenced by at least one
 * transaction. No-ops entirely when Docta is disabled (AD-8).
 */
export async function enrichDoctaHeldInstruments(instrumentIds: string[]): Promise<void> {
  if (!isDoctaEnabled()) return;
  const ids = [...new Set(instrumentIds)];
  if (ids.length === 0) return;

  const instruments = await prisma.instrument.findMany({
    where: { id: { in: ids }, type: { in: FIXED_INCOME_TYPES } },
    select: { id: true, ticker: true, baseInstrumentId: true },
  });
  if (instruments.length === 0) return;

  // Same cap and budget as the Yahoo enrichment fan-out (design §9.2) —
  // Docta has no batch endpoint, so this is per-instrument either way.
  await mapWithConcurrency(instruments, ENRICH_CONCURRENCY, (inst) => enrichOne(inst), {
    budgetMs: ENRICH_BUDGET_MS,
  });
}
