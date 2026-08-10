# Sistema de bonos (ONs — Obligaciones Negociables)

> **Documento autocontenido.** Todo lo necesario para trabajar en tenencias de ONs, valuación,
> analítica de TIR/duration y proyección de flujos está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router, server actions) · Prisma · decimal.js · date-fns.
- **Ruta:** `/bonds`.
- **Fuentes externas:** data912.com (precios de ONs en BYMA) y dolarapi (CCL).
- **Versionado interno:** **v1** = tenencias + valuación + flujos recibidos.
  **v2** = analítica (YTM/duration) + proyección forward. v2 requiere cargar `BondTerms` a mano.
- **USD es la moneda primaria** de este sistema; ARS es referencia.

### Qué hace este sistema

Agregar posiciones de ONs, valuarlas a mercado con precios de data912, listar los cupones y
amortizaciones ya cobrados, y — si el usuario carga las condiciones de emisión — proyectar los
flujos futuros y calcular TIR, duration de Macaulay y duration modificada.

---

## 🔑 La semántica del precio (leer esto primero)

```
data912 `c`         = ARS por 100 VN nominal
Balanz "Cantidad"   = VN crudos (NO láminas de 100)

⇒ marketValueARS = nominalHeld × c / 100
   marketValueUSD = marketValueARS / cclMid
```

El `/100` es **esencial**. Omitirlo infla la posición exactamente ×100 — es el bug real que
reportaba MCC3O a ~US$14.700 en vez de ~US$147.

La constante vive en `src/lib/bonds/valuation.ts`:

```ts
export const VN_QUOTE_BASIS = 100;
```

**Ejemplo verificado contra una posición real** (documentado en el propio archivo):

```
MCC3O: 149 VN × 155.000 / 100 / CCL(≈1575)
     = 149 × 1.550 / 1575
     ≈ US$146,6        ← consistente con el costo de ~US$149
```

---

## Pantalla `/bonds`

```
src/app/(app)/bonds/page.tsx
  → getBondsPageDataAction()
  → si "error" → redirect("/login")
  → <BondsPage data={data} />
```

```
┌ Obligaciones Negociables ────────────────────────────────────┐
│  "Precios de data912.com (BYMA, ARS por 100 VN nominal).     │
│   USD es el valor primario; ARS se muestra como referencia." │
├──────────────────────────────────────────────────────────────┤
│  ⚠ Banner si falta CCL     🕐 Banner si los precios son stale│
├──────────────────────────────────────────────────────────────┤
│  BondKpiCards — 4 tarjetas                                   │
├──────────────────────────────────────────────────────────────┤
│  [ Tenencias ] [ Flujos recibidos ] [ Analítica v2 ]         │
├──────────────────────────────────────────────────────────────┤
│  Tenencias  → BondHoldingsTable                              │
│  Flujos     → BondCashflowTable                              │
│  Analítica  → una sección por holding:                       │
│                 BondAnalyticsCard                            │
│                 BondProjectionTable                          │
│                 BondTermsForm (inline, on demand)            │
└──────────────────────────────────────────────────────────────┘
```

---

## Archivos

