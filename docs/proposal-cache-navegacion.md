# Proposal técnica — Caché de cálculos para navegación rápida

Estado: propuesta. No implementar todavía.

Convención: **[V]** = hecho verificado en código o en los docs de Next 16.2.6 instalados (se cita ruta/línea). **[A]** = suposición que hay que confirmar antes de decidir.

## 0. Decisión ejecutiva

- Las capas 1–2 (skeletons `loading.tsx` y streaming con `<Suspense>`) mejoran la velocidad **percibida**. Esta capa 3 apunta a reducir el tiempo **real** de servidor.
- **Paso 0, obligatorio y previo a cualquier caché: medir.** Los únicos números existentes (~840 ms / ~1386 ms) son de la fase 2 y de la DB de desarrollo. No hay mediciones separadas de tiempo de DB vs. cómputo, ni en producción.
- Recomendación provisoria: **Opción A** (sin `cacheComponents`), cacheando con `unstable_cache` las **lecturas históricas** (inputs del replay) por `portfolioId`, y dejando fuera del caché la capa de precios en vivo y la autenticación. Invalidar con `revalidateTag` desde las server actions y los crons.
- **No habilitar `cacheComponents` solo por esto.** Es un cambio global (elimina `revalidate`/`dynamic` por segmento) y la ganancia no la justifica hoy. Reevaluar si se decide migrar por otros motivos.
- **Opción C** (serie materializada por cron) queda como escalón siguiente, únicamente si la A no alcanza tras medir. Ya está anticipada en el comentario de `src/app/(app)/rendimientos/page.tsx:12-21`.
- Regla de seguridad no negociable: ninguna clave de caché sin `portfolioId` (o `userId`) y ninguna lectura de cookies/sesión dentro del scope cacheado.

## 1. Problema y evidencia

### Qué es lento

- **[V]** `buildPerformanceReport` (`src/lib/rendimientos/series.ts:89`) hace `transaction.findMany` (`:96`) y luego un `Promise.all` con `priceCache`, `fxRate`, tres `macroSeries`, `corporateEvent` y `fetchLiveOverlayInputs` (`:166-210`). Después replaya la valuación con `valuatePortfolioAt` (`:298`).
- **[V]** `loadPortfolioEvolution` (`src/lib/dashboard/evolution-data.ts:75`) hace `transaction.findMany` (`:82`) y un `Promise.all` con `priceCache`, `corporateEvent`, otro `priceCache` e `instrument` (`:129-160`).
- **[V]** `/rendimientos` lanza ambos en paralelo (`src/app/(app)/rendimientos/page.tsx:58-59`); `/dashboard` lanza `loadPortfolioEvolution` detrás de `loadCclSeries` (`src/app/actions/dashboard.ts:68-71`).
- **[V]** `getDashboardPageDataAction` (`src/app/actions/dashboard.ts:44`) además llama `refreshLatestQuotes` y `fetchOnPrices` (`:185-188`), `resolveCclRate` y consultas de transacciones/eventos (`:76-118`). Esto es "precio de ahora" y no debe cachearse como histórico.
- **[V]** `getCurrentUser` (`src/lib/auth.ts:86-96`) llama `auth()` (NextAuth, sesión JWT, `:16`) y luego `prisma.user.findUnique`. Lee la cookie de sesión, por lo que **toda la página es dinámica** y el caché por usuario nunca puede depender de la cookie dentro del scope cacheado.

### Mediciones existentes (viejas)

- **[V]** `odd/tasks/dashboard-reorg-phase2.md:95` y `:138-139`: `buildPerformanceReport` solo ~840 ms; reporte + evolución en paralelo ~1386 ms, sobre la DB real de desarrollo.
- **[A]** Esos tiempos pueden haber cambiado (más movimientos, cambios en el motor, latencia distinta en Vercel). Tampoco se sabe qué fracción es red/DB y qué fracción es CPU del replay. **Esa proporción decide la estrategia**: si domina la DB, conviene cachear inputs; si domina el cómputo, conviene cachear el resultado del replay.

### Hallazgo sobre el caché actual

- **[V]** `rendimientos/page.tsx:22` exporta `revalidate = 300`, pero la página llama `getCurrentUser()` (cookies) en `:25`.
- **[A]** Es probable que ese `revalidate` no cachee nada útil, porque la ruta es dinámica por leer la sesión. Verificarlo midiendo (dos navegaciones seguidas con logs de tiempo) antes de asumirlo. Si se confirma, el comentario del archivo sobre "5 minutos de caché" describe una protección inexistente.
- **[V]** Ninguna acción llama `revalidatePath("/rendimientos")` (ver sección 4). Aun si el `revalidate` funcionara, un movimiento nuevo no refrescaría esa vista antes de 5 minutos.

