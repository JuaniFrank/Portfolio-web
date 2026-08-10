# Rediseño de /rendimientos — de snapshots a replay determinístico

> **Respuesta corta: sí, se puede.** Y el schema de Prisma ya tiene las tablas necesarias
> (`PriceCache`, `FxRate`, `MacroSeries`). No hace falta ninguna migración para la ingesta
> de datos históricos.
>
> Documento autocontenido. Todos los endpoints externos que se citan fueron probados
> el 2026-08-10; los resultados están en el apéndice.

---

## 1. Diagnóstico: por qué el sistema actual no sirve

### Flujo actual

```
Vercel Cron (0 3 * * *)
  └─> /api/cron/snapshots
        └─> calculatePortfolioValuation(portfolioId)   // precios de HOY, CCL de HOY
              └─> upsert PortfolioSnapshot { date: hoy, totalValueArs, ... }

/rendimientos (page.tsx)
  └─> prisma.portfolioSnapshot.findMany()   // única fuente de verdad
        └─> buildMonthlyReturns(points)     // value / value_prev - 1
```

### Los ocho problemas concretos

| # | Problema | Evidencia |
|---|---|---|
| 1 | **La serie arranca el día que se prendió el cron.** No hay forma de ver 2024 o 2025, aunque las transacciones estén cargadas. | `PortfolioSnapshot` solo se escribe con `date: hoy` |
| 2 | **Un día de cron caído = agujero permanente.** No hay backfill. | `runSnapshotsCron` solo hace upsert del día actual |
| 3 | **El histórico no se recalcula nunca.** Si importás transacciones viejas, corregís una operación o mejorás la lógica de valuación, todos los snapshots anteriores quedan mintiendo. | El snapshot guarda el resultado, no los insumos |
| 4 | **`netDeposits` se clampea a 0.** Si los retiros superan los aportes, "ganancia vs aportes" da un número inventado. | `performance.ts:247-248` → `Decimal.max(0, netDepositsArs)` |
| 5 | **`twrSinceInception` siempre es `null`.** El campo existe en la DB y en el tipo, pero nunca se llena. | `performance.ts:249` → `twrSinceInception: null` |
| 6 | **No hay CCL histórico.** `resolveCclRate()` devuelve el CCL de hoy y persiste una fila por día a partir de hoy. Valuar un día pasado en USD es imposible. | `ccl-rate.ts:29-79` |
| 7 | **El "rendimiento mensual" no es un rendimiento.** `value / value_prev - 1` con aportes de por medio mide variación de saldo, no performance. Un aporte de $1M en una cartera de $1M aparece como **+100% de rendimiento**. | `page.tsx:14-17, 57-58` |
| 8 | **El cron `fetch-sp500` está roto.** Usa `v7/finance/download`, endpoint que Yahoo dio de baja. | Verificado: HTTP 401 `{"code":"unauthorized","description":"User is not logged in"}` |

El punto 7 es el más grave: los números que muestra la página hoy son incorrectos por
diseño, no por un bug. Y el punto 3 explica por qué esto no se arregla parcheando el cron.

---

## 2. El insight que habilita todo

`buildHoldings(trades, prices, eventsMap)` (`src/lib/transactions/holdings.ts:69`) es una
**función pura de replay**: toma operaciones y devuelve posiciones. No sabe qué día es hoy.

Entonces:

```ts
// Cartera al cierre de cualquier fecha D:
const tradesUpToD = trades.filter(t => t.tradeDate <= D)
const pricesAtD   = priceSeries.asOf(D)          // ← la pieza que hoy no existe
const holdings    = buildHoldings(tradesUpToD, pricesAtD, eventsMap)
```

Con eso, **todo el histórico es derivable de transacciones + series de precios**. Los
snapshots dejan de ser la fuente de verdad y pasan a ser, como máximo, un caché
reconstruible.

Esa es exactamente la diferencia con la app de las capturas: no guarda fotos diarias,
reconstruye la serie desde el histórico de cada ticker.

---

## 3. Arquitectura propuesta

