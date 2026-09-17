-- CreateEnum
CREATE TYPE "Settlement" AS ENUM ('ARS', 'USD', 'MEP', 'CCL');

-- DropForeignKey
ALTER TABLE "CorporateEvent" DROP CONSTRAINT "CorporateEvent_createdByUserId_fkey";

-- AlterTable
-- Settlement variants (AD-1): non-nullable settlement (positive assertion,
-- never a default state outside the enum's own USD case), nullable
-- baseInstrumentId (a base instrument has no base — semantic, not a gap),
-- and provider-sourced descriptive metadata (AD-3, AD-13). isin already
-- existed as String? — see the schema comment: NEVER add a unique
-- constraint to it, settlement variants deliberately share an ISIN.
ALTER TABLE "Instrument"
  ADD COLUMN "settlement"       "Settlement" NOT NULL DEFAULT 'ARS',
  ADD COLUMN "baseInstrumentId" TEXT,
  ADD COLUMN "sector"           TEXT,
  ADD COLUMN "industry"         TEXT,
  ADD COLUMN "issuer"           TEXT,
  ADD COLUMN "law"              TEXT,
  ADD COLUMN "assetClass"       TEXT;

-- AlterTable
-- CorporateEvent.createdByUserId becomes nullable so the seed can load known
-- public corporate actions (e.g. the SPY ratio change, FR-15) with no
-- creator. @@unique([instrumentId, effectiveDate, eventType]) already treats
-- a corporate event as a global fact about the instrument, not a user record.
ALTER TABLE "CorporateEvent" ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- CreateTable
-- Docta's per-period cashflow schedule, stored verbatim (AD-14). A step-up
-- bond's interestRate sequence is preserved exactly, never summarized.
CREATE TABLE "BondSchedule" (
    "id"           TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "source"       TEXT NOT NULL,
    "rows"         JSONB NOT NULL,
    "fetchedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BondSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BondSchedule_instrumentId_key" ON "BondSchedule"("instrumentId");

-- CreateIndex
CREATE INDEX "Instrument_baseInstrumentId_idx" ON "Instrument"("baseInstrumentId");

-- CreateIndex
-- AD-13, R-2e: index only, NEVER unique. Settlement variants (e.g. AL30 /
-- AL30D) deliberately share an ISIN — that sharing is the base<->variant
-- link. A unique constraint would make it impossible to insert a base and
-- its variant together and would fail at insert time on a reset database.
CREATE INDEX "Instrument_isin_idx" ON "Instrument"("isin");

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_baseInstrumentId_fkey" FOREIGN KEY ("baseInstrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateEvent" ADD CONSTRAINT "CorporateEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondSchedule" ADD CONSTRAINT "BondSchedule_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
