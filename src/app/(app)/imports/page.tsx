import { redirect } from "next/navigation";
import { loadImportedTransactions } from "@/lib/imports/load-page";
import { ImportsListPage } from "@/components/imports/imports-list-page";

export default async function ImportsPage() {
  const result = await loadImportedTransactions();

  if ("error" in result) {
    redirect("/login");
  }

  return <ImportsListPage transactions={result} />;
}
