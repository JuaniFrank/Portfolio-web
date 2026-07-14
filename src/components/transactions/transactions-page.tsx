"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { HoldingsTable } from "@/components/transactions/holdings-table";
import { TradeHistoryTable } from "@/components/transactions/trade-history-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TransactionsPageData } from "@/lib/transactions/types";
import { cn } from "@/lib/utils";

type TransactionsPageProps = {
  data: TransactionsPageData;
};

function formatMoney(value: string) {
  const n = Number(value);
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

export function TransactionsPage({ data }: TransactionsPageProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("resumen");

  const pnl = Number(data.summary.totalPnlArs);
  const pnlPositive = pnl >= 0;

  const totalValueUsd = useMemo(() => {
    if (!data.summary.cclRate) return null;
    const ccl = Number(data.summary.cclRate);
    if (ccl <= 0) return null;
    return (Number(data.summary.totalValueArs) / ccl).toFixed(2);
  }, [data.summary]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader />
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/transactions/new">
            <Plus className="mr-2 h-4 w-4" />
            Nueva operación
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Valor actual (ARS)"
          value={formatMoney(data.summary.totalValueArs)}
          sub={
            data.holdings.length > 0 ? (
              <span className={cn("text-sm", pnlPositive ? "text-emerald-400" : "text-red-400")}>
                {pnlPositive ? "+" : ""}
                {Number(data.summary.totalPnlPercent).toLocaleString("es-AR", {
                  maximumFractionDigits: 2,
                })}
                %
              </span>
            ) : null
          }
        />
        <SummaryCard
          label="Valor actual (USD)"
          value={
            totalValueUsd
              ? Number(totalValueUsd).toLocaleString("es-AR", {
                  style: "currency",
                  currency: "USD",
                })
              : "—"
          }
          muted={!totalValueUsd}
        />
        <SummaryCard
          label="CCL (USD/ARS)"
          value={
            data.summary.cclRate
              ? Number(data.summary.cclRate).toLocaleString("es-AR", {
                  style: "currency",
                  currency: "ARS",
                })
              : "—"
          }
          highlight
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
          <TabsTrigger
            value="resumen"
            className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Resumen
          </TabsTrigger>
          <TabsTrigger
            value="historial"
            className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Historial
          </TabsTrigger>
        </TabsList>

        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder={
              tab === "historial"
                ? "Buscar por ticker, fecha, precio, cantidad, tipo, etiquetas…"
                : "Buscar por ticker…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <TabsContent value="resumen" className="mt-4">
          <HoldingsTable holdings={data.holdings} search={search} />
        </TabsContent>

        <TabsContent value="historial" className="mt-4">
          <TradeHistoryTable trades={data.trades} search={search} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Transacciones</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        Resumen de posiciones y historial de compras y ventas en acciones, CEDEARs y ONs.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  muted,
  highlight,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          highlight && "text-amber-400",
          muted && "text-zinc-500",
          !highlight && !muted && "text-zinc-50"
        )}
      >
        {value}
      </p>
      {sub ? <div className="mt-1">{sub}</div> : null}
    </div>
  );
}
