import { redirect } from "next/navigation";
import { loadBondsPageData } from "@/lib/bonds/load-page";
import { BondsPage } from "@/components/bonds/bonds-page";

export default async function BondsRoutePage() {
  const data = await loadBondsPageData();

  if ("error" in data) {
    redirect("/login");
  }

  return <BondsPage data={data} />;
}
