import { redirect } from "next/navigation";
import { AlertsPage } from "@/components/alerts/alerts-page";
import { createMarketPriceSource } from "@/lib/alerts/adapters/market-price-source";
import { loadUserTargets } from "@/lib/alerts/adapters/prisma-targets";
import { basisForInstrumentType } from "@/lib/alerts/evaluate";
import { buildTargetRows } from "@/lib/alerts/rows";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Alertas | Portafolio",
  description: "Objetivos de precio de tus CEDEARs y acciones locales",
};

export default async function AlertasRoutePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [targets, instruments] = await Promise.all([
    loadUserTargets(user.id),
    prisma.instrument.findMany({
      where: {
        type: { in: ["CEDEAR", "STOCK_AR"] },
        transactions: { some: { portfolio: { userId: user.id } } },
      },
      select: { id: true, ticker: true, name: true, type: true },
      orderBy: { ticker: "asc" },
    }),
  ]);

  // El precio es accesorio: si falla la fuente, la lista se muestra igual sin él.
  let prices = new Map<string, number>();
  try {
    prices = await createMarketPriceSource().resolve(
      [...new Map(targets.map((t) => [t.instrumentId, t])).values()].map((t) => ({
        instrumentId: t.instrumentId,
        currency: t.currency,
        symbol: t.symbol,
      }))
    );
  } catch (error) {
    console.error("Alertas: no se pudieron resolver los precios", error);
  }

  return (
    <AlertsPage
      rows={buildTargetRows(targets, prices)}
      instruments={instruments.map((instrument) => ({
        id: instrument.id,
        label: `${instrument.ticker} · ${instrument.name}`,
        // Misma regla que usa la action al crear: la moneda sale del tipo de instrumento.
        currency: basisForInstrumentType(instrument.type) ?? undefined,
      }))}
    />
  );
}
