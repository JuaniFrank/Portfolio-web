import { syncInstrumentCatalog } from "@/lib/market/catalog-sync";

// Vercel Cron hits this on a schedule (see vercel.json). Requests carry
// `Authorization: Bearer $CRON_SECRET`, which we verify so the endpoint can't
// be triggered by anyone who guesses the URL.
export const dynamic = "force-dynamic";
// 300s (design §9.2, T-54): the reordered pipeline now includes the AD-12
// currency-oracle fan-out (~70 batched requests) and AD-13's whole-universe
// ISIN linking pass on top of the original ingestion work. `backfill-prices`
// already proves 300 works on this Vercel plan.
export const maxDuration = 300;

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
