-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AssetType" AS ENUM ('EQUITY', 'BOND', 'COMMODITY', 'INDEX', 'CRYPTO', 'FUND', 'CASH');

-- CreateEnum
CREATE TYPE "public"."CostMethod" AS ENUM ('PPP', 'FIFO', 'LIFO');

-- CreateEnum
CREATE TYPE "public"."FxSource" AS ENUM ('CCL', 'MEP', 'OFICIAL', 'BLUE', 'MAYORISTA', 'CRYPTO', 'BROKER');

-- CreateEnum
CREATE TYPE "public"."ImportStatus" AS ENUM ('PENDING', 'PREVIEW', 'COMMITTED', 'REVERTED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."InstrumentType" AS ENUM ('CEDEAR', 'STOCK_AR', 'BOND_AR', 'LETRA', 'ON', 'FCI', 'STOCK_US', 'ETF', 'CRYPTO', 'STABLECOIN', 'CASH', 'OPTION', 'FUTURE');

-- CreateEnum
CREATE TYPE "public"."MacroCode" AS ENUM ('IPC_AR', 'CPI_US', 'MERVAL', 'SP500', 'RIESGO_PAIS', 'UVA', 'CER', 'BADLAR');

-- CreateEnum
CREATE TYPE "public"."TransactionSource" AS ENUM ('MANUAL', 'IMPORT', 'API');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('BUY', 'SELL', 'DIVIDEND_CASH', 'DIVIDEND_STOCK', 'COUPON', 'AMORTIZATION', 'INTEREST', 'FEE', 'TAX_WITHHOLDING', 'DEPOSIT', 'WITHDRAWAL', 'FX_CONVERSION', 'SPLIT', 'REVERSE_SPLIT', 'SPINOFF', 'MERGER', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."VenueType" AS ENUM ('EXCHANGE', 'OTC', 'CRYPTO', 'BROKER_INTERNAL');

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Broker" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Broker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BrokerAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "isCrypto" BOOLEAN NOT NULL DEFAULT false,
    "isFiat" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public"."FxRate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "baseCurrencyCode" TEXT NOT NULL,
    "quoteCurrencyCode" TEXT NOT NULL,
    "source" "public"."FxSource" NOT NULL,
    "buy" DECIMAL(20,8),
    "sell" DECIMAL(20,8),
    "mid" DECIMAL(20,8) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "public"."ImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rawSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Instrument" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."InstrumentType" NOT NULL,
    "venueCode" TEXT,
    "currencyCode" TEXT NOT NULL,
    "underlyingAssetId" TEXT,
    "conversionRatio" DECIMAL(20,8),
    "isin" TEXT,
    "taxJurisdiction" TEXT,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MacroSeries" (
    "id" TEXT NOT NULL,
    "code" "public"."MacroCode" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(20,8) NOT NULL,

    CONSTRAINT "MacroSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseCurrencyCode" TEXT NOT NULL DEFAULT 'ARS',
    "costMethod" "public"."CostMethod" NOT NULL DEFAULT 'PPP',
    "inceptionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalValueArs" DECIMAL(20,8) NOT NULL,
    "totalValueUsd" DECIMAL(20,8) NOT NULL,
    "cashArs" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "cashUsd" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "netDepositsArs" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "netDepositsUsd" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "twrSinceInception" DECIMAL(20,8),
    "positions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceCache" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(20,8),
    "high" DECIMAL(20,8),
    "low" DECIMAL(20,8),
    "close" DECIMAL(20,8) NOT NULL,
    "volume" DECIMAL(20,8),
    "source" TEXT NOT NULL,

    CONSTRAINT "PriceCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Transaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "type" "public"."TransactionType" NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "settlementDate" TIMESTAMP(3),
    "quantity" DECIMAL(20,8) NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "grossAmount" DECIMAL(20,8) NOT NULL,
    "fees" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "taxes" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "marketRights" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,8) NOT NULL,
    "fxRateToBaseCurrency" DECIMAL(20,8),
    "counterpartyAccountId" TEXT,
    "notes" TEXT,
    "source" "public"."TransactionSource" NOT NULL DEFAULT 'MANUAL',
    "importBatchId" TEXT,
    "externalId" TEXT,
    "idempotencyHash" TEXT NOT NULL,
    "idempotencyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransactionTag" (
    "transactionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TransactionTag_pkey" PRIMARY KEY ("transactionId","tagId")
);

-- CreateTable
CREATE TABLE "public"."UnderlyingAsset" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."AssetType" NOT NULL,
    "sector" TEXT,
    "country" TEXT,
    "isin" TEXT,

    CONSTRAINT "UnderlyingAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "displayCurrencyCode" TEXT NOT NULL DEFAULT 'ARS',
    "defaultCostMethod" "public"."CostMethod" NOT NULL DEFAULT 'PPP',
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Venue" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "timezone" TEXT NOT NULL,
    "type" "public"."VenueType" NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "public"."AuditLog"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Broker_code_key" ON "public"."Broker"("code" ASC);

-- CreateIndex
CREATE INDEX "BrokerAccount_brokerId_idx" ON "public"."BrokerAccount"("brokerId" ASC);

-- CreateIndex
CREATE INDEX "BrokerAccount_userId_idx" ON "public"."BrokerAccount"("userId" ASC);

-- CreateIndex
CREATE INDEX "FxRate_baseCurrencyCode_quoteCurrencyCode_date_idx" ON "public"."FxRate"("baseCurrencyCode" ASC, "quoteCurrencyCode" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_date_baseCurrencyCode_quoteCurrencyCode_source_key" ON "public"."FxRate"("date" ASC, "baseCurrencyCode" ASC, "quoteCurrencyCode" ASC, "source" ASC);

-- CreateIndex
CREATE INDEX "ImportBatch_userId_idx" ON "public"."ImportBatch"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_ticker_type_venueCode_currencyCode_key" ON "public"."Instrument"("ticker" ASC, "type" ASC, "venueCode" ASC, "currencyCode" ASC);

-- CreateIndex
CREATE INDEX "Instrument_type_idx" ON "public"."Instrument"("type" ASC);

-- CreateIndex
CREATE INDEX "Instrument_underlyingAssetId_idx" ON "public"."Instrument"("underlyingAssetId" ASC);

-- CreateIndex
CREATE INDEX "MacroSeries_code_date_idx" ON "public"."MacroSeries"("code" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MacroSeries_code_date_key" ON "public"."MacroSeries"("code" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "Portfolio_userId_idx" ON "public"."Portfolio"("userId" ASC);

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_portfolioId_date_idx" ON "public"."PortfolioSnapshot"("portfolioId" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_portfolioId_date_key" ON "public"."PortfolioSnapshot"("portfolioId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "PriceCache_instrumentId_datetime_idx" ON "public"."PriceCache"("instrumentId" ASC, "datetime" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PriceCache_instrumentId_datetime_source_key" ON "public"."PriceCache"("instrumentId" ASC, "datetime" ASC, "source" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_userId_name_key" ON "public"."Tag"("userId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "Transaction_brokerAccountId_idx" ON "public"."Transaction"("brokerAccountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyHash_idempotencyVersion_key" ON "public"."Transaction"("idempotencyHash" ASC, "idempotencyVersion" ASC);

-- CreateIndex
CREATE INDEX "Transaction_instrumentId_idx" ON "public"."Transaction"("instrumentId" ASC);

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_tradeDate_idx" ON "public"."Transaction"("portfolioId" ASC, "tradeDate" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UnderlyingAsset_ticker_key" ON "public"."UnderlyingAsset"("ticker" ASC);

-- CreateIndex
CREATE INDEX "UnderlyingAsset_type_idx" ON "public"."UnderlyingAsset"("type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrokerAccount" ADD CONSTRAINT "BrokerAccount_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "public"."Broker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrokerAccount" ADD CONSTRAINT "BrokerAccount_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrokerAccount" ADD CONSTRAINT "BrokerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FxRate" ADD CONSTRAINT "FxRate_baseCurrencyCode_fkey" FOREIGN KEY ("baseCurrencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FxRate" ADD CONSTRAINT "FxRate_quoteCurrencyCode_fkey" FOREIGN KEY ("quoteCurrencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportBatch" ADD CONSTRAINT "ImportBatch_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "public"."Broker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Instrument" ADD CONSTRAINT "Instrument_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Instrument" ADD CONSTRAINT "Instrument_underlyingAssetId_fkey" FOREIGN KEY ("underlyingAssetId") REFERENCES "public"."UnderlyingAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Instrument" ADD CONSTRAINT "Instrument_venueCode_fkey" FOREIGN KEY ("venueCode") REFERENCES "public"."Venue"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Portfolio" ADD CONSTRAINT "Portfolio_baseCurrencyCode_fkey" FOREIGN KEY ("baseCurrencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PriceCache" ADD CONSTRAINT "PriceCache_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "public"."Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "public"."BrokerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_counterpartyAccountId_fkey" FOREIGN KEY ("counterpartyAccountId") REFERENCES "public"."BrokerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "public"."ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "public"."Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransactionTag" ADD CONSTRAINT "TransactionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "public"."Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransactionTag" ADD CONSTRAINT "TransactionTag_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_displayCurrencyCode_fkey" FOREIGN KEY ("displayCurrencyCode") REFERENCES "public"."Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

