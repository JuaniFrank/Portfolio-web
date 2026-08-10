# Sistema de transacciones y holdings

> **Documento autocontenido.** Todo lo necesario para trabajar en posiciones, historial de
> operaciones y alta manual está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router, server actions) · Prisma · decimal.js · Zod + React Hook Form.
- **Ruta:** `/transactions`.
- ⚠️ **`buildHoldings` es la función más compartida del repo.** La usan también dashboard,
  dividendos y eventos corporativos. Tocarla impacta cuatro pantallas.

### Qué hace este sistema

Mostrar las posiciones abiertas del usuario (cantidad, PPP, valor de mercado, P&L), el historial
de compras y ventas, y permitir cargar operaciones manualmente con autocomplete sobre el
catálogo de instrumentos.

---

## Pantalla `/transactions`

```
src/app/(app)/transactions/page.tsx    →  getTransactionsPageDataAction()
                                       →  <TransactionsPage data={data} />
```

Estructura visual (`src/components/transactions/transactions-page.tsx`):

```
┌ Header "Transacciones" ──────────────────── [ + Nueva operación ] ┐
├───────────────────────────────────────────────────────────────────┤
│  Valor actual (ARS)  │  Valor actual (USD)  │  CCL (USD/ARS)      │  ← 3 SummaryCard
├───────────────────────────────────────────────────────────────────┤
│  [ Resumen ] [ Historial ]                                        │  ← Tabs
│  🔍 buscador compartido                                           │
├───────────────────────────────────────────────────────────────────┤
│  HoldingsTable  ó  TradeHistoryTable                              │
└───────────────────────────────────────────────────────────────────┘
```

La card de USD se calcula en el cliente: `totalValueArs / cclRate`, o `—` si no hay CCL.
El placeholder del buscador cambia según la tab activa.

`/transactions/new` es un **redirect** a `/transactions` — la carga manual pasó a ser un modal.

---

## Archivos

| Archivo | Rol | Líneas |
|---|---|---|
| `src/lib/transactions/types.ts` | `HoldingRow`, `TradeHistoryRow`, `TransactionsPageData`, constantes | 51 |
| `src/lib/transactions/holdings.ts` | **`buildHoldings` + `computePortfolioSummary`** | 141 |
| `src/lib/transactions/validations.ts` | Schema Zod del alta manual | 35 |
| `src/app/actions/transactions.ts` | 3 server actions | 448 |
| `src/components/transactions/transactions-page.tsx` | Página | 167 |
| `src/components/transactions/holdings-table.tsx` | Tabla de posiciones | 116 |
| `src/components/transactions/trade-history-table.tsx` | Tabla de historial | 174 |
| `src/components/transactions/transaction-form-modal.tsx` | Modal de alta manual | 371 |
| `src/components/transactions/ticker-avatar.tsx` | Logo con fallback (lo usan 4 sistemas) | 87 |

### Modelos de datos usados

```prisma
model Transaction {
  id              String   @id @default(cuid())
  portfolioId     String
  brokerAccountId String
  instrumentId    String?
  instrument      Instrument? @relation(fields: [instrumentId], references: [id])
  type            TransactionType
  tradeDate       DateTime
  quantity        Decimal  @db.Decimal(20, 8)
  price           Decimal  @db.Decimal(20, 8)
  currencyCode    String
  grossAmount     Decimal  @db.Decimal(20, 8)
  fees            Decimal  @default(0) @db.Decimal(20, 8)
  taxes           Decimal  @default(0) @db.Decimal(20, 8)
  netAmount       Decimal  @db.Decimal(20, 8)   // ← el campo que usa el cálculo
  source          TransactionSource @default(MANUAL)
  importBatchId   String?
  idempotencyHash String
  tags            TransactionTag[]
  @@unique([idempotencyHash, idempotencyVersion])
  @@index([portfolioId, tradeDate])
}

model Instrument {
  id           String         @id @default(cuid())
  ticker       String
  name         String
  type         InstrumentType
  venueCode    String?
  currencyCode String
  active       Boolean        @default(true)
  @@unique([ticker, type, venueCode, currencyCode])
}

model FxRate {
  date              DateTime
  baseCurrencyCode  String    // "USD"
  quoteCurrencyCode String    // "ARS"
  source            FxSource
  mid               Decimal   @db.Decimal(20, 8)
  @@unique([date, baseCurrencyCode, quoteCurrencyCode, source])
}
```