| Archivo | Rol | Líneas |
|---|---|---|
| `src/lib/bonds/types.ts` | Tipos v1 y v2 | 131 |
| `src/lib/bonds/holdings.ts` | Agregación de posiciones nominales + costo USD | 114 |
| `src/lib/bonds/valuation.ts` | **Mark-to-market** con `VN_QUOTE_BASIS` | 105 |
| `src/lib/bonds/cashflows.ts` | Flujos recibidos + **proyección forward** | 314 |
| `src/lib/bonds/day-count.ts` | 5 convenciones de conteo de días | 141 |
| `src/lib/bonds/analytics.ts` | **YTM + duration** | 270 |
| `src/lib/bonds/build.ts` | Composición pura → `BondsPageData` | 79 |
| `src/lib/bonds/portfolio-bridge.ts` | Adaptador a dashboard y transacciones | 119 |
| `src/app/actions/bonds.ts` | Action de la página | 188 |
| `src/app/actions/bond-terms.ts` | CRUD de `BondTerms` | 230 |
| `src/components/bonds/bonds-page.tsx` | Página | 200 |
| `src/components/bonds/bond-kpis.tsx` | 4 KPIs | 116 |
| `src/components/bonds/bond-holdings-table.tsx` | Tabla de tenencias | 144 |
| `src/components/bonds/bond-cashflow-table.tsx` | Tabla de flujos recibidos | 92 |
| `src/components/bonds/bond-analytics.tsx` | Card de TIR/duration | 112 |
| `src/components/bonds/bond-projection-table.tsx` | Cronograma proyectado | 206 |
| `src/components/bonds/bond-terms-form.tsx` | Formulario de condiciones | 448 |
| `src/components/bonds/format.ts` | Formateadores (tolerantes a `null`) | 30 |

### Modelos de datos

```prisma
enum RateType { FIXED FLOATING }

model BondTerms {
  id                    String     @id @default(cuid())
  instrumentId          String     @unique                 // 1:1 con Instrument
  instrument            Instrument @relation(fields: [instrumentId], references: [id], onDelete: Cascade)
  faceValue             Decimal    @db.Decimal(20, 8)
  currencyCode          String
  rateType              RateType
  couponRate            Decimal    @db.Decimal(20, 8)      // fracción decimal: 0.085 = 8.5%
  couponFrequencyMonths Int
  issueDate             DateTime
  maturityDate          DateTime
  amortizationSchedule  Json       // [{ date: ISO, principalPct: number }] — suma 100
  dayCountConvention    String     @default("ACT/365")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([instrumentId])
}
```

Y usa `Transaction` con `instrument.type = "ON"` y
`type ∈ [BUY, SELL, COUPON, AMORTIZATION]`.

---

## `getBondsPageDataAction()`

`src/app/actions/bonds.ts`.

```
1. getCurrentUser()

2. Query de Transaction:
     portfolio.userId = user.id
     type ∈ [BUY, SELL, COUPON, AMORTIZATION]
     instrument.type = "ON"          ← scope EXCLUSIVO, no toca TRADE_INSTRUMENT_TYPES
     instrumentId != null
   orderBy tradeDate asc
   include instrument { id, ticker, type, bondTerms }

3. Promise.all([ fetchOnPrices(tickers), fetchCclQuote() ])

4. bondTermsMap: instrumentId → BondTermsForProjection

5. v1Data = buildBondsPageData(trades, priceResult, cclMid)

6. Por cada holding de v1:
     sin terms → analytics { noTerms: true }, projectedFlows: []
     con terms → projectCashFlows(terms)
                 priceUsd = marketValueUsd / nominalHeld      ← per-unit (ver abajo)
                 periodsPerYear = 12 / couponFrequencyMonths
                 computeBondAnalytics(flows, priceUsd, periodsPerYear, true)

7. return { ...v1Data, holdings: holdingsV2 }
```

### 🔑 El precio por unidad

```ts
// projectCashFlows() emite flujos escalados a UNA lámina (terms.faceValue).
// marketValueUsd es el valor TOTAL de la posición = nominalHeld × precio unitario.
// Dividir por nominalHeld da el precio dirty por unidad que matchea la denominación
// de los flujos, y mantiene el YTM idéntico para 1 unidad o para N.
let priceUsd: number | null = null;
const nominalUnits = Number(holding.nominalHeld);
if (holding.marketValueUsd !== null && nominalUnits > 0) {
  priceUsd = parseFloat(holding.marketValueUsd) / nominalUnits;
}
```

Si no dividís, el YTM depende del tamaño de la posición — que es matemáticamente absurdo.

---

## Agregación de posiciones (`holdings.ts`)

```ts
export function buildBondHoldings(trades: TradeForBondHoldings[]): BondHolding[]
```

Agrupa **por ticker** (uppercase), no por `instrumentId`. Filtra internamente a `BUY`/`SELL`.

