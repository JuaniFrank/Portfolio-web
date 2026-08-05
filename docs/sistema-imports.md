# Sistema de imports

> **Documento autocontenido.** Todo lo necesario para trabajar en la importación de extractos
> de broker está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router, server actions) · Prisma · `xlsx` (SheetJS) ·
  decimal.js · sonner (toasts).
- **Decisión de diseño central:** el archivo **se parsea en el cliente**. El servidor nunca
  recibe el `.xlsx`, solo filas ya normalizadas.
- **Broker soportado hoy:** solo Balanz (`.xlsx`). Cocos e IOL están declarados y deshabilitados.

### Qué hace este sistema

Tomar el export de movimientos de un broker, normalizarlo a filas tipadas, mostrar una vista
previa con estado por fila, y persistir en `Transaction` de forma idempotente y transaccional
(todo o nada).

---

## Pantallas

| Ruta | Page RSC | Componente cliente |
|---|---|---|
| `/imports` | `src/app/(app)/imports/page.tsx` | `imports-list-page.tsx` |
| `/imports/new` | `src/app/(app)/imports/new/page.tsx` | `new-import-page.tsx` |

Ambas pages siguen el patrón estándar:

```tsx
const result = await getImportedTransactionsAction();
if ("error" in result) redirect("/login");
return <ImportsListPage transactions={result} />;
```

`/imports/new` abre el modal automáticamente (`useState(true)`), así que el "botón" real es
el link desde `/imports`.

---

## Archivos

| Archivo | Rol | Líneas |
|---|---|---|
| `src/lib/importers/types.ts` | Tipos del pipeline | 66 |
| `src/lib/importers/registry.ts` | Catálogo de brokers soportados | 41 |
| `src/lib/importers/balanz.ts` | **Parser de Balanz** | 370 |
| `src/lib/importers/parse-workbook.ts` | Lectura del `.xlsx` + hash | 80 |
| `src/lib/importers/idempotency.ts` | Hash antiduplicado | 23 |
| `src/lib/importers/commit-import.ts` | Persistencia transaccional | 301 |
| `src/lib/importers/fixtures/balanz-movimientos.ts` | Fixture para tests | — |
| `src/lib/imports/filters.ts` | Filtros y labels del listado | 106 |
| `src/app/actions/imports.ts` | Server actions | 139 |
| `src/components/imports/import-modal.tsx` | Wizard de 4 pasos | 358 |
| `src/components/imports/file-dropzone.tsx` | Drag & drop | 61 |
| `src/components/imports/import-preview-table.tsx` | Tabla de vista previa | 109 |
| `src/components/imports/imported-transactions-table.tsx` | Listado filtrable | 187 |
| `src/components/imports/imports-list-page.tsx` | Página de listado | 39 |
| `src/components/imports/new-import-page.tsx` | Página de import nuevo | 40 |

### Modelos de datos usados

```prisma
model ImportBatch {
  id           String       @id @default(cuid())
  userId       String
  brokerId     String
  fileName     String
  fileHash     String                       // SHA-256 del buffer
  status       ImportStatus @default(PENDING)  // PENDING PREVIEW COMMITTED REVERTED FAILED
  rowsTotal    Int @default(0)
  rowsImported Int @default(0)
  rowsSkipped  Int @default(0)
  rawSummary   Json?
  createdAt    DateTime @default(now())
  committedAt  DateTime?
  transactions Transaction[]
  @@index([userId])
}

model Transaction {
  id              String   @id @default(cuid())
  portfolioId     String
  brokerAccountId String
  instrumentId    String?
  type            TransactionType
  tradeDate       DateTime
  settlementDate  DateTime?
  quantity        Decimal  @db.Decimal(20, 8)
  price           Decimal  @db.Decimal(20, 8)
  currencyCode    String
  grossAmount     Decimal  @db.Decimal(20, 8)
  netAmount       Decimal  @db.Decimal(20, 8)
  brokerFxRate    Decimal? @db.Decimal(20, 8)   // ← código de especie, NO cotización
  notes           String?
  source          TransactionSource @default(MANUAL)   // acá siempre IMPORT
  importBatchId   String?
  externalId      String?
  idempotencyHash String
  idempotencyVersion Int   @default(1)
  @@unique([idempotencyHash, idempotencyVersion])
}

model Broker {
  id      String  @id @default(cuid())
  code    String  @unique
  name    String
  enabled Boolean @default(false)   // ← gate del import
}

model Instrument {
  // …
  @@unique([ticker, type, venueCode, currencyCode])
}
```

