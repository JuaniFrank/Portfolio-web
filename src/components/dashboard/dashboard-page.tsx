"use client";

import { useMemo, useState } from "react";
import { BarChart3, Building2, Factory, Globe2, PieChart as PieChartIcon, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildDashboardNotices } from "@/lib/dashboard/dashboard-notices";
import { buildPeriodKpis } from "@/lib/dashboard/period-kpis";
import type { TimeRange } from "@/lib/dashboard/time-range";
import type { DashboardData } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { AllocationDonut } from "./allocation-donut";
import { ChartCard } from "./chart-card";
import { ConcentrationCard } from "./concentration-card";
import { DashboardKpiCards } from "./dashboard-kpis";
import { DayMovers } from "./day-movers";
import { MARKET_COLORS, type ViewCurrency } from "./format";
import { NoticesPanel } from "./notices-panel";
import { PeriodKpisPanel } from "./period-kpis-panel";
import { PortfolioEvolutionChart } from "./portfolio-evolution";
import { SectorBars } from "./sector-bars";
import { TopMovers } from "./top-movers";
import { ValueByTickerBars } from "./value-bars";

type Props = {
  data: DashboardData;
};

/** El gráfico de evolución arranca en 3M en el dashboard: acá se mira el corto plazo,
 * el histórico completo es cosa de `/rendimientos`. */
const EVOLUTION_INITIAL_RANGE: TimeRange = { preset: "3M", from: null, to: null };

type DashboardTab = "hoy" | "composicion";

export function DashboardPage({ data }: Props) {
  const [currency, setCurrency] = useState<ViewCurrency>("ARS");
  // Estado local, no en la URL: no hay ningún patrón de `useSearchParams` en el resto
  // del repo (solo `useRouter`/`usePathname`), y esta pestaña no se comparte ni se
  // deep-linkea — persistirla en la query hubiera sido una capa nueva para un
  // beneficio marginal. Mismo criterio que ya usa el toggle de moneda de al lado.
  const [tab, setTab] = useState<DashboardTab>("hoy");
  const cclMissing = !data.cclRate;
  const lastPoint = data.evolution.series.daily.at(-1) ?? null;

  const periodKpis = useMemo(
    () => buildPeriodKpis(data.evolution.series.daily, data.evolution.instruments, currency),
    [data.evolution.series.daily, data.evolution.instruments, currency]
  );

  const notices = useMemo(
    () =>
      buildDashboardNotices({
        cclMissing,
        lastPoint,
        concentration: data.concentration,
      }),
    [cclMissing, lastPoint, data.concentration]
  );

  if (!data.hasData) {
    return (
      <div className="space-y-6">
        <Header portfolioName={data.portfolioName} />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header portfolioName={data.portfolioName} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(value) => setTab(value as DashboardTab)}>
          <TabsList>
            <TabsTrigger value="hoy">Hoy</TabsTrigger>
            <TabsTrigger value="composicion">Composición</TabsTrigger>
          </TabsList>
        </Tabs>
        <CurrencyToggle value={currency} onChange={setCurrency} disabledUsd={cclMissing} />
      </div>

      {tab === "hoy" ? (
        <div className="space-y-6">
          <NoticesPanel notices={notices} />

          <section className="space-y-3">
            <SectionTitle
              title="¿Qué pasó hoy?"
              description="Resultado de corto plazo: hoy, últimos 7 y 30 días, y en lo que va del año."
            />
            <PeriodKpisPanel kpis={periodKpis} currency={currency} />
          </section>

          <section className="space-y-3">
            <SectionTitle
              title="Vista Detallada"
              description="Snapshot rápido de la salud actual de tus inversiones."
            />
            <DashboardKpiCards kpis={data.kpis} />
          </section>

          <ChartCard
            title="Evolución del Portfolio"
            description="Valor reconstruido cierre a cierre. Pasá el mouse por un punto para ver qué posiciones lo movieron."
            icon={<TrendingUp className="h-4 w-4" />}
          >
            <PortfolioEvolutionChart
              evolution={data.evolution}
              currency={currency}
              initialRange={EVOLUTION_INITIAL_RANGE}
            />
          </ChartCard>

          <DayMovers
            gainers={lastPoint?.gainers ?? []}
            losers={lastPoint?.losers ?? []}
            currency={currency}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Resumen de Portfolio"
              description="Distribución general de tus inversiones por instrumento."
              icon={<PieChartIcon className="h-4 w-4" />}
            >
              <AllocationDonut
                data={data.allocationByTicker}
                currency={currency}
                topN={12}
                centerSubtitle={`${data.kpis.totalInstruments} instrumentos`}
                colorMap={{ ON: "#6366f1" }}
              />
            </ChartCard>

            <ChartCard
              title="Distribución por Mercado"
              description="Exposición por tipo de mercado financiero."
              icon={<Globe2 className="h-4 w-4" />}
            >
              <AllocationDonut
                data={data.allocationByMarket}
                currency={currency}
                colorMap={MARKET_COLORS}
                labelPosition="below"
                centerSubtitle="por mercado"
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Distribución por Sector"
            description="Diversificación sectorial de tu portfolio."
            icon={<Factory className="h-4 w-4" />}
          >
            <SectorBars data={data.allocationBySector} currency={currency} holdings={data.holdings} />
          </ChartCard>

          <ChartCard
            title="Valor por Acción"
            description="Comparación del valor monetario de cada instrumento."
            icon={<BarChart3 className="h-4 w-4" />}
          >
            <ValueByTickerBars holdings={data.holdings} currency={currency} />
          </ChartCard>

          <section className="space-y-3">
            <SectionTitle
              title="Salud del Portfolio"
              description="Quiénes empujan y qué tan diversificado estás."
              icon={<Building2 className="h-4 w-4" />}
            />
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <TopMovers
                gainers={currency === "ARS" ? data.topGainers : data.topGainersUsd}
                losers={currency === "ARS" ? data.topLosers : data.topLosersUsd}
                currency={currency}
              />
              <ConcentrationCard stats={data.concentration} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Header({ portfolioName }: { portfolioName: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Dashboard</h1>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
          {portfolioName}
        </span>
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        Resumen visual de cómo está parado tu portfolio: tamaño, distribución, ganadores,
        perdedores y nivel de concentración.
      </p>
    </div>
  );
}

function SectionTitle({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
        {icon ? <span className="text-teal-400">{icon}</span> : null}
        {title}
      </h2>
      {description ? <p className="text-xs text-zinc-500">{description}</p> : null}
    </div>
  );
}

function CurrencyToggle({
  value,
  onChange,
  disabledUsd,
}: {
  value: ViewCurrency;
  onChange: (c: ViewCurrency) => void;
  disabledUsd?: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-md border border-zinc-800 bg-zinc-900/60 p-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange("ARS")}
        className={cn(
          "h-8 px-3 text-xs",
          value === "ARS"
            ? "bg-teal-500/20 text-teal-300 hover:bg-teal-500/20"
            : "text-zinc-400 hover:text-zinc-100"
        )}
      >
        ARS
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabledUsd}
        onClick={() => onChange("USD")}
        className={cn(
          "h-8 px-3 text-xs",
          value === "USD"
            ? "bg-teal-500/20 text-teal-300 hover:bg-teal-500/20"
            : "text-zinc-400 hover:text-zinc-100"
        )}
      >
        USD
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
      <p className="text-base font-medium text-zinc-200">Tu portfolio aún no tiene posiciones</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
        Importá tus movimientos desde el broker o registrá una operación manualmente para
        empezar a ver gráficos y métricas acá.
      </p>
    </div>
  );
}
