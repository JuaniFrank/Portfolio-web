"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteHoldingAction,
  getHoldingDeletionPreviewAction,
  type HoldingDeletionPreview,
} from "@/app/actions/transactions";
import { ConfirmDeleteDialog } from "@/components/transactions/confirm-delete-dialog";
import { TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";
import type { TransactionType } from "@/lib/generated/prisma";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instrumentId: string;
  ticker: string;
};

/**
 * Confirmation for deleting a whole holding. Loads the per-type count of what
 * will go so the user sees that dividends/coupons/withholdings go too.
 * Mounted only while open, so state starts fresh on every opening.
 */
export function DeleteHoldingDialog({ open, onOpenChange, instrumentId, ticker }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState<HoldingDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getHoldingDeletionPreviewAction(instrumentId).then((result) => {
      if (cancelled) return;
      if (result.ok) setPreview(result.preview);
      else setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, instrumentId]);

  const entries = preview
    ? (Object.entries(preview.countsByType) as [TransactionType, number][])
    : [];

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Borrar posición ${ticker}`}
      confirmLabel={preview ? `Borrar ${preview.total}` : "Borrar posición"}
      onConfirm={async () => {
        if (!preview) return { ok: false, error: "Todavía se están cargando los datos" };
        return deleteHoldingAction(instrumentId);
      }}
      onDeleted={() => {
        toast.success(`Se borró la posición ${ticker}`);
        router.refresh();
      }}
    >
      {loadError ? (
        <p className="text-red-400">{loadError}</p>
      ) : !preview ? (
        <p>Calculando qué se va a borrar…</p>
      ) : (
        <>
          <p>
            Se van a borrar {preview.total}{" "}
            {preview.total === 1 ? "movimiento" : "movimientos"} de{" "}
            <span className="font-semibold text-zinc-200">{ticker}</span>:
          </p>
          <ul className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
            {entries.map(([type, count]) => (
              <li key={type} className="flex justify-between font-mono">
                <span>{TRANSACTION_TYPE_LABELS[type]}</span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
          <p>Se van a recalcular tus posiciones, dividendos y el dashboard.</p>
          <p className="text-xs text-zinc-500">
            El instrumento y sus precios se conservan: solo se borran tus movimientos.
          </p>
        </>
      )}
    </ConfirmDeleteDialog>
  );
}
