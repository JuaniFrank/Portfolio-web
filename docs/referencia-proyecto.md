# Referencia del proyecto — convenciones, setup y cómo agregar features

> Documento base. Cada sistema tiene su propio archivo autocontenido; este cubre lo transversal:
> stack, convenciones de arquitectura, variables de entorno, comandos y el recetario para
> agregar una feature nueva.

---

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js **16.2.6** (App Router, React Compiler activado) |
| UI | React **19.2.4**, Tailwind CSS **v4**, shadcn/ui (Radix + CVA + tailwind-merge) |
| Auth | Auth.js v5 (`next-auth@5.0.0-beta.30`), JWT + Credentials + bcrypt |
| DB | PostgreSQL + Prisma **6.19** |
| Dinero | `decimal.js` en dominio, `Prisma.Decimal(20,8)` en DB |
| Validación | Zod v3 + React Hook Form + `@hookform/resolvers` |
| Gráficos | Recharts 3 |
| Otros | date-fns, sonner, next-themes, xlsx |

> ⚠️ **Next.js 16 tiene cambios de API respecto de versiones anteriores.** Antes de escribir
> código de framework, consultá `node_modules/next/dist/docs/`. Dos ejemplos que ya aplican
> en este repo: `middleware.ts` se llama **`proxy.ts`**, y `params` de una page es una **Promise**
> (`const { id } = await params`).

---

## Arquitectura por capas

```
src/app/(app)/<ruta>/page.tsx        RSC — llama la action, redirige a /login si no hay sesión
        │
        ▼
src/app/actions/<dominio>.ts         "use server" — auth + Prisma + fetch externo + composición
        │
        ▼
src/lib/<dominio>/                   dominio PURO (sin I/O): build.ts, types.ts, …
src/lib/market/                      integraciones externas + caché
        │
        ▼
src/components/<dominio>/<x>-page.tsx  "use client" — recibe un DTO serializable y renderiza
```

### Reglas que sigue todo el código

1. **Las páginas RSC no consultan Prisma.** Siempre pasan por una server action.
2. **Las actions devuelven DTOs planos y serializables.** `Prisma.Decimal` → `string`,
   `Date` → ISO `string`. Un Decimal cruzando a un Client Component tira error en runtime.
   Ejemplo canónico: `toBondTermsDTO()` en `src/app/actions/bond-terms.ts`.
3. **El dominio en `src/lib/<x>/build.ts` es puro.** Recibe datos, devuelve estructura.
   Sin `fetch`, sin Prisma, sin `process.env`. Es lo que se puede testear sin DB.
4. **Toda action arranca con `getCurrentUser()`** y corta con `{ error: "unauthorized" }`
   (lecturas) o `{ ok: false, error }` (mutaciones).
5. **Nunca `number` para montos de negocio.** `Decimal` en dominio, `string` en DB→UI.
6. **Degradación elegante en toda fuente externa.** Un proveedor caído nunca rompe la página:
   fallback a caché con flag `stale`, o campo en `null` que la UI renderiza como `—`.

### Formato de retorno de las actions

```ts
// Lectura
Promise<PageData | { error: "unauthorized" }>

// Mutación (dos variantes conviviendo en el repo)
Promise<{ ok: true; data } | { ok: false; error: string }>          // mayoría
Promise<{ success: true; data } | { success: false; error: string }> // bond-terms
```

> La variante `success` solo la usa `bond-terms.ts`. Para código nuevo usá `ok`.

---

## Estructura de carpetas

```
src/
  app/
    (auth)/              login, register, reset-password — layout centrado
    (app)/               shell autenticado (sidebar + header)
    actions/             server actions por dominio
    api/
      auth/[...nextauth] handler de Auth.js
      cron/sync-catalog  endpoint del cron de Vercel
    layout.tsx           html, fuentes, AppProviders
    page.tsx             landing pública
  components/
    ui/                  shadcn copiado al repo (se edita directo)
    layout/              sidebar, header, switchers
    auth/                formularios de auth
    providers/           theme, session, toaster
    <dominio>/           componentes de cada sistema
  lib/
    generated/prisma/    cliente Prisma generado (NO editar)
    <dominio>/           dominio puro
    market/              integraciones externas
    importers/           parsers de broker
    auth.ts, prisma.ts, rate-limit.ts, utils.ts
  types/next-auth.d.ts   augmentación de Session/JWT
  proxy.ts               gate de rutas (ex middleware.ts)
prisma/
  schema.prisma, seed.ts, scripts/
docs/                    esta documentación
```

### Imports de Prisma

Siempre desde el cliente generado, **nunca** desde `@prisma/client`:

