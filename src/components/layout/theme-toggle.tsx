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

export function ThemeToggle({ className }: { className?: string }) {
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
        "w-full justify-start gap-2 px-3 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-50",
        className
      )}
      disabled={!mounted}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? (
        isDark ? (
          <>
            <Sun className="h-4 w-4 text-zinc-400" />
            Modo claro
          </>
        ) : (
          <>
            <Moon className="h-4 w-4 text-zinc-500" />
            Modo oscuro
          </>
        )
      ) : (
        <>
          <Sun className="h-4 w-4 text-zinc-400" />
          Tema
        </>
      )}
    </Button>
  );
}
