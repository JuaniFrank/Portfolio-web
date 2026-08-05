# Sistema de eventos corporativos

> **Documento autocontenido.** Todo lo necesario para trabajar en splits, cambios de ratio
> CEDEAR y ajustes de posiciones históricas está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router, server actions) · Prisma · decimal.js · Zod + React Hook Form.
- **Ruta:** `/events`.
- **Idea central:** el evento **no muta transacciones**. El ajuste se aplica en tiempo de
  agregación, cada vez que se construyen holdings. Eso lo hace reversible y consistente entre
  todas las pantallas.

### Qué hace este sistema

Registrar eventos corporativos (split, cambio de ratio CEDEAR, spin-off, fusión, cambio de
ticker) que afectan las operaciones **anteriores** a la fecha efectiva, previsualizar el impacto
antes de guardar, y ofrecer eventos curados aplicables con un click.

---

## Pantalla `/events`

```
src/app/(app)/events/page.tsx
  → Promise.all([listCorporateEvents(), listPortfolioInstruments()])
  → si alguno tiene "error" → redirect("/login")
  → <EventsPage initialEvents={...} instruments={...} />
```

```
┌ 🔄 Eventos Corporativos ─────────────── [ + Registrar evento ] ┐
│   "Splits, ratios y ajustes que afectan tus posiciones…"       │
├────────────────────────────────────────────────────────────────┤
│  Total eventos  │  Último evento  │  Instrumentos              │  ← 3 KPIs
├────────────────────────────────────────────────────────────────┤
│  💡 Eventos sugeridos                              [ Aplicar ] │  ← RecommendedEvents
├────────────────────────────────────────────────────────────────┤
│  Tabla: Ticker · Tipo · Fecha efectiva · Ratio · Notas · 🗑     │  ← EventsList
└────────────────────────────────────────────────────────────────┘
```

**Estado local optimista:** `EventsPage` mantiene `events` en `useState` inicializado con
`initialEvents`. Crear y borrar actualizan el array en cliente sin recargar la página
(aunque las actions igual hacen `revalidatePath`).

Los KPIs y las recomendaciones se **recalculan en cada render** a partir de ese array, así que
al aplicar una sugerencia esta desaparece sola.

---

## Archivos

| Archivo | Rol | Líneas |
|---|---|---|
| `src/lib/events/types.ts` | `CorporateEventForBuilder`, `CorporateEventDTO`, `ProjectedPosition` | 48 |
| `src/lib/events/apply.ts` | **`applyEventsToTrade` — la regla de ajuste** | 43 |
| `src/lib/events/validations.ts` | Schema Zod | 22 |
| `src/lib/events/constants.ts` | `HOLDABLE_TRADE_TYPES` | 4 |
| `src/lib/events/recommended.ts` | Eventos curados + resolución de aplicables | 88 |
| `src/app/actions/events.ts` | 5 server actions | 330 |
| `src/components/events/events-page.tsx` | Página | 104 |
| `src/components/events/events-list.tsx` | Tabla | 59 |
| `src/components/events/event-form-dialog.tsx` | Modal de alta en 2 pasos | 318 |
| `src/components/events/event-delete-dialog.tsx` | Confirmación de borrado | 79 |
| `src/components/events/recommended-events.tsx` | Cards de sugerencias | 89 |
| `src/components/events/format.ts` | `formatRatio`, `formatEventTypeLabel` | 27 |

### Modelo de datos

```prisma
enum CorporateEventType {
  CEDEAR_RATIO_CHANGE
  STOCK_SPLIT
  REVERSE_SPLIT
  SPINOFF
  MERGER
  TICKER_CHANGE
}

model CorporateEvent {
  id              String             @id @default(cuid())
  instrumentId    String
  instrument      Instrument         @relation(fields: [instrumentId], references: [id], onDelete: Cascade)
  eventType       CorporateEventType
  effectiveDate   DateTime
  numerator       Decimal            @db.Decimal(20, 8)
  denominator     Decimal            @db.Decimal(20, 8)
  notes           String?
  appliedAt       DateTime           @default(now())
  createdByUserId String
  createdByUser   User               @relation("CorporateEventCreator", fields: [createdByUserId], references: [id])

  @@unique([instrumentId, effectiveDate, eventType])
  @@index([instrumentId])
  @@index([createdByUserId])
}
```

El `@@unique` compuesto evita registrar dos veces el mismo evento. La action captura P2002 y
devuelve un mensaje amigable.

---

