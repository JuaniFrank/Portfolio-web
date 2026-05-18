"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/providers/theme-provider";
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
  return (
    <ThemeProvider>
      <AppSessionProvider session={session}>
        {children}
        <Toaster richColors theme="dark" position="top-center" />
      </AppSessionProvider>
    </ThemeProvider>
  );
}
