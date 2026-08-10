# Sistema de autenticación

> **Documento autocontenido.** Todo lo necesario para trabajar en auth está acá.

---

## Contexto mínimo

- **Stack:** Next.js 16 (App Router) · Auth.js v5 (`next-auth@5.0.0-beta.30`) · Prisma ·
  bcrypt · Zod + React Hook Form.
- **Estrategia de sesión:** JWT (no database sessions).
- **Provider:** Credentials (email + password). No hay OAuth.
- ⚠️ En Next.js 16 `middleware.ts` se llama **`proxy.ts`**.

### Qué hace este sistema

Registrar usuarios detrás de un código de invitación, autenticarlos con email + contraseña,
mantener la sesión en un JWT que carga preferencias del usuario, y proteger las rutas
autenticadas en dos capas (proxy optimista + verificación real en cada server action).

---

## Archivos

| Archivo | Rol |
|---|---|
| `src/lib/auth.ts` | Config de NextAuth. Exporta `handlers`, `auth`, `signIn`, `signOut`, `getCurrentUser()`, `hashPassword()`, `registerUser()` |
| `src/proxy.ts` | Gate optimista de rutas |
| `src/lib/rate-limit.ts` | Rate limiter de ventana fija, en memoria |
| `src/lib/validations/auth.ts` | Schemas Zod: `loginSchema`, `registerSchema`, `resetPasswordSchema` |
| `src/app/actions/auth.ts` | `createUserAction` — registro con invite code |
| `src/app/api/auth/[...nextauth]/route.ts` | Route handler de Auth.js |
| `src/types/next-auth.d.ts` | Augmentación de tipos de `Session`, `User` y `JWT` |
| `src/app/(auth)/layout.tsx` | Layout centrado (grid + max-w-md) |
| `src/app/(auth)/login/page.tsx` | Envuelve `LoginForm` en `<Suspense>` (usa `useSearchParams`) |
| `src/app/(auth)/register/page.tsx` | Renderiza `RegisterForm` |
| `src/app/(auth)/reset-password/page.tsx` | Renderiza `ResetPasswordForm` |
| `src/components/auth/login-form.tsx` | Form de login |
| `src/components/auth/register-form.tsx` | Form de registro |
| `src/components/auth/reset-password-form.tsx` | **Stub** — solo hace `console.log` |
| `src/components/providers/session-provider.tsx` | `SessionProvider` de next-auth |

### Modelo de datos usado

```prisma
model User {
  id                  String     @id @default(cuid())
  email               String     @unique
  passwordHash        String
  name                String?
  displayCurrencyCode String     @default("ARS")
  displayCurrency     Currency   @relation("UserDisplayCurrency", fields: [displayCurrencyCode], references: [code])
  defaultCostMethod   CostMethod @default(PPP)        // enum: PPP | FIFO | LIFO
  timezone            String     @default("America/Argentina/Buenos_Aires")
  emailVerified       DateTime?                        // ← nunca se escribe
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt

  portfolios     Portfolio[]
  brokerAccounts BrokerAccount[]
  imports        ImportBatch[]
  auditLogs      AuditLog[]
  tags           Tag[]
  corporateEventsCreated CorporateEvent[] @relation("CorporateEventCreator")
}
```

`onDelete: Cascade` en portfolios, cuentas, imports, tags y audit logs: borrar un `User`
arrastra todo lo suyo.

---

## Configuración de NextAuth

`src/lib/auth.ts`:

```ts
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [Credentials({ ... })],
  callbacks: { jwt, session },
});
```

### Flujo de `authorize`

```
1. Extrae IP de x-forwarded-for (primer valor, o "unknown")
2. rateLimit(`login:${ip}`, 10 intentos, 60_000 ms)  →  si excede: return null
3. loginSchema.safeParse({ email, password })        →  si falla: return null
4. prisma.user.findUnique({ where: { email } })      →  si no existe: return null
5. bcrypt.compare(password, user.passwordHash)       →  si falla: return null
6. return { id, email, name, displayCurrencyCode, defaultCostMethod }
```

El rate limit corre **antes** de tocar la DB — es lo que evita que un ataque de fuerza bruta
genere carga de queries.

Todos los fallos devuelven `null` (mismo resultado): el form muestra
*"Credenciales inválidas"* sin distinguir entre email inexistente y contraseña incorrecta.

### Callbacks

```ts
async jwt({ token, user }) {
  if (user) {   // solo en el login inicial
    token.sub = user.id;
    token.email = user.email;
    token.name = user.name;
    token.displayCurrencyCode = user.displayCurrencyCode;
    token.defaultCostMethod = user.defaultCostMethod;
  }
  return token;
}

async session({ session, token }) {
  if (session.user) {
    session.user.id = token.sub ?? "";
    session.user.email = (token.email as string | undefined) ?? session.user.email ?? "";
    session.user.name = token.name as string | null | undefined;
    session.user.displayCurrencyCode = (token.displayCurrencyCode as string | undefined) ?? "ARS";
    session.user.defaultCostMethod = (token.defaultCostMethod ?? "PPP") as CostMethod;
  }
  return session;
}
```

