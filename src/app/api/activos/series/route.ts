import { getCurrentUser } from "@/lib/auth";
import { seriesInputSchema } from "@/lib/monitoreo/api-schemas";
import { fetchMonitoringSeries } from "@/lib/monitoreo/load-series";

// Per-user data read at request time: never cache.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = seriesInputSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return Response.json({ error: "Parámetros de consulta no válidos" }, { status: 400 });
  }

  const series = await fetchMonitoringSeries(parsed.data);
  if (!series) {
    return Response.json(
      { error: "Instrumento no encontrado o no disponible" },
      { status: 404 }
    );
  }
  return Response.json(series, { headers: { "Cache-Control": "no-store" } });
}
