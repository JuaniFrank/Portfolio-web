import { z } from "zod";
import { InstrumentType } from "@/lib/generated/prisma";

/** A string that parses to a finite number strictly greater than 0. */
const positiveNumberString = z
  .string()
  .min(1, "Requerido")
  .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Debe ser mayor a 0");

/** A string that parses to a finite number >= 0. Empty is treated as 0 upstream. */
const nonNegativeNumberString = z
  .string()
  .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "No puede ser negativo");

export const TRANSACTION_CURRENCIES = ["ARS", "USD"] as const;

export const newTransactionInputSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Ticker requerido")
    .max(20, "Ticker demasiado largo")
    .transform((v) => v.toUpperCase()),
  instrumentType: z.nativeEnum(InstrumentType),
  side: z.enum(["BUY", "SELL"]),
  currencyCode: z.enum(TRANSACTION_CURRENCIES),
  /** YYYY-MM-DD */
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  quantity: positiveNumberString,
  price: positiveNumberString,
  fees: nonNegativeNumberString.optional(),
  taxes: nonNegativeNumberString.optional(),
});

export type NewTransactionInput = z.infer<typeof newTransactionInputSchema>;
