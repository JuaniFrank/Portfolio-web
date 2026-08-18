import * as cheerio from "cheerio";

export type ScrapedBondProposal = {
  faceValue: number | null;
  currencyCode: string | null;
  rateType: "FIXED" | "FLOATING" | null;
  couponRate: number | null;
  couponFrequencyMonths: number | null;
  issueDate: string | null;
  maturityDate: string | null;
  amortizationSchedule: { date: string; principalPct: number }[];
  dayCountConvention: string | null;
};

const EMPTY_PROPOSAL: ScrapedBondProposal = {
  faceValue: null,
  currencyCode: null,
  rateType: null,
  couponRate: null,
  couponFrequencyMonths: null,
  issueDate: null,
  maturityDate: null,
  amortizationSchedule: [],
  dayCountConvention: null,
};

const FREQUENCY_LABELS: { label: string; months: number }[] = [
  { label: "Mensual", months: 1 },
  { label: "Bimestral", months: 2 },
  { label: "Trimestral", months: 3 },
  { label: "Semestral", months: 6 },
  { label: "Anual", months: 12 },
];

function parseArgDate(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function parsePercent(text: string | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace("%", "").trim().replace(",", ".");
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function buildSummaryMap($: cheerio.CheerioAPI): Map<string, string> {
  const summary = new Map<string, string>();
  $("dt").each((_, el) => {
    const dt = $(el);
    const label = dt.text().trim();
    const dd = dt.next("dd");
    if (label && dd.length > 0) {
      summary.set(label, dd.text().trim());
    }
  });
  return summary;
}

function resolveCurrencyCode(moneda: string | undefined): string | null {
  if (!moneda) return null;
  if (/d[oó]lar/i.test(moneda)) return "USD";
  if (/peso/i.test(moneda)) return "ARS";
  return null;
}

function resolveRateType(tipoCupon: string | undefined): "FIXED" | "FLOATING" | null {
  if (!tipoCupon) return null;
  if (/variable/i.test(tipoCupon)) return "FLOATING";
  return "FIXED";
}

function resolveFrequencyMonths(frecuencia: string | undefined): number | null {
  if (!frecuencia) return null;
  const match = FREQUENCY_LABELS.find((opt) =>
    opt.label.toLowerCase() === frecuencia.trim().toLowerCase()
  );
  return match ? match.months : null;
}

export function parseArgenBondHtml(html: string): ScrapedBondProposal {
  try {
    const $ = cheerio.load(html);
    const table = $("#cashflow-table");
    if (table.length === 0) {
      return { ...EMPTY_PROPOSAL, amortizationSchedule: [] };
    }

    const summary = buildSummaryMap($);
    const currencyCode = resolveCurrencyCode(summary.get("Moneda Pago"));
    const rateType = resolveRateType(summary.get("Tipo Cupón"));
    const couponFrequencyMonths = resolveFrequencyMonths(summary.get("Frecuencia"));
    const maturityDate = parseArgDate(summary.get("Vencimiento") ?? "");

    const amortizationSchedule: { date: string; principalPct: number }[] = [];
    let residualBeforeRow = 100;
    let couponRate: number | null = null;
    let couponRateEstimated = false;

    table.find("tbody tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 5) return;

      const dateText = $(cells[0]).clone().children("span").remove().end().text();
      const date = parseArgDate(dateText);
      const interesPct = parsePercent($(cells[1]).text());
      const amortPct = parsePercent($(cells[2]).text());

      if (
        !couponRateEstimated &&
        residualBeforeRow === 100 &&
        rateType === "FIXED" &&
        couponFrequencyMonths != null &&
        interesPct != null
      ) {
        couponRate = (interesPct / 100) * (12 / couponFrequencyMonths);
        couponRateEstimated = true;
      }

      if (date != null && amortPct != null && amortPct > 0) {
        amortizationSchedule.push({ date, principalPct: amortPct });
      }

      if (amortPct != null) {
        residualBeforeRow -= amortPct;
      }
    });

    amortizationSchedule.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      faceValue: null,
      currencyCode,
      rateType,
      couponRate,
      couponFrequencyMonths,
      issueDate: null,
      maturityDate,
      amortizationSchedule,
      dayCountConvention: null,
    };
  } catch {
    return { ...EMPTY_PROPOSAL, amortizationSchedule: [] };
  }
}

export async function fetchArgenBondProposal(ticker: string): Promise<ScrapedBondProposal | null> {
  if (!/^[A-Za-z0-9]+$/.test(ticker)) return null;

  try {
    const res = await fetch(`https://argen.bond/bonos/${ticker}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parseArgenBondHtml(html);
  } catch {
    return null;
  }
}
