import { KpiCardRowSkeleton, PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <KpiCardRowSkeleton count={3} />
      <TableSkeleton rows={10} columns={7} />
    </div>
  );
}
