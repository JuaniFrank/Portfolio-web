# Sistema de rendimientos (`/rendimientos`)

Documento autocontenido: de dónde sale cada número de la pantalla, con qué fórmula, y
qué pasa cuando falta un dato.

---

## 1. La idea de fondo: el histórico se reconstruye, no se fotografía

La versión anterior leía `PortfolioSnapshot`: una foto diaria del valor de la cartera.
Ese enfoque tiene una enfermedad incurable — **una foto no se puede corregir hacia atrás**.
Si importabas una operación de hace seis meses, todos los snapshots anteriores quedaban
mal para siempre.

Hoy se guardan los **insumos** (precios EOD, CCL, transacciones) y el resultado se
**deriva en cada request**. Corregir una operación vieja, importar un lote atrasado o
mejorar la lógica de valuación se refleja en todo el histórico automáticamente.

Lo que lo hace posible: `buildHoldings` es un replay puro y **no conoce "hoy"**. Si le
pasás los trades filtrados a `tradeDate <= D` y precios as-of D, te devuelve la cartera
al cierre de D. Repetir eso para cada fin de mes te da la serie completa.

> `src/app/(app)/rendimientos/page.tsx` — `export const revalidate = 300`. Se recalcula
> cada 5 minutos. Si algún día se pusiera lento, el paso siguiente es materializar la
> serie como **caché reconstruible**, nunca como fuente de verdad.

---

## 2. El perímetro: qué se mide y qué no

Esta es la decisión que hay que entender antes que cualquier fórmula.

**Lo que se mide es el capital invertido en activos, NO el saldo del broker.**

| Movimiento | Tratamiento | Por qué |
|---|---|---|
| `BUY` | Entrada de capital (`+`) | Una compra **ya es la prueba** de que entró plata |
| `SELL` | Salida de capital (`−`) | Vender no genera rendimiento: la ganancia ya se registró cuando el precio subió |
| `DIVIDEND_CASH`, `COUPON`, `AMORTIZATION`, `INTEREST` | Renta: suma **dentro** del perímetro | Es justamente el retorno que hay que medir, no un aporte |
| `FEE`, `TAX_WITHHOLDING` | Renta negativa | Son costos: tienen que empujar el rendimiento hacia abajo |
| `DEPOSIT`, `WITHDRAWAL`, transferencias | **Ignorados por completo** | Mover plata entre tu banco y el broker no cambia cuánto rindieron tus activos |
| Efectivo en la cuenta | **Fuera del perímetro** | No es capital invertido |

La consecuencia práctica: **el cálculo no depende de que cargues tus depósitos**. Antes,
dos usuarios con la misma cartera veían rendimientos distintos según qué tan prolijos
fueran cargando movimientos. Eso se terminó.

> `src/lib/rendimientos/cashflows.ts`. El signo lo fija **el `type`, nunca el signo de
> `netAmount`** (se usa `Math.abs`): distintos importadores registran el signo de forma
> inconsistente.

### Instrumentos que entran

Solo `CEDEAR` y `STOCK_AR` (`PERFORMANCE_INSTRUMENT_TYPES` en `types.ts`). Dos criterios,
hay que cumplir los dos:

1. **¿Existe serie de precios histórica?** Sin histórico no se puede valuar un mes pasado.
2. **¿Cotiza en ARS?** `buildHoldings` suma `marketValueArs` y `costBasisArs` como pesos.
   Un instrumento en dólares mezclaría monedas dentro del mismo total sin que nada avise.

Todo lo demás (ON, BOND_AR, LETRA, FCI, STOCK_US, ETF, CRYPTO…) queda afuera y se lista
en el bloque **"Quedaron fuera del cálculo"** con el motivo. Un rendimiento que
silenciosamente ignora la mitad del portfolio es peor que no mostrar rendimiento.

---

## 3. El pipeline, paso a paso

`src/lib/rendimientos/series.ts` → `buildPerformanceReport()`

