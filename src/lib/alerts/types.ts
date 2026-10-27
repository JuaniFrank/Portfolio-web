/**
 * Tipos del dominio de alertas de precio. Sin dependencias de Prisma ni de la red:
 * los adaptadores traducen desde y hacia estas formas.
 */

/** `ABOVE` dispara con precio >= objetivo; `BELOW`, con precio <= objetivo. */
export type AlertDirection = "ABOVE" | "BELOW";

/** Moneda en la que se mide el objetivo; sale de la base de comparación del instrumento. */
export type AlertCurrency = "USD" | "ARS";

/** Lo mínimo que `evaluate` necesita de un objetivo. */
export type TargetCondition = {
  targetPrice: number;
  direction: AlertDirection;
};

/** Objetivo de precio tal como lo ve el dominio (ya con datos del instrumento). */
export type AlertTarget = TargetCondition & {
  id: string;
  userId: string;
  instrumentId: string;
  /** Ticker con el que el usuario opera el instrumento. */
  ticker: string;
  /** Símbolo contra el que se mide el precio (subyacente en Yahoo, o el propio ticker). */
  symbol: string;
  currency: AlertCurrency;
  note: string | null;
  triggeredAt: Date | null;
  triggeredPrice: number | null;
  notifiedAt: Date | null;
};

/** Qué precio hay que resolver: una vez por instrumento, según su base de comparación. */
export type PriceRequest = {
  instrumentId: string;
  currency: AlertCurrency;
  symbol: string;
};
