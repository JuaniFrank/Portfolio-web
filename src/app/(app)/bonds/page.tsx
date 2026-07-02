import { redirect } from "next/navigation";
import { getBondsPageDataAction } from "@/app/actions/bonds";
import { BondsPage } from "@/components/bonds/bonds-page";

export default async function BondsRoutePage() {
  const data = await getBondsPageDataAction();

  if ("error" in data) {
    redirect("/login");
  }

  return <BondsPage data={data} />;
}