```
1. Leer Transaction del portfolio                         (Prisma)
2. Leer en paralelo:
     PriceCache  (source = "yahoo-eod")   → PriceIndex
     FxRate      (USD/ARS, source "CCL")  → TimeSeries
     MacroSeries (IPC_AR, MERVAL, SP500)  → benchmarks
     CorporateEvent                       → ajuste de splits/ratios
3. Clasificar movimientos                                 (cashflows.ts)
     capitalFlows = BUY(+) / SELL(−)
     incomeEvents = dividendos, cupones (+) / fees, impuestos (−)
4. Enumerar meses: primera transacción → hoy              (months.ts)
5. Para cada mes, valuar en:
     · cada fecha en que entra o sale capital  ← puntos de quiebre
     · el último día del mes                   ← la fila que se muestra
6. Rendimiento de cada tramo → encadenar → mensual → acumulado  (returns.ts)
7. Armar filas, resumen, benchmarks, avisos de calidad
```

### Los "puntos de quiebre" — el detalle que arregla el cálculo

Acá está el corazón del asunto y vale la pena entenderlo.

El enfoque clásico es **Modified Dietz**: estimar el capital medio del mes ponderando
cada aporte por los días que estuvo invertido. Ese denominador **colapsa** cuando el
capital entra sobre el final del mes.

Ejemplo real del problema: comprás el día 27 y el día 31 de un mes de 31 días. El capital
medio ponderado queda en ~9 % de lo que realmente invertiste. Una caída real del 11 % se
reporta como **−131 %**. Y el error es peor justo en el primer mes de una cartera, cuando
todo el capital es nuevo.

La solución implementada es **TWR real**: en vez de estimar, se **valúa la cartera en cada
fecha en que entra o sale capital**. Cada tramo se mide contra el capital que efectivamente
había al empezarlo:

```
       V_fin − V_ini − F
r  =  ───────────────────          base = V_ini  si había cartera
            base                          = F      si el tramo arranca desde cero
```

Y el mes es el producto de sus tramos: `R_mes = Π (1 + r_k) − 1`.

> Un flujo que cae el **último día del mes** no genera un punto extra: coincide con el
> cierre, así que se pliega dentro de la valuación de fin de mes.

> ⚠️ **Nota de nomenclatura:** `types.ts` y un tooltip de la tabla todavía dicen
> "Modified Dietz". Es texto viejo — la implementación (`returns.ts`) es TWR por tramos y
> documenta explícitamente que **reemplazó** a Modified Dietz. Ver §10.

---

## 4. Las dos monedas: ARS y USD

Esto es lo que más confunde, así que va explícito.

### Valor

```
valueArs = Σ (cantidad × precio_ARS)  +  renta acumulada en ARS
valueUsd = valueArs / CCL(fecha de valuación)
```

El CCL se busca **as-of** la fecha de valuación con forward-fill (si el 31 cae domingo,
toma el viernes). Verificado end-to-end: `valueUsd === valueArs / cclMonthEnd` exacto en
los 12 meses de la base actual.

### Flujos de capital

Acá está la sutileza importante: **cada operación se convierte al CCL de su propia fecha**,
no al del cierre del mes.

```
compra del día 3  →  ARS / CCL(día 3)
compra del día 28 →  ARS / CCL(día 28)
```

En un mes de salto cambiario esas dos compras **no valen lo mismo en dólares**. Convertir
todo al CCL de cierre borraría esa diferencia.

### Rendimiento

La serie en USD se calcula **sobre sus propios valores y sus propios flujos**. NO se deriva
de la serie en ARS restando devaluación — eso arrastra error y da un número distinto.

```js
bucket.ars.push(subPeriodReturn(previousArs, valuation.valueArs, flow.ars));
bucket.usd.push(subPeriodReturn(previousUsd, valuation.valueUsd, flow.usd));
```

Por eso ARS y USD tienen rendimientos genuinamente distintos (26,51 % vs 16,57 % acumulado
en la base actual): la diferencia **es** la devaluación real del período, medida operación
por operación.

### Lo que NO cambia con el switch

En el **detalle expandido** de la tabla mensual, las columnas Precio, Costo, No realizado y
Result. mes están fijas en ARS con una nota al pie. Es deliberado (las operaciones se
registran en pesos), pero es una inconsistencia visible. Ver §10.

---

## 5. Los KPIs (las 6 cards de arriba)

Todos corresponden al **período seleccionado**, no al histórico completo. Si elegís 6M,
"ganancia" es la de esos 6 meses. El recorte y el reencadenado los hace
`resolveView()` en `view.ts`.

