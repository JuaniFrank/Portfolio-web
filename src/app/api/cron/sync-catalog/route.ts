import { syncInstrumentCatalog } from "@/lib/market/catalog-sync";

// Vercel Cron hits this on a schedule (see vercel.json). Requests carry
// `Authorization: Bearer $CRON_SECRET`, which we verify so the endpoint can't
// be triggered by anyone who guesses the URL.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await syncInstrumentCatalog();
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
