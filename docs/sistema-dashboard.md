# Sistema de dashboard

> **Documento autocontenido.** Todo lo necesario para trabajar en KPIs, gráficos de asignación,
> concentración y top movers está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router, server actions) · Prisma · decimal.js · **Recharts 3**.
- **Ruta:** `/dashboard`.
- **Fuentes externas:** Yahoo (precios de acciones/CEDEARs), data912 (precios de ONs),
  dolarapi vía `resolveCclRate` (CCL).
- **Es la única pantalla que persiste el CCL** en la tabla `FxRate`.

### Qué hace este sistema

Dar una vista panorámica del portfolio: cuánto invertiste, cuánto vale hoy, cómo está repartido
(por instrumento, mercado y sector), quiénes ganan y pierden, y qué tan concentrado estás.

---

## Pantalla `/dashboard`

```
src/app/(app)/dashboard/page.tsx
  → getDashboardPageDataAction()
  → si "error" → redirect("/login")
  → <DashboardPage data={data} />
```

```
┌ Dashboard  [nombre del portfolio] ────────────────────────────┐
│  "Resumen visual de cómo está parado tu portfolio…"           │
├───────────────────────────────────────────────────────────────┤
│  ⚠ Banner si no hay CCL cargado                               │
├───────────────────────────────────────────────────────────────┤
│  ▸ Vista Detallada                                            │
│    DashboardKpiCards — 5 tarjetas                             │
├───────────────────────────────────────────────────────────────┤
│  ▸ Análisis Gráfico                            [ ARS | USD ]  │
│    ┌ Resumen de Portfolio ─┬ Distribución por Mercado ─┐      │
│    │  donut por ticker     │  donut por segmento       │      │
│    └───────────────────────┴───────────────────────────┘      │
│    Distribución por Sector — barras horizontales              │
│    Valor por Acción — barras verticales                       │
├───────────────────────────────────────────────────────────────┤
│  ▸ Salud del Portfolio                                        │
│    ┌ TopMovers (2 listas) ──────┬ ConcentrationCard ─┐        │
│    └────────────────────────────┴────────────────────┘        │
└───────────────────────────────────────────────────────────────┘
```

Si `data.hasData === false`, renderiza solo el header y un empty state que invita a importar
o cargar una operación.

El toggle ARS/USD es **estado local** (`useState<ViewCurrency>("ARS")`) y se deshabilita en USD
cuando no hay CCL.

---

## Archivos

| Archivo | Rol | Líneas |
|---|---|---|
| `src/lib/dashboard/types.ts` | `DashboardData`, `DashboardKpis`, `AllocationSlice`, `ConcentrationStats`, `TopMover` | 95 |
| `src/lib/dashboard/build.ts` | **`buildDashboardData`** — toda la lógica, pura | 266 |
| `src/app/actions/dashboard.ts` | Server action única | 169 |
| `src/components/dashboard/dashboard-page.tsx` | Página | 226 |
| `src/components/dashboard/dashboard-kpis.tsx` | 5 tarjetas KPI | 144 |
| `src/components/dashboard/chart-card.tsx` | Wrapper de gráficos (título + descripción + icono) | 40 |
| `src/components/dashboard/allocation-donut.tsx` | Donut con leyenda y agrupación "Otros" | 257 |
| `src/components/dashboard/sector-bars.tsx` | Barras horizontales por sector | 62 |
| `src/components/dashboard/value-bars.tsx` | Barras verticales por ticker (Recharts) | 102 |
| `src/components/dashboard/top-movers.tsx` | Mejores y peores rendimientos | 95 |
| `src/components/dashboard/concentration-card.tsx` | Top 5, HHI, posiciones sobredimensionadas | 162 |
| `src/components/dashboard/format.ts` | Formateadores + **paletas de color** | 77 |

### Dependencias de otros sistemas

- `buildHoldings` (`src/lib/transactions/holdings.ts`) — posiciones de acciones y CEDEARs.
- `applyEventsToTrade` vía el `eventsMap` — ajustes por split/ratio.
- `portfolio-bridge` (`src/lib/bonds/`) — posiciones de ONs.
- `refreshLatestQuotes`, `fetchOnPrices`, `resolveCclRate` (`src/lib/market/`).

### Modelos usados