| KPI | Fórmula | Notas |
|---|---|---|
| **Valor invertido** | `valueArs` o `valueUsd` del **último mes** del período | Posiciones a mercado + renta acumulada. **Sin efectivo.** El subtítulo "Capital puesto" es `Σ netInvested` de los meses visibles |
| **Rendimiento del período** | `Π (1 + R_m) − 1` sobre los meses visibles | **Encadenado, no sumado.** Arranca en 0 % en el primer mes de la ventana |
| **Ganancia del período** | `Σ (valor_fin − valor_ini − capital_neto)` de los meses visibles | En moneda. Neta del capital que pusiste |
| **Anualizado** | `(1 + R)^(12/meses) − 1` | Con < 12 meses **extrapola** → el detalle avisa "Proyección". `null` si el acumulado implica perder > 100 % |
| **Drawdown máximo** | `min(drawdown_m)` sobre los meses visibles | Ver abajo |
| **Mejor / peor mes** | Máximo y mínimo de `monthlyReturn` | `null` si ningún mes es medible |

### Por qué el drawdown se calcula sobre el rendimiento y no sobre el valor

Corrección importante sobre el enfoque ingenuo. Si calculás drawdown sobre el **valor** de
la cartera, **un retiro parece una pérdida**: sacás la mitad de la plata, el valor cae 50 %
y el drawdown reporta −50 % aunque no hayas perdido un peso.

Se calcula sobre el **índice de rendimiento acumulado**, que ya neutraliza los flujos:

```
índice_m = 1 + R_acum_m / 100      (acotado a ≥ 0)
pico     = max(índice hasta m)
drawdown = (índice_m / pico − 1) × 100      → siempre ≤ 0
```

Verificación con datos reales: `cum(2026-01) = 21,13 %`, `cum(2026-02) = 1,87 %` →
`1,0187 / 1,2113 − 1 = −15,90 %` = `maxDrawdownArs`. ✓

---

## 6. Los gráficos

### Evolución del valor
`view.rows[].value` → `valueArs` o `valueUsd` según moneda. Serie directa, sin transformar.

### Rendimiento mensual (barras)
`monthlyReturn` de cada mes. Las barras del portfolio se colorean por signo; las de
benchmark usan el color de su serie.

Un mes sin rendimiento medible **no dibuja barra** — no dibuja una barra en cero, que se
leería como "no ganó ni perdió" en vez de "no se puede medir".

### Rendimiento acumulado (líneas)
`cumulativeReturn`, **encadenado y recalculado dentro de la ventana visible**. Si elegís
6M, la línea arranca en 0 % en el primer mes de esa ventana — no arrastra el histórico
anterior.

### Drawdown
Serie de `drawdown` (siempre ≤ 0), dependiente de la moneda porque deriva del acumulado
de esa moneda.

---

## 7. Mapa de rendimientos (heatmap año × mes)

`data[].monthlyReturn` indexado por `YYYY-MM`. Sirve para leer estacionalidad y rachas de
un saque, algo que la serie temporal no muestra.

Tres estados bien distintos, y la diferencia importa:

| Estado | Se ve | Significa |
|---|---|---|
| Número | Color verde/rojo, intensidad ∝ \|valor\| (satura a 8 %) | Rendimiento medido |
| `null` | Gris con `—`, título "Sin rendimiento medible" | El mes está en el período pero no hay base comparable |
| `undefined` | Gris con `—`, título "Fuera del período" | El mes no entra en la ventana elegida |

"No lo puedo medir" y "no varió" son afirmaciones distintas. Por eso una celda sin dato
**nunca** se pinta del color del cero.

---

## 8. Detalle mensual (tabla)

Una fila por mes, de la más reciente a la más antigua (es el orden en el que se mira este
tipo de tabla; los charts van al revés).

| Columna | Qué es |
|---|---|
| CCL cierre | `cclMonthEnd` — el CCL as-of el último día del mes |
| Valor invertido | Posiciones a mercado + renta acumulada. **Sin efectivo** |
| Ganancia mes | `valor_fin − valor_ini − capital_neto`. Incluye la renta cobrada en el mes |
| Ganancia acum. | Suma de "Ganancia mes" **dentro del período visible** |
| Rend. mensual | TWR del mes (§3) |
| No realizado | `valor / costo − 1` de las posiciones abiertas al cierre. **Es una foto, no el rendimiento del mes** |
| Rend. acumulado | Encadenado desde el inicio del período visible |

### Fila expandida: detalle de posiciones

`Result. mes` por ticker usa la **misma identidad** que `gainArs` a nivel cartera, aplicada
ticker por ticker:

