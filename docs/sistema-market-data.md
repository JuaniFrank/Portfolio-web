# Sistema de market data

> **Documento autocontenido.** Todo lo necesario para trabajar en precios, cotizaciones,
> catálogo de instrumentos y logos está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (fetch con `next: { revalidate, tags }`) · Prisma · decimal.js.
- **Es una capa transversal:** no tiene pantalla propia. La consumen transacciones, dashboard,
  dividendos y bonos.
- **Regla de oro:** ninguna caída de proveedor externo puede romper una página. Siempre hay
  fallback a caché, flag `stale`, o campo en `null` que la UI renderiza como `—`.

### Qué hace este sistema

Cuatro cosas distintas que conviven en `src/lib/market/`:

1. **Precios** de acciones/CEDEARs (Yahoo) y de ONs (data912), con caché en DB.
2. **Cotización del dólar CCL** (dolarapi), con persistencia diaria en `FxRate`.
3. **Catálogo de instrumentos**: sincronizar el universo BYMA contra nuestra tabla `Instrument`.
4. **Logos** de tickers, con cadena de fallback entre CDNs.

---

## Archivos

| Archivo | Rol | Líneas |
|---|---|---|
| `src/lib/market/yahoo.ts` | Cliente Yahoo Finance chart API (quotes + dividendos) | 114 |
| `src/lib/market/quotes.ts` | Orquestador de precios de acciones/CEDEARs con `PriceCache` | 99 |
| `src/lib/market/data912.ts` | Precios de ONs desde data912 con `PriceCache` | 189 |
| `src/lib/market/dolarapi.ts` | Cliente dolarapi (CCL) | 54 |
| `src/lib/market/ccl-rate.ts` | Resolver del CCL con persistencia en `FxRate` | 79 |
| `src/lib/market/data912-universe.ts` | Lectura del universo de símbolos BYMA | 96 |
| `src/lib/market/catalog-sync.ts` | Reconciliación del catálogo de instrumentos | 135 |
| `src/lib/market/instrument-names.ts` | Mapa curado ticker → nombre | 54 |
| `src/lib/market/logos.ts` | Cadena de URLs de logos | 49 |
| `src/lib/market/bcra.ts` | **Stub** (`export const TODO = true`) | 2 |
| `src/lib/market/byma.ts` | **Stub** (`export const TODO = true`) | 2 |
| `src/app/api/cron/sync-catalog/route.ts` | Endpoint del cron de Vercel | 20 |
| `src/components/transactions/ticker-avatar.tsx` | Componente que consume `logoCandidates` | 87 |
| `vercel.json` | Declaración del cron | — |

### Modelos de datos usados

```prisma
model PriceCache {
  id           String     @id @default(cuid())
  instrumentId String
  instrument   Instrument @relation(fields: [instrumentId], references: [id], onDelete: Cascade)
  datetime     DateTime
  open   Decimal? @db.Decimal(20, 8)
  high   Decimal? @db.Decimal(20, 8)
  low    Decimal? @db.Decimal(20, 8)
  close  Decimal  @db.Decimal(20, 8)
  volume Decimal? @db.Decimal(20, 8)
  source String                        // "yahoo" | "data912"

  @@unique([instrumentId, datetime, source])
  @@index([instrumentId, datetime])
}

model FxRate {
  id                String   @id @default(cuid())
  date              DateTime
  baseCurrencyCode  String   // "USD"
  quoteCurrencyCode String   // "ARS"  → 1 USD = mid ARS
  source            FxSource // CCL | MEP | OFICIAL | BLUE | MAYORISTA | CRYPTO | BROKER
  buy  Decimal? @db.Decimal(20, 8)
  sell Decimal? @db.Decimal(20, 8)
  mid  Decimal  @db.Decimal(20, 8)

  @@unique([date, baseCurrencyCode, quoteCurrencyCode, source])
  @@index([baseCurrencyCode, quoteCurrencyCode, date])
}

model Instrument {
  id           String         @id @default(cuid())
  ticker       String
  name         String
  type         InstrumentType
  venueCode    String?
  currencyCode String
  taxJurisdiction String?
  active       Boolean        @default(true)
  // …
  @@unique([ticker, type, venueCode, currencyCode])
}
```

