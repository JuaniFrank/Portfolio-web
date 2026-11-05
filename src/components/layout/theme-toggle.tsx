"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** No-op subscription: mount state never changes after hydration, so there is
 * nothing to re-subscribe to. This avoids calling setState from an effect
 * body (react-hooks/set-state-in-effect) while keeping the exact same
 * SSR-false / client-true hydration-safe behavior. */
function subscribeToNothing() {
  return () => {};
}

export function ThemeToggle({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "min-h-10 w-full justify-start gap-2 px-3 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-50",
        collapsed && "justify-center px-0",
        className
      )}
      title={collapsed ? (isDark ? "Modo claro" : "Modo oscuro") : undefined}
      aria-label={collapsed ? (isDark ? "Modo claro" : "Modo oscuro") : undefined}
      disabled={!mounted}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? (
        isDark ? (
          <>
            <Sun className="h-4 w-4 text-zinc-400" />
            {!collapsed && "Modo claro"}
          </>
        ) : (
          <>
            <Moon className="h-4 w-4 text-zinc-500" />
            {!collapsed && "Modo oscuro"}
          </>
        )
      ) : (
        <>
          <Sun className="h-4 w-4 text-zinc-400" />
          {!collapsed && "Tema"}
        </>
      )}
    </Button>
  );
}
