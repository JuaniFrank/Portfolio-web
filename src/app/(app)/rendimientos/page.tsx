import { getCurrentUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import prisma from "@/lib/prisma";
import RendimientosChart, { RendimientosData } from "@/components/rendimientos/chart";
import StackedBarChart, { StackedData } from "@/components/rendimientos/stacked-bar-chart";

export const revalidate = 300; // 5 min cache

async function fetchData(portfolioId: string) {
  try {
    const [snapshots, spySnapshots] = await Promise.all([
      prisma.portfolioSnapshot.findMany({
        where: { portfolioId },
        orderBy: [{ date: "asc" }],
      }),
      prisma.sp500Snapshot.findMany({ orderBy: [{ date: "asc" }] }),
    ]);

    // Índice de cierres del S&P 500 por fecha para el join.
    const spyByDate = new Map(
      spySnapshots.map((d) => [d.date.getTime(), Number(d.close)])
    );

    // Línea: valor del portafolio (ARS) vs S&P 500.
    const lineData: RendimientosData[] = snapshots.map((s) => ({
      date: format(s.date, "yyyy-MM-dd"),
      portfolioValue: Number(s.totalValueArs),
      sp500Close: spyByDate.get(s.date.getTime()) ?? null,
    }));

    // Retornos por período: aún no hay modelo en la DB, se deja vacío.
    const stackedData: StackedData[] = [];

    return { lineData, stackedData };
  } catch (e) {
    console.error("Rendimientos data fetch error", e);
    return null;
  }
}

export default async function RendimientosPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <p>Debe iniciar sesión para ver rendimientos.</p>;
  }

  const portfolio = await prisma.portfolio.findFirst({ where: { userId: user.id } });
  if (!portfolio) {
    return <p>No tiene portafolios configurados.</p>;
  }

  const data = await fetchData(portfolio.id);
  if (!data) notFound();

  // Categorías únicas para la barra apilada (excluye la clave del período).
  const categories = Array.from(
    new Set(data.stackedData.flatMap((d) => Object.keys(d).filter((k) => k !== "period")))
  );

  return (
    <div className="container mx-auto">
      <section className="px-4 py-6 sm:px-8">
        <h1 className="mb-6 text-2xl font-semibold">Rendimientos</h1>

        {/* Línea: portafolio & S&P 500 */}
        <div className="mb-10">
          {data.lineData.length === 0 ? (
            <p>Sin datos para comparar.</p>
          ) : (
            <RendimientosChart data={data.lineData} />
          )}
        </div>

        {/* Barra apilada: retornos por período */}
        <div className="mb-4">
          <StackedBarChart
            data={data.stackedData}
            categories={categories}
            title="Retorno por período"
          />
        </div>
      </section>
    </div>
  );
}
