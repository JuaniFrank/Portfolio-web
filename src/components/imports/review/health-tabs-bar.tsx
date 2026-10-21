import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { computeRowStats } from "@/lib/importers/row-validation";
import type { HealthTab } from "@/lib/imports/review-view";
import { cn } from "@/lib/utils";

type HealthTabsBarProps = {
  stats: ReturnType<typeof computeRowStats>;
  activeTab: HealthTab;
  setActiveTab: (tab: HealthTab) => void;
  excludeAllInvalid: () => void;
  restoreAllExcluded: () => void;
};

/** Pestañas de salud de las filas y acciones masivas de omitir/reincorporar. */
export function HealthTabsBar({
  stats,
  activeTab,
  setActiveTab,
  excludeAllInvalid,
  restoreAllExcluded,
}: HealthTabsBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("committable")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            activeTab === "committable"
              ? "bg-teal-500/10 text-teal-400 border border-teal-500/30"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          )}
        >
          <span>Para importar</span>
          <Badge variant="outline" className="ml-1 h-5 text-[10px] border-teal-500/30 text-teal-400">
            {stats.committable}
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("excluded")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            activeTab === "excluded"
              ? "bg-zinc-800 text-zinc-200 border border-zinc-700"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          )}
        >
          <span>Omitidas</span>
          <Badge variant="outline" className="ml-1 h-5 text-[10px] text-zinc-400">
            {stats.excluded}
          </Badge>
        </button>

        {(stats.invalid > 0 || stats.warning > 0) && (
          <button
            type="button"
            onClick={() => setActiveTab("problems")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "problems"
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                : "text-amber-400/80 hover:text-amber-300 hover:bg-zinc-900"
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Con avisos o errores</span>
            <Badge variant="destructive" className="ml-1 h-5 text-[10px]">
              {stats.invalid + stats.warning}
            </Badge>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            activeTab === "all"
              ? "bg-zinc-800 text-zinc-200 border border-zinc-700"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          )}
        >
          <span>Todas</span>
          <Badge variant="outline" className="ml-1 h-5 text-[10px] text-zinc-400">
            {stats.total}
          </Badge>
        </button>
      </div>

      {/* Acciones masivas */}
      <div className="flex items-center gap-2">
        {stats.invalid > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={excludeAllInvalid}
          >
            Omitir las {stats.invalid} con error
          </Button>
        )}

        {stats.excluded > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-zinc-400 hover:text-zinc-100"
            onClick={restoreAllExcluded}
          >
            Reincorporar todas ({stats.excluded})
          </Button>
        )}
      </div>
    </div>
  );
}
