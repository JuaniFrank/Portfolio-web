-- Equity-profile drip (arg_stocks/arg_cedears profile enrichment, capped,
-- held-instrument-independent). Explicit marker instead of inferring
-- "unenriched" from name === ticker, which would false-positive whenever a
-- real ticker's name IS its symbol.
ALTER TABLE "Instrument" ADD COLUMN "profileEnrichedAt" TIMESTAMP(3);
