"use client";

import dynamic from "next/dynamic";
import { ChartBlockSkeleton } from "@/components/layout/page-skeletons";

/**
 * `lightweight-charts` is heavy and only needed once the chart paints, so the chart is
 * code-split. Client-only (`ssr: false` is only allowed from a Client Component): the
 * chart reads the DOM and has no meaningful server markup anyway.
 */
export const PortfolioEvolutionChartLazy = dynamic(
  () => import("./portfolio-evolution").then((m) => m.PortfolioEvolutionChart),
  { ssr: false, loading: () => <ChartBlockSkeleton heightClass="h-80" /> }
);
