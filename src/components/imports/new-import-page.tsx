"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import type { ImportContextData } from "@/app/actions/imports";
import { ImportModal } from "@/components/imports/import-modal";
import { Button } from "@/components/ui/button";

type NewImportPageClientProps = {
  context: ImportContextData;
};

export function NewImportPageClient({ context }: NewImportPageClientProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Nuevo import</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
          Importá movimientos desde un archivo .xlsx exportado por tu broker. Por ahora está
          disponible Balanz; Cocos Capital e InvertirOnline se agregarán próximamente.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
      <Button type="button" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Importar movimientos
      </Button>
      <Button type="button" variant="outline" asChild>
        <Link href="/imports">Ver historial</Link>
      </Button>
      </div>

      <ImportModal open={open} onOpenChange={setOpen} context={context} />
    </div>
  );
}
