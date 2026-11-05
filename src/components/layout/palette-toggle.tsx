"use client";

import { Palette as PaletteIcon } from "lucide-react";
import { usePalette } from "@/components/providers/palette-provider";
import { PALETTES } from "@/lib/theme/palettes";
import { cn } from "@/lib/utils";

export function PaletteToggle({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  const { palette, setPalette } = usePalette();

  if (collapsed) {
    // Icon-only rail: one button that cycles through the palettes.
    const index = PALETTES.findIndex((option) => option.id === palette);
    const next = PALETTES[(index + 1) % PALETTES.length]!;
    // An unknown stored id (index -1) has no label of its own: don't name another palette as current.
    const current = index >= 0 ? PALETTES[index]!.label : "personalizada";
    const label = `Paleta: ${current} (cambiar a ${next.label})`;
    return (
      <button
        type="button"
        onClick={() => setPalette(next.id)}
        title={label}
        aria-label={label}
        className={cn(
          "flex min-h-10 w-full items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-50",
          className
        )}
      >
        <PaletteIcon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className={cn("flex items-center gap-1 px-3 py-1 text-xs text-zinc-500", className)}>
      <span className="shrink-0">Tema:</span>
      <div className="flex gap-1">
        {PALETTES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={palette === option.id}
            onClick={() => setPalette(option.id)}
            className={cn(
              "rounded px-2 py-0.5 transition-colors",
              palette === option.id
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-50"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
