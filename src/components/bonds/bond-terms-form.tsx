"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { BondTerms } from "@/lib/generated/prisma";
import {
  upsertBondTermsAction,
  type BondTermsInput,
  type AmortizationEntry,
} from "@/app/actions/bond-terms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  instrumentId: string;
  ticker: string;
  /** Pre-populated when editing existing terms. */
  initialTerms?: BondTerms | null;
  onSaved?: (terms: BondTerms) => void;
  onCancel?: () => void;
};

type FormState = {
  faceValue: string;
  currencyCode: string;
  rateType: "FIXED" | "FLOATING";
  couponRate: string;
  couponFrequencyMonths: string;
  issueDate: string;
  maturityDate: string;
  dayCountConvention: string;
};

type AmortizationRow = {
  date: string;
  principalPct: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFormState(terms: BondTerms): FormState {
  const schedule = Array.isArray(terms.amortizationSchedule)
    ? (terms.amortizationSchedule as AmortizationEntry[])
    : [];
  void schedule; // used only for amort rows below

  return {
    faceValue: String(terms.faceValue),
    currencyCode: terms.currencyCode,
    rateType: terms.rateType as "FIXED" | "FLOATING",
    couponRate: String(terms.couponRate),
    couponFrequencyMonths: String(terms.couponFrequencyMonths),
    issueDate: terms.issueDate instanceof Date
      ? terms.issueDate.toISOString().slice(0, 10)
      : String(terms.issueDate).slice(0, 10),
    maturityDate: terms.maturityDate instanceof Date
      ? terms.maturityDate.toISOString().slice(0, 10)
      : String(terms.maturityDate).slice(0, 10),
    dayCountConvention: terms.dayCountConvention,
  };
}

function toAmortizationRows(terms: BondTerms): AmortizationRow[] {
  const raw = terms.amortizationSchedule;
  if (!Array.isArray(raw)) return [{ date: "", principalPct: "100" }];
  return (raw as AmortizationEntry[]).map((e) => ({
    date: e.date.slice(0, 10),
    principalPct: String(e.principalPct),
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DAY_COUNT_OPTIONS = [
  "30/360",
  "ACT/360",
  "ACT/365",
  "ACT/ACT",
  "30E/360",
];

const FREQUENCY_OPTIONS: { label: string; value: string }[] = [
  { label: "Mensual (1m)", value: "1" },
  { label: "Bimestral (2m)", value: "2" },
  { label: "Trimestral (3m)", value: "3" },
  { label: "Semestral (6m)", value: "6" },
  { label: "Anual (12m)", value: "12" },
];

export function BondTermsForm({
  instrumentId,
  ticker,
  initialTerms,
  onSaved,
  onCancel,
}: Props) {
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const defaultForm: FormState = initialTerms
    ? toFormState(initialTerms)
    : {
        faceValue: "1000",
        currencyCode: "USD",
        rateType: "FIXED",
        couponRate: "",
        couponFrequencyMonths: "6",
        issueDate: "",
        maturityDate: "",
        dayCountConvention: "ACT/365",
      };

  const defaultAmort: AmortizationRow[] = initialTerms
    ? toAmortizationRows(initialTerms)
    : [{ date: "", principalPct: "100" }];

  const [form, setForm] = useState<FormState>(defaultForm);
  const [amortRows, setAmortRows] = useState<AmortizationRow[]>(defaultAmort);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateAmortRow(index: number, field: keyof AmortizationRow, value: string) {
    setAmortRows((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return next;
      const updated: AmortizationRow = {
        date: field === "date" ? value : current.date,
        principalPct: field === "principalPct" ? value : current.principalPct,
      };
      next[index] = updated;
      return next;
    });
  }

  function addAmortRow() {
    setAmortRows((prev) => [...prev, { date: "", principalPct: "" }]);
  }

  function removeAmortRow(index: number) {
    setAmortRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);

    try {
      // Parse amortization schedule
      const amortizationSchedule: AmortizationEntry[] = amortRows.map((row) => ({
        date: row.date,
        principalPct: parseFloat(row.principalPct) || 0,
      }));

      const input: BondTermsInput = {
        instrumentId,
        faceValue: parseFloat(form.faceValue) || 0,
        currencyCode: form.currencyCode,
        rateType: form.rateType,
        couponRate: parseFloat(form.couponRate),
        couponFrequencyMonths: parseInt(form.couponFrequencyMonths, 10) || 6,
        issueDate: form.issueDate,
        maturityDate: form.maturityDate,
        amortizationSchedule,
        dayCountConvention: form.dayCountConvention,
      };

      const result = await upsertBondTermsAction(input);

      if (!result.success) {
        setFormError(result.error);
        return;
      }

      toast.success(`Términos guardados para ${ticker}`);
      onSaved?.(result.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setFormError(message);
    } finally {
      setPending(false);
    }
  }

  const totalPct = amortRows.reduce(
    (sum, r) => sum + (parseFloat(r.principalPct) || 0),
    0
  );
  const amortSumError = amortRows.length > 0 && Math.abs(totalPct - 100) > 0.01
    ? `La suma de % de capital es ${totalPct.toFixed(2)} — debe ser 100`
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-100">
          Términos del bono — {ticker}
        </h2>
        <p className="text-xs text-zinc-400">
          Ingresá los términos contractuales de esta ON para habilitar la proyección de flujos y la analítica de TIR/duration.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Basic terms */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="faceValue">Valor nominal (VN)</Label>
          <Input
            id="faceValue"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="1000"
            value={form.faceValue}
            onChange={(e) => setField("faceValue", e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currencyCode">Moneda</Label>
          <Select
            value={form.currencyCode}
            onValueChange={(v) => setField("currencyCode", v)}
          >
            <SelectTrigger id="currencyCode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="ARS">ARS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rateType">Tipo de tasa</Label>
          <Select
            value={form.rateType}
            onValueChange={(v) => setField("rateType", v as "FIXED" | "FLOATING")}
          >
            <SelectTrigger id="rateType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FIXED">Fija</SelectItem>
              <SelectItem value="FLOATING">Variable (última tasa conocida)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="couponRate">
            {form.rateType === "FLOATING" ? "Última tasa de cupón conocida" : "Tasa de cupón"}
            <span className="ml-1 text-xs text-zinc-500">(decimal, ej. 0,085 para 8,5%)</span>
          </Label>
          <Input
            id="couponRate"
            type="number"
            step="0.0001"
            min="0"
            max="1"
            placeholder="0.085"
            value={form.couponRate}
            onChange={(e) => setField("couponRate", e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="couponFrequencyMonths">Frecuencia de cupón</Label>
          <Select
            value={form.couponFrequencyMonths}
            onValueChange={(v) => setField("couponFrequencyMonths", v)}
          >
            <SelectTrigger id="couponFrequencyMonths">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dayCountConvention">Convención de conteo de días</Label>
          <Select
            value={form.dayCountConvention}
            onValueChange={(v) => setField("dayCountConvention", v)}
          >
            <SelectTrigger id="dayCountConvention">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_COUNT_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="issueDate">Fecha de emisión</Label>
          <Input
            id="issueDate"
            type="date"
            value={form.issueDate}
            onChange={(e) => setField("issueDate", e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="maturityDate">Fecha de vencimiento</Label>
          <Input
            id="maturityDate"
            type="date"
            value={form.maturityDate}
            onChange={(e) => setField("maturityDate", e.target.value)}
            required
          />
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Amortization schedule */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>Cronograma de amortización</Label>
            <p className="text-xs text-zinc-400">
              Definí cuándo se devuelve el capital. Los % de capital deben sumar 100.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addAmortRow}>
            + Agregar fila
          </Button>
        </div>

        <div className="space-y-2">
          {amortRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                type="date"
                value={row.date}
                onChange={(e) => updateAmortRow(idx, "date", e.target.value)}
                className="flex-1"
                required
              />
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                placeholder="100"
                value={row.principalPct}
                onChange={(e) => updateAmortRow(idx, "principalPct", e.target.value)}
                className="w-28"
                required
              />
              <span className="text-xs text-zinc-500">%</span>
              {amortRows.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeAmortRow(idx)}
                  className="shrink-0"
                >
                  Quitar
                </Button>
              )}
            </div>
          ))}
        </div>

        {amortSumError ? (
          <p className="text-xs text-rose-400">{amortSumError}</p>
        ) : (
          <p className="text-xs text-zinc-500">
            Total: {totalPct.toFixed(2)}%{totalPct === 100 ? " ✓" : ""}
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Floating rate notice */}
      {/* ---------------------------------------------------------------- */}
      {form.rateType === "FLOATING" && (
        <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
          <strong>Nota sobre tasa variable:</strong> las proyecciones de flujos de este bono usarán
          la tasa de cupón ingresada arriba como tasa constante supuesta. Todas las filas de cupón
          proyectadas se marcarán como &ldquo;tasa asumida&rdquo; en la interfaz.
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Error + actions */}
      {/* ---------------------------------------------------------------- */}
      {formError && (
        <div className="rounded-md border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-300">
          {formError}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={pending || !!amortSumError}>
          {pending ? "Guardando…" : initialTerms ? "Actualizar términos" : "Guardar términos"}
        </Button>
      </div>
    </form>
  );
}
