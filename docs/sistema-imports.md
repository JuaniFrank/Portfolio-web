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

1. Parsear el export de movimientos de un broker a filas tipadas.
2. Mostrar una vista previa con estado por fila.
3. **Editar el import antes de guardarlo**: excluir filas y corregir a mano las que dan error.
4. **Detectar duplicados** (archivo completo y fila por fila) y dejar que el usuario decida.
5. Persistir en `Transaction` de forma idempotente y transaccional (todo o nada).
6. **Borrar movimientos ya importados**, individualmente o en bloque.

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
| `src/lib/importers/types.ts` | Tipos del pipeline (`RowPatch`, `DuplicateStrategy`, …) | ~95 |
| `src/lib/importers/registry.ts` | Catálogo de brokers soportados | 41 |
| `src/lib/importers/balanz.ts` | **Parser de Balanz** | 370 |
| `src/lib/importers/parse-workbook.ts` | Lectura del `.xlsx` + hash | 80 |
| `src/lib/importers/row-validation.ts` | **Re-validación de filas editadas** (puro) | ~245 |
| `src/lib/importers/duplicates.ts` | Tipos y helpers de duplicados (puro) | ~95 |
| `src/lib/importers/idempotency.ts` | Hash antiduplicado | 23 |
| `src/lib/importers/commit-import.ts` | Persistencia transaccional | ~380 |
| `src/lib/importers/fixtures/balanz-movimientos.ts` | Fixture para tests | — |
| `src/lib/imports/filters.ts` | Filtros y labels del listado | 106 |
| `src/app/actions/imports.ts` | 5 server actions | ~370 |
| `src/components/imports/import-modal.tsx` | Wizard con paso de edición | ~530 |
| `src/components/imports/import-edit-table.tsx` | **Tabla editable** | ~440 |
| `src/components/imports/import-duplicates-dialog.tsx` | **Modal de duplicados** | ~250 |
| `src/components/imports/delete-transactions-dialog.tsx` | **Confirmación de borrado** | ~130 |
| `src/components/imports/import-preview-table.tsx` | Tabla de vista previa | ~150 |
| `src/components/imports/file-dropzone.tsx` | Drag & drop | 61 |
| `src/components/imports/imported-transactions-table.tsx` | Listado con selección múltiple | ~270 |
| `src/components/imports/imports-list-page.tsx` | Página de listado | 39 |
| `src/components/imports/new-import-page.tsx` | Página de import nuevo | 40 |

### Modelos de datos usados

```prisma
model ImportBatch {
  id           String       @id @default(cuid())
  userId       String
  brokerId     String
  fileName     String
  fileHash     String                          // SHA-256 del buffer
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
  id                 String   @id @default(cuid())
  portfolioId        String
  brokerAccountId    String
  instrumentId       String?
  type               TransactionType
  tradeDate          DateTime
  settlementDate     DateTime?
  quantity           Decimal  @db.Decimal(20, 8)
  price              Decimal  @db.Decimal(20, 8)
  currencyCode       String
  grossAmount        Decimal  @db.Decimal(20, 8)
  netAmount          Decimal  @db.Decimal(20, 8)
  brokerFxRate       Decimal? @db.Decimal(20, 8)   // ← código de especie, NO cotización
  notes              String?
  source             TransactionSource @default(MANUAL)   // acá siempre IMPORT
  importBatchId      String?
  externalId         String?
  idempotencyHash    String
  idempotencyVersion Int      @default(1)              // ← habilita el re-import forzado
  @@unique([idempotencyHash, idempotencyVersion])
}

model Broker {
  id      String  @id @default(cuid())
  code    String  @unique
  name    String
  enabled Boolean @default(false)   // ← gate del import
}
```

---

## Flujo completo

