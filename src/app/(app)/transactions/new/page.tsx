import { redirect } from "next/navigation";

// Manual entry now lives in a modal on /transactions. Keep this route as a
// redirect so any old links land on the working page instead of a dead stub.
export default function NewTransactionPage() {
  redirect("/transactions");
}