### Constantes que definen el alcance

```ts
// src/lib/transactions/types.ts
export const TRADE_INSTRUMENT_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR", "ON"];
export const TRADE_TYPES: TransactionType[] = ["BUY", "SELL"];
```

> ⚠️ **`TRADE_INSTRUMENT_TYPES` es el filtro maestro.** Lo usan esta pantalla **y** el dashboard.
> Bonos soberanos (`BOND_AR`), letras (`LETRA`), FCI y cripto se importan a la DB pero no
> aparecen en ninguna de las dos. Agregar un tipo acá lo habilita en ambas a la vez.

---

## `getTransactionsPageDataAction()`

`src/app/actions/transactions.ts:69`.

```
1. getCurrentUser() → si no hay, { error: "unauthorized" }

2. Promise.all de 3 queries:
   a) Transaction donde:
        portfolio.userId = user.id
        type ∈ TRADE_TYPES
        instrument.type ∈ TRADE_INSTRUMENT_TYPES
        instrumentId != null
      orderBy tradeDate desc
      include: instrument (id, ticker, name, type),
               importBatch.broker (code, name),
               tags.tag (name)
   b) último FxRate USD/ARS (orderBy date desc)     ← SOLO LEE, no siembra
   c) CorporateEvent de instrumentos del usuario, orderBy effectiveDate asc

3. Armar eventsMap: instrumentId → CorporateEventForBuilder[]

4. Recorrer las filas y bifurcar:
     instrument.type === "ON"  →  onBondTrades (vía toBondTrade)
     resto                     →  tradesForHoldings
   En paralelo se arma `history` (TradeHistoryRow) con ambos

5. Promise.all de precios:
     refreshLatestQuotes(instrumentosÚnicos)   ← Yahoo
     fetchOnPrices(tickersON)                  ← data912

6. equityHoldings = buildHoldings(tradesForHoldings, latestPrices, eventsMap)
   onPositions    = valuateOnPositions(onBondTrades, onPriceResult, cclRate, onNamesById)
   onHoldings     = onPositions.map(p => toHoldingRow(p, cclRate))

7. holdings = [...equityHoldings, ...onHoldings].sort(por ticker)
   summary  = computePortfolioSummary(holdings) + cclRate
```

### El CCL acá solo se lee

```ts
prisma.fxRate.findFirst({
  where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS" },
  orderBy: { date: "desc" },
})
```

**No llama a `resolveCclRate()`.** Si nadie visitó `/dashboard` todavía, la tabla `FxRate` está
vacía y esta pantalla muestra `CCL: —` con la columna USD en `—`. Es la deuda técnica más
visible del repo. Fix: usar `resolveCclRate()` de `src/lib/market/ccl-rate.ts`.

### Conversión de precios ARS ↔ USD

```ts
function tradePricesAndAmounts(price, netAmount, currencyCode, cclRate) {
  if (currencyCode === "USD") {
    return { priceUsd: price, priceArs: price × ccl, amountUsd: |net|, amountArs: |net| × ccl };
  }
  return { priceArs: price, priceUsd: price / ccl, amountArs: |net|, amountUsd: |net| / ccl };
}
```

Sin CCL: `toUsdPrice` devuelve `null` (la UI muestra `—`) y `toArsFromUsd` devuelve el monto USD
sin convertir. Esa asimetría es un detalle a revisar si algún día importa.

### Etiquetas

```ts
const tagLabel = r.tags[0]?.tag.name ?? r.importBatch?.broker.code.toLowerCase() ?? null;
```

Toma la **primera** etiqueta del usuario; si no hay, usa el código del broker en minúsculas
como pseudo-etiqueta. Nada en la UI escribe `Tag` todavía, así que en la práctica siempre se
ve el broker.

---

## El cálculo de posiciones (`src/lib/transactions/holdings.ts`)

Es **AVCO / PPP** (precio promedio ponderado). El enum `CostMethod` contempla FIFO y LIFO,
pero **no están implementados** — el método es siempre PPP, sin importar
`portfolio.costMethod` ni `user.defaultCostMethod`.