> ⚠️ **El token no se refresca.** `displayCurrencyCode` y `defaultCostMethod` se copian una sola
> vez, en el login. Si más adelante `/settings` permite cambiarlos, hará falta forzar un refresh
> de sesión (`update()` del `useSession`) o dejar de leerlos del token.

### Tipado (`src/types/next-auth.d.ts`)

```ts
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      displayCurrencyCode: string;
      defaultCostMethod: CostMethod;
    } & DefaultSession["user"];
  }
  interface User {
    displayCurrencyCode: string;
    defaultCostMethod: CostMethod;
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    displayCurrencyCode?: string;
    defaultCostMethod?: CostMethod;
  }
}
```

Si agregás un campo al token, tenés que declararlo en los tres lugares (`Session`, `User`, `JWT`).

---

## `getCurrentUser()` — la función que usa todo el resto de la app

```ts
export async function getCurrentUser() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    include: { displayCurrency: true },
  });
}
```

**Es el gate real de autorización.** Toda server action del repo empieza así:

```ts
const user = await getCurrentUser();
if (!user) return { error: "unauthorized" };      // lecturas
if (!user) return { ok: false, error: "unauthorized" };  // mutaciones
```

Hace una query por llamada. Si en el futuro molesta el costo, la alternativa es leer el `id`
directo de `auth()` sin ir a la DB — pero perderías la validación de que el usuario todavía existe.

---

## Protección de rutas (`src/proxy.ts`)

```ts
const PUBLIC_PATHS = ["/", "/login", "/register", "/reset-password"];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });
  const isAuthed = Boolean(token);

  if (!isAuthed && !isPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthed && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

### Decisiones de diseño

- **Deny por defecto.** Todo lo que no esté en `PUBLIC_PATHS` está protegido. Agregar una ruta
  nueva no la expone por accidente.
- **`getToken` verifica la firma** con el secret, así que una cookie expirada o forjada se lee
  como no-autenticada. Sin eso podrías tener un loop de redirects.
- **Corre en el runtime Node.js** en Next 16 (no Edge), por eso puede usar el secret.
- **Es optimista.** No consulta la DB. Un usuario borrado con un JWT válido pasa el proxy —
  lo corta `getCurrentUser()` en la action.
- El `matcher` excluye `/api`, assets estáticos e imágenes.

`isPublic` matchea path exacto **o** prefijo (`pathname.startsWith(`${p}/`)`), así que
`/login/algo` también sería público.

---

## Rate limiting (`src/lib/rate-limit.ts`)

```ts
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult
```

Ventana fija en memoria, con un `Map<string, { count, resetAt }>` a nivel de módulo.

- Al expirar la ventana, resetea el bucket.
- `sweep()` limpia buckets vencidos, pero **solo cuando el Map supera 500 entradas** — evita
  recorrer el Map en cada request.
- Devuelve `{ allowed, retryAfterMs }`.

**Uso actual:** solo login, `10 intentos / 60 s` por IP.

> ⚠️ **No es distribuido.** El estado vive en el scope del módulo de **una instancia**. En
> serverless (Vercel) cada cold start arranca con buckets vacíos, así que esto frena fuerza
> bruta casual pero no es garantía cross-instance. Para protección real: Upstash Redis o una
> tabla en la DB. Está documentado en el propio archivo.

---

## Registro

### Schema (`src/lib/validations/auth.ts`)

```ts
export const registerSchema = z
  .object({
    name: z.string().min(1, "Ingresá tu nombre").max(120),
    email: z.string().email("Email inválido"),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(128),
    confirmPassword: z.string().min(1, "Confirmá tu contraseña"),
    inviteCode: z.string().min(1, "Ingresá el código de invitación"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });
```

El mismo schema se usa en el cliente (resolver de RHF) y en el servidor (revalidación).

### Action (`src/app/actions/auth.ts`)

```ts
export async function createUserAction(input: RegisterInput): Promise<CreateUserResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: msg ?? "Datos inválidos" };

  const expectedCode = process.env.REGISTRATION_INVITE_CODE;
  if (!expectedCode || parsed.data.inviteCode !== expectedCode) {
    return { ok: false, error: "Código de invitación inválido" };
  }

  try {
    await registerUser(parsed.data);
    return { ok: true };
  } catch (error) {
    if (isPrismaUniqueViolation(error)) return { ok: false, error: "El email ya está registrado" };
    throw error;
  }
}
```

> 🔒 **Fail-closed.** Si `REGISTRATION_INVITE_CODE` no está definida, `!expectedCode` es `true`
> y **el registro queda cerrado por completo**. No hay modo "abierto". Esto es deliberado.

`registerUser` hashea con `bcrypt.hash(plain, 12)` y crea el user con
`displayCurrencyCode: "ARS"` fijo.

### Flujo en el cliente (`register-form.tsx`)

```
createUserAction(values)
   ├─ !ok  →  setFormError + toast.error, corta
   └─ ok   →  signIn("credentials", { redirect: false })
                 ├─ error  →  "Cuenta creada, pero no se pudo iniciar sesión" → push("/login")
                 └─ ok     →  toast.success + push("/dashboard") + router.refresh()
