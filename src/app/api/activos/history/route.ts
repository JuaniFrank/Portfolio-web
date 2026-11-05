import { getCurrentUser } from "@/lib/auth";
import { seriesInputSchema } from "@/lib/monitoreo/api-schemas";
import { loadMonitoringHistory } from "@/lib/monitoreo/load-history";

// POST: it persists missing bars, so it is never cached or prefetched.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = seriesInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Parámetros de consulta no válidos" }, { status: 400 });
  }

  const series = await loadMonitoringHistory(parsed.data);
  if (!series) {
    return Response.json({ error: "Instrumento no encontrado" }, { status: 404 });
  }
  return Response.json(series, { headers: { "Cache-Control": "no-store" } });
}
