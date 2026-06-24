# Feature `/dividends` — Análisis técnico detallado

> Documento de referencia para auditar si la feature está bien construida.
> Generado: 2026-06-17. Branch: `main`.

---

## 1. Resumen ejecutivo

La feature `/dividends` muestra:
- **Dividendos recibidos** (histórico real, leído de `Transaction`).
- **Dividendos estimados** (proyección a futuro basada en historial de Yahoo Finance + holdings actuales).
- **KPIs agregados** (bruto, retención, neto, top pagador, YoY, próximos 30 días).
- **Calendario 12 meses** (6 atrás + 6 adelante), tablas por ticker e historial, y gráficos.

La data fluye así:

```
Prisma (Transaction + FxRate + Instrument)
   │
   ├── DIVIDEND_CASH + TAX_WITHHOLDING ──► aggregate.ts ──► ReceivedDividend[]
   │
   ├── BUY/SELL + CorporateEvent ────────► holdings.ts ───► Holding[]
   │                                               │
   │                                               ▼
   │                                        forecast.ts (Yahoo Finance)
   │                                               │
   │                                               ▼
   │                                        UpcomingDividend[]
   │
   └── FxRate (USD/ARS, mid)
                  │
                  ▼
          build.ts ──► DividendsPageData { kpis, byTicker, byMonth, calendar, ... }
                  │
                  ▼
          DividendsPage (client component)
```

---

## 2. Inventario de archivos

| Archivo | Propósito |
|---|---|
| `src/app/(app)/dividends/page.tsx` | Server component; invoca el action y renderiza la página. |
| `src/app/actions/dividends.ts` | Server action principal: `getDividendsPageDataAction()`. Orquesta todo. |
| `src/lib/dividends/types.ts` | Tipos: `ReceivedDividend`, `UpcomingDividend`, `DividendKpis`, etc. |
| `src/lib/dividends/aggregate.ts` | Cruza `DIVIDEND_CASH` con `TAX_WITHHOLDING` para calcular neto. |
| `src/lib/dividends/forecast.ts` | Proyección futura usando Yahoo Finance + holdings. |
| `src/lib/dividends/build.ts` | KPIs, calendario, agregados por ticker y por mes. |
| `src/lib/transactions/holdings.ts` | `buildHoldings()` — quantity actual por instrumento (aplica eventos corporativos). |
| `src/lib/market/yahoo.ts` | `fetchYahooDividends()`, `buildYahooSymbol()` (sufijo `.BA` para activos AR). |
| `src/components/dividends/dividends-page.tsx` | Layout cliente con tabs, toggle ARS/USD. |
| `src/components/dividends/dividend-kpis.tsx` | 6 cards KPI. |
| `src/components/dividends/dividend-calendar.tsx` | Calendario 12 meses + detalle del mes. |
| `src/components/dividends/dividend-charts.tsx` | Bar chart (mensual) + Pie (por ticker). |
| `src/components/dividends/dividend-detail-table.tsx` | Tabla por ticker + tabla de historial con búsqueda. |
| `src/components/dividends/format.ts` | Formatters es-AR (money, %, dates). |
| `prisma/schema.prisma` | Modelos `Transaction`, `Instrument`, `FxRate`, `CorporateEvent`. |

---

## 3. Schema de DB relevante

### `Transaction` (`prisma/schema.prisma:287`)

| Campo | Tipo | Uso en dividends |
|---|---|---|
| `type` | `TransactionType` (enum) | Se filtra por `DIVIDEND_CASH` y `TAX_WITHHOLDING`. |
| `tradeDate` | `DateTime` | Fecha de pago/retención. Clave para matchear DIVIDEND con TAX. |
| `currencyCode` | `String` | `"ARS"` o `"USD"`. |
| `netAmount` | `Decimal` | **⚠️ Guarda el monto BRUTO** (naming engañoso). |
| `grossAmount` | `Decimal` | Existe pero el código **NO la usa** — usa `netAmount`. |
| `taxes` | `Decimal` | No usado para dividendos (la retención va en una transacción aparte). |
| `notes` | `String?` | Para `TAX_WITHHOLDING`: se parsea con regex para extraer ticker. |
| `instrumentId` | `String?` | FK a `Instrument` (ticker, nombre, tipo). |

