import { redirect } from "next/navigation";
import { loadMonitoringBootstrap } from "@/lib/monitoreo/load-bootstrap";
import { MonitoreoPage } from "@/components/monitoreo/monitoreo-page";

export const metadata = {
  title: "Monitoreo | Portafolio",
  description: "Monitoreo y análisis técnico de precios de mercado",
};

export default async function MonitoreoRoutePage() {
  const data = await loadMonitoringBootstrap();

  if ("error" in data) {
    redirect("/login");
  }

  return <MonitoreoPage initialData={data} />;
}
