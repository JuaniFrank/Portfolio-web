/**
 * Diagnóstico de /rendimientos: imprime los insumos del cálculo para poder auditar
 * un número que no cierra, en vez de razonar sobre la pantalla.
 *
 *   pnpm diagnose:rendimientos            # todo el histórico
 *   pnpm diagnose:rendimientos 2025-10    # además, el desglose de ese mes
 *
 * Es **solo lectura**: no escribe nada en la base.
 *
 * Lo que más importa mirar es la sección 4. Yahoo reescribe retroactivamente toda la
 * serie de precios cuando hay un split o un cambio de ratio de CEDEAR (verificado en
 * SPY.BA: el 01/06/2026 pasó de 20:1 a 60:1 y los cierres anteriores quedaron divididos
 * por 3, sin salto en la curva). Como `buildHoldings` además multiplica las cantidades
 * por el ratio, el ajuste tiene que ocurrir **exactamente una vez de cada lado**:
 *
 *   evento cargado    → cantidad ×3, precio ÷3  → valor correcto
 *   evento faltante   → cantidad ×1, precio ÷3  → la posición vale un TERCIO
 *   precio desactualizado → cantidad ×3, precio sin dividir → vale el TRIPLE
 */

import { EOD_PRICE_SOURCE } from "../src/lib/market/history-sync";
import { prisma } from "../src/lib/prisma";
import { buildPerformanceReport } from "../src/lib/rendimientos/series";
import { PERFORMANCE_INSTRUMENT_TYPES } from "../src/lib/rendimientos/types";

const money = (value: unknown) =>
  Number(value).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const pct = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const day = (date: Date) => date.toISOString().slice(0, 10);

function heading(text: string) {
  console.log(`\n${"═".repeat(78)}\n${text}\n${"═".repeat(78)}`);
}