---

## 1. Precios de acciones y CEDEARs (Yahoo)

### `src/lib/market/yahoo.ts` — el cliente crudo

Base URL: `https://query1.finance.yahoo.com/v8/finance/chart`.
Headers: `User-Agent: Mozilla/5.0 (compatible; portafolio-web/0.1)` + `Accept: application/json`.

```ts
export function buildYahooSymbol(ticker: string, isArgentinian: boolean): string {
  const cleaned = ticker.trim().toUpperCase();
  if (!cleaned) return cleaned;
  if (cleaned.includes(".")) return cleaned;   // ya tiene sufijo
  return isArgentinian ? `${cleaned}.BA` : cleaned;
}
```

Yahoo lista los CEDEARs argentinos con sufijo `.BA` (`AAPL.BA`, `GGAL.BA`).

**Dos funciones:**

| Función | Endpoint | Revalidate | Devuelve |
|---|---|---|---|
| `fetchYahooQuote(symbol)` | `?range=1d&interval=1d` | 5 min | `{ symbol, price, currency, previousClose, asOf }` |
| `fetchYahooDividends(symbol)` | `?range=5y&interval=1mo&events=div` | 12 h | `{ symbol, currency, dividends: [{ timestamp, amount }] }` |

Ambas **lanzan excepción** en error (HTTP no-ok, `chart.error`, o falta `regularMarketPrice`).
El manejo de fallos es responsabilidad del caller.

`fetchYahooDividends` filtra eventos con timestamp/amount no finitos o `amount <= 0` y los
ordena ascendente por fecha.

### `src/lib/market/quotes.ts` — el orquestador

```ts
export async function refreshLatestQuotes(
  instruments: InstrumentForQuote[]   // { id, ticker, type }
): Promise<{ prices: Map<string, string>; errors: string[] }>
```

Algoritmo:

```
1. Query única: PriceCache donde instrumentId ∈ ids AND source = "yahoo",
   orderBy datetime desc, distinct ["instrumentId"]
2. Para cada instrumento:
     si el cacheado tiene < 10 min (FRESH_PRICE_MS)  →  usarlo
     si no                                            →  agregarlo a toFetch
3. Promise.all sobre toFetch:
     fetchYahooQuote(buildYahooSymbol(ticker, esArgentino))
     ├─ ok    →  prices.set(id, price) + upsert en PriceCache
     └─ error →  fallback al cacheado (si hay) + push a errors[]
4. return { prices, errors }
```

Constantes clave:

```ts
const ARGENTINIAN_TYPES = new Set<InstrumentType>(["CEDEAR","STOCK_AR","BOND_AR","LETRA","ON"]);
const FRESH_PRICE_MS = 10 * 60 * 1000;   // 10 minutos
```

El `datetime` del upsert usa `quote.asOf` (el `regularMarketTime` de Yahoo, en segundos Unix)
o `new Date()` si Yahoo no lo trae. Como `asOf` es estable dentro de la misma sesión de
mercado, el upsert actualiza en vez de insertar.

**El mapa `prices` está indexado por `instrumentId`, no por ticker.**

---

## 2. Precios de ONs (data912)

### `src/lib/market/data912.ts`

Endpoint: `https://data912.com/live/arg_corp`. Sin auth. Revalidate 300 s, tag `"on-prices"`.

```ts
export type Data912Quote = {
  symbol: string;
  c: number;          // ← ARS por 100 VN nominal
  px_bid: number;
  px_ask: number;
  pct_change: number;
};

export async function fetchOnPrices(symbols: string[]): Promise<{
  quotes: Map<string, Data912Quote>;   // key = ticker en MAYÚSCULAS
  stale: boolean;
}>
```

