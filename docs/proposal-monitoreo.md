# Proposal técnica — `/monitoreo`

Estado: propuesta. No implementar durante esta tarea.

## 0. Decisión ejecutiva

Implementar `/monitoreo` como una pantalla server-first con un componente cliente de gráfico.

- Fuente primaria de precios: OHLCV de APIs de mercado, normalizado y persistido en `PriceCache`.
- `PortfolioSnapshot` no es fuente de precios ni debe usarse para reconstruirlos. Sólo aporta contexto de tenencia/universo y diagnóstico de valuaciones ya guardadas.
- El universo base del selector es el catálogo activo BYMA sincronizado desde Data912 (`arg_stocks` y `arg_cedears`); la pertenencia al portfolio es un filtro, no una restricción del universo.
- El selector ofrece filtros de tipo (`Acción AR`/`CEDEAR`), pertenencia (`En mi portfolio`) y cobertura (`Con datos en DB`/`Sin datos en DB`).
- La primera carga consulta `PriceCache` y muestra lo que ya está persistido. El histórico completo se solicita bajo demanda mediante el botón `Cargar histórico`.
- Data912 es la fuente principal de catálogo, cotización local e histórico de CEDEAR/acciones argentinas; Yahoo/FMP quedan como proveedores alternativos o para subyacentes USD cuando esa vista se habilite.
- Precio ARS de CEDEAR: usar OHLCV real del CEDEAR local (`data912-eod` o `yahoo-eod`), nunca derivarlo desde subyacente + CCL como serie principal.
- Precio USD de CEDEAR: usar OHLCV del `underlyingAsset` en USD (`fmp-eod` o `yahoo-underlying-eod`), persistido con una fuente distinta.
- La línea usa `close`; las velas japonesas usan `open/high/low/close/volume` de la misma barra persistida.
- No mezclar proveedores, monedas ni políticas de ajuste silenciosamente. Cada serie debe exponer `provider`, `source` y `adjustmentPolicy`.
- Si falta una serie o una credencial de proveedor, no inventar puntos: devolver estado degradado y explicarlo en UI. El botón `Cargar histórico` debe distinguir `histórico no solicitado`, `histórico en carga`, `histórico disponible` y `sin cobertura`.
- Usar `lightweight-charts` v5.x, no reemplazar Recharts existente. Recharts queda para `/dashboard` y `/rendimientos`.
- Fase 1 no incluye alertas, workers de WhatsApp/Telegram ni generación de eventos.

## 1. Evidencia del proyecto relevado

### Stack y shell

- Next.js `16.2.6`, App Router, React 19, Tailwind v4, Prisma 6, `decimal.js`, Radix/shadcn, `recharts` 3.
- El proyecto no tiene `Navbar` horizontal: la navegación principal está en `src/components/layout/sidebar.tsx`.
- El layout autenticado es `src/app/(app)/layout.tsx`; ya aplica el shell y `main` con `p-6`.
- La UI está en español, formato `es-AR`, tema oscuro, cards `zinc`, acento teal/azul según pantalla.
- El estado del worktree ya contiene cambios no relacionados; preservarlos. No asumir que los documentos de `docs/` están sincronizados con todos los cambios actuales.

### Patrones de páginas

Patrón vigente:

```text
src/app/(app)/<ruta>/page.tsx
  -> auth / getCurrentUser
  -> resolver portfolio activo
  -> query Prisma/server action
  -> redirect('/login') si no autorizado
  -> <ComponentePage ... />
```

Ejemplos: `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/dividends/page.tsx`, `src/app/(app)/rendimientos/page.tsx`.

El portfolio activo actual se resuelve como:

```ts
where: { userId, archivedAt: null }
orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
take: 1
```

No implementar un portfolio selector nuevo en esta feature: `PortfolioSwitcher` sigue siendo stub/deshabilitado.

### Market data existente

- `src/lib/market/yahoo.ts`: cliente Yahoo Chart API; `buildYahooSymbol(ticker, isArgentinian)` agrega `.BA` a CEDEAR/STOCK_AR.
- `fetchYahooHistory()` devuelve barras diarias crudas (`open/high/low/close/volume`) y normaliza fechas a medianoche UTC.
- No usar `adjclose`: el sistema aplica eventos corporativos a cantidad/precio de trades mediante `src/lib/events/apply.ts`; ajustar ambos lados duplicaría el efecto.
- `src/lib/market/history-sync.ts`: backfill EOD en `PriceCache`, fuente actual `EOD_PRICE_SOURCE = "yahoo-eod"`; concurrencia limitada y revisión reciente.
- `src/app/api/cron/backfill-prices/route.ts`: actualmente backfillea instrumentos con operaciones BUY/SELL cuyo tipo esté en `PERFORMANCE_INSTRUMENT_TYPES`.
- `PERFORMANCE_INSTRUMENT_TYPES` actual: `CEDEAR`, `STOCK_AR`.
- `PriceCache` también se usa para `source = "yahoo"` intradía y `source = "data912"` para ON. No mezclar estas fuentes en la serie EOD.
- `FxRate` persiste CCL diario; `src/lib/market/ccl-rate.ts` resuelve el valor de hoy y `history-sync.ts` puede poblar histórico mediante `syncCclHistory()`.
- `src/lib/market/data912-universe.ts` ya integra `/live/arg_stocks`, `/live/arg_cedears` y `/live/arg_corp` para construir el universo BYMA; `src/lib/market/catalog-sync.ts` lo persiste en `Instrument`.
- `src/lib/market/data912.ts` sólo integra hoy `/live/arg_corp` para precios actuales de ON. Hay que extenderlo o separar un adaptador para `/live/arg_stocks` y `/live/arg_cedears`, cuyos campos de cotización son `symbol`, `c`, `v`, `px_bid`, `px_ask` y `pct_change`.
- El histórico `/historical/cedears/{ticker}` y `/historical/stocks/{ticker}` requiere un adaptador separado y normaliza `date`, `o`, `h`, `l`, `c`, `v`.
- En Data912, `v` es volumen nocional según su contrato; no debe compararse ni etiquetarse como cantidad de acciones sin una conversión explícita.
- FMP no tiene cliente en el repositorio. Su endpoint estable `/historical-price-eod/full` devuelve OHLCV para el símbolo solicitado y requiere `FINANCIALMODELINGPREP_APIKEY`; `non-split-adjusted` es la variante a evaluar para mantener precios crudos.
- Data912 documenta límite de 120 requests/minuto y advierte que sus datos no son necesariamente tiempo real. Debe tratarse como proveedor con cobertura y calidad explícitas, no como fallback invisible.

