"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Factory,
  Globe2,
  PieChart as PieChartIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardData } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { AllocationDonut } from "./allocation-donut";
import { ChartCard } from "./chart-card";
import { ConcentrationCard } from "./concentration-card";
import { DashboardKpiCards } from "./dashboard-kpis";
import { MARKET_COLORS, type ViewCurrency } from "./format";
import { SectorBars } from "./sector-bars";
import { TopMovers } from "./top-movers";
import { ValueByTickerBars } from "./value-bars";

type Props = {
  data: DashboardData;
};

export function DashboardPage({ data }: Props) {
  const [currency, setCurrency] = useState<ViewCurrency>("ARS");
  const cclMissing = !data.cclRate;

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

      {cclMissing ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            No hay cotización CCL cargada. Las métricas en USD aparecen en cero. Importá o
            registrá un <code className="rounded bg-amber-950/40 px-1">FxRate</code> USD/ARS
            para habilitar la vista en dólares.
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <SectionTitle
          title="Vista Detallada"
          description="Snapshot rápido de la salud actual de tus inversiones."
        />
        <DashboardKpiCards kpis={data.kpis} />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionTitle
          title="Análisis Gráfico"
          description="Distribución y composición visual del portfolio."
        />
        <CurrencyToggle value={currency} onChange={setCurrency} disabledUsd={cclMissing} />
      </div>

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
        <SectorBars data={data.allocationBySector} currency={currency} />
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
            gainers={data.topGainers}
            losers={data.topLosers}
            currency={currency}
          />
          <ConcentrationCard stats={data.concentration} />
        </div>
      </section>
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
