"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import {
  AreaSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import {
  EMPTY_VALUE,
  SERIES_COLORS,
  TOOLTIP_CLASS,
  formatDateLong,
  formatSignedPercentOrEmpty,
  returnToneClass,
} from "@/components/rendimientos/chart-utils";
import { ChartPlaceholder } from "@/components/rendimientos/chart-tooltip";
import type {
  EvolutionMover,
  EvolutionPoint,
  PortfolioEvolution,
} from "@/lib/dashboard/evolution";
import { GRANULARITIES, type Granularity } from "@/lib/rendimientos/timeline";
import { cn } from "@/lib/utils";
import { formatMoney, type ViewCurrency } from "./format";

const HEIGHT = 340;

/** Ancho del tooltip flotante. Fijo para poder decidir de qué lado del cursor va. */
const TOOLTIP_WIDTH = 320;
const CURSOR_OFFSET = 16;

type Props = {
  evolution: PortfolioEvolution;
  currency: ViewCurrency;
};

/** Fila del chart: el punto completo más el valor de la moneda elegida. */
type ChartRow = EvolutionPoint & { value: number };

type Hovered = { row: ChartRow; x: number; y: number };

export function PortfolioEvolutionChart({ evolution, currency }: Props) {
  const [granularity, setGranularity] = React.useState<Granularity>("daily");

  const rows = React.useMemo<ChartRow[]>(
    () =>
      evolution.series[granularity].map((point) => ({
        ...point,
        value: currency === "ARS" ? point.valueArs : point.valueUsd,
      })),
    [evolution, granularity, currency]
  );

  const hasChart = evolution.hasData && rows.length >= 2;

  if (!evolution.hasData) {
    return (
      <ChartPlaceholder
        text="Todavía no hay histórico para reconstruir. Se necesita al menos una compra de acciones o CEDEARs con precios de cierre cargados."
        height={HEIGHT}
      />
    );
  }

  return (
    <div className="space-y-3">
      <GranularityToggle value={granularity} onChange={setGranularity} />

      {hasChart ? (
        <ZoomableAreaChart rows={rows} currency={currency} granularity={granularity} />
      ) : (
        <ChartPlaceholder
          text="Hace falta más de un cierre para dibujar una evolución."
          height={HEIGHT}
        />
      )}

      <Footnote evolution={evolution} />
    </div>
  );
}

/**
 * El gráfico con zoom. Usa `lightweight-charts` en vez de recharts por una razón
 * concreta: el zoom con rueda, el arrastre y el reescalado automático de los ejes vienen
 * de fábrica. En recharts habría que reimplementar los tres a mano, y el eje Y no se
 * reajustaría al tramo visible sin recalcular el dominio en cada gesto.
 *
 * Sigue el mismo patrón de refs, `ResizeObserver` y `chart.remove()` que
 * `@/components/monitoreo/monitoring-chart`.
 */
