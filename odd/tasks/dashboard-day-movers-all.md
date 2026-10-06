# Dashboard — Movimientos del día: Ver todo y ordenamiento

## Objective
Permitir en la sección "Movimientos del día" del Dashboard desplegar un "Ver todo" que muestre todas las posiciones que subieron y bajaron en el último cierre, con la posibilidad de ordenar por monto nominal ($ en la moneda activa) o porcentual (%), en vez de limitar a las 4/5 principales sin opciones de ordenamiento.

## Problem / Why
- En `src/lib/dashboard/evolution.ts`, `computeMovers` recortaba artificialmente los ganadores y perdedores a `MOVERS_PER_SIDE = 4`. Si una cartera tiene 20 posiciones con movimientos, las demás se descartaban antes de llegar a la UI.
- `DayMovers` (`src/components/dashboard/day-movers.tsx`) no tenía botón "Ver todo" ni estado de colapsado/expandido (a diferencia de otros componentes del dashboard como `TopMovers` que muestran 5 inicialmente).
- `DayMovers` mostraba las posiciones exclusivamente en el orden en que venían (ordenadas por `pnlArs`), sin opción de ordenar por variación porcentual de precio (`pricePercent`) o por monto nominal en USD cuando la vista está en dólares.

## Scope
1. **Conservar todos los movers en `EvolutionPoint`**:
   - En `src/lib/dashboard/evolution.ts`, `computeMovers` debe devolver todas las posiciones con ganancia en `gainers` y con pérdida en `losers` sin truncar a 4.
   - En `src/components/dashboard/portfolio-evolution.tsx`, en el tooltip del gráfico de evolución, limitar la visualización a las primeras 4 posiciones (`row.gainers.slice(0, 4)` / `row.losers.slice(0, 4)`) para mantener el tooltip compacto.
   - Actualizar tests de `evolution.test.ts`.
2. **Interactividad y ordenamiento en `DayMovers`**:
   - Estado de colapso: mostrar las primeras 5 posiciones por columna de forma predeterminada (`COLLAPSED_COUNT = 5`).
   - Botón "Ver todos (N)" / "Ver menos" si hay más de 5 en alguna de las columnas.
   - Selector / toggle de ordenamiento: "Nominal" vs "Porcentual".
   - Criterio de ordenamiento:
     - **Nominal**: Ganadores ordenados por mayor ganancia monetaria (ARS o USD según `currency`); perdedores ordenados por mayor pérdida monetaria (más negativa primero).
     - **Porcentual**: Ganadores ordenados por mayor suba porcentual (`pricePercent` desc); perdedores ordenados por mayor baja porcentual (`pricePercent` asc / caída más profunda primero). Posiciones sin precio previo (`null`) al final.
3. **Verificación**:
   - `pnpm test` (vitest).
   - `pnpm tsc --noEmit`.
   - Verificación visual/funcional.

## Tasks
- [ ] T1 Backend / Engine: Conservar todos los movers en `computeMovers` en `src/lib/dashboard/evolution.ts`, limitar en el tooltip del chart (`portfolio-evolution.tsx`), y actualizar tests en `src/lib/dashboard/evolution.test.ts`.
- [ ] T2 Frontend / UI: Agregar ordenamiento nominal/porcentual y desplegable "Ver todos" en `src/components/dashboard/day-movers.tsx`.
- [ ] T3 Verificación: Ejecutar suite de tests completa (`pnpm test`) y chequeo de tipos (`pnpm tsc --noEmit`).
