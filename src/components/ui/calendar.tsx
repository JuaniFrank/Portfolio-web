"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayPickerProps } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { cn } from "@/lib/utils";

/**
 * Calendario sobre `react-day-picker` v10.
 *
 * Los nombres de clase son los de v9+ (`month_grid`, `range_start`, …), distintos de los
 * de v8 que asumen la mayoría de los snippets dando vueltas: se parten de
 * `getDefaultClassNames()` y se sobreescriben solo los que hace falta pintar.
 */
export type CalendarProps = DayPickerProps;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const defaults = getDefaultClassNames();

  return (
    <DayPicker
      locale={es}
      showOutsideDays={showOutsideDays}
      className={cn("p-1", className)}
      classNames={{
        ...defaults,
        // `relative` porque el `Nav` es hijo directo de `Months` y se posiciona absoluto
        // sobre la fila del mes, como en el calendario de shadcn.
        months: cn(defaults.months, "relative flex flex-col gap-4 sm:flex-row"),
        month: cn(defaults.month, "flex flex-col gap-3"),
        month_caption: cn(defaults.month_caption, "flex h-8 items-center justify-center"),
        caption_label: cn(defaults.caption_label, "text-sm font-medium capitalize text-zinc-200"),
        nav: cn(defaults.nav, "flex items-center justify-between absolute inset-x-1 top-1"),
        button_previous: cn(
          defaults.button_previous,
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
        ),
        button_next: cn(
          defaults.button_next,
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
        ),
        month_grid: cn(defaults.month_grid, "w-full border-collapse"),
        weekdays: cn(defaults.weekdays, "flex"),
        weekday: cn(
          defaults.weekday,
          "w-8 text-[11px] font-normal uppercase text-zinc-500"
        ),
        week: cn(defaults.week, "mt-1 flex w-full"),
        day: cn(defaults.day, "h-8 w-8 p-0 text-center text-sm"),
        day_button: cn(
          defaults.day_button,
          "inline-flex h-8 w-8 items-center justify-center rounded-md font-normal text-zinc-200 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        ),
        // El rango: extremos llenos y el medio tenue, para que se lea como un tramo.
        selected: cn(defaults.selected, "[&>button]:bg-teal-500/20 [&>button]:text-teal-200"),
        range_start: cn(
          defaults.range_start,
          "rounded-l-md [&>button]:bg-teal-500 [&>button]:font-medium [&>button]:text-zinc-950 [&>button]:hover:bg-teal-400"
        ),
        range_end: cn(
          defaults.range_end,
          "rounded-r-md [&>button]:bg-teal-500 [&>button]:font-medium [&>button]:text-zinc-950 [&>button]:hover:bg-teal-400"
        ),
        range_middle: cn(defaults.range_middle, "bg-teal-500/10 [&>button]:rounded-none"),
        today: cn(defaults.today, "[&>button]:font-semibold [&>button]:text-teal-300"),
        outside: cn(defaults.outside, "[&>button]:text-zinc-600"),
        disabled: cn(defaults.disabled, "[&>button]:text-zinc-700 [&>button]:line-through"),
        hidden: cn(defaults.hidden, "invisible"),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" {...chevronProps} />
          ) : (
            <ChevronRight className="h-4 w-4" {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}