```
Usuario suelta .xlsx en FileDropzone
   │
   ▼ ═══ CLIENTE ═══ (el archivo nunca viaja al servidor)
parse-workbook.ts → parseImportFile(brokerCode, file)
   ├─ file.arrayBuffer() + sha256Hex(buffer)
   ├─ XLSX.read(buffer, { type: "array", cellDates: false })
   └─ balanz.ts → readBalanzSheetRows() → parseBalanzRows() → ImportPreviewSummary
   │
   ▼  step "review" — resumen, o editor si el usuario toca [Editar]
   │     · excluir/incluir filas (checkbox)
   │     · corregir campos a mano → applyRowPatch() re-valida en el acto
   │
   ▼  [Importar N movimientos]
checkImportDuplicatesAction({ brokerCode, fileHash, brokerAccountId, rows })
   ├─ sin duplicados  →  commit directo con strategy "skip"
   └─ con duplicados  →  ImportDuplicatesDialog
                            ├─ [Omitir duplicados]  → strategy "skip"
                            └─ [Importar igual]     → strategy "import"
   │
   ▼ ═══ SERVIDOR ═══
commitImportAction({ …, duplicateStrategy })
   ├─ getCurrentUser()
   ├─ broker.enabled ?
   ├─ ensureDefaultImportTargets() si falta portfolio o cuenta
   └─ commitImportBatch()
        ═══ FUERA de la transacción ═══
        ├─ hashear todas las filas
        ├─ 1 query: versiones existentes por hash
        ├─ asignar idempotencyVersion (skip o bump según strategy)
        └─ resolveInstrumentsBatch()   (findMany + createMany)
        ═══ DENTRO de $transaction (timeout 15 s) ═══
        ├─ create ImportBatch (status COMMITTED, rawSummary con el detalle)
        └─ createMany Transaction
   │
   ▼
revalidatePath: /imports, /transactions, /dashboard, /dividends, /bonds
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

| Balanz | `InstrumentType` |
|---|---|
| Cedears | `CEDEAR` |
| Acciones | `STOCK_AR` |
| Bonos | `BOND_AR` |
| Letras | `LETRA` |
| Corporativos | `ON` |

### Mapeo de categoría → `TransactionType`

`Descripcion` viene partida por `/`. El primer segmento es la categoría.

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
| resto | `null` → fila `invalid` | "Tipo de movimiento no soportado: X" |

### ⚠️ El match de cupones es conservador a propósito

```ts
// "renta" está EXCLUIDO deliberadamente: matchea filas de FCI
// ("FCI Renta Fija", "FCI Renta Variable") y las importaría como COUPON.
// Eso es corrupción de datos, no un falso positivo cosmético.
const isCoupon = /cup[oó]n/i.test(descripcion);
```

**El string exacto que usa Balanz para cupones NO está confirmado.** Antes de ampliar el regex,
conseguí un export real que contenga un cupón y verificá. Documentado en `balanz.ts:117` y `:163`.

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
`/dividends` no podría emparejar la retención.

### Parseo de moneda

```ts
const BROKER_FX_FROM_CURRENCY = /D[oó]lares\s+C\.V\.\s+([\d.,]+)/i;
```

| Entrada | Resultado |
|---|---|
| `"Pesos"`, `"ARS"`, `"$"` | `{ currency: "ARS", brokerFxRate: null }` |
| `"Dólares C.V. 7000"` | `{ currency: "USD", brokerFxRate: "7000" }` |
| `"US Dollar (Cable)"`, `"Dólares"`, `"USD"`, `"U$S"` | `{ currency: "USD", brokerFxRate: null }` |
| cualquier otra | **lanza `Error`** → fila `invalid` |

> 🔑 **`brokerFxRate` NO es una cotización.** El `7000` es un código de especie que indica dólar
> cable de origen exterior. Se persiste solo por trazabilidad.

### Derivación de precio y fechas

```ts
const price = raw.Precio !== -1 && raw.Precio > 0
  ? new Decimal(raw.Precio).toFixed()
  : !quantity.isZero() ? net.abs().div(quantity).toFixed(8) : null;

