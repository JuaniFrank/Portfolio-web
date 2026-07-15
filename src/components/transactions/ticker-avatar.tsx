"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { logoCandidates } from "@/lib/market/logos";
import { cn } from "@/lib/utils";

const COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-orange-600",
];

function colorForTicker(ticker: string) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

/**
 * Company/asset logo, resolved through an ordered list of provider URLs
 * (see logoCandidates). Each failed request advances to the next candidate;
 * once all are exhausted — ONs, unknown tickers — we render the colored
 * initials square.
 */
export function TickerAvatar({ ticker, className }: { ticker: string; className?: string }) {
  const candidates = useMemo(() => logoCandidates(ticker), [ticker]);
  const [attempt, setAttempt] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const label = ticker.slice(0, 2).toUpperCase();

  const exhausted = attempt >= candidates.length;

  // A 404 can fire before React attaches onError (SSR → hydration race), which
  // would otherwise leave a broken-image icon. On mount / each new candidate,
  // check if the current image already failed and advance manually.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setAttempt((a) => a + 1);
    }
  }, [attempt]);

  if (exhausted) {
    return (
      <span
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white",
          colorForTicker(ticker),
          className
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white",
        className
      )}
    >
      {/* External logo CDNs with per-ticker 404s and a multi-candidate fallback
          chain — not a fit for next/image optimization, so a plain img is
          intentional. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={candidates[attempt]}
        ref={imgRef}
        src={candidates[attempt]}
        alt={ticker}
        width={32}
        height={32}
        loading="lazy"
        className="h-full w-full object-contain"
        onError={() => setAttempt((a) => a + 1)}
      />
    </span>
  );
}
