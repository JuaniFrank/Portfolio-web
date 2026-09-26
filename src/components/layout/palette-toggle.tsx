"use client";

import { usePalette } from "@/components/providers/palette-provider";
import { PALETTES } from "@/lib/theme/palettes";
import { cn } from "@/lib/utils";

export function PaletteToggle({ className }: { className?: string }) {
  const { palette, setPalette } = usePalette();

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