---

## Flujo completo

```
Usuario suelta .xlsx en FileDropzone
   │
   ▼ ═══ CLIENTE ═══ (el archivo nunca viaja al servidor)
parse-workbook.ts → parseImportFile(brokerCode, file)
   ├─ file.arrayBuffer()
   ├─ sha256Hex(buffer)               ← crypto.subtle
   ├─ XLSX.read(buffer, { type: "array", cellDates: false })
   └─ parseBalanzWorkbook()
        ├─ elige hoja "movimientos" (o la primera)
        ├─ XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })  → matriz
        ├─ readBalanzSheetRows(matriz)   → BalanzRawRow[]
        └─ parseBalanzRows(rows)         → ImportPreviewSummary
   │
   ▼  step: "preview" — el usuario revisa y elige portfolio + cuenta
commitImportAction({ brokerCode, fileName, fileHash, portfolioId, brokerAccountId, rows })
   │
   ▼ ═══ SERVIDOR ═══
   ├─ getCurrentUser()
   ├─ prisma.broker.findUnique({ code })  →  if (!broker?.enabled) error
   ├─ ensureDefaultImportTargets() si falta portfolio o cuenta
   └─ commitImportBatch()
        ═══ FUERA de la transacción ═══
        ├─ hashear todas las filas             (idempotency.ts)
        ├─ 1 query: descartar hashes ya en DB + duplicados dentro del batch
        └─ resolveInstrumentsBatch()           (findMany + createMany)
        ═══ DENTRO de $transaction (timeout 15 s) ═══
        ├─ create ImportBatch (status COMMITTED)
        └─ createMany Transaction (skipDuplicates)
   │
   ▼
revalidatePath("/imports") + revalidatePath("/transactions")
router.refresh() en el cliente
```

---

## El parser de Balanz

`src/lib/importers/balanz.ts` es el archivo más denso del sistema. Leelo entero antes de tocarlo.

### Entrada esperada

Hoja `"movimientos"`. Si no existe, usa la primera hoja del workbook.

```ts
export interface BalanzRawRow {
  Descripcion: string;
  Ticker: string;
  "Tipo de Instrumento": string;
  Concertacion: string;      // fecha
  Cantidad: number;
  Precio: number;            // -1 cuando el broker no lo reporta
  Liquidacion: string;       // fecha
  Moneda: string;
  Importe: number;           // con signo
}
```

`readBalanzSheetRows` mapea por **nombre de columna** (no por índice), construyendo un
`colIndex` desde la fila de encabezado. Filas completamente vacías se saltean.

### Mapeo de tipo de instrumento

```ts
export function mapBalanzInstrumentType(tipo: string): InstrumentType | null {
  switch (tipo.trim()) {
    case "Cedears":      return InstrumentType.CEDEAR;
    case "Acciones":     return InstrumentType.STOCK_AR;
    case "Bonos":        return InstrumentType.BOND_AR;
    case "Letras":       return InstrumentType.LETRA;
    case "Corporativos": return InstrumentType.ON;
    default:             return null;
  }
}
```

### Parseo de la descripción

`Descripcion` viene partida por `/`. El primer segmento es la categoría.

| Categoría | Formato | Qué extrae |
|---|---|---|
| `Boleto` | `Boleto / <externalId> / <SIDE> / … / <TICKER>` | `externalId`, `side`, `tickerFromDesc` |
| `Dividendo en efectivo` | `… / TICKER` | `tickerFromDesc` |
| `Amortización` | `… / TICKER` | `tickerFromDesc` |
| `/cup[oó]n/` | `… / TICKER` | `tickerFromDesc` |
| `Movimiento Manual` | `… - TICKER` (regex al final) | `tickerFromDesc` |

### Mapeo de categoría → `TransactionType`

