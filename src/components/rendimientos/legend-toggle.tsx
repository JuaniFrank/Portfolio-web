"use client";

import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Botón de leyenda con estado de visibilidad. Estaba duplicado dentro de los charts;
 * vive acá para que todas las leyendas se comporten y se vean igual.
 */
export function LegendToggle({
  color,
  label,
  active,
  onClick,
  hint,
}: {
  color: string;
  label: string;
  active: boolean;
  onClick: () => void;
  /** Nota al pie del toggle, p. ej. avisar del lag de publicación de una serie. */
  hint?: string;
}) {
  const Icon = active ? Eye : EyeOff;

  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "border-zinc-700 bg-zinc-800/60 text-zinc-100"
          : "border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:text-zinc-300"
      )}
    >
      <Icon className="h-3.5 w-3.5" style={active ? { color } : undefined} />
      <span className={cn(!active && "line-through decoration-zinc-600")}>{label}</span>
    </button>
  );
}

/** Contenedor de leyendas: se envuelve solo en pantallas chicas. */
export function LegendRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
