import { redirect } from "next/navigation";
import { loadMonitoringBootstrap } from "@/lib/monitoreo/load-bootstrap";
import { parseView } from "@/lib/monitoreo/activos-selection";
import { MonitoreoPage } from "@/components/monitoreo/monitoreo-page";

export const metadata = {
  title: "Activos | Portafolio",
  description: "Precio histórico de cada activo junto con tus operaciones",
};

function firstParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v : null;
}

export default async function ActivosRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const data = await loadMonitoringBootstrap({
    ticker: firstParam(params.ticker),
    vista: parseView(firstParam(params.vista)),
  });

  if ("error" in data) {
    redirect("/login");
  }

  return <MonitoreoPage initialData={data} />;
}
