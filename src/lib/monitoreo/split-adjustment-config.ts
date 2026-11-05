/**
 * Server-side kill switch of the /activos read-time split adjustment. Set
 * `ACTIVOS_SPLIT_ADJUSTMENT=off` to serve exactly the previous raw behavior (label "raw",
 * legacy trade gating) and hide the "Ajustado / Sin ajustar" toggle. Anything else is on.
 * This is the only place that reads the variable.
 */
export function isSplitAdjustmentEnabled(): boolean {
  return process.env.ACTIVOS_SPLIT_ADJUSTMENT?.trim().toLowerCase() !== "off";
}
