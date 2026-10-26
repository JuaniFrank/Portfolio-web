/**
 * Where clause for "the current CCL". FxRate also stores MEP rows for the same
 * dates, so a USD/ARS lookup without the source can return MEP and mix it with
 * costs computed at the historical CCL.
 */
export const CCL_RATE_WHERE = {
  baseCurrencyCode: "USD",
  quoteCurrencyCode: "ARS",
  source: "CCL",
} as const;
