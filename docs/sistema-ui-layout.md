# Sistema de UI y layout

> **Documento autocontenido.** Todo lo necesario para trabajar en el shell de la aplicación,
> los componentes compartidos y los patrones visuales está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS **v4** · shadcn/ui
  (Radix + `class-variance-authority` + `tailwind-merge`) · lucide-react · sonner · next-themes.
- **Tema:** oscuro fijo (`<html className="dark">`). No hay toggle de tema.
- **Idioma de la UI:** español rioplatense (`lang="es"`), formatos `es-AR`.

### Qué hace este sistema

El shell de la app (sidebar + header), los providers globales, la librería de componentes base
copiada de shadcn, y los patrones visuales que todas las pantallas repiten.

---

## Archivos

| Archivo | Rol |
|---|---|
| `src/app/layout.tsx` | Root layout: html, fuentes, `AppProviders` |
| `src/app/(app)/layout.tsx` | Shell autenticado: `Sidebar` + `Header` + `main` |
| `src/app/(auth)/layout.tsx` | Layout centrado para login/registro |
| `src/app/page.tsx` | Landing pública |
| `src/app/globals.css` | Estilos globales, tokens de Tailwind v4, animación `indeterminate-bar` |
| `src/components/layout/sidebar.tsx` | Navegación lateral |
| `src/components/layout/header.tsx` | Barra superior con menú de usuario |
| `src/components/layout/portfolio-switcher.tsx` | **Stub deshabilitado** |
| `src/components/layout/currency-switcher.tsx` | **Stub sin efecto** |
| `src/components/layout/section-placeholder.tsx` | Placeholder de secciones no implementadas |
| `src/components/providers/app-providers.tsx` | Composición de providers |
| `src/components/providers/theme-provider.tsx` | `next-themes` |
| `src/components/providers/session-provider.tsx` | `SessionProvider` de next-auth |
| `src/components/ui/*` | 12 componentes shadcn |
| `src/lib/utils.ts` | `cn()` — `twMerge(clsx(...))` |
| `components.json` | Config de la CLI de shadcn |

---

## Root layout

`src/app/layout.tsx`:

```tsx
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000"),
  title: { default: "Portafolio", template: "%s · Portafolio" },
  description: "Portfolio manager (Argentina) — esqueleto técnico",
};

export default async function RootLayout({ children }) {
  const session = await auth();     // ← sesión resuelta en el servidor
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-zinc-950 font-sans text-zinc-100 antialiased`}>
        <AppProviders session={session}>{children}</AppProviders>
      </body>
    </html>
  );
}
```

- `className="dark"` está **hardcodeado**: no hay modo claro.
- `suppressHydrationWarning` es necesario porque `next-themes` toca el `<html>` en el cliente.
- `await auth()` pasa la sesión al provider y evita el flash de "no autenticado" en el `Header`.
- El `template` del title hace que cualquier page que exporte `metadata.title` quede
  `"Algo · Portafolio"`. **Hoy ninguna page lo exporta.**

### `AppProviders`

```tsx
<ThemeProvider>
  <AppSessionProvider session={session}>
    {children}
    <Toaster richColors theme="dark" position="top-center" />
  </AppSessionProvider>
</ThemeProvider>
```

El `Toaster` de sonner está dentro del árbol, así que `toast.success(...)` /
`toast.error(...)` funciona desde cualquier componente cliente.

---

## Shell autenticado

`src/app/(app)/layout.tsx`:

```tsx
<div className="flex min-h-dvh bg-zinc-950">
  <Sidebar />
  <div className="flex min-w-0 flex-1 flex-col">
    <Header />
    <main className="flex-1 p-6">{children}</main>
  </div>
