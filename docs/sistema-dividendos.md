# Sistema de dividendos

> **Documento autocontenido.** Todo lo necesario para trabajar en dividendos recibidos,
> retenciones y proyección de pagos está acá.
>
> Reemplaza a `DIVIDENDS_FEATURE.md` (raíz del repo), que quedó desactualizado.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router, server actions) · Prisma · decimal.js · Recharts.
- **Ruta:** `/dividends`.
- **Fuentes externas:** Yahoo Finance (historial de dividendos + quotes) y dolarapi (CCL).
- **Regla contable central:** cada pago se guarda **solo en su moneda nativa**. Nunca se resta
  ARS de USD.

### Qué hace este sistema

Mostrar los dividendos ya cobrados (leídos de `Transaction`), estimar los próximos a partir del
historial de Yahoo y las tenencias actuales, y agregar todo en KPIs, calendario, gráficos y
tablas.

---

## Pantalla `/dividends`

```
src/app/(app)/dividends/page.tsx
  → getDividendsPageDataAction()
  → si "error" → redirect("/login")
  → <DividendsPage data={data} />
```

```
┌ Dividendos ──────────────────────────────────── [ ARS | USD ] ┐
│  "Lo que cobraste, lo que estimamos… retenciones"             │
├───────────────────────────────────────────────────────────────┤
│  ⚠ Banner si no hay CCL de dolarapi                           │
├───────────────────────────────────────────────────────────────┤
│  DividendKpiCards — 6 tarjetas                                │
├───────────────────────────────────────────────────────────────┤
│  DividendCalendar — 12 meses (−6 a +5) + detalle del mes      │
├───────────────────────────────────────────────────────────────┤
│  DividendCharts — barras mensuales + torta por ticker         │
├───────────────────────────────────────────────────────────────┤
│  [ Por ticker ] [ Historial de pagos ]                        │
├───────────────────────────────────────────────────────────────┤
│  ▸ N ticker(s) sin estimación disponible  (details colapsable)│
└───────────────────────────────────────────────────────────────┘
```

El toggle ARS/USD es **estado local** de la página (`useState<ViewCurrency>("ARS")`), no una
preferencia global.

---

## Archivos

| Archivo | Rol | Líneas |
|---|---|---|
| `src/lib/dividends/types.ts` | `ReceivedDividend`, `UpcomingDividend`, `DividendKpis`, `DividendsPageData` | 130 |
| `src/lib/dividends/aggregate.ts` | **Emparejado de dividendos con retenciones** | 112 |
| `src/lib/dividends/forecast.ts` | **Proyección de pagos futuros** (Yahoo) | 226 |
| `src/lib/dividends/build.ts` | Composición pura del DTO de página | 278 |
| `src/app/actions/dividends.ts` | Server action única | 120 |
| `src/components/dividends/dividends-page.tsx` | Página | 136 |
| `src/components/dividends/dividend-kpis.tsx` | 6 KPIs | 173 |
| `src/components/dividends/dividend-calendar.tsx` | Calendario 12 meses | 269 |
| `src/components/dividends/dividend-charts.tsx` | Barras + torta | 171 |
| `src/components/dividends/dividend-detail-table.tsx` | Tablas por ticker e historial | 183 |
| `src/components/dividends/format.ts` | Formateadores es-AR | 60 |

### Modelos y dependencias

```prisma
model Transaction {
  id            String   @id @default(cuid())
  type          TransactionType   // acá: DIVIDEND_CASH, TAX_WITHHOLDING, BUY, SELL
  tradeDate     DateTime
  quantity      Decimal  @db.Decimal(20, 8)
  price         Decimal  @db.Decimal(20, 8)
  netAmount     Decimal  @db.Decimal(20, 8)
  currencyCode  String
  brokerFxRate  Decimal? @db.Decimal(20, 8)   // ← código de especie, NO cotización
  notes         String?
  instrumentId  String?
  instrument    Instrument? @relation(...)
}
```

