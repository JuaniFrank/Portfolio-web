-- Latest market state is intentionally separate from Instrument metadata and
-- PriceCache's historical bars.
CREATE TABLE "public"."MarketSnapshot" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "price" DECIMAL(20,8),
    "pctChange" DECIMAL(20,8),
    "volume" DECIMAL(20,8),
    "bidQuantity" DECIMAL(20,8),
    "bidPrice" DECIMAL(20,8),
    "askPrice" DECIMAL(20,8),
    "askQuantity" DECIMAL(20,8),
    "openInterest" DECIMAL(20,8),
    "asOf" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."InstrumentProviderSymbol" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSymbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstrumentProviderSymbol_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketSnapshot_instrumentId_key" ON "public"."MarketSnapshot"("instrumentId");
CREATE INDEX "MarketSnapshot_source_asOf_idx" ON "public"."MarketSnapshot"("source", "asOf");
CREATE UNIQUE INDEX "InstrumentProviderSymbol_instrumentId_provider_key" ON "public"."InstrumentProviderSymbol"("instrumentId", "provider");
CREATE UNIQUE INDEX "InstrumentProviderSymbol_provider_providerSymbol_key" ON "public"."InstrumentProviderSymbol"("provider", "providerSymbol");

ALTER TABLE "public"."MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "public"."Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."InstrumentProviderSymbol" ADD CONSTRAINT "InstrumentProviderSymbol_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "public"."Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
