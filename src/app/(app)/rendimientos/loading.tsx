import { ChartBlockSkeleton, KpiCardRowSkeleton, PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <KpiCardRowSkeleton count={4} />
      <ChartBlockSkeleton heightClass="h-64" />
      <TableSkeleton rows={6} columns={6} />
    </div>
  );
}