```prisma
model Portfolio {
  id            String    @id @default(cuid())
  userId        String
  name          String
  isDefault     Boolean   @default(false)
  archivedAt    DateTime?
}

model Transaction {
  portfolioId  String
  instrumentId String?
  type         TransactionType    // acá: BUY, SELL
  tradeDate    DateTime
  quantity     Decimal @db.Decimal(20, 8)
  price        Decimal @db.Decimal(20, 8)
  netAmount    Decimal @db.Decimal(20, 8)
  currencyCode String
}

model Instrument {
  id              String @id
  ticker          String
  name            String
  type            InstrumentType
  underlyingAsset UnderlyingAsset?   // ← única fuente de `sector`
}
```

---

## `getDashboardPageDataAction()`

`src/app/actions/dashboard.ts`.

```
1. getCurrentUser()

2. Resolver EL portfolio:
     findFirst({ userId, archivedAt: null }, orderBy [{ isDefault: desc }, { createdAt: asc }])
     si no hay → buildDashboardData({ portfolioName: "Sin portfolio", rawHoldings: [], cclRate: null })

3. Promise.all de 3:
   a) Transaction del portfolio: type ∈ TRADE_TYPES,
      instrument.type ∈ TRADE_INSTRUMENT_TYPES, instrumentId != null, asc
      include instrument { id, ticker, name, type, underlyingAsset { sector } }
   b) resolveCclRate()                         ← lee/persiste FxRate
   c) CorporateEvent del portfolio, asc

4. eventsMap desde (c)

5. Bifurcar: instrument.type === "ON" → onBondTrades, resto → trades (+ sectorByInstrument)

6. Promise.all([ refreshLatestQuotes(instrumentosÚnicos), fetchOnPrices(tickersON) ])

7. equityHoldings = buildHoldings(trades, prices, eventsMap)
   onPositions    = valuateOnPositions(onBondTrades, onPriceResult, cclRate, onNamesById)
   rawHoldings    = [...equityHoldings.map(→HoldingForDashboard), ...onPositions.map(toDashboardHolding)]

8. return buildDashboardData({ portfolioName, rawHoldings, cclRate })
```

### ⚠️ Alcance de un solo portfolio

```ts
const portfolio = await prisma.portfolio.findFirst({
  where: { userId: user.id, archivedAt: null },
  orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  select: { id: true, name: true },
});
// …y después: where: { portfolioId: portfolio.id, … }
```

**El dashboard filtra por UN portfolio** (el default, o el más viejo). En cambio,
`/transactions`, `/dividends` y `/bonds` usan `portfolio: { userId }` — **todos** los del
usuario. Con más de un portfolio, los totales no coinciden entre pantallas. Se resuelve cuando
`/portfolios` y el `PortfolioSwitcher` dejen de ser stubs.

### El CCL: acá sí se persiste

```ts
resolveCclRate()   // src/lib/market/ccl-rate.ts
```

Lee el `FxRate` USD/ARS más reciente; si no es de hoy (UTC), pega a dolarapi y hace upsert.
En caso de fallo, cae al último guardado.

**Es el único consumidor que escribe la tabla `FxRate`.** Por eso `/transactions` muestra
`CCL: —` en una instalación nueva hasta que alguien entre acá. Ver `referencia-proyecto.md`.

---

## `buildDashboardData` — toda la lógica

`src/lib/dashboard/build.ts`. Función **pura** de 266 líneas.

```ts
export function buildDashboardData(args: {
  portfolioName: string;
  rawHoldings: HoldingForDashboard[];
  cclRate: number | null;
  cashArs?: string;      // ← nunca se pasa hoy
  cashUsd?: string;      // ← nunca se pasa hoy
}): DashboardData
```

```ts
export type HoldingForDashboard = {
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  quantity: string;
  costBasisArs: string;
  marketValueArs: string;
  pnlArs: string;
  pnlPercent: string;
  sector: string | null;
};
```

### Segmentación de mercado

```ts
function marketSegmentFor(type: InstrumentType): MarketSegment {
  switch (type) {
    case "CEDEAR":                                        return "CEDEAR";
    case "STOCK_AR": case "BOND_AR": case "LETRA":
    case "ON": case "FCI":                                return "Locales";
    case "STOCK_US": case "ETF":                          return "Externos";
    case "CRYPTO": case "STABLECOIN":                     return "Cripto";
    default:                                              return "Otros";
  }
}
```

### Sectores

Traducción del inglés al español desde un mapa, con derivación por tipo cuando no hay
`underlyingAsset.sector`:

