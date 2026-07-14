export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window in-memory rate limiter.
 *
 * NOTE: state lives in this module's scope on a single server instance. On
 * serverless (Vercel) each cold-started instance keeps its own buckets, so
 * this throttles casual brute-force but is NOT a distributed guarantee. For
 * strong cross-instance protection, back this with Upstash Redis or a DB.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Drop expired buckets opportunistically to bound memory. */
function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}
