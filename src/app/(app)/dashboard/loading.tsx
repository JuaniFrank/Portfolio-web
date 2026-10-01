import { ChartBlockSkeleton, KpiCardRowSkeleton, PageHeaderSkeleton } from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <KpiCardRowSkeleton count={4} />
      <KpiCardRowSkeleton count={4} />
      <ChartBlockSkeleton heightClass="h-80" />
    </div>
  );
}