## 🔑 La regla de ajuste

`src/lib/events/apply.ts` — 43 líneas que definen todo el comportamiento del sistema.

```ts
export function applyEventsToTrade(
  trade: TradeForHoldings,
  events: CorporateEventForBuilder[]      // ← DEBEN venir ordenados asc por effectiveDate
): TradeForHoldings {
  const tradeDay = trade.tradeDate.slice(0, 10);   // "YYYY-MM-DD"

  let quantity = new Decimal(trade.quantity);
  let price = new Decimal(trade.price);

  for (const event of events) {
    if (tradeDay >= event.effectiveDate) continue;   // post-evento: no se ajusta
    if (event.eventType === "TICKER_CHANGE") continue; // no-op

    const ratio = new Decimal(event.numerator).div(new Decimal(event.denominator));
    quantity = quantity.mul(ratio);
    price = price.div(ratio);
  }

  return { ...trade, quantity: quantity.toString(), price: price.toString() };
  // netAmount NO se toca
}
```

### Las cuatro invariantes

1. **`netAmount` es invariante.** Solo cambian `quantity` y `price`. Lo que pagaste es lo que
   pagaste — un split no te devuelve ni te cobra plata. Esto es lo que mantiene el costo total
   estable y el PPP correcto.
2. **Solo se ajustan los trades pre-evento** (`tradeDate < effectiveDate`). Las operaciones
   posteriores ya se hicieron al ratio nuevo.
3. **La comparación de fechas es lexical** sobre `YYYY-MM-DD`. Funciona porque el formato ISO
   ordena alfabéticamente igual que cronológicamente. Evita líos de zona horaria.
4. **Los eventos deben venir ordenados ascendente.** Es responsabilidad del caller — todas las
   actions lo garantizan con `orderBy: { effectiveDate: "asc" }`. Con varios eventos, los ratios
   se componen multiplicativamente.

### Por qué se aplica en agregación y no en la DB

| Ventaja | Detalle |
|---|---|
| **Reversible** | Borrar el evento restaura las posiciones originales. Sin migración inversa |
| **Consistente** | Dashboard, transacciones y dividendos pasan el mismo `eventsMap` a `buildHoldings` — todos ven lo mismo |
| **Auditable** | La `Transaction` original queda intacta: siempre podés ver qué reportó el broker |
| **Previsualizable** | Se puede correr el cálculo con y sin el evento (eso es `previewCorporateEvent`) |

**Costo:** hay que pasar el `eventsMap` en cada llamada a `buildHoldings`. Si te olvidás, los
números salen sin ajustar y nada te avisa.

---

## Integración con `buildHoldings`

`src/lib/transactions/holdings.ts`:

```ts
export function buildHoldings(
  trades: TradeForHoldings[],
  latestPrices: Map<string, string>,
  events?: Map<string, CorporateEventForBuilder[]>   // ← opcional, omitirlo es no-op
): HoldingRow[] {
  for (const t of trades) {
    const instrumentEvents = events?.get(t.instrumentId);
    const adjusted = instrumentEvents?.length ? applyEventsToTrade(t, instrumentEvents) : t;
    // …agrupar por instrumentId y calcular PPP sobre `adjusted`
  }
}
```

### Quién pasa el `eventsMap`

| Action | ¿Pasa eventos? |
|---|---|
| `getDashboardPageDataAction` | ✅ |
| `getTransactionsPageDataAction` | ✅ |
| `getDividendsPageDataAction` | ✅ |
| `previewCorporateEvent` | ✅ (con y sin el evento nuevo) |
| `getBondsPageDataAction` | ❌ — las ONs no pasan por `buildHoldings` |

El bloque que arma el mapa está **copiado literalmente** en las tres primeras actions:

```ts
const eventsMap = new Map<string, CorporateEventForBuilder[]>();
for (const e of eventRows) {
  const list = eventsMap.get(e.instrumentId) ?? [];
  list.push({
    instrumentId: e.instrumentId,
    eventType: e.eventType,
    effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
    numerator: e.numerator.toString(),
    denominator: e.denominator.toString(),
  });
  eventsMap.set(e.instrumentId, list);
}
```

Candidato obvio a extraer a un helper compartido.

Y la query también se repite:

```ts
prisma.corporateEvent.findMany({
  where: { instrument: { transactions: { some: { portfolio: { userId: user.id } } } } },
  orderBy: { effectiveDate: "asc" },
  select: { instrumentId, eventType, effectiveDate, numerator, denominator },
})
```

