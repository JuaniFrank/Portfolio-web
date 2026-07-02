"use client";

import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BondsPageData } from "@/lib/bonds/types";
import { BondKpiCards } from "./bond-kpis";
import { BondHoldingsTable } from "./bond-holdings-table";
import { BondCashflowTable } from "./bond-cashflow-table";

type Props = {
  data: BondsPageData;
};

export function BondsPage({ data }: Props) {
  const [tab, setTab] = useState("holdings");

  const cclMissing = !data.cclMid;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
          Obligaciones Negociables
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
          Tenencias, valuación a mercado y flujos recibidos de tus ONs. Los precios provienen
          de <span className="text-zinc-300">data912.com</span> (BYMA, ARS por 100 VN nominal).
          USD es el valor primario; ARS se muestra como referencia.
        </p>
      </div>

      {cclMissing ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            No pudimos obtener la cotización CCL actual desde{" "}
            <code className="rounded bg-amber-950/40 px-1">dolarapi.com</code>. Los valores en
            USD no están disponibles. Los importes en ARS siguen siendo correctos.
          </div>
        </div>
      ) : null}

      {data.anyPriceStale ? (
        <div className="flex items-start gap-3 rounded-md border border-zinc-700/50 bg-zinc-900/40 p-3 text-xs text-zinc-300">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            Los precios mostrados provienen de la caché local (data912 no respondió). Pueden no
            reflejar el valor actual de mercado.
          </div>
        </div>
      ) : null}

      <BondKpiCards
        kpis={data.kpis}
        cclMid={data.cclMid}
        holdingsCount={data.holdings.length}
        flowsCount={data.flows.length}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
          <TabsTrigger
            value="holdings"
            className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Tenencias
          </TabsTrigger>
          <TabsTrigger
            value="flows"
            className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Flujos recibidos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="holdings" className="mt-4">
          <BondHoldingsTable holdings={data.holdings} />
        </TabsContent>
        <TabsContent value="flows" className="mt-4">
          <BondCashflowTable flows={data.flows} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