## 2. Opciones

### Opción A — Sin `cacheComponents`: `unstable_cache` + `React.cache`

- **[V]** `unstable_cache` sigue disponible en 16.2.6, pero el doc dice que "has been replaced by `use cache`" y recomienda migrar (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md:6-8`). Es la forma documentada para proyectos sin Cache Components (`.../02-guides/caching-without-cache-components.md`, sección "`unstable_cache` for non-`fetch` functions").
- **[V]** Acepta `tags` y `revalidate` y persiste "across requests and deployments" (`unstable_cache.md`, Good to know). No permite `cookies()`/`headers()` dentro: hay que leerlos afuera y pasar el valor como argumento (mismo archivo).
- **[V]** `revalidate`/`dynamic` por segmento siguen funcionando en este modelo (`caching-without-cache-components.md`, "Route segment config").
- `React.cache` sirve para deduplicar dentro de **un** request (p. ej. `loadCclSeries` compartido entre dashboard y evolución), no para persistir entre navegaciones.
- Pros: cambio local, sin tocar `next.config`, sin migración de rutas. Contras: API marcada como reemplazada; riesgo de que se retire en una versión futura **[A]**.

### Opción B — Habilitar `cacheComponents` + `'use cache'`

- **[V]** `'use cache'` genera la clave a partir de argumentos serializables y variables capturadas (`.../01-directives/use-cache.md:76-99`). Entradas y salidas deben ser serializables (`:101-131`): instancias de clase (incluido `Decimal`/`Prisma.Decimal`) no sirven, hay que devolver DTOs planos.
- **[V]** No puede leer `cookies()`/`headers()` directamente; se leen afuera y se pasan como argumento (`use-cache.md:196`). `'use cache: private'` sí permite cookies, pero **no guarda nada en el servidor**, solo en memoria del navegador, y está marcado `experimental` (`use-cache-private.md:15,28`). Por tanto no acelera el cálculo costoso.
- **[V]** Almacenamiento: en memoria (LRU). En serverless "cache entries typically don't persist across requests" (`use-cache.md:204-207`). Para persistir entre instancias hace falta `'use cache: remote'` / `cacheHandlers` (`use-cache-remote.md:25,50`), con costo de latencia y de plataforma.
- **[V]** `dynamic`, `dynamicParams`, `revalidate` y `fetchCache` se **eliminan** al habilitar Cache Components (`.../03-file-conventions/02-route-segment-config/index.md:19`). Hay una guía de migración (`.../02-guides/migrating-to-cache-components.md`). Afecta a `export const revalidate = 300` en `rendimientos/page.tsx:22` y a los `export const dynamic = "force-dynamic"` de los crons (`src/app/api/cron/*/route.ts`, p. ej. `snapshots/route.ts:7`).
- **[V]** Invalidación: `updateTag` solo desde Server Actions, semántica read-your-own-writes (`.../04-functions/updateTag.md:6-16`); `revalidateTag(tag, "max")` sirve en Route Handlers y la forma de un solo argumento está deprecada (`revalidateTag.md:20-24,55`).
- **[V]** `cacheLife` define `stale`/`revalidate`/`expire` (`cacheLife.md:86-88`).
- Pros: modelo oficial y futuro; permite PPR e instant navigation (`.../02-guides/instant-navigation.md`). Contras: migración global, toda la app pasa a "dinámico por defecto con Suspense obligatorio" **[A: impacto exacto en las 15+ rutas sin medir]**, y en Vercel el persistente requiere handler remoto **[A: no verificado que Vercel lo provea sin configuración]**.

### Opción C — Precomputación persistida (serie diaria materializada por cron)

- Un cron (ya hay infraestructura: `vercel.json` programa `snapshots` a las 03:00 y `backfill-prices` a las 21:00) calcula y guarda la serie histórica por portfolio; las páginas solo leen y superponen el precio en vivo.
- Pros: tiempo de lectura casi constante. Contras: reintroduce el riesgo que motivó el rediseño a replay: un histórico desactualizado (`rendimientos/page.tsx:12-21` y memoria "Rediseño de /rendimientos a replay"). Solo es aceptable como **caché reconstruible** con una clave de versión, nunca como fuente de verdad. Más superficie: tabla nueva, backfill, invalidación por movimiento.

### Comparación

| Criterio | A: `unstable_cache` | B: `cacheComponents` | C: materializado |
|---|---|---|---|
| Alcance del cambio | Local a 2-3 loaders | Global (config + rutas) | Tabla + cron + lectura |
| Persiste entre instancias en Vercel | Sí **[A]** (Data Cache de Next) | Solo con `remote`/handler | Sí (DB) |
| Riesgo de dato viejo | Medio (tags) | Medio (tags) | Alto sin versión |
| Estabilidad de API | Marcada "replaced" | Oficial | N/A |
| Esfuerzo | Bajo | Alto | Medio-alto |

**Recomendación:** A, tras confirmar con el paso 0 que hay ganancia. B solo si hay una decisión independiente de migrar. C solo si A no alcanza.

## 3. Diseño propuesto (Opción A)

### 3.1 Principio: separar histórico de "ahora"

- **[V]** Hoy el overlay en vivo está **dentro** de `buildPerformanceReport` (`series.ts:209`, `:219-240`): precios de data912 (revalidate 60 s, `live-quotes.ts:16`) y CCL de hoy se superponen a la última barra. Por eso **no se puede cachear el reporte entero**: congelaría el precio de ahora.
- Diseño: partir la carga en (1) **lectura histórica cacheable** y (2) **overlay + cómputo**, que sigue corriendo por request.

### 3.2 Qué se cachea

| Función cacheada | Contenido | Clave | Tags | TTL |
|---|---|---|---|---|
| `getReplayInputs(portfolioId)` | transacciones del portfolio + eventos corporativos de sus instrumentos, como DTOs planos | `["replay-inputs", portfolioId]` | `portfolio:<id>:ledger` | `revalidate: 3600` (red de seguridad) |
| `getEodPrices(instrumentIds, fromDay)` | filas `priceCache` EOD (`source=yahoo-eod` y equivalentes) | `["eod-prices", sortedIds, fromDay]` | `prices` | hasta el cron `backfill-prices` |
| `getMacroAndFx(fromDay)` | `fxRate` (CCL) y `macroSeries` | `["macro-fx", fromDay]` | `macro` | hasta el cron `backfill-macro` |

- **[V]** Los dos primeros bloques son datos de **lectura**: precios EOD, CCL y macro no son por usuario y pueden compartirse; transacciones y eventos sí son por portfolio.
- **[A]** Si el cuello es CPU (replay) y no DB, habría que cachear también el resultado de `valuatePortfolioAt` por día para evitar recomputar; se decide con la medición. La forma sería `getHistoricalValuations(portfolioId, ledgerVersion)` con DTOs planos, y el overlay se aplica fuera.
- Serialización: `unstable_cache` serializa a JSON. `Decimal`, `Date` y `Map` no sobreviven (`Date` pasa a string). Los DTOs deben ser primitivos (`string` ISO, `number` o `string` decimal) y el consumidor los rehidrata. Esto es parte real del costo de implementación.

### 3.3 Qué permanece dinámico

- `getCurrentUser()`/`auth()`: lee cookies y nunca va dentro de un scope cacheado (**[V]** `unstable_cache.md` lo prohíbe).
- Overlay en vivo: `fetchLiveOverlayInputs`, `refreshLatestQuotes`, `fetchOnPrices`, `resolveCclRate`.
- El `findFirst` del portfolio por `userId` (barato, y es la barrera de autorización).
- `/dashboard`: posiciones y KPIs "de hoy" siguen calculándose por request; solo la serie evolutiva se beneficia.

### 3.4 Aislamiento por usuario (seguridad)

1. El `portfolioId` se resuelve **siempre** con `where: { userId: user.id }` fuera del caché; recién entonces se pasa a la función cacheada. Nunca se acepta un `portfolioId` de input del cliente sin esa verificación.
2. Toda clave de caché de datos del usuario incluye `portfolioId` como argumento (no como variable implícita), y los tags son por portfolio.
3. Prohibido cachear funciones que reciban `userId` implícito desde sesión o cookies.
4. Test obligatorio: dos usuarios con portfolios distintos nunca comparten entrada; un portfolio ajeno devuelve vacío/error y no una entrada cacheada de otro.
5. Los datos compartidos (precios EOD, macro) no llevan información de usuario en la clave ni en el valor.

## 4. Invalidación

Lo verificado en código (**[V]** `rg revalidatePath src/`): sólo hay `revalidatePath` en `src/app/actions/{imports,transactions,events,suggested-events}.ts`; ninguna toca `/rendimientos`. Las rutas de cron no invalidan nada hoy.

| Origen | Evidencia | Qué cambia | Invalidar |
|---|---|---|---|
| `createTransactionAction` | `transactions.ts:459` (`create`), `:478-479` revalidate | libro del portfolio | `portfolio:<id>:ledger` |
| Importación de movimientos | `imports.ts:297,455` → `revalidateImportConsumers` (`:467-472`) | libro del portfolio (masivo) | `portfolio:<id>:ledger` |
| Evento corporativo creado/borrado | `events.ts:238` / `:322`, revalidate `:261-264` / `:324-327` | splits y ajustes | `portfolio:<id>:ledger` (los eventos viajan con el libro) |
| Eventos sugeridos descartados | `suggested-events.ts:100,120` | solo UI de eventos | ninguno |
| Alta de instrumento/broker/cuenta | `transactions.ts:372-423` | catálogo | `portfolio:<id>:ledger` (ya implicado por la transacción) |
| Términos de bonos | `bond-terms.ts:186,331` | valuación de ON/bonos | `portfolio:<id>:ledger` o tag `bond-terms` **[A: confirmar si entran al replay]** |
| Cron `backfill-prices` (21:00) | `vercel.json`; `backfill.ts:89` | `priceCache` EOD | `prices` |
| Cron `backfill-macro` (03:30) | `vercel.json`; `backfill.ts:41` | `fxRate`/`macroSeries` | `macro` |
| Cron `sync-catalog` (07:00) | `vercel.json` | catálogo de instrumentos | tag existente `instrument-catalog` (ya en `data912-universe.ts:73`) |
| Cron `snapshots` (03:00) | `snapshots/route.ts:35` | `PortfolioSnapshot` | ninguno (el replay no usa snapshots) |
| `loadMonitoringHistoryAction` | `src/app/actions/monitoreo.ts:103` | carga bajo demanda de históricos | `prices` **[A: confirmar que escribe `priceCache`]** |

- Los tags `fetch` existentes (`on-prices`, `data912-live`, `argentinadatos`, `instrument-catalog`, `fmp-hist-*`, `data912-hist-*`; `src/lib/market/*.ts`) cubren las respuestas HTTP y **no** deben mezclarse con los nuevos tags de lecturas a Prisma.
- Mecanismo en A: `revalidateTag(tag)` de `next/cache`. **[V]** En 16.2.6 la forma de un argumento está deprecada (`revalidateTag.md:55`); usar `revalidateTag(tag, "max")` (stale-while-revalidate) en crons y, en acciones donde el usuario debe ver su cambio al instante, expirar de inmediato con `revalidateTag(tag, { expire: 0 })` (`revalidateTag.md:136`). Confirmar en la implementación si el modelo A admite `updateTag` (el doc lo presenta junto a Cache Components) **[A]**.
- Después de invalidar, mantener los `revalidatePath` existentes para refrescar el router cache de las vistas.
- Centralizar todo en un único módulo (`src/lib/cache/tags.ts`) con funciones `ledgerTag(portfolioId)`, `PRICES_TAG`, `MACRO_TAG`, para que la superficie de invalidación sea auditable y no queden strings sueltos.

## 5. Plan por pasos

1. **Medir (sin caché).** Instrumentar con `performance.now()` y `console.time` (solo en dev/flag) dentro de `buildPerformanceReport`, `loadPortfolioEvolution` y `getDashboardPageDataAction`: tiempo de cada query, de `fetchLiveOverlayInputs`, de `valuatePortfolioAt` y total. Correr en dev y, si es posible, en un preview de Vercel. Registrar en el doc de ODD. Con esto: confirmar si el problema es DB o CPU, y si `revalidate = 300` hoy cachea algo.
2. **Decisión go/no-go.** Si el servidor tarda poco (p. ej. por debajo de ~300 ms por vista **[A: umbral a acordar]**), no cachear: las capas 1-2 alcanzan.
3. **Refactor sin cambio de comportamiento.** Separar en `series.ts` la carga histórica del overlay en vivo; DTOs planos; tests con fixtures (hay `valuation.test.ts`, `evolution.test.ts`, `evolution-view.test.ts`).
4. **Módulo de tags** (`src/lib/cache/tags.ts`) y `getReplayInputs` con `unstable_cache`, solo para `/rendimientos`.
5. **Invalidación** en acciones y crons según la sección 4; test de integración "crear transacción → el reporte refleja el cambio en la próxima carga".
6. **Extender** a la evolución del `/dashboard` y a precios/macro compartidos.
7. **Reevaluar** C o B solo con datos de la medición posterior.

Cada paso es un commit chico y reversible (quitar el wrapper devuelve el comportamiento actual).

## 6. Criterios de aceptación

- Existe una medición antes/después, en la misma base y condiciones, anotada en la tarea.
- Segunda navegación a `/rendimientos` y `/dashboard`: reducción del tiempo de servidor de la serie histórica según la meta fijada en el paso 2 (propuesta: al menos 50% **[A]**).
- Tras crear/importar una transacción o crear/borrar un evento, la siguiente carga refleja el cambio sin esperar un TTL.
- El precio y CCL en vivo siguen actualizándose (≤ 60 s, `live-quotes.ts:16`); la última barra nunca queda congelada.
- Test de aislamiento: dos usuarios no comparten entradas de caché; un `portfolioId` ajeno no devuelve datos.
- Los resultados numéricos de las vistas son idénticos con y sin caché (comparación sobre fixtures).
- `npm run build`, lint y tests existentes pasan.

## 7. Riesgos y decisiones pendientes

- **Dato viejo tras una mutación.** Es el riesgo principal. Mitigación: un único módulo de tags, tests de invalidación y TTL corto como red de seguridad. Pendiente: ¿se acepta stale-while-revalidate tras importar, o se exige lectura inmediata del cambio?
- **Imports masivos y borrados.** Cualquier camino que escriba `transaction`/`corporateEvent` fuera de las acciones listadas (scripts, seeds) deja el caché viejo. Revisar scripts de mantenimiento.
- **Persistencia en Vercel.** **[A]** El Data Cache que respalda `unstable_cache` persiste entre invocaciones en Vercel; hay que verificarlo en un preview (log de hit/miss), no asumirlo. Para B, el doc advierte que la caché en memoria no persiste entre instancias serverless (`use-cache.md:206`).
- **Crons en Vercel.** Los crons son Route Handlers: sólo `revalidateTag` es utilizable allí (`updateTag` es exclusivo de Server Actions, `updateTag.md:12`). No hay Python (memoria del proyecto "Crons en Vercel").
- **Costo de migrar a `cacheComponents`.** Elimina `revalidate`/`dynamic`/`fetchCache` (`route-segment-config/index.md:19`), exige revisar cada ruta `(app)` y los crons con `force-dynamic`, y cambia el modelo de render. No es parte de esta propuesta.
- **API `unstable_cache` marcada como reemplazada.** Aislar su uso detrás de un helper (`cachedByTag`) para poder migrar a `'use cache'` sin tocar los loaders.
- **Serialización.** Convertir `Decimal`/`Date` a primitivos puede introducir errores de redondeo; mantener decimales como `string`.
- **Datos reales distintos.** El crecimiento de movimientos hace que hoy 840 ms no sea representativo; por eso el paso 1.
- **Decisiones pendientes para el usuario:** meta numérica del criterio de aceptación; tolerancia a datos levemente viejos tras mutaciones; si se quiere habilitar `cacheComponents` por motivos ajenos a esta propuesta.

## 8. Referencias

Docs de Next 16.2.6 (en `node_modules/next/dist/docs/01-app/`):

- `01-getting-started/08-caching.md`, `01-getting-started/09-revalidating.md`
- `02-guides/caching-without-cache-components.md`
- `02-guides/migrating-to-cache-components.md`
- `02-guides/instant-navigation.md`
- `03-api-reference/01-directives/use-cache.md`, `use-cache-private.md`, `use-cache-remote.md`
- `03-api-reference/04-functions/unstable_cache.md`, `cacheLife.md`, `cacheTag.md`, `revalidateTag.md`, `updateTag.md`
- `03-api-reference/05-config/01-next-config-js/cacheComponents.md`
- `03-api-reference/03-file-conventions/02-route-segment-config/index.md`

Código del proyecto:

- `src/lib/rendimientos/series.ts`, `src/lib/rendimientos/valuation.ts`
- `src/lib/dashboard/evolution-data.ts`
- `src/app/actions/dashboard.ts`
- `src/lib/market/live-quotes.ts`, `src/lib/market/backfill.ts`
- `src/lib/auth.ts`
- `src/app/(app)/rendimientos/page.tsx`
- `src/app/actions/{transactions,events,imports,suggested-events,bond-terms,monitoreo}.ts`
- `src/app/api/cron/*/route.ts`, `vercel.json`

Tareas relacionadas: `odd/tasks/navigation-loading-states.md`, `odd/tasks/dashboard-reorg-phase2.md`. Estilo de referencia: `docs/proposal-monitoreo.md`.
