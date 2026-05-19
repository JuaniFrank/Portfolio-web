import type { InstrumentType, TransactionType } from "@/lib/generated/prisma";

export type ImportFileKind = "CSV" | "XLSX";

export type BrokerImportCode = "BALANZ" | "COCOS" | "IOL";

export type ImportRowStatus = "valid" | "warning" | "invalid";

/** Fila cruda del export de movimientos Balanz (hoja "movimientos"). */
export interface BalanzRawRow {
  Descripcion: string;
  Ticker: string;
  "Tipo de Instrumento": string;
  Concertacion: string;
  Cantidad: number;
  Precio: number;
  Liquidacion: string;
  Moneda: string;
  Importe: number;
}

export interface ParsedImportRowData {
  type: TransactionType;
  tradeDate: string;
  settlementDate: string;
  ticker: string | null;
  instrumentType: InstrumentType | null;
  quantity: string;
  price: string | null;
  currencyCode: string;
  grossAmount: string;
  netAmount: string;
  externalId: string | null;
  description: string;
}

export interface NormalizedImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  messages: string[];
  raw: BalanzRawRow;
  parsed?: ParsedImportRowData;
}

export interface ImportPreviewSummary {
  brokerCode: BrokerImportCode;
  fileName: string;
  fileKind: ImportFileKind;
  fileHash: string;
  rows: NormalizedImportRow[];
  stats: {
    total: number;
    valid: number;
    warning: number;
    invalid: number;
  };
}

/** Payload serializable para commit desde el cliente. */
export interface CommitImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  parsed: ParsedImportRowData;
}
