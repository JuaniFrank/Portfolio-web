import { redirect } from "next/navigation";
import { loadCorporateEvents, loadPortfolioInstruments } from "@/lib/events/load-page";
import { loadSuggestedCorporateEvents } from "@/lib/events/load-suggested";
import { EventsPage } from "@/components/events/events-page";

export default async function EventsRoutePage() {
  const [eventsResult, instrumentsResult, suggestionsResult] = await Promise.all([
    loadCorporateEvents(),
    loadPortfolioInstruments(),
    loadSuggestedCorporateEvents(),
  ]);

  if ("error" in eventsResult || "error" in instrumentsResult || "error" in suggestionsResult) {
    redirect("/login");
  }

  return (
    <EventsPage
      initialEvents={eventsResult}
      instruments={instrumentsResult}
      initialSuggestions={suggestionsResult}
    />
  );
}