### Gráficos existentes

- `/dashboard` y `/rendimientos` usan Recharts 3.
- Los componentes de gráficos existentes son cliente (`"use client"`), envuelven el chart en `ChartCard`, usan empty states y tooltips propios.
- `lightweight-charts` no aparece en `package.json` ni en `pnpm-lock.yaml`; es dependencia nueva.
- La versión actual de TradingView documentada durante el relevamiento es 5.2. La API v5 importa series explícitamente y usa `chart.addSeries(LineSeries, options)`.
- `lightweight-charts` soporta `CandlestickSeries` con `{ time, open, high, low, close }`; el chart puede alternar línea y velas sin cambiar la fuente de datos.
- `lightweight-charts` no trae tooltip HTML de alto nivel: debe implementarse escuchando `chart.subscribeCrosshairMove` y renderizando un overlay propio.

## 2. Modelo y disponibilidad de datos

### 2.1 `Instrument`

Campos relevantes:

```prisma
id                String
ticker            String
name              String
type              InstrumentType
currencyCode      String
underlyingAssetId String?
conversionRatio   Decimal?
active            Boolean
```

La identidad real es compuesta (`ticker`, `type`, `venueCode`, `currencyCode`). El selector y todas las queries deben usar `instrumentId`, no ticker como clave única.

Para CEDEAR:

- `Instrument.ticker` es el ticker operado en BYMA, por ejemplo `AAPL`.
- `Instrument.currencyCode` es `ARS`.
- `underlyingAsset.ticker` es el símbolo US, por ejemplo `AAPL`.
- `conversionRatio` representa cuántos CEDEARs equivalen a una acción subyacente; confirmar/validar datos reales antes de mostrar una conversión teórica.

El seed deja `conversionRatio = 10` como placeholder; no tratarlo como dato canónico de producción.

### 2.2 `PriceCache`

```prisma
model PriceCache {
  id           String
  instrumentId String
  datetime     DateTime
  open         Decimal?
  high         Decimal?
  low          Decimal?
  close        Decimal
  volume       Decimal?
  source       String
  @@unique([instrumentId, datetime, source])
  @@index([instrumentId, datetime])
}
```

El modelo real ya tiene OHLCV. La UI no calcula un precio unitario a partir de snapshots: lee las barras de mercado y usa `close` para línea u OHLC para velas.

Semántica propuesta de fuentes:

| Serie | Proveedor/endpoint | `instrumentId` | `source` | Moneda | Política |
|---|---|---|---|---|---|
| Acción/CEDEAR local | Data912 histórico (`stocks`/`cedears`) o Yahoo Chart `.BA` | instrumento local | `data912-eod` / `yahoo-eod` | ARS | Precio nativo crudo |
| CEDEAR subyacente | FMP `historical-price-eod/non-split-adjusted` o Yahoo Chart sin `.BA` | instrumento CEDEAR | `fmp-eod` / `yahoo-underlying-eod` | USD | Precio nativo crudo |
| Acción US/ETF | FMP o Yahoo Chart | instrumento US | `fmp-eod` / `yahoo-eod` | USD | Precio nativo crudo |
| ON | Data912 histórico si el endpoint cubre el instrumento | instrumento ON | `data912-eod` | ARS por 100 VN | Semántica de VN explícita; no mezclar con acciones |

La prioridad de proveedor debe ser una decisión del servidor, no un `source` aceptado desde el cliente. Si el proveedor primario falla, se puede usar un fallback sólo si la serie resultante mantiene la misma moneda, granularidad y política de ajuste; el DTO debe informar el proveedor efectivo.

Razón para persistir la serie subyacente bajo el mismo `instrumentId`: evita migrar el schema y evita crear instrumentos de mercado que no son posiciones del usuario. La capa de dominio debe transportar `seriesKind`/`source` explícitamente para que no se confunda con el ticker BYMA.

