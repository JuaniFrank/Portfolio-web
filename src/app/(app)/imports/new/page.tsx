import { redirect } from "next/navigation";
import { loadImportContext } from "@/lib/imports/load-page";
import { NewImportPageClient } from "@/components/imports/new-import-page";

export default async function NewImportPage() {
  const context = await loadImportContext();

  if ("error" in context) {
    redirect("/login");
  }

  return <NewImportPageClient context={context} />;
}
