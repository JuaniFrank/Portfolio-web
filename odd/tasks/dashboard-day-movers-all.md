# Dashboard — Movimientos del día: Ver todo y ordenamiento

## Objective
Permitir en la sección "Movimientos del día" del Dashboard desplegar un "Ver todo" que muestre todas las posiciones que subieron y bajaron en el último cierre, con la posibilidad de ordenar por monto nominal ($ en la moneda activa) o porcentual (%), en vez de limitar a las 4/5 principales sin opciones de ordenamiento.

## Problem / Why
- En `src/lib/dashboard/evolution.ts`, `computeMovers` recortaba artificialmente los ganadores y perdedores a `MOVERS_PER_SIDE = 4`. Si una cartera tiene 20 posiciones con movimientos, las demás se descartaban antes de llegar a la UI.
- `DayMovers` (`src/components/dashboard/day-movers.tsx`) no tenía botón "Ver todo" ni estado de colapsado/expandido (a diferencia de otros componentes del dashboard como `TopMovers` que muestran 5 inicialmente).
- `DayMovers` mostraba las posiciones exclusivamente en el orden en que venían (ordenadas por `pnlArs`), sin opción de ordenar por variación porcentual de precio (`pricePercent`) o por monto nominal en USD cuando la vista está en dólares.

## Scope
1. **Conservar todos los movers en `EvolutionPoint`**:
   - En `src/lib/dashboard/evolution.ts`, `computeMovers` devuelve todas las posiciones con ganancia en `gainers` y con pérdida en `losers` sin truncar a 4.
   - En `src/components/dashboard/portfolio-evolution.tsx`, en el tooltip del gráfico de evolución, se limita la visualización a las primeras 4 posiciones (`row.gainers.slice(0, MOVERS_PER_SIDE)` / `row.losers.slice(0, MOVERS_PER_SIDE)`) para mantener el tooltip compacto.
   - Función pura `sortEvolutionMovers` con soporte para ganadores/perdedores, modo nominal/porcentual y ARS/USD, con resolución de empates por ticker.
   - Tests en `evolution.test.ts`.
2. **Interactividad y ordenamiento en `DayMovers`**:
   - Estado de colapso: mostrar las primeras 5 posiciones por columna de forma predeterminada (`COLLAPSED_COUNT = 5`).
   - Botón "Ver todo (N)" / "Ver menos" si hay más de 5 en alguna de las columnas con chevron animado.
   - Selector / toggle de ordenamiento: "Nominal" vs "Porcentual".
   - Criterio de ordenamiento:
     - **Nominal**: Ganadores ordenados por mayor ganancia monetaria (ARS o USD según `currency`); perdedores ordenados por mayor pérdida monetaria (más negativa primero).
     - **Porcentual**: Ganadores ordenados por mayor suba porcentual (`pricePercent` desc); perdedores ordenados por mayor baja porcentual (`pricePercent` asc / caída más profunda primero). Posiciones sin precio previo (`null`) al final.
     - Resaltado visual en la lista según el modo activo (el valor del modo activo toma el color de tono emerald/rose/etc. y el secundario queda sutil en zinc-500).
3. **Verificación**:
   - `pnpm test` (vitest): 593/593 passed en 48 suites.
   - `pnpm tsc --noEmit`: limpio (0 errores de tipos).
   - `pnpm eslint`: limpio en todos los archivos modificados.

## Tasks
- [x] T1 Backend / Engine: Conservar todos los movers en `computeMovers` en `src/lib/dashboard/evolution.ts`, limitar en el tooltip del chart (`portfolio-evolution.tsx`), y actualizar tests en `src/lib/dashboard/evolution.test.ts`. (Commit: `97ee5d5`)
- [x] T2 Frontend / UI: Agregar ordenamiento nominal/porcentual (`sortEvolutionMovers`) y desplegable "Ver todo" en `src/components/dashboard/day-movers.tsx`.
- [x] T3 Verificación: Ejecutar suite de tests completa (`pnpm test`), chequeo de tipos (`pnpm tsc --noEmit`) y linter.

## Progress & Evidence
- T1 implementado y testeado: `computeMovers` ya no recorta a 4, preservando la totalidad de posiciones con ganancia y pérdida. `PortfolioEvolutionChart` aplica `slice(0, MOVERS_PER_SIDE)` sobre el tooltip para mantenerlo compacto. Tests actualizados en `evolution.test.ts` (43 passed). Commit: `97ee5d5`.
- T2 implementado: añadida función pura `sortEvolutionMovers` en `evolution.ts` con 7 nuevos tests unitarios (50 passed en total en `evolution.test.ts`). En `DayMovers`:
  - `COLLAPSED_COUNT = 5`.
  - Toggle de modo de ordenamiento "Nominal" / "Porcentual".
  - Botón desplegable "Ver todo (N)" / "Ver menos" con íconos `ChevronDown` y `ChevronUp`.
  - Resaltado de tipografía según la métrica por la que se está ordenando.
- T3 verificado:
  - Vitest: 593 tests en 48 archivos pasaron sin fallos.
  - TypeScript: `pnpm tsc --noEmit` completó con código 0.
  - ESLint: completó con código 0 sin warnings ni errores.
