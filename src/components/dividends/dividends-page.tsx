"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { DividendsPageData } from "@/lib/dividends/types";
import { cn } from "@/lib/utils";
import { DividendCalendar } from "./dividend-calendar";
import { DividendCharts } from "./dividend-charts";
import {
  DividendByTickerTable,
  DividendHistoryTable,
} from "./dividend-detail-table";
import { DividendKpiCards } from "./dividend-kpis";
import type { ViewCurrency } from "./format";

type Props = {
  data: DividendsPageData;
};

export function DividendsPage({ data }: Props) {
  const [currency, setCurrency] = useState<ViewCurrency>("ARS");
  const [tab, setTab] = useState("calendario");

  const cclMissing = !data.cclRate;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Dividendos</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
            Lo que cobraste, lo que estimamos que vas a cobrar y cuánto se fue en retenciones.
            Las fechas marcadas como <span className="text-violet-300">estimadas</span> son
            aproximadas según la frecuencia histórica de cada empresa.
          </p>
        </div>
        <CurrencyToggle value={currency} onChange={setCurrency} disabledUsd={cclMissing} />
      </div>

      {cclMissing ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            No hay cotización CCL cargada. Los totales en USD se muestran en cero. Importá o
            registrá un <code className="rounded bg-amber-950/40 px-1">FxRate</code> USD/ARS
            para habilitar la vista en dólares.
          </div>
        </div>
      ) : null}

      <DividendKpiCards kpis={data.kpis} currency={currency} />

      <DividendCalendar months={data.calendar} currency={currency} />

      <DividendCharts byMonth={data.byMonth} byTicker={data.byTicker} currency={currency} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
          <TabsTrigger
            value="calendario"
            className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Por ticker
          </TabsTrigger>
          <TabsTrigger
            value="historial"
            className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Historial de pagos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="calendario" className="mt-4">
          <DividendByTickerTable rows={data.byTicker} currency={currency} />
        </TabsContent>
        <TabsContent value="historial" className="mt-4">
          <DividendHistoryTable rows={data.received} />
        </TabsContent>
      </Tabs>

      {data.yahooErrors.length > 0 ? (
        <details className="rounded-md border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-400">
          <summary className="cursor-pointer text-zinc-500">
            {data.yahooErrors.length} ticker(s) sin estimación disponible
          </summary>
          <ul className="mt-2 space-y-1 text-zinc-500">
            {data.yahooErrors.map((e, i) => (
              <li key={i} className="font-mono">
                · {e}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
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
          value === "ARS" ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
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
          value === "USD" ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
        )}
      >
        USD
      </Button>
    </div>
  );
}