Depende también de:

- `buildHoldings` (`src/lib/transactions/holdings.ts`) para las tenencias actuales.
- `applyEventsToTrade` vía el `eventsMap` de eventos corporativos.
- `fetchYahooDividends` / `fetchYahooQuote` (`src/lib/market/yahoo.ts`).
- `fetchCclQuote` (`src/lib/market/dolarapi.ts`).

```ts
const HOLDABLE_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR", "STOCK_US", "ETF"];
```

Ojo: este set **no es** `TRADE_INSTRUMENT_TYPES` (que es `["STOCK_AR","CEDEAR","ON"]`).
Dividendos incluye `STOCK_US` y `ETF`, y excluye `ON` (las ONs pagan cupones, no dividendos).

---

## Flujo de datos

```
Prisma
 ├─ DIVIDEND_CASH + TAX_WITHHOLDING ──► aggregate.ts ──────► ReceivedDividend[]
 │
 ├─ BUY/SELL (HOLDABLE_TYPES) ─┐
 ├─ CorporateEvent ────────────┴──────► buildHoldings() ──► HoldingRow[]
 │                                             │
 │                                             ▼
 │                              forecast.ts (Yahoo: dividendos + quotes)
 │                                             │
 │                                             ▼
 │                                      UpcomingDividend[] + errors[]
 │
 └─ dolarapi ──► cclToday
                    │
                    ▼
        build.ts ──► DividendsPageData { kpis, byTicker, byMonth, calendar, received, upcoming }
                    │
                    ▼
              <DividendsPage />
```

---

## `getDividendsPageDataAction()`

```
1. getCurrentUser()

2. Promise.all de 4:
   a) Transaction type ∈ [DIVIDEND_CASH, TAX_WITHHOLDING] del usuario, desc
   b) Transaction type ∈ [BUY, SELL] con instrument.type ∈ HOLDABLE_TYPES, asc
   c) fetchCclQuote()                              ← directo, NO usa resolveCclRate
   d) CorporateEvent de instrumentos del usuario, asc

3. received = aggregateReceivedDividends(a)
4. eventsMap desde (d)
5. holdingRows = buildHoldings(trades, new Map(), eventsMap)   ← precios vacíos a propósito
6. { upcoming, errors } = await forecastUpcomingDividends(holdings, cclToday, 6)
7. return buildDividendsPageData({ received, upcoming, holdings, cclToday, yahooErrors: errors })
```

Dos detalles:

- El `Map` de precios va **vacío** porque acá solo importa la cantidad, no el valor de mercado.
- El CCL sale de `fetchCclQuote()` directo, sin persistir. El dashboard usa `resolveCclRate()`.
  Ver la deuda técnica en `referencia-proyecto.md`.

---

## 🔑 Emparejado de retenciones (`aggregate.ts`)

El problema que resuelve: **Balanz reporta el dividendo de un CEDEAR en USD y su impuesto en
ARS, en dos filas separadas.** Para acciones argentinas, ambos vienen en ARS.

### Clave de match

```
`${TICKER}|${YYYY-MM-DD}`      ← sin importar la moneda
```

```ts
const taxByKey = new Map<string, { ars: Decimal; usd: Decimal }>();
for (const t of taxes) {
  const ticker = tickerForTax(t);
  if (!ticker) continue;
  const key = `${ticker}|${t.tradeDate.toISOString().slice(0, 10)}`;
  const amount = new Decimal(t.netAmount.toString()).abs();
  const bucket = taxByKey.get(key) ?? { ars: 0, usd: 0 };
  if (asDividendCurrency(t.currencyCode) === "USD") bucket.usd = bucket.usd.plus(amount);
  else                                              bucket.ars = bucket.ars.plus(amount);
  taxByKey.set(key, bucket);
}
```

Los impuestos se **acumulan por moneda** en un bucket, no se mezclan.