Misma lógica AVCO que las acciones, pero en USD:

```
BUY:  nominalHeld += |quantity|;  costBasisUsd += |netAmount|
SELL: costRemoved = costBasisUsd × (|quantity| / nominalHeld)
      costBasisUsd -= costRemoved
      nominalHeld  -= |quantity|
      clamps a 0
```

Las posiciones con `nominalHeld <= 0` se descartan.

Los campos de valuación salen inicializados como "sin precio"
(`marketValueArs: null`, `priceUnavailable: true`) y los llena `markToMarket` después.

`TradeForBondHoldings.type` es `string` (no `"BUY" | "SELL"`) para poder compartir el tipo
intersección `TradeForBonds` con los flujos, que incluyen `COUPON` y `AMORTIZATION`.

---

## Mark-to-market (`valuation.ts`)

```ts
export function markToMarket(
  holding: BondHolding,
  quote: Data912Quote | null,
  cclMid: number | null,
  priceStale: boolean
): MarkToMarketResult
```

```
marketValueArs   = nominalHeld × quote.c / VN_QUOTE_BASIS   (2 decimales)
marketValueUsd   = marketValueArs / cclMid                  (si hay CCL)
unrealizedPnlUsd = marketValueUsd − costBasisUsd
pctChange        = pnl / costBasis × 100                    (si costBasis ≠ 0)
lastPriceArs     = quote.c                                  (para mostrar tal cual)
```

### Los cuatro estados

| Estado | Condición | Resultado |
|---|---|---|
| **Live** | `quote` presente, `cclMid` presente | Todo poblado, `priceStale: false` |
| **Degradado** | `quote` viene de caché | Todo poblado, `priceStale: true` → badge |
| **Sin precio** | `quote === null` | `marketValue* = null`, `priceUnavailable: true` |
| **Sin CCL** | `cclMid === null` | `marketValueArs` sí, `marketValueUsd = null` |

El campo `lastPriceArs` se agregó en v2 para que la tabla muestre el `c` de data912 directamente,
sin retro-calcularlo desde `marketValueArs / nominalHeld`.

---

## Composición v1 (`build.ts`)

```ts
export function buildBondsPageData(
  trades: TradeForBonds[],
  priceResult: FetchOnPricesResult,
  cclMid: number | null
): BondsPageData
```

Pura, sin I/O. Encadena:

1. `buildBondHoldings(trades.filter(BUY|SELL))`
2. `markToMarket` por holding, con `isStale = priceResult.stale && quote !== null`
3. `aggregateReceivedFlows(trades)` → cupones y amortizaciones cobrados
4. `computeCouponsYtd(flows, cclMid ?? 0)`
5. Totales de mercado en USD y ARS (`null` si ningún holding tiene precio)
6. `anyPriceStale = priceResult.stale && priceResult.quotes.size > 0`

---

## Flujos recibidos (`cashflows.ts`, parte v1)

```ts
aggregateReceivedFlows(transactions)   // filtra COUPON | AMORTIZATION, orden desc por fecha
computeCouponsYtd(flows, cclRate)      // suma cupones del año UTC actual, en USD
```

`computeCouponsYtd` convierte los montos en ARS a USD con el CCL. **Moneda desconocida se
saltea** (fallback seguro, no asume nada).

---

## Proyección forward (`cashflows.ts`, parte v2)

```ts
export function projectCashFlows(
  terms: BondTermsForProjection,
  today: Date = new Date()
): ProjectedFlow[]
```

Devuelve `[]` si el bono ya venció.

### El timeline unificado — la parte importante

```ts
type TimelineEvent =
  | { kind: "COUPON"; date: Date }
  | { kind: "AMORTIZATION"; date: Date; principalPct: number };

timeline.sort((a, b) => {
  const dt = a.date.getTime() - b.date.getTime();
  if (dt !== 0) return dt;
  return a.kind === "AMORTIZATION" ? -1 : 1;   // ← AMORTIZACIÓN antes que CUPÓN
});
```