---

## Server actions (`src/app/actions/events.ts`)

| Action | Firma | Escribe |
|---|---|---|
| `listPortfolioInstruments()` | `→ { id, ticker, name }[] \| { error }` | no |
| `listCorporateEvents()` | `→ CorporateEventDTO[] \| { error }` | no |
| `previewCorporateEvent(input)` | `→ { ok, current, projected } \| { ok: false, error }` | **no** |
| `createCorporateEvent(input)` | `→ { ok, event } \| { ok: false, error }` | sí |
| `deleteCorporateEvent(id)` | `→ { ok } \| { ok: false, error }` | sí (hard delete) |

### `listPortfolioInstruments`

Instrumentos que tienen al menos una transacción del usuario. Alimenta el picker del form.

```ts
where: { transactions: { some: { portfolio: { userId: user.id } } } }
orderBy: { ticker: "asc" }
distinct: ["id"]
```

### `previewCorporateEvent` — cómputo puro, cero escritura

Es la parte más interesante del sistema:

```
1. Validar con Zod
2. Verificar que el instrumento tenga transacciones del usuario
3. Traer los trades BUY/SELL de ese instrumento (HOLDABLE_TRADE_TYPES)
4. Traer los eventos YA existentes del instrumento
5. currentHoldings   = buildHoldings(trades, {}, { id → eventosExistentes })
6. mergedEvents      = [...existentes, nuevo].sort(por effectiveDate)   ← ¡el sort importa!
   projectedHoldings = buildHoldings(trades, {}, { id → mergedEvents })
7. Devolver { current, projected } como ProjectedPosition
```

Pasa un `Map` de precios **vacío** porque el preview solo compara cantidad y PPP — no necesita
valor de mercado.

El `sort` del paso 6 es obligatorio: `applyEventsToTrade` asume orden ascendente.

```ts
export type ProjectedPosition = {
  instrumentId: string;
  ticker: string;
  quantity: string;
  avgPriceArs: string;
  costBasisArs: string;   // ← invariante entre current y projected
};
```

### `createCorporateEvent`

```
1. getCurrentUser()
2. Zod
3. Verificar ownership del instrumento (tiene transacciones del usuario)
4. prisma.corporateEvent.create({ ..., createdByUserId: user.id })
5. revalidatePath × 4:  /events, /dashboard, /transactions, /dividends
6. Devolver el DTO
```

Captura P2002 y devuelve:
*"Ya existe un evento de este tipo para el instrumento en esa fecha."*

> Los **4 `revalidatePath`** no son opcionales: un evento cambia las posiciones en las tres
> pantallas que las muestran. Si agregás una pantalla nueva que use `buildHoldings`, sumala acá.

### `deleteCorporateEvent`

Hard delete, con verificación por `createdByUserId`:

```ts
const event = await prisma.corporateEvent.findFirst({ where: { id, createdByUserId: user.id } });
if (!event) return { ok: false, error: "Evento no encontrado." };
await prisma.corporateEvent.delete({ where: { id } });
```

El mensaje es deliberadamente vago (no distingue "no existe" de "no es tuyo") para no filtrar
existencia.

Revalida las mismas 4 rutas.

> Nota: la autorización de borrado es por **creador** (`createdByUserId`), mientras que la de
> creación es por **tenencia del instrumento**. Con un solo usuario da igual; con varios, alguien
> podría no poder borrar un evento sobre un instrumento que sí tiene.

---

## Validación (`src/lib/events/validations.ts`)

```ts
export const newEventInputSchema = z.object({
  instrumentId: z.string().min(1, "Instrumento requerido"),
  eventType: z.nativeEnum(CorporateEventType),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  numerator: z.string().refine((v) => Number(v) > 0, "El numerador debe ser mayor a 0"),
  denominator: z.string().refine((v) => Number(v) > 0, "El denominador debe ser mayor a 0"),
  notes: z.string().max(500).optional().nullable(),
});
```

Numerador y denominador viajan como **string** (se guardan en `Decimal`), validados con
`Number(v) > 0`. No se exige que sean enteros.

`HOLDABLE_TRADE_TYPES` (`src/lib/events/constants.ts`) = `["BUY", "SELL"]` — los tipos que
producen posición, usados en el preview.

---

## Eventos recomendados

`src/lib/events/recommended.ts`.

