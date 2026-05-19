import { InstrumentType, TransactionType } from "@/lib/generated/prisma";

export type ImportTransactionFilter =
  | "all"
  | "stock_ar"
  | "cedear"
  | "bond"
  | "letter"
  | "corporate"
  | "fees"
  | "dividends"
  | "cash"
  | "trades";

export const IMPORT_TRANSACTION_FILTERS: Array<{
  id: ImportTransactionFilter;
  label: string;
}> = [
  { id: "all", label: "Todos" },
  { id: "trades", label: "Operaciones" },
  { id: "stock_ar", label: "Acciones AR" },
  { id: "cedear", label: "CEDEARs" },
  { id: "bond", label: "Bonos" },
  { id: "letter", label: "Letras" },
  { id: "corporate", label: "Corporativos" },
  { id: "dividends", label: "Dividendos" },
  { id: "fees", label: "Comisiones e imp." },
  { id: "cash", label: "Efectivo" },
];

export type ImportedTransactionRow = {
  id: string;
  tradeDate: string;
  type: TransactionType;
  ticker: string | null;
  instrumentType: InstrumentType | null;
  quantity: string;
  netAmount: string;
  currencyCode: string;
  notes: string | null;
  brokerName: string;
  fileName: string;
  importBatchId: string;
};

const TRADE_TYPES: TransactionType[] = [TransactionType.BUY, TransactionType.SELL];

const FEE_TYPES: TransactionType[] = [TransactionType.FEE, TransactionType.TAX_WITHHOLDING];

const CASH_TYPES: TransactionType[] = [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL];

const DIVIDEND_TYPES: TransactionType[] = [
  TransactionType.DIVIDEND_CASH,
  TransactionType.DIVIDEND_STOCK,
  TransactionType.COUPON,
  TransactionType.AMORTIZATION,
];

export function matchesImportFilter(
  row: ImportedTransactionRow,
  filter: ImportTransactionFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "trades") return TRADE_TYPES.includes(row.type);
  if (filter === "stock_ar") return row.instrumentType === InstrumentType.STOCK_AR;
  if (filter === "cedear") return row.instrumentType === InstrumentType.CEDEAR;
  if (filter === "bond") return row.instrumentType === InstrumentType.BOND_AR;
  if (filter === "letter") return row.instrumentType === InstrumentType.LETRA;
  if (filter === "corporate") return row.instrumentType === InstrumentType.ON;
  if (filter === "fees") return FEE_TYPES.includes(row.type);
  if (filter === "dividends") return DIVIDEND_TYPES.includes(row.type);
  if (filter === "cash") return CASH_TYPES.includes(row.type);
  return true;
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  BUY: "Compra",
  SELL: "Venta",
  DIVIDEND_CASH: "Dividendo",
  DIVIDEND_STOCK: "Dividendo acciones",
  COUPON: "Cupón",
  AMORTIZATION: "Amortización",
  INTEREST: "Interés",
  FEE: "Comisión",
  TAX_WITHHOLDING: "Retención",
  DEPOSIT: "Depósito",
  WITHDRAWAL: "Retiro",
  FX_CONVERSION: "Conversión FX",
  SPLIT: "Split",
  REVERSE_SPLIT: "Reverse split",
  SPINOFF: "Spin-off",
  MERGER: "Fusión",
  TRANSFER_IN: "Transferencia entrada",
  TRANSFER_OUT: "Transferencia salida",
  ADJUSTMENT: "Ajuste",
};

export const INSTRUMENT_TYPE_LABELS: Partial<Record<InstrumentType, string>> = {
  STOCK_AR: "Acción AR",
  CEDEAR: "CEDEAR",
  BOND_AR: "Bono",
  LETRA: "Letra",
  ON: "Corporativo",
  FCI: "FCI",
  CASH: "Efectivo",
};
