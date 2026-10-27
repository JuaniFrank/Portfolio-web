"use client";

import { useState } from "react";
import { BellPlus } from "lucide-react";
import { TargetForm } from "@/components/alerts/target-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Botón chico para crear un objetivo desde una venta realizada. Viene con el precio del
 * día de la venta y la dirección "por debajo de" (señal de re-entrada), editables.
 */
export function CreateTargetDialog({
  instrumentId,
  ticker,
  basis,
  defaultPrice,
}: {
  instrumentId: string;
  ticker: string;
  basis: "USD" | "ARS";
  /** Cierre original del día de la venta, si se pudo medir. */
  defaultPrice: number | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title={`Crear un objetivo de precio para ${ticker}`}
          aria-label={`Crear un objetivo de precio para ${ticker}`}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-teal-400"
        >
          <BellPlus className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Objetivo de precio: {ticker}</DialogTitle>
          <DialogDescription>
            Se mide contra la acción original en {basis}
            {basis === "USD" ? " (CEDEAR: su mercado de origen)" : ""}. Podés verlo y editarlo en Alertas.
          </DialogDescription>
        </DialogHeader>
        <TargetForm
          instrument={{ id: instrumentId, label: ticker }}
          currencyHint={basis}
          initial={{
            targetPrice: defaultPrice === null ? undefined : Math.round(defaultPrice * 100) / 100,
            direction: "BELOW",
          }}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
