import Decimal from "decimal.js";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import type {
  BalanzRawRow,
  BrokerImportCode,
  ImportPreviewSummary,
  ImportRowStatus,
  NormalizedImportRow,
  ParsedImportRowData,
} from "./types";

export const BALANZ_SHEET_NAME = "movimientos";

const HEADER_KEYS: (keyof BalanzRawRow)[] = [
  "Descripcion",
  "Ticker",
  "Tipo de Instrumento",
  "Concertacion",
  "Cantidad",
  "Precio",
  "Liquidacion",
  "Moneda",
  "Importe",
];

export function isBalanzRawRow(row: unknown): row is BalanzRawRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return HEADER_KEYS.every((k) => k in r);
}

export function mapBalanzCurrency(moneda: string): string {
  const m = moneda.trim().toLowerCase();
  if (m === "pesos") return "ARS";
  if (m === "dólares" || m.startsWith("dólares")) return "USD";
  return "ARS";
}

export function mapBalanzInstrumentType(tipo: string): InstrumentType | null {
  switch (tipo.trim()) {
    case "Cedears":
      return InstrumentType.CEDEAR;
    case "Acciones":
      return InstrumentType.STOCK_AR;
    case "Bonos":
      return InstrumentType.BOND_AR;
    case "Letras":
      return InstrumentType.LETRA;
    case "Corporativos":
      return InstrumentType.ON;
    default:
      return null;
  }
}

function parseBalanzDescription(descripcion: string): {
  category: string;
  side?: "COMPRA" | "VENTA";
  externalId?: string;
  tickerFromDesc?: string;
} {
  const parts = descripcion.split("/").map((p) => p.trim());
  const category = parts[0] ?? descripcion;

  if (category === "Boleto" && parts.length >= 5) {
    return {
      category,
      externalId: parts[1],
      side: parts[2] as "COMPRA" | "VENTA",
      tickerFromDesc: parts[4],
    };
  }

  if (category === "Dividendo en efectivo" && parts[1]) {
    return { category, tickerFromDesc: parts[1].trim() };
  }

  if (category === "Amortización" && parts[1]) {
    return { category, tickerFromDesc: parts[1].trim() };
  }

  if (category === "Movimiento Manual") {
    const tickerMatch = descripcion.match(/-\s*([A-Z0-9.]+)\s*$/i);
    return { category, tickerFromDesc: tickerMatch?.[1]?.trim() };
  }

  return { category };
}

function resolveTransactionType(
  category: string,
  side: "COMPRA" | "VENTA" | undefined,
  descripcion: string
): TransactionType | null {
  switch (category) {
    case "Boleto":
      if (side === "COMPRA") return TransactionType.BUY;
      if (side === "VENTA") return TransactionType.SELL;
      if (/licitaci[oó]n/i.test(descripcion)) return TransactionType.BUY;
      return null;
    case "Dividendo en efectivo":
      return TransactionType.DIVIDEND_CASH;
    case "Recibo de Cobro":
      return TransactionType.DEPOSIT;
    case "Comprobante de Pago":
      return TransactionType.WITHDRAWAL;
    case "Amortización":
      return TransactionType.AMORTIZATION;
    case "Movimiento Manual":
      if (/ret\s+iigg|bbpp|impuesto|retenci[oó]n/i.test(descripcion)) {
        return TransactionType.TAX_WITHHOLDING;
      }
      return TransactionType.ADJUSTMENT;
    default:
      return null;
  }
}

function needsInstrument(type: TransactionType): boolean {
  const noInstrument: TransactionType[] = [
    TransactionType.DEPOSIT,
    TransactionType.WITHDRAWAL,
    TransactionType.ADJUSTMENT,
    TransactionType.TAX_WITHHOLDING,
  ];
  return !noInstrument.includes(type);
}