### `TransactionType` (enum)

Valores relevantes:
- `DIVIDEND_CASH` — Dividendo en efectivo recibido.
- `DIVIDEND_STOCK` — **No se consulta ni se muestra en la feature.**
- `TAX_WITHHOLDING` — Retención asociada (IIGG / BBPP).

### `FxRate` (`prisma/schema.prisma:398`)

| Campo | Tipo | Uso |
|---|---|---|
| `baseCurrencyCode` | `String` | `"USD"` |
| `quoteCurrencyCode` | `String` | `"ARS"` |
| `mid` | `Decimal` | Cotización CCL usada para convertir USD ⇄ ARS. |
| `date` | `DateTime` | Se toma el último registro disponible. |

### `Instrument`

Campos usados: `ticker`, `name`, `type` (`CEDEAR`, `STOCK_US`, `STOCK_AR`, etc.), `currencyCode`.

---

## 4. Server action: `getDividendsPageDataAction()`

Ubicación: `src/app/actions/dividends.ts`.

Pasos:

1. **Fetch transacciones de dividendos**
   ```ts
   prisma.transaction.findMany({
     where: { type: { in: ["DIVIDEND_CASH", "TAX_WITHHOLDING"] } },
     include: { instrument: true },
     orderBy: { tradeDate: "asc" },
   });
   ```

2. **Fetch transacciones BUY/SELL + eventos corporativos** para calcular holdings actuales.

3. **Fetch último `FxRate` USD/ARS** (campo `mid`). Si no hay, `cclRate = null`.

4. **Pipeline**:
   - `aggregateReceivedDividends(txns)` → `ReceivedDividend[]`
   - `buildHoldings(buySellTxns, corporateEvents)` → `Holding[]`
   - `forecastUpcomingDividends(holdings, horizonMonths=6)` → `UpcomingDividend[]` + `yahooErrors[]`
   - `buildDividendsPageData(received, upcoming, cclRate)` → `DividendsPageData`

5. **Return** al page component.

---

## 5. Cálculo de dividendos PAGADOS (received)

Archivo: `src/lib/dividends/aggregate.ts`.

### 5.1. Matcheo de retenciones a dividendos

```ts
// Extracción del ticker desde el campo `notes` de TAX_WITHHOLDING
function tickerFromTaxNotes(notes: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/-\s*([A-Z0-9.]+)\s*$/);  // ej: "Retención IIGG - AAPL"
  return match?.[1] ?? null;
}
```

Construye un mapa `taxByKey` con clave `${ticker}|${YYYY-MM-DD}|${currency}`:

```ts
for (const t of taxes) {
  const ticker = tickerFromTaxNotes(t.notes);
  if (!ticker) continue;                                  // ⚠️ se PIERDE silenciosamente
  const dateKey = t.tradeDate.toISOString().slice(0, 10);
  const currencyKey = asDividendCurrency(t.currencyCode);
  const key = `${ticker}|${dateKey}|${currencyKey}`;
  const amount = new Decimal(t.netAmount.toString()).abs();
  taxByKey.set(key, (taxByKey.get(key) ?? new Decimal(0)).plus(amount));
}
```

### 5.2. Cálculo de bruto/neto por dividendo

Para cada `DIVIDEND_CASH`:

```ts
const gross = new Decimal(d.netAmount.toString()).abs();   // ⚠️ netAmount = bruto
const key = `${d.instrument.ticker}|${dateKey}|${currencyKey}`;
const tax = taxByKey.get(key) ?? new Decimal(0);
const net = gross.minus(tax);

return {
  id: d.id,
  tradeDate: d.tradeDate.toISOString(),
  ticker: d.instrument.ticker,
  instrumentType: d.instrument.type,
  instrumentName: d.instrument.name,
  grossAmount: gross.toFixed(2),
  taxAmount: tax.toFixed(2),
  netAmount: net.toFixed(2),
  currencyCode: currencyKey,
};
```

**Fórmula base**:
```
gross = |Transaction.netAmount|  (DIVIDEND_CASH)
tax   = Σ |Transaction.netAmount|  donde notes matchea regex y (ticker, date, currency) coincide
net   = gross − tax
```