function parseDate(value: string): string | null {
  const d = new Date(`${value}T12:00:00.000Z`);   // ← mediodía UTC
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
```

El anclaje al **mediodía UTC** evita que un corrimiento de zona horaria cambie el día
calendario. **El editor de filas usa la misma convención** (`dateInputToIso`).

---

## Editor de filas (paso intermedio)

El paso `review` tiene dos vistas sobre los mismos datos:

| Vista | Componente | Cuándo |
|---|---|---|
| Resumen | `ImportPreviewTable` | por defecto |
| Editor | `ImportEditTable` | al tocar **[Editar]** |

El botón **[Editar]** vive a la izquierda de **[Importar N movimientos]** en el footer del
modal, y muestra un contador de filas con error (`Editar (3)`). Alterna a **[Ver resumen]**.
El modal se ensancha (`max-w-[min(96vw,1400px)]`) mientras se edita.

### Estado en el modal

```ts
const [preview, setPreview] = useState<ImportPreviewSummary | null>(null); // inmutable: parser
const [rows, setRows] = useState<NormalizedImportRow[]>([]);               // copia de trabajo
const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());  // rowNumbers omitidos
const [editing, setEditing] = useState(false);
```

`preview` conserva la salida original del parser, lo que permite el **reset por fila**.

**Default seguro:** al cargar el archivo, las filas `invalid` arrancan **excluidas**. El usuario
puede corregirlas y se re-incluyen solas.

### Qué se puede hacer

| Acción | Cómo |
|---|---|
| Excluir/incluir una fila | Checkbox en la primera columna |
| Excluir/incluir todas las visibles | Checkbox del header |
| Omitir todas las que dan error | Botón `Omitir las N con error` |
| Incluir todas | Botón `Incluir todas` |
| Filtrar a las problemáticas | Toggle `Solo con problemas` |
| Corregir un campo | Input/select inline en la celda |
| Descartar los cambios de una fila | Icono ↺ (solo aparece si la fila fue editada) |

### Campos editables

Definidos por `RowPatch` en `src/lib/importers/types.ts`:

```ts
export type RowPatch = Partial<Pick<ParsedImportRowData,
  | "type" | "tradeDate" | "settlementDate" | "ticker" | "instrumentType"
  | "quantity" | "price" | "currencyCode" | "grossAmount" | "netAmount"
>>;
```

Todo lo demás en `ParsedImportRowData` (`externalId`, `description`, `brokerFxRate`) es derivado
del archivo y queda bajo control del parser.

### Re-validación (`src/lib/importers/row-validation.ts`)

Módulo **puro**, sin I/O. La pieza central:

```ts
export function applyRowPatch(row: NormalizedImportRow, patch: RowPatch): NormalizedImportRow
```

Hace tres cosas más allá de aplicar el patch:

1. **Normaliza el ticker** a mayúsculas y trim (`"" → null`), igual que el resto del pipeline.
2. **Sincroniza `settlementDate`** con `tradeDate` cuando venían iguales — el caso normal en Balanz.
3. **Sincroniza `grossAmount`** con `netAmount` salvo que el usuario edite gross explícitamente.
   El parser de Balanz llena ambos desde la misma columna `Importe`; editar uno y dejar el otro
   produce una fila silenciosamente inconsistente.

Después llama a `validateParsedRow` y marca `edited: true`.

```ts
export function validateParsedRow(parsed: ParsedImportRowData): { status; messages }
```

| Regla | Bloqueante |
|---|---|
| `type` ∈ `TransactionType` | sí |
| `tradeDate` / `settlementDate` parseables | sí |
| `currencyCode` ∈ `["ARS","USD"]` | sí |
| Ticker presente si el tipo lo requiere | sí |
| `instrumentType` presente si hay ticker | sí |
| `quantity` / `netAmount` / `grossAmount` decimales finitos | sí |
| `price` decimal finito si no es `null` | sí |
| `quantity === 0` en un movimiento con instrumento | **no** — solo aviso |

La convención de prefijos (`"Falta …"`, `"… inválido"`) es la misma que usa `balanz.ts`, así que
ambos caminos coinciden en qué bloquea un commit.

`needsInstrument()` acá incluye `FEE` además de `DEPOSIT`/`WITHDRAWAL`/`ADJUSTMENT`/
`TAX_WITHHOLDING` — el parser de Balanz no genera `FEE` todavía, pero el editor deja elegirlo.

### `computeRowStats`

Función pura que alimenta los contadores del editor, del resumen y de la pantalla final:

```ts
{ total, included, excluded, valid, warning, invalid, edited, committable }
```

`committable` = `!excluido && status !== "invalid" && tiene parsed`. Es exactamente lo que se
manda al servidor.

### Detalles de implementación

**Inputs no controlados con commit en blur/Enter.** Con cientos de filas, propagar cada tecla al
estado del modal re-valida y re-renderiza toda la tabla. El `key={value}` re-sincroniza el input
cuando el valor cambia desde afuera (reset de fila).

**`<select>` nativo, no el de Radix.** El de Radix abre un portal por celda: con cientos de filas
es caro e incómodo de tabular.

**Corregir re-incluye.** Editar una fila excluida la vuelve a incluir automáticamente — es lo que
el usuario pidió implícitamente al corregirla.

---

## Detección de duplicados

Corre **antes** del commit, como paso propio. Históricamente `commitImportBatch` omitía los
duplicados en silencio; ahora la decisión es del usuario.

### Dos señales independientes

`src/lib/importers/duplicates.ts` define el contrato:

```ts
export type DuplicateCheckResult = {
  sameFileBatches: DuplicateBatch[];   // 1) mismo fileHash ya importado
  duplicateRows: DuplicateRow[];       // 2) mismo idempotencyHash ya en Transaction
  freshCount: number;
  totalCount: number;
};

