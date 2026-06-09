import { redirect } from "next/navigation";
import { getDashboardPageDataAction } from "@/app/actions/dashboard";
import { DashboardPage } from "@/components/dashboard/dashboard-page";

export default async function DashboardRoutePage() {
  const data = await getDashboardPageDataAction();

  if ("error" in data) {
    redirect("/login");
  }

  return <DashboardPage data={data} />;
}