### 5.3. Riesgos

| Riesgo | Detalle |
|---|---|
| **Regex frágil** | Si `notes` no termina en `- TICKER` (espacios, guión, mayúsculas), la retención queda **huérfana** y el dividendo se reporta sin retención. No hay log ni warning. |
| **`netAmount` guarda el bruto** | El campo se llama `netAmount` pero almacena el bruto. Hay un campo `grossAmount` que **no se usa**. Riesgo de confusión a futuro. |
| **No usa `instrumentId` para matchear** | Matchea por **string del ticker** desde `notes`. Si el ticker cambia (rename), o hay homónimos, hay colisión. |
| **Match por fecha exacta** | Si DIVIDEND_CASH y TAX_WITHHOLDING están en días distintos (corrección manual, importación), no matchean. |
| **`DIVIDEND_STOCK` ignorado** | Los dividendos en acciones no entran en este pipeline. |

---

## 6. Cálculo de dividendos FUTUROS (forecast)

Archivo: `src/lib/dividends/forecast.ts`.

### 6.1. Holdings actuales

`buildHoldings()` aplica BUY/SELL + eventos corporativos (splits, mergers) y produce:

```ts
type Holding = {
  ticker: string;
  instrumentType: InstrumentType;
  quantity: Decimal;       // Cantidad actual, >0
  // ... más campos no usados acá
};
```

Si `quantity <= 0` → la posición se descarta para forecast.

### 6.2. Llamada a Yahoo Finance

```ts
const symbol = buildYahooSymbol(h.ticker, ARGENTINIAN_TYPES.has(h.instrumentType));
// Si es CEDEAR, STOCK_AR, BOND_AR, LETRA, ON → "AAPL.BA"
// Caso contrario → "AAPL"

const { dividends, currency } = await fetchYahooDividends(symbol);
// Devuelve hasta 5 años de historial: [{ timestamp, amount }, ...]
```

Si la llamada falla → `yahooErrors.push("${symbol}: ${error}")`. Se ignora el ticker, no rompe la página.

### 6.3. Cadencia (mediana de intervalos)

```ts
function averageIntervalDays(events: YahooDividendEvent[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!.timestamp;
    const curr = events[i]!.timestamp;
    const gap = (curr - prev) / (60 * 60 * 24);     // a días
    if (gap > 5 && gap < 540) gaps.push(gap);        // filtro outliers
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;          // mediana
}
```

**Decisión clave**: usa **mediana** (no promedio). Filtra gaps fuera de `[5, 540]` días para excluir mergers/splits/dividendos extraordinarios.

### 6.4. Proyección

```ts
const horizonMonths = 6;
const horizonMs = horizonMonths * 31 * MS_PER_DAY;   // ~186 días
const lastAmount = new Decimal(last.amount);          // último pago por acción
const qty = new Decimal(h.quantity);                  // holdings actuales
let nextTs = last.timestamp * 1000 + cadenceDays * MS_PER_DAY;

while (nextTs - now <= horizonMs) {
  projections.push({
    ticker: h.ticker.toUpperCase(),
    estimatedDate: new Date(nextTs).toISOString(),
    estimatedAmountPerShare: lastAmount.toFixed(4),
    quantity: qty.toFixed(4).replace(/\.?0+$/, ""),
    estimatedTotal: lastAmount.mul(qty).toFixed(2),   // FÓRMULA
    currencyCode: pickCurrency(currency),
    isEstimate: true,
  });
  nextTs += cadenceDays * MS_PER_DAY;
}
```

**Fórmula base**:
```
estimatedTotal = lastAmountPerShare × currentQuantity
estimatedDate(n) = lastPaymentDate + n × medianCadenceDays
horizonte = now + 6 meses
```

**Caso edge**: si solo hay 1 pago histórico (`cadenceDays = null`), se proyecta **una sola vez** 365 días después.

### 6.5. Supuestos / limitaciones del forecast