### `computePositionFromTrades` (privada)

```ts
// Los trades se ordenan por tradeDate ASC antes de acumular
for (const t of sorted) {
  if (t.type === "BUY") {
    totalCost = totalCost.plus(|netAmount|);
    qty       = qty.plus(quantity);
  } else {                                   // SELL
    if (!qty.isZero()) {
      const costRemoved = totalCost.mul(quantity.div(qty));   // proporcional
      totalCost = totalCost.minus(costRemoved);
    }
    qty = qty.minus(quantity);
    if (qty.lt(0)) qty = 0;                  // clamp
    if (totalCost.lt(0)) totalCost = 0;      // clamp
  }
}
avgPrice = qty.isZero() ? 0 : totalCost.div(qty);
```

**Puntos clave:**

- Usa `|netAmount|`, no `grossAmount`. Eso hace que comisiones e impuestos entren en el costo.
- La venta libera costo **proporcional**, así que el PPP de lo que queda no cambia.
- Los clamps a 0 evitan que datos sucios (una venta sin compra previa) produzcan negativos.

### `buildHoldings` — la función pública

```ts
export function buildHoldings(
  trades: TradeForHoldings[],
  latestPrices: Map<string, string>,          // instrumentId → precio
  events?: Map<string, CorporateEventForBuilder[]>
): HoldingRow[]
```

```
1. Agrupar por instrumentId, aplicando applyEventsToTrade() a cada trade
   si hay eventos para ese instrumento
2. Por instrumento:
     computePositionFromTrades()
     si quantity <= 0  →  descartar (posición cerrada)
     currentPrice = latestPrices.get(id) ?? avgPrice      ← ojo
     marketValue  = quantity × currentPrice
     pnl          = marketValue - costBasis
     pnlPercent   = costBasis.isZero() ? 0 : pnl / costBasis × 100
3. Ordenar por ticker
```

> 🔑 **Sin precio de mercado, usa el PPP como precio actual.** El P&L da 0 en vez de romper o
> mostrar valor 0. Es degradación deliberada, pero puede confundir: una posición sin cotización
> se ve "plana", no "sin datos".

El parámetro `events` es opcional y omitirlo es un no-op — retrocompatible.

Formato de salida (todo `string`, listo para cruzar a un Client Component):

```ts
export type HoldingRow = {
  instrumentId: string;
  ticker: string;
  instrumentType: InstrumentType;
  instrumentName: string;
  quantity: string;        // toFixed(4) con ceros finales recortados
  avgPriceArs: string;     // toFixed(2)
  costBasisArs: string;    // toFixed(2)
  currentPriceArs: string; // toFixed(2)
  pnlArs: string;
  pnlPercent: string;
  marketValueArs: string;
};
```

### `computePortfolioSummary`

Suma `marketValueArs` y `costBasisArs` de todos los holdings y devuelve
`{ totalValueArs, totalCostArs, totalPnlArs, totalPnlPercent }`.

---

## Integración con eventos corporativos

Los ajustes por split / cambio de ratio se aplican **en tiempo de agregación**, no mutando la DB.

`src/lib/events/apply.ts`:

```ts
// si tradeDate < effectiveDate (comparación lexical YYYY-MM-DD):
ratio     = numerator / denominator
quantity  = quantity × ratio
price     = price / ratio
netAmount = INVARIANTE      ← el importe pagado nunca cambia
```

Los eventos **deben venir ordenados ascendente por `effectiveDate`** — es responsabilidad del
caller. La action lo garantiza con `orderBy: { effectiveDate: "asc" }`.

`TICKER_CHANGE` es no-op. Ver `sistema-eventos-corporativos.md` para el detalle completo.

---

## Integración con bonos (ONs)

Las ONs **no** pasan por `buildHoldings`: tienen valuación propia (precio en ARS por 100 VN).
El puente es `src/lib/bonds/portfolio-bridge.ts`:

```ts
toBondTrade(trade, currencyCode)          // TradeForHoldings → TradeForBondHoldings
valuateOnPositions(trades, priceResult, cclRate, namesById)  // → ValuatedOnPosition[]
toHoldingRow(position, cclRate)           // ValuatedOnPosition → HoldingRow
```

`toHoldingRow` reconstruye los campos que la tabla espera:

