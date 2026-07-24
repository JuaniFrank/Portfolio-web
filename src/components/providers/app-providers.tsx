"use client";

import type { ReactNode } from "react";
import { AppSessionProvider } from "@/components/providers/session-provider";
import { Toaster } from "sonner";
import type { Session } from "next-auth";

export function AppProviders({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}) {
  // El tema oscuro está fijado con `className="dark"` en <html> (layout.tsx),
  // así que no se usa next-themes: solo inyectaba un <script> que React 19
  // no ejecuta y que disparaba un error de consola.
  return (
    <AppSessionProvider session={session}>
      {children}
      <Toaster richColors theme="dark" position="top-center" />
    </AppSessionProvider>
  );
}
