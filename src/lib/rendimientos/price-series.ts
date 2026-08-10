/**
 * Lookup temporal "as-of" con forward-fill. **Módulo puro**: recibe puntos ya
 * leídos de la DB y no sabe de Prisma.
 *
 * Es la pieza que hoy no existe y que habilita todo el motor: `buildHoldings` ya
 * sabe replaying trades, pero necesita "el precio de cada instrumento al día D".
 *
 * Por qué forward-fill y no interpolación: un precio de mercado no se interpola.
 * Si un ticker no operó el viernes, el último precio conocido *es* su valuación.
 * Lo que sí hace falta es que el consumidor pueda enterarse de cuán viejo es ese
 * precio — por eso `asOf` devuelve la fecha del punto encontrado y no solo el valor.
 */

export type SeriesPoint = {
  date: Date;
  value: number;
};

export type SeriesHit = {
  value: number;
  /** Fecha del punto realmente usado. Si es anterior a la pedida, hubo arrastre. */
  date: Date;
};

/**
 * Serie ordenada por fecha con búsqueda binaria del último punto ≤ objetivo.
 *
 * Se construye una vez por instrumento y se consulta una vez por mes, así que la
 * búsqueda binaria evita que el motor sea O(meses × ruedas) por ticker.
 */
export class TimeSeries {
  private readonly points: SeriesPoint[];
  private readonly times: number[];

  /** Ordena y deduplica defensivamente: ante fechas repetidas gana el último valor. */
  constructor(points: SeriesPoint[]) {
    const byTime = new Map<number, number>();
    for (const point of points) {
      const time = point.date.getTime();
      if (Number.isNaN(time) || !Number.isFinite(point.value)) continue;
      byTime.set(time, point.value);
    }

    this.times = [...byTime.keys()].sort((a, b) => a - b);
    this.points = this.times.map((time) => ({ date: new Date(time), value: byTime.get(time)! }));
  }

  get length(): number {
    return this.points.length;
  }

  get first(): SeriesPoint | null {
    return this.points[0] ?? null;
  }

  get last(): SeriesPoint | null {
    return this.points.at(-1) ?? null;
  }

  /**
   * Último punto con fecha ≤ `target`. `null` si la serie arranca después
   * (no inventamos hacia atrás: extrapolar un precio al pasado es fabricar dato).
   */
  asOf(target: Date): SeriesHit | null {
    const targetTime = target.getTime();
    if (Number.isNaN(targetTime) || this.times.length === 0) return null;

    let low = 0;
    let high = this.times.length - 1;
    let found = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.times[mid]! <= targetTime) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (found === -1) return null;
    const point = this.points[found]!;
    return { value: point.value, date: point.date };
  }
}

/** Serie de precios de varios instrumentos, indexada por `instrumentId`. */
export class PriceIndex {
  private readonly byInstrument: Map<string, TimeSeries>;

  constructor(rows: Array<{ instrumentId: string; date: Date; close: number }>) {
    const grouped = new Map<string, SeriesPoint[]>();
    for (const row of rows) {
      const list = grouped.get(row.instrumentId) ?? [];
      list.push({ date: row.date, value: row.close });
      grouped.set(row.instrumentId, list);
    }

    this.byInstrument = new Map(
      [...grouped.entries()].map(([instrumentId, points]) => [
        instrumentId,
        new TimeSeries(points),
      ])
    );
  }

  asOf(instrumentId: string, target: Date): SeriesHit | null {
    return this.byInstrument.get(instrumentId)?.asOf(target) ?? null;
  }

  /** Fecha del último precio de toda la serie — sirve para reportar frescura del backfill. */
  latestDate(): Date | null {
    let latest: Date | null = null;
    for (const series of this.byInstrument.values()) {
      const last = series.last;
      if (last && (!latest || last.date.getTime() > latest.getTime())) latest = last.date;
    }
    return latest;
  }

  has(instrumentId: string): boolean {
    return this.byInstrument.has(instrumentId);
  }
}
