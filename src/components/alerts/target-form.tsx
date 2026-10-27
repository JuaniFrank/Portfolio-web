"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createPriceTargetAction, updatePriceTargetAction } from "@/app/actions/price-targets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NOTE_MAX_LENGTH } from "@/lib/alerts/validation";
import type { AlertDirection } from "@/lib/alerts/types";

/** `currency` es la base de comparación del instrumento (solo informativa en el formulario). */
export type InstrumentOption = { id: string; label: string; currency?: string };

const selectClass =
  "flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/**
 * Alta o edición de un objetivo. Con `targetId` edita; sin él crea. El instrumento viene
 * fijo (`instrument`) o se elige de `instruments`. La moneda no se pide: la deduce el
 * servidor del tipo de instrumento.
 */
export function TargetForm({
  targetId,
  instrument,
  instruments,
  initial,
  currencyHint,
  onDone,
}: {
  targetId?: string;
  instrument?: InstrumentOption;
  instruments?: InstrumentOption[];
  initial?: { targetPrice?: number; direction?: AlertDirection; note?: string | null };
  /** Moneda del instrumento fijo, solo informativa. */
  currencyHint?: string;
  onDone?: () => void;
}) {
  const [instrumentId, setInstrumentId] = useState(instrument?.id ?? instruments?.[0]?.id ?? "");
  const [price, setPrice] = useState(initial?.targetPrice === undefined ? "" : String(initial.targetPrice));
  const [direction, setDirection] = useState<AlertDirection>(initial?.direction ?? "BELOW");
  const [note, setNote] = useState(initial?.note ?? "");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = targetId
        ? await updatePriceTargetAction({ id: targetId, targetPrice: price, direction, note })
        : await createPriceTargetAction({ instrumentId, targetPrice: price, direction, note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(targetId ? "Objetivo actualizado" : "Objetivo creado");
      if (!targetId) setPrice("");
      onDone?.();
    });
  }

  // Con un instrumento elegido de la lista, la moneda sale de su opción; si no, del hint fijo.
  const selectedCurrency = instruments?.find((option) => option.id === instrumentId)?.currency;
  const shownCurrency = targetId || instrument ? currencyHint : (selectedCurrency ?? currencyHint);

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      {!targetId ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="target-instrument">Instrumento</Label>
          {instrument ? (
            <p className="text-sm font-medium text-zinc-200">{instrument.label}</p>
          ) : (
            <select
              id="target-instrument"
              className={selectClass}
              value={instrumentId}
              onChange={(event) => setInstrumentId(event.target.value)}
              required
            >
              {(instruments ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="target-direction">Avisarme cuando el precio esté</Label>
        <select
          id="target-direction"
          className={selectClass}
          value={direction}
          onChange={(event) => setDirection(event.target.value as AlertDirection)}
        >
          <option value="BELOW">por debajo de (≤)</option>
          <option value="ABOVE">por encima de (≥)</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="target-price">Precio objetivo{shownCurrency ? ` (${shownCurrency})` : ""}</Label>
        <Input
          id="target-price"
          inputMode="decimal"
          autoComplete="off"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder="0,00"
          required
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="target-note">Nota (opcional)</Label>
        <Input
          id="target-note"
          value={note}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Por ejemplo: re-entrada si vuelve a este nivel"
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending || (!targetId && instrumentId === "")}>
          {pending ? "Guardando…" : targetId ? "Guardar cambios" : "Crear objetivo"}
        </Button>
      </div>
    </form>
  );
}