| Categoría | Tipo resultante | Notas |
|---|---|---|
| `Boleto` | `BUY` / `SELL` | Match por **substring** de `COMPRA`/`VENTA` — cubre `LICOMPRA`/`LIVENTA`. Además, si la descripción matchea `/licitaci[oó]n/i` → `BUY` |
| `Dividendo en efectivo` | `DIVIDEND_CASH` | Ver heurística CEDEAR abajo |
| `Recibo de Cobro` | `DEPOSIT` | |
| `Comprobante de Pago` | `WITHDRAWAL` | |
| `Amortización` | `AMORTIZATION` | |
| `Movimiento Manual` | `TAX_WITHHOLDING` si matchea `/ret\s+iigg\|bbpp\|impuesto\|retenci[oó]n/i`, si no `ADJUSTMENT` | |
| default con `/cup[oó]n/` | `COUPON` | |
| default con `/amortiz/` | `AMORTIZATION` | |
| resto | `null` → fila `invalid` | Mensaje: "Tipo de movimiento no soportado: X" |

### ⚠️ El match de cupones es conservador a propósito

```ts
// "renta" está EXCLUIDO deliberadamente: matchea filas de FCI
// ("FCI Renta Fija", "FCI Renta Variable") y las importaría como COUPON.
// Eso es corrupción de datos, no un falso positivo cosmético.
const isCoupon = /cup[oó]n/i.test(descripcion);
```

**El string exacto que usa Balanz para cupones NO está confirmado.** Antes de ampliar el regex,
conseguí un export real que contenga un cupón y verificá. Está documentado en dos lugares del
archivo (`balanz.ts:117` y `balanz.ts:163`).

### 🔑 Heurística CEDEAR — el impuesto disfrazado de dividendo

Balanz reporta el impuesto al dividendo de CEDEARs como **otra fila** `Dividendo en efectivo`,
pero en pesos y con importe negativo, mientras el depósito real viene en `Dólares C.V. NNNN`
con importe positivo.

```ts
if (
  type === TransactionType.DIVIDEND_CASH &&
  instrumentType === InstrumentType.CEDEAR &&
  currencyCode === "ARS" &&
  raw.Importe < 0
) {
  type = TransactionType.TAX_WITHHOLDING;
}
```

Sin esta reclasificación aparecerían **dos dividendos** por el mismo evento y el agregador de
`/dividends` no podría emparejar la retención. Ver `sistema-dividendos.md`.

### Parseo de moneda

```ts
const BROKER_FX_FROM_CURRENCY = /D[oó]lares\s+C\.V\.\s+([\d.,]+)/i;

export function parseBalanzCurrency(moneda: string): { currency: string; brokerFxRate: string | null }
```

| Entrada | Resultado |
|---|---|
| `"Pesos"`, `"ARS"`, `"$"` | `{ currency: "ARS", brokerFxRate: null }` |
| `"Dólares C.V. 7000"` | `{ currency: "USD", brokerFxRate: "7000" }` |
| `"US Dollar (Cable)"`, `"Dólares"`, `"USD"`, `"U$S"` | `{ currency: "USD", brokerFxRate: null }` |
| cualquier otra | **lanza `Error`** |

> 🔑 **`brokerFxRate` NO es una cotización.** El `7000` de `"Dólares C.V. 7000"` es un código de
> especie que indica dólar cable de origen exterior. Se persiste solo por trazabilidad.
> Nunca lo uses como tipo de cambio. Está documentado en `src/lib/dividends/aggregate.ts`.

La moneda desconocida **lanza** en vez de caer silenciosamente a ARS: `parseBalanzRow` captura
la excepción y marca la fila `invalid` con `"Moneda no reconocida: …"`. Es intencional — una
moneda mal asumida corrompe todos los cálculos aguas abajo.

### Derivación de precio

```ts
const price =
  raw.Precio !== -1 && raw.Precio > 0
    ? new Decimal(raw.Precio).toFixed()
    : !quantity.isZero()
      ? net.abs().div(quantity).toFixed(8)   // derivar de |Importe| / Cantidad
      : null;
```

### Fechas

```ts
function parseDate(value: string): string | null {
  const d = new Date(`${value}T12:00:00.000Z`);   // mediodía UTC
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
```

Se ancla al **mediodía UTC** para que ningún corrimiento de zona horaria cambie el día
calendario. Si falta `Liquidacion`, cae a `Concertacion`.

### Estado de la fila

```
messages con alguno que empieza con "Falta"  →  invalid
messages no vacío                             →  warning
sin messages                                  →  valid
```

Mensajes posibles: `"Falta ticker para este movimiento"` (solo para tipos que requieren
instrumento) y `"Tipo de instrumento desconocido: X"`.

