import { z } from "zod";

/** Query/body of the series and history endpoints (/api/activos/series, /api/activos/history). */
export const seriesInputSchema = z.object({
  instrumentId: z.string().min(1),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  range: z.enum(["1M", "3M", "6M", "1Y", "ALL"]).default("ALL"),
  chartType: z.enum(["line", "candles"]).default("line"),
  kind: z.enum(["native", "cedear-underlying", "cedear-theoretical"]).default("native"),
  /** Split-adjusted ("1", true; default) or as stored ("0", false). Ignored when the server switch is off. */
  adjusted: z
    .union([z.boolean(), z.enum(["0", "1"])])
    .default(true)
    .transform((v) => v === true || v === "1"),
});

export type SeriesInput = z.input<typeof seriesInputSchema>;
export type ParsedSeriesInput = z.output<typeof seriesInputSchema>;

/** Query of the trades endpoint (/api/activos/trades). */
export const tradesInputSchema = z.object({
  instrumentId: z.string().min(1),
});