</div>
```

El `min-w-0` en la columna derecha es lo que evita que una tabla ancha desborde el layout.

> Ojo: `<main>` ya tiene `p-6`. La mayoría de las páginas no agrega padding propio, pero
> `events-page.tsx` sí (`className="flex flex-1 flex-col gap-6 p-6"`), lo que duplica el padding
> en esa pantalla. Inconsistencia menor.

### `Sidebar`

```tsx
const items = [
  { href: "/dashboard",    label: "Dashboard",     icon: LayoutDashboard },
  { href: "/portfolios",   label: "Portfolios",    icon: Wallet },
  { href: "/transactions", label: "Transacciones", icon: LineChart },
  { href: "/dividends",    label: "Dividendos",    icon: Coins },
  { href: "/bonds",        label: "Bonos (ONs)",   icon: Landmark },
  { href: "/events",       label: "Eventos",       icon: CalendarSync },
  { href: "/imports",      label: "Imports",       icon: Download },
  { href: "/brokers",      label: "Brokers",       icon: Building2 },
  { href: "/instruments",  label: "Instrumentos",  icon: Shapes },
  { href: "/settings",     label: "Settings",      icon: Settings },
] as const;
```

**Acá se registra una pantalla nueva.**

Ancho fijo `w-64`. El estado activo se resuelve con
`pathname === item.href || pathname.startsWith(`${item.href}/`)`, así que `/imports/new` marca
"Imports" como activo.

Activo: `bg-zinc-900 text-zinc-50 ring-1 ring-zinc-800`.
Inactivo: `text-zinc-300 hover:bg-zinc-900/70`.

> **No es responsive.** El sidebar siempre ocupa 256 px, incluso en mobile. No hay drawer ni
> botón de colapsar.

### `Header`

Altura `h-14`. Izquierda: link "Portafolio" + `PortfolioSwitcher`.
Derecha: `CurrencySwitcher` + dropdown de usuario.

El dropdown muestra nombre/email y tiene dos ítems: `Settings` (link) y `Logout`:

```tsx
<DropdownMenuItem onSelect={(e) => {
  e.preventDefault();                        // ← evita que Radix cierre antes del signOut
  void signOut({ callbackUrl: "/" });
}}>
```

Usa `useSession()` — por eso el root layout pasa la sesión inicial desde el servidor.

### Los dos switchers son stubs

```tsx
// portfolio-switcher.tsx
<Select disabled>
  <SelectTrigger aria-label="Portfolio">
    <SelectValue placeholder="Portfolio (próximamente)" />
  </SelectTrigger>
  <SelectContent><SelectItem value="stub">stub</SelectItem></SelectContent>
</Select>

// currency-switcher.tsx
<Select defaultValue="ARS">   // ← no está conectado a nada
  <SelectContent>
    <SelectItem value="ARS">ARS</SelectItem>
    <SelectItem value="USD">USD</SelectItem>
  </SelectContent>
</Select>
```

- `PortfolioSwitcher` está `disabled`. Cambiar de portfolio no es posible hoy.
- `CurrencySwitcher` **no tiene `onValueChange`**: cambiar el valor no hace nada.
  Cada página (dashboard, dividendos) maneja su propio toggle ARS/USD en estado local.
- `user.displayCurrencyCode` existe en la sesión pero ninguna UI lo lee.

### `SectionPlaceholder`

```tsx
export function SectionPlaceholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">{title}</h1>
      {subtitle ? <p className="text-sm text-zinc-500">{subtitle}</p> : null}
      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        Esta sección será implementada en la siguiente fase.
      </p>
    </div>
  );
}
```

Lo usan `/portfolios`, `/portfolios/[id]`, `/brokers`, `/instruments` y `/settings`.

---

## Layout de auth

`src/app/(auth)/layout.tsx` — grid centrado, `max-w-md`:

```tsx
<div className="grid min-h-dvh place-items-center bg-zinc-950 p-6">
  <div className="w-full max-w-md">{children}</div>
</div>
```

Los tres formularios (`login`, `register`, `reset-password`) usan `Card` con
`CardHeader` / `CardContent` / `CardFooter`.

---

## Componentes `ui/` (shadcn copiado al repo)

12 componentes en `src/components/ui/`. **Se editan directamente**, no son dependencia externa.

| Componente | Base | Notas |
|---|---|---|
| `button.tsx` | Radix Slot + CVA | Variantes: `default`, `outline`, `ghost`, `destructive`, `secondary`, `link`. Tamaños: `default`, `sm`, `lg`, `icon`. Soporta `asChild` |
| `card.tsx` | — | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| `dialog.tsx` | `@radix-ui/react-dialog` | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` |
| `dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | 180 líneas, el más grande |
| `select.tsx` | `@radix-ui/react-select` | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` |
| `tabs.tsx` | `@radix-ui/react-tabs` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| `table.tsx` | — | `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell` |
| `input.tsx` | — | Input con estilos consistentes |
| `label.tsx` | `@radix-ui/react-label` | — |
| `badge.tsx` | CVA | Variantes: `default`, `secondary`, `destructive`, `success` |
| `separator.tsx` | `@radix-ui/react-separator` | — |
| `skeleton.tsx` | — | Placeholder animado |

### `cn()` — el helper universal

