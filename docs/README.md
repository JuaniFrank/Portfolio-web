# Documentación de sistemas — índice

Cada sistema tiene **un archivo autocontenido**. Si vas a trabajar en un sistema, leé
únicamente su archivo: incluye modelos de datos, archivos, flujo, reglas de negocio,
componentes y deuda técnica de ese sistema. No necesitás abrir los demás.

## Router: qué archivo leer

| Si vas a tocar… | Leé |
|---|---|
| Login, registro, sesión, protección de rutas, rate limit | [`sistema-auth.md`](./sistema-auth.md) |
| Precios, cotizaciones, CCL, catálogo de instrumentos, logos, cron | [`sistema-market-data.md`](./sistema-market-data.md) |
| Importar extractos de broker, parser Balanz, idempotencia | [`sistema-imports.md`](./sistema-imports.md) |
| Posiciones, PPP, historial de trades, alta manual, autocomplete | [`sistema-transacciones.md`](./sistema-transacciones.md) |
| Splits, cambios de ratio CEDEAR, ajuste de trades históricos | [`sistema-eventos-corporativos.md`](./sistema-eventos-corporativos.md) |
| Dividendos recibidos, retenciones, proyección de pagos | [`sistema-dividendos.md`](./sistema-dividendos.md) |
| ONs, valuación, TIR/duration, proyección de flujos, BondTerms | [`sistema-bonos.md`](./sistema-bonos.md) |
| KPIs, gráficos de asignación, concentración, top movers | [`sistema-dashboard.md`](./sistema-dashboard.md) |
| Sidebar, header, componentes shadcn, paleta, patrones visuales | [`sistema-ui-layout.md`](./sistema-ui-layout.md) |
| Schema de Prisma, enums, relaciones, migraciones | [`referencia-modelo-de-datos.md`](./referencia-modelo-de-datos.md) |
| Levantar el proyecto, env vars, comandos, agregar una feature | [`referencia-proyecto.md`](./referencia-proyecto.md) |

## Mapa de dependencias entre sistemas

Sirve para saber qué más puede romperse cuando tocás algo.

```
market-data ──► transacciones ──► dashboard
     │              │
     │              └──► eventos-corporativos (aplica ajustes antes del cálculo)
     │
     ├──► dividendos
     └──► bonos ──► transacciones + dashboard  (vía portfolio-bridge)

imports ──► escribe Transaction ──► lo consumen transacciones, dividendos, bonos, dashboard
auth ──► gate de TODAS las server actions
```

**Efectos cruzados a tener en cuenta:**

- Tocar `buildHoldings` (`src/lib/transactions/holdings.ts`) impacta transacciones, dashboard,
  dividendos y eventos. Es la función más compartida del repo.
- Tocar `markToMarket` o `buildBondHoldings` impacta bonos, transacciones y dashboard.
- Tocar el parser de Balanz impacta todo lo que lea `Transaction`.
- Agregar un `InstrumentType` a `TRADE_INSTRUMENT_TYPES` lo hace aparecer en transacciones
  **y** en el dashboard a la vez.

## Estado de cada sistema

| Sistema | Estado | Ruta principal |
|---|---|---|
| Auth | ✅ Funcional (sin reset de contraseña) | `/login`, `/register` |
| Market data | ✅ Funcional | — (capa transversal) |
| Imports | ✅ Funcional (solo Balanz) | `/imports` |
| Transacciones | ✅ Funcional | `/transactions` |
| Eventos corporativos | ✅ Funcional | `/events` |
| Dividendos | ✅ Funcional | `/dividends` |
| Bonos (ONs) | ✅ Funcional (v1 + v2) | `/bonds` |
| Dashboard | ✅ Funcional | `/dashboard` |
| Portfolios | 🚧 Placeholder | `/portfolios` |
| Brokers | 🚧 Placeholder | `/brokers` |
| Instrumentos | 🚧 Placeholder | `/instruments` |
| Settings | 🚧 Placeholder | `/settings` |

## Documentos previos

`DIVIDENDS_FEATURE.md` (raíz del repo) es un análisis técnico anterior de dividendos.
Está superado por [`sistema-dividendos.md`](./sistema-dividendos.md), que lo incluye y amplía.
