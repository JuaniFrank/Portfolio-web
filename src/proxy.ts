import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const appPrefixes = [
  "/dashboard",
  "/portfolios",
  "/transactions",
  "/imports",
  "/brokers",
  "/instruments",
  "/settings",
] as const;

function isProtectedPath(pathname: string) {
  return appPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const loggedIn = !!req.auth;

  if (isProtectedPath(pathname) && !loggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if ((pathname === "/login" || pathname === "/register") && loggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