```
monthGain_ticker = valor_fin − valor_inicio_mes − capital_neto_del_ticker_en_el_mes
```

Por eso —y solo por eso— **sumar `Result. mes` de todas las filas da la "Ganancia mes"**
del mes, menos la renta cobrada (que no se atribuye por ticker). Verificado end-to-end: sin
desvíos en los 12 meses.

> ⚠️ Esa identidad **se rompe si vendiste una posición por completo durante el mes**: la
> fila desaparece de la tabla (`buildHoldings` descarta cantidad ≤ 0) pero su resultado
> sigue dentro de la "Ganancia mes" del total. Hoy no pasa porque no hay posiciones
> cerradas. Ver §11.

**No confundir con "No realizado"**, que se mide contra el costo de toda la vida de la
posición. Esas dos columnas **nunca** coinciden, y confundirlas fue el origen del helper
`attributeMonthlyPositionGains`.

---

## 9. Benchmarks

| Serie | Moneda | Semántica del dato guardado |
|---|---|---|
| Inflación (IPC_AR) | ARS | `MacroSeries.value` **ya es** la variación % mensual del INDEC |
| Merval | ARS | `value` es el **nivel** del índice → la variación se deriva de cierres de fin de mes |
| S&P 500 | USD | idem Merval |

**Regla de comparabilidad: nunca se mezclan monedas.** `visibleBenchmarks()` filtra por
`series.currency === currency`. Comparar un portfolio medido en USD contra el Merval en
pesos no dice nada.

Consecuencia directa: **en vista ARS ves Merval + Inflación; en vista USD ves S&P 500.**
El filtro es automático, no hay que ocultar nada a mano.

### El lag del INDEC

El INDEC publica con ~1,5 meses de atraso. Los meses sin publicar quedan en `null`, y
`chainBenchmark` **corta el acumulado ahí** (a diferencia de `chainReturns`, que trata el
`null` como factor 1).

Es deliberado: rellenar con 0 % le regalaría rendimiento real al portfolio durante todo el
lag. La leyenda avisa "último dato publicado MM/AAAA".

> Estado actual de la base: IPC_AR llega hasta 2026-07 (10 de 12 meses), Merval y S&P 500
> hasta 2026-09 (12 de 12).

---

## 10. Calidad de dato: el caso META

> **"Precio arrastrado de un mes anterior en: META. Esos valores son una valuación, no una
> medición."**

### Qué pasó, con evidencia

Consultando la base y la fuente:

```
META  · type CEDEAR · primera compra 2026-05-06
      · PriceCache source="yahoo-eod":  2 filas  (2026-08-31, 2026-09-03)
      · PriceCache source="yahoo":      7 filas  (intradiarias, desde 2026-08-24)

Yahoo  GET /v8/finance/chart/META.BA?range=1y&interval=1d
      → firstTradeDate: null
      → 1 close no nulo (solo el del día)

Comparación: AAPL.BA → 251 closes. FB.BA → "No data found, symbol may be delisted".
```

**Yahoo no publica serie histórica diaria para `META.BA`.** Solo devuelve la cotización del
día. Por eso el backfill, corrida tras corrida, fue capturando un punto suelto por vez — de
ahí las 2 únicas filas EOD.

No es un bug del backfill: es un **hueco de la fuente upstream**.

### Cómo se propaga hasta el mensaje

`valuatePortfolioAt()` (`valuation.ts`) recorre los instrumentos con trades hasta la fecha:

```js
const hit = prices.asOf(trade.instrumentId, valuationDate);
if (!hit) {
  // (a) NO hay precio: buildHoldings cae al PPP → la posición queda valuada A COSTO
  staleTickers.push(trade.ticker);
  continue;
}
priceMap.set(trade.instrumentId, String(hit.value));
// (b) hay precio, pero es anterior al mes → arrastre real (forward-fill)
if (hit.date.getTime() < windowStart.getTime()) staleTickers.push(trade.ticker);
```

Con eso: `coverage = "partial"` y el ticker entra en `staleTickers`, que la tabla renderiza
como el mensaje de arriba.

Resultado en la base actual — coincide exactamente con la predicción del código:

```
2026-05: stale=[META]      ← META comprada, sin ningún precio
2026-06: stale=[META]
2026-07: stale=[META]
2026-08: full              ← aparece el primer precio EOD (2026-08-31)
```

