import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TransactionType } from "@/lib/generated/prisma";
import { TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";

type ReviewFilterBarProps = {
  tickerQuery: string;
  setTickerQuery: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  availableTypes: TransactionType[];
  visibleCount: number;
  totalCount: number;
};

/** Buscador por ticker, filtro por tipo de operación y contador de filas visibles. */
export function ReviewFilterBar({
  tickerQuery,
  setTickerQuery,
  typeFilter,
  setTypeFilter,
  availableTypes,
  visibleCount,
  totalCount,
}: ReviewFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            value={tickerQuery}
            onChange={(e) => setTickerQuery(e.target.value)}
            placeholder="Buscar ticker…"
            className="h-8 w-44 pl-8 text-xs bg-zinc-950/60"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-44 text-xs bg-zinc-950/60">
            <SelectValue placeholder="Tipo de operación" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {availableTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {TRANSACTION_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(tickerQuery || typeFilter !== "all") && (
          <button
            type="button"
            onClick={() => {
              setTickerQuery("");
              setTypeFilter("all");
            }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-3 w-3" />
            Limpiar filtros
          </button>
        )}
      </div>

      <p className="text-[11px] text-zinc-500">
        Mostrando {visibleCount} de {totalCount} filas
      </p>
    </div>
  );
}
