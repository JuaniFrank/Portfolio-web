import { redirect } from "next/navigation";
import { loadDividendsPageData } from "@/lib/dividends/load-page";
import { DividendsPage } from "@/components/dividends/dividends-page";

export default async function DividendsRoutePage() {
  const data = await loadDividendsPageData();

  if ("error" in data) {
    redirect("/login");
  }

  return <DividendsPage data={data} />;
}
