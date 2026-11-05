import { redirect } from "next/navigation";

/** Legacy route: `/monitoreo` now lives at `/activos`; the query string is preserved. */
export default async function MonitoreoRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  redirect(qs ? `/activos?${qs}` : "/activos");
}