```ts
costBasisArs    = costBasisUsd × ccl        (0 si no hay CCL)
avgPriceArs     = costBasisArs / nominal
currentPriceArs = marketValueArs / nominal
instrumentType  = "ON"
```

Así una ON se ve en la misma tabla que un CEDEAR. Ver `sistema-bonos.md` para la valuación.

---

## Alta manual

### Schema (`src/lib/transactions/validations.ts`)

```ts
export const TRANSACTION_CURRENCIES = ["ARS", "USD"] as const;

export const newTransactionInputSchema = z.object({
  ticker: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()),
  instrumentType: z.nativeEnum(InstrumentType),
  side: z.enum(["BUY", "SELL"]),
  currencyCode: z.enum(TRANSACTION_CURRENCIES),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  quantity: positiveNumberString,     // > 0
  price: positiveNumberString,        // > 0
  fees: nonNegativeNumberString.optional(),
  taxes: nonNegativeNumberString.optional(),
});
```

Los montos viajan como **string** y se validan con `Number.isFinite(Number(v))` — así no se
pierde precisión antes de llegar a `Prisma.Decimal`.

### `createTransactionAction(input)`

```
1. getCurrentUser()
2. newTransactionInputSchema.safeParse(input)   ← revalidación en servidor
3. ensureManualTargets(user.id)
4. Resolver el instrumento por identidad
5. Calcular montos
6. Crear la Transaction
7. revalidatePath("/transactions") + revalidatePath("/dashboard")
```

**`ensureManualTargets(userId)`** — crea lo mínimo para que un usuario sin imports pueda operar:

```
portfolio: findFirst({ userId, archivedAt: null }, orderBy createdAt asc)
           ?? create({ name: "Principal", isDefault: true, baseCurrencyCode: "ARS" })

account:   findFirst({ userId, archivedAt: null }, orderBy createdAt asc)   ← reutiliza cualquiera
           ?? broker MANUAL (upsert) + create({ name: "Carga manual", currencyCode: "ARS" })
```

Nota: reutiliza **cualquier** cuenta existente antes de crear la de "Manual". Es decir, un trade
manual puede quedar asociado a tu cuenta de Balanz.

**Resolución del instrumento:**

```ts
function venueForType(type: InstrumentType): string | null {
  return type === CEDEAR || type === STOCK_AR || type === BOND_AR || type === LETRA || type === ON
    ? "BYMA" : null;
}

const identity = { ticker, type: instrumentType, venueCode, currencyCode };

let instrument = await prisma.instrument.findFirst({ where: identity });
if (!instrument) {
  try {
    instrument = await prisma.instrument.create({ data: { ...identity, name: ticker, taxJurisdiction } });
  } catch (err) {
    if (esP2002(err)) instrument = await prisma.instrument.findFirst({ where: identity });
    if (!instrument) throw err;
  }
}
```

Dos cosas importantes:

- **La convención de `venueCode` es idéntica a la del importer** (`venueFor()` en
  `src/lib/importers/commit-import.ts`), para que un trade manual y uno importado resuelvan
  al **mismo** `Instrument`. Las dos funciones están duplicadas; si tocás una, tocá la otra.
- Se usa `findFirst` + `create` y **no `upsert`** porque `venueCode` es nullable y forma parte
  del unique compuesto — Prisma no puede targetear `null` en el `where` de un upsert compuesto.
  El catch de P2002 cubre la carrera contra un insert concurrente.

**Montos:**

```ts
grossAmount = quantity × price
netAmount   = side === "BUY"
                ? gross + fees + taxes      // plata que sale
                : gross - fees - taxes      // plata que entra
```

**Idempotencia:** `sha256("manual|<userId>|<randomUUID()>")` — siempre único. El antiduplicado
solo aplica a imports.

### `searchInstrumentsAction(query)` — autocomplete con self-heal

```
1. getCurrentUser() → [] si no hay
2. Buscar en Instrument: active, type ∈ TRADE_INSTRUMENT_TYPES,
   ticker LIKE %q% OR name LIKE %q% (insensitive), take 10, orderBy ticker asc
3. Si hay resultados → devolverlos
4. Si NO hay y el query matchea /^[A-Z0-9.]{2,12}$/:
     fetchInstrumentUniverse()               ← data912 en vivo
     filtrar por ticker exacto o prefijo, tomar 10
     insertar los faltantes (findFirst + create, `continue` si falla)
     devolverlos
```

