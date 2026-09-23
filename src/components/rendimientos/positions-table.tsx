"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
  type Header,
  type Updater,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  GripVertical,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatMoney } from "@/components/dashboard/format";
import { LiveBadge } from "@/components/rendimientos/monthly-table";
import {
  EMPTY_VALUE,
  formatSignedPercentOrEmpty,
  returnToneClass,
} from "@/components/rendimientos/chart-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatHoldingAge, type PositionTableRow } from "@/lib/rendimientos/position-rows";
import {
  compareNullableAlphabetical,
  compareNullableNumeric,
  parseStoredLayout,
  reconcileColumnOrder,
  serializeLayout,
  type PositionsTableLayout,
  type SortDirection,
} from "@/lib/rendimientos/positions-table-layout";
import type { ViewCurrency } from "@/lib/rendimientos/types";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "portfolio:positions-table-layout";

type ColumnKind = "numeric" | "alphabetical";

type ColumnConfig = {
  id: string;
  label: string;
  align: "left" | "right";
  size: number;
  minSize: number;
  kind: ColumnKind;
  /** El valor sobre el que se ordena. Recibe la moneda activa: "Precio" y "Valor de
   * mercado" cambian de columna comparable según el toggle ARS/USD. */
  getSortValue: (row: PositionTableRow, currency: ViewCurrency) => number | string | null;
  renderCell: (row: PositionTableRow, currency: ViewCurrency) => React.ReactNode;
};

/** Precio de hoy en la moneda activa. En USD se deriva del valor de la posición,
 * igual que `positionFigures` en `view.ts`: no se guarda un precio en USD aparte. */
function priceFor(row: PositionTableRow, currency: ViewCurrency): number | null {
  if (currency === "ARS") return row.priceArs;
  return row.quantity > 0 ? row.valueUsd / row.quantity : null;
}

function formatMoneyOrEmpty(value: number | null, currency: ViewCurrency): string {
  return value === null ? EMPTY_VALUE : formatMoney(value, currency);
}

/** Monto arriba, porcentaje abajo — mismo patrón que la fila expandible de `MonthlyTable`. */
function ReturnCell({
  amount,
  pct,
  currency,
}: {
  amount: number | null;
  pct: number | null;
  currency: ViewCurrency;
}) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className={returnToneClass(amount)}>{formatMoneyOrEmpty(amount, currency)}</span>
      <span className={cn("text-[10px]", returnToneClass(pct))}>
        {formatSignedPercentOrEmpty(pct)}
      </span>
    </div>
  );
}