### 🔑 La semántica del precio

```
data912 `c`         = ARS por 100 VN nominal
Balanz "Cantidad"   = VN crudos (NO láminas de 100)

⇒ marketValueARS = nominalHeld × c / 100
```

El `/100` es esencial. Omitirlo infla la posición **exactamente ×100** — es el bug real que
reportaba MCC3O a ~US$14.700 en vez de ~US$147. La constante vive en
`src/lib/bonds/valuation.ts` como `VN_QUOTE_BASIS = 100`.

### El bucket de timestamp (gotcha importante)

```ts
const nowMs = Date.now();
const bucketMs = REVALIDATE_SECONDS * 1000;          // 300_000
const bucketedNow = new Date(Math.floor(nowMs / bucketMs) * bucketMs);
```

data912 no expone timestamp de mercado. Si usáramos `new Date()` crudo, cada llamada generaría
una clave nueva en `@@unique([instrumentId, datetime, source])`, el `WHERE` del upsert nunca
matchearía, siempre entraría por `create` y **la tabla crecería sin límite**. Truncar al bucket
de 300 s da una clave estable dentro de cada ventana de revalidación.

**Si escribís otro proveedor que hace upsert por tiempo, replicá este patrón.**

### Fallback

```
fetch OK   →  quotes desde la respuesta viva, stale: false, upsert en PriceCache
fetch FAIL →  readCachedQuotes(): último PriceCache por símbolo (source "data912"),
              cualquier antigüedad, stale: true
```

Los símbolos sin precio vivo **y** sin caché quedan fuera del Map. El caller detecta la ausencia
y renderiza "precio no disponible".

Los errores de escritura en `PriceCache` son no fatales (try/catch vacío): el precio se devuelve
igual.

---

## 3. Cotización del dólar (CCL)

### `src/lib/market/dolarapi.ts` — el cliente

```ts
const CCL_ENDPOINT = "https://dolarapi.com/v1/dolares/contadoconliqui";
const REVALIDATE_SECONDS = 60 * 15;   // 15 min, tag "ccl-quote"

export async function fetchCclQuote(): Promise<CclQuote | null>
// CclQuote = { buy, sell, mid, updatedAt }
```

**Devuelve `null` en cualquier fallo** (no lanza): HTTP no-ok, excepción de red, o valores
`compra`/`venta` ausentes o `<= 0`. `mid = (buy + sell) / 2`.

### `src/lib/market/ccl-rate.ts` — el resolver con persistencia

```ts
export async function resolveCclRate(): Promise<number | null>
```

```
1. Buscar el FxRate USD/ARS más reciente (cualquier source)
2. Si su `date` >= medianoche UTC de hoy  →  devolverlo, sin refetch
3. Si no, fetchCclQuote()
     ├─ null →  devolver el último guardado (por viejo que sea), o null si no hay ninguno
     └─ ok   →  upsert FxRate { date: hoyUTC, USD, ARS, source: CCL, buy, sell, mid }
                (fallo de escritura es no fatal — igual devuelve el mid fresco)
```

Es **un refresh lazy por día UTC**, no tiempo real. Y dolarapi ya está fetch-cacheado 15 min
por encima.

### ⚠️ Tres consumidores, tres estrategias distintas

| Consumidor | Cómo obtiene el CCL | Persiste |
|---|---|---|
| `/dashboard` | `resolveCclRate()` | ✅ escribe `FxRate` |
| `/dividends` | `fetchCclQuote()` directo | ❌ |
| `/bonds` | `fetchCclQuote()` directo | ❌ |
| `/transactions` | `prisma.fxRate.findFirst()` — **solo lee** | ❌ |