export function hasDuplicates(result: DuplicateCheckResult): boolean;
```

| Señal | Qué detecta | Limitación |
|---|---|---|
| **Archivo** (`fileHash`) | El mismo archivo exacto ya se importó | Un byte distinto y no matchea |
| **Fila** (`idempotencyHash`) | Movimientos concretos ya presentes | Es la señal autoritativa: detecta rangos de fechas superpuestos entre dos archivos distintos |

### `checkImportDuplicatesAction`

```ts
checkImportDuplicatesAction({ brokerCode, fileHash, brokerAccountId?, rows })
  → DuplicateCheckResult | { error }
```

**No escribe nada.** Detalle importante: el `idempotencyHash` incluye el `brokerAccountId`, así
que el chequeo tiene que usar exactamente la misma cuenta que va a usar el commit. Por eso
existe `findDefaultImportTargets()` — la versión **read-only** de `ensureDefaultImportTargets`.
Si todavía no hay cuenta, no puede haber colisiones y devuelve un resultado vacío en vez de
crear los targets por defecto.

Para cada hash puede haber varias transacciones (re-imports forzados previos). La action se
queda con la de **mayor `idempotencyVersion`** para poder calcular la próxima.

### El diálogo

`ImportDuplicatesDialog` muestra:

- Banner ámbar si el archivo completo ya se importó, con la lista de lotes anteriores
  (nombre, broker, fecha, cantidad de movimientos).
- Tres tiles: **filas del archivo · nuevas · ya existentes**.
- Tabla de las filas duplicadas: fecha, tipo, ticker, cantidad, importe, y **cuándo y desde qué
  archivo** se importó la original.
- Aviso si *todas* las filas están duplicadas.

Tres salidas:

| Botón | Qué hace |
|---|---|
| `Volver` | Cierra sin importar; el usuario puede seguir editando |
| `Importar igual (N)` | `duplicateStrategy: "import"` — inserta también las repetidas |
| `Omitir duplicados e importar N` | `duplicateStrategy: "skip"` — deshabilitado si `freshCount === 0` |

No hay default silencioso: el usuario elige.

### 🔑 Cómo se representa un re-import forzado

`Transaction` es único en `[idempotencyHash, idempotencyVersion]`. Forzar un duplicado **no
debilita la restricción**: incrementa la versión.

```ts
const storedMax = maxVersionByHash.get(hash) ?? 0;   // máximo ya en DB
const batchMax  = assignedInBatch.get(hash) ?? 0;    // máximo asignado en este lote
const collides  = storedMax > 0 || batchMax > 0;

if (collides && strategy === "skip") { skipped += 1; continue; }

const idempotencyVersion = Math.max(storedMax, batchMax) + 1;
```

El `assignedInBatch` cubre también el caso de dos filas idénticas dentro del mismo archivo.

`rawSummary` del `ImportBatch` guarda el detalle de la decisión:

```json
{ "valid": 120, "imported": 118, "skipped": 2,
  "duplicatesImported": 0, "editedRows": 3, "duplicateStrategy": "skip" }