> 🔑 **Por qué el orden importa.** Una amortización a mitad de período tiene que reducir el
> capital **antes** de que se calcule el cupón siguiente. Sin este timeline unificado, las
> amortizaciones intra-período dejaban el capital sin tocar y los cupones posteriores se
> computaban sobre una base demasiado alta. Es un bug ya corregido, documentado en
> `cashflows.ts:171`.

El recorrido:

```
remainingPrincipalPct = 100

para cada evento del timeline:
  AMORTIZATION:
     remainingPrincipalPct -= principalPct    (siempre, pasado o futuro —
                                               hace falta para los cupones siguientes)
     si es futuro → emitir flujo { amount: faceValue × pct/100, periodDays: null }

  COUPON:
     si no está en couponDateSet → skip (duplicado)
     si es futuro Y remainingPrincipalPct > 0:
        periodStart = cupón anterior (o issueDate para el primero)
        accrual = periodAccrual(periodStart, fecha, convención)
        outstanding = faceValue × remainingPrincipalPct / 100
        amount = couponRate × outstanding × accrual.yearFraction
        emitir { amount, periodDays: accrual.days, assumedRate: isFloating }
```

Detalles:

- **El período de devengamiento arranca en el cupón anterior**, no en hoy. Se proyecta el cupón
  **completo** aunque hoy caiga a mitad de período — es lo correcto: el interés devenga sobre
  todo el período independientemente de la fecha de valuación.
- **`FLOATING`**: se proyecta al último `couponRate` conocido y cada fila lleva
  `assumedRate: true` para que la UI lo advierta.
- **Fechas de cupón** (`buildCouponDates`): desde `issueDate` sumando `freqMonths` con
  `date-fns/addMonths` (maneja el overflow de fin de mes: 31/ene + 1 mes → 28/feb, no 02/mar).
  Siempre se incluye `maturityDate` como última fecha si no cayó en la grilla.
- **`t`** (años hasta el flujo) usa `365.25` días por año.

---

## Convenciones de conteo de días (`day-count.ts`)

```ts
export type DayCountConvention = "30/360" | "ACT/360" | "ACT/365" | "ACT/ACT" | "30E/360";
export function normalizeConvention(raw): DayCountConvention   // fallback: "ACT/365"
export function periodAccrual(start, end, convention): { days: number; yearFraction: number }
```

| Convención | `days` | `yearFraction` |
|---|---|---|
| `ACT/360` | días calendario | `days / 360` |
| `ACT/365` | días calendario | `days / 365` |
| `ACT/ACT` | días calendario | ISDA: parte el período por año calendario y pondera por 365/366 |
| `30/360` | 30-ajustado (regla US) | `days / 360` |
| `30E/360` | 30-ajustado (Eurobond) | `days / 360` |

Diferencia entre las dos reglas de 30/360:

```ts
if (european) {          // 30E/360
  if (d1 === 31) d1 = 30;
  if (d2 === 31) d2 = 30;
} else {                 // 30/360 US
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;   // solo si el inicio ya se ajustó
}
```

**Toda la matemática de componentes de fecha usa accesores UTC** (`getUTCDate`, `getUTCMonth`,
`getUTCFullYear`) a propósito: las fechas de `BondTerms` se guardan como medianoche UTC, así que
los accesores UTC devuelven el día calendario que corresponde. Los conteos de días reales usan
diferencia de milisegundos, que es seguro en cualquier zona horaria.

---

## Analítica (`analytics.ts`)

### YTM — Newton-Raphson con fallback a bisección

```ts
const YTM_TOLERANCE     = 1e-8;
const YTM_MAX_ITER      = 100;
const YTM_BISECTION_LOW = 1e-6;
const YTM_BISECTION_HIGH= 2.0;    // 200% — suficiente para bonos distressed
```

