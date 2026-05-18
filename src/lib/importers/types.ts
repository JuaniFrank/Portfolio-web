/**
 * Tipos compartidos para importadores de extractos (CSV/XLSX) por broker.
 * TODO: definir el shape real de filas normalizadas cuando existan parsers.
 */
export type ImportFileKind = "CSV" | "XLSX";

export type ImportRowStatus = "pending" | "valid" | "invalid";

export interface NormalizedImportRow {
  /** Identificador estable dentro del archivo (1..N) */
  rowNumber: number;
  status: ImportRowStatus;
  /** Mensajes de validación / parseo */
  messages: string[];
}

export interface ImportPreviewSummary {
  fileName: string;
  fileKind: ImportFileKind;
  rows: NormalizedImportRow[];
}
