"use client";

import * as React from "react";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateLong, formatDateTick } from "@/components/rendimientos/chart-utils";
import {
  DEFAULT_TIME_RANGE,
  RANGE_PRESETS,
  type TimeRange,
} from "@/lib/dashboard/time-range";
import { cn } from "@/lib/utils";

/** Presets que se muestran como botones. `CUSTOM` tiene su propio disparador. */
const BUTTON_PRESETS = RANGE_PRESETS.filter((option) => option.id !== "CUSTOM");

type Props = {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  /** Extremos con dato: fuera de ahí no hay cierres que mostrar. `YYYY-MM-DD`. */
  min: string | null;
  max: string | null;
};

/**
 * Selector de ventana temporal: presets relativos más un rango con calendario.
 *
 * Mismo lenguaje visual que el selector de `/monitoreo` (grupo segmentado, activo en
 * teal) para que los dos se lean igual. Es prop-driven a propósito: no sabe de dónde
 * salen los datos, así que enchufarlo en `/monitoreo` es pasarle otro `value`/`onChange`.
 */
export function TimeRangeSelector({ value, onChange, min, max }: Props) {
  const [open, setOpen] = React.useState(false);

  const isCustom = value.preset === "CUSTOM";
  const selected = React.useMemo<DateRange | undefined>(() => {
    if (!isCustom) return undefined;
    const from = value.from ? parseCalendarDay(value.from) : undefined;
    const to = value.to ? parseCalendarDay(value.to) : undefined;
    return from || to ? { from, to } : undefined;
  }, [isCustom, value.from, value.to]);

  const handleSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      onChange({ preset: "CUSTOM", from: null, to: null });
      return;
    }

    const from = formatCalendarDay(range.from);
    const to = range.to ? formatCalendarDay(range.to) : null;
    onChange({ preset: "CUSTOM", from, to });

    // Se aplica en vivo y se cierra cuando el tramo quedó completo: menos clics que un
    // botón "Aplicar", y mientras elegís el segundo extremo el gráfico ya se va moviendo.
    if (to) setOpen(false);
  };

  const clearCustom = () => {
    onChange(DEFAULT_TIME_RANGE);
    setOpen(false);
  };

  const disabledDays = React.useMemo(() => {
    const matchers: Array<{ before: Date } | { after: Date }> = [];
    if (min) matchers.push({ before: parseCalendarDay(min) });
    if (max) matchers.push({ after: parseCalendarDay(max) });
    return matchers;
  }, [min, max]);

  return (
    <div
      role="group"
      aria-label="Rango de fechas"
      className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
    >
      {BUTTON_PRESETS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value.preset === option.id}
          onClick={() => onChange({ preset: option.id, from: null, to: null })}
          className={cn(
            "rounded-md px-2 py-1 font-medium transition-colors",
            value.preset === option.id
              ? "border border-teal-800/60 bg-teal-950 text-teal-300 shadow-sm"
              : "border border-transparent text-zinc-400 hover:text-zinc-200"
          )}
        >
          {option.label}
        </button>
      ))}

      <span className="mx-0.5 h-4 w-px bg-zinc-800" aria-hidden />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={isCustom}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors",
              isCustom
                ? "border border-teal-800/60 bg-teal-950 text-teal-300 shadow-sm"
                : "border border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {/* Con un rango activo el botón muestra el rango: el control refleja el
                estado en vez de esconderlo detrás de la palabra "Personalizado". */}
            {isCustom ? formatRangeLabel(value.from, value.to) : "Personalizado"}
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-auto p-0">
          <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-3 py-2">
            <p className="text-xs text-zinc-400">
              {selected?.from && !selected.to
                ? "Elegí la fecha de fin"
                : "Elegí el rango de fechas"}
            </p>
            {isCustom ? (
              <button
                type="button"
                onClick={clearCustom}
                className="inline-flex items-center gap-1 rounded text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
                Limpiar
              </button>
            ) : null}
          </div>

          <Calendar
            mode="range"
            selected={selected}
            onSelect={handleSelect}
            numberOfMonths={2}
            disabled={disabledDays}
            startMonth={min ? parseCalendarDay(min) : undefined}
            endMonth={max ? parseCalendarDay(max) : undefined}
            // Abre en el tramo relevante y no en el mes actual del calendario.
            defaultMonth={defaultMonthFor(value.to ?? value.from ?? max)}
            autoFocus
            className="p-3"
          />

          {min && max ? (
            <p className="border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
              Hay cierres entre {formatDateLong(min)} y {formatDateLong(max)}.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * `YYYY-MM-DD` → `Date` en hora **local**.
 *
 * `new Date("2026-02-10")` se interpreta como medianoche UTC, así que en Argentina
 * (UTC−3) el calendario marcaría el 9. Todo el ida y vuelta trabaja con componentes
 * locales para que un día de calendario siga siendo el mismo día.
 */
function parseCalendarDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!);
}

/** `Date` local → `YYYY-MM-DD`, sin pasar por UTC. Ver `parseCalendarDay`. */
function formatCalendarDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function defaultMonthFor(day: string | null): Date | undefined {
  return day ? parseCalendarDay(day) : undefined;
}

/** Etiqueta compacta del rango, con año solo cuando los extremos no lo comparten. */
function formatRangeLabel(from: string | null, to: string | null): string {
  if (!from) return "Personalizado";
  if (!to) return `Desde ${formatDateTick(from)}`;

  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const format = sameYear ? formatDateTick : formatDateLong;
  return `${format(from)} – ${format(to)}`;
}