```ts
const SECTOR_ES: Record<string, string> = {
  Technology: "Tecnología", "Consumer Discretionary": "Consumo discrecional",
  "Consumer Staples": "Consumo básico", Financials: "Finanzas", Energy: "Energía",
  Utilities: "Servicios públicos", Materials: "Materiales", Industrials: "Industria",
  "Health Care": "Salud", Healthcare: "Salud",
  "Communication Services": "Comunicación", Communications: "Comunicación",
  "Real Estate": "Real Estate",
};

function translateSector(raw: string | null, instrumentType: InstrumentType): string {
  if (raw && SECTOR_ES[raw]) return SECTOR_ES[raw];
  if (raw?.trim()) return raw;                                  // sector desconocido: tal cual
  if (instrumentType === "ETF") return "ETF";
  if (["BOND_AR","LETRA","ON"].includes(instrumentType)) return "Renta fija";
  if (instrumentType === "FCI") return "Fondos comunes";
  if (["CRYPTO","STABLECOIN"].includes(instrumentType)) return "Cripto";
  return "Sin clasificar";
}
```

> `UnderlyingAsset.sector` es la **única** fuente real de sector, y hoy casi nada lo tiene
> poblado. En la práctica la mayoría de los instrumentos cae en "Sin clasificar" o en el
> pseudo-sector derivado del tipo. Poblar `UnderlyingAsset` es la mejora más directa a este gráfico.

### Las cinco agregaciones

**1. `holdings: DashboardHolding[]`** — cada raw holding enriquecido con `marketSegment`,
`sector` traducido, `marketValueUsd` y `weightPercent` (`marketValueArs / totalValue × 100`).
Ordenado por valor de mercado desc.

**2. `allocationByTicker: AllocationSlice[]`** — con un caso especial:

```ts
const equityHoldings = holdings.filter((h) => h.instrumentType !== "ON");
const onHoldings     = holdings.filter((h) => h.instrumentType === "ON");

// las ONs se colapsan en UNA sola porción con desglose en el hover
if (onHoldings.length > 0) {
  allocationByTicker.push({
    key: "__on__",
    label: "ON",
    valueArs: onTotalArs.toFixed(2),
    valueUsd: toUsd(onTotalArs, cclRate).toFixed(2),
    percent: pctOf(onTotalArs, totalValue),
    details: onHoldings.map((h) => ({ key, label: h.ticker, valueArs, valueUsd, percent })),
  });
}
```

Las ONs suelen ser muchas y chicas: agruparlas evita un donut ilegible. El campo `details` es
lo que renderiza el tooltip desglosado.

**3. `allocationByMarket: AllocationSlice[]`** — suma por `MarketSegment`, ordenado desc.

**4. `allocationBySector: SectorBar[]`** — suma por sector traducido, ordenado desc.

**5. `topGainers` / `topLosers`** — holdings con valor > 0, filtrados por
`pnlPercent > 0` / `< 0`, ordenados por `pnlPercent` y cortados en **5**.

### Concentración

```ts
top5Percent = suma de weightPercent de las 5 primeras (ya ordenadas por valor desc)

hhi = Σ (weightPercent_i)²        // Herfindahl-Hirschman, 0..10000

level = hhi < 1500  ? "baja"
      : hhi < 2500  ? "moderada"
      : hhi < 4000  ? "alta"
      :               "muy_alta"

oversizedPositions = holdings.filter(h => weightPercent > 25)
```

Los umbrales del HHI son los que usa el DOJ estadounidense para concentración de mercado,
reutilizados acá como heurística de diversificación.

### KPIs

```ts
totalInvestedArs = Σ costBasisArs
currentValueArs  = Σ marketValueArs
unrealizedPnlArs = currentValue − totalInvested
unrealizedPnlPercent = pnl / totalInvested × 100     (0 si el costo es 0)

// versiones USD: dividir por cclRate. Sin CCL → 0 (no null)
function toUsd(amountArs: Decimal, cclRate: number | null): Decimal {
  if (!cclRate || cclRate <= 0) return new Decimal(0);
  return amountArs.div(cclRate);
}

cashArs / cashUsd = 0   ← siempre, nadie pasa esos args
totalInstruments  = holdings.length
```

> ⚠️ Sin CCL, los KPIs en USD dan **0**, no `null`. Por eso el banner de advertencia dice
> explícitamente *"Las métricas en USD aparecen en cero"*. Difiere del sistema de bonos, que
> usa `null` y muestra `—`.

