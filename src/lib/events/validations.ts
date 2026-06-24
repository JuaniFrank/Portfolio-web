import { z } from "zod";
import { CorporateEventType } from "@/lib/generated/prisma";

export const newEventInputSchema = z.object({
  instrumentId: z.string().min(1, "Instrumento requerido"),
  eventType: z.nativeEnum(CorporateEventType),
  /** YYYY-MM-DD */
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  /** String representing an integer > 0 */
  numerator: z
    .string()
    .refine((v) => Number(v) > 0, "El numerador debe ser mayor a 0"),
  /** String representing an integer > 0 */
  denominator: z
    .string()
    .refine((v) => Number(v) > 0, "El denominador debe ser mayor a 0"),
  notes: z.string().max(500).optional().nullable(),
});

export type NewEventInput = z.infer<typeof newEventInputSchema>;