```ts
// src/lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`twMerge` resuelve conflictos de clases Tailwind: `cn("p-2", "p-4")` → `"p-4"`.
Usalo siempre que mezcles clases base con clases de prop.

### Componentes propios reutilizados entre sistemas

| Componente | Ubicación | Lo usan |
|---|---|---|
| `TickerAvatar` | `components/transactions/` | transacciones, dashboard, dividendos, bonos |
| `ChartCard` | `components/dashboard/` | solo dashboard (pero es genérico) |
| `SectionPlaceholder` | `components/layout/` | 5 rutas placeholder |

`TickerAvatar` vive en `transactions/` por historia, pero es transversal. Ver
`sistema-market-data.md` para la cadena de logos.

---

## Patrones visuales

Estos patrones se repiten en todas las pantallas. Seguilos al agregar una feature.

### Paleta

| Uso | Clase |
|---|---|
| Fondo de página | `bg-zinc-950` |
| Superficie de card | `bg-zinc-900/40` o `bg-zinc-900/50` |
| Borde | `border-zinc-800` |
| Texto principal | `text-zinc-50` / `text-zinc-100` |
| Texto secundario | `text-zinc-400` |
| Texto terciario / labels | `text-zinc-500` |
| **Acento** | `teal-500` / `teal-400` |
| Positivo | `emerald-400` |
| Negativo | `red-400` / `rose-400` |
| Advertencia | `amber-400` / `amber-200` |
| Estimaciones / futuro | `violet-300` / `violet-500` |
| ONs | `indigo` (`#6366f1`) |

### Header de página

```tsx
<div className="space-y-2">
  <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Título</h1>
  <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
    Una o dos líneas explicando qué muestra la pantalla.
  </p>
</div>
```

El `max-w-2xl` mantiene la línea legible. Cuando hay una acción principal, va en un
`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between` con el botón a la derecha.

### Tabs

```tsx
<TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
  <TabsTrigger
    value="x"
    className="rounded-none border-b-2 border-transparent px-4 pb-2 data-[state=active]:border-teal-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
  >
    Etiqueta
  </TabsTrigger>
</TabsList>
```

> Este bloque de clases está **copiado literalmente** en transacciones, dividendos y bonos.
> Candidato claro a extraer como `<UnderlineTabsTrigger>`.

### Banner de degradación

```tsx
<div className="flex items-start gap-3 rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
  <div>Explicación de qué falta y qué implica.</div>
</div>
```

Usado en dashboard (CCL faltante), dividendos (dolarapi caído) y bonos (CCL + precios stale).
Bonos usa la variante gris con `<Clock />` para precios cacheados.

**Regla:** cuando una fuente externa falla, el usuario tiene que saberlo. Nunca mostrar 0
o `—` sin explicación.

### Empty state

```tsx
<div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
  <p className="text-sm text-zinc-400">Mensaje principal.</p>
  <p className="mt-1 text-xs text-zinc-500">Qué hacer para llenarlo.</p>
</div>
```

Variante con borde punteado (`border-dashed`) para gráficos vacíos.

**Siempre dos líneas:** qué pasa y qué hacer al respecto.

### Toggle de moneda

```tsx
<div className="inline-flex shrink-0 rounded-md border border-zinc-800 bg-zinc-900/60 p-1">
  <Button variant="ghost" size="sm" onClick={() => onChange("ARS")}
    className={cn("h-8 px-3 text-xs",
      value === "ARS" ? "bg-teal-500/20 text-teal-300" : "text-zinc-400 hover:text-zinc-100")}>
    ARS
  </Button>
  {/* … USD, con disabled cuando no hay CCL */}
</div>
```

Duplicado en dashboard y dividendos, con estilos activos ligeramente distintos
(`bg-teal-500/20` vs `bg-zinc-800`). Otro candidato a componente compartido.

### Números

- **Siempre `tabular-nums`** en tablas y KPIs, para que las columnas alineen.
- **`font-mono`** en montos dentro de tablas.
- Formato `es-AR` con `toLocaleString`.
- P&L y variaciones con signo explícito y color.

### Barra indeterminada

```tsx
<div role="progressbar" aria-label="Progreso indeterminado"
     className="indeterminate-bar relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" />
```

La clase `indeterminate-bar` está definida en `src/app/globals.css`. La usa el modal de imports
durante el parseo y el commit.

---

## Formateadores

Hay **cuatro** `format.ts`, uno por dominio, con lógica solapada:

| Archivo | Exporta |
|---|---|
| `components/dashboard/format.ts` | `formatMoney`, `formatCompact`, `formatPercent`, `formatSignedPercent`, `CHART_COLORS`, `SECTOR_COLORS`, `MARKET_COLORS` |
| `components/dividends/format.ts` | `formatMoney`, `formatNumber`, `formatPercent`, `monthName`, `formatDayMonth`, `formatFullDate` |
| `components/bonds/format.ts` | `formatMoney`, `formatNumber`, `formatPercent`, `formatFullDate` — **tolerantes a `null`** |
| `components/events/format.ts` | `formatRatio`, `formatEventTypeLabel` |

