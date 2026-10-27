/**
 * Lectura de objetivos de precio desde Prisma, traducidos al dominio (`AlertTarget`).
 * Orquestador sin tests, como el resto de lo que toca la base.
 */

import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { underlyingSymbolFor } from "@/lib/rendimientos/underlying-price";
import type { PriceTargetRepo } from "../ports";
import type { AlertCurrency, AlertDirection, AlertTarget } from "../types";

const targetInclude = {
  instrument: {
    select: {
      ticker: true,
      type: true,
      name: true,
      underlyingAsset: { select: { ticker: true } },
      baseInstrument: {
        select: { ticker: true, underlyingAsset: { select: { ticker: true } } },
      },
    },
  },
} satisfies Prisma.PriceTargetInclude;

type TargetRow = Prisma.PriceTargetGetPayload<{ include: typeof targetInclude }>;

/** Objetivo del dominio más el nombre del instrumento, para mostrarlo en pantalla. */
export type AlertTargetView = AlertTarget & { instrumentName: string };

function toAlertTarget(row: TargetRow): AlertTargetView {
  const currency = row.currency as AlertCurrency;
  const instrument = row.instrument;
  // CEDEAR: el precio se mide en la acción original. Acción local: en el propio papel.
  const symbol =
    currency === "USD"
      ? (underlyingSymbolFor({
          type: instrument.type,
          ticker: instrument.ticker,
          underlyingAssetTicker: instrument.underlyingAsset?.ticker,
          baseInstrument: instrument.baseInstrument && {
            ticker: instrument.baseInstrument.ticker,
            underlyingAssetTicker: instrument.baseInstrument.underlyingAsset?.ticker,
          },
        }) ?? instrument.ticker)
      : instrument.ticker;

  return {
    id: row.id,
    userId: row.userId,
    instrumentId: row.instrumentId,
    ticker: instrument.ticker,
    instrumentName: instrument.name,
    symbol,
    currency,
    direction: row.direction,
    targetPrice: Number(row.targetPrice),
    note: row.note,
    triggeredAt: row.triggeredAt,
    triggeredPrice: row.triggeredPrice === null ? null : Number(row.triggeredPrice),
    notifiedAt: row.notifiedAt,
  };
}

/** Todos los objetivos de un usuario, los más nuevos primero. */
export async function loadUserTargets(userId: string): Promise<AlertTargetView[]> {
  const rows = await prisma.priceTarget.findMany({
    where: { userId },
    include: targetInclude,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toAlertTarget);
}

export function createPrismaPriceTargetRepo(): PriceTargetRepo {
  return {
    async listPending() {
      const rows = await prisma.priceTarget.findMany({
        where: { notifiedAt: null },
        include: targetInclude,
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toAlertTarget);
    },
    async markTriggered(id, price, at) {
      // Condicional: solo si sigue armado, para que cron y worker no se pisen ni se
      // borre un re-armado hecho a mitad de la corrida.
      const { count } = await prisma.priceTarget.updateMany({
        where: { id, triggeredAt: null },
        data: { triggeredAt: at, triggeredPrice: price },
      });
      return count > 0;
    },
    async markNotified(id, at) {
      const { count } = await prisma.priceTarget.updateMany({
        where: { id, notifiedAt: null, triggeredAt: { not: null } },
        data: { notifiedAt: at },
      });
      return count > 0;
    },
  };
}

/** Condición mínima de un objetivo, para decidir en pantalla si está cumplido. */
export type TargetCondition = {
  targetPrice: number;
  direction: AlertDirection;
  currency: AlertCurrency;
};

/** Objetivos del usuario agrupados por instrumento (para "Ventas realizadas"). */
export async function loadTargetConditions(userId: string): Promise<Record<string, TargetCondition[]>> {
  const rows = await prisma.priceTarget.findMany({
    where: { userId },
    select: { instrumentId: true, targetPrice: true, direction: true, currency: true },
  });
  const byInstrument: Record<string, TargetCondition[]> = {};
  for (const row of rows) {
    (byInstrument[row.instrumentId] ??= []).push({
      targetPrice: Number(row.targetPrice),
      direction: row.direction,
      currency: row.currency as AlertCurrency,
    });
  }
  return byInstrument;
}
