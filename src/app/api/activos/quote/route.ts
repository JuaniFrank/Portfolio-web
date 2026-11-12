import { getCurrentUser } from "@/lib/auth";
import { quoteInputSchema } from "@/lib/monitoreo/api-schemas";
import { fetchMarketQuote } from "@/lib/monitoreo/load-quote";

// Live market price read at request time: never cache.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = quoteInputSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Parámetros de consulta no válidos" }, { status: 400 });
  }

  const quote = await fetchMarketQuote(parsed.data);
  if (!quote) {
    return Response.json({ error: "Instrumento no encontrado o no disponible" }, { status: 404 });
  }
  return Response.json(quote, { headers: { "Cache-Control": "no-store" } });
}