No cambiar el modelo `PriceCache` en Fase 1. Centralizar las fuentes en constantes o un registro tipado de dominio (`MarketSource`) y mantener la unicidad existente por `(instrumentId, datetime, source)`. Si una fuente devuelve un precio por 100 VN, esa unidad debe quedar en metadata de la serie y nunca inferirse en el chart.

### 2.3 `PortfolioSnapshot`

```prisma
model PortfolioSnapshot {
  portfolioId    String
  date           DateTime
  totalValueArs  Decimal
  totalValueUsd  Decimal
  positions      Json
  @@unique([portfolioId, date])
}
```

El cron `src/app/api/cron/snapshots/route.ts` hace upsert diario por portfolio y guarda `perf.positions`. La forma actual de cada posición, producida en `src/lib/calculations/performance.ts`, es aproximadamente:

```ts
{
  instrumentId,
  ticker,
  instrumentName,
  instrumentType,
  quantity,
  costBasisArs,
  marketValueArs,
  pnlArs,
  pnlPercent
}
```

Limitaciones:

1. No hay `unitPrice` explícito.
2. No hay moneda de la serie.
3. No hay símbolo subyacente.
4. Aunque `marketValueArs / quantity` puede producir un cociente ARS aproximado si la cantidad es positiva, no es un precio EOD de mercado ni sirve para la serie USD del subyacente.
5. El cron actual sólo guarda el snapshot del día cuando corre; no backfillea snapshots históricos.
6. La valuación se calcula con cotizaciones actuales (`refreshLatestQuotes`/Data912 live) y CCL actual; la fecha UTC del snapshot es la fecha de persistencia, no una garantía de cierre EOD de mercado.

Uso recomendado:

- Usarlo para marcar instrumentos que estuvieron en el histórico y complementar la pertenencia al portfolio.
- Usarlo como tarjeta de diagnóstico de la valuación guardada, no como precio de mercado.
- No derivar `unitPrice`, OHLC ni una serie completa desde `positions`.
- El acceso al catálogo de mercado es global para instrumentos BYMA activos; las transacciones y snapshots sólo determinan el filtro `En mi portfolio`.

### 2.4 Instrumentos del selector

Resolver en servidor, en una única operación lógica:

1. Leer el catálogo `Instrument` activo de BYMA para `STOCK_AR` y `CEDEAR`; el catálogo se mantiene mediante `data912-universe.ts` y `catalog-sync.ts`, no consultando Data912 desde el navegador.
2. Resolver el portfolio activo del usuario sólo para calcular `inPortfolio`.
3. Consultar transacciones BUY/SELL y snapshots del portfolio; parsear `positions` de forma defensiva y unificar IDs históricos.
4. Consultar cobertura de `PriceCache` dentro de la ventana de retención de dos años (`hasCachedData`, `oldestCachedDate`, `latestCachedDate`).
5. Enriquecer desde `Instrument` para obtener moneda, ratio, `underlyingAsset`, estado `active` y fuentes históricas disponibles.
6. Marcar `supported`, `inPortfolio`, `availableSources`, `cacheCoverage` y `unavailableReason`.
7. Aplicar los filtros `tipo`, `inPortfolio` y `cacheCoverage`, y ordenar por ticker/nombre.

No confiar en JSON sin validar. Definir un type guard para `positions` y descartar filas corruptas sin romper la pantalla.

## 3. Semántica de series y CEDEARs

Regla común: el precio mostrado siempre proviene de barras OHLCV de un proveedor de mercado y de `PriceCache`. `PortfolioSnapshot.positions` no participa en el cálculo del precio, del cierre ni de la vela.

### 3.1 Acción local / instrumento ARS

```text
bar = PriceCache(source = resolvedLocalSource, instrumentId = selectedInstrumentId)
linePoint = bar.close
candle = { bar.open, bar.high, bar.low, bar.close, bar.volume }
currency = ARS
```

`resolvedLocalSource` prioriza `data912-eod` para históricos de Data912 cuando el ticker está cubierto y usa `yahoo-eod` como alternativa. No convertir con CCL.

### 3.2 CEDEAR — modo USD por defecto

```text
symbol = instrument.underlyingAsset.ticker
bar = PriceCache(source = resolvedUnderlyingSource, instrumentId = cedearInstrumentId)
linePoint = bar.close
candle = { bar.open, bar.high, bar.low, bar.close, bar.volume }
currency = USD
```

`resolvedUnderlyingSource` prioriza FMP `historical-price-eod/non-split-adjusted` si existe `FINANCIALMODELINGPREP_APIKEY` y cobertura para el símbolo; usa Yahoo Chart sin `.BA` como alternativa. Si no existe esta fuente histórica, el servidor puede ejecutar backfill controlado o devolver estado `missing-underlying-history`; no hacer fetch arbitrario por cada movimiento del selector en producción sin persistir resultado.

### 3.3 CEDEAR — modo ARS

Fuente primaria: precio real del CEDEAR en BYMA, no una paridad calculada:

```text
bar = PriceCache(source = resolvedLocalSource, instrumentId = cedearInstrumentId)
linePoint = bar.close
candle = { bar.open, bar.high, bar.low, bar.close, bar.volume }
currency = ARS
```

El ratio y CCL se deben usar para:

- metadata de conversión y validación de paridad;
- diagnóstico teórico sólo si existe CCL histórico y ratio válido para cada fecha;
- nunca reemplazar silenciosamente una cotización local real.

Conversión teórica por fecha, bajo la convención `ratio = CEDEARs por acción US`:

```text
cedearArsTheoretical(date) = underlyingUsd(date) * cclUsdArs(date) / ratioAt(date)
```

`ratioAt(date)` debe contemplar eventos `CorporateEventType.CEDEAR_RATIO_CHANGE` efectivos antes de la fecha. Si solo existe el placeholder actual de `conversionRatio` y no hay histórico suficiente, la serie teórica queda `null`/no disponible.

La UI debe etiquetar claramente:

- `USD — subyacente`;
- `ARS — CEDEAR BYMA`;
- opcionalmente `ARS teórico` como diagnóstico, no como modo principal de Fase 1.

### 3.4 Política de ajuste y eventos corporativos

Las barras nativas se conservan crudas por proveedor. No aplicar `applyEventsToTrade` a `PriceCache` ni mezclar una serie ajustada por splits con cantidades ajustadas por eventos.

FMP ofrece una variante `non-split-adjusted`, que es la preferida para la serie nativa utilizada en valuación. Si se incorpora una serie ajustada para análisis de rendimiento, debe persistirse o calcularse como `seriesKind` separado y declarar `adjustmentPolicy = "split-adjusted"`; nunca sobrescribir la serie cruda. En una transformación OHLCV también deben ajustarse coherentemente open/high/low/close y, si corresponde, volume.

La serie teórica CEDEAR sólo aplica eventos al reconstruir `ratioAt(date)`; debe usar orden ascendente por `effectiveDate` y la misma regla de `src/lib/events/apply.ts`. Si no se puede reconstruir el ratio histórico con seguridad, la serie queda no disponible.

## 4. Contrato de datos propuesto

Crear `src/lib/monitoreo/types.ts` con DTOs serializables, sin exponer `Decimal` ni modelos Prisma:

```ts
type MonitoringCurrency = "ARS" | "USD";
type MonitoringRange = "1M" | "3M" | "6M" | "1Y" | "ALL";
type MonitoringSeriesKind = "native" | "cedear-underlying" | "cedear-theoretical";
type MonitoringChartType = "line" | "candles";
type MonitoringAdjustmentPolicy = "raw" | "split-adjusted";
type MonitoringCacheCoverage = "none" | "partial" | "two-years";
type MonitoringHistoryStatus = "cached" | "live-fallback" | "not-requested" | "loaded" | "unavailable";

type MonitoringInstrument = {
  id: string;
  ticker: string;
  name: string;
  type: InstrumentType;
  nativeCurrency: string;
  isCedear: boolean;
  underlyingTicker: string | null;
  inPortfolio: boolean;
  supported: boolean;
  availableSources: string[];
  unavailableReason: string | null;
  cacheCoverage: MonitoringCacheCoverage;
  oldestCachedDate: string | null;
  latestCachedDate: string | null;
};

type MonitoringBar = {
  time: string;       // YYYY-MM-DD de la rueda, tratado como BusinessDay
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

type MonitoringSeries = {
  instrumentId: string;
  ticker: string;
  label: string;
  currency: MonitoringCurrency;
  kind: MonitoringSeriesKind;
  chartType: MonitoringChartType;
  provider: "data912" | "yahoo" | "fmp" | "derived";
  source: string;
  adjustmentPolicy: MonitoringAdjustmentPolicy;
  historyStatus: MonitoringHistoryStatus;
  bars: MonitoringBar[];
  firstDate: string | null;
  lastDate: string | null;
  lastValue: number | null;
  changePct: number | null;
  dataQuality: {
    missingDays: number;
    stalePoints: number;
    missingCclDays: number;
    missingOhlcBars: number;
    warning: string | null;
  };
};

type MonitoringBootstrapData = {
  instruments: MonitoringInstrument[];
  selectedInstrumentId: string | null;
  initialSeries: MonitoringSeries | null;
};
```

La línea se construye en cliente como `bars.map(({ time, close }) => ({ time, value: close }))`; las velas usan directamente OHLC. `changePct` en tooltip debe calcularse contra el cierre anterior existente, no contra una fecha de calendario sin dato. Primer punto: `null`, no `0%`.

## 5. Arquitectura de componentes

```text
src/app/(app)/monitoreo/page.tsx                 Server Component
  -> getMonitoringBootstrapAction()
  -> <MonitoringPage initialData={...} />          Client Component
       -> MonitoringHeader
          -> AssetSelector + filters
          -> CurrencyModeToggle
          -> RangeSelector
       -> MonitoringChart
          -> lightweight-charts createChart()
          -> LineSeries / CandlestickSeries
          -> custom crosshair tooltip
          -> Cargar histórico (top-right action)
       -> MonitoringDataNotice / EmptyState
```

### Componentes

