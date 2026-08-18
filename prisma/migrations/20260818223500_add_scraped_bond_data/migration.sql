-- CreateTable
CREATE TABLE "ScrapedBondData" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedBondData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScrapedBondData_ticker_key" ON "ScrapedBondData"("ticker");
