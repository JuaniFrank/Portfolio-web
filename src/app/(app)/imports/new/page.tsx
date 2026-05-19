import { redirect } from "next/navigation";
import { getImportContextAction } from "@/app/actions/imports";
import { NewImportPageClient } from "@/components/imports/new-import-page";

export default async function NewImportPage() {
  const context = await getImportContextAction();

  if ("error" in context) {
    redirect("/login");
  }

  return <NewImportPageClient context={context} />;
}