```
┌─ CAPA 1 · INGESTA (llena tablas que ya existen) ─────────────────────────┐
│  Yahoo v8 chart      → PriceCache   (EOD por instrumento)               │
│  argentinadatos CCL  → FxRate       (USD/ARS diario, source=CCL)        │
│  Yahoo ^MERV         → MacroSeries  (code=MERVAL)                       │
│  argentinadatos IPC  → MacroSeries  (code=IPC_AR)                       │
│  Yahoo ^GSPC         → MacroSeries  (code=SP500)                        │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ series históricas en DB
┌─ CAPA 2 · MOTOR DE REPLAY (nuevo, puro, testeable) ─────────────────────┐
│  PriceSeries.asOf(D)  →  lookup con forward-fill                        │
│  buildHoldings(...)   →  YA EXISTE, se reutiliza tal cual               │
│  returns.ts           →  Modified Dietz + TWR encadenado                │
│  → buildPerformanceSeries(portfolioId, { from, to, granularity })       │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ MonthlyPerformanceRow[]
┌─ CAPA 3 · PRESENTACIÓN ──────────────────────────────────────────────────┐
│  Evolución del portfolio + aportes · Rendimiento mensual vs benchmarks   │
│  Rendimiento acumulado · Tabla mensual con detalle expandible            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Capa 1 — Ingesta de series históricas

### 4.1 Tabla de fuentes (todas verificadas)

| Dato | Fuente | Tabla destino | Granularidad | Cobertura verificada |
|---|---|---|---|---|
| Precio EOD por ticker | Yahoo `v8/finance/chart/{sym}?range=10y&interval=1d` | `PriceCache` | Diaria (ruedas) | `AAPL.BA`: 249 puntos en 1y, currency ARS |
| CCL USD/ARS | `api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui` | `FxRate` | Diaria (incl. fin de semana) | Desde **2013-01-02** hasta 2026-08-09 |
| Merval | Yahoo `v8/finance/chart/^MERV?range=10y&interval=1d` | `MacroSeries` code=`MERVAL` | Diaria | 493 puntos en 2y |
| Inflación AR | `api.argentinadatos.com/v1/finanzas/indices/inflacion` | `MacroSeries` code=`IPC_AR` | **Mensual** | Hasta 2026-06-30 |
| S&P 500 | Yahoo `v8/finance/chart/^GSPC?range=10y&interval=1d` | `MacroSeries` code=`SP500` | Diaria | 1255 puntos en 5y |

**`MacroSeries` y el enum `MacroCode` ya están en el schema y hoy no los usa nadie**
(verificado: cero referencias en `src/`, más allá del cliente Prisma generado). Ya
contemplan `IPC_AR`, `MERVAL`, `SP500`, `UVA`, `CER`, `RIESGO_PAIS`. Cero migraciones.

### 4.2 Cuatro detalles de ingesta que hay que hacer bien

**a) Separar el `source` de los precios EOD.**
Hoy `PriceCache` guarda filas con `source: "yahoo"` y `datetime` intradiario arbitrario
(`quotes.ts:69` usa `quote.asOf`). Si el backfill escribe con el mismo `source`, la serie
diaria queda contaminada con precios intradiarios y cualquier query `distinct` levanta la
fila equivocada.

→ Usar `source: "yahoo-eod"` con `datetime` normalizado a medianoche UTC. La clave única
`[instrumentId, datetime, source]` ya lo permite y hace el backfill idempotente.

**b) `close` crudo, no `adjclose`.**
Ver la sección de límites (punto 2): `buildHoldings` ya ajusta *cantidades* con
`CorporateEvent`. Si además usamos precios ajustados, el ajuste se aplica dos veces.

**c) Semántica del `value` en `MacroSeries` — documentarla en el código.**
- `MERVAL` / `SP500` → cierre del índice (nivel, no variación).
- `IPC_AR` → **variación porcentual mensual** tal como la publica la fuente
  (`{"fecha":"2026-06-30","valor":1.9}` = 1,9 % en junio). No es un nivel de índice.
  Mezclar estas dos semánticas es el error más fácil de cometer acá.

**d) La inflación llega con lag del INDEC.**
Hoy es 2026-08-10 y el último dato publicado es **2026-06-30**. Julio y agosto no tienen
inflación disponible. La UI debe mostrar `—` para esos meses, nunca `0`, porque un 0 en el
acumulado de inflación le regala rendimiento real al portfolio.

### 4.3 Endpoints y crons

```
src/lib/market/yahoo.ts          → agregar fetchYahooHistory(symbol, range)
src/lib/market/argentinadatos.ts → NUEVO: fetchCclHistory(), fetchInflationHistory()
src/lib/market/history-sync.ts   → NUEVO: orquestador de backfill (upsert masivo)

