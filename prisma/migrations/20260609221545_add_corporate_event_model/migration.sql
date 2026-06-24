-- CreateEnum
CREATE TYPE "CorporateEventType" AS ENUM ('CEDEAR_RATIO_CHANGE', 'STOCK_SPLIT', 'REVERSE_SPLIT', 'SPINOFF', 'MERGER', 'TICKER_CHANGE');

-- CreateTable
CREATE TABLE "CorporateEvent" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "eventType" "CorporateEventType" NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "numerator" DECIMAL(20,8) NOT NULL,
    "denominator" DECIMAL(20,8) NOT NULL,
    "notes" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "CorporateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateEvent_instrumentId_idx" ON "CorporateEvent"("instrumentId");

-- CreateIndex
CREATE INDEX "CorporateEvent_createdByUserId_idx" ON "CorporateEvent"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateEvent_instrumentId_effectiveDate_eventType_key" ON "CorporateEvent"("instrumentId", "effectiveDate", "eventType");

-- AddForeignKey
ALTER TABLE "CorporateEvent" ADD CONSTRAINT "CorporateEvent_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateEvent" ADD CONSTRAINT "CorporateEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
