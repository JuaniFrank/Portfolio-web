"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { deleteImportedTransactionsAction } from "@/app/actions/imports";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids de las transacciones importadas a borrar. */
  ids: string[];
  /** Vista previa opcional de lo que se está por borrar. */
  preview?: string[];
  onDeleted: (ids: string[]) => void;
};

/**
 * Confirmación de borrado masivo de movimientos importados.
 *
 * El borrado es definitivo y recalcula las posiciones de toda la app, así que
 * el diálogo enumera las consecuencias en vez de un "¿estás seguro?" genérico.
 */
export function DeleteTransactionsDialog({
  open,
  onOpenChange,
  ids,
  preview,
  onDeleted,
}: Props) {
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    try {
      const result = await deleteImportedTransactionsAction(ids);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.deleted === 1
          ? "Se borró 1 movimiento"
          : `Se borraron ${result.deleted} movimientos`
      );
      onDeleted(ids);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  const count = ids.length;

  return (
    <Dialog open={open} onOpenChange={pending ? () => {} : onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            Borrar {count} {count === 1 ? "movimiento" : "movimientos"}
          </DialogTitle>
          <DialogDescription>
            Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-zinc-400">
          <p>Se van a recalcular tus posiciones, dividendos y el dashboard.</p>

          {preview && preview.length > 0 && (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
              <ul className="space-y-1 text-xs text-zinc-400">
                {preview.slice(0, 5).map((line, i) => (
                  <li key={i} className="truncate font-mono">
                    · {line}
                  </li>
                ))}
              </ul>
              {preview.length > 5 && (
                <p className="mt-2 text-xs text-zinc-600">
                  …y {preview.length - 5} más
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-zinc-500">
            Podés volver a importar el archivo cuando quieras: el borrado también libera el
            control de duplicados de esas filas.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={pending}
          >
            {pending ? "Borrando…" : `Borrar ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