```ts
import { InstrumentType, Prisma, TransactionType } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
```

`src/lib/prisma.ts` es un singleton con caché en `globalThis` para sobrevivir al HMR.

---

## Rutas

| Grupo | Ruta | Estado |
|---|---|---|
| público | `/` | Landing con CTAs |
| `(auth)` | `/login`, `/register`, `/reset-password` | Funcional (reset sin backend) |
| `(app)` | `/dashboard` | ✅ |
| `(app)` | `/transactions` | ✅ |
| `(app)` | `/transactions/new` | Redirect → `/transactions` |
| `(app)` | `/dividends` | ✅ |
| `(app)` | `/bonds` | ✅ |
| `(app)` | `/events` | ✅ |
| `(app)` | `/imports`, `/imports/new` | ✅ |
| `(app)` | `/portfolios`, `/portfolios/[id]`, `/brokers`, `/instruments`, `/settings` | 🚧 `SectionPlaceholder` |
| API | `/api/auth/[...nextauth]` | Handler de Auth.js |
| API | `/api/cron/sync-catalog` | Cron diario 07:00 UTC |

---

## Variables de entorno

| Variable | Requerida | Para qué |
|---|---|---|
| `DATABASE_URL` | ✅ | Conexión PostgreSQL |
| `NEXTAUTH_SECRET` (o `AUTH_SECRET`) | ✅ | Firma de JWT |
| `NEXTAUTH_URL` | ✅ | URL base y `metadataBase` |
| `REGISTRATION_INVITE_CODE` | ⚠️ | **Sin ella el registro queda cerrado** |
| `CRON_SECRET` | recomendada | Protege `/api/cron/sync-catalog` |
| `NEXT_PUBLIC_LOGO_DEV_TOKEN` | opcional | Habilita logo.dev; sin ella solo queda Cocos |

> `.env.example` solo declara las tres primeras. Las otras tres están implementadas pero
> no documentadas ahí — conviene agregarlas.

---

## Comandos

```bash
pnpm install
pnpm dev              # next dev
pnpm build            # prisma generate && next build
pnpm start            # next start
pnpm lint             # next lint

pnpm run db:generate  # prisma generate
pnpm run db:push      # sincronizar schema sin migración (desarrollo)
pnpm run db:migrate   # prisma migrate dev (migración versionada)
pnpm run db:seed      # tsx prisma/seed.ts
pnpm run db:studio    # prisma studio
```

**Usuario demo del seed:** `demo@demo.com` / `demo1234`.

`docker-compose.yml` en la raíz levanta PostgreSQL local.

---

## Recetario: agregar una feature nueva

### 1. Tipos y dominio puro

```
src/lib/<feature>/types.ts     DTOs serializables (Decimal → string, Date → ISO)
src/lib/<feature>/build.ts     función pura: datos crudos → DTO de página
```

Sin I/O. Es lo que después se testea sin levantar la DB.

### 2. Integración externa (si aplica)

`src/lib/market/<proveedor>.ts`. Checklist obligatorio:

- [ ] `next: { revalidate: N, tags: [...] }` en el fetch.
- [ ] Persistir en `PriceCache` / `FxRate` si aplica.
- [ ] Fallback a caché con flag `stale` cuando el proveedor falla.
- [ ] Fallos por ítem acumulados en `errors[]`, nunca una excepción que tumbe la página.
- [ ] Si hacés upsert por tiempo, **truncar el timestamp a un bucket** — si usás `new Date()`
      crudo, el `WHERE` del upsert nunca matchea y la tabla crece sin límite.
- [ ] Si reconciliás un catálogo completo, **guard contra respuesta vacía** antes de borrar
      o desactivar nada.

### 3. Server action

```ts
// src/app/actions/<feature>.ts
"use server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function get<Feature>PageDataAction():
  Promise<<Feature>PageData | { error: "unauthorized" }> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const [a, b, c] = await Promise.all([/* queries en paralelo */]);
  // …fetch externo también en paralelo…
  return build<Feature>Data({ ... });   // toda la lógica en el build puro
}
```

Para mutaciones: validar con Zod → verificar ownership → escribir → `revalidatePath()` de
**todas** las rutas afectadas. Mirá `createCorporateEvent`, que revalida 4.

### 4. Página RSC

```tsx
// src/app/(app)/<feature>/page.tsx
import { redirect } from "next/navigation";

export default async function <Feature>RoutePage() {
  const data = await get<Feature>PageDataAction();
  if ("error" in data) redirect("/login");
  return <<Feature>Page data={data} />;
}
```

### 5. Componente cliente