- `MonitoringPage`: estado de `instrumentId`, filtros de tipo/portfolio/cobertura, modo de moneda/serie, rango, tipo de gráfico y estado `historyStatus`; `useTransition` al cambiar selección; conserva skeleton durante refresh y no borra la última serie válida hasta recibir respuesta.
- `AssetSelector`: usar `src/components/ui/select.tsx` si la lista es pequeña; si el selector crece mucho, agregar un combobox Radix/shadcn específico. Mostrar `TICKER — Nombre`, mantener `instrumentId` como value y permitir combinar los filtros `Acción AR`/`CEDEAR`, `En mi portfolio` y `Con datos en DB`/`Sin datos en DB`.
- `CurrencyModeToggle`: para CEDEAR mostrar `USD subyacente` / `ARS CEDEAR`; para no-CEDEAR ocultar o deshabilitar el toggle y mostrar moneda nativa.
- `RangeSelector`: botones/toggle para `1M`, `3M`, `6M`, `1Y`, `ALL`. Mientras sólo hay cache, `ALL` significa todo el rango retenido en DB (máximo dos años); después de `Cargar histórico`, `ALL` incluye la respuesta histórica externa. Resolver fechas en servidor a partir de `todayUtc`, no usar horario local para cortar barras.
- `MonitoringChart`: único lugar donde se importa `lightweight-charts`. Debe ser `"use client"`; crear chart dentro de `useEffect` sobre un `ref` DOM. Alternar `LineSeries` y `CandlestickSeries` a partir del mismo `bars` DTO. Mostrar `Cargar histórico` arriba a la derecha cuando la vista sea cacheada.
- `MonitoringDataNotice`: reutilizar patrón de banners de degradación; distinguir cache vacío, cache parcial, histórico no solicitado, histórico en carga, histórico disponible, CCL faltante y fuente stale.

### Configuración de `lightweight-charts`

Instalación propuesta:

```bash
pnpm add lightweight-charts
```

API v5:

```ts
import { CandlestickSeries, createChart, LineSeries } from "lightweight-charts";

const chart = createChart(container, options);
const series = chart.addSeries(LineSeries, seriesOptions);
series.setData(bars.map(({ time, close }) => ({ time, value: close })));
const candles = chart.addSeries(CandlestickSeries, candleOptions);
candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
```

Requisitos de integración:

- Usar `YYYY-MM-DD` como `BusinessDay` para preservar la fecha de rueda sin desplazamientos por timezone; no convertir a timestamp salvo necesidad concreta.
- `useEffect` cleanup: `chart.remove()` y desconectar `ResizeObserver`.
- Redimensionar con `ResizeObserver`; no usar tamaño fijo.
- Fondo transparente/zinc para el dark theme; líneas teal/blue; escala de precios con locale AR.
- No interpolar feriados ni huecos. Una línea conecta ruedas existentes; mostrar aviso si la cobertura es parcial.
- No usar `dangerouslySetInnerHTML` para tooltip; construir nodos/React overlay seguro.
- Tooltip: `subscribeCrosshairMove`, obtener el dato con `param.seriesData.get(series)`, mostrar fecha de rueda UTC presentada en `es-AR`, precio y variación respecto al cierre anterior. Para velas, mostrar OHLC y volumen. `lightweight-charts` no lo resuelve automáticamente.

## 6. Capa servidor y queries

### Archivos propuestos

`src/app/actions/monitoreo.ts` (`"use server"`):

- `getMonitoringBootstrapAction()`:
  - autentica;
  - carga el catálogo activo BYMA (`STOCK_AR`/`CEDEAR`) y marca `inPortfolio` con el portfolio activo si existe;
  - devuelve selector + primer instrumento recomendado + las barras cacheadas disponibles;
  - retorna `{ error: "unauthorized" }` para seguir el patrón existente.
- `getMonitoringSeriesAction(input)`:
  - autentica y valida Zod (`instrumentId`, `currency`, `range`, `chartType`, `kind`);
  - verifica que el `instrumentId` pertenece al catálogo BYMA activo permitido;
  - consulta primero las barras cacheadas dentro de la ventana de dos años;
  - si no hay barras recientes, obtiene una cotización externa de Data912, la persiste como `data912-live` y devuelve un estado de cobertura limitada;
  - resuelve el proveedor y `source` en servidor; el cliente no puede elegir un source arbitrario;
  - devuelve DTO serializable.
- `loadMonitoringHistoryAction(input)`:
  - autentica y valida el `instrumentId`/modo de serie;
  - siempre consulta el endpoint histórico externo correspondiente cuando el usuario pulsa `Cargar histórico`;
  - mezcla la respuesta histórica con las barras cacheadas para mostrar la historia completa;
  - persiste sólo barras faltantes o revisadas dentro de los últimos dos años;
  - devuelve la serie completa en memoria, aunque las barras anteriores a la ventana de retención no se guarden.

`src/lib/monitoreo/data.ts`:

- `listMonitoringInstruments(userId)`;
- `resolveMonitoringSource(instrument, seriesKind)`;
- `loadCachedMonitoringBars(instrumentId, source, from = today - 2y, to = today)`;
- `loadExternalLatestQuote(instrument)`;
- `loadExternalMonitoringHistory(instrument, seriesKind)`;
- `persistMissingRecentBars(instrumentId, source, bars, retentionFrom)`;
- `pruneMonitoringCache(source, retentionFrom)`;
- `loadCclSeries(from, to)`;
- `loadCorporateRatioEvents(instrumentId, from, to)`;
- parseo defensivo de `PortfolioSnapshot.positions`;
- conversión Decimal → number/string en el límite de servidor.

`src/lib/monitoreo/series.ts`:

- funciones puras para dedupe por día, ordenar, rango, cambio porcentual, conversión teórica y data quality;
- validar OHLC (`low <= open/close <= high`) y marcar barras con OHLC incompleto sin inventar valores;
- usar `decimal.js` durante conversiones monetarias si la precisión importa; convertir a `number` solo al construir DTO para chart.

