import { redirect } from "next/navigation";
import { getImportedTransactionsAction } from "@/app/actions/imports";
import { ImportsListPage } from "@/components/imports/imports-list-page";

export default async function ImportsPage() {
  const result = await getImportedTransactionsAction();

  if ("error" in result) {
    redirect("/login");
  }

  return <ImportsListPage transactions={result} />;
}
