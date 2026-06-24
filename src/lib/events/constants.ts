import type { TransactionType } from "@/lib/generated/prisma";

/** Transaction types that produce a position (used in preview math). */
export const HOLDABLE_TRADE_TYPES: TransactionType[] = ["BUY", "SELL"];
