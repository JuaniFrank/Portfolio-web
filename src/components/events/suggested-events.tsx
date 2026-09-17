"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Lightbulb, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { createCorporateEvent } from "@/app/actions/events";
import {
  dismissSuggestedCorporateEvent,
  undismissSuggestedCorporateEvent,
} from "@/app/actions/suggested-events";
import type { CorporateEventDTO, SuggestedCorporateEventDTO } from "@/lib/events/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatEventTypeLabel, formatRatio } from "./format";

type Props = {
  suggestions: SuggestedCorporateEventDTO[];
  onApplied: (event: CorporateEventDTO, suggestionId: string) => void;
  onDismissChanged: (suggestionId: string, dismissed: boolean) => void;
};

export function SuggestedEvents({ suggestions, onApplied, onDismissChanged }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  if (suggestions.length === 0) return null;

  const pending = suggestions.filter((s) => !s.dismissed);
  const dismissed = suggestions.filter((s) => s.dismissed);

  async function apply(suggestion: SuggestedCorporateEventDTO) {
    setPendingId(suggestion.id);
    try {
      const result = await createCorporateEvent({
        instrumentId: suggestion.instrumentId,
        eventType: suggestion.eventType,
        effectiveDate: suggestion.effectiveDate,
        numerator: suggestion.numerator,
        denominator: suggestion.denominator,
        notes: `Detectado automáticamente (${suggestion.source}).`,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Evento aplicado para ${suggestion.ticker}`);
      onApplied(result.event, suggestion.id);
    } finally {
      setPendingId(null);
    }
  }

  async function dismiss(suggestion: SuggestedCorporateEventDTO) {
    setDismissingId(suggestion.id);
    try {
      const result = await dismissSuggestedCorporateEvent(suggestion.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDismissChanged(suggestion.id, true);
    } finally {
      setDismissingId(null);
    }
  }

  async function undismiss(suggestion: SuggestedCorporateEventDTO) {
    setDismissingId(suggestion.id);
    try {
      const result = await undismissSuggestedCorporateEvent(suggestion.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDismissChanged(suggestion.id, false);
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-teal-400" />
        <h2 className="text-sm font-medium text-zinc-300">Eventos sugeridos</h2>
      </div>

      {pending.length === 0 && (
        <p className="text-xs text-zinc-500">
          No hay sugerencias pendientes. Las nuevas se detectan automáticamente al actualizar precios.
        </p>
      )}

      {pending.map((s) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          busy={pendingId === s.id || dismissingId === s.id}
          applying={pendingId === s.id}
          onApply={() => void apply(s)}
          secondaryAction={{
            label: "Descartar",
            icon: <X className="mr-1.5 h-3.5 w-3.5" />,
            busy: dismissingId === s.id,
            onClick: () => void dismiss(s),
          }}
        />
      ))}

      {dismissed.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", showDismissed && "rotate-180")}
            />
            Descartados ({dismissed.length})
          </button>

          {showDismissed && (
            <div className="mt-2 space-y-2">
              {dismissed.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  muted
                  busy={pendingId === s.id || dismissingId === s.id}
                  applying={pendingId === s.id}
                  onApply={() => void apply(s)}
                  secondaryAction={{
                    label: "Deshacer",
                    icon: <RotateCcw className="mr-1.5 h-3.5 w-3.5" />,
                    busy: dismissingId === s.id,
                    onClick: () => void undismiss(s),
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SuggestionCardProps = {
  suggestion: SuggestedCorporateEventDTO;
  busy: boolean;
  applying: boolean;
  muted?: boolean;
  onApply: () => void;
  secondaryAction: {
    label: string;
    icon: ReactNode;
    busy: boolean;
    onClick: () => void;
  };
};

function SuggestionCard({
  suggestion,
  busy,
  applying,
  muted,
  onApply,
  secondaryAction,
}: SuggestionCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        muted ? "border-zinc-800 bg-zinc-900/30 opacity-75" : "border-teal-900/50 bg-teal-950/10"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-zinc-100">
            {formatEventTypeLabel(suggestion.eventType)} — {suggestion.ticker}
          </p>
          <p className="max-w-2xl text-xs leading-relaxed text-zinc-400">
            Detectado automáticamente al actualizar precios ({suggestion.instrumentName}).
          </p>
          <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
            <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-zinc-300">
              {suggestion.ticker}
            </span>
            <span className="rounded bg-zinc-800/80 px-2 py-0.5 text-zinc-400">
              Fecha efectiva:{" "}
              <span className="font-mono text-zinc-300">{suggestion.effectiveDate}</span>
            </span>
            <span className="rounded bg-zinc-800/80 px-2 py-0.5 text-zinc-400">
              Ratio:{" "}
              <span className="font-mono text-zinc-300">
                {formatRatio(suggestion.numerator, suggestion.denominator)}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={secondaryAction.onClick}
            disabled={busy}
          >
            {secondaryAction.busy ? "..." : secondaryAction.icon}
            {secondaryAction.busy ? "" : secondaryAction.label}
          </Button>
          <Button type="button" size="sm" onClick={onApply} disabled={busy}>
            {applying ? "Aplicando…" : "Aplicar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