Los tres primeros exportan su propio `ViewCurrency = "ARS" | "USD"`.

**Diferencia real que justifica la separación de bonos:**

```ts
// bonds/format.ts
export function formatMoney(value: string | number | null, currency: ViewCurrency): string {
  if (value === null) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 2 });
}
```

En bonos los campos de valuación son `null` con frecuencia (sin precio, sin CCL). Los otros
asumen valor presente.

Si unificás, la versión de bonos es la buena — es un superset.

---

## Landing pública

`src/app/page.tsx` — hero simple con tres CTAs (`Ingresar`, `Crear cuenta`, `Ir al dashboard`).
El copy todavía dice *"Esqueleto técnico listo para agregar features de dominio"*, que quedó
viejo frente al estado actual de la app.

---

## Deuda técnica del sistema

| # | Tema |
|---|---|
| 1 | **`CurrencySwitcher` no hace nada.** Sin `onValueChange`. Cada página tiene su toggle local |
| 2 | **`PortfolioSwitcher` está `disabled`.** No se puede cambiar de portfolio |
| 3 | **Sidebar no responsive.** `w-64` fijo, sin drawer en mobile |
| 4 | **Sin toggle de tema.** `dark` hardcodeado en el `<html>` aunque `next-themes` está instalado |
| 5 | **Clases de `TabsTrigger` duplicadas** en 3 páginas |
| 6 | **Toggle de moneda duplicado** en 2 páginas, con estilos activos distintos |
| 7 | **Cuatro `format.ts`** con `formatMoney`/`formatPercent` casi idénticos |
| 8 | **Ninguna page exporta `metadata`.** El `template` del title existe pero nadie lo aprovecha: todas las pestañas dicen "Portafolio" |
| 9 | **Doble padding en `/events`** (el `<main>` ya trae `p-6`) |
| 10 | **`EventsList` usa `<table>` HTML plano** en vez de `components/ui/table` |
| 11 | **Sin foco visible consistente.** Los componentes de shadcn traen `focus-visible:ring`, pero los elementos custom (botones del calendario de dividendos, filas de leyenda del donut) no |
| 12 | **El copy de la landing quedó viejo** ("esqueleto técnico") |

---

## Cómo extender

### Agregar una pantalla al menú

Sumar la entrada al array `items` de `src/components/layout/sidebar.tsx`:

```tsx
{ href: "/mi-ruta", label: "Mi sección", icon: MiIcono },
```

El icono sale de `lucide-react`. El estado activo se resuelve solo.

### Agregar un componente de shadcn

```bash
npx shadcn@latest add <componente>
```

Se copia a `src/components/ui/`. Revisá que respete la paleta zinc/teal — la CLI usa los tokens
de `components.json`, pero a veces conviene ajustar a mano.

### Habilitar el `CurrencySwitcher` global

1. Crear un `CurrencyContext` (o usar `user.displayCurrencyCode` de la sesión).
2. Conectarle `onValueChange` al `Select`.
3. Reemplazar los `useState<ViewCurrency>` locales de `dashboard-page.tsx` y
   `dividends-page.tsx` por el contexto.
4. Decidir la persistencia: cookie, localStorage, o una action que actualice
   `User.displayCurrencyCode` (ojo: el JWT no se refresca — ver `sistema-auth.md`).

### Habilitar el `PortfolioSwitcher`

Es un cambio transversal, no solo de UI:

1. Action que liste los portfolios del usuario.
2. Contexto o search param con el portfolio activo.
3. **Que todas las actions filtren por ese portfolio.** Hoy el dashboard filtra por uno y las
   otras tres pantallas usan todos — ver `referencia-proyecto.md`.
4. Implementar la pantalla `/portfolios` (hoy es `SectionPlaceholder`).

### Hacer el sidebar responsive

1. `hidden lg:flex` en el `<aside>`.
2. Un `Dialog` o `Sheet` de Radix como drawer en mobile.
3. Botón de menú en el `Header`, visible solo en `< lg`.

### Unificar los formateadores

1. Crear `src/lib/format.ts` con la versión tolerante a `null` (la de bonos) y un
   `ViewCurrency` único.
2. Migrar los cuatro `format.ts` a re-exportar de ahí.
3. Dejar en cada dominio solo lo específico (`SECTOR_COLORS`, `formatEventTypeLabel`, etc.).

### Agregar metadata por pantalla

```tsx
// src/app/(app)/dashboard/page.tsx
export const metadata = { title: "Dashboard" };   // → "Dashboard · Portafolio"
```

El `template` del root layout hace el resto.