```
NPV(r) = Σ [ CF_i / (1 + r)^t_i ] − precio
NPV'(r) = −Σ [ t_i × CF_i / (1 + r)^(t_i + 1) ]

Fase Newton (seed 5%):
  si |NPV| < tolerancia            → converge
  si |derivada| < 1e-12 o no finita → romper y pasar a bisección
  si el paso sale de (0, 2.0]       → romper y pasar a bisección

Fase bisección en [1e-6, 2.0]:
  si fLo × fHi > 0 → no hay solución en el bracket → noConvergence
  bisecar hasta tolerancia o 100 iteraciones
```

> **Detalle sutil ya corregido:** `fLo` y `fHi` se **actualizan** al mover el bracket. Con un
> `fLo` viejo, el test de signo `fLo * fMid < 0` diverge y devuelve un YTM incorrecto o
> `noConvergence` espurio. Está comentado en `analytics.ts:130`.

### Duration

```
Macaulay  = Σ[ t_i × PV(CF_i) ] / precio
Modificada = Macaulay / (1 + ytm / periodsPerYear)
```

Calculada con `Decimal` para el PV, resultado como `number`.
Devuelve `null` si no hay flujos, el precio es `<= 0`, el ytm es negativo o el PV total es cero.

### `computeBondAnalytics` — el wrapper a usar

```ts
export function computeBondAnalytics(
  cashFlows: CashFlow[],
  price: number | null,
  periodsPerYear: number,
  hasTerms: boolean
): BondAnalyticsResult
```

Cascada de casos borde, cada uno con su flag:

| Condición | Resultado |
|---|---|
| `!hasTerms` | `{ noTerms: true }` |
| `price === null` | todo `null`, sin flag (precio no disponible) |
| `price <= 0` | `{ invalidPrice: true }` |
| `cashFlows.length === 0` | `{ matured: true }` |
| solver no converge | `{ noConvergence: true }` |
| ok | `{ ytm, macaulayDuration, modifiedDuration }` |

**Llamá siempre a este wrapper**, no a `computeYTM` / `computeMacaulayDuration` directo
(salvo en tests).

---

## `BondTerms` — CRUD (`src/app/actions/bond-terms.ts`)

| Action | Firma |
|---|---|
| `upsertBondTermsAction(input)` | `→ { success: true, data: BondTermsDTO } \| { success: false, error }` |
| `getBondTermsAction(instrumentId)` | `→ { success: true, data: BondTermsDTO \| null } \| { success: false, error }` |

> Este archivo usa `success` en vez de `ok` — es el único del repo. Para código nuevo usá `ok`.

### El DTO serializable

```ts
function toBondTermsDTO(terms: BondTerms): BondTermsDTO {
  return {
    faceValue: terms.faceValue.toString(),        // Decimal → string
    couponRate: terms.couponRate.toString(),
    issueDate: terms.issueDate.toISOString(),     // Date → string
    maturityDate: terms.maturityDate.toISOString(),
    amortizationSchedule: schedule,
    // …
  };
}
```

Los `Prisma.Decimal` **no pueden cruzar** el límite RSC → Client Component. Este DTO es el
ejemplo canónico del patrón en todo el repo.

### Validación (manual, no Zod)

```ts
function validateBondTermsInput(input: BondTermsInput): string | null
```

| Regla | Mensaje |
|---|---|
| `faceValue > 0` | "faceValue must be greater than 0" |
| `currencyCode ∈ {USD, ARS}` | "currencyCode must be USD or ARS" |
| `rateType ∈ {FIXED, FLOATING}` | — |
| `couponRate >= 0` | — |
| **`couponRate <= 1`** | *"must be a decimal fraction, e.g. 0.085 for 8.5% (received a value > 1 — did you enter a percentage instead of a decimal?)"* |
| `couponFrequencyMonths > 0` | — |
| `maturityDate > issueDate` | — |
| `amortizationSchedule` no vacío, cada `principalPct > 0` | — |
| **suma de `principalPct` = 100 ± 0.01** | `"…must sum to 100 (got X)"` |

