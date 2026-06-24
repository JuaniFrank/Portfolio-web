import { redirect } from "next/navigation";
import { listCorporateEvents, listPortfolioInstruments } from "@/app/actions/events";
import { EventsPage } from "@/components/events/events-page";

export default async function EventsRoutePage() {
  const [eventsResult, instrumentsResult] = await Promise.all([
    listCorporateEvents(),
    listPortfolioInstruments(),
  ]);

  if ("error" in eventsResult || "error" in instrumentsResult) {
    redirect("/login");
  }

  return (
    <EventsPage
      initialEvents={eventsResult}
      instruments={instrumentsResult}
    />
  );
}
