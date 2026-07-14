import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

// Public routes reachable without a session. Everything else under the
// matcher is protected by default, so new app routes don't silently leak.
const PUBLIC_PATHS = ["/", "/login", "/register", "/reset-password"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Optimistic auth gate. First line of defense only — the real enforcement
 * lives in the server actions (`getCurrentUser`) close to the data. `getToken`
 * verifies the JWT with the secret, so expired/forged cookies read as
 * unauthenticated (no redirect loop). Runs on the Node.js runtime in Next 16.
 */
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