> 🔑 **`couponRate` es fracción decimal, no porcentaje.** `0.085` = 8,5%. El chequeo de `> 1`
> con mensaje explícito es el guard más útil del formulario.

`upsertBondTermsAction` verifica ownership (el instrumento debe tener transacciones del usuario)
y usa `upsert` sobre `instrumentId` (que es `@unique`), así que reemplaza los términos existentes.

---

## Puente al resto de la app (`portfolio-bridge.ts`)

Las ONs no pasan por `buildHoldings` — tienen su propia valuación. Este módulo las adapta para
que aparezcan en `/dashboard` y `/transactions`.

```ts
toBondTrade(trade, currencyCode)               // TradeForHoldings → TradeForBondHoldings
valuateOnPositions(trades, priceResult, cclRate, namesById)  // → ValuatedOnPosition[]
toHoldingRow(position, cclRate)                // → HoldingRow (formato transacciones)
toDashboardHolding(position, cclRate)          // → HoldingForDashboard
```

Conversiones que hace:

```
costBasisArs    = costBasisUsd × ccl        (0 si no hay CCL)
pnlArs          = marketValueArs − costBasisArs
avgPriceArs     = costBasisArs / nominalHeld
currentPriceArs = marketValueArs / nominalHeld
instrumentType  = "ON"
sector          = null                      (en el dashboard cae a "Renta fija")
```

En el dashboard, todas las ONs se agrupan en **una sola porción** del donut
(`key: "__on__"`, label `"ON"`, color `#6366f1`) con desglose por ticker en el hover.

> Cuando no hay CCL, `costBasisArs` cae a `"0"` y el P&L en ARS queda inflado (todo el valor de
> mercado se ve como ganancia). Es una degradación a tener en cuenta.

---

## Componentes

### `BondKpiCards` — 4 tarjetas

| KPI | Contenido |
|---|---|
| **Valor de mercado** | `DualKpi`: USD arriba, ARS abajo, subtítulo con el CCL usado |
| **Cupones recibidos YTD** | `couponsYtdUsd` + año actual |
| **Posiciones activas** | cantidad de holdings |
| **Flujos recibidos** | cantidad de cupones + amortizaciones |

### `BondHoldingsTable`

Acepta tanto `BondHolding` (v1) como `BondHoldingV2` (superset).

Columnas: Ticker (avatar + badge de estado) · Nominal · Último precio · Val. mercado USD ·
Costo USD · P&L no realizado · % cambio.

Badges bajo el ticker:

- 🕐 **"precio cacheado"** (ámbar) si `priceStale`
- ⚠️ **"precio no disponible"** (gris) si `priceUnavailable`

El último precio se muestra como `155.000,00 ARS/100VN` — con la unidad explícita, para que
nadie lo confunda con un precio por unidad.

### `BondCashflowTable`

Columnas: Fecha · Ticker · Tipo (chip verde "Cupón" / celeste "Amortización") · Importe · Moneda.

### `BondAnalyticsCard`

Renderiza según el flag activo:

| Flag | Render |
|---|---|
| `noTerms` | Texto gris + link "Cargar términos" |
| `invalidPrice` | Card roja: "Precio de mercado inválido" |
| `matured` | Card gris: "Bono vencido — no hay flujos futuros" |
| `noConvergence` | Card ámbar: "El cálculo de TIR no convergió" |
| `ytm === null` | Card gris: "Precio no disponible" |
| ok | 3 métricas |

Las 3 métricas con su subtítulo explicativo:

```
TIR / YTM                 8.20%      "Rendimiento anual al vencimiento"
Duration de Macaulay      3.45 yr    "Tiempo promedio ponderado de los flujos"
Duration modificada       3.31 yr    "Sensibilidad del precio ante +1% de tasa"
```

### `BondProjectionTable`

**Agrupa por fecha de pago** (`groupByPaymentDate`): un vencimiento que paga cupón **y** capital
se muestra en **una sola fila**, no dos.

