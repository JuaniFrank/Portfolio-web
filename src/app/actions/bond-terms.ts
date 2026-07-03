"use server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RateType, type BondTerms } from "@/lib/generated/prisma";

// ---------------------------------------------------------------------------
// Input validation types
// ---------------------------------------------------------------------------

export type AmortizationEntry = {
  date: string; // ISO date string (YYYY-MM-DD or full ISO)
  principalPct: number;
};

export type BondTermsInput = {
  instrumentId: string;
  faceValue: number;
  currencyCode: string;
  rateType: "FIXED" | "FLOATING";
  couponRate: number;
  couponFrequencyMonths: number;
  issueDate: string; // ISO date string
  maturityDate: string; // ISO date string
  amortizationSchedule: AmortizationEntry[];
  dayCountConvention: string;
};

/**
 * Serializable view of BondTerms for crossing the RSC → Client boundary.
 *
 * Prisma returns `faceValue` and `couponRate` as Decimal and the dates as Date
 * objects; Decimals cannot be passed to Client Components. This DTO exposes
 * Decimals as strings and dates as ISO strings so the whole object is a plain
 * serializable value. The terms form parses the strings back on submit.
 */
export type BondTermsDTO = {
  id: string;
  instrumentId: string;
  faceValue: string;
  currencyCode: string;
  rateType: "FIXED" | "FLOATING";
  couponRate: string;
  couponFrequencyMonths: number;
  issueDate: string;
  maturityDate: string;
  amortizationSchedule: AmortizationEntry[];
  dayCountConvention: string;
  createdAt: string;
  updatedAt: string;
};

function toBondTermsDTO(terms: BondTerms): BondTermsDTO {
  const schedule = Array.isArray(terms.amortizationSchedule)
    ? (terms.amortizationSchedule as unknown as AmortizationEntry[])
    : [];

  return {
    id: terms.id,
    instrumentId: terms.instrumentId,
    faceValue: terms.faceValue.toString(),
    currencyCode: terms.currencyCode,
    rateType: terms.rateType as "FIXED" | "FLOATING",
    couponRate: terms.couponRate.toString(),
    couponFrequencyMonths: terms.couponFrequencyMonths,
    issueDate: terms.issueDate.toISOString(),
    maturityDate: terms.maturityDate.toISOString(),
    amortizationSchedule: schedule,
    dayCountConvention: terms.dayCountConvention,
    createdAt: terms.createdAt.toISOString(),
    updatedAt: terms.updatedAt.toISOString(),
  };
}

export type BondTermsActionResult =
  | { success: true; data: BondTermsDTO }
  | { success: false; error: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBondTermsInput(input: BondTermsInput): string | null {
  if (!input.instrumentId || typeof input.instrumentId !== "string") {
    return "instrumentId is required";
  }
  if (!input.faceValue || input.faceValue <= 0) {
    return "faceValue must be greater than 0";
  }
  if (!input.currencyCode || (input.currencyCode !== "USD" && input.currencyCode !== "ARS")) {
    return "currencyCode must be USD or ARS";
  }
  if (input.rateType !== "FIXED" && input.rateType !== "FLOATING") {
    return "rateType must be FIXED or FLOATING";
  }
  if (input.couponRate === undefined || input.couponRate === null) {
    return "couponRate is required";
  }
  if (input.couponRate < 0) {
    return "couponRate must be >= 0 (use a decimal fraction, e.g. 0.085 for 8.5%)";
  }
  if (input.couponRate > 1) {
    return "couponRate must be a decimal fraction, e.g. 0.085 for 8.5% (received a value > 1 — did you enter a percentage instead of a decimal?)";
  }
  if (!input.couponFrequencyMonths || input.couponFrequencyMonths <= 0) {
    return "couponFrequencyMonths must be greater than 0";
  }
  if (!input.issueDate) {
    return "issueDate is required";
  }
  if (!input.maturityDate) {
    return "maturityDate is required";
  }
  const issueTime = new Date(input.issueDate).getTime();
  const maturityTime = new Date(input.maturityDate).getTime();
  if (isNaN(issueTime)) return "issueDate is not a valid date";
  if (isNaN(maturityTime)) return "maturityDate is not a valid date";
  if (maturityTime <= issueTime) {
    return "maturityDate must be after issueDate";
  }
  if (!Array.isArray(input.amortizationSchedule) || input.amortizationSchedule.length === 0) {
    return "amortizationSchedule must be a non-empty array";
  }
  // Validate each entry
  for (const entry of input.amortizationSchedule) {
    if (typeof entry.date !== "string" || !entry.date) {
      return "Each amortizationSchedule entry must have a valid date string";
    }
    if (typeof entry.principalPct !== "number" || entry.principalPct <= 0) {
      return "Each amortizationSchedule entry must have a positive principalPct";
    }
  }
  // Validate sum
  const totalPct = input.amortizationSchedule.reduce((sum, e) => sum + e.principalPct, 0);
  if (Math.abs(totalPct - 100) > 0.01) {
    return `amortizationSchedule principalPct values must sum to 100 (got ${totalPct.toFixed(2)})`;
  }
  if (!input.dayCountConvention || typeof input.dayCountConvention !== "string") {
    return "dayCountConvention is required";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

/**
 * Create or update BondTerms for a given instrument.
 *
 * Requires authentication. The instrument must belong to a holding
 * accessible by the authenticated user (instrument existence check).
 *
 * Uses upsert: if BondTerms already exist for the instrument, they are replaced.
 */
export async function upsertBondTermsAction(
  input: BondTermsInput
): Promise<BondTermsActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "unauthorized" };

  const validationError = validateBondTermsInput(input);
  if (validationError) return { success: false, error: validationError };

  // Verify the instrument exists (basic ownership check via portfolio→user)
  const instrument = await prisma.instrument.findFirst({
    where: {
      id: input.instrumentId,
      transactions: {
        some: { portfolio: { userId: user.id } },
      },
    },
    select: { id: true },
  });

  if (!instrument) {
    return {
      success: false,
      error: "Instrument not found or does not belong to your portfolio",
    };
  }

  const data = await prisma.bondTerms.upsert({
    where: { instrumentId: input.instrumentId },
    create: {
      instrumentId: input.instrumentId,
      faceValue: input.faceValue,
      currencyCode: input.currencyCode,
      rateType: input.rateType as RateType,
      couponRate: input.couponRate,
      couponFrequencyMonths: input.couponFrequencyMonths,
      issueDate: new Date(input.issueDate),
      maturityDate: new Date(input.maturityDate),
      amortizationSchedule: input.amortizationSchedule,
      dayCountConvention: input.dayCountConvention,
    },
    update: {
      faceValue: input.faceValue,
      currencyCode: input.currencyCode,
      rateType: input.rateType as RateType,
      couponRate: input.couponRate,
      couponFrequencyMonths: input.couponFrequencyMonths,
      issueDate: new Date(input.issueDate),
      maturityDate: new Date(input.maturityDate),
      amortizationSchedule: input.amortizationSchedule,
      dayCountConvention: input.dayCountConvention,
    },
  });

  return { success: true, data: toBondTermsDTO(data) };
}

/**
 * Retrieve BondTerms for an instrument.
 *
 * Returns null when no terms have been entered yet (not an error — the UI
 * should show a "no terms entered" empty state).
 */
export async function getBondTermsAction(
  instrumentId: string
): Promise<{ success: true; data: BondTermsDTO | null } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "unauthorized" };

  const terms = await prisma.bondTerms.findUnique({
    where: { instrumentId },
  });

  return { success: true, data: terms ? toBondTermsDTO(terms) : null };
}
