import type { InstrumentType } from "@/lib/generated/prisma";

export type DividendCurrency = "ARS" | "USD";

export type ReceivedDividend = {
  id: string;
  tradeDate: string;
  ticker: string;
  instrumentType: InstrumentType | null;
  instrumentName: string | null;
  /** Monto pagado (siempre positivo). */
  grossAmount: string;
  /** Retenciones impositivas asociadas (siempre positivo). 0 si no hay. */
  taxAmount: string;
  /** Neto = gross - tax. */
  netAmount: string;
  currencyCode: DividendCurrency;
};

export type UpcomingDividend = {
  ticker: string;
  instrumentName: string | null;
  /** Fecha proyectada (ISO). */
  estimatedDate: string;
  /** Monto unitario estimado en la moneda del ticker. */
  estimatedAmountPerShare: string;
  /** Holdings actuales del usuario para ese instrumento. */
  quantity: string;
  /** Monto total estimado = quantity * estimatedAmountPerShare. */
  estimatedTotal: string;
  currencyCode: DividendCurrency;
  isEstimate: true;
};

export type DividendMonth = {
  /** "2026-05" */
  key: string;
  year: number;
  month: number;
  /** Pagos confirmados ya recibidos en ese mes. */
  received: ReceivedDividend[];
  /** Pagos futuros estimados en ese mes. */
  upcoming: UpcomingDividend[];
};

export type DividendKpis = {
  totalGrossArs: string;
  totalTaxArs: string;
  totalNetArs: string;
  totalGrossUsd: string;
  totalTaxUsd: string;
  totalNetUsd: string;
  /** % retenciones sobre bruto, formato "0.00". */
  effectiveTaxRate: string;
  /** Ticker con mayor neto recibido. */
  topTicker: { ticker: string; netArs: string; netUsd: string } | null;
  /** Cantidad total de pagos recibidos. */
  totalPayments: number;
  /** Pagos del año en curso. */
  ytdNetArs: string;
  ytdNetUsd: string;
  /** Pagos del año anterior. */
  lastYearNetArs: string;
  lastYearNetUsd: string;
  /** Próximos 30 días estimados. */
  next30dEstimatedArs: string;
  next30dEstimatedUsd: string;
};

export type DividendByTicker = {
  ticker: string;
  instrumentName: string | null;
  payments: number;
  grossArs: string;
  taxArs: string;
  netArs: string;
  grossUsd: string;
  taxUsd: string;
  netUsd: string;
  /** Cantidad actual en cartera (puede ser 0 si vendió). */
  currentQuantity: string;
};

export type DividendByMonth = {
  /** "2026-05" */
  key: string;
  label: string;
  grossArs: string;
  taxArs: string;
  netArs: string;
  grossUsd: string;
  taxUsd: string;
  netUsd: string;
};

export type DividendsPageData = {
  kpis: DividendKpis;
  byTicker: DividendByTicker[];
  byMonth: DividendByMonth[];
  /** 12 meses calendario alrededor de "hoy" (-6 a +5). */
  calendar: DividendMonth[];
  received: ReceivedDividend[];
  upcoming: UpcomingDividend[];
  cclRate: string | null;
  /** Si hubo errores parciales al traer Yahoo (no rompe la página). */
  yahooErrors: string[];
};