```

El `router.refresh()` final es necesario para que el RSC del layout raíz vuelva a llamar
`auth()` y hidrate la sesión.

---

## Login (`login-form.tsx`)

```ts
const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

const result = await signIn("credentials", {
  email, password,
  redirect: false,        // manejamos la navegación nosotros
  callbackUrl,
});

if (result?.error) { setFormError("Credenciales inválidas"); return; }
router.push(callbackUrl);
router.refresh();
```

`redirect: false` permite mostrar el error inline en vez de navegar a la página de error de
Auth.js. El `callbackUrl` viene del query param que setea el proxy, así que después del login
volvés a la ruta que querías.

Como usa `useSearchParams()`, la page lo envuelve en `<Suspense>` con un `<Skeleton />`.

---

## Providers (`src/app/layout.tsx`)

```tsx
export default async function RootLayout({ children }) {
  const session = await auth();     // ← sesión resuelta en el servidor
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className={...}>
        <AppProviders session={session}>{children}</AppProviders>
      </body>
    </html>
  );
}
```

`AppProviders` = `ThemeProvider` → `AppSessionProvider` (con la sesión inicial) → children +
`<Toaster richColors theme="dark" position="top-center" />`.

Pasar la sesión desde el servidor evita el flash de "no autenticado" en el primer render del
`Header`, que usa `useSession()`.

---

## Logout

En `src/components/layout/header.tsx`:

```tsx
<DropdownMenuItem onSelect={(e) => {
  e.preventDefault();
  void signOut({ callbackUrl: "/" });
}}>
  Logout
</DropdownMenuItem>
```

El `e.preventDefault()` evita que Radix cierre el menú antes de que arranque el `signOut`.

---

## Limitaciones y deuda

| Tema | Estado |
|---|---|
| **Reset de contraseña** | El form existe y valida el email, pero `onSubmit` solo hace `console.log("[reset-password] submit (stub)", values)`. **No hay backend**: falta tabla de tokens, envío de email y ruta de confirmación |
| **Verificación de email** | `User.emailVerified` existe en el schema, nadie lo escribe |
| **Rate limit distribuido** | Solo en memoria, por instancia (ver arriba) |
| **Refresh del token** | Los campos del user se copian una sola vez en el login |
| **OAuth** | No hay providers sociales |
| **2FA** | No implementado |
| **`AuditLog`** | El modelo existe, nadie escribe eventos de auth |
| **Rate limit en registro** | `createUserAction` **no** está throttleada, solo el login |

---

## Cómo extender

### Agregar un campo del user a la sesión

1. Agregarlo a `prisma/schema.prisma` en `User` → `pnpm run db:push && pnpm run db:generate`.
2. Devolverlo desde `authorize()` en el objeto de retorno.
3. Copiarlo en el callback `jwt` y exponerlo en el callback `session`.
4. Declararlo en `src/types/next-auth.d.ts` (`Session["user"]`, `User` y `JWT`).

### Implementar reset de contraseña

1. Modelo nuevo: `PasswordResetToken { id, userId, tokenHash, expiresAt, usedAt }`.
2. Action `requestPasswordResetAction(email)` — genera token, guarda el hash, manda el mail.
   **Responder siempre igual** exista o no el email (evitar enumeración de usuarios).
3. Ruta `/reset-password/[token]` con form de contraseña nueva.
4. Action `confirmPasswordResetAction(token, newPassword)` — valida hash + expiración +
   no usado, `hashPassword()`, marca `usedAt`.
5. Aplicar `rateLimit` a ambas actions.

### Proteger una ruta nueva

Nada que hacer: el proxy es deny-por-defecto. Solo asegurate de que la server action que la
alimenta empiece con `getCurrentUser()`.

### Agregar una ruta pública

Sumarla a `PUBLIC_PATHS` en `src/proxy.ts`.

### Throttlear una action

```ts
import { rateLimit } from "@/lib/rate-limit";

const { allowed } = rateLimit(`accion:${user.id}`, 5, 60_000);
if (!allowed) return { ok: false, error: "Demasiados intentos. Probá en un minuto." };
```

En una server action no tenés el `Request`, así que la clave conviene armarla con el `user.id`
en vez de la IP.