```

---

## Idempotencia

`src/lib/importers/idempotency.ts` — SHA-256 de:

```
brokerAccountId | externalId | tradeDate | type | ticker | currencyCode | quantity | netAmount | rowNumber
```

**`rowNumber` está incluido a propósito.** Permite dos filas idénticas dentro del mismo archivo
(operaciones repetidas legítimas el mismo día, mismo precio) pero bloquea reimportar el mismo
archivo.

Consecuencias a tener en cuenta:

- Si Balanz reordena las filas entre dos exports del mismo período, los hashes cambian y podrías
  duplicar. Trade-off consciente. La detección por `fileHash` no cubre ese caso, pero la tabla de
  duplicados por fila sí mostraría las que sí coincidan.
- **Editar una fila cambia su hash** (cambia `tradeDate`, `ticker`, `quantity` o `netAmount`).
  Es correcto: una fila corregida es un movimiento distinto del que reportó el archivo.

---

## Persistencia (`commit-import.ts`)

### Estructura: reads afuera, writes adentro

```ts
const TRANSACTION_TIMEOUT_MS = 15_000;
```

**Fuera de la transacción:**

1. Validar que la cuenta y el portfolio pertenezcan al usuario.
2. Filtrar `status !== "invalid" && parsed` (defensa: el cliente ya filtró).
3. Hashear todas las filas.
4. **Una sola query** de versiones existentes por hash.
5. Asignar `idempotencyVersion` según la estrategia.
6. `resolveInstrumentsBatch()`.

**Dentro de `$transaction`:** solo 3 statements → `create` del `ImportBatch` + `createMany` de
`Transaction`. Corre en milisegundos sin importar el volumen. El timeout de 15 s es margen.

### `resolveInstrumentsBatch`

Un `findMany` por tickers + un `createMany` con `skipDuplicates` para los faltantes + un segundo
`findMany` para recuperar los ids. Devuelve `Map<clave, instrumentId>`.

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

> ⚠️ Duplicada como `venueForType()` en `src/app/actions/transactions.ts`. Tienen que resolver
> igual, si no el alta manual y el import crearían instrumentos distintos para el mismo activo.

### Manejo de errores

```ts
catch (error) {
  console.error("commitImportBatch", error);
  return { ok: false, error: "No se guardó ningún movimiento. Revisá el archivo y volvé a intentar." };
}
```

La transacción hizo rollback: nada quedó persistido, reintentar es seguro.

---

## Borrado de movimientos importados

### La UI

`ImportedTransactionsTable` tiene selección múltiple estilo historial de transacciones:

- Checkbox por fila y checkbox en el header (**selecciona solo las visibles según el filtro
  activo**, no todo el dataset).
- Barra de acciones teal que aparece cuando hay selección: contador + `Limpiar` + `Borrar
  seleccionadas`.
- Las filas seleccionadas se resaltan con `bg-teal-950/20`.
- Borrado optimista: los ids borrados se ocultan de inmediato (`removedIds`) y después
  `router.refresh()` trae la lista real.

`DeleteTransactionsDialog` confirma enumerando consecuencias en vez de un "¿estás seguro?"
genérico: muestra hasta 5 movimientos de ejemplo, avisa que se recalculan posiciones, dividendos
y dashboard, y aclara que el borrado **libera el control de duplicados** de esas filas.

### La action

```ts
deleteImportedTransactionsAction(ids: string[]) → { ok: true; deleted } | { ok: false; error }
```

```
1. getCurrentUser()
2. Deduplicar ids; cortar si está vacío o supera MAX_BULK_IDS (2000)
3. findMany con scope: id ∈ ids AND source = IMPORT AND portfolio.userId = user.id
   → verifica pertenencia Y junta los importBatchId afectados
4. $transaction:
     deleteMany de los ids verificados
     por cada lote afectado: contar restantes y actualizar
       rowsImported = restantes
       status = restantes === 0 ? REVERTED : COMMITTED
