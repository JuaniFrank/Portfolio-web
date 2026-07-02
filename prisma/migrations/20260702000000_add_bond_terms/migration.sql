-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('FIXED', 'FLOATING');

-- CreateTable
CREATE TABLE "BondTerms" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "faceValue" DECIMAL(20,8) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "rateType" "RateType" NOT NULL,
    "couponRate" DECIMAL(20,8) NOT NULL,
    "couponFrequencyMonths" INTEGER NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "amortizationSchedule" JSONB NOT NULL,
    "dayCountConvention" TEXT NOT NULL DEFAULT 'ACT/365',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BondTerms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BondTerms_instrumentId_key" ON "BondTerms"("instrumentId");

-- CreateIndex
CREATE INDEX "BondTerms_instrumentId_idx" ON "BondTerms"("instrumentId");

-- AddForeignKey
ALTER TABLE "BondTerms" ADD CONSTRAINT "BondTerms_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