`needsInstrument()` devuelve `false` para `DEPOSIT`, `WITHDRAWAL`, `ADJUSTMENT` y
`TAX_WITHHOLDING`.

### Salida

```ts
export interface ImportPreviewSummary {
  brokerCode: BrokerImportCode;
  fileName: string;
  fileKind: "CSV" | "XLSX";
  fileHash: string;
  rows: NormalizedImportRow[];
  stats: { total: number; valid: number; warning: number; invalid: number };
}
```

---

## Idempotencia

`src/lib/importers/idempotency.ts`:

```ts
export function buildImportIdempotencyHash(input: {
  brokerAccountId: string;
  row: ParsedImportRowData;
  rowNumber: number;
}): string {
  const payload = [
    brokerAccountId,
    row.externalId ?? "",
    row.tradeDate,
    row.type,
    row.ticker ?? "",
    row.currencyCode,
    row.quantity,
    row.netAmount,
    String(rowNumber),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}
```

**`rowNumber` está incluido a propósito.** Permite dos filas idénticas dentro del mismo archivo
(operaciones repetidas legítimas el mismo día, mismo precio) pero bloquea reimportar el mismo
archivo.

Consecuencia a tener en cuenta: si Balanz reordena las filas entre dos exports del mismo período,
los hashes cambian y podrías duplicar. Es un trade-off consciente.

---

## Persistencia (`commit-import.ts`)

### Estructura: reads afuera, writes adentro

```ts
const TRANSACTION_TIMEOUT_MS = 15_000;
```

**Fuera de la transacción:**

1. Validar que la cuenta y el portfolio pertenezcan al usuario.
2. Filtrar `status !== "invalid" && parsed`.
3. Hashear todas las filas.
4. **Una sola query** de hashes existentes (`findMany` con `in`), más dedupe dentro del batch
   con un `Set`.
5. `resolveInstrumentsBatch()`.

**Dentro de `$transaction`:** solo 3 statements → `create` del `ImportBatch` + `createMany` de
`Transaction`. Corre en milisegundos sin importar el volumen de filas. El timeout de 15 s es
puro margen de seguridad.

### `resolveInstrumentsBatch`

```ts
async function resolveInstrumentsBatch(db, rows): Promise<Map<string, string>>  // key → instrumentId
```

- Construye el set de instrumentos deseados por clave `ticker|type|currencyCode|venueCode`.
- Un `findMany` por tickers, mapea los existentes.
- Un `createMany` con `skipDuplicates` para los faltantes, y un segundo `findMany` para
  recuperar los ids.
- Nombre inicial: el ticker crudo. `taxJurisdiction`: `currencyCode === "ARS" ? "AR" : "US"`.

**Corre fuera de la transacción a propósito.** Los instrumentos son datos de referencia
compartidos: crear uno que quede sin usar (si el commit hace rollback) es inofensivo y se
reutiliza en el reintento.

### La convención de `venueCode`

```ts
function venueFor(type: InstrumentType): string | null {
  return type === CEDEAR || type === STOCK_AR || type === BOND_AR || type === LETRA || type === ON
    ? "BYMA"
    : null;
}
```

> ⚠️ Esta función está **duplicada** como `venueForType()` en `src/app/actions/transactions.ts`.
> Tienen que resolver igual, si no el alta manual y el import crearían instrumentos distintos
> para el mismo activo. Si cambiás una, cambiá la otra.

### `ensureDefaultImportTargets(userId, brokerId)`

Crea, si no existen:

- Portfolio `"Principal"` (`isDefault: true`, `baseCurrencyCode: "ARS"`).
- `BrokerAccount` `"Cuenta principal"` (`currencyCode: "ARS"`) para ese broker.

### Manejo de errores

```ts
catch (error) {
  console.error("commitImportBatch", error);
  return { ok: false, error: "No se guardó ningún movimiento. Revisá el archivo y volvé a intentar." };
}
```

La transacción hizo rollback: nada quedó persistido, así que reintentar es seguro. El mensaje
se lo dice al usuario explícitamente.

---

## Server actions (`src/app/actions/imports.ts`)

