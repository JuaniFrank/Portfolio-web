"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EvolutionInstrument } from "@/lib/dashboard/evolution";
import type { InstrumentTypeSet, TickerSet } from "@/lib/dashboard/evolution-view";

const TYPE_LABELS: Record<EvolutionInstrument["type"], string> = {
  STOCK_AR: "Acciones",
  CEDEAR: "CEDEARs",
  ON: "ONs",
};

type Props = {
  instruments: EvolutionInstrument[];
  /** El chip de tipo activo: acota qué tickers tiene sentido listar acá, porque
   * `selectTickers` intersecta los dos filtros (ver `evolution-view.ts`). */
  typeFilter: InstrumentTypeSet;
  value: TickerSet;
  onChange: (next: TickerSet) => void;
};

/** Selector de tickers: popover con búsqueda y checkboxes agrupados por tipo. */
export function TickerSelector({ instruments, typeFilter, value, onChange }: Props) {
  const [query, setQuery] = React.useState("");

  const visible = React.useMemo(
    () => (typeFilter === "all" ? instruments : instruments.filter((i) => typeFilter.has(i.type))),
    [instruments, typeFilter]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (i) => i.ticker.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
    );
  }, [visible, query]);

  const grouped = React.useMemo(() => {
    const groups = new Map<EvolutionInstrument["type"], EvolutionInstrument[]>();
    for (const instrument of filtered) {
      const list = groups.get(instrument.type) ?? [];
      list.push(instrument);
      groups.set(instrument.type, list);
    }
    return groups;
  }, [filtered]);

  const isChecked = (ticker: string) => value === "all" || value.has(ticker);
  const selectedCount = visible.filter((i) => isChecked(i.ticker)).length;

  const materialize = () => (value === "all" ? new Set(instruments.map((i) => i.ticker)) : new Set(value));

  const toggleTicker = (ticker: string) => {
    const next = materialize();
    if (next.has(ticker)) next.delete(ticker);
    else next.add(ticker);
    onChange(next.size === instruments.length ? "all" : next);
  };

  const selectAllVisible = () => {
    const next = materialize();
    for (const i of visible) next.add(i.ticker);
    onChange(next.size === instruments.length ? "all" : next);
  };

  const selectNoneVisible = () => {
    const next = materialize();
    for (const i of visible) next.delete(i.ticker);
    onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
        >
          Tickers: {selectedCount} de {visible.length}
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-zinc-800 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar ticker..."
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-2 py-1.5 text-[11px]">
          <button
            type="button"
            onClick={selectAllVisible}
            className="font-medium text-teal-400 transition-colors hover:text-teal-300"
          >
            Todos
          </button>
          <button
            type="button"
            onClick={selectNoneVisible}
            className="font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Ninguno
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {[...grouped.entries()].map(([type, list]) => (
            <div key={type} className="mb-1">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
                {TYPE_LABELS[type]}
              </p>
              {list.map((instrument) => {
                const checked = isChecked(instrument.ticker);
                return (
                  <button
                    key={instrument.ticker}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleTicker(instrument.ticker)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-teal-600 bg-teal-950 text-teal-300"
                          : "border-zinc-700 text-transparent"
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="truncate">{instrument.ticker}</span>
                  </button>
                );
              })}
            </div>
          ))}

          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-zinc-500">Sin resultados.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
