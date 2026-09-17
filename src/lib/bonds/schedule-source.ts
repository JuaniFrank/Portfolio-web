/**
 * Pure precedence resolver (AD-14): read the stored `BondSchedule` when
 * present, fall back to `BondTerms` + `projectCashFlows` only when no
 * `BondSchedule` row exists, and return an empty/no-schedule result — never
 * a throw — when both are absent.
 */

import { projectCashFlows, type BondTermsForProjection, type ProjectedFlow } from "./cashflows";

export type BondScheduleRow = {
  paymentDate: string;
  capital: number;
  interestRate: number;
  interestAmount: number;
  residualValue: number;
  cashFlow: number;
};

export type StoredBondSchedule = { rows: BondScheduleRow[] };

export type ScheduleSourceResult =
  | { source: "docta-schedule"; rows: BondScheduleRow[] }
  | { source: "derived"; flows: ProjectedFlow[] }
  | { source: "none" };

export function resolveBondSchedule(
  storedSchedule: StoredBondSchedule | null,
  terms: BondTermsForProjection | null,
  today: Date = new Date(),
  projectFn: (terms: BondTermsForProjection, today: Date) => ProjectedFlow[] = projectCashFlows
): ScheduleSourceResult {
  if (storedSchedule) {
    return { source: "docta-schedule", rows: storedSchedule.rows };
  }
  if (terms) {
    return { source: "derived", flows: projectFn(terms, today) };
  }
  return { source: "none" };
}
