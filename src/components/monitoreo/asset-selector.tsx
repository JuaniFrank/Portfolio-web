"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search, Briefcase, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MonitoringInstrument } from "@/lib/monitoreo/types";
import { cn } from "@/lib/utils";

interface AssetSelectorProps {
  instruments: MonitoringInstrument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function AssetSelector({
  instruments,
  selectedId,
  onSelect,
  disabled,
}: AssetSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"ALL" | "STOCK_AR" | "CEDEAR">("ALL");
  const [portfolioOnly, setPortfolioOnly] = React.useState(false);
  const [coverageFilter, setCoverageFilter] = React.useState<"ALL" | "WITH_DATA" | "NO_DATA">("ALL");

  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const selectedInstrument = instruments.find((i) => i.id === selectedId);

  const filteredInstruments = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return instruments.filter((inst) => {
      // Type filter
      if (typeFilter !== "ALL") {
        if (typeFilter === "STOCK_AR" && inst.type !== "STOCK_AR") return false;
        if (typeFilter === "CEDEAR" && inst.type !== "CEDEAR") return false;
      }

      // Portfolio filter
      if (portfolioOnly && !inst.inPortfolio) return false;

      // Coverage filter
      if (coverageFilter === "WITH_DATA" && inst.cacheCoverage === "none") return false;
      if (coverageFilter === "NO_DATA" && inst.cacheCoverage !== "none") return false;

      // Text search
      if (!q) return true;
      return (
        inst.ticker.toLowerCase().includes(q) ||
        inst.name.toLowerCase().includes(q) ||
        (inst.underlyingTicker && inst.underlyingTicker.toLowerCase().includes(q))
      );
    });
  }, [instruments, search, typeFilter, portfolioOnly, coverageFilter]);

  return (
    <div className="relative w-full max-w-sm" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="w-full justify-between border-zinc-800 bg-zinc-900/90 text-left font-normal hover:bg-zinc-800"
      >
        {selectedInstrument ? (
          <div className="flex items-center gap-2 truncate">
            <span className="font-semibold text-zinc-100">{selectedInstrument.ticker}</span>
            <span className="truncate text-xs text-zinc-400">— {selectedInstrument.name}</span>
            <Badge
              variant="outline"
              className={cn(
                "ml-auto text-[10px] uppercase",
                selectedInstrument.type === "CEDEAR"
                  ? "border-purple-800/60 bg-purple-950/40 text-purple-300"
                  : "border-teal-800/60 bg-teal-950/40 text-teal-300"
              )}
            >
              {selectedInstrument.type === "CEDEAR" ? "CEDEAR" : "Acción AR"}
            </Badge>
          </div>
        ) : (
          <span className="text-zinc-400">Seleccionar activo BYMA...</span>
        )}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-1.5 w-full min-w-[340px] max-w-[420px] rounded-lg border border-zinc-800 bg-zinc-950 p-2 shadow-2xl backdrop-blur">
          {/* Search bar */}
          <div className="relative mb-2">
            <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-zinc-500" />
            <Input
              placeholder="Buscar por ticker o nombre..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 border-zinc-800 bg-zinc-900/80 pl-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-teal-500"
              autoFocus
            />
          </div>

          {/* Filter Pills */}
          <div className="flex flex-col gap-1.5 border-b border-zinc-800/80 pb-2 text-xs">
            {/* Type filters */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-zinc-500 mr-1">Tipo:</span>
              <button
                type="button"
                onClick={() => setTypeFilter("ALL")}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  typeFilter === "ALL"
                    ? "bg-zinc-800 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:bg-zinc-900"
                )}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("STOCK_AR")}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  typeFilter === "STOCK_AR"
                    ? "bg-teal-950 text-teal-300 border border-teal-800/60 font-medium"
                    : "text-zinc-400 hover:bg-zinc-900"
                )}
              >
                Acción AR
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("CEDEAR")}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  typeFilter === "CEDEAR"
                    ? "bg-purple-950 text-purple-300 border border-purple-800/60 font-medium"
                    : "text-zinc-400 hover:bg-zinc-900"
                )}
              >
                CEDEAR
              </button>
            </div>

            {/* Portfolio & Coverage filters */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setPortfolioOnly(!portfolioOnly)}
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
                  portfolioOnly
                    ? "border-blue-700 bg-blue-950 text-blue-300"
                    : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                )}
              >
                <Briefcase className="h-3 w-3" />
                En mi portfolio
              </button>

              <button
                type="button"
                onClick={() =>
                  setCoverageFilter(
                    coverageFilter === "WITH_DATA"
                      ? "ALL"
                      : "WITH_DATA"
                  )
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
                  coverageFilter === "WITH_DATA"
                    ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                    : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                )}
              >
                <Database className="h-3 w-3" />
                Con datos en DB
              </button>
            </div>
          </div>

          {/* List items */}
          <div className="mt-1 max-h-60 overflow-y-auto pr-1">
            {filteredInstruments.length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-500">
                No se encontraron activos para los filtros seleccionados.
              </div>
            ) : (
              filteredInstruments.map((inst) => {
                const isSelected = inst.id === selectedId;
                return (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => {
                      onSelect(inst.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                      isSelected
                        ? "bg-zinc-800/90 text-zinc-100 font-medium"
                        : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                    )}
                  >
                    <div className="flex flex-col truncate pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{inst.ticker}</span>
                        {inst.inPortfolio && (
                          <span
                            title="En tu portfolio"
                            className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500"
                          />
                        )}
                        <span className="text-[10px] text-zinc-500">
                          {inst.type === "CEDEAR" ? "CEDEAR" : "Acción"}
                        </span>
                      </div>
                      <span className="truncate text-xs text-zinc-400">{inst.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {inst.cacheCoverage === "two-years" && (
                        <span className="text-[10px] text-emerald-400 font-mono">2y DB</span>
                      )}
                      {inst.cacheCoverage === "partial" && (
                        <span className="text-[10px] text-amber-400 font-mono">parcial</span>
                      )}
                      {isSelected && <Check className="h-4 w-4 text-teal-400" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