### Por qué el mensaje es engañoso

Las ramas **(a)** y **(b)** significan cosas muy distintas y terminan en el **mismo** array:

- **(a) No hay precio:** la posición se valúa **al PPC** (costo). Muestra **0 % de
  variación** para ese ticker, y toda la variación real se acumula y aparece de golpe el
  mes en que por fin llega un precio.
- **(b) Arrastre:** hay un precio real, solo que de antes del mes.

El caso de META es **(a)**, pero la UI dice *"Precio arrastrado de un mes anterior"* — que
describe **(b)**. El texto es incorrecto para el caso que efectivamente está ocurriendo.

La confusión está tan asumida que el propio test la bautiza así —
`valuation.test.ts:137`: *"sin precio cae al PPP y lo reporta como arrastre"*. El test pasa;
lo que está mal es el nombre que le pusimos al estado.

Lo que sí es correcto y es lo importante: **"Esos valores son una valuación, no una
medición."**

### ✅ Resuelto: respaldo con data912

Se agregó data912 como **fuente de respaldo** del backfill (`data912-eod.ts`, cableado en
`syncPriceHistory`). Entra en dos casos:

1. Yahoo no devolvió ninguna rueda.
2. La serie de Yahoo **arranca después** del rango necesario (hueco en el tramo inicial).

Resultado medido sobre la base: META pasó de **2 a 1508 ruedas** (desde 2020-06-25), los
doce meses quedaron en `coverage: "full"` y el aviso desapareció. Los números se corrigieron
levemente a la baja porque META dejó de estar congelada a costo:

| | Antes | Después |
|---|---|---|
| Acumulado ARS | 26,51 % | 25,65 % |
| Acumulado USD | 16,57 % | 15,78 % |
| Valor invertido | $8.863.051 | $8.803.171 |

> ⚠️ **data912 NO ajusta por eventos corporativos.** Yahoo reescribe su serie
> retroactivamente ante un split; data912 publica el nominal crudo de cada día. Medido:
> SPY (ratio 3:1 del 2026-05-29) sale **3×** más alto y YPFD (split 10:1 del 2026-08-03)
> **10×** más alto en todo el tramo previo al evento.
>
> Por eso toda barra de data912 pasa por `adjustBarsForEvents` (`events/apply.ts`) antes
> de persistirse, aplicando la **misma regla** que `applyEventsToTrade` usa para las
> cantidades: pre-evento → `precio / ratio`. Si esas dos divergen, el valor de la cartera
> se rompe en silencio. Hay tests con los dos casos reales.
>
> En las fechas solapadas **gana Yahoo**: ya viene ajustado por el proveedor, así que
> depende menos de que nuestros `CorporateEvent` estén completos.

Cobertura de data912 sobre la cartera actual: 12 de 15 CEDEARs y 8 de 8 acciones argentinas.
**No cubre PEP, PM ni TSM** — no están en su catálogo.

### Lo que sigue pendiente

**Separar los dos estados** en `PositionDetail` (`priceIsStale` → `priceStatus: "measured"
| "carried" | "missing"`) y mostrar mensajes distintos. El respaldo tapó el caso de META,
pero el mensaje sigue siendo incorrecto para cualquier ticker que en el futuro no tenga
precio en **ninguna** de las dos fuentes (PEP, PM y TSM son candidatos si Yahoo falla).

---

## 11. Resultado de la auditoría

Corrí el motor real contra la base y verifiqué las identidades contables en ambas monedas.

### ✅ Lo que está bien

| Verificación | Resultado |
|---|---|
| `gainArs = Δvalor − capital_neto` (12 meses) | ✔ sin desvíos |
| `gainUsd = Δvalor − capital_neto` (12 meses) | ✔ sin desvíos |
| `valueUsd = valueArs / cclMonthEnd` | ✔ exacto |
| `Σ monthGainArs = gainArs − incomeArs` | ✔ sin desvíos |
| Drawdown recalculado a mano | ✔ −15,90 % coincide |
| Anualizado con 12 meses = acumulado | ✔ correcto (exponente 12/12) |
| Meses sin CCL | ✔ ninguno (CCL cubre 2025-09-13 → 2026-09-07) |
| Suite de tests | ✔ 253 tests, 16 archivos, todos pasan |

