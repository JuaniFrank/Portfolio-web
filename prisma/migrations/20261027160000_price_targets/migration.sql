-- CreateEnum
CREATE TYPE "PriceTargetDirection" AS ENUM ('ABOVE', 'BELOW');

-- CreateTable
CREATE TABLE "PriceTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "targetPrice" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "direction" "PriceTargetDirection" NOT NULL,
    "note" TEXT,
    "triggeredAt" TIMESTAMP(3),
    "triggeredPrice" DECIMAL(20,8),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceTarget_userId_idx" ON "PriceTarget"("userId");

-- CreateIndex
CREATE INDEX "PriceTarget_instrumentId_idx" ON "PriceTarget"("instrumentId");

-- CreateIndex
CREATE INDEX "PriceTarget_notifiedAt_idx" ON "PriceTarget"("notifiedAt");

-- AddForeignKey
ALTER TABLE "PriceTarget" ADD CONSTRAINT "PriceTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTarget" ADD CONSTRAINT "PriceTarget_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