5. revalidar /imports, /transactions, /dashboard, /dividends, /bonds
```

Dos decisiones:

- **Scope acotado a `source = IMPORT`.** Las operaciones cargadas a mano no se tocan desde acá.
- **Los contadores del lote se recalculan.** Si no, el historial seguiría declarando filas que ya
  no existen. Un lote que queda vacío pasa a `REVERTED` — el primer uso real de ese estado del enum.

---

## Server actions (`src/app/actions/imports.ts`)

| Action | Firma | Escribe |
|---|---|---|
| `getImportContextAction()` | `→ ImportContextData \| { error }` | no |
| `checkImportDuplicatesAction(input)` | `→ DuplicateCheckResult \| { error }` | **no** |
| `commitImportAction(input)` | `→ { ok, importBatchId, imported, skipped, duplicatesImported } \| { ok: false, error }` | sí |
| `getImportedTransactionsAction()` | `→ ImportedTransactionRow[] \| { error }` | no |
| `deleteImportedTransactionsAction(ids)` | `→ { ok, deleted } \| { ok: false, error }` | sí |

Las dos mutaciones invalidan las **cinco** rutas que leen `Transaction`:

```ts
function revalidateImportConsumers() {
  revalidatePath("/imports");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/dividends");
  revalidatePath("/bonds");
}
```

> Si agregás una pantalla que use holdings, sumala a esa función.

---

## Componentes

### `ImportModal` — el wizard

```ts
type Step = "upload" | "review" | "committing" | "done";
```

| Paso | Contenido | Footer |
|---|---|---|
| `upload` | Select de broker + `FileDropzone` + barra indeterminada | Cancelar |
| `review` | Archivo + `Cambiar archivo` + selects de portfolio/cuenta + resumen **o** editor | Cancelar · **Editar (N)** · `Importar N movimientos` |
| `committing` | Spinner + barra + "No cierres esta ventana" | Cancelar (disabled) · Guardando… |
| `done` | Resumen desglosado en verde | Cerrar |

El paso `done` desglosa: guardados · omitidos por duplicados · importados pese a estar
repetidos · excluidos manualmente · corregidos a mano.

**Sin `useEffect` de sincronización.** Los targets (portfolio, cuenta) se inicializan de forma
perezosa con `useState(() => …)` y el reset ocurre en `handleClose`. Llamar `setState` dentro de
un efecto dispara renders en cascada y lo marca `react-hooks/set-state-in-effect`.

`resetFile()` descarta el archivo y todo lo derivado, pero **no** toca portfolio ni cuenta: son
selecciones que conviene conservar entre imports.

### Otros

| Componente | Rol |
|---|---|
| `FileDropzone` | `<label>` con input `sr-only`, maneja drag & drop, toma el primer archivo |
| `ImportPreviewTable` | Resumen de solo lectura. Acepta `rows`/`excluded` para reflejar las ediciones. Marca las omitidas con badge 👁 y las editadas con ✏️ |
| `ImportEditTable` | Tabla editable (ver arriba) |
| `ImportDuplicatesDialog` | Aviso de duplicados (ver arriba) |
| `DeleteTransactionsDialog` | Confirmación de borrado (ver arriba) |
| `ImportedTransactionsTable` | Listado con filtros + selección múltiple |

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

Dos diccionarios que se reutilizan en varias pantallas:

- **`TRANSACTION_TYPE_LABELS`** — `Record<TransactionType, string>` **exhaustivo**. Si agregás un
  `TransactionType` al enum de Prisma, **esto no compila** hasta que agregues la clave.
  Lo usan el editor, el diálogo de duplicados, el listado y el historial de transacciones.
- **`INSTRUMENT_TYPE_LABELS`** — `Partial<Record<InstrumentType, string>>`.

---

## Registry de brokers

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
| 1 | **El string exacto de cupón de Balanz no está confirmado.** Ampliar el regex sin verificar corrompe filas de FCI |
| 2 | **No hay reversión de lote completo.** Un lote solo pasa a `REVERTED` cuando se borran todas sus filas una por una. Falta el botón "deshacer import" (ver Propuesta B) |
| 3 | **No hay vista de lotes.** `ImportBatch` acumula historial que ninguna pantalla muestra |
| 4 | **Las correcciones manuales no se recuerdan.** Si el mismo ticker desconocido aparece en el próximo import, hay que corregirlo de nuevo (ver Propuesta A) |
| 5 | **El parseo en cliente hace que el payload de la action crezca** con el tamaño del extracto. Un archivo muy largo puede chocar con límites de tamaño de request |
| 6 | `venueFor()` duplicada con `venueForType()` |
| 7 | Los instrumentos creados por el import quedan con `name = ticker` hasta que el sync de catálogo los renombre (y solo si están en `CURATED_INSTRUMENT_NAMES`) |
| 8 | `resolveInstrumentsBatch` busca por `ticker in [...]` y filtra en memoria por la clave completa — trae de más si hay tickers repetidos entre tipos |
| 9 | **`ImportBatch.rowsTotal` cuenta las filas enviadas, no las del archivo.** Con exclusiones manuales, el lote no registra cuántas filas tenía el `.xlsx` original |
| 10 | El editor no permite editar filas sin `parsed` (las que el parser no pudo interpretar) — solo omitirlas |
| 11 | Sin tests. `row-validation.ts`, `duplicates.ts` y `balanz.ts` son puros; `fixtures/balanz-movimientos.ts` y `parseBalanzFixtureRows()` ya están listos |
| 12 | `marketRights` y `fxRateToBaseCurrency` existen en el schema; el importer no los llena |
| 13 | Warning de lint pre-existente en `balanz.ts:5`: `BrokerImportCode` importado y sin usar |

---

## Propuestas de próximas funcionalidades

### A. Reglas de corrección reutilizables (`ImportRule`)

**Problema:** el editor genera conocimiento que hoy se tira. Si corregís que `"Corporativos"` con
ticker `XYZ0` es en realidad una `ON` en USD, el próximo import vuelve a fallar igual.

**Propuesta:** persistir cada corrección como regla y aplicarla automáticamente en el parseo.

```prisma
model ImportRule {
  id        String   @id @default(cuid())
  userId    String
  brokerId  String?              // null = aplica a todos los brokers
  // Condición
  matchField  String             // "ticker" | "descripcion" | "tipoInstrumento"
  matchValue  String
  // Corrección
  patch     Json                 // RowPatch serializado
  hits      Int      @default(0) // cuántas veces se aplicó
  createdAt DateTime @default(now())
  @@unique([userId, brokerId, matchField, matchValue])
}
```

Flujo: al guardar un import con filas editadas, ofrecer *"Recordar estas 3 correcciones para
próximos imports"*. En el siguiente parseo, `applyRules(rows, rules)` corre después del parser y
antes de mostrar el preview, marcando las filas tocadas con un badge distinto (`Regla aplicada`).

**Por qué vale:** convierte trabajo manual en algo que se amortiza. Es la evolución natural del
editor y reutiliza `RowPatch` y `applyRowPatch` tal cual están.

**Esfuerzo:** medio. Un modelo, dos actions (listar/guardar reglas), un paso en el pipeline de
parseo y una pantalla simple de gestión en `/settings` o `/imports`.

---

### B. Vista de lotes con reversión y detección de huecos

**Problema:** `ImportBatch` acumula historial que ninguna pantalla muestra, y el error más caro
de un portfolio manager es el **import parcial** — importaste enero y marzo, falta febrero, y el
PPP queda mal en silencio. Nada te avisa.

**Propuesta:** una tab `Lotes` en `/imports` con dos capacidades.

**1. Historial y reversión.** Tabla de `ImportBatch`: archivo, broker, fecha, filas importadas /
omitidas, estado. Botón **Deshacer** por lote → borra sus transacciones y lo marca `REVERTED`.
Es una generalización del borrado por fila que ya existe, y usa el estado del enum que hoy solo
se escribe por accidente.

**2. Detección de huecos temporales.** Con las `tradeDate` de las transacciones importadas se
puede reconstruir la cobertura por broker y detectar meses sin movimientos entre el primero y el
último:

```
Cobertura Balanz:  2025-03 ──────────── 2026-07
                              ▲
                   ⚠ Sin movimientos en 2025-11 y 2025-12
                     ¿Faltó importar ese período?