async function main() {
  const targetMonth = process.argv[2];

  // ---- 0. Portfolios ------------------------------------------------------
  heading("0. PORTFOLIOS");
  const portfolios = await prisma.portfolio.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: { select: { transactions: true } },
    },
  });
  for (const entry of portfolios) {
    console.log(
      `  ${entry.name.padEnd(24)} | ${String(entry._count.transactions).padStart(4)} operaciones` +
        `${entry.archivedAt ? " | archivado" : ""}`
    );
  }
  const analyzed = portfolios.find((entry) => entry.archivedAt === null);
  if (portfolios.filter((entry) => entry.archivedAt === null).length > 1) {
    console.log(
      `\n  ⚠️  Hay más de un portfolio activo. /rendimientos analiza SOLO el primero\n` +
        `      (“${analyzed?.name}”), que es el que se detalla más abajo.`
    );
  }
  if (!analyzed) {
    console.log("  Sin portfolios activos.");
    await prisma.$disconnect();
    return;
  }

  // ---- 1. Eventos corporativos -------------------------------------------
  heading("1. EVENTOS CORPORATIVOS CARGADOS");
  const events = await prisma.corporateEvent.findMany({
    orderBy: { effectiveDate: "asc" },
    include: { instrument: { select: { ticker: true, type: true } } },
  });

  if (events.length === 0) {
    console.log("  ⚠️  La tabla CorporateEvent está VACÍA.");
    console.log("      Si algún CEDEAR tuvo cambio de ratio, su posición va a valer");
    console.log("      menos de lo que corresponde: Yahoo ya dividió los precios");
    console.log("      históricos, pero sin el evento las cantidades no se multiplican.");
  }
  for (const event of events) {
    console.log(
      `  ${day(event.effectiveDate)} | ${event.instrument.ticker.padEnd(6)} | ` +
        `${event.eventType.padEnd(20)} | ${event.numerator}:${event.denominator}`
    );
  }

  // ---- 2. Instrumentos ----------------------------------------------------
  heading("2. INSTRUMENTOS CON OPERACIONES");
  const eligible = new Set<string>(PERFORMANCE_INSTRUMENT_TYPES);
  const instruments = await prisma.instrument.findMany({
    where: { transactions: { some: { portfolioId: analyzed.id, type: { in: ["BUY", "SELL"] } } } },
    select: { id: true, ticker: true, type: true },
    orderBy: { ticker: "asc" },
  });

  console.log("  ticker | tipo      | entra | operaciones | precios EOD | rango");
  for (const instrument of instruments) {
    const [trades, priceCount, first, last] = await Promise.all([
      prisma.transaction.count({
        where: { instrumentId: instrument.id, portfolioId: analyzed.id, type: { in: ["BUY", "SELL"] } },
      }),
      prisma.priceCache.count({
        where: { instrumentId: instrument.id, source: EOD_PRICE_SOURCE },
      }),
      prisma.priceCache.findFirst({
        where: { instrumentId: instrument.id, source: EOD_PRICE_SOURCE },
        orderBy: { datetime: "asc" },
        select: { datetime: true },
      }),
      prisma.priceCache.findFirst({
        where: { instrumentId: instrument.id, source: EOD_PRICE_SOURCE },
        orderBy: { datetime: "desc" },
        select: { datetime: true },
      }),
    ]);

    const inScope = eligible.has(instrument.type) ? "sí " : "NO ";
    const range = first && last ? `${day(first.datetime)} → ${day(last.datetime)}` : "SIN PRECIOS";
    console.log(
      `  ${instrument.ticker.padEnd(6)} | ${instrument.type.padEnd(9)} | ${inScope}   | ` +
        `${String(trades).padStart(11)} | ${String(priceCount).padStart(11)} | ${range}`
    );
  }

  // ---- 3. Coherencia precio de compra vs precio de mercado ---------------
  heading("3. ¿EL PRECIO GUARDADO ES COHERENTE CON EL PRECIO PAGADO?");
  console.log(
    "  Compara el precio de cada operación contra el cierre de ese mismo día.\n" +
      "  Un cociente cercano a 1 está bien. Un cociente cercano al ratio de un evento\n" +
      "  (3, 1/3, 20, 1/20…) delata un ajuste aplicado de más o de menos.\n"
  );

  for (const instrument of instruments) {
    if (!eligible.has(instrument.type)) continue;
    const trades = await prisma.transaction.findMany({
      where: { instrumentId: instrument.id, portfolioId: analyzed.id, type: { in: ["BUY", "SELL"] } },
      orderBy: { tradeDate: "asc" },
      select: { tradeDate: true, type: true, quantity: true, price: true, netAmount: true },
    });

    for (const trade of trades) {
      const price = await prisma.priceCache.findFirst({
        where: {
          instrumentId: instrument.id,
          source: EOD_PRICE_SOURCE,
          datetime: { lte: trade.tradeDate },
        },
        orderBy: { datetime: "desc" },
        select: { datetime: true, close: true },
      });

      const paid = Number(trade.price);
      const market = price ? Number(price.close) : null;
      const ratio = market && paid ? market / paid : null;
      const flag =
        ratio === null
          ? "  ⚠️  SIN PRECIO"
          : ratio > 1.5 || ratio < 0.67
            ? `  ⚠️  DESALINEADO ×${ratio.toFixed(3)}`
            : "";

      console.log(
        `  ${day(trade.tradeDate)} ${instrument.ticker.padEnd(6)} ${trade.type.padEnd(4)} ` +
          `qty=${String(trade.quantity).padStart(8)} pagado=${money(paid).padStart(12)} ` +
          `mercado=${(market === null ? "—" : money(market)).padStart(12)}` +
          `${ratio === null ? "" : ` cociente=${ratio.toFixed(3)}`}${flag}`
      );
    }
  }

  // ---- 4. Serie resultante ------------------------------------------------
  heading("4. SERIE MENSUAL QUE PRODUCE EL MOTOR");
  const report = await buildPerformanceReport({
    portfolioIds: [analyzed.id],
    portfolioName: analyzed.name,
  });

  console.log(`  Portfolio: ${report.portfolioName}\n`);
  console.log("  mes     | valor invertido | capital mes  | ganancia mes | mensual | acumulado | cob.");
  for (const row of report.months) {
    console.log(
      `  ${row.month} | ${money(row.valueArs).padStart(15)} | ` +
        `${money(row.netInvestedArs).padStart(12)} | ${money(row.gainArs).padStart(12)} | ` +
        `${pct(row.monthlyReturnArs).padStart(7)} | ${pct(row.cumulativeReturnArs).padStart(9)} | ${row.coverage}`
    );
  }

  if (report.excludedHoldings.length > 0) {
    console.log("\n  Excluidos del cálculo:");
    for (const holding of report.excludedHoldings) {
      console.log(`    ${holding.ticker.padEnd(6)} — ${holding.reason}`);
    }
  }

  // ---- 5. Desglose de un mes ---------------------------------------------
  if (targetMonth) {
    heading(`5. DESGLOSE DE ${targetMonth}`);
    const row = report.months.find((entry) => entry.month === targetMonth);
    if (!row) {
      console.log(`  ${targetMonth} no está en la serie.`);
    } else {
      console.log(`  Valuado al ${row.valuationDate.slice(0, 10)}`);
      console.log(`  CCL cierre        ${row.cclMonthEnd === null ? "—" : money(row.cclMonthEnd)}`);
      console.log(`  Valor invertido   ${money(row.valueArs)}`);
      console.log(`  Capital del mes   ${money(row.netInvestedArs)}`);
      console.log(`  Renta del mes     ${money(row.incomeArs)}`);
      console.log(`  Ganancia del mes  ${money(row.gainArs)}`);
      console.log(`  Rendimiento       ${pct(row.monthlyReturnArs)}`);
      console.log(`  Cobertura         ${row.coverage}`);
      if (row.staleTickers.length > 0) {
        console.log(`  ⚠️  precio arrastrado en: ${row.staleTickers.join(", ")}`);
      }

      console.log("\n  Posiciones al cierre:");
      console.log("  ticker | cantidad     | precio       | valor          | costo          | no realizado");
      for (const position of row.positions) {
        console.log(
          `  ${position.ticker.padEnd(6)} | ${String(position.quantity).padStart(12)} | ` +
            `${money(position.priceArs).padStart(12)} | ${money(position.valueArs).padStart(14)} | ` +
            `${money(position.costBasisArs).padStart(14)} | ${pct(position.unrealizedReturnPct).padStart(8)}` +
            `${position.priceIsStale ? "  ⚠️ arrastrado" : ""}`
        );
      }
      console.log(
        "\n  Si el 'no realizado' de un CEDEAR ronda −67 % o +200 % sin motivo de mercado,\n" +
          "  el ajuste por ratio está faltando o aplicado dos veces (ver secciones 1 y 3)."
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("\nERROR:", error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
