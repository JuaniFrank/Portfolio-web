"use client";

import { useState } from "react";
import { CalendarSync } from "lucide-react";
import type { CorporateEventDTO } from "@/lib/events/types";
import { resolveApplicableRecommendations } from "@/lib/events/recommended";
import { EventsList } from "./events-list";
import { EventFormDialog } from "./event-form-dialog";
import { RecommendedEvents } from "./recommended-events";

type InstrumentOption = {
  id: string;
  ticker: string;
  name: string;
};

type Props = {
  initialEvents: CorporateEventDTO[];
  instruments: InstrumentOption[];
};

export function EventsPage({ initialEvents, instruments }: Props) {
  const [events, setEvents] = useState<CorporateEventDTO[]>(initialEvents);

  function handleEventCreated(newEvent: CorporateEventDTO) {
    setEvents((prev) =>
      [...prev, newEvent].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    );
  }

  function handleEventDeleted(deletedId: string) {
    setEvents((prev) => prev.filter((e) => e.id !== deletedId));
  }

  // KPIs
  const eventCount = events.length;
  const lastDate =
    events.length > 0 ? events[0]!.effectiveDate : null;
  const distinctInstruments = new Set(events.map((e) => e.instrumentId)).size;

  // Recomputed each render: once an event is applied it lands in `events`,
  // so the matching recommendation drops out automatically.
  const recommendations = resolveApplicableRecommendations(instruments, events);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarSync className="h-5 w-5 text-zinc-400" />
            <h1 className="text-xl font-semibold text-zinc-100">Eventos Corporativos</h1>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Splits, ratios y ajustes que afectan tus posiciones históricas
          </p>
        </div>
        <EventFormDialog
          instruments={instruments}
          onCreated={handleEventCreated}
        />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs text-zinc-500">Total eventos</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">{eventCount}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs text-zinc-500">Último evento</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            {lastDate ?? "—"}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs text-zinc-500">Instrumentos</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">{distinctInstruments}</p>
        </div>
      </div>

      {/* Suggested events (curated, one-click apply) */}
      <RecommendedEvents
        recommendations={recommendations}
        onApplied={handleEventCreated}
      />

      {/* Events list */}
      <EventsList
        events={events}
        onEventDeleted={handleEventDeleted}
      />

      {/* Empty state secondary CTA */}
      {events.length === 0 && (
        <div className="text-center">
          <p className="text-sm text-zinc-500">
            Registrá tu primer evento usando el botón de arriba.
          </p>
        </div>
      )}
    </div>
  );
}
