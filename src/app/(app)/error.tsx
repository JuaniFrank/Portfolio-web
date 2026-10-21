"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for every page under the app shell. It wraps the page, not the layout,
 * so the sidebar and header stay usable while the content shows the fallback.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // The digest matches the server-side log entry (messages are redacted in production).
    console.error("[app error]", error.digest ?? "no-digest", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Algo salió mal
      </h1>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        No pudimos cargar esta sección. Puede ser un problema temporal: probá de nuevo en unos segundos.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-zinc-500">Código: {error.digest}</p>
      ) : null}
      <Button onClick={() => unstable_retry()}>Reintentar</Button>
    </div>
  );
}
