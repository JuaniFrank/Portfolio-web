import { getCurrentUser } from "@/lib/auth";
import { tradesInputSchema } from "@/lib/monitoreo/api-schemas";
import { loadInstrumentTradeData } from "@/lib/monitoreo/load-trade-data";

// Per-user data read at request time: never cache.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = tradesInputSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return Response.json({ error: "Parámetros de consulta no válidos" }, { status: 400 });
  }

  const data = await loadInstrumentTradeData(user.id, parsed.data.instrumentId);
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