const POSITION_COLUMNS: ColumnConfig[] = [
  {
    id: "ticker",
    label: "Ticker",
    align: "left",
    size: 220,
    minSize: 160,
    kind: "alphabetical",
    getSortValue: (row) => row.ticker,
    renderCell: (row) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-zinc-200">{row.ticker}</span>
          {row.priceIsStale ? (
            <span title="Precio arrastrado de un cierre anterior">
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
            </span>
          ) : null}
          {row.priceIsLive ? <LiveBadge /> : null}
        </div>
        <p className="truncate text-[10px] text-zinc-500">{row.instrumentName}</p>
      </div>
    ),
  },
  {
    id: "avgCostArs",
    label: "Costo prom. ARS",
    align: "right",
    size: 140,
    minSize: 110,
    kind: "numeric",
    getSortValue: (row) => row.avgCostArs,
    renderCell: (row) => formatMoneyOrEmpty(row.avgCostArs, "ARS"),
  },
  {
    id: "avgCostUsd",
    label: "Costo prom. USD",
    align: "right",
    size: 140,
    minSize: 110,
    kind: "numeric",
    getSortValue: (row) => row.avgCostUsd,
    renderCell: (row) => formatMoneyOrEmpty(row.avgCostUsd, "USD"),
  },
  {
    id: "price",
    label: "Precio",
    align: "right",
    size: 120,
    minSize: 90,
    kind: "numeric",
    getSortValue: (row, currency) => priceFor(row, currency),
    renderCell: (row, currency) => formatMoneyOrEmpty(priceFor(row, currency), currency),
  },
  {
    id: "returnArs",
    label: "Result. ARS",
    align: "right",
    size: 150,
    minSize: 120,
    kind: "numeric",
    // Se ordena por el %, no por el monto: el monto absoluto está dominado por el
    // tamaño de la posición (para eso ya está "Peso"), el % mide cómo le fue.
    getSortValue: (row) => row.returnArs.pct,
    renderCell: (row) => (
      <ReturnCell amount={row.returnArs.amount} pct={row.returnArs.pct} currency="ARS" />
    ),
  },
  {
    id: "returnUsd",
    label: "Result. USD",
    align: "right",
    size: 150,
    minSize: 120,
    kind: "numeric",
    getSortValue: (row) => row.returnUsd.pct,
    renderCell: (row) => (
      <ReturnCell amount={row.returnUsd.amount} pct={row.returnUsd.pct} currency="USD" />
    ),
  },
  {
    id: "dailyChangePct",
    label: "Var. diaria",
    align: "right",
    size: 110,
    minSize: 90,
    kind: "numeric",
    getSortValue: (row) => row.dailyChangePct,
    renderCell: (row) => (
      <span className={returnToneClass(row.dailyChangePct)}>
        {formatSignedPercentOrEmpty(row.dailyChangePct)}
      </span>
    ),
  },
  {
    id: "weightPct",
    label: "Peso",
    align: "right",
    size: 90,
    minSize: 70,
    kind: "numeric",
    getSortValue: (row) => row.weightPct,
    renderCell: (row) => `${row.weightPct.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`,
  },
  {
    id: "holdingAge",
    label: "Antigüedad",
    align: "right",
    size: 110,
    minSize: 90,
    kind: "numeric",
    getSortValue: (row) => row.holdingDays,
    renderCell: (row) => (row.holdingDays === null ? EMPTY_VALUE : formatHoldingAge(row.holdingDays)),
  },
  {
    id: "marketValue",
    label: "Valor de mercado",
    align: "right",
    size: 160,
    minSize: 130,
    kind: "numeric",
    getSortValue: (row, currency) => (currency === "ARS" ? row.valueArs : row.valueUsd),
    renderCell: (row, currency) =>
      formatMoney(currency === "ARS" ? row.valueArs : row.valueUsd, currency),
  },
];

const DEFAULT_COLUMN_ORDER = POSITION_COLUMNS.map((column) => column.id);

const DEFAULT_LAYOUT: PositionsTableLayout = {
  columnOrder: DEFAULT_COLUMN_ORDER,
  columnSizing: {},
  columnVisibility: {},
  sorting: [],
};

const features = tableFeatures({
  columnOrderingFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
});

const columnHelper = createColumnHelper<typeof features, PositionTableRow>();

function resolveUpdater<T>(updater: Updater<T>, previous: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(previous) : updater;
}

type Sort = { columnId: string; direction: SortDirection } | null;

function nextSort(current: Sort, columnId: string): Sort {
  if (!current || current.columnId !== columnId) return { columnId, direction: "asc" };
  if (current.direction === "asc") return { columnId, direction: "desc" };
  return null;
}

function sortToArray(sort: Sort): PositionsTableLayout["sorting"] {
  return sort ? [{ id: sort.columnId, desc: sort.direction === "desc" }] : [];
}

function sortFromArray(sorting: PositionsTableLayout["sorting"]): Sort {
  const [first] = sorting;
  return first ? { columnId: first.id, direction: first.desc ? "desc" : "asc" } : null;
}

// El layout persistido vive en un external store (mismo patrón que
// `currency-provider.tsx`), no en `useState` + `useEffect`: el server no tiene
// `localStorage`, así que hidratar con un efecto que llama `setState` dispara
// renders en cascada (regla `react-hooks/set-state-in-effect`). Con
// `useSyncExternalStore`, React ya resuelve "server = default, cliente = lo
// guardado" sin ese efecto.
const layoutListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedLayout: PositionsTableLayout = DEFAULT_LAYOUT;