**Consecuencia concreta:** en una instalación nueva, `/transactions` muestra `CCL: —` hasta que
alguien visite `/dashboard`, porque el dashboard es el único que escribe la fila. Es la deuda
técnica más relevante del sistema. **Fix:** que los cuatro usen `resolveCclRate()`.

---

## 4. Catálogo de instrumentos

### `src/lib/market/data912-universe.ts` — leer el universo BYMA

```ts
const BASE = "https://data912.com/live";
const REVALIDATE_SECONDS = 60 * 60 * 6;   // 6 h, tag "instrument-catalog"

const ENDPOINTS = [
  { path: "arg_stocks",  type: InstrumentType.STOCK_AR },   // ~97
  { path: "arg_cedears", type: InstrumentType.CEDEAR },     // ~925, incl. IBIT, SPY, QQQ
  { path: "arg_corp",    type: InstrumentType.ON },         // ~590
];

export async function fetchInstrumentUniverse(): Promise<CatalogInstrument[]>
// CatalogInstrument = { ticker, type, currencyCode: "ARS", venueCode: "BYMA" }
```

Solo se ingestan esos 3 tipos — los que la página de transacciones puede mostrar. Bonos
soberanos y letras se saltean a propósito.

**Tolerancia a fallos:** `Promise.allSettled`. Un endpoint caído se loguea con `console.error`
y se saltea; los otros dos igual entran.

**Variantes de liquidación:**

```ts
function stripCurrencyVariants(symbols: string[]): string[] {
  const set = new Set(symbols);
  return symbols.filter((s) => {
    const last = s.at(-1);
    if (last !== "C" && last !== "D") return true;
    return !set.has(s.slice(0, -1));    // descartar solo si existe el ticker base
  });
}
```

Descarta las variantes MEP (`…D`) y CCL (`…C`) cuando el ticker base en pesos también está en
la lista: se queda con `AAPL` y tira `AAPLD`/`AAPLC`. Un ticker legítimo terminado en C/D sin
base se preserva.

### `src/lib/market/catalog-sync.ts` — reconciliar

```ts
export async function syncInstrumentCatalog(): Promise<CatalogSyncResult>
// { ok, fetched, created, reactivated, delisted, renamed, error? }
```

**Guard crítico, antes que nada:**

```ts
if (universe.length === 0) {
  return { ok: false, ..., error: "Universo vacío — no se tocó el catálogo (probable caída de data912)" };
}
```

Sin ese guard, una caída simultánea de los 3 endpoints delistearía el catálogo entero.
**Si escribís otra reconciliación de catálogo, replicá este guard.**

Después compara por clave de identidad
(`ticker|type|currencyCode|venueCode`) contra las filas existentes con
`venueCode: "BYMA"` y `type ∈ [STOCK_AR, CEDEAR, ON]`:

| Situación | Acción |
|---|---|
| Símbolo nuevo | `createMany` con `active: true`, `skipDuplicates: true` |
| Existía inactivo, ahora listado | `updateMany` → `active: true` |
| Existía activo, ya no está | `updateMany` → `active: false` (**soft delist**) |
| `name === ticker` y hay nombre curado | `updateMany` → nombre curado |

> ⚠️ **Nunca `delete`.** `Transaction` tiene FK a `Instrument`; el histórico tiene que sobrevivir
> a un delisting.

`taxJurisdiction` se deriva: `currencyCode === "ARS" ? "AR" : "US"`.

La query de reconciliación está **acotada al dominio del catálogo** (`venueCode: BYMA` + esos
3 tipos), así que nunca toca instrumentos manuales o de otros venues.

### `src/lib/market/instrument-names.ts` — nombres curados

data912 no manda nombres. Este archivo es un `Record<string, string>` con ~35 entradas
(mega-cap tech, finanzas, ETFs, ADRs argentinos):