Columnas: N° · Fecha de pago · **Días del período (ACT/365)** ← con la convención en el header ·
Interés estimado · Amortización · Flujo total. Fila de totales al pie.

Los montos estimados llevan prefijo `≈` para marcar que son proyección. Los ceros se muestran
como `—`.

Si algún cupón tiene `assumedRate`, arriba aparece un banner ámbar:
*"Este bono tiene tasa variable. Los cupones futuros se proyectan a la última tasa conocida
como supuesto…"*

### `BondTermsForm` (448 líneas)

Formulario controlado (sin React Hook Form) con:

**Términos básicos** — grid de 2 columnas: Valor nominal · Moneda (USD/ARS) · Tipo de tasa ·
Tasa de cupón · Frecuencia (mensual a anual) · Convención de conteo · Fecha de emisión ·
Fecha de vencimiento.

**Cronograma de amortización** — filas dinámicas (fecha + %), con botones agregar/quitar y
**validación en vivo de la suma**:

```ts
const amortSumError = Math.abs(totalPct - 100) > 0.01
  ? `La suma de % de capital es ${totalPct.toFixed(2)} — debe ser 100`
  : null;
// el botón de submit está disabled mientras haya error
```

**Aviso de tasa variable** — banner ámbar cuando `rateType === "FLOATING"`.

Defaults al crear: `faceValue: "1000"`, `USD`, `FIXED`, `6` meses, `ACT/365`, una fila de
amortización al `100%`.

Helper defensivo:

```ts
/** El DTO trae ISO strings, pero React Flight revive Date crudos si una action
 *  vieja devuelve data de Prisma sin serializar. Toleramos ambos en vez de crashear. */
function toDateInput(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : value;
  return iso.slice(0, 10);
}
```

### Carga on-demand en `HoldingAnalyticsSection`

```ts
async function handleToggleForm() {
  if (showForm) { setShowForm(false); return; }
  // Al editar términos existentes, traerlos ANTES de abrir el form,
  // así el usuario no pisa datos guardados con defaults en blanco.
  if (effectiveHasTerms && !loadedTerms) {
    setLoadingTerms(true);
    try {
      const result = await getBondTermsAction(holding.instrumentId);
      if (result.success && result.data) setLoadedTerms(result.data);
    } finally { setLoadingTerms(false); }
  }
  setShowForm(true);
}
```

Resolución de términos para el form: `loadedTerms ?? localTerms ?? undefined`.
Después de guardar, se actualiza el estado local y el form se cierra — sin recargar la página.

### `format.ts` — tolerante a `null`

A diferencia de los otros `format.ts` del repo, este maneja `null` explícitamente:

```ts
export function formatMoney(value: string | number | null, currency: ViewCurrency): string {
  if (value === null) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 2 });
}
```

Tiene sentido: en este sistema los campos de valuación son `null` con frecuencia.
`formatPercent` además agrega el signo `+` para los positivos.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **`BondTerms` se carga 100% a mano.** No hay fuente automatizada de condiciones de emisión. Sin terms no hay analítica v2 |
| 2 | **El CCL no se persiste.** Usa `fetchCclQuote()` directo, no `resolveCclRate()` |
| 3 | **Validación manual en vez de Zod.** Único caso en el repo |
| 4 | **Formato de retorno `success` en vez de `ok`.** Único caso en el repo |
| 5 | **Los flujos proyectados no se comparan con los recibidos.** No hay reconciliación entre lo que el bono debía pagar y lo que efectivamente cobraste |
| 6 | **`FLOATING` proyecta tasa constante.** No hay integración con BADLAR ni ninguna curva (`src/lib/market/bcra.ts` es un stub) |
| 7 | **Sin CCL, `costBasisArs = 0`** en el bridge → el P&L en ARS queda inflado en el dashboard y en transacciones |
| 8 | **Los eventos corporativos no se aplican a ONs.** `getBondsPageDataAction` no pasa `eventsMap`. Razonable hoy, pero es una asimetría |
| 9 | **`buildBondHoldings` agrupa por ticker**, no por `instrumentId`. Dos `Instrument` con el mismo ticker y distinta moneda colapsarían |
| 10 | **La analítica corre para todos los holdings en cada render** de la página. Con muchas ONs con terms cargados, el costo crece |
| 11 | **Sin tests.** `analytics.ts`, `day-count.ts`, `cashflows.ts` y `valuation.ts` son puros y son el mejor candidato del repo para testear |
| 12 | El tab se llama literalmente **"Analítica v2"** — nomenclatura interna filtrada a la UI |

