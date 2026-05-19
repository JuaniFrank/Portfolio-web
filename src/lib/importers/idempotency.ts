import { createHash } from "crypto";
import type { ParsedImportRowData } from "./types";

export function buildImportIdempotencyHash(input: {
  brokerAccountId: string;
  row: ParsedImportRowData;
  rowNumber: number;
}): string {
  const { brokerAccountId, row, rowNumber } = input;
  const payload = [
    brokerAccountId,
    row.externalId ?? "",
    row.tradeDate,
    row.type,
    row.ticker ?? "",
    row.currencyCode,
    row.quantity,
    row.netAmount,
    String(rowNumber),
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}
