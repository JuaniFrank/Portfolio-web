import { redirect } from "next/navigation";
import { RendimientosPage } from "@/components/rendimientos/rendimientos-page";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPerformanceReport } from "@/lib/rendimientos/series";
import type { PerformanceReport } from "@/lib/rendimientos/types";

/**
 * El reporte se calcula on-demand en cada revalidación en vez de leerse de una tabla.
 *
 * Es la decisión de fondo de este rediseño: al recalcular siempre, el histórico **nunca
 * puede quedar desactualizado**, que era exactamente la enfermedad del enfoque anterior
 * basado en `PortfolioSnapshot`. Cuesta cuatro queries más matemática pura, así que 5
 * minutos de caché alcanzan de sobra. Si con muchos meses se pusiera lento, el paso
 * siguiente es materializar la serie mensual — pero siempre como caché reconstruible,
 * nunca como fuente de verdad.
 */
export const revalidate = 300;

export default async function RendimientosRoutePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // El motor acepta N portfolios y los agrega. Hoy la app maneja uno solo, así que se
  // le pasa uno; cuando exista multi-portfolio basta con pasarle la lista completa sin
  // tocar el motor.
  const portfolios = await prisma.portfolio.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
    take: 1,
  });

  const portfolio = portfolios[0];
  if (!portfolio) return <RendimientosPage report={emptyReport("Sin portfolio")} />;

  const report = await safeBuildReport(portfolio.id, portfolio.name);
  return <RendimientosPage report={report} />;
}

/**
 * Una caída del motor no puede dejar la pantalla en blanco: se degrada a un reporte
 * vacío y los avisos de la UI explican que falta el histórico.
 *
 * El `try/catch` vive acá y no alrededor del JSX a propósito: React no renderiza el
 * componente en el momento en que se construye el elemento, así que un `catch` sobre
 * JSX no atraparía errores de render — solo daría una falsa sensación de seguridad.
 */
async function safeBuildReport(
  portfolioId: string,
  portfolioName: string
): Promise<PerformanceReport> {
  try {
    return await buildPerformanceReport({ portfolioIds: [portfolioId], portfolioName });
  } catch (error) {
    console.error("Rendimientos report error", error);
    return emptyReport(portfolioName);
  }
}

function emptyReport(portfolioName: string): PerformanceReport {
  return {
    portfolioName,
    months: [],
    benchmarks: [],
    summary: {
      currentValueArs: 0,
      currentValueUsd: 0,
      cumulativeReturnArs: null,
      cumulativeReturnUsd: null,
      cumulativeGainArs: 0,
      cumulativeGainUsd: 0,
      netFlowArs: 0,
      netFlowUsd: 0,
      annualizedReturnArs: null,
      annualizedReturnUsd: null,
      maxDrawdownArs: 0,
      maxDrawdownUsd: 0,
      bestMonthArs: null,
      worstMonthArs: null,
      monthsTracked: 0,
    },
    excludedHoldings: [],
    dataQuality: {
      partialMonths: [],
      missingCclMonths: [],
      lastPriceSyncDate: null,
      impliedNegativeCash: false,
      seriesFloor: null,
    },
  };
}