---

## Componentes

### `DashboardKpiCards` — 5 tarjetas

Grid de 3 columnas en `lg`.

| Tarjeta | Contenido | Tooltip |
|---|---|---|
| **Total invertido** | ARS + USD | "Costo total acumulado de tus compras netas (PPP)" |
| **Valor actual** | ARS + USD | "Valuación de las posiciones a precios de mercado vigentes" |
| **Rendimiento no realizado** | ARS + USD con delta % | "Diferencia entre el valor actual y lo invertido. No incluye dividendos" |
| **Resumen de posiciones** | `totalInstruments` en celeste | "Cantidad de instrumentos distintos con tenencia positiva" |
| **Liquidez total** (span 2) | `cashArs` / `cashUsd` | "Saldo en efectivo disponible en cuentas conectadas" |

Los tooltips son `title` nativos sobre un icono `HelpCircle`.

> La tarjeta de liquidez **siempre muestra $0** porque nadie pasa `cashArs`/`cashUsd` a
> `buildDashboardData`. Ver deuda técnica.

`CurrencyRow` colorea en verde por defecto y acepta un `valueClass` para pintar el P&L negativo
en rosa.

### `ChartCard`

Wrapper reutilizable: borde `zinc-800`, fondo `zinc-900/40`, título con icono teal, descripción
en `zinc-500`, y un slot `headerExtra`.

### `AllocationDonut`

El componente más elaborado del sistema (257 líneas).

Props:

```ts
{
  data: AllocationSlice[];
  currency: ViewCurrency;
  colorMap?: Record<string, string>;    // color fijo por label
  labelPosition?: "side" | "below";
  centerSubtitle?: string;
  topN?: number;                        // agrupa el resto como "Otros"
}
```

**Agrupación "Otros"** — con una sutileza:

```ts
const protectedSlices = data.filter((d) => d.details?.length);   // ← la porción "ON" nunca se agrupa
const regular = data.filter((d) => !d.details?.length);
const regularBudget = Math.max(topN - protectedSlices.length, 0);
const top = regular.slice(0, regularBudget);
const restItems = regular.slice(regularBudget);
// restItems → una porción gris "Otros" (#52525b)
```

Las porciones con `details` (o sea, el grupo de ONs) están **protegidas**: no las absorbe "Otros".

**Centro del donut:** total formateado + subtítulo (`"N instrumentos"` o `"por mercado"`).

**Interacción:** hover sobre una porción o sobre la leyenda baja la opacidad del resto a `0.35`.
Está sincronizado en ambas direcciones (`activeIndex` compartido).

**Tooltip:** si la porción tiene `details`, lista el desglose (ticker · % · USD);
si no, muestra valor + porcentaje.

**Leyenda:** `side` (columna con scroll, `max-h-72`) o `below` (grid responsive).

Uso en la página:

```tsx
<AllocationDonut data={data.allocationByTicker} currency={currency}
                 topN={12} centerSubtitle={`${kpis.totalInstruments} instrumentos`}
                 colorMap={{ ON: "#6366f1" }} />

<AllocationDonut data={data.allocationByMarket} currency={currency}
                 colorMap={MARKET_COLORS} labelPosition="below"
                 centerSubtitle="por mercado" />
```

### `SectorBars`

Barras horizontales en CSS puro (no Recharts). El ancho es **relativo al sector más grande**,
no al total:

```ts
const max = Math.max(...data.map((d) => Number(d.percent)));
barWidth = (Number(d.percent) / max) * 100;
// mínimo visual del 4% para que las porciones chicas se vean
```

Cada barra usa un gradiente y un `box-shadow` con el color del sector (`SECTOR_COLORS`), y un
`title` con el monto.

### `ValueByTickerBars`

`BarChart` de Recharts. Cada barra con su color de `CHART_COLORS` y `LabelList` arriba en
formato compacto.

Adaptación al volumen de datos:

```tsx
angle={data.length > 12 ? -30 : 0}
height={data.length > 12 ? 50 : 28}
textAnchor={data.length > 12 ? "end" : "middle"}
```

El tooltip muestra valor · % del portfolio · P&L %.

### `TopMovers`

Dos listas lado a lado: **Mejores rendimientos** (verde, `TrendingUp`) y **Peores**
(rosa, `TrendingDown`).

Cada fila: `TickerAvatar` + ticker + nombre + `pnlPercent` con signo + P&L en la moneda activa.

