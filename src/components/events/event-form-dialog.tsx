"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { previewCorporateEvent, createCorporateEvent } from "@/app/actions/events";
import { newEventInputSchema, type NewEventInput } from "@/lib/events/validations";
import type { ProjectedPosition, CorporateEventDTO } from "@/lib/events/types";
import { CorporateEventType } from "@/lib/generated/prisma";
import { formatEventTypeLabel } from "./format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InstrumentOption = {
  id: string;
  ticker: string;
  name: string;
};

type Props = {
  instruments: InstrumentOption[];
  onCreated: (event: CorporateEventDTO) => void;
};

type Step = "form" | "preview";

export function EventFormDialog({ instruments, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{
    current: ProjectedPosition | null;
    projected: ProjectedPosition;
  } | null>(null);
  const [savedInput, setSavedInput] = useState<NewEventInput | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<NewEventInput>({
    resolver: zodResolver(newEventInputSchema),
    defaultValues: {
      effectiveDate: today,
      numerator: "1",
      denominator: "1",
    },
  });

  function handleOpen() {
    reset({ effectiveDate: today, numerator: "1", denominator: "1" });
    setStep("form");
    setPreview(null);
    setSavedInput(null);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
  }

  async function onFormSubmit(data: NewEventInput) {
    setPending(true);
    try {
      const result = await previewCorporateEvent(data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSavedInput(data);
      setPreview({ current: result.current, projected: result.projected });
      setStep("preview");
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm() {
    if (!savedInput) return;
    setPending(true);
    try {
      const result = await createCorporateEvent(savedInput);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Evento registrado");
      handleClose();
      onCreated(result.event);
    } finally {
      setPending(false);
    }
  }

  function handleBack() {
    setStep("form");
  }

  const eventTypes = Object.values(CorporateEventType);

  return (
    <>
      <Button onClick={handleOpen}>
        <Plus className="h-4 w-4" />
        Registrar evento
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          {step === "form" && (
            <form onSubmit={handleSubmit(onFormSubmit)}>
              <DialogHeader>
                <DialogTitle>Registrar evento corporativo</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                {/* Instrument */}
                <div className="space-y-1.5">
                  <Label htmlFor="instrumentId">Instrumento</Label>
                  <Select
                    onValueChange={(v) => setValue("instrumentId", v)}
                    defaultValue=""
                  >
                    <SelectTrigger id="instrumentId">
                      <SelectValue placeholder="Seleccionar instrumento…" />
                    </SelectTrigger>
                    <SelectContent>
                      {instruments.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.ticker} — {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.instrumentId && (
                    <p className="text-xs text-rose-400">{errors.instrumentId.message}</p>
                  )}
                </div>

                {/* Event type */}
                <div className="space-y-1.5">
                  <Label htmlFor="eventType">Tipo</Label>
                  <Select onValueChange={(v) => setValue("eventType", v as CorporateEventType)}>
                    <SelectTrigger id="eventType">
                      <SelectValue placeholder="Seleccionar tipo…" />
                    </SelectTrigger>
                    <SelectContent>
                      {eventTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {formatEventTypeLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.eventType && (
                    <p className="text-xs text-rose-400">{errors.eventType.message}</p>
                  )}
                </div>

                {/* Effective date */}
                <div className="space-y-1.5">
                  <Label htmlFor="effectiveDate">Fecha efectiva</Label>
                  <Input
                    id="effectiveDate"
                    type="date"
                    {...register("effectiveDate")}
                  />
                  {errors.effectiveDate && (
                    <p className="text-xs text-rose-400">{errors.effectiveDate.message}</p>
                  )}
                </div>

                {/* Numerator + Denominator */}
                <div className="space-y-1.5">
                  <Label>Ratio</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="numerator"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Numerador"
                      {...register("numerator")}
                      className="w-full"
                    />
                    <span className="text-zinc-400">:</span>
                    <Input
                      id="denominator"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Denominador"
                      {...register("denominator")}
                      className="w-full"
                    />
                  </div>
                  {(errors.numerator || errors.denominator) && (
                    <p className="text-xs text-rose-400">
                      {errors.numerator?.message ?? errors.denominator?.message}
                    </p>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notas (opcional)</Label>
                  <textarea
                    id="notes"
                    rows={2}
                    maxLength={500}
                    {...register("notes")}
                    className="flex w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Calculando…" : "Vista previa"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {step === "preview" && preview && savedInput && (
            <>
              <DialogHeader>
                <DialogTitle>Vista previa del evento</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                <p className="text-sm text-zinc-400">
                  {formatEventTypeLabel(savedInput.eventType)} —{" "}
                  {preview.projected.ticker} —{" "}
                  <span className="font-mono">{savedInput.effectiveDate}</span>
                </p>

                <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-800 p-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Actual
                    </p>
                    {preview.current ? (
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-zinc-400">Cantidad</dt>
                          <dd className="font-mono text-zinc-100">{preview.current.quantity}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-zinc-400">PPP ARS</dt>
                          <dd className="font-mono text-zinc-100">{preview.current.avgPriceArs}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">—</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Proyectado
                    </p>
                    <dl className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-zinc-400">Cantidad</dt>
                        <dd className="font-mono text-zinc-100">{preview.projected.quantity}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-400">PPP ARS</dt>
                        <dd className="font-mono text-zinc-100">{preview.projected.avgPriceArs}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <p className="text-center text-xs text-zinc-500">
                  Costo total en ARS se mantiene invariante
                </p>
              </div>

              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={handleBack} disabled={pending}>
                  Atrás
                </Button>
                <Button onClick={handleConfirm} disabled={pending}>
                  {pending ? "Guardando…" : "Confirmar"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