### Query de precio

```ts
await prisma.priceCache.findMany({
  where: {
    instrumentId,
    datetime: { gte: from, lte: to },
    source,
  },
  orderBy: { datetime: "asc" },
  select: {
    datetime: true,
    open: true,
    high: true,
    low: true,
    close: true,
    volume: true,
    source: true,
  },
});
```

No usar `distinct` sin ordenar correctamente. La unicidad de la tabla ya es `(instrumentId, datetime, source)`.

### Seguridad

- No aceptar `portfolioId` desde cliente; derivarlo del usuario autenticado sólo para marcar pertenencia.
- El catálogo de mercado es global de forma intencional, pero sólo se exponen instrumentos `active = true`, `venueCode = BYMA` y tipos soportados.
- `instrumentId` debe comprobarse contra el catálogo activo; los datos de portfolio nunca se usan para autorizar el precio global.
- No aceptar `source`, símbolo externo ni `provider` desde cliente; derivarlos del instrumento y del modo solicitado.
- Las acciones de consulta pueden persistir una cotización externa o barras faltantes como cache; el render inicial no ejecuta escrituras directamente.

## 7. Cache, consulta externa e histórico bajo demanda

La pantalla no debe esperar un backfill completo para mostrar algo. El flujo de datos es deliberadamente híbrido:

1. `data912-universe.ts` mantiene el catálogo de acciones AR y CEDEAR mediante `/live/arg_stocks` y `/live/arg_cedears`; `catalog-sync.ts` lo materializa en `Instrument`.
2. Al seleccionar un instrumento, consultar primero `PriceCache` para la ventana retenida de dos años y la fuente local EOD correspondiente (`data912-eod` o fallback `yahoo-eod`).
3. Si hay barras cacheadas, renderizar inmediatamente el gráfico y mostrar su cobertura (`oldestCachedDate`/`latestCachedDate`).
4. Si no hay barras recientes, consultar el endpoint live de Data912 (`arg_stocks` o `arg_cedears`), persistir la cotización como `data912-live` con timestamp bucketed y mostrar una vista limitada mientras se informa que falta histórico.
5. Mostrar en la esquina superior derecha del gráfico el botón `Cargar histórico` cuando la serie no fue cargada desde el endpoint histórico externo.
6. Al pulsar el botón, consultar siempre `/historical/stocks/{ticker}` o `/historical/cedears/{ticker}` según el tipo del instrumento. Para subyacentes USD, usar el proveedor configurado sólo cuando el modo USD esté habilitado.
7. Antes de persistir la respuesta externa, buscar por `(instrumentId, datetime, source)` las barras existentes. Insertar sólo faltantes y revisar/reemplazar las fechas recientes según la política del proveedor.
8. Persistir como máximo los últimos dos años para las fuentes históricas propias del monitoreo (`data912-eod`, `fmp-eod` y `yahoo-underlying-eod`), pero devolver al cliente la respuesta histórica completa para la sesión actual. `data912-live` sólo sirve como cotización de emergencia/cache corto y no se conserva como histórico de dos años.
9. No aplicar una poda global e indiscriminada sobre `PriceCache`: `yahoo-eod` existente también alimenta `/rendimientos` y puede necesitar historia anterior. La retención de dos años debe limitarse a sources de monitoreo o requerir una decisión separada.
10. Registrar cobertura, proveedor, fecha de última sincronización, errores y si el histórico fue solicitado; no ocultar un cache vacío con un snapshot.
11. Mantener las barras nativas crudas; no aplicar eventos corporativos a `PriceCache` ni usar CCL para reemplazar el precio local del CEDEAR.
12. No agregar cron de alertas ni workers en esta fase.

El resultado es:

```text
selector desde Instrument/catalog-sync
        ↓
PriceCache últimos 2 años
        ↓ si existe
gráfico inmediato + botón "Cargar histórico"
        ↓ si no existe cache
Data912 live → data912-live → gráfico limitado
        ↓ acción explícita del usuario
Data912 historical → merge en memoria + persistencia faltante de 2 años
```

`ALL` significa todo lo retenido en `PriceCache` antes de cargar histórico y toda la respuesta histórica externa después de pulsar el botón.

## 8. Archivos a crear/modificar

### Crear

- `src/app/(app)/monitoreo/page.tsx`
- `src/app/actions/monitoreo.ts`
- `src/lib/monitoreo/types.ts`
- `src/lib/monitoreo/data.ts`
- `src/lib/monitoreo/series.ts`
- `src/lib/monitoreo/series.test.ts`
- `src/lib/market/data912-live.ts`: lectura normalizada de `/live/arg_stocks` y `/live/arg_cedears` para fallback de cotización actual.
- `src/lib/market/data912-history.ts`: adaptador Data912 histórico y normalización `o/h/l/c/v`.
- `src/lib/market/fmp.ts`: cliente server-only opcional para FMP EOD, con API key y límites explícitos.
- `src/lib/market/provider-routing.ts`: resolución de proveedor, símbolo externo, moneda y política de ajuste.
- `src/components/monitoreo/monitoreo-page.tsx`
- `src/components/monitoreo/asset-selector.tsx`
- `src/components/monitoreo/monitoring-chart.tsx`
- `src/components/monitoreo/monitoring-controls.tsx` (solo si los controles no caben dentro de la página)
- `src/components/monitoreo/format.ts` (reutilizar o delegar a formatter tolerante a null)

