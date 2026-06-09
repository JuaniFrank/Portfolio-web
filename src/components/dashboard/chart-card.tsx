import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function ChartCard({ title, description, icon, headerExtra, children, className }: Props) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 lg:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-50">
            {icon ? <span className="text-teal-400">{icon}</span> : null}
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-xs text-zinc-500">{description}</p>
          ) : null}
        </div>
        {headerExtra ? <div className="shrink-0">{headerExtra}</div> : null}
      </div>
      {children}
    </div>
  );
}
