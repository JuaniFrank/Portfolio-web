"use client";

import {
  Eraser,
  Magnet,
  MessageSquareText,
  Minus,
  MousePointer2,
  MoveUpRight,
  Rows3,
  Slash,
  Spline,
  Trash2,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { DrawingToolName } from "@/lib/monitoreo/drawings-storage";
import { cn } from "@/lib/utils";

export type MagnetMode = "normal" | "weak_magnet" | "strong_magnet";

const TOOLS: { name: DrawingToolName; label: string; icon: LucideIcon }[] = [
  { name: "segment", label: "Línea de tendencia", icon: Slash },
  { name: "rayLine", label: "Rayo", icon: MoveUpRight },
  { name: "horizontalStraightLine", label: "Línea horizontal", icon: Minus },
  { name: "priceLine", label: "Línea de precio", icon: Spline },
  { name: "parallelStraightLine", label: "Canal paralelo", icon: Rows3 },
  { name: "fibonacciLine", label: "Retroceso de Fibonacci", icon: Waves },
  { name: "simpleAnnotation", label: "Anotación", icon: MessageSquareText },
];

const MAGNET_LABEL: Record<MagnetMode, string> = {
  normal: "Imán: apagado",
  weak_magnet: "Imán: suave (clic para imán fuerte)",
  strong_magnet: "Imán: fuerte (clic para apagar)",
};

interface DrawingToolbarProps {
  activeTool: DrawingToolName | null;
  magnet: MagnetMode;
  hasSelection: boolean;
  onSelectTool: (tool: DrawingToolName | null) => void;
  onCycleMagnet: () => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // Native `title` (not a portal tooltip): portals are invisible while the chart is fullscreen.
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35",
        active
          ? "bg-teal-950 text-teal-300 ring-1 ring-teal-800/60"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      )}
    >
      {children}
    </button>
  );
}

/** Compact vertical toolbar for klinecharts overlays, placed on the chart's left edge. */
export function DrawingToolbar({
  activeTool,
  magnet,
  hasSelection,
  onSelectTool,
  onCycleMagnet,
  onDeleteSelected,
  onClearAll,
}: DrawingToolbarProps) {
  return (
    <div
      className="flex w-10 shrink-0 flex-col items-center gap-0.5 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-1"
      role="toolbar"
      aria-label="Herramientas de dibujo"
      aria-orientation="vertical"
    >
      <ToolButton label="Cursor" active={activeTool === null} onClick={() => onSelectTool(null)}>
        <MousePointer2 className="h-4 w-4" />
      </ToolButton>
      <div className="my-1 h-px w-5 bg-zinc-800" />
      {TOOLS.map(({ name, label, icon: Icon }) => (
        <ToolButton key={name} label={label} active={activeTool === name} onClick={() => onSelectTool(name)}>
          <Icon className="h-4 w-4" />
        </ToolButton>
      ))}
      <div className="my-1 h-px w-5 bg-zinc-800" />
      <ToolButton label={MAGNET_LABEL[magnet]} active={magnet !== "normal"} onClick={onCycleMagnet}>
        <span className="relative">
          <Magnet className="h-4 w-4" />
          {magnet === "strong_magnet" && (
            <span className="absolute -right-1.5 -top-1 text-[9px] font-bold leading-none">+</span>
          )}
        </span>
      </ToolButton>
      <ToolButton
        label="Borrar dibujo seleccionado (Supr)"
        disabled={!hasSelection}
        onClick={onDeleteSelected}
      >
        <Eraser className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Borrar todos los dibujos" onClick={onClearAll}>
        <Trash2 className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}
