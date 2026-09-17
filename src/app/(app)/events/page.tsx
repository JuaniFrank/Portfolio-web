import { redirect } from "next/navigation";
import { listCorporateEvents, listPortfolioInstruments } from "@/app/actions/events";
import { listSuggestedCorporateEvents } from "@/app/actions/suggested-events";
import { EventsPage } from "@/components/events/events-page";

export default async function EventsRoutePage() {
  const [eventsResult, instrumentsResult, suggestionsResult] = await Promise.all([
    listCorporateEvents(),
    listPortfolioInstruments(),
    listSuggestedCorporateEvents(),
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
