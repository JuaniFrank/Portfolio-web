/**
 * Docta response mapping (design §8.2-§8.3b, AD-14). Pure — no Prisma, no
 * fetch. Fixture-tested against `__fixtures__/docta/`.
 */

export type DoctaInstrumentResponse = {
  data: Array<{
    ticker: string;
    name: string;
    asset_class?: string;
    sub_asset_class?: string;
    sector?: string;
    issuer?: string;
    law?: string;
    isin?: string | null;
  }>;
};

export type DoctaInstrumentMetadata = {
  ticker: string;
  /** Mojibake-repaired (§8.2). */
  name: string;
  isin: string | null;
  sector: string | null;
  issuer: string | null;
  law: string | null;
  assetClass: string | null;
};

export type DoctaCashflowRow = {
  issue_date: string;
  payment_date: string;
  capital: number;
  interest_rate: number;
  interest_amount: number;
  residual_value: number;
  cash_flow: number;
};

export type DoctaCashflowResponse = {
  ticker: string;
  data: DoctaCashflowRow[];
};

/**
 * BondSchedule row input (AD-14) — copied verbatim, no derivation. See
 * `mapDoctaSchedule` (T-27).
 */
export type BondScheduleRowInput = {
  paymentDate: string;
  capital: number;
  interestRate: number;
  interestAmount: number;
  residualValue: number;
  cashFlow: number;
};

/**
 * `BondTerms` create input, gated by the §8.3b all-or-nothing rule.
 * `dayCountConvention` is intentionally absent — the schema default
 * (`ACT/365`) applies untouched.
 */
export type BondTermsInput = {
  faceValue: "100";
  currencyCode: "USD";
  rateType: "FIXED" | "FLOATING";
  couponRate: string;
  couponFrequencyMonths: number;
  issueDate: string;
  maturityDate: string;
  amortizationSchedule: Array<{ date: string; principalPct: number }>;
};

export type DoctaCashflowMappingResult =
  | { ok: true; terms: BondTermsInput }
  | { ok: false; reason: string };

// --- §8.2 mojibake repair -----------------------------------------------

/**
 * Evidence-only repair table, seeded from the captured fixture. The source
 * has been case-folded upstream (`ã­`, not `Ã­`), so a generic Latin-1
 * round-trip cannot recover it — only the exact corrupted sequences Docta is
 * known to emit are repaired. Title-case normalization is NOT attempted:
 * casing damage is upstream and unrecoverable; only the byte-level mojibake
 * is repaired. Extending this table requires a new captured fixture proving
 * a new sequence — guessing beyond captured evidence is out of scope.
 */
const MOJIBAKE_TABLE: Array<[string, string]> = [
  ["ã­", "í"], // ã­ -> í
  ["ã¡", "á"], // ã¡ -> á
  ["ã©", "é"], // ã© -> é
  ["ã³", "ó"], // ã³ -> ó
  ["ãº", "ú"], // ãº -> ú
  ["ã±", "ñ"], // ã± -> ñ
];

function repairMojibake(raw: string): string {
  let result = raw;
  for (const [bad, good] of MOJIBAKE_TABLE) {
    result = result.split(bad).join(good);
  }
  return result;
}

export function mapDoctaInstrument(response: DoctaInstrumentResponse): DoctaInstrumentMetadata {
  const row = response.data[0];
  if (!row) {
    throw new Error("mapDoctaInstrument: empty Docta instrument response");
  }
  return {
    ticker: row.ticker,
    name: repairMojibake(row.name),
    isin: row.isin ?? null,
    sector: row.sector ?? null,
    issuer: row.issuer ? repairMojibake(row.issuer) : null,
    law: row.law ?? null,
    assetClass: row.asset_class ?? null,
  };
}

// --- §8.3 / §8.3b cashflow -> BondTerms (gated) -------------------------

/** `U$S`, `US$`, `USD`, `Dólar`/`Dolar` ⇒ USD. A bare `$` is never a match —
 * ambiguous in Argentine usage, and `Instrument.currencyCode` is a different
 * concept (the row's settlement currency, not the bond's denomination). */
const CURRENCY_TOKENS = ["U$S", "US$", "USD", "DóLAR", "DOLAR"];

function resolveCurrencyToken(name: string): "USD" | null {
  const upper = name.toUpperCase();
  return CURRENCY_TOKENS.some((token) => upper.includes(token)) ? "USD" : null;
}