### Ticker de una retención sin instrumento

```ts
const TICKER_FROM_NOTES = /-\s*([A-Z0-9.]+)\s*$/i;

function tickerForTax(t: RawTransaction): string | null {
  if (t.instrument?.ticker) return t.instrument.ticker.toUpperCase();
  return tickerFromTaxNotes(t.notes);   // extrae del final de la descripción
}
```

Las filas de `Movimiento Manual` reclasificadas como `TAX_WITHHOLDING` por el importer suelen
no tener instrumento asociado, pero la descripción termina en `- TICKER`.

### La regla contable

```ts
const nativeCurrency = asDividendCurrency(d.currencyCode);   // "USD" | "ARS"
const grossNative = new Decimal(d.netAmount.toString()).abs();

const grossUsd = nativeCurrency === "USD" ? grossNative : 0;
const grossArs = nativeCurrency === "ARS" ? grossNative : 0;

const taxArs = taxBucket.ars;
const taxUsd = taxBucket.usd;

// Neto SOLO cuando dividendo e impuesto comparten moneda
const netUsd = nativeCurrency === "USD" ? grossUsd.minus(taxUsd) : 0;
const netArs = nativeCurrency === "ARS" ? grossArs.minus(taxArs) : 0;
```

| Caso | Bruto | Impuesto | Neto |
|---|---|---|---|
| **Acción AR** | `grossArs` | `taxArs` | `netArs = grossArs − taxArs` |
| **CEDEAR** | `grossUsd` | `taxArs` (aparte) | `netUsd = grossUsd` (no se resta) |

> **Restar ARS de USD no representa nada real.** El usuario cobró dólares y pagó pesos: son dos
> hechos económicos distintos. La UI los muestra por separado, y los pesos se acumulan en el KPI
> "Impuestos pagados (ARS)".

### `cclAtPayment` siempre es `null`

```ts
// El campo brokerFxRate (ej. "7000") es un código de especie, NO una cotización.
// Lo persistimos por trazabilidad pero no lo exponemos como CCL.
cclAtPayment: null,
```

El `7000` de `"Dólares C.V. 7000"` que reporta Balanz **no es un tipo de cambio**. El tipo
`ReceivedDividend` tiene el campo por si algún día hay una fuente real de CCL histórico.

---

## Proyección de pagos futuros (`forecast.ts`)

```ts
export async function forecastUpcomingDividends(
  holdings: HoldingForForecast[],
  cclToday: number | null,
  horizonMonths = 6
): Promise<{ upcoming: UpcomingDividend[]; errors: string[] }>
```

Corre todos los holdings en paralelo. Cada error se acumula en `errors[]` sin romper el resto.
Se saltean los holdings con `quantity <= 0`.

### Camino A — CEDEAR con ratio derivado del arbitraje

```ts
const [usaDivResult, usaQuoteResult, baQuoteResult] = await Promise.allSettled([
  fetchYahooDividends("AAPL"),     // dividendos de la acción USA
  fetchYahooQuote("AAPL"),         // precio en USD
  fetchYahooQuote("AAPL.BA"),      // precio del CEDEAR en ARS
]);
```

Si los tres salen bien **y** hay CCL:

```
ratio = round( (priceUsd × cclToday) / priceArs )
dividendo por CEDEAR = último dividendo USD / ratio
moneda = USD
```

> 🔑 **Por qué así:** el ratio CEDEAR (cuántos CEDEARs equivalen a 1 acción USA) se deriva del
> arbitraje vigente en vez de mantener una tabla hardcodeada. Se autocorrige si el ratio cambia
> — que es exactamente lo que pasó con SPY (20:1 → 60:1).

Si falta cualquier insumo, cae al camino B.

### Camino B — legacy

Lee dividendos del símbolo directamente (`buildYahooSymbol` agrega `.BA` a instrumentos
argentinos) y proyecta en la moneda que reporte Yahoo (`pickCurrency`: `USD` si Yahoo dice USD,
si no `ARS`).

