# portafolio-web

Esqueleto técnico de una aplicación web **Next.js (App Router) + TypeScript estricto** para un portfolio manager orientado a Argentina. Incluye **Prisma + PostgreSQL**, **Auth.js v5 (NextAuth v5) con Credentials**, **Tailwind CSS v4**, **shadcn/ui (componentes copiados al repo)**, y una estructura de carpetas lista para features de dominio.

## Stack

- **Next.js** 16+ (App Router) + **React** 19+
- **TypeScript** (`strict`, `noUncheckedIndexedAccess`)
- **PostgreSQL** + **Prisma ORM** (cliente generado en `src/lib/generated/prisma`)
- **Auth.js v5** (`next-auth@beta`) con **Credentials** + **bcrypt**
- **Tailwind CSS v4** + **shadcn/ui** (Radix + `class-variance-authority` + `tailwind-merge`)
- **Zod** + **React Hook Form** + **`@hookform/resolvers`**
- **date-fns**, **decimal.js** (y `Prisma.Decimal` en DB), **recharts** (instalado, sin uso aún)
- **next-themes** (modo oscuro por defecto) + **sonner** (toasts)

## Setup local (paso a paso)

1. **Instalar dependencias**

```bash
pnpm install
```

> Si tu entorno bloquea scripts de dependencias nativas (p.ej. Prisma/bcrypt), asegurate de permitir builds para esos paquetes. Este repo declara `pnpm.onlyBuiltDependencies` en `package.json` para Prisma/bcrypt.

2. **Configurar variables de entorno**

```bash
cp .env.example .env
```

Completá `DATABASE_URL`, `NEXTAUTH_SECRET` y `NEXTAUTH_URL`.

3. **Sincronizar schema y seed**

```bash
pnpm run db:push
pnpm run db:seed
```

4. **Levantar el dev server**

```bash
pnpm dev
```

## Variables de entorno

Definidas en `.env.example`:

- **`DATABASE_URL`**: connection string de PostgreSQL para Prisma.
- **`NEXTAUTH_SECRET`**: secreto para firmar/encriptar tokens de sesión (Auth.js también acepta `AUTH_SECRET`, pero el ejemplo usa `NEXTAUTH_SECRET` para alinearlo con el README histórico de NextAuth).
- **`NEXTAUTH_URL`**: URL base del sitio (en local: `http://localhost:3000`).

## Comandos disponibles (`package.json`)

- **`pnpm dev`**: `next dev`
- **`pnpm build`**: `next build`
- **`pnpm start`**: `next start`
- **`pnpm lint`**: `next lint`
- **`pnpm run db:generate`**: `prisma generate`
- **`pnpm run db:push`**: `prisma db push`
- **`pnpm run db:migrate`**: `prisma migrate dev`
- **`pnpm run db:seed`**: `tsx prisma/seed.ts`
- **`pnpm run db:studio`**: `prisma studio`

## Estructura de carpetas (alto nivel)

- **`src/app`**: rutas App Router
  - **`(auth)`**: login / registro / reset (layout centrado)
  - **`(app)`**: área autenticada con sidebar + header (placeholders)
  - **`api/auth/[...nextauth]`**: route handler de Auth.js
- **`src/components`**
  - **`ui/`**: componentes estilo shadcn
  - **`layout/`**: `sidebar`, `header`, switchers (stubs)
  - **`auth/`**: formularios de auth
  - **`providers/`**: sesión, tema, toaster
- **`src/lib`**: Prisma singleton, auth config, utils, `validations/`, stubs (`calculations/`, `importers/`, `market/`)
- **`prisma/`**: `schema.prisma`, `seed.ts`
- **`src/types/next-auth.d.ts`**: augmentación de tipos de sesión/JWT

## Auth / protección de rutas

- Config central: `src/lib/auth.ts` (`handlers`, `auth`, `signIn`, `signOut`, `getCurrentUser()`).
- Protección de rutas del shell autenticado: `src/proxy.ts` (Next.js 16 renombra `middleware.ts` → `proxy.ts`) usando `auth` como wrapper.

## Usuario demo (seed)

- Email: **`demo@demo.com`**
- Password: **`demo1234`**

## Notas de implementación (dinero)

No uses `number` para montos de negocio. En Prisma, los campos financieros del schema usan `Decimal` (`Prisma.Decimal` / `Decimal.js`) — los parsers/UI deberían operar con strings/decimales y convertir explícitamente en la capa de dominio.