Las decisiones de diseño del motor son sólidas y están bien fundamentadas: TWR por tramos
en vez de Modified Dietz, drawdown sobre rendimiento en vez de sobre valor, `null` en vez
de `0` para lo no medible, benchmarks nunca cruzados de moneda, series USD calculadas
independientemente en vez de derivadas.

### ⚠️ Hallazgos

**1. El mensaje de "precio arrastrado" es incorrecto para el caso más común** — §10.
Mezcla "no hay precio" con "hay precio viejo". *El respaldo de data912 eliminó el caso de
META, pero el texto sigue mal para cualquier ticker sin precio en ninguna fuente.*

**1.b. Instrumentos duplicados por ticker** — 11 tickers (META, KO, WMT, C, NVDA, SPY, PM,
AAPL, TSM, GOOGL, MCD) tienen **dos** registros en `Instrument`: el real con BUY/SELL y
precios, y un gemelo que solo acumula `DIVIDEND_CASH`. El importador de dividendos creó un
instrumento paralelo en vez de reusar el existente. *Hoy no corrompe `/rendimientos` —los
gemelos no tienen operaciones, así que no generan posición ni valuación, y los dividendos
igual se cuentan como renta— pero es el escenario exacto que activa el hallazgo 9.*

**2. `staleTickers` puede contener tickers que ya no tenés** — el loop recorre
`tradesToDate` (incluye posiciones cerradas), pero `buildHoldings` descarta cantidad ≤ 0.
Un ticker vendido por completo con precio faltante seguiría forzando `coverage: "partial"` y
apareciendo en el aviso sin estar en la tabla. *Latente: hoy no hay ninguna posición
cerrada.* (Solo aplica si queda al menos una posición abierta; si no, `coverage` corta antes
en `"empty"`.)

**3. La serie USD se rompe si el CCL falta al principio, o si una fila viene en cero.**
Ojo con el matiz, porque es contraintuitivo: `TimeSeries.asOf` hace **forward-fill**, así
que un mes sin CCL *en el medio* de la serie **no** puede dar `null` — hereda en silencio
el último CCL conocido. `cclMid === null` solo es alcanzable en dos escenarios:

- **Prefijo inicial** (meses anteriores a la primera fila de `FxRate`): `valueUsd = 0` en
  esos meses, y en el primer mes con CCL `previousUsd` sigue en 0, así que el rendimiento
  mide **todo el valor de la cartera contra el capital de ese único mes**. Número
  disparatado, en un solo mes.
- **Una fila con `mid <= 0`**: el `0` sobrevive al filtro `Number.isFinite`, se propaga a
  `subPeriodReturn` → `−100 %` → `chainReturns` fija `factor = 0` y `Math.max(0, 0)` lo deja
  clavado ahí. **Todos los meses siguientes quedan en −100 % de acumulado, para siempre.**

Además el toggle USD solo exige que **un** mes tenga CCL. *Latente: hoy el CCL cubre
2025-09-13 → 2026-09-07, todo el rango.*

**4. Copy roto en la UI** — `monthly-return-chart.tsx:61` muestra literalmente
*"Modified cada tramo se mide contra el capital que realmente había invertido (ARS)."* —
quedó un "Modified" colgado de un reemplazo a medias. Y quedan otras dos referencias viejas
a Modified Dietz cuando la implementación es TWR por tramos, que explícitamente lo
reemplazó: `monthly-table.tsx:76` (tooltip visible al usuario) y `types.ts:134`.
*Impacto: visible y contradictorio. Activo hoy.*

**5. El detalle expandido no es reactivo a la moneda** — Precio, Costo, No realizado y
Result. mes quedan siempre en ARS. Es una limitación **declarada a propósito** (hay nota al
pie), no un olvido: `monthGainArs` ni siquiera tiene contraparte en USD en el tipo
`MonthlyPositionDetail`. Aun así rompe la expectativa del switch, y los tooltips de esas
columnas nunca aclaran que están en pesos.

**6. La atribución por ticker pierde las posiciones cerradas en el mes** —
`attributeMonthlyPositionGains` mapea sobre `endPositions`. Si vendiste todo un ticker
durante el mes, no queda fila para él, pero su resultado **sí** está dentro de la "Ganancia
mes" del total. El docstring (`valuation.ts:196-201`), su copia en `types.ts:78-80` y el
tooltip visible al usuario (`monthly-table.tsx:264`) afirman que las sumas coinciden — es
falso en ese escenario. *Latente: hoy no hay posiciones cerradas.*

