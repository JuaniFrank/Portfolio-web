// Mocking script — creates test user, portfolio, snapshots and triggers SP500 fetch.
import { PrismaClient } from "../src/lib/generated/prisma";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function ensureUser() {
  const email = "test@gmail.com";
  const userId = "cmqsl5fyd000152q1dvsq6pww";
  
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Found existing user:", existing.id);
    return existing;
  }

  const user = await prisma.user.create({
    data: {
      id: userId,
      email,
      passwordHash: await bcrypt.hash("password123", 12),
      name: "Test User",
      displayCurrencyCode: "ARS",
    },
  });
  console.log("Created user:", user.id);
  return user;
}

async function ensurePortfolio(userId: string) {
  let portfolio = await prisma.portfolio.findFirst({ where: { userId } });
  if (!portfolio) {
    portfolio = await prisma.portfolio.create({
      data: {
        userId,
        name: "Mi Portafolio",
        baseCurrencyCode: "ARS",
        isDefault: true,
        inceptionDate: new Date("2024-01-02"),
      },
    });
    console.log("Created portfolio:", portfolio.id);
  }
  return portfolio;
}

async function ensureBrokerAccount(userId: string) {
  const broker = await prisma.broker.findUnique({ where: { code: "BALANZ" } });
  if (!broker) throw new Error("BALANZ broker not found — run seed first");

  let account = await prisma.brokerAccount.findFirst({
    where: { userId, brokerId: broker.id },
  });
  if (!account) {
    account = await prisma.brokerAccount.create({
      data: {
        userId,
        brokerId: broker.id,
        name: "Cuenta Principal",
        currencyCode: "ARS",
      },
    });
    console.log("Created broker account:", account.id);
  }
  return account;
}

async function seedSnapshotsFixed(portfolioId: string) {
  const snapshotCount = await prisma.portfolioSnapshot.count({
    where: { portfolioId },
  });
  if (snapshotCount > 0) {
    console.log(`Already have ${snapshotCount} snapshots. Skipping.`);
    return;
  }

  // Se insertan los decimales como strings vía raw SQL (::numeric) para evitar
  // problemas de precisión con el constructor Decimal.
  console.log("Seeding PortfolioSnapshot rows...");
  
  // Generate ~52 weekly snapshots starting Jan 2, 2024
  const data = [];
  let baseValue = 4500000; // ARS
  let netDeposits = 2000000;

  for (let i = 0; i < 78; i++) {
    const date = new Date("2024-01-02");
    date.setDate(date.getDate() + i * 7);
    // Clamp to June 2025 so we don't go into the far future past SP500 data
    if (date > new Date("2025-06-30")) break;

    const weeklyReturn = Math.random() * 0.08 - 0.02;
    baseValue *= (1 + weeklyReturn);

    if (i % 12 === 0 && i > 0) {
      netDeposits += 500000;
    }

    const approxFx = 850 + i * 8;
    const usdValue = baseValue / approxFx;

    data.push({
      date: new Date(date.toISOString().split("T")[0] + "T12:00:00Z"),
      totalValueArs: baseValue.toFixed(2),
      totalValueUsd: usdValue.toFixed(2),
      cashArs: (baseValue * 0.05).toFixed(2),
      cashUsd: (usdValue * 0.05).toFixed(2),
      netDepositsArs: netDeposits.toFixed(2),
      netDepositsUsd: (netDeposits / approxFx).toFixed(2),
    });
  }

  // Insert via raw SQL to avoid Decimal issues
  for (const row of data) {
    await prisma.$executeRaw`
      INSERT INTO "PortfolioSnapshot"
        ("id", "portfolioId", "date", "totalValueArs", "totalValueUsd", "cashArs", "cashUsd", "netDepositsArs", "netDepositsUsd", "positions", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${portfolioId}, ${row.date}, ${row.totalValueArs}::numeric, ${row.totalValueUsd}::numeric, ${row.cashArs}::numeric, ${row.cashUsd}::numeric, ${row.netDepositsArs}::numeric, ${row.netDepositsUsd}::numeric, '[]'::json, now(), now())
    `;
  }

  console.log(`Inserted ${data.length} PortfolioSnapshot rows`);
}

async function triggerSp500Cron() {
  console.log("Triggering SP500 fetch cron...");
  const nextUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  try {
    const res = await fetch(`${nextUrl}/api/cron/fetch-sp500`, { method: "POST" });
    const body = await res.json();
    console.log("SP500 cron response:", body);
  } catch (e) {
    console.error("Failed to trigger SP500 cron. Next.js server may not be running.", e instanceof Error ? e.message : e);
    console.log("Skipping — you can run it manually with: curl -X POST http://localhost:3000/api/cron/fetch-sp500");
  }
}

async function directSp500Seed() {
  // Direct DB fetch of S&P 500 data as fallback if Next.js isn't running
  const count = await prisma.sp500Snapshot.count();
  if (count > 100) {
    console.log(`Already have ${count} SP500 snapshots. Skipping.`);
    return;
  }

  console.log("Fetching S&P 500 historical data directly...");
  const today = Math.floor(Date.now() / 1000);
  const tenYearsAgo = Math.floor(new Date().setFullYear(new Date().getFullYear() - 3) / 1000);
  const url = `https://query1.finance.yahoo.com/v7/finance/download/%5EGSPC?period1=${tenYearsAgo}&period2=${today}&interval=1d&events=history`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);
    const csv = await res.text();
    const lines = csv.split("\n");
    const dataLines = lines.slice(1).filter((l) => l.trim() !== "");

    let inserted = 0;
    for (const line of dataLines) {
      const [dateStr, , , , close] = line.split(",");
      const exists = await prisma.sp500Snapshot.findUnique({ where: { date: new Date(dateStr + "T00:00:00Z") } });
      if (!exists) {
        await prisma.$executeRaw`
          INSERT INTO "Sp500Snapshot" ("date", "close")
          VALUES (${new Date(dateStr + "T00:00:00Z")}, ${close}::numeric)
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
    }
    console.log(`SP500 direct seed: ${inserted} new rows inserted`);
  } catch (e) {
    console.error("Failed to fetch S&P 500 data:", e instanceof Error ? e.message : e);
  }
}

async function main() {
  const user = await ensureUser();
  const portfolio = await ensurePortfolio(user.id);
  await ensureBrokerAccount(user.id);
  await seedSnapshotsFixed(portfolio.id);
  
  console.log("\nChecking if Next.js server is running to trigger cron...");
  await triggerSp500Cron();
  // Also try direct fetch as fallback
  await directSp500Seed();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