```ts
export const CURATED_INSTRUMENT_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", /* … */
  SPY: "SPDR S&P 500 ETF Trust", IBIT: "iShares Bitcoin Trust ETF",
  GGAL: "Grupo Financiero Galicia", MELI: "MercadoLibre Inc.",
};

export function displayNameFor(ticker: string): string {
  return CURATED_INSTRUMENT_NAMES[ticker.toUpperCase()] ?? ticker.toUpperCase();
}
```

No necesita ser exhaustivo: sin entrada, el nombre es el ticker. **Agregar una entrada acá y
re-correr el sync backfillea el nombre** (el paso de "name enrichment" busca filas donde
`name === ticker`).

El backfill hace un `updateMany` por entrada del mapa — está acotado a las ~35 entradas, así
que el costo es predecible.

### El cron

`vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/sync-catalog", "schedule": "0 7 * * *" }] }
```

`src/app/api/cron/sync-catalog/route.ts`:

```ts
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await syncInstrumentCatalog();
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
```

Si `CRON_SECRET` no está definida, el endpoint queda **abierto** (a diferencia del invite code
del registro, que es fail-closed). Definila en producción.

### Self-heal del catálogo

Complementa al cron para cubrir el hueco entre syncs. Vive en
`src/app/actions/transactions.ts` → `searchInstrumentsAction`:

```
1. Buscar en la tabla Instrument (active, tipos operables, ticker o name LIKE)
2. Si hay resultados → devolverlos
3. Si no hay Y el query matchea /^[A-Z0-9.]{2,12}$/:
     fetchInstrumentUniverse()
     filtrar por ticker exacto o prefijo, tomar hasta 10
     insertar los que falten (findFirst + create, skip en error de carrera)
     devolverlos
```

---

## 5. Logos

### `src/lib/market/logos.ts`

```ts
export function logoCandidates(ticker: string): string[]
```

Cadena ordenada, mejor primero:

| # | Proveedor | URL | Resuelve |
|---|---|---|---|
| 1 | logo.dev | `img.logo.dev/ticker/{TICKER}?token=…&format=png&retina=true&fallback=404` | CEDEARs de símbolo US (AAPL, IBIT) |
| 2 | logo.dev | idem con `{TICKER}.BA` | Acciones locales (YPFD.BA, PAMP.BA, ALUA.BA) |
| 3 | Cocos Capital | `assets.cocos.capital/cocos/logos/{TICKER}.jpg` | Red de seguridad. Sin API key |

`fallback=404` es clave: fuerza a logo.dev a devolver 404 en tickers desconocidos en vez de
generar un monograma, para que la cadena pueda avanzar.

Sin `NEXT_PUBLIC_LOGO_DEV_TOKEN` la cadena arranca directo en Cocos.
El resultado se deduplica con `[...new Set(urls)]`.

### `src/components/transactions/ticker-avatar.tsx`

```tsx
export function TickerAvatar({ ticker, className }: { ticker: string; className?: string })
```

- Itera los candidatos con `onError` → `setAttempt(a => a + 1)`.
- Al agotarlos, renderiza un cuadrado con las **2 primeras letras** del ticker y un color
  derivado por hash sobre una paleta de 7.
- Usa `<img>` plano, no `next/image`: los CDNs devuelven 404 por ticker y hay cadena de
  fallback, así que la optimización de Next no aplica (hay un
  `eslint-disable-next-line @next/next/no-img-element` con el motivo).

**Carrera SSR → hidratación:**

```tsx
useEffect(() => {
  const img = imgRef.current;
  if (img && img.complete && img.naturalWidth === 0) {
    setAttempt((a) => a + 1);
  }
}, [attempt]);
```

Un 404 puede resolverse **antes** de que React attachee el `onError`, lo que dejaría el icono
de imagen rota. Este efecto detecta ese caso al montar (y en cada candidato nuevo) y avanza
manualmente.

El componente vive en `components/transactions/` pero lo usan también dashboard, dividendos
y bonos.

---

## Resumen de caché

