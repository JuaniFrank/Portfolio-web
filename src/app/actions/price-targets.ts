"use server";

import { revalidatePath } from "next/cache";
import { basisForInstrumentType } from "@/lib/alerts/evaluate";
import { parseCreateTargetInput, parseUpdateTargetInput } from "@/lib/alerts/validation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type TargetActionResult = { ok: true } | { ok: false; error: string };

/** Los objetivos se ven en `/alertas` y como etiqueta en "Ventas realizadas". */
function refreshViews() {
  revalidatePath("/alertas");
  revalidatePath("/rendimientos");
}

export async function createPriceTargetAction(input: unknown): Promise<TargetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = parseCreateTargetInput(input);
  if (!parsed.ok) return parsed;

  // Solo instrumentos que el usuario opera (o operó): no es un buscador de todo el catálogo.
  const instrument = await prisma.instrument.findFirst({
    where: { id: parsed.data.instrumentId, transactions: { some: { portfolio: { userId: user.id } } } },
    select: { id: true, type: true },
  });
  if (!instrument) return { ok: false, error: "Instrumento no encontrado en tu cartera" };

  // La moneda sale de la base de comparación del tipo de instrumento, nunca del cliente.
  const currency = basisForInstrumentType(instrument.type);
  if (!currency) return { ok: false, error: "Solo se pueden fijar objetivos en CEDEARs y acciones locales" };

  try {
    await prisma.priceTarget.create({
      data: {
        userId: user.id,
        instrumentId: instrument.id,
        targetPrice: parsed.data.targetPrice,
        currency,
        direction: parsed.data.direction,
        note: parsed.data.note,
      },
    });
  } catch (error) {
    console.error("No se pudo crear el objetivo de precio", error);
    return { ok: false, error: "No se pudo guardar el objetivo" };
  }
  refreshViews();
  return { ok: true };
}

/**
 * Cambiar precio, dirección o nota vuelve a armar el objetivo: el aviso anterior era
 * sobre otra condición.
 */
export async function updatePriceTargetAction(input: unknown): Promise<TargetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = parseUpdateTargetInput(input);
  if (!parsed.ok) return parsed;

  let count: number;
  try {
    ({ count } = await prisma.priceTarget.updateMany({
      where: { id: parsed.data.id, userId: user.id },
      data: {
        targetPrice: parsed.data.targetPrice,
        direction: parsed.data.direction,
        note: parsed.data.note,
        triggeredAt: null,
        triggeredPrice: null,
        notifiedAt: null,
      },
    }));
  } catch (error) {
    console.error("No se pudo actualizar el objetivo de precio", error);
    return { ok: false, error: "No se pudo guardar el objetivo" };
  }
  if (count === 0) return { ok: false, error: "Objetivo no encontrado" };
  refreshViews();
  return { ok: true };
}

export async function deletePriceTargetAction(id: string): Promise<TargetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (typeof id !== "string" || id === "") return { ok: false, error: "Falta el objetivo a eliminar" };

  const { count } = await prisma.priceTarget.deleteMany({ where: { id, userId: user.id } });
  if (count === 0) return { ok: false, error: "Objetivo no encontrado" };
  refreshViews();
  return { ok: true };
}

/** Vuelve a armar un objetivo ya disparado: limpia el disparo y el aviso. */
export async function rearmPriceTargetAction(id: string): Promise<TargetActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (typeof id !== "string" || id === "") return { ok: false, error: "Falta el objetivo a re-armar" };

  const { count } = await prisma.priceTarget.updateMany({
    where: { id, userId: user.id },
    data: { triggeredAt: null, triggeredPrice: null, notifiedAt: null },
  });
  if (count === 0) return { ok: false, error: "Objetivo no encontrado" };
  refreshViews();
  return { ok: true };
}
