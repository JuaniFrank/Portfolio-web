export type ViewCurrency = "ARS" | "USD";

export type PerformancePoint = {
  date: string;
  valueArs: number;
  valueUsd: number;
  depositsArs: number;
  depositsUsd: number;
  benchmarkClose: number | null;
  dailyReturnArs: number | null;
  dailyReturnUsd: number | null;
  drawdownArs: number;
  drawdownUsd: number;
};

export type MonthlyReturn = {
  year: number;
  month: number;
  returnArs: number | null;
  returnUsd: number | null;
};

export type PerformanceSummary = {
  totalReturnArs: number | null;
  totalReturnUsd: number | null;
  gainVsDepositsArs: number | null;
  gainVsDepositsUsd: number | null;
  dailyReturnArs: number | null;
  dailyReturnUsd: number | null;
  weeklyReturnArs: number | null;
  weeklyReturnUsd: number | null;
  monthlyReturnArs: number | null;
  monthlyReturnUsd: number | null;
  maxDrawdownArs: number;
  maxDrawdownUsd: number;
};

export type PerformanceData = {
  portfolioName: string;
  points: PerformancePoint[];
  monthlyReturns: MonthlyReturn[];
  summary: PerformanceSummary;
  lastSnapshotDate: string | null;
  latestSnapshot: {
    cashArs: number;
    cashUsd: number;
    twrSinceInception: number | null;
    positions: unknown;
  } | null;
  benchmarkAvailable: boolean;
};

export type ChartPoint = {
  date: string;
  value: number;
  deposits: number;
  portfolioIndex: number;
  benchmarkIndex: number | null;
  drawdown: number;
};
