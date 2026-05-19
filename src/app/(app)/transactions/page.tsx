import { redirect } from "next/navigation";
import { getTransactionsPageDataAction } from "@/app/actions/transactions";
import { TransactionsPage } from "@/components/transactions/transactions-page";

export default async function TransactionsRoutePage() {
  const data = await getTransactionsPageDataAction();

  if ("error" in data) {
    redirect("/login");
  }

  return <TransactionsPage data={data} />;
}