function readStoredLayout(): PositionsTableLayout {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedLayout;

  cachedRaw = raw;
  const stored = parseStoredLayout(raw);
  cachedLayout = stored
    ? {
        columnOrder: stored.columnOrder
          ? reconcileColumnOrder(DEFAULT_COLUMN_ORDER, stored.columnOrder)
          : DEFAULT_COLUMN_ORDER,
        columnSizing: stored.columnSizing ?? {},
        columnVisibility: stored.columnVisibility ?? {},
        sorting: stored.sorting ?? [],
      }
    : DEFAULT_LAYOUT;
  return cachedLayout;
}

function getServerLayout(): PositionsTableLayout {
  return DEFAULT_LAYOUT;
}

function subscribeToLayout(listener: () => void) {
  layoutListeners.add(listener);
  // "storage" solo dispara en otras pestañas; esta pestaña se entera por `writeLayout`.
  window.addEventListener("storage", listener);
  return () => {
    layoutListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writeLayout(next: PositionsTableLayout) {
  cachedRaw = serializeLayout(next);
  cachedLayout = next;
  window.localStorage.setItem(STORAGE_KEY, cachedRaw);
  layoutListeners.forEach((listener) => listener());
}

/**
 * Tabla interactiva de posiciones abiertas: ordenar, reordenar y redimensionar
 * columnas, buscar por ticker/nombre, elegir qué columnas se ven, y todo eso
 * persistido en `localStorage`.
 *
 * El orden se resuelve ACÁ, no con `rowSortingFeature` de TanStack: así los nulos
 * quedan siempre al final sin depender de que la librería no invierta la
 * comparación al pasar a descendente (la tabla solo recibe filas ya ordenadas).
 */
export function PositionsTable({
  positions,
  currency,
}: {
  positions: PositionTableRow[];
  currency: ViewCurrency;
}) {
  const [search, setSearch] = useState("");
  const layout = useSyncExternalStore(subscribeToLayout, readStoredLayout, getServerLayout);
  const { columnOrder, columnSizing, columnVisibility } = layout;
  const sort = sortFromArray(layout.sorting);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return positions;
    return positions.filter(
      (position) =>
        position.ticker.toLowerCase().includes(query) ||
        position.instrumentName.toLowerCase().includes(query)
    );
  }, [positions, search]);

  const rows = useMemo(() => {
    if (!sort) return filtered;
    const config = POSITION_COLUMNS.find((column) => column.id === sort.columnId);
    if (!config) return filtered;

    const withSortValue = filtered.map((row) => ({ row, value: config.getSortValue(row, currency) }));
    withSortValue.sort((a, b) =>
      config.kind === "numeric"
        ? compareNullableNumeric(a.value as number | null, b.value as number | null, sort.direction)
        : compareNullableAlphabetical(
            a.value as string | null,
            b.value as string | null,
            sort.direction
          )
    );
    return withSortValue.map((entry) => entry.row);
  }, [filtered, sort, currency]);

  const columns = useMemo(
    () =>
      POSITION_COLUMNS.map((config) =>
        columnHelper.display({
          id: config.id,
          header: config.label,
          size: config.size,
          minSize: config.minSize,
          enableHiding: config.id !== "ticker",
          cell: ({ row }) => config.renderCell(row.original, currency),
        })
      ),
    [currency]
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { columnOrder, columnSizing, columnVisibility },
    onColumnOrderChange: (updater) =>
      writeLayout({ ...layout, columnOrder: resolveUpdater(updater, columnOrder) }),
    onColumnSizingChange: (updater) =>
      writeLayout({ ...layout, columnSizing: resolveUpdater(updater, columnSizing) }),
    onColumnVisibilityChange: (updater) =>
      writeLayout({ ...layout, columnVisibility: resolveUpdater(updater, columnVisibility) }),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getRowId: (row) => row.instrumentId,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = columnOrder.indexOf(String(active.id));
    const newIndex = columnOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    writeLayout({ ...layout, columnOrder: arrayMove(columnOrder, oldIndex, newIndex) });
  }

  function handleSort(columnId: string) {
    writeLayout({ ...layout, sorting: sortToArray(nextSort(sort, columnId)) });
  }

  function resetLayout() {
    writeLayout(DEFAULT_LAYOUT);
  }

  const headerGroup = table.getHeaderGroups()[0];
  const hidableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());

  return (
    <ChartCard
      title="Posiciones"
      description="Una fila por instrumento en cartera, con lo que costó, lo que vale hoy y cómo le fue."
      icon={<SlidersHorizontal className="h-4 w-4" />}
      headerExtra={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar ticker o nombre…"
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Columnas
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs">Mostrar columnas</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hidableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(value) => column.toggleVisibility(value)}
                >
                  {POSITION_COLUMNS.find((config) => config.id === column.id)?.label ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-zinc-400 hover:text-zinc-100"
            onClick={resetLayout}
            title="Restablece orden, ancho, visibilidad y orden de columnas"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restablecer
          </Button>
        </div>
      }
    >
      {positions.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
          No hay posiciones abiertas.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table
              className="border-collapse text-sm"
              style={{ width: table.getTotalSize(), tableLayout: "fixed" }}
            >
              <thead>
                {headerGroup ? (
                  <tr>
                    <SortableContext
                      items={headerGroup.headers.map((header) => header.column.id)}
                      strategy={horizontalListSortingStrategy}
                    >
                      {headerGroup.headers.map((header) => {
                        const config = POSITION_COLUMNS.find(
                          (column) => column.id === header.column.id
                        );
                        return (
                          <SortableHeaderCell
                            key={header.id}
                            header={header}
                            label={config?.label ?? header.column.id}
                            align={config?.align ?? "left"}
                            sort={sort}
                            onSort={() => handleSort(header.column.id)}
                          />
                        );
                      })}
                    </SortableContext>
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={headerGroup?.headers.length ?? 1}
                      className="px-3 py-8 text-center text-sm text-zinc-500"
                    >
                      Ningún ticker coincide con la búsqueda.
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-800/60 hover:bg-zinc-800/20">
                      {row.getVisibleCells().map((cell) => {
                        const config = POSITION_COLUMNS.find(
                          (column) => column.id === cell.column.id
                        );
                        const sticky = cell.column.id === "ticker" && cell.column.getIsFirstColumn();
                        return (
                          <td
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className={cn(
                              "overflow-hidden px-3 py-2 tabular-nums",
                              config?.align === "right" ? "text-right" : "text-left",
                              sticky && "sticky left-0 z-10 bg-zinc-950"
                            )}
                          >
                            <table.FlexRender cell={cell} />
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DndContext>
      )}
    </ChartCard>
  );
}

function SortableHeaderCell({
  header,
  label,
  align,
  sort,
  onSort,
}: {
  header: Header<typeof features, PositionTableRow, unknown>;
  label: string;
  align: "left" | "right";
  sort: Sort;
  onSort: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: header.column.id,
  });

  const isSorted = sort?.columnId === header.column.id;
  const sticky = header.column.id === "ticker" && header.column.getIsFirstColumn();

  return (
    <th
      ref={setNodeRef}
      style={{
        width: header.getSize(),
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        // Sticky en el propio `<th>`, no en `<thead>`: pegar el `<thead>` entero es
        // menos confiable entre navegadores que pegar cada celda de encabezado.
        "sticky top-0 z-20 bg-zinc-950",
        "relative select-none whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500",
        align === "right" ? "text-right" : "text-left",
        sticky && "left-0 z-30",
        isDragging && "z-40"
      )}
    >
      <div className={cn("flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-zinc-600 hover:text-zinc-300 active:cursor-grabbing"
          aria-label={`Reordenar columna ${label}`}
          title="Arrastrar para reordenar"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onSort}
          className="flex items-center gap-1 truncate hover:text-zinc-200"
        >
          <span className="truncate">{label}</span>
          {isSorted ? (
            sort?.direction === "asc" ? (
              <ArrowUp className="h-3 w-3 shrink-0" />
            ) : (
              <ArrowDown className="h-3 w-3 shrink-0" />
            )
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-zinc-700" />
          )}
        </button>
      </div>
      {header.column.getCanResize() ? (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          className={cn(
            "absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none",
            header.column.getIsResizing() ? "bg-teal-400" : "bg-transparent hover:bg-zinc-700"
          )}
        />
      ) : null}
    </th>
  );
}
