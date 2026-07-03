"use client";

import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BondsPageDataV2, BondHoldingV2 } from "@/lib/bonds/types";
import { BondKpiCards } from "./bond-kpis";
import { BondHoldingsTable } from "./bond-holdings-table";
import { BondCashflowTable } from "./bond-cashflow-table";
import { BondAnalyticsCard } from "./bond-analytics";
import { BondProjectionTable } from "./bond-projection-table";
import { BondTermsForm } from "./bond-terms-form";
import { getBondTermsAction } from "@/app/actions/bond-terms";
import type { BondTerms } from "@/lib/generated/prisma";

type Props = {
  data: BondsPageDataV2;
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
          <TabsTrigger
            value="analytics"
            className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Analítica v2
          </TabsTrigger>
        </TabsList>

        <TabsContent value="holdings" className="mt-4">
          <BondHoldingsTable holdings={data.holdings} />
        </TabsContent>

        <TabsContent value="flows" className="mt-4">
          <BondCashflowTable flows={data.flows} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-8">
          {data.holdings.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
              <p className="text-sm text-zinc-400">No hay posiciones activas.</p>
            </div>
          ) : (
            data.holdings.map((holding) => (
              <HoldingAnalyticsSection key={holding.ticker} holding={holding} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-holding analytics + projection section
// ---------------------------------------------------------------------------

function HoldingAnalyticsSection({ holding }: { holding: BondHoldingV2 }) {
  const [showForm, setShowForm] = useState(false);
  const [localTerms, setLocalTerms] = useState<BondTerms | null>(null);
  // Loaded on-demand when the user clicks "Edit terms" for a holding that already has terms.
  const [loadedTerms, setLoadedTerms] = useState<BondTerms | null>(null);
  const [loadingTerms, setLoadingTerms] = useState(false);

  const effectiveHasTerms = holding.hasTerms || !!localTerms;

  async function handleToggleForm() {
    if (showForm) {
      setShowForm(false);
      return;
    }
    // When editing existing terms, fetch them first so the form is pre-populated
    // and the user cannot accidentally overwrite stored data with blank defaults.
    if (effectiveHasTerms && !loadedTerms) {
      setLoadingTerms(true);
      try {
        const result = await getBondTermsAction(holding.instrumentId);
        if (result.success && result.data) {
          setLoadedTerms(result.data);
        }
      } finally {
        setLoadingTerms(false);
      }
    }
    setShowForm(true);
  }

  function handleTermsSaved(terms: BondTerms) {
    setLocalTerms(terms);
    setLoadedTerms(terms);
    setShowForm(false);
  }

  // Resolve which terms to pass: freshly loaded > previously saved local > none
  const initialTermsForForm = loadedTerms ?? localTerms ?? undefined;

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-zinc-100">{holding.ticker}</h3>
        <button
          onClick={() => void handleToggleForm()}
          disabled={loadingTerms}
          className="text-xs text-zinc-400 hover:text-teal-400 underline underline-offset-2 disabled:opacity-50"
        >
          {loadingTerms ? "Cargando…" : showForm ? "Cancelar" : effectiveHasTerms ? "Editar términos" : "Cargar términos"}
        </button>
      </div>

      {showForm ? (
        <BondTermsForm
          instrumentId={holding.instrumentId}
          ticker={holding.ticker}
          initialTerms={initialTermsForForm}
          onSaved={handleTermsSaved}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <>
          <BondAnalyticsCard
            analytics={holding.analytics}
            ticker={holding.ticker}
            onEnterTerms={() => setShowForm(true)}
          />

          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Flujos proyectados
            </h4>
            <BondProjectionTable
              flows={holding.projectedFlows}
              currencyCode="USD"
              ticker={holding.ticker}
              hasTerms={effectiveHasTerms}
              onEnterTerms={() => setShowForm(true)}
            />
          </div>
        </>
      )}
    </div>
  );
}
