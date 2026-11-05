import { z } from "zod";

/** Query/body of the series and history endpoints (/api/activos/series, /api/activos/history). */
export const seriesInputSchema = z.object({
  instrumentId: z.string().min(1),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  range: z.enum(["1M", "3M", "6M", "1Y", "ALL"]).default("ALL"),
  chartType: z.enum(["line", "candles"]).default("line"),
  kind: z.enum(["native", "cedear-underlying", "cedear-theoretical"]).default("native"),
});

export type SeriesInput = z.input<typeof seriesInputSchema>;
export type ParsedSeriesInput = z.output<typeof seriesInputSchema>;

/** Query of the trades endpoint (/api/activos/trades). */
export const tradesInputSchema = z.object({
  instrumentId: z.string().min(1),
});