src/app/api/cron/backfill-prices/route.ts  → NUEVO: EOD de instrumentos con tenencia
src/app/api/cron/backfill-macro/route.ts   → NUEVO: CCL + IPC + MERVAL + SP500
src/app/api/cron/fetch-sp500/route.ts      → migrar a v8 chart, o borrar y absorber en backfill-macro
```

Cada cron debe ser **idempotente** (upsert por clave única) y **reanudable**: si se corta a
la mitad, la corrida siguiente completa lo que falta. El backfill de precios se paraleliza
con concurrencia limitada (~5) porque son N requests, uno por instrumento.

Cron sugerido en `vercel.json`: `backfill-macro` diario post-cierre, `backfill-prices`
diario después de macro (necesita el CCL del día).

---

## 5. Capa 2 — Motor de replay

```
src/lib/rendimientos/
  types.ts          # extender el existente
  price-series.ts   # PriceSeries: as-of con forward-fill (búsqueda binaria)
  cashflows.ts      # clasificación flujo externo vs interno
  returns.ts        # Modified Dietz + encadenamiento TWR  ← PURO, es el que se testea
  benchmarks.ts     # normalización de IPC / MERVAL / SP500 a series comparables
  series.ts         # buildPerformanceSeries: orquestador
```

### API pública

```ts
export type MonthlyPerformanceRow = {
  month: string              // "2026-08"
  cclMonthEnd: number        // CCL del cierre del mes
  valueArs: number
  valueUsd: number
  netFlowArs: number         // aportes netos DEL mes (externos)
  cumulativeFlowArs: number
  monthlyReturnArs: number | null   // Modified Dietz
  monthlyReturnUsd: number | null
  cumulativeReturnArs: number | null // TWR encadenado
  cumulativeReturnUsd: number | null
  unrealizedReturnPct: number | null // marketValue / costBasis - 1
  positions: PositionDetail[]        // para el desplegable de la tabla
  coverage: "full" | "partial"       // ← flag de calidad del dato
}