### Modificar

- `src/components/layout/sidebar.tsx`: agregar `{ href: "/monitoreo", label: "Monitoreo", icon: ... }`; usar icono `ChartLine`/`Activity`; preservar estado activo existente.
- `package.json`: agregar `lightweight-charts`.
- `pnpm-lock.yaml`: regenerado por pnpm.
- `src/lib/market/history-sync.ts`: aceptar símbolo, proveedor, serie y source; persistir OHLCV.
- `src/lib/market/data912.ts`: conservar el cliente live de ON y compartir utilidades de fetch/normalización si corresponde.
- `src/lib/market/catalog-sync.ts`: sólo si hace falta exponer cobertura o estado de sincronización del catálogo; no volver a consultar Data912 desde la página.
- `src/lib/market/yahoo.ts`: exponer helpers genéricos sólo si hace falta; no duplicar parseo.
- `src/lib/events/*`: solo si se implementa conversión teórica con ratio histórico; no tocar para la serie nativa.

### No modificar salvo decisión explícita

- `prisma/schema.prisma`: no es necesario para el diseño recomendado.
- `PortfolioSnapshot`: no agregar `unitPrice` en Fase 1; sería un cambio de persistencia que no resuelve por sí solo el subyacente USD.
- Recharts existentes: no migrar ni reemplazar.
- Sistema de alertas/background workers: fuera de alcance.

## 9. Plan de implementación paso a paso

1. Instalar `lightweight-charts` y confirmar imports v5 (`createChart`, `LineSeries`, `CandlestickSeries`); no usar API v4 `addLineSeries`.
2. Implementar `MarketBar`, `MarketSource`, estados de cache/histórico y el registro de ruteo de proveedores.
3. Reutilizar `data912-universe.ts`/`catalog-sync.ts` para el catálogo global de acciones AR y CEDEAR.
4. Implementar adaptadores y fixtures de Data912 live e histórico; validar normalización de `symbol/c`, `date/o/h/l/c/v`, rate limit y respuestas vacías.
5. Generalizar la persistencia para insertar sólo barras faltantes dentro de la retención de dos años, sin sobrescribir otro `source`.
6. Implementar tipos y funciones puras de `src/lib/monitoreo/series.ts`; tests de orden, dedupe, rango, primer cambio `null`, huecos, OHLC incompleto, cache parcial, merge histórico y ratio teórico.
7. Implementar queries server-only para catálogo, pertenencia al portfolio, cobertura de `PriceCache` y barras cacheadas.
8. Implementar `getMonitoringSeriesAction` con lectura inicial de DB y fallback live cuando no hay cache.
9. Implementar `loadMonitoringHistoryAction` para que `Cargar histórico` consulte siempre la API externa, mezcle la respuesta completa en memoria y persista sólo los últimos dos años faltantes.
10. Crear la ruta `/monitoreo` con redirect a login y empty state sólo si no existe catálogo activo; la ausencia de portfolio no bloquea el selector global.
11. Crear `MonitoringPage` cliente con filtros de tipo, portfolio y cobertura, toggle CEDEAR, rango, línea/velas y botón `Cargar histórico`.
12. Crear `MonitoringChart` con lifecycle, resize, crosshair y tooltip; verificar que no haya acceso a `window/document` durante SSR.
13. Registrar navegación en Sidebar y metadata de página (`Monitoreo`), sin duplicar padding del layout.
14. Agregar estados: cache vacío, cotización live limitada, histórico no solicitado, histórico en carga, histórico disponible, proveedor sin cobertura, OHLC incompleto, CCL faltante, serie teórica no confiable y error de acción.
15. Ejecutar tests, lint/build y pruebas manuales con acción AR/CEDEAR dentro y fuera del portfolio, cache completo/parcial/vacío, botón histórico, vela con OHLC incompleto y respuesta externa vacía.
16. Revisar que ningún cambio de la feature haya sobreescrito las modificaciones preexistentes del worktree.

## 10. Criterios de aceptación

- `/monitoreo` aparece en Sidebar y queda activo para `/monitoreo`.
- Usuario no autenticado es redirigido a `/login`.
- Selector muestra el catálogo activo BYMA y usa `instrumentId` como identidad; la pertenencia al portfolio es un filtro visual, no una restricción del catálogo.
- Los filtros funcionan para tipo (`Acción AR`/`CEDEAR`), pertenencia (`En mi portfolio`) y cobertura (`Con datos en DB`/`Sin datos en DB`).
- La selección consulta primero `PriceCache` dentro de los últimos dos años y muestra inmediatamente las barras disponibles.
- Si no existe cache reciente, consulta Data912 live, persiste `data912-live` y muestra una vista limitada con aviso.
- La selección de una acción local muestra OHLCV EOD ARS proveniente de Data912 o Yahoo, con proveedor/source visibles en metadata.
- CEDEAR permite cambiar a ARS local cuando existe `data912-eod` o `yahoo-eod`.
- El botón `Cargar histórico` consulta siempre el endpoint histórico externo, muestra la historia completa devuelta y persiste sólo los últimos dos años faltantes.
- El usuario puede alternar línea y velas sin cambiar la fuente de datos; la línea usa `close` y las velas usan OHLCV persistido.
- Tooltip muestra fecha de rueda UTC presentada en `es-AR`, precio, OHLC cuando corresponde y variación porcentual contra el cierre anterior.
- No se muestra `0` para un dato inexistente; se usa `—` y aviso de calidad.
- CCL histórico se usa por fecha, nunca el CCL de hoy para toda la curva.
- Un ratio inválido/placeholder no produce una conversión teórica silenciosamente falsa.
- Nunca se calcula un precio desde `PortfolioSnapshot.positions` ni desde `marketValueArs / quantity`.
- La poda de dos años no elimina globalmente históricos que todavía consume `/rendimientos` mediante `yahoo-eod`.
- Si FMP no tiene API key o cobertura, se muestra estado degradado o se usa Yahoo según el ruteo definido; nunca se inventa una barra.
- La gráfica se desmonta/redimensiona sin memory leaks ni errores de hidratación.
- `lightweight-charts` no rompe `/dashboard` ni `/rendimientos`.
- No hay implementación de alertas/background workers en el diff de Fase 1.