Empty state del lado de las pérdidas: *"Aún no hay perdedores. ¡Bien ahí!"*

### `ConcentrationCard`

| Elemento | Detalle |
|---|---|
| Badge de nivel | Color y copy según `level` (`LEVEL_META`), con `ShieldCheck` si es "baja" y `AlertTriangle` si no |
| Barra "Top 5 posiciones" | Progreso clampeado a 0..100 |
| Posición más grande | Ticker + % |
| HHI | Número formateado |
| Texto de ayuda | Según nivel |
| Alerta ámbar | Solo si hay `oversizedPositions`: lista `TICKER (X%)` |

```ts
const LEVEL_META = {
  baja:      { label: "Baja",      helper: "Buena diversificación entre instrumentos.",        color: emerald },
  moderada:  { label: "Moderada",  helper: "Diversificación razonable. Vigilar posiciones grandes.", color: sky },
  alta:      { label: "Alta",      helper: "Algunas pocas posiciones dominan el portfolio.",    color: amber },
  muy_alta:  { label: "Muy alta",  helper: "Concentración elevada. Evaluá diversificar.",       color: rose },
};
```

---

## Paleta (`src/components/dashboard/format.ts`)

Este archivo es la **fuente de color de todos los gráficos** del dashboard.

```ts
export const CHART_COLORS = [
  "#3b82f6","#ef4444","#f59e0b","#f97316","#6366f1","#10b981","#eab308","#a855f7",
  "#ec4899","#06b6d4","#84cc16","#22d3ee","#f43f5e","#14b8a6","#8b5cf6","#fb7185",
];   // 16 colores, se cicla con módulo

export const SECTOR_COLORS: Record<string, string> = {
  "Energía": "#14b8a6", "Consumo básico": "#a855f7", Finanzas: "#ec4899",
  "Consumo discrecional": "#ef4444", Tecnología: "#f97316", Comunicación: "#06b6d4",
  "Servicios públicos": "#eab308", Materiales: "#84cc16", Industria: "#3b82f6",
  Salud: "#10b981", "Real Estate": "#f59e0b", "Renta fija": "#6366f1",
  "Fondos comunes": "#8b5cf6", Cripto: "#fb7185", ETF: "#22d3ee",
  "Sin clasificar": "#71717a",
};

export const MARKET_COLORS: Record<string, string> = {
  CEDEAR: "#a855f7", Locales: "#fb7185", Externos: "#3b82f6",
  Cripto: "#f97316", Otros: "#71717a",
};
```

Formateadores:

```ts
formatMoney(value, currency)         // "$ 1.234,56" / "US$ 1.234,56" — es-AR
formatCompact(value, currency)       // "$1,2 M" — notation compact, para ejes
formatPercent(value, digits = 2)     // "12,34%"
formatSignedPercent(value, digits)   // "+12,34%"
```

**Si agregás un sector o un segmento nuevo, agregá su color acá** o va a caer al gris de
`CHART_COLORS` por módulo.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **Alcance de un solo portfolio.** Difiere de las otras 3 pantallas, que usan todos |
| 2 | **La tarjeta de Liquidez siempre muestra $0.** `cashArs`/`cashUsd` son parámetros opcionales que nadie pasa. Requiere calcular el saldo desde DEPOSIT/WITHDRAWAL/BUY/SELL |
| 3 | **Sin CCL, los KPIs en USD dan 0, no `null`.** Inconsistente con bonos (que muestra `—`) |
| 4 | **Casi nada tiene sector.** `UnderlyingAsset.sector` es la única fuente y está mayormente vacío; el gráfico se llena de "Sin clasificar" y pseudo-sectores |
| 5 | **`TRADE_INSTRUMENT_TYPES` acotado.** Igual que transacciones: BOND_AR, LETRA, FCI y cripto no aparecen |
| 6 | **No hay evolución temporal.** No hay serie de valor del portfolio en el tiempo. `PortfolioSnapshot` existe en el schema pero nadie lo escribe, y `src/lib/calculations/performance.ts` es un stub |
| 7 | **El P&L no incluye dividendos ni cupones.** Es puramente no realizado sobre posiciones abiertas. El tooltip lo aclara, pero el número puede engañar |
| 8 | **El toggle ARS/USD es local.** No se persiste ni respeta `user.displayCurrencyCode` |
| 9 | **`sector` de las ONs siempre es `null`** (lo fija `toDashboardHolding`), así que caen todas en "Renta fija" |
| 10 | **`eventsMap` duplicado** con las actions de transacciones y dividendos |
| 11 | **Sin tests.** `buildDashboardData` es puro y es el candidato más obvio (HHI, pesos, agrupación de ONs) |

