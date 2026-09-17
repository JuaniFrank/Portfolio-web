"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ImportContextData } from "@/app/actions/imports";
import { ImportWizard } from "@/components/imports/import-wizard";
import { Button } from "@/components/ui/button";

type NewImportPageClientProps = {
  context: ImportContextData;
};

export function NewImportPageClient({ context }: NewImportPageClientProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Nuevo import</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
            Importá y conciliá movimientos desde extractos de tu broker con limpieza automática inteligente.
          </p>
        </div>

        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href="/imports">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Volver a transacciones
          </Link>
        </Button>
      </div>

      <ImportWizard context={context} />
    </div>
  );
}