export async function buildPerformanceSeries(
  portfolioId: string,
  opts: { from: Date; to: Date; granularity: "month" | "day" }
): Promise<MonthlyPerformanceRow[]>
```

`coverage: "partial"` se emite cuando algún instrumento con tenencia en ese mes no tuvo
precio y se usó forward-fill. Es lo que permite que la UI sea honesta en vez de mostrar un
número liso que no se puede auditar.

### Alineación temporal

Para cada mes se toma **el último día hábil con precio disponible ≤ fin de mes**, con
forward-fill del último precio conocido. Es la misma convención que declara la app de
referencia en su nota al pie ("se toma el precio del activo del último día hábil de cada
mes"). Documentar la convención en la UI: evita el 100 % de los reportes de "no me coincide
con mi broker".

---

## 6. Metodología de cálculo — la parte que realmente importa

Acá se decide si los números son correctos o no. Es la diferencia entre la página actual y
la app de las capturas.

### 6.1 El perímetro: capital invertido, no saldo del broker

> **Corrección sobre la primera versión de este documento.** Originalmente el perímetro
> eran *posiciones + efectivo*, con los `DEPOSIT` como aporte. Eso hacía que todo el
> cálculo dependiera de que el usuario cargara sus movimientos de efectivo — y **no se
> puede depender de eso**. Un import que trae solo operaciones dejaba el primer mes sin
> medir y sobrestimaba cualquier mes con compras.

Lo que se mide es **el capital puesto en activos**. Y la clave es que ese dato ya está en
las operaciones: **una compra es la prueba de que entró plata**.

| Tipo de transacción | ¿Mueve capital? | Por qué |
|---|---|---|
| `BUY` | ✅ Entra | Invertiste esa plata, haya o no un `DEPOSIT` cargado |
| `SELL` | ✅ Sale | Saca capital del perímetro. Vender no genera rendimiento |
| `DEPOSIT`, `WITHDRAWAL`, `TRANSFER_IN/OUT` | ❌ **Se ignoran** | Mover plata entre tu banco y el broker no cambia cuánto rindieron tus activos |
| `DIVIDEND_CASH`, `COUPON`, `AMORTIZATION`, `INTEREST` | ❌ No | Es **retorno generado**: se acumula dentro del perímetro |
| `FEE`, `TAX_WITHHOLDING` | ❌ No | Costo que debe empujar el rendimiento hacia abajo |
| `FX_CONVERSION` | ❌ No | Cambia la composición, no el valor |

Entonces:

```
Valor invertido = posiciones a precio de mercado + renta acumulada
Capital neto    = compras − ventas
```

**El efectivo queda afuera por completo**, incluso si está cargado. Plata quieta en el
broker no rinde, y hacerla entrar al cálculo significaría que dos usuarios con la misma
cartera vean rendimientos distintos según qué tan prolijos fueron cargando movimientos —
que es justamente el problema del que salimos.

Consecuencia en la UI: la columna es **"Valor invertido"**, no "Valor del portfolio", y
"Aportes" pasa a ser **"Capital invertido"**. Los nombres tienen que decir lo que miden.

**Ejemplo — 3 compras con 15 días de gap, sin ningún depósito cargado:**

| | Compra | Importe |
|---|---|---|
| 1 ene | 10 nominales × $100 | $1.000 |
| 16 ene | 10 nominales × $110 | $1.100 |
| 31 ene | 10 nominales × $120 | $1.200 |

Cierre de enero: 30 × $120 = **$3.600**.

```
día  1: +1.000 × 30/31 = 967
día 16: +1.100 × 15/31 = 532
día 31: +1.200 ×  0/31 =   0
                 capital medio = 1.500

ganancia = 3.600 − 3.300 = 300
enero    = 300 / 1.500 = +20%
```

Febrero sin compras, precio $120 → $132: **+10%**. Acumulado encadenado: `1,20 × 1,10 − 1
= +32%`. Cubierto por tests en `returns.test.ts`.

Pendiente para más adelante: un apartado aparte que compare entradas y salidas de efectivo.
Es una vista distinta a la de rendimiento y no tiene por qué contaminar este número.

### 6.2 Rendimiento mensual = Modified Dietz

```
              V_end − V_start − F
R_m  =  ─────────────────────────────────
          V_start + Σ (w_i · F_i)

  F    = capital neto invertido en el mes (compras − ventas)
  w_i  = (D − d_i) / D     fracción del mes que ese capital estuvo invertido
  D    = días del mes,  d_i = día de la operación
