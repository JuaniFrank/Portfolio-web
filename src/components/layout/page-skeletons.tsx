import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Building blocks for `loading.tsx` fallbacks and Suspense fallbacks. Server components
 * on purpose: they ship no JS and render from the prefetched fallback on navigation.
 * Dimensions mirror the real sections (h1 = text-3xl, KPI cards = p-4 …) so swapping a
 * skeleton for its content does not shift the layout.
 */

/** Title (text-3xl) + two-line description, optionally with a right-aligned action. */
export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-2/3 max-w-xl" />
      </div>
      {withAction ? <Skeleton className="h-9 w-32 shrink-0" /> : null}
    </div>
  );
}

const KPI_GRID: Record<number, string> = {
  2: "grid-cols-2",
  3: "sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 lg:grid-cols-5",
};

/** Row of KPI cards (label, value, sub-line). */
export function KpiCardRowSkeleton({ count = 4 }: { count?: 2 | 3 | 4 | 5 }) {
  return (
    <div className={cn("grid gap-3", KPI_GRID[count])}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-6 w-32" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Card with a title line and a chart-sized block. */
export function ChartBlockSkeleton({
  heightClass = "h-72",
  className,
}: {
  heightClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border-2 border-zinc-800 bg-zinc-900/40 p-4 lg:p-5", className)}>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="mt-2 h-3 w-72 max-w-full" />
      <Skeleton className={cn("mt-4 w-full", heightClass)} />
    </div>
  );
}

/** Bordered table with a header strip and `rows` body rows. */
export function TableSkeleton({
  rows = 8,
  columns = 6,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/30", className)}>
      <div className="flex gap-4 border-b border-zinc-800 p-4">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-zinc-800/60 p-4 last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
