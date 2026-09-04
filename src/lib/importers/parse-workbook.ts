import { getBrokerAnalyzer } from "./registry";
import { parseBalanzRows } from "./balanz";
import type { BalanzRawRow, BrokerImportCode, ImportPreviewSummary } from "./types";

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function parseImportFile(
  brokerCode: BrokerImportCode,
  file: File
): Promise<ImportPreviewSummary> {
  const buffer = await file.arrayBuffer();
  const fileHash = await sha256Hex(buffer);

  const analyzer = getBrokerAnalyzer(brokerCode);
  return analyzer.parse(buffer, { fileName: file.name, fileHash });
}

/** Parsea filas crudas (útil para tests con fixture JSON). */
export function parseBalanzFixtureRows(
  rows: BalanzRawRow[],
  options: { fileName: string; fileHash?: string }
): ImportPreviewSummary {
  return parseBalanzRows(rows, {
    fileName: options.fileName,
    fileHash: options.fileHash ?? "fixture",
  });
}
