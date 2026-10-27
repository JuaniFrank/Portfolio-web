/**
 * Validación de la entrada de las server actions de objetivos de precio. Vive acá, y no
 * en la action, para poder probarla sin Next ni Prisma (ver `validation.test.ts`).
 */

import { z } from "zod";

export const NOTE_MAX_LENGTH = 200;

/** Tope exclusivo del precio objetivo: la columna es `Decimal(20,8)` (12 dígitos enteros). */
export const TARGET_PRICE_MAX = 1e11;

/** Acepta número o texto con coma decimal ("92,5"); todo lo demás es inválido. */
const priceSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "string" ? Number(value.trim().replace(",", ".")) : value))
  .refine((value) => Number.isFinite(value) && value > 0 && value < TARGET_PRICE_MAX, {
    message: "El precio objetivo debe ser un número mayor que cero y menor que 100.000.000.000",
  });

const noteSchema = z
  .string()
  .max(NOTE_MAX_LENGTH + 100)
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  })
  .refine((value) => value === null || value.length <= NOTE_MAX_LENGTH, {
    message: `La nota no puede superar los ${NOTE_MAX_LENGTH} caracteres`,
  });

const directionSchema = z.enum(["ABOVE", "BELOW"], {
  errorMap: () => ({ message: "La dirección debe ser “por encima” o “por debajo”" }),
});

const createSchema = z.object({
  instrumentId: z.string().min(1, "Elegí un instrumento"),
  targetPrice: priceSchema,
  direction: directionSchema,
  note: noteSchema,
});

const updateSchema = z.object({
  id: z.string().min(1, "Falta el objetivo a modificar"),
  targetPrice: priceSchema,
  direction: directionSchema,
  note: noteSchema,
});

export type CreateTargetInput = z.output<typeof createSchema>;
export type UpdateTargetInput = z.output<typeof updateSchema>;

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): Parsed<T> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.errors[0]?.message ?? "Datos inválidos" };
}

export function parseCreateTargetInput(raw: unknown): Parsed<CreateTargetInput> {
  return parse(createSchema, raw);
}

export function parseUpdateTargetInput(raw: unknown): Parsed<UpdateTargetInput> {
  return parse(updateSchema, raw);
}
