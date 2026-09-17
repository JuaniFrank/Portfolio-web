"use client";

import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { AppSessionProvider } from "@/components/providers/session-provider";
import { CurrencyProvider } from "@/components/providers/currency-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "sonner";
import type { Session } from "next-auth";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      richColors
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="top-center"
    />
  );
}

export function AppProviders({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <CurrencyProvider>
        <AppSessionProvider session={session}>
          {children}
          <ThemedToaster />
        </AppSessionProvider>
      </CurrencyProvider>
    </ThemeProvider>
  );
}
