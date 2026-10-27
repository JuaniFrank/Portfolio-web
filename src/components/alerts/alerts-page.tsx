"use client";

import { useState, useTransition } from "react";
import { Bell, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePriceTargetAction, rearmPriceTargetAction } from "@/app/actions/price-targets";
import { TargetForm, type InstrumentOption } from "@/components/alerts/target-form";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatMoney } from "@/components/dashboard/format";
import { EMPTY_VALUE, formatSignedPercentOrEmpty } from "@/components/rendimientos/chart-utils";
import { Td, Th } from "@/components/rendimientos/monthly-table";
import { Button } from "@/components/ui/button";
import type { TargetStatus } from "@/lib/alerts/evaluate";
import type { TargetRowDTO } from "@/lib/alerts/rows";

const STATUS_LABEL: Record<TargetStatus, { text: string; className: string; hint: string }> = {
  armed: {
    text: "Armado",
    className: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
    hint: "Todavía no se cumple.",
  },
  reached: {
    text: "Alcanzado",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    hint: "El precio actual ya cumple el objetivo; el aviso sale en la próxima evaluación.",
  },
  triggered: {
    text: "Disparado",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    hint: "Ya se disparó. Re-armalo para que vuelva a avisar.",
  },
};

function StatusPill({ row }: { row: TargetRowDTO }) {
  const status = STATUS_LABEL[row.status];
  return (
    <span
      title={status.hint}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${status.className}`}
    >
      {status.text}
    </span>
  );
}

function money(value: number | null, currency: "USD" | "ARS"): string {
  return value === null ? EMPTY_VALUE : formatMoney(value, currency);
}

export function AlertsPage({
  rows,
  instruments,
}: {
  rows: TargetRowDTO[];
  instruments: InstrumentOption[];
}) {
  const [editing, setEditing] = useState<TargetRowDTO | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Alertas</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          Objetivos de precio de tus CEDEARs (medidos en la acción original, en USD) y acciones
          locales (en ARS). Cada objetivo avisa una sola vez; re-armalo para volver a usarlo.
        </p>
      </div>

      <ChartCard
        title={editing ? `Editar objetivo de ${editing.ticker}` : "Nuevo objetivo"}
        icon={<Bell className="h-4 w-4" />}
      >
        {instruments.length === 0 && !editing ? (
          <p className="text-sm text-zinc-500">
            Todavía no operaste CEDEARs ni acciones locales: no hay instrumentos para fijar objetivos.
          </p>
        ) : (
          <TargetForm
            // Remonta el formulario al cambiar de objetivo para que tome sus valores iniciales.
            key={editing?.id ?? "new"}
            targetId={editing?.id}
            instruments={instruments}
            currencyHint={editing?.currency}
            initial={
              editing
                ? { targetPrice: editing.targetPrice, direction: editing.direction, note: editing.note }
                : undefined
            }
            onDone={() => setEditing(null)}
          />
        )}
        {editing ? (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setEditing(null)}>
            Cancelar edición
          </Button>
        ) : null}
      </ChartCard>

      <ChartCard title="Mis objetivos" description="Precio actual de la acción original, distancia al objetivo y estado.">
        {rows.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
            No tenés objetivos todavía.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-(length:--monthly-table-font-size) leading-(--monthly-table-line-height)">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-(length:--monthly-table-head-font-size) uppercase tracking-wide text-zinc-500">
                  <Th>Instrumento</Th>
                  <Th>Condición</Th>
                  <Th align="right">Objetivo</Th>
                  <Th align="right">Actual</Th>
                  <Th align="right" hint="Cuánto le falta al precio actual para llegar al objetivo. Negativo: hay que bajar.">
                    Distancia
                  </Th>
                  <Th>Estado</Th>
                  <Th align="right">Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-800/50">
                    <Td>
                      <span className="font-medium text-zinc-200">{row.ticker}</span>
                      <span className="block truncate text-[10px] text-zinc-500">
                        {row.symbol !== row.ticker ? `${row.symbol} · ` : ""}
                        {row.instrumentName}
                      </span>
                      {row.note ? <span className="block truncate text-[10px] text-zinc-400">{row.note}</span> : null}
                    </Td>
                    <Td className="text-zinc-400">{row.direction === "BELOW" ? "Por debajo de" : "Por encima de"}</Td>
                    <Td align="right" className="text-zinc-200">
                      {money(row.targetPrice, row.currency)}
                    </Td>
                    <Td align="right" className="text-zinc-400">
                      {money(row.price, row.currency)}
                    </Td>
                    <Td align="right" className="text-zinc-400">
                      {formatSignedPercentOrEmpty(row.distancePct)}
                    </Td>
                    <Td>
                      <StatusPill row={row} />
                      {row.status === "triggered" ? (
                        <span className="block text-[10px] text-zinc-500">
                          {money(row.triggeredPrice, row.currency)}
                          {row.notified ? " · avisado" : " · aviso pendiente"}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        {row.status === "triggered" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Re-armar"
                            aria-label={`Re-armar el objetivo de ${row.ticker}`}
                            disabled={pending}
                            onClick={() => run(() => rearmPriceTargetAction(row.id), "Objetivo re-armado")}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="Editar"
                          aria-label={`Editar el objetivo de ${row.ticker}`}
                          onClick={() => setEditing(row)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="Eliminar"
                          aria-label={`Eliminar el objetivo de ${row.ticker}`}
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(`¿Eliminar el objetivo de ${row.ticker}?`)) {
                              run(() => deletePriceTargetAction(row.id), "Objetivo eliminado");
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
          Los avisos por Telegram los envía la evaluación programada (diaria en Vercel; cada pocos minutos
          si corrés el worker). Editar un objetivo lo vuelve a armar.
        </p>
      </ChartCard>
    </div>
  );
}