El paso 4 cubre el hueco entre corridas del cron de catálogo (diario, 07:00 UTC). Si comprás un
símbolo que se listó hoy, igual lo encontrás.

### El modal (`transaction-form-modal.tsx`)

React Hook Form + `zodResolver(newTransactionInputSchema)`.

Campos: Ticker (con `<datalist>`) · Tipo de instrumento · Operación (Compra/Venta) · Moneda ·
Fecha · Cantidad · Precio unitario · Comisiones · Impuestos · **Total en vivo**.

```ts
const INSTRUMENT_TYPE_OPTIONS = [
  { value: InstrumentType.CEDEAR,   label: "CEDEAR" },
  { value: InstrumentType.STOCK_AR, label: "Acción argentina" },
  { value: InstrumentType.ON,       label: "Obligación negociable" },
];
```

> Estas 3 opciones están **sincronizadas a mano con `TRADE_INSTRUMENT_TYPES`**. Ofrecer un tipo
> fuera de ese set haría que la operación se guarde pero no aparezca en ninguna pantalla —
> el usuario la perdería en silencio. Está comentado en el archivo.

**Búsqueda con debounce (250 ms):**

```ts
const results = await searchInstrumentsAction(q);
setInstruments(results);
const exact = results.find((i) => i.ticker.toUpperCase() === q.toUpperCase());
if (exact) {
  setValue("instrumentType", exact.type, { shouldValidate: true });
  if (exact.currencyCode === "ARS" || exact.currencyCode === "USD") {
    setValue("currencyCode", exact.currencyCode, { shouldValidate: true });
  }
}
```

En match exacto autocompleta tipo y moneda, pero el usuario los puede pisar.

**Total en vivo:** `useMemo` que replica la fórmula del servidor
(`BUY: gross + costos`, `SELL: gross − costos`). Es solo visual — la fuente de verdad es la action.

Al cerrar: `toast.success("Operación registrada")` + `router.refresh()`.

---

## Tablas

### `HoldingsTable`

Filtra en cliente por ticker o nombre (case-insensitive) con el `search` que baja de la página.

| Columna | Contenido |
|---|---|
| Ticker | `TickerAvatar` (10×10) + ticker + nombre |
| Cantidad | `toLocaleString("es-AR", { maximumFractionDigits: 4 })` |
| Precio promedio | PPP en ARS |
| Monto | `costBasisArs` |
| Precio actual | `currentPriceArs` |
| Rendimiento | `pnlArs` + `(±pnlPercent%)`, verde/rojo |

Empty state distinto según haya 0 holdings ("No tenés posiciones…") o 0 resultados de búsqueda
("Ningún ticker coincide…").

### `TradeHistoryTable`

Filtra por ticker, nombre, monto ARS, etiqueta o label del tipo de transacción.

Columnas: checkbox (sin lógica) · Ticker · Fecha (`yyyy-MM-dd`) · Cantidad · Precio ARS ·
Precio USD · Monto · Tipo · Etiquetas · Acciones.

- Usa `TRANSACTION_TYPE_LABELS` de `src/lib/imports/filters.ts` (compartido con imports).
- Los botones de editar y eliminar están **`disabled`** con `title="(próximamente)"`.
- El checkbox de selección no está conectado a nada.

### `TickerAvatar`

