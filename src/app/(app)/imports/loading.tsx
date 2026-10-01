import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <TableSkeleton rows={10} columns={7} />
    </div>
  );
}
