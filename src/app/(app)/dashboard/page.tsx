import { redirect } from "next/navigation";
import { loadDashboardPageData } from "@/lib/dashboard/load-page";
import { DashboardPage } from "@/components/dashboard/dashboard-page";

export default async function DashboardRoutePage() {
  const result = await loadDashboardPageData();

  if ("error" in result) {
    redirect("/login");
  }

  return <DashboardPage data={result.data} evolution={result.evolution} />;
}