---

## Cómo extender

### Agregar un KPI

1. Sumar el campo a `DashboardKpis` (`src/lib/dashboard/types.ts`).
2. Calcularlo en `buildDashboardData`.
3. Agregar la `<KpiCard>` en `dashboard-kpis.tsx` (podés reusar `CurrencyRow`).

### Agregar un gráfico

1. Sumar la estructura de datos a `DashboardData` (`types.ts`).
2. Calcularla en `buildDashboardData`.
3. Crear el componente en `src/components/dashboard/`.
4. Envolverlo en `<ChartCard title description icon>` dentro de `dashboard-page.tsx`.
5. **Agregar los colores** a `format.ts` si introduce categorías nuevas.
6. Que respete el prop `currency: ViewCurrency`.

### Implementar la liquidez real

`buildDashboardData` ya acepta `cashArs` y `cashUsd`. Falta calcularlos:

1. Query de `Transaction` con `type ∈ [DEPOSIT, WITHDRAWAL, BUY, SELL, DIVIDEND_CASH, COUPON, AMORTIZATION, FEE, TAX_WITHHOLDING]`.
2. Acumular por moneda: los ingresos suman, los egresos restan.
3. Pasarlos a `buildDashboardData`.

Ojo con el signo: `netAmount` de un BUY es positivo (plata que sale) — hay que restarlo.

### Implementar evolución temporal

Es la feature grande que falta. Camino sugerido:

1. Un cron diario que escriba `PortfolioSnapshot` (ya tiene `totalValueArs`, `totalValueUsd`,
   `netDeposits*`, `twrSinceInception`, `positions` JSON).
2. Implementar `src/lib/calculations/performance.ts` con TWR (Time-Weighted Return) usando los
   aportes netos para neutralizar el efecto de depósitos y retiros.
3. Un `LineChart` de Recharts nuevo alimentado por los snapshots.

Sin snapshots no hay serie histórica: los precios en `PriceCache` alcanzan para reconstruir
valuaciones pasadas, pero no las tenencias en cada fecha sin recorrer todo el histórico.

### Poblar sectores

1. Crear `UnderlyingAsset` para los tickers principales (con `sector` en inglés, para que
   `SECTOR_ES` lo traduzca).
2. Linkear `Instrument.underlyingAssetId`.
3. Opción automatizable: Yahoo expone `assetProfile.sector` en otro endpoint — se podría sumar
   al sync de catálogo (`src/lib/market/catalog-sync.ts`).

### Cambiar los umbrales de concentración

Están en `buildDashboardData`:

```ts
if (hhiNum < 1500) level = "baja";
else if (hhiNum < 2500) level = "moderada";
else if (hhiNum < 4000) level = "alta";
else level = "muy_alta";

const oversizedPositions = holdings.filter((h) => Number(h.weightPercent) > 25);
```

Los copys de cada nivel viven en `LEVEL_META` de `concentration-card.tsx`.

### Escribir el primer test

```ts
import { buildDashboardData } from "@/lib/dashboard/build";

const data = buildDashboardData({
  portfolioName: "Test",
  cclRate: 1000,
  rawHoldings: [
    { instrumentId: "1", ticker: "AAPL", instrumentName: "Apple", instrumentType: "CEDEAR",
      quantity: "10", costBasisArs: "1000", marketValueArs: "1500",
      pnlArs: "500", pnlPercent: "50", sector: "Technology" },
    { instrumentId: "2", ticker: "GGAL", instrumentName: "Galicia", instrumentType: "STOCK_AR",
      quantity: "50", costBasisArs: "500", marketValueArs: "500",
      pnlArs: "0", pnlPercent: "0", sector: null },
  ],
});

// kpis.currentValueArs "2000.00", currentValueUsd "2.00"
// holdings[0].weightPercent "75.00"
// concentration.hhi = 75² + 25² = 6250 → level "muy_alta"
// allocationBySector: ["Tecnología" 75%, "Sin clasificar" 25%]
```

Casos que valen la pena: portfolio vacío (`hasData: false`), sin CCL (USD en 0), agrupación de
ONs en la porción `__on__`, y los cuatro niveles de HHI.
