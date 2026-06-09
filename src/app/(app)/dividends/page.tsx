import { redirect } from "next/navigation";
import { getDividendsPageDataAction } from "@/app/actions/dividends";
import { DividendsPage } from "@/components/dividends/dividends-page";

export default async function DividendsRoutePage() {
  const data = await getDividendsPageDataAction();

  if ("error" in data) {
    redirect("/login");
  }

  return <DividendsPage data={data} />;
}
