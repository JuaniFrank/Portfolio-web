"use client";

import type { CorporateEventDTO } from "@/lib/events/types";
import { formatRatio, formatEventTypeLabel } from "./format";
import { EventDeleteDialog } from "./event-delete-dialog";

type Props = {
  events: CorporateEventDTO[];
  onEventDeleted: (id: string) => void;
};

export function EventsList({ events, onEventDeleted }: Props) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 py-16 text-center">
        <p className="text-sm text-zinc-400">No hay eventos registrados.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-800 bg-zinc-900/60">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Ticker</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Tipo</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Fecha efectiva</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Ratio</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Notas</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {events.map((event) => (
            <tr key={event.id} className="bg-zinc-950/40 hover:bg-zinc-900/40">
              <td className="px-4 py-3 font-medium text-zinc-100">{event.ticker}</td>
              <td className="px-4 py-3 text-zinc-300">{formatEventTypeLabel(event.eventType)}</td>
              <td className="px-4 py-3 text-zinc-300">{event.effectiveDate}</td>
              <td className="px-4 py-3 font-mono text-zinc-300">
                {formatRatio(event.numerator, event.denominator)}
              </td>
              <td className="max-w-[200px] truncate px-4 py-3 text-zinc-400" title={event.notes ?? undefined}>
                {event.notes ?? "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <EventDeleteDialog
                  eventId={event.id}
                  ticker={event.ticker}
                  onDeleted={onEventDeleted}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