| Dato | Caché de fetch | Caché en DB | Frescura efectiva |
|---|---|---|---|
| Quote Yahoo | 5 min | `PriceCache` source `"yahoo"` | 10 min (`FRESH_PRICE_MS`) |
| Dividendos Yahoo | 12 h | — | 12 h |
| Precio ON data912 | 300 s (tag `on-prices`) | `PriceCache` source `"data912"` | 300 s |
| Universo data912 | 6 h (tag `instrument-catalog`) | tabla `Instrument` | 6 h + cron diario |
| CCL dolarapi | 15 min (tag `ccl-quote`) | `FxRate` source `CCL` | 1 día (vía `resolveCclRate`) |

Los tags (`on-prices`, `ccl-quote`, `instrument-catalog`) están declarados pero **nadie llama
`revalidateTag()`** todavía. Si querés forzar un refresh manual, esa es la puerta.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **Tres estrategias de CCL** (ver arriba). `/transactions` nunca siembra `FxRate` |
| 2 | `bcra.ts` y `byma.ts` son stubs `export const TODO = true` |
| 3 | Los tags de revalidación existen pero nadie los invalida |
| 4 | `PriceCache` no tiene política de retención — crece indefinidamente aunque acotado por los buckets |
| 5 | `refreshLatestQuotes` hace `Promise.all` sin límite de concurrencia. Con muchos instrumentos podría pegarle fuerte a Yahoo |
| 6 | `data912.ts` hace un `findFirst` de `Instrument` **por símbolo** dentro del `Promise.all` (N queries). Se podría resolver con un `findMany` previo |
| 7 | Los precios de Yahoo se guardan en la moneda nativa del ticker sin registrar cuál es — el consumidor asume ARS para `.BA` |
| 8 | Sin `CRON_SECRET`, `/api/cron/sync-catalog` queda abierto |

---

## Cómo extender

### Agregar un proveedor de precios

1. Crear `src/lib/market/<proveedor>.ts` con el cliente crudo (fetch + parseo + tipos).
2. Configurar `next: { revalidate: N, tags: ["<algo>"] }`.
3. Definir un `source` string nuevo para `PriceCache`.
4. **Truncar el timestamp a un bucket** si el proveedor no da uno estable.
5. Implementar el fallback: leer el último `PriceCache` de ese `source` y devolver `stale: true`.
6. Devolver un Map + flag `stale`, nunca lanzar por un símbolo suelto.

### Agregar un tipo de instrumento al catálogo

1. Sumar el endpoint a `ENDPOINTS` en `data912-universe.ts`.
2. Sumar el `InstrumentType` a `CATALOG_TYPES` en `catalog-sync.ts`.
3. Verificar que la regla de `venueCode` en `venueForType()` / `venueFor()` lo contemple.
4. Si tiene que aparecer en la UI, sumarlo a `TRADE_INSTRUMENT_TYPES`
   (`src/lib/transactions/types.ts`) — eso lo habilita en transacciones **y** dashboard.

### Agregar una fuente de FX (MEP, oficial, blue)

`FxSource` ya tiene los valores. Necesitás:

1. Un cliente en `dolarapi.ts` (la API expone `/v1/dolares/{casa}`).
2. Un resolver estilo `resolveCclRate()` con el `source` correspondiente.
3. Decidir la política: hoy todo el código asume que "el dólar" es CCL.

### Agregar nombres de instrumentos

Sumar entradas a `CURATED_INSTRUMENT_NAMES` y correr el sync (o esperar al cron de las 07:00 UTC).
El backfill solo pisa filas donde `name === ticker`, así que nunca sobreescribe un nombre real.

### Agregar un proveedor de logos

Sumar una función `<proveedor>Url(symbol)` en `logos.ts` y meterla en el array de
`logoCandidates` en el orden que corresponda. `TickerAvatar` itera solo, no hay que tocarlo.
