"use client";

import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { createCorporateEvent } from "@/app/actions/events";
import type { CorporateEventDTO } from "@/lib/events/types";
import type { ApplicableRecommendation } from "@/lib/events/recommended";
import { Button } from "@/components/ui/button";

type Props = {
  recommendations: ApplicableRecommendation[];
  onApplied: (event: CorporateEventDTO) => void;
};

export function RecommendedEvents({ recommendations, onApplied }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (recommendations.length === 0) return null;

  async function apply(rec: ApplicableRecommendation) {
    setPendingId(rec.instrumentId);
    try {
      const result = await createCorporateEvent({
        instrumentId: rec.instrumentId,
        eventType: rec.eventType,
        effectiveDate: rec.effectiveDate,
        numerator: rec.numerator,
        denominator: rec.denominator,
        notes: rec.notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Evento aplicado para ${rec.ticker}`);
      onApplied(result.event);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-teal-400" />
        <h2 className="text-sm font-medium text-zinc-300">Eventos sugeridos</h2>
      </div>

      {recommendations.map((rec) => (
        <div
          key={`${rec.ticker}-${rec.effectiveDate}-${rec.eventType}`}
          className="rounded-lg border border-teal-900/50 bg-teal-950/10 p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-zinc-100">{rec.title}</p>
              <p className="max-w-2xl text-xs leading-relaxed text-zinc-400">
                {rec.description}
              </p>
              <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-zinc-300">
                  {rec.ticker}
                </span>
                <span className="rounded bg-zinc-800/80 px-2 py-0.5 text-zinc-400">
                  Fecha efectiva: <span className="font-mono text-zinc-300">{rec.effectiveDate}</span>
                </span>
                <span className="rounded bg-zinc-800/80 px-2 py-0.5 text-zinc-400">
                  Ratio:{" "}
                  <span className="font-mono text-zinc-300">
                    {rec.numerator}:{rec.denominator}
                  </span>
                </span>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => void apply(rec)}
              disabled={pendingId === rec.instrumentId}
              className="shrink-0"
            >
              {pendingId === rec.instrumentId ? "Aplicando…" : "Aplicar"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