**7. Renta sin instrumento asociado se descarta en silencio** — `classifyIncome` exige
`instrumentEligible`. En la base hay **36 de 124** filas de renta descartadas (casi todas
`TAX_WITHHOLDING` sin instrumento). Son costos reales que hoy no bajan el rendimiento.
*Impacto acotado en monto, pero es dato que se pierde.*

**8. Nombres que mienten en `view.ts summarize()`** — `bestMonthArs` / `worstMonthArs`
contienen valores en USD cuando la vista está en USD. Y los campos de la moneda inactiva se
llenan con `0` literal (`cumulativeGain`, `netInvested`, `maxDrawdown`) mientras que los
vecinos `cumulativeReturn` y `annualizedReturn` usan `null` correctamente. Funciona porque
solo `summaryForCurrency` los lee, pero es frágil e inconsistente.

**9. `priceIsStale` matchea por ticker, no por `instrumentId`** — dos instrumentos con el
mismo ticker se contaminarían. Se compone con el hallazgo 2: el ticker empujado por un
instrumento vendido o sin precio puede marcar a **otro** registro que comparta el string.
*Ya no es latente: hay 11 tickers duplicados (ver 1.b). Hoy no se dispara porque los gemelos
no tienen posición, pero la condición previa dejó de ser hipotética.*

### 🔎 Nota sobre las compras duplicadas

La base tiene **41 grupos de compras exactamente duplicadas** (mismo ticker, fecha,
cantidad, precio y `netAmount`, cada uno ×2). **Confirmado con el dueño de los datos: es
intencional**, no un import repetido. Queda anotado para que la próxima auditoría no lo
vuelva a levantar como incidente.

---

## 12. Mapa de archivos

```
src/app/(app)/rendimientos/page.tsx        Server component: arma el reporte (revalidate 300)
src/components/rendimientos/
  rendimientos-page.tsx                    Estado de período; lee moneda del CurrencyProvider
  performance-kpis.tsx                     Las 6 cards
  value-evolution.tsx                      Gráfico de valor
  monthly-return-chart.tsx                 Barras mensuales + benchmarks
  portfolio-vs-benchmark.tsx               Líneas de acumulado + benchmarks
  drawdown-chart.tsx                       Drawdown
  monthly-returns.tsx                      Heatmap año × mes
  monthly-table.tsx                        Detalle mensual + filas expandibles
  data-notices.tsx                         Avisos de calidad y exclusiones

src/lib/rendimientos/
  series.ts        Orquestador (único que toca Prisma)
  valuation.ts     valuatePortfolioAt — la cartera al cierre de una fecha  ★ núcleo
  returns.ts       Matemática pura: TWR, encadenado, drawdown, anualizado  ★ núcleo
  cashflows.ts     Clasificación de movimientos y el perímetro
  view.ts          Recorte por período + reencadenado + resumen
  benchmarks.ts    Construcción de series comparables
  price-series.ts  TimeSeries / PriceIndex con lookup as-of + forward-fill
  months.ts        Calendario mensual, todo en UTC
  types.ts         Tipos + alcance del cálculo

src/lib/transactions/holdings.ts           buildHoldings — compartido con dashboard y dividendos
src/lib/events/apply.ts                    applyEventsToTrade + adjustBarsForEvents  ★ núcleo
src/lib/market/history-sync.ts             Backfill EOD (source "yahoo-eod") + respaldo
src/lib/market/data912-eod.ts              Adaptador de data912 al formato EOD
src/lib/market/data912-history.ts          Fetcher crudo de data912 (compartido con /monitoreo)
src/lib/market/backfill.ts                 Orquestación de los backfills
```

**Regla del proyecto:** la lógica riesgosa vive en **módulos puros** con tests; el
orquestador de Prisma (`series.ts`) solo cablea. Por eso `returns.ts` y `valuation.ts`
tienen cobertura y `series.ts` no.

### Todo en UTC, a propósito

Las fechas de operación se guardan con hora (mediodía UTC en los imports) y los cierres EOD
a medianoche UTC. **Todas las comparaciones pasan por `toUtcDay()`.**

Comparar instantes en vez de días dejaba las compras del último día del mes **fuera** de la
valuación de ese mes mientras su capital **sí** contaba como flujo — una pérdida inventada
del tamaño exacto de esas compras. Un bug así solo aparece en producción y solo algunos
días del mes.