function ZoomableAreaChart({
  rows,
  currency,
  granularity,
}: {
  rows: ChartRow[];
  currency: ViewCurrency;
  granularity: Granularity;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Area"> | null>(null);

  const [hovered, setHovered] = React.useState<Hovered | null>(null);
  const [isZoomed, setIsZoomed] = React.useState(false);

  const rowsByDate = React.useMemo(
    () => new Map(rows.map((row) => [row.date, row])),
    [rows]
  );

  // El callback del crosshair se suscribe una sola vez, así que lee los datos actuales
  // desde refs en vez de re-suscribirse en cada cambio de moneda o granularidad.
  const rowsByDateRef = React.useRef(rowsByDate);
  const rowCountRef = React.useRef(rows.length);

  React.useEffect(() => {
    rowsByDateRef.current = rowsByDate;
    rowCountRef.current = rows.length;
  }, [rowsByDate, rows.length]);

  // --- Creación del chart: una sola vez por montaje ---
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontSize: 11,
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: "#27272a", style: LineStyle.Dotted },
        horzLines: { color: "#27272a", style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        // Es lo que hace que el eje Y siga al zoom: reescala al tramo visible en vez de
        // quedarse con el mínimo y máximo de toda la serie.
        autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#27272a",
        // Sin esto se puede arrastrar la serie hacia el vacío y perderla de vista.
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 0,
        minBarSpacing: 0.5,
      },
      crosshair: {
        vertLine: { color: "#52525b", width: 1, style: LineStyle.Dashed, labelVisible: true },
        horzLine: { color: "#52525b", width: 1, style: LineStyle.Dashed, labelVisible: true },
      },
      // Rueda para zoom, arrastre para desplazar, pinch en touch: el gesto de TradingView.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: false },
        axisDoubleClickReset: { time: true, price: true },
      },
    });

    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: SERIES_COLORS.portfolio,
      topColor: "rgba(99, 102, 241, 0.35)",
      bottomColor: "rgba(99, 102, 241, 0)",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#09090b",
      crosshairMarkerBackgroundColor: SERIES_COLORS.portfolio,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    seriesRef.current = series;

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const date = typeof param.time === "string" ? param.time : null;
      if (!date || !param.point) {
        setHovered(null);
        return;
      }
      const row = rowsByDateRef.current.get(date);
      if (!row) {
        setHovered(null);
        return;
      }
      setHovered({ row, x: param.point.x, y: param.point.y });
    });

    // Habilita el botón de reset solo cuando hay algo que resetear.
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const total = rowCountRef.current;
      setIsZoomed(total > 1 && range.to - range.from < (total - 1) * 0.98);
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // --- Datos: se reemplazan sin recrear el chart, para no perder el zoom ---
  const previousGranularity = React.useRef(granularity);
  React.useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    series.setData(rows.map((row) => ({ time: row.date as Time, value: row.value })));

    // Cambiar de granularidad cambia el eje entero: el tramo que estabas mirando ya no
    // significa lo mismo, así que se vuelve a encuadrar. Cambiar de moneda solo reescala
    // el eje Y, y ahí conservar el zoom es lo que uno espera.
    if (previousGranularity.current !== granularity) {
      previousGranularity.current = granularity;
      chart.timeScale().fitContent();
      setIsZoomed(false);
    }
  }, [rows, granularity]);

  // Encuadre inicial, una vez que la primera tanda de datos ya entró.
  React.useEffect(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  // --- Formato del eje de precios según la moneda, sin recrear el chart ---
  React.useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        locale: "es-AR",
        priceFormatter: (price: number) => formatAxisPrice(price, currency),
      },
    });
  }, [currency]);

  const resetZoom = () => {
    chartRef.current?.timeScale().fitContent();
    setIsZoomed(false);
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full"
        style={{ height: HEIGHT }}
        // El tooltip se apaga al salir: si no, queda pegado el último punto visitado.
        onMouseLeave={() => setHovered(null)}
      />

      {isZoomed ? (
        <button
          type="button"
          onClick={resetZoom}
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[11px] text-zinc-300 backdrop-blur transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          <RotateCcw className="h-3 w-3" />
          Ver todo
        </button>
      ) : null}

      {hovered ? (
        <FloatingTooltip hovered={hovered} currency={currency} container={containerRef} />
      ) : null}
    </div>
  );
}

/**
 * Tooltip flotante junto al cursor.
 *
 * `lightweight-charts` no dibuja tooltips: da la posición del crosshair y el resto es
 * HTML. Se posiciona a mano y se voltea de lado cuando no entra a la derecha, para que
 * el detalle no se corte al hacer hover sobre los últimos cierres.
 */
function FloatingTooltip({
  hovered,
  currency,
  container,
}: {
  hovered: Hovered;
  currency: ViewCurrency;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const width = container.current?.clientWidth ?? 0;
  const flipToLeft = hovered.x + CURSOR_OFFSET + TOOLTIP_WIDTH > width;
  const left = flipToLeft
    ? Math.max(0, hovered.x - CURSOR_OFFSET - TOOLTIP_WIDTH)
    : hovered.x + CURSOR_OFFSET;

  // Se ancla al borde opuesto al cursor: con 8 posiciones el tooltip es alto y seguir la
  // vertical del mouse lo haría desbordar y tapar justo el punto que se está mirando.
  const anchorToBottom = hovered.y < HEIGHT / 2;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left,
        width: TOOLTIP_WIDTH,
        ...(anchorToBottom ? { bottom: 0 } : { top: 0 }),
      }}
    >
      <EvolutionTooltip row={hovered.row} currency={currency} />
    </div>
  );
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (granularity: Granularity) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex shrink-0 rounded-md border border-zinc-800 bg-zinc-950/60 p-1">
        {GRANULARITIES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded px-3 py-1 text-xs transition-colors",
              value === option.id
                ? "bg-teal-500/20 font-medium text-teal-300"
                : "text-zinc-400 hover:text-zinc-100"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500">
        Rueda para hacer zoom · arrastrá para desplazarte · doble clic en el eje para
        reencuadrar
      </p>
    </div>
  );
}

