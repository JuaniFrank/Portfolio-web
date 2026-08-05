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
  /** FX embebido por el broker en la fila (ej. CCL del día reportado en "Dólares C.V. 7000"). */
  brokerFxRate: string | null;
}

export interface NormalizedImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  messages: string[];
  raw: BalanzRawRow;
  parsed?: ParsedImportRowData;
  /** True once the user corrected the row by hand in the preview editor. */
  edited?: boolean;
}

/**
 * Fields the preview editor lets the user correct. Everything else in
 * `ParsedImportRowData` is derived and stays under the parser's control.
 */
export type RowPatch = Partial<
  Pick<
    ParsedImportRowData,
    | "type"
    | "tradeDate"
    | "settlementDate"
    | "ticker"
    | "instrumentType"
    | "quantity"
    | "price"
    | "currencyCode"
    | "grossAmount"
    | "netAmount"
  >
>;

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
  /** Se propaga para poder contabilizar cuántas filas se corrigieron a mano. */
  edited?: boolean;
}

/**
 * Qué hacer con las filas cuyo hash de idempotencia ya existe en la base.
 *
 * - `skip`   → se omiten (comportamiento histórico).
 * - `import` → se insertan igual, con `idempotencyVersion` incrementada para no
 *              violar el unique compuesto. El usuario lo elige explícitamente
 *              en el diálogo de duplicados.
 */
export type DuplicateStrategy = "skip" | "import";
