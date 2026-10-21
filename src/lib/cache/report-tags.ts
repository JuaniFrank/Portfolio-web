/**
 * Cache tags for the heavy per-user reports (/rendimientos). **Pure module.**
 *
 * Every cached report carries the user tag (invalidated when that user's transactions
 * change) and a global tag (invalidated by data shared across users, such as corporate
 * events and bond terms, which are keyed by instrument and not by user).
 */

export const ALL_REPORTS_TAG = "reports:all";

export function userReportTag(userId: string): string {
  return `reports:user:${userId}`;
}

export function reportTagsFor(userId: string): string[] {
  return [userReportTag(userId), ALL_REPORTS_TAG];
}
