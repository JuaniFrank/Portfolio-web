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

export function TickerAvatar({ ticker, className }: { ticker: string; className?: string }) {
  const label = ticker.slice(0, 2).toUpperCase();
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