Se usa para `STOCK_AR`, `STOCK_US`, `ETF`, y como fallback de CEDEAR.

### Cadencia

```ts
function averageIntervalDays(events: YahooDividendEvent[]): number | null {
  // gaps entre pagos consecutivos, filtrando outliers: 5 < gap < 540 días
  // devuelve la MEDIANA
}
```

Con menos de 2 eventos o sin gaps válidos, devuelve `null` → asume **anual** (365 días).

### La ventana de gracia

```ts
const graceDays = Math.max(15, cadenceDays * 0.2);
let nextTs = lastTimestampMs + cadenceDays * MS_PER_DAY;
while (nextTs < now - graceMs) nextTs += cadenceDays * MS_PER_DAY;
while (nextTs - now <= horizonMs) { proyectar(nextTs); nextTs += cadenceDays * MS_PER_DAY; }
```

> Los gaps reales oscilan ±15% (ejemplo documentado: PM paga cada 83–99 días, mediana 91). Si
> la proyección cae **apenas** en el pasado por esa variabilidad, se mantiene como "próxima" en
> vez de saltar al ciclo siguiente y perder el pago que está por llegar.

Horizonte: `horizonMonths × 31 días` (6 meses por defecto).

### Salida

```ts
export type UpcomingDividend = {
  ticker: string;
  instrumentName: string | null;
  estimatedDate: string;             // ISO
  estimatedAmountPerShare: string;   // toFixed(4)
  quantity: string;
  estimatedTotal: string;            // amountPerUnit × qty, toFixed(2)
  currencyCode: "ARS" | "USD";
  isEstimate: true;                  // literal, marca la UI
};
```

---

## Agregación y KPIs (`build.ts`)

Función pura de 278 líneas. Recibe `{ received, upcoming, holdings, cclToday, yahooErrors }`
y devuelve `DividendsPageData`.

### Agregaciones

| Salida | Cómo se arma |
|---|---|
| `byTicker` | Agrupado por ticker: pagos, bruto/tax/neto en ARS y USD, cantidad actual. Ordenado por `grossArs + grossUsd` desc |
| `byMonth` | Agrupado por `YYYY-MM`, ordenado ascendente. Label `"Ene 26"` |
| `calendar` | 12 meses fijos, `offset -6..+5` desde hoy. Cada mes lleva sus `received` y `upcoming` |
| `received` | Copia ordenada por fecha desc |
| `upcoming` | Tal cual viene del forecast (ya ordenado asc) |

### KPIs

```ts
totalGrossUnifiedArs = cclToday > 0
  ? grossArs + grossUsd × cclToday
  : null;                              // ← null explícito, no 0

effectiveTaxRate = totalGrossUnifiedArs
  ? totalTaxArs / totalGrossUnifiedArs × 100
  : "0.00";

totalNetArs = totalGrossArs − totalTaxArs;   // solo acciones AR
totalNetUsd = totalGrossUsd;                 // CEDEARs, sin restar el tax en ARS
```

YTD y año anterior se calculan por `getUTCFullYear()` del `tradeDate`:

```ts
if (year === nowYear)      { ytdNetArs += grossArs − taxArs;  ytdNetUsd += grossUsd; }
else if (year === nowYear-1) { lastYearNetArs += …;            lastYearNetUsd += grossUsd; }
```

`next30dEstimated{Ars,Usd}`: suma de `upcoming` con `estimatedDate <= now + 30 días`,
convertida con `cclToday` (si no hay CCL, la conversión cross-currency aporta 0).

`topTicker`: el primero de `byTicker` (el de mayor bruto combinado).

---

## Componentes

### `DividendKpiCards` — 6 tarjetas