function EvolutionTooltip({ row, currency }: { row: ChartRow; currency: ViewCurrency }) {
  const change = currency === "ARS" ? row.changeArs : row.changeUsd;
  const netFlow = currency === "ARS" ? row.netFlowArs : row.netFlowUsd;
  const hasBase = row.returnPercent !== null;
  const hasFlowMarker = [...row.gainers, ...row.losers].some((mover) => mover.hadFlow);

  return (
    <div className={TOOLTIP_CLASS}>
      <p className="font-medium text-zinc-200">{formatDateLong(row.date)}</p>

      <div className="mt-2 flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">Valor</span>
        <span className="font-medium tabular-nums text-zinc-100">
          {formatMoney(row.value, currency)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">Resultado</span>
        <span className={cn("font-medium tabular-nums", returnToneClass(hasBase ? change : null))}>
          {hasBase ? formatSignedMoney(change, currency) : EMPTY_VALUE}
          <span className="ml-1.5 text-[11px] text-zinc-500">
            {formatSignedPercentOrEmpty(row.returnPercent)}
          </span>
        </span>
      </div>

      {netFlow !== 0 ? (
        <div className="flex items-baseline justify-between gap-6">
          <span className="text-zinc-400">{netFlow > 0 ? "Compras" : "Ventas"}</span>
          <span className="tabular-nums text-zinc-400">
            {formatSignedMoney(netFlow, currency)}
          </span>
        </div>
      ) : null}

      {row.gainers.length > 0 || row.losers.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-x-4 border-t border-zinc-800 pt-2">
          <MoverColumn title="Ganaron" movers={row.gainers} currency={currency} />
          <MoverColumn title="Perdieron" movers={row.losers} currency={currency} />
        </div>
      ) : (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          {hasBase
            ? "Ninguna posición se movió en el período."
            : "Primer cierre: no hay período anterior con qué comparar."}
        </p>
      )}

      {hasFlowMarker ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          <span className="text-teal-400/80">°</span> Operaste en el período: el resultado
          incluye el precio al que compraste o vendiste, así que puede no acompañar la
          variación del ticker.
        </p>
      ) : null}

      {row.staleTickers.length > 0 ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-amber-300/80">
          <span className="text-amber-400/80">*</span> Sin cierre propio del período (
          {row.staleTickers.join(", ")}): valuado al último precio conocido.
        </p>
      ) : null}
    </div>
  );
}

function MoverColumn({
  title,
  movers,
  currency,
}: {
  title: string;
  movers: EvolutionMover[];
  currency: ViewCurrency;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">{title}</p>
      {movers.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{EMPTY_VALUE}</p>
      ) : (
        <ul className="space-y-0.5">
          {movers.map((mover) => (
            <li key={mover.ticker} className="flex items-baseline justify-between gap-2">
              <span className="text-zinc-300">
                {mover.ticker}
                {/* Un asterisco donde el precio vino arrastrado: el número está
                    calculado contra un cierre que no es del período. */}
                {mover.priceIsStale ? <span className="text-amber-400/80">*</span> : null}
                {/* Marca las filas donde se operó: es la única explicación posible de
                    que el resultado y la variación del ticker discrepen de signo. */}
                {mover.hadFlow ? <span className="text-teal-400/80">°</span> : null}
              </span>
              <span className="flex items-baseline gap-1.5 tabular-nums">
                <span className={returnToneClass(mover.pnlArs)}>
                  {formatSignedMoney(
                    currency === "ARS" ? mover.pnlArs : mover.pnlUsd,
                    currency
                  )}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {formatSignedPercentOrEmpty(mover.pricePercent)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Footnote({ evolution }: { evolution: PortfolioEvolution }) {
  if (!evolution.hasData) return null;

  return (
    <p className="text-[11px] leading-relaxed text-zinc-500">
      Reconstruido desde las operaciones y los cierres diarios, no desde fotos guardadas:
      corregir una operación vieja se refleja en todo el histórico. Incluye acciones y
      CEDEARs — la renta fija no tiene serie de precios y queda afuera. Último cierre:{" "}
      {evolution.lastDate ? formatDateLong(evolution.lastDate) : EMPTY_VALUE}.
    </p>
  );
}

/** Importe con signo explícito: en un resultado el signo es la información principal. */
function formatSignedMoney(value: number, currency: ViewCurrency): string {
  return `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`;
}

/**
 * Etiquetas del eje de precios.
 *
 * No usa `formatCompact` (el de los charts de recharts) porque redondea a un decimal, y
 * con zoom fino el eje entero termina repitiendo `$4,0 M` en cada tick. Con cifras
 * significativas los valores siguen distinguiéndose al acercarse, que es justo lo que
 * tiene que pasar cuando el eje acompaña al zoom.
 */
function formatAxisPrice(value: number, currency: ViewCurrency): string {
  const prefix = currency === "USD" ? "U$S " : "$";
  const formatted = new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumSignificantDigits: 4,
  }).format(value);
  return `${prefix}${formatted}`;
}
