/**
 * Day-count conventions for fixed-income accrual.
 *
 * Each coupon's interest is: notional × couponRate × yearFraction(start, end),
 * where the year fraction depends on the bond's day-count convention.
 *
 * Date component math uses UTC accessors on purpose: BondTerms dates are stored
 * as UTC-midnight ISO strings, so getUTC* returns the intended calendar day.
 * Actual-day counts use epoch-millisecond differences, which are timezone-safe.
 */

export type DayCountConvention =
  | "30/360"
  | "ACT/360"
  | "ACT/365"
  | "ACT/ACT"
  | "30E/360";

const SUPPORTED: readonly DayCountConvention[] = [
  "30/360",
  "ACT/360",
  "ACT/365",
  "ACT/ACT",
  "30E/360",
];

/** Coerce an arbitrary stored string to a supported convention (fallback ACT/365). */
export function normalizeConvention(raw: string | null | undefined): DayCountConvention {
  return SUPPORTED.includes(raw as DayCountConvention)
    ? (raw as DayCountConvention)
    : "ACT/365";
}

export type PeriodAccrual = {
  /**
   * Days in the period per the convention numerator: actual calendar days for
   * ACT/* conventions, 30-adjusted days for 30/360 and 30E/360. Shown in the UI.
   */
  days: number;
  /** Year fraction used for accrual: interest = notional × rate × yearFraction. */
  yearFraction: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function actualDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * 30/360 day count. `european = true` applies the 30E/360 (Eurobond) end-date
 * rule; otherwise the 30/360 US (bond basis) rule is used.
 */
function days30360(start: Date, end: Date, european: boolean): number {
  let d1 = start.getUTCDate();
  let d2 = end.getUTCDate();
  const m1 = start.getUTCMonth() + 1;
  const m2 = end.getUTCMonth() + 1;
  const y1 = start.getUTCFullYear();
  const y2 = end.getUTCFullYear();

  if (european) {
    // 30E/360: clamp both endpoints from 31 to 30.
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    // 30/360 US: if start day is 31 → 30; if end day is 31 AND start day is
    // 30 (after its own clamp) → 30.
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
  }

  return 360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1);
}

/**
 * ACT/ACT (ISDA): split the period at calendar-year boundaries and weight each
 * portion by that year's actual length (365 or 366).
 */
function actActIsdaFraction(start: Date, end: Date): number {
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (startYear === endYear) {
    return actualDays(start, end) / daysInYear(startYear);
  }

  // Portion in the start year: [start, Jan 1 of next year)
  const startYearEnd = new Date(Date.UTC(startYear + 1, 0, 1));
  let fraction = actualDays(start, startYearEnd) / daysInYear(startYear);

  // Whole calendar years fully contained in the period
  for (let y = startYear + 1; y < endYear; y++) {
    fraction += 1;
  }

  // Portion in the end year: [Jan 1 of end year, end)
  const endYearStart = new Date(Date.UTC(endYear, 0, 1));
  fraction += actualDays(endYearStart, end) / daysInYear(endYear);

  return fraction;
}

/**
 * Compute the accrual for one coupon period under the given convention.
 */
export function periodAccrual(
  start: Date,
  end: Date,
  convention: DayCountConvention
): PeriodAccrual {
  switch (convention) {
    case "ACT/360": {
      const d = actualDays(start, end);
      return { days: d, yearFraction: d / 360 };
    }
    case "ACT/365": {
      const d = actualDays(start, end);
      return { days: d, yearFraction: d / 365 };
    }
    case "ACT/ACT": {
      return { days: actualDays(start, end), yearFraction: actActIsdaFraction(start, end) };
    }
    case "30/360": {
      const d = days30360(start, end, false);
      return { days: d, yearFraction: d / 360 };
    }
    case "30E/360": {
      const d = days30360(start, end, true);
      return { days: d, yearFraction: d / 360 };
    }
  }
}