| Action | Firma | Qué hace |
|---|---|---|
| `getImportContextAction()` | `→ ImportContextData \| { error }` | Brokers, portfolios y cuentas del usuario (para los selects del modal) |
| `commitImportAction(input)` | `→ { ok, importBatchId, imported, skipped } \| { ok: false, error }` | Valida broker habilitado, resuelve targets, delega en `commitImportBatch` |
| `getImportedTransactionsAction()` | `→ ImportedTransactionRow[] \| { error }` | Transacciones con `source: IMPORT`, con broker y nombre de archivo |

`commitImportAction` revalida `/imports` y `/transactions` solo cuando el commit salió bien.

`getImportedTransactionsAction` filtra `.filter((r) => r.importBatch)` — descarta transacciones
marcadas `IMPORT` que quedaron huérfanas de batch.

---

## Componentes

### `ImportModal` — el wizard

```ts
type Step = "upload" | "preview" | "committing" | "done";
```

| Paso | Contenido | Footer |
|---|---|---|
| `upload` | Select de broker + `FileDropzone` + barra indeterminada mientras parsea | Cancelar |
| `preview` | Nombre de archivo + selects de portfolio/cuenta + `ImportPreviewTable` + "Cambiar archivo" | Cancelar · `Importar N movimientos` |
| `committing` | Spinner + barra + "No cierres esta ventana. Se guarda todo o nada" | Cancelar (disabled) · Guardando… |
| `done` | Mensaje verde de confirmación | Cerrar |

Detalles de comportamiento:

- Al cerrar el modal, todo el estado se resetea (`useEffect` sobre `open`).
- Al abrir, preselecciona el portfolio `isDefault` (o el primero) y la primera cuenta del broker.
- Cambiar de broker limpia el preview y vuelve a `upload`.
- Durante `committing`, `handleClose` ignora el cierre.
- Al cerrar en `done`, navega a `/imports`.
- `canCommit = hay preview && hay filas válidas && el broker de la DB está enabled`.

### `FileDropzone`

`<label>` con `<input type="file" className="sr-only">`. Maneja `onDragOver` / `onDragLeave` /
`onDrop` y toma solo el primer archivo. El `accept` viene del registry del broker.

### `ImportPreviewTable`

Barra de stats (`N filas · N válidas · N con aviso · N con error`) y tabla con:
`#`, Estado (Badge), Fecha, Tipo, Ticker, Cantidad, Importe, Moneda.

Las filas `invalid` se muestran con `opacity-60`. El primer mensaje se ve truncado con el
resto en el `title`.

`max-h-[min(50vh,420px)]` con scroll interno.

### `ImportedTransactionsTable`

Botonera de 10 filtros con contador cada uno (los que dan 0 se muestran atenuados), línea
"Mostrando X de Y", y tabla: Fecha, Tipo (Badge), Categoría, Ticker, Cantidad, Importe
(verde/rojo según signo), Moneda, Broker.

---

## Filtros y labels (`src/lib/imports/filters.ts`)

```ts
export type ImportTransactionFilter =
  | "all" | "trades" | "stock_ar" | "cedear" | "bond"
  | "letter" | "corporate" | "fees" | "dividends" | "cash";
```

| Filtro | Criterio |
|---|---|
| `trades` | `type ∈ [BUY, SELL]` |
| `stock_ar` / `cedear` / `bond` / `letter` / `corporate` | por `instrumentType` |
| `dividends` | `type ∈ [DIVIDEND_CASH, DIVIDEND_STOCK, COUPON, AMORTIZATION]` |
| `fees` | `type ∈ [FEE, TAX_WITHHOLDING]` |
| `cash` | `type ∈ [DEPOSIT, WITHDRAWAL]` |

El archivo también exporta dos diccionarios que se reutilizan en otras pantallas:

- **`TRANSACTION_TYPE_LABELS`** — `Record<TransactionType, string>` **exhaustivo**. Si agregás
  un `TransactionType` al enum de Prisma, **esto no compila** hasta que agregues la clave.
  Lo usa también `trade-history-table.tsx` del sistema de transacciones.
- **`INSTRUMENT_TYPE_LABELS`** — `Partial<Record<InstrumentType, string>>` (parcial, no exige
  todos).

---

## Registry de brokers

`src/lib/importers/registry.ts`:

| Código | Label | `enabled` | Formatos |
|---|---|---|---|
| `BALANZ` | Balanz | ✅ `true` | `.xlsx` |
| `COCOS` | Cocos Capital | ❌ `false` | `.xlsx` |
| `IOL` | InvertirOnline | ❌ `false` | `.xlsx`, `.csv` |

