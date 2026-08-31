-- CreateTable
CREATE TABLE "SuggestedCorporateEvent" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "eventType" "CorporateEventType" NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "numerator" DECIMAL(20,8) NOT NULL,
    "denominator" DECIMAL(20,8) NOT NULL,
    "source" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestedCorporateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestedCorporateEventDismissal" (
    "id" TEXT NOT NULL,
    "suggestedEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestedCorporateEventDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuggestedCorporateEvent_instrumentId_idx" ON "SuggestedCorporateEvent"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestedCorporateEvent_instrumentId_effectiveDate_eventTy_key" ON "SuggestedCorporateEvent"("instrumentId", "effectiveDate", "eventType");

-- CreateIndex
CREATE INDEX "SuggestedCorporateEventDismissal_userId_idx" ON "SuggestedCorporateEventDismissal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestedCorporateEventDismissal_suggestedEventId_userId_key" ON "SuggestedCorporateEventDismissal"("suggestedEventId", "userId");

-- AddForeignKey
ALTER TABLE "SuggestedCorporateEvent" ADD CONSTRAINT "SuggestedCorporateEvent_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestedCorporateEventDismissal" ADD CONSTRAINT "SuggestedCorporateEventDismissal_suggestedEventId_fkey" FOREIGN KEY ("suggestedEventId") REFERENCES "SuggestedCorporateEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestedCorporateEventDismissal" ADD CONSTRAINT "SuggestedCorporateEventDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
