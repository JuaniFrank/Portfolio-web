import { ChartBlockSkeleton, PageHeaderSkeleton } from "@/components/layout/page-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <ChartBlockSkeleton heightClass="h-[28rem]" />
    </div>
  );
}