```ts
export const RECOMMENDED_EVENTS: RecommendedEvent[] = [
  {
    ticker: "SPY",
    eventType: CorporateEventType.CEDEAR_RATIO_CHANGE,
    effectiveDate: "2026-06-01",
    numerator: "3",
    denominator: "1",
    notes: "Cambio de ratio CEDEAR SPY de 20:1 a 60:1 (01/06/2026).",
    title: "Cambio de ratio — SPY",
    description: "El CEDEAR de SPY pasó de 20:1 a 60:1 el 01/06/2026. Las operaciones anteriores " +
                 "a esa fecha se ajustan ×3 en cantidad (y el precio se divide por 3). " +
                 "El importe pagado no cambia.",
  },
];
```

Hoy tiene **una** entrada. Son eventos públicos y estables del mercado argentino cuyos
parámetros no dependen del usuario.

```ts
export function resolveApplicableRecommendations(
  instruments: InstrumentLike[],       // los del portfolio del usuario
  existingEvents: ExistingEventLike[]  // los ya registrados
): ApplicableRecommendation[]
```

Una recomendación aplica si:

1. El usuario **tiene el instrumento** (match de ticker case-insensitive), y
2. **No** existe ya un evento con mismo `instrumentId` + `effectiveDate` + `eventType`.

Es una función pura, se recalcula en cada render de `EventsPage`. Al aplicar una sugerencia,
el evento entra al array `events` y la card desaparece sin refetch.

Aplicar una recomendación llama a `createCorporateEvent` con los mismos parámetros — **no hay
camino especial**. Es un atajo de UI, no una entidad distinta.

---

## Componentes

### `EventFormDialog` — alta en 2 pasos

```ts
type Step = "form" | "preview";
```

**Paso `form`** — React Hook Form + `zodResolver(newEventInputSchema)`:

| Campo | Control | Default |
|---|---|---|
| Instrumento | `Select` con `TICKER — Nombre` | — |
| Tipo | `Select` con los 6 `CorporateEventType` (labels en español) | — |
| Fecha efectiva | `<input type="date">` | hoy |
| Ratio | Dos `<input type="number" min="1" step="1">` separados por `:` | `1` : `1` |
| Notas | `<textarea rows={2} maxLength={500}>` | — |

Submit → `previewCorporateEvent(data)` → si `ok`, guarda el input y pasa a `preview`.

**Paso `preview`** — dos columnas lado a lado:

```
┌ Actual ─────────────┬ Proyectado ──────────┐
│ Cantidad   1.000    │ Cantidad   3.000     │
│ PPP ARS    300,00   │ PPP ARS    100,00    │
└─────────────────────┴──────────────────────┘
        "Costo total en ARS se mantiene invariante"
```

Botones: `Atrás` (vuelve al form conservando los datos) · `Confirmar` (llama a
`createCorporateEvent`).

Si `current` es `null` (el usuario no tiene posición abierta), la columna muestra `—`.

### `EventsList`

Tabla HTML plana (no usa `components/ui/table`). Columnas: Ticker · Tipo · Fecha efectiva ·
Ratio (`N:D` en mono) · Notas (truncadas con `title`) · Acciones.

Empty state: *"No hay eventos registrados."*

### `EventDeleteDialog`

Botón `Trash2` fantasma que abre un `Dialog` de confirmación:
*"¿Eliminar este evento? Esta acción no se puede deshacer."*
Al confirmar: `deleteCorporateEvent` → toast → `onDeleted(id)` para actualizar el estado del padre.

### `RecommendedEvents`

Devuelve `null` si no hay recomendaciones (no ocupa espacio).

Cada card (borde teal): título, descripción, chips con ticker / fecha efectiva / ratio, y botón
`Aplicar` que muestra "Aplicando…" mientras corre.

### `format.ts`

```ts
formatRatio(numerator, denominator)  // → "3:1"

formatEventTypeLabel(type)
// CEDEAR_RATIO_CHANGE → "Ratio CEDEAR"
// STOCK_SPLIT         → "Split"
// REVERSE_SPLIT       → "Reverse Split"
// SPINOFF             → "Spin-off"
// MERGER              → "Fusión"
// TICKER_CHANGE       → "Cambio de ticker"
```

---

## Ejemplo completo: cambio de ratio de SPY

**Situación:** compraste 100 CEDEARs de SPY a $300 el 2026-01-15. El 2026-06-01 el ratio pasó
de 20:1 a 60:1 (te dan 3 CEDEARs por cada 1 que tenías).

**Evento:** `CEDEAR_RATIO_CHANGE`, `effectiveDate: 2026-06-01`, `numerator: 3`, `denominator: 1`.