```

Un banner en `/imports` cuando aparece un hueco de un mes o más dentro del rango cubierto.

**Por qué vale:** la reversión cierra el ciclo de vida del lote (hoy solo se puede crear y borrar
filas sueltas), y la detección de huecos ataca un error silencioso que corrompe posiciones,
dividendos y dashboard a la vez. La lógica de huecos es pura y testeable: entra una lista de
fechas, sale una lista de períodos faltantes.

**Esfuerzo:** bajo-medio. No requiere cambios de schema — `ImportBatch` ya tiene todo, y los
huecos se derivan de `Transaction.tradeDate`.

---

## Cómo extender

### Agregar un broker nuevo

1. **Registry** — sumar la entrada a `BROKER_IMPORTERS` con `enabled: true`, `fileKinds`, `accept`.
2. **DB** — insertar la fila en `Broker` con `enabled: true` (o agregarla al seed).
3. **Parser** — crear `src/lib/importers/<broker>.ts` exportando:
   - `read<Broker>SheetRows(matriz): <Broker>RawRow[]`
   - `parse<Broker>Rows(rows, { fileName, fileHash }): ImportPreviewSummary`
   - Devolver siempre `NormalizedImportRow` con `status` + `messages` + `parsed?`.
4. **Dispatcher** — agregar la rama en `parseImportFile()` de `parse-workbook.ts`.
5. **Fixture** — guardar un export real anonimizado en `src/lib/importers/fixtures/`.

El modal, el editor, la detección de duplicados, la idempotencia y el commit son **agnósticos del
broker**: no hay que tocar nada de eso.

> Ojo: `NormalizedImportRow.raw` está tipado como `BalanzRawRow`. Para un segundo broker hay que
> generalizarlo (union o genérico). Es el único acoplamiento que queda.

### Agregar un tipo de movimiento

1. Mapearlo en `resolveTransactionType()` de `balanz.ts`.
2. Si no necesita instrumento, sumarlo a `NO_INSTRUMENT_TYPES` en `row-validation.ts`
   **y** a `noInstrument` en `balanz.ts` (están duplicados a propósito: uno valida el archivo,
   el otro las ediciones).
3. Agregar la clave a `TRANSACTION_TYPE_LABELS` (**obligatorio, el `Record` es exhaustivo**).
4. Decidir en qué filtro cae (`matchesImportFilter`).
5. Verificar quién más lo tiene que leer: transacciones (`TRADE_TYPES`), dividendos
   (`DIVIDEND_CASH` + `TAX_WITHHOLDING`), bonos (`COUPON` + `AMORTIZATION`).

### Agregar un campo editable

1. Sumarlo al `Pick` de `RowPatch` en `types.ts`.
2. Agregar su regla en `validateParsedRow`.
3. Si tiene que mantenerse en sync con otro campo, agregarlo a `applyRowPatch`.
4. Agregar la celda en `ImportEditTable` (usá `CellInput` o `CellSelect`).

### Escribir el primer test

```ts
import { applyRowPatch, validateParsedRow } from "@/lib/importers/row-validation";
import { parseBalanzFixtureRows } from "@/lib/importers/parse-workbook";
import { BALANZ_FIXTURE_ROWS } from "@/lib/importers/fixtures/balanz-movimientos";

// Parser
const summary = parseBalanzFixtureRows(BALANZ_FIXTURE_ROWS, { fileName: "test.xlsx" });

// Editor: una fila sin ticker pasa a válida al completarlo
const broken = summary.rows.find((r) => r.messages.some((m) => m.startsWith("Falta")));
const fixed = applyRowPatch(broken!, { ticker: "ggal", instrumentType: "STOCK_AR" });
// fixed.status === "valid", fixed.parsed.ticker === "GGAL", fixed.edited === true
```

Casos que valen la pena cubrir:

- La reclasificación CEDEAR → `TAX_WITHHOLDING`.
- El rechazo de moneda desconocida.
- La derivación de precio con `Precio === -1`.
- Que `"FCI Renta Fija"` **no** se importe como `COUPON`.
- Que `applyRowPatch` sincronice `grossAmount` con `netAmount`.
- Que editar `tradeDate` arrastre `settlementDate` solo si venían iguales.
- Que `computeRowStats().committable` ignore excluidas e inválidas.
