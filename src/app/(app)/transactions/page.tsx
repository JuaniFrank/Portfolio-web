import { redirect } from "next/navigation";
import { loadTransactionsPageData } from "@/lib/transactions/load-page";
import { TransactionsPage } from "@/components/transactions/transactions-page";

export default async function TransactionsRoutePage() {
  const data = await loadTransactionsPageData();

  if ("error" in data) {
    redirect("/login");
  }

  return <TransactionsPage data={data} />;
}