## 11. Riesgos y decisiones pendientes

| Riesgo | Impacto | Mitigación |
|---|---|---|
| `PortfolioSnapshot` no representa cierres EOD confiables | Precio histórico falso | No usarlo como fuente; usar sólo `PriceCache` alimentado por market data |
| `conversionRatio` seed es placeholder | CEDEAR teórico incorrecto | No usar ratio teórico como serie principal; validar dato y eventos |
| CCL histórico ausente | USD↔ARS histórico no comparable | Poblar `FxRate` antes; marcar días faltantes |
| Yahoo reescribe por splits/ratios | Picos falsos o doble ajuste | `source` EOD, rewrite-all ante split, no aplicar evento a precio crudo |
| Data912 histórico es cacheado/educativo y tiene rate limit | Barras incompletas o proveedor inestable | Rate limit, fixtures, cobertura explícita y fallback controlado a Yahoo |
| Data912 live sólo entrega una cotización actual, no OHLC histórico | Cache vacío no puede dibujar una serie completa | Mostrar cotización limitada y ofrecer `Cargar histórico` |
| Selector global incluye tickers fuera del portfolio | Puede crecer mucho y mezclar activos sin histórico | Filtros de tipo/portfolio/cobertura y catálogo BYMA activo |
| Retención de dos años aplicada al source equivocado | `/rendimientos` pierde histórico | Retener sólo sources de monitoreo; no podar globalmente `yahoo-eod` |
| FMP requiere API key y su cobertura puede variar por exchange | Subyacente sin datos o error de producción | API key server-only, health check de símbolo y fallback a Yahoo |
| FMP puede ofrecer series ajustadas por split | Doble ajuste contra eventos del portfolio | Preferir `non-split-adjusted`; declarar `adjustmentPolicy` y no mezclar series |
| OHLC incompleto en algún proveedor | Vela inválida | Validar barra, no inventar open/high/low; degradar a línea sólo si se decide explícitamente |
| `PriceCache.source` es String | Errores por source mal escrito | Constantes y tipos de dominio; tests de source |
| ON/data912 no tiene histórico EOD compatible | Ticker aparece sin serie | Excluir o mostrar empty state explícito en Fase 1 |
| `STOCK_US`/ETF están excluidos del motor actual | Selector engañoso | Incluir solo si existe backfill USD y contrato específico |
| `lightweight-charts` es client-only | SSR/hydration failure | Import en componente cliente, creación dentro de `useEffect`, cleanup |
| Multi-portfolio está incompleto en shell | Cambios de portfolio no reflejados | Reusar resolución actual; no inventar switcher en esta feature |

## 12. Referencias de implementación

- `src/app/(app)/layout.tsx`
- `src/components/layout/sidebar.tsx`
- `src/app/(app)/rendimientos/page.tsx`
- `src/lib/rendimientos/series.ts`
- `src/lib/rendimientos/price-series.ts`
- `src/lib/market/yahoo.ts`
- `src/lib/market/data912.ts`
- `src/lib/market/data912-live.ts`
- `src/lib/market/data912-history.ts`
- `src/lib/market/data912-universe.ts`
- `src/lib/market/catalog-sync.ts`
- `src/lib/market/history-sync.ts`
- `src/lib/market/ccl-rate.ts`
- `src/app/api/cron/snapshots/route.ts`
- `src/app/api/cron/backfill-prices/route.ts`
- `src/lib/calculations/performance.ts`
- `src/lib/events/apply.ts`
- `prisma/schema.prisma`
- [Data912 OpenAPI](https://data912.com/openapi.json)
- [FMP Historical Price EOD Full](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-full)
- [FMP Non-Split-Adjusted](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-non-split-adjusted)
- [FMP Quickstart y autenticación](https://site.financialmodelingprep.com/developer/docs/quickstart)
- [TradingView Lightweight Charts — createChart](https://tradingview.github.io/lightweight-charts/docs/api/functions/createChart)
- [TradingView Lightweight Charts — series de velas](https://tradingview.github.io/lightweight-charts/docs/series-types)
- [TradingView Lightweight Charts — v4→v5 migration](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5)
- [TradingView Lightweight Charts — custom tooltips](https://tradingview.github.io/lightweight-charts/tutorials/how_to/tooltips)
