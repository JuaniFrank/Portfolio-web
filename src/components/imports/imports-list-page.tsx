"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { ImportedTransactionsTable } from "@/components/imports/imported-transactions-table";
import { Button } from "@/components/ui/button";
import type { ImportedTransactionRow } from "@/lib/imports/filters";

type ImportsListPageProps = {
  transactions: ImportedTransactionRow[];
};

export function ImportsListPage({ transactions }: ImportsListPageProps) {
  return <ImportsListPageInner transactions={transactions} />;
}

function ImportsListPageInner({ transactions }: ImportsListPageProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Imports</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
            Movimientos importados desde extractos de brokers. Filtrá por tipo de instrumento o
            operación.
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/imports/new">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo import
          </Link>
        </Button>
      </div>

      <ImportedTransactionsTable transactions={transactions} />
    </div>
  );
}
