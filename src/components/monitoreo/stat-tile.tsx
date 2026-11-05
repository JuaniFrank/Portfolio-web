import { cn } from "@/lib/utils";

export type StatTone = "positive" | "negative" | "neutral";

const TONE_CLASS: Record<StatTone, string> = {
  positive: "text-emerald-400",
  negative: "text-rose-400",
  neutral: "text-zinc-100",
};

export function toneForValue(value: number | null | undefined): StatTone {
  if (value === null || value === undefined || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
  /** Native tooltip, used to explain a "—" value */
  title?: string;
}

/** Compact tile meant to flow inside a `flex flex-wrap` strip. */
export function StatTile({ label, value, sub, tone = "neutral", title }: StatTileProps) {
  return (
    <div
      className="min-w-[104px] flex-1 rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-1"
      title={title}
    >
      <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={cn("truncate font-mono text-sm font-semibold leading-tight", TONE_CLASS[tone])}>
        {value}
        {sub && <span className="ml-1.5 text-[11px] font-normal">{sub}</span>}
      </p>
    </div>
  );
}