| Supuesto | Implicancia |
|---|---|
| Monto por acción = último pago histórico | No modela crecimiento de dividendo ni recortes. |
| Cadencia = mediana de últimos 5 años | Asume política de pago estable. |
| Quantity = holdings actuales (post-eventos) | Correcto si no hay cambios futuros, pero ignora compras/ventas planeadas. |
| Currency = la que devuelve Yahoo | Si Yahoo reporta `USD` pero el CEDEAR paga en ARS, hay mismatch. |
| Yahoo es la única fuente | Si Yahoo no tiene el ticker (instrumentos AR ilíquidos, bonos), no hay forecast. |
| `.BA` para activos AR | Asume que Yahoo siempre tiene el sufijo correcto; CEDEARs nuevos pueden no estar. |

---

## 7. Cálculo de KPIs

Archivo: `src/lib/dividends/build.ts`.

### 7.1. Conversión de monedas

```ts
function toArs(amount: string, currency: "ARS" | "USD", cclRate: number | null): Decimal {
  const value = new Decimal(amount);
  if (currency === "ARS") return value;
  if (!cclRate || cclRate <= 0) return new Decimal(0);    // ⚠️ silenciosamente 0
  return value.mul(cclRate);
}

function toUsd(amount: string, currency: "ARS" | "USD", cclRate: number | null): Decimal {
  const value = new Decimal(amount);
  if (currency === "USD") return value;
  if (!cclRate || cclRate <= 0) return new Decimal(0);
  return value.div(cclRate);
}
```

**Cuidado**: si `cclRate` es null, todos los valores cross-currency se convierten a **0** sin warning. La UI muestra un banner, pero los KPIs en USD son engañosos si se mira solo el número.

### 7.2. KPIs agregados

```ts
// Loop sobre received
for (const r of received) {
  const grossArs = toArs(r.grossAmount, r.currencyCode, cclRate);
  const taxArs   = toArs(r.taxAmount,   r.currencyCode, cclRate);
  const grossUsd = toUsd(r.grossAmount, r.currencyCode, cclRate);
  const taxUsd   = toUsd(r.taxAmount,   r.currencyCode, cclRate);

  totalGrossArs = totalGrossArs.plus(grossArs);
  totalTaxArs   = totalTaxArs.plus(taxArs);
  totalGrossUsd = totalGrossUsd.plus(grossUsd);
  totalTaxUsd   = totalTaxUsd.plus(taxUsd);
}

const totalNetArs = totalGrossArs.minus(totalTaxArs);
const totalNetUsd = totalGrossUsd.minus(totalTaxUsd);

const effectiveTaxRate = totalGrossArs.isZero()
  ? "0.00"
  : totalTaxArs.div(totalGrossArs).mul(100).toFixed(2);
```

### 7.3. YoY (year-over-year)

```ts
const nowYear = new Date().getUTCFullYear();
const year = new Date(r.tradeDate).getUTCFullYear();

if (year === nowYear)        ytdNetArs       = ytdNetArs.plus(netArs);
else if (year === nowYear-1) lastYearNetArs  = lastYearNetArs.plus(netArs);
```

**Asume calendario UTC**. Un dividendo cobrado el 31 de diciembre a las 23h de Buenos Aires queda contado en el año siguiente.

### 7.4. Próximos 30 días

```ts
const horizon30 = Date.now() + 30 * 24 * 60 * 60 * 1000;
for (const u of upcoming) {
  if (new Date(u.estimatedDate).getTime() <= horizon30) {
    next30ArsTotal = next30ArsTotal.plus(toArs(u.estimatedTotal, u.currencyCode, cclRate));
    next30UsdTotal = next30UsdTotal.plus(toUsd(u.estimatedTotal, u.currencyCode, cclRate));
  }
}
```

### 7.5. Top pagador

```ts
// byTicker ya está ordenado por netArs descendente
const topTicker = tickerRows[0]
  ? { ticker: tickerRows[0].ticker, netArs: tickerRows[0].netArs, netUsd: tickerRows[0].netUsd }
  : null;
```

### 7.6. Agregados secundarios

- **`byTicker[]`**: para cada ticker, suma `payments`, `grossArs`, `taxArs`, `netArs`, idem USD, y `currentQuantity` (del holding).
- **`byMonth[]`**: agrupa por `YYYY-MM` y suma. Sirve al bar chart.
- **`calendar[]`**: 12 entradas (6 meses atrás → 5 adelante) con arrays `received[]` y `upcoming[]` filtrados por mes.