const FLOATING_MARKERS = ["BADLAR", "TAMAR", "CER", "UVA", "VARIABLE"];

function hasFloatingMarker(name: string): boolean {
  const upper = name.toUpperCase();
  return FLOATING_MARKERS.some((marker) => upper.includes(marker));
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/** Modal (most frequent) month-gap between consecutive payment dates — not
 * the first gap, so an irregular first period does not skew it. */
function modalCouponFrequencyMonths(paymentDates: string[]): number | null {
  if (paymentDates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < paymentDates.length; i++) {
    gaps.push(monthsBetween(new Date(paymentDates[i - 1]!), new Date(paymentDates[i]!)));
  }
  const counts = new Map<number, number>();
  for (const gap of gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  let modal: number | null = null;
  let bestCount = 0;
  for (const [gap, count] of counts) {
    if (count > bestCount) {
      modal = gap;
      bestCount = count;
    }
  }
  return modal;
}

/**
 * AD-14 primary path: copies Docta's per-period schedule verbatim, with no
 * derivation of any kind — including a stepped `interestRate` sequence,
 * which is preserved exactly, not summarized into one value. This is what
 * makes a step-up bond (e.g. AL30) representable at all: `BondTerms` cannot
 * hold more than one rate, but a `BondSchedule` row can hold nineteen.
 */
export function mapDoctaSchedule(cashflow: DoctaCashflowResponse): BondScheduleRowInput[] {
  return cashflow.data.map((row) => ({
    paymentDate: row.payment_date,
    capital: row.capital,
    interestRate: row.interest_rate,
    interestAmount: row.interest_amount,
    residualValue: row.residual_value,
    cashFlow: row.cash_flow,
  }));
}

/**
 * Maps Docta's cashflow response to a gated `BondTerms` input. Returns
 * `{ ok: false }` — never a partial/guessed row — whenever any required
 * field is not evidenced (AD-7 part 2, §8.3b). A step-up bond (non-constant
 * `interest_rate`) is a routing outcome, not a degradation: it belongs on
 * the `BondSchedule` stored-schedule path (AD-14) instead.
 */
export function mapDoctaCashflow(
  cashflow: DoctaCashflowResponse,
  instrumentName: string
): DoctaCashflowMappingResult {
  const rows = cashflow.data;
  if (rows.length === 0) {
    return { ok: false, reason: "empty cashflow" };
  }

  const rates = new Set(rows.map((r) => r.interest_rate));
  if (rates.size !== 1) {
    return { ok: false, reason: "interest_rate varies across periods (step-up) — routes to BondSchedule" };
  }
  const rate = rows[0]!.interest_rate;

  const couponRate = rate / 100;
  if (!(couponRate > 0 && couponRate <= 1)) {
    return { ok: false, reason: "couponRate out of (0,1] range" };
  }

  const currencyCode = resolveCurrencyToken(instrumentName);
  if (currencyCode === null) {
    return { ok: false, reason: "no recognized currency token in instrument name" };
  }

  const amortizationSchedule = rows
    .filter((r) => r.capital > 0)
    .map((r) => ({ date: r.payment_date, principalPct: r.capital }));
  const amortizationSum = amortizationSchedule.reduce((acc, r) => acc + r.principalPct, 0);
  if (Math.abs(amortizationSum - 100) > 0.01) {
    return { ok: false, reason: "amortizationSchedule does not sum to 100" };
  }

  const paymentDates = rows.map((r) => r.payment_date);
  const couponFrequencyMonths = modalCouponFrequencyMonths(paymentDates);
  if (couponFrequencyMonths === null || couponFrequencyMonths <= 0) {
    return { ok: false, reason: "could not resolve a positive couponFrequencyMonths" };
  }

  const issueDate = rows[0]!.issue_date;
  const maturityDate = paymentDates[paymentDates.length - 1]!;
  if (!(new Date(issueDate).getTime() < new Date(maturityDate).getTime())) {
    return { ok: false, reason: "issueDate does not precede maturityDate" };
  }

  return {
    ok: true,
    terms: {
      faceValue: "100",
      currencyCode,
      rateType: hasFloatingMarker(instrumentName) ? "FLOATING" : "FIXED",
      couponRate: String(couponRate),
      couponFrequencyMonths,
      issueDate,
      maturityDate,
      amortizationSchedule,
    },
  };
}
