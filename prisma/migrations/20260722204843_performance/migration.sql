/*
  Warnings:

  - Added the required column `updatedAt` to the `PortfolioSnapshot` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PortfolioSnapshot" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "Sp500Snapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "close" DECIMAL(20,8) NOT NULL,

    CONSTRAINT "Sp500Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sp500Snapshot_date_key" ON "Sp500Snapshot"("date");