---

## 8. Componentes UI y qué muestran

### 8.1. KPI Cards (`dividend-kpis.tsx`)

| Card | Dato | Fórmula |
|---|---|---|
| Total recibido neto | `totalNetArs` / `totalNetUsd` | `gross − tax` |
| Total bruto | `totalGrossArs` / `totalGrossUsd` | Σ gross |
| Retenciones (IIGG + BBPP) | `totalTaxArs` + `effectiveTaxRate` | Σ tax; `tax/gross×100` |
| Mayor pagador | `topTicker.ticker` + neto | Max `netArs` |
| YoY | `ytdNetArs` vs `lastYearNetArs` + delta % | `((ytd−ly)/ly)×100` |
| Próximos 30 días | `next30dEstimatedArs/Usd` | Σ upcoming ≤ 30 días |

### 8.2. Calendario (`dividend-calendar.tsx`)

- 12 meses (-6 a +5 desde hoy).
- Cada mes muestra `${received.length}p · ${upcoming.length}e`.
- Barra coloreada proporcional al total del mes vs el mes más grande.
- Verde = recibido (badge "Recibido").
- Violeta = estimado (badge "Estimado" con sparkle).

### 8.3. Tablas (`dividend-detail-table.tsx`)

1. **Por ticker** (sin search): Ticker | Pagos | Bruto | Retenciones | Neto | Cantidad actual.
2. **Historial** (con search): Fecha | Ticker | Moneda | Bruto | Retención | Neto.

### 8.4. Charts (`dividend-charts.tsx`)

- **Bar chart**: evolución mensual con 3 barras stacked (Bruto / Retención / Neto).
- **Pie chart**: distribución por ticker (top 8 + "Otros").

### 8.5. Toggle de moneda

- Tabs ARS / USD. Disabled si `cclRate == null`.
- Banner amarillo: "No hay cotización CCL cargada".
- Format: `toLocaleString("es-AR", { style: "currency", currency })` con 0 decimales ARS, 2 USD.

---

## 9. Edge cases — manejados vs no manejados

### ✅ Manejados

| Caso | Comportamiento |
|---|---|
| Posición vendida (`quantity = 0`) | Se descarta del forecast. |
| `cclRate` faltante | Todos los USD convertidos a 0; toggle disabled; banner. |
| Nunca cobró dividendos | Empty state: "Todavía no recibiste dividendos". |
| Yahoo falla por ticker | Se loguea en `yahooErrors[]`, no rompe la página. |
| Instrumento con 1 sola div histórica | Proyecta 1 vez a +365 días. |
| Cadencia outlier (> 540 días o < 5) | Se filtra del cálculo de mediana. |
| Conversión de moneda con `cclRate = 0` | Guarda: retorna `Decimal(0)`. |
| Dividendos sin instrumento | Se filtran por `r.instrument` en el server action. |

### ⚠️ NO manejados o frágiles

| Caso | Problema |
|---|---|
| **Regex de notes** | Si `notes` no termina exactamente en `- TICKER`, la retención se **pierde silenciosamente**. No hay validación. |
| **`DIVIDEND_STOCK`** | Nunca se consulta. Si hay dividendos en acciones, no aparecen. |
| **TAX_WITHHOLDING con fecha distinta a DIVIDEND_CASH** | No matchean. Se reporta dividendo con tax = 0. |
| **Multiple TAX_WITHHOLDING mismo día/ticker** | Se suman correctamente (no hay deduplicación). |
| **Yahoo API caída completa** | Sin forecast para todo el portfolio. No hay cache de fallback. |
| **Timezone UTC en todo** | Calendario y YoY usan `getUTC*`. Un evento a las 23h ART puede caer en el día siguiente. |
| **Currency mismatch Yahoo vs realidad** | Si Yahoo dice USD pero el CEDEAR paga ARS (caso real), la proyección queda mal moneda. |
| **Sin override manual** | El usuario no puede ajustar la proyección (ej. "ya sé que YPF anunció USD 0.50 el 15 de julio"). |
| **Sin export** | No hay CSV/PDF. |
| **Splits no documentados en dividendos** | `buildHoldings` ya aplica splits a la quantity actual, pero el forecast no muestra que el monto por acción debió ajustarse. |
| **Ticker rename** | Si un ticker cambió en el tiempo, el matcheo de retención por string del ticker rompe. |

