import { cn } from "@/lib/utils";

type SegmentTone = "default" | "buy" | "sell";

const ACTIVE_TONE: Record<SegmentTone, string> = {
  default: "bg-sky-950/60 text-sky-200",
  buy: "bg-emerald-950/70 text-emerald-300",
  sell: "bg-rose-950/70 text-rose-300",
};

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  tone?: SegmentTone;
  disabled?: boolean;
  title?: string;
};

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Compact segmented control (one pressed option at a time) in the page's dark zinc style. */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/80"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
              active ? ACTIVE_TONE[option.tone ?? "default"] : "text-zinc-400 hover:text-zinc-100"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