---

## Cómo extender

### Agregar una métrica de analítica (ej. convexidad)

1. Implementar la función pura en `src/lib/bonds/analytics.ts`:
   ```
   Convexidad = Σ[ t_i × (t_i + 1) × PV(CF_i) ] / (precio × (1 + ytm)²)
   ```
2. Sumar el campo a `BondAnalyticsResult` y a `BondAnalytics` (`types.ts`).
3. Calcularla en `computeBondAnalytics` y devolverla.
4. Agregar la métrica al array `metrics` de `bond-analytics.tsx`.

### Agregar una convención de conteo de días

1. Sumarla al tipo `DayCountConvention` y al array `SUPPORTED` (`day-count.ts`).
2. Agregar el `case` en el `switch` de `periodAccrual`.
3. Sumarla a `DAY_COUNT_OPTIONS` en `bond-terms-form.tsx`.

El resto (proyección, analítica, header de la tabla) la toma sola.

### Automatizar la carga de `BondTerms`

Es la mejora de mayor impacto del sistema. Opciones, de menos a más:

1. **Mapa curado** — estilo `CURATED_INSTRUMENT_NAMES`: un `Record<ticker, BondTermsInput>` con
   las ONs más operadas. Barato y suficiente para empezar.
2. **Scraping de prospectos BYMA/CNV** — costoso y frágil.
3. **API de terceros** — habría que evaluar cobertura del mercado argentino.

Empezá por (1): un archivo `src/lib/bonds/curated-terms.ts` y una action que ofrezca
"Cargar términos conocidos" en la card cuando el ticker esté en el mapa.

### Reconciliar flujos proyectados vs recibidos

1. En `getBondsPageDataAction`, cruzar `v1Data.flows` (recibidos) con
   `projectCashFlows(terms, fechaPasada)` para el histórico.
2. Comparar por fecha ± tolerancia y por monto.
3. Mostrar una tercera tabla o marcar discrepancias en la de proyección.

Sirve para validar que los `BondTerms` cargados sean correctos.

### Agregar un tipo de bono (soberanos, letras)

El sistema está **acotado explícitamente a `instrumentType = "ON"`** (comentado en varios
archivos). Para ampliarlo:

1. Cambiar el filtro en `getBondsPageDataAction`.
2. Verificar la fuente de precios: data912 `/live/arg_corp` es solo corporativos. Soberanos y
   letras necesitan otro endpoint.
3. Revisar la semántica de VN — puede no ser la misma base de 100.
4. Sumar los tipos a `TRADE_INSTRUMENT_TYPES` si tienen que verse en transacciones y dashboard.

### Escribir el primer test

```ts
import { computeBondAnalytics } from "@/lib/bonds/analytics";

// Bono bullet a 2 años, cupón 8% semestral, face 100, precio par
const flows = [
  { t: 0.5, amount: 4 }, { t: 1.0, amount: 4 },
  { t: 1.5, amount: 4 }, { t: 2.0, amount: 104 },
];
const r = computeBondAnalytics(flows, 100, 2, true);
// r.ytm ≈ 0.0816 (equivalente anual de 8% semestral)
```

Casos que valen la pena: bono a la par (YTM ≈ cupón), con descuento (YTM > cupón), vencido
(`matured`), precio 0 (`invalidPrice`), sin terms (`noTerms`), y **amortización a mitad de
período** (que los cupones siguientes usen el capital reducido).