| KPI | Contenido | Acento |
|---|---|---|
| **Total recibido neto** | `DualKpi`: ARS arriba, USD abajo. Tooltip explicando por qué van separados | emerald |
| **Total bruto** | `totalGrossUnifiedArs` o `—`. Subtítulo con el desglose + CCL usado | — |
| **Impuestos pagados (ARS)** | `totalTaxArs` + `effectiveTaxRate` | rose |
| **Mayor pagador** | Ticker + neto en la moneda activa | amber |
| **`<año>` vs `<año-1>`** | Neto YTD + delta % vs el año anterior | emerald/rose según signo |
| **Próximos 30 días (estim.)** | `next30dEstimated` | violet |

El tooltip del primer KPI (`NET_TOOLTIP`) es el que explica la regla contable al usuario:

> *"Los dividendos de CEDEARs se depositan en dólar cable (CCL) y los impuestos se pagan en
> pesos. Estos pesos se acumulan en 'Impuestos pagados (ARS)'. Mostramos ARS y USD por separado
> porque mezclarlos no representa lo que cobraste."*

### `DividendCalendar`

Dos partes:

**`MonthStrip`** — 12 botones (grid 3/6/12 según breakpoint). Cada uno muestra:
mes abreviado + año corto, una barra de intensidad relativa al mes de mayor volumen
(verde si hubo recibidos, violeta si solo hay estimados), contadores `Np`/`Ne`, y el total.
El mes actual arranca seleccionado.

**`MonthDetail`** — grid de 2 columnas con una card por pago:

- **Recibido** (borde emerald): avatar, ticker, badge "Recibido", fecha, neto grande,
  y desglose bruto / retención.
- **Estimado** (borde violeta): avatar, ticker, chip "✨ Estimado" con tooltip, fecha,
  total estimado, y desglose por acción / cantidad.

> ⚠️ Hay un `console.log({ gross })` olvidado dentro del `map` de recibidos
> (`dividend-calendar.tsx`, en `MonthDetail`). Sacarlo.

### `DividendCharts`

Dos cards lado a lado:

1. **Evolución mensual** — `BarChart` con 3 series: Bruto (azul), Retención (rosa), Neto (verde).
2. **Distribución por ticker** — `PieChart` donut con el top 8 por neto + "Otros".

Ambos con empty state *"Aún no hay pagos recibidos."*

### `DividendByTickerTable`

Columnas: Ticker (avatar + nombre) · Pagos · Bruto · Retenciones · Neto · Cantidad actual.
Los montos siguen la moneda del toggle. Empty state invita a importar desde Balanz.

### `DividendHistoryTable`

Buscador propio (por ticker o nombre) y columnas **fijas en su moneda nativa**:

| Columna | Regla |
|---|---|
| Cobrado USD | solo si `grossUsd > 0` (es CEDEAR), si no `—` |
| Cobrado ARS | solo si NO es CEDEAR |
| Impuesto ARS | solo si `taxArs > 0` |
| Neto ARS | solo si NO es CEDEAR |

```ts
const isCedear = Number(r.grossUsd) > 0;
```

Esta tabla ignora el toggle a propósito: muestra el hecho contable como ocurrió.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **`console.log({ gross })` olvidado** en `dividend-calendar.tsx` |
| 2 | **El CCL no se persiste.** Usa `fetchCclQuote()` directo en vez de `resolveCclRate()`. Los totales unificados cambian según cuándo mires la página |
| 3 | **No hay CCL histórico.** `cclAtPayment` siempre `null`. Los totales mezclados usan el CCL de hoy para pagos de hace años — está documentado como "referencia", pero no es exacto |
| 4 | **`DIVIDEND_STOCK` no se procesa.** El enum existe, `aggregate.ts` solo mira `DIVIDEND_CASH` |
| 5 | **La proyección no considera fecha ex-dividendo.** Usa la fecha de pago histórica; si vendés antes de la ex-date, la estimación es incorrecta |
| 6 | **El ratio CEDEAR se deriva del arbitraje instantáneo.** Un mercado ilíquido o un momento raro puede dar un ratio mal redondeado |
| 7 | **N×3 fetches a Yahoo por render** de la página para holdings CEDEAR, sin límite de concurrencia. Mitigado por el revalidate de 12 h de los dividendos |
| 8 | **El calendario es fijo en −6/+5 meses.** No se puede navegar más allá |
| 9 | **`HOLDABLE_TYPES` diverge de `TRADE_INSTRUMENT_TYPES`.** Incluye `STOCK_US` y `ETF` que la página de transacciones no muestra |
| 10 | **Sin tests.** `aggregate.ts`, `build.ts` y `averageIntervalDays` son puros y testeables |
| 11 | Hay una línea comentada en `dividend-calendar.tsx`: `// const tax = r.currencyCode === "ARS" ? r.taxArs : r.taxUsd;` reemplazada por `const tax = r.taxArs;` — vale documentar por qué o limpiarla |