```
src/components/<feature>/<feature>-page.tsx    "use client", recibe el DTO
src/components/<feature>/format.ts             formateadores es-AR
src/components/<feature>/<subcomponentes>.tsx
```

### 6. Registrar en el sidebar

Agregar la entrada al array `items` de `src/components/layout/sidebar.tsx`.

### 7. Si toca el modelo de datos

```bash
# editar prisma/schema.prisma
pnpm run db:push
pnpm run db:generate
```

Preferí cambios **aditivos** (así se agregó `BondTerms`). Ver
[`referencia-modelo-de-datos.md`](./referencia-modelo-de-datos.md).

### 8. Documentar

Crear `docs/sistema-<feature>.md` autocontenido y agregarlo al router de `docs/README.md`.

---

## Deuda técnica transversal

Lo específico de cada sistema está en su archivo. Acá va lo que cruza varios.

### 1. Tres formas distintas de resolver el CCL

| Consumidor | Cómo lo obtiene |
|---|---|
| `/dashboard` | `resolveCclRate()` — lee/persiste `FxRate`, refresca 1×/día |
| `/dividends`, `/bonds` | `fetchCclQuote()` — directo a dolarapi, sin persistir |
| `/transactions` | `prisma.fxRate.findFirst()` — **solo lee**, nunca siembra |

Efecto concreto: en una instalación nueva `/transactions` muestra `CCL: —` hasta que alguien
visite `/dashboard`, porque es el único que escribe la fila. **Fix:** que todos usen
`resolveCclRate()`.

### 2. Alcance de portfolio inconsistente

El dashboard filtra por **un** portfolio (el default); transacciones, dividendos y bonos usan
**todos** los del usuario (`portfolio: { userId }`). Con más de un portfolio los totales no
cuadran entre pantallas. Se resuelve cuando `/portfolios` y el `PortfolioSwitcher` dejen de
ser stubs.

### 3. Switchers del header sin efecto

`PortfolioSwitcher` está `disabled` y `CurrencySwitcher` no está conectado a nada — cada página
maneja su propio toggle ARS/USD en estado local. `user.displayCurrencyCode` existe en la sesión
pero no se usa en la UI.

### 4. `TRADE_INSTRUMENT_TYPES` acotado

`src/lib/transactions/types.ts` limita resumen e historial a `["STOCK_AR", "CEDEAR", "ON"]`.
Bonos soberanos (`BOND_AR`), letras (`LETRA`), FCI y cripto se importan a la DB pero **no
aparecen** en transacciones ni en el dashboard.

### 5. Duplicaciones

- `venueForType()` (`actions/transactions.ts`) y `venueFor()` (`importers/commit-import.ts`)
  son idénticas.
- Cuatro `format.ts` (`dashboard`, `dividends`, `events`, `bonds`) con formateadores solapados.
- El bloque de clases de `TabsTrigger` está copiado en 3 páginas.
- El bloque que arma el `eventsMap` (`instrumentId → CorporateEventForBuilder[]`) está repetido
  literalmente en las actions de dashboard, transacciones y dividendos.

### 6. Validación heterogénea

Casi todo usa Zod. `bond-terms.ts` usa una función manual de ~60 líneas.

### 7. Sin tests

No hay runner ni tests. El dominio puro (`holdings.ts`, `apply.ts`, `analytics.ts`,
`day-count.ts`, `cashflows.ts`, `balanz.ts`, `build.ts` de cada dominio) es 100% testeable sin
DB — es el lugar de mayor retorno si se agrega Vitest. Ya existe un fixture en
`src/lib/importers/fixtures/balanz-movimientos.ts` con el helper `parseBalanzFixtureRows()`.

### 8. Stubs declarados sin implementar

| Archivo | Intención |
|---|---|
| `src/lib/calculations/positions.ts` | Posiciones PPP/FIFO/LIFO centralizado |
| `src/lib/calculations/performance.ts` | TWR / MWR y series temporales |
| `src/lib/calculations/fx.ts` | Conversiones FX y reglas por fuente |
| `src/lib/market/bcra.ts`, `byma.ts` | Integraciones BCRA y BYMA directas |

Los cuatro son `export const TODO = true`. Hoy el cálculo de posiciones vive en
`src/lib/transactions/holdings.ts` (solo PPP).

### 9. Restos varios

- `console.log({ gross })` olvidado en `src/components/dividends/dividend-calendar.tsx`
  (dentro del `map` de `MonthDetail`).
- `movimientos.xlsx` con datos reales versionado en la raíz del repo.
- Botones de editar/eliminar en el historial de trades están `disabled` con título
  "(próximamente)".
