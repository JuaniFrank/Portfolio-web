import * as React from "react";
import type { EvolutionInstrument } from "@/lib/dashboard/evolution";
import type { InstrumentTypeSet } from "@/lib/dashboard/evolution-view";
import type { ViewMode } from "@/lib/dashboard/evolution-chart";
import { GRANULARITIES, type Granularity } from "@/lib/rendimientos/timeline";
import { cn } from "@/lib/utils";
import { ASSET_TYPE_LABELS, MODE_OPTIONS } from "./chart-model";

export function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (granularity: Granularity) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Granularidad"
      className="inline-flex shrink-0 items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
    >
      {GRANULARITIES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={chipClass(value === option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function AssetTypeChips({
  availableTypes,
  value,
  onChange,
}: {
  availableTypes: EvolutionInstrument["type"][];
  value: InstrumentTypeSet;
  onChange: (next: InstrumentTypeSet) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Tipo de activo"
      className="inline-flex shrink-0 items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
    >
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={chipClass(value === "all")}
      >
        Todo
      </button>
      {availableTypes.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={value !== "all" && value.has(type)}
          onClick={() => onChange(new Set([type]))}
          className={chipClass(value !== "all" && value.has(type))}
        >
          {ASSET_TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}

export function ModeToggle({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div
      role="group"
      aria-label="Modo de vista"
      className="inline-flex shrink-0 items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
    >
      {MODE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={chipClass(value === option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-teal-800/60 bg-teal-950 text-teal-300 shadow-sm"
          : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
      )}
    >
      {children}
    </button>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "rounded-md px-2 py-1 font-medium transition-colors",
    active
      ? "border border-teal-800/60 bg-teal-950 text-teal-300 shadow-sm"
      : "border border-transparent text-zinc-400 hover:text-zinc-200"
  );
}
