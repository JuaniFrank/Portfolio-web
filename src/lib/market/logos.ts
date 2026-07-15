/**
 * Logo URL resolution for instrument tickers.
 *
 * Provider chain, best-first (all automatic — no hardcoded ticker maps):
 *   1. logo.dev, plain ticker — resolves US-symbol CEDEARs (AAPL, IBIT).
 *   2. logo.dev, `{ticker}.BA` — resolves BYMA-local Argentine stocks
 *      (YPFD.BA, PAMP.BA, ALUA.BA) the same way Yahoo uses the .BA suffix.
 *   3. Cocos Capital — Argentine broker keyed by the raw local ticker; safety
 *      net for anything logo.dev misses. Keyless.
 * `fallback=404` forces logo.dev to 404 on unknown tickers instead of returning
 * a generated monogram, so the chain can advance. Exhausting the list (ONs,
 * illiquid names) → the caller renders initials.
 *
 * logo.dev needs a publishable token (NEXT_PUBLIC_LOGO_DEV_TOKEN); without one
 * the chain starts at Cocos.
 */

const LOGO_DEV_TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

function logoDevUrl(symbol: string): string {
  const params = new URLSearchParams({
    token: LOGO_DEV_TOKEN ?? "",
    format: "png",
    retina: "true",
    fallback: "404",
  });
  return `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?${params.toString()}`;
}

function cocosUrl(symbol: string): string {
  return `https://assets.cocos.capital/cocos/logos/${encodeURIComponent(symbol)}.jpg`;
}

/**
 * Ordered, de-duplicated logo URLs to try for a ticker. Iterate on <img> error;
 * when exhausted, fall back to initials.
 */
export function logoCandidates(ticker: string): string[] {
  const t = ticker.trim().toUpperCase();
  const urls: string[] = [];

  if (LOGO_DEV_TOKEN) {
    urls.push(logoDevUrl(t));
    urls.push(logoDevUrl(`${t}.BA`));
  }
  urls.push(cocosUrl(t));

  return [...new Set(urls)];
}