Vive acá pero lo usan dashboard, dividendos y bonos. Resuelve el logo iterando
`logoCandidates(ticker)` (logo.dev plano → logo.dev `.BA` → Cocos Capital) con `onError`, y al
agotar candidatos dibuja las iniciales con color por hash. Ver `sistema-market-data.md`.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **El CCL solo se lee, nunca se siembra.** `CCL: —` en instalación nueva hasta visitar `/dashboard` |
| 2 | **`TRADE_INSTRUMENT_TYPES` acotado a 3 tipos.** BOND_AR, LETRA, FCI y cripto se importan pero no se ven |
| 3 | **FIFO/LIFO no implementados.** El enum existe en `User` y `Portfolio`, el cálculo es siempre PPP |
| 4 | **Editar y eliminar operaciones no existe.** Botones `disabled` |
| 5 | **No hay filtro por portfolio.** La query usa `portfolio: { userId }` — mezcla todos los portfolios del usuario (el dashboard, en cambio, filtra por uno) |
| 6 | **Sin precio, el P&L da 0** en vez de indicar "sin datos" |
| 7 | `venueForType()` duplicada con `venueFor()` del importer |
| 8 | Las etiquetas se leen pero ninguna UI las escribe |
| 9 | El checkbox de selección múltiple del historial no hace nada |
| 10 | `ensureManualTargets` reutiliza cualquier cuenta antes de crear la "Manual" — un trade manual puede quedar bajo la cuenta de Balanz |
| 11 | `INSTRUMENT_TYPE_OPTIONS` del modal está sincronizado a mano con `TRADE_INSTRUMENT_TYPES` |
| 12 | Sin tests. `buildHoldings` y `computePositionFromTrades` son puras y trivialmente testeables |

---

## Cómo extender

### Habilitar un tipo de instrumento nuevo (ej. bonos soberanos)

1. Sumarlo a `TRADE_INSTRUMENT_TYPES` en `src/lib/transactions/types.ts`.
   Esto lo habilita en `/transactions` **y** en `/dashboard`.
2. Sumarlo a `INSTRUMENT_TYPE_OPTIONS` en `transaction-form-modal.tsx` para poder cargarlo a mano.
3. Verificar `venueForType()` / `venueFor()`.
4. Revisar `marketSegmentFor()` y `translateSector()` en `src/lib/dashboard/build.ts`.
5. Verificar que haya fuente de precio: `refreshLatestQuotes` solo cubre lo que Yahoo tenga
   con sufijo `.BA`.

### Implementar edición de una operación

1. Action `updateTransactionAction(id, input)` con check de ownership vía `portfolio.userId`.
2. Recalcular `grossAmount` y `netAmount` con la misma fórmula del alta.
3. Decidir qué hacer con `idempotencyHash` — si la fila vino de un import, editarla y mantener
   el hash rompe la trazabilidad; conviene marcar `source: MANUAL`.
4. `revalidatePath()` de `/transactions`, `/dashboard`, `/dividends`, `/bonds`.
5. Habilitar el botón en `trade-history-table.tsx`.

### Implementar FIFO / LIFO

`computePositionFromTrades` (`src/lib/transactions/holdings.ts`) es el único lugar a tocar.

1. Cambiar la firma a `computePositionFromTrades(trades, method: CostMethod)`.
2. Para FIFO/LIFO hace falta mantener **lotes** (`{ qty, unitCost }[]`) en vez de un único
   `totalCost` escalar, y consumirlos por punta al vender.
3. Propagar `method` desde `buildHoldings`, y desde ahí desde cada action
   (leyendo `portfolio.costMethod`).
4. Cuidado: `buildHoldings` la llaman 4 sistemas. Poné un default `PPP` para no romper nada.

### Agregar una columna a la tabla de posiciones

1. Agregar el campo a `HoldingRow` en `src/lib/transactions/types.ts`.
2. Calcularlo en `buildHoldings` (y en `toHoldingRow` del bridge de bonos, si aplica a ONs).
3. Agregar el `<TableHead>` y el `<TableCell>` en `holdings-table.tsx`.

### Escribir el primer test

```ts
import { buildHoldings } from "@/lib/transactions/holdings";

const trades = [
  { instrumentId: "i1", ticker: "AAPL", instrumentType: "CEDEAR", instrumentName: "Apple",
    type: "BUY", quantity: "10", price: "100", netAmount: "1000", tradeDate: "2026-01-01T00:00:00Z" },
  { instrumentId: "i1", ticker: "AAPL", instrumentType: "CEDEAR", instrumentName: "Apple",
    type: "SELL", quantity: "5", price: "120", netAmount: "600", tradeDate: "2026-02-01T00:00:00Z" },
];

const [h] = buildHoldings(trades, new Map([["i1", "150"]]));
// quantity 5, costBasisArs "500.00", marketValueArs "750.00", pnlArs "250.00"
```

Casos que valen la pena: venta total (posición desaparece), venta sin compra previa (clamps),
sin precio (usa PPP), y con un evento corporativo aplicado.