**Doble gate:** el registry controla la UI (`disabled` en el `SelectItem`), y la tabla `Broker`
de la DB controla el servidor (`if (!broker?.enabled)`). Un broker nuevo necesita **las dos cosas**.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **El string exacto de cupón de Balanz no está confirmado.** El regex es conservador; ampliarlo sin verificar corrompe filas de FCI |
| 2 | **No hay reversión de import.** `ImportStatus` tiene `REVERTED` y `FAILED`, pero solo se escribe `COMMITTED`. No hay UI ni action para deshacer un lote |
| 3 | **El `fileHash` no se usa para detectar reimportación.** Se guarda en `ImportBatch` pero nadie lo consulta antes de importar; la protección real es el `idempotencyHash` por fila |
| 4 | **El parseo en cliente hace que el payload de la action crezca** con el tamaño del extracto. Un archivo muy largo puede chocar con límites de tamaño de request |
| 5 | `venueFor()` duplicada con `venueForType()` |
| 6 | Los instrumentos creados por el import quedan con `name = ticker`. El sync de catálogo los renombra solo si están en `CURATED_INSTRUMENT_NAMES` |
| 7 | `resolveInstrumentsBatch` busca por `ticker in [...]` y después filtra en memoria por la clave completa — trae más filas de las necesarias si hay tickers repetidos entre tipos |
| 8 | Sin tests. `fixtures/balanz-movimientos.ts` y `parseBalanzFixtureRows()` ya están listos para usarse |
| 9 | `marketRights` y `fxRateToBaseCurrency` existen en el schema; el importer no los llena |

---

## Cómo extender

### Agregar un broker nuevo

1. **Registry** — sumar la entrada a `BROKER_IMPORTERS` con `enabled: true`, `fileKinds` y `accept`.
2. **DB** — insertar la fila en `Broker` con `enabled: true` (o agregarla al seed).
3. **Parser** — crear `src/lib/importers/<broker>.ts` exportando:
   - `read<Broker>SheetRows(matriz): <Broker>RawRow[]`
   - `parse<Broker>Rows(rows, { fileName, fileHash }): ImportPreviewSummary`
   - Devolver siempre `NormalizedImportRow` con `status` + `messages` + `parsed?`.
4. **Dispatcher** — agregar la rama en `parseImportFile()` de `parse-workbook.ts`.
5. **Fixture** — guardar un export real anonimizado en `src/lib/importers/fixtures/`.

Nada más: el modal, la tabla de preview, la idempotencia y el commit son agnósticos del broker.

### Agregar un tipo de movimiento

1. Mapearlo en `resolveTransactionType()` de `balanz.ts`.
2. Si no necesita instrumento, sumarlo a `noInstrument` en `needsInstrument()`.
3. Agregar la clave a `TRANSACTION_TYPE_LABELS` (**obligatorio, el `Record` es exhaustivo**).
4. Decidir en qué filtro cae (`matchesImportFilter`).
5. Verificar quién más lo tiene que leer: transacciones (`TRADE_TYPES`), dividendos
   (`DIVIDEND_CASH` + `TAX_WITHHOLDING`), bonos (`COUPON` + `AMORTIZATION`).

### Implementar reversión de lote

1. Action `revertImportBatchAction(batchId)` con check de ownership.
2. En una `$transaction`: `deleteMany` de `Transaction` donde `importBatchId = batchId`, y
   `update` del batch a `status: REVERTED`.
3. `revalidatePath()` de `/imports`, `/transactions`, `/dashboard`, `/dividends`, `/bonds`.
4. Cuidado: si el usuario editó manualmente una transacción importada, el borrado la pierde.

### Escribir el primer test

```ts
import { parseBalanzFixtureRows } from "@/lib/importers/parse-workbook";
import { BALANZ_FIXTURE_ROWS } from "@/lib/importers/fixtures/balanz-movimientos";

const summary = parseBalanzFixtureRows(BALANZ_FIXTURE_ROWS, { fileName: "test.xlsx" });
expect(summary.stats.invalid).toBe(0);
```

Casos que valen la pena cubrir: la reclasificación CEDEAR→`TAX_WITHHOLDING`, el rechazo de
moneda desconocida, la derivación de precio con `Precio === -1`, y que
`"FCI Renta Fija"` **no** se importe como `COUPON`.
