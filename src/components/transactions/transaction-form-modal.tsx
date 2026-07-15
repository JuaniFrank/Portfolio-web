"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createTransactionAction,
  searchInstrumentsAction,
  type TransactionInstrumentOption,
} from "@/app/actions/transactions";
import {
  newTransactionInputSchema,
  TRANSACTION_CURRENCIES,
  type NewTransactionInput,
} from "@/lib/transactions/validations";
import { InstrumentType } from "@/lib/generated/prisma";
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

/**
 * Instrument types offered for manual entry. Kept in sync with
 * TRADE_INSTRUMENT_TYPES — anything outside this set is filtered out of the
 * transactions page, so offering it would silently "lose" the operation.
 */
const INSTRUMENT_TYPE_OPTIONS: { value: InstrumentType; label: string }[] = [
  { value: InstrumentType.CEDEAR, label: "CEDEAR" },
  { value: InstrumentType.STOCK_AR, label: "Acción argentina" },
  { value: InstrumentType.ON, label: "Obligación negociable" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(value: number, currency: string) {
  return value.toLocaleString("es-AR", { style: "currency", currency });
}

export function NewTransactionDialog() {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [instruments, setInstruments] = useState<TransactionInstrumentOption[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<NewTransactionInput>({
    resolver: zodResolver(newTransactionInputSchema),
    defaultValues: {
      ticker: "",
      side: "BUY",
      currencyCode: "ARS",
      tradeDate: todayIso(),
      quantity: "",
      price: "",
      fees: "0",
      taxes: "0",
    },
  });

  const side = watch("side");
  const currencyCode = watch("currencyCode");
  const tickerValue = watch("ticker");
  const quantity = Number(watch("quantity"));
  const price = Number(watch("price"));
  const fees = Number(watch("fees") || 0);
  const taxes = Number(watch("taxes") || 0);

  // Debounced catalog search as the user types the ticker. On an exact match we
  // prefill the instrument type and currency — still fully overridable.
  useEffect(() => {
    if (!open) return;
    const q = (tickerValue ?? "").trim();
    if (q.length < 1) {
      setInstruments([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchInstrumentsAction(q);
      setInstruments(results);
      const exact = results.find((i) => i.ticker.toUpperCase() === q.toUpperCase());
      if (exact) {
        setValue("instrumentType", exact.type, { shouldValidate: true });
        if (exact.currencyCode === "ARS" || exact.currencyCode === "USD") {
          setValue("currencyCode", exact.currencyCode, { shouldValidate: true });
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [tickerValue, open, setValue]);

  const total = useMemo(() => {
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return null;
    const gross = quantity * price;
    if (gross <= 0) return null;
    const costs = (Number.isFinite(fees) ? fees : 0) + (Number.isFinite(taxes) ? taxes : 0);
    return side === "BUY" ? gross + costs : gross - costs;
  }, [quantity, price, fees, taxes, side]);

  function handleOpenChange(next: boolean) {
    if (next) {
      reset({
        ticker: "",
        side: "BUY",
        currencyCode: "ARS",
        tradeDate: todayIso(),
        quantity: "",
        price: "",
        fees: "0",
        taxes: "0",
      });
    }
    setOpen(next);
  }

  async function onSubmit(data: NewTransactionInput) {
    setPending(true);
    try {
      const result = await createTransactionAction(data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Operación registrada");
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => handleOpenChange(true)} variant="outline" className="shrink-0">
        <Plus className="mr-2 h-4 w-4" />
        Nueva operación
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Nueva operación</DialogTitle>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {/* Ticker + instrument type */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ticker">Ticker</Label>
                  <Input
                    id="ticker"
                    list={listId}
                    placeholder="Ej. AAPL, IBIT, MCC3O…"
                    autoComplete="off"
                    {...register("ticker")}
                  />
                  <datalist id={listId}>
                    {instruments.map((i) => (
                      <option key={`${i.ticker}-${i.type}`} value={i.ticker}>
                        {i.name}
                      </option>
                    ))}
                  </datalist>
                  {errors.ticker && (
                    <p className="text-xs text-rose-400">{errors.ticker.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="instrumentType">Tipo de instrumento</Label>
                  <Select
                    onValueChange={(v) =>
                      setValue("instrumentType", v as InstrumentType, {
                        shouldValidate: true,
                      })
                    }
                    value={watch("instrumentType")}
                  >
                    <SelectTrigger id="instrumentType">
                      <SelectValue placeholder="Seleccionar…" />
                    </SelectTrigger>
                    <SelectContent>
                      {INSTRUMENT_TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.instrumentType && (
                    <p className="text-xs text-rose-400">Tipo requerido</p>
                  )}
                </div>
              </div>

              {/* Side + currency */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="side">Operación</Label>
                  <Select
                    onValueChange={(v) =>
                      setValue("side", v as "BUY" | "SELL", { shouldValidate: true })
                    }
                    value={side}
                  >
                    <SelectTrigger id="side">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUY">Compra</SelectItem>
                      <SelectItem value="SELL">Venta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="currencyCode">Moneda</Label>
                  <Select
                    onValueChange={(v) =>
                      setValue("currencyCode", v as (typeof TRANSACTION_CURRENCIES)[number], {
                        shouldValidate: true,
                      })
                    }
                    value={currencyCode}
                  >
                    <SelectTrigger id="currencyCode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSACTION_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label htmlFor="tradeDate">Fecha</Label>
                <Input id="tradeDate" type="date" {...register("tradeDate")} />
                {errors.tradeDate && (
                  <p className="text-xs text-rose-400">{errors.tradeDate.message}</p>
                )}
              </div>

              {/* Quantity + price */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="quantity">Cantidad</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0"
                    {...register("quantity")}
                  />
                  {errors.quantity && (
                    <p className="text-xs text-rose-400">{errors.quantity.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="price">Precio unitario</Label>
                  <Input
                    id="price"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0"
                    {...register("price")}
                  />
                  {errors.price && (
                    <p className="text-xs text-rose-400">{errors.price.message}</p>
                  )}
                </div>
              </div>

              {/* Fees + taxes */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fees">Comisiones (opcional)</Label>
                  <Input
                    id="fees"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    {...register("fees")}
                  />
                  {errors.fees && (
                    <p className="text-xs text-rose-400">{errors.fees.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="taxes">Impuestos (opcional)</Label>
                  <Input
                    id="taxes"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    {...register("taxes")}
                  />
                  {errors.taxes && (
                    <p className="text-xs text-rose-400">{errors.taxes.message}</p>
                  )}
                </div>
              </div>

              {/* Live total */}
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                <span className="text-sm text-zinc-400">
                  {side === "BUY" ? "Total a pagar" : "Total a recibir"}
                </span>
                <span className="font-mono text-lg font-semibold text-zinc-50">
                  {total != null ? formatAmount(total, currencyCode) : "—"}
                </span>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Registrar operación"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
