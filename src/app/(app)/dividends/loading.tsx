import { ChartBlockSkeleton, KpiCardRowSkeleton, PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <KpiCardRowSkeleton count={4} />
      <ChartBlockSkeleton heightClass="h-56" />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
