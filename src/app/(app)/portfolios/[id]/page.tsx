import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export default async function PortfolioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SectionPlaceholder title="Portfolios" subtitle={`ID: ${id}`} />;
}