```

**Por qué Dietz y no `V_end / V_start − 1`:** neutraliza el momento y el tamaño de las
compras. Una compra el día 28 pesa 2/30 en el denominador, no 1.

**Por qué Dietz y no TWR diario completo:** el TWR exacto exige valuar la cartera cada día
en que hay un flujo. Es factible con este motor (los precios diarios están), pero cuesta N
valuaciones por mes. Para períodos mensuales Dietz da resultados prácticamente idénticos y
es el estándar de facto en apps retail. Si más adelante querés TWR diario exacto, el motor
ya lo soporta cambiando `granularity: "day"`.

### 6.3 Rendimiento acumulado = TWR encadenado

```
R_acum = Π (1 + R_m) − 1          // producto, NO suma
```

No es la suma de los mensuales, y no es `V_end / V_start − 1`. Esto se ve en las capturas:
en 08/2026 el rendimiento mensual es −0,32 % pero el acumulado es +22,07 %. Solo cierra si
está encadenado.

### 6.4 Rendimiento no realizado

```
unrealizedReturnPct = marketValueArs / costBasisArs − 1
```
sobre las posiciones abiertas al cierre del mes. `buildHoldings` ya devuelve
`costBasisArs` y `marketValueArs`, no hay que calcular nada nuevo.

### 6.5 ARS y USD son dos series independientes

**No** derivar la serie USD restándole la devaluación a la serie ARS. Se construyen en
paralelo:

```
V_ars(D) = Σ (qty_i × price_ars_i(D)) + cash_ars + cash_usd × ccl(D)
V_usd(D) = V_ars(D) / ccl(D)
```

y después se corre Dietz **por separado** sobre cada serie, convirtiendo **cada flujo al
CCL de su propia fecha de operación**. Por eso el CCL histórico no es opcional: sin él, la
serie USD es una aproximación con error acumulativo.

Las capturas lo confirman: 08/2026 da −0,32 % en ARS y −1,08 % en USD; 07/2026 da 8,27 % en
ARS y 4,01 % en USD. No son transformaciones lineales una de la otra.

### 6.6 Benchmarks comparables

| Benchmark | Serie a comparar | Cómputo |
|---|---|---|
| Inflación AR | **ARS** | acumulado = `Π (1 + ipc_m/100) − 1` |
| Merval | **ARS** | variación % encadenada del cierre de `^MERV` |
| S&P 500 | **USD** | variación % encadenada del cierre de `^GSPC` |

Regla: benchmark en ARS contra serie ARS, benchmark en USD contra serie USD. Es lo que hace
la app de referencia (vista ARS → Inflación + Merval; vista USD → solo S&P 500) y es
correcto.

---

## 7. Capa 3 — Caché e invalidación

El modelo "el snapshot es la verdad" se retira. Recomendación:

1. **Cálculo on-demand** con `unstable_cache` / `revalidateTag`, cacheado por
   `portfolioId + watermark`, donde
   `watermark = max(transaction.updatedAt) ⊕ última fecha de ingesta EOD`.
   Cualquier edición o import de transacción cambia el watermark e invalida sola.
2. Si el cálculo resulta caro con muchos meses × instrumentos, **materializar** la serie
   mensual en una tabla nueva — pero declarándola explícitamente como caché
   **reconstruible desde cero**, no como fuente de verdad. Esa distinción es toda la
   diferencia con el sistema actual.
3. `PortfolioSnapshot` queda para lo único que hace bien: registrar el valor de hoy en
   tiempo casi real para el dashboard. No para el histórico.

---

## 8. Límites reales

Sé honesto con estos en la UI; son la diferencia entre una herramienta confiable y una que
el usuario deja de creer.

**1. Renta fija no se puede reconstruir.** *(decidido: se excluye y se avisa)*
data912 solo expone `/live/*`. Probé `historical/arg_stocks` → **404**. Sin serie histórica,
`ON`, `LETRA` y `BOND_AR` no son backfilleables. Coincide con el disclaimer de la app de
referencia ("no incluyen renta fija ni cripto por ahora"). Quedan fuera del cálculo y la UI
lo declara ticker por ticker. Alternativa descartada: valuarlas a costo miente menos que
valuarlas en cero, pero sigue mintiendo. Buscar otra fuente (IAMC, BYMA) queda para después.

**1-bis. Instrumentos en dólares tampoco entran, por ahora.**
`buildHoldings` suma `marketValueArs` y `costBasisArs` como pesos. Un `STOCK_US` o un `ETF`
cotizado en USD mezclaría monedas dentro del mismo total **sin que nada avise**, así que
`PERFORMANCE_INSTRUMENT_TYPES` se limita a `CEDEAR` y `STOCK_AR`, que cotizan en BYMA en
pesos. Habilitarlos requiere valuación multi-moneda primero.

**2. Splits y cambios de ratio de CEDEAR — el riesgo silencioso.**
Yahoo ajusta sus precios históricos retroactivamente. Nuestras `quantity` están guardadas
as-traded, y `buildHoldings` ya las ajusta vía `CorporateEvent`. Aplicar un precio ya
ajustado sobre una cantidad ya ajustada **duplica el ajuste** y el valor histórico sale mal.
Hay que ajustar de un solo lado.
→ Decisión propuesta: guardar `close` crudo, ajustar solo cantidades vía `CorporateEvent`, y
traer `events=split` de Yahoo en el backfill para **detectar eventos que falten** en la
tabla. Un split no registrado es un salto de precio inexplicable en la serie.

**3. Tickers sin cobertura o delistados.**
Cadena de fallback explícita: `PriceCache` → Yahoo → forward-fill del último precio conocido
→ marcar el mes `coverage: "partial"`. **Nunca un 0 silencioso**: un 0 se ve como una
pérdida total y arruina el mes y todo el acumulado posterior.

**4. Cripto sí es viable.** Yahoo tiene `BTC-USD`, `ETH-USD`. Se puede sumar en fase 2 con
el mismo motor, sin cambios estructurales.

**5. Rate limits de Yahoo.** Un request por instrumento por backfill (`range=10y` trae todo
de una sola vez). Con 50 instrumentos son 50 requests: concurrencia ~5, nunca en el path de
un request de usuario, y respetar la regla de oro del proyecto — que caiga el proveedor no
puede romper la página.

---

## 9. Plan de implementación

### Fase 0 — Ingesta (no toca la UI)
- `fetchYahooHistory()` en `yahoo.ts`
- `argentinadatos.ts` (CCL + inflación)
- `history-sync.ts` con upsert masivo idempotente
- crons `backfill-macro` y `backfill-prices` + `vercel.json`
- arreglar o retirar `fetch-sp500` (hoy roto)

**Criterio de aceptación:** `FxRate` con CCL diario desde la primera transacción del
usuario; `PriceCache` con EOD de cada instrumento con tenencia; `MacroSeries` con IPC_AR,
MERVAL y SP500. Verificable con queries directas, sin UI.

### Fase 1 — Motor + tests
- `price-series.ts`, `cashflows.ts`, `returns.ts`, `benchmarks.ts`, `series.ts`
- **tests primero** sobre `returns.ts` (ver sección 10)

**Criterio de aceptación:** `buildPerformanceSeries` reproduce la serie mensual completa
desde transacciones, sin leer `PortfolioSnapshot`.

### Fase 2 — UI
- selector de rango de meses + moneda ARS/USD (ya existe el toggle)
- evolución del portfolio + aportes acumulados
- rendimiento mensual con benchmarks toggleables
- rendimiento acumulado
- tabla mensual con detalle expandible por posición
- badge visible cuando `coverage === "partial"`

### Fase 3 — Retirar la dependencia de snapshots
- `page.tsx` consume el motor
- `PortfolioSnapshot` queda solo para el valor de hoy

### Fase 4 — Extras
- cripto, TWR diario exacto, IRR/money-weighted, comparación por activo, export

---

## 10. Tests

**Hoy el proyecto tiene cero tests y ningún runner** (verificado: `package.json` no tiene
script `test`). Esta feature es matemática financiera pura: es el peor lugar posible para no
tener tests, y el mejor lugar para empezar a tenerlos. `returns.ts` no toca DB ni red, así
que se testea con fixtures y corre en milisegundos.

Casos mínimos:

| Caso | Qué se verifica |
|---|---|
| Mes sin flujos | Dietz == `V_end/V_start − 1` |
| Depósito el día 28 | el rendimiento **no** se infla; el flujo pesa 2/30 |
| Depósito el día 1 | el flujo pesa casi 30/30 |
| `BUY` de todo el cash | rendimiento ≈ 0, no un salto |
| `DIVIDEND_CASH` | cuenta como retorno, no como aporte |
| Retiro > ganancias | negativo pero acotado, sin división por cero |
| Acumulado de 3 meses | producto encadenado ≠ suma de mensuales |
| Mes sin precio para un ticker | `null` / `coverage: "partial"`, nunca `0` |
| `V_start == 0` (primer mes) | `null`, no `Infinity` ni `NaN` |
| Serie USD | Dietz sobre USD ≠ Dietz ARS menos devaluación |

---

## 11. Decisiones tomadas

1. **Renta fija:** se excluye del cálculo y se avisa en la UI, ticker por ticker.
2. **Caché:** on-demand con `revalidate = 300`. Al recalcular siempre, el histórico nunca
   puede quedar desactualizado — que era la enfermedad de los snapshots. Materializar la
   serie queda para si el cálculo se pone lento, y siempre como caché reconstruible.
3. **Profundidad del backfill:** todo el histórico del usuario. Macro desde la primera
   transacción de la base; precios desde la primera operación **de cada instrumento**.
4. **`PortfolioSnapshot`:** se conserva por ahora, alimentando el valor de hoy del
   dashboard. Deja de ser fuente de verdad del histórico y se puede retirar más adelante.
5. **Multi-portfolio:** la feature todavía no existe. El motor ya acepta N portfolios y los
   agrega (`portfolioIds: string[]`); la página le pasa uno. Habilitar el selector no
   requiere tocar el motor.
6. **Perímetro:** capital invertido, efectivo afuera. Ver §6.1.

### Pendiente

- Apartado separado de **entradas/salidas de efectivo**. Es una vista distinta a la de
  rendimiento y no debe contaminar este número.
- **Organizador de columnas** de la tabla (arrastrar para reordenar/ocultar), como en la app
  de referencia. No implementado.
- Valuación **multi-moneda** para habilitar `STOCK_US` y `ETF`.

---

## Apéndice — Verificación de endpoints (2026-08-10)

| Endpoint | Resultado |
|---|---|
| `api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui` | ✅ 200 · 533 KB · 2013-01-02 → 2026-08-09 · fines de semana con forward-fill |
| `api.argentinadatos.com/v1/finanzas/indices/inflacion` | ✅ 200 · mensual · último dato 2026-06-30 (`valor: 1.9` = %) |
| `api.argentinadatos.com/v1/finanzas/indices/inflacionInteranual` | ✅ 200 · último 2026-06-30 (`valor: 33.5`) |
| `query1.finance.yahoo.com/v8/finance/chart/^MERV?range=2y&interval=1d` | ✅ 200 · 493 puntos |
| `query1.finance.yahoo.com/v8/finance/chart/^GSPC?range=5y&interval=1d` | ✅ 200 · 1255 puntos |
| `query1.finance.yahoo.com/v8/finance/chart/AAPL.BA?range=1y&interval=1d` | ✅ 200 · 249 puntos · currency ARS |
| `query1.finance.yahoo.com/v7/finance/download/^GSPC` | ❌ **401 unauthorized** — usado por el cron `fetch-sp500` actual |
| `data912.com/live/arg_corp` · `arg_bonds` · `arg_stocks` · `arg_cedears` | ✅ 200 |
| `data912.com/historical/arg_stocks` | ❌ **404** — no hay histórico de renta fija |

### Estado del schema (sin migraciones para la ingesta)

| Modelo | Estado | Uso en esta feature |
|---|---|---|
| `PriceCache` | ✅ existe, con `[instrumentId, datetime, source]` único | EOD histórico con `source: "yahoo-eod"` |
| `FxRate` | ✅ existe, con `date` + `source: FxSource` | CCL diario histórico |
| `MacroSeries` | ✅ existe · **hoy no la usa nadie** | IPC_AR, MERVAL, SP500 |
| `MacroCode` | ✅ ya incluye `IPC_AR`, `MERVAL`, `SP500`, `UVA`, `CER` | — |
| `CorporateEvent` | ✅ existe y `buildHoldings` ya lo aplica | ajuste de cantidades |
| `Sp500Snapshot` | ⚠️ redundante con `MacroSeries` | candidato a absorber |
| `PortfolioSnapshot` | ⚠️ deja de ser fuente de verdad | solo valor de hoy |