---

## Cómo extender

### Procesar dividendos en acciones (`DIVIDEND_STOCK`)

1. Sumar el tipo a la query de `getDividendsPageDataAction`.
2. En `aggregate.ts`, decidir el modelo: un dividendo en acciones aumenta la cantidad sin flujo
   de caja. Probablemente convenga tratarlo como un `CorporateEvent` (ver
   `sistema-eventos-corporativos.md`) más que como dividendo.

### Usar CCL histórico

1. Poblar `FxRate` con serie diaria (dolarapi tiene endpoint histórico, o guardarlo día a día
   con un cron).
2. En `aggregate.ts`, buscar el `FxRate` de `tradeDate` y llenar `cclAtPayment`.
3. En `build.ts`, usar `cclAtPayment` en vez de `cclToday` para los totales unificados.
4. Mantener `cclToday` para las estimaciones futuras.

Es el cambio de mayor impacto en exactitud del sistema.

### Agregar un KPI

1. Sumar el campo a `DividendKpis` en `src/lib/dividends/types.ts`.
2. Calcularlo en `buildDividendsPageData`.
3. Agregar la card en `dividend-kpis.tsx` (usá `Kpi` o `DualKpi`, ya existen).

### Mejorar la proyección

Puntos de entrada, en orden de retorno:

- **Fecha ex-dividendo:** Yahoo la expone en otros endpoints. Cambiaría el filtro de holdings
  elegibles.
- **Cadencia declarada:** en vez de inferir por mediana, leer la frecuencia que declara la
  empresa.
- **Crecimiento del dividendo:** hoy proyecta el último monto constante. Se podría extrapolar
  la tendencia de los últimos N pagos.

Todo vive en `src/lib/dividends/forecast.ts`; `build.ts` no necesita cambios mientras el tipo
`UpcomingDividend` no cambie.

### Escribir el primer test

```ts
import { aggregateReceivedDividends } from "@/lib/dividends/aggregate";

// CEDEAR: dividendo en USD + retención en ARS, mismo ticker y fecha
const rows = [
  { id: "1", type: "DIVIDEND_CASH", tradeDate: new Date("2026-03-15"),
    netAmount: { toString: () => "12.50" }, currencyCode: "USD", quantity: { toString: () => "0" },
    brokerFxRate: null, notes: null,
    instrument: { id: "i1", ticker: "AAPL", type: "CEDEAR", name: "Apple" } },
  { id: "2", type: "TAX_WITHHOLDING", tradeDate: new Date("2026-03-15"),
    netAmount: { toString: () => "-3200" }, currencyCode: "ARS", quantity: { toString: () => "0" },
    brokerFxRate: null, notes: "Ret IIGG - AAPL", instrument: null },
];

const [d] = aggregateReceivedDividends(rows);
// grossUsd "12.50", taxArs "3200.00", netUsd "12.50", netArs "0.00"
```

Casos que valen la pena: el match por notas cuando no hay instrumento, acción AR
(ambos en ARS → neto real), y varias retenciones para el mismo pago.
