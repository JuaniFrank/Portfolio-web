import type { InstrumentType } from "@/lib/generated/prisma";

export type DividendCurrency = "ARS" | "USD";

export type ReceivedDividend = {
  id: string;
  tradeDate: string;
  ticker: string;
  instrumentType: InstrumentType | null;
  instrumentName: string | null;
  /** Moneda nativa del dividendo (USD para CEDEAR, ARS para acción AR). */
  currencyCode: DividendCurrency;
  /** Bruto en USD (siempre >= 0). "0.00" si no aplica. */
  grossUsd: string;
  /** Bruto en ARS (siempre >= 0). "0.00" si no aplica. */
  grossArs: string;
  /** Retención impositiva en USD (siempre >= 0). */
  taxUsd: string;
  /** Retención impositiva en ARS — el monto efectivamente debitado por el fisco. */
  taxArs: string;
  /** Neto = gross - tax. */
  netUsd: string;
  netArs: string;
  /** CCL USD/ARS del día del pago, embebido por el broker. Null si no hubo embebido. */
  cclAtPayment: string | null;
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
  /** Bruto nativo en ARS (acciones AR). */
  totalGrossArs: string;
  /** Bruto nativo en USD (CEDEARs, dólar cable). */
  totalGrossUsd: string;
  /**
   * Total bruto unificado en ARS usando el CCL del momento.
   * `totalGrossArs + totalGrossUsd × cclToday`. Null si no hay CCL today.
   */
  totalGrossUnifiedArs: string | null;
  /** Total efectivamente debitado al fisco (ARS), sin conversión. */
  totalTaxArs: string;
  /**
   * Neto en ARS: bruto ARS − tax ARS (acciones AR). NO incluye USD.
   */
  totalNetArs: string;
  /**
   * Neto en USD: el USD CCL depositado por CEDEARs.
   * No se le resta tax porque el impuesto se paga en ARS por separado.
   */
  totalNetUsd: string;
  /** % retenciones sobre bruto unificado, formato "0.00". */
  effectiveTaxRate: string;
  /** Ticker con mayor neto (en moneda nativa). */
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
  /** CCL del momento (dolarapi.com → contadoconliqui.mid). Null si la API falló. */
  cclToday: string | null;
  /** Si hubo errores parciales al traer Yahoo (no rompe la página). */
  yahooErrors: string[];
};