**Ajuste** (`tradeDate 2026-01-15 < 2026-06-01`, así que aplica):

```
ratio = 3 / 1 = 3
quantity: 100 × 3 = 300
price:    300 / 3 = 100
netAmount: 30.000  ← SIN CAMBIOS
```

**Posición resultante:** 300 unidades, PPP $100, costo total $30.000.
Antes del evento: 100 unidades, PPP $300, costo total $30.000. **El costo no se movió.**

Si comprás 50 más el 2026-07-01 (post-evento), esas no se ajustan y entran al promedio al precio
que pagaste.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **`SPINOFF` y `MERGER` usan la misma matemática que un split.** Un spin-off real reparte costo entre dos instrumentos, no escala uno — el modelo actual no lo representa |
| 2 | **`TICKER_CHANGE` es no-op.** Se registra pero no unifica el histórico bajo el ticker nuevo: quedan dos `Instrument` separados |
| 3 | **No se puede editar un evento.** Solo crear y borrar |
| 4 | **Los eventos son globales por instrumento, no por usuario.** El `@@unique` es `[instrumentId, effectiveDate, eventType]`. Con multiusuario, el evento de uno afecta las posiciones de todos los que tengan ese instrumento |
| 5 | **Autorización asimétrica:** crear valida tenencia del instrumento, borrar valida `createdByUserId` |
| 6 | **Los bonos no reciben ajustes.** `getBondsPageDataAction` no pasa `eventsMap` (razonable hoy — las ONs no hacen splits — pero es una asimetría a recordar) |
| 7 | **El `eventsMap` está duplicado** en 3 actions |
| 8 | **`RECOMMENDED_EVENTS` es un array hardcodeado.** Escala mal; en algún momento va a querer ser una tabla o un feed |
| 9 | **Sin tests.** `applyEventsToTrade` y `resolveApplicableRecommendations` son puras y triviales de testear |
| 10 | El sistema asume que un evento aplica a **todo** el histórico previo. No hay forma de excluir un trade puntual |

---

## Cómo extender

### Agregar un tipo de evento

1. Sumar el valor al enum `CorporateEventType` en `prisma/schema.prisma` →
   `pnpm run db:push && pnpm run db:generate`.
2. Agregar el label en `formatEventTypeLabel` (`src/components/events/format.ts`).
3. Decidir la matemática en `applyEventsToTrade`:
   - Si escala cantidad/precio → no hace falta tocar nada, el ratio genérico ya lo cubre.
   - Si es no-op → agregarlo al `continue` junto a `TICKER_CHANGE`.
   - Si necesita otra lógica → agregar una rama.
4. El `Select` del form itera `Object.values(CorporateEventType)`, así que aparece solo.

### Agregar un evento recomendado

Sumar un objeto a `RECOMMENDED_EVENTS` en `src/lib/events/recommended.ts`. Solo eventos
públicos y verificables, con `title` y `description` que expliquen el impacto en lenguaje claro.

### Implementar `TICKER_CHANGE` de verdad

Requiere fusionar dos `Instrument`:

1. Campo `supersededByInstrumentId` en `Instrument` (o una tabla de aliases).
2. Que `buildHoldings` agrupe por la cadena de instrumentos, no por `instrumentId` suelto.
3. Decidir qué ticker mostrar (el nuevo) y cómo presentar el histórico.

Es un cambio de fondo en el agrupamiento — no alcanza con tocar `apply.ts`.

### Implementar `SPINOFF` correctamente

Un spin-off reparte el costo entre el instrumento original y el nuevo, según una proporción
(típicamente por valor de mercado en la fecha efectiva). Necesitarías:

1. Un segundo `instrumentId` en `CorporateEvent` (el instrumento resultante).
2. Un campo de proporción de reparto de costo.
3. Que `applyEventsToTrade` pueda **emitir** un trade sintético en el instrumento nuevo, no solo
   transformar el existente. Eso cambia la firma: de `Trade → Trade` a `Trade → Trade[]`.

### Agregar una pantalla que use holdings

Si creás una pantalla nueva que llame a `buildHoldings`:

1. Traé los eventos con la misma query.
2. Armá el `eventsMap`.
3. Pasalo como tercer argumento.
4. **Sumá tu ruta a los `revalidatePath` de `createCorporateEvent` y `deleteCorporateEvent`.**

Si te salteás el paso 3, la pantalla muestra números sin ajustar y nada te avisa.
