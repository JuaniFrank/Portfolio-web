import { redirect } from "next/navigation";
import { getDashboardPageDataAction } from "@/app/actions/dashboard";
import { DashboardPage } from "@/components/dashboard/dashboard-page";

export default async function DashboardRoutePage() {
  const result = await getDashboardPageDataAction();

  if ("error" in result) {
    redirect("/login");
  }

  return <DashboardPage data={result.data} evolution={result.evolution} />;
}
