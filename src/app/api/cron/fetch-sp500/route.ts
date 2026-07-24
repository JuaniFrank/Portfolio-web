import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SPY_TICKER = "%5EGSPC"; // Yahoo symbol for S&P 500

async function fetchHistoricalData() {
  const today = Math.floor(Date.now() / 1000);
  const tenYearsAgo = Math.floor(new Date().setFullYear(new Date().getFullYear() - 10) / 1000);
  const url = `https://query1.finance.yahoo.com/v7/finance/download/${SPY_TICKER}?period1=${tenYearsAgo}&period2=${today}&interval=1d&events=history`; // daily history

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to download data: ${res.status}`);
  const csv = await res.text();
  return csv;
}

function parseCsv(csv: string): Array<{ date: Date; close: number }> {
  const lines = csv.split("\n");
  // Fila 0 es el header; se descartan líneas vacías.
  const dataLines = lines.slice(1).filter((l) => l.trim() !== "");
  const rows: Array<{ date: Date; close: number }> = [];
  for (const line of dataLines) {
    const cols = line.split(",");
    const dateStr = cols[0];
    const close = Number(cols[4]);
    if (!dateStr) continue;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(close)) continue;
    rows.push({ date, close });
  }
  return rows;
}

export async function POST(_request: Request) {
  try {
    const csv = await fetchHistoricalData();
    const rows = parseCsv(csv);
    let newCount = 0;

    for (const { date, close } of rows) {
      const exists = await prisma.sp500Snapshot.findUnique({ where: { date } });
      if (!exists) {
        await prisma.sp500Snapshot.create({ data: { date, close } });
        newCount++;
      }
    }

    return Response.json({ ok: true, fetched: rows.length, inserted: newCount }, { status: 200 });
  } catch (e) {
    console.error("Error fetching SP500 data", e);
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