---

## 10. Tipos y contratos

Definidos en `src/lib/dividends/types.ts`. No hay validación con Zod — solo tipos TS (compile-time).

```ts
type ReceivedDividend = {
  id: string;
  tradeDate: string;          // ISO
  ticker: string;
  instrumentType: InstrumentType | null;
  instrumentName: string | null;
  grossAmount: string;        // siempre positivo
  taxAmount: string;          // 0 si no matchea
  netAmount: string;          // gross − tax
  currencyCode: "ARS" | "USD";
};

type UpcomingDividend = {
  ticker: string;
  instrumentName: string | null;
  estimatedDate: string;
  estimatedAmountPerShare: string;
  quantity: string;
  estimatedTotal: string;     // amountPerShare × quantity
  currencyCode: "ARS" | "USD";
  isEstimate: true;
};

type DividendKpis = {
  totalGrossArs / totalTaxArs / totalNetArs: string;
  totalGrossUsd / totalTaxUsd / totalNetUsd: string;
  effectiveTaxRate: string;   // ej "28.47"
  topTicker: { ticker, netArs, netUsd } | null;
  totalPayments: number;
  ytdNetArs / ytdNetUsd: string;
  lastYearNetArs / lastYearNetUsd: string;
  next30dEstimatedArs / next30dEstimatedUsd: string;
};

type DividendsPageData = {
  kpis: DividendKpis;
  byTicker: DividendByTicker[];
  byMonth: DividendByMonth[];
  calendar: DividendMonth[];   // 12 meses
  received: ReceivedDividend[];
  upcoming: UpcomingDividend[];
  cclRate: string | null;
  yahooErrors: string[];
};
```

---

## 11. Puntos abiertos para el análisis

Cosas que conviene verificar antes de cerrar el veredicto:

1. **¿Cómo se crean las `TAX_WITHHOLDING` durante el import?** El regex `/-\s*([A-Z0-9.]+)\s*$/` asume un formato exacto. Si el importer no es consistente, los dividendos van a mostrar `tax = 0`. Hay que revisar `src/app/actions/transactions.ts` (modificado en el branch actual) y el flujo de import.

2. **¿Por qué `netAmount` guarda el bruto y `grossAmount` no se usa?** Probablemente legacy del schema original. Es una bomba para futuros mantenimientos.

3. **¿Por qué `DIVIDEND_STOCK` no entra al pipeline?** Definido en el enum pero ignorado. ¿Decisión de producto o pendiente?

4. **¿Hay fallback si Yahoo cae?** Hoy es un SPOF. ¿Caché en DB? ¿Reintentos?

5. **¿El matcheo por `(ticker, date, currency)` es robusto?** ¿Qué pasa si un broker registra la retención al día siguiente del dividendo? Conviene revisar data real.

6. **Timezones**: `getUTCFullYear` en todas las agregaciones. Si el usuario está en `America/Argentina/Buenos_Aires`, ¿los buckets del calendario se ven raros en los bordes del día/mes/año?

7. **¿Hay tests?** No vi nada en la exploración. Las fórmulas de cadencia y conversión USD/ARS son lugares donde un test unitario salva vidas.

8. **CCL único histórico**: se usa el **último** `FxRate` para convertir **todo** el histórico. Eso distorsiona dividendos viejos (ej. un dividendo USD de 2024 convertido al CCL actual de 2026). ¿Es intencional o conviene usar el FX de la fecha del pago?

---

## 12. Cierre

La feature está **arquitectónicamente limpia** (separación aggregate → forecast → build → render, uso correcto de `Decimal`, manejo de errores en Yahoo), pero tiene **dos riesgos de producción**:

1. **Parsing de retenciones por regex sobre `notes`** — frágil, sin validación, silencioso al fallar.
2. **Conversión USD/ARS con un único CCL spot** — distorsiona el histórico.

Y un **gap de producto**:

3. **Forecast 100% dependiente de Yahoo**, sin override manual ni caché.

El resto (UI, KPIs, calendario, charts) está sólido.
