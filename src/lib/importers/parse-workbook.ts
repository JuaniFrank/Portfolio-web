import * as XLSX from "xlsx";
import {
  BALANZ_SHEET_NAME,
  parseBalanzRows,
  readBalanzSheetRows,
} from "./balanz";
import type { BalanzRawRow, BrokerImportCode, ImportPreviewSummary } from "./types";

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseBalanzWorkbook(
  workbook: XLSX.WorkBook,
  options: { fileName: string; fileHash: string }
): ImportPreviewSummary {
  const sheetName = workbook.SheetNames.includes(BALANZ_SHEET_NAME)
    ? BALANZ_SHEET_NAME
    : workbook.SheetNames[0];

  if (!sheetName) {
    return {
      brokerCode: "BALANZ",
      fileName: options.fileName,
      fileKind: "XLSX",
      fileHash: options.fileHash,
      rows: [],
      stats: { total: 0, valid: 0, warning: 0, invalid: 0 },
    };
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      brokerCode: "BALANZ",
      fileName: options.fileName,
      fileKind: "XLSX",
      fileHash: options.fileHash,
      rows: [],
      stats: { total: 0, valid: 0, warning: 0, invalid: 0 },
    };
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  const rawRows = readBalanzSheetRows(matrix);
  return parseBalanzRows(rawRows, options);
}

export async function parseImportFile(
  brokerCode: BrokerImportCode,
  file: File
): Promise<ImportPreviewSummary> {
  const buffer = await file.arrayBuffer();
  const fileHash = await sha256Hex(buffer);

  if (brokerCode === "BALANZ") {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    return parseBalanzWorkbook(workbook, { fileName: file.name, fileHash });
  }

  throw new Error(`Broker no soportado: ${brokerCode}`);
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