function toDecimalString(value: number): string {
  return new Decimal(value).toFixed();
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeQuantity(raw: BalanzRawRow, type: TransactionType): Decimal {
  const qty = new Decimal(raw.Cantidad);
  if (
    type === TransactionType.BUY ||
    type === TransactionType.SELL ||
    type === TransactionType.AMORTIZATION ||
    type === TransactionType.DIVIDEND_CASH
  ) {
    return qty.abs();
  }
  return qty.abs();
}

export function parseBalanzRow(raw: BalanzRawRow, rowNumber: number): NormalizedImportRow {
  const messages: string[] = [];
  const meta = parseBalanzDescription(raw.Descripcion);
  const type = resolveTransactionType(meta.category, meta.side, raw.Descripcion);

  if (!type) {
    return {
      rowNumber,
      status: "invalid",
      messages: [`Tipo de movimiento no soportado: ${meta.category}`],
      raw,
    };
  }

  const tradeDate = parseDate(String(raw.Concertacion));
  const settlementDate = parseDate(String(raw.Liquidacion)) ?? tradeDate;

  if (!tradeDate || !settlementDate) {
    return {
      rowNumber,
      status: "invalid",
      messages: ["Fecha de concertación o liquidación inválida"],
      raw,
    };
  }

  const currencyCode = mapBalanzCurrency(raw.Moneda);
  const instrumentType = raw["Tipo de Instrumento"]
    ? mapBalanzInstrumentType(raw["Tipo de Instrumento"])
    : null;

  const ticker = raw.Ticker?.trim() || meta.tickerFromDesc?.trim() || null;

  if (needsInstrument(type) && !ticker) {
    messages.push("Falta ticker para este movimiento");
  }

  if (needsInstrument(type) && ticker && !instrumentType && raw["Tipo de Instrumento"]) {
    messages.push(`Tipo de instrumento desconocido: ${raw["Tipo de Instrumento"]}`);
  }

  const quantity = normalizeQuantity(raw, type);
  const net = new Decimal(raw.Importe);
  const price =
    raw.Precio !== -1 && raw.Precio > 0
      ? new Decimal(raw.Precio).toFixed()
      : !quantity.isZero()
        ? net.abs().div(quantity).toFixed(8)
        : null;

  const parsed: ParsedImportRowData = {
    type,
    tradeDate,
    settlementDate,
    ticker,
    instrumentType,
    quantity: quantity.toFixed(),
    price,
    currencyCode,
    grossAmount: toDecimalString(raw.Importe),
    netAmount: toDecimalString(raw.Importe),
    externalId: meta.externalId ?? null,
    description: raw.Descripcion,
  };

  let status: ImportRowStatus = "valid";
  if (messages.some((m) => m.startsWith("Falta"))) {
    status = "invalid";
  } else if (messages.length > 0) {
    status = "warning";
  }

  return { rowNumber, status, messages, raw, parsed };
}

export function parseBalanzRows(
  rows: BalanzRawRow[],
  options: { fileName: string; fileHash: string }
): ImportPreviewSummary {
  const normalized = rows.map((raw, i) => parseBalanzRow(raw, i + 1));
  const stats = {
    total: normalized.length,
    valid: normalized.filter((r) => r.status === "valid").length,
    warning: normalized.filter((r) => r.status === "warning").length,
    invalid: normalized.filter((r) => r.status === "invalid").length,
  };

  return {
    brokerCode: "BALANZ",
    fileName: options.fileName,
    fileKind: "XLSX",
    fileHash: options.fileHash,
    rows: normalized,
    stats,
  };
}

export function readBalanzSheetRows(sheetRows: unknown[][]): BalanzRawRow[] {
  if (sheetRows.length < 2) return [];

  const header = sheetRows[0] as string[];
  const colIndex = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

  const result: BalanzRawRow[] = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const line = sheetRows[i] as unknown[];
    if (!line?.length || line.every((c) => c === "" || c === null || c === undefined)) {
      continue;
    }

    const get = (key: keyof BalanzRawRow) => {
      const idx = colIndex[key];
      return idx === undefined ? "" : line[idx];
    };

    result.push({
      Descripcion: String(get("Descripcion") ?? ""),
      Ticker: String(get("Ticker") ?? ""),
      "Tipo de Instrumento": String(get("Tipo de Instrumento") ?? ""),
      Concertacion: String(get("Concertacion") ?? ""),
      Cantidad: Number(get("Cantidad") ?? 0),
      Precio: Number(get("Precio") ?? -1),
      Liquidacion: String(get("Liquidacion") ?? ""),
      Moneda: String(get("Moneda") ?? ""),
      Importe: Number(get("Importe") ?? 0),
    });
  }

  return result;
}
